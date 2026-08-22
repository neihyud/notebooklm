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
//   - gỡ một quyền → API tương ứng thành `undefined` giữa lúc chạy;
//   - bỏ một host NotebookLM khỏi `NOTEBOOK_HOSTS`, khỏi manifest, hay khỏi mẫu `tabs.query`
//     → content script không nạp với đúng một nửa tài khoản (ticket 014).
// Mỗi assertion in ra chi tiết lệch chứ không chỉ true/false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
// shared.js là classic script gắn API vào globalThis — import lấy side effect. Manifest và
// service worker phải khai đúng tập host mà nó định nghĩa, nên đây là bên thứ hai của mọi
// đối chiếu host dưới đây, thay cho một danh sách chép tay.
import '../src/common/shared.js';

const S = globalThis.NBLM_SHARED;

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

/**
 * Mẫu host mà service worker thật sự đưa vào `chrome.tabs.query`.
 *
 * Đối số của `tabsMatching` có hai dạng: mảng chuỗi viết thẳng, hoặc một hằng số của
 * `shared.js`. Phải quy được **cả hai** về mẫu thật — nếu chỉ đọc dạng thứ nhất thì đổi sang
 * hằng số là mất luôn phần canh, mà test vẫn xanh vì mẫu YouTube còn viết thẳng.
 */
function tabQueryPatterns(source) {
  const calls = [...source.matchAll(/tabsMatching\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length > 0, 'không đọc được lời gọi tabsMatching nào trong service worker');
  return calls.flatMap((args) => {
    const literals = [...args.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const constant = args.match(/S\.([A-Z][A-Z_]+)/);
    const resolved = literals.length ? literals : (constant && S[constant[1]]) || [];
    assert.ok(resolved.length > 0, `không quy được đối số của tabsMatching(${args}) về mẫu host`);
    return [...resolved];
  });
}

test('manifest — host_permissions phủ đúng những host mà code đi hỏi tab', () => {
  // Chỉ những mẫu đi vào `chrome.tabs.query`: `targetUrlPatterns` của menu chuột phải **không**
  // cần quyền host, nên gộp chúng vào đây là ép khai một quyền không dùng tới.
  const hosts = MANIFEST.host_permissions || [];
  for (const pattern of tabQueryPatterns(SW_SOURCE)) {
    assert.ok(hosts.includes(pattern), `service worker hỏi tab theo mẫu ${pattern} mà host_permissions không có`);
  }
});

test('manifest — service worker hỏi tab trên MỌI host NotebookLM, không chỉ host nó tự mở', () => {
  // Một tab đang mở ở host này phải được nhận ra khi extension đi tìm host kia. Không thì mỗi
  // lần đẩy lại mở thêm một tab bên cạnh tab đã có — người dùng chỉ thấy "sao nhiều tab thế".
  const patterns = tabQueryPatterns(SW_SOURCE);
  const missing = S.NOTEBOOK_MATCH_PATTERNS.filter((pattern) => !patterns.includes(pattern));
  assert.deepEqual(missing, [], `service worker không bao giờ hỏi tới ${missing.join(', ')}`);
});

test('manifest — mỗi hàm tìm tab hỏi mẫu host của đúng parser mà chính nó lọc bằng', () => {
  // Hai mẫu host là hai chuỗi cùng kiểu, và hoán vị chúng giữa hai hàm không làm gì đỏ ở tầng
  // dưới: `findVideoTab` hỏi tab NotebookLM sẽ **luôn** không thấy gì, `findNotebookTab` hỏi
  // tab YouTube cũng vậy — cả hai lặng lẽ mở thêm tab mới mỗi lượt. Ràng buộc thật: hỏi theo
  // mẫu của host nào thì lọc bằng parser của đúng host ấy.
  const finders = [...SW_SOURCE.matchAll(/async function (find\w+Tab)\b([\s\S]*?)\n  }\n/g)];
  assert.ok(finders.length >= 2, `chỉ thấy ${finders.length} hàm tìm tab — biểu thức quét hỏng`);
  for (const [, name, body] of finders) {
    const patterns = tabQueryPatterns(body);
    const asksNotebook = S.NOTEBOOK_MATCH_PATTERNS.every((pattern) => patterns.includes(pattern));
    assert.equal(asksNotebook, body.includes('S.parseNotebookId'),
      `${name} hỏi tab theo ${patterns.join(', ')} nhưng lọc bằng parser của host khác`);
  }
});

test('manifest — content script chỉ nạp trên đúng những host của spec, và trên tất cả', () => {
  const matches = MANIFEST.content_scripts.flatMap((entry) => entry.matches);
  assert.deepEqual([...new Set(matches)].sort(), ['*://*.youtube.com/*', ...S.NOTEBOOK_MATCH_PATTERNS].sort());
});

test('manifest — content script NotebookLM khai đủ mọi host, thiếu một là im lặng không nạp', () => {
  // Suy từ chuỗi nạp nào mang `notebooklm/content.js` chứ không đếm chỉ số: chèn thêm một
  // content_scripts ở giữa không được làm test này quay sang canh nhầm chuỗi khác.
  const entry = MANIFEST.content_scripts.find((e) => e.js.includes('src/notebooklm/content.js'));
  assert.ok(entry, 'src/notebooklm/content.js không được khai trong content_scripts — nó là JS mồ côi');
  assert.deepEqual([...entry.matches].sort(), [...S.NOTEBOOK_MATCH_PATTERNS].sort(),
    'khai thiếu một host thì với đúng cohort kia, content script không nạp và đường đẩy chết lặng');
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

/** Phần code của một file, bỏ dòng chú thích — hằng số nằm trong prose không phải hard-code. */
function codeOf(path) {
  return read(path)
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    })
    .join('\n');
}

// ------------------------------------------- hostname không rời hằng số của shared.js

test('manifest — hostname NotebookLM chỉ nằm ở shared.js, không file nào khác viết lại', () => {
  // Cùng lý do với selector ở dưới, và là đúng cái bug của ticket 014: hostname viết rải rác
  // thì một lần đổi tên sản phẩm chỉ được vá ở những chỗ ai đó *nhớ ra*, chỗ còn lại chết lặng.
  const HOST_SHAPED = /\bnotebook(?:lm)?\.google\.com\b/g;
  const home = 'src/common/shared.js';
  const declared = codeOf(home).match(HOST_SHAPED) || [];
  assert.deepEqual([...new Set(declared)].sort(), [...S.NOTEBOOK_HOSTS].sort(),
    `${home} phải là chỗ duy nhất khai hostname, và khai đủ: ${declared.join(', ')}`);

  const offenders = EXTENSION_JS
    .filter((path) => path !== home)
    .map((path) => [path, codeOf(path).match(HOST_SHAPED) || []])
    .filter(([, found]) => found.length > 0)
    .map(([path, found]) => `${path}: ${found.join(', ')}`);
  assert.deepEqual(offenders, [], `hard-code hostname — dùng S.NOTEBOOK_MATCH_PATTERNS / S.notebookUrl:\n${offenders.join('\n')}`);
});

// ------------------------------------------------ selector không rời file của lớp mình

/**
 * File được phép mang selector: `selectors.js` **của một lớp**, tức `src/<lớp>/selectors.js`.
 *
 * Suy ra từ cây thư mục chứ không liệt kê tay: một lớp mới (`src/docs/` ở ticket 008) mà phải
 * sửa danh sách ở đây thì danh sách ấy sẽ được sửa bằng cách *thêm bất cứ file nào đang vướng*,
 * và quy tắc chết lặng. Ràng buộc thật là "mỗi lớp một file, đúng tên đó".
 */
const SELECTOR_HOME = /^src\/[^/]+\/selectors\.js$/;

test('manifest — không file nào ngoài selectors.js của lớp mình mang selector CSS', () => {
  const SELECTOR_SHAPED = /ytd-[\w-]+|ytp-[\w-]+|mat-[\w-]+|mdc-[\w-]+|\[(?:class|id|role|type|visibility|target-id|aria-[\w-]+|data-[\w-]+)[\^*$~|]?=/g;
  const homes = EXTENSION_JS.filter((p) => SELECTOR_HOME.test(p));
  assert.ok(homes.length >= 2, `chỉ thấy ${homes.length} file selectors.js — biểu thức quét hỏng, không phải cây sạch`);
  // Một chỗ được miễn trừ mà không chứa gì là một miễn trừ không ai biết đã thừa.
  for (const home of homes) {
    assert.ok((read(home).match(SELECTOR_SHAPED) || []).length > 0, `${home} được miễn trừ mà không mang selector nào`);
  }

  const offenders = [];
  for (const path of EXTENSION_JS.filter((p) => !SELECTOR_HOME.test(p))) {
    const found = codeOf(path).match(SELECTOR_SHAPED) || [];
    if (found.length > 0) offenders.push(`${path}: ${found.join(', ')}`);
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});
