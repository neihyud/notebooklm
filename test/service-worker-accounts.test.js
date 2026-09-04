/*
 * Đường lùi của hai lượt gốc, phía service worker. Ticket `docs/tickets/013-*.md`.
 *
 * Ca A–E là phần TỰ SOÁT của ticket 013 — hai khuyết tật dưới đây do đọc lại
 * chính code vừa viết mà ra. Ca F–J đến từ review seat ĐỘC LẬP chạy sau đó
 * (2026-09-04), và nó tìm ra chỗ mà lượt tự soát bỏ sót hoàn toàn: cả A–E chỉ
 * canh đường LIỆT KÊ, còn đường IMPORT — đường thật sự ghi Nguồn — không bị
 * ghim tài khoản chút nào. Đúng hình dạng "đường dữ liệu song song":
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
  /** Mọi lượt điều hướng tab: `{how:'create'|'update', url}`. */
  nav: [],
  /** Tiêu đề mọi thông báo hệ thống. */
  notes: [],
  /** Trả lời cho `NLM_PING`. `inNotebook` thiếu → 4 nhịp ngủ 1s trong SW. */
  pingReply: { ok: true, inNotebook: true },
  /** Mọi lượt `batchexecute` đi ra: `{url, body}`. */
  posts: [],
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
const storageListeners = [];
let onMessage = null;

global.self = global;
global.fetch = (u, i) => {
  if (String(u).includes('batchexecute')) S.posts.push({ url: String(u), body: String((i && i.body) || '') });
  return S.fetch(String(u), i);
};
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
      async set(o) {
        // Phát `onChanged` như Chrome thật. Không phát thì đường "ghi thẳng
        // nlmAccount xuống settings" (trang Cài đặt) không tồn tại lúc test, và
        // mọi khẳng định về nó xanh vì không có gì chạy.
        const ch = {};
        for (const [k, v] of Object.entries(o)) {
          ch[k] = { oldValue: store.get(k), newValue: v };
          store.set(k, v);
        }
        for (const fn of storageListeners) fn(ch, 'local');
      },
      async remove(k) { store.delete(k); },
    },
    onChanged: { addListener: (fn) => storageListeners.push(fn), removeListener() {} },
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: noopEvent() },
  commands: { onCommand: noopEvent() },
  contextMenus: { create() {}, removeAll: (cb) => cb && cb(), onClicked: noopEvent() },
  /*
   * Giữ CẢ `message`, không chỉ `title`. Tiêu đề chỉ nói "không chạy được";
   * toàn bộ lời chẩn đoán — chưa gửi gì chưa, thử lại có an toàn không, làm gì
   * tiếp — nằm trong thân. Bản trước vứt thân đi, nên mọi ca chỉ ghim được là
   * CÓ báo, không ghim được là báo ĐÚNG.
   */
  notifications: {
    create: async (o) => { S.notes.push({ title: (o && o.title) || '', message: (o && o.message) || '' }); },
  },
  scripting: { executeScript: async () => [{ result: true }] },
  downloads: { download: async () => 1, search: async () => [], onChanged: noopEvent() },
  tabs: {
    query: async (q) =>
      String((q && q.url) || '').includes('notebooklm') ? S.tabs.slice() : [],
    create: async ({ url }) => { S.nav.push({ how: 'create', url }); return { id: 9, url, status: 'complete' }; },
    update: async (id, { url }) => { S.nav.push({ how: 'update', id, url }); return { id, url }; },
    get: async (id) => ({ id, status: 'complete', url: (S.tabs.find((t) => t.id === id) || {}).url }),
    remove: async () => {},
    /* Chữ ký CALLBACK, không phải promise: `sendToTab` dùng callback và đọc
       `chrome.runtime.lastError`. Stub kiểu promise thì mọi lượt lùi đều rơi
       vào nhánh timeout và test xanh vì lý do sai. */
    sendMessage: (id, msg, cb) => {
      // Ping của `ensureScripts` trả lời riêng: gộp nó vào S.tabCalls thì phép
      // đếm "có lùi sang đường tab không" đếm nhầm cả bước dò script.
      if (msg && msg.type === MSG_PING) { setTimeout(() => cb && cb(S.pingReply), 0); return; }
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
  S.nav = [];
  S.notes = [];
  S.pingReply = { ok: true, inNotebook: true };
  S.posts = [];
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
  /* A–B. Lượt TẠO notebook, đo qua đúng đường production của nó        */
  /* ---------------------------------------------------------------- */
  /*
   * Lái bằng `MSG.RUN` với `notebookUrl` RỖNG, chứ không bằng một message tạo
   * riêng. Rỗng nay nghĩa là "+ Tạo notebook mới", và `dichCuaLuotChay` thi
   * hành nó ngay trước vòng lặp hàng đợi — đây là bên gọi DUY NHẤT còn lại của
   * `createNotebook`.
   *
   * Trước đó hai ca này gọi `create-notebook`, message mà nút "Tạo" trong popup
   * gửi. Nút ấy đã bỏ cùng ô đặt tên (owner chốt 2026-09-04), message thành
   * code chết, và một test lái qua code chết thì chứng nhận một đường không ai
   * đi — xanh mãi mãi kể cả khi đường thật hỏng.
   */
  {
    // A. `created-but-no-id`: notebook CÓ THỂ đã tồn tại trên tài khoản.
    await reset();
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc123' }];
    S.tabReply = { ok: true, notebookId: 'TAB-TAO-CAI-THU-HAI' };

    const E = RPC.config.createNotebook;
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 0));
      if (u.includes('batchexecute')) return res(envelope([wrb(E.rpcId, [12345])])); // tạo XONG, không đọc được id
      return res(AT_HTML);
    };

    await chayRong();
    ok(S.tabCalls.length === 0, 'A: KHÔNG lùi sang đường tab — lùi là tạo notebook thứ hai');
    ok(!(store.get('settings') || {}).notebookUrl,
      `A: không ghi notebookUrl khi không có id thật, nhận: ${JSON.stringify((store.get('settings') || {}).notebookUrl)}`);
    ok(S.nav.length === 0, 'A: và không điều hướng tab nào đi nhận Nguồn');

    // Câu báo phải chặn cú "thử lại" — tạo notebook KHÔNG idempotent, nên thử
    // lại ở đây là đẻ ra cái thứ hai mà owner phải tự xoá.
    const noi = S.notes.map((t) => `${t.title} ${t.message}`).join(' | ');
    ok(/không đọc được id/.test(noi), `A: nói ra đúng chế độ hỏng, nhận: ${JSON.stringify(noi)}`);
    ok(/chưa gửi Nguồn nào/.test(noi), `A: và nói rõ chưa gửi gì, nhận: ${JSON.stringify(noi)}`);
    ok(/tạo thêm|đừng chạy lại/.test(noi), `A: và can cú chạy lại, nhận: ${JSON.stringify(noi)}`);
  }

  {
    // B. `no-at-token` = chứng minh được chưa byte nào rời máy → lùi là an toàn.
    await reset();
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc123' }];
    S.tabReply = { ok: true, notebookId: 'ID-TU-DUONG-TAB' };
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 0));
      return res('<html>không có token nào</html>'); // no-at-token = chưa gửi byte nào
    };

    await chayRong();
    ok(S.tabCalls.length === 1, 'B: chưa gửi gì thì CÓ lùi sang đường tab');
    ok(S.nav.some((n) => (n.url || '').includes('ID-TU-DUONG-TAB')),
      `B: lượt chạy đi vào ĐÚNG notebook vừa tạo, nhận: ${JSON.stringify(S.nav)}`);

    /*
     * KHÔNG ghi xuống settings — và đây là cái neo của quyết định "tạo lúc bấm
     * Chạy". Ghi vào thì đích tự đổi thành sổ vừa tạo, nên lượt Chạy SAU đi vào
     * đó thay vì tạo cái mới: lựa chọn "+ Tạo notebook mới" bị chính lượt chạy
     * đầu tiên ăn mất, im lặng, và "luôn tạo mới" thành "gửi hết vào một sổ".
     */
    ok(!(store.get('settings') || {}).notebookUrl,
      `B: tạo hộ thì KHÔNG được ghi đè đích của owner, nhận: ${JSON.stringify((store.get('settings') || {}).notebookUrl)}`);
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

  /* ---------------------------------------------------------------- */
  /* F–I. ĐƯỜNG IMPORT — đường thật sự GHI, seat review tìm ra là hở    */
  /* ---------------------------------------------------------------- */
  /*
   * Ca A–E ở trên chỉ canh đường liệt kê/tạo. `resolveNotebookTab` — hàm mà
   * mỗi lượt Chạy dùng để chọn tab nhận Nguồn — nhận BẤT KỲ tab notebooklm nào,
   * nên owner chọn `b@` mà đang mở tab `a@` thì Nguồn vào thẳng `a@`, im lặng.
   *
   * Lái bằng hàng đợi RỖNG: `resolveNotebookTab()` chạy đủ (nó nằm TRƯỚC vòng
   * lặp), rồi vòng lặp thoát ngay vì không có Mục nào. Quan sát bằng lượt điều
   * hướng tab, chứ không bằng giá trị trả về — tác động mới là thứ cần ghim.
   */

  /** Một lượt Chạy trên hàng đợi rỗng; trả về khi runner đã xong. */
  async function chayRong() {
    await self.NBLM.setQueue([]);
    S.notes = [];
    await send({ type: MSG.RUN });
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, 10));
      if (store.get('running') === false) return;
    }
    throw new Error('lượt chạy không kết thúc trong 4s — phép đo không dùng được');
  }

  const CHON_1 = async (email) => {
    await self.NBLM.setSettings({ nlmAccount: email, notebookUrl: 'https://notebooklm.google.com/notebook/abc' });
    S.fetch = async (u) => (u.includes('ListAccounts') ? res(accountsBody(ACC, email, 1)) : res('<html></html>'));
  };

  {
    // F. Tab đang mở là của tài khoản 0; owner nhắm tài khoản 1. KHÔNG được
    // giao Nguồn cho tab đó — đây đúng là ca ghi vào nhầm tài khoản.
    await reset();
    await CHON_1('chu@gmail.com');
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc' }];
    await chayRong();
    ok(!S.nav.some((n) => n.how === 'update' && n.id === 7),
      'F: KHÔNG điều hướng tab của tài khoản khác đi làm việc hộ');
    ok(S.nav.some((n) => /[?&]authuser=1(&|$)/.test(n.url || '')),
      `F: mở notebook đích kèm authuser=1, nhận: ${JSON.stringify(S.nav)}`);
  }

  {
    // G. Đúng tài khoản và đúng notebook thì dùng lại tab, không điều hướng gì.
    await reset();
    await CHON_1('chu@gmail.com');
    S.tabs = [{ id: 8, url: 'https://notebooklm.google.com/notebook/abc?authuser=1' }];
    await chayRong();
    ok(S.nav.length === 0, `G: tab đúng tài khoản + đúng notebook thì dùng lại, nhận: ${JSON.stringify(S.nav)}`);
  }

  {
    // H. Tài khoản đã chọn không còn đăng nhập: dừng TRƯỚC khi chạm tab nào.
    // Lùi về `0` ở đây là ghi Nguồn vào tài khoản mặc định trong im lặng.
    await reset();
    await self.NBLM.setSettings({ nlmAccount: 'da-dang-xuat@gmail.com', notebookUrl: 'https://notebooklm.google.com/notebook/abc' });
    S.fetch = async (u) => (u.includes('ListAccounts') ? res(accountsBody(ACC, 'chu@gmail.com', 1)) : res('<html></html>'));
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc' }];
    await chayRong();
    ok(S.nav.length === 0, 'H: tài khoản đã đăng xuất thì không điều hướng tab nào');
    ok(S.tabCalls.length === 0, 'H: và không hỏi tab nào');
    ok(S.notes.some((t) => t.title.includes('Không chạy được hàng đợi')),
      `H: nói ra là không chạy được, nhận: ${JSON.stringify(S.notes)}`);
  }

  {
    // I. CHƯA chọn tài khoản — hành vi phải y như trước ticket 013. Đây là
    // điều kiện đảo ngược số 1: ListAccounts hỏng thì ta lùi chứ không hỏng.
    await reset();
    await self.NBLM.setSettings({ nlmAccount: null, notebookUrl: 'https://notebooklm.google.com/notebook/abc' });
    S.fetch = async () => res('', false);
    S.tabs = [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc' }];
    await chayRong();
    ok(S.nav.length === 0, `I: chưa chọn tài khoản thì dùng tab đang mở như cũ, nhận: ${JSON.stringify(S.nav)}`);
    ok(!S.notes.some((t) => t.title.includes('Không chạy được hàng đợi')), 'I: và KHÔNG chặn lượt chạy');
  }

  {
    // J. Chưa chọn tài khoản, nhưng HAI tài khoản cùng mở. `resolveAuthuser`
    // chỉ SUY RA `authuser` từ tab đầu tiên nói ra nó — đó là quan sát, không
    // phải ý định của owner. Ghim theo suy đoán đó sẽ loại đúng cái tab đang
    // mở notebook đích, rồi kéo tab của tài khoản KHÁC đi làm việc hộ.
    //
    // Ca I không phân biệt được chuyện này: ở đó tab trần và `default` cùng
    // quy về '0' nên lọc giữ nguyên. Đo ra là 0 đỏ, nên mới có ca J.
    await reset();
    await self.NBLM.setSettings({ nlmAccount: null, notebookUrl: 'https://notebooklm.google.com/notebook/xyz' });
    S.fetch = async () => res('', false);
    S.tabs = [
      { id: 5, url: 'https://notebooklm.google.com/notebook/abc?authuser=1' },
      { id: 6, url: 'https://notebooklm.google.com/notebook/xyz' },
    ];
    await chayRong();
    ok(S.nav.length === 0,
      `J: dùng đúng tab đang mở notebook đích, không kéo tab tài khoản khác, nhận: ${JSON.stringify(S.nav)}`);
  }

  {
    /*
     * K. CẶP #14 — token `at` và `authuser` phải luôn thuộc CÙNG một tài khoản.
     *
     * Trước ca này, cả file chỉ phát ra đúng MỘT request batchexecute và nó
     * mang `authuser=0`; ba ca C/D/E dựng tài khoản index 1 nhưng đều chết ở
     * `no-at-token` TRƯỚC khi có byte nào rời máy. Nên hoán vị
     * `authuser: ctx.authuser` → `'0'` đo ra 0 đỏ trên cả 1561 assertion: gửi
     * token của tài khoản 1 kèm authuser=0 mà không phép đo nào thấy.
     *
     * Ghim bằng HAI token khác nhau cho hai `authuser` khác nhau, rồi đối chiếu
     * hai vế trên đúng một request đi ra. Một vế thôi thì hoán vị vế kia vẫn
     * xanh — đó là hình dạng của mọi cặp correspondence-critical.
     */
    await reset();
    await self.NBLM.setSettings({ nlmAccount: 'chu@gmail.com' });
    S.tabs = [];
    S.fetch = async (u) => {
      if (u.includes('ListAccounts')) return res(accountsBody(ACC, 'chu@gmail.com', 1));
      if (u.includes('batchexecute')) return res(envelope([wrb('wXbhsf', [[[['nb-1', ['Sổ của tôi']]]]])]));
      // Trang gốc: mỗi authuser một token RIÊNG. Lấy nhầm trang là lộ ra ngay.
      const au = (/[?&]authuser=([^&]*)/.exec(u) || [])[1] || '0';
      return res(`<script>window.WIZ={"SNlM0e":"TOKEN-CUA-${au}","cfb2h":"boq"};</script>`);
    };

    await send({ type: MSG.LIST_NOTEBOOKS });
    ok(S.posts.length === 1, `K: đúng một lượt batchexecute đi ra, nhận ${S.posts.length}`);
    const post = S.posts[0] || { url: '', body: '' };
    ok(/[?&]authuser=1(&|$)/.test(post.url), `K: request mang authuser=1, nhận: ${post.url}`);
    ok(post.body.includes('TOKEN-CUA-1'), 'K: và mang token lấy từ trang của CHÍNH tài khoản 1');
    ok(!post.body.includes('TOKEN-CUA-0'), 'K: không mang token của tài khoản khác');
    /* Và đi ĐÚNG origin. Không ghim vế này thì hoán vị đổi origin của lượt gửi
       token vẫn xanh — đo ra 0 đỏ hai lần liên tiếp, kể cả sau khi đã có
       allow-list, vì allow-list chặn *cấu hình* chứ không ghim *đích đến*. */
    ok(post.url.startsWith('https://notebooklm.google.com/'),
      `K: token chỉ đi tới notebooklm.google.com, nhận: ${post.url}`);
  }

  {
    /*
     * L. Trang Cài đặt ghi THẲNG `nlmAccount` xuống settings, không qua
     * `SELECT_ACCOUNT`. Trước bản này nó đi vòng qua cả ba bước dọn, để lại
     * `notebookUrl` trỏ vào notebook của tài khoản CŨ.
     *
     * Ghi tách hai lượt — đúng như `options.js` làm với một field — nên đây là
     * ca mà đường popup KHÔNG với tới. Nếu gộp vào một lượt ghi thì luật
     * "owner tự đặt URL trong cùng cú Lưu" sẽ giữ URL lại, và phép đo hoá vô
     * nghĩa: xanh vì đi nhầm nhánh.
     */
    await reset();
    await self.NBLM.setSettings({ notebookUrl: 'https://notebooklm.google.com/notebook/CUA-TAI-KHOAN-CU' });
    await self.NBLM.setSettings({ nlmAccount: 'nguoi-khac@gmail.com' });
    await new Promise((r) => setTimeout(r, 20)); // listener chạy ngoài lượt ghi
    const st = await self.NBLM.getSettings();
    ok(!st.notebookUrl,
      `L: đổi tài khoản từ trang Cài đặt cũng xoá notebookUrl cũ, nhận: ${JSON.stringify(st.notebookUrl)}`);
    ok(st.nlmAccount === 'nguoi-khac@gmail.com', 'L: và giữ đúng tài khoản vừa chọn');
  }

  {
    // M. Đổi cả hai trong CÙNG một cú Lưu là cố ý — không được xoá URL vừa đặt.
    await reset();
    await self.NBLM.setSettings({ nlmAccount: 'a@gmail.com', notebookUrl: 'https://notebooklm.google.com/notebook/CO-Y' });
    await new Promise((r) => setTimeout(r, 20));
    const st = await self.NBLM.getSettings();
    ok((st.notebookUrl || '').includes('CO-Y'),
      `M: URL đặt trong cùng lượt ghi thì GIỮ, nhận: ${JSON.stringify(st.notebookUrl)}`);
  }

  {
    // N. Lưu lại trang Cài đặt mà KHÔNG đổi tài khoản: không được đụng gì.
    // `options.js` ghi mọi field mỗi lần Lưu, nên ca này xảy ra liên tục.
    await reset();
    await self.NBLM.setSettings({ nlmAccount: 'a@gmail.com' });
    await new Promise((r) => setTimeout(r, 20));
    await self.NBLM.setSettings({ notebookUrl: 'https://notebooklm.google.com/notebook/GIU-NGUYEN' });
    await self.NBLM.setSettings({ nlmAccount: 'a@gmail.com', delayMs: 1234 });
    await new Promise((r) => setTimeout(r, 20));
    const st = await self.NBLM.getSettings();
    ok((st.notebookUrl || '').includes('GIU-NGUYEN'),
      `N: Lưu mà không đổi tài khoản thì không xoá gì, nhận: ${JSON.stringify(st.notebookUrl)}`);
  }

  {
    // O. `ttlMs: 0` phải thu hồi NGAY lúc owner bấm Lưu. `writeStored` chỉ dọn
    // khi có lượt dùng mới — đặt rồi không dùng nữa thì token cũ nằm lại mãi,
    // và Cài đặt quảng cáo dòng này là "tắt hẳn việc lưu token xuống đĩa".
    await reset();
    store.set('rpcContext', { at: 'TOKEN-CU', bl: 'b', authuser: '0', ts: Date.now() });
    await self.NBLM.setSettings({ accountOverrides: { ttlMs: 0 } });
    await new Promise((r) => setTimeout(r, 20));
    ok(store.get('rpcContext') === undefined,
      `O: đặt ttlMs 0 thu hồi token đã lưu, nhận: ${JSON.stringify(store.get('rpcContext'))}`);
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
