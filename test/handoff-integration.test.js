/*
 * Đường trao tay chạy THẬT hai đầu trong một tiến trình: content script trong
 * jsdom, service worker trong node, `chrome.runtime.sendMessage` của bên này nối
 * thẳng vào `onMessage` của bên kia.
 *
 * Vì sao cần một file riêng cho việc này. Mọi test khác của Đường trao tay đều
 * mock đúng cái mối nối: `test/dom-harness.js` trả `{keep: message.urls,
 * dropped: []}` cho `bundle-filter`, còn `test/copied-log.test.js` gọi
 * `filterBundle` với URL gõ tay. Hai phía vì thế KHÔNG BAO GIỜ được đối chiếu —
 * và giữa chúng có hai phép chuẩn hoá URL khác nhau, viết ở hai file khác nhau:
 *
 *   - content script: `canonicalUrl(videoId)` dựng URL để gửi lên
 *   - service worker: `bundleKey(url)` rút khoá để tra Sổ
 *
 * Chúng phải nói cùng một ngôn ngữ, mà không dòng code nào ép điều đó. Đổi định
 * dạng URL ở một phía là Sổ ngừng khớp — cửa 2 cho qua mọi thứ, người dùng dán
 * trùng, và không test nào đỏ. Đúng hình dạng "đường dữ liệu song song" repo đã
 * dính một lần.
 *
 * File này KHÔNG chứng nhận selector YouTube (markup do tôi gõ, xem ghi chú ở
 * `dom-harness.js`) và KHÔNG thay các test đơn lẻ. Nó chỉ giữ một bất biến:
 * copy hai lần cùng một danh sách thì lượt hai phải bị cửa 2 loại sạch.
 *
 * Phạm vi, nói thẳng. Đo hoán vị 2026-08-31, bốn phép:
 *   - `itemKey` đổi tiền tố `yt:` → `ytq:`     → 2 đỏ
 *   - `bundleKey` bỏ nhánh videoId             → 3 đỏ
 *   - `canonicalUrl` → `youtube.com/v/<id>`    → 0 đỏ
 *   - `canonicalUrl` → `youtu.be/<id>`         → 0 đỏ
 * Hai phép cuối xanh KHÔNG phải vì test hở: `videoIdFrom` nhận cả ba dạng
 * (kiểm thẳng 2026-08-31), nên đổi dạng URL là đổi tương đương thật. Chỗ file
 * này thật sự canh là mối nối `bundleKey` ↔ `itemKey` — hai phép chuẩn hoá viết
 * ở hai chỗ, không phép nào gọi phép kia.
 */
const path = require('node:path');
const { loadYouTubePage, videoCard } = require('./dom-harness');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

/* ------------------------------------------------------------------ */
/* service worker THẬT, nạp y như Chrome nạp                           */
/* ------------------------------------------------------------------ */

const noopEvent = () => ({ addListener() {}, removeListener() {} });
const store = new Map();
let router = null;

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
  notifications: { create: async () => {}, getPermissionLevel: async () => 'granted' },
  tabs: { query: async () => [], sendMessage: async () => ({ ok: true }), onRemoved: noopEvent() },
  windows: { update: async () => ({}) },
  downloads: { download: async () => 1, search: async () => [], onChanged: noopEvent() },
};

require(path.join(ROOT, 'src/background/service-worker.js'));

/**
 * Mối nối. Đây là toàn bộ lý do file này tồn tại — không có `keep`/`dropped`
 * nào do test dựng ra, mọi câu trả lời đến từ `service-worker.js` thật.
 */
const wire = (h) => h.reply((m) => new Promise((resolve) => router(m, {}, resolve)));

const IDS = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];
const listBody = IDS.map((id, i) => videoCard(id, `Video ${i + 1}`)).join('');

const page = () =>
  loadYouTubePage({
    url: 'https://www.youtube.com/playlist?list=PL123',
    body: listBody,
    describe: async (id) => ({
      videoId: id, title: `Video ${id}`, channel: 'Kênh', durationSec: 90,
      privacy: 'public', hasCaptions: true, playable: true,
    }),
    bridge: async (kind) =>
      kind === 'context' ? { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' } : { items: [] },
  });

const tickAll = (h) =>
  h.$$('.nblm-pick input').forEach((b) => { b.checked = true; b.dispatchEvent(new h.win.Event('change')); });

(async () => {
  ok(typeof router === 'function', 'service worker phải gắn onMessage — không có router thì không nối được gì');
  if (typeof router !== 'function') {
    console.log(`\n${pass} pass, ${fail} fail`);
    process.exit(1);
  }

  /* ---------------------------------------------------------------- */
  /* lượt 1: kho rỗng, cả ba link phải qua cửa 2                       */
  /* ---------------------------------------------------------------- */

  store.clear();
  {
    const h = page();
    wire(h);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(200);

    eq(h.clipboard.writes.length, 1, 'lượt đầu trên kho rỗng phải copy được — không thì lượt hai vô nghĩa');
    const lines = (h.clipboard.writes[0] || '').split('\n');
    eq(lines.length, 3, `cả ba link phải vào clipboard — nhận: ${JSON.stringify(lines)}`);
    ok(!h.$('#nblm-recopy'), 'không có gì bị loại thì không dựng thẻ Copy lại');
    h.close();
  }

  /*
   * Sổ phải ghi được — và ghi bằng chính khoá `bundleKey` rút từ URL mà content
   * script vừa gửi. Đọc thẳng storage chứ không hỏi lại qua tin nhắn: hỏi lại là
   * đi qua đúng đoạn code đang được kiểm, nên nó xanh cả khi hai đầu lệch nhau.
   */
  {
    const rows = store.get('copiedLog') || [];
    eq(rows.map((r) => r.key).sort(), IDS.map((id) => `yt:${id}`).sort(),
      'Sổ phải ghi đủ ba dòng, khoá dạng `yt:<videoId>` — lệch dạng ở đây là cửa 2 mù ở lượt sau');
    eq(rows[0] && rows[0].from, 'Playlist thử', 'và ghi kèm ngữ cảnh gốc của lượt copy');
  }

  /* ---------------------------------------------------------------- */
  /* lượt 2: CÙNG danh sách, cửa 2 thật phải loại sạch                 */
  /* ---------------------------------------------------------------- */

  /*
   * Đây là assertion mang toàn bộ giá trị của file. Nó chỉ xanh khi
   * `canonicalUrl(videoId)` của content script và `bundleKey(url)` của service
   * worker khớp nhau qua một chuyến đi thật. Mock ở `dom-harness.js` không thể
   * cho câu trả lời này vì nó không tra kho nào cả.
   */
  {
    const h = page();
    wire(h);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(200);

    eq(h.clipboard.writes, [],
      'copy lần hai cùng một danh sách: cửa 2 THẬT phải loại sạch, và bó rỗng KHÔNG chạm clipboard');
    const chip = h.$('#nblm-recopy');
    ok(!!chip, 'ba link bị loại vì "đã copy" thì phải có thẻ Copy lại — im lặng bỏ link là đúng lỗi đã cấm');
    ok(/3 link/.test((chip && chip.textContent) || ''),
      `thẻ phải mang đúng số link bị loại — nhận: "${(chip && chip.textContent) || ''}"`);

    /* Và nút đó phải chạy được xuyên qua service worker thật. */
    const go = h.$('#nblm-recopy .nblm-recopy__go');
    if (go) h.click(go);
    await h.tick(250);
    eq((h.clipboard.writes[0] || '').split('\n').length, 3,
      `Copy lại bỏ qua cửa 2 thì cả ba link phải tới clipboard — nhận: ${JSON.stringify(h.clipboard.writes)}`);
    h.close();
  }

  /* ---------------------------------------------------------------- */
  /* Hàng đợi cũng là một kho của cửa 2                                */
  /* ---------------------------------------------------------------- */

  /*
   * Link chưa từng copy nhưng đang nằm trong Hàng đợi cũng phải bị loại — và
   * khoá của Hàng đợi (`itemKey`, dựng từ `videoId`) là một phép chuẩn hoá THỨ
   * BA, không đi qua `bundleKey`. Không ca này thì `yt:` ↔ `itemKey` cũng không
   * chỗ nào đối chiếu.
   */
  store.clear();
  await new Promise((r) => router({ type: 'enqueue', items: [{ videoId: IDS[1], title: 'Video 2' }] }, {}, r));
  {
    const h = page();
    wire(h);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(200);

    const lines = (h.clipboard.writes[0] || '').split('\n').filter(Boolean);
    eq(lines.length, 2,
      `link đang chờ trong Hàng đợi phải bị cửa 2 loại — nhận: ${JSON.stringify(lines)}`);
    ok(!lines.some((u) => u.includes(IDS[1])),
      `và phải loại ĐÚNG link đó, không phải một link bất kỳ — nhận: ${JSON.stringify(lines)}`);
    /*
     * `why: 'queued'` KHÔNG được đi vào thẻ *Copy lại*: copy lại một link đang
     * chờ là đưa nó vào NotebookLM hai lần. Nó chỉ được đếm trong bản tổng kết.
     */
    ok(!h.$('#nblm-recopy'),
      'link bị loại vì "đang trong Hàng đợi" không được dựng thẻ Copy lại — Lượt chạy sẽ tự đưa nó vào');
    h.close();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
