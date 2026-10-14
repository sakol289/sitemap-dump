const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

export function httpUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('รองรับเฉพาะ HTTP/HTTPS');
  if (url.username || url.password) throw new Error('URL ต้องไม่มี username/password');
  return url.href;
}

export function parseSitemap(xml, source, Parser = globalThis.DOMParser) {
  const doc = new Parser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML ไม่ถูกต้อง');
  const root = doc.documentElement;
  if (!root || !['urlset', 'sitemapindex'].includes(root.localName)) throw new Error('ไม่ใช่ XML sitemap (อาจเป็น HTML หรือหน้าป้องกันบอต)');
  if (root.namespaceURI && root.namespaceURI !== NS) throw new Error('Sitemap namespace ไม่ถูกต้อง');
  const children = node => Array.from(node.childNodes).filter(n => n.nodeType === 1);
  const field = (node, name) => children(node).find(n => n.localName === name && (n.namespaceURI || '') === (root.namespaceURI || ''))?.textContent.trim() || '';
  const index = root.localName === 'sitemapindex';
  const entries = children(root).filter(n => n.localName === (index ? 'sitemap' : 'url') && (n.namespaceURI || '') === (root.namespaceURI || ''));
  const values = entries.map(node => {
    const loc = field(node, 'loc');
    if (!loc) throw new Error('มีรายการที่ไม่มี loc');
    return { url: httpUrl(loc, source), lastmod: field(node, 'lastmod'), changefreq: field(node, 'changefreq'), priority: field(node, 'priority') };
  });
  return index ? { type: 'index', children: values.map(v => v.url) } : { type: 'urls', rows: values };
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Prevent spreadsheet formulas in metadata received from remote files.
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function csvHeader(detail) {
  return detail ? ['url', 'lastmod', 'changefreq', 'priority', 'source_sitemap', 'root_sitemap'] : ['url'];
}

export function csvRow(row, detail) {
  return csvHeader(detail).map(key => csvCell(row[key])).join(',') + '\r\n';
}

export class Collector {
  constructor({ fetchSitemap, saveRows, onChange = () => {} }) {
    this.fetchSitemap = fetchSitemap; this.saveRows = saveRows; this.onChange = onChange;
    this.seen = new Set(); this.seenUrls = new Set(); this.queue = []; this.failures = [];
    this.done = 0; this.duplicates = 0; this.stopped = false; this.active = new Set();
  }
  add(url, root) {
    const key = new URL(url); key.hash = '';
    if (this.seen.has(key.href)) return;
    this.seen.add(key.href); this.queue.push({ url: key.href, root });
  }
  stop() { this.stopped = true; for (const controller of this.active) controller.abort(); }
  async run() {
    this.stopped = false;
    while (this.queue.length && !this.stopped) {
      await Promise.all(this.queue.splice(0, 3).map(job => this.process(job)));
    }
    this.onChange(this);
  }
  async process(job) {
    const controller = new AbortController(); this.active.add(controller);
    this.current = job.url; this.onChange(this);
    try {
      const { xml, finalUrl } = await this.fetchSitemap(job.url, controller.signal);
      if (this.stopped) throw new Error('หยุดโดยผู้ใช้');
      const parsed = parseSitemap(xml, finalUrl);
      if (parsed.type === 'index') {
        for (const url of parsed.children) this.add(url, job.root);
      } else {
        const rows = []; const fresh = new Set();
        for (const row of parsed.rows) {
          if (this.seenUrls.has(row.url) || fresh.has(row.url)) { this.duplicates++; continue; }
          fresh.add(row.url);
          rows.push({ ...row, source_sitemap: finalUrl, root_sitemap: job.root });
        }
        // Reserve before awaiting persistence so concurrent files cannot add duplicates.
        for (const url of fresh) this.seenUrls.add(url);
        try { await this.saveRows(rows); }
        catch (error) { for (const url of fresh) this.seenUrls.delete(url); throw error; }
      }
      this.done++;
    } catch (error) {
      this.failures.push({ ...job, error: this.stopped ? 'หยุดโดยผู้ใช้' : error.message });
    } finally { this.active.delete(controller); this.onChange(this); }
  }
  retry() { this.queue.push(...this.failures.map(({ url, root }) => ({ url, root }))); this.failures = []; return this.run(); }
}
