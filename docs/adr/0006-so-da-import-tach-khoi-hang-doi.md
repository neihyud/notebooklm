---
status: proposed
---

# Sổ đã import tách khỏi hàng đợi, khoá theo cặp (video, notebook)

Hàng việc cần làm và sổ ghi những gì đã làm là hai khái niệm; nhồi chúng vào một cấu trúc là
lý do nút *Xoá xong* có tác dụng phụ không ai đoán được — dọn hàng đợi cho gọn mắt thì mất
luôn chống trùng lặp, mà không có triệu chứng gì. Khoá phải là cặp **(video, Notebook đích)**:
khoá theo mỗi video sẽ chặn oan khi người dùng đổi sang notebook khác chưa có gì. Nguồn gộp
theo ADR 0002 vẫn ghi vào sổ từng video một, để một lần import lẻ sau đó biết là trùng.

## Considered Options

Khoá theo (đơn vị import, notebook) — playlist là một khoá: đơn giản hơn, nhưng import lẻ một
video vốn đã nằm trong nguồn gộp sẽ lọt qua và tạo nội dung trùng trong cùng notebook.
