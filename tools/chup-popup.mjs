/*
 * Chụp popup THẬT bằng Brave headless, không phải jsdom.
 *
 * Vì sao tồn tại: `test/popup-ui.test.js` chạy trên jsdom, và jsdom **không có
 * cascade CSS** — nó dựng cây DOM đúng nhưng không biết cái gì thật sự nhìn
 * thấy được, cái gì tràn, cái gì chồng lên cái gì. Repo đã trả giá một lần cho
 * đúng chuyện này (nút "Dừng" vẫn hiện dù test xanh). Công cụ này là mắt.
 *
 * Nó KHÔNG gọi mạng và KHÔNG cần tài khoản: `chrome.*` được thay bằng một stub
 * tiêm trước mọi script của trang, trả về dữ liệu giả do ta chọn. Nên chụp được
 * cả những trạng thái khó dựng tay (5 tài khoản, 0 notebook, tên notebook dài...).
 *
 *   node tools/chup-popup.mjs                 # mọi cảnh
 *   node tools/chup-popup.mjs 2-tai-khoan     # một cảnh
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.anh-popup');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'nblm-chup-'));

/* ------------------------------------------------------------------ */
/* các cảnh cần nhìn                                                   */
/* ------------------------------------------------------------------ */

const nb = (id, title) => ({ id, title });

const CANH = {
  'chua-nap': {
    vi: 'Popup vừa mở — chưa ai bấm ↻. Ràng buộc cử chỉ của ticket 011.',
    accounts: null,
    notebooks: null,
  },
  '1-tai-khoan': {
    vi: 'Một tài khoản → hàng chọn tài khoản PHẢI ẩn (không cho quyết định gì).',
    accounts: { ok: true, selected: null, accounts: [{ email: 'chu@gmail.com', name: 'Chu', index: 0, isDefault: true }] },
    notebooks: { ok: true, needsTab: false, notebooks: [nb('a1', 'Ghi chép luận văn'), nb('b2', 'Đọc tuần này')], account: { source: 'tab', authuser: '0' } },
  },
  '2-tai-khoan': {
    vi: 'Hai tài khoản → hàng chọn hiện. Đây là ca ticket 013 sinh ra để giải.',
    accounts: {
      ok: true,
      selected: 'chu@gmail.com',
      accounts: [
        { email: 'chu@gmail.com', name: 'Chu', index: 0, isDefault: true },
        { email: 'congviec@congty.com.vn', name: 'Cong Viec', index: 1, isDefault: false },
      ],
    },
    notebooks: { ok: true, needsTab: false, notebooks: [nb('a1', 'Ghi chép luận văn'), nb('b2', 'Đọc tuần này')], account: { source: 'chosen', authuser: '0' } },
  },
  'mac-dinh-khong-biet': {
    vi: 'Chưa chọn tài khoản, không có tab → dùng authuser=0 và PHẢI nói ra.',
    accounts: { ok: false, accounts: [], selected: null },
    notebooks: { ok: true, needsTab: false, notebooks: [nb('a1', 'Sổ nào đó')], account: { source: 'default', authuser: '0' } },
  },
  'tai-khoan-bay-mat': {
    vi: 'Tài khoản đã chọn không còn đăng nhập — ca `chosen-missing`.',
    accounts: {
      ok: true,
      selected: 'da-dang-xuat@gmail.com',
      accounts: [{ email: 'chu@gmail.com', name: 'Chu', index: 0, isDefault: true },
                 { email: 'khac@gmail.com', name: 'Khac', index: 1, isDefault: false }],
    },
    notebooks: { ok: false, needsTab: false, notebooks: [], account: { source: 'chosen-missing', authuser: null } },
  },
  'khong-doc-duoc-tai-khoan': {
    vi: 'ListAccounts hỏng + đã chọn tài khoản — ngõ cụt cũ, giờ có nút Bỏ chọn.',
    accounts: { ok: false, selected: 'da-dang-xuat@gmail.com', accounts: [], status: 'network' },
    notebooks: { ok: false, needsTab: false, notebooks: [], account: { source: 'chosen-missing', authuser: null } },
  },
  'con-mot-tai-khoan': {
    vi: 'Chỉ còn một tài khoản, cái đã chọn đã đăng xuất — hàng chọn phải HIỆN.',
    accounts: { ok: true, selected: 'da-dang-xuat@gmail.com', accounts: [{ email: 'chu@gmail.com', name: 'Chu', index: 0, isDefault: true }] },
    notebooks: { ok: true, needsTab: false, notebooks: [], account: { source: 'chosen-missing', authuser: null } },
  },
  'do-hong-lang-le': {
    vi: 'ListAccounts đọc ra 0 tài khoản (status empty) — điều kiện đảo ngược 1 đang xảy ra.',
    accounts: { ok: true, selected: null, accounts: [], status: 'empty' },
    notebooks: { ok: true, needsTab: false, notebooks: [{ id: 'a1', title: 'Sổ nào đó' }], account: { source: 'default', authuser: '0' } },
  },
  'khong-co-notebook': {
    vi: 'Tài khoản mới, chưa có notebook nào → chỉ còn mục Tạo mới.',
    accounts: { ok: true, selected: null, accounts: [] },
    notebooks: { ok: true, needsTab: false, notebooks: [], account: { source: 'tab', authuser: '0' } },
  },
  'ten-dai': {
    vi: 'Tên notebook dài + email dài — chỗ tràn chỉ nhìn thấy bằng CSS thật.',
    accounts: {
      ok: true,
      selected: 'ten.tai.khoan.rat.dai.cua.toi@mot-cong-ty-co-ten-dai.com.vn',
      accounts: [
        { email: 'ten.tai.khoan.rat.dai.cua.toi@mot-cong-ty-co-ten-dai.com.vn', name: 'Dai', index: 0, isDefault: true },
        { email: 'ngan@gmail.com', name: 'Ngan', index: 1, isDefault: false },
      ],
    },
    notebooks: {
      ok: true, needsTab: false, account: { source: 'chosen', authuser: '0' },
      notebooks: [nb('a1', 'Tổng hợp tài liệu nghiên cứu về mô hình ngôn ngữ lớn và ứng dụng trong giáo dục đại học Việt Nam'), nb('b2', 'Ngắn')],
    },
  },
  'khong-co-tab': {
    vi: 'Không với tới được backend lẫn tab nào.',
    accounts: { ok: false, accounts: [], selected: null },
    notebooks: { ok: false, needsTab: true, notebooks: [], account: { source: 'default', authuser: '0' } },
  },
};

/* ------------------------------------------------------------------ */

const CHROME = process.env.CHROME_BIN || ['/usr/bin/brave', '/usr/bin/chromium', '/usr/bin/google-chrome-stable']
  .find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Không tìm thấy trình duyệt Chromium.'); process.exit(2); }

const proc = spawn(CHROME, [
  `--user-data-dir=${PROFILE}`, '--remote-debugging-pipe', '--headless=new',
  '--hide-scrollbars', '--force-device-scale-factor=2',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: ['ignore', 'ignore', 'inherit', 'pipe', 'pipe'] });

const [, , , wr, rd] = proc.stdio;
let id = 0, buf = Buffer.alloc(0);
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

/** Stub `chrome.*` tiêm TRƯỚC mọi script của trang. */
function stub(canh) {
  return `
  (() => {
    const CANH = ${JSON.stringify(canh)};
    const SETTINGS = { notebookUrl: '', nlmAccount: CANH.accounts && CANH.accounts.selected || null };
    globalThis.chrome = {
      runtime: {
        id: 'chup',
        getURL: (p) => p,
        lastError: null,
        /* Popup goi sendMessage(msg) KIEU PROMISE (popup.js:63), khong callback.
           Stub chi co nhanh callback thi moi luot await nhan undefined va moi
           canh roi vao cung mot nhanh "khong co tab" -- do that: 7 anh trung byte.
           (Khong dau va khong backtick: doan nay nam trong template literal.) */
        sendMessage: (msg, cb) => {
          let r = { ok: true };
          if (msg.type === 'list-accounts') r = CANH.accounts || { ok: false, accounts: [], selected: null };
          if (msg.type === 'list-notebooks') r = CANH.notebooks || { ok: false, needsTab: true, notebooks: [] };
          if (msg.type === 'get-state') r = { ok: true, running: false, queue: [], counts: {} };
          if (cb) { setTimeout(() => cb(r), 0); return; }
          return Promise.resolve(r);
        },
        onMessage: { addListener() {}, removeListener() {} },
      },
      storage: {
        local: {
          get: (k, cb) => { const out = { settings: SETTINGS }; return cb ? cb(out) : Promise.resolve(out); },
          set: (o, cb) => { Object.assign(SETTINGS, (o && o.settings) || {}); return cb ? cb() : Promise.resolve(); },
          remove: (k, cb) => (cb ? cb() : Promise.resolve()),
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      tabs: { query: (q, cb) => (cb ? cb([]) : Promise.resolve([])), sendMessage: (i, m, cb) => cb && cb({ ok: true }) },
    };
  })();`;
}

const chon = process.argv[2];
const danhSach = Object.entries(CANH).filter(([k]) => !chon || k === chon);
if (!danhSach.length) { console.error(`Không có cảnh "${chon}". Có: ${Object.keys(CANH).join(', ')}`); process.exit(2); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const URL_POPUP = 'file://' + path.join(ROOT, 'src/popup/popup.html');

await send('Target.setDiscoverTargets', { discover: true });

for (const [ten, canh] of danhSach) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, S);
  await send('Runtime.enable', {}, S);
  await send('Emulation.setDeviceMetricsOverride',
    { width: 400, height: 640, deviceScaleFactor: 2, mobile: false }, S);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(canh) }, S);
  console.log(`  ${ten.padEnd(22)} ${canh.vi}`);
  await send('Page.navigate', { url: URL_POPUP }, S);
  await new Promise((r) => setTimeout(r, 900));

  // Bấm ↻ cho những cảnh có dữ liệu — ràng buộc cử chỉ nghĩa là không tự nạp.
  if (canh.notebooks) {
    await send('Runtime.evaluate', {
      expression: `document.getElementById('notebook-refresh').click()`, awaitPromise: false,
    }, S);
    await new Promise((r) => setTimeout(r, 700));
  }

  if (process.env.DOM) {
    const d = await send('Runtime.evaluate', { expression: `JSON.stringify({
      acctHidden: document.getElementById('notebook-account-row').hidden,
      acctValue: document.getElementById('account-select').value,
      acctIndex: document.getElementById('account-select').selectedIndex,
      acctOpts: [...document.getElementById('account-select').options].map(o => o.textContent),
      nbOpts: [...document.getElementById('notebook-select').options].map(o => o.textContent),
      note: document.getElementById('account-note').hidden ? null : document.getElementById('account-note').textContent,
    })`, returnByValue: true }, S);
    console.log('    ' + d.result.value);
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, S);
  fs.writeFileSync(path.join(OUT, `${ten}.png`), Buffer.from(data, 'base64'));
  await send('Target.closeTarget', { targetId });
}

console.log(`\nẢnh trong ${path.relative(ROOT, OUT)}/`);
proc.kill();
process.exit(0);
