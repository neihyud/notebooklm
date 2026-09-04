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
importScripts(
  '/src/common/shared.js',
  '/src/youtube/srt.js',
  // Ba file dưới đây để service worker gọi thẳng batchexecute được, KHÔNG cần
  // một tab NotebookLM nào đang mở (ticket 013). `rpc.js` nạp được ở đây vì nó
  // không đụng `document` lúc nạp — chỉ trong thân hàm, và luôn qua tham số ghi
  // đè được. `selectors.js` đi kèm vì `rpc.js` dùng đúng hàm `merge` của nó.
  '/src/notebooklm/selectors.js',
  '/src/notebooklm/rpc.js',
  '/src/common/google-accounts.js'
);

const {
  MSG, STATUS, PRIVACY, KIND, KEYS, DEFAULTS,
  getSettings, setSettings, getQueue, setQueue, getCopiedLog,
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
    // rpc.js nằm SAU automation.js và TRƯỚC content.js: nó bọc lại
    // `NBLM_AUTOMATION.addUrlSource`/`addTextSource`, nên phải thấy bản gốc đã
    // dựng xong, và phải bọc xong trước khi content.js giữ tham chiếu tới nó.
    isolated: [
      'src/common/shared.js',
      'src/notebooklm/selectors.js',
      'src/notebooklm/automation.js',
      'src/notebooklm/rpc.js',
      'src/notebooklm/content.js',
    ],
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

/**
 * Một tab NotebookLM BẤT KỲ — không cần đang ở trong một notebook.
 *
 * Khác `resolveNotebookTab()` ở hai điểm, và cả hai là quyết định đã chốt trong
 * `docs/tickets/011-*.md`:
 *
 *   - **Không mở tab mới.** Đường (a): không có tab sẵn thì trả `null`, giao
 *     diện tự biết phải hiện "Mở NotebookLM…". Mở hộ một tab nền rồi đóng đi là
 *     đường (b), owner chưa chốt.
 *   - **Không cần `/notebook/<id>`.** Hai lượt gốc gửi `source-path=/`, nên
 *     trang chủ NotebookLM cũng đủ.
 */
async function anyNotebookLmTab(wantAuthuser) {
  let tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
  /*
   * Lọc theo tài khoản khi biết mình đang nhắm tài khoản nào.
   *
   * Đường tab dùng token của CHÍNH tab đó, nên nó luôn ghi vào tài khoản của
   * tab — không có cách nào bảo nó nhắm tài khoản khác. Lùi từ đường thẳng
   * sang đường tab mà không lọc chỗ này là: owner chọn tài khoản A, dropdown
   * hiện A, còn danh sách bên dưới là của B. Đúng kiểu hỏng im lặng mà
   * ticket 013 tồn tại để chặn.
   */
  if (wantAuthuser != null) {
    const want = String(wantAuthuser);
    tabs = tabs.filter((t) => tabAuthuser(t) === want);
  }
  if (!tabs.length) return null;
  // Ưu tiên tab đang ở trong một notebook: nó chắc chắn đã nạp xong phiên và có
  // `WIZ_global_data`. Trang chủ vẫn dùng được, chỉ là lựa chọn thứ hai.
  const tab = tabs.find((t) => /\/notebook\/[^/]+/.test(t.url || '')) || tabs[0];
  try {
    await ensureScripts(tab.id, 'notebooklm');
  } catch (_) {
    return null;
  }
  return tab.id;
}

/* ------------------------------------------------------------------ */
/* tài khoản Google và `authuser` — ticket 013                          */
/* ------------------------------------------------------------------ */

const ACC = self.NBLM_ACCOUNTS;
const RPC = self.NBLM_RPC;

/** Đẩy `accountOverrides` của owner vào module trước mỗi lượt dùng. */
async function configureAccounts() {
  const s = await getSettings();
  ACC.configure(s.accountOverrides);
  return s;
}

/**
 * Danh sách tài khoản Google đang đăng nhập.
 *
 * Mảng rỗng KHÔNG phải lỗi cần báo động: nó chỉ nghĩa là dropdown tài khoản ẩn
 * đi và mọi thứ còn lại chạy y như trước ticket 013. Đây là điều kiện đảo ngược
 * số 1 — `ListAccounts` đổi hình dạng thì ta lùi chứ không hỏng.
 */
async function listAccounts() {
  const s = await configureAccounts();
  const r = await ACC.detectAccounts();
  return {
    ok: r.ok,
    accounts: r.accounts,
    selected: s.nlmAccount || null,
    status: r.status,
  };
}

/**
 * `authuser` của một tab, theo MỘT luật duy nhất cho cả đường liệt kê lẫn
 * đường import: URL không nói gì thì coi là `'0'`.
 *
 * Suy đoán đó có thể sai (tab của tài khoản 1 vẫn hay hiện URL trần), và cái
 * giá khi sai là một lượt điều hướng thừa — đổi lại, một tab NÓI RÕ tài khoản
 * khác thì không bao giờ bị nhận nhầm. Đó là chiều hỏng đắt hơn hẳn.
 */
function tabAuthuser(tab) {
  return authuserFromUrl((tab && tab.url) || '') || '0';
}

/** Gắn `authuser` vào một URL notebooklm; URL hỏng thì trả nguyên. */
function withAuthuser(url, authuser) {
  try {
    const u = new URL(url);
    u.searchParams.set('authuser', String(authuser));
    return u.toString();
  } catch (_) {
    return url;
  }
}

/** `authuser` đọc ra từ URL của một tab, hoặc `null`. */
function authuserFromUrl(url) {
  try {
    const v = new URL(url).searchParams.get('authuser');
    return v == null || v === '' ? null : v;
  } catch (_) {
    return null;
  }
}

/**
 * Đổi tài khoản — MỘT chỗ duy nhất biết việc đó kéo theo những gì.
 *
 * Trước đây kỷ luật này nằm trong handler của popup, nên trang Cài đặt sửa
 * thẳng `nlmAccount` là đi vòng qua cả ba bước. Chép kỷ luật sang UI thứ hai
 * chỉ dời chỗ hỏng sang UI thứ ba; đặt nó ở đây thì mọi đường đổi tài khoản
 * đều đi qua cùng một chỗ.
 *
 * `notebookUrl` phải xoá vì id notebook thuộc về tài khoản CŨ. Còn
 * `clearRpcContext` thì không phải vì tính đúng đắn — `usable()` đã chặn ca
 * token-chéo-tài-khoản bằng cấu trúc — mà để không giữ trên đĩa một token
 * không còn ai dùng.
 */
async function doiTaiKhoan(email, opts) {
  const patch = { nlmAccount: email };
  // Giữ `notebookUrl` khi CHÍNH lượt ghi đó đã tự đặt nó: owner đổi cả tài
  // khoản lẫn notebook trong một cú Lưu thì họ đang cố ý, chứ không phải để
  // sót một URL của tài khoản cũ.
  if (!(opts && opts.giuUrl)) patch.notebookUrl = '';
  await setSettings(patch);
  await ACC.clearRpcContext();
  return email;
}

/*
 * Đường thứ hai vào `doiTaiKhoan`: ai đó ghi thẳng `nlmAccount` xuống settings
 * mà không qua `SELECT_ACCOUNT` — hôm nay là trang Cài đặt, mai có thể là chỗ
 * khác. So `oldValue`/`newValue` nên lượt ghi của chính `doiTaiKhoan` không tự
 * kích lại nó (lúc đó `nlmAccount` không đổi).
 */
if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes || !changes[KEYS.SETTINGS]) return;
    const c = changes[KEYS.SETTINGS];
    const truoc = (c.oldValue || {}).nlmAccount || null;
    const sau = (c.newValue || {}).nlmAccount || null;
    if (truoc === sau) return;
    const giuUrl = (c.oldValue || {}).notebookUrl !== (c.newValue || {}).notebookUrl;
    doiTaiKhoan(sau, { giuUrl }).catch(() => {});
  });
}

/**
 * Tài khoản nào sẽ nhận request — và ta biết chắc tới đâu.
 *
 * Ba mức, cố ý phân biệt rõ vì chúng dẫn tới ba câu khác nhau trong giao diện:
 *   - `chosen`  — owner đã chọn, và `ListAccounts` ánh xạ được ra chỉ số.
 *   - `tab`     — chưa chọn, nhưng có tab đang mở và tab đó nói `authuser` nào.
 *   - `default` — không biết gì; dùng `0` và PHẢI nói ra là đang dùng mặc định.
 */
async function resolveAuthuser() {
  const s = await configureAccounts();
  const want = (s.nlmAccount || '').toLowerCase();
  if (want) {
    const r = await ACC.detectAccounts();
    const hit = r.accounts.find((a) => a.email === want);
    if (hit) return { authuser: String(hit.index), source: 'chosen', email: hit.email };
    // Đã chọn mà không tìm thấy: tài khoản đã đăng xuất, hoặc ListAccounts hỏng.
    // KHÔNG lặng lẽ rơi về `0` — đó đúng là ca ghi vào nhầm tài khoản.
    return { authuser: null, source: 'chosen-missing', email: want };
  }
  const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
  for (const t of tabs) {
    const au = authuserFromUrl(t.url || '');
    if (au != null) return { authuser: au, source: 'tab', email: null };
  }
  return { authuser: '0', source: 'default', email: null };
}

/**
 * Gọi một lượt RPC GỐC thẳng từ service worker — không cần tab nào mở.
 *
 * Đây là thứ ticket 013 mua bằng việc lưu token: `getRpcContext()` trả token
 * ĐÃ GẮN với đúng `authuser` này, và `rootAttempt` nhận cả hai cùng lúc nên
 * không có khe nào để chúng lệch nhau.
 */
async function rootCall(run) {
  const who = await resolveAuthuser();
  if (who.authuser == null) {
    return { ok: false, status: 'account-missing', account: who };
  }
  const ctx = await ACC.getRpcContext(who.authuser);
  if (!ctx.ok) return { ok: false, status: ctx.status, account: who };

  const r = await run({
    at: ctx.at,
    authuser: ctx.authuser,
    origin: ACC.config.origins[0],
    // Cross-origin từ service worker, nên BUỘC phải 'include'. Đường content
    // script vẫn giữ 'same-origin' — xem `attemptOnce`.
    credentials: 'include',
  });
  return Object.assign({ account: who }, r);
}

/**
 * Danh sách notebook cho dropdown trong popup.
 *
 * KHÔNG ném, và không đụng `settings.notebookUrl`. `ok:false` + `needsTab` là
 * cách giao diện phân biệt "chưa mở NotebookLM" với "đã mở nhưng chưa có
 * notebook nào" — hai câu dẫn tới hai hành động khác nhau của owner.
 */
async function listNotebooks() {
  // Đường thẳng trước: không cần tab nào mở. Hỏng thì lùi về đường tab, vì
  // đường tab không phụ thuộc `ListAccounts` lẫn token cache — nó là lưới an
  // toàn cho cả hai điều kiện đảo ngược 1 và 2 của ticket 013.
  const direct = await rootCall((o) => RPC.listNotebooks(o));
  const acc = direct.account || null;
  if (direct.ok) {
    return { ok: true, notebooks: direct.notebooks || [], needsTab: false, status: 'ok', account: acc };
  }

  // Chỉ nhận tab CÙNG tài khoản đang nhắm. Không biết nhắm ai (`account-missing`)
  // thì không lọc được, và cũng không được đoán bừa — trả về để owner chọn lại.
  if (!acc || acc.authuser == null) {
    return { ok: false, notebooks: [], needsTab: false, status: direct.status || 'account-missing', account: acc };
  }
  const tabId = await anyNotebookLmTab(acc.authuser);
  if (tabId == null) {
    return { ok: false, notebooks: [], needsTab: true, status: direct.status || 'no-tab', account: acc };
  }
  try {
    const r = await sendToTab(tabId, { type: MSG.NLM_LIST_NOTEBOOKS }, 20000);
    return {
      ok: !!(r && r.ok),
      notebooks: (r && r.notebooks) || [],
      needsTab: false,
      status: (r && r.status) || 'no-reply',
      account: acc,
    };
  } catch (e) {
    return { ok: false, notebooks: [], needsTab: false, status: 'tab-error', account: acc };
  }
}

/**
 * Tạo notebook. LƯỢT GHI DUY NHẤT của đường này.
 *
 * Ghi thẳng `settings.notebookUrl` khi thành công. Bỏ bước đó thì owner bấm
 * tạo lần nữa và tài khoản có hai notebook rỗng — chế độ hỏng dễ xảy ra nhất
 * của tính năng này, và nó im lặng.
 *
 * Ghi CHỈ khi có id thật. `notebook-limit` và `created-but-no-id` đều không ghi.
 */
async function createNotebook(title) {
  const name = String(title == null ? '' : title).trim();
  if (!name) return { ok: false, notebookId: null, status: 'no-title' };

  let r = await rootCall((o) => RPC.createNotebook(name, o));
  if (!r.ok) {
    /*
     * LÙI CÓ ĐIỀU KIỆN, và điều kiện chặt hơn ở đường liệt kê rất nhiều.
     *
     * Tạo notebook KHÔNG idempotent. `created-but-no-id` nghĩa là notebook có
     * thể đã tạo xong rồi mà ta không đọc được id; lùi sang đường tab lúc đó là
     * tạo cái thứ HAI, và owner phải xoá tay. `notebook-limit` thì lùi cũng vô
     * ích vì trần là của tài khoản, không phải của đường đi.
     *
     * Nên chỉ lùi với những trạng thái CHỨNG MINH được là chưa có byte nào rời
     * máy. Cùng một luật mà `outcomeFor` áp cho đường thêm Nguồn, chỉ khác là ở
     * đây viết ra tường minh vì từ vựng trạng thái của lượt tạo khác.
     */
    const CHUA_GUI = new Set(['no-fetch', 'no-at-token', 'rpc-id-stale', 'http-client-error', 'not-batchexecute']);
    const acc = r.account || null;
    if (!CHUA_GUI.has(r.status) || !acc || acc.authuser == null) {
      return {
        ok: false, notebookId: null, limit: !!r.limit,
        status: r.status || 'no-reply', account: acc,
      };
    }
    const tabId = await anyNotebookLmTab(acc.authuser);
    if (tabId == null) {
      return { ok: false, notebookId: null, needsTab: true, status: r.status || 'no-tab', account: acc };
    }
    try {
      r = await sendToTab(tabId, { type: MSG.NLM_CREATE_NOTEBOOK, title: name }, 30000);
    } catch (_) {
      return { ok: false, notebookId: null, status: 'tab-error', account: acc };
    }
  }
  if (!r || !r.ok || typeof r.notebookId !== 'string' || !r.notebookId) {
    return { ok: false, notebookId: null, limit: !!(r && r.limit), status: (r && r.status) || 'no-reply' };
  }

  const url = `https://notebooklm.google.com/notebook/${r.notebookId}`;
  await setSettings({ notebookUrl: url });
  return { ok: true, notebookId: r.notebookId, url, status: 'ok' };
}

async function resolveNotebookTab() {
  const settings = await getSettings();
  const target = (settings.notebookUrl || '').trim();

  /*
   * ĐƯỜNG GHI cũng phải ghim tài khoản — không chỉ đường liệt kê.
   *
   * Trước bản này, chỗ đây nhận BẤT KỲ tab notebooklm nào. Nên owner chọn `b@`,
   * dropdown hiện `b@`, mà nếu đang mở một tab của `a@` thì Nguồn đi thẳng vào
   * `a@` — im lặng, vì content script dùng token của chính tab nó đang ở, và
   * không có cách nào bảo nó nhắm tài khoản khác. `anyNotebookLmTab` đã lọc từ
   * đầu; đường này thì không, và đây mới là đường thật sự GHI.
   *
   * Chỉ ghim khi owner ĐÃ CHỌN. `tab`/`default` là ta suy ra, không phải ý định
   * của owner — ghim theo suy đoán sẽ loại đúng những tab vẫn chạy tốt trước
   * ticket 013, tức tự phá điều kiện đảo ngược số 1 của chính ticket đó.
   */
  const who = await resolveAuthuser();
  if (who.authuser == null) {
    throw new Error(
      `Tài khoản đã chọn (${who.email || '?'}) không còn đăng nhập. Chưa gửi Nguồn nào cả — ` +
        'chọn lại tài khoản trong popup rồi chạy lại.'
    );
  }
  const want = who.source === 'chosen' ? who.authuser : null;

  let tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
  if (want != null) tabs = tabs.filter((t) => tabAuthuser(t) === want);
  const inNotebook = tabs.filter((t) => /\/notebook\/[^/]+/.test(t.url || ''));

  let tab = null;
  if (target) {
    const wantedId = (/\/notebook\/([^/?#]+)/.exec(target) || [])[1];
    tab = inNotebook.find((t) => wantedId && (t.url || '').includes(wantedId)) || null;
    if (!tab) {
      // `settings.notebookUrl` không mang `authuser` (nó là URL owner dán, hoặc
      // do dropdown ghi). Gắn vào lúc điều hướng, chứ không lưu xuống đĩa: id
      // notebook thuộc về một tài khoản, `authuser` thì đổi theo lựa chọn.
      const dest = want == null ? target : withAuthuser(target, want);
      tab = tabs[0]
        ? await chrome.tabs.update(tabs[0].id, { url: dest })
        : await chrome.tabs.create({ url: dest, active: false });
      await waitTabComplete(tab.id);
      await sleep(2500); // Angular cần thời gian dựng UI
    }
  } else {
    tab = inNotebook[0] || null;
    if (!tab) {
      // Hai ca khác nhau, hai việc phải làm khác nhau: không có tab nào, so với
      // CÓ tab nhưng của tài khoản khác. Gộp lại thì owner đọc "chưa có notebook
      // nào đang mở" trong khi đang nhìn thẳng vào một notebook đang mở.
      throw new Error(
        want != null && (await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' })).length
          ? `Có tab NotebookLM đang mở, nhưng không phải của tài khoản đã chọn (${who.email || `authuser=${want}`}). ` +
            'Mở notebook đích bằng đúng tài khoản đó, hoặc đổi tài khoản trong popup.'
          : 'Chưa có notebook nào đang mở. Hãy mở notebook đích rồi bấm "Dùng notebook ở tab hiện tại" ' +
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

/**
 * Đường trao tay, mục 6: nhảy sang tab NotebookLM. HẾT.
 *
 * Cố tình KHÔNG dùng `resolveNotebookTab`, dù hai hàm tra tab giống hệt nhau ở
 * đoạn đầu. `resolveNotebookTab` còn `ensureScripts` + `NLM_PING` bốn nhịp +
 * `sleep(2500)`, và nó ném lỗi khi tab không nằm trong một notebook cụ thể — cả
 * ba thứ đó tồn tại vì Lượt chạy sắp *thao tác* lên DOM của trang. Đường trao
 * tay không thao tác gì: clipboard đã có nội dung, người dùng tự Ctrl+V. Gọi
 * lại hàm kia là gắn lại đúng ngân sách "vỡ khi Google đổi DOM" mà ADR 0001 vừa
 * gỡ ra khỏi ca này, để đổi lấy đúng con số không.
 *
 * Không tìm được tab thì KHÔNG ném: người dùng đang cầm một clipboard vừa ghi
 * xong, và một exception ở đây sẽ bị bề mặt báo thành "copy hỏng". Trả về lý do
 * để bề mặt nói tiếp vào câu đã copy.
 *
 * `summary` là bản tổng kết của Bó, và nó phải đi qua ĐÂY chứ không ở lại tab
 * nguồn. Cú nhảy này bật tab notebook lên rồi focus cửa sổ, nên ngay sau nó tab
 * YouTube/tài liệu thành tab nền: một toast dựng ở đó là bản báo cáo không ai
 * đọc — mà nó mang đúng phần đáng đọc nhất ("12 private/unlisted → Hàng đợi",
 * "3 trang không có thân bài → dùng Thêm N trang"). Chỉ báo khi thật sự nhảy;
 * không nhảy thì người dùng còn đứng ở tab nguồn và toast tại chỗ là đúng chỗ.
 *
 * @param {string} [summary] bản tổng kết để báo bằng thông báo hệ thống sau cú nhảy
 * @param {string} [source] tên bề mặt khởi lượt ('YouTube' | 'Tài liệu'), làm tiền tố tiêu đề
 * @returns {{jumped: boolean, why?: string, tabId?: number, noted?: boolean}}
 */
async function jumpToNotebook(summary, source) {
  const settings = await getSettings();
  const target = (settings.notebookUrl || '').trim();

  const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
  const inNotebook = tabs.filter((t) => /\/notebook\/[^/]+/.test(t.url || ''));

  let tab = null;
  if (target) {
    const wantedId = (/\/notebook\/([^/?#]+)/.exec(target) || [])[1];
    tab = inNotebook.find((t) => wantedId && (t.url || '').includes(wantedId)) || null;
    if (!tab) {
      // Mở thẳng ở chế độ active: cả lượt này chỉ tồn tại để đưa người dùng tới
      // đó. Không `waitTabComplete`, không chờ Angular — không có gì để chờ.
      try {
        tab = tabs[0]
          ? await chrome.tabs.update(tabs[0].id, { url: target, active: true })
          : await chrome.tabs.create({ url: target, active: true });
      } catch (_) {
        tab = null;
      }
    }
  } else {
    tab = inNotebook[0] || null;
  }

  if (!tab) return { jumped: false, why: 'no-target' };

  /*
   * `tabs.query` trả về một BẢN CHỤP. Giữa lúc chụp và lúc bật, người dùng đóng
   * được tab đó — và `tabs.update` trên một tabId đã chết thì ném, chứ không trả
   * về null. Ném ở đây là ném xuyên qua `sendResponse`, nên bên gọi nhận
   * `undefined` và đọc thành "đã nhảy rồi": clipboard có nội dung, người dùng
   * đứng nguyên tại chỗ, và không một dòng nào nói cho họ biết.
   */
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (_) {
    return { jumped: false, why: 'tab-gone' };
  }

  // `noted` được trả lên để bên gọi biết bản tổng kết có thật sự tới nơi không.
  // Nhảy được nghĩa là tab này thành tab nền, nên thông báo hệ thống là đường
  // duy nhất còn lại; nó câm thì bên gọi phải tự nói bằng toast của mình.
  //
  // `summary` rỗng cho `noted: true` — đọc là "không có gì để báo nên không có
  // gì hỏng", không phải "đã báo xong". Hai bên gọi thật đều luôn gửi `summary`
  // (`youtube/content.js`, `docs/content.js`), nên nhánh này chỉ tồn tại cho
  // lời gọi trần; bên gọi nào bỏ `summary` mà vẫn đọc `noted` là tự lừa mình.
  const noted = summary ? await note('Đã copy, Ctrl+V vào Thêm nguồn', summary, source) : true;
  return { jumped: true, tabId: tab.id, noted };
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

/* -------------------------------------------------------------------- */
/* Cửa đo HTML thô — NotebookLM có đọc nổi trang này không               */
/* -------------------------------------------------------------------- */

/** Trần thời gian cho một lượt fetch của cửa đo. Toàn bộ code cũ chạy tuần tự
 *  và KHÔNG có một `AbortController` nào — bắn 30 fetch vào một host là hành vi
 *  mới hoàn toàn, nên nó phải có hạn của riêng nó. */
const PROBE_TIMEOUT_MS = 12000;

/**
 * Tải HTML thô của một URL, **ẩn danh**, đúng như máy chủ Google sẽ tải nó.
 *
 * `credentials: 'omit'` được GÕ RA chứ không dựa vào mặc định, và đây là chỗ
 * dễ sai nhất của cả ticket. Mặc định của `fetch` là `same-origin`, nghe thì đã
 * an toàn — nhưng doc chính thức của Chrome ghi thêm một luật riêng cho
 * extension: *"Requests from an extension to a third-party are treated as
 * same-site if the extension has host permissions for the third-party. This
 * means SameSite=Strict cookies can be sent."*
 * (`developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies`,
 * đọc 2026-08-25). Repo này có host permission cho MỌI http/https
 * (`manifest.json:22-23`), nên câu đó phủ đúng mọi URL đi qua đây.
 *
 * Không có `'omit'` thì cửa đo hỏng theo chiều nguy hiểm nhất: một trang nội bộ
 * chỉ đọc được khi đã đăng nhập sẽ đo ra "có thân bài" trên máy owner, rồi
 * NotebookLM — fetch ẩn danh — nhận về trang đăng nhập và nuốt một Nguồn rỗng.
 * Cửa đo nói dối theo chiều BẬT là tệ hơn không có cửa đo.
 *
 * Cố ý KHÔNG tái dùng `EX.fromUrl` (`src/docs/extract.js:227`): nó fetch với
 * `credentials: 'include'`, và ở đó điều đó ĐÚNG — nó phục vụ Dán text, vốn đọc
 * nội dung ngay trên máy người dùng nên tài liệu nội bộ đọc được mới là tính
 * năng (`README.md:94` bán nó ra ngoài đúng như vậy). Hai việc khác nhau, hai
 * đường fetch khác nhau.
 */
async function fetchRawHtml(url) {
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const type = res.headers.get('content-type') || '';
    return { url, finalUrl: res.url || url, type, html: await res.text() };
  } catch (e) {
    return { url, error: (e && e.message) || String(e) };
  }
}

/* -------------------------------------------------------------------- */
/* Sổ đã copy — cửa 2 của Đường trao tay                                 */
/* -------------------------------------------------------------------- */

/**
 * Khoá của một URL trong Bó link, nói CÙNG ngôn ngữ với `itemKey()`.
 *
 * Phải cùng ngôn ngữ vì cửa 2 tra cả Sổ lẫn Hàng đợi — hai kho, một luật khoá.
 * Đó cũng là lý do hàm này sống ở service worker chứ không ở `shared.js`:
 * `itemKey()` là hàm cục bộ của file này, và chép nó sang chỗ khác là dựng đúng
 * hình dạng "đường dữ liệu song song" mà repo đã dính một lần.
 *
 * Lưu ý về `videoIdFrom`: nó nhận cả id trần 11 ký tự, nên `bundleKey('javascripts')`
 * ra `yt:javascripts`. Ở đây không thành lỗi vì đầu vào luôn là URL đầy đủ do
 * chính `canonicalUrl`/`usableUrl` dựng ra — nhưng đừng mở hàm này cho text tự do
 * (xem `docs/tickets/007-parseurllist-nuot-link.md`).
 */
function bundleKey(url) {
  const videoId = videoIdFrom(url);
  if (videoId) return `yt:${videoId}`;
  return docKey(url);
}

/**
 * Cửa 2 — khử trùng một Bó link trước khi nó tới clipboard.
 *
 * Tra HAI kho:
 *   - Sổ đã copy: mọi dòng, không trừ gì.
 *   - Hàng đợi: mọi Mục TRỪ `ERROR`.
 *
 * Ngoại lệ `ERROR` là một quyết định, không phải sao chép `enqueue()` cho tiện:
 * một Mục `ERROR` nghĩa là Lượt chạy đã thử và không đưa được nó vào NotebookLM
 * — mà đó chính là ca Đường trao tay sinh ra để cứu. Chặn nó ở đây là chặn đúng
 * ca cần nhất. Đổi lại, người dùng có thể copy một link đã từng thất bại; giá đó
 * rẻ hơn hẳn.
 *
 * `dropped` KHÔNG bị nuốt: nó quay về bề mặt kèm lý do, và bề mặt phải cho một
 * cách bấm để copy lại cả những cái đã có. Im lặng bỏ link là đúng lỗi
 * `sidebar.js` đã dính hai lần.
 */
async function filterBundle(urls) {
  const [queue, copied] = await Promise.all([getQueue(), getCopiedLog()]);

  const inLog = new Set(copied.map((row) => row.key).filter(Boolean));
  const inQueue = new Set(
    queue.filter((i) => i.status !== STATUS.ERROR).map(itemKey).filter(Boolean)
  );

  const keep = [];
  const dropped = [];
  const seen = new Set();

  for (const url of urls || []) {
    const key = bundleKey(url);
    if (!key) continue;
    if (seen.has(key)) continue;      // trùng ngay trong chính Bó này
    seen.add(key);

    if (inLog.has(key)) dropped.push({ url, why: 'copied' });
    else if (inQueue.has(key)) dropped.push({ url, why: 'queued' });
    else keep.push(url);
  }

  /*
   * Trả đúng hai field. `counts: {copied, queued}` từng đứng ở đây và KHÔNG bề
   * mặt nào đọc: cả `youtube/content.js` lẫn `docs/content.js` đều tự đếm lại
   * từ `dropped` vì chúng còn cần chính danh sách url để dựng thẻ *Copy lại*.
   * Một field chỉ có test đọc là một field nói dối về hợp đồng — nó làm hợp
   * đồng trông rộng hơn thứ thật sự được giữ.
   */
  return { keep, dropped };
}

/**
 * Ghi Sổ — gọi SAU khi `writeText` đã thành công, không bao giờ trước.
 *
 * Thứ tự này bắt buộc: `writeText` từ chối được (trang không được focus), và ghi
 * Sổ trước khi copy xong là để Sổ nói dối. Lần sau nó sẽ lọc mất đúng những link
 * chưa bao giờ tới clipboard, và người dùng không có cách nào biết.
 */
/**
 * Hàng nối tiếp cho MỌI lượt ghi Sổ.
 *
 * `getCopiedLog()` → sửa mảng → `storage.local.set()` là đọc-sửa-ghi, và service
 * worker phục vụ nhiều tab cùng lúc: hai tab bấm copy sát nhau thì cả hai đọc
 * cùng một bản Sổ, mỗi bên thêm phần của mình vào bản chụp riêng, rồi bên ghi
 * sau đè mất bên ghi trước. Sổ mất dòng mà không ai báo lỗi — và Sổ mất dòng
 * nghĩa là lượt sau copy trùng đúng những link vừa mất.
 *
 * `chrome.storage` không có giao dịch, nên chỗ nối tiếp phải nằm ở đây.
 */
let copiedChain = Promise.resolve();

function recordCopied(urls, from) {
  const run = copiedChain.then(() => writeCopied(urls, from));
  // Giữ dây sống kể cả khi một mắt xích ném — nếu không thì lượt hỏng đầu tiên
  // biến `copiedChain` thành promise bị từ chối vĩnh viễn, và mọi lượt sau ném theo.
  copiedChain = run.catch(() => {});
  return run;
}

/*
 * Sổ KHÔNG có trần, và đó là một quyết định chứ không phải một chỗ quên.
 *
 * Trần theo số dòng hay theo tuổi đều làm hỏng đúng thứ Sổ sinh ra để giữ: một
 * dòng bị cắt là một link được coi như chưa bao giờ copy, nên lần sau cửa 2 cho
 * nó qua và người dùng dán trùng — im lặng, đúng cái lỗi Đường trao tay dựng ra
 * để chặn. Người dùng xoá bằng nút *Xoá sổ*, và đó là chỗ duy nhất được xoá.
 *
 * Giá phải trả có thật và được chấp nhận: mỗi lượt ghi đọc rồi ghi lại TOÀN BỘ
 * mảng, nên thời gian ghi lớn tuyến tính theo kích thước Sổ. `manifest.json`
 * xin `unlimitedStorage` chính vì thế. `COPIED_PAGE = 50` bên dưới chỉ giới hạn
 * số dòng GỬI cho popup mỗi lượt — nó không đụng gì tới thứ được lưu.
 */
async function writeCopied(urls, from) {
  const log = await getCopiedLog();
  const known = new Set(log.map((row) => row.key).filter(Boolean));
  const at = Date.now();

  let added = 0;
  for (const url of urls || []) {
    const key = bundleKey(url);
    if (!key || known.has(key)) continue;
    known.add(key);
    log.push({ key, url, at, from: from || '' });
    added++;
  }
  await chrome.storage.local.set({ [KEYS.COPIED]: log });
  notifyPopup();
  return { added, total: log.length };
}

/** Số dòng Sổ gửi kèm mỗi lượt GET_STATE — xem ghi chú ở đó. */
const COPIED_PAGE = 50;

async function clearCopied() {
  await chrome.storage.local.remove(KEYS.COPIED);
  notifyPopup();
  return { ok: true };
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

/**
 * Cắt cho vừa `max` ký tự, và cắt thì phải NÓI RA là đã cắt.
 *
 * `slice(0, 300)` trần cắt câm ở đuôi, mà đuôi mới là chỗ bản tổng kết để những
 * vế đáng đọc nhất: "Đã copy N link" đứng đầu, còn "M private/unlisted",
 * "K đang nằm trong Hàng đợi", "chưa ghi được Sổ đã copy" đều được `push` sau.
 * Hôm nay chuỗi dài nhất đo được còn dưới 300, nhưng bất biến đó không ai giữ —
 * thêm một `parts.push` nữa là nó đứt, và đứt không một dấu hiệu.
 */
function cut(s, max) {
  const t = String(s == null ? '' : s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Bắn một thông báo hệ thống. Trả về `true` khi có cơ sở tin là nó tới nơi.
 *
 * Giá trị trả về mới là phần đáng kể: có chỗ trong luồng (cú nhảy sang notebook)
 * mà thông báo này là đường DUY NHẤT còn lại để nói với người dùng, vì tab họ vừa
 * bấm đã thành tab nền. Nuốt hết lỗi và không nói gì là để bản tổng kết bốc hơi.
 *
 * `source` là NGUỒN của lượt, và nó là tham số chứ không phải chuỗi cứng vì hàm
 * này phục vụ hai luồng khác nhau: bấm copy trên YouTube, và bấm copy trên bảng
 * tài liệu. Gắn cứng "YouTube →" cho cả hai thì người dùng bấm ở bảng docs nhận
 * một thông báo nói họ vừa làm gì đó với YouTube. Không truyền thì tiêu đề chỉ
 * còn "NotebookLM — …": Hàng đợi tự chạy, không khởi từ bề mặt nào, nhưng vẫn
 * cần tên để phân biệt giữa một trung tâm thông báo đầy thứ khác.
 *
 * `getPermissionLevel()` là tín hiệu tốt nhất có sẵn, KHÔNG phải bằng chứng đủ:
 * doc chính thức của Chrome nói nó trả về `"granted"` | `"denied"` cho quyền của
 * extension, nhưng KHÔNG nói `create()` có ném hay không khi thông báo bị tắt ở
 * tầng hệ điều hành. Nên `true` ở đây đọc là "không có dấu hiệu bị chặn", chứ
 * không phải "người dùng đã nhìn thấy".
 */
async function note(title, message, source) {
  try {
    if (chrome.notifications.getPermissionLevel) {
      const level = await chrome.notifications.getPermissionLevel();
      if (level !== 'granted') return false;
    }
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: source ? `${source} → NotebookLM — ${title}` : `NotebookLM — ${title}`,
      message: cut(message, 300),
    });
    return true;
  } catch (_) {
    // Không làm hỏng luồng — nhưng cũng không giả vờ là đã báo được.
    return false;
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
          const [queue, settings, running, copiedLog] = await Promise.all([
            getQueue(),
            getSettings(),
            chrome.storage.local.get(KEYS.RUNNING),
            getCopiedLog(),
          ]);
          /*
           * Sổ đã copy giữ MÃI theo thiết kế, còn popup thì hỏi lại 1500ms một
           * lần. Gửi cả Sổ qua mỗi lượt là bắt một cấu trúc chỉ-lớn-lên đi qua
           * đường sendMessage vô hạn lần. Gửi `total` thật kèm một lát cắt, và
           * để popup tự nói ra rằng nó đang cắt — trần dựng DOM bị giấu đọc y
           * hệt một danh sách đã hiện đủ.
           */
          sendResponse({
            queue,
            settings,
            running: !!running[KEYS.RUNNING] || !!runner,
            copied: { total: copiedLog.length, rows: copiedLog.slice(-COPIED_PAGE).reverse() },
          });
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

        /*
         * Cửa 2 của Đường trao tay. Bề mặt hỏi "những link này đã copy hoặc đã
         * xếp hàng chưa"; service worker trả lời, KHÔNG ghi gì. Sổ chỉ được ghi
         * ở `BUNDLE_COPIED` bên dưới, sau khi clipboard đã nhận thật.
         */
        case MSG.BUNDLE_FILTER:
          sendResponse(await filterBundle(message.urls || []));
          return;

        case MSG.BUNDLE_COPIED:
          sendResponse(await recordCopied(message.urls || [], message.from));
          return;

        case MSG.CLEAR_COPIED:
          sendResponse(await clearCopied());
          return;

        case MSG.DOCS_RAW_FETCH:
          sendResponse(await fetchRawHtml(message.url));
          return;

        case MSG.JUMP_NOTEBOOK:
          sendResponse(await jumpToNotebook(message.summary, message.source));
          return;

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

        // Hai lối vào duy nhất của đường notebook gốc. Không có lối gọi nào
        // khác trong file này — không `alarms`, không gọi lúc khởi động. Ràng
        // buộc "chỉ chạy sau cử chỉ của owner" được giữ bằng đúng chuyện đó.
        case MSG.LIST_NOTEBOOKS:
          sendResponse(await listNotebooks());
          return;

        case MSG.CREATE_NOTEBOOK:
          sendResponse(await createNotebook(message.title));
          return;

        case MSG.LIST_ACCOUNTS:
          sendResponse(await listAccounts());
          return;

        case MSG.SELECT_ACCOUNT: {
          const email = String(message.email || '').trim().toLowerCase() || null;
          await doiTaiKhoan(email);
          sendResponse({ ok: true, selected: email });
          return;
        }

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

/*
 * Phím tắt nhờ tab tự trao tay, và cửa sổ chờ là 5s. Con số này KHÔNG phải chọn
 * cho thoải mái: nó phải ngắn hơn cảm giác "phím tắt hỏng" của người dùng, vì
 * hết giờ là rơi về Hàng đợi chứ không phải báo lỗi. Đủ dài cho một lượt
 * `describe` bình thường, đủ ngắn để không ai kịp bấm lại phím tắt.
 */
const SHORTCUT_TIMEOUT_MS = 5000;

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

  /*
   * Mục 7 của ticket 006. Service worker KHÔNG tự quyết được lượt này: nó không
   * biết privacy (`normalize()` đóng dấu UNKNOWN cho mọi thứ) và không có
   * `navigator.clipboard`. Cả hai thứ đó chỉ có trong tab, nên lượt này là một
   * lời NHỜ, không phải một lệnh.
   *
   * `handled` là chữ ký của việc tab đã chạy trọn `handOff` — mà `handOff` tự
   * xếp hàng phần nó không copy được, kể cả nhánh clipboard từ chối. Nên ở đây
   * KHÔNG được `enqueue` thêm khi `handled`, nếu không mỗi lượt phím tắt thất
   * bại sẽ xếp hàng hai lần.
   *
   * Mọi ca còn lại — tab chưa có content script, tab treo, quá 5s, `handOff`
   * ném — đều rơi về Hàng đợi y như trước ticket này. Đó là ca mặc định, không
   * phải ca lỗi: hạng "biết thật" của mục 5 coi đo-không-được là loại.
   */
  let handled = false;
  try {
    await ensureScripts(tab.id, 'youtube');
    const res = await sendToTab(tab.id, { type: MSG.SHORTCUT_HANDOFF, videoId }, SHORTCUT_TIMEOUT_MS);
    handled = !!(res && res.handled);
  } catch (_) {
    handled = false;
  }
  if (handled) return;

  const result = await enqueue([{ videoId }]);
  if (result.added) runQueue();
});

// Xuất ra để test (và DevTools console) quan sát được phần chờ-ghi-xong-file;
// đây là chỗ duy nhất trong service worker có kết quả không suy ra được từ storage.
self.NBLM_SW_INTERNALS = {
  awaitDownloadComplete, saveFile, runQueue, DOWNLOAD_TIMEOUT_MS, ITEM_TIMEOUT_MS,
  bundleKey, filterBundle, recordCopied, clearCopied, enqueue,
  fetchRawHtml, PROBE_TIMEOUT_MS,
  jumpToNotebook, SHORTCUT_TIMEOUT_MS,
};

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
