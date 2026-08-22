// Seam 1 — hàm thuần dùng chung. Gọi thẳng, không cần DOM (spec 0001, Testing Decisions).
//
// shared.js là classic script (content script không nạp được ES module), nên nó gắn API vào
// globalThis thay vì export. Ở đây import lấy side effect rồi đọc ra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';

const S = globalThis.NBLM_SHARED;

// ---------------------------------------------------------------- bóc videoId

test('parseVideoId — bóc được videoId từ mọi định dạng URL', () => {
  const id = 'dQw4w9WgXcQ';
  const forms = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/v/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/watch?app=desktop&v=${id}&t=90s`,
    `https://www.youtube.com/watch?v=${id}#t=1m`,
    `http://www.youtube.com/watch?v=${id}`,
    `  https://www.youtube.com/watch?v=${id}  `,
    id,
  ];
  for (const form of forms) assert.equal(S.parseVideoId(form), id, `hỏng ở: ${form}`);
});

test('parseVideoId — video trong playlist vẫn ra videoId, không ra playlist id', () => {
  assert.equal(
    S.parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=WL&index=3'),
    'dQw4w9WgXcQ',
  );
});

test('parseVideoId — host khác YouTube thì không nhận, dù URL trông y hệt', () => {
  assert.equal(S.parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(S.parseVideoId('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), null);
});

test('parseVideoId — trả null cho thứ không phải videoId', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}, 'abc', 'dQw4w9WgXc', 'dQw4w9WgXcQQ',
    'https://www.youtube.com/feed/subscriptions',
    'https://www.youtube.com/embed/videoseries?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf']) {
    assert.equal(S.parseVideoId(bad), null, `lẽ ra null: ${String(bad)}`);
  }
});

// ------------------------------------------------------------- bóc playlistId

test('parsePlaylistId — bóc được playlist id thường', () => {
  const pl = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
  assert.equal(S.parsePlaylistId(`https://www.youtube.com/playlist?list=${pl}`), pl);
  assert.equal(S.parsePlaylistId(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${pl}`), pl);
  assert.equal(S.parsePlaylistId(pl), pl);
});

test('parsePlaylistId — WL và LL cũng là playlist id hợp lệ', () => {
  assert.equal(S.parsePlaylistId('https://www.youtube.com/playlist?list=WL'), 'WL');
  assert.equal(S.parsePlaylistId('https://www.youtube.com/playlist?list=LL'), 'LL');
  assert.equal(S.parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=WL'), 'WL');
  assert.equal(S.parsePlaylistId('WL'), 'WL');
  assert.equal(S.parsePlaylistId('LL'), 'LL');
});

test('parsePlaylistId — không có list hoặc host lạ thì trả null', () => {
  assert.equal(S.parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(S.parsePlaylistId('https://example.com/playlist?list=WL'), null);
  assert.equal(S.parsePlaylistId(''), null);
  assert.equal(S.parsePlaylistId(null), null);
});

// -------------------------------------------------------------- khử trùng lặp

test('dedupe — giữ lần xuất hiện đầu, đúng thứ tự vào', () => {
  assert.deepEqual(S.dedupe(['a', 'b', 'a', 'c', 'b']), ['a', 'b', 'c']);
  assert.deepEqual(S.dedupe([]), []);
});

test('dedupe — khử theo khoá do người gọi chỉ định', () => {
  const items = [
    { id: 'v1', title: 'đầu' },
    { id: 'v2', title: 'hai' },
    { id: 'v1', title: 'trùng' },
  ];
  const out = S.dedupe(items, (it) => it.id);
  assert.deepEqual(out.map((it) => it.title), ['đầu', 'hai']);
});

// -------------------------------------------------------------- gọn khoảng trắng

test('collapse — gộp mọi khoảng trắng thành một dấu cách và cắt hai đầu', () => {
  assert.equal(S.collapse('  Xin   chào\n\tcác bạn  '), 'Xin chào các bạn');
  assert.equal(S.collapse('Đã Có Dấu'), 'Đã Có Dấu', 'collapse không được đụng tới dấu hay hoa/thường');
  assert.equal(S.collapse(null), '');
});

// ---------------------------------------------------------- bỏ dấu tiếng Việt

test('deaccent — bỏ dấu tiếng Việt, kể cả đ/Đ', () => {
  assert.equal(S.deaccent('Nguồn'), 'Nguon');
  assert.equal(S.deaccent('đường dẫn'), 'duong dan');
  assert.equal(S.deaccent('ĐƯỜNG DẪN'), 'DUONG DAN');
  assert.equal(S.deaccent('Sổ đã import'), 'So da import');
  assert.equal(S.deaccent('ăâêôơưĂÂÊÔƠƯ'), 'aaeoouAAEOOU');
  assert.equal(S.deaccent('add source'), 'add source');
  assert.equal(S.deaccent(''), '');
});

test('foldLabel — về chữ thường, bỏ dấu, gộp khoảng trắng', () => {
  assert.equal(S.foldLabel('  Thêm   NGUỒN mới '), 'them nguon moi');
  assert.equal(S.foldLabel('Add\nSource'), 'add source');
  assert.equal(S.foldLabel(null), '');
});

// ------------------------------------------------------------- mốc thời gian

test('stamp — [mm:ss] khi dưới một giờ, [h:mm:ss] khi từ một giờ', () => {
  assert.equal(S.stamp(0), '[00:00]');
  assert.equal(S.stamp(5), '[00:05]');
  assert.equal(S.stamp(65), '[01:05]');
  assert.equal(S.stamp(3599), '[59:59]');
  assert.equal(S.stamp(3600), '[1:00:00]');
  assert.equal(S.stamp(3661), '[1:01:01]');
  assert.equal(S.stamp(36000), '[10:00:00]');
});

test('stamp — làm tròn xuống, và không sinh mốc âm', () => {
  assert.equal(S.stamp(5.9), '[00:05]');
  assert.equal(S.stamp(-3), '[00:00]');
  assert.equal(S.stamp(NaN), '[00:00]');
  assert.equal(S.stamp(undefined), '[00:00]');
});

// ------------------------------------------- gộp transcript theo cửa sổ thời gian

test('mergeSegments — gộp các segment trong cùng cửa sổ thành một dòng', () => {
  const segs = [
    { start: 0, text: 'xin chào' },
    { start: 10, text: 'đây là' },
    { start: 20, text: 'một thử nghiệm' },
  ];
  assert.deepEqual(S.mergeSegments(segs, 30), [
    { start: 0, text: 'xin chào đây là một thử nghiệm' },
  ]);
});

test('mergeSegments — mốc của dòng gộp là segment ĐẦU cửa sổ, không phải segment cuối', () => {
  const segs = [
    { start: 12, text: 'một' },
    { start: 20, text: 'hai' },
    { start: 29, text: 'ba' },
  ];
  const out = S.mergeSegments(segs, 30);
  assert.equal(out.length, 1);
  assert.equal(out[0].start, 12, 'mốc phải là start của segment mở cửa sổ');
  assert.notEqual(out[0].start, 29, 'lấy start của segment cuối là sai');
});

test('mergeSegments — chạm mép cửa sổ thì mở dòng mới', () => {
  const segs = [
    { start: 0, text: 'a' },
    { start: 29, text: 'b' },
    { start: 30, text: 'c' },
    { start: 59, text: 'd' },
    { start: 61, text: 'e' },
  ];
  assert.deepEqual(S.mergeSegments(segs, 30), [
    { start: 0, text: 'a b' },
    { start: 30, text: 'c d' },
    { start: 61, text: 'e' },
  ]);
});

test('mergeSegments — bỏ segment rỗng và gộp khoảng trắng thừa', () => {
  const segs = [
    { start: 0, text: '  xin   chào  ' },
    { start: 1, text: '   ' },
    { start: 2, text: '\nbạn\n' },
  ];
  assert.deepEqual(S.mergeSegments(segs, 30), [{ start: 0, text: 'xin chào bạn' }]);
  assert.deepEqual(S.mergeSegments([], 30), []);
});

test('mergeSegments — cửa sổ không dương thì mỗi segment một dòng', () => {
  const segs = [{ start: 0, text: 'a' }, { start: 1, text: 'b' }];
  assert.deepEqual(S.mergeSegments(segs, 0), [
    { start: 0, text: 'a' },
    { start: 1, text: 'b' },
  ]);
});

// ------------------------------------------------- header ngữ cảnh + thân Nguồn

const META = {
  title: 'Rust in 100 Seconds',
  channel: 'Fireship',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  durationSeconds: 100,
  privacy: 'private',
};

test('contextHeader — tiêu đề và kênh nằm đúng ô của mình', () => {
  const header = S.contextHeader(META);
  assert.match(header, /^# Rust in 100 Seconds$/m);
  assert.match(header, /^- Kênh: Fireship$/m);
  // Hoán vị title ↔ channel là hoán vị hai chuỗi cùng kiểu: nguồn vẫn dựng được, chỉ là
  // NotebookLM trích dẫn sai tên kênh (WORKSPACE_PROTOCOL.md). Hai assert dưới là cái chết.
  assert.doesNotMatch(header, /^# Fireship$/m);
  assert.doesNotMatch(header, /^- Kênh: Rust in 100 Seconds$/m);
});

test('contextHeader — có link gốc, thời lượng và mức riêng tư', () => {
  const header = S.contextHeader(META);
  assert.match(header, /^- Link gốc: https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ$/m);
  assert.match(header, /^- Thời lượng: \[01:40\]$/m);
  assert.match(header, /^- Mức riêng tư: private$/m);
});

test('contextHeader — thiếu thời lượng thì bỏ dòng, không in mốc [00:00] bịa', () => {
  // Number(null) === 0 và 0 là số hữu hạn: một điều kiện chỉ kiểm "hữu hạn" sẽ in ra một
  // thời lượng không ai đo được. Nguồn đã đẩy vào NotebookLM thì không sửa lại được.
  for (const missing of [null, undefined, '', false, 0, NaN]) {
    const header = S.contextHeader({ title: 'T', channel: 'C', durationSeconds: missing });
    assert.doesNotMatch(header, /Thời lượng/, `lẽ ra bỏ dòng: ${JSON.stringify(missing)}`);
  }
  assert.match(S.contextHeader({ title: 'T', durationSeconds: 1 }), /^- Thời lượng: \[00:01\]$/m);
});

test('contextHeader — trường thiếu thì bỏ hẳn dòng, không in "undefined"', () => {
  const header = S.contextHeader({ title: 'Chỉ có tiêu đề' });
  assert.equal(header, '# Chỉ có tiêu đề');
  assert.doesNotMatch(header, /undefined/);
});

test('sourceBody — header ngữ cảnh đứng trước, rồi các dòng có mốc', () => {
  const body = S.sourceBody(META, [
    { start: 0, text: 'dòng một' },
    { start: 95, text: 'dòng hai' },
  ]);
  assert.ok(body.startsWith(S.contextHeader(META)), 'thân nguồn phải mở bằng header ngữ cảnh');
  assert.match(body, /^\[00:00\] dòng một$/m);
  assert.match(body, /^\[01:35\] dòng hai$/m);
});

// --------------------------------------------------- đếm từ + gói Nguồn gộp

test('countWords — đếm theo khoảng trắng, rỗng là 0', () => {
  assert.equal(S.countWords('một hai ba'), 3);
  assert.equal(S.countWords('  một\n\nhai  '), 2);
  assert.equal(S.countWords(''), 0);
  assert.equal(S.countWords(null), 0);
});

const part = (id, words) => ({ id, text: Array.from({ length: words }, () => 'w').join(' ') });

test('packSources — dưới trần thì gom hết vào một Nguồn', () => {
  const packs = S.packSources([part('v1', 10), part('v2', 10)], { maxWords: 100 });
  assert.equal(packs.length, 1);
  assert.deepEqual(packs[0].items.map((it) => it.id), ['v1', 'v2']);
  assert.equal(packs[0].words, 20);
});

test('packSources — chạm trần thì chốt Nguồn và mở Nguồn kế (ADR 0008)', () => {
  const packs = S.packSources([part('v1', 60), part('v2', 60), part('v3', 10)], { maxWords: 100 });
  assert.deepEqual(packs.map((p) => p.items.map((it) => it.id)), [['v1'], ['v2', 'v3']]);
});

test('packSources — 9k từ mỗi video, trần 500k: 55 video vừa một Nguồn, cái thứ 56 sang Nguồn mới', () => {
  const parts = Array.from({ length: 56 }, (_, i) => ({ id: `v${i + 1}`, words: 9000 }));
  const packs = S.packSources(parts, { maxWords: 500000 });
  assert.deepEqual(packs.map((p) => p.items.length), [55, 1]);
});

test('packSources — không mục nào rơi ra ngoài, và thứ tự giữ nguyên', () => {
  // Gộp nguồn khiến mất một mục thành vô hình: 54 mục trong một nguồn trông y hệt 55
  // (ADR 0008). Đây là chốt canh ở tầng hàm thuần.
  const parts = Array.from({ length: 55 }, (_, i) => ({ id: `v${i + 1}`, words: 9000 }));
  const packs = S.packSources(parts, { maxWords: 200000 });
  const flat = packs.flatMap((p) => p.items);
  assert.equal(flat.length, parts.length, `vào ${parts.length} mục, ra ${flat.length}`);
  assert.deepEqual(flat.map((it) => it.id), parts.map((it) => it.id));
  assert.equal(new Set(flat.map((it) => it.id)).size, parts.length, 'có mục bị nhân đôi');
});

test('packSources — mục một mình đã vượt trần vẫn thành Nguồn riêng, không bị bỏ', () => {
  const parts = [part('nhỏ', 10), { id: 'khổng lồ', words: 900000 }, part('sau', 10)];
  const packs = S.packSources(parts, { maxWords: 100 });
  const flat = packs.flatMap((p) => p.items.map((it) => it.id));
  assert.deepEqual(flat, ['nhỏ', 'khổng lồ', 'sau']);
  const huge = packs.find((p) => p.items.some((it) => it.id === 'khổng lồ'));
  assert.equal(huge.items.length, 1);
  assert.equal(huge.overflow, true, 'phải đánh dấu để bảng tổng kết nói ra được');
});

test('packSources — danh sách rỗng ra danh sách rỗng, không ra một Nguồn rỗng', () => {
  assert.deepEqual(S.packSources([], { maxWords: 100 }), []);
});

test('packSources — mặc định dùng trần 500.000 từ', () => {
  assert.equal(S.MAX_WORDS_PER_SOURCE, 500000);
  const packs = S.packSources([{ id: 'v1', words: 499999 }, { id: 'v2', words: 2 }]);
  assert.deepEqual(packs.map((p) => p.items.map((it) => it.id)), [['v1'], ['v2']]);
});

// ------------------------------------------------------- đặt tên Nguồn gộp

test('bundleName — playlist đánh số phần, không mẫu số (ADR 0010)', () => {
  assert.equal(S.bundleName({ kind: 'playlist', source: 'Rust căn bản', part: 1 }),
    'Rust căn bản — phần 1');
  assert.equal(S.bundleName({ kind: 'playlist', source: 'Rust căn bản', part: 7 }),
    'Rust căn bản — phần 7');
});

test('bundleName — import lại playlist thì là nguồn bổ sung (ADR 0009)', () => {
  assert.equal(S.bundleName({ kind: 'supplement', source: 'Rust căn bản', part: 1 }),
    'Rust căn bản — bổ sung 1');
});

test('bundleName — tài liệu đặt theo site và Nhánh tài liệu', () => {
  assert.equal(S.bundleName({ kind: 'docs', source: 'VitePress', branch: 'Hướng dẫn' }),
    'VitePress — Hướng dẫn');
});

test('bundleName — tên không mang mẫu số và không mang ngày giờ', () => {
  const name = S.bundleName({ kind: 'playlist', source: 'Rust căn bản', part: 1 });
  assert.doesNotMatch(name, /\d+\s*\/\s*\d+/, 'mẫu số chưa tồn tại lúc chốt phần 1');
  assert.doesNotMatch(name, /\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/, 'không nhúng ngày giờ');
  // suy được từ (nguồn gốc, chỉ số phần) và chỉ từ đó: gọi lại lúc khác vẫn ra đúng tên ấy
  assert.equal(name, S.bundleName({ kind: 'playlist', source: 'Rust căn bản', part: 1 }));
});

test('bundleName — loại lạ thì ném lỗi thay vì đặt tên sai vĩnh viễn', () => {
  assert.throws(() => S.bundleName({ kind: 'linh tinh', source: 'X', part: 1 }));
  assert.throws(() => S.bundleName({ kind: 'playlist', source: '', part: 1 }));
  assert.throws(() => S.bundleName({ kind: 'playlist', source: 'X', part: 0 }));
});

// ------------------------------- ước lượng số Nguồn trước khi chạy (ADR 0005, 0008)

/** Mục hàng đợi rút gọn — ước lượng chỉ đọc đúng một trường của nó. */
const item = (id, durationSeconds) => (durationSeconds === undefined ? { id } : { id, durationSeconds });

test('estimateSources — playlist 300 video một tiếng ước lượng ra sáu Nguồn', () => {
  const items = Array.from({ length: 300 }, (_, i) => item(`v${i}`, 3600));
  const est = S.estimateSources(items, { wordsPerMinute: 150, maxWords: S.MAX_WORDS_PER_SOURCE });

  assert.equal(est.sources, 6);
  assert.equal(est.items, 300);
  assert.equal(est.totalSeconds, 300 * 3600);
  assert.equal(est.estimatedWords, 300 * 60 * 150);
  assert.equal(est.unknownDurations, 0);
});

test('estimateSources — con số suy từ TỔNG THỜI LƯỢNG, không từ số video (ADR 0008)', () => {
  // Ba lô cùng tổng thời lượng nhưng số video khác hẳn nhau: nếu ước lượng lén đếm mục thay
  // vì cộng giây, ba con số này sẽ khác nhau. Canh **quan hệ**, không khoá hằng số — chỉnh
  // `wordsPerMinute` ở Cài đặt không được làm test này chết.
  const opts = { wordsPerMinute: 150, maxWords: S.MAX_WORDS_PER_SOURCE };
  const many = S.estimateSources(Array.from({ length: 300 }, (_, i) => item(`v${i}`, 3600)), opts);
  const few = S.estimateSources(Array.from({ length: 30 }, (_, i) => item(`v${i}`, 36000)), opts);
  assert.equal(few.sources, many.sources, 'cùng tổng thời lượng phải ra cùng số Nguồn');
  assert.notEqual(few.items, many.items, 'hai lô phải khác số video, nếu không test này rỗng tuếch');

  // Cùng **số video**, thời lượng khác nhau → số Nguồn phải khác. Đây là vế còn lại: một hàm
  // đếm mục sẽ cho hai con số bằng nhau ở đây.
  const short = S.estimateSources(Array.from({ length: 300 }, (_, i) => item(`v${i}`, 60)), opts);
  assert.equal(short.items, many.items);
  assert.ok(short.sources < many.sources, `${short.sources} phải nhỏ hơn ${many.sources}`);
});

test('estimateSources — trình bày đúng như một ước lượng, không như con số chốt', () => {
  const est = S.estimateSources([item('v1', 600)]);
  assert.equal(est.approximate, true);
  assert.equal(est.basis, 'duration');
  assert.match(est.label, /≈/);
  assert.match(est.label, /ước lượng/);
});

test('estimateSources — mục chưa biết thời lượng được đếm riêng, không lặng lẽ tính là 0', () => {
  const est = S.estimateSources([item('v1', 3600), item('v2'), item('v3', 0)], { wordsPerMinute: 150 });
  assert.equal(est.unknownDurations, 2);
  assert.equal(est.totalSeconds, 3600);
  assert.equal(est.estimatedWords, 9000);
  assert.equal(est.sources, 1);
  assert.match(est.label, /chưa biết thời lượng/);
});

test('estimateSources — trần mỗi Nguồn của Cài đặt là trần thật sự được chia', () => {
  // Người dùng hạ trần xuống thì số Nguồn phải tăng theo. Ước lượng dùng trần mặc định trong
  // khi engine cắt theo trần đã chỉnh là một bảng xác nhận nói dối.
  // Trần chọn sao cho chia hết, để quan hệ "hạ nửa trần thì gấp đôi số Nguồn" đọc được mà
  // không lẫn với phần dư của phép làm tròn lên.
  const items = Array.from({ length: 300 }, (_, i) => item(`v${i}`, 3600));
  const full = S.estimateSources(items, { wordsPerMinute: 150, maxWords: 900000 });
  const half = S.estimateSources(items, { wordsPerMinute: 150, maxWords: 450000 });
  assert.equal(full.estimatedWords, 2700000);
  assert.equal(full.sources, 3);
  assert.equal(half.sources, full.sources * 2);
});

test('estimateSources — hàng đợi rỗng thì không tốn nguồn nào', () => {
  assert.equal(S.estimateSources([]).sources, 0);
  assert.equal(S.estimateSources([]).items, 0);
});

// ------------------------------------------------- khoá Sổ đã import (ADR 0006)

test('ledgerKey — khoá là cặp (mục, Notebook đích) theo đúng thứ tự ấy', () => {
  // Hoán vị itemId ↔ notebookId vẫn ra một khoá "hợp lệ", chống trùng lặp sai mà không có
  // triệu chứng nào ở lần chạy đầu (WORKSPACE_PROTOCOL.md). Assert dưới là cái chết của nó.
  assert.equal(S.ledgerKey('dQw4w9WgXcQ', 'nb-abc'), 'dQw4w9WgXcQ::nb-abc');
  assert.notEqual(S.ledgerKey('dQw4w9WgXcQ', 'nb-abc'), S.ledgerKey('nb-abc', 'dQw4w9WgXcQ'));
});

test('ledgerKey — cùng video sang Notebook đích khác là khoá khác (ADR 0006)', () => {
  assert.notEqual(S.ledgerKey('dQw4w9WgXcQ', 'nb-1'), S.ledgerKey('dQw4w9WgXcQ', 'nb-2'));
  assert.notEqual(S.ledgerKey('v1', 'nb-1'), S.ledgerKey('v2', 'nb-1'));
});

test('ledgerKey — mục là URL tài liệu thì dấu phân cách không giả mạo được khoá', () => {
  assert.notEqual(
    S.ledgerKey('https://x.dev/a::nb', 'b'),
    S.ledgerKey('https://x.dev/a', 'nb::b'),
  );
  assert.equal(S.ledgerKey('https://x.dev/a', 'nb-1'), S.ledgerKey('https://x.dev/a', 'nb-1'));
});

test('ledgerKey — thiếu vế nào cũng là lỗi, không lặng lẽ ra khoá cụt', () => {
  assert.throws(() => S.ledgerKey('', 'nb-1'));
  assert.throws(() => S.ledgerKey('v1', ''));
  assert.throws(() => S.ledgerKey('v1'));
});

// ------------------------------------------------- chuẩn hoá URL tài liệu

const BASE = 'https://docs.example.com/guide/intro';

test('normalizeDocUrl — giải link tương đối theo trang hiện tại', () => {
  assert.equal(S.normalizeDocUrl('../api/config', BASE), 'https://docs.example.com/api/config');
  assert.equal(S.normalizeDocUrl('/api/config', BASE), 'https://docs.example.com/api/config');
  assert.equal(S.normalizeDocUrl('setup', BASE), 'https://docs.example.com/guide/setup');
});

test('normalizeDocUrl — neo trong trang bị loại (mục lục "On this page")', () => {
  assert.equal(S.normalizeDocUrl('#cai-dat', BASE), null);
  assert.equal(S.normalizeDocUrl('#', BASE), null);
  assert.equal(S.normalizeDocUrl(BASE, BASE), null, 'link trỏ về chính trang đang mở');
  assert.equal(S.normalizeDocUrl('', BASE), null);
});

test('normalizeDocUrl — hash-route kiểu docsify là đường dẫn trang, phải giữ', () => {
  const docsify = 'https://docs.example.com/#/guide/intro';
  assert.equal(S.normalizeDocUrl('#/guide/setup', docsify), 'https://docs.example.com/#/guide/setup');
  assert.equal(S.normalizeDocUrl('#/guide/intro', docsify), null, 'chính trang đang mở');
  assert.equal(
    S.normalizeDocUrl('https://docs.example.com/#/api/config', BASE),
    'https://docs.example.com/#/api/config',
  );
});

test('normalizeDocUrl — neo sang trang khác thì giữ trang, bỏ neo', () => {
  assert.equal(S.normalizeDocUrl('/api/config#options', BASE), 'https://docs.example.com/api/config');
});

test('normalizeDocUrl — khác host hoặc giao thức lạ thì loại', () => {
  assert.equal(S.normalizeDocUrl('https://api.example.com/config', BASE), null);
  assert.equal(S.normalizeDocUrl('https://example.com/config', BASE), null);
  assert.equal(S.normalizeDocUrl('mailto:ai@example.com', BASE), null);
  assert.equal(S.normalizeDocUrl('javascript:void(0)', BASE), null);
  assert.equal(S.normalizeDocUrl(null, BASE), null);
});

test('normalizeDocUrl — cùng trang viết khác kiểu thì ra cùng một khoá', () => {
  const a = S.normalizeDocUrl('/api/config/', BASE);
  const b = S.normalizeDocUrl('https://DOCS.example.com/api/config', BASE);
  assert.equal(a, b);
  assert.equal(a, 'https://docs.example.com/api/config');
});

test('normalizeDocUrl — port là một phần định danh trang (host, không phải hostname)', () => {
  // `host` kèm port, `hostname` thì không. Hoán vị hai thuộc tính cùng kiểu này vẫn cho một
  // định danh trông hợp lệ, nên nó trôi im lặng: docs nội bộ chạy localhost kèm port là
  // chuyện thường, và khi đó hai trang khác nhau ra cùng một khoá khử trùng lặp.
  const dev = 'http://localhost:3000/guide/intro';
  assert.equal(S.normalizeDocUrl('/api', dev), 'http://localhost:3000/api');
  // Hai trang thật khác nhau phải giữ được hai khoá khác nhau. Dùng chung khoá thì lúc khử
  // trùng lặp một trang biến mất khỏi Bảng chọn mà không có triệu chứng nào.
  assert.notEqual(
    S.normalizeDocUrl('/api', dev),
    S.normalizeDocUrl('/api', 'http://localhost:8080/guide/intro'),
  );
});

test('normalizeDocUrl — khác port là khác origin, không phải link điều hướng cùng site', () => {
  const dev = 'http://localhost:3000/guide/intro';
  assert.equal(S.normalizeDocUrl('http://localhost:8080/api', dev), null);
  assert.equal(S.normalizeDocUrl('/api', dev), 'http://localhost:3000/api', 'cùng port vẫn nhận');
});

test('normalizeDocUrl — cùng một trang chỉ ra một định danh, dù link viết kiểu nào', () => {
  // Định danh này là khoá khử trùng lặp của hàng đợi tài liệu: hai định danh cho một trang
  // nghĩa là trang đó vào Nguồn gộp hai lần và tiêu quota hai lần.
  const docsify = 'https://docs.example.com/#/guide/intro';
  assert.equal(S.normalizeDocUrl('#/guide/setup/', docsify), S.normalizeDocUrl('#/guide/setup', docsify));
  assert.equal(S.normalizeDocUrl('http://docs.example.com/api', BASE),
    S.normalizeDocUrl('https://docs.example.com/api', BASE));
});

// ------------------------------------------------- docPageId / sameDocPage (ticket 008)

test('docPageId — cùng một trang viết kiểu nào cũng ra một định danh, dùng chung với normalizeDocUrl', () => {
  // Dùng chung `docIdentity` với `normalizeDocUrl` là ràng buộc, không phải tiện tay: khoá khử
  // trùng lặp của hàng đợi và phép so của nấc 2 mà lệch nhau thì không có triệu chứng nào.
  assert.equal(S.docPageId('https://DOCS.example.com/api/config/'), 'https://docs.example.com/api/config');
  assert.equal(S.docPageId('https://docs.example.com/api/config'), S.normalizeDocUrl('/api/config/', BASE));
  assert.equal(S.docPageId('https://docs.example.com/#/guide/intro/'), 'https://docs.example.com/#/guide/intro');
});

test('docPageId — neo trong trang không tách thành trang khác, hash-route thì có', () => {
  assert.equal(S.docPageId('https://docs.example.com/guide/intro#cai-dat'), 'https://docs.example.com/guide/intro');
  assert.notEqual(S.docPageId('https://docs.example.com/#/a'), S.docPageId('https://docs.example.com/#/b'));
});

test('docPageId — thứ không phải URL http(s) trả chuỗi rỗng, không trả một khoá trông hợp lệ', () => {
  for (const bad of ['', null, 'khong-phai-url', 'mailto:ai@example.com', 'javascript:void(0)']) {
    assert.equal(S.docPageId(bad), '', String(bad));
  }
});

test('sameDocPage — chỉ bỏ qua http↔https, mọi khác biệt còn lại vẫn là hai trang', () => {
  assert.equal(S.sameDocPage('http://d.local/guide/', 'https://d.local/guide'), true, 'nâng cấp giao thức');
  assert.equal(S.sameDocPage('https://d.local/#/a', 'https://d.local/#/a/'), true);
  assert.equal(S.sameDocPage('https://d.local/#/a', 'https://d.local/#/b'), false, 'hash-route khác trang');
  assert.equal(S.sameDocPage('https://d.local/a', 'https://other.local/a'), false, 'khác host');
  assert.equal(S.sameDocPage('http://localhost:3000/a', 'http://localhost:8080/a'), false, 'khác port');
  assert.equal(S.sameDocPage('https://d.local/a', ''), false, 'thiếu một vế thì không phải "giống nhau"');
});

test('normalizeDocUrl — docs chạy trên http thì giữ http, không nâng thành https', () => {
  // Đổi scheme theo trang đang mở, không ép https: docs nội bộ chỉ có http sẽ fetch hỏng.
  const httpBase = 'http://docs.noi-bo.local/guide/intro';
  assert.equal(S.normalizeDocUrl('/api', httpBase), 'http://docs.noi-bo.local/api');
});

test('normalizeDocUrl — query là một phần định danh trang, không bỏ', () => {
  assert.equal(S.normalizeDocUrl('/search?q=rust', BASE), 'https://docs.example.com/search?q=rust');
});

// --------------------------------------------------- gộp ghi đè selector

const FAKE_DEFAULTS = { alpha: ['một', 'HAI'], beta: ['ba'] };

test('mergeSelectorOverrides — ghi đè gộp thêm vào mặc định và đứng trước', () => {
  const merged = S.mergeSelectorOverrides(FAKE_DEFAULTS, { alpha: ['bốn'] });
  assert.deepEqual(merged.alpha, ['bon', 'mot', 'hai']);
  assert.deepEqual(merged.beta, ['ba'], 'nhóm không ghi đè phải giữ nguyên');
});

test('mergeSelectorOverrides — nhãn về chữ thường không dấu, và khử trùng lặp', () => {
  const merged = S.mergeSelectorOverrides(FAKE_DEFAULTS, { alpha: ['  MỘT  ', 'Bốn', 'bốn'] });
  assert.deepEqual(merged.alpha, ['mot', 'bon', 'hai']);
});

test('mergeSelectorOverrides — ghi đè hỏng thì bỏ qua, không làm mất mặc định', () => {
  for (const bad of [null, undefined, 'một', { alpha: 'không phải mảng' }, { alpha: [1, '', null] }]) {
    const merged = S.mergeSelectorOverrides(FAKE_DEFAULTS, bad);
    assert.deepEqual(merged.alpha, ['mot', 'hai'], `hỏng ở: ${JSON.stringify(bad)}`);
  }
});

test('mergeSelectorOverrides — không sửa vào bộ mặc định', () => {
  const before = JSON.stringify(FAKE_DEFAULTS);
  const merged = S.mergeSelectorOverrides(FAKE_DEFAULTS, { alpha: ['bốn'] });
  merged.alpha.push('năm');
  assert.equal(JSON.stringify(FAKE_DEFAULTS), before);
});

// ------------------------------------------------------------------- hằng số

test('DEFAULTS — mỗi setting có giá trị dùng được ngay', () => {
  assert.equal(typeof S.DEFAULTS.downloadDir, 'string');
  assert.ok(S.DEFAULTS.downloadDir.length > 0);
  assert.ok(['md', 'srt', 'vtt'].includes(S.DEFAULTS.transcriptFormat));
  assert.ok(S.DEFAULTS.mergeWindowSeconds > 0);
  assert.equal(S.DEFAULTS.maxWordsPerSource, S.MAX_WORDS_PER_SOURCE);
  assert.ok(S.DEFAULTS.docsMinChars > 0);
  assert.ok(S.DEFAULTS.wordsPerMinute > 0);
});

test('EXT_PREFIX — mọi id do extension tạo mang chung một tiền tố', () => {
  assert.equal(S.EXT_PREFIX, 'nblm-');
});

// ------------------------------------------------------------- bóc notebookId

test('parseNotebookId — bóc id từ URL tab NotebookLM, kể cả khi còn đuôi phía sau', () => {
  const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  assert.equal(S.parseNotebookId(`https://notebooklm.google.com/notebook/${id}`), id);
  assert.equal(S.parseNotebookId(`https://notebooklm.google.com/notebook/${id}/`), id);
  assert.equal(S.parseNotebookId(`https://notebooklm.google.com/notebook/${id}?hl=vi`), id);
  assert.equal(S.parseNotebookId(`https://notebooklm.google.com/notebook/${id}/audio`), id);
});

test('parseNotebookId — host khác thì KHÔNG nhận, dù đường dẫn trông y hệt', () => {
  // Khoá Sổ đã import dựng từ id này (ADR 0006): nhận nhầm là chống trùng lặp sai âm thầm,
  // không có triệu chứng nào ở lần chạy đầu.
  assert.equal(S.parseNotebookId('https://www.youtube.com/notebook/a1b2c3d4e5'), null);
  assert.equal(S.parseNotebookId('https://notebooklm.google.com.evil.test/notebook/a1b2c3d4e5'), null);
});

test('parseNotebookId — trang chủ, đường dẫn lạ, id quá ngắn hay chuỗi bậy đều ra null', () => {
  assert.equal(S.parseNotebookId('https://notebooklm.google.com/'), null);
  assert.equal(S.parseNotebookId('https://notebooklm.google.com/notebook'), null);
  assert.equal(S.parseNotebookId('https://notebooklm.google.com/settings/abc12345'), null);
  assert.equal(S.parseNotebookId('https://notebooklm.google.com/notebook/abc'), null);
  assert.equal(S.parseNotebookId('không phải url'), null);
  assert.equal(S.parseNotebookId(null), null);
});
