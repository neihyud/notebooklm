---
status: done
commits: [c372539, cd706cd]
labels: [ready-for-agent]
blocked_by: [001]
spec: docs/spec/0001-notebooklm-importer.md
---

# 004 — Đẩy Nguồn vào NotebookLM, và trang Cài đặt ghi đè selector

## Delivers
Gọi được một hàm để thêm một Nguồn văn bản vào notebook đang mở, thao tác đúng như người dùng
thật. Trang Cài đặt sửa được nhãn mà không cần sửa code.

## Scope
- **Mọi** nhãn và selector tập trung một file duy nhất.
- Khớp theo chữ hiển thị đã bỏ dấu, duyệt theo thứ tự ưu tiên của mảng nhãn; nhãn dưới 4 ký tự
  không tham gia khớp mờ.
- Native value setter rồi mới phát event; phát đủ `pointerdown → mousedown → pointerup →
  mouseup → click`.
- Nhận diện lỗi **chỉ** đọc phần tử chuyên báo lỗi. Không quét toàn bộ chữ trong hộp thoại —
  bộ đếm "Source limit 3/50" là dòng bình thường, quét cả cụm sẽ huỷ oan một lần import đang
  chạy tốt.
- Hộp thoại đóng chưa chắc là xong: chờ thêm để bắt lỗi hiện muộn ở snackbar.
- Trang Cài đặt: ghi đè *gộp thêm* vào mặc định, nhãn người dùng đứng trước.

## Acceptance
- Selector xuất hiện ngoài file tập trung là **không nghiệm thu** (`WORKSPACE_PROTOCOL.md`).
- Test: `"add source"` thắng `"add"` bất kể thứ tự phần tử trong DOM.
- Test: một hộp thoại chứa "Source limit 3/50" **không** bị coi là lỗi.

## Nghiệm thu (Lead, 2026-08-22)

- Lead tự chạy `bash test/run.sh`: 218/218 xanh.
- Hoán vị ngoài danh sách 16 của peer: `formTries` ↔ `titleTries` → **xanh 215/215, lỗ thật**.
  Ý định nằm trong comment, không nằm trong test. Peer bổ sung 3 test canh *quan hệ* giữa hai
  ngân sách; Lead tự xác minh cả ba chết khi hoán vị.
- Peer bắt lỗi thiếu `"permissions": ["storage"]` trong manifest — không có nó thì
  `chrome.storage` là `undefined` và trang Cài đặt không lưu được gì ngoài test.
- Hai cặp mới đã vào `WORKSPACE_PROTOCOL.md` v2.
