// Service worker thật, nạp vào một ngữ cảnh V8 sạch với một `chrome` giả **có ghi sổ**, rồi lái
// qua chính listener nó tự đăng ký. Không hàm nào được gọi thẳng — gọi thẳng là bỏ qua đúng phần
// dây nối đang cần kiểm.
//
// Tách khỏi `test/service-worker.test.js` ở ticket 011: test định tuyến cần đúng harness này để
// hỏi "service worker im lặng với tin của tab chứ?", và một bản sao thứ hai của `chrome` giả là
// một bản sẽ lệch khỏi bản kia — mà lệch thì cả hai vẫn xanh.
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { read, SW_PATH, SW_SOURCE, importScriptsOf } from './extension.js';
// Phản hồi `batchexecute` giả — dựng theo hình dạng capture, không lấy từ một request thật nào.
import { WIZ_HTML, SUCCESS_BODY } from './batchexecute.js';
// Classic script gắn API vào globalThis — nhập ở đây chứ không dựa vào thứ tự nhập của file
// test: `layerAnswer` đọc `M.TYPES` ngay lúc module này chạy.
import '../../src/common/shared.js';
import '../../src/common/messages.js';

const S = globalThis.NBLM_SHARED;
const M = globalThis.NBLM_MESSAGES;

export const SITE = 'https://docs.acme.dev';
export const DOCS_PAGE = `${SITE}/guide/cai-dat`;
export const NOTEBOOK_ID = 'abcd1234efgh';
export const NOTEBOOK_PAGE = `https://notebooklm.google.com/notebook/${NOTEBOOK_ID}`;
export const YOUTUBE_PAGE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Tab của người dùng — tab đang mở trang tài liệu và sắp mang Bảng chọn. */
export const DOCS_TAB = 7;
/** Tab NotebookLM đang mở sẵn, để lượt đẩy không phải mở thêm tab. */
export const NOTEBOOK_TAB = 8;
/** Tab YouTube đang mở — nơi một content script của chính extension đã sống sẵn. */
export const YOUTUBE_TAB = 9;

/**
 * `*://*.youtube.com/*` → RegExp — phép khớp mà `chrome.tabs.query` làm giúp ta trong Chrome thật.
 *
 * Cố ý **không** gọi `S.matchesPattern`: đó là hàm đang được kiểm. Dùng nó ở đây thì một lỗi
 * trong nó cũng làm `chrome` giả sai theo đúng cùng một kiểu, và hai bên khớp nhau tuyệt đối
 * trên một câu trả lời sai.
 */
function patternToRegExp(pattern) {
  const escape = (part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`);
}

/**
 * Phản hồi của **một lớp content script** cho một tin nó nhận.
 *
 * Chia theo lớp chứ không theo loại tin, vì đó là chỗ ticket 011 nói tới: một tab có thể mang
 * nhiều lớp, và Chrome lấy **phản hồi đến trước**. Bảng tra phẳng theo loại tin sẽ trả lời đúng
 * kể cả khi lớp trả lời không hề có mặt trên tab ấy — đúng thứ cần lộ ra.
 */
function layerAnswer(layer, tab, message) {
  const type = M.typeOf(message);
  if (layer === 'docs') {
    if (type === M.TYPES.PING_DOCS) return { ok: true, result: { page: S.docPageId(tab.url) } };
    if (type === M.TYPES.OPEN_DOC_PICKER) return { ok: true, result: { pages: 5, outcome: 'ok' } };
    if (type === M.TYPES.EXTRACT_DOC) {
      return {
        ok: true,
        result: {
          url: message.url,
          title: 'Một trang',
          markdown: `## Một trang\n\n${'chữ '.repeat(40)}`,
          chars: 200,
          via: 'fetch',
          escalated: false,
        },
      };
    }
  }
  if (layer === 'notebooklm') {
    if (type === M.TYPES.PING_NOTEBOOKLM) return { ok: true, result: { notebookId: NOTEBOOK_ID } };
    if (type === M.TYPES.PUSH_SOURCE) return { ok: true, result: { sourceId: 'src-1' } };
  }
  if (layer === 'youtube') {
    if (type === M.TYPES.PING_YOUTUBE) return { ok: true, result: { ready: true } };
    if (type === M.TYPES.EXTRACT_TRANSCRIPT) return { ok: false, error: 'không trích trong test' };
  }
  throw new Error(`chrome giả: lớp "${layer}" nhận ${type} mà không có phản hồi soạn sẵn`);
}

/**
 * `chrome` giả có **ghi sổ**: mọi lời gọi chạm tới một tab đều để lại một dòng kèm tab id.
 *
 * Ba chi tiết cố ý giống Chrome thật, vì thiếu chúng là test tự bịt mắt mình:
 *   1. `tabs.sendMessage` vào một tab mà **không lớp nào nhận** loại tin ấy thì **ném**
 *      (`Could not establish connection`) — đó là "im lặng" nhìn từ phía người gửi. Tab ẩn
 *      không mang lớp nào, nên mọi lời gọi nhầm địa chỉ cũng lộ ra ở đây.
 *   2. Nhiều lớp trên một tab thì **lớp đầu tiên nhận** là lớp trả lời: "only the first listener
 *      to respond … will affect the sender" (tài liệu Message Passing của Chrome).
 *   3. `scripting.executeScript` vào một tab không tồn tại thì ném, và khi thành công nó **thêm
 *      một lớp** vào tab — kể cả tab đã có lớp khác. `executeScript` không nhận `matches` lẫn
 *      `excludeMatches`; nó tiêm vào đúng `tabId` được đưa, hết.
 */
export function fakeChrome(given = {}) {
  const log = [];
  const tabs = new Map([
    [DOCS_TAB, { id: DOCS_TAB, url: DOCS_PAGE, layers: [] }],
    [NOTEBOOK_TAB, { id: NOTEBOOK_TAB, url: NOTEBOOK_PAGE, layers: ['notebooklm'] }],
    [YOUTUBE_TAB, { id: YOUTUBE_TAB, url: YOUTUBE_PAGE, layers: ['youtube'] }],
  ]);
  const activeTabId = given.activeTab == null ? DOCS_TAB : given.activeTab;
  const local = new Map([['notebook-id', NOTEBOOK_ID]]);
  let nextId = 100;

  const note = (api, tabId, detail) => log.push({ api, tabId, ...detail });
  const liveTab = (tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}.`);
    return tab;
  };

  const api = {
    runtime: {
      onInstalled: { addListener: (fn) => api._onInstalled.push(fn) },
      onMessage: { addListener: (fn) => api._onMessage.push(fn) },
    },
    contextMenus: {
      removeAll: (done) => done && done(),
      create: () => {},
      onClicked: { addListener: () => {} },
    },
    commands: { onCommand: { addListener: () => {} } },
    action: { setBadgeText: () => {}, setTitle: () => {} },
    downloads: { download: async (file) => { note('downloads.download', null, { file }); return 1; } },
    storage: {
      local: {
        get: async (key) => (local.has(key) ? { [key]: local.get(key) } : {}),
        set: async (bag) => { for (const [k, v] of Object.entries(bag)) local.set(k, v); },
      },
      sync: { get: async () => ({}) },
    },
    tabs: {
      query: async (query) => {
        if (query.url) {
          const patterns = [query.url].flat().map(patternToRegExp);
          return [...tabs.values()].filter((tab) => patterns.some((re) => re.test(tab.url)));
        }
        return [liveTab(activeTabId)];
      },
      get: async (tabId) => ({ ...liveTab(tabId) }),
      create: async ({ url: href, active }) => {
        const tab = { id: (nextId += 1), url: href, layers: [] };
        tabs.set(tab.id, tab);
        note('tabs.create', tab.id, { url: href, active });
        return { ...tab };
      },
      update: async (tabId, { url: href }) => {
        note('tabs.update', tabId, { url: href });
        liveTab(tabId).url = href;
        return { ...liveTab(tabId) };
      },
      remove: async (tabId) => {
        note('tabs.remove', tabId, {});
        liveTab(tabId);
        tabs.delete(tabId);
      },
      sendMessage: async (tabId, message) => {
        const tab = liveTab(tabId);
        const layer = tab.layers.find((name) => M.isFor(name, message));
        if (!layer) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        note('tabs.sendMessage', tabId, { type: M.typeOf(message), layer });
        const override = given.answer && given.answer(layer, tab, message);
        return override || layerAnswer(layer, tab, message);
      },
    },
    scripting: {
      executeScript: async ({ target, files, func }) => {
        const tab = liveTab(target.tabId);
        if (files) {
          note('scripting.files', target.tabId, { files });
          if (!tab.layers.includes('docs')) tab.layers.push('docs');
          return files.map(() => ({ result: undefined }));
        }
        note('scripting.func', target.tabId, {});
        // Chrome **tuần tự hoá** hàm rồi chạy nó trong trang, không gọi nó tại chỗ: nó không
        // nhìn thấy biến nào của service worker, chỉ thấy `location`/`document` của tab đích.
        // Gọi thẳng `func()` ở đây là để nó nhặt được global của service worker — một cái bẫy
        // im lặng, vì `readHiddenTab` nuốt mọi lỗi vào vòng thử lại rồi bỏ cuộc sau 10 giây.
        const page = createContext({
          location: { href: tab.url },
          document: { documentElement: { outerHTML: `<html><body>${tab.url}</body></html>` } },
        });
        return [{ result: runInContext(`(${func.toString()})()`, page) }];
      },
    },
    _onInstalled: [],
    _onMessage: [],
  };

  /**
   * `fetch` giả của service worker — lối ra thứ hai của một lượt đẩy, bên cạnh `chrome.tabs`.
   *
   * Ghi vào **cùng một sổ** với `chrome` giả: đường RPC và đường DOM là hai vai của cùng một
   * lượt đẩy, và câu hỏi duy nhất đáng hỏi là "lượt này đi đường nào" — hai sổ riêng thì phải
   * ghép tay mới trả lời được, mà ghép tay thì lệch.
   *
   * Mặc định là đường hạnh phúc: `GET` trả HTML mang `WIZ_global_data`, `POST` trả một frame
   * `wrb.fr` thành công. Test nào cần một hạng lỗi thì đưa `given.fetch` trả về hạng ấy.
   */
  const fetchStub = async (href, init) => {
    const method = (init && init.method) || 'GET';
    note('fetch', null, { url: String(href), method, body: (init && init.body) || '' });
    const override = given.fetch && await given.fetch(String(href), init);
    if (override) return override;
    return fakeResponse(200, method === 'GET' ? WIZ_HTML : SUCCESS_BODY);
  };

  return { api, log, tabs, fetchStub };
}

/** Đúng bề mặt `Response` mà đường RPC dùng tới: `status`, `ok`, `text()`. */
export function fakeResponse(status, text) {
  return { status, ok: status >= 200 && status < 300, text: async () => String(text == null ? '' : text) };
}

/**
 * Nạp chuỗi `importScripts` thật của service worker vào một ngữ cảnh V8 sạch, rồi trả về một
 * cái tay cầm để gửi tin vào **chính listener mà nó tự đăng ký**.
 */
export function bootServiceWorker(given = {}) {
  const { api, log, tabs, fetchStub } = fakeChrome(given);
  const chain = importScriptsOf(SW_SOURCE);

  /**
   * `console.warn` bắt lại được: đường lui của ADR 0012 chạy **thành công**, nên nó không để
   * lại dấu vết nào trong bảng tổng kết. Dòng cảnh báo là thứ duy nhất nói ra rằng đường chính
   * vừa chết, và một thứ chỉ có giá trị khi nó xuất hiện thì phải kiểm được là nó có xuất hiện.
   */
  const warnings = [];
  const captureConsole = Object.create(console);
  captureConsole.warn = (...args) => warnings.push(args.map((arg) => String(arg)).join(' '));

  const sandbox = {
    URL,
    // `URLSearchParams` không phải built-in của ECMAScript, nên một ngữ cảnh V8 mới không có nó;
    // `notebooklm/rpc.js` dựng query và đọc body bằng nó.
    URLSearchParams,
    console: captureConsole,
    // Lối ra thứ hai của một lượt đẩy (ADR 0012). Ghi vào cùng sổ với `chrome` giả.
    fetch: fetchStub,
    // Nhịp chờ thật của service worker là 250ms × 40 lượt = 10 giây. Một test lái nó qua nhánh
    // "tab không bao giờ sẵn sàng" phải đi hết vòng ấy, nên đồng hồ chạy hết cỡ — số **lượt**
    // vẫn nguyên, chỉ khoảng cách giữa hai lượt là 0.
    setTimeout: (fn, _ms, ...args) => setTimeout(fn, 0, ...args),
    clearTimeout,
    chrome: api,
    // Chuỗi nạp thật, đúng thứ tự thật — không phải một danh sách chép tay ở đây.
    importScripts: (...paths) => {
      for (const path of paths) {
        const file = path.replace(/^\//, '');
        runInContext(read(file), context, { filename: file });
      }
    },
  };
  const context = createContext(sandbox);
  assert.ok(chain.length > 0, 'không đọc được chuỗi importScripts của service worker');
  runInContext(SW_SOURCE, context, { filename: SW_PATH });

  assert.equal(api._onMessage.length, 1, 'service worker phải đăng ký đúng một listener');
  const listener = api._onMessage[0];

  return {
    log,
    tabs,
    listener,
    warnings,
    send: (message, sender = {}) => new Promise((resolve) => {
      const kept = listener(message, sender, resolve);
      if (!kept) resolve(undefined);
    }),
    /** Tập tab id mà một nhóm lời gọi đã chạm tới. */
    touched: (apis) => new Set(log.filter((row) => apis.includes(row.api)).map((row) => row.tabId)),
    /** Tập tab id đã nhận một loại tin cụ thể. */
    messaged: (...types) => new Set(
      log.filter((row) => row.api === 'tabs.sendMessage' && types.includes(row.type)).map((row) => row.tabId),
    ),
  };
}
