/*
 * Hằng số + tiện ích dùng chung.
 * File này được nạp như classic script trong content scripts và qua
 * importScripts() trong service worker, nên mọi thứ gắn vào globalThis.NBLM.
 */
;(function (root) {
  'use strict';

  const MSG = {
    // popup / content -> background
    ENQUEUE: 'enqueue',
    GET_STATE: 'get-state',
    RUN: 'run',
    STOP: 'stop',
    CLEAR_DONE: 'clear-done',
    CLEAR_ALL: 'clear-all',
    REMOVE: 'remove',
    RETRY: 'retry',
    OPEN_OPTIONS: 'open-options',
    // background -> popup
    STATE_CHANGED: 'state-changed',
    // background -> youtube tab
    YT_PING: 'yt-ping',
    YT_DESCRIBE: 'yt-describe',
    YT_EXTRACT: 'yt-extract',
    YT_CONTEXT: 'yt-context',   // trang này có playlist/kênh import toàn bộ được không
    YT_PLAYLIST: 'yt-playlist', // quét hết một playlist qua InnerTube
    // background -> notebooklm tab
    NLM_PING: 'nlm-ping',
    NLM_ADD_URL: 'nlm-add-url',
    NLM_ADD_TEXT: 'nlm-add-text',
    // Hai lượt đứng ở GỐC notebooklm.google.com, không cần đứng trong notebook.
    // Chỉ chạy sau một cử chỉ của owner trong popup — không có lối gọi tự động
    // nào, và đó là ràng buộc thay cho việc gắn chúng sau `rpcEnabled`.
    NLM_LIST_NOTEBOOKS: 'nlm-list-notebooks',
    NLM_CREATE_NOTEBOOK: 'nlm-create-notebook',
    // background/popup -> tab tài liệu
    DOCS_PING: 'docs-ping',
    DOCS_PANEL: 'docs-panel',     // mở bảng chọn link
    DOCS_FETCH: 'docs-fetch',     // tải URL khác bằng fetch rồi trích (không rời trang)
    DOCS_READ: 'docs-read',       // trích ngay từ DOM đang hiển thị
    DOCS_RAW_FETCH: 'docs-raw-fetch', // tab -> background: fetch ẨN DANH, trả HTML thô
    // Đường trao tay: bề mặt -> background -> bề mặt
    // {urls} -> {keep, dropped}; mỗi phần tử `dropped` là {url, why:'copied'|'queued'}.
    BUNDLE_FILTER: 'bundle-filter',   // cửa 2: khử trùng
    BUNDLE_COPIED: 'bundle-copied',   // báo NGƯỢC sau khi writeText xong -> ghi Sổ
    CLEAR_COPIED: 'clear-copied',     // xoá Sổ đã copy
    // {summary, source} sau khi copy: nhảy sang tab notebook + báo, không thao tác.
    // `summary` bắt buộc trên thực tế — bỏ nó thì `noted: true` trả về nghĩa là
    // "không có gì để báo", không phải "đã báo". `source` là tên bề mặt khởi lượt.
    JUMP_NOTEBOOK: 'jump-notebook',
    SHORTCUT_HANDOFF: 'shortcut-handoff', // background -> tab youtube: phím tắt nhờ tab tự trao tay
    // popup -> background
    OPEN_DOCS_PANEL: 'open-docs-panel',
    COLLECT_TABS: 'collect-tabs',             // gom mọi tab YouTube đang mở
    COLLECT_PAGE_LINKS: 'collect-page-links', // quét link YouTube trên tab hiện tại
    IMPORT_PLAYLIST: 'import-playlist',       // import toàn bộ playlist/kênh của tab hiện tại
    LIST_NOTEBOOKS: 'list-notebooks',         // popup xin danh sách notebook cho dropdown
    CREATE_NOTEBOOK: 'create-notebook',       // popup xin tạo notebook mới (lượt GHI duy nhất)
  };

  /** Loại nguồn trong hàng đợi. */
  const KIND = {
    YOUTUBE: 'youtube',
    DOCS: 'docs',
  };

  const STATUS = {
    PENDING: 'pending',
    EXTRACTING: 'extracting',
    IMPORTING: 'importing',
    DONE: 'done',
    ERROR: 'error',
    SKIPPED: 'skipped',
  };

  const PRIVACY = {
    PUBLIC: 'public',
    UNLISTED: 'unlisted',
    PRIVATE: 'private',
    UNKNOWN: 'unknown',
  };

  const KEYS = {
    QUEUE: 'queue',
    SETTINGS: 'settings',
    RUNNING: 'running',
    /** Bản chụp cấu trúc DOM khi extension lạc đường — xem getDomReports(). */
    DOM_REPORTS: 'domReports',
    /**
     * Sổ đã copy — xem getCopiedLog().
     *
     * `local`, không phải `sync`, và đó là ràng buộc chứ không phải sở thích:
     * `sync` có hạn ngạch ~8KB mỗi item, nên Sổ sẽ chặn ở khoảng trăm dòng đầu
     * rồi ghi hỏng IM LẶNG — trong khi theo thiết kế Sổ chỉ có lớn lên. Cả repo
     * dùng `local` (0 chỗ gọi `sync`) và `unlimitedStorage` ở `manifest.json:9`
     * chỉ áp cho `local`.
     */
    COPIED: 'copiedLog',
  };

  const DEFAULTS = {
    /** URL notebook đích, ví dụ https://notebooklm.google.com/notebook/<id> */
    notebookUrl: '',
    /** Ngôn ngữ ưu tiên khi chọn caption track. */
    preferredLangs: ['vi', 'en'],
    /** Chèn timestamp [mm:ss] vào transcript — giúp NotebookLM trích dẫn đúng đoạn. */
    includeTimestamps: true,
    /** Gộp các dòng transcript ngắn thành đoạn ~ n giây cho dễ đọc. 0 = không gộp. */
    groupSeconds: 30,
    /** Video unlisted xử lý thế nào. */
    unlistedMode: 'url-then-transcript', // 'url' | 'transcript' | 'url-then-transcript'
    /** Video public: thử URL trước, hỏng thì rơi về transcript. */
    publicFallbackToTranscript: true,
    /** Nghỉ giữa 2 lần import (ms) để NotebookLM kịp xử lý. */
    delayMs: 1200,
    /** Đóng tab YouTube mà extension tự mở để trích transcript. */
    autoCloseTabs: true,
    /** Ghi đè selector/nhãn của NotebookLM khi Google đổi giao diện (JSON). */
    selectorOverrides: null,
    /**
     * Thử thêm Nguồn bằng batchexecute trước, hỏng thì rơi xuống đường DOM.
     *
     * MẶC ĐỊNH TẮT, và đó là chủ ý chứ không phải quên bật. rpc id, đường
     * batchexecute và hình dạng `f.req` trong `src/notebooklm/rpc.js` đều mới là
     * GIẢ THUYẾT chép từ tài liệu cộng đồng — chưa ai đo trên một request thật.
     * Id sai thì không ghi gì (ta phát hiện rồi rơi xuống DOM), nhưng id ĐÚNG mà
     * hình dạng payload sai thì server vẫn có thể tạo ra một Nguồn rác, và thêm
     * Nguồn không idempotent. Bật công tắc này = quyết định ghi thử lên tài
     * khoản thật, nên nó là việc của owner sau khi chạy
     * `tools/probe-notebooklm.mjs` trên một notebook nháp.
     */
    rpcEnabled: false,
    /**
     * Ghi đè rpc id / đường batchexecute / vị trí trong payload (JSON), gộp thêm
     * theo đúng luật của `selectorOverrides`: mảng thì NỐI vào chứ không thay,
     * nên dán id mới vào là nó được thử trước còn id cũ vẫn nằm đó làm dự phòng.
     */
    rpcOverrides: null,
    /** Hiện checkbox chọn hàng loạt trên trang danh sách. */
    bulkSelectUI: true,
    /**
     * Trần số video khi quét toàn bộ một playlist/kênh.
     * Kênh lớn có hàng nghìn video, mà một notebook chỉ chứa được 300 nguồn (đo
     * thật trên hộp thoại thêm nguồn 2026-08-23: "1/300") — quét sạch chỉ tổ mất
     * thời gian rồi tắc ở hàng đợi.
     */
    maxBulkVideos: 500,
    /**
     * Ghi thêm một Bản sao xuống đĩa cho mỗi video, ngay trong Lượt chạy.
     * Là *phụ phẩm* của việc trích Transcript, không phải mục đích của Lượt chạy:
     * hỏng thì ghi lý do lên Mục rồi đi tiếp, không chặn việc thêm Nguồn.
     */
    saveTranscriptCopy: false,
    /** Định dạng Bản sao xuống đĩa: txt | srt | vtt | md */
    downloadFormat: 'txt',
    /** Thư mục con trong Downloads để gom transcript lại một chỗ. */
    downloadSubfolder: 'Transcript YouTube',

    /* --- trang tài liệu --------------------------------------------- */

    /**
     * Hiện nút nổi mở bảng chọn link khi dò thấy sidebar tài liệu.
     *
     * TẮT SẴN, và đây là kết luận của một phép đo chứ không phải sự thận trọng.
     * `sidebar.js` chấm điểm ứng viên nhưng `detect()` KHÔNG có ngưỡng điểm —
     * nó trả về ứng viên cao điểm nhất, mà `rate()` chỉ loại khi dưới 3 link.
     * Nên nút hiện trên gần như mọi trang có một `nav`/`aside`/`[class*=sidebar]`
     * chứa 3 link cùng host.
     *
     * Đo 2026-09-03, brave headless + CDP, `detect()` thật trên trang thật:
     *
     *   | trang              | nút hiện | count | onCurrentPage | bề ngang |
     *   |--------------------|----------|-------|---------------|----------|
     *   | vitepress (docs)   | có       |    17 | có            |      15% |
     *   | docusaurus (docs)  | có       |     9 | có            |      23% |
     *   | MDN (docs)         | có       |   182 | có            |      99% |
     *   | BBC News           | CÓ ✗     |    24 | có            |      99% |
     *   | Wikipedia          | CÓ ✗     |   750 | có            |      57% |
     *   | Hacker News        | không    |     - | -             |        - |
     *
     * Vì sao KHÔNG chữa bằng một ngưỡng: bộ tín hiệu hiện có không tách được.
     * `onCurrentPage` — thứ comment trong `rate()` gọi là "dấu hiệu mạnh nhất" —
     * đúng ở CẢ BBC (nav có link "News" trong khi ta đang ở `/news`) lẫn
     * Wikipedia (navbox chứa link tới chính bài đang đọc). Bề ngang loại được
     * hai trang đó nhưng giết luôn MDN. Thêm ngưỡng là chỉnh số trên 8 mẫu.
     *
     * Ba lối gọi khác đã có sẵn và đã ghi trong chính trang Cài đặt:
     * `Alt+Shift+D`, popup, và chuột phải → *Chọn link tài liệu…*. Nên tắt sẵn
     * không mất tính năng nào; nó chỉ thôi tự mời trên trang bạn không hỏi.
     */
    docsLauncher: false,
    /**
     * Cách đưa một trang tài liệu vào NotebookLM.
     * 'text'          -> luôn trích nội dung tại máy rồi dán (mặc định: NotebookLM
     *                    thường không đọc nổi docs render bằng JS).
     * 'text-then-url' -> dán text, hỏng thì thử link.
     * 'url-then-text' -> thử link trước, hỏng thì dán text.
     */
    docsMode: 'text',
    /** Giữ link dạng [chữ](url) trong nội dung trích. Tắt cho gọn, bật để lần theo tham chiếu. */
    docsKeepLinks: false,
    /** Giữ ảnh dạng ![alt](url) — biểu đồ trong docs đôi khi đáng giữ phần alt. */
    docsKeepImages: true,
    /** Cắt nguồn dài hơn ngưỡng này (ký tự). 0 = không cắt. */
    docsMaxChars: 400000,
    /** Trích được ít hơn ngần này ký tự thì coi như fetch hỏng → mở tab ẩn đọc DOM đã render. */
    docsMinChars: 600,
  };

  /* ------------------------------------------------------------------ */
  /* storage                                                             */
  /* ------------------------------------------------------------------ */

  async function getSettings() {
    const got = await chrome.storage.local.get(KEYS.SETTINGS);
    return Object.assign({}, DEFAULTS, got[KEYS.SETTINGS] || {});
  }

  async function setSettings(patch) {
    const next = Object.assign(await getSettings(), patch);
    await chrome.storage.local.set({ [KEYS.SETTINGS]: next });
    return next;
  }

  /**
   * Bản chụp cấu trúc DOM mà `automation.js` ghi lại khi nó KHÔNG tìm được thứ
   * nó cần: `{ [tình huống]: bản chụp }`.
   *
   * Một bản GẦN NHẤT cho mỗi tình huống, cố ý không phải nhật ký — thứ đáng đọc
   * là hiện trạng giao diện lúc này, còn tích lại thì chỉ phình storage. Trang
   * Options là nơi duy nhất đọc nó; nội dung chỉ có cấu trúc (tên thẻ, class,
   * formcontrolname, nhãn nút), không có dữ liệu của người dùng.
   */
  async function getDomReports() {
    const got = await chrome.storage.local.get(KEYS.DOM_REPORTS);
    const value = got[KEYS.DOM_REPORTS];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  async function saveDomReport(situation, report) {
    const all = await getDomReports();
    all[situation] = report;
    await chrome.storage.local.set({ [KEYS.DOM_REPORTS]: all });
    return all;
  }

  async function clearDomReports() {
    await chrome.storage.local.remove(KEYS.DOM_REPORTS);
  }

  /**
   * Sổ đã copy: mỗi dòng là một URL đã thật sự tới clipboard.
   *
   * Câu nó trả lời là *"cái này copy rồi chưa"* — không phải "cái này đã vào
   * NotebookLM chưa". Extension không biết người dùng có dán hay không, và dán
   * rồi có vào hay không; Sổ ghi đúng cái nó chứng kiến được, không hơn.
   *
   * Chỉ service worker được GHI (xem `recordCopied`); mọi bề mặt khác đọc.
   */
  async function getCopiedLog() {
    const got = await chrome.storage.local.get(KEYS.COPIED);
    return Array.isArray(got[KEYS.COPIED]) ? got[KEYS.COPIED] : [];
  }

  async function getQueue() {
    const got = await chrome.storage.local.get(KEYS.QUEUE);
    return Array.isArray(got[KEYS.QUEUE]) ? got[KEYS.QUEUE] : [];
  }

  async function setQueue(queue) {
    await chrome.storage.local.set({ [KEYS.QUEUE]: queue });
  }

  /* ------------------------------------------------------------------ */
  /* youtube url helpers                                                 */
  /* ------------------------------------------------------------------ */

  /** Rút videoId từ mọi dạng URL YouTube (watch, youtu.be, shorts, live, embed). */
  function videoIdFrom(input) {
    if (!input) return null;
    const raw = String(input).trim();
    if (/^[\w-]{11}$/.test(raw)) return raw;

    let u;
    try {
      u = new URL(raw, 'https://www.youtube.com');
    } catch (_) {
      return null;
    }
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(u.hostname)) return null;

    if (/youtu\.be$/i.test(u.hostname)) return clean(u.pathname.slice(1).split('/')[0]);

    const v = u.searchParams.get('v');
    if (v) return clean(v);

    const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(u.pathname);
    if (m) return clean(m[1]);

    return null;

    function clean(id) {
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
  }

  function canonicalUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  /** Tách danh sách URL/ID từ một khối text tự do. */
  function parseUrlList(text) {
    const out = [];
    const seen = new Set();
    for (const token of String(text || '').split(/[\s,;]+/)) {
      const id = videoIdFrom(token);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Bó link — ai được vào clipboard                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Ba hạng của một video đứng trước Bó link. Chúng đi thẳng vào câu người dùng
   * đọc ở bảng xác nhận, nên đừng gộp `RESTRICTED` với `UNKNOWN`: một bên là
   * *đã đo và trượt*, bên kia là *không đo được*. Người dùng xử lý hai ca đó
   * khác nhau — ca thứ nhất là đúng thiết kế, ca thứ hai là dấu hiệu hỏng.
   */
  const BUNDLE = {
    ACCEPT: 'accept',         // vào clipboard
    RESTRICTED: 'restricted', // private/unlisted -> Hàng đợi
    UNKNOWN: 'unknown',       // không hỏi được   -> Hàng đợi
  };

  /**
   * Cửa 1 — huy hiệu trên thẻ video. CHỈ ĐƯỢC LOẠI, không bao giờ được nhận.
   *
   * Huy hiệu miễn phí (đọc sẵn từ DOM/JSON) nhưng nó *vắng mặt* với video công
   * khai, nên `unknown` ở đây nghĩa là "chưa hỏi ai cả", không phải "không công
   * khai". Cho nó quyền nhận là dựng lại đúng lỗi ADR 0001 đã bác: lọc theo huy
   * hiệu dương thì mọi video công khai đều rớt.
   *
   * Nó cũng đọc trượt có hệ thống: owner để YouTube tiếng Đức thì nhãn là
   * `Privat`/`Nicht gelistet`, cả hai bộ regex trong repo đều không khớp và trả
   * `unknown`. Vì vậy loại-được là lãi, không loại được thì phải hỏi tiếp.
   */
  function badgeRejects({ privacy, accessible } = {}) {
    if (accessible === false) return true;  // private của người khác, hoặc đã xoá
    return privacy === PRIVACY.PRIVATE || privacy === PRIVACY.UNLISTED;
  }

  /**
   * Cửa 3 — vị ngữ DUY NHẤT cấp phép một video vào Bó link.
   *
   * Một URL vào Bó khi và chỉ khi, trong cùng cú bấm đó, một lượt hỏi player
   * response trả về và thoả CẢ BA: id khớp cái mình vừa hỏi, privacy là public,
   * và video phát được. Mọi ca khác đi Hàng đợi.
   *
   * Vì sao phải đủ ba chứ không phải mỗi điều kiện privacy: `metaFrom` mở bằng
   * `let privacy = 'public'` (`src/youtube/page-bridge.js:292`) — đó là
   * fall-through, KHÔNG phải một phép đo. `metaFrom({})` trả về
   * `{ videoId: null, privacy: 'public', playable: true }`. Nghĩa là một lượt hỏi
   * trả về rỗng sẽ tự xưng là công khai; chỉ điều kiện `videoId` khớp mới bắt
   * được nó.
   *
   * Đây là chốt duy nhất giữ cho `README.md:15` còn đúng trên đường này — Bó link
   * bỏ hẳn service worker ra ngoài, nên `resolveMeta`/`planFor` không đi theo.
   * Fail-closed: thiếu dữ kiện là `UNKNOWN`, không phải `ACCEPT`.
   *
   * @returns {{verdict: string, why: string}} `why` là chuỗi chẩn đoán, không phải câu cho người đọc.
   */
  function bundleVerdict(videoId, meta) {
    if (!videoId) return { verdict: BUNDLE.UNKNOWN, why: 'thiếu videoId' };
    if (!meta) return { verdict: BUNDLE.UNKNOWN, why: 'không hỏi được player response' };
    if (meta.videoId !== videoId) {
      return { verdict: BUNDLE.UNKNOWN, why: `player response trả về video khác (${meta.videoId || 'rỗng'})` };
    }
    if (meta.privacy === PRIVACY.PRIVATE || meta.privacy === PRIVACY.UNLISTED) {
      return { verdict: BUNDLE.RESTRICTED, why: meta.privacy };
    }
    if (meta.privacy !== PRIVACY.PUBLIC) {
      return { verdict: BUNDLE.UNKNOWN, why: `privacy không đọc được (${meta.privacy || 'rỗng'})` };
    }
    if (meta.playable !== true) {
      return { verdict: BUNDLE.UNKNOWN, why: meta.reason || 'video không phát được' };
    }
    return { verdict: BUNDLE.ACCEPT, why: 'public' };
  }

  /**
   * Chạy `fn` trên từng phần tử với trần đồng thời, giữ nguyên thứ tự kết quả.
   *
   * Cần vì hai chỗ của Đường trao tay đều bắn request hàng loạt — cửa 3 hỏi
   * player response từng video, cửa đo docs fetch từng trang — trong khi toàn bộ
   * code hiện có chạy tuần tự với `sleep(1200)` giữa hai Mục. Bắn 200 request một
   * lúc vào một host là hành vi mới hoàn toàn, và rate limit của YouTube là rủi ro
   * đã ghi trong `WORKSPACE_PROTOCOL.md`.
   *
   * `fn` KHÔNG được ném: nó phải tự gói lỗi thành kết quả. Một lượt hỏng giữa
   * chừng không được giết cả lô — đó là ca thường gặp, không phải ca biên.
   */
  async function mapWithLimit(items, limit, fn) {
    const list = Array.from(items || []);
    const out = new Array(list.length);
    const width = Math.max(1, Math.min(Number(limit) || 1, list.length));
    let next = 0;

    await Promise.all(
      Array.from({ length: width }, async () => {
        for (;;) {
          const i = next++;
          if (i >= list.length) return;
          out[i] = await fn(list[i], i);
        }
      })
    );
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* url tài liệu                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Chuẩn hoá URL trang tài liệu để làm khoá chống trùng.
   *
   * Cạm bẫy: hash thường là *neo trong trang* nên phải bỏ, NHƯNG với docsify và
   * mấy SPA cùng kiểu thì hash chính là đường dẫn trang (`#/guide/intro`) — bỏ
   * đi là gom cả trăm trang thành một. Nên chỉ giữ hash khi nó có dạng route.
   */
  function docKey(input) {
    let u;
    try {
      u = new URL(String(input || '').trim());
    } catch (_) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;

    if (!isHashRoute(u.hash)) u.hash = '';
    for (const param of Array.from(u.searchParams.keys())) {
      if (/^(utm_|ref$|ref_|source$|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(param)) {
        u.searchParams.delete(param);
      }
    }
    u.hostname = u.hostname.toLowerCase();
    let path = u.pathname.replace(/\/{2,}/g, '/');
    if (path.length > 1) path = path.replace(/\/+$/, '');
    u.pathname = path;
    return u.toString();
  }

  /** `#/guide/intro`, `#!/api` — hash đóng vai đường dẫn chứ không phải neo. */
  function isHashRoute(hash) {
    return /^#[!/]/.test(String(hash || ''));
  }

  /** Tên hiển thị ngắn gọn cho một URL tài liệu (dùng khi chưa biết tiêu đề). */
  function urlLabel(url) {
    try {
      const u = new URL(url);
      const tail = (isHashRoute(u.hash) ? u.hash.slice(1) : u.pathname)
        .split('/')
        .filter(Boolean)
        .pop();
      return tail ? decodeURIComponent(tail).replace(/[-_]+/g, ' ').replace(/\.\w+$/, '') : u.hostname;
    } catch (_) {
      return String(url || '');
    }
  }

  /* ------------------------------------------------------------------ */
  /* misc                                                                */
  /* ------------------------------------------------------------------ */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  /** Bỏ dấu tiếng Việt + hạ chữ thường, để so khớp nhãn giao diện không phụ thuộc dấu. */
  function norm(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Chờ tới khi fn() trả về giá trị truthy, hoặc timeout. */
  async function waitFor(fn, { timeout = 10000, interval = 120, label = 'điều kiện' } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      let value;
      try {
        value = await fn();
      } catch (_) {
        value = null;
      }
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Hết thời gian chờ ${label}`);
      await sleep(interval);
    }
  }

  /**
   * Dựng nội dung nguồn dạng text cho NotebookLM từ metadata + transcript.
   * Header giữ lại ngữ cảnh (tiêu đề, kênh, link) để NotebookLM trích dẫn có nghĩa.
   */
  function buildSourceText(meta, segments, settings) {
    const opts = Object.assign({}, DEFAULTS, settings || {});
    const lines = [];
    lines.push(meta.title || 'Video YouTube');
    lines.push('');
    if (meta.channel) lines.push(`Kênh: ${meta.channel}`);
    lines.push(`URL: ${canonicalUrl(meta.videoId)}`);
    if (meta.durationSec) lines.push(`Thời lượng: ${fmtTime(meta.durationSec)}`);
    if (meta.publishedAt) lines.push(`Ngày đăng: ${String(meta.publishedAt).slice(0, 10)}`);
    lines.push(`Chế độ hiển thị: ${privacyLabel(meta.privacy)}`);
    lines.push(`Nguồn transcript: trích xuất cục bộ trong trình duyệt (${meta.method || 'n/a'})`);
    lines.push('');
    lines.push('--- TRANSCRIPT ---');
    lines.push('');
    lines.push(renderSegments(segments, opts));

    if (meta.description) {
      lines.push('');
      lines.push('--- MÔ TẢ VIDEO ---');
      lines.push('');
      lines.push(meta.description);
    }
    return lines.join('\n');
  }

  function renderSegments(segments, opts) {
    const list = (segments || []).filter((s) => s && s.text);
    if (!list.length) return '(không có transcript)';

    if (!opts.includeTimestamps) {
      return list.map((s) => s.text.trim()).join(' ').replace(/\s{2,}/g, ' ');
    }

    const group = Number(opts.groupSeconds) || 0;
    if (group <= 0) {
      return list.map((s) => `[${fmtTime(s.start)}] ${s.text.trim()}`).join('\n');
    }

    const out = [];
    let bucketStart = null;
    let buffer = [];
    const flush = () => {
      if (buffer.length) out.push(`[${fmtTime(bucketStart)}] ${buffer.join(' ').replace(/\s{2,}/g, ' ')}`);
      buffer = [];
    };
    for (const seg of list) {
      if (bucketStart === null) bucketStart = seg.start;
      if (seg.start - bucketStart >= group) {
        flush();
        bucketStart = seg.start;
      }
      buffer.push(seg.text.trim());
    }
    flush();
    return out.join('\n');
  }

  function privacyLabel(privacy) {
    switch (privacy) {
      case PRIVACY.PRIVATE: return 'Riêng tư (private)';
      case PRIVACY.UNLISTED: return 'Không công khai (unlisted)';
      case PRIVACY.PUBLIC: return 'Công khai (public)';
      default: return 'Không xác định';
    }
  }

  /**
   * Đóng gói text thành data URL để `chrome.downloads` tải về.
   *
   * Service worker MV3 không có `URL.createObjectURL`, nên data URL là đường duy
   * nhất tải file từ nền. Hai cái bẫy đều đã cắn thật ở nơi khác:
   *   - `btoa` ném lỗi với ký tự ngoài Latin-1 → phải mã hoá UTF-8 trước.
   *     Transcript tiếng Việt và tiếng Hàn dính ngay.
   *   - `String.fromCharCode(...mảng)` tràn ngăn xếp khi mảng lớn → phải chia khúc.
   */
  function toDataUrl(text, mime = 'text/plain') {
    const bytes = new TextEncoder().encode(String(text));
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return `data:${mime};charset=utf-8;base64,${btoa(binary)}`;
  }

  /** Tên file an toàn trên mọi hệ điều hành, có tiền tố số thứ tự cho dễ sắp. */
  function downloadName(meta, ext, index) {
    const base =
      String(meta.title || meta.videoId || 'transcript')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'transcript';
    const prefix = Number.isFinite(index) ? `${String(index).padStart(3, '0')} - ` : '';
    return `${prefix}${base}.${ext}`;
  }

  /** Tiêu đề nguồn hiển thị trong NotebookLM. */
  function sourceTitle(meta) {
    const base = (meta.title || `YouTube ${meta.videoId}`).slice(0, 110);
    return `${base} — YouTube transcript`;
  }

  /* ------------------------------------------------------------------ */
  /* nguồn từ trang tài liệu                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Dựng nội dung nguồn cho một trang tài liệu.
   * Header giữ URL gốc để câu trả lời của NotebookLM còn truy ngược được về
   * đúng trang — thứ sẽ mất sạch nếu chỉ dán mỗi phần thân.
   */
  function buildDocsSourceText(meta, markdown, settings) {
    const opts = Object.assign({}, DEFAULTS, settings || {});
    const lines = [];
    lines.push(meta.title || urlLabel(meta.url));
    lines.push('');
    if (meta.site) lines.push(`Tài liệu: ${meta.site}`);
    if (meta.section) lines.push(`Mục: ${meta.section}`);
    lines.push(`URL: ${meta.url}`);
    lines.push(`Trích xuất: cục bộ trong trình duyệt (${meta.method || 'n/a'})`);
    lines.push('');
    lines.push('--- NỘI DUNG ---');
    lines.push('');

    let body = String(markdown || '').trim() || '(trang không có nội dung đọc được)';
    const cap = Number(opts.docsMaxChars) || 0;
    if (cap > 0 && body.length > cap) {
      body = `${body.slice(0, cap)}\n\n[… đã cắt bớt ${body.length - cap} ký tự để vừa giới hạn một nguồn]`;
    }
    lines.push(body);
    return lines.join('\n');
  }

  /** Tiêu đề nguồn tài liệu trong NotebookLM. */
  function docsSourceTitle(meta) {
    const base = (meta.title || urlLabel(meta.url)).slice(0, 100);
    const site = meta.site ? ` — ${String(meta.site).slice(0, 40)}` : '';
    return `${base}${site}`;
  }

  root.NBLM = {
    MSG, STATUS, PRIVACY, KIND, KEYS, DEFAULTS,
    getSettings, setSettings, getQueue, setQueue,
    getDomReports, saveDomReport, clearDomReports,
    getCopiedLog,
    videoIdFrom, canonicalUrl, parseUrlList,
    docKey, isHashRoute, urlLabel,
    BUNDLE, badgeRejects, bundleVerdict, mapWithLimit,
    uid, sleep, fmtTime, norm, waitFor,
    buildSourceText, renderSegments, privacyLabel, sourceTitle,
    toDataUrl, downloadName,
    buildDocsSourceText, docsSourceTitle,
  };
})(typeof self !== 'undefined' ? self : globalThis);
