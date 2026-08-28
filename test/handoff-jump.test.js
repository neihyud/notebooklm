/*
 * Mục 6 và mục 7 của `docs/tickets/006-duong-trao-tay.md`.
 *
 * Mục 6 — "nhảy sang tab NotebookLM, HẾT" — nghe như một dòng code, và cái bẫy
 * của nó nằm đúng ở chỗ đó: đã có sẵn `resolveNotebookTab()` làm gần y hệt, chỉ
 * thừa `ensureScripts` + bốn nhịp `NLM_PING` + `sleep(2500)`. Gọi lại hàm ấy cho
 * nhanh là gắn lại đúng ngân sách "vỡ khi Google đổi DOM" mà ADR 0001 vừa gỡ ra
 * khỏi ca này. Nên bất biến ở đây KHÔNG phải "nhảy đúng tab" mà là "nhảy mà
 * không tiêm gì, không hỏi gì" — và nó chỉ đo được bằng cách đếm số lần đụng vào
 * `chrome.scripting` và `chrome.tabs.sendMessage`.
 *
 * Mục 7 — phím tắt. Service worker không biết privacy và không có clipboard, nên
 * lượt này là một lời NHỜ gửi xuống tab. Bất biến: mọi ca tab không nhận lời đều
 * phải rơi về Hàng đợi, không ca nào được im lặng.
 *
 * Chạy trên service worker THẬT. Bảng `chrome` ở đây ghi lại lời gọi thay vì
 * chỉ trả giá trị, vì thứ cần kiểm là *đã gọi cái gì*, không phải *trả về gì*.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

const noopEvent = () => ({ addListener() {}, removeListener() {} });
const store = new Map();

/* Bàn cờ tab: test dựng lại trước mỗi ca, service worker chỉ được nhìn qua chrome.* */
const nav = {
  tabs: [],
  calls: [],           // mọi lần đụng vào chrome.tabs/scripting/windows
  reply: () => ({ ok: true }),
  lastError: null,
  nextId: 100,
};
const resetNav = (tabs) => {
  nav.tabs = tabs.map((t) => ({ ...t }));
  nav.calls = [];
  nav.reply = (msg) => ({ ok: true, videoId: 'x' });
  nav.lastError = null;
  nav.nextId = 100;
};
const called = (name) => nav.calls.filter((c) => c[0] === name);

/* Khớp glob của chrome.tabs.query — chỉ đủ dùng cho hai mẫu file này dùng. */
const globMatch = (pattern, url) =>
  new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(url || '');

let commandListener = null;

global.self = global;
global.importScripts = (...files) => files.forEach((f) => require(path.join(ROOT, f)));
global.chrome = {
  runtime: {
    onMessage: noopEvent(),
    onInstalled: noopEvent(),
    onStartup: noopEvent(),
    getManifest: () => ({ version: '0.0.0-test' }),
    getURL: (p) => `chrome-extension://test/${p}`,
    sendMessage: async () => {},
    get lastError() { return nav.lastError; },
  },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return Object.fromEntries(store);
        const out = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, JSON.parse(JSON.stringify(v)));
      },
      async remove(key) {
        for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
      },
    },
    onChanged: noopEvent(),
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: noopEvent() },
  commands: { onCommand: { addListener(fn) { commandListener = fn; }, removeListener() {} } },
  contextMenus: { create() {}, removeAll: (cb) => cb && cb(), onClicked: noopEvent() },
  notifications: { create: async (...a) => { nav.calls.push(['notify', a]); } },
  scripting: {
    executeScript: async (o) => { nav.calls.push(['executeScript', o]); return [{ result: null }]; },
    insertCSS: async (o) => { nav.calls.push(['insertCSS', o]); },
  },
  windows: {
    update: async (id, props) => { nav.calls.push(['windows.update', id, props]); return { id }; },
  },
  tabs: {
    query: async (q) => {
      nav.calls.push(['tabs.query', q]);
      return nav.tabs.filter((t) => {
        if (q.url && !globMatch(q.url, t.url)) return false;
        if (q.active && !t.active) return false;
        return true;
      });
    },
    update: async (id, props) => {
      nav.calls.push(['tabs.update', id, props]);
      const t = nav.tabs.find((x) => x.id === id);
      if (t) Object.assign(t, props);
      return t || { id, ...props };
    },
    create: async (props) => {
      nav.calls.push(['tabs.create', props]);
      const t = { id: nav.nextId++, windowId: 1, ...props };
      nav.tabs.push(t);
      return t;
    },
    sendMessage: (tabId, message, cb) => {
      nav.calls.push(['tabs.sendMessage', tabId, message.type, message]);
      const res = nav.reply(message, tabId);
      setTimeout(() => cb(res), 0);
    },
    onRemoved: noopEvent(),
  },
  downloads: { download: async () => 1, search: async () => [], onChanged: noopEvent() },
};

require(path.join(ROOT, 'src/background/service-worker.js'));
const SW = global.NBLM_SW_INTERNALS;
const MSG = global.NBLM.MSG;

const NB = (id) => `https://notebooklm.google.com/notebook/${id}`;
const setTarget = async (url) => {
  const s = store.get('settings') || {};
  store.set('settings', { ...s, notebookUrl: url });
};
const queue = () => store.get('queue') || [];

(async () => {
  ok(typeof SW.jumpToNotebook === 'function', 'service worker phải xuất jumpToNotebook để quan sát được');
  ok(typeof commandListener === 'function', 'phải bắt được listener của chrome.commands — không có nó thì mục 7 không đo được');
  if (!SW.jumpToNotebook || !commandListener) {
    console.log(`${pass} pass, ${fail} fail`);
    process.exit(1);
  }

  /* ================================================================== */
  /* mục 6 — nhảy, và CHỈ nhảy                                          */
  /* ================================================================== */

  /* Tab đích đang mở sẵn: chỉ kích hoạt, không điều hướng, không mở thêm. */
  store.clear();
  await setTarget(NB('abc'));
  resetNav([
    { id: 1, windowId: 7, url: NB('abc'), active: false },
    { id: 2, windowId: 7, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', active: true },
  ]);
  {
    const res = await SW.jumpToNotebook();
    eq(res.jumped, true, 'tab notebook đích đang mở thì phải nhảy được');
    eq(res.tabId, 1, 'phải nhảy đúng tab chứa notebook đã cấu hình');
    eq(called('tabs.create').length, 0, 'tab đích đã mở thì không được mở thêm tab');
    const upd = called('tabs.update');
    eq(upd.length, 1, 'chỉ đúng một lần chạm vào tab');
    eq(upd[0][2], { active: true }, 'chỉ kích hoạt — KHÔNG điều hướng lại tab đang ở đúng chỗ');
    eq(called('windows.update')[0] && called('windows.update')[0][1], 7,
      'phải focus đúng cửa sổ chứa tab — kích hoạt tab ở cửa sổ nền là không nhảy tới đâu cả');
  }

  /*
   * Cái neo của mục 6, và là hoán vị đắt nhất: gọi `resolveNotebookTab` cho
   * nhanh. Hàm đó `ensureScripts(tab.id, 'notebooklm')` + `NLM_PING` bốn nhịp.
   * Cả hai đều lộ ra ở đây, và cả hai đều là thứ ADR 0001 vừa bán đi.
   */
  ok(called('executeScript').length === 0,
    'nhảy sang tab KHÔNG được tiêm content script — Đường trao tay không thao tác lên DOM NotebookLM');
  ok(called('insertCSS').length === 0, 'nhảy sang tab không được chèn CSS vào trang NotebookLM');
  ok(called('tabs.sendMessage').length === 0,
    'nhảy sang tab KHÔNG được ping content script — không có gì để hỏi, clipboard đã xong');

  /* Có tab NotebookLM nhưng không phải notebook đích: điều hướng tab đó. */
  store.clear();
  await setTarget(NB('abc'));
  resetNav([{ id: 1, windowId: 7, url: 'https://notebooklm.google.com/', active: false }]);
  {
    const res = await SW.jumpToNotebook();
    eq(res.jumped, true, 'có tab NotebookLM nhưng sai notebook thì điều hướng nó, vẫn nhảy được');
    eq(called('tabs.create').length, 0, 'đã có tab NotebookLM thì tái dùng, không mở tab thứ hai');
    const first = called('tabs.update')[0];
    eq(first[2], { url: NB('abc'), active: true }, 'phải điều hướng sang notebook đích và kích hoạt luôn');
  }
  ok(called('executeScript').length === 0, 'ca điều hướng cũng không được tiêm script');

  /* Không có tab NotebookLM nào: mở mới, và mở ở chế độ active. */
  store.clear();
  await setTarget(NB('abc'));
  resetNav([{ id: 2, windowId: 7, url: 'https://www.youtube.com/', active: true }]);
  {
    const res = await SW.jumpToNotebook();
    eq(res.jumped, true, 'chưa có tab NotebookLM thì mở mới và nhảy tới');
    const cr = called('tabs.create')[0];
    eq(cr && cr[1], { url: NB('abc'), active: true },
      'tab mở cho Đường trao tay phải active — cả lượt này tồn tại chỉ để đưa người dùng tới đó');
  }

  /*
   * Chưa đặt notebook đích và không có tab notebook nào đang mở. Đây là ca ticket
   * bắt phải NÓI RA. Hai điều kiện, và cả hai đều là chuyện đúng/sai:
   * không được ném (bề mặt sẽ báo thành "copy hỏng" trong khi clipboard đã có
   * nội dung thật), và không được tự mở đại một tab NotebookLM nào đó.
   */
  store.clear();
  resetNav([{ id: 2, windowId: 7, url: 'https://www.youtube.com/', active: true }]);
  {
    let threw = null;
    let res = null;
    try { res = await SW.jumpToNotebook(); } catch (e) { threw = e; }
    ok(!threw, `chưa đặt notebook đích thì KHÔNG được ném — clipboard đã ghi xong rồi (${threw && threw.message})`);
    eq(res, { jumped: false, why: 'no-target' },
      'phải trả về lý do để bề mặt nói tiếp vào câu "Đã copy N link", không được im lặng');
    eq(called('tabs.create').length, 0, 'không có đích thì không được tự mở tab NotebookLM');
  }

  /* Chưa cấu hình nhưng đang mở sẵn một notebook: dùng nó. */
  store.clear();
  resetNav([{ id: 3, windowId: 9, url: NB('zzz'), active: false }]);
  {
    const res = await SW.jumpToNotebook();
    eq(res.jumped, true, 'chưa cấu hình nhưng đang mở sẵn một notebook thì nhảy tới nó');
    eq(res.tabId, 3, 'phải nhảy tới đúng notebook đang mở');
  }

  /*
   * Tab ở gốc notebooklm.google.com KHÔNG phải "một notebook cụ thể".
   * `resolveNotebookTab` ném lỗi ở ca này; `jumpToNotebook` chỉ được coi là
   * không tìm thấy đích, vì không ai sắp thao tác lên DOM của nó.
   */
  store.clear();
  resetNav([{ id: 4, windowId: 9, url: 'https://notebooklm.google.com/', active: false }]);
  {
    let threw = null;
    const res = await SW.jumpToNotebook().catch((e) => { threw = e; return null; });
    ok(!threw, 'tab ở gốc NotebookLM không được làm hàm này ném');
    eq(res && res.jumped, false, 'gốc notebooklm.google.com không phải notebook đích');
  }

  /* Router phải nối được — hàm đúng mà không ai gọi tới thì mục 6 vẫn chưa có. */
  ok(MSG.JUMP_NOTEBOOK === 'jump-notebook', 'MSG.JUMP_NOTEBOOK phải tồn tại để bề mặt gọi được');

  /* ================================================================== */
  /* mục 7 — phím tắt tự rẽ                                             */
  /* ================================================================== */

  ok(SW.SHORTCUT_TIMEOUT_MS <= 5000,
    `cửa sổ chờ tab phải ≤5s (ticket mục 7) — đang là ${SW.SHORTCUT_TIMEOUT_MS}ms`);

  /* Không phải trang video: báo, và không đụng gì tới Hàng đợi. */
  store.clear();
  resetNav([{ id: 2, windowId: 7, url: 'https://example.com/', active: true }]);
  await commandListener('send-current-video');
  eq(queue().length, 0, 'phím tắt trên trang không phải video thì không xếp hàng gì');
  ok(called('notify').length === 1, 'phải báo cho người dùng, không im lặng');

  /*
   * Tab nhận lời và xử xong. `handled` là chữ ký của việc `handOff` đã chạy
   * trọn — mà `handOff` TỰ xếp hàng phần nó không copy được, kể cả nhánh
   * clipboard bị từ chối. Nên service worker xếp hàng thêm ở đây là xếp hai lần
   * cho một video.
   */
  store.clear();
  resetNav([{ id: 2, windowId: 7, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', active: true }]);
  nav.reply = (msg) => (msg.type === MSG.SHORTCUT_HANDOFF ? { handled: true } : { ok: true });
  await commandListener('send-current-video');
  {
    const sent = called('tabs.sendMessage').filter((c) => c[2] === MSG.SHORTCUT_HANDOFF);
    eq(sent.length, 1, 'phím tắt phải NHỜ tab trao tay — service worker không biết privacy và không có clipboard');
    eq(sent[0][3].videoId, 'aaaaaaaaaaa', 'phải nhờ đúng video đang xem');
    eq(queue().length, 0, 'tab đã nhận lời thì service worker KHÔNG được xếp hàng thêm — thành hai bản của một video');
  }

  /* Tab trả lời "không xử được": rơi về Hàng đợi, đúng đường cũ. */
  store.clear();
  resetNav([{ id: 2, windowId: 7, url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', active: true }]);
  nav.reply = (msg) => (msg.type === MSG.SHORTCUT_HANDOFF ? { handled: false } : { ok: true });
  await commandListener('send-current-video');
  eq(queue().map((i) => i.videoId), ['bbbbbbbbbbb'],
    'tab từ chối xử thì video phải rơi về Hàng đợi — không ca nào được im lặng');

  /*
   * Tab không phản hồi. Đây là ca ticket gọi tên thẳng ("tab không phản hồi
   * trong ~5s cũng phải rơi về Hàng đợi"), và là ca sẽ xảy ra thật nếu hoá ra
   * `writeText` mất transient user activation qua vòng service worker.
   */
  store.clear();
  resetNav([{ id: 2, windowId: 7, url: 'https://www.youtube.com/watch?v=ccccccccccc', active: true }]);
  nav.reply = (msg) => {
    if (msg.type === MSG.SHORTCUT_HANDOFF) { nav.lastError = { message: 'Receiving end does not exist.' }; return undefined; }
    return { ok: true };
  };
  await commandListener('send-current-video');
  nav.lastError = null;
  eq(queue().map((i) => i.videoId), ['ccccccccccc'],
    'tab treo/không phản hồi thì video vẫn phải vào Hàng đợi');

  /* Tab chưa có content script và cũng không tiêm được: vẫn phải vào Hàng đợi. */
  store.clear();
  resetNav([{ id: 2, windowId: 7, url: 'https://www.youtube.com/watch?v=ddddddddddd', active: true }]);
  nav.reply = () => { nav.lastError = { message: 'no receiver' }; return undefined; };
  const realExec = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async () => { throw new Error('không tiêm được'); };
  await commandListener('send-current-video');
  chrome.scripting.executeScript = realExec;
  nav.lastError = null;
  eq(queue().map((i) => i.videoId), ['ddddddddddd'],
    'tiêm script hỏng cũng phải rơi về Hàng đợi, không được nuốt lượt phím tắt');

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
