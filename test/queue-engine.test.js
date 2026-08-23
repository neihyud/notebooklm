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

// ------------------------------------------------- đường đẩy lên bảng tổng kết (ticket 019)

/**
 * Adapter đẩy **có nói ra đường mình vừa đi** — đúng hình dạng giá trị trả về của
 * `pushTextSource` (ADR 0012), stub tại chỗ chứ không đi qua `buildParams` (ticket 020 đang giữ
 * shape ấy).
 *
 * Bảng tra theo **tên Nguồn**, không theo thứ tự gọi: nếu tra theo thứ tự thì chính phép hoán vị
 * cần bắt — gán `via` của Nguồn A cho Nguồn B — sẽ không phân biệt được với một fixture đúng.
 */
function viaAdapters(viaByName, opts = {}) {
  const base = fakeAdapters(opts);
  return {
    ...base,
    push: async (source) => {
      await base.push(source);
      const via = viaByName[source.name];
      assert.ok(via !== undefined, `fixture thiếu đường đẩy cho Nguồn "${source.name}"`);
      return { ok: true, via };
    },
  };
}

test('runQueue — bảng tổng kết nói TỪNG Nguồn đi đường nào, không chỉ đếm (ADR 0012)', async () => {
  // **Bốn** Nguồn, và Nguồn rơi về đường lui là Nguồn **thứ hai**. Ba ràng buộc chồng lên nhau,
  // mỗi cái loại một lớp phép hoán vị:
  //   - n ≥ 2, nếu không "đường của Nguồn này" trùng khít "đường của cả lượt" (v9, luật fixture
  //     một phần tử) và mọi phép hoán vị đều xanh;
  //   - không đứng đầu và không đứng cuối — nằm đầu thì `[0]` lọt, nằm cuối thì `at(-1)` lọt;
  //   - không đứng ở **tâm đối xứng**. Đây là chỗ bản đầu của test này để lọt: với ba Nguồn
  //     `[rpc, dom, rpc]`, phép đảo ngược danh sách là phép **đồng nhất**, nên một bản
  //     `formatSummary` đọc nhãn theo chỉ số đảo ngược vẫn xanh 777/777. Bốn Nguồn với Nguồn
  //     đặc biệt ở vị trí hai thì `[rpc, dom, rpc, rpc]` khác hẳn bản đảo ngược của nó.
  const a = viaAdapters({
    'Video mo-dau': 'rpc', 'Video giua': 'dom', 'Video ke': 'rpc', 'Video ket': 'rpc',
  });
  const log = await E.runQueue({
    items: [video('mo-dau'), video('giua'), video('ke'), video('ket')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
  });

  assert.deepEqual(
    log.sources.map((s) => [s.name, s.pushVia]),
    [['Video mo-dau', 'rpc'], ['Video giua', 'dom'], ['Video ke', 'rpc'], ['Video ket', 'rpc']],
  );
  assert.deepEqual(log.summary.pushVia, { rpc: 3, dom: 1 });

  // Neo **tên ↔ nhãn trên cùng một dòng**: đếm không thôi thì hoán vị `via` giữa hai Nguồn vẫn
  // cho đúng một bảng "3 RPC, 1 đường lui", và đó chính là phép cần chết.
  const table = E.formatSummary(log);
  assert.match(table, /\+ Video mo-dau: [^\n]* — đường RPC$/m, table);
  assert.match(table, /\+ Video giua: [^\n]* — đường lui \(DOM\)$/m, table);
  assert.match(table, /\+ Video ke: [^\n]* — đường RPC$/m, table);
  assert.match(table, /\+ Video ket: [^\n]* — đường RPC$/m, table);
  assert.match(table, /Nguồn đã tạo: 4 \(1 đường lui \(DOM\), 3 đường RPC\)/, table);
});

test('runQueue — adapter đẩy không nói đường nào thì bảng nói "không rõ", KHÔNG nói RPC', async () => {
  // Hạng mặc định là chỗ dễ nói dối nhất: đoán `'rpc'` cho một adapter im lặng là làm bảng tổng
  // kết báo đường chính đang sống vào đúng lúc nó vừa chết (shape trôi theo cohort, ADR 0012).
  const a = fakeAdapters(); // `push` trả về `undefined`
  const log = await E.runQueue({
    items: [video('v1')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
  });

  assert.equal(log.sources[0].pushVia, '');
  assert.deepEqual(log.summary.pushVia, { '': 1 });
  const table = E.formatSummary(log);
  assert.match(table, /\+ Video v1: [^\n]* — đường không rõ$/m);
  assert.doesNotMatch(table, /đường RPC/);
});

test('runQueue — Nguồn đẩy hỏng không có dòng đường đẩy nào: nó không phải Nguồn đã tạo', async () => {
  // Đối chứng cho hai test trên: phép đếm đường đẩy chạy trên `log.sources`, và một lượt đẩy
  // ném ra thì không có Nguồn nào để đếm — nếu nó vẫn hiện một đường, con số "bao nhiêu Nguồn
  // rơi về đường lui" đang đếm cả những Nguồn chưa hề tồn tại.
  const a = viaAdapters({ 'Video v1': 'rpc', 'Video v2': 'rpc' }, { failPush: ['Video v2'] });
  const log = await E.runQueue({
    items: [video('v1'), video('v2')],
    notebookId: 'NB-1',
    extract: a.extract,
    push: a.push,
  });

  assert.deepEqual(log.sources.map((s) => s.name), ['Video v1']);
  assert.deepEqual(log.summary.pushVia, { rpc: 1 });
  assert.match(E.formatSummary(log), /Nguồn đã tạo: 1 \(1 đường RPC\)/);
});

test('runQueue — `via` trùng tên thuộc tính kế thừa vẫn đếm đủ và vẫn gọi tên được', async () => {
  // Hạng "đường lạ" tồn tại để đón một giá trị chưa biết — mà đúng lớp giá trị ấy là chỗ phép
  // tra trần và phép đếm trên object literal cùng hỏng: `counts['constructor'] || 0` lấy được
  // **hàm** `Object` nên phép cộng thành phép nối chuỗi, còn `counts['__proto__'] = 1` bị setter
  // nuốt lặng và Nguồn ấy biến mất khỏi phép đếm. Cả hai đều là mất mát **âm thầm**, đúng thứ
  // ADR 0008 dựng bảng tổng kết để chặn.
  for (const odd of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const a = viaAdapters({ 'Video v1': 'rpc', 'Video v2': odd, 'Video v3': 'rpc' });
    const log = await E.runQueue({
      items: [video('v1'), video('v2'), video('v3')],
      notebookId: 'NB-1',
      extract: a.extract,
      push: a.push,
    });

    const counted = Object.values(log.summary.pushVia).reduce((sum, n) => sum + n, 0);
    assert.equal(counted, 3, `${odd}: ba Nguồn mà phép đếm đường đẩy chỉ thấy ${counted}`);
    assert.deepEqual(log.summary.pushVia, { rpc: 2, [odd]: 1 }, odd);
    // Và nó phải **gọi tên ra được**, không in một hàm ra bảng tổng kết.
    const table = E.formatSummary(log);
    assert.match(table, new RegExp(`\\+ Video v2: [^\\n]* — đường lạ \\(${odd}\\)$`, 'm'), table);
    assert.doesNotMatch(table, /native code|\[object Object\]/, table);
  }
});

// ------------------------------------------- tên Nguồn lên bảng tổng kết (ticket 021)

/**
 * Adapter đẩy trả về **cả giá trị nói về tên Nguồn**, đúng hình dạng hai đường thật trả về:
 * đường DOM `{ ok, name, named, warning }` (`automation.js`), đường RPC `{ ok, via, sourceId,
 * name, status }` (`rpc.js`) — trong đó `name` của đường RPC là tên **notebook đọc lại cho ta**,
 * không phải tên ta gửi đi.
 *
 * Bảng tra theo **tên Nguồn** chứ không theo thứ tự gọi, cùng lý do với `viaAdapters`: tra theo
 * thứ tự thì đúng phép hoán vị cần bắt — gán cảnh báo của Nguồn A cho Nguồn B — không phân biệt
 * được với một fixture đúng.
 */
function pushReplies(replyByName, opts = {}) {
  const base = fakeAdapters(opts);
  return {
    ...base,
    push: async (source) => {
      await base.push(source);
      const reply = replyByName[source.name];
      assert.ok(reply !== undefined, `fixture thiếu phản hồi đẩy cho Nguồn "${source.name}"`);
      return { ok: true, ...reply };
    },
  };
}

/** Câu chữ thật của `addTextSource` khi hộp thoại không có ô tiêu đề (`src/notebooklm/automation.js`). */
const domWarning = (name) => `không thấy ô tiêu đề trong hộp thoại — NotebookLM sẽ tự đặt tên thay cho "${name}"`;

/**
 * **Bốn** Nguồn, Nguồn không đặt được tên đứng **thứ hai** — WORKSPACE_PROTOCOL v10.
 *
 * n=1 thì "Nguồn này không có tên" trùng khít "cả lượt không có tên" và mọi phép hoán vị đều
 * xanh; đứng đầu thì `[0]` lọt, đứng cuối thì `at(-1)` lọt; ba Nguồn với Nguồn đặc biệt ở giữa
 * thì dãy **bằng chính bản đảo ngược của nó**, nên phép đọc theo chỉ số đảo ngược cũng lọt.
 */
const FOUR = ['mo-dau', 'giua', 'ke', 'ket'];
const fourVideos = () => FOUR.map((id) => video(id));
const nameOf = (id) => `Video ${id}`;

/** Phản hồi của một Nguồn đã mang đúng tên ta đặt: notebook đọc lại đúng cái tên ấy. */
const namedOk = (id, via = 'rpc') => ({ via, name: nameOf(id) });

test('runQueue — bảng tổng kết gọi tên Nguồn KHÔNG đặt được tên (đường DOM, ADR 0010)', async () => {
  const a = pushReplies({
    [nameOf('mo-dau')]: namedOk('mo-dau'),
    [nameOf('giua')]: { via: 'dom', name: nameOf('giua'), named: false, warning: domWarning(nameOf('giua')) },
    [nameOf('ke')]: namedOk('ke'),
    [nameOf('ket')]: namedOk('ket'),
  });
  const log = await E.runQueue({
    items: fourVideos(), notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.deepEqual(
    log.sources.map((s) => [s.name, s.nameWarning]),
    [
      [nameOf('mo-dau'), ''],
      [nameOf('giua'), domWarning(nameOf('giua'))],
      [nameOf('ke'), ''],
      [nameOf('ket'), ''],
    ],
  );
  assert.equal(log.summary.unnamed, 1);

  // Cảnh báo phải đứng **trên cùng một dòng với tên Nguồn của chính nó**: một con số "1 Nguồn
  // không đặt được tên" không phân biệt được lượt này với lượt đã gán cảnh báo cho Nguồn khác,
  // mà cái người dùng cần là *Nguồn NÀO* — họ không sửa được tên, chỉ còn cách biết mà tránh.
  const table = E.formatSummary(log);
  assert.match(table, /^Tên Nguồn KHÔNG theo ý ta — 1 Nguồn/m, table);
  assert.match(table, new RegExp(`^ {2}! ${nameOf('giua')}: không thấy ô tiêu đề`, 'm'), table);
  for (const id of ['mo-dau', 'ke', 'ket']) {
    assert.doesNotMatch(table, new RegExp(`! ${nameOf(id)}:`), `${id} mang tên đúng ý ta mà vẫn bị gọi tên`);
  }
});

test('runQueue — đường RPC nói CÙNG một chuyện bằng tên nó nhận về, không im lặng', async () => {
  // Đường RPC không có khái niệm "không đặt được tên" — nó gửi tiêu đề trong `params`. Nhưng nó
  // nhận về **tên notebook thật sự đang giữ**, và đó là bằng chứng mạnh hơn: khi shape `params`
  // trôi theo cohort (ADR 0012, và mẫu của ticket 020 chưa từng đối chiếu với capture thật),
  // request vẫn thành công còn Nguồn mang một cái tên khác — vĩnh viễn.
  const soi = 'Nội dung không tiêu đề';
  const a = pushReplies({
    [nameOf('mo-dau')]: namedOk('mo-dau'),
    [nameOf('giua')]: { via: 'rpc', name: soi, status: 2 },
    [nameOf('ke')]: namedOk('ke'),
    [nameOf('ket')]: namedOk('ket'),
  });
  const log = await E.runQueue({
    items: fourVideos(), notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(log.summary.unnamed, 1);
  // **Chiều** của cặp: hai chuỗi cùng kiểu, hoán vị chúng vẫn ra một câu đọc trôi chảy nói
  // ngược sự thật — "notebook đang để tên <tên ta đặt>" là đúng thứ không được phép in ra.
  const table = E.formatSummary(log);
  assert.match(
    table,
    new RegExp(`^ {2}! ${nameOf('giua')}: notebook đang để tên "${soi}", không phải "${nameOf('giua')}"$`, 'm'),
    table,
  );
});

test('runQueue — lượt đẩy không nói tên nào là "chưa xác nhận", KHÔNG phải "ổn"', async () => {
  // Cùng luật với `pushVia`: im lặng là hạng chưa biết. Một adapter không nói Nguồn mang tên gì
  // thì bảng tổng kết không được thay nó khẳng định — ADR 0009 đọc tên Nguồn trong notebook để
  // biết phần nào đã có, nên "tưởng là đúng tên" là chỗ hỏng âm thầm đắt nhất của repo này.
  const a = pushReplies({
    [nameOf('mo-dau')]: namedOk('mo-dau'),
    [nameOf('giua')]: { via: 'rpc' },
    [nameOf('ke')]: namedOk('ke'),
    [nameOf('ket')]: namedOk('ket'),
  });
  const log = await E.runQueue({
    items: fourVideos(), notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(log.summary.unnamed, 1);
  const table = E.formatSummary(log);
  assert.match(table, new RegExp(`^ {2}! ${nameOf('giua')}: [^\\n]*không xác nhận được`, 'm'), table);
});

test('runQueue — mọi Nguồn mang đúng tên ta đặt thì bảng KHÔNG có dòng nào (đối chứng)', async () => {
  // Đối chứng cho ba test trên: nếu mục này hiện cả ở lượt sạch thì nó là nhiễu, và một dòng
  // cảnh báo lúc nào cũng có là một dòng không ai đọc nữa.
  const a = pushReplies(Object.fromEntries(FOUR.map((id) => [nameOf(id), namedOk(id)])));
  const log = await E.runQueue({
    items: fourVideos(), notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(log.summary.unnamed, 0);
  assert.deepEqual(log.sources.map((s) => s.nameWarning), ['', '', '', '']);
  const table = E.formatSummary(log);
  assert.doesNotMatch(table, /Tên Nguồn KHÔNG/, table);
  assert.doesNotMatch(table, /^ {2}!/m, table);
});

// --------------------------- tên ta đặt PHẢI là chuỗi gửi đi (vòng hai ticket 021)

/**
 * Tiêu đề thật của YouTube có khoảng trắng đôi — YouTube cho phép, và `labelOf` không đụng vào.
 * Nguồn lẻ lấy thẳng tiêu đề làm tên Nguồn, nên đây là đường duy nhất còn hở: `S.bundleName` đã
 * `collapse` sẵn cả tên nguồn gốc lẫn tên Nhánh, nên Nguồn gộp không bao giờ dính.
 */
const MESSY = 'Video  giua';

/**
 * Đường đẩy đặt `S.collapse(source.name)` vào ô tiêu đề — **cả hai đường**: `buildParams` của
 * `rpc.js` và `addTextSource` của `automation.js` gọi đúng hàm ấy. Notebook đọc lại đúng cái đã
 * nhận, nên đây là hình dạng một lượt đẩy **hoàn toàn đúng**.
 */
const echoesWhatWasSent = async (source) => ({ ok: true, via: 'rpc', name: S.collapse(source.name) });

test('runQueue — lượt đẩy ĐÚNG với tiêu đề khoảng trắng đôi KHÔNG bị báo mất tên', async () => {
  // Hai phép chuẩn hoá khác nhau trên cùng một chuỗi cho một cảnh báo dương tính giả, và cảnh
  // báo dương tính giả phá đúng thứ ticket này tồn tại để tạo ra: một dòng lúc nào cũng có là
  // một dòng không ai đọc nữa. Chuẩn hoá ở **chỗ đặt tên**, một lần — chỗ so không chuẩn hoá.
  const a = { extract: async (i) => ({ text: `${i.title} noi dung` }), push: echoesWhatWasSent };
  const log = await E.runQueue({
    items: [video('mo-dau'), { ...video('giua'), title: MESSY }, video('ke'), video('ket')],
    notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(log.summary.unnamed, 0, E.formatSummary(log));
  assert.deepEqual(log.sources.map((s) => s.nameWarning), ['', '', '', '']);
  // Và tên đi vào bảng là **tên notebook đang giữ**, không phải bản chưa chuẩn hoá của ta.
  assert.equal(log.sources[1].name, 'Video giua');
  assert.doesNotMatch(E.formatSummary(log), /Tên Nguồn KHÔNG/);
});

test('runQueue — nhưng notebook đổi tên THẬT thì vẫn phải báo (chiều ngược lại)', async () => {
  // Đối chứng phải sống cùng test trên: vá dương tính giả bằng cách nới phép so cho tới khi nó
  // không bao giờ báo nữa thì đã xoá cả tính năng. Cùng fixture, cùng tiêu đề khoảng trắng đôi —
  // chỉ khác đúng một chuyện: notebook trả về một cái tên khác.
  const tuDat = 'Nội dung không tiêu đề';
  const a = {
    extract: async (i) => ({ text: `${i.title} noi dung` }),
    push: async (source) => (source.name === 'Video giua'
      ? { ok: true, via: 'rpc', name: tuDat }
      : echoesWhatWasSent(source)),
  };
  const log = await E.runQueue({
    items: [video('mo-dau'), { ...video('giua'), title: MESSY }, video('ke'), video('ket')],
    notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(log.summary.unnamed, 1);
  assert.match(
    E.formatSummary(log),
    new RegExp(`^ {2}! Video giua: notebook đang để tên "${tuDat}", không phải "Video giua"$`, 'm'),
    E.formatSummary(log),
  );
});

test('runQueue — tên ta đặt cho MỌI Nguồn đã là đúng chuỗi hai đường đẩy gửi đi', async () => {
  // Bất biến giữ cho hai chỗ khỏi trôi ra xa nhau lần nữa: `source.name` là **điểm bất động** của
  // `S.collapse`, nên "tên ta đặt" và "tên gửi đi" là một chuỗi, và chỗ so không cần biết gì về
  // chuẩn hoá. Canh quan hệ, không khoá chuỗi — đổi câu chữ đặt tên sau này không làm test chết oan.
  const pushed = [];
  const a = {
    extract: async (i) => ({ text: `${i.title} noi dung` }),
    push: async (source) => { pushed.push(source.name); return echoesWhatWasSent(source); },
  };
  const group = playlist('Khoá  học\tRust');
  const log = await E.runQueue({
    items: [
      video('mo-dau'),
      { ...video('giua'), title: MESSY },
      video('ke', { group }),
      video('ket', { group }),
    ],
    notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(pushed.length, 3, 'fixture phải có cả Nguồn lẻ lẫn Nguồn gộp');
  for (const name of pushed) {
    assert.equal(name, S.collapse(name), `tên đưa cho đường đẩy chưa chuẩn hoá: ${JSON.stringify(name)}`);
  }
  // Nguồn gộp đi qua `S.bundleName` — nó đã collapse sẵn, nên chỗ hở chỉ có ở Nguồn lẻ.
  assert.deepEqual(names(log), ['Video mo-dau', 'Video giua', 'Khoá học Rust — phần 1']);
});

test('runQueue — notebook thêm khoảng trắng vào tên ta gửi thì VẪN báo, không nuốt', async () => {
  // Chiều nguy hiểm của bản vá: "nới phép so cho hết dương tính giả" nghĩa là `S.collapse` cả hai
  // vế ở chỗ so — và khi ấy một notebook trả về tên đã bị sửa khoảng trắng thành ra không có
  // triệu chứng gì. Ta gửi đi một chuỗi đã chuẩn hoá, nên mọi khoảng trắng trong tên nhận về là
  // thứ **phía kia thêm vào**, và ADR 0009 đọc đúng cái tên đang nằm trong notebook.
  for (const [nhan, tuDat] of [['thêm ở đuôi', 'Video giua '], ['nhả lại khoảng trắng đôi', 'Video  giua']]) {
    const a = {
      extract: async (i) => ({ text: `${i.title} noi dung` }),
      push: async (source) => (source.name === 'Video giua'
        ? { ok: true, via: 'rpc', name: tuDat }
        : echoesWhatWasSent(source)),
    };
    const log = await E.runQueue({
      items: [video('mo-dau'), { ...video('giua'), title: MESSY }, video('ke'), video('ket')],
      notebookId: 'NB-1', extract: a.extract, push: a.push,
    });

    assert.equal(log.summary.unnamed, 1, `${nhan}: ${E.formatSummary(log)}`);
    assert.match(log.sources[1].nameWarning, new RegExp(`^notebook đang để tên "${tuDat}"`), nhan);
  }
});

test('runQueue — tên nhận về TOÀN khoảng trắng là "chưa xác nhận", không phải một cái tên khác', async () => {
  // Chỗ duy nhất `.trim()` còn sống trong phép này, và nó chỉ trả lời câu *"có đọc được cái tên
  // nào không"*: một chuỗi toàn khoảng trắng không phải một cái tên, in nó ra trong ngoặc kép chỉ
  // làm dòng cảnh báo thành khó hiểu. Nó không đụng phép so bằng, nên không tạo ra dương tính giả.
  const a = {
    extract: async (i) => ({ text: `${i.title} noi dung` }),
    push: async (source) => (source.name === 'Video giua'
      ? { ok: true, via: 'rpc', name: '   ' }
      : echoesWhatWasSent(source)),
  };
  const log = await E.runQueue({
    items: [video('mo-dau'), { ...video('giua'), title: MESSY }, video('ke'), video('ket')],
    notebookId: 'NB-1', extract: a.extract, push: a.push,
  });

  assert.equal(log.summary.unnamed, 1);
  assert.match(log.sources[1].nameWarning, /^lượt đẩy không nói Nguồn mang tên gì/, log.sources[1].nameWarning);
});

// ------------------------------------------------- cửa vào ⟺ `ledgerKey` (ticket 022)

/** Những id mà `String(id).trim()` nói "có" còn `S.collapse` của `ledgerKey` nói "không". */
const NOT_A_LEDGER_ID = [7, 0, false, true, {}, ['x'], '   '];

/**
 * Mục nào **đi tiếp được** qua cửa vào — xuất hiện ở bất cứ đâu trong nhật ký dưới đúng id của
 * nó, thay vì dưới một dòng "không có id" do cửa vào bịa ra.
 */
function admittedIds(log) {
  const out = new Set();
  for (const source of log.sources) for (const id of source.itemIds) out.add(id);
  for (const entry of log.skipped) out.add(entry.id);
  for (const entry of log.deferred) out.add(entry.id);
  for (const entry of log.dropped) if (entry.stage !== 'queue') out.add(entry.id);
  return out;
}

test('runQueue — cửa vào nhận đúng những Mục mà `ledgerKey` nhận, không rộng hơn (ticket 022)', async () => {
  // Câu hỏi là **quan hệ giữa hai chỗ**, nên test chạy lại chính `S.ledgerKey` để lấy câu trả
  // lời đúng, thay vì chép điều kiện của nó thành một hằng số ở đây — chép thì test cũng trôi
  // khỏi `ledgerKey` y như code đã trôi.
  for (const oddId of NOT_A_LEDGER_ID) {
    // Fixture v10: bốn Mục, Mục hỏng ở **vị trí hai**. Không nằm đầu — nếu nằm đầu thì chưa
    // Nguồn nào kịp đẩy và cả ticket mất nghĩa; không nằm cuối; và dãy khác hẳn bản đảo ngược.
    const items = [
      video('v1'),
      { id: oddId, kind: 'video', title: 'Video số' },
      video('v3'),
      video('v4'),
    ];
    const a = fakeAdapters({ size: () => 5 });
    const log = await E.runQueue({
      items, notebookId: 'NB-1', extract: a.extract, push: a.push,
    });

    const admitted = admittedIds(log);
    for (const item of items) {
      let acceptedByLedger = true;
      try {
        S.ledgerKey(item.id, 'NB-1');
      } catch {
        acceptedByLedger = false;
      }
      assert.equal(
        admitted.has(item.id), acceptedByLedger,
        `id ${JSON.stringify(item.id)}: cửa vào và ledgerKey phải trả lời giống nhau`,
      );
    }

    // Và không có gì biến mất im lặng: Mục bị loại vẫn có một dòng mang tên nó (ADR 0008).
    assert.equal(log.summary.balanced, true, `id ${JSON.stringify(oddId)}: phải cân sổ`);
    assert.equal(log.summary.dropped, 1);
    assert.equal(log.dropped[0].stage, 'queue');
    assert.match(E.formatSummary(log), /Video số/);
    // Ba Mục còn lại vẫn chạy: loại một Mục, không từ chối cả lượt.
    assert.deepEqual(idsOf(log), [['v1'], ['v3'], ['v4']]);
    assert.deepEqual(
      log.state.ledger.sort(),
      ['v1', 'v3', 'v4'].map((id) => S.ledgerKey(id, 'NB-1')).sort(),
    );
  }
});

test('runQueue — hai Mục cùng một ô Sổ đã import chỉ qua cửa một lần (ticket 022)', async () => {
  // `ledgerKey` gọi `collapse`, nên `'v x'` và `'v  x'` là **một** ô trong Sổ. Cửa vào khử trùng
  // theo một phép chuẩn hoá khác thì cả hai cùng vào một Nguồn gộp: nội dung ấy vào notebook hai
  // lần, Sổ chỉ ghi một ô, và Nguồn đã đẩy thì không xoá được (ADR 0010). Phép kế toán của
  // `summarize` **không** bắt được ca này — nó đếm id thô, mà hai id ấy khác nhau từng ký tự.
  // Cặp trùng nằm ở vị trí hai và ba của bốn Mục.
  const group = playlist('P');
  const items = ['v1', 'v x', 'v  x', 'v4'].map((id) => video(id, { group }));
  const a = fakeAdapters({ size: () => 5 });
  const log = await E.runQueue({
    items, notebookId: 'NB-1', extract: a.extract, push: a.push, options: { maxWords: 1000 },
  });

  const keys = log.sources.flatMap((s) => s.itemIds).map((id) => S.ledgerKey(id, 'NB-1'));
  assert.equal(
    keys.length, new Set(keys).size,
    'hai Mục cùng một ô Sổ đã import cùng đi vào notebook — đó là cú đẩy trùng',
  );
  assert.equal(log.state.ledger.length, new Set(log.state.ledger).size, 'Sổ không được có ô trùng');
  assert.equal(log.summary.balanced, true);
});

// ------------------------------------------------- ném giữa chừng không nuốt Sổ (ticket 022)

/**
 * Adapter đẩy **thành công** rồi trả về một kết quả mà chính engine đọc không nổi: `via` là
 * getter ném. Đây là hình dạng nguy hiểm nhất của lỗi giữa vòng chạy — Nguồn đã nằm trong
 * notebook và không xoá được (ADR 0010), còn lỗi thì nổ ra **sau** cú đẩy ấy.
 */
function boobyTrappedPush(trapName, pushed) {
  return async (source) => {
    pushed.push(source.name);
    if (source.name !== trapName) return { via: 'rpc', name: source.name };
    return { name: source.name, get via() { throw new Error('kết quả đẩy hỏng'); } };
  };
}

test('runQueue — ném giữa chừng: Sổ đã import giữ được những gì đã đẩy (ticket 022)', async () => {
  // Fixture v10: bốn Mục, Mục làm nổ ở **vị trí hai** — một Nguồn đã kịp đẩy trước nó.
  const items = [video('v1'), video('boom'), video('v3'), video('v4')];
  const pushed = [];
  const a = fakeAdapters({ size: () => 5 });

  const log = await E.runQueue({
    items, notebookId: 'NB-1',
    extract: a.extract,
    push: boobyTrappedPush('Video boom', pushed),
  });

  // 1. Không ném ra ngoài: người gọi ghi `log.state` xuống storage ở dòng ngay sau, nên một
  //    exception ở đây là mất trắng Sổ đã import của cả lượt.
  assert.deepEqual(pushed, ['Video v1', 'Video boom'], 'phải đẩy được ít nhất một Nguồn trước khi nổ');
  // 2. Mọi Nguồn **đã thật sự vào notebook** đều có ô trong Sổ — kể cả Nguồn mà lỗi nổ ngay sau
  //    cú đẩy của nó. Thiếu một ô ở đây là lần chạy sau đẩy lại đúng Nguồn ấy.
  for (const id of ['v1', 'boom']) {
    assert.ok(
      log.state.ledger.includes(S.ledgerKey(id, 'NB-1')),
      `Nguồn "${id}" đã đẩy đi rồi mà không có trong Sổ đã import`,
    );
  }
  // 3. Lỗi phải nói ra, không nuốt (ADR 0008).
  assert.equal(log.summary.failures, 1);
  assert.match(E.formatSummary(log), /hỏng giữa chừng/);
  assert.match(E.formatSummary(log), /kết quả đẩy hỏng/);
  // 4. Hai Mục chưa tới lượt không được bốc hơi: còn nợ, và còn trong hàng đợi cho lần sau.
  assert.deepEqual(log.state.pending.map((i) => i.id), ['v3', 'v4']);
  assert.equal(log.summary.balanced, true, 'lượt chạy hỏng vẫn phải cân sổ');
});

test('runQueue — ném giữa chừng không đánh dấu Nguồn gộp là đã chạy xong (ADR 0009)', async () => {
  const group = playlist('P');
  const items = ['v1', 'boom', 'v3', 'v4'].map((id) => video(id, { group }));
  const pushed = [];
  const a = fakeAdapters({ size: () => 40 });

  const log = await E.runQueue({
    items, notebookId: 'NB-1',
    extract: a.extract,
    push: boobyTrappedPush('P — phần 1', pushed),
    options: { maxWords: 100 },
  });

  assert.deepEqual(pushed, ['P — phần 1']);
  // Nhóm còn nợ mục thì lần sau là *chạy tiếp*, không phải *import lại*: đánh dấu `done` ở đây
  // là lần sau sinh "bổ sung 1" cho một playlist mới chạy được một phần.
  assert.equal(log.state.groups[E.groupKey(group)].done, false);
});

test('runQueue — bảng tổng kết nói đúng hàng đợi nào chết, không lẫn hai hàng (ticket 022)', async () => {
  // Hai hàng đợi chết vì hai lý do khác nhau: `queue` và `reason` là hai chuỗi cùng kiểu, và
  // ghép nhầm cặp vẫn cho một bảng đọc trôi chảy nói ngược sự thật — đúng hình mà
  // `WORKSPACE_PROTOCOL.md` ghi cho bảng xác nhận. Mỗi hàng bốn Mục, Mục làm nổ ở vị trí hai.
  const pushed = [];
  const items = [
    ...['v1', 'boom-v', 'v3', 'v4'].map((id) => video(id)),
    ...['d1', 'boom-d', 'd3', 'd4'].map((id) => doc(id)),
  ];
  const a = fakeAdapters({ size: () => 5 });
  const log = await E.runQueue({
    items, notebookId: 'NB-1',
    extract: a.extract,
    push: async (source) => {
      pushed.push(source.name);
      if (source.name === 'Video boom-v') return { name: source.name, get via() { throw new Error('video nổ'); } };
      if (source.name === 'Trang boom-d') return { name: source.name, get via() { throw new Error('tài liệu nổ'); } };
      return { via: 'rpc', name: source.name };
    },
  });

  assert.deepEqual(
    log.failures.map((f) => [f.queue, f.reason]).sort(),
    [['docs', 'tài liệu nổ'], ['video', 'video nổ']],
    'lý do phải đứng dưới đúng hàng đợi đã ném nó',
  );
  const summary = E.formatSummary(log);
  assert.match(summary, /hàng đợi video: video nổ/);
  assert.match(summary, /hàng đợi docs: tài liệu nổ/);
  assert.equal(log.summary.failures, 2);
  assert.equal(log.summary.balanced, true);
});

test('runQueue — Notebook đích mà `ledgerKey` không nhận bị từ chối ở cửa, không đổ lỗi cho Mục (ticket 022)', async () => {
  // Vế Notebook của khoá Sổ cũng đi qua `collapse`. Cửa vào nhận rộng hơn thì lượt chạy vẫn khởi
  // động, rồi **mọi** Mục bị loại kèm dòng "Mục không có id" — một bảng tổng kết đổ lỗi cho danh
  // sách của người dùng trong khi chỗ hỏng là Notebook đích.
  for (const bad of ['   ', 7, {}]) {
    const a = fakeAdapters();
    await assert.rejects(
      () => E.runQueue({
        items: [video('v1'), video('v2')], notebookId: bad, extract: a.extract, push: a.push,
      }),
      /Notebook đích/,
      `notebookId ${JSON.stringify(bad)} phải bị từ chối bằng đúng tên của nó`,
    );
    assert.deepEqual(a.pushed, [], 'chưa Nguồn nào được đẩy');
  }
});
