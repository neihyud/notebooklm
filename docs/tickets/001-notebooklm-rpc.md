# 001 — Đường RPC cho việc thêm Nguồn, giữ DOM làm fallback

- status: **ĐANG GIAO** — owner duyệt hướng "làm" ngày 2026-08-24. Lead giao peer cùng ngày.
- blocked-by: **không còn**. 002 và 003 đã DONE và nghiệm thu, 004 cũng vậy; hai peer đã archive.
  Working tree sạch, đang ở nhánh `fix/dan-dung-o-nhap` (3 commit). Bạn là writer DUY NHẤT.
- owner đã duyệt: hạng "architecture lock-in", owner chọn **làm** ngày 2026-08-24 sau khi đọc
  khuyến nghị ngược lại của `001-PHAN-TICH.md`. Quyết định đã có, đừng mở lại.
- class: architecture lock-in → xem `WORKSPACE_PROTOCOL.md`
- blocking edges: không có. Ticket này tự đứng được.
- blocks: mọi ticket sau về tốc độ Lượt chạy.

## Bối cảnh

Hiện mỗi Nguồn tốn một chuỗi thao tác UI: mở hộp thoại → chọn chip → điền ô → bấm *Chèn* →
chờ hộp thoại đóng → chờ thêm ~1,2s để bắt lỗi hiện muộn ở snackbar
(`src/notebooklm/automation.js:213`, `:235`, `:286`). Nó chạy được, nhưng chậm và phụ thuộc
DOM Angular Material mà Google đổi thường xuyên.

Giao diện NotebookLM nói chuyện với backend qua `batchexecute`. Vì `src/notebooklm/content.js`
đã là content script trên `notebooklm.google.com` (`manifest.json:104`), một `fetch` từ đó là
same-origin — Chrome tự gắn cookie phiên. **Không cần đọc cookie, không cần quyền mới.**

## Kết quả cần có

Một đường thêm Nguồn qua RPC, **đặt sau đúng hai hàm đang có** — `A.addUrlSource(url)` và
`A.addTextSource(title, text)`, cùng trả `{ ok, error, limit }`. `src/notebooklm/content.js`
không phải đổi, `HANDLED` không phải đổi.

Thử RPC trước; RPC hỏng → **tự động rơi xuống đường DOM hiện tại**, người dùng chỉ thấy chậm hơn.

## Ràng buộc

1. **Không gỡ, không sửa hành vi `automation.js`.** Nó là lưới an toàn. Chỉ thêm đường mới bên cạnh.
2. **Không thêm permission nào vào `manifest.json`.** Nếu bạn kết luận là *phải* thêm — dừng lại và
   escalate `BLOCKED`, đừng thêm.
3. **rpc id là giá trị ngoại sinh, không phải hằng số của ta.** Google xoay nó không báo trước.
   Một test ghim `izAoDd` sẽ xanh vĩnh viễn kể cả sau khi id đổi — nó chứng nhận thứ ta gõ, không
   chứng nhận thứ server nhận. Yêu cầu: **phát hiện lúc chạy** khi id không còn đúng, và rơi xuống
   DOM. Cơ chế phát hiện là thứ handback phải trình bày; assertion ghim id thì không tính.
4. **Cho owner ghi đè id mà không cần bản mới**, theo đúng cách `selectorOverrides` đang làm
   (`src/options/options.js:60`, `src/notebooklm/content.js:12`) — kể cả cấu trúc "gộp thêm chứ
   không thay thế".
5. Không log, không lưu, không gửi `at` token hay cookie đi đâu ngoài chính request tới
   `notebooklm.google.com`.

## Điểm cần đo, không đoán

- **`at` token (CSRF) lấy thế nào.** Nó nằm trong `WIZ_global_data` của trang. Content script chạy
  ở **ISOLATED world nên không thấy biến `window` của page** — nên có ít nhất hai đường: regex từ
  HTML trong DOM, hoặc một MAIN-world bridge kiểu `src/youtube/page-bridge.js` +
  `src/youtube/bridge-client.js` đã có sẵn trong repo. Đo cả hai rồi chọn, ghi lý do vào handback.
  Đừng tin tên key nào tôi hay tài liệu bên ngoài nêu — mở DevTools trên tab thật mà đọc.
- **Hình dạng `f.req`.** Theo tài liệu cộng đồng (`notebooklm-py`, đã kiểm 2026-08-23):
  `ADD_SOURCE = izAoDd`, URL ở `params[0][2]`, text là `[title, content]` ở `params[0][1]` kèm
  type code `2` ở `[3]`, YouTube URL ở `[7]`, và `source_path=/notebook/{notebook_id}`.
  **Coi đây là giả thuyết cần kiểm, không phải spec.** Nguồn sự thật là request thật trong
  Network tab của chính owner.
- **Response có prefix `)]}'` và là mảng lồng không tên field.** Parse sai vẫn trông như thành công.
  Trình bày cách bạn phân biệt "đã thêm" với "đã gửi".
- **`limit`** — hiện nhận diện qua chữ hiển thị (`isLimitError`, `automation.js:171`). Đường RPC
  báo giới hạn 50 nguồn kiểu gì? Nếu không phân biệt được, nói thẳng là chưa phân biệt được.

## Không thuộc phạm vi

Xoá/đổi tên Nguồn, tạo notebook, audio overview, đụng phía YouTube.

## Kiểm chứng

- `bash test/run.sh` phải xanh. Đo baseline lại trên cây sạch khi nhận ticket — con số cũ trong lịch sử hội thoại đo giữa lúc peer khác đang sửa, không dùng được.
- **Chạy thật, trên một notebook nháp mới tạo** — không phải notebook thật của owner
  (`WORKSPACE_PROTOCOL.md` → external side effects: thêm Nguồn không idempotent, gỡ phải xoá tay).
  Handback ghi: tên notebook nháp, số Nguồn trước/sau, và cả hai nhánh đã chạy — RPC thành công,
  và RPC hỏng-rơi-xuống-DOM (ép hỏng bằng cách đặt override id sang một giá trị rác).
- **Câu "repo không có jsdom" trong bản gốc ticket nay SAI** — `package.json` có jsdom (devDependency
  duy nhất), và `test/dom-harness.js` nạp source thật vào DOM thật dựng từ fixture. Kết luận cũ vẫn
  đứng nhưng vì lý do khác: jsdom không cho bạn `fetch` thật, và shim tự viết vẫn chỉ chứng nhận
  thứ ta gõ. Cái ĐO ĐƯỢC bằng jsdom là phần không chạm mạng — dựng payload, parse response mẫu,
  gộp override, và quyết định rơi-xuống. Hãy phủ hết phần đó bằng test; đừng dừng ở "không test được".

## Ở acceptance sẽ hỏi

Hoán vị `title` và `text` trong `addTextSource` thì test nào chết? Hoán vị vị trí `[2]` và `[7]`
trong payload thì cái gì bắt được? Nếu câu trả lời là "không cái nào" thì đó là kết quả hợp lệ —
nhưng phải nói ra, không được để trống.
