// `tools/audit-fake-dom.mjs` là thước đo của thước đo: nó nói cây giả có còn giống DOM thật
// không. Một `describe()` viết hụt sẽ báo "0 lệch" cho hai giá trị khác kiểu nhau, và cả ticket
// 016 thành một tờ giấy chứng nhận rỗng. Nên chính nó phải có test.
//
// Điểm canh nặng nhất ở đây là **ca ticket 009**: `Array` và `HTMLCollection` cùng `length`,
// cùng phần tử, cùng thứ tự — chỉ khác ở bề mặt phương thức. Một phép so chỉ nhìn `.length`
// hay chỉ nhìn nội dung sẽ gọi hai thứ đó là một.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROBES, browserScript, compare, describe, runFake } from '../tools/fake-dom-probes.mjs';
import { el, evt, input } from './helpers/fake-dom.js';

// ------------------------------------------------------------------ describe: kiểu, không chỉ nội dung

test('describe — Array và thứ giống-mảng cùng length, cùng phần tử vẫn phải mô tả khác nhau', () => {
  const array = ['a', 'b'];
  const arrayLike = { 0: 'a', 1: 'b', length: 2, [Symbol.iterator]: () => array[Symbol.iterator]() };

  assert.equal(array.length, arrayLike.length, 'hai vế phải cùng length, nếu không phép thử này vô nghĩa');
  assert.equal([...array].join(), [...arrayLike].join(), 'hai vế phải cùng nội dung');
  assert.notEqual(describe(array), describe(arrayLike), 'đây đúng là ca ticket 009 — không được coi là một');
});

test('describe — HTMLCollection và NodeList cùng length, cùng node vẫn phải mô tả khác nhau', () => {
  const collection = el('div', {}, [el('i')]).children;
  const nodeList = el('div', {}, [el('i')]).querySelectorAll('i');

  assert.equal(collection.length, nodeList.length);
  assert.equal(collection[0].tagName, nodeList[0].tagName);
  assert.notEqual(describe(collection), describe(nodeList),
    'namedItem/forEach là dấu duy nhất phân biệt hai kiểu — bỏ nó ra khỏi describe là mù đúng chỗ');
});

test('describe — hai node cùng thẻ nhưng khác id/class không được mô tả giống nhau', () => {
  assert.notEqual(describe(el('div', { id: 'a' })), describe(el('div', { id: 'b' })));
  assert.notEqual(describe(el('div', { class: 'x' })), describe(el('div', { class: 'y' })));
  assert.equal(describe(el('div', { id: 'a' })), describe(el('div', { id: 'a' })));
});

test('describe — số, chuỗi và boolean cùng "nội dung" vẫn là ba mô tả khác nhau', () => {
  assert.notEqual(describe(1), describe('1'));
  assert.notEqual(describe(true), describe('true'));
  assert.notEqual(describe(null), describe(undefined));
  assert.notEqual(describe(0), describe(false));
});

test('describe — text node và chuỗi cùng chữ là hai thứ khác nhau', () => {
  const text = el('div', {}, ['xin chào']).childNodes[0];
  assert.equal(text.textContent, 'xin chào');
  assert.notEqual(describe(text), describe('xin chào'));
});

// ------------------------------------------------------------------ compare / runFake

test('compare — tách "cả hai cùng ném" khỏi "lệch", vì tên lỗi thì luôn khác mà hậu quả thì giống', () => {
  assert.equal(compare('num(1)', 'num(1)'), 'same');
  assert.equal(compare('num(1)', 'num(2)'), 'diff');
  assert.equal(compare('throw:Error', 'throw:SyntaxError'), 'both-threw');
  assert.equal(compare('throw:Error', 'num(1)'), 'diff', 'một bên ném một bên chạy là lệch thật');
  assert.equal(compare('num(1)', 'throw:Error'), 'diff');
});

test('runFake — phép thử ném thì thành throw:<Tên>, không làm sập cả lượt chạy', () => {
  const result = runFake({ id: 'x', fixture: { t: 'div' }, body: () => { throw new TypeError('nổ'); } });
  assert.equal(result, 'throw:TypeError');
});

test('runFake — mọi phép thử của repo chạy được trên cây giả, không có biến closure lọt vào', () => {
  const broken = PROBES
    .map((probe) => [probe.id, runFake(probe)])
    .filter(([, result]) => result === 'throw:ReferenceError');
  assert.deepEqual(broken, [], 'thân phép thử phải tự chứa — nó được gửi sang trình duyệt bằng nguồn');
});

test('bộ phép thử — id không trùng, và mỗi phép nói được nó canh chỗ nào trong src/', () => {
  const ids = PROBES.map((probe) => probe.id);
  assert.equal(new Set(ids).size, ids.length, `id trùng: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  for (const probe of PROBES) {
    assert.equal(typeof probe.why, 'string', `${probe.id} thiếu 'why'`);
    assert.ok(probe.why.length > 0, `${probe.id} có 'why' rỗng`);
    assert.equal(typeof probe.body, 'function', `${probe.id} thiếu thân`);
  }
});

test('browserScript — mang theo nguồn của MỌI phép thử, không bỏ sót phép nào', () => {
  const script = browserScript();
  for (const probe of PROBES) {
    assert.ok(script.includes(JSON.stringify(probe.id).slice(1, -1)), `${probe.id} không lên tới trình duyệt`);
  }
  assert.ok(script.includes('function describe'), 'describe phải đi cùng, nếu không hai bên đo bằng hai thước');
});

// ------------------------------------------------------------------ cây giả: những chỗ ticket 016 vá

test('children là HTMLCollection SỐNG — bỏ Array.from là trên trang thật xoá sót một nửa', () => {
  const node = el('div', {}, [el('i'), el('b'), el('i')]);
  const kids = node.children;
  assert.equal(kids.length, 3);

  const seen = [];
  for (const child of node.children) { seen.push(child.tagName); child.remove(); }
  assert.deepEqual(seen, ['I', 'I'], 'bộ duyệt phải đọc lại length mỗi bước, y như HTMLCollection thật');
  assert.equal(kids.length, 1, 'tập hợp sống: đọc lại là thấy cây đã đổi');
});

test('children là HTMLCollection, childNodes là NodeList — hai bề mặt loại trừ nhau', () => {
  const node = el('div', {}, ['chữ', el('i', { id: 'x' })]);

  assert.equal(typeof node.children.namedItem, 'function', 'HTMLCollection có namedItem');
  assert.equal(node.children.forEach, undefined, 'HTMLCollection thật KHÔNG có forEach');
  assert.equal(node.children.namedItem('x').tagName, 'I');

  assert.equal(typeof node.childNodes.forEach, 'function', 'NodeList có forEach');
  assert.equal(node.childNodes.namedItem, undefined, 'NodeList thật KHÔNG có namedItem');

  for (const list of [node.children, node.childNodes]) {
    assert.equal(Array.isArray(list), false);
    for (const method of ['filter', 'map', 'every', 'some', 'reduce']) {
      assert.equal(list[method], undefined, `tập hợp của DOM không có .${method}()`);
    }
  }
});

test('con đầu ≠ con cuối, anh trước ≠ anh sau — bốn lối đi khác chiều, không phải bốn tên gọi', () => {
  // Bốn thứ này cùng kiểu và cùng hình dạng trả về, nên hoán vị chúng cho nhau không đổi một
  // shape assertion nào. Chỉ phép so **tương ứng** — đầu phải là đầu, sau phải là sau — mới
  // giết được cú hoán vị ấy, và đó đúng là hạng lỗi ticket 016 đi tìm.
  const node = el('div', {}, [el('i', { id: 'đầu' }), 'giữa', el('b', { id: 'cuối' })]);

  assert.equal(node.firstChild.id, 'đầu');
  assert.equal(node.lastChild.id, 'cuối');
  assert.equal(node.firstElementChild.id, 'đầu');
  assert.equal(node.lastElementChild.id, 'cuối');

  const first = node.firstElementChild;
  assert.equal(first.nextSibling.textContent, 'giữa', 'nextSibling đi qua cả text node');
  assert.equal(first.previousSibling, null, 'con đầu không có ai đứng trước');
  assert.equal(first.nextElementSibling.id, 'cuối', 'nextElementSibling bỏ qua text node');
  assert.equal(first.previousElementSibling, null);
  assert.equal(node.lastElementChild.previousElementSibling.id, 'đầu');
  assert.equal(node.lastElementChild.nextElementSibling, null);
});

test('classList là DOMTokenList — có contains, KHÔNG có includes', () => {
  const node = el('div', { class: 'panel wide' });
  assert.equal(node.classList.contains('panel'), true);
  assert.equal(node.classList.contains('hẹp'), false);
  assert.equal(node.classList.includes, undefined, 'DOMTokenList thật không có includes');
  assert.equal(node.classList.value, 'panel wide');
  assert.deepEqual([...node.classList], ['panel', 'wide']);
});

test('append dời node đang có cha, không nhân đôi nó', () => {
  const from = el('div');
  const to = el('div');
  const kid = el('span');
  from.append(kid);
  to.append(kid);
  assert.equal(from.children.length, 0, 'DOM thật dời node, không để lại bản sao ở cha cũ');
  assert.equal(to.children.length, 1);
  assert.equal(kid.parentElement, to);
});

test('nút form đang disabled thì .click() không phát gì — đó là toàn bộ tác dụng của việc tắt nó', () => {
  const button = el('button');
  const seen = [];
  button.addEventListener('click', () => seen.push('chạy'));

  button.disabled = true;
  assert.equal(button.getAttribute('disabled'), '', 'disabled của thẻ form đổ ngược ra thuộc tính');
  assert.equal(button.matches('[disabled]'), true);
  button.click();
  assert.deepEqual(seen, [], 'nút đã tắt mà handler vẫn chạy là một lượt import không ai cho phép');

  button.disabled = false;
  assert.equal(button.getAttribute('disabled'), null);
  button.click();
  assert.deepEqual(seen, ['chạy']);
});

test('sự kiện lan lên theo cha khi bubbles, và dừng lại khi không', () => {
  const parent = el('div', {}, [el('button')]);
  const child = parent.children[0];
  const seen = [];
  parent.addEventListener('click', () => seen.push('cha'));
  child.addEventListener('click', () => seen.push('con'));

  child.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['con', 'cha'], 'bubbles: true phải tới được cha');

  seen.length = 0;
  child.dispatchEvent(evt('click', { bubbles: false }));
  assert.deepEqual(seen, ['con'], 'bubbles: false thì dừng ở chính node');
});

test('capture đi TỪ NGOÀI VÀO, bubble đi TỪ TRONG RA — hai chiều, không phải hai cái tên', () => {
  // Hai cấp tổ tiên là bắt buộc ở đây: với một cấp, đảo chiều vòng lặp cho ra đúng một kết quả
  // và cú hoán vị sống sót. Đúng hạng lỗi ticket 016 đi tìm — hoán vị hai thứ cùng kiểu.
  const outer = el('div', { id: 'ngoài' }, [el('div', { id: 'giữa' }, [el('button', { id: 'đích' })])]);
  const middle = outer.children[0];
  const target = middle.children[0];
  const seen = [];
  for (const node of [outer, middle]) {
    node.addEventListener('click', () => seen.push(`${node.id}-capture`), true);
    node.addEventListener('click', () => seen.push(`${node.id}-bubble`));
  }
  target.addEventListener('click', () => seen.push('đích'));

  target.dispatchEvent(evt('click'));
  assert.deepEqual(seen,
    ['ngoài-capture', 'giữa-capture', 'đích', 'giữa-bubble', 'ngoài-bubble'],
    'capture từ ngoài vào, rồi tới đích, rồi bubble từ trong ra — năm bước, đúng năm thứ tự này');
});

test('once: true chạy đúng một lần, và chỉ gỡ bản của ĐÚNG pha nó đăng ký', () => {
  // Cùng một `fn` đăng ký ở hai pha thì đếm số lần chạy KHÔNG phân biệt được bản nào bị gỡ —
  // hai lần chạy giống hệt nhau. Thứ phân biệt là **chỗ nó đứng trong chuỗi**: bản capture chạy
  // trước handler của đích, bản bubble chạy sau. Nên phép so ở đây là so thứ tự, không so số.
  const parent = el('div', {}, [el('button')]);
  const target = parent.children[0];
  const seen = [];
  const fn = () => seen.push('cha');
  parent.addEventListener('click', fn, { capture: true });
  parent.addEventListener('click', fn, { capture: false, once: true });
  target.addEventListener('click', () => seen.push('đích'));

  target.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['cha', 'đích', 'cha'], 'hai pha là hai listener, cả hai cùng chạy ở lượt đầu');

  seen.length = 0;
  target.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['cha', 'đích'],
    'once gỡ bản BUBBLE; gỡ nhầm bản capture thì chuỗi thành ["đích", "cha"] mà số lần chạy không đổi');
});

test('gắn lại cùng một (handler, pha) không làm nó chạy hai lần', () => {
  const node = el('div');
  const seen = [];
  const fn = () => seen.push('x');
  node.addEventListener('click', fn);
  node.addEventListener('click', fn);
  node.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['x'], 'một lượt vẽ lại gắn lại handler cũ không được nhân đôi tác dụng của nó');

  node.addEventListener('click', fn, true);
  node.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['x', 'x', 'x'], 'bản capture và bản bubble là hai listener khác nhau');
});

test('removeEventListener gỡ đúng pha được chỉ định, không gỡ bừa bản còn lại', () => {
  // Cùng lý do với test `once` ở trên: gỡ nhầm pha không đổi SỐ listener còn lại, chỉ đổi
  // **chỗ đứng** của bản còn sống trong chuỗi. Đếm thì mù, so thứ tự thì thấy.
  const parent = el('div', {}, [el('button')]);
  const target = parent.children[0];
  const seen = [];
  const fn = () => seen.push('cha');
  parent.addEventListener('click', fn, true);
  parent.addEventListener('click', fn, false);
  target.addEventListener('click', () => seen.push('đích'));

  parent.removeEventListener('click', fn, false);
  target.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['cha', 'đích'], 'gỡ bản bubble thì bản capture phải còn nguyên, và nó chạy TRƯỚC đích');

  seen.length = 0;
  parent.removeEventListener('click', fn, true);
  target.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['đích'], 'gỡ nốt bản capture thì chỉ còn handler của đích');
});

test('stopPropagation() dừng lan thật, không chỉ là một lời gọi không ai nghe', () => {
  const parent = el('div', {}, [el('button')]);
  const child = parent.children[0];
  const seen = [];
  parent.addEventListener('click', () => seen.push('cha'));
  child.addEventListener('click', (e) => { e.stopPropagation(); seen.push('con'); });

  child.dispatchEvent(evt('click'));
  assert.deepEqual(seen, ['con'], 'handler gọi stopPropagation mà cha vẫn chạy là chặn hụt trên trang thật');
});

test('tập hợp của DOM đổi ra chuỗi được — không ném giữa một câu thông báo assert', () => {
  const node = el('div', {}, [el('i')]);
  assert.equal(String(node.children), '[object HTMLCollection]');
  assert.equal(String(node.childNodes), '[object NodeList]');
  assert.equal(String(node.querySelectorAll('i')), '[object NodeList]');
  assert.notEqual(String(node.children), String(node.childNodes), 'hai kiểu, hai tên');
});

test('cây shadow: không lan ra ngoài khi sự kiện không composed, và không lọt vào childNodes của host', () => {
  const host = el('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const panel = el('p');
  shadow.append(panel);

  assert.equal(host.childNodes.length, 0, 'cây shadow là cây riêng');
  assert.equal(host.querySelectorAll('p').length, 0, 'lượt quét của trang không đi vào cây shadow');
  assert.equal(panel.parentElement, null, 'ShadowRoot không phải Element, nên parentElement là null');
  assert.equal(panel.parentNode, shadow);
  assert.equal(shadow.matches, undefined, 'ShadowRoot thật không có matches');
  assert.equal(shadow.tagName, undefined, 'ShadowRoot thật không có tagName');

  const seen = [];
  host.addEventListener('click', () => seen.push('host'));
  panel.dispatchEvent(evt('click', { composed: false }));
  assert.deepEqual(seen, [], 'không composed thì dừng ở gốc shadow');
  panel.dispatchEvent(evt('click', { composed: true }));
  assert.deepEqual(seen, ['host'], 'composed thì vượt ranh giới, y như MouseEvent của trang thật');
});

test('attachShadow lần hai là ném, không phải lặng lẽ trả gốc cũ', () => {
  const host = el('div');
  host.attachShadow({ mode: 'open' });
  assert.throws(() => host.attachShadow({ mode: 'open' }), /NotSupportedError|đã có gốc shadow/);
});

test("attachShadow mode 'closed' thì host.shadowRoot là null — người ngoài không với vào được", () => {
  const host = el('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  assert.equal(host.shadowRoot, null);
  assert.equal(typeof shadow.append, 'function', 'gốc vẫn dựng được, chỉ là không lộ ra ngoài');
});

test('dispatchEvent chỉ nhận Event thật — {type} là thứ chỉ sống được trong test', () => {
  const node = el('div');
  assert.throws(() => node.dispatchEvent({ type: 'click' }), TypeError);
  assert.equal(node.dispatchEvent(evt('click')), true);
  assert.deepEqual(node.events, ['click'], 'sổ `events` chỉ ghi node được phát thẳng vào');
});

test('getBoundingClientRect có mặt và trả về số 0 — đúng như một node chưa gắn vào trang', () => {
  const rect = el('div').getBoundingClientRect();
  assert.equal(typeof rect.width, 'number');
  assert.equal(rect.width, 0);
  assert.equal(rect.height, 0);
});

test('cloneNode của ô nhập mang theo giá trị đang gõ, không chỉ thuộc tính', () => {
  const box = input('input', { type: 'search' });
  box.value = 'abc';
  assert.equal(box.cloneNode(true).value, 'abc');
});

test('tên thuộc tính không phân biệt hoa thường, đúng như tài liệu HTML', () => {
  const node = el('div');
  node.setAttribute('DATA-Line', 'x');
  assert.equal(node.getAttribute('data-line'), 'x');
  assert.equal(node.matches('[data-line]'), true);
});
