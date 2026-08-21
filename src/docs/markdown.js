/*
 * HTML -> Markdown, viết riêng cho tài liệu lập trình.
 *
 * Vì sao không dán thẳng textContent: với docs, thứ đáng giá nhất là *khối code*
 * và *cấu trúc đề mục*. textContent làm code dính liền thành một dòng, bảng biến
 * thành cháo chữ, và mất luôn cấp đề mục — NotebookLM đọc xong trả lời sai ngay.
 *
 * Ràng buộc: phải chạy được trên cả `document` sống lẫn document do DOMParser
 * dựng ra (không có layout, getComputedStyle vô nghĩa), nên mọi phán đoán chỉ
 * dựa vào tên thẻ, thuộc tính và class.
 */
;(function (root) {
  'use strict';

  /** Thẻ không bao giờ đóng góp nội dung. */
  const SKIP = new Set([
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object',
    'embed', 'video', 'audio', 'map', 'form', 'input', 'select', 'option', 'optgroup',
    'textarea', 'button', 'head', 'link', 'meta', 'base', 'dialog',
  ]);

  /** Nhãn neo tự sinh cạnh đề mục ("#", "¶", "Direct link to…"). */
  const ANCHOR_CLASS = /(^|\s)(hash-link|headerlink|anchor|anchorjs-link|header-anchor|permalink|heading-link|direct-link)(\s|$)/i;

  /* -------------------------------------------------------------------- */
  /* tiện ích                                                              */
  /* -------------------------------------------------------------------- */

  function tagOf(el) {
    return (el.tagName || '').toLowerCase();
  }

  function classOf(el) {
    const raw = el.getAttribute && el.getAttribute('class');
    return typeof raw === 'string' ? raw : '';
  }

  /**
   * Ẩn theo *thuộc tính* — không dùng getComputedStyle vì document của DOMParser
   * chưa từng được layout nên style luôn trả về mặc định.
   */
  function isHidden(el) {
    if (el.hasAttribute('hidden')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '');
  }

  function collapse(text) {
    return String(text || '').replace(/\s+/g, ' ');
  }

  function absUrl(raw, baseUrl) {
    if (!raw) return '';
    try {
      return new URL(raw, baseUrl || undefined).toString();
    } catch (_) {
      return raw;
    }
  }

  /* -------------------------------------------------------------------- */
  /* khối code                                                             */
  /* -------------------------------------------------------------------- */

  const LANG_ATTRS = ['data-language', 'data-lang', 'data-code-language', 'lang'];
  const LANG_CLASS = /(?:^|\s)(?:language|lang|highlight|brush:|hljs)[-:]?([a-z0-9+#]+)/i;
  const NOT_A_LANG = new Set(['highlight', 'hljs', 'prettyprint', 'notranslate', 'line', 'numbers', 'source']);

  function codeLang(pre) {
    const nodes = [pre, pre.querySelector('code')].filter(Boolean);
    for (const node of nodes) {
      for (const attr of LANG_ATTRS) {
        const value = (node.getAttribute(attr) || '').trim().toLowerCase();
        if (value && !NOT_A_LANG.has(value)) return value;
      }
      const hit = LANG_CLASS.exec(classOf(node));
      if (hit && hit[1] && !NOT_A_LANG.has(hit[1].toLowerCase())) return hit[1].toLowerCase();
    }
    return '';
  }

  /** Cột số dòng / nút Copy — chữ rác lọt vào fence là NotebookLM đọc sai code. */
  const CODE_JUNK = [
    '.linenos', '.lineno', '.linenodiv', '.line-numbers-rows', '.gutter', '.gutter-cell',
    '.hljs-ln-numbers', '.code-line-numbers', '.copy', '.copy-button', '.copyButton',
    '[class*="lineNumber" i]', '[class*="copy-to-clipboard" i]', '[aria-hidden="true"]',
    'button', 'svg',
  ].join(',');

  /** Class mà các bộ highlight dùng để bọc *một dòng* code. */
  const LINE_CLASS = /(^|\s)(token-line|code-line|line|row|ec-line)(\s|$)/;

  /**
   * Lấy text của <pre> có xuống dòng đúng chỗ.
   *
   * Bẫy lớn nhất ở đây: Prism-react (Docusaurus) và Shiki dựng mỗi dòng thành
   * một phần tử riêng và *không* có ký tự '\n' nào trong DOM. textContent khi đó
   * trả về cả trăm dòng code dính liền nhau thành một dòng khổng lồ.
   */
  function codeText(pre) {
    const clone = pre.cloneNode(true);
    clone.querySelectorAll(CODE_JUNK).forEach((n) => n.remove());

    let out = '';
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          out += child.nodeValue;
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = tagOf(child);
        if (SKIP.has(tag)) continue;
        if (tag === 'br') {
          out += '\n';
          continue;
        }
        const before = out.length;
        walk(child);
        const isLine = tag === 'div' || tag === 'tr' || tag === 'p' || LINE_CLASS.test(classOf(child));
        if (isLine && out.length > before && !out.endsWith('\n')) out += '\n';
      }
    })(clone);

    // \u00a0: nhiều bộ highlight dùng nbsp để thụt đầu dòng — giữ nguyên là code sai thụt lề
    return out.replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '').replace(/^\n+|\s+$/g, '');
  }

  function fenceFor(body) {
    let longest = 0;
    for (const run of body.match(/`+/g) || []) longest = Math.max(longest, run.length);
    return '`'.repeat(Math.max(3, longest + 1));
  }

  /* -------------------------------------------------------------------- */
  /* bộ chuyển                                                             */
  /* -------------------------------------------------------------------- */

  /**
   * Chuyển nội dung *bên trong* `el` thành Markdown.
   * @param {Element} el
   * @param {{baseUrl?:string, keepLinks?:boolean, keepImages?:boolean}} options
   */
  function convert(el, options) {
    const o = Object.assign({ baseUrl: '', keepLinks: false, keepImages: true }, options || {});
    return children(el, o).replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Duyệt các con của `node`, gom phần inline lại thành đoạn và tách khối bằng
   * dòng trống. Đây là chỗ duy nhất quyết định "cái gì xuống dòng".
   */
  function children(node, o) {
    const blocks = [];
    let inline = [];

    const flush = () => {
      const text = inline.join('').replace(/[ \t]+/g, ' ').trim();
      inline = [];
      if (text) blocks.push(text);
    };

    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        inline.push(collapse(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;

      const tag = tagOf(child);
      if (SKIP.has(tag) || isHidden(child)) continue;

      const asBlock = block(child, tag, o);
      if (asBlock === null) {
        inline.push(inlineOf(child, tag, o));
        continue;
      }
      flush();
      if (asBlock.trim()) blocks.push(asBlock);
    }
    flush();
    return blocks.join('\n\n');
  }

  /** Rút gọn một cây con về một dòng — dùng cho đề mục và ô bảng. */
  function oneLine(node, o) {
    return children(node, o).replace(/\s*\n+\s*/g, ' ').trim();
  }

  /**
   * Trả về Markdown nếu `el` là phần tử khối, hoặc `null` để báo "cái này inline,
   * hãy nối vào đoạn đang dựng".
   */
  function block(el, tag, o) {
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const text = oneLine(el, o);
        return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
      }

      case 'p':
        return children(el, o);

      case 'pre': {
        const body = codeText(el);
        if (!body.trim()) return '';
        const fence = fenceFor(body);
        return `${fence}${codeLang(el)}\n${body}\n${fence}`;
      }

      case 'hr':
        return '---';

      case 'ul': case 'ol':
        return list(el, tag === 'ol', o);

      case 'blockquote': {
        const body = children(el, o);
        return body ? body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n') : '';
      }

      case 'table':
        return table(el, o);

      case 'dl':
        return definitions(el, o);

      case 'figure': case 'figcaption': case 'details': case 'summary':
      case 'div': case 'section': case 'article': case 'main': case 'aside':
      case 'header': case 'footer': case 'nav': case 'li': case 'dd': case 'dt':
      case 'fieldset': case 'address': case 'picture':
        return children(el, o);

      default:
        return null; // inline
    }
  }

  function inlineOf(el, tag, o) {
    switch (tag) {
      case 'br':
        return '\n';

      case 'code': case 'kbd': case 'samp': case 'tt': {
        const text = collapse(el.textContent).trim();
        if (!text) return '';
        const tick = text.includes('`') ? '``' : '`';
        const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
        return `${tick}${pad}${text}${pad}${tick}`;
      }

      case 'strong': case 'b': {
        const text = oneLine(el, o);
        return text ? `**${text}**` : '';
      }

      case 'em': case 'i': case 'var': case 'cite': {
        const text = oneLine(el, o);
        return text ? `*${text}*` : '';
      }

      case 'del': case 's': case 'strike': {
        const text = oneLine(el, o);
        return text ? `~~${text}~~` : '';
      }

      case 'a': {
        if (ANCHOR_CLASS.test(classOf(el))) return ''; // neo "#" cạnh đề mục
        const text = oneLine(el, o);
        if (!text || /^[#¶§🔗]+$/.test(text)) return '';
        if (!o.keepLinks) return text;
        const href = absUrl(el.getAttribute('href'), o.baseUrl);
        return href && !href.startsWith('javascript:') ? `[${text}](${href})` : text;
      }

      case 'img': {
        if (!o.keepImages) return '';
        const alt = collapse(el.getAttribute('alt') || '').trim();
        const src = absUrl(el.getAttribute('src') || el.getAttribute('data-src'), o.baseUrl);
        if (!src || src.startsWith('data:')) return alt ? `[hình: ${alt}]` : '';
        return `![${alt}](${src})`;
      }

      default:
        return children(el, o);
    }
  }

  /* -------------------------------------------------------------------- */
  /* danh sách / bảng / định nghĩa                                         */
  /* -------------------------------------------------------------------- */

  function list(el, ordered, o) {
    let counter = Number(el.getAttribute('start')) || 1;
    const lines = [];

    for (const li of Array.from(el.children)) {
      if (tagOf(li) !== 'li' || isHidden(li)) continue;
      const body = children(li, o).trim();
      if (!body) continue;

      const marker = ordered ? `${counter++}. ` : '- ';
      const pad = ' '.repeat(marker.length);
      const rows = body.split('\n');
      lines.push(marker + rows[0] + rows.slice(1).map((r) => `\n${r ? pad + r : ''}`).join(''));
    }
    return lines.join('\n');
  }

  function table(el, o) {
    const rows = [];
    for (const tr of el.querySelectorAll('tr')) {
      if (isHidden(tr)) continue;
      const cells = Array.from(tr.children)
        .filter((c) => /^t[hd]$/.test(tagOf(c)))
        .map((c) => oneLine(c, o).replace(/\|/g, '\\|'));
      if (!cells.length) continue;
      const heading = Array.from(tr.children).every((c) => tagOf(c) === 'th');
      rows.push({ cells, heading });
    }
    if (!rows.length) return '';

    const width = rows.reduce((max, r) => Math.max(max, r.cells.length), 0);
    const pad = (r) => r.cells.concat(Array(Math.max(0, width - r.cells.length)).fill(''));

    // Không có hàng tiêu đề thì dựng một hàng rỗng — Markdown bắt buộc phải có.
    const head = rows[0].heading ? pad(rows.shift()) : Array(width).fill('');
    const out = [`| ${head.join(' | ')} |`, `| ${Array(width).fill('---').join(' | ')} |`];
    for (const row of rows) out.push(`| ${pad(row).join(' | ')} |`);
    return out.join('\n');
  }

  function definitions(el, o) {
    const lines = [];
    for (const child of Array.from(el.children)) {
      const tag = tagOf(child);
      if (isHidden(child)) continue;
      if (tag === 'dt') {
        const text = oneLine(child, o);
        if (text) lines.push(`- **${text}**`);
      } else if (tag === 'dd') {
        const body = children(child, o).trim();
        if (body) lines.push(body.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n'));
      }
    }
    return lines.join('\n');
  }

  root.NBLM_MD = { convert, codeText, codeLang, isHidden, SKIP };
})(globalThis);
