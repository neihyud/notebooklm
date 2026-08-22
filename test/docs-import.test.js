// Ticket 010 — chỗ nối của nhánh tài liệu: Bảng chọn → Mục hàng đợi → engine → Nguồn.
//
// Cùng khuôn `test/importer.test.js` của nhánh video: mọi lối ra là adapter giả, không Chrome,
// không DOM, không mạng. Thứ chỉ xuất hiện khi ghép các mảnh lại — và vì thế chỉ test được ở
// đây — là **ranh giới bó** và **thứ tự chạy của hai hàng đợi**:
//
//   1. *Một nhánh 40 trang ra ĐÚNG MỘT Nguồn.* Engine gộp theo khoá `(site, Nhánh)`, nên hỏng ở
//      đây nghĩa là 40 Nguồn — và lần import vẫn chạy trót lọt từ đầu tới cuối, chỉ tiêu hết
//      quota 50 nguồn ở trang thứ 50 (ADR 0005).
//   2. *80 trang tài liệu không xếp hàng sau các video đang trích* (ADR 0007). Đo bằng **nhật ký
//      chạy của engine**, không bằng lập luận: `log.trace` ghi từng lần vào/ra của cả hai khâu.
//
// Bốn cặp cùng kiểu mà file này canh, và test nào chết khi hoán vị:
//   - Nhánh đã tick ↔ nhãn của chính trang: `một nhánh 40 trang…` (ra 40 Nguồn).
//   - hàng đợi tài liệu ↔ hàng đợi video: `80 trang tài liệu…` (bế tắc, rồi hết giờ).
//   - `url` của Mục ↔ `url` của trang trong `- Link gốc:`: `thân Nguồn — Link gốc…`.
//   - trần số từ (`maxWordsPerSource`) ↔ ngưỡng `docsMinChars`: `một nhánh 40 trang…` (cắt vụn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, input } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/docs/selectors.js';
import '../src/docs/sidebar.js';
import '../src/docs/picker.js';
import '../src/youtube/srt.js';
import '../src/background/queue-engine.js';
import '../src/background/docs-queue.js';
import '../src/background/importer.js';

const S = globalThis.NBLM_SHARED;
const E = globalThis.NBLM_ENGINE;
const Q = globalThis.NBLM_DOCS_QUEUE;
const I = globalThis.NBLM_IMPORTER;
const K = globalThis.NBLM_DOCS_PICKER;

const SITE = 'https://docs.acme.dev';
const PAGE = `${SITE}/guide/cai-dat`;

/** Một dòng trong danh sách Bảng chọn gửi đi: `selection()` của `src/docs/picker.js`. */
const picked = (slug, title, branch) => ({ url: `${SITE}${slug}`, title, branch });

/** 40 trang của **một** Nhánh — đúng con số trong Acceptance của ticket. */
const branchOf40 = (branch = 'Hướng dẫn') =>
  Array.from({ length: 40 }, (_, i) => picked(`/guide/trang-${i}`, `Trang ${i}`, branch));

const fromPicker = (pages, page = PAGE) => Q.itemsFromPicker({ page, pages });

/** Trang tài liệu giả: đúng hình dạng `fetchDocPage` của `src/docs/extract.js` trả về. */
const fakePage = (item, extra = {}) => ({
  url: item.url,
  title: item.title,
  markdown: `## ${item.title}\n\nMột đoạn nội dung của ${item.title}.`,
  chars: 40,
  via: 'fetch',
  escalated: false,
  ...extra,
});

/** Bộ adapter giả cho `runImport`: video và tài liệu, cùng một nhật ký. */
function fakeDeps(opts = {}) {
  const pushed = [];
  return {
    pushed,
    deps: {
      extractVideo: opts.extractVideo || (async (item) => ({
        meta: { videoId: item.id, title: item.title },
        segments: [{ start: 0, text: `Transcript ${item.id}` }],
      })),
      extractDoc: opts.extractDoc || (async (item) => fakePage(item)),
      pushSource: opts.pushSource || (async (source) => { pushed.push(source); }),
    },
  };
}

const run = (items, extra = {}) => I.runImport({
  items,
  notebookId: 'NB-1',
  ...extra,
  deps: extra.deps || fakeDeps().deps,
});

// ------------------------------------------------------- Bảng chọn → Mục hàng đợi

test('Mục hàng đợi — mỗi trang mang định danh trang làm id, và Nhánh nằm trong khoá bó', () => {
  const items = fromPicker([picked('/guide/cai-dat', 'Cài đặt', 'Hướng dẫn')]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, S.docPageId(`${SITE}/guide/cai-dat`));
  assert.equal(items[0].kind, E.DOCS_QUEUE);
  assert.deepEqual(items[0].group, { kind: 'docs', source: 'docs.acme.dev', branch: 'Hướng dẫn' });
});

test('Mục hàng đợi — cùng một trang viết hai kiểu chỉ vào hàng đợi một lần', () => {
  // Khoá khử trùng lặp là định danh trang, không phải chuỗi href: vào hai lần là vào Nguồn gộp
  // hai lần và tiêu quota hai lần.
  const items = fromPicker([
    picked('/guide/cai-dat', 'Cài đặt', 'Hướng dẫn'),
    picked('/guide/cai-dat/', 'Cài đặt', 'Hướng dẫn'),
  ]);
  assert.equal(items.length, 1);
});

test('Mục hàng đợi — trang không đọc được URL bị loại, không mang một id trông hợp lệ', () => {
  const items = Q.itemsFromPicker({
    page: PAGE,
    pages: [picked('/guide/a', 'A', 'G'), { url: 'javascript:void(0)', title: 'Bẫy', branch: 'G' }],
  });
  assert.deepEqual(items.map((i) => i.title), ['A']);
});

test('Mục hàng đợi — không đọc được trang đang mở thì nói ra, không đặt tên Nguồn bằng chuỗi rỗng', () => {
  // Tên Nguồn là vĩnh viễn (ADR 0010). Một `source` rỗng đi lọt tới `bundleName` sẽ ném ra giữa
  // vòng chạy, sau khi vài Nguồn đã đẩy — nên chặn ở cửa vào.
  assert.throws(() => Q.itemsFromPicker({ page: 'khong-phai-url', pages: branchOf40() }), /tài liệu/);
});

// ------------------------------------------------------- một nhánh, một Nguồn (ADR 0005)

test('một nhánh 40 trang ra ĐÚNG MỘT Nguồn, không phải 40', async () => {
  const log = await run(fromPicker(branchOf40()));

  assert.equal(log.sources.length, 1, `40 trang ra ${log.sources.length} Nguồn`);
  assert.equal(log.sources[0].itemIds.length, 40);
  // Tên suy từ (site, Nhánh) và chỉ từ đó — phần 1 của một nhánh không mang chỉ số (ADR 0010).
  assert.equal(log.sources[0].name, 'docs.acme.dev — Hướng dẫn');
  assert.equal(log.summary.imported, 40);
  assert.equal(log.summary.balanced, true, E.formatSummary(log));
  // Trần cắt là **số từ mỗi Nguồn**, không phải ngưỡng "trang mỏng" `docsMinChars`: hai con số
  // cùng đơn vị đếm, và hoán vị chúng cắt nhánh này thành hàng chục Nguồn.
  assert.ok(log.sources[0].words < S.DEFAULTS.maxWordsPerSource);
  assert.ok(log.sources[0].words > S.DEFAULTS.docsMinChars, 'fixture phải vượt ngưỡng kia mới phân biệt được');
});

test('hai Nhánh tick cùng lượt ra hai Nguồn, cắt theo ranh giới Nhánh chứ không theo số từ', async () => {
  const log = await run(fromPicker([
    ...branchOf40('Hướng dẫn').slice(0, 3),
    ...Array.from({ length: 2 }, (_, i) => picked(`/api/cli-${i}`, `CLI ${i}`, 'Tham chiếu API')),
  ]));

  assert.deepEqual(log.sources.map((s) => s.name).sort(),
    ['docs.acme.dev — Hướng dẫn', 'docs.acme.dev — Tham chiếu API']);
  assert.deepEqual(log.sources.map((s) => s.itemIds.length).sort(), [2, 3]);
});

test('một nhánh MỘT MÌNH vượt trần thì mới cắt tiếp theo số từ, và phần sau mới mang chỉ số', async () => {
  // ADR 0005: ranh giới Nhánh trước, số từ chỉ là lối lui. Phần đầu vẫn mang đúng tên nhánh —
  // đánh số ngay từ phần 1 sẽ bắt mọi nhánh vừa một Nguồn phải mang một chỉ số vô nghĩa.
  const log = await run(fromPicker(branchOf40().slice(0, 4)), { settings: { maxWordsPerSource: 12 } });

  assert.ok(log.sources.length > 1, 'nhánh vượt trần phải được cắt tiếp');
  assert.equal(log.sources[0].name, 'docs.acme.dev — Hướng dẫn');
  assert.match(log.sources[1].name, /— phần 2$/);
  assert.equal(log.summary.imported, 4, E.formatSummary(log));
});

// ------------------------------------------------------------------ thân Nguồn

test('thân Nguồn — mỗi trang mang header ngữ cảnh của riêng nó trong Nguồn gộp (ADR 0002)', async () => {
  const { deps, pushed } = fakeDeps();
  await run(fromPicker(branchOf40().slice(0, 2)), { deps });

  const body = pushed[0].body;
  assert.match(body, /# Trang 0/);
  assert.match(body, /# Trang 1/);
  assert.ok(body.includes(E.PART_SEPARATOR), 'hai phần phải có ngăn giữa');
  assert.match(body, /## Trang 0/, 'Markdown của trang phải còn nguyên trong thân');
});

test('thân Nguồn — `- Link gốc:` trỏ URL của MỤC, không phải URL mà lượt trích đi tới', async () => {
  // Cùng bất biến với `mergeMeta` của ticket 005: **nội dung theo trang, danh tính theo Mục**.
  // Máy chủ nâng `http` lên `https` giữa chừng là chuyện thường, và cả hai URL đều mở được —
  // nên hoán vị hai chuỗi này không lộ ra ở đâu cả, ngoài chỗ người dùng nhấn để kiểm chứng.
  const { deps, pushed } = fakeDeps({
    extractDoc: async (item) => fakePage(item, {
      url: item.url.replace('https://', 'http://'),
      title: 'Tiêu đề đọc được trên trang',
    }),
  });
  await run(fromPicker([picked('/guide/cai-dat', 'Cài đặt', 'Hướng dẫn')]), { deps });

  assert.match(pushed[0].body, /- Link gốc: https:\/\/docs\.acme\.dev\/guide\/cai-dat$/m);
  // Tiêu đề thì ngược lại: trang là thứ vừa nhìn thấy thật, nhãn sidebar chỉ là thứ hàng đợi đoán.
  assert.match(pushed[0].body, /# Tiêu đề đọc được trên trang/);
});

test('thân Nguồn — trang trích ra rỗng thì rớt có tên tuổi, không lặng lẽ thành một phần trắng', async () => {
  const { deps } = fakeDeps({
    extractDoc: async (item) => (item.title === 'Trang 1' ? fakePage(item, { markdown: '   ' }) : fakePage(item)),
  });
  const log = await run(fromPicker(branchOf40().slice(0, 3)), { deps });

  assert.equal(log.sources[0].itemIds.length, 2);
  assert.equal(log.dropped.length, 1, E.formatSummary(log));
  assert.equal(log.summary.balanced, true, 'mục rớt vẫn phải có một dòng trong bảng tổng kết');
});

// --------------------------------------------- hai hàng đợi chạy song song (ADR 0007)

/**
 * Cổng mở khi **đủ** `count` trang tài liệu đã trích xong; hết giờ thì hỏng bằng một câu nói rõ
 * chuyện gì đã xảy ra.
 *
 * Đây là phép đo, không phải phép chờ: adapter video đứng sau cổng này, nên nếu chỗ nối cho
 * hàng tài liệu chạy **sau** hàng video thì video đợi tài liệu, tài liệu đợi video, và lần chạy
 * bế tắc. Một lập luận "engine chạy song song mà" không phát hiện được điều đó — chỗ nối mới là
 * chỗ dễ nối tuần tự.
 */
function afterDocs(count, ms = 3000) {
  let seen = 0;
  let open;
  let fail;
  const gate = new Promise((resolve, reject) => { open = resolve; fail = reject; });
  const timer = setTimeout(
    () => fail(new Error(`hàng tài liệu xếp sau hàng video: mới trích ${seen}/${count} trang thì bế tắc`)),
    ms,
  );
  gate.catch(() => {});
  return {
    arrive: () => {
      seen += 1;
      if (seen >= count) { clearTimeout(timer); open(); }
    },
    wait: () => gate,
  };
}

test('80 trang tài liệu KHÔNG xếp hàng sau các video đang trích (ADR 0007)', async () => {
  const docs = fromPicker(Array.from({ length: 80 }, (_, i) => picked(`/guide/t${i}`, `Trang ${i}`, 'Hướng dẫn')));
  const videos = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((id) => ({
    id, kind: 'video', title: `Video ${id}`, url: `https://www.youtube.com/watch?v=${id}`,
  }));

  const gate = afterDocs(80);
  const { deps } = fakeDeps({
    // Video chỉ trích xong **sau khi** cả 80 trang đã xong. Chạy tuần tự thì không bao giờ tới.
    extractVideo: async (item) => {
      await gate.wait();
      return { meta: { videoId: item.id, title: item.title }, segments: [{ start: 0, text: 'x' }] };
    },
    extractDoc: async (item) => { gate.arrive(); return fakePage(item); },
  });

  const log = await run([...videos, ...docs], { deps });
  assert.equal(log.summary.imported, 83, E.formatSummary(log));

  // Đo bằng chính nhật ký chạy: mọi lần trích tài liệu kết thúc TRƯỚC lần trích video đầu tiên.
  const ends = log.trace.filter((t) => t.stage === 'extract' && t.event === 'end');
  const firstVideoEnd = ends.findIndex((t) => t.queue === E.VIDEO_QUEUE);
  const docsBefore = ends.slice(0, firstVideoEnd).filter((t) => t.queue === E.DOCS_QUEUE).length;
  assert.equal(docsBefore, 80, `chỉ ${docsBefore}/80 trang trích xong trước video đầu tiên`);

  // Và nhãn hàng đợi trong nhật ký phải đúng loại: hoán vị hai nhãn ấy vẫn cho một nhật ký đọc
  // trôi chảy, chỉ là nó nói về hàng đợi kia.
  const queueOf = (id) => log.trace.find((t) => t.stage === 'extract' && t.id === id).queue;
  assert.equal(queueOf(videos[0].id), E.VIDEO_QUEUE);
  assert.equal(queueOf(docs[0].id), E.DOCS_QUEUE);
});

test('khâu đẩy vẫn độc quyền dù hai hàng cùng chạy — NotebookLM chỉ có một hộp thoại', async () => {
  const docs = fromPicker(branchOf40().slice(0, 5));
  const videos = ['aaaaaaaaaaa', 'bbbbbbbbbbb'].map((id) => ({
    id, kind: 'video', title: `Video ${id}`, url: `https://www.youtube.com/watch?v=${id}`,
  }));

  let live = 0;
  let most = 0;
  const { deps } = fakeDeps({
    pushSource: async () => {
      live += 1;
      most = Math.max(most, live);
      await new Promise((resolve) => setTimeout(resolve, 2));
      live -= 1;
    },
  });

  const log = await run([...videos, ...docs], { deps });
  assert.equal(most, 1, 'hai lần đẩy chồng nhau');
  assert.equal(log.summary.imported, 7, E.formatSummary(log));
});

// ------------------------------------------------------------------ câu nói ra

test('bảng tổng kết — trang phải mở tab ẩn được kể tên, kèm đúng câu giải thích của nó', async () => {
  // Một Nguồn mỏng vì trang render bằng JS trông y hệt một Nguồn mỏng vì trang mỏng thật. Câu
  // giải thích của `fetchDocPage` là thứ phân biệt, nên nó phải đi được tới bảng tổng kết.
  const { deps } = fakeDeps({
    extractDoc: async (item) => fakePage(item, item.title === 'Trang 1'
      ? { via: 'tab', escalated: true, note: 'nấc 1 chỉ đọc được 12 ký tự, dưới ngưỡng 600 — mở tab ẩn.' }
      : {}),
  });
  const log = await run(fromPicker(branchOf40().slice(0, 3)), { deps });

  assert.equal(log.docNotes.length, 1);
  assert.equal(log.docNotes[0].id, S.docPageId(`${SITE}/guide/trang-1`));
  const said = Q.formatDocNotes(log);
  assert.match(said, /Phải mở tab ẩn: 1 trang/);
  assert.match(said, /nấc 1 chỉ đọc được 12 ký tự/);
});

test('bảng tổng kết — trang tab ẩn CỨU được và trang tab ẩn HỎNG không nằm chung một dòng', async () => {
  // `escalated` và `via` là hai câu trả lời khác nhau: "đã phải leo nấc 2" và "leo có tới nơi
  // không". `fetchDocPage` trả `escalated: true, via: 'fetch'` cho trang mà nấc 2 hỏng và Nguồn
  // đang mang lại đúng phần nội dung mỏng của nấc 1. Đếm cả hai dưới tiêu đề "Phải mở tab ẩn"
  // vẫn ra một bảng đọc trôi chảy, và nó nói ngược hẳn: người dùng đọc thành "ngần ấy trang đã
  // được cứu", trong khi ngần ấy trang chính là những trang KHÔNG cứu được.
  const { deps } = fakeDeps({
    extractDoc: async (item) => fakePage(item, item.title === 'Trang 1'
      ? { via: 'tab', escalated: true, note: 'nấc 1 chỉ đọc được 12 ký tự, dưới ngưỡng 600 — mở tab ẩn; nấc 2 đọc được 900 ký tự.' }
      : { via: 'fetch', escalated: true, note: 'nấc 1 chỉ đọc được 12 ký tự, dưới ngưỡng 600, và nấc 2 không chốt được (tab ẩn đã đóng)' }),
  });
  const log = await run(fromPicker(branchOf40().slice(0, 3)), { deps });
  assert.equal(log.docNotes.length, 3, 'cả ba trang đều đã leo nấc 2');

  const said = Q.formatDocNotes(log);
  assert.match(said, /Phải mở tab ẩn: 1 trang/);
  assert.match(said, /Nấc 2 không chốt được[^\n]*: 2 trang/);
  assert.equal(/Phải mở tab ẩn: 3 trang/.test(said), false, `gộp cả ba vào một dòng:\n${said}`);
  // Câu giải thích của từng trang vẫn đi kèm — tách dòng không được làm mất chúng.
  assert.match(said, /tab ẩn đã đóng/);
});

test('bảng tổng kết — không trang nào phải mở tab ẩn thì không thêm dòng nào', () => {
  assert.equal(Q.formatDocNotes({ docNotes: [] }), '');
  assert.equal(Q.formatDocNotes({}), '');
});

test('nhánh không có tên vẫn ra MỘT Nguồn, không làm cả lần chạy ném ra giữa chừng', async () => {
  // `bundleName` từ chối tên Nhánh rỗng, và nó bị gọi lúc **chốt** — tức sau khi vài Nguồn đã
  // đẩy đi. Một sidebar có mục nhóm không chữ là chuyện có thật, nên chỗ nối phải đặt sẵn tên.
  const log = await run(fromPicker([
    { url: `${SITE}/guide/a`, title: 'A', branch: '' },
    { url: `${SITE}/guide/b`, title: 'B', branch: '' },
  ]));
  assert.equal(log.sources.length, 1);
  assert.equal(log.sources[0].name, `docs.acme.dev — ${Q.UNNAMED_BRANCH}`);
});

// ---------------------------------------- Bảng chọn thật → hàng đợi (không chỉ hình dạng payload)

/** Sidebar thật: một nhánh "Hướng dẫn" 40 trang, cạnh một nhánh khác để ranh giới có ý nghĩa. */
function sidebarOf40() {
  const link = (href, text) => el('a', { href }, [text]);
  const item = (href, text) => el('li', {}, [link(href, text)]);
  return el('body', {}, [
    el('aside', { class: 'sidebar' }, [el('nav', {}, [el('ul', {}, [
      el('li', {}, [
        link('/guide/', 'Hướng dẫn'),
        el('ul', {}, Array.from({ length: 40 }, (_, i) => item(`/guide/trang-${i}`, `Trang ${i}`))),
      ]),
      // Sáu mục anh em: đủ để lượt thu hẹp của `findSidebar` không tụt hẳn vào `<ul>` con và
      // vứt mất chính mục cha — nhánh cần một mục cha thì mới là một nhánh.
      ...Array.from({ length: 6 }, (_, i) => item(`/api/cli-${i}`, `CLI ${i}`)),
    ])])]),
    el('main', { class: 'content' }, [el('h1', {}, ['Cài đặt'])]),
  ]);
}

test('đi hết đường — tick một nhánh 40 trang trong Bảng chọn THẬT rồi chạy: đúng một Nguồn', async () => {
  // Hai đầu của cùng một mối nối: `selection()` khai `branch`, `itemsFromPicker` đọc `branch`.
  // Đổi tên trường ở một đầu vẫn để cả hai file tự nó xanh — chỗ duy nhất thấy được là ở đây,
  // và triệu chứng là 41 Nguồn thay vì 2.
  const page = sidebarOf40();
  const controller = K.createController({
    doc: {
      body: page,
      createElement: (tag) => (tag === 'input' ? input(tag) : el(tag)),
      querySelector: (selector) => page.querySelector(selector),
      querySelectorAll: (selector) => page.querySelectorAll(selector),
    },
    root: page,
    host: page,
    page: PAGE,
    options: {
      metrics: {
        viewport: () => 1200,
        width: (node) => (node.matches('.sidebar, nav, ul') ? 260 : (node.matches('.content') ? 900 : 0)),
      },
    },
  });
  controller.open();
  controller.toggle(controller.state().nodes[0].id);

  const items = Q.itemsFromPicker({ page: PAGE, pages: controller.selection() });
  assert.equal(items.length, 41, 'mục nhóm "Hướng dẫn" cũng là một trang import được');
  assert.equal(new Set(items.map((i) => E.groupKey(i.group))).size, 1, 'cả nhánh phải là MỘT bó');

  const log = await run(items);
  assert.equal(log.sources.length, 1, `41 trang ra ${log.sources.length} Nguồn`);
  assert.equal(log.sources[0].name, 'docs.acme.dev — Hướng dẫn');
});
