#!/usr/bin/env node
/*
 * Kiểm chứng đường trích transcript bằng DOM trên trang YouTube THẬT.
 *
 *   node tools/verify-live.mjs [videoId]
 *
 * Vì sao cần công cụ này: phần DOM của `transcript.js` không test tự động được
 * (không có jsdom, và một bộ shim DOM tự viết chỉ tạo cảm giác an toàn giả).
 * Nó phụ thuộc vào DOM thật của YouTube — thứ Google đổi bất cứ lúc nào. Script
 * này nạp thẳng mã nguồn thật vào một trang YouTube thật rồi chạy `fromPanel()`.
 *
 * Nó KHÔNG cần Chrome nạp được extension (Chrome 137+ đã bỏ --load-extension),
 * cũng KHÔNG cần đăng nhập — nên dùng được với mọi video công khai có phụ đề.
 *
 * Ba lỗi thật đã bị bắt bằng đúng script này:
 *   1. findTranscriptButton() bấm nhầm nút "Transcript" của chính extension
 *   2. Selector trỏ vào layout transcript cũ đã bị YouTube thay
 *   3. el.click() không mở được panel — phải phát đủ chuỗi pointer
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = process.argv[2] || 'dQw4w9WgXcQ';
const PROFILE = '/tmp/nblm-verify-live';
const BINARY = process.env.CHROME_BIN || '/usr/bin/google-chrome-stable';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -- CDP qua pipe -------------------------------------------------------- */

fs.rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(BINARY, [
  `--user-data-dir=${PROFILE}`,
  '--remote-debugging-pipe',
  // Cửa sổ phải đủ rộng: panel transcript nằm ở cột phải và YouTube ẩn nó
  // ở layout hẹp — panel sẽ đứng nguyên ở trạng thái HIDDEN.
  '--window-size=1680,1050',
  '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'inherit', 'pipe', 'pipe'] });

const [, , , wr, rd] = chrome.stdio;
let id = 0;
let buf = Buffer.alloc(0);
const pending = new Map();

rd.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  let i;
  while ((i = buf.indexOf(0)) !== -1) {
    let m = null;
    try { m = JSON.parse(buf.subarray(0, i).toString()); } catch {}
    buf = buf.subarray(i + 1);
    if (m?.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});

const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    wr.write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });

await sleep(3500);
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, S);
await send('Page.enable', {}, S);
await send('Network.enable', {}, S);
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false }, S);
await send('Network.setCookie', { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }, S);

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, S);
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result?.value;
};

/* -- chạy -------------------------------------------------------------- */

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

console.log(`\nvideo: ${VIDEO}\n`);
await send('Page.navigate', { url: `https://www.youtube.com/watch?v=${VIDEO}` }, S);
await sleep(12000); // YouTube chuyển hướng ?themeRefresh=1 rồi mới hydrate

// Bung mô tả cho tới khi mục transcript xuất hiện (polling từ ngoài, vì một
// vòng lặp dài trong trang sẽ bị huỷ khi trang điều hướng).
let ready = false;
for (let i = 0; i < 25; i++) {
  await ev(`(()=>{const e=document.querySelector('#description-inline-expander #expand')||document.querySelector('#expand');if(e)e.click();})()`);
  if ((await ev(`!!document.querySelector('ytd-video-description-transcript-section-renderer')`)) === true) { ready = true; break; }
  await sleep(1000);
}
check(ready, 'trang dựng xong, mục transcript có trong phần mô tả');

// Dựng lại đúng nút mà content.js chèn — đây là cái từng bị bấm nhầm.
await ev(`(() => {
  const row = document.querySelector('#top-level-buttons-computed') || document.querySelector('#actions');
  if (row && !document.querySelector('#nblm-transcript-button')) {
    const b = document.createElement('button');
    b.id = 'nblm-transcript-button'; b.textContent = 'Transcript';
    row.prepend(b);
  }
})()`);

await ev(`globalThis.chrome = globalThis.chrome || { storage:{ local:{ get:async()=>({}), set:async()=>{} } } };`);
await ev(fs.readFileSync(path.join(ROOT, 'src/common/shared.js'), 'utf8'));
await ev(fs.readFileSync(path.join(ROOT, 'src/youtube/transcript.js'), 'utf8'));

const r = await ev(`globalThis.NBLM_TRANSCRIPT.fromPanel()
  .then(x => ({ ok:true, cach:x.method, soDong:x.segments.length,
                mau:x.segments.slice(0,2).map(s => s.start + 's | ' + s.text.slice(0,40)),
                cuoi:x.segments.at(-1)?.start,
                coNhanTroNang: x.segments.some(s => /\\b\\d+ (second|minute)s?\\b/.test(s.text)) }))
  .catch(e => ({ ok:false, loi:String((e&&e.message)||e).slice(0,200) }))`);

check(r?.ok, 'fromPanel() lấy được transcript', r?.ok ? `${r.soDong} dòng, tới ${r.cuoi}s` : r?.loi);
if (r?.ok) {
  check(r.soDong > 0, 'có ít nhất một dòng');
  check(r.cuoi > 0, 'timestamp bóc đúng (dòng cuối > 0s)');
  check(!r.coNhanTroNang, 'không nuốt nhãn trợ năng ("1 second") vào lời thoại');
  console.log('\nmẫu:', r.mau.join('\n      '));
}

chrome.kill('SIGKILL');
console.log(`\n${failed ? `${failed} kiểm tra HỎNG` : 'tất cả kiểm tra ĐẠT'}`);
process.exit(failed ? 1 : 0);
