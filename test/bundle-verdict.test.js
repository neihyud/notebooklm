/*
 * Vị ngữ cấp phép vào Bó link — mục 5 của `docs/tickets/006-duong-trao-tay.md`.
 *
 * Bó link là đường ĐẦU TIÊN bỏ hẳn service worker ra ngoài: content script ghi
 * thẳng clipboard, không qua `resolveMeta`, không qua `planFor`. Nghĩa là bất
 * biến ở `README.md:15` — *"Không bao giờ gửi URL cho NotebookLM"* với video
 * private — không tự đi theo. Nó được dựng lại ở đây, và chỉ ở đây.
 *
 * Nên mọi test dưới đây đọc theo một chiều: thiếu dữ kiện phải ra `UNKNOWN`
 * (Hàng đợi), không bao giờ ra `ACCEPT`.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { self: {}, chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/common/shared.js'), 'utf8'), sandbox);
const N = sandbox.self.NBLM;

let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

const ID = 'aaaaaaaaaaa';
const meta = (over = {}) =>
  Object.assign({ videoId: ID, title: 'T', privacy: 'public', playable: true, reason: null }, over);
const verdict = (videoId, m) => N.bundleVerdict(videoId, m).verdict;

/* ------------------------------------------------------------------ */
/* cửa 3 — ba điều kiện                                                */
/* ------------------------------------------------------------------ */

eq(verdict(ID, meta()), N.BUNDLE.ACCEPT, 'đủ ba điều kiện thì vào Bó link');

eq(verdict(ID, meta({ privacy: 'private' })), N.BUNDLE.RESTRICTED, 'private KHÔNG bao giờ vào Bó link');
eq(verdict(ID, meta({ privacy: 'unlisted' })), N.BUNDLE.RESTRICTED,
  'unlisted KHÔNG bao giờ vào Bó link — Đường trao tay không có Rơi xuống, không ai đứng đó nhìn thấy nó hỏng');
eq(N.bundleVerdict(ID, meta({ privacy: 'private' })).why, 'private', 'lý do loại phải nói rõ hạng nào');

/*
 * Điều kiện videoId khớp. Đây là điều kiện bắt được ca nguy hiểm nhất, và nó
 * KHÔNG thừa: `metaFrom({})` trả `{videoId: null, privacy: 'public', playable:
 * true}` vì `metaFrom` mở bằng `let privacy = 'public'` — fall-through, không
 * phải phép đo. Bỏ điều kiện này thì một lượt hỏi trả về rỗng tự xưng là công khai.
 */
eq(verdict(ID, meta({ videoId: 'bbbbbbbbbbb' })), N.BUNDLE.UNKNOWN,
  'player response trả về video KHÁC thì không được nhận — đó là câu trả lời cho câu hỏi khác');
eq(verdict(ID, meta({ videoId: null })), N.BUNDLE.UNKNOWN,
  'meta rỗng tự xưng public (fall-through của metaFrom) phải bị chặn ở điều kiện videoId');
eq(verdict(ID, { videoId: null, privacy: 'public', playable: true }), N.BUNDLE.UNKNOWN,
  'đúng hình dạng metaFrom({}) — ca này phải ra UNKNOWN, không phải ACCEPT');

eq(verdict(ID, meta({ playable: false })), N.BUNDLE.UNKNOWN, 'video không phát được thì không vào Bó');
eq(N.bundleVerdict(ID, meta({ playable: false, reason: 'Video unavailable' })).why, 'Video unavailable',
  'lý do không phát được phải giữ nguyên văn của YouTube');

eq(verdict(ID, meta({ privacy: 'unknown' })), N.BUNDLE.UNKNOWN, 'privacy unknown thì không đoán');
eq(verdict(ID, meta({ privacy: undefined })), N.BUNDLE.UNKNOWN, 'privacy rỗng thì không đoán');
eq(verdict(ID, null), N.BUNDLE.UNKNOWN, 'không hỏi được player response thì UNKNOWN');
eq(verdict(null, meta()), N.BUNDLE.UNKNOWN, 'không có videoId thì UNKNOWN');

/* Fail-closed toàn diện: không một meta thiếu dữ kiện nào được ra ACCEPT. */
for (const broken of [{}, { videoId: ID }, { videoId: ID, privacy: 'public' }, { privacy: 'public', playable: true }]) {
  ok(N.bundleVerdict(ID, broken).verdict !== N.BUNDLE.ACCEPT,
    `meta thiếu dữ kiện không được nhận: ${JSON.stringify(broken)}`);
}

/* ------------------------------------------------------------------ */
/* cửa 1 — huy hiệu chỉ được LOẠI                                      */
/* ------------------------------------------------------------------ */

ok(N.badgeRejects({ privacy: 'private' }), 'huy hiệu Private phải loại ngay, không tốn một request nào');
ok(N.badgeRejects({ privacy: 'unlisted' }), 'huy hiệu Unlisted phải loại ngay');
ok(N.badgeRejects({ accessible: false }), 'video không có quyền xem phải loại ngay');
ok(!N.badgeRejects({ privacy: 'unknown' }),
  'huy hiệu unknown KHÔNG được loại — với video công khai YouTube không gắn huy hiệu nào, loại ở đây là lọc sạch mọi video');
ok(!N.badgeRejects({ privacy: 'public' }), 'huy hiệu public không loại — nhưng cũng không có nghĩa là nhận');
ok(!N.badgeRejects({}), 'không có thông tin gì thì không loại, phải đi hỏi tiếp');

/*
 * Huy hiệu không có quyền NHẬN — kiểm bằng chính chữ ký hàm: `badgeRejects` chỉ
 * trả boolean "có loại không", nên không có đường nào để nó cấp phép. Một hàm
 * trả ba hạng ở đây sẽ mở đúng cái cửa ADR 0001 đã đóng.
 */
ok(typeof N.badgeRejects({ privacy: 'public' }) === 'boolean',
  'badgeRejects phải trả boolean — nó không được có ngôn ngữ để nói "nhận"');

/* ------------------------------------------------------------------ */
/* noFallback — cái giá của một lượt hỏi hỏng                          */
/* ------------------------------------------------------------------ */

/*
 * `getPlayerResponse` rơi xuống `fetchWatchPage` khi InnerTube hỏng: tải NGUYÊN
 * trang watch. Ở n=1 đó là lưới cứu; ở n=200 đó là 200 lượt tải HTML đầy đủ mà
 * không ai nhìn thấy ở chỗ nó phát sinh. Cửa 3 phải tắt được nhánh đó.
 *
 * Ghim ở tầng `describe` vì đó là chỗ ta kiểm được: `page-bridge.js` chạy trong
 * MAIN world và nói chuyện với YouTube thật, không có test tự động nào với tới.
 * Cái test này chứng nhận cờ ĐI TỚI cầu nối trang; nó KHÔNG chứng nhận cầu nối
 * xử lý cờ đúng — chỉ chạy thật mới trả lời được.
 */
{
  const { loadTranscriptPanel } = require('./dom-harness.js');
  const { win, T } = loadTranscriptPanel({ total: 0 });
  const calls = [];
  win.NBLM_BRIDGE = { call: async (op, args, timeout) => (calls.push({ op, args, timeout }), {}) };

  T.describe('aaaaaaaaaaa');
  eq(calls[0].args, { videoId: 'aaaaaaaaaaa', noFallback: false },
    'describe mặc định GIỮ nhánh tải trang watch — đường một video vẫn cần lưới cứu đó');

  T.describe('aaaaaaaaaaa', { noFallback: true });
  eq(calls[1].args, { videoId: 'aaaaaaaaaaa', noFallback: true },
    'describe phải chuyển cờ noFallback xuống cầu nối trang, không nuốt mất');

  win.close();
}

/* ------------------------------------------------------------------ */
/* trần đồng thời                                                       */
/* ------------------------------------------------------------------ */

(async () => {
  /* Thứ tự kết quả phải theo thứ tự đầu vào, dù chạy song song và xong lộn xộn. */
  const out = await N.mapWithLimit([5, 1, 3], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n));
    return n * 10;
  });
  eq(out, [50, 10, 30], 'mapWithLimit phải giữ nguyên thứ tự đầu vào');

  /* Trần thật sự chặn: đo số lượt chạy song song lớn nhất. */
  let live = 0, peak = 0;
  await N.mapWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
  });
  ok(peak <= 3, `trần đồng thời phải chặn ở 3, đo được ${peak}`);
  ok(peak === 3, `trần phải được dùng hết chứ không chạy tuần tự, đo được ${peak}`);

  eq(await N.mapWithLimit([], 3, async () => 1), [], 'danh sách rỗng thì trả mảng rỗng, không treo');

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
