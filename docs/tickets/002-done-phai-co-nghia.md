# 002 — `done` phải có nghĩa là "đã vào", không phải "hộp thoại đã đóng"

- status: **DONE** — nghiệm thu 2026-08-23. 441 pass/0 fail/11 file (vào: 339/9).
  Lead tự hoán vị `MSG.NLM_ADD_URL`↔`MSG.NLM_ADD_TEXT` ở router: lúc đầu HỞ (418 xanh), đã bịt, giờ 6 đỏ.
  Phát sinh ngoài ticket: `importDoc` trước đó không có test nào chạy qua — nay đã có.
- class: cross-module → xem `WORKSPACE_PROTOCOL.md`
- blocking edges: không. Đứng độc lập với 001 và 003.

## Vấn đề

Hai đường ghi của extension đều báo thành công dựa trên một tín hiệu **không phải** kết quả:

1. **Import.** `awaitDialogResolution` (`src/notebooklm/automation.js`) trả `{ok:true}` khi hộp
   thoại đóng và không thấy snackbar lỗi. Đã đo 2026-08-23: dán nội dung vào ô Khám phá nguồn
   rồi bấm nhầm nút → hộp thoại đóng → `{ok:true}` → item `done`. Không có bước nào đối chiếu
   số **Nguồn** thật sự tăng. `S.css.sourceList` (`src/notebooklm/selectors.js`) được khai báo
   nhưng `grep` toàn `src/` không có chỗ dùng — selector chết, chưa bao giờ chạy trên DOM thật.
2. **Tải về đĩa.** `downloadItem` (`src/background/service-worker.js`) chỉ
   `await chrome.downloads.download(...)`. Lời gọi đó resolve khi Chrome **nhận yêu cầu**, không
   phải khi file ghi xong. Không có listener `chrome.downloads.onChanged` ở đâu trong `src/`.
   Download bị `interrupted` (đĩa đầy, blob URL đã revoke — TTL 120s ở `offscreen.js`) vẫn `done`.

Hai chỗ, một khuyết tật: đo cái *cửa*, không đo cái *kết quả*.

## Kết quả cần có

**Import** — đếm Nguồn trước khi mở hộp thoại, đếm lại sau khi hộp thoại đóng. Tăng đúng 1 → `ok`.

**QUAN TRỌNG — chưa có DOM danh sách Nguồn.** Không được đoán rồi đặt selector chưa kiểm chứng
lên đường đi chính. Thiết kế phải phân biệt được BA kết cục, không phải hai:

| Đếm được? | Tăng đúng 1? | Kết quả |
|---|---|---|
| có | có | `ok`, đã xác minh |
| có | không | `error` — kèm số trước/sau và ảnh chụp hộp thoại |
| **không tìm thấy danh sách** | — | `ok` nhưng **`verified: false`**, và popup phải hiện rõ "chưa xác minh được" |

Hàng thứ ba là chỗ mấu chốt: selector của tôi có thể sai, và khi nó sai thì phải **nói ra**, không
được im lặng ngả về hành vi cũ. Đây là hành vi mới đắt nhất của ticket — đừng bỏ.

**Tải về đĩa** — chờ `chrome.downloads.onChanged` báo `state: 'complete'` mới `ok`;
`'interrupted'` → `error` kèm `error` reason của Chrome. Có chặn giờ riêng, ngắn hơn
`ITEM_TIMEOUT_MS` để không bị vòng lặp ngoài cắt ngang trước.

## Ràng buộc

- KHÔNG commit, KHÔNG push.
- Mốc xanh: `bash test/run.sh` → **339 pass, 0 fail**, 9 file. Không được giảm.
- Test mới phải ĐỎ khi gỡ bản vá — chạy trên code chưa vá và dán output đỏ vào handback.
  Test chỉ assert nội dung mảng selector là VÔ GIÁ TRỊ (xem `WORKSPACE_PROTOCOL.md`,
  mục anti-patterns). `test/dom-harness.js` đã có sẵn để nạp code thật vào DOM thật.
- `verified: false` phải nhìn thấy được trong popup, không chỉ nằm trong storage.
