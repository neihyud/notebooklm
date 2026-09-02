# 009 — Đường RPC có thể tự xác minh, và đang không dùng thứ server đã trả về

- status: draft — **chưa giao**
- class: **tiny / bounded** — 1 peer seat, `bash test/run.sh`. Chỉ chạm `src/notebooklm/rpc.js`
  và `test/notebooklm-rpc.test.js`. **Không** cross-module: không chạm `manifest.json`,
  `shared.js`, hay `MSG.*`.
- tách từ: `docs/notebooklm-rpc-do-duoc-2.md` → mục *"Xác minh: phản hồi `izAoDd` trả về
  `sourceId`"*. Commit `cd1ae7d` không làm gì cho việc này.
- blocked-by: **một payload thật.** Xem "Vì sao chưa giao được ngay" — chỗ tắc không phải code.
- liên quan: `docs/tickets/008-mot-request-nhieu-nguon.md` phụ thuộc ticket này, không phải
  ngược lại. Làm 008 trước 009 là làm ngược.

## Bối cảnh

Đường RPC hiện kết thúc bằng một câu nói thật nhưng yếu (`rpc.js`, `UNVERIFIED_RPC`):

> *Backend NotebookLM đã nhận lệnh thêm Nguồn qua RPC (trả dữ liệu cho đúng rpc id đã gửi),
> nhưng đường RPC không đọc danh sách Nguồn nên chưa đối chiếu được số Nguồn trước/sau.*

`readEnvelope()` dừng ở *"có payload parse được"*, rồi `addedResult()` trả `verified: false`.
Nghĩa là đường RPC — đường **nhanh hơn** — lại cho ra một kết luận **yếu hơn** đường DOM, vốn
đếm lại số Nguồn và dám nói "Xong".

Nhưng server đã nói rồi. Oracle B moi `sourceId` của Nguồn vừa tạo ra khỏi chính cái payload mà
`readEnvelope()` đang vứt đi, và dùng nó thật (để xoá bản cũ khi sửa một nguồn). Một id do
server cấp là **bằng chứng mạnh hơn** một phép đếm trước/sau: nó không nhầm khi có lượt import
khác chạy song song, và không cần đọc DOM.

## Bằng chứng, và chỗ nó mỏng

**Chỉ MỘT oracle.** Đã kiểm oracle A (Youtube Summary 1.5.4): hàm `do()` của nó parse phản hồi
**generic** — lấy mảng JSON đầu tiên parse được ở bất kỳ dòng nào, **không** kiểm rpc id, và
**không** moi `sourceId` cho đường thêm nguồn. Nó không cho phiếu nào ở đây.

Oracle B đọc ở hai chỗ, và hai chỗ đó **không cùng hình dạng**:

- đường nguồn đơn: `sourceId` ở `payload[0][0][0][0]` — bốn lớp mảng;
- đường batch: duyệt `payload[0]`, mỗi phần tử `e` thì lấy `e[0][0]` **nếu** `e[0]` là mảng,
  **ngược lại** lấy `e[0]` nếu nó là chuỗi.

Bộ parse thứ hai **khoan dung có chủ ý** — nó chấp nhận cả hai hình dạng. Đọc được: chính tác
giả oracle B cũng không chắc payload có mấy lớp.

## Vì sao chưa giao được ngay — và đây mới là phần đáng đọc

`test/notebooklm-rpc.test.js` có sẵn một payload thành công:

```js
const OK_PAYLOAD = [['nguon-moi-1234'], 3];
```

Nó **bịa**. Chính file test khai điều đó ở đầu file (*"test này KHÔNG chứng nhận rằng backend
NotebookLM chấp nhận payload"*), và nó đúng là bịa: đem `OK_PAYLOAD` cho **cả hai** bộ parse của
oracle B thì **không bộ nào** moi ra id. `payload[0][0]` là chuỗi `'nguon-moi-1234'`, không phải
mảng, nên bộ parse đơn trượt ở lớp thứ ba và bộ parse batch `continue` ngay vòng đầu.

Viết code moi `sourceId` rồi ghim nó bằng `OK_PAYLOAD` là dựng một cơ chế xác minh trên một
fixture **do chính ta bịa ra**, rồi để test chứng nhận rằng ta đọc đúng thứ ta vừa bịa. Đó đúng
là hình dạng mà `WORKSPACE_PROTOCOL.md` → *Project-specific anti-patterns* xếp vào
**trả lại handback**, và là bài học đã ghi trong repo: một test ghim hằng số chép tay xanh vĩnh
viễn kể cả sau khi đã sai.

**Chỗ tắc là một payload thật, không phải mấy dòng code.** `tools/probe-notebooklm.mjs` chạy một
lượt trên notebook nháp là đủ — cùng lượt đó trả lời luôn câu 3 của ticket 008.

## Kết quả cần có

### 1. Vị trí `sourceId` là DỮ LIỆU, không phải cấu trúc cứng

Thêm vào `BASE` một mô tả đường đi tới id, ghi đè được từ `rpcOverrides` như mọi giả thuyết
ngoại sinh khác trong file. Hình dạng đề xuất — peer được quyền đề xuất khác, nhưng phải nói rõ
nó chịu được mấy biến thể:

```js
/** Đường tới sourceId trong payload. MẢNG vì hai hình dạng đã quan sát được. */
sourceIdPaths: [[0, 0, 0, 0], [0, 0, 0]],
```

Thử lần lượt, lấy **chuỗi không rỗng đầu tiên** tìm được.

### 2. Chỉ NÂNG CẤP khi tìm thấy, tuyệt đối không hạ cấp khi không

Đây là ràng buộc quan trọng nhất của ticket, và nó là thứ khiến ticket này an toàn trong khi
`argsShape` thì không:

- tìm thấy id → `verified: true`, `unverified: null`, kèm `sourceId` để bản chụp ghi lại;
- **không** tìm thấy → hành vi **y hệt hôm nay**: `verified: false` kèm nguyên câu
  `UNVERIFIED_RPC`. Không lỗi, không cảnh báo, không đổi `outcome`.

Nghĩa là hình dạng payload đoán sai **không sinh ra chế độ hỏng mới nào** — nó chỉ làm ta mất
một cơ hội nói "Xong". Khác hẳn `argsShape`: sai hình dạng ở đó cho frame rỗng → `unknown` →
dừng cả lượt. Cơ chế phát hiện lúc chạy ở đây chính là *không tìm thấy thì không dám nói*, và
đó là câu trả lời cho mục *anti-patterns* — không phải một assertion.

### 3. Không đổi `outcome`, không đổi `readEnvelope`'s status

`status: 'ok'` đang có nghĩa hẹp và đúng: *server trả frame mang đúng rpc id ta gửi*. `sourceId`
là một **lớp thông tin thêm** đọc từ cùng payload đó, không phải một điều kiện mới để vào
`'ok'`. Trộn hai thứ vào nhau là thu hẹp `'ok'` một cách âm thầm: payload có id ở chỗ khác sẽ
rơi khỏi `ADDED` xuống `UNKNOWN`, và `UNKNOWN` **dừng cả lượt**. Đó là cách biến một cải tiến
thành một ca hỏng nặng hơn hiện trạng.

## Thứ tự

1. **Owner chạy `tools/probe-notebooklm.mjs`** trên notebook nháp, ghi lại payload thật của một
   lượt `izAoDd` thành công. Không có bước này thì đừng bắt đầu bước 2.
2. **Thay `OK_PAYLOAD` bằng payload đã ghi**, và chạy `bash test/run.sh` **trước khi** viết code
   moi id. Nếu suite đỏ ở đâu đó thì chỗ đó là một assertion đang ghim hình dạng bịa — sửa nó
   trước, riêng ra, và nói tên nó.
3. Mới tới `sourceIdPaths` + mục 2 ở trên.

Bước 2 đứng độc lập được và đáng làm kể cả nếu ticket dừng ở đó: nó thay một fixture bịa bằng
một quan sát, và đó là thứ mọi assertion trong file test ấy đang dựa lên.

## Ràng buộc

1. Không thêm permission nào vào `manifest.json`.
2. Không để `sourceId` đi vào bản chụp mà không hỏi: nó là **id của một Nguồn trong notebook
   owner**, không phải bí mật như token `at`, nhưng cũng không phải hằng số ngoại sinh như
   `rpcId`. Ghi vào `saveDomReport` thì ghi có chủ ý và nói ra trong handback.
3. Không đụng `automation.js`. Định nghĩa `done` của đường DOM không đổi trong ticket này.
4. Không sửa câu `UNVERIFIED_RPC`. Nó vẫn là câu dùng cho ca không tìm thấy id.

## Kiểm chứng

`bash test/run.sh` xanh. Baseline đo trên cây sạch lúc nhận ticket kèm sha — ở `cd1ae7d` là
**1351 pass / 0 fail / 24 file**, nhưng **đo lại chứ đừng chép**.

## Ở acceptance sẽ hỏi

Mỗi câu nói rõ **chiều nào phải đỏ**.

1. **Đảo `verified` và `sourceAdded`** trong `addedResult()`. Chiều phải đỏ: **bản hoán vị**.
   Hai boolean cùng kiểu, cùng đi ra từ một object — đúng hình dạng *đường dữ liệu song song*.
   `sourceAdded` quyết định tầng trên có được thử đường khác không; `verified` chỉ quyết định
   câu chữ. Đảo chúng thì mọi assert kiểu "trả về hai boolean" xanh, mà hệ quả thật là một
   Nguồn trùng. Assert phải ghim **trường nào mang giá trị nào**, và với cả hai ca (tìm thấy id
   / không tìm thấy) — ca "tìm thấy" một mình không đủ, vì ở đó cả hai đều `true`.
2. **Đổi `sourceIdPaths` thành một đường sai.** Chiều phải đỏ: **KHÔNG chiều nào** — và đó là
   kết quả đúng. Đường sai phải cho ra đúng hành vi hôm nay (`verified: false` + câu
   `UNVERIFIED_RPC`), nên phải có một assert khẳng định **chính điều đó**: đường sai không được
   làm lượt chạy hỏng. Nếu bản hoán vị này đỏ thì mục 2 của "Kết quả cần có" đã bị viết sai.
3. **Cho `readEnvelope` trả `status: 'unknown'` khi không tìm thấy id.** Chiều phải đỏ: **bản
   hoán vị**. Đây là ca hỏng nặng nhất của ticket — nó biến một lượt thành công thành một lượt
   dừng hẳn bắt owner mở notebook kiểm bằng mắt. Assert phải ghim rằng payload **không có id**
   vẫn cho `outcome === ADDED`.

Câu nào trả lời là "không test nào" vẫn là kết quả hợp lệ — **nhưng phải nói ra**.
