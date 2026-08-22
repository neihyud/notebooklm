---
status: done
labels: [ready-for-agent, risk]
blocked_by: []
spec: docs/spec/0001-notebooklm-importer.md
---

# 016 — Đối chiếu `fake-dom.js` với DOM thật

## Vì sao ticket này tồn tại

Ticket 009 tìm ra `src/docs/sidebar.js:321` gọi `.filter` thẳng lên `node.children`. DOM thật trả
`HTMLCollection`, không có phương thức Array nào, nên **Bảng chọn không bao giờ mở được trên trang
thật** — trong khi suite vẫn xanh 537/537.

Suite xanh vì `test/helpers/fake-dom.js` có `get children()` trả về **Array thật**. Cây giả sai
theo đúng hướng làm code sai trông như đúng.

Peer đã sửa đúng chỗ đó. Nhưng đó là **một** chỗ lệch, tìm ra do tình cờ trong lúc review một
ticket khác. Cả 537 test của repo này chạy trên cùng cây giả ấy, nên mỗi chỗ lệch còn lại là một
lô test xanh giả — và không có gì trong repo đang đi tìm chúng.

Đây là rủi ro cao nhất còn lại: nó không làm hỏng một tính năng, nó làm hỏng **thước đo**.

## Máy này có trình duyệt thật

Lead đo trực tiếp:

```
/home/neihyud/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome --version
→ Google Chrome for Testing 151.0.7922.34
playwright 1.62.1
```

Không cần đăng nhập, không cần mạng ngoài `about:blank` — mọi thứ ticket này cần đều dựng bằng
`page.setContent()`.

## Delivers

Một script chạy **cùng một bộ phép thử** trên hai cây — `fake-dom.js` và DOM thật của Chromium —
rồi báo mọi chỗ hai bên trả lời khác nhau.

## Scope

- Liệt kê **mọi** thuộc tính và phương thức DOM mà `src/` thực sự dùng. Suy từ code bằng `rg`,
  đừng chép từ trí nhớ: `children`, `childNodes`, `querySelector(All)`, `closest`, `matches`,
  `textContent`, `getAttribute`, `classList`, `attachShadow`, `append`, `remove`,
  `addEventListener`, `dispatchEvent`, `getBoundingClientRect`, … — danh sách thật có thể dài hơn.
- Với mỗi thứ, một phép thử chạy được ở **cả hai** cây và trả về giá trị so sánh được. Quan tâm
  cả **kiểu trả về**, không chỉ nội dung: `Array` ≠ `HTMLCollection` ≠ `NodeList` chính là lỗi
  ticket 009.
- Chạy trên Chromium thật qua `page.evaluate`, chạy trên cây giả trong Node, so kết quả.
- Báo cáo: mỗi chỗ lệch ghi rõ **hậu quả có thể có** — code nào trong `src/` đang dựa vào nó.

## Acceptance

- Handback dán **output thật** của lần chạy, kèm phiên bản Chromium.
- Mỗi chỗ lệch tìm được phải trả lời: có code nào trong `src/` đang dựa vào chỗ ấy không? Nếu có,
  đó là một lỗi thật — vá cây giả **trước**, xem suite đỏ ở đâu, rồi mới vá code. Đúng thứ tự
  ticket 009 đã làm.
- Nếu không tìm thấy chỗ lệch nào: nói rõ **đã thử bao nhiêu phép**, vì "không tìm thấy" với 5
  phép thử và với 60 phép thử là hai kết luận khác hẳn nhau.

## Ranh giới

- **Không sửa `src/` để cho hợp cây giả.** Chiều đúng luôn là: cây giả phải giống DOM thật.
- Không đăng nhập, không chạm NotebookLM, không tải trang ngoài. `page.setContent()` là đủ.
- Script này thuộc `tools/`, không vào `manifest.json`.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `01feb18`. Không cần vá vòng hai.

### Kết quả
```
# Chromium : Chrome/151.0.7922.34
# Node     : v22.23.1
# phép thử : 97
  giống nhau       : 92
  cả hai cùng ném  : 2
  lệch nhưng cố ý  : 3
  LỆCH             : 0
```
Lượt đầu 93 phép → **38 chỗ lệch**. Suite sau khi vá: `XANH — tests 567, 19 file` (+30).

### Điều quan trọng nhất, và nó không phải con số 38
Vá cả 38 chỗ lệch chỉ làm **đúng một** test đỏ (`notebooklm.test.js:400` gán
`addButton.childNodes = []`, trên trang thật là no-op — test ấy đang chạy trên một nút vẫn còn
nguyên chữ cũ). Nghĩa là code sản phẩm phần lớn vốn đã đúng.

Cái hỏng không phải sản phẩm, là **lưới**. Ví dụ rõ nhất: `children` của cây giả cũ là một
Array-snapshot, không phải `HTMLCollection` **sống**. Sáu chỗ trong `src/` (`sidebar.js:326`,
`picker.js:89/238`, `panel.js:281/348`, `playlist-bar.js:142`) dùng `Array.from` **chỉ vì** tính
sống ấy — và cây giả cũ không phạt được ai gỡ nó đi. Lỗi chưa xảy ra, nhưng không có gì chặn nó.

Cùng loại: `getBoundingClientRect` vắng mặt nên `sidebar.js:178` bọc trong `typeof`, và **nhánh
thật chưa test nào đi qua**. `addEventListener` nuốt lặng đối thứ ba, nên `{ once: true }` và
`capture` im lặng vô tác dụng trong mọi test của repo.

### Ranh giới peer tự rút ra, Lead giữ nguyên
Ba chỗ để nguyên, đánh dấu `lệch-cố-ý`: `hasAttribute`, `contains`, tổ hợp `>`. Lý do đúng và
đáng thành quy tắc: **property vs phương thức**. Property vắng mặt trả `undefined` rồi chạy tiếp
— im lặng, phải vá. Phương thức vắng mặt ném ngay — ồn ào, để vắng được.

### Bốn mutation sống sót ở lượt đầu, cùng một hạng lỗi
`firstChild ↔ lastChild`, `nextSibling ↔ previousSibling`, và hai phép về `removeEventListener`.
Peer chẩn đoán đúng: cùng một `fn` đăng ký ở hai pha thì **đếm số lần chạy không phân biệt được
bản nào bị gỡ** — thứ phân biệt là chỗ nó đứng trong chuỗi (capture chạy trước đích, bubble chạy
sau). Đổi assertion sang **thứ tự** và **tương ứng** (`node.firstChild.id === 'đầu'`), không phải
hình dạng.

### Peer tự nhận công cụ này là thước đo mới
Nó viết `test/audit-fake-dom.test.js` (30 test) cho lõi thuần của chính công cụ, lập luận: một
`describe()` viết hụt sẽ báo "0 lệch" cho hai giá trị khác kiểu và cả ticket thành tờ giấy chứng
nhận rỗng. Hai mutation trong danh sách nhắm thẳng vào đó (`describe` bỏ danh sách phương thức;
`describe` coi mọi thứ giống-mảng là Array) — cả hai đỏ.

Cổng review bắt 8 lỗi, đều trong code peer vừa viết, gồm một lỗi vệ sinh đo được: Chrome mồ côi
khi khởi động hỏng, **11 thư mục `/tmp` sót sau 11 lượt**; sửa bằng `Browser.close` trước khi kill
(0 sót).

### Phép thử Lead tự chạy
Cho `children` của cây giả trả **mọi** node thay vì chỉ Element:
- `bash test/run.sh` → **ĐỎ**;
- `node tools/audit-fake-dom.mjs` → `LỆCH: 5 (children:3, append:1, misc:1)`.

Tức cả hai lớp đều bắt, và công cụ chỉ đúng tên chỗ hỏng.

### Hệ quả cho cả repo
`tools/audit-fake-dom.mjs` thoát 1 khi còn chỗ lệch chưa đánh dấu cố ý, nên chạy được như một
cổng. **Mọi ticket sau đụng `test/helpers/fake-dom.js` phải chạy nó và dán kết quả.**
