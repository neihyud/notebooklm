// Ticket 002 — ba đường trích transcript và bộ định tuyến theo Mức riêng tư (ADR 0003).
//
// Đường DOM test bằng **cây node giả** (Seam 3 của spec 0001), hai đường API test bằng adapter
// mạng giả: không Chrome, không DOM thật, không mạng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/youtube/selectors.js';
import '../src/youtube/transcript.js';
import { readFileSync } from 'node:fs';
import { el, evt } from './helpers/fake-dom.js';

const T = globalThis.NBLM_TRANSCRIPT;

// ------------------------------------------------------------------ tiện ích test

/** Adapter đường trích giả: ghi lại thứ tự được gọi, trả segment hoặc ném lỗi. */
function fakePaths(opts = {}) {
  const calls = [];
  const make = (name) => async (request) => {
    calls.push(name);
    if (opts[name] instanceof Error) throw opts[name];
    if (opts[name]) return opts[name];
    throw new Error(`${name}: không có gì`);
  };
  return { calls, innertube: make('innertube'), timedtext: make('timedtext'), dom: make('dom') };
}

const seg = (start, end, text) => ({ start, end, text });

// ------------------------------------------------------------------ bộ định tuyến

test('routeFor — private đi thẳng đường DOM, không có đường API nào trong tuyến', () => {
  assert.deepEqual(T.routeFor('private'), ['dom']);
});

test('routeFor — unlisted/public thử InnerTube trước, rồi timedtext, cuối cùng mới DOM', () => {
  assert.deepEqual(T.routeFor('unlisted'), ['innertube', 'timedtext', 'dom']);
  assert.deepEqual(T.routeFor('public'), ['innertube', 'timedtext', 'dom']);
});

test('fetchTranscript — video private KHÔNG BAO GIỜ gọi hai adapter API (ADR 0003)', async () => {
  const paths = fakePaths({ innertube: [seg(0, 1, 'API')], dom: [seg(0, 1, 'DOM')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'private' }, paths);

  assert.deepEqual(paths.calls, ['dom']);
  assert.equal(out.via, 'dom');
  assert.deepEqual(out.segments, [seg(0, 1, 'DOM')]);
});

test('fetchTranscript — unlisted dừng ở InnerTube khi InnerTube trả về được', async () => {
  const paths = fakePaths({ innertube: [seg(0, 1, 'API')], timedtext: [seg(0, 1, 'TT')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'unlisted' }, paths);

  assert.deepEqual(paths.calls, ['innertube']);
  assert.equal(out.via, 'innertube');
});

test('fetchTranscript — InnerTube hỏng thì rơi sang timedtext, không rơi thẳng xuống DOM', async () => {
  const paths = fakePaths({ timedtext: [seg(0, 1, 'TT')], dom: [seg(0, 1, 'DOM')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'public' }, paths);

  assert.deepEqual(paths.calls, ['innertube', 'timedtext']);
  assert.equal(out.via, 'timedtext');
  assert.deepEqual(out.segments, [seg(0, 1, 'TT')]);
});

test('fetchTranscript — hai đường API hỏng thì mới tới DOM, và nhật ký kể đủ ba lần thử', async () => {
  const paths = fakePaths({ dom: [seg(0, 1, 'DOM')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'public' }, paths);

  assert.deepEqual(paths.calls, ['innertube', 'timedtext', 'dom']);
  assert.equal(out.via, 'dom');
  assert.deepEqual(out.attempts.map((a) => [a.path, a.ok]), [
    ['innertube', false], ['timedtext', false], ['dom', true],
  ]);
});

test('fetchTranscript — đường trả về mảng rỗng bị coi là hỏng, đi tiếp đường sau', async () => {
  const paths = fakePaths({ innertube: [], timedtext: [seg(0, 1, 'TT')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'public' }, paths);

  assert.equal(out.via, 'timedtext');
});

test('fetchTranscript — hỏng hết thì ném lỗi kể tên từng đường và lý do', async () => {
  const paths = fakePaths({});
  await assert.rejects(
    () => T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'private' }, paths),
    (error) => {
      assert.match(error.message, /aaaaaaaaaaa/);
      assert.match(error.message, /dom/);
      assert.match(error.message, /không có gì/);
      assert.equal(error.attempts.length, 1);
      return true;
    },
  );
});

test('fetchTranscript — Mức riêng tư không rõ vẫn thử đủ ba đường', async () => {
  const paths = fakePaths({ dom: [seg(0, 1, 'DOM')] });
  await T.fetchTranscript({ videoId: 'aaaaaaaaaaa' }, paths);
  assert.deepEqual(paths.calls, ['innertube', 'timedtext', 'dom']);
});

// ------------------------------------------------------- đọc mốc thời gian hiển thị

test('parseClock — mm:ss và h:mm:ss ra đúng số giây', () => {
  assert.equal(T.parseClock('0:01'), 1);
  assert.equal(T.parseClock('1:23'), 83);
  assert.equal(T.parseClock('12:34'), 754);
  assert.equal(T.parseClock('1:02:03'), 3723);
  assert.equal(T.parseClock(' 10:00 '), 600);
});

test('parseClock — thứ không đọc được ra 0, không ra NaN', () => {
  for (const bad of ['', null, undefined, 'abc', '--:--']) assert.equal(T.parseClock(bad), 0);
});

// ------------------------------------------------------------------ InnerTube

/** Payload get_transcript rút gọn, giữ nguyên hình dạng lồng nhau của InnerTube thật. */
const innertubePayload = (segments) => ({
  actions: [{
    updateEngagementPanelAction: {
      content: {
        transcriptRenderer: {
          content: {
            transcriptSearchPanelRenderer: {
              body: {
                transcriptSegmentListRenderer: {
                  initialSegments: segments.map((s) => ({
                    transcriptSegmentRenderer: {
                      startMs: String(s.startMs),
                      endMs: String(s.endMs),
                      snippet: { runs: s.runs.map((text) => ({ text })) },
                    },
                  })),
                },
              },
            },
          },
        },
      },
    },
  }],
});

test('parseInnertubeTranscript — startMs/endMs ra đúng giây của đúng segment', () => {
  const payload = innertubePayload([
    { startMs: 1000, endMs: 4500, runs: ['Xin chào ', 'các bạn'] },
    { startMs: 4500, endMs: 9000, runs: ['hôm nay'] },
  ]);
  assert.deepEqual(T.parseInnertubeTranscript(payload), [
    { start: 1, end: 4.5, text: 'Xin chào các bạn' },
    { start: 4.5, end: 9, text: 'hôm nay' },
  ]);
});

test('parseInnertubeTranscript — snippet dạng simpleText cũng đọc được', () => {
  const payload = {
    transcriptSegmentRenderer: { startMs: '2000', endMs: '3000', snippet: { simpleText: 'một dòng' } },
  };
  assert.deepEqual(T.parseInnertubeTranscript(payload), [{ start: 2, end: 3, text: 'một dòng' }]);
});

test('parseInnertubeTranscript — segment rỗng bị bỏ, payload lạ ra mảng rỗng', () => {
  const payload = innertubePayload([
    { startMs: 1000, endMs: 2000, runs: ['   '] },
    { startMs: 2000, endMs: 3000, runs: ['có chữ'] },
  ]);
  assert.deepEqual(T.parseInnertubeTranscript(payload), [{ start: 2, end: 3, text: 'có chữ' }]);
  assert.deepEqual(T.parseInnertubeTranscript({}), []);
  assert.deepEqual(T.parseInnertubeTranscript(null), []);
});

test('viaInnertube — gửi videoId đang hỏi, không gửi header Authorization nào', async () => {
  const sent = [];
  const net = {
    async post(req) {
      sent.push(req);
      return innertubePayload([{ startMs: 0, endMs: 1000, runs: ['ok'] }]);
    },
  };
  const request = {
    videoId: 'aaaaaaaaaaa',
    privacy: 'public',
    // Nếu một ngày nào đó ai đó chuyền token vào đây, nó vẫn không được rời khỏi hàm này.
    authorization: 'SAPISIDHASH 111_bimat',
    ytcfg: { apiKey: 'AIzaKEY', clientName: '1', clientVersion: '2.2026' },
  };

  const segments = await T.viaInnertube(request, net);

  assert.deepEqual(segments, [{ start: 0, end: 1, text: 'ok' }]);
  assert.equal(sent.length, 1);
  const headerNames = Object.keys(sent[0].headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes('authorization'), `lộ header: ${headerNames.join(', ')}`);
  assert.ok(!JSON.stringify(sent[0]).includes('bimat'), 'token rò vào request InnerTube');
  assert.equal(sent[0].body.videoId, 'aaaaaaaaaaa');
  assert.match(sent[0].url, /get_transcript/);
});

test('viaInnertube — trả về rỗng thì ném lỗi nói rõ đường nào hỏng', async () => {
  const net = { async post() { return {}; } };
  await assert.rejects(
    () => T.viaInnertube({ videoId: 'aaaaaaaaaaa', ytcfg: { apiKey: 'k' } }, net),
    /InnerTube/,
  );
});

// ------------------------------------------------------------------ timedtext

test('parseTimedText — tStartMs/dDurationMs ra đúng start và end', () => {
  const payload = {
    events: [
      { tStartMs: 1000, dDurationMs: 3500, segs: [{ utf8: 'Xin ' }, { utf8: 'chào' }] },
      { tStartMs: 4500, dDurationMs: 2000, segs: [{ utf8: 'các bạn' }] },
    ],
  };
  assert.deepEqual(T.parseTimedText(payload), [
    { start: 1, end: 4.5, text: 'Xin chào' },
    { start: 4.5, end: 6.5, text: 'các bạn' },
  ]);
});

test('parseTimedText — event không có segs (định nghĩa cửa sổ) và đoạn trắng đều bị bỏ', () => {
  const payload = {
    events: [
      { tStartMs: 0, dDurationMs: 1000, id: 1, wpWinPosId: 1 },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
      { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'còn lại' }] },
    ],
  };
  assert.deepEqual(T.parseTimedText(payload), [{ start: 2, end: 3, text: 'còn lại' }]);
});

test('viaTimedText — luôn xin fmt=json3 (không phải XML) và đọc đúng baseUrl của video', async () => {
  const asked = [];
  const net = {
    async get(url) {
      asked.push(url);
      return { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'ok' }] }] };
    },
  };
  const segments = await T.viaTimedText(
    { videoId: 'aaaaaaaaaaa', captionBaseUrl: 'https://www.youtube.com/api/timedtext?v=aaaaaaaaaaa&lang=vi' },
    net,
  );

  assert.deepEqual(segments, [{ start: 0, end: 1, text: 'ok' }]);
  assert.match(asked[0], /fmt=json3/);
  assert.match(asked[0], /lang=vi/);
});

test('viaTimedText — body rỗng (exp=xpe, thiếu PoToken) báo lỗi nói đúng nguyên nhân', async () => {
  const net = { async get() { return {}; } };
  await assert.rejects(
    () => T.viaTimedText({ videoId: 'aaaaaaaaaaa', captionBaseUrl: 'https://x/api/timedtext?exp=xpe' }, net),
    /PoToken/,
  );
});

test('viaTimedText — không có caption track thì hỏng ngay, không gọi mạng', async () => {
  let called = 0;
  const net = { async get() { called += 1; return {}; } };
  await assert.rejects(() => T.viaTimedText({ videoId: 'aaaaaaaaaaa' }, net), /caption/i);
  assert.equal(called, 0);
});

// --------------------------------------------------- dò nút trên trang (đường DOM)

/**
 * Trang watch giả. Nút "Transcript" của **chính extension** đứng ngay đầu hàng nút — đúng cái
 * bẫy mà acceptance của ticket 002 nói tới.
 */
function watchPage({ ownButton = true } = {}) {
  const ytButton = el('button', { 'aria-label': 'Show transcript', id: 'yt-real-button' }, ['Transcript']);
  const row = el('div', { id: 'top-level-buttons' }, [
    ...(ownButton
      ? [el('div', { id: 'nblm-actions' }, [
        el('button', { id: 'nblm-transcript-button' }, ['Transcript']),
      ])]
      : []),
    el('ytd-button-renderer', { class: 'style-scope' }, [
      el('yt-button-shape', {}, [ytButton]),
    ]),
  ]);
  return { root: el('div', { id: 'page' }, [row]), ytButton };
}

test('findTranscriptButton — loại giao diện của chính extension trước khi quét', () => {
  const page = watchPage();
  const found = T.findTranscriptButton(page.root);

  assert.equal(found, page.ytButton, 'bấm nhầm nút của chính mình');
  assert.equal(found.getAttribute('id'), 'yt-real-button');
  assert.equal(found.closest('[id^="nblm-"]'), null);
});

test('findTranscriptButton — nhắm phần tử bấm được trong cùng, không nhắm wrapper', () => {
  const page = watchPage({ ownButton: false });
  const found = T.findTranscriptButton(page.root);

  assert.equal(found.tagName, 'BUTTON');
  assert.equal(found, page.ytButton);
});

test('findTranscriptButton — không có nút nào của trang thì trả null, không trả nút của mình', () => {
  const root = el('div', {}, [
    el('div', { id: 'nblm-actions' }, [el('button', { id: 'nblm-transcript-button' }, ['Transcript'])]),
  ]);
  assert.equal(T.findTranscriptButton(root), null);
});

test('findTranscriptButton — khớp cả nhãn tiếng Việt và nhãn bỏ dấu', () => {
  const button = el('button', { 'aria-label': 'Hiển thị bản chép lời' }, ['Bản chép lời']);
  const root = el('div', {}, [el('ytd-button-renderer', {}, [button])]);
  assert.equal(T.findTranscriptButton(root), button);
});

test('findTranscriptButton — khớp được cả khi chữ chỉ nằm ở aria-label, và cả khi chỉ nằm ở nhãn hiện', () => {
  const ariaOnly = el('button', { 'aria-label': 'Show transcript' }, ['\u2630']);
  const textOnly = el('button', {}, ['Show transcript']);
  assert.equal(T.findTranscriptButton(el('div', {}, [ariaOnly])), ariaOnly);
  assert.equal(T.findTranscriptButton(el('div', {}, [textOnly])), textOnly);
});

test('pressElement — phát đủ chuỗi sự kiện, đúng thứ tự (một mình click là không mở panel)', () => {
  const button = el('button', {}, ['Transcript']);
  T.pressElement(button, { createEvent: (type) => evt(type) });
  assert.deepEqual(button.events, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
});

// ------------------------------------------------------- quét panel transcript

const segmentNode = (timestamp, text, { a11y = null, textClass = 'segment-text' } = {}) =>
  el('transcript-segment-view-model', {}, [
    el('div', { class: 'segment-start-offset' }, [el('div', { class: 'segment-timestamp' }, [timestamp])]),
    ...(text == null ? [] : [el('div', { class: textClass }, [text])]),
    ...(a11y ? [el('div', { class: 'segment-duration-label' }, [a11y])] : []),
  ]);

const panelPage = (segments, visibility = 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') =>
  el('div', { id: 'page' }, [
    el('ytd-engagement-panel-section-list-renderer', {
      'target-id': 'engagement-panel-searchable-transcript',
      visibility,
    }, segments),
  ]);

test('scanTranscriptPanel — đọc ra đúng cặp (mốc, chữ) của từng segment', () => {
  const root = panelPage([
    segmentNode('0:01', 'Xin chào các bạn'),
    segmentNode('1:23', 'hôm nay chúng ta'),
    segmentNode('1:02:03', 'phần cuối'),
  ]);
  const result = T.scanTranscriptPanel(root);

  assert.equal(result.ok, true);
  assert.deepEqual(result.segments, [
    { start: 1, text: 'Xin chào các bạn' },
    { start: 83, text: 'hôm nay chúng ta' },
    { start: 3723, text: 'phần cuối' },
  ]);
});

test('scanTranscriptPanel — nhãn trợ năng trong dòng segment không lọt vào transcript', () => {
  const root = panelPage([
    segmentNode('0:01', 'Xin chào', { a11y: '1 second' }),
    segmentNode('0:05', 'các bạn', { a11y: '4 seconds' }),
  ]);
  const result = T.scanTranscriptPanel(root);

  assert.deepEqual(result.segments.map((s) => s.text), ['Xin chào', 'các bạn']);
  assert.ok(!result.segments.some((s) => /second/.test(s.text)), 'nuốt nhãn trợ năng vào transcript');
});

test('scanTranscriptPanel — không có phần tử chữ riêng thì lấy phần còn lại, vẫn bỏ mốc và nhãn trợ năng', () => {
  const row = el('transcript-segment-view-model', {}, [
    el('div', { class: 'segment-timestamp' }, ['2:00']),
    el('div', { class: 'segment-duration-label' }, ['3 seconds']),
    'văn bản trần',
  ]);
  const result = T.scanTranscriptPanel(panelPage([row]));

  assert.deepEqual(result.segments, [{ start: 120, text: 'văn bản trần' }]);
});

test('scanTranscriptPanel — đã bấm mở mà panel vẫn ẩn: đó là cửa sổ quá hẹp, không phải rỗng', () => {
  const root = panelPage([segmentNode('0:01', 'có chữ')], 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  const result = T.scanTranscriptPanel(root, { opened: true });

  assert.equal(result.ok, false);
  assert.equal(result.reason, T.REASON.NARROW);
  assert.match(result.message, /cửa sổ/i);
});

test('scanTranscriptPanel — chưa bấm mở thì panel ẩn chỉ là đang đóng, và đáng thử lại', () => {
  const root = panelPage([segmentNode('0:01', 'có chữ')], 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  const result = T.scanTranscriptPanel(root);

  assert.equal(result.ok, false);
  assert.equal(result.reason, T.REASON.EMPTY, 'cửa sổ rộng bình thường bị báo là quá hẹp');
  assert.doesNotMatch(result.message, /hẹp/);
});

test('scanTranscriptPanel — không thấy panel và không thấy segment thì là chưa mở, không phải hẹp', () => {
  const result = T.scanTranscriptPanel(el('div', { id: 'page' }, []));
  assert.equal(result.ok, false);
  assert.equal(result.reason, T.REASON.NO_PANEL);
});

test('scanTranscriptPanel — panel mở nhưng chưa có segment nào là "chưa dựng xong"', () => {
  const result = T.scanTranscriptPanel(panelPage([]));
  assert.equal(result.ok, false);
  assert.equal(result.reason, T.REASON.EMPTY);
});

/**
 * Layout đo được trên trang thật của `jNQXAC9IVRw` (ticket 017, `tools/verify-live.mjs`).
 *
 * Panel **đang mở** không mang `target-id` nào; danh tính transcript nằm ở `data-target-id` của
 * `yt-section-list-renderer` bên trong. Hai panel *có* `target-id*="transcript"` thì đều đang ẩn
 * và rỗng — nên bắt panel bằng riêng `target-id` là nhìn thấy đúng những panel không có gì.
 */
const livePanelPage = (segments, innerTargetId = 'PAmodern_transcript_view') =>
  el('div', { id: 'page' }, [
    el('ytd-engagement-panel-section-list-renderer', {
      'target-id': 'engagement-panel-searchable-transcript',
      visibility: 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN',
    }, []),
    el('ytd-engagement-panel-section-list-renderer', {
      visibility: 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED',
    }, [
      el('div', { id: 'content' }, [
        el('yt-section-list-renderer', { 'data-target-id': innerTargetId }, [
          el('div', { id: 'contents' }, segments),
        ]),
      ]),
    ]),
  ]);

/** Trang chỉ có panel transcript đang ẩn, không một dòng segment nào — hình của cửa sổ hẹp thật. */
const hiddenOnlyPage = () =>
  el('div', { id: 'page' }, [
    el('ytd-engagement-panel-section-list-renderer', {
      'target-id': 'engagement-panel-searchable-transcript',
      visibility: 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN',
    }, []),
  ]);

/** Gán bề rộng đo được cho một node của cây giả — cây giả trả 0 cho mọi node chưa gắn vào trang. */
const withWidth = (node, width) => {
  node.getBoundingClientRect = () => ({ x: 0, y: 0, width, height: 40, top: 0, right: width, bottom: 40, left: 0 });
  return node;
};

test('scanTranscriptPanel — panel đang mở KHÔNG có target-id vẫn đọc được (layout thật của jNQXAC9IVRw)', () => {
  const result = T.scanTranscriptPanel(livePanelPage([
    segmentNode('0:00', 'All right so here we are'),
    segmentNode('0:05', 'in front of the elephants'),
  ]), { opened: true });

  assert.equal(result.ok, true, `đường DOM bỏ lỡ panel đang mở: ${result.reason} — ${result.message}`);
  assert.deepEqual(result.segments, [
    { start: 0, text: 'All right so here we are' },
    { start: 5, text: 'in front of the elephants' },
  ]);
});

/**
 * Một dòng segment của layout hiện tại, chép nguyên tên lớp từ `outerHTML` đo trên trang thật
 * (ticket 017, cả `jNQXAC9IVRw` lẫn `dQw4w9WgXcQ` cho cùng markup này).
 *
 * Ba chỗ đổi tên cùng lúc, và mỗi chỗ hỏng một kiểu khác nhau:
 *   - mốc `.ytwTranscriptSegmentViewModelTimestamp` — không bắt được thì `parseClock('')` cho
 *     **mọi** segment mốc 0, và file SRT ra đủ dòng nhưng mọi dòng nằm ở giây 0;
 *   - chữ nằm ở `span.ytAttributedStringHost`, không còn `.segment-text`;
 *   - nhãn trợ năng `…TimestampA11yLabel` **không** mang `aria-hidden`, nên đường dự phòng nuốt
 *     nó vào đầu mỗi dòng transcript ("1 secondAll right, so here we are…").
 */
const liveSegmentNode = (timestamp, a11y, text) =>
  el('transcript-segment-view-model', { class: 'ytwTranscriptSegmentViewModelHost' }, [
    el('div', { class: 'ytwTranscriptSegmentViewModelTimestamp', 'aria-hidden': 'true' }, [timestamp]),
    el('div', { class: 'ytwTranscriptSegmentViewModelTimestampA11yLabel' }, [a11y]),
    el('span', { class: 'ytAttributedStringHost ytAttributedStringLinkInheritColor', role: 'text' }, [text]),
  ]);

test('readSegment — layout dòng segment hiện tại: mốc đọc ra giây thật, nhãn trợ năng không lọt vào chữ', () => {
  const result = T.scanTranscriptPanel(panelPage([
    liveSegmentNode('0:01', '1 second', 'All right, so here we are'),
    liveSegmentNode('0:07', '7 seconds', 'really really long trunks'),
    liveSegmentNode('1:02:03', '1 hour, 2 minutes, 3 seconds', 'phần cuối'),
  ]), { opened: true });

  assert.equal(result.ok, true, `${result.reason} — ${result.message}`);
  assert.deepEqual(result.segments, [
    { start: 1, text: 'All right, so here we are' },
    { start: 7, text: 'really really long trunks' },
    { start: 3723, text: 'phần cuối' },
  ]);
});

test('readSegment — mốc của dòng này không bao giờ là mốc của dòng khác', () => {
  // Mọi mốc ra 0 vẫn là một transcript "đọc trôi chảy": đủ dòng, đủ chữ, chỉ là mọi dòng nằm ở
  // giây 0 — và `srt.js` vẫn dựng ra file mở lên xem được. Chốt từng cặp (mốc, chữ) một.
  const result = T.scanTranscriptPanel(panelPage([
    liveSegmentNode('0:05', '5 seconds', 'dòng A'),
    liveSegmentNode('0:11', '11 seconds', 'dòng B'),
  ]), { opened: true });

  const byText = new Map(result.segments.map((s) => [s.text, s.start]));
  assert.equal(byText.get('dòng A'), 5);
  assert.equal(byText.get('dòng B'), 11);
  assert.notEqual(byText.get('dòng A'), byText.get('dòng B'), 'hai dòng đang mang chung một mốc');
});

test('scanTranscriptPanel — panel lồng trong panel: mỗi dòng segment chỉ được đọc một lần', () => {
  const rows = [segmentNode('0:00', 'một'), segmentNode('0:02', 'hai')];
  const page = el('div', { id: 'page' }, [
    el('ytd-engagement-panel-section-list-renderer', {
      'target-id': 'engagement-panel-searchable-transcript',
      visibility: 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED',
    }, [
      el('yt-section-list-renderer', { 'data-target-id': 'PAmodern_transcript_view' }, rows),
    ]),
  ]);

  const result = T.scanTranscriptPanel(page, { opened: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.segments.map((s) => s.text), ['một', 'hai'], 'transcript bị nhân đôi');
});

test('scanTranscriptPanel — có dòng segment ngoài mọi panel nhận ra được: đó là panel mở mà không nhận ra', () => {
  const result = T.scanTranscriptPanel(
    livePanelPage([segmentNode('0:00', 'có chữ ở đây')], 'PAmodern_caption_view'),
    { opened: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, T.REASON.UNRECOGNIZED);
  assert.notEqual(result.reason, T.REASON.NARROW, 'panel mở mà không nhận ra bị gọi tên là cửa sổ hẹp');
});

test('scanTranscriptPanel — panel ẩn mà vẫn rộng 494px thì không phải cửa sổ hẹp', () => {
  const page = hiddenOnlyPage();
  withWidth(page.querySelector('ytd-engagement-panel-section-list-renderer'), 494);

  const result = T.scanTranscriptPanel(page, { opened: true });
  assert.equal(result.ok, false);
  assert.notEqual(result.reason, T.REASON.NARROW, 'kết luận cửa sổ hẹp cho một panel rộng 494px');
  assert.equal(result.reason, T.REASON.EMPTY);
  assert.match(result.message, /494/, 'không nói ra bề rộng đã đo được');
});

test('scanTranscriptPanel — cửa sổ hẹp thật: panel ẩn, bề rộng 0, và không một dòng segment nào trên trang', () => {
  const result = T.scanTranscriptPanel(hiddenOnlyPage(), { opened: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, T.REASON.NARROW);
});

test('scanTranscriptPanel — cửa sổ hẹp ở layout hiện tại: khối trong khớp selector nhưng panel bọc nó đang ẩn', () => {
  // Khối trong (`data-target-id`) **không** mang thuộc tính `visibility`; nó thừa hưởng trạng
  // thái ẩn từ panel bọc ngoài. Xét bằng `matches` thì nó thành "một panel đang mở" và cửa sổ
  // hẹp lại bị gọi tên là "chưa dựng xong" — hai chục lượt chờ cho một chiều rộng không tự đổi.
  const page = el('div', { id: 'page' }, [
    el('ytd-engagement-panel-section-list-renderer', {
      'target-id': 'engagement-panel-searchable-transcript',
      visibility: 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN',
    }, [
      el('yt-section-list-renderer', { 'data-target-id': 'PAmodern_transcript_view' }, []),
    ]),
  ]);

  const result = T.scanTranscriptPanel(page, { opened: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, T.REASON.NARROW, `${result.reason} — ${result.message}`);
});

test('scanTranscriptPanel — "ẩn vì cửa sổ hẹp" và "mở mà không nhận ra" không được hoán vị cho nhau', () => {
  // Hai lý do đều hợp lệ và đều dừng lượt chạy, nên hoán vị chúng không làm hỏng lần chạy nào —
  // chỉ đẩy người đọc lỗi đi sai hướng: một bên bảo kéo rộng cửa sổ, một bên bảo sửa selector.
  const narrow = T.scanTranscriptPanel(hiddenOnlyPage(), { opened: true });
  const unknown = T.scanTranscriptPanel(
    livePanelPage([segmentNode('0:00', 'có chữ ở đây')], 'PAmodern_caption_view'),
    { opened: true },
  );

  assert.equal(narrow.reason, T.REASON.NARROW);
  assert.equal(unknown.reason, T.REASON.UNRECOGNIZED);
  assert.notEqual(narrow.reason, unknown.reason);

  assert.match(narrow.message, /hẹp/);
  assert.doesNotMatch(narrow.message, /không nhận ra/);
  assert.match(unknown.message, /không nhận ra/);
  assert.doesNotMatch(unknown.message, /hẹp/);
});

test('scanTranscriptPanel — bỏ qua panel transcript giả nằm trong giao diện của extension', () => {
  const root = el('div', {}, [
    el('div', { id: 'nblm-panel' }, [
      el('transcript-segment-view-model', {}, [
        el('div', { class: 'segment-timestamp' }, ['0:01']),
        el('div', { class: 'segment-text' }, ['bản sao của chính mình']),
      ]),
    ]),
  ]);
  const result = T.scanTranscriptPanel(root);
  assert.equal(result.ok, false);
});

// --------------------------------------------- đường DOM: một lần thử lại với tab kích hoạt

/** Trang giả cho `viaDom`: `results` là kết quả quét lần lượt của từng lần gọi. */
function fakePage(results) {
  const calls = [];
  return {
    calls,
    async scan(opts) {
      calls.push({ stage: 'scan', activated: opts.activated });
      return results[calls.filter((c) => c.stage === 'scan').length - 1];
    },
    async activate() {
      calls.push({ stage: 'activate' });
    },
  };
}

const okScan = (segments) => ({ ok: true, segments });
const failScan = (reason, message) => ({ ok: false, reason, message: message || reason });

test('viaDom — quét được ngay lần đầu thì không kích hoạt tab', async () => {
  const page = fakePage([okScan([{ start: 1, text: 'a' }])]);
  const segments = await T.viaDom({ videoId: 'aaaaaaaaaaa' }, page);

  assert.deepEqual(segments, [{ start: 1, text: 'a' }]);
  assert.deepEqual(page.calls, [{ stage: 'scan', activated: false }]);
});

test('viaDom — panel chưa dựng xong thì kích hoạt tab rồi quét lại, đúng một lần', async () => {
  const page = fakePage([failScan(T.REASON.EMPTY), okScan([{ start: 2, text: 'b' }])]);
  const segments = await T.viaDom({ videoId: 'aaaaaaaaaaa' }, page);

  assert.deepEqual(segments, [{ start: 2, text: 'b' }]);
  assert.deepEqual(page.calls, [
    { stage: 'scan', activated: false },
    { stage: 'activate' },
    { stage: 'scan', activated: true },
  ]);
});

test('viaDom — thử lại vẫn hỏng thì ném lỗi, không thử lần thứ ba', async () => {
  const page = fakePage([failScan(T.REASON.EMPTY), failScan(T.REASON.NO_PANEL, 'không mở được panel')]);
  await assert.rejects(() => T.viaDom({ videoId: 'aaaaaaaaaaa' }, page), /không mở được panel/);
  assert.equal(page.calls.filter((c) => c.stage === 'scan').length, 2);
});

test('viaDom — cửa sổ quá hẹp thì báo ngay: kích hoạt tab không làm cửa sổ rộng ra', async () => {
  const page = fakePage([failScan(T.REASON.NARROW, 'cửa sổ quá hẹp: panel bị giữ ẩn')]);
  await assert.rejects(
    () => T.viaDom({ videoId: 'aaaaaaaaaaa' }, page),
    (error) => {
      assert.match(error.message, /cửa sổ quá hẹp/);
      assert.equal(error.reason, T.REASON.NARROW);
      return true;
    },
  );
  assert.deepEqual(page.calls, [{ stage: 'scan', activated: false }]);
});

test('viaDom — "panel mở mà không nhận ra" vẫn được kích hoạt tab rồi quét lại, khác hẳn cửa sổ hẹp', async () => {
  // Lối tắt của `viaDom` chỉ dành cho cửa sổ hẹp — chiều rộng không tự đổi vì mình chờ. Một lần
  // dò hụt selector thì khác: nó không được biến thành một lần bỏ cuộc (ticket 017).
  const page = fakePage([failScan(T.REASON.UNRECOGNIZED), okScan([{ start: 3, text: 'c' }])]);
  const segments = await T.viaDom({ videoId: 'aaaaaaaaaaa' }, page);

  assert.deepEqual(segments, [{ start: 3, text: 'c' }]);
  assert.deepEqual(page.calls, [
    { stage: 'scan', activated: false },
    { stage: 'activate' },
    { stage: 'scan', activated: true },
  ]);
});

// ------------------------------------------------- kỷ luật: selector chỉ ở một chỗ

test('transcript.js không chứa selector YouTube nào — mọi thứ dễ vỡ nằm ở selectors.js', () => {
  const source = readFileSync(new URL('../src/youtube/transcript.js', import.meta.url), 'utf8');
  // Bình luận được phép nhắc tên selector (chúng giải thích *vì sao*); phần chạy thì không.
  const code = source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    })
    .join('\n');

  const SELECTOR_SHAPED = /ytd-[\w-]+|yt-[\w-]+|[\w-]+-view-model|\.segment-[\w-]+|\[(?:class|id|data-[\w-]+|target-id|visibility|role|aria-[\w-]+)[\^*$~|]?=/g;
  const found = code.match(SELECTOR_SHAPED) || [];
  assert.deepEqual(found, [], `selector lọt ra ngoài selectors.js: ${found.join(', ')}`);
});

test('cây node giả trả về NodeList chứ không phải Array — nếu không, nó giấu lỗi thay vì lộ ra', () => {
  const list = el('div', {}, [el('button', {}, ['a'])]).querySelectorAll('button');
  assert.equal(list.length, 1);
  assert.equal(typeof list.forEach, 'function');
  assert.equal([...list].length, 1);
  for (const method of ['filter', 'map', 'every', 'some', 'reduce']) {
    assert.equal(list[method], undefined, `NodeList thật không có .${method}()`);
  }
});
