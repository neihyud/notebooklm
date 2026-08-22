// Ticket 009 — dò sidebar và dựng cây mục lục. Seam 3: nhận cây node, trả giá trị thuần.
//
// Hai lỗi mà ticket này gọi tên đều **im lặng**: Bảng chọn vẫn mở, vẫn có link, chỉ là thiếu.
// Vì vậy mọi test dựng cây ở đây so **số mục dựng được với số link thật trong container**, chứ
// không kiểm "có link":
//
//   1. Ngưỡng yếu kiểu "có ≥3 link là xong" cho đường danh sách: một sidebar dựng bằng `<div>`
//      lồng nhau vẫn lẫn một `<ul>` nhỏ (mấy link mạng xã hội), nên ngưỡng ấy trả về một cây ba
//      mục và bỏ sót 12 trang — `dựng cây — `<div>` lồng nhau…`.
//   2. Dùng chung sổ "đã nhận" giữa hai lượt dựng: nấc `<li>` nhận mất một phần link, rồi lối
//      xếp phẳng mất sạch chính những link đó — `sổ "đã nhận" — …`.
//
// Ticket 018 thêm chỗ thứ ba, và nó im lặng hơn cả hai chỗ trên vì **không link nào biến mất**:
// cấp cha–con đọc không ra thì cây vẫn đủ 94 mục, chỉ là đơn vị **Nhánh** của ADR 0005 suy biến
// và một nhánh 40 trang ra 40 Nguồn. Bảng `VIA_TABLE` ở cuối file canh chỗ đó.
//
// Bốn cặp cùng kiểu mà file này canh, và test nào chết khi hoán vị:
//   - `NARROW_RATIO` ↔ `LIST_COVER_RATIO` (cùng là tỉ lệ link): `hai ngưỡng — …` (ba test).
//   - trọng số `current` ↔ trọng số `links`: `chấm điểm — link trỏ về trang đang mở là dấu
//     hiệu mạnh nhất…`.
//   - link cùng site ↔ link khác host, và mục cha ↔ mục con: `link — …`, `nhánh — …`.
//   - bốn nhãn `via` (`lists` ↔ `blocks` ↔ `flat` ↔ `none`), cùng kiểu chuỗi và cùng cho một
//     Bảng chọn mở được: `via — mỗi nhãn ứng với ĐÚNG một hình dạng sidebar…`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, cmt } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/docs/selectors.js';
import '../src/docs/sidebar.js';

const S = globalThis.NBLM_SHARED;
const B = globalThis.NBLM_DOCS_SIDEBAR;

const PAGE = 'https://docs.acme.dev/guide/cai-dat';

/**
 * Bề ngang đo bằng một adapter được tiêm: cây giả không có layout, còn trên trang thật đây là
 * `getBoundingClientRect()`. Không đo được thì bề ngang **không cộng điểm** cho ai cả — chứ
 * không phải cộng cho mọi khối, vì một khối rộng 0 trông y hệt một cột hẹp.
 */
const metrics = (widths, viewport = 1200) => ({
  viewport: () => viewport,
  width: (node) => {
    for (const [selector, width] of Object.entries(widths)) {
      if (node.matches(selector)) return width;
    }
    return 0;
  },
});

const link = (href, text) => el('a', { href }, [text]);
const item = (href, text, children = []) => el('li', {}, [link(href, text), ...children]);

/** Trang docs quen thuộc: header, sidebar `<ul>` lồng nhau, thân bài, footer. */
function docsPage() {
  return el('body', {}, [
    el('header', {}, [link('/', 'Acme'), link('/blog', 'Blog')]),
    el('div', { class: 'app' }, [
      el('aside', { class: 'sidebar' }, [
        el('nav', {}, [
          el('ul', {}, [
            item('/gioi-thieu', 'Giới thiệu'),
            el('li', {}, [
              link('/guide/', 'Hướng dẫn'),
              el('ul', {}, [
                item('/guide/cai-dat', 'Cài đặt'),
                item('/guide/cau-hinh', 'Cấu hình'),
                item('/guide/nang-cao', 'Nâng cao'),
              ]),
            ]),
            item('/api/', 'Tham chiếu API'),
          ]),
        ]),
      ]),
      el('main', { class: 'content' }, [
        el('h1', {}, ['Cài đặt']),
        el('p', {}, ['Xem thêm ', link('/api/cli', 'CLI'), ' để biết chi tiết.']),
        el('nav', { class: 'toc' }, [
          el('ul', {}, [item('#yeu-cau', 'Yêu cầu'), item('#buoc-1', 'Bước 1')]),
        ]),
      ]),
    ]),
    el('footer', {}, [link('https://github.com/acme/docs', 'GitHub'), link('mailto:hi@acme.dev', 'Thư')]),
  ]);
}

const WIDE = { '.app': 1200, '.content': 900, 'footer': 1200, 'header': 1200 };
const DOCS_METRICS = metrics({ ...WIDE, '.sidebar': 260, 'nav': 260, 'ul': 260 });

const read = (page, options) => B.readSidebar(page, PAGE, options);
const urlsOf = (nodes) => B.flatten(nodes).filter((n) => n.url).map((n) => n.url);

// ------------------------------------------------------------------ phân loại link

test('link — link cùng site là mục import được, link khác host thì không', () => {
  // Hai chuỗi cùng kiểu (`href` nào cũng là một chuỗi) mà hoán vị vẫn cho một Bảng chọn mở
  // được: chỉ khác là nó mời người dùng import trang GitHub và một địa chỉ thư.
  assert.equal(B.linkKind('/guide/cau-hinh', PAGE).kind, 'nav');
  assert.equal(B.linkKind('https://docs.acme.dev/guide/cau-hinh', PAGE).kind, 'nav');
  assert.equal(B.linkKind('https://github.com/acme/docs', PAGE).kind, 'foreign');
  assert.equal(B.linkKind('mailto:hi@acme.dev', PAGE).kind, 'foreign');
  assert.equal(B.linkKind('javascript:void(0)', PAGE).kind, 'foreign');
  assert.equal(B.linkKind('', PAGE).kind, 'foreign');
});

test('link — neo trong trang là mục lục, còn hash-route kiểu docsify là một trang khác', () => {
  assert.equal(B.linkKind('#cai-dat', PAGE).kind, 'anchor');
  assert.equal(B.linkKind('#/guide/intro', PAGE).kind, 'nav');
  assert.equal(B.linkKind('#/guide/intro', PAGE).url, 'https://docs.acme.dev/guide/cai-dat#/guide/intro');
});

test('link — link trỏ về CHÍNH trang đang mở là dấu hiệu, không phải một mục để import', () => {
  // `normalizeDocUrl` trả `null` cho cả ba chuyện khác hẳn nhau — khác host, giao thức lạ, và
  // trỏ về chính trang đang mở. Gộp chúng lại là mất đúng dấu hiệu mạnh nhất của phép chấm điểm.
  assert.equal(B.linkKind('/guide/cai-dat', PAGE).kind, 'current');
  assert.equal(B.linkKind('/guide/cai-dat/', PAGE).kind, 'current');
  assert.equal(B.linkKind('/guide/cai-dat#yeu-cau', PAGE).kind, 'current');
  // Vẫn import được — nó cũng là một trang docs — nhưng mang định danh của **chính trang đang
  // mở**, không mang chuỗi `href` đã viết: bốn cách viết trên phải ra đúng một mục, không bốn.
  assert.equal(B.linkKind('/guide/cai-dat/', PAGE).url, S.docPageId(PAGE));
  assert.equal(B.linkKind('/guide/cai-dat#yeu-cau', PAGE).url, S.docPageId(PAGE));
});

// ------------------------------------------------------------------ chấm điểm

test('chấm điểm — điểm khối cha KHÔNG tự thắng khối con, nếu không sidebar nào cũng là <body>', () => {
  const page = docsPage();
  const options = { metrics: DOCS_METRICS };
  const aside = page.querySelector('.sidebar');
  assert.ok(B.scoreSidebar(aside, PAGE, options) > B.scoreSidebar(page, PAGE, options),
    'khối bọc cả trang chứa mọi link nên nó luôn thắng nếu chỉ đếm link — bề ngang cột là thứ tách hai bên');
});

test('chấm điểm — link trỏ về trang đang mở là dấu hiệu MẠNH NHẤT, không phải một dấu hiệu nữa', () => {
  // Bốn trọng số cùng một đơn vị (điểm), nên hoán vị hai cái bất kỳ vẫn cho một lần dò chạy
  // trót lọt và một Bảng chọn mở được. Canh **vai**, không khoá con số: chỉnh trọng số sau khi
  // có trang thật là việc sẽ xảy ra.
  assert.ok(B.WEIGHT.current > B.WEIGHT.links, `"trỏ về trang đang mở" (${B.WEIGHT.current}) phải mạnh hơn "số link" (${B.WEIGHT.links})`);
  assert.ok(B.WEIGHT.current > B.WEIGHT.nested, 'phải mạnh hơn "có ul lồng nhau"');
  assert.ok(B.WEIGHT.current > B.WEIGHT.column, 'phải mạnh hơn "cột hẹp"');
  // Hai dấu hiệu phụ **cộng lại** vẫn không được lật dấu hiệu mạnh nhất: một hàng link ở footer
  // vừa hẹp vừa có `ul` lồng nhau, mà nó không phải sidebar.
  assert.ok(B.WEIGHT.nested + B.WEIGHT.column < B.WEIGHT.current,
    'hai dấu hiệu phụ cộng lại lật được dấu hiệu mạnh nhất thì nó không còn là mạnh nhất');
  for (const [name, value] of Object.entries(B.WEIGHT)) assert.ok(value > 0, `trọng số ${name} phải dương`);
  // `ENOUGH_LINKS` là một **số đếm**, không phải tỉ lệ: nó không thay chỗ cho hai ngưỡng dưới.
  assert.ok(B.ENOUGH_LINKS >= 2 && Number.isInteger(B.ENOUGH_LINKS), String(B.ENOUGH_LINKS));
});

test('chấm điểm — hạ "trỏ về trang đang mở" xuống ngang "số link" là dò trúng cả trang', () => {
  // Hậu quả, không phải hằng số: sidebar nhỏ (4 link) đứng cạnh một khối "Xem thêm" 30 link.
  // Với vai đúng, dấu hiệu "có link trỏ về trang đang mở" kéo sidebar lên trên cả `<body>`;
  // hoán vị hai trọng số thì `<body>` thắng, và Bảng chọn dựng từ mọi link của trang.
  const page = el('body', {}, [
    el('aside', { class: 'sidebar' }, [el('ul', {}, [
      item('/guide/cai-dat', 'Cài đặt'),
      item('/guide/cau-hinh', 'Cấu hình'),
      item('/guide/nang-cao', 'Nâng cao'),
      item('/api/', 'API'),
    ])]),
    el('main', { class: 'content' }, [
      el('h1', {}, ['Cài đặt']),
      el('div', { class: 'related' }, Array.from({ length: 30 }, (_, i) => link(`/bai/${i}`, `Bài ${i}`))),
    ]),
  ]);
  const options = { metrics: metrics({ '.content': 600, '.related': 600, '.sidebar': 240, 'ul': 240 }) };

  const found = read(page, options);
  assert.ok(found.container.closest('.sidebar'), 'dò trúng khối ngoài sidebar — Bảng chọn dựng từ cả trang');
  assert.equal(found.total, 4, `sidebar có 4 link, Bảng chọn thấy ${found.total}`);
  assert.equal(urlsOf(found.nodes).length, 4);
});

test('chấm điểm — không đo được bề ngang thì vẫn dò được, bằng cách thu hẹp dần', () => {
  // Bề ngang là adapter, và trên một trang chưa layout xong nó trả 0. Lúc đó phép chấm điểm
  // dừng ở khối bọc, và thứ cứu lượt dò là bước thu hẹp: đi sâu chừng nào khối con vẫn giữ
  // gần trọn link.
  const page = docsPage();
  page.querySelector('header').remove();
  page.querySelector('footer').remove();
  page.querySelector('.content').remove();

  const found = read(page, {});
  assert.equal(found.outcome, 'ok');
  assert.equal(found.total, 6, 'phải giữ đủ 6 link của sidebar');
  assert.ok(found.container.matches('ul, nav, aside'), `dừng ở ${found.container.tagName}`);
});

// ------------------------------------------------------------------ thu hẹp

test('thu hẹp — dừng ở khối CHỨA mục, không tụt xuống một `<li>`', () => {
  // Một sidebar có đúng một nhánh gốc thì cái `<li>` ngoài cùng giữ **trọn** link — thu hẹp
  // theo số link mà không loại `<li>` là chọn nó, và mọi mục anh em của nó biến mất khỏi
  // Bảng chọn mà Bảng chọn vẫn có link.
  const page = el('body', {}, [el('aside', { class: 'sidebar' }, [el('ul', {}, [
    el('li', {}, [link('/guide/', 'Hướng dẫn'), el('ul', {}, [
      item('/guide/cai-dat', 'Cài đặt'),
      item('/guide/cau-hinh', 'Cấu hình'),
    ])]),
  ])])]);

  const found = read(page, { metrics: metrics({ '.sidebar': 260, 'ul': 260 }) });
  assert.equal(found.container.matches('li'), false, 'thu hẹp xuống một mục lẻ');
  assert.equal(found.total, 3);
  assert.deepEqual(urlsOf(found.nodes).map((u) => u.replace('https://docs.acme.dev', '')),
    ['/guide', '/guide/cai-dat', '/guide/cau-hinh']);
});

test('thu hẹp — đi sâu tới đâu thì lấy khối GIỮ NHIỀU LINK NHẤT, không phải khối sâu nhất', () => {
  // Chuỗi lồng nhau 20 → 19 → 18 link: cả ba đều qua ngưỡng "gần trọn", nên "sâu nhất" một
  // mình đi thẳng xuống đáy và vứt 2 link, trong khi dừng giữa chừng chỉ vứt 1. Cả hai đều cho
  // một Bảng chọn đầy mục và không dòng nào báo — chênh nhau đúng một trang biến mất.
  const day = Array.from({ length: 17 }, (_, i) => item(`/trang-${i}`, `Trang ${i}`));
  const page = el('body', {}, [el('aside', { class: 'sidebar' }, [
    link('/rieng-cua-aside', 'Riêng của aside'),
    el('div', { class: 'giua' }, [
      link('/rieng-cua-giua', 'Riêng của giữa'),
      el('ul', { class: 'day' }, [item('/guide/cai-dat', 'Cài đặt'), ...day]),
    ]),
  ])]);
  const options = { metrics: metrics({ '.sidebar': 260, '.giua': 260, '.day': 260 }) };
  const count = (selector) => B.navLinks(page.querySelector(selector), PAGE, options).length;
  assert.deepEqual([count('.sidebar'), count('.giua'), count('.day')], [20, 19, 18]);

  const found = read(page, options);
  assert.equal(found.container, page.querySelector('.giua'),
    `dừng ở ${found.container.getAttribute('class') || found.container.tagName} — giữ ${found.total}/20 link`);
  assert.equal(found.total, 19);
});

test('thu hẹp — giao diện của chính extension không thành sidebar, cũng không thành mục', () => {
  // Hai chỗ khác nhau, hai hậu quả khác nhau, và mỗi chỗ một cái chết riêng:
  //
  //   1. Bảng chọn **chính là** thứ `findSidebar` đang đi tìm — một cột hẹp, `ul` lồng nhau,
  //      đầy link cùng site, có link trỏ về trang đang mở. Không loại nó khỏi tập ứng viên thì
  //      lượt dò thứ hai bắt được chính Bảng chọn của lượt thứ nhất.
  //   2. Điều khiển mà extension gắn **vào trong** sidebar (khuôn ô tick trên từng dòng của
  //      ticket 007) nằm ngay trong container đã chọn, nên nó lẳng lặng thành một mục để import
  //      — và mục ấy trỏ vào một `href` không phải trang docs nào cả.
  const page = docsPage();
  page.append(el('div', { id: `${S.EXT_PREFIX}doc-picker-host`, class: 'own-ui' }, [
    el('ul', {}, [el('li', {}, [
      link('/guide/cai-dat', 'Cài đặt'),
      el('ul', {}, Array.from({ length: 7 }, (_, i) => item(`/da-chon-${i}`, `Đã chọn ${i}`))),
    ])]),
  ]));
  page.querySelector('.sidebar').querySelector('li')
    .append(el('a', { id: `${S.EXT_PREFIX}doc-pick-nhanh`, href: '/import-nhanh-nay' }, ['Import nhánh này']));

  const found = read(page, { metrics: metrics({ ...WIDE, '.own-ui': 250, '.sidebar': 260, 'nav': 260, 'ul': 260 }) });
  const urls = urlsOf(found.nodes);
  assert.equal(urls.some((u) => u.includes('/da-chon-')), false,
    'lượt dò bắt trúng chính Bảng chọn — đúng bài học `OWN_UI` của ticket 002');
  assert.equal(urls.some((u) => u.includes('/import-nhanh-nay')), false,
    'nút của extension nằm trong sidebar thành một mục để import');
  assert.equal(found.total, 6, `sidebar có 6 link thật, đếm được ${found.total}`);
  assert.deepEqual(found.nodes[0].label, 'Giới thiệu');
});

// ------------------------------------------------------------------ dựng cây

test('dựng cây — đường `<ul>` giữ đúng cấp cha–con của sidebar', () => {
  const found = read(docsPage(), { metrics: DOCS_METRICS });
  assert.equal(found.outcome, 'ok');
  assert.equal(found.via, 'lists');
  assert.equal(found.total, 6, 'sidebar có 6 link điều hướng');
  assert.equal(found.taken, 6, `dựng được ${found.taken} trong ${found.total} link thật`);

  const roots = found.nodes;
  assert.deepEqual(roots.map((n) => n.label), ['Giới thiệu', 'Hướng dẫn', 'Tham chiếu API']);
  assert.deepEqual(roots[1].children.map((n) => n.label), ['Cài đặt', 'Cấu hình', 'Nâng cao']);
  assert.deepEqual(roots[0].children, []);
  assert.equal(roots[1].children[0].depth, 1);
  assert.equal(roots[1].depth, 0);
});

test('dựng cây — mục lục trong trang, link khác host và giao thức lạ không thành mục', () => {
  const found = read(docsPage(), { metrics: DOCS_METRICS });
  const urls = urlsOf(found.nodes);
  assert.equal(urls.some((u) => u.includes('github.com')), false, 'link khác host thành một Nguồn rác');
  assert.equal(urls.some((u) => u.includes('mailto')), false);
  assert.equal(urls.some((u) => u.includes('#yeu-cau')), false, 'neo trong trang là chính trang này');
});

test('dựng cây — `<div>` lồng nhau không tên theme, lẫn một `<ul>` nhỏ', () => {
  // Đúng cái bẫy mà ticket 009 gọi tên. Ngưỡng yếu kiểu "gom được ≥3 link là tin" đi theo `ul`
  // mạng xã hội và trả về một cây ba mục: Bảng chọn vẫn mở, vẫn có link, và 12 trang biến mất.
  // `flat` ở đây là câu trả lời **đúng** — không tên theme nào đọc ra được cấp cha–con.
  const items = Array.from({ length: 12 }, (_, i) => el('div', { class: 'item' }, [link(`/guide/muc-${i}`, `Mục ${i}`)]));
  const page = el('body', {}, [
    el('div', { class: 'VPSidebar' }, [
      el('div', { class: 'group' }, [
        el('div', { class: 'title' }, [link('/guide/cai-dat', 'Hướng dẫn')]),
        el('div', { class: 'items' }, items),
      ]),
      el('ul', { class: 'social' }, [
        item('/blog', 'Blog'), item('/nhom', 'Nhóm'), item('/lo-trinh', 'Lộ trình'),
      ]),
    ]),
    el('main', { class: 'content' }, [el('h1', {}, ['Cài đặt'])]),
  ]);

  const found = read(page, { metrics: metrics({ '.VPSidebar': 272, '.content': 900, '.group': 272 }) });
  assert.equal(found.container, page.querySelector('.VPSidebar'));
  assert.equal(found.total, 16, 'sidebar có 16 link thật');
  assert.equal(found.via, 'flat', `đường \`<ul>\` chỉ gom được 3/16 link mà vẫn được tin (via=${found.via})`);
  assert.equal(found.taken, 16, `dựng được ${found.taken} mục từ ${found.total} link — số chênh là số trang biến mất`);
  assert.equal(urlsOf(found.nodes).length, 16);
});

test('sổ "đã nhận" — mỗi lượt dựng một sổ; dùng chung là mất sạch phần lượt trước đã nhận', () => {
  // Lỗi thứ hai ticket gọi tên, và nó im lặng y hệt: lượt `<ul>` nhận 3 link mạng xã hội, rồi
  // lối xếp phẳng bỏ qua đúng 3 link ấy vì sổ nói "đã nhận rồi". Bảng chọn ra 12 mục thay vì
  // 15, không lỗi, không dòng nào báo.
  const page = el('body', {}, [el('div', { class: 'VPSidebar' }, [
    el('div', { class: 'group' }, Array.from({ length: 12 }, (_, i) => el('div', {}, [link(`/guide/muc-${i}`, `Mục ${i}`)]))),
    el('ul', {}, [item('/blog', 'Blog'), item('/nhom', 'Nhóm'), item('/lo-trinh', 'Lộ trình')]),
  ])]);
  const container = page.querySelector('.VPSidebar');
  const links = B.navLinks(container, PAGE, {});
  assert.equal(links.length, 15);

  const shared = B.newLedger();
  const viaLists = B.collectFromItems(container, links, shared, {}, false);
  const viaBlocks = B.collectFromItems(container, links, shared, {}, true);
  const viaFlat = B.collectFlat(links, shared);
  assert.equal(viaLists.taken.length, 3, 'lượt `<li>` phải nhận đúng 3 link mạng xã hội');
  assert.equal(viaBlocks.taken.length, 0, 'dùng chung sổ thì nấc `blocks` mất sạch 3 link nấc trước đã nhận');
  assert.equal(viaFlat.taken.length, 12, 'dùng chung sổ thì lối xếp phẳng mất đúng 3 link kia');

  // Và đây là hành vi đúng: hai sổ riêng, lối xếp phẳng nhận trọn 15.
  const alone = B.collectFlat(links, B.newLedger());
  assert.equal(alone.taken.length, 15);
  assert.equal(B.collectFromItems(container, links, B.newLedger(), {}, true).taken.length, 3);
  assert.equal(B.buildTree(container, PAGE, {}).taken, 15, 'buildTree phải cấp sổ riêng cho từng nấc');
});

// ------------------------------------------------------------ hai ngưỡng, hai vai

test('hai ngưỡng — "thu hẹp" phải chặt hơn "tin đường `<ul>`"', () => {
  // Hai tỉ lệ cùng đơn vị (phần link giữ được) đứng cạnh nhau, hoán vị không làm hỏng lần chạy
  // nào. Vai thì ngược nhau hẳn: thu hẹp **vứt hẳn** những link nằm ngoài khối con — chúng
  // không bao giờ vào Bảng chọn nữa — còn ngưỡng `<ul>` chỉ chọn giữa **hai lối xếp** của cùng
  // một tập link, và lối kia giữ đủ. Mất vĩnh viễn phải dè dặt hơn đổi cách xếp.
  assert.ok(B.NARROW_RATIO > B.LIST_COVER_RATIO,
    `thu hẹp (${B.NARROW_RATIO}) phải chặt hơn tin đường ul (${B.LIST_COVER_RATIO}) — hai vai đang đứng nhầm chỗ`);
  assert.ok(B.NARROW_RATIO < 1 && B.LIST_COVER_RATIO > 0.5);
  assert.ok(B.LIST_COVER_RATIO > 0.5, 'gom dưới một nửa số link mà vẫn "tin" thì ngưỡng này vô nghĩa');
});

/** Sidebar 20 link: 3 link đứng ngoài `<ul>`, 17 link trong một `<ul>` lồng nhau (0,85). */
function eightyFivePercent() {
  const branches = Array.from({ length: 4 }, (_, g) => el('li', {}, [
    link(`/nhom-${g}`, `Nhóm ${g}`),
    el('ul', {}, Array.from({ length: 3 }, (_, i) => item(`/nhom-${g}/muc-${i}`, `Mục ${g}.${i}`))),
  ]));
  return el('body', {}, [
    el('aside', { class: 'sidebar' }, [
      el('div', { class: 'brand' }, [link('/', 'Acme'), link('/blog', 'Blog'), link('/guide/cai-dat', 'Cài đặt')]),
      el('nav', { class: 'pages' }, [el('ul', {}, [...branches, item('/phu-luc', 'Phụ lục')])]),
    ]),
    el('main', { class: 'content' }, [el('h1', {}, ['Cài đặt'])]),
  ]);
}

test('hai ngưỡng — nới "thu hẹp" xuống là đi sâu quá tay và **mất hẳn** mấy link ngoài rìa', () => {
  const page = eightyFivePercent();
  const container = page.querySelector('.sidebar');
  const inner = page.querySelector('.pages');
  const all = B.navLinks(container, PAGE, {}).length;
  const part = B.navLinks(inner, PAGE, {}).length;
  assert.ok(part / all > B.LIST_COVER_RATIO && part / all < B.NARROW_RATIO,
    `fixture phải rơi vào **giữa** hai ngưỡng thì hoán vị mới lộ ra: ${(part / all).toFixed(2)}`);

  const found = read(page, { metrics: metrics({ '.sidebar': 260, '.pages': 260, '.content': 900 }) });
  assert.equal(found.container, container, `thu hẹp quá tay xuống ${found.container.getAttribute('class')}`);
  assert.equal(found.total, all, `mất ${all - found.total} link ngoài rìa mà Bảng chọn vẫn đầy mục`);
  // 3 link ngoài `<ul>` không vào cây (đường `<ul>` gom 17/20 — vẫn đủ để tin), nhưng chúng
  // **còn được đếm**: phần chênh `total − taken` là thứ Bảng chọn phải nói ra thành chữ, và đó
  // là ranh giới giữa "xếp gọn lại" với "mất im lặng". Thu hẹp quá tay thì 3 link ấy biến khỏi
  // cả `total`, tức không còn ai đếm được chúng nữa.
  assert.equal(found.taken, 17);
  assert.equal(all - found.taken, 3, 'phần chênh này là chữ hiện ra ở Bảng chọn — canh ở test/docs-picker.test.js');
});

test('hai ngưỡng — siết "tin đường `<ul>`" lên là vứt luôn cấp cha–con ở đúng sidebar có cây', () => {
  // Mặt kia của cùng một hoán vị: `<ul>` gom được 17/20 link — đủ để tin — nên cây giữ được
  // bốn nhánh. Siết ngưỡng lên thì nó rơi về xếp phẳng: vẫn đủ 20 mục, nhưng tick một nhánh
  // không còn chọn được nhánh con, tức mất đúng thứ Bảng chọn sinh ra để làm.
  const page = eightyFivePercent();
  const found = read(page, { metrics: metrics({ '.sidebar': 260, '.pages': 260, '.content': 900 }) });

  assert.equal(found.via, 'lists', `đường \`<ul>\` gom được 17/20 link mà vẫn bị bỏ (via=${found.via})`);
  assert.equal(found.taken, 17, `dựng được ${found.taken} mục từ ${found.total} link thật`);
  assert.equal(found.total, 20);
  assert.deepEqual(found.nodes.map((n) => n.label), ['Nhóm 0', 'Nhóm 1', 'Nhóm 2', 'Nhóm 3', 'Phụ lục']);
  assert.deepEqual(found.nodes[0].children.map((n) => n.label), ['Mục 0.0', 'Mục 0.1', 'Mục 0.2']);
});

// ------------------------------------------------------------------ nhánh

test('nhánh — chọn một mục cha là chọn cả nhánh CON của nó, không phải mục cha của nó', () => {
  // Hai tập hợp cùng kiểu (đều là mục của cây) mà hoán vị vẫn cho một lần import chạy trót
  // lọt: tick "Hướng dẫn" đáng lẽ kéo theo ba trang con, hoán vị thì nó kéo theo… cả sidebar.
  const found = read(docsPage(), { metrics: DOCS_METRICS });
  const guide = found.nodes[1];
  const child = guide.children[0];

  assert.deepEqual(B.branch(guide).map((n) => n.label), ['Hướng dẫn', 'Cài đặt', 'Cấu hình', 'Nâng cao']);
  assert.deepEqual(B.branch(child).map((n) => n.label), ['Cài đặt'],
    'tick một mục con mà kéo theo mục cha là import cả nhánh người dùng không chọn');
});

test('nhánh — ô lọc giữ lại cả đường đi tới mục khớp, gõ không dấu vẫn khớp', () => {
  const found = read(docsPage(), { metrics: DOCS_METRICS });
  const kept = B.filterNodes(found.nodes, 'nang cao');
  assert.deepEqual(kept.map((n) => n.label), ['Hướng dẫn']);
  assert.deepEqual(kept[0].children.map((n) => n.label), ['Nâng cao']);
  assert.equal(B.filterNodes(found.nodes, '').length, found.nodes.length);
  // Khớp ở mục cha thì cả nhánh con hiện ra — người dùng lọc để **tick cả nhánh**.
  assert.equal(B.countPages(B.filterNodes(found.nodes, 'huong dan')), 4);
});

// ------------------------------------------------------------------ báo cho người dùng

test('kết quả — sidebar chỉ có mục lục trong trang thì NÓI RA, không trả danh sách gần rỗng', () => {
  // Sphinx thuần: sidebar là mục lục của chính trang đang mở, toàn neo `#`. Im lặng trả về một
  // cây rỗng là để người dùng ngồi nhìn một Bảng chọn trống mà không biết vì sao.
  const page = el('body', {}, [
    el('div', { class: 'sphinxsidebar' }, [
      el('h3', {}, ['Mục lục']),
      el('ul', {}, [item('#cai-dat', 'Cài đặt'), item('#cau-hinh', 'Cấu hình'), item('#faq', 'FAQ')]),
    ]),
    el('div', { class: 'document' }, [el('h1', {}, ['Cài đặt'])]),
  ]);

  const found = read(page, { metrics: metrics({ '.sphinxsidebar': 230, '.document': 900 }) });
  assert.equal(found.outcome, 'anchors-only');
  assert.equal(found.anchors, 3, 'phải đếm được mục lục trong trang để câu báo nói đúng con số');
  assert.equal(found.total, 0);
  assert.deepEqual(found.nodes, []);
});

test('kết quả — trang không có link điều hướng nào thì báo "không thấy sidebar", khác hẳn ở trên', () => {
  const page = el('body', {}, [el('article', {}, [el('h1', {}, ['Một trang lẻ']), el('p', {}, ['Không có menu.'])])]);
  const found = read(page, {});
  assert.equal(found.outcome, 'none');
  assert.equal(found.anchors, 0);
  assert.equal(found.container, null);
});

// ------------------------------------------------- Nhánh của một mục đã chọn (ticket 010)

/** Cây ba cấp dựng thẳng, không qua DOM: ở đây chỉ có quan hệ cha–con là quan trọng. */
const node = (id, label, children = []) => ({ id, label, url: `/${id}`, depth: 0, children });

const TREE = [
  node('n0', 'Giới thiệu'),
  node('n1', 'Hướng dẫn', [
    node('n2', 'Cài đặt'),
    node('n3', 'Nâng cao', [node('n4', 'Tinh chỉnh')]),
  ]),
  node('n5', 'Tham chiếu API', [node('n6', 'CLI')]),
];

const branchNames = (ids) => {
  const chosen = new Set(ids);
  const found = B.branchesOf(TREE, (n) => chosen.has(n.id));
  return [...found].map(([id, branch]) => `${id}:${branch.label}`);
};

test('nhánh — mọi trang trong một nhánh đã tick mang CÙNG một Nhánh: mục cao nhất được tick', () => {
  // Đây là điều kiện để một nhánh 40 trang ra **một** Nguồn chứ không phải 40 (ADR 0005): engine
  // gộp theo khoá `(site, Nhánh)`, nên nếu mỗi trang khai Nhánh của riêng nó thì mỗi trang một
  // bó. Cả hai cách đều cho một lần import chạy trót lọt từ đầu tới cuối — chỉ khác 39 Nguồn.
  assert.deepEqual(branchNames(['n1', 'n2', 'n3', 'n4']), [
    'n1:Hướng dẫn', 'n2:Hướng dẫn', 'n3:Hướng dẫn', 'n4:Hướng dẫn',
  ]);
});

test('nhánh — hai nhánh tick cùng lúc vẫn là hai Nhánh, không dính vào nhau', () => {
  // Ranh giới Nhánh là chỗ ADR 0005 bảo cắt. Gộp hai nhánh làm một vì "cùng một lượt bấm" là
  // cắt theo *lượt bấm* chứ không theo cấu trúc tài liệu.
  assert.deepEqual(branchNames(['n1', 'n2', 'n5', 'n6']), [
    'n1:Hướng dẫn', 'n2:Hướng dẫn', 'n5:Tham chiếu API', 'n6:Tham chiếu API',
  ]);
});

test('nhánh — một trang lẻ được tick là Nhánh của chính nó, không mượn tên mục cha chưa tick', () => {
  // Mượn tên mục cha là gộp một trang vào một Nguồn mang tên cả nhánh — và tên Nguồn thì vĩnh
  // viễn (ADR 0010), còn ADR 0009 lại đọc tên để biết phần nào đã có.
  assert.deepEqual(branchNames(['n3']), ['n3:Nâng cao']);
  assert.deepEqual(branchNames(['n2', 'n6']), ['n2:Cài đặt', 'n6:CLI']);
});

test('nhánh — mục chưa tick nằm giữa không cắt nhánh của mục cha đã tick', () => {
  // Bỏ tick một mục giữa nhánh (rồi tick lại mục con) không biến mục con thành một Nguồn riêng:
  // Nhánh vẫn là mục **cao nhất** đang được tick, đúng như trên màn hình người dùng nhìn thấy.
  assert.deepEqual(branchNames(['n1', 'n4']), ['n1:Hướng dẫn', 'n4:Hướng dẫn']);
});

test('nhánh — không tick gì thì không mục nào có Nhánh', () => {
  assert.deepEqual(branchNames([]), []);
  assert.deepEqual([...B.branchesOf([], () => true)], []);
});

// ------------------------------------- bốn bộ tạo, bốn nhãn `via` (ticket 018)
//
// Ticket 012 đo trên trang thật: MkDocs Material ra **94 mục phẳng** và VitePress ra 17 mục
// phẳng, nên đơn vị **Nhánh** của ADR 0005 suy biến — một nhánh 40 trang thành 40 Nguồn thay vì
// một, và lần import ấy vẫn chạy trót lọt từ đầu tới cuối.
//
// Bốn fixture dưới đây là bốn **hình dạng HTML** khác hẳn nhau, không phải bốn lần dựng lại cùng
// một hình. Đó là cả nội dung của phép canh: `via` có bốn nhãn hợp lệ (`lists`, `blocks`, `flat`,
// `none`) và **cả bốn đều cho một Bảng chọn mở được**, nên một fixture một-bộ-tạo không phân
// biệt được nhãn nào với nhãn nào (`WORKSPACE_PROTOCOL.md` v9, luật fixture một phần tử).

/**
 * MkDocs Material — `<nav class="md-nav">` chen **giữa** `<li>` và `<ul>` con.
 *
 * Ba cấp, và mục "đặc biệt" (nhóm **có** link của riêng nó, nằm sau một lớp `<div>` bọc) nằm ở
 * **giữa** danh sách: nằm đầu thì `[0]` lọt, nằm cuối thì `at(-1)` lọt.
 */
function mkdocsPage() {
  const li = (kids) => el('li', { class: 'md-nav__item' }, kids);
  // `md-nav__title` **lặp lại tên nhóm** — đúng như trang thật, và nó nằm trong `<nav>` chứ không
  // trong `<ul>`. Trừ chữ theo mục con thôi (không trừ cả nhánh dẫn tới mục con) là nhãn ra
  // `"Bắt đầu Bắt đầu"`; đo được trên squidfunk.github.io: `"Getting started Getting started"`.
  const sub = (title, kids) => el('nav', { class: 'md-nav' }, [
    el('label', { class: 'md-nav__title' }, [el('span', { class: 'md-nav__icon' }, ['']), title]),
    el('ul', { class: 'md-nav__list' }, kids),
  ]);
  const leaf = (href, text) => li([el('a', { class: 'md-nav__link', href }, [el('span', { class: 'md-ellipsis' }, [text])])]);
  /** Mục lục **trong trang** mà MkDocs treo dưới mục đang mở: toàn neo `#`, không mục nào import được. */
  const toc = () => el('nav', { class: 'md-nav md-nav--secondary' }, [
    el('label', { class: 'md-nav__title' }, ['Trên trang này']),
    el('ul', { class: 'md-nav__list' }, [
      li([el('a', { class: 'md-nav__link', href: '#yeu-cau' }, ['Yêu cầu'])]),
      li([el('a', { class: 'md-nav__link', href: '#buoc-1' }, ['Bước 1'])]),
    ]),
  ]);

  return el('body', {}, [
    el('div', { class: 'app' }, [
      el('div', { class: 'md-sidebar' }, [
        el('nav', { class: 'md-nav md-nav--primary' }, [
          el('ul', { class: 'md-nav__list' }, [
            leaf('/', 'Trang chủ'),
            // Nhóm **không** bấm được: tên nằm ở `<label>`, nhánh con nằm sau một `<nav>`.
            li([
              el('input', { class: 'md-nav__toggle' }, []),
              el('label', { class: 'md-nav__link' }, [el('span', { class: 'md-ellipsis' }, ['Bắt đầu'])]),
              sub('Bắt đầu', [
                li([
                  el('a', { class: 'md-nav__link', href: '/guide/cai-dat' }, [el('span', {}, ['Cài đặt'])]),
                  toc(),
                ]),
                // Nhóm **có** link của riêng nó — `<div class="md-nav__container">` bọc thêm một lớp.
                li([
                  el('div', { class: 'md-nav__container' }, [
                    el('a', { class: 'md-nav__link', href: '/guide/nang-cao' }, [el('span', {}, ['Nâng cao'])]),
                    el('label', { class: 'md-nav__link' }, [el('span', { class: 'md-nav__icon' }, [''])]),
                  ]),
                  sub('Nâng cao', [
                    leaf('/guide/nang-cao/bo-nho-dem', 'Bộ nhớ đệm'),
                    leaf('/guide/nang-cao/proxy', 'Proxy'),
                  ]),
                ]),
                leaf('/guide/giay-phep', 'Giấy phép'),
              ]),
            ]),
            leaf('/api/', 'Tham chiếu API'),
          ]),
        ]),
      ]),
      el('main', { class: 'content' }, [el('h1', {}, ['Cài đặt'])]),
    ]),
  ]);
}

const MKDOCS_METRICS = metrics({ '.app': 1200, '.content': 900, '.md-sidebar': 240, 'nav': 240, 'ul': 240, 'li': 240, 'div': 240 });

/**
 * VitePress — mục là `div.VPSidebarItem`, và Vue dựng **cả cụm** mục con vào đúng **một** `<li>`
 * (fragment `<!--[-->`). Nên `<li>` có mặt nhưng **không** phải ranh giới mục: đọc theo `<li>`
 * cho mỗi nhóm đúng một mục và bỏ mất phần còn lại.
 *
 * Nhóm lồng ("Nâng cao") nằm **giữa** nhóm "Viết bài", không đầu không cuối.
 */
function vitepressPage() {
  const vpLink = (href, text) => el('div', { class: 'VPSidebarItem level-1 is-link' }, [
    el('div', { class: 'item' }, [
      el('div', { class: 'indicator' }, []),
      el('a', { class: 'VPLink link', href }, [el('p', { class: 'text' }, [text])]),
    ]),
  ]);
  const vpGroup = (title, kids) => el('div', { class: 'VPSidebarItem level-1 collapsible' }, [
    el('div', { class: 'item' }, [
      el('div', { class: 'indicator' }, []),
      el('h3', { class: 'text' }, [title]),
      el('button', { class: 'caret' }, [el('span', { class: 'caret-icon' }, [''])]),
    ]),
    // `<!--[-->` / `<!--]-->`: marker fragment của Vue SSR, có thật trên trang VitePress.
    el('ul', { class: 'items' }, [el('li', {}, [cmt('['), ...kids, cmt(']')])]),
  ]);
  const section = (title, kids) => el('div', { class: 'group' }, [
    el('section', { class: 'VPSidebarItem level-0 collapsible' }, [
      el('div', { class: 'item' }, [
        el('div', { class: 'indicator' }, []),
        el('h2', { class: 'text' }, [title]),
        el('button', { class: 'caret' }, [el('span', { class: 'caret-icon' }, [''])]),
      ]),
      el('ul', { class: 'items' }, [el('li', {}, [cmt('['), ...kids, cmt(']')])]),
    ]),
  ]);
  /** Nhóm cuối của vitepress.dev: **không có tiêu đề**, chỉ một `ul.items`. */
  const untitled = (kids) => el('div', { class: 'group' }, [
    el('div', { class: 'VPSidebarItem level-0' }, [
      el('ul', { class: 'items' }, [el('li', {}, [cmt('['), ...kids, cmt(']')])]),
    ]),
  ]);

  return el('body', {}, [
    el('div', { class: 'app' }, [
      el('aside', { class: 'VPSidebar' }, [
        el('nav', { class: 'nav' }, [
          el('span', { class: 'visually-hidden' }, ['Sidebar Navigation']),
          section('Giới thiệu', [
            vpLink('/guide/vitepress-la-gi', 'VitePress là gì'),
            vpLink('/guide/cai-dat', 'Cài đặt'),
          ]),
          section('Viết bài', [
            vpLink('/guide/markdown', 'Markdown'),
            vpGroup('Nâng cao', [
              vpLink('/guide/nang-cao/asset', 'Tài nguyên tĩnh'),
              vpLink('/guide/nang-cao/i18n', 'Đa ngữ'),
            ]),
            vpLink('/guide/vue', 'Dùng Vue'),
          ]),
          section('Tuỳ biến', [vpLink('/guide/theme', 'Theme riêng')]),
          untitled([vpLink('/reference/cau-hinh', 'Tham chiếu cấu hình')]),
        ]),
      ]),
      el('main', { class: 'content' }, [el('h1', {}, ['Cài đặt'])]),
    ]),
  ]);
}

const VP_METRICS = metrics({ '.app': 1200, '.content': 900, '.VPSidebar': 220, 'nav': 220, 'ul': 220, 'li': 220, 'section': 220, 'div': 220 });

/**
 * Sidebar dựng bằng `<div>` **không mang tên theme nào** — và lẫn một `<ul>` mấy link mạng xã
 * hội. Không đường nào đọc ra cấp cha–con, nên `flat` là câu trả lời **đúng**, không phải một
 * trạng thái lỗi: cả 16 trang vẫn vào Bảng chọn, chỉ là không có nhánh.
 */
function plainDivPage() {
  const items = Array.from({ length: 12 }, (_, i) => el('div', { class: 'item' }, [link(`/guide/muc-${i}`, `Mục ${i}`)]));
  return el('body', {}, [
    el('div', { class: 'menu' }, [
      el('div', { class: 'group' }, [
        el('div', { class: 'title' }, [link('/guide/cai-dat', 'Hướng dẫn')]),
        el('div', { class: 'items' }, items),
      ]),
      el('ul', { class: 'social' }, [
        item('/blog', 'Blog'), item('/nhom', 'Nhóm'), item('/lo-trinh', 'Lộ trình'),
      ]),
    ]),
    el('main', { class: 'content' }, [el('h1', {}, ['Cài đặt'])]),
  ]);
}

const PLAIN_METRICS = metrics({ '.menu': 272, '.content': 900, '.group': 272 });

/** Trang không có link điều hướng nào: không có sidebar để dựng cây. */
const noSidebarPage = () => el('body', {}, [el('article', {}, [el('h1', {}, ['Một trang lẻ']), el('p', {}, ['Không có menu.'])])]);

/** Nhãn của con trực tiếp, theo thứ tự — phép so duy nhất nói được cấp cha–con. */
const kidsOf = (nodes) => nodes.map((n) => n.label);
const findLabel = (nodes, label) => B.flatten(nodes).find((n) => n.label === label);
/** Cây có cấp cha–con thật hay không: `flat` phải cho `false`, ba nhãn kia phải cho `true`. */
const hasDepth = (nodes) => B.flatten(nodes).some((n) => n.children.length > 0);

/**
 * **Tương ứng nhãn ↔ hình dạng sidebar.** Bốn nhãn đều hợp lệ và đều cho một Bảng chọn mở được,
 * nên "có nhãn, và nhãn nằm trong tập hợp lệ" không canh được gì. Bảng này khoá *nhãn nào ứng
 * với hình dạng nào* — hoán vị hai nhãn bất kỳ trong `buildTree`/`readSidebar` làm ít nhất hai
 * dòng dưới đây đỏ.
 */
const VIA_TABLE = [
  { name: 'Docusaurus — `ul`/`li` lồng thẳng', page: docsPage, metrics: DOCS_METRICS, via: 'lists', outcome: 'ok', total: 6, deep: true },
  { name: 'MkDocs Material — `<nav>` chen giữa `li` và `ul`', page: mkdocsPage, metrics: MKDOCS_METRICS, via: 'lists', outcome: 'ok', total: 7, deep: true },
  { name: 'VitePress — mục là `div.VPSidebarItem`, `<li>` chỉ là fragment', page: vitepressPage, metrics: VP_METRICS, via: 'blocks', outcome: 'ok', total: 8, deep: true },
  { name: '`<div>` thuần, không tên theme nào', page: plainDivPage, metrics: PLAIN_METRICS, via: 'flat', outcome: 'ok', total: 16, deep: false },
  { name: 'không có link điều hướng nào', page: noSidebarPage, metrics: {}, via: 'none', outcome: 'none', total: 0, deep: false },
];

test('via — mỗi nhãn ứng với ĐÚNG một hình dạng sidebar, không chỉ "nằm trong tập hợp lệ"', () => {
  const seen = [];
  for (const row of VIA_TABLE) {
    const found = read(row.page(), { metrics: row.metrics });
    seen.push(found.via);
    assert.equal(found.outcome, row.outcome, `${row.name}: outcome`);
    assert.equal(found.total, row.total, `${row.name}: số link thật trong container`);
    assert.equal(found.taken, row.total, `${row.name}: dựng được ${found.taken}/${found.total} link`);
    assert.equal(found.via, row.via, `${row.name}: nhãn phải là ${row.via}, đang là ${found.via}`);
    // Nhãn mà không kèm hình dạng thì hoán vị hai nhãn vẫn xanh — đây là vế thứ hai.
    assert.equal(hasDepth(found.nodes), row.deep,
      `${row.name}: nhãn nói "${found.via}" nhưng cây ${row.deep ? 'không có' : 'lại có'} cấp cha–con`);
  }
  assert.equal(new Set(seen).size, 4, `bảng phải đo được cả bốn nhãn, đang chỉ thấy ${[...new Set(seen)].join(', ')}`);
});

test('MkDocs — `<nav>` chen giữa không được nuốt cấp cha–con, và cháu KHÔNG leo lên làm con', () => {
  const found = read(mkdocsPage(), { metrics: MKDOCS_METRICS });
  assert.deepEqual(kidsOf(found.nodes), ['Trang chủ', 'Bắt đầu', 'Tham chiếu API']);

  const batDau = findLabel(found.nodes, 'Bắt đầu');
  assert.equal(batDau.url, '', 'nhóm dựng bằng `<label>` không bấm được, nên không có URL');
  // `<nav>` bọc nhánh con còn mang một `md-nav__title` lặp lại tên nhóm. Trừ chữ theo *mục con*
  // thôi thì nhãn ra "Bắt đầu Bắt đầu" — đo được trên trang thật: "Getting started Getting started".
  assert.equal(batDau.label, 'Bắt đầu');
  // Mục lục **trong trang** treo dưới "Cài đặt" toàn neo `#`: không mục nào import được, nên
  // không mục nào được vào cây. Giữ chúng lại là 11 mục rác trên Bảng chọn MkDocs thật.
  assert.deepEqual(kidsOf(findLabel(found.nodes, 'Cài đặt').children), []);
  assert.equal(B.flatten(found.nodes).length, 8, '7 link + 1 nhóm "Bắt đầu"; thừa ra là neo trong trang lọt vào cây');
  // Đây là câu trả lời cho "test nào chết nếu phép bới nhảy **hai** cấp thay vì một": bới hai
  // cấp (hay `querySelectorAll` mọi cấp) thì Bộ nhớ đệm/Proxy thành con của "Bắt đầu", và
  // "Nâng cao" mất nhánh của nó.
  assert.deepEqual(kidsOf(batDau.children), ['Cài đặt', 'Nâng cao', 'Giấy phép']);

  const nangCao = findLabel(found.nodes, 'Nâng cao');
  assert.deepEqual(kidsOf(nangCao.children), ['Bộ nhớ đệm', 'Proxy']);
  assert.equal(nangCao.url, 'https://docs.acme.dev/guide/nang-cao', 'nhóm này CÓ link của riêng nó, không mượn link mục con');
  assert.equal(nangCao.depth, 1);
  assert.equal(nangCao.children[0].depth, 2);
});

test('VitePress — `<li>` fragment của Vue không thành một Nhánh vô danh chen giữa', () => {
  const found = read(vitepressPage(), { metrics: VP_METRICS });
  assert.deepEqual(kidsOf(found.nodes), ['Giới thiệu', 'Viết bài', 'Tuỳ biến', 'Tham chiếu cấu hình']);
  assert.deepEqual(kidsOf(findLabel(found.nodes, 'Viết bài').children), ['Markdown', 'Nâng cao', 'Dùng Vue']);
  assert.deepEqual(kidsOf(findLabel(found.nodes, 'Nâng cao').children), ['Tài nguyên tĩnh', 'Đa ngữ']);
  assert.equal(findLabel(found.nodes, 'Giới thiệu').depth, 0);
  assert.equal(findLabel(found.nodes, 'Đa ngữ').depth, 2);

  // `<li>` bọc cụm không có tên và không có link. Giữ nó lại là một mục trắng trên Bảng chọn,
  // và tệ hơn: nó thành **Nhánh** của mọi trang bên dưới, nên Nguồn gộp mang tên rỗng — mà tên
  // Nguồn thì vĩnh viễn (ADR 0010).
  assert.equal(B.flatten(found.nodes).some((n) => !n.label), false, 'còn mục không tên trong cây');
  // Nhóm cuối của vitepress.dev không có tiêu đề, và `<li>` của nó kẹp giữa hai marker fragment.
  // Nhặt cả ruột comment vào chữ thì nó ra nhãn `"[ ]"` — khác rỗng vừa đủ để **không** bị gộp,
  // nên trên Bảng chọn hiện ra một Nhánh tên `[ ]` ôm trọn mục con. Đo được trên trang thật.
  const cauHinh = findLabel(found.nodes, 'Tham chiếu cấu hình');
  assert.equal(cauHinh.depth, 0, 'nhóm không tiêu đề phải tan đi, không thành một Nhánh tên `[ ]`');
  assert.equal(B.flatten(found.nodes).some((n) => n.label.includes('[')), false, 'ruột comment lọt vào nhãn');
});

test('Nhánh — đọc được cấp cha–con là điều kiện để một nhánh ra MỘT Nguồn (ADR 0005)', () => {
  // Đây là hậu quả thật của ticket, không phải cái nhãn: `flat` thì mỗi trang khai Nhánh của
  // riêng nó, nên nhánh "Viết bài" 4 trang ra 4 Nguồn thay vì 1 — và lượt import vẫn trót lọt.
  const deep = read(vitepressPage(), { metrics: VP_METRICS });
  const namesOf = (tree, match) => {
    const chosen = new Set(B.flatten(tree.nodes).filter(match).map((n) => n.id));
    return new Set([...B.branchesOf(tree.nodes, (n) => chosen.has(n.id)).values()].map((n) => n.label));
  };
  const written = (n) => n.url && (n.url.includes('/guide/markdown') || n.url.includes('/guide/nang-cao') || n.url.includes('/guide/vue'));
  assert.deepEqual([...namesOf(deep, (n) => written(n) || n.label === 'Viết bài')], ['Viết bài']);

  const flat = read(plainDivPage(), { metrics: PLAIN_METRICS });
  assert.equal(flat.via, 'flat');
  assert.equal(namesOf(flat, (n) => Boolean(n.url)).size, 16, 'sidebar phẳng thật thì 16 trang là 16 Nhánh — đó là câu trả lời đúng');
});

test('directItems — dừng ở mục ĐẦU TIÊN mỗi nhánh; bới xuống mọi cấp là cháu thành con', () => {
  // Ranh giới ticket 018 dặn giữ, và nó **không** kiểm được qua `buildTree`: sổ "đã nhận" cộng
  // với luật "mục không link không nhánh thì bỏ" khiến một phép bới-mọi-cấp cho ra đúng cùng
  // một cây trên mọi fixture ở trên — lượt duyệt sâu nhận hết link trước, rồi bản sao phẳng bị
  // bỏ. Nói cách khác bất biến này đang tựa vào hai cơ chế và chỉ một cái được canh. Ở đây canh
  // thẳng chính phép bới.
  const page = mkdocsPage();
  const outer = page.querySelector('ul.md-nav__list');
  const labelsOf = (nodes) => nodes.map((n) => S.collapse(n.textContent).split(' ')[0]);

  assert.equal(B.directItems(outer, 'li').length, 3, 'ba mục cấp 0: Trang chủ, Bắt đầu, Tham chiếu API');
  const batDau = B.directItems(outer, 'li')[1];
  // `<nav>` chen giữa phải đi xuyên được — đây là vế "MkDocs" của ticket.
  assert.deepEqual(labelsOf(B.directItems(batDau, 'li')), ['Cài', 'Nâng', 'Giấy']);
  // Và đây là vế ngược lại, đối chứng bằng chính DOM: bới mọi cấp thấy nhiều hơn hẳn.
  assert.equal(batDau.querySelectorAll('li').length, 7,
    'đối chứng hỏng: nếu `querySelectorAll` cũng thấy 3 thì phép so trên không phân biệt được gì');
});
