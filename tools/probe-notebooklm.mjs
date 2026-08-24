#!/usr/bin/env node
/*
 * Đo BA thứ mà chỉ tab NotebookLM đã đăng nhập của owner mới trả lời được, và
 * `src/notebooklm/rpc.js` hiện đang phải ĐOÁN:
 *
 *   1. rpc id thật của "thêm nguồn", và đường batchexecute thật.
 *   2. Hình dạng thật của `f.req` — cụ thể là URL / tiêu đề / nội dung rơi vào
 *      ô số mấy trong `params[0]`, và mã loại nguồn là số nào.
 *   3. Token `at` lấy được từ đường nào: đọc chữ của <script> trong DOM (đường
 *      mà content script ISOLATED world dùng được), hay bắt buộc phải có cầu nối
 *      MAIN world kiểu `src/youtube/page-bridge.js`.
 *
 * Tiện thể dump luôn cấu trúc DANH SÁCH NGUỒN cho `docs/tickets/005-*.md`, vì
 * nó nằm trong cùng một phiên đăng nhập và không tốn thêm thao tác nào.
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
  console.log('\nLÀM THEO ĐÚNG BA BƯỚC, trong cửa sổ vừa mở:\n');
  console.log('  1. Đăng nhập Google nếu nó hỏi.');
  console.log('  2. Tạo MỘT NOTEBOOK NHÁP mới (đừng dùng notebook thật — thêm Nguồn không');
  console.log('     hoàn tác được, phải xoá tay).');
  console.log('  3. Trong notebook nháp đó, thêm hai Nguồn bằng chính giao diện:\n');
  console.log(`       • loại "Trang web", dán URL:   ${MARKER.url}`);
  console.log(`       • loại "Văn bản đã sao chép":`);
  console.log(`           tiêu đề:  ${MARKER.title}`);
  console.log(`           nội dung: ${MARKER.text}`);
  console.log(`\n     (tuỳ chọn, nếu giao diện của bạn có nút YouTube riêng: ${MARKER.youtube})\n`);
  console.log('Script đang nghe. Mỗi lần bắt được một request batchexecute nó in ngay ra đây.');
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
      tong++;
      console.log(`\n── request #${tong}${dangQuanTam ? '   ★ CÓ CHUỖI MỐC' : ''}`);
      console.log(JSON.stringify(c, null, 2));
    }
    daIn = list.length;

    if (daThayMarker.has('url') && (daThayMarker.has('title') || daThayMarker.has('text'))) {
      console.log('\n✅ Đã bắt được cả nguồn URL lẫn nguồn văn bản. Sang phần đo token và danh sách Nguồn.\n');
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

  console.log('\n════════════ xong ════════════');
  console.log(`Hồ sơ trình duyệt còn ở ${PROFILE} — xoá tay nếu máy dùng chung.`);
  console.log('Nhớ xoá mấy Nguồn mốc trong notebook nháp (thêm Nguồn không hoàn tác được).\n');
}

main()
  .catch((e) => { console.error('\nlỗi:', (e && e.stack) || e); process.exitCode = 1; })
  .finally(() => chrome.kill('SIGKILL'));
