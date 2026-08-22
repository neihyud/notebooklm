// Cây node của một trang tài liệu → Markdown. Seam 3: nhận một cây node, trả một chuỗi.
//
// Vì sao không phải `textContent`: với docs lập trình, thứ đáng giá nhất là **khối code** và
// **cấp đề mục**, mà `textContent` xoá sạch cả hai. Tệ hơn, nó xoá đúng cái quan trọng nhất
// một cách vô hình — Prism-react (Docusaurus) và Shiki dựng mỗi dòng code thành một phần tử
// riêng **không có ký tự `\n` nào**, nên 40 dòng code ra một dòng dài 900 ký tự vẫn "đọc trôi
// chảy" với một cái máy, và không dùng được với một con người.
//
// File này không chạm `chrome.*` và không chạm `document` toàn cục: mọi hàm nhận vào node được
// truyền tới. Đó là điều kiện để `test/docs-markdown.test.js` kiểm bằng cây giả.
//
// Cố ý **không** escape ký tự Markdown trong chữ thường (`*`, `_`, `[`). Nguồn ở đây là thứ
// NotebookLM đọc để trả lời, không phải thứ đem đi render lại; escape làm chữ khó đọc hơn cho
// cả người lẫn mô hình, đổi lại một sự chính xác không ai tiêu thụ.
(function (root) {
  'use strict';

  if (root.NBLM_DOCS_MARKDOWN) return;

  const S = root.NBLM_SHARED;
  const D = root.NBLM_DOCS_SELECTORS;
  if (!S) throw new Error('docs/markdown: cần src/common/shared.js nạp trước');
  if (!D) throw new Error('docs/markdown: cần src/docs/selectors.js nạp trước');

  const HEADING_LEVEL = Object.freeze({ H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 });

  /**
   * Thẻ mở một khối mới. Danh sách này quyết định chỗ xuống dòng: thẻ không có trong đây được
   * gộp vào đoạn văn đang dựng, nên một `<span>` giữa câu không cắt câu làm đôi.
   */
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR',
    'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT',
    'TH', 'THEAD', 'TR', 'UL',
  ]);

  const tagOf = (node) => (node && typeof node.tagName === 'string' ? node.tagName : '');
  const isElement = (node) => tagOf(node) !== '';
  /** Gộp khoảng trắng **ngang**, giữ `\n` — `<br>` sinh ra `\n` và nó phải sống sót. */
  const squeeze = (value) => String(value == null ? '' : value).replace(/[^\S\n]+/g, ' ');
  /** Một dòng code: bỏ `\r`, cắt đuôi trắng. Thụt đầu dòng **không** được đụng tới. */
  const codeLineText = (value) => String(value == null ? '' : value).replace(/\r/g, '').replace(/\s+$/, '');

  const selectorsOf = (options) => {
    const given = options && options.selectors;
    if (!given) return D.DEFAULT;
    return typeof given.css === 'function' ? given : D.resolve(given);
  };

  /**
   * Những node khớp `css` mà **không** có tổ tiên nào (trong phạm vi `node`) cũng khớp.
   *
   * Dùng chung cho hai việc trông khác nhau nhưng là một: đếm chữ theo khối (`<p>` lồng trong
   * `<li>` không được đếm hai lần) và cắt dòng code (`.line` lồng trong `.token-line` là một
   * dòng, không phải hai). Vì vậy nó nằm ở đây và `src/docs/extract.js` gọi lại, thay vì mỗi
   * bên một bản chép.
   */
  function outermost(node, css) {
    const all = Array.from(node.querySelectorAll(css));
    const found = new Set(all);
    return all.filter((el) => {
      let parent = el.parentElement;
      while (parent && parent !== node) {
        if (found.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ khối code

  /** Số dấu ` cần cho một fence bọc được `text`: luôn nhiều hơn chuỗi ` dài nhất bên trong. */
  function fenceTicks(text, minimum) {
    let longest = 0;
    for (const run of String(text).match(/`+/g) || []) longest = Math.max(longest, run.length);
    return Math.max(minimum, longest + 1);
  }

  function normalizeLanguage(value) {
    const clean = S.collapse(value).toLowerCase().replace(/[^a-z0-9+#._-]/g, '');
    if (!clean || D.NOT_A_LANGUAGE.includes(clean)) return '';
    return clean;
  }

  /**
   * Ngôn ngữ của một khối code, đọc từ **chính khối ấy**: `language-*` / `lang-*` trên `<pre>`
   * hoặc `<code>` của nó, hoặc `data-lang`.
   *
   * "Chính khối ấy" là cả điểm: một trang docs có nhiều khối code cạnh nhau, và hai nhãn ngôn
   * ngữ là hai chuỗi cùng kiểu — lấy nhãn của khối bên cạnh vẫn ra một fence mở đúng khuôn,
   * chỉ là tô màu sai và người đọc tin nhầm ngôn ngữ.
   */
  function languageOf(pre, options) {
    const sel = selectorsOf(options);
    for (const node of [pre, ...pre.querySelectorAll('code')]) {
      for (const attribute of sel.LANG_ATTRIBUTES) {
        const value = normalizeLanguage(node.getAttribute(attribute));
        if (value) return value;
      }
      for (const name of node.classList) {
        for (const prefix of sel.LANG_PREFIXES) {
          if (name.length <= prefix.length || !name.startsWith(prefix)) continue;
          const value = normalizeLanguage(name.slice(prefix.length));
          if (value) return value;
        }
      }
    }
    return '';
  }

  /**
   * Các dòng của một khối code.
   *
   * Hai hình dạng, và thứ tự thử là bắt buộc: **ranh giới phần tử trước, `\n` sau**. Khối
   * Prism-react/Shiki có ranh giới phần tử mà không có `\n` nào, nên hỏi `\n` trước là luôn
   * nhận đúng một dòng và không bao giờ biết mình đã sai.
   *
   * Làm việc trên bản sao: cột số dòng và nút Copy phải bị gỡ, mà gỡ trên cây thật là sửa
   * trang của người dùng.
   */
  function codeLines(pre, options) {
    const sel = selectorsOf(options);
    const copy = pre.cloneNode(true);
    for (const junk of copy.querySelectorAll(sel.css('codeNoise'))) junk.remove();

    const holder = copy.querySelector('code') || copy;
    const rows = outermost(holder, sel.css('codeLine'));
    const lines = rows.length > 0
      ? rows.map((row) => codeLineText(row.textContent))
      : codeLineText(holder.textContent).replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+$/, ''));

    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
  }

  function fenceOf(pre, options) {
    const body = codeLines(pre, options).join('\n');
    if (!body.trim()) return '';
    const ticks = '`'.repeat(fenceTicks(body, 3));
    return `${ticks}${languageOf(pre, options)}\n${body}\n${ticks}`;
  }

  // ------------------------------------------------------------------ chữ trong dòng

  function wrap(text, marker) {
    const body = text.trim();
    if (!body) return '';
    return `${text.startsWith(' ') ? ' ' : ''}${marker}${body}${marker}${text.endsWith(' ') ? ' ' : ''}`;
  }

  function inlineOf(node, ctx) {
    if (!isElement(node)) return String(node && node.textContent != null ? node.textContent : '');
    if (node.matches(ctx.dropped)) return '';

    const tag = tagOf(node);
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') {
      const src = S.collapse(node.getAttribute('src'));
      return src ? `![${S.collapse(node.getAttribute('alt'))}](${src})` : '';
    }

    const inner = childInline(node, ctx);
    if (tag === 'A') {
      const text = squeeze(inner).trim();
      if (!text) return '';
      const href = S.collapse(node.getAttribute('href'));
      return href ? `[${text}](${href})` : text;
    }
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') {
      const text = squeeze(inner).replace(/\n+/g, ' ').trim();
      if (!text) return '';
      const ticks = '`'.repeat(fenceTicks(text, 1));
      return `${ticks}${text}${ticks}`;
    }
    if (tag === 'STRONG' || tag === 'B') return wrap(inner, '**');
    if (tag === 'EM' || tag === 'I') return wrap(inner, '*');
    if (tag === 'DEL' || tag === 'S') return wrap(inner, '~~');
    return inner;
  }

  function childInline(node, ctx) {
    let out = '';
    for (const child of node.childNodes) out += inlineOf(child, ctx);
    return out;
  }

  /** Một đoạn văn: gộp khoảng trắng ngang, bỏ dòng rỗng, cắt trắng hai đầu từng dòng. */
  const paragraphOf = (text) => squeeze(text).split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

  // ------------------------------------------------------------------ khối

  const startsAList = (block) => /^(?:- |\d+\. )/.test(block);

  function listOf(list, ctx, ordered) {
    const out = [];
    let index = 0;
    for (const child of list.children) {
      if (tagOf(child) !== 'LI') continue;
      index += 1;
      const blocks = childBlocks(child, ctx);
      if (blocks.length === 0) continue;

      const marker = ordered ? `${index}. ` : '- ';
      const pad = ' '.repeat(marker.length);
      // Danh sách lồng dính liền mục cha; khối khác cách một dòng trống.
      const body = blocks.reduce((acc, block, i) => (
        i === 0 ? block : `${acc}${startsAList(block) ? '\n' : '\n\n'}${block}`
      ), '');
      out.push(body.split('\n').map((line, i) => {
        if (i === 0) return marker + line;
        return line ? pad + line : '';
      }).join('\n'));
    }
    return out.join('\n');
  }

  function tableOf(table, ctx) {
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = [];
      for (const cell of tr.children) {
        const tag = tagOf(cell);
        if (tag !== 'TD' && tag !== 'TH') continue;
        cells.push(squeeze(childInline(cell, ctx)).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return '';

    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const line = (row) => `| ${[...row, ...Array(width - row.length).fill('')].join(' | ')} |`;
    return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
  }

  function blocksOf(node, ctx) {
    if (!isElement(node)) {
      const text = paragraphOf(node && node.textContent);
      return text ? [text] : [];
    }
    if (node.matches(ctx.dropped)) return [];

    const tag = tagOf(node);
    if (tag === 'PRE') {
      const fence = fenceOf(node, ctx.options);
      return fence ? [fence] : [];
    }
    if (HEADING_LEVEL[tag]) {
      const text = squeeze(childInline(node, ctx)).replace(/\n+/g, ' ').trim();
      return text ? [`${'#'.repeat(HEADING_LEVEL[tag])} ${text}`] : [];
    }
    if (tag === 'HR') return ['---'];
    if (tag === 'UL' || tag === 'OL') {
      const list = listOf(node, ctx, tag === 'OL');
      return list ? [list] : [];
    }
    if (tag === 'BLOCKQUOTE') {
      const inner = childBlocks(node, ctx);
      if (inner.length === 0) return [];
      return [inner.join('\n\n').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')];
    }
    if (tag === 'TABLE') {
      const table = tableOf(node, ctx);
      return table ? [table] : [];
    }
    return childBlocks(node, ctx);
  }

  /**
   * Con của một khối: chữ rời và thẻ trong dòng gom thành đoạn văn, thẻ khối cắt đoạn ấy ra.
   * Không gom là mỗi `<span>` thành một dòng riêng; gom hết là cả trang thành một đoạn.
   */
  function childBlocks(node, ctx) {
    const out = [];
    let buffer = '';
    const flush = () => {
      const text = paragraphOf(buffer);
      if (text) out.push(text);
      buffer = '';
    };

    for (const child of node.childNodes) {
      if (isElement(child) && BLOCK_TAGS.has(tagOf(child))) {
        flush();
        out.push(...blocksOf(child, ctx));
      } else {
        buffer += inlineOf(child, ctx);
      }
    }
    flush();
    return out;
  }

  function contextOf(options) {
    const sel = selectorsOf(options);
    return { options: { ...(options || {}), selectors: sel }, sel, dropped: sel.css('dropped') };
  }

  /** Cây node → Markdown. Không sửa cây được truyền vào. */
  function toMarkdown(node, options) {
    if (!node) return '';
    const ctx = contextOf(options);
    return blocksOf(node, ctx).filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  root.NBLM_DOCS_MARKDOWN = Object.freeze({
    BLOCK_TAGS,
    outermost,
    fenceTicks,
    languageOf,
    codeLines,
    toMarkdown,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
