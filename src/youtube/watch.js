// Trang watch: nút cạnh Like/Share, meta của video, và đường trích chạy ngay trong tab.
//
// Đây là đầu bên tab YouTube của đường đi ticket 005. Service worker không tự trích được: nó
// không có DOM, không có phiên đăng nhập của trang, và đường DOM là đường **duy nhất** chạy
// được với video private (ADR 0003). Nên nó gửi một tin vào đây và chờ.
//
// Không có selector nào trong file này: mọi thứ dễ vỡ nằm ở `src/youtube/selectors.js` và ghi
// đè được từ trang Cài đặt (`WORKSPACE_PROTOCOL.md`). Mọi hàm nhận cây node hoặc adapter được
// tiêm, nên toàn bộ file test được bằng cây giả — `test/watch.test.js`. Phần chạm `chrome.*`
// chỉ tự chạy khi thật sự đang ở trong một trang.
(function (root) {
  'use strict';

  if (root.NBLM_WATCH) return;

  const S = root.NBLM_SHARED;
  const M = root.NBLM_MESSAGES;
  const Y = root.NBLM_YT_SELECTORS;
  const T = root.NBLM_TRANSCRIPT;
  if (!S) throw new Error('youtube/watch: cần src/common/shared.js nạp trước');
  if (!M) throw new Error('youtube/watch: cần src/common/messages.js nạp trước');
  if (!Y) throw new Error('youtube/watch: cần src/youtube/selectors.js nạp trước');
  if (!T) throw new Error('youtube/watch: cần src/youtube/transcript.js nạp trước');

  const BUTTON_ID = `${S.EXT_PREFIX}import-button`;
  const BUTTON_LABEL = 'NotebookLM';
  const BUTTON_TITLE = 'Trích transcript và đẩy vào Notebook đích (Alt+Shift+Y)';

  /** Số lượt quét lại khi panel đã mở mà chưa dựng xong danh sách segment. */
  const PANEL_TRIES = 20;
  const PANEL_STEP_MS = 150;

  const selectorsOf = (options) => {
    const given = options && options.selectors;
    if (!given) return Y.DEFAULT;
    return typeof given.css === 'function' ? given : Y.resolve(given);
  };

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  const ownedNodes = (node, sel, key) => (node
    ? Array.from(node.querySelectorAll(sel.css(key))).filter((n) => !n.closest(sel.OWN_UI))
    : []);

  const textOf = (node) => (node ? S.collapse(node.textContent) : '');

  // ------------------------------------------------------------------ nút trên trang

  /** Hàng nút Like/Share. Loại giao diện của chính extension trước — nút của ta nằm trong đó. */
  function findActionBar(root_, options) {
    return ownedNodes(root_, selectorsOf(options), 'actionBar')[0] || null;
  }

  /**
   * Gắn nút import vào hàng nút, **một lần**.
   *
   * YouTube là SPA: đổi video là dựng lại cả hàng nút, nên hàm này được gọi lại nhiều lần trên
   * cùng một trang. Không kiểm nút đã có thì mỗi lần điều hướng lại thêm một nút nữa, và tới
   * video thứ năm thì hàng nút có năm nút giống hệt nhau.
   *
   * Id mang `EXT_PREFIX` không phải để cho đẹp: đó là thứ mọi hàm dò phần tử của trang dùng để
   * loại giao diện của chính mình ra (ticket 002).
   */
  function mountButton(root_, doc, onActivate, options) {
    if (!root_ || !doc) return null;
    const existing = root_.querySelector(`#${BUTTON_ID}`);
    if (existing) return existing;

    const bar = findActionBar(root_, options);
    if (!bar) return null;

    const button = doc.createElement('button');
    button.setAttribute('id', BUTTON_ID);
    button.setAttribute('type', 'button');
    button.setAttribute('title', BUTTON_TITLE);
    button.setAttribute(
      'style',
      'margin-left:8px;padding:0 12px;height:36px;border:0;border-radius:18px;cursor:pointer;'
      + 'font:500 14px/36px Roboto,system-ui,sans-serif;background:rgba(255,255,255,.1);color:inherit;',
    );
    button.append(BUTTON_LABEL);
    if (typeof onActivate === 'function') button.addEventListener('click', onActivate);
    bar.append(button);
    return button;
  }

  // ------------------------------------------------------------------ meta của video

  /**
   * Mức riêng tư đọc từ huy hiệu trên trang.
   *
   * Đây là thứ quyết định đường trích (ADR 0003), nên đọc sai không ra một lỗi: nó ra hai lần
   * gọi mạng chắc chắn hỏng trước khi rơi về đường DOM. Mặc định là `public` vì đó là trạng
   * thái không có huy hiệu nào.
   */
  function readPrivacy(root_, options) {
    const sel = selectorsOf(options);
    const badges = ownedNodes(root_, sel, 'privacyBadge').map((node) => S.foldLabel(node.textContent));
    const has = (key) => sel.label(key).some((label) => badges.some((text) => text.includes(label)));
    if (has('privacyPrivate')) return 'private';
    if (has('privacyUnlisted')) return 'unlisted';
    return 'public';
  }

  /**
   * Meta của video đang mở. `title` và `channel` là cặp cùng kiểu: hoán vị vẫn ra một Nguồn
   * dựng được, chỉ là NotebookLM trích dẫn sai tên kênh — và Nguồn đã đẩy thì không sửa được
   * (`WORKSPACE_PROTOCOL.md`). Hai giá trị đọc từ hai nhóm selector khác hẳn nhau, và
   * `test/watch.test.js` chốt từng ô.
   */
  function readVideoMeta(root_, options) {
    const sel = selectorsOf(options);
    const url = (options && options.url) || '';
    return {
      videoId: S.parseVideoId(url) || '',
      title: textOf(ownedNodes(root_, sel, 'videoTitle')[0]),
      channel: textOf(ownedNodes(root_, sel, 'channelName')[0]),
      url: S.collapse(url),
      privacy: readPrivacy(root_, options),
      durationSeconds: T.parseClock(textOf(ownedNodes(root_, sel, 'playerDuration')[0])),
    };
  }

  // ------------------------------------------------------------------ quét panel

  /**
   * Quét lại cho tới khi panel dựng xong — trừ khi lý do là **cửa sổ quá hẹp**.
   *
   * Phân biệt hai lý do là cả điểm của hàm này: "chưa dựng xong" chờ thêm là hết, còn chiều
   * rộng cửa sổ thì không tự đổi vì mình chờ. Đốt 20 lượt chờ cho một cửa sổ hẹp là hai chục
   * nhịp im lặng rồi mới báo đúng cái lỗi đã biết từ lượt đầu.
   */
  async function scanPanel(config) {
    const cfg = config || {};
    const tries = Number(cfg.tries) > 0 ? Number(cfg.tries) : PANEL_TRIES;
    let last = null;
    for (let i = 0; i < tries; i += 1) {
      last = await cfg.scanOnce();
      if (last && last.ok) return last;
      if (last && last.reason === T.REASON.NARROW) return last;
      if (i < tries - 1) await cfg.wait(PANEL_STEP_MS);
    }
    return last;
  }

  /**
   * Adapter trang cho `viaDom`: bấm nút Transcript rồi quét, có thử lại.
   *
   * Nút Transcript là nút **bật/tắt**. `viaDom` gọi `scan` hai lần (lần hai sau khi kích hoạt
   * tab), nên bấm ở cả hai lần là lần hai đóng lại đúng cái panel vừa mở — triệu chứng y hệt
   * "video này không có transcript". Vì vậy cả lượt trích chỉ bấm một lần.
   */
  function createPage(getRoot, deps, options) {
    let pressed = false;
    return {
      async scan() {
        const button = pressed ? null : T.findTranscriptButton(getRoot(), options);
        if (button) {
          T.pressElement(button, options);
          pressed = true;
          await deps.wait(PANEL_STEP_MS);
        }
        return scanPanel({
          scanOnce: () => T.scanTranscriptPanel(getRoot(), { ...(options || {}), opened: pressed }),
          wait: deps.wait,
          tries: PANEL_TRIES,
        });
      },
      activate: deps.activate,
    };
  }

  // ------------------------------------------------------------------ trích tại chỗ

  /**
   * Trích transcript của video đang mở, định tuyến theo Mức riêng tư đọc từ trang.
   *
   * Không có adapter `timedtext`: `captionBaseUrl` nằm trong `ytInitialPlayerResponse` của
   * MAIN world, mà mở rộng phạm vi cầu MAIN world là quyết định của owner
   * (`WORKSPACE_PROTOCOL.md`, ADR 0003). Thiếu adapter **không** bị giấu đi: `fetchTranscript`
   * ghi nó thành một dòng trong `attempts`, nên bảng tổng kết vẫn nói ra được vì sao.
   */
  async function extractHere(root_, deps) {
    const options = deps && deps.options ? deps.options : {};
    const meta = readVideoMeta(root_, { ...options, url: deps && deps.url });

    const paths = {
      innertube: async (request, opts) => {
        const ytcfg = await deps.bridge.request('ytcfg');
        return T.viaInnertube({ ...request, ytcfg }, deps.net, opts);
      },
      dom: (request) => T.viaDom(request, deps.page),
    };

    const result = await T.fetchTranscript(
      { videoId: meta.videoId, privacy: meta.privacy },
      paths,
      options,
    );
    return { meta, segments: result.segments, via: result.via, attempts: result.attempts };
  }

  // ------------------------------------------------------------------ tin nhắn

  /**
   * `undefined` nghĩa là **im lặng**: tin không phải của listener này. Trả `{ok:false}` cho
   * tin của script khác còn tệ hơn không trả lời — Chrome lấy phản hồi đến trước, nên một câu
   * "lệnh lạ" đủ giết mọi thứ sau đó cho tới khi tab được tải lại (spec 0001).
   *
   * Tin trích mang theo `videoId` mà service worker đang nhắm. YouTube là SPA: giữa lúc nó tìm
   * ra tab này và lúc tin tới nơi, trang có thể đã nhảy sang video khác (autoplay, người dùng
   * bấm link). Trích tiếp là ghi transcript của video B vào file mang tên video A — mà `mergeMeta`
   * ép `videoId` theo mục đang chạy nên không chỗ nào lộ ra. Lệch id là từ chối, y như bên
   * NotebookLM từ chối đẩy nhầm notebook.
   */
  function handleMessage(message, deps) {
    if (!M.isFor('youtube', message)) return undefined;
    if (M.typeOf(message) === M.TYPES.PING_YOUTUBE) return Promise.resolve({ ok: true, result: { ready: true } });

    return (async () => {
      try {
        // Chọn nhánh **trước** khi soi tải trọng. Ngược lại thì một loại tin khai mà quên nhánh,
        // nếu mang theo `videoId`, sẽ chết bằng câu "tab này đang mở video khác" — một lỗi trỏ
        // sai hẳn chỗ, đúng thứ kỷ luật định tuyến sinh ra để không có.
        if (M.typeOf(message) !== M.TYPES.EXTRACT_TRANSCRIPT) throw M.unrouted('youtube', message);

        const wanted = message.videoId || '';
        const here = typeof deps.currentVideoId === 'function' ? deps.currentVideoId() : '';
        if (wanted && wanted !== here) {
          throw new Error(`tab này đang mở "${here || 'không phải trang watch'}", không phải video "${wanted}"`);
        }
        return { ok: true, result: await deps.extract(message) };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    })();
  }

  // ------------------------------------------------------------------ cài vào trang

  /**
   * Mọi thứ một tab YouTube cần để tự trích transcript: ghi đè của người dùng, adapter mạng,
   * cầu MAIN world, và adapter trang có thử lại.
   *
   * Tách khỏi `install` để panel transcript (ticket 006) **dùng lại đúng đường trích này** chứ
   * không dựng đường thứ hai — hai đường trích là hai chỗ để ADR 0003 lệch nhau, và cái lệch
   * ấy chỉ lộ ra ở video private.
   */
  /**
   * Một `createTab` cho mỗi cửa sổ, không phải một cho mỗi chỗ gọi.
   *
   * Ba content script cùng ngồi trên một tab YouTube (watch, panel, thanh nổi playlist) và cả
   * ba đều cần `bridge`. Mỗi lượt `createTab` dựng một `createBridgeClient` riêng, tức một
   * listener `message` riêng — mà `newId` của client là `nblm-<ms>-<đếm>` với bộ đếm **của
   * riêng client ấy**, khởi từ 0. Hai client hỏi trong cùng một mili-giây nhận cùng id, và
   * mỗi client settle lượt hỏi của mình bằng phản hồi tới trước: cả hai vẫn nhận một kết quả
   * hợp lệ, chỉ là của nhau (`bridge-client.js` mở đầu bằng đúng cảnh báo này).
   *
   * `WeakMap` chứ không phải `Map`: khoá là chính đối tượng cửa sổ, và không giữ nó sống thêm.
   */
  const tabs = new WeakMap();

  function createTab(target) {
    const cached = tabs.get(target);
    if (cached) return cached;
    const tab = buildTab(target);
    tabs.set(target, tab);
    return tab;
  }

  function buildTab(target) {
    const doc = target.document;
    const chrome_ = target.chrome;

    const wait = (ms) => new Promise((resolve) => target.setTimeout(resolve, ms));
    const send = (message) => chrome_.runtime.sendMessage(message).catch(() => null);

    const bridge = root.NBLM_BRIDGE_CLIENT
      ? root.NBLM_BRIDGE_CLIENT.createBridgeClient({ window: target })
      : { request: async (op) => { throw new Error(`cầu MAIN world chưa nạp, không hỏi được "${op}"`); } };

    let overrides = null;
    async function options() {
      if (overrides) return overrides;
      const area = chrome_.storage && chrome_.storage.sync;
      const bag = area ? await area.get('settings') : null;
      const settings = (bag && bag.settings) || {};
      const css = settings.selectorOverrides || {};
      const window_ = Number(settings.mergeWindowSeconds);
      const perMinute = Number(settings.wordsPerMinute);
      const maxWords = Number(settings.maxWordsPerSource);
      overrides = {
        selectors: Y.resolve({ ...css, labels: settings.labelOverrides || {} }),
        // Panel transcript dựng `.md` từ chính bag này. Thiếu `mergeWindowSeconds` thì file
        // tải từ panel gộp theo mặc định trong khi Bản lưu ghi ra đĩa gộp theo Cài đặt — hai
        // file cùng tên, khác nội dung, mà không chỗ nào nói ra.
        mergeWindowSeconds: window_ > 0 ? window_ : S.DEFAULTS.mergeWindowSeconds,
        // Bảng xác nhận của thanh nổi playlist ước lượng số Nguồn từ chính hai con số này
        // (ticket 007). Ước lượng theo mặc định trong khi engine cắt theo Cài đặt là một bảng
        // xác nhận nói dối — và người dùng chỉ biết lúc chạm trần 50 nguồn giữa chừng.
        wordsPerMinute: perMinute > 0 ? perMinute : S.DEFAULTS.wordsPerMinute,
        maxWords: maxWords > 0 ? maxWords : S.DEFAULTS.maxWordsPerSource,
      };
      return overrides;
    }

    async function extract() {
      const opts = await options();
      return extractHere(doc, {
        url: target.location.href,
        options: opts,
        net: {
          post: async ({ url, headers, body }) => {
            const response = await target.fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers,
              body: JSON.stringify(body),
            });
            if (!response.ok) throw new Error(`InnerTube trả HTTP ${response.status}`);
            return response.json();
          },
        },
        bridge,
        page: createPage(() => doc, {
          wait,
          activate: () => send({ type: M.TYPES.ACTIVATE_TAB }),
        }, opts),
      });
    }

    // `bridge` đi ra ngoài để thanh nổi playlist (ticket 007) dùng **chung một** lớp bọc
    // postMessage với đường trích: hai lớp bọc trên cùng một cửa sổ là hai listener cùng nghe
    // một kênh, và mỗi lượt trả lời tới cả hai.
    return { doc, wait, send, options, extract, bridge };
  }

  function install(target) {
    const chrome_ = target.chrome;
    if (!chrome_ || !chrome_.runtime) return;

    const tab = createTab(target);
    const doc = tab.doc;

    chrome_.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const answer = handleMessage(message, {
        extract: tab.extract,
        currentVideoId: () => S.parseVideoId(target.location.href) || '',
      });
      if (!answer) return false; // im lặng với tin không phải của mình
      answer.then(sendResponse);
      return true; // giữ kênh mở cho câu trả lời async
    });

    // Gắn nút bằng chính selector người dùng đang dùng: ghi đè `actionBar` ở trang Cài đặt tồn
    // tại đúng cho lúc YouTube đổi hàng nút, mà lúc đó nút chưa hiện thì không có gì để bấm —
    // đọc ghi đè muộn (chỉ trong `extract`) là để tính năng cứu hộ tự khoá mình lại.
    const mount = async () => mountButton(doc, doc, () => tab.send({ type: M.TYPES.IMPORT_VIDEO }), await tab.options());
    mount();
    // YouTube là SPA: đổi video không tải lại trang, nó chỉ dựng lại hàng nút.
    for (const event of ['yt-navigate-finish', 'yt-page-data-updated']) doc.addEventListener(event, mount);
  }

  root.NBLM_WATCH = Object.freeze({
    BUTTON_ID,
    BUTTON_LABEL,
    PANEL_TRIES,
    findActionBar,
    mountButton,
    readPrivacy,
    readVideoMeta,
    scanPanel,
    createPage,
    extractHere,
    handleMessage,
    createTab,
    install,
  });

  if (root.document && root.chrome && root.chrome.runtime) install(root);
})(typeof globalThis !== 'undefined' ? globalThis : self);
