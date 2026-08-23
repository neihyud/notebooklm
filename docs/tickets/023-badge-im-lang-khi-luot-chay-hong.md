---
status: open
labels: [ready-for-agent, bug]
blocked_by: [022]
spec: docs/spec/0001-notebooklm-importer.md
---

# 023 — Badge im lặng đúng lúc lượt chạy hỏng giữa chừng

## Vì sao ticket này tồn tại

Ticket 022 làm `runQueue` **không còn ném ra ngoài** sau khi đã đẩy — lỗi đi vào `log.failures` và
lên bảng tổng kết thay vì làm mất cả nhật ký lẫn Sổ. Đó là bản vá đúng, nhưng nó tạo ra một hạng
lỗi mới mà badge chưa biết đọc.

`src/background/service-worker.js:371` — `const failed = log.dropped.length;`. Lỗi của ticket 022
nằm ở `log.failures`, **không** ở `log.dropped`. Nên một lượt chạy hỏng giữa chừng đi vào nhánh
"thành công" và badge bị **xoá trắng**.

Câu *"LƯỢT CHẠY HỎNG GIỮA CHỪNG — Sổ đã import vẫn giữ N Nguồn đã đẩy"* **có** trong bảng tổng kết
ở popup. Nhưng badge là thứ người dùng thấy mà không cần mở popup, và một lượt chạy hỏng giữa
chừng trông y hệt một lượt chạy trọn vẹn cho tới lúc họ tự mở ra xem.

Peer của ticket 022 tìm ra qua cổng review và **không sửa** vì `service-worker.js` ngoài phạm vi.
Lead xác nhận dòng 371 đúng như mô tả.

## Delivers

Badge nói ra được lượt chạy hỏng giữa chừng, không chỉ Mục hỏng.

## Scope

- `src/background/service-worker.js`. Không đụng `queue-engine.js` — nó vừa nghiệm thu.
- `log.dropped` và `log.failures` là **hai hạng khác nhau**, không phải hai mức nặng nhẹ:
  `dropped` là Mục không import được (lượt chạy vẫn trọn vẹn), `failures` là cả một hàng đợi chết
  giữa chừng và có Mục quay lại hàng đợi. Badge phải phân biệt được, hoặc nói rõ vì sao gộp.

## Acceptance

- Trả lời được: test nào chết nếu badge đọc `log.failures` thay cho `log.dropped` và ngược lại?
  Hai mảng cùng kiểu, cùng là "có chuyện không hay", nên hoán vị vẫn cho một badge trông hợp lý.
- Trả lời được: test nào chết nếu lượt chạy **hỏng giữa chừng mà không có Mục nào `dropped`** —
  tức đúng ca ticket này nói tới — badge lại im lặng?
- Một lượt chạy có **cả hai** (`dropped` khác rỗng *và* `failures` khác rỗng) phải nói đúng cả
  hai; fixture một hạng không phân biệt được gì (`WORKSPACE_PROTOCOL.md` v10).
- Suite xanh, in `tests N`.
