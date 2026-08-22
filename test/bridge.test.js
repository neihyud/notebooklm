// Ticket 002 — cầu MAIN world và lớp bọc postMessage.
//
// Đây là chỗ ranh giới của `WORKSPACE_PROTOCOL.md` sống: header `Authorization: SAPISIDHASH`
// mượn được của YouTube **chỉ dùng để liệt kê playlist**, không cho transcript (ADR 0003).
// Ranh giới đó không phải một dòng bình luận — phần lớn test dưới đây là để nó có răng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/youtube/bridge-protocol.js';
import '../src/youtube/page-bridge.js';
import '../src/youtube/bridge-client.js';

const P = globalThis.NBLM_BRIDGE_PROTOCOL;
const B = globalThis.NBLM_PAGE_BRIDGE;
const C = globalThis.NBLM_BRIDGE_CLIENT;

const TOKEN = 'SAPISIDHASH 1755000000_bimatcuaowner';

// ------------------------------------------------------------------ phạm vi của cầu

test('cầu MAIN world phục vụ đúng ba việc — thêm việc thứ tư là quyết định của Lead', () => {
  assert.deepEqual([...P.OPS].sort(), ['listPlaylist', 'playerResponse', 'ytcfg']);
});

/**
 * Ranh giới của `WORKSPACE_PROTOCOL.md` v4 là **auth, không phải số op**, nên test canh *quan hệ*
 * chứ không đếm: mọi op cầu phục vụ, trừ đúng `listPlaylist`, đều không được mượn header. Viết
 * theo `P.OPS` thay vì theo một danh sách chép tay là để op thứ tư thêm vào ngày mai cũng bị
 * cùng phép kiểm này chặn nếu ai đó nhét nó vào `AUTH_OPS`.
 */
test('chỉ liệt kê playlist mới được mượn header Authorization — kể cả khi cầu có thêm op mới', () => {
  assert.deepEqual(P.AUTH_OPS, ['listPlaylist']);
  assert.equal(P.allowsAuth('listPlaylist'), true);

  const borrowed = P.OPS.filter((op) => P.allowsAuth(op));
  assert.deepEqual(borrowed, ['listPlaylist'], `op được mượn header oan: ${borrowed.join(', ')}`);

  for (const op of ['ytcfg', 'playerResponse', 'transcript', 'getTranscript', '', null]) {
    assert.equal(P.allowsAuth(op), false, `op được mượn header oan: ${String(op)}`);
  }
});

test('authHeadersFor — op không phải liệt kê playlist thì không nhận header, dù token có sẵn', () => {
  assert.deepEqual(B.authHeadersFor('listPlaylist', TOKEN), { Authorization: TOKEN });
  for (const op of P.OPS.filter((op) => op !== 'listPlaylist').concat(['transcript', 'get_transcript'])) {
    assert.deepEqual(B.authHeadersFor(op, TOKEN), {}, `lộ header ở op ${op}`);
  }
  assert.deepEqual(B.authHeadersFor('listPlaylist', ''), {}, 'chưa mượn được thì không bịa ra');
});

// ------------------------------------------------------------------ đọc ytcfg

/** `ytcfg` thật là một object có `.get(key)`, và bên trong nó có cả thứ không được rời khỏi trang. */
const fakeYtcfg = () => ({
  data_: {
    INNERTUBE_API_KEY: 'AIzaSyKEY',
    INNERTUBE_CLIENT_NAME: '1',
    INNERTUBE_CLIENT_VERSION: '2.20260819.01.00',
    INNERTUBE_CONTEXT: { client: { hl: 'vi', gl: 'VN', visitorData: 'VISITOR_BIMAT' } },
    DELEGATED_SESSION_ID: 'SESSION_BIMAT',
    ID_TOKEN: 'IDTOKEN_BIMAT',
    SAPISID: 'SAPISID_BIMAT',
  },
  get(key) {
    return this.data_[key];
  },
});

test('ytcfgSnapshot — lấy đúng những trường InnerTube cần, đúng trường nào vào đúng chỗ nấy', () => {
  const snapshot = B.ytcfgSnapshot(fakeYtcfg());
  assert.deepEqual(snapshot, {
    apiKey: 'AIzaSyKEY',
    clientName: '1',
    clientVersion: '2.20260819.01.00',
    hl: 'vi',
    gl: 'VN',
  });
});

test('ytcfgSnapshot — danh sách trắng: mọi thứ khác không rời khỏi trang', () => {
  const snapshot = B.ytcfgSnapshot(fakeYtcfg());
  const dumped = JSON.stringify(snapshot);
  for (const secret of ['SESSION_BIMAT', 'IDTOKEN_BIMAT', 'SAPISID_BIMAT', 'VISITOR_BIMAT']) {
    assert.ok(!dumped.includes(secret), `ytcfgSnapshot mang theo ${secret}`);
  }
});

test('ytcfgSnapshot — ytcfg dạng object thuần cũng đọc được, thiếu thì ra chuỗi rỗng', () => {
  assert.equal(B.ytcfgSnapshot({ INNERTUBE_API_KEY: 'k' }).apiKey, 'k');
  assert.deepEqual(B.ytcfgSnapshot(null), { apiKey: '', clientName: '', clientVersion: '', hl: '', gl: '' });
});

// ------------------------------------------------- đọc ytInitialPlayerResponse (ticket 013)

/**
 * `ytInitialPlayerResponse` thật — rút gọn, nhưng giữ đủ những thứ **không được rời khỏi trang**:
 * URL phát đã ký, `visitorData`, và cấu hình player.
 *
 * Ba caption track chứ không một: `playerResponseSnapshot` rút một danh sách thành một danh sách
 * khác, và ở n=1 thì `map`, `[0]`, `filter` cho cùng kết quả. Track "đặc biệt" (`kind: 'asr'`,
 * tên dạng `runs` thay vì `simpleText`) nằm ở **giữa** — ở đầu thì `[0]` lọt, ở cuối thì `at(-1)`
 * lọt.
 */
const fakePlayerResponse = () => ({
  videoDetails: { videoId: 'aaaaaaaaaaa', title: 'Tiêu đề', author: 'Kênh' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://youtube.com/api/timedtext?signature=CHUKY_BIMAT' },
        { languageCode: 'vi', kind: 'asr', name: { runs: [{ text: 'Tiếng Việt ' }, { text: '(tự động)' }] }, baseUrl: 'https://youtube.com/api/timedtext?signature=CHUKY_BIMAT' },
        { languageCode: 'de', name: { simpleText: 'Deutsch' }, baseUrl: 'https://youtube.com/api/timedtext?signature=CHUKY_BIMAT' },
      ],
    },
  },
  streamingData: { formats: [{ url: 'https://rr1.googlevideo.com/videoplayback?sig=CHUKY_BIMAT' }] },
  responseContext: { visitorData: 'VISITOR_BIMAT' },
  playerConfig: { audioConfig: { loudnessDb: 1 } },
});

test('playerResponseSnapshot — mang ra đúng danh tính video và danh sách caption track', () => {
  assert.deepEqual(B.playerResponseSnapshot(fakePlayerResponse()), {
    videoId: 'aaaaaaaaaaa',
    captionTracks: [
      { languageCode: 'en', kind: '', name: 'English' },
      { languageCode: 'vi', kind: 'asr', name: 'Tiếng Việt (tự động)' },
      { languageCode: 'de', kind: '', name: 'Deutsch' },
    ],
  });
});

test('playerResponseSnapshot — danh sách trắng: URL đã ký và visitorData không rời khỏi trang', () => {
  const dumped = JSON.stringify(B.playerResponseSnapshot(fakePlayerResponse()));
  for (const secret of ['CHUKY_BIMAT', 'VISITOR_BIMAT', 'googlevideo', 'timedtext']) {
    assert.ok(!dumped.includes(secret), `playerResponseSnapshot mang theo ${secret}`);
  }
});

test('playerResponseSnapshot — video không có phụ đề ra danh sách rỗng, không ra undefined', () => {
  assert.deepEqual(B.playerResponseSnapshot({ videoDetails: { videoId: 'bbbbbbbbbbb' } }), {
    videoId: 'bbbbbbbbbbb',
    captionTracks: [],
  });
  assert.deepEqual(B.playerResponseSnapshot(null), { videoId: '', captionTracks: [] });
});

test('handleRequest — playerResponse trả ảnh chụp, và KHÔNG chạm mạng lần nào', async () => {
  const deps = fakeDeps();
  const response = await B.handleRequest({ op: 'playerResponse', params: {} }, deps);

  assert.equal(response.ok, true);
  assert.equal(response.result.videoId, 'aaaaaaaaaaa');
  assert.equal(response.result.captionTracks.length, 3);
  assert.deepEqual(deps.calls, [], 'op chỉ đọc biến của trang mà lại gửi request đi');
});

/**
 * Nhánh cuối của `handleRequest` khai tên `listPlaylist` chứ không phải "còn lại thì...".
 *
 * Test này canh đúng cái sai mà câu chữ ấy chặn: một op **mới thêm vào `OPS` mà quên nhánh xử
 * lý** sẽ rơi xuống nhánh cuối, và nếu nhánh cuối là mặc định thì nó lặng lẽ thành một request
 * `browse` mang theo header `Authorization` mượn được. Vì thế phép kiểm chạy theo `P.OPS` chứ
 * không theo danh sách chép tay: op thứ tư thêm vào ngày mai cũng phải đi qua đây.
 */
test('handleRequest — chỉ listPlaylist được gửi request; op nào khác chạm mạng là hở', async () => {
  for (const op of P.OPS) {
    const deps = fakeDeps();
    const response = await B.handleRequest({ op, params: {} }, deps);
    if (op === 'listPlaylist') {
      assert.equal(deps.calls.length, 1, 'liệt kê playlist vẫn phải gọi mạng');
      continue;
    }
    assert.deepEqual(deps.calls, [], `op "${op}" chạm mạng — nhánh cuối đang nuốt op không có người xử lý`);
    assert.equal(response.ok, true, `op "${op}" khai trong OPS mà không ai trả lời`);
  }
});

// ------------------------------------------------------------------ mượn header

test('captureAuth — chỉ nhặt header của chính request InnerTube, không nhặt của mọi nơi', () => {
  assert.equal(B.captureAuth('https://www.youtube.com/youtubei/v1/browse', { Authorization: TOKEN }), TOKEN);
  assert.equal(B.captureAuth('https://www.youtube.com/youtubei/v1/browse', { authorization: TOKEN }), TOKEN);
  assert.equal(B.captureAuth('https://www.youtube.com/youtubei/v1/browse', [['authorization', TOKEN]]), TOKEN);
  assert.equal(B.captureAuth('https://example.com/api', { Authorization: TOKEN }), '');
  assert.equal(B.captureAuth('https://www.youtube.com/youtubei/v1/browse', { 'X-Goog-Visitor-Id': 'v' }), '');
  assert.equal(B.captureAuth('https://www.youtube.com/youtubei/v1/browse', null), '');
});

// ------------------------------------------------------------------ điều phối tin

/** Bộ phụ thuộc giả của cầu: ghi lại mọi lần gọi mạng để đo được cái gì đã đi ra khỏi trang. */
function fakeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    ytcfg: fakeYtcfg(),
    playerResponse: fakePlayerResponse(),
    borrowedAuth: TOKEN,
    async fetchJson(req) {
      calls.push(req);
      return { contents: 'playlist' };
    },
    ...overrides,
  };
}

test('handleRequest — liệt kê playlist là chỗ duy nhất header mượn được đi ra', async () => {
  const deps = fakeDeps();
  const response = await B.handleRequest({ op: 'listPlaylist', params: { browseId: 'VLWL' } }, deps);

  assert.equal(response.ok, true);
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0].headers.Authorization, TOKEN);
  assert.match(deps.calls[0].url, /youtubei\/v1\/browse/);
  assert.equal(deps.calls[0].body.browseId, 'VLWL');
});

test('handleRequest — request browse đúng hình dạng InnerTube: key ở query, client không mang apiKey', async () => {
  const deps = fakeDeps();
  await B.handleRequest({ op: 'listPlaylist', params: { browseId: 'VLWL' } }, deps);
  const sent = deps.calls[0];

  assert.match(sent.url, /[?&]key=AIzaSyKEY/);
  assert.deepEqual(sent.body.context.client, {
    clientName: 'WEB',
    clientVersion: '2.20260819.01.00',
    hl: 'vi',
    gl: 'VN',
  });
  assert.equal(sent.headers['X-Youtube-Client-Name'], '1');
});

test('handleRequest — hỏi transcript qua cầu thì bị từ chối, và không có cú gọi mạng nào', async () => {
  const deps = fakeDeps();
  for (const op of ['transcript', 'get_transcript', 'getTranscript', 'fetch']) {
    const response = await B.handleRequest({ op, params: { videoId: 'aaaaaaaaaaa' } }, deps);
    assert.equal(response.ok, false, `cầu nhận op ngoài phạm vi: ${op}`);
    assert.match(response.error, /phạm vi/i);
  }
  assert.deepEqual(deps.calls, [], 'op ngoài phạm vi vẫn chạm mạng');
});

test('handleRequest — mọi op cầu phục vụ đều không trả token về cho content script', async () => {
  const deps = fakeDeps();
  for (const op of P.OPS) {
    const response = await B.handleRequest({ op, params: {} }, deps);
    assert.ok(!JSON.stringify(response).includes('bimat'), `op ${op} trả token về phía content script`);
  }
});

test('handleRequest — chưa mượn được header thì liệt kê playlist báo lỗi, không gửi request trần', async () => {
  const deps = fakeDeps({ borrowedAuth: '' });
  const response = await B.handleRequest({ op: 'listPlaylist', params: {} }, deps);

  assert.equal(response.ok, false);
  assert.match(response.error, /chưa mượn được/i);
  assert.deepEqual(deps.calls, []);
});

test('handleRequest — lỗi mạng thành lời, không thành một promise treo', async () => {
  const deps = fakeDeps({ async fetchJson() { throw new Error('mạng chết'); } });
  const response = await B.handleRequest({ op: 'listPlaylist', params: {} }, deps);
  assert.equal(response.ok, false);
  assert.match(response.error, /mạng chết/);
});

// ------------------------------------------------------------------ bọc postMessage

function fakeWindow() {
  const listeners = [];
  const posted = [];
  const win = {
    posted,
    listeners,
    addEventListener(type, fn) {
      if (type === 'message') listeners.push(fn);
    },
    removeEventListener(type, fn) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage(data) {
      posted.push(data);
    },
    /** Giả lập một tin tới. `source` mặc định là chính cửa sổ này, như cầu MAIN world thật. */
    deliver(data, source) {
      for (const fn of [...listeners]) fn({ data, source: source === undefined ? win : source });
    },
  };
  return win;
}

/** Đồng hồ giả — timeout phải kiểm được mà không phải chờ thật. */
function fakeClock() {
  const timers = new Map();
  let seq = 0;
  return {
    setTimeout(fn, ms) {
      timers.set(++seq, { fn, ms });
      return seq;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fireAll() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.fn();
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

function makeClient(win, extra = {}) {
  const clock = fakeClock();
  let n = 0;
  const client = C.createBridgeClient({
    window: win,
    timeoutMs: 5000,
    newId: () => `id-${++n}`,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    ...extra,
  });
  return { client, clock };
}

const answer = (id, result) => ({ tag: P.RESPONSE, id, ok: true, result });

test('request — gửi đi đúng op và trả về kết quả của cầu', async () => {
  const win = fakeWindow();
  const { client } = makeClient(win);

  const promise = client.request('ytcfg', { a: 1 });
  assert.deepEqual(win.posted, [{ tag: P.REQUEST, id: 'id-1', op: 'ytcfg', params: { a: 1 } }]);

  win.deliver(answer('id-1', { apiKey: 'k' }));
  assert.deepEqual(await promise, { apiKey: 'k' });
});

test('request — hai lượt hỏi cùng lúc, trả lời về ngược thứ tự: mỗi lượt nhận đúng phần của mình', async () => {
  const win = fakeWindow();
  const { client } = makeClient(win);

  const first = client.request('ytcfg', { which: 'first' });
  const second = client.request('listPlaylist', { which: 'second' });
  assert.deepEqual(win.posted.map((m) => m.id), ['id-1', 'id-2']);

  win.deliver(answer('id-2', 'của lượt hai'));
  win.deliver(answer('id-1', 'của lượt một'));

  assert.equal(await first, 'của lượt một');
  assert.equal(await second, 'của lượt hai');
});

test('request — cầu báo lỗi thì promise hỏng kèm đúng lời của cầu', async () => {
  const win = fakeWindow();
  const { client } = makeClient(win);

  const promise = client.request('transcript');
  win.deliver({ tag: P.RESPONSE, id: 'id-1', ok: false, error: 'ngoài phạm vi của cầu' });

  await assert.rejects(() => promise, /ngoài phạm vi của cầu/);
});

test('request — im lặng với tin không phải của mình (ba content script gặp nhau trên một tab)', async () => {
  const win = fakeWindow();
  const { client, clock } = makeClient(win);

  const promise = client.request('ytcfg');
  win.deliver({ tag: 'tin-cua-module-khac', id: 'id-1', ok: true, result: 'sai' });
  win.deliver({ tag: P.RESPONSE, id: 'id-999', ok: true, result: 'sai' });
  win.deliver('chuỗi trần');
  win.deliver(null);
  win.deliver(answer('id-1', 'đúng'), { other: 'window' }); // tin từ cửa sổ khác (iframe)
  win.deliver(answer('id-1', 'đúng'));

  assert.equal(await promise, 'đúng');
  assert.equal(clock.pending, 0, 'hẹn giờ chưa được dọn');
});

test('request — cầu không trả lời thì hỏng bằng lời, không treo mãi', async () => {
  const win = fakeWindow();
  const { client, clock } = makeClient(win);

  const promise = client.request('ytcfg');
  clock.fireAll();

  await assert.rejects(() => promise, /không trả lời/);
  // Trả lời tới muộn sau khi đã hết hạn: không được ném ra từ chỗ không ai bắt.
  assert.doesNotThrow(() => win.deliver(answer('id-1', 'muộn')));
});

test('dispose — gỡ listener khỏi cửa sổ, không để lại rác trên trang', () => {
  const win = fakeWindow();
  const { client } = makeClient(win);
  assert.equal(win.listeners.length, 1);
  client.dispose();
  assert.equal(win.listeners.length, 0);
});

// ------------------------------------------------------------------ hook trên trang

/** Cửa sổ giả đủ để `install()` bám vào — không có `document`, nên cầu không tự cài lúc nạp. */
function fakeTarget() {
  const seen = [];
  const target = {
    seen,
    ytcfg: fakeYtcfg(),
    location: { origin: 'https://www.youtube.com' },
    listeners: [],
    addEventListener(type, fn) {
      target.listeners.push({ type, fn });
    },
    postMessage(data) {
      seen.push({ kind: 'post', data });
    },
    async fetch(url, init) {
      seen.push({ kind: 'fetch', url, init, self: this });
      return { ok: true, status: 200, async json() { return { done: true }; } };
    },
  };
  return target;
}

test('install — hook fetch không làm hỏng lời gọi `fetch(...)` trần của chính trang', async () => {
  const target = fakeTarget();
  const original = target.fetch;
  B.install(target);
  assert.notEqual(target.fetch, original, 'chưa hook gì cả');

  // Trang gọi trần trong module strict: `this` là undefined. `apply(undefined)` là
  // "Illegal invocation" trên Chrome — hook không được phép làm hỏng request của trang.
  const bare = target.fetch;
  await bare('https://www.youtube.com/youtubei/v1/player', { headers: { Authorization: TOKEN } });

  const call = target.seen.find((s) => s.kind === 'fetch');
  assert.equal(call.self, target, 'fetch gốc bị gọi với `this` sai');
});

test('install — header mượn được qua hook rồi chảy đúng vào lượt liệt kê playlist', async () => {
  const target = fakeTarget();
  B.install(target);

  await target.fetch('https://www.youtube.com/youtubei/v1/browse', { headers: { Authorization: TOKEN } });
  const onMessage = target.listeners.find((l) => l.type === 'message').fn;
  await onMessage({ source: target, data: { tag: P.REQUEST, id: 'x1', op: 'listPlaylist', params: {} } });

  const browse = target.seen.filter((s) => s.kind === 'fetch').at(-1);
  assert.equal(browse.init.headers.Authorization, TOKEN);
  const reply = target.seen.find((s) => s.kind === 'post');
  assert.deepEqual(reply.data, { ok: true, result: { done: true }, tag: P.RESPONSE, id: 'x1' });
});

test('install — hook không nhặt header của request ngoài InnerTube', async () => {
  const target = fakeTarget();
  B.install(target);

  await target.fetch('https://example.com/api', { headers: { Authorization: 'Bearer cua-trang-khac' } });
  const onMessage = target.listeners.find((l) => l.type === 'message').fn;
  await onMessage({ source: target, data: { tag: P.REQUEST, id: 'x2', op: 'listPlaylist', params: {} } });

  const reply = target.seen.find((s) => s.kind === 'post');
  assert.equal(reply.data.ok, false);
  assert.match(reply.data.error, /chưa mượn được/i);
});

test('install — im lặng với tin của module khác và tin từ cửa sổ khác', async () => {
  const target = fakeTarget();
  B.install(target);
  const onMessage = target.listeners.find((l) => l.type === 'message').fn;

  await onMessage({ source: target, data: { tag: 'tin-cua-ai-do', id: 'y', op: 'listPlaylist' } });
  await onMessage({ source: { other: true }, data: { tag: P.REQUEST, id: 'y', op: 'ytcfg' } });
  await onMessage({ source: target, data: null });

  assert.deepEqual(target.seen.filter((s) => s.kind === 'post'), []);
});
