---
status: open
labels: [ready-for-agent]
blocked_by: [005, 006]
spec: docs/spec/0001-notebooklm-importer.md
---

# 013 — Adapter `timedtext`: đường trích thứ hai cho video công khai

## Vì sao ticket này tồn tại

Ticket 005 để lại một lỗ có chủ ý. `src/youtube/watch.js` chỉ trích được transcript qua panel DOM.
Với video công khai / unlisted có sẵn phụ đề, `timedtext` cho cùng dữ liệu ấy mà không cần mở panel,
không cần chờ DOM dựng xong, và không hỏng khi YouTube đổi layout. Peer T005 không làm vì nó cần
`captionBaseUrl`, thứ chỉ có trong `ytInitialPlayerResponse` ở MAIN world — và `WORKSPACE_PROTOCOL.md`
lúc đó xếp mọi lần chạm `page-bridge.js` vào quyết định của owner.

Owner đã duyệt 2026-08-22 (protocol v4). Ranh giới thật là **auth**, không phải số op.

## Delivers

Một op mới `playerResponse` trên bridge, và một adapter trích trong `watch.js` dùng `captionBaseUrl`.
Adapter DOM có sẵn vẫn là đường lui, không bị thay thế.

## Ràng buộc không được đảo

- Op mới **không** vào `AUTH_OPS` (`src/youtube/bridge-protocol.js`). Nó đọc dữ liệu mà một tab ẩn
  danh cũng đọc được. Thêm nó vào `AUTH_OPS` là vượt quyền — dừng và hỏi Lead.
- ADR 0003 vẫn nguyên: **video private đi thẳng đường DOM**, không thử `timedtext` trước rồi mới lui.
  PoToken là chuyện cấu trúc, không phải chuyện thử lại. `timedtext` với `exp=xpe` trả HTTP 200 rỗng —
  một lần chạy "thành công" mà không có dòng nào.
- Vì thế: **HTTP 200 với 0 segment là hỏng, không phải là "video không có phụ đề"**. Hai trường hợp
  này phải phân biệt được ở tầng dữ liệu, không phải ở tầng log.
- Thứ tự thử do mức riêng tư quyết định, không do "cái nào nhanh hơn".

## Acceptance

- Trả lời được: **test nào chết** nếu hoán vị hai adapter trích cho nhau (DOM ↔ timedtext) trong bảng
  chọn theo mức riêng tư? Cả hai cùng kiểu hàm và cùng trả về `{segments, meta}`, nên hoán vị vẫn cho
  một lần import "thành công" — với video private thì nó trả về rỗng và Sổ vẫn ghi xong.
- Trả lời được: test nào chết nếu `playerResponse` lọt vào `AUTH_OPS`?
- Một phản hồi `timedtext` HTTP 200 rỗng không được đi tiếp thành một Nguồn.
- Suite xanh, in `tests N`.

## Nợ mang theo từ T005

`ticket 012` phải kiểm `params` protobuf của `get_transcript` trên InnerTube thật. Ticket này thêm
một đường mạng nữa cần kiểm trên trang thật — gộp vào 012, đừng mở ticket kiểm riêng.

---

## Sửa đề bài — 2026-08-22, sau ticket 012

Ticket 012 chạy đường InnerTube trên trang thật. Kết quả đổi tiền đề của ticket này:

```
get_transcript, cùng phiên cùng trang, bốn biến thể:
  - params của sản phẩm      HTTP 400 FAILED_PRECONDITION
  - params YouTube tự đúc    HTTP 400          ← chuỗi của CHÍNH YouTube cũng 400
  - bỏ hẳn params            HTTP 400
  - params rác               HTTP 400
/youtubei/v1/next            HTTP 200 (442361 byte)   ← cùng ngữ cảnh, cùng key, vẫn sống
Endpoint mà CHÍNH TRANG gọi khi bấm nút Transcript: /youtubei/v1/get_panel
```

**`get_transcript` không sai — nó chết.** Params do chính YouTube đúc cũng 400, nên mọi giả thuyết
về mã hoá protobuf đều sai đường. Giao diện đã chuyển sang `get_panel`.

Hệ quả cho ticket này:

- Việc "sửa `params` protobuf" **không còn là việc**. Phát hiện C của ticket 012 (chuỗi sản phẩm là
  tiền tố đúng, thiếu 77 byte) vẫn đúng về mặt mã hoá nhưng đã hết giá trị thực dụng.
- Đường trích thứ hai phải chọn giữa **`timedtext`** (như tên ticket) và **`get_panel`**. Ticket
  này phải **đo cả hai trên trang thật** bằng `tools/verify-live.mjs` trước khi chọn, và ghi lý do
  chọn vào một ADR — đừng chọn bằng lập luận.
- Ràng buộc auth giữ nguyên: đường này **không** vào `AUTH_OPS` (`src/youtube/bridge-protocol.js`).
  Owner đã duyệt một op không-auth cho `page-bridge.js`; đó vẫn là ranh giới.
- Đường DOM đang hỏng trên một lớp video (ticket 017), nên **đừng** giả định có đường lui đang chạy.
