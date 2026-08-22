---
status: proposed
---

# Chỉ tải về là hành vi cứu hộ tự động, không phải một chế độ phải nhớ bấm

ADR 0004 tách `tools/` đi, thu hẹp việc ghi transcript ra đĩa xuống đúng một việc: giữ lại
transcript đã trích khi khâu đẩy vào NotebookLM trục trặc, thay vì trích xong rồi vứt.
Nhưng một chế độ người dùng phải chọn *trước* khi chạy thì không cứu được gì — lúc biết cần
tới nó thì transcript đã mất rồi. Vì vậy nó thành **hành vi mặc định**: mọi transcript trích
xong đều được ghi ra file trước khi thử đẩy, và nút bấm chủ động vẫn giữ cho trường hợp người
dùng chỉ cần file ngay từ đầu.

## Định dạng

Giữ `.md` làm mặc định (có header ngữ cảnh và timestamp, giàu thông tin nhất) và `.srt` /
`.vtt` cho người cần nạp phụ đề trở lại vào player hoặc công cụ khác. **Bỏ `.txt`** — nó là
`.md` bị lược mất cấu trúc, không phục vụ mục đích nào mà hai định dạng kia không phục vụ tốt hơn.

## Consequences

Chạy một hàng đợi dài giờ luôn để lại file trên đĩa, kể cả khi mọi thứ trót lọt. Đó là cái giá
có ý thức: dung lượng rẻ, còn 15–20 giây mỗi video private thì không.
