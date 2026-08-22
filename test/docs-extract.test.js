// Ticket 008 — chọn thân bài, dọn điều hướng, và hai nấc lấy nội dung một trang tài liệu.
//
// Hình mà `WORKSPACE_PROTOCOL.md` v5 gọi tên — "một thứ của video A còn sống trên trang video
// B" — ở lớp tài liệu chính là nấc 2. Với docsify, `#/a → #/b` **không tải lại trang**: tab báo
// `complete`, URL đã là `#/b`, mà DOM còn nguyên nội dung `#/a`. Đọc luôn là gán nội dung trang
// A cho URL trang B: Nguồn dựng ra hợp lệ, đọc trôi chảy, và sai.
//
// Cái chốt rằng nội dung đọc được thuộc về URL đã yêu cầu, ở đây có ba lớp, mỗi lớp một test
// chết nếu gỡ nó đi:
//   1. URL tab phải khớp URL yêu cầu   → 'nấc 2 — tab chưa rời trang cũ thì không đọc'.
//   2. Nội dung phải **khác** nội dung tab đang đứng trước lúc điều hướng
//      → 'nấc 2 — docsify: URL đổi trước, DOM đổi sau'.
//   3. Kết quả mang **URL tab đang đứng**, không mang URL đã yêu cầu
//      → 'nấc 2 — kết quả mang đúng URL mà tab đang đứng, không phải URL đã gõ vào'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/docs/selectors.js';
import '../src/docs/markdown.js';
import '../src/docs/extract.js';

const S = globalThis.NBLM_SHARED;
const X = globalThis.NBLM_DOCS_EXTRACT;

// ------------------------------------------------------------------ fixture trang

const LOREM = 'Cai dat goi bang trinh quan ly goi cua ban phan phoi ban dang dung. ';
const prose = (times) => LOREM.repeat(times).trim();

/** Tên mục sidebar — chúng phải **không** xuất hiện trong thân bài. */
const MENU = [
  'Bat dau nhanh', 'Cai dat tren Windows', 'Cai dat tren macOS', 'Cau hinh nang cao',
  'Tham chieu API', 'Cau hoi thuong gap', 'Khac phuc su co', 'Ghi chu phat hanh',
];

/**
 * Sidebar của một theme **không quen thuộc**: class không khớp mục nào trong `chrome`, nên
 * không có đường tắt nào cứu. Thứ duy nhất đẩy nó ra khỏi thân bài là chấm điểm trừ chữ trong
 * link — đó chính là thứ các test dưới đây canh.
 */
function unknownSidebar() {
  return el('div', { class: 'sd-2xl-col' }, [
    el('h1', { class: 'brand' }, ['Tai lieu Acme']),
    el('ul', {}, MENU.map((text) => el('li', {}, [el('a', { href: `/guide/${text}` }, [text])]))),
  ]);
}

function articleBody(children) {
  return el('div', { class: 'page' }, [el('div', { class: 'page-inner' }, children)]);
}

/** Trang docs tự dựng: sidebar lạ + thân bài nằm sâu hai lớp bọc layout. */
function customPage(extra = []) {
  return el('body', {}, [
    el('div', { class: 'app' }, [
      unknownSidebar(),
      articleBody([
        el('h1', {}, ['Cai dat tren Linux']),
        el('p', {}, [prose(6)]),
        el('pre', { class: 'language-bash' }, [el('code', {}, ['apt install acme'])]),
        ...extra,
      ]),
    ]),
  ]);
}

const findByClass = (root, name) => root.querySelector(`.${name}`);

// ------------------------------------------------------------------ chấm điểm

test('chấm điểm — chữ nằm trong link không tính, nên sidebar toàn link về 0', () => {
  const menu = unknownSidebar().querySelector('ul');
  assert.ok(menu.textContent.length > 100, 'fixture sidebar phải có đủ chữ thì phép trừ mới có nghĩa');
  assert.equal(X.scoreBlock(menu), 0, 'chữ trong link vẫn được tính — sidebar sẽ thắng thân bài');
});

test('chấm điểm — điểm khối cha luôn ≥ khối con, nên "khối lớn nhất" luôn là <body>', () => {
  // Đây là lý do quy tắc chọn không thể là "điểm cao nhất". Test này chốt chính cái bất biến
  // khiến quy tắc ấy vô dụng.
  const page = customPage();
  const app = findByClass(page, 'app');
  const inner = findByClass(page, 'page-inner');
  assert.ok(X.scoreBlock(page) >= X.scoreBlock(app));
  assert.ok(X.scoreBlock(app) >= X.scoreBlock(inner));
  assert.ok(X.scoreBlock(inner) > 0);
});

test('chọn thân bài — lấy khối sâu nhất vẫn giữ gần trọn nội dung, không lấy khối lớn nhất', () => {
  const page = customPage();
  const picked = X.pickMainBlock(page);
  assert.equal(picked, findByClass(page, 'page-inner'),
    `chọn nhầm khối <${picked.tagName} class="${picked.getAttribute('class')}">`);
});

test('chọn thân bài — tên mục sidebar không rớt vào thân bài', () => {
  const doc = X.readDocument(customPage());
  for (const name of MENU) {
    assert.equal(doc.markdown.includes(name), false, `tên mục sidebar "${name}" lọt vào thân bài`);
  }
  assert.ok(doc.markdown.includes('apt install acme'), 'thân bài mất luôn khối code');
  assert.ok(doc.markdown.startsWith('# Cai dat tren Linux'));
});

test('chọn thân bài — selector quen thuộc là đường tắt, và nó được đi khi có', () => {
  const page = el('body', {}, [
    el('div', { class: 'docPage' }, [
      el('aside', { class: 'theme-doc-sidebar-container' }, [
        el('ul', {}, MENU.map((t) => el('li', {}, [el('a', { href: '/x' }, [t])]))),
      ]),
      el('main', {}, [
        el('div', { class: 'theme-doc-markdown markdown' }, [
          el('h1', {}, ['Cau hinh nang cao']),
          el('p', {}, [prose(5)]),
        ]),
      ]),
    ]),
  ]);
  const picked = X.pickMainBlock(page);
  assert.ok(picked.matches('.theme-doc-markdown'),
    `đường tắt không được đi: <${picked.tagName} class="${picked.getAttribute('class')}">`);
});

test('chọn thân bài — selector quen thuộc trỏ nhầm một ô quảng cáo thì bỏ nó, quay về chấm điểm', () => {
  // `#content` nằm trong danh sách quen thuộc, nhưng ở trang này nó là một ô con con. Tin nó
  // là cả Nguồn chỉ còn một câu — mà vẫn "thành công".
  const page = customPage();
  page.append(el('div', { id: 'content' }, [el('p', {}, ['Dang ky nhan ban tin.'])]));
  const doc = X.readDocument(page);
  assert.equal(doc.markdown.includes('Dang ky nhan ban tin'), false, 'đi theo đường tắt hỏng');
  assert.ok(doc.markdown.includes('apt install acme'));
});

// ------------------------------------------------------------------ dọn điều hướng

test('dọn — breadcrumb, prev/next, mục lục và "Edit this page" không vào Nguồn', () => {
  const page = customPage([
    el('nav', { class: 'breadcrumbs' }, [
      el('ul', {}, [el('li', {}, [el('a', { href: '/' }, ['Trang chu'])]), el('li', {}, ['Cai dat'])]),
    ]),
    el('div', { class: 'tableOfContents_bqdL' }, [
      el('ul', {}, [el('li', {}, [el('a', { href: '#buoc-1' }, ['Buoc 1'])])]),
    ]),
    el('div', { class: 'theme-edit-this-page' }, [
      el('a', { href: 'https://github.com/acme/docs/edit/main/x.md' }, ['Edit this page']),
    ]),
    el('nav', { class: 'pagination-nav' }, [
      el('a', { href: '/prev' }, ['Trang truoc']),
      el('a', { href: '/next' }, ['Trang sau']),
    ]),
  ]);
  const { markdown } = X.readDocument(page);
  for (const junk of ['Trang chu', 'Buoc 1', 'Edit this page', 'Trang truoc', 'Trang sau']) {
    assert.equal(markdown.includes(junk), false, `"${junk}" còn dính trong Nguồn`);
  }
  assert.ok(markdown.includes('apt install acme'), 'dọn quá tay, mất cả thân bài');
});

test('dọn — nút Copy của Docusaurus nằm NGOÀI <pre>, nên dọn khối code một mình là chưa đủ', () => {
  // Cây thật của Docusaurus v3: nhóm nút là **anh em** của `<pre>`, không phải con — mà bộ dọn
  // bên trong khối code chỉ với tới con của nó.
  const page = el('body', {}, [el('div', { class: 'theme-doc-markdown' }, [
    el('h1', {}, ['Cai dat']),
    el('p', {}, [prose(6)]),
    el('div', { class: 'codeBlockContainer_Ckt0' }, [
      el('div', { class: 'codeBlockContent_biex' }, [
        el('pre', { class: 'prism-code language-bash' }, [
          el('code', {}, [el('span', { class: 'token-line' }, ['npm i acme'])]),
        ]),
        el('div', { class: 'buttonGroup__atx' }, [
          el('button', { class: 'clean-btn copyButton_be2p' }, ['Copy']),
          el('button', { class: 'clean-btn wordWrapButton_Bwma' }, ['Toggle word wrap']),
        ]),
      ]),
    ]),
  ])]);
  const { markdown } = X.readDocument(page);
  assert.equal(markdown.includes('Copy'), false, 'nút Copy thành một dòng trong Nguồn');
  assert.equal(markdown.includes('Toggle word wrap'), false, 'nút đổi ngắt dòng thành một dòng trong Nguồn');
  assert.ok(markdown.includes('npm i acme'), 'dọn quá tay, mất luôn khối code');
});

test('dọn — `<aside>` là mục lục thì gỡ, là footnote của Sphinx thì giữ', () => {
  // Hai `<aside>` cùng thẻ, khác vai. Gạt cả thẻ là xoá im lặng toàn bộ chú thích cuối bài của
  // một bộ docs Sphinx — mà `.rst-content .document` nằm ngay trong danh sách theme quen thuộc.
  const page = el('body', {}, [el('div', { class: 'document' }, [
    el('h1', {}, ['Cai dat']),
    el('p', {}, [prose(6)]),
    el('aside', { class: 'VPDocAside' }, [
      el('ul', {}, [el('li', {}, [el('a', { href: '#buoc-1' }, ['Muc luc ben phai'])])]),
    ]),
    el('aside', { class: 'footnote brackets' }, [el('p', {}, ['Ghi chu quan trong o cuoi bai.'])]),
  ])]);
  const { markdown } = X.readDocument(page);
  assert.ok(markdown.includes('Ghi chu quan trong o cuoi bai'), 'footnote của Sphinx bị xoá im lặng');
  assert.equal(markdown.includes('Muc luc ben phai'), false, 'mục lục bên phải lọt vào Nguồn');
});

test('dọn — neo `#` cạnh đề mục bị gỡ, chữ của đề mục thì không', () => {
  const page = el('body', {}, [
    el('div', { class: 'page-inner' }, [
      el('h2', {}, ['Buoc cai dat', el('a', { class: 'hash-link', href: '#buoc-cai-dat' }, ['#'])]),
      el('p', {}, [prose(4)]),
    ]),
  ]);
  const { markdown } = X.readDocument(page);
  assert.ok(markdown.includes('## Buoc cai dat'));
  assert.equal(markdown.includes('## Buoc cai dat#'), false, 'neo `#` dính vào đề mục');
  assert.equal(markdown.includes('](#buoc-cai-dat)'), false, 'neo `#` thành một link trong Nguồn');
});

test('dọn — làm việc trên bản sao, cây node của trang người dùng không bị sửa', () => {
  const page = customPage([
    el('nav', { class: 'pagination-nav' }, [el('a', { href: '/next' }, ['Trang sau'])]),
  ]);
  X.readDocument(page);
  assert.ok(page.querySelector('.pagination-nav'), 'đã gỡ node thật khỏi trang đang mở');
});

// ------------------------------------------------------------------ tiêu đề

test('tiêu đề — lấy `h1` của thân bài, không lấy tên site ở sidebar', () => {
  // Hai chuỗi cùng kiểu, cùng nằm trong một `h1`, và cái của sidebar đứng **trước** theo thứ tự
  // tài liệu — nên `root.querySelector('h1')` cho ra tên site, mà tên site trông cũng như một
  // tiêu đề hợp lệ.
  const doc = X.readDocument(customPage());
  assert.equal(doc.title, 'Cai dat tren Linux');
  assert.notEqual(doc.title, 'Tai lieu Acme', 'tiêu đề lấy nhầm tên site ở sidebar');
});

// ------------------------------------------------------------------ nấc 2: tab ẩn

const PAGE_A = () => el('body', {}, [el('div', { class: 'page-inner' }, [
  el('h1', {}, ['Trang A']), el('p', {}, [`A: ${prose(6)}`]),
])]);
const PAGE_B = () => el('body', {}, [el('div', { class: 'page-inner' }, [
  el('h1', {}, ['Trang B']), el('p', {}, [`B: ${prose(6)}`]),
])]);

/** Tab ẩn giả: trả lần lượt từng ảnh chụp, ảnh cuối lặp lại mãi. */
function fakeTab(shots) {
  const queue = [...shots];
  const calls = [];
  return {
    calls,
    async go(url) { calls.push(`go:${url}`); },
    async read() {
      calls.push('read');
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  };
}

const NOW = { wait: async () => {}, settle: { tries: 12, stepMs: 0, stableRounds: 2 } };

test('nấc 2 — docsify: URL đổi trước, DOM đổi sau; đọc sớm là gán nội dung A cho URL B', () => {
  const a = PAGE_A();
  const b = PAGE_B();
  const tab = fakeTab([
    { url: 'https://docs.acme.io/#/a', root: a },   // trước khi điều hướng
    { url: 'https://docs.acme.io/#/b', root: a },   // URL đã đổi, DOM còn nguyên trang A
    { url: 'https://docs.acme.io/#/b', root: a },
    { url: 'https://docs.acme.io/#/b', root: a },   // đủ lâu để "đứng yên" một mình là chưa đủ
    { url: 'https://docs.acme.io/#/b', root: b },
  ]);
  return X.readViaTab('https://docs.acme.io/#/b', tab, NOW).then((shot) => {
    assert.equal(shot.root, b, 'chốt nhằm nội dung trang A cho URL trang B');
    const { markdown } = X.readDocument(shot.root);
    assert.ok(markdown.includes('Trang B'));
    assert.equal(markdown.includes('Trang A'), false);
  });
});

test('nấc 2 — breadcrumb đổi theo route trước khi thân bài kịp render thì vẫn chưa được chốt', () => {
  // Mốc "nội dung còn là của trang cũ" mà chụp cả trang thì mảnh chrome nào đổi chữ theo route
  // cũng mở cổng sớm — và thứ đọc được lúc ấy vẫn là thân bài của trang A.
  const shell = (crumb, article) => el('body', {}, [
    el('div', { class: 'crumb' }, [`Duong dan: ${crumb}`]),
    el('div', { class: 'page-inner' }, [el('h1', {}, [`Trang ${article}`]), el('p', {}, [`${article}: ${prose(6)}`])]),
  ]);
  const tab = fakeTab([
    { url: 'https://docs.acme.io/#/a', root: shell('A', 'A') },
    { url: 'https://docs.acme.io/#/b', root: shell('B', 'A') },  // breadcrumb đã là B, thân bài còn A
    { url: 'https://docs.acme.io/#/b', root: shell('B', 'A') },
    { url: 'https://docs.acme.io/#/b', root: shell('B', 'A') },
    { url: 'https://docs.acme.io/#/b', root: shell('B', 'B') },
  ]);
  return X.readViaTab('https://docs.acme.io/#/b', tab, NOW).then((shot) => {
    const { markdown } = X.readDocument(shot.root);
    assert.ok(markdown.includes('Trang B'), `chốt nhằm thân bài trang A:\n${markdown.slice(0, 80)}`);
    assert.equal(markdown.includes('Trang A'), false);
  });
});

test('nấc 2 — tab chưa rời trang cũ thì không đọc, dù nội dung đã đứng yên từ lâu', async () => {
  const tab = fakeTab([{ url: 'https://docs.acme.io/#/a', root: PAGE_A() }]);
  await assert.rejects(
    () => X.readViaTab('https://docs.acme.io/#/b', tab, NOW),
    (error) => {
      assert.equal(error.reason, X.REASON.URL_MISMATCH);
      assert.match(error.message, /#\/b/);
      return true;
    },
  );
});

test('nấc 2 — kết quả mang đúng URL mà tab đang đứng, không phải URL đã gõ vào', async () => {
  // Hai chuỗi cùng kiểu và cùng trỏ một trang, nên hoán vị chúng không lộ ra ở đâu — trừ chỗ
  // này: `docPageId` coi hai cách viết là một, còn chuỗi thì khác nhau từng ký tự.
  const tab = fakeTab([
    { url: 'https://docs.acme.io/guide/intro', root: PAGE_A() },
    { url: 'https://docs.acme.io/guide/setup', root: PAGE_B() },
  ]);
  const shot = await X.readViaTab('https://docs.acme.io/guide/setup/', tab, NOW);
  assert.equal(shot.url, 'https://docs.acme.io/guide/setup', 'trả lại URL đã yêu cầu thay vì URL tab đang đứng');
});

test('nấc 2 — tab đang đứng sẵn ở đúng trang được yêu cầu thì đọc luôn, không chờ nội dung đổi', async () => {
  const b = PAGE_B();
  const tab = fakeTab([{ url: 'https://docs.acme.io/#/b', root: b }]);
  const shot = await X.readViaTab('https://docs.acme.io/#/b', tab, NOW);
  assert.equal(shot.root, b);
});

test('nấc 2 — tab trắng mãi thì báo rỗng, không trả một Nguồn không có chữ nào', async () => {
  const tab = fakeTab([
    { url: 'https://docs.acme.io/#/a', root: PAGE_A() },
    { url: 'https://docs.acme.io/#/b', root: el('body', {}, []) },
  ]);
  await assert.rejects(() => X.readViaTab('https://docs.acme.io/#/b', tab, NOW), /empty/);
});

// ------------------------------------------------------------------ hai nấc

const RICH = () => el('body', {}, [el('div', { class: 'page-inner' }, [
  el('h1', {}, ['Cai dat tren Linux']), el('p', {}, [prose(20)]),
])]);
/** Cái khung rỗng mà một trang render bằng JS trả về cho `fetch`. */
const SHELL = () => el('body', {}, [el('div', { class: 'page-inner' }, [el('p', {}, ['Dang tai...'])])]);

const URL_B = 'https://docs.acme.io/#/b';

function tiersOf({ fetched, fetchError, shots }) {
  const calls = [];
  const tiers = { calls };
  if (fetched || fetchError) {
    tiers.sameOrigin = async (url) => {
      calls.push(`fetch:${url}`);
      if (fetchError) throw new Error(fetchError);
      return typeof fetched === 'function' ? fetched(url) : fetched;
    };
  }
  if (shots) {
    const tab = fakeTab(shots);
    tiers.tab = {
      go: (url) => { calls.push(`go:${url}`); return tab.go(url); },
      read: () => { calls.push('read'); return tab.read(); },
    };
  }
  return tiers;
}

test('hai nấc — nấc 1 đủ dày thì dừng ở đó, tab ẩn không được mở', async () => {
  const tiers = tiersOf({
    fetched: (url) => ({ url, root: RICH() }),
    shots: [{ url: URL_B, root: RICH() }],
  });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, NOW);
  assert.equal(result.via, 'fetch');
  assert.equal(result.escalated, false);
  assert.deepEqual(tiers.calls, [`fetch:${URL_B}`], 'mở tab ẩn dù nấc 1 đã đủ');
  assert.ok(result.chars >= S.DEFAULTS.docsMinChars);
});

test('hai nấc — nấc 1 mỏng thì mở tab ẩn, và Nguồn mang nội dung của **nấc 2**', async () => {
  // Hai chuỗi Markdown cùng kiểu nằm cạnh nhau trong cùng một lần chạy: trả nhầm bản của nấc 1
  // vẫn ra một Nguồn hợp lệ, chỉ là nó chứa đúng cái khung rỗng mà nấc 2 sinh ra để thay thế.
  const tiers = tiersOf({
    fetched: (url) => ({ url, root: SHELL() }),
    shots: [{ url: URL_B, root: RICH() }],
  });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, NOW);
  assert.equal(result.via, 'tab');
  assert.equal(result.escalated, true);
  assert.ok(result.markdown.includes('Cai dat tren Linux'), 'Nguồn không mang nội dung của nấc 2');
  assert.equal(result.markdown.includes('Dang tai'), false, 'Nguồn mang nội dung mỏng của nấc 1');
});

test('hai nấc — đúng bằng ngưỡng là **đạt**, không phải thiếu; biên này quyết định có mở tab hay không', async () => {
  const root = RICH();
  const exact = X.readDocument(root).chars;
  const tiers = tiersOf({ fetched: (url) => ({ url, root }), shots: [{ url: URL_B, root: RICH() }] });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, { ...NOW, settings: { docsMinChars: exact } });
  assert.equal(result.escalated, false, `${exact} ký tự với ngưỡng ${exact} mà vẫn đi mở tab ẩn`);
  assert.deepEqual(tiers.calls, [`fetch:${URL_B}`]);
});

test('hai nấc — nấc 1 hỏng hẳn thì nấc 2 vẫn chạy, và lý do nấc 1 được ghi lại', async () => {
  const tiers = tiersOf({ fetchError: 'HTTP 403', shots: [{ url: URL_B, root: RICH() }] });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, NOW);
  assert.equal(result.via, 'tab');
  assert.deepEqual(result.attempts.map((a) => [a.via, a.ok]), [['fetch', false], ['tab', true]]);
  assert.match(result.attempts[0].reason, /403/);
});

test('hai nấc — cả hai nấc hỏng thì ném lỗi mang cả hai lý do, không trả Nguồn rỗng', async () => {
  const tiers = tiersOf({ fetchError: 'HTTP 403', shots: [{ url: 'https://docs.acme.io/#/a', root: PAGE_A() }] });
  await assert.rejects(() => X.fetchDocPage({ url: URL_B }, tiers, NOW), (error) => {
    assert.match(error.message, /403/);
    assert.match(error.message, /url-mismatch/);
    return true;
  });
});

test('hai nấc — không có tab ẩn thì trả bản mỏng của nấc 1 và **nói ra** là nó mỏng', async () => {
  const tiers = tiersOf({ fetched: (url) => ({ url, root: SHELL() }) });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, NOW);
  assert.equal(result.via, 'fetch');
  assert.equal(result.escalated, true);
  assert.ok(result.chars < S.DEFAULTS.docsMinChars);
});

test('hai nấc — nấc 1 bị chuyển hướng sang trang khác thì không nhận, dù nội dung dày', async () => {
  // Cùng một hình với nấc 2, ở nấc 1: nội dung của trang khác, gắn nhãn URL đã yêu cầu.
  const tiers = tiersOf({
    fetched: () => ({ url: 'https://docs.acme.io/#/khac', root: RICH() }),
    shots: [{ url: URL_B, root: RICH() }],
  });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, NOW);
  assert.equal(result.via, 'tab', 'nhận nội dung của trang bị chuyển hướng tới');
  assert.match(result.attempts[0].reason, /khac/);
});

test('hai nấc — nâng cấp http → https không bị coi là chuyển hướng sang trang khác', async () => {
  const tiers = tiersOf({ fetched: () => ({ url: 'https://docs.acme.io/guide/intro', root: RICH() }) });
  const result = await X.fetchDocPage({ url: 'http://docs.acme.io/guide/intro' }, tiers, NOW);
  assert.equal(result.via, 'fetch');
  assert.equal(result.url, 'https://docs.acme.io/guide/intro');
});

// ------------------------------------------------------------------ chữ hiện ra

test('lời giải thích hiện ra gắn đúng con số vào đúng vai, không chỉ đúng tập con số', async () => {
  // Anti-pattern v6 của `WORKSPACE_PROTOCOL.md`: hàm trả cả dữ liệu lẫn chữ, test chỉ đọc dữ
  // liệu. Ba con số ở đây (số ký tự nấc 1, ngưỡng, số ký tự nấc 2) khác nhau đôi một, nên hoán
  // vị bất kỳ cặp nào cũng làm một assertion dưới đây chết.
  const tiers = tiersOf({
    fetched: (url) => ({ url, root: SHELL() }),
    shots: [{ url: URL_B, root: RICH() }],
  });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, { ...NOW, settings: { docsMinChars: 600 } });
  const thin = result.attempts[0].chars;
  assert.ok(thin > 0 && thin < 600 && result.chars > 600, `ba con số phải khác nhau: ${thin}/600/${result.chars}`);

  assert.match(result.note, new RegExp(`nấc 1[^.]*?\\b${thin} ký tự`), `số ký tự nấc 1 sai chỗ: ${result.note}`);
  assert.match(result.note, /ngưỡng 600/, `ngưỡng sai chỗ: ${result.note}`);
  assert.match(result.note, new RegExp(`nấc 2[^.]*?\\b${result.chars} ký tự`), `số ký tự nấc 2 sai chỗ: ${result.note}`);
});

test('lời giải thích — dừng ở nấc 1 thì câu chữ nói đúng chuyện đó', async () => {
  const tiers = tiersOf({ fetched: (url) => ({ url, root: RICH() }) });
  const result = await X.fetchDocPage({ url: URL_B }, tiers, NOW);
  assert.match(result.note, new RegExp(`nấc 1[^.]*?\\b${result.chars} ký tự`));
  assert.equal(/nấc 2/.test(result.note), false, `nói tới nấc 2 trong khi không mở tab nào: ${result.note}`);
});

test('lời giải thích — lý do của nấc 1 và của nấc 2 không lẫn vào nhau, và không có chữ "undefined"', async () => {
  // Hai chuỗi cùng kiểu nằm cạnh nhau trong cùng một câu. Hoán vị chúng vẫn ra một câu đọc
  // trôi chảy — chỉ là nó đổ lỗi của nấc này cho nấc kia.
  const hongCaHai = tiersOf({ fetchError: 'HTTP 403', shots: [{ url: 'https://docs.acme.io/#/a', root: PAGE_A() }] });
  await assert.rejects(() => X.fetchDocPage({ url: URL_B }, hongCaHai, NOW));

  const chiNac1Hong = tiersOf({ fetchError: 'HTTP 403', shots: [{ url: URL_B, root: RICH() }] });
  const viaTab = await X.fetchDocPage({ url: URL_B }, chiNac1Hong, NOW);
  assert.match(viaTab.note, /nấc 1[^.]*?403/, `lý do của nấc 1 không có trong câu: ${viaTab.note}`);
  assert.equal(viaTab.note.includes('undefined'), false, `câu hiện ra mang chữ "undefined": ${viaTab.note}`);

  const chiNac2Hong = tiersOf({ fetched: (url) => ({ url, root: SHELL() }) });
  const viaFetch = await X.fetchDocPage({ url: URL_B }, chiNac2Hong, NOW);
  assert.match(viaFetch.note, new RegExp(`nấc 1 chỉ đọc được ${viaFetch.chars} ký tự`), viaFetch.note);
  assert.match(viaFetch.note, /nấc 2 không chốt được \(không có adapter tab ẩn\)/, viaFetch.note);
  assert.equal(viaFetch.note.includes('undefined'), false, `câu hiện ra mang chữ "undefined": ${viaFetch.note}`);
});
