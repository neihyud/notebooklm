# YouTube & Tài liệu → NotebookLM Importer

Chrome extension (Manifest V3) đẩy nhanh **video YouTube** và **trang tài liệu lập trình** vào NotebookLM — bao gồm cả video private do bạn sở hữu (không phải chuyển sang public) và docs mà NotebookLM nuốt link vào thì ra nguồn rỗng.

---

## Vấn đề, và cách extension giải quyết

NotebookLM chỉ nhận **video public có phụ đề**. Lý do mang tính kỹ thuật chứ không phải chính sách tuỳ tiện: khi bạn dán một link YouTube, **máy chủ Google đi tải video đó, không kèm phiên đăng nhập của bạn**. Video private của bạn với máy chủ ấy cũng chỉ là một video không có quyền xem. Không có mẹo nào ở phía URL sửa được chuyện này.

Vậy nên extension đổi hướng: **transcript được trích ngay trong trình duyệt của bạn** — nơi bạn đã đăng nhập và thực sự có quyền — rồi dán vào notebook dưới dạng nguồn *"Copied text"*.

| Mức riêng tư | Đường đi | Ghi chú |
|---|---|---|
| **Private** | Luôn trích transcript cục bộ | Không bao giờ gửi URL cho NotebookLM |
| **Unlisted** | Thử link trước → hỏng thì trích transcript | Đổi được trong Cài đặt |
| **Public** | Link (NotebookLM tự lấy transcript) → hỏng thì trích cục bộ | Nhanh nhất |

> **Cam kết:** extension không có, và không cần, bất kỳ khả năng nào để thay đổi chế độ hiển thị video. Nó không đụng tới YouTube Studio, không gọi API cập nhật video. Toàn bộ quyền được cấp trong `manifest.json` là đọc trang và thao tác giao diện.

### Trang tài liệu hỏng vì cùng một lý do

Dán link docs vào NotebookLM rất hay ra một nguồn **trống trơn hoặc chỉ có mỗi menu**. Cũng không phải chính sách: máy chủ Google fetch cái URL đó và **không chạy JavaScript**, nên trang nào dựng thân bài ở phía client thì thứ máy chủ nhận về chỉ là cái khung. Trang nào rơi vào diện đó là chuyện **đo từng trang, không suy từ tên bộ tạo docs**: đo 19 trang thật (2026-08-25) cho thấy Docusaurus và VitePress là bộ tạo trang tĩnh — HTML thô đã có đủ thân bài — còn docsify thì đúng là rỗng hoàn toàn. Trang có SSR thì đỡ hơn, nhưng nguồn vẫn dính nguyên sidebar và footer lặp ở mọi trang.

Đường vòng giống hệt: **trích nội dung ngay trong trình duyệt bạn** — nơi trang đã render đầy đủ — rồi dán vào dưới dạng nguồn văn bản.

| Tình huống | Đường đi |
|---|---|
| Mặc định | Trích nội dung cục bộ → dán text |
| Docs có SSR, muốn NotebookLM tự cập nhật | Đổi sang *Thử link trước* trong Cài đặt |

---

## Cài đặt

1. Mở `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục này
4. Mở notebook đích trên `notebooklm.google.com`, rồi bấm icon extension → **"Dùng notebook ở tab hiện tại"**

Yêu cầu: Chrome 111+ (dùng content script `world: "MAIN"`), và bạn đang đăng nhập Google trong chính trình duyệt đó.

---

## Cách dùng

**Một video** — vào trang xem video, cạnh nút Like/Share có hai nút: **NotebookLM** xếp video vào hàng đợi, **Copy link** copy URL vào clipboard để bạn tự dán (xem *Đường trao tay* bên dưới). Phím tắt `Alt+Shift+Y` tự rẽ: video công khai đi đường Copy link, mọi trường hợp còn lại vào hàng đợi.

**Nhiều video cùng lúc** — trên trang playlist / kênh / kết quả tìm kiếm / Watch Later, mỗi thumbnail có một checkbox ở góc trái. Chọn xong bấm **Import vào NotebookLM** ở thanh nổi dưới màn hình.

**Toàn bộ playlist hoặc kênh** — trên trang playlist / kênh, thanh nổi có nút **Import toàn bộ**. Nút này *không* đọc DOM: nó gọi thẳng API nội bộ của YouTube và phân trang tới hết, nên lấy đủ playlist vài trăm video bất kể bạn đã cuộn tới đâu. Trước khi chạy sẽ hiện bảng xác nhận: bao nhiêu video, bao nhiêu cái là private của bạn, bao nhiêu cái bị bỏ vì không có quyền xem. Bảng đó có ba lối ra: import cả mẻ, *Copy link công khai* (chỉ copy, không import — xem *Đường trao tay*), hoặc huỷ. Áp dụng được cho cả **Xem sau** (`WL`) và **Video đã thích** (`LL`).

**Gom từ nhiều tab / cả trang** — trong popup: *Mọi tab YouTube đang mở*, hoặc *Mọi link YouTube trên trang này* (chạy được trên trang bất kỳ, không riêng YouTube — hữu ích khi quét một bài blog đầy link video).

**Xem / tải transcript** — nút **Transcript** cạnh nút NotebookLM mở panel bên phải: có ô tìm kiếm (bỏ dấu vẫn khớp), bấm timestamp là video nhảy tới đúng đoạn, sao chép, và tải về `.txt` / `.srt` / `.md`. Chạy được với cả video private của bạn, vì dùng chung đúng cơ chế trích ở trên.

**Bản sao transcript xuống đĩa** — bật *Lưu thêm một bản transcript vào Downloads* trong Cài đặt. Từ đó mỗi Lượt chạy vừa thêm Nguồn vào NotebookLM vừa ghi file, **trong cùng một lượt, không phải bấm thêm nút nào**. Định dạng `.txt` / `.srt` / `.vtt` / `.md` và thư mục đích cũng nằm trong Cài đặt; file được đánh số theo vị trí của mục trong hàng đợi cho dễ sắp. Bản sao là *phụ phẩm*: ghi hỏng thì nguồn vẫn được thêm vào NotebookLM bình thường và lý do hỏng hiện ngay trên dòng của mục trong popup.

**Dán danh sách link** — mở popup, dán vào ô, bấm *Thêm vào hàng đợi*.

**Chuột phải** — trên một link YouTube bất kỳ, hoặc bôi đen một đoạn text chứa nhiều link.

**Trang tài liệu** — mở trang docs bất kỳ. Extension dò sidebar và hiện nút nổi **→ NotebookLM · N trang** ở góc dưới bên phải; bấm vào để mở bảng chọn. Bảng dựng lại đúng cây mục lục của sidebar, có ô lọc, tick theo nhánh (tick mục cha là chọn cả nhánh con), rồi bấm *Thêm N trang*. Không thấy nút thì gọi bằng phím tắt `Alt+Shift+D`, popup, hoặc chuột phải → *Chọn link tài liệu…*.

Hàng đợi chạy tuần tự, lưu bền qua các lần khởi động lại, và xem/dừng/thử-lại được từ popup. Cả hai loại nguồn dùng chung một hàng đợi.

**"Xong" nghĩa là đã kiểm chứng.** Import xong, extension đếm lại số **Nguồn** trong notebook và so với số đếm trước khi mở hộp thoại: tăng đúng 1 mới là xong. Không tăng — hộp thoại đóng mà nguồn không vào — thì mục báo lỗi kèm số trước/sau. Khi extension *không đọc được* danh sách Nguồn (Google đổi giao diện), mục hiện **"Xong — chưa xác minh được"** với chấm vàng rỗng thay vì chấm xanh: đã bấm xong nhưng không có gì đối chiếu, và nói thẳng ra thay vì im lặng. Tương tự với **Bản sao xuống đĩa**: chỉ ghi nhận là đã lưu khi Chrome xác nhận file nằm trên đĩa, download bị gián đoạn thì hiện lý do Chrome trả về. Và khi bản chép lời lấy từ panel YouTube **chạm trần cuộn** — video rất dài, danh sách vẫn còn dài ra khi hết ngân sách cuộn — mục cũng hiện *"Xong — chưa xác minh được"* kèm số dòng lấy được, thay vì im lặng nhận một transcript cụt đuôi. Đường trao tay nằm **ngoài** khái niệm này: nó chỉ ghi clipboard rồi dừng, nên nó không bao giờ tự nhận "Xong" — cái đã vào notebook hay chưa thì bạn là người biết.

---

## Đường trao tay — extension gom link, bạn tự dán

Có những nguồn NotebookLM **tự đọc được**: video YouTube công khai, trang docs mà HTML thô đã
có sẵn thân bài. Với chúng, trích nội dung tại máy rồi dán text là làm thừa — và tốn một lượt
hộp thoại cho **mỗi** link.

Đường trao tay làm phần còn lại: extension gom những link đủ điều kiện vào clipboard rồi **dừng
ở đó**. Bạn bấm *Thêm nguồn* → *Trang web* → `Ctrl+V` một lần cho cả bó. Extension không chèn
hộ, không bấm hộ — đổi lại nó không có gì để hỏng khi Google đổi giao diện.

Bốn chỗ bấm được:

- Trang xem video: nút **Copy link**.
- Thanh nổi khi tick nhiều video: nút **Copy N link**.
- Bảng *Import toàn bộ*: nút **Copy link công khai**.
- Bảng chọn link tài liệu: nút **Copy N link**.

**Ba cửa, và không link nào lên clipboard mà chưa qua cả ba.** Huy hiệu trên thumbnail chỉ được
**loại** (nó nói "private" thì tin, nói "công khai" thì chưa). Sổ đã copy và hàng đợi loại tiếp
những cái trùng. Cửa cuối hỏi thẳng player response của YouTube, và chỉ nó mới được **nhận** —
thiếu dữ liệu, hỏi không được, hay video không phát được đều rơi về hàng đợi chứ không đoán.
Nghĩa là video private và unlisted của bạn **không bao giờ** ra khỏi máy dưới dạng URL, đúng
cam kết ở đầu README; thứ chúng đi vẫn là đường trích transcript cục bộ.

**Trang tài liệu phải qua một cửa đo riêng.** Không suy từ tên bộ tạo docs được, nên extension
tự fetch HTML thô của từng trang đã tick rồi xem thân bài có sẵn trong đó không. Trang trượt cửa
được **nêu tên** và bạn dùng nút *Thêm N trang* như cũ — nội dung trích tại máy. Phép fetch này
**cố ý không mang cookie** (`credentials: 'omit'`), và đó là chuyện đúng/sai chứ không phải cẩn
thận thừa: một trang nội bộ chỉ đọc được khi đã đăng nhập sẽ đo ra "có thân bài" trên máy bạn,
rồi NotebookLM — fetch ẩn danh — nhận về trang đăng nhập và nuốt một nguồn rỗng.

Copy xong, extension **nhảy sang tab notebook đích rồi thôi**. Bản tổng kết — copy được mấy
link, mấy cái rơi về hàng đợi và vì sao — đi kèm cú nhảy dưới dạng **thông báo hệ thống**, chứ
không phải một dòng chữ ở lại cái tab bạn vừa rời khỏi. Chưa đặt notebook đích thì không nhảy,
và lúc đó nó nói ngay tại chỗ thay vì im lặng, vì bạn đang cầm một clipboard mà không biết mang
đi đâu.

**Sổ đã copy** — mỗi link đã ra clipboard được ghi lại kèm thời điểm và chỗ gom được, và lượt
sau sẽ bị loại để bạn không dựng hai nguồn trùng. Sổ nằm trong popup, ngay dưới hàng đợi, gập
lại được, và xoá bằng nút *Xoá sổ* (hai nhịp, vì không hoàn tác được).

Link bị loại vì trùng luôn **hiện ra số, kèm một nút bấm được**: trên YouTube là thẻ *Copy lại
N link* nổi ở góc dưới bên phải, trong bảng chọn link tài liệu là nút *Copy lại N link đã có*
cạnh nút Copy. Nút đó bỏ qua vòng khử trùng — đó đúng là việc bạn vừa yêu cầu — nhưng **không**
bỏ qua cửa cuối: danh sách của nó bị loại *trước* khi ai hỏi player response hay đo HTML thô,
nên nó vẫn phải đi qua đấy. Im lặng bỏ link là đúng lỗi mà extension này sinh ra để chữa, và
một con số không kèm cách bấm cũng chỉ là im lặng có chú thích.

Thứ tự ba cửa cũng là chuyện tiền: cửa cuối tốn **một request cho mỗi link**, hai cửa trước thì
không. Nên khử trùng chạy trước — bấm copy lần thứ hai trên một playlist đã copy hết tốn đúng
**không** lượt hỏi nào.

Cái giá, nói trước: nguồn dán từ link thì máy chủ Google cào **cả trang**, không cào riêng khối
thân bài, nên nguồn sẽ dính cả menu điều hướng. Cửa đo trả lời câu "nguồn có **rỗng** không",
không trả lời câu "nguồn có **sạch** không". Muốn sạch thì dùng đường trích tại máy.

---

## Cơ chế trích transcript

YouTube đã siết `timedtext` trong năm 2026: nhiều caption track giờ có tham số `exp=xpe` trong `baseUrl` và trả về **body rỗng** nếu request thiếu **PoToken** — một chứng chỉ mật mã do chính JS của player sinh ra lúc chạy, không phải cookie. Vì vậy extension thử nhiều đường theo thứ tự:

1. **InnerTube `get_transcript`** — cùng nguồn dữ liệu mà panel "Show transcript" dùng. Chạy được cho *bất kỳ* videoId nào từ một tab YouTube duy nhất, không cần mở trang video.
2. **`timedtext` baseUrl** — nhanh nhất khi không bị chặn PoToken.
3. **Quét DOM panel transcript** — mở đúng trang watch và đọc panel. Đáng tin nhất, vì player thật của YouTube tự sinh PoToken giúp ta.
4. Nếu vẫn hỏng, thử lại lần cuối với tab được kích hoạt (Chrome bóp hiệu năng tab nền nên player đôi khi chưa dựng xong panel).

Xác thực cho video private: `src/youtube/page-bridge.js` chạy ở **MAIN world** từ `document_start`, hook `fetch`/`XHR` và **mượn đúng bộ header `Authorization: SAPISIDHASH …`** mà YouTube tự gửi cho InnerTube. Request của extension nhờ vậy được xác thực y hệt phiên của bạn. Có sẵn đường dự phòng tự ký SAPISIDHASH từ cookie nếu chưa mượn được header nào.

Nội dung nguồn được dựng kèm header ngữ cảnh (tiêu đề, kênh, link gốc, thời lượng, mức riêng tư) và timestamp `[mm:ss]`, để NotebookLM trích dẫn được đúng mốc thời gian trong video.

---

## Cơ chế trích nội dung trang tài liệu

**Dò sidebar** (`src/docs/sidebar.js`) không nhắm vào theme cụ thể nào — mỗi trang docs đặt tên class một kiểu và đổi liên tục. Thay vào đó mọi ứng viên (`nav`, `aside`, `[class*="sidebar"]`…) được *chấm điểm* theo dấu hiệu hành vi: số link cùng site, có lồng `ul` hay không, bề ngang cột, và dấu hiệu mạnh nhất — **có chứa link trỏ về chính trang đang mở**. Khối thắng cuộc được thu hẹp dần xuống khối con nào vẫn giữ đủ link, rồi dựng lại thành cây theo cấu trúc `ul/li`. Sidebar không dùng list thì rơi về xếp phẳng, độ sâu suy từ mức lồng DOM.

Link bị loại: khác host, giao thức lạ, và **neo trong trang** — mục lục "On this page" toàn trỏ về chính trang đang mở, import vào là nhân bản trùng lặp. Ngoại lệ: `#/guide/intro` kiểu docsify được giữ, vì ở đó hash *chính là* đường dẫn trang.

**Trích nội dung** (`src/docs/extract.js`) chạy hai nấc:

1. **`fetch` từ một tab cùng origin** — mặc định. Không tải lại trang nào nên import 80 trang tốn 80 request thay vì 80 lần dựng trang, và vì chạy trong content script nên fetch đi kèm cookie phiên: tài liệu nội bộ cần đăng nhập vẫn đọc được. Đây là đường **trích nội dung**; cửa đo của Đường trao tay là một đường fetch khác hẳn và **cố ý không mang cookie** — xem mục dưới.
2. **Mở tab ẩn đọc DOM đã render** — chỉ khi nấc 1 trả về nội dung mỏng bất thường (`docsMinChars`), dấu hiệu kinh điển của docs render bằng JS.

Nấc 2 chờ **URL khớp rồi nội dung đứng yên** mới chốt. Với docs kiểu docsify, điều hướng `#/a → #/b` không tải lại trang: tab báo `complete` ngay trong khi DOM còn nguyên nội dung trang trước, đọc luôn là gán nhầm nội dung cũ cho URL mới — sai mà nhìn vẫn rất hợp lý.

Phần thân bài được chọn bằng danh sách selector quen thuộc (`.theme-doc-markdown`, `.md-content__inner`, `.markdown-body`, `.rst-content .document`…), hỏng thì chấm điểm: chữ trong `p/li/pre/td/h*` trừ đi chữ nằm trong link. Vì điểm khối cha luôn ≥ khối con, thứ được chọn là khối **sâu nhất** vẫn giữ gần trọn nội dung — chính là ranh giới bài viết ngay dưới lớp bọc layout. Sau đó dọn sidebar, breadcrumb, prev/next, "Edit this page", neo `#` cạnh đề mục — toàn thứ lặp ở mọi trang, để nguyên thì mỗi nguồn đều dính cùng một mớ và NotebookLM bắt đầu trích dẫn nhầm sang menu.

**Sang Markdown** (`src/docs/markdown.js`) chứ không phải `textContent`, vì với docs lập trình thứ đáng giá nhất là khối code và cấp đề mục. Bẫy lớn nhất: Prism-react (Docusaurus) và Shiki dựng **mỗi dòng code thành một phần tử riêng, không có ký tự `\n` nào** — `textContent` trả về cả trăm dòng dính liền thành một dòng khổng lồ. Bộ chuyển vì thế tự dựng lại ngắt dòng theo ranh giới phần tử, bỏ cột số dòng và nút Copy, đoán ngôn ngữ từ `language-*`/`data-lang` để mở fence cho đúng.

---

## Cơ chế đẩy vào NotebookLM

NotebookLM bản consumer **không có API công khai**. Giao diện của nó nói chuyện với backend qua `batchexecute`, với các RPC id mà Google xoay vòng không báo trước. Extension đi được cả hai đường, và mặc định đi đường chậm.

**Đường giao diện** (mặc định): thao tác đúng như người dùng thật — bấm *Thêm nguồn* → chọn loại → điền → bấm *Chèn*, ngay trong tab bạn đã đăng nhập.

**Đường RPC** (tắt sẵn, bật trong Cài đặt): gọi thẳng `batchexecute` từ chính tab đó. Nhanh hơn nhiều. Nó *sẽ* hỏng vào một ngày nào đó — nên nó được viết để hỏng an toàn, và "an toàn" ở đây có nghĩa hẹp hơn "luôn chạy tiếp".

Extension chỉ coi là "đã thêm" khi server trả về một frame mang **đúng RPC id vừa gửi** — đó cũng là cách nó biết Google đã xoay id. Sau đó có ba kết cục, không phải hai:

- **Chắc chắn chưa ghi gì** (id đã lỗi thời, thiếu token, server từ chối trước khi làm) → lượt đó tự rơi xuống đường giao diện, bạn chỉ thấy chậm hơn.
- **Đã ghi xong** → tiếp mục sau.
- **Không biết** (mất mạng giữa chừng, server lỗi, phản hồi không đọc được) → **dừng mục đó và báo bạn tự mở notebook kiểm**. Đây là chủ ý: thêm Nguồn không idempotent, chạy lại đường giao diện cho một request có thể đã tới nơi là để lại một bản trùng phải xoá tay.

> **Cam kết:** extension **không đọc, không lưu cookie nào**. Cả hai đường đều chạy trong tab `notebooklm.google.com` bạn đã đăng nhập, nên trình duyệt tự gắn cookie phiên — `manifest.json` không xin quyền `cookies`.
>
> Đường RPC có đọc token CSRF `at` mà trang tự nhúng sẵn, vì backend từ chối request thiếu nó. Token đó **chỉ đi vào thân request gửi tới chính `notebooklm.google.com`**: không vào bộ nhớ extension, không vào log, không vào bản chụp gỡ lỗi (bản chụp chỉ ghi *có tìm thấy hay không* và tên khoá chứa nó), và không ra khỏi origin đó.

Vài chi tiết đáng lưu ý trong `src/notebooklm/automation.js`:

- Khớp phần tử theo **chữ hiển thị đã bỏ dấu** (`aria-label` / `textContent`), nên vẫn chạy khi class name đổi, và hoạt động với cả giao diện tiếng Anh lẫn tiếng Việt.
- Khớp chính xác được duyệt theo *thứ tự ưu tiên của mảng nhãn*, để `"add source"` luôn thắng `"add"`. Nhãn ngắn dưới 4 ký tự không tham gia khớp mờ.
- Gán giá trị ô nhập qua **native value setter** rồi mới phát event — gán thẳng `el.value` không kích hoạt được value accessor của Angular.
- Phát đủ `pointerdown → mousedown → pointerup → mouseup → click`; Angular Material không phản ứng với mỗi `click`.
- Nhận diện lỗi **chỉ đọc các phần tử chuyên báo lỗi** (`mat-error`, `[role="alert"]`…). Cố tình không quét toàn bộ chữ trong hộp thoại — NotebookLM hiển thị những dòng bình thường như bộ đếm *"Source limit 3/50"*, quét cả cụm sẽ báo lỗi giả và huỷ oan một lần import đang chạy tốt.
- Hộp thoại đóng chưa chắc là xong: extension chờ thêm ~1,2s để bắt lỗi hiện muộn ở snackbar.

### Kỷ luật định tuyến tin nhắn

Extension có ba content script và chúng **có thể gặp nhau trên cùng một tab**. `exclude_matches` trong manifest chỉ chi phối lúc Chrome tự tiêm — nó **không** chặn `chrome.scripting.executeScript`, mà extension dùng để phục vụ tab đã mở từ trước khi cài.

Khi hai listener cùng nghe, Chrome lấy **phản hồi đến trước**. Một script trả lời "lệnh lạ" cho ping của script kia là đủ để mọi thứ sau đó chết bằng một lỗi trỏ sai hẳn chỗ, và kéo dài tới khi tab được tải lại. Chuyện này đã xảy ra thật.

Ba lớp phòng thủ, và một test canh cả ba:

1. Mỗi listener lọc `HANDLED.has(message.type)` rồi **im lặng** với tin không phải của mình — không trả `{ok:false}`, vì trả lời sai còn tệ hơn không trả lời.
2. `openDocsPanel()` từ chối chạy trên youtube.com và notebooklm.google.com.
3. `ensureScripts()` chỉ tin phản hồi có `ok: true`, không tin "có phản hồi".

Thêm `case` mới thì **phải** thêm vào `HANDLED` — quên là `test/messaging.test.js` đỏ ngay và in ra tên loại tin thiếu.

### Ba lỗi mà chỉ trang thật mới lộ ra

Đường quét DOM từng hỏng hoàn toàn, và cả ba nguyên nhân đều vô hình với test tĩnh. Chạy lại bằng `node tools/verify-live.mjs`:

1. **Bấm nhầm nút của chính mình.** `findTranscriptButton()` quét mọi `<button>` khớp `/transcript/i`, mà extension lại tự thêm nút nhãn "Transcript" đứng đầu hàng nút → nó bấm vào chính nó.
2. **Selector trỏ vào layout đã chết.** YouTube đã thay panel transcript: không còn `ytd-transcript-renderer` / `ytd-transcript-segment-renderer`, giờ là engagement panel `PAmodern_transcript_view` chứa `transcript-segment-view-model`. Bên trong có một div nhãn trợ năng ("1 second") — lấy `innerText` cả dòng là nuốt luôn chuỗi đó vào giữa transcript.
3. **`el.click()` không mở được panel.** Phải phát đủ chuỗi `pointerdown → mousedown → pointerup → mouseup → click`, và phải nhắm **phần tử bấm được trong cùng** — `querySelectorAll` trả theo thứ tự DOM nên wrapper `ytd-button-renderer` luôn đứng trước `<button>` thật, mà bấm wrapper thì YouTube không phản hồi.

Thêm một điều kiện môi trường: **cửa sổ phải đủ rộng.** Panel transcript nằm ở cột phải; ở layout hẹp YouTube giữ nó ở trạng thái `ENGAGEMENT_PANEL_VISIBILITY_HIDDEN` và không có gì để quét.

### Giao diện của extension phải tách khỏi giao diện của trang

Extension vừa **chèn** nút vào trang, vừa **dò tìm** nút của trang. Hai việc đó đá nhau: `findTranscriptButton()` quét mọi `<button>` khớp `/transcript/i`, mà extension lại tự thêm một nút nhãn "Transcript" đứng ngay đầu hàng nút — nên nó bấm vào chính nó, panel YouTube không bao giờ mở, và phương án DOM chết câm với thông báo đổ lỗi cho YouTube.

Hai bất biến, có `test/ui-isolation.test.js` canh:

- Mọi id do extension tạo phải mang tiền tố `nblm-` — selector loại trừ dùng `[id^="nblm-"]`, id lạc quy ước là lọt lưới ngay mà không có triệu chứng.
- Mọi hàm dò tìm phần tử của trang phải lọc bỏ `OWN_UI` trước.

Quy tắc chung: **hễ dò tìm phần tử theo chữ hiển thị thì phải loại trừ giao diện của chính mình trước.**

### Khi Google đổi giao diện

Đây là điểm dễ vỡ nhất, nên **toàn bộ nhãn và selector gom vào một file** (`src/notebooklm/selectors.js`) và ghi đè được từ trang Cài đặt mà không cần sửa code:

```json
{
  "addSource": ["them nguon moi"],
  "pasteChip": ["van ban thuan"],
  "submit": ["luu"]
}
```

Nhãn viết thường, **không dấu**. Các mảng được *gộp thêm* vào mặc định chứ không thay thế, và nhãn bạn thêm được ưu tiên trước.

Nhãn phải trùng **trọn vẹn** chữ trên nút, không phải một mẩu của nó: nút ghi "Lưu nguồn" thì viết `"submit": ["luu nguon"]`, viết `["luu"]` sẽ không khớp. Khớp một-phần từng được hỗ trợ và đã bị gỡ — nó khiến extension bấm nhầm nút "Tải tệp lên" (chữ `upload` của icon font lọt vào phép so khớp) và dán transcript vào ô "Khám phá nguồn". Chữ của `<mat-icon>` và chữ chỉ dành cho trình đọc màn hình đều không tính; cứ lấy đúng chữ bạn nhìn thấy trên nút.

---

## Tải transcript hàng loạt nhanh hơn — `tools/`

Với video private, extension buộc phải mở thật một trang watch cho từng video (~15–20 giây/video), vì hai đường API của YouTube đều bị chặn. Nếu chỉ cần **file transcript** chứ không cần đẩy vào NotebookLM, có đường nhanh hơn nhiều dựa trên `yt-dlp`:

```bash
uv tool install yt-dlp --with secretstorage
bash tools/fetch-transcripts.sh
node tools/subs-to-md.mjs "$HOME/Downloads/Transcript YouTube" both
```

Đo thực tế trên 89 video private: **9 phút, 0 lỗi** — nhanh gấp khoảng ba lần, và chạy được cả khi trình duyệt đang đóng.

Xem [`tools/README.md`](tools/README.md) để biết cách dùng, ba cái bẫy làm hỏng câm (cookie không giải mã được, `Requested format is not available`, phụ đề tự động cuộn lặp), và ghi chú bảo mật.

---

## Cấu trúc

```
manifest.json
src/
├── common/shared.js              hằng số, storage, dựng nội dung nguồn (đã có test)
├── background/service-worker.js  điều phối hàng đợi, quản lý tab, menu chuột phải
├── youtube/
│   ├── page-bridge.js            MAIN world — ytcfg, InnerTube, mượn header xác thực
│   ├── bridge-client.js          bọc postMessage thành Promise
│   ├── transcript.js             chuỗi phương án + quét DOM panel
│   ├── srt.js                    transcript → txt/srt/vtt/md (đã có test)
│   ├── panel.js                  panel xem/tìm/tải transcript trên trang watch
│   └── content.js                nút trên trang watch, chọn hàng loạt, import toàn bộ
├── docs/
│   ├── markdown.js               HTML → Markdown, giữ nguyên khối code (đã có test)
│   ├── extract.js                chọn phần thân bài + dọn rác điều hướng
│   ├── sidebar.js                chấm điểm dò sidebar, dựng lại thành cây
│   ├── content.js                bảng chọn link (shadow DOM) + công nhân trích
│   └── overlay.css               giao diện bảng chọn
└── notebooklm/
    ├── selectors.js              MỌI thứ dễ vỡ nằm ở đây
    ├── automation.js             thao tác giao diện
    └── content.js                nhận lệnh + chỉ báo tiến độ

tools/                            chạy ngoài extension — xem tools/README.md
├── fetch-transcripts.sh          tải transcript hàng loạt qua yt-dlp (nhanh gấp ~3 lần)
├── subs-to-md.mjs                .vtt/.srt → .md + .txt, gộp phụ đề cuộn lặp
├── txt-to-md.mjs                 .txt do extension tải → .md, dò metadata từ storage
├── videos.txt                    danh sách videoId đầu vào
├── verify-live.mjs               chạy transcript.js trên trang YouTube thật
├── verify-docs.mjs               kiểm trích nội dung trên 4 bộ tạo docs
└── probe-sidebar.mjs             dump điểm chấm sidebar khi dò sai
```

---

## Giới hạn cần biết

- **Video không có phụ đề nào** (kể cả tự động) thì không trích được gì. YouTube thường chưa sinh phụ đề tự động cho video mới upload, và không sinh cho video không có tiếng nói. Bật/tải phụ đề trong YouTube Studio rồi thử lại.
- Nguồn dán tay vào NotebookLM là **ảnh chụp tại một thời điểm**. Nếu bạn sửa video, phải import lại. Nguồn dạng link thì NotebookLM tự quản.
- Giới hạn NotebookLM: **300 nguồn/notebook** (đo thật trên hộp thoại thêm nguồn 2026-08-23: `1/300`), tối đa 500.000 từ mỗi nguồn. Khi chạm giới hạn, extension dừng hàng đợi và báo lại thay vì cắm đầu chạy tiếp.
- Video đã import xong vẫn nằm trong hàng đợi để chống trùng lặp. Muốn import lại cùng một video, bấm **Xoá xong** trước.
- Tự động hoá dựa trên DOM sẽ hỏng khi Google đổi giao diện. Đó là lý do có phần ghi đè selector ở trên.
- **Mỗi trang tài liệu là một nguồn riêng.** Trích dẫn của NotebookLM nhờ vậy chỉ đúng tên trang, nhưng docs vài trăm trang sẽ ăn hết quota 300 nguồn trước khi import xong — chọn nhánh cần thiết trong bảng chọn thay vì tick *Chọn hết*.
- Bảng chọn chỉ thấy **những gì sidebar đang hiện**. Sidebar thu gọn theo mục đang mở (khá phổ biến) thì phần chưa bung ra sẽ không có trong danh sách; bung mục đó ra rồi mở lại bảng.
- Extension chỉ đi theo link **cùng host**. Docs trỏ sang subdomain khác (`api.example.com`) phải import riêng từ chính trang đó.
- Nguồn dán tay là ảnh chụp tại một thời điểm — tài liệu cập nhật thì phải import lại.
- **Đường trao tay chỉ ghi clipboard.** Nó không mở hộp thoại và không bấm hộ, nên nó cũng không biết bạn đã dán hay chưa — Sổ đã copy ghi "đã copy", không ghi "đã vào notebook".

---

## Mức độ đã kiểm chứng

Sòng phẳng về chuyện này:

- **Đã chạy test:** 1199 test (`bash test/run.sh`) — trong đó 301 test chạy trên DOM thật của hộp thoại "Thêm nguồn" đã chụp lại (`test/fixtures/`, dựng bằng jsdom), và 152 test nạp chính content script của YouTube và của trang tài liệu vào jsdom để kiểm cú bấm nào gửi tin gì. Phần còn lại kiểm các hàm thuần: bóc videoId (mọi định dạng URL), khử trùng lặp danh sách, bỏ dấu tiếng Việt, gộp transcript theo mốc thời gian, dựng nội dung nguồn, gộp override selector, chuẩn hoá URL tài liệu (kể cả phân biệt hash-route với neo trong trang), cắt nguồn quá dài, và bộ chuyển định dạng transcript (chỗ đáng ngờ nhất là suy ra mốc kết thúc cho SRT khi nguồn chỉ cho mốc bắt đầu). Cộng hai test soát tính toàn vẹn: manifest (mọi đường dẫn tồn tại, không file JS nào mồ côi, thứ tự nạp đúng chuỗi phụ thuộc, và **cả 3 mảng `SCRIPTS.*` trong service worker khớp từng dòng với `content_scripts`** — ràng buộc này đã sập một lần, comment ở hai đầu là chưa đủ) và cấu hình (mọi setting trong `DEFAULTS` đều có ô nhập, mọi id popup.js tham chiếu đều tồn tại trong HTML).

  Cộng một test thứ ba về **kỷ luật định tuyến tin nhắn** (xem dưới).

  Cả ba test toàn vẹn đều đã được kiểm tra ngược bằng cách cố tình phá — xoá một file khỏi `SCRIPTS`, đảo thứ tự hai file, xoá `css` của một kind, thêm `case` mà quên khai vào `HANDLED`, cho hai content script cùng nhận một loại tin, bỏ `ok: true` khỏi handler ping — mỗi lần đều đỏ đúng chỗ và in ra chi tiết lệch. Một trong các test lúc đầu **xanh nhầm** (cửa sổ quét trượt sang `case` kế bên và bắt nhầm `ok: true` của nó); nếu không thử phá thì đã không phát hiện.
- **Đã chạy trên trang YouTube thật:** `node tools/verify-live.mjs [videoId]` nạp thẳng mã nguồn `transcript.js` vào một trang YouTube thật rồi chạy `fromPanel()`. Không cần đăng nhập, không cần Chrome nạp được extension. Đã xác nhận lấy đúng transcript trên hai video (24 và 32 dòng, timestamp chuẩn, không nuốt nhãn trợ năng). Chính script này đã bắt được ba lỗi thật — xem "Ba lỗi mà chỉ trang thật mới lộ ra" ở trên.
- **Đã chạy trên trang tài liệu thật:** `node tools/verify-docs.mjs [url…]` nạp `markdown.js` / `extract.js` / `sidebar.js` vào trang thật rồi chạy đúng như extension chạy. Mặc định quét 4 bộ tạo docs dựng HTML khác hẳn nhau — **Docusaurus, MkDocs Material, VitePress, Sphinx+RTD** — và kiểm: dò được sidebar, không lọt link khác site hay neo trong trang, chọn đúng khối thân bài (không rơi về `fallback`), không nuốt mất nội dung, giữ đề mục, **khối code không bị dính thành một dòng**, và tên mục sidebar không rớt vào thân bài. Kèm `tools/probe-sidebar.mjs` để xem `rate()` chấm điểm những khối nào khi dò sai.

  **103 khối code trên 4 trang đều ra fence nhiều dòng đúng** — giả thuyết trung tâm của `markdown.js` (Prism/Shiki dựng mỗi dòng thành một phần tử riêng, không có ký tự `\n` nào) giữ được trên thực tế.

  Chính script này bắt được **hai lỗi thật** trong `sidebar.js` — xem mục dưới.
- **Đường trao tay — đã test, và có ba chỗ chưa đo.** Ba cửa lọc link, thứ tự ghi clipboard rồi mới ghi Sổ, cửa đo HTML thô, và cú nhảy sang tab notebook đều có test chạy trên mã thật. **Chưa đo được ở đây**, vì cần một Chrome đã đăng nhập: (1) `Alt+Shift+Y` có còn ghi được clipboard sau khi vòng qua service worker không — đường code đã tự rơi về hàng đợi nếu không, nhưng chưa ai thấy nó xảy ra thật; (2) NotebookLM nhận tối đa bao nhiêu URL một lần dán; (3) hai hằng số điều tiết nhịp hỏi YouTube (4 lượt song song, ngắt sau 3 lần hỏng liên tiếp) là **chọn theo suy đoán**, chưa đo trên ngưỡng rate-limit thật.
- **Chưa chạy được ở đây:** luồng end-to-end thật — trích transcript từ một video private, quét playlist qua InnerTube, và thao tác giao diện NotebookLM. Tất cả đều cần một trình duyệt đã đăng nhập, môi trường này không có.
- **Không có test tự động:** `page-bridge.js` chạy trong ngữ cảnh trang (hook `fetch`, đọc `ytcfg`) nên không require được vào node — phần liệt kê playlist và `pageContext()` mới chỉ được soát bằng mắt và kiểm tra cú pháp.

### Hai lỗi mà chỉ trang tài liệu thật mới lộ ra

Cả hai nằm trong `build()` của `sidebar.js`, và cả hai đều **im lặng**: bảng chọn vẫn mở ra, vẫn có link, chỉ là thiếu — không có cách nào nhận ra nếu không đối chiếu với trang thật.

1. **Ngưỡng tin đường `<ul>` quá yếu.** VitePress dựng sidebar bằng `<div>` lồng nhau, không dùng `<ul>` — nhưng trong container vẫn lẫn một `<ul>` nhỏ. Điều kiện cũ *"cây dựng được có ≥3 link là xong"* vì thế trả về cây tí hon **5 link và bỏ sót 12 link còn lại**. Giờ chỉ tin đường `<ul>` khi nó gom được ≥80% số link thật trong container, không đủ thì rơi về lối xếp phẳng.
2. **Sổ "đã nhận" bị tái dùng.** `claim()` chỉ cho mỗi URL xuất hiện một lần. Lượt dựng theo `<ul>` đã nhận mất một phần link, rồi lối xếp phẳng dùng lại đúng ctx đó nên **mất sạch chính những link vừa nhận**. Giờ mỗi lượt dựng có sổ riêng.

Sau khi sửa, VitePress đi từ 5 → **17 link**, đúng số link thật trong sidebar.

Một giới hạn đã xác minh chứ không phải suy đoán: `docs.python.org` (Sphinx thuần) có sidebar chỉ chứa **mục lục trong trang** — toàn neo `#…` trỏ về chính trang đang mở. Extension lọc đúng nên chỉ còn 3 link điều hướng thật. Không phải lỗi, nhưng bảng chọn gần như vô dụng ở đó; bản Sphinx dùng theme ReadTheDocs (`.wy-nav-side`) thì bình thường.

Các selector NotebookLM dựng theo giao diện đã biết tính tới thời điểm này. Nếu lần chạy đầu báo *"Không tìm thấy nút Thêm nguồn"*, mở hộp thoại thêm nguồn, xem nút đang ghi chữ gì, rồi thêm vào phần ghi đè trong Cài đặt — thường là sửa một dòng.

Gỡ lỗi trong DevTools console của tab NotebookLM:

```js
NBLM_AUTOMATION._internals.selectors          // bộ selector đang dùng
NBLM_AUTOMATION._internals.openDialog()       // hộp thoại có được nhận diện không
NBLM_AUTOMATION.addUrlSource('https://…')     // chạy thử một lần
```

Gỡ lỗi trong console của tab tài liệu:

```js
NBLM_DOCS_SIDEBAR.detect()                    // dò được sidebar nào, bao nhiêu link
NBLM_DOCS_EXTRACT.pickRoot(document, 600)     // khối nào được coi là thân bài
NBLM_DOCS_EXTRACT.fromLive({}).markdown       // xem đúng thứ sẽ dán vào NotebookLM
```
# notebooklm
# notebooklm
