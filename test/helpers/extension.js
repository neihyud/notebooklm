// Hai thứ dùng chung của mọi test đọc extension như Chrome đọc nó: **danh sách chuỗi nạp**, và
// **một ngữ cảnh V8 sạch để chạy một chuỗi trong đó**.
//
// Tách ra khỏi `test/manifest.test.js` ở ticket 011 vì test định tuyến cần đúng hai thứ ấy, và
// một bản sao thứ hai của chúng là một bản sao sẽ lệch: chuỗi nạp thật đổi ở manifest, bản chép
// thì không, và test định tuyến vẫn xanh về một chuỗi không còn tồn tại.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

export const url = (name) => new URL(`../../${name}`, import.meta.url);
export const read = (name) => readFileSync(url(name), 'utf8');

export const MANIFEST = JSON.parse(read('manifest.json'));
export const SW_PATH = MANIFEST.background.service_worker;
export const SW_SOURCE = read(SW_PATH);

/** Mọi file JS của extension dưới `src/`, đường dẫn tính từ gốc repo. */
export function sourceFiles(dir = 'src') {
  const out = [];
  for (const entry of readdirSync(url(dir))) {
    const path = `${dir}/${entry}`;
    if (statSync(url(path)).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.js')) out.push(path);
  }
  return out.sort();
}

/** `importScripts('/a.js', '/b.js')` của service worker — chuỗi nạp thật của nó. */
export function importScriptsOf(source) {
  const call = source.match(/importScripts\(([\s\S]*?)\);/);
  if (!call) return [];
  return [...call[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\//, ''));
}

/**
 * Mảng file mà service worker **tiêm** vào tab tài liệu (`chrome.scripting.executeScript`).
 *
 * Đây cũng là một chuỗi nạp, y hệt một mảng `js` của `content_scripts`: cùng thứ tự, cùng chuỗi
 * phụ thuộc, cùng cái chết nếu xếp sai. Khác đúng một chỗ — nó không nằm trong `manifest.json`,
 * nên đọc từ chính mã nguồn. Không đọc nó thì mọi file của lớp tài liệu thành JS mồ côi và mọi
 * ràng buộc thứ tự bên dưới bỏ qua chúng, im lặng.
 */
export function injectedScriptsOf(source) {
  const call = source.match(/const DOCS_SCRIPTS = \[([\s\S]*?)\];/);
  assert.ok(call, 'không đọc được mảng DOCS_SCRIPTS trong service worker');
  const files = [...call[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\//, ''));
  assert.ok(files.length > 0, 'DOCS_SCRIPTS rỗng — lớp tài liệu không được tiêm vào đâu cả');
  return files;
}

export const scriptsOf = (html) => [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

/**
 * Mọi chuỗi nạp trong extension. Mỗi chuỗi là một danh sách file **theo thứ tự Chrome nạp**,
 * và mọi ràng buộc kiểm trên từng chuỗi một — vì một file nạp đúng thứ tự ở chuỗi này mà sai ở
 * chuỗi kia là hỏng đúng trên một tab.
 *
 * `tab: true` đánh dấu chuỗi chạy **trong một tab**: đó là những chuỗi có thể gặp nhau trên cùng
 * một tab, nên cũng đúng là những chuỗi mà kỷ luật định tuyến nói về.
 */
export const CHAINS = [
  ...MANIFEST.content_scripts.map((entry, index) => ({
    name: `content_scripts[${index}] ${(entry.matches || []).join(' ')}${entry.world ? ` world=${entry.world}` : ''}`,
    files: entry.js,
    matches: entry.matches,
    tab: true,
  })),
  { name: 'service worker', files: [...importScriptsOf(SW_SOURCE), SW_PATH] },
  {
    name: 'tiêm vào tab tài liệu (DOCS_SCRIPTS)',
    files: injectedScriptsOf(SW_SOURCE),
    // Không có `matches`: nó không được Chrome tự nạp, nó được tiêm vào một `tabId` cụ thể —
    // và vì vậy `exclude_matches` không chi phối được nó (xem `S.hasOwnContentScript`).
    matches: null,
    tab: true,
  },
  { name: 'options.html', files: scriptsOf(read('options.html')) },
  { name: 'popup.html', files: scriptsOf(read('popup.html')) },
];

/** Chuỗi nào có file tự khai một listener `onMessage` — đọc từ mã nguồn, không chép tay. */
export const declaresListener = (chain) => chain.files.some((path) => /onMessage\.addListener/.test(read(path)));

/**
 * Nạp cả một chuỗi vào một ngữ cảnh V8 **sạch**, đúng như Chrome nạp nó vào một tab: chạy từng
 * file theo thứ tự, trên một `globalThis` chung, không import gì cả.
 *
 * Đây là điểm khác biệt của cách này với mọi test khác trong repo. Ở nơi khác, một content
 * script được `import` rồi test **gọi thẳng** `install(target)`; cách ấy kiểm được thân hàm
 * nhưng mù hoàn toàn với câu hỏi "trên tab thật thì ai gọi nó". Ngữ cảnh sạch bắt đúng câu ấy.
 *
 * Trả về cả `listeners` lẫn `sandbox`: test định tuyến cần lái chính listener ấy, và cần đổi
 * `location.href` của tab giả trước khi lái.
 */
export function loadChainInFreshContext(files, given = {}) {
  const listeners = [];
  const stubElement = () => ({
    setAttribute() {}, removeAttribute() {}, append() {}, appendChild() {}, remove() {},
    addEventListener() {}, attachShadow: () => ({ append() {}, appendChild() {} }),
    classList: { add() {}, remove() {} }, children: [], style: {},
  });
  const doc = {
    body: null,
    documentElement: null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: stubElement,
  };
  const sandbox = {
    // `URL` không phải built-in của ECMAScript, nên một ngữ cảnh V8 mới không có nó; `shared.js`
    // thì dùng. Mọi thứ còn lại ở đây là bề mặt tối thiểu của một tab.
    URL,
    console,
    // Đồng hồ chạy hết cỡ: mọi vòng thử lại trong repo đếm bằng `setTimeout`, và một test lái
    // listener qua nhánh hỏng sẽ phải chờ thật vài chục giây nếu để nhịp thật.
    setTimeout: (fn, _ms, ...args) => setTimeout(fn, 0, ...args),
    clearTimeout,
    location: { href: given.href || 'https://docs.acme.dev/guide/cai-dat' },
    innerWidth: 1280,
    document: doc,
    addEventListener() {}, removeEventListener() {}, postMessage() {},
    DOMParser: class { parseFromString() { return { body: null }; } },
    fetch: async () => { throw new Error('không có mạng trong test'); },
    chrome: {
      runtime: {
        sendMessage: async () => ({ ok: true }),
        onMessage: { addListener: (fn) => listeners.push(fn) },
        getURL: (path) => `chrome-extension://test/${path}`,
      },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
    },
  };
  const context = createContext(sandbox);
  for (const path of files) runInContext(read(path), context, { filename: path });
  return { listeners, sandbox };
}
