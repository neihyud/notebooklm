// Dò sidebar của một trang tài liệu và dựng lại cây mục lục — Seam 3: nhận cây node, trả dữ liệu.
//
// Cùng bài toán với `src/docs/extract.js` và cùng bẫy, chỉ đổi dấu: ở đó chữ nằm trong link bị
// **trừ** đi để sidebar rơi về 0; ở đây link chính là thứ đang tìm. Cả hai đều vấp cùng một
// chuyện — **điểm của khối cha luôn ≥ khối con**, nên "khối nhiều link nhất" luôn là `<body>` và
// Bảng chọn nào cũng mời import cả footer lẫn header. Hai thứ tách hai bên ra:
//
//   1. *Số link bão hoà.* Một khối 8 link và một khối 80 link đều "là một khối điều hướng" như
//      nhau, nên phần điểm ấy chạm trần ở `ENOUGH_LINKS`. Nhờ vậy khối cha thôi tự thắng khối
//      con chỉ vì nó ôm thêm cái footer.
//   2. *Bề ngang cột.* Đây là dấu hiệu duy nhất trong danh sách **giảm** khi đi lên phía cha:
//      sidebar là một cột hẹp, còn khối bọc nó thì rộng bằng cả trang.
//
// Dấu hiệu mạnh nhất vẫn là **có link trỏ về chính trang đang mở**: đúng một khối trên trang có
// nó, và khối ấy là sidebar. `S.normalizeDocUrl` một mình không đủ để thấy nó — nó trả `null`
// cho cả ba chuyện khác hẳn nhau (khác host, giao thức lạ, trỏ về chính trang đang mở), nên
// `linkKind` ở dưới phân biệt lại. Gộp ba chuyện ấy làm một là mất đúng dấu hiệu mạnh nhất.
//
// Hai chỗ mất dữ liệu **im lặng** mà file này canh — cả hai đều để Bảng chọn mở ra bình thường,
// vẫn đầy link, chỉ thiếu:
//
//   - *Ngưỡng của đường `<ul>`.* VitePress dựng sidebar bằng `<div>` lồng nhau nhưng vẫn lẫn
//     một `<ul>` nhỏ mấy link mạng xã hội. Ngưỡng kiểu "gom được ≥3 link là tin" đi theo đúng
//     cái `<ul>` ấy và trả về một cây ba mục. Ngưỡng đúng là **tỉ lệ trên số link thật trong
//     container** (`LIST_COVER_RATIO`), không phải một con số tuyệt đối.
//   - *Sổ "đã nhận".* Mỗi lượt dựng cây có sổ **của riêng nó**. Dùng chung thì lượt `<ul>` nhận
//     mất một phần link rồi lối xếp phẳng bỏ qua đúng những link đó vì sổ nói "nhận rồi".
//
// File này không chạm `chrome.*` và không chạm `document` toàn cục; bề ngang cột cũng là adapter
// được tiêm, nên toàn bộ kiểm được bằng cây giả — `test/docs-sidebar.test.js`.
(function (root) {
  'use strict';

  if (root.NBLM_DOCS_SIDEBAR) return;

  const S = root.NBLM_SHARED;
  const D = root.NBLM_DOCS_SELECTORS;
  if (!S) throw new Error('docs/sidebar: cần src/common/shared.js nạp trước');
  if (!D) throw new Error('docs/sidebar: cần src/docs/selectors.js nạp trước');

  /**
   * Trọng số của bốn dấu hiệu, **cùng một đơn vị** (điểm) và cùng thang [0..trọng số], nên hoán
   * vị hai cái bất kỳ vẫn cho một lượt dò chạy trót lọt và một Bảng chọn mở được — đúng hình
   * "hai con số cùng kiểu, mỗi số một vai trò" của `WORKSPACE_PROTOCOL.md` v7.
   *
   * Vai bắt buộc, và `test/docs-sidebar.test.js` canh đúng vai chứ không khoá con số:
   * `current` là dấu hiệu **mạnh nhất**, mạnh hơn cả hai dấu hiệu phụ cộng lại.
   */
  const WEIGHT = Object.freeze({
    /** Có bao nhiêu link cùng site — bão hoà ở `ENOUGH_LINKS`. */
    links: 10,
    /** Có `ul` lồng trong `ul`: một cây mục lục, không phải một hàng link ngang ở footer. */
    nested: 5,
    /** Cột càng hẹp so với khung nhìn càng giống sidebar. Dấu hiệu duy nhất giảm dần lên phía cha. */
    column: 8,
    /** Có link trỏ về **chính trang đang mở**. Đúng một khối trên trang có nó. */
    current: 20,
  });

  /**
   * Từ ngần này link trở lên thì phần điểm "số link" chạm trần. Đây là một **số đếm**, không
   * phải tỉ lệ — nó không thay chỗ cho hai ngưỡng dưới được.
   */
  const ENOUGH_LINKS = 8;

  /**
   * Thu hẹp: chỉ đi sâu vào khối con khi nó vẫn giữ ngần này phần **số link** của khối đang
   * đứng. Cao hơn `LIST_COVER_RATIO` một cách có chủ ý — hai vai ngược nhau:
   *
   *   - Thu hẹp **vứt hẳn** những link nằm ngoài khối con: chúng không bao giờ vào Bảng chọn,
   *     và người dùng không có cách nào biết chúng từng có.
   *   - Ngưỡng `<ul>` chỉ chọn giữa **hai lối xếp** của cùng một tập link, và lối kia (xếp
   *     phẳng) giữ đủ cả tập.
   *
   * Mất vĩnh viễn phải dè dặt hơn đổi cách xếp. Hoán vị hai con số này không làm hỏng lần chạy
   * nào — nó chỉ lặng lẽ cắt bớt sidebar ở đầu này và vứt cấp cha–con ở đầu kia.
   */
  const NARROW_RATIO = 0.9;
  /** Chỉ tin đường `<ul>` khi nó gom được ngần này phần số link **thật trong container**. */
  const LIST_COVER_RATIO = 0.8;

  const OUTCOME = Object.freeze({
    /** Dò được sidebar và nó có link điều hướng. */
    OK: 'ok',
    /** Có sidebar nhưng toàn neo trong trang (Sphinx thuần) — không có gì để import. */
    ANCHORS_ONLY: 'anchors-only',
    /** Không có link điều hướng nào trên trang. */
    NONE: 'none',
  });

  const selectorsOf = (options) => {
    const given = options && options.selectors;
    if (!given) return D.DEFAULT;
    return typeof given.css === 'function' ? given : D.resolve(given);
  };

  // ------------------------------------------------------------------ phân loại link

  /**
   * Một `href` trên trang tài liệu thuộc loại nào, và nếu import được thì định danh trang của nó.
   *
   * Bốn loại, và ba trong số đó `normalizeDocUrl` gộp chung thành `null`:
   *   - `nav`     — trang khác cùng site: một mục của Bảng chọn.
   *   - `current` — chính trang đang mở. Vẫn **import được** (nó cũng là một trang docs), nhưng
   *                 vai chính của nó là dấu hiệu: khối nào chứa nó thì khối ấy là sidebar.
   *   - `anchor`  — neo trong trang (`#cai-dat`). Không phải một trang; mục lục Sphinx toàn loại
   *                 này, và import vào là nhân bản đúng trang đang đọc.
   *   - `foreign` — khác host, giao thức lạ, hoặc rỗng.
   *
   * `#/guide/intro` kiểu docsify **không** phải neo: ở đó hash chính là đường dẫn trang, nên nó
   * là `nav`. Dấu `/` ngay sau `#` là chỗ phân biệt duy nhất giữa hai thứ trông giống hệt nhau.
   */
  function linkKind(href, pageUrl) {
    const raw = S.collapse(href);
    if (!raw) return { kind: 'foreign', url: '' };
    if (raw.startsWith('#') && !raw.startsWith('#/')) return { kind: 'anchor', url: '' };

    const url = S.normalizeDocUrl(raw, pageUrl);
    if (url) return { kind: 'nav', url };

    let absolute = '';
    try {
      absolute = new URL(raw, S.collapse(pageUrl) || undefined).href;
    } catch {
      return { kind: 'foreign', url: '' };
    }
    // Trang đang mở mang định danh của **chính nó**, không mang chuỗi `href` đã viết: `.`,
    // `./`, `/guide/cai-dat/` và `/guide/cai-dat#yeu-cau` là bốn cách viết của một trang.
    if (S.sameDocPage(absolute, pageUrl)) return { kind: 'current', url: S.docPageId(pageUrl) };
    return { kind: 'foreign', url: '' };
  }

  /** Chữ hiển thị của một mục, gộp khoảng trắng. */
  const labelOf = (node) => S.collapse(node ? node.textContent : '');

  /**
   * Mọi link **import được** trong một khối, theo thứ tự tài liệu: `nav` và `current`.
   *
   * Giao diện của chính extension bị loại trước mọi thứ khác — Bảng chọn cũng là một khối đầy
   * link cùng site nằm ngay trên trang, nên không loại là nó tự dò trúng chính mình (bài học
   * `OWN_UI` của ticket 002).
   */
  function navLinks(node, pageUrl, options) {
    const sel = selectorsOf(options);
    const out = [];
    if (!node) return out;
    for (const anchor of node.querySelectorAll(sel.css('link'))) {
      if (anchor.closest(sel.OWN_UI)) continue;
      const { kind, url } = linkKind(anchor.getAttribute('href'), pageUrl);
      if (kind !== 'nav' && kind !== 'current') continue;
      out.push({ anchor, url, kind, label: labelOf(anchor) });
    }
    return out;
  }

  /** Số neo trong trang — con số của câu "sidebar chỉ có mục lục trong trang". */
  function anchorLinks(node, pageUrl, options) {
    const sel = selectorsOf(options);
    if (!node) return [];
    return Array.from(node.querySelectorAll(sel.css('link')))
      .filter((anchor) => !anchor.closest(sel.OWN_UI))
      .filter((anchor) => linkKind(anchor.getAttribute('href'), pageUrl).kind === 'anchor');
  }

  // ------------------------------------------------------------------ chấm điểm

  /**
   * Bề ngang cột, quy về [0..1]: 0 là rộng bằng cả khung nhìn, 1 là hẹp không đáng kể.
   *
   * Đo được hay không là chuyện của adapter (`options.metrics`), và **không đo được thì không
   * cộng điểm cho ai cả**. Trả 1 khi bề ngang bằng 0 là biến mọi khối đang ẩn thành ứng viên
   * sáng giá nhất trang — mà một sidebar chưa mở trên mobile đúng là rộng 0.
   */
  function narrowness(node, options) {
    const m = (options && options.metrics) || {};
    const width = typeof m.width === 'function'
      ? Number(m.width(node))
      : (node && typeof node.getBoundingClientRect === 'function' ? Number(node.getBoundingClientRect().width) : 0);
    const viewport = typeof m.viewport === 'function' ? Number(m.viewport()) : 0;
    if (!(width > 0) || !(viewport > 0)) return 0;
    return Math.max(0, Math.min(1, 1 - width / viewport));
  }

  const hasNestedList = (node, options) => Boolean(node && node.querySelector(selectorsOf(options).css('nestedList')));

  /**
   * Điểm "giống sidebar" của một khối. Bốn dấu hiệu **hành vi**, không dấu hiệu nào là tên
   * class: Docusaurus, MkDocs, GitBook, docsify, VitePress và một trang tự dựng đặt tên khác
   * nhau hết, nhưng cả sáu đều dựng một cột hẹp đầy link cùng site, có link trỏ về trang đang
   * đọc.
   */
  function scoreSidebar(node, pageUrl, options) {
    if (!node) return 0;
    const links = navLinks(node, pageUrl, options);
    return score(links, node, options);
  }

  /** Chấm điểm từ danh sách link đã có sẵn — chỗ trong này gọi, để không quét lại cả cây. */
  function score(links, node, options) {
    const count = links.length;
    if (count === 0) return 0;
    const current = links.some((l) => l.kind === 'current') ? 1 : 0;
    return WEIGHT.links * Math.min(count / ENOUGH_LINKS, 1)
      + WEIGHT.nested * (hasNestedList(node, options) ? 1 : 0)
      + WEIGHT.column * narrowness(node, options)
      + WEIGHT.current * current;
  }

  /** Số lớp từ `node` lên tới `stop`, cùng phép đo với `depthOf` của `extract.js`. */
  function depthOf(node, stop) {
    if (node === stop) return 0;
    let depth = 1;
    let parent = node.parentElement;
    while (parent && parent !== stop) {
      depth += 1;
      parent = parent.parentElement;
    }
    return depth;
  }

  const within = (node, ancestor) => {
    for (let n = node; n; n = n.parentElement) if (n === ancestor) return true;
    return false;
  };

  /**
   * Link của **mọi khối tổ tiên**, gom trong một lượt đi lên thay vì quét lại cây cho từng ứng
   * viên. Đồng thời đây là chỗ tập ứng viên sinh ra: chỉ khối nào chứa ít nhất một link mới
   * đáng chấm điểm.
   */
  function tally(scope, links) {
    const byNode = new Map();
    for (const record of links) {
      for (let node = record.anchor.parentElement; node; node = node.parentElement) {
        if (!byNode.has(node)) byNode.set(node, []);
        byNode.get(node).push(record);
        if (node === scope) break;
      }
    }
    return byNode;
  }

  /**
   * Khối chứa sidebar trong `scope`, hoặc `null`.
   *
   * Hai bước, và bước nào cũng có một cái chết riêng nếu bỏ đi:
   *
   *   1. *Chấm điểm* nói sidebar **ở đâu**. Không có bước này thì mọi lượt dò dừng ở khối bọc
   *      layout, vì nó ôm trọn link của trang.
   *   2. *Thu hẹp* nói sidebar **hết ở đâu**, và nó đo bằng **số link**, không đo bằng điểm:
   *      điểm có ba số hạng khác pha loãng tỉ lệ, nên một khối con giữ 60% link vẫn qua được
   *      ngưỡng "gần trọn" nếu chấm bằng điểm. Đi sâu là vứt hẳn phần link ngoài khối con.
   */
  function findSidebar(scope, pageUrl, options) {
    if (!scope) return null;
    const sel = selectorsOf(options);
    const links = navLinks(scope, pageUrl, options);
    if (links.length === 0) return null;

    const byNode = tally(scope, links);
    const countOf = (node) => byNode.get(node).length;
    // Không lọc `OWN_UI` lần nữa ở đây: `navLinks` đã bỏ link của extension từ gốc, nên một
    // khối chỉ toàn link của chính mình không bao giờ vào `byNode` để mà thành ứng viên.
    const candidates = [...byNode.keys()].filter((node) => !node.matches(sel.css('notAContainer')));
    if (candidates.length === 0) return null;

    let best = null;
    let bestScore = -1;
    for (const node of candidates) {
      const value = score(byNode.get(node), node, options);
      // Hoà điểm thì khối **nhiều link hơn** thắng, không phải khối sâu hơn. Một nhánh con của
      // sidebar có đủ link để bão hoà, lại vừa hẹp vừa chứa link trang đang mở, sẽ hoà điểm với
      // cả sidebar — chọn nó là bỏ im lặng mọi nhánh anh em, và Bảng chọn vẫn đầy mục.
      if (value > bestScore || (value === bestScore && countOf(node) > countOf(best))) {
        best = node;
        bestScore = value;
      }
    }
    if (!best) return null;

    // Trong số những khối con đủ điều kiện, lấy khối **giữ được nhiều link nhất** — hoà thì lấy
    // khối sâu nhất để bỏ bớt lớp bọc. Không phải "sâu nhất" một mình: một chuỗi lồng nhau
    // 20 → 19 → 18 link đều qua ngưỡng, và đi thẳng xuống đáy là vứt 2 link trong khi dừng
    // giữa chừng chỉ vứt 1. Ở module này, mất link là thứ đắt nhất — lớp bọc thừa thì không,
    // vì lượt dựng cây phía sau chỉ đọc link và danh sách bên trong container.
    const keep = countOf(best) * NARROW_RATIO;
    let winner = best;
    let winnerDepth = 0;
    /** `-1` nghĩa là chưa có khối con nào đủ điều kiện — lúc đó `best` ở nguyên chỗ của nó. */
    let winnerCount = -1;
    for (const node of candidates) {
      if (node === best || !within(node, best)) continue;
      const count = countOf(node);
      if (count < keep) continue;
      const depth = depthOf(node, best);
      if (count > winnerCount || (count === winnerCount && depth > winnerDepth)) {
        winner = node;
        winnerDepth = depth;
        winnerCount = count;
      }
    }
    return winner;
  }

  // ------------------------------------------------------------------ dựng cây

  /**
   * Sổ "đã nhận" của **một lượt dựng**, khoá theo chính thẻ `<a>` chứ không theo URL: một
   * sidebar trỏ hai lần tới cùng một trang vẫn là hai mục trên màn hình, và đếm theo URL sẽ
   * làm phép so "dựng được bao nhiêu trên tổng số link thật" lệch đi mà không ai thấy.
   *
   * Mỗi lượt gọi hàm này **một lần cho riêng nó**. Dùng chung một sổ giữa hai lượt là lỗi im
   * lặng mà ticket 009 gọi tên: lượt `<ul>` nhận mất một phần link, rồi lối xếp phẳng bỏ qua
   * đúng những link đó — Bảng chọn vẫn mở, vẫn có link, chỉ thiếu.
   */
  const newLedger = () => new Set();

  const isList = (node, sel) => node.matches(sel.css('navList'));

  /**
   * Con trực tiếp khớp một nhóm selector — `children` chứ không `querySelectorAll`.
   *
   * `Array.from` là bắt buộc: `children` là một `HTMLCollection`, và nó **không có** phương
   * thức nào của Array. Gọi thẳng `.filter` lên nó là một `TypeError` ở mỗi lượt dựng cây.
   */
  const childrenMatching = (node, selector) => Array.from(node.children).filter((child) => child.matches(selector));

  /** Chữ của riêng một `<li>`: bỏ chữ của những danh sách con nằm trong nó. */
  function ownLabel(node, sel) {
    const parts = [];
    for (const child of node.childNodes) {
      if (child.tagName && isList(child, sel)) continue;
      parts.push(child.textContent);
    }
    return S.collapse(parts.join(' '));
  }

  /** Danh sách ngoài cùng trong `container` — kể cả chính `container` nếu nó đã là một danh sách. */
  function topLists(container, sel) {
    const nested = (node) => {
      for (let n = node.parentElement; n && n !== container; n = n.parentElement) {
        if (isList(n, sel)) return true;
      }
      return false;
    };
    const out = isList(container, sel) ? [container] : [];
    if (out.length > 0) return out;
    for (const list of container.querySelectorAll(sel.css('navList'))) {
      if (!nested(list)) out.push(list);
    }
    return out;
  }

  /**
   * Cây theo `ul/li`: mỗi `<li>` là một mục, danh sách lồng trong `<li>` là nhánh con của nó.
   *
   * `<li>` không có link mà có nhánh con vẫn là một mục — nhiều theme dựng tên nhóm bằng một
   * `<span>` không bấm được. Nó không import được một mình, nhưng tick nó là chọn cả nhánh, và
   * đó chính là đơn vị người dùng chọn (`CONTEXT.md`, "Nhánh tài liệu").
   */
  function collectFromLists(container, links, seen, options) {
    const sel = selectorsOf(options);
    const byAnchor = new Map(links.map((record) => [record.anchor, record]));
    const taken = [];
    let next = 0;

    const itemsOf = (list, depth) => {
      const nodes = [];
      for (const li of childrenMatching(list, sel.css('navItem'))) {
        const sublists = childrenMatching(li, sel.css('navList'));
        // Link của **chính mục này**: `<a>` đầu tiên không nằm trong một danh sách con — nếu
        // không, một nhóm không bấm được sẽ mượn link của mục con đầu tiên và hai mục cùng trỏ
        // một trang.
        const anchor = Array.from(li.querySelectorAll(sel.css('link')))
          .find((a) => byAnchor.has(a) && !seen.has(a) && !sublists.some((sub) => within(a, sub)));
        const record = anchor ? byAnchor.get(anchor) : null;
        if (record) {
          seen.add(anchor);
          taken.push(record);
        }
        const children = sublists.flatMap((sub) => itemsOf(sub, depth + 1));
        if (!record && children.length === 0) continue;
        nodes.push({
          id: `n${next++}`,
          label: record ? record.label : ownLabel(li, sel),
          url: record ? record.url : '',
          depth,
          children,
        });
      }
      return nodes;
    };

    const nodes = topLists(container, sel).flatMap((list) => itemsOf(list, 0));
    return { nodes, taken };
  }

  /** Lối xếp phẳng: mỗi link một mục, đúng thứ tự tài liệu, không cấp cha–con. */
  function collectFlat(links, seen) {
    const nodes = [];
    const taken = [];
    for (const record of links) {
      if (seen.has(record.anchor)) continue;
      seen.add(record.anchor);
      taken.push(record);
      nodes.push({ id: `n${nodes.length}`, label: record.label, url: record.url, depth: 0, children: [] });
    }
    return { nodes, taken };
  }

  /**
   * Cây mục lục của một container: đường `<ul>` trước, xếp phẳng làm lối lui.
   *
   * Ngưỡng là **tỉ lệ trên số link thật trong container**, không phải một con số tuyệt đối. Một
   * ngưỡng tuyệt đối kiểu "≥3 link là tin" đi theo cái `<ul>` mạng xã hội lẫn trong sidebar
   * `<div>` của VitePress và trả về một cây ba mục, trong khi 12 trang còn lại biến mất — bảng
   * vẫn mở, vẫn có link, không dòng nào báo.
   */
  function buildTree(container, pageUrl, options) {
    const links = navLinks(container, pageUrl, options);
    const total = links.length;
    // Mỗi lượt một sổ. Đây là cả nội dung của ràng buộc, và nó nằm gọn trong hai dòng này.
    const lists = collectFromLists(container, links, newLedger(), options);
    if (total > 0 && lists.taken.length >= total * LIST_COVER_RATIO) {
      return { nodes: lists.nodes, via: 'lists', taken: lists.taken.length, total };
    }
    const flat = collectFlat(links, newLedger());
    return { nodes: flat.nodes, via: 'flat', taken: flat.taken.length, total };
  }

  // ------------------------------------------------------------------ đọc cây thành mục

  /** Cây thành danh sách phẳng, thứ tự duyệt sâu — đúng thứ tự người dùng nhìn thấy trên màn hình. */
  function flatten(nodes) {
    const out = [];
    const walk = (list) => {
      for (const node of list) {
        out.push(node);
        walk(node.children);
      }
    };
    walk(nodes || []);
    return out;
  }

  /**
   * Một mục cùng **toàn bộ nhánh con** của nó — đơn vị mà người dùng tick.
   *
   * Xuôi xuống, không ngược lên: tick một mục con mà kéo theo mục cha là import cả nhánh người
   * dùng không chọn, và lần import ấy vẫn chạy trót lọt từ đầu tới cuối.
   */
  const branch = (node) => (node ? flatten([node]) : []);

  /** Số mục **import được** (có URL) trong một cây — mục nhóm không bấm được thì không tính. */
  const countPages = (nodes) => flatten(nodes).filter((node) => node.url).length;

  /**
   * Lọc theo chữ, **bỏ dấu cả hai vế** (cùng `foldLabel` với ô tìm của panel transcript).
   *
   * Mục khớp thì giữ nguyên cả nhánh con của nó — người ta lọc để tick cả nhánh, chứ không phải
   * để nhìn một cái tên đứng một mình. Mục không khớp mà có con khớp thì vẫn ở lại làm đường đi.
   */
  function filterNodes(nodes, query) {
    const needle = S.foldLabel(query);
    if (!needle) return nodes || [];
    const keep = (node) => {
      if (S.foldLabel(node.label).includes(needle)) return node;
      const children = (node.children || []).map(keep).filter(Boolean);
      return children.length > 0 ? { ...node, children } : null;
    };
    return (nodes || []).map(keep).filter(Boolean);
  }

  // ------------------------------------------------------------------ một lượt đọc

  /**
   * Đọc sidebar của một trang: dò container, dựng cây, và **nói rõ khi không có gì để import**.
   *
   * Ba kết cục, và chúng khác nhau ở chỗ người dùng phải làm gì tiếp: `ok` thì tick, `none` thì
   * trang này không có sidebar, còn `anchors-only` là Sphinx thuần — sidebar có thật, đầy mục,
   * nhưng mọi mục đều là neo trong **chính trang đang đọc**. Trả về một danh sách gần rỗng cho
   * trường hợp cuối là để người dùng ngồi nhìn một Bảng chọn trống không biết vì sao.
   */
  function readSidebar(scope, pageUrl, options) {
    if (!S.docPageId(pageUrl)) throw new Error(`sidebar: URL không đọc được: ${String(pageUrl)}`);
    const container = findSidebar(scope, pageUrl, options);
    if (!container) {
      const anchors = anchorLinks(scope, pageUrl, options).length;
      return {
        outcome: anchors > 0 ? OUTCOME.ANCHORS_ONLY : OUTCOME.NONE,
        container: null,
        nodes: [],
        via: 'none',
        taken: 0,
        total: 0,
        anchors,
      };
    }
    const tree = buildTree(container, pageUrl, options);
    return {
      outcome: OUTCOME.OK,
      container,
      nodes: tree.nodes,
      via: tree.via,
      taken: tree.taken,
      total: tree.total,
      anchors: anchorLinks(container, pageUrl, options).length,
    };
  }

  root.NBLM_DOCS_SIDEBAR = Object.freeze({
    WEIGHT,
    ENOUGH_LINKS,
    NARROW_RATIO,
    LIST_COVER_RATIO,
    OUTCOME,
    linkKind,
    navLinks,
    anchorLinks,
    narrowness,
    scoreSidebar,
    depthOf,
    findSidebar,
    newLedger,
    collectFromLists,
    collectFlat,
    buildTree,
    flatten,
    branch,
    countPages,
    filterNodes,
    readSidebar,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
