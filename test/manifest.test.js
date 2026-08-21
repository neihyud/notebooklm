// Test toàn vẹn của manifest (spec 0001).
//
// Ticket 005 là chỗ nối: trước nó, năm file `src/youtube/*.js` chưa được khai ở đâu cả — JS
// mồ côi trông y hệt JS đang chạy. Không có test này thì "đã nối xong" là một câu nói suông,
// vì Chrome không báo gì khi một file không được nạp: nó chỉ im lặng không chạy.
//
// Kiểu test này chỉ có giá trị khi nó **từng đỏ**. Bốn thứ nó canh, và cách phá từng thứ:
//   - xoá một file khỏi mảng `js` → mồ côi;
//   - đảo hai file trong một mảng `js` → sai chuỗi phụ thuộc;
//   - bỏ `"world": "MAIN"` của page-bridge → cầu chạy ở ISOLATED world, không thấy `ytcfg`;
//   - gỡ một quyền → API tương ứng thành `undefined` giữa lúc chạy.
// Mỗi assertion in ra chi tiết lệch chứ không chỉ true/false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const url = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => readFileSync(url(name), 'utf8');

const MANIFEST = JSON.parse(read('manifest.json'));
const SW_PATH = MANIFEST.background.service_worker;
const SW_SOURCE = read(SW_PATH);

/** Mọi file JS của extension dưới `src/`, đường dẫn tính từ gốc repo. */
function sourceFiles(dir = 'src') {
  const out = [];
  for (const entry of readdirSync(url(dir))) {
    const path = `${dir}/${entry}`;
    if (statSync(url(path)).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.js')) out.push(path);
  }
  return out.sort();
}

/** `importScripts('/a.js', '/b.js')` của service worker — chuỗi nạp thật của nó. */
function importScriptsOf(source) {
  const call = source.match(/importScripts\(([\s\S]*?)\);/);
  if (!call) return [];
  return [...call[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\//, ''));
}

const scriptsOf = (html) => [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

/**
 * Mọi chuỗi nạp trong extension. Mỗi chuỗi là một danh sách file **theo thứ tự Chrome nạp**,
 * và mọi ràng buộc dưới đây kiểm trên từng chuỗi một — vì một file nạp đúng thứ tự ở chuỗi
 * này mà sai ở chuỗi kia là hỏng đúng trên một tab.
 */
const CHAINS = [
  ...MANIFEST.content_scripts.map((entry, index) => ({
    name: `content_scripts[${index}] ${entry.matches.join(' ')}${entry.world ? ` world=${entry.world}` : ''}`,
    files: entry.js,
  })),
  { name: 'service worker', files: [...importScriptsOf(SW_SOURCE), SW_PATH] },
  { name: 'options.html', files: scriptsOf(read('options.html')) },
  { name: 'popup.html', files: scriptsOf(read('popup.html')) },
];

/**
 * Phụ thuộc **tự khai** của một file: mỗi module ném `… cần <đường dẫn> nạp trước` khi thiếu.
 * Đọc chính câu đó thay vì chép một bảng phụ thuộc thứ hai — một bảng chép tay sẽ lệch khỏi
 * code ngay lần refactor đầu tiên, và lệch mà vẫn xanh.
 */
function declaredDeps(path) {
  return [...read(path).matchAll(/cần (\S+\.js) nạp trước/g)].map((m) => m[1]);
}

// ------------------------------------------------------------------ file có thật

test('manifest — mọi đường dẫn script trong manifest đều trỏ tới file có thật', () => {
  const listed = [SW_PATH, ...MANIFEST.content_scripts.flatMap((entry) => entry.js)];
  assert.ok(listed.length > 1, 'không đọc được script nào — biểu thức quét hỏng, không phải manifest sạch');
  for (const path of listed) assert.ok(existsSync(url(path)), `manifest khai ${path} nhưng file không có`);
});

test('manifest — không còn file JS mồ côi: mọi file trong src/ đều được một chuỗi nào đó nạp', () => {
  const loaded = new Set(CHAINS.flatMap((chain) => chain.files));
  const orphans = sourceFiles().filter((path) => !loaded.has(path));
  assert.deepEqual(orphans, [], `JS mồ côi — nằm trong cây nhưng không chuỗi nạp nào nhắc tới: ${orphans.join(', ')}`);
});

// ------------------------------------------------------------------ thứ tự nạp

test('manifest — mọi chuỗi nạp xếp đúng chuỗi phụ thuộc mà chính các file tự khai', () => {
  const problems = [];
  for (const chain of CHAINS) {
    chain.files.forEach((path, index) => {
      for (const dep of declaredDeps(path)) {
        const at = chain.files.indexOf(dep);
        if (at === -1) problems.push(`${chain.name}: ${path} cần ${dep} nhưng chuỗi này không nạp nó`);
        else if (at > index) problems.push(`${chain.name}: ${path} (#${index}) nạp TRƯỚC ${dep} (#${at})`);
      }
    });
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('manifest — mỗi chuỗi nạp tự khai được ít nhất một phụ thuộc, nếu không test trên là rỗng tuếch', () => {
  const withDeps = CHAINS.filter((chain) => chain.files.some((path) => declaredDeps(path).length > 0));
  assert.equal(withDeps.length, CHAINS.length, `chuỗi không có phụ thuộc nào để kiểm: ${
    CHAINS.filter((c) => !withDeps.includes(c)).map((c) => c.name).join(', ')}`);
});

// ------------------------------------------------------------------ cầu MAIN world

test('manifest — page-bridge chạy ở MAIN world và ở document_start, không phải mặc định', () => {
  const entry = MANIFEST.content_scripts.find((e) => e.js.includes('src/youtube/page-bridge.js'));
  assert.ok(entry, 'page-bridge.js không được khai trong content_scripts — nó là JS mồ côi');
  // MAIN world: `ytcfg` là biến của trang, ISOLATED world không nhìn thấy nó.
  assert.equal(entry.world, 'MAIN', `page-bridge phải chạy ở MAIN world, đang là ${entry.world || '(mặc định ISOLATED)'}`);
  // document_start: hook `fetch` phải được cài **trước** request InnerTube đầu tiên của trang,
  // nếu không thì không mượn được header nào và triệu chứng là "thỉnh thoảng chạy".
  assert.equal(entry.run_at, 'document_start', `page-bridge phải chạy ở document_start, đang là ${entry.run_at}`);
});

test('manifest — chỉ cầu MAIN world chạy ở MAIN world, không file nào khác đi nhờ', () => {
  const inMain = MANIFEST.content_scripts.filter((e) => e.world === 'MAIN').flatMap((e) => e.js);
  assert.deepEqual(inMain, ['src/youtube/bridge-protocol.js', 'src/youtube/page-bridge.js'],
    `MAIN world là phạm vi owner duyệt, không phải chỗ nạp thêm: ${inMain.join(', ')}`);
});

test('manifest — MAIN world cần chrome 111, và manifest khai đúng mức đó', () => {
  assert.ok(Number(MANIFEST.minimum_chrome_version) >= 111, String(MANIFEST.minimum_chrome_version));
});

// ------------------------------------------------------------------ quyền

const API_PERMISSION = Object.freeze({
  downloads: 'downloads',
  contextMenus: 'contextMenus',
  storage: 'storage',
  tabs: 'tabs',
  scripting: 'scripting',
  notifications: 'notifications',
});

const EXTENSION_JS = [...sourceFiles(), 'popup.js', 'options.js'];
const ALL_SOURCE = EXTENSION_JS.map(read).join('\n');
const apisUsed = new Set([...ALL_SOURCE.matchAll(/chrome[_]?\.([a-zA-Z]+)\./g)].map((m) => m[1]));

test('manifest — mọi API chrome mà code gọi đều có quyền tương ứng', () => {
  const permissions = MANIFEST.permissions || [];
  const missing = [...apisUsed]
    .filter((api) => API_PERMISSION[api] && !permissions.includes(API_PERMISSION[api]))
    .map((api) => `chrome.${api}.* cần quyền "${API_PERMISSION[api]}"`);
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('manifest — không khai quyền thừa: quyền nào cũng phải có code dùng tới', () => {
  const unused = (MANIFEST.permissions || []).filter(
    (permission) => ![...apisUsed].some((api) => API_PERMISSION[api] === permission),
  );
  assert.deepEqual(unused, [], `quyền không ai dùng — gỡ đi: ${unused.join(', ')}`);
});

test('manifest — host_permissions phủ đúng những host mà code đi hỏi tab', () => {
  // Chỉ những mẫu đi vào `chrome.tabs.query`: `targetUrlPatterns` của menu chuột phải **không**
  // cần quyền host, nên gộp chúng vào đây là ép khai một quyền không dùng tới.
  const hosts = MANIFEST.host_permissions || [];
  const queries = [...SW_SOURCE.matchAll(/tabsMatching\(\[([^\]]*)\]\)/g)].map((m) => m[1]);
  const patterns = queries.flatMap((args) => [...args.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.ok(patterns.length > 0, 'không đọc được mẫu host nào trong service worker');
  for (const pattern of patterns) {
    assert.ok(hosts.includes(pattern), `service worker hỏi tab theo mẫu ${pattern} mà host_permissions không có`);
  }
});

test('manifest — content script chỉ nạp trên đúng hai host của spec', () => {
  const matches = MANIFEST.content_scripts.flatMap((entry) => entry.matches);
  assert.deepEqual([...new Set(matches)].sort(), [
    '*://*.youtube.com/*',
    'https://notebooklm.google.com/*',
  ]);
});

// ------------------------------------------------------------------ phím tắt

test('manifest — phím tắt Alt+Shift+Y gọi đúng lệnh mà service worker đang nghe', () => {
  const commands = MANIFEST.commands || {};
  const names = Object.keys(commands);
  assert.deepEqual(names, ['import-video']);
  assert.equal(commands['import-video'].suggested_key.default, 'Alt+Shift+Y');
  for (const name of names) {
    assert.ok(SW_SOURCE.includes(`'${name}'`), `manifest khai lệnh "${name}" mà không ai nghe nó`);
  }
});

// ------------------------------------------------ selector không rời file của lớp mình

test('manifest — không file nào ngoài selectors.js của lớp mình mang selector CSS', () => {
  const SELECTOR_SHAPED = /ytd-[\w-]+|ytp-[\w-]+|mat-[\w-]+|mdc-[\w-]+|\[(?:class|id|role|type|visibility|target-id|aria-[\w-]+|data-[\w-]+)[\^*$~|]?=/g;
  const allowed = new Set(['src/youtube/selectors.js', 'src/notebooklm/selectors.js']);
  const offenders = [];
  for (const path of EXTENSION_JS.filter((p) => !allowed.has(p))) {
    const code = read(path)
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
      })
      .join('\n');
    const found = code.match(SELECTOR_SHAPED) || [];
    if (found.length > 0) offenders.push(`${path}: ${found.join(', ')}`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});
