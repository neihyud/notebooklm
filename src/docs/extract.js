// Trích nội dung một trang tài liệu: chọn thân bài, dọn điều hướng, và hai nấc lấy DOM.
//
// Ba việc, một chủ đề chung — **nội dung đọc được phải thuộc về đúng trang đã yêu cầu**:
//
//   1. *Chọn thân bài.* Điểm của khối cha luôn ≥ khối con, nên "khối nhiều chữ nhất" luôn là
//      `<body>` và Nguồn nào cũng dính cả sidebar. Quy tắc đúng là khối **sâu nhất** vẫn giữ
//      gần trọn nội dung, với chữ nằm trong link bị trừ đi — sidebar và mục lục gần như toàn
//      link nên tự rơi về 0 mà không cần biết theme đặt tên class là gì.
//   2. *Dọn.* Breadcrumb, prev/next, "Edit this page", neo `#` lặp ở **mọi** trang; để nguyên
//      thì mọi Nguồn đều dính cùng một mớ và NotebookLM bắt đầu trích dẫn sang menu.
//   3. *Hai nấc.* `fetch` từ tab cùng origin trước (rẻ, mang cookie phiên nên docs nội bộ đọc
//      được), chỉ mở tab ẩn khi nấc 1 trả về nội dung mỏng bất thường.
//
// Chỗ nguy hiểm nhất của cả file là nấc 2, và nó là đúng hình mà `WORKSPACE_PROTOCOL.md` v5
// gọi tên ở lớp YouTube: *một thứ của trang A còn sống trên trang B*. Với docsify, `#/a → #/b`
// không tải lại trang — tab báo `complete`, URL đã đổi, DOM thì chưa. Vì vậy nấc 2 chờ **hai**
// điều kiện chứ không một: URL khớp, **rồi** nội dung khác nội dung tab đang đứng trước lúc
// điều hướng, **rồi** đứng yên. Và kết quả mang URL mà tab *đang đứng*, không mang URL đã gõ
// vào — hai chuỗi ấy chỉ khác nhau đúng lúc có chuyện, mà đúng lúc ấy thì khác nhau là tất cả.
//
// File này không chạm `chrome.*` và không chạm `document` toàn cục: cây node và mọi lối ra
// (fetch, tab ẩn, đồng hồ) là adapter được tiêm — `test/docs-extract.test.js`.
(function (root) {
  'use strict';

  if (root.NBLM_DOCS_EXTRACT) return;

  const S = root.NBLM_SHARED;
  const D = root.NBLM_DOCS_SELECTORS;
  const MD = root.NBLM_DOCS_MARKDOWN;
  if (!S) throw new Error('docs/extract: cần src/common/shared.js nạp trước');
  if (!D) throw new Error('docs/extract: cần src/docs/selectors.js nạp trước');
  if (!MD) throw new Error('docs/extract: cần src/docs/markdown.js nạp trước');

  /**
   * Ứng viên phải giữ được ngần này phần nội dung của khối tốt nhất mới được coi là "vẫn gần
   * trọn". Nới ra là chọn phải một khối con cắt mất phần cuối bài; siết lại là dừng ở lớp bọc
   * layout và dính nguyên sidebar.
   */
  const KEEP_RATIO = 0.9;
  /**
   * Selector quen thuộc chỉ là **đường tắt**, nên nó phải tự chứng minh: một mục `#content`
   * trỏ nhầm vào ô đăng ký bản tin sẽ cho một Nguồn đúng một câu — mà vẫn "thành công".
   */
  const KNOWN_RATIO = 0.5;

  /** Nhịp chờ của nấc 2. `stableRounds` là số lượt **lặp lại** cần thấy, không phải số lượt đọc. */
  const SETTLE = Object.freeze({ tries: 40, stepMs: 250, stableRounds: 2 });

  const REASON = Object.freeze({
    URL_MISMATCH: 'url-mismatch',
    STALE: 'stale-content',
    EMPTY: 'empty',
  });

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  const selectorsOf = (options) => {
    const given = options && options.selectors;
    if (!given) return D.DEFAULT;
    return typeof given.css === 'function' ? given : D.resolve(given);
  };

  // ------------------------------------------------------------------ chấm điểm

  /**
   * Số ký tự chữ **thật** trong một khối: chữ trong `p/li/pre/td/h*`, trừ chữ nằm trong link.
   *
   * Chỉ đếm khối ngoài cùng: một `<p>` lồng trong `<li>` là một khối chữ, không phải hai. Phép
   * trừ link là thứ làm cả cách chọn này chạy được — nó không cần biết theme nào, chỉ cần biết
   * rằng một danh sách toàn link là điều hướng chứ không phải bài viết.
   */
  function scoreBlock(node, options) {
    if (!node) return 0;
    const css = selectorsOf(options).css('textWeight');
    const link = selectorsOf(options).css('link');
    const blocks = node.matches(css) ? [node] : MD.outermost(node, css);

    let total = 0;
    for (const block of blocks) {
      let chars = S.collapse(block.textContent).length;
      for (const anchor of block.querySelectorAll(link)) chars -= S.collapse(anchor.textContent).length;
      total += Math.max(0, chars);
    }
    return total;
  }

  /** Số lớp từ `node` lên tới `stop`. Đây là "sâu" trong "khối sâu nhất". */
  function depthOf(node, stop) {
    let depth = 0;
    let parent = node.parentElement;
    while (parent && parent !== stop) {
      depth += 1;
      parent = parent.parentElement;
    }
    return node === stop ? 0 : depth + 1;
  }

  /**
   * Ứng viên thân bài trong một phạm vi.
   *
   * Loại chính những thẻ mang chữ (`p`, `li`, `pre`…): một bài viết chỉ có đúng một đoạn văn
   * thì `<p>` ấy đạt mọi ngưỡng và sâu nhất — chọn nó là vứt luôn đề mục và khối code đứng
   * cạnh. Thân bài là **khối chứa** chữ, không phải một mẩu chữ.
   */
  function candidatesOf(scope, sel) {
    const text = sel.css('textWeight');
    const code = sel.css('codeBlock');
    const out = [];
    const consider = (node) => {
      if (node.matches(text)) return;
      if (node.closest(code)) return;
      out.push(node);
    };
    consider(scope);
    for (const node of scope.querySelectorAll('*')) consider(node);
    return out;
  }

  /**
   * Thân bài: khối **sâu nhất** vẫn giữ gần trọn nội dung của phạm vi.
   *
   * Không phải khối điểm cao nhất — điểm là tổng cộng dồn nên khối cha luôn ≥ khối con và
   * `<body>` luôn thắng, tức quy tắc ấy trả về nguyên cả trang ở *mọi* trang.
   */
  function pickMainBlock(node, options) {
    if (!node) return null;
    const sel = selectorsOf(options);
    const cache = new Map();
    const score = (el) => {
      if (!cache.has(el)) cache.set(el, scoreBlock(el, options));
      return cache.get(el);
    };

    const all = candidatesOf(node, sel);
    const best = all.reduce((max, el) => Math.max(max, score(el)), 0);
    if (best <= 0) return node;

    // Đường tắt: theme quen thuộc. Chỉ đi khi nó ôm phần lớn chữ của trang.
    let scope = node;
    for (const known of node.querySelectorAll(sel.css('mainBlock'))) {
      if (known.closest(sel.css('codeBlock'))) continue;
      if (score(known) >= best * KNOWN_RATIO) {
        scope = known;
        break;
      }
    }

    const inScope = scope === node ? all : candidatesOf(scope, sel);
    const keep = inScope.reduce((max, el) => Math.max(max, score(el)), 0) * KEEP_RATIO;

    let winner = scope;
    let winnerDepth = -1;
    for (const candidate of inScope) {
      if (score(candidate) < keep) continue;
      const depth = depthOf(candidate, scope);
      if (depth > winnerDepth) {
        winner = candidate;
        winnerDepth = depth;
      }
    }
    return winner;
  }

  // ------------------------------------------------------------------ dọn

  /**
   * Bản sao của thân bài, đã gỡ điều hướng.
   *
   * **Bản sao**, vì cây node ở đây là trang thật người dùng đang đọc: gỡ trên cây thật là xoá
   * mục lục khỏi trang của họ, và triệu chứng chỉ hiện ra sau khi import xong.
   */
  function cleanBlock(block, options) {
    const sel = selectorsOf(options);
    const copy = block.cloneNode(true);

    for (const junk of copy.querySelectorAll(sel.css('chrome'))) junk.remove();
    for (const junk of copy.querySelectorAll(sel.css('dropped'))) junk.remove();
    for (const junk of copy.querySelectorAll(sel.OWN_UI)) junk.remove();

    // Neo `#` cạnh đề mục: ký hiệu, không phải chữ của đề mục.
    for (const heading of copy.querySelectorAll(sel.css('heading'))) {
      for (const anchor of heading.querySelectorAll(sel.css('link'))) {
        const text = S.foldLabel(anchor.textContent);
        if (!text || sel.ANCHOR_TEXT.includes(text) || anchor.matches(sel.css('headingAnchor'))) anchor.remove();
      }
    }

    // "Edit this page" khớp theo **chữ hiển thị đã bỏ dấu**, cùng cách với lớp NotebookLM: mỗi
    // bộ dựng docs đặt một tên class khác nhau, còn câu chữ thì gần như không đổi.
    const labels = sel.label('editPage');
    for (const anchor of copy.querySelectorAll(sel.css('link'))) {
      const text = S.foldLabel(anchor.textContent);
      if (text && labels.some((label) => text.includes(label))) anchor.remove();
    }
    return copy;
  }

  /**
   * Tiêu đề của trang: `h1` **trong thân bài**.
   *
   * Cố ý không hỏi cả cây node: sidebar của gần như mọi bộ dựng docs mở đầu bằng tên site
   * trong một `h1`, và nó đứng *trước* bài viết theo thứ tự tài liệu. Tên site cũng là một
   * chuỗi trông hoàn toàn như một tiêu đề hợp lệ, nên lấy nhầm không có triệu chứng nào.
   */
  function titleOf(block, options) {
    if (!block) return '';
    const sel = selectorsOf(options);
    const h1 = block.querySelector(sel.css('docTitle'));
    const title = h1 ? S.collapse(h1.textContent) : '';
    if (title) return title;
    const first = block.querySelector(sel.css('heading'));
    return first ? S.collapse(first.textContent) : '';
  }

  /** Cây node của một trang tài liệu → `{ title, markdown, chars }`. Không sửa cây được truyền vào. */
  function readDocument(node, options) {
    const picked = pickMainBlock(node, options);
    if (!picked) return { title: '', markdown: '', chars: 0 };
    const block = cleanBlock(picked, options);
    return {
      title: titleOf(block, options),
      markdown: MD.toMarkdown(block, options),
      // Đo bằng chữ thật chứ không bằng độ dài Markdown: dấu fence và dấu `#` không phải nội
      // dung, mà ngưỡng "mỏng bất thường" thì đang so với nội dung.
      chars: S.collapse(block.textContent).length,
    };
  }

  // ------------------------------------------------------------------ nấc 2: tab ẩn

  /**
   * Dấu vân tay của **thân bài**, không của cả trang.
   *
   * Chụp cả trang là làm yếu đúng cái mốc mà nấc 2 dựa vào: breadcrumb, tiêu đề ở header hay
   * mục sidebar đang active đổi chữ ngay khi route đổi, trong khi `#main` còn là trang cũ —
   * lúc đó `content !== stale` đã đúng và cổng mở sớm. So đúng thứ sẽ được trích thì mốc mới
   * nói được điều nó định nói.
   */
  const fingerprintOf = (node, options) => {
    if (!node) return '';
    const block = pickMainBlock(node, options);
    return S.collapse((block || node).textContent);
  };

  /**
   * Điều hướng tab ẩn tới `requestedUrl` rồi chờ **URL khớp → nội dung không còn là của trang
   * cũ → nội dung đứng yên**, và trả về ảnh chụp đã chốt.
   *
   * Ba điều kiện, không phải một, và điều kiện giữa là điều kiện không ai nghĩ tới: với
   * docsify, `#/a → #/b` không tải lại trang, nên URL đổi *trước* DOM. Chỉ chờ "URL khớp rồi
   * đứng yên" là chốt đúng lúc DOM còn nguyên trang cũ — và nội dung cũ thì đã đứng yên từ lâu.
   * Vì vậy nội dung tab đang đứng **trước** lúc điều hướng được chụp lại và dùng làm mốc loại.
   *
   * Ngoại lệ có chủ ý: nếu tab đã đứng sẵn ở đúng trang được yêu cầu thì không có "trang cũ"
   * nào để phân biệt, nên mốc ấy bị bỏ — nếu không, đọc lại chính trang đang mở sẽ chờ mãi.
   */
  async function readViaTab(requestedUrl, tab, options) {
    const wanted = S.docPageId(requestedUrl);
    if (!wanted) throw new Error(`nấc 2: URL không đọc được: ${String(requestedUrl)}`);
    if (!tab || typeof tab.read !== 'function' || typeof tab.go !== 'function') {
      throw new Error('nấc 2: thiếu adapter tab ẩn');
    }
    const settle = { ...SETTLE, ...((options && options.settle) || {}) };
    const wait = (options && options.wait) || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    const before = await tab.read();
    const stale = S.sameDocPage(before && before.url, requestedUrl)
      ? null
      : fingerprintOf(before && before.root, options);

    await tab.go(requestedUrl);

    let reason = REASON.EMPTY;
    let last = null;
    let steady = 0;

    for (let i = 0; i < settle.tries; i += 1) {
      const shot = await tab.read();
      const here = S.collapse(shot && shot.url);
      const content = fingerprintOf(shot && shot.root, options);

      if (!S.sameDocPage(here, requestedUrl)) {
        reason = REASON.URL_MISMATCH;
        last = null;
        steady = 0;
      } else if (!content) {
        reason = REASON.EMPTY;
        last = null;
        steady = 0;
      } else if (stale !== null && content === stale) {
        reason = REASON.STALE;
        last = null;
        steady = 0;
      } else if (last !== null && content === last) {
        steady += 1;
        // `url` lấy của **ảnh chụp**, không lấy của yêu cầu: đây là địa chỉ mà nội dung này
        // thật sự đến từ đó, và nó là thứ đi vào `- Link gốc:` của Nguồn.
        if (steady >= settle.stableRounds) return { url: here, root: shot.root, polls: i + 1 };
      } else {
        last = content;
        steady = 0;
      }
      await wait(settle.stepMs);
    }

    const error = new Error(`nấc 2: tab ẩn không chốt được nội dung của ${requestedUrl} (${reason})`);
    error.reason = reason;
    throw error;
  }

  // ------------------------------------------------------------------ hai nấc

  /**
   * Một ảnh chụp `{ url, root }` thành nội dung đã trích — **sau khi** chốt rằng nó đúng là
   * trang được yêu cầu.
   *
   * `sameDocPage` chứ không so chuỗi: `http` → `https` và dấu `/` cuối là chuyện máy chủ tự
   * làm, còn khác đường dẫn hay khác hash-route thì là một trang khác, và nội dung của trang
   * khác gắn nhãn URL đã yêu cầu là đúng cái lỗi mà `mergeMeta` học được ở ticket 005.
   */
  function readAt(shot, requestedUrl, via, options) {
    const s = shot || {};
    if (!s.root) throw new Error(`${via}: không nhận được cây node nào của ${requestedUrl}`);
    const url = S.collapse(s.url) || S.collapse(requestedUrl);
    if (!S.sameDocPage(url, requestedUrl)) {
      throw new Error(`${via}: nội dung đọc được thuộc về ${url}, không phải ${requestedUrl}`);
    }
    return { url, via, ...readDocument(s.root, options) };
  }

  /**
   * Câu giải thích đi kèm kết quả — thứ **người dùng đọc** ở bảng tổng kết để biết một Nguồn
   * mỏng là do trang mỏng thật hay do chưa kịp render.
   *
   * Ba con số trong câu này (số ký tự nấc 1, ngưỡng, số ký tự nấc 2) cùng kiểu và đứng cạnh
   * nhau: hoán vị hai cái bất kỳ vẫn ra một câu đọc trôi chảy và một `chars` không đổi. Đó là
   * anti-pattern v6 của `WORKSPACE_PROTOCOL.md`, nên câu này có test riêng canh **vai** của
   * từng con số, không chỉ canh tập con số.
   */
  function noteFor(state) {
    const { chars, min, via, escalated, first, firstReason, tabReason } = state;
    if (!escalated) return `nấc 1 (fetch cùng origin) đọc được ${chars} ký tự, đạt ngưỡng ${min}.`;

    // Lý do của nấc 1 và lý do của nấc 2 là hai chuỗi cùng kiểu: mỗi vế lấy đúng biến của mình,
    // và không vế nào được rơi về `undefined` — một câu giải thích mang chữ "undefined" là câu
    // người dùng bỏ qua, tức mất luôn cái nó sinh ra để làm.
    const opening = first
      ? `nấc 1 chỉ đọc được ${first.chars} ký tự, dưới ngưỡng ${min}`
      : `nấc 1 không đọc được gì (${firstReason || 'không rõ lý do'})`;
    if (via === 'tab') return `${opening} — mở tab ẩn; nấc 2 đọc được ${chars} ký tự.`;
    return `${opening}, và nấc 2 không chốt được (${tabReason || 'không rõ lý do'})`
      + ' — Nguồn này có thể thiếu nội dung.';
  }

  /**
   * Lấy nội dung một trang tài liệu, hai nấc.
   *
   * Nấc 1 là mặc định vì nó rẻ *và* đủ: chạy trong content script nên `fetch` đi kèm cookie
   * phiên, tức docs nội bộ cần đăng nhập vẫn đọc được, và import 80 trang tốn 80 request thay
   * vì 80 lần dựng trang. Nấc 2 chỉ để cứu đúng một trường hợp — trang render bằng JS, nơi nấc
   * 1 nhận về cái khung rỗng.
   *
   * Không nấc nào ném lỗi một mình được: một mục rớt phải nói ra **vì sao** ở bảng tổng kết
   * (ADR 0008), nên cả hai lý do đi cùng nhau trong `attempts`.
   */
  async function fetchDocPage(request, tiers, options) {
    const requestedUrl = S.collapse(request && request.url);
    if (!S.docPageId(requestedUrl)) {
      throw new Error(`tài liệu: URL không đọc được: ${String(request && request.url)}`);
    }
    const settings = { ...S.DEFAULTS, ...((options && options.settings) || {}) };
    const min = Number(settings.docsMinChars) > 0 ? Number(settings.docsMinChars) : S.DEFAULTS.docsMinChars;
    const t = tiers || {};
    const attempts = [];

    let first = null;
    if (typeof t.sameOrigin === 'function') {
      try {
        first = readAt(await t.sameOrigin(requestedUrl), requestedUrl, 'nấc 1', options);
        attempts.push({ via: 'fetch', ok: true, chars: first.chars });
      } catch (error) {
        attempts.push({ via: 'fetch', ok: false, reason: messageOf(error) });
      }
    } else {
      attempts.push({ via: 'fetch', ok: false, reason: 'không có adapter fetch cùng origin' });
    }

    if (first && first.chars >= min) {
      return { ...first, via: 'fetch', escalated: false, attempts, note: noteFor({ chars: first.chars, min, escalated: false }) };
    }

    let second = null;
    if (t.tab) {
      try {
        second = readAt(await readViaTab(requestedUrl, t.tab, options), requestedUrl, 'nấc 2', options);
        attempts.push({ via: 'tab', ok: true, chars: second.chars });
      } catch (error) {
        attempts.push({ via: 'tab', ok: false, reason: messageOf(error) });
      }
    } else {
      attempts.push({ via: 'tab', ok: false, reason: 'không có adapter tab ẩn' });
    }

    const reasonOf = (via) => (attempts.find((a) => a.via === via && !a.ok) || {}).reason || '';
    const firstReason = reasonOf('fetch');
    const tabReason = reasonOf('tab');
    if (second) {
      return {
        ...second,
        via: 'tab',
        escalated: true,
        attempts,
        note: noteFor({ chars: second.chars, min, via: 'tab', escalated: true, first, firstReason }),
      };
    }
    if (first) {
      return {
        ...first,
        via: 'fetch',
        escalated: true,
        attempts,
        note: noteFor({ chars: first.chars, min, via: 'fetch', escalated: true, first, tabReason }),
      };
    }

    const trail = attempts.map((a) => `${a.via} — ${a.reason}`).join('; ');
    const error = new Error(`tài liệu: không lấy được nội dung của ${requestedUrl}: ${trail}`);
    error.attempts = attempts;
    throw error;
  }

  root.NBLM_DOCS_EXTRACT = Object.freeze({
    KEEP_RATIO,
    KNOWN_RATIO,
    SETTLE,
    REASON,
    scoreBlock,
    depthOf,
    pickMainBlock,
    cleanBlock,
    titleOf,
    readDocument,
    readViaTab,
    fetchDocPage,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
