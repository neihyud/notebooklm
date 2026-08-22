# YouTube & Tài liệu → NotebookLM Importer

Chrome extension (Manifest V3) đẩy nhanh **video YouTube** và **trang tài liệu lập trình** vào NotebookLM — bao gồm cả video private do bạn sở hữu (không phải chuyển sang public) và docs mà NotebookLM nuốt link vào thì ra nguồn rỗng.

> **Trạng thái: có code, chạy được một phần, chưa import thật lần nào.**
>
> 18/20 ticket đã nghiệm thu. Suite: `bash test/run.sh` → xanh, **771 test / 25 file**. Ngoài ra
> có hai cổng chạy trên **Chrome thật** (`tools/verify-live.mjs`, `tools/verify-docs.mjs`) — chúng
> nạp chính extension này vào Google Chrome for Testing 151 và chạy trên trang công khai thật.
>
> Đo trên trang thật, 2026-08-22:
>
> | Đường | Trạng thái |
> |---|---|
> | Trích transcript qua panel DOM | **chạy** — 3 và 24 segment trên hai video thử |
> | Trích transcript qua InnerTube `get_panel` | **chạy** — cùng số segment và trùng 100% chữ với đường DOM trên cả hai video thử |
> | Trích transcript qua InnerTube `get_transcript` | **chết** — HTTP 400 kể cả với `params` do chính YouTube đúc. Đã thay bằng `get_panel` ([ADR 0013](docs/adr/)) |
> | Trích transcript qua `timedtext` | **bị khoá** — HTTP 200 với 0 byte; PoToken, không phải xác thực |
> | Trích nội dung trang tài liệu | **chạy** trên Docusaurus, MkDocs Material, VitePress, Sphinx+RTD |
> | Dò cây Nhánh của sidebar | **chạy** trên cả bốn — MkDocs Material 8 Nhánh, VitePress 5 Nhánh (ticket 018). Sphinx+RTD vẫn phẳng: trang đo chỉ mở nhánh của trang đang đọc |
> | Đẩy nguồn vào NotebookLM | **chưa chạy lần nào** — cần phiên đăng nhập của bạn, và không thứ tự động nào được phép làm việc đó (ticket 015) |
>
> Chỗ nào README nói ngược ADR thì [`docs/adr/`](docs/adr/) thắng.

---

## Vấn đề, và cách extension giải quyết

NotebookLM chỉ nhận **video public có phụ đề**. Lý do mang tính kỹ thuật chứ không phải chính sách tuỳ tiện: khi bạn dán một link YouTube, **máy chủ Google đi tải video đó, không kèm phiên đăng nhập của bạn**. Video private của bạn với máy chủ ấy cũng chỉ là một video không có quyền xem. Không có mẹo nào ở phía URL sửa được chuyện này.

Vậy nên extension đổi hướng: **transcript được trích ngay trong trình duyệt của bạn** — nơi bạn đã đăng nhập và thực sự có quyền — rồi dán vào notebook dưới dạng nguồn *"Copied text"*.

| Mức riêng tư | Cách đưa vào NotebookLM | Ghi chú |
|---|---|---|
| **Private** | Luôn trích transcript cục bộ rồi dán text | Không bao giờ gửi URL cho NotebookLM |
| **Unlisted** | Thử đưa link trước → hỏng thì trích transcript | Đổi được trong Cài đặt |
| **Public** | Đưa link (NotebookLM tự lấy transcript) → hỏng thì trích cục bộ | Nhanh nhất |

*Trích transcript* bằng đường nào lại là chuyện khác, cũng phụ thuộc mức riêng tư — xem [Cơ chế trích transcript](#cơ-chế-trích-transcript).

> **Cam kết:** extension không có, và không cần, bất kỳ khả năng nào để thay đổi chế độ hiển thị video. Nó không đụng tới YouTube Studio, không gọi API cập nhật video. Toàn bộ quyền được cấp trong `manifest.json` là đọc trang và thao tác giao diện.

### Trang tài liệu hỏng vì cùng một lý do

Dán link docs vào NotebookLM rất hay ra một nguồn **trống trơn hoặc chỉ có mỗi menu**. Cũng không phải chính sách: máy chủ Google fetch cái URL đó và **không chạy JavaScript**. Docusaurus, GitBook, docsify, VitePress… dựng thân bài ở phía client, nên thứ máy chủ nhận về chỉ là cái khung. Trang có SSR thì đỡ hơn, nhưng nguồn vẫn dính nguyên sidebar và footer lặp ở mọi trang.

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
4. Mở notebook đích trên `notebooklm.google.com` (hoặc `notebook.google.com` — xem dưới), rồi bấm icon extension → **"Dùng notebook ở tab hiện tại"**

Yêu cầu: Chrome 111+ (dùng content script `world: "MAIN"`), và bạn đang đăng nhập Google trong chính trình duyệt đó. Extension cố ý không phát hành lên Chrome Web Store — [ADR 0001](docs/adr/0001-chi-phan-phoi-load-unpacked.md) giải thích vì sao, và điều đó ràng buộc phần lớn thiết kế phía sau.

---

## Cách dùng

**Một video** — vào trang xem video, bấm nút **NotebookLM** cạnh nút Like/Share. Hoặc phím tắt `Alt+Shift+Y`.

**Nhiều video cùng lúc** — trên trang playlist / kênh / kết quả tìm kiếm / Watch Later, mỗi thumbnail có một checkbox ở góc trái. Chọn xong bấm **Import vào NotebookLM** ở thanh nổi dưới màn hình.

**Toàn bộ playlist hoặc kênh** — trên trang playlist / kênh, thanh nổi có nút **Import toàn bộ**. Nút này *không* đọc DOM: nó gọi thẳng API nội bộ của YouTube và phân trang tới hết, nên lấy đủ playlist vài trăm video bất kể bạn đã cuộn tới đâu. Cả playlist gộp thành ít nguồn nhất có thể thay vì mỗi video một nguồn — quota chỉ có 50 nguồn mỗi notebook. Trước khi chạy sẽ hiện bảng xác nhận: bao nhiêu video, bao nhiêu cái là private của bạn, bao nhiêu cái bị bỏ vì không có quyền xem, và **ước lượng sẽ tốn bao nhiêu nguồn** — không có con số đó thì bạn sẽ chạm trần giữa chừng mà không hiểu vì sao. Áp dụng được cho cả **Xem sau** (`WL`) và **Video đã thích** (`LL`).

**Gom từ nhiều tab / cả trang** — trong popup: *Mọi tab YouTube đang mở*, hoặc *Mọi link YouTube trên trang này* (chạy được trên trang bất kỳ, không riêng YouTube — hữu ích khi quét một bài blog đầy link video).

**Xem / tải transcript** — nút **Transcript** cạnh nút NotebookLM mở panel bên phải: có ô tìm kiếm (bỏ dấu vẫn khớp), bấm timestamp là video nhảy tới đúng đoạn, sao chép, và tải về `.md` / `.srt` / `.vtt`. Chạy được với cả video private của bạn, vì dùng chung đúng cơ chế trích ở trên.

**Bản lưu transcript** — mọi transcript trích xong đều được ghi ra file **trước khi** thử đẩy vào NotebookLM, mặc định, không phải bật. Một chế độ phải nhớ chọn trước khi chạy thì không cứu được gì: lúc biết là cần tới nó thì transcript đã mất rồi. Popup vẫn có nút **Tải transcript** để chạy hết hàng đợi mà không đụng tới NotebookLM, cho khi bạn chỉ cần file ngay từ đầu (không cần mở notebook, không cần đăng nhập NotebookLM). Định dạng `.md` / `.srt` / `.vtt` và thư mục đích đặt trong Cài đặt; file được đánh số thứ tự cho dễ sắp ([ADR 0011](docs/adr/0011-che-do-chi-tai-ve.md)).

**Dán danh sách link** — mở popup, dán vào ô, bấm *Thêm vào hàng đợi*.

**Chuột phải** — trên một link YouTube bất kỳ, hoặc bôi đen một đoạn text chứa nhiều link.

**Trang tài liệu** — mở trang docs bất kỳ. Extension dò sidebar và hiện nút nổi **→ NotebookLM · N trang** ở góc dưới bên phải; bấm vào để mở bảng chọn. Bảng dựng lại đúng cây mục lục của sidebar, có ô lọc, tick theo nhánh (tick mục cha là chọn cả nhánh con), rồi bấm *Thêm N trang*. Không thấy nút thì gọi bằng phím tắt `Alt+Shift+D`, popup, hoặc chuột phải → *Chọn link tài liệu…*.

Video và tài liệu có **hai hàng đợi riêng**, chạy song song ở khâu trích — một video private tốn 15–20 giây còn một trang tài liệu tốn một request, xếp chung thì phần rẻ trả giá cho phần đắt. Khâu đẩy vào NotebookLM thì hai hàng xếp lượt, vì chỉ có một hộp thoại thêm nguồn. Cả hai lưu bền qua các lần khởi động lại, và xem/dừng/thử-lại được từ popup ([ADR 0007](docs/adr/0007-hai-hang-doi.md)).

---

## Cơ chế trích transcript

YouTube đã siết `timedtext` trong năm 2026: nhiều caption track giờ có tham số `exp=xpe` trong `baseUrl` và trả về **body rỗng** nếu request thiếu **PoToken** — một chứng chỉ mật mã do chính JS của player sinh ra lúc chạy, không phải cookie. Điểm dễ hiểu sai: **PoToken không phải cơ chế xác thực, nó là cơ chế chứng minh nguồn gốc.** `timedtext` có `exp=xpe` trả về body rỗng kèm HTTP 200 cho *mọi* request lập trình — kể cả request mang cookie hợp lệ của phiên đã đăng nhập. Cookie trả lời "bạn là ai"; PoToken hỏi một câu khác hẳn: "bạn có phải player thật đang chạy không". Vì vậy extension **định tuyến theo mức riêng tư** thay vì thử tuần tự, vì mức riêng tư đã biết trước khi trích:

| Mức riêng tư | Đường đi |
|---|---|
| **Private** | Thẳng tới quét DOM panel — mở trang watch, để player thật của YouTube tự sinh PoToken. Không thử hai đường API, chúng hỏng vì lý do cấu trúc chứ không phải trục trặc nhất thời. |
| **Unlisted / public** | **InnerTube `get_panel`** trước (chạy được cho bất kỳ videoId nào từ một tab YouTube duy nhất, không cần mở trang video), rồi mới quét DOM. |

Hai đường API cũ đã chết, và cái chết của chúng được **đo trên trang thật** chứ không suy ra:
`get_transcript` trả HTTP 400 `FAILED_PRECONDITION` với *mọi* biến thể params — kể cả chuỗi do
chính YouTube đúc, nên không phải lỗi mã hoá — trong khi `/next` cùng phiên vẫn 200. `timedtext`
trả HTTP 200 với 0 byte. Giao diện YouTube giờ gọi `get_panel`, nên extension gọi theo
([ADR 0013](docs/adr/)).

Đường DOM còn một lần thử lại với tab được kích hoạt, vì Chrome bóp hiệu năng tab nền nên player đôi khi chưa dựng xong panel. Nó cũng đòi cửa sổ đủ rộng: ở layout hẹp YouTube giữ panel ở trạng thái `ENGAGEMENT_PANEL_VISIBILITY_HIDDEN` và không có gì để quét.

`src/youtube/page-bridge.js` chạy ở **MAIN world** từ `document_start`, hook `fetch`/`XHR` và **mượn đúng bộ header `Authorization: SAPISIDHASH …`** mà YouTube tự gửi cho InnerTube — nhưng để **liệt kê playlist**, nơi cần thấy được cả video private của bạn, chứ không phải để lấy transcript của chúng. Hai mục đích đó dễ bị lẫn làm một ([ADR 0003](docs/adr/0003-dinh-tuyen-theo-muc-rieng-tu.md)).

Nội dung nguồn được dựng kèm header ngữ cảnh (tiêu đề, kênh, link gốc, thời lượng, mức riêng tư) và timestamp `[mm:ss]`, để NotebookLM trích dẫn được đúng mốc thời gian trong video.

---

## Cơ chế trích nội dung trang tài liệu

**Dò sidebar** (`src/docs/sidebar.js`) không nhắm vào theme cụ thể nào — mỗi trang docs đặt tên class một kiểu và đổi liên tục. Thay vào đó mọi ứng viên (`nav`, `aside`, `[class*="sidebar"]`…) được *chấm điểm* theo dấu hiệu hành vi: số link cùng site, có lồng `ul` hay không, bề ngang cột, và dấu hiệu mạnh nhất — **có chứa link trỏ về chính trang đang mở**. Khối thắng cuộc được thu hẹp dần xuống khối con nào vẫn giữ đủ link, rồi dựng lại thành cây theo cấu trúc `ul/li`. Sidebar không dùng list thì rơi về xếp phẳng, độ sâu suy từ mức lồng DOM.

Link bị loại: khác host, giao thức lạ, và **neo trong trang** — mục lục "On this page" toàn trỏ về chính trang đang mở, import vào là nhân bản trùng lặp. Ngoại lệ: `#/guide/intro` kiểu docsify được giữ, vì ở đó hash *chính là* đường dẫn trang.

**Trích nội dung** (`src/docs/extract.js`) chạy hai nấc:

1. **`fetch` từ một tab cùng origin** — mặc định. Không tải lại trang nào nên import 80 trang tốn 80 request thay vì 80 lần dựng trang, và vì chạy trong content script nên fetch đi kèm cookie phiên: tài liệu nội bộ cần đăng nhập vẫn đọc được.
2. **Mở tab ẩn đọc DOM đã render** — chỉ khi nấc 1 trả về nội dung mỏng bất thường (`docsMinChars`), dấu hiệu kinh điển của docs render bằng JS.

Nấc 2 chờ **URL khớp rồi nội dung đứng yên** mới chốt. Với docs kiểu docsify, điều hướng `#/a → #/b` không tải lại trang: tab báo `complete` ngay trong khi DOM còn nguyên nội dung trang trước, đọc luôn là gán nhầm nội dung cũ cho URL mới — sai mà nhìn vẫn rất hợp lý.

Phần thân bài được chọn bằng danh sách selector quen thuộc (`.theme-doc-markdown`, `.md-content__inner`, `.markdown-body`, `.rst-content .document`…), hỏng thì chấm điểm: chữ trong `p/li/pre/td/h*` trừ đi chữ nằm trong link. Vì điểm khối cha luôn ≥ khối con, thứ được chọn là khối **sâu nhất** vẫn giữ gần trọn nội dung — chính là ranh giới bài viết ngay dưới lớp bọc layout. Sau đó dọn sidebar, breadcrumb, prev/next, "Edit this page", neo `#` cạnh đề mục — toàn thứ lặp ở mọi trang, để nguyên thì mỗi nguồn đều dính cùng một mớ và NotebookLM bắt đầu trích dẫn nhầm sang menu.

**Sang Markdown** (`src/docs/markdown.js`) chứ không phải `textContent`, vì với docs lập trình thứ đáng giá nhất là khối code và cấp đề mục. Bẫy lớn nhất: Prism-react (Docusaurus) và Shiki dựng **mỗi dòng code thành một phần tử riêng, không có ký tự `\n` nào** — `textContent` trả về cả trăm dòng dính liền thành một dòng khổng lồ. Bộ chuyển vì thế tự dựng lại ngắt dòng theo ranh giới phần tử, bỏ cột số dòng và nút Copy, đoán ngôn ngữ từ `language-*`/`data-lang` để mở fence cho đúng.

---

## Cơ chế đẩy vào NotebookLM

NotebookLM bản consumer **không có API công khai**. Giao diện của nó nói chuyện với backend qua `batchexecute` với các RPC id mà Google xoay vòng không báo trước — bám vào đó là bảo đảm sẽ hỏng.

Extension vì thế thao tác đúng như người dùng thật: bấm *Thêm nguồn* → chọn loại → điền → bấm *Chèn*, ngay trong tab bạn đã đăng nhập. Không đọc, không lưu, không gửi đi cookie hay token nào.

Vài chi tiết đáng lưu ý trong `src/notebooklm/automation.js`:

- Khớp phần tử theo **chữ hiển thị đã bỏ dấu** (`aria-label` / `textContent`), nên vẫn chạy khi class name đổi, và hoạt động với cả giao diện tiếng Anh lẫn tiếng Việt.
- Khớp chính xác được duyệt theo *thứ tự ưu tiên của mảng nhãn*, để `"add source"` luôn thắng `"add"`. Nhãn ngắn dưới 4 ký tự không tham gia khớp mờ.
- Gán giá trị ô nhập qua **native value setter** rồi mới phát event — gán thẳng `el.value` không kích hoạt được value accessor của Angular.
- Phát đủ `pointerdown → mousedown → pointerup → mouseup → click`; Angular Material không phản ứng với mỗi `click`.
- Nhận diện lỗi **chỉ đọc các phần tử chuyên báo lỗi** (`mat-error`, `[role="alert"]`…). Cố tình không quét toàn bộ chữ trong hộp thoại — NotebookLM hiển thị những dòng bình thường như bộ đếm *"Source limit 3/50"*, quét cả cụm sẽ báo lỗi giả và huỷ oan một lần import đang chạy tốt.
- Hộp thoại đóng chưa chắc là xong: extension chờ thêm ~1,2s để bắt lỗi hiện muộn ở snackbar.

### Kỷ luật định tuyến tin nhắn

Extension có ba content script và chúng **có thể gặp nhau trên cùng một tab**. `exclude_matches` trong manifest chỉ chi phối lúc Chrome tự tiêm — nó **không** chặn `chrome.scripting.executeScript`, mà extension dùng để phục vụ tab đã mở từ trước khi cài.

Khi hai listener cùng nghe, Chrome lấy **phản hồi đến trước**. Một script trả lời "lệnh lạ" cho ping của script kia là đủ để mọi thứ sau đó chết bằng một lỗi trỏ sai hẳn chỗ, và kéo dài tới khi tab được tải lại.

Bốn lớp phòng thủ, `test/routing.test.js` canh cả bốn:

1. Mỗi listener khai trước tập loại tin nó nhận (`ACCEPTS` trong `src/common/messages.js`) rồi **im lặng** với tin không phải của mình — không trả `{ok:false}`, vì trả lời sai còn tệ hơn không trả lời.
2. `openDocPicker()` từ chối chạy trên tab đã có content script khác của extension. Chốt nằm ở **đường tiêm**, vì `exclude_matches` không chi phối `chrome.scripting.executeScript`; danh sách host suy từ `CONTENT_SCRIPT_MATCH_PATTERNS`, không viết tay lần thứ hai.
3. Hàm bảo đảm script chỉ tin phản hồi có `ok: true`, không tin "có phản hồi".
4. Nhánh cuối của **cả bốn** router là `M.unrouted(...)` — **ném**. Khai nhận một loại tin mà không viết nhánh xử lý là lỗi lập trình, không phải một lượt chạy hỏng; trước khi có chốt này, một loại tin quên nhánh rơi vào nhánh catch-all và trả về `{ ok: true }` kèm trạng thái popup.

Thêm một loại tin thì **phải** thêm vào `ACCEPTS` **và** viết nhánh cho nó — thiếu vế nào cũng đỏ.

### Ba bẫy mà chỉ trang thật mới lộ ra

Đường quét DOM có ba cách hỏng hoàn toàn mà test tĩnh không thấy được. `node tools/verify-live.mjs` chạy trên trang watch thật để canh — và ngay lượt chạy đầu nó tìm ra một cách hỏng thứ tư, xem dưới:

1. **Bấm nhầm nút của chính mình.** Nếu hàm dò nút quét mọi `<button>` khớp `/transcript/i` mà extension lại tự thêm nút nhãn "Transcript" đứng đầu hàng nút, nó sẽ bấm vào chính nó. Xem mục dưới.
2. **Selector trỏ vào layout đã chết.** YouTube đã thay panel transcript: không còn `ytd-transcript-renderer` / `ytd-transcript-segment-renderer`, giờ là engagement panel `PAmodern_transcript_view` chứa `transcript-segment-view-model`. Bên trong có một div nhãn trợ năng ("1 second") — lấy `innerText` cả dòng là nuốt luôn chuỗi đó vào giữa transcript.
3. **`el.click()` không đủ để mở panel.** Phải phát đủ chuỗi `pointerdown → mousedown → pointerup → mouseup → click`, và phải nhắm **phần tử bấm được trong cùng** — `querySelectorAll` trả theo thứ tự DOM nên wrapper `ytd-button-renderer` luôn đứng trước `<button>` thật, mà bấm wrapper thì YouTube không phản hồi.

Cách thứ tư, đo được 2026-08-22: **panel đang mở có thể không mang `target-id` nào cả.** Trên một số video, panel transcript đã mở mang `target-id = null` — không khớp selector — trong khi hai panel *khớp* selector thì đều ẩn. Extension nhìn thấy toàn panel ẩn, kết luận "cửa sổ quá hẹp" và **bỏ cuộc không thử lại**, dù cửa sổ rộng 1440px và transcript nằm ngay đó. Lỗi phụ thuộc video: video khác thì đường này chạy tốt.

Bài học đắt hơn cái selector: **"cửa sổ quá hẹp" là kết luận cắt đường lui, nên nó phải có bằng chứng về bề rộng**, không phải chỉ dựa vào thuộc tính `visibility`. Panel transcript nằm ở cột phải và ở layout hẹp thật thì YouTube giữ nó ẩn **và không chiếm một pixel nào** — đó mới là dấu hiệu phân biệt được.

### Giao diện của extension phải tách khỏi giao diện của trang

Extension vừa **chèn** nút vào trang, vừa **dò tìm** nút của trang. Hai việc đó đá nhau: một hàm quét mọi `<button>` khớp `/transcript/i` sẽ bắt trúng cái nút nhãn "Transcript" mà chính extension vừa thêm vào đầu hàng nút — nó bấm vào chính nó, panel YouTube không bao giờ mở, và phương án DOM chết câm với thông báo đổ lỗi cho YouTube.

Hai bất biến, `test/ids.test.js` canh:

- Mọi id do extension tạo phải mang tiền tố `nblm-` — selector loại trừ dùng `[id^="nblm-"]`, id lạc quy ước là lọt lưới ngay mà không có triệu chứng.
- Mọi hàm dò tìm phần tử của trang phải lọc bỏ `OWN_UI` trước.

Quy tắc chung: **hễ dò tìm phần tử theo chữ hiển thị thì phải loại trừ giao diện của chính mình trước.**

### Hai hostname, cùng một sản phẩm

Từ 2026-07-16 Google đổi tên NotebookLM thành **Gemini Notebook**: `notebooklm.google.com` 302 sang `notebook.google.com`, và việc chuyển chạy **theo cohort** — cùng một lúc có tài khoản còn ở host cũ, có tài khoản đã sang host mới.

Extension vì thế khai **cả hai** host, ở cả `host_permissions` lẫn `content_scripts`, và hỏi tab trên cả hai:

- Khai thiếu một host thì với đúng nhóm tài khoản kia, content script **không nạp** và cả đường đẩy im lặng không làm gì — không lỗi, không huy hiệu, không gì cả.
- Hỏi tab thiếu một host thì tab notebook đang mở không được nhận ra, và mỗi lần đẩy lại mở thêm một tab bên cạnh tab đã có.

Danh sách host nằm đúng một chỗ — `NOTEBOOK_HOSTS` trong `src/common/shared.js` — và mẫu cho manifest lẫn `chrome.tabs.query` được **suy ra** từ nó. Tab do extension tự mở đi vào host cũ, vì chiều redirect chỉ có một. `test/manifest.test.js` đối chiếu manifest và service worker với chính hằng số ấy, nên khai lệch là đỏ chứ không phải hỏng lặng.

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

---

## Tải transcript hàng loạt nhanh hơn — `tools/`

Với video private, extension buộc phải mở thật một trang watch cho từng video (~15–20 giây/video), vì hai đường API của YouTube đều bị chặn. Nếu chỉ cần **file transcript** chứ không cần đẩy vào NotebookLM, có đường nhanh hơn nhiều dựa trên `yt-dlp`:

Đường này nhanh hơn hẳn và chạy được cả khi trình duyệt đang đóng. Chính vì vậy nó **không thuộc về
extension** — [ADR 0004](docs/adr/0004-tach-tools.md) tách nó ra, và **các script ấy không còn nằm
trong repo này**. `tools/` ở đây chỉ chứa cổng kiểm chứng, xem cây thư mục bên dưới.

Ba cái bẫy làm hỏng câm ở đường ấy — cookie không giải mã được, `Requested format is not available`,
phụ đề tự động cuộn lặp — cùng ghi chú bảo mật đi theo nó sang repo riêng.

---

## Cấu trúc

```
manifest.json
src/
├── common/shared.js              hằng số, storage, dựng nội dung nguồn
├── background/service-worker.js  điều phối hàng đợi, quản lý tab, menu chuột phải
├── youtube/
│   ├── page-bridge.js            MAIN world — ytcfg, InnerTube, mượn header xác thực
│   ├── bridge-client.js          bọc postMessage thành Promise
│   ├── transcript.js             chuỗi phương án + quét DOM panel
│   ├── srt.js                    transcript → md/srt/vtt
│   ├── panel.js                  panel xem/tìm/tải transcript trên trang watch
│   └── content.js                nút trên trang watch, chọn hàng loạt, import toàn bộ
├── docs/
│   ├── markdown.js               HTML → Markdown, giữ nguyên khối code
│   ├── extract.js                chọn phần thân bài + dọn rác điều hướng
│   ├── sidebar.js                chấm điểm dò sidebar, dựng lại thành cây
│   ├── content.js                bảng chọn link (shadow DOM) + công nhân trích
│   └── overlay.css               giao diện bảng chọn
└── notebooklm/
    ├── selectors.js              MỌI thứ dễ vỡ nằm ở đây
    ├── automation.js             thao tác giao diện
    └── content.js                nhận lệnh + chỉ báo tiến độ

popup.html / popup.js             hàng đợi, dán link, gom tab, tải transcript
options.html / options.js         cài đặt, ghi đè selector

test/                             chạy bằng `bash test/run.sh`
tools/                            hai cổng chạy trên Chrome thật, và một cổng canh cây node giả
├── live-browser.mjs              nạp chính extension này vào Chrome for Testing (khung dùng chung)
├── live-checks.mjs               các phép chấm của hai script dưới (có test riêng)
├── verify-live.mjs               chạy lớp YouTube trên trang watch thật, cả đường DOM lẫn InnerTube
├── verify-docs.mjs               chạy lớp tài liệu trên 4 bộ tạo docs thật
├── probe-sidebar.mjs             dump điểm chấm sidebar khi dò sai
├── audit-fake-dom.mjs            đối chiếu test/helpers/fake-dom.js với DOM thật; thoát 1 khi lệch
└── fake-dom-probes.mjs           97 phép thử chạy được ở cả hai cây
```

---

## Giới hạn cần biết

- **Video không có phụ đề nào** (kể cả tự động) thì không trích được gì. YouTube thường chưa sinh phụ đề tự động cho video mới upload, và không sinh cho video không có tiếng nói. Bật/tải phụ đề trong YouTube Studio rồi thử lại.
- Nguồn dán tay vào NotebookLM là **ảnh chụp tại một thời điểm**. Nếu bạn sửa video, phải import lại. Nguồn dạng link thì NotebookLM tự quản.
- Giới hạn NotebookLM: **50 nguồn/notebook** ở bản miễn phí (Plus 100, Pro 300, Ultra 500–600); trần **500.000 từ mỗi nguồn** như nhau ở mọi gói. Quota nguồn là thứ khan hiếm, số từ mỗi nguồn thì gần như không bao giờ chạm — đó là lý do có [ADR 0002](docs/adr/0002-don-vi-nguon.md). Khi chạm giới hạn, extension dừng hàng đợi và báo lại thay vì cắm đầu chạy tiếp.
- Chống trùng lặp nằm ở **Sổ đã import**, tách hẳn khỏi hàng đợi và khoá theo cặp (video, notebook) — nên dọn hàng đợi không làm mất nó, và đổi sang notebook khác thì import lại được bình thường ([ADR 0006](docs/adr/0006-so-da-import-tach-khoi-hang-doi.md)).
- Tự động hoá dựa trên DOM sẽ hỏng khi Google đổi giao diện. Đó là lý do có phần ghi đè selector ở trên.
- **Import cả nhánh thì cả nhánh thành một nguồn**, không phải mỗi trang một nguồn — nếu không, docs 120 trang ăn hết quota 50 nguồn từ lâu trước khi import xong. Cái giá: trích dẫn của NotebookLM chỉ tên được nhánh chứ không tên từng trang. Import lẻ một trang thì vẫn một trang một nguồn ([ADR 0002](docs/adr/0002-don-vi-nguon.md), [ADR 0005](docs/adr/0005-cat-nguon-gop.md)).
- Bảng chọn chỉ thấy **những gì sidebar đang hiện**. Sidebar thu gọn theo mục đang mở (khá phổ biến) thì phần chưa bung ra sẽ không có trong danh sách; bung mục đó ra rồi mở lại bảng.
- **Gộp nguồn khiến mất một mục trở nên vô hình**: 54 video trong một nguồn trông y hệt 55. Vì vậy bảng tổng kết cuối lần chạy luôn liệt kê mục nào rớt và vì sao — đọc nó, đừng bỏ qua ([ADR 0008](docs/adr/0008-gom-nguon-day-dan.md)).
- Nguồn gộp đặt tên `<Tên playlist> — phần 1`, `— phần 2`… **không có mẫu số**: đẩy dần nghĩa là lúc chốt phần 1 chưa ai biết sẽ có mấy phần, và một cái tên `(1/6)` đặt sai thì không sửa lại được sau khi nguồn đã đẩy đi ([ADR 0010](docs/adr/0010-dat-ten-nguon-gop.md)).
- Import lại một playlist đã có thêm video mới sẽ sinh nguồn **`— bổ sung 1`** riêng, vì NotebookLM không cho sửa nguồn đã tạo. Dựng lại từ đầu sẽ phải trích lại toàn bộ ([ADR 0009](docs/adr/0009-import-lai-playlist.md)).
- Extension chỉ đi theo link **cùng host**. Docs trỏ sang subdomain khác (`api.example.com`) phải import riêng từ chính trang đó.

---

## Trạng thái kiểm chứng

Luật của mục này giữ nguyên: **một gạch đầu dòng chỉ được đổi sang thì quá khứ khi có lệnh chạy
được kèm kết quả dán vào.** Dưới đây là chỗ đã đổi được, và chỗ chưa.

Đã có, chạy được: `bash test/run.sh` → **771 test / 25 file**, cộng ba cổng —
`tools/verify-live.mjs` và `tools/verify-docs.mjs` nạp chính extension này vào Chrome for
Testing 151 và chạy trên trang công khai thật; `tools/audit-fake-dom.mjs` đối chiếu cây node giả
của bộ test với DOM thật và thoát 1 khi còn lệch.

Ba cổng ấy không phải trang trí: mỗi cái ra đời sau một lỗi **suite xanh vẫn lọt**. `.filter` gọi
trên `children` (DOM thật trả `HTMLCollection`) — suite xanh 537/537. `content.js` thiếu
`install(root)` lúc nạp — suite xanh 609/609. Cả hai đều làm **Bảng chọn không bao giờ mở được**.

- **Test hàm thuần** — bóc videoId (mọi định dạng URL), khử trùng lặp danh sách, bỏ dấu tiếng
  Việt, gộp transcript theo mốc thời gian, dựng nội dung nguồn, gộp override selector, chuẩn
  hoá URL tài liệu (kể cả phân biệt hash-route với neo trong trang), cắt nguồn gộp theo trần
  500k từ, và bộ chuyển định dạng transcript. Chỗ đáng ngờ nhất: suy ra mốc kết thúc cho SRT
  khi nguồn chỉ cho mốc bắt đầu.
- **Test toàn vẹn** — manifest (mọi đường dẫn tồn tại, không file JS nào mồ côi, thứ tự nạp
  đúng chuỗi phụ thuộc, các mảng `SCRIPTS.*` trong service worker khớp từng dòng với
  `content_scripts`); cấu hình (mọi setting trong `DEFAULTS` đều có ô nhập, mọi id popup.js
  tham chiếu đều tồn tại trong HTML); kỷ luật định tuyến tin nhắn (mọi `case` đều có trong
  `ACCEPTS` và có nhánh xử lý thật, không hai listener nào cùng nhận một loại tin).
- **Test bất biến hàng đợi** — song song ở khâu trích, độc quyền ở khâu đẩy
  ([ADR 0007](docs/adr/0007-hai-hang-doi.md)).
- **Chạy trên trang YouTube thật** — nạp `transcript.js` vào một trang watch thật rồi chạy
  `fromPanel()`, canh ba bẫy ở mục "Ba bẫy mà chỉ trang thật mới lộ ra".
- **Chạy trên trang tài liệu thật** — nạp `markdown.js` / `extract.js` / `sidebar.js` vào bốn
  bộ tạo docs dựng HTML khác hẳn nhau (Docusaurus, MkDocs Material, VitePress, Sphinx+RTD) và
  kiểm: dò được sidebar, không lọt link khác site hay neo trong trang, chọn đúng khối thân bài,
  không nuốt mất nội dung, giữ đề mục, **khối code không bị dính thành một dòng**, và tên mục
  sidebar không rớt vào thân bài.
- **Luồng end-to-end** — *chưa*. Trích transcript từ video private, quét playlist qua InnerTube,
  đẩy nguồn vào NotebookLM. Cần một trình duyệt đã đăng nhập, nên không tự động hoá được và
  không thứ tự động nào được phép làm thay: lần đẩy thật đầu tiên vào notebook có dữ liệu là
  quyết định của chủ repo.
- **Không test tự động được** — `page-bridge.js` chạy trong ngữ cảnh trang (hook `fetch`, đọc
  `ytcfg`) nên không require được vào node.

Một test toàn vẹn **xanh nhầm** khó phát hiện hơn một test đỏ: cửa sổ quét trượt sang `case`
kế bên và bắt nhầm `ok: true` của nó thì test vẫn xanh trong khi ràng buộc đã hở. Mỗi test
toàn vẹn phải được kiểm ngược bằng cách cố tình phá thứ nó canh, và phải in ra chi tiết lệch.

### Hai bẫy mà chỉ trang tài liệu thật mới lộ ra

Cả hai nằm ở khâu dựng cây sidebar, và cả hai đều **im lặng**: bảng chọn vẫn mở ra, vẫn có
link, chỉ là thiếu — không có cách nào nhận ra nếu không đối chiếu với trang thật.

1. **Ngưỡng tin đường `<ul>` quá yếu.** VitePress dựng sidebar bằng `<div>` lồng nhau, không
   dùng `<ul>` — nhưng trong container vẫn lẫn một `<ul>` nhỏ. Điều kiện kiểu *"cây dựng được
   có ≥3 link là xong"* sẽ trả về một cây tí hon và bỏ sót phần lớn link còn lại. Chỉ tin
   đường `<ul>` khi nó gom được ≥80% số link thật trong container, không đủ thì rơi về lối
   xếp phẳng.
2. **Sổ "đã nhận" bị tái dùng.** Nếu `claim()` chỉ cho mỗi URL xuất hiện một lần và cả hai
   lượt dựng dùng chung một sổ, lượt `<ul>` sẽ nhận mất một phần link rồi lối xếp phẳng mất
   sạch chính những link đó. Mỗi lượt dựng phải có sổ riêng.

Một giới hạn cần lường trước: `docs.python.org` (Sphinx thuần) có sidebar chỉ chứa **mục lục
trong trang** — toàn neo `#…` trỏ về chính trang đang mở. Lọc đúng thì gần như không còn link
điều hướng nào, và bảng chọn vô dụng ở đó. Không phải lỗi; bản Sphinx dùng theme ReadTheDocs
(`.wy-nav-side`) thì bình thường.

### Gỡ lỗi

Trong DevTools console của tab NotebookLM:

```js
NBLM_AUTOMATION._internals.selectors          // bộ selector đang dùng
NBLM_AUTOMATION._internals.openDialog()       // hộp thoại có được nhận diện không
NBLM_AUTOMATION.addUrlSource('https://…')     // chạy thử một lần
```

Trong console của tab tài liệu:

```js
NBLM_DOCS_SIDEBAR.detect()                    // dò được sidebar nào, bao nhiêu link
NBLM_DOCS_EXTRACT.pickRoot(document, 600)     // khối nào được coi là thân bài
NBLM_DOCS_EXTRACT.fromLive({}).markdown       // xem đúng thứ sẽ dán vào NotebookLM
```

Nếu lần chạy đầu báo *"Không tìm thấy nút Thêm nguồn"*, mở hộp thoại thêm nguồn, xem nút đang
ghi chữ gì, rồi thêm vào phần ghi đè trong Cài đặt — thường là sửa một dòng.
