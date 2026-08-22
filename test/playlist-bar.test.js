// Ticket 007 — thanh nổi trên trang playlist/kênh: bảng xác nhận, checkbox chọn lẻ, và **dọn**.
//
// Hai thứ file này canh, không thứ nào lộ ra bằng mắt trên một màn hình "chạy được":
//
//   1. **danh sách đã chọn ↔ danh sách đầy đủ** — hai mảng cùng kiểu đi vào cùng một hàm gửi.
//      Hoán vị vẫn cho một lần import trót lọt: "chọn 3 video" thành import cả 300, tiêu trọn
//      quota 50 nguồn của một notebook mà không có lỗi nào.
//   2. **trạng thái của playlist A còn sống trên trang playlist B** — YouTube là SPA, và
//      thanh nổi giữ ba thứ gắn với một playlist cụ thể: danh sách đã liệt kê, bảng xác nhận,
//      và những ô đã tick nằm rải trên thumbnail *của trang*. Đây là lần thứ ba repo gặp đúng
//      hình này (ticket 005, 006 — `WORKSPACE_PROTOCOL.md`), nên nó có test riêng: xoá
//      `controller.close()` trong `install` phải làm hai test dưới đây đỏ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/common/messages.js';
import '../src/youtube/selectors.js';
import '../src/youtube/bridge-protocol.js';
import '../src/youtube/srt.js';
import '../src/youtube/transcript.js';
import '../src/youtube/watch.js';
import '../src/youtube/playlist.js';
import '../src/youtube/playlist-bar.js';

const M = globalThis.NBLM_MESSAGES;
const PL = globalThis.NBLM_PLAYLIST;
const B = globalThis.NBLM_PLAYLIST_BAR;

const vid = (n) => `vid${String(n).padStart(8, '0')}`;

// ------------------------------------------------------------------ trang giả

/** Một dòng video đúng hình dạng trang playlist: ô thumbnail + link tiêu đề, href tương đối. */
const row = (n) => el('ytd-playlist-video-renderer', {}, [
  el('ytd-thumbnail', {}, [el('a', { id: 'thumbnail', href: `/watch?v=${vid(n)}&list=PLabc&index=${n}` })]),
  el('a', { id: 'video-title', href: `/watch?v=${vid(n)}` }, [`Video ${n}`]),
]);

function makeDoc(rows = []) {
  const rowsHost = el('div', { id: 'contents' }, rows);
  const body = el('body', {}, [
    el('ytd-playlist-header-renderer', {}, [el('h1', {}, ['Playlist X'])]),
    rowsHost,
  ]);
  const html = el('html', {}, [body]);
  const listeners = new Map();

  return {
    body,
    html,
    rowsHost,
    createElement: (tag) => el(tag),
    querySelector: (selector) => html.querySelector(selector),
    querySelectorAll: (selector) => html.querySelectorAll(selector),
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    /** Bắn một sự kiện điều hướng SPA, đúng như YouTube làm khi đổi trang mà không tải lại. */
    fire(type) {
      for (const handler of listeners.get(type) || []) handler({ type });
    },
  };
}

/** Phản hồi InnerTube tối giản — hình dạng đầy đủ đã có test riêng ở `test/playlist.test.js`. */
function page(ids, options = {}) {
  const contents = ids.map((n) => ({
    playlistVideoRenderer: {
      videoId: vid(n),
      title: { simpleText: `Video ${n}` },
      lengthSeconds: '3600',
      isPlayable: options.unavailable === n ? false : true,
    },
  }));
  return { metadata: { playlistMetadataRenderer: { title: options.title || 'Playlist X' } }, contents };
}

/** Cầu MAIN world giả: một trang cho mỗi playlistId đã khai. */
function fakeTab(pages, options = {}) {
  const sent = [];
  return {
    sent,
    async options() {
      return options.tabOptions || {};
    },
    async send(message) {
      sent.push(message);
      return { ok: true, result: { summary: 'Xong.' } };
    },
    bridge: {
      async request(_op, params) {
        const id = String(params.browseId || '').replace(/^VL/, '');
        if (!pages[id]) throw new Error(`kịch bản không có playlist ${id}`);
        return pages[id];
      },
    },
  };
}

const boxesOf = (doc) => Array.from(doc.querySelectorAll('*'))
  .filter((node) => String(node.getAttribute('id') || '').startsWith(B.CHECKBOX_PREFIX));

const textOf = (node) => node.textContent;

// ------------------------------------------------------------------ đọc trang

test('rowVideoId — đọc videoId từ link tương đối của dòng', () => {
  assert.equal(B.rowVideoId(row(1), {}), vid(1));
  assert.equal(B.rowVideoId(el('ytd-playlist-video-renderer', {}, []), {}), '');
});

test('absoluteUrl — link tương đối thành URL đầy đủ, link tuyệt đối giữ nguyên', () => {
  assert.equal(B.absoluteUrl('/watch?v=x'), 'https://www.youtube.com/watch?v=x');
  assert.equal(B.absoluteUrl('https://m.youtube.com/watch?v=x'), 'https://m.youtube.com/watch?v=x');
  assert.equal(B.absoluteUrl(''), '');
});

test('readPageTitle — đọc tên playlist trên trang', () => {
  assert.equal(B.readPageTitle(makeDoc(), {}), 'Playlist X');
});

test('readChannelId — đọc id kênh từ meta, rơi về canonical khi thiếu', () => {
  const withMeta = makeDoc();
  withMeta.body.append(el('meta', { itemprop: 'identifier', content: 'UCabc123' }));
  assert.equal(B.readChannelId(withMeta, {}), 'UCabc123');

  const withCanonical = makeDoc();
  withCanonical.body.append(el('link', { rel: 'canonical', href: 'https://www.youtube.com/channel/UCxyz789' }));
  assert.equal(B.readChannelId(withCanonical, {}), 'UCxyz789');

  assert.equal(B.readChannelId(makeDoc(), {}), '');
});

test('resolveTarget — trang kênh thành playlist "đã tải lên" của chính kênh ấy', () => {
  const doc = makeDoc();
  doc.body.append(el('meta', { itemprop: 'identifier', content: 'UCabc123' }));

  assert.deepEqual(B.resolveTarget('https://www.youtube.com/@handle/videos', doc, {}), {
    kind: 'channel', playlistId: 'UUabc123', channelId: 'UCabc123',
  });
  assert.equal(B.resolveTarget('https://www.youtube.com/playlist?list=WL', doc, {}).playlistId, 'WL');
  assert.equal(B.resolveTarget(`https://www.youtube.com/watch?v=${vid(1)}`, doc, {}), null);
  // Kênh mà chưa đọc được id thì chưa có thanh nổi — thà chưa hiện còn hơn hiện một thanh
  // nổi liệt kê nhầm playlist.
  assert.equal(B.resolveTarget('https://www.youtube.com/@handle', makeDoc(), {}), null);
});

// ------------------------------------------------------------------ bộ điều khiển

function controllerOn(doc, deps = {}) {
  const listed = [];
  const sent = [];
  const controller = B.createController({
    doc,
    root: doc,
    options: {},
    playlistId: 'PLabc',
    title: 'Playlist X',
    host: doc.body,
    list: deps.list || (async (playlistId) => {
      listed.push(playlistId);
      return { playlistId, title: 'Playlist X', pages: 1, complete: true, items: PL.readPlaylistPage(page([1, 2, 3])).items };
    }),
    send: deps.send || (async (items) => {
      sent.push(items);
      return { ok: true, result: { summary: 'Xong.' } };
    }),
  });
  return { controller, listed, sent };
}

test('thanh nổi — gắn đúng một checkbox cho mỗi dòng, gắn lại không sinh ô thứ hai', () => {
  const doc = makeDoc([row(1), row(2), row(3)]);
  const { controller } = controllerOn(doc);

  controller.mount();
  assert.equal(boxesOf(doc).length, 3);
  controller.mount();
  assert.equal(boxesOf(doc).length, 3, 'mỗi lượt điều hướng SPA thêm một ô nữa trên cùng một dòng');
  for (const box of boxesOf(doc)) assert.ok(box.getAttribute('id').startsWith(B.CHECKBOX_PREFIX));
});

test('thanh nổi — bấm checkbox đổi trạng thái chọn của đúng video ấy', () => {
  const doc = makeDoc([row(1), row(2)]);
  const { controller } = controllerOn(doc);
  controller.mount();

  const box = doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(2)}`);
  box.click();
  assert.deepEqual([...controller.state().selected], [vid(2)]);
  assert.equal(box.checked, true);

  box.click();
  assert.deepEqual([...controller.state().selected], []);
  assert.equal(box.checked, false);
});

test('thanh nổi — "Bỏ chọn hết" gỡ cả trạng thái lẫn dấu tick trên trang', () => {
  const doc = makeDoc([row(1), row(2)]);
  const { controller } = controllerOn(doc);
  controller.mount();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(1)}`).click();

  doc.querySelector(`#${B.CLEAR_ID}`).click();
  assert.equal(controller.state().selected.size, 0);
  for (const box of boxesOf(doc)) assert.equal(box.checked, false, 'ô vẫn tick trong khi trạng thái đã rỗng');
});

test('thanh nổi — bảng xác nhận hiện ra TRƯỚC khi có mục nào được import', async () => {
  const doc = makeDoc([row(1), row(2), row(3)]);
  const { controller, sent } = controllerOn(doc);
  controller.mount();

  await controller.list();
  const table = textOf(doc.querySelector(`#${B.TABLE_ID}`));
  assert.match(table, /3 video trong danh sách/);
  assert.match(table, /≈ 1 Nguồn/);
  assert.deepEqual(sent, [], 'không lượt import nào được gửi đi chỉ vì đã liệt kê');
});

test('thanh nổi — danh sách bị cắt ngắn phải hiện thành chữ, không im lặng', async () => {
  const doc = makeDoc();
  const { controller } = controllerOn(doc, {
    list: async () => ({ items: PL.readPlaylistPage(page([1])).items, pages: 200, complete: false, title: 'P' }),
  });
  controller.mount();
  await controller.list();
  assert.match(textOf(doc.querySelector(`#${B.TABLE_ID}`)), /CHƯA LẤY HẾT/);
});

test('thanh nổi — lỗi liệt kê hiện thành chữ, không thành một thanh nổi trống', async () => {
  const doc = makeDoc();
  const { controller } = controllerOn(doc, { list: async () => { throw new Error('cầu MAIN world chưa nạp'); } });
  controller.mount();
  await controller.list();
  assert.match(textOf(doc.querySelector(`#${B.STATUS_ID}`)), /cầu MAIN world chưa nạp/);
});

// ------------------------------ danh sách đã chọn ↔ danh sách đầy đủ

test('thanh nổi — "Import toàn bộ" gửi cả danh sách, "Import mục đã chọn" chỉ gửi phần đã tick', async () => {
  // Hai mảng cùng kiểu vào cùng một hàm gửi. Hoán vị vẫn ra một lần import chạy trót lọt —
  // hai assertion dưới đây là cái chết của nó.
  const doc = makeDoc([row(1), row(2), row(3)]);
  const { controller, sent } = controllerOn(doc);
  controller.mount();
  await controller.list();

  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(2)}`).click();
  await controller.importSelected();
  assert.deepEqual(sent.at(-1).map((i) => i.id), [vid(2)]);

  await controller.importAll();
  assert.deepEqual(sent.at(-1).map((i) => i.id), [vid(1), vid(2), vid(3)]);

  // Và hai lần gửi phải khác nhau thật: nếu chúng bằng nhau thì hai assertion trên chỉ đang
  // xác nhận cùng một danh sách hai lần.
  assert.notEqual(sent.at(-1).length, sent.at(-2).length);
});

test('thanh nổi — "Import mục đã chọn" tự liệt kê trước nếu chưa liệt kê', async () => {
  const doc = makeDoc([row(1), row(2)]);
  const { controller, listed, sent } = controllerOn(doc);
  controller.mount();

  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(1)}`).click();
  await controller.importSelected();
  assert.deepEqual(listed, ['PLabc']);
  assert.deepEqual(sent.at(-1).map((i) => i.id), [vid(1)]);
});

test('thanh nổi — mục đã tick mà không có trong playlist thì được NÓI RA, không lặng lẽ bớt', async () => {
  const doc = makeDoc([row(1), row(9)]);
  const { controller, sent } = controllerOn(doc);
  controller.mount();

  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(9)}`).click();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(1)}`).click();
  await controller.importSelected();

  assert.deepEqual(sent.at(-1).map((i) => i.id), [vid(1)]);
  assert.match(textOf(doc.querySelector(`#${B.STATUS_ID}`)), /không có trong danh sách playlist/);
});

test('thanh nổi — mục bỏ vì không có quyền xem không vào hàng đợi, và số bị bỏ được nói ra', async () => {
  const doc = makeDoc();
  const { controller, sent } = controllerOn(doc, {
    list: async () => ({
      items: PL.readPlaylistPage(page([1, 2, 3], { unavailable: 2 })).items,
      pages: 1, complete: true, title: 'Playlist X',
    }),
  });
  controller.mount();
  await controller.importAll();

  assert.deepEqual(sent.at(-1).map((i) => i.id), [vid(1), vid(3)]);
  assert.match(textOf(doc.querySelector(`#${B.STATUS_ID}`)), /bỏ 1 mục không có quyền xem/);
});

test('thanh nổi — Mục hàng đợi gửi đi mang Nguồn gộp khoá theo playlist, tên theo tiêu đề', async () => {
  const doc = makeDoc();
  const { controller, sent } = controllerOn(doc);
  controller.mount();
  await controller.importAll();

  for (const item of sent.at(-1)) {
    assert.deepEqual(item.group, { kind: 'playlist', key: 'playlist:PLabc', source: 'Playlist X' });
  }
});

// ------------------- mỗi con số đi cùng ĐÚNG nhãn của nó (chữ người dùng đọc)

/**
 * Con số đứng ngay **trước** một mảnh chữ. Neo là mảnh ngắn định danh được nhóm, không phải
 * cả câu: câu chữ còn sửa, và sửa câu không được làm test chết.
 */
function numberBefore(text, mark) {
  const at = String(text).search(mark);
  assert.notEqual(at, -1, `không có nhãn ${mark} trong: ${text}`);
  const numbers = String(text).slice(0, at).match(/\d+/g) || [];
  return Number(numbers.at(-1));
}

test('thanh nổi — dòng đếm: mỗi con số đi cùng đúng nhãn, và chỉ đổi khi nhóm của nó đổi', async () => {
  const doc = makeDoc([row(1), row(2), row(3)]);
  const { controller } = controllerOn(doc);
  controller.mount();
  await controller.list();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(2)}`).click();

  const read = () => textOf(doc.querySelector(`#${B.COUNT_ID}`));
  // 3 mục đã liệt kê, 1 đã chọn — hai con số phải khác nhau, nếu không hoán vị hai nhãn
  // không lộ ra ở đâu cả.
  assert.equal(numberBefore(read(), /mục đã liệt kê/), 3);
  assert.equal(numberBefore(read(), /đã chọn/), 1);

  // Vế quan hệ, không đọc một chữ nào của nhãn: tick thêm một ô chỉ được làm đổi con số của
  // "đã chọn". Nhãn đúng mà cắm nhầm biến vẫn cho một dòng đếm cộng đủ.
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(3)}`).click();
  assert.equal(numberBefore(read(), /mục đã liệt kê/), 3, 'tick một ô lại làm đổi số mục đã liệt kê');
  assert.equal(numberBefore(read(), /đã chọn/), 2);
});

test('thanh nổi — "đã liệt kê N mục qua M trang": hai con số không đổi chỗ cho nhau', async () => {
  const doc = makeDoc();
  const { controller } = controllerOn(doc, {
    list: async () => ({
      items: PL.readPlaylistPage(page([1, 2, 3])).items, pages: 2, complete: true, title: 'Playlist X',
    }),
  });
  controller.mount();
  await controller.list();

  // 3 mục qua 2 trang. Hoán vị hai con số vẫn cho một câu đọc được, và "liệt kê 2 mục qua 3
  // trang" là đúng cái người dùng cần thấy để biết mình chưa lấy hết.
  const status = textOf(doc.querySelector(`#${B.STATUS_ID}`));
  assert.equal(numberBefore(status, /mục/), 3);
  assert.equal(numberBefore(status, /trang/), 2);
});

test('thanh nổi — close() dọn CẢ danh sách lẫn ô đã tick, không dọn nửa vời', async () => {
  // `install` bỏ luôn bộ điều khiển sau `close()`, nên hai dòng dọn state ở đó chỉ có tác
  // dụng qua chính API này: đóng rồi treo lại phải ra một thanh nổi trắng, không phải thanh
  // nổi của playlist trước. Dọn một nửa vẫn cho một màn hình đọc được — đó là chỗ hở.
  const doc = makeDoc([row(1), row(2), row(3)]);
  const { controller } = controllerOn(doc);
  controller.mount();
  await controller.list();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(2)}`).click();
  assert.equal(controller.state().listed.length, 3);
  assert.equal(controller.state().selected.size, 1);

  controller.close();
  assert.equal(controller.state().listed.length, 0, 'danh sách đã liệt kê sống sót qua close()');
  assert.equal(controller.state().selected.size, 0, 'ô đã tick sống sót qua close()');
  assert.deepEqual(boxesOf(doc), []);

  controller.mount();
  for (const box of boxesOf(doc)) assert.equal(box.checked, false, 'ô tick cũ hiện lại sau khi treo lại');
});

test('thanh nổi — lượt liệt kê đang bay không chạm trang sau close() (đổi playlist giữa chừng)', async () => {
  // Liệt kê 300 video mất vài giây, và người dùng điều hướng SPA được giữa chừng. `close()`
  // dọn xong, nhưng lượt `deps.list()` cũ vẫn đang bay — và nó kết thúc bằng `mountCheckboxes()`
  // trên DOM *của trang*, tức trang playlist MỚI. Đây là cùng một hình với test trên, chỉ khác
  // ở chỗ thứ sống sót là một Promise chứ không phải một biến.
  const doc = makeDoc([row(1), row(2), row(3)]);
  let release;
  const inFlight = new Promise((resolve) => { release = resolve; });
  const a = controllerOn(doc, { list: async () => inFlight });
  a.controller.mount();
  const listing = a.controller.list();

  // YouTube đổi sang playlist B: `install` đóng A, dựng lại danh sách dòng, rồi treo B lên.
  a.controller.close();
  doc.rowsHost.querySelectorAll('ytd-playlist-video-renderer').forEach((node) => node.remove());
  doc.rowsHost.append(row(3));
  const b = controllerOn(doc, {
    list: async () => ({ items: PL.readPlaylistPage(page([3], { title: 'Playlist B' })).items, pages: 1, complete: true, title: 'Playlist B' }),
  });
  b.controller.mount();
  await b.controller.list();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(3)}`).click();
  assert.equal(b.controller.state().selected.size, 1);

  // Lượt liệt kê của playlist A về muộn.
  release({ items: PL.readPlaylistPage(page([1, 2, 3], { title: 'Playlist A' })).items, pages: 1, complete: true, title: 'Playlist A' });
  await listing;

  assert.equal(a.controller.state().listed.length, 0, 'danh sách playlist A hồi sinh sau close()');
  assert.equal(doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(3)}`).checked, true,
    'lượt liệt kê cũ gỡ tick ô của playlist B — người dùng thấy ô trắng trong khi state vẫn giữ nó');
  assert.deepEqual(boxesOf(doc).map((node) => node.getAttribute('id')), [`${B.CHECKBOX_PREFIX}${vid(3)}`],
    'lượt liệt kê của playlist A gắn thêm ô tick lên trang playlist B');
});

test('thanh nổi — "Import toàn bộ" khi liệt kê hỏng thì nói ra LÝ DO, không nói "không có mục nào"', async () => {
  // `importAll` gọi `list()` ngầm. Lỗi của lượt ấy in ra một lần rồi bị chính dòng trạng thái
  // kế tiếp đè lên — người dùng đọc được "playlist này không có gì import được" trong khi
  // thật ra lượt gọi mạng đã hỏng. Cùng loại nuốt tin mà `notes` sinh ra để chặn (ADR 0008).
  const doc = makeDoc([row(1)]);
  const { controller, sent } = controllerOn(doc, {
    list: async () => { throw new Error('cầu MAIN world không trả lời "listPlaylist" trong 8000ms'); },
  });
  controller.mount();
  await controller.importAll();

  assert.match(textOf(doc.querySelector(`#${B.STATUS_ID}`)), /không trả lời/,
    'lý do liệt kê hỏng bị dòng trạng thái sau đè mất');
  assert.deepEqual(sent, [], 'gửi một lượt import trong khi chưa liệt kê được gì');
});

test('thanh nổi — "Import mục đã chọn" xếp theo thứ tự PLAYLIST, không theo thứ tự bấm chuột', async () => {
  const doc = makeDoc([row(1), row(2), row(3)]);
  const { controller, sent } = controllerOn(doc);
  controller.mount();
  await controller.list();

  // Bấm ngược: video 3 trước, rồi video 1. Thứ tự đi vào hàng đợi quyết định nội dung Nguồn
  // gộp và ranh giới cắt "Phần N" (ADR 0002, 0005) — mà tên Nguồn không mang gì để phân biệt
  // hai kết quả (ADR 0010). Duyệt theo `Set` là duyệt theo thứ tự bấm chuột.
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(3)}`).click();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(1)}`).click();
  await controller.importSelected();

  assert.deepEqual(sent.at(-1).map((i) => i.id), [vid(1), vid(3)]);
});

// ------------------------------------------------------------------ dọn khi đổi trang

function installOn(doc, href, pages) {
  const tab = fakeTab(pages);
  const target = { document: doc, location: { href } };
  const bar = B.install(target, { tab });
  return { bar, tab, target };
}

test('install — thanh nổi chỉ mọc trên trang playlist/kênh, không mọc trên trang watch', async () => {
  const doc = makeDoc([row(1)]);
  const { bar, target } = installOn(doc, `https://www.youtube.com/watch?v=${vid(1)}`, { PLabc: page([1]) });
  await bar.sync();
  assert.equal(doc.querySelector(`#${B.BAR_ID}`), null);

  target.location.href = 'https://www.youtube.com/playlist?list=PLabc';
  await bar.sync();
  assert.ok(doc.querySelector(`#${B.BAR_ID}`), 'trang playlist phải có thanh nổi');
});

test('install — rời trang playlist thì thanh nổi và mọi ô tick biến mất theo', async () => {
  const doc = makeDoc([row(1), row(2)]);
  const { bar, target } = installOn(doc, 'https://www.youtube.com/playlist?list=PLabc', { PLabc: page([1, 2]) });
  await bar.sync();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(1)}`).click();
  assert.equal(boxesOf(doc).length, 2);

  target.location.href = `https://www.youtube.com/watch?v=${vid(1)}`;
  doc.fire('yt-navigate-finish');
  await bar.sync();

  assert.equal(doc.querySelector(`#${B.BAR_ID}`), null, 'thanh nổi của playlist còn treo trên trang watch');
  assert.deepEqual(boxesOf(doc), [], 'ô tick của playlist còn nằm trên trang watch');
});

test('install — đổi sang playlist khác thì danh sách và ô tick của playlist cũ bị dọn sạch', async () => {
  // Đây là hình đã lặp ba lần trong repo (`WORKSPACE_PROTOCOL.md`). Video 3 nằm trong **cả
  // hai** playlist, nên dòng của nó sống qua lần điều hướng — nếu không dọn, người dùng mở
  // playlist B và thấy nó đã tick sẵn, tick bởi một bộ điều khiển không còn tồn tại.
  const doc = makeDoc([row(1), row(2), row(3)]);
  const { bar, target } = installOn(doc, 'https://www.youtube.com/playlist?list=PLaaa', {
    PLaaa: page([1, 2, 3], { title: 'Playlist A' }),
    PLbbb: page([3, 4], { title: 'Playlist B' }),
  });

  const first = await bar.sync();
  await first.list();
  doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(3)}`).click();
  assert.equal(first.state().listed.length, 3);
  assert.equal(doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(3)}`).checked, true);

  // YouTube đổi playlist: dựng lại danh sách dòng, **không** tải lại trang.
  doc.rowsHost.querySelectorAll('ytd-playlist-video-renderer').forEach((node) => node.remove());
  doc.rowsHost.append(row(3));
  doc.rowsHost.append(row(4));
  target.location.href = 'https://www.youtube.com/playlist?list=PLbbb';
  doc.fire('yt-navigate-finish');
  const second = await bar.sync();

  assert.notEqual(second, first, 'bộ điều khiển của playlist A vẫn đang phục vụ playlist B');
  assert.equal(second.state().playlistId, 'PLbbb');
  assert.equal(second.state().listed.length, 0, 'danh sách của playlist A còn sống trên trang playlist B');
  assert.equal(second.state().selected.size, 0);
  assert.equal(doc.querySelector(`#${B.CHECKBOX_PREFIX}${vid(3)}`).checked, false,
    'ô tick của playlist A còn tick trên trang playlist B');
  assert.equal(doc.querySelectorAll(`#${B.BAR_ID}`).length, 1, 'hai thanh nổi chồng nhau trên một trang');
});

test('install — liệt kê đi qua cầu MAIN world và bảng xác nhận dựng từ chính kết quả ấy', async () => {
  const doc = makeDoc([row(1), row(2)]);
  const { bar } = installOn(doc, 'https://www.youtube.com/playlist?list=PLabc', {
    PLabc: page([1, 2], { title: 'Playlist thật' }),
  });
  const controller = await bar.sync();
  await controller.list();

  assert.match(textOf(doc.querySelector(`#${B.TABLE_ID}`)), /2 video trong danh sách/);
  assert.equal(controller.state().title, 'Playlist thật', 'tên Nguồn gộp phải theo tên InnerTube trả về');
});

test('install — bấm "Import toàn bộ" gửi đúng loại tin mà service worker đang nghe', async () => {
  const doc = makeDoc([row(1), row(2)]);
  const { bar, tab } = installOn(doc, 'https://www.youtube.com/playlist?list=PLabc', { PLabc: page([1, 2]) });
  const controller = await bar.sync();
  await controller.importAll();

  const message = tab.sent.at(-1);
  assert.equal(message.type, M.TYPES.IMPORT_VIDEO);
  assert.ok(M.isFor('background', message), 'tin không đi tới listener nào của service worker');
  assert.deepEqual(message.items.map((i) => i.id), [vid(1), vid(2)]);
});

test('install — hai sự kiện SPA bắn sát nhau vẫn chỉ ra một thanh nổi', async () => {
  const doc = makeDoc([row(1)]);
  const { bar } = installOn(doc, 'https://www.youtube.com/playlist?list=PLabc', { PLabc: page([1]) });
  doc.fire('yt-navigate-finish');
  doc.fire('yt-page-data-updated');
  await bar.sync();
  assert.equal(doc.querySelectorAll(`#${B.BAR_ID}`).length, 1);
});
