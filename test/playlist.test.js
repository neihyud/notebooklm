// Ticket 007 — liệt kê cả playlist, bảng xác nhận trước khi chạy, và import lại phần mới.
//
// Ba cặp cùng kiểu mà hoán vị vẫn cho một kết quả *trông hợp lệ* nằm ở file này, và mỗi cặp
// có một assertion là cái chết của nó:
//
//   1. **số video ↔ số Nguồn ước lượng** — cả hai là số nguyên nhỏ cạnh nhau trong cùng một
//      bảng. Hoán vị vẫn ra một bảng đọc được, chỉ là người dùng tưởng playlist 300 video tốn
//      300 nguồn (hoặc tưởng nó tốn 6 video).
//   2. **mục private của chính người dùng ↔ mục bỏ vì không có quyền xem** — hai nhóm cùng
//      kiểu, cùng hình dạng trong JSON của InnerTube. Hoán vị giữ nguyên tổng số mục **và**
//      nguyên con số ước lượng, nên bảng xác nhận không đổi lấy một chữ; nhưng một nhóm thì
//      import được còn nhóm kia thì chắc chắn hỏng.
//   3. **tên playlist (nguồn gốc của tên Nguồn) ↔ tiêu đề một video** — hoán vị vẫn ra tên
//      Nguồn đúng khuôn ADR 0010, chỉ là cả playlist mang tên video đầu tiên, vĩnh viễn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/youtube/selectors.js';
import '../src/youtube/bridge-protocol.js';
import '../src/youtube/transcript.js';
import '../src/youtube/playlist.js';
import '../src/background/queue-engine.js';

const S = globalThis.NBLM_SHARED;
const PL = globalThis.NBLM_PLAYLIST;
const E = globalThis.NBLM_ENGINE;

// ------------------------------------------------------------------ phản hồi InnerTube giả

/** videoId hợp lệ dài đúng 11 ký tự — `parseVideoId` từ chối mọi thứ khác. */
const vid = (n) => `vid${String(n).padStart(8, '0')}`;

/**
 * Một `playlistVideoRenderer` như InnerTube trả về.
 *
 * `isPlayable` và huy hiệu riêng tư là **hai trục khác nhau**, và fixture này giữ chúng tách
 * ra đúng như vậy: video private của chính mình là `playable: true` + huy hiệu `private`.
 */
function renderer(id, options = {}) {
  const o = options;
  const node = {
    videoId: id,
    title: { runs: [{ text: o.title || `Video ${id}` }] },
    shortBylineText: { runs: [{ text: o.channel || 'Kênh của tôi' }] },
    lengthSeconds: o.lengthSeconds === undefined ? '3600' : o.lengthSeconds,
    isPlayable: o.playable === undefined ? true : o.playable,
  };
  if (o.lengthText) node.lengthText = { simpleText: o.lengthText };
  if (o.privacy) {
    node.badges = [{
      metadataBadgeRenderer: {
        icon: { iconType: o.privacy === 'private' ? 'PRIVACY_PRIVATE' : 'PRIVACY_UNLISTED' },
        label: o.privacy === 'private' ? 'Private' : 'Unlisted',
      },
    }];
  }
  return { playlistVideoRenderer: node };
}

/** Trang đầu: header + danh sách, lồng sâu đúng như phản hồi thật. */
function firstPage(title, items, continuation) {
  const contents = items.map((item) => item);
  if (continuation) {
    contents.push({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: continuation } } } });
  }
  return {
    metadata: { playlistMetadataRenderer: { title } },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [{ itemSectionRenderer: { contents: [{ playlistVideoListRenderer: { contents } }] } }],
              },
            },
          },
        }],
      },
    },
  };
}

/** Trang phân tiếp: hình dạng khác hẳn trang đầu — đó là lý do bóc dữ liệu đi bộ cả cây. */
function nextPage(items, continuation) {
  const continuationItems = items.map((item) => item);
  if (continuation) {
    continuationItems.push({
      continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: continuation } } },
    });
  }
  return { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems } }] };
}

/** Cầu MAIN world giả: ghi lại mọi lượt gọi, trả từng trang một theo kịch bản. */
function fakeBridge(pages) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async request(op, params) {
      calls.push({ op, params });
      const page = pages[index];
      index += 1;
      if (!page) throw new Error(`cầu bị hỏi ${index} lượt nhưng kịch bản chỉ có ${pages.length} trang`);
      return page;
    },
  };
}

// ------------------------------------------------------------------ địa chỉ

test('browseIdFor — playlist thành browseId của InnerTube, kể cả WL và LL', () => {
  assert.equal(PL.browseIdFor('PLabcdef'), 'VLPLabcdef');
  assert.equal(PL.browseIdFor('WL'), 'VLWL');
  assert.equal(PL.browseIdFor('LL'), 'VLLL');
  assert.equal(PL.browseIdFor('https://www.youtube.com/playlist?list=WL'), 'VLWL');
});

test('browseIdFor — id không đọc được thì ném lỗi, không dựng một browseId cụt', () => {
  for (const bad of ['', null, 'không phải id', 'https://example.com/playlist?list=WL']) {
    assert.throws(() => PL.browseIdFor(bad), /không đọc được/, String(bad));
  }
});

test('uploadsPlaylistId — kênh thành playlist "đã tải lên", chỉ đổi đúng hai ký tự đầu', () => {
  assert.equal(PL.uploadsPlaylistId('UCabcdef123'), 'UUabcdef123');
  assert.equal(S.parsePlaylistId(PL.uploadsPlaylistId('UCabcdef123')), 'UUabcdef123');
  for (const bad of ['', 'abcdef', 'UC', null]) assert.equal(PL.uploadsPlaylistId(bad), null, String(bad));
});

test('pageTarget — nhận trang playlist và trang kênh, từ chối trang watch', () => {
  assert.deepEqual(PL.pageTarget('https://www.youtube.com/playlist?list=WL'),
    { kind: 'playlist', playlistId: 'WL', channelId: '' });
  assert.deepEqual(PL.pageTarget('https://www.youtube.com/channel/UCabc123/videos'),
    { kind: 'channel', playlistId: '', channelId: 'UCabc123' });
  assert.equal(PL.pageTarget('https://www.youtube.com/@handle/videos').kind, 'channel');
});

test('pageTarget — trang watch KHÔNG phải chỗ của thanh nổi, dù URL mang &list=', () => {
  // Ở trang watch, checkbox trên từng thumbnail sẽ rơi lên video gợi ý ở sidebar — tức người
  // dùng tick một danh sách hoàn toàn khác với playlist mình tưởng.
  assert.equal(PL.pageTarget(`https://www.youtube.com/watch?v=${vid(1)}&list=PLabc`), null);
  assert.equal(PL.pageTarget('https://www.youtube.com/'), null);
  assert.equal(PL.pageTarget('https://example.com/playlist?list=WL'), null);
  assert.equal(PL.pageTarget('không phải url'), null);
});

// ------------------------------------------------------------------ bóc phản hồi

test('readPlaylistPage — bóc được mục, tên playlist và token trang kế', () => {
  const page = PL.readPlaylistPage(firstPage('Ghi chú của tôi', [renderer(vid(1)), renderer(vid(2))], 'TOKEN-2'));
  assert.equal(page.title, 'Ghi chú của tôi');
  assert.equal(page.continuation, 'TOKEN-2');
  assert.deepEqual(page.items.map((i) => i.id), [vid(1), vid(2)]);
});

test('readPlaylistPage — trang phân tiếp có hình dạng khác hẳn mà vẫn bóc được', () => {
  const page = PL.readPlaylistPage(nextPage([renderer(vid(3))], ''));
  assert.deepEqual(page.items.map((i) => i.id), [vid(3)]);
  assert.equal(page.continuation, '');
});

test('readItem — thời lượng lấy lengthSeconds trước, rơi về lengthText khi thiếu', () => {
  assert.equal(PL.readItem(renderer(vid(1), { lengthSeconds: '212' }).playlistVideoRenderer).durationSeconds, 212);
  const noSeconds = renderer(vid(1), { lengthSeconds: '', lengthText: '3:32' }).playlistVideoRenderer;
  assert.equal(PL.readItem(noSeconds).durationSeconds, 212);
});

test('readItem — tiêu đề và tên kênh nằm đúng ô của mình', () => {
  // Cặp cùng kiểu: hoán vị vẫn ra một Nguồn dựng được, chỉ là NotebookLM trích dẫn sai tên
  // kênh — và Nguồn đã đẩy thì không sửa được (`WORKSPACE_PROTOCOL.md`).
  const item = PL.readItem(renderer(vid(1), { title: 'Buổi họp tuần 3', channel: 'Đội sản phẩm' }).playlistVideoRenderer);
  assert.equal(item.title, 'Buổi họp tuần 3');
  assert.equal(item.channel, 'Đội sản phẩm');
});

test('readItem — url dựng từ videoId, không mang theo vị trí trong playlist', () => {
  // `url` là **danh tính**: nó thành `- Link gốc:` trong thân Nguồn, chỗ người đọc nhấn để
  // kiểm chứng một trích dẫn (bài học `mergeMeta`, ticket 005).
  const item = PL.readItem(renderer(vid(7)).playlistVideoRenderer);
  assert.equal(item.url, `https://www.youtube.com/watch?v=${vid(7)}`);
  assert.equal(S.parseVideoId(item.url), item.id);
});

test('readItem — mục không đọc được videoId thì bị loại, không thành một mục không danh tính', () => {
  assert.equal(PL.readItem({ videoId: '', title: { simpleText: 'x' } }), null);
  assert.equal(PL.readItem({ videoId: 'quá-ngắn' }), null);
  assert.equal(PL.readItem(null), null);
});

// ------------------------------------------------------- hai nhóm cùng kiểu (ADR 0003)

/** Video private của **chính người dùng**: xem được, nên đường DOM trích được. */
const mine = (n) => renderer(vid(n), { playable: true, privacy: 'private', title: `Riêng tư ${n}` });
/** Mục **không có quyền xem**: private của người khác, hoặc đã xoá. Trích chắc chắn hỏng. */
const theirs = (n) => renderer(vid(n), { playable: false, title: 'Private video' });

test('readItem — private của mình import được, mục không có quyền xem thì không', () => {
  const own = PL.readItem(mine(1).playlistVideoRenderer);
  const other = PL.readItem(theirs(2).playlistVideoRenderer);

  assert.equal(own.status, PL.STATUS.IMPORTABLE);
  assert.equal(own.privacy, 'private');
  assert.equal(other.status, PL.STATUS.UNAVAILABLE);
  assert.match(other.reason, /không có quyền xem/);
});

test('bảng xác nhận — hoán vị hai nhóm cùng kiểu KHÔNG đổi một con số nào, nhưng đổi hẳn cái gì được import', () => {
  const asItems = (list) => list.map((r) => PL.readItem(r.playlistVideoRenderer));
  const table = PL.confirmation(asItems([mine(1), theirs(2)]));
  // Hoán vị: mục của người khác thành "private của mình", và ngược lại. Hai renderer có cùng
  // thời lượng, nên tổng và ước lượng không nhúc nhích — bảng vẫn "hợp lệ".
  const swapped = PL.confirmation(asItems([theirs(1), mine(2)]));

  assert.equal(swapped.counts.total, table.counts.total, 'tổng số mục không phân biệt được hai nhóm');
  assert.equal(swapped.counts.importable, table.counts.importable, 'số mục import được cũng không');
  assert.equal(swapped.counts.estimatedSources, table.counts.estimatedSources, 'ước lượng cũng không');

  // Đây là chỗ duy nhất phân biệt được — quan hệ (mục nào thuộc nhóm nào), không phải con số.
  assert.deepEqual(table.importable.map((i) => i.id), [vid(1)]);
  assert.deepEqual(table.unavailable.map((i) => i.id), [vid(2)]);
  assert.deepEqual(swapped.importable.map((i) => i.id), [vid(2)]);
  assert.deepEqual(swapped.unavailable.map((i) => i.id), [vid(1)]);
});

test('queueItems — mục không có quyền xem không bao giờ vào hàng đợi', () => {
  const items = [mine(1), theirs(2), renderer(vid(3))].map((r) => PL.readItem(r.playlistVideoRenderer));
  const queued = PL.queueItems(items, PL.groupFor('PLabc', 'Playlist X'));
  assert.deepEqual(queued.map((i) => i.id), [vid(1), vid(3)]);
});

// ------------------------------------------------------------------ phân trang

test('listPlaylist — phân trang tới hết, gộp mọi trang, giữ thứ tự', async () => {
  const bridge = fakeBridge([
    firstPage('Playlist dài', [renderer(vid(1)), renderer(vid(2))], 'T2'),
    nextPage([renderer(vid(3)), renderer(vid(4))], 'T3'),
    nextPage([renderer(vid(5))], ''),
  ]);
  const result = await PL.listPlaylist({ request: bridge.request, playlistId: 'PLdai' });

  assert.deepEqual(result.items.map((i) => i.id), [1, 2, 3, 4, 5].map(vid));
  assert.equal(result.pages, 3);
  assert.equal(result.complete, true);
  assert.equal(result.title, 'Playlist dài');
});

test('listPlaylist — lượt đầu hỏi browseId, mọi lượt sau hỏi bằng token của lượt trước', async () => {
  const bridge = fakeBridge([
    firstPage('P', [renderer(vid(1))], 'T2'),
    nextPage([renderer(vid(2))], 'T3'),
    nextPage([renderer(vid(3))], ''),
  ]);
  await PL.listPlaylist({ request: bridge.request, playlistId: 'WL' });

  assert.deepEqual(bridge.calls.map((c) => c.op), ['listPlaylist', 'listPlaylist', 'listPlaylist']);
  assert.deepEqual(bridge.calls.map((c) => c.params), [
    { browseId: 'VLWL' },
    { continuation: 'T2' },
    { continuation: 'T3' },
  ]);
});

test('listPlaylist — playlist 300 video lấy đủ 300 dù trang mới cuộn tới mục thứ nhất', async () => {
  // Đây là lời hứa của cả tính năng: danh sách đến từ InnerTube, không từ DOM đã cuộn tới đâu.
  const pages = [];
  for (let page = 0; page < 3; page += 1) {
    const items = Array.from({ length: 100 }, (_, i) => renderer(vid(page * 100 + i)));
    const token = page < 2 ? `T${page + 2}` : '';
    pages.push(page === 0 ? firstPage('Playlist 300', items, token) : nextPage(items, token));
  }
  const result = await PL.listPlaylist({ request: fakeBridge(pages).request, playlistId: 'PL300' });

  assert.equal(result.items.length, 300);
  assert.equal(new Set(result.items.map((i) => i.id)).size, 300);
  assert.equal(result.complete, true);
});

test('listPlaylist — mục lặp giữa hai trang chỉ vào danh sách một lần', async () => {
  const bridge = fakeBridge([
    firstPage('P', [renderer(vid(1)), renderer(vid(2))], 'T2'),
    nextPage([renderer(vid(2)), renderer(vid(3))], ''),
  ]);
  const result = await PL.listPlaylist({ request: bridge.request, playlistId: 'PLxy' });
  assert.deepEqual(result.items.map((i) => i.id), [vid(1), vid(2), vid(3)]);
});

test('listPlaylist — token lặp lại thì dừng, và NÓI RA rằng chưa lấy hết', async () => {
  // Một danh sách bị cắt ngắn im lặng trông y hệt một playlist ngắn — và bảng xác nhận dựng
  // trên nó sẽ nói một con số nhỏ hơn sự thật, đúng thứ ADR 0008 cấm.
  const bridge = fakeBridge([
    firstPage('P', [renderer(vid(1))], 'LOOP'),
    nextPage([renderer(vid(2))], 'LOOP'),
  ]);
  const result = await PL.listPlaylist({ request: bridge.request, playlistId: 'PLxy' });
  assert.equal(result.items.length, 2);
  assert.equal(result.complete, false);
});

test('listPlaylist — chạm trần số trang thì dừng và báo chưa lấy hết, không chạy mãi', async () => {
  const bridge = {
    calls: 0,
    async request() {
      bridge.calls += 1;
      return nextPage([renderer(vid(bridge.calls))], `T${bridge.calls + 1}`);
    },
  };
  const result = await PL.listPlaylist({ request: bridge.request, playlistId: 'PLxy', maxPages: 4 });
  assert.equal(result.pages, 4);
  assert.equal(bridge.calls, 4);
  assert.equal(result.complete, false);
});

test('listPlaylist — thiếu cầu hoặc id hỏng thì ném lỗi có lời', async () => {
  await assert.rejects(() => PL.listPlaylist({ playlistId: 'WL' }), /thiếu cầu/);
  await assert.rejects(() => PL.listPlaylist({ request: async () => ({}), playlistId: '???' }), /không đọc được/);
});

// ------------------------------------------------------------------ bảng xác nhận

test('bảng xác nhận — playlist 300 video ra con số Nguồn ước lượng TRƯỚC khi trích mục nào', async () => {
  const pages = [];
  for (let page = 0; page < 3; page += 1) {
    const items = Array.from({ length: 100 }, (_, i) => renderer(vid(page * 100 + i), { lengthSeconds: '3600' }));
    pages.push(page === 0 ? firstPage('Playlist 300', items, 'T2') : nextPage(items, page < 2 ? 'T3' : ''));
  }
  const listed = await PL.listPlaylist({ request: fakeBridge(pages).request, playlistId: 'PL300' });
  const table = PL.confirmation(listed.items, { wordsPerMinute: 150, maxWords: S.MAX_WORDS_PER_SOURCE });

  // Số video và số Nguồn là hai con số khác hẳn nhau — hoán vị chúng làm assertion này chết.
  assert.equal(table.counts.total, 300);
  assert.equal(table.counts.estimatedSources, 6);
  assert.equal(table.estimate.basis, 'duration', 'ước lượng phải tính từ thời lượng, không từ số từ');
  assert.equal(table.estimate.approximate, true);
  assert.ok(table.lines.some((line) => line.includes('300')), table.lines.join('\n'));
  assert.ok(table.lines.some((line) => line.includes('≈ 6 Nguồn')), table.lines.join('\n'));
});

test('bảng xác nhận — số Nguồn đi theo tổng thời lượng, không đi theo số video', () => {
  const opts = { wordsPerMinute: 150, maxWords: S.MAX_WORDS_PER_SOURCE };
  const long = Array.from({ length: 300 }, (_, i) => PL.readItem(renderer(vid(i), { lengthSeconds: '3600' }).playlistVideoRenderer));
  const short = Array.from({ length: 300 }, (_, i) => PL.readItem(renderer(vid(i), { lengthSeconds: '60' }).playlistVideoRenderer));

  const a = PL.confirmation(long, opts);
  const b = PL.confirmation(short, opts);
  assert.equal(a.counts.total, b.counts.total, 'hai lô cùng số video');
  assert.ok(a.counts.estimatedSources > b.counts.estimatedSources,
    `${a.counts.estimatedSources} phải lớn hơn ${b.counts.estimatedSources} — nếu bằng nhau thì ước lượng đang đếm mục`);
});

test('bảng xác nhận — đếm riêng private của người dùng và mục bỏ vì không có quyền', () => {
  const items = [mine(1), mine(2), theirs(3), renderer(vid(4)), renderer(vid(5), { privacy: 'unlisted' })]
    .map((r) => PL.readItem(r.playlistVideoRenderer));
  const table = PL.confirmation(items);

  assert.equal(table.counts.total, 5);
  assert.equal(table.counts.importable, 4);
  assert.equal(table.counts.privateOwned, 2);
  assert.equal(table.counts.unlisted, 1);
  assert.equal(table.counts.unavailable, 1);
  assert.ok(table.lines.some((line) => /private của bạn/.test(line)), table.lines.join('\n'));
  assert.ok(table.lines.some((line) => /không có quyền xem/.test(line)), table.lines.join('\n'));
});

test('bảng xác nhận — ước lượng chỉ cộng thời lượng của mục sẽ thật sự import', () => {
  const items = [
    PL.readItem(renderer(vid(1), { lengthSeconds: '3600' }).playlistVideoRenderer),
    PL.readItem(renderer(vid(2), { playable: false, lengthSeconds: '3600' }).playlistVideoRenderer),
  ];
  assert.equal(PL.confirmation(items).estimate.totalSeconds, 3600);
  assert.equal(PL.confirmation(items).estimate.items, 1);
});

// ------------------------------------------------------------------ Nguồn gộp

test('groupFor — khoá theo playlist id, tên theo tiêu đề', () => {
  // Hai vế cùng kiểu chuỗi. Hoán vị vẫn ra một Nguồn gộp "hợp lệ", chỉ là tên Nguồn thành
  // `playlist:PLabc — phần 1` còn nhận diện import lại thì đứt mỗi lần đổi tên playlist.
  const group = PL.groupFor('PLabc', 'Ghi chú của tôi');
  assert.equal(group.key, 'playlist:PLabc');
  assert.equal(group.source, 'Ghi chú của tôi');
  assert.equal(E.groupKey(group), 'playlist:PLabc');
});

test('groupFor — đổi tên playlist không đổi khoá, nên import lại vẫn nhận ra nhóm cũ', () => {
  assert.equal(E.groupKey(PL.groupFor('PLabc', 'Tên cũ')), E.groupKey(PL.groupFor('PLabc', 'Tên mới')));
  assert.notEqual(E.groupKey(PL.groupFor('PLabc', 'X')), E.groupKey(PL.groupFor('PLxyz', 'X')));
});

test('queueItems — tên Nguồn gộp suy từ TÊN PLAYLIST, không từ tiêu đề video đầu tiên', () => {
  const items = [renderer(vid(1), { title: 'Buổi 1' }), renderer(vid(2), { title: 'Buổi 2' })]
    .map((r) => PL.readItem(r.playlistVideoRenderer));
  const queued = PL.queueItems(items, PL.groupFor('PLabc', 'Khoá học React'));

  assert.equal(S.bundleName({ kind: 'playlist', source: queued[0].group.source, part: 1 }), 'Khoá học React — phần 1');
  assert.deepEqual(queued.map((i) => i.title), ['Buổi 1', 'Buổi 2']);
});

test('queueItems — thiếu tên hoặc thiếu khoá thì ném lỗi, không đặt một tên Nguồn sai vĩnh viễn', () => {
  const items = [PL.readItem(renderer(vid(1)).playlistVideoRenderer)];
  assert.throws(() => PL.queueItems(items, { key: 'playlist:PL' }), /thiếu tên/);
  assert.throws(() => PL.queueItems(items, { source: 'X' }), /thiếu khoá/);
});

test('queueItems — mục mang đủ meta để dựng header ngữ cảnh của Nguồn gộp', () => {
  const item = PL.queueItems(
    [PL.readItem(mine(1).playlistVideoRenderer)],
    PL.groupFor('PLabc', 'Playlist X'),
  )[0];
  assert.equal(item.id, vid(1));
  assert.equal(item.kind, 'video');
  assert.equal(item.privacy, 'private');
  assert.equal(item.durationSeconds, 3600);
  assert.equal(item.url, `https://www.youtube.com/watch?v=${vid(1)}`);
});

// --------------------------------------------- import lại chỉ trích phần mới (ADR 0009)

/** Adapter giả của engine: ghi lại mục nào thật sự bị trích, và mọi Nguồn đã đẩy. */
function fakeRun() {
  const extracted = [];
  const pushed = [];
  return {
    extracted,
    pushed,
    extract: async (item) => {
      extracted.push(item.id);
      return { text: `nội dung của ${item.id}`, words: 10 };
    },
    push: async (source) => {
      pushed.push(source);
    },
  };
}

const listOf = (ids) => ids.map((n) => PL.readItem(renderer(vid(n)).playlistVideoRenderer));

test('import lại — playlist có thêm video thì CHỈ phần mới được trích, và thành Nguồn bổ sung', async () => {
  const group = PL.groupFor('PLabc', 'Playlist X');
  const first = fakeRun();
  const run1 = await E.runQueue({
    notebookId: 'nb-1',
    items: PL.queueItems(listOf([1, 2, 3]), group),
    state: E.emptyState(),
    extract: first.extract,
    push: first.push,
  });
  assert.deepEqual(first.extracted, [1, 2, 3].map(vid));
  assert.deepEqual(run1.sources.map((s) => s.name), ['Playlist X — phần 1']);

  // Lần hai: playlist đã có thêm hai video, người dùng bấm "Import toàn bộ" lần nữa.
  const second = fakeRun();
  const run2 = await E.runQueue({
    notebookId: 'nb-1',
    items: PL.queueItems(listOf([1, 2, 3, 4, 5]), group),
    state: run1.state,
    extract: second.extract,
    push: second.push,
  });

  assert.deepEqual(second.extracted, [4, 5].map(vid), 'ba video cũ bị trích lại — vài tiếng cho 2 video mới');
  assert.deepEqual(run2.sources.map((s) => s.name), ['Playlist X — bổ sung 1']);
  assert.equal(run2.summary.skipped, 3);
  assert.equal(run2.summary.balanced, true);
});

test('import lại — Sổ đã import khoá theo cặp (video, notebook), không theo video', async () => {
  // Hoán vị hai vế của khoá vẫn ra một chuỗi hợp lệ, và lần chạy đầu vẫn đúng — chỉ chống
  // trùng lặp là sai (`WORKSPACE_PROTOCOL.md`). Vế thứ hai của test này là chỗ notebookId
  // thật sự phải có mặt trong khoá.
  const group = PL.groupFor('PLabc', 'Playlist X');
  const items = PL.queueItems(listOf([1, 2]), group);

  const first = fakeRun();
  const run1 = await E.runQueue({
    notebookId: 'nb-1', items, state: E.emptyState(), extract: first.extract, push: first.push,
  });

  const again = fakeRun();
  await E.runQueue({
    notebookId: 'nb-1', items, state: run1.state, extract: again.extract, push: again.push,
  });
  assert.deepEqual(again.extracted, [], 'cùng notebook thì không trích lại');

  const other = fakeRun();
  await E.runQueue({
    notebookId: 'nb-2', items, state: run1.state, extract: other.extract, push: other.push,
  });
  assert.deepEqual(other.extracted, [1, 2].map(vid), 'notebook khác phải import lại được (ADR 0006)');
});

test('import lại — một mục hỏng không chốt sớm Nguồn đang gom (ADR 0008)', async () => {
  // Đọc ngược ADR 0008 thành "hỏng thì chốt nguồn ngay" là biến một playlist 5 video mất phụ
  // đề thành 5 Nguồn, ngược hẳn mục đích gộp. Bó vẫn gom tiếp; chỉ mục hỏng quay lại hàng đợi.
  const group = PL.groupFor('PLabc', 'Playlist X');
  const run = await E.runQueue({
    notebookId: 'nb-1',
    items: PL.queueItems(listOf([1, 2, 3, 4]), group),
    state: E.emptyState(),
    extract: async (item) => {
      if (item.id === vid(2)) throw new Error('video này không có phụ đề');
      return { text: `nội dung ${item.id}`, words: 10 };
    },
    push: async () => {},
  });

  assert.deepEqual(run.sources.map((s) => s.name), ['Playlist X — phần 1']);
  assert.deepEqual(run.sources[0].itemIds, [1, 3, 4].map(vid));
  assert.deepEqual(run.dropped.map((d) => d.id), [vid(2)]);
  assert.deepEqual(run.state.pending.map((i) => i.id), [vid(2)], 'mục hỏng phải quay lại hàng đợi');
  assert.equal(run.summary.balanced, true);
});
