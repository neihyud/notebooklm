---
status: proposed
---

# Tên Nguồn gộp không mang mẫu số, và suy được từ nguồn gốc

Trích dẫn của NotebookLM chỉ hiện tên nguồn, nên với Nguồn gộp cái tên là toàn bộ thứ người
đọc có để biết mình đang xem gì — nó phải tự mô tả. Nhưng ADR 0008 chốt đẩy dần: nguồn thứ
nhất được chốt và đẩy đi từ lâu trước khi biết playlist sẽ tốn mấy nguồn, nên **mẫu số không
tồn tại ở thời điểm đặt tên**. Vì vậy đánh số không mẫu số:

```
<Tên playlist> — phần 1
<Tên playlist> — phần 2
<Tên playlist> — bổ sung 1          (ADR 0009)
<Tên site> — <Tên nhánh>            (tài liệu; nhánh đã là ranh giới cắt, ADR 0005)
<Tên site> — <Tên nhánh> — phần 2   (chỉ khi nhánh đó một mình vượt trần và phải cắt tiếp)
```

Phần đầu của một Nhánh tài liệu **không** mang chỉ số: nhánh vừa một nguồn là trường hợp
thường, bắt nó mang `— phần 1` là gắn một con số vô nghĩa vào gần như mọi nguồn tài liệu.

Tên phải suy được từ (nguồn gốc, chỉ số phần) và chỉ từ đó — không nhúng ngày giờ, không nhúng
số video. Đó là điều kiện để lần import sau đọc tên nguồn trong notebook mà biết phần nào đã có.

## Consequences

Người đọc không biết "phần 3" là phần cuối hay còn nữa. Đổi lại họ không bao giờ thấy một cái
tên nói dối — `(1/6)` đặt lúc chưa biết tổng số thì đến phần 7 là sai, và nguồn đã đẩy đi
không sửa lại được.

Ràng buộc kéo theo: tên playlist đổi thì nhận diện đứt. Chấp nhận — nó hiếm, và Sổ đã import
(ADR 0006) khoá theo videoId nên phần chống trùng lặp thật sự không dựa vào tên.
