import { parseSitemap, Collector, csvCell, csvRow, httpUrl } from './core.js';
const ns = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const urlset = items => `<urlset xmlns="${ns}">${items.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
const index = items => `<sitemapindex xmlns="${ns}">${items.map(url => `<sitemap><loc>${url}</loc></sitemap>`).join('')}</sitemapindex>`;
let count = 0;
function assert(condition, label) { if (!condition) throw new Error(label); count++; }
function throws(fn, label) { let threw = false; try { fn(); } catch { threw = true; } assert(threw, label); }
try {
  const parsed = parseSitemap(`<s:urlset xmlns:s="${ns}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><s:url><s:loc>https://example.com/?a=1&amp;b=2</s:loc><s:lastmod>2026-10-14</s:lastmod><image:image><image:loc>https://example.com/image.jpg</image:loc></image:image></s:url></s:urlset>`, 'https://example.com/map');
  assert(parsed.rows.length === 1, 'exclude image loc');
  assert(parsed.rows[0].url === 'https://example.com/?a=1&b=2', 'XML entity decoding');
  assert(parsed.rows[0].lastmod === '2026-10-14', 'metadata');
  throws(() => parseSitemap('<urlset><url>', 'https://example.com'), 'reject malformed XML');
  throws(() => parseSitemap('<html><body>Challenge</body></html>', 'https://example.com'), 'reject HTML');
  throws(() => parseSitemap('<urlset xmlns="https://wrong.example/"/>', 'https://example.com'), 'reject unknown namespace');
  throws(() => parseSitemap('<urlset><url/></urlset>', 'https://example.com'), 'reject missing loc');
  throws(() => httpUrl('javascript:alert(1)'), 'reject unsafe scheme');
  assert(csvCell('a,"b"\nc') === '"a,""b""\nc"', 'CSV quoting');
  assert(csvCell('=HYPERLINK("x")').startsWith('"\''), 'formula protection');
  assert(csvRow({ url: 'https://example.com/ไทย?a=1&b=2' }, false).endsWith('\r\n'), 'CSV CRLF');
  const base = 'https://example.com/'; const files = {
    [base + 'root']: index([base + 'nested', base + 'one', base + 'bad']),
    [base + 'nested']: index([base + 'root', base + 'two', base + 'one']),
    [base + 'one']: urlset([base + 'a', base + 'a', base + 'b?x=1']),
    [base + 'two']: urlset([base + 'a', base + 'b?x=2', base + 'a/'])
  };
  let active = 0, maximum = 0; const requests = [], rows = [];
  const collector = new Collector({
    fetchSitemap: async url => {
      active++; maximum = Math.max(active, maximum); requests.push(url);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      if (!files[url]) throw new Error('HTTP 404');
      return { xml: files[url], finalUrl: url };
    },
    saveRows: async values => { await new Promise(resolve => setTimeout(resolve, 10)); rows.push(...values); }
  });
  collector.add(base + 'root', base + 'root'); collector.add(base + 'one', base + 'one');
  await collector.run();
  assert(collector.seen.size === 5, 'recursive index + cycle prevention');
  assert(requests.filter(url => url === base + 'one').length === 1, 'fetch sitemap once');
  assert(collector.failures.length === 1 && collector.done === 4, 'partial errors');
  assert(rows.length === 4 && collector.seenUrls.size === 4, 'cross-file dedup, query and slash preserved');
  assert(maximum <= 3, 'concurrency limit');
  files[base + 'bad'] = urlset([base + 'recovered']);
  await collector.retry();
  assert(collector.failures.length === 0 && collector.done === 5, 'retry failed file');
  assert(rows.length === 5, 'retry retains successful rows');
  assert(requests.filter(url => url === base + 'one').length === 1, 'retry does not reload successes');
  const stopped = new Collector({ fetchSitemap: async () => { stopped.stop(); throw new Error('abort'); }, saveRows: async () => {} });
  stopped.add(base + 'root', base + 'root'); stopped.add(base + 'two', base + 'root');
  await stopped.run();
  assert(stopped.stopped && stopped.failures.length === 2, 'stop tracks aborted work');
  document.getElementById('result').textContent = `PASS: ${count} checks`;
  document.body.dataset.result = 'pass';
} catch (error) {
  document.getElementById('result').textContent = `FAIL after ${count} checks: ${error.stack}`;
  document.body.dataset.result = 'fail';
}
