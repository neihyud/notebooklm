// Phần **phán quyết** của hai script kiểm chứng trên trang thật (ticket 012).
//
// Vì sao nó là một file riêng, không nằm trong `verify-docs.mjs`: phần lái trình duyệt chỉ chạy
// được khi có Chrome và có mạng, nên nếu tiêu chí nằm chung với nó thì tiêu chí không bao giờ có
// test. Mà một tiêu chí viết hụt cho ra "ĐẠT" trên mọi trang, và cả lượt chạy thật thành một tờ
// giấy chứng nhận rỗng — đúng thứ ticket 016 phải đi sửa cho cây giả. Ở đây: đo trong trình
// duyệt, phán quyết trong Node, và phán quyết có `test/live-checks.test.js` canh.
//
// Mọi tiêu chí trong file này đều so **hai con số cùng kiểu**: ký tự trong DOM ↔ ký tự trong
// Markdown, dòng code hiện trên màn hình ↔ dòng trong khối fence, segment đường DOM ↔ đường
// InnerTube. Hoán vị hai vế của bất kỳ cặp nào cũng cho một báo cáo đọc trôi chảy và sai —
// `WORKSPACE_PROTOCOL.md` v7 gọi đó là hình "hai con số cùng kiểu, mỗi số một vai trò".
//
// Không import gì ngoài chuẩn Node: repo cố ý không có dependency nào.

/** Bảy tiêu chí của Acceptance ticket 012, theo đúng thứ tự chúng được ghi ở đó. */
export const DOC_CHECK_IDS = Object.freeze([
  'sidebar-found',
  'sidebar-links-clean',
  'main-block-picked',
  'content-kept',
  'headings-kept',
  'code-not-collapsed',
  'sidebar-labels-out-of-body',
]);

/**
 * Markdown phải giữ được ngần này phần nội dung của thân bài — **cùng một ngưỡng cho cả ký tự
 * lẫn số dòng code**, vì cả hai đo cùng một chuyện: bao nhiêu phần của trang đi được vào Nguồn.
 *
 * Cố ý dùng chung một hằng số thay vì hai: hai tỉ lệ cùng đơn vị đứng cạnh nhau là đúng hình
 * "hai con số cùng kiểu, mỗi số một vai trò" mà `WORKSPACE_PROTOCOL.md` v7 bắt phải trả lời
 * "test nào chết khi hoán vị?" — và với hai tỉ lệ 0,85 / 0,80 thì câu trả lời trung thực là
 * *không test nào*, trừ khi khoá cứng con số. Một hằng số thì không có gì để hoán vị.
 *
 * Không liên quan tới `KEEP_RATIO` của `src/docs/extract.js`: đó là ngưỡng chọn thân bài bên
 * trong sản phẩm, đây là ngưỡng chấm điểm của công cụ kiểm chứng.
 *
 * Là **tỉ lệ**, không phải một số tuyệt đối: một trang 200 chữ và một trang 20.000 chữ mất 15%
 * là hai chuyện khác nhau về độ lớn nhưng cùng một chuyện về mức độ nghiêm trọng. Chiều so cũng
 * quan trọng bằng con số — Markdown *dài hơn* thân bài là bình thường (dấu `#`, dấu fence,
 * xuống dòng), chỉ chiều ngược lại mới là Nguồn bị xén.
 */
export const CONTENT_KEEP_RATIO = 0.85;

/**
 * Từ ngần này dòng liên tiếp trở lên, mỗi dòng đúng bằng một mục sidebar, thì đó là sidebar đã
 * rớt vào thân bài chứ không phải bài viết đang nhắc tên vài mục. Một hai dòng lẻ thì trang docs
 * nào cũng có: "xem thêm Cài đặt".
 */
export const LABEL_RUN_LIMIT = 3;

/** Số segment hai đường được phép lệch nhau, tính theo tỉ lệ trên đường dài hơn. */
export const COUNT_TOLERANCE = 0.05;

/** Phần chữ phải trùng nhau thì mới gọi hai đường là nói về cùng một video. */
export const OVERLAP_MIN = 0.8;

const text = (value) => (value == null ? '' : String(value));
const squash = (value) => text(value).replace(/\s+/g, ' ').trim();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// ------------------------------------------------------------------ đọc Markdown

/**
 * Tách Markdown thành dòng **ngoài** fence và số dòng **trong** mỗi fence.
 *
 * Một lượt quét cho cả hai, vì cả hai đều cần đúng một thứ: biết mình đang ở trong hay ngoài
 * fence. Đếm đề mục mà không biết điều đó thì `# đây là chú thích shell` trong một khối bash
 * thành một đề mục, và tiêu chí "giữ đề mục" tự cho mình điểm bằng chính rác nó phải bắt.
 *
 * Fence dài hơn chỉ đóng được bằng fence **ít nhất bằng nó**: ```` ```` ```` ôm được ``` ``` ```
 * bên trong, và tài liệu về Markdown thì đầy khối như vậy.
 */
function scanMarkdown(markdown) {
  const bodyLines = [];
  const fences = [];
  let openLen = 0;
  let inFence = 0;

  for (const line of text(markdown).split('\n')) {
    const ticks = line.match(/^\s*(`{3,})/);
    if (openLen === 0) {
      if (ticks) {
        openLen = ticks[1].length;
        inFence = 0;
      } else {
        bodyLines.push(line);
      }
      continue;
    }
    // Dòng đóng phải là fence **thuần** — `\`\`\`js` là mở một khối mới lồng vào, không phải đóng.
    if (ticks && ticks[1].length >= openLen && /^\s*`+\s*$/.test(line)) {
      fences.push(inFence);
      openLen = 0;
      continue;
    }
    // Chỉ đếm dòng **không rỗng** — cùng phép đếm với vế bên kia (`innerText` của `<pre>` trong
    // `tools/verify-docs.mjs`). Xem lý do đầy đủ ở đó: có theme chèn một dòng trống giữa mỗi
    // dòng code, nên đếm cả dòng trống là so một vế đã nhân đôi với một vế chưa.
    if (line.trim() !== '') inFence += 1;
  }
  // Fence mở mà không đóng: vẫn đếm phần đã có. Bỏ nó đi là im lặng giấu mất một khối code.
  if (openLen > 0) fences.push(inFence);

  return { bodyLines, fences };
}

/** Số dòng trong mỗi khối fence, theo thứ tự tài liệu. */
export function fenceLineCounts(markdown) {
  return scanMarkdown(markdown).fences;
}

/** Số đề mục `#`..`######` **ngoài** fence. */
export function headingCount(markdown) {
  return scanMarkdown(markdown).bodyLines.filter((line) => /^#{1,6}\s/.test(line)).length;
}

/**
 * Số ký tự chữ của Markdown: bỏ dấu `#` và dấu backtick, rồi **thu khoảng trắng về một dấu
 * cách** — đúng phép đếm của vế bên kia.
 *
 * Bỏ `#` và backtick vì chúng là *cú pháp*, không phải nội dung, mà `main.chars` đo bằng
 * `textContent` của DOM, nơi không có cú pháp Markdown nào.
 *
 * Nhưng khoảng trắng thì **giữ**, vì vế kia giữ: `main.chars` là `S.collapse(textContent).length`
 * — mỗi khe giữa hai từ còn lại một dấu cách. Xoá sạch khoảng trắng ở riêng vế Markdown là bớt
 * đi khoảng một phần sáu số ký tự của một trang chữ (từ tiếng Anh dài ~5 ký tự thì cứ 6 ký tự có
 * một dấu cách), tức ăn gần trọn dung sai 15% của `CONTENT_KEEP_RATIO`: một trang dựng Markdown
 * không mất chữ nào vẫn bị `content-kept` gọi là "Nguồn bị xén". Hai vế phải đếm cùng một cách
 * thì con số so mới có nghĩa.
 */
export function contentChars(markdown) {
  return squash(text(markdown).replace(/[#`]/g, '')).length;
}

/** Bóc dấu list và cú pháp link để còn lại đúng chữ người đọc thấy. */
function plainLine(line) {
  return squash(
    text(line)
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'),
  );
}

/**
 * Dãy dòng **liên tiếp** dài nhất trong thân bài mà mỗi dòng đúng bằng một mục sidebar.
 *
 * Hai đối số đều là "chữ của chính trang này" và cùng kiểu chuỗi, nên gọi nhầm thứ tự vẫn chạy
 * trót lọt và vẫn trả về một con số trông hợp lý — `test/live-checks.test.js` canh đúng chỗ đó.
 *
 * Đếm *dãy liên tiếp* chứ không đếm tổng số nhãn xuất hiện: một trang docs nhắc tên vài mục
 * trong câu văn là chuyện thường, còn cả cột điều hướng rớt vào thì nó rớt thành một khối.
 * Dòng trống không cắt dãy — danh sách Markdown thưa dòng vẫn là một danh sách.
 */
export function labelRunInBody(markdown, labels) {
  const wanted = new Set(
    (Array.isArray(labels) ? labels : [])
      .map((label) => squash(label).toLowerCase())
      .filter(Boolean),
  );
  if (wanted.size === 0) return 0;

  let run = 0;
  let longest = 0;
  for (const line of scanMarkdown(markdown).bodyLines) {
    const plain = plainLine(line);
    if (!plain) continue;
    run = wanted.has(plain.toLowerCase()) ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest;
}

// ------------------------------------------------------------------ bảy tiêu chí

/**
 * Một phép đo trên trang thật → bảy dòng phán quyết.
 *
 * `measure` là thứ script chạy **trong trình duyệt** trả về; mọi so sánh nằm ở đây, trong Node,
 * để chúng có test. Hình dạng:
 *
 *   {
 *     url,
 *     sidebar: { outcome, via, taken, total, anchors, labels[], stray: { anchor, foreign } },
 *     main:    { tag, fellBackToRoot, chars, headings },
 *     markdown: '…',
 *     codeRenderedLines: [n, …]   // số dòng mỗi <pre> **hiện ra trên màn hình** (innerText)
 *   }
 *
 * `codeRenderedLines` cố ý đo bằng `innerText` của trình duyệt chứ không bằng `codeLines()` của
 * chính extension: một phép kiểm dùng lại đúng hàm đang bị nghi ngờ thì không kiểm được gì.
 */
export function checkDocPage(measure) {
  const m = measure || {};
  const sidebar = m.sidebar || {};
  const main = m.main || {};
  const stray = sidebar.stray || {};
  const markdown = text(m.markdown);
  const rendered = Array.isArray(m.codeRenderedLines) ? m.codeRenderedLines.map(num) : [];
  const fences = fenceLineCounts(markdown);
  const mdChars = contentChars(markdown);
  const mdHeadings = headingCount(markdown);

  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  add('sidebar-found',
    sidebar.outcome === 'ok' && num(sidebar.taken) > 0,
    `outcome=${text(sidebar.outcome) || '(không có)'}, lối=${text(sidebar.via) || '(không có)'}, `
    + `lấy ${num(sidebar.taken)}/${num(sidebar.total)} link, ${num(sidebar.anchors)} neo trong trang`);

  const strayAnchor = num(stray.anchor);
  const strayForeign = num(stray.foreign);
  add('sidebar-links-clean',
    strayAnchor === 0 && strayForeign === 0,
    `lọt vào cây — neo trong trang: ${strayAnchor}, khác site: ${strayForeign}`);

  const wideTag = ['BODY', 'HTML'].includes(String(main.tag || '').toUpperCase());
  add('main-block-picked',
    !main.fellBackToRoot && !wideTag,
    main.fellBackToRoot
      ? `rơi về nhánh dự phòng: trả nguyên cây node được truyền vào (<${text(main.tag) || '?'}>)`
      : `chọn <${text(main.tag) || '?'}>${wideTag ? ' — rộng bằng cả trang, tức dính cả sidebar' : ''}`);

  const mainChars = num(main.chars);
  add('content-kept',
    mdChars >= mainChars * CONTENT_KEEP_RATIO,
    `Markdown giữ ${mdChars}/${mainChars} ký tự thân bài (ngưỡng ${CONTENT_KEEP_RATIO})`);

  const mainHeadings = num(main.headings);
  add('headings-kept',
    mainHeadings === 0 || mdHeadings >= mainHeadings,
    mainHeadings === 0
      ? 'thân bài không có đề mục nào — tiêu chí này không kết luận được ở trang này'
      : `Markdown có ${mdHeadings} đề mục, thân bài có ${mainHeadings}`);

  add('code-not-collapsed', ...codeVerdict(rendered, fences));

  const run = labelRunInBody(markdown, sidebar.labels);
  add('sidebar-labels-out-of-body',
    run < LABEL_RUN_LIMIT,
    `dãy dài nhất trong thân bài mà mỗi dòng là một mục sidebar: ${run} dòng (ngưỡng ${LABEL_RUN_LIMIT})`);

  return { url: text(m.url), ok: checks.every((c) => c.ok), checks };
}

/**
 * Khối code có giữ được số dòng của nó không.
 *
 * Hai vế đều là "số dòng của một khối code" nên hoán vị chúng vẫn ra một phán quyết hợp lệ —
 * và ra sai đúng chiều nguy hiểm: một khối 40 dòng dính thành 1 sẽ được gọi là đạt. Chiều đúng
 * là **màn hình nhiều dòng mà fence ít dòng** là hỏng; fence nhiều dòng hơn màn hình thì không
 * (Markdown thêm dòng trống là chuyện bình thường).
 *
 * Ngưỡng là tỉ lệ chứ không phải "≥ 2 dòng": một khối 7 dòng ra 2 dòng thì không "dính thành
 * một dòng" theo nghĩa đen, nhưng năm dòng code đã biến mất khỏi Nguồn — và đó đúng là hậu quả
 * mà tiêu chí này sinh ra để bắt.
 *
 * Số khối hai bên lệch nhau cũng là hỏng, không phải chuyện bỏ qua phần dư: một `<pre>` không
 * ra được khối fence nào là một khối code biến mất khỏi Nguồn.
 */
function codeVerdict(rendered, fences) {
  if (rendered.length === 0 && fences.length === 0) {
    return [true, 'trang không có khối code nào — tiêu chí này không kết luận được ở trang này'];
  }
  if (rendered.length !== fences.length) {
    return [false, `${rendered.length} khối trên trang nhưng ${fences.length} khối fence trong Markdown`];
  }
  const collapsed = [];
  for (let i = 0; i < rendered.length; i += 1) {
    if (rendered[i] < 2) continue;
    const need = Math.max(2, Math.ceil(rendered[i] * CONTENT_KEEP_RATIO));
    if (fences[i] < need) {
      collapsed.push(`khối #${i + 1}: ${rendered[i]} dòng trên trang → ${fences[i]} dòng trong fence (cần ≥ ${need})`);
    }
  }
  if (collapsed.length > 0) return [false, collapsed.join('; ')];
  const worst = rendered.reduce((acc, n, i) => (n > acc.n ? { n, f: fences[i] } : acc), { n: 0, f: 0 });
  return [true, `${rendered.length} khối; khối dài nhất ${worst.n} dòng trên trang → ${worst.f} dòng trong fence`];
}

// ------------------------------------------------------------------ transcript: hai đường

/**
 * Thống kê một danh sách segment.
 *
 * `ordered` là chỗ bắt cặp `start` ↔ `end` bị hoán vị — `WORKSPACE_PROTOCOL.md` liệt kê đúng cặp
 * này, và triệu chứng của nó là *không có triệu chứng*: file SRT vẫn parse được, vẫn mở lên xem
 * được, chỉ là mốc thời gian sai. Trên trang thật thì đây là phép kiểm duy nhất.
 *
 * "Không giảm" một mình **không đủ**, và ticket 017 trả giá cho chỗ đó: khi selector mốc lệch
 * tên lớp thì `parseClock('')` trả 0 cho mọi dòng, một danh sách 24 mốc 0 vẫn không giảm, và cả
 * hai video được báo "chạy tốt" trong khi mọi dòng nằm ở giây 0. Nên từ đây, nhiều segment mà
 * chỉ có **một** mốc phân biệt là ngược đầu — với một segment thì điều đó không nói lên gì.
 */
export function segmentStats(segments) {
  const list = Array.isArray(segments) ? segments : [];
  let ordered = list.length > 0;
  let previous = -Infinity;
  const starts = new Set();
  for (const seg of list) {
    const start = num(seg && seg.start);
    // `end` **vắng mặt** khác `end` bằng 0: đường DOM chỉ đọc được mốc bắt đầu và `srt.js` điền
    // `end` sau, nên đọc chỗ vắng thành 0 là báo ngược đầu ở mọi dòng của một lượt quét lành lặn.
    const end = seg && seg.end != null && Number.isFinite(Number(seg.end)) ? Number(seg.end) : null;
    if ((end !== null && end < start) || start < previous) ordered = false;
    starts.add(start);
    previous = start;
  }
  if (list.length > 1 && starts.size === 1) ordered = false;
  const first = list[0] || {};
  const last = list[list.length - 1] || {};
  return {
    count: list.length,
    ordered,
    distinctStarts: starts.size,
    firstStart: num(first.start),
    lastEnd: num(last.end),
    firstText: squash(first.text).slice(0, 80),
    lastText: squash(last.text).slice(0, 80),
  };
}

const textSet = (segments) => new Set(
  (Array.isArray(segments) ? segments : [])
    .map((seg) => squash(seg && seg.text).toLowerCase())
    .filter(Boolean),
);

/**
 * Hai đường trích transcript có nói về cùng một video không.
 *
 * Hai đối số cùng kiểu và hoán vị được: `countsMatch` và `overlap` đối xứng, nên một báo cáo
 * gọi nhầm tên đường vẫn hoàn toàn hợp lý — mà tên đường chính là thứ handback phải dán, và là
 * thứ nói `params` protobuf của `get_transcript` đúng hay sai.
 *
 * `agree` cố ý **không** chỉ nhìn số lượng: hai đường cùng trả về 240 segment vẫn có thể là
 * transcript của hai video khác nhau, và trên một SPA như YouTube thì đó không phải giả thuyết
 * xa vời (`WORKSPACE_PROTOCOL.md` v5).
 */
export function compareTranscripts(dom, innertube) {
  const a = segmentStats(dom);
  const b = segmentStats(innertube);
  const countsMatch = a.count > 0 && b.count > 0
    && Math.abs(a.count - b.count) <= Math.max(a.count, b.count) * COUNT_TOLERANCE;

  const left = textSet(dom);
  const right = textSet(innertube);
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  const overlap = Math.max(left.size, right.size) > 0 ? shared / Math.max(left.size, right.size) : 0;

  return {
    dom: a,
    innertube: b,
    countsMatch,
    overlap,
    agree: countsMatch && overlap >= OVERLAP_MIN && a.ordered && b.ordered,
  };
}

// ------------------------------------------------------------------ phán quyết về params

/** base64url (`-`/`_`, đệm `=` có thể vắng) → byte. `null` khi chuỗi không giải mã được. */
function decodeParams(value) {
  const raw = String(value == null ? '' : value).replace(/-/g, '+').replace(/_/g, '/');
  if (!raw || /[^A-Za-z0-9+/=]/.test(raw)) return null;
  try {
    return Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
}

/**
 * `params` của sản phẩm so với chuỗi YouTube tự đúc.
 *
 * Ba kết cục khác nhau về hành động, nên chúng được gọi tên riêng chứ không gộp thành đúng/sai:
 * giống hệt thì không phải sửa gì; là **tiền tố** thì trường `videoId` đã mã hoá đúng mà thiếu
 * những trường sau — một lỗi hẹp, sửa được; khác từ đầu thì cả cách mã hoá sai.
 */
export function compareParams(productParams, mintedParams) {
  if (!mintedParams) return { verdict: 'không-đối-chiếu-được', note: 'không lấy được chuỗi params thật từ /next' };
  // Vế sản phẩm rỗng nghĩa là `viaInnertube` ném **trước** khi gửi request (thiếu `apiKey` chẳng
  // hạn), nên `transcriptParams()` chưa lần nào chạy trong lượt này. Để nó rơi xuống nhánh cuối
  // là báo "cách mã hoá sai từ đầu" về một hàm không có mặt — đúng chiều nguy hiểm nhất, vì nó
  // đẩy người sửa đi viết lại một bộ mã hoá thay vì đi tìm lý do request không được gửi.
  if (!productParams) {
    return {
      verdict: 'không-đối-chiếu-được',
      note: 'sản phẩm không gửi request nào nên không có chuỗi params để đối chiếu — xem lỗi của đường InnerTube ở trên',
    };
  }
  if (productParams === mintedParams) return { verdict: 'giống-hệt', note: 'chuỗi sản phẩm đúc ra bằng đúng chuỗi YouTube dùng' };

  // So trên **byte đã giải mã**, không trên chữ base64. `CgtqTlFYQUM5SVZSdw==` (13 byte) và
  // `CgtqTlFYQUM5SVZSdxIO…` mang đúng 13 byte đầu giống nhau, nhưng ở dạng base64 thì ký tự thứ
  // 18 đã khác (`dw` ↔ `dx`) vì 13 không chia hết cho 3 — nhóm base64 cuối của chuỗi ngắn gộp
  // thêm bit đệm. So bằng chuỗi là gọi một quan hệ tiền tố hoàn hảo thành "khác hẳn", tức đẩy
  // người sửa đi viết lại một hàm mã hoá vốn đang đúng.
  const bytes = decodeParams(productParams);
  const mintedBytes = decodeParams(mintedParams);
  if (bytes && mintedBytes && mintedBytes.length > bytes.length
      && mintedBytes.subarray(0, bytes.length).equals(bytes)) {
    return {
      verdict: 'thiếu-trường',
      note: `chuỗi sản phẩm là TIỀN TỐ của chuỗi thật ở mức byte — ${bytes.length} byte đầu giống hệt `
        + `(trường videoId mã hoá đúng), thiếu ${mintedBytes.length - bytes.length} byte protobuf phía sau`,
    };
  }
  return { verdict: 'khác-hẳn', note: 'chuỗi sản phẩm không phải tiền tố của chuỗi thật — cách mã hoá sai từ đầu' };
}
