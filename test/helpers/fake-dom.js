// Cây node giả cho Seam 3 — "module DOM nhận cây node, trả dữ liệu" (spec 0001).
//
// Repo không có dependency nào và cố ý giữ như vậy, nên đây là một cây node tối giản thay cho
// jsdom. Nó chỉ hiện thực đúng phần API mà module sản phẩm được phép dùng:
//
//   querySelector(All) · matches · closest · getAttribute · textContent · cloneNode · remove
//   · addEventListener · dispatchEvent / click (ghi lại **và** gọi listener đã gắn) · attachShadow
//
// Ba ràng buộc mà cây giả phải trung thực, nếu không nó *giấu* lỗi thay vì lộ ra:
//
//   1. `querySelectorAll` duyệt **tiền thứ tự** đúng như DOM thật — bẫy "wrapper luôn đứng
//      trước `<button>` thật" chỉ tồn tại nhờ thứ tự đó.
//   2. `querySelectorAll` trả về **NodeList** và `children` trả về **HTMLCollection**, không
//      phải Array: có `length`, chỉ số, và duyệt được bằng `for…of`, nhưng **không** có
//      `filter`/`map`/`every`. Trả về Array cho tiện là cách chắc chắn nhất để một `TypeError`
//      chỉ nổ ra trên trang thật.
//   3. Cây shadow **không** nằm trong `childNodes` của host, nên không lượt quét nào của trang
//      đi vào nó và `closest()` từ bên trong dừng lại ở gốc shadow. Đó chính là hai tính chất
//      Bảng chọn (ticket 009) dựa vào; một `attachShadow` giả mà chỉ append thẳng vào host sẽ
//      cho mọi test về cách ly ấy "xanh" mà chẳng kiểm gì.

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
    this.listeners = new Map();
  }

  get classList() {
    return (this.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  }

  /**
   * `HTMLCollection`, không phải Array — cùng lý do với `NodeList` ở trên. `Element.children`
   * thật chỉ có `length`/`item`/chỉ số/duyệt được; trả về Array ở đây là cho `children.filter`
   * đi qua suốt cả suite rồi nổ `TypeError` đúng trên trang thật.
   */
  get children() {
    return new FakeNodeList(this.childNodes.filter((n) => n instanceof FakeElement));
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

  removeAttribute(name) {
    this.attributes.delete(name);
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

  /**
   * Gốc shadow: một cây riêng, treo ở `shadowRoot` chứ **không** vào `childNodes` của host.
   * `parentElement` của nó là `null`, nên `closest()` từ trong ra dừng đúng ở đây — y như thật.
   */
  attachShadow(init) {
    if (this.shadowRoot) return this.shadowRoot;
    const shadow = new FakeElement('#shadow-root');
    shadow.host = this;
    shadow.mode = (init && init.mode) || 'closed';
    this.shadowRoot = shadow;
    return shadow;
  }

  addEventListener(type, handler) {
    if (typeof handler !== 'function') return;
    const list = this.listeners.get(String(type)) || [];
    list.push(handler);
    this.listeners.set(String(type), list);
  }

  /**
   * Ghi lại **rồi** gọi listener. Chỉ ghi lại thôi thì một nút gắn nhầm handler vẫn "xanh":
   * test đọc `events` thấy đủ chuỗi bấm mà không ai chạy gì cả.
   */
  dispatchEvent(event) {
    const type = event && event.type ? String(event.type) : String(event);
    this.events.push(type);
    for (const handler of this.listeners.get(type) || []) handler(event);
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
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

/**
 * Ô nhập. `value` là **accessor trên prototype**, đúng như `HTMLTextAreaElement.prototype` —
 * đó chính là thứ native value setter phải đi tìm. Nếu ở đây `value` chỉ là một field thường
 * trên instance thì gán thẳng `el.value = x` cũng "chạy", và đường native setter — thứ duy
 * nhất Angular phản ứng — không bao giờ được kiểm.
 *
 * Mỗi lần gán qua setter ghi lại vào `events`, để test chốt được thứ tự *gán trước, phát
 * event sau*: gán sau khi phát event thì Angular đọc lại ô nhập vẫn thấy rỗng.
 */
export class FakeInput extends FakeElement {
  #value = '';

  get value() {
    return this.#value;
  }

  set value(next) {
    this.#value = String(next);
    this.events.push(`value=${this.#value}`);
  }
}

/** `input('textarea', { id: 'x' })` — ô nhập rỗng, không có con. */
export function input(tagName, attributes = {}) {
  return new FakeInput(tagName, attributes);
}
