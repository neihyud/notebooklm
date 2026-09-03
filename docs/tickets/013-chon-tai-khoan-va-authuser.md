# 013 — Chọn tài khoản Google, và ghim `authuser` vào mọi request

- status: **đã làm** — owner chốt "y hệt Sourclip" 2026-09-03; code + phép đo ở dưới.
- class: **architecture lock-in** + **cross-module** + chạm **hai mục `Authority`**:
  - *Human must decide* → *"đổi hai cam kết bảo mật trong `README.md`"* → **owner đã quyết**;
  - *prohibited without explicit authority* → *"lưu trữ hay gửi cookie/token ra ngoài origin
    `notebooklm.google.com`"* → **owner đã cho phép rõ ràng**, với cái giá viết sẵn trên màn hình
    lúc chọn.
- tách từ: owner chỉ vào dropdown *"NOTEBOOKLM ACCOUNT"* trong ảnh chụp Sourclip và hỏi *"bạn có
  thấy nó cho account rồi mới lấy list không"*. Có — và ticket 011 đã đọc **sai tầng** chỗ đó.
- đảo: **Chốt 1 của ticket 011** (`KHÔNG cache token`). Xem *Vì sao đảo*.
- không đụng: `automation.js`, `selectors.js`, `manifest.json` (không cần — xem dưới).

## Vì sao ticket 011 sai, và sai ở tầng nào

011 dòng 170 có một mục *"Không hỏi: có bộ chọn TÀI KHOẢN như họ không? — Quyết: không"*, lý do
ghi là *"bề mặt mạng mới tới một origin mới, để giải một bài toán mà một công cụ cá nhân không
có"*.

Lý do đó không sai. Nhưng nó trả lời câu hỏi **"có làm cái dropdown không"**, trong khi câu hỏi
thật là **"request của ta rơi vào tài khoản nào"**. `authuser` không phải thứ nuôi cái dropdown;
nó là một tham số trên **mọi** request, và cái dropdown chỉ là chỗ chọn giá trị cho nó.

Đo được, không phải suy đoán: `buildUrl` (`src/notebooklm/rpc.js:526`) đặt đúng bốn tham số —
`rpcids`, `source-path`, `_reqid`, `rt`. `grep -rn authuser src/` cho đúng một hit, ở
`page-bridge.js`, thuộc chuyện YouTube khác hẳn. **Ta chưa từng gửi `authuser`.**

Hệ quả, và nó có từ trước 011 chứ không phải do 011 sinh ra: với owner có từ hai tài khoản Google
đăng nhập, ta không điều khiển được lượt ghi rơi vào tài khoản nào. 011 chỉ làm nó dễ đụng hơn,
vì giờ có thêm `CCqFvf` tạo notebook.

Oracle B xác nhận luôn giá trị mặc định, nên chỗ này thôi không còn là suy đoán: `zc()` trả về
`` `0` `` khi không có lựa chọn nào và không bắt được `authuser` nào.

## Bằng chứng — đọc trực tiếp từ bản 1.8.0 đang cài

Đọc bundle đã minify (`background.js`, 3.719 byte/dòng, không sourcemap), nên **tên hàm là do
minifier đặt và sẽ đổi ở bản sau**. Ghi lại ở đây là ghi *cơ chế*, không phải địa chỉ.

### 1. Liệt kê tài khoản — `Wc()`

```
GET https://accounts.google.com/ListAccounts
      ?json=standard&source=ogb&md=1&cc=1&mn=1&mo=1&gpsia=1&fwput=860
      &listPages=1&origin=https%3A%2F%2Fwww.google.com
      credentials: include, AbortController 8000 ms
```

Đọc: `JSON.parse` thẳng → nếu hỏng thì bỏ tiền tố `)]}'` → nếu vẫn hỏng thì **bảy** regex vớt
(`postMessage('…')`, `var accounts = […]`, `["ListAccounts", […]]`, …) kèm một bộ gỡ escape
`\xNN`. Bảy đường lùi cho một endpoint là dấu hiệu rõ: **hình dạng phản hồi không ổn định.**

Rồi đệ quy khắp mảng, nhặt phần tử có `e[0] === 'gaia.l.a'` và `typeof e[3] === 'string'`:

| ô | nghĩa |
|---|---|
| `[0]` | `'gaia.l.a'` — dấu nhận biết |
| `[2]` | tên hiển thị (rỗng thì lấy phần trước `@`) |
| `[3]` | **email** |
| `[6]` | `=== 1` nghĩa là tài khoản mặc định |
| `[7]` | **chỉ số `authuser`** — không phải số thì lùi về vị trí trong mảng |

Lọc bỏ email chứa `@unknown`.

Đây là **hằng số ngoại sinh một phiếu**: chỉ oracle B, không có oracle nào khác xác nhận, và
`docs/notebooklm-rpc-do-duoc-2.md` chưa từng ghi. Nó vào **dữ liệu ghi đè được**, không vào thân hàm.

### 2. Ngữ cảnh RPC — `Ic()` dựng, `Fc()` ghi, `Lc()` đọc

```
authuser = Jc(Kc())                      # email đã chọn → chỉ số; không có thì `0`
thử lần lượt: notebooklm.google.com, notebook.google.com
GET  <origin>/?authuser=<N>&pageId=none  credentials: include, redirect: follow, 5000 ms
/"SNlM0e":"([^"]+)"/   → at
/"cfb2h":"([^"]+)"/    → bl
```

Ghi `{baseUrl, queryParamEntries, headers, atToken, ts}` vào `chrome.storage.local.rpcContext`.
Đọc: bộ nhớ (`Pc`) → storage nếu `ts + 432e5 > now` (**12 giờ**) → dựng lại.

### 3. Chỗ quan trọng nhất, và là chỗ dễ bỏ sót nhất

`Xc(email)` = `qc(email)` (lưu lựa chọn) → `Yc()` (**xoá cả `Pc` lẫn `rpcContext`**) → `Ic()`.

**Đổi tài khoản BẮT BUỘC vứt token đang cache.** Token `SNlM0e` thuộc về một tài khoản cụ thể;
giữ token của A mà gửi kèm `authuser=B` là đúng hình dạng *đường dữ liệu song song* — hai giá trị
ra từ cùng một nguồn, chảy tới hai chỗ khác nhau trong cùng một request, và không có gì trong
kiểu dữ liệu buộc chúng khớp nhau. Đây là **correspondence-critical pair** của ticket này.

### 4. Tự chỉnh lựa chọn theo lưu lượng bắt được

Listener `NOTEBOOKLM_RPC_CAPTURED` đọc `authuser` từ URL bắt được, ánh xạ ngược ra email, và nếu
khác lựa chọn đang lưu thì **ghi đè lựa chọn**. Cũng có một chốt nhỏ đáng chép: `if (Pc && !i)
return` — không cho một ngữ cảnh **thiếu token** đè lên một ngữ cảnh đang tốt.

**Ta KHÔNG chép mục 4.** Nó dựa trên việc vá `fetch` trong trang để bắt request của chính
NotebookLM — một cơ chế ta không có và không muốn có. Ghi lại vì nó giải thích vì sao dropdown
của họ tự đúng mà người dùng không phải chạm vào.

## Không phải đụng `manifest.json`

`host_permissions` đã có `https://*/*` (cho content script docs chạy mọi trang). Nó phủ luôn
`accounts.google.com`. Nên mục *Human must decide* → *"thêm quyền mới vào manifest.json"*
**không** được kích hoạt, và ticket này không đổi một dòng nào trong manifest.

Ghi kèm một điều khó chịu cho lượt rà soát sau: `https://*/*` rộng tới mức nó biến "xin quyền
mới" thành chuyện vô hình. Đó là một khuyết tật của manifest hiện tại, không phải một tiện lợi.

## Ba đường, và vì sao chọn đường đắt nhất

Bắt buộc so sánh trước khi viết code, vì đây là hạng *architecture lock-in*.

**(A) Đọc `authuser` từ URL của tab đang dùng.** `anyNotebookLmTab()`
(`src/background/service-worker.js:191`) đã cầm `tab.url` ở dòng 196 và đang vứt đi. Rẻ nhất:
không origin mới, không lưu gì, không đổi cam kết nào.

- Được: mọi request khớp đúng tài khoản của cái tab owner đang nhìn.
- Mất: **không chọn được tài khoản.** Muốn sang tài khoản khác thì phải tự mở tab tài khoản đó
  trước. Và vẫn cần một tab đang mở — lượt đầu vẫn rỗng, đúng cái đau mà 011 định chữa.
- Lý do không chọn: owner đã nghe đường này ở lượt trước và chọn đường Sourclip.

**(B) Sourclip đầy đủ — CHỌN.** ListAccounts + cache token 12 giờ + ghim `authuser`.

- Được: chọn được tài khoản; chạy được **cả khi không có tab nào mở**; lượt đầu không còn rỗng.
- Mất: token `at` nằm trên đĩa; một origin mới; và một cam kết trong README phải viết lại.

**(C) Không làm gì.** Giữ nguyên, chấp nhận mọi request ngầm đi vào `authuser=0`.

- Với owner chỉ có một tài khoản thì (C) đúng và rẻ nhất.
- Lý do không chọn: ta **không biết** owner có mấy tài khoản, và kiểu hỏng của (C) là im lặng —
  ghi vào nhầm tài khoản mà không báo gì. Kiểu hỏng im lặng là thứ repo này từ chối ở mọi chỗ khác.

## Điều kiện đảo ngược — viết TRƯỚC khi có code

Bắt buộc với hạng *architecture lock-in*. Đảo về (A) khi **bất kỳ** dòng nào dưới đây thành thật:

1. **`ListAccounts` đổi hình dạng.** Bảy regex vớt của oracle B đã nói trước rằng nó sẽ đổi. Ta
   không chép bảy đường lùi đó; ta để `detectAccounts()` trả mảng rỗng và popup lùi về đường (A).
   Mảng rỗng **không** được làm hỏng gì khác.
2. **Google gỡ `authuser` khỏi batchexecute**, hoặc bắt đầu từ chối token chéo tài khoản bằng một
   mã lỗi riêng. Dấu hiệu: lượt ghi hỏng ngay sau khi đổi tài khoản mà không hỏng trước đó.
3. **Owner rút lại quyền lưu token.** Chỗ sửa là một hằng `TTL = 0` cộng việc bỏ `Fc()` — không
   phải sửa kiến trúc. Cố ý dựng để chỗ đảo chỉ nằm ở một nơi.
4. **Cache token sinh ra một lượt ghi vào nhầm tài khoản.** Đây là điều kiện đảo **cứng**: gặp
   một lần là gỡ cache, không thương lượng.

## Kết quả cần có

### 1. Hằng số ngoại sinh là DỮ LIỆU, không nằm trong thân hàm

Các ô `gaia.l.a`/`[2]`/`[3]`/`[6]`/`[7]`, URL `ListAccounts`, TTL, danh sách origin — tất cả vào
một object cấu hình ghi đè được từ trang Cài đặt, cùng luật với `argsShape`/`slots`/`kindCodes`.
Một phiếu duy nhất thì càng phải ghi đè được mà không cần bản mới.

### 2. Token và `authuser` không bao giờ rời nhau

Ngữ cảnh cache **phải mang theo `authuser` của chính nó**, và chỗ đọc phải từ chối khi `authuser`
được yêu cầu khác `authuser` đã cache. Không dựa vào việc "nhớ gọi hàm xoá" — Sourclip dựa vào
đúng chỗ đó (`Yc()` trong `Xc()`), và đó là một lời hứa của người viết, không phải một ràng buộc
của cấu trúc. Ta ghim bằng cấu trúc.

### 3. Hỏng thì im lặng lùi, không im lặng ghi sai

- `ListAccounts` hỏng → dropdown tài khoản ẩn, phần còn lại chạy như hôm nay.
- Không lấy được token → `ok:false` kèm lý do, **không** thử tài khoản khác.
- Không có tài khoản nào chọn → dùng `authuser` của tab nếu có; không có tab thì `0`, và **nói ra
  trong giao diện** là đang dùng tài khoản mặc định.

### 4. README nói thật

Cam kết *"token không vào bộ nhớ extension"* thành sai kể từ ticket này. Không được để nguyên,
và cũng không được xoá trắng — viết lại cho đúng chỗ nó vẫn đúng (`manifest.json` vẫn không xin
quyền `cookies`; không có gì rời khỏi hai origin Google) và nói thẳng chỗ nó không còn đúng.

Cam kết còn lại — *"không có, và không cần, bất kỳ khả năng nào để thay đổi chế độ hiển thị
video"* — **không đụng tới.**

## Đã đo — 2026-09-03, sau khi viết code

Đo bằng **exit code kèm tổng pass/fail** của `google-accounts.test.js` +
`notebooklm-notebooks.test.js`, không đếm dòng đỏ. Gốc: **94 pass / 0 fail**.

| đột biến | kết quả | đọc ra |
|---|---|---|
| Q1 — `usable()` bỏ phép khớp `authuser` | **89 / 5 đỏ** | ràng buộc trung tâm cắn, và cắn mạnh nhất |
| Q2 — đảo ô `email` ↔ `name` | **94 / 0 đỏ** | **xanh — xem dưới** |
| Q3 — TTL vô hạn | 92 / **2 đỏ** | ✔ |
| Q4 — `clearRpcContext` quên xoá bản nhớ RAM | 93 / **1 đỏ** | ✔ |
| Q5 — `buildUrl` không gửi `authuser` | 93 / **1 đỏ** | ✔ |
| Q6 — bỏ phép canh bằng biến ở `rootAttempt` | 94 / 0 đỏ | **code chết — xem dưới** |
| Q6b — đổi hằng `null` thành `o.authuser` | 93 / **1 đỏ** | ✔ ràng buộc thật nằm ở hằng số |
| Q7 — mẫu email hỏng thì NHẬN thay vì từ chối | 93 / **1 đỏ** | ✔ |

### Q2 xanh, và ticket này đã đoán trước

Câu nghiệm thu 2 viết sẵn: *"nếu hoá ra không đỏ được vì cùng lý do cấu trúc như 011 thì ghi lại
đúng như thế"*. Đúng là thế. `accountSlots` **định nghĩa** nghĩa của hai ô, nên fixture dựng theo
nó và hai vế đảo cùng nhau — y hệt `slots.id`/`slots.title` của ticket 011. Ghim tay một con số ô
để ép nó đỏ chính là bẫy *test ghim hằng số chép tay*.

Thứ đứng thay đã có sẵn trong code trước khi đo, và nó cắn: `looksLikeEmail`. Đảo ô lúc chạy thật
thì ô "email" mang một cái tên người, bị loại, dropdown tài khoản rỗng → **ẩn đi** → lùi về đường
`authuser` của tab. Không có lượt ghi nào vào nhầm tài khoản. Q7 đo chính cơ chế đó: **1 đỏ**.

Chỗ duy nhất làm Q2 đỏ được là một **phản hồi `ListAccounts` thật** đã ghi lại — tức một lượt
`tools/probe-notebooklm.mjs`. Cho tới lúc đó, hình dạng này là *một phiếu, chưa kiểm chứng*.

### Q6 xanh vì code chết, không phải vì hở

`rootAttempt` từng có `const authuser = at ? o.authuser : null`. Đột biến gỡ phép canh đó **không
đỏ được** — vì nhánh không-có-`at` gọi `finish(found.token, null)` với hằng `null` viết thẳng, nên
cái biến kia không ai đọc. Đúng ca *hoán vị xanh giả vì code chết*.

Đã **gỡ** dòng thừa thay vì thêm test cho nó. Đo lại đúng chỗ giữ luật (Q6b: đổi hằng `null` thành
`o.authuser`): **1 đỏ**.

## Câu nghiệm thu — mỗi câu nói rõ chiều nào phải đỏ

1. **Cache token của tài khoản A rồi đòi `authuser` của B.** Phải đỏ. Đây là
   correspondence-critical pair của ticket, và khác câu 1 của ticket 011 ở chỗ nó **đo được**:
   hai giá trị có nguồn khác nhau và hình dạng khác nhau, nên fixture không tự đảo theo.
2. **Đảo ô `[3]` (email) và ô `[2]` (tên) trong bộ đọc `ListAccounts`.** Phải đỏ — và phải kiểm
   xem nó có đỏ thật không, chứ không ghi sẵn là đỏ. Nếu hoá ra không đỏ được vì cùng lý do cấu
   trúc như 011, thì **ghi lại đúng như thế và dựng một phép phát hiện lúc chạy thay vào** (email
   có `@`, tên thì không) — chứ không ghim tay một con số ô.
3. **Cho TTL vô hạn.** Phải đỏ ở phép kiểm token hết hạn.
4. **Bỏ bước xoá cache khi đổi tài khoản.** Phải đỏ. Trùng đích với câu 1 nhưng đi từ đường khác:
   câu 1 canh chỗ đọc, câu 4 canh chỗ chuyển.


## Tự soát sau khi giao — 2026-09-03

Không có review seat độc lập cho ticket này, nên tôi đọc lại chính code vừa viết. **Hai khuyết
tật thật, cả hai do commit đầu của ticket này tạo ra**, cả hai đều thuộc đúng loại mà repo sợ
nhất: hỏng im lặng.

### 1. `createNotebook` lùi sang đường tab một cách mù quáng

Bản đầu viết `if (!r.ok) { …lùi sang tab… }`. Nhưng `created-but-no-id` nghĩa là notebook **có thể
đã tạo xong rồi** mà ta không đọc được id — lùi lúc đó là tạo cái **thứ hai**, và owner phải xoá
tay. Tạo notebook không idempotent, y hệt thêm Nguồn; `README.md` đã ghi đúng bài học này cho
đường Nguồn mà tôi vẫn lặp lại ở đây. `notebook-limit` thì lùi cũng vô ích: trần là của tài
khoản, không phải của đường đi.

Sửa: chỉ lùi với những trạng thái **chứng minh được là chưa có byte nào rời máy**.

### 2. Đường lùi nhận bất kỳ tab NotebookLM nào

`anyNotebookLmTab()` không biết gì về tài khoản. Nên: owner chọn tài khoản A, đường thẳng hỏng,
ta lùi sang một tab đang mở ở tài khoản B, và trả về danh sách notebook của B **trong khi dropdown
vẫn hiện A**. Đó đúng là chế độ hỏng mà cả ticket này tồn tại để chặn — tôi dựng ràng buộc
token↔`authuser` rất kỹ ở tầng dưới rồi để hở nó ở tầng trên.

Sửa: `anyNotebookLmTab(wantAuthuser)` lọc tab theo `authuser`; không biết đang nhắm ai thì **không
lùi**, trả về `chosen-missing` để giao diện nói ra.

### Đo — `test/service-worker-accounts.test.js`, gốc 22 pass / 0 fail

| đột biến | kết quả |
|---|---|
| M1 — lùi mù quáng như bản cũ | 18 pass, **4 đỏ** |
| M2 — đường lùi nhận tab bất kỳ | 19 pass, **3 đỏ** |

Một chỗ suýt xanh-giả trong chính test này, ghi lại vì nó là bài học chứ không phải sự cố: stub
`chrome.tabs.sendMessage` ban đầu trả lời **cả ping của `ensureScripts`** bằng cùng một câu, nên
phép đếm "có lùi sang đường tab không" đếm nhầm cả bước dò script. Ba ca C/D/E khi đó xanh vì lý
do sai. Stub giờ tách ping riêng, và có một assertion neo `MSG_PING` vào hằng thật của repo để
việc đổi tên không lặng lẽ mở lại lỗ đó.
