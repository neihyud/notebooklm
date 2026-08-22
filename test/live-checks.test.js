// `tools/live-checks.mjs` là phần **phán quyết** của hai script kiểm chứng trên trang thật
// (ticket 012). Nó tách khỏi phần lái trình duyệt vì đúng một lý do: một tiêu chí viết hụt cho
// ra "ĐẠT" trên mọi trang, và cả lượt chạy thật trở thành tờ giấy chứng nhận rỗng — đúng thứ
// ticket 016 đã phải đi sửa cho cây giả.
//
// Mọi tiêu chí ở đây đều so **hai con số cùng kiểu**: ký tự trong DOM ↔ ký tự trong Markdown,
// dòng code hiện trên màn hình ↔ dòng trong khối fence, số segment đường DOM ↔ đường InnerTube.
// Đó là đúng hình "hai con số cùng kiểu, mỗi số một vai trò" của `WORKSPACE_PROTOCOL.md` v7,
// nên mỗi tiêu chí có một test hoán vị hai vế và đòi kết quả phải đổi.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTENT_KEEP_RATIO,
  compareParams,
  contentChars,
  DOC_CHECK_IDS,
  checkDocPage,
  fenceLineCounts,
  labelRunInBody,
  segmentStats,
  compareTranscripts,
} from '../tools/live-checks.mjs';

// Một phép đo "trang lành lặn": mọi tiêu chí đạt. Các test dưới sửa đúng một trường rồi đòi
// đúng một tiêu chí đổi — nếu fixture nền đã có tiêu chí nào đỏ sẵn thì không phân biệt được.
const healthy = () => ({
  url: 'https://example.test/docs/intro',
  sidebar: {
    outcome: 'ok',
    via: 'lists',
    taken: 12,
    total: 12,
    anchors: 0,
    labels: ['Giới thiệu', 'Cài đặt', 'Cấu hình', 'Bảng chọn'],
    stray: { anchor: 0, foreign: 0 },
  },
  main: { tag: 'DIV', fellBackToRoot: false, chars: 1000, headings: 3 },
  markdown: [
    '# Giới thiệu',
    '',
    'x'.repeat(900),
    '',
    '## Cài đặt',
    '',
    '```bash',
    'npm install',
    'npm run build',
    '```',
    '',
    '### Cấu hình',
    '',
    'y'.repeat(90),
  ].join('\n'),
  codeRenderedLines: [2],
});

const verdict = (measure, id) => {
  const row = checkDocPage(measure).checks.find((c) => c.id === id);
  assert.ok(row, `không có tiêu chí "${id}" trong báo cáo`);
  return row.ok;
};

// ------------------------------------------------------------------ khung báo cáo

test('checkDocPage — báo cáo đủ bảy tiêu chí của Acceptance, đúng id, không thiếu không thừa', () => {
  const report = checkDocPage(healthy());
  assert.deepEqual(report.checks.map((c) => c.id), [...DOC_CHECK_IDS]);
  assert.equal(report.url, 'https://example.test/docs/intro');
  assert.equal(report.ok, true, 'fixture nền phải xanh hết, nếu không mọi test dưới đây vô nghĩa');
});

test('checkDocPage — một tiêu chí đỏ kéo cả trang thành đỏ; ok của trang không được là "đa số"', () => {
  const m = healthy();
  m.sidebar.outcome = 'none';
  const report = checkDocPage(m);
  assert.equal(report.ok, false);
  assert.equal(report.checks.filter((c) => !c.ok).length, 1, 'chỉ đúng một tiêu chí được đỏ');
});

test('checkDocPage — mỗi dòng mang detail của chính tiêu chí đó, không phải của tiêu chí bên cạnh', () => {
  // Hai tiêu chí cùng đỏ, mỗi cái vì một con số khác nhau. Nếu `detail` bị gán lệch một dòng
  // thì bảng vẫn đủ bảy dòng, vẫn đúng số đỏ, chỉ là mỗi câu giải thích đứng nhầm chỗ — và
  // người đọc handback sẽ đi sửa nhầm chỗ theo.
  const m = healthy();
  m.main.chars = 100000;      // content-kept đỏ, nhắc tới 100000
  m.codeRenderedLines = [7];  // code-not-collapsed đỏ, nhắc tới 7
  const by = new Map(checkDocPage(m).checks.map((c) => [c.id, c.detail]));
  assert.match(by.get('content-kept'), /100000/);
  assert.doesNotMatch(by.get('content-kept'), /(^|\D)7(\D|$)/);
  assert.match(by.get('code-not-collapsed'), /(^|\D)7(\D|$)/);
  assert.doesNotMatch(by.get('code-not-collapsed'), /100000/);
});

// ------------------------------------------------------------------ dò ra sidebar

test('sidebar-found — chỉ `ok` kèm mục lấy được mới là đạt', () => {
  assert.equal(verdict(healthy(), 'sidebar-found'), true);

  const none = healthy();
  none.sidebar.outcome = 'none';
  assert.equal(verdict(none, 'sidebar-found'), false);

  const anchorsOnly = healthy();
  anchorsOnly.sidebar.outcome = 'anchors-only';
  assert.equal(verdict(anchorsOnly, 'sidebar-found'), false);

  // Đây là ca hiểm: `outcome` nói ok mà cây rỗng. Bảng chọn mở ra trắng trơn.
  const empty = healthy();
  empty.sidebar.taken = 0;
  assert.equal(verdict(empty, 'sidebar-found'), false);
});

// ------------------------------------------------------------------ link lọt vào Bảng chọn

test('sidebar-links-clean — một neo trong trang hay một link khác site lọt vào là đỏ', () => {
  assert.equal(verdict(healthy(), 'sidebar-links-clean'), true);

  const anchor = healthy();
  anchor.sidebar.stray.anchor = 1;
  assert.equal(verdict(anchor, 'sidebar-links-clean'), false);

  const foreign = healthy();
  foreign.sidebar.stray.foreign = 1;
  assert.equal(verdict(foreign, 'sidebar-links-clean'), false);
});

test('sidebar-links-clean — hai loại lọt là hai con số cùng kiểu; câu giải thích phải gọi đúng tên', () => {
  // Hoán vị `anchor` ↔ `foreign` giữ nguyên tổng, nên một tiêu chí chỉ cộng hai số vẫn đỏ y hệt
  // và người đọc đi tìm nhầm loại link.
  const m = healthy();
  m.sidebar.stray = { anchor: 3, foreign: 1 };
  const detail = checkDocPage(m).checks.find((c) => c.id === 'sidebar-links-clean').detail;

  const swapped = healthy();
  swapped.sidebar.stray = { anchor: 1, foreign: 3 };
  const other = checkDocPage(swapped).checks.find((c) => c.id === 'sidebar-links-clean').detail;

  assert.notEqual(detail, other, 'hoán vị hai loại link phải cho hai câu khác nhau');
  assert.match(detail, /neo trong trang: 3/);
  assert.match(detail, /khác site: 1/);
});

// ------------------------------------------------------------------ thân bài

test('main-block-picked — rơi về nhánh dự phòng, hoặc dừng ở body/html, đều là đỏ', () => {
  assert.equal(verdict(healthy(), 'main-block-picked'), true);

  const fallback = healthy();
  fallback.main.fellBackToRoot = true;
  assert.equal(verdict(fallback, 'main-block-picked'), false);

  for (const tag of ['BODY', 'HTML']) {
    const wide = healthy();
    wide.main.tag = tag;
    assert.equal(verdict(wide, 'main-block-picked'), false, `dừng ở <${tag}> là dính cả sidebar`);
  }
});

// ------------------------------------------------------------------ nuốt nội dung

test('content-kept — so ký tự Markdown với ký tự thân bài, và ĐÚNG chiều đó', () => {
  const m = healthy();
  assert.equal(verdict(m, 'content-kept'), true);

  // Hoán vị hai vế: thân bài 100 ký tự, Markdown ~1000. Một phép so viết ngược chiều vẫn "đạt"
  // ở fixture lành lặn, nên chỉ ca lệch mạnh này phân biệt được — và nó phải vẫn ĐẠT (Markdown
  // dài hơn thân bài là chuyện bình thường: dấu `#`, dấu fence, xuống dòng).
  const richer = healthy();
  richer.main.chars = 100;
  assert.equal(verdict(richer, 'content-kept'), true);

  // Chiều thật sự nguy hiểm: thân bài dày mà Markdown mỏng — Nguồn bị xén.
  const swallowed = healthy();
  swallowed.main.chars = 100000;
  assert.equal(verdict(swallowed, 'content-kept'), false);
});

test('content-kept — một trang chữ dựng Markdown không sót chữ nào phải ĐẠT', () => {
  // Hai vế phải đếm ký tự **cùng một cách**. Vế thân bài là `S.collapse(textContent)`, tức mỗi
  // khe giữa hai từ còn một dấu cách; nếu vế Markdown xoá sạch khoảng trắng thì một trang chữ
  // tiếng Việt (~19% ký tự là dấu cách ở đoạn dưới) tự động rơi xuống dưới ngưỡng 0,85 mà không
  // mất một chữ nào. Đây là trang lành lặn nhất có thể — nó mà đỏ thì tiêu chí này vô dụng.
  const prose = Array.from({ length: 40 }, () => 'Trang này không mất chữ nào cả.').join(' ');
  const m = healthy();
  m.markdown = `# Tiêu đề\n\n${prose}`;
  m.main.headings = 1;
  m.main.chars = `Tiêu đề ${prose}`.length;   // đúng thứ `S.collapse(textContent)` cho ra
  m.codeRenderedLines = [];
  assert.equal(verdict(m, 'content-kept'), true);
});

test('content-kept — ngưỡng là tỉ lệ, không phải một hằng số ký tự', () => {
  const m = healthy();
  const body = contentChars(m.markdown);
  m.main.chars = Math.floor(body / CONTENT_KEEP_RATIO) - 5;
  assert.equal(verdict(m, 'content-kept'), true, 'ngay trên ngưỡng phải đạt');
  m.main.chars = Math.ceil(body / CONTENT_KEEP_RATIO) + 5;
  assert.equal(verdict(m, 'content-kept'), false, 'ngay dưới ngưỡng phải đỏ');
});

// ------------------------------------------------------------------ đề mục

test('headings-kept — đếm đề mục trong Markdown, so với đề mục có thật trong thân bài', () => {
  assert.equal(verdict(healthy(), 'headings-kept'), true);

  const lost = healthy();
  lost.main.headings = 9;
  assert.equal(verdict(lost, 'headings-kept'), false, 'thân bài 9 đề mục mà Markdown còn 3 là mất');

  // Hoán vị hai vế: Markdown nhiều đề mục hơn thân bài vẫn phải ĐẠT — thừa không phải là mất.
  const extra = healthy();
  extra.main.headings = 1;
  assert.equal(verdict(extra, 'headings-kept'), true);
});

test('headings-kept — thân bài không có đề mục nào thì tiêu chí này không kết luận được', () => {
  const m = healthy();
  m.main.headings = 0;
  const row = checkDocPage(m).checks.find((c) => c.id === 'headings-kept');
  assert.equal(row.ok, true);
  assert.match(row.detail, /không có đề mục/, 'phải nói ra là không kiểm được, đừng im lặng cho qua');
});

test('headings-kept — dòng ``` không được đếm nhầm thành đề mục, và `#` trong code cũng vậy', () => {
  const m = healthy();
  m.main.headings = 3;
  m.markdown = [
    '# Một',
    '## Hai',
    '### Ba',
    '```sh',
    '# đây là chú thích shell, không phải đề mục',
    '#!/usr/bin/env bash',
    '```',
  ].join('\n');
  assert.equal(verdict(m, 'headings-kept'), true);

  const fake = healthy();
  fake.main.headings = 3;
  fake.markdown = ['```sh', '# một', '## hai', '### ba', '```'].join('\n');
  assert.equal(verdict(fake, 'headings-kept'), false, 'ba dòng đó nằm trong fence, không phải đề mục');
});

// ------------------------------------------------------------------ khối code

test('fenceLineCounts — đếm số dòng trong mỗi khối fence, theo thứ tự tài liệu', () => {
  const md = ['# A', '```js', 'a', 'b', 'c', '```', 'chữ', '```', 'x', '```'].join('\n');
  assert.deepEqual(fenceLineCounts(md), [3, 1]);
});

test('fenceLineCounts — dòng trống trong fence không được đếm', () => {
  // Cùng phép đếm với vế bên kia (`innerText` của `<pre>` trong `tools/verify-docs.mjs`): có
  // theme chèn một dòng trống giữa mỗi dòng code, nên đếm cả dòng trống là so một vế đã nhân
  // đôi với một vế chưa — và mọi khối code của mọi trang MkDocs bị báo là nuốt mất một nửa.
  assert.deepEqual(fenceLineCounts(['```js', 'a', '', 'b', '', 'c', '```'].join('\n')), [3]);
});

test('fenceLineCounts — fence mở mà không đóng vẫn phải đếm được phần đã có', () => {
  assert.deepEqual(fenceLineCounts(['```js', 'a', 'b'].join('\n')), [2]);
});

test('fenceLineCounts — fence bốn dấu ôm được fence ba dấu bên trong, không tách làm hai', () => {
  const md = ['````md', '```js', 'a', '```', '````'].join('\n');
  assert.deepEqual(fenceLineCounts(md), [3]);
});

test('code-not-collapsed — khối 7 dòng trên màn hình mà ra 1 dòng fence là đỏ', () => {
  assert.equal(verdict(healthy(), 'code-not-collapsed'), true);

  const collapsed = healthy();
  collapsed.codeRenderedLines = [7];
  assert.equal(verdict(collapsed, 'code-not-collapsed'), false);
});

test('code-not-collapsed — hoán vị "dòng hiện ra" ↔ "dòng trong fence" phải đổi kết quả', () => {
  // Đây là cặp cùng kiểu nguy hiểm nhất của tiêu chí này: cả hai đều là "số dòng của một khối
  // code". So ngược chiều thì một khối 40 dòng dính thành 1 vẫn được gọi là đạt, mà đó đúng là
  // triệu chứng phải bắt.
  const collapsed = healthy();
  collapsed.codeRenderedLines = [7];   // fence có 2 dòng → ĐỎ
  assert.equal(verdict(collapsed, 'code-not-collapsed'), false);

  const swapped = healthy();
  swapped.codeRenderedLines = [1];     // fence có 2 dòng, màn hình 1 → vẫn ĐẠT
  assert.equal(verdict(swapped, 'code-not-collapsed'), true,
    'fence nhiều dòng hơn màn hình không phải lỗi — chỉ chiều ngược lại mới là');
});

test('code-not-collapsed — ngưỡng là tỉ lệ dòng giữ lại, không phải "nhiều hơn một dòng"', () => {
  // Một khối 7 dòng ra 2 dòng không "dính thành một dòng" theo nghĩa đen, nhưng năm dòng code
  // đã biến mất khỏi Nguồn. Tiêu chí sinh ra để bắt hậu quả đó, không phải để bắt con số 1.
  const fence = (n) => ['```js', ...Array.from({ length: n }, (_, i) => `dòng ${i + 1}`), '```'].join('\n');

  const kept = healthy();
  kept.codeRenderedLines = [7];
  kept.markdown = fence(6);
  assert.equal(verdict(kept, 'code-not-collapsed'), true, '7 dòng ra 6 dòng là tròn trong dung sai');

  const lost = healthy();
  lost.codeRenderedLines = [7];
  lost.markdown = fence(5);
  assert.equal(verdict(lost, 'code-not-collapsed'), false, '7 dòng ra 5 dòng là mất hai dòng code');
});

test('code-not-collapsed — số khối hai bên lệch nhau là đỏ, không phải bỏ qua phần dư', () => {
  const m = healthy();
  m.codeRenderedLines = [2, 5];
  const row = checkDocPage(m).checks.find((c) => c.id === 'code-not-collapsed');
  assert.equal(row.ok, false);
  assert.match(row.detail, /2 khối trên trang.*1 khối fence|1 khối fence.*2 khối trên trang/);
});

test('code-not-collapsed — trang không có khối code nào thì không kết luận được', () => {
  const m = healthy();
  m.codeRenderedLines = [];
  m.markdown = '# Chỉ có chữ\n\nkhông có code.';
  const row = checkDocPage(m).checks.find((c) => c.id === 'code-not-collapsed');
  assert.equal(row.ok, true);
  assert.match(row.detail, /không có khối code/);
});

// ------------------------------------------------------------------ nhãn sidebar rớt vào thân bài

test('labelRunInBody — dãy dòng liên tiếp dài nhất mà mỗi dòng là một nhãn sidebar', () => {
  const labels = ['Giới thiệu', 'Cài đặt', 'Cấu hình'];
  assert.equal(labelRunInBody('# Bài\n\nnội dung thật.', labels), 0);
  assert.equal(labelRunInBody('- Giới thiệu\n- Cài đặt\n- Cấu hình', labels), 3);
  // Một nhãn lẻ giữa bài không phải sidebar rớt vào — trang nào cũng có thể nhắc tên một mục.
  assert.equal(labelRunInBody('Xem thêm Cài đặt để biết chi tiết.\n\n- Cài đặt', labels), 1);
  // Dấu list và link Markdown đều phải bóc ra trước khi so.
  assert.equal(labelRunInBody('* [Giới thiệu](/a)\n* [Cài đặt](/b)', labels), 2);
});

test('labelRunInBody — hoán vị hai đối số phải cho kết quả khác', () => {
  // `labels` và thân bài đều là "chữ của trang này". Gọi nhầm thứ tự vẫn chạy trót lọt và vẫn
  // trả về một con số trông hợp lý.
  const labels = ['Giới thiệu', 'Cài đặt', 'Cấu hình'];
  const body = '- Giới thiệu\n- Cài đặt\n- Cấu hình';
  assert.equal(labelRunInBody(body, labels), 3);
  assert.equal(labelRunInBody(labels.join('\n'), [body]), 0);
});

test('sidebar-labels-out-of-body — ba nhãn liên tiếp trong thân bài là sidebar đã rớt vào', () => {
  assert.equal(verdict(healthy(), 'sidebar-labels-out-of-body'), true);

  const leaked = healthy();
  leaked.markdown = `${leaked.markdown}\n\n- Giới thiệu\n- Cài đặt\n- Cấu hình`;
  assert.equal(verdict(leaked, 'sidebar-labels-out-of-body'), false);

  const mention = healthy();
  mention.markdown = `${mention.markdown}\n\n- Cài đặt`;
  assert.equal(verdict(mention, 'sidebar-labels-out-of-body'), true,
    'nhắc tên một mục không phải là nuốt cả sidebar');
});

// ------------------------------------------------------------------ transcript: hai đường

test('segmentStats — đếm, đo khoảng, và bắt segment ngược đầu', () => {
  const good = [{ start: 0, end: 2, text: 'a' }, { start: 2, end: 5, text: 'b' }];
  const s = segmentStats(good);
  assert.equal(s.count, 2);
  assert.equal(s.ordered, true);
  assert.equal(s.firstStart, 0);
  assert.equal(s.lastEnd, 5);
});

test('segmentStats — hoán vị start ↔ end trong MỘT segment phải bị bắt', () => {
  // `WORKSPACE_PROTOCOL.md` liệt kê đúng cặp này: hoán vị vẫn ra SRT parse được, nên không có
  // triệu chứng nào ngoài phép kiểm này.
  const swapped = [{ start: 2, end: 0, text: 'a' }, { start: 2, end: 5, text: 'b' }];
  assert.equal(segmentStats(swapped).ordered, false);
});

test('segmentStats — mốc lùi về sau giữa hai segment cũng là ngược đầu', () => {
  const backwards = [{ start: 5, end: 7, text: 'a' }, { start: 0, end: 2, text: 'b' }];
  assert.equal(segmentStats(backwards).ordered, false);
});

test('segmentStats — segment đường DOM không có `end`, và thiếu `end` không phải là ngược đầu', () => {
  // `srt.js` điền `end` cho đường DOM ("đường DOM chỉ đọc được mốc bắt đầu"), nên đọc `end`
  // vắng mặt thành 0 là biến một lượt quét lành lặn thành báo động ngược đầu ở mọi dòng.
  const domLike = [{ start: 1, text: 'a' }, { start: 7, text: 'b' }, { start: 16, text: 'c' }];
  assert.equal(segmentStats(domLike).ordered, true);
});

test('segmentStats — có `end` thì vẫn phải lớn hơn `start`, thiếu `end` không nới lỏng chuyện đó', () => {
  assert.equal(segmentStats([{ start: 1, end: 0, text: 'a' }, { start: 7, text: 'b' }]).ordered, false);
});

test('segmentStats — 24 segment mà mọi mốc đều bằng nhau KHÔNG phải là "mốc tăng dần"', () => {
  // Đúng hình đã xảy ra trên trang thật (ticket 017): selector mốc lệch tên lớp nên
  // `parseClock('')` trả 0 cho mọi dòng. Transcript đủ dòng, đủ chữ, `ordered` vẫn true vì
  // không-giảm — và cả hai video được báo là "chạy tốt" trong khi mọi mốc nằm ở giây 0.
  const flat = Array.from({ length: 24 }, (_, i) => ({ start: 0, end: 0, text: `dòng ${i}` }));
  const stats = segmentStats(flat);

  assert.equal(stats.count, 24);
  assert.equal(stats.distinctStarts, 1);
  assert.equal(stats.ordered, false, 'mọi mốc bằng 0 vẫn được coi là mốc tăng dần');
});

test('segmentStats — một segment duy nhất thì mốc bằng nhau không nói lên điều gì', () => {
  assert.equal(segmentStats([{ start: 0, end: 3, text: 'a' }]).ordered, true);
});

test('compareTranscripts — giữ đúng đường nào là đường nào', () => {
  // Hai đường trả về cùng kiểu dữ liệu, nên hoán vị hai đối số vẫn ra một báo cáo hợp lệ: cùng
  // `countsMatch`, cùng `overlap`. Chỉ chỗ gán tên đường mới phân biệt được — và tên đường
  // chính là thứ handback phải dán.
  const dom = [{ start: 0, end: 1, text: 'xin chào' }, { start: 1, end: 2, text: 'các bạn' }];
  const inner = [{ start: 0, end: 1, text: 'xin chào' }];

  const a = compareTranscripts(dom, inner);
  assert.equal(a.dom.count, 2);
  assert.equal(a.api.count, 1);

  const b = compareTranscripts(inner, dom);
  assert.equal(b.dom.count, 1);
  assert.equal(b.api.count, 2);
  assert.equal(a.countsMatch, b.countsMatch, 'phép so số lượng thì đối xứng…');
  assert.notDeepEqual(a.dom, b.dom, '…nhưng nhãn đường thì không được đối xứng');
});

test('compareTranscripts — khớp khi cùng số segment và chữ trùng nhau', () => {
  const segs = [{ start: 0, end: 1, text: 'xin chào' }, { start: 1, end: 2, text: 'các bạn' }];
  const r = compareTranscripts(segs, segs.map((s) => ({ ...s })));
  assert.equal(r.countsMatch, true);
  assert.equal(r.overlap, 1);
  assert.equal(r.agree, true);
});

test('compareTranscripts — cùng số segment mà chữ khác hẳn thì KHÔNG khớp', () => {
  // Ca này là lý do `agree` không được chỉ nhìn số lượng: hai đường trả về đúng 2 segment mỗi
  // đường vẫn có thể là transcript của hai video khác nhau.
  const dom = [{ start: 0, end: 1, text: 'xin chào' }, { start: 1, end: 2, text: 'các bạn' }];
  const inner = [{ start: 0, end: 1, text: 'hello there' }, { start: 1, end: 2, text: 'everyone' }];
  const r = compareTranscripts(dom, inner);
  assert.equal(r.countsMatch, true);
  assert.equal(r.overlap, 0);
  assert.equal(r.agree, false);
});

test('compareTranscripts — một đường không chạy được thì nói rõ, đừng gọi là khớp', () => {
  const r = compareTranscripts([{ start: 0, end: 1, text: 'a' }], null);
  assert.equal(r.api.count, 0);
  assert.equal(r.agree, false);
});

// ------------------------------------------------------------------ params protobuf

// Hai chuỗi đo thật, ticket 012, video jNQXAC9IVRw. `SAN_PHAM` là thứ `transcriptParams()` của
// `src/youtube/transcript.js` đúc ra; `YOUTUBE` là thứ `/youtubei/v1/next` trả về trong
// `getTranscriptEndpoint.params` cho đúng video ấy.
const SAN_PHAM = 'CgtqTlFYQUM5SVZSdw==';
const YOUTUBE = 'CgtqTlFYQUM5SVZSdxIOQ2dBU0FtVnVHZ0ElM0QYASozZW5nYWdlbWVudC1wYW5lbC1zZWFyY2hhYmxlLXRyYW5zY3JpcHQtc2VhcmNoLXBhbmVsMAE4AUAB';

test('compareParams — tiền tố thì gọi là thiếu trường, không gọi là khác hẳn', () => {
  // Phân biệt này quyết định việc phải làm tiếp: "thiếu trường" nghĩa là phần videoId đã mã hoá
  // đúng từng byte và chỉ thiếu phần đuôi; "khác hẳn" nghĩa là phải viết lại cả cách mã hoá.
  const r = compareParams(SAN_PHAM, YOUTUBE);
  assert.equal(r.verdict, 'thiếu-trường');
  assert.match(r.note, /TIỀN TỐ/);
});

test('compareParams — hai chuỗi cùng kiểu, hoán vị hai vế phải đổi kết luận', () => {
  // Cả hai đều là "chuỗi params base64 của video này", nên gọi nhầm thứ tự vẫn ra một phán quyết
  // hợp lệ — và ra sai đúng chiều nguy hiểm: chuỗi sản phẩm thiếu trường sẽ được báo là "khác
  // hẳn", tức đẩy người sửa đi viết lại một hàm vốn đang mã hoá đúng.
  assert.equal(compareParams(SAN_PHAM, YOUTUBE).verdict, 'thiếu-trường');
  assert.equal(compareParams(YOUTUBE, SAN_PHAM).verdict, 'khác-hẳn');
});

test('compareParams — dấu `=` đệm base64 không được biến quan hệ tiền tố thành khác hẳn', () => {
  assert.equal(compareParams('CgtqTlFYQUM5SVZSdw==', 'CgtqTlFYQUM5SVZSdxIO').verdict, 'thiếu-trường');
});

test('compareParams — giống hệt, và không đối chiếu được, là hai kết cục khác nhau', () => {
  assert.equal(compareParams(SAN_PHAM, SAN_PHAM).verdict, 'giống-hệt');
  assert.equal(compareParams(SAN_PHAM, '').verdict, 'không-đối-chiếu-được');
});

test('compareParams — sản phẩm không gửi request nào KHÔNG phải là mã hoá sai', () => {
  // `viaInnertube` ném trước lúc gửi (thiếu `apiKey` chẳng hạn) thì `innertube.sent` là null và
  // `tools/verify-live.mjs` truyền vào chuỗi rỗng. Rơi xuống nhánh "khác hẳn" là kết tội một hàm
  // chưa hề chạy, và đẩy người sửa đi viết lại bộ mã hoá thay vì đi tìm lý do request không đi.
  const r = compareParams('', YOUTUBE);
  assert.equal(r.verdict, 'không-đối-chiếu-được');
  assert.doesNotMatch(r.note, /mã hoá/);
});

test('compareParams — hai vế rỗng là hai lý do khác nhau, câu giải thích phải phân biệt được', () => {
  // Cùng kiểu (chuỗi rỗng), cùng phán quyết, mỗi vế một vai: vế trái rỗng là sản phẩm không gửi
  // gì, vế phải rỗng là `/next` không trả về chuỗi thật. Hai việc phải làm tiếp khác hẳn nhau.
  const khongGui = compareParams('', YOUTUBE);
  const khongLayDuoc = compareParams(SAN_PHAM, '');
  assert.equal(khongGui.verdict, khongLayDuoc.verdict);
  assert.notEqual(khongGui.note, khongLayDuoc.note);
  assert.match(khongLayDuoc.note, /\/next/);
});

test('compareParams — mã hoá sai từ đầu thì phải gọi là khác hẳn', () => {
  assert.equal(compareParams('ZZZZZZZZ', YOUTUBE).verdict, 'khác-hẳn');
});
