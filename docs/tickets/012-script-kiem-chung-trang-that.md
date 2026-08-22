---
status: done
labels: [ready-for-agent]
blocked_by: [002, 008]
spec: docs/spec/0001-notebooklm-importer.md
---

# 012 — Script kiểm chứng trên trang thật

## Delivers
Hai script chạy chính mã nguồn của extension trên trang thật, vì ba đường hỏng dưới đây vô
hình với test tĩnh.

## Scope
- Script nạp module transcript vào một trang YouTube thật rồi chạy đường DOM.
- **Và chạy cả đường InnerTube.** `params` của `get_transcript` (protobuf base64 của videoId)
  được viết theo hiểu biết, chưa lần nào chạm API thật — test không chạm mạng nên suite không
  thể bắt nếu nó sai. Đây là chỗ duy nhất phát hiện được.
- Script nạp module Markdown / trích nội dung / dò sidebar vào trang thật, mặc định quét bốn bộ
  tạo docs dựng HTML khác hẳn nhau: Docusaurus, MkDocs Material, VitePress, Sphinx+RTD.
- Script phụ dump điểm chấm sidebar khi dò sai.

## Acceptance
- Script docs kiểm được: dò ra sidebar, không lọt link khác site hay neo trong trang, chọn đúng
  khối thân bài (không rơi về nhánh dự phòng), không nuốt mất nội dung, giữ đề mục, **khối code
  không dính thành một dòng**, tên mục sidebar không rớt vào thân bài.
- Kết quả chạy thật phải được dán vào handback. Không dán thì không nghiệm thu.

---

## Cập nhật 2026-08-22 — máy này CÓ trình duyệt thật

Lead đo trực tiếp:

```
/home/neihyud/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome --version
→ Google Chrome for Testing 151.0.7922.34
playwright 1.62.1
```

Nghĩa là ticket này **không** dừng ở "dựng script rồi để owner tự chạy". Nó phải **chạy thật và
dán kết quả**. Một script kiểm chứng chưa từng chạy là đúng thứ mà cả repo này đang cố tránh.

### Bổ sung vào Scope

- **Nạp chính extension này vào Chrome for Testing** bằng `launchPersistentContext` với
  `--disable-extensions-except=<repo>` và `--load-extension=<repo>` (MV3 cần persistent context,
  không chạy được với `browser.newPage()` thường).
- Xác nhận service worker của extension **thật sự khởi động** — `context.serviceWorkers()`, và
  nếu rỗng thì đó là một lỗi cần báo, không phải một bước bỏ qua được.
- Chạy trên **trang YouTube công khai thật** (không đăng nhập): trích transcript một video có
  phụ đề, và chạy cả đường InnerTube để kiểm `params` protobuf của `get_transcript` — đây là
  chỗ **duy nhất** phát hiện được nếu nó sai.
- Chạy trên **bốn trang docs công khai thật**, mỗi bộ tạo một trang: Docusaurus, MkDocs Material,
  VitePress, Sphinx+RTD. Kiểm đúng những điều Acceptance đã ghi.

### Ba điều KHÔNG làm trong ticket này

- **Không đăng nhập Google, không chạm NotebookLM.** `WORKSPACE_PROTOCOL.md` cấm, và không có
  phiên đăng nhập nào trong Chrome for Testing. Đường đẩy (ticket 003/004/015) nằm ngoài phạm vi
  kiểm chứng tự động; nó chỉ kiểm được bằng tay trên trình duyệt của owner.
- **Không dùng video private hay playlist riêng của ai.** Chọn video công khai, ghi rõ id đã dùng
  trong handback để lần sau chạy lại được.
- **Không sửa code sản phẩm để cho script chạy được.** Nếu phải sửa mới chạy được thì đó là một
  phát hiện — báo, đừng vá lén.

### Acceptance bổ sung

- Handback dán **output thật** của lần chạy: video id đã dùng, số segment trích được bằng mỗi
  đường, bốn URL docs đã quét và kết quả từng tiêu chí.
- Nếu một đường hỏng trên trang thật, **đó là kết quả hợp lệ của ticket này** — ghi rõ hỏng thế
  nào, đừng sửa lấy được rồi báo xanh. Ticket này tồn tại để tìm ra chuyện đó.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `e67219d`. Không cần vá vòng hai.

### Bằng chứng Lead tự chạy
- `bash test/run.sh` → `XANH — tests 677, 24 file.` (nền 638 / 23 file)
- `node tools/verify-live.mjs --video jNQXAC9IVRw` — Lead chạy lại độc lập, **tái hiện đủ cả ba
  phát hiện**, cùng số cùng chữ.
- Commit **không chạm một dòng code sản phẩm nào** — ràng buộc 2 của brief giữ được.

### Ticket này trả lời được câu mà 23 file test không trả lời được
Ba ticket trước (010, 011, 016) đều kết thúc bằng dòng "chưa chạy trên Chrome thật". Dòng ấy giờ
được xoá, và cái giá của nó là ba chỗ hỏng thật, không chỗ nào có triệu chứng trong suite.

### A — đường DOM hỏng phụ thuộc video, và `narrow-window` là chẩn đoán sai
Trên `jNQXAC9IVRw`, 4/4 lượt (Lead xác nhận lượt thứ 5):
```
lý do: narrow-window — cửa sổ quá hẹp…            ← cửa sổ 1440px, không hẹp chút nào
  panel target-id="PAmodern_transcript_view"            HIDDEN    dòng=0  khớp selector 'panel'=true
  panel target-id=null                                  EXPANDED  dòng=3  khớp selector 'panel'=false
  panel target-id="engagement-panel-searchable-transcript" HIDDEN dòng=0  khớp selector 'panel'=true
```
Panel **đang mở** mang `target-id = null` nên không khớp selector `panel`; hai panel khớp selector
thì ẩn. `viaDom` cố ý **không thử lại** khi NARROW, nên chẩn đoán sai không chỉ báo nhầm — nó cắt
luôn đường lui. ADR 0003 định tuyến video riêng tư sang DOM-only, nên đây là **đường duy nhất**
của chúng. Trên `dQw4w9WgXcQ` panel mở mang `target-id="PAmodern_transcript_view"` và đường này
chạy tốt (24 segment) — tức đây là lỗi phụ thuộc video, loại không bao giờ lộ ra ở một lần thử.

### B — `get_transcript` đã chết, không phải sai
HTTP 400 `FAILED_PRECONDITION` với **cả bốn** biến thể, cùng phiên cùng trang:
```
- params của sản phẩm      HTTP 400
- params YouTube tự đúc    HTTP 400      ← chuỗi của chính YouTube cũng 400
- bỏ hẳn params            HTTP 400
- params rác               HTTP 400
/youtubei/v1/next : HTTP 200 (442361 byte)   ← cùng ngữ cảnh, cùng key, vẫn sống
Endpoint mà CHÍNH TRANG gọi khi bấm nút Transcript: /youtubei/v1/get_panel
```
`params` YouTube tự đúc cũng 400 ⇒ **không phải lỗi mã hoá**. Giao diện đã chuyển sang `get_panel`.

### C — `params` là tiền tố đúng, thiếu trường (và cách so sánh mới là điều đáng học)
```
sản phẩm đúc ra : "CgtqTlFYQUM5SVZSdw=="
YouTube tự đúc  : "CgtqTlFYQUM5SVZSdxIOQ2dBU0FtVnVHZ0ElM0QYASozZW5nYWdlbWVudC1wYW5lbC1zZWFyY2hhYmxlLXRyYW5zY3JpcHQtc2VhcmNoLXBhbmVsMAE4AUAB"
⇒ thiếu-trường: 13 byte đầu giống hệt, thiếu 77 byte phía sau
```
Peer so trên **byte đã giải mã**, không trên chữ base64. Đúng chỗ quan trọng: hai chuỗi khác nhau
từ ký tự base64 thứ 18 (`dw` ↔ `dx`) vì 13 không chia hết cho 3 — so bằng chuỗi sẽ gọi một **quan
hệ tiền tố hoàn hảo** là "khác hẳn" và đẩy người sửa đi viết lại một bộ mã hoá đang đúng.

### D — quan sát, không phải tiêu chí đỏ
`buildTree` rơi về `via: flat` trên **MkDocs Material** (94 mục, không cha con — MkDocs chèn
`<nav class="md-nav">` giữa `<li>` và `<ul>` con nên `childrenMatching(li, 'ul, ol')` thấy 0) và
trên **VitePress** (sidebar dựng bằng div/section). Đơn vị "Nhánh" của ADR 0005 **suy biến** trên
hai bộ tạo này: một nhánh 40 trang thành 94 mục phẳng.

### Cổng review bắt 6 lỗi, và hai trong đó là lỗi của chính phép đo
- `serviceWorkers()` dừng ở **một** worker bất kỳ — Chrome tự nạp hai component extension, worker
  của chúng có thể tới trước, nên cả hai tool báo đỏ đúng cái check brief nói không được bỏ qua.
- `contentChars` xoá **mọi** khoảng trắng còn `main.chars` giữ một dấu cách mỗi từ: lệch hệ thống
  ~16 %, gần trọn dung sai 15 %. Bốn trang mặc định qua được **chỉ nhờ** cú pháp link bù lại.

Cùng hạng ticket 016 và ticket 010: thước đo hỏng trước sản phẩm.

### Vệ sinh
`ls -d /tmp/nblm-live-*` → 0 sau 8 lượt chạy trình duyệt (ticket 016 từng sót 11 thư mục).

### Hệ quả — ba ticket mới
- **017** ← phát hiện A. Đường duy nhất của video riêng tư đang hỏng.
- **013 được sửa đề bài** ← phát hiện B/C. `get_transcript` chết thì `params` thiếu trường không
  còn là đường sửa; đường thứ hai phải là `timedtext` hoặc `get_panel`.
- **018** ← quan sát D, ưu tiên thấp: `buildTree` không đọc được sidebar MkDocs/VitePress.
