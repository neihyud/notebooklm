# 012 — Hoàn tác lượt vừa chạy, vì code của ta đang tự khai là không có đường lùi

- status: draft — **chưa giao**
- class: **architecture lock-in** (`WORKSPACE_PROTOCOL.md` xếp *"hướng RPC batchexecute"* vào hạng
  này → so sánh alternatives + điều kiện đảo ngược **trước khi** viết code) **+ cross-module**
  (thêm `MSG.*`, chạm `src/background/service-worker.js`, chạm popup). Thêm một **bề mặt mạng
  ghi, và là bề mặt PHÁ HUỶ đầu tiên của repo** → review seat độc lập là bắt buộc, không phải
  tuỳ Lead.
- tách từ: lượt đọc quản lý của Sourclip 1.8.0, 2026-09-03.
- **blocked-by: `docs/tickets/009-xac-minh-bang-sourceid.md`.** Cứng, không đi vòng được: không có
  `sourceId` do server trả về thì ticket này **không có gì để xoá một cách an toàn**. Xem
  "Vì sao 009 là điều kiện cần, không phải điều kiện tiện".
- liên quan: `docs/tickets/008-mot-request-nhieu-nguon.md` — 008 chặn phần lớn vì
  `unknown`-nhân-N không cứu được. Ticket này hạ hạng rủi ro đó, nên thứ tự đúng là **009 → 012 →
  008**.
- không đụng: `automation.js`, `selectors.js`, `manifest.json`, đường DOM.

## Bối cảnh — chỗ đau này do chính code ta khai ra, không phải do so với ai

`src/background/service-worker.js:1143` và `:1266`, hai lần, cùng một câu:

```js
// Nguồn ĐÃ vào notebook (chỉ là không đúng 1). Rơi sang đường kế tiếp là
// thêm lần nữa — thao tác này không idempotent, bản trùng phải xoá tay.
```

Code biết nó vừa tạo một bản trùng, biết chính xác lúc nào, và câu trả lời duy nhất nó có là
*"xoá tay"*. `README.md` nói y hệt ở mục *"Xong nghĩa là đã kiểm chứng"*.

Ta khử trùng **trong hàng đợi** (`itemKey`, `:541`) và **trong Bó trao tay** (cửa 2, `:662`).
Không chỗ nào đối chiếu với thứ **đã nằm sẵn trong notebook**, và không chỗ nào lùi được sau khi
đã ghi. Đó là toàn bộ mặt "quản lý" của repo hiện nay.

## Phạm vi — và phần lớn ticket này là nói KHÔNG

Đây là **hoàn tác**, không phải **xoá**. Khác biệt đó là toàn bộ giá trị an toàn của ticket, nên
viết ra thành ràng buộc chứ không để ở dạng tinh thần:

- Hoàn tác **chỉ chạm những `sourceId` do chính lượt vừa chạy tạo ra** và ta đã ghi lại.
- **Không** có giao diện "xoá nguồn" chung. Không danh sách nguồn của notebook, không checkbox,
  không "xoá nguồn này".
- **Không** xoá theo tiêu đề, theo vị trí, theo thứ tự, theo bất kỳ thứ gì suy ra được. Chỉ theo
  id server đã cấp. Xoá theo tiêu đề là đường thẳng tới việc xoá mất nguồn owner tự thêm.
- **Không** hoàn tác được thì **không hiện nút**. Im lặng, không báo lỗi.

Một giao diện xoá tổng quát nhắm notebook thật của owner là thứ nguy hiểm nhất repo này từng có.
`WORKSPACE_PROTOCOL.md` → *external side effects* đã xếp việc **ghi** vào hạng cần cân nhắc; xoá
thì nặng hơn ghi, vì ghi sai còn xoá tay được, còn xoá sai thì mất hẳn.

## Vì sao 009 là điều kiện cần, không phải điều kiện tiện

Nếu ticket này khởi động trước 009, thứ duy nhất nó có để nhận diện nguồn vừa thêm là **đọc danh
sách nguồn rồi đoán cái nào là của mình** — theo tiêu đề, hoặc theo "cái mới nhất". Cả hai đều là
suy đoán về nội dung notebook của owner, và cả hai đều hỏng **câm** đúng theo chiều tệ nhất: xoá
nhầm một nguồn owner tự thêm, và người dùng chỉ biết khi đã mất.

`sourceId` do server cấp không có chế độ hỏng đó. Không có id → không có nút → không có gì xảy ra.

Hệ quả phải nói thẳng: **đường DOM không sinh ra `sourceId`**, nên hoàn tác **chỉ tồn tại cho
những nguồn đã đi bằng đường RPC**. Một lượt chạy hỗn hợp sẽ hoàn tác được một phần. Điều đó phải
hiện ra trên giao diện bằng số (*"hoàn tác được 3/7 nguồn của lượt này"*), không được làm tròn
thành "Hoàn tác".

## Bằng chứng cho `tGMBJ`

Cùng hình dạng bằng chứng với `wXbhsf` ở ticket 011: **oracle A cho phiếu về ý nghĩa, oracle B
cho phiếu về hình dạng.**

Oracle A (`assets/chunk-e2d7b064.js`), bảng rpc id có tên, tên gốc chưa minify:

```js
ADD_SOURCES: "izAoDd", DELETE_SOURCES: "tGMBJ", MUTATE_SOURCE: "b7Wfje", …
```

Oracle B gọi thật ở **hai chỗ độc lập**, và hai chỗ **đồng ý về hình dạng**:

| hàm | args | ghi chú |
|---|---|---|
| `gl(ids, notebookId)` | `[ ids.map(id => [id]), [2] ]` | cắt mẻ **50 id một request** |
| `Kl(notebookId, id, …)` | `[ [[id]], [2] ]` | một id — cùng hình dạng, N = 1 |

Cả hai: `rpcids=tGMBJ`, `source-path=/notebook/<notebookId>`.

Tức hình dạng là `[[[id₁],[id₂],…],[2]]`. Con số `50` là **quan sát về lựa chọn của oracle B**,
không phải giới hạn đo được của server — đừng ghi nó vào code như một sự thật.

## Kết quả cần có

### 1. Sổ hoàn tác, gắn với LƯỢT CHẠY, không gắn với mục hàng đợi

Mỗi lượt `runQueue` ghi lại: `notebookId` **thật sự đã ghi vào** (không phải `settings.notebookUrl`
lúc đọc lại), danh sách `sourceId` nhận được, và mốc thời gian. Sổ này **thay thế** nhau giữa các
lượt — chỉ giữ lượt gần nhất. Lý do: một sổ tích luỹ là một danh sách xoá được ngày càng dài nằm
trong `chrome.storage`, và đó chính là cái giao diện xoá tổng quát mà mục *Phạm vi* vừa từ chối.

### 2. Cửa sổ hoàn tác có hạn, và hết hạn thì xoá sổ

Đề xuất: nút biến mất khi lượt mới bắt đầu, hoặc sau một khoảng ngắn — peer chọn số và **nói ra
vì sao chọn số đó**. Ràng buộc thật không phải con số mà là: **sổ hết hạn phải bị xoá khỏi
storage**, không phải chỉ ẩn nút. Một danh sách id còn nằm đó mà giao diện không hiện là đúng
hình dạng ca hỏng câm.

### 3. Hằng số ngoại sinh là DỮ LIỆU

```js
deleteSources: {
  rpcId: 'tGMBJ',
  sourcePath: '/notebook/{notebookId}',
  /** [[[id],…],[2]] — hai call site của một oracle; oracle kia chỉ xác nhận TÊN id. */
  wrap: 2,
  tail: [2],
},
```

Không ghim `tGMBJ` hay `[2]` vào thân hàm.

### 4. Xác nhận trước khi chạy, và câu xác nhận phải có SỐ

Bản audit `.impeccable/critique/2026-08-24…` đã xếp *"`Xoá hết` phá huỷ mà không hỏi lại"* là P2
của popup. Đừng lặp lại lỗi đó ở một nút nguy hiểm hơn hẳn. Câu hỏi phải nói **bao nhiêu nguồn**
và **notebook nào** — không phải "Bạn có chắc không?".

### 5. Hỏng thì hỏng về phía KHÔNG LÀM GÌ

Không có sổ, sổ hết hạn, `notebookId` trong sổ không khớp, frame trả về không đọc được, không có
tab NotebookLM → **không gửi request nào**, không báo lỗi đỏ. Cùng ràng buộc "chỉ nâng cấp, không
hạ cấp" của 009, nhưng ở đây chiều an toàn ngược lại: **không chắc thì không xoá.**

## Điều kiện đảo ngược

Gỡ tính năng khi bất kỳ điều nào đúng:

1. Một lượt hoàn tác chạy xong mà **số Nguồn trong notebook không giảm đúng số id đã gửi** →
   hình dạng `[[[id],…],[2]]` hết đúng, hoặc server im lặng bỏ qua. Im lặng không giảm còn tệ hơn
   báo lỗi, vì owner tin là đã sạch.
2. `sourceId` từ 009 tỏ ra **không ổn định** giữa lúc thêm và lúc xoá.
3. Có **bất kỳ** báo cáo nào về việc xoá trúng một nguồn không do lượt chạy tạo ra. Không cần
   điều tra thêm — gỡ trước, điều tra sau.

Gỡ = xoá `deleteSources` khỏi `BASE`, xoá sổ, ẩn nút. Không mục nào của hàng đợi phụ thuộc vào
nó; `README.md` không hứa gì về nó cho tới khi nó chạy thật. **Một commit.**

## Ràng buộc

1. Không thêm permission nào. Nếu peer thấy cần → **dừng và hỏi** (`Authority`: Human must decide).
2. Không lưu `at`, không dựng `rpcContext`. Ràng buộc từ ticket 011, vẫn nguyên.
3. **Mọi thử nghiệm chạy trên notebook nháp.** `Authority` xếp *"chạy thử nghiệm ghi lên notebook
   không phải notebook nháp"* vào **Human must decide** — và một thử nghiệm xoá thì đọc câu đó
   theo nghĩa chặt nhất.
4. Không dựng "xem danh sách nguồn của notebook". Đó là ticket khác và có thể là ticket không nên
   tồn tại.
5. Không đụng định nghĩa `done` của `README.md`. Hoàn tác nằm **sau** khi một lượt đã kết thúc;
   nó không tham gia vào việc quyết định "Xong".

## Kiểm chứng

`bash test/run.sh` xanh. Baseline đo trên cây sạch ở `d250edb`, 2026-09-03:
**1352 pass / 0 fail / 24 file**, exit 0 — nhưng **đo lại chứ đừng chép**.

## Ở acceptance sẽ hỏi

Mỗi câu nói rõ **chiều nào phải đỏ**.

1. **Đảo `notebookId` và `sourceId`** ở chỗ dựng request. Chiều phải đỏ: **bản hoán vị**. Đúng
   hình dạng *đường dữ liệu song song*: hai chuỗi cùng kiểu, cùng đi ra từ một bản ghi trong sổ.
   Đảo chúng thì request vẫn đúng cú pháp, vẫn gửi đi, vẫn có frame trả về. Assert phải ghim
   **giá trị nào vào `source-path`, giá trị nào vào `f.req`**, với fixture mà hai id khác nhau rõ
   rệt — id giống nhau thì xanh cả hai chiều.

2. **Cho đường hoàn tác lấy id từ chỗ khác sổ** (ví dụ từ danh sách nguồn đọc được, hoặc từ mục
   hàng đợi). Chiều phải đỏ: **bản hoán vị**. Đây là ca hỏng nặng nhất của cả ticket — nó là
   đường thẳng tới việc xoá nguồn owner tự thêm. Assert phải ghim: **sổ rỗng ⇒ không một request
   nào rời đi**. Ghim "không xoá nhầm" bằng cách đếm kết quả là không đủ; phải đếm **cú gửi**,
   theo đúng bài học `hoan-vi-nut-can-ghi-lai-cu-bam`.

3. **Bỏ điều kiện khớp notebook**: hoàn tác một lượt đã ghi vào notebook A trong khi
   `settings.notebookUrl` đang trỏ notebook B. Chiều phải đỏ: **bản hoán vị**. Assert phải ghim
   `source-path` lấy từ **sổ**, không từ settings hiện tại. Đây là ca mà owner đổi notebook đích
   giữa hai lượt — không hiếm, và hỏng thì xoá vào notebook không liên quan.

4. **Bấm hoàn tác hai lần.** Chiều phải đỏ: **bản hoán vị** (lần hai vẫn gửi). Assert: lần hai
   gửi **0 request**. Sổ phải bị xoá **sau khi gửi**, không phải sau khi có phản hồi — vì phản
   hồi có thể không bao giờ tới.

5. **Đổi `wrap`/`tail` sang một hình dạng khác** (`[[id],[2]]`). Chiều phải đỏ: **KHÔNG chiều
   nào** — và đó là kết quả đúng, phải nói ra chứ không được bịt. Hình dạng này là **giả thuyết
   ngoại sinh của ta**; một test ghim nó là ta tự chứng nhận thứ ta tự bịa, đúng cái bẫy
   `test-ghim-hang-so-chep-tay`. Cơ chế phát hiện lúc chạy là **điều kiện đảo ngược số 1** (số
   Nguồn không giảm đúng số id đã gửi), không phải một assertion.

Câu nào trả lời là "không test nào" vẫn là kết quả hợp lệ — **nhưng phải nói ra**.
