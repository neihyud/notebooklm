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

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
