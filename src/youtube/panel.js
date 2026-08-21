// Panel xem / tìm / tải transcript ngay trên trang watch — user story 13 và 14 của spec 0001.
//
// Panel **không** có đường trích riêng. Nó gọi đúng `extractHere` mà ticket 005 đã dựng
// (`src/youtube/watch.js`), nên nó chạy được với video private vì cùng một lý do: đường DOM là
// đường duy nhất chạy được ở đó (ADR 0003), và không chỗ nào ở đây giả định có `timedtext`.
// Cũng vì vậy nó không dựng file `.md`/`.srt`/`.vtt` lần thứ hai — `src/youtube/srt.js` đã
// làm việc đó cho Bản lưu, và một bản thứ hai là hai định dạng lệch nhau chờ ngày lộ ra.
//
// Seam 3 của spec: phần thuần (khớp tìm kiếm, dựng danh sách dòng, tính dòng đang phát) tách
// hẳn khỏi phần chạm `document`, và phần thuần là phần có test — `test/panel.test.js`.
//
// Không selector nào trong file này: mọi thứ dễ vỡ nằm ở `src/youtube/selectors.js`.
(function (root) {
  'use strict';

  if (root.NBLM_PANEL) return;

  const S = root.NBLM_SHARED;
  const Y = root.NBLM_YT_SELECTORS;
  const F = root.NBLM_TRANSCRIPT_FORMAT;
  const W = root.NBLM_WATCH;
  if (!S) throw new Error('youtube/panel: cần src/common/shared.js nạp trước');
  if (!Y) throw new Error('youtube/panel: cần src/youtube/selectors.js nạp trước');
  if (!F) throw new Error('youtube/panel: cần src/youtube/srt.js nạp trước');
  if (!W) throw new Error('youtube/panel: cần src/youtube/watch.js nạp trước');

  /**
   * Mọi id ở đây suy từ `EXT_PREFIX`, không viết tay chuỗi `nblm-`: đó là thứ `OWN_UI` dùng để
   * loại giao diện của chính extension ra khỏi mọi lượt quét trang. Nút này mang nhãn
   * "Transcript" và đứng ngay cạnh nút Transcript thật của YouTube — thiếu tiền tố là
   * `findTranscriptButton` bấm vào chính mình (bài học ticket 002).
   */
  const TOGGLE_ID = `${S.EXT_PREFIX}panel-button`;
  const PANEL_ID = `${S.EXT_PREFIX}panel`;
  const SEARCH_ID = `${S.EXT_PREFIX}panel-search`;
  const LIST_ID = `${S.EXT_PREFIX}panel-list`;
  const STATUS_ID = `${S.EXT_PREFIX}panel-status`;
  const COPY_ID = `${S.EXT_PREFIX}panel-copy`;
  const SAVE_IDS = Object.freeze({
    md: `${S.EXT_PREFIX}panel-save-md`,
    srt: `${S.EXT_PREFIX}panel-save-srt`,
    vtt: `${S.EXT_PREFIX}panel-save-vtt`,
  });

  const TOGGLE_LABEL = 'Transcript';
  const TOGGLE_TITLE = 'Mở panel transcript: tìm kiếm, nhảy đoạn, tải .md/.srt/.vtt';
  const SEARCH_PLACEHOLDER = 'Tìm trong transcript (gõ không dấu vẫn khớp)';

  const selectorsOf = (options) => {
    const given = options && options.selectors;
    if (!given) return Y.DEFAULT;
    return typeof given.css === 'function' ? given : Y.resolve(given);
  };

  const ownedNodes = (node, sel, key) => (node
    ? Array.from(node.querySelectorAll(sel.css(key))).filter((n) => !n.closest(sel.OWN_UI))
    : []);

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  /**
   * Số giây dùng được, hoặc `null`. `Number(null) === 0` và `Number('') === 0`: một player
   * chưa dựng xong trả về `null` sẽ thành mốc 0 giây, và panel sáng bừa dòng đầu như thể video
   * đang phát ở đó — sai mà trông hoàn toàn bình thường.
   */
  const number = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  // ------------------------------------------------------------------ phần thuần

  /**
   * Một dòng có khớp câu tìm kiếm không — **cả hai vế** đều bỏ dấu, nên "nguon" khớp "nguồn"
   * và "nguồn" cũng khớp một dòng viết không dấu.
   *
   * Bỏ dấu dùng `foldLabel` của Seam 1, tức `normalize('NFD')`: một bảng tra tay chép riêng
   * cho tiếng Việt sẽ trượt mọi thứ khác ("Café", "Ñandú") mà không ai thấy, và sẽ lệch dần
   * khỏi bảng mà phần khớp nhãn NotebookLM đang dùng.
   *
   * Thứ tự hai vế không đối xứng: **dòng chứa câu tìm**, không phải ngược lại. Hoán vị vẫn cho
   * một panel lọc được, chỉ là lọc ra toàn dòng ngắn.
   */
  function matchesQuery(text, query) {
    const needle = S.foldLabel(query);
    if (!needle) return true;
    return S.foldLabel(text).includes(needle);
  }

  /**
   * Segment thành dòng hiển thị: `{ index, start, end, stamp, text }`.
   *
   * `end` mượn của `withEnds` (`srt.js`) chứ không tính lại — đường DOM chỉ đọc được mốc bắt
   * đầu, và chính `end` là thứ quyết định dòng nào đang phát. Mốc hiện ra lấy từ `start`:
   * hoán vị `start` ↔ `end` vẫn ra một panel bấm được, chỉ là bấm đâu cũng nhảy trượt.
   *
   * Panel **không** gộp theo `mergeWindowSeconds`: gộp là chuyện của thân Nguồn `.md`, còn ở
   * đây mỗi lần gộp là một chỗ bấm nhảy đoạn bị mất.
   */
  function buildLines(segments, options) {
    return F.withEnds(segments, options).map((segment, index) => ({
      index,
      start: segment.start,
      end: segment.end,
      stamp: S.stamp(segment.start),
      text: segment.text,
    }));
  }

  /** Dòng khớp câu tìm, **giữ nguyên `index` gốc** — chỉ số sau lọc không trỏ đúng đoạn nào cả. */
  function filterLines(lines, query) {
    return (lines || []).filter((line) => matchesQuery(line.text, query));
  }

  /**
   * Dòng đang phát: dòng **chứa** mốc hiện tại, `start <= t < end`.
   *
   * Không phải "dòng có start gần nhất": ngoài khoảng transcript (video vừa mở, hoặc đã chạy
   * qua dòng cuối) thì không dòng nào đang phát, và sáng bừa dòng đầu là nói dối người đang
   * đọc. Trả về chỉ số trong `lines`, tức chỉ số gốc.
   */
  function activeIndex(lines, currentTime) {
    const t = number(currentTime);
    if (t === null) return -1;
    for (const line of lines || []) {
      if (t >= line.start && t < line.end) return line.index;
    }
    return -1;
  }

  /** Toàn bộ thứ cần để vẽ một lượt, tính bằng hàm thuần: dòng nào hiện, dòng nào đang phát. */
  function buildView(lines, options) {
    const opts = options || {};
    const all = lines || [];
    const visible = filterLines(all, opts.query);
    return {
      visible,
      active: activeIndex(all, opts.currentTime),
      total: all.length,
      shown: visible.length,
    };
  }

  /**
   * Một file để tải về: đúng `render` của Bản lưu, cộng thêm data URL để tải ngay trong tab.
   *
   * Data URL chứ không `URL.createObjectURL`: cùng lý do với `srt.js` — và thêm một lý do ở
   * đây là không phải nhớ `revokeObjectURL`, thứ mà quên đi thì rò bộ nhớ ngay trên tab người
   * dùng đang xem.
   */
  function renderFile(format, meta, segments, options) {
    const rendered = F.render(format, meta, segments, options);
    return { ...rendered, url: F.dataUrl(rendered.text, rendered.mime) };
  }

  // ------------------------------------------------------------------ phần chạm DOM

  /** Thẻ video của player, sau khi loại giao diện của chính extension. */
  function findVideo(root_, options) {
    return ownedNodes(root_, selectorsOf(options), 'playerVideo')[0] || null;
  }

  /** Cột phải. Không có thì người gọi tự quyết chỗ khác — panel treo ở đâu là chuyện của nó. */
  function findHost(root_, options) {
    return ownedNodes(root_, selectorsOf(options), 'secondaryColumn')[0] || null;
  }

  /**
   * Nhảy đoạn qua API của player **trên trang**: đặt `currentTime` của thẻ video.
   *
   * Không đổi `location` sang `&t=…`: đó là tải lại cả trang watch, mất luôn panel vừa mở và
   * mất luôn transcript vừa trích.
   */
  function seekTo(video, seconds) {
    const t = number(seconds);
    if (!video || t === null || t < 0) return false;
    video.currentTime = t;
    return true;
  }

  const styled = (doc, tag, style) => {
    const node = doc.createElement(tag);
    node.setAttribute('style', style);
    return node;
  };

  /**
   * Nút của panel. **Không** nhận id: nó được gắn ở chỗ gọi, bằng đúng tên hằng số.
   *
   * Đó là điều kiện để `test/ids.test.js` lần ra được id từ chính source — một id đi qua tham
   * số là một id mà lượt quét chỉ còn thấy chữ "id", và bất biến tiền tố lại thành lời hứa
   * suông ở đúng chỗ nó cần có tác dụng.
   */
  function makeButton(doc, label, title, onClick) {
    const button = styled(doc, 'button',
      'font:inherit;padding:.25rem .5rem;border:0;border-radius:4px;cursor:pointer;'
      + 'background:rgba(255,255,255,.1);color:inherit;');
    button.setAttribute('type', 'button');
    button.setAttribute('title', title);
    button.append(label);
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * Gắn nút mở panel vào hàng nút Like/Share, **một lần**.
   *
   * Dùng lại `findActionBar` của watch.js chứ không tự dò: hàng nút là selector của trang, và
   * nó chỉ được viết ở một chỗ. YouTube dựng lại hàng nút mỗi lần đổi video, nên hàm này bị
   * gọi lại nhiều lần trên cùng một trang — không kiểm nút đã có là mỗi lần điều hướng thêm
   * một nút nữa (bài học ticket 005).
   */
  function mountToggle(root_, doc, onActivate, options) {
    if (!root_ || !doc) return null;
    const existing = root_.querySelector(`#${TOGGLE_ID}`);
    if (existing) return existing;

    const bar = W.findActionBar(root_, options);
    if (!bar) return null;

    const button = doc.createElement('button');
    button.setAttribute('id', TOGGLE_ID);
    button.setAttribute('type', 'button');
    button.setAttribute('title', TOGGLE_TITLE);
    button.setAttribute(
      'style',
      'margin-left:8px;padding:0 12px;height:36px;border:0;border-radius:18px;cursor:pointer;'
      + 'font:500 14px/36px Roboto,system-ui,sans-serif;background:rgba(255,255,255,.1);color:inherit;',
    );
    button.append(TOGGLE_LABEL);
    if (typeof onActivate === 'function') button.addEventListener('click', onActivate);
    bar.append(button);
    return button;
  }

  /** Khung panel: ô tìm, dòng trạng thái, danh sách, và hàng nút sao chép / tải về. */
  function buildPanel(doc, handlers) {
    const on = handlers || {};
    const panel = styled(doc, 'div',
      'margin:0 0 16px;padding:12px;border-radius:12px;background:rgba(255,255,255,.06);'
      + 'font:400 13px/1.5 Roboto,system-ui,sans-serif;');
    panel.setAttribute('id', PANEL_ID);

    const search = styled(doc, 'input',
      'width:100%;box-sizing:border-box;padding:.4rem .5rem;border-radius:6px;'
      + 'border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit;');
    search.setAttribute('id', SEARCH_ID);
    search.setAttribute('type', 'search');
    search.setAttribute('placeholder', SEARCH_PLACEHOLDER);
    if (typeof on.search === 'function') search.addEventListener('input', on.search);

    const status = styled(doc, 'p', 'margin:.5rem 0;opacity:.7;white-space:pre-wrap;');
    status.setAttribute('id', STATUS_ID);

    const list = styled(doc, 'div', 'max-height:60vh;overflow:auto;');
    list.setAttribute('id', LIST_ID);

    const actions = styled(doc, 'div', 'display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.5rem;');
    const copy = makeButton(doc, 'Sao chép', 'Chép cả transcript vào clipboard', () => on.copy && on.copy());
    copy.setAttribute('id', COPY_ID);
    actions.append(copy);
    for (const format of F.FORMATS) {
      const save = makeButton(doc, `.${format}`, `Tải transcript dạng .${format}`, () => on.save && on.save(format));
      save.setAttribute('id', SAVE_IDS[format]);
      actions.append(save);
    }

    panel.append(search);
    panel.append(status);
    panel.append(list);
    panel.append(actions);
    return { root: panel, search, status, list, actions };
  }

  /**
   * Vẽ lại danh sách từ một `view` thuần. Mỗi dòng là (nút mốc, chữ): nút mang `line.start`
   * của **dòng gốc**, không phải vị trí của nó trong danh sách đã lọc.
   */
  function renderList(doc, list, view, onSeek) {
    for (const child of Array.from(list.children)) child.remove();
    const rows = new Map();

    for (const line of view.visible) {
      const row = styled(doc, 'div', 'display:flex;gap:.5rem;padding:.15rem 0;align-items:baseline;');
      const jump = styled(doc, 'button',
        'flex:0 0 auto;padding:0;border:0;background:transparent;color:#3ea6ff;cursor:pointer;'
        + 'font:inherit;font-variant-numeric:tabular-nums;');
      jump.setAttribute('type', 'button');
      jump.setAttribute('title', `Nhảy tới ${line.stamp}`);
      jump.append(line.stamp);
      jump.addEventListener('click', () => onSeek(line));

      const text = styled(doc, 'span', 'flex:1 1 auto;');
      text.append(line.text);

      row.append(jump);
      row.append(text);
      if (line.index === view.active) markActive(row, true);
      list.append(row);
      rows.set(line.index, row);
    }
    return rows;
  }

  function markActive(row, active) {
    if (active) {
      row.setAttribute('aria-current', 'true');
      row.setAttribute('style', 'display:flex;gap:.5rem;padding:.15rem 0;align-items:baseline;'
        + 'background:rgba(62,166,255,.15);border-radius:4px;');
      return;
    }
    row.removeAttribute('aria-current');
    row.setAttribute('style', 'display:flex;gap:.5rem;padding:.15rem 0;align-items:baseline;');
  }

  // ------------------------------------------------------------------ bộ điều khiển

  /**
   * Panel như một máy trạng thái nhỏ: (segment đã trích, câu tìm, mốc đang phát) → một lượt vẽ.
   *
   * Mọi lối ra là adapter được tiêm (trích, clipboard, tải về), nên toàn bộ đường đi kiểm được
   * bằng cây giả. Trích **một lần** cho mỗi lần mở: mở lại panel mà trích lại là bấm nút
   * Transcript của YouTube thêm một lượt nữa, tức là đóng đúng cái panel đang cần đọc.
   */
  function createController(deps) {
    const doc = deps.doc;
    const page = deps.root;
    const options = deps.options || {};
    const state = { meta: null, segments: [], lines: [], query: '', loading: false };
    let rows = new Map();
    let active = -1;

    const nodes = buildPanel(doc, {
      search: () => setQuery(nodes.search.value),
      copy: () => copy(),
      save: (format) => save(format),
    });

    const videoOf = () => (typeof deps.video === 'function' ? deps.video() : findVideo(page, options));

    /**
     * Dòng trạng thái. Chữ nằm trong một `<span>` dựng mới mỗi lượt, **không** append thẳng
     * vào `<p>`: `children` chỉ trả về phần tử, nên một text node append thẳng vào đó không
     * bao giờ xoá được và mọi thông báo nối đuôi nhau thành một dòng dài vô nghĩa.
     */
    function say(message) {
      for (const child of Array.from(nodes.status.children)) child.remove();
      const line = doc.createElement('span');
      line.append(String(message == null ? '' : message));
      nodes.status.append(line);
    }

    function render() {
      const view = buildView(state.lines, {
        query: state.query,
        currentTime: state.lines.length > 0 ? currentTime() : null,
      });
      rows = renderList(doc, nodes.list, view, (line) => seekTo(videoOf(), line.start));
      active = view.active;
      if (state.lines.length > 0) {
        say(view.shown === view.total
          ? `${view.total} dòng`
          : `${view.shown}/${view.total} dòng khớp "${S.collapse(state.query)}"`);
      }
    }

    const currentTime = () => {
      const video = videoOf();
      return video ? number(video.currentTime) : null;
    };

    /** Chỉ đổi dòng sáng, không dựng lại danh sách: `timeupdate` bắn vài lần mỗi giây. */
    function tick() {
      const next = activeIndex(state.lines, currentTime());
      if (next === active) return active;
      if (rows.has(active)) markActive(rows.get(active), false);
      if (rows.has(next)) markActive(rows.get(next), true);
      active = next;
      return active;
    }

    function setQuery(value) {
      state.query = String(value == null ? '' : value);
      render();
    }

    function attach() {
      if (nodes.root.parentElement) return;
      const host = findHost(page, options) || deps.fallbackHost || null;
      if (host) host.append(nodes.root);
    }

    /**
     * Mở panel. Lỗi trích **phải hiện ra thành chữ**: cửa sổ hẹp là điều kiện môi trường chứ
     * không phải lỗi, nhưng im lặng trả về một danh sách rỗng thì người dùng chỉ thấy một
     * panel hỏng không lời giải thích (spec 0001, mục Further Notes).
     */
    async function open() {
      attach();
      if (state.segments.length > 0 || state.loading) {
        render();
        return state;
      }
      state.loading = true;
      say('Đang trích transcript…');
      try {
        const result = await deps.extract();
        state.meta = (result && result.meta) || null;
        state.segments = (result && Array.isArray(result.segments)) ? result.segments : [];
        state.lines = buildLines(state.segments, options);
        if (state.lines.length === 0) say('Trích xong nhưng không có dòng nào đọc được.');
        render();
      } catch (error) {
        say(messageOf(error));
      } finally {
        state.loading = false;
      }
      return state;
    }

    /** Không có transcript thì không ghi ra một file rỗng — nó trông y hệt một file hỏng. */
    function ready() {
      if (state.segments.length > 0) return true;
      say('Chưa có transcript để lấy — mở panel và đợi trích xong đã.');
      return false;
    }

    function save(format) {
      if (!ready()) return null;
      try {
        const file = renderFile(format, state.meta, state.segments, options);
        deps.download(file);
        say(`Đã tải ${file.filename}`);
        return file;
      } catch (error) {
        say(messageOf(error));
        return null;
      }
    }

    async function copy() {
      if (!ready()) return false;
      try {
        const file = renderFile('md', state.meta, state.segments, options);
        await deps.clipboard.writeText(file.text);
        say(`Đã chép ${state.lines.length} dòng vào clipboard`);
        return true;
      } catch (error) {
        say(messageOf(error));
        return false;
      }
    }

    function close() {
      nodes.root.remove();
    }

    return { nodes, state: () => state, open, close, setQuery, tick, copy, save, render };
  }

  // ------------------------------------------------------------------ cài vào trang

  /** Tải file bằng chính tab: `<a download>` trỏ vào data URL. Không cần quyền `downloads`. */
  function downloadInTab(doc, file) {
    const link = doc.createElement('a');
    link.setAttribute('href', file.url);
    link.setAttribute('download', file.filename);
    link.setAttribute('style', 'display:none');
    doc.body.append(link);
    link.click();
    link.remove();
  }

  function install(target) {
    const doc = target.document;
    if (!target.chrome || !target.chrome.runtime) return null;

    const tab = W.createTab(target);
    let controller = null;
    /**
     * Thẻ video đã gắn listener. YouTube **dùng lại đúng một thẻ `<video>`** qua các lần điều
     * hướng SPA, nên gắn lại ở mỗi lần mở panel là chồng listener lên nhau; và listener đóng
     * gói biến `controller`, thứ bị đặt về `null` khi đổi video — không có `controller &&` thì
     * mỗi nhịp `timeupdate` sau đó là một TypeError, vài lần mỗi giây, suốt thời gian xem.
     */
    let watched = null;

    async function toggle() {
      const opts = await tab.options();
      if (!controller) {
        controller = createController({
          doc,
          root: doc,
          options: opts,
          extract: () => tab.extract(),
          clipboard: target.navigator.clipboard,
          download: (file) => downloadInTab(doc, file),
          fallbackHost: doc.body,
        });
      }
      const video = findVideo(doc, opts);
      if (video && video !== watched) {
        watched = video;
        video.addEventListener('timeupdate', () => controller && controller.tick());
      }
      await controller.open();
    }

    const mount = async () => mountToggle(doc, doc, toggle, await tab.options());
    mount();
    // YouTube là SPA: đổi video không tải lại trang, nó chỉ dựng lại hàng nút — và transcript
    // của video cũ không còn đúng nữa, nên panel đi theo nút.
    for (const event of ['yt-navigate-finish', 'yt-page-data-updated']) {
      doc.addEventListener(event, () => {
        if (controller) {
          controller.close();
          controller = null;
        }
        mount();
      });
    }
    return { toggle };
  }

  root.NBLM_PANEL = Object.freeze({
    TOGGLE_ID,
    PANEL_ID,
    SEARCH_ID,
    LIST_ID,
    STATUS_ID,
    COPY_ID,
    SAVE_IDS,
    TOGGLE_LABEL,
    matchesQuery,
    buildLines,
    filterLines,
    activeIndex,
    buildView,
    renderFile,
    findVideo,
    findHost,
    seekTo,
    mountToggle,
    buildPanel,
    renderList,
    createController,
    install,
  });

  if (root.document && root.chrome && root.chrome.runtime) install(root);
})(typeof globalThis !== 'undefined' ? globalThis : self);
