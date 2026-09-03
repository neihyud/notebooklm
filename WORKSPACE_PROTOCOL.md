# Workspace Protocol — notebooklm importer

## Bạn đang duyệt cái gì (đọc mục này là đủ để quyết)

File này dài, nhưng phần **binding** chỉ có mục `Authority`. Ba câu dưới đây là bản nén của đúng
mục đó — không thêm gì. Bản đầy đủ ở `## Authority`; nếu hai chỗ lệch nhau thì `Authority` thắng.

1. **Lead tự quyết**: phân rã ticket, thứ tự thực thi, seam đặt ở đâu, nhận hay từ chối handback,
   khi nào cần review seat độc lập.
2. **Phải hỏi bạn**: publish lên Chrome Web Store; thêm quyền mới vào `manifest.json`; gỡ đường
   DOM automation; đổi **hai cam kết bảo mật trong `README.md`** — cam kết *"không có, và không
   cần, bất kỳ khả năng nào để thay đổi chế độ hiển thị video"* và cam kết *"không đọc, không lưu
   cookie nào"*; chạy thử nghiệm ghi lên notebook không phải notebook nháp.
3. **Cấm kể cả khi Lead thấy hợp lý**: xin quyền `cookies`; lưu hay gửi cookie/token ra ngoài
   origin `notebooklm.google.com`; chạy lượt import hàng loạt lên tài khoản bạn như một bước
   "kiểm chứng".

Bạn **đã duyệt ba câu này** ngày 2026-08-23 (`status: accepted` bên dưới). Đổi ý câu nào → nói
câu đó, Lead sửa rồi hỏi lại. Lead muốn thêm ràng buộc mới → phải hỏi, không tự ghi vào `Authority`.

### Đề xuất bổ sung — CHƯA DUYỆT, chưa binding

Lead thấy bốn thứ dưới đây cũng nên phải hỏi bạn, nhưng chúng **không nằm trong** bản `Authority`
bạn duyệt 2026-08-23, nên hiện Lead **không** bị ràng buộc bởi chúng. Muốn nhận thì nói, Lead
chuyển lên `Authority`; không nói thì mục này cứ nằm đây như ghi chép.

- bỏ hoặc đổi nút trong popup;
- đổi hình dạng `selectorOverrides` (bạn có thể đã lưu override — đổi cấu trúc là làm hỏng cài
  đặt đang chạy);
- đổi định nghĩa `done`;
- đổi mặc định trong trang Cài đặt.

> **Vì sao mục này phải tồn tại thay vì Lead sửa lén.** Khối tóm tắt cũ ở đây liệt kê đúng bốn
> gạch đầu dòng trên và gọi chúng là bản nén của `Authority`, trong khi `Authority` nói bốn thứ
> khác hẳn — không mục nào trùng. Ai đọc tóm tắt rồi duyệt là duyệt một danh sách khác cái đang
> binding. Đây chính là **đường dữ liệu song song** mô tả ở cuối file, lần này trong văn bản chứ
> không phải code: một danh sách chạy cạnh danh sách thật, cùng kiểu, không ai đối chiếu.
> Phát hiện 2026-08-24 khi truy transcript xem ai đã đổi `draft` → `accepted`.

- status: accepted   <!-- owner duyệt 2026-08-23 -->
- version: 1
- last_reviewed: 2026-08-23
- applies_to: /home/neihyud/Space/github-me/notebooklm
- readers: Lead; Supervisor khi được giao audit

## Project characteristics

- **criticality**: công cụ cá nhân của owner, chạy trên tài khoản Google của chính owner.
  Chưa phát hành Chrome Web Store (`git remote` chỉ có `neihyud/notebooklm` private).
  *Giả định của Lead — nếu có ý định publish thì mọi mục "external side effects" bên dưới đổi hạng.*

- **dominant risks** (mỗi mục trỏ artifact cụ thể):
  1. **Hằng số chép tay không có đối chứng runtime.** `src/notebooklm/selectors.js` là 135 dòng
     nhãn UI chép tay; hướng RPC sắp thêm rpc id (`izAoDd`) cùng loại. Test ghim một hằng số như
     vậy xanh vĩnh viễn kể cả sau khi Google đổi giá trị — nó chứng nhận thứ ta gõ, không chứng
     nhận thứ server nhận.
  2. **Ba content script gặp nhau trên một tab.** `manifest.json:96` khớp `http://*/*` cho docs;
     `exclude_matches` không chi phối `chrome.scripting.executeScript`. Chrome lấy phản hồi đến
     trước, nên một listener trả lời tin của listener khác là đủ giết cả tab tới khi reload.
     Ba lớp phòng thủ + `test/messaging.test.js` canh — thêm `case` mới **phải** thêm vào `HANDLED`
     (`src/notebooklm/content.js:63`, `src/docs/content.js`).
  3. **Nhận diện lỗi quá rộng huỷ oan lượt chạy đang tốt.** `dialogErrorText()`
     (`src/notebooklm/automation.js:143`) cố tình chỉ đọc `mat-error`/`[role="alert"]`, không quét
     cả hộp thoại — NotebookLM in "Source limit 3/50" như chữ bình thường.
  4. **`host_permissions` gồm `http://*/*` + `https://*/*`** (`manifest.json:22-23`). Mọi thay đổi
     mở rộng thêm quyền là leo thang trên một bề mặt vốn đã rộng tối đa.

- **expensive-to-reverse decisions**:
  - Bỏ đường DOM automation (`src/notebooklm/automation.js`) để chỉ còn RPC. Đường DOM là fallback
    duy nhất khi Google xoay rpc id; gỡ đi là mất lưới an toàn đã chạy tốt.
  - Đổi `manifest.json` sang xin `cookies` permission — không cần thiết cho fetch same-origin từ
    content script, và một khi đã xin thì rất khó rút lại cam kết *"không đọc, không lưu cookie
    nào"* trong `README.md`.
  - Đổi hình dạng dữ liệu Hàng đợi trong `chrome.storage` (`src/common/shared.js:93`): hàng đợi
    tồn tại qua các lần Chrome tắt service worker, nên dữ liệu cũ của owner sẽ gặp code mới.

- **external side effects**:
  - Ghi Nguồn thật vào notebook thật của owner. **Không idempotent**: chạy lại tạo bản trùng, gỡ
    phải xoá tay trong UI. Mọi thử nghiệm RPC phải nhắm một notebook nháp, không phải notebook thật.
  - Ghi file vào `~/Downloads` (`downloads` permission).
  - Gửi request đã xác thực tới backend Google bằng phiên của owner. Rate limit là rủi ro thật;
    lượt chạy hàng loạt (đo thực tế: 89 video) là nơi nó xuất hiện.

## Authority

- **Lead may decide**: phân rã ticket, thứ tự thực thi, seam đặt ở đâu, chấp nhận/từ chối handback,
  khi nào cần review seat độc lập.
- **Human must decide**: publish lên Chrome Web Store hay không; thêm quyền mới vào `manifest.json`;
  gỡ đường DOM automation; đổi **hai cam kết bảo mật trong `README.md`** — cam kết *"không có, và
  không cần, bất kỳ khả năng nào để thay đổi chế độ hiển thị video"* và cam kết *"không đọc, không
  lưu cookie nào"*; chạy thử nghiệm ghi lên notebook không phải notebook nháp.
- **prohibited without explicit authority**: xin `cookies` permission; lưu trữ hay gửi cookie/token
  ra ngoài origin `notebooklm.google.com`; chạy lượt import hàng loạt lên tài khoản owner như một
  bước "kiểm chứng".

> **Vì sao neo bằng câu trích chứ không bằng số dòng.** Ba chỗ trên từng ghi `README.md:107`.
> Dòng đó trôi khi ticket 001 viết lại mục "Cơ chế đẩy vào NotebookLM": cam kết cookie chuyển
> xuống `:119`, rồi `:165` sau ticket 006, còn `:107` thành một câu mô tả `batchexecute`. Ràng
> buộc binding vì thế trỏ vào nhầm dòng suốt nhiều ticket, và ai sửa đúng dòng cam kết sẽ không
> thấy mình cần hỏi ai — đúng chiều hỏng nguy hiểm nhất của một ràng buộc bảo mật. Câu trích trôi
> theo README; số dòng thì không.
>
> Ghi chép lịch sử trong `docs/tickets/001-*` vẫn còn `README.md:107` và **cố ý để nguyên**:
> chúng là biên bản của một ticket đã đóng, không phải ràng buộc đang chạy.

## Task classes

> Seat matrix và mặc định của phòng: `claude/SEATS.md`.

### Tiny / bounded
1 peer seat chạy `/implement`. Verification = `bash test/run.sh`.

### Cross-module / lifecycle-sensitive
Áp cho: bất cứ thay đổi nào chạm `manifest.json`, `src/common/shared.js`, hoặc thêm/sửa `MSG.*`.
1 peer write scope + review seat độc lập trên stable candidate.

### Architecture lock-in
Áp cho: hướng RPC batchexecute, và bất cứ đề xuất nào bỏ một trong hai đường (DOM / RPC).
So sánh alternatives + ghi rõ điều kiện đảo ngược trước khi viết code.

## Verification

- **Cổng bắt buộc**: `bash test/run.sh` — cộng `node --check` toàn bộ `src/**/*.js`.
  Baseline **phải đo trên một cây sạch** (`git stash` hoặc checkout commit đang xét) và ghi kèm sha.
  Con số đo giữa lúc peer khác đang sửa cây thì không tái lập được.
  **Baseline đã đo lại 2026-08-23 bằng `git archive 6c63617 | tar -x -C $(mktemp -d)`** — cây giải
  nén sạch tuyệt đối, không thể lẫn working tree: **295 pass / 0 fail / 8 file**. Một bản trước của
  đoạn này ghi 295/8 là "ảnh chụp giữa chừng công việc của peer khác"; điều đó **sai**, đã bác bằng
  phép đo trên. Sau ticket selector: **339 pass / 0 fail / 9 file**.
  **Cần `npm install` một lần** — `jsdom` là devDependency duy nhất (`test/dom-harness.js`);
  mã chạy trong extension vẫn zero-dep, `manifest.json` không đổi.
- **Cái test suite KHÔNG với tới**: mọi thứ chạm DOM thật của Google hoặc backend thật.
  `src/notebooklm/automation.js`, `src/youtube/transcript.js` và (sắp tới) `rpc.js` không có test
  tự động — và **một bộ shim DOM tự viết chỉ tạo cảm giác an toàn giả** (lý do đã ghi ở đầu
  `tools/verify-live.mjs`). Đường duy nhất là chạy thật: `node tools/verify-live.mjs` cho YouTube;
  NotebookLM cần script tương đương nhưng phải dùng profile Chrome đã đăng nhập của owner.
- **candidate identity**: handback phải ghi commit sha; Lead đọc `git log --oneline` chứ không tin
  status field.
- **independent-review triggers**: diff chạm ≥2 trong {`manifest.json`, `src/common/shared.js`,
  `src/background/service-worker.js`}; hoặc thêm bề mặt mạng mới.

- **correspondence-critical pairs** — cặp cùng kiểu mà **hoán vị nhau vẫn xanh cả suite**, và đọc
  nhầm thì hỏng thật. Ở acceptance, hỏi peer: *hoán vị cặp này thì test nào chết?*
  1. `addTextSource(title, text)` — hai string. Hoán vị → mỗi Nguồn có tiêu đề là cả bản
     transcript. Suite không chạm hàm này.
  2. Trong payload RPC: URL sources đặt url ở `params[0][2]`, YouTube đặt ở `params[0][7]`.
     **KHÔNG CÒN LÀ CẶP** (2026-09-02) — và cách nó đóng lại đáng giữ hơn kết quả.
     Hai oracle độc lập (`docs/notebooklm-rpc-do-duoc-2.md`) cho thấy cả hai loại URL đơn đều đi
     vào ô **7**; ô 2 chỉ thuộc đường *nhiều URL một request*. `slots.url` đã đổi 2 → 7, nên hai
     vế giờ trỏ **cùng một ô** và hoán vị chúng là no-op — đo thật: mutation đổi nhánh YouTube
     sang ghi bằng `slots.url` cho **0 đỏ**, vì nó là mutation tương đương chứ không phải chỗ hở.
     Đây là *sự thật về giao thức*, cùng loại với cặp #8 bên dưới, không phải thiếu test.
     Cặp thay thế, còn nguy hiểm và có lưới: `slots.url ↔ slots.text` — hoán vị cho **2 đỏ**.
  3. `{ ok, error, limit }` trả từ automation (`src/notebooklm/content.js:78`) — `error` và `limit`
     quyết định "dừng cả lượt chạy" hay "bỏ qua mục này".
  4. `MSG.NLM_ADD_URL` vs `MSG.NLM_ADD_TEXT` — **ĐÃ CÓ LƯỚI Ở CẢ HAI TẦNG** (2026-08-23).
     Lịch sử đáng giữ: sau ticket 002 với 23 cặp hoán vị của peer, cặp này **vẫn hở** — Lead hoán
     vị hai nhãn `case` trong router `src/notebooklm/content.js` và cả 418 assertion vẫn xanh.
     Bịt xong: hoán vị lại cho **6 đỏ**. Lưới đúng phải assert *hàm nào được gọi và với đối số
     nào* (spy trên `NBLM_AUTOMATION`), không assert giá trị trả về — hai nhánh trả cùng hình
     dạng `{ok, error}` nên assert kết quả cho xanh giả.
     Bài học chung: **danh sách hoán vị của peer là bản đồ chỗ nó đã soi, không phải bản án.**
  5. **Một hình dạng hở mà nghi thức hoán vị KHÔNG đóng được** (đo trên ticket 001-RPC, 2026-08-24).
     Khi cả hai vế của cặp đều là *bản đồ ngoại sinh của chính ta* — `paramSlots.sources ↔
     notebookId` (0↔1), `slots.url ↔ slots.youtubeUrl` (2↔7) — mọi assertion buộc phải đọc lại
     chính bản đồ vừa bị hoán vị, nên hoán vị không sinh ra đỏ.
     **Ví dụ thứ hai đã hết hiệu lực 2026-09-02** (xem cặp #2), nhưng hình dạng thì không, và
     đơn thuốc kê ở đoạn dưới đã được nghiệm thu bằng chính ca đó: thứ đóng được nó là *một
     oracle độc lập nói con số đó đúng*, không phải thêm assertion. Lần này có hai. Ghim con số vào test chỉ là chép
     tay hằng số khoác áo test, và ràng buộc "không ghim id" cấm đúng việc đó.
     Ở acceptance **đừng đòi peer bịt bằng test**. Đòi hai thứ khác: một oracle độc lập nói con số
     đó đúng, và một cơ chế phát hiện lúc chạy khi nó sai. "Không đóng được bằng test" là câu trả
     lời hợp lệ — im lặng thì không.

  Trạng thái đo thật 2026-08-23, **sau** ticket selector — trước đó cả bốn cặp dưới đều hoán vị mà suite vẫn xanh:
  5. `S.css.urlInput` ↔ `S.css.textArea` — **ĐÃ CÓ LƯỚI**. Lead tự hoán vị: **5 test đỏ**, gồm
     "transcript phải vào ô văn bản" và "URL phải vào ô URL".
  6. `S.submit` ↔ `S.cancel` — **ĐÃ CÓ LƯỚI**. Lead tự hoán vị: **3 test đỏ**. Cặp nguy hiểm nhất:
     hoán vị thì mọi import lặng lẽ bị *huỷ*, mà `awaitDialogResolution` vẫn trả `{ok:true}` vì
     hộp thoại có đóng thật.
  7. `addTextSource(title, text)` (= cặp 1 ở trên) — **ĐÃ CÓ LƯỚI** từ peer HV5. Cặp 1 nói "suite
     không chạm hàm này"; điều đó không còn đúng.
  8. `S.websiteChip` ↔ `S.youtubeChip` — **HỞ, nhưng hở có lý do đúng**: giao diện hiện tại chỉ có
     MỘT nút "Trang web" gánh cả hai, nên `youtubeChip` không khớp gì và thứ tự hai mảng không
     quan sát được. Là sự thật về giao diện, không phải thiếu test. Google tách lại thành hai nút
     thì cặp này thành hở thật — kiểm lại lúc đó.
  9. `downloadItem` `index` ↔ `resolved.id` — **ĐÃ CÓ LƯỚI** (ticket 003, 6 đỏ).
  10. `done` ↔ `failed` trong `runQueue` — **ĐÃ CÓ LƯỚI** (2026-08-23). Lịch sử: sau 23 cặp hoán
     vị của peer, cặp này **vẫn hở** — Lead đổi chỗ hai dòng `done++`/`failed++`, cả 513 assertion
     vẫn xanh. Bịt xong: 6 đỏ. Có **ba** chỗ đếm chứ không phải hai — chỗ thứ ba nằm trong khối
     `catch`, và nó là cặp xanh giả riêng. Lưới đúng phải bắt câu gửi vào `chrome.notifications`
     và ghim **số nào đứng chỗ nào**; ca "toàn thành công" một mình không đủ.

  11. `REPORT.SUBMIT_NOT_FOUND` ↔ `REPORT.URL_INPUT_FALLBACK` ở call site — **ĐÃ CÓ LƯỚI**
     (ticket 004, 2026-08-23). Lead chọn cặp này *đúng theo hình dạng dưới đây* — bản chụp chẩn
     đoán là một đường dữ liệu song song điển hình — và lần đầu trong bốn lượt, cặp **không hở**:
     6+ đỏ, dẫn đầu là `mọi khoá phải mang đúng nội dung mà tên nó hứa`. Peer 004 đã tự bịt ở
     HV1 của nó. Bài học ngược lại: hình dạng dưới đây là **chỗ để tìm**, không phải lời tiên
     đoán chắc chắn — khi peer đã biết hình dạng đó thì nó bịt được.

  12. `listNotebooks.slots.id` ↔ `.title` — ticket 011, 2026-09-03. **KHÔNG đóng được bằng test**,
     cùng hình dạng với cặp #5: cả hai vế là *bản đồ ngoại sinh của chính ta*, nên mọi fixture
     dựng lại theo `slots` và hoán vị nó thì hai vế đảo cùng nhau — đo thật **45 pass / 0 fail**.
     Đơn thuốc của cặp #5 áp đúng: không ghim tay một con số ô. Thứ đứng thay là runtime detection
     — `idPattern` (regex hình dạng id) từ chối một chuỗi có khoảng trắng làm id, nên đọc nhầm ô
     cho dropdown rỗng chứ không ghi một tiêu đề vào `notebookUrl`. Mutation trên chính cơ chế đó:
     nhận-tất → 4 đỏ, mẫu-hỏng-thì-nhận → 1 đỏ.

  13. `NBLM_ACCOUNTS.accountSlots.email` ↔ `.name` — ticket 013, 2026-09-03. **Cùng bệnh, cùng
     đơn thuốc** như cặp #12, đo trước khi viết test nên không mất công dò lại: 0 đỏ khi hoán vị.
     Cơ chế thay thế là `looksLikeEmail()` (regex nhận diện email) — 1 đỏ khi mẫu hỏng thì nhận
     thay vì từ chối. Đáng ghi vì đây là **lần thứ hai liên tiếp cùng một lớp hằng số ngoại sinh
     (một mảng tuple từ backend Google, vị trí ô do ta suy luận) tái diễn đúng hình dạng** — bản
     đồ ngoại sinh của ta luôn dễ vỡ theo cách này, không phải một sự cố cá biệt.

  14. **Trọng tâm thật của ticket 013**: token `at` ↔ `authuser` trong `google-accounts.js`.
     KHÁC hai cặp trên — đây **ĐÃ CÓ LƯỚI**, vì hai giá trị này không ra từ cùng một bản đồ ngoại
     sinh; chúng là hai kết quả của hai lượt mạng khác nhau mà không có gì trong kiểu dữ liệu
     buộc chúng khớp. Gỡ phép khớp `authuser` trong `usable()` → **5 đỏ** trên
     `google-accounts.test.js` + `notebooklm-notebooks.test.js` (gốc 94/0). Đây cũng là cặp mà
     `anyNotebookLmTab()` phía service worker suýt lặp lại hở — tự soát sau khi giao bắt được nó
     (xem cuối ticket 013), lưới riêng ở `service-worker-accounts.test.js` (gốc 22/0, đỏ 3–4).

### Hình dạng lỗi mà nghi thức hoán vị của peer bỏ sót

Đo hai lượt liên tiếp (002 và 003, 2026-08-23). Cả hai lần, peer thử 23 cặp và bịt hết; cả hai
lần cặp Lead chọn ngoài danh sách đó lại **hở với toàn bộ suite xanh**. Hai cặp ấy khác nhau về
nội dung nhưng **cùng một hình dạng**:

> Một **đường dữ liệu song song** — chạy cạnh đường chính, mang thông tin cùng kiểu, và đổ ra
> một nơi mà không assertion nào nhìn tới.

- 002: `MSG.NLM_ADD_URL` ↔ `MSG.NLM_ADD_TEXT` ở router. Đường chính (`{ok, error}`) vẫn đúng
  hình dạng nên mọi assertion soi *kết quả* đều xanh; cái sai nằm ở *hàm nào được gọi*.
- 003: `done++` ↔ `failed++` trong `runQueue`. Đường chính (`STATUS.DONE`/`STATUS.ERROR` ghi qua
  `patchItem`) vẫn đúng nên mọi assertion soi *hàng đợi* đều xanh; cái sai chỉ đổ vào
  `chrome.notifications` — thứ duy nhất người dùng đọc khi lượt chạy kết thúc lúc popup đã đóng.

**Cách dùng ở acceptance.** Đừng chọn cặp bằng cách đọc danh sách của peer rồi tìm cái na ná.
Hỏi ngược: *thông tin này còn chảy đi đâu nữa ngoài chỗ test đang soi?* Ứng viên điển hình trong
repo này — thông báo `chrome.notifications`, badge `chrome.action.setBadgeText`, HUD gửi qua
`chrome.tabs.sendMessage`, tên file tải về, và câu chữ trong `error` mà popup hiển thị. Mỗi thứ
đó là một đường song song; đường chính đúng không nói gì về chúng.

## Project-specific anti-patterns

- **signal**: handback báo "đã thêm test cho X" mà X là hằng số ngoại sinh (nhãn UI, rpc id, selector).
  **evidence required**: chỉ ra cơ chế phát hiện **lúc chạy** khi giá trị đó lệch, không phải test.
  **allowed response**: nhận nếu có runtime detection + fallback; trả lại nếu chỉ có assertion ghim.

- **signal**: "chạy thử trên notebook của tôi rồi, thấy ok".
  **evidence required**: tên notebook nháp, số Nguồn trước/sau, và ảnh chụp hoặc log request.
  **allowed response**: từ chối mọi kiểm chứng chạm notebook thật.

- **open question**: chưa có `docs/agents/issue-tracker.md`; ticket hiện để dưới `docs/tickets/`.
  Owner chốt tracker thật thì chuyển.

## Protocol evolution
- Supervisor ghi causal evidence; Human duyệt thay đổi `Authority`; giữ version history.
