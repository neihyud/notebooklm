/*
 * `done` phải nghĩa là "đã vào", không phải "cửa đã đóng" — phía service worker.
 *
 * Hai đường ghi, cùng một khuyết tật. Phần A canh đường tải về đĩa; phần B canh
 * việc `verified` do content script trả về có tới được hàng đợi hay bị nuốt dọc
 * đường (nuốt thì popup mất luôn cơ sở để nói "chưa xác minh được").
 *
 * Bối cảnh — khuyết tật đã đo: `chrome.downloads.download()` resolve khi Chrome
 * *nhận yêu cầu*, không phải khi ghi xong. Một download bị `interrupted` (đĩa
 * đầy, blob URL đã revoke sau TTL 120s ở `offscreen.js`) vẫn resolve bình thường,
 * nên mục vẫn được đánh `done` trong khi ~/Downloads không có gì.
 *
 * Test nạp `src/background/service-worker.js` THẬT (qua importScripts giả lập,
 * y như Chrome làm) và điều khiển `chrome.downloads` bằng stub — chỗ này không
 * chạm DOM nên không cần jsdom.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

/* ---------- stub chrome, đủ để service worker nạp được ---------- */

const changedListeners = [];
const dl = {
  nextId: 1,
  /** Trạng thái `chrome.downloads.search` trả về; null = Chrome còn đang tải. */
  searchState: null,
  searchError: undefined,
  /** Lỗi mà `download()` ném ra, nếu có. */
  throws: null,
  /** downloadId mà download() trả về; undefined = giữ mặc định nextId. */
  returns: undefined,
  calls: [],
};

const noopEvent = () => ({ addListener() {}, removeListener() {} });

/* chrome.storage.local thật sự lưu — patchItem/getQueue đọc lại ngay sau khi ghi. */
const store = new Map();
const storageLocal = {
  async get(keys) {
    if (keys == null) return Object.fromEntries(store);
    const out = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) if (store.has(k)) out[k] = store.get(k);
    return out;
  },
  async set(obj) {
    for (const [k, v] of Object.entries(obj)) store.set(k, v);
  },
  async remove(key) {
    for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
  },
};

/* Mọi lệnh đã gửi tới tab NotebookLM — để quan sát có fallback hay không. */
const tabMessages = [];
/* Trọn vẹn tin thêm nguồn, để đối chiếu type với payload đi kèm. */
const addCalls = [];

/*
 * Ba ĐƯỜNG SONG SONG chỉ tồn tại ở đầu ra, không để lại dấu vết nào trong Hàng
 * đợi — nên mọi assertion soi `status` của từng Mục đều mù với chúng:
 *   notes      — câu tổng kết đi vào chrome.notifications (thứ DUY NHẤT người
 *                dùng thấy khi Lượt chạy kết thúc dưới nền, popup đã đóng)
 *   badgeTexts — con số trên icon extension, đếm lại từ Hàng đợi một lần nữa
 *   hudCalls   — câu tổng kết đi vào HUD trên tab NotebookLM
 * Ghi lại NGUYÊN VĂN, kể cả tabId, để đòi được đúng chuỗi nào vào đúng chỗ nào.
 */
const notes = [];
const badgeTexts = [];
const hudCalls = [];

/* Câu trả lời mà tab NotebookLM giả lập gửi về cho lệnh thêm nguồn. */
let nlmReply = { ok: true, error: null, limit: false, verified: true, unverified: null };

/*
 * Câu trả lời của tab YouTube giả lập cho `yt-extract`, theo từng videoId.
 * Lời thoại mang chính videoId để đối chiếu được NỘI DUNG file với TÊN file —
 * hai thứ do hai đường khác nhau dựng nên và rất dễ lệch pha nhau.
 */
let ytExtract = (videoId) => ({
  ok: true,
  result: { meta: {}, segments: [{ start: 0, text: `lời của ${videoId}` }], method: 'stub' },
});

global.self = global;
global.importScripts = (...files) => files.forEach((f) => require(path.join(ROOT, f)));
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://test/${p}`,
    onInstalled: noopEvent(),
    onMessage: noopEvent(),
    sendMessage: async () => ({}),
    lastError: null,
  },
  storage: { local: storageLocal },
  action: {
    async setBadgeText({ text }) {
      badgeTexts.push(text);
    },
    setBadgeBackgroundColor: async () => {},
  },
  alarms: { create: async () => {}, clear: async () => {}, onAlarm: noopEvent() },
  commands: { onCommand: noopEvent() },
  contextMenus: { create() {}, removeAll: (cb) => cb && cb(), onClicked: noopEvent() },
  notifications: {
    async create(opts) {
      notes.push({ title: opts.title, message: opts.message });
    },
  },
  tabs: {
    // Chỉ tab NotebookLM là có sẵn; tab YouTube phụ trợ do service worker tự mở
    // (đường fallback 'text' đi qua đó).
    query: async (q) =>
      String((q && q.url) || '').includes('notebooklm')
        ? [{ id: 7, url: 'https://notebooklm.google.com/notebook/abc123' }]
        : [],
    create: async ({ url }) => ({ id: 9, url, status: 'complete' }),
    update: async (id, { url }) => ({ id, url, status: 'complete' }),
    remove: async () => {},
    get: async (id) => ({
      id,
      url: id === 7 ? 'https://notebooklm.google.com/notebook/abc123' : 'https://www.youtube.com/',
      status: 'complete',
    }),
    // Chrome hỗ trợ cả hai kiểu gọi: có callback (sendToTab) và trả Promise
    // (thông báo HUD cuối lượt chạy). Stub phải giống cả hai, không thì service
    // worker chết ở đúng chỗ nó vẫn chạy được thật.
    sendMessage(tabId, message, cb) {
      tabMessages.push(message.type);
      if (message.type === 'nlm-add-url' || message.type === 'nlm-add-text') addCalls.push(message);
      if (message.type === 'nblm-hud') hudCalls.push({ tabId, message: message.message, done: message.done });
      const reply =
        message.type === 'nlm-ping'
          ? { ok: true, inNotebook: true, url: 'https://notebooklm.google.com/notebook/abc123' }
          : message.type === 'nlm-add-url' || message.type === 'nlm-add-text'
            ? // hàm thì trả lời theo từng Mục — cần cho lượt chạy vừa có thành công vừa có lỗi
              (typeof nlmReply === 'function' ? nlmReply(message) : nlmReply)
            : message.type === 'yt-extract'
              ? ytExtract(message.videoId)
              : { ok: true };
      if (typeof cb === 'function') return cb(reply);
      return Promise.resolve(reply);
    },
    onRemoved: noopEvent(),
  },
  downloads: {
    async download(opts) {
      dl.calls.push(opts);
      if (dl.throws) throw new Error(dl.throws);
      return dl.returns === undefined ? dl.nextId : dl.returns;
    },
    async search({ id }) {
      if (dl.searchState === null) return [{ id, state: 'in_progress' }];
      return [{ id, state: dl.searchState, error: dl.searchError }];
    },
    onChanged: {
      addListener: (f) => changedListeners.push(f),
      removeListener: (f) => {
        const i = changedListeners.indexOf(f);
        if (i >= 0) changedListeners.splice(i, 1);
      },
    },
  },
};

require(path.join(ROOT, 'src/background/service-worker.js'));

const SW = global.NBLM_SW_INTERNALS;
const emit = (delta) => changedListeners.slice().forEach((f) => f(delta));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Promise đã xong chưa — không chờ, chỉ hỏi. */
function probe(promise) {
  const box = { done: false, value: null };
  promise.then((v) => {
    box.done = true;
    box.value = v;
  });
  return box;
}

(async () => {
  ok(SW && typeof SW.awaitDownloadComplete === 'function', 'service worker phải xuất awaitDownloadComplete để quan sát được');
  if (!SW || !SW.awaitDownloadComplete) {
    console.log(`${pass} pass, ${fail} fail`);
    process.exit(1);
  }

  /* ---------- 1. state: 'complete' -> ok ---------- */
  {
    const p = SW.awaitDownloadComplete(11, 400);
    await tick(0);
    emit({ id: 11, state: { current: 'complete' } });
    const r = await p;
    ok(r.ok === true, `download báo complete thì phải ok, nhận: ${JSON.stringify(r)}`);
    ok(changedListeners.length === 0, `phải gỡ listener sau khi xong, còn lại: ${changedListeners.length}`);
  }

  /* ---------- 2. state: 'interrupted' -> lỗi, kèm lý do của Chrome ---------- */
  {
    const p = SW.awaitDownloadComplete(12, 400);
    await tick(0);
    emit({ id: 12, state: { current: 'interrupted' }, error: { current: 'FILE_NO_SPACE' } });
    const r = await p;
    ok(r.ok === false, `download bị interrupted KHÔNG được báo xong, nhận: ${JSON.stringify(r)}`);
    ok(/FILE_NO_SPACE/.test(r.error || ''), `lỗi phải kèm reason của Chrome, nhận: ${JSON.stringify(r.error)}`);
    ok(changedListeners.length === 0, 'phải gỡ listener cả khi hỏng');
  }

  /* ---------- 3. delta của download KHÁC không được tính ---------- */
  // Hai downloadId cùng kiểu số. Cả hàng đợi đi chung một stream sự kiện, nên
  // nhận nhầm delta của mục khác là báo xong cho một file chưa hề được ghi.
  {
    const p = SW.awaitDownloadComplete(13, 600);
    const box = probe(p);
    await tick(0);
    emit({ id: 99, state: { current: 'complete' } });
    await tick(30);
    ok(box.done === false, `delta của downloadId khác không được kết thúc chờ, nhận: ${JSON.stringify(box.value)}`);
    emit({ id: 13, state: { current: 'complete' } });
    const r = await p;
    ok(r.ok === true, `delta đúng id thì phải kết thúc, nhận: ${JSON.stringify(r)}`);
  }

  /* ---------- 4. hết giờ -> lỗi, không phải xong ---------- */
  {
    const r = await SW.awaitDownloadComplete(14, 80);
    ok(r.ok === false, `hết giờ chờ ghi file thì phải báo hỏng, nhận: ${JSON.stringify(r)}`);
    ok(changedListeners.length === 0, 'phải gỡ listener khi hết giờ');
  }

  /* ---------- 5. file xong TRƯỚC khi kịp gắn listener ---------- */
  // Transcript nhỏ ghi xong gần như tức thì; không hỏi lại trạng thái thì mọi
  // file nhỏ đều treo tới hết giờ dù đã nằm trên đĩa.
  {
    dl.searchState = 'complete';
    const r = await SW.awaitDownloadComplete(15, 400);
    ok(r.ok === true, `download đã xong trước khi gắn listener vẫn phải ok, nhận: ${JSON.stringify(r)}`);
    dl.searchState = 'interrupted';
    dl.searchError = 'SERVER_FAILED';
    const bad = await SW.awaitDownloadComplete(16, 400);
    ok(bad.ok === false, `download đã hỏng trước khi gắn listener phải báo hỏng, nhận: ${JSON.stringify(bad)}`);
    ok(/SERVER_FAILED/.test(bad.error || ''), `lý do phải lấy từ chrome.downloads.search, nhận: ${JSON.stringify(bad.error)}`);
    dl.searchState = null;
    dl.searchError = undefined;
  }

  /* ---------- 6. saveFile: bọc trọn "gửi yêu cầu + chờ ghi xong" ---------- */
  {
    ok(typeof SW.saveFile === 'function', 'phải có seam saveFile để downloadItem không tự chờ lấy');

    dl.nextId = 21;
    const p = SW.saveFile('blob:x', 'a.txt');
    await tick(5);
    emit({ id: 21, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
    const r = await p;
    ok(r.ok === false, `saveFile phải hỏng khi download bị interrupted, nhận: ${JSON.stringify(r)}`);
    ok(/USER_CANCELED/.test(r.error || ''), `saveFile phải giữ lý do của Chrome, nhận: ${JSON.stringify(r.error)}`);

    dl.nextId = 22;
    dl.calls.length = 0;
    const p2 = SW.saveFile('blob:y', 'b.txt');
    await tick(5);
    emit({ id: 22, state: { current: 'complete' } });
    ok((await p2).ok === true, 'saveFile phải ok khi download complete');
    // url và filename là hai string cùng kiểu đi vào cùng một object — hoán vị
    // thì Chrome vẫn nhận yêu cầu và vẫn báo complete, chỉ có file là sai bét.
    ok(dl.calls[0].url === 'blob:y', `url phải vào đúng trường url, nhận: ${JSON.stringify(dl.calls[0].url)}`);
    ok(dl.calls[0].filename === 'b.txt', `filename phải vào đúng trường filename, nhận: ${JSON.stringify(dl.calls[0].filename)}`);
    ok(dl.calls[0].saveAs === false, 'phải giữ saveAs:false — tải 89 file không được hỏi 89 lần');

    dl.throws = 'quyền tải bị chặn';
    const r3 = await SW.saveFile('blob:z', 'c.txt');
    ok(r3.ok === false && /quyền tải bị chặn/.test(r3.error || ''), `download ném lỗi thì saveFile phải báo lại, nhận: ${JSON.stringify(r3)}`);
    dl.throws = null;

    dl.returns = undefined;
  }

  /* ---------- 7. chặn giờ riêng, NGẮN HƠN trần của cả mục ---------- */
  // Dài hơn thì vòng lặp ngoài cắt trước và thông báo "quá 240s" che mất lý do
  // thật (đĩa đầy / blob URL hết hạn).
  ok(typeof SW.DOWNLOAD_TIMEOUT_MS === 'number', 'phải có chặn giờ riêng cho một lần tải file');
  ok(
    SW.DOWNLOAD_TIMEOUT_MS < SW.ITEM_TIMEOUT_MS,
    `chặn giờ tải file (${SW.DOWNLOAD_TIMEOUT_MS}) phải NGẮN HƠN trần của một mục (${SW.ITEM_TIMEOUT_MS})`
  );

  /* ================= PHẦN B — verified phải tới được hàng đợi ================= */

  /**
   * Chạy trọn một lượt import cho đúng một video, với tab NotebookLM giả lập trả
   * về `reply`. Trả lại bản ghi hàng đợi sau khi lượt chạy kết thúc.
   */
  async function chayMotMuc(reply, cacheText) {
    nlmReply = reply;
    tabMessages.length = 0;
    addCalls.length = 0;
    dl.calls.length = 0;
    // `searchState: null` nghĩa là Chrome còn đang tải, và `awaitDownloadComplete`
    // sẽ chờ đủ DOWNLOAD_TIMEOUT_MS = 90s. Nhịp chờ đó DÀI HƠN mọi cửa sổ quan sát
    // của test, nên một yêu cầu tải lọt vào đây sẽ hiện ra dưới dạng "suite treo"
    // thay vì một dòng đỏ đọc được. Đo thật: hoán vị điều kiện `saveTranscriptCopy`
    // làm cả file không kết thúc trong 90s mà không in ra một chữ nào.
    dl.searchState = 'complete';
    store.clear();
    store.set('settings', { notebookUrl: '', delayMs: 0, publicFallbackToTranscript: true });
    store.set('queue', [
      {
        id: 'v1',
        kind: 'youtube',
        key: 'yt:aaaaaaaaaaa',
        videoId: 'aaaaaaaaaaa',
        url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        title: 'Video thử',
        privacy: 'public',
        status: 'pending',
        mode: null,
        error: null,
        attempts: 0,
      },
    ]);
    // Nội dung nạp sẵn thì `prepareTranscript` (mở tab YouTube, gọi InnerTube) bị
    // bỏ qua — nó không phải thứ đang được kiểm ở đây.
    if (cacheText) store.set('text:v1', cacheText);
    await SW.runQueue();
    dl.searchState = null;
    // Không bật Bản sao xuống đĩa thì Lượt chạy KHÔNG được đụng tới chrome.downloads.
    ok(
      dl.calls.length === 0,
      `không bật Bản sao xuống đĩa thì không được gửi yêu cầu tải nào, đã gửi: ${JSON.stringify(dl.calls.map((c) => c.filename))}`
    );
    return (await storageLocal.get('queue')).queue[0];
  }

  /**
   * Chạy trọn một lượt cho một TRANG TÀI LIỆU, chế độ 'url-then-text' để đi qua
   * cả hai nhánh gửi tin. Nội dung trang nạp sẵn vào storage nên `prepareDoc`
   * (fetch + mở tab ẩn) bị bỏ qua — nó không phải thứ đang được kiểm ở đây.
   */
  async function chayMotTrang(reply) {
    nlmReply = reply;
    tabMessages.length = 0;
    addCalls.length = 0;
    dl.calls.length = 0;
    dl.searchState = 'complete'; // xem ghi chú ở chayMotMuc
    store.clear();
    store.set('settings', { notebookUrl: '', delayMs: 0, docsMode: 'url-then-text' });
    store.set('text:d1', 'Nội dung trang tài liệu đã trích sẵn');
    store.set('queue', [
      {
        id: 'd1',
        kind: 'docs',
        key: 'https://docs.example.com/guide',
        url: 'https://docs.example.com/guide',
        title: 'Hướng dẫn',
        site: 'docs.example.com',
        status: 'pending',
        mode: null,
        error: null,
        attempts: 0,
      },
    ]);
    await SW.runQueue();
    dl.searchState = null;
    // Trang tài liệu không có transcript, nên kể cả khi bật tuỳ chọn cũng không
    // có file nào — ở đây tuỳ chọn còn đang tắt, càng không.
    ok(
      dl.calls.length === 0,
      `trang tài liệu không được sinh yêu cầu tải nào, đã gửi: ${JSON.stringify(dl.calls.map((c) => c.filename))}`
    );
    return (await storageLocal.get('queue')).queue[0];
  }

  /**
   * Bất biến của cả bốn call site: tin mang `url` thì PHẢI là `nlm-add-url`, tin
   * mang `text` thì PHẢI là `nlm-add-text`. Đổi chỗ hai hằng số `MSG.NLM_ADD_*`
   * ở call site không đổi payload, nên chỉ phép đối chiếu này bắt được — và
   * `test/messaging.test.js` thì không, nó chỉ canh `HANDLED`.
   */
  function kiemCapTinNhan(nhan, mong) {
    ok(addCalls.length === 2, `${nhan}: phải gửi đúng 2 tin thêm nguồn (url rồi text), nhận: ${JSON.stringify(tabMessages)}`);
    if (addCalls.length !== 2) return;
    const [tinUrl, tinText] = addCalls;

    ok(tinUrl.type === 'nlm-add-url', `${nhan}: tin ĐẦU (đường link) phải là nlm-add-url, nhận: ${JSON.stringify(tinUrl.type)}`);
    ok(tinUrl.url === mong.url, `${nhan}: tin nlm-add-url phải mang đúng URL nguồn, nhận: ${JSON.stringify(tinUrl.url)}`);
    ok(tinUrl.text === undefined, `${nhan}: tin nlm-add-url không được mang text, nhận: ${JSON.stringify(tinUrl.text)}`);

    ok(tinText.type === 'nlm-add-text', `${nhan}: tin SAU (dán nội dung) phải là nlm-add-text, nhận: ${JSON.stringify(tinText.type)}`);
    ok(tinText.url === undefined, `${nhan}: tin nlm-add-text không được mang url, nhận: ${JSON.stringify(tinText.url)}`);
    // Không chỉ "hai chuỗi khác nhau": phải đúng chuỗi nào vào trường nào. Hoán
    // vị hai trường này cho ra mỗi Nguồn mang tiêu đề là cả bản nội dung đã trích.
    ok(tinText.text === mong.text, `${nhan}: trường text phải là NỘI DUNG đã trích, nhận: ${JSON.stringify(tinText.text)}`);
    ok(tinText.title === mong.title, `${nhan}: trường title phải là TIÊU ĐỀ nguồn, nhận: ${JSON.stringify(tinText.title)}`);
  }

  ok(typeof SW.runQueue === 'function', 'phải xuất runQueue để chạy được trọn một lượt trong test');

  {
    const item = await chayMotMuc({ ok: true, error: null, limit: false, verified: true, unverified: null });
    ok(item.status === 'done', `import thành công thì mục phải là done, nhận: ${JSON.stringify(item.status)}`);
    ok(item.verified === true, `verified:true từ content script phải tới được hàng đợi, nhận: ${JSON.stringify(item.verified)}`);
  }

  {
    // Đây là ca đắt nhất của ticket: content script nói "xong nhưng chưa xác minh
    // được", và cả chuỗi importVideo -> runQueue -> storage không được làm nó
    // thành "xong" trơn. Nuốt ở bất kỳ nấc nào là popup mất cơ sở để cảnh báo.
    const LY_DO = 'Không đọc được danh sách Nguồn của notebook nên chưa xác minh được nguồn đã vào hay chưa.';
    const item = await chayMotMuc({ ok: true, error: null, limit: false, verified: false, unverified: LY_DO });
    ok(item.status === 'done', `chưa xác minh được vẫn là done (không huỷ oan), nhận: ${JSON.stringify(item.status)}`);
    ok(item.verified === false, `verified:false PHẢI tới được hàng đợi, không được nuốt, nhận: ${JSON.stringify(item.verified)}`);
    ok(item.unverified === LY_DO, `lý do chưa xác minh phải tới được hàng đợi nguyên vẹn, nhận: ${JSON.stringify(item.unverified)}`);
  }

  {
    // Nguồn ĐÃ vào notebook nhưng không đúng 1. Video public có plan
    // ['url','text'], nên mặc định lỗi ở đường url sẽ rơi sang dán text — và
    // notebook lĩnh một Nguồn trùng, phải xoá tay vì thao tác không idempotent.
    const item = await chayMotMuc({
      ok: false,
      error: 'Hộp thoại đã đóng nhưng số Nguồn không tăng đúng 1 (trước: 1, sau: 3)',
      limit: false,
      verified: true,
      unverified: null,
      sourceAdded: true,
    });
    ok(item.status === 'error', `không tăng đúng 1 thì mục phải là lỗi, nhận: ${JSON.stringify(item.status)}`);
    ok(
      !tabMessages.includes('nlm-add-text'),
      `đã ghi vào notebook rồi thì KHÔNG được thử lại đường khác (sẽ tạo Nguồn trùng), đã gửi: ${JSON.stringify(tabMessages)}`
    );
  }

  {
    // Ngược lại: không Nguồn nào vào -> fallback sang dán text là đúng và cần thiết.
    await chayMotMuc(
      { ok: false, error: 'URL hỏng', limit: false, verified: true, unverified: null, sourceAdded: false },
      'Transcript đã trích sẵn của video'
    );
    ok(
      tabMessages.includes('nlm-add-text'),
      `chưa có Nguồn nào vào thì vẫn phải thử tiếp đường dán text, đã gửi: ${JSON.stringify(tabMessages)}`
    );
    kiemCapTinNhan('video', {
      url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      text: 'Transcript đã trích sẵn của video',
      title: 'Video thử — YouTube transcript', // sourceTitle() từ shared.js
    });
  }

  {
    // Trang tài liệu đi qua importDoc — hai call site RIÊNG, cùng cặp hằng số.
    const item = await chayMotTrang({ ok: false, error: 'link hỏng', limit: false, verified: true, unverified: null, sourceAdded: false });
    ok(item.status === 'error', `cả hai đường hỏng thì trang tài liệu phải là lỗi, nhận: ${JSON.stringify(item.status)}`);
    kiemCapTinNhan('trang tài liệu', {
      url: 'https://docs.example.com/guide',
      text: 'Nội dung trang tài liệu đã trích sẵn',
      title: 'Hướng dẫn — docs.example.com', // docsSourceTitle() từ shared.js
    });
  }

  /* ============ PHẦN C — MỘT Lượt chạy duy nhất (ticket 003) ============ */

  const KHO = 'Transcript YouTube';

  /** Nội dung thật của file đã gửi cho chrome.downloads, giải từ data URL. */
  function noiDungFile(call) {
    const at = String(call.url).indexOf('base64,');
    return at === -1 ? String(call.url) : Buffer.from(String(call.url).slice(at + 7), 'base64').toString('utf8');
  }

  function dungHangDoi(videos) {
    store.clear();
    store.set('queue', videos.map((v) => Object.assign({
      kind: 'youtube',
      key: `yt:${v.videoId}`,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      privacy: 'public',
      status: 'pending',
      mode: null,
      error: null,
      attempts: 0,
    }, v)));
  }

  /**
   * Chạy trọn MỘT Lượt chạy trên hàng đợi đang có, với `settings` cho trước.
   * `reply` là câu trả lời của tab NotebookLM: đưa một HÀM vào thì trả lời được
   * theo từng Mục, cần cho lượt chạy vừa có mục thành công vừa có mục lỗi.
   */
  async function chayLuot(settings, reply) {
    nlmReply = reply || { ok: true, error: null, limit: false, verified: true, unverified: null };
    tabMessages.length = 0;
    addCalls.length = 0;
    dl.calls.length = 0;
    notes.length = 0;
    badgeTexts.length = 0;
    hudCalls.length = 0;
    dl.searchState = 'complete';
    dl.searchError = undefined;
    store.set('settings', Object.assign({ notebookUrl: '', delayMs: 0 }, settings));
    await SW.runQueue();
    dl.searchState = null;
    return (await storageLocal.get('queue')).queue;
  }

  const BA_VIDEO = [
    { id: 'v1', videoId: 'aaaaaaaaaaa', title: 'Video một' },
    { id: 'v2', videoId: 'bbbbbbbbbbb', title: 'Video hai' },
    { id: 'v3', videoId: 'ccccccccccc', title: 'Video ba' },
  ];

  /* ---------- C1. tắt tuỳ chọn -> KHÔNG có file nào xuống đĩa ---------- */
  // Assert HÀNH ĐỘNG đã xảy ra (có gửi yêu cầu tải hay không), không assert giá
  // trị trả về: hai nhánh đều kết thúc bằng một mục `done` giống hệt nhau.
  {
    dungHangDoi(BA_VIDEO);
    const queue = await chayLuot({ saveTranscriptCopy: false });
    ok(dl.calls.length === 0, `tắt Bản sao xuống đĩa thì không được ghi file nào, đã ghi: ${JSON.stringify(dl.calls.map((c) => c.filename))}`);
    ok(addCalls.length === 3, `vẫn phải thêm đủ 3 Nguồn, đã gửi: ${JSON.stringify(tabMessages)}`);
    ok(queue.every((i) => i.status === 'done'), `cả 3 mục phải done, nhận: ${JSON.stringify(queue.map((i) => i.status))}`);
  }

  /* ---------- C2. bật tuỳ chọn -> file VÀ Nguồn, trong cùng MỘT lượt ---------- */
  // Đây là quyết định của owner: bỏ hai chế độ chạy độc lập. Một lời gọi runQueue
  // phải làm cả hai việc, không đòi bấm thêm nút nào.
  {
    dungHangDoi(BA_VIDEO);
    const queue = await chayLuot({ saveTranscriptCopy: true, downloadFormat: 'txt', downloadSubfolder: KHO });

    ok(dl.calls.length === 3, `bật tuỳ chọn thì mỗi video phải có đúng 1 file, đã ghi: ${JSON.stringify(dl.calls.map((c) => c.filename))}`);
    ok(addCalls.length === 3, `cùng lượt đó vẫn phải thêm đủ 3 Nguồn, đã gửi: ${JSON.stringify(tabMessages)}`);
    ok(queue.every((i) => i.status === 'done'), `cả 3 mục phải done, nhận: ${JSON.stringify(queue.map((i) => i.status))}`);

    /* --- cặp hoán vị #9 của WORKSPACE_PROTOCOL: số thứ tự ↔ định danh mục --- *
     * `index` và `resolved.id` cùng đi vào tên file. Đòi ĐÚNG tên, không chỉ
     * "ba tên khác nhau": số thứ tự phải khớp vị trí trong Hàng đợi, tiêu đề phải
     * là tiêu đề của CHÍNH mục đó, và nội dung file phải là lời của CHÍNH video đó.
     * Ba thứ này do ba đường khác nhau dựng nên — lệch pha là không ai biết. */
    const mong = [
      `${KHO}/001 - Video một.txt`,
      `${KHO}/002 - Video hai.txt`,
      `${KHO}/003 - Video ba.txt`,
    ];
    ok(
      JSON.stringify(dl.calls.map((c) => c.filename)) === JSON.stringify(mong),
      `tên file phải là ${JSON.stringify(mong)}, nhận: ${JSON.stringify(dl.calls.map((c) => c.filename))}`
    );
    for (let i = 0; i < BA_VIDEO.length; i++) {
      const call = dl.calls.find((c) => c.filename === mong[i]);
      ok(!!call, `thiếu hẳn file ${mong[i]}`);
      if (!call) continue;
      ok(
        noiDungFile(call).includes(`lời của ${BA_VIDEO[i].videoId}`),
        `${mong[i]} phải chứa transcript của ĐÚNG video ${BA_VIDEO[i].videoId}, nhận: ${JSON.stringify(noiDungFile(call).slice(0, 80))}`
      );
    }
    ok(
      queue.map((i) => i.savedFile).join('|') === mong.join('|'),
      `mỗi mục phải nhớ đúng tên file của chính nó trong storage, nhận: ${JSON.stringify(queue.map((i) => i.savedFile))}`
    );
  }

  /* ---------- C3. Chrome ngắt service worker -> KHÔNG tải lại từ đầu ---------- */
  // Khuyết tật 1 của ticket: tiến độ nằm trong biến cục bộ nên alarm khởi động lại
  // hàng đợi là tải lại từ mục đầu, `conflictAction:'uniquify'` đẻ ra bản sao " (1)".
  // Dựng lại đúng cảnh đó: mục đã có file trên đĩa nhưng trạng thái bị trả về
  // pending (runQueue vẫn làm thế với mục kẹt ở extracting/importing).
  {
    dungHangDoi([
      Object.assign({}, BA_VIDEO[0], { savedFile: `${KHO}/001 - Video một.txt` }),
      Object.assign({}, BA_VIDEO[1], { savedFile: `${KHO}/002 - Video hai.txt` }),
      BA_VIDEO[2],
    ]);
    await chayLuot({ saveTranscriptCopy: true, downloadFormat: 'txt', downloadSubfolder: KHO });

    ok(
      JSON.stringify(dl.calls.map((c) => c.filename)) === JSON.stringify([`${KHO}/003 - Video ba.txt`]),
      `chỉ mục CHƯA có file mới được ghi; hai mục kia đã nằm trên đĩa. Đã ghi: ${JSON.stringify(dl.calls.map((c) => c.filename))}`
    );
    ok(addCalls.length === 3, `bỏ qua bước ghi file không được bỏ qua bước thêm Nguồn, đã gửi: ${JSON.stringify(tabMessages)}`);
  }

  /* ---------- C4. ghi file hỏng KHÔNG được cắt ngang việc thêm Nguồn ---------- */
  // "Làm trong cùng Lượt chạy, không cắt ngang" — Nguồn là thứ duy nhất đo được
  // thành công, bản sao xuống đĩa chỉ là phụ phẩm.
  {
    dungHangDoi([BA_VIDEO[0]]);
    dl.throws = 'đĩa đầy';
    const queue = await chayLuot({ saveTranscriptCopy: true, downloadFormat: 'txt', downloadSubfolder: KHO });
    dl.throws = null;

    ok(addCalls.length === 1, `ghi file hỏng thì vẫn phải thêm Nguồn, đã gửi: ${JSON.stringify(tabMessages)}`);
    ok(queue[0].status === 'done', `Nguồn đã vào thì mục vẫn là done, nhận: ${JSON.stringify(queue[0].status)}`);
    ok(
      /đĩa đầy/.test(queue[0].copyError || ''),
      `lý do ghi file hỏng phải tới được hàng đợi, nhận: ${JSON.stringify(queue[0].copyError)}`
    );
    ok(!queue[0].savedFile, `ghi hỏng thì KHÔNG được nhớ là đã ghi, nhận: ${JSON.stringify(queue[0].savedFile)}`);
  }

  /* ---------- C5. transcript cắt cụt không được lặng lẽ nhận done ---------- */
  // Khuyết tật 2 của ticket. Hai mục trong cùng một lượt, chỉ MỘT bị cắt cụt:
  // lý do phải bám đúng mục của nó, không lem sang mục kia (cùng hình dạng bản ghi).
  {
    const LY_DO = 'Chỉ lấy được 200 dòng: danh sách transcript vẫn còn dài ra sau 40 vòng cuộn.';
    ytExtract = (videoId) => ({
      ok: true,
      result: {
        meta: {},
        segments: [{ start: 0, text: `lời của ${videoId}` }],
        method: 'stub',
        truncated: videoId === 'aaaaaaaaaaa' ? LY_DO : null,
      },
    });

    // Video PRIVATE: chính sách là Dán text, nên bản chép lời cụt đuôi ĐÚNG LÀ
    // thứ đã thành Nguồn. Đó là lúc `verified` phải hạ xuống.
    dungHangDoi([
      Object.assign({}, BA_VIDEO[0], { privacy: 'private' }),
      Object.assign({}, BA_VIDEO[1], { privacy: 'private' }),
    ]);
    const queue = await chayLuot({ saveTranscriptCopy: false });

    const cut = queue.find((i) => i.id === 'v1');
    const lanh = queue.find((i) => i.id === 'v2');

    ok(cut.mode === 'text', `video private phải đi đường dán text, nhận: ${JSON.stringify(cut.mode)}`);
    ok(cut.status === 'done', `Nguồn đã vào thật nên vẫn là done — báo lỗi thì Thử lại sẽ đẻ Nguồn trùng. Nhận: ${JSON.stringify(cut.status)}`);
    ok(cut.verified === false, `mục có transcript cắt cụt KHÔNG được nhận verified:true, nhận: ${JSON.stringify(cut.verified)}`);
    ok(cut.unverified === LY_DO, `lý do cắt cụt phải tới hàng đợi nguyên vẹn, nhận: ${JSON.stringify(cut.unverified)}`);

    ok(lanh.verified === true, `mục KHÔNG bị cắt cụt vẫn phải là verified:true, nhận: ${JSON.stringify(lanh.verified)}`);
    ok(lanh.unverified == null, `lý do của mục khác không được lem sang, nhận: ${JSON.stringify(lanh.unverified)}`);

    /* Cùng một transcript cụt đuôi, nhưng video PUBLIC đi đường link: Nguồn là do
     * NotebookLM tự đọc từ YouTube, transcript của ta chỉ thành cái file trên đĩa.
     * Chỗ cụt thuộc về FILE, không thuộc về Nguồn — kêu "chưa xác minh được" ở đây
     * là báo động giả, và nó ăn mòn đúng tín hiệu ticket 002 vừa dựng.
     * Hai đích đến cùng kiểu chuỗi (`unverified` và `copyError`): phải đòi đúng
     * chuỗi vào đúng trường, không chỉ "có nhắc tới". */
    dungHangDoi([BA_VIDEO[0]]);
    const [quaLink] = await chayLuot({ saveTranscriptCopy: true, downloadFormat: 'txt', downloadSubfolder: KHO });
    ok(quaLink.mode === 'url', `video public phải đi đường link, nhận: ${JSON.stringify(quaLink.mode)}`);
    ok(quaLink.savedFile === `${KHO}/001 - Video một.txt`, `file vẫn phải được ghi, nhận: ${JSON.stringify(quaLink.savedFile)}`);
    ok(
      quaLink.verified === true,
      `Nguồn đi đường link không dính transcript cụt đuôi của ta — không được hạ verified, nhận: ${JSON.stringify(quaLink.verified)}`
    );
    ok(quaLink.unverified == null, `và không được dựng lý do chưa xác minh, nhận: ${JSON.stringify(quaLink.unverified)}`);
    ok(
      quaLink.copyError === LY_DO,
      `chỗ cụt thuộc về Bản sao xuống đĩa, phải nằm ở copyError, nhận: ${JSON.stringify(quaLink.copyError)}`
    );

    /* Chiều ngược lại: content script tự nói "chưa xác minh được" trong khi
     * transcript KHÔNG cắt cụt — lý do của nó phải giữ nguyên, không bị lý do
     * cắt cụt chiếm chỗ. Hai chuỗi cùng kiểu vào cùng một trường. */
    const LY_DO_NLM = 'Không đọc được danh sách Nguồn của notebook.';
    ytExtract = (videoId) => ({
      ok: true,
      result: { meta: {}, segments: [{ start: 0, text: `lời của ${videoId}` }], method: 'stub', truncated: null },
    });
    dungHangDoi([BA_VIDEO[0]]);
    tabMessages.length = 0;
    addCalls.length = 0;
    dl.calls.length = 0;
    dl.searchState = 'complete';
    store.set('settings', { notebookUrl: '', delayMs: 0, saveTranscriptCopy: false });
    nlmReply = { ok: true, error: null, limit: false, verified: false, unverified: LY_DO_NLM };
    await SW.runQueue();
    dl.searchState = null;
    const chuaBiet = (await storageLocal.get('queue')).queue[0];
    ok(chuaBiet.verified === false, `verified:false của content script phải giữ nguyên, nhận: ${JSON.stringify(chuaBiet.verified)}`);
    ok(chuaBiet.unverified === LY_DO_NLM, `lý do của content script phải giữ nguyên, nhận: ${JSON.stringify(chuaBiet.unverified)}`);

    /* CẢ HAI cùng lúc: transcript cắt cụt VÀ NotebookLM không đối chiếu được.
     * Hai chuỗi cùng kiểu vào cùng một trường, nên phải chốt cả nội dung lẫn THỨ
     * TỰ — không có ca này thì đảo chỗ chúng vẫn xanh cả suite (đã đo). Cắt cụt
     * đứng trước: nó nói về NỘI DUNG nguồn, việc mà người đọc còn làm được gì đó. */
    ytExtract = (videoId) => ({
      ok: true,
      result: { meta: {}, segments: [{ start: 0, text: `lời của ${videoId}` }], method: 'stub', truncated: LY_DO },
    });
    dungHangDoi([Object.assign({}, BA_VIDEO[0], { privacy: 'private' })]);
    tabMessages.length = 0;
    addCalls.length = 0;
    dl.calls.length = 0;
    dl.searchState = 'complete';
    store.set('settings', { notebookUrl: '', delayMs: 0, saveTranscriptCopy: false });
    nlmReply = { ok: true, error: null, limit: false, verified: false, unverified: LY_DO_NLM };
    await SW.runQueue();
    dl.searchState = null;
    const caHai = (await storageLocal.get('queue')).queue[0];
    ok(
      caHai.unverified === `${LY_DO} ${LY_DO_NLM}`,
      `cả hai lý do phải tới nơi, cắt cụt trước rồi tới lý do của NotebookLM. Nhận: ${JSON.stringify(caHai.unverified)}`
    );

    // Trả stub về mặc định cho mọi thứ chạy sau.
    ytExtract = (videoId) => ({
      ok: true,
      result: { meta: {}, segments: [{ start: 0, text: `lời của ${videoId}` }], method: 'stub' },
    });
  }

  /* ============ PHẦN D — câu tổng kết và con số trên icon ============ */
  /*
   * `done`/`failed` trong runQueue là một ĐƯỜNG DỮ LIỆU SONG SONG: chúng không
   * được ghi vào Hàng đợi, chỉ chảy ra ba cái đầu ra ở cuối lượt. Trạng thái
   * từng Mục vẫn do patchItem ghi đúng dù hai bộ đếm có đảo chỗ cho nhau, nên
   * MỌI assertion soi Hàng đợi đều xanh — đo thật: đổi `done++` ↔ `failed++`,
   * 513 pass 0 fail. Vì thế phần D không được nhìn Hàng đợi lấy một dòng nào;
   * nó chỉ nhìn thứ đã GỬI ĐI.
   *
   * Hậu quả nếu hở: chạy xong 89 video, thông báo nói "0 nguồn đã thêm, 89 lỗi".
   * Đó là thứ DUY NHẤT người dùng thấy khi lượt chạy kết thúc dưới nền.
   */

  /** Câu tổng kết cuối lượt, tách khỏi mọi thông báo khác. */
  const tomTat = () => notes.filter((n) => n.title === 'YouTube → NotebookLM — Import xong');

  /* ---------- D1. toàn thành công ---------- */
  {
    dungHangDoi(BA_VIDEO);
    const queue = await chayLuot({ saveTranscriptCopy: false });
    const trangThai = JSON.stringify(queue.map((i) => i.status)); // chỉ để đọc khi đỏ, KHÔNG assert

    ok(tomTat().length === 1, `phải có đúng một câu tổng kết, nhận: ${JSON.stringify(notes)}`);
    // Chốt NGUYÊN VĂN, không chỉ "có chứa số 3": hoán vị hai bộ đếm cho
    // "0 nguồn đã thêm, 3 lỗi" — vẫn có số 3 trong câu, vẫn khớp includes('3').
    ok(
      (tomTat()[0] || {}).message === '3 nguồn đã thêm',
      `3 mục vào hết thì câu tổng kết phải là "3 nguồn đã thêm". Nhận: ${JSON.stringify((tomTat()[0] || {}).message)} (hàng đợi: ${trangThai})`
    );
    ok(
      !/lỗi/.test((tomTat()[0] || {}).message || ''),
      `không có mục nào lỗi thì câu tổng kết không được nhắc chữ lỗi, nhận: ${JSON.stringify((tomTat()[0] || {}).message)}`
    );

    // HUD trên tab NotebookLM là bản sao thứ hai của đúng câu đó, và phải tới
    // ĐÚNG tab notebook (id 7) — không phải tab YouTube phụ trợ (id 9).
    ok(hudCalls.length === 1, `phải gửi đúng một HUD cuối lượt, nhận: ${JSON.stringify(hudCalls)}`);
    ok((hudCalls[0] || {}).tabId === 7, `HUD phải tới tab NotebookLM, nhận tabId: ${JSON.stringify((hudCalls[0] || {}).tabId)}`);
    ok(
      (hudCalls[0] || {}).message === '3 nguồn đã thêm',
      `HUD phải mang đúng câu tổng kết, nhận: ${JSON.stringify((hudCalls[0] || {}).message)}`
    );
    ok((hudCalls[0] || {}).done === true, `HUD cuối lượt phải đánh dấu done, nhận: ${JSON.stringify((hudCalls[0] || {}).done)}`);

    // Icon: không còn mục nào chờ -> phải XOÁ số, không phải để '0'.
    ok(
      badgeTexts[badgeTexts.length - 1] === '',
      `hết hàng đợi thì icon phải sạch số, nhận: ${JSON.stringify(badgeTexts[badgeTexts.length - 1])}`
    );
  }

  /* ---------- D2. vừa có thành công vừa có lỗi ---------- */
  // Ca bắt buộc phải có: một mình D1 không giết được hoán vị nếu assertion lỏng,
  // vì cả hai chiều đều để lại số 3 trong câu. Ở đây hai bộ đếm mang HAI số
  // KHÁC nhau, nên chỗ đứng của từng số mới là thứ phân biệt được.
  {
    dungHangDoi(BA_VIDEO);
    const queue = await chayLuot(
      { saveTranscriptCopy: false, publicFallbackToTranscript: false },
      // Chỉ video hai bị NotebookLM từ chối. Khớp theo videoId nên đúng cho cả
      // tin dán link lẫn tin dán text.
      (m) =>
        JSON.stringify(m).includes('bbbbbbbbbbb')
          ? { ok: false, error: 'NotebookLM từ chối nguồn này', limit: false, verified: false, unverified: null }
          : { ok: true, error: null, limit: false, verified: true, unverified: null }
    );
    const trangThai = JSON.stringify(queue.map((i) => i.status)); // chỉ để đọc khi đỏ

    ok(tomTat().length === 1, `phải có đúng một câu tổng kết, nhận: ${JSON.stringify(notes)}`);
    ok(
      (tomTat()[0] || {}).message === '2 nguồn đã thêm, 1 lỗi',
      `2 vào 1 hỏng thì phải là "2 nguồn đã thêm, 1 lỗi" — số nào đứng chỗ nấy. Nhận: ${JSON.stringify((tomTat()[0] || {}).message)} (hàng đợi: ${trangThai})`
    );
    ok(
      (hudCalls[0] || {}).message === '2 nguồn đã thêm, 1 lỗi',
      `HUD phải mang đúng câu đó, nhận: ${JSON.stringify((hudCalls[0] || {}).message)}`
    );
    ok(
      badgeTexts[badgeTexts.length - 1] === '',
      `mục lỗi không còn chờ nữa nên icon phải sạch số, nhận: ${JSON.stringify(badgeTexts[badgeTexts.length - 1])}`
    );
  }

  /* ---------- D3. mục CHẾT giữa chừng (ngoại lệ, không phải câu trả lời "không") ---------- */
  // Hai đường thất bại KHÁC NHAU chạy vào hai chỗ đếm khác nhau: nhánh `else`
  // (content script trả lời "không") và khối `catch` (content script không trả
  // lời gì cả — chưa được tiêm, tab chết). D2 chỉ đi qua nhánh `else`, nên một
  // mình nó để hở nguyên khối `catch`: đổi `failed++` ở đó thành `done++` vẫn
  // 107 pass 0 fail (đã đo). Ca này đóng chỗ đó.
  {
    dungHangDoi(BA_VIDEO);
    const queue = await chayLuot(
      { saveTranscriptCopy: false, publicFallbackToTranscript: false },
      // null = không có phản hồi -> sendToTab NÉM, ngoại lệ chạy thẳng ra khối catch.
      (m) =>
        JSON.stringify(m).includes('bbbbbbbbbbb')
          ? null
          : { ok: true, error: null, limit: false, verified: true, unverified: null }
    );
    const trangThai = JSON.stringify(queue.map((i) => i.status)); // chỉ để đọc khi đỏ

    ok(
      (tomTat()[0] || {}).message === '2 nguồn đã thêm, 1 lỗi',
      `mục chết vì ngoại lệ cũng phải được đếm là LỖI, nhận: ${JSON.stringify((tomTat()[0] || {}).message)} (hàng đợi: ${trangThai})`
    );
    ok(
      (hudCalls[0] || {}).message === '2 nguồn đã thêm, 1 lỗi',
      `HUD phải mang đúng câu đó, nhận: ${JSON.stringify((hudCalls[0] || {}).message)}`
    );
  }

  /* ---------- D4. dừng giữa chừng: ba con số phải khác nhau ---------- */
  // Notebook báo hết chỗ ở mục thứ hai -> lượt chạy dừng, còn hai mục CHƯA chạy.
  // done=1, failed=1, còn chờ=2: chỉ ở đây mới phân biệt được con số trên icon
  // đếm cái gì. Đếm nhầm sang tổng số mục (4) hay số đã xong (1) đều lộ ra.
  {
    dungHangDoi(BA_VIDEO.concat([{ id: 'v4', videoId: 'ddddddddddd', title: 'Video bốn' }]));
    await chayLuot(
      { saveTranscriptCopy: false, publicFallbackToTranscript: false },
      (m) =>
        JSON.stringify(m).includes('bbbbbbbbbbb')
          ? { ok: false, error: 'Notebook đã đủ 300 nguồn', limit: true, verified: false, unverified: null }
          : { ok: true, error: null, limit: false, verified: true, unverified: null }
    );

    ok(
      badgeTexts[badgeTexts.length - 1] === '2',
      `dừng sớm thì icon phải hiện 2 mục còn chờ (không phải 4 tổng, không phải 1 đã xong). Nhận: ${JSON.stringify(badgeTexts[badgeTexts.length - 1])}`
    );
    ok(
      (tomTat()[0] || {}).message === '1 nguồn đã thêm, 1 lỗi',
      `câu tổng kết chỉ tính phần ĐÃ chạy, nhận: ${JSON.stringify((tomTat()[0] || {}).message)}`
    );

    // Hai thông báo cùng hình dạng {title, message} rời khỏi cùng một hàm `note`
    // trong cùng một lượt: lý do dừng và câu tổng kết phải vào đúng thông báo của
    // mình, không đổi chỗ cho nhau.
    const dung = notes.filter((n) => n.title === 'YouTube → NotebookLM — Dừng hàng đợi');
    ok(dung.length === 1, `phải báo một lần lý do dừng, nhận: ${JSON.stringify(notes.map((n) => n.title))}`);
    ok(
      (dung[0] || {}).message === 'NotebookLM báo: Notebook đã đủ 300 nguồn',
      `lý do dừng phải nằm ở thông báo "Dừng hàng đợi", nhận: ${JSON.stringify((dung[0] || {}).message)}`
    );
    ok(
      !/nguồn đã thêm/.test((dung[0] || {}).message || ''),
      `và không được nuốt mất câu tổng kết vào chỗ của nó, nhận: ${JSON.stringify((dung[0] || {}).message)}`
    );
  }

  /* ---------- D5. hàng đợi rỗng -> im lặng ---------- */
  // Chốt cái chặn `if (done || failed)`. Không có nó thì mỗi lần alarm đánh thức
  // service worker là một thông báo "0 nguồn đã thêm".
  {
    dungHangDoi([]);
    await chayLuot({ saveTranscriptCopy: false });
    ok(tomTat().length === 0, `chạy trên hàng đợi rỗng thì không được báo gì, nhận: ${JSON.stringify(notes)}`);
    ok(hudCalls.length === 0, `và cũng không gửi HUD, nhận: ${JSON.stringify(hudCalls)}`);
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
