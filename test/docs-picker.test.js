// Ticket 009 — Bảng chọn Nhánh tài liệu. Seam 3, đúng khuôn `src/youtube/panel.js`: phần thuần
// nằm ở `src/docs/sidebar.js`, ở đây chỉ còn cây node và một bộ điều khiển, mọi lối ra là
// adapter được tiêm.
//
// Ba thứ file này canh mà một Bảng chọn "mở được" không nói lên gì cả:
//
//   1. *Chữ hiện ra.* Bảng chọn trả về **cả dữ liệu lẫn chữ**, và anti-pattern v6 của
//      `WORKSPACE_PROTOCOL.md` là chỗ chỉ dữ liệu có test. Fixture ở đây cho các con số khác
//      nhau đôi một (6 mục · 4 đã chọn · 2 khớp · 17/20 link), nên hoán vị hai **nhãn** mà
//      không đổi con số nào vẫn làm suite đỏ.
//   2. *Mục cha ↔ mục con.* Tick "Hướng dẫn" phải kéo theo ba trang con, không phải kéo theo
//      cả sidebar. Cả hai chiều đều cho một lần import chạy trót lọt từ đầu tới cuối.
//   3. *Bảng chọn của trang A còn sống trên trang B.* Với docsify, `#/a → #/b` không tải lại
//      trang: Bảng chọn cũ treo lại là một màn hình đầy mục, tick được, import được — của một
//      sidebar không còn trên màn hình. Đúng hình mà protocol v5 gọi tên.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, input, evt } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/docs/selectors.js';
import '../src/docs/sidebar.js';
import '../src/docs/picker.js';

const S = globalThis.NBLM_SHARED;
const B = globalThis.NBLM_DOCS_SIDEBAR;
const K = globalThis.NBLM_DOCS_PICKER;

const PAGE = 'https://docs.acme.dev/guide/cai-dat';
const OTHER = 'https://docs.acme.dev/api/cli';

const link = (href, text) => el('a', { href }, [text]);
const item = (href, text, children = []) => el('li', {}, [link(href, text), ...children]);

/** Sidebar 6 link, hai cấp: đủ để phân biệt "cả nhánh" với "một mục". */
function docsPage() {
  return el('body', {}, [
    el('aside', { class: 'sidebar' }, [el('nav', {}, [el('ul', {}, [
      item('/gioi-thieu', 'Giới thiệu'),
      el('li', {}, [link('/guide/', 'Hướng dẫn'), el('ul', {}, [
        item('/guide/cai-dat', 'Cài đặt'),
        item('/guide/cau-hinh', 'Cấu hình'),
        item('/guide/nang-cao', 'Nâng cao'),
      ])]),
      item('/api/', 'Tham chiếu API'),
    ])])]),
    el('main', { class: 'content' }, [el('h1', {}, ['Cài đặt'])]),
  ]);
}

const METRICS = {
  viewport: () => 1200,
  width: (node) => (node.matches('.sidebar, nav, ul') ? 260 : (node.matches('.content') ? 900 : 0)),
};

/** `document` giả: đúng những thứ picker.js được phép dùng của nó. */
const fakeDoc = (page) => ({
  body: page,
  createElement: (tag) => (tag === 'input' ? input(tag) : el(tag)),
  querySelector: (selector) => page.querySelector(selector),
  querySelectorAll: (selector) => page.querySelectorAll(selector),
});

function open(page, extra = {}) {
  const doc = fakeDoc(page);
  const controller = K.createController({
    doc,
    root: page,
    page: PAGE,
    host: page,
    options: { metrics: METRICS },
    ...extra,
  });
  controller.open();
  return controller;
}

/** Chữ của một node trong cây shadow — thứ người dùng thật sự đọc. */
const textOf = (node) => S.collapse(node.textContent);
const rowsOf = (c) => Array.from(c.nodes.tree.querySelectorAll('label'));
const boxesOf = (c) => Array.from(c.nodes.tree.querySelectorAll('input'));
const labelsOf = (c) => rowsOf(c).map(textOf);

// ------------------------------------------------------------------ shadow DOM

test('bảng chọn — dựng trong shadow DOM, nên trang không nhìn thấy nó và ngược lại', () => {
  const page = docsPage();
  const controller = open(page);

  assert.ok(controller.nodes.host.shadowRoot, 'không có cây shadow — CSS của trang đè lên Bảng chọn');
  assert.equal(controller.nodes.root.closest(`#${K.HOST_ID}`), null,
    'cây shadow phải là một cây riêng, không phải con của host');

  // Lượt quét của trang đi qua host mà không thấy gì bên trong: đó là điều kiện để chính
  // `findSidebar` không dò trúng Bảng chọn ở lượt mở thứ hai.
  const seen = Array.from(page.querySelectorAll('*'));
  assert.ok(seen.includes(controller.nodes.host), 'host phải nằm trên trang');
  assert.equal(seen.includes(controller.nodes.root), false, 'panel lọt ra ngoài cây shadow');
  assert.equal(B.navLinks(page, PAGE, { metrics: METRICS }).length, 6, 'Bảng chọn tự thêm link vào lượt dò của chính nó');
});

test('bảng chọn — mọi id sinh ra trong cây shadow vẫn mang tiền tố chung', () => {
  // `test/ids.test.js` đi bộ trên cây *trang*, nên nó không với tới đây được: một id lạc quy
  // ước trong shadow DOM không có triệu chứng nào cho tới khi ai đó đi tìm nó.
  const controller = open(docsPage());
  const ids = [controller.nodes.host, controller.nodes.root, ...controller.nodes.root.querySelectorAll('*')]
    .map((node) => node.getAttribute('id'))
    .filter(Boolean);
  assert.ok(ids.length >= 8, `chỉ thấy ${ids.length} id — Bảng chọn chưa dựng đủ, không phải gọn`);
  for (const id of ids) assert.ok(id.startsWith(S.EXT_PREFIX), `id lạc quy ước: ${id}`);
});

// ------------------------------------------------------------------ cây và ô tick

test('bảng chọn — dựng đúng cây mục lục, mỗi mục một ô tick, mục con thụt vào', () => {
  const controller = open(docsPage());
  assert.deepEqual(labelsOf(controller),
    ['Giới thiệu', 'Hướng dẫn', 'Cài đặt', 'Cấu hình', 'Nâng cao', 'Tham chiếu API']);
  assert.equal(boxesOf(controller).length, 6);
  assert.equal(controller.state().tree.total, 6);
});

test('nhánh — tick một mục cha là chọn cả nhánh CON của nó', () => {
  const controller = open(docsPage());
  const guide = controller.state().nodes[1];
  controller.toggle(guide.id);

  assert.deepEqual(controller.selection().map((s) => s.title),
    ['Hướng dẫn', 'Cài đặt', 'Cấu hình', 'Nâng cao']);
  // Ô tick của mục con phải sáng theo: người dùng đọc màn hình chứ không đọc `state`.
  assert.deepEqual(boxesOf(controller).map((box) => box.checked), [false, true, true, true, true, false]);
});

test('nhánh — tick một mục con KHÔNG kéo theo mục cha và các mục anh em của nó', () => {
  const controller = open(docsPage());
  const child = controller.state().nodes[1].children[1];
  controller.toggle(child.id);
  assert.deepEqual(controller.selection().map((s) => s.title), ['Cấu hình']);
});

test('nhánh — bỏ tick mục cha là bỏ cả nhánh, không để lại mục con lẻ đã chọn', () => {
  const controller = open(docsPage());
  const guide = controller.state().nodes[1];
  controller.toggle(guide.id);
  controller.toggle(guide.id);
  assert.deepEqual(controller.selection(), []);
  assert.deepEqual(boxesOf(controller).map((box) => box.checked), [false, false, false, false, false, false]);
});

test('import — gửi đi theo THỨ TỰ CÂY, không phải thứ tự bấm chuột', () => {
  // Cùng bài học với `importSelected` của ticket 007: thứ tự chèn của một `Set` là thứ tự người
  // dùng bấm, mà thứ tự ấy quyết định nội dung Nguồn gộp và cả ranh giới cắt "Phần N"
  // (ADR 0002, 0005). Hai lần chọn cùng một tập trang theo thứ tự bấm khác nhau phải ra đúng
  // một Nguồn, không phải hai Nguồn cùng tên.
  const sent = [];
  const controller = open(docsPage(), { send: async (items) => { sent.push(items); return { ok: true }; } });
  const nodes = controller.state().nodes;
  controller.toggle(nodes[2].id);
  controller.toggle(nodes[0].id);
  controller.nodes.importButton.click();

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].map((s) => s.title), ['Giới thiệu', 'Tham chiếu API']);
  assert.deepEqual(sent[0].map((s) => s.url),
    ['https://docs.acme.dev/gioi-thieu', 'https://docs.acme.dev/api']);
});

// ------------------------------------------------------------------ ô lọc

test('ô lọc — giữ lại cả đường đi tới mục khớp, gõ không dấu vẫn khớp', () => {
  const controller = open(docsPage());
  controller.setQuery('cai');
  assert.deepEqual(labelsOf(controller), ['Hướng dẫn', 'Cài đặt']);
  controller.setQuery('');
  assert.equal(labelsOf(controller).length, 6);
});

test('ô lọc — tick mục cha khi đang lọc vẫn chọn CẢ nhánh gốc, không chỉ phần đang hiện', () => {
  // Hai cây cùng kiểu: cây gốc và cây đã lọc. Tra mục theo cây đã lọc vẫn cho một lần import
  // chạy trót lọt — chỉ là "Hướng dẫn" nghĩa là hai trang thay vì bốn, tuỳ vào chữ đang gõ
  // trong ô lọc. Đúng bài học chỉ-số-sau-lọc của panel transcript (ticket 006).
  const controller = open(docsPage());
  controller.setQuery('cai');
  const guide = controller.state().nodes[1];
  controller.toggle(guide.id);
  assert.deepEqual(controller.selection().map((s) => s.title),
    ['Hướng dẫn', 'Cài đặt', 'Cấu hình', 'Nâng cao']);
});

// ------------------------------------------------------------------ chữ hiện ra

test('chữ hiện ra — mỗi con số đứng cạnh đúng nhãn của nó, không chỉ đúng tập con số', () => {
  // Bốn con số khác nhau đôi một, nên hoán vị hai nhãn bất kỳ mà không đổi con số nào vẫn làm
  // test này đỏ. Neo bằng mảnh ngắn định danh được nhóm, không khoá cả câu — câu chữ còn sửa.
  const controller = open(docsPage());
  const guide = controller.state().nodes[1];
  controller.toggle(guide.id);
  assert.match(textOf(controller.nodes.count), /6 mục/);
  assert.match(textOf(controller.nodes.count), /4 đã chọn/);

  controller.setQuery('cai');
  const filtered = textOf(controller.nodes.count);
  assert.match(filtered, /2\/6 mục khớp/, `số mục khớp và tổng số mục đứng nhầm chỗ: ${filtered}`);
  assert.match(filtered, /4 đã chọn/, `số đã chọn không được đổi theo ô lọc: ${filtered}`);
  assert.match(filtered, /"cai"/);
});

test('chữ hiện ra — số link đường `<ul>` bỏ lại được NÓI RA, không lặng lẽ thiếu', () => {
  // Đường `<ul>` gom 17/20 link — đủ để tin, nên cây giữ được cấp cha–con, nhưng 3 link đứng
  // ngoài `<ul>` không vào cây. Ranh giới giữa "xếp gọn lại" và "mất im lặng" nằm đúng ở câu này.
  const branches = Array.from({ length: 4 }, (_, g) => el('li', {}, [
    link(`/nhom-${g}`, `Nhóm ${g}`),
    el('ul', {}, Array.from({ length: 3 }, (_, i) => item(`/nhom-${g}/muc-${i}`, `Mục ${g}.${i}`))),
  ]));
  const page = el('body', {}, [el('aside', { class: 'sidebar' }, [
    el('div', { class: 'brand' }, [link('/', 'Acme'), link('/blog', 'Blog'), link('/guide/cai-dat', 'Cài đặt')]),
    el('nav', {}, [el('ul', {}, [...branches, item('/phu-luc', 'Phụ lục')])]),
  ])]);

  const controller = open(page);
  const said = textOf(controller.nodes.status);
  assert.equal(controller.state().tree.taken, 17);
  assert.equal(controller.state().tree.total, 20);
  assert.match(said, /17 mục/, `số mục dựng được và số link thật đứng nhầm chỗ: ${said}`);
  assert.match(said, /20 link/, said);
});

test('chữ hiện ra — sidebar chỉ có mục lục trong trang thì nói thẳng ra là không có gì để import', () => {
  const page = el('body', {}, [
    el('div', { class: 'sphinxsidebar' }, [el('ul', {}, [
      item('#cai-dat', 'Cài đặt'), item('#cau-hinh', 'Cấu hình'), item('#faq', 'FAQ'),
    ])]),
    el('div', { class: 'document' }, [el('h1', {}, ['Cài đặt'])]),
  ]);
  const controller = open(page);
  const said = textOf(controller.nodes.status);
  assert.match(said, /mục lục trong trang/, said);
  assert.match(said, /3 mục/, `con số của mục lục trong trang phải là con số thật: ${said}`);
  assert.equal(labelsOf(controller).length, 0);
  assert.match(textOf(controller.nodes.count), /0 mục/);
});

test('chữ hiện ra — không có sidebar là một câu KHÁC, không phải cùng câu với mục lục trong trang', () => {
  const page = el('body', {}, [el('article', {}, [el('h1', {}, ['Trang lẻ']), el('p', {}, ['Không menu.'])])]);
  const said = textOf(open(page).nodes.status);
  assert.match(said, /không tìm thấy sidebar/i, said);
  assert.equal(/mục lục trong trang/.test(said), false, 'hai kết cục khác hẳn nhau mà nói cùng một câu');
});

test('chữ hiện ra — chưa tick gì mà bấm Import thì nói ra, không gửi một danh sách rỗng', async () => {
  let called = 0;
  const controller = open(docsPage(), { send: async () => { called += 1; return { ok: true }; } });
  await controller.importSelected();
  assert.equal(called, 0, 'gửi một hàng đợi rỗng đi là một lần chạy không có nội dung nào');
  assert.match(textOf(controller.nodes.status), /chưa chọn/i);
});

// ------------------------------------------------------- Bảng chọn của trang A trên trang B

/** `window` giả: đủ cho `install` — `location`, `document`, và hai sự kiện điều hướng. */
function fakeTarget(page, href) {
  const listeners = new Map();
  return {
    document: fakeDoc(page),
    location: { href },
    chrome: { runtime: {} },
    addEventListener: (type, handler) => {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    fire: (type) => (listeners.get(type) || []).forEach((handler) => handler(evt(type))),
  };
}

test('dọn — docsify đổi hash-route thì Bảng chọn của trang cũ bị gỡ khỏi trang', () => {
  // `#/a → #/b` không tải lại trang. Bảng chọn cũ treo lại vẫn đầy mục và vẫn import được —
  // của một sidebar không còn trên màn hình. Không có triệu chứng nào (protocol v5).
  const page = docsPage();
  const target = fakeTarget(page, PAGE);
  const picker = K.install(target, { options: { metrics: METRICS } });
  picker.open();
  assert.ok(page.querySelector(`#${K.HOST_ID}`), 'chưa mở được Bảng chọn thì test dưới không nói gì');

  target.location.href = OTHER;
  target.fire('hashchange');
  assert.equal(page.querySelector(`#${K.HOST_ID}`), null, 'Bảng chọn của trang cũ còn treo trên trang mới');
});

test('dọn — điều hướng kiểu pushState không bắn sự kiện nào, nên lượt mở sau tự kiểm URL', () => {
  // Docusaurus và VitePress đổi trang bằng `pushState`: `popstate` chỉ bắn khi bấm nút lùi, nên
  // sự kiện một mình là chưa đủ. Lớp thứ hai: mỗi lượt mở so URL của Bảng chọn đang treo với
  // URL trang đang đứng, và khác thì dựng lại từ đầu.
  const page = docsPage();
  const target = fakeTarget(page, PAGE);
  const picker = K.install(target, { options: { metrics: METRICS } });
  const first = picker.open();

  target.location.href = OTHER;
  const second = picker.open();
  assert.notEqual(second, first, 'dùng lại Bảng chọn dựng từ sidebar của trang trước');
  assert.equal(second.state().page, S.docPageId(OTHER));
  assert.equal(page.querySelectorAll(`#${K.HOST_ID}`).length, 1, 'mỗi trang một Bảng chọn, không chồng lên nhau');
});

test('dọn — mở lại trên CÙNG một trang thì dùng lại Bảng chọn đang mở, không dựng cái thứ hai', () => {
  const page = docsPage();
  const target = fakeTarget(page, PAGE);
  const picker = K.install(target, { options: { metrics: METRICS } });
  assert.equal(picker.open(), picker.open());
  assert.equal(page.querySelectorAll(`#${K.HOST_ID}`).length, 1);
});
