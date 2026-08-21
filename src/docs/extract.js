/*
 * Tìm phần thân bài của một trang tài liệu và trích ra Markdown.
 *
 * Hai đường vào, cùng một bộ máy:
 *   - fromLive()  : đọc DOM đang hiển thị (trang SPA đã render xong).
 *   - fromHtml()  : parse chuỗi HTML lấy về bằng fetch (nhanh, không tải lại trang).
 *
 * Đường fetch là đường mặc định vì nó không phải mở tab nào; nhưng docs dựng bằng
 * JS (Docusaurus SSR thiếu, GitBook, Docsify…) trả về khung rỗng, nên bên gọi phải
 * kiểm tra `chars` và rơi về đường render khi thấy nội dung mỏng bất thường.
 */
;(function (root) {
  'use strict';

  const MD = root.NBLM_MD;

  /** Ứng viên phần thân bài, xếp theo độ chắc chắn giảm dần. */
  const CONTENT_SELECTORS = [
    '.theme-doc-markdown',            // Docusaurus v2/v3
    '.md-content__inner',             // MkDocs Material
    '.markdown-body',                 // GitHub / nhiều theme
    '.rst-content .document',         // Sphinx + ReadTheDocs
    '.bd-article',                    // pydata-sphinx-theme
    'article.markdown', '.vp-doc',    // VitePress
    '.docs-content', '.docMainContainer article',
    '.devsite-article-body',          // Google developers
    '.nextra-content', '.mdx-content', '.prose',
    'main article', 'article[role="main"]', '[role="main"] article',
    '#main-content', '#content article',
    'article', 'main', '[role="main"]', '#content', '.content', 'body',
  ];

  /**
   * Rác cần bỏ *bên trong* phần thân bài. Phần lớn là điều hướng lặp lại ở mọi
   * trang — để nguyên thì mỗi nguồn trong NotebookLM đều dính cùng một mớ mục lục
   * và nó bắt đầu trích dẫn nhầm sang sidebar.
   */
  const JUNK_SELECTORS = [
    'nav', 'aside', 'header', 'footer',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[role="complementary"]', '[role="search"]', '[role="tablist"]',
    '.toc', '#toc', '.table-of-contents', '.tableOfContents', '.on-this-page',
    '.theme-doc-toc-desktop', '.theme-doc-toc-mobile', '.md-sidebar', '.wy-nav-side',
    '.VPSidebar', '.VPDocAside', '.right-sidebar', '.sidebar', '.docs-sidebar',
    '.breadcrumbs', '.theme-doc-breadcrumbs', '.md-nav', '.wy-breadcrumbs',
    '.pagination-nav', '.docs-prevnext', '.prev-next', '.theme-doc-footer',
    '.edit-page-link', '.theme-edit-this-page', '.md-source-file', '.wy-nav-content-wrap > .rst-footer-buttons',
    '.headerlink', '.hash-link', '.anchor', '.header-anchor', '.permalink',
    '.skip-link', '.sr-only', '.visually-hidden', '.screen-reader-only', '.visuallyhidden',
    '.feedback', '.page-feedback', '.rating', '.was-this-helpful',
    '.announcement', '.banner', '.cookie-banner', '.advertisement', '.carbonads', '#carbonads',
    '#nblm-docs-root', '[class^="nblm-"]',
    'script', 'style', 'noscript', 'template', 'iframe',
  ].join(',');

  /** Đuôi thừa trong <title>: "Trang | Site", "Trang - Site", "Trang · Site". */
  const TITLE_TAIL = /\s*[|·—–\-‧»]\s*[^|·—–\-‧»]{2,60}$/;

  /* -------------------------------------------------------------------- */
  /* chọn phần thân bài                                                    */
  /* -------------------------------------------------------------------- */

  /**
   * Điểm "đây có phải bài viết không": đếm chữ trong các thẻ mang nội dung thật,
   * trừ đi chữ nằm trong link (đặc trưng của khối điều hướng).
   */
  function score(el) {
    if (!el) return 0;
    let content = 0;
    for (const node of el.querySelectorAll('p, li, pre, td, h1, h2, h3, h4, blockquote, dd')) {
      content += (node.textContent || '').length;
    }
    let inLinks = 0;
    for (const a of el.querySelectorAll('a')) inLinks += (a.textContent || '').length;
    return content - inLinks * 1.5;
  }

  function pickRoot(doc, minChars) {
    const floor = Math.max(200, Number(minChars) || 0);

    for (const selector of CONTENT_SELECTORS) {
      let el;
      try {
        el = doc.querySelector(selector);
      } catch (_) {
        continue; // selector không hợp lệ trên document này
      }
      if (el && score(el) >= floor) return { el, how: selector };
    }

    // Không selector nào ăn (theme lạ) — chấm điểm mọi khối lớn.
    //
    // Điểm của khối cha luôn ≥ điểm khối con vì nó *chứa* con, nên lấy điểm cao
    // nhất là luôn chọn <body>. Thứ ta cần là khối **sâu nhất** vẫn giữ gần trọn
    // nội dung: đó chính là ranh giới bài viết, ngay dưới lớp bọc layout.
    const scored = [];
    let bestScore = 0;
    for (const el of doc.querySelectorAll('div, section, article, main, td')) {
      const value = score(el);
      if (value < floor) continue;
      if (value > bestScore) bestScore = value;
      scored.push({ el, value, depth: depthOf(el) });
    }

    const keep = scored.filter((c) => c.value >= bestScore * 0.9);
    if (keep.length) {
      keep.sort((a, b) => b.depth - a.depth || b.value - a.value);
      return { el: keep[0].el, how: 'heuristic' };
    }
    return { el: doc.body || doc.documentElement, how: 'fallback' };
  }

  function depthOf(el) {
    let depth = 0;
    for (let node = el.parentElement; node; node = node.parentElement) depth++;
    return depth;
  }

  /* -------------------------------------------------------------------- */
  /* metadata                                                              */
  /* -------------------------------------------------------------------- */

  function meta(doc, name) {
    const el =
      doc.querySelector(`meta[property="${name}"]`) || doc.querySelector(`meta[name="${name}"]`);
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function pageTitle(doc, rootEl, url) {
    const h1 = rootEl && rootEl.querySelector('h1');
    const fromH1 = h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (fromH1) return fromH1.replace(/[#¶]\s*$/, '').trim();

    const og = meta(doc, 'og:title');
    if (og) return og;

    const raw = (doc.title || '').replace(/\s+/g, ' ').trim();
    if (raw) return raw.replace(TITLE_TAIL, '').trim() || raw;

    return root.NBLM.urlLabel(url);
  }

  function siteName(doc, url) {
    const og = meta(doc, 'og:site_name') || meta(doc, 'application-name');
    if (og) return og;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  /** Breadcrumb đọc *trước* khi dọn rác, vì bước dọn sẽ xoá nó đi. */
  function breadcrumb(doc) {
    const el = doc.querySelector(
      '.breadcrumbs, .theme-doc-breadcrumbs, nav[aria-label*="readcrumb" i], ' +
        '[class*="breadcrumb" i], .wy-breadcrumbs'
    );
    if (!el) return '';
    const parts = Array.from(el.querySelectorAll('a, li, span'))
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 60);
    const unique = Array.from(new Set(parts));
    return unique.slice(0, 6).join(' / ').slice(0, 200);
  }

  /* -------------------------------------------------------------------- */
  /* trích                                                                 */
  /* -------------------------------------------------------------------- */

  /**
   * @param {Document} doc  document sống hoặc do DOMParser dựng
   * @param {string} url    URL thật của trang (để giải link tương đối)
   * @param {object} opts   { keepLinks, keepImages, minChars }
   */
  function fromDocument(doc, url, opts) {
    const o = opts || {};
    const picked = pickRoot(doc, o.minChars);
    const section = breadcrumb(doc);
    const title = pageTitle(doc, picked.el, url);
    const site = siteName(doc, url);

    // Dọn trên bản sao — không bao giờ đụng vào DOM trang người dùng đang đọc.
    const clone = picked.el.cloneNode(true);
    clone.querySelectorAll(JUNK_SELECTORS).forEach((n) => n.remove());

    // Tiêu đề đã nằm ở header nguồn rồi, giữ lại là lặp.
    const firstH1 = clone.querySelector('h1');
    if (firstH1 && (firstH1.textContent || '').replace(/\s+/g, ' ').trim().startsWith(title.slice(0, 40))) {
      firstH1.remove();
    }

    const markdown = MD.convert(clone, {
      baseUrl: url,
      keepLinks: !!o.keepLinks,
      keepImages: o.keepImages !== false,
    });

    return {
      url,
      title,
      site,
      section,
      markdown,
      chars: markdown.length,
      how: picked.how,
    };
  }

  /** Trích từ trang đang hiển thị. */
  function fromLive(opts) {
    return fromDocument(document, location.href, opts);
  }

  /** Trích từ chuỗi HTML (thường là kết quả fetch). */
  function fromHtml(html, url, opts) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return fromDocument(doc, url, opts);
  }

  /**
   * Tải một URL cùng site rồi trích.
   * Chạy trong content script nên fetch cùng origin không vướng CORS, và đi kèm
   * cookie phiên hiện tại — tài liệu nội bộ cần đăng nhập vẫn đọc được.
   */
  async function fromUrl(url, opts) {
    const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`);

    const type = res.headers.get('content-type') || '';
    const body = await res.text();

    if (/text\/(plain|markdown)|application\/(json|yaml)/i.test(type) || /\.(md|txt|json|ya?ml)$/i.test(new URL(url).pathname)) {
      // Trang docs trỏ thẳng vào file thô — giữ nguyên, đừng cố parse như HTML.
      return {
        url,
        title: root.NBLM.urlLabel(url),
        site: new URL(url).hostname.replace(/^www\./, ''),
        section: '',
        markdown: body.trim(),
        chars: body.trim().length,
        how: 'raw',
      };
    }
    // res.url phản ánh URL sau redirect — link tương đối phải giải theo nó.
    return fromHtml(body, res.url || url, opts);
  }

  root.NBLM_DOCS_EXTRACT = { fromDocument, fromLive, fromHtml, fromUrl, pickRoot, score };
})(globalThis);
