// Seam 2 — engine hàng đợi, tách khỏi API của Chrome (spec 0001, Testing Decisions).
//
// Engine nhận danh sách Mục hàng đợi cùng hai adapter (trích, đẩy) và trả về nhật ký chạy.
// Mọi test ở đây chạy bằng adapter giả: không Chrome, không DOM, không mạng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/background/queue-engine.js';

const S = globalThis.NBLM_SHARED;
const E = globalThis.NBLM_ENGINE;

// ------------------------------------------------------------------ tiện ích test

/** Văn bản đúng `n` từ — để `countWords` của Seam 1 quyết định chỗ cắt, không phải con số tay. */
const words = (n) => Array.from({ length: n }, (_, i) => `t${i}`).join(' ');

const video = (id, extra = {}) => ({ id, kind: 'video', title: `Video ${id}`, ...extra });
const doc = (id, extra = {}) => ({ id, kind: 'docs', title: `Trang ${id}`, ...extra });

const playlist = (name) => ({ kind: 'playlist', source: name });
const branch = (site, name) => ({ kind: 'docs', source: site, branch: name });

/**
 * Bộ adapter giả. `size` cho số từ mỗi mục, `failExtract`/`failPush` cho các mục/nguồn hỏng.
 * `trace` ghi lại mọi lần vào/ra của cả hai khâu — đây là thứ đo được ràng buộc ADR 0007.
 */
function fakeAdapters(opts = {}) {
  const size = opts.size || (() => 10);
  const failExtract = new Set(opts.failExtract || []);
  const failPush = new Set(opts.failPush || []);
  const hold = opts.hold || (() => null);
  const trace = [];
  const pushed = [];

  async function extract(item) {
    trace.push({ stage: 'extract', event: 'start', id: item.id });
    const waited = hold(item);
    if (waited) await waited;
    trace.push({ stage: 'extract', event: 'end', id: item.id });
    if (failExtract.has(item.id)) throw new Error(`không có phụ đề: ${item.id}`);
    return { text: `${item.title}\n${words(size(item))}` };
  }

  async function push(source) {
    trace.push({ stage: 'push', event: 'start', id: source.name });
    if (opts.pushHold) await opts.pushHold(source);
    trace.push({ stage: 'push', event: 'end', id: source.name });
    if (failPush.has(source.name)) throw new Error(`hộp thoại không mở: ${source.name}`);
    pushed.push(source);
  }

  return { extract, push, trace, pushed };
}

const names = (log) => log.sources.map((s) => s.name);
const idsOf = (log) => log.sources.map((s) => s.itemIds);

// ------------------------------------------------------------------ nguồn lẻ

test('runQueue — import lẻ: mỗi mục một Nguồn, tên là tiêu đề mục (ADR 0002)', async () => {
  const a = fakeAdapters();
  const log = await E.runQueue({
    items: [video('aaa'), video('bbb')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
  });

  assert.deepEqual(names(log), ['Video aaa', 'Video bbb']);
  assert.deepEqual(idsOf(log), [['aaa'], ['bbb']]);
  assert.equal(log.summary.imported, 2);
});

// ------------------------------------------------- gộp, cắt theo dung lượng, đặt tên

test('runQueue — playlist gộp thành ít Nguồn nhất, cắt khi chạm trần (ADR 0005, 0008)', async () => {
  const group = playlist('Khoá học Rust');
  const items = ['v1', 'v2', 'v3', 'v4', 'v5'].map((id) => video(id, { group }));
  const a = fakeAdapters({ size: () => 40 });

  const log = await E.runQueue({
    items,
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: 100 },
  });

  // 40 từ mỗi mục + dòng tiêu đề: hai mục vừa một nguồn, mục thứ ba mở nguồn mới.
  assert.deepEqual(names(log), [
    'Khoá học Rust — phần 1',
    'Khoá học Rust — phần 2',
    'Khoá học Rust — phần 3',
  ]);
  assert.deepEqual(idsOf(log), [['v1', 'v2'], ['v3', 'v4'], ['v5']]);
});

test('runQueue — cắt giống hệt packSources của Seam 1 trên cùng danh sách', async () => {
  const group = playlist('P');
  const sizes = [30, 10, 45, 5, 60, 20, 90];
  const items = sizes.map((n, i) => video(`v${i}`, { group, plannedWords: n }));
  const a = fakeAdapters({ size: (item) => item.plannedWords });

  const log = await E.runQueue({
    items,
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: 100 },
  });

  const parts = sizes.map((n, i) => ({ id: `v${i}`, words: S.countWords(`Video v${i}\n${words(n)}`) }));
  const expected = S.packSources(parts, { maxWords: 100 }).map((p) => p.items.map((x) => x.id));
  assert.deepEqual(idsOf(log), expected);
});

test('runQueue — một mục một mình vượt trần vẫn được giữ, đánh dấu overflow', async () => {
  const group = playlist('P');
  const a = fakeAdapters({ size: (item) => (item.id === 'big' ? 500 : 10) });

  const log = await E.runQueue({
    items: [video('a', { group }), video('big', { group }), video('b', { group })],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: 100 },
  });

  const big = log.sources.find((s) => s.itemIds.includes('big'));
  assert.equal(big.overflow, true);
  assert.deepEqual(big.itemIds, ['big']);
  assert.equal(log.summary.imported, 3, 'mục vượt trần không được bỏ lặng lẽ');
});

// --------------------------------------------- bảng tổng kết: 54 mục lẽ ra 55 là đỏ

test('runQueue — 55 mục vào một Nguồn thì đủ 55 id, đúng thứ tự (ADR 0008)', async () => {
  const group = playlist('Playlist lớn');
  const items = Array.from({ length: 55 }, (_, i) => video(`v${String(i).padStart(2, '0')}`, { group }));
  const a = fakeAdapters({ size: () => 9 });

  const log = await E.runQueue({
    items,
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: S.MAX_WORDS_PER_SOURCE },
  });

  assert.equal(log.sources.length, 1);
  assert.deepEqual(log.sources[0].itemIds, items.map((i) => i.id));
  assert.equal(log.summary.imported, 55);
  assert.deepEqual(log.summary.leaked, []);
  assert.equal(log.summary.balanced, true);
});

test('runQueue — mục biến mất khỏi nguồn gộp thì bảng tổng kết phải nói ra', async () => {
  const group = playlist('P');
  const items = Array.from({ length: 6 }, (_, i) => video(`v${i}`, { group }));
  const a = fakeAdapters({ size: () => 5, failExtract: ['v3'] });

  const log = await E.runQueue({
    items,
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: 1000 },
  });

  const dropped = log.dropped.map((d) => d.id);
  assert.deepEqual(dropped, ['v3']);
  assert.match(log.dropped[0].reason, /phụ đề/);
  assert.equal(log.dropped[0].stage, 'extract');
  assert.equal(log.summary.imported + log.summary.dropped + log.summary.skipped, 6);
  assert.equal(log.summary.balanced, true);

  const table = E.formatSummary(log);
  assert.match(table, /v3/);
  assert.match(table, /phụ đề/);
});

test('runQueue — mục hỏng không chặn nguồn đang gom (ADR 0008)', async () => {
  const group = playlist('P');
  const items = [video('a', { group }), video('bad', { group }), video('c', { group })];
  const a = fakeAdapters({ size: () => 5, failExtract: ['bad'] });

  const log = await E.runQueue({
    items,
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: 1000 },
  });

  assert.equal(log.sources.length, 1, 'nguồn đang gom vẫn được chốt và đẩy');
  assert.deepEqual(log.sources[0].itemIds, ['a', 'c']);
  assert.equal(a.pushed.length, 1);
  // Mục hỏng quay lại hàng đợi, không mất.
  assert.deepEqual(log.state.pending.map((i) => i.id), ['bad']);
});

test('runQueue — đẩy hỏng: mọi mục của nguồn đó vào bảng rớt và không vào Sổ', async () => {
  const group = playlist('P');
  const items = [video('a', { group }), video('b', { group })];
  const a = fakeAdapters({ size: () => 5, failPush: ['P — phần 1'] });

  const log = await E.runQueue({
    items,
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: 1000 },
  });

  assert.equal(log.sources.length, 0);
  assert.deepEqual(log.dropped.map((d) => d.id), ['a', 'b']);
  assert.deepEqual(log.dropped.map((d) => d.stage), ['push', 'push']);
  assert.deepEqual(log.state.ledger, []);
  assert.deepEqual(log.state.pending.map((i) => i.id), ['a', 'b']);
});

// ------------------------------------------------------------ Sổ đã import (ADR 0006)

test('runQueue — Sổ đã import chặn mục đã có trong cùng Notebook đích', async () => {
  const a = fakeAdapters();
  // Sổ được gieo bằng chính ledgerKey của Seam 1, đúng thứ tự (mục, notebook).
  const state = { ledger: [S.ledgerKey('seen', 'NB-1')] };

  const log = await E.runQueue({
    items: [video('seen'), video('fresh'), video('other')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    state,
  });

  assert.deepEqual(log.skipped.map((s) => s.id), ['seen']);
  assert.deepEqual(idsOf(log), [['fresh'], ['other']]);
  // Hai con số này cố ý khác nhau: bằng nhau thì hoán vị chúng trong bảng tổng kết vẫn xanh.
  assert.equal(log.summary.skipped, 1);
  assert.equal(log.summary.imported, 2);
  // Mục đã có trong Sổ không được trích lại — 15–20 giây mỗi video private là lý do Sổ tồn tại.
  assert.deepEqual(
    a.trace.filter((t) => t.stage === 'extract' && t.event === 'start').map((t) => t.id),
    ['fresh', 'other'],
  );
});

test('runQueue — cùng mục vào Notebook đích khác thì không phải trùng (ADR 0006)', async () => {
  const a = fakeAdapters();
  const first = await E.runQueue({
    items: [video('v1')], notebookId: 'NB-A', extract: a.extract, push: a.push,
  });
  const second = await E.runQueue({
    items: [video('v1')], notebookId: 'NB-B', extract: a.extract, push: a.push, state: first.state,
  });

  assert.deepEqual(second.skipped, []);
  assert.deepEqual(idsOf(second), [['v1']]);
  assert.deepEqual(
    second.state.ledger.sort(),
    [S.ledgerKey('v1', 'NB-A'), S.ledgerKey('v1', 'NB-B')].sort(),
  );

  const third = await E.runQueue({
    items: [video('v1')], notebookId: 'NB-A', extract: a.extract, push: a.push, state: second.state,
  });
  assert.deepEqual(third.skipped.map((s) => s.id), ['v1']);
});

test('runQueue — nguồn gộp ghi vào Sổ từng mục một (ADR 0006)', async () => {
  const group = playlist('P');
  const a = fakeAdapters({ size: () => 5 });
  const log = await E.runQueue({
    items: [video('a', { group }), video('b', { group })],
    notebookId: 'NB-1', extract: a.extract, push: a.push, options: { maxWords: 1000 },
  });

  assert.deepEqual(log.state.ledger.sort(), [S.ledgerKey('a', 'NB-1'), S.ledgerKey('b', 'NB-1')].sort());
});

// ------------------------------------------------------- tài liệu cắt theo Nhánh (ADR 0005)

test('runQueue — hai Nhánh tài liệu là hai Nguồn dù chưa chạm trần', async () => {
  const a = fakeAdapters({ size: () => 5 });
  const items = [
    doc('p1', { group: branch('Rust Book', 'Ownership') }),
    doc('p2', { group: branch('Rust Book', 'Ownership') }),
    doc('p3', { group: branch('Rust Book', 'Lifetimes') }),
  ];

  const log = await E.runQueue({
    items, notebookId: 'NB-1', extract: a.extract, push: a.push, options: { maxWords: 1000 },
  });

  assert.deepEqual(names(log), ['Rust Book — Ownership', 'Rust Book — Lifetimes']);
  assert.deepEqual(idsOf(log), [['p1', 'p2'], ['p3']]);
});

test('runQueue — nhánh một mình vượt trần mới cắt theo số từ (ADR 0005)', async () => {
  const group = branch('Docs', 'API');
  const a = fakeAdapters({ size: () => 40 });
  const items = ['p1', 'p2', 'p3'].map((id) => doc(id, { group }));

  const log = await E.runQueue({
    items, notebookId: 'NB-1', extract: a.extract, push: a.push, options: { maxWords: 100 },
  });

  assert.deepEqual(names(log), ['Docs — API', 'Docs — API — phần 2']);
  assert.deepEqual(idsOf(log), [['p1', 'p2'], ['p3']]);
});

test('runQueue — 40 trang một nhánh ra đúng một Nguồn, không phải 40 (ticket 010)', async () => {
  const group = branch('Site', 'Guide');
  const a = fakeAdapters({ size: () => 100 });
  const items = Array.from({ length: 40 }, (_, i) => doc(`p${i}`, { group }));

  const log = await E.runQueue({
    items, notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(log.sources.length, 1);
  assert.equal(log.sources[0].itemIds.length, 40);
});

// ------------------------------------------ hai hàng đợi: song song ở trích, độc quyền ở đẩy

/**
 * Điểm hẹn cho `count` bên. Bên nào tới trước phải đợi bên còn lại — nên nếu engine chạy hai
 * hàng đợi tuần tự, bên thứ hai không bao giờ tới và điểm hẹn *hết giờ* thay vì treo. Đây là
 * cách kiểm "song song ở khâu trích" mà không phải đo thời gian thật.
 */
function meetingPoint(count, ms = 1000) {
  let arrived = 0;
  let open;
  let timer;
  const gate = new Promise((resolve, reject) => {
    open = resolve;
    timer = setTimeout(() => reject(new Error('khâu trích chạy tuần tự: hai hàng đợi không gặp nhau')), ms);
  });
  return () => {
    arrived += 1;
    if (arrived >= count) {
      clearTimeout(timer);
      open();
    }
    return gate;
  };
}

const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));

test('runQueue — hàng video và hàng tài liệu trích chồng lấn theo thời gian (ADR 0007)', async () => {
  const meet = meetingPoint(2);
  const a = fakeAdapters({ hold: () => meet() });

  const log = await E.runQueue({
    items: [video('v1'), doc('p1')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
  });

  assert.equal(log.summary.imported, 2, 'cả hai mục phải qua được điểm hẹn');
  assert.deepEqual(log.dropped, []);
  // Hai lần trích cùng đang chạy: cả hai `start` đứng trước `end` đầu tiên.
  const order = a.trace.filter((t) => t.stage === 'extract').map((t) => `${t.event}:${t.id}`);
  assert.deepEqual(order.slice(0, 2).sort(), ['start:p1', 'start:v1']);
  // Nhãn hàng đợi trong nhật ký phải đúng loại — ticket 010 đo ADR 0007 bằng chính nhật ký này.
  const queueOfId = (id) => log.trace.find((t) => t.stage === 'extract' && t.id === id).queue;
  assert.equal(queueOfId('v1'), 'video');
  assert.equal(queueOfId('p1'), 'docs');
  assert.deepEqual(log.sources.map((s) => s.kind).sort(), ['docs', 'video']);
});

test('runQueue — không bao giờ có hai lần đẩy chồng nhau (ADR 0007)', async () => {
  const meet = meetingPoint(2);
  let depth = 0;
  let maxDepth = 0;
  const a = fakeAdapters({
    // Ép hai hàng vào cùng một khoảng thời gian, rồi mới thả cho chúng đẩy.
    hold: (item) => (item.id === 'v1' || item.id === 'p1' ? meet() : null),
    pushHold: async () => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      await tick();
      depth -= 1;
    },
  });

  const log = await E.runQueue({
    items: [video('v1'), video('v2'), video('v3'), doc('p1'), doc('p2'), doc('p3')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
  });

  assert.equal(log.summary.imported, 6);
  assert.equal(maxDepth, 1, 'NotebookLM chỉ có một hộp thoại thêm nguồn');

  // Kiểm lại bằng chính nhật ký chạy, không chỉ bằng biến đếm của adapter.
  let live = 0;
  for (const entry of log.trace) {
    if (entry.stage !== 'push') continue;
    if (entry.event === 'start') live += 1;
    else live -= 1;
    assert.ok(live <= 1, `hai lần đẩy chồng nhau tại ${entry.id}`);
    // `live` âm nghĩa là nhật ký ghi 'end' trước 'start' — nhãn hoán vị thì phép đếm trên
    // vẫn xanh trong khi nhật ký nói ngược, và ticket 010 đo ADR 0007 bằng chính nhật ký này.
    assert.ok(live >= 0, `nhật ký ghi kết thúc trước khi bắt đầu tại ${entry.id}`);
  }
});

// ------------------------------------------------------- dừng, chạy tiếp, import lại

test('runQueue — dừng giữa chừng: nguồn đang gom vẫn được đẩy, phần còn lại nợ lại', async () => {
  const group = playlist('P');
  const items = ['v1', 'v2', 'v3', 'v4'].map((id) => video(id, { group }));
  let done = 0;
  const a = fakeAdapters({ size: () => 5, hold: () => { done += 1; return null; } });

  const log = await E.runQueue({
    items,
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
    options: { maxWords: 1000, shouldStop: () => done >= 2 },
  });

  assert.equal(log.stopped, true);
  assert.deepEqual(names(log), ['P — phần 1']);
  assert.deepEqual(idsOf(log), [['v1', 'v2']]);
  assert.deepEqual(log.state.pending.map((i) => i.id), ['v3', 'v4']);
  assert.equal(log.state.groups[E.groupKey(group)].done, false);
  // Mục còn nợ không phải mục rớt, nhưng vẫn phải có tên trong bảng — nếu không, phép kế
  // toán 4 mục vào / 2 mục ra không ai phát hiện được.
  assert.deepEqual(log.deferred.map((d) => d.id), ['v3', 'v4']);
  assert.equal(log.summary.deferred, 2);
  assert.equal(log.summary.imported, 2);
  assert.equal(log.summary.dropped, 0);
  assert.equal(log.summary.balanced, true);
  const table = E.formatSummary(log);
  assert.match(table, /dừng giữa chừng/);
  assert.match(table, /v3/);
  assert.match(table, /v4/);
});

test('runQueue — chạy tiếp sau khi dừng là phần kế, không phải nguồn bổ sung', async () => {
  const group = playlist('P');
  const items = ['v1', 'v2', 'v3'].map((id) => video(id, { group }));
  let done = 0;
  const first = fakeAdapters({ size: () => 5, hold: () => { done += 1; return null; } });

  const stopped = await E.runQueue({
    items, notebookId: 'NB-1', extract: first.extract, push: first.push,
    options: { maxWords: 1000, shouldStop: () => done >= 1 },
  });
  assert.deepEqual(names(stopped), ['P — phần 1']);

  // Chạy tiếp: không truyền `items`, engine lấy phần còn nợ trong trạng thái lưu bền.
  const resumed = fakeAdapters({ size: () => 5 });
  const log = await E.runQueue({
    notebookId: 'NB-1', extract: resumed.extract, push: resumed.push,
    state: stopped.state, options: { maxWords: 1000 },
  });

  assert.deepEqual(names(log), ['P — phần 2']);
  assert.deepEqual(idsOf(log), [['v2', 'v3']]);
  assert.deepEqual(log.state.pending, []);
  assert.equal(log.state.groups[E.groupKey(group)].done, true);
});

test('runQueue — import lại playlist sinh nguồn bổ sung, không dựng lại từ đầu (ADR 0009)', async () => {
  const group = playlist('Playlist X');
  const a = fakeAdapters({ size: () => 40 });
  const run = (items, state) => E.runQueue({
    items, notebookId: 'NB-1', extract: a.extract, push: a.push, state, options: { maxWords: 100 },
  });

  // Lần đầu: ba video, trần ép thành hai phần — để chỉ số phần và chỉ số bổ sung khác nhau.
  const first = await run(['v1', 'v2', 'v3'].map((id) => video(id, { group })));
  assert.deepEqual(names(first), ['Playlist X — phần 1', 'Playlist X — phần 2']);

  // Playlist có thêm video: cái cũ nhận ra là trùng, cái mới vào nguồn bổ sung.
  const second = await run(['v1', 'v2', 'v3', 'v4'].map((id) => video(id, { group })), first.state);
  assert.deepEqual(second.skipped.map((s) => s.id), ['v1', 'v2', 'v3']);
  assert.deepEqual(names(second), ['Playlist X — bổ sung 1']);
  assert.deepEqual(idsOf(second), [['v4']]);

  const third = await run(['v1', 'v2', 'v3', 'v4', 'v5'].map((id) => video(id, { group })), second.state);
  assert.deepEqual(names(third), ['Playlist X — bổ sung 2']);
  assert.deepEqual(idsOf(third), [['v5']]);

  // Chỉ phần mới được trích: bốn video cũ không bị trích lại lần nào nữa.
  const extracted = a.trace.filter((t) => t.stage === 'extract' && t.event === 'start').map((t) => t.id);
  assert.deepEqual(extracted, ['v1', 'v2', 'v3', 'v4', 'v5']);
});

test('runQueue — mục hỏng thử lại được ở lần chạy sau, vào nguồn bổ sung', async () => {
  const group = playlist('P');
  const items = [video('a', { group }), video('bad', { group })];
  const failing = fakeAdapters({ size: () => 5, failExtract: ['bad'] });
  const first = await E.runQueue({
    items, notebookId: 'NB-1', extract: failing.extract, push: failing.push, options: { maxWords: 1000 },
  });
  assert.deepEqual(first.state.pending.map((i) => i.id), ['bad']);
  // Nhóm còn nợ mục thì chưa xong — lần chạy sau là chạy tiếp, không phải import lại.
  assert.equal(first.state.groups[E.groupKey(group)].done, false);

  const retry = fakeAdapters({ size: () => 5 });
  const log = await E.runQueue({
    notebookId: 'NB-1', extract: retry.extract, push: retry.push, state: first.state,
    options: { maxWords: 1000 },
  });
  assert.deepEqual(names(log), ['P — phần 2']);
  assert.deepEqual(idsOf(log), [['bad']]);
  assert.deepEqual(log.dropped, []);
});

// ------------------------------------------------------------------ thân Nguồn gộp

test('runQueue — thân Nguồn gộp giữ đủ từng phần, đúng thứ tự', async () => {
  const group = playlist('P');
  const a = fakeAdapters({ size: () => 3 });
  const log = await E.runQueue({
    items: [video('a', { group }), video('b', { group })],
    notebookId: 'NB-1', extract: a.extract, push: a.push, options: { maxWords: 1000 },
  });

  const body = log.sources[0].body;
  assert.ok(body.indexOf('Video a') >= 0 && body.indexOf('Video b') > body.indexOf('Video a'));
  assert.equal(body.split(E.PART_SEPARATOR).length, 2);
  assert.equal(log.sources[0].words, S.countWords(body.split(E.PART_SEPARATOR).join(' ')));
});

// ------------------------------------------------------------------ kế toán bảng tổng kết

test('summarize — mục vào hàng đợi mà không ra ở đâu thì bị gọi tên', () => {
  const s = E.summarize({
    queued: ['a', 'b', 'c'],
    sources: [{ name: 'P — phần 1', itemIds: ['a', 'b'], words: 10 }],
    skipped: [],
    dropped: [],
  });
  assert.deepEqual(s.leaked, ['c']);
  assert.deepEqual(s.duplicated, []);
  assert.equal(s.balanced, false);
});

test('summarize — mục ra hai lần cũng là lệch, không phải chỉ thiếu mới lệch', () => {
  const s = E.summarize({
    queued: ['a', 'b'],
    sources: [{ name: 'P — phần 1', itemIds: ['a', 'b'], words: 10 }],
    skipped: [],
    dropped: [{ id: 'b', stage: 'extract', reason: 'x' }],
  });
  assert.deepEqual(s.leaked, []);
  assert.deepEqual(s.duplicated, ['b']);
  assert.equal(s.balanced, false);
});

// ------------------------------------------------------------------ ước lượng (ADR 0008)

test('estimateSources — playlist 300 video một tiếng ước lượng ra sáu Nguồn', () => {
  const items = Array.from({ length: 300 }, (_, i) => video(`v${i}`, { durationSeconds: 3600 }));
  const est = E.estimateSources(items, { wordsPerMinute: 150, maxWords: S.MAX_WORDS_PER_SOURCE });

  assert.equal(est.sources, 6);
  assert.equal(est.items, 300);
  assert.equal(est.totalSeconds, 300 * 3600);
  assert.equal(est.estimatedWords, 300 * 60 * 150);
  assert.equal(est.unknownDurations, 0);
});

test('estimateSources — trình bày đúng như một ước lượng, không như con số chốt', () => {
  const items = [video('v1', { durationSeconds: 600 })];
  const est = E.estimateSources(items);
  assert.equal(est.approximate, true);
  assert.equal(est.basis, 'duration');
  assert.match(est.label, /≈/);
  assert.match(est.label, /ước lượng/);
});

test('estimateSources — mục chưa biết thời lượng được đếm riêng, không lặng lẽ tính là 0', () => {
  const items = [video('v1', { durationSeconds: 3600 }), video('v2'), video('v3', { durationSeconds: 0 })];
  const est = E.estimateSources(items, { wordsPerMinute: 150 });
  assert.equal(est.unknownDurations, 2);
  assert.equal(est.totalSeconds, 3600);
  assert.equal(est.estimatedWords, 9000);
  assert.equal(est.sources, 1);
  assert.match(est.label, /chưa biết thời lượng/);
});

test('estimateSources — hàng đợi rỗng thì không tốn nguồn nào', () => {
  assert.equal(E.estimateSources([]).sources, 0);
});

test('runQueue — bó đầy đúng bằng trần thì chưa cắt, giống hệt packSources (ADR 0005)', async () => {
  const group = playlist('P');
  // Mỗi mục đúng 50 từ (2 từ tiêu đề + 48), trần 100: hai mục đầu vừa khít, mục thứ ba mới
  // mở nguồn mới. Cắt ở "chạm trần" thay vì "vượt trần" là bỏ phí đúng một mục mỗi nguồn.
  const a = fakeAdapters({ size: () => 48 });
  const items = ['v1', 'v2', 'v3'].map((id) => video(id, { group }));

  const log = await E.runQueue({
    items, notebookId: 'NB-1', extract: a.extract, push: a.push, options: { maxWords: 100 },
  });

  assert.deepEqual(log.sources.map((s) => s.words), [100, 50]);
  assert.deepEqual(idsOf(log), [['v1', 'v2'], ['v3']]);
  // Đầy khít trần không phải là vượt trần: đánh dấu overflow ở đây là báo động giả trong
  // bảng tổng kết, đúng chỗ người dùng cần tin.
  assert.equal(log.sources[0].overflow, undefined);

  const parts = items.map((i) => ({ id: i.id, words: 50 }));
  assert.deepEqual(
    S.packSources(parts, { maxWords: 100 }).map((p) => p.items.map((x) => x.id)),
    idsOf(log),
    'engine và packSources phải cắt cùng một chỗ',
  );
});

test('runQueue — lần chạy của nhóm khác không đóng sổ hộ nhóm đang còn nợ', async () => {
  const p = playlist('P');
  const q = playlist('Q');
  let done = 0;
  const first = fakeAdapters({ size: () => 5, hold: () => { done += 1; return null; } });

  // Nhóm P dừng giữa chừng, còn nợ v2.
  const stopped = await E.runQueue({
    items: ['v1', 'v2'].map((id) => video(id, { group: p })),
    notebookId: 'NB-1', extract: first.extract, push: first.push,
    options: { maxWords: 1000, shouldStop: () => done >= 1 },
  });
  assert.deepEqual(stopped.state.pending.map((i) => i.id), ['v2']);

  // Lần chạy sau chỉ đụng nhóm Q — không được đánh dấu P là đã xong.
  const b = fakeAdapters({ size: () => 5 });
  const middle = await E.runQueue({
    items: [video('q1', { group: q })],
    notebookId: 'NB-1', extract: b.extract, push: b.push,
    // `state.pending` của P không được chạy ở lần này: chỉ lấy nhóm Q ra.
    state: { ...stopped.state, pending: [] },
    options: { maxWords: 1000 },
  });
  assert.equal(middle.state.groups[E.groupKey(p)].done, false, 'P vẫn còn nợ');

  const c = fakeAdapters({ size: () => 5 });
  const resumed = await E.runQueue({
    items: stopped.state.pending,
    notebookId: 'NB-1', extract: c.extract, push: c.push,
    state: middle.state, options: { maxWords: 1000 },
  });
  assert.deepEqual(names(resumed), ['P — phần 2']);
});

// ------------------------------------------------- hai lỗi tìm ra ở cổng review

test('runQueue — mục không có id bị loại có tên tuổi, không làm nổ cả lần chạy', async () => {
  const a = fakeAdapters({ size: () => 5 });
  const log = await E.runQueue({
    items: [video('v1'), { kind: 'docs', title: 'Trang lạc' }, video('v2')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
  });

  assert.deepEqual(idsOf(log), [['v1'], ['v2']]);
  // Ba mục vào thì bảng phải nói ba, không phải hai: mục bị loại cũng là mục đã vào hàng đợi.
  assert.equal(log.summary.queued, 3);
  assert.equal(log.summary.imported, 2);
  assert.equal(log.summary.dropped, 1);
  assert.equal(log.dropped[0].stage, 'queue');
  assert.match(log.dropped[0].reason, /id/);
  assert.equal(log.summary.balanced, true, 'mục hỏng id vẫn phải cân sổ');
  assert.match(E.formatSummary(log), /Trang lạc/);
  // Và Sổ đã import của hai mục kia phải về được tay người gọi.
  assert.deepEqual(log.state.ledger.sort(), [S.ledgerKey('v1', 'NB-1'), S.ledgerKey('v2', 'NB-1')].sort());
});

test('runQueue — đẩy hỏng không tiêu mất chỉ số phần (ADR 0010)', async () => {
  const group = playlist('P');
  const items = ['v1', 'v2', 'v3'].map((id) => video(id, { group }));
  const failing = fakeAdapters({ size: () => 40, failPush: ['P — phần 2'] });

  const first = await E.runQueue({
    items, notebookId: 'NB-1', extract: failing.extract, push: failing.push,
    options: { maxWords: 100 },
  });
  assert.deepEqual(names(first), ['P — phần 1']);
  assert.deepEqual(first.state.pending.map((i) => i.id), ['v3']);

  const retry = fakeAdapters({ size: () => 40 });
  const log = await E.runQueue({
    notebookId: 'NB-1', extract: retry.extract, push: retry.push,
    state: first.state, options: { maxWords: 100 },
  });

  // Phần 2 chưa từng vào notebook, nên lần sau vẫn phải là phần 2 — dãy tên thủng một lỗ là
  // thứ lần import sau không đọc ra được.
  assert.deepEqual(names(log), ['P — phần 2']);
});
