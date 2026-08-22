// Cây node giả cho Seam 3 — "module DOM nhận cây node, trả dữ liệu" (spec 0001).
//
// Repo không có dependency nào và cố ý giữ như vậy, nên đây là một cây node tối giản thay cho
// jsdom. Nó chỉ hiện thực đúng phần API mà module sản phẩm được phép dùng:
//
//   querySelector(All) · matches · closest · getAttribute · textContent · cloneNode · remove
//   · addEventListener / removeEventListener · dispatchEvent / click (ghi lại **và** gọi listener
//   đã gắn, có lan truyền) · attachShadow · classList · getBoundingClientRect
//
// Vì sao mỗi ràng buộc dưới đây tồn tại: cây này là **thước đo** của cả 537 test. Một chỗ nó
// lệch DOM thật là một lô test xanh mà tính năng vẫn hỏng trên trang thật — ticket 009 đã mất
// một Bảng chọn theo đúng kiểu ấy, và `tools/audit-fake-dom.mjs` (ticket 016) là thứ đi tìm
// những chỗ còn lại. Chạy lại nó sau mỗi lần sửa file này:
//
//   node tools/audit-fake-dom.mjs
//
// Bảy ràng buộc mà cây giả phải trung thực, nếu không nó *giấu* lỗi thay vì lộ ra:
//
//   1. `querySelectorAll` duyệt **tiền thứ tự** đúng như DOM thật — bẫy "wrapper luôn đứng
//      trước `<button>` thật" chỉ tồn tại nhờ thứ tự đó.
//   2. `querySelectorAll` trả về **NodeList tĩnh**, `children` trả về **HTMLCollection sống**,
//      `childNodes` trả về **NodeList sống**, `classList` trả về **DOMTokenList** — không cái
//      nào là Array. Trả về Array cho tiện là cách chắc chắn nhất để một `TypeError` chỉ nổ ra
//      trên trang thật (chính là ticket 009).
//   3. **Sống** không phải chi tiết vụn: `for (const con of node.children) con.remove()` trên
//      trang thật chỉ xoá được một nửa vì bộ duyệt đọc lại `length` sau mỗi bước. `Array.from`
//      rải khắp `src/` là để chống đúng chuyện đó, nên cây giả phải phạt được ai bỏ nó đi.
//   4. Cây shadow **không** nằm trong `childNodes` của host, và `ShadowRoot` **không phải một
//      Element**: nó không có `matches`/`closest`/`getAttribute`/`tagName`, còn con trực tiếp
//      của nó có `parentElement === null`. Đó là hai tính chất Bảng chọn (ticket 009) dựa vào.
//   5. Sự kiện **lan truyền** theo `parentNode` khi `bubbles`, và chỉ vượt ranh giới shadow khi
//      `composed` — đúng bộ cờ mà `defaultEvent` của `src/notebooklm/automation.js` đặt ra.
//   6. `dispatchEvent` chỉ nhận `Event` thật. DOM thật ném `TypeError` với mọi thứ khác, và một
//      cây giả dễ tính ở đây là chỗ để `{type: 'click'}` sống sót tới tận trang thật.
//   7. Nút form đang `disabled` **không** phát click khi gọi `.click()` — đó là toàn bộ tác dụng
//      của việc tắt một cái nút, và `picker.js`/`playlist-bar.js` tắt nút thật.

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
    if (className && !node.classList.contains(className)) return false;
    if (id && node.getAttribute('id') !== id) return false;
    if (attr && !attrMatches(node.getAttribute(attr), op, expected)) return false;
  }
  // Tổ hợp chưa đọc được — `ul > li`, `li:not(.x)`, `a + b`. **Cố ý ném thay vì bỏ qua**: ném
  // là hỏng ồn ào ngay ở test đầu tiên, còn bỏ qua là một selector luôn khớp rỗng và một tính
  // năng chết im lặng đúng kiểu ticket 009.
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

const INDEX_RE = /^\d+$/;

/**
 * Tập hợp **sống** theo đúng nghĩa của DOM: mỗi lượt đọc `length` hay chỉ số đều hỏi lại cây.
 *
 * Bộ duyệt cũng phải đọc lại `length` sau từng bước — đó chính là chỗ `for…of` + `remove()` bỏ
 * sót một nửa số con trên trang thật, và là lý do `Array.from` có mặt ở `src/docs/picker.js`,
 * `src/youtube/panel.js`, `src/youtube/playlist-bar.js`. Một bộ duyệt chụp ảnh sẵn danh sách sẽ
 * cho `for…of` trần "xanh" ở đây rồi hỏng ngoài kia.
 *
 * `methods` là bề mặt phân biệt hai kiểu: `HTMLCollection` có `namedItem` mà **không** có
 * `forEach`; `NodeList` thì ngược lại.
 */
function liveList(read, methods, tag) {
  const api = {
    item(index) {
      const node = read()[Number(index)];
      return node === undefined ? null : node;
    },
    namedItem(name) {
      const key = String(name);
      const hit = read().find((n) => n.getAttribute('id') === key || n.getAttribute('name') === key);
      return hit === undefined ? null : hit;
    },
    forEach(fn, thisArg) {
      read().forEach((node, i) => fn.call(thisArg, node, i, view));
    },
    entries: () => read().entries(),
    keys: () => read().keys(),
    values: () => read().values(),
  };

  function* iterate() {
    for (let i = 0; i < read().length; i += 1) yield read()[i];
  }

  const view = new Proxy(Object.create(null), {
    get(_target, key) {
      if (key === 'length') return read().length;
      if (key === Symbol.iterator) return iterate;
      // Không có hai thứ này thì `String(list)` ném "Cannot convert object to primitive value"
      // ngay giữa một câu thông báo assert — lỗi thật bị thay bằng một lỗi khác.
      if (key === Symbol.toStringTag) return tag;
      if (key === 'toString') return () => `[object ${tag}]`;
      if (typeof key === 'string' && INDEX_RE.test(key)) return read()[Number(key)];
      return methods.includes(key) ? api[key] : undefined;
    },
    has(_target, key) {
      if (key === 'length' || key === Symbol.iterator) return true;
      if (key === Symbol.toStringTag || key === 'toString') return true;
      if (typeof key === 'string' && INDEX_RE.test(key)) return Number(key) < read().length;
      return methods.includes(key);
    },
    ownKeys: () => read().map((_node, i) => String(i)).concat('length'),
    getOwnPropertyDescriptor(_target, key) {
      if (key === 'length') return { value: read().length, writable: false, enumerable: false, configurable: true };
      if (typeof key === 'string' && INDEX_RE.test(key) && Number(key) < read().length) {
        return { value: read()[Number(key)], writable: false, enumerable: true, configurable: true };
      }
      return undefined;
    },
    /** Tập hợp của DOM là chỉ-đọc: `node.childNodes = []` phải hỏng, không phải im lặng nhận. */
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  return view;
}

const NODE_LIST_API = ['item', 'forEach', 'entries', 'keys', 'values'];
const HTML_COLLECTION_API = ['item', 'namedItem'];

/** `NodeList` tĩnh của `querySelectorAll` — chụp một lần, không đổi theo cây. */
function staticNodeList(nodes) {
  const snapshot = nodes.slice();
  return liveList(() => snapshot, NODE_LIST_API, 'NodeList');
}

/**
 * `DOMTokenList` của `classList`: có `contains`/`add`/`remove`/`toggle`/`value`, **không** có
 * `includes`/`filter`/`map`. Hai bề mặt loại trừ nhau, nên một Array ở đây là lời mời viết
 * `classList.includes(...)` — chạy suốt suite rồi `TypeError` trên trang thật.
 */
function tokenList(owner) {
  const read = () => (owner.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  const write = (tokens) => owner.setAttribute('class', tokens.join(' '));
  const api = {
    contains: (token) => read().includes(String(token)),
    add(...tokens) {
      const next = read();
      for (const token of tokens) if (!next.includes(String(token))) next.push(String(token));
      write(next);
    },
    remove(...tokens) {
      write(read().filter((t) => !tokens.map(String).includes(t)));
    },
    toggle(token, force) {
      const has = read().includes(String(token));
      const on = force === undefined ? !has : Boolean(force);
      if (on) api.add(token); else api.remove(token);
      return on;
    },
    replace(oldToken, newToken) {
      const next = read();
      const at = next.indexOf(String(oldToken));
      if (at < 0) return false;
      next[at] = String(newToken);
      write(next);
      return true;
    },
    supports: () => true,
    item(index) {
      const token = read()[Number(index)];
      return token === undefined ? null : token;
    },
    forEach(fn, thisArg) {
      read().forEach((token, i) => fn.call(thisArg, token, i, view));
    },
    entries: () => read().entries(),
    keys: () => read().keys(),
    values: () => read().values(),
    toString: () => owner.getAttribute('class') || '',
  };
  const view = new Proxy(Object.create(null), {
    get(_target, key) {
      if (key === 'length') return read().length;
      if (key === 'value') return owner.getAttribute('class') || '';
      if (key === Symbol.iterator) return () => read()[Symbol.iterator]();
      if (key === Symbol.toPrimitive) return undefined;
      if (typeof key === 'string' && INDEX_RE.test(key)) return read()[Number(key)];
      return Object.prototype.hasOwnProperty.call(api, key) ? api[key] : undefined;
    },
    has(_target, key) {
      if (key === 'length' || key === 'value' || key === Symbol.iterator) return true;
      if (typeof key === 'string' && INDEX_RE.test(key)) return Number(key) < read().length;
      return Object.prototype.hasOwnProperty.call(api, key);
    },
    ownKeys: () => read().map((_token, i) => String(i)).concat('length', 'value'),
    getOwnPropertyDescriptor(_target, key) {
      if (key === 'length') return { value: read().length, writable: false, enumerable: false, configurable: true };
      if (key === 'value') return { value: owner.getAttribute('class') || '', writable: true, enumerable: false, configurable: true };
      if (typeof key === 'string' && INDEX_RE.test(key) && Number(key) < read().length) {
        return { value: read()[Number(key)], writable: false, enumerable: true, configurable: true };
      }
      return undefined;
    },
    set(_target, key, next) {
      if (key !== 'value') return false;
      owner.setAttribute('class', String(next));
      return true;
    },
  });
  return view;
}

/** Anh em kề theo `step`; `onlyElements` bỏ qua text node, đúng như `nextElementSibling`. */
function siblingOf(node, step, onlyElements) {
  const parent = node.parentNode;
  if (!parent) return null;
  const kids = parent.kids;
  for (let i = kids.indexOf(node) + step; i >= 0 && i < kids.length; i += step) {
    if (!onlyElements || kids[i] instanceof FakeElement) return kids[i];
  }
  return null;
}

class FakeText {
  constructor(data) {
    this.data = String(data);
    this.parentNode = null;
  }

  get parentElement() {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get textContent() {
    return this.data;
  }

  get nextSibling() {
    return siblingOf(this, 1, false);
  }

  get previousSibling() {
    return siblingOf(this, -1, false);
  }

  cloneNode() {
    return new FakeText(this.data);
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChildNode(this);
  }
}

/**
 * Phần chung của `Element` và `ShadowRoot` — đúng những gì mixin `ParentNode` của DOM cho cả hai:
 * `children`, `childNodes`, `append`, `querySelector(All)`, `textContent`.
 *
 * Tách ra thành lớp riêng chứ không cho `ShadowRoot` kế thừa `Element` là **có chủ ý**: gốc
 * shadow thật không có `matches`/`closest`/`getAttribute`/`tagName`, và một cây giả hào phóng ở
 * đây là chỗ để code chỉ chạy được trong test lọt qua review.
 */
class FakeParent {
  #kids = [];

  get kids() {
    return this.#kids;
  }

  get childNodes() {
    return liveList(() => this.#kids, NODE_LIST_API, 'NodeList');
  }

  get children() {
    return liveList(() => this.#kids.filter((n) => n instanceof FakeElement), HTML_COLLECTION_API, 'HTMLCollection');
  }

  get textContent() {
    return this.#kids.map((n) => n.textContent).join('');
  }

  /**
   * Con đầu/cuối và anh em kề. Có mặt vì đây là **property**, không phải phương thức: một
   * property vắng mặt trả `undefined` chứ không ném, nên `for (let n = node.firstChild; n;
   * n = n.nextSibling)` sẽ im lặng chạy 0 vòng và cho một test xanh giả. Phương thức vắng mặt
   * (`hasAttribute`, `contains`) thì ngược lại — hỏng ồn ào ngay lượt đầu, nên cứ để vắng.
   */
  get firstChild() {
    return this.#kids.length > 0 ? this.#kids[0] : null;
  }

  get lastChild() {
    return this.#kids.length > 0 ? this.#kids[this.#kids.length - 1] : null;
  }

  get firstElementChild() {
    return this.children.item(0);
  }

  get lastElementChild() {
    const kids = this.children;
    return kids.item(kids.length - 1);
  }

  set textContent(value) {
    for (const child of this.#kids.slice()) child.parentNode = null;
    this.#kids.length = 0;
    const text = value == null ? '' : String(value);
    if (text) this.append(text);
  }

  /** `append(...nodes)` — nhận nhiều đối, nhận chuỗi, **dời** node đang có cha, trả về `undefined`. */
  append(...children) {
    for (const child of children) {
      const node = typeof child === 'string' ? new FakeText(child) : child;
      if (node.parentNode) node.parentNode.removeChildNode(node);
      node.parentNode = this;
      this.#kids.push(node);
    }
  }

  removeChildNode(node) {
    const at = this.#kids.indexOf(node);
    if (at < 0) return;
    this.#kids.splice(at, 1);
    node.parentNode = null;
  }

  /** Duyệt tiền thứ tự — đúng thứ tự tài liệu của `querySelectorAll` thật. */
  *descendants() {
    for (const child of this.#kids) {
      if (!(child instanceof FakeElement)) continue;
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector) {
    const branches = parseSelector(selector);
    const out = [];
    for (const node of this.descendants()) {
      if (branches.some((compounds) => matchBranch(node, compounds))) out.push(node);
    }
    return staticNodeList(out);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector).item(0);
  }

  /**
   * Đối thứ ba **có tác dụng thật**. Nuốt lặng nó là hai lỗi im lặng cùng lúc: `{ once: true }`
   * thành listener chạy mọi lượt, và `capture` thành listener chạy sai pha — cả hai đều "xanh"
   * ở đây rồi cư xử khác trên trang thật.
   */
  addEventListener(type, handler, options) {
    if (typeof handler !== 'function') return;
    const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
    const once = Boolean(options && typeof options === 'object' && options.once);
    const list = this.listeners.get(String(type)) || [];
    if (list.some((entry) => entry.handler === handler && entry.capture === capture)) return;
    list.push({ handler, capture, once });
    this.listeners.set(String(type), list);
  }

  /** Gỡ đúng cặp (handler, pha): DOM thật coi bản capture và bản bubble là hai listener khác nhau. */
  removeEventListener(type, handler, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
    const list = this.listeners.get(String(type));
    if (!list) return;
    const at = list.findIndex((entry) => entry.handler === handler && entry.capture === capture);
    if (at >= 0) list.splice(at, 1);
  }

  /** Gọi listener của **riêng** node này, đúng pha. Lan truyền là việc của `dispatchEvent`. */
  fire(event, phase) {
    const list = this.listeners.get(event.type);
    if (!list) return;
    for (const entry of list.slice()) {
      if (phase === 'capture' && !entry.capture) continue;
      if (phase === 'bubble' && entry.capture) continue;
      if (entry.once) this.removeEventListener(event.type, entry.handler, { capture: entry.capture });
      entry.handler(event);
    }
  }

  /**
   * Ghi lại **rồi** gọi listener, rồi lan lên theo `parentNode`. Chỉ ghi lại thôi thì một nút gắn
   * nhầm handler vẫn "xanh": test đọc `events` thấy đủ chuỗi bấm mà không ai chạy gì cả.
   *
   * `events` cố tình chỉ ghi ở **node được phát thẳng vào**, không ghi dọc đường lan: nó là sổ
   * "ai bị bấm" của cây giả, không phải một API của DOM.
   */
  dispatchEvent(event) {
    if (!(event instanceof Event)) {
      throw new TypeError('fake-dom: dispatchEvent chỉ nhận Event thật — dùng evt(type) của helper này');
    }
    this.events.push(event.type);

    // Đường lan: chính node, rồi từng cha. Ranh giới shadow chỉ vượt qua được khi `composed` —
    // đó chính là tính chất cách ly mà Bảng chọn (ticket 009) dựa vào.
    const path = [this];
    for (let node = this.parentNode; node;) {
      path.push(node);
      node = node instanceof FakeShadowRoot ? (event.composed ? node.host : null) : node.parentNode;
    }

    // Ba pha, đúng thứ tự DOM: bắt từ ngoài vào (capture), tới đích (cả hai loại listener), rồi
    // nổi từ trong ra (bubble). `cancelBubble` là cờ `stopPropagation()` bật lên — bỏ qua nó là
    // để một handler "chặn" được trong test rồi chặn hụt ngoài kia.
    for (let i = path.length - 1; i >= 1 && !event.cancelBubble; i -= 1) path[i].fire(event, 'capture');
    if (!event.cancelBubble) this.fire(event, 'target');
    if (!event.bubbles) return !event.defaultPrevented;
    for (let i = 1; i < path.length && !event.cancelBubble; i += 1) path[i].fire(event, 'bubble');
    return !event.defaultPrevented;
  }
}

/** Gốc shadow: một cây riêng, treo ở `shadowRoot` chứ **không** vào `childNodes` của host. */
export class FakeShadowRoot extends FakeParent {
  constructor(host, mode) {
    super();
    this.host = host;
    this.mode = mode;
    this.nodeType = 11;
    this.parentNode = null;
    this.parentElement = null;
    this.events = [];
    this.listeners = new Map();
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

/** Thẻ form mà DOM thật cho `disabled` đổ ngược ra thuộc tính (và chặn `.click()`). */
const FORM_CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTGROUP', 'OPTION', 'FIELDSET']);

export class FakeElement extends FakeParent {
  constructor(tagName, attributes = {}) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.attributes = new Map();
    for (const [key, value] of Object.entries(attributes)) {
      if (value != null) this.attributes.set(String(key).toLowerCase(), String(value));
    }
    this.parentNode = null;
    /** `mode: 'open'` treo ở đây; `mode: 'closed'` treo ở chỗ khuất, đúng như DOM thật. */
    this.shadowRoot = null;
    this.closedShadowRoot = null;
    /** Mọi sự kiện đã phát **thẳng vào** node này, theo thứ tự — đó là thứ test đọc. */
    this.events = [];
    this.listeners = new Map();
  }

  get parentElement() {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get nextSibling() {
    return siblingOf(this, 1, false);
  }

  get previousSibling() {
    return siblingOf(this, -1, false);
  }

  get nextElementSibling() {
    return siblingOf(this, 1, true);
  }

  get previousElementSibling() {
    return siblingOf(this, -1, true);
  }

  get classList() {
    return tokenList(this);
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  /**
   * `disabled` của thẻ form **đổ ngược ra thuộc tính** ở DOM thật — `[disabled]` của
   * `src/notebooklm/selectors.js` dò đúng thuộc tính ấy. Thẻ khác thì `disabled` chỉ là một
   * property JS thường, y như thật.
   */
  get disabled() {
    if (!FORM_CONTROLS.has(this.tagName)) return this.ownDisabled;
    return this.getAttribute('disabled') !== null;
  }

  set disabled(value) {
    if (!FORM_CONTROLS.has(this.tagName)) { this.ownDisabled = value; return; }
    if (value) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(String(name).toLowerCase());
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChildNode(this);
  }

  matches(selector) {
    return parseSelector(selector).some((compounds) => matchBranch(this, compounds));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Node của cây giả không bao giờ gắn vào một `document` có layout, nên **mọi số đo là 0** —
   * đúng bằng những gì DOM thật trả về cho một node chưa gắn vào trang. Có mặt là bắt buộc:
   * `narrowness` ở `src/docs/sidebar.js` bọc lời gọi này trong `typeof … === 'function'`, nên
   * thiếu nó thì nhánh ấy im lặng rẽ sang đường khác và không test nào đi qua đường thật.
   */
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
  }

  cloneNode(deep) {
    const copy = new this.constructor(this.tagName);
    copy.attributes = new Map(this.attributes);
    if (deep) for (const child of this.kids) copy.append(child.cloneNode(true));
    return copy;
  }

  /**
   * Gốc shadow gắn **một lần**: DOM thật ném `NotSupportedError` ở lượt hai. Trả về gốc cũ cho
   * tiện là biến một lỗi dựng UI hai lần thành một lượt vẽ đè im lặng.
   *
   * `mode: 'closed'` thì `host.shadowRoot` là `null` — người ngoài không với vào được. Đó là lý
   * do `src/docs/picker.js` phải dùng `'open'`, và test khẳng định `host.shadowRoot` tồn tại.
   */
  attachShadow(init) {
    if (this.shadowRoot || this.closedShadowRoot) {
      throw new DOMException('fake-dom: node này đã có gốc shadow', 'NotSupportedError');
    }
    const mode = (init && init.mode) || 'closed';
    const shadow = new FakeShadowRoot(this, mode);
    if (mode === 'open') this.shadowRoot = shadow;
    else this.closedShadowRoot = shadow;
    return shadow;
  }

  /** Một nút form đang tắt **không** phát click — đó là toàn bộ tác dụng của việc tắt nó. */
  click() {
    if (FORM_CONTROLS.has(this.tagName) && this.getAttribute('disabled') !== null) return;
    this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true, composed: true }));
  }
}

/** `el('div', { id: 'x' }, ['chữ', el('button', {}, ['Transcript'])])` */
export function el(tagName, attributes = {}, children = []) {
  const node = new FakeElement(tagName, attributes);
  for (const child of children) node.append(child);
  return node;
}

/**
 * Event giả — nhưng là `Event` **thật** của Node, vì `dispatchEvent` của DOM thật từ chối mọi
 * thứ khác. Cờ mặc định lấy đúng bộ mà `defaultEvent` của `src/notebooklm/automation.js` và
 * `src/youtube/transcript.js` gửi lên trang thật, nên đường lan truyền test đi cũng là đường
 * trang thật đi. Đưa `init` để tắt bớt khi cần: `evt('timeupdate', { bubbles: false })`.
 */
export const evt = (type, init) => new Event(type, { bubbles: true, cancelable: true, composed: true, ...init });

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

  /** DOM thật chép cả `value` đang gõ sang bản sao (dirty value flag), không chỉ thuộc tính. */
  cloneNode(deep) {
    const copy = super.cloneNode(deep);
    copy.#value = this.#value;
    return copy;
  }
}

/** `input('textarea', { id: 'x' })` — ô nhập rỗng, không có con. */
export function input(tagName, attributes = {}) {
  return new FakeInput(tagName, attributes);
}
