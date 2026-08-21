/*
 * Isolated world. Giao diện trên YouTube:
 *   - Trang watch: nút "→ NotebookLM" và nút "Transcript" cạnh nút Like/Share.
 *   - Trang danh sách (playlist, kênh, tìm kiếm, trang chủ, Watch Later):
 *     checkbox chọn hàng loạt + thanh hành động nổi.
 *   - Trang playlist/kênh: thêm nút import TOÀN BỘ (quét qua InnerTube, không
 *     phụ thuộc vào việc đã cuộn tới đâu).
 *   - Nhận lệnh từ background để mô tả video / trích transcript / quét playlist.
 */
;(function () {
  'use strict';

  const { MSG, PRIVACY, videoIdFrom, norm, sleep } = globalThis.NBLM;
  const T = globalThis.NBLM_TRANSCRIPT;
  const P = globalThis.NBLM_PANEL;
  const B = globalThis.NBLM_BRIDGE;

  let settings = Object.assign({}, globalThis.NBLM.DEFAULTS);
  const selected = new Map(); // videoId -> {videoId, title, privacyHint}
  let pageCtx = { kind: 'other' }; // playlist/kênh mà trang này import toàn bộ được

  globalThis.NBLM.getSettings().then((s) => {
    settings = s;
    refreshBulkUI();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[globalThis.NBLM.KEYS.SETTINGS]) {
      settings = Object.assign({}, globalThis.NBLM.DEFAULTS, changes[globalThis.NBLM.KEYS.SETTINGS].newValue || {});
      refreshBulkUI();
    }
  });

  /* ------------------------------------------------------------------ */
  /* nhắn tin với background                                             */
  /* ------------------------------------------------------------------ */

  async function send(type, payload) {
    try {
      return await chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
    } catch (e) {
      // Xảy ra khi extension vừa được nạp lại / cập nhật — báo cho người dùng
      // thay vì để promise rejection rơi vào hư không.
      return { error: `Không liên lạc được với extension (${(e && e.message) || e}). Hãy tải lại trang.` };
    }
  }

  async function enqueue(items) {
    if (!items.length) return null;
    const res = await send(MSG.ENQUEUE, { items });
    if (res && res.error) toast(`Lỗi: ${res.error}`, 'error');
    else if (res && res.added === 0) toast('Các video này đã có trong hàng đợi rồi.', 'warn');
    else toast(`Đã thêm ${(res && res.added) || items.length} video vào hàng đợi NotebookLM`, 'ok');
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* toast                                                               */
  /* ------------------------------------------------------------------ */

  let toastEl = null;
  let toastTimer = null;
  function toast(message, kind = 'ok') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'nblm-toast';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.dataset.kind = kind;
    toastEl.classList.add('nblm-toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('nblm-toast--show'), 4200);
  }

  /* ------------------------------------------------------------------ */
  /* nút trên trang watch                                                */
  /* ------------------------------------------------------------------ */

  function watchActionRow() {
    return (
      document.querySelector('#top-level-buttons-computed') ||
      document.querySelector('ytd-menu-renderer #top-level-buttons') ||
      document.querySelector('#actions #menu')
    );
  }

  function ensureWatchButton() {
    const videoId = T.currentVideoId();
    const row = watchActionRow();
    if (!videoId || !row) return;

    let btn = document.querySelector('#nblm-watch-button');
    if (btn && btn.parentElement === row) {
      btn.dataset.videoId = videoId;
    } else {
      if (btn) btn.remove();
      btn = document.createElement('button');
      btn.id = 'nblm-watch-button';
      btn.className = 'nblm-btn';
      btn.type = 'button';
      btn.dataset.videoId = videoId;
      btn.title = 'Thêm video này vào NotebookLM (video private sẽ được trích transcript cục bộ)';
      btn.innerHTML = '<span class="nblm-btn__dot"></span><span class="nblm-btn__label">NotebookLM</span>';
      btn.addEventListener('click', onWatchClick);
      row.prepend(btn);
    }

    let tbtn = document.querySelector('#nblm-transcript-button');
    if (tbtn && tbtn.parentElement === row) {
      tbtn.dataset.videoId = videoId;
      return;
    }
    if (tbtn) tbtn.remove();

    tbtn = document.createElement('button');
    tbtn.id = 'nblm-transcript-button';
    tbtn.className = 'nblm-btn nblm-btn--ghost';
    tbtn.type = 'button';
    tbtn.dataset.videoId = videoId;
    tbtn.title = 'Xem, tìm, sao chép và tải transcript (chạy được cả với video private của bạn)';
    tbtn.textContent = 'Transcript';
    tbtn.addEventListener('click', () => {
      if (P.isOpen()) P.close();
      else P.open(tbtn.dataset.videoId, settings.preferredLangs);
    });
    btn.after(tbtn);
  }

  /** Panel gọi ngược lên đây khi bấm "→ NotebookLM", để dùng chung một đường xếp hàng. */
  globalThis.NBLM_SEND_CURRENT = function (videoId, meta) {
    enqueue([
      {
        videoId,
        title: meta && meta.title,
        channel: meta && meta.channel,
        durationSec: meta && meta.durationSec,
        privacy: (meta && meta.privacy) || PRIVACY.UNKNOWN,
      },
    ]);
  };

  async function onWatchClick(event) {
    const btn = event.currentTarget;
    const videoId = btn.dataset.videoId;
    if (!videoId || btn.disabled) return;

    btn.disabled = true;
    btn.classList.add('nblm-btn--busy');
    const label = btn.querySelector('.nblm-btn__label');
    const original = label.textContent;
    label.textContent = 'Đang đọc…';

    try {
      const meta = await T.describe(videoId);
      label.textContent = 'Đang xếp hàng…';
      await enqueue([
        {
          videoId,
          title: meta.title,
          channel: meta.channel,
          durationSec: meta.durationSec,
          privacy: meta.privacy,
          hasCaptions: meta.hasCaptions,
        },
      ]);
      if (meta.privacy === PRIVACY.PRIVATE) {
        toast('Video private — sẽ trích transcript ngay tại máy bạn, KHÔNG đổi chế độ hiển thị.', 'ok');
      }
    } catch (e) {
      // Vẫn xếp hàng được: background sẽ tự mở tab để lấy metadata.
      await enqueue([{ videoId, privacy: PRIVACY.UNKNOWN }]);
      toast(`Đã xếp hàng (chưa đọc được metadata: ${(e && e.message) || e})`, 'warn');
    } finally {
      label.textContent = original;
      btn.disabled = false;
      btn.classList.remove('nblm-btn--busy');
    }
  }

  /* ------------------------------------------------------------------ */
  /* chọn hàng loạt trên trang danh sách                                 */
  /* ------------------------------------------------------------------ */

  const ITEM_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-panel-video-renderer',
  ].join(',');

  function readItem(node) {
    const link = node.querySelector('a#thumbnail[href], a#video-title[href], a.yt-simple-endpoint[href]');
    const videoId = link && videoIdFrom(link.getAttribute('href'));
    if (!videoId) return null;

    const titleEl = node.querySelector('#video-title, yt-formatted-string#video-title, h3 a');
    const title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';

    // Huy hiệu "Private"/"Unlisted" trên thẻ video cho phép biết trước mức riêng
    // tư, đỡ một vòng hỏi InnerTube. Chỉ đọc đúng phần tử huy hiệu — dò cả chữ
    // trong thẻ sẽ dính tiêu đề video có chứa từ "private".
    let privacyHint = PRIVACY.UNKNOWN;
    const badges = node.querySelectorAll('ytd-badge-supported-renderer, .badge, [class*="badge"]');
    for (const badge of badges) {
      const text = norm(badge.textContent);
      if (!text) continue;
      if (/\bprivate\b|\brieng tu\b/.test(text)) privacyHint = PRIVACY.PRIVATE;
      else if (/\bunlisted\b|khong cong khai/.test(text)) privacyHint = PRIVACY.UNLISTED;
    }
    return { videoId, title, privacyHint };
  }

  function decorateItem(node) {
    if (node.querySelector(':scope > .nblm-pick')) return;
    const info = readItem(node);
    if (!info) return;

    const box = document.createElement('label');
    box.className = 'nblm-pick';
    box.title = 'Chọn để import vào NotebookLM';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(info.videoId);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const fresh = readItem(node) || info;
      if (input.checked) selected.set(fresh.videoId, fresh);
      else selected.delete(fresh.videoId);
      renderBar();
    });

    box.appendChild(input);
    node.style.position = node.style.position || 'relative';
    node.appendChild(box);
  }

  function scanItems() {
    if (!settings.bulkSelectUI) return;
    document.querySelectorAll(ITEM_SELECTOR).forEach(decorateItem);
  }

  function removeBulkUI() {
    document.querySelectorAll('.nblm-pick').forEach((el) => el.remove());
    const bar = document.querySelector('#nblm-bar');
    if (bar) bar.remove();
  }

  function canImportAll() {
    return !!(pageCtx && (pageCtx.kind === 'playlist' || pageCtx.kind === 'channel') && pageCtx.playlistId);
  }

  function barButton(act, label, primary = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nblm-bar__btn' + (primary ? ' nblm-bar__btn--primary' : '');
    b.dataset.act = act;
    b.textContent = label;
    return b;
  }

  function renderBar() {
    let bar = document.querySelector('#nblm-bar');
    if (!selected.size && !canImportAll()) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'nblm-bar';
      bar.addEventListener('click', onBarClick);
      document.documentElement.appendChild(bar);
    }

    const count = document.createElement('span');
    count.className = 'nblm-bar__count';
    // textContent chứ không innerHTML: tiêu đề playlist là dữ liệu người khác đặt.
    count.textContent = selected.size ? `${selected.size} video đã chọn` : pageCtx.title || '';

    const parts = [count];
    if (canImportAll()) {
      parts.push(
        barButton('all-import', pageCtx.kind === 'channel' ? 'Import toàn bộ kênh' : 'Import toàn bộ playlist', true)
      );
    }
    if (selected.size) {
      parts.push(barButton('import', `Import ${selected.size} đã chọn`, !canImportAll()));
      parts.push(barButton('clear', 'Bỏ chọn'));
    }
    // Trang watch có playlist ở cột phải cũng vào được nhánh canImportAll(), mà ở
    // đó không có thẻ video nào để tick — đừng hiện nút không làm gì.
    if (settings.bulkSelectUI && document.querySelector(ITEM_SELECTOR)) {
      parts.push(barButton('all', 'Chọn hết trang'));
    }

    bar.replaceChildren(...parts);
  }

  function clearSelection() {
    selected.clear();
    document.querySelectorAll('.nblm-pick input').forEach((i) => (i.checked = false));
    renderBar();
  }

  async function onBarClick(event) {
    const act = event.target && event.target.dataset && event.target.dataset.act;
    if (!act) return;

    if (act === 'clear') return clearSelection();

    if (act === 'all') {
      document.querySelectorAll(ITEM_SELECTOR).forEach((node) => {
        const info = readItem(node);
        if (info) selected.set(info.videoId, info);
        const input = node.querySelector(':scope > .nblm-pick input');
        if (input) input.checked = true;
      });
      renderBar();
      return;
    }

    if (act === 'import') {
      const items = Array.from(selected.values()).map((i) => ({
        videoId: i.videoId,
        title: i.title,
        privacy: i.privacyHint,
      }));
      clearSelection();
      await enqueue(items);
      return;
    }

    if (act === 'all-import') await importEverything(event.target);
  }

  /* ------------------------------------------------------------------ */
  /* import toàn bộ playlist / kênh                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Quét qua InnerTube chứ không đọc DOM: "Chọn hết trang" chỉ lấy được những
   * video đã cuộn tới, còn cách này lấy đủ cả playlist vài trăm video.
   */
  async function importEverything(button) {
    const ctx = pageCtx;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Đang quét…';

    try {
      const res = await B.call(
        'playlist',
        { playlistId: ctx.playlistId, max: settings.maxBulkVideos },
        180000
      );
      const all = res.items || [];
      const usable = all.filter((i) => i.accessible);
      const blocked = all.length - usable.length;
      const priv = usable.filter((i) => i.privacy === PRIVACY.PRIVATE).length;

      if (!usable.length) {
        toast('Không tìm thấy video nào import được ở đây.', 'warn');
        return;
      }

      const lines = [`Tìm thấy ${usable.length} video trong "${ctx.title}".`];
      if (priv) lines.push(`${priv} video private của bạn — sẽ trích transcript tại máy, không đổi chế độ hiển thị.`);
      if (blocked) lines.push(`${blocked} video bị bỏ qua vì bạn không có quyền xem (private của người khác, hoặc đã xoá).`);
      if (res.truncated) lines.push(`Đã dừng ở giới hạn ${settings.maxBulkVideos} video — chỉnh trong Cài đặt nếu cần nhiều hơn.`);
      lines.push('Video đã có trong hàng đợi sẽ tự động bị loại.');

      const agreed = await confirmDialog({
        title: 'Import toàn bộ vào NotebookLM?',
        lines,
        confirmLabel: `Import ${usable.length} video`,
      });
      if (!agreed) return;

      await enqueue(
        usable.map((i) => ({
          videoId: i.videoId,
          title: i.title,
          channel: i.channel,
          durationSec: i.durationSec,
          privacy: i.privacy,
        }))
      );
    } catch (e) {
      toast(`Không quét được danh sách: ${(e && e.message) || e}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  /** Hộp xác nhận dựng bằng DOM — nội dung có tiêu đề video nên tránh innerHTML. */
  function confirmDialog({ title, lines, confirmLabel = 'Đồng ý', cancelLabel = 'Huỷ' }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'nblm-modal';

      const box = document.createElement('div');
      box.className = 'nblm-modal__box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      const h = document.createElement('h2');
      h.className = 'nblm-modal__title';
      h.textContent = title;
      box.appendChild(h);

      for (const line of lines) {
        const p = document.createElement('p');
        p.className = 'nblm-modal__line';
        p.textContent = line;
        box.appendChild(p);
      }

      const row = document.createElement('div');
      row.className = 'nblm-modal__row';
      const no = barButton('no', cancelLabel);
      const yes = barButton('yes', confirmLabel, true);
      no.className = 'nblm-modal__btn';
      yes.className = 'nblm-modal__btn nblm-modal__btn--primary';
      row.append(no, yes);
      box.appendChild(row);
      back.appendChild(box);

      const finish = (value) => {
        back.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') finish(false);
      };

      no.addEventListener('click', () => finish(false));
      yes.addEventListener('click', () => finish(true));
      back.addEventListener('click', (e) => {
        if (e.target === back) finish(false);
      });
      document.addEventListener('keydown', onKey);

      document.documentElement.appendChild(back);
      yes.focus();
    });
  }

  /** Hỏi cầu nối trang xem đây có phải playlist/kênh import toàn bộ được không. */
  async function refreshContext() {
    try {
      pageCtx = await B.call('context', {}, 15000);
    } catch (_) {
      pageCtx = { kind: 'other' };
    }
    renderBar();
  }

  function refreshBulkUI() {
    if (settings.bulkSelectUI) scanItems();
    else removeBulkUI();
  }

  /* ------------------------------------------------------------------ */
  /* vòng đời SPA                                                        */
  /* ------------------------------------------------------------------ */

  let scanTimer = null;
  let lastUrl = location.href;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      ensureWatchButton();
      scanItems();
      // MutationObserver bắn liên tục trên YouTube, mà hỏi cầu nối trang thì tốn;
      // chỉ hỏi lại khi URL thực sự đổi.
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onNavigate();
      }
    }, 350);
  }

  function onNavigate() {
    selected.clear();
    P.reset();
    P.close();
    renderBar();
    refreshContext();
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('yt-navigate-finish', () => {
    lastUrl = location.href;
    onNavigate();
    scheduleScan();
  });

  scheduleScan();
  refreshContext();

  /* ------------------------------------------------------------------ */
  /* lệnh từ background                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Chỉ những loại tin script này thực sự xử lý — xem ghi chú cùng tên trong
   * `src/docs/content.js`. Trả lời tin của script khác là cướp mất phản hồi của
   * nó (Chrome lấy câu trả lời đến trước), và lỗi hiện ra sẽ trỏ sai chỗ hoàn toàn.
   */
  const HANDLED = new Set([
    MSG.YT_PING, MSG.YT_DESCRIBE, MSG.YT_EXTRACT, MSG.YT_CONTEXT, MSG.YT_PLAYLIST, 'nblm-toast',
  ]);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !HANDLED.has(message.type)) return false; // của script khác — im lặng
    (async () => {
      try {
        switch (message.type) {
          case MSG.YT_PING:
            sendResponse({ ok: true, videoId: T.currentVideoId() });
            return;

          case MSG.YT_DESCRIBE:
            sendResponse({ ok: true, meta: await T.describe(message.videoId) });
            return;

          case MSG.YT_EXTRACT: {
            // Trang cần ổn định trước khi quét panel transcript.
            if (document.readyState !== 'complete') {
              await new Promise((r) => window.addEventListener('load', r, { once: true }));
            }
            await sleep(600);
            const result = await T.extract(message.videoId, message.langs);
            sendResponse({ ok: true, result });
            return;
          }

          case MSG.YT_CONTEXT:
            sendResponse({ ok: true, context: await B.call('context', {}, 15000) });
            return;

          case MSG.YT_PLAYLIST: {
            const res = await B.call(
              'playlist',
              { playlistId: message.playlistId, max: message.max || settings.maxBulkVideos },
              180000
            );
            sendResponse({ ok: true, ...res });
            return;
          }

          case 'nblm-toast':
            toast(message.message, message.kind);
            sendResponse({ ok: true });
            return;

          default:
            sendResponse({ ok: false, error: `lệnh lạ: ${message.type}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || String(e) });
      }
    })();
    return true; // giữ kênh cho phản hồi bất đồng bộ
  });

  // Phím tắt Alt+Shift+Y đi qua background, nhưng cũng hỗ trợ khi focus ở trang.
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'Y' || e.key === 'y')) {
      const btn = document.querySelector('#nblm-watch-button');
      if (btn) btn.click();
    }
  });
})();
