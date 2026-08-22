---
status: proposed
---

# Playlist cắt theo dung lượng, tài liệu cắt theo ranh giới nhánh

ADR 0002 chốt gộp, nhưng trần 500.000 từ mỗi nguồn vẫn có thật: transcript khoảng 9 nghìn từ
mỗi video nghĩa là chừng 55 video vừa một Nguồn, nên playlist 300 video vẫn phải cắt làm sáu.
Playlist không có cấu trúc nội tại nên cắt theo số từ — đầy thì mở nguồn mới. Tài liệu thì đã
có sẵn cây sidebar, nên cắt theo Nhánh tài liệu: cắt ngang một nhánh chỉ để lấp đầy nguồn sẽ
phá đúng thứ khiến trích dẫn còn ý nghĩa. Nhánh nào một mình đã vượt trần thì mới rơi về cắt
theo số từ.

## Consequences

Số nguồn một playlist sinh ra không đoán trước được từ số video, vì phụ thuộc độ dài
transcript. Bảng xác nhận trước khi chạy *Import toàn bộ* phải ước lượng và nói ra con số đó,
nếu không người dùng sẽ chạm trần 50 nguồn giữa chừng mà không hiểu vì sao.
