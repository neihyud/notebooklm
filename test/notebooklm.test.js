// Đẩy Nguồn văn bản vào NotebookLM (ticket 004) — Seam 3 của spec 0001: module DOM nhận một
// cây node, trả dữ liệu.
//
// Hai điều cây node giả phải trung thực, nếu không nó *giấu* lỗi thay vì lộ ra:
//   1. `querySelectorAll` trả NodeList chứ không phải Array (đã suýt lọt ở ticket 002).
//   2. `value` của ô nhập là accessor **trên prototype** — đúng chỗ mà native value setter
//      phải tìm tới. Nếu nó chỉ là field trên instance thì `el.value = x` cũng "chạy", và
//      đường duy nhất Angular phản ứng không bao giờ được kiểm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/common/shared.js';
import '../src/notebooklm/selectors.js';
import '../src/notebooklm/automation.js';
import { el, input, evt } from './helpers/fake-dom.js';

const N = globalThis.NBLM_NB_SELECTORS;
const A = globalThis.NBLM_AUTOMATION;

/** Cây giả không lan truyền event, nên mọi lần chạy đều tiêm bộ tạo event. */
const OPTS = { createEvent: evt };
const with_ = (extra) => ({ ...OPTS, ...extra });

const texts = (node, css) => [...node.querySelectorAll(css)].map((n) => n.textContent);

// ------------------------------------------------------------------ selectors

test('resolve — nhãn mặc định đã ở dạng khớp: chữ thường, bỏ dấu', () => {
  const labels = N.DEFAULT.label('addSource');
  assert.ok(labels.length > 0);
  for (const label of labels) assert.equal(label, label.toLowerCase());
  assert.ok(labels.includes('them nguon'), `nhãn tiếng Việt phải được bỏ dấu sẵn: ${labels.join(', ')}`);
});

test('resolve — "add source" đứng trước "add" trong mảng nhãn, vì thứ tự ấy là thứ tự ưu tiên', () => {
  const labels = N.DEFAULT.label('addSource');
  assert.ok(labels.includes('add'), 'nhãn ngắn "add" vẫn phải có mặt — đó là nhãn thật của giao diện');
  assert.ok(
    labels.indexOf('add source') < labels.indexOf('add'),
    `nhãn cụ thể phải đứng trước nhãn chung: ${labels.join(', ')}`,
  );
});

test('resolve — ghi đè của người dùng gộp thêm vào mặc định và đứng trước', () => {
  const sel = N.resolve({ labels: { addSource: ['Thêm nguồn mới'] } });
  const labels = sel.label('addSource');
  assert.equal(labels[0], 'them nguon moi');
  for (const kept of N.DEFAULT.label('addSource')) {
    assert.ok(labels.includes(kept), `ghi đè không được vứt nhãn mặc định "${kept}"`);
  }
});

test('resolve — chuỗi CSS giữ nguyên chữ hoa và dấu ngoặc, không bị hạ chữ thường như nhãn', () => {
  assert.ok(N.DEFAULT.css('dialog').includes('[role="dialog"]'));
  assert.equal(N.DEFAULT.css('dialog'), N.DEFAULT.css('dialog').replace(/\s+/g, ' '));
});

test('resolve — ghi đè selector CSS cũng gộp thêm, đứng trước', () => {
  const sel = N.resolve({ dialog: ['#hop-thoai-moi'] });
  assert.ok(sel.css('dialog').startsWith('#hop-thoai-moi'));
  assert.ok(sel.css('dialog').includes('[role="dialog"]'));
});

test('resolve — hỏi nhóm selector không tồn tại là lỗi, không phải chuỗi rỗng', () => {
  assert.throws(() => N.DEFAULT.css('khong-co-nhom-nay'), /khong-co-nhom-nay/);
});

// -------------------------------------------------- khớp theo chữ hiển thị

test('findByLabel — "add source" thắng "add" khi nút "Add" đứng TRƯỚC trong DOM', () => {
  const add = el('button', {}, ['Add']);
  const addSource = el('button', {}, ['Add source']);
  const root = el('div', {}, [add, addSource]);
  assert.equal(A.findByLabel(root, 'addSource', OPTS), addSource);
});

test('findByLabel — "add source" vẫn thắng "add" khi nút "Add" đứng SAU trong DOM', () => {
  const addSource = el('button', {}, ['Add source']);
  const add = el('button', {}, ['Add']);
  const root = el('div', {}, [addSource, add]);
  assert.equal(A.findByLabel(root, 'addSource', OPTS), addSource);
});

test('findByLabel — nhãn dưới 4 ký tự chỉ khớp chính xác, không khớp mờ', () => {
  const root = el('div', {}, [el('button', {}, ['Add-ons']), el('button', {}, ['Adding…'])]);
  assert.equal(
    A.findByLabel(root, 'addSource', OPTS),
    null,
    '"add" mà khớp mờ thì mọi nút bắt đầu bằng "Add" đều trúng',
  );
  const exact = el('button', {}, ['Add']);
  assert.equal(A.findByLabel(el('div', {}, [exact]), 'addSource', OPTS), exact);
});

test('findByLabel — khớp nhãn tiếng Việt có dấu qua dạng bỏ dấu', () => {
  const button = el('button', {}, ['Thêm nguồn']);
  assert.equal(A.findByLabel(el('div', {}, [button]), 'addSource', OPTS), button);
});

test('findByLabel — chữ chỉ nằm ở aria-label cũng khớp', () => {
  const button = el('button', { 'aria-label': 'Add source' }, [el('span', { class: 'icon' }, [])]);
  assert.equal(A.findByLabel(el('div', {}, [button]), 'addSource', OPTS), button);
});

test('findByLabel — loại giao diện của chính extension trước khi quét', () => {
  const mine = el('button', { id: 'nblm-add-source' }, ['Add source']);
  const theirs = el('button', {}, ['Add source']);
  const root = el('div', {}, [mine, theirs]);
  assert.equal(A.findByLabel(root, 'addSource', OPTS), theirs);
});

test('findByLabel — nhắm phần tử bấm được trong cùng, không nhắm wrapper', () => {
  const real = el('button', {}, ['Add source']);
  const wrapper = el('div', { role: 'button' }, [real]);
  const root = el('div', {}, [wrapper]);
  assert.equal(A.findByLabel(root, 'addSource', OPTS), real);
});

test('findByLabel — nhãn ghi đè từ Cài đặt tìm được nút mà mặc định chịu thua', () => {
  const button = el('button', {}, ['Nạp tư liệu']);
  const root = el('div', {}, [button]);
  assert.equal(A.findByLabel(root, 'addSource', OPTS), null);
  const sel = N.resolve({ labels: { addSource: ['nap tu lieu'] } });
  assert.equal(A.findByLabel(root, 'addSource', with_({ selectors: sel })), button);
});

// ------------------------------------------------------- nhận diện lỗi

test('readError — bộ đếm "Source limit 3/50" là dòng bình thường, không phải lỗi', () => {
  const dialog = el('mat-dialog-container', { role: 'dialog' }, [
    el('div', { class: 'source-count' }, ['Source limit 3/50']),
    el('p', {}, ['Dán văn bản đã sao chép vào đây']),
  ]);
  assert.equal(A.readError(dialog, OPTS), null);
});

test('readError — chỉ phần tử chuyên báo lỗi mới được đọc', () => {
  const dialog = el('mat-dialog-container', { role: 'dialog' }, [
    el('div', { class: 'source-count' }, ['Source limit 50/50']),
    el('mat-error', {}, ['Đã đạt giới hạn nguồn của notebook này']),
  ]);
  assert.match(A.readError(dialog, OPTS), /giới hạn nguồn/);
});

test('readError — phần tử báo lỗi rỗng không phải là lỗi', () => {
  const dialog = el('mat-dialog-container', {}, [el('mat-error', {}, ['   '])]);
  assert.equal(A.readError(dialog, OPTS), null);
});

test('readSnackbarError — snackbar báo trạng thái bình thường không bị coi là lỗi', () => {
  const root = el('body', {}, [
    el('mat-snack-bar-container', { role: 'status' }, ['Đã thêm nguồn']),
  ]);
  assert.equal(A.readSnackbarError(root, OPTS), null);
});

test('readSnackbarError — snackbar assertive là lỗi hiện muộn, phải đọc ra', () => {
  const root = el('body', {}, [
    el('mat-snack-bar-container', { role: 'alert' }, ['Không lưu được nguồn']),
  ]);
  assert.match(A.readSnackbarError(root, OPTS), /Không lưu được nguồn/);
});

// ---------------------------------------------------- gán giá trị ô nhập

test('setNativeValue — đi qua setter trên prototype, không gán vào property của instance', () => {
  const box = input('textarea');
  // Angular/React đặt một property *của riêng instance* chồng lên `value`. Gán thẳng
  // `el.value = x` sẽ trúng cái property đó và không bao giờ tới value accessor của framework.
  Object.defineProperty(box, 'value', { value: '', writable: true, configurable: true });

  A.setNativeValue(box, 'xin chào', OPTS);

  const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value');
  assert.equal(native.get.call(box), 'xin chào', 'giá trị phải đi qua setter thật của ô nhập');
});

test('setNativeValue — gán trước, phát event sau, đúng thứ tự input rồi change', () => {
  const box = input('textarea');
  A.setNativeValue(box, 'nội dung', OPTS);
  assert.deepEqual(box.events, ['value=nội dung', 'input', 'change']);
});

test('setNativeValue — gán xong mà ô nhập không nhận giá trị thì báo lỗi, không im lặng', () => {
  const notAnInput = el('div', {});
  assert.throws(() => A.setNativeValue(notAnInput, 'x', OPTS), /không nhận được giá trị/);
});

// ------------------------------------------------------------- cú bấm thật

test('pressElement — phát đủ chuỗi sự kiện, đúng thứ tự (một mình click là không đủ)', () => {
  const button = el('button', {}, ['Insert']);
  A.pressElement(button, OPTS);
  assert.deepEqual(button.events, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
});

// ----------------------------------------------------- một NotebookLM giả

/**
 * NotebookLM giả tối giản: nó **phản ứng lại** các cú bấm đúng như trang thật — hộp thoại chỉ
 * hiện sau khi bấm "Add source", ô nhập chỉ hiện sau khi chọn chip "Copied text", và nút
 * "Insert" còn mờ tới khi ô nội dung phát `input`. Cú bấm vào nút mờ bị bỏ qua, y như
 * Angular Material: một hiện thực bấm ngay không chờ sẽ treo ở đây chứ không xanh.
 *
 * Trạng thái chỉ tiến khi trang "được thở" — tức mỗi lần code gọi `page.wait()`.
 */
function fakeNotebookLM(config = {}) {
  const cfg = { withTitle: true, submit: 'ok', late: null, formDelay: 0, ...config };
  const addButton = el('button', {}, ['Add source']);
  const body = el('body', {}, [
    el('div', { class: 'topbar' }, [el('button', {}, ['Add note'])]),
    addButton,
  ]);
  const nodes = { body, addButton, ignoredPresses: 0 };
  let seenSubmitClicks = 0;
  let chipTicks = 0;

  const clicked = (node) => !!node && node.events.includes('click');

  function openDialog() {
    nodes.chip = el('button', {}, ['Copied text']);
    nodes.dialog = el('mat-dialog-container', { role: 'dialog' }, [
      el('h2', {}, ['Add source']),
      // Dòng bình thường của giao diện, không phải lỗi.
      el('div', { class: 'source-count' }, ['Source limit 3/50']),
      el('button', {}, ['Website']),
      nodes.chip,
    ]);
    body.append(nodes.dialog);
  }

  function openForm() {
    nodes.body_ = input('textarea', { 'aria-label': 'Paste text here' });
    nodes.submit = el('button', { disabled: '' }, ['Insert']);
    if (cfg.withTitle) {
      nodes.title = input('input', { type: 'text', 'aria-label': 'Source title' });
      nodes.dialog.append(nodes.title);
    }
    nodes.dialog.append(nodes.body_);
    nodes.dialog.append(nodes.submit);
  }

  function finish() {
    if (cfg.submit === 'hang') return;
    if (cfg.submit === 'error') {
      nodes.dialog.append(el('mat-error', {}, ['Không thêm được nguồn']));
      return;
    }
    nodes.dialog.remove();
    nodes.dialog = null;
    if (cfg.late) body.append(el('mat-snack-bar-container', { role: cfg.late.role }, [cfg.late.text]));
  }

  const page = {
    waits: [],
    root: () => body,
    async wait(ms) {
      page.waits.push(ms);
      if (!nodes.dialog && !nodes.submit && clicked(addButton)) return openDialog();
      if (nodes.dialog && !nodes.submit && clicked(nodes.chip)) {
        // Máy chậm hoặc tab nền: Angular dựng ô nhập sau vài nhịp, không phải ngay.
        chipTicks += 1;
        return chipTicks > cfg.formDelay ? openForm() : undefined;
      }
      if (!nodes.submit) return undefined;
      // Nút Insert mở khoá khi ô nội dung phát `input` — không phải khi `.value` được gán.
      if (nodes.body_.events.includes('input')) nodes.submit.removeAttribute('disabled');
      const clicks = nodes.submit.events.filter((e) => e === 'click').length;
      const fresh = clicks - seenSubmitClicks;
      seenSubmitClicks = clicks;
      if (fresh === 0) return undefined;
      if (nodes.submit.getAttribute('disabled') !== null) nodes.ignoredPresses += fresh;
      else finish();
      return undefined;
    },
  };

  return { page, nodes };
}

const SOURCE = { name: 'Rust Book — phần 1', body: '# Rust Book\n\n[00:00] Chào các bạn' };

test('addTextSource — chạy hết một lượt: bấm thêm nguồn, chọn chip, điền, chèn', async () => {
  const app = fakeNotebookLM();
  const result = await A.addTextSource(SOURCE, app.page, OPTS);

  assert.equal(result.ok, true);
  assert.equal(result.name, SOURCE.name);
  assert.deepEqual(app.nodes.addButton.events, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  assert.ok(app.nodes.chip.events.includes('click'), 'phải chọn chip "Copied text"');
  assert.equal(app.nodes.ignoredPresses, 0, 'không được bấm Insert khi nó còn mờ');
  assert.equal(app.nodes.dialog, null, 'hộp thoại phải đóng');
});

test('addTextSource — tên vào ô tiêu đề, thân nguồn vào ô nội dung, không đổi chỗ cho nhau', async () => {
  const app = fakeNotebookLM();
  await A.addTextSource(SOURCE, app.page, OPTS);

  assert.equal(app.nodes.title.value, SOURCE.name);
  assert.equal(app.nodes.body_.value, SOURCE.body);
});

test('addTextSource — ô nội dung được gán qua native setter rồi mới phát event', async () => {
  const app = fakeNotebookLM();
  await A.addTextSource(SOURCE, app.page, OPTS);
  assert.deepEqual(app.nodes.body_.events, [`value=${SOURCE.body}`, 'input', 'change']);
});

test('addTextSource — không có ô tiêu đề thì vẫn đẩy được, thân nguồn vẫn vào đúng ô', async () => {
  const app = fakeNotebookLM({ withTitle: false });
  const result = await A.addTextSource(SOURCE, app.page, OPTS);
  assert.equal(result.ok, true);
  assert.equal(app.nodes.body_.value, SOURCE.body);
});

test('addTextSource — không đặt được tên thì nói ra, không báo về như thể đã đặt', async () => {
  const app = fakeNotebookLM({ withTitle: false });
  const result = await A.addTextSource(SOURCE, app.page, OPTS);
  assert.equal(result.named, false, 'tên NotebookLM tự đặt là vĩnh viễn — không được im lặng');
  assert.match(result.warning, /ô tiêu đề/);
  assert.match(result.warning, new RegExp(SOURCE.name));
});

test('addTextSource — đặt được tên thì không kèm cảnh báo nào', async () => {
  const app = fakeNotebookLM();
  const result = await A.addTextSource(SOURCE, app.page, OPTS);
  assert.equal(result.named, true);
  assert.equal(result.warning, undefined);
});

test('addTextSource — Nguồn không đặt tên thì không chờ ô tiêu đề, cũng không cảnh báo', async () => {
  const app = fakeNotebookLM({ withTitle: false });
  const result = await A.addTextSource({ body: SOURCE.body }, app.page, OPTS);
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

test('addTextSource — bộ đếm "Source limit 3/50" trong hộp thoại KHÔNG huỷ một lần đẩy đang chạy tốt', async () => {
  const app = fakeNotebookLM();
  assert.deepEqual(
    texts(app.page.root(), 'div'),
    ['Add note'],
    'trang chưa mở hộp thoại thì chưa có bộ đếm',
  );
  const result = await A.addTextSource(SOURCE, app.page, OPTS);
  assert.equal(result.ok, true);
});

test('addTextSource — lỗi hiện trong hộp thoại thì ném lỗi kèm đúng câu NotebookLM nói', async () => {
  const app = fakeNotebookLM({ submit: 'error' });
  await assert.rejects(
    () => A.addTextSource(SOURCE, app.page, OPTS),
    /Không thêm được nguồn/,
  );
});

test('addTextSource — hộp thoại đóng rồi mà snackbar báo lỗi muộn thì vẫn là hỏng', async () => {
  const app = fakeNotebookLM({ late: { role: 'alert', text: 'Lưu nguồn thất bại' } });
  await assert.rejects(() => A.addTextSource(SOURCE, app.page, OPTS), /Lưu nguồn thất bại/);
});

test('addTextSource — snackbar báo trạng thái sau khi đóng không làm hỏng một lần đẩy đã xong', async () => {
  const app = fakeNotebookLM({ late: { role: 'status', text: 'Đã thêm nguồn' } });
  const result = await A.addTextSource(SOURCE, app.page, OPTS);
  assert.equal(result.ok, true);
});

test('addTextSource — chờ thêm sau khi hộp thoại đóng, chứ không báo xong ngay', async () => {
  const app = fakeNotebookLM();
  await A.addTextSource(SOURCE, app.page, OPTS);
  assert.equal(
    app.page.waits[app.page.waits.length - 1],
    A.TIMING.settleMs,
    'nhịp chờ cuối cùng phải là nhịp bắt lỗi hiện muộn',
  );
});

test('addTextSource — hộp thoại không đóng thì báo hỏng, không lặng lẽ báo xong', async () => {
  const app = fakeNotebookLM({ submit: 'hang' });
  await assert.rejects(() => A.addTextSource(SOURCE, app.page, OPTS), /không đóng/);
});

test('addTextSource — không thấy nút thêm nguồn thì nói rõ hỏng ở bước nào', async () => {
  const page = { root: () => el('body', {}, []), wait: async () => {} };
  await assert.rejects(() => A.addTextSource(SOURCE, page, OPTS), /nút thêm nguồn/i);
});

test('addTextSource — Nguồn rỗng thì từ chối ngay, không mở hộp thoại', async () => {
  const app = fakeNotebookLM();
  await assert.rejects(() => A.addTextSource({ name: 'x', body: '   ' }, app.page, OPTS), /rỗng/);
  assert.deepEqual(app.nodes.addButton.events, []);
});

test('addTextSource — nhãn ghi đè từ Cài đặt đủ để chạy trên một giao diện đổi hết chữ', async () => {
  const app = fakeNotebookLM();
  app.nodes.addButton.childNodes = [];
  app.nodes.addButton.append('Nạp tư liệu');
  const sel = N.resolve({ labels: { addSource: ['nap tu lieu'] } });
  const result = await A.addTextSource(SOURCE, app.page, with_({ selectors: sel }));
  assert.equal(result.ok, true);
});

// ----------------------------------- ngân sách chờ: ô bắt buộc ≠ ô tuỳ chọn

// Ô nội dung là **bắt buộc** — không thấy nó là hỏng, nên đáng chờ lâu. Ô tiêu đề là **tuỳ
// chọn** — không thấy nó là chuyện bình thường, và cái giá phải trả ở *mọi* nguồn không có
// ô ấy. Hai ngân sách vì thế không được đổi chỗ cho nhau. Ba test dưới đây canh **quan hệ**
// giữa chúng chứ không canh con số: chỉnh nhịp cho nhanh hơn hay chậm hơn vẫn phải xanh.

test('TIMING — ngân sách chờ ô tuỳ chọn nhỏ hơn hẳn ngân sách chờ ô bắt buộc', () => {
  assert.ok(
    A.TIMING.titleTries * 4 <= A.TIMING.formTries,
    `chờ ô tiêu đề (${A.TIMING.titleTries}) phải nhỏ hơn hẳn chờ ô nội dung (${A.TIMING.formTries})`,
  );
});

test('addTextSource — ô nội dung dựng chậm vẫn kịp: đó là ô không có thì hỏng', async () => {
  // Chậm gấp đôi ngân sách của ô *tuỳ chọn*. Ngân sách của ô *bắt buộc* phải nuốt được ngần
  // ấy — không thì hàm ném đúng lỗi "không thấy ô nhập nội dung" và test này đỏ ngay ở đó.
  const app = fakeNotebookLM({ formDelay: A.TIMING.titleTries * 2 });
  const result = await A.addTextSource(SOURCE, app.page, OPTS);
  assert.equal(result.ok, true);
  assert.equal(app.nodes.body_.value, SOURCE.body);
});

test('addTextSource — ô tiêu đề không bao giờ hiện thì không đốt ngân sách của ô nội dung', async () => {
  const withTitle = fakeNotebookLM();
  await A.addTextSource(SOURCE, withTitle.page, OPTS);
  const without = fakeNotebookLM({ withTitle: false });
  await A.addTextSource(SOURCE, without.page, OPTS);

  // Chênh lệch chính là số nhịp đốt vào việc đi tìm một ô không tồn tại — cái giá này trả ở
  // mọi nguồn, nên một playlist 55 nguồn nhân nó lên 55 lần.
  const burnt = without.page.waits.length - withTitle.page.waits.length;
  assert.ok(
    burnt <= A.TIMING.formTries / 4,
    `đốt ${burnt} nhịp cho một ô tuỳ chọn, trong khi ngân sách của ô bắt buộc chỉ là ${A.TIMING.formTries}`,
  );
});

// ------------------------------------------- kỷ luật: selector chỉ ở một chỗ

test('automation.js không chứa selector NotebookLM nào — mọi thứ dễ vỡ nằm ở selectors.js', () => {
  const source = readFileSync(new URL('../src/notebooklm/automation.js', import.meta.url), 'utf8');
  const code = source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    })
    .join('\n');

  // `'input'` và `'change'` là tên **event**, không phải selector — chúng được phép ở đây;
  // một selector `input[type="text"]` lọt ra thì vẫn vướng nhánh thuộc tính bên dưới.
  const SELECTOR_SHAPED = /mat-[\w-]+|mdc-[\w-]+|['"`](?:textarea|button|a)['"`]|\[(?:class|id|role|type|disabled|contenteditable|aria-[\w-]+|data-[\w-]+)[\^*$~|]?=?/g;
  const found = code.match(SELECTOR_SHAPED) || [];
  assert.deepEqual(found, [], `selector lọt ra ngoài selectors.js: ${found.join(', ')}`);
});

test('ô nhập giả có value là accessor trên prototype — nếu không, native setter không kiểm được', () => {
  const box = input('textarea');
  assert.equal(Object.getOwnPropertyDescriptor(box, 'value'), undefined, 'không được là field của instance');
  const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value');
  assert.equal(typeof native.set, 'function');
  assert.equal(typeof native.get, 'function');
});
