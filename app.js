import { Collector, httpUrl, csvHeader, csvRow } from './core.js';

const $ = id => document.getElementById(id);
let collector, db, running = false;
const number = value => value.toLocaleString('en-US');

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sitemap-dump', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('rows', { keyPath: 'url' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rows', 'readwrite');
    action(tx.objectStore('rows'));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('บันทึกข้อมูลไม่สำเร็จ'));
  });
}

function setRunning(value) {
  running = value;
  $('start').disabled = value; $('roots').disabled = value;
  $('stop').disabled = !value; $('retry').disabled = value;
  $('export').disabled = value || !collector?.seenUrls.size;
}

function render(state) {
  $('discovered').textContent = number(state.seen.size);
  $('done').textContent = number(state.done);
  $('failed').textContent = number(state.failures.length);
  $('unique').textContent = number(state.seenUrls.size);
  $('current').textContent = running ? `ไฟล์ล่าสุด: ${state.current || 'กำลังเริ่มต้น'}` : `ตัด URL ซ้ำ ${number(state.duplicates)} รายการ • เหลือในคิว ${number(state.queue.length)} ไฟล์`;
  $('errors-panel').hidden = !state.failures.length;
  $('errors').replaceChildren(...state.failures.map(f => {
    const li = document.createElement('li'); li.textContent = `${f.url} — ${f.error}`; return li;
  }));
}

async function fetchSitemap(url, signal) {
  // Permissions are checked in the extension page, never in a content script.
  if (!await chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] })) {
    throw new Error('ยังไม่ได้รับสิทธิ์เข้าถึงโดเมนนี้ กดลองใหม่เพื่อขอสิทธิ์');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw new Error('หยุดโดยผู้ใช้');
    const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 30000);
    let retryDelay = 1000 * 2 ** attempt;
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(delay)) retryDelay = Math.min(60000, Math.max(retryDelay, delay));
        }
        throw error;
      }
      const xml = await response.text();
      return { xml, finalUrl: response.url || url };
    } catch (error) {
      if (signal.aborted) throw new Error('หยุดโดยผู้ใช้');
      if (attempt === 2 || error.retryable === false) throw new Error(error.name === 'AbortError' ? 'โหลดเกินเวลา 30 วินาที' : error.message);
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
    await new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new Error('หยุดโดยผู้ใช้')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, retryDelay);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
}

async function downloadCsv() {
  if (!db || !collector?.seenUrls.size) throw new Error('ไม่มี URL สำหรับส่งออก');
  const detail = $('format').value === 'detail';
  const parts = ['\uFEFF', csvHeader(detail).join(',') + '\r\n'];
  await new Promise((resolve, reject) => {
    const tx = db.transaction('rows', 'readonly');
    const request = tx.objectStore('rows').openCursor();
    let batch = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { if (batch.length) parts.push(batch.join('')); return; }
      batch.push(csvRow(cursor.value, detail));
      if (batch.length >= 1000) { parts.push(batch.join('')); batch = []; }
      cursor.continue();
    };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  const blob = new Blob(parts, { type: 'text/csv;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const partial = collector.failures.length || collector.queue.length || collector.stopped;
  const filename = `sitemap-urls-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}${partial ? '-partial' : ''}.csv`;
  try {
    const id = await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
    // Retain the object URL until Chrome has consumed the file.
    const listener = delta => {
      if (delta.id === id && delta.state && ['complete', 'interrupted'].includes(delta.state.current)) {
        URL.revokeObjectURL(blobUrl); chrome.downloads.onChanged.removeListener(listener);
        if (delta.state.current === 'interrupted') $('status').textContent = 'ดาวน์โหลดไฟล์ไม่สำเร็จ กดดาวน์โหลด CSV อีกครั้ง';
      }
    };
    chrome.downloads.onChanged.addListener(listener);
    const items = await chrome.downloads.search({ id });
    if (items[0] && items[0].state !== 'in_progress') listener({ id, state: { current: items[0].state } });
  } catch (error) { URL.revokeObjectURL(blobUrl); throw error; }
}

async function finishWork(work) {
  setRunning(true); $('status').textContent = 'กำลังรวบรวม sitemap…';
  try {
    await work();
    const partial = collector.stopped || collector.failures.length || collector.queue.length;
    $('status').textContent = partial ? `ผลลัพธ์บางส่วน: ${number(collector.seenUrls.size)} URL` : `รวบรวมครบ: ${number(collector.seenUrls.size)} URL`;
    if (collector.seenUrls.size) await downloadCsv();
  } catch (error) { $('status').textContent = `เกิดข้อผิดพลาด: ${error.message}`; }
  finally { setRunning(false); render(collector); }
}

$('start').addEventListener('click', async () => {
  try {
    const roots = [...new Set($('roots').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => httpUrl(s)))];
    if (!roots.length) throw new Error('ใส่ URL sitemap อย่างน้อยหนึ่งรายการ');
    const origins = [...new Set(roots.map(url => new URL(url).origin + '/*'))];
    setRunning(true); $('stop').disabled = true;
    $('status').textContent = 'กำลังขอสิทธิ์เข้าถึงเว็บ กรุณาอนุญาตในหน้าต่าง Chrome';
    // Invoke directly from the click handler to retain Chrome's user gesture.
    const granted = await chrome.permissions.request({ origins });
    if (!granted) throw new Error('ต้องอนุญาตให้ส่วนขยายอ่าน sitemap ของโดเมนที่เลือก');
    setRunning(true);
    db ||= await openDb(); await transaction(store => store.clear());
    collector = new Collector({ fetchSitemap, saveRows: rows => transaction(store => { for (const row of rows) store.put(row); }), onChange: render });
    for (const url of roots) collector.add(url, url);
    await finishWork(() => collector.run());
  } catch (error) { $('status').textContent = error.message; setRunning(false); }
});

$('stop').addEventListener('click', () => { collector?.stop(); $('stop').disabled = true; $('status').textContent = 'กำลังหยุดและเก็บผลลัพธ์ที่รวบรวมได้…'; });
$('retry').addEventListener('click', async () => {
  try {
    const jobs = [...collector.failures, ...collector.queue];
    const origins = [...new Set(jobs.map(job => new URL(job.url).origin + '/*'))];
    setRunning(true); $('stop').disabled = true;
    $('status').textContent = 'กำลังตรวจสิทธิ์เข้าถึงเว็บ…';
    if (origins.length && !await chrome.permissions.request({ origins })) throw new Error('ไม่ได้รับสิทธิ์เข้าถึงเว็บ');
    await finishWork(() => collector.retry());
  } catch (error) { $('status').textContent = error.message; setRunning(false); }
});
$('export').addEventListener('click', async () => { try { await downloadCsv(); } catch (error) { $('status').textContent = error.message; } });
window.addEventListener('beforeunload', event => { if (running) { event.preventDefault(); event.returnValue = ''; } });

// Keep the shared results database owned by one working tab, including exports.
$('start').disabled = true;
navigator.locks.request('sitemap-dump-session', { ifAvailable: true }, async lock => {
  if (!lock) {
    $('status').textContent = 'มีแท็บ sitemap dump by cybersafe เปิดอยู่แล้ว กรุณาใช้แท็บนั้น หรือปิดแล้วโหลดหน้านี้ใหม่';
    return;
  }
  $('start').disabled = false;
  await new Promise(() => {});
}).catch(error => { $('status').textContent = `ไม่สามารถเริ่มงานได้: ${error.message}`; });
