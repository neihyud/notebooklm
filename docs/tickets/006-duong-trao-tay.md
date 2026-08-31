# 006 — Đường trao tay: gom link vào clipboard, người dùng tự dán

- status: draft — **chưa giao**
- class: cross-module (bốn bề mặt UI + service worker + một khoá storage mới) → xem `WORKSPACE_PROTOCOL.md`
- blocked-by: ticket 001 **đã nhận** (commit `25fde66`, `b4ceb85`, `d37a9ec` trên nhánh
  `fix/dan-dung-o-nhap`); việc mở còn lại của nó thuộc về owner, không phải writer. Nhưng cây
  làm việc **vẫn bẩn**: 6 file `src/options/*` + `src/popup/*` với 1.150 dòng chưa commit của
  một luồng khác (đo lại `git diff HEAD --numstat` 2026-08-25: đúng 1.150 dòng thêm trên 6 file
  `src/`). Luồng đó đang **dựng lại popup thành kiến trúc tab** — `src/popup/popup.html` có
  `<nav role="tablist">` với `#panel-queue`/`#panel-add`, thứ `HEAD` không có (318 dòng → 474
  dòng).

  **"Một writer tại một thời điểm" là quyết định của Lead, KHÔNG phải trích
  `WORKSPACE_PROTOCOL.md`** — đo 2026-08-25: `rg -ni writer WORKSPACE_PROTOCOL.md` cho **0
  hit**. Câu đó kế thừa từ `docs/tickets/002-notebooklm-bridge-tu-do.md:9`. Vì nó nằm ngay dưới
  dòng `class: … → xem WORKSPACE_PROTOCOL.md`, đọc lướt rất dễ tưởng là luật; ghi rõ ở đây để
  không ai chặn oan.

  Ràng buộc **thật** của protocol về cây bẩn là `WORKSPACE_PROTOCOL.md:111-112`, và nó ràng
  buộc **phép đo** chứ không ràng buộc việc sửa: *"Baseline phải đo trên một cây sạch"* +
  *"Con số đo giữa lúc peer khác đang sửa cây thì không tái lập được"*. `:113` còn chỉ luôn cách
  thoả mãn mà không cần ai commit: `git archive <sha> | tar -x -C $(mktemp -d)`.

  **Va chạm hẹp hơn "cả ticket bị chặn"** — đo từng mục 2026-08-25: mục 1, 2, 4, 5, 6, 7 chỉ
  đụng `src/youtube/content.js`, `src/docs/content.js`, `src/background/service-worker.js`,
  `src/common/shared.js`, **cả bốn đều sạch**. Chỉ **nửa UI của mục 3** (`popup.html`,
  `popup.js`, `popup.css`) rơi vào chỗ bẩn; nửa service worker của mục 3 thì sạch. Xem "Thứ tự
  triển khai".

  Ghi cho rõ để không ai quy nhầm: `CONTEXT.md` cũng đang bẩn (+13/−8), nhưng **đó là công việc
  từ vựng của chính ticket này**, không phải của luồng UI kia. Đừng chờ nó commit.
- ~~**Một xung đột văn bản Lead phải chốt trước khi giao**~~ — **đã tự tan 2026-08-25.** Xung
  đột cũ là: ticket này sửa `src/notebooklm/content.js`, trong khi
  `docs/tickets/002-notebooklm-bridge-tu-do.md:51` ghi *"`src/notebooklm/content.js` **không
  được sửa**"*. Sau khi mục 6 bị gỡ xuống còn "chỉ nhảy sang tab", ticket **không còn gửi
  message nào tới tab NotebookLM**, nên không còn `case` nào để khai và file đó không bị đụng.
  Giữ lại ghi chép vì phần *lập luận* vẫn còn giá trị nếu ai đó mở lại: ràng buộc mà 002 viện
  dẫn **không có trong 001** — `001-notebooklm-rpc.md:27-29` chỉ nói file này *không phải* đổi,
  tức mô tả phạm vi của 001, không phải lệnh cấm.
- quyết định nền: `docs/adr/0001-duong-trao-tay.md` (owner duyệt 2026-08-24). Đừng mở lại.
- từ vựng: `CONTEXT.md` → mục "Ai đưa vào". Dùng đúng **Đường trao tay**, **Bó link**,
  **Sổ đã copy**; đừng đặt tên mới.

## Bối cảnh

NotebookLM nhận nhiều URL trong một lần dán, phân tách bằng khoảng trắng hoặc xuống dòng —
tài liệu chính thức của Google, `support.google.com/gemininotebook/answer/16215270`, đọc
2026-08-24: *"When uploading multiple web URLs, separate links by a space or a new line."*
Toàn bộ ticket này đứng trên đúng một câu đó.

Extension hiện có mọi thứ cần để dựng một Bó link, chỉ thiếu cái ống dẫn ra clipboard:
`videoIdFrom` + `canonicalUrl` (`src/common/shared.js:209-239`) cho URL YouTube sạch,
`usableUrl` (`src/docs/sidebar.js:37-57`) cho link tài liệu đã lọc, `docKey`
(`src/common/shared.js:266-286`) làm khoá khử trùng, và tiền lệ ghi clipboard **không cần
quyền mới** ở `src/youtube/panel.js:141` và `src/options/options.js:139`.

## Kết quả cần có

### 1. Bốn bề mặt sinh được Bó link

| Bề mặt | Neo | Dữ liệu đã có tại chỗ |
|---|---|---|
| (a) nút **thứ ba** cạnh Like/Share | dựng ở `ensureWatchButton` (`src/youtube/content.js:87`) | một `videoId`; privacy hỏi được qua `T.describe()` |
| (b) thanh nổi tick nhiều video | `src/youtube/content.js:19`, `:193`, `:325` | Map `selected`; privacy **chỉ từ huy hiệu** (`:204`) |
| (c) bảng "Import toàn bộ" | `src/youtube/content.js:358-361` | `all`/`usable` từ `B.call('playlist')`; privacy cũng chỉ từ huy hiệu |
| (d) bảng chọn docs | `src/docs/content.js:189`, `:309` | URL đầy đủ, đã qua `usableUrl` |

**Bề mặt (a) là một nút MỚI, không phải sửa nút cũ.** `ensureWatchButton` (`:87`) đang dựng hai
nút — `#nblm-watch-button` (`:98`) và `#nblm-transcript-button` (`:108`, `:116`); ticket này
thêm nút thứ ba. Nút *NotebookLM* cũ và `onWatchClick` (`:142`) **giữ nguyên hành vi xếp hàng**: nó
là lối vào người dùng đã quen, và mục 6 còn kéo tab đi nơi khác — đổi ngầm là làm hỏng một thao
tác đang chạy tốt.

Cùng lý do, **`NBLM_SEND_CURRENT` (`:130`) giữ nguyên**. Đó là lối vào thứ năm, gọi từ nút
"→ NotebookLM" trong bảng transcript (`src/youtube/panel.js:159-160`), và nó mang **đúng nhãn**
với nút ở mục (a). Hai nút cùng chữ mà rẽ hai hướng khác nhau là một cái bẫy; hoặc đổi cả hai,
hoặc không đổi cái nào — ticket này chọn không đổi cái nào.

Bề mặt (c) có một chi tiết dễ tưởng là nhỏ: `confirmDialog` (`src/youtube/content.js:399`)
resolve một **boolean**, và hai nút dựng qua `barButton` (`:423-424`). Thêm hành động thứ ba là
**đổi chữ ký hàm**, không phải thêm một cái nút.

Popup (`src/popup/popup.js:413-421`) **hoãn sang ticket sau**: ba nút collect không cầm danh
sách URL — nó nằm trong service worker và **response không cầm URL nào**:
`{found, added, skipped, total}` (`src/background/service-worker.js:1211`, `:1236`, `:527`),
riêng playlist thêm `{blocked, truncated, title}` (`:1259`, `:1294`). Gắn nút ở đó bắt buộc đổi
contract cả ba message. Không đáng cho bản đầu.

### 2. Hình dạng Bó link

URL trần, mỗi dòng một cái, ngăn bằng `\n`. Không tiêu đề, không dòng chú thích, không dòng
trống — mọi thứ không phải URL đều là rác đối với ô nhập của NotebookLM.

- **YouTube**: `canonicalUrl(videoId)` — dạng `watch?v=`. Đây là dạng **duy nhất** có báo cáo
  chạy được; `youtu.be` và các tham số `&list=`/`&t=`/`&pp=` là ô trống hoàn toàn, không một
  nguồn nào nói tới. `canonicalUrl` **không có guard**: `canonicalUrl(null)` trả
  `'https://www.youtube.com/watch?v=null'` (đo thật). Lọc null trước khi map.
- **Tài liệu**: URL mà bảng chọn đang hiện — tức `row.url` của `checkedRows()`
  (`src/docs/content.js:190`), đã qua `usableUrl` nên neo trong trang bị bỏ còn hash-route
  `#/guide` thì giữ nguyên (`src/docs/sidebar.js:51-56`). **Không** với sang `item.url` của Mục
  docs: `normalize()` lưu URL **thô** ở đó (`src/background/service-worker.js:488`). Và cũng
  đừng với sang `key`: nó là *khoá so trùng*, không phải một "bản sạch" để dán — gạch đầu dòng
  ngay dưới nói vì sao.
- **Hai vai, hai chuỗi.** Chuỗi để *dán* là URL người dùng nhìn thấy; chuỗi để *so trùng* là
  `docKey`. Đừng gộp: `docKey` đổi chuỗi ngoài ý muốn (`/tiếng-việt` → `/ti%E1%BA%BFng-vi%E1%BB%87t`,
  `:443` bị bỏ, và `/` cuối bị **cắt** — `src/common/shared.js:283`; riêng URL trần host thì
  ngược lại, được thêm `/`). Dán vẫn chạy, nhưng URL hiện ra khác cái người dùng copy.

Một Bó = **một bề mặt, một loại**. Không dựng cơ chế gộp nhiều bề mặt.

**Bó rỗng thì không ghi clipboard, và mục 6 không chạy.** Lọc private, lọc trùng, lọc cửa đo —
cả ba đều có thể ăn sạch danh sách. Khi còn 0 link: **giữ nguyên clipboard cũ của người dùng**
(`writeText('')` sẽ **xoá trắng** thứ họ đang giữ), **không** nhảy sang tab NotebookLM, và nói
rõ vì sao còn 0, tách bạch ba lý do. "Đã copy 0 link" là một câu vô nghĩa; "cả 12 link đều đã
có trong Sổ" thì hành động được — kèm một cách bấm để copy lại cả 12.

Đây là ca **thường gặp**, không phải ca biên: bấm *Import toàn bộ* lần thứ hai trên cùng một
playlist là rơi thẳng vào nó. Repo có sẵn hai tiền lệ đối nghịch, đừng chọn nhầm: `enqueue()`
phía content script chặn im lặng (`if (!items.length) return null;` —
`src/youtube/content.js:48`), còn `importEverything` thì báo ra
(`toast('Không tìm thấy video nào import được ở đây.', 'warn')` — `:363-365`). Ở đây theo tiền
lệ thứ hai.

### 3. Sổ đã copy

Một khoá `chrome.storage.**local**` riêng, mỗi dòng ghi ba trường: URL, thời điểm, gom từ đâu
(playlist/kênh/trang nào). Giữ mãi; xoá bằng một nút tay, đối xứng với *Xoá xong* của Hàng đợi.

**Không dùng `storage.sync`.** Cả repo dùng `local` (0 chỗ gọi `sync`), và `unlimitedStorage`
(`manifest.json:9`) chỉ áp cho `local`. `sync` có hạn ngạch ~8KB mỗi item: Sổ sẽ chặn ở khoảng
trăm dòng đầu rồi ghi hỏng **im lặng**, trong khi theo thiết kế Sổ chỉ có lớn lên.

**Ai sở hữu Sổ: service worker** — và nó cũng sở hữu luôn phép khử trùng. Lý do là ràng buộc
đọc được chứ không phải sở thích kiến trúc: `itemKey()` là hàm **cục bộ** của service worker
(cả repo chỉ có hai chỗ — định nghĩa `service-worker.js:465`, dùng `:513`) và **không** nằm
trong `src/common/shared.js`, nên bốn bề mặt content script không gọi được.

Nói cho chính xác: content script *đọc được* Hàng đợi — `shared.js` có `getQueue`/`setQueue`
(`:196-201`) và nó được nạp vào cả ba bundle content script. Cái chúng không có là **luật
khoá**. Đừng chép `itemKey` sang đó để lấp: bản chép sẽ trôi khỏi bản gốc, và đó đúng hình dạng
"đường dữ liệu song song" mà repo này đã dính một lần. Cũng đừng cho content script `setQueue`
— nó đua ghi với `setQueue()` của service worker (`:524`).

Luồng: bề mặt gửi `{ urls }` lên → service worker trả `{ keep, dropped }` → content
script `writeText` → **báo ngược lên rồi service worker mới ghi Sổ**. Thứ tự này bắt buộc:
`writeText` từ chối được (ràng buộc 6), và ghi Sổ trước khi copy xong là để Sổ nói dối — lần
sau nó sẽ lọc mất đúng những link chưa bao giờ tới clipboard.

**UI của Sổ:** một khu gập trong popup, cạnh Hàng đợi, kèm nút *Xoá sổ*. Thêm UI vào popup
**không** phải hỏi owner, dù `docs/tickets/003-mot-luot-chay.md:42` nói ngược: câu đó đã lỗi
thời. `WORKSPACE_PROTOCOL.md:20-30` xếp "bỏ hoặc đổi nút trong popup" vào mục *"Đề xuất bổ sung
— CHƯA DUYỆT, chưa binding"*, và `:32-37` ghi thẳng rằng khối tóm tắt cũ mà 003 viện dẫn là một
**đường dữ liệu song song đã bị bác**. Đừng escalate mục này. Đặt ở popup chứ không
ở Cài đặt vì câu hỏi mà Sổ trả lời — "cái này copy rồi chưa" — luôn xuất hiện ngay cạnh Hàng
đợi, không phải trong lúc chỉnh cấu hình.

Khử trùng tra **cả** Sổ đã copy **lẫn** Hàng đợi, nói cùng ngôn ngữ khoá với `itemKey()`
(`src/background/service-worker.js:465-468`). Lưu ý `enqueue()` cố ý bỏ qua Mục `ERROR` khi khử
trùng (`:511-522`), nên Bó link phải tự khử lại chứ không tin được vào khoá cũ. Link bị loại
phải **hiện ra số**, kèm một cách bấm để copy cả những cái đã có — im lặng bỏ link là đúng lỗi
mà `sidebar.js` đã dính hai lần.

### 4. Cửa đo HTML thô, chỉ cho bề mặt (d)

Dán link docs vào NotebookLM là chính cái lỗi extension này sinh ra để chữa: máy chủ Google
fetch URL đó và **không chạy JavaScript**, nên trang nào dựng thân bài phía client sẽ ra Nguồn
rỗng hoặc chỉ có menu. Trang nào thì có, trang nào thì không — đó là thứ phải **đo từng
trang**, không suy từ tên bộ tạo docs (xem mục README, phần A). Nút copy ở
bảng chọn docs vì thế **khoá sau một phép đo**:

1. Service worker `fetch` HTML thô, **ẩn danh**. `host_permissions` đã có `http://*/*` +
   `https://*/*` (`manifest.json:22-23`), **không cần quyền mới**. `fetch` **có** trong service
   worker (nó không phải DOM API) — chỉ khâu *parse* mới phải đi chỗ khác, xem điểm 2. Nên đường
   đi là: SW fetch → gửi chuỗi HTML về tab → tab parse.

   **"Ẩn danh" là thứ phải GÕ RA, không phải thứ được cho.** Tra 2026-08-25: mặc định của
   `fetch` là `credentials: 'same-origin'` (MDN, `Web/API/RequestInit`) — nghe thì có vẻ đã an
   toàn, nhưng doc chính thức của Chrome ghi thêm một luật riêng cho extension:

   > *"Requests from an extension to a third-party are treated as same-site if the extension has
   > host permissions for the third-party. This means `SameSite=Strict` cookies can be sent."*
   > — `developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies`, đọc 2026-08-25

   Repo này có host permission cho **mọi** http/https, nên câu đó phủ đúng mọi URL đi qua cửa
   đo. Một report đo thật trên chromium-extensions cùng chiều: *"if I have proper HOST
   permissions for the site I'm calling with fetch, then the cookies from the main browser are
   indeed included in the request"* (thread "Cookies in Service Worker"; đây là quan sát của
   người dùng, **không** phải phát biểu của Chrome team — ghi vậy cho đúng hạng bằng chứng).

   Vậy nên: **`fetch(url, { credentials: 'omit' })`, viết thẳng ra, và một comment tại chỗ nói
   vì sao.** Không có nó thì cửa đo hỏng theo đúng chiều nguy hiểm nhất: một trang nội bộ chỉ
   đọc được khi đã đăng nhập sẽ đo ra "có thân bài" trên máy owner, rồi NotebookLM — fetch ẩn
   danh — nhận về trang đăng nhập và nuốt một Nguồn rỗng. Cửa đo mà nói dối theo chiều BẬT là
   tệ hơn không có cửa.

   Lưu ý cho người đo lại: phép đo 19 trang ở điểm 3 chạy bằng `node` + `jsdom`, không có
   cookie jar, nên nó **đúng là ẩn danh** — số liệu đó vẫn dùng được. Cái chưa đo là đường
   `fetch` trong service worker thật.
2. Parse bằng `DOMParser` rồi gọi `fromDocument(doc, url, opts)` — đã export ở
   `src/docs/extract.js:249` và chạy được ngoài DOM sống (`markdown.js` sạch hoàn toàn).

   **Nhưng `DOMParser` KHÔNG có trong service worker MV3, nên bước này không chạy ở đó.** Doc
   chính thức của Chrome nói thẳng: *"Because they can't access the DOM or the `window`
   interface, you'll need to move such calls to a different API or into an offscreen document"*
   (`developer.chrome.com/docs/extensions/develop/migrate/to-service-workers`, đọc 2026-08-25).
   Bằng chứng phụ mà mạnh: `chrome.offscreen` có sẵn **một `reason` tên là `DOM_PARSER`** — cái
   reason đó không tồn tại nếu service worker tự parse được.

   Hai đường, chọn đường thứ nhất:

   - **Parse ở content script tài liệu.** Tab đó **đang mở sẵn** khi bảng chọn bật, `DOMParser`
     có sẵn, không phải dựng gì. Service worker chỉ `fetch` (nó fetch được — `fetch` không phải
     DOM API) rồi gửi chuỗi HTML về tab. Ít bộ phận chuyển động nhất.
   - **Offscreen document.** Chạy được, nhưng **đắt hơn thật sự chứ không phải trên lý thuyết**:
     repo chỉ được có **một** offscreen document, và document hiện tại được tạo với
     `reasons: ['BLOBS']` (`src/background/service-worker.js:669`) cho đường tải file. Tệ hơn,
     `hasDocument()` short-circuit ngay trước đó (`:664-665`), nên **đường nào tạo trước thì chốt
     luôn `reasons`** và đường kia lặng lẽ đi nhờ. Còn phải thêm message type vào
     `HANDLED` của `src/background/offscreen.js:15` (hiện chỉ nhận `offscreen-blob-url`).

   Chọn offscreen thì phải xử lý cả hai chuyện trên và nói ra trong handback. Đừng chọn nó chỉ
   vì "service worker nên tự làm hết".
3. Chữ ký của "vỏ JS rỗng" là **`how === 'fallback'` KÈM `chars` gần 0**, không phải mỗi
   `chars`: `chars` là độ dài Markdown *sau* khi dọn `JUNK_SELECTORS` (`extract.js:185`), nên
   `chars` thấp có hai nguyên nhân khác hẳn nhau gộp làm một.

   **`N = 100`.** Đo 2026-08-25 trên **19 trang thật**, fetch ẩn danh + `fromDocument` trong
   jsdom, `opts = {}` nên `floor = Math.max(200, Number(minChars) || 0) = 200` (`extract.js:79`):

   - **Chặn dưới** — sáu trang vỏ JS thật, **năm** bộ tạo khác nhau (docsify ×2, Angular
     Material, swagger-ui, ng-bootstrap, Vite SPA): `chars` đúng bằng **0**, không phải "gần 0".
     (Bản trước viết "sáu bộ tạo" — đếm nhầm trang thành bộ tạo, mà đây đúng là con số dùng để
     lập luận rằng `chars = 0` không phải trùng hợp của một bộ tạo. Năm vẫn đủ, nhưng phải ghi
     đúng năm.)
   - **Chặn trên** — trang SSR nhỏ nhất vẫn có chữ mà rơi `fallback` là `example.com` với
     **113** ký tự. Nên cửa sổ an toàn là `1 ≤ N ≤ 113`; chọn 100 để lệch về phía cao.
   - Hai lỗi **không cân nhau**, và đó là lý do chọn lệch: TẮT nhầm thì trang được nêu tên và
     người dùng đi đường Dán text (vốn là mặc định); BẬT nhầm thì NotebookLM lặng lẽ nuốt một
     Nguồn rỗng — đúng cái bug extension này sinh ra để chữa.

   **Đừng mượn `docsMinChars: 600`** (`src/common/shared.js:151`). Lý do là nó phục vụ quyết
   định khác — "trang này rỗng quá, mở tab ẩn đọc lại" (`src/docs/content.js:414`,
   `src/background/service-worker.js:926`, nhãn ở `src/options/options.html:120`). Hai quyết
   định khác nhau thì không dùng chung một ngưỡng, thế là đủ.

   **Bản trước của đoạn này đưa thêm một "bằng chứng thiệt hại", và bằng chứng đó SAI.** Nó
   viết: ở `floor = 600`, `docusaurus.io/changelog/3.5.1` tụt từ `main article` xuống
   `fallback`, "tức một trang SSR thật bị đọc thành vỏ JS rỗng". Đo lại 2026-08-25 (fetch +
   `fromDocument` trong jsdom): `{minChars: 600} → how = 'fallback', chars = **344**`. Cửa đo là
   `how === 'fallback' && chars < 100`, mà 344 ≥ 100 → trang **vẫn BẬT**, y hệt khi `floor = 200`.
   Không có thiệt hại nào cả.

   Đáng nói vì sao tôi sai: câu đó đánh đồng `fallback` với "vỏ JS rỗng" — **đúng cái nhầm mà
   ba dòng đầu của điểm 3 này bác**. Hai vế của cửa đo tồn tại chính vì `fallback` một mình
   không có nghĩa là rỗng. Ai định thêm một "bằng chứng đo được" vào đây thì phải chạy nó qua
   cả hai vế, không chỉ vế `how`.

   **Vế `chars` gần như không làm việc, nhưng đừng bỏ.** Trên 19 trang đo được, `how ===
   'fallback'` một mình đã tách đúng 17/17 trang docs. Vế `chars` chỉ cứu đúng hai ca:
   `example.com` (113) và `info.cern.ch` (212) — server-render thật, có chữ thật, mà vẫn rơi
   `fallback`. Đo 2026-08-25, **hai trang rơi vì hai cơ chế khác nhau**:

   - `info.cern.ch`: `score(body) = **-25,5**`, âm vì `- inLinks * 1.5` (`extract.js:75`) —
     trang gần như toàn link.
   - `example.com`: `score(body) = **+110**`, **dương**, và chữ của nó nằm đúng trong `h1`/`p`.
     Nó rơi `fallback` chỉ vì `110 < floor = 200` (`extract.js:79`, `:88`) — một cơ chế thứ ba.

   Bản trước gộp cả hai vào hai lý do và **cả hai đều sai với `example.com`**. Ghi ra vì đây là
   trang đặt ra chặn trên `N ≤ 113`; hiểu sai vì sao nó rơi là hiểu sai luôn cửa sổ an toàn.
   Gate chỉ xét `how` sẽ TẮT nhầm cả hai.

**Đo từng URL đã tick, và chỉ đo lúc bấm nút copy.** Không đo lúc mở bảng chọn: `flatten()`
(`src/docs/content.js:95-113`) duyệt hết cây sidebar và **không có trần** nào, một site
Docusaurus cỡ vừa là 200+ dòng — đo hết lúc bật panel là 200 fetch ẩn danh cho một cú bấm chưa
xảy ra. Vì vậy **nút copy luôn bật**; bấm xong mới hiện tiến trình đo rồi hiện kết quả
*"M/N trang có thân bài — copy M link, bỏ N−M"*. Trần đồng thời 3–5 ở ràng buộc 7 là nói về
đúng N phép đo này.

Trang không đạt ngưỡng thì **không vào Bó link** và được nêu tên, kèm gợi ý dùng đường Dán text
cho chúng — đường đó vẫn là mặc định của bảng chọn.

**Cửa đo này đã chạy thật, không phải đề xuất.** Lead đo 2026-08-24: `fetch` ẩn danh HTML thô
rồi `DOMParser` + `fromDocument` trong jsdom, trên năm trang docs thật:

| trang | `how` | ký tự Markdown | HTML thô |
|---|---|---|---|
| `docusaurus.io/docs` | `.theme-doc-markdown` | 10.573 | 50.595 |
| `vitepress.dev/guide/what-is-vitepress` | `.vp-doc` | 4.604 | 32.637 |
| `squidfunk.github.io/mkdocs-material/setup/` | `.md-content__inner` | 2.419 | 74.114 |
| `docs.python.org/3/tutorial/introduction.html` | `[role="main"]` | 17.153 | 71.833 |
| `docsify.js.org/#/quickstart` | **`fallback`** | **0** | 7.894 |

Chữ ký hai vế phân biệt sạch: bốn trang đầu có `how` là một selector thật, trang docsify —
bộ tạo docs duy nhất trong nhóm render hoàn toàn phía client — rơi về `fallback` với 0 ký tự.

**Cửa đo trả lời "Nguồn có RỖNG không", KHÔNG trả lời "Nguồn có SẠCH không".** Máy chủ Google
cào cả trang, không cào riêng khối `pickRoot` chọn ra — nên một trang qua cửa vẫn cho ra Nguồn
dính nguyên sidebar và footer lặp lại ở mọi trang. Đo được cái giá đó, cùng ngày, cùng cách:

| trang | khối thân bài | text cả trang | phần dôi ra |
|---|---|---|---|
| `docusaurus.io/docs` | 10.573 | 12.247 | ~14% |
| `vitepress.dev/guide/what-is-vitepress` | 4.604 | 5.327 | ~14% |
| `docs.python.org/3/tutorial/introduction.html` | 17.153 | 19.129 | ~10% |
| `squidfunk.github.io/mkdocs-material/setup/` | 2.419 | 6.274 | **~61%** |

Phép đo này **ước lượng thấp**: cột "khối thân bài" là độ dài Markdown, mà Markdown thêm ký tự
cú pháp (`#`, backtick, `-`) so với text thuần, nên phần dôi ra thật còn cao hơn con số trên.
Kết luận đứng được là: với đa số trang thì Dán link mất khoảng một phần bảy nội dung vào rác
điều hướng, nhưng có trang mất quá nửa — nên **đừng gỡ đường Dán text cho tài liệu**, và bảng
chọn phải nói ra sự đánh đổi này chứ đừng để người dùng tự phát hiện.

**Không dùng `fromUrl`** (`src/docs/extract.js:227`): nó fetch với `credentials: 'include'` từ
content script, tức cùng origin **kèm cookie đăng nhập**. Fetcher của Google ẩn danh và
cross-origin. Docs nội bộ sẽ đo ra "có thân bài" trong khi Google chỉ thấy trang login — sai
đúng ở ca nguy hiểm nhất, và sai im lặng.

Chỗ này `'include'` là **cố ý và đúng** cho việc nó đang làm — nó phục vụ Dán text, mà Dán text
thì trích nội dung ngay trên máy người dùng nên đọc được tài liệu nội bộ mới là tính năng.
Không phải suy đoán: comment tại `:223-224` nói đúng thế, và `README.md:94` bán nó ra ngoài như
một tính năng (*"vì chạy trong content script nên fetch đi kèm cookie phiên: tài liệu nội bộ
cần đăng nhập vẫn đọc được"*). Đừng "sửa" nó. Điều phải rút ra là: cửa đo cần một
đường fetch **riêng**, không tái dùng đường này. Và đừng nghĩ chỉ cần bỏ chữ `'include'` đi là
xong — theo doc Chrome trích ở điểm 1, mặc định trong extension có host permission vẫn gửi
cookie; phải gõ `'omit'`.

**Không dùng `sidebar.js` để gom link từ HTML thô.** `rate()` đọc `getBoundingClientRect` +
`window.innerWidth/innerHeight` (`:122-125`); trên document không layout thì rect = 0×0 và cả
khối chấm điểm bị bỏ qua **không báo lỗi** — đo được ca navbar đánh bại sidebar thật. Bảng chọn
đang chạy trên tab sống, giữ nguyên như thế.

### 5. Chỉ player response cấp phép vào Bó link

Một URL YouTube vào Bó link **khi và chỉ khi**, trong cùng cú bấm đó, một lượt hỏi player
response đã trả về và thoả **cả ba**:

1. `meta.videoId === videoId` mình vừa hỏi (`src/youtube/page-bridge.js:300`);
2. `meta.privacy === 'public'` (`:292-297`);
3. `meta.playable === true` (`:314`).

Mọi ca khác — `private`, `unlisted`, lượt hỏi reject, quá hạn, `meta` null, `videoId` lệch,
`playable === false` — **đi Hàng đợi**, đúng như hôm nay. **Đúng một hàm** cầm vị ngữ này, ba bề
mặt (a)(b)(c) gọi chung; đừng chép ba điều kiện ra hai chỗ.

#### Ticket này LÙI một bất biến — nhưng bất biến đó hôm nay đã hở sẵn một chỗ

Hôm nay extension **gần như** cưỡng chế được câu ở `README.md:15` (*"Không bao giờ gửi URL cho
NotebookLM"*), và cơ chế đọc được:

- `resolveMeta` (`src/background/service-worker.js:552-569`) trả sớm **chỉ khi** privacy đã có,
  khác `UNKNOWN`, **và** có `title` (`:553`). Còn lại là **bắt buộc** một vòng `YT_DESCRIBE`, và
  `:557` **ném lỗi** nếu hỏi không được — fail-closed.
- `planFor(PRIVATE)` trả `['text']`, kèm đúng comment *"Không bao giờ thử URL"* (`:838-840`).
- Nhưng nhánh `default` của `planFor` (tức `UNKNOWN`) trả `['url', 'text']` (`:847-848`).

**Bản trước của ticket viết rằng thứ "duy nhất" giữ nó khỏi thành lỗ hổng là `resolveMeta`
không bao giờ để một Mục tới `planFor` với privacy `unknown`. Đo lại 2026-08-25 thì câu đó
SAI, và cái sai nằm ở chữ "không bao giờ".** Có một đường đọc được:

`resolveMeta` kết thúc bằng `return (await patchItem(...)) || item` (`:560-568`). `patchItem`
trả `null` khi Mục **không còn trong Hàng đợi** (`findIndex` ra `-1` → `return null`). Lúc đó
`resolveMeta` trả lại **`item` chưa được vá** — mà ta chỉ vào tới đây vì `item.privacy` đang
falsy hoặc `UNKNOWN` (điều kiện `:553`). Rồi `importVideo:860` gọi `planFor(resolved.privacy)`
→ rơi `default` → `['url', 'text']` → `:868` gửi `NLM_ADD_URL`.

Cửa sổ để chuyện đó xảy ra **không hẹp**: lượt `YT_DESCRIBE` có timeout **60 giây** (`:556`).
Người dùng xoá một Mục khỏi Hàng đợi trong lúc chờ là đủ. Nếu Mục đó là video private thì URL
của nó **được gửi cho NotebookLM** — đúng thứ `README.md:15` hứa không bao giờ.

Nói cho hết, hai chỗ **không** phải lỗ: (a) `privacy: meta.privacy || PRIVACY.UNKNOWN` ở `:565`
là code phòng thủ **chết** hôm nay, vì `metaFrom` luôn đặt `privacy` truthy
(`page-bridge.js:292`) nên `meta.privacy` không rỗng được; (b) nhánh `throw` ở `:557` vẫn
fail-closed đúng như mô tả. Đừng gộp ba thứ này làm một khi viết ticket sửa.

**Việc phải làm với phát hiện này**: nó **nằm ngoài** ticket 006 (đây là đường Lượt chạy, không
phải Bó link) nên đừng sửa ở đây — nhưng cũng đừng để im. Hai chuyện đáng ngờ trong cùng một
đường: một Mục đã bị xoá vẫn chạy tiếp tới bước thêm Nguồn, và nó chạy tiếp với privacy chưa
phân giải. Cần ticket riêng.

Bó link là **đường đầu tiên bỏ hẳn service worker ra ngoài**: content script → clipboard, không
qua `resolveMeta`, không qua `planFor`. Bất biến trên **không tự đi theo**. Nên mục này không
phải "thêm một lớp bảo vệ cho chắc" — nó là **dựng lại cái chốt đang chạy**, ở phía content
script. Ai làm phải hiểu mình đang tháo cái gì.

Ca hỏng đo được, không phải giả định: `metaFrom` mở bằng `let privacy = 'public'`
(`page-bridge.js:292`) — đó là **fall-through, không phải phép đo**. `metaFrom({})` trả
`privacy: 'public'`, `playable: true`, `videoId: null`. Chính vì thế mới cần cả ba điều kiện chứ
không phải mỗi điều kiện (2).

Còn ở phía huy hiệu: owner để YouTube tiếng Đức thì nhãn là `Privat` / `Nicht gelistet`, cả hai
bộ đọc đều trượt và trả `unknown`. Video private của **chính owner** vẫn `accessible` vì
`accessible: r.isPlayable !== false` (`page-bridge.js:482`) đúng với video mình sở hữu, nên nó
sống qua bộ lọc `usable` (`content.js:359`) và theo luật cũ thì lên clipboard. `hl` lấy từ
`INNERTUBE_CONTEXT` của chính trang (`page-bridge.js:104-118`); `'en'` chỉ là fallback khi không
có `ytcfg` — đây là cấu hình bình thường, không phải ca biên. Đúng hình dạng "hằng số chép tay
không có đối chứng runtime" mà `WORKSPACE_PROTOCOL.md:52-55` xếp **rủi ro số 1**.

#### Hai hạng bề mặt: bảng vẫn cần, nhưng cột luật đổi

Chữ `unknown` mang hai nghĩa **trái ngược** ở hai hạng — một bên *đã đo và trượt*, một bên *chưa
đo ai cả*. Đó là lý do bảng này không gộp được thành một câu.

| hạng | bề mặt | nguồn privacy | `unknown` nghĩa là | luật |
|---|---|---|---|---|
| biết thật | (a) trang xem video, phím tắt ở mục 7 | `T.describe()` → player response (`src/youtube/transcript.js:280-282`) | **đã hỏi, hỏi trượt** | Hàng đợi. Không hỏi lại để cứu Bó |
| chỉ có huy hiệu | (b) thanh nổi, (c) bảng Import toàn bộ | (b) `readItem` (`content.js:193-212`); (c) `privacyFromRenderer` (`page-bridge.js:432-440`) | **chưa hỏi ai cả** | huy hiệu chỉ được quyền **loại**; còn lại bắt buộc một lượt hỏi player response rồi mới quyết |

**Đính chính một dữ kiện của bảng bản trước**: nó gán cả (b) lẫn (c) cho `privacyFromRenderer`.
Sai. (b) đọc DOM bằng `readItem` với **một cặp regex khác** — `/\bprivate\b|\brieng tu\b/`,
`/\bunlisted\b|khong cong khai/` (`content.js:209-210`) — chạy **sau** `norm()`, vốn có bỏ dấu
(`src/common/shared.js:329-338`). (c) đọc JSON bằng `privacyFromRenderer` với `/private|riêng tư/`,
**không** bỏ dấu. Hai bộ đọc, hai luật, đã trôi khỏi nhau. Sửa một chỗ rồi báo xong là để hở
chỗ kia.

**Lập luận "bằng chứng dương" của ADR 0001 không bị mở lại.** Gạch đầu dòng đó nói về **huy
hiệu**, và vẫn đúng nguyên: huy hiệu trả `unknown` cho video public, nên "chỉ copy khi huy hiệu
nói public" sẽ lọc sạch mọi video. Đúng vì thế mà huy hiệu bị hạ xuống vai **chỉ được loại**.
Cái ADR không nói — và bản mục 5 trước suy nhầm — là "(b)/(c) chỉ có huy hiệu". Không phải:
`page-bridge.js` khai `world: "MAIN"` cho **mọi** trang `youtube.com` (`manifest.json`,
`content_scripts[0]`), và `describe(videoId)` gọi được cho **videoId bất kỳ** qua
`NBLM_BRIDGE.call('meta', …)` (`transcript.js:280-282`) → `innertube('player', { videoId })`
(`page-bridge.js:270`). Không quyền mới, không message type mới.

#### Ba cửa, và cái neo

**Cửa 1 — huy hiệu, miễn phí, CHỈ ĐƯỢC LOẠI.** `privacyHint` (`content.js:212`) hoặc `privacy`
(`page-bridge.js:479`) bằng `private`/`unlisted` → thẳng Hàng đợi, không tốn request nào.
`accessible === false` (`:482`) cũng loại ở đây. Huy hiệu **không bao giờ** được quyền nhận.

**Cửa 2 — khử trùng trước.** Phần còn lại đổi sang `canonicalUrl(videoId)` rồi qua vòng khử
trùng của service worker ở mục 3. Chỉ `keep` mới tốn request.

**Cửa 3 — hỏi player response, tốn tiền, CHỈ ĐƯỢC NHẬN.** Ba điều kiện ở đầu mục.

**Cái neo — chỗ một bản luật ngây thơ sẽ thủng:** cửa 3 phải chạy trên **đúng danh sách sắp
được truyền cho `writeText`**, không phải trên `keep`. Lý do là ràng buộc của chính ticket này:
mục 2 và mục 3 đều **bắt buộc** có một nút *copy lại cả những cái đã có*, và danh sách của nút
đó là `dropped` — thứ chưa bao giờ đi qua cửa 3. Vòng lặp tự đóng: cửa 3 đẩy video bị loại
**sang Hàng đợi**, mà khử trùng lại tra **cả Hàng đợi**, nên đúng video private cửa 3 vừa chặn ở
lượt 1 sẽ nằm trong `dropped` ở lượt 2 và lên clipboard qua cái nút đó. Viết thành một câu cho
writer: **không có đường nào tới `writeText` mà không qua cửa 3.**

**Cửa 3 chạy lúc nào, ở từng bề mặt:**

- **(a)** — n=1, hỏi tại cú bấm nút thứ ba. `onWatchClick` (`content.js:142`) và lượt
  `T.describe` của nó **giữ nguyên**, không mượn qua lại (mục 1).
- **(b)** — hỏi từng `videoId` đã tick, tại cú bấm copy. Đừng coi (b) là "vài cái":
  `act === 'all'` (`content.js:313-319`) tick **mọi** thẻ trên trang đã cuộn.
- **(c)** — **sau** khi người dùng chọn hành động copy trong bảng xác nhận, không phải lúc quét
  xong. Đối xứng đúng với cửa đo docs ở mục 4: bấm xong mới hiện tiến trình `k/N`. Nhờ vậy bấm
  **Huỷ** tốn 0 lượt hỏi.

#### Giá, và một việc mới phải làm trước

Một video = một lượt `innertube('player')`. Playlist 200 video mà huy hiệu không loại được cái
nào là 200 lượt POST tới YouTube bằng phiên của owner — `WORKSPACE_PROTOCOL.md:79-80` ghi rate
limit là rủi ro **có thật** ở lượt chạy hàng loạt. Nên:

- **Trần đồng thời 3–5**, dùng chung con số với ràng buộc 7.
- **Một cầu dao**: quá `k` lượt liên tiếp hỏng thì dừng hỏi, phần còn lại **rơi về Hàng đợi**
  chứ không rơi vào Bó. Fail-closed, không fail-open.
- **Việc mới, phải làm trước**: `getPlayerResponse` (`page-bridge.js:265-277`) khi
  `innertube('player')` hỏng sẽ rơi xuống `fetchWatchPage(videoId)` — tải **nguyên trang watch**.
  Ở n=1 thì không sao; ở n=200 thì đó là 200 lượt tải HTML đầy đủ. Cần một tuỳ chọn kiểu
  `noFallback` để cửa 3 tắt nhánh đó và coi lỗi là "không biết" → Hàng đợi. `noFallback`
  **chưa tồn tại trong repo** (grep `src/`: 0 hit) — đây là code mới, đừng giả định có sẵn.

Nói thẳng phần chưa đo: chi phí byte và ngưỡng rate limit thật của `innertube('player')` là
**suy đoán**, chưa ai đo trên tài khoản owner. Ghi số đo vào handback.

#### Việc cho `README.md:15`

Câu *"Luôn trích transcript cục bộ | Không bao giờ gửi URL cho NotebookLM"* là một câu **tuyệt
đối**, và sau ticket này nó chỉ còn đúng **nhờ luật trên**. Nếu luật trên bị hạ (xem cầu dao) thì
câu README phải đổi cùng lúc, không được để lệch. Peer soạn câu thay trong handback nếu có hạ;
Lead sửa.

**Không escalate.** `WORKSPACE_PROTOCOL.md` → `Authority` chỉ xếp cam kết bảo mật ở `README.md:19`
và `README.md:107` vào diện owner quyết; `:15` không thuộc diện đó.

**Bảng xác nhận**: bỏ câu *"N link — chưa xác minh từng cái là công khai"*. Sau luật này thì
**có** xác minh từng cái, và câu cũ nói thấp hơn thứ làm được. Thay bằng ba số riêng: *"M link
công khai → clipboard · K link private/unlisted → Hàng đợi · J link không hỏi được → Hàng đợi."*

### 6. Sau khi copy — chỉ nhảy sang tab, KHÔNG thao tác gì thêm

Nhảy sang tab NotebookLM đã cấu hình. Hết. Người dùng tự bấm *Thêm nguồn* và Ctrl+V.

**Bản trước của mục này đặt hàng bốn thao tác nữa** — mở hộp thoại *Thêm nguồn*, bấm Nút loại
nguồn *Trang web*, đặt con trỏ vào ô — và **đã gỡ**. Ba lý do, lý do thứ nhất là lỗi cứng:

1. **Nó đòi sửa một file ticket này tự cấm mình sửa.** `ensureAddSourceDialog`
   (`src/notebooklm/automation.js:242`) và `pickChip` (`:257`) là hàm cục bộ trong closure:
   object export ở `:833-842` **không** có tên nào trong hai tên đó, kể cả trong `_internals`
   (`_internals` lộ `openDialog`, là hàm khác — nó chỉ *tra* hộp thoại đang mở và trả `null`,
   không bấm gì). Muốn gọi được thì phải thêm chúng vào object export, tức sửa `automation.js`
   — mà đầu ticket này (`:11`) và mục "Không thuộc phạm vi" **đều** ghi thẳng là không sửa file
   đó. Bản trước tự nhận ra việc phải "mở thêm lối gọi" nhưng không nhận ra rằng chính nó vừa
   phá hai ràng buộc của mình.
2. **Nó dùng sai thuật ngữ ticket này bị buộc dùng đúng.** `CONTEXT.md` → "Đường trao tay":
   *"Extension gom link, ghi vào clipboard, rồi **dừng**."* Bốn thao tác giao diện sau khi ghi
   clipboard không phải "dừng". Đầu ticket (`:18-19`) tự cam kết dùng đúng từ vựng đã chốt và
   không đặt tên mới — nên đây là dùng sai nghĩa, không phải mở rộng có ý thức.
3. **Nó mua lại đúng thứ ADR vừa bán đi.** `docs/adr/0001-duong-trao-tay.md` chốt chuyển ca này
   sang Đường trao tay để *"rút được toàn bộ ngân sách 'sẽ vỡ khi Google đổi DOM' ra khỏi nó"*.
   Gọi `ensureAddSourceDialog` + `pickChip` là gắn lại đúng ngân sách đó, để tiết kiệm cho người
   dùng hai cú bấm.

Cái giá của việc gỡ: người dùng bấm *Thêm nguồn* và chọn *Trang web* bằng tay. Đó là hai cú
bấm, một lần cho cả Bó — trong khi đường tự chèn tốn một lượt hộp thoại **cho mỗi link**. Đúng
phép so sánh mà ADR đứng trên.

Một ca không "dừng êm" được: **chưa đặt notebook đích nào.** `resolveNotebookTab` ném lỗi
(`src/background/service-worker.js:199-204`) trước khi có tab nào để nhảy tới — không có gì để
tụt xuống. Ca này phải nói ra: *"Đã copy N link. Chưa đặt notebook đích — mở notebook rồi
Ctrl+V."* Im lặng ở đây là im lặng sai, vì người dùng đang cầm một clipboard mà không biết mang
đi đâu.

### 7. `Alt+Shift+Y` tự rẽ

Thoả ba điều kiện của mục 5 → Bó link vào clipboard. Mọi ca khác → **vào Hàng đợi**, rồi cài
đặt hiện hành quyết định nó đi Dán link hay Dán text (`planFor`,
`src/background/service-worker.js:836-850`) — đừng viết tắt thành "đi Dán text", với unlisted ở
mặc định `url-then-transcript` thì câu đó sai. **Không thêm setting** cho việc rẽ này: thấy mặc
định sai thì đổi mặc định, đừng đẻ công tắc.

**Đây là mục rủi ro nhất của ticket, và nó có thể không làm được.** Đường code hiện tại chạy
**trọn vẹn trong service worker**: `chrome.commands.onCommand`
(`src/background/service-worker.js:1524`) chỉ rút `videoIdFrom(tab.url)` (`:1533`) rồi
`enqueue([{ videoId }])` (`:1538`). Service worker **không biết privacy** — `normalize()` đóng
dấu `PRIVACY.UNKNOWN` (`:505`) — và **không có `navigator.clipboard`**.

Nên mục này đòi hai thứ mới, cả hai phải đo trước khi viết:

1. **Hỏi tab để có privacy thật**: `ensureScripts(tab.id, 'youtube')` rồi một lượt `describe`,
   đúng nguồn mà bề mặt (a) dùng. Không hỏi được → theo bảng ở mục 5, hạng "biết thật" coi
   `unknown` là *đo trượt* nên rơi về Hàng đợi.
2. **Nhờ content script ghi clipboard**, vì service worker không ghi được. Rủi ro thật nằm ở
   đây: `writeText` đòi tài liệu đang được focus và tuỳ ngữ cảnh còn đòi transient user
   activation, mà một lượt gõ phím tắt đi qua service worker rồi vòng lại content script
   **chưa chắc còn giữ được activation đó**. Tab không phản hồi trong ~5s cũng phải rơi về
   Hàng đợi, không im lặng.

Không giữ được activation thì mục này **hạ xuống**: phím tắt xếp vào Hàng đợi như cũ, và Đường
trao tay chỉ sống ở bốn bề mặt có cú bấm thật. Ghi kết quả đo vào handback dù theo hướng nào —
đừng im lặng bỏ mục này.

## README: một câu đã sai sẵn, và bốn chỗ sẽ thiếu

Hai hạng khác hẳn nhau, đừng trộn. Mục A là một câu **đã sai** trước khi ticket tồn tại, sai về
chính cơ chế ticket này dựa vào — phải sửa. Mục B là bốn chỗ README sẽ **thiếu** sau ticket:
vẫn đúng từng chữ, chỉ chưa kể thứ mới — công việc tài liệu thường lệ. Đừng đối xử với B như A.

### A. `README.md:23` — sai sẵn

`README.md:23` viết: *"Docusaurus, GitBook, docsify, VitePress… dựng thân bài ở phía client,
nên thứ máy chủ nhận về chỉ là cái khung."*

Đo 2026-08-24 (bảng ở mục 4) cho thấy **Docusaurus và VitePress không như vậy**: cả hai là bộ
tạo trang tĩnh, HTML thô đã có đủ thân bài — 10.573 và 4.604 ký tự Markdown. Trong năm bộ đã
đo, chỉ **docsify** đúng là render hoàn toàn phía client.

Câu này **không** thuộc diện owner phải duyệt: `WORKSPACE_PROTOCOL.md` → `Authority` chỉ xếp
cam kết bảo mật ở `README.md:19` và `README.md:107` vào diện owner quyết, còn đây là mô tả cơ
chế. Nhưng nó cũng **không được để nguyên rồi im lặng** — để nguyên là ship một README nói sai
về chính thứ ticket này dựa vào. Peer soạn câu thay thế trong handback; Lead sửa. Vế còn lại
của đoạn đó vẫn đúng và phải giữ: *"nguồn vẫn dính nguyên sidebar và footer lặp ở mọi trang"* —
đó chính là cái giá nêu ở cuối mục 4.

### B. Bốn chỗ README sẽ **thiếu** sau ticket này — không phải sai

Phân biệt cho rõ, vì bản trước của mục này viết quá tay: **không dòng nào dưới đây thành sai.**
Chúng thành *thiếu* — README mô tả đúng thứ đang có, nhưng sau ticket sẽ có thêm thứ nó không
kể. Đó là công việc tài liệu thường lệ của mọi ticket thêm tính năng, không phải nợ kỹ thuật;
liệt kê ở đây chỉ để khỏi quên. `WORKSPACE_PROTOCOL.md` **không** có ràng buộc nào buộc ticket
kê tác động README — nó chỉ xếp cam kết bảo mật `README.md:19` và `README.md:107` vào diện owner
duyệt, và không dòng nào dưới đây thuộc diện đó.

1. **`README.md:47`** — *"bấm nút **NotebookLM** cạnh nút Like/Share. Hoặc phím tắt
   `Alt+Shift+Y`."* Chữ "hoặc" kể hai lối vào như hai cách làm cùng một việc. Sau mục 7 chúng
   rẽ hai hướng cho video public: nút cũ vẫn xếp hàng (mục 1 chốt giữ nguyên), phím tắt đi
   clipboard. Câu vẫn đúng từng chữ, nhưng đọc xong sẽ hiểu sai. Mục 1 còn thêm nút thứ ba cạnh
   đúng chỗ đó. **Có điều kiện**: mục 7 tự nhận có thể *hạ xuống* nếu không giữ được user
   activation — hạ rồi thì không còn gì lệch, và mục README này thành thừa.
2. **`README.md:51`** — bảng xác nhận của *Import toàn bộ*. Nội dung README tả (bao nhiêu video,
   bao nhiêu private, bao nhiêu bị bỏ) **vẫn đúng**; chỉ là mục 1 thêm một lối ra thứ ba cho hộp
   đó, và README chưa kể.
3. **`README.md:67`** — *"Xong" nghĩa là đã kiểm chứng.* Câu này **định nghĩa** chữ "Xong", và
   định nghĩa đó không bị Bó link làm sai — Bó link đơn giản là không bao giờ tự nhận "Xong",
   đúng như định nghĩa đòi. Cái thiếu chỉ là README chưa nói ở đâu rằng có một đường **không đi
   qua** khái niệm đó. Một câu là đủ; đừng viết lại đoạn.
4. **`README.md:94`** — *"vì chạy trong content script nên fetch đi kèm cookie phiên: tài liệu
   nội bộ cần đăng nhập vẫn đọc được."* Đúng nguyên với đường đang có, và mục 4 **cố ý giữ**
   đường đó y nguyên. Nhưng sau ticket sẽ có **hai** đường fetch trang docs — đường này (kèm
   cookie, phục vụ Dán text) và cửa đo (`credentials: 'omit'`, phục vụ quyết định Dán link) —
   nên câu hiện tại đọc như thể mọi lần đụng tới docs đều mang cookie. Một câu phân biệt là đủ.
   Đây là chỗ README **dễ hiểu ngược nhất** trong bốn chỗ, vì hiểu ngược ở đây là hiểu sai về
   quyền riêng tư chứ không phải về tính năng.

Ngoài ra README sẽ cần một mục cho **Sổ đã copy** và nút mới ở mục 1. Peer soạn trong handback;
Lead sửa. Đừng tự sửa README giữa chừng — số dòng đang trôi vì phần UI chưa commit.

**`README.md:15` — đúng, nhưng có điều kiện.** Câu *"Không bao giờ gửi URL cho NotebookLM"* là
một câu **tuyệt đối**, và sau ticket này nó chỉ còn đúng **nhờ luật ở mục 5**. Hôm nay cái giữ
nó đúng là `resolveMeta` (`src/background/service-worker.js:552-557`), mà Bó link không đi qua
đó. Nên: làm đúng mục 5 → README:15 **không phải sửa**; hạ mục 5 xuống (xem cầu dao) → README:15
**phải đổi cùng lúc**, không được để lệch. Đây là dòng README duy nhất mà ticket này thật sự có
thể làm sai.

**Cam kết cookie — không đổi, nhưng cái NEO tới nó đã trôi.** Câu *"extension **không đọc,
không lưu cookie nào**"* vẫn đúng nguyên sau ticket này, ở cả hai đường fetch: `fromUrl` không
đọc cookie (Chrome tự gắn vì cùng origin), còn cửa đo thì `'omit'` nên không có cookie nào để
nói tới. Kết luận: **không phải sửa** — nhưng câu này thuộc diện owner duyệt nên kết luận đó
cần một dòng lập luận chứ không phải sự im lặng.

Và đo được một chuyện khác, **nằm ngoài ticket này nhưng phải nêu**: `WORKSPACE_PROTOCOL.md:11`
và `:87` neo diện owner-duyệt vào *"`README.md:19` và `README.md:107`"*. Kiểm 2026-08-25:
`README.md:19` vẫn đúng (cam kết về chế độ hiển thị video), nhưng **`README.md:107` đã trôi** —
dòng đó bây giờ là câu *"NotebookLM bản consumer không có API công khai…"*, một câu mô tả cơ
chế. Cam kết cookie nay nằm ở **`README.md:119`**; nó trôi khi ticket 001 viết lại mục "Cơ chế
đẩy vào NotebookLM". Nghĩa là hôm nay ràng buộc binding đang trỏ vào nhầm dòng, và ai sửa
`:119` sẽ không thấy mình cần hỏi ai.

Peer **không được** tự sửa `Authority` — `WORKSPACE_PROTOCOL.md:214` xếp việc đó vào diện Human
duyệt, và `:18` nói thẳng Lead muốn thêm ràng buộc cũng phải hỏi. Việc của ticket này là **nêu**;
neo lại là việc của owner. Đề xuất kèm theo: neo bằng **trích một mẩu câu** thay vì số dòng.

**Quy mô — bản trước của đoạn này tự nhận đã "đo hết" rồi đưa ra một con số không tái lập được;
đây là bản đo lại.** Lệnh, để ai cũng chạy lại được:

```sh
rg -n "README\.md:107" docs CONTEXT.md WORKSPACE_PROTOCOL.md
```

Kết quả 2026-08-25 — **sáu dòng ở bốn file** (ngoài chính ticket 006), và chúng **không cùng
một hạng**:

| chỗ trích | ý định | trạng thái |
|---|---|---|
| `WORKSPACE_PROTOCOL.md:11` | luật `Authority` (bản nén) | **sai** |
| `WORKSPACE_PROTOCOL.md:71` | cam kết cookie | **sai** — phải là `:119` |
| `WORKSPACE_PROTOCOL.md:87` | luật `Authority` (bản đầy đủ) | **sai** |
| `docs/tickets/001-notebooklm-rpc.md:82` | trích luật `Authority` | **sai** |
| `docs/tickets/001-PHAN-TICH.md:255` | trích luật `Authority` | **sai** |
| `docs/tickets/001-PHAN-TICH.md:252` | mô tả batchexecute | **gần đúng** — dòng vẫn nói về batchexecute, nhưng câu được trích còn vế *"bám vào đó là bảo đảm sẽ hỏng"* mà README hiện tại **không còn** |

Thêm một chỗ dạng khác: `docs/tickets/001-notebooklm-rpc.md:77` trích `README.md:107-109` — đó
là ghi chép lịch sử của một mục **đã đóng**, mô tả bản README *trước* khi viết lại. Không phải
ràng buộc đang chạy, không cần neo lại.

Hai điều bản trước nói sai, ghi ra để không ai chép lại: `WORKSPACE_PROTOCOL.md:82` **không**
chứa anchor nào (nó là dòng tiêu đề `## Authority`), và hai chỗ trong `001-PHAN-TICH.md` bị bỏ
sót hoàn toàn. Con số "năm chỗ" vì thế sai theo cả hai chiều.

**Và đừng khái quát thành "repo trỏ nhầm anchor README".** Ngoài ticket 006, hai giá trị anchor
README duy nhất tồn tại trong `docs/`, `CONTEXT.md`, `WORKSPACE_PROTOCOL.md` là `:19` (đúng) và
`:107`/`:107-109` (hỏng). Mọi anchor README khác trong repo đều do chính ticket 006 dẫn ra, và
đã kiểm từng cái ở mục B trên đây. Đây là **một** dòng trôi bị trích lại nhiều lần, không phải
một thói quen tài liệu lỏng lẻo.

**Đã kiểm, KHÔNG đổi, đừng sửa** — mấy dòng sau từng bị nghi nhưng đối chiếu source thì vẫn
đúng nguyên: `:16` (unlisted → theo cài đặt), vì ADR chỉ cấm unlisted vào Bó link chứ không đụng
`unlistedMode`. `:17` (public → link) vẫn đúng vì mục 1
cố ý giữ nguyên nút cũ, popup và chuột phải, và ràng buộc 3 cấm đụng `planFor`
(`src/background/service-worker.js:845-846`). `:65` ("**cả hai loại nguồn** dùng chung **một**
hàng đợi") nói video và docs không có hai hàng đợi riêng — Sổ đã copy là khoá riêng, không phải
hàng đợi thứ hai (`CONTEXT.md` → "Sổ đã copy"). `:55` (nút Transcript cạnh nút NotebookLM) vẫn
đúng, README không đếm nút ở đâu cả.

## Thứ tự triển khai

Đo 2026-08-25 bằng cách giao nhau hai tập: (1) file mà từng mục phải sửa, (2) file đang bẩn.
Kết luận ngắn: **sáu trên bảy mục không chạm một dòng nào của file bẩn.**

| mục | file phải sửa | kết luận |
|---|---|---|
| 1 — bốn bề mặt | `src/youtube/content.js`, `src/docs/content.js` | **làm được ngay** |
| 2 — hình dạng Bó | không mở file mới; phần còn lại chỉ-đọc | **làm được ngay** |
| 3 — Sổ đã copy | `service-worker.js`, `shared.js`, hai content script | **lõi làm được ngay** |
| 3 — UI Sổ | `popup.html`, `popup.js`, `popup.css` | **chặn** |
| 4 — cửa đo | `service-worker.js`, `docs/content.js`, `shared.js` | **làm được ngay** |
| 5 — vị ngữ ba điều kiện | `youtube/content.js`, `page-bridge.js` | **làm được ngay** |
| 6 — sau khi copy | `service-worker.js` (nhảy tab) | **làm được ngay** sau khi mục 6 thu lại |
| 7 — `Alt+Shift+Y` | `service-worker.js`, `youtube/content.js`, `shared.js` | **làm được ngay** |

**Chỗ chặn thật, và chỉ một**: khu gập "Sổ đã copy" trong popup. Va chạm ở đây là **ngữ nghĩa
chứ không phải số dòng** — luồng kia đang biến popup thành hai tab (`<nav role="tablist">`,
`#panel-queue`/`#panel-add`), thứ `HEAD` không có. Chưa chốt khung thì câu "khu gập **cạnh Hàng
đợi**" không trỏ vào đâu cả. Đừng đoán khung rồi sửa lại sau.

Thứ tự đề nghị:

1. **Harness bốn bề mặt** (`test/`), không sửa một dòng `src/` nào. Đây là phần lớn công — xem
   mục Kiểm chứng. Không phụ thuộc luồng UI kia, không phụ thuộc phần cứng owner.
2. **Mục 5** — vị ngữ ba điều kiện, một hàm dùng chung. Làm trước mục 1 vì mục 1 gọi nó.
3. **Mục 1 + 2** — bốn bề mặt sinh Bó, hình dạng Bó.
4. **Mục 3 lõi** — khoá storage, khử trùng, luồng `{urls}` → `{keep, dropped}`. Sau bước
   này Sổ đã chạy đúng, chỉ chưa nhìn thấy được trong popup.
5. **Mục 4** — cửa đo. Độc lập với 1–3, xen vào đâu cũng được.
6. **Mục 6 + 7**.
7. **Mục 3 UI** — chờ luồng popup commit. **Không** stash hộ họ, không sửa đè.

Mỗi bước kết thúc bằng `bash test/run.sh` xanh, và **tổng pass phải tăng đơn điệu**. Đừng đọc số
`fail` của một lượt `run.sh` như tổng thiệt hại: nó có `set -e` nên dừng ở file đỏ **đầu tiên
theo alphabet**. Muốn con số thật thì chạy từng file
(`for f in test/*.test.js; do node "$f"; code=$?; …; done`) — và nhớ gán `code=$?` ngay dòng sau
lệnh, vì `$(basename …)` bên trong `echo` nuốt mất `$?` và in `exit=0` cho cả file đang đỏ.

**Việc cần owner, không writer nào làm thay được**: ba mục còn lại của "Điểm cần đo" (trần URL
mỗi lần dán, giá thật của cửa 3 trên playlist nháp cỡ 30, một URL hỏng có chặn cả lô không), và
lượt chạy thật dán Bó vào notebook nháp ở mục Kiểm chứng.

## Ràng buộc

1. **Không thêm permission nào vào `manifest.json`.** Clipboard đã chạy ở hai chỗ mà
   `permissions` không khai `clipboardWrite`; ca hỏng thật là "trang không được focus", ghi
   ngay tại `src/options/options.js:143-144`. Kết luận là *phải* thêm quyền → dừng, escalate
   `BLOCKED`.
2. **Không đụng hình dạng Mục trong `chrome.storage`.** `normalize()` vứt thẳng bản ghi không
   có `videoId`/`docKey`, `itemKey()` trả `null` nên khử trùng vô hiệu, popup in `undefined`.
   Sổ đã copy là **khoá riêng**. Thêm một *giá trị* status mới thì không phá dữ liệu cũ; đổi
   *hình dạng* thì phá — `WORKSPACE_PROTOCOL.md` xếp việc này vào diện expensive-to-reverse.
3. **Không gỡ nhánh `'url'`, không gỡ `unlistedMode`/`publicFallbackToTranscript`.** Xem ADR
   0001 mục "Các lựa chọn đã cân" — đã đo giá, và đã bỏ.
4. **Không đổi định nghĩa `done` / `verified`.** Bó link dừng ở "đã copy", mãi mãi. Đừng gán
   `verified: true`, cũng đừng mượn cặp `verified/unverified` để rồi popup đầy chấm hổ phách.
5. **Thêm `case` message mới thì phải khai vào `HANDLED`** — ba content script gặp nhau trên
   một tab, Chrome lấy phản hồi đến trước, và chuyện này đã giết một tab thật rồi. Sau khi mục 6
   thu lại, chỗ ticket này thật sự chạm là `src/docs/content.js:475` (cửa đo gửi chuỗi HTML về
   tab tài liệu để parse). `src/notebooklm/content.js:64` nêu ở đây **chỉ để đối chiếu mẫu** —
   ticket này không sửa file đó nữa, xem ghi chú xung đột ở đầu ticket.
6. **`await` xong `writeText` mới `window.close()`.** Mẫu đóng-ngay có sẵn trong `popup.js`,
   dòng `window.close(); // bảng chọn nằm trong trang, popup che mất thì vô nghĩa`; sao chép nó
   là mất trắng nội dung clipboard.

   **Neo bằng nội dung dòng chứ không bằng số dòng, cố ý.** Đo 2026-08-25: dòng đó ở
   `HEAD:src/popup/popup.js` là **`:251`**, còn trên cây làm việc đang bẩn là **`:375`** — luồng
   UI kia chèn hơn trăm dòng phía trên nó. Bản trước ticket này ghi `:375`, tức neo vào một số
   dòng **chỉ tồn tại trong công việc chưa commit của người khác** và sẽ trôi tiếp khi họ
   commit. Đây là cùng một hình dạng lỗi với `README.md:107` ở mục README, chỉ khác chỗ.
7. Fetch trong cửa đo phải có **trần đồng thời 3–5** và `AbortSignal.timeout()` riêng. Toàn bộ
   code hiện tại chạy tuần tự với `sleep(1200ms)` giữa hai Mục và **không có một
   `AbortController` nào** — bắn 30 fetch một lúc vào một host là hành vi mới hoàn toàn.

## Điểm cần đo, không đoán

- **Trần số URL mỗi lần dán.** Không một nguồn nào — chính thức lẫn cộng đồng — nêu con số.
  Hai trần đã biết, cho hai hạng tài khoản khác nhau, **không phải một số cũ và một số mới**:
  doc chính thức ghi 50 Nguồn/notebook cho bản free (đọc 2026-08-24), còn hộp thoại trên tài
  khoản owner đo thật `1/300` ngày 2026-08-23 (`README.md:242`).

  **Chỗ cần phân xử rộng hơn bản trước của ticket này mô tả.** Không phải hai tài liệu nói
  ngược nhau mà là ba nguồn, và một trong ba **đã đi vào source**:
  `docs/tickets/001-PHAN-TICH.md:206` gọi con số 50 là "đã **cũ**";
  `docs/tickets/003-mot-luot-chay.md:28-29` nói mạnh hơn — gọi nó là "ghi chú **sai**" và đặt
  hàng sửa; và việc đó **đã làm rồi**, nên `src/common/shared.js:116-117` hôm nay khẳng định
  trần 300 **không kèm điều kiện hạng tài khoản**. Nếu khung "hai hạng" ở trên là đúng thì
  comment đó đang sai cho người dùng bản free. Người phân xử phải chốt cả ba chỗ, không chỉ hai
  tài liệu. **Đừng bịa một ngưỡng chia lô.** Copy một cục, và nếu NotebookLM nghẹn thì lúc
  đó mới có một con số đo được.
- **Giá thật của cửa 3 (mục 5).** Một video = một lượt `innertube('player')` bằng phiên của
  owner. Chưa ai đo: bao nhiêu byte mỗi lượt, và YouTube bắt đầu chặn ở đâu.
  `WORKSPACE_PROTOCOL.md:79-80` ghi rate limit là rủi ro **có thật** ở lượt chạy hàng loạt (số
  đo cũ: 89 video). Đo bằng một playlist nháp cỡ 30, ghi lại thời gian và có bị chặn không —
  **đừng** đo bằng playlist thật vài trăm video, đó đúng là điều `:89-91` cấm. Kết quả quyết
  định trần đồng thời và ngưỡng cầu dao; tới lúc đó con số 3–5 chỉ là suy đoán mượn của ràng
  buộc 7.
- ~~**`DOMParser` có tồn tại trong MV3 service worker không.**~~ **ĐÃ TRA XONG 2026-08-25 — không
  còn là câu hỏi mở.** Xem mục 4, điểm 2. Còn lại đúng một việc nhỏ: xác nhận trên Chrome của
  owner bằng `typeof DOMParser` trong console của service worker.
- **Cookie có dính vào fetch từ service worker không.** **TRA XONG 2026-08-25, và đáp án là
  CÓ** — doc chính thức của Chrome nói request từ extension tới bên thứ ba được coi là
  *same-site* khi extension có host permission, đủ để cả `SameSite=Strict` đi kèm (trích nguyên
  văn ở mục 4, điểm 1). Nên đây **không còn là câu hỏi thiết kế**, nó là một dòng code bắt buộc:
  `credentials: 'omit'`. Việc còn lại là **xác nhận** trên request thật rằng dòng đó có tác
  dụng — mở một trang chỉ đọc được khi đã đăng nhập, fetch qua cửa đo, và trang đăng nhập phải
  là thứ nhận về. Đừng đảo lại thành "đo xem mặc định là gì": mặc định đã biết.
- **Một URL hỏng có chặn cả lô không.** Đúng một blogger nói có, chưa ai kiểm chứng độc lập.
  Nếu đúng thì mục 5 (lọc private) quan trọng hơn hẳn.
- **NotebookLM có tự khử trùng URL không.** Doc chính thức im lặng; bằng chứng gián tiếp
  (extension "NotebookLM Deduper" tồn tại và bán được) nghiêng mạnh về **không**.
- **Dán URL `playlist?list=` thì ra gì.** Không nguồn nào mô tả. **Không dùng** — nở playlist
  ra N link video bằng đường InnerTube đã có.

## Không thuộc phạm vi

Nút copy ở popup (đòi đổi contract ba message). Tự động dán hộ. Đọc lại danh sách Nguồn để đối
chiếu Bó link — `countSources()` chỉ đếm, và selector nền của nó còn chưa chạy trên DOM thật
(ticket 005 đang BLOCKED). Sửa `rpc.js`/`automation.js`/`selectors.js`.

**Hai lỗi có sẵn, phát hiện lúc điều tra, nằm ngoài ticket này — đã tách thành
`docs/tickets/007-parseurllist-nuot-link.md`.** Tóm tắt: `parseUrlList`
(`src/common/shared.js:242`) bỏ mọi URL không phải YouTube, và `videoIdFrom` nhận id trần 11 ký
tự nên `parseUrlList('doc javascripts here')` trả `['javascripts']` → `canonicalUrl` dựng ra
`https://www.youtube.com/watch?v=javascripts`.

**Bản trước của đoạn này viết "vứt im lặng" — đo lại 2026-08-25 thì đó là nói quá, và chỗ nói
quá lại che mất ca tệ nhất.** Ba call site cư xử khác nhau: `collectFromPage`
(`src/background/service-worker.js:1252`) và menu chuột phải (`:1515`) **có** báo khi kết quả
rỗng; im lặng thật sự chỉ xảy ra ở hai chỗ — (i) danh sách **trộn**, vì `ids.length > 0` nên
nhánh báo lỗi không chạy và link docs biến mất không ai đếm, và (ii) `src/popup/popup.js:334-337`,
nơi kết quả rỗng chỉ `focus()` lại ô nhập rồi `return`, **không một chữ nào**. Ticket 007 giữ
bản đúng này.

## Kiểm chứng

- `bash test/run.sh` xanh. **Đo lại baseline trên cây sạch khi nhận ticket**, ghi kèm sha.
  Con số dưới đây đo 2026-08-24 trên `d37a9ec` **cộng phần UI chưa commit**, nên nó là mốc
  tham chiếu chứ không phải mốc nghiệm thu: **787 pass, 0 fail** trên 15
  file (docs 25 · manifest 70 · messaging 30 · notebooklm-dom-report 82 · notebooklm-dom 88 ·
  notebooklm-rpc 131 · options-dom-report 18 · options 102 · popup-render 18 · selectors 8 ·
  service-worker-done 109 · shared 35 · srt 35 · transcript-truncated 22 · ui-isolation 14).
  `README.md` còn ghi "339 test" — con số đó đã lỗi thời, nhưng sửa nó thuộc về ticket 001.

  **`test/run.sh` dừng ở file đỏ đầu tiên, và nó che rất giỏi.** Đo 2026-08-25 bằng cách cố ý
  phá (gỡ trung thực nhánh `'url'`, chi tiết ở `docs/adr/0001-duong-trao-tay.md` lựa chọn 2):
  thiệt hại thật là **ba file crash + 314 assertion biến mất**, còn `run.sh` chỉ in
  *"29 pass, 1 fail"* rồi dừng — vì `set -e` và vì file đỏ đầu tiên **theo alphabet** là
  `messaging.test.js`, đứng trước cả ba file crash. Con số bạn nhìn thấy lệch **hai bậc độ lớn**
  so với thiệt hại thật.

  Nên: thấy đỏ thì sửa rồi **chạy lại từ đầu**, và khi cần đo thiệt hại của một thay đổi thì
  chạy **từng file** (`for f in test/*.test.js; do node $f; done`), đừng đọc số fail của một
  lượt `run.sh` như tổng thiệt hại. Đo exit code thì cẩn thận `$(basename …)` trong `echo` —
  subshell đó nuốt mất `$?` và cho ra `exit=0` cho cả file đang đỏ.
- **Việc ĐẦU TIÊN của ticket là dựng harness cho bề mặt (a)(b)(c)** — hiện chúng **không có
  một dòng test nào**. Đo 2026-08-24: `test/run.sh:12` chạy `test/*.test.js`, và trong 15 file
  đó không file nào `require` `src/youtube/content.js` hay `src/youtube/panel.js`; phía YouTube
  chỉ có `srt.js` và `transcript.js` được nạp. `test/dom-harness.js` cũng không mượn được — nó
  gắn cứng vào fixture NotebookLM (`:22`) và chỉ `load('src/youtube/transcript.js')` (`:229`).
  Nên phải dựng mới `test/youtube-bundle.test.js`: jsdom + stub bốn global mà `content.js` đọc
  ngay dòng đầu — `NBLM`, `NBLM_TRANSCRIPT`, `NBLM_PANEL`, `NBLM_BRIDGE` (`:13-16`). Harness
  phải **ghi lại cú bấm nào gọi `writeText` với chuỗi nào**, không chỉ ghi kết quả trả về; xem
  câu 1 mục dưới để biết vì sao. Đây là **phần lớn công của ticket**, không phải phần đuôi —
  ước lượng thiếu chỗ này là ước lượng thiếu hẳn một mảng.

  **Bề mặt (d) cũng KHÔNG có nền — bản trước ticket này nói ngược.** Nó viết *"bề mặt (d) thì
  đã có nền: `src/docs/content.js` đang được test nạp sẵn"*. Đo 2026-08-25: `rg -n "src/docs/"
  test/` chỉ ra hit ở **`test/manifest.test.js`** (`:54`, `:57`, `:71-72`, `:87`), và ở đó
  `'src/docs/content.js'` chỉ là **một phần tử chuỗi** trong mảng đem so với
  `manifest.content_scripts` — không file test nào `require` hay `win.eval` nó.
  `test/docs.test.js:2` chỉ nạp `src/common/shared.js` để test `docKey`. Nên harness phải phủ
  **bốn** bề mặt, không phải ba, và ước lượng công phải cộng thêm một file nữa.
- **Chạy thật một lần cho mỗi bề mặt**, dán Bó link vào một notebook **nháp**, ghi số Nguồn
  trước/sau. Thêm Nguồn không idempotent.

  Ràng buộc kèm theo, nói thẳng ra vì mục này dễ trượt vào đúng chỗ cấm:
  `WORKSPACE_PROTOCOL.md:89-91` xếp *"chạy lượt import hàng loạt lên tài khoản owner như một
  bước kiểm chứng"* vào diện **prohibited without explicit authority**, và `:86-88` xếp "ghi
  lên notebook không phải notebook nháp" vào diện owner quyết. Bó link cỡ 50 dán một phát vào
  notebook thật **là** cái bị cấm đó. Nên: notebook nháp mới tạo, và Bó dùng để nghiệm thu giữ
  ở mức nhỏ (3–5 link) — cỡ 50 chỉ đo bằng đếm chuỗi trong test, không dán thật.
- **Cửa đo phải chạy trên docs thật**, không chỉ fixture tự gõ. Cần **ba** trang, không phải
  hai — hai trang là đủ để hoán vị số 4 xanh cả hai chiều:
  (i) một trang SSR dài — `how !== 'fallback'`, `chars` lớn → nút **bật**;
  (ii) một trang client-render — `how === 'fallback'`, `chars` = 0 → nút **tắt**;
  (iii) **một trang SSR thật rơi `fallback` mà vẫn có chữ** — `how === 'fallback'` **kèm**
  `chars ≥ N`. Đo được hai cái: `example.com` (113 ký tự) và `info.cern.ch` (212). Nút phải
  **bật**.

  Ca (iii) là ca **duy nhất** tách được hai vế của cửa đo khỏi nhau — xem hoán vị 4. Lưu ý nó
  **không** phải "trang SSR ngắn" như bản trước ticket này đặt hàng: đo 19 trang thật, trang
  docs SSR ngắn nhất tìm được là 173 ký tự (`numpy.ndarray.dumps`) nhưng `how` của nó là
  `.bd-article`, nên nó bật bất kể `N` và **không phân biệt được gì**. Đặt hàng nhầm fixture là
  mất luôn phép đo.

  **`tools/verify-docs.mjs` mượn được cho (i), KHÔNG mượn được cho (ii).** Bản trước ticket này
  viết "mượn URL cho (i) và (ii)" — sai. Bốn URL trong đó (`:30-33`) là Docusaurus, MkDocs
  Material, VitePress, Sphinx+RTD, **cả bốn đều SSR**, đúng như bảng đo của chính ticket. Ca
  (ii) đòi một trang client-render `chars = 0`, và bộ tạo duy nhất trong năm bộ đã đo thoả điều
  đó là **docsify** — không có trong `verify-docs.mjs`. Đi theo câu cũ là không dựng được ca
  "nút phải TẮT", tức mất luôn vế đối chứng của cửa đo. Lấy URL docsify từ bảng đo sáu vỏ JS ở
  mục 4.
- Chứng minh cửa đo **không gửi cookie**: so header của request thật.

## Ở acceptance sẽ hỏi

Chín hoán vị. Mỗi câu nói rõ **chiều nào phải đỏ** — một hoán vị mà cả hai chiều cùng xanh không
chứng nhận gì, và repo này đã dính đúng lỗi đó nhiều lần.

1. **Hoán vị danh sách URL của bề mặt (b) và (c)** — test nào chết? Cả hai đều trả một mảng URL
   cùng hình dạng, nên assert *kết quả* sẽ **xanh cả hai chiều**. Muốn bắt được thì harness
   phải ghim **cú bấm nào sinh ra Bó nào** — ghi lại lời gọi `writeText` kèm chuỗi, rồi assert
   theo cú bấm. Đây chính là lý do mục Kiểm chứng đòi harness ghi cú bấm chứ không ghi kết quả.

2. **Dùng `row.url` làm khoá Sổ đã copy** thay cho `docKey(row.url)` — test nào đỏ? Fixture ba
   URL chỉ khác nhau ở phần `docKey` dọn: `https://a.dev/docs/x`, `https://a.dev/docs/x/`,
   `https://a.dev/docs/x?utm_source=z`. Đo 2026-08-24: cả ba cho **cùng một** `docKey`
   `https://a.dev/docs/x`. Assert: copy lượt một rồi copy lượt hai với cả ba → Sổ có **đúng 1
   dòng**, và lượt hai loại **cả ba**. Bản hoán vị sinh 3 dòng và cho cả ba đi lại — cùng một
   trang vào notebook ba lần.

   Chiều ngược lại (**dán `docKey` ra clipboard** thay cho `row.url`) *không* dùng được làm
   hoán vị: đo thật thì `docKey` chỉ percent-encode chữ có dấu
   (`/tiếng-việt` → `/ti%E1%BA%BFng-vi%E1%BB%87t`) và bỏ `:443` — hai thứ resolve về đúng cùng
   một trang, còn hash-route `#/guide` thì `docKey` giữ nguyên. Nó xấu chứ không hỏng, nên
   đừng đặt cược một hoán vị vào đó.

3. **Vị ngữ vào Bó link** (mục 5). Nền là **ba điều kiện cùng đúng** trên `meta` trả về từ một
   lượt hỏi player response. Fixture chung: sáu thẻ video, **cả sáu huy hiệu đều rỗng** để cửa 1
   cho qua hết và dồn mọi khác biệt vào cửa 3; sáu `videoId` 11 ký tự, **không cái nào là chuỗi
   con của cái nào**. Stub `NBLM_BRIDGE.call` ghi lại từng cặp `[op, args]`; stub `writeText`
   ghi lại từng lời gọi kèm chuỗi.

   | videoId | `meta` stub trả về | phải đi đâu |
   |---|---|---|
   | `AAAAAAAAAA1` | `{videoId:'AAAAAAAAAA1', privacy:'public', playable:true}` | **Bó** |
   | `BBBBBBBBBB2` | `{videoId:'BBBBBBBBBB2', privacy:'private', playable:false}` | Hàng đợi |
   | `CCCCCCCCCC3` | `{videoId:'CCCCCCCCCC3', privacy:'unlisted', playable:true}` | Hàng đợi |
   | `DDDDDDDDDD4` | **reject** (quá hạn) | Hàng đợi, `privacy:'unknown'` |
   | `EEEEEEEEEE5` | `metaFrom({})` — **gọi từ source, đừng chép tay** | Hàng đợi, `privacy:'unknown'` |
   | `FFFFFFFFFF6` | `metaFrom({playabilityStatus:{status:'LOGIN_REQUIRED', reason:'Dieses Video ist privat'}, videoDetails:{videoId:'FFFFFFFFFF6'}})` | Hàng đợi, `privacy:'unknown'` |

   Hai hàng cuối **muốn** gọi `metaFrom` từ source chứ không chép giá trị — ghim vào source thì
   hôm nào `let privacy = 'public'` (`page-bridge.js:292`) đổi là test biết ngay.

   **Nhưng làm thẳng như thế thì KHÔNG chạy được, và bản trước ticket này đặt hàng một việc bất
   khả thi.** `metaFrom` là hàm cục bộ trong closure của `src/youtube/page-bridge.js:280`, không
   gắn vào `window`, không export; mà `page-bridge.js` lại chạy ở **MAIN world**, còn harness ở
   mục Kiểm chứng chỉ stub bốn global của isolated world (`NBLM`, `NBLM_TRANSCRIPT`,
   `NBLM_PANEL`, `NBLM_BRIDGE`) và **không nạp** file đó. Writer làm theo câu cũ sẽ buộc phải
   chép tay hằng số — đúng cái mà câu đó cấm.

   Nên chọn một trong hai, và **nói ra chọn cái nào**:
   - **(i) chép tay, có neo.** Chép giá trị `metaFrom` trả về, kèm một comment trỏ thẳng
     `page-bridge.js:292` và một dòng trong handback nói rõ đây là hằng số chép tay. Rẻ, và
     trung thực về việc test này **không** canh được `page-bridge.js`.
   - **(ii) mở một seam.** Nạp `page-bridge.js` trong một jsdom riêng rồi lấy `metaFrom` ra —
     đòi thêm một lối export, tức sửa `page-bridge.js`, việc mà ticket này chưa đặt hàng.

   Đề xuất: **(ii)**, vì "mở một seam" trong repo này **không phải việc mới** — có sẵn hai tiền
   lệ và cả hai đang được test dùng: `self.NBLM_SW_INTERNALS`
   (`src/background/service-worker.js:1544`, comment tại `:1542-1543` nói thẳng *"Xuất ra để
   test … quan sát được"*, dùng ở `test/service-worker-done.test.js:171`), và `_internals` của
   `automation.js` (dùng ở `test/dom-harness.js:143`). Một dòng cùng kiểu ở cuối
   `page-bridge.js` — chỉ xuất `metaFrom` và `privacyFromRenderer`, không đổi hành vi gì — là
   theo đúng mẫu đang chạy.

   Đường thay thế "nạp `page-bridge.js` vào jsdom rồi lái qua `postMessage({op:'meta'})`" chạy
   được nhưng **đo lẫn**: nó đi qua `getPlayerResponse` (`:265-277`) nên test chứng nhận thêm cả
   tầng mạng, không tách bạch được `metaFrom`.

   Chọn (i) cũng chấp nhận được nếu Lead không muốn đụng `page-bridge.js` — nhưng khi đó phải
   ghi vào handback rằng test này **không** canh được `page-bridge.js:292`. Điều cấm là viết
   "gọi từ source" rồi để writer tự phát hiện là không gọi được.

   Bấm copy **một lần**, rồi assert: `writeText` gọi **đúng 1 lần** và `calls[0].split('\n')`
   **deepEqual** `['https://www.youtube.com/watch?v=AAAAAAAAAA1']` (so mảng, ghim cả độ dài,
   **không** `includes`); nhật ký bridge lọc `op === 'meta'` cho **đúng sáu** videoId, mỗi cái
   một lần.

   Bốn hoán vị, **chiều phải đỏ là bản hoán vị** ở cả bốn:
   - (3a) **nới về luật cũ** — `unknown` từ huy hiệu đi thẳng Bó, không gọi `meta`. Đỏ ở cả hai
     assert: Bó sáu dòng, **và** nhật ký bridge rỗng.
   - (3b) **gỡ điều kiện (1)** (`meta.videoId === videoId`) → `EEEEEEEEEE5` lọt vào Bó.
   - (3c) **gỡ điều kiện (3)** (`meta.playable === true`) → `FFFFFFFFFF6` lọt vào Bó. (3b) và
     (3c) đỏ ở **hai video khác nhau**, nên không cái nào là bóng của cái kia.
   - (3d) **siết quá tay** — `unknown` loại thẳng, không hỏi ai → Bó rỗng, mất `AAAAAAAAAA1`.
     Phải có: luật cần canh **cả hai chiều**, nới đỏ và siết cũng phải đỏ.

   Và một hoán vị canh **cái neo**: **bỏ cửa 3 khỏi nhánh *copy lại cả những cái đã có***.
   Fixture riêng — **ba** video huy hiệu rỗng, cả ba **đã nằm sẵn trong Hàng đợi** nên cửa 2 xếp
   chúng vào `dropped`. Bấm nút copy-lại. Assert Bó chỉ chứa URL của video thứ nhất.

   | videoId | `meta` stub trả về | trượt điều kiện nào |
   |---|---|---|
   | `GGGGGGGGG11` | `{videoId:'GGGGGGGGG11', privacy:'public', playable:true}` | không trượt → **Bó** |
   | `HHHHHHHHH12` | `{videoId:'ZZZZZZZZZ99', privacy:'public', playable:true}` | chỉ (1) |
   | `IIIIIIIII13` | `{videoId:'IIIIIIIII13', privacy:'public', playable:false}` | chỉ (3) |

   **Vì sao ba chứ không một**: bản trước ticket này stub đúng một video với
   `{privacy:'private'}` — thứ trượt **cả ba** điều kiện cùng lúc. Hoán vị đó chỉ chứng nhận
   "nhánh copy-lại có gọi cửa 3", không chứng nhận nó gọi **cùng một vị ngữ**. Một bản cài đặt
   để nhánh copy-lại tự kiểm mỗi `privacy === 'public'` — đúng hình dạng "đường dữ liệu song
   song" mà mục 3 cảnh báo — vẫn xanh hết, **và** xanh cả 3a–3d vì 3a–3d chạy trên fixture của
   đường chính. Ba hàng trên tách được: chỉ một vị ngữ đủ ba điều kiện mới loại được cả
   `HHHHHHHHH12` lẫn `IIIIIIIII13`.

   Thiếu hoán vị này thì bất biến vẫn còn nguyên một cửa sau.

4. **Bỏ vế `chars` của cửa đo**: `how === 'fallback' && chars < N` đổi thành `how ===
   'fallback'` đơn thuần. Chiều phải đỏ: **bản hoán vị**, trên fixture (iii) — `example.com`
   (`how = 'fallback'`, `chars = 113`, `N = 100`) phải **bật** ở bản gốc và **tắt** ở bản hoán vị.

   **Đừng hoán vị theo chiều kia.** Bỏ vế `how` (còn `chars < N` đơn thuần) đo được là **xanh cả
   hai chiều trên cả 19 trang thật**: với `N = 100`, ca phân biệt phải là `how !== 'fallback'`
   **kèm** `chars < 100`, mà trang docs SSR nhỏ nhất đo được đã là 173 ký tự. Bản trước của
   ticket này đặt hàng đúng cái hoán vị vô hiệu đó — đã sửa, nêu ra đây để không ai đặt lại.

5. **Hoán vị thứ tự ghi Sổ so với `await writeText`** — đưa lời ghi Sổ lên *trước* `await`, hay
   bỏ `await`, thì test nào đỏ? Stub `navigator.clipboard.writeText` **ném lỗi** (đúng ca
   "trang không được focus" đã ghi tại `src/options/options.js:143-144`), rồi assert ba thứ:
   khoá Sổ trong storage **không đổi**; bề mặt hiện lỗi chứ **không** hiện "đã copy"; và bấm
   lại lần nữa vẫn sinh **đủ** ngần ấy link. Thiếu assert này thì một lần copy hỏng sẽ chôn
   vĩnh viễn đúng những link chưa bao giờ tới clipboard (mục 3).

6. **Gỡ một trong hai kho khử trùng** — mục 3 đòi tra **cả** Sổ đã copy **lẫn** Hàng đợi. Bỏ vế
   Hàng đợi thì test nào đỏ? Bỏ vế Sổ thì test nào đỏ? Nếu cùng một fixture bắt được cả hai thì
   fixture đó đang trộn hai luật — hai nhánh này đổ ra **cùng một mảng URL cùng hình dạng**, nên
   để bản trùng nằm ở cả hai kho là xanh cả hai chiều. Cần fixture tách bạch: URL X **chỉ** có
   trong Sổ, URL Y **chỉ** có trong Hàng đợi, mỗi cái bị loại vì đúng vế của nó.

   **Ca thứ ba, bắt buộc**: một Mục Hàng đợi `status: ERROR` mang khoá trùng URL Z — assert Z
   **vẫn bị loại**. Lý do là một cái bẫy đọc được: `enqueue()` cố ý dựng tập khoá bằng
   `queue.filter((i) => i.status !== STATUS.ERROR)` (`src/background/service-worker.js:512-513`),
   nên ai mượn lại tập đó thay vì tự khử sẽ để lọt đúng những Mục đã hỏng một lần.

7. **Đổi chỗ hai trường chuỗi của một dòng Sổ** — `url` và "gom từ đâu". Cả hai là string, bản
   ghi cùng hình dạng, nên mọi assert kiểu "có ba trường" / "là mảng object" xanh cả hai chiều,
   còn khử trùng thì lặng lẽ đi so khoá với **tên playlist** và "số link bị loại" tụt về 0 mà
   không ai thấy. Ghim theo **slot**, không theo hình dạng: sau một lần copy từ playlist tên
   `PL-Alpha`, đọc thẳng khoá Sổ trong storage rồi assert `row.url === canonicalUrl(ID)` **và**
   `row.from === 'PL-Alpha'` **và** `row.url !== row.from`. Rồi chạy lại đúng bề mặt đó và
   assert số link bị loại đúng bằng số dòng Sổ khớp.

   Repo đã có sẵn một test canh đúng hình dạng bẫy này, mượn kiểu của nó:
   `test/notebooklm-dom-report.test.js:9-10` — *"ghi ĐÚNG tình huống vào ĐÚNG khoá (hoán vị hai
   nhãn tình huống → nội dung nằm nhầm khoá, mà hình dạng vẫn y hệt)"*.

8. **Gỡ `credentials: 'omit'` khỏi fetch của cửa đo** (mục 4, điểm 1) — để trống option, tức
   rơi về mặc định. Chiều phải đỏ: **bản hoán vị**. Cách canh: stub `fetch` toàn cục, ghi lại
   `[url, init]` của từng lời gọi, chạy cửa đo cho một URL, rồi assert
   `init.credentials === 'omit'` — **so bằng `===` với chuỗi đó**, đừng assert "có trường
   credentials" (bản hoán vị bỏ hẳn option nên `init.credentials` là `undefined`, và một assert
   truthy-ish sẽ đỏ đúng, nhưng đổi `'omit'` thành `'include'` thì lại xanh — hai lỗi khác nhau,
   ghim cả hai bằng một phép so bằng).

   Nói cho hết cái test này **không** chứng nhận: nó chứng nhận **code của ta truyền đúng
   option**, chứ không chứng nhận Chrome tôn trọng nó. Đó là hai câu hỏi khác nhau và câu thứ
   hai không đo được trong jsdom — nó nằm ở "Điểm cần đo", phải xác nhận bằng một request thật.
   Phân biệt này quan trọng: một spy trên tham số ta truyền cho dependency là hợp lệ, còn ghim
   một hằng số ngoại sinh của Google thì không (xem ràng buộc 3 của
   `docs/tickets/001-notebooklm-rpc.md`) — cái phân biệt là **ai sở hữu giá trị đó**. `'omit'`
   là bất biến của ta.

9. **Bó rỗng: `writeText('')` thay cho "không gọi gì".** Chiều phải đỏ: **bản hoán vị**.

   Mục 2 chốt *"Bó rỗng thì không ghi clipboard"*, vì `writeText('')` **xoá trắng** thứ người
   dùng đang giữ. Tám hoán vị trên **không cái nào canh bất biến này** — đây là chỗ hở, tìm ra
   lúc soát lại 2026-08-25, không phải một biến thể cho đẹp đội hình. Cái gần nhất là (3d): nó
   *tạo ra* Bó rỗng, nhưng đó là chiều phải-đỏ của nó, và assert *"`writeText` gọi đúng 1 lần"*
   đỏ bất kể bản gốc gọi `writeText('')` hay không gọi gì. Nên một bản cài đặt xoá trắng
   clipboard đi qua trọn vẹn mục acceptance mà không test nào đỏ.

   Cách canh: fixture cho **cả ba** đường ăn hết danh sách (mục 2 kể ba: lọc private, lọc trùng,
   lọc cửa đo) — ba ca riêng, vì ba nhánh code riêng. Với từng ca: đặt clipboard giả một giá trị
   **khác rỗng** trước khi bấm, rồi assert `writeText` **không được gọi lần nào** (`calls.length
   === 0`) **và** giá trị giả kia còn nguyên. Hai assert chứ không một: chỉ assert
   `calls.length === 0` thì một bản gọi `writeText(cũ)` để "giữ nguyên" vẫn xanh sai; chỉ assert
   giá trị còn nguyên thì stub ghi đè bằng chính giá trị cũ cũng xanh sai.

   Kèm theo, đúng như mục 2 đòi: assert bề mặt nói ra **vì sao** còn 0 link, tách bạch ba lý do.
   *"Đã copy 0 link"* phải làm test đỏ.

Câu nào trả lời là "không test nào" thì đó vẫn là kết quả hợp lệ — **nhưng phải nói ra**. Để
trống thì handback bị trả lại.
