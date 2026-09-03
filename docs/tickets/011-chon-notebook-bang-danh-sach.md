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

## Điều kiện đảo ngược

Bắt buộc với class *architecture lock-in*. Gỡ tính năng này khi bất kỳ điều nào đúng:

1. Bộ parse trả **mảng rỗng trên một tài khoản chắc chắn có notebook** → `[null,1,null,[2]]` đã
   hết đúng, và ta không có oracle thứ hai để sửa theo.
2. Danh sách **thiếu notebook mà owner vừa dùng** → *"recently viewed"* hẹp hơn mức dùng được, và
   một dropdown thiếu lựa chọn tệ hơn không có dropdown.
3. Google đổi `source-path` hoặc `rpcids` → cùng chế độ hỏng với `izAoDd`; khi đó gỡ dropdown rẻ
   hơn sửa nó.

Gỡ = xoá `listNotebooks` khỏi `BASE` + ẩn dropdown. Ô dán URL không phụ thuộc gì vào nó, hàng đợi
không phụ thuộc gì vào nó, `notebookUrl` không đổi hình dạng. **Đảo ngược là một commit, không
phải một cuộc di trú** — và đó là khác biệt lớn nhất giữa ticket này và 008.

## Ràng buộc

1. **Không thêm permission nào.** `host_permissions` đã có `https://notebooklm.google.com/*`;
   `tabs` và `scripting` đã có. Nếu peer thấy cần thêm quyền thì **dừng lại và hỏi** —
   `Authority` xếp việc đó vào **Human must decide**.
2. Không lưu `at`, không lưu `bl`, không dựng `rpcContext`. Xem Chốt 1.
3. Danh sách notebook (id + tiêu đề) giữ trong bộ nhớ popup thì được. Ghi nó vào
   `chrome.storage` thì **phải nói ra trong handback**: đó là tên notebook riêng của owner, không
   phải hằng số ngoại sinh.
4. Không sửa câu ném trong `resolveNotebookTab()` ở ticket này. Nó vẫn đúng cho ca không có gì để
   liệt kê. Viết lại câu đó cho hợp dropdown là việc **sau khi** dropdown chạy thật.
5. Chọn (a) thì không mở tab nào — kể cả "chỉ một lần lúc khởi động".

## Kiểm chứng

`bash test/run.sh` xanh. Baseline đo trên cây sạch ở `95da1e5`, ngày 2026-09-03:
**1352 pass / 0 fail / 24 file**, exit 0 — nhưng **đo lại chứ đừng chép**.

## Ở acceptance sẽ hỏi

Mỗi câu nói rõ **chiều nào phải đỏ**.

1. **Đảo `slots.id` và `slots.title`** (2 ↔ 0). Chiều phải đỏ: **bản hoán vị**. Đúng hình dạng
   *đường dữ liệu song song*: hai chuỗi cùng kiểu đi ra từ một phần tử mảng. Đảo chúng thì
   dropdown vẫn đúng số dòng, vẫn "chạy" — chỉ có `value` của `<option>` thành tiêu đề và nhãn
   thành id, tức thứ ghi vào `notebookUrl` là rác. Assert phải dùng fixture mà **id và title khác
   nhau rõ rệt** và ghim **trường nào mang giá trị nào**; một phần tử có id trùng title thì xanh
   cả hai chiều.
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

Câu nào trả lời là "không test nào" vẫn là kết quả hợp lệ — **nhưng phải nói ra**.
