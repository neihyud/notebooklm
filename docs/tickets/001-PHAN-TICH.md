# 001 — Kiểm tiền đề trước khi owner quyết

- loại: phân tích **chỉ đọc**. Không sửa `src/`, `test/`, `tools/`, `manifest.json`.
- ngày: 2026-08-24. Đối tượng: `docs/tickets/001-notebooklm-rpc.md`.
- phương pháp: mọi con số dưới đây truy được về `file:line` trong cây này. Không chạy
  `bash test/run.sh` (có peer khác đang ghi trên cùng cây — số đo sẽ không tái lập được, đúng cảnh
  báo `WORKSPACE_PROTOCOL.md` mục Verification). Không mở trình duyệt, nên phần nào cần đo trên
  tab thật sẽ được ghi rõ là **chưa đo được**, không đoán.

---

## 1. Tiền đề same-origin: ĐÚNG, nhưng nó không mua thứ ticket cần

### Phần đúng

Content script NotebookLM được khai báo ở `manifest.json:92-107`: `matches` là
`https://notebooklm.google.com/*` (`manifest.json:94`), `run_at: document_idle`
(`manifest.json:105`), `all_frames: false` (`manifest.json:106`), và **không có khoá `"world"`** —
nên nó chạy ở ISOLATED world (khoá `"world": "MAIN"` chỉ xuất hiện một lần trong cả manifest, ở
block YouTube `manifest.json:71`). Ticket trích `manifest.json:104`; dòng đó thật ra là dấu đóng
mảng `css`. Nội dung khẳng định thì vẫn đúng, chỉ lệch số dòng.

Quyền: `host_permissions` đã có `https://notebooklm.google.com/*` (`manifest.json:21`) và còn có
`https://*/*` (`manifest.json:23`). **Không cần thêm permission nào** — ràng buộc 2 của ticket
không bị đụng tới.

Cookie phiên: repo đã có một tiền lệ đang chạy thật, không phải suy luận. `src/docs/extract.js:227`
gọi `fetch(url, { credentials: 'include', redirect: 'follow' })` từ một content script ISOLATED
world, và `src/background/service-worker.js:350-353` ghi rõ lý do kiến trúc của nó: *"fetch trong
tab đi kèm cookie phiên và không vướng CORS (cùng origin), nên tài liệu nội bộ cần đăng nhập vẫn
đọc được"*. Đây là bằng chứng mạnh nhất có được mà không mở trình duyệt: đường đó đang phục vụ
tính năng docs. Lưu ý một chi tiết ticket bỏ qua — `extract.js:227` **ghi tường minh**
`credentials: 'include'`, không dựa vào mặc định.

### Phần ticket không nói ra, và nó mới là chỗ tốn

`batchexecute` là POST có CSRF token `at`. Chính ticket thừa nhận token đó nằm trong
`WIZ_global_data` của trang và ISOLATED world không đọc được (`001-notebooklm-rpc.md:50-54`).
Nghĩa là: **same-origin cho ta cái cookie, nhưng không cho ta cái token.** Tiền đề "không cần
quyền mới" đúng; tiền đề ngầm "nên chỉ việc `fetch`" thì sai.

Ticket nêu hai đường lấy `at`. Chi phí thật của từng đường, đo trong repo:

**Đường A — regex từ HTML trong DOM.** Rẻ về mặt hạ tầng. Nhưng nó là *đúng một hằng số chép tay
nữa*, cùng hạng với `selectors.js` — thứ `WORKSPACE_PROTOCOL.md:31-35` xếp đầu bảng dominant
risks. Nó cũng chưa đo được ở phiên này: không xác nhận được `WIZ_global_data` còn nằm trong DOM
sau khi Angular điều hướng SPA vào `/notebook/<id>`. **Phải mở DevTools mới biết.**

**Đường B — MAIN-world bridge kiểu `src/youtube/page-bridge.js`.** Đường này **không** làm được mà
không đụng `manifest.json`, và đây là phát hiện cụ thể:

- `SCRIPTS.notebooklm.main` hiện là `[]` (`src/background/service-worker.js:100`), nên trên lý
  thuyết có thể tiêm MAIN world bằng `chrome.scripting.executeScript`.
- Nhưng `ensureScripts()` **thoát sớm** khi ping thành công: `if (pong && pong.ok) return pong;`
  (`src/background/service-worker.js:142`). Trên tab NotebookLM bình thường, content script đã do
  manifest tiêm sẵn nên ping luôn `ok` → nhánh tiêm không bao giờ chạy → bridge MAIN world không
  bao giờ được nạp. Muốn nó có mặt chắc chắn thì phải khai báo trong `manifest.json`.
- Và `test/manifest.test.js:97-109` ép `manifest.content_scripts` khớp từng dòng với `SCRIPTS`,
  có kiểm riêng nhánh `cs.world === 'MAIN'`. Nên đường B = sửa **cả hai** file.

Chạm `manifest.json` đẩy ticket từ "architecture lock-in" sang **thêm cả hạng cross-module**
(`WORKSPACE_PROTOCOL.md:87-89`: *"bất cứ thay đổi nào chạm `manifest.json`… 1 peer write scope +
review seat độc lập"*). Không phải cấm — nhưng nó không phải "content.js không phải đổi" như
ticket hình dung ở mục Kết quả cần có.

**Kết luận mục 1:** tiền đề không sụp. Nhưng nó chỉ đúng cho nửa dễ của bài toán, và nửa khó đẩy
chi phí kiến trúc lên một hạng.

---

## 2. Nó mua được bao nhiêu: 3–9 phút cho cả lượt 89 video

`tools/videos.txt` có **89 dòng, 89 dòng không rỗng** — đúng con số ticket dùng.

### Nhịp chờ CỨNG mỗi Nguồn (đường DOM, ca thuận lợi)

Chỉ tính `sleep()` luôn phải trả. Các `waitFor` chỉ trả tiền khi hỏng, tách riêng bên dưới.

| Chỗ | `file:line` | ms | RPC bỏ được? |
|---|---|---|---|
| `pickChip` sau khi bấm chip | `automation.js:249` | 600 | có |
| sau khi điền tiêu đề | `automation.js:447` | 250 | có (chỉ text) |
| sau khi dán nội dung | `automation.js:454` | `min(4000, 600 + L/20)` | có (chỉ text) |
| sau khi điền URL | `automation.js:383` | 400 | có (chỉ url) |
| chờ bắt lỗi muộn ở snackbar | `automation.js:262` | 1200 | có |
| nhịp dò hộp thoại | `automation.js:269` | 0–300 | có |
| chờ danh sách Nguồn lắng | `automation.js:311-316` | ~300 thuận / **8000** xấu / 0 nếu `before===null` (`automation.js:336`) | **chỉ khi bỏ luôn phép đối chiếu của 002** |
| nghỉ giữa hai mục | `service-worker.js:1132`, mặc định `shared.js:86` | 1200 | **KHÔNG** |

### Cộng lại

**Nhánh URL** (video public — `planFor` trả `['url']`, `service-worker.js:856-857`):
`600 + 400 + 1200 = 2200 ms` bỏ được mỗi Nguồn → **× 89 = 195,8 s ≈ 3 phút 16 s**.

**Nhánh text** (video private — `planFor` trả `['text']`, `service-worker.js:850-852`):
`600 + 250 + (600 + L/20) + 1200 = 2650 + L/20` ms.
- transcript 20 000 ký tự → 3650 ms → **× 89 ≈ 5 phút 25 s**
- transcript ≥ 68 000 ký tự (chạm trần 4000 ở `automation.js:454`) → 6050 ms → **× 89 ≈ 8 phút 58 s**

Tỉ lệ private/public của 89 video **không suy ra được từ repo** (`tools/videos.txt` chỉ có id), nên
đây là một khoảng, không phải một điểm. Trần trên của khoảng là **~9 phút cho cả lượt**.

### Phần con số đó KHÔNG bỏ được — và nó lớn hơn

| Không bỏ được | `file:line` | × 89 |
|---|---|---|
| nghỉ giữa hai mục 1200 ms | `service-worker.js:1132` | **1 phút 47 s** |
| điều hướng tab phụ 1500 ms (nhánh text) | `service-worker.js:275`, `:281` | 2 phút 13 s |
| chờ sau khi tiêm script 500 ms | `service-worker.js:154` | 44 s |
| kích hoạt tab để quét panel 900 ms | `service-worker.js:325` | 1 phút 20 s |
| **chờ danh sách Nguồn lắng, ca xấu 8000 ms** | `automation.js:311-316` | **11 phút 52 s** |

Hàng cuối là điểm chí tử của lập luận tốc độ, và chính code đã tự tính ra nó:
`automation.js:334-335` viết *"8s vứt đi cho MỖI mục là 12 phút cho một lượt 89 video"*. Nghĩa là
**bước xác minh của ticket 002, một mình nó, đắt hơn toàn bộ thứ RPC mua được** — trừ phi RPC vứt
luôn bước xác minh, và đó là mục 4.

`delayMs` cũng không bỏ được, mà còn có lý do phải **tăng**: `WORKSPACE_PROTOCOL.md` external side
effects ghi *"Rate limit là rủi ro thật; lượt chạy hàng loạt (đo thực tế: 89 video) là nơi nó xuất
hiện"*. RPC rút ~2,6–6 s pacing tự nhiên khỏi mỗi mục, tức là bắn vào backend Google nhanh hơn
hẳn, bằng chính phiên đăng nhập của owner. Phần gain phải trả lại một mẩu cho `delayMs` mới an
toàn.

### Ca hỏng thì sao — chỗ RPC thật sự mua được nhiều

Một mục kẹt ở đường DOM đốt tới trần `ITEM_TIMEOUT_MS = 240000` (`service-worker.js:35`) trước khi
hàng đợi đi tiếp. Cộng các `waitFor` timeout trên đường đi: 12000 mở hộp thoại
(`automation.js:240`) + 10000 ô nhập (`automation.js:378` hoặc `:437`) + 8000 nút Chèn
(`automation.js:385` / `:457`) = **30 s** một mục trước khi bỏ cuộc.

Đây mới là chỗ đường DOM đắt thật. Nhưng nó chỉ đắt **khi DOM đã hỏng** — mà đúng lúc đó thì
ticket lại quy định rơi xuống DOM làm dự phòng, nên chi phí này vẫn còn nguyên trong thiết kế đề
xuất. RPC không mua được nó.

**Kết luận mục 2:** RPC mua được **3–9 phút** trên một lượt 89 video, trên nền một lượt chạy mà
riêng phần không-bỏ-được đã là 6–18 phút nhịp chờ cứng, cộng thời gian server Google xử lý — thứ
không truy được về code nên báo cáo này không định lượng.

---

## 3. rpc id mục nát: có đúng một cơ chế đáng tin, và nó không thuộc về RPC

Xét từng cơ chế:

**(a) Đọc lỗi từ envelope `batchexecute`.** Chưa đo được ở phiên này, và chính ticket đã tự bác:
*"Response có prefix `)]}'` và là mảng lồng không tên field. Parse sai vẫn trông như thành công"*
(`001-notebooklm-rpc.md:59-60`). Một cơ chế phát hiện mà bản thân nó có thể hỏng-mà-trông-như-xanh
thì không phải cơ chế phát hiện. **Không tin được nếu chưa đo trên tab thật.**

**(b) Đọc rpc id ra từ bundle JS của trang lúc chạy** thay vì ghim hằng số. Đây là cơ chế duy nhất
biến "mục nát" thành "tự lành". Cái giá: regex vào bundle minified của Google — lại đúng một hằng
số chép tay nữa, cùng hạng rủi ro `WORKSPACE_PROTOCOL.md:31-35`, chỉ là dời chỗ. Và kiểm chứng nó
cần một công cụ kiểu `tools/verify-live.mjs`; công cụ đó **đang có một tính chất mà bản NotebookLM
sẽ mất**: `verify-live.mjs:12-13` ghi *"KHÔNG cần đăng nhập — nên dùng được với mọi video công khai"*.
Bản NotebookLM bắt buộc phải chạy trên profile đã đăng nhập của owner, mà
`WORKSPACE_PROTOCOL.md` prohibited liệt kê *"chạy lượt import hàng loạt lên tài khoản owner như một
bước kiểm chứng"*.

**(c) Đối chiếu số Nguồn — `countSources()` trước/sau (`automation.js:290`, `:332-362`).** Đây là
cơ chế đáng tin duy nhất, vì nó **không đi qua envelope RPC**: id sai → server không thêm gì → số
không tăng → `confirmSourceAdded` trả `ok:false` kèm số trước/sau (`automation.js:349-361`). Phát
hiện **trong vòng một mục**, trần 8 s (`automation.js:316`), và fail-closed thành `error` chứ không
thành `done` giả.

Nhưng (c) có một lỗ, và nó phá luôn giá trị của cả cơ chế:

> `S.css.sourceList` / `sourceItem` (`selectors.js:64-74`) **chưa từng chạy trên DOM thật** — ghi
> chú tại chỗ khai báo, `selectors.js:56-62`, nói thẳng như vậy. Selector sai → `countSources()`
> trả `null` (`automation.js:299`) → `confirmSourceAdded` đi ra nhánh `verified:false, ok:true`
> (`automation.js:337-344`).

Trên đường DOM hôm nay, `verified:false` vẫn còn một lưới đỡ phía dưới: hộp thoại **thật sự** đã
đóng, nút **thật sự** đã được bấm, snackbar đã được quét (`automation.js:257-272`) — 002 tuyên bố
tín hiệu đó chưa đủ, nhưng nó không phải số không.

Trên đường RPC, nếu selector danh sách Nguồn sai thì **không còn gì cả**. Một lượt 89 video với
rpc id đã mục nát sẽ cho ra 89 mục `done, verified:false` — không phân biệt được với 89 mục thật sự
đã vào mà chỉ là không đọc được danh sách.

**Trả lời thẳng câu 3:** cơ chế phát hiện lúc chạy đáng tin **là cơ chế mà 002 vừa xây, không phải
cơ chế mà 001 sẽ xây** — và nó chỉ đáng tin sau khi `sourceList`/`sourceItem` được kiểm trên DOM
thật. Chừng nào chưa kiểm, câu trả lời trung thực cho ticket là: **chưa có cơ chế phát hiện nào
đáng tin.**

---

## 4. Đảo ngược tốn gì: đây là điểm chí tử

Gỡ code thì rẻ (thêm file mới + một công tắc + một trường override, ràng buộc 1 cấm đụng
`automation.js`). Đắt nằm ở ba chỗ khác.

### 4a. Ba trong sáu trường của hợp đồng hiện tại không sản xuất được từ response RPC

Hợp đồng: `reply()` ở `src/notebooklm/content.js:73-84` trả
`{ ok, error, limit, verified, unverified, sourceAdded }`. Ticket hứa *"content.js không phải đổi"*
— lời hứa đó chỉ giữ được nếu RPC sinh ra đủ sáu trường **với đúng nghĩa cũ**.

**`limit` — mất.** `isLimitError()` khớp theo **chữ hiển thị** (`automation.js:215-218`) trên
`limitPatterns` là các câu tiếng Anh/Việt của giao diện (`selectors.js:123-126`). Envelope RPC
không có chữ đó. Mất `limit` → mất `fatal: true` ở cả bốn call site
(`service-worker.js:864`, `:894`, `:987`, `:1014`) → mất nhánh dừng hàng đợi
`if (result.fatal)` (`service-worker.js:1118`). Hậu quả cụ thể trên lượt 89 video chạm trần
notebook: thay vì **một** lần dừng sạch, ta được **mọi mục còn lại đều `error`**.

Ghi chú kèm: ticket hỏi *"Đường RPC báo giới hạn 50 nguồn kiểu gì?"* (`001-notebooklm-rpc.md:62`).
Con số 50 đã **cũ**; 003 đo thật trên hộp thoại là **1/300** và đã sửa ghi chú
(`src/common/shared.js:95-96`). Ticket 001 chưa được cập nhật theo.

**`verified` — rỗng hoá.** `verified` chỉ có nguồn duy nhất là `countSources()`, vốn là **DOM**
(`automation.js:290-300`). Hai lối, cả hai đều xấu:
- RPC **giữ** phép đếm → giữ luôn cửa sổ chờ 8 s (`automation.js:311-316`) = 11 phút 52 s cho lượt
  89 video, tức là **nuốt sạch 3–9 phút vừa mua được ở mục 2**. Ticket tự vô hiệu hoá chính mình.
- RPC **bỏ** phép đếm → `verified` luôn `false` → popup gắn chữ "chưa xác minh được" lên **mọi**
  mục (`src/popup/popup.js:69`, `:111-112`, `:136`, `:153-157`). Cảnh báo dán lên tất cả là cảnh
  báo không còn ai đọc. Đây đúng thứ `service-worker.js:1093-1098` đã viết ra để tránh:
  *"báo động giả ăn mòn đúng tín hiệu mà ticket 002 vừa dựng lên"*.

**`sourceAdded` — mất, và mất kiểu tốn tiền thật.** `sourceAdded = after > before`
(`automation.js:357`) cũng là suy ra từ phép đếm. Nó tồn tại để trả lời đúng một câu: *"Nguồn đã
ghi vào notebook chưa, dù kết quả không như mong đợi?"* Khi nó `true`, `service-worker.js:867` và
`:895` **dừng plan lại**, cố ý không rơi sang mode kế tiếp.

Bỏ phép đếm → `sourceAdded` luôn `false`. Khi request RPC treo/đứt sau lúc server đã ghi xong —
ca kinh điển của mọi đường mạng — plan `['url','text']` của video public
(`service-worker.js:857`) sẽ **rơi sang nhánh text và thêm chính video đó lần thứ hai**.
`WORKSPACE_PROTOCOL.md` external side effects: *"Không idempotent: chạy lại tạo bản trùng, gỡ phải
xoá tay trong UI."* Chi phí đảo ngược ở đây không phải giờ công — nó là notebook của owner.

### 4b. Bộ test đảo ngược vai: 534 test sẽ canh đường dự phòng, không canh đường chạy thật

Đo trong phiên này: `jsdom` bản **30.0.1**, `window.fetch === undefined` (`window.XMLHttpRequest`
thì **có**). `test/dom-harness.js:38-40` dựng JSDOM với `runScripts: 'outside-only'`.

Nghĩa là nếu `addUrlSource`/`addTextSource` thử RPC trước rồi rơi xuống DOM, thì dưới harness lần
nào `fetch` cũng ném ngay, và **toàn bộ bộ test hiện có chạy trọn vẹn trên nhánh dự phòng, xanh
đều, trong khi production chạy nhánh RPC không có lấy một test nào**. Bộ test thôi không còn là
bằng chứng về đường đang chạy thật.

Kèm một bẫy nhỏ hơn: vì `XMLHttpRequest` **có** trong jsdom, một bản cài đặt dùng XHR thay `fetch`
sẽ không ném — nó sẽ **thật sự đi ra mạng** trong lúc chạy test.

Ticket đã tự nhận *"Không có test đơn vị nào cho phần chạm mạng"* (`001-notebooklm-rpc.md:79-81`).
Điều nó chưa nhận là: hệ quả không phải "RPC không có test", mà là **"bộ test hiện có ngừng nói về
đường chạy thật"**.

### 4c. RPC không giảm bề mặt mục nát — nó cộng thêm

Sau khi làm xong, extension phụ thuộc: rpc id + hình dạng `f.req` + cách lấy `at` + **vẫn** toàn bộ
selector DOM (vì là fallback bắt buộc, ràng buộc 1) + **vẫn** `sourceList`/`sourceItem` (vì đó là
chỗ duy nhất sinh ra `verified`). Ba thứ mới, không bớt thứ nào.

`README.md:107` đã chốt đúng chuyện này trước cả ticket: *"Giao diện của nó nói chuyện với backend
qua `batchexecute` với các RPC id mà Google xoay vòng không báo trước — bám vào đó là bảo đảm sẽ
hỏng."* `WORKSPACE_PROTOCOL.md` Authority xếp *"đổi cam kết bảo mật ở `README.md:19` và
`README.md:107`"* vào diện Human must decide. Ticket 001 không nhắc `README.md:107` một chữ nào.

---

## ĐÍNH CHÍNH CỦA LEAD (2026-08-23) — đọc trước mục 5

Lập luận số 1 của mục 5 dùng con số **8 s × 89 = 11 phút 52 s** cho bước xác minh của ticket 002.
**Con số đó sai.** Tôi đã kiểm tận nơi:

- `settledSourceCount` (`src/notebooklm/automation.js:319-333`) gọi `waitFor` với
  `{ timeout: 8000, interval: 300 }`. `waitFor` trả về **ngay lần dò đầu tiên thấy đạt** —
  8000ms là **trần**, không phải nhịp chờ cứng. Đường thuận tốn ~300 ms.
- `confirmSourceAdded` (`automation.js:345-349`) **trả sớm** khi `before === null`, không chờ gì cả.
  Chính peer 002 đã sửa chỗ này ở cổng review, và ghi lý do ngay trong comment tại dòng 346-348.

Chi phí thật của bước xác minh ở đường thuận: **~300 ms × 89 ≈ 27 giây**, không phải 12 phút.
8 giây chỉ phải trả khi số Nguồn **không bao giờ đổi** — tức là ca Nguồn thật sự không vào, một
ca lỗi, không phải đường chạy bình thường.

**Khuyến nghị KHÔNG LÀM vẫn giữ, nhưng đứng trên hai chân chứ không phải ba** — lập luận 2 (cơ chế
phát hiện mục nát đáng tin duy nhất là phép đếm DOM, mà selector của nó chưa từng chạy trên DOM
thật) và lập luận 3 (chi phí đảo ngược trả bằng Nguồn trùng trên notebook owner) không bị ảnh
hưởng. Phần "nếu owner muốn nhanh hơn thì tiền nằm ở đâu" cũng không bị ảnh hưởng, và giờ càng
đáng làm hơn vì gain của RPC so với đường hiện tại lớn hơn báo cáo tưởng.

Bài học ghi lại: báo cáo của agent phải kiểm, kể cả khi nó kèm `file:line`. Dòng được trích đúng;
cái sai là đọc `timeout` của `waitFor` thành nhịp chờ cứng.

## 5. Khuyến nghị: **KHÔNG LÀM**

Ba dữ kiện quyết định, theo thứ tự sức nặng:

1. **Bước xác minh của 002 đắt hơn toàn bộ thứ RPC mua được.** 8 s × 89 = 11 phút 52 s
   (`automation.js:311-316`, số học đã có sẵn ở `automation.js:334-335`) so với 3–9 phút mua được
   (mục 2). Giữ xác minh thì RPC không còn nhanh; bỏ xác minh thì mất luôn `verified`, `limit`,
   `sourceAdded` — ba trong sáu trường của hợp đồng (mục 4a).
2. **Cơ chế phát hiện mục nát đáng tin duy nhất là phép đếm DOM**, mà selector của nó chưa từng
   chạy trên DOM thật (`selectors.js:56-62`). Chưa kiểm nó thì RPC không có tín hiệu thành công
   nào không đi qua chính envelope mà ticket tự nhận là "parse sai vẫn trông như thành công".
3. **Chi phí đảo ngược trả bằng notebook của owner, không bằng giờ công.** Mất `sourceAdded` →
   video public trùng bản khi request đứt giữa chừng → xoá tay.

Cộng lại: đổi hai ticket vừa nghiệm thu (002: 441 pass; 003: 534 pass) lấy 3–9 phút trên một lượt
89 video, trên một extension là công cụ cá nhân chạy tay. Không đáng.

### Nếu điều owner thật sự muốn là lượt chạy nhanh hơn

Cùng số phút đó nằm sẵn ở chỗ rẻ hơn nhiều và đảo ngược được bằng một dòng, không cần lock-in:
- `delayMs` mặc định 1200 (`shared.js:86`) — đã có sẵn ô chỉnh trong Options
  (`src/options/options.html:63-64`).
- `sleep(1200)` chờ snackbar muộn (`automation.js:262`) = 1 phút 47 s cho lượt 89.
- `sleep(600)` sau `pickChip` (`automation.js:249`) = 53 s.
- Ca hỏng: trần `ITEM_TIMEOUT_MS = 240000` (`service-worker.js:35`) — một mục kẹt đốt 4 phút, gấp
  đôi tổng gain của RPC ở nhánh URL. Đây là đòn bẩy lớn nhất trong cả lượt chạy.

Đó là các ticket "tiny/bounded", không phải "architecture lock-in".

### Điều kiện đảo ngược khuyến nghị — dấu hiệu nào thì mở lại 001

Mở lại **chỉ khi cả hai điều kiện dưới đây cùng đúng**, không phải một trong hai:

1. **`sourceList`/`sourceItem` đã được kiểm trên DOM thật** và `countSources()` trả số thật (không
   phải `null`) trên notebook của owner. Trước mốc này, RPC không có cách nào biết mình thành
   công. Đây là điều kiện tiên quyết, và nó là một ticket độc lập, rẻ, không lock-in.
2. **Một lượt chạy thật được bấm giờ đầu-cuối cho thấy chặng NotebookLM (mở hộp thoại → Chèn → hộp
   thoại đóng) tốn > 20 s mỗi Nguồn** — tức là gấp hơn năm lần con số 2,2–6,0 s mà code tự khai ở
   mục 2. Nếu đo ra như vậy thì tiền đề "gain nhỏ" của báo cáo này sai, và phải tính lại. Nếu đo ra
   quanh mức code tự khai, kết luận không đổi.

Rút ngay, kể cả khi đã bắt đầu, nếu gặp bất kỳ dấu hiệu nào sau:
- phải xin thêm permission trong `manifest.json` (ràng buộc 2 → `BLOCKED`, ticket đã tự quy định);
- bản cài đặt cần bỏ phép đếm Nguồn để đạt tốc độ — lúc đó nó không còn là "thêm đường bên cạnh"
  mà là gỡ ngầm ticket 002;
- xuất hiện dù chỉ **một** Nguồn trùng trên notebook thật trong lúc thử — không idempotent, và
  `sourceAdded` là thứ duy nhất chặn nó.
