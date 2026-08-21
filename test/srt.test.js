/*
 * Test bộ chuyển định dạng transcript.
 * Điểm đáng test nhất: suy ra mốc kết thúc. Phương án quét DOM panel chỉ cho
 * mốc bắt đầu, mà SRT thì bắt buộc phải có mốc kết thúc — sai chỗ này là file
 * .srt tải về hiển thị sai hoàn toàn.
 */
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
require(__dirname + '/../src/common/shared.js');
require(__dirname + '/../src/youtube/srt.js');

const F = global.NBLM_SRT;
let pass = 0, fail = 0;
const eq = (a, b, m) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, console.log(`❌ ${m}\n   nhận: ${JSON.stringify(a)}\n   mong: ${JSON.stringify(b)}`));
};

/* --- withEnds ------------------------------------------------------- */

const noEnds = [
  { start: 0, end: null, text: 'một' },
  { start: 5, end: null, text: 'hai' },
  { start: 12, end: null, text: 'ba' },
];
eq(F.withEnds(noEnds).map((s) => s.end), [5, 12, 16], 'end suy từ start của dòng kế, dòng cuối +4s');

eq(
  F.withEnds([{ start: 0, end: 3.5, text: 'x' }, { start: 5, end: 9, text: 'y' }]).map((s) => s.end),
  [3.5, 9],
  'end có sẵn thì giữ nguyên'
);

// end <= start là dữ liệu rác, phải suy lại chứ không được để âm
eq(F.withEnds([{ start: 10, end: 4, text: 'a' }, { start: 20, end: null, text: 'b' }])[0].end, 20, 'end nhỏ hơn start thì suy lại');
eq(F.withEnds([{ start: 0, text: 'a' }, { start: 0, text: 'b' }])[0].end, 4, 'hai dòng cùng mốc thì dùng khoảng mặc định');
eq(F.withEnds([]), [], 'danh sách rỗng');
eq(F.withEnds([{ start: 1, text: '' }, { start: 2, text: 'ok' }]).length, 1, 'bỏ dòng rỗng');

/* --- srtStamp ------------------------------------------------------- */

eq(F.srtStamp(0), '00:00:00,000', 'stamp 0');
eq(F.srtStamp(75.5), '00:01:15,500', 'stamp phút + mili');
eq(F.srtStamp(3661.25), '01:01:01,250', 'stamp giờ');
eq(F.srtStamp(-5), '00:00:00,000', 'stamp âm bị kẹp về 0');
eq(F.srtStamp(1.5, '.'), '00:00:01.500', 'WebVTT dùng dấu chấm');

/* --- toSrt ---------------------------------------------------------- */

eq(
  F.toSrt(noEnds),
  '1\n00:00:00,000 --> 00:00:05,000\nmột\n\n' +
  '2\n00:00:05,000 --> 00:00:12,000\nhai\n\n' +
  '3\n00:00:12,000 --> 00:00:16,000\nba\n',
  'SRT đầy đủ: đánh số từ 1, cách nhau dòng trống, kết thúc bằng newline'
);
eq(F.toSrt([]), '', 'SRT rỗng không sinh rác');

/* --- toVtt ---------------------------------------------------------- */

eq(F.toVtt(noEnds).startsWith('WEBVTT\n\n'), true, 'VTT có header');
eq(F.toVtt(noEnds).includes('00:00:00.000 --> 00:00:05.000'), true, 'VTT dùng dấu chấm');

/* --- toTxt ---------------------------------------------------------- */

eq(F.toTxt(noEnds), '[0:00] một\n[0:05] hai\n[0:12] ba', 'txt có timestamp');
eq(F.toTxt(noEnds, { timestamps: false }), 'một hai ba', 'txt không timestamp thì gộp một dòng');
eq(F.toTxt([]), '', 'txt rỗng');

/* --- toMarkdown ----------------------------------------------------- */

const md = F.toMarkdown(noEnds, { videoId: 'dQw4w9WgXcQ', title: 'Ghi chú', channel: 'Kênh tôi', durationSec: 16 });
eq(md.startsWith('# Ghi chú\n'), true, 'md có tiêu đề h1');
eq(md.includes('- **Kênh:** Kênh tôi'), true, 'md có kênh');
eq(
  md.includes('[0:05](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s)'),
  true,
  'md có link nhảy tới đúng giây'
);
eq(F.toMarkdown(noEnds, {}).includes('[0:05]('), false, 'không có videoId thì không bịa link');

/* --- fileName ------------------------------------------------------- */

eq(F.fileName({ title: 'A/B:C*D?E"F<G>H|I' }, 'srt'), 'ABCDEFGHI.srt', 'lọc ký tự Windows cấm');
eq(F.fileName({ videoId: 'abc' }, 'txt'), 'abc.txt', 'không có tiêu đề thì dùng videoId');
eq(F.fileName({ title: '   ' }, 'md'), 'transcript.md', 'tiêu đề toàn khoảng trắng thì dùng tên mặc định');
eq(F.fileName({ title: 'x'.repeat(200) }, 'txt').length, 84, 'cắt tên quá dài (80 + ".txt")');

/* --- FORMATS -------------------------------------------------------- */

eq(Object.keys(F.FORMATS).sort(), ['md', 'srt', 'txt', 'vtt'], 'đủ 4 định dạng');
for (const [name, spec] of Object.entries(F.FORMATS)) {
  eq(typeof spec.render(noEnds, { videoId: 'abc' }), 'string', `FORMATS.${name}.render trả chuỗi`);
  eq(!!spec.mime && !!spec.ext, true, `FORMATS.${name} có mime + ext`);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
