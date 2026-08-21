/*
 * Kiểm tra tính toàn vẹn của manifest.
 * Chrome báo lỗi đường dẫn sai bằng một dòng đỏ mơ hồ lúc Load unpacked, còn
 * content script khai thiếu file thì im lặng chạy sai — rẻ hơn nhiều nếu bắt ở đây.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));

const exists = (rel, where) => ok(fs.existsSync(path.join(ROOT, rel)), `${where}: thiếu file ${rel}`);

exists(manifest.background.service_worker, 'background');
exists(manifest.options_ui.page, 'options_ui');
exists(manifest.action.default_popup, 'action');
for (const icon of Object.values(manifest.action.default_icon)) exists(icon, 'action.default_icon');
for (const icon of Object.values(manifest.icons)) exists(icon, 'icons');

manifest.content_scripts.forEach((cs, i) => {
  for (const file of cs.js || []) exists(file, `content_scripts[${i}].js`);
  for (const file of cs.css || []) exists(file, `content_scripts[${i}].css`);
});

for (const entry of manifest.web_accessible_resources || []) {
  for (const file of entry.resources) exists(file, 'web_accessible_resources');
}

// Mọi file JS trong src/ đều phải được nạp ở đâu đó, nếu không là code chết.
const referenced = new Set([
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((cs) => cs.js || []),
]);
const inHtml = new Set();
// Quét mọi trang HTML trong src/, không chỉ popup+options: offscreen document
// được tạo lúc chạy bằng chrome.offscreen nên không xuất hiện trong manifest.
const pages = [manifest.action.default_popup, manifest.options_ui.page,
  ...walk('src').filter((f) => f.endsWith('.html'))];
for (const page of [...new Set(pages)]) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const hit of html.matchAll(/src="([^"]+\.js)"/g)) {
    inHtml.add(path.normalize(path.join(path.dirname(page), hit[1])));
  }
}
for (const file of walk('src')) {
  if (!file.endsWith('.js')) continue;
  ok(referenced.has(file) || inHtml.has(file), `${file} không được nạp từ manifest hay trang HTML nào`);
}

// Content script của tài liệu phải nạp đủ chuỗi phụ thuộc, đúng thứ tự.
const docsScript = manifest.content_scripts.find((cs) => (cs.js || []).some((f) => f.includes('src/docs/')));
ok(!!docsScript, 'không có content script cho trang tài liệu');
if (docsScript) {
  const order = ['src/common/shared.js', 'src/docs/markdown.js', 'src/docs/extract.js', 'src/docs/sidebar.js', 'src/docs/content.js'];
  ok(JSON.stringify(docsScript.js) === JSON.stringify(order), 'thứ tự nạp script tài liệu sai (phụ thuộc theo thứ tự)');
  ok(
    (docsScript.exclude_matches || []).some((m) => m.includes('youtube.com')),
    'phải loại trừ youtube.com khỏi content script tài liệu (tránh hai giao diện chồng nhau)'
  );
  ok(
    (docsScript.exclude_matches || []).some((m) => m.includes('notebooklm.google.com')),
    'phải loại trừ notebooklm.google.com khỏi content script tài liệu'
  );
}

// Bảng chọn nạp CSS qua chrome.runtime.getURL nên file phải web-accessible.
ok(
  (manifest.web_accessible_resources || []).some((e) => e.resources.includes('src/docs/overlay.css')),
  'src/docs/overlay.css phải nằm trong web_accessible_resources'
);

/*
 * manifest.content_scripts PHẢI khớp từng dòng với SCRIPTS trong service worker.
 *
 * Đây là cái bẫy tốn thời gian nhất của dự án và nó đã sập ít nhất một lần: Chrome
 * nạp theo manifest, còn `ensureScripts()` tiêm tay theo danh sách riêng cho tab
 * đã mở từ trước khi cài extension. Lệch nhau thì mọi thứ chạy đúng ở tab mới và
 * chết ở tab cũ bằng một dòng `X is not defined` — triệu chứng phụ thuộc vào việc
 * user mở tab lúc nào, gần như không lần ra được. Comment ở hai đầu là chưa đủ.
 */
const KINDS = {
  youtube: 'src/youtube/',
  notebooklm: 'src/notebooklm/',
  docs: 'src/docs/',
};

const swSource = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');

for (const [kind, dir] of Object.entries(KINDS)) {
  const spec = parseScripts(kind);
  ok(!!spec, `SCRIPTS.${kind} không tồn tại trong service worker`);
  if (!spec) continue;

  const isolated = manifest.content_scripts.find(
    (cs) => cs.world !== 'MAIN' && (cs.js || []).some((f) => f.startsWith(dir))
  );
  ok(!!isolated, `manifest thiếu content script cho ${kind}`);
  if (isolated) {
    same(isolated.js, spec.isolated, `SCRIPTS.${kind}.isolated lệch manifest`);
    same(isolated.css || [], spec.css, `SCRIPTS.${kind}.css lệch manifest`);
  }

  const mainEntry = manifest.content_scripts.find(
    (cs) => cs.world === 'MAIN' && (cs.js || []).some((f) => f.startsWith(dir))
  );
  same(mainEntry ? mainEntry.js : [], spec.main, `SCRIPTS.${kind}.main lệch manifest (MAIN world)`);
}

function same(a, b, message) {
  const equal = JSON.stringify(a) === JSON.stringify(b);
  if (equal) pass++;
  else {
    fail++;
    console.log(`❌ ${message}\n   manifest: ${JSON.stringify(a)}\n   SCRIPTS : ${JSON.stringify(b)}`);
  }
}

/** Bóc `main`/`isolated`/`css` của một mục SCRIPTS ra khỏi mã nguồn service worker. */
function parseScripts(kind) {
  const start = swSource.indexOf(`\n  ${kind}: {`);
  if (start === -1) return null;
  const end = swSource.indexOf('ping:', start);
  const block = swSource.slice(start, end === -1 ? undefined : end);

  const field = (name) => {
    const at = block.indexOf(`${name}: [`);
    if (at === -1) return [];
    const close = block.indexOf(']', at);
    return [...block.slice(at, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  return { main: field('main'), isolated: field('isolated'), css: field('css') };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
