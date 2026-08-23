/*
 * Service worker: điều phối toàn bộ luồng import.
 *
 * Luật cốt lõi về quyền riêng tư:
 *   - Video PRIVATE  -> LUÔN đi đường transcript (trích cục bộ, dán làm nguồn text).
 *                       Không bao giờ gửi URL cho NotebookLM (backend Google không
 *                       có phiên đăng nhập của bạn nên chắc chắn hỏng), và tuyệt
 *                       đối không đụng tới chế độ hiển thị của video.
 *   - Video UNLISTED -> thử URL trước, hỏng thì rơi về transcript (tuỳ cấu hình).
 *   - Video PUBLIC   -> đi URL (NotebookLM tự lấy transcript), hỏng thì rơi về
 *                       transcript cục bộ.
 *
 * Trang TÀI LIỆU đi theo cùng logic đó vì cùng một lý do kỹ thuật: NotebookLM
 * fetch link bằng máy chủ của Google, không chạy JS và không có phiên của bạn —
 * docs render client-side trả về khung rỗng. Nên mặc định là trích nội dung ngay
 * trong trình duyệt rồi dán vào dưới dạng nguồn văn bản.
 */
// srt.js là thuần hàm (không đụng DOM) nên dùng lại được ở đây để định dạng
// file tải về — khỏi phải nhân bản bộ chuyển đổi sang service worker.
importScripts('/src/common/shared.js', '/src/youtube/srt.js');

const {
  MSG, STATUS, PRIVACY, KIND, KEYS, DEFAULTS,
  getSettings, getQueue, setQueue,
  uid, sleep, videoIdFrom, canonicalUrl, parseUrlList,
  docKey, urlLabel,
  buildSourceText, sourceTitle,
  toDataUrl, downloadName,
  buildDocsSourceText, docsSourceTitle,
} = self.NBLM;

const TEXT_PREFIX = 'text:';

/** Trần thời gian cho việc THÊM NGUỒN của một mục. */
const ITEM_TIMEOUT_MS = 240000;

/**
 * Trần thời gian cho MỘT lần ghi file xuống đĩa.
 *
 * Phải NGẮN HƠN `ITEM_TIMEOUT_MS`: vòng lặp ngoài cắt mục ở 240s bằng thông báo
 * "quá 240s không xong", và nếu phép chờ ghi file dài hơn thế thì lần nào cũng bị
 * cắt ngang — che mất lý do thật mà Chrome đã nói ra (đĩa đầy, blob URL hết hạn).
 */
const DOWNLOAD_TIMEOUT_MS = 90000;

let runner = null;      // Promise của vòng lặp đang chạy
let stopRequested = false;

/* -------------------------------------------------------------------- */
/* tiện ích tab / nhắn tin                                               */
/* -------------------------------------------------------------------- */

function sendToTab(tabId, message, timeout = 120000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Tab ${tabId} không phản hồi lệnh ${message.type}`));
    }, timeout);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response) reject(new Error('Không có phản hồi từ content script'));
      else resolve(response);
    });
  });
}

async function waitTabComplete(tabId, timeout = 45000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    if (Date.now() > deadline) throw new Error('Tab tải quá lâu');
    await sleep(400);
  }
}

const SCRIPTS = {
  youtube: {
    main: ['src/youtube/page-bridge.js'],
    // Thứ tự phải khớp với content_scripts[1].js trong manifest.json — panel.js
    // cần NBLM_TRANSCRIPT và NBLM_SRT có trước, content.js cần NBLM_PANEL.
    isolated: [
      'src/common/shared.js',
      'src/youtube/bridge-client.js',
      'src/youtube/transcript.js',
      'src/youtube/srt.js',
      'src/youtube/panel.js',
      'src/youtube/content.js',
    ],
    css: ['src/youtube/overlay.css'],
    ping: MSG.YT_PING,
  },
  notebooklm: {
    main: [],
    isolated: ['src/common/shared.js', 'src/notebooklm/selectors.js', 'src/notebooklm/automation.js', 'src/notebooklm/content.js'],
    css: ['src/notebooklm/overlay.css'],
    ping: MSG.NLM_PING,
  },
  docs: {
    main: [],
    isolated: [
      'src/common/shared.js',
      'src/docs/markdown.js',
      'src/docs/extract.js',
      'src/docs/sidebar.js',
      'src/docs/content.js',
    ],
    css: [], // bảng chọn dùng shadow DOM, tự nạp CSS riêng
    ping: MSG.DOCS_PING,
  },
};

/**
 * Đảm bảo content script đã sống trong tab. Tab mở từ trước khi cài extension
 * sẽ không có script, nên phải tiêm tay.
 */
async function ensureScripts(tabId, kind) {
  const spec = SCRIPTS[kind];

  // Chrome báo `{tabId: null}` là "Missing required property 'tabId'" — một câu
  // lỗi trỏ hoàn toàn sai chỗ. Chặn ở đây để lỗi tự khai đúng nguyên nhân.
  if (typeof tabId !== 'number') {
    throw new Error(`ensureScripts("${kind}") nhận tabId không hợp lệ (${JSON.stringify(tabId)}) — tab có thể đã bị đóng giữa chừng.`);
  }

  // Chỉ chấp nhận phản hồi có `ok: true`.
  //
  // Một content script KHÁC có thể đang nằm trên cùng tab và trả lời ping này.
  // Chuyện đó đã xảy ra thật: trước đây hàm này nhận mọi phản hồi truthy, nên khi
  // script tài liệu đáp "lệnh lạ: nlm-ping" bằng {ok:false}, nó tưởng script đúng
  // đã sống, bỏ luôn bước tiêm, và mọi thứ sau đó chết bằng một lỗi trỏ sai hẳn
  // chỗ. Guard HANDLED bên content script đã chặn từ gốc; đây là lớp thứ hai, vì
  // đây là nút thắt duy nhất quyết định "script đúng có sống trên tab này không".
  try {
    const pong = await sendToTab(tabId, { type: spec.ping }, 4000);
    if (pong && pong.ok) return pong;
  } catch (_) {
    /* chưa có -> tiêm */
  }

  if (spec.main.length) {
    await chrome.scripting.executeScript({ target: { tabId }, files: spec.main, world: 'MAIN' });
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: spec.isolated });
  if (spec.css.length) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: spec.css });
  }
  await sleep(500);

  const pong = await sendToTab(tabId, { type: spec.ping }, 8000);
  if (!pong || !pong.ok) {
    throw new Error(
      `Đã tiêm content script "${kind}" nhưng tab không phản hồi đúng. ` +
        'Hãy tải lại (F5) tab đó rồi thử lại.'
    );
  }
  return pong;
}

/* -------------------------------------------------------------------- */
/* tab NotebookLM                                                        */
/* -------------------------------------------------------------------- */

async function resolveNotebookTab() {
  const settings = await getSettings();
  const target = (settings.notebookUrl || '').trim();

  const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
  const inNotebook = tabs.filter((t) => /\/notebook\/[^/]+/.test(t.url || ''));

  let tab = null;
  if (target) {
    const wantedId = (/\/notebook\/([^/?#]+)/.exec(target) || [])[1];
    tab = inNotebook.find((t) => wantedId && (t.url || '').includes(wantedId)) || null;
    if (!tab) {
      tab = tabs[0]
        ? await chrome.tabs.update(tabs[0].id, { url: target })
        : await chrome.tabs.create({ url: target, active: false });
      await waitTabComplete(tab.id);
      await sleep(2500); // Angular cần thời gian dựng UI
    }
  } else {
    tab = inNotebook[0] || null;
    if (!tab) {
      throw new Error(
        'Chưa có notebook nào đang mở. Hãy mở notebook đích rồi bấm "Dùng notebook ở tab hiện tại" ' +
          'trong popup, hoặc dán URL notebook vào Options.'
      );
    }
  }

  // Ngay sau khi điều hướng, Angular có thể chưa kịp dựng xong route notebook —
  // hỏi lại vài nhịp trước khi kết luận là hỏng.
  let ping = await ensureScripts(tab.id, 'notebooklm');
  for (let i = 0; i < 4 && !ping.inNotebook; i++) {
    await sleep(1000);
    ping = await sendToTab(tab.id, { type: MSG.NLM_PING }, 8000);
  }

  if (!ping.inNotebook) {
    // Báo luôn URL mà content script *thực sự* nhìn thấy. Không có nó thì lỗi này
    // hoàn toàn không truy được: người dùng thấy tab đang mở đúng notebook và câu
    // báo lỗi nói ngược lại, mà không biết bên nào sai.
    let seen = ping.url || '';
    if (!seen) {
      try {
        seen = (await chrome.tabs.get(tab.id)).url || '';
      } catch (_) {}
    }
    throw new Error(
      `Tab NotebookLM không ở trong một notebook cụ thể. Content script thấy: ${seen || '(không đọc được URL)'} ` +
        '— URL phải có dạng /notebook/<id>. Nếu URL trông đã đúng thì tải lại (F5) tab NotebookLM rồi thử lại.'
    );
  }
  return tab.id;
}

/* -------------------------------------------------------------------- */
/* tab YouTube phụ trợ                                                   */
/* -------------------------------------------------------------------- */

const helper = { tabId: null, owned: false };

const HOME = 'https://www.youtube.com/';

async function tabShowingVideo(videoId) {
  const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/watch*', 'https://www.youtube.com/shorts/*'] });
  return tabs.find((t) => videoIdFrom(t.url || '') === videoId) || null;
}

/**
 * Một tab YouTube dùng chung.
 *
 * Điểm quan trọng: page-bridge gọi InnerTube (`player`, `get_transcript`) cho
 * *bất kỳ* videoId nào, chỉ cần đứng trên một trang youtube.com bất kỳ. Nên với
 * metadata và hai đường transcript đầu tiên, ta KHÔNG cần điều hướng tab —
 * import 50 video chỉ tốn đúng một lần tải trang thay vì 50 lần.
 *
 * Chỉ khi phải quét DOM panel transcript mới cần thực sự mở trang watch.
 * @param {string|null} url điều hướng tới đây; null = chấp nhận trang hiện có
 */
async function helperTab(url) {
  // Giữ id trong biến cục bộ, KHÔNG đọc lại helper.tabId sau mỗi await.
  //
  // `helper.tabId` là trạng thái dùng chung mà listener chrome.tabs.onRemoved và
  // releaseHelperTab() có thể set về null bất cứ lúc nào. Hàm này await nhiều lần
  // (tabs.update, waitTabComplete, sleep) trước khi dùng lại id, nên đọc lại field
  // đó là có lúc nhận null — và Chrome coi `{ tabId: null }` là *thiếu hẳn* thuộc
  // tính, ném ra "Missing required property 'tabId'" chẳng liên quan gì tới
  // nguyên nhân thật. Đã xảy ra thật.
  let tabId = helper.tabId;

  if (tabId != null) {
    try {
      await chrome.tabs.get(tabId);
    } catch (_) {
      tabId = null;
    }
  }

  if (tabId == null) {
    const tab = await chrome.tabs.create({ url: url || HOME, active: false, pinned: true });
    if (tab.id == null) throw new Error('Chrome không trả về id cho tab vừa mở.');
    tabId = tab.id;
    helper.tabId = tabId;
    helper.owned = true;
    await chrome.tabs.update(tabId, { muted: true });
    await waitTabComplete(tabId);
    await sleep(1500); // ytcfg + request InnerTube đầu tiên (để mượn header)
  } else if (url) {
    const tab = await chrome.tabs.get(tabId);
    if (videoIdFrom(tab.url || '') !== videoIdFrom(url)) {
      await chrome.tabs.update(tabId, { url, muted: true });
      await waitTabComplete(tabId);
      await sleep(1500);
    }
  }

  await ensureScripts(tabId, 'youtube');
  return tabId;
}

/** Tab để hỏi InnerTube — không quan tâm đang ở trang nào. */
function queryTab() {
  return helperTab(null);
}

/** Tab thực sự mở trang watch của video — cần cho phương án quét DOM. */
async function watchTabFor(videoId) {
  const existing = await tabShowingVideo(videoId);
  if (existing) {
    await ensureScripts(existing.id, 'youtube');
    return existing.id;
  }
  return helperTab(canonicalUrl(videoId));
}

async function releaseHelperTab() {
  if (helper.owned && helper.tabId != null) {
    try {
      const settings = await getSettings();
      if (settings.autoCloseTabs) await chrome.tabs.remove(helper.tabId);
    } catch (_) {}
  }
  helper.tabId = null;
  helper.owned = false;
}

/** Kích hoạt tạm tab rồi trả lại tab cũ — cần cho việc quét DOM panel transcript. */
async function withTabActive(tabId, fn) {
  let previous = null;
  let windowId = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    windowId = tab.windowId;
    const [active] = await chrome.tabs.query({ active: true, windowId });
    previous = active ? active.id : null;
    await chrome.tabs.update(tabId, { active: true });
    await sleep(900);
    return await fn();
  } finally {
    if (previous != null && previous !== tabId) {
      try { await chrome.tabs.update(previous, { active: true }); } catch (_) {}
    }
  }
}

/* -------------------------------------------------------------------- */
/* tab tài liệu                                                          */
/* -------------------------------------------------------------------- */

const docsHelper = { tabId: null, origin: null };

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return null;
  }
}

/**
 * Một tab *bất kỳ* đang mở cùng origin, để chạy fetch từ trong đó.
 *
 * Vì sao phải mượn tab thay vì fetch thẳng từ service worker: fetch trong tab đi
 * kèm cookie phiên và không vướng CORS (cùng origin), nên tài liệu nội bộ cần
 * đăng nhập vẫn đọc được. Quan trọng hơn: ta chỉ *đọc*, không điều hướng, nên
 * tab người dùng đang mở không hề bị đụng vào.
 */
async function docsFetchTab(url) {
  const origin = originOf(url);
  if (!origin) throw new Error(`URL tài liệu không hợp lệ: ${url}`);

  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  for (const tab of tabs) {
    try {
      await ensureScripts(tab.id, 'docs');
      return tab.id;
    } catch (_) {
      /* tab đang tải dở hoặc là trang lỗi — thử tab kế tiếp */
    }
  }
  // Không có tab nào cùng origin. Cố tình *không* tự mở tab ở đây: mở tab nghĩa là
  // đã tải xong trang rồi, fetch thêm lần nữa là tải đúng URL đó hai lần.
  return null;
}

/**
 * Tab ẩn do extension sở hữu, điều hướng tới đúng URL để đọc DOM *đã render*.
 * Chỉ dùng tab của chính mình — không bao giờ lái tab người dùng đang đọc.
 */
async function docsRenderTab(url) {
  // Giữ id trong biến cục bộ — xem ghi chú ở helperTab(): `docsHelper.tabId` là
  // trạng thái dùng chung, releaseDocsTab() có thể set null giữa hai lần await và
  // Chrome sẽ ném "Missing required property 'tabId'" trỏ sai hoàn toàn chỗ.
  let tabId = docsHelper.tabId;

  if (tabId != null) {
    try {
      await chrome.tabs.get(tabId);
    } catch (_) {
      tabId = null;
    }
  }

  if (tabId == null) {
    const tab = await chrome.tabs.create({ url, active: false, pinned: true });
    if (tab.id == null) throw new Error('Chrome không trả về id cho tab vừa mở.');
    tabId = tab.id;
    docsHelper.tabId = tabId;
    await chrome.tabs.update(tabId, { muted: true });
  } else {
    const tab = await chrome.tabs.get(tabId);
    if (docKey(tab.url || '') !== docKey(url)) {
      await chrome.tabs.update(tabId, { url, muted: true });
    }
  }

  docsHelper.origin = originOf(url);
  await waitTabComplete(tabId);
  await sleep(1200); // docs SPA dựng thân bài sau khi 'complete'
  await ensureScripts(tabId, 'docs');
  return tabId;
}

async function releaseDocsTab() {
  if (docsHelper.tabId != null) {
    try {
      const settings = await getSettings();
      if (settings.autoCloseTabs) await chrome.tabs.remove(docsHelper.tabId);
    } catch (_) {}
  }
  docsHelper.tabId = null;
  docsHelper.origin = null;
}

/* -------------------------------------------------------------------- */
/* hàng đợi                                                              */
/* -------------------------------------------------------------------- */

async function patchItem(id, patch) {
  const queue = await getQueue();
  const index = queue.findIndex((i) => i.id === id);
  if (index === -1) return null;
  queue[index] = Object.assign({}, queue[index], patch);
  await setQueue(queue);
  await refreshBadge(queue);
  notifyPopup();
  return queue[index];
}

async function storeText(itemId, text) {
  await chrome.storage.local.set({ [TEXT_PREFIX + itemId]: text });
}

async function loadText(itemId) {
  const got = await chrome.storage.local.get(TEXT_PREFIX + itemId);
  return got[TEXT_PREFIX + itemId] || null;
}

async function dropText(itemId) {
  await chrome.storage.local.remove(TEXT_PREFIX + itemId);
}

/**
 * Khoá chống trùng của một mục.
 * Tính lại từ nội dung mục thay vì đọc `item.key`, để hàng đợi lưu từ bản cũ
 * (chỉ có `videoId`, chưa có `kind`) vẫn được khử trùng đúng.
 */
function itemKey(item) {
  if (item.kind === KIND.DOCS) return item.key || docKey(item.url);
  return item.videoId ? `yt:${item.videoId}` : null;
}

/** Chuẩn hoá một mục do popup / content script gửi lên thành bản ghi hàng đợi. */
function normalize(raw) {
  const base = {
    id: uid(),
    mode: null,
    status: STATUS.PENDING,
    error: null,
    attempts: 0,
    textLength: 0,
    addedAt: Date.now(),
  };

  if (raw.kind === KIND.DOCS) {
    const key = docKey(raw.url);
    if (!key) return null;
    return Object.assign(base, {
      kind: KIND.DOCS,
      key,
      url: raw.url,
      title: raw.title || urlLabel(raw.url),
      site: raw.site || '',
      section: raw.section || '',
    });
  }

  const videoId = raw.videoId || videoIdFrom(raw.url || '');
  if (!videoId) return null;
  return Object.assign(base, {
    kind: KIND.YOUTUBE,
    key: `yt:${videoId}`,
    videoId,
    url: canonicalUrl(videoId),
    title: raw.title || '',
    channel: raw.channel || '',
    durationSec: raw.durationSec || 0,
    privacy: raw.privacy || PRIVACY.UNKNOWN,
    hasCaptions: raw.hasCaptions,
  });
}

async function enqueue(items) {
  const queue = await getQueue();
  const active = new Set(
    queue.filter((i) => i.status !== STATUS.ERROR).map(itemKey).filter(Boolean)
  );

  let added = 0;
  for (const raw of items) {
    const item = normalize(raw);
    if (!item || active.has(item.key)) continue;
    active.add(item.key);
    added++;
    queue.push(item);
  }
  await setQueue(queue);
  await refreshBadge(queue);
  notifyPopup();
  return { added, skipped: items.length - added, total: queue.length };
}

async function refreshBadge(queue) {
  const q = queue || (await getQueue());
  const pending = q.filter((i) => i.status === STATUS.PENDING || i.status === STATUS.EXTRACTING || i.status === STATUS.IMPORTING).length;
  await chrome.action.setBadgeText({ text: pending ? String(pending) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
}

function notifyPopup() {
  chrome.runtime.sendMessage({ type: MSG.STATE_CHANGED }).catch(() => {});
}

/* -------------------------------------------------------------------- */
/* xử lý một mục                                                         */
/* -------------------------------------------------------------------- */

/**
 * Bổ sung metadata (đặc biệt là privacy) nếu còn thiếu.
 *
 * Bước này bắt buộc trước khi chọn chiến lược: nếu đoán sai một video private
 * thành public, ta sẽ gửi URL cho NotebookLM và nó có thể tạo ra một nguồn rỗng
 * / hỏng thay vì báo lỗi rõ ràng — lúc đó không có gì để rơi về transcript nữa.
 */
async function resolveMeta(item) {
  if (item.privacy && item.privacy !== PRIVACY.UNKNOWN && item.title) return item;

  const tabId = await queryTab();
  const res = await sendToTab(tabId, { type: MSG.YT_DESCRIBE, videoId: item.videoId }, 60000);
  if (!res.ok) throw new Error(`Không đọc được thông tin video: ${res.error}`);

  const meta = res.meta;
  return (
    (await patchItem(item.id, {
      title: meta.title || item.title,
      channel: meta.channel || item.channel,
      durationSec: meta.durationSec || item.durationSec,
      privacy: meta.privacy || PRIVACY.UNKNOWN,
      hasCaptions: meta.hasCaptions,
    })) || item
  );
}

/** Trích transcript và dựng sẵn nội dung nguồn dạng text. */
async function prepareTranscript(item, settings) {
  await patchItem(item.id, { status: STATUS.EXTRACTING, error: null });

  const request = { type: MSG.YT_EXTRACT, videoId: item.videoId, langs: settings.preferredLangs };
  const failures = [];

  // Nấc 1 — hỏi InnerTube từ tab dùng chung, không cần điều hướng đi đâu cả.
  try {
    const tabId = await queryTab();
    const res = await sendToTab(tabId, request, 120000);
    if (res.ok) return finishTranscript(item, res.result, settings);
    failures.push(res.error);
  } catch (e) {
    failures.push((e && e.message) || String(e));
  }

  // Nấc 2 — mở đúng trang watch, mở thêm được phương án quét DOM panel.
  const watchTabId = await watchTabFor(item.videoId);
  try {
    const res = await sendToTab(watchTabId, request, 150000);
    if (res.ok) return finishTranscript(item, res.result, settings);
    failures.push(res.error);
  } catch (e) {
    failures.push((e && e.message) || String(e));
  }

  // Nấc 3 — Chrome bóp hiệu năng tab nền nên player YouTube có thể chưa dựng
  // xong panel transcript. Kích hoạt tab một lát rồi thử lại, sau đó trả tab cũ.
  const res = await withTabActive(watchTabId, () => sendToTab(watchTabId, request, 180000));
  if (!res.ok) throw new Error([...failures, res.error].join(' || '));
  return finishTranscript(item, res.result, settings);
}

async function finishTranscript(item, result, settings) {
  const { meta, segments, method } = result;
  if (!segments || !segments.length) throw new Error('Transcript rỗng');

  const fullMeta = Object.assign({ videoId: item.videoId, title: item.title, privacy: item.privacy }, meta || {}, { method });
  const text = buildSourceText(fullMeta, segments, settings);
  await storeText(item.id, text);
  await patchItem(item.id, {
    textLength: text.length,
    title: fullMeta.title || item.title,
    channel: fullMeta.channel || item.channel,
    privacy: fullMeta.privacy || item.privacy,
    // Bản chép lời thiếu phần đuôi là sự thật về NỘI DUNG nguồn, và nó phải sống
    // lâu hơn lời gọi này: Mục còn đi qua vài nấc nữa (ghi file, thử url, rơi về
    // dán text) trước khi có ai kết luận `done`. Ghi thẳng vào Hàng đợi thì mọi
    // nấc đọc lại được từ một chỗ. `|| null` để lượt chạy lại xoá được dấu cũ.
    truncated: result.truncated || null,
  });
  // Trả kèm segments + meta: đường tải file cần dữ liệu thô để dựng .srt/.md,
  // chứ không dùng được `text` vốn đã định dạng sẵn cho NotebookLM.
  return { text, title: sourceTitle(fullMeta), segments, meta: fullMeta, truncated: result.truncated || null };
}

/* -------------------------------------------------------------------- */
/* tải transcript về máy                                                 */
/* -------------------------------------------------------------------- */

/**
 * Trích transcript rồi lưu thẳng thành file, không đụng tới NotebookLM.
 *
 * Có ích khi khâu import đang trục trặc: transcript vẫn lấy được và giữ lại
 * được, thay vì mất công trích rồi vứt đi vì NotebookLM từ chối.
 */
const OFFSCREEN_URL = 'src/background/offscreen.html';

/**
 * Dựng URL cho file tải về.
 *
 * Ưu tiên blob URL qua offscreen document: Chromium **bỏ qua `saveAs: false` với
 * `data:` URL**, nên mỗi file lại bật hộp thoại "Save as" — tải 89 file thành 89
 * lần bấm tay. Blob URL không dính lỗi đó.
 *
 * Vẫn giữ data URL làm đường lui: nếu chrome.offscreen không dùng được thì thà
 * tải kèm hộp thoại còn hơn không tải được gì.
 */
async function fileUrlFor(text, mime) {
  // Ghi lại đã đi đường nào. Trước đây hàm này nuốt lỗi rồi lặng lẽ rơi về data
  // URL, nên khi hộp thoại "Save as" vẫn hiện thì không cách nào biết là do
  // offscreen hỏng hay do cài đặt trình duyệt — hai nguyên nhân, hai cách sửa.
  const diag = async (kind, detail) => {
    try {
      await chrome.storage.local.set({
        downloadDiag: { kind, detail: detail || null, at: new Date().toISOString() },
      });
    } catch (_) {}
  };

  try {
    if (chrome.offscreen) {
      const has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
      if (!has) {
        try {
          await chrome.offscreen.createDocument({
            url: OFFSCREEN_URL,
            reasons: ['BLOBS'],
            justification: 'Tạo blob URL để lưu transcript — service worker MV3 không có URL.createObjectURL.',
          });
        } catch (e) {
          // Chỉ được phép có một offscreen document; hai lời gọi sát nhau thì
          // lời sau báo lỗi này và ta cứ dùng cái đã có.
          if (!/single|already/i.test((e && e.message) || '')) throw e;
        }
      }
      const res = await chrome.runtime.sendMessage({ type: 'offscreen-blob-url', text, mime });
      if (res && res.ok && res.url) {
        await diag('blob');
        return res.url;
      }
      await diag('data', `offscreen trả về: ${JSON.stringify(res)}`);
    } else {
      await diag('data', 'chrome.offscreen không tồn tại');
    }
  } catch (e) {
    await diag('data', `offscreen lỗi: ${(e && e.message) || e}`);
  }
  return toDataUrl(text, mime);
}

/**
 * Chờ Chrome ghi XONG file, không phải chờ Chrome nhận yêu cầu.
 *
 * `chrome.downloads.download()` resolve ngay khi yêu cầu được nhận. Một download
 * bị `interrupted` — đĩa đầy, hoặc blob URL đã bị revoke sau TTL 120s ở
 * `offscreen.js` — vẫn resolve y hệt lúc thành công. Kết quả thật chỉ có trong
 * `state` của `chrome.downloads`.
 */
function awaitDownloadComplete(downloadId, timeout = DOWNLOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;

    const verdict = (state, reason) =>
      state === 'complete'
        ? { ok: true }
        : { ok: false, error: `Chrome không ghi được file (${reason || 'không rõ lý do'})` };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };

    const onChanged = (delta) => {
      // Cả hàng đợi dùng chung một stream sự kiện: bỏ lọc theo id là nhận delta
      // của mục khác rồi báo xong cho một file chưa hề được ghi.
      if (!delta || delta.id !== downloadId || !delta.state) return;
      const state = delta.state.current;
      if (state !== 'complete' && state !== 'interrupted') return;
      finish(verdict(state, delta.error && delta.error.current));
    };

    chrome.downloads.onChanged.addListener(onChanged);
    const timer = setTimeout(
      () => finish({ ok: false, error: `Quá ${Math.round(timeout / 1000)}s mà Chrome chưa ghi xong file.` }),
      timeout
    );

    // Transcript nhỏ có thể ghi xong TRƯỚC khi listener kịp gắn — không hỏi lại
    // trạng thái hiện tại thì mọi file nhỏ đều treo tới hết giờ dù đã nằm trên đĩa.
    Promise.resolve(chrome.downloads.search({ id: downloadId }))
      .then((list) => {
        const found = (list || [])[0];
        if (!found || (found.state !== 'complete' && found.state !== 'interrupted')) return;
        finish(verdict(found.state, found.error));
      })
      .catch(() => {});
  });
}

/** Gửi yêu cầu tải rồi chờ tới lúc file thật sự nằm trên đĩa. */
async function saveFile(url, filename) {
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  } catch (e) {
    return { ok: false, error: `Không lưu được file: ${(e && e.message) || e}` };
  }
  if (downloadId == null) return { ok: false, error: 'Chrome không nhận yêu cầu tải file.' };
  return awaitDownloadComplete(downloadId);
}

/** Vị trí 1-based của một Mục trong Hàng đợi; 0 nếu Mục đã bị xoá giữa chừng. */
async function queueOrdinal(id) {
  return (await getQueue()).findIndex((i) => i.id === id) + 1;
}

/**
 * Ghi Bản sao xuống đĩa cho một video. Ném lỗi nếu không ghi được — người gọi
 * quyết định làm gì với nó, và câu trả lời luôn là "ghi lại rồi đi tiếp".
 *
 * @returns {string|null} lý do file vừa ghi KHÔNG trọn vẹn (transcript chạm trần
 * cuộn), hoặc null. File có nằm trên đĩa mà nội dung cụt đuôi vẫn là một khuyết
 * tật phải nói ra.
 */
async function saveTranscriptCopy(item, settings) {
  const resolved = await resolveMeta(item);
  const prepared = await prepareTranscript(resolved, settings);
  const segments = prepared.segments || [];
  if (!segments.length) throw new Error('Không có dòng transcript nào.');

  const fmt = self.NBLM_SRT.FORMATS[settings.downloadFormat] || self.NBLM_SRT.FORMATS.txt;
  // `prepared.meta` là bản đầy đủ mà finishTranscript đã dựng — nó đã gồm cả
  // videoId lẫn title của chính Mục này. Dựng lại một object cơ sở rồi để nó ghi
  // đè lên là code chết: hoán vị hai trường trong object cơ sở đó không đổi được
  // gì cả, tức là chẳng có gì để canh. Chỉ còn MỘT chỗ quyết định cặp này.
  const meta = prepared.meta;
  const content = fmt.render(segments, meta);

  const folder = String(settings.downloadSubfolder || '').replace(/[\\/:*?"<>|]/g, '').trim();
  // Số thứ tự đọc từ VỊ TRÍ của chính Mục này trong Hàng đợi — một con số nằm
  // trong chrome.storage, không phải bộ đếm chạy trong RAM. Hai thứ đó cùng kiểu
  // số và cùng đi vào tên file, nhưng chỉ cái trước sống sót qua một lần Chrome
  // ngắt service worker: bộ đếm RAM về 0 là cả loạt file được đánh số lại từ 001
  // và `conflictAction:'uniquify'` đẻ ra một dãy bản sao " (1)".
  const filename = (folder ? `${folder}/` : '') + downloadName(meta, fmt.ext, await queueOrdinal(resolved.id));

  const saved = await saveFile(await fileUrlFor(content, fmt.mime), filename);
  if (!saved.ok) throw new Error(saved.error);

  // Chỉ ghi `savedFile` SAU khi Chrome xác nhận file đã nằm trên đĩa. Đây là
  // toàn bộ tiến độ của đường tải đĩa, và nó phải đúng nghĩa đen.
  await patchItem(resolved.id, { savedFile: filename });
  return prepared.truncated || null;
}

/**
 * Bước ghi Bản sao xuống đĩa trong một Lượt chạy.
 *
 * Bản sao xuống đĩa là *phụ phẩm* của việc trích Transcript, không phải mục đích
 * của Lượt chạy — Nguồn mới là thứ đo được thành công. Nên bước này không bao giờ
 * làm hỏng Mục: hỏng thì ghi lý do lên Mục rồi trả quyền điều khiển lại ngay.
 */
async function copyStep(item, settings) {
  if (!settings.saveTranscriptCopy || item.kind === KIND.DOCS) return;

  // Đã ghi rồi thì thôi. `savedFile` là chỗ DUY NHẤT giữ tiến độ của đường tải
  // đĩa, và nó nằm trong chrome.storage chứ không phải trong một biến cục bộ:
  // Chrome ngắt service worker MV3 giữa lượt chạy là mọi biến RAM về 0, alarm gọi
  // lại runQueue, và cả loạt file đã tải bị tải lại lần nữa.
  if (item.savedFile) return;

  // KHÔNG bọc trong Promise.race. Chặn giờ ở đây sẽ bỏ rơi một promise vẫn đang
  // chạy, mà promise đó lái `helper` — tab YouTube DÙNG CHUNG duy nhất. Nó và
  // `importItem` ngay sau đó sẽ vừa điều hướng vừa kích hoạt cùng một tab, và
  // mỗi bên thấy trang của bên kia. `saveTranscriptCopy` vốn đã có trần: mọi
  // `sendToTab` bên trong đều mang timeout riêng, cộng thêm DOWNLOAD_TIMEOUT_MS
  // — nó chậm được, nhưng không treo vĩnh viễn được.
  const copyError = await saveTranscriptCopy(item, settings).then(
    (truncated) => truncated,
    (e) => (e && e.message) || String(e)
  );
  await patchItem(item.id, { copyError });
}

/** Chiến lược cho từng mức riêng tư. */
function planFor(privacy, settings) {
  switch (privacy) {
    case PRIVACY.PRIVATE:
      // Không bao giờ thử URL: backend NotebookLM không có phiên của bạn.
      return ['text'];
    case PRIVACY.UNLISTED:
      if (settings.unlistedMode === 'transcript') return ['text'];
      if (settings.unlistedMode === 'url') return ['url'];
      return ['url', 'text'];
    case PRIVACY.PUBLIC:
      return settings.publicFallbackToTranscript ? ['url', 'text'] : ['url'];
    default:
      return ['url', 'text'];
  }
}

async function importItem(item, settings, notebookTabId) {
  return item.kind === KIND.DOCS
    ? importDoc(item, settings, notebookTabId)
    : importVideo(item, settings, notebookTabId);
}

async function importVideo(item, settings, notebookTabId) {
  const resolved = await resolveMeta(item);
  const plan = planFor(resolved.privacy, settings);
  const failures = [];

  for (const mode of plan) {
    await patchItem(resolved.id, { mode, status: STATUS.IMPORTING });

    if (mode === 'url') {
      const res = await sendToTab(
        notebookTabId,
        { type: MSG.NLM_ADD_URL, url: resolved.url, label: resolved.title || resolved.videoId },
        150000
      );
      if (res.ok) return { ok: true, mode, verified: res.verified === true, unverified: res.unverified || null };
      if (res.limit) return { ok: false, mode, error: res.error, fatal: true };
      // Nguồn ĐÃ vào notebook (chỉ là không đúng 1). Rơi sang đường kế tiếp là
      // thêm lần nữa — thao tác này không idempotent, bản trùng phải xoá tay.
      if (res.sourceAdded) return { ok: false, mode, error: res.error };
      failures.push(`URL: ${res.error}`);
      continue;
    }

    // mode === 'text'
    let prepared;
    try {
      const cached = await loadText(resolved.id);
      prepared = cached
        ? { text: cached, title: sourceTitle(resolved) }
        : await prepareTranscript(resolved, settings);
    } catch (e) {
      failures.push(`Transcript: ${(e && e.message) || e}`);
      continue;
    }

    await patchItem(resolved.id, { status: STATUS.IMPORTING });
    const res = await sendToTab(
      notebookTabId,
      { type: MSG.NLM_ADD_TEXT, title: prepared.title, text: prepared.text },
      180000
    );
    if (res.ok) {
      await dropText(resolved.id);
      return { ok: true, mode, verified: res.verified === true, unverified: res.unverified || null };
    }
    if (res.limit) return { ok: false, mode, error: res.error, fatal: true };
    if (res.sourceAdded) return { ok: false, mode, error: res.error }; // xem ghi chú ở nhánh 'url'
    failures.push(`Dán text: ${res.error}`);
  }

  return { ok: false, error: failures.join(' | ') || 'Không rõ nguyên nhân' };
}

/* -------------------------------------------------------------------- */
/* trang tài liệu                                                        */
/* -------------------------------------------------------------------- */

/**
 * Trích nội dung một trang tài liệu, hai nấc.
 *
 * Nấc 1 là fetch từ một tab cùng origin: không tải lại trang nào nên import 80
 * trang chỉ tốn 80 request thay vì 80 lần dựng trang.
 * Nấc 2 mới mở tab ẩn — chỉ khi nấc 1 trả về nội dung mỏng bất thường, dấu hiệu
 * kinh điển của docs render bằng JS (fetch chỉ nhận được cái khung rỗng).
 */
async function prepareDoc(item, settings) {
  await patchItem(item.id, { status: STATUS.EXTRACTING, error: null });

  const floor = Math.max(1, Number(settings.docsMinChars) || 0);
  const failures = [];
  let best = null;

  try {
    const tabId = await docsFetchTab(item.url);
    if (tabId != null) {
      const res = await sendToTab(tabId, { type: MSG.DOCS_FETCH, url: item.url }, 60000);
      if (res.ok) best = { doc: res.doc, method: 'fetch' };
      else failures.push(`fetch: ${res.error}`);
    }
  } catch (e) {
    failures.push(`fetch: ${(e && e.message) || e}`);
  }

  if (!best || best.doc.chars < floor) {
    try {
      const tabId = await docsRenderTab(item.url);
      const res = await sendToTab(tabId, { type: MSG.DOCS_READ, url: item.url, timeout: 10000 }, 90000);
      if (res.ok && (!best || res.doc.chars > best.doc.chars)) best = { doc: res.doc, method: 'tab' };
      else if (!res.ok) failures.push(`tab: ${res.error}`);
    } catch (e) {
      failures.push(`tab: ${(e && e.message) || e}`);
    }
  }

  if (!best) throw new Error(failures.join(' || ') || 'Không trích được nội dung');
  if (!best.doc.chars) {
    throw new Error(`Trang không có nội dung đọc được${failures.length ? ` (${failures.join(' || ')})` : ''}`);
  }

  // Tiêu đề/mục do sidebar cung cấp đáng tin hơn <h1> của trang, giữ làm ưu tiên.
  const meta = {
    url: item.url,
    title: item.title || best.doc.title,
    site: item.site || best.doc.site,
    section: item.section || best.doc.section,
    method: `${best.method}:${best.doc.how}`,
  };
  const text = buildDocsSourceText(meta, best.doc.markdown, settings);

  await storeText(item.id, text);
  await patchItem(item.id, { textLength: text.length, title: meta.title, site: meta.site });
  return { text, title: docsSourceTitle(meta) };
}

/** Chiến lược cho trang tài liệu. Mặc định dán text — link gần như luôn hỏng. */
function docsPlan(settings) {
  switch (settings.docsMode) {
    case 'url': return ['url'];
    case 'url-then-text': return ['url', 'text'];
    case 'text-then-url': return ['text', 'url'];
    default: return ['text'];
  }
}

async function importDoc(item, settings, notebookTabId) {
  const plan = docsPlan(settings);
  const failures = [];

  for (const mode of plan) {
    await patchItem(item.id, { mode, status: STATUS.IMPORTING });

    if (mode === 'url') {
      const res = await sendToTab(
        notebookTabId,
        { type: MSG.NLM_ADD_URL, url: item.url, label: item.title || item.url },
        150000
      );
      if (res.ok) return { ok: true, mode, verified: res.verified === true, unverified: res.unverified || null };
      if (res.limit) return { ok: false, mode, error: res.error, fatal: true };
      // Nguồn ĐÃ vào notebook (chỉ là không đúng 1). Rơi sang đường kế tiếp là
      // thêm lần nữa — thao tác này không idempotent, bản trùng phải xoá tay.
      if (res.sourceAdded) return { ok: false, mode, error: res.error };
      failures.push(`URL: ${res.error}`);
      continue;
    }

    let prepared;
    try {
      const cached = await loadText(item.id);
      prepared = cached ? { text: cached, title: docsSourceTitle(item) } : await prepareDoc(item, settings);
    } catch (e) {
      failures.push(`Trích nội dung: ${(e && e.message) || e}`);
      continue;
    }

    await patchItem(item.id, { status: STATUS.IMPORTING });
    const res = await sendToTab(
      notebookTabId,
      { type: MSG.NLM_ADD_TEXT, title: prepared.title, text: prepared.text },
      180000
    );
    if (res.ok) {
      await dropText(item.id);
      return { ok: true, mode, verified: res.verified === true, unverified: res.unverified || null };
    }
    if (res.limit) return { ok: false, mode, error: res.error, fatal: true };
    if (res.sourceAdded) return { ok: false, mode, error: res.error }; // xem ghi chú ở nhánh 'url'
    failures.push(`Dán text: ${res.error}`);
  }

  return { ok: false, error: failures.join(' | ') || 'Không rõ nguyên nhân' };
}

/* -------------------------------------------------------------------- */
/* vòng lặp                                                              */
/* -------------------------------------------------------------------- */

/**
 * MỘT Lượt chạy: xử lý hết Hàng đợi một mạch, không đòi bấm gì giữa chừng.
 *
 * Trước ticket 003 còn một chế độ chạy thứ hai (chỉ tải về đĩa) với `targets`,
 * `cursor` và `index` sống trong RAM. Bỏ hẳn nó, chứ không vá: tiến độ giờ nằm
 * đúng ở nơi vốn đã sống sót qua mọi lần Chrome ngắt service worker — `status`
 * của từng Mục và `savedFile` của từng Mục, cả hai trong chrome.storage.
 */
async function runQueue() {
  if (runner) return runner;
  stopRequested = false;
  runner = (async () => {
    await chrome.storage.local.set({ [KEYS.RUNNING]: true });
    // 0.5 phút là mốc tối thiểu Chrome chấp nhận; đặt thấp hơn thì bị kẹp lại
    // hoặc bỏ qua, mà alarm này chính là thứ đánh thức lại hàng đợi sau khi
    // Chrome ngắt service worker.
    await chrome.alarms.create('nblm-keepalive', { periodInMinutes: 0.5 });

    // Mục kẹt ở 'extracting'/'importing' là dấu vết của lượt chạy bị ngắt giữa
    // chừng — không có ai đang xử lý chúng nữa. Trả về 'pending' để được làm lại.
    const stale = await getQueue();
    const stuck = stale.filter((i) => i.status === STATUS.EXTRACTING || i.status === STATUS.IMPORTING);
    if (stuck.length) {
      for (const i of stuck) i.status = STATUS.PENDING;
      await setQueue(stale);
    }

    let done = 0;
    let failed = 0;
    let notebookTabId = null;

    try {
      const settings = await getSettings();
      notebookTabId = await resolveNotebookTab();

      for (;;) {
        if (stopRequested) break;
        const queue = await getQueue();

        const item = queue.find((i) => i.status === STATUS.PENDING) || null;
        if (!item) break;

        try {
          // Bản sao xuống đĩa đi TRƯỚC, và với trần giờ RIÊNG (xem copyStep).
          // Trước vì nó trích sẵn Transcript vào storage, nên nhánh dán text ngay
          // sau đó dùng lại được, không trích hai lần.
          await copyStep(item, settings);

          // Chặn giờ cho từng mục. Không có nó thì một mục treo là cả hàng đợi
          // đứng im vĩnh viễn ở trạng thái 'extracting' — không lỗi, không tiến
          // triển, không dấu vết. Thà bỏ mục đó kèm thông báo rõ rồi đi tiếp.
          const result = await Promise.race([
            importItem(item, settings, notebookTabId),
            sleep(ITEM_TIMEOUT_MS).then(() => ({
              ok: false,
              error: `Quá ${Math.round(ITEM_TIMEOUT_MS / 1000)}s không xong — bỏ qua để chạy tiếp mục sau.`,
            })),
          ]);
          if (result.ok) {
            done++;
            // Hai nguồn nghi ngờ khác nhau gặp nhau ở đúng chỗ này, và cùng đi ra
            // một cửa vì với người đọc chúng là một câu: "đã xong nhưng không dám
            // chắc". Một là NotebookLM không đối chiếu được số Nguồn (ticket 002),
            // hai là bản chép lời thiếu phần đuôi (ticket 003).
            //
            // Cái thứ hai CHỈ tính khi bản chép lời đó chính là thứ đã thành Nguồn
            // (mode 'text'). Đi đường link thì Nguồn là do NotebookLM tự đọc từ
            // YouTube, transcript cụt đuôi của ta không nói được gì về nó — kêu
            // "chưa xác minh được" ở đó là báo động giả, và báo động giả ăn mòn
            // đúng tín hiệu mà ticket 002 vừa dựng lên. Chỗ cụt ấy thuộc về file
            // trên đĩa, và `copyStep` đã ghi nó vào `copyError` rồi.
            const fresh = (await getQueue()).find((i) => i.id === item.id) || {};
            const cutDuoiNguon = result.mode === 'text' ? fresh.truncated || null : null;
            const lyDo = [cutDuoiNguon, result.unverified].filter(Boolean);
            await patchItem(item.id, {
              status: STATUS.DONE,
              mode: result.mode,
              verified: result.verified === true && !cutDuoiNguon,
              unverified: lyDo.length ? lyDo.join(' ') : null,
              error: null,
            });
            // Nguồn đã vào rồi thì bản nháp trong storage hết việc. Nhánh dán text
            // tự dọn phần của nó; nhánh url thì không, mà từ ticket 003 nhánh url
            // cũng có thể đã trích transcript sẵn cho Bản sao xuống đĩa.
            await dropText(item.id);
          } else {
            failed++;
            await patchItem(item.id, {
              status: STATUS.ERROR,
              error: result.error,
              attempts: (item.attempts || 0) + 1,
            });
            if (result.fatal) {
              await note('Dừng hàng đợi', `NotebookLM báo: ${result.error}`);
              break;
            }
          }
        } catch (e) {
          failed++;
          await patchItem(item.id, {
            status: STATUS.ERROR,
            error: (e && e.message) || String(e),
            attempts: (item.attempts || 0) + 1,
          });
        }

        await sleep(Math.max(300, Number(settings.delayMs) || DEFAULTS.delayMs));
      }
    } catch (e) {
      await note('Không chạy được hàng đợi', (e && e.message) || String(e));
    } finally {
      await releaseHelperTab();
      await releaseDocsTab();
      await chrome.alarms.clear('nblm-keepalive');
      await chrome.storage.local.set({ [KEYS.RUNNING]: false });
      await refreshBadge();
      notifyPopup();
      runner = null;

      if (done || failed) {
        const summary = `${done} nguồn đã thêm${failed ? `, ${failed} lỗi` : ''}`;
        await note('Import xong', summary);
        if (notebookTabId != null) {
          chrome.tabs
            .sendMessage(notebookTabId, { type: 'nblm-hud', message: summary, done: true })
            .catch(() => {});
        }
      }
    }
  })();
  return runner;
}

async function note(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `YouTube → NotebookLM — ${title}`,
      message: String(message).slice(0, 300),
    });
  } catch (_) {
    /* thông báo không quan trọng tới mức làm hỏng luồng */
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  // Chỉ để service worker khỏi bị ngủ giữa chừng khi hàng đợi đang chạy.
  if (alarm.name === 'nblm-keepalive' && !runner) {
    chrome.storage.local.get(KEYS.RUNNING).then((got) => {
      // Chỉ còn một kiểu Lượt chạy nên không có chế độ nào để hồi phục nhầm. Mục
      // đang dở dang được nhận ra qua `status` trong Hàng đợi, không qua biến RAM.
      if (got[KEYS.RUNNING]) runQueue();
    });
  }
});

/* -------------------------------------------------------------------- */
/* thu gom hàng loạt                                                     */
/* -------------------------------------------------------------------- */

async function activeTab(tabId) {
  if (tabId != null) return chrome.tabs.get(tabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** "(3) Tiêu đề video - YouTube" -> "Tiêu đề video" */
function cleanTabTitle(title) {
  return String(title || '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*-\s*YouTube\s*$/, '')
    .trim();
}

/** Gom mọi tab YouTube đang mở thành hàng đợi. */
async function collectFromTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*'] });
  const seen = new Set();
  const items = [];

  for (const tab of tabs) {
    const videoId = videoIdFrom(tab.url || '');
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    items.push({ videoId, title: cleanTabTitle(tab.title) });
  }
  if (!items.length) return { added: 0, error: 'Không có tab YouTube nào đang mở một video.' };

  const result = await enqueue(items);
  return Object.assign({ found: items.length }, result);
}

/**
 * Quét mọi link YouTube trên một trang bất kỳ.
 *
 * Dùng executeScript thay vì content script riêng: script tài liệu đã chạy trên
 * mọi trang http(s) rồi, thêm cái nữa là hai script cùng quét một DOM. Hàm tiêm
 * xuống cố tình chỉ thu href thô — việc bóc videoId để nguyên một chỗ trong
 * parseUrlList, khỏi phải nhân bản logic sang ngữ cảnh trang.
 */
async function collectFromPage(tabId) {
  const tab = await activeTab(tabId);
  if (!tab) return { added: 0, error: 'Không tìm thấy tab đang mở.' };

  let hrefs = [];
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.querySelectorAll('a[href]'), (a) => a.href),
    });
    hrefs = (frame && frame.result) || [];
  } catch (e) {
    return { added: 0, error: `Không đọc được trang này (${(e && e.message) || e}).` };
  }

  const ids = parseUrlList(hrefs.join('\n'));
  if (!ids.length) return { added: 0, error: 'Không thấy link YouTube nào trên trang này.' };

  const result = await enqueue(ids.map((videoId) => ({ videoId })));
  return Object.assign({ found: ids.length }, result);
}

/** Import toàn bộ playlist/kênh mà tab hiện tại đang mở. */
async function importPlaylistOfTab(tabId) {
  const tab = await activeTab(tabId);
  if (!tab || !/^https:\/\/www\.youtube\.com\//.test(tab.url || '')) {
    return { added: 0, error: 'Tab hiện tại không phải trang YouTube.' };
  }

  await ensureScripts(tab.id, 'youtube');
  const ctx = await sendToTab(tab.id, { type: MSG.YT_CONTEXT }, 30000);
  const context = ctx && ctx.context;
  if (!ctx.ok || !context || !context.playlistId) {
    return { added: 0, error: 'Tab hiện tại không phải playlist hay trang kênh.' };
  }

  const settings = await getSettings();
  const res = await sendToTab(
    tab.id,
    { type: MSG.YT_PLAYLIST, playlistId: context.playlistId, max: settings.maxBulkVideos },
    180000
  );
  if (!res.ok) return { added: 0, error: res.error };

  const all = res.items || [];
  const usable = all.filter((i) => i.accessible);
  if (!usable.length) return { added: 0, error: 'Không có video nào import được trong danh sách này.' };

  const result = await enqueue(
    usable.map((i) => ({
      videoId: i.videoId,
      title: i.title,
      channel: i.channel,
      durationSec: i.durationSec,
      privacy: i.privacy,
    }))
  );
  return Object.assign(
    { found: usable.length, blocked: all.length - usable.length, truncated: !!res.truncated, title: context.title },
    result
  );
}

/* -------------------------------------------------------------------- */
/* router                                                                */
/* -------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case MSG.ENQUEUE: {
          const result = await enqueue(message.items || []);
          if (message.autoRun !== false && result.added) runQueue();
          sendResponse(result);
          return;
        }

        case MSG.GET_STATE: {
          const [queue, settings, running] = await Promise.all([
            getQueue(),
            getSettings(),
            chrome.storage.local.get(KEYS.RUNNING),
          ]);
          sendResponse({ queue, settings, running: !!running[KEYS.RUNNING] || !!runner });
          return;
        }

        case MSG.RUN:
          runQueue();
          sendResponse({ ok: true });
          return;

        case MSG.STOP:
          stopRequested = true;
          sendResponse({ ok: true });
          return;

        case MSG.RETRY: {
          const queue = await getQueue();
          for (const item of queue) {
            if (!message.id || item.id === message.id) {
              if (item.status === STATUS.ERROR) {
                item.status = STATUS.PENDING;
                item.error = null;
              }
            }
          }
          await setQueue(queue);
          await refreshBadge(queue);
          notifyPopup();
          runQueue();
          sendResponse({ ok: true });
          return;
        }

        case MSG.REMOVE: {
          const queue = await getQueue();
          await setQueue(queue.filter((i) => i.id !== message.id));
          await dropText(message.id);
          await refreshBadge();
          notifyPopup();
          sendResponse({ ok: true });
          return;
        }

        case MSG.CLEAR_DONE: {
          const queue = await getQueue();
          const keep = queue.filter((i) => i.status !== STATUS.DONE);
          await Promise.all(
            queue.filter((i) => i.status === STATUS.DONE).map((i) => dropText(i.id))
          );
          await setQueue(keep);
          await refreshBadge(keep);
          notifyPopup();
          sendResponse({ ok: true });
          return;
        }

        case MSG.CLEAR_ALL: {
          const queue = await getQueue();
          await Promise.all(queue.map((i) => dropText(i.id)));
          await setQueue([]);
          await refreshBadge([]);
          notifyPopup();
          sendResponse({ ok: true });
          return;
        }

        case MSG.OPEN_OPTIONS:
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          return;

        case MSG.OPEN_DOCS_PANEL:
          sendResponse(await openDocsPanel(message.tabId));
          return;

        case MSG.COLLECT_TABS:
          sendResponse(await collectFromTabs());
          return;

        case MSG.COLLECT_PAGE_LINKS:
          sendResponse(await collectFromPage(message.tabId));
          return;

        case MSG.IMPORT_PLAYLIST:
          sendResponse(await importPlaylistOfTab(message.tabId));
          return;

        default:
          sendResponse({ error: `lệnh lạ: ${message.type}` });
      }
    } catch (e) {
      sendResponse({ error: (e && e.message) || String(e) });
    }
  })();
  return true;
});

/* -------------------------------------------------------------------- */
/* bảng chọn link tài liệu                                               */
/* -------------------------------------------------------------------- */

/**
 * Mở bảng chọn trên một tab bất kỳ.
 * Tab mở từ trước khi cài extension chưa có content script, nên `ensureScripts`
 * tiêm tay — đây cũng là lý do bảng vẫn bật được mà không cần tải lại trang.
 */
/**
 * Trang extension đã có giao diện riêng. Tiêm thêm script tài liệu vào đây là
 * đặt hai content script lên cùng một tab, và `exclude_matches` trong manifest
 * KHÔNG chặn được `chrome.scripting.executeScript` — nó chỉ chi phối lúc Chrome
 * tự tiêm. Đây chính là cách tab NotebookLM bị hỏng: script tài liệu trả lời
 * `nlm-ping` trước, background đọc phải phản hồi sai, và mọi lần import sau đó
 * đều chết cho tới khi tải lại tab.
 */
const OWN_PAGES = /^https?:\/\/([\w-]+\.)*youtube\.com\/|^https:\/\/notebooklm\.google\.com\//i;

async function openDocsPanel(tabId) {
  let tab;
  if (tabId != null) tab = await chrome.tabs.get(tabId);
  else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !/^https?:/.test(tab.url || '')) {
    return { error: 'Tab hiện tại không phải trang web đọc được (chrome://, file:// … không hỗ trợ).' };
  }
  if (OWN_PAGES.test(tab.url)) {
    return { error: 'Trang này đã có giao diện riêng của extension — bảng chọn tài liệu không dùng ở đây.' };
  }
  await ensureScripts(tab.id, 'docs');
  const res = await sendToTab(tab.id, { type: MSG.DOCS_PANEL }, 15000);
  if (!res.hasSidebar) {
    return { ok: true, hasSidebar: false, error: 'Không dò thấy sidebar tài liệu trên trang này.' };
  }
  return { ok: true, hasSidebar: true, count: res.count };
}

/* -------------------------------------------------------------------- */
/* menu chuột phải + phím tắt                                            */
/* -------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'nblm-docs-panel',
      title: 'Chọn link tài liệu để đưa vào NotebookLM…',
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    chrome.contextMenus.create({
      id: 'nblm-docs-link',
      title: 'Thêm trang tài liệu này vào NotebookLM',
      contexts: ['link'],
      targetUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    chrome.contextMenus.create({
      id: 'nblm-link',
      title: 'Thêm link YouTube này vào NotebookLM',
      contexts: ['link'],
      targetUrlPatterns: ['*://*.youtube.com/*', '*://youtu.be/*'],
    });
    chrome.contextMenus.create({
      id: 'nblm-page',
      title: 'Thêm video này vào NotebookLM',
      contexts: ['page'],
      documentUrlPatterns: ['*://www.youtube.com/watch*', '*://www.youtube.com/shorts/*'],
    });
    chrome.contextMenus.create({
      id: 'nblm-selection',
      title: 'Thêm các link YouTube trong vùng chọn',
      contexts: ['selection'],
    });
  });
  refreshBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'nblm-docs-panel') {
    const res = await openDocsPanel(tab && tab.id);
    if (res.error) await note('Bảng chọn link', res.error);
    return;
  }

  if (info.menuItemId === 'nblm-docs-link') {
    // Link YouTube trong menu này vẫn nên đi đường video, không đi đường tài liệu.
    const videoId = videoIdFrom(info.linkUrl);
    const item = videoId ? { videoId } : { kind: KIND.DOCS, url: info.linkUrl, title: info.linkText || '' };
    const result = await enqueue([item]);
    if (result.added) runQueue();
    else await note('Đã có trong hàng đợi', 'Trang này đã nằm trong hàng đợi rồi.');
    return;
  }

  let ids = [];
  if (info.menuItemId === 'nblm-link') ids = [videoIdFrom(info.linkUrl)].filter(Boolean);
  else if (info.menuItemId === 'nblm-page') ids = [videoIdFrom(info.pageUrl || (tab && tab.url))].filter(Boolean);
  else if (info.menuItemId === 'nblm-selection') ids = parseUrlList(info.selectionText);

  if (!ids.length) {
    await note('Không tìm thấy link', 'Không nhận ra video YouTube nào từ lựa chọn đó.');
    return;
  }
  const result = await enqueue(ids.map((videoId) => ({ videoId })));
  if (result.added) runQueue();
  else await note('Đã có trong hàng đợi', 'Các video này đã nằm trong hàng đợi rồi.');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-docs-panel') {
    const res = await openDocsPanel(null);
    if (res.error) await note('Bảng chọn link', res.error);
    return;
  }

  if (command !== 'send-current-video') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const videoId = videoIdFrom(tab && tab.url);
  if (!videoId) {
    await note('Không phải trang video', 'Phím tắt chỉ dùng được trên trang xem video YouTube.');
    return;
  }
  const result = await enqueue([{ videoId }]);
  if (result.added) runQueue();
});

// Xuất ra để test (và DevTools console) quan sát được phần chờ-ghi-xong-file;
// đây là chỗ duy nhất trong service worker có kết quả không suy ra được từ storage.
self.NBLM_SW_INTERNALS = { awaitDownloadComplete, saveFile, runQueue, DOWNLOAD_TIMEOUT_MS, ITEM_TIMEOUT_MS };

chrome.tabs.onRemoved.addListener((tabId) => {
  if (helper.tabId === tabId) {
    helper.tabId = null;
    helper.owned = false;
  }
  if (docsHelper.tabId === tabId) {
    docsHelper.tabId = null;
    docsHelper.origin = null;
  }
});

refreshBadge();
