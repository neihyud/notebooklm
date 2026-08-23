// Service worker: chỗ duy nhất trong repo được phép gọi `chrome.*` để chạy một lần import.
//
// Cố ý mỏng. Mọi quyết định nằm ở tầng dưới và đã có test bằng adapter giả:
//   - `src/background/importer.js` — thứ tự trích → ghi Bản lưu → đẩy (ADR 0011);
//   - `src/background/queue-engine.js` — hai hàng đợi, Sổ đã import, bảng tổng kết;
//   - `src/common/shared.js` — bóc videoId, bóc notebookId, đặt tên, khoá Sổ.
//   - `src/background/docs-queue.js` — Bảng chọn → Mục hàng đợi, ranh giới Nhánh (ADR 0005).
//   - `src/notebooklm/rpc.js` — dựng và đọc một lượt `batchexecute` (ADR 0012).
// Còn lại ở đây là ba việc không test tự động được: tìm/đợi/tiêm tab, gọi `chrome.downloads`, và
// nối các lối vào (nút trên trang, phím tắt, menu chuột phải, popup) vào cùng một đường.
//
// `importScripts` chứ không `import`: service worker của MV3 chạy được ES module, nhưng cả
// repo là classic script để content script dùng chung được đúng những file này.
importScripts(
  '/src/common/shared.js',
  '/src/common/messages.js',
  '/src/youtube/srt.js',
  '/src/notebooklm/rpc.js',
  '/src/background/queue-engine.js',
  '/src/background/docs-queue.js',
  '/src/background/importer.js',
);

/**
 * Lớp tài liệu — **tiêm** vào tab tài liệu, không khai trong `content_scripts`.
 *
 * Khác YouTube và NotebookLM ở một điểm quyết định: ở đó có một danh sách host để khai, còn
 * trang tài liệu là *bất cứ* site nào. Khai `matches: <mọi trang>` nghĩa là chạy code trên mọi
 * trang người dùng mở, suốt ngày, chỉ để chờ một phím tắt. Vì vậy nó vào tab đúng lúc người
 * dùng gọi Bảng chọn, và đây là **chuỗi nạp** của lớp ấy: thứ tự trong mảng là thứ tự Chrome
 * chạy, đúng như một mảng `js` của `content_scripts` (`test/manifest.test.js` kiểm cả hai
 * bằng cùng một phép).
 *
 * `queue-engine.js` và `docs-queue.js` **không** nằm ở đây: hàng đợi sống ở service worker.
 * Còn khâu trích thì ngược lại — nó so cây node, mà service worker không có `DOMParser`.
 */
const DOCS_SCRIPTS = [
  '/src/common/shared.js',
  '/src/common/messages.js',
  '/src/docs/selectors.js',
  '/src/docs/markdown.js',
  '/src/docs/extract.js',
  '/src/docs/sidebar.js',
  '/src/docs/picker.js',
  '/src/docs/content.js',
];


(function (root) {
  'use strict';

  const S = root.NBLM_SHARED;
  const M = root.NBLM_MESSAGES;
  const E = root.NBLM_ENGINE;
  const I = root.NBLM_IMPORTER;
  const D = root.NBLM_DOCS_QUEUE;
  const R = root.NBLM_RPC;

  const STATE_KEY = 'run-state';
  const NOTEBOOK_KEY = 'notebook-id';
  const SETTINGS_KEY = 'settings';

  const CONTEXT_MENU_ID = `${S.EXT_PREFIX}import-link`;
  const DOCS_MENU_ID = `${S.EXT_PREFIX}pick-docs`;

  /** Số lần hỏi "content script nạp xong chưa" trước khi bỏ cuộc, và nhịp giữa hai lần hỏi. */
  const READY_TRIES = 40;
  const READY_STEP_MS = 250;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  // ------------------------------------------------------------------ trạng thái

  async function readLocal(key, fallback) {
    const bag = await chrome.storage.local.get(key);
    return bag && bag[key] != null ? bag[key] : fallback;
  }

  const writeLocal = (key, value) => chrome.storage.local.set({ [key]: value });

  async function readSettings() {
    const bag = await chrome.storage.sync.get(SETTINGS_KEY);
    return { ...S.DEFAULTS, ...((bag && bag[SETTINGS_KEY]) || {}) };
  }

  // ------------------------------------------------------------------ nói với tab

  /**
   * Gửi một tin vào tab và **phân biệt "không ai nghe" với "nghe rồi mà hỏng"**.
   *
   * `sendMessage` vào một tab chưa nạp content script ném `Could not establish connection`.
   * Coi nó là lỗi đẩy thì mục rớt với một lý do vô nghĩa; ở đây nó là tín hiệu "chưa sẵn
   * sàng", và người gọi chờ tiếp.
   */
  async function ask(tabId, message) {
    try {
      const answer = await chrome.tabs.sendMessage(tabId, message);
      return answer || { ok: false, error: 'tab không trả lời gì' };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** Chờ content script của tab nạp xong. Chỉ tin `ok: true` — có phản hồi là chưa đủ. */
  async function waitForTab(tabId, pingType) {
    for (let i = 0; i < READY_TRIES; i += 1) {
      const answer = await ask(tabId, { type: pingType });
      if (answer.ok) return answer;
      await wait(READY_STEP_MS);
    }
    throw new Error(`tab ${tabId} không phản hồi ${pingType} sau ${(READY_TRIES * READY_STEP_MS) / 1000}s`);
  }

  const tabsMatching = (patterns) => chrome.tabs.query({ url: patterns });

  /** Tab YouTube đang mở đúng video này, nếu có — trích ngay ở đó thì không phải mở thêm tab. */
  async function findVideoTab(videoId) {
    const tabs = await tabsMatching(S.YOUTUBE_MATCH_PATTERNS);
    return tabs.find((tab) => S.parseVideoId(tab.url || '') === videoId) || null;
  }

  /**
   * Tab NotebookLM đang mở đúng notebook này. Hỏi trên **mọi** host của `NOTEBOOK_HOSTS`, không
   * chỉ host ta tự mở: tài khoản đã chuyển sang "Gemini Notebook" ngồi ở host kia, và bỏ sót
   * host ấy nghĩa là mỗi lần đẩy lại mở thêm một tab bên cạnh tab đã có.
   */
  async function findNotebookTab(notebookId) {
    const tabs = await tabsMatching(S.NOTEBOOK_MATCH_PATTERNS);
    return tabs.find((tab) => S.parseNotebookId(tab.url || '') === notebookId) || null;
  }

  // ------------------------------------------------------------------ ba adapter

  /**
   * Trích transcript của một video ở tab YouTube.
   *
   * Không có tab nào đang mở video ấy thì mở một tab **nền**: đường DOM chạy được ở tab nền,
   * và `viaDom` đã có sẵn một lượt thử lại với tab được kích hoạt cho trường hợp Chrome bóp
   * hiệu năng tab nền (ticket 002). Tab do ta mở thì ta đóng — tab của người dùng thì không.
   */
  async function extractVideo(item) {
    const existing = await findVideoTab(item.id);
    const tab = existing || await chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${item.id}`, active: false });
    try {
      await waitForTab(tab.id, M.TYPES.PING_YOUTUBE);
      const answer = await ask(tab.id, { type: M.TYPES.EXTRACT_TRANSCRIPT, videoId: item.id });
      if (!answer.ok) throw new Error(answer.error || 'tab YouTube không trích được');
      return answer.result;
    } finally {
      if (!existing) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  /**
   * Ghi Bản lưu ra đĩa. `url` là một data URL do `srt.js` dựng: service worker của MV3 không
   * có `URL.createObjectURL`, nên đây là đường duy nhất còn lại để đưa chữ vào `downloads`.
   *
   * `uniquify` chứ không `overwrite`: trích lại một video đã có file là chuyện thường, mà ghi
   * đè thì bản cũ mất không hỏi ai.
   */
  async function saveFile(file) {
    return chrome.downloads.download({
      url: file.url,
      filename: file.filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  }

  /**
   * Đẩy một Nguồn qua **tab** NotebookLM đang mở đúng Notebook đích — đường lui của ADR 0012.
   *
   * Mở tab mới nếu chưa có — nhưng **không** đoán notebook nào: `source.notebookId` là thứ
   * người dùng đã chọn, và tab bên kia còn kiểm lại lần nữa trước khi đẩy (ADR 0010: Nguồn
   * vào nhầm notebook là vĩnh viễn).
   */
  async function pushViaDom(source) {
    const existing = await findNotebookTab(source.notebookId);
    const tab = existing || await chrome.tabs.create({ url: S.notebookUrl(source.notebookId), active: false });
    await waitForTab(tab.id, M.TYPES.PING_NOTEBOOKLM);
    const answer = await ask(tab.id, { type: M.TYPES.PUSH_SOURCE, source });
    if (!answer.ok) throw new Error(answer.error || 'tab NotebookLM không đẩy được');
    // Nhãn đường đặt ở **đây**, không ở chỗ gọi và không ở lớp NotebookLM: hàm này *là* đường
    // lui, nên nhãn không lệch được khỏi đường đã chạy thật. Lớp bên kia không biết mình là
    // đường thứ mấy — thứ tự ưu tiên là quyết định của ADR 0012 và nó sống ở đây.
    //
    // Cùng khoá `via` với `pushTextSource` (hợp đồng ticket 015 đã khoá), vì engine hàng đợi
    // đọc **một** khoá cho cả hai đường: hai tên khoá là hai chỗ để một đường im lặng trôi vào
    // hạng "không rõ" mà bảng tổng kết vẫn đọc trôi chảy.
    return { ...(answer.result || {}), via: 'dom' };
  }

  /**
   * Token CSRF + session id của đường RPC, đọc từ HTML trang chủ NotebookLM.
   *
   * Giữ lại giữa các lượt đẩy: một lượt chạy 55 nguồn mà mỗi nguồn tải lại cả trang chủ là 55
   * request thừa. `fresh` là đường duy nhất bỏ bản đã giữ — người gọi đưa `true` đúng khi
   * `batchexecute` trả HTTP 400, tức bản đang giữ vừa hết hạn.
   *
   * `credentials: 'include'`: cookie phiên đăng nhập của owner là **cả** phần auth của đường
   * này. Không mượn `Authorization: SAPISIDHASH`, không đụng `AUTH_OPS` (ràng buộc 5, ADR 0012).
   */
  let wizTokens = null;
  async function readWizTokens(fresh) {
    if (wizTokens && !fresh) return wizTokens;
    const res = await fetch(S.notebookHome(), { credentials: 'include' });
    if (!res.ok) throw new Error(`không đọc được trang chủ NotebookLM (HTTP ${res.status})`);
    wizTokens = R.parseWizGlobalData(await res.text());
    return wizTokens;
  }

  /**
   * Đẩy một Nguồn: **đường RPC trước, đường DOM làm đường lui** (ADR 0012).
   *
   * Đường lui chạy đúng khi lượt RPC **chắc chắn chưa ghi gì** — cờ `fallback` do
   * `NBLM_RPC.canFallBackToDom` đặt, và ranh giới của nó không phải "hỏng nặng hay nhẹ". Một
   * lượt *có thể* đã ghi mà rơi về đường lui là dựng hai Nguồn cho một mục, và Nguồn đã đẩy thì
   * extension không sửa và không xoá được (ADR 0010).
   */
  async function pushSource(source) {
    try {
      return await R.pushTextSource({
        source,
        notebookId: source.notebookId,
        // `hl` chỉ đổi ngôn ngữ câu lỗi trả về — không đổi hành vi, nhưng đọc được thì đỡ hơn.
        lang: (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || 'en',
        fetchImpl: (href, init) => fetch(href, init),
        readTokens: readWizTokens,
      });
    } catch (error) {
      if (!error.fallback) throw error;
      // Lượt chạy vẫn xong, nên bảng tổng kết không có dòng nào cho chuyện này — và đó chính là
      // vấn đề: khi shape trôi theo cohort, *mọi* lượt đẩy lặng lẽ rơi về đường lui và bảng tổng
      // kết trông y hệt một lượt RPC sạch. Từ lúc đó cả extension chạy trên đúng đường mà ADR
      // 0012 hạ xuống hàng hai vì nó **không có tín hiệu xong việc**, và không ai biết. Console
      // của service worker là kênh duy nhất còn lại ở tầng này.
      console.warn(`[nblm] đường RPC không dùng được, rơi về đường lui — ${messageOf(error)}`);
      return pushViaDom(source);
    }
  }

  // ------------------------------------------------ tab tài liệu và tab ẩn của nấc 2

  /**
   * Tab tài liệu đang phục vụ lượt chạy này, và tab ẩn của nấc 2.
   *
   * Cả khâu trích tài liệu chạy **trong tab tài liệu**, không ở đây: hai nấc của
   * `src/docs/extract.js` so cây node, mà service worker của MV3 không có `DOMParser`. Việc còn
   * lại của service worker là lái tab ẩn — thứ duy nhất chỉ `chrome.tabs` làm được.
   */
  let docsTabId = null;
  let docsHome = '';
  let hiddenTabId = null;

  /** Tiêm lớp tài liệu vào một tab rồi chờ nó nạp xong. Tiêm lại một tab đã có là vô hại. */
  async function ensureDocsTab(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: DOCS_SCRIPTS });
    await waitForTab(tabId, M.TYPES.PING_DOCS);
    return tabId;
  }

  /**
   * Tab ẩn của nấc 2, mở sẵn ở **trang tài liệu người dùng đang đọc**.
   *
   * Không mở ở `about:blank`, và đó không phải chuyện thẩm mỹ: `executeScript` chỉ vào được
   * những trang mà `host_permissions` phủ, còn `about:blank` thì không — nên lượt `read()` đầu
   * tiên sẽ hỏng, mốc "trang cũ" của nấc 2 thành rỗng, và cổng chờ mở sớm ở đúng những trang
   * docsify mà nấc 2 sinh ra để cứu. Mở sẵn ở trang cùng site vừa hợp lệ vừa cho một mốc thật.
   */
  async function ensureHiddenTab() {
    if (hiddenTabId != null) {
      try {
        await chrome.tabs.get(hiddenTabId);
        return hiddenTabId;
      } catch {
        hiddenTabId = null; // người dùng đóng mất rồi
      }
    }
    const tab = await chrome.tabs.create({ url: docsHome, active: false });
    hiddenTabId = tab.id;
    return hiddenTabId;
  }

  async function closeHiddenTab() {
    if (hiddenTabId == null) return;
    const id = hiddenTabId;
    hiddenTabId = null;
    await chrome.tabs.remove(id).catch(() => {});
  }

  /** Chạy **trong** tab ẩn: ảnh chụp thô, để bên kia dựng lại cây bằng `DOMParser`. */
  function snapshotOfPage() {
    return {
      url: location.href,
      html: document.documentElement ? document.documentElement.outerHTML : '',
    };
  }

  /**
   * Ảnh chụp hiện tại của tab ẩn — **không** đợi nó tải xong trang nào cả.
   *
   * Đó là cả hợp đồng của nấc 2: `read()` phải trả lời được ngay, kể cả trước `go()` đầu tiên và
   * kể cả khi tab đang đứng ở trang trước, vì chính ảnh chụp ấy là mốc để biết DOM đã đổi chưa.
   * Vòng lặp ở đây chỉ để chờ tab **mới mở** có một document để đọc; nó không chờ nội dung.
   */
  async function readHiddenTab() {
    const tabId = await ensureHiddenTab();
    let last = 'không rõ lý do';
    for (let i = 0; i < READY_TRIES; i += 1) {
      try {
        const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: snapshotOfPage });
        if (frame && frame.result) return frame.result;
        last = 'tab ẩn không trả về ảnh chụp nào';
      } catch (error) {
        last = messageOf(error);
      }
      await wait(READY_STEP_MS);
    }
    throw new Error(`tab ẩn không đọc được: ${last}`);
  }

  /**
   * Trích một trang tài liệu **ở tab tài liệu** — nơi `fetch` mang cookie phiên và nơi có
   * `DOMParser`. Không còn tab ấy thì mục rớt với đúng lý do đó, chứ không rớt vô cớ.
   */
  async function extractDoc(item) {
    if (docsTabId == null) throw new Error('không còn tab tài liệu nào để trích — mở lại Bảng chọn');
    const answer = await ask(docsTabId, { type: M.TYPES.EXTRACT_DOC, url: item.url });
    if (!answer.ok) throw new Error(answer.error || 'tab tài liệu không trích được');
    return answer.result;
  }

  const deps = { extractVideo, saveFile, pushSource, extractDoc };

  // ------------------------------------------------------------------ một lượt chạy

  /** Huy hiệu trên nút extension — dấu hiệu duy nhất nhìn thấy được khi popup đang đóng. */
  function badge(text, title) {
    chrome.action.setBadgeText({ text });
    if (title) chrome.action.setTitle({ title });
  }

  /**
   * Huy hiệu của một lượt chạy **đã trả về nhật ký** — tức nhánh *thành công* của `importItems`.
   *
   * Nhánh ấy là chỗ phải đọc kỹ, và lý do có ngày tháng: tới ticket 022 `runQueue` còn **ném**
   * khi một hàng đợi chết giữa chừng, nên chuyện đó rơi vào `catch` bên dưới và huy hiệu kêu
   * `!` như mọi lỗi khác. Ticket 022 gỡ cú ném ấy đi (nó nuốt mất cả Sổ đã import lẫn nhật ký),
   * và từ đó **cùng một chuyện đi vào cùng nhánh với một lượt chạy trọn vẹn** — chỉ khác ở
   * `log.failures`. Đọc mỗi `log.dropped` ở đây là xoá trắng huy hiệu đúng lúc lượt chạy hỏng
   * nặng nhất.
   *
   * Hai hạng, **không phải hai mức nặng nhẹ của một hạng**, vì việc người dùng cần làm khác nhau:
   *
   *   - `dropped` — Mục không import được. Lượt chạy vẫn **trọn vẹn**: phần còn lại đã vào
   *     notebook, và Mục hỏng thường hỏng vì lý do dai dẳng — không có phụ đề, mất quyền xem
   *     (ADR 0008). Bấm chạy lại thường không đổi được gì cho chúng.
   *   - `failures` — cả một hàng đợi **chết giữa chừng**. Sổ đã import chỉ giữ được phần đã
   *     đẩy, còn Mục chưa ra ở đâu quay lại hàng đợi (`deferred`), nên bấm chạy lại là **chạy
   *     tiếp** chứ không phải chạy lại từ đầu. Đó là hành động người dùng chỉ làm nếu biết, và
   *     bảng tổng kết nói được câu ấy — nhưng bảng tổng kết đòi mở popup, còn huy hiệu thì không.
   *
   * Chữ trên huy hiệu chỉ đủ chỗ cho một hạng nên nó mang hạng **quyết định hành động**: `!` là
   * "lượt chạy chưa xong", một con số là "lượt chạy xong, ngần ấy Mục rớt". Con số của từng hạng
   * nằm ở tooltip, mỗi hạng một mệnh đề riêng — cộng hai hạng vào một con số là nói với người
   * dùng rằng chạy lại không giúp được gì, đúng lúc chạy lại là việc duy nhất giúp được.
   */
  function badgeForRun(log) {
    const dropped = log.dropped.length;
    const broken = log.failures.length;
    const owed = log.deferred.length;
    const notes = [];
    if (broken) {
      notes.push(`LƯỢT CHẠY HỎNG GIỮA CHỪNG — ${broken} hàng đợi chết, ${owed} mục còn nợ; chạy lại sẽ chạy tiếp`);
    }
    if (dropped) notes.push(`${dropped} mục rớt`);
    badge(
      broken ? '!' : (dropped ? String(dropped) : ''),
      notes.length ? notes.join(' — ') : 'NotebookLM Importer',
    );
  }

  let running = false;

  /**
   * Một lượt import đầy đủ. Chỉ một lượt tại một thời điểm: hai lượt chồng nhau là hai lượt
   * cùng đọc một `state` cũ rồi ghi đè nhau — Sổ đã import của lượt về sau nuốt mất lượt kia.
   */
  async function importItems(items) {
    const usable = (items || []).filter(Boolean);
    if (usable.length === 0) return { ok: false, error: 'không có mục nào để import' };
    if (running) return { ok: false, error: 'đang chạy một lượt import khác' };

    const notebookId = await readLocal(NOTEBOOK_KEY, '');
    if (!notebookId) {
      return { ok: false, error: 'chưa chọn Notebook đích — mở tab notebook rồi bấm "Dùng notebook ở tab hiện tại"' };
    }

    running = true;
    badge('…', 'Đang import…');
    try {
      const log = await I.runImport({
        items: usable,
        notebookId,
        state: await readLocal(STATE_KEY, E.emptyState()),
        settings: await readSettings(),
        deps,
      });
      await writeLocal(STATE_KEY, log.state);
      badgeForRun(log);
      // Phần của nhánh tài liệu đi kèm bảng tổng kết chung: một Nguồn mỏng vì trang render bằng
      // JS trông y hệt một Nguồn mỏng vì trang mỏng thật, và chỉ câu kia phân biệt được.
      const summary = [E.formatSummary(log), D.formatDocNotes(log)].filter(Boolean).join('\n');
      return { ok: true, result: { summary, saved: log.saved.map((f) => f.filename) } };
    } catch (error) {
      badge('!', messageOf(error));
      return { ok: false, error: messageOf(error) };
    } finally {
      running = false;
      await closeHiddenTab();
    }
  }

  /** Chạy hàng đợi mà **không** đụng NotebookLM: chỉ trích và ghi Bản lưu (ADR 0011). */
  async function saveOnly(items) {
    const usable = (items || []).filter(Boolean);
    if (usable.length === 0) return { ok: false, error: 'không có video nào để tải về' };
    if (running) return { ok: false, error: 'đang chạy một lượt import khác' };

    running = true;
    badge('…', 'Đang tải transcript…');
    try {
      const report = await I.saveOnly({ items: usable, settings: await readSettings(), deps });
      badge(report.failed.length ? String(report.failed.length) : '', 'NotebookLM Importer');
      return { ok: true, result: { summary: I.formatSaveReport(report), saved: report.saved.map((f) => f.filename) } };
    } catch (error) {
      badge('!', messageOf(error));
      return { ok: false, error: messageOf(error) };
    } finally {
      running = false;
    }
  }

  /**
   * Lối vào **không có popup** (phím tắt, menu chuột phải): kết quả chỉ nhìn thấy được qua huy
   * hiệu. `importItems` trả `{ok:false}` cho những lần từ chối sớm — chưa chọn Notebook đích,
   * đang chạy lượt khác — và nếu không ai đọc câu trả lời đó thì với người dùng, bấm phím tắt
   * là **không có gì xảy ra cả**.
   */
  async function importAndReport(items) {
    const answer = await importItems(items);
    if (!answer.ok) badge('!', answer.error);
    return answer;
  }

  const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;

  /**
   * Gọi Bảng chọn trên một tab: tiêm lớp tài liệu vào đó rồi bảo nó mở.
   *
   * Nhớ lại tab ấy (`docsTabId`) vì cả khâu trích của lượt chạy sau sẽ đi qua nó, và nhớ luôn
   * URL của nó: tab ẩn của nấc 2 mở sẵn ở đúng trang đó, xem `ensureHiddenTab`.
   */
  async function openDocPicker(tab) {
    const here = (tab && tab.url) || '';
    if (!tab || !S.docPageId(here)) {
      return { ok: false, error: 'tab hiện tại không phải một trang tài liệu đọc được' };
    }
    // Chốt chặn nằm ở **đường tiêm**, và không có chỗ nào khác đặt được nó: `exclude_matches`
    // chỉ chi phối lúc Chrome tự nạp theo `content_scripts`, còn `chrome.scripting.executeScript`
    // không nhận `matches` lẫn `excludeMatches` — nó tiêm vào đúng `tabId` được đưa, hết.
    //
    // Tiêm chồng lên một tab đã có content script của chính extension là đặt hai listener lên
    // một kênh. Chrome lấy **phản hồi đến trước**, nên từ lúc đó mỗi lượt ping có thể rơi vào
    // nhầm script, và trạng thái ấy sống tới khi tab được tải lại.
    try {
      // Trong `try`: `matchesPattern` **ném** khi gặp một mẫu host gõ sai, và hai trong ba chỗ
      // gọi `openDocPicker` (menu chuột phải, phím tắt) không chờ lời hứa nào — một lần ném ở
      // đây thành unhandled rejection của service worker, tức không huy hiệu, không dấu vết.
      if (S.hasOwnContentScript(here)) {
        return { ok: false, error: 'trang này đã có content script khác của extension — Bảng chọn không chạy ở đây' };
      }
      await ensureDocsTab(tab.id);
      const answer = await ask(tab.id, { type: M.TYPES.OPEN_DOC_PICKER });
      if (!answer.ok) return answer;
      docsTabId = tab.id;
      docsHome = tab.url;
      return answer;
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  }

  /** Lối vào không có popup: kết quả chỉ nhìn thấy được qua huy hiệu (cùng lý do `importAndReport`). */
  async function pickDocsAndReport(tab) {
    const answer = await openDocPicker(tab);
    if (!answer.ok) badge('!', answer.error);
    return answer;
  }

  /** Mục hàng đợi của lối vào "video đang xem": nút trên trang, phím tắt, popup. */
  async function currentVideoItem(tabId) {
    const tab = tabId ? await chrome.tabs.get(tabId) : await activeTab();
    const item = I.itemFromTab(tab);
    return item ? [item] : [];
  }

  // ------------------------------------------------------------------ lối vào

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'Import video này vào NotebookLM',
        contexts: ['link'],
        targetUrlPatterns: ['*://*.youtube.com/*', '*://youtu.be/*'],
      });
      // Trang tài liệu là bất cứ trang nào, nên mục này lọc theo **trang đang mở**
      // (`documentUrlPatterns`), không theo link vừa bấm.
      //
      // `contexts: ['all']`, không phải `['page']`: mục này nói về *trang*, nhưng Chrome chỉ
      // hiện mục `page` khi menu bật trên vùng trống. Trên một trang docs thì vùng trống lại là
      // thứ hiếm nhất — sidebar và thân bài dày đặc link, và bấm chuột phải vào đúng mục sidebar
      // của nhánh mình muốn là cử chỉ tự nhiên nhất. Với `['page']` thì đúng lúc ấy mục biến mất.
      chrome.contextMenus.create({
        id: DOCS_MENU_ID,
        title: 'Chọn Nhánh tài liệu để import…',
        contexts: ['all'],
        documentUrlPatterns: [...S.DOCS_MATCH_PATTERNS],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === DOCS_MENU_ID) {
      pickDocsAndReport(tab);
      return;
    }
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    // `linkUrl`, không phải `pageUrl`: người dùng bấm vào một link, không phải vào trang.
    importAndReport([I.itemFromLink(info)]);
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'open-doc-picker') {
      pickDocsAndReport(await activeTab());
      return;
    }
    if (command !== 'import-video') return;
    importAndReport(await currentVideoItem());
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!M.isFor('background', message)) return false; // im lặng với tin không phải của mình

    (async () => {
      const type = M.typeOf(message);
      if (type === M.TYPES.ACTIVATE_TAB) {
        if (sender.tab) await chrome.tabs.update(sender.tab.id, { active: true });
        return { ok: true };
      }
      if (type === M.TYPES.IMPORT_VIDEO) {
        return importItems(message.items || await currentVideoItem(sender.tab && sender.tab.id));
      }
      if (type === M.TYPES.SAVE_ONLY) {
        const pending = (await readLocal(STATE_KEY, E.emptyState())).pending || [];
        return saveOnly(I.itemsToRun(pending, await currentVideoItem()));
      }
      if (type === M.TYPES.PICK_DOCS) {
        return openDocPicker(await activeTab());
      }
      if (type === M.TYPES.IMPORT_DOCS) {
        // Tab gửi tin **là** tab tài liệu — không hỏi lại `activeTab()`: người dùng bấm Import
        // rồi chuyển sang tab khác trong lúc hàng đợi chạy là chuyện bình thường, và lúc đó
        // `activeTab()` trả về một tab chẳng liên quan gì.
        if (sender.tab) {
          docsTabId = sender.tab.id;
          docsHome = message.page || sender.tab.url || '';
        }
        return importItems(D.itemsFromPicker({ page: message.page, pages: message.pages }));
      }
      if (type === M.TYPES.DOC_TAB_READ) {
        return { ok: true, result: await readHiddenTab() };
      }
      if (type === M.TYPES.DOC_TAB_GO) {
        await chrome.tabs.update(await ensureHiddenTab(), { url: message.url });
        return { ok: true };
      }
      if (type === M.TYPES.USE_CURRENT_NOTEBOOK) {
        const tab = await activeTab();
        const notebookId = S.parseNotebookId((tab && tab.url) || '');
        if (!notebookId) return { ok: false, error: 'tab hiện tại không phải một notebook NotebookLM' };
        await writeLocal(NOTEBOOK_KEY, notebookId);
        return { ok: true, result: { notebookId } };
      }
      if (type === M.TYPES.GET_STATE) {
        // Nhánh riêng, đúng như tám loại trên. Trước đây đây là nhánh "còn lại" của router, và
        // một bất biến viết bằng chữ: mọi loại tin khai trong `ACCEPTS.background` mà quên viết
        // nhánh đều rơi vào đây và nhận `{ok:true}` kèm trạng thái popup — người gọi tin việc đã
        // xong trong khi không có gì chạy.
        const state = await readLocal(STATE_KEY, E.emptyState());
        const tab = await activeTab();
        return {
          ok: true,
          result: {
            notebookId: await readLocal(NOTEBOOK_KEY, ''),
            pending: state.pending || [],
            imported: (state.ledger || []).length,
            currentVideo: I.itemFromTab(tab),
            currentNotebook: S.parseNotebookId((tab && tab.url) || '') || '',
            running,
            downloadDir: (await readSettings()).downloadDir,
          },
        };
      }
      throw M.unrouted('background', message);
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: messageOf(error) }));

    return true; // giữ kênh mở cho câu trả lời async
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
