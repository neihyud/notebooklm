global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
require(__dirname + '/../src/common/shared.js');
const N = global.NBLM;
let pass = 0, fail = 0;
const eq = (a, b, m) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, console.log(`❌ ${m}\n   nhận: ${JSON.stringify(a)}\n   mong: ${JSON.stringify(b)}`));
};

// videoIdFrom
eq(N.videoIdFrom('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'watch');
eq(N.videoIdFrom('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ', 'youtu.be + t');
eq(N.videoIdFrom('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'shorts');
eq(N.videoIdFrom('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'live');
eq(N.videoIdFrom('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'embed');
eq(N.videoIdFrom('/watch?v=dQw4w9WgXcQ&list=PL123'), 'dQw4w9WgXcQ', 'href tương đối');
eq(N.videoIdFrom('dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'id trần');
eq(N.videoIdFrom('https://vimeo.com/12345'), null, 'không phải youtube');
eq(N.videoIdFrom('https://www.youtube.com/@kenh'), null, 'trang kênh');
eq(N.videoIdFrom(''), null, 'rỗng');
eq(N.videoIdFrom('https://www.youtube.com/watch?v=short'), null, 'id sai độ dài');

// parseUrlList: khử trùng lặp + nhiều định dạng lẫn lộn
eq(N.parseUrlList(`https://youtu.be/aaaaaaaaaaa
https://www.youtube.com/watch?v=bbbbbbbbbbb
https://youtu.be/aaaaaaaaaaa
rác không phải link`), ['aaaaaaaaaaa','bbbbbbbbbbb'], 'parseUrlList');

// norm: bỏ dấu tiếng Việt (mấu chốt của việc khớp nhãn giao diện)
eq(N.norm('Thêm nguồn'), 'them nguon', 'norm có dấu');
eq(N.norm('  VĂN BẢN đã Sao Chép '), 'van ban da sao chep', 'norm hoa/thường + khoảng trắng');
eq(N.norm('Đóng'), 'dong', 'norm chữ Đ');

// fmtTime
eq(N.fmtTime(0), '0:00', 'fmt 0'); eq(N.fmtTime(75), '1:15', 'fmt 75'); eq(N.fmtTime(3725), '1:02:05', 'fmt giờ');

// renderSegments: gộp theo mốc 30 giây
const segs = [
  {start:0,text:'xin chao'},{start:10,text:'moi nguoi'},
  {start:35,text:'hom nay'},{start:70,text:'ket thuc'},
];
eq(N.renderSegments(segs, {includeTimestamps:true, groupSeconds:30}),
   '[0:00] xin chao moi nguoi\n[0:35] hom nay\n[1:10] ket thuc', 'gộp 30s');
eq(N.renderSegments(segs, {includeTimestamps:true, groupSeconds:0}),
   '[0:00] xin chao\n[0:10] moi nguoi\n[0:35] hom nay\n[1:10] ket thuc', 'không gộp');
eq(N.renderSegments(segs, {includeTimestamps:false}), 'xin chao moi nguoi hom nay ket thuc', 'không timestamp');
eq(N.renderSegments([], {}), '(không có transcript)', 'transcript rỗng');

// buildSourceText phải ghi rõ mức riêng tư + có link gốc
const txt = N.buildSourceText(
  {videoId:'dQw4w9WgXcQ', title:'Ghi chú nội bộ', channel:'Kênh của tôi', privacy:'private', durationSec:75, method:'dom:panel'},
  segs, {includeTimestamps:true, groupSeconds:30});
eq(/Riêng tư \(private\)/.test(txt), true, 'header ghi private');
eq(txt.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true, 'header có URL');
eq(txt.includes('[0:35] hom nay'), true, 'thân bài có transcript');


/* --- toDataUrl: chỗ btoa hay chết ------------------------------------ */

const dec = (url) => {
  const b64 = url.slice(url.indexOf('base64,') + 7);
  return Buffer.from(b64, 'base64').toString('utf-8');
};

eq(dec(N.toDataUrl('hello')), 'hello', 'ASCII đi qua nguyên vẹn');
// btoa() ném lỗi với ký tự ngoài Latin-1 -> phải mã hoá UTF-8 trước.
eq(dec(N.toDataUrl('Tiếng Việt có dấu')), 'Tiếng Việt có dấu', 'tiếng Việt không vỡ');
eq(dec(N.toDataUrl('오빤 강남스타일')), '오빤 강남스타일', 'tiếng Hàn không vỡ');
eq(dec(N.toDataUrl('♪ nhạc ♪ — em dash')), '♪ nhạc ♪ — em dash', 'ký hiệu nhạc + em dash');
eq(N.toDataUrl('x', 'text/markdown').startsWith('data:text/markdown;charset=utf-8;base64,'), true, 'giữ đúng mime');

// String.fromCharCode(...mảng lớn) tràn ngăn xếp -> phải chia khúc.
const big = 'á'.repeat(200000);
let bigOk = true;
try { bigOk = dec(N.toDataUrl(big)) === big; } catch (e) { bigOk = 'ném lỗi: ' + e.message; }
eq(bigOk, true, 'transcript 200k ký tự non-ASCII không tràn ngăn xếp');

/* --- downloadName ---------------------------------------------------- */

eq(N.downloadName({ title: 'A/B:C*D?E"F<G>H|I' }, 'srt'), 'ABCDEFGHI.srt', 'lọc ký tự Windows cấm');
eq(N.downloadName({ title: 'Bài 1' }, 'txt', 7), '007 - Bài 1.txt', 'có tiền tố số thứ tự');
eq(N.downloadName({ videoId: 'abc' }, 'md'), 'abc.md', 'không tiêu đề thì dùng videoId');
eq(N.downloadName({ title: '   ' }, 'txt'), 'transcript.txt', 'tiêu đề rỗng thì dùng tên mặc định');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
