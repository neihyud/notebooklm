// Bảng chọn Nhánh tài liệu: dựng lại cây mục lục của sidebar để người dùng tick chọn — ticket 009.
//
// Phần thuần (dò sidebar, dựng cây, lọc, lấy cả nhánh) nằm ở `src/docs/sidebar.js`; ở đây chỉ
// còn cây node và một bộ điều khiển, đúng khuôn `src/youtube/panel.js` và `playlist-bar.js`.
//
// **Shadow DOM**, không phải một `<div>` trần. Khác YouTube ở chỗ này: ở đó extension chỉ chạy
// trên một sản phẩm với một bộ CSS đã biết, còn ở đây trang nào cũng có thể là trang docs, và
// một luật `div { display: block !important }` hay `input { appearance: none }` của theme là đủ
// để Bảng chọn thành một cột chữ không tick được. Cây shadow cắt cả hai chiều: CSS trang không
// vào được, và **lượt quét của trang không thấy nó** — kể cả lượt quét của chính `findSidebar`,
// thứ đang đi tìm đúng cái hình dạng mà Bảng chọn có (một cột hẹp đầy link cùng site).
//
// Thứ nguy hiểm nhất ở đây không phải việc vẽ mà là việc **dọn**, y như ticket 006 và 007. Cây
// mục lục này thuộc về *một trang cụ thể*, và trang docs đổi trang mà không tải lại: docsify đi
// bằng `#/a → #/b`, Docusaurus và VitePress đi bằng `pushState`. Bảng chọn cũ treo lại là một
// màn hình đầy mục, tick được, import được — của một sidebar không còn trên màn hình. Vì vậy có
// **hai** lớp dọn, mỗi lớp một test: nghe `hashchange`/`popstate`, và mỗi lượt mở so lại URL
// (`pushState` không bắn sự kiện nào cả).
//
// Không selector nào của trang trong file này: mọi thứ dễ vỡ nằm ở `src/docs/selectors.js`.
(function (root) {
  'use strict';

  if (root.NBLM_DOCS_PICKER) return;

  const S = root.NBLM_SHARED;
  const B = root.NBLM_DOCS_SIDEBAR;
  if (!S) throw new Error('docs/picker: cần src/common/shared.js nạp trước');
  if (!B) throw new Error('docs/picker: cần src/docs/sidebar.js nạp trước');

  /** Mọi id suy từ `EXT_PREFIX`: đó là thứ `OWN_UI` dùng để loại giao diện của chính mình. */
  const HOST_ID = `${S.EXT_PREFIX}doc-picker-host`;
  const PANEL_ID = `${S.EXT_PREFIX}doc-picker`;
  const FILTER_ID = `${S.EXT_PREFIX}doc-picker-filter`;
  const COUNT_ID = `${S.EXT_PREFIX}doc-picker-count`;
  const TREE_ID = `${S.EXT_PREFIX}doc-picker-tree`;
  const STATUS_ID = `${S.EXT_PREFIX}doc-picker-status`;
  const IMPORT_ID = `${S.EXT_PREFIX}doc-picker-import`;
  const CLEAR_ID = `${S.EXT_PREFIX}doc-picker-clear`;
  const CLOSE_ID = `${S.EXT_PREFIX}doc-picker-close`;
  /** Ô tick của một mục mang chính id của mục trong cây — nhờ vậy lượt vẽ sau tìm lại được nó. */
  const PICK_PREFIX = `${S.EXT_PREFIX}doc-pick-`;

  const FILTER_PLACEHOLDER = 'Lọc mục trong sidebar (gõ không dấu vẫn khớp)';

  /**
   * CSS nằm trong cây shadow nên nó chỉ áp cho Bảng chọn, và ngược lại CSS của trang không với
   * tới đây. `all: initial` ở gốc cắt nốt phần thừa kế.
   */
  const STYLE = `
    :host { all: initial; }
    .panel {
      position: fixed; right: 16px; top: 16px; z-index: 2147483000; width: 22rem;
      max-height: 80vh; display: flex; flex-direction: column; gap: .4rem; padding: 12px;
      border-radius: 12px; background: #1b1b1f; color: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.45);
      font: 400 13px/1.5 system-ui, sans-serif;
    }
    .count { margin: 0; font-weight: 600; }
    .status { margin: 0; opacity: .75; white-space: pre-wrap; }
    .filter { box-sizing: border-box; width: 100%; padding: .35rem .5rem; border-radius: 6px;
      border: 1px solid rgba(255,255,255,.25); background: transparent; color: inherit; font: inherit; }
    .tree { overflow: auto; flex: 1 1 auto; }
    .row { display: flex; gap: .4rem; align-items: baseline; padding: .1rem 0; cursor: pointer; }
    .actions { display: flex; flex-wrap: wrap; gap: .35rem; }
    button { font: inherit; padding: .3rem .6rem; border: 0; border-radius: 4px; cursor: pointer;
      background: rgba(255,255,255,.12); color: inherit; }
  `;

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  const styled = (doc, tag, className) => {
    const node = doc.createElement(tag);
    if (className) node.setAttribute('class', className);
    return node;
  };

  /** Nút của Bảng chọn. **Không** nhận id: id gắn ở chỗ gọi, bằng đúng tên hằng số (ticket 006). */
  function makeButton(doc, label, title, onClick) {
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('title', title);
    button.append(label);
    button.addEventListener('click', onClick);
    return button;
  }

  /** Thay hẳn chữ của một node bằng một `<span>` dựng mới (khuôn `say` của panel transcript). */
  function setText(doc, node, text) {
    for (const child of Array.from(node.children)) child.remove();
    const line = doc.createElement('span');
    line.append(String(text == null ? '' : text));
    node.append(line);
  }

  // ------------------------------------------------------------------ chữ hiện ra

  /**
   * Dòng đếm — **hai con số, hai vai**: bao nhiêu mục đang hiện, và bao nhiêu mục đã tick.
   *
   * Hai số cùng kiểu đứng cạnh nhau trong một câu, nên hoán vị *nhãn* của chúng vẫn cho một câu
   * đọc trôi chảy và không đổi một con số nào — đúng anti-pattern v6 của `WORKSPACE_PROTOCOL.md`.
   * Con số đã chọn **không** đổi theo ô lọc: người dùng lọc để tìm, chứ không phải để bỏ chọn.
   */
  function countLine(state) {
    const total = state.pages;
    const chosen = state.chosen;
    const query = S.collapse(state.query);
    if (!query) return `${total} mục có link · ${chosen} đã chọn`;
    return `${state.shown}/${total} mục khớp "${query}" · ${chosen} đã chọn`;
  }

  /**
   * Câu nói **vì sao** Bảng chọn trông như đang trông thấy — thứ người dùng đọc để biết một
   * bảng gần rỗng là do trang không có sidebar hay do sidebar chỉ có mục lục trong trang.
   *
   * Ba kết cục là ba câu khác hẳn nhau, vì việc phải làm tiếp cũng khác hẳn. Câu của đường
   * `<ul>` mang **hai** con số cùng kiểu (số mục dựng được, số link thật trong sidebar): đó là
   * ranh giới giữa "xếp gọn lại" và "mất im lặng", nên mỗi số phải đứng cạnh đúng nhãn của nó.
   */
  function statusLine(found) {
    if (found.outcome === B.OUTCOME.ANCHORS_ONLY) {
      return `Sidebar chỉ có mục lục trong trang (${found.anchors} mục) — không có link điều hướng nào`
        + ' để import.';
    }
    if (found.outcome === B.OUTCOME.NONE) return 'Không tìm thấy sidebar nào trên trang này.';
    if (found.taken < found.total) {
      return `Dựng được ${found.taken} mục từ ${found.total} link trong sidebar`
        + ` — ${found.total - found.taken} link nằm ngoài cây mục lục.`;
    }
    return 'Tick một mục là chọn cả nhánh con của nó.';
  }

  // ------------------------------------------------------------------ dựng khung

  /**
   * Khung Bảng chọn, dựng **trong cây shadow** của một host trần.
   *
   * `attachShadow` là bắt buộc, không có lối lui: dựng thẳng vào trang khi thiếu nó là để CSS
   * của theme quyết định Bảng chọn trông ra sao, và tệ hơn, để `findSidebar` dò trúng chính
   * Bảng chọn ở lượt mở sau. Thà hỏng to còn hơn hỏng theo kiểu chỉ vài trang mới lộ.
   */
  function buildPicker(doc, handlers) {
    const on = handlers || {};
    const host = doc.createElement('div');
    host.setAttribute('id', HOST_ID);
    if (typeof host.attachShadow !== 'function') throw new Error('docs/picker: trình duyệt không có shadow DOM');
    const shadow = host.attachShadow({ mode: 'open' });

    const style = doc.createElement('style');
    style.append(STYLE);

    const panel = styled(doc, 'div', 'panel');
    panel.setAttribute('id', PANEL_ID);

    const count = styled(doc, 'p', 'count');
    count.setAttribute('id', COUNT_ID);

    const filter = styled(doc, 'input', 'filter');
    filter.setAttribute('id', FILTER_ID);
    filter.setAttribute('type', 'search');
    filter.setAttribute('placeholder', FILTER_PLACEHOLDER);
    filter.addEventListener('input', () => on.filter && on.filter(filter.value));

    const tree = styled(doc, 'div', 'tree');
    tree.setAttribute('id', TREE_ID);

    const status = styled(doc, 'p', 'status');
    status.setAttribute('id', STATUS_ID);

    const actions = styled(doc, 'div', 'actions');
    const importButton = makeButton(doc, 'Import mục đã chọn',
      'Đưa mọi trang đã tick vào hàng đợi tài liệu', () => on.importSelected && on.importSelected());
    importButton.setAttribute('id', IMPORT_ID);
    const clearButton = makeButton(doc, 'Bỏ chọn hết', 'Gỡ mọi mục đã tick', () => on.clear && on.clear());
    clearButton.setAttribute('id', CLEAR_ID);
    const closeButton = makeButton(doc, 'Đóng', 'Đóng Bảng chọn', () => on.close && on.close());
    closeButton.setAttribute('id', CLOSE_ID);
    for (const button of [importButton, clearButton, closeButton]) actions.append(button);

    panel.append(count);
    panel.append(filter);
    panel.append(tree);
    panel.append(status);
    panel.append(actions);
    shadow.append(style);
    shadow.append(panel);

    return { host, shadow, root: panel, count, filter, tree, status, actions, importButton, clearButton, closeButton };
  }

  // ------------------------------------------------------------------ bộ điều khiển

  /**
   * Bảng chọn như một máy trạng thái nhỏ: (cây mục lục của trang này, chữ đang lọc, tập đã
   * tick) → một lượt vẽ. Lối ra duy nhất — gửi vào hàng đợi — là adapter được tiêm.
   */
  function createController(deps) {
    const doc = deps.doc;
    const options = deps.options || {};
    const pageUrl = S.collapse(deps.page);
    const state = {
      /** Định danh **trang** mà Bảng chọn này phục vụ. Khác nó là một Bảng chọn khác. */
      page: S.docPageId(pageUrl),
      nodes: [],
      tree: { via: 'none', taken: 0, total: 0 },
      outcome: B.OUTCOME.NONE,
      anchors: 0,
      selected: new Set(),
      query: '',
    };
    /** Tra mục theo id trên **cây gốc**, không trên cây đã lọc — xem `toggle`. */
    const byId = new Map();
    /** Ô tick đang hiện, theo id mục. Đổi tại chỗ thay vì vẽ lại: vẽ lại là xoá cái vừa bấm. */
    let boxes = new Map();

    const nodes = buildPicker(doc, {
      filter: (value) => setQuery(value),
      importSelected: () => importSelected(),
      clear: () => clearSelection(),
      close: () => close(),
    });

    const say = (message) => setText(doc, nodes.status, message);

    function renderCount() {
      const visible = B.filterNodes(state.nodes, state.query);
      setText(doc, nodes.count, countLine({
        pages: B.countPages(state.nodes),
        shown: B.countPages(visible),
        chosen: selection().length,
        query: state.query,
      }));
      nodes.importButton.disabled = selection().length === 0;
    }

    /** Vẽ lại danh sách mục từ cây đã lọc. Mỗi dòng: một ô tick, thụt vào theo cấp. */
    function renderTree() {
      for (const child of Array.from(nodes.tree.children)) child.remove();
      boxes = new Map();
      for (const node of B.flatten(B.filterNodes(state.nodes, state.query))) {
        const row = styled(doc, 'label', 'row');
        row.setAttribute('style', `padding-left:${node.depth}rem`);
        if (node.url) row.setAttribute('title', node.url);

        const box = doc.createElement('input');
        box.setAttribute('id', `${PICK_PREFIX}${node.id}`);
        box.setAttribute('type', 'checkbox');
        box.checked = state.selected.has(node.id);
        box.addEventListener('click', () => toggle(node.id));

        const text = doc.createElement('span');
        text.append(node.label || '(không có tên)');
        row.append(box);
        row.append(text);
        nodes.tree.append(row);
        boxes.set(node.id, box);
      }
    }

    /** Đồng bộ ô tick đang hiện với tập đã chọn — không dựng lại dòng nào. */
    function syncBoxes() {
      for (const [id, box] of boxes) box.checked = state.selected.has(id);
    }

    /**
     * Tick một mục là tick **cả nhánh con** của nó, và mục được tra trên **cây gốc**.
     *
     * Tra trên cây đã lọc thì "Hướng dẫn" nghĩa là bốn trang hay hai trang tuỳ vào chữ đang gõ
     * trong ô lọc — mà lần import vẫn chạy trót lọt từ đầu tới cuối. Cùng bài học chỉ-số-sau-lọc
     * của panel transcript (ticket 006).
     */
    function toggle(id) {
      const node = byId.get(id);
      if (!node) return false;
      const family = B.branch(node);
      const turningOn = !state.selected.has(id);
      for (const member of family) {
        if (turningOn) state.selected.add(member.id);
        else state.selected.delete(member.id);
      }
      syncBoxes();
      renderCount();
      return turningOn;
    }

    /**
     * Những trang sẽ được gửi đi, theo **thứ tự cây** — thứ tự người dùng nhìn thấy trên màn
     * hình, không phải thứ tự họ bấm chuột. Thứ tự này quyết định nội dung Nguồn gộp và ranh
     * giới cắt "Phần N" (ADR 0002, 0005), nên hai lần chọn cùng một tập trang phải ra đúng một
     * Nguồn (bài học ticket 007).
     */
    function selection() {
      return B.flatten(state.nodes)
        .filter((node) => node.url && state.selected.has(node.id))
        .map((node) => ({ url: node.url, title: node.label }));
    }

    function setQuery(value) {
      state.query = String(value == null ? '' : value);
      renderTree();
      renderCount();
    }

    function clearSelection() {
      state.selected.clear();
      syncBoxes();
      renderCount();
      say('Đã bỏ chọn hết.');
    }

    /** Không gửi một danh sách rỗng đi: một lần chạy không có nội dung nào trông y hệt một lần hỏng. */
    async function importSelected() {
      const items = selection();
      if (items.length === 0) {
        say('Chưa chọn mục nào để import.');
        return null;
      }
      if (typeof deps.send !== 'function') {
        say(`Chưa nối hàng đợi tài liệu — ${items.length} trang đã chọn chưa gửi đi được.`);
        return null;
      }
      say(`Đang import ${items.length} trang…`);
      try {
        const answer = await deps.send(items);
        if (answer && answer.ok) say((answer.result && answer.result.summary) || `Đã gửi ${items.length} trang.`);
        else say((answer && answer.error) || 'service worker không trả lời');
        return answer;
      } catch (error) {
        say(messageOf(error));
        return null;
      }
    }

    /**
     * Mở Bảng chọn: dò sidebar của trang **này**, dựng cây, treo lên trang.
     *
     * Dò một lần cho mỗi lần mở, và cây thu được gắn với `state.page`. Không có đường nào để
     * một bộ điều khiển đọc lại sidebar của trang khác: đổi trang là dựng bộ điều khiển mới.
     */
    function open() {
      const found = B.readSidebar(deps.root, pageUrl, options);
      state.outcome = found.outcome;
      state.nodes = found.nodes;
      state.anchors = found.anchors;
      state.tree = { via: found.via, taken: found.taken, total: found.total };
      state.selected.clear();
      byId.clear();
      for (const node of B.flatten(found.nodes)) byId.set(node.id, node);

      if (!nodes.host.parentElement && deps.host) deps.host.append(nodes.host);
      renderTree();
      renderCount();
      say(statusLine(found));
      return state;
    }

    /** Gỡ hẳn khỏi trang. Cây shadow đi theo host, nên không còn mảnh nào ở lại. */
    function close() {
      nodes.host.remove();
      state.selected.clear();
    }

    renderCount();
    return {
      nodes,
      state: () => state,
      open,
      close,
      toggle,
      setQuery,
      selection,
      clearSelection,
      importSelected,
    };
  }

  // ------------------------------------------------------------------ cài vào trang

  /**
   * Cài Bảng chọn vào một trang tài liệu.
   *
   * `deps` chỉ để mở seam: mặc định vẫn là `createController`, nên hành vi trên trang thật
   * không đổi. Nhưng tự tạo nó bên trong thì thứ **duy nhất** không kiểm được lại đúng là thứ
   * nguy hiểm nhất — dọn Bảng chọn khi trang docs đổi trang mà không tải lại.
   *
   * Hai lớp dọn, vì một lớp không đủ:
   *   1. `hashchange`/`popstate` — docsify đi bằng hash, và nút lùi của trình duyệt bắn `popstate`.
   *   2. Mỗi lượt mở so lại URL. `pushState` (Docusaurus, VitePress) **không bắn sự kiện nào**,
   *      nên nếu chỉ có lớp 1 thì Bảng chọn của trang A mở lại nguyên vẹn trên trang B.
   */
  function install(target, deps) {
    const doc = target.document;
    const given = deps || {};
    if (!given.makeController && (!target.chrome || !target.chrome.runtime)) return null;

    const makeController = given.makeController || createController;
    let controller = null;

    function discard() {
      if (!controller) return;
      controller.close();
      controller = null;
    }

    function open() {
      const here = S.docPageId(target.location.href);
      if (!here) return null;
      // Cây mục lục đang treo là của trang nào? Khác trang đang đứng thì nó không mô tả màn
      // hình này nữa — và một Bảng chọn mô tả sai trang vẫn tick được, vẫn import được.
      if (controller && controller.state().page !== here) discard();
      if (!controller) {
        controller = makeController({
          doc,
          root: doc.body || doc,
          host: doc.body || null,
          page: target.location.href,
          options: given.options || {},
          send: given.send,
        });
      }
      controller.open();
      return controller;
    }

    const onNavigate = () => {
      if (controller && controller.state().page !== S.docPageId(target.location.href)) discard();
    };
    for (const event of ['hashchange', 'popstate']) target.addEventListener(event, onNavigate);

    return { open, close: discard, onNavigate };
  }

  root.NBLM_DOCS_PICKER = Object.freeze({
    HOST_ID,
    PANEL_ID,
    FILTER_ID,
    COUNT_ID,
    TREE_ID,
    STATUS_ID,
    IMPORT_ID,
    CLEAR_ID,
    CLOSE_ID,
    PICK_PREFIX,
    STYLE,
    countLine,
    statusLine,
    buildPicker,
    createController,
    install,
  });

  // Không tự `install(root)` lúc nạp như `panel.js`/`playlist-bar.js`: ở đó `install` tự gắn
  // luôn nút bấm, còn ở đây chưa có nút nào — nó chỉ đăng ký hai listener điều hướng ôm một
  // `controller` vĩnh viễn `null`, rồi ticket 010 lại phải gọi `install(window)` lần nữa để
  // lấy `open()`. Chỗ gọi là ticket 010, và nó giữ lấy giá trị trả về.
})(typeof globalThis !== 'undefined' ? globalThis : self);
