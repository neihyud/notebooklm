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

/* Router tin nhắn của service worker — cần nó để hỏi GET_STATE đúng đường popup hỏi. */
let router = null;

/* Service worker gắn mọi thứ vào `self`; trong node thì `self` là `global`. */
global.self = global;
global.importScripts = (...files) => files.forEach((f) => require(path.join(ROOT, f)));
global.chrome = {
  runtime: {
    onMessage: { addListener(fn) { router = fn; }, removeListener() {} },
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
/** Hỏi service worker đúng như popup hỏi, không gọi tắt vào hàm nội bộ. */
const ask = (message) => new Promise((resolve) => router(message, {}, resolve));
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

  /* ---------------------------------------------------------------- */
  /* cửa đo: fetch phải ẨN DANH                                        */
  /* ---------------------------------------------------------------- */

  /*
   * Ghim ở đây chứ không ở `docs-panel.test.js`, và đó là chỗ duy nhất ghim
   * được: phía tab tài liệu, service worker là một stub, nên hoán vị
   * `'omit'` -> `'include'` xanh cả hai chiều ở đó (đo 2026-08-28). Thứ quyết
   * định nằm ở đây, nên assertion cũng phải ở đây.
   *
   * Vì sao nó đáng một test riêng: mặc định của `fetch` là `same-origin`, nghe
   * thì đã an toàn — nhưng doc chính thức của Chrome nói request từ extension
   * tới bên thứ ba được coi là *same-site* khi extension có host permission, đủ
   * để cả `SameSite=Strict` đi kèm. Repo này có host permission cho MỌI
   * http/https. Không gõ `'omit'` ra thì một trang nội bộ chỉ đọc được khi đã
   * đăng nhập sẽ đo ra "có thân bài" trên máy owner, rồi NotebookLM — fetch ẩn
   * danh — nhận về trang đăng nhập và nuốt một Nguồn rỗng.
   */
  {
    const seen = [];
    global.fetch = async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        url,
        headers: { get: () => 'text/html' },
        text: async () => '<html><body>ok</body></html>',
      };
    };

    const res = await SW.fetchRawHtml('https://intranet.example/docs/x');
    eq(seen.length, 1, 'cửa đo phải fetch đúng một lần');
    eq(seen[0].init.credentials, 'omit',
      'fetch của cửa đo PHẢI gõ credentials:"omit" — mặc định same-origin vẫn gửi cookie khi extension có host permission');
    eq(seen[0].init.redirect, 'follow', 'phải theo redirect như máy chủ Google sẽ theo');
    ok(seen[0].init.signal, 'phải có AbortSignal riêng — toàn bộ code cũ chạy tuần tự và không có AbortController nào');
    eq(res.html, '<html><body>ok</body></html>', 'trả về HTML thô để tab tài liệu tự parse');

    /* Lỗi mạng gói thành kết quả, không ném — một lượt hỏng không được giết cả lô. */
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const bad = await SW.fetchRawHtml('https://a.dev/x');
    eq(bad.error, 'ECONNREFUSED', 'fetch hỏng phải trả về lỗi, không ném');
    ok(!bad.html, 'fetch hỏng thì không có html');

    global.fetch = async (url) => ({ ok: false, status: 403, url, headers: { get: () => '' }, text: async () => '' });
    eq((await SW.fetchRawHtml('https://a.dev/x')).error, 'HTTP 403', 'HTTP lỗi phải nói rõ mã');
  }

  /* ---------------------------------------------------------------- */
  /* Sổ đi tới popup: tổng thật, và một lát cắt tự khai là lát cắt      */
  /* ---------------------------------------------------------------- */

  ok(typeof router === 'function', 'phải bắt được router tin nhắn để hỏi GET_STATE đúng đường popup hỏi');

  await reset();
  await SW.recordCopied([YT('aaaaaaaaaaa'), YT('bbbbbbbbbbb'), YT('ccccccccccc')], 'playlist X');
  {
    const st = await ask({ type: 'get-state' });
    eq(st.copied.total, 3, 'GET_STATE phải kèm Sổ — popup không cầm luật khoá, nó chỉ hiển thị');
    /*
     * Mới nhất đứng đầu. Không phải chuyện thẩm mỹ: Sổ giữ MÃI, nên xếp cũ-trước
     * là dồn đúng thứ người dùng vừa làm xuống cuối một danh sách chỉ có dài ra.
     */
    eq(st.copied.rows.map((r) => r.url), [YT('ccccccccccc'), YT('bbbbbbbbbbb'), YT('aaaaaaaaaaa')],
      'dòng mới nhất phải đứng đầu');
    eq(st.copied.rows[0].from, 'playlist X', 'mỗi dòng phải mang theo chỗ nó được gom từ đó');
    ok(typeof st.copied.rows[0].at === 'number', 'mỗi dòng phải có thời điểm copy');
  }

  /*
   * Sổ lớn hơn lát cắt. `total` và `rows.length` cố ý KHÁC nhau ở đây, và đó là
   * chỗ dễ hỏng nhất: popup đếm bằng `rows.length` thì con số nói dối đúng vào
   * lúc Sổ đã lớn — tức đúng lúc người ta cần con số đó.
   */
  await reset();
  await SW.recordCopied(Array.from({ length: 120 }, (_, i) => `https://a.dev/p/${i}`), 'trang lớn');
  {
    const st = await ask({ type: 'get-state' });
    eq(st.copied.total, 120, '`total` phải là tổng THẬT của Sổ, không phải độ dài lát cắt');
    ok(st.copied.rows.length < st.copied.total,
      'Sổ chỉ có lớn lên và popup hỏi lại mỗi 1500ms — không được gửi cả Sổ qua mỗi lượt');
    eq(st.copied.rows[0].url, 'https://a.dev/p/119', 'lát cắt phải cắt từ đầu MỚI, không phải đầu cũ');
  }

  /*
   * Hai lượt ghi Sổ CHỒNG NHAU.
   *
   * `getCopiedLog()` → sửa mảng → `storage.local.set()` là đọc-sửa-ghi, và một
   * service worker phục vụ mọi tab cùng lúc: hai tab bấm copy sát nhau thì cả
   * hai đọc cùng một bản Sổ, mỗi bên thêm phần của mình vào bản chụp riêng, rồi
   * bên ghi sau đè mất bên ghi trước.
   *
   * Không có ai báo lỗi — và Sổ mất dòng nghĩa là lượt sau copy trùng đúng
   * những link vừa mất. `chrome.storage` không có giao dịch, nên phép nối tiếp
   * phải nằm trong chính `recordCopied`.
   *
   * KHÔNG `await` từng lượt một: `await` là đúng thứ giấu mất cuộc đua.
   */
  store.clear();
  {
    const [a, b] = await Promise.all([
      SW.recordCopied([YT('ccccccccccc')], 'tab một'),
      SW.recordCopied([YT('ddddddddddd')], 'tab hai'),
    ]);
    const keys = (store.get(N.KEYS.COPIED) || []).map((r) => r.key).sort();
    eq(keys, ['yt:ccccccccccc', 'yt:ddddddddddd'],
      'hai lượt ghi chồng nhau phải giữ được CẢ HAI dòng — bên ghi sau không được đè mất bên trước');
    eq([a.added, b.added], [1, 1], 'và cả hai lượt đều phải báo đúng phần mình vừa thêm');
    eq([a.total, b.total].sort(), [1, 2],
      '`total` phải phản ánh Sổ tại thời điểm lượt đó ghi — hai lượt nối tiếp thì thấy 1 rồi 2');
  }

  /*
   * Một lượt ghi hỏng KHÔNG được giết mọi lượt sau. Dây nối tiếp mà giữ nguyên
   * một promise bị từ chối thì mọi mắt xích sau đều ném theo, và Sổ chết hẳn
   * cho tới lần service worker khởi động lại.
   */
  store.clear();
  {
    const real = chrome.storage.local.set;
    chrome.storage.local.set = async () => { throw new Error('storage đầy'); };
    let threw = null;
    await SW.recordCopied([YT('eeeeeeeeeee')], 'lượt hỏng').catch((e) => { threw = e; });
    chrome.storage.local.set = real;
    ok(!!threw, 'ca dựng sai thì assertion sau vô nghĩa — lượt này phải hỏng thật');

    /*
     * `.catch` tại chỗ, không phải `process.on('unhandledRejection')`: một
     * handler ở tầng tiến trình NUỐT cú chết mà vẫn cho exit code 0, nên hoán vị
     * "dây giữ nguyên cú từ chối" khi ấy không in gì và cũng không đỏ. Bắt ở đây
     * thì nó thành một dòng fail đếm được, và dòng tổng kết vẫn in ra.
     */
    const after = await SW.recordCopied([YT('fffffffffff')], 'lượt sau')
      .catch((e) => ({ error: (e && e.message) || String(e) }));
    eq(after.added, 1, `lượt sau một lượt hỏng vẫn phải ghi được — dây nối tiếp không được giữ lại cú từ chối. Nhận: ${JSON.stringify(after)}`);
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
