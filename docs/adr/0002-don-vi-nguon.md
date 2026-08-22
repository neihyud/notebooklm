---
status: proposed
---

# Import toàn bộ thì gộp nguồn, import lẻ thì một mục một nguồn

Quota nguồn là thứ khan hiếm (50 mỗi notebook ở bản miễn phí), còn trần 500.000 từ mỗi nguồn
thì gần như không bao giờ chạm tới — một transcript 60 phút chỉ khoảng 8–10 nghìn từ, tức
dùng chừng 2% hạn mức của một nguồn nhưng vẫn tiêu trọn một slot. Vì vậy: *Import toàn bộ*
một playlist hoặc một Nhánh tài liệu gộp thành **ít Nguồn nhất có thể**, còn import lẻ giữ một
mục một nguồn. Quy tắc cắt khi một nguồn không chứa hết nằm ở ADR 0005.

## Considered Options

Giữ nguyên một video = một nguồn ở mọi đường: đơn giản, và trích dẫn của NotebookLM chỉ đúng
tên từng video. Nhưng khi đó "Import toàn bộ playlist vài trăm video" là tính năng không thể
dùng — nó cần bốn tới sáu notebook và extension không có khái niệm nào cho chuyện đó.

Cho người dùng chọn gộp hay không ở mỗi lần import: bị loại. Đẩy một quyết định kiến trúc sang
cho người chưa biết hậu quả của nó.

## Consequences

Trích dẫn của NotebookLM trên nguồn gộp sẽ chỉ tên playlist chứ không tên video. Phần lớn
thông tin đó không mất, vì header ngữ cảnh (tiêu đề, kênh, link gốc) và timestamp `[mm:ss]`
nằm ngay trong thân nguồn — nhưng đây là cái giá có thật và đã được chấp nhận có ý thức.
