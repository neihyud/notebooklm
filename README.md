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
4. Mở notebook đích trên `notebooklm.google.com`, rồi bấm icon extension → **"Dùng notebook ở tab hiện tại"**

Yêu cầu: Chrome 111+ (dùng content script `world: "MAIN"`), và bạn đang đăng nhập Google trong chính trình duyệt đó.

---

## Cách dùng

**Một video** — vào trang xem video, bấm nút **NotebookLM** cạnh nút Like/Share. Hoặc phím tắt `Alt+Shift+Y`.

**Nhiều video cùng lúc** — trên trang playlist / kênh / kết quả tìm kiếm / Watch Later, mỗi thumbnail có một checkbox ở góc trái. Chọn xong bấm **Import vào NotebookLM** ở thanh nổi dưới màn hình.

**Toàn bộ playlist hoặc kênh** — trên trang playlist / kênh, thanh nổi có nút **Import toàn bộ**. Nút này *không* đọc DOM: nó gọi thẳng API nội bộ của YouTube và phân trang tới hết, nên lấy đủ playlist vài trăm video bất kể bạn đã cuộn tới đâu. Trước khi chạy sẽ hiện bảng xác nhận: bao nhiêu video, bao nhiêu cái là private của bạn, bao nhiêu cái bị bỏ vì không có quyền xem. Áp dụng được cho cả **Xem sau** (`WL`) và **Video đã thích** (`LL`).

**Gom từ nhiều tab / cả trang** — trong popup: *Mọi tab YouTube đang mở*, hoặc *Mọi link YouTube trên trang này* (chạy được trên trang bất kỳ, không riêng YouTube — hữu ích khi quét một bài blog đầy link video).

**Xem / tải transcript** — nút **Transcript** cạnh nút NotebookLM mở panel bên phải: có ô tìm kiếm (bỏ dấu vẫn khớp), bấm timestamp là video nhảy tới đúng đoạn, sao chép, và tải về `.txt` / `.srt` / `.md`. Chạy được với cả video private của bạn, vì dùng chung đúng cơ chế trích ở trên.

**Tải transcript hàng loạt về máy** — popup có nút **Tải transcript**: chạy hết hàng đợi ở chế độ *chỉ tải về*, trích transcript rồi lưu thành file, **không đụng tới NotebookLM** (không cần mở notebook, không cần đăng nhập NotebookLM). Hữu ích khi khâu import trục trặc — transcript vẫn giữ lại được thay vì trích xong rồi vứt đi. Định dạng `.txt` / `.srt` / `.vtt` / `.md` và thư mục đích đặt trong Cài đặt; file được đánh số thứ tự cho dễ sắp.

**Dán danh sách link** — mở popup, dán vào ô, bấm *Thêm vào hàng đợi*.

**Chuột phải** — trên một link YouTube bất kỳ, hoặc bôi đen một đoạn text chứa nhiều link.

**Trang tài liệu** — mở trang docs bất kỳ. Extension dò sidebar và hiện nút nổi **→ NotebookLM · N trang** ở góc dưới bên phải; bấm vào để mở bảng chọn. Bảng dựng lại đúng cây mục lục của sidebar, có ô lọc, tick theo nhánh (tick mục cha là chọn cả nhánh con), rồi bấm *Thêm N trang*. Không thấy nút thì gọi bằng phím tắt `Alt+Shift+D`, popup, hoặc chuột phải → *Chọn link tài liệu…*.

Hàng đợi chạy tuần tự, lưu bền qua các lần khởi động lại, và xem/dừng/thử-lại được từ popup. Cả hai loại nguồn dùng chung một hàng đợi.

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
- Giới hạn NotebookLM: **50 nguồn/notebook** ở bản miễn phí, tối đa 500.000 từ mỗi nguồn. Khi chạm giới hạn, extension dừng hàng đợi và báo lại thay vì cắm đầu chạy tiếp.
- Video đã import xong vẫn nằm trong hàng đợi để chống trùng lặp. Muốn import lại cùng một video, bấm **Xoá xong** trước.
- Tự động hoá dựa trên DOM sẽ hỏng khi Google đổi giao diện. Đó là lý do có phần ghi đè selector ở trên.
- **Mỗi trang tài liệu là một nguồn riêng.** Trích dẫn của NotebookLM nhờ vậy chỉ đúng tên trang, nhưng docs 120 trang sẽ ăn hết quota 50 nguồn từ lâu trước khi import xong — chọn nhánh cần thiết trong bảng chọn thay vì tick *Chọn hết*.
- Bảng chọn chỉ thấy **những gì sidebar đang hiện**. Sidebar thu gọn theo mục đang mở (khá phổ biến) thì phần chưa bung ra sẽ không có trong danh sách; bung mục đó ra rồi mở lại bảng.
- Extension chỉ đi theo link **cùng host**. Docs trỏ sang subdomain khác (`api.example.com`) phải import riêng từ chính trang đó.
- Nguồn dán tay là ảnh chụp tại một thời điểm — tài liệu cập nhật thì phải import lại.

---

## Mức độ đã kiểm chứng

Sòng phẳng về chuyện này:

- **Đã chạy test:** 277 test (`bash test/run.sh`) cho các hàm thuần — bóc videoId (mọi định dạng URL), khử trùng lặp danh sách, bỏ dấu tiếng Việt, gộp transcript theo mốc thời gian, dựng nội dung nguồn, gộp override selector, chuẩn hoá URL tài liệu (kể cả phân biệt hash-route với neo trong trang), cắt nguồn quá dài, và bộ chuyển định dạng transcript (chỗ đáng ngờ nhất là suy ra mốc kết thúc cho SRT khi nguồn chỉ cho mốc bắt đầu). Cộng hai test soát tính toàn vẹn: manifest (mọi đường dẫn tồn tại, không file JS nào mồ côi, thứ tự nạp đúng chuỗi phụ thuộc, và **cả 3 mảng `SCRIPTS.*` trong service worker khớp từng dòng với `content_scripts`** — ràng buộc này đã sập một lần, comment ở hai đầu là chưa đủ) và cấu hình (mọi setting trong `DEFAULTS` đều có ô nhập, mọi id popup.js tham chiếu đều tồn tại trong HTML).

  Cộng một test thứ ba về **kỷ luật định tuyến tin nhắn** (xem dưới).

  Cả ba test toàn vẹn đều đã được kiểm tra ngược bằng cách cố tình phá — xoá một file khỏi `SCRIPTS`, đảo thứ tự hai file, xoá `css` của một kind, thêm `case` mà quên khai vào `HANDLED`, cho hai content script cùng nhận một loại tin, bỏ `ok: true` khỏi handler ping — mỗi lần đều đỏ đúng chỗ và in ra chi tiết lệch. Một trong các test lúc đầu **xanh nhầm** (cửa sổ quét trượt sang `case` kế bên và bắt nhầm `ok: true` của nó); nếu không thử phá thì đã không phát hiện.
- **Đã chạy trên trang YouTube thật:** `node tools/verify-live.mjs [videoId]` nạp thẳng mã nguồn `transcript.js` vào một trang YouTube thật rồi chạy `fromPanel()`. Không cần đăng nhập, không cần Chrome nạp được extension. Đã xác nhận lấy đúng transcript trên hai video (24 và 32 dòng, timestamp chuẩn, không nuốt nhãn trợ năng). Chính script này đã bắt được ba lỗi thật — xem "Ba lỗi mà chỉ trang thật mới lộ ra" ở trên.
- **Đã chạy trên trang tài liệu thật:** `node tools/verify-docs.mjs [url…]` nạp `markdown.js` / `extract.js` / `sidebar.js` vào trang thật rồi chạy đúng như extension chạy. Mặc định quét 4 bộ tạo docs dựng HTML khác hẳn nhau — **Docusaurus, MkDocs Material, VitePress, Sphinx+RTD** — và kiểm: dò được sidebar, không lọt link khác site hay neo trong trang, chọn đúng khối thân bài (không rơi về `fallback`), không nuốt mất nội dung, giữ đề mục, **khối code không bị dính thành một dòng**, và tên mục sidebar không rớt vào thân bài. Kèm `tools/probe-sidebar.mjs` để xem `rate()` chấm điểm những khối nào khi dò sai.

  **103 khối code trên 4 trang đều ra fence nhiều dòng đúng** — giả thuyết trung tâm của `markdown.js` (Prism/Shiki dựng mỗi dòng thành một phần tử riêng, không có ký tự `\n` nào) giữ được trên thực tế.

  Chính script này bắt được **hai lỗi thật** trong `sidebar.js` — xem mục dưới.
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
