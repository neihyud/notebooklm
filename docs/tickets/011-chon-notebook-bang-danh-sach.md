# 011 — Chọn notebook bằng danh sách, thay vì bắt owner đi dán URL

- status: **sẵn sàng giao** — hai chỗ chờ owner đã được chốt 2026-09-03, xem *Quyết định của owner*.
- class: **architecture lock-in** (`WORKSPACE_PROTOCOL.md` xếp *"hướng RPC batchexecute"* vào hạng
  này → so sánh alternatives + ghi rõ điều kiện đảo ngược **trước khi** viết code) **+
  cross-module** (chạm `MSG.*` và `src/background/service-worker.js`). Cũng chạm
  independent-review trigger *"thêm bề mặt mạng mới"* → cần review seat độc lập.
- tách từ: lượt đọc UX của Sourclip 1.8.0, 2026-09-03. Không commit nào đã làm gì cho việc này.
- blocked-by: **không còn.** Chỗ chặn là một quyết định của owner, không phải một phép đo — khác
  008/009 ở đúng chỗ đó — và owner đã chốt cả hai ngày 2026-09-03.
- không đụng: `automation.js`, `selectors.js`, đường DOM, `manifest.json`.

## Bối cảnh — chỗ đau, đọc ra từ code chứ không từ cảm giác

`resolveNotebookTab()` (`src/background/service-worker.js:179`): khi `settings.notebookUrl` rỗng
**và** không có tab nào đang ở trong một notebook, nó **ném**:

> `'Chưa có notebook nào đang mở. Hãy mở notebook đích rồi bấm "Dùng notebook ở tab hiện tại"`
> `trong popup, hoặc dán URL notebook vào Options.'`

Đó là toàn bộ đường vào của lượt đầu tiên. Và cái nút mà câu đó chỉ tới —
`els.useCurrent` (`src/popup/popup.js:595`) — chỉ đọc tab đang active rồi khớp
`/^https:\/\/notebooklm\.google\.com\/notebook\//`; không khớp thì nó ghi một dòng hint và **không
làm gì**. Nghĩa là owner phải: mở NotebookLM → vào đúng notebook → sang tab đó → mở lại popup →
bấm. Bốn bước, và ba trong số đó là để lấy một chuỗi mà backend đã sẵn sàng đọc ra.

Sourclip trả lời đúng chỗ này bằng `notebook-select` + `notebook-refresh-btn`.

## Bằng chứng — và lần này nó KHÔNG mỏng như 008

Khác hẳn ticket 008: đây không phải suy đoán về ngữ nghĩa một ô số. Oracle B **gọi thật**, và đọc
được cả hai chiều.

Gửi — `background.js`, hàm `$c()`:

```
rpcids      = wXbhsf
source-path = /                                        ← GỐC, không phải /notebook/<id>
f.req       = [[["wXbhsf","[null,1,null,[2]]",null,"generic"]]]
at          = <token>
```

Đọc — hàm `Qc()`: bỏ tiền tố `)]}'`, tách theo dòng, tìm frame có `e[1] === 'wXbhsf'`, rồi
`JSON.parse(e[2])[0]` là mảng notebook. Mỗi phần tử `e`: **`id = e[2]`** (bỏ qua nếu không phải
chuỗi không rỗng), **`title = e[0]`**, thiếu title thì `"(Untitled notebook)"`.

Oracle A cho **nửa phiếu**: bảng 40 rpc id có tên của nó ghi
`LIST_RECENTLY_VIEWED_PROJECTS: "wXbhsf"`. Nó xác nhận **ý nghĩa** của id — không xác nhận args,
không xác nhận vị trí `id`/`title`. Ghi cho đúng: **id có hai phiếu; hình dạng chỉ có một.**

Ba thứ đọc ra được và đáng ghi riêng:

1. **`source-path` là `/`.** Lượt liệt kê **không cần đứng trong một notebook** — bất kỳ tab
   `notebooklm.google.com/*` nào cũng đủ, kể cả trang chủ. Đây là thứ làm ticket này khả thi.
2. **Tên id nói "recently viewed", không phải "all".** Danh sách có thể **không đầy đủ**. Kết
   luận thiết kế bắt buộc: dropdown không bao giờ được là đường duy nhất.
3. `[null,1,null,[2]]` là **hằng số ngoại sinh chưa hiểu**. Không ai biết `1` và `[2]` nghĩa gì.
   Nó vào `BASE`/`rpcOverrides` như mọi giả thuyết ngoại sinh khác, không vào thân hàm.

## Quyết định của owner — 2026-09-03

Cả hai chỗ dưới đây **đã được chốt**, đúng theo đề xuất đã ghi sẵn trong từng mục. Giữ nguyên
phần lập luận chứ không xoá: nếu sau này ai muốn lật, thứ họ cần đọc là **vì sao** chốt thế, chứ
không phải chỉ là chốt cái gì.

| chỗ chốt | quyết định | hệ quả trực tiếp |
|---|---|---|
| Chốt 1 — cache token như Sourclip? | **KHÔNG** | dropdown cần một tab `notebooklm.google.com` đang mở; `rpc.js:10` giữ nguyên |
| Chốt 2 — tự mở tab nền khi bấm làm mới? | **CHƯA — làm (a) trước** | không mở tab nào; không có tab sẵn thì dropdown ẩn |
| (Lead quyết) gắn sau `rpcEnabled`? | **không**, đổi lại buộc ràng buộc cử chỉ | mở popup không phát request nào |
| Chốt 3 — có `+ Tạo notebook mới` trong dropdown? | **CÓ** (owner chốt 2026-09-03) | ticket có thêm một lượt **GHI** (`CCqFvf`); xem mục *Chốt 3* |

Peer **không** được lật một trong ba dòng này mà không hỏi lại — đặc biệt dòng thứ ba, vì hai vế
của nó là một cặp: bỏ `rpcEnabled` chỉ hợp lệ **kèm** ràng buộc cử chỉ.

## Hai chỗ owner phải chốt — lập luận đầy đủ

### Chốt 1 — có cache token như Sourclip không? Đề xuất: **KHÔNG.** → owner chốt: **KHÔNG**

Sourclip lấy token trong service worker: `fetch('https://notebooklm.google.com/?authuser=N&pageId=none',
{credentials:'include'})`, regex `"SNlM0e":"([^"]+)"` và `"cfb2h":"([^"]+)"` ra khỏi HTML, rồi
**ghi cả cụm — `baseUrl`, query params, headers, `atToken` — vào `chrome.storage.local.rpcContext`**
kèm TTL (`Ic()` dựng, `Fc()` ghi, `Lc()` đọc lại và dùng khi chưa hết hạn).

Đó chính là thứ làm dropdown của họ chạy được **kể cả khi không có tab NotebookLM nào**. Và đó
cũng đúng là thứ `src/notebooklm/rpc.js:10` cam kết không làm:

> *"cookie phiên. Không đọc cookie, không lưu token, không gửi gì ra ngoài origin."*

`WORKSPACE_PROTOCOL.md` → `Authority` xếp *"lưu trữ hay gửi cookie/token ra ngoài origin
`notebooklm.google.com`"* vào **prohibited without explicit authority**.

Đề xuất: giữ nguyên — token đọc từ `WIZ_global_data` **trong tab**, không rời thân request.

Cái giá phải nói thẳng, và nó **sửa một câu tôi đã nói sai với owner**: tôi từng bảo "dropdown
thì lượt đầu vẫn rỗng" như thể đó là giới hạn của giao thức. Không phải. Đó là giới hạn của
**lựa chọn bảo mật của ta**. Sourclip đã trả tiền để không có nó, và cái giá họ trả là lưu token
xuống đĩa. Ta không trả giá đó — nhưng phải biết mình đang từ chối cái gì.

### Chốt 2 — được tự mở tab NotebookLM khi owner bấm "làm mới" không? → owner chốt: **(a)**

Với Chốt 1 = KHÔNG, dropdown cần một tab. Hai đường:

- **(a) chỉ đổ danh sách khi ĐÃ CÓ SẴN** một tab `notebooklm.google.com/*`. Không có thì dropdown
  ẩn hẳn và ô dán URL đứng một mình y như hôm nay. Không mở tab nào, không request nào.
- **(b) khi owner BẤM nút làm mới**, mở `https://notebooklm.google.com/` ở tab nền, đọc danh
  sách, rồi đóng lại. Giải quyết được cả lượt đầu. Cái giá: một tab bật lên rồi biến mất — hành
  vi nhìn thấy được. `resolveNotebookTab()` đã có tiền lệ mở tab nền, nên không phải cơ chế mới.

Đề xuất: **(a) trước.** Nó xử lý lượt-thứ-hai-trở-đi, là phần lớn số lượt, và nó không cản (b).
Mở sang (b) chỉ khi owner thấy lượt đầu vẫn đau.

### Chỗ KHÔNG hỏi: có gắn sau `rpcEnabled` không? — Quyết: **không.**

`rpcEnabled` (mặc định `false`, `src/common/shared.js:126`) canh **đường ghi**. Nó tồn tại vì
`argsShape` sai thì Nguồn vào sai chỗ, hoặc `unknown` dừng cả lượt. `wXbhsf` **chỉ đọc**: hình
dạng sai thì bộ parse trả mảng rỗng, dropdown rỗng, ô dán URL nguyên vẹn. Không có chế độ hỏng
nào để canh. Gắn nó sau `rpcEnabled` là giấu tính năng khỏi đúng người cần nó nhất.

Đổi lại, ràng buộc thay thế phải cứng: **lượt liệt kê chỉ chạy sau một cử chỉ của owner** (mở
dropdown, hoặc bấm làm mới). Không chạy lúc popup mở, không chạy theo `alarms`. Owner lật quyết
định này được — nhưng lật thì phải lật cả ràng buộc cử chỉ, không lật riêng một nửa.

**Chỗ lập luận trên KHÔNG phủ, ghi lúc làm 2026-09-03.** Đoạn trên viết trước Chốt 3, nên nó chỉ
nói về `wXbhsf` và dựa hẳn vào chữ *"chỉ đọc"*. Chốt 3 thêm `CCqFvf`, và `CCqFvf` **có ghi**. Tôi
đã cho nó đi chung `rootAttempt`, tức cũng không sau `rpcEnabled` — quyết định của lead, không
phải của owner, nên nó nằm đây để owner nhìn thấy mà lật:

- Nhận, vì kiểu hỏng khác hẳn. `rpcEnabled` sinh ra để canh ca *Nguồn rơi vào sai ô của một
  notebook thật*. `CCqFvf` hỏng thì để lại một notebook rỗng thừa hoặc sai tên — xoá tay được,
  và không notebook đang có nào bị đụng.
- Và nó không tự chạy: owner phải chọn `+ Tạo notebook mới`, gõ tên, rồi bấm Tạo.
- Nếu owner thấy "đường ghi thì phải sau công tắc" là luật không có ngoại lệ, chỗ sửa là một
  dòng trong `createNotebook`, không phải sửa kiến trúc.

### Chốt 3 — có `+ Tạo notebook mới` ngay trong dropdown không? Đề xuất: **CÓ.** → owner chốt: **CÓ**

Mở 2026-09-03, sau khi owner gửi ảnh chụp popup Sourclip. Ticket này ban đầu coi dropdown là
**chỉ đọc** và đẩy việc tạo notebook sang "sau" — ảnh chụp cho thấy đó là chỗ tôi cắt phạm vi
sai, vì mục *"+ Create new notebook"* của họ **đứng đầu danh sách, ở mọi trạng thái**, và nó
chính là câu trả lời cho cái giá đã ghi ở Chốt 1 (*"lượt đầu dropdown vẫn rỗng"*).

Máy trạng thái của họ đọc được nguyên vẹn từ `popup.js` — **bốn** trạng thái, mỗi trạng thái một
việc làm được khác nhau, và không trạng thái nào là ngõ cụt:

| trạng thái | dropdown hiện | bật? |
|---|---|---|
| đang tải | `Loading notebooks…` | tắt |
| có context RPC, **0 notebook** | chỉ `+ Create new notebook` | **bật** — người mới vẫn đi tiếp được |
| **không** có context RPC | `Open NotebookLM to load notebooks` | tắt — nói thẳng phải làm gì |
| có notebook | `+ Create new notebook` **rồi mới tới danh sách** | bật |

Chỗ đáng học nhất là hàng thứ ba: khi hỏng, nhãn không phải *"Lỗi"* mà là **việc cần làm**. Và
hàng thứ hai là lý do tôi đổi đề xuất — nếu bỏ mục tạo mới thì trạng thái đó thành ngõ cụt, đúng
cái ngõ cụt mà `resolveNotebookTab()` đang ném hôm nay.

**Cái giá, và vì sao đây là quyết định của owner chứ không phải của Lead:** `CCqFvf` là một lượt
**GHI** lên tài khoản owner — `WORKSPACE_PROTOCOL.md` → *external side effects*. Nó nhẹ hơn hẳn
thêm Nguồn (một notebook rỗng thì xoá được, và không có nội dung nào để mất), nhưng nó **không
phải chỉ đọc** như phần còn lại của ticket này.

Owner đã chốt **CÓ**. Hệ quả phải ghi ra cho peer, vì nó đổi tính chất của cả ticket: 011 **không
còn là một ticket chỉ-đọc**. Câu ở Chốt 1 (*"hình dạng sai thì cùng lắm dropdown rỗng"*) chỉ còn
đúng cho `wXbhsf`; với `CCqFvf` thì hình dạng sai có thể tạo ra một notebook rác trong tài khoản
owner. Mọi ràng buộc ở mục *Kết quả cần có → 5* là để chặn đúng chuyện đó.

Bằng chứng cho `CCqFvf` ghi ở `docs/notebooklm-rpc-do-duoc-2.md` → *Bổ sung 2026-09-03*, mục 2.
Cùng hình dạng bằng chứng với `wXbhsf`: oracle A cho tên, oracle B cho args và đường đọc.

### Không hỏi: có bộ chọn TÀI KHOẢN như họ không? — Quyết: **không.**

Ảnh chụp của owner có thêm dropdown *"NotebookLM account"*. Bỏ, vì nó đứng trên đúng cơ chế mà
ticket này đã từ chối ở Chốt 1: oracle B gọi `accounts.google.com/ListAccounts` để liệt kê **mọi
tài khoản Google trên máy** rồi ghim `authuser` vào mọi request. Đó là một bề mặt mạng mới, tới
một origin mới, để giải một bài toán mà một công cụ cá nhân không có.

## Kết quả cần có

### 1. `listNotebooks()` đi qua đúng đường envelope đã có

Không dựng bộ dựng `f.req` thứ hai. `wXbhsf` dùng lại hàm đã dựng `f.req`/`at`/bóc `)]}'` cho
`izAoDd`; chỉ khác `rpcids`, `source-path`, và args.

### 2. Args và đường đọc là DỮ LIỆU

Hình dạng đề xuất — peer được đề xuất khác, nhưng phải nói rõ nó chịu được mấy biến thể:

```js
/** Liệt kê notebook. HẰNG SỐ NGOẠI SINH: chỉ một oracle, chưa hiểu `1` và `[2]`. */
listNotebooks: {
  rpcId: 'wXbhsf',
  sourcePath: '/',
  args: [null, 1, null, [2]],
  slots: { id: 2, title: 0 },
},
```

### 3. Danh sách rỗng KHÔNG phải lỗi

Không có tab / frame rỗng / parse trượt → dropdown không hiện. **Không** thông báo lỗi, **không**
đổi một ký tự nào của `settings.notebookUrl`. Đây là cùng một ràng buộc "chỉ nâng cấp, không bao
giờ hạ cấp" đã viết ở `docs/tickets/009-xac-minh-bang-sourceid.md`, và ở đây nó còn quan trọng
hơn: `notebookUrl` là thứ owner **đã gõ tay**.

### 4. Ô dán URL ở lại, và nó vẫn là nguồn sự thật

`settings.notebookUrl` không đổi kiểu, không đổi ngữ nghĩa. Dropdown chỉ là **một cách ghi vào
nó**. Hai lý do, cả hai đã đo được: `wXbhsf` là *"recently viewed"* nên không đảm bảo đủ; và ô
dán URL là đường duy nhất còn chạy khi RPC hỏng.

### 5. `+ Tạo notebook mới` — đường GHI duy nhất của ticket, và bốn ràng buộc của nó

```js
createNotebook: {
  rpcId: 'CCqFvf',
  sourcePath: '/',
  /** [title, null, null, [2], [1,null×9,[1]]] — args dựng từ `title`, không ghim. */
  slots: { id: 2 },   // notebookId = payload[0][2], lùi về payload[2]
},
```

1. **Không bao giờ tạo ngầm.** Chỉ tạo khi owner chọn đúng mục đó **và** đã nhập một cái tên. Mở
   popup, mở dropdown, làm mới danh sách — không cái nào được phát một `CCqFvf`.
2. **Không tự đặt tên.** Không lấy tiêu đề nguồn đầu hàng đợi, không `"Notebook 2026-09-03"`. Một
   cái tên tự sinh là một notebook mà owner không nhận ra là của mình trong danh sách tháng sau.
3. **Tạo xong thì ghi thẳng vào `settings.notebookUrl`.** Nếu không, owner bấm tạo lần nữa và tài
   khoản có hai notebook rỗng. Đây là chế độ hỏng dễ xảy ra nhất của mục này.
4. **`payload == null` nghĩa là CHẠM TRẦN, không phải lỗi parse.** Oracle B đọc frame `CCqFvf` có
   `e[2] == null` thành *"hết quota notebook"* (`docs/notebooklm-rpc-do-duoc-2.md` → *Bổ sung
   2026-09-03*, mục 3). Hiểu nhầm nó thành "parse hỏng" rồi lùi về `payload[2]` sẽ cho ra
   `undefined`, và ràng buộc 3 sẽ ghi `undefined` vào `notebookUrl`.

## Điều kiện đảo ngược

Bắt buộc với class *architecture lock-in*. Gỡ tính năng này khi bất kỳ điều nào đúng:

1. Bộ parse trả **mảng rỗng trên một tài khoản chắc chắn có notebook** → `[null,1,null,[2]]` đã
   hết đúng, và ta không có oracle thứ hai để sửa theo.
2. Danh sách **thiếu notebook mà owner vừa dùng** → *"recently viewed"* hẹp hơn mức dùng được, và
   một dropdown thiếu lựa chọn tệ hơn không có dropdown.
3. Google đổi `source-path` hoặc `rpcids` → cùng chế độ hỏng với `izAoDd`; khi đó gỡ dropdown rẻ
   hơn sửa nó.
4. **Riêng cho `CCqFvf`:** một lượt tạo trả về id đọc được nhưng notebook **không xuất hiện** trong
   `wXbhsf` lượt sau, hoặc tạo ra notebook mà owner không mở được. Gỡ ngay mục tạo mới, giữ phần
   còn lại — hai đường độc lập nhau, đó là lý do chúng là hai entry riêng trong `BASE`.

Gỡ = xoá `listNotebooks` khỏi `BASE` + ẩn dropdown. Ô dán URL không phụ thuộc gì vào nó, hàng đợi
không phụ thuộc gì vào nó, `notebookUrl` không đổi hình dạng. **Đảo ngược là một commit, không
phải một cuộc di trú** — và đó là khác biệt lớn nhất giữa ticket này và 008.

## Ràng buộc

1. **Không thêm permission nào.** `host_permissions` đã có `https://notebooklm.google.com/*`;
   `tabs` và `scripting` đã có. Nếu peer thấy cần thêm quyền thì **dừng lại và hỏi** —
   `Authority` xếp việc đó vào **Human must decide**.
2. Không lưu `at`, không lưu `bl`, không dựng `rpcContext`. Xem Chốt 1.
3. **Thử `CCqFvf` thì tạo notebook thật, không có "notebook nháp" cho thao tác này** — bản thân
   nó chính là thao tác tạo. Nên: thử tối thiểu, xoá tay sau khi xong, và **không** chạy thử
   trong vòng lặp. `Authority` → *external side effects*.
4. Danh sách notebook (id + tiêu đề) giữ trong bộ nhớ popup thì được. Ghi nó vào
   `chrome.storage` thì **phải nói ra trong handback**: đó là tên notebook riêng của owner, không
   phải hằng số ngoại sinh.
5. Không sửa câu ném trong `resolveNotebookTab()` ở ticket này. Nó vẫn đúng cho ca không có gì để
   liệt kê. Viết lại câu đó cho hợp dropdown là việc **sau khi** dropdown chạy thật.
6. Chọn (a) thì không mở tab nào — kể cả "chỉ một lần lúc khởi động".

## Kiểm chứng

`bash test/run.sh` xanh. Baseline đo trên cây sạch ở `95da1e5`, ngày 2026-09-03:
**1352 pass / 0 fail / 24 file**, exit 0 — nhưng **đo lại chứ đừng chép**.

## Ở acceptance sẽ hỏi

Mỗi câu nói rõ **chiều nào phải đỏ**.

1. **Đảo `slots.id` và `slots.title`** (2 ↔ 0). Chiều phải đỏ: ticket viết là **bản hoán vị** —
   **và đó là một dự đoán SAI, đã đo và bác bỏ lúc làm** (2026-09-03).

   Hoán vị đó **không đỏ được**, vì lý do cấu trúc chứ không phải sơ suất: `slots` chính là thứ
   **định nghĩa** nghĩa của hai ô, nên mọi fixture đều phải dựng theo nó và hai vế đảo cùng nhau.
   Đo thật: đảo slots → **45 pass / 0 fail**. Muốn nó đỏ thì phải gõ tay một con số ô, tức chứng
   nhận một hằng số ngoại sinh mà chỉ `tools/probe-notebooklm.mjs` mới đo được — đúng bẫy *test
   ghim hằng số chép tay*. Đây là ca *"hai vế đều là giả thuyết của ta"*.

   **Thứ đứng thay** là một cơ chế phát hiện lúc chạy, thêm vào chính vì phép đo này:
   `listNotebooks.idPattern` (`^[A-Za-z0-9_-]{8,}$`) từ chối dòng mà ô "id" mang chuỗi có khoảng
   trắng — tức một tiêu đề. Đọc nhầm ô thì dropdown rỗng và `notebookUrl` **không đổi**, thay vì
   nhận một cái tên làm id. Cơ chế đó thì test được, và nó cắn: `idPattern` nhận tất → **4 đỏ**;
   mẫu hỏng nghĩa là "nhận" thay vì "từ chối" → **1 đỏ**.
2. **Đổi `sourcePath` từ `/` sang một đường notebook.** Chiều phải đỏ: **bản hoán vị** — nhưng
   chỉ khi có test ghim `source-path` **trong query string thật sự gửi đi**. Nếu câu trả lời là
   "không test nào" thì nói ra: nghĩa là chỗ này chỉ có oracle đỡ, không có lưới.
3. **Cho danh sách rỗng đi vào nhánh lỗi** (ném, hoặc xoá `notebookUrl`). Chiều phải đỏ: **bản
   hoán vị**. Đây là ca hỏng nặng nhất của ticket — nó biến một tính năng tiện thành một tính
   năng **xoá mất notebook đích owner đã dán tay**. Assert phải ghim: liệt kê trả rỗng ⇒
   `settings.notebookUrl` **không đổi một ký tự**.
4. **Bỏ ràng buộc "chỉ chạy sau cử chỉ của owner"** — cho lượt liệt kê chạy ngay lúc popup mở.
   Chiều phải đỏ: **bản hoán vị**, nếu có test ghim rằng mở popup không phát request nào. Nếu
   không có thì nói ra — đó là ràng buộc đổi lấy việc **không** gắn sau `rpcEnabled`, nên nó
   không có lưới nào khác đỡ.

5. **Đảo `notebookId` mới tạo với `title` vừa nhập** ở chỗ ghi vào `settings.notebookUrl`. Chiều
   phải đỏ: **bản hoán vị**. Lại đúng hình dạng *đường dữ liệu song song* — hai chuỗi, một cái
   owner gõ vào, một cái server trả về, gặp nhau trong đúng một hàm. Đảo chúng thì popup vẫn báo
   "đã tạo", `notebookUrl` vẫn là một chuỗi, và lượt import kế tiếp mới hỏng. Fixture phải có
   title và id **khác nhau rõ rệt**.

6. **Cho `payload == null` đi vào nhánh thành công** (hiểu là "parse hỏng, lùi về `payload[2]`").
   Chiều phải đỏ: **bản hoán vị**. Đây là ca hỏng tệ nhất của Chốt 3: owner chạm trần notebook,
   ta ghi `undefined` vào `notebookUrl`, và mọi lượt import sau đó nhắm vào hư không. Assert phải
   ghim: `payload == null` ⇒ `settings.notebookUrl` **không đổi**, và thông báo nói đúng chữ
   "chạm trần" chứ không phải "lỗi".

7. **Cho lượt tạo chạy mà không có cử chỉ chọn** (ví dụ lúc mở dropdown, hoặc lúc nạp lại danh
   sách). Chiều phải đỏ: **bản hoán vị**. Assert phải đếm **cú gửi `CCqFvf`**, không phải kết
   quả trả về — theo đúng bài học `hoan-vi-nut-can-ghi-lai-cu-bam`: hai nhánh cùng trả về một
   object hình dạng giống nhau thì assert kết quả xanh cả hai chiều.

8. **Tạo xong nhưng KHÔNG ghi `settings.notebookUrl`.** Chiều phải đỏ: **bản hoán vị**. Không có
   assert này thì chế độ hỏng là im lặng và tích luỹ: mỗi lần owner bấm là thêm một notebook rỗng
   trong tài khoản, và giao diện không có gì sai để nhìn ra.

Câu nào trả lời là "không test nào" vẫn là kết quả hợp lệ — **nhưng phải nói ra**.
