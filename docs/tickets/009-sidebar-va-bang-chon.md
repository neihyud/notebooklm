---
status: done
labels: [ready-for-agent]
blocked_by: [008]
spec: docs/spec/0001-notebooklm-importer.md
---

# 009 — Dò sidebar và Bảng chọn Nhánh tài liệu

## Delivers
Trên một trang docs bất kỳ, extension nhận ra sidebar và mở Bảng chọn dựng đúng cây mục lục,
có ô lọc, tick mục cha là chọn cả nhánh con.

## Scope
- Chấm điểm ứng viên theo dấu hiệu hành vi: số link cùng site, có lồng `ul` không, bề ngang cột,
  và dấu hiệu mạnh nhất — **có chứa link trỏ về chính trang đang mở**.
- Thu hẹp dần xuống khối con nào vẫn giữ đủ link, rồi dựng cây theo `ul/li`.
- **Chỉ tin đường `<ul>` khi nó gom được ≥80% số link thật trong container.** VitePress dựng
  sidebar bằng `<div>` lồng nhau nhưng vẫn lẫn một `<ul>` nhỏ; ngưỡng yếu kiểu "≥3 link là
  xong" trả về cây tí hon và bỏ sót phần lớn link.
- **Mỗi lượt dựng có sổ "đã nhận" riêng.** Dùng chung sổ thì lượt `<ul>` nhận mất một phần link
  rồi lối xếp phẳng mất sạch chính những link đó.
- Loại link khác host, giao thức lạ, và neo trong trang. Giữ hash-route kiểu `#/guide/intro`.
- Bảng chọn dựng trong shadow DOM.

## Acceptance
- Cả hai lỗi trên đều **im lặng** — bảng vẫn mở, vẫn có link, chỉ là thiếu. Vì vậy test phải
  so số link dựng được với số link thật trong container, không phải chỉ kiểm "có link".
- Sidebar chỉ chứa mục lục trong trang (Sphinx thuần) thì báo rõ là không có link điều hướng,
  không im lặng trả về danh sách gần rỗng.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `561c392`. Không cần vá vòng hai.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 537, 18 file.` (T014 kết ở 499; ticket này +38.)

### Hai bug ngầm ticket viết sẵn từ hồi grilling
- Ngưỡng `<ul>` yếu → `LIST_COVER_RATIO = 0.8` **tính trên số link thật trong container**, không
  phải con số tuyệt đối. Hoán vị về "≥3 link" → ĐỎ 5 test.
- Sổ "đã nhận" dùng chung → `newLedger()` gọi riêng từng lượt. Hoán vị về sổ chung → ĐỎ 5 test.

### Cặp Lead thử ngoài 28 hoán vị của peer
`WEIGHT.column` 8 ↔ `WEIGHT.current` 20 — tức hạ "có link trỏ về trang đang mở" xuống ngang một
dấu hiệu phụ và nâng "bề ngang cột" lên thành mạnh nhất: **ĐỎ**. Peer canh **vai** của từng trọng
số, không chỉ hai cặp nó liệt kê.

### Peer tự tìm ra, và đây là phát hiện lớn nhất của phiên
Cổng review bắt `src/docs/sidebar.js:321` gọi `.filter` thẳng lên `node.children`. DOM thật trả
`HTMLCollection` — **không có phương thức Array nào** — nên mọi lượt dựng cây theo `<ul>` sẽ ném
`TypeError` và Bảng chọn **không bao giờ mở được trên trang thật**. Suite vẫn xanh.

Lý do suite xanh: `test/helpers/fake-dom.js` `get children()` trả về **Array thật**. Cây giả sai
theo đúng hướng làm code sai trông như đúng.

Peer xử lý đúng thứ tự: sửa cây giả trước → suite **ĐỎ ngay 12 test** với đúng `TypeError` đó →
rồi mới sửa `sidebar.js`. Bốn chỗ dùng `.children` khác trong repo đều `for…of` hoặc `Array.from`;
chỉ dòng ấy phá quy ước.

Peer cũng **gỡ** `install(root)` lúc nạp của `picker.js` thay vì để đó — nó chỉ đăng ký hai
listener ôm một `controller` vĩnh viễn `null`, và ticket 010 sẽ gọi `install(window)` lần nữa →
chồng thêm một cặp listener. Đúng hướng "gỡ thứ không có tác dụng".

### Hai hoán vị sống sót mà Lead chấp nhận
Peer không thêm assertion cho chúng và nói rõ vì sao: `topLists` trả mọi `<ul>` thay vì `<ul>`
ngoài cùng (sổ theo từng lượt + duyệt tiền thứ tự làm hai bên cho kết quả y hệt — **không có input
nào phân biệt được**), và hoà số link thì lấy khối nông nhất thay vì sâu nhất (cây dựng ra giống
hệt, chỉ khác `container` xuất ra). Đây là tương đương chứng minh được, không phải lỗ hổng — thêm
assertion vào đó là khoá một chi tiết triển khai.

Đáng ghi: một hoán vị **sống sót vì luật cũ sai thật** — "thu hẹp chỉ theo sâu nhất" với chuỗi
20 → 19 → 18 link thì đi thẳng xuống đáy vứt 2 link, dừng giữa chừng chỉ vứt 1. Peer đổi luật
thành "nhiều link nhất, hoà thì sâu nhất" rồi mutation mới chết.

### Nợ ghi lại
1. Sáu bộ dựng docs chỉ có mặt dưới dạng fixture. Ticket 012.
2. Bảng chọn chưa nối hàng đợi; chưa có `deps.send` thì nó **nói ra thành chữ** thay vì im lặng.
   Ticket 010.
3. **Rủi ro hệ thống**: xem ticket 016, mở từ chính finding #2 của ticket này.
