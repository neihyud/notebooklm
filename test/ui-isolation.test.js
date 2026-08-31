/*
 * Giao diện extension chèn vào trang phải tách bạch khỏi giao diện của trang.
 *
 * Bối cảnh — một lỗi đã thực sự xảy ra: `findTranscriptButton()` quét mọi <button>
 * khớp /transcript/i để tìm nút "Show transcript" của YouTube. Nhưng extension tự
 * thêm một nút nhãn "Transcript" vào ngay hàng nút của trang watch, và nó nằm
 * TRƯỚC nút thật trong DOM. Kết quả: hàm bấm vào chính nó, panel YouTube không
 * bao giờ mở, và phương án DOM — đường đáng tin nhất cho video private — chết câm
 * với một thông báo đổ lỗi cho YouTube.
 *
 * Hai bất biến giữ cho chuyện đó không lặp lại.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));

const walk = (dir) =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    return e.isDirectory() ? walk(rel) : [rel];
  });

const scripts = walk('src').filter((f) => f.endsWith('.js'));

/*
 * 1. Mọi id do extension tạo phải mang tiền tố `nblm-`.
 *    Selector loại trừ dùng `[id^="nblm-"]`, nên một id không theo tiền tố là
 *    lọt lưới ngay mà không có triệu chứng gì.
 */
let idCount = 0;
for (const file of scripts) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of source.matchAll(/\.id = '([^']+)'/g)) {
    idCount++;
    ok(m[1].startsWith('nblm-'), `${file}: id "${m[1]}" phải bắt đầu bằng "nblm-" (nếu không sẽ lọt lưới loại trừ)`);
  }
}
ok(idCount >= 5, `phải tìm thấy ít nhất 5 id do extension tạo, mới thấy ${idCount}`);

/*
 * 2. findTranscriptButton phải loại trừ giao diện của chính extension.
 */
const transcript = fs.readFileSync(path.join(ROOT, 'src/youtube/transcript.js'), 'utf8');

const at = transcript.indexOf('function findTranscriptButton');
ok(at !== -1, 'không tìm thấy findTranscriptButton');
if (at !== -1) {
  const body = transcript.slice(at, transcript.indexOf('\n  }', at));
  ok(/isOwnUi\(/.test(body), 'findTranscriptButton phải lọc bỏ giao diện của chính extension qua isOwnUi()');
}

ok(/const OWN_UI = /.test(transcript), 'transcript.js phải khai OWN_UI — selector nhận diện giao diện của extension');
const ownUi = (transcript.match(/const OWN_UI = '([^']+)'/) || [])[1] || '';
ok(ownUi.includes('[id^="nblm-"]'), 'OWN_UI phải phủ mọi phần tử có id tiền tố nblm-');

// Nút Transcript của extension khớp regex tìm nút — chính là cái bẫy. Xác nhận
// regex vẫn khớp (nên việc loại trừ là bắt buộc, không phải trang trí).
const label = (transcript.match(/const TRANSCRIPT_LABEL = (\/.+\/i);/) || [])[1];
ok(!!label, 'không đọc được TRANSCRIPT_LABEL');
if (label) {
  const re = eval(label); // chuỗi literal lấy từ chính mã nguồn
  ok(re.test('Transcript'), 'TRANSCRIPT_LABEL vẫn khớp nhãn nút của extension -> loại trừ là bắt buộc');
}

/* ------------------------------------------------------------------ */
/* bảng docs: mọi class được gắn phải TỒN TẠI trong stylesheet của nó   */
/* ------------------------------------------------------------------ */

/*
 * Bảng tài liệu nằm trong shadow root và chỉ nạp `src/docs/overlay.css`. Class
 * nào không được định nghĩa trong ĐÚNG file đó thì không có gì áp lên nó —
 * `popup.css` không với tới được. Đo thật: `.btn--ghost` được gắn cho *Copy lại*
 * và *Copy link* từ lâu mà chỉ tồn tại trong `popup.css`, nên cả hai render y
 * hệt nút chính *Thêm N trang* và không còn phân cấp nào.
 *
 * PHẠM VI, nói thẳng: đây là phép đo trên VĂN BẢN, không phải trên hình. Nó bắt
 * được "class không có luật nào", KHÔNG bắt được "có luật nhưng thua cascade".
 * Chỗ đó chỉ trình duyệt thật trả lời được — đúng bài học của ca nút Dừng, nơi
 * test jsdom xanh trong khi nút vẫn hiện trên màn hình.
 */
const docsJs = fs.readFileSync(path.join(ROOT, 'src/docs/content.js'), 'utf8');
const docsCss = fs.readFileSync(path.join(ROOT, 'src/docs/overlay.css'), 'utf8');

/*
 * Bỏ mọi khối `@media` trước khi tra. Một class chỉ được định nghĩa bên trong
 * `@media (prefers-color-scheme: dark)` là KHÔNG được định nghĩa cho nền sáng —
 * và `includes('.btn--ghost')` trần thì khối dark cũng khớp, nên hoán vị gỡ luật
 * gốc vẫn xanh. Đo thật 2026-08-31: đúng như vậy, 0 đỏ.
 */
const stripMedia = (css) => {
  let out = '', i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) { out += css.slice(i); break; }
    out += css.slice(i, at);
    let j = css.indexOf('{', at), depth = 0;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) { j++; break; }
    }
    i = j;
  }
  return out;
};
const baseCss = stripMedia(docsCss);

const mods = [...new Set(docsJs.match(/btn--[a-z0-9-]+/g) || [])];
ok(mods.length > 0, 'không đọc được class nào từ src/docs/content.js — phép đo này đang rỗng');
for (const m of mods) {
  // Selector TRẦN (`.btn--x {` hoặc `.btn--x,`), không tính `.btn--x:hover`:
  // một luật chỉ có ở trạng thái hover thì trạng thái thường vẫn không có gì.
  ok(new RegExp(`\\.${m}\\s*[,{]`).test(baseCss),
    `class .${m} được gắn trong src/docs/content.js nhưng KHÔNG có luật nền nào trong src/docs/overlay.css`);
}

/*
 * `[hidden]` của UA stylesheet thua BẤT KỲ author rule nào đặt `display`. Bảng
 * này ẩn/hiện nút *Copy lại* bằng thuộc tính `hidden`, nên thiếu dòng dưới đây
 * là một `display` mọc thêm ở `.btn` sẽ làm nút hiện lên trên trình duyệt thật
 * trong khi `btn.hidden === true` — và mọi test đọc IDL property vẫn xanh 100%.
 */
ok(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(docsCss),
  'src/docs/overlay.css phải có `[hidden] { display: none !important }` — không có thì thuộc tính hidden là lời hứa suông');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
