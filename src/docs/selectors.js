// MỌI selector và nhãn của lớp **tài liệu** nằm ở đây — và chỉ ở đây.
//
// Lớp riêng nên file riêng: `src/youtube/selectors.js` nạp trên tab YouTube,
// `src/notebooklm/selectors.js` nạp trên tab NotebookLM, và file này thuộc về trang tài liệu.
// Gom ba lớp về một file là nạp selector của lớp này vào tab của lớp kia
// (`WORKSPACE_PROTOCOL.md`).
//
// Khác YouTube ở một điểm quan trọng: ở đây **không có một sản phẩm nào để nhắm**. Docusaurus,
// MkDocs, GitBook, docsify, VitePress, Sphinx mỗi thứ đặt tên class một kiểu, và một trang tự
// dựng thì không theo kiểu nào. Vì vậy `mainBlock` chỉ là **đường tắt** cho những theme đã biết;
// đường chắc chắn là chấm điểm chữ (`src/docs/extract.js`). Selector ở đây sai thì tệ nhất là
// mất đường tắt, không phải mất nội dung.
//
// Classic script như `src/common/shared.js` — content script của MV3 không nạp `import`.
(function (root) {
  'use strict';

  if (root.NBLM_DOCS_SELECTORS) return;

  const S = root.NBLM_SHARED;
  if (!S) throw new Error('docs/selectors: cần src/common/shared.js nạp trước');

  const DEFAULT_SELECTORS = Object.freeze({
    /**
     * Thân bài của những theme đã biết, cụ thể trước — chung sau. Một mục ở đây chỉ được dùng
     * khi nó ôm phần lớn chữ của trang; nếu không, `extract.js` bỏ qua và quay về chấm điểm.
     */
    mainBlock: [
      '.theme-doc-markdown',      // Docusaurus v2/v3
      '.md-content__inner',       // MkDocs Material
      '.markdown-section',        // docsify
      '.theme-default-content',   // VuePress
      '.markdown-body',           // GitBook, giao diện kiểu GitHub
      '.rst-content .document',   // Sphinx / Read the Docs
      '.VPDoc .content',          // VitePress
      '[role="main"]',
      'main',
      'article',
      '#main-content',
      '#content',
    ],
    /**
     * Thẻ mang chữ **thật** của một trang tài liệu. Điểm của một khối là tổng số ký tự trong
     * những thẻ này, trừ đi chữ nằm trong link — sidebar và mục lục gần như toàn link nên tự
     * rơi về 0 mà không cần biết theme đặt tên class là gì.
     */
    textWeight: ['p', 'li', 'pre', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    docTitle: ['h1'],
    link: ['a'],
    codeBlock: ['pre'],
    /**
     * Danh sách của một cây mục lục. Đường dựng cây theo `<ul>` (`src/docs/sidebar.js`) đi trên
     * đúng hai thẻ này — không theo class, vì mỗi bộ dựng docs đặt tên một kiểu.
     */
    navList: ['ul', 'ol'],
    /** Một mục của danh sách. Cấp cha–con của Bảng chọn là quan hệ `li` ⊃ `ul` ⊃ `li`. */
    navItem: ['li'],
    /**
     * Danh sách **lồng trong** danh sách: dấu hiệu "đây là một cây mục lục" chứ không phải một
     * hàng link ngang. Hàng link ở footer cũng là `<ul>`, nhưng nó phẳng.
     */
    nestedList: ['ul ul', 'ul ol', 'ol ul', 'ol ol'],
    /**
     * Thẻ **không** bao giờ là khối chứa sidebar: chính cái link, hoặc một mục lẻ. Cùng lý do
     * với việc `extract.js` loại `p`/`li` khỏi ứng viên thân bài — sidebar là khối **chứa** mục,
     * không phải một mục. Thu hẹp xuống một `<li>` là vứt luôn mọi mục anh em của nó.
     */
    notAContainer: ['a', 'li'],
    /**
     * Điều hướng lặp ở **mọi** trang: sidebar, breadcrumb, prev/next, mục lục "On this page".
     * Để nguyên thì mọi Nguồn đều dính cùng một mớ, và NotebookLM bắt đầu trích dẫn sang menu.
     *
     * Cố ý **không** có `header`/`footer` trần: Docusaurus bọc chính `<h1>` của bài trong một
     * `<header>`, nên gạt hai thẻ ấy là gạt luôn tiêu đề bài viết. Vai trò ARIA ở dưới mới là
     * thứ chỉ đúng header/footer của cả trang.
     */
    chrome: [
      'nav',
      // Cố ý **không** có `aside` trần. Sphinx dựng footnote thành `<aside class="footnote">`,
      // mà `.rst-content .document` là một theme ngay trong `mainBlock` ở trên — gạt cả thẻ là
      // xoá im lặng toàn bộ chú thích cuối bài. Sidebar/mục lục của mọi theme đều có class hoặc
      // vai trò ARIA nói ra nó là gì, nên nhận diện theo hai thứ đó thay vì theo tên thẻ.
      '[role="navigation"]',
      '[role="complementary"]',
      '[role="banner"]',
      '[role="contentinfo"]',
      '[class*="sidebar"]',
      '[class*="Sidebar"]',
      '[class*="breadcrumb"]',
      '[class*="Breadcrumb"]',
      '[class*="pagination"]',
      '[class*="prevNext"]',
      '[class*="tableOfContents"]',
      '[class*="aside"]',
      '[class*="Aside"]',
      '[class*="editThisPage"]',
      '.toc',
      '.table-of-contents',
      '.on-this-page',
      '.prev-next',
      '.edit-this-page',
      '.theme-edit-this-page',
      /**
       * Nút bấm trong vùng bài viết là **điều khiển**, không phải nội dung: Copy, Toggle word
       * wrap, "Show more". `codeNoise` không với tới chúng — Docusaurus đặt nhóm nút ấy làm
       * **anh em** của `<pre>` chứ không phải con, nên không dọn ở đây thì mọi khối code của
       * một bộ docs Docusaurus đều kéo theo hai dòng rác, lặp ở mọi trang.
       */
      'button',
      '[role="button"]',
    ],
    /** Neo `#` mà mọi bộ dựng docs gắn cạnh đề mục. Chữ của nó không thuộc về đề mục. */
    headingAnchor: [
      '.hash-link',
      '.headerlink',
      '.header-anchor',
      '.anchor',
      '[class*="hashLink"]',
      '[class*="anchorLink"]',
    ],
    /**
     * Mỗi dòng code là một phần tử — hình dạng của Prism-react, Shiki, CodeMirror, Monaco.
     * Đây là cái danh sách khiến khối 40 dòng ra 40 dòng thay vì một dòng dính liền.
     */
    codeLine: ['.token-line', '.line', '.code-line', '.cm-line', '.view-line', '[data-line]'],
    /** Thứ nằm *trong* khối code mà không phải code: cột số dòng, nút Copy. */
    codeNoise: [
      '.linenumber',
      '.line-number',
      '.line-numbers',
      '.lineno',
      '.hljs-ln-numbers',
      '.gutter',
      '[class*="copy"]',
      '[class*="Copy"]',
      'button',
      '[aria-hidden="true"]',
    ],
    /** Không phải chữ của trang dù `textContent` vẫn đọc ra. */
    dropped: ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas'],
  });

  /** Thuộc tính mang tên ngôn ngữ, khi class `language-*` không có. */
  const LANG_ATTRIBUTES = Object.freeze(['data-lang', 'data-language', 'data-code-lang']);
  /** Tiền tố class mang tên ngôn ngữ. `lang-` không khớp nhầm `language-…` vì dấu `-` khác chỗ. */
  const LANG_PREFIXES = Object.freeze(['language-', 'lang-', 'highlight-source-']);
  /** Nhãn ngôn ngữ vô nghĩa: mở fence bằng chúng còn tệ hơn để trống. */
  const NOT_A_LANGUAGE = Object.freeze(['none', 'null', 'undefined', 'numbers', 'text-plain']);
  /** Chữ của một neo đề mục. Nó là ký hiệu, không phải một phần của tiêu đề. */
  const ANCHOR_TEXT = Object.freeze(['#', '¶', '§', '🔗', 'link', 'permalink']);

  const DEFAULT_LABELS = Object.freeze({
    /** Link "sửa trang này" — có ở mọi trang docs mở nguồn, không mang nội dung nào. */
    editPage: [
      'edit this page', 'edit on github', 'improve this page', 'suggest an edit',
      'sua trang nay', 'chinh sua trang nay', 'sua tren github',
    ],
  });

  /** Selector loại trừ giao diện của chính extension. Suy từ `EXT_PREFIX`, không viết tay lại. */
  const OWN_UI = `[id^="${S.EXT_PREFIX}"]`;

  const asList = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : []);

  /**
   * Gộp ghi đè của người dùng *thêm vào* mặc định, ghi đè đứng trước — cùng quy tắc với
   * `mergeSelectorOverrides` của Seam 1. Thay thế hẳn là sai: một ghi đè cho `codeLine` sẽ vứt
   * luôn mọi bộ tô màu khác đang chạy tốt.
   */
  function resolve(overrides) {
    const over = overrides && typeof overrides === 'object' ? overrides : {};
    const selectors = {};
    for (const key of Object.keys(DEFAULT_SELECTORS)) {
      selectors[key] = S.dedupe([...asList(over[key]), ...DEFAULT_SELECTORS[key]]);
    }
    const labels = S.mergeSelectorOverrides(DEFAULT_LABELS, over.labels);

    return Object.freeze({
      OWN_UI,
      LANG_ATTRIBUTES,
      LANG_PREFIXES,
      NOT_A_LANGUAGE,
      ANCHOR_TEXT,
      selectors: Object.freeze(selectors),
      labels: Object.freeze(labels),
      css(key) {
        const list = selectors[key];
        if (!list) throw new Error(`docs/selectors: không có nhóm selector "${key}"`);
        return list.join(', ');
      },
      label(key) {
        return labels[key] || [];
      },
    });
  }

  const DEFAULT = resolve(null);

  root.NBLM_DOCS_SELECTORS = Object.freeze({
    OWN_UI,
    DEFAULT_SELECTORS,
    DEFAULT_LABELS,
    LANG_ATTRIBUTES,
    LANG_PREFIXES,
    NOT_A_LANGUAGE,
    ANCHOR_TEXT,
    DEFAULT,
    resolve,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
