// Trang watch: nút cạnh Like/Share, meta của video, và đường trích chạy ngay trong tab.
//
// Seam 3 — module nhận một cây node, trả dữ liệu. Cây giả ở `test/helpers/fake-dom.js`.
//
// Hai thứ ở đây dễ hỏng câm nhất, nên phần lớn test canh chúng:
//   1. Extension tự thêm một nút vào đúng hàng nút mà nó cũng đang quét. Không loại giao diện
//      của chính mình ra trước là bấm vào chính mình (bài học ticket 002).
//   2. `title` ↔ `channel` là cặp cùng kiểu: hoán vị vẫn ra một Nguồn dựng được, chỉ là
//      NotebookLM trích dẫn sai tên kênh (`WORKSPACE_PROTOCOL.md`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, evt } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/common/messages.js';
import '../src/youtube/selectors.js';
import '../src/youtube/transcript.js';
import '../src/youtube/watch.js';

const S = globalThis.NBLM_SHARED;
const M = globalThis.NBLM_MESSAGES;
const W = globalThis.NBLM_WATCH;

/** `document` giả: đúng hai thứ mà watch.js được phép dùng của nó. */
const fakeDoc = (root_) => ({
  createElement: (tag) => el(tag),
  querySelector: (selector) => root_.querySelector(selector),
  querySelectorAll: (selector) => root_.querySelectorAll(selector),
});

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** Trang watch tối giản: hàng nút Like/Share, tiêu đề, tên kênh, huy hiệu, thanh player. */
function watchPage(options = {}) {
  const actions = el('div', { id: 'top-level-buttons-computed' }, [
    el('ytd-button-renderer', {}, [el('button', { 'aria-label': 'Thích video này' }, ['Thích'])]),
    el('ytd-button-renderer', {}, [el('button', { 'aria-label': 'Chia sẻ' }, ['Chia sẻ'])]),
  ]);
  const badges = options.badge
    ? [el('ytd-badge-supported-renderer', {}, [el('span', { class: 'badge-style-type-simple' }, [options.badge])])]
    : [];
  return el('div', { id: 'page' }, [
    el('ytd-watch-metadata', {}, [
      el('h1', {}, [options.title == null ? 'Học Rust trong 30 phút' : options.title]),
      ...badges,
      el('div', { id: 'owner' }, [
        el('ytd-channel-name', {}, [el('a', { href: '/@kenhlaptrinh' }, [options.channel || 'Kênh Lập Trình'])]),
      ]),
      actions,
    ]),
    el('div', { class: 'ytp-time-duration' }, [options.duration || '30:00']),
  ]);
}

// ------------------------------------------------------------------ nút trên trang

test('nút import vào đúng hàng nút Like/Share, mang tiền tố id của extension', () => {
  const page = watchPage();
  const button = W.mountButton(page, fakeDoc(page), () => {});

  assert.ok(button.getAttribute('id').startsWith(S.EXT_PREFIX), button.getAttribute('id'));
  assert.equal(button.closest('#top-level-buttons-computed').getAttribute('id'), 'top-level-buttons-computed');
  assert.ok(S.collapse(button.textContent).length > 0, 'nút phải có chữ để người dùng đọc');
});

test('gắn nút hai lần vẫn chỉ có một nút — YouTube dựng lại hàng nút mỗi lần đổi video', () => {
  const page = watchPage();
  const doc = fakeDoc(page);
  const first = W.mountButton(page, doc, () => {});
  const second = W.mountButton(page, doc, () => {});

  assert.equal(first, second);
  assert.equal(page.querySelectorAll(`[id^="${S.EXT_PREFIX}"]`).length, 1);
});

test('bấm nút thì handler chạy — không chỉ là một nút đẹp gắn vào trang', () => {
  const page = watchPage();
  const clicks = [];
  const button = W.mountButton(page, fakeDoc(page), () => clicks.push('bấm'));
  button.dispatchEvent(evt('click'));
  assert.deepEqual(clicks, ['bấm']);
});

test('nút của extension KHÔNG bị chính extension nhặt nhầm khi dò nút Transcript', () => {
  // Nút của ta đứng ngay đầu hàng nút; ticket 002 đã chặn ở `findTranscriptButton`, ở đây
  // canh rằng nút mới thêm vẫn nằm đúng trong vùng loại trừ đó.
  const page = watchPage();
  W.mountButton(page, fakeDoc(page), () => {});
  const T = globalThis.NBLM_TRANSCRIPT;
  assert.equal(T.findTranscriptButton(page, {}), null, 'không có nút Transcript thật thì phải trả null');

  const real = el('button', { 'aria-label': 'Show transcript' }, ['Show transcript']);
  page.querySelector('#top-level-buttons-computed').append(real);
  assert.equal(T.findTranscriptButton(page, {}), real);
});

test('không tìm thấy hàng nút thì không gắn bừa vào body — trả null và nói không', () => {
  const page = el('div', {}, [el('span', {}, ['trang chưa dựng xong'])]);
  assert.equal(W.mountButton(page, fakeDoc(page), () => {}), null);
});

// ------------------------------------------------------------------ meta của video

test('readVideoMeta — tiêu đề vào title, tên kênh vào channel: hai ô không đổi chỗ', () => {
  const page = watchPage();
  const meta = W.readVideoMeta(page, { url: WATCH_URL });

  assert.equal(meta.title, 'Học Rust trong 30 phút');
  assert.equal(meta.channel, 'Kênh Lập Trình');
  assert.equal(meta.videoId, 'dQw4w9WgXcQ');
  assert.equal(meta.url, WATCH_URL);
  assert.equal(meta.durationSeconds, 1800);
});

test('readVideoMeta — huy hiệu "Riêng tư" ra Mức riêng tư private, không ra public', () => {
  for (const badge of ['Private', 'Riêng tư']) {
    assert.equal(W.readVideoMeta(watchPage({ badge }), { url: WATCH_URL }).privacy, 'private', badge);
  }
});

test('readVideoMeta — huy hiệu "Không công khai" là unlisted, không phải private', () => {
  for (const badge of ['Unlisted', 'Không công khai']) {
    assert.equal(W.readVideoMeta(watchPage({ badge }), { url: WATCH_URL }).privacy, 'unlisted', badge);
  }
});

test('readVideoMeta — không có huy hiệu nào thì là public', () => {
  assert.equal(W.readVideoMeta(watchPage(), { url: WATCH_URL }).privacy, 'public');
});

test('readVideoMeta — chữ trên nút của chính extension không lọt vào tiêu đề', () => {
  const page = watchPage();
  W.mountButton(page, fakeDoc(page), () => {});
  assert.equal(W.readVideoMeta(page, { url: WATCH_URL }).title, 'Học Rust trong 30 phút');
});

// ------------------------------------------------------- quét panel, có thử lại

test('scanPanel — panel chưa dựng xong thì thử lại, dựng xong thì trả segment', async () => {
  const results = [
    { ok: false, reason: 'empty', message: 'panel đã mở nhưng chưa có segment nào' },
    { ok: false, reason: 'empty', message: 'panel đã mở nhưng chưa có segment nào' },
    { ok: true, segments: [{ start: 0, text: 'xong' }] },
  ];
  const waits = [];
  const out = await W.scanPanel({
    scanOnce: () => results.shift(),
    wait: async (ms) => waits.push(ms),
    tries: 5,
  });

  assert.deepEqual(out.segments, [{ start: 0, text: 'xong' }]);
  assert.equal(waits.length, 2, 'chờ đúng số lần đã trượt, không chờ thừa một nhịp');
});

test('scanPanel — cửa sổ quá hẹp thì dừng ngay: chiều rộng không tự đổi vì chờ thêm', async () => {
  let calls = 0;
  const out = await W.scanPanel({
    scanOnce: () => {
      calls += 1;
      return { ok: false, reason: 'narrow-window', message: 'cửa sổ quá hẹp' };
    },
    wait: async () => {},
    tries: 5,
  });

  assert.equal(calls, 1, 'đốt thêm bốn lượt chờ không làm cửa sổ rộng ra');
  assert.equal(out.reason, 'narrow-window');
});

// ------------------------------------------------- định tuyến theo Mức riêng tư

test('video private KHÔNG gọi đường API nào — ADR 0003, kiểm ở chỗ nối chứ không chỉ ở router', async () => {
  const page = watchPage({ badge: 'Riêng tư' });
  const calls = [];
  const result = await W.extractHere(page, {
    url: WATCH_URL,
    net: {
      post: async () => {
        calls.push('innertube');
        return {};
      },
      get: async () => {
        calls.push('timedtext');
        return {};
      },
    },
    bridge: {
      request: async (op) => {
        calls.push(`bridge:${op}`);
        return { apiKey: 'k', clientName: '1', clientVersion: '2' };
      },
    },
    page: {
      scan: async () => ({ ok: true, segments: [{ start: 1, text: 'chữ từ DOM' }] }),
      activate: async () => {},
    },
  });

  assert.deepEqual(calls, [], 'private đã biết trước: không thử API, không hỏi cả ytcfg');
  assert.equal(result.via, 'dom');
  assert.deepEqual(result.segments, [{ start: 1, text: 'chữ từ DOM' }]);
  assert.equal(result.meta.privacy, 'private');
  assert.equal(result.meta.channel, 'Kênh Lập Trình');
});

test('video public thử InnerTube trước, và chỉ khi đó mới hỏi ytcfg qua cầu MAIN world', async () => {
  const page = watchPage();
  const calls = [];
  const result = await W.extractHere(page, {
    url: WATCH_URL,
    net: {
      post: async () => {
        calls.push('innertube');
        return {
          actions: [{
            transcriptSegmentRenderer: { startMs: '1000', endMs: '2000', snippet: { simpleText: 'từ API' } },
          }],
        };
      },
    },
    bridge: {
      request: async (op) => {
        calls.push(`bridge:${op}`);
        return { apiKey: 'k', clientName: '1', clientVersion: '2' };
      },
    },
    page: {
      scan: async () => {
        calls.push('dom');
        return { ok: false, reason: 'no-panel' };
      },
    },
  });

  assert.deepEqual(calls, ['bridge:ytcfg', 'innertube']);
  assert.equal(result.via, 'innertube');
  assert.deepEqual(result.segments, [{ start: 1, end: 2, text: 'từ API' }]);
});

test('InnerTube hỏng thì rơi về DOM, và lý do của từng đường được giữ lại', async () => {
  const page = watchPage();
  const result = await W.extractHere(page, {
    url: WATCH_URL,
    net: { post: async () => { throw new Error('HTTP 401'); } },
    bridge: { request: async () => ({ apiKey: 'k' }) },
    page: { scan: async () => ({ ok: true, segments: [{ start: 0, text: 'từ DOM' }] }) },
  });

  assert.equal(result.via, 'dom');
  const failed = result.attempts.filter((a) => !a.ok).map((a) => a.path);
  assert.ok(failed.includes('innertube'), JSON.stringify(result.attempts));
  assert.ok(failed.includes('timedtext'), 'thiếu adapter cũng phải hiện ra thành một dòng lý do');
});

// ------------------------------------------------------------ kỷ luật tin nhắn

test('listener của tab YouTube im lặng với tin không phải của mình', () => {
  const deps = { extract: async () => ({}) };
  for (const type of [M.TYPES.PUSH_SOURCE, M.TYPES.GET_STATE, 'tin-cua-extension-khac', undefined]) {
    assert.equal(W.handleMessage({ type }, deps), undefined, `phải im lặng với "${type}"`);
  }
});

test('listener của tab YouTube trả lời đúng hai loại tin đã khai', async () => {
  const deps = { extract: async () => ({ meta: { videoId: 'abc' }, segments: [{ start: 0, text: 'a' }] }) };

  const pong = await W.handleMessage({ type: M.TYPES.PING_YOUTUBE }, deps);
  assert.equal(pong.ok, true);

  const extracted = await W.handleMessage({ type: M.TYPES.EXTRACT_TRANSCRIPT }, deps);
  assert.equal(extracted.ok, true);
  assert.deepEqual(extracted.result.segments, [{ start: 0, text: 'a' }]);
});

test('trích hỏng thì trả lời có lời, không để đầu bên kia treo một Promise', async () => {
  const deps = { extract: async () => { throw new Error('panel không mở'); } };
  const answer = await W.handleMessage({ type: M.TYPES.EXTRACT_TRANSCRIPT }, deps);
  assert.equal(answer.ok, false);
  assert.match(answer.error, /panel không mở/);
});

// ------------------------------------------------- nút Transcript là nút bật/tắt

test('createPage — cả lượt trích chỉ bấm nút Transcript một lần, dù quét hai lượt', async () => {
  const page = watchPage();
  const bar = page.querySelector('#top-level-buttons-computed');
  const real = el('button', { 'aria-label': 'Show transcript' }, ['Show transcript']);
  bar.append(real);
  // Panel đã dựng sẵn nhưng rỗng, để `scan` không dừng ở lượt đầu.
  page.append(el('ytd-transcript-renderer', {}, []));

  const adapter = W.createPage(() => page, { wait: async () => {}, activate: async () => {} }, { createEvent: evt });
  await adapter.scan({ activated: false });
  await adapter.scan({ activated: true });

  const clicks = real.events.filter((type) => type === 'click').length;
  assert.equal(clicks, 1, 'bấm lần hai là đóng lại đúng cái panel vừa mở');
});

// ------------------------------------ tab có thể đã nhảy sang video khác giữa chừng

test('lệch videoId thì từ chối trích, không ghi transcript video khác dưới tên video này', async () => {
  const asked = [];
  const deps = {
    currentVideoId: () => 'video-B',
    extract: async (message) => { asked.push(message); return { segments: [] }; },
  };
  const answer = await W.handleMessage({ type: M.TYPES.EXTRACT_TRANSCRIPT, videoId: 'video-A' }, deps);

  assert.equal(answer.ok, false);
  assert.match(answer.error, /video-B[\s\S]*video-A/, 'lời từ chối phải nói ra cả hai id, không chỉ "sai video"');
  assert.deepEqual(asked, [], 'không được trích gì cả khi hai id lệch nhau');
});

test('tab không còn ở trang watch cũng là lệch — id rỗng không phải là "khớp"', async () => {
  const asked = [];
  const deps = {
    currentVideoId: () => '',
    extract: async (message) => { asked.push(message); return { segments: [] }; },
  };
  const answer = await W.handleMessage({ type: M.TYPES.EXTRACT_TRANSCRIPT, videoId: 'video-A' }, deps);

  assert.equal(answer.ok, false);
  assert.deepEqual(asked, []);
});

test('đúng video thì trích, và tin đi nguyên vẹn sang adapter', async () => {
  const asked = [];
  const deps = {
    currentVideoId: () => 'video-A',
    extract: async (message) => { asked.push(message.videoId); return { segments: [{ start: 0, text: 'a' }] }; },
  };
  const answer = await W.handleMessage({ type: M.TYPES.EXTRACT_TRANSCRIPT, videoId: 'video-A' }, deps);

  assert.equal(answer.ok, true);
  assert.deepEqual(asked, ['video-A']);
});
