---
status: proposed
---

# Hai hàng đợi: song song khi trích, xếp lượt khi đẩy

Video private tốn 15–20 giây mỗi mục vì phải mở tab watch (ADR 0003); một trang tài liệu tốn
một request. Chạy chung tuần tự bắt 80 trang tài liệu xếp hàng sau những video mỗi cái 20
giây — phần rẻ trả giá cho phần đắt. Hai loại chỉ chia sẻ đúng một thứ là Notebook đích, còn
lại khác tốc độ, khác mô hình lỗi, khác cả điều kiện môi trường. Vì vậy tách làm hai hàng đợi
chạy song song ở khâu trích.

## Consequences

NotebookLM chỉ có một hộp thoại thêm nguồn, nên khâu đẩy vẫn phải tuần tự — hai hàng xếp lượt
ở đúng chỗ đó. Ranh giới này là bất biến cần một test canh: song song ở trích, độc quyền ở đẩy.
