/*
 * Nạp mã nguồn THẬT của extension vào một DOM THẬT (jsdom) dựng từ fixture đã chụp.
 *
 * Vì sao là jsdom chứ không phải shim tự viết: thứ đang được kiểm ở đây chính là
 * `querySelectorAll` phân giải ra phần tử nào, theo thứ tự nào, và `textContent`
 * gộp chữ của <mat-icon> ra sao. Một shim tự viết sẽ là *bản cài đặt của chính tôi*
 * cho hai thứ đó — test khi ấy chứng nhận cái shim, không chứng nhận trình duyệt.
 * Đây đúng là điều `tools/verify-live.mjs:7` đã cảnh báo.
 *
 * Hai thứ được thay thế, và chỉ hai thứ:
 *   - Layout: jsdom không tính layout nên getBoundingClientRect luôn 0x0, làm
 *     `isVisible()` loại sạch mọi phần tử. Trả về một rect khác 0. `display:none`
 *     và `opacity:0` vẫn do getComputedStyle thật của jsdom quyết định.
 *   - Thời gian chờ của `waitFor`: rút ngắn timeout, GIỮ NGUYÊN ngữ nghĩa
 *     (trả về ngay lần dò đầu thấy truthy, ném lỗi khi hết giờ).
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'notebooklm-add-source-state-main.html');

/**
 * @param {string} extraHtml HTML chèn thêm vào cuối mat-dialog-content, SAU ô Khám phá nguồn.
 * @param {string} bodyHtml  HTML chèn vào <body>, NGOÀI hộp thoại — chỗ duy nhất dựng
 *                           được danh sách Nguồn của notebook, vốn không nằm trong bản chụp.
 * @param {boolean} opts.withContentScript nạp thêm `src/notebooklm/content.js` (router tin
 *                           nhắn) và trả về `dispatch()` để gửi tin như background vẫn gửi.
 * @param {boolean} opts.withRpc nạp thêm `src/notebooklm/rpc.js` — file này BỌC LẠI
 *                           `NBLM_AUTOMATION`, nên đường DOM bị thay bằng một stub ghi lại
 *                           lời gọi. Không có stub thì không phân biệt được "đã rơi xuống
 *                           DOM" với "đã bỏ qua DOM", mà đó chính là thứ cần đo.
 * @param {object}  opts.settings settings ghi vào storage TRƯỚC khi nạp rpc.js (nó tự đọc).
 * @param {Function} opts.domStub  thay cho `addUrlSource`/`addTextSource` thật.
 */
function loadFixture(
  extraHtml = '',
  bodyHtml = '',
  { withContentScript = false, withRpc = false, settings = null, domStub = null } = {}
) {
  const fragment = fs.readFileSync(FIXTURE, 'utf8');

  // Bản chụp bắt đầu từ `.dialog-container` — phần tử host của Angular Material
  // (`mat-dialog-container`) nằm NGOÀI bản chụp, nên bọc lại ở đây. Đây là thứ
  // DUY NHẤT không có trong bản chụp; mọi phần tử được kiểm bên dưới đều nguyên văn.
  const dom = new JSDOM(
    `<!doctype html><html><body><mat-dialog-container role="dialog">${fragment}</mat-dialog-container></body></html>`,
    { runScripts: 'outside-only', url: 'https://notebooklm.google.com/notebook/abc123' }
  );
  const win = dom.window;

  if (extraHtml) {
    win.document.querySelector('[mat-dialog-content]').insertAdjacentHTML('beforeend', extraHtml);
  }
  if (bodyHtml) win.document.body.insertAdjacentHTML('beforeend', bodyHtml);

  // Layout giả — xem ghi chú đầu file.
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0 };
  };

  const load = (rel) => win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  load('src/common/shared.js');

  // Rút ngắn thời gian chờ, giữ nguyên ngữ nghĩa. Phải đặt TRƯỚC khi nạp
  // automation.js vì file đó destructure `waitFor`/`sleep` ngay lúc nạp.
  const realWaitFor = win.NBLM.waitFor;
  win.NBLM.waitFor = (fn, opts) => realWaitFor(fn, Object.assign({}, opts, { timeout: 250, interval: 15 }));

  // `sleep` cũng phải rút, và vì cùng một lý do — nhưng ở đây nó còn quyết định
  // test có *bắt được lỗi* hay không, không chỉ chạy nhanh hay chậm: nhịp
  // `sleep(1200)` trong `awaitDialogResolution` dài hơn mọi độ trễ mà test dựng
  // được, nên nó vô tình che luôn phép chờ danh sách Nguồn cập nhật. Rút xuống
  // rồi thì hai nhịp chờ tách bạch ra và test phân biệt được chúng.
  const realSleep = win.NBLM.sleep;
  win.NBLM.sleep = (ms) => realSleep(Math.min(ms, 40));

  // `chrome.storage.local` là storage THẬT của extension thu nhỏ lại thành một
  // object: automation.js ghi bản chụp DOM thẳng vào đó, nên test phải đọc được
  // đúng thứ đã ghi. Cài TRƯỚC khi nạp automation.js, và cài cho MỌI test chứ
  // không chỉ chế độ content script — bản chụp không đi qua content script.
  const store = {};
  let router = null;
  win.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (router = fn) },
      sendMessage: () => {},
    },
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj) => Object.assign(store, JSON.parse(JSON.stringify(obj))),
        remove: async (key) => { delete store[key]; },
      },
      onChanged: { addListener() {} },
    },
  };

  load('src/notebooklm/selectors.js');
  load('src/notebooklm/automation.js');

  // Lời gọi xuống đường DOM, theo thứ tự. Phải cài TRƯỚC khi nạp rpc.js: file đó
  // giữ tham chiếu tới `NBLM_AUTOMATION` ngay lúc nạp, nên thay sau là thay hụt.
  const domCalls = [];
  if (withRpc) {
    if (settings) store[win.NBLM.KEYS.SETTINGS] = JSON.parse(JSON.stringify(settings));
    const real = win.NBLM_AUTOMATION;
    const stub = domStub || (async () => ({ ok: false, error: 'đường DOM (stub) không thêm được', limit: false }));
    win.NBLM_AUTOMATION = Object.assign({}, real, {
      addUrlSource: (...args) => (domCalls.push({ ten: 'addUrlSource', args }), stub('addUrlSource', args)),
      addTextSource: (...args) => (domCalls.push({ ten: 'addTextSource', args }), stub('addTextSource', args)),
    });
    load('src/notebooklm/rpc.js');
  }

  // Content script chỉ được nạp khi test cần nó: nó gắn listener và một HUD vào
  // DOM, thứ mọi test khác trong file này không quan tâm.
  let dispatch = null;
  if (withContentScript) {
    load('src/notebooklm/content.js');
    /** Gửi một tin như background vẫn gửi, nhận đúng object mà content script trả lời. */
    dispatch = (message) => new Promise((resolve) => router(message, {}, resolve));
  }

  return {
    dispatch,
    domCalls,
    R: win.NBLM_RPC || null,
    store,
    /**
     * Bản chụp DOM mà automation.js đã ghi vào storage, theo tình huống.
     * Đọc khoá qua `NBLM.KEYS` chứ không gõ lại chuỗi: gõ lại là chép tay một
     * hằng số, và test sẽ xanh cả khi hai đầu ghi/đọc lệch nhau.
     */
    reports: () => store[win.NBLM.KEYS.DOM_REPORTS] || {},
    win,
    doc: win.document,
    dialog: win.document.querySelector('mat-dialog-container'),
    S: win.NBLM_SELECTORS.build(null),
    A: win.NBLM_AUTOMATION,
    I: win.NBLM_AUTOMATION._internals,
    discoverBox: win.document.querySelector('[formcontrolname="discoverSourcesQuery"]'),
    /** Nhãn hiển thị thật của một nút, đọc độc lập với labelOf: chỉ text trong .mdc-button__label, bỏ mat-icon. */
    visibleLabel(el) {
      const holder = el.querySelector('.mdc-button__label') || el;
      return Array.from(holder.querySelectorAll('span'))
        .filter((s) => !s.querySelector('span') && !s.classList.contains('mdc-button__ripple'))
        .map((s) => s.textContent.trim())
        .filter(Boolean)
        .join(' ');
    },
  };
}

/**
 * Nạp `src/youtube/transcript.js` THẬT vào jsdom, kèm một panel transcript dựng tay.
 *
 * Khác `loadFixture` ở đúng một điểm, và cố ý: repo KHÔNG có bản chụp trang watch
 * của YouTube, nên markup dưới đây là do tôi gõ ra. Vì vậy harness này KHÔNG được
 * dùng để chứng nhận selector — một test như thế chỉ chứng nhận thứ tôi vừa gõ, đúng
 * cái bẫy `WORKSPACE_PROTOCOL.md` xếp đầu bảng dominant risks. Thứ nó chứng nhận được
 * là *luồng điều khiển*: vòng cuộn tiêu hết ngân sách thì người gọi có biết hay không,
 * và mốc thời gian với lời thoại của CÙNG một dòng có đi đúng trường của nhau không.
 * Selector có khớp DOM thật hay không thì chỉ `tools/verify-live.mjs` trả lời được.
 *
 * @param {number} total  tổng số dòng transcript mà "YouTube" chịu nạp; Infinity =
 *                        danh sách không bao giờ ngừng dài ra (video rất dài).
 * @param {number} page   số dòng nạp thêm mỗi lần danh sách bị cuộn tới đáy.
 */
function loadTranscriptPanel({ total = Infinity, page = 5 } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <ytd-transcript-renderer>
         <ytd-transcript-segment-list-renderer>
           <div id="segments-container"></div>
         </ytd-transcript-segment-list-renderer>
       </ytd-transcript-renderer>
     </body></html>`,
    { runScripts: 'outside-only', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }
  );
  const win = dom.window;

  // Layout giả — cùng lý do như loadFixture: không có nó thì isVisible() loại sạch.
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0 };
  };

  const holder = win.document.querySelector('#segments-container');
  const stats = { scrolls: 0 };
  const append = () => {
    for (let k = 0; k < page; k++) {
      const i = holder.children.length;
      if (i >= total) return;
      // Mốc thời gian của dòng i là i giây, lời thoại là "dòng i" — hai chuỗi
      // KHÁC HẲN nhau để đổi chỗ hai trường là lộ ngay, chứ không ra một giá trị
      // vẫn parse được thành số hợp lệ.
      holder.insertAdjacentHTML(
        'beforeend',
        `<transcript-segment-view-model>
           <div class="ytwTranscriptSegmentViewModelTimestamp">0:${String(i).padStart(2, '0')}</div>
           <div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">${i} seconds</div>
           <span role="text">dòng ${i}</span>
         </transcript-segment-view-model>`
      );
    }
  };
  append();

  // YouTube nạp thêm dòng khi danh sách bị cuộn tới đáy. jsdom không có cuộn thật,
  // nên móc vào đúng lời gọi mà `loadAllSegments` dùng để đẩy danh sách đi tiếp.
  win.Element.prototype.scrollIntoView = function () {
    stats.scrolls++;
    append();
  };

  const load = (rel) => win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  load('src/common/shared.js');

  // Rút nhịp chờ, giữ nguyên ngữ nghĩa — phải đặt TRƯỚC khi nạp transcript.js vì
  // file đó destructure `waitFor`/`sleep` ngay lúc nạp. `loadAllSegments` nghỉ 250ms
  // mỗi vòng và chạy tới 40 vòng, không rút thì riêng nó đã 10 giây.
  const realWaitFor = win.NBLM.waitFor;
  win.NBLM.waitFor = (fn, opts) => realWaitFor(fn, Object.assign({}, opts, { timeout: 250, interval: 5 }));
  const realSleep = win.NBLM.sleep;
  win.NBLM.sleep = (ms) => realSleep(Math.min(ms, 1));

  load('src/youtube/transcript.js');

  return { win, T: win.NBLM_TRANSCRIPT, stats, count: () => holder.children.length };
}

/* ==================================================================== */
/* content script trên trang YouTube — bề mặt (a), (b), (c)             */
/* ==================================================================== */

/**
 * Nạp `src/youtube/content.js` THẬT vào jsdom, kèm một trang YouTube dựng tay.
 *
 * Cùng cảnh báo như `loadTranscriptPanel`, và đáng nhắc lại vì file này đụng
 * nhiều selector hơn hẳn: repo KHÔNG có bản chụp trang YouTube, nên markup do
 * tôi gõ. Harness này vì thế KHÔNG chứng nhận selector — nó chứng nhận *luồng
 * điều khiển*: cú bấm nào gọi hàm nào, với đối số nào, và cái gì đi tới
 * clipboard. `tools/verify-live.mjs` là chỗ duy nhất trả lời được selector.
 *
 * Bốn global mà `content.js` destructure ngay dòng đầu (`:13-16`) đều phải có
 * mặt TRƯỚC khi nạp, nếu không file ném ngay lúc nạp: `NBLM` (thật, từ
 * `shared.js`), `NBLM_TRANSCRIPT`, `NBLM_PANEL`, `NBLM_BRIDGE` (stub ghi lại
 * lời gọi — chúng nói chuyện với YouTube thật, không mô phỏng được).
 *
 * @param {string}   opts.url        URL trang; quyết định `T.currentVideoId()` mặc định.
 * @param {string}   opts.body       HTML đặt vào <body>.
 * @param {object}   opts.settings   settings ghi vào storage trước khi nạp.
 * @param {Function} opts.describe   thay cho `T.describe(videoId)`; ném thì content.js đi nhánh lỗi.
 * @param {Function} opts.bridge     thay cho `B.call(kind, payload, timeout)`.
 * @param {Function} opts.writeText  thay cho `navigator.clipboard.writeText`; ném để dựng ca từ chối.
 */
function loadYouTubePage({
  url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  body = '',
  settings = null,
  describe = null,
  bridge = null,
  writeText = null,
} = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only',
    url,
  });
  const win = dom.window;

  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0 };
  };

  /*
   * Nhịp chờ của content.js rút xuống, GIỮ NGUYÊN ngữ nghĩa — cùng lý do như
   * `sleep` ở hai harness trên. Ở đây nó bắt buộc chứ không phải cho nhanh:
   * `scheduleScan` debounce 350ms và chạy lại sau *mọi* mutation, nên không rút
   * thì mỗi lần test chèn một thẻ video là thêm một phần ba giây.
   *
   * Toast cũng bị rút theo (4200ms -> 20ms), nên đừng đọc toast qua class
   * `nblm-toast--show`; đọc `textContent`, thứ không bị dọn khi hết giờ.
   */
  const realSetTimeout = win.setTimeout;
  win.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, Math.min(Number(ms) || 0, 20), ...rest);

  const store = {};
  const sent = [];        // mọi chrome.runtime.sendMessage, theo thứ tự
  let router = null;

  /*
   * Câu trả lời mặc định của background: "kho rỗng, mọi thứ thành công".
   *
   * Đây KHÔNG phải mô phỏng service worker — nó là trạng thái ban đầu thật: Sổ
   * đã copy rỗng và Hàng đợi rỗng, nên cửa 2 không có gì để loại. Luật khoá thật
   * được đo ở `copied-log.test.js`, chạy trên chính `service-worker.js`.
   *
   * Test nào cần một background cư xử khác thì gọi `reply()` và tự lo MỌI loại
   * tin — kể cả `bundle-filter`. Cố tình không để harness lặng lẽ vá phần thiếu:
   * một `reply()` trả `{added: 1}` cho mọi tin sẽ biến cửa 2 thành "loại sạch",
   * và test sẽ đỏ ở chỗ không liên quan gì tới thứ nó đang đo.
   */
  const defaultReply = (message) => {
    const type = message && message.type;
    if (type === 'bundle-filter') {
      return { keep: message.urls || [], dropped: [], counts: { copied: 0, queued: 0 } };
    }
    if (type === 'bundle-copied') return { added: (message.urls || []).length };
    if (type === 'enqueue') {
      const n = (message.items || []).length;
      return { added: n, skipped: 0, total: n };
    }
    return {};
  };
  let respond = defaultReply;

  win.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (router = fn) },
      sendMessage: async (message) => {
        sent.push(JSON.parse(JSON.stringify(message)));
        return respond(message);
      },
      getURL: (p) => `chrome-extension://test/${p}`,
    },
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj) => Object.assign(store, JSON.parse(JSON.stringify(obj))),
        remove: async (key) => { delete store[key]; },
      },
      onChanged: { addListener: (fn) => (win.__storageListener = fn) },
    },
  };

  const load = (rel) => win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  load('src/common/shared.js');
  if (settings) store[win.NBLM.KEYS.SETTINGS] = JSON.parse(JSON.stringify(settings));

  const realSleep = win.NBLM.sleep;
  win.NBLM.sleep = (ms) => realSleep(Math.min(ms, 1));

  /*
   * Clipboard. jsdom không có `navigator.clipboard`, nên đây là stub — nhưng nó
   * là stub CÓ CHỦ ĐÍCH chứ không phải chỗ trống lấp cho chạy: mọi assertion về
   * Đường trao tay đọc `clipboard.writes`, và cái phải ghim là *cú bấm nào sinh
   * ra chuỗi nào*, không phải giá trị trả về. Hai bề mặt trả cùng hình dạng mảng
   * URL, nên assert kết quả sẽ xanh cả hai chiều hoán vị.
   */
  const clipboard = { writes: [] };
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        if (writeText) return writeText(text);   // ca từ chối: stub tự ném
        clipboard.writes.push(text);
      },
    },
  });

  const calls = { describe: [], bridge: [], panel: [] };

  win.NBLM_TRANSCRIPT = {
    currentVideoId: () => win.NBLM.videoIdFrom(win.location.href),
    /*
     * Chuyển tiếp NGUYÊN tham số, kể cả `opts` — `noFallback` đi qua đây, và
     * nuốt nó thì mọi test về cái giá của một lượt hỏi hỏng đều xanh giả.
     */
    describe: async (videoId, opts) => {
      calls.describe.push({ videoId, opts });
      if (!describe) throw new Error('harness: chưa cấu hình describe()');
      return describe(videoId, opts);
    },
    extract: async () => ({ segments: [] }),
  };

  let panelOpen = false;
  win.NBLM_PANEL = {
    isOpen: () => panelOpen,
    open: (videoId, langs) => { panelOpen = true; calls.panel.push({ act: 'open', videoId, langs }); },
    close: () => { panelOpen = false; calls.panel.push({ act: 'close' }); },
    reset: () => calls.panel.push({ act: 'reset' }),
  };

  win.NBLM_BRIDGE = {
    call: async (kind, payload, timeout) => {
      calls.bridge.push({ kind, payload, timeout });
      if (!bridge) throw new Error('harness: chưa cấu hình bridge()');
      return bridge(kind, payload, timeout);
    },
  };

  load('src/youtube/content.js');

  /** Chờ hết một nhịp debounce + các promise đang treo. */
  const tick = (ms = 60) => new Promise((r) => realSetTimeout(r, ms));

  return {
    win,
    doc: win.document,
    store,
    sent,
    clipboard,
    calls,
    tick,
    /** Đặt câu trả lời của background cho lần sendMessage tiếp theo. */
    /**
     * Ghi đè HOÀN TOÀN câu trả lời của background — xem `defaultReply` ở trên để
     * biết mình đang thay cái gì.
     */
    reply: (fn) => (respond = typeof fn === 'function' ? fn : () => fn),
    /** Gửi một tin như background vẫn gửi; trả về đúng object content script đáp lại. */
    dispatch: (message) => new Promise((resolve) => router(message, {}, resolve)),
    $: (sel) => win.document.querySelector(sel),
    $$: (sel) => Array.from(win.document.querySelectorAll(sel)),
    /** Nội dung toast gần nhất — đọc textContent, xem ghi chú về nhịp chờ ở trên. */
    toast: () => {
      const el = win.document.querySelector('.nblm-toast');
      return el ? el.textContent : '';
    },
    /** Gỡ MutationObserver và mọi timer còn treo của trang này. */
    close: () => win.close(),
    click(sel) {
      const el = typeof sel === 'string' ? win.document.querySelector(sel) : sel;
      if (!el) throw new Error(`không tìm thấy phần tử để bấm: ${sel}`);
      el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      return el;
    },
  };
}

/**
 * Một thẻ video trong trang danh sách YouTube, đủ để `readItem()` đọc được.
 *
 * `badge` để rỗng nghĩa là **không có huy hiệu** — và đó là ca thường gặp nhất
 * chứ không phải ca biên: YouTube không gắn huy hiệu nào cho video công khai,
 * nên `privacyHint` ra `unknown`. Đừng đọc `unknown` ở đây thành "không công khai".
 */
function videoCard(videoId, title, badge = '') {
  return `<ytd-video-renderer>
    <a id="thumbnail" href="/watch?v=${videoId}"></a>
    <a id="video-title" href="/watch?v=${videoId}" title="${title}">${title}</a>
    ${badge ? `<ytd-badge-supported-renderer>${badge}</ytd-badge-supported-renderer>` : ''}
  </ytd-video-renderer>`;
}

/** Hàng nút của trang watch — chỗ `ensureWatchButton()` chèn nút vào. */
const WATCH_ROW = '<div id="top-level-buttons-computed"></div>';

/* ==================================================================== */
/* content script trên trang tài liệu — bề mặt (d)                       */
/* ==================================================================== */

/**
 * Nạp `src/docs/content.js` THẬT vào jsdom, kèm một cây sidebar dựng sẵn.
 *
 * Khác hai harness YouTube ở một điểm đáng nói: bảng chọn dựng trong **shadow
 * DOM**, nên `document.querySelector` không với tới nó. Đó không phải chi tiết
 * cài đặt tuỳ tiện — trang tài liệu nào cũng có CSS hung hãn, để ngoài shadow là
 * vỡ giao diện ngay trang đầu gặp phải. Test phải đi qua `panel()` bên dưới.
 *
 * `NBLM_DOCS_SIDEBAR` bị thay bằng stub trả thẳng cây đã dựng: `sidebar.js` thật
 * đọc `getBoundingClientRect` + `window.innerWidth` để chấm điểm ứng viên, mà
 * jsdom không có layout — dùng bản thật ở đây là đo một thứ luôn trả 0.
 *
 * @param {Array}  opts.tree     cây sidebar; `null` = không dò thấy sidebar nào.
 * @param {object} opts.settings settings ghi vào storage trước khi nạp.
 * @param {Function} opts.extract thay cho `NBLM_DOCS_EXTRACT.fromUrl/fromDocument`.
 */
function loadDocsPage({
  url = 'https://docs.example.dev/guide/intro',
  tree = null,
  settings = null,
  extract = null,
} = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main><h1>Trang tài liệu</h1></main></body></html>', {
    runScripts: 'outside-only',
    url,
  });
  const win = dom.window;

  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0 };
  };

  const realSetTimeout = win.setTimeout;
  win.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, Math.min(Number(ms) || 0, 20), ...rest);

  const store = {};
  const sent = [];
  let router = null;

  /* Xem `defaultReply` của `loadYouTubePage` — cùng luật: kho rỗng, mọi thứ thành công. */
  let respond = (message) => {
    const type = message && message.type;
    if (type === 'bundle-filter') {
      return { keep: message.urls || [], dropped: [], counts: { copied: 0, queued: 0 } };
    }
    if (type === 'bundle-copied') return { added: (message.urls || []).length };
    if (type === 'enqueue') {
      const n = (message.items || []).length;
      return { added: n, skipped: 0, total: n };
    }
    if (type === 'docs-raw-fetch') return { error: 'harness: chưa cấu hình docs-raw-fetch' };
    return {};
  };

  win.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (router = fn) },
      sendMessage: async (message) => {
        sent.push(JSON.parse(JSON.stringify(message)));
        return respond(message);
      },
      getURL: (p) => `chrome-extension://test/${p}`,
    },
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj) => Object.assign(store, JSON.parse(JSON.stringify(obj))),
        remove: async (key) => { delete store[key]; },
      },
      onChanged: { addListener() {} },
    },
  };

  const load = (rel) => win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  load('src/common/shared.js');
  if (settings) store[win.NBLM.KEYS.SETTINGS] = JSON.parse(JSON.stringify(settings));

  const realSleep = win.NBLM.sleep;
  win.NBLM.sleep = (ms) => realSleep(Math.min(ms, 1));

  const clipboard = { writes: [] };
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { clipboard.writes.push(text); } },
  });

  const countUrls = (nodes) =>
    nodes.reduce((n, node) => n + (node.url ? 1 : 0) + countUrls(node.children || []), 0);

  win.NBLM_DOCS_SIDEBAR = {
    detect: () => (tree ? { tree, count: countUrls(tree) } : null),
  };

  /*
   * `extract.js` nạp THẬT, không stub — khác hẳn `sidebar.js` ở trên, và khác vì
   * một lý do đo được: `sidebar.js` chấm điểm bằng `getBoundingClientRect` +
   * `window.innerWidth`, thứ jsdom không có, nên bản thật ở đó luôn trả 0. Còn
   * `extract.js` chỉ đọc cấu trúc DOM và đếm chữ — jsdom làm đúng cả hai.
   *
   * Đấy là điều kiện để cửa đo được kiểm THẬT: `how` và `chars` phải do
   * `pickRoot`/`score` thật sinh ra từ HTML thật. Stub hai giá trị đó là tự chấm
   * điểm bài của mình.
   */
  const calls = { extract: [] };
  load('src/docs/markdown.js');   // extract.js đọc NBLM_DOCS_MARKDOWN ngay lúc chạy
  load('src/docs/extract.js');

  if (extract) {
    // Chỉ hai đường ĐI QUA MẠNG mới thay được; `fromHtml` giữ nguyên bản thật.
    const real = win.NBLM_DOCS_EXTRACT;
    win.NBLM_DOCS_EXTRACT = Object.assign({}, real, {
      fromUrl: async (u, opts) => {
        calls.extract.push({ how: 'fromUrl', url: u, opts });
        return extract(u, opts);
      },
      fromDocument: (docArg, u, opts) => {
        calls.extract.push({ how: 'fromDocument', url: u, opts });
        return extract(u, opts);
      },
    });
  }

  load('src/docs/content.js');

  const tick = (ms = 60) => new Promise((r) => realSetTimeout(r, ms));
  const shadow = () => {
    const host = win.document.querySelector('#nblm-docs-root');
    return host ? host.shadowRoot : null;
  };

  return {
    win,
    doc: win.document,
    store,
    sent,
    clipboard,
    calls,
    tick,
    reply: (fn) => (respond = typeof fn === 'function' ? fn : () => fn),
    dispatch: (message) => new Promise((resolve) => router(message, {}, resolve)),
    /** Bảng chọn nằm trong shadow DOM — mọi truy vấn giao diện phải qua đây. */
    panel: (sel) => (shadow() ? shadow().querySelector(sel) : null),
    panelAll: (sel) => (shadow() ? Array.from(shadow().querySelectorAll(sel)) : []),
    launcher: () => win.document.querySelector('#nblm-docs-launcher'),
    /** Câu `flash()` gần nhất. Toast nằm ngoài <body>, trên documentElement. */
    flash: () => {
      const el = win.document.querySelector('#nblm-docs-toast');
      return el ? el.textContent : '';
    },
    /*
     * `docs/content.js:457` cài một `setInterval(1500)` dò lại sidebar suốt vòng
     * đời trang. Trong trình duyệt đó là đúng — sidebar của SPA xuất hiện muộn.
     * Trong test thì nó giữ event loop sống mãi, nên mỗi trang dựng ra phải được
     * đóng lại; không đóng thì `node` treo sau khi mọi assertion đã chạy xong.
     */
    close: () => win.close(),
    visible: () => {
      const host = win.document.querySelector('#nblm-docs-root');
      return !!host && host.style.display === 'block';
    },
    click(el) {
      const node = typeof el === 'string' ? (shadow() && shadow().querySelector(el)) : el;
      if (!node) throw new Error(`không tìm thấy phần tử để bấm: ${el}`);
      node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      return node;
    },
  };
}

/** Một nút trong cây sidebar tài liệu. */
function docNode(title, url, children = [], depth = 0) {
  return { title, url, children, depth };
}

module.exports = {
  loadFixture,
  loadTranscriptPanel,
  loadYouTubePage,
  loadDocsPage,
  videoCard,
  docNode,
  WATCH_ROW,
};
