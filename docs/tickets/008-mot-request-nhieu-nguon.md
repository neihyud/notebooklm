# 008 — `izAoDd` nhận nhiều nguồn một lượt, và giả định một-nguồn-một-lượt đã hết đúng

- status: draft — **chưa giao**
- class: **architecture lock-in** → `WORKSPACE_PROTOCOL.md` xếp *"hướng RPC batchexecute"* vào
  hạng này, nên phải *so sánh alternatives + ghi rõ điều kiện đảo ngược trước khi viết code*.
  Cộng thêm **cross-module** nếu chọn đường (B) bên dưới: nó chạm
  `src/background/service-worker.js`.
- tách từ: `docs/notebooklm-rpc-do-duoc-2.md` → mục *"Thứ đáng lấy mà không phải hằng số"*.
  Commit `cd1ae7d` **không** làm gì cho batch; nó chỉ phát hiện ra đường này lúc đọc oracle.
- blocked-by: **một lượt `tools/probe-notebooklm.mjs` của owner.** Hình dạng batch CHƯA chốt —
  hai oracle mâu thuẫn ở đúng ô chứa url. Xem "Bước 1"; đừng bắt đầu từ hàng đợi.
- không đụng: `automation.js`, `selectors.js`, `manifest.json`, `README.md`.

## Bối cảnh

`docs/adr/0001-duong-trao-tay.md` và mục *Đường trao tay* trong `README.md` đứng trên một giả
định: **thêm một Nguồn tốn một lượt hộp thoại**. Cái giá ghi thẳng trong README —
*"tốn một lượt hộp thoại cho **mỗi** link"* — là lý do Đường trao tay tồn tại.

Giả định đó chỉ đúng với **đường DOM**. Trên đường RPC nó sai: cả hai extension đã giải nén đều
có đường gửi **N nguồn trong một request `izAoDd`**.

Điều này **không** làm Đường trao tay thành thừa. Nó vẫn có lý do đứng vững nhất: nó không hỏng
khi Google đổi giao diện, còn RPC thì có. Cái đổi là **bảng cân nhắc** — một trong hai cột của
nó không còn số như cũ.

## Bằng chứng, và chỗ nó KHÔNG đủ

Cả hai oracle đặt danh sách spec vào **ô 0, bọc ĐƠN** — `[spec, spec, …]`, đúng chỗ mà
`argsShape` hiện khai `{ dat: 'sources', boc: 1 }`. Nghĩa là `bocLai(...)` không phải sửa; chỉ
`buildSpec` cần trả về nhiều spec.

Chỗ chúng **mâu thuẫn** là ô chứa url *bên trong mỗi spec*:

| oracle | hàm | ô url trong spec batch |
|---|---|---|
| A — Youtube Summary 1.5.4 | `addUrlsToSource` | **2** |
| B — Sourclip 1.8.0 | đường batch url | **7** |

Đây đúng là ô mà `cd1ae7d` vừa đổi cho nguồn **đơn** (2 → 7, hai oracle đồng ý). Với batch thì
chúng **không** đồng ý, và ta không có phiếu thứ ba.

Một cách đọc hợp lý — chưa có gì đỡ: ô 2 là "url để server tự fetch" còn ô 7 là "nguồn URL", và
đường batch của oracle A dùng loại khác. Nhưng đó là **suy đoán về ngữ nghĩa một ô số**, đúng
loại việc mà `rpc.js` cả file này cố tránh. Đừng viết code dựa vào nó.

## Vì sao KHÔNG bắt đầu bằng việc sửa hàng đợi

Ba thứ hỏng cùng lúc nếu batch được bật, và cả ba đều đắt hơn phần dựng payload:

1. **`unknown` nhân lên N.** `OUTCOME.UNKNOWN` hiện nghĩa là *"một Nguồn, không biết đã ghi hay
   chưa, owner mở notebook kiểm bằng mắt"*. Batch biến nó thành *"tám mươi chín Nguồn, không
   biết cái nào đã vào"*. Thêm Nguồn không idempotent, nên không có đường chạy lại an toàn.
   Đây là chi phí lớn nhất của ticket này và nó **không** giảm được bằng code cẩn thận hơn.
2. **Đường DOM không batch được.** `route()` rơi xuống `runDom()` cho **một** spec. Một lượt
   batch trượt xuống DOM phải tự tháo ra thành N lượt — tức seam giữa hai đường không còn là
   một hàm bọc nữa.
3. **Định nghĩa `done` vỡ.** *"Xong nghĩa là đã kiểm chứng"* (`README.md`) đếm số Nguồn trước và
   sau, **tăng đúng 1**. Với batch thì phải tăng đúng N, và mỗi mục trong hàng đợi cần biết
   *nó* có vào hay không — chứ không phải cả mẻ có vào hay không. Chỗ này phụ thuộc
   `docs/tickets/009-xac-minh-bang-sourceid.md`; làm 008 trước 009 là làm ngược.

Ghi thêm cho rõ: đổi định nghĩa `done` nằm trong mục **Đề xuất bổ sung — CHƯA DUYỆT** của
`WORKSPACE_PROTOCOL.md`, nên hiện Lead không bị ràng buộc phải hỏi. Nhưng đây đúng là ca mà mục
đó được viết ra để canh — **hỏi owner trước**, đừng lấy chuyện "chưa binding" làm lý do không hỏi.

## Kết quả cần có

### Bước 1 — đo, không phải viết. Đây là toàn bộ phạm vi được giao lần này.

Mở rộng `tools/probe-notebooklm.mjs` để một lượt chạy của owner trên **notebook nháp** trả lời
đúng ba câu, theo thứ tự:

1. Gửi hai spec URL trong một `izAoDd`, ô url ở **7** → notebook có thêm **2** Nguồn không?
2. Nếu không: cùng payload đó với ô url ở **2** → có thêm 2 Nguồn không?
3. Phản hồi trả về mấy id, và ở vị trí nào? (Câu này là đầu vào cho ticket 009.)

Một lượt chạy trả lời cả ba. Chưa có câu trả lời thì **không** viết dòng code batch nào.

> `WORKSPACE_PROTOCOL.md` → *external side effects*: mọi thử nghiệm RPC nhắm notebook nháp, và
> **lượt import hàng loạt lên tài khoản owner như một bước "kiểm chứng" là `prohibited`**. Hai
> nguồn trong một request là phép đo tối thiểu, không phải lượt hàng loạt. Đừng nâng lên 20 để
> "chắc ăn hơn".

### Bước 2 — chỉ mở khi Bước 1 xong. Ba đường, cân sẵn:

- **(A) Batch trong `rpc.js`, hàng đợi không đổi.** Bỏ. `rpc.js` bọc `addUrlSource` /
  `addTextSource` — nó nhìn thấy **một** spec và không có cách nào biết mục kế tiếp trong hàng
  đợi là gì. Gom ở đây nghĩa là dựng một bộ đệm có timeout bên trong một file đang cố giữ mình
  không có trạng thái. Sai chỗ đặt seam.
- **(B) Batch ở `runQueue`, `rpc.js` nhận một mảng spec.** ← **nhiều khả năng là đường đúng.**
  `runQueue` đã biết cả hàng đợi, đã biết notebook đích, đã đếm `done`/`failed`. Nó gom các mục
  **cùng notebook, cùng loại, liền kề** thành một lượt; `rpc.js` đổi từ `spec` sang `specs[]`
  và trả về **mảng kết quả cùng độ dài**, không phải một kết quả chung. Cái giá: chạm
  `service-worker.js` → cross-module → cần review seat độc lập.
- **(C) Chỉ cập nhật ADR, không viết code.** Đường lùi hợp lệ nếu Bước 1 cho thấy hình dạng
  batch không chạy, hoặc nếu owner thấy rủi ro `unknown`-nhân-N không đáng đổi lấy tốc độ.
  **Chọn (C) không phải là thất bại của ticket** — nó là một trong ba kết cục được trả tiền.

Peer **không** được chọn giữa (B) và (C) một mình: đó là đánh đổi giữa tốc độ và một chế độ hỏng
mà chỉ owner gánh. Trình số đo của Bước 1 rồi hỏi.

## Ràng buộc

1. Không thêm permission nào vào `manifest.json`.
2. Không bật batch mặc định. Nếu (B) được chọn, nó nằm sau một công tắc riêng trong Cài đặt,
   **tắt sẵn** — y như `rpcEnabled`.
3. Không ghim ô url của batch thành hằng số trong code. Nó vào `BASE`/`rpcOverrides` như mọi
   giả thuyết ngoại sinh khác, và mặc định của nó phải là **thứ Bước 1 đo được**, không phải
   thứ oracle nào nói.
4. Không sửa `docs/adr/0001-duong-trao-tay.md` trước Bước 1. ADR ghi lại quyết định đã có bằng
   chứng; sửa nó bằng một suy đoán là làm hỏng đúng thứ nó dùng để làm.
5. Không đụng đường DOM. Nó là fallback duy nhất và `Authority` xếp việc gỡ nó vào
   **Human must decide**.

## Kiểm chứng

`bash test/run.sh` xanh. Baseline đo trên cây sạch lúc nhận ticket kèm sha — con số ở
`cd1ae7d` là **1351 pass / 0 fail / 24 file**, nhưng **đo lại chứ đừng chép**.

Bước 1 không đổi code chạy trong extension, nên nó không làm số này đổi. Bước 2 thì có.

## Ở acceptance sẽ hỏi

Chỉ áp cho Bước 2. Mỗi câu nói rõ **chiều nào phải đỏ**.

1. **Đảo thứ tự mảng kết quả trả về so với mảng spec gửi đi** (`results[i]` ứng với
   `specs[n-1-i]`). Chiều phải đỏ: **bản hoán vị**. Đây là đường dữ liệu song song điển hình —
   `{ok, error}` của từng mục vẫn đúng hình dạng, cả mẻ vẫn "xong", chỉ có **mục nào gắn lý do
   hỏng nào** là sai. Assert phải ghim *mục thứ i mang đúng url thứ i*, với một mẻ mà các mục
   **khác nhau về nội dung** — hai mục cùng hình dạng thì đảo thứ tự xanh cả hai chiều.
2. **Gom hai mục khác notebook vào một lượt.** Chiều phải đỏ: **bản hoán vị**. Phải có một ca
   mà `runQueue` cầm hai mục thuộc hai notebook và assert chúng đi ra thành **hai** request.
   Một Nguồn vào nhầm notebook là hỏng câm — nó vẫn "Xong".
3. **Một mẻ trả `unknown`.** Chiều phải đỏ: **bản hoán vị** xếp nó thành `not-sent`. Assert
   **không mục nào** trong mẻ được chạy tiếp bằng đường DOM. Đây là chỗ `unknown`-nhân-N biến
   thành N Nguồn trùng, và nó là lý do chính khiến ticket này chậm.

Câu nào trả lời là "không test nào" vẫn là kết quả hợp lệ — **nhưng phải nói ra**.
