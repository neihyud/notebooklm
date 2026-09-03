# 010 — Hội thoại AI: đúng cái vấn đề extension này sinh ra để chữa, và đường docs đang chạy nhầm ở đó

- status: draft — **chưa giao**
- class: **cross-module** → chạm `src/common/shared.js` (thêm một giá trị vào `KIND`) và
  `src/background/service-worker.js` (một nhánh trong `runQueue`). `WORKSPACE_PROTOCOL.md` xếp
  *"bất cứ thay đổi nào chạm `src/common/shared.js`"* vào hạng này: cần review seat độc lập.
- tách từ: buổi đọc hai extension đang bán (`docs/notebooklm-rpc-do-duoc-2.md`). Sourclip có
  đường này; ba đường thu khác của nó (PDF, Reddit, X) đã cân và bỏ — xem "Không thuộc phạm vi".
- blocked-by: **Bước 0** — một phép đo trên trang thật, xem dưới. Không phải phép đo của owner
  như 008/009; peer tự chạy được.
- không đụng: `rpc.js`, `automation.js`, `selectors.js`, `manifest.json`.

## Bối cảnh

Trang ChatGPT/Claude/Gemini/Perplexity là **ca cực đoan của đúng vấn đề `README.md` mô tả**, và
nó hỏng theo cả hai kiểu cùng lúc:

- máy chủ Google fetch cái URL đó và nhận về **tường đăng nhập** — nó không có phiên của bạn;
- kể cả vào được thì thân bài **dựng bằng JS**, nên HTML thô chỉ là cái khung.

Đường chữa đã có nguyên vẹn: trích ngay trong trình duyệt bạn, nơi trang đã render đầy đủ và bạn
đã đăng nhập. Đó là câu mở đầu README, áp cho một loại trang mà extension chưa nhắm tới.

> **Cập nhật 2026-09-03 — nửa đầu Bước 0 đã đo, và kết quả rộng hơn ticket này.**
> Owner báo nút nổi hiện trên *mọi* trang, không riêng site chat. Đo bằng brave headless + CDP
> (`detect()` thật trên trang thật): BBC News hiện nút với 24 "trang", Wikipedia với **750**.
> Nguyên nhân: `detect()` không có ngưỡng điểm — `rate()` tính điểm rồi `detect()` **vứt đi**,
> chỉ giữ `container`. Đã xử lý bằng cách **tắt sẵn** `docsLauncher` (bảng đo đầy đủ trong
> `src/common/shared.js`), *không* bằng ngưỡng: `onCurrentPage` đúng ở cả BBC lẫn Wikipedia,
> bề ngang thì giết MDN. Nghĩa là mục 4 dưới đây (**số phận nút docs trên site chat**) **mất
> tính khẩn** — nút không còn tự hiện ở đâu nữa. Phần còn lại của Bước 0 vẫn cần đo: khi owner
> **bật lại** nút, nó dựng cây gì trên chatgpt.com.

## Bước 0 — cái phải đo TRƯỚC, vì đường docs có thể đang chạy ở đó rồi

Content script docs khớp `http://*/*` + `https://*/*`, và `exclude_matches` chỉ loại YouTube,
NotebookLM, Google Search, Gmail, Slack. **chatgpt.com và claude.ai không nằm trong danh sách
loại trừ** — nên `src/docs/content.js` đang được tiêm vào đó, và `detect()` đang chạy.

Giả thuyết (chưa đo, và ĐỪNG viết code trước khi đo): thanh bên ChatGPT là một `<nav>` chứa danh
sách `<a href="/c/…">` cùng origin. Đem cho `rate()` (`src/docs/sidebar.js:99`) thì nó ăn gần hết
các tín hiệu:

| tín hiệu | điểm | thanh bên ChatGPT |
|---|---|---|
| có link trỏ về chính trang đang mở | **+15** | có, khi đang xem một hội thoại trong danh sách |
| cột hẹp (`< 42%` bề ngang) | +8 | có |
| thẻ `nav`/`aside` | +4 | có |
| có `ul li` | +4 | nhiều khả năng |

Nếu đúng, nút nổi **"→ NotebookLM · N trang"** đang hiện sẵn trên ChatGPT, và bấm vào là mời
người dùng import **danh sách hội thoại** của mình như thể chúng là các trang tài liệu. Bấm
*Thêm N trang* thì mỗi hội thoại đi qua `extract.js` nấc 1 (fetch → nhận SPA shell → mỏng) rồi
rơi xuống nấc 2 (**mở tab ẩn dựng lại từng trang một**).

**Đo bằng gì:** mở chatgpt.com và claude.ai đã đăng nhập, xem nút có hiện không và `N` là bao
nhiêu; nếu hiện thì bấm mở bảng chọn và chụp lại cây nó dựng ra. **Không bấm *Thêm N trang*** —
đó là ghi thật vào notebook.

Kết quả Bước 0 quyết định ticket này là *"thêm một tính năng"* hay *"sửa một đường đang chạy
nhầm chỗ, rồi mới thêm"*. Hai chuyện khác nhau về phạm vi và về mức khẩn.

## Vì sao đường docs là seam SAI cho hội thoại, dù nó chạy được

Đường docs dựng trên một giả định về hình dạng công việc: **nhiều trang, mỗi trang phải đi lấy
về**. Hội thoại AI ngược hẳn: **một hội thoại, đã render sẵn ngay trước mặt**.

Hệ quả thật, không phải chuyện thẩm mỹ kiến trúc:

1. **Nấc 2 mở một tab ẩn cho mỗi mục.** Với docs đó là đường dự phòng hiếm khi chạy; với chat
   thì nó là đường **luôn luôn** chạy, vì fetch không bao giờ lấy được thân bài. Hai mươi hội
   thoại = hai mươi lần dựng lại trang, trên một site có mọi lý do để coi đó là scraping.
2. **Hội thoại hiện tại thì không cần lấy về gì cả.** `NBLM_DOCS_EXTRACT.fromLive()`
   (`src/docs/extract.js:212`) đã đọc DOM trang đang mở, và `MSG.DOCS_READ` đã dùng nó. Seam
   đúng nằm ở đây, không ở đường sidebar.
3. **Trích generic làm mất thứ đáng giá nhất của một hội thoại: ai nói câu nào.** `pickRoot()`
   chấm điểm theo chữ trong `p/li/pre/td/h*` trừ chữ trong link — nó sẽ chọn được khối hội
   thoại, nhưng trả về một khối văn xuôi liền mạch **không phân biệt người hỏi với máy đáp**.
   Đổ vào NotebookLM thì nó trích dẫn câu của bạn như thể đó là kết luận của mô hình.

Điểm 3 là lý do ticket này không phải một dòng `exclude_matches`. Repo đã có tiền lệ đúng cho
nó: đường YouTube không đổ transcript trần vào Nguồn mà dựng **header ngữ cảnh** (tiêu đề, kênh,
link gốc, thời lượng, mức riêng tư) cộng mốc `[mm:ss]` trong thân bài, để NotebookLM trích dẫn
được đúng chỗ. Hội thoại cần đúng cơ chế đó, với "ai nói" thay cho "phút thứ mấy".

## Kết quả cần có

### 1. `KIND.CHAT`, và một nút trên chính trang hội thoại

Thêm `CHAT: 'chat'` vào `KIND` (`src/common/shared.js:56`). Một nút — cùng kiểu nút nổi của
docs — trên trang hội thoại, nhãn nói rõ nó lấy **hội thoại đang mở**, không phải cả danh sách.

### 2. Dò lượt nói theo dấu hiệu SEMANTIC, không theo class hash

Đây là chỗ dễ chép sai nhất từ oracle. Sourclip nhắm cả những thứ như `[class*="fbb737a4"]`,
`[class*="dad65929"]` — **class hash sinh ra lúc build của Claude.ai**. Chúng đổi ở lần deploy
kế tiếp, và chép vào đây là nhập khẩu đúng loại hằng số mà `sidebar.js` được viết ra để tránh:
nó **không** nhắm theo tên theme mà chấm điểm theo hành vi.

Neo theo thứ mang **nghĩa** và do đó ổn định hơn hẳn:

- ChatGPT: `[data-message-author-role]` — thuộc tính nói thẳng vai người nói;
  `[data-message-id]`, `[data-turn-id]` phụ trợ.
- Các site khác: **đo rồi hãy ghi**. Không có dấu hiệu semantic thì **bỏ site đó khỏi bản đầu**,
  đừng bù bằng class hash.

Danh sách dấu hiệu vào một bảng dữ liệu **owner ghi đè được**, cùng cơ chế `selectorOverrides` /
`rpcOverrides` đang có. Không ghim trong code.

**Không có dấu hiệu vai nói thì KHÔNG trích.** Nói thẳng ra ("không đọc được cấu trúc hội thoại
trên trang này") — im lặng trả về một khối văn xuôi mất vai là đúng chế độ hỏng câm mà extension
này tồn tại để chống.

### 3. Nguồn dựng ra phải mang vai nói và ngữ cảnh

Header ngữ cảnh (tiêu đề hội thoại, site, link gốc, thời điểm trích) + mỗi lượt nói mở đầu bằng
vai. Dùng lại `src/docs/markdown.js` nguyên vẹn cho phần thân — hội thoại AI dính **đúng** cái
bẫy nó đã chữa: Shiki/Prism dựng mỗi dòng code thành một phần tử riêng không có `\n`, nên
`textContent` trả về cả trăm dòng dính liền. Đó là lý do phần đắt nhất của ticket này đã viết xong.

### 4. Quyết định số phận nút docs trên các site đó

Phụ thuộc Bước 0. Hai đường, cân sẵn:

- **(A) `exclude_matches` thêm các host chat** — dứt điểm, nhưng cũng chặn luôn ca hợp lệ: một
  trang docs *nằm trên* host đó. Hiện không có ca nào như vậy đã biết.
- **(B) `detect()` tự nhường khi trang có dấu hiệu hội thoại** ← **nhiều khả năng đúng hơn.**
  Cùng tinh thần với `openDocsPanel()` đang từ chối chạy trên youtube.com và notebooklm.google.com
  (lớp phòng thủ thứ 2 trong *Kỷ luật định tuyến tin nhắn*): quyết định theo **thứ nhìn thấy trên
  trang**, không theo một danh sách host chép tay trong manifest.

(A) chạm `manifest.json` → **Human must decide**. (B) thì không. Đó là một lý do nữa để (B) đứng
trước.

## Không thuộc phạm vi

- **Thu cả danh sách hội thoại một mẻ.** Sourclip có; ticket này cố ý không. Đó là toàn bộ lịch
  sử chat của owner, và "chọn nhầm rồi bấm" ở đó đắt hơn hẳn ở docs.
- **PDF** — NotebookLM nhận upload trực tiếp, extension chen vào không chữa vấn đề nào.
- **Reddit / X** — Reddit có `.json` công khai nên là đường khác hẳn; X thì login-walled + DOM ảo
  hoá, công không tương xứng. Cả hai: ticket riêng nếu muốn, không gộp vào đây.

## Ràng buộc

1. Không thêm permission nào vào `manifest.json`. `https://*/*` đã phủ; `host_permissions` đang
   là bề mặt rộng tối đa và `WORKSPACE_PROTOCOL.md` xếp mọi việc mở rộng thêm là leo thang.
2. Thêm `case` mới vào router `src/docs/content.js` thì **phải** thêm vào `HANDLED`
   (`:873`). Đây là *dominant risk* #2 và `test/messaging.test.js` canh nó.
3. Không ghim class hash của bất kỳ site nào. Xem mục 2.
4. Không đụng đường docs đang chạy cho docs thật. Bước 0 có thể cho thấy nó chạy nhầm chỗ trên
   site chat — sửa chỗ **nhận diện**, không sửa `extract.js`/`sidebar.js` cho docs.

## Thứ tự

1. **Bước 0** — đo trên trang thật. Không viết code trước.
2. `src/common/shared.js` + `KIND.CHAT` + bảng dấu hiệu, kèm test. Đứng độc lập được.
3. `src/docs/content.js` — nhận diện, nút, `HANDLED`.
4. `src/background/service-worker.js` — nhánh `runQueue`.
5. Mục 4 của "Kết quả cần có" — chỉ sau khi Bước 0 nói rõ nút docs đang làm gì ở đó.

## Kiểm chứng

`bash test/run.sh` xanh. Baseline đo trên cây sạch lúc nhận ticket kèm sha — ở `cb78cb6` là
**1351 pass / 0 fail / 24 file**, nhưng **đo lại chứ đừng chép**.

Suite không với tới DOM thật của ChatGPT hay Claude. Fixture phải là **HTML đã lưu từ một trang
thật ở Bước 0**, không phải HTML tự bịa — `test/fixtures/` đã có tiền lệ. Một fixture bịa ở đây
chứng nhận rằng ta đọc đúng thứ ta vừa bịa, và đó là hình dạng mục *anti-patterns* xếp vào
trả-lại-handback (xem `docs/tickets/009-*` mục "Vì sao chưa giao được ngay" cho một ca đã dính).

## Ở acceptance sẽ hỏi

Mỗi câu nói rõ **chiều nào phải đỏ**.

1. **Hoán vị vai "người dùng" và "trợ lý"** trong bảng dấu hiệu. Chiều phải đỏ: **bản hoán vị**.
   Hai vế cùng kiểu, cùng hình dạng đầu ra, và Nguồn dựng ra vẫn **đủ số lượt nói** — nên mọi
   assert kiểu "có N lượt" hay "tổng số chữ khớp" xanh cả hai chiều. Assert phải ghim **lượt nào
   mang vai nào**, với fixture mà hai vai có nội dung **khác nhau rõ rệt**.
2. **Bỏ header ngữ cảnh nhưng giữ nguyên thân bài.** Chiều phải đỏ: **bản hoán vị**. Đây là
   đường dữ liệu song song điển hình — thân bài đúng thì mọi assert soi nội dung đều xanh, cái
   mất chỉ là thứ NotebookLM cần để trích dẫn đúng nguồn.
3. **Cho `detect()` vẫn nhận sidebar trên trang có dấu hiệu hội thoại** (bỏ mục 4). Chiều phải
   đỏ: **bản hoán vị**. Assert nút docs **không** hiện trên fixture trang chat. Nếu câu này
   không đỏ được thì mục 4 đã làm bằng `exclude_matches` chứ không bằng nhận diện — và đó là
   đường (A), phải hỏi owner.

Câu nào trả lời là "không test nào" vẫn là kết quả hợp lệ — **nhưng phải nói ra**.
