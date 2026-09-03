/*
 * Đường lùi của hai lượt gốc, phía service worker. Ticket `docs/tickets/013-*.md`.
 *
 * Đây là phần TỰ SOÁT của ticket 013 — không có review seat độc lập, nên hai
 * khuyết tật dưới đây là do đọc lại chính code vừa viết mà ra:
 *
 *   1. `createNotebook` lùi sang đường tab MÙ QUÁNG. `created-but-no-id` nghĩa
 *      là notebook có thể đã tạo xong rồi; lùi lúc đó là tạo cái THỨ HAI, và
 *      owner phải xoá tay. Tạo notebook không idempotent, y như thêm Nguồn.
 *   2. Đường lùi nhận BẤT KỲ tab NotebookLM nào. Owner chọn tài khoản A, còn
 *      danh sách trả về là của tài khoản B ở tab đang mở — im lặng.
 *
 * Test nạp service worker THẬT qua `importScripts` giả lập, y như
 * `service-worker-done.test.js`, và lái nó bằng tin nhắn qua router.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

/* ---------- trạng thái điều khiển được, đọc bởi các stub ---------- */

const S = {
  tabs: [],
  /** Trả lời cho `fetch`; hàm nhận URL. */
  fetch: async () => ({ ok: false, status: 500, text: async () => '' }),
  /** Trả lời cho `sendMessage` tới tab; null = chưa ai gọi. */
  tabReply: null,
  tabCalls: [],
};

const AT_HTML = '<script>window.WIZ={"SNlM0e":"TOKEN","cfb2h":"boq"};</script>';
const res = (body, okFlag) => ({ ok: okFlag !== false, status: okFlag === false ? 500 : 200, text: async () => body });

/** Một tài khoản, dựng theo đúng bản mô tả chứ không gõ tay ô số. */
function accountsBody(A, email, index) {
  const s = A.config.accountSlots;
  const row = [];
  row[s.marker] = A.config.accountMarker;
  row[s.name] = 'Chu So Huu';
  row[s.email] = email;
  row[s.isDefault] = 1;
  row[s.index] = index;
  return JSON.stringify([[row]]);
}

const envelope = (frames) => {
  const json = JSON.stringify(frames);
  return `)]}'\n\n${json.length}\n${json}\n`;
};
const wrb = (rpcId, payload) => ['wrb.fr', rpcId, payload === null ? null : JSON.stringify(payload), null, null, null, 'generic'];

/* ---------- stub chrome ---------- */

const MSG_PING = 'nlm-ping'; // dùng trước khi `self.NBLM` tồn tại, nên viết thẳng
const noopEvent = () => ({ addListener() {}, removeListener() {} });
const store = new Map();
let onMessage = null;

global.self = global;
global.fetch = (u, i) => S.fetch(String(u), i);
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://test/${p}`,
    onInstalled: noopEvent(),
    onMessage: { addListener: (fn) => (onMessage = fn), removeListener() {} },
    sendMessage: async () => ({}),
    lastError: null,
  },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return Object.fromEntries(store);
        const out = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, v); },
      async remove(k) { store.delete(k); },
    },
    onChanged: noopEvent(),
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: noopEvent() },
  commands: { onCommand: noopEvent() },
  contextMenus: { create() {}, removeAll: (cb) => cb && cb(), onClicked: noopEvent() },
  notifications: { create: async () => {} },
  scripting: { executeScript: async () => [{ result: true }] },
  downloads: { download: async () => 1, search: async () => [], onChanged: noopEvent() },
  tabs: {
    query: async (q) =>
      String((q && q.url) || '').includes('notebooklm') ? S.tabs.slice() : [],
    create: async ({ url }) => ({ id: 9, url, status: 'complete' }),
    update: async (id, { url }) => ({ id, url }),
    get: async (id) => ({ id, status: 'complete', url: (S.tabs.find((t) => t.id === id) || {}).url }),
    remove: async () => {},
    /* Chữ ký CALLBACK, không phải promise: `sendToTab` dùng callback và đọc
       `chrome.runtime.lastError`. Stub kiểu promise thì mọi lượt lùi đều rơi
       vào nhánh timeout và test xanh vì lý do sai. */
    sendMessage: (id, msg, cb) => {
      // Ping của `ensureScripts` trả lời riêng: gộp nó vào S.tabCalls thì phép
      // đếm "có lùi sang đường tab không" đếm nhầm cả bước dò script.
      if (msg && msg.type === MSG_PING) { setTimeout(() => cb && cb({ ok: true }), 0); return; }
      S.tabCalls.push({ id, msg });
      setTimeout(() => cb && cb(S.tabReply), 0);
    },
    onUpdated: noopEvent(),
    onRemoved: noopEvent(),
  },
  windows: { create: async () => ({ id: 1 }) },
  offscreen: { createDocument: async () => {}, closeDocument: async () => {}, hasDocument: async () => false },
};
global.importScripts = (...files) => files.forEach((f) => require(path.join(ROOT, f)));

require(path.join(ROOT, 'src/background/service-worker.js'));

const MSG = self.NBLM.MSG;
const ACC = self.NBLM_ACCOUNTS;
const RPC = self.NBLM_RPC;

/** Gửi một tin qua router thật và đợi câu trả lời. */
function send(message) {
  return new Promise((resolve) => {
    onMessage(message, { tab: null }, resolve);
  });
}

async function reset() {
  store.clear();
  S.tabs = [];
  S.tabReply = null;
  S.tabCalls = [];
  ACC._internals.resetMemo();
  await self.NBLM.setSettings({ nlmAccount: null });
}

(async () => {
  ok(typeof onMessage === 'function', 'service worker đã đăng ký router');
  /* MSG_PING gõ tay vì stub cần nó trước khi `self.NBLM` tồn tại. Neo lại ngay:
     đổi tên hằng mà không sửa stub thì ping rơi vào nhánh trả lời thường, và
     phép đếm "có lùi sang đường tab không" xanh vì lý do sai ở CẢ BA ca C/D/E. */
  ok(MSG_PING === MSG.NLM_PING, 'MSG_PING trong stub khớp hằng thật của repo');

  /* ---------------------------------------------------------------- */
  /* A. Khuyết tật 1 — lùi mù quáng thì tạo notebook thứ hai            */
  /* ---------------------------------------------------------------- */
  {
    await reset();
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc123' }];
    S.tabReply = { ok: true, notebookId: 'TAB-TAO-CAI-THU-HAI' };

    const E = RPC.config.createNotebook;
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 0));
      if (u.includes('batchexecute')) return res(envelope([wrb(E.rpcId, [12345])])); // tạo XONG, không đọc được id
      return res(AT_HTML);
    };

    const r = await send({ type: MSG.CREATE_NOTEBOOK, title: 'Sổ mới' });
    ok(r.status === 'created-but-no-id', 'A: trạng thái "có thể đã tạo" đi thẳng ra ngoài');
    ok(S.tabCalls.length === 0, 'A: KHÔNG lùi sang đường tab — lùi là tạo notebook thứ hai');
    ok(r.ok === false, 'A: không báo thành công khi không đọc được id');
    ok(!store.has('settings') || !(store.get('settings') || {}).notebookUrl,
      'A: không ghi notebookUrl khi không có id thật');
  }

  /* ---------------------------------------------------------------- */
  /* B. Lùi VẪN xảy ra khi chứng minh được là chưa gửi gì               */
  /* ---------------------------------------------------------------- */
  {
    await reset();
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc123' }];
    S.tabReply = { ok: true, notebookId: 'ID-TU-DUONG-TAB' };
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 0));
      return res('<html>không có token nào</html>'); // no-at-token = chưa gửi byte nào
    };

    const r = await send({ type: MSG.CREATE_NOTEBOOK, title: 'Sổ mới' });
    ok(S.tabCalls.length === 1, 'B: chưa gửi gì thì CÓ lùi sang đường tab');
    ok(r.ok === true && r.notebookId === 'ID-TU-DUONG-TAB', 'B: đường tab tạo được thì báo thành công');
    ok((store.get('settings') || {}).notebookUrl.includes('ID-TU-DUONG-TAB'), 'B: ghi notebookUrl từ id thật');
  }

  /* ---------------------------------------------------------------- */
  /* C. Khuyết tật 2 — đường lùi không được nhận tab khác tài khoản     */
  /* ---------------------------------------------------------------- */
  {
    await reset();
    await self.NBLM.setSettings({ nlmAccount: 'chu@gmail.com' });
    // Owner nhắm tài khoản index 1; tab đang mở là tài khoản 0.
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc?authuser=0' }];
    S.tabReply = { ok: true, notebooks: [{ id: 'CUA-TAI-KHOAN-0', title: 'Sổ của người khác' }] };
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 1));
      return res('<html>không có token</html>'); // đường thẳng hỏng → buộc phải lùi
    };

    const r = await send({ type: MSG.LIST_NOTEBOOKS });
    ok(S.tabCalls.length === 0, 'C: tab khác authuser thì KHÔNG hỏi nó');
    ok(!r.notebooks.some((n) => n.id === 'CUA-TAI-KHOAN-0'),
      'C: không trả về notebook của tài khoản khác');
    ok(r.needsTab === true, 'C: nói ra là thiếu tab đúng tài khoản, chứ không im lặng đưa nhầm');
    ok(r.account && r.account.authuser === '1', 'C: câu trả lời mang theo tài khoản đang nhắm');
  }

  /* ---------------------------------------------------------------- */
  /* D. Cùng tài khoản thì lùi bình thường                              */
  /* ---------------------------------------------------------------- */
  {
    await reset();
    await self.NBLM.setSettings({ nlmAccount: 'chu@gmail.com' });
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc?authuser=1' }];
    S.tabReply = { ok: true, notebooks: [{ id: 'DUNG-TAI-KHOAN', title: 'Sổ của tôi' }] };
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 1));
      return res('<html>không có token</html>');
    };

    const r = await send({ type: MSG.LIST_NOTEBOOKS });
    ok(S.tabCalls.length === 1, 'D: tab đúng authuser thì lùi được');
    ok(r.notebooks[0] && r.notebooks[0].id === 'DUNG-TAI-KHOAN', 'D: trả về danh sách của đúng tài khoản');
  }

  /* ---------------------------------------------------------------- */
  /* E. Tài khoản đã chọn không còn đăng nhập                           */
  /* ---------------------------------------------------------------- */
  {
    await reset();
    await self.NBLM.setSettings({ nlmAccount: 'da-dang-xuat@gmail.com' });
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc?authuser=0' }];
    S.tabReply = { ok: true, notebooks: [{ id: 'CUA-NGUOI-KHAC', title: 'x' }] };
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 0));
      return res(AT_HTML);
    };

    const r = await send({ type: MSG.LIST_NOTEBOOKS });
    ok(S.tabCalls.length === 0, 'E: tài khoản đã chọn biến mất → không hỏi tab nào');
    ok(r.ok === false && r.account.source === 'chosen-missing', 'E: có trạng thái RIÊNG cho ca này');
    ok(r.notebooks.length === 0, 'E: không trả notebook của ai khác');
  }

  /* ---------------------------------------------------------------- */
  /* F. Đổi tài khoản thì vứt ngữ cảnh cũ                               */
  /* ---------------------------------------------------------------- */
  {
    await reset();
    S.fetch = async () => res(AT_HTML);
    await ACC.getRpcContext('0');
    ok(store.get(ACC.CTX_KEY) != null, 'F: có ngữ cảnh trên đĩa trước khi đổi');
    const r = await send({ type: MSG.SELECT_ACCOUNT, email: 'Ai.Do@Gmail.COM' });
    ok(r.selected === 'ai.do@gmail.com', 'F: email hạ về chữ thường ở đúng một chỗ');
    ok((store.get('settings') || {}).nlmAccount === 'ai.do@gmail.com', 'F: lựa chọn được lưu');
    ok(store.get(ACC.CTX_KEY) === undefined, 'F: đổi tài khoản thì ngữ cảnh cũ bị vứt');
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
