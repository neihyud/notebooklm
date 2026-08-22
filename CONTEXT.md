# NotebookLM Importer

Đưa nội dung mà NotebookLM tự nó không đọc được — video YouTube private và trang tài liệu
dựng bằng JavaScript — vào một notebook, bằng cách trích ngay trong trình duyệt của người dùng.

## Language

**Nguồn**:
Một đơn vị nội dung mà NotebookLM lưu trong một Notebook đích. Tài nguyên khan hiếm: bản
miễn phí cho 50 nguồn mỗi notebook, còn trần 500.000 từ mỗi nguồn thì gần như không bao giờ chạm tới.
_Avoid_: tài liệu, document, item, entry

**Notebook đích**:
Notebook NotebookLM mà hàng đợi đang đổ nguồn vào. Tại một thời điểm chỉ có một.
_Avoid_: sổ tay, notebook

**Nguồn gộp**:
Một Nguồn chứa nhiều video hoặc nhiều trang tài liệu, sinh ra khi import cả playlist hoặc cả
Nhánh tài liệu. Đối lập với nguồn lẻ, một mục một nguồn.
_Avoid_: nguồn tổng hợp, bundle, batch

**Mục hàng đợi**:
Một việc cần làm: một video hoặc một trang tài liệu chờ được trích và đẩy đi. Video và tài
liệu nằm ở hai hàng đợi riêng.
_Avoid_: job, task, item

**Sổ đã import**:
Bản ghi những gì đã thực sự vào một Notebook đích, khoá theo cặp (video, notebook). Tách hẳn
khỏi hàng đợi: hàng đợi là việc cần làm, sổ là việc đã làm.
_Avoid_: lịch sử, cache, danh sách đã xong

**Mức riêng tư**:
Thuộc tính của video YouTube — private, unlisted, hoặc public — quyết định đường trích nào
được dùng. Không phải thứ extension có khả năng thay đổi.
_Avoid_: visibility, quyền, chế độ hiển thị

**Trích cục bộ**:
Lấy nội dung ngay trong trình duyệt người dùng, nơi phiên đăng nhập đã có sẵn và trang đã
render đầy đủ. Đối lập với việc đưa link cho máy chủ Google tự đi lấy.
_Avoid_: scrape, cào, bóc tách

**Đưa link**:
Giao URL cho NotebookLM và để nó tự lấy nội dung. Chỉ dùng được khi nội dung công khai và
không cần JavaScript để hiện ra.
_Avoid_: import bằng link, URL source

**Transcript**:
Phụ đề của một video đã gộp thành văn bản liên tục kèm mốc thời gian.
_Avoid_: phụ đề, caption, sub

**Nhánh tài liệu**:
Một mục trong sidebar của trang tài liệu cùng toàn bộ mục con của nó. Là đơn vị người dùng
chọn để import, không phải từng trang lẻ.
_Avoid_: section, chương, cụm trang

**Bảng chọn**:
Giao diện dựng lại cây mục lục của sidebar để người dùng tick chọn nhánh cần import.
_Avoid_: picker, dialog, panel

**Bản lưu transcript**:
File transcript ghi ra đĩa ngay khi trích xong, trước khi thử đẩy vào NotebookLM. Mặc định
luôn có, không phải một chế độ phải bật.
_Avoid_: chế độ chỉ tải về, download mode, offline mode
