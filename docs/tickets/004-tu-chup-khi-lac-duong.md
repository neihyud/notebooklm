# 004 — Extension tự chụp DOM khi nó lạc đường

- status: **DONE** — nghiệm thu 2026-08-23. 642 pass/0 fail/14 file (vào: 534/12).
  Cặp Lead chọn (hoán vị hai nhãn `REPORT.*` ở call site) **đã có lưới sẵn** — lần đầu trong bốn lượt.
  Bản chụp tự kiểm trên fixture thật: 11 277 ký tự, đủ để viết lại selector mà không hỏi thêm.
- class: tiny/bounded → xem `WORKSPACE_PROTOCOL.md`
- blocking edges: không. 002 và 003 đã DONE.

## Vấn đề

Ba ticket vừa rồi đều dừng ở cùng một chỗ: **không ai có bản chụp DOM của trạng thái sau khi bấm
nút loại nguồn, và của danh sách Nguồn.** Hệ quả đang mang trong người:

- `S.css.urlInput` (`src/notebooklm/selectors.js`) vẫn phải giữ chuỗi dự phòng rộng tới
  `input[type="text"]` vì không ai biết `formcontrolname` thật.
- `S.submit` khớp chính xác trên nhãn phỏng đoán; chưa ai chứng minh nó tìm ra nút xác nhận thật.
- `S.css.sourceItem` (ticket 002) **chưa từng chạy trên DOM thật** — trên notebook thật nhiều khả
  năng cho `verified: false` mãi mãi.

Cách duy nhất để lấy bản chụp là chạy trên trình duyệt đã đăng nhập của owner. Máy dựng không có
Chrome. Nên **đừng cố tự lấy** — hãy làm cho việc owner lấy nó rẻ đi.

## Kết quả cần có

Khi extension **không tìm được thứ nó cần**, nó tự ghi một bản chụp **cấu trúc** của vùng liên quan
vào `chrome.storage.local`, và trang Options có chỗ xem/sao chép bản chụp đó bằng một nút.

Ba tình huống phải kích hoạt việc chụp:
1. `queryFirst(dialog, S.css.urlInput)` chỉ khớp được nhờ selector dự phòng rộng
   (`input[type="text"]` / `input:not([type])`), chứ không nhờ selector cụ thể.
2. `findByLabel(dialog, S.submit)` trả `null`.
3. `countSources()` trả `null` (không đọc được danh sách Nguồn).

## Ràng buộc — đọc kỹ, đây là chỗ dễ làm hỏng

- **CHỈ CHỤP CẤU TRÚC.** Tên thẻ, `formcontrolname`, `aria-label`, `placeholder`, `role`, `jslog`,
  class, và nhãn nút. **KHÔNG** chụp `value` của ô nhập, **KHÔNG** chụp nội dung Nguồn, **KHÔNG**
  chụp tiêu đề notebook. Đây là dữ liệu riêng của owner; bản chụp là để gỡ lỗi selector, không
  phải để đọc nội dung. Nếu bạn thấy một trường có thể mang nội dung người dùng, bỏ nó.
- Có trần dung lượng và chỉ giữ **bản chụp gần nhất cho mỗi tình huống** — không tích thành nhật ký.
- Không thêm permission nào vào `manifest.json`. Nếu thấy cần, escalate `BLOCKED`.
- KHÔNG commit, KHÔNG push.
- Mốc xanh vào: **534 pass / 0 fail / 12 file**. Không được giảm.
- Test mới phải ĐỎ khi gỡ bản vá.
- Nhớ hình dạng lỗi mà `WORKSPACE_PROTOCOL.md` đã ghi: **đường dữ liệu song song**. Bản chụp là một
  đường như thế — nó đi từ `automation.js` sang storage rồi sang Options, và không nằm trên đường
  đi của một Lượt chạy. Hãy tự hỏi nó có thể sai lặng lẽ ở đâu.
