# Đưa video YouTube và trang tài liệu vào NotebookLM

Extension Chrome đưa nội dung từ YouTube và các trang tài liệu vào NotebookLM.
Lý do tồn tại: NotebookLM tự đọc được link công khai, nhưng không đọc được video
private và nhiều trang render bằng JavaScript — phần đó phải trích ngay trên máy
người dùng, trong phiên đăng nhập của chính họ.

## Language

### Đối tượng

**Mục** (queue item):
Một video hoặc một trang tài liệu đang chờ được đưa vào NotebookLM.
_Tránh_: task, job, entry.

**Hàng đợi**:
Danh sách các Mục, giữ nguyên qua mọi lần Chrome tắt service worker.
_Tránh_: danh sách, list.

**Nguồn** (source):
Một mục nội dung đã nằm bên trong NotebookLM. Đây là thứ duy nhất đo được sự
thành công của extension — mọi thứ khác chỉ là bước trung gian.
_Tránh_: tài liệu, document, item.

**Transcript**:
Lời thoại của một video, kèm mốc thời gian, trích được trên máy người dùng.
_Tránh_: phụ đề, caption, sub — "phụ đề" là thứ YouTube lưu, Transcript là thứ ta đã trích ra.

### Cách đưa vào

**Dán link**:
Đưa URL cho NotebookLM tự đi đọc. Chỉ dùng được khi NotebookLM vào được nội dung
đó — tức là video công khai.

**Dán text**:
Trích nội dung trên máy rồi dán thẳng vào NotebookLM. Bắt buộc với video private,
vì backend NotebookLM không có phiên đăng nhập của người dùng.

**Chính sách đưa vào**:
Public → Dán link. Private → Dán text.
Unlisted chưa chốt.

Lưu ý: **Dán link** và **Dán text** là *chính sách* — đưa cái gì vào. Chúng không nói
gì về *cách* đưa. Hai thứ đó tách nhau, xem "Đường đưa vào" ngay dưới.

### Đường đưa vào

**Đường giao diện**:
Thao tác đúng như người dùng thật trên giao diện NotebookLM — mở hộp thoại, chọn loại,
điền, bấm Chèn. Chậm, và vỡ khi Google đổi DOM. Là đường duy nhất đang có.
_Tránh_: "automation" khi đang nói về lựa chọn đường — cả hai đường đều là tự động.

**Đường nhanh**:
Gọi thẳng backend NotebookLM bằng chính phiên đăng nhập của tab, không qua giao diện.
Cả Dán link lẫn Dán text đều đi qua *một* lời gọi, chỉ khác tham số. Chưa có — xem
`docs/tickets/001-notebooklm-rpc.md`.
_Tránh_: "API" — NotebookLM bản consumer không có API công khai; đây là endpoint nội bộ,
và gọi nó là API tạo cảm giác có hợp đồng, thứ không hề tồn tại.

**Rơi xuống**:
Đường nhanh hỏng thì Mục đó tự chuyển sang Đường giao diện, Lượt chạy không dừng.
Đây là ràng buộc chứ không phải tối ưu: Đường nhanh bám vào định danh mà Google xoay
không báo trước, nên nó *sẽ* hỏng, và ngày nó hỏng không được là ngày extension chết.

### Vận hành

**Lượt chạy** (run):
Một lần xử lý hết Hàng đợi. Chạy một mạch, không đòi người dùng bấm gì giữa chừng.

**Bản sao xuống đĩa**:
File `.txt`/`.srt`/`.vtt`/`.md` lưu vào thư mục Downloads. Là *phụ phẩm* của việc
trích Transcript, không phải mục đích của một Lượt chạy.
_Tránh_: "tải transcript" khi đang nói về Lượt chạy — hai việc khác nhau.

**Ô Khám phá nguồn** (discover query box):
Ô nhập trong hộp thoại thêm nguồn của NotebookLM, dùng để tìm nguồn mới trên web.
Không phải nơi đưa nội dung vào — extension không bao giờ được ghi vào đây.
_Tránh_: ô tìm kiếm, search box — trong notebook còn có ô hỏi đáp, đừng lẫn.

**Nút loại nguồn**:
Nút chọn cách đưa nội dung vào, bấm trước khi có ô nhập tương ứng. Giao diện hiện
tại có bốn: tệp, Trang web (gánh cả link thường lẫn YouTube), Drive, Văn bản đã
sao chép.
_Tránh_: chip, tab — cùng chỉ một thứ, chọn "nút loại nguồn".
