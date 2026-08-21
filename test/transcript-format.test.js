// Bản lưu transcript — bộ chuyển `md` / `srt` / `vtt` (Seam 1, ADR 0011).
//
// Hai cặp cùng kiểu mà `WORKSPACE_PROTOCOL.md` gọi tên nằm trọn trong file được test ở đây,
// nên phần lớn test dưới đây tồn tại để trả lời đúng một câu: **hoán vị thì test nào chết?**
//
//   - `start` ↔ `end` trong một segment: hoán vị vẫn ra SRT parse được, player vẫn mở.
//   - dấu phân cách mili-giây `,` (SRT) ↔ `.` (VTT): file sai định dạng vẫn mở được ở nhiều
//     player, nên không có triệu chứng nào ngoài "một số công cụ khác từ chối".
//
// Vì thế test ở đây chốt **từng ký tự của dòng mốc**, không chỉ "có mốc": một assertion kiểu
// `match(/-->/)` xanh y hệt nhau ở cả hai vế của mỗi phép hoán vị.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/youtube/srt.js';

const S = globalThis.NBLM_SHARED;
const F = globalThis.NBLM_TRANSCRIPT_FORMAT;

const seg = (start, end, text) => ({ start, end, text });

const META = Object.freeze({
  videoId: 'dQw4w9WgXcQ',
  title: 'Học Rust trong 30 phút',
  channel: 'Kênh Lập Trình',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  privacy: 'private',
  durationSeconds: 1800,
});

// --------------------------------------------------------------- clock()

test('clock — mili-giây tách bằng đúng ký tự được truyền vào, giờ luôn hai chữ số', () => {
  assert.equal(F.clock(0, ','), '00:00:00,000');
  assert.equal(F.clock(3661.5, ','), '01:01:01,500');
  assert.equal(F.clock(3661.5, '.'), '01:01:01.500');
});

test('clock — hai dấu phân cách cho hai chuỗi khác nhau, và khác nhau đúng ở một ký tự', () => {
  // Nếu `SRT_MS_SEP` và `VTT_MS_SEP` bị hoán vị cho nhau thì hai hằng số vẫn "hợp lệ" và mọi
  // test chỉ kiểm hình dạng vẫn xanh. Chốt thẳng giá trị của từng hằng số.
  assert.equal(F.SRT_MS_SEP, ',');
  assert.equal(F.VTT_MS_SEP, '.');
  const srt = F.clock(12.345, F.SRT_MS_SEP);
  const vtt = F.clock(12.345, F.VTT_MS_SEP);
  assert.equal(srt, '00:00:12,345');
  assert.equal(vtt, '00:00:12.345');
  assert.equal(srt.replace(',', '.'), vtt);
});

test('clock — làm tròn mili-giây có nhớ sang giây, không ra "00:00:01,1000"', () => {
  assert.equal(F.clock(1.9999, ','), '00:00:02,000');
  assert.equal(F.clock(59.9996, ','), '00:01:00,000');
});

test('clock — giá trị bậy về 0 chứ không ra NaN nằm im giữa file phụ đề', () => {
  assert.equal(F.clock(undefined, ','), '00:00:00,000');
  assert.equal(F.clock(-5, ','), '00:00:00,000');
  assert.equal(F.clock('abc', ','), '00:00:00,000');
});

// --------------------------------------------------------------- withEnds()

test('withEnds — segment không có end lấy start của segment kế, không lấy của chính nó', () => {
  const out = F.withEnds([seg(0, null, 'a'), seg(4, null, 'b')], { cueSeconds: 3 });
  assert.deepEqual(out, [
    { start: 0, end: 4, text: 'a' },
    { start: 4, end: 7, text: 'b' },
  ]);
});

test('withEnds — end đã có thì giữ nguyên, không bị start của segment kế đè lên', () => {
  const out = F.withEnds([seg(0, 2, 'a'), seg(4, 6, 'b')]);
  assert.deepEqual(out, [
    { start: 0, end: 2, text: 'a' },
    { start: 4, end: 6, text: 'b' },
  ]);
});

test('withEnds — end không lớn hơn start là dữ liệu hỏng, không phải một cue dài 0 giây', () => {
  const out = F.withEnds([seg(10, 10, 'a'), seg(20, 5, 'b')], { cueSeconds: 2 });
  assert.deepEqual(out, [
    { start: 10, end: 20, text: 'a' },
    { start: 20, end: 22, text: 'b' },
  ]);
});

// --------------------------------------------------------------- toSrt()

test('toSrt — từng ký tự của một khối: số thứ tự từ 1, mốc ngăn bằng dấu phẩy', () => {
  const text = F.toSrt([seg(1, 4.5, 'Xin chào'), seg(4.5, 9, 'các bạn')]);
  assert.equal(
    text,
    '1\n'
    + '00:00:01,000 --> 00:00:04,500\n'
    + 'Xin chào\n'
    + '\n'
    + '2\n'
    + '00:00:04,500 --> 00:00:09,000\n'
    + 'các bạn\n',
  );
});

test('toSrt — start đứng trước, end đứng sau: hoán vị hai vế cho ra một file khác hẳn', () => {
  const forward = F.toSrt([seg(1, 4.5, 'một dòng')]);
  const swapped = F.toSrt([seg(4.5, 1, 'một dòng')]);
  // Cả hai đều là SRT hợp lệ về hình dạng — đó chính là lý do phải chốt đúng chuỗi.
  assert.equal(forward.split('\n')[1], '00:00:01,000 --> 00:00:04,500');
  assert.notEqual(swapped.split('\n')[1], forward.split('\n')[1]);
});

test('toSrt — đánh số theo segment thực sự ghi ra, không theo chỉ số của mảng vào', () => {
  const text = F.toSrt([seg(0, 1, '   '), seg(1, 2, 'có chữ'), seg(2, 3, 'thêm dòng')]);
  assert.equal(text.split('\n')[0], '1');
  assert.match(text, /^2\n00:00:02,000 --> 00:00:03,000\nthêm dòng$/m);
});

// --------------------------------------------------------------- toVtt()

test('toVtt — có dòng WEBVTT ở đầu và mốc ngăn bằng dấu chấm', () => {
  const text = F.toVtt([seg(1, 4.5, 'Xin chào')]);
  assert.equal(
    text,
    'WEBVTT\n'
    + '\n'
    + '00:00:01,000 --> 00:00:04,500\n'.replace(/,/g, '.')
    + 'Xin chào\n',
  );
});

test('toVtt và toSrt khác nhau đúng ở dấu phân cách và phần đầu, không đổi chỗ cho nhau', () => {
  const segments = [seg(1, 4.5, 'Xin chào'), seg(4.5, 9, 'các bạn')];
  const srt = F.toSrt(segments);
  const vtt = F.toVtt(segments);
  assert.ok(srt.includes('00:00:01,000 --> 00:00:04,500'), 'SRT phải dùng dấu phẩy');
  assert.ok(vtt.includes('00:00:01.000 --> 00:00:04.500'), 'VTT phải dùng dấu chấm');
  assert.ok(!srt.includes('00:00:01.000'), 'SRT không được mang dấu chấm của VTT');
  assert.ok(!vtt.includes('00:00:01,000'), 'VTT không được mang dấu phẩy của SRT');
  assert.ok(!srt.startsWith('WEBVTT'));
  assert.ok(vtt.startsWith('WEBVTT'));
});

// --------------------------------------------------------------- toMarkdown()

test('toMarkdown — header ngữ cảnh rồi tới dòng transcript đã gộp theo cửa sổ', () => {
  const text = F.toMarkdown(META, [seg(0, 2, 'Xin chào'), seg(5, 7, 'các bạn'), seg(90, 92, 'kết thúc')], {
    mergeWindowSeconds: 30,
  });
  assert.equal(text, [
    '# Học Rust trong 30 phút',
    '- Kênh: Kênh Lập Trình',
    '- Link gốc: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '- Thời lượng: [30:00]',
    '- Mức riêng tư: private',
    '',
    '[00:00] Xin chào các bạn',
    '[01:30] kết thúc',
  ].join('\n'));
});

test('toMarkdown — tiêu đề vào dòng tiêu đề, kênh vào dòng kênh, không đổi chỗ', () => {
  const text = F.toMarkdown(META, [seg(0, 1, 'a')], { mergeWindowSeconds: 0 });
  assert.ok(text.includes(`# ${META.title}`), 'tiêu đề phải là dòng tiêu đề');
  assert.ok(text.includes(`- Kênh: ${META.channel}`), 'kênh phải là dòng kênh');
  assert.ok(!text.includes(`# ${META.channel}`), 'đổi chỗ hai thứ vẫn ra một file đọc trôi chảy');
});

// --------------------------------------------------------------- render()

test('render — mỗi định dạng ra đúng đuôi file, đúng MIME và đúng thân file', () => {
  const segments = [seg(1, 4.5, 'Xin chào')];
  for (const format of F.FORMATS) {
    const file = F.render(format, META, segments, { mergeWindowSeconds: 30 });
    assert.equal(file.format, format);
    assert.ok(file.filename.endsWith(`.${format}`), `${format}: đuôi file sai — ${file.filename}`);
    assert.equal(file.mime, F.MIME[format]);
    assert.ok(file.text.length > 0);
  }
});

test('render — ba định dạng cho ba thân file khác nhau, không cái nào là bản sao của cái kia', () => {
  const segments = [seg(1, 4.5, 'Xin chào')];
  const bodies = F.FORMATS.map((format) => F.render(format, META, segments, {}).text);
  assert.equal(new Set(bodies).size, F.FORMATS.length);
});

test('render — MIME của srt và vtt không đổi chỗ cho nhau', () => {
  assert.equal(F.MIME.vtt, 'text/vtt');
  assert.notEqual(F.MIME.srt, F.MIME.vtt);
  assert.equal(F.render('vtt', META, [seg(0, 1, 'a')], {}).mime, 'text/vtt');
});

test('render — không có `.txt`: định dạng lạ thì ném lỗi, không lặng lẽ rơi về md (ADR 0011)', () => {
  assert.deepEqual([...F.FORMATS], ['md', 'srt', 'vtt']);
  assert.throws(() => F.render('txt', META, [seg(0, 1, 'a')], {}), /txt/);
});

test('render — srt và vtt không mang header ngữ cảnh: chúng là file phụ đề, không phải Nguồn', () => {
  const segments = [seg(1, 4.5, 'Xin chào')];
  for (const format of ['srt', 'vtt']) {
    const file = F.render(format, META, segments, {});
    assert.ok(!file.text.includes(META.channel), `${format} không được mang header ngữ cảnh`);
  }
});

test('render — srt/vtt giữ nguyên từng segment, md mới là bản đã gộp theo cửa sổ', () => {
  const segments = [seg(0, 2, 'một'), seg(3, 5, 'hai'), seg(6, 8, 'ba')];
  const options = { mergeWindowSeconds: 30 };
  assert.equal(F.render('srt', META, segments, options).text.match(/-->/g).length, 3);
  assert.equal(F.render('md', META, segments, options).text.match(/^\[/gm).length, 1);
});

// --------------------------------------------------------------- fileName()

test('fileName — tên file mang tiêu đề và videoId, đuôi theo định dạng', () => {
  const name = F.fileName(META, 'srt');
  assert.ok(name.startsWith('Học Rust trong 30 phút'), name);
  assert.ok(name.includes(META.videoId), 'videoId trong tên file là thứ phân biệt hai video trùng tên');
  assert.ok(name.endsWith('.srt'), name);
});

test('fileName — ký tự không đặt tên file được bị thay, đường dẫn không thoát ra ngoài', () => {
  const name = F.fileName({ videoId: 'abc', title: '../../etc/passwd: "hỏng" | rất/xấu?' }, 'md');
  assert.ok(!name.includes('/'), name);
  assert.ok(!name.includes('..'), name);
  assert.ok(!/[\\:*?"<>|]/.test(name), name);
  assert.ok(name.endsWith('.md'));
});

test('fileName — video không có tiêu đề vẫn ra tên file dùng được, không ra ".md" trần', () => {
  const name = F.fileName({ videoId: 'dQw4w9WgXcQ' }, 'md');
  assert.equal(name, 'dQw4w9WgXcQ.md');
});

test('fileName — tiêu đề dài bị cắt, nhưng videoId và đuôi file thì không bao giờ mất', () => {
  const name = F.fileName({ videoId: 'dQw4w9WgXcQ', title: 'a'.repeat(400) }, 'vtt');
  assert.ok(name.length <= F.MAX_FILENAME, `${name.length} ký tự`);
  assert.ok(name.includes('dQw4w9WgXcQ'));
  assert.ok(name.endsWith('.vtt'));
});

// --------------------------------------------------------------- dataUrl()

test('dataUrl — chữ tiếng Việt đi qua data URL rồi về vẫn nguyên dấu', () => {
  const url = F.dataUrl('Xin chào — đủ dấu', 'text/plain');
  assert.ok(url.startsWith('data:text/plain;charset=utf-8,'));
  assert.equal(decodeURIComponent(url.slice('data:text/plain;charset=utf-8,'.length)), 'Xin chào — đủ dấu');
});

test('dataUrl — MIME của file đi vào data URL, không phải một MIME cố định', () => {
  assert.ok(F.dataUrl('a', F.MIME.vtt).startsWith(`data:${F.MIME.vtt};`));
  assert.ok(F.dataUrl('a', F.MIME.srt).startsWith(`data:${F.MIME.srt};`));
});

test('bộ chuyển không cần DOM, không cần chrome: đây là Seam 1', () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof S.sourceBody, 'function');
});
