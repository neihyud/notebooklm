---
status: done
labels: [ready-for-agent]
blocked_by: [001]
spec: docs/spec/0001-notebooklm-importer.md
---

# 008 — Trích nội dung trang tài liệu và chuyển sang Markdown

## Delivers
Cho một URL tài liệu, lấy về Markdown sạch: đúng thân bài, không dính điều hướng, khối code
giữ nguyên nhiều dòng.

## Scope
- Hai nấc: fetch từ tab cùng origin (mang cookie phiên, nên docs nội bộ đọc được), chỉ mở tab
  ẩn khi nấc 1 trả về nội dung mỏng bất thường.
- Nấc 2 chờ **URL khớp rồi nội dung đứng yên**. Với docsify, `#/a → #/b` không tải lại trang:
  tab báo `complete` trong khi DOM còn nguyên nội dung trang trước, đọc luôn là gán nhầm nội
  dung cũ cho URL mới — sai mà nhìn vẫn rất hợp lý.
- Chọn thân bài theo danh sách selector quen thuộc, hỏng thì chấm điểm chữ trong `p/li/pre/td/h*`
  trừ chữ nằm trong link, lấy khối **sâu nhất** vẫn giữ gần trọn nội dung.
- Dọn sidebar, breadcrumb, prev/next, "Edit this page", neo `#` cạnh đề mục.
- Sang Markdown, **không** `textContent`: Prism-react và Shiki dựng mỗi dòng code thành một
  phần tử riêng không có ký tự `\n` nào. Bỏ cột số dòng và nút Copy; đoán ngôn ngữ từ
  `language-*` / `data-lang`.

## Acceptance
- Test bằng cây node giả (Seam 3): một khối code 40 dòng kiểu Prism ra fence 40 dòng, không
  phải một dòng.
- Test: tên mục sidebar không rớt vào thân bài.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `e981c8b` (thân ticket) + `7d3be04` (bản vá sau nghiệm thu).

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 491, 16 file.` (T007 kết ở 437; ticket này +54.)

### Hai câu ticket bắt trả lời
- *Khối code 40 dòng kiểu Prism ra fence 40 dòng, không phải một dòng* — có; hoán vị sang
  `textContent` → ĐỎ 2 test.
- *Tên mục sidebar không rớt vào thân bài* — có; bỏ phép trừ chữ nằm trong link → ĐỎ 4 test.

### Câu Lead ghim thêm: cái gì chốt nội dung thuộc về URL đã yêu cầu
Ba lớp, mỗi lớp một cái chết: URL tab phải khớp URL yêu cầu (`sameDocPage`); nội dung phải khác
mốc chụp **trên thân bài** trước lúc điều hướng; kết quả mang URL tab *đang đứng*, không mang URL
đã gõ vào.

### Peer tự tìm ra, đáng ghi
16 đột biến, 1 lỗ tự phát hiện (biên `>=` của ngưỡng mỏng) và tự vá. Đáng chú ý hơn: peer nhận ra
một đột biến của **chính nó** vô hiệu — biến không bao giờ được gán — và chạy lại cho đúng nghĩa
thay vì đọc "đỏ" đó là code an toàn.

Cổng review bắt 4 lỗi thật, hai cái chỉ trang thật mới lộ: nút **Copy**/**Toggle word wrap** của
Docusaurus là **anh em** của `<pre>` chứ không phải con, nên bộ dọn không với tới và mọi khối code
kéo theo hai dòng rác; và `aside` trần xoá luôn `<aside class="footnote">` của Sphinx, mất im lặng
toàn bộ chú thích cuối bài trên một theme nằm sẵn trong danh sách quen thuộc.

Peer cũng đổi `test/manifest.test.js` từ danh sách viết tay sang suy từ cây thư mục
(`^src/<lớp>/selectors\.js$`) kèm assertion rằng mỗi file miễn trừ thật sự có mang selector — lý do
peer nêu: "thêm tên vào một danh sách viết tay là cách quy tắc ấy chết lặng ở lớp thứ tư". Đúng, và
nó vừa cứu chính ticket này.

### Hở Lead tìm được
`KEEP_RATIO` 0.9 ↔ `KNOWN_RATIO` 0.5 (`src/docs/extract.js:40,45`): suite **vẫn xanh 486/486**.

Hoán vị làm hỏng **cả hai đầu**: "giữ gần trọn" tụt xuống một nửa nên `pickMainBlock` đi sâu quá
mức và xén mất nửa bài; còn selector theme quen thuộc chỉ được tin khi đã đạt 90% điểm cao nhất
nên bị bỏ qua ở đúng những trang nó dành cho. Kết quả vẫn ra Markdown có tiêu đề, có khối code,
**nhìn hoàn toàn hợp lý** — chỉ thiếu nội dung. Cộng ADR 0002 (gộp nhiều trang vào một Nguồn),
thứ đến tay người dùng là một Nguồn trông đầy đủ với vài trang bị cắt ruột: rủi ro số một của
`WORKSPACE_PROTOCOL.md`.

Peer đã tự ghi trong "không phủ được" rằng hai *con số* này chưa được trang thật xác nhận. Đúng,
nhưng thứ lọt không phải con số — là **quan hệ giữa hai con số**. Đây là lần thứ hai cùng hình
(ticket 004: `formTries` ↔ `titleTries`), nên protocol v7 nâng nó thành hình phải soi.

**Đã vá** (`7d3be04`, +5 test): canh **vai trò** — `KEEP_RATIO` là "gần trọn" nên phải cao,
`KNOWN_RATIO` là "đủ tốt để tin selector quen" nên phải thấp hơn hẳn — không khoá 0.9/0.5, vì
chỉnh ngưỡng sau khi có trang thật là việc sẽ xảy ra. Peer quét tiếp và canh luôn **ba con số nhịp
chờ của nấc 2**. Lead xác minh: xanh 491, hoán vị lại hai ngưỡng → **ĐỎ**.

### Duyệt ngoài phạm vi
`importScripts` ba file mới vào `service-worker.js`; `docPageId`/`sameDocPage` trong `shared.js`
(cố ý dùng lại `docIdentity` thay vì viết phép so thứ hai — hai định danh lệch nhau thì khoá khử
trùng lặp và phép chốt nấc 2 nói hai chuyện khác nhau, mà lệch thì không có triệu chứng);
`test/manifest.test.js` như trên.

### Nợ ghi lại
1. Mọi selector theme chỉ kiểm bằng cây giả. Ticket 012 (đã nâng: chạy thật trên Chrome for
   Testing 151 có sẵn trên máy).
2. `KEEP_RATIO`/`KNOWN_RATIO` vẫn chưa có trang thật nào nói hai ngưỡng ấy đúng — chỉ có quan hệ
   giữa chúng là đã được canh. Ticket 012 là chỗ đo.
3. Hiệu năng `pickMainBlock` trên trang lớn chưa đo; peer cố ý không đo bằng cây giả vì con số sẽ
   dẫn sai.
4. Chưa có chỗ gọi nào — adapter `sameOrigin`/`tab` chưa nối vào `chrome.*`; hợp đồng "`read()`
   phải trả lời được *trước* `go()`" mới nằm trong doc comment, chưa có gì cưỡng chế. Ticket 010.
