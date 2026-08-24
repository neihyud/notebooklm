# 002 — Extension tự đo hình dạng request, không bắt owner mở terminal

- status: draft — **chưa giao**, và **bớt cấp bách từ 2026-08-24**: `docs/notebooklm-rpc-do-duoc.md`
  đã cho hình dạng payload từ một sản phẩm đang chạy, nên 001 không còn bị chặn bởi việc đo.
  Ticket này vẫn cần — oracle bên thứ ba không thay được request thật trên máy owner, và nó là
  thứ duy nhất phân xử được chỗ hai oracle mâu thuẫn về cách nhóm `args`.
- class: cross-module (chạm `manifest.json`) → xem `WORKSPACE_PROTOCOL.md`
- blocked-by: peer `e4fe10d` (ticket 001) đang idle với ~1.635 dòng **chưa commit** trên cùng
  working tree. Một writer tại một thời điểm — 001 phải commit và đóng trước.
- quan hệ với 001: ticket này **thay đường đo**, không thay `rpc.js`. Mục "Điểm cần đo, không đoán"
  của 001 hiện chỉ có một đường trả lời là `node tools/probe-notebooklm.mjs`; ticket này thêm
  đường thứ hai không cần terminal. `rpc.js` không phải sửa vì việc này.

## Bối cảnh

`tools/probe-notebooklm.mjs` (424 dòng, đã có) đo được đúng thứ cần đo, nhưng bắt owner: mở một
Chrome riêng với profile `/tmp`, **đăng nhập Google lại trong đó**, rồi để script tự gửi request.
Vì nó tự gửi nên mới sinh ra ràng buộc "phải nhắm notebook nháp" — hình dạng sai thì đẻ Nguồn rác
phải xoá tay.

Extension thì đã ở sẵn trong tab đã đăng nhập. Nó nghe được request thật do **chính owner** tạo ra
khi thêm Nguồn bình thường — và nghe thì không ghi gì, nên cả ràng buộc notebook nháp cũng biến mất.

Repo đã có đúng pattern này ở phía YouTube: `src/youtube/page-bridge.js` (MAIN world,
`document_start`, hook `window.fetch` và `XMLHttpRequest.prototype.open/setRequestHeader`) +
`src/youtube/bridge-client.js` (bọc `postMessage` thành Promise).

## Kết quả cần có

Sau khi owner thêm **một** Nguồn bằng tay trên NotebookLM, trang Cài đặt hiện đủ giá trị để điền
vào ô `rpcOverrides` đang có: rpc id thật, đường batchexecute thật, `slots`, và `kindCodes`.
Không mở terminal, không mở DevTools.

Hạ tầng hiển thị **đã có, dùng lại chứ đừng dựng mới**: `saveDomReport`/`getDomReports`
(`src/common/shared.js:184`), khung JSON + nút copy ở `src/options/options.html:181`.

## Ranh giới an toàn — đọc trước khi viết dòng đầu tiên

1. **Cầu nối này CHỈ NGHE.** `page-bridge.js` của YouTube hook fetch để *mượn header rồi tự gửi
   request*; ở đây **không gửi gì cả**, không sửa request, không sửa response. Hook chỉ đọc rồi
   chuyển tiếp nguyên trạng. Nếu thiết kế của bạn cần gửi một request nào đó để đo — dừng lại,
   escalate `BLOCKED`.
2. **Request batchexecute chứa cả `at` token lẫn nội dung Nguồn** (với video private, nội dung đó
   là cả bản transcript). Bản chụp là thứ owner copy đi gửi kèm báo lỗi. Che theo đúng quy ước
   `probe-notebooklm.mjs` đã đặt: mọi chuỗi thành `"str(<độ dài>)"` **trước khi** ra khỏi trang;
   số thì giữ nguyên vì mã loại nguồn là số. `rpc.js` đã có `redact()` và `describeAt()` — cùng
   một kỷ luật, đừng đặt ra quy ước thứ hai.
3. **Không thêm permission vào `manifest.json`.** `notebooklm.google.com` đã nằm trong
   `host_permissions`; việc cần làm là thêm một entry `content_scripts` world MAIN. Nếu bạn kết
   luận là phải thêm quyền — dừng, escalate `BLOCKED`.
4. `src/notebooklm/content.js` không được sửa (ràng buộc kế thừa từ 001).

## Điểm cần đo, không đoán

- **Ô nào chứa gì — làm sao biết mà không kiểm soát input.** `probe-notebooklm.mjs` giải bằng chuỗi
  mốc do chính nó sinh ra rồi bảo owner dán vào. Đường đó không dùng lại được ở đây.
  Có một khả năng đáng đo trước khi nghĩ cách khác: khi owner để extension chạy **đường DOM**
  (mặc định hiện tại), extension *đã biết* URL / tiêu đề / nội dung nó vừa điền vào hộp thoại. Nghe
  request sinh ra từ chính lượt đó là biết giá trị nào rơi vào ô nào — extension tự học từ việc
  của chính mình, owner không thao tác gì thêm. Đo xem có khả thi không rồi hãy chọn.
- **Thời điểm nạp.** `page-bridge.js` chạy `document_start` vì phải hook trước request đầu tiên của
  trang. NotebookLM là SPA Angular — request thêm Nguồn xảy ra muộn, nên `document_start` có thể
  không cần thiết. Đo rồi chọn, đừng chép mặc định.
- **`at` token: cầu nối này có làm `readAtToken()` thành thừa không?** MAIN world đọc thẳng
  `window.WIZ_global_data` được, còn `rpc.js` hiện phải parse chữ của thẻ `<script>`. Nếu cầu nối
  đã tồn tại thì đường nào đáng giữ? Trả lời bằng đo, và **đừng tự xoá `readAtToken()`** — nó là
  đường duy nhất chạy được khi cầu nối chưa nạp xong.

## Không thuộc phạm vi

Sửa `src/notebooklm/rpc.js`. Bật `rpcEnabled` mặc định. Tự động ghi giá trị học được vào
`rpcOverrides` — ticket này chỉ *hiện ra* cho owner đọc và tự dán; tự động điền là ticket sau, và
nó cần owner duyệt riêng vì hình dạng sai thì tạo Nguồn rác.

## Kiểm chứng

- `bash test/run.sh` xanh. Đo baseline trên cây sạch khi nhận ticket, ghi kèm sha.
- **Chạy thật một lần**, thêm một Nguồn bằng tay, rồi dán bản chụp thu được vào handback —
  đã che chuỗi, để Lead kiểm chính mắt rằng không có token và không có nội dung Nguồn lọt ra.
- Chứng minh **cầu nối không phát sinh request nào**: đếm request tới `batchexecute` trong một lượt
  có bật cầu nối và một lượt không, phải bằng nhau.

## Ở acceptance sẽ hỏi

`slots.url` và `slots.youtubeUrl` là hai số cùng kiểu ở cùng một mảng `params[0]`, và cầu nối học
chúng từ hai lượt chạy khác nhau. Hoán vị hai giá trị học được thì cái gì bắt được? Nếu câu trả lời
là "không cái nào" thì nói ra — đó là kết quả hợp lệ, im lặng thì không.
