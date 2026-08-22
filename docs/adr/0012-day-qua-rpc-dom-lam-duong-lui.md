---
status: accepted
---

# Đẩy nguồn qua RPC `izAoDd`, giữ đường DOM làm đường lui

Owner duyệt 2026-08-22, sau một lượt điều tra read-only (agent `8f04c46b`) đọc mã nguồn công
khai của hai thư viện reverse-engineer độc lập. ADR này **không đảo** ADR nào; nó thêm một đường
và hạ đường cũ xuống hàng thứ hai.

## Vì sao đổi

NotebookLM bản consumer không có API tự phục vụ, nên tới ticket 004 cách duy nhất là tự động hoá
DOM trong một tab. Điều tra cho thấy tiền đề ấy đúng ở vế "không có API công khai" nhưng sai ở vế
"chỉ còn cách DOM": bên dưới giao diện là `batchexecute`, gọi được bằng cookie mà Chrome đã giữ
sẵn cho owner.

Lý do quyết định **không** phải là tốc độ hay việc bỏ được tab. Là **tín hiệu xong việc**:

- Đường DOM: `automation.js` chờ `settleMs: 1200`, quét snackbar, và tự thừa nhận trong comment
  rằng hộp thoại đóng chưa chắc là xong. Không có gì trên màn hình nói chắc chắn nguồn đã vào.
- Đường RPC: một lượt `add_text` thành công trả về **source id + title + status `READY` ngay
  trong response, đồng bộ**. Một lượt thất bại trả **mã gRPC có tên ở vị trí cố định**.

Rủi ro số một của repo này (`WORKSPACE_PROTOCOL.md`) là *mất dữ liệu âm thầm qua Nguồn gộp*. Một
đường đẩy tự xác nhận đánh thẳng vào đó; một đường đẩy phải đoán thì không.

## Quyết định

**RPC là đường chính. DOM là đường lui, giữ nguyên, không xoá.**

Hai đường hỏng theo hai cách khác nhau, và đó chính là lý do giữ cả hai:

| | Hỏng vì | Triệu chứng |
|---|---|---|
| DOM | selector đổi | `findByLabel` trả `null` → ném ngay, biết sai chỗ nào |
| RPC | **hình dạng payload** trôi | request đi lọt, HTTP 200, một mã gRPC chung chung |

Đo được: RPC id `izAoDd` **không bị Google xoay lần nào trong 7,5 tháng** (quét 76 commit chạm
bảng RPC của `notebooklm-py`), và máy dò xoay id của họ kêu 10 lần thì cả 10 là báo động giả.
Thứ thật sự làm hỏng là shape payload — hai lần trong tháng 6/2026, **rollout theo cohort**, nên
tài khoản đã migrate và chưa migrate cùng tồn tại và nhận shape khác nhau. Hai reverse-engineer
độc lập tới hôm nay vẫn bất đồng về shape trong khi thống nhất tuyệt đối về id.

Cohort là lý do đường lui không phải thứ trang trí: khi shape trôi, nó trôi cho *một phần* người
dùng, vào một thời điểm không ai báo trước.

## Năm ràng buộc, vi phạm cái nào thì ADR này thành lỗ hổng

1. **Reader lỗi viết TRƯỚC đường gửi, không phải sau.** Lỗi nghiệp vụ của `batchexecute` đến
   **kèm HTTP 200**; một `if (!res.ok) throw` nuốt sạch cả lớp lỗi ấy. Đường DOM không cho phép
   sai lầm đó — không thấy selector là ném ngay. Đường RPC thì cho phép, nên phải chặn bằng test.

2. **Một request một nguồn. Cấm gộp nhiều entry.** `ADD_SOURCE` nhiều entry **âm thầm bỏ qua các
   hàng thất bại** trừ khi mọi entry đều fail. Đúng loại rủi ro `packSources()` mà ADR 0008 dựng
   bảng tổng kết để chặn — gộp ở đây là mở lại cửa ấy ở tầng thấp hơn, nơi bảng tổng kết không
   nhìn thấy.

3. **Chỉ đi đường text.** Điều tra cho thấy đường URL bẩn: mọi nguyên nhân (domain chết, 404,
   403, 500) đổ về **một mã `9` duy nhất** — không phân biệt được "chết hẳn" với "5xx tạm thời" —
   và **luôn để lại ghost row ăn quota**, phải vào NotebookLM xoá tay. Với quota 50 nguồn/notebook
   thì đó là chi phí thật. Đường text là ca duy nhất trong bảng probe từ chối *sạch*: mã lỗi rõ,
   không để lại rác.

4. **Nguồn quá lớn phải rơi về đường DOM, không phải cố gửi.** Service worker MV3 bị Chrome chấm
   dứt khi một response `fetch()` mất hơn **30 giây**, hoặc một request xử lý quá **5 phút**
   ([Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
   Mất SW *giữa chừng một lượt ghi đã gửi đi* là đúng trạng thái "không biết nguồn đã vào hay
   chưa" mà cả repo này dựng lên để tránh. Tab nền **không** có trần này — đó là ưu thế duy nhất
   còn lại của đường cũ, và nó có thật.

   Giới hạn kích thước request thì **chưa ai đo được**: không có ở phía client, không có trong tài
   liệu, capture lớn nhất tìm được là 374 byte. "Không thấy ai chặn" không phải "đã đo thấy chạy".

5. **`AUTH_OPS` không đụng tới.** Đường `batchexecute` không cần `Authorization: SAPISIDHASH`,
   không cần `Origin`, không cần `Referer`. Nó cần cookie (Chrome tự gắn) cộng hai giá trị
   `SNlM0e` (CSRF) và `FdrFJe` (session id) parse từ HTML trang chủ. ADR 0003 và ranh giới auth ở
   `src/youtube/bridge-protocol.js` giữ nguyên, không liên quan.

## Điều chưa biết, ghi thẳng thay vì lấp

- **Google có từ chối `Origin: chrome-extension://<id>` không.** Client Python không gửi `Origin`
  gì cả và được 200; "không gửi" khác "gửi giá trị lạ". Không có bằng chứng chiều nào. Nếu bị từ
  chối, việc gỡ header bằng `declarativeNetRequest` là **chưa xác minh**, không phải đã loại trừ.
- **Một cohort tài khoản có thể không dùng `izAoDd` được nữa** (issue #1550, đóng "completed" sau
  2 ngày, không comment, không code). Người điều tra nghiêng về giả thuyết quy nhầm nhưng nói rõ
  chưa ai chứng minh được chiều nào.
- **Thời gian sống của `SNlM0e`.** Chỉ biết hành vi khi hết hạn (HTTP 400 → lấy token mới, retry
  một lần), không có TTL.
- **Nguồn 500.000 từ có đi lọt một request không.** Xem ràng buộc 4.

## Hệ quả

- Ticket 003 và 004 **không bị vứt**. Chúng thành đường lui, và mọi test của chúng vẫn có giá trị.
- Ticket 015 dựng đường RPC. Ticket 014 sửa `host_permissions` — việc đó độc lập với ADR này.
- Lần đầu extension gửi một request ghi thật vào notebook của owner vẫn cần owner cho phép riêng
  (`WORKSPACE_PROTOCOL.md`, mục `prohibited without explicit authority`). ADR này không cấp quyền
  đó.

---

## Đính chính — 2026-08-22, Lead

ADR này viết ở dòng 39: *"RPC id `izAoDd` **không bị Google xoay lần nào trong 7,5 tháng**"*, và
dùng câu ấy để chống đỡ lựa chọn đi đường RPC. **Câu ấy không còn đúng như đã viết.**

Changelog `jacob-bd/notebooklm-mcp-cli` **v0.5.16, 2026-04-04**:

> "Fixed `source_add` (URL type) failing with `RPC error code 3 (INVALID_ARGUMENT)` for some users
> due to Google migrating the `add_source` endpoint. Implemented a dual-RPC fallback: the system
> tries the legacy `izAoDd` endpoint first, and if it returns code 3, automatically retries with
> the new `ozz5Z` endpoint."

Ba điều cần tách bạch, vì chúng không cùng mức chắc chắn:

1. **Có một id thứ hai, `ozz5Z`.** Đây là dữ kiện, có ngày tháng và số hiệu bản phát hành.
2. **Bằng chứng công khai chỉ nói về loại URL.** Ta không đi đường URL (ràng buộc 3 của chính ADR
   này), nên **chưa kết luận được** đường text có cần `ozz5Z` không. Đây vẫn là điều chưa biết,
   không phải một lỗ đã đo.
3. **Cụm *"for some users"* nghĩa là rollout theo cohort** — đúng cơ chế mà ADR này đã mô tả cho
   *shape*, giờ thấy áp cả cho *id*.

**Quyết định của ADR không đổi**, và lý do đổi hướng suy nghĩ chứ không đổi kết luận: id thứ hai
xuất hiện kèm mã `INVALID_ARGUMENT`, tức nó rơi vào đúng hạng mà bộ đọc đang **hỏng đóng** và
`canFallBackToDom` cho rơi về đường DOM. Cohort nào cần `ozz5Z` thì hôm nay chạy đường lui, không
mất dữ liệu. Đó chính là điều khoản "giữ cả hai đường" của ADR này đang làm việc.

**Không thêm `ozz5Z` vào code** cho tới khi có bằng chứng cho đường text: thêm một id chưa đo vào
đường ghi là mở đúng cái biến ADR này dựng lên để đóng. Ticket 020 ghi cùng ranh giới ấy.

Đính chính này **không đảo** quyết định nào; nó sửa một tiền đề bị phát biểu chắc hơn bằng chứng.
Việc đảo quyết định của một ADR `accepted` vẫn là quyền của owner (`WORKSPACE_PROTOCOL.md`).
