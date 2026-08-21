// Test toàn vẹn của cấu hình (spec 0001): mọi setting có ô nhập, mọi id mà mã trang tham
// chiếu đều tồn tại, và ghi đè gõ ở trang Cài đặt thật sự tới được bộ selector.
//
// Kiểu test này chỉ có giá trị khi nó từng đỏ: xoá một ô nhập khỏi `options.html`, hoặc đảo
// hai vế trong `overridesFrom`, phải làm một test dưới đây chết — nếu không, nó chỉ đang xác
// nhận rằng file tồn tại.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import '../src/common/shared.js';
import '../src/notebooklm/selectors.js';
import '../options.js';

const S = globalThis.NBLM_SHARED;
const N = globalThis.NBLM_NB_SELECTORS;
const O = globalThis.NBLM_OPTIONS;

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const idsOf = (html) => new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
/** Id do extension tạo, viết thẳng trong mã trang. Chuỗi tiền tố (kết thúc bằng `-`) không tính. */
const referencedIds = (js) => [...js.matchAll(/['"`](nblm-[a-z0-9-]*[a-z0-9])['"`]/gi)].map((m) => m[1]);

const OPTIONS_HTML = read('options.html');
const OPTIONS_JS = read('options.js');
const POPUP_HTML = read('popup.html');
const POPUP_JS = read('popup.js');
const MANIFEST = JSON.parse(read('manifest.json'));

// ------------------------------------------------- mọi setting có ô nhập

test('Cài đặt — mỗi setting trong DEFAULTS có đúng một ô nhập trên trang', () => {
  const ids = idsOf(OPTIONS_HTML);
  assert.ok(O.SETTING_KEYS.length > 0);
  for (const key of O.SETTING_KEYS) {
    assert.ok(ids.has(O.fieldId(key)), `setting "${key}" không có ô nhập #${O.fieldId(key)}`);
  }
  assert.deepEqual(O.SETTING_KEYS, Object.keys(S.DEFAULTS), 'thêm setting mà quên ô nhập là lọt lưới');
});

test('Cài đặt — hai bộ ghi đè đều có ô nhập riêng, nhãn không gõ chung với selector CSS', () => {
  const ids = idsOf(OPTIONS_HTML);
  assert.deepEqual([...O.OVERRIDE_KEYS], ['labelOverrides', 'selectorOverrides']);
  for (const key of O.OVERRIDE_KEYS) assert.ok(ids.has(O.fieldId(key)), `thiếu ô ghi đè #${O.fieldId(key)}`);
});

test('Cài đặt — mọi id mà options.js tham chiếu đều tồn tại trong options.html', () => {
  const ids = idsOf(OPTIONS_HTML);
  const referenced = referencedIds(OPTIONS_JS);
  assert.ok(referenced.length > 0, 'không đọc được id nào — biểu thức quét hỏng, không phải trang sạch');
  for (const id of referenced) assert.ok(ids.has(id), `options.js gọi #${id} nhưng trang không có`);
});

test('popup — mọi id mà popup.js tham chiếu đều tồn tại trong popup.html', () => {
  const ids = idsOf(POPUP_HTML);
  const referenced = referencedIds(POPUP_JS);
  assert.ok(referenced.length > 0);
  for (const id of referenced) assert.ok(ids.has(id), `popup.js gọi #${id} nhưng trang không có`);
});

test('Cài đặt — script nạp đúng chuỗi phụ thuộc và mọi file trỏ tới đều tồn tại', () => {
  const srcs = [...OPTIONS_HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of srcs) {
    assert.ok(existsSync(new URL(`../${src}`, import.meta.url)), `options.html trỏ tới ${src} nhưng file không có`);
  }
  const order = (name) => srcs.indexOf(name);
  assert.ok(order('src/common/shared.js') >= 0, 'options.js đọc NBLM_SHARED, nên shared.js phải được nạp');
  assert.ok(
    order('src/common/shared.js') < order('src/notebooklm/selectors.js'),
    'selectors.js đọc NBLM_SHARED lúc nạp — nạp sau là ném lỗi ngay',
  );
  assert.ok(order('src/notebooklm/selectors.js') < order('options.js'), 'options.js dựng gợi ý từ bộ mặc định');
});

test('manifest — trang Cài đặt được đăng ký và file tồn tại', () => {
  const page = MANIFEST.options_ui && MANIFEST.options_ui.page;
  assert.equal(page, 'options.html');
  assert.ok(existsSync(new URL(`../${page}`, import.meta.url)));
});

test('manifest — khai quyền storage, vì không có nó thì trang Cài đặt lưu gì cũng trượt', () => {
  // `chrome.storage` là `undefined` khi quyền không được khai: `save()` ném lỗi và `load()`
  // lặng lẽ trả về mặc định. Trang vẫn dựng ra bình thường, nên chỉ manifest mới canh được.
  assert.ok(OPTIONS_JS.includes('chrome.storage'), 'options.js đổi chỗ lưu thì test này phải đổi theo');
  assert.ok(
    (MANIFEST.permissions || []).includes('storage'),
    `manifest phải khai quyền storage: ${JSON.stringify(MANIFEST.permissions || [])}`,
  );
});

test('Cài đặt — trang không tự viết lại selector nào, gợi ý dựng từ bộ mặc định đang chạy', () => {
  const SELECTOR_SHAPED = /mat-[\w-]+|mdc-[\w-]+|\[(?:class|id|role|type|contenteditable|aria-[\w-]+|data-[\w-]+)[\^*$~|]?=/g;
  const body = OPTIONS_HTML.replace(/<style>[\s\S]*?<\/style>/g, '');
  assert.deepEqual(body.match(SELECTOR_SHAPED) || [], []);
  assert.deepEqual(OPTIONS_JS.match(SELECTOR_SHAPED) || [], []);
});

// ------------------------------------------------------- đọc chữ người gõ

test('parseOverrides — ô trống là "không ghi đè gì", không phải lỗi', () => {
  assert.deepEqual(O.parseOverrides('   '), { ok: true, value: {} });
});

test('parseOverrides — JSON hỏng thì từ chối và nói ra, không nuốt', () => {
  const result = O.parseOverrides('{ "addSource": ["a", }');
  assert.equal(result.ok, false);
  assert.match(result.error, /JSON không đọc được/);
});

test('parseOverrides — nhóm không phải mảng chuỗi thì từ chối, kể tên nhóm sai', () => {
  const result = O.parseOverrides('{ "addSource": "them nguon", "submit": ["luu"] }');
  assert.equal(result.ok, false);
  assert.match(result.error, /addSource/);
  assert.doesNotMatch(result.error, /submit/);
});

test('parseOverrides — mảng ở ngoài cùng không phải bộ ghi đè', () => {
  assert.equal(O.parseOverrides('["them nguon"]').ok, false);
});

test('parseOverrides — đọc được bộ ghi đè hợp lệ và cắt khoảng trắng thừa', () => {
  assert.deepEqual(O.parseOverrides('{ "addSource": [" them nguon moi ", ""] }'), {
    ok: true,
    value: { addSource: ['them nguon moi'] },
  });
});

// ------------------------------- từ chữ người gõ tới bộ selector đang chạy

test('overridesFrom — nhãn đi vào nhóm labels, selector CSS đi vào nhóm CSS, không đổi chỗ', () => {
  const shaped = O.overridesFrom({
    labelOverrides: { addSource: ['nap tu lieu'] },
    selectorOverrides: { dialog: ['#hop-thoai'] },
  });
  assert.deepEqual(shaped.labels, { addSource: ['nap tu lieu'] });
  assert.deepEqual(shaped.dialog, ['#hop-thoai']);
});

test('Cài đặt → selector — nhãn người dùng đứng trước, nhãn mặc định vẫn còn nguyên', () => {
  const parsed = O.parseOverrides('{ "addSource": ["Nạp tư liệu"] }');
  const sel = N.resolve(O.overridesFrom({ labelOverrides: parsed.value }));
  const labels = sel.label('addSource');
  assert.equal(labels[0], 'nap tu lieu', 'nhãn của người dùng phải được thử trước');
  for (const kept of N.DEFAULT.label('addSource')) assert.ok(labels.includes(kept), `mất nhãn mặc định "${kept}"`);
});

test('Cài đặt → selector — ghi đè CSS gộp thêm và giữ nguyên chữ hoa, không bị hạ như nhãn', () => {
  const parsed = O.parseOverrides('{ "dialog": ["div[data-Test=\\"Hộp\\"]"] }');
  const sel = N.resolve(O.overridesFrom({ selectorOverrides: parsed.value }));
  assert.ok(sel.css('dialog').startsWith('div[data-Test="Hộp"]'));
  assert.ok(sel.css('dialog').includes(N.DEFAULT_SELECTORS.dialog[0]));
});

// ------------------------------------------------------------- form vòng tròn

/** Document giả dựng từ **chính** id có thật trong options.html — không phải một danh sách chép tay. */
function fakeDoc() {
  const nodes = new Map([...idsOf(OPTIONS_HTML)].map((id) => [id, { value: '', placeholder: '' }]));
  return { nodes, getElementById: (id) => nodes.get(id) || null };
}

test('fillForm → readForm — bộ cài đặt đi một vòng qua trang mà không đổi', () => {
  const doc = fakeDoc();
  const settings = { ...O.defaultSettings(), downloadDir: 'Tài liệu Rust', mergeWindowSeconds: 45 };
  O.fillForm(doc, settings);
  const read_ = O.readForm(doc);
  assert.equal(read_.ok, true);
  assert.deepEqual(read_.value, settings);
});

test('readForm — ghi đè gõ sai thì KHÔNG lưu gì, và nói rõ ô nào sai', () => {
  const doc = fakeDoc();
  O.fillForm(doc, O.defaultSettings());
  doc.nodes.get(O.fieldId('labelOverrides')).value = '{ "addSource": ';
  const result = O.readForm(doc);
  assert.equal(result.ok, false);
  assert.match(result.error, /labelOverrides/);
});

test('readForm — số nhập bậy quay về mặc định, không ra NaN nằm im trong storage', () => {
  const doc = fakeDoc();
  O.fillForm(doc, O.defaultSettings());
  doc.nodes.get(O.fieldId('mergeWindowSeconds')).value = 'ba mươi';
  doc.nodes.get(O.fieldId('downloadDir')).value = '   ';
  const result = O.readForm(doc);
  assert.equal(result.value.mergeWindowSeconds, S.DEFAULTS.mergeWindowSeconds);
  assert.equal(result.value.downloadDir, S.DEFAULTS.downloadDir);
});

test('normalizeSettings — bộ cài đặt cũ thiếu khoá vẫn dùng được ngay', () => {
  const settings = O.normalizeSettings({ downloadDir: 'Cũ' });
  assert.equal(settings.downloadDir, 'Cũ');
  assert.equal(settings.transcriptFormat, S.DEFAULTS.transcriptFormat);
  assert.deepEqual(settings.labelOverrides, {});
});

test('trang Cài đặt không cần chrome: nạp được ngoài trình duyệt để test phần thuần', () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  assert.equal(typeof O.parseOverrides, 'function');
});
