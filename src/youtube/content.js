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

  const {
    MSG, PRIVACY, BUNDLE, videoIdFrom, canonicalUrl, norm, sleep,
    badgeRejects, bundleVerdict, mapWithLimit,
  } = globalThis.NBLM;
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
  /* Đường trao tay — gom link vào clipboard rồi dừng                    */
  /* ------------------------------------------------------------------ */

  /**
   * Trần đồng thời cho cửa 3. Một video = một lượt `innertube('player')` bằng
   * phiên đăng nhập của người dùng, nên một playlist 200 video mà huy hiệu không
   * loại được cái nào là 200 lượt POST tới YouTube. Rate limit ở lượt chạy hàng
   * loạt là rủi ro đã ghi trong `WORKSPACE_PROTOCOL.md`, không phải lo xa.
   *
   * Con số 4 là SUY ĐOÁN mượn của ràng buộc 7 trong ticket 006 — chưa ai đo
   * ngưỡng thật của YouTube trên tài khoản owner. Đo rồi thì sửa ở đây.
   */
  const BUNDLE_LIMIT = 4;

  /**
   * Cầu dao: quá ngần này lượt hỏi hỏng LIÊN TIẾP thì dừng hỏi hẳn, phần còn lại
   * rơi về Hàng đợi. Fail-closed — thứ dừng lại là *quyền vào clipboard*, không
   * phải cả thao tác. Hỏng liên tiếp gần như luôn nghĩa là YouTube đang chặn, và
   * hỏi tiếp chỉ làm nó chặn lâu hơn.
   */
  const BUNDLE_BREAKER = 3;

  /**
   * Link bị cửa 2 loại ở lượt gần nhất — nguyên liệu cho "copy lại cả những cái
   * đã có". Giữ ở đây chứ không hỏi lại service worker: danh sách phải là đúng
   * cái người dùng vừa được báo, không phải một danh sách tính lại sau đó.
   */
  let lastDropped = [];

  /**
   * Ba cửa, theo đúng thứ tự — và thứ tự này là nội dung chứ không phải cách xếp:
   *
   *   cửa 1  huy hiệu, miễn phí, CHỈ ĐƯỢC LOẠI
   *   cửa 3  hỏi player response, tốn request, CHỈ ĐƯỢC NHẬN
   *
   * (Cửa 2 — khử trùng qua Sổ đã copy — chèn vào giữa ở mục 3 của ticket 006.)
   *
   * Cái neo: KHÔNG có đường nào tới `writeText` mà không qua cửa 3. Mọi hàm gom
   * link đều phải đi qua đây, kể cả nút "copy lại những cái đã có" sắp thêm ở
   * mục 3 — danh sách của nút đó chưa bao giờ đi qua cửa 3, và nếu nó có đường
   * riêng thì đúng video private cửa 3 vừa chặn sẽ lên clipboard ở lượt sau.
   *
   * @param {Array} candidates `{videoId, title, privacy|privacyHint, accessible}`
   * @returns {{urls: string[], restricted: Array, unknown: Array, tripped: boolean}}
   */
  async function buildBundle(candidates) {
    const restricted = [];
    const unknown = [];
    const asking = [];

    for (const c of candidates) {
      if (!c || !c.videoId) continue;
      const privacy = c.privacy || c.privacyHint;
      if (badgeRejects({ privacy, accessible: c.accessible })) restricted.push(c);
      else asking.push(c);
    }

    let strike = 0;   // lượt hỏng liên tiếp
    let tripped = false;

    const asked = await mapWithLimit(asking, BUNDLE_LIMIT, async (c) => {
      if (tripped) return { c, meta: null };
      try {
        // `noFallback`: một lượt hỏi hỏng không được biến thành một lượt tải
        // nguyên trang watch — xem `getPlayerResponse` trong page-bridge.js.
        const meta = await T.describe(c.videoId, { noFallback: true });
        strike = 0;
        return { c, meta };
      } catch (_) {
        if (++strike >= BUNDLE_BREAKER) tripped = true;
        return { c, meta: null };
      }
    });

    const urls = [];
    for (const { c, meta } of asked) {
      const { verdict } = bundleVerdict(c.videoId, meta);
      if (verdict === BUNDLE.ACCEPT) urls.push(canonicalUrl(c.videoId));
      else if (verdict === BUNDLE.RESTRICTED) restricted.push(c);
      else unknown.push(c);
    }
    return { urls, restricted, unknown, tripped };
  }

  /**
   * Gom rồi trao tay: ghi clipboard, và đẩy phần không đủ điều kiện về Hàng đợi.
   *
   * Bó rỗng thì KHÔNG chạm clipboard. `writeText('')` xoá trắng thứ người dùng
   * đang giữ, và họ mất nó để đổi lấy một thông báo. Đây là ca thường gặp chứ
   * không phải ca biên: bấm copy lần thứ hai trên cùng một playlist là rơi thẳng
   * vào nó.
   *
   * Ba lý do bị loại được đếm RIÊNG. "Đã copy 0 link" là câu vô nghĩa; "cả 12
   * link đều private" thì hành động được.
   */
  /**
   * @param {boolean} opts.skipDedupe bỏ qua cửa 2 — dành cho nút "copy lại cả
   *   những cái đã có". Nó KHÔNG bỏ qua cửa 3: danh sách của nút đó là `dropped`,
   *   thứ chưa bao giờ đi qua cửa 3, và cửa 3 lại đẩy video bị loại sang Hàng đợi
   *   mà cửa 2 thì tra Hàng đợi — nên đúng video private vừa bị chặn sẽ nằm trong
   *   `dropped` ở lượt sau. Vòng lặp tự đóng nếu ai đó nới cái neo này.
   */
  async function handOff(candidates, { verb = 'Đã copy', from = '', skipDedupe = false } = {}) {
    const { urls, restricted, unknown, tripped } = await buildBundle(candidates);
    const leftover = restricted.concat(unknown);

    // Cửa 2 — khử trùng. Chạy SAU cửa 3 vì chỉ link đã được cấp phép mới đáng
    // đem đi tra, và service worker là chỗ duy nhất cầm luật khoá.
    let keep = urls;
    let dropped = [];
    if (urls.length && !skipDedupe) {
      const res = await send(MSG.BUNDLE_FILTER, { urls });
      if (res && res.error) {
        toast(`Không tra được Sổ đã copy: ${res.error}`, 'error');
        return { copied: 0, error: res.error };
      }
      keep = (res && res.keep) || [];
      dropped = (res && res.dropped) || [];
    }
    lastDropped = dropped.length ? dropped.map((d) => d.url) : [];

    if (!keep.length) {
      const why = [];
      if (restricted.length) why.push(`${restricted.length} video private/unlisted`);
      if (unknown.length) why.push(`${unknown.length} video không hỏi được`);
      if (dropped.length) why.push(`${dropped.length} link đã có trong Sổ hoặc Hàng đợi`);
      toast(
        why.length
          ? `Không link nào vào được Bó: ${why.join(' · ')}.${dropped.length ? ' Bấm lại nút này lần nữa để copy cả những cái đã có.' : ' Tất cả đã vào Hàng đợi.'}`
          : 'Không có video nào để copy.',
        'warn'
      );
      if (leftover.length) await enqueueLeftover(leftover);
      return { copied: 0, restricted: restricted.length, unknown: unknown.length, dropped: dropped.length };
    }

    const urlsToCopy = keep;
    try {
      // `await` xong mới được làm gì tiếp — đóng giao diện trước khi clipboard
      // ghi xong là mất trắng nội dung.
      await navigator.clipboard.writeText(urlsToCopy.join('\n'));
    } catch (e) {
      // Clipboard API từ chối khi tài liệu không được focus. Nói ra đường thủ
      // công thay vì im lặng nuốt — người dùng đang đứng trước một cái nút vừa
      // bấm mà không có gì xảy ra.
      toast(`Không ghi được clipboard (${(e && e.message) || e}) — tất cả đã vào Hàng đợi.`, 'error');
      // Sổ KHÔNG được ghi ở nhánh này. Clipboard chưa nhận gì cả.

      await enqueueLeftover(candidates.filter((c) => c && c.videoId));
      return { copied: 0, restricted: restricted.length, unknown: unknown.length, clipboardFailed: true };
    }

    // Ghi Sổ SAU khi clipboard đã nhận thật — ghi trước là để Sổ nói dối, và lần
    // sau nó lọc mất đúng những link chưa bao giờ tới clipboard.
    await send(MSG.BUNDLE_COPIED, { urls: urlsToCopy, from: from || pageCtx.title || location.href });

    // Mục 6: nhảy sang tab notebook, và DỪNG. Không mở hộp thoại, không bấm chip.
    const jump = await send(MSG.JUMP_NOTEBOOK, {});

    const parts = [`${verb} ${urlsToCopy.length} link công khai`];
    if (restricted.length) parts.push(`${restricted.length} private/unlisted → Hàng đợi`);
    if (unknown.length) parts.push(`${unknown.length} không hỏi được → Hàng đợi`);
    if (dropped.length) parts.push(`${dropped.length} bỏ vì đã có trong Sổ`);
    if (tripped) parts.push('đã dừng hỏi vì YouTube liên tục từ chối');
    // Im lặng ở đây là im lặng sai: clipboard đã có nội dung mà người dùng không
    // biết mang đi đâu, và không có cú nhảy nào để tự nói hộ.
    if (!jump || !jump.jumped) parts.push('chưa đặt notebook đích — mở notebook rồi Ctrl+V');
    toast(parts.join(' · '), jump && jump.jumped ? 'ok' : 'warn');

    if (leftover.length) await enqueueLeftover(leftover);
    return {
      copied: urlsToCopy.length,
      restricted: restricted.length,
      unknown: unknown.length,
      dropped: dropped.length,
      tripped,
    };
  }

  /** Xếp hàng phần bị loại, im lặng — người dùng đã đọc con số ở toast của Bó rồi. */
  async function enqueueLeftover(items) {
    const payload = items.map((i) => ({
      videoId: i.videoId,
      title: i.title,
      privacy: i.privacy || i.privacyHint || PRIVACY.UNKNOWN,
    }));
    if (payload.length) await send(MSG.ENQUEUE, { items: payload });
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

    /*
     * Nút THỨ BA, không phải sửa nút cũ. Nút "NotebookLM" và `onWatchClick` giữ
     * nguyên hành vi xếp hàng: nó là lối vào người dùng đã quen, và nút "→
     * NotebookLM" trong bảng transcript mang đúng nhãn đó. Hai nút cùng chữ mà
     * rẽ hai hướng là một cái bẫy — hoặc đổi cả hai, hoặc không đổi cái nào.
     */
    let cbtn = document.querySelector('#nblm-copy-button');
    if (cbtn && cbtn.parentElement === row) {
      cbtn.dataset.videoId = videoId;
    } else {
      if (cbtn) cbtn.remove();
      cbtn = document.createElement('button');
      cbtn.id = 'nblm-copy-button';
      cbtn.className = 'nblm-btn nblm-btn--ghost';
      cbtn.type = 'button';
      cbtn.dataset.videoId = videoId;
      cbtn.title = 'Copy link video vào clipboard để tự dán vào NotebookLM (chỉ video công khai)';
      cbtn.textContent = 'Copy link';
      cbtn.addEventListener('click', onCopyClick);
      btn.after(cbtn);
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
    cbtn.after(tbtn);
  }

  async function onCopyClick(event) {
    const el = event.currentTarget;
    const videoId = el.dataset.videoId;
    if (!videoId || el.disabled) return;

    el.disabled = true;
    const original = el.textContent;
    el.textContent = 'Đang hỏi…';
    try {
      await handOff([{ videoId }]);
    } finally {
      el.textContent = original;
      el.disabled = false;
    }
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
      parts.push(barButton('copy', `Copy ${selected.size} link`));
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

    if (act === 'copy') {
      const picked = Array.from(selected.values());
      const el = event.target;
      const original = el.textContent;
      el.disabled = true;
      el.textContent = 'Đang hỏi…';
      try {
        // Cửa 3 hỏi TỪNG videoId đã tick, tại đây chứ không lúc tick. "Chọn hết
        // trang" tick mọi thẻ đã cuộn qua, nên đây có thể là hàng trăm lượt hỏi.
        await handOff(picked);
      } finally {
        el.textContent = original;
        el.disabled = false;
      }
      clearSelection();
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

      const act = await chooseDialog({
        title: 'Import toàn bộ vào NotebookLM?',
        lines,
        actions: [
          { act: 'copy', label: 'Copy link công khai' },
          { act: 'import', label: `Import ${usable.length} video`, primary: true },
        ],
      });
      if (!act) return;   // Huỷ — và huỷ tốn ĐÚNG 0 lượt hỏi player response

      if (act === 'copy') {
        // Cửa 3 chạy ở đây, sau khi người dùng đã chọn — không phải lúc quét
        // xong. Đối xứng với cửa đo docs: bấm rồi mới trả tiền.
        await handOff(usable);
        return;
      }

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

  /**
   * Hộp chọn hành động, dựng bằng DOM — nội dung có tiêu đề video nên tránh innerHTML.
   *
   * Trả về **tên hành động** hoặc `null` khi huỷ, chứ không phải boolean. Đó là
   * đổi chữ ký chứ không phải thêm một cái nút: hộp này giờ có hai lối đi khác
   * hẳn nhau — xếp hàng, hoặc trao tay qua clipboard — và một boolean không nói
   * được cái nào.
   */
  function chooseDialog({ title, lines, actions, cancelLabel = 'Huỷ' }) {
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
      no.className = 'nblm-modal__btn';
      row.appendChild(no);

      const buttons = actions.map((a) => {
        const b = barButton(a.act, a.label, !!a.primary);
        b.className = 'nblm-modal__btn' + (a.primary ? ' nblm-modal__btn--primary' : '');
        row.appendChild(b);
        return b;
      });

      box.appendChild(row);
      back.appendChild(box);

      const finish = (value) => {
        back.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') finish(null);
      };

      no.addEventListener('click', () => finish(null));
      buttons.forEach((b, i) => b.addEventListener('click', () => finish(actions[i].act)));
      back.addEventListener('click', (e) => {
        if (e.target === back) finish(null);
      });
      document.addEventListener('keydown', onKey);

      document.documentElement.appendChild(back);
      (buttons.find((_, i) => actions[i].primary) || buttons[0] || no).focus();
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
    MSG.SHORTCUT_HANDOFF,
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

          case MSG.SHORTCUT_HANDOFF: {
            /*
             * Phím tắt vòng qua service worker rồi về đây. `handled: true` nghĩa
             * là lượt này đã có kết cục — copy được, hoặc `handOff` đã tự xếp
             * hàng phần không copy được. Service worker đọc đúng cờ này để biết
             * có phải xếp hàng thay không, nên nó KHÔNG được đặt trước khi
             * `handOff` chạy xong.
             *
             * Chỗ này là nơi câu hỏi "phím tắt còn giữ được user activation
             * không" được trả lời bằng hành vi thật chứ bằng phán đoán: nếu
             * `writeText` từ chối, `handOff` đi nhánh clipboardFailed, tự xếp
             * hàng, và vẫn trả về handled — người dùng mất Bó link nhưng không
             * mất video.
             */
            const res = await handOff([{ videoId: message.videoId }], { from: 'Phím tắt' });
            // Nhánh duy nhất `handOff` KHÔNG tự xếp hàng: tra Sổ hỏng. Nhận
            // handled ở đó là bỏ rơi video giữa đường.
            sendResponse({ handled: !(res && res.error) });
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
