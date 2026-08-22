// Bộ phép thử dùng chung cho `tools/audit-fake-dom.mjs` (ticket 016).
//
// Mỗi phép thử ở đây chạy **hai lần trên cùng một đoạn nguồn**: một lần trong Node trên
// `test/helpers/fake-dom.js`, một lần trong Chromium thật qua CDP. Vì vậy mọi thứ trong file này
// phải **tự chứa**: thân phép thử được gửi sang trình duyệt bằng `Function.prototype.toString()`,
// nên nó chỉ được chạm vào `root`, `ctx`, và global có ở cả hai nơi. Một biến closure lọt vào là
// một `ReferenceError` bên trình duyệt, không phải một chỗ lệch.
//
// Vì sao so **kiểu** chứ không so nội dung: lỗi ticket 009 là `children` trả Array thay vì
// `HTMLCollection`. Hai bên có cùng `length`, cùng phần tử, cùng thứ tự — chỉ khác ở chỗ một bên
// có `.filter`. Nên `describe()` dưới đây mô tả một tập hợp bằng **năng lực** của nó
// (`isArray`/`iter`/danh sách phương thức) chứ không bằng tên constructor: tên constructor thì
// `FakeNodeList` ≠ `HTMLCollection` ở *mọi* phép thử, và tín hiệu thật chìm mất.

import { FakeElement, el, input } from '../test/helpers/fake-dom.js';

/**
 * Mô tả một giá trị thành chuỗi so sánh được, giống hệt nhau ở cả hai cây khi hai bên **hành xử**
 * như nhau. Hàm này được gửi sang trình duyệt dưới dạng nguồn, nên nó không tham chiếu ra ngoài.
 */
export function describe(value) {
  const CAPS = [
    'item', 'namedItem', 'forEach', 'entries', 'keys', 'values',
    'map', 'filter', 'some', 'every', 'includes', 'indexOf', 'join', 'slice', 'concat',
    'contains', 'add', 'toggle', 'replace', 'supports',
  ];

  function isElement(v) {
    return typeof v.tagName === 'string' && typeof v.getAttribute === 'function';
  }

  function isFragment(v) {
    return v.nodeType === 11 || (Object.prototype.hasOwnProperty.call(v, 'host') && !!v.host)
      || (v.host !== undefined && v.host !== null && typeof v.querySelector === 'function' && !isElement(v));
  }

  function elementLabel(v) {
    const id = v.getAttribute('id');
    const cls = v.getAttribute('class');
    return `<${String(v.tagName).toUpperCase()}${id ? `#${id}` : ''}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''}>`;
  }

  function walk(v, depth) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    const t = typeof v;
    if (t === 'string') return `str(${JSON.stringify(v)})`;
    if (t === 'number') return `num(${Object.is(v, -0) ? '-0' : String(v)})`;
    if (t === 'boolean') return `bool(${String(v)})`;
    if (t === 'bigint') return `bigint(${String(v)})`;
    if (t === 'symbol') return 'symbol';
    if (t === 'function') return 'function';

    if (isFragment(v)) return `Fragment(mode=${v.mode === undefined ? '-' : String(v.mode)})`;
    if (isElement(v)) return elementLabel(v);
    if (typeof v.data === 'string' && v.tagName === undefined) return `#text(${JSON.stringify(v.data)})`;

    if (typeof v.length === 'number') {
      // Mảng thật in gọn: một phép thử trả `[a, b]` thì hai bên đều là Array, và dán cả bề mặt
      // Array.prototype vào mỗi dòng chỉ làm chìm mất chỗ lệch thật. Còn thứ *giống* mảng mà
      // không phải Array — `HTMLCollection`, `NodeList`, `DOMTokenList` — thì chính bề mặt của
      // nó là câu hỏi, nên in đủ.
      const items = [];
      if (depth < 2) for (let i = 0; i < Math.min(v.length, 8); i += 1) items.push(walk(v[i], depth + 1));
      const body = depth < 2 ? items.join(' ') : '…';
      if (Array.isArray(v)) return `[${body}]`;
      const caps = CAPS.filter((k) => typeof v[k] === 'function');
      return `AL(len=${v.length}, iter=${typeof v[Symbol.iterator] === 'function' ? 1 : 0}`
        + `, caps=[${caps.join(',')}])[${body}]`;
    }

    if (v instanceof Map || v instanceof Set) return `${v instanceof Map ? 'Map' : 'Set'}(size=${v.size})`;

    if (depth >= 2) return '{…}';
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${k}: ${walk(v[k], depth + 1)}`).join(', ')}}`;
  }

  return walk(value, 0);
}

/**
 * Dựng cây thật trong trình duyệt từ cùng một bản mô tả mà cây giả dùng. Gửi sang bằng nguồn.
 *
 * Cố ý dựng bằng `createElement`/`append` chứ **không** bằng `innerHTML`: cây giả không có bộ
 * phân tích HTML, nên đọc HTML một bên và dựng tay bên kia là so hai thứ khác nhau — mọi chỗ lệch
 * sẽ đổ hết cho bộ phân tích (text node khoảng trắng, `<template>`, `<noscript>`) và che mất chỗ
 * lệch của chính API.
 */
export function buildReal(spec, doc) {
  if (typeof spec === 'string') return spec;
  const node = doc.createElement(spec.t);
  for (const [name, value] of Object.entries(spec.a || {})) node.setAttribute(name, value);
  for (const child of spec.c || []) node.append(buildReal(child, doc));
  return node;
}

/** Cùng bản mô tả, dựng trên cây giả. `input`/`textarea` thành `FakeInput`, đúng như DOM thật. */
export function buildFake(spec) {
  if (typeof spec === 'string') return spec;
  const tag = String(spec.t).toLowerCase();
  const node = tag === 'input' || tag === 'textarea' || tag === 'select'
    ? input(spec.t, spec.a || {})
    : el(spec.t, spec.a || {});
  for (const child of spec.c || []) node.append(buildFake(child, undefined));
  return node;
}

/** `document` giả — đúng bề mặt mà các test của repo tiêm vào (`createElement`, `body`). */
export function fakeDocument() {
  const body = el('body');
  return {
    body,
    createElement(tag) {
      const t = String(tag).toLowerCase();
      return t === 'input' || t === 'textarea' || t === 'select' ? input(tag) : el(tag);
    },
  };
}

// --------------------------------------------------------------------------- bản mô tả cây

/**
 * Một trang tài liệu thu nhỏ: chữ lẫn thẻ ở cùng một cấp (để `children` ≠ `childNodes`), danh
 * sách lồng danh sách (`ul ul` của `nestedList`), link có `href`, và một `<button disabled>`
 * (`[disabled]` của selector NotebookLM).
 */
export const PAGE = {
  t: 'div',
  a: { id: 'root', class: 'panel wide' },
  c: [
    'lead ',
    {
      t: 'ul',
      a: { class: 'nav sidebar' },
      c: [
        { t: 'li', a: { id: 'first' }, c: [{ t: 'a', a: { href: '/a', class: 'hash-link' }, c: ['A'] }] },
        {
          t: 'li',
          c: ['B ', { t: 'ul', c: [{ t: 'li', c: [{ t: 'a', a: { href: '/b' }, c: ['B1'] }] }] }],
        },
      ],
    },
    { t: 'button', a: { type: 'button', disabled: '', class: 'Copy' }, c: ['Copy'] },
    ' tail',
  ],
};

/** Cây phẳng ba con, không có text node — để phép thử về tập hợp đọc dễ. */
export const TRIO = {
  t: 'div',
  a: { id: 'trio' },
  c: [{ t: 'i', a: { id: 'i1' } }, { t: 'b', a: { id: 'b1' } }, { t: 'i', a: { id: 'i2' } }],
};

// --------------------------------------------------------------------------- phép thử

/**
 * `body(root, ctx)` — `ctx` có `doc`, `make(spec)`, `ev(type, init)`, `describe`.
 * `why` là câu trả lời sẵn cho "chỗ này lệch thì hỏng ở đâu trong `src/`".
 */
export const PROBES = [
  // ---------------------------------------------------------------- children
  {
    id: 'children/shape', group: 'children', fixture: PAGE,
    why: 'sidebar.js:326 childrenMatching, picker.js:89/238, panel.js:281/348, playlist-bar.js:142',
    body: (root) => root.children,
  },
  {
    id: 'children/excludes-text', group: 'children', fixture: PAGE,
    why: 'sidebar.js:326 lọc con trực tiếp — text node lọt vào là .matches nổ',
    body: (root) => [root.children.length, root.childNodes.length],
  },
  {
    id: 'children/item', group: 'children', fixture: TRIO,
    why: 'mọi chỗ đọc children theo chỉ số',
    body: (root) => [root.children.item(1), root.children.item(9), root.children[0]],
  },
  {
    id: 'children/named-item', group: 'children', fixture: TRIO,
    why: 'HTMLCollection có namedItem, NodeList không — dấu hiệu phân biệt hai kiểu',
    body: (root) => [typeof root.children.namedItem, typeof root.children.forEach],
  },
  {
    id: 'children/spread', group: 'children', fixture: TRIO,
    why: 'picker.js:89 Array.from(node.children)',
    body: (root) => [...root.children],
  },
  {
    id: 'children/live', group: 'children', fixture: TRIO,
    why: 'picker.js:89/238, panel.js:281/348, playlist-bar.js:142 xoá con trong lúc duyệt — '
      + 'Array.from là bắt buộc CHỈ VÌ HTMLCollection sống',
    body: (root, ctx) => {
      const kids = root.children;
      const before = kids.length;
      root.append(ctx.make({ t: 'u' }));
      const afterAppend = kids.length;
      root.children[0].remove();
      return [before, afterAppend, kids.length];
    },
  },
  {
    id: 'children/remove-while-iterating', group: 'children', fixture: TRIO,
    why: 'khuôn "dọn hết con" của picker/panel/playlist-bar — bỏ Array.from thì trên trang thật '
      + 'chỉ xoá được một nửa, còn trên cây giả vẫn xoá sạch',
    body: (root) => {
      const seen = [];
      for (const child of root.children) { seen.push(child.tagName); child.remove(); }
      return [seen.join(','), root.children.length];
    },
  },
  {
    id: 'children/empty', group: 'children', fixture: { t: 'div', c: ['chỉ có chữ'] },
    why: '-',
    body: (root) => root.children,
  },

  // ---------------------------------------------------------------- childNodes
  {
    id: 'childNodes/shape', group: 'childNodes', fixture: PAGE,
    why: 'sidebar.js:331 ownLabel, markdown.js:186/284 inlineOf/blocksOf',
    body: (root) => root.childNodes,
  },
  {
    id: 'childNodes/live', group: 'childNodes', fixture: TRIO,
    why: 'markdown.js:186 duyệt childNodes; NodeList thật sống',
    body: (root, ctx) => {
      const kids = root.childNodes;
      const before = kids.length;
      root.append(ctx.make({ t: 'u' }));
      return [before, kids.length];
    },
  },
  {
    id: 'childNodes/readonly', group: 'childNodes', fixture: TRIO,
    why: 'notebooklm.test.js:400 gán thẳng node.childNodes = [] — DOM thật không cho',
    body: (root) => {
      root.childNodes = [];
      return root.childNodes.length;
    },
  },
  {
    id: 'childNodes/text-nodes', group: 'childNodes', fixture: PAGE,
    why: 'sidebar.js:333 lấy child.textContent của mọi childNodes',
    body: (root) => [...root.childNodes].map((n) => (n.tagName ? n.tagName : `#text:${n.textContent}`)),
  },

  // ---------------------------------------------------------------- classList
  {
    id: 'classList/shape', group: 'classList', fixture: PAGE,
    why: 'markdown.js:102 for (const name of node.classList)',
    body: (root) => root.classList,
  },
  {
    id: 'classList/contains', group: 'classList', fixture: PAGE,
    why: 'DOMTokenList có contains, Array có includes — hai bề mặt loại trừ nhau',
    body: (root) => [typeof root.classList.contains, typeof root.classList.includes, typeof root.classList.add],
  },
  {
    id: 'classList/iterate', group: 'classList', fixture: PAGE,
    why: 'markdown.js:102 — đường duy nhất src đang đi',
    body: (root) => { const out = []; for (const name of root.classList) out.push(name); return out; },
  },
  {
    id: 'classList/value', group: 'classList', fixture: PAGE,
    why: '-', body: (root) => [String(root.classList), root.classList.value, root.classList.length],
  },
  {
    id: 'classList/no-class-attr', group: 'classList', fixture: TRIO,
    why: 'markdown.js:102 chạy trên mọi node, kể cả node không có class',
    body: (root) => [root.classList.length, [...root.classList]],
  },
  {
    id: 'classList/mutate', group: 'classList', fixture: TRIO,
    why: '-',
    body: (root) => {
      if (typeof root.classList.add !== 'function') return 'no add()';
      root.classList.add('x');
      return [root.getAttribute('class'), root.classList.length];
    },
  },

  // ---------------------------------------------------------------- querySelectorAll
  {
    id: 'qsa/shape', group: 'querySelectorAll', fixture: PAGE,
    why: 'sidebar.js:160, extract.js, markdown.js, panel.js — 31 lượt gọi trong src',
    body: (root) => root.querySelectorAll('li'),
  },
  {
    id: 'qsa/document-order', group: 'querySelectorAll', fixture: PAGE,
    why: 'ticket 007: bẫy "wrapper luôn đứng trước <button> thật" sống nhờ đúng thứ tự này',
    body: (root) => [...root.querySelectorAll('ul, li, a')].map((n) => n.tagName),
  },
  {
    id: 'qsa/excludes-self', group: 'querySelectorAll', fixture: PAGE,
    why: 'extract.js/sidebar.js chấm điểm khối rồi quét trong khối — khối tự khớp là đếm hai lần',
    body: (root) => root.querySelectorAll('div').length,
  },
  {
    id: 'qsa/no-match', group: 'querySelectorAll', fixture: PAGE,
    why: '-', body: (root) => [root.querySelectorAll('table'), root.querySelector('table')],
  },
  {
    id: 'qsa/descendant', group: 'querySelectorAll', fixture: PAGE,
    why: "docs/selectors.js nestedList: 'ul ul' — dấu hiệu 'đây là cây mục lục'",
    body: (root) => [root.querySelectorAll('ul ul').length, root.querySelector('ul ul')],
  },
  {
    id: 'qsa/child-combinator', group: 'querySelectorAll', fixture: PAGE,
    accepted: 'chưa selector nào trong src/*/selectors.js dùng `>`; cây giả NÉM ở đây, nên ai '
      + 'thêm sẽ thấy đỏ ngay ở test đầu tiên chứ không phải trên trang thật',
    why: 'chưa selector nào của src dùng `>`; nếu thêm thì cây giả ném lỗi ở chỗ DOM thật chạy',
    body: (root) => [...root.querySelectorAll('ul > li')].map((n) => n.getAttribute('id') || '-'),
  },
  {
    id: 'qsa/attr-presence', group: 'querySelectorAll', fixture: PAGE,
    why: "notebooklm/selectors.js '[disabled]' — nút Chèn còn mờ hay không",
    body: (root) => root.querySelectorAll('[disabled]').length,
  },
  {
    id: 'qsa/attr-substring-case', group: 'querySelectorAll', fixture: PAGE,
    why: "docs/selectors.js có CẢ [class*=\"sidebar\"] LẪN [class*=\"Sidebar\"] — nếu khớp không "
      + 'phân biệt hoa thường thì một trong hai mục là thừa và không ai biết',
    body: (root) => [
      root.querySelectorAll('[class*="sidebar"]').length,
      root.querySelectorAll('[class*="Sidebar"]').length,
      root.querySelectorAll('[class*="Copy"]').length,
      root.querySelectorAll('[class*="copy"]').length,
    ],
  },
  {
    id: 'qsa/compound-tag-class', group: 'querySelectorAll', fixture: PAGE,
    why: "youtube/selectors.js 'h1.ytd-watch-metadata', '.ytd-video-primary-info-renderer.badge'",
    body: (root) => [root.querySelectorAll('button.Copy').length, root.querySelectorAll('ul.nav.sidebar').length],
  },
  {
    id: 'qsa/compound-tag-id', group: 'querySelectorAll', fixture: PAGE,
    why: "youtube/selectors.js 'a#thumbnail', 'a#video-title'",
    body: (root) => [root.querySelectorAll('li#first').length, root.querySelectorAll('a#first').length],
  },
  {
    id: 'qsa/attr-equals', group: 'querySelectorAll', fixture: PAGE,
    why: "docs/selectors.js '[role=\"main\"]', notebooklm '[aria-hidden=\"true\"]'",
    body: (root) => [root.querySelectorAll('[type="button"]').length, root.querySelectorAll('[type="submit"]').length],
  },
  {
    id: 'qsa/attr-prefix-href', group: 'querySelectorAll', fixture: PAGE,
    why: "youtube/selectors.js 'a[href*=\"watch?v=\"]'",
    body: (root) => [root.querySelectorAll('a[href^="/a"]').length, root.querySelectorAll('a[href*="b"]').length],
  },
  {
    id: 'qsa/universal', group: 'querySelectorAll', fixture: TRIO,
    why: '-', body: (root) => root.querySelectorAll('*').length,
  },
  {
    id: 'qsa/group-dedupe', group: 'querySelectorAll', fixture: PAGE,
    why: "sel.css() nối mọi mục bằng ', ' — một node khớp hai nhánh phải chỉ ra một lần",
    body: (root) => root.querySelectorAll('li, [id="first"]').length,
  },
  {
    id: 'qsa/static', group: 'querySelectorAll', fixture: TRIO,
    why: 'NodeList của querySelectorAll là tĩnh ở DOM thật — khác children',
    body: (root, ctx) => {
      const found = root.querySelectorAll('i');
      const before = found.length;
      root.append(ctx.make({ t: 'i' }));
      return [before, found.length];
    },
  },
  {
    id: 'qsa/bad-selector', group: 'querySelectorAll', fixture: TRIO,
    why: '-', body: (root) => root.querySelectorAll('%%%').length,
  },
  {
    id: 'qs/first-in-order', group: 'querySelectorAll', fixture: PAGE,
    why: 'extract.js chọn mainBlock theo mục đầu tiên khớp',
    body: (root) => root.querySelector('li'),
  },

  // ---------------------------------------------------------------- matches / closest
  {
    id: 'matches/tag', group: 'matches', fixture: PAGE,
    why: 'sidebar.js:319 isList, :326 childrenMatching, extract.js',
    body: (root) => [root.matches('div'), root.matches('ul'), root.matches('*')],
  },
  {
    id: 'matches/descendant', group: 'matches', fixture: PAGE,
    why: "nestedList 'ul ul' đi qua matches trong sidebar.js:319",
    body: (root) => {
      const inner = root.querySelector('ul ul');
      return [inner.matches('ul ul'), inner.matches('div ul'), root.matches('div ul')];
    },
  },
  {
    id: 'matches/group', group: 'matches', fixture: PAGE,
    why: "sel.css('navList') = 'ul, ol'",
    body: (root) => [root.querySelector('ul').matches('ul, ol'), root.matches('ul, ol')],
  },
  {
    id: 'matches/bad-selector', group: 'matches', fixture: TRIO,
    why: '-', body: (root) => root.matches('%%%'),
  },
  {
    id: 'closest/self', group: 'matches', fixture: PAGE,
    why: 'sidebar.js:161 anchor.closest(sel.OWN_UI) — nếu không tính chính node thì Bảng chọn tự dò trúng mình',
    body: (root) => root.closest('div'),
  },
  {
    id: 'closest/ancestor', group: 'matches', fixture: PAGE,
    why: 'extract.js:91, markdown.js:63 đi ngược lên',
    body: (root) => root.querySelector('a').closest('ul'),
  },
  {
    id: 'closest/none', group: 'matches', fixture: PAGE,
    why: '-', body: (root) => root.querySelector('a').closest('table'),
  },
  {
    id: 'closest/detached-root', group: 'matches', fixture: TRIO,
    why: 'cây test không gắn vào document — closest phải dừng đúng ở gốc',
    body: (root) => [root.closest('body'), root.closest('#trio')],
  },

  // ---------------------------------------------------------------- textContent
  {
    id: 'text/nested', group: 'textContent', fixture: PAGE,
    why: 'extract.js, sidebar.js:134 labelOf, automation.js:76/148 — 25 lượt trong src',
    body: (root) => root.textContent,
  },
  {
    id: 'text/empty', group: 'textContent', fixture: TRIO,
    why: '-', body: (root) => [root.querySelector('#i1').textContent, root.textContent],
  },
  {
    id: 'text/of-text-node', group: 'textContent', fixture: PAGE,
    why: 'sidebar.js:333 parts.push(child.textContent) trên text node',
    body: (root) => root.childNodes[0].textContent,
  },
  {
    id: 'text/setter', group: 'textContent', fixture: TRIO,
    why: 'src không gán textContent; nếu ai đó gán thì cây giả ném còn DOM thật nhận',
    body: (root) => { root.textContent = 'thay'; return [root.textContent, root.childNodes.length]; },
  },

  // ---------------------------------------------------------------- attributes
  {
    id: 'attr/missing', group: 'attributes', fixture: TRIO,
    why: "sidebar.js:162 linkKind(anchor.getAttribute('href')) — link không có href",
    body: (root) => root.getAttribute('href'),
  },
  {
    id: 'attr/set-number', group: 'attributes', fixture: TRIO,
    why: 'picker.js/panel.js setAttribute với giá trị dựng từ số — 60 lượt trong src',
    body: (root) => { root.setAttribute('tabindex', 3); return root.getAttribute('tabindex'); },
  },
  {
    id: 'attr/name-case', group: 'attributes', fixture: TRIO,
    why: 'DOM thật hạ chữ thường tên thuộc tính trong tài liệu HTML',
    body: (root) => { root.setAttribute('DATA-Line', 'x'); return [root.getAttribute('data-line'), root.getAttribute('DATA-Line')]; },
  },
  {
    id: 'attr/remove', group: 'attributes', fixture: PAGE,
    why: 'markdown.js/extract.js dọn thuộc tính',
    body: (root) => { root.removeAttribute('class'); return [root.getAttribute('class'), root.classList.length]; },
  },
  {
    id: 'attr/has', group: 'attributes', fixture: PAGE,
    accepted: 'src chưa gọi; là PHƯƠNG THỨC nên vắng mặt hỏng ồn ào (TypeError ngay lượt đầu), '
      + 'khác hẳn một property vắng mặt vốn chỉ trả undefined',
    why: 'src chưa dùng hasAttribute; thiếu ở cây giả là một API vắng mặt im lặng',
    body: (root) => [typeof root.hasAttribute, typeof root.hasAttributes, typeof root.toggleAttribute],
  },
  {
    id: 'attr/id-property', group: 'attributes', fixture: PAGE,
    why: "picker.js:246 dựng id từ hằng số rồi ids.test.js soi lại — .id thiếu thì đọc ra undefined",
    body: (root) => [root.id, root.className],
  },
  {
    id: 'attr/tagName-case', group: 'attributes', fixture: PAGE,
    why: 'sidebar.js:332 child.tagName, markdown.js:38 tagOf, automation.js:207',
    body: (root, ctx) => [root.tagName, ctx.doc.createElement('ytd-transcript-renderer').tagName],
  },
  {
    id: 'attr/reflect-disabled', group: 'attributes', fixture: PAGE,
    why: 'picker.js:233, playlist-bar.js:234/235 gán .disabled — DOM thật đổ ngược ra thuộc tính, '
      + "và notebooklm/selectors.js dò chính '[disabled]'",
    body: (root) => {
      const btn = root.querySelector('button');
      btn.disabled = false;
      const off = [btn.getAttribute('disabled'), btn.matches('[disabled]')];
      btn.disabled = true;
      return [off, btn.getAttribute('disabled'), btn.matches('[disabled]')];
    },
  },
  {
    id: 'attr/reflect-checked', group: 'attributes', fixture: { t: 'input', a: { type: 'checkbox' } },
    why: 'picker.js:248/262, playlist-bar.js:265/275/294 gán .checked',
    body: (root) => { root.checked = true; return [root.checked, root.getAttribute('checked')]; },
  },

  // ---------------------------------------------------------------- append / remove
  {
    id: 'append/return', group: 'append', fixture: TRIO,
    why: 'picker.js/panel.js/playlist-bar.js — 47 lượt append; trả về node là một API chỉ cây giả có',
    body: (root, ctx) => root.append(ctx.make({ t: 'u' })),
  },
  {
    id: 'append/variadic', group: 'append', fixture: TRIO,
    why: 'picker.js:178 và panel.js gọi append một đối; DOM thật nhận nhiều',
    body: (root, ctx) => { root.append(ctx.make({ t: 'u' }), ctx.make({ t: 's' })); return root.children; },
  },
  {
    id: 'append/string', group: 'append', fixture: TRIO,
    why: 'picker.js:91, panel.js:291/295, playlist-bar.js:145 append chuỗi',
    body: (root) => { root.append('chữ'); return [root.childNodes.length, root.children.length, root.textContent]; },
  },
  {
    id: 'append/moves-node', group: 'append', fixture: TRIO,
    why: 'playlist-bar.js:279 append ô tick vào thumb của hàng; append lại node đang có cha phải '
      + 'DỜI nó, không phải nhân đôi',
    body: (root, ctx) => {
      const a = ctx.make({ t: 'div', a: { id: 'a' } });
      const b = ctx.make({ t: 'div', a: { id: 'b' } });
      const kid = ctx.make({ t: 'span' });
      a.append(kid);
      b.append(kid);
      return [a.children.length, b.children.length, kid.parentElement];
    },
  },
  {
    id: 'append/parent-link', group: 'append', fixture: TRIO,
    why: 'picker.js:350, panel.js:389, playlist-bar.js:410 kiểm parentElement để khỏi gắn hai lần',
    body: (root, ctx) => {
      const kid = ctx.make({ t: 'u' });
      const before = kid.parentElement;
      root.append(kid);
      return [before, kid.parentElement, kid.parentNode === root];
    },
  },
  {
    id: 'remove/from-parent', group: 'append', fixture: TRIO,
    why: 'picker.js:89/238, panel.js:281/348, playlist-bar.js:142 — 18 lượt remove trong src',
    body: (root) => { const kid = root.children[0]; kid.remove(); return [root.children.length, kid.parentElement]; },
  },
  {
    id: 'remove/detached', group: 'append', fixture: TRIO,
    why: 'panel.js:472 link.remove() sau khi đã tải xong', body: (root, ctx) => { const kid = ctx.make({ t: 'u' }); kid.remove(); return kid.parentElement; },
  },

  // ---------------------------------------------------------------- cloneNode
  {
    id: 'clone/deep', group: 'cloneNode', fixture: PAGE,
    why: 'markdown.js:125 (khối code), extract.js:175, transcript.js:291',
    body: (root) => { const copy = root.cloneNode(true); return [copy.textContent, copy.querySelectorAll('li').length, copy.getAttribute('class')]; },
  },
  {
    id: 'clone/shallow', group: 'cloneNode', fixture: PAGE,
    why: 'cloneNode() không đối = nông ở DOM thật',
    body: (root) => { const copy = root.cloneNode(); return [copy.childNodes.length, copy.cloneNode(false).childNodes.length]; },
  },
  {
    id: 'clone/detached', group: 'cloneNode', fixture: PAGE,
    why: 'extract.js:175 clone rồi dọn, không được đụng vào cây gốc',
    body: (root) => { const copy = root.cloneNode(true); copy.querySelector('li').remove(); return [copy.querySelectorAll('li').length, root.querySelectorAll('li').length, copy.parentElement]; },
  },
  {
    id: 'clone/no-listeners', group: 'cloneNode', fixture: TRIO,
    why: '-',
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', () => seen.push('gốc'));
      const copy = root.cloneNode(true);
      copy.dispatchEvent(ctx.ev('click'));
      return seen.length;
    },
  },
  {
    id: 'clone/input-value', group: 'cloneNode', fixture: { t: 'input', a: { type: 'search' } },
    why: 'automation.js điền ô nhập; clone của ô nhập không mang theo giá trị đang gõ',
    body: (root) => { root.value = 'abc'; const copy = root.cloneNode(true); return [root.value, copy.value]; },
  },

  // ---------------------------------------------------------------- shadow DOM
  {
    id: 'shadow/attach', group: 'shadow', fixture: TRIO,
    why: 'picker.js:146/147 — Bảng chọn dựng trong cây shadow, không có lối lui',
    body: (root) => { const s = root.attachShadow({ mode: 'open' }); return [s, root.shadowRoot === s]; },
  },
  {
    id: 'shadow/not-a-child', group: 'shadow', fixture: TRIO,
    why: 'docs-picker.test.js:91 — cây shadow phải là cây riêng, findSidebar không được dò trúng nó',
    body: (root, ctx) => {
      const s = root.attachShadow({ mode: 'open' });
      s.append(ctx.make({ t: 'p', a: { class: 'panel' } }));
      return [root.children.length, root.childNodes.length, root.querySelectorAll('p').length];
    },
  },
  {
    id: 'shadow/twice', group: 'shadow', fixture: TRIO,
    why: 'picker.js:147 chỉ gọi một lần; gọi lại trên DOM thật là ném',
    body: (root) => { root.attachShadow({ mode: 'open' }); return root.attachShadow({ mode: 'open' }); },
  },
  {
    id: 'shadow/closed-mode', group: 'shadow', fixture: TRIO,
    why: "picker.js dùng mode 'open'; nếu ai đổi sang 'closed' thì host.shadowRoot thành null và "
      + 'docs-picker.test.js:89 phải đỏ',
    body: (root) => { const s = root.attachShadow({ mode: 'closed' }); return [root.shadowRoot, s === null, typeof s.append]; },
  },
  {
    id: 'shadow/root-surface', group: 'shadow', fixture: TRIO,
    why: 'ShadowRoot thật là DocumentFragment: có querySelector, KHÔNG có matches/closest/'
      + 'getAttribute/tagName — cây giả cho nó cả bề mặt Element là mở đường cho code chỉ chạy ở test',
    body: (root) => {
      const s = root.attachShadow({ mode: 'open' });
      return [typeof s.querySelector, typeof s.append, typeof s.matches, typeof s.closest,
        typeof s.getAttribute, typeof s.tagName, s.host === root];
    },
  },
  {
    id: 'shadow/child-parent', group: 'shadow', fixture: TRIO,
    why: 'picker.js:350 kiểm !nodes.host.parentElement; con trực tiếp của ShadowRoot thật có '
      + 'parentElement === null vì ShadowRoot không phải Element',
    body: (root, ctx) => {
      const s = root.attachShadow({ mode: 'open' });
      const panel = ctx.make({ t: 'div', a: { class: 'panel' } });
      s.append(panel);
      return [panel.parentElement, panel.parentNode === s, panel.closest('.panel'), panel.closest('#trio')];
    },
  },
  {
    id: 'shadow/query-inside', group: 'shadow', fixture: TRIO,
    why: 'docs-picker.test.js đọc nội dung Bảng chọn qua cây shadow',
    body: (root, ctx) => {
      const s = root.attachShadow({ mode: 'open' });
      s.append(ctx.make({ t: 'div', a: { class: 'panel' }, c: [{ t: 'p', a: { id: 'count' }, c: ['2 mục'] }] }));
      return [s.querySelector('#count'), s.querySelectorAll('.panel p').length, s.children];
    },
  },

  // ---------------------------------------------------------------- sự kiện
  {
    id: 'event/listener-runs', group: 'events', fixture: TRIO,
    why: 'picker.js:249, playlist-bar.js:277, panel.js — mọi nút của UI',
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', (e) => seen.push(e && e.type));
      const ok = root.dispatchEvent(ctx.ev('click'));
      return [seen, ok];
    },
  },
  {
    id: 'event/two-listeners-order', group: 'events', fixture: TRIO,
    why: '-',
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', () => seen.push(1));
      root.addEventListener('click', () => seen.push(2));
      root.dispatchEvent(ctx.ev('click'));
      return seen;
    },
  },
  {
    id: 'event/remove-listener', group: 'events', fixture: TRIO,
    why: 'bridge-client.js:73 win.removeEventListener — gỡ không được là rò listener mỗi lượt',
    body: (root, ctx) => {
      const seen = [];
      const fn = () => seen.push('x');
      root.addEventListener('click', fn);
      root.removeEventListener('click', fn);
      root.dispatchEvent(ctx.ev('click'));
      return [typeof root.removeEventListener, seen.length];
    },
  },
  {
    id: 'event/bubbles', group: 'events', fixture: TRIO,
    why: 'src gắn listener thẳng lên từng nút; nếu ai chuyển sang uỷ quyền cho container thì cây '
      + 'giả cho "xanh" mà trang thật không chạy — hoặc ngược lại',
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', () => seen.push('cha'));
      const kid = root.children[0];
      kid.addEventListener('click', () => seen.push('con'));
      kid.dispatchEvent(ctx.ev('click', { bubbles: true }));
      return seen;
    },
  },
  {
    id: 'event/non-bubbling', group: 'events', fixture: TRIO,
    why: '-',
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', () => seen.push('cha'));
      root.children[0].dispatchEvent(ctx.ev('click'));
      return seen;
    },
  },
  {
    id: 'event/once-option', group: 'events', fixture: TRIO,
    why: "src chưa truyền `{ once: true }`; nuốt lặng đối thứ ba thì một listener 'chỉ chạy một "
      + "lần' sẽ chạy mọi lượt trong test và đúng một lượt trên trang thật",
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', () => seen.push('x'), { once: true });
      root.dispatchEvent(ctx.ev('click'));
      root.dispatchEvent(ctx.ev('click'));
      return seen;
    },
  },
  {
    id: 'event/capture-phase', group: 'events', fixture: TRIO,
    why: 'listener capture chạy TỪ NGOÀI VÀO trước khi tới đích; bỏ qua pha là đảo đúng thứ tự '
      + 'hai handler cùng kiểu',
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', () => seen.push('cha-capture'), true);
      root.addEventListener('click', () => seen.push('cha-bubble'));
      const kid = root.children[0];
      kid.addEventListener('click', () => seen.push('con'));
      kid.dispatchEvent(ctx.ev('click'));
      return seen;
    },
  },
  {
    id: 'event/duplicate-listener', group: 'events', fixture: TRIO,
    why: 'DOM thật bỏ qua lần gắn thứ hai của cùng một (handler, pha) — gắn lại trong một vòng vẽ '
      + 'lặp không được làm handler chạy hai lần',
    body: (root, ctx) => {
      const seen = [];
      const fn = () => seen.push('x');
      root.addEventListener('click', fn);
      root.addEventListener('click', fn);
      root.dispatchEvent(ctx.ev('click'));
      return seen;
    },
  },
  {
    id: 'event/stop-propagation', group: 'events', fixture: TRIO,
    why: 'src chưa gọi stopPropagation; nếu gọi mà cây giả không nghe thì handler "chặn" được '
      + 'trong test và chặn hụt trên trang thật',
    body: (root, ctx) => {
      const seen = [];
      root.addEventListener('click', () => seen.push('cha'));
      const kid = root.children[0];
      kid.addEventListener('click', (e) => { e.stopPropagation(); seen.push('con'); });
      kid.dispatchEvent(ctx.ev('click'));
      return seen;
    },
  },
  {
    id: 'event/plain-object', group: 'events', fixture: TRIO,
    why: 'test/helpers/fake-dom.js evt() trả {type}; DOM thật từ chối mọi thứ không phải Event',
    body: (root) => root.dispatchEvent({ type: 'click' }),
  },
  {
    id: 'event/click-method', group: 'events', fixture: PAGE,
    why: 'panel.js:471 link.click() để tải file; transcript.js:36 nói rõ el.click() một mình không đủ',
    body: (root, ctx) => {
      const seen = [];
      const btn = ctx.make({ t: 'button', a: { type: 'button' } });
      root.append(btn);
      btn.addEventListener('click', (e) => seen.push(e && e.type));
      root.addEventListener('click', () => seen.push('nổi lên cha'));
      btn.click();
      return seen;
    },
  },
  {
    id: 'event/click-disabled', group: 'events', fixture: PAGE,
    why: 'picker.js:233 và playlist-bar.js:234/235 tắt nút bằng .disabled — trên trang thật một '
      + 'nút đã tắt KHÔNG phát click nữa, và đó là toàn bộ tác dụng của việc tắt nó',
    body: (root) => {
      const seen = [];
      const btn = root.querySelector('button');
      btn.addEventListener('click', (e) => seen.push(e && e.type));
      btn.click();
      return [btn.getAttribute('disabled'), seen];
    },
  },
  {
    id: 'event/press-sequence', group: 'events', fixture: PAGE,
    why: 'transcript.js:285 và automation.js:224 phát PRESS_SEQUENCE lên nút thật',
    body: (root, ctx) => {
      const seen = [];
      const btn = ctx.make({ t: 'button', a: { type: 'button' } });
      root.append(btn);
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        btn.addEventListener(type, (e) => seen.push(e && e.type));
      }
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        btn.dispatchEvent(ctx.ev(type, { bubbles: true }));
      }
      return seen;
    },
  },

  // ---------------------------------------------------------------- ô nhập
  {
    id: 'input/value-accessor', group: 'input', fixture: { t: 'textarea' },
    why: 'automation.js:185-193 valueAccessor đi ngược chuỗi prototype tìm setter của `value` — '
      + 'đây là đường DUY NHẤT Angular của NotebookLM phản ứng',
    body: (root) => {
      let proto = Object.getPrototypeOf(root);
      let found = null;
      while (proto && !found) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') found = desc;
        proto = Object.getPrototypeOf(proto);
      }
      return [found === null ? 'không có' : 'có setter trên prototype', 'value' in root];
    },
  },
  {
    id: 'input/native-set', group: 'input', fixture: { t: 'input', a: { type: 'search' } },
    why: 'automation.js:211-214 gán qua setter rồi đọc lại; đọc không ra là ném',
    body: (root) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(root), 'value');
      desc.set.call(root, 'xin chào');
      return [desc.get.call(root), root.value];
    },
  },
  {
    id: 'input/not-an-input', group: 'input', fixture: TRIO,
    why: "automation.js:208 ném khi node không phải ô nhập — `'value' in node` là điều kiện",
    body: (root) => ['value' in root, root.value],
  },
  {
    id: 'input/created-element', group: 'input', fixture: TRIO,
    why: 'picker.js:104 filter.value đọc ô lọc; test tiêm createElement riêng nên đường này chỉ '
      + 'đúng nếu doc.createElement("input") ra một node CÓ value',
    body: (root, ctx) => {
      const box = ctx.doc.createElement('input');
      return ['value' in box, box.value, typeof box.value];
    },
  },

  // ---------------------------------------------------------------- linh tinh
  {
    id: 'misc/getBoundingClientRect', group: 'misc', fixture: PAGE,
    why: 'sidebar.js:178 narrowness — nhánh mặc định (không tiêm options.metrics) của điểm '
      + 'WEIGHT.column; thiếu ở cây giả nên nhánh ấy chưa test nào đi qua',
    body: (root) => {
      if (typeof root.getBoundingClientRect !== 'function') return 'không có getBoundingClientRect';
      const rect = root.getBoundingClientRect();
      return [typeof rect.width, Number(rect.width), Number(rect.height)];
    },
  },
  {
    id: 'misc/contains', group: 'misc', fixture: PAGE,
    accepted: 'sidebar.js:222 within() tự đi ngược parentElement; cùng lý do với attr/has — '
      + 'phương thức vắng mặt là hỏng ồn ào',
    why: 'sidebar.js:222 within() tự đi ngược parentElement thay vì gọi contains',
    body: (root) => [typeof root.contains, typeof root.compareDocumentPosition],
  },
  {
    id: 'misc/parent-of-root', group: 'misc', fixture: PAGE,
    why: 'sidebar.js:213/234/341 và extract.js:91 đều dừng vòng lặp bằng parentElement rỗng',
    body: (root) => [root.parentElement, root.parentNode],
  },
  {
    id: 'misc/created-element-surface', group: 'misc', fixture: TRIO,
    why: 'picker.js/panel.js/playlist-bar.js dựng toàn bộ UI bằng doc.createElement',
    body: (root, ctx) => {
      const node = ctx.doc.createElement('div');
      return [node.tagName, node.parentElement, node.children.length, node.getAttribute('id'), typeof node.attachShadow];
    },
  },
  {
    id: 'misc/first-last-child', group: 'misc', fixture: PAGE,
    why: 'src chưa dùng, nhưng đây là PROPERTY: vắng mặt thì trả undefined chứ không ném, nên một '
      + 'vòng `for (let n = node.firstChild; n; n = n.nextSibling)` sẽ im lặng chạy 0 vòng',
    body: (root) => [root.firstChild, root.lastChild, root.firstElementChild, root.lastElementChild,
      root.firstElementChild.nextElementSibling, root.firstElementChild.previousElementSibling,
      root.firstChild.nextSibling, root.lastChild.previousSibling],
  },
];

/**
 * `same` · `diff` · `both-threw`. Tách `both-threw` ra vì tên lỗi thì gần như luôn khác nhau
 * (`SyntaxError` của trình duyệt so với `Error` của cây giả) mà hậu quả thì giống: gọi là hỏng.
 * Gộp chúng vào `diff` là làm loãng đúng thứ ticket này đi tìm.
 */
export function compare(fakeResult, realResult) {
  if (fakeResult === realResult) return 'same';
  const threw = (s) => typeof s === 'string' && s.startsWith('throw:');
  if (threw(fakeResult) && threw(realResult)) return 'both-threw';
  return 'diff';
}

/** Chạy một phép thử trên cây giả. Lỗi thành `throw:<Tên>` để so được với bên kia. */
export function runFake(probe) {
  const doc = fakeDocument();
  const ctx = {
    doc,
    make: (spec) => buildFake(spec),
    ev: (type, init) => new Event(type, { bubbles: true, cancelable: true, composed: true, ...init }),
    describe,
  };
  try {
    return describe(probe.body(buildFake(probe.fixture), ctx));
  } catch (error) {
    return `throw:${error && error.name ? error.name : 'Error'}`;
  }
}

/** Nguồn gửi sang trình duyệt — một chuỗi, dựng từ chính các hàm ở trên. */
export function browserScript() {
  const probes = PROBES.map((p) => ({ id: p.id, fixture: p.fixture, src: p.body.toString() }));
  return `(() => {
  const describe = ${describe.toString()};
  const buildReal = ${buildReal.toString()};
  const probes = ${JSON.stringify(probes)};
  // Chú ý: đoạn này nằm TRONG một template literal, nên không được có dấu huyền ở đây.
  // "about:blank" chạy ở quirks mode, và quirks mode khớp selector class không phân biệt hoa
  // thường — đủ để [class*="Sidebar"] và .Copy cho kết quả khác. Nếu lượt điều hướng sang tài
  // liệu chuẩn chưa kịp xong thì mọi kết luận về selector đều sai, nên hỏng ồn ào ở đây.
  if (document.compatMode !== 'CSS1Compat') {
    throw new Error('audit-fake-dom: tài liệu đang ở quirks mode (' + document.compatMode + ')');
  }
  const out = [];
  for (const probe of probes) {
    let result;
    try {
      const body = new Function("'use strict'; return (" + probe.src + ')')();
      const ctx = {
        doc: document,
        make: (spec) => buildReal(spec, document),
        ev: (type, init) => new Event(type, { bubbles: true, cancelable: true, composed: true, ...init }),
        describe,
      };
      result = describe(body(buildReal(probe.fixture, document), ctx));
    } catch (error) {
      result = 'throw:' + (error && error.name ? error.name : 'Error');
    }
    out.push({ id: probe.id, result });
  }
  return JSON.stringify(out);
})()`;
}
