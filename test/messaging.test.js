/*
 * Kỷ luật định tuyến tin nhắn giữa các content script.
 *
 * Bối cảnh — một lỗi đã thực sự xảy ra: `exclude_matches` trong manifest chỉ chi
 * phối lúc Chrome tự tiêm content script, KHÔNG chặn `chrome.scripting.executeScript`.
 * Mở bảng chọn tài liệu trên chính tab NotebookLM là đặt hai content script lên
 * cùng một tab. Khi hai listener cùng nghe, Chrome lấy **phản hồi đến trước** —
 * script tài liệu trả lời "lệnh lạ: nlm-ping" và cướp mất câu trả lời thật, khiến
 * mọi lần import sau đó chết bằng một lỗi trỏ sai hoàn toàn chỗ ("tab không ở
 * trong notebook" trong khi tab đang mở đúng notebook).
 *
 * Nên mỗi listener phải lọc theo `HANDLED` rồi im lặng với tin của script khác.
 * Test này canh hai điều: có lọc, và tập lọc khớp đúng các `case` đang xử lý.
 */
const fs = require('fs');
const path = require('path');

global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
require(__dirname + '/../src/common/shared.js');
const { MSG } = global.NBLM;

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));

/** `case MSG.YT_PING:` / `case 'nblm-hud':` -> giá trị chuỗi thật. */
function literals(source) {
  const out = [];
  for (const [, token] of source.matchAll(/case (MSG\.\w+|'[^']+'):/g)) {
    if (token.startsWith('MSG.')) {
      const key = token.slice(4);
      if (MSG[key] === undefined) {
        fail++;
        console.log(`❌ MSG.${key} được dùng nhưng không tồn tại trong shared.js`);
        continue;
      }
      out.push(MSG[key]);
    } else {
      out.push(token.slice(1, -1));
    }
  }
  return out;
}

function handledSet(source) {
  const at = source.indexOf('const HANDLED = new Set([');
  if (at === -1) return null;
  const chunk = source.slice(at, source.indexOf(']', at));
  return literals(chunk.replace(/(MSG\.\w+|'[^']+')/g, 'case $1:'));
}

const files = new Set(manifest.content_scripts.flatMap((cs) => cs.js || []));
let checked = 0;

for (const file of files) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = source.indexOf('chrome.runtime.onMessage.addListener');
  if (at === -1) continue; // không phải router
  checked++;

  const router = source.slice(at);
  const guard = /addListener\(\([^)]*\)\s*=>\s*\{\s*(?:\/\/[^\n]*\n\s*)*if \(!message \|\| !HANDLED\.has\(message\.type\)\) return false;/;
  ok(guard.test(router), `${file}: listener phải lọc \`HANDLED.has(message.type)\` và return false trước khi xử lý`);

  const handled = handledSet(source);
  ok(handled !== null, `${file}: thiếu khai báo \`const HANDLED = new Set([...])\``);
  if (!handled) continue;

  const cases = literals(router);
  const missing = cases.filter((c) => !handled.includes(c));
  const stale = handled.filter((h) => !cases.includes(h));

  ok(!missing.length, `${file}: có case nhưng thiếu trong HANDLED -> tin bị nuốt im lặng: ${missing.join(', ')}`);
  ok(!stale.length, `${file}: HANDLED thừa loại không có case -> cướp phản hồi của script khác: ${stale.join(', ')}`);
}

ok(checked >= 3, `phải soát được ít nhất 3 router content script, mới soát ${checked}`);

// Không content script nào được đăng ký trùng loại tin với script khác: cùng nằm
// trên một tab thì hai bên sẽ tranh nhau trả lời.
const owners = new Map();
for (const file of files) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (!source.includes('chrome.runtime.onMessage.addListener')) continue;
  for (const type of handledSet(source) || []) {
    if (type === 'nblm-hud' || type === 'nblm-toast') continue; // HUD/toast cục bộ, khác trang
    ok(!owners.has(type), `loại tin "${type}" bị cả ${owners.get(type)} và ${file} nhận`);
    owners.set(type, file);
  }
}

/*
 * Lớp phòng thủ thứ hai, ở phía service worker.
 *
 * `ensureScripts()` là nút thắt duy nhất trả lời "script đúng có sống trên tab
 * này không". Nếu nó chỉ kiểm "có phản hồi" thì một script lạ đáp {ok:false} vẫn
 * được tính là sống — chính là nửa sau của cơ chế lỗi ở trên. Hợp đồng đi kèm:
 * mọi handler ping phải trả `ok: true`.
 */
const sw = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
const ensureAt = sw.indexOf('async function ensureScripts');
ok(ensureAt !== -1, 'không tìm thấy ensureScripts trong service worker');
if (ensureAt !== -1) {
  const body = sw.slice(ensureAt, sw.indexOf('\n}\n', ensureAt));
  ok(
    /\bpong\s*&&\s*pong\.ok\b|\bresponse\s*&&\s*response\.ok\b|!\w+\s*\|\|\s*!\w+\.ok\b/.test(body),
    'ensureScripts phải kiểm `ok` của phản hồi ping, không chỉ kiểm có phản hồi'
  );
}

for (const file of files) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const at = source.search(/case MSG\.\w*PING:/);
  if (at === -1) continue;
  // Cắt đúng tới `return;` của case này. Cắt theo số ký tự cố định là trượt sang
  // case kế bên và bắt nhầm `ok: true` của nó — test sẽ xanh cả khi handler sai.
  const end = source.indexOf('return;', at);
  ok(
    /ok:\s*true/.test(source.slice(at, end === -1 ? at + 260 : end)),
    `${file}: handler ping phải trả \`ok: true\` (ensureScripts dựa vào cờ này)`
  );
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
