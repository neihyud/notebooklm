# 003 — Một Lượt chạy duy nhất, chạy được một mạch

- status: **DONE** — nghiệm thu 2026-08-23. 534 pass/0 fail/12 file (vào: 441/11).
  Lead tự hoán vị `done`↔`failed`: lúc đầu HỞ (513 xanh), đã bịt, giờ 6 đỏ.
  Phát sinh: có BA chỗ đếm, chỗ thứ ba trong khối `catch` cũng là cặp xanh giả riêng.
- class: cross-module → xem `WORKSPACE_PROTOCOL.md`
- blocking edges: 002 (cùng đụng `runQueue` và `downloadItem`)

## Quyết định của owner (2026-08-23)

Bỏ hai chế độ chạy độc lập. Còn **một nút "Chạy"**: public → Dán link, private → Dán text.
**Bản sao xuống đĩa** tụt xuống thành tuỳ chọn trong Cài đặt, làm trong cùng Lượt chạy, không
cắt ngang. Nút "Tải transcript" biến mất khỏi popup. Thuật ngữ: xem `CONTEXT.md`.

Lý do không phải thẩm mỹ: đường tải đĩa là thứ **duy nhất** trong cả extension cần người dùng
bấm tay giữa chừng, và nó treo trong vòng lặp, đâm vào `ITEM_TIMEOUT_MS` (`service-worker.js`).

## Ba khuyết tật đi kèm, sửa cùng lượt

1. **Hàng đợi mất dấu khi service worker chết.** `runQueue({downloadOnly:true})` giữ `targets`,
   `cursor`, `index` trong RAM. Chrome ngắt service worker MV3 → alarm `nblm-keepalive` gọi lại
   `runQueue` → `cursor` về 0, `index` về 0 → **tải lại từ mục đầu**, `conflictAction:'uniquify'`
   sinh bản sao ` (1)`. Tiến độ phải nằm trong `chrome.storage`, không nằm trong biến cục bộ.
2. **Transcript bị cắt cụt IM LẶNG.** `loadAllSegments` (`src/youtube/transcript.js`) cuộn tối đa
   40 vòng rồi dừng. `fromPanel` chỉ cần `segments.length > 0` là coi như thành công. Video rất
   dài mất phần đuôi mà không ai biết. Cần: phát hiện lúc chạm trần và **nói ra** — mục đó không
   được lặng lẽ nhận `done`.
3. **Ghi chú sai về quota.** `src/common/shared.js` viết "notebook miễn phí chỉ chứa 50 nguồn".
   Đo thật 2026-08-23 trên hộp thoại: **1/300**. Sửa ghi chú.

## Chưa quyết — đừng tự đổi

`unlistedMode` mặc định đang là `'url-then-transcript'`. Owner mới chốt chính sách cho public và
private, **chưa chốt unlisted**. Giữ nguyên mặc định; nếu thấy nó mâu thuẫn với 001/002 thì
escalate `BLOCKED`, đừng tự chọn.

## Ràng buộc

- KHÔNG commit, KHÔNG push.
- Mốc xanh vào: **441 pass / 0 fail / 11 file**. Không được giảm.
- Test mới phải ĐỎ khi gỡ bản vá.
- Bỏ nút khỏi popup là đổi mặt tiền → `WORKSPACE_PROTOCOL.md` xếp vào "Human must decide".
  Owner đã quyết trong phiên grilling 2026-08-23; ghi lại điều đó vào handback.
