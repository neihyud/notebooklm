// Panel transcript trên trang watch (ticket 006) — Seam 3: module nhận cây node, trả dữ liệu.
//
// Phần thuần của panel là phần có test: khớp tìm kiếm, dựng danh sách dòng, tính dòng nào
// đang phát. Phần chạm `document` chỉ còn là vẽ lại từ dữ liệu ấy, và cũng kiểm được ở đây
// bằng cây giả (`test/helpers/fake-dom.js`).
//
// Ba cặp cùng kiểu mà panel này đụng tới, và test nào chết khi hoán vị:
//   1. `start` ↔ `end` của một dòng — mốc hiện ra sai chỗ, và dòng đang phát nhảy lệch một
//      dòng: `buildLines — end của dòng…` và `activeIndex — …` chết.
//   2. `currentTime` của player ↔ `start` của dòng đang phát — cả hai đều là số giây và panel
//      vẫn "chạy được": `bấm mốc thì video nhảy tới start của dòng…` chết (dữ liệu cố ý lệch
//      nhau: video đang ở 99 giây, dòng bấm vào bắt đầu ở 30).
//   3. chỉ số **trong danh sách đã lọc** ↔ chỉ số **gốc** của dòng — sau khi gõ tìm kiếm,
//      bấm mốc nhảy sang đoạn khác hẳn: `lọc rồi bấm mốc thì vẫn nhảy đúng dòng gốc` chết.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, evt } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/common/messages.js';
import '../src/youtube/selectors.js';
import '../src/youtube/srt.js';
import '../src/youtube/transcript.js';
import '../src/youtube/watch.js';
import '../src/youtube/panel.js';

const S = globalThis.NBLM_SHARED;
const F = globalThis.NBLM_TRANSCRIPT_FORMAT;
const T = globalThis.NBLM_TRANSCRIPT;
const P = globalThis.NBLM_PANEL;

/** `document` giả: đúng những thứ panel.js được phép dùng của nó. */
const fakeDoc = (root_) => ({
  createElement: (tag) => el(tag),
  querySelector: (selector) => root_.querySelector(selector),
  querySelectorAll: (selector) => root_.querySelectorAll(selector),
});

const SEGMENTS = [
  { start: 0, text: 'Xin chào các bạn' },
  { start: 5, text: 'Hôm nay ta nói về nguồn dữ liệu' },
  { start: 30, text: 'Café Ñandú là một quán ở Đà Lạt' },
  { start: 40, text: 'Đóng lại và hẹn gặp lại' },
];

const META = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Học Rust trong 30 phút',
  channel: 'Kênh Lập Trình',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  privacy: 'private',
  durationSeconds: 1800,
};

/** Trang watch tối giản: cột phải để panel đứng, thẻ video của player, hàng nút Like/Share. */
function watchPage() {
  return el('div', { id: 'page' }, [
    el('div', { id: 'primary' }, [
      el('div', { id: 'player' }, [el('video', { class: 'html5-main-video' })]),
      el('ytd-watch-metadata', {}, [
        el('h1', {}, ['Học Rust trong 30 phút']),
        el('div', { id: 'top-level-buttons-computed' }, [
          el('ytd-button-renderer', {}, [el('button', { 'aria-label': 'Thích' }, ['Thích'])]),
        ]),
      ]),
    ]),
    el('div', { id: 'secondary' }, [el('div', { id: 'related' }, [])]),
  ]);
}

/** Bộ điều khiển panel gắn vào một trang giả, với mọi lối ra là adapter ghi lại được. */
function mounted(options = {}) {
  const page = options.page || watchPage();
  const doc = fakeDoc(page);
  const copied = [];
  const saved = [];
  const controller = P.createController({
    doc,
    root: page,
    extract: options.extract || (async () => ({ meta: META, segments: SEGMENTS })),
    clipboard: { writeText: async (text) => { copied.push(text); } },
    download: (file) => { saved.push(file); },
    options: options.options || {},
  });
  return { page, doc, controller, copied, saved };
}

/**
 * Cửa sổ giả cho `install`: đủ để panel tự cài vào trang và nghe sự kiện điều hướng SPA của
 * YouTube, không hơn. `fire` bắn một sự kiện đúng như trang thật bắn.
 */
function fakeWindow(page) {
  const listeners = new Map();
  const doc = {
    body: page,
    createElement: (tag) => el(tag),
    querySelector: (selector) => page.querySelector(selector),
    querySelectorAll: (selector) => page.querySelectorAll(selector),
    addEventListener: (type, handler) => {
      const list = listeners.get(String(type)) || [];
      list.push(handler);
      listeners.set(String(type), list);
    },
  };
  return {
    document: doc,
    navigator: { clipboard: { writeText: async () => {} } },
    fire: (type) => {
      for (const handler of listeners.get(String(type)) || []) handler({ type });
    },
  };
}

/** Tab giả: đúng bề mặt mà `install` dùng của `W.createTab`. */
function fakeTab(segmentsOf) {
  let turn = 0;
  return {
    options: async () => ({}),
    extract: async () => {
      turn += 1;
      return segmentsOf(turn);
    },
  };
}

const rowsOf = (controller) => Array.from(controller.nodes.list.children);
const stampOf = (row) => S.collapse(row.querySelector('button').textContent);
const textOf = (row) => S.collapse(row.children[1].textContent);

// ------------------------------------------------------------------ khớp tìm kiếm

test('matchesQuery — gõ "nguon" khớp dòng chứa "nguồn"', () => {
  assert.equal(P.matchesQuery('Hôm nay ta nói về nguồn dữ liệu', 'nguon'), true);
});

test('matchesQuery — bỏ dấu hai chiều: gõ có dấu vẫn khớp dòng viết không dấu', () => {
  assert.equal(P.matchesQuery('Hom nay ta noi ve nguon du lieu', 'nguồn'), true);
  assert.equal(P.matchesQuery('Hôm nay ta nói về nguồn dữ liệu', 'nguồn'), true);
});

test('matchesQuery — "d" của "đ" cũng bỏ dấu: gõ "dong" khớp "Đóng"', () => {
  assert.equal(P.matchesQuery('Đóng lại và hẹn gặp lại', 'dong'), true);
});

test('matchesQuery — bỏ dấu bằng NFD chứ không bằng bảng tra tay tiếng Việt', () => {
  // Ba chữ này không có trong bất kỳ bảng tra tiếng Việt nào; `normalize('NFD')` xử lý được
  // cả ba. Test này đỏ đúng vào lúc ai đó thay `deaccent` bằng một bảng chép tay.
  assert.equal(P.matchesQuery('Café Ñandú là một quán ở Đà Lạt', 'cafe nandu'), true);
  assert.equal(P.matchesQuery('Straßburg và Öland', 'oland'), true);
});

test('matchesQuery — không đối xứng: câu tìm dài hơn dòng thì KHÔNG khớp', () => {
  // Hoán vị hai vế (`query.includes(text)` thay vì `text.includes(query)`) chết ở đây: mọi
  // dòng ngắn sẽ khớp mọi câu tìm dài, và panel "vẫn chạy" với một danh sách sai.
  assert.equal(P.matchesQuery('nguồn', 'nguồn dữ liệu của video'), false);
  assert.equal(P.matchesQuery('Hôm nay ta nói về nguồn dữ liệu', 'nguon'), true);
});

test('matchesQuery — câu tìm rỗng khớp mọi dòng, không lọc sạch danh sách', () => {
  assert.equal(P.matchesQuery('bất kỳ dòng nào', ''), true);
  assert.equal(P.matchesQuery('bất kỳ dòng nào', '   '), true);
});

// ------------------------------------------------------------------ dựng danh sách dòng

test('buildLines — mỗi dòng giữ chỉ số gốc, mốc lấy từ start chứ không từ end', () => {
  const lines = P.buildLines(SEGMENTS);
  assert.deepEqual(lines.map((l) => l.index), [0, 1, 2, 3]);
  assert.deepEqual(lines.map((l) => l.stamp), ['[00:00]', '[00:05]', '[00:30]', '[00:40]']);
  assert.equal(lines[1].start, 5);
  assert.equal(lines[1].text, 'Hôm nay ta nói về nguồn dữ liệu');
});

test('buildLines — end của một dòng là start của dòng kế, không phải start của chính nó', () => {
  // Hoán vị `start` ↔ `end` chết ở đây: dòng nào cũng thành cue dài 0 giây, và dòng đang phát
  // không bao giờ tìm ra.
  const lines = P.buildLines(SEGMENTS);
  assert.deepEqual(lines.map((l) => [l.start, l.end]), [
    [0, 5], [5, 30], [30, 40], [40, 40 + F.DEFAULT_CUE_SECONDS],
  ]);
  for (const line of lines) assert.ok(line.end > line.start, `${line.stamp} có end không lớn hơn start`);
});

test('buildLines — dòng rỗng bị loại, chỉ số gốc đánh theo dòng thật sự hiện ra', () => {
  const lines = P.buildLines([
    { start: 0, text: 'một' },
    { start: 2, text: '   ' },
    { start: 4, text: 'hai' },
  ]);
  assert.deepEqual(lines.map((l) => [l.index, l.text]), [[0, 'một'], [1, 'hai']]);
});

test('buildLines — panel KHÔNG gộp theo cửa sổ 30 giây như thân Nguồn', () => {
  // Gộp là chuyện của `.md` (`mergeWindowSeconds`); panel gộp là mất chỗ để bấm nhảy đoạn.
  assert.equal(P.buildLines(SEGMENTS).length, SEGMENTS.length);
});

// ------------------------------------------------------------------ dòng đang phát

test('activeIndex — mốc đang phát nằm trong [start, end) của đúng dòng đó', () => {
  const lines = P.buildLines(SEGMENTS);
  assert.equal(P.activeIndex(lines, 6), 1);
  assert.equal(P.activeIndex(lines, 29.9), 1);
  assert.equal(P.activeIndex(lines, 30), 2);
  assert.equal(P.activeIndex(lines, 0), 0);
});

test('activeIndex — chưa tới dòng đầu, hoặc đã qua dòng cuối, thì không dòng nào sáng', () => {
  const lines = P.buildLines([{ start: 10, text: 'muộn' }]);
  assert.equal(P.activeIndex(lines, 0), -1);
  assert.equal(P.activeIndex(lines, 9.9), -1);
  assert.equal(P.activeIndex(lines, 10), 0);
  assert.equal(P.activeIndex(lines, 10 + F.DEFAULT_CUE_SECONDS), -1);
  assert.equal(P.activeIndex([], 5), -1);
});

test('activeIndex — mốc không đọc được không làm sáng bừa dòng đầu', () => {
  const lines = P.buildLines(SEGMENTS);
  for (const bad of [null, undefined, NaN, 'abc']) assert.equal(P.activeIndex(lines, bad), -1, String(bad));
});

// ------------------------------------------------------------------ lọc

test('filterLines — dòng lọc ra vẫn mang chỉ số gốc của nó', () => {
  const lines = P.buildLines(SEGMENTS);
  const visible = P.filterLines(lines, 'cafe');
  assert.equal(visible.length, 1);
  assert.equal(visible[0].index, 2);
  assert.equal(visible[0].start, 30);
});

test('buildView — gộp lọc và dòng đang phát: active là chỉ số gốc, không phải vị trí sau lọc', () => {
  const lines = P.buildLines(SEGMENTS);
  const view = P.buildView(lines, { query: 'cafe', currentTime: 32 });
  assert.equal(view.shown, 1);
  assert.equal(view.total, 4);
  assert.equal(view.active, 2, 'dòng đang phát phải là chỉ số gốc trong `lines`');
  assert.equal(view.visible[0].index, 2);
});

// ------------------------------------------------------------------ nhảy đoạn

test('seekTo — đặt currentTime của thẻ video, không đụng tới location của trang', () => {
  const page = watchPage();
  const video = P.findVideo(page, {});
  // Chốt rằng đó **là** thẻ video của player, không phải một khối nào khác trên trang: lấy
  // nhầm nhóm selector vẫn cho một node đặt `currentTime` lên được, và mọi test bấm mốc đi
  // qua chính `findVideo` sẽ tự khép kín quanh cái sai đó.
  assert.equal(video, page.querySelector('video'), 'findVideo phải trả đúng thẻ <video> của player');
  assert.equal(video.tagName, 'VIDEO');
  video.currentTime = 99;
  assert.equal(P.seekTo(video, 30), true);
  assert.equal(video.currentTime, 30);
  assert.equal(P.seekTo(null, 30), false, 'chưa có player thì nói không, không ném lỗi');
});

test('findVideo — bỏ qua thẻ video nằm trong giao diện của chính extension', () => {
  const page = watchPage();
  const own = el('div', { id: `${S.EXT_PREFIX}xem-truoc` }, [el('video', {})]);
  page.append(own);
  assert.equal(P.findVideo(page, {}).closest(`[id^="${S.EXT_PREFIX}"]`), null);
});

// ------------------------------------------------------------------ panel dựng trên trang

test('panel — mở panel thì trích một lần rồi vẽ đủ số dòng vào cột phải', async () => {
  const calls = [];
  const { page, controller } = mounted({
    extract: async () => { calls.push('trích'); return { meta: META, segments: SEGMENTS }; },
  });
  await controller.open();

  assert.deepEqual(calls, ['trích'], 'panel phải ăn transcript từ đường trích đã có, đúng một lượt');
  assert.equal(rowsOf(controller).length, SEGMENTS.length);
  assert.equal(controller.nodes.root.closest('#secondary').getAttribute('id'), 'secondary');
  assert.equal(page.querySelectorAll(`[id^="${S.EXT_PREFIX}"]`).length > 0, true);
});

test('panel — mở lần thứ hai không trích lại: transcript đã có thì chỉ hiện lại', async () => {
  const calls = [];
  const { controller } = mounted({
    extract: async () => { calls.push('trích'); return { meta: META, segments: SEGMENTS }; },
  });
  await controller.open();
  await controller.open();
  assert.deepEqual(calls, ['trích']);
});

test('panel — video private vẫn chạy: không đường nào hỏi timedtext, chỉ dùng segment nhận được', async () => {
  const { controller } = mounted({
    extract: async () => ({ meta: { ...META, privacy: 'private' }, segments: SEGMENTS }),
  });
  await controller.open();
  assert.equal(rowsOf(controller).length, SEGMENTS.length);
  assert.equal(controller.state().meta.privacy, 'private');
});

test('panel — trích hỏng thì nói ra lý do, không im lặng để một danh sách rỗng', async () => {
  const { controller } = mounted({
    extract: async () => { throw new Error('cửa sổ quá hẹp: YouTube giữ panel ở trạng thái ẩn'); },
  });
  await controller.open();
  assert.match(S.collapse(controller.nodes.status.textContent), /cửa sổ quá hẹp/);
  assert.equal(rowsOf(controller).length, 0);
});

test('panel — gõ vào ô tìm kiếm thì danh sách lọc lại ngay, xoá đi thì đủ trở lại', async () => {
  const { controller } = mounted();
  await controller.open();

  controller.nodes.search.value = 'nguon';
  controller.nodes.search.dispatchEvent(evt('input'));
  assert.deepEqual(rowsOf(controller).map(textOf), ['Hôm nay ta nói về nguồn dữ liệu']);

  controller.nodes.search.value = '';
  controller.nodes.search.dispatchEvent(evt('input'));
  assert.equal(rowsOf(controller).length, SEGMENTS.length);
});

test('panel — bấm mốc thì video nhảy tới start của dòng đó, không phải mốc đang phát', async () => {
  const { page, controller } = mounted();
  await controller.open();
  const video = page.querySelector('video');
  video.currentTime = 99;

  rowsOf(controller)[2].querySelector('button').dispatchEvent(evt('click'));
  assert.equal(video.currentTime, 30, 'phải là start của dòng vừa bấm (30), không phải 99 của player');
});

test('panel — lọc rồi bấm mốc thì vẫn nhảy đúng dòng gốc, không nhảy theo vị trí sau lọc', async () => {
  const { page, controller } = mounted();
  await controller.open();
  const video = page.querySelector('video');
  video.currentTime = 0;

  controller.nodes.search.value = 'cafe';
  controller.nodes.search.dispatchEvent(evt('input'));
  const rows = rowsOf(controller);
  assert.equal(rows.length, 1);
  rows[0].querySelector('button').dispatchEvent(evt('click'));

  // Dòng ấy là dòng gốc số 2 (start 30). Lấy nhầm vị trí sau lọc (0) là nhảy về đầu video.
  assert.equal(video.currentTime, 30);
  assert.equal(stampOf(rows[0]), '[00:30]');
});

test('panel — dòng đang phát được đánh dấu theo currentTime của player, và chỉ một dòng', async () => {
  const { page, controller } = mounted();
  await controller.open();
  const video = page.querySelector('video');

  video.currentTime = 32;
  controller.tick();
  const marked = rowsOf(controller).filter((row) => row.getAttribute('aria-current') === 'true');
  assert.equal(marked.length, 1);
  assert.equal(stampOf(marked[0]), '[00:30]');

  video.currentTime = 6;
  controller.tick();
  const again = rowsOf(controller).filter((row) => row.getAttribute('aria-current') === 'true');
  assert.deepEqual(again.map(stampOf), ['[00:05]']);
});

// ------------------------------------------------------------------ sao chép và tải về

test('panel — sao chép đưa đúng thân Nguồn `.md` vào clipboard, kèm header ngữ cảnh', async () => {
  const { controller, copied } = mounted();
  await controller.open();
  await controller.copy();

  assert.equal(copied.length, 1);
  assert.match(copied[0], /^# Học Rust trong 30 phút\n/);
  assert.match(copied[0], /- Kênh: Kênh Lập Trình/);
  assert.match(copied[0], /\[00:00\] Xin chào các bạn/);
});

test('panel — ba nút tải cho ba định dạng, mỗi nút ra đúng đuôi file và đúng thân file', async () => {
  const { controller, saved } = mounted();
  await controller.open();

  for (const format of F.FORMATS) controller.save(format);
  assert.deepEqual(saved.map((f) => f.format), ['md', 'srt', 'vtt']);

  const [md, srt, vtt] = saved;
  assert.ok(md.filename.endsWith('.md'), md.filename);
  assert.ok(srt.filename.endsWith('.srt'), srt.filename);
  assert.ok(vtt.filename.endsWith('.vtt'), vtt.filename);
  assert.ok(md.filename.includes(META.videoId), 'tên file phải mang videoId');

  assert.match(md.text, /^# Học Rust trong 30 phút/);
  assert.match(srt.text, /^1\n00:00:00,000 --> 00:00:05,000\n/);
  assert.match(vtt.text, /^WEBVTT\n\n00:00:00\.000 --> 00:00:05\.000\n/);
  assert.equal(srt.mime, F.MIME.srt);
  assert.equal(vtt.mime, F.MIME.vtt);
});

test('panel — mỗi nút tải nối đúng định dạng của nó: bấm ".srt" không ra .vtt', async () => {
  // Ba nút cùng kiểu đứng cạnh nhau; hoán vị hai nút bất kỳ vẫn cho một panel tải được file
  // hợp lệ, chỉ là không phải file người dùng vừa bấm.
  const { page, controller, saved } = mounted();
  await controller.open();
  for (const format of F.FORMATS) {
    page.querySelector(`#${P.SAVE_IDS[format]}`).dispatchEvent(evt('click'));
  }
  assert.deepEqual(saved.map((f) => f.format), [...F.FORMATS]);
  for (const file of saved) assert.ok(file.filename.endsWith(`.${file.format}`), file.filename);

  // Id, nhãn và định dạng của cùng một nút phải nói cùng một chữ. Hoán vị hai ô trong bảng
  // `SAVE_IDS` không làm hỏng lần tải nào — nó chỉ làm nút `.srt` mang id của `.vtt`, và một
  // test tra id bằng chính bảng ấy thì không bao giờ thấy.
  for (const format of F.FORMATS) {
    const button = page.querySelector(`#${P.SAVE_IDS[format]}`);
    assert.equal(S.collapse(button.textContent), `.${format}`, `nút #${P.SAVE_IDS[format]} mang nhãn khác`);
    assert.ok(P.SAVE_IDS[format].endsWith(format), P.SAVE_IDS[format]);
  }
});

test('panel — tải về đi qua data URL của chính tab, không qua chrome.downloads', async () => {
  const { controller, saved } = mounted();
  await controller.open();
  controller.save('srt');
  assert.ok(saved[0].url.startsWith(`data:${F.MIME.srt};charset=utf-8,`), saved[0].url.slice(0, 60));
});

test('panel — dòng trạng thái thay chữ chứ không nối thêm chữ vào chữ cũ', async () => {
  // `children` không thấy text node: append thẳng vào `<p>` là mọi thông báo nối đuôi nhau,
  // và `assert.match` trên một chuỗi ngày càng dài vẫn xanh mãi.
  const { controller } = mounted();
  await controller.open();
  const afterOpen = S.collapse(controller.nodes.status.textContent);
  assert.equal(afterOpen, `${SEGMENTS.length} dòng`, afterOpen);

  controller.nodes.search.value = 'cafe';
  controller.nodes.search.dispatchEvent(evt('input'));
  const afterSearch = S.collapse(controller.nodes.status.textContent);
  assert.equal(afterSearch, `1/${SEGMENTS.length} dòng khớp "cafe"`, afterSearch);
  // Cả nội dung lẫn hình dạng: một dòng trạng thái tích chữ sẽ có nhiều hơn một node con.
  assert.equal(controller.nodes.status.childNodes.length, 1, 'dòng trạng thái đang giữ lại chữ cũ');
});

test('panel — bản .md tải từ panel gộp theo đúng mergeWindowSeconds của Cài đặt', async () => {
  // Cùng một video, hai lối ra `.md` (Bản lưu của hàng đợi và nút tải của panel) phải cho
  // cùng một file. Bỏ qua Cài đặt ở một lối là hai file cùng tên khác nội dung.
  const { controller, saved } = mounted({ options: { mergeWindowSeconds: 60 } });
  await controller.open();
  controller.save('md');
  assert.equal(saved[0].text, F.render('md', META, SEGMENTS, { mergeWindowSeconds: 60 }).text);
  assert.equal(saved[0].text.includes('[00:05]'), false, 'cửa sổ 60 giây phải gộp dòng 00:05 vào dòng 00:00');
});

test('panel — chưa trích được thì nút tải không ghi ra file rỗng', async () => {
  const { controller, saved, copied } = mounted({
    extract: async () => { throw new Error('không lấy được transcript'); },
  });
  await controller.open();
  controller.save('md');
  await controller.copy();
  assert.deepEqual(saved, []);
  assert.deepEqual(copied, []);
});

test('panel — định dạng lạ không lặng lẽ rơi về md, mà nói ra ở dòng trạng thái', async () => {
  const { controller, saved } = mounted();
  await controller.open();
  controller.save('txt');
  assert.deepEqual(saved, []);
  assert.match(S.collapse(controller.nodes.status.textContent), /txt/);
});

// --------------------------------------- giao diện của chính mình không bị chính mình quét

test('panel — nút mở panel nằm ở hàng nút và mang tiền tố id của extension', () => {
  const page = watchPage();
  const toggle = P.mountToggle(page, fakeDoc(page), () => {}, {});
  assert.ok(toggle.getAttribute('id').startsWith(S.EXT_PREFIX), toggle.getAttribute('id'));
  assert.equal(toggle.closest('#top-level-buttons-computed').getAttribute('id'), 'top-level-buttons-computed');
  assert.equal(P.mountToggle(page, fakeDoc(page), () => {}, {}), toggle, 'gắn hai lần vẫn một nút');
});

test('panel — nút "Transcript" của extension KHÔNG bị đường trích nhặt nhầm làm nút của YouTube', () => {
  const page = watchPage();
  P.mountToggle(page, fakeDoc(page), () => {}, {});
  assert.equal(T.findTranscriptButton(page, {}), null, 'chỉ có nút của chính mình thì phải trả null');

  const real = el('button', { 'aria-label': 'Show transcript' }, ['Show transcript']);
  page.querySelector('#top-level-buttons-computed').append(real);
  assert.equal(T.findTranscriptButton(page, {}), real);
});

test('panel — dòng transcript của panel không lọt vào lượt quét panel của YouTube', async () => {
  const { page, controller } = mounted();
  await controller.open();
  const scan = T.scanTranscriptPanel(page, { opened: true });
  assert.equal(scan.ok, false, 'panel của extension không được đóng vai panel của YouTube');
});

test('panel — mỗi ô của panel mang đúng id riêng của nó, không hai ô dùng chung một id', async () => {
  const { controller } = mounted();
  await controller.open();
  const worn = [
    [controller.nodes.root, P.PANEL_ID],
    [controller.nodes.search, P.SEARCH_ID],
    [controller.nodes.status, P.STATUS_ID],
    [controller.nodes.list, P.LIST_ID],
  ];
  for (const [node, id] of worn) assert.equal(node.getAttribute('id'), id, `ô này đang mang id ${node.getAttribute('id')}`);
  assert.equal(new Set(worn.map(([, id]) => id)).size, worn.length, 'hai ô đang dùng chung một id');
});

test('panel — mọi id panel tạo ra đều mang tiền tố chung', async () => {
  const { page, controller } = mounted();
  await controller.open();
  const withId = Array.from(page.querySelectorAll('*')).filter((node) => node.getAttribute('id'));
  const created = withId.map((node) => node.getAttribute('id')).filter((id) => id.includes('panel'));
  assert.ok(created.length >= 3, `quét được quá ít id (${created.length}) — biểu thức quét hỏng`);
  for (const id of created) assert.ok(id.startsWith(S.EXT_PREFIX), `id lạc quy ước: ${id}`);
});

// --------------------------------- đổi video: panel của video trước phải biến mất

/**
 * Video A và video B là hai thứ cùng kiểu, và thẻ `<video>` là thẻ **dùng lại**: panel của A
 * còn treo trên trang B vẫn cuộn được, vẫn bấm mốc nhảy được, chỉ là đang hiển thị transcript
 * của video khác. Không một dấu hiệu nào cho người đọc — cùng một hình với cặp `url` Mục ↔ url
 * trang mà `mergeMeta` phải canh (`WORKSPACE_PROTOCOL.md`).
 */
const VIDEO_A = [{ start: 0, text: 'Đây là video A' }, { start: 10, text: 'A nói tiếp' }];
const VIDEO_B = [{ start: 0, text: 'Đây là video B' }];

for (const navigation of ['yt-navigate-finish', 'yt-page-data-updated']) {
  test(`install — "${navigation}" dọn panel của video trước ra khỏi trang`, async () => {
    const page = watchPage();
    const win = fakeWindow(page);
    const panel = P.install(win, {
      tab: fakeTab((turn) => ({ meta: META, segments: turn === 1 ? VIDEO_A : VIDEO_B })),
    });

    await panel.toggle();
    assert.match(page.querySelector(`#${P.PANEL_ID}`).textContent, /video A/);

    win.fire(navigation);
    assert.equal(page.querySelector(`#${P.PANEL_ID}`), null,
      'panel của video trước vẫn còn trên trang — người dùng đang đọc transcript sai video');

    await panel.toggle();
    const reopened = page.querySelector(`#${P.PANEL_ID}`);
    assert.match(reopened.textContent, /video B/);
    assert.equal(reopened.textContent.includes('video A'), false, 'dòng của video trước còn sót lại');
    assert.equal(page.querySelectorAll(`#${P.PANEL_ID}`).length, 1, 'hai panel cùng lúc trên một trang');
  });
}

test('install — nhịp timeupdate sau khi đổi video không nổ, dù panel đã bị dọn', async () => {
  const page = watchPage();
  const win = fakeWindow(page);
  const panel = P.install(win, { tab: fakeTab(() => ({ meta: META, segments: VIDEO_A })) });

  await panel.toggle();
  win.fire('yt-navigate-finish');

  // Listener nằm trên thẻ `<video>`, thứ YouTube **không** dựng lại khi đổi video, nên nó vẫn
  // chạy sau khi panel đã bị dọn. Không có guard thì mỗi nhịp là một TypeError, vài lần mỗi
  // giây, suốt thời gian xem — và người dùng không thấy gì ngoài một panel không chịu mở.
  const video = page.querySelector('video');
  video.currentTime = 5;
  assert.doesNotThrow(() => video.dispatchEvent(evt('timeupdate')));
});

test('install — mở panel hai lần chỉ gắn một listener lên thẻ video, và nó nối vào panel mới', async () => {
  const page = watchPage();
  const win = fakeWindow(page);
  const panel = P.install(win, {
    tab: fakeTab((turn) => ({ meta: META, segments: turn === 1 ? VIDEO_A : VIDEO_B })),
  });

  await panel.toggle();
  win.fire('yt-navigate-finish');
  await panel.toggle();

  const video = page.querySelector('video');
  assert.equal(video.listeners.get('timeupdate').length, 1,
    'mỗi lần mở panel lại chồng thêm một listener lên cùng một thẻ video');

  // Một listener ấy phải nối vào bộ điều khiển **đang sống**, không phải cái đã bị dọn.
  video.currentTime = 0;
  video.dispatchEvent(evt('timeupdate'));
  const marked = Array.from(page.querySelector(`#${P.LIST_ID}`).children)
    .filter((row) => row.getAttribute('aria-current') === 'true');
  assert.deepEqual(marked.map((row) => S.collapse(row.children[1].textContent)), ['Đây là video B']);
});
