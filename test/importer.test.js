// Chỗ nối của ticket 005: trích → **ghi Bản lưu ra đĩa** → đẩy vào Notebook đích.
//
// Đây là test của thứ tự, không phải của từng mảnh: từng mảnh đã có test riêng ở ticket
// 002/003/004. Cái duy nhất chỉ tồn tại khi ba mảnh ghép lại là bất biến của ADR 0011 —
// **file phải nằm trên đĩa trước khi thử đẩy** — và bất biến ấy vô hình với mọi test của
// từng mảnh.
//
// Adapter giả ở đây ghi vào một nhật ký chung theo thứ tự gọi. Đảo hai dòng `save`/`push`
// trong `createExtractor`/engine là một phép hoán vị hai thứ cùng kiểu (hai lời gọi adapter
// async) mà không test nào khác của repo thấy được.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/youtube/srt.js';
import '../src/background/queue-engine.js';
import '../src/background/importer.js';

const S = globalThis.NBLM_SHARED;
const F = globalThis.NBLM_TRANSCRIPT_FORMAT;
const I = globalThis.NBLM_IMPORTER;

const SETTINGS = Object.freeze({ ...S.DEFAULTS });

const VIDEO = Object.freeze({
  id: 'dQw4w9WgXcQ',
  kind: 'video',
  title: 'Học Rust trong 30 phút',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
});

const EXTRACTED = Object.freeze({
  meta: Object.freeze({
    videoId: 'dQw4w9WgXcQ',
    title: 'Học Rust trong 30 phút',
    channel: 'Kênh Lập Trình',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    privacy: 'private',
    durationSeconds: 1800,
  }),
  segments: Object.freeze([
    { start: 0, end: 2, text: 'Xin chào các bạn' },
    { start: 95, end: 98, text: 'hôm nay ta học Rust' },
  ]),
  via: 'dom',
});

/** Bộ adapter giả dùng chung: một nhật ký, mọi lời gọi ghi vào đó theo đúng thứ tự xảy ra. */
function fakeDeps(overrides) {
  const journal = [];
  const disk = [];
  const pushed = [];
  const deps = {
    journal,
    disk,
    pushed,
    async extractVideo(item) {
      journal.push(`extract:${item.id}`);
      return EXTRACTED;
    },
    async saveFile(file) {
      journal.push(`save:${file.filename}`);
      disk.push(file);
      return { id: disk.length };
    },
    async pushSource(source) {
      journal.push(`push:${source.name}`);
      pushed.push(source);
      return { ok: true, name: source.name };
    },
    ...(overrides || {}),
  };
  return deps;
}

const run = (deps, extra) => I.runImport({
  items: [{ ...VIDEO }],
  notebookId: 'nb-123',
  settings: SETTINGS,
  deps,
  ...(extra || {}),
});

// ----------------------------------------------------- thứ tự: ghi trước, đẩy sau

test('Bản lưu ghi ra đĩa TRƯỚC khi thử đẩy — không phải sau, không phải song song', async () => {
  const deps = fakeDeps();
  await run(deps);
  assert.deepEqual(deps.journal, [
    'extract:dQw4w9WgXcQ',
    'save:Transcript YouTube/Học Rust trong 30 phút — dQw4w9WgXcQ.md',
    'push:Học Rust trong 30 phút',
  ]);
});

test('ngắt mạng ở khâu đẩy: file transcript VẪN nằm trên đĩa, đủ chữ (ADR 0011)', async () => {
  const deps = fakeDeps({
    async pushSource(source) {
      deps.journal.push(`push:${source.name}`);
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    },
  });
  const log = await run(deps);

  assert.equal(deps.disk.length, 1, 'mất mạng ở khâu đẩy không được làm mất Bản lưu');
  assert.ok(deps.disk[0].text.includes('Xin chào các bạn'));
  assert.ok(deps.disk[0].text.includes('hôm nay ta học Rust'));
  assert.deepEqual(log.saved.map((f) => f.filename), [deps.disk[0].filename]);

  // Và mục vẫn được kế toán đúng: rớt ở khâu đẩy, quay lại hàng đợi, không vào Sổ đã import.
  assert.deepEqual(log.dropped.map((d) => [d.id, d.stage]), [['dQw4w9WgXcQ', 'push']]);
  assert.deepEqual(log.state.ledger, []);
  assert.deepEqual(log.state.pending.map((i) => i.id), ['dQw4w9WgXcQ']);
});

test('ghi đĩa hỏng thì vẫn đẩy tiếp, và nói ra — mất Bản lưu không phải lý do bỏ import', async () => {
  const deps = fakeDeps({
    async saveFile() {
      deps.journal.push('save:hỏng');
      throw new Error('Download failed: SERVER_FORBIDDEN');
    },
  });
  const log = await run(deps);

  assert.deepEqual(deps.journal, ['extract:dQw4w9WgXcQ', 'save:hỏng', 'push:Học Rust trong 30 phút']);
  assert.equal(log.sources.length, 1);
  assert.equal(log.saved.length, 0);
  assert.equal(log.saveFailures.length, 1);
  assert.match(log.saveFailures[0].reason, /SERVER_FORBIDDEN/);
});

// ----------------------------------------------------- Bản lưu và Nguồn không đổi chỗ

test('file trên đĩa và thân Nguồn: tên file đi vào tên file, transcript đi vào nội dung', async () => {
  const deps = fakeDeps();
  await run(deps);
  const file = deps.disk[0];

  assert.ok(file.filename.endsWith('.md'), file.filename);
  assert.ok(file.text.startsWith('# Học Rust trong 30 phút'), 'thân file phải là transcript');
  assert.ok(!file.filename.includes('Xin chào'), 'transcript lọt vào tên file là đã đổi chỗ hai thứ');
  assert.equal(file.mime, F.MIME.md);
  assert.ok(file.url.startsWith(`data:${F.MIME.md};charset=utf-8,`), file.url.slice(0, 40));
});

test('Nguồn đẩy đi: tên Nguồn là tiêu đề, thân Nguồn là transcript — không hoán vị', async () => {
  const deps = fakeDeps();
  await run(deps);
  const source = deps.pushed[0];

  assert.equal(source.name, VIDEO.title);
  assert.ok(source.body.includes('[00:00] Xin chào các bạn'), source.body.slice(0, 80));
  assert.ok(!source.name.includes('Xin chào'), 'tên Nguồn là vĩnh viễn (ADR 0010) — không được là cả transcript');
  assert.equal(source.notebookId, 'nb-123');
  assert.deepEqual(source.itemIds, ['dQw4w9WgXcQ']);
});

test('thân Nguồn luôn là bản md, kể cả khi Bản lưu trên đĩa là srt', async () => {
  const deps = fakeDeps();
  await I.runImport({
    items: [{ ...VIDEO }],
    notebookId: 'nb-123',
    settings: { ...SETTINGS, transcriptFormat: 'srt' },
    deps,
  });

  assert.ok(deps.disk[0].filename.endsWith('.srt'), deps.disk[0].filename);
  assert.ok(deps.disk[0].text.startsWith('1\n00:00:00,000 --> '), deps.disk[0].text.slice(0, 40));
  assert.ok(deps.pushed[0].body.startsWith('# Học Rust trong 30 phút'), 'Nguồn không đi theo định dạng file');
  assert.ok(deps.pushed[0].body.includes('- Kênh: Kênh Lập Trình'));
});

test('định dạng Bản lưu theo Cài đặt: md/srt/vtt ra ba file khác nhau, đúng đuôi', async () => {
  for (const format of F.FORMATS) {
    const deps = fakeDeps();
    await I.runImport({
      items: [{ ...VIDEO }],
      notebookId: 'nb-123',
      settings: { ...SETTINGS, transcriptFormat: format },
      deps,
    });
    assert.equal(deps.disk[0].format, format);
    assert.ok(deps.disk[0].filename.endsWith(`.${format}`), deps.disk[0].filename);
    assert.equal(deps.disk[0].mime, F.MIME[format]);
  }
});

// ----------------------------------------------------- meta của trang và của Mục hàng đợi

test('meta đọc từ trang thắng meta đoán từ hàng đợi — trang là thứ vừa nhìn thấy thật', () => {
  const meta = I.mergeMeta({ id: 'abc', title: 'Tên cũ trong hàng đợi', url: 'https://youtu.be/abc' }, {
    title: 'Tên thật trên trang',
    channel: 'Kênh Lập Trình',
    privacy: 'unlisted',
    durationSeconds: 90,
  });
  assert.equal(meta.videoId, 'abc');
  assert.equal(meta.title, 'Tên thật trên trang');
  assert.equal(meta.channel, 'Kênh Lập Trình');
  assert.equal(meta.privacy, 'unlisted');
  assert.equal(meta.durationSeconds, 90);
  assert.equal(meta.url, 'https://youtu.be/abc');
});

test('meta — trang không đọc được tiêu đề thì giữ tiêu đề của hàng đợi, không ra rỗng', () => {
  const meta = I.mergeMeta({ id: 'abc', title: 'Tên cũ' }, { title: '   ', channel: 'Kênh' });
  assert.equal(meta.title, 'Tên cũ');
  assert.equal(meta.channel, 'Kênh');
});

test('meta — videoId của Mục hàng đợi là thứ không trang nào ghi đè được', () => {
  const meta = I.mergeMeta({ id: 'abc' }, { videoId: 'khac-hoan-toan' });
  assert.equal(meta.videoId, 'abc', 'id trong tên file phải là id của mục đã xếp hàng');
});

/**
 * `url` đi **ngược** chiều ưu tiên của `title`/`channel`/`privacy`, và ba test dưới đây canh
 * đúng cái ngược chiều ấy.
 *
 * Test "meta đọc từ trang thắng…" ở trên có kiểm `meta.url`, nhưng meta trang trong ca đó
 * không mang `url` nào cả — nên nó xanh với **cả hai** thứ tự và hoán vị `pick(i.url, m.url)`
 * → `pick(m.url, i.url)` sống sót nguyên vẹn. Điều kiện để giết được hoán vị đó là hai bên
 * cùng có url và hai url **khác nhau**; so sánh với biến chứ không với chuỗi cố định, để test
 * nói về quan hệ ("url của Mục thắng") chứ không về một địa chỉ cụ thể.
 */
test('meta — url của Mục hàng đợi thắng url của trang: Link gốc là video được yêu cầu', () => {
  const requested = 'https://www.youtube.com/watch?v=video-duoc-yeu-cau';
  const onScreen = 'https://www.youtube.com/watch?v=video-dang-mo';
  const meta = I.mergeMeta(
    { id: 'video-duoc-yeu-cau', url: requested, title: 'Tên đoán từ link' },
    { videoId: 'video-dang-mo', url: onScreen, title: 'Tên thật trên trang' },
  );

  assert.equal(meta.url, requested, 'Link gốc phải trỏ video người dùng bấm, không phải tab đang mở');
  assert.notEqual(meta.url, onScreen);
});

test('meta — nội dung theo trang nhưng danh tính theo Mục, trong cùng một lần gộp', () => {
  // Bất đối xứng giữa `title` và `url` là cố ý; test này là chỗ nói ra điều đó, để lần sau ai
  // đọc `pick(i.url, m.url)` không "sửa" nó cho đều với ba dòng bên trên.
  const item = { id: 'id-cua-muc', url: 'https://youtu.be/id-cua-muc', title: 'Tên đoán từ link' };
  const page = { videoId: 'id-cua-trang', url: 'https://youtu.be/id-cua-trang', title: 'Tên thật trên trang' };
  const meta = I.mergeMeta(item, page);

  assert.equal(meta.title, page.title, 'nội dung: trang thắng');
  assert.equal(meta.url, item.url, 'danh tính: Mục thắng');
  assert.equal(meta.videoId, item.id, 'danh tính: Mục thắng');
});

test('meta — Mục hàng đợi không có url thì mới dùng url của trang, không bỏ trống Link gốc', () => {
  const onScreen = 'https://www.youtube.com/watch?v=video-dang-mo';
  const meta = I.mergeMeta({ id: 'video-dang-mo' }, { url: onScreen });
  assert.equal(meta.url, onScreen, '"Mục thắng" là ưu tiên, không phải là bỏ hẳn url của trang');
});

test('Link gốc trong thân Nguồn đi ra từ url của Mục, không phải url trang trả về', () => {
  // Chốt ở đầu ra: `contextHeader` in `url` thành dòng người dùng thật sự nhấn vào. Test
  // `mergeMeta` ở trên chết theo hoán vị, còn test này nói vì sao chuyện đó đáng quan tâm.
  const requested = 'https://www.youtube.com/watch?v=video-duoc-yeu-cau';
  const built = I.buildTranscript(
    { ...VIDEO, id: 'video-duoc-yeu-cau', url: requested },
    EXTRACTED,
    SETTINGS,
  );

  assert.ok(built.body.includes(`- Link gốc: ${requested}`), built.body.split('\n').slice(0, 6).join('\n'));
  assert.ok(!built.body.includes(EXTRACTED.meta.url), 'url của tab đang mở không được lọt vào thân Nguồn');
  assert.ok(built.file.text.includes(requested) || built.file.format !== 'md');
});

// ----------------------------------------------------------------- đường dẫn tải về

test('downloadPath — thư mục Cài đặt đứng trước tên file, ngăn bằng đúng một dấu /', () => {
  assert.equal(I.downloadPath('Transcript YouTube', 'a.md'), 'Transcript YouTube/a.md');
  assert.equal(I.downloadPath('Transcript YouTube/', 'a.md'), 'Transcript YouTube/a.md');
  assert.equal(I.downloadPath('  ', 'a.md'), 'a.md');
});

test('downloadPath — đường dẫn tuyệt đối và `..` bị chặn: Chrome từ chối cả lần tải', () => {
  // `chrome.downloads.download`: "Absolute paths, empty paths, and paths containing
  // back-references '..' will cause an error." Chặn ở đây, không để tới lúc Chrome từ chối.
  const path = I.downloadPath('/etc/../../thư mục', 'a.md');
  assert.ok(!path.startsWith('/'), path);
  assert.ok(!path.includes('..'), path);
  assert.ok(path.endsWith('/a.md'), path);
});

// ------------------------------------------------------------- Sổ đã import nối vào

test('import lại cùng video vào cùng notebook: bỏ qua, và không ghi đĩa lần nữa', async () => {
  const first = fakeDeps();
  const log1 = await run(first);

  const second = fakeDeps();
  const log2 = await I.runImport({
    items: [{ ...VIDEO }],
    notebookId: 'nb-123',
    state: log1.state,
    settings: SETTINGS,
    deps: second,
  });

  assert.deepEqual(log2.skipped.map((s) => s.id), ['dQw4w9WgXcQ']);
  assert.deepEqual(second.journal, [], 'đã có trong Sổ thì không trích lại, không ghi lại, không đẩy lại');
});

test('cùng video vào notebook KHÁC thì vẫn chạy (ADR 0006)', async () => {
  const first = fakeDeps();
  const log1 = await run(first);

  const second = fakeDeps();
  const log2 = await I.runImport({
    items: [{ ...VIDEO }],
    notebookId: 'nb-KHAC',
    state: log1.state,
    settings: SETTINGS,
    deps: second,
  });

  assert.deepEqual(log2.skipped, []);
  assert.equal(second.pushed.length, 1);
  assert.equal(second.pushed[0].notebookId, 'nb-KHAC');
});

// ------------------------------------------------- chạy hàng đợi mà không đụng NotebookLM

test('chỉ tải về: trích và ghi đĩa, KHÔNG đẩy và KHÔNG đụng Sổ đã import', async () => {
  const deps = fakeDeps();
  const report = await I.saveOnly({ items: [{ ...VIDEO }], settings: SETTINGS, deps });

  assert.deepEqual(deps.journal, [
    'extract:dQw4w9WgXcQ',
    'save:Transcript YouTube/Học Rust trong 30 phút — dQw4w9WgXcQ.md',
  ]);
  assert.equal(deps.pushed.length, 0, 'nút này tồn tại để không đụng vào NotebookLM');
  assert.deepEqual(report.saved.map((f) => f.filename), [deps.disk[0].filename]);
  assert.deepEqual(report.failed, []);
});

test('chỉ tải về: một video hỏng không chặn video còn lại', async () => {
  const deps = fakeDeps({
    async extractVideo(item) {
      deps.journal.push(`extract:${item.id}`);
      if (item.id === 'hong') throw new Error('panel transcript không mở');
      return EXTRACTED;
    },
  });
  const report = await I.saveOnly({
    items: [{ id: 'hong', kind: 'video', title: 'Video hỏng' }, { ...VIDEO }],
    settings: SETTINGS,
    deps,
  });

  assert.equal(report.saved.length, 1);
  assert.deepEqual(report.failed.map((f) => f.id), ['hong']);
  assert.match(report.failed[0].reason, /panel transcript/);
});

test('chỉ tải về không cần Notebook đích — đó là cả điểm của nó', async () => {
  const deps = fakeDeps();
  await assert.doesNotReject(() => I.saveOnly({ items: [{ ...VIDEO }], settings: SETTINGS, deps }));
  await assert.rejects(
    () => I.runImport({ items: [{ ...VIDEO }], notebookId: '', settings: SETTINGS, deps: fakeDeps() }),
    /Notebook đích/,
  );
});

// ------------------------------------------------------------------ trích rỗng

test('trích ra rỗng là mục rớt có lý do, không phải một Nguồn rỗng đẩy vào notebook', async () => {
  const deps = fakeDeps({
    async extractVideo(item) {
      deps.journal.push(`extract:${item.id}`);
      return { meta: EXTRACTED.meta, segments: [] };
    },
  });
  const log = await run(deps);

  assert.equal(deps.pushed.length, 0);
  assert.equal(deps.disk.length, 0, 'không có chữ nào thì cũng không có gì để lưu');
  assert.equal(log.dropped.length, 1);
  assert.match(log.dropped[0].reason, /không có segment|rỗng/i);
});

test('importer không chạm chrome và không chạm DOM: mọi lối ra đi qua adapter', () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
});

// ------------------------------------------------- Mục hàng đợi từ chỗ người dùng bấm

test('menu chuột phải: import LINK vừa bấm, không phải video đang xem', () => {
  // `linkUrl` và `pageUrl` cùng kiểu và cùng hợp lệ trên một trang watch — hoán vị vẫn ra
  // một lần import trót lọt, chỉ là của nhầm video.
  const item = I.itemFromLink(
    { linkUrl: 'https://youtu.be/dQw4w9WgXcQ', pageUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Trang đang mở' },
  );
  assert.equal(item.id, 'dQw4w9WgXcQ');
  assert.equal(item.url, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(item.kind, 'video');
});

test('menu chuột phải trên link không phải YouTube: không dựng Mục hàng đợi nào', () => {
  assert.equal(I.itemFromLink({ linkUrl: 'https://example.com/a' }, {}), null);
  assert.equal(I.itemFromLink({}, {}), null);
});

test('nút trên trang / phím tắt: Mục hàng đợi lấy từ URL của tab, tiêu đề lấy từ tab', () => {
  const item = I.itemFromTab({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Học Rust - YouTube' });
  assert.equal(item.id, 'dQw4w9WgXcQ');
  assert.equal(item.title, 'Học Rust - YouTube');
  assert.equal(I.itemFromTab({ url: 'https://notebooklm.google.com/' }), null);
  assert.equal(I.itemFromTab(null), null);
});

// ------------------------------------------------ hàng đợi còn nợ **cộng** mục đang xem

test('itemsToRun gộp hàng đợi còn nợ với mục đang xem, không cái này thay cái kia', () => {
  const pending = [{ id: 'a', kind: 'video' }, { id: 'b', kind: 'video' }];
  const current = [{ id: 'c', kind: 'video' }];
  assert.deepEqual(I.itemsToRun(pending, current).map((item) => item.id), ['a', 'b', 'c']);
});

test('itemsToRun bỏ trùng theo id: đang xem đúng video còn nợ thì chạy một lần', () => {
  const pending = [{ id: 'a', kind: 'video', title: 'từ hàng đợi' }];
  const current = [{ id: 'a', kind: 'video', title: 'từ tab' }];
  const run = I.itemsToRun(pending, current);
  assert.equal(run.length, 1);
  assert.equal(run[0].title, 'từ hàng đợi', 'bản trong hàng đợi là bản giữ được qua lần chạy trước');
});

test('itemsToRun chịu được rỗng và null ở cả hai phía', () => {
  assert.deepEqual(I.itemsToRun(null, null), []);
  assert.deepEqual(I.itemsToRun([], [null]), []);
  assert.deepEqual(I.itemsToRun(null, [{ id: 'c' }]).map((item) => item.id), ['c']);
});
