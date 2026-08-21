// Thanh nổi trên trang playlist/kênh: liệt kê, bảng xác nhận, checkbox chọn lẻ — ticket 007.
//
// Phần thuần và phần chạm InnerTube nằm ở `src/youtube/playlist.js`; ở đây chỉ còn cây node và
// một bộ điều khiển — Seam 3 của spec 0001, đúng khuôn của `src/youtube/panel.js`.
//
// Thứ nguy hiểm nhất của file này **không** phải việc vẽ, mà là việc dọn. Ba thứ nó giữ đều
// gắn với *một playlist cụ thể* và đều sống lâu hơn một lần điều hướng SPA: danh sách đã liệt
// kê, bảng xác nhận, và những ô đã tick nằm rải trên thumbnail của trang. YouTube đổi playlist
// mà không tải lại trang, nên nếu không dọn thì bảng xác nhận của playlist A hiện trên trang
// playlist B — 300 video, con số ước lượng đầy đủ, mọi thứ trông chạy được, và bấm "Import
// toàn bộ" là import nhầm cả playlist. Đó đúng là hình mà ticket 005 và 006 đã dính
// (`WORKSPACE_PROTOCOL.md`, mục "một thứ của video A còn sống trên trang video B").
//
// Không selector nào trong file này: mọi thứ dễ vỡ nằm ở `src/youtube/selectors.js`.
(function (root) {
  'use strict';

  if (root.NBLM_PLAYLIST_BAR) return;

  const S = root.NBLM_SHARED;
  const M = root.NBLM_MESSAGES;
  const Y = root.NBLM_YT_SELECTORS;
  const W = root.NBLM_WATCH;
  const PL = root.NBLM_PLAYLIST;
  if (!S) throw new Error('youtube/playlist-bar: cần src/common/shared.js nạp trước');
  if (!M) throw new Error('youtube/playlist-bar: cần src/common/messages.js nạp trước');
  if (!Y) throw new Error('youtube/playlist-bar: cần src/youtube/selectors.js nạp trước');
  if (!W) throw new Error('youtube/playlist-bar: cần src/youtube/watch.js nạp trước');
  if (!PL) throw new Error('youtube/playlist-bar: cần src/youtube/playlist.js nạp trước');

  /** Mọi id suy từ `EXT_PREFIX`: đó là thứ `OWN_UI` dùng để loại giao diện của chính mình. */
  const BAR_ID = `${S.EXT_PREFIX}playlist-bar`;
  const TABLE_ID = `${S.EXT_PREFIX}playlist-table`;
  const COUNT_ID = `${S.EXT_PREFIX}playlist-count`;
  const STATUS_ID = `${S.EXT_PREFIX}playlist-status`;
  const LIST_ID = `${S.EXT_PREFIX}playlist-list`;
  const ALL_ID = `${S.EXT_PREFIX}playlist-import-all`;
  const SELECTED_ID = `${S.EXT_PREFIX}playlist-import-selected`;
  const CLEAR_ID = `${S.EXT_PREFIX}playlist-clear`;
  /**
   * Checkbox của một dòng mang videoId ngay trong id: nhờ vậy `close()` tìm lại được đúng
   * chúng để gỡ, và một lượt gắn lại nhận ra ô đã có thay vì chồng thêm ô thứ hai.
   */
  const CHECKBOX_PREFIX = `${S.EXT_PREFIX}playlist-pick-`;

  const CHECKBOX_TITLE = 'Chọn video này để import';

  const selectorsOf = (options) => {
    const given = options && options.selectors;
    if (!given) return Y.DEFAULT;
    return typeof given.css === 'function' ? given : Y.resolve(given);
  };

  const ownedNodes = (node, sel, key) => (node
    ? Array.from(node.querySelectorAll(sel.css(key))).filter((n) => !n.closest(sel.OWN_UI))
    : []);

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  // ------------------------------------------------------------------ đọc trang

  /** Link tương đối của trang thành URL đầy đủ — `parseVideoId` chỉ đọc được URL tuyệt đối. */
  function absoluteUrl(href) {
    const raw = S.collapse(href);
    if (!raw) return '';
    return raw.startsWith('/') ? `https://www.youtube.com${raw}` : raw;
  }

  /** Mọi dòng video trên trang, đã loại giao diện của chính extension. */
  function findRows(page, options) {
    return ownedNodes(page, selectorsOf(options), 'playlistRow');
  }

  /** videoId của một dòng, đọc từ link bên trong nó. Không đọc được thì dòng ấy không tick được. */
  function rowVideoId(row, options) {
    const sel = selectorsOf(options);
    for (const link of ownedNodes(row, sel, 'playlistRowLink')) {
      const id = S.parseVideoId(absoluteUrl(link.getAttribute('href')));
      if (id) return id;
    }
    return '';
  }

  /**
   * Tên playlist đọc từ trang. Chỉ là **chỗ đỡ tạm** cho lúc chưa liệt kê xong: tên thật lấy
   * từ chính phản hồi InnerTube, vì nó thành tên Nguồn gộp và Nguồn đã đẩy thì không sửa
   * được (ADR 0010).
   */
  function readPageTitle(page, options) {
    const node = ownedNodes(page, selectorsOf(options), 'playlistTitle')[0];
    return node ? S.collapse(node.textContent) : '';
  }

  /** Id kênh trên trang kênh: `/@handle` không mang `UC…`, nên phải đọc từ meta hoặc canonical. */
  function readChannelId(page, options) {
    const sel = selectorsOf(options);
    const meta = ownedNodes(page, sel, 'channelIdMeta')[0];
    const fromMeta = meta ? S.collapse(meta.getAttribute('content')) : '';
    if (/^UC[A-Za-z0-9_-]{2,}$/.test(fromMeta)) return fromMeta;

    const link = ownedNodes(page, sel, 'canonicalLink')[0];
    const match = (link ? S.collapse(link.getAttribute('href')) : '').match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
    return match ? match[1] : '';
  }

  /**
   * Playlist mà trang đang mở nói tới, hoặc `null`. Với kênh thì là playlist "đã tải lên"
   * (`UU…`) — một đường liệt kê cho cả hai loại trang, không phải hai.
   */
  function resolveTarget(url, page, options) {
    const found = PL.pageTarget(url);
    if (!found) return null;
    if (found.kind === 'playlist') return found;

    const channelId = found.channelId || readChannelId(page, options);
    const playlistId = PL.uploadsPlaylistId(channelId);
    return playlistId ? { kind: 'channel', playlistId, channelId } : null;
  }

  // ------------------------------------------------------------------ dựng thanh nổi

  const styled = (doc, tag, style) => {
    const node = doc.createElement(tag);
    node.setAttribute('style', style);
    return node;
  };

  /** Nút của thanh nổi. **Không** nhận id: id gắn ở chỗ gọi, bằng đúng tên hằng số (ticket 006). */
  function makeButton(doc, label, title, onClick) {
    const button = styled(doc, 'button',
      'font:inherit;padding:.3rem .6rem;border:0;border-radius:4px;cursor:pointer;'
      + 'background:rgba(255,255,255,.12);color:inherit;');
    button.setAttribute('type', 'button');
    button.setAttribute('title', title);
    button.append(label);
    button.addEventListener('click', onClick);
    return button;
  }

  /** Thay hẳn chữ của một node bằng từng dòng một, mỗi dòng một `<span>` (khuôn `say` của panel). */
  function setLines(doc, node, lines) {
    for (const child of Array.from(node.children)) child.remove();
    for (const line of lines || []) {
      const row = styled(doc, 'div', 'margin:.1rem 0;');
      row.append(String(line == null ? '' : line));
      node.append(row);
    }
  }

  function buildBar(doc, handlers) {
    const on = handlers || {};
    const bar = styled(doc, 'div',
      'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:22rem;padding:12px;'
      + 'border-radius:12px;background:rgba(20,20,20,.92);color:#fff;'
      + 'font:400 13px/1.5 Roboto,system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.4);');
    bar.setAttribute('id', BAR_ID);

    const count = styled(doc, 'p', 'margin:0 0 .35rem;font-weight:600;');
    count.setAttribute('id', COUNT_ID);

    const table = styled(doc, 'div', 'margin:0 0 .5rem;');
    table.setAttribute('id', TABLE_ID);

    const status = styled(doc, 'p', 'margin:.5rem 0 0;opacity:.75;white-space:pre-wrap;');
    status.setAttribute('id', STATUS_ID);

    const actions = styled(doc, 'div', 'display:flex;flex-wrap:wrap;gap:.35rem;');
    const listButton = makeButton(doc, 'Liệt kê cả playlist',
      'Gọi thẳng InnerTube và phân trang tới hết — không cần cuộn trang', () => on.list && on.list());
    listButton.setAttribute('id', LIST_ID);
    const allButton = makeButton(doc, 'Import toàn bộ',
      'Đưa mọi mục import được vào hàng đợi', () => on.importAll && on.importAll());
    allButton.setAttribute('id', ALL_ID);
    const selectedButton = makeButton(doc, 'Import mục đã chọn',
      'Chỉ đưa những mục đã tick vào hàng đợi', () => on.importSelected && on.importSelected());
    selectedButton.setAttribute('id', SELECTED_ID);
    const clearButton = makeButton(doc, 'Bỏ chọn hết', 'Gỡ mọi ô đã tick', () => on.clear && on.clear());
    clearButton.setAttribute('id', CLEAR_ID);
    for (const button of [listButton, allButton, selectedButton, clearButton]) actions.append(button);

    bar.append(count);
    bar.append(table);
    bar.append(actions);
    bar.append(status);
    return { root: bar, count, table, status, listButton, allButton, selectedButton, clearButton };
  }

  // ------------------------------------------------------------------ bộ điều khiển

  /**
   * Thanh nổi như một máy trạng thái nhỏ: (playlist đang mở, danh sách đã liệt kê, ô đã tick)
   * → một lượt vẽ. Mọi lối ra là adapter được tiêm (liệt kê, gửi vào hàng đợi), nên toàn bộ
   * đường đi kiểm được bằng cây giả.
   */
  function createController(deps) {
    const doc = deps.doc;
    const page = deps.root;
    const options = deps.options || {};
    const state = {
      playlistId: S.collapse(deps.playlistId),
      title: S.collapse(deps.title),
      listed: [],
      table: null,
      selected: new Set(),
      listing: false,
      /** Lý do lượt liệt kê gần nhất hỏng, hoặc rỗng. Nó phải sống tới lượt import kế tiếp. */
      problem: '',
      /** `close()` đã chạy. Một lượt liệt kê đang bay không được chạm trang sau mốc này. */
      closed: false,
    };

    const nodes = buildBar(doc, {
      list: () => list(),
      importAll: () => importAll(),
      importSelected: () => importSelected(),
      clear: () => clearSelection(),
    });

    /**
     * Dòng trạng thái: `notes` là những câu **phải sống sót** tới hết lượt, `message` là tin
     * mới nhất. Gộp chúng lại thay vì ghi đè, vì mọi `notes` ở đây đều nói "một mục đã biến
     * mất" — và một câu "Xong." đè lên đúng câu ấy là cách gọn nhất để gộp nguồn âm thầm nuốt
     * dữ liệu (ADR 0008).
     */
    function say(message, notes) {
      setLines(doc, nodes.status, [...(notes || []), String(message == null ? '' : message)]);
    }

    function renderCount() {
      setLines(doc, nodes.count, [
        `${state.listed.length ? `${state.listed.length} mục đã liệt kê` : 'Chưa liệt kê'}`
        + ` · ${state.selected.size} đã chọn`,
      ]);
      nodes.selectedButton.disabled = state.selected.size === 0;
      nodes.allButton.disabled = state.listing;
    }

    /** Ô tick của một videoId: đổi trạng thái, trả về trạng thái mới cho chính ô ấy. */
    function toggle(videoId) {
      if (state.selected.has(videoId)) state.selected.delete(videoId);
      else state.selected.add(videoId);
      renderCount();
      return state.selected.has(videoId);
    }

    /**
     * Gắn checkbox lên từng thumbnail. Chạy lại được nhiều lần: YouTube dựng thêm dòng khi
     * người dùng cuộn, còn ô đã gắn thì nhận ra bằng id và chỉ đồng bộ lại trạng thái tick —
     * không kiểm là mỗi lượt cuộn thêm một ô nữa trên cùng một dòng.
     */
    function mountCheckboxes() {
      const sel = selectorsOf(options);
      const seen = new Set();
      const boxes = [];

      for (const row of findRows(page, options)) {
        const videoId = rowVideoId(row, options);
        // Layout của kênh lồng renderer trong renderer, nên cùng một video ra hai "dòng".
        // Không khử là hai ô tick cho một video.
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);

        const existing = row.querySelector(`#${CHECKBOX_PREFIX}${videoId}`);
        if (existing) {
          existing.checked = state.selected.has(videoId);
          boxes.push(existing);
          continue;
        }

        const box = doc.createElement('input');
        box.setAttribute('id', `${CHECKBOX_PREFIX}${videoId}`);
        box.setAttribute('type', 'checkbox');
        box.setAttribute('title', CHECKBOX_TITLE);
        box.setAttribute('style', 'position:relative;z-index:1;margin:4px;width:18px;height:18px;cursor:pointer;');
        box.checked = state.selected.has(videoId);
        box.addEventListener('click', () => {
          box.checked = toggle(videoId);
        });
        (ownedNodes(row, sel, 'playlistRowThumb')[0] || row).append(box);
        boxes.push(box);
      }
      return boxes;
    }

    /** Mọi ô tick đang nằm trên trang — kể cả ô của dòng đã bị YouTube dựng lại quanh nó. */
    function checkboxes() {
      const sel = selectorsOf(options);
      return Array.from(page.querySelectorAll(sel.OWN_UI))
        .filter((node) => String(node.getAttribute('id') || '').startsWith(CHECKBOX_PREFIX));
    }

    function clearSelection() {
      state.selected.clear();
      for (const box of checkboxes()) box.checked = false;
      renderCount();
      say('Đã bỏ chọn hết.');
    }

    /**
     * Liệt kê tới hết qua cầu MAIN world, rồi dựng bảng xác nhận — **trước** khi trích mục
     * nào (ADR 0005, 0008). Danh sách bị cắt ngắn phải hiện thành chữ: một playlist 300 video
     * lấy về 100 trông y hệt một playlist 100 video.
     */
    async function list() {
      if (state.listing) return state.listed;
      state.listing = true;
      state.problem = '';
      renderCount();
      say('Đang liệt kê qua InnerTube…');
      try {
        const result = await deps.list(state.playlistId);
        // Liệt kê một playlist 300 video mất vài giây, và người dùng điều hướng SPA được giữa
        // chừng. Sau `close()` thì bộ điều khiển này không còn phục vụ trang đang mở nữa: mọi
        // thứ dưới đây chạm vào DOM *của trang*, nên chạy tiếp là gắn ô tick của playlist cũ
        // lên playlist mới — đúng hình mà đầu file cảnh báo.
        if (state.closed) return state.listed;
        state.listed = (result && result.items) || [];
        if (result && result.title) state.title = S.collapse(result.title);
        state.table = PL.confirmation(state.listed, options);

        const lines = [...state.table.lines];
        if (result && result.complete === false) {
          lines.push('CHƯA LẤY HẾT — InnerTube còn trang chưa phân tới, con số trên là của phần đã lấy.');
        }
        setLines(doc, nodes.table, lines);
        say(`Đã liệt kê ${state.listed.length} mục qua ${(result && result.pages) || 0} trang.`);
      } catch (error) {
        // Lý do được giữ lại chứ không chỉ in ra một lần: `importAll` gọi `list()` ngầm, và
        // dòng trạng thái kế tiếp sẽ đè lên câu này nếu nó không đi kèm như một `notes`.
        state.problem = messageOf(error);
        if (state.closed) return state.listed;
        say(state.problem);
      } finally {
        state.listing = false;
      }
      if (state.closed) return state.listed;
      mountCheckboxes();
      renderCount();
      return state.listed;
    }

    const ensureListed = async () => (state.listed.length > 0 ? state.listed : list());

    /** Lý do lượt liệt kê hỏng, ở dạng `notes` — để nó sống sót qua mọi dòng trạng thái sau đó. */
    const problems = () => (state.problem ? [state.problem] : []);

    /**
     * Đưa một danh sách vào hàng đợi. Số mục bị `queueItems` bỏ (không có quyền xem) được
     * nói ra ngay trong dòng trạng thái: gộp nguồn khiến mất một mục thành vô hình, nên mọi
     * chỗ mục biến mất đều phải có một dòng (ADR 0008).
     */
    async function send(chosen, what, notes) {
      const kept = notes ? [...notes] : [];
      const items = PL.queueItems(chosen, PL.groupFor(state.playlistId, state.title));
      const dropped = chosen.length - items.length;
      if (dropped > 0) kept.push(`Đã bỏ ${dropped} mục không có quyền xem — chúng không vào hàng đợi.`);
      if (items.length === 0) {
        say(`Không có mục nào import được (${what}).`, kept);
        return null;
      }

      say(`Đang import ${items.length} mục (${what})…`, kept);
      const answer = await deps.send(items);
      if (answer && answer.ok) say((answer.result && answer.result.summary) || 'Xong.', kept);
      else say((answer && answer.error) || 'service worker không trả lời', kept);
      return answer;
    }

    /** Import cả playlist: **danh sách đầy đủ**, không phải phần đang tick. */
    async function importAll() {
      const listed = await ensureListed();
      return send(listed, 'toàn bộ', problems());
    }

    /**
     * Import phần đã tick: **chỉ những mục đang chọn**.
     *
     * Hai hàm này nhận hai danh sách cùng kiểu, và hoán vị chúng vẫn cho một lần import chạy
     * trót lọt — chỉ là "chọn 3 video" thành import cả 300, tiêu trọn quota của một notebook
     * mà không có lỗi nào. `test/playlist-bar.test.js` chốt đúng cặp này.
     */
    async function importSelected() {
      await ensureListed();
      // Lọc **theo danh sách playlist**, không duyệt theo `state.selected`: thứ tự chèn của
      // một Set là thứ tự người dùng bấm chuột, mà thứ tự ấy quyết định nội dung Nguồn gộp và
      // cả ranh giới cắt "Phần N" (ADR 0002, 0005) — hai lần chọn cùng một tập video theo thứ
      // tự bấm khác nhau sẽ ra hai Nguồn khác nhau mang cùng một tên (ADR 0010).
      const picked = state.selected;
      const chosen = state.listed.filter((item) => picked.has(item.id));
      const known = new Set(state.listed.map((item) => item.id));
      const missing = [...picked].filter((id) => !known.has(id));

      // Tick một dòng không nằm trong playlist (kệ đề xuất chẳng hạn) thì nó không import
      // được — nhưng phải nói ra, và câu ấy phải còn đó lúc lượt import báo xong.
      const notes = [
        ...problems(),
        ...(missing.length
          ? [`${missing.length} mục đã tick không có trong danh sách playlist: ${missing.join(', ')}`]
          : []),
      ];
      if (chosen.length === 0) {
        say('Chưa chọn mục nào import được.', notes);
        return null;
      }
      return send(chosen, 'mục đã chọn', notes);
    }

    /** Treo thanh nổi lên trang và đồng bộ ô tick. Gọi lại được ở mỗi lượt điều hướng SPA. */
    function mount() {
      if (!nodes.root.parentElement) {
        const host = deps.host || (doc.body || null);
        if (host) host.append(nodes.root);
      }
      mountCheckboxes();
      renderCount();
      return nodes.root;
    }

    /**
     * Dọn sạch: gỡ thanh nổi **và** mọi ô tick còn nằm trên trang.
     *
     * Gỡ mỗi thanh nổi là chưa đủ. Ô tick nằm trong DOM *của trang*, không nằm trong thanh —
     * bỏ quên chúng thì sang playlist khác người dùng thấy vài dòng đã tick sẵn, tick bởi một
     * bộ điều khiển không còn tồn tại, và không nút nào bỏ chọn được chúng nữa.
     */
    function close() {
      state.closed = true;
      for (const box of checkboxes()) box.remove();
      nodes.root.remove();
      state.selected.clear();
      state.listed = [];
      state.table = null;
    }

    renderCount();
    return {
      nodes,
      state: () => state,
      mount,
      close,
      list,
      toggle,
      importAll,
      importSelected,
      clearSelection,
      checkboxes,
    };
  }

  // ------------------------------------------------------------------ cài vào trang

  /**
   * Cài thanh nổi vào một trang.
   *
   * `deps` chỉ để mở seam: mặc định vẫn là `W.createTab(target)` và `createController`, nên
   * hành vi trên trang thật không đổi. Nhưng tự tạo chúng bên trong thì thứ duy nhất không
   * kiểm được lại đúng là thứ nguy hiểm nhất — việc dọn khi YouTube đổi playlist.
   *
   * Dùng chung `createTab` với trang watch chứ không dựng cầu MAIN world thứ hai: hai lớp bọc
   * postMessage trên cùng một cửa sổ là hai listener cùng nghe một kênh.
   */
  function install(target, deps) {
    const doc = target.document;
    const given = deps || {};
    if (!given.tab && (!target.chrome || !target.chrome.runtime)) return null;

    const tab = given.tab || W.createTab(target);
    const makeController = given.makeController || createController;
    let controller = null;
    /** Playlist mà thanh nổi đang phục vụ. Chuỗi rỗng nghĩa là trang này không có thanh nổi. */
    let mounted = '';

    async function syncOnce() {
      const options = await tab.options();
      const found = resolveTarget(target.location.href, doc, options);
      const playlistId = found ? found.playlistId : '';

      if (playlistId !== mounted) {
        // Đổi playlist — hoặc rời hẳn khỏi trang playlist. Danh sách đã liệt kê, bảng xác
        // nhận và các ô đã tick đều là của playlist cũ; để chúng sống tiếp là dựng một màn
        // hình "chạy được" mô tả sai hẳn trang đang mở.
        if (controller) {
          controller.close();
          controller = null;
        }
        mounted = playlistId;
      }
      if (!playlistId) return null;

      if (!controller) {
        controller = makeController({
          doc,
          root: doc,
          options,
          playlistId,
          title: readPageTitle(doc, options),
          list: (id) => PL.listPlaylist({ request: tab.bridge.request, playlistId: id, options }),
          send: (items) => tab.send({ type: M.TYPES.IMPORT_VIDEO, items }),
          host: doc.body,
        });
      }
      controller.mount();
      return controller;
    }

    // Một dây chuyền cho mọi lượt đồng bộ: hai sự kiện SPA bắn sát nhau đều `await` cùng một
    // `tab.options()`, và hai lượt chồng nhau sẽ dựng hai thanh nổi cho cùng một trang.
    let chain = Promise.resolve(null);
    const sync = () => {
      chain = chain.then(syncOnce, syncOnce);
      return chain;
    };

    sync();
    for (const event of ['yt-navigate-finish', 'yt-page-data-updated']) doc.addEventListener(event, () => sync());
    return { sync };
  }

  root.NBLM_PLAYLIST_BAR = Object.freeze({
    BAR_ID,
    TABLE_ID,
    COUNT_ID,
    STATUS_ID,
    LIST_ID,
    ALL_ID,
    SELECTED_ID,
    CLEAR_ID,
    CHECKBOX_PREFIX,
    absoluteUrl,
    findRows,
    rowVideoId,
    readPageTitle,
    readChannelId,
    resolveTarget,
    buildBar,
    createController,
    install,
  });

  if (root.document && root.chrome && root.chrome.runtime) install(root);
})(typeof globalThis !== 'undefined' ? globalThis : self);
