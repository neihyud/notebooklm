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
  return {
    calls,
    panel: make('panel'),
    innertube: make('innertube'),
    timedtext: make('timedtext'),
    dom: make('dom'),
  };
}

const seg = (start, end, text) => ({ start, end, text });

// ------------------------------------------------------------------ bộ định tuyến

test('routeFor — private đi thẳng đường DOM, không có đường API nào trong tuyến', () => {
  assert.deepEqual(T.routeFor('private'), ['dom']);
});

/**
 * Thứ tự này là số đo, không phải sở thích (ticket 013, ADR 0013): `get_panel` là endpoint mà
 * chính giao diện YouTube gọi và là đường duy nhất còn trả về segment trên trang thật, còn
 * `get_transcript` trả HTTP 400 với mọi loại `params`. `timedtext` không còn trong tuyến.
 */
test('routeFor — unlisted/public thử get_panel trước, rồi InnerTube, cuối cùng mới DOM', () => {
  assert.deepEqual(T.routeFor('unlisted'), ['panel', 'innertube', 'dom']);
  assert.deepEqual(T.routeFor('public'), ['panel', 'innertube', 'dom']);
});

test('routeFor — timedtext đã ra khỏi tuyến: đo được HTTP 200 body rỗng ở mọi video', () => {
  for (const privacy of ['public', 'unlisted', 'private', undefined]) {
    assert.ok(!T.routeFor(privacy).includes('timedtext'), `timedtext còn trong tuyến của ${String(privacy)}`);
  }
});

test('fetchTranscript — video private KHÔNG BAO GIỜ gọi adapter API nào (ADR 0003)', async () => {
  const paths = fakePaths({ panel: [seg(0, 1, 'PANEL')], innertube: [seg(0, 1, 'API')], dom: [seg(0, 1, 'DOM')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'private' }, paths);

  assert.deepEqual(paths.calls, ['dom']);
  assert.equal(out.via, 'dom');
  assert.deepEqual(out.segments, [seg(0, 1, 'DOM')]);
});

test('fetchTranscript — unlisted dừng ở get_panel khi get_panel trả về được', async () => {
  const paths = fakePaths({ panel: [seg(0, 1, 'PANEL')], innertube: [seg(0, 1, 'API')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'unlisted' }, paths);

  assert.deepEqual(paths.calls, ['panel']);
  assert.equal(out.via, 'panel');
  assert.deepEqual(out.segments, [seg(0, 1, 'PANEL')]);
});

test('fetchTranscript — get_panel hỏng thì rơi sang InnerTube, không rơi thẳng xuống DOM', async () => {
  const paths = fakePaths({ innertube: [seg(0, 1, 'API')], dom: [seg(0, 1, 'DOM')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'public' }, paths);

  assert.deepEqual(paths.calls, ['panel', 'innertube']);
  assert.equal(out.via, 'innertube');
  assert.deepEqual(out.segments, [seg(0, 1, 'API')]);
});

test('fetchTranscript — hai đường API hỏng thì mới tới DOM, và nhật ký kể đủ ba lần thử', async () => {
  const paths = fakePaths({ dom: [seg(0, 1, 'DOM')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'public' }, paths);

  assert.deepEqual(paths.calls, ['panel', 'innertube', 'dom']);
  assert.equal(out.via, 'dom');
  assert.deepEqual(out.attempts.map((a) => [a.path, a.ok]), [
    ['panel', false], ['innertube', false], ['dom', true],
  ]);
});

test('fetchTranscript — đường trả về mảng rỗng bị coi là hỏng, đi tiếp đường sau', async () => {
  const paths = fakePaths({ panel: [], innertube: [seg(0, 1, 'API')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'public' }, paths);

  assert.equal(out.via, 'innertube');
});

/**
 * `reason` là câu chữ cho người đọc; `code` là dữ liệu cho máy đọc. Ticket 013 đòi phân biệt
 * "video không có phụ đề" với "gọi được mà không ra dòng nào" **ở tầng dữ liệu**, và `attempts`
 * là chỗ duy nhất hai thứ ấy đi ra khỏi lớp trích.
 */
test('fetchTranscript — nhật ký mang theo mã máy đọc được của từng lỗi, không chỉ câu chữ', async () => {
  const noCaptions = new Error('không có phụ đề');
  noCaptions.reason = T.REASON.NO_CAPTIONS;
  const blank = new Error('rỗng');
  blank.reason = T.REASON.BLANK;

  const paths = fakePaths({ panel: noCaptions, innertube: blank, dom: [seg(0, 1, 'DOM')] });
  const out = await T.fetchTranscript({ videoId: 'aaaaaaaaaaa', privacy: 'public' }, paths);

  assert.deepEqual(out.attempts.map((a) => a.code), [T.REASON.NO_CAPTIONS, T.REASON.BLANK, '']);
  assert.notEqual(T.REASON.NO_CAPTIONS, T.REASON.BLANK, 'hai ca này gộp mã là mất hẳn phép phân biệt');
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
  assert.deepEqual(paths.calls, ['panel', 'innertube', 'dom']);
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

// --------------------------------------------------------- get_panel (ticket 013)

/**
 * Một mục dòng thời gian mang chữ transcript, đúng hình dạng `/youtubei/v1/get_panel` trả về
 * (chép từ lượt đo trang thật ở ticket 013).
 */
const panelSegment = ({ start, timestamp, text, endpoint = true }) => ({
  macroMarkersPanelItemViewModel: {
    item: {
      timelineItemViewModel: {
        timestamp,
        contentItems: [{ transcriptSegmentViewModel: { simpleText: text, timestamp, style: 'TIMELINE_VIEW_STYLE_MODERN_INLINE_TIMESTAMPS' } }],
      },
    },
    ...(endpoint ? { onTap: { innertubeCommand: { watchEndpoint: { videoId: 'aaaaaaaaaaa', startTimeSeconds: start } } } } : {}),
  },
});

/**
 * Tiêu đề chương: **cùng kiểu mục, cùng có `watchEndpoint`, chỉ không có dòng chữ nào**. Đây là
 * phần tử "đặc biệt" của fixture và nó nằm ở **giữa** — ở đầu thì một hiện thực đọc `[0]` vẫn
 * lọt, ở cuối thì `at(-1)` vẫn lọt.
 */
const panelChapter = ({ start, title }) => ({
  macroMarkersPanelItemViewModel: {
    item: { timelineChapterViewModel: { title, style: 'TIMELINE_VIEW_STYLE_MODERN' } },
    onTap: { innertubeCommand: { watchEndpoint: { videoId: 'aaaaaaaaaaa', startTimeSeconds: start } } },
  },
});

const panelPayload = (items) => ({
  responseContext: { visitorData: 'v' },
  content: {
    engagementPanelSectionListRenderer: {
      content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } },
    },
  },
});

/** Ba dòng chữ và một tiêu đề chương xen giữa — mốc và chữ đều khác nhau đôi một. */
const FULL_PANEL = panelPayload([
  panelSegment({ start: 1, timestamp: '0:01', text: 'dòng đầu' }),
  panelChapter({ start: 30, title: 'Chương 1: Mở đầu' }),
  panelSegment({ start: 45, timestamp: '0:45', text: 'dòng giữa' }),
  panelSegment({ start: 70, timestamp: '1:10', text: 'dòng cuối' }),
]);

test('panelParams — đúng từng byte chuỗi mà chính trang YouTube gửi đi', () => {
  // Đo được trên trang thật (ticket 013): giao diện YouTube gửi đúng chuỗi này cho `jNQXAC9IVRw`.
  assert.equal(T.panelParams('jNQXAC9IVRw'), 'qgkPCgtqTlFYQUM5SVZSdxgB');
  assert.equal(T.panelParams('dQw4w9WgXcQ'), 'qgkPCgtkUXc0dzlXZ1hjURgB');
  assert.equal(T.panelParams(''), '');
});

/**
 * Mốc và chữ phải đọc **từ cùng một mục**. Một hiện thực gom hai lượt riêng rồi ghép theo chỉ số
 * sẽ lệch đúng một nấc kể từ tiêu đề chương — và kết quả vẫn là ba dòng transcript trông hoàn
 * toàn hợp lệ, chỉ là mỗi dòng mang mốc của dòng khác.
 */
test('parsePanelTranscript — tiêu đề chương xen giữa không làm lệch cặp mốc ↔ chữ', () => {
  assert.deepEqual(T.parsePanelTranscript(FULL_PANEL), [
    { start: 1, text: 'dòng đầu' },
    { start: 45, text: 'dòng giữa' },
    { start: 70, text: 'dòng cuối' },
  ]);
});

/**
 * `startTimeSeconds` và chuỗi mốc hiển thị là hai nguồn **cùng đơn vị** cho cùng một giá trị, và
 * trên trang thật chúng luôn bằng nhau — nên hoán vị chúng không làm hỏng lần chạy nào. Số đo
 * được thắng hình chiếu: chuỗi hiển thị phụ thuộc ngôn ngữ giao diện.
 */
test('parsePanelTranscript — mốc lấy từ số giây của watchEndpoint, không từ chuỗi hiển thị', () => {
  const payload = panelPayload([
    panelSegment({ start: 12, timestamp: '0:30', text: 'số và chuỗi lệch nhau' }),
  ]);
  assert.deepEqual(T.parsePanelTranscript(payload), [{ start: 12, text: 'số và chuỗi lệch nhau' }]);
});

/**
 * `Number(null)` là **0** — một con số hợp lệ lọt qua mọi phép kiểm `isFinite`. Một
 * `watchEndpoint: null` (khoá có mặt, giá trị rỗng) vì thế dễ thành "dòng này bắt đầu ở giây 0"
 * thay vì rơi về chuỗi mốc, và một dòng mốc 0 chen giữa transcript vẫn dựng ra file SRT mở lên
 * xem được. Fixture để mục ấy ở **giữa** để `[0]` và `at(-1)` đều không lọt.
 */
test('parsePanelTranscript — watchEndpoint rỗng vẫn rơi về chuỗi mốc, không thành giây 0', () => {
  const middle = panelSegment({ start: 0, timestamp: '3:15', text: 'mục giữa' });
  middle.macroMarkersPanelItemViewModel.onTap.innertubeCommand.watchEndpoint = null;
  const nulled = panelSegment({ start: 0, timestamp: '5:00', text: 'mục có startTimeSeconds rỗng' });
  nulled.macroMarkersPanelItemViewModel.onTap.innertubeCommand.watchEndpoint.startTimeSeconds = null;

  assert.deepEqual(T.parsePanelTranscript(panelPayload([
    panelSegment({ start: 12, timestamp: '0:12', text: 'mục đầu' }),
    middle,
    nulled,
    panelSegment({ start: 400, timestamp: '6:40', text: 'mục cuối' }),
  ])), [
    { start: 12, text: 'mục đầu' },
    { start: 195, text: 'mục giữa' },
    { start: 300, text: 'mục có startTimeSeconds rỗng' },
    { start: 400, text: 'mục cuối' },
  ]);
});

test('parsePanelTranscript — thiếu watchEndpoint thì mới đọc chuỗi mốc, và payload lạ ra rỗng', () => {
  const payload = panelPayload([
    panelSegment({ start: 0, timestamp: '1:05', text: 'không có endpoint', endpoint: false }),
  ]);
  assert.deepEqual(T.parsePanelTranscript(payload), [{ start: 65, text: 'không có endpoint' }]);
  assert.deepEqual(T.parsePanelTranscript({}), []);
  assert.deepEqual(T.parsePanelTranscript(null), []);
});

test('parsePanelTranscript — chữ dạng runs cũng đọc được, dòng trắng bị bỏ', () => {
  const blank = panelSegment({ start: 5, timestamp: '0:05', text: '   ' });
  const runs = panelSegment({ start: 9, timestamp: '0:09', text: '' });
  runs.macroMarkersPanelItemViewModel.item.timelineItemViewModel.contentItems[0].transcriptSegmentViewModel = {
    runs: [{ text: 'ghép ' }, { text: 'hai mảnh' }], timestamp: '0:09',
  };
  assert.deepEqual(T.parsePanelTranscript(panelPayload([blank, runs])), [{ start: 9, text: 'ghép hai mảnh' }]);
});

const panelNet = (payload) => {
  const sent = [];
  return { sent, async post(req) { sent.push(req); return payload; } };
};

const YTCFG = { apiKey: 'AIzaKEY', clientName: '1', clientVersion: '2.2026', hl: 'vi', gl: 'VN' };

test('viaPanel — gửi đúng panelId và params của video đang hỏi, không gửi header Authorization', async () => {
  const net = panelNet(FULL_PANEL);
  const segments = await T.viaPanel({
    videoId: 'aaaaaaaaaaa',
    privacy: 'public',
    ytcfg: YTCFG,
    // Nếu một ngày nào đó ai đó chuyền token vào đây, nó vẫn không được rời khỏi hàm này.
    authorization: 'SAPISIDHASH 111_bimat',
  }, net);

  assert.equal(segments.length, 3);
  assert.equal(net.sent.length, 1);
  assert.match(net.sent[0].url, /youtubei\/v1\/get_panel/);
  assert.match(net.sent[0].url, /[?&]key=AIzaKEY/);
  assert.equal(net.sent[0].body.panelId, T.PANEL_ID);
  assert.equal(net.sent[0].body.params, T.panelParams('aaaaaaaaaaa'));
  const headerNames = Object.keys(net.sent[0].headers).map((h) => h.toLowerCase());
  assert.ok(!headerNames.includes('authorization'), `lộ header: ${headerNames.join(', ')}`);
  assert.ok(!JSON.stringify(net.sent[0]).includes('bimat'), 'token rò vào request get_panel');
});

/**
 * Ticket 013, ràng buộc cứng: **HTTP 200 với 0 segment là HỎNG, không phải "video không có phụ
 * đề"**. Hai ca dưới đây cho cùng một triệu chứng và phải mang hai mã khác nhau — nếu không, một
 * lượt chạy "thành công" sẽ ghi vào Sổ đã import một video chưa hề trích được gì (ADR 0009).
 */
test('viaPanel — không có caption track thì báo NO_CAPTIONS và KHÔNG gọi mạng lần nào', async () => {
  const net = panelNet(FULL_PANEL);
  await assert.rejects(
    () => T.viaPanel({
      videoId: 'aaaaaaaaaaa',
      ytcfg: YTCFG,
      player: { videoId: 'aaaaaaaaaaa', captionTracks: [] },
    }, net),
    (error) => {
      // Neo cả **chuỗi thật**, không chỉ hằng số: hai mã này là hợp đồng dữ liệu đi ra ngoài lớp
      // trích (`attempts[].code`). Hoán vị hai giá trị cho nhau giữ nguyên mọi phép so sánh theo
      // tên hằng, nên một suite chỉ so theo tên hằng vẫn xanh trong khi máy đọc bên kia nhận
      // đúng câu trả lời ngược lại.
      assert.equal(error.reason, 'no-captions');
      assert.equal(error.reason, T.REASON.NO_CAPTIONS);
      return true;
    },
  );
  assert.deepEqual(net.sent, [], 'đã biết không có phụ đề mà vẫn tốn một lượt gọi mạng');
});

test('viaPanel — câu trả lời không có khối content là "video không có phụ đề"', async () => {
  const net = panelNet({ responseContext: {}, trackingParams: 'x' });
  await assert.rejects(
    () => T.viaPanel({ videoId: 'aaaaaaaaaaa', ytcfg: YTCFG }, net),
    (error) => {
      assert.equal(error.reason, T.REASON.NO_CAPTIONS);
      return true;
    },
  );
});

test('viaPanel — có content mà 0 dòng là HỎNG (BLANK), mang mã khác hẳn ca không có phụ đề', async () => {
  const net = panelNet(panelPayload([]));
  await assert.rejects(
    () => T.viaPanel({ videoId: 'aaaaaaaaaaa', ytcfg: YTCFG }, net),
    (error) => {
      assert.equal(error.reason, 'blank-response');
      assert.equal(error.reason, T.REASON.BLANK);
      assert.notEqual(error.reason, T.REASON.NO_CAPTIONS, 'gộp hai mã là mất phép phân biệt');
      return true;
    },
  );
  assert.equal(net.sent.length, 1);
});

/**
 * Đo được trên Chrome thật (ticket 013): sau một lần điều hướng SPA, `location.href` đã sang
 * video B mà `ytInitialPlayerResponse.videoDetails.videoId` vẫn là video A, kèm nguyên danh sách
 * caption track của A. Đây là hình lặp lại "một thứ của video A còn sống trên trang video B"
 * (`WORKSPACE_PROTOCOL.md`) — và nếu tin nó, mọi video B sau một lần điều hướng SPA sẽ bị tuyên
 * là "không có phụ đề" dựa trên dữ liệu của video A.
 */
test('viaPanel — ảnh chụp playerResponse của video KHÁC bị bỏ qua, không bị tin cũng không thành lỗi', async () => {
  const net = panelNet(FULL_PANEL);
  const segments = await T.viaPanel({
    videoId: 'bbbbbbbbbbb',
    ytcfg: YTCFG,
    player: { videoId: 'aaaaaaaaaaa', captionTracks: [] },
  }, net);

  assert.equal(segments.length, 3, 'ảnh chụp của video A đã tuyên video B không có phụ đề');
  assert.equal(net.sent[0].body.params, T.panelParams('bbbbbbbbbbb'), 'params phải theo video đang hỏi');
});

test('viaPanel — thiếu ytcfg hoặc thiếu adapter mạng thì hỏng ngay, không gọi mạng', async () => {
  const net = panelNet(FULL_PANEL);
  await assert.rejects(() => T.viaPanel({ videoId: 'aaaaaaaaaaa' }, net), /ytcfg/i);
  await assert.rejects(() => T.viaPanel({ videoId: 'aaaaaaaaaaa', ytcfg: YTCFG }, {}), /adapter mạng/i);
  await assert.rejects(() => T.viaPanel({ ytcfg: YTCFG }, net), /video nào/i);
  assert.deepEqual(net.sent, []);
});

// ------------------------------------- context.client của InnerTube (ticket 013, vòng 2)

/**
 * `hl` ↔ `gl` là cặp hoán vị được mà cả hai cổng của ticket 013 đều bỏ lọt: hai chuỗi cùng kiểu,
 * lấy từ **cùng một** đối tượng `ytcfg`, đi vào hai trường nằm cạnh nhau. Đổi chỗ chúng thì
 * `bash test/run.sh` vẫn xanh và `tools/verify-live.mjs` vẫn xanh 100% chữ trùng — vì phép đo
 * trang thật chỉ chạy trên video tiếng Anh với giao diện tiếng Anh, nơi gửi sai cả hai trường
 * vẫn rơi về đúng một kết quả. Đó là fixture n=1 của ticket 017 dời sang **lựa chọn video**.
 *
 * Nên chỗ canh phải là đây, ở tầng dữ liệu, với giá trị phân biệt được — không phải đi tìm một
 * video đa ngữ. `hl` chọn ngôn ngữ bản transcript trả về: hoán vị nó lấy về bản sai ngôn ngữ mà
 * request vẫn 200, vẫn có segment, mốc vẫn tăng dần, Nguồn vẫn dựng, và tên Nguồn là vĩnh viễn
 * (ADR 0010).
 *
 * Bốn giá trị dưới đây khác nhau đôi một và **không giá trị nào trùng giá trị lui**, để một
 * phép hoán vị không thể ẩn sau một mặc định.
 */
const YTCFG_DISTINCT = Object.freeze({
  apiKey: 'AIzaKEY',
  clientName: '1',
  clientVersion: '2.20260822.01.00',
  hl: 'de',
  gl: 'CH',
});

test('innertubeClient — từng trường ytcfg vào đúng trường context: hl là ngôn ngữ, gl là quốc gia', () => {
  assert.deepEqual(T.innertubeClient(YTCFG_DISTINCT), {
    clientName: 'WEB',
    clientVersion: '2.20260822.01.00',
    hl: 'de',
    gl: 'CH',
  });
});

test('innertubeClient — thiếu hl/gl thì lui về ngôn ngữ vi và quốc gia VN, không đổi chỗ cho nhau', () => {
  // Hai giá trị lui cũng là một cặp hoán vị được, và chúng chỉ khác nhau ở chữ hoa: `hl: 'VN'`
  // là một mã ngôn ngữ không tồn tại, còn `gl: 'vi'` là một mã quốc gia không tồn tại — cả hai
  // đều không làm YouTube trả lỗi, nó chỉ lặng lẽ chọn mặc định khác.
  const client = T.innertubeClient({ apiKey: 'k', clientName: '1', clientVersion: '2.2026' });
  assert.equal(client.hl, 'vi');
  assert.equal(client.gl, 'VN');
});

test('innertubeClient — clientName là TÊN trong context, và ytcfg khai tên khác "1" thì giữ nguyên', () => {
  assert.equal(T.innertubeClient({ clientName: '1' }).clientName, 'WEB');
  assert.equal(T.innertubeClient({}).clientName, 'WEB');
  assert.equal(T.innertubeClient({ clientName: 'MWEB' }).clientName, 'MWEB');
});

test('innertubeHeaders — X-Youtube-Client-Name mang CON SỐ, Client-Version mang chuỗi phiên bản', () => {
  // Cặp cùng kiểu thứ hai: hai header cạnh nhau, cùng lấy từ `ytcfg`, cùng là chuỗi. Hoán vị
  // chúng thì `clientName` thành `'2.20260822.01.00'` và `clientVersion` thành `'1'` — hình dạng
  // vẫn hợp lệ. Và cặp thứ ba, chéo giữa hai chỗ: header mang `'1'` còn `context.client` mang
  // `'WEB'`; lấy nhầm bản của nhau thì không header nào thiếu, chỉ sai giá trị.
  assert.deepEqual(T.innertubeHeaders(YTCFG_DISTINCT), {
    'Content-Type': 'application/json',
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': '2.20260822.01.00',
  });
  assert.notEqual(
    T.innertubeHeaders(YTCFG_DISTINCT)['X-Youtube-Client-Name'],
    T.innertubeClient(YTCFG_DISTINCT).clientName,
    'header mang con số, context mang tên — trùng nhau nghĩa là một trong hai lấy nhầm bản của bên kia',
  );
  // Giá trị lui của hai header cũng phải chốt riêng: `YTCFG_DISTINCT` khai sẵn `clientName: '1'`,
  // đúng bằng giá trị lui, nên với riêng nó thì bỏ hẳn giá trị lui đi vẫn ra cùng một kết quả.
  assert.deepEqual(T.innertubeHeaders({}), {
    'Content-Type': 'application/json',
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': '',
  });
});

test('innertubeHeaders — không có Authorization, và không nhận đường nào để chuyền lén vào', () => {
  const headers = T.innertubeHeaders({ ...YTCFG_DISTINCT, authorization: 'SAPISIDHASH 111_bimat' });
  const names = Object.keys(headers).map((h) => h.toLowerCase());
  assert.ok(!names.includes('authorization'), `lộ header: ${names.join(', ')}`);
  assert.ok(!JSON.stringify(headers).includes('bimat'));
});

test('get_panel và get_transcript dùng CHUNG một khối context — không phải hai bản chép tay', async () => {
  // Trước vòng này, khối `context.client` có hai bản giống hệt nhau trong cùng `transcript.js`.
  // Test này chết nếu ai đó sửa một bản mà bản kia lệch đi — đúng loại nợ ticket 014 vừa dọn.
  //
  // Ba `ytcfg`, và hai cái sau **thiếu dần các trường**: một bản chép tay thứ hai thường lệch
  // đúng ở giá trị lui chứ không ở giá trị có sẵn — `String(cfg.hl || 'en')` trùng bản gốc với
  // mọi ytcfg đủ trường. Đo thật: với riêng fixture đủ trường, hai phép hoán vị kiểu đó (một ở
  // `context`, một ở header) sống sót cả bộ test. Nên fixture cuối chỉ còn `apiKey`.
  for (const cfg of [
    YTCFG_DISTINCT,
    { apiKey: 'AIzaKEY', clientName: '1', clientVersion: '2.2026' },
    { apiKey: 'AIzaKEY' },
  ]) {
    const panel = panelNet(FULL_PANEL);
    await T.viaPanel({ videoId: 'aaaaaaaaaaa', ytcfg: cfg }, panel);

    const inner = panelNet(innertubePayload([{ startMs: 0, endMs: 1000, runs: ['ok'] }]));
    await T.viaInnertube({ videoId: 'aaaaaaaaaaa', ytcfg: cfg }, inner);

    assert.deepEqual(panel.sent[0].body.context, inner.sent[0].body.context);
    assert.deepEqual(panel.sent[0].headers, inner.sent[0].headers);
    // Và cả hai phải là **đúng** khối ấy, không chỉ là "giống nhau": hai bản cùng sai vẫn bằng nhau.
    assert.deepEqual(panel.sent[0].body.context, { client: T.innertubeClient(cfg) });
    assert.deepEqual(panel.sent[0].headers, T.innertubeHeaders(cfg));
  }

  const panel = panelNet(FULL_PANEL);
  await T.viaPanel({ videoId: 'aaaaaaaaaaa', ytcfg: YTCFG_DISTINCT }, panel);
  assert.deepEqual(panel.sent[0].body.context.client, {
    clientName: 'WEB', clientVersion: '2.20260822.01.00', hl: 'de', gl: 'CH',
  });
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

/**
 * Gán bề rộng đo được cho một node của cây giả — cây giả trả 0 cho mọi node chưa gắn vào trang.
 * `null` nghĩa là **không đo được**: node không có phương thức ấy.
 */
const withWidth = (node, width) => {
  node.getBoundingClientRect = width === null
    ? null
    : () => ({ x: 0, y: 0, width, height: 40, top: 0, right: width, bottom: 40, left: 0 });
  return node;
};

/**
 * Trang chỉ có panel transcript **đang ẩn**, không một dòng segment nào — hình của cửa sổ hẹp.
 *
 * Nhận một bề rộng cho **mỗi** panel, vì đó là chỗ duy nhất phân biệt được vai trò của phép rút
 * gọn trên `widths`: với một panel thì `max`, `min`, `widths[0]` và `widths.at(-1)` là cùng một
 * số. Dump live của ticket 017 cho ba panel bề rộng 0px / 494px / 0px.
 */
const hiddenOnlyPage = (widths = [0]) =>
  el('div', { id: 'page' }, widths.map((width) => withWidth(el('ytd-engagement-panel-section-list-renderer', {
    'target-id': 'engagement-panel-searchable-transcript',
    visibility: 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN',
  }, []), width)));

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
  const result = T.scanTranscriptPanel(hiddenOnlyPage([494]), { opened: true });
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

test('scanTranscriptPanel — CÒN một panel chiếm bề rộng là chưa hẹp, dù mọi panel khác đo ra 0px', () => {
  // Vai trò của phép rút gọn trên `widths` là **"có panel nào chiếm chỗ không"**, không phải
  // "panel hẹp nhất rộng bao nhiêu". Hai vai trò ấy chỉ khác nhau khi có từ hai panel ẩn trở
  // lên — và trang thật đúng là như thế: dump live của ticket 017 cho ba panel 0px / 494px /
  // 0px. Một panel thì `max`, `min`, `widths[0]`, `widths.at(-1)` là cùng một số, nên fixture
  // phải cho các bề rộng **khác nhau** và đặt panel rộng ở giữa.
  const result = T.scanTranscriptPanel(hiddenOnlyPage([0, 494, 0]), { opened: true });

  assert.equal(result.ok, false);
  assert.notEqual(result.reason, T.REASON.NARROW,
    'một panel 494px vẫn chiếm chỗ, nhưng lượt chạy bị cắt đường lui vì "cửa sổ quá hẹp"');
  assert.equal(result.reason, T.REASON.EMPTY);
  assert.match(result.message, /494/, 'nói bề rộng của panel không chiếm chỗ nào thay vì panel đang chiếm chỗ');
});

test('scanTranscriptPanel — quan hệ: mọi panel 0px mới là hẹp, thêm đúng một panel chiếm chỗ là hết hẹp', () => {
  // Hai fixture chỉ khác nhau ở bề rộng của panel giữa. Đây là quan hệ cần canh, không phải con
  // số: ngưỡng hay đổi, còn "hễ còn một panel chiếm chỗ thì đừng nói cửa sổ hẹp" thì không.
  const allZero = T.scanTranscriptPanel(hiddenOnlyPage([0, 0, 0]), { opened: true });
  const oneWide = T.scanTranscriptPanel(hiddenOnlyPage([0, 494, 0]), { opened: true });

  assert.equal(allZero.reason, T.REASON.NARROW);
  assert.notEqual(oneWide.reason, allZero.reason);
});

test('scanTranscriptPanel — còn một panel KHÔNG đo được bề rộng là chưa đủ căn cứ nói cửa sổ hẹp', () => {
  // `some` chứ không `every`: một panel không đo được thì không loại trừ được khả năng nó đang
  // chiếm chỗ, nên chưa được cắt đường lui. Với một panel thì hai phép ấy cho cùng kết quả.
  const result = T.scanTranscriptPanel(hiddenOnlyPage([null, 0]), { opened: true });

  assert.equal(result.ok, false);
  assert.notEqual(result.reason, T.REASON.NARROW, 'kết luận cửa sổ hẹp khi còn một panel chưa đo được');
  assert.equal(result.reason, T.REASON.EMPTY);
  assert.match(result.message, /không đo được/);
});

test('scanTranscriptPanel — câu "không nhận ra" đếm đúng số dòng segment lạc, không đếm số panel', () => {
  const result = T.scanTranscriptPanel(livePanelPage([
    segmentNode('0:00', 'một'),
    segmentNode('0:02', 'hai'),
    segmentNode('0:04', 'ba'),
  ], 'PAmodern_caption_view'), { opened: true });

  assert.equal(result.reason, T.REASON.UNRECOGNIZED);
  assert.match(result.message, /\b3 dòng segment\b/, `đếm sai: ${result.message}`);
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
