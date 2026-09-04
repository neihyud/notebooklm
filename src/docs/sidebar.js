/*
 * Dò khối điều hướng "sidebar" của một trang tài liệu và dựng lại nó thành cây.
 *
 * Không nhắm vào theme cụ thể nào: mỗi trang docs đặt tên class một kiểu và đổi
 * xoành xoạch. Thay vào đó ta *chấm điểm* mọi ứng viên theo dấu hiệu hành vi —
 * nhiều link cùng site, có lồng nhau, nằm ở cột hẹp, và (dấu hiệu mạnh nhất)
 * chứa link trỏ về chính trang đang mở.
 *
 * Chỉ chạy trên DOM sống nên được phép dùng getBoundingClientRect.
 */
;(function (root) {
  'use strict';

  const { isHashRoute } = root.NBLM;

  const CANDIDATE_SELECTORS = [
    'nav', 'aside', '[role="navigation"]',
    '.theme-doc-sidebar-container', '.menu.thin-scrollbar',   // Docusaurus
    '.md-nav--primary', '.md-sidebar--primary',               // MkDocs Material
    '.wy-nav-side', '.sphinxsidebar', '.bd-sidebar',          // Sphinx / RTD
    '.VPSidebar',                                             // VitePress
    '.sidebar', '.docs-sidebar', '.side-nav', '.sidenav', '.docs-nav', '.toc-nav',
    '[class*="sidebar" i]', '[id*="sidebar" i]',
    '[class*="Sidebar" ]', '[data-testid*="sidebar" i]',
    '.sidebar-nav',                                           // docsify
  ];

  /* -------------------------------------------------------------------- */
  /* lọc link                                                              */
  /* -------------------------------------------------------------------- */

  /**
   * URL dùng được cho một mục sidebar, hoặc null.
   * Loại bỏ: khác site, giao thức lạ, và neo trong trang (mục lục "On this page"
   * — chúng trỏ về chính trang đang mở nên import vào là nhân bản trùng lặp).
   */
  function usableUrl(anchor, pageUrl) {
    const raw = anchor.getAttribute('href');
    if (!raw || /^\s*(javascript:|mailto:|tel:|data:|#$)/i.test(raw)) return null;

    let u;
    let page;
    try {
      page = new URL(pageUrl);
      u = new URL(raw, pageUrl);
    } catch (_) {
      return null;
    }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (u.host !== page.host) return null;

    if (u.hash) {
      if (isHashRoute(u.hash)) return u.toString(); // docsify & co: hash chính là trang
      if (u.pathname === page.pathname && u.search === page.search) return null; // neo trong trang
      u.hash = '';
    }
    return u.toString();
  }

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** Chữ của `el` sau khi trừ đi phần chữ của `minus` (danh sách con). */
  function ownText(el, minus) {
    if (!minus) return textOf(el);
    const clone = el.cloneNode(true);
    const path = indexPath(el, minus);
    const target = path && resolvePath(clone, path);
    if (target && target.parentNode) target.parentNode.removeChild(target);
    return textOf(clone);
  }

  function indexPath(ancestor, node) {
    const path = [];
    let current = node;
    while (current && current !== ancestor) {
      const parent = current.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    return current === ancestor ? path : null;
  }

  function resolvePath(node, path) {
    let current = node;
    for (const index of path) {
      current = current && current.childNodes[index];
      if (!current) return null;
    }
    return current;
  }

  /* -------------------------------------------------------------------- */
  /* chấm điểm ứng viên                                                    */
  /* -------------------------------------------------------------------- */

  function rate(el, pageUrl) {
    const links = [];
    const seen = new Set();
    let onCurrentPage = false;

    const pageKey = root.NBLM.docKey(pageUrl);
    for (const a of el.querySelectorAll('a[href]')) {
      const url = usableUrl(a, pageUrl);
      if (!url) continue;
      const key = root.NBLM.docKey(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      links.push(url);
      if (key === pageKey) onCurrentPage = true;
    }
    if (links.length < 3) return null;

    let points = links.length;
    if (onCurrentPage) points += 15;                                   // dấu hiệu mạnh nhất
    if (el.querySelector('ul ul, ol ol, ul ol, ol ul')) points += 8;   // có cấp bậc
    if (el.querySelector('ul li, ol li')) points += 4;
    if (/nav|aside/.test((el.tagName || '').toLowerCase())) points += 4;

    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (rect && rect.width > 0) {
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      if (rect.width < vw * 0.42) points += 8;                    // cột hẹp = sidebar
      if (rect.width > vw * 0.75 && rect.height < vh * 0.25) points -= 20; // thanh trên cùng
      if (rect.height < 60) points -= 15;
      if (rect.width === 0 || rect.height === 0) points -= 30;     // đang ẩn
    }

    // Khối khổng lồ thường là cả trang chứ không phải sidebar.
    if (links.length > 600) points -= 40;

    return { el, links: links.length, points, onCurrentPage };
  }

  /* -------------------------------------------------------------------- */
  /* dựng cây                                                              */
  /* -------------------------------------------------------------------- */

  const SUBLIST = [
    ':scope > ul', ':scope > ol',
    ':scope > nav > ul', ':scope > nav > ol',
    ':scope > div > ul', ':scope > div > ol',
    ':scope > details > ul', ':scope > details > ol', ':scope > details > div > ul',
    ':scope > .menu__list', ':scope > .md-nav > .md-nav__list',
  ].join(',');

  const OWN_LINK = [
    ':scope > a[href]',
    ':scope > div > a[href]',
    ':scope > span > a[href]',
    ':scope > summary a[href]',
    ':scope > .menu__list-item-collapsible > a[href]',
  ].join(',');

  const OWN_LABEL = ':scope > label, :scope > summary, :scope > .md-nav__link, :scope > span, :scope > div > span';

  function fromList(listEl, ctx, depth) {
    const nodes = [];
    for (const li of Array.from(listEl.children)) {
      if ((li.tagName || '').toLowerCase() !== 'li') continue;
      const node = fromItem(li, ctx, depth);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  function fromItem(li, ctx, depth) {
    const sub = li.querySelector(SUBLIST);
    const children = sub ? fromList(sub, ctx, depth + 1) : [];

    let anchor = li.querySelector(OWN_LINK);
    if (!anchor) {
      // Theme lồng link sâu hơn dự đoán — lấy link đầu tiên *không* thuộc danh sách con.
      for (const a of li.querySelectorAll('a[href]')) {
        if (!sub || !sub.contains(a)) {
          anchor = a;
          break;
        }
      }
    }
    const url = anchor ? usableUrl(anchor, ctx.pageUrl) : null;

    let title = anchor ? textOf(anchor) : '';
    if (!title) {
      const label = li.querySelector(OWN_LABEL);
      title = label ? textOf(label) : ownText(li, sub);
    }
    title = title.slice(0, 160);

    if (!url && !children.length) return null;
    if (url && !ctx.claim(url)) {
      // URL trùng mục đã dựng: giữ lại làm nhóm nếu còn con, ngược lại bỏ.
      if (!children.length) return null;
      return { title: title || root.NBLM.urlLabel(url), url: null, depth, children };
    }
    return { title: title || root.NBLM.urlLabel(url || ''), url, depth, children };
  }

  /** Sidebar không dùng <ul>: xếp phẳng theo thứ tự DOM, độ sâu suy từ mức lồng. */
  function fromFlat(container, ctx) {
    const rows = [];
    const depths = [];
    for (const a of container.querySelectorAll('a[href]')) {
      const url = usableUrl(a, ctx.pageUrl);
      if (!url || !ctx.claim(url)) continue;
      let level = 0;
      for (let el = a.parentElement; el && el !== container; el = el.parentElement) level++;
      depths.push(level);
      rows.push({ title: textOf(a).slice(0, 160) || root.NBLM.urlLabel(url), url, level, children: [] });
    }
    // Mức lồng DOM thô nhảy rất loạn — nén về 0,1,2… theo thứ hạng.
    const ranks = Array.from(new Set(depths)).sort((a, b) => a - b);
    for (const row of rows) {
      row.depth = Math.min(3, ranks.indexOf(row.level));
      delete row.level;
    }
    return rows;
  }

  /** Số link dùng được (đã khử trùng) thực sự nằm trong container. */
  function usableCount(container, pageUrl) {
    const keys = new Set();
    for (const a of container.querySelectorAll('a[href]')) {
      const url = usableUrl(a, pageUrl);
      const key = url && root.NBLM.docKey(url);
      if (key) keys.add(key);
    }
    return keys.size;
  }

  function build(container, pageUrl) {
    // Mỗi lần dựng phải có sổ "đã nhận" riêng: `claim()` chỉ cho mỗi URL xuất
    // hiện một lần, nên tái dùng ctx cũ cho lượt dựng thứ hai là mất sạch những
    // link lượt đầu đã nhận.
    const newCtx = () => {
      const claimed = new Set();
      return {
        pageUrl,
        claim(url) {
          const key = root.NBLM.docKey(url);
          if (!key || claimed.has(key)) return false;
          claimed.add(key);
          return true;
        },
      };
    };

    const lists = Array.from(container.querySelectorAll('ul, ol')).filter(
      (list) => !list.parentElement || !list.parentElement.closest('ul, ol')
    );

    const tree = [];
    for (const list of lists) tree.push(...fromList(list, newCtx(), 0));

    /*
     * Chỉ tin đường <ul> khi nó gom được *gần hết* link trong container.
     *
     * Đã xác minh trên trang thật: VitePress dựng sidebar bằng <div> lồng nhau,
     * không dùng <ul> — nhưng trong container vẫn lẫn một <ul> nhỏ. Ngưỡng cũ
     * ("có ≥3 link là xong") vì thế trả về một cây tí hon 5 link và bỏ sót 12
     * link còn lại, mà không có triệu chứng gì ngoài việc bảng chọn thiếu mục.
     */
    const total = usableCount(container, pageUrl);
    if (countLinks(tree) >= Math.max(3, Math.floor(total * 0.8))) return tree;

    return fromFlat(container, newCtx());
  }

  function countLinks(nodes) {
    let total = 0;
    for (const node of nodes) {
      if (node.url) total++;
      total += countLinks(node.children || []);
    }
    return total;
  }

  /* -------------------------------------------------------------------- */
  /* mở các section đang đóng                                              */
  /* -------------------------------------------------------------------- */

  /*
   * Vì sao phải bấm chứ không đọc thẳng DOM.
   *
   * Hai kiểu "đóng" trông giống nhau trên màn hình nhưng khác hẳn trong DOM:
   *
   *   - Đóng bằng CSS (MkDocs Material: checkbox + `~ nav`; `<details>` không
   *     `open`). Link con VẪN nằm trong DOM. Đo 2026-09-04 trên
   *     squidfunk.github.io/mkdocs-material/setup/: 73/95 thẻ `a` có rect 0×0
   *     mà `build()` vẫn dựng đủ 94 link. Ca này chưa bao giờ hỏng.
   *
   *   - Đóng bằng cách unmount (Docusaurus: React bỏ hẳn `<ul>` con khi
   *     collapsed). Link con KHÔNG tồn tại. Cùng ngày trên docusaurus.io/docs:
   *     `<li>` của category "Guides" có đúng 1 thẻ `a` và 0 thẻ `<ul>`. `detect()`
   *     trả về 9 link; mở hết ra thì thành 55 — sót 46 link, tức 5/6 sidebar.
   *
   * Không có cách nào đọc được ca thứ hai từ DOM tĩnh, nên ta bấm.
   *
   * Điều kiện dừng là SỐ LINK KHÔNG CÒN TĂNG, cố tình không phải "hết
   * `aria-expanded=false`". Cũng phép đo trên: sau khi mở hết, 5 nút vẫn khai
   * báo `aria-expanded="false"` trong khi `<li>` của chúng đã chứa 5, 36, 8, 12
   * và 8 thẻ `a` — React không đồng bộ lại thuộc tính. Lấy nó làm điều kiện dừng
   * là lặp vô hạn và bấm đóng lại những gì vừa mở.
   */

  const EXPANDER = [
    '[aria-expanded="false"]',
    'details:not([open]) > summary',
    '.menu__list-item--collapsed > .menu__list-item-collapsible > button',
  ].join(',');

  /** Trần vòng lặp: sidebar lồng sâu nhất đo được cần 3 vòng; 8 là dư dả mà vẫn hữu hạn. */
  const EXPAND_ROUNDS = 8;

  /*
   * Phải nhường lại luồng sau mỗi lượt bấm, nếu không hàm này không làm gì cả.
   *
   * React commit DOM ở macrotask KẾ TIẾP, không phải trong handler. Đo 2026-09-04
   * trên docusaurus.io/docs, bấm xong đếm link ngay: 10 (y nguyên); nhường một
   * `setTimeout(0)` rồi đếm: 30. Bản đồng bộ đầu tiên của hàm này vì thế luôn
   * thấy "không mọc thêm link" và thoát ngay vòng đầu — 9 link, đúng bằng lúc
   * chưa mở gì.
   *
   * 50ms chứ không phải 0: cùng phép đo cho thấy 0/16/50/200/600ms đều ra 30, nên
   * một macrotask là đủ về mặt cơ chế. Lấy 50 để còn chỗ cho máy chậm và cho
   * theme nào chờ transition rồi mới gắn DOM, mà tổng vẫn chỉ 8×50 = 400ms.
   */
  const EXPAND_SETTLE_MS = 50;

  const nextTick = () => new Promise((resolve) => setTimeout(resolve, EXPAND_SETTLE_MS));

  /**
   * Mở mọi section đóng trong `container`, tại chỗ.
   *
   * Bấm bằng chuỗi sự kiện chuột đầy đủ chứ không `el.click()`: React gắn
   * handler qua pointer event, và `.click()` một mình không mở được section nào
   * trên docusaurus.io (đo 2026-09-04: 6 vòng `.click()`, số link đứng nguyên 9).
   *
   * @returns {Promise<number>} số link dùng được sau khi mở.
   */
  async function expandAll(container, pageUrl) {
    let count = usableCount(container, pageUrl);

    /*
     * Mỗi phần tử chỉ được bấm MỘT lần trong cả lượt dựng.
     *
     * Không có sổ này thì lượt sau bấm lại chính nút vừa mở, và với nút toggle
     * (đa số) lần bấm thứ hai là ĐÓNG. Bản đầu tiên của hàm này dừng đúng lúc
     * "số link không tăng" — nhưng đó là *sau* khi cú bấm thừa đã đóng mất
     * section, nên nó trả về con số cũ đúng trong khi DOM thì đã hỏng. Ca 5 của
     * `test/sidebar-expand.test.js` ghim đúng chỗ này.
     */
    const pressed = new Set();

    for (let round = 0; round < EXPAND_ROUNDS; round++) {
      let targets;
      try {
        targets = container.querySelectorAll(EXPANDER);
      } catch (_) {
        break;
      }

      let hit = 0;
      for (const el of targets) {
        if (pressed.has(el)) continue;
        // Đừng bấm vào chính thẻ <a>: bấm là điều hướng, mất luôn trang đang mở.
        if ((el.tagName || '').toLowerCase() === 'a' && el.getAttribute('href')) continue;
        pressed.add(el);
        press(el);
        hit++;
      }
      if (!hit) break;   // không còn gì chưa bấm -> xong

      await nextTick();
      count = usableCount(container, pageUrl);
    }
    return count;
  }

  /*
   * `<details>` không cần đặt tay `open = true`: cả trình duyệt thật lẫn jsdom
   * đều tự mở khi `<summary>` nhận click, đúng như spec. Đo 2026-09-04 trên
   * Brave headless và jsdom 30 — cùng cho `open === true` chỉ nhờ chuỗi sự kiện.
   * Một dòng gán thêm ở đây là lớp phòng thủ không bao giờ chạy, và không test
   * nào phân biệt nổi có nó hay không.
   */
  function press(el) {
    try {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
    } catch (_) {
      // Trang chặn constructor sự kiện — thử đường thô rồi thôi.
      try { if (typeof el.click === 'function') el.click(); } catch (_) { /* bỏ qua mục này */ }
    }
  }

  /* -------------------------------------------------------------------- */
  /* api                                                                   */
  /* -------------------------------------------------------------------- */

  /**
   * Dò sidebar của trang hiện tại.
   * @returns {{tree:Array, count:number, container:Element, label:string}|null}
   */
  function detect() {
    const pageUrl = location.href;
    const seen = new Set();
    let best = null;

    for (const selector of CANDIDATE_SELECTORS) {
      let found;
      try {
        found = document.querySelectorAll(selector);
      } catch (_) {
        continue;
      }
      for (const el of found) {
        if (seen.has(el)) continue;
        seen.add(el);
        const rated = rate(el, pageUrl);
        if (rated && (!best || rated.points > best.points)) best = rated;
      }
    }
    if (!best) return null;

    // Ứng viên hay lồng nhau (aside > nav > ul). Khối con nào giữ đủ link thì
    // dùng khối con — càng hẹp càng ít dính rác header/footer.
    let container = best.el;
    for (;;) {
      const inner = Array.from(container.children)
        .map((child) => rate(child, pageUrl))
        .filter((r) => r && r.links >= best.links);
      if (!inner.length) break;
      container = inner.sort((a, b) => b.points - a.points)[0].el;
    }

    return pack(container, pageUrl);
  }

  function pack(container, pageUrl) {
    const tree = build(container, pageUrl);
    const count = countLinks(tree);
    if (count < 3) return null;

    return {
      tree,
      count,
      container,
      label: (container.getAttribute('aria-label') || '').trim(),
    };
  }

  /**
   * Dò sidebar, có mở các section đang đóng trước khi dựng cây.
   *
   * Tách hẳn khỏi `detect()` chứ không làm một cờ tuỳ chọn, vì hai hàm khác nhau
   * ở chỗ quan trọng hơn nhiều so với một tham số: hàm này **đụng vào trang của
   * người dùng** (bấm mở section, và không đóng lại). Chỉ gọi sau khi người dùng
   * đã tỏ ý muốn import — xem lời gọi trong `src/docs/content.js`.
   *
   * Bất đồng bộ là do React: xem `EXPAND_SETTLE_MS`.
   */
  async function detectExpanded() {
    const found = detect();
    if (!found) return null;
    await expandAll(found.container, location.href);
    // Dựng lại từ đầu trên DOM đã mở; `found.tree` dựng trước lúc bấm nên đã cũ.
    return pack(found.container, location.href) || found;
  }

  root.NBLM_DOCS_SIDEBAR = { detect, detectExpanded, usableUrl, countLinks, expandAll };
})(globalThis);
