---
status: done
labels: [ready-for-agent]
blocked_by: [005]
spec: docs/spec/0001-notebooklm-importer.md
---

# 007 — Import toàn bộ playlist hoặc kênh

## Delivers
Nút "Import toàn bộ" trên trang playlist/kênh gọi thẳng API nội bộ của YouTube và phân trang
tới hết, nên lấy đủ playlist vài trăm video bất kể đã cuộn tới đâu. Áp dụng cho cả `WL` và `LL`.

## Scope
- Liệt kê playlist qua cầu MAIN world (đây **là** mục đích của nó — ADR 0003).
- Bảng xác nhận trước khi chạy: bao nhiêu video, bao nhiêu là private của người dùng, bao nhiêu
  bị bỏ vì không có quyền xem, và **ước lượng sẽ tốn bao nhiêu Nguồn**.
- Thanh nổi với checkbox trên từng thumbnail để chọn lẻ.
- Import lại playlist đã có thêm video mới → sinh Nguồn `— bổ sung N` (ADR 0009).

## Acceptance
- Playlist 300 video: bảng xác nhận ra con số Nguồn ước lượng trước khi trích mục nào.
- Import lại sau khi thêm video: chỉ phần mới được trích.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `92b40bf` (thân ticket) + `8fe6424` (bản vá sau nghiệm thu).

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 437, 14 file.` (T006 kết ở 366; ticket này +71.)

### Hai câu ticket bắt trả lời
- *Playlist 300 video: bảng xác nhận ra con số Nguồn ước lượng trước khi trích mục nào* — có,
  và ước lượng tính **từ tổng thời lượng**, không từ số từ (ADR 0005 + 0008). Hoán vị sang "suy
  từ số video" → ĐỎ 3 test.
- *Import lại sau khi thêm video: chỉ phần mới được trích* — Sổ đã import khoá theo cặp (video,
  notebook); hoán vị `ledgerKey(videoId, notebookId)` ở **mọi** chỗ gọi → ĐỎ 4 test.

### Peer tự tìm ra, đáng ghi
16 hoán vị tự chạy (12 đỏ ngay, 4 ban đầu xanh rồi tự vá) và `/code-review` bắt thêm 4 lỗi thật.
Nặng nhất là lỗi thứ ba: `playlist-bar.js` dựng **cầu MAIN world thứ ba**, mà `newId` là
`nblm-<ms>-<đếm>` với bộ đếm **riêng mỗi client** — hai client hỏi trong cùng mili-giây nhận cùng
id, mỗi bên settle bằng phản hồi tới trước. Đúng cái mà đầu `bridge-client.js` đã cảnh báo. Vá
bằng memo hoá `createTab` theo cửa sổ (`WeakMap`); hình này có từ ticket 006 (`panel.js` cũng tự
`createTab`) nên bản vá dọn cả ba chỗ.

Phát hiện #1 cùng loại với hình v5 của protocol ở cỡ playlist: lượt liệt kê 300 video đang bay,
điều hướng SPA giữa chừng, `close()` dọn xong nhưng Promise cũ vẫn kết thúc bằng
`mountCheckboxes()` trên DOM của playlist **mới**.

Peer cũng **xoá** một dòng không bao giờ chạy trong `pageTarget` thay vì bọc thêm một lớp canh —
đúng hướng "ưu tiên gỡ thứ không có tác dụng hơn là thêm lớp bảo vệ mới".

### Hở Lead tìm được
Cặp phân loại `privateOwned` ↔ `unlisted` peer đã canh (ĐỎ). Nhưng hoán vị **hai nhãn** trong khi
giữ nguyên biến — `lines.push(\`${privateOwned.length} video không công khai.\`)` và ngược lại —
suite **vẫn xanh 431/431**.

`counts` là thứ test đọc; `lines` là thứ **người dùng đọc**. Sau hoán vị, bảng nói "3 video không
công khai" về đúng những video private của chính họ: mọi con số vẫn đúng, mọi nhóm vẫn import
được, tổng vẫn khớp. Mà bảng xác nhận tồn tại đúng để người dùng quyết định **trước khi tiêu
quota nguồn** (ADR 0005) — nó nói sai loại thì quyết định dựa trên nó cũng sai. Thêm nữa, mệnh đề
"— trích bằng đường DOM" là lời hứa về *cách* trích (ADR 0003); khi ticket 013 cho unlisted đi
`timedtext` thì nhãn gán nhầm thành mô tả sai đường đi.

**Đã vá** (`8fe6424`, +6 test, chỉ đụng file test — code không sai, test thiếu). Peer quét tiếp và
tìm ra **năm chỗ nữa cùng loại**: nhãn `privateOwned` ↔ `unavailable`; dòng đầu tổng ↔ số sẽ
import; dòng đếm thanh nổi "đã liệt kê" ↔ "đã chọn"; "đã liệt kê N mục qua M trang" hai số đổi
chỗ; lý do bỏ một mục tiêu đề ↔ tên kênh.

Kỹ thuật đúng: lô fixture cho sáu con số **khác nhau đôi một**, nên một hoán vị bất kỳ đều làm
lệch ít nhất một dòng; neo bằng một mảnh ngắn định danh được nhóm chứ không khoá cả câu, nên sửa
câu chữ mà vẫn gọi nhóm ấy như cũ thì test đứng yên. Kèm một vế **không đọc chữ nào** của nhãn —
thêm một video vào một nhóm chỉ được làm đổi dòng của nhóm ấy — vì "nhãn đúng mà cắm nhầm biến"
là lỗi khác và cần một cái chết riêng.

Lead xác minh lại: xanh 437, hoán vị lại hai nhãn → **ĐỎ**.

### Duyệt ngoài phạm vi file
- `estimateSources` dời `queue-engine.js` → `shared.js` (kèm 4 test dời theo). Lead xác minh: code
  và test giữ nguyên, chỉ đổi chỗ; không còn chỗ gọi nào trỏ về `E.estimateSources`. Lý do đúng:
  bảng xác nhận vẽ trên chính tab YouTube, nơi engine hàng đợi không được nạp, và nó là hàm thuần
  nên thuộc Seam 1.
- `manifest.json` (khai `playlist.js`, `playlist-bar.js`), `selectors.js` (6 nhóm selector
  playlist/kênh), `watch.js` (memo hoá `createTab`, chuyển thêm `wordsPerMinute`/`maxWords`).
- `AUTH_OPS` **không** đụng tới — `listPlaylist` đã có sẵn trong đó.

### Nợ ghi lại, không chặn ticket này
1. Không test nào chạy trên YouTube thật; mọi phản hồi InnerTube là fixture. `collect()` đi bộ cả
   cây theo khoá thay vì men theo đường renderer cố định chính vì thế, nhưng "playlist rỗng vì
   YouTube đổi tên renderer" thì không test nào ở đây bắt được. Ticket 012.
2. Selector trang playlist/kênh suy từ tên custom element, chưa đối chiếu DOM thật. Triệu chứng
   nếu sai: không có checkbox nào mọc; đường import chính (InnerTube) vẫn chạy. Ticket 012.
3. `MAX_PAGES = 200` chọn theo lý lẽ, chưa đo trên playlist thật.
4. `/@handle/playlists` và `/@handle/shorts` cũng mọc thanh nổi — đúng theo `pageTarget`, hơi bất
   ngờ với người đang đứng ở tab Playlists. Để nguyên; mở ticket sau nếu dùng thật thấy phiền.
