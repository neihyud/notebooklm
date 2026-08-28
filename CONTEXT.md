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
Đưa URL cho NotebookLM tự đi đọc. Chỉ dùng được khi NotebookLM vào được nội dung đó: video
công khai, hoặc trang tài liệu đã có sẵn thân bài trong HTML thô. Backend Google fetch ẩn danh
và **không chạy JavaScript**, nên "vào được" là một câu hỏi đo được, không phải đoán.

**Dán text**:
Trích nội dung trên máy rồi dán thẳng vào NotebookLM. Bắt buộc với video private,
vì backend NotebookLM không có phiên đăng nhập của người dùng.

**Chính sách đưa vào**:
Public → Dán link. Private → Dán text.
Unlisted: trong Hàng đợi thì theo cài đặt của người dùng; nhưng **không bao giờ** vào một
Bó link — xem **Đường trao tay**.

Lưu ý: **Dán link** và **Dán text** là *chính sách* — đưa cái gì vào. Chúng không nói gì về
*cách* đưa, cũng không nói *ai* đưa. Ba thứ tách nhau: xem "Ai đưa vào" và "Đường đưa vào"
ngay dưới.

### Ai đưa vào

Trục này trả lời "ai thao tác". Nó tách hẳn với "Đường đưa vào" ngay dưới, vốn trả lời
"extension thao tác kiểu gì". Đừng nhét Đường trao tay vào làm thành viên thứ ba của trục đó:
nó không phải một kiểu thao tác của extension, nó là chỗ extension **ngừng** thao tác.

**Extension đưa**:
Extension tự hoàn tất việc thêm Nguồn, qua Đường giao diện hoặc Đường nhanh, rồi đối chiếu
số Nguồn trước/sau để biết mình có làm được hay không.

**Đường trao tay**:
Extension gom link, ghi vào clipboard, rồi dừng. Người dùng tự dán vào NotebookLM. Extension
không biết họ có dán hay không, và dán rồi có vào hay không.
_Tránh_: "đường tự dán" — "dán" trong glossary này đã là tên của *chính sách* (Dán link, Dán
text); mượn lại cho tên đường là trộn đúng hai thứ mục trên vừa tách ra.
Trạng thái cuối của một Bó link là **đã copy**, mãi mãi. Đừng gọi nó là **Không biết**: Không
biết là trạng thái của một Mục mà backend *đã thấy lệnh* nhưng ta không đọc được kết quả — ở
đây chưa lệnh nào được gửi đi cả. Hai thứ khác hẳn, và hệ quả cũng khác: Không biết thì người
dùng được bảo tự mở notebook kiểm, còn "đã copy" thì không có gì để kiểm. Điểm chung duy nhất
là Đường trao tay không bao giờ đạt tới "xong", và không được vờ như có.

**Bó link**:
Thứ nằm trong clipboard sau một lần trao tay: các URL trần, mỗi dòng một cái, không tiêu đề,
không chú thích. Một Bó link luôn mang chính sách Dán link và không bao giờ mang Dán text.
_Tránh_: "danh sách link" — Hàng đợi cũng là một danh sách; Bó link thì rời khỏi extension
ngay khi sinh ra.

**Sổ đã copy**:
Ghi lại từng Bó link đã trao tay: URL nào, lúc nào, gom từ đâu. Tồn tại để chống trùng.
_Tránh_: coi nó là một phần của Hàng đợi. Mục trong Hàng đợi có vòng đời extension điều khiển
tới cùng; dòng trong Sổ đã copy kết thúc ngay lúc được ghi.

### Đường đưa vào

**Đường giao diện**:
Thao tác đúng như người dùng thật trên giao diện NotebookLM — mở hộp thoại, chọn loại,
điền, bấm Chèn. Chậm, và vỡ khi Google đổi DOM. Là đường duy nhất đang *chạy*, vì Đường
nhanh còn tắt mặc định.
_Tránh_: "automation" khi đang nói về lựa chọn đường — cả hai đường đều là tự động.

**Đường nhanh**:
Gọi thẳng backend NotebookLM bằng chính phiên đăng nhập của tab, không qua giao diện.
Cả Dán link lẫn Dán text đều đi qua *một* lời gọi, chỉ khác tham số. Đã có mã từ 2026-08-24
(`src/notebooklm/rpc.js`, khai ở `manifest.json`) nhưng **tắt mặc định** (`rpcEnabled: false`)
— xem `docs/tickets/001-notebooklm-rpc.md`.
_Tránh_: "API" — NotebookLM bản consumer không có API công khai; đây là endpoint nội bộ,
và gọi nó là API tạo cảm giác có hợp đồng, thứ không hề tồn tại.

**Rơi xuống**:
Đường nhanh hỏng *theo kiểu chắc chắn chưa ghi gì* thì Mục đó tự chuyển sang Đường
giao diện, Lượt chạy không dừng. Đây là ràng buộc chứ không phải tối ưu: Đường nhanh
bám vào định danh mà Google xoay không báo trước, nên nó *sẽ* hỏng, và ngày nó hỏng
không được là ngày extension chết.
_Tránh_: hiểu Rơi xuống là "hỏng thì luôn chạy tiếp" — xem Không biết.

**Không biết**:
Backend đã thấy lệnh nhưng ta không đọc được kết quả. Không phải thất bại, cũng không
phải thành công — và **không được Rơi xuống**, vì thêm Nguồn không idempotent: chạy lại
Đường giao diện cho một lệnh có thể đã tới nơi là để lại một Nguồn trùng phải xoá tay.
Mục đó dừng, và người dùng được bảo tự mở notebook kiểm.
_Tránh_: gộp vào "lỗi" — lỗi thì thử lại được, Không biết thì không.

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
