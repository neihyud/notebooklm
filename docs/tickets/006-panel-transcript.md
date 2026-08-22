---
status: done
labels: [ready-for-agent]
blocked_by: [002]
spec: docs/spec/0001-notebooklm-importer.md
---

# 006 — Panel xem, tìm và tải transcript trên trang watch

## Delivers
Nút Transcript mở panel bên phải: tìm kiếm bỏ dấu vẫn khớp, bấm timestamp là video nhảy tới
đúng đoạn, sao chép, tải `.md` / `.srt` / `.vtt`. Chạy được với cả video private.

## Acceptance
- Gõ "nguon" khớp được dòng chứa "nguồn".
- Mọi id do extension tạo mang tiền tố chung; test canh bất biến này, vì một id lạc quy ước
  lọt lưới ngay mà không có triệu chứng.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `f03f6cb` (thân ticket) + `faa0465` (bản vá sau nghiệm thu).

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 366, 12 file.` (T005 kết ở 318; ticket này +48.)

### Hai câu ticket bắt trả lời
- *Gõ "nguon" khớp dòng chứa "nguồn"* — `matchesQuery` bỏ dấu **cả hai vế** qua `foldLabel`
  (NFD) của Seam 1, nên `Café ↔ cafe` và `Öland ↔ oland` cũng khớp: một bảng tra tay tiếng Việt
  sẽ trượt hai cái sau, và test đỏ đúng lúc ai đó thay bằng bảng tra.
- *Mọi id do extension tạo mang tiền tố chung* — `test/ids.test.js` quét **thật** bốn lượt: id
  trong HTML; chỗ code gắn id vào phần tử (lần ngược biểu thức về hằng số trong source); hằng số
  *được dùng làm id* (phân biệt bằng chỗ dùng, nên `NOT_A_VIDEO_ID` tự rơi ra mà không cần danh
  sách miễn trừ); và một lượt đi bộ trên cây panel vừa dựng lúc chạy. Mỗi lượt tự kiểm nó có tìm
  thấy gì đó — một lượt quét trúng 0 phần tử là một lượt quét vô nghĩa.

### Peer tự tìm ra, đáng ghi
Trong 12 hoán vị peer tự chạy, 3 cặp ban đầu **vẫn xanh** và peer tự vá. Nặng nhất là cặp
`playerVideo` ↔ `secondaryColumn`: mọi test bấm mốc đều đi qua chính `P.findVideo`, nên
`findVideo` trả về `#secondary` thay vì thẻ `<video>` vẫn xanh — **test tự khép kín quanh cái
sai**. Vá bằng cách lấy thẻ video thẳng từ cây trang rồi chốt `findVideo` trả đúng node đó.

`/code-review` của peer bắt thêm 3 lỗi thật, trong đó `say()` xoá bằng `.children` nhưng ghi vào
text node → mọi thông báo nối đuôi nhau, và test cũ dùng `assert.match` nên xanh mãi.

### Hở Lead tìm được
Peer xếp chuyện dọn panel khi SPA navigate vào mục "không phủ được", lý do: cần `window` giả có
`chrome.storage`, `navigator`, `setTimeout`, `yt-navigate-finish` — "đổi một lỗ hổng lấy một cây
giả thứ hai phải nuôi". Lead xoá hẳn `controller.close()` trong handler: **suite vẫn xanh
362/362**.

Hậu quả nặng hơn peer đánh giá. Không phải TypeError ồn ào, mà: mở panel ở video A, bấm sang
video B ở sidebar, **panel video A vẫn treo trên trang video B** — bấm mốc vẫn nhảy được vì
YouTube dùng lại đúng một thẻ `<video>`, nên không dấu hiệu nào cho thấy đang đọc transcript sai
video.

Và lý do "cần window giả" là hệ quả của việc `install` tự tạo `W.createTab(target)` bên trong,
không phải ràng buộc — peer đã giải đúng bài này một tầng dưới ở `createController` (mọi lối ra
là adapter tiêm).

**Đã vá** (`faa0465`, +4 test): `install(target, deps)` với `deps.tab` / `deps.makeController`
mặc định giữ nguyên hành vi trên trang thật. Test canh **quan hệ** — sau `yt-navigate-finish`,
dòng trong panel phải là của video đang mở — chứ không khoá tên sự kiện hay số lần gọi. Kèm hai
thứ cùng khối trước đó cũng trống: guard `controller &&` ở listener `timeupdate`, và `watched`
không gắn hai listener lên cùng một thẻ video. Lead xác minh lại: xanh 366, gỡ `controller.close()`
→ **ĐỎ**.

### Cặp Lead thử mà peer đã canh sẵn
`stamp: S.stamp(segment.start)` → `segment.end` trong `buildLines` (nhãn mốc lệch khỏi chỗ thực sự
nhảy tới): **ĐỎ**.

### Duyệt ngoài phạm vi file
`manifest.json` (khai `panel.js` + `srt.js` vào chuỗi nạp tab YouTube — không khai thì
`manifest.test.js` báo JS mồ côi, đúng như nó phải làm) và `watch.js` (`createTab`, cách duy nhất
để panel không có đường trích riêng). Cả hai là hệ quả bắt buộc của ticket. Peer báo thay vì im
lặng làm — đúng.

### Nợ ghi lại, không chặn ticket này
1. `.srt`/`.vtt` nạp lại được vào player thật và `<a download>` tải thật — không có trình duyệt
   trong suite. Ticket 012.
2. Panel trên DOM YouTube thật: `playerVideo` / `secondaryColumn` lệch thì chỉ trang thật mới lộ.
   Ticket 012.
