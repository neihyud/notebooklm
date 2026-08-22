// Service worker: chỗ duy nhất trong repo được phép gọi `chrome.*` để chạy một lần import.
//
// Cố ý mỏng. Mọi quyết định nằm ở tầng dưới và đã có test bằng adapter giả:
//   - `src/background/importer.js` — thứ tự trích → ghi Bản lưu → đẩy (ADR 0011);
//   - `src/background/queue-engine.js` — hai hàng đợi, Sổ đã import, bảng tổng kết;
//   - `src/common/shared.js` — bóc videoId, bóc notebookId, đặt tên, khoá Sổ.
// Còn lại ở đây là ba việc không test tự động được: tìm/đợi tab, gọi `chrome.downloads`, và
// nối bốn lối vào (nút trên trang, phím tắt, menu chuột phải, popup) vào cùng một đường.
//
// `importScripts` chứ không `import`: service worker của MV3 chạy được ES module, nhưng cả
// repo là classic script để content script dùng chung được đúng những file này.
importScripts(
  '/src/common/shared.js',
  '/src/common/messages.js',
  '/src/youtube/srt.js',
  // Lớp tài liệu (ticket 008). Ba file này là hàm thuần trên một cây node được truyền tới, nên
  // chúng nạp được ở đây dù service worker không có `document`: chỗ *gọi* chúng là hàng đợi tài
  // liệu, mà hàng đợi thì sống ở đây. Cây node đến từ tab qua `chrome.scripting` — ticket 010.
  '/src/docs/selectors.js',
  '/src/docs/markdown.js',
  '/src/docs/extract.js',
  '/src/background/queue-engine.js',
  '/src/background/importer.js',
);

(function (root) {
  'use strict';

  const S = root.NBLM_SHARED;
  const M = root.NBLM_MESSAGES;
  const E = root.NBLM_ENGINE;
  const I = root.NBLM_IMPORTER;

  const STATE_KEY = 'run-state';
  const NOTEBOOK_KEY = 'notebook-id';
  const SETTINGS_KEY = 'settings';

  const CONTEXT_MENU_ID = `${S.EXT_PREFIX}import-link`;

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
    const tabs = await tabsMatching(['*://*.youtube.com/*']);
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
   * Đẩy một Nguồn qua tab NotebookLM đang mở đúng Notebook đích.
   *
   * Mở tab mới nếu chưa có — nhưng **không** đoán notebook nào: `source.notebookId` là thứ
   * người dùng đã chọn, và tab bên kia còn kiểm lại lần nữa trước khi đẩy (ADR 0010: Nguồn
   * vào nhầm notebook là vĩnh viễn).
   */
  async function pushSource(source) {
    const existing = await findNotebookTab(source.notebookId);
    const tab = existing || await chrome.tabs.create({ url: S.notebookUrl(source.notebookId), active: false });
    await waitForTab(tab.id, M.TYPES.PING_NOTEBOOKLM);
    const answer = await ask(tab.id, { type: M.TYPES.PUSH_SOURCE, source });
    if (!answer.ok) throw new Error(answer.error || 'tab NotebookLM không đẩy được');
    return answer.result;
  }

  const deps = { extractVideo, saveFile, pushSource };

  // ------------------------------------------------------------------ một lượt chạy

  /** Huy hiệu trên nút extension — dấu hiệu duy nhất nhìn thấy được khi popup đang đóng. */
  function badge(text, title) {
    chrome.action.setBadgeText({ text });
    if (title) chrome.action.setTitle({ title });
  }

  let running = false;

  /**
   * Một lượt import đầy đủ. Chỉ một lượt tại một thời điểm: hai lượt chồng nhau là hai lượt
   * cùng đọc một `state` cũ rồi ghi đè nhau — Sổ đã import của lượt về sau nuốt mất lượt kia.
   */
  async function importItems(items) {
    const usable = (items || []).filter(Boolean);
    if (usable.length === 0) return { ok: false, error: 'không có video nào để import' };
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
      const failed = log.dropped.length;
      badge(failed ? String(failed) : '', failed ? `${failed} mục rớt` : 'NotebookLM Importer');
      return { ok: true, result: { summary: E.formatSummary(log), saved: log.saved.map((f) => f.filename) } };
    } catch (error) {
      badge('!', messageOf(error));
      return { ok: false, error: messageOf(error) };
    } finally {
      running = false;
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
    });
  });

  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    // `linkUrl`, không phải `pageUrl`: người dùng bấm vào một link, không phải vào trang.
    importAndReport([I.itemFromLink(info)]);
  });

  chrome.commands.onCommand.addListener(async (command) => {
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
      if (type === M.TYPES.USE_CURRENT_NOTEBOOK) {
        const tab = await activeTab();
        const notebookId = S.parseNotebookId((tab && tab.url) || '');
        if (!notebookId) return { ok: false, error: 'tab hiện tại không phải một notebook NotebookLM' };
        await writeLocal(NOTEBOOK_KEY, notebookId);
        return { ok: true, result: { notebookId } };
      }
      // Còn lại đúng một loại: đọc trạng thái để popup vẽ.
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
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: messageOf(error) }));

    return true; // giữ kênh mở cho câu trả lời async
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
