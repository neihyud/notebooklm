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

  root.NBLM_DOCS_SIDEBAR = { detect, usableUrl, countLinks };
})(globalThis);
