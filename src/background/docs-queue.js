// Chỗ nối của ticket 010, phía tài liệu: một lượt tick trong Bảng chọn thành Mục hàng đợi, và
// một trang đã trích thành thân Nguồn.
//
// Đối xứng với `src/background/importer.js` của nhánh video, và cùng một lý do tồn tại: thứ chỉ
// xuất hiện khi ghép các mảnh lại thì phải có một chỗ để đặt, chứ không nằm rải trong service
// worker nơi không test được. Ở đây thứ đó là **ranh giới bó**.
//
// ADR 0005 nói cắt theo ranh giới Nhánh, và engine đã sẵn sàng làm việc ấy: `groupKey()` đưa
// Nhánh vào khoá bó, nên hai nhánh không bao giờ dính vào nhau. Nhưng engine chỉ biết những gì
// Mục hàng đợi khai — và Nhánh của một trang **không** đọc được từ chính trang đó. Nó là mục
// người dùng đã tick trong Bảng chọn, thứ chỉ có ở phía kia (`branchesOf` của
// `src/docs/sidebar.js`). Nếu chỗ này khai nhãn của chính trang làm Nhánh thì một nhánh 40
// trang ra 40 Nguồn — lần import vẫn chạy trót lọt từ đầu tới cuối, chỉ tiêu hết quota.
//
// File này không chạm `chrome.*` và không chạm DOM: lối ra duy nhất (trích một trang) là adapter
// được tiêm — `test/docs-import.test.js`.
(function (root) {
  'use strict';

  if (root.NBLM_DOCS_QUEUE) return;

  const S = root.NBLM_SHARED;
  const E = root.NBLM_ENGINE;
  if (!S) throw new Error('background/docs-queue: cần src/common/shared.js nạp trước');
  if (!E) throw new Error('background/docs-queue: cần src/background/queue-engine.js nạp trước');

  /**
   * Tên đặt cho Nhánh mà sidebar không cho chữ nào.
   *
   * Nhiều theme dựng tên nhóm bằng một `<span>` rỗng hoặc chỉ một icon, và `bundleName` từ chối
   * tên Nhánh rỗng — mà nó bị gọi lúc **chốt**, tức sau khi vài Nguồn đã đẩy đi và không xoá
   * được nữa (ADR 0010). Đặt sẵn một cái tên ở cửa vào rẻ hơn nhiều so với ném ra giữa vòng chạy.
   */
  const UNNAMED_BRANCH = 'Trang đã chọn';

  /**
   * Một lượt tick trong Bảng chọn thành danh sách Mục hàng đợi.
   *
   * `page` là URL của **trang đang mở Bảng chọn**: nó cho tên site, tức vế `<Site>` của tên Nguồn
   * `<Site> — <Nhánh>`. Lấy từ đây chứ không từ từng trang một, vì nó phải giống nhau cho cả
   * nhánh — hai tên site khác nhau là hai Nguồn khác nhau cho cùng một nhánh.
   *
   * `id` là **định danh trang** chứ không phải chuỗi href: đó là khoá của Sổ đã import (ADR 0006)
   * và của phép khử trùng lặp, nên `/guide/cai-dat` và `/guide/cai-dat/` phải ra một mục, không
   * phải hai.
   */
  function itemsFromPicker(payload) {
    const p = payload || {};
    const site = S.docSiteName(p.page);
    if (!site) throw new Error(`tài liệu: không đọc được trang đang mở Bảng chọn: ${String(p.page)}`);

    const items = [];
    for (const page of p.pages || []) {
      const url = S.collapse(page && page.url);
      const id = S.docPageId(url);
      if (!id) continue;
      items.push({
        id,
        kind: E.DOCS_QUEUE,
        url,
        title: S.collapse(page.title),
        // Nhánh nằm trong khoá bó — đây là toàn bộ cách "cắt theo ranh giới Nhánh" (ADR 0005).
        group: { kind: E.DOCS_QUEUE, source: site, branch: S.collapse(page.branch) || UNNAMED_BRANCH },
      });
    }
    return S.dedupe(items, (item) => item.id);
  }

  /**
   * Thân của một trang trong Nguồn gộp: header ngữ cảnh của riêng nó, rồi Markdown.
   *
   * Header cho từng trang chứ không cho cả Nguồn (ADR 0002): trích dẫn của NotebookLM chỉ tên
   * được cả Nguồn gộp, nên tiêu đề và link gốc của từng trang phải nằm ngay trong thân.
   *
   * Hai trường đi ngược chiều nhau, đúng bất biến mà `mergeMeta` học được ở ticket 005 — **nội
   * dung theo trang, danh tính theo Mục**:
   *
   *   - `title` lấy của trang: đó là thứ vừa đọc được thật, còn nhãn sidebar chỉ là thứ Bảng
   *     chọn đoán ra từ một chữ trong menu.
   *   - `url` lấy của Mục: nó là **địa chỉ để quay lại**, chỗ người dùng nhấn để kiểm chứng một
   *     trích dẫn. Lượt trích có thể đi qua redirect hay nâng `http` lên `https`, và cả hai URL
   *     đều mở được — nên hoán vị hai chuỗi này không lộ ra ở đâu cả.
   */
  function docBody(item, page) {
    const p = page || {};
    const header = S.contextHeader({ title: S.collapse(p.title) || S.collapse(item.title), url: item.url });
    const markdown = String(p.markdown || '');
    return header ? `${header}\n\n${markdown}` : markdown;
  }

  /**
   * Adapter trích của hàng đợi tài liệu: một Mục thành `{text, words}` cho engine.
   *
   * Trang trích ra rỗng bị ném ra ở đây thay vì đi tiếp thành một phần trắng trong Nguồn gộp —
   * engine bắt lỗi ấy và cho nó một dòng có tên tuổi trong bảng tổng kết (ADR 0008). Một phần
   * trắng lẫn giữa 39 phần đầy thì không ai thấy.
   */
  async function extractPage(item, deps, collect) {
    if (typeof deps.extractDoc !== 'function') throw new Error('docs: thiếu adapter trích trang tài liệu');
    const page = await deps.extractDoc(item);
    const body = docBody(item, page);
    if (!String((page && page.markdown) || '').trim()) {
      throw new Error(`trang không có nội dung nào đọc được (${(page && page.via) || 'không rõ nấc'})`);
    }
    // Chỉ những trang **phải leo lên nấc 2** mới đáng một dòng: một Nguồn mỏng vì trang render
    // bằng JS trông y hệt một Nguồn mỏng vì trang mỏng thật, và câu này là thứ phân biệt.
    //
    // `via` đi kèm `escalated`, và hai thứ đó **không** nói cùng một điều: `escalated` là "đã
    // phải leo", `via` là "leo có tới nơi không". `fetchDocPage` trả `escalated: true, via:
    // 'fetch'` cho trang mà nấc 2 hỏng và phải dùng lại nội dung mỏng của nấc 1 — đúng ca tệ
    // nhất, và cũng đúng ca mà bảng tổng kết dễ nói ngược nhất.
    if (page && page.escalated) {
      collect.docNotes.push({ id: item.id, via: String(page.via || ''), note: String(page.note || '') });
    }
    return { text: body, words: S.countWords(body) };
  }

  /**
   * Phần bảng tổng kết của riêng nhánh tài liệu — rỗng khi không có gì để nói.
   *
   * **Hai** tiêu đề, không một, và đó là chỗ câu chữ phải tương ứng với điều kiện đếm. Gộp cả
   * hai dưới "Phải mở tab ẩn" là nói rằng tab ẩn đã cứu được ngần ấy trang, trong khi những
   * trang `via: 'fetch'` là những trang nấc 2 **không** chốt được và Nguồn đang mang đúng phần
   * nội dung mỏng mà nấc 2 sinh ra để thay thế. Hai nhóm cùng kiểu (cùng là trang đã leo nấc,
   * cùng có `note`), nên đổ chung một rổ vẫn ra một bảng đọc trôi chảy và sai hẳn nghĩa.
   */
  function formatDocNotes(log) {
    const notes = (log && log.docNotes) || [];
    if (notes.length === 0) return '';
    const rescued = notes.filter((entry) => entry.via === 'tab');
    const stranded = notes.filter((entry) => entry.via !== 'tab');
    const lines = [];
    const section = (title, entries) => {
      if (entries.length === 0) return;
      lines.push(`${title}: ${entries.length} trang`);
      for (const entry of entries) lines.push(`  ~ ${entry.id}: ${entry.note}`);
    };
    section('Phải mở tab ẩn', rescued);
    section('Nấc 2 không chốt được, giữ nội dung mỏng của nấc 1', stranded);
    return lines.join('\n');
  }

  root.NBLM_DOCS_QUEUE = Object.freeze({
    UNNAMED_BRANCH,
    itemsFromPicker,
    docBody,
    extractPage,
    formatDocNotes,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
