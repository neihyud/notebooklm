# Ca link công khai rời khỏi Lượt chạy, đi Đường trao tay

- status: accepted — owner duyệt 2026-08-24
- liên quan: `CONTEXT.md` → "Ai đưa vào"; `docs/tickets/006-duong-trao-tay.md`

NotebookLM nhận **nhiều URL trong một lần dán**, phân tách bằng khoảng trắng hoặc xuống dòng
(tài liệu chính thức của Google, đọc 2026-08-24). Nghĩa là một xấp link công khai tốn của người
dùng **một** cú Ctrl+V, trong khi extension phải mở **một lượt hộp thoại cho mỗi link** để làm
cùng việc đó — chi phí một bên là hằng số, bên kia tuyến tính. Đó mới là lập luận. Xấp đó dài
được tới đâu thì **chưa đo được**, và đừng viết như thể đã đo: doc chính thức chỉ nêu luật phân
tách, không nêu trần số URL mỗi lần dán (`docs/tickets/006-duong-trao-tay.md` → "Điểm cần đo"
đã xếp đúng việc này vào diện chưa đo, kèm lệnh "đừng bịa một ngưỡng chia lô").

Vì vậy ca link công khai chuyển sang **Đường trao tay** — extension gom link vào clipboard rồi
dừng — còn phần tự động hoá co lại phục vụ đúng thứ không có đường thay thế: **Dán text** cho
video private và trang docs render bằng JavaScript.

## Vì sao đáng ghi lại

Người đọc sau sẽ thấy một extension tự động hoá được việc thêm Nguồn mà lại **cố tình không
tự động hoá** ca dễ nhất, và sẽ tưởng đó là việc còn dang dở. Không phải. Ca dễ nhất là ca
duy nhất mà một thao tác tay của người dùng **rẻ hơn hẳn** mọi thứ extension làm được, và
đổi lại ta rút được toàn bộ ngân sách "sẽ vỡ khi Google đổi DOM" ra khỏi nó.

## Các lựa chọn đã cân

1. **Giữ nguyên, coi Đường trao tay là tiện ích phụ.** Bỏ vì như vậy quyết định chỉ là lời
   nói: phím tắt và các nút vẫn đẩy link công khai qua đường tự chèn, và ta vẫn nuôi nguyên
   chi phí DOM cho ca đó.
2. **Gỡ hẳn nhánh `'url'` khỏi Lượt chạy.** Bỏ vì đo được là đắt và gần như vô giá trị: `'url'`
   có **hai** call site — `importVideo` (`src/background/service-worker.js:866-878`) và
   `importDoc` (`:989-1001`) — mà `docsMode` còn ba lựa chọn dùng link
   (`src/common/shared.js:143`; bốn giá trị thật ở `src/background/service-worker.js:975-978`
   — JSDoc tại chỗ khai báo còn thiếu `'url'`).

   Gỡ thật trên bản chép của `d37a9ec`, đo 2026-08-25. Gỡ **trung thực**, tức hết cả nhánh:
   `planFor` chỉ còn `['text']` (`src/background/service-worker.js:836-850`), hàm `addUrlSource`
   + dòng export (`src/notebooklm/automation.js:706-736`, `:836`), hằng chẩn đoán
   `REPORT.URL_INPUT_FALLBACK` + lời gọi `recordReport` nằm trong chính hàm đó (`:411`, `:722`),
   wrapper `addUrlSource` của `rpc.js` (`:826-828`), `slots.url`/`slots.youtubeUrl` (`:104`),
   `case MSG.NLM_ADD_URL` (`src/notebooklm/content.js:99-106`), và hai khoá chip trong
   `selectors.js`. Toàn bộ `src` vẫn `node --check` sạch sau khi gỡ.

   Kết quả **không phải một con số fail** — đó mới là điều đáng ghi:

   | file | baseline | sau khi gỡ |
   |---|---|---|
   | `notebooklm-dom-report` | 82 pass | **CRASH** — `TypeError: g.A.addUrlSource is not a function` |
   | `notebooklm-dom` | 88 pass | **CRASH** — `TypeError: Cannot read properties of undefined (reading 'map')` |
   | `notebooklm-rpc` | 131 pass | **CRASH** — `TypeError: call is not iterable` |
   | `messaging` | 30 pass | 29 pass / 1 fail |
   | `service-worker-done` | 109 pass | 97 pass / 5 fail |
   | *(10 file còn lại)* | | không đổi |

   Tổng: **787 pass → 473 pass**. 314 assertion biến mất, phần lớn không phải vì đỏ mà vì file
   không chạy nổi tới dòng tổng kết.

   Và nó **bị che gần hết**: `test/run.sh` có `set -e`, mọi file test `exit 1` khi đỏ hoặc crash
   (đo đúng — chú ý `$(basename …)` trong `echo` nuốt mất `$?`, đo kiểu đó ra `exit=0` sai toàn
   bộ). Nên lượt chạy dừng ở file đỏ **theo thứ tự alphabet**, tức `messaging.test.js`, và chỉ
   khoe *"29 pass, 1 fail"*. Ba cú crash và 314 assertion mất trắng **không xuất hiện trên màn
   hình**. Ai đo cost bằng một lượt `run.sh` sẽ báo về con số 1.

   Cảnh báo kèm theo: gỡ **một phần** nhánh này cho ra những con số nhỏ và mâu thuẫn nhau — chỉ
   gỡ hằng `URL_INPUT_FALLBACK` ra 12 fail, chỉ gỡ hai chip ra 40 fail, chỉ gỡ `slots` ra 4 fail.
   Không con số nào trong đó là giá của lựa chọn này; chúng là giá của việc gỡ dở.

   Đổi lại chỉ dọn được ~12 dòng `rpc.js` và một mảng selector. Giá quá cao cho phần thu được.
3. **Bỏ tự động hoá, chỉ còn Đường trao tay.** Bỏ vì nó giết ca video private — chính lý do
   extension này tồn tại — và `WORKSPACE_PROTOCOL.md` xếp việc gỡ đường DOM vào diện owner
   phải duyệt riêng.

## Hệ quả không hiển nhiên

- **Đường trao tay không có Rơi xuống.** Không ai đứng đó nhìn thấy nó hỏng. Nên mọi thứ
  *không chắc chắn vào được* đều không được lên clipboard: video unlisted **không bao giờ vào
  một Bó link**, nó đi Hàng đợi.

  Nói cho hết, vì bản trước của dòng này viết quá tay: luật đây **chỉ cấm cửa Bó link**, nó
  không đụng tới `unlistedMode` (`src/common/shared.js:84`). Trong Hàng đợi, unlisted vẫn theo
  cài đặt của người dùng — `'url'` ra Dán link, `'transcript'` ra Dán text, mặc định
  `'url-then-transcript'` (`src/background/service-worker.js:842-843`). Hai chỗ, hai luật; gộp
  lại thành "unlisted luôn đi Dán text" là lặng lẽ ghi đè một cài đặt đang chạy, thứ ADR này
  không có thẩm quyền đụng. `CONTEXT.md` → "Chính sách đưa vào" ghi đúng bản này.
- **"Xong" không áp dụng được, và không được vờ như có.** `countSources()` chỉ đếm chứ không
  đọc được URL của từng Nguồn (`src/notebooklm/automation.js:303`), nên "bạn dán 47 link, 44
  cái vào" là thứ extension không có cách nào biết. Trạng thái cuối của một Bó link là **"đã
  copy"**, mãi mãi.
- **Huy hiệu chỉ được quyền loại, không được quyền nhận.** Huy hiệu trên thẻ video chỉ nói được
  "Private"/"Unlisted"; video public trả về `'unknown'` (`src/youtube/page-bridge.js:432-441`).
  Nên lọc theo điều kiện "huy hiệu phải nói public" sẽ loại sạch gần như mọi video — huy hiệu
  không dùng làm bằng chứng *nhận* được.

  Nhưng **cũng không được lấy `unknown` làm bằng chứng nhận**, dù bản đầu của ADR này đã suy như
  thế. Đo 2026-08-25: hai bộ đọc huy hiệu chỉ phủ Anh + Việt, còn nhãn giao diện đi theo `hl`
  của chính trang — owner để YouTube tiếng Đức thì video private của chính họ đọc ra `unknown`.
  Và hôm nay `resolveMeta` (`src/background/service-worker.js:552-557`) đang cưỡng chế
  fail-closed cho đúng ca này, nên cho `unknown` lên clipboard là *tháo một cái chốt đang chạy*,
  không phải "chưa chặt tay".

  Sửa một chữ 2026-08-25: bản trước viết **"cưỡng chế"** in đậm, hàm ý tuyệt đối. Đo lại thì cái
  chốt đó **có một chỗ hở** — `resolveMeta` kết thúc bằng `(await patchItem(...)) || item`
  (`:560-568`), và `patchItem` trả `null` khi Mục đã bị xoá khỏi Hàng đợi, nên Mục chưa phân
  giải privacy vẫn tới được `planFor` → `default` → `['url','text']`. Chi tiết và điều kiện tái
  hiện ở `docs/tickets/006-duong-trao-tay.md` mục 5. Điều này **không đảo lại quyết định của
  ADR** — lập luận "huy hiệu không được quyền nhận" đứng độc lập với việc cái chốt kia kín hay
  hở, và một chốt hở lại càng là lý do đừng thêm đường thứ hai đi vòng qua nó.

  Luật đúng, chốt trong `docs/tickets/006-duong-trao-tay.md` mục 5: chỉ **player response** cấp
  phép vào Bó link. Huy hiệu giữ nguyên vai loại-sớm-miễn-phí; thứ còn lại phải hỏi. Điều này
  **không** mở lại quyết định của ADR — nó chỉ nói rõ ai được ký.
- **Nhánh tự chèn link vẫn ở nguyên chỗ cũ**, không đụng tới. Nó vẫn phục vụ `docsMode`, và
  là lối lui nếu Google bỏ tính năng dán hàng loạt.
