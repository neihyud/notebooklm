/*
 * Sổ đã copy và cửa 2 — mục 3 của `docs/tickets/006-duong-trao-tay.md`.
 *
 * Chạy trên `src/background/service-worker.js` THẬT (importScripts giả lập, y
 * như Chrome làm), vì luật khoá là thứ đang được kiểm và nó sống ở đó:
 * `itemKey()` là hàm cục bộ của file này, không nằm trong `shared.js`, và chép
 * nó sang chỗ khác là dựng đúng hình dạng "đường dữ liệu song song" mà repo đã
 * dính một lần.
 *
 * Ba bất biến, và cả ba đều là chuyện đúng/sai chứ không phải chuyện gọn/xấu:
 *   1. Sổ chỉ được ghi SAU khi clipboard đã nhận thật.
 *   2. Khoá của Bó link nói cùng ngôn ngữ với khoá của Hàng đợi.
 *   3. Link bị loại quay về kèm lý do, không bị nuốt.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

const noopEvent = () => ({ addListener() {}, removeListener() {} });
const store = new Map();

/* Service worker gắn mọi thứ vào `self`; trong node thì `self` là `global`. */
global.self = global;
global.importScripts = (...files) => files.forEach((f) => require(path.join(ROOT, f)));
global.chrome = {
  runtime: {
    onMessage: noopEvent(),
    onInstalled: noopEvent(),
    onStartup: noopEvent(),
    getManifest: () => ({ version: '0.0.0-test' }),
    getURL: (p) => `chrome-extension://test/${p}`,
    sendMessage: async () => {},
    lastError: null,
  },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return Object.fromEntries(store);
        const out = {};
        for (const k of Array.isArray(keys) ? keys : [keys]) if (store.has(k)) out[k] = store.get(k);
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, JSON.parse(JSON.stringify(v)));
      },
      async remove(key) {
        for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
      },
    },
    onChanged: noopEvent(),
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: noopEvent() },
  commands: { onCommand: noopEvent() },
  contextMenus: { create() {}, removeAll: (cb) => cb && cb(), onClicked: noopEvent() },
  notifications: { create: async () => {} },
  tabs: { query: async () => [], sendMessage: async () => ({ ok: true }), onRemoved: noopEvent() },
  downloads: { download: async () => 1, search: async () => [], onChanged: noopEvent() },
};

require(path.join(ROOT, 'src/background/service-worker.js'));
const SW = global.NBLM_SW_INTERNALS;
const N = global.NBLM;

const YT = (id) => `https://www.youtube.com/watch?v=${id}`;
const reset = async () => { store.clear(); };
const log = () => store.get('copiedLog') || [];

(async () => {
  ok(SW && typeof SW.filterBundle === 'function', 'service worker phải xuất filterBundle để quan sát được');
  if (!SW || !SW.filterBundle) {
    console.log(`${pass} pass, ${fail} fail`);
    process.exit(1);
  }

  /* ---------------------------------------------------------------- */
  /* khoá: một ngôn ngữ cho cả hai kho                                 */
  /* ---------------------------------------------------------------- */

  eq(SW.bundleKey(YT('aaaaaaaaaaa')), 'yt:aaaaaaaaaaa',
    'khoá của URL YouTube phải trùng dạng khoá Hàng đợi dùng (`yt:<videoId>`)');
  eq(SW.bundleKey('https://youtu.be/aaaaaaaaaaa'), 'yt:aaaaaaaaaaa',
    'youtu.be và watch?v= là cùng một video, phải ra cùng một khoá');
  eq(SW.bundleKey('https://a.dev/docs/x'), 'https://a.dev/docs/x', 'URL tài liệu lấy khoá qua docKey');

  /*
   * Ba URL tài liệu chỉ khác nhau ở phần `docKey` dọn — chúng là CÙNG một trang.
   * Đây là hoán vị số 2 của mục acceptance: dùng `row.url` làm khoá thay cho
   * `docKey(row.url)` thì cùng một trang vào notebook ba lần.
   */
  const trio = ['https://a.dev/docs/x', 'https://a.dev/docs/x/', 'https://a.dev/docs/x?utm_source=z'];
  eq(trio.map(SW.bundleKey), ['https://a.dev/docs/x', 'https://a.dev/docs/x', 'https://a.dev/docs/x'],
    'ba biến thể của cùng một trang phải cho cùng một khoá — dấu / cuối và utm_ không tạo ra trang mới');

  /* ---------------------------------------------------------------- */
  /* cửa 2: tra Sổ, tra Hàng đợi                                       */
  /* ---------------------------------------------------------------- */

  await reset();
  {
    const res = await SW.filterBundle([YT('aaaaaaaaaaa'), YT('bbbbbbbbbbb')]);
    eq(res.keep, [YT('aaaaaaaaaaa'), YT('bbbbbbbbbbb')], 'kho rỗng thì không loại gì');
    eq(res.dropped, [], 'kho rỗng thì không có gì bị loại');
  }

  await reset();
  await SW.recordCopied([YT('aaaaaaaaaaa')], 'playlist thử');
  {
    const res = await SW.filterBundle([YT('aaaaaaaaaaa'), YT('bbbbbbbbbbb')]);
    eq(res.keep, [YT('bbbbbbbbbbb')], 'link đã có trong Sổ phải bị loại');
    eq(res.dropped, [{ url: YT('aaaaaaaaaaa'), why: 'copied' }], 'link bị loại phải quay về KÈM LÝ DO, không bị nuốt');
    eq(res.counts, { copied: 1, queued: 0 }, 'hai lý do phải đếm riêng — người dùng xử lý chúng khác nhau');
  }

  /* Trùng ngay trong chính một Bó: NotebookLM không tự khử trùng URL. */
  await reset();
  {
    const res = await SW.filterBundle([YT('aaaaaaaaaaa'), YT('aaaaaaaaaaa'), 'https://youtu.be/aaaaaaaaaaa']);
    eq(res.keep, [YT('aaaaaaaaaaa')], 'ba dạng URL của cùng một video chỉ được vào Bó một lần');
  }

  /* Hàng đợi: Mục đang chờ thì không copy nữa — nó sẽ tự vào qua Lượt chạy. */
  await reset();
  await SW.enqueue([{ videoId: 'aaaaaaaaaaa' }]);
  {
    const res = await SW.filterBundle([YT('aaaaaaaaaaa'), YT('bbbbbbbbbbb')]);
    eq(res.keep, [YT('bbbbbbbbbbb')], 'video đang nằm trong Hàng đợi thì không copy — copy là tạo bản trùng');
    eq(res.dropped, [{ url: YT('aaaaaaaaaaa'), why: 'queued' }], 'lý do phải là "queued", khác hẳn "copied"');
  }

  /*
   * Mục ERROR là ngoại lệ, và là ngoại lệ CÓ CHỦ ĐÍCH: `ERROR` nghĩa là Lượt chạy
   * đã thử và không đưa được video đó vào NotebookLM — đúng ca Đường trao tay sinh
   * ra để cứu. Chặn nó ở đây là chặn đúng ca cần nhất.
   */
  await reset();
  await SW.enqueue([{ videoId: 'aaaaaaaaaaa' }]);
  {
    const queue = store.get('queue');
    queue[0].status = 'error';
    store.set('queue', queue);
    const res = await SW.filterBundle([YT('aaaaaaaaaaa')]);
    eq(res.keep, [YT('aaaaaaaaaaa')],
      'Mục ở trạng thái ERROR vẫn copy được — đó chính là ca Đường trao tay cứu');
  }

  /* ---------------------------------------------------------------- */
  /* Sổ: chỉ ghi cái đã tới clipboard thật                             */
  /* ---------------------------------------------------------------- */

  await reset();
  {
    const res = await SW.filterBundle([YT('aaaaaaaaaaa')]);
    eq(res.keep.length, 1, 'cửa 2 phải cho link đi qua');
    eq(log(), [], 'cửa 2 KHÔNG được ghi Sổ — nó chỉ trả lời, clipboard chưa nhận gì cả');
  }

  await reset();
  await SW.recordCopied([YT('aaaaaaaaaaa')], 'playlist thử');
  {
    /*
     * `|| {}` không phải phòng thủ thừa: đo 2026-08-28, một hoán vị bỏ lệnh ghi
     * trong `recordCopied` làm bốn assertion đỏ rồi `rows[0].key` ném TypeError,
     * và cú ném đó nuốt luôn dòng tổng kết. Một hoán vị không in ra số thì không
     * đo được thiệt hại.
     */
    const rows = log();
    const first = rows[0] || {};
    eq(rows.length, 1, 'ghi Sổ đúng một dòng');
    eq(first.key, 'yt:aaaaaaaaaaa', 'dòng Sổ phải mang khoá, không phải chỉ URL');
    eq(first.url, YT('aaaaaaaaaaa'), 'dòng Sổ giữ nguyên URL người dùng đã copy');
    eq(first.from, 'playlist thử', 'dòng Sổ phải nhớ gom từ đâu');
    ok(typeof first.at === 'number' && first.at > 0, 'dòng Sổ phải có thời điểm');
  }

  /* Ghi lại cùng một link: Sổ không được phình thêm dòng. */
  await SW.recordCopied([YT('aaaaaaaaaaa'), YT('bbbbbbbbbbb')], 'lượt hai');
  eq(log().map((r) => r.key), ['yt:aaaaaaaaaaa', 'yt:bbbbbbbbbbb'],
    'ghi lại link đã có không tạo dòng mới; link mới thì nối vào');

  /*
   * Hoán vị số 2 chạy trọn vẹn: ba biến thể URL của cùng một trang tài liệu.
   * Copy lượt một, rồi copy lượt hai với cả ba → Sổ có ĐÚNG 1 dòng và lượt hai
   * loại CẢ BA. Bản dùng `row.url` làm khoá sinh 3 dòng và cho cả ba đi lại.
   */
  await reset();
  await SW.recordCopied([trio[0]], 'docs');
  {
    const res = await SW.filterBundle(trio);
    eq(log().length, 1, 'ba biến thể chỉ tạo một dòng Sổ');
    eq(res.keep, [], 'lượt hai phải loại cả ba biến thể');
    /*
     * `dropped` có MỘT dòng, không phải ba — và đó là đúng, không phải nuốt link.
     * Ba biến thể là cùng một trang, nên nút "copy lại cả những cái đã có" mà trả
     * về ba URL sẽ dựng ba Nguồn trùng trong notebook: NotebookLM không tự khử
     * trùng URL (doc chính thức im lặng, và extension "NotebookLM Deduper" tồn tại
     * được là bằng chứng gián tiếp mạnh).
     *
     * Cái phải không bị nuốt là *trang*, không phải *chuỗi*.
     */
    eq(res.dropped.length, 1, 'ba biến thể của một trang quay về thành một dòng bị loại, không phải ba');
    eq((res.dropped[0] || {}).why, 'copied', 'lý do phải là đã có trong Sổ');
  }

  /* Xoá Sổ — nút tay, đối xứng với "Xoá mục đã xong" của Hàng đợi. */
  await SW.clearCopied();
  eq(log(), [], 'xoá Sổ phải xoá sạch');
  {
    const res = await SW.filterBundle(trio);
    eq(res.keep.length, 1, 'xoá Sổ rồi thì link cũ copy lại được');
  }

  /* URL rác không được lọt vào Sổ và cũng không được làm hỏng cả lô. */
  await reset();
  {
    const res = await SW.filterBundle(['không-phải-url', YT('aaaaaaaaaaa'), '']);
    eq(res.keep, [YT('aaaaaaaaaaa')], 'URL không lấy được khoá thì bỏ qua, phần còn lại vẫn đi tiếp');
    await SW.recordCopied(['không-phải-url'], 'rác');
    eq(log(), [], 'URL không lấy được khoá thì không vào Sổ');
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
