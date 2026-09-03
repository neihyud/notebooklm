# Oracle thứ hai — và nó phân xử được ba chỗ doc trước để treo

- nguồn chính: extension `apcbknpaakgfcnhplopfkkcenjfgbkme` ("Sourclip — NotebookLM Research
  Workspace", sourclip.com), bản **1.8.0**, build 2026-08-18, tải từ Chrome Web Store và giải nén
  **2026-09-02**.
- nguồn đối chiếu: **đọc lại** extension `gcglcbfmophnppdlbhckfmfiofaajibm` ("Youtube Summary with
  AI") bản **1.5.4** — cùng bản mà `notebooklm-rpc-do-duoc.md` đã dùng, nhưng lần này đọc phần
  doc trước không đọc tới. Chính phần đó mới là thứ phân xử.
- vẫn là **đặc tả giao thức đọc ra được**, không phải code chép về. Giao thức là của Google.
- và vẫn là quan sát một thời điểm. Hai oracle không biến hằng số ngoại sinh thành hằng số nội
  sinh; chúng chỉ làm giả thuyết hẹp lại.

## Vì sao đọc lại oracle A mới là việc quan trọng nhất

`notebooklm-rpc-do-duoc.md` ghi hình dạng `args` của oracle A mà **không ghi nó đang gửi loại
nguồn nào**. Thiếu đúng một chữ đó, và mọi kết luận rút ra từ nó đều lơ lửng: 4 ô là hình dạng
của *nguồn văn bản*, của *URL*, hay của cả hai?

Oracle A ship một **bảng rpc id có tên** và **bốn hàm có tên** trong
`assets/chunk-e2d7b064.js`. Không phải suy đoán từ tên biến đã minify — tên gốc còn nguyên:

```js
const e = { ADD_SOURCES: "izAoDd", DELETE_SOURCES: "tGMBJ",
            LIST_RECENTLY_VIEWED_PROJECTS: "wXbhsf", CREATE_PROJECT: "CCqFvf",
            DELETE_PROJECTS: "WWINqb", GET_NOTES: "cFji9",
            CREATE_AUDIO_OVERVIEW: "AHyHrd", GET_AUDIO_OVERVIEW: "VUsiyb", … }  // 40 mục

async addSource(l, n)           // YouTube, l = videoId
  [[[null,null,null,null,null,null,null,["https://www.youtube.com/watch?v="+l],null,null,1]],
   n, [2], [1,null×9,[1]]]

async addWebSource(l, n)        // URL thường
  [[[null,null,null,null,null,null,null,[l],null,null,1]],
   n, [2], [1,null×9,[1]]]

async pastedTextToSource(l, n)  // văn bản dán
  [[[null,["Pasted Text",l],null,2,null,null,null,null,null,null,1]],
   n, [2], [1,null×9,[1]]]

async addUrlsToSource(l, n)     // NHIỀU url một lượt
  o = l.map(r => [null,null,[r],null,null,null,null,null,null,null,1])
  [o, n, [2], [1,null×9,[1]]]
```

## Ba chỗ được phân xử

### 1. `slots.url = 2` SAI cho nguồn đơn — và ta biết con số 2 từ đâu ra

Đây là kết quả đáng giá nhất của cả hai lượt đọc, và nó đóng đúng
**correspondence-critical pair #2** trong `WORKSPACE_PROTOCOL.md` — cặp mà pair #5 nói thẳng là
*không đóng được bằng test*, chỉ đóng được bằng "một oracle độc lập nói con số đó đúng".

| | URL thường, nguồn đơn | URL YouTube, nguồn đơn |
|---|---|---|
| oracle A `addWebSource` | ô **7** | ô **7** (`addSource`) |
| oracle B (Sourclip `fl`) | ô **7** | ô **7** — cùng một hàm |
| `rpc.js` trước hôm nay | ô **2** ❌ | ô 7 ✓ |

Hai oracle độc lập, hai codebase không liên quan, cùng đặt URL đơn — YouTube hay không — vào
**ô 7**. Không oracle nào dùng ô 2 cho nguồn đơn.

**Ô 2 có thật, nhưng nó thuộc về hình dạng khác.** Nó xuất hiện đúng một chỗ: hàm
`addUrlsToSource` của oracle A, tức đường **nhiều URL trong một request**. Đó gần như chắc chắn
là chỗ tài liệu cộng đồng (`notebooklm-py`) đọc ra con số 2 rồi doc trước chép vào `rpc.js` như
hình dạng của nguồn đơn. Con số không sai — nó bị đặt nhầm ngữ cảnh.

**Hệ quả phải nói ra:** ô 7 gánh cả hai loại, và cả hai đều **không mang mã loại**
(`kindCodes.url = kindCodes.youtube = null`, đã đúng sẵn). Nghĩa là trên đường RPC, `kind:'url'`
và `kind:'youtube'` dựng ra **payload giống hệt nhau**. Phân biệt hai loại vẫn phải giữ vì đường
DOM cần nó (chọn chip "Trang web" hay chip YouTube), nhưng ở tầng payload thì nó là phân biệt
không có hiệu lực. Pair #2 vì thế chuyển từ "hở" sang "vô hiệu" — hoán vị hai ô giờ là no-op, và
đó là **sự thật về giao thức**, không phải thiếu test. Đã ghi lại trong `WORKSPACE_PROTOCOL.md`.

### 2. `ozz5Z` phải gỡ khỏi `addSourceIds`

Bảng của oracle A có **40 mục có tên**, và `ozz5Z` **không nằm trong đó**. Thêm nguồn là
`izAoDd`, một mình.

Oracle B nói mạnh hơn: comment trong `notebooklmHook.js` (file này **không minify**, comment còn
nguyên) chú `ozz5Z` là *"audio overview generate (user clicked Generate in NbLM)"*.

> Hai oracle **không khớp nhau** ở chi tiết này: oracle A gọi `AHyHrd` là `CREATE_AUDIO_OVERVIEW`,
> oracle B chú `ozz5Z` là lệnh sinh audio. Có thể Google đã xoay id giữa 04/2026 và 08/2026, có
> thể một trong hai chú sai. **Ta không cần phân xử chỗ đó** — điều cả hai oracle đồng ý là:
> `ozz5Z` không phải id thêm nguồn, và không oracle nào từng gửi nó để thêm nguồn.

Lý do giữ nó trong `rpc.js` — *"chỉ có trong changelog của một thư viện"* — đã bị phản chứng: nó
có thật, chỉ là làm việc khác. Và điều đó phá luôn lập luận an toàn đang đỡ cho nó. Comment cũ
viết: id sai thì "server không chạy gì cả". Đúng với một id **không tồn tại**. Với một id **có
tồn tại và làm việc khác**, thứ ta gửi là một lệnh thật kèm tham số rác — kết cục hợp lý nhất vẫn
là bị từ chối, nhưng "hợp lý nhất" không phải "chắc chắn", và cái ta đang cược là một tác vụ sinh
Audio Overview trên notebook thật của owner.

Chi phí gỡ bằng không: `izAoDd` được cả hai oracle xác nhận, `paths`/`addSourceIds` vẫn ghi đè
được từ trang Cài đặt nếu Google xoay id.

### 3. `argsShape` — hai oracle MÂU THUẪN, và mặc định hiện tại là bên có hai phiếu

Đây là chỗ dễ kết luận vội nhất, nên ghi rõ số phiếu:

| loại nguồn | oracle A 1.5.4 | oracle B 1.8.0 | `rpc.js` |
|---|---|---|---|
| văn bản dán | **4 ô** `[[spec], id, [2], [1,null×9,[1]]]` | **3 ô** `[[spec], id, [2]]` | 4 ô |
| URL đơn | **4 ô** | **4 ô** | 4 ô |
| nhiều URL | **4 ô**, ô 0 = `[spec,spec,…]` | **4 ô**, ô 0 = `[spec,spec,…]` | chưa có |

Cả hai oracle **bọc đơn** — `[spec]`, không phải `[[spec]]`. Biến thể bọc đôi của `notebooklm-py`
giờ không còn oracle nào đỡ.

Chỗ duy nhất mâu thuẫn là **khối thứ tư của nguồn văn bản**. Hai cách đọc, và ta không có dữ kiện
để chọn:

- khối 4 là **tuỳ chọn** — A gửi, B không gửi, cả hai đều chạy được trên máy người dùng thật;
- khối 4 **bắt buộc** và B đang dựa vào một mặc định phía server.

**Quyết định: không đổi mặc định.** Giữ 4 ô cho mọi loại — đó là bên được cả hai oracle xác nhận
cho URL, và một trong hai xác nhận cho văn bản. Đổi sang tách hình dạng theo loại nguồn là chọn
bên thiểu số dựa trên một quan sát duy nhất, đúng lúc `argsShape` sinh ra để **không phải chọn**.

Cái thay đổi là **giá trị của cơ chế ghi đè**: biến thể 3 ô giờ không còn là suy đoán từ tài liệu
cộng đồng mà là hình dạng một sản phẩm đang chạy thật gửi đi. Dán vào `rpcOverrides.argsShape`
nếu nguồn văn bản qua RPC trả về frame rỗng:

```json
[{"dat":"sources","boc":1},{"dat":"notebookId"},{"hang":[2]}]
```

## Nó lấy token và ngữ cảnh bằng hai đường — đường thứ hai không cần tab nào

Oracle B là bằng chứng đầu tiên rằng **thêm Nguồn không cần mở tab NotebookLM** — ticket mà doc
trước gác lại ở dòng cuối.

**Đường 1 — mượn request thật.** `notebooklmHook.js` chạy MAIN world `document_start`, hook
`fetch` + `XHR`, lọc request tới `/data/batchexecute` có `rpcids` nằm trong danh sách quan tâm,
rồi `postMessage` ra nguyên bộ `headers` + `body` + `queryParams` + `notebookId` (moi từ
`source-path`). Token `at` rút từ `body` của chính request đó. Cùng thủ pháp
`src/youtube/page-bridge.js` dùng cho SAPISIDHASH, khác đích.

**Đường 2 — cold start từ service worker.** Khi chưa mượn được gì:

```js
fetch("https://notebooklm.google.com/?authuser=N&pageId=none", {credentials:'include'})
/"SNlM0e":"([^"]+)"/   // token at
/"cfb2h":"([^"]+)"/    // bl (build label)
```

Ngữ cảnh cache vào `chrome.storage.local`, TTL `432e5` ms = **12 giờ**.

Cái giá, và vì sao nó không phải một ticket nhỏ: đường này đòi `host_permissions` +
`credentials: 'include'` (gọi từ service worker là cross-origin), và nó **lưu token `at` xuống
`chrome.storage.local`**. `README.md` mục *Cam kết* đang hứa token đó *"không vào bộ nhớ
extension"*. Đổi cam kết bảo mật trong README là mục **Human must decide** của `Authority` —
không phải việc Lead tự quyết.

## Tham số URL: `bl` là ứng viên số một, nhưng CHƯA thêm

Doc trước để ngỏ *"chưa biết cái nào bắt buộc"*. Giờ có thêm dữ kiện:

- oracle A gửi `bl`, `f.sid`, `hl`, `_reqid`, `rt`;
- oracle B ở đường add-source **chỉ ghi đè `rpcids` + `source-path`** lên bộ params bắt được. Ở
  đường cold start, bộ params đó chỉ có `bl` + `authuser` — **không** `_reqid`, **không** `rt`,
  **không** `f.sid`, **không** `hl`. Và đường đó là fallback đang chạy thật.

Suy ra: `_reqid`/`rt`/`f.sid`/`hl` **không bắt buộc** cho thêm nguồn; `bl` là thứ duy nhất cả hai
oracle đều gửi và không oracle nào bỏ.

**Vẫn không thêm `bl` lần này**, và lý do là lý do của chính repo này chứ không phải sự thận
trọng chung chung: `bl` không có hình dạng riêng để nhận ra. Token `at` thì có — `rpc.js` cố ý
neo nó theo regex hình dạng, **không** theo tên khoá `SNlM0e`, để không chép tay thêm một hằng số
ngoại sinh. Đọc `bl` thì buộc phải ghim tên khoá `cfb2h`, tức nhập khẩu đúng thứ
`Project-specific anti-patterns` cấm: một hằng số ngoại sinh **không có cơ chế phát hiện lúc
chạy** khi nó lệch.

Điều kiện để thêm: một lượt `tools/probe-notebooklm.mjs` cho thấy request thiếu `bl` trả frame
rỗng, **hoặc** một cách đọc `bl` neo theo hình dạng thay vì theo tên khoá.

Oracle B **không hardcode `bl`** (oracle A thì có, ghim một build label từ 2025-09-02 đã mục).
Nghi ngờ của doc trước ở mục *Hằng số chép tay* được xác nhận: nếu có ngày phải gửi `bl`, đọc từ
trang.

## Thứ đáng lấy mà không phải hằng số: `izAoDd` nhận NHIỀU spec một lượt

Cả hai oracle đều có đường này, và cả hai đặt danh sách spec vào **ô 0, bọc đơn** —
`[spec, spec, …]`. Chỗ chúng lệch là ô chứa url bên trong mỗi spec (A: ô 2; B: ô 7), đúng cái
mâu thuẫn ở mục 1, nên **hình dạng batch chưa chốt được**.

Vì sao vẫn đáng ghi: cả *Đường trao tay* lẫn cái giá của nó ghi trong `README.md` —
*"tốn một lượt hộp thoại cho mỗi link"* — sinh ra từ giả định một-nguồn-một-lượt. Giả định đó chỉ
đúng với **đường DOM**. Trên đường RPC, cả playlist đi trong một request. Đường trao tay vẫn có
lý do tồn tại (nó không hỏng khi Google đổi giao diện; RPC thì có), nhưng bảng cân nhắc trong
`docs/adr/0001-duong-trao-tay.md` đổi. Ticket riêng.

## Xác minh: phản hồi `izAoDd` trả về `sourceId` của nguồn vừa tạo

Oracle B parse `sourceId` ra khỏi frame `wrb.fr` của `izAoDd` và dùng nó thật (để xoá bản cũ khi
sửa nguồn). `readEnvelope()` hiện dừng ở *"có payload parse được"* và người gọi trả
`verified:false` kèm câu `UNVERIFIED_RPC`.

Nếu hình dạng đó đúng, đường RPC **xác minh rẻ hơn đường DOM**: server nói thẳng nó đã ghi cái
gì, không cần đếm lại danh sách Nguồn. Chưa làm — hình dạng payload là hằng số ngoại sinh thứ ba
và mới chỉ có **một** oracle. Ticket riêng.

## Chỗ oracle B thua, và chỗ không được chép

**Đường DOM của nó yếu hơn `automation.js` rõ rệt.** `notebooklm.js` chỉ dùng cho *tạo notebook
mới + dán text*: ghim chuỗi tiếng Anh (`"Copied text"`, `"Insert"`), ghim
`textarea[formcontrolname="copiedText"]`, `sleep` cứng 1500/2000 ms, chỉ phát `input`/`change` chứ
không có chuỗi `pointerdown → … → click`. Nó khai 20 ngôn ngữ nhưng đường DOM chỉ chạy được giao
diện tiếng Anh. Không có gì để lấy.

**Ba thứ vượt quá cam kết của repo này:**

- gọi `accounts.google.com/ListAccounts` để liệt kê **mọi tài khoản Google + email** trên máy, lưu
  danh sách vào `chrome.storage.local`;
- cache token `at` 12 giờ trong `chrome.storage.local`;
- `notebooklmShadowPatch.js` monkeypatch `Element.prototype.attachShadow` ép `closed → open`, MAIN
  world, `document_start`, `all_frames`, kèm `*.usercontent.goog`.

Khác với oracle A, nó **không** đổ token vào `localStorage` của trang — sạch hơn ở đúng điểm doc
trước nêu.

## Đã đổi gì trong repo sau doc này

- `src/notebooklm/rpc.js`: `slots.url` 2 → 7; gỡ `ozz5Z` khỏi `addSourceIds`.
- `test/notebooklm-rpc.test.js`: khối "hai ô URL phải khác nhau" đã sai giả định — viết lại.
- `WORKSPACE_PROTOCOL.md`: cập nhật trạng thái correspondence-critical pair #2.
- **Không** đổi: `argsShape` mặc định, tham số URL, cam kết trong `README.md`.

## Điều kiện đảo ngược

Cả hai thay đổi đều nằm sau công tắc `rpcEnabled`, **mặc định tắt**, và cả hai đều ghi đè được từ
trang Cài đặt mà không cần bản mới:

- `slots.url` sai → nguồn URL cho frame rỗng → `unknown` → lượt DỪNG kèm câu bảo owner mở notebook
  kiểm. Trả về bằng `rpcOverrides.slots = {"url": 2}`.
- `izAoDd` bị xoay → `rpc-id-stale` → `not-sent` → rơi xuống đường DOM, owner chỉ thấy chậm hơn.
  Thêm id mới bằng `rpcOverrides.addSourceIds` (luật GỘP THÊM, id owner dán vào đứng trước).

## Bổ sung 2026-09-03 — đọc lại oracle B sau khi owner chỉ vào giao diện của nó

Owner gửi ảnh chụp popup Sourclip (hai dropdown *NotebookLM account* / *Send to*) và hỏi lại cho
chắc là nó có import thẳng không. Có — và lượt đọc lại này moi thêm bốn thứ **chưa từng ghi ở
đâu trong repo**.

### 1. Bốn hàm thêm nguồn, không hàm nào đụng DOM

Toàn bộ nằm trong service worker, `fetch` thẳng tới `batchexecute`. Không content script, không
hộp thoại, không click.

| hàm | loại | args |
|---|---|---|
| `dl(text, title, nbId)` | văn bản | `[[[null,[title,text],null,2,null×6,1]], nbId, [2]]` — **3 ô** |
| `fl(url, nbId)` | URL đơn | `[[[null×7,[url],null,null,1]], nbId, [2], [1,null×9,[1]]]` — 4 ô |
| `ml(urls, nbId)` | URL batch | `[urls.map(u => [null×7,[u],null,null,1]), nbId, [2], [1,null×9,[1]]]` — 4 ô |
| `gl(ids, nbId)` | xoá | `[ids.map(i => [i]), [2]]`, cắt mẻ 50 |

Hai điều đã ghi ở chỗ khác, xác nhận lại chứ không mới: biến thể **3 ô cho văn bản** (bảng ở
trên, dòng *văn bản dán*), và **ô url = 7 kể cả trong batch** của oracle B
(`docs/tickets/008-*.md`). Mâu thuẫn với `addUrlsToSource` của oracle A (ô 2) **vẫn còn nguyên**.

### 2. `CCqFvf` — tạo notebook. Chưa ghi ở đâu.

```js
async function ul(title) {
  args        = [title, null, null, [2], [1,null×9,[1]]]
  rpcids      = CCqFvf
  source-path = /                          // gốc, giống wXbhsf
  // đọc: notebookId = payload[0][2]  (fallback payload[2])
}
```

### 3. Hai tín hiệu "đã đụng trần" — và cách chúng được dò

Đáng ghi vì cả hai là **cơ chế phát hiện lúc chạy**, đúng thứ `rpc.js` ưu tiên hơn assertion:

- **trần số Nguồn của một notebook**: oracle B tìm chuỗi `reached its source limit` **trong thân
  phản hồi thô**, trước cả khi parse frame. Thô, nhưng không phụ thuộc hình dạng mảng nào.
- **trần số notebook của tài khoản**: frame `CCqFvf` trả về mà `e[2] == null` → hiểu là hết quota
  notebook. Nghĩa là `null` ở ô payload **không** phải lỗi parse; nó mang nghĩa.

Ta hiện **không** dò được ca nào trong hai ca này. Cả hai đều rơi vào `unknown` → dừng lượt, và
owner phải tự mở notebook đoán vì sao.

### 4. Khử trùng theo `title_type_charcount`

Oracle B gom nguồn trùng bằng khoá **(tiêu đề, loại, số ký tự)**, giữ bản có `arrayIndex` nhỏ
nhất, trả `duplicateIds` để xoá. Đây là câu trả lời của họ cho đúng chỗ mà `service-worker.js`
đang ghi *"bản trùng phải xoá tay"* — xem `docs/tickets/012-*.md`.

Ghi lại chứ **không** đề xuất chép: khoá đó cần đọc được danh sách nguồn kèm số ký tự, tức cần
đúng thứ `docs/tickets/005-*.md` đang chặn.
