// Ticket 010 — đầu bên **tab tài liệu**: Bảng chọn được gọi ra, và hai nấc trích được nối vào
// `chrome.*` thật.
//
// Cùng khuôn `test/notebooklm.test.js`: kỷ luật định tuyến, và hai adapter được kiểm bằng một
// `window` giả. Thứ file này canh mà một lần trích "chạy được" không nói lên gì:
//
//   1. *Im lặng với tin không phải của mình.* Ba content script gặp nhau trên một tab; Chrome
//      lấy **phản hồi đến trước** (spec 0001).
//   2. *`read()` phải trả lời được TRƯỚC `go()`.* Đây là hợp đồng mà `src/docs/extract.js` viết
//      trong doc comment từ ticket 008 và tới ticket này mới có adapter thật để cưỡng chế. Với
//      docsify, `#/a → #/b` không tải lại trang: URL đổi trước DOM. Ảnh chụp **trước** lúc điều
//      hướng là mốc duy nhất phân biệt "trang mới chưa render" với "trang cũ đã đứng yên" — mà
//      chụp nó thì phải đọc được tab ẩn khi chưa đi đâu cả. Đảo hai lời gọi ấy vẫn cho một lần
//      trích "thành công", chỉ là Nguồn mang nội dung trang A dưới nhãn trang B.
//   3. *Bảng chọn dò sidebar bằng bề ngang cột.* Không đưa khung nhìn vào thì dấu hiệu ấy
//      **luôn** bằng 0 trên trang thật, và không test nào của ticket 009 thấy được — chúng tiêm
//      `metrics` của riêng chúng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/common/messages.js';
import '../src/docs/selectors.js';
import '../src/docs/markdown.js';
import '../src/docs/extract.js';
import '../src/docs/sidebar.js';
import '../src/docs/picker.js';
import '../src/docs/content.js';

const M = globalThis.NBLM_MESSAGES;
const C = globalThis.NBLM_DOCS_CONTENT;
const B = globalThis.NBLM_DOCS_SIDEBAR;

const PAGE = 'https://docs.acme.dev/guide/cai-dat';
const WANTED = 'https://docs.acme.dev/guide/nang-cao';

/** Trang docsify: khung giống nhau ở mọi route, chỉ `#main` đổi. */
const html = (heading, body) =>
  `<body><nav><a href="#/guide/cai-dat">Cài đặt</a></nav>`
  + `<main id="main"><h1>${heading}</h1><p>${body}</p></main></body>`;

/** Đoạn văn đủ dài để vượt `docsMinChars` — dưới ngưỡng là nấc 1 bị coi là mỏng. */
const fat = (word) => Array.from({ length: 200 }, () => word).join(' ');

/**
 * `DOMParser` tối giản trên cây giả: đủ cho đúng ba hình dạng HTML mà test này dựng.
 *
 * Cố ý **không** viết một bộ phân tích HTML thật: cây giả của repo là thước đo của cả suite
 * (`test/helpers/fake-dom.js`), và một bộ phân tích viết vội ở đây sẽ là thước đo thứ hai, lệch
 * khỏi cái thứ nhất mà không ai đối chiếu. Ở đây chỉ cần "chuỗi này thành cây nào".
 */
class FakeDOMParser {
  parseFromString(source) {
    const heading = /<h1>([^<]*)<\/h1>/.exec(source);
    const paragraph = /<p>([^<]*)<\/p>/.exec(source);
    return {
      body: el('body', {}, [
        el('nav', {}, [el('a', { href: '#/guide/cai-dat' }, ['Cài đặt'])]),
        el('main', { id: 'main' }, [
          el('h1', {}, [heading ? heading[1] : '']),
          el('p', {}, [paragraph ? paragraph[1] : '']),
        ]),
      ]),
    };
  }
}

/**
 * Tab ẩn giả do service worker lái, đúng hành vi docsify: `go()` đổi URL **ngay**, còn DOM thì
 * còn là trang cũ thêm `lag` lượt đọc nữa.
 */
function hiddenTab({ start, next, lag = 2 }) {
  const state = { url: start.url, html: start.html, lag: 0 };
  const order = [];
  return {
    order,
    reads: () => order.filter((entry) => entry === 'read').length,
    ask: async (message) => {
      if (M.typeOf(message) === M.TYPES.DOC_TAB_GO) {
        order.push('go');
        state.url = next.url;
        state.lag = lag;
        return { ok: true };
      }
      if (M.typeOf(message) === M.TYPES.DOC_TAB_READ) {
        order.push('read');
        const shot = { url: state.url, html: state.lag > 0 ? start.html : state.html };
        if (state.lag > 0) state.lag -= 1;
        else state.html = next.html;
        return { ok: true, result: shot };
      }
      return { ok: true };
    },
  };
}

/** `window` giả: đúng những thứ `src/docs/content.js` được phép dùng của nó. */
function fakeWindow({ page = PAGE, fetchImpl, ask, body, settings } = {}) {
  const listeners = [];
  const node = body || el('body', {}, [el('main', {}, [el('h1', {}, ['Cài đặt'])])]);
  return {
    listeners,
    location: { href: page },
    innerWidth: 1280,
    document: {
      body: node,
      createElement: (tag) => el(tag),
      querySelector: (selector) => node.querySelector(selector),
      querySelectorAll: (selector) => node.querySelectorAll(selector),
    },
    DOMParser: FakeDOMParser,
    fetch: fetchImpl || (async () => { throw new Error('không có mạng'); }),
    setTimeout: (fn) => fn(),
    addEventListener: () => {},
    chrome: {
      runtime: {
        sendMessage: ask || (async () => ({ ok: true })),
        onMessage: { addListener: (fn) => listeners.push(fn) },
      },
      storage: { sync: { get: async () => (settings ? { settings } : {}) } },
    },
  };
}

/** Nhịp chờ của nấc 2 rút ngắn: test không đo đồng hồ, chỉ đo thứ tự. */
const FAST = { settle: { tries: 12, stepMs: 0, stableRounds: 2 }, wait: async () => {} };

const install = (target, extra = {}) => C.install(target, { options: FAST, ...extra });

/**
 * Gửi `OPEN_DOC_PICKER` qua **đúng listener đã đăng ký** và chờ nó trả lời.
 *
 * Chờ chứ không gọi rồi đọc ngay: mở Bảng chọn phải đọc lại Cài đặt trước, nên nó là một lượt
 * async. Đọc kết quả ngay sau lời gọi là đọc trạng thái của lượt trước.
 */
const openPicker = (target) =>
  new Promise((resolve) => target.listeners[0]({ type: M.TYPES.OPEN_DOC_PICKER }, {}, resolve));

// ------------------------------------------------------------------ kỷ luật định tuyến

test('định tuyến — im lặng với tin không phải của mình, không trả lời thay listener khác', () => {
  const deps = { pageId: () => PAGE, openPicker: () => null, extractDoc: async () => ({}) };
  for (const type of [M.TYPES.PUSH_SOURCE, M.TYPES.EXTRACT_TRANSCRIPT, M.TYPES.GET_STATE, 'nblm-bia-dat']) {
    assert.equal(C.handleMessage({ type }, deps), undefined, type);
  }
  assert.notEqual(C.handleMessage({ type: M.TYPES.PING_DOCS }, deps), undefined);
});

test('định tuyến — mỗi loại tin của lớp tài liệu có đúng một listener nhận nó', () => {
  // `OPEN_DOC_PICKER` (service worker → tab) và `PICK_DOCS` (phím tắt → service worker) là hai
  // loại tin cho hai chiều của cùng một việc. Gộp làm một là để cả hai listener cùng nhận.
  for (const type of M.ACCEPTS.docs) {
    const owners = Object.keys(M.ACCEPTS).filter((script) => M.ACCEPTS[script].includes(type));
    assert.deepEqual(owners, ['docs'], `${type} có ${owners.length} listener`);
  }
  assert.ok(M.ACCEPTS.background.includes(M.TYPES.PICK_DOCS));
  assert.equal(M.ACCEPTS.docs.includes(M.TYPES.PICK_DOCS), false);
});

test('ping — trả lời kèm định danh trang đang mở, để service worker biết đã tiêm đúng tab', async () => {
  const answer = await C.handleMessage({ type: M.TYPES.PING_DOCS }, { pageId: () => PAGE });
  assert.deepEqual(answer, { ok: true, result: { page: PAGE } });
});

// ------------------------------------------------------------------ gọi Bảng chọn

test('Bảng chọn — tin OPEN_DOC_PICKER mở Bảng chọn và nói ra dò được bao nhiêu mục', async () => {
  const opened = [];
  const answer = await C.handleMessage({ type: M.TYPES.OPEN_DOC_PICKER }, {
    openPicker: () => { opened.push(1); return { state: () => ({ tree: { total: 7 }, outcome: 'ok' }) }; },
  });
  assert.equal(opened.length, 1);
  assert.deepEqual(answer, { ok: true, result: { pages: 7, outcome: 'ok' } });
});

test('Bảng chọn — trang không đọc được URL thì nói ra, không im lặng báo thành công', async () => {
  const answer = await C.handleMessage({ type: M.TYPES.OPEN_DOC_PICKER }, { openPicker: () => null });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /trang/i);
});

test('Bảng chọn — bề ngang khung nhìn được đưa vào, nếu không dấu hiệu "cột hẹp" luôn bằng 0', async () => {
  // `narrowness` trả 0 khi không đo được khung nhìn, nên thiếu chỗ này là một dấu hiệu chấm điểm
  // chết lặng trên **mọi** trang thật — trong khi mọi test của ticket 009 vẫn xanh vì chúng tiêm
  // `metrics` của riêng chúng.
  let given = null;
  const target = fakeWindow();
  install(target, { makeController: (deps) => { given = deps; return { open: () => {}, close: () => {} }; } });
  await openPicker(target);

  assert.ok(given, 'install phải dựng bộ điều khiển');
  assert.equal(given.options.metrics.viewport(), 1280);
});

/**
 * Sidebar kiểu VitePress: `<div>` lồng nhau, không một `<ul>` nào. Dò được nó **cần** ghi đè
 * `navList`/`navItem` — đúng thứ trang Cài đặt sinh ra để cho người dùng khai.
 */
function divSidebar() {
  const a = (href, text) => el('a', { href }, [text]);
  const entry = (kids) => el('div', { class: 'entry' }, kids);
  return el('body', {}, [
    el('aside', { class: 'sidebar' }, [
      el('nav', {}, [
        el('div', { class: 'group' }, [
          entry([a('/gioi-thieu', 'Giới thiệu')]),
          entry([
            a('/guide/', 'Hướng dẫn'),
            el('div', { class: 'group' }, [
              entry([a('/guide/cai-dat', 'Cài đặt')]),
              entry([a('/guide/cau-hinh', 'Cấu hình')]),
              entry([a('/guide/nang-cao', 'Nâng cao')]),
            ]),
          ]),
        ]),
      ]),
    ]),
    el('main', {}, [el('h1', {}, ['Cài đặt'])]),
  ]);
}

test('Bảng chọn — ghi đè selector của Cài đặt đi tới findSidebar, không dừng lại ở khâu trích', async () => {
  // Hai đường ra từ cùng một bộ Cài đặt: một cho khâu trích, một cho khâu dò sidebar. Chúng
  // cùng kiểu (đều là một object `options` mang `selectors` đã `resolve`), nên viết tay riêng
  // cho Bảng chọn một object thiếu vế `selectors` vẫn chạy trót lọt — `selectorsOf` của
  // `sidebar.js` lặng lẽ rơi về mặc định. Test này đi hết **đường đi** thay vì soi hình dạng
  // object: lấy đúng `options` mà bộ điều khiển nhận được rồi thả nó vào `readSidebar` thật.
  const target = fakeWindow({
    body: divSidebar(),
    settings: { selectorOverrides: { navList: ['div.group'], navItem: ['div.entry'] } },
  });
  let given = null;
  install(target, { makeController: (deps) => { given = deps; return { open: () => {}, close: () => {} }; } });
  await openPicker(target);

  const wired = B.readSidebar(target.document.body, PAGE, given.options);
  const bare = B.readSidebar(target.document.body, PAGE, {});
  assert.equal(wired.via, 'lists', 'ghi đè không tới nơi: sidebar vẫn phải đọc theo lối xếp phẳng');
  assert.equal(bare.via, 'flat', 'đối chứng hỏng: mặc định mà đã dò được thì test trên đo một thứ luôn đúng');

  // Hậu quả thật của việc ghi đè không tới nơi không phải "thiếu selector" mà là **ranh giới
  // Nhánh** (ADR 0005): đọc theo lối xếp phẳng thì "Hướng dẫn" không còn là cha của ba trang
  // con, nên tick cả nhánh ra bốn Nguồn thay vì một — mà lượt import vẫn chạy trót lọt.
  const guide = (tree) => B.flatten(tree.nodes).filter((node) => node.url && node.url.includes('/guide'));
  const branchesFor = (tree) => {
    const chosen = new Set(guide(tree).map((node) => node.id));
    const map = B.branchesOf(tree.nodes, (node) => chosen.has(node.id));
    return new Set([...map.values()].map((node) => node.label));
  };
  assert.deepEqual([...branchesFor(wired)], ['Hướng dẫn']);
  assert.equal(branchesFor(bare).size, 4, 'đối chứng: mặc định cắt cùng một nhánh thành bốn Nguồn');
});

test('Bảng chọn — nút Import gửi tin IMPORT_DOCS kèm trang đang mở, không gửi trống', async () => {
  const sent = [];
  const target = fakeWindow({ ask: async (message) => { sent.push(message); return { ok: true }; } });
  let given = null;
  install(target, { makeController: (deps) => { given = deps; return { open: () => {}, close: () => {} }; } });
  await openPicker(target);

  await given.send([{ url: `${PAGE}#/a`, title: 'A', branch: 'Hướng dẫn' }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, M.TYPES.IMPORT_DOCS);
  assert.equal(sent[0].page, PAGE, 'thiếu trang đang mở thì hàng đợi không biết tên site');
  assert.deepEqual(sent[0].pages.map((p) => p.branch), ['Hướng dẫn']);
});

// ------------------------------------------------------------------ nấc 1

test('nấc 1 — fetch mang cookie phiên, và nội dung gắn URL mà máy chủ TRẢ VỀ', async () => {
  const calls = [];
  const target = fakeWindow({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, url, text: async () => html('Nâng cao', fat('sâu')) };
    },
  });
  const deps = install(target);
  const page = await deps.extractDoc(WANTED);

  assert.equal(calls[0].url, WANTED);
  assert.equal(calls[0].options.credentials, 'same-origin', 'docs nội bộ cần đăng nhập thì mới đọc được');
  assert.equal(page.via, 'fetch');
  assert.equal(page.escalated, false);
  assert.match(page.markdown, /Nâng cao/);
});

test('nấc 1 — máy chủ trả lỗi thì KHÔNG được coi là một trang rỗng hợp lệ', async () => {
  const target = fakeWindow({
    fetchImpl: async () => ({ ok: false, status: 404, url: WANTED, text: async () => '' }),
  });
  const deps = install(target);
  await assert.rejects(() => deps.extractDoc(WANTED), /404/);
});

// ------------------------------------- nấc 2: read() phải trả lời được TRƯỚC go()

test('nấc 2 — đọc tab ẩn TRƯỚC khi điều hướng, nếu không mốc "trang cũ" không tồn tại', async () => {
  const tab = hiddenTab({
    start: { url: PAGE, html: html('Cài đặt', fat('cu')) },
    next: { url: WANTED, html: html('Nâng cao', fat('moi')) },
  });
  const target = fakeWindow({
    // Nấc 1 trả về cái khung rỗng của một trang render bằng JS — đúng lý do nấc 2 tồn tại.
    fetchImpl: async (url) => ({ ok: true, status: 200, url, text: async () => html('', '') }),
    ask: tab.ask,
  });

  const page = await install(target).extractDoc(WANTED);

  assert.equal(tab.order[0], 'read', `lời gọi đầu tiên là "${tab.order[0]}" — mốc trang cũ mất`);
  assert.equal(tab.order[1], 'go');
  assert.equal(page.via, 'tab');
  assert.equal(page.escalated, true);
  // Và nội dung phải là của trang MỚI: đây là điều mà mốc kia mua được.
  assert.match(page.markdown, /Nâng cao/);
  assert.equal(/Cài đặt/.test(page.markdown), false, 'Nguồn mang nội dung trang cũ dưới nhãn trang mới');
});

test('nấc 2 — bỏ lượt đọc trước khi đi thì nội dung trang CŨ đi lọt (hợp đồng này canh gì)', async () => {
  // Kiểm ngược chính hợp đồng trên: dựng đúng một adapter đảo thứ tự, rồi cho `readViaTab` chạy
  // trên nó. Nếu test ở trên chưa từng thấy đỏ thì nó chưa biết mình canh gì.
  const X = globalThis.NBLM_DOCS_EXTRACT;
  const tab = hiddenTab({
    start: { url: PAGE, html: html('Cài đặt', fat('cu')) },
    next: { url: WANTED, html: html('Nâng cao', fat('moi')) },
    lag: 4,
  });
  const target = fakeWindow({ ask: tab.ask });
  const honest = C.hiddenTabTier(target, tab.ask);
  let went = false;
  const reversed = {
    read: async () => {
      // Đi trước, đọc sau — đúng cái lỗi mà hợp đồng cấm.
      if (!went) { went = true; await honest.go(WANTED); }
      return honest.read();
    },
    go: async () => {},
  };

  const shot = await X.readViaTab(WANTED, reversed, FAST);
  const stale = C.hiddenTabTier(target, tab.ask);
  assert.ok(stale, 'adapter thật vẫn phải dựng được');
  assert.match(shot.root.textContent, /Cài đặt/, 'đảo thứ tự thì nội dung trang cũ chốt được');
});

test('nấc 2 — tab ẩn hỏng thì trang mỏng vẫn về, kèm CÂU nói vì sao nó mỏng', async () => {
  // Không nấc nào được ném lỗi một mình (`extract.js`): một Nguồn mỏng vì trang render bằng JS
  // trông y hệt một Nguồn mỏng vì trang mỏng thật, nên lý do của cả hai nấc phải đi cùng kết quả.
  const target = fakeWindow({
    fetchImpl: async (url) => ({ ok: true, status: 200, url, text: async () => html('Nâng cao', 'mỏng') }),
    ask: async () => ({ ok: false, error: 'tab ẩn đã bị đóng' }),
  });
  const page = await install(target).extractDoc(WANTED);

  assert.equal(page.via, 'fetch');
  assert.equal(page.escalated, true, 'nấc 1 dưới ngưỡng thì phải có leo nấc, dù nấc 2 hỏng');
  assert.match(page.note, /tab ẩn đã bị đóng/);
  assert.match(page.note, /thiếu nội dung/);
});

test('nấc 2 — cả hai nấc hỏng thì ném, và câu lỗi kể tên CẢ HAI lý do', async () => {
  const target = fakeWindow({
    fetchImpl: async () => { throw new Error('mất mạng'); },
    ask: async () => ({ ok: false, error: 'tab ẩn đã bị đóng' }),
  });
  await assert.rejects(() => install(target).extractDoc(WANTED), (error) => {
    assert.match(error.message, /mất mạng/);
    assert.match(error.message, /tab ẩn đã bị đóng/);
    return true;
  });
});
