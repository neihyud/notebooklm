# 005 — Kiểm chứng `css.sourceList` / `css.sourceItem` trên DOM thật

- status: **BLOCKED** — chờ owner dán bản chụp. Mọi thứ khác đã sẵn.
- loại: Tiny / bounded (1 peer seat, `bash test/run.sh` là cổng)
- chặn bởi: một dữ kiện duy nhất, xem mục 1

## 1. Thứ duy nhất còn thiếu

`src/notebooklm/selectors.js:64-74` khai báo hai mảng và tự dán nhãn **CHƯA KIỂM CHỨNG**:

    sourceList: ['labs-tailwind-source-list', '.source-list', '[role="list"].sources']
    sourceItem: ['.single-source-container', 'single-source', '[role="listitem"]', '.source-item']

Không ai từng thấy chúng chạy. Bản chụp duy nhất đang có (`test/fixtures/notebooklm-add-source-state-main.html`)
là hộp thoại thêm nguồn, không chứa danh sách Nguồn.

Owner chạy một mục trên notebook **nháp** rồi bấm Copy trong popup. Ticket 004 đã dựng sẵn đường
đó: khi `countSources()` trả `null`, `confirmSourceAdded` gọi `recordReport(REPORT.SOURCE_LIST_UNREADABLE, …)`
với `pageStructure(document.body)` — chụp cả trang, đúng phạm vi, vì danh sách Nguồn nằm NGOÀI
hộp thoại. Bản chụp chỉ có cấu trúc: không `value` ô nhập, không nội dung Nguồn, không tiêu đề notebook.

**Nếu `countSources()` chạy đúng ngay lần đầu** thì không có bản chụp nào cả — đó là tin tốt, và
ticket này rút xuống chỉ còn mục 3 (gỡ nhãn CHƯA KIỂM CHỨNG + ghim một test hồi quy từ DOM thật).

## 2. Việc

1. Thêm bản chụp vào `test/fixtures/` như file thứ hai. Giữ **nguyên văn**; header comment ghi rõ
   nó chụp lúc nào, ở trạng thái nào, và vì sao còn tồn tại.
2. Sửa hai mảng cho khớp DOM thật. Selector nào bản chụp chứng minh là sai thì **gỡ**, đừng chỉ
   thêm cái mới lên đầu — mảng dài ra là chỗ trốn cho selector chết.
3. Gỡ nhãn CHƯA KIỂM CHỨNG ở `selectors.js:56-62`, thay bằng ngày kiểm và tên file fixture.

## 3. Kiểm chứng

- `countSources()` chạy trên fixture mới phải trả **đúng số Nguồn nhìn thấy trong bản chụp** —
  hằng số này chép tay từ mắt người, nên phải kèm chú thích đếm bằng cách nào.
- Ca `null` phải **còn sống**: dựng một DOM không có danh sách Nguồn, `countSources()` vẫn trả
  `null` chứ không phải `0`. Đây là chỗ dễ hỏng nhất khi sửa — làm selector khớp rộng hơn thì
  `0` và `null` nhập làm một, và "chưa xác minh được" âm thầm biến thành "không có nguồn nào".
- Hoán vị bắt buộc: đổi chỗ `sourceList` ↔ `sourceItem`. Suite phải ĐỎ. Hai mảng cùng kiểu,
  cùng được `queryFirst` tiêu thụ, và `listFound` trong báo cáo 004 phân biệt đúng hai ca đó —
  nên nếu hoán vị vẫn xanh thì `listFound` đang nói dối và bản chụp lần sau sẽ chỉ sai chỗ.

## 4. Không làm

Không đụng `confirmSourceAdded`, `settledSourceCount`, hay ngữ nghĩa `verified`. Ticket 002 đã
chốt: đếm không đọc được → `null` → popup nói "chưa xác minh được". Ticket này chỉ làm cho ca
`null` hiếm đi, **không** đổi ý nghĩa của nó.
