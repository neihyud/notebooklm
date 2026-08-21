// Cây node giả cho Seam 3 — "module DOM nhận cây node, trả dữ liệu" (spec 0001).
//
// Repo không có dependency nào và cố ý giữ như vậy, nên đây là một cây node tối giản thay cho
// jsdom. Nó chỉ hiện thực đúng phần API mà module sản phẩm được phép dùng:
//
//   querySelector(All) · matches · closest · getAttribute · textContent · cloneNode · remove
//   · dispatchEvent / click (ghi lại, không thực sự phát)
//
// Hai ràng buộc mà cây giả phải trung thực, nếu không nó *giấu* lỗi thay vì lộ ra:
//
//   1. `querySelectorAll` duyệt **tiền thứ tự** đúng như DOM thật — bẫy "wrapper luôn đứng
//      trước `<button>` thật" chỉ tồn tại nhờ thứ tự đó.
//   2. `querySelectorAll` trả về **NodeList**, không phải Array: có `length`, `forEach` và
//      duyệt được bằng `for…of`, nhưng **không** có `filter`/`map`/`every`. Trả về Array cho
//      tiện là cách chắc chắn nhất để một `TypeError` chỉ nổ ra trên trang thật.

/** Tách selector thành các nhánh (phân tách bởi `,`), mỗi nhánh là dãy compound (tổ tiên → node). */
function parseSelector(selector) {
  return String(selector)
    .split(',')
    .map((branch) => splitCompounds(branch.trim()))
    .filter((compounds) => compounds.length > 0);
}

/** Cắt theo khoảng trắng nhưng **không** cắt bên trong `[...]` — `[title="a b"]` là một compound. */
function splitCompounds(branch) {
  const out = [];
  let current = '';
  let depth = 0;
  for (const ch of branch) {
    if (ch === '[') depth += 1;
    if (ch === ']') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

const PART_RE = /\*|([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:([~^*$|]?=)"?([^"\]]*)"?)?\]/g;

function attrMatches(value, op, expected) {
  if (op === undefined) return value !== null;
  if (value === null) return false;
  if (op === '=') return value === expected;
  if (op === '^=') return value.startsWith(expected);
  if (op === '$=') return value.endsWith(expected);
  if (op === '*=') return value.includes(expected);
  if (op === '~=') return value.split(/\s+/).includes(expected);
  if (op === '|=') return value === expected || value.startsWith(`${expected}-`);
  throw new Error(`fake-dom: toán tử thuộc tính chưa hỗ trợ: ${op}`);
}

function matchCompound(node, compound) {
  PART_RE.lastIndex = 0;
  let part;
  let seen = false;
  while ((part = PART_RE.exec(compound)) !== null) {
    seen = true;
    const [raw, tag, className, id, attr, op, expected] = part;
    if (raw === '*') continue;
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    if (className && !node.classList.includes(className)) return false;
    if (id && node.getAttribute('id') !== id) return false;
    if (attr && !attrMatches(node.getAttribute(attr), op, expected)) return false;
  }
  if (!seen) throw new Error(`fake-dom: selector không đọc được: ${compound}`);
  return true;
}

/** Khớp một nhánh: compound cuối khớp chính node, các compound trước khớp tổ tiên (bất kỳ mức). */
function matchBranch(node, compounds) {
  if (!matchCompound(node, compounds[compounds.length - 1])) return false;
  let index = compounds.length - 2;
  let ancestor = node.parentElement;
  while (index >= 0) {
    if (!ancestor) return false;
    if (matchCompound(ancestor, compounds[index])) index -= 1;
    ancestor = ancestor.parentElement;
  }
  return true;
}

/**
 * Đúng bề mặt của `NodeList`: duyệt được, có `length`/`item`/`forEach`, và **không** có
 * phương thức của Array. Code sản phẩm muốn `filter` thì phải `Array.from` trước, y như thật.
 */
class FakeNodeList {
  constructor(nodes) {
    this.length = nodes.length;
    for (let i = 0; i < nodes.length; i += 1) this[i] = nodes[i];
    this.#nodes = nodes;
  }

  #nodes;

  item(index) {
    return this.#nodes[index] || null;
  }

  forEach(fn, thisArg) {
    this.#nodes.forEach((node, i) => fn.call(thisArg, node, i, this));
  }

  [Symbol.iterator]() {
    return this.#nodes[Symbol.iterator]();
  }
}

class FakeText {
  constructor(data) {
    this.data = String(data);
    this.parentElement = null;
  }

  get textContent() {
    return this.data;
  }

  cloneNode() {
    return new FakeText(this.data);
  }
}

export class FakeElement {
  constructor(tagName, attributes = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    for (const [key, value] of Object.entries(attributes)) {
      if (value != null) this.attributes.set(key, String(value));
    }
    this.childNodes = [];
    this.parentElement = null;
    /** Mọi sự kiện đã phát vào node này, theo thứ tự — đó là thứ test đọc. */
    this.events = [];
  }

  get classList() {
    return (this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  }

  get children() {
    return this.childNodes.filter((n) => n instanceof FakeElement);
  }

  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  append(child) {
    const node = typeof child === 'string' ? new FakeText(child) : child;
    node.parentElement = this;
    this.childNodes.push(node);
    return node;
  }

  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.childNodes = parent.childNodes.filter((n) => n !== this);
    this.parentElement = null;
  }

  /** Duyệt tiền thứ tự — đúng thứ tự tài liệu của `querySelectorAll` thật. */
  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  matches(selector) {
    return parseSelector(selector).some((compounds) => matchBranch(this, compounds));
  }

  querySelectorAll(selector) {
    const branches = parseSelector(selector);
    const out = [];
    for (const node of this.descendants()) {
      if (branches.some((compounds) => matchBranch(node, compounds))) out.push(node);
    }
    return new FakeNodeList(out);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector).item(0);
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  cloneNode(deep) {
    const copy = new FakeElement(this.tagName);
    copy.attributes = new Map(this.attributes);
    if (deep) for (const child of this.childNodes) copy.append(child.cloneNode(true));
    return copy;
  }

  dispatchEvent(event) {
    this.events.push(event && event.type ? String(event.type) : String(event));
    return true;
  }

  click() {
    this.events.push('click');
  }
}

/** `el('div', { id: 'x' }, ['chữ', el('button', {}, ['Transcript'])])` */
export function el(tagName, attributes = {}, children = []) {
  const node = new FakeElement(tagName, attributes);
  for (const child of children) node.append(child);
  return node;
}

/** Event giả: chỉ cần `.type`, vì cây giả chỉ ghi lại chứ không lan truyền. */
export const evt = (type) => ({ type });
