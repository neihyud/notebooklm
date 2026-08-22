# Workspace Protocol — notebooklm

## Status
- owner: hiennd
- status: accepted
- version: 9
- last_reviewed: 2026-08-22
- applies_to: /home/neihyud/Space/github-me/notebooklm
- readers: Lead; Supervisor khi được giao audit

## Project characteristics

- **criticality**: công cụ cá nhân, cố ý không phát hành lên Chrome Web Store
  (`docs/adr/0001-chi-phan-phoi-load-unpacked.md`). Hỏng thì phiền, không gây hại cho ai khác.
- **dominant risks**:
  - *Mất dữ liệu âm thầm qua Nguồn gộp.* `packSources()` (`src/common/shared.js`) gom nhiều
    video vào một nguồn; 54 mục trong một nguồn trông y hệt 55. ADR 0008 đòi bảng tổng kết
    liệt kê mục rớt — nếu ràng buộc đó không có test canh, quyết định này nuốt dữ liệu.
  - *Runner sai trông y hệt test đỏ.* `node --test test/` trên Node 22.23.1 không duyệt thư
    mục: nó resolve `test/` thành module và chết bằng `MODULE_NOT_FOUND`. Đã xảy ra thật trong
    repo này; `test/run.sh` giờ liệt kê file rõ ràng. Hệ quả ngược cũng đúng — một suite chạy
    0 file vẫn exit 0.
  - *Toàn bộ đường đẩy dựa trên DOM của một sản phẩm không có API.* Mọi nhãn và selector phải
    tập trung ở `src/notebooklm/selectors.js` và ghi đè được từ trang Cài đặt. Selector rải
    rác ra file khác là nợ không trả được.
  - *Mượn header `Authorization: SAPISIDHASH` ở MAIN world* (`src/youtube/page-bridge.js`).
    Chỉ dùng cho liệt kê playlist, không cho transcript (ADR 0003). Thêm một op vào `AUTH_OPS`
    (`src/youtube/bridge-protocol.js`) là quyết định của owner, không phải của Lead.
- **expensive-to-reverse decisions**:
  - Nguồn đã đẩy vào NotebookLM thì extension **không sửa và không xoá được**. Tên nguồn đặt
    sai là sai vĩnh viễn — đó là lý do ADR 0010 cấm mẫu số trong tên.
  - Quota 50 nguồn/notebook ở bản miễn phí: tiêu rồi phải vào NotebookLM xoá tay.
- **external side effects**: ghi nguồn vào notebook thật của owner; ghi file vào thư mục tải
  về (`downloadDir` trong `DEFAULTS`); đọc phiên đăng nhập Google trong trình duyệt của owner.

## Authority

- **Lead may decide**: nội dung và thứ tự ADR, ranh giới module, thứ tự ticket, tiêu chí
  nghiệm thu từng ticket.
- **Human must decide**: đảo bất kỳ ADR nào đã `accepted`; mọi lần chạy import thật vào một
  notebook có dữ liệu; **cho một op mới của `page-bridge.js` mượn header `Authorization`**; xoá
  code đã có trong cây làm việc.
  - Ranh giới ở đây là **auth, không phải số lượng op**. `page-bridge.js` chạy ở MAIN world nên
    nó *có thể* mượn `SAPISIDHASH` của phiên đăng nhập; danh sách op được mượn là `AUTH_OPS`
    trong `src/youtube/bridge-protocol.js`, và chỉ owner mới thêm được vào danh sách ấy. Thêm
    một op **không** vào `AUTH_OPS` — đọc dữ liệu mà một tab ẩn danh cũng đọc được — là quyết
    định của Lead. Câu chữ cũ ("mở rộng phạm vi `page-bridge.js`") rộng hơn ý định thật và đã
    chặn nhầm một việc vô hại ở ticket 005.
- **prohibited without explicit authority**: chạy hàng đợi thật vào notebook của owner để
  "thử"; thêm bất kỳ đường nào chạm YouTube Studio hoặc API sửa video.

## Task classes

### Tiny / bounded
Hàm thuần trong `src/common/`, `src/youtube/srt.js`, `src/docs/markdown.js`: 1 peer chạy
`/implement`, test đi kèm trong cùng ticket.

### Cross-module / lifecycle-sensitive
`src/background/service-worker.js` (hai hàng đợi, Sổ đã import, gộp nguồn) chạm cả bốn ADR
0005–0009 cùng lúc: 1 peer với write scope, rồi 1 review seat trên stable candidate.

### Architecture lock-in
Bất cứ thay đổi nào chạm `page-bridge.js` hoặc đảo một ADR: Lead ra verdict, owner quyết.

## Verification

- `bash test/run.sh` phải xanh **và** phải in `tests N` với N > 0. Suite chạy 0 file vẫn
  exit 0 — coi đó là đỏ.
- **Ticket nào đụng `test/helpers/fake-dom.js` phải chạy `node tools/audit-fake-dom.mjs` và dán
  kết quả.** Cả suite chạy trên cây giả ấy, nên một chỗ nó lệch DOM thật là một lô test xanh giả:
  ticket 016 tìm được **38 chỗ lệch trên 93 phép**, trong đó `children` là Array-snapshot thay vì
  `HTMLCollection` sống (sáu chỗ trong `src/` dùng `Array.from` *chỉ vì* tính sống ấy, và cây giả
  cũ không phạt được ai gỡ nó), `getBoundingClientRect` vắng mặt nên nhánh thật của
  `sidebar.js:178` chưa test nào đi qua, `addEventListener` nuốt lặng đối thứ ba nên `{once}` và
  `capture` vô tác dụng trong mọi test. Công cụ thoát 1 khi còn lệch chưa đánh dấu cố ý.

  Ranh giới cho chỗ **cố ý** để cây giả thiếu: **property vs phương thức**. Property vắng mặt trả
  `undefined` rồi chạy tiếp — im lặng, phải vá. Phương thức vắng mặt ném ngay — ồn ào, để vắng
  được.
- **Fixture một phần tử không phân biệt được bất kỳ phép rút gọn nào trên tập.** `max`, `min`,
  `[0]`, `at(-1)`, `some`, `every` cho cùng một kết quả ở n=1. Ticket 017: `Math.max(...widths)`
  đổi thành `Math.min` mà suite vẫn **xanh 691/691**, vì test mới dựng đúng **một** panel — trong
  khi trang thật có **ba** (0px / 494px / 0px) và hoán vị ấy dựng lại đúng con bọ ticket vừa gỡ.
  Chỗ nào code rút một tập thành một số hay một boolean thì fixture phải có **≥2 phần tử khác nhau
  đôi một**, và phần tử "đặc biệt" **không được nằm ở đầu hay cuối** — nằm ở đầu thì `[0]` lọt,
  nằm ở cuối thì `at(-1)` lọt.
- **`tools/verify-live.mjs` và `tools/verify-docs.mjs` là cổng thứ hai, chạy trên Chrome thật.**
  Ticket nào chạm lớp YouTube hoặc lớp tài liệu phải chạy và dán output. Lý do đo được: hai lỗi
  hạng "chỉ lộ ra ở Chrome" đã lọt qua suite xanh — `.filter` trên `children` (ticket 009, suite
  xanh 537/537) và `content.js` thiếu `install(root)` lúc nạp (ticket 010, suite xanh 609/609) —
  và cả hai đều làm **Bảng chọn không bao giờ mở được**. Ticket 012 dựng cổng này; ngay lượt chạy
  đầu nó tìm ra đường DOM hỏng trên một lớp video và `get_transcript` đã chết hẳn.
- Đo lúc viết protocol: 17/17 xanh (`test/shared.test.js`), Node 22.23.1.
- Test toàn vẹn phải được kiểm ngược bằng cách cố tình phá thứ nó canh, và phải in ra chi
  tiết lệch. Một test toàn vẹn chưa từng thấy đỏ là một test chưa biết có tác dụng không.
- **correspondence-critical pairs** — cặp cùng kiểu mà hoán vị nhau vẫn cho kết quả *hợp lệ*,
  nên suite xanh mà hành vi sai:
  - `start` ↔ `end` trong một segment (`src/youtube/srt.js`): hoán vị vẫn ra SRT parse được.
  - `itemId` ↔ `notebookId` trong `ledgerKey()`: hoán vị vẫn ra khoá hợp lệ, và chống trùng
    lặp sai *âm thầm* — không có triệu chứng nào ở lần chạy đầu.
  - `title` ↔ `channel` trong `contextHeader()`: nguồn vẫn dựng, chỉ là NotebookLM trích dẫn
    sai tên kênh.
  - dấu phân cách mili-giây `,` (SRT) ↔ `.` (VTT) trong `clock()`: file sai định dạng vẫn
    mở được ở nhiều player.
  - ô **tiêu đề** ↔ ô **nội dung** của hộp thoại thêm nguồn: hoán vị vẫn cho một lần import
    "thành công", chỉ là Nguồn mang tên bằng cả transcript — và tên Nguồn là vĩnh viễn
    (ADR 0010), ADR 0009 lại đọc tên để biết phần nào đã có. Phát hiện ở ticket 004.
  - hai **ngân sách chờ** cùng kiểu số (`formTries` ↔ `titleTries`): hoán vị không làm hỏng
    lần chạy nào, chỉ cộng vài phút cho mỗi playlist dài — loại chậm không ai truy ra nguyên
    nhân. Cặp này **đã từng hở thật**: suite 215/215 vẫn xanh sau hoán vị (ticket 004).
    Canh **quan hệ** giữa hai ngân sách, đừng khoá con số — test khoá số chết mỗi lần chỉnh nhịp.
  - `url` của **Mục hàng đợi** ↔ `url` của **trang** trong `mergeMeta()`
    (`src/background/importer.js`): trên một trang watch, link vừa bấm chuột phải và tab đang mở
    là hai video khác nhau và **cả hai URL đều hợp lệ**. Hoán vị dựng một Nguồn mang transcript
    video A với `- Link gốc:` trỏ video B — chỗ người dùng nhấn để kiểm chứng trích dẫn. Cặp này
    **đã từng hở thật**: suite 314/314 vẫn xanh sau hoán vị (ticket 005). Bất biến cần canh:
    **nội dung theo trang, danh tính theo Mục** (`videoId` và `url` là danh tính).
  - hai **ngưỡng tỉ lệ** đi ngược chiều nhau (`KEEP_RATIO` 0.9 ↔ `KNOWN_RATIO` 0.5 trong
    `src/docs/extract.js`): hoán vị làm hỏng cả hai đầu — "giữ gần trọn" tụt xuống một nửa nên
    thân bài bị xén, còn selector theme quen thuộc thì bị bỏ qua ở đúng trang nó dành cho. Kết
    quả vẫn ra Markdown có tiêu đề, có khối code, **nhìn hoàn toàn hợp lý**, chỉ thiếu nội dung —
    và ADR 0002 gộp nhiều trang vào một Nguồn, nên thứ đến tay người dùng là một Nguồn trông đầy
    đủ với vài trang bị xén. Cặp này **đã từng hở thật**: suite 486/486 vẫn xanh (ticket 008).
  Mỗi ticket chạm một cặp trên đây phải trả lời được: **test nào chết khi hoán vị?**

- **Hình lặp lại: hai con số cùng kiểu, mỗi số một vai trò.** Ticket 004 (`formTries` ↔
  `titleTries`) và ticket 008 (`KEEP_RATIO` ↔ `KNOWN_RATIO`) cho cùng hình: hai hằng số cạnh
  nhau, cùng đơn vị, hoán vị **không làm hỏng lần chạy nào** — chỉ làm sai kết quả hoặc làm chậm.
  Cả hai lần suite đều xanh, và cả hai lần peer đã tự ghi trong "không phủ được" rằng *con số*
  chưa được kiểm chứng — trong khi thứ lọt là **quan hệ giữa hai con số**.

  Ticket nào đưa vào từ hai hằng số cùng đơn vị trở lên phải trả lời: **test nào chết nếu hoán vị
  chúng?** Và test ấy phải canh **vai trò**, không khoá giá trị — chỉnh ngưỡng sau khi có trang
  thật là việc sẽ xảy ra, test khoá số sẽ chết oan lúc đó.

- **Hình lặp lại: một thứ của video A còn sống trên trang video B.** Hai ticket liên tiếp cho
  cùng hình dạng này, nên nó không còn là một cặp lẻ mà là một chỗ phải soi ở mọi ticket sau:
  - ticket 005 — `mergeMeta()` dựng Nguồn mang transcript video A với `- Link gốc:` trỏ video B;
  - ticket 006 — SPA navigate không dọn panel, panel video A treo trên trang video B và **bấm mốc
    vẫn nhảy được** vì YouTube dùng lại đúng một thẻ `<video>`.

  Cả hai lần: suite xanh (314/314 và 362/362), màn hình "chạy được", không một dấu hiệu nào.
  YouTube là SPA — mọi trạng thái gắn với *một video cụ thể* mà sống lâu hơn một lần điều hướng
  đều là ứng viên. Ticket nào giữ trạng thái theo video phải trả lời: **cái gì dọn nó khi đổi
  video, và test nào chết nếu bỏ chỗ dọn ấy đi?**

## Project-specific anti-patterns

- **signal**: một mục biến mất khỏi Nguồn gộp mà bảng tổng kết không có dòng nào cho nó.
  **evidence required**: log của lần chạy, kèm số mục vào và số mục ra.
  **allowed response**: dừng hàng đợi; không "chạy lại cho chắc".
- **signal**: một hàm trả về **cả dữ liệu lẫn chữ hiện ra** (ví dụ `confirmation()` trả `counts`
  *và* `lines`), mà test chỉ đọc phần dữ liệu.
  **evidence required**: hoán vị hai **nhãn** trong khi giữ nguyên biến — không đổi một con số
  nào — rồi chạy suite. Xanh là hở.
  **open question**: phần nào của output này người dùng thực sự đọc để ra quyết định?
  **allowed response**: đòi test canh quan hệ *nhóm ↔ câu*, neo bằng một mảnh ngắn định danh
  được nhóm chứ không khoá cả câu (câu chữ còn sửa). Fixture phải cho các con số **khác nhau đôi
  một**, nếu không một hoán vị có thể không làm lệch dòng nào. Phát hiện ở ticket 007: bảng xác
  nhận nói "3 video không công khai" về đúng những video private của người dùng, suite 431/431
  vẫn xanh — và bảng ấy tồn tại đúng để người dùng quyết định trước khi tiêu quota nguồn.
- **signal**: handback nói "test xanh" mà không kèm dòng `tests N`.
  **evidence required**: output thật của `bash test/run.sh`.
  **allowed response**: trả lại ticket, không nghiệm thu.
- **signal**: một selector xuất hiện ngoài file `selectors.js` **của chính lớp đó**.
  Mỗi lớp có file riêng — `src/youtube/selectors.js` nạp trên tab YouTube,
  `src/notebooklm/selectors.js` nạp trên tab NotebookLM. Gom hai lớp về một file là sai
  hướng: nó nạp selector của lớp này vào tab của lớp kia.
  **allowed response**: từ chối nghiệm thu; gom về đúng file của lớp là một phần của ticket.

## Protocol evolution

Owner duyệt 2026-08-21; section `Authority` có hiệu lực.

**v9 (2026-08-22)** — thêm luật *fixture một phần tử* vào Verification sau ticket 017, và ghi
`tools/verify-live.mjs` thành cổng thứ hai (Chrome thật) bên cạnh `test/run.sh`. Không đụng
`Authority`.

**v8 (2026-08-22)** — thêm cổng `tools/audit-fake-dom.mjs` vào Verification sau ticket 016 (38 chỗ
lệch trên 93 phép giữa cây giả và Chromium 151), kèm ranh giới *property vs phương thức* cho chỗ
cố ý để thiếu. Không đụng `Authority`.

**v7 (2026-08-22)** — thêm cặp `KEEP_RATIO` ↔ `KNOWN_RATIO` và nâng nó thành hình lặp lại *"hai
con số cùng kiểu, mỗi số một vai trò"* (ticket 004 và 008 cho cùng hình; cả hai lần suite xanh, cả
hai lần peer tự ghi rằng *con số* chưa kiểm chứng trong khi thứ lọt là *quan hệ*). Không đụng
`Authority`.

**v6 (2026-08-22)** — thêm anti-pattern *"dữ liệu có test, chữ hiện ra thì không"* sau ticket 007
(hoán vị hai nhãn của bảng xác nhận, suite 431/431 vẫn xanh). Không đụng `Authority`.

**v5 (2026-08-22)** — thêm mục *"Hình lặp lại: một thứ của video A còn sống trên trang video B"*
sau khi ticket 006 cho đúng hình của ticket 005 lần thứ hai (panel không được dọn khi SPA
navigate; suite 362/362 vẫn xanh khi xoá `controller.close()`). Ghi thành hình để soi, không
thành cặp lẻ để tra. Không đụng `Authority`.

**v4 (2026-08-22)** — owner duyệt: siết `Human must decide` về `page-bridge.js` từ "mở rộng phạm
vi" thành "cho một op mới mượn header `Authorization`", và neo nó vào `AUTH_OPS` trong
`src/youtube/bridge-protocol.js` thay vì vào tên file. Nguyên do: câu chữ v3 chặn nhầm việc thêm
một op không-auth ở ticket 005, trong khi ý định luôn là *đừng dùng auth cho transcript* (ADR
0003). **Đụng `Authority`; owner duyệt 2026-08-22.**

**v3 (2026-08-22)** — thêm cặp `url` Mục ↔ url trang (`mergeMeta`), hở thật ở ticket 005 và
suite 314/314 vẫn xanh. Ba ticket liên tiếp (004, 005) cho cùng một hình: peer guard đúng nguy cơ
ở tầng nó đang viết, rồi để hở chính nguy cơ ấy ở tầng dưới. Không đụng `Authority`.

**v2 (2026-08-22)** — thêm hai cặp correspondence-critical tìm được lúc nghiệm thu ticket 004,
và sửa anti-pattern selectors từ số ít sang "file của chính lớp đó" (ticket 002 cho thấy hai
lớp cần hai file). Không đụng `Authority`, nên không cần owner duyệt lại. Supervisor ghi causal evidence khi
một pattern lặp lại; đổi Authority thì owner duyệt lại và tăng `version`.
