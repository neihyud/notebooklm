#!/usr/bin/env node
/*
 * Kiểm chứng module tài liệu trên trang docs THẬT.
 *
 *   node tools/verify-docs.mjs [url ...]
 *
 * Vì sao cần: `sidebar.js`, `extract.js`, `markdown.js` đều bám vào DOM thật và
 * không test tự động được (không có jsdom, và một bộ shim DOM tự viết chỉ tạo
 * cảm giác an toàn giả). Toàn bộ phán đoán trong đó — chấm điểm sidebar, chọn
 * phần thân bài, dựng lại ngắt dòng trong khối code — là giả thuyết về cách các
 * bộ tạo docs dựng HTML. Chưa chạy trên trang thật thì chỉ là giả thuyết.
 *
 * Script nạp thẳng mã nguồn thật vào trang thật rồi chạy như extension chạy.
 * Không cần Chrome nạp extension, không cần đăng nhập.
 *
 * Mặc định quét 4 bộ tạo docs phổ biến nhất, mỗi bộ dựng HTML một kiểu khác hẳn.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = '/tmp/nblm-verify-docs';
const BINARY = process.env.CHROME_BIN || '/usr/bin/google-chrome-stable';

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      ['Docusaurus', 'https://docusaurus.io/docs/creating-pages'],
      ['MkDocs Material', 'https://squidfunk.github.io/mkdocs-material/setup/changing-the-colors/'],
      ['VitePress', 'https://vitepress.dev/guide/routing'],
      ['Sphinx + RTD', 'https://requests.readthedocs.io/en/latest/user/quickstart/'],
    ].map((t) => t);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -- CDP qua pipe -------------------------------------------------------- */

fs.rmSync(PROFILE, { recursive: true, force: true });
const chrome = spawn(BINARY, [
  `--user-data-dir=${PROFILE}`,
  '--remote-debugging-pipe',
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
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false }, S);

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, S);
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result?.value;
};

const SOURCES = ['src/common/shared.js', 'src/docs/markdown.js', 'src/docs/extract.js', 'src/docs/sidebar.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));

/* -- kiểm tra ------------------------------------------------------------ */

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

for (const [name, url] of TARGETS) {
  console.log(`\n── ${name}\n   ${url}`);

  await send('Page.navigate', { url }, S);
  await sleep(6000); // docs SPA dựng thân bài sau 'load'

  await ev(`globalThis.chrome = globalThis.chrome || { storage:{ local:{ get:async()=>({}), set:async()=>{} } } };`);
  for (const source of SOURCES) {
    const r = await ev(source);
    if (r && r.__err) { check(false, 'nạp được mã nguồn', r.__err.slice(0, 160)); break; }
  }

  const r = await ev(`(() => {
    const sb = globalThis.NBLM_DOCS_SIDEBAR.detect();
    const doc = globalThis.NBLM_DOCS_EXTRACT.fromLive({ keepLinks: false, keepImages: true, minChars: 600 });
    const md = doc.markdown;

    const flat = [];
    (function walk(ns, d) { for (const n of ns) { flat.push({ t: n.title, u: n.url, d }); walk(n.children || [], d + 1); } })(sb ? sb.tree : [], 0);

    // Khối code: đếm fence và kiểm tra bên trong có xuống dòng thật hay không.
    const fences = [...md.matchAll(/\`\`\`[a-z0-9+#-]*\\n([\\s\\S]*?)\`\`\`/g)].map((m) => m[1]);

    return {
      sidebar: !!sb,
      soLink: sb ? sb.count : 0,
      sauNhat: flat.reduce((m, n) => Math.max(m, n.d), 0),
      coLong: flat.some((n) => n.d > 0),
      trungTrang: flat.filter((n) => n.u && n.u.split('#')[0] === location.href.split('#')[0]).length,
      ngoaiSite: flat.filter((n) => n.u && new URL(n.u).host !== location.host).length,

      how: doc.how,
      tieuDe: doc.title,
      chars: doc.chars,
      // So với chữ trong *khối thân bài đã chọn*, không phải cả trang: trang
      // toàn bài viết thì tỉ lệ với cả trang tự nhiên đã gần 1, so kiểu đó chỉ
      // sinh báo động giả. "Có nuốt mất nội dung không" mới là câu hỏi đúng —
      // còn "có lọt điều hướng vào không" đã có phép đo rotLot bên dưới.
      rootChars: (globalThis.NBLM_DOCS_EXTRACT.pickRoot(document, 600).el.innerText || '').length,
      coDeMuc: /^#{1,3} /m.test(md),

      preTrenTrang: document.querySelectorAll('pre').length,
      soFence: fences.length,
      fenceNhieuDong: fences.filter((f) => f.trim().includes('\\n')).length,
      fenceMotDongDai: fences.filter((f) => !f.trim().includes('\\n') && f.trim().length > 120).length,

      // Tên mục sidebar KHÔNG thuộc trang này mà lọt vào thân bài = dọn rác hụt.
      rotLot: flat.filter((n) => n.u && n.t && n.t.length > 6 &&
        n.u.split('#')[0] !== location.href.split('#')[0] &&
        md.includes('\\n' + n.t + '\\n')).length,
      tongMuc: flat.filter((n) => n.t && n.t.length > 6).length,
      mau: md.slice(0, 160).replace(/\\n/g, ' ⏎ '),
    };
  })()`);

  if (!r || r.__err) { check(false, 'chạy được module', String(r?.__err).slice(0, 200)); continue; }

  check(r.sidebar, 'dò thấy sidebar', r.sidebar ? `${r.soLink} link, sâu ${r.sauNhat} cấp` : '');
  check(r.soLink >= 5, 'sidebar có đủ link (≥5)', String(r.soLink));
  check(r.ngoaiSite === 0, 'không lọt link khác site', `${r.ngoaiSite} link lạ`);
  check(r.trungTrang <= 1, 'không lọt neo trong trang (mục lục "On this page")', `${r.trungTrang} link trỏ về chính trang`);

  check(r.how !== 'fallback', 'chọn được phần thân bài', r.how);
  check(r.chars > 500, 'trích ra nội dung thật', `${r.chars} ký tự`);
  check(r.chars > r.rootChars * 0.5, 'không nuốt mất nội dung thân bài',
    `${r.chars} / ${r.rootChars} ký tự trong khối đã chọn`);
  check(r.coDeMuc, 'giữ được cấu trúc đề mục');

  if (r.preTrenTrang > 0) {
    check(r.soFence > 0, 'khối code ra fence', `${r.soFence}/${r.preTrenTrang} <pre>`);
    check(r.fenceMotDongDai === 0, 'code KHÔNG bị dính thành một dòng (bẫy Prism/Shiki)',
      r.fenceMotDongDai ? `${r.fenceMotDongDai} khối dính liền` : `${r.fenceNhieuDong} khối nhiều dòng`);
  }

  check(r.rotLot <= Math.max(1, r.tongMuc * 0.15), 'sidebar không rớt vào thân bài',
    `${r.rotLot}/${r.tongMuc} mục`);
  console.log(`     tiêu đề: ${r.tieuDe}`);
  console.log(`     mở đầu : ${r.mau}`);
}

chrome.kill('SIGKILL');
console.log(`\n${failed ? `${failed} kiểm tra HỎNG` : 'tất cả kiểm tra ĐẠT'}`);
process.exit(failed ? 1 : 0);
