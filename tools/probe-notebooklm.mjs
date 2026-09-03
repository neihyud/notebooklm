#!/usr/bin/env node
/*
 * Đo những thứ mà chỉ tab NotebookLM đã đăng nhập của owner mới trả lời được, và
 * `src/notebooklm/rpc.js` hiện đang phải ĐOÁN:
 *
 *   1. rpc id thật của "thêm nguồn", và đường batchexecute thật.
 *   2. Hình dạng thật của `f.req` — cụ thể là URL / tiêu đề / nội dung rơi vào
 *      ô số mấy trong `params[0]`, và mã loại nguồn là số nào.
 *   3. Token `at` lấy được từ đường nào: đọc chữ của <script> trong DOM (đường
 *      mà content script ISOLATED world dùng được), hay bắt buộc phải có cầu nối
 *      MAIN world kiểu `src/youtube/page-bridge.js`.
 *   4. Vị trí `sourceId` trong PHẢN HỒI của `izAoDd`        → ticket 009
 *   5. Hình dạng args của `wXbhsf` (liệt kê notebook)        → ticket 011
 *   6. Hình dạng args của `tGMBJ` (xoá nguồn)                → ticket 012
 *   7. Hình dạng args khi MỘT `izAoDd` mang nhiều nguồn      → ticket 008
 *
 * Tiện thể dump luôn cấu trúc DANH SÁCH NGUỒN cho `docs/tickets/005-*.md`, vì
 * nó nằm trong cùng một phiên đăng nhập và không tốn thêm thao tác nào.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MỤC 4-7 KHÔNG LÀM CÔNG CỤ NÀY NGUY HIỂM HƠN
 *
 * Script này THỤ ĐỘNG: nó không tự gửi một request batchexecute nào. Mọi thứ nó
 * biết đều là request mà chính giao diện NotebookLM gửi đi, bắt lại bằng cách
 * bọc `fetch`/`XMLHttpRequest`. Bốn mục mới cũng vậy — chúng chỉ là bốn thao tác
 * owner làm trong giao diện (xoá một Nguồn, dán hai URL, bấm về trang chủ), và
 * script đứng nghe.
 *
 * Điều đó quan trọng với ticket 008 và 012 hơn là với công cụ này. Cả hai ticket
 * đang chặn vì phương án còn lại là TỰ GỬI một payload đoán mò lên notebook của
 * owner — thêm nguồn thì không idempotent, xoá nguồn thì không hoàn tác được.
 * Quan sát giao diện làm việc đó thay ta gỡ đúng chỗ chặn ấy mà không phải trả
 * giá nào.
 *
 * Chuỗi vẫn bị che thành `str(<độ dài>)` như cũ, và điều đó không cản việc đo:
 * bốn mục mới hỏi về VỊ TRÍ và HÌNH DẠNG, không hỏi về giá trị.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NÓ KHÔNG IN RA CÁI GÌ
 *
 * Không cookie, không token, không nội dung Nguồn, không tiêu đề notebook. Mọi
 * chuỗi trong request/response đều bị thay bằng `"str(<độ dài>)"` TRƯỚC khi ra
 * khỏi trang; ngoại lệ duy nhất là mấy chuỗi mốc do chính script này sinh ra và
 * bảo owner dán vào — chúng in ra thành `MARKER:url` / `MARKER:title` / …, và
 * đó chính là cách ta biết ô nào chứa gì. Số thì in nguyên: mã loại nguồn là số.
 *
 * Không gửi gì đi đâu. Chỉ mở trình duyệt, nghe, rồi in ra stdout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÙNG
 *
 *   node tools/probe-notebooklm.mjs                       # mở trang chủ NotebookLM
 *   node tools/probe-notebooklm.mjs <url-notebook-nhap>   # mở thẳng notebook nháp
 *
 *   CHROME_BIN=/usr/bin/brave  node tools/probe-notebooklm.mjs
 *   NBLM_PROFILE=~/.cache/nblm-probe node tools/probe-notebooklm.mjs
 *
 * HỒ SƠ TRÌNH DUYỆT — đánh đổi có chủ ý. `tools/probe-sidebar.mjs` xoá sạch
 * `--user-data-dir` mỗi lần chạy; ở đây KHÔNG xoá, vì NotebookLM đòi đăng nhập
 * và profile vứt đi nghĩa là owner đăng nhập lại mỗi lần. Đổi lại, hồ sơ đó nằm
 * ở `/tmp` và có phiên Google thật trong đó — xoá tay khi xong nếu máy dùng
 * chung. Script TUYỆT ĐỐI không đọc, không chép, không mở hồ sơ Brave/Chrome
 * thật của owner: nó chỉ biết đúng thư mục `NBLM_PROFILE`.
 *
 * PHẢI LÀ NOTEBOOK NHÁP. Thao tác thêm Nguồn dưới đây là thật và không
 * idempotent — `WORKSPACE_PROTOCOL.md` → external side effects.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const START_URL = process.argv[2] || 'https://notebooklm.google.com/';
const PROFILE = process.env.NBLM_PROFILE || path.join(os.tmpdir(), 'nblm-probe-notebooklm');
const CHO_TOI_DA_MS = Number(process.env.NBLM_TIMEOUT_MS || 15 * 60 * 1000);

/** Chuỗi mốc: owner dán chúng vào giao diện, ta đọc ngược ra ô nào chứa gì. */
const rnd = Math.random().toString(36).slice(2, 8);
const MARKER = {
  url: `https://example.com/nblm-probe-${rnd}`,
  youtube: `https://www.youtube.com/watch?v=nblmPROBE${rnd.slice(0, 1)}`,
  title: `nblm-probe-title-${rnd}`,
  text: `nblm-probe-text-${rnd} noi dung mau de do hinh dang payload`,
};

/*
 * Những rpc id mà một lượt chạy này CÓ THỂ trả lời, và ticket nào đang chờ.
 *
 * Tất cả đều bắt được THỤ ĐỘNG: chính giao diện NotebookLM gửi chúng, script chỉ
 * nghe. Không lượt nào dưới đây do script tự gửi — đó là lý do thêm ba mục tiêu
 * mới không làm tăng rủi ro của công cụ này một chút nào.
 *
 * Chuỗi trong payload vẫn bị che thành `str(<độ dài>)`, và điều đó KHÔNG cản
 * việc đo: ba ticket dưới đây hỏi về VỊ TRÍ và HÌNH DẠNG, không hỏi về giá trị.
 */
const MUC_TIEU = [
  { id: 'izAoDd', ticket: '008 + 009', vi: 'thêm nguồn — hình dạng args, và vị trí `sourceId` trong phản hồi' },
  { id: 'wXbhsf', ticket: '011', vi: 'liệt kê notebook — args, và vị trí id/title trong phản hồi' },
  { id: 'tGMBJ', ticket: '012', vi: 'xoá nguồn — hình dạng args' },
];

/** Chờ thêm bao lâu sau khi đã bắt đủ hai Nguồn mốc, để nhặt nốt các rpc id còn thiếu. */
const CHO_THEM_MS = Number(process.env.NBLM_GRACE_MS || 90 * 1000);

/* ------------------------------------------------------------------ */
/* trình duyệt                                                         */
/* ------------------------------------------------------------------ */

function timTrinhDuyet() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const ungVien = [
    '/usr/bin/brave',
    '/usr/bin/brave-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const hit = ungVien.find((p) => fs.existsSync(p));
  if (!hit) {
    console.error(
      'Không tìm thấy trình duyệt nhân Chromium nào. Đặt CHROME_BIN=/đường/dẫn rồi chạy lại.\n' +
        `Đã thử: ${ungVien.join(', ')}`
    );
    process.exit(2);
  }
  return hit;
}

const CHROME = timTrinhDuyet();
fs.mkdirSync(PROFILE, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${PROFILE}`,
    '--remote-debugging-pipe',
    '--window-size=1680,1050',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'inherit', 'pipe', 'pipe'] }
);

const [, , , wr, rd] = chrome.stdio;
let id = 0;
let buf = Buffer.alloc(0);
const pending = new Map();
rd.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
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

/* ------------------------------------------------------------------ */
/* bộ ghi, chạy trong MAIN world của trang                             */
/* ------------------------------------------------------------------ */

/**
 * Toàn bộ việc che chuỗi làm NGAY TẠI CHỖ BẮT, không phải lúc in: thân request
 * thật (có `at` token trong đó) không bao giờ được cất vào biến nào cả.
 */
const RECORDER = `(() => {
  if (window.__nblmProbe) return 'da co';
  const MARK = ${JSON.stringify(MARKER)};
  // 'gen' đổi theo TỪNG DOCUMENT (chú ý: không dùng dấu huyền trong khối này,
  // cả đoạn nằm trong một template literal của phía Node). Không có nó thì phía
  // Node chỉ còn cách đoán "trang đã tải lại chưa" qua độ dài mảng — và đoán sai
  // lặng lẽ mỗi khi trang mới kịp gửi đủ request trước lần poll kế.
  const store = { gen: Math.random().toString(36).slice(2) + Date.now(), calls: [] };
  window.__nblmProbe = store;

  const nhan = (s) => {
    for (const k of Object.keys(MARK)) if (s.indexOf(MARK[k]) !== -1) return 'MARKER:' + k;
    return null;
  };
  const che = (v, sau = 0) => {
    if (sau > 12) return '…';
    if (typeof v === 'string') return nhan(v) || ('str(' + v.length + ')');
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
    if (Array.isArray(v)) return v.map((x) => che(x, sau + 1));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = che(v[k], sau + 1); return o; }
    return typeof v;
  };

  const bocRequest = (url, body) => {
    const u = new URL(url, location.origin);
    const p = new URLSearchParams(String(body || ''));
    const out = {
      path: u.pathname,
      query: Object.fromEntries([...u.searchParams.entries()].map(([k, v]) => [k, k === 'rpcids' || k === 'source-path' || k === 'rt' ? v : 'str(' + v.length + ')'])),
      queryKeys: [...u.searchParams.keys()],
      bodyKeys: [...p.keys()],
      atCoMat: p.has('at'),
      atDoDai: p.has('at') ? String(p.get('at')).length : 0,
      atHinhDang: p.has('at') ? String(p.get('at')).replace(/[A-Za-z]/g, 'a').replace(/[0-9]/g, '9').replace(/a{2,}/g, 'a…a').replace(/9{2,}/g, '9…9') : null,
      rpcId: null,
      params: null,
    };
    try {
      const freq = JSON.parse(p.get('f.req'));
      const goi = freq[0][0];
      out.rpcId = goi[0];
      out.params = che(JSON.parse(goi[1]));
      out.freqKhung = che(freq);
    } catch (e) { out.loiParse = String(e && e.message); }
    return out;
  };

  const bocResponse = (text) => {
    const t = String(text || '');
    const out = { coPrefix: t.trimStart().indexOf(")]}'") === 0, doDai: t.length, frames: [] };
    if (!out.coPrefix) {
      // KHÔNG che chỗ này thành 'str(60)': lúc phản hồi không phải batchexecute
      // thì "nó là cái gì" chính là điều duy nhất đáng biết. In *loại* nội dung
      // chứ không in nội dung.
      const dau = t.trimStart().slice(0, 40);
      out.trongNhu = /^<(!doctype|html)/i.test(dau) ? 'trang HTML (nhiều khả năng là màn đăng nhập)'
        : /^\s*[[{]/.test(dau) ? 'JSON trần, không có prefix batchexecute'
        : t.length === 0 ? 'thân rỗng'
        : 'không nhận ra';
      out.kyTuDau = dau.replace(/[^\s<>/!={}[\]",:;-]/g, '·');
      return out;
    }
    let i = t.indexOf(")]}'") + 4;
    for (;;) {
      const o = t.indexOf('[', i);
      if (o === -1) break;
      let d = 0, s = false, esc = false, end = -1;
      for (let k = o; k < t.length; k++) {
        const c = t[k];
        if (s) { if (esc) esc = false; else if (c === '\\\\') esc = true; else if (c === '"') s = false; continue; }
        if (c === '"') s = true; else if (c === '[') d++; else if (c === ']') { d--; if (!d) { end = k + 1; break; } }
      }
      if (end === -1) break;
      const raw = t.slice(o, end); i = end;
      let chunk = null; try { chunk = JSON.parse(raw); } catch { continue; }
      if (!Array.isArray(chunk)) continue;
      for (const fr of chunk) {
        if (!Array.isArray(fr)) continue;
        const item = { tag: fr[0], rpcId: typeof fr[1] === 'string' ? fr[1] : null };
        if (fr[0] === 'wrb.fr') {
          if (fr[2] == null) item.payload = null;
          else { try { item.payload = che(JSON.parse(fr[2])); } catch { item.payload = 'khong parse duoc, str(' + String(fr[2]).length + ')'; } }
        }
        out.frames.push(item);
      }
    }
    return out;
  };

  const ghi = (url, body, text) => {
    try { store.calls.push({ luc: new Date().toISOString(), req: bocRequest(url, body), res: bocResponse(text) }); } catch (_) {}
  };

  const of = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const batch = url.indexOf('batchexecute') !== -1;
    const body = batch && init && typeof init.body === 'string' ? init.body : null;
    const res = await of(input, init);
    if (batch) { try { ghi(url, body, await res.clone().text()); } catch (_) {} }
    return res;
  };

  const oOpen = XMLHttpRequest.prototype.open;
  const oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__u = String(u || ''); } catch (_) {} return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    try {
      if (String(this.__u || '').indexOf('batchexecute') !== -1) {
        const body = typeof b === 'string' ? b : null;
        this.addEventListener('load', () => ghi(this.__u, body, this.responseText));
      }
    } catch (_) {}
    return oSend.apply(this, arguments);
  };
  return 'da cai';
})()`;

/* ------------------------------------------------------------------ */

async function main() {
  await sleep(3500);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, S);
  await send('Runtime.enable', {}, S);

  const ev = async (expression, contextId) => {
    const r = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) },
      S
    );
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
    return r.result?.value;
  };

  // Cài trước cả khi trang chạy, và cài lại sau mỗi lần điều hướng: NotebookLM
  // là SPA nhưng owner vẫn có thể F5 giữa chừng.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER }, S);
  await send('Page.navigate', { url: START_URL }, S);
  await sleep(6000);
  await ev(RECORDER);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(` Trình duyệt: ${CHROME}`);
  console.log(` Hồ sơ:       ${PROFILE}   (GIỮ LẠI để lần sau khỏi đăng nhập)`);
  console.log('════════════════════════════════════════════════════════════════');
  console.log('\nBA BƯỚC BẮT BUỘC, trong cửa sổ vừa mở:\n');
  console.log('  1. Đăng nhập Google nếu nó hỏi.');
  console.log('  2. Tạo MỘT NOTEBOOK NHÁP mới (đừng dùng notebook thật — thêm Nguồn không');
  console.log('     hoàn tác được, phải xoá tay).');
  console.log('  3. Trong notebook nháp đó, thêm hai Nguồn bằng chính giao diện:\n');
  console.log(`       • loại "Trang web", dán URL:   ${MARKER.url}`);
  console.log(`       • loại "Văn bản đã sao chép":`);
  console.log(`           tiêu đề:  ${MARKER.title}`);
  console.log(`           nội dung: ${MARKER.text}`);
  console.log(`\n     (tuỳ chọn, nếu giao diện của bạn có nút YouTube riêng: ${MARKER.youtube})`);

  console.log('\nBA BƯỚC THÊM — mỗi bước gỡ một ticket đang chặn. Bỏ qua được, nhưng bỏ');
  console.log('bước nào thì ticket đó vẫn chặn, và cuối lượt script sẽ nói rõ thiếu cái gì.\n');
  console.log('  4. [ticket 012] XOÁ một trong hai Nguồn mốc vừa thêm, bằng chính giao diện');
  console.log('     NotebookLM (menu ba chấm trên thẻ Nguồn → Xoá).');
  console.log('     → bắt được `tGMBJ`, tức hình dạng thật của lệnh xoá. Script KHÔNG tự gửi');
  console.log('       lệnh xoá nào; nó chỉ nghe lệnh mà giao diện của Google gửi.');
  console.log('');
  console.log('  5. [ticket 008] Thử thêm HAI URL trong MỘT lần: mở lại "Trang web" và dán');
  console.log('     cả hai dòng dưới đây cùng lúc, rồi bấm thêm.');
  console.log(`         ${MARKER.url}/a`);
  console.log(`         ${MARKER.url}/b`);
  console.log('     → nếu giao diện chấp nhận, ta bắt được hình dạng BATCH thật, và ticket 008');
  console.log('       không còn phải tự gửi payload đoán mò lên notebook của bạn nữa.');
  console.log('     CHƯA KIỂM CHỨNG là giao diện có nhận nhiều URL một lần hay không — nếu ô');
  console.log('     chỉ nhận một dòng thì bỏ qua bước này, đó cũng là một kết quả.');
  console.log('');
  console.log('  6. [ticket 011] Bấm về trang chủ NotebookLM (logo góc trên) một lần.');
  console.log('     → bắt được `wXbhsf`, tức lệnh liệt kê notebook.');

  console.log('\nScript đang nghe. Mỗi lần bắt được một request batchexecute nó in ngay ra đây.');
  console.log(`Xong thì Ctrl-C. Tự dừng sau ${Math.round(CHO_TOI_DA_MS / 60000)} phút.\n`);

  // Mốc "đã in tới đâu" phải gồm CẢ thế hệ của bộ ghi, không chỉ số lượng.
  // `window.__nblmProbe` dựng lại từ đầu sau mỗi lần điều hướng; chỉ so số lượng
  // thì lần poll nào rơi vào lúc thế hệ mới đã dài bằng thế hệ cũ sẽ không nhận
  // ra gì cả, và những request ĐẦU TIÊN của trang mới biến mất không dấu vết.
  // Đo thật trên backend giả: mất đúng request mang chuỗi mốc URL.
  let gen = null;
  let daIn = 0;
  let tong = 0; // đánh số chạy suốt, không reset theo thế hệ — hai dòng "#1" liền
                // nhau sau một lần reload trông y như output bị lặp.
  const hetGio = Date.now() + CHO_TOI_DA_MS;
  const daThayMarker = new Set();
  const daThayRpc = new Set();
  let batchThay = null;   // hình dạng args của một lượt izAoDd mang từ 2 nguồn trở lên
  let hetAn = null;       // mốc hết thời gian ân hạn, đặt khi hai Nguồn mốc đã xong

  while (Date.now() < hetGio) {
    const raw = (await ev('JSON.stringify(window.__nblmProbe || null)')) || 'null';
    let store = null;
    try { store = JSON.parse(raw); } catch (_) { store = null; }
    const list = (store && Array.isArray(store.calls) ? store.calls : []);

    if (store && store.gen !== gen) {
      if (gen !== null) console.log('\n(trang đã tải lại — bộ ghi sang thế hệ mới, đang nghe tiếp)');
      gen = store.gen;
      daIn = 0;
    }

    for (let i = daIn; i < list.length; i++) {
      const c = list[i];
      const chuoi = JSON.stringify(c.req.params || null);
      for (const k of Object.keys(MARKER)) if (chuoi.includes(`MARKER:${k}`)) daThayMarker.add(k);
      const dangQuanTam = chuoi.includes('MARKER:');

      const rid = c.req.rpcId || (c.req.query && c.req.query.rpcids) || null;
      if (rid) for (const r of String(rid).split(',')) daThayRpc.add(r.trim());

      /*
       * Hình dạng BATCH của `izAoDd` — câu 1+2 của ticket 008. Bắt được ở đây
       * nghĩa là ticket đó không còn phải tự gửi payload đoán mò lên notebook
       * của owner: chính giao diện Google vừa gửi bản đúng, và ta chép hình
       * dạng chứ không chép giá trị.
       */
      const ps = c.req.params;
      if (c.req.rpcId === 'izAoDd' && Array.isArray(ps) && Array.isArray(ps[0]) && ps[0].length >= 2 && !batchThay) {
        batchThay = ps[0];
        console.log(`\n★★ BẮT ĐƯỢC HÌNH DẠNG BATCH (${ps[0].length} nguồn trong một izAoDd) — ticket 008`);
      }

      tong++;
      console.log(`\n── request #${tong}${dangQuanTam ? '   ★ CÓ CHUỖI MỐC' : ''}${rid ? '   [' + rid + ']' : ''}`);
      console.log(JSON.stringify(c, null, 2));
    }
    daIn = list.length;

    const xongNguonMoc = daThayMarker.has('url') && (daThayMarker.has('title') || daThayMarker.has('text'));
    const thieu = MUC_TIEU.filter((m) => !daThayRpc.has(m.id));

    if (xongNguonMoc && hetAn === null) {
      if (thieu.length === 0) {
        console.log('\n✅ Đã bắt đủ hai Nguồn mốc VÀ cả ba rpc id mục tiêu. Sang phần đo token.\n');
        break;
      }
      /*
       * KHÔNG thoát ngay khi hai Nguồn mốc đã xong — đó là hành vi cũ, và nó cắt
       * đúng lúc owner đang định làm bước 4/5/6. Nhưng cũng không chờ vô hạn:
       * bước 4-6 là tuỳ chọn, và một script treo im lặng thì owner sẽ Ctrl-C,
       * mất luôn phần đo token phía sau.
       */
      hetAn = Date.now() + CHO_THEM_MS;
      console.log(`\n✅ Hai Nguồn mốc xong. Còn thiếu: ${thieu.map((m) => m.id).join(', ')}.`);
      console.log(`   Đang chờ thêm ${Math.round(CHO_THEM_MS / 1000)} giây cho bước 4-6 — làm hay bỏ qua đều được.\n`);
    }

    if (hetAn !== null && (thieu.length === 0 || Date.now() > hetAn)) {
      if (thieu.length) console.log(`\n⏭  Hết giờ chờ. Vẫn thiếu: ${thieu.map((m) => m.id).join(', ')}. Đi tiếp.\n`);
      else console.log('\n✅ Đã bắt đủ cả ba rpc id mục tiêu. Sang phần đo token.\n');
      break;
    }

    await sleep(2000);
  }

  /* ---------------- token `at`: hai đường, đo cạnh nhau ---------------- */

  console.log('\n════════════ token `at` lấy được từ đường nào ════════════\n');

  const mainWorld = await ev(`(() => {
    const g = window.WIZ_global_data;
    if (!g || typeof g !== 'object') return { coBien: false };
    const shape = /^[A-Za-z0-9_-]{8,}:[0-9]{10,16}$/;
    return {
      coBien: true,
      soKhoa: Object.keys(g).length,
      khoaKhopHinhDang: Object.keys(g).filter((k) => typeof g[k] === 'string' && shape.test(g[k])),
    };
  })()`);
  console.log('MAIN world  (cần cầu nối kiểu src/youtube/page-bridge.js):');
  console.log('  ' + JSON.stringify(mainWorld));

  const { frameTree } = await send('Page.getFrameTree', {}, S);
  const { executionContextId } = await send(
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: 'nblm-probe-isolated' },
    S
  );

  // Nạp mã THẬT của extension vào đúng loại world mà content script chạy. Không
  // viết lại logic ở đây là chủ ý: một bản chép tay chỉ chứng nhận bản chép tay.
  await ev(
    `globalThis.chrome = globalThis.chrome || { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } } };`,
    executionContextId
  );
  for (const rel of [
    'src/common/shared.js',
    'src/notebooklm/selectors.js',
    'src/notebooklm/automation.js',
    'src/notebooklm/rpc.js',
  ]) {
    const r = await ev(fs.readFileSync(path.join(ROOT, rel), 'utf8'), executionContextId);
    if (r && r.__err) console.log(`  ⚠ nạp ${rel} lỗi: ${String(r.__err).slice(0, 160)}`);
  }

  const isolated = await ev(
    `(() => {
       const R = globalThis.NBLM_RPC;
       if (!R) return { napDuoc: false };
       const hit = R._internals.readAtToken(document, R.config);
       return {
         napDuoc: true,
         thayBienWIZ: typeof window.WIZ_global_data !== 'undefined',
         soScriptCoWIZ: [...document.querySelectorAll('script')].filter((s) => (s.textContent || '').includes('WIZ_global_data')).length,
         timDuocToken: !!hit,
         khoa: hit ? hit.key : null,
         doDai: hit ? hit.token.length : 0,
         nguon: hit ? hit.source : null,
       };
     })()`,
    executionContextId
  );
  console.log('\nISOLATED world (đúng thứ content script hiện có, KHÔNG cần cầu nối):');
  console.log('  ' + JSON.stringify(isolated));
  console.log(
    '\n→ `timDuocToken: true` ở dòng ISOLATED nghĩa là đường đọc <script> trong DOM đủ dùng,\n' +
      '  và không cần thêm content script MAIN world nào vào manifest.'
  );

  /* ---------------- danh sách Nguồn — cho ticket 005 ---------------- */

  console.log('\n════════════ danh sách Nguồn (ticket 005) ════════════\n');
  const nguon = await ev(
    `(() => {
       const A = globalThis.NBLM_AUTOMATION;
       if (!A) return { napDuoc: false };
       const n = A._internals.countSources();
       return { napDuoc: true, countSources: n, canBanChup: n === null };
     })()`,
    executionContextId
  );
  console.log('countSources() trên trang thật: ' + JSON.stringify(nguon));
  if (nguon && nguon.canBanChup) {
    const chup = await ev(
      `JSON.stringify(globalThis.NBLM_AUTOMATION._internals.pageStructure(document.body))`,
      executionContextId
    );
    console.log('\ncountSources() trả null → bản chụp cấu trúc trang (chỉ tên thẻ/class/nhãn):\n');
    console.log(typeof chup === 'string' ? chup : JSON.stringify(chup));
  } else {
    console.log('countSources() đọc được → hai mảng sourceList/sourceItem hiện đang ĐÚNG.');
  }

  console.log('\n════════════ bảng đối chiếu: lượt này gỡ được ticket nào ════════════\n');
  for (const m of MUC_TIEU) {
    const co = daThayRpc.has(m.id);
    console.log(`  [${co ? 'x' : ' '}] ${m.id.padEnd(8)} ticket ${m.ticket.padEnd(10)} ${m.vi}`);
  }
  console.log(`  [${batchThay ? 'x' : ' '}] batch    ticket 008        hình dạng args khi MỘT izAoDd mang nhiều nguồn`);

  const thieuCuoi = MUC_TIEU.filter((m) => !daThayRpc.has(m.id));
  if (thieuCuoi.length || !batchThay) {
    console.log('\nCòn thiếu — và thiếu là một kết quả hợp lệ, không phải lỗi của lượt chạy:');
    for (const m of thieuCuoi) console.log(`  • ${m.id}: ticket ${m.ticket} vẫn chặn. Bước tương ứng ở đầu lượt chưa chạy.`);
    if (!batchThay) {
      console.log('  • batch: không thấy izAoDd nào mang từ 2 nguồn trở lên.');
      console.log('    Nếu bạn ĐÃ thử bước 5 mà ô chỉ nhận một URL, thì đó là câu trả lời cho');
      console.log('    ticket 008: giao diện không batch, nên hình dạng batch chỉ còn hai oracle');
      console.log('    mâu thuẫn đỡ — và ticket đó phải chọn đường (C).');
    }
  } else {
    console.log('\nĐủ cả. Bốn dòng trên là toàn bộ dữ kiện mà 008/009/011/012 đang chờ.');
  }

  console.log('\n════════════ xong ════════════');
  console.log(`Hồ sơ trình duyệt còn ở ${PROFILE} — xoá tay nếu máy dùng chung.`);
  console.log('Nhớ xoá nốt mấy Nguồn mốc còn lại trong notebook nháp — bước 4 mới xoá một cái.\n');
}

main()
  .catch((e) => { console.error('\nlỗi:', (e && e.stack) || e); process.exitCode = 1; })
  .finally(() => chrome.kill('SIGKILL'));
