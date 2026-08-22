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
