# Ultra Review: duong-trao-tay-copy-lai Round 1

Date: 26-08-31
Review name: duong-trao-tay-copy-lai
Round: 1
Scope: Nhánh `fix/duong-trao-tay-copy-lai` vs `main` (commit 79f34b9): nút *Copy lại* trên YouTube + bảng docs, hoán vị cửa 2/cửa 3 trong `handOff`, summary đi kèm `JUMP_NOTEBOOK`
Report path: docs/ultrareview/26-08-31-duong-trao-tay-copy-lai-round-1.md

## Trạng thái (cập nhật 2026-08-31, sau lượt sửa P3)

Báo cáo này được viết TRƯỚC khi sửa, nên phần **Findings** bên dưới mô tả mọi
finding như đang mở. Không còn đúng. Đọc kèm bảng này:

- **F001–F024 — ĐÃ ĐÓNG** ở `e1f9ff2` ("Đường trao tay: gỡ những chỗ hỏng CÂM
  trên đường tới clipboard"). Test 1246 → 1307 pass.
- **F025–F044 — ĐÃ XỬ LÝ HẾT** ở lượt này. Chi tiết bên dưới.

### F025–F044, từng cái một

| ID | Kết cục | Ghi chú |
|---|---|---|
| F025 | sửa | `load()` gọi `setRecopy([])` — bảng singleton không mang nợ sang trang khác |
| F026 | sửa | `setRecopy(..., {merge:true})` gộp nợ thay vì ghi đè |
| F027 | không phải bug | đã đóng từ `e1f9ff2` |
| F028 | sửa | `enqueueLeftover` trả `added` THẬT; `queueSays()` là một vế riêng, tách khỏi vế nguyên nhân |
| F029 | sửa | nút `×` khoá cùng nút *Copy lại* trong lúc "Đang hỏi…" |
| F030 | sửa | `test/handoff-integration.test.js` — content script nối thẳng vào `onMessage` thật |
| F031 | sửa | `[hidden]{display:none!important}` trong `src/docs/overlay.css` |
| F032 | sửa | assert `from` của `bundle-copied` cho cả hai đường |
| F033 | sửa | `note()` nhận `source`; Hàng đợi dùng tiền tố `NotebookLM — ` |
| F034 | sửa | `cut()` cắt CÓ dấu `…`; test biên 300 ký tự |
| F035 | sửa | `.btn--ghost` định nghĩa trong đúng stylesheet của shadow root |
| F036 | không còn đúng | `finally` của `measureAndCopy` đã khôi phục `progressEl` từ `e1f9ff2` |
| F037 | gỡ | `counts` không có consumer production — gỡ khỏi `filterBundle`, sửa comment `shared.js` |
| F038 | sửa doc | ticket 006 nói `{keep, dropped, reason}`; sửa thành `{keep, dropped}` |
| F039 | sửa | handler bọc arrow, `hideRecopy` không nhận `MouseEvent` |
| F040 | sửa một phần | thêm `prefers-reduced-motion`; shadow DOM + light mode ghi lại là quyết định "chưa đổi", đổi thì phải đổi cả ba overlay |
| F041 | sửa | `layoutRecopy()` đo cả `#nblm-bar`, không chỉ toast |
| F042 | sửa | `isConnected` ở mọi chỗ giữ `toastEl`/`recopyEl` |
| F043 | ghi lại quyết định | Sổ không có trần là CỐ Ý — cắt một dòng là để cửa 2 mù với link đó |
| F044 | ghi lại bất biến | `summary` bắt buộc trên thực tế; `noted:true` khi thiếu nó nghĩa là "không có gì để báo" |

### Đo hoán vị — mỗi dòng là một lần chạy thật, đọc exit code + tổng pass/fail

| Hoán vị | Kết quả |
|---|---|
| F025 `load()` không gọi `setRecopy([])` | exit 1, 1 đỏ |
| F026 `setRecopy(...)` bỏ `{merge:true}` | exit 1, 1 đỏ |
| F028 `parts` báo con số gửi đi | exit 1, 2 đỏ |
| F028 `why` báo con số gửi đi | exit 1, 2 đỏ |
| F028 `enqueueLeftover` bỏ qua `res.added` | exit 1, 2 đỏ |
| F029 không khoá nút `×` | exit 1, 1 đỏ |
| F030 `itemKey` đổi tiền tố `yt:` → `ytq:` | exit 1, 2 đỏ |
| F030 `bundleKey` bỏ nhánh videoId | exit 1, 3 đỏ |
| F030 `canonicalUrl` → `youtube.com/v/<id>` | exit 0 — tương đương thật, `videoIdFrom` nhận cả ba dạng |
| F030 `canonicalUrl` → `youtu.be/<id>` | exit 0 — cùng lý do |
| F031 gỡ luật `[hidden]` | exit 1, 1 đỏ |
| F032 *Copy lại* quên chụp nguồn | exit 1, 1 đỏ |
| F032 nguồn là chuỗi cứng | exit 1, 2 đỏ |
| F033 quay lại chuỗi cứng "YouTube →" | exit 1, 1 đỏ (+8 đỏ ở `service-worker-done`) |
| F034 cắt câm bằng `slice(0, max)` | exit 1, 1 đỏ |
| F035 gỡ định nghĩa `.btn--ghost` | exit 1, 1 đỏ |
| F041 `layoutRecopy` bỏ nhánh `#nblm-bar` | exit 1, 1 đỏ |
| F041 bỏ chỗ nghỉ khi mép dưới trống | exit 1, 1 đỏ |
| F042 toast bỏ `isConnected` | exit 1, 1 đỏ |
| F042 thẻ bỏ `isConnected` | exit 1, 2 đỏ |

### Chỗ KHÔNG ghim được, nói thẳng

- **F039** — bọc handler trong arrow là phòng thủ cho tương lai. `hideRecopy()`
  hôm nay không nhận tham số, nên hai bản cho ra hình dạng y hệt và không có
  hoán vị nào phân biệt được. Ghi ở comment, không có test.
- **F040** — `prefers-reduced-motion` và bảng màu là chuyện CASCADE, thứ jsdom
  mù hoàn toàn. Cần trình duyệt thật mới đo được.
- **F031, F035** — hai ca mới ở `ui-isolation.test.js` đo trên VĂN BẢN của file
  CSS: bắt được "class không có luật nào", KHÔNG bắt được "có luật nhưng thua
  cascade".
- **F043, F044** — chỉ là ghi lại quyết định trong code; không có hành vi nào đổi
  nên không có gì để ghim.

## Prior Round Guard

Previous reports read:
- none (round 1, thư mục `docs/ultrareview/` chưa tồn tại trước lượt này)

## Findings

### F001 [P0] `showRecopy([])` chạy vô điều kiện ở nhánh `skipDedupe` — nút *Copy lại* YouTube tự gỡ bất kể lượt copy thành công hay thất bại

Severity: P0 | Confidence: high
Source pointer: `src/youtube/content.js:222` (kết hợp `:205-206`, `:304-307`, `:339-346`)
Evidence:
- `let dropped = []` (`:205`) chỉ được gán lại bên trong `if (gate1.asking.length && !skipDedupe)` (`:206`). `onRecopyClick` luôn truyền `skipDedupe: true` (`:361`), nên `dropped` **luôn** là `[]` cho lượt Copy lại.
- `:222` gọi `showRecopy(dropped.map(...), label)` = `showRecopy([], label)`, và `showRecopy` mở đầu bằng `if (!lastDropped.length) return hideRecopy();` (`:307`) → `recopyEl.remove(); recopyEl = null; lastDropped = []`.
- Dòng `:222` chạy **trước** khối `if (!keep.length)` (`:224`) và trước `try { writeText }` (`:239`).
Contract violated:
- Bản song song bên docs viết luật đúng bằng code thật: `setRecopy(copied ? [] : urls)` (`src/docs/content.js:474`) với JSDoc "Chỉ buông danh sách khi clipboard đã nhận thật. Buông trước rồi cửa đo hỏng giữa chừng là vứt mất bản duy nhất còn giữ nó". Hai bề mặt cùng một tính năng đang chạy hai luật ngược nhau.
- JSDoc `showRecopy` (`:299-301`): "KHÔNG tự tắt... chỉ biến mất khi họ bấm."
Plausible failure mode:
- Bấm *Copy lại 3 link*. `askGate` trả về toàn `restricted` (3 video vẫn private) hoặc `writeText` ném vì tab mất focus. Cả hai nhánh này `return` bình thường, không ném. Nhưng thẻ `#nblm-recopy` đã bị gỡ ở `:222` từ trước → clipboard rỗng, Sổ không ghi, và không còn cách bấm nào để thử lại; phải tick lại toàn bộ playlist từ đầu.
Durable solution hypothesis:
- Bỏ lời gọi `showRecopy` khỏi thân `handOff` cho nhánh `skipDedupe`; để `handOff` trả `dropped`/`copied` và `onRecopyClick` tự quyết: `showRecopy(res && res.copied ? [] : urls, from)` — đối xứng với `recopyBundle` bên docs.
Disconfirming check:
- `sed -n '199,222p;339,369p' src/youtube/content.js` rồi `sed -n '460,480p' src/docs/content.js` — nếu tìm được nhánh nào gán `dropped` khác `[]` khi `skipDedupe === true`, finding này sai.

### F002 [P1] Nút *Copy lại* không phân biệt `why: 'queued'` với `why: 'copied'` → ghi Sổ cho Mục còn sống trong Hàng đợi, sinh Nguồn trùng

Severity: P1 | Confidence: high
Source pointer: `src/youtube/content.js:222`, `src/docs/content.js:445`, `src/background/service-worker.js:671-672`, `:693-708`
Evidence:
- `filterBundle` phân biệt hai lý do: `dropped.push({url, why:'copied'})` vs `dropped.push({url, why:'queued'})` (`service-worker.js:671-672`).
- Cả hai bề mặt `.map((d) => d.url)` — vứt hẳn `d.why` — rồi gộp chung vào một nút *Copy lại*.
- `recordCopied` (`:693-708`) chỉ so với `getCopiedLog()`, **không** đụng `KEYS.QUEUE`. `grep -n "getCopiedLog" src/background/service-worker.js` cho thấy nó không xuất hiện trong `runQueue`/`importItem`.
Contract violated:
- `CONTEXT.md`: "thêm Nguồn không idempotent... để lại một Nguồn trùng phải xoá tay". Sổ đã copy tồn tại "để chống trùng" — ở đây chính hành vi ghi Sổ tạo ra trùng lặp phía Nguồn.
Plausible failure mode:
- URL X đang `PENDING` trong Hàng đợi → `filterBundle` trả `{url: X, why:'queued'}` → hiện nút *Copy lại* → người dùng bấm → X qua cửa 3/cửa đo → vào clipboard → `BUNDLE_COPIED` ghi thêm dòng Sổ cho X (vì X chưa có trong Sổ) → người dùng dán tay (Nguồn A) → Lượt chạy vẫn xử lý Mục X (không tra Sổ) → Nguồn B. Hai Nguồn trùng phải xoá tay.
- Đã đọc `docs/tickets/006-duong-trao-tay.md` toàn văn các đoạn nhắc `dropped`/`why`: **không tìm thấy đoạn nào ghi nhận đánh đổi này** — đây là hệ quả bỏ sót, không phải quyết định đã cân nhắc.
Durable solution hypothesis:
- Giữ nguyên `{url, why}` trong `lastDropped`; nút *Copy lại* chỉ tác động lên `why === 'copied'`. Với `why === 'queued'`, hoặc rút Mục khỏi Hàng đợi trước khi copy, hoặc tách thành hành động riêng có cảnh báo. Phương án thay thế: `runQueue` tra Sổ trước khi import.
Disconfirming check:
- `rg -n "d\.url|why" src/youtube/content.js src/docs/content.js` — nếu có chỗ nào lọc theo `why` trước khi đưa vào `lastDropped`, finding này sai.

### F003 [P1] REGRESSION: `copyBundle` (docs) mất chốt disable đồng bộ — `await` đầu tiên giờ đứng trước mọi lệnh disable, mở lại cửa sổ double-click

Severity: P1 | Confidence: high
Source pointer: `src/docs/content.js:424-432`, `:570-574`; so với `git show main:src/docs/content.js` (~`:404-407`)
Evidence:
- Bản `main`: `async function copyBundle(picked) { const original = copyBtn.textContent; copyBtn.disabled = true; goBtn.disabled = true; try { ... }` — disable là việc đồng bộ đầu tiên.
- Bản HEAD: `copyBundle` mở đầu bằng `const res = await chrome.runtime.sendMessage({type: MSG.BUNDLE_FILTER, urls}).catch(...)` (`:428-431`) — chưa disable gì. `copyBtn.disabled = true` giờ chỉ nằm trong `measureAndCopy` (`:487`), chạy **sau** round-trip.
- Handler `act === 'copy'` (`:570-574`) không có guard nào khác.
Contract violated:
- Bất biến "một cú bấm = một lượt chạy", đúng thứ mục tiêu chính của commit này (khử trùng đứng trước cửa tốn tiền) đang bảo vệ ở tầng khác. `src/youtube/content.js` giữ đúng khuôn (`:462`, `:673`, `onRecopyClick:359`) — bảng docs là chỗ duy nhất hở.
Plausible failure mode:
- Double-click *Copy N link* trong lúc `BUNDLE_FILTER` đang chờ mạng → hai `copyBundle` song song, cùng `keep` (Sổ chưa kịp cập nhật) → **N trang fetch HAI LẦN** ở cửa đo, hai `writeText`, hai `BUNDLE_COPIED`, hai `chrome.notifications`.
Durable solution hypothesis:
- Chuyển `copyBtn.disabled = true; recopyBtn.disabled = true; goBtn.disabled = true;` lên làm việc đồng bộ đầu tiên của `copyBundle` và `recopyBundle`.
Disconfirming check:
- `git diff main...HEAD -- src/docs/content.js | grep -n "disabled = true"` rồi `sed -n '424,460p' src/docs/content.js` — so vị trí dòng disable với `await` đầu tiên.

### F004 [P1] `BUNDLE_COPIED` gửi qua `send()` mà kết quả bị bỏ hoàn toàn — clipboard nhận thật nhưng Sổ có thể không ghi, không ai biết

Severity: P1 | Confidence: high
Source pointer: `src/youtube/content.js:256` (kết hợp `:40-47`)
Evidence:
- `await send(MSG.BUNDLE_COPIED, { urls: keep, from: label });` — giá trị trả về không gán, không kiểm.
- `send()` (`:40-47`) tự bắt exception và trả `{ error: ... }` thay vì ném. Service worker bị evict giữa chừng (thường xuyên ở MV3) → `recordCopied` không chạy → Sổ không ghi → `handOff` vẫn rơi xuống `parts`, gọi `JUMP_NOTEBOOK`, báo "Đã copy N link công khai" như thể trót lọt.
Contract violated:
- `service-worker.js:687-691`: "Ghi Sổ gọi SAU khi `writeText` đã thành công" — ngụ ý `writeText` thành công ⇒ Sổ phản ánh đúng.
Plausible failure mode:
- Lượt sau, `filterBundle` không thấy các link này trong `inLog` → hỏi lại cửa 3 (tốn tiền) và đưa vào Bó lần nữa; nếu người dùng đã dán tay lượt trước, dán lại là Nguồn trùng.
Durable solution hypothesis:
- `const rec = await send(MSG.BUNDLE_COPIED, {...}); if (rec && rec.error) parts.push('chưa ghi được Sổ — lần sau có thể hỏi lại các link này');`
Disconfirming check:
- `rg -n "await send\(MSG.BUNDLE_COPIED" src/youtube/content.js` rồi đọc `:40-47` — xác nhận `send()` không bao giờ ném và call site không đọc kết quả.

### F005 [P1] `note()` nuốt sạch lỗi nhưng giờ là kênh DUY NHẤT báo kết quả cho lượt copy thành công có nhảy

Severity: P1 | Confidence: high
Source pointer: `src/background/service-worker.js:1378-1388`, gọi từ `:284`
Evidence:
- `note()` bọc `chrome.notifications.create` trong `try { ... } catch (_) { /* thông báo không quan trọng tới mức làm hỏng luồng */ }`.
- Cả hai bề mặt giờ chỉ toast/flash khi `!jump.jumped` (`src/youtube/content.js:274-278`, `src/docs/content.js:533-537`). Nhánh thành công không có phản hồi nào khác.
- `chrome.notifications.create` không ném khi OS chặn hiển thị — Promise vẫn resolve, notification chỉ không hiện, nên `catch` thậm chí không kích hoạt.
Contract violated:
- Chính comment trong code (`src/youtube/content.js:275`): "Im lặng ở đây là im lặng sai" — câu đó nay áp luôn cho ca "đã nhảy nhưng report không hiển thị".
Plausible failure mode:
- Người dùng tắt thông báo Chrome ở cấp OS → copy thành công, tab đã nhảy, nhưng không có gì báo "12 private/unlisted → Hàng đợi" — đúng phần comment tự nhận là "đáng đọc nhất".
Durable solution hypothesis:
- Ghi summary vào storage cho popup đọc lại, độc lập với notification; hoặc trả kết quả `notifications.create` về `jumpToNotebook` để bề mặt biết kênh có thể đã câm và tự toast dự phòng.
Disconfirming check:
- `rg -n "notifications.create" src/background/service-worker.js` — một call site, bọc try/catch, không log lỗi. `rg -n "note\(" test/handoff-jump.test.js` — không có test nào giả lập `create` reject.

### F006 [P1] TEST GAP: không có ca "cửa 2 loại MỘT PHẦN" ở cả hai bề mặt — mutation bỏ lọc từng phần tử sống sót toàn bộ suite

Severity: P1 | Confidence: high
Source pointer: `src/youtube/content.js:212-214`; `src/docs/content.js:456`; test `test/youtube-bundle.test.js`, `test/docs-panel.test.js`
Evidence:
- `test/youtube-bundle.test.js` chỉ có hai hình dạng phản hồi `bundle-filter`: `defaultReply` (`keep: message.urls`, giữ 100%) và `allDropped` (`keep: []`, loại 100%). Không có ca thứ ba.
- `grep -n "drop:" test/docs-panel.test.js` → 5 chỗ, **tất cả** đều `drop: 'all'`.
Contract violated:
- JSDoc `askGate`: cửa 3 "chỉ chạy trên thứ cửa 2 cho qua" — phải lọc đúng từng phần tử, không phải tất-cả-hoặc-không-gì.
Plausible failure mode (mutation sống sót):
- YouTube: đổi `:214` thành `toAsk = keepIds.size ? gate1.asking : [];` → với `defaultReply` (`keepIds.size === asking.length`) đúng ngẫu nhiên; với `allDropped` (`size === 0`) đúng ngẫu nhiên. **0 test đỏ.** Playlist 1 đã-copy + 199 mới → hỏi lại cửa 3 cho cả 200.
- Docs: đổi `:456` thành `await measureAndCopy(urls, ...)` (dùng lại tập chưa lọc) → ca all-kept không phân biệt được; ca all-dropped return sớm ở `:449` nên mutation không được thực thi. **0 test đỏ.**
Durable solution hypothesis:
- Thêm cho mỗi bề mặt một ca 3 mục, `keep` chỉ chứa 2, assert `asked` đúng bằng 2 mục còn lại (không phải 3, không phải 0) VÀ `clipboard.writes` không chứa mục bị drop.
Disconfirming check:
- `grep -n "bundle-filter" test/youtube-bundle.test.js` và `grep -n "drop:" test/docs-panel.test.js` — nếu vẫn chỉ ra hai cực, gap còn nguyên.

### F007 [P1] TEST GAP: khử trùng `videoId` trong `badgeGate` có 0% coverage — xoá hẳn `seen` vẫn xanh 100%

Severity: P1 | Confidence: high
Source pointer: `src/youtube/content.js:116-122`
Evidence:
- Commit message công bố: "`badgeGate` khử trùng lặp theo `videoId`, nên playlist chứa một video hai lần không còn trả tiền hai lượt hỏi."
- `grep -n "seen\|dedupe\|trùng" test/youtube-bundle.test.js` → 0 dòng. Không fixture nào lặp `videoId` trong cùng một bộ candidates.
Contract violated:
- Tính năng thuộc nội dung chính của commit (chi phí request) nhưng không có phép đo nào.
Plausible failure mode (mutation sống sót):
- Xoá `const seen = new Set();` và điều kiện `seen.has(c.videoId)` → mọi test vẫn xanh, dù production quay lại gọi `describe()` hai lần cho cùng video và có thể ghi trùng dòng vào clipboard.
Durable solution hypothesis:
- Test: playlist có 2 thẻ DOM khác nhau cùng `videoId`; tick cả hai; assert `calls.describe` chứa videoId đó **đúng một lần** và `clipboard.writes` chỉ có một dòng.
Disconfirming check:
- Quét các mảng fixture trong `test/youtube-bundle.test.js` tìm `videoId` lặp lại — hiện tại không có.

### F008 [P1] Nhánh `finally` "khôi phục nguyên trạng" của `onRecopyClick` là code chết, và không test nào chạm tới

Severity: P1 | Confidence: high
Source pointer: `src/youtube/content.js:363-368`
Evidence:
- `if (recopyEl && recopyEl.contains(el)) showRecopy(urls, from);` với comment "Còn sống nghĩa là lượt này ném giữa chừng".
- Nhưng `handOff` không có đường ném nào lọt ra: `send()` tự bắt lỗi (`:40-47`), `askGate` bọc try/catch từng phần tử, nhánh `writeText` có try/catch riêng (`:239-252`) — mọi lỗi đều `return` object thay vì ném.
- Cộng với F001, `recopyEl` đã bị `hideRecopy()` đặt `null` ngay ở `:222` trước khi `finally` chạy → điều kiện luôn `false`.
- Bên docs có test tương đương cho ca lỗi (`test/docs-panel.test.js:487-514`); YouTube thì không.
Contract violated:
- Comment mô tả một cơ chế phòng thủ không có đường thực thi — tài liệu nói dối về logic runtime.
Plausible failure mode:
- Xoá dòng `:367` → 0 test đỏ. Nếu sau này ai đó thêm một `await` không bọc catch vào `handOff`, cơ chế phục hồi này chưa bao giờ được xác nhận là hoạt động.
Durable solution hypothesis:
- Sửa cùng F001. Sau khi `onRecopyClick` tự quản `showRecopy`, thêm test ép `writeText` ném trong lúc recopy và assert nút *Copy lại* **còn đó**.
Disconfirming check:
- Đọc toàn thân `handOff` (`:199-288`) tìm `await` nào không nằm trong try/catch — nếu tìm ra, nhánh này không phải dead code và severity tăng.

### F009 [P2] `lastDropped`/`lastDroppedFrom`/`recopyEl` là singleton toàn module không có phiên — lượt copy này xoá sổ thẻ hợp lệ của lượt copy khác

Severity: P2 | Confidence: medium-high
Source pointer: `src/youtube/content.js:107-108`, `:303`, `:222`; năm call site `handOff` tại `:359`, `:466`, `:678`, `:750`, `:961`
Evidence:
- `grep -n "let recopyEl\|let lastDropped" src/youtube/content.js` → 3 khai báo `let`, không có generation token, không có mutex, không có cờ in-flight.
Contract violated:
- JSDoc `:103-107`: "danh sách phải là đúng cái người dùng vừa được báo".
Plausible failure mode (hai kịch bản cùng gốc):
- **Race**: bấm *Copy lại* (lượt A) → trong lúc `await askGate`, người dùng bấm *Copy link* ở thanh nổi (lượt B). B xong trước, `showRecopy(droppedB)` `replaceChildren` thay nút "Đang hỏi…" của A. A xong sau, `showRecopy([])` → `hideRecopy()` xoá luôn thẻ của B — B chưa hề được người dùng thao tác.
- **Tuần tự**: thẻ A đang hiện (12 link chưa bấm). Người dùng copy một video mới, không trùng gì → `dropped = []` → `showRecopy([])` → `hideRecopy()` → 12 link của A biến mất im lặng, không do người dùng bấm.
Durable solution hypothesis:
- Gắn generation token cho mỗi lượt `handOff`; chỉ cho phép ghi đè/gỡ thẻ khi token khớp. Hoặc mutex một-lượt-tại-một-thời-điểm mỗi tab.
Disconfirming check:
- `rg -n "session|generation|inFlight|token" src/youtube/content.js` → 0 hit liên quan.

### F010 [P2] `jumpToNotebook` không bọc `tabs.update`/`windows.update` — exception bị đọc thành "chưa đặt notebook đích"

Severity: P2 | Confidence: high
Source pointer: `src/background/service-worker.js:282-284`; handler `:~1659`; `src/youtube/content.js:272-278`, `src/docs/content.js:533-537`
Evidence:
- `await chrome.tabs.update(tab.id, {active:true}); if (tab.windowId != null) await chrome.windows.update(...)` — không try/catch cục bộ. Top-level handler biến exception thành `sendResponse({error})`.
- Bề mặt chỉ kiểm `!jump.jumped`, không phân biệt `why`/`error`; `rg -n "why:" src/background/service-worker.js` → chỉ một giá trị `'no-target'`.
Contract violated:
- Comment ngay trên `jumpToNotebook` (`:246-248`): "Không tìm được tab thì KHÔNG ném... Trả về lý do để bề mặt nói tiếp vào câu đã copy." Bất biến chỉ được thực thi cho nhánh `if (!tab)`.
Plausible failure mode:
- Tab notebook bị đóng giữa `tabs.query` và `tabs.update` → ném `"No tab with id: X."` → bề mặt báo "chưa đặt notebook đích — mở notebook rồi Ctrl+V". Sai nguyên nhân, chỉ sai hướng khắc phục.
Durable solution hypothesis:
- Bọc hai lời gọi update trong try/catch, trả `{jumped:false, why:'tab-gone'}`; bề mặt đọc `why` để chọn câu.
Disconfirming check:
- `sed -n '258,286p' src/background/service-worker.js` — xác nhận không có `try` bao quanh.

### F011 [P2] `measureAndCopy` trả boolean, không phân biệt "copy được MỘT PHẦN" — nhánh Copy lại (docs) mất dấu các trang bị `blocked`

Severity: P2 | Confidence: high
Source pointer: `src/docs/content.js:467-475` (đặc biệt `:474`), `:485-538`
Evidence:
- `measureAndCopy` `return true` ngay sau `writeText` thành công, bất kể `blocked.length`.
- `recopyBundle` chỉ đọc boolean đó: `setRecopy(copied ? [] : urls)`.
Contract violated:
- JSDoc `lastDropped` (`:398-402`): "danh sách người dùng vừa được báo". Trang `blocked` vẫn chưa vào clipboard nên lẽ ra phải còn.
Plausible failure mode:
- 4 link bị cửa 2 loại → bấm *Copy lại* → 3 qua cửa đo, 1 là docsify (JS-rendered). `passed.length > 0` → `setRecopy([])` → nút ẩn, trang thứ 4 không vào clipboard, không vào Sổ, không vào Hàng đợi, và không còn đường bấm lại.
Durable solution hypothesis:
- `measureAndCopy` trả `{passed, blocked}` thay vì boolean; `recopyBundle` gọi `setRecopy(blockedUrls)`.
Disconfirming check:
- Test dùng `threeTree()` + `drop` một tập con, trộn fixture `docs-ssr.html` với `docs-spa-shell.html`, kiểm `[data-act="recopy"]` còn hiện đúng số trang chưa copy được.

### F012 [P2] Nút *Copy lại* (docs) kẹt vĩnh viễn khi mọi trang trượt cửa đo, và không có nút dismiss

Severity: P2 | Confidence: high
Source pointer: `src/docs/content.js:467-475`, template `:279-286`
Evidence:
- `setRecopy(copied ? [] : urls)` — mọi trang là SPA/docsify thì `measureAndCopy` luôn trả `false` (kết quả đo là hàm xác định của nội dung trang), nên `lastDropped` không bao giờ rỗng.
- `rg -n "data-act=\"dismiss\"" src/docs/content.js` → 0 hit, trong khi bản YouTube có (`src/youtube/content.js:332`).
Contract violated:
- Tinh thần "khử trùng đứng trước cửa tốn tiền" của chính commit: mỗi cú bấm là N lượt fetch HTML thô không đổi kết quả.
Plausible failure mode:
- 30 trang docsify trong `dropped` → nút tồn tại vĩnh viễn, mỗi cú bấm 30 request vô ích, không có lối thoát nào ngoài đóng bảng (không xoá state — xem F025) hoặc *Xoá sổ* toàn bộ.
Durable solution hypothesis:
- Thêm nút `×` như bản YouTube; và/hoặc nhớ số lần trượt liên tiếp (giống `BUNDLE_BREAKER`) để ẩn nút sau N lần thất bại không đổi.
Disconfirming check:
- `sed -n '279,290p;467,476p' src/docs/content.js` — xác nhận không có nút dismiss và không có bộ đếm.

### F013 [P2] `.nblm-recopy { bottom: 96px }` chồng lên `.nblm-toast` khi toast ≥3 dòng — và ca toast dài nhất trùng đúng ca cả hai chắc chắn cùng hiện

Severity: P2 | Confidence: medium-high
Source pointer: `src/youtube/overlay.css:107-154`; chuỗi toast tại `src/youtube/content.js:229-234`
Evidence:
- `.nblm-toast { bottom: 24px; max-width: 380px; padding: 12px 16px; font-size: 13px; line-height: 1.45 }`, không `max-height`, không line-clamp.
- Chiều cao toast = 24px padding + 18.85px × N dòng. N=3 → mép trên ở ~104.5px, **vượt 96px**. N=4 → ~123px, chồng ~27px.
- Chuỗi dài nhất là nhánh `!keep.length && dropped.length` (`:229-234`): 3 mệnh đề `why` + câu 'Dùng nút "Copy lại" ở góc màn hình để copy cả những cái đã có.' — trên dưới 170-200 ký tự, chắc chắn wrap ≥3 dòng ở 380px/13px. Và `showRecopy` được gọi ở `:222`, **trước** khối toast này — nên hai phần tử luôn cùng hiện ở đúng ca xấu nhất.
- `rg -n "recopy" tools/*.mjs` → 0 hit: phép đo "đáy 723 vs đỉnh 733" trong commit message không có script nào tái lập được. jsdom không layout nên `test/run.sh` không thể gác.
Contract violated:
- Comment CSS tự khẳng định bất biến "để hai thứ không chồng nhau khi cùng hiện" mà không có ràng buộc kỹ thuật nào giữ nó.
Plausible failure mode:
- Playlist lớn nhiều lý do bị loại → toast 3-4 dòng che nút `.nblm-recopy__go`/`__x`, khó bấm.
Durable solution hypothesis:
- Đo `toastEl.getBoundingClientRect().height` lúc runtime, hoặc đặt cả hai trong một container flex `column-reverse` với `gap`, thay hằng số `96px`.
Disconfirming check:
- Ghép chuỗi dài nhất từ `:229-234`, đếm ký tự, ước lượng số dòng ở 380px/13px — không cần trình duyệt để thấy công thức trong comment sai về đại số.

### F014 [P2] `writeText` và hai `sendMessage` nằm chung một `try` (docs) — `sendMessage` reject báo "Không copy được" dù clipboard đã nhận thật

Severity: P2 | Confidence: medium-high
Source pointer: `src/docs/content.js:511-513`, `:539-541`
Evidence:
- `await navigator.clipboard.writeText(passed.join('\n'));` rồi `await chrome.runtime.sendMessage({type: MSG.BUNDLE_COPIED, ...})` rồi `JUMP_NOTEBOOK` — cả ba trong một `try`, `catch (e) { flash('Không copy được: ...'); return false; }`.
- Khác YouTube, ở đây `chrome.runtime.sendMessage` gọi trần, không có `.catch` (chỉ `BUNDLE_FILTER` ở `:428` mới có).
Contract violated:
- Chính lý lẽ commit viết cho `copyBundle` (`:435-441`): "một bên là 'đã có rồi' còn bên kia là 'chưa tra được' — báo sai nguyên nhân". Cùng lỗi ở nhánh dưới.
Plausible failure mode:
- Service worker reload đúng lúc → flash "Không copy được", `return false` → `recopyBundle` giữ nguyên `lastDropped` → người dùng bấm lại, đo lại toàn bộ, trong khi clipboard đã có nội dung và Sổ thì chưa ghi.
Durable solution hypothesis:
- Tách `try` cho `writeText` riêng (như YouTube `:239-252`); hai `sendMessage` sau bọc `.catch` để phân biệt "clipboard OK, Sổ chưa ghi" khỏi "clipboard hỏng".
Disconfirming check:
- `sed -n '486,546p' src/docs/content.js` — đếm số cặp try/catch bao quanh ba lệnh async.

### F015 [P2] Tiến trình "Đang đo X/Y…" luôn ghi vào `copyBtn`, kể cả khi người dùng bấm `recopyBtn`

Severity: P2 | Confidence: high
Source pointer: `src/docs/content.js:485-499`
Evidence:
- `copyBtn.textContent = 'Đang đo 0/${urls.length}…'` và callback `(done, total) => { copyBtn.textContent = ... }` — hard-code `copyBtn`. `recopyBtn` chỉ bị `disabled = true`, không có text tiến trình. `grep -n "recopyBtn.textContent" src/docs/content.js` → không có trong `measureAndCopy`.
Contract violated:
- Khuôn mẫu của chính repo: `onRecopyClick` bên YouTube (`:359-360`) set text tiến trình đúng trên nút vừa bấm.
Plausible failure mode:
- Bấm *Copy lại 4 link đã có* → nút đó chỉ mờ đi; nút *Copy N link* bên cạnh tự nhảy chữ "Đang đo 0/4…" dù không ai bấm nó.
Durable solution hypothesis:
- Truyền `progressEl` (nút được bấm) vào `measureAndCopy` thay vì hard-code `copyBtn`.
Disconfirming check:
- `grep -n "copyBtn.textContent\|recopyBtn.textContent" src/docs/content.js`.

### F016 [P2] Thẻ `#nblm-recopy` thiếu `role`/`aria-live`, nút `×` thiếu `aria-label` — trái tiền lệ a11y đã có trong cùng repo

Severity: P2 | Confidence: high
Source pointer: `src/youtube/content.js:304-336` (thiếu `role`/`aria-live`), `:329-334` (nút `×`)
Evidence:
- `x.textContent = '×'; x.title = 'Bỏ qua';` — chỉ `title`, không `aria-label`. So với `src/popup/popup.js:374-375`: `remove.setAttribute('aria-label', 'Xoá ... khỏi hàng đợi')`.
- `recopyEl` chỉ có `id`/`className`. Cùng file này đã dùng ARIA đúng cho modal (`:786-787`: `role="dialog"`, `aria-modal="true"`).
Contract violated:
- Tiền lệ a11y đã thiết lập trong repo (nút "×" luôn có `aria-label`).
Plausible failure mode:
- Screen reader đọc "×, button" — glyph không có ngữ nghĩa TTS; `title` chỉ hiện khi hover chuột. Thẻ "cố ý không tự tắt" xuất hiện im lặng, không được announce; text "Đang hỏi…" thay đổi cũng câm vì không có live region.
Durable solution hypothesis:
- `recopyEl.setAttribute('role','status'); recopyEl.setAttribute('aria-live','polite');` và `x.setAttribute('aria-label','Bỏ qua thông báo copy lại');`
Disconfirming check:
- `rg -n "aria-label|aria-live|role=" src/youtube/content.js` — 0 hit trong khối recopy.

### F017 [P2] `onNavigate` không dọn `recopyEl`/`lastDropped`, và nhãn thẻ không hiện `lastDroppedFrom` — bấm *Copy lại* cho ngữ cảnh đã rời bỏ

Severity: P2 | Confidence: high
Source pointer: `src/youtube/content.js:875-881` (`onNavigate`), `:322-324` (text của thẻ)
Evidence:
- `onNavigate() { selected.clear(); P.reset(); P.close(); renderBar(); refreshContext(); }` — không chạm `recopyEl`/`hideRecopy`/`lastDropped`. `P.reset()` (`panel.js:209-216`) xử lý đúng loại rủi ro này cho transcript; recopy thì không.
- `text.textContent = '${n} link đã có trong Sổ hoặc Hàng đợi'` — `lastDroppedFrom` chỉ đi vào `title` của nút, không hiện trực tiếp.
Contract violated:
- JSDoc `:293-301` khẳng định thẻ "đứng yên... chỉ biến mất khi họ bấm" — hợp lệ, nhưng khi đó nhãn phải cho biết nó thuộc về đâu.
Plausible failure mode:
- Copy playlist A (12 dropped), không bấm, điều hướng sang playlist B. Thẻ vẫn đó với chữ y hệt. Bấm *Copy lại* → copy 12 link của A trong khi người dùng đang đứng ở B, không có gì trên màn hình cho biết điều đó.
Durable solution hypothesis:
- Hiện `lastDroppedFrom` trong `text.textContent` ("12 link đã có trong Sổ — từ <playlist A>"), hoặc gọi `hideRecopy()` trong `onNavigate` (đối xứng `P.reset()`).
Disconfirming check:
- `grep -n "onNavigate" -A8 src/youtube/content.js` — thân hàm không có `recopyEl`/`hideRecopy`.

### F018 [P2] Overlay gắn vào `document.documentElement` bị ẩn khi YouTube vào Fullscreen API — thẻ "không tự tắt" phơi nhiễm lâu nhất

Severity: P2 | Confidence: low-medium (dựa trên đặc tả Fullscreen API, chưa xác minh bằng trình duyệt thật)
Source pointer: `src/youtube/content.js:313` (recopy), `:69` (toast), `:618` (bar)
Evidence:
- `rg -n "fullscreen" src/` → 0 hit toàn repo. Mọi overlay `appendChild` thẳng vào `documentElement`.
- Theo spec, phần tử fullscreen render ở top layer; phần tử `position: fixed` không phải hậu duệ của nó không hiển thị — `z-index: 2147483002` không thắng được top layer.
Contract violated:
- JSDoc `:299-301`: "phải còn đó lúc họ quay lại". Fullscreen là chế độ xem phổ biến nhất trên YouTube.
Plausible failure mode:
- Bấm Copy trong fullscreen → không thấy toast lẫn thẻ *Copy lại* → tưởng thao tác không có tác dụng, bấm lại nhiều lần.
Durable solution hypothesis:
- Lắng nghe `fullscreenchange`; khi `document.fullscreenElement` tồn tại, `appendChild` overlay vào chính phần tử đó.
Disconfirming check:
- Cần trình duyệt thật (brave headless không dựng được fullscreen thật) — hoặc bác bỏ bằng cách xác nhận YouTube dùng theater/CSS-fullscreen chứ không phải Fullscreen API.

### F019 [P2] TEST GAP: `.catch` mới cho `sendMessage` reject không thể kích hoạt bằng harness hiện tại — xoá nó vẫn xanh

Severity: P2 | Confidence: high
Source pointer: `src/docs/content.js:428-432`; harness `test/dom-harness.js:520-523`
Evidence:
- Harness docs: `sendMessage: async (message) => { sent.push(...); return respond(message); }` — luôn resolve trừ khi `respond()` tự ném đồng bộ. `grep -n "reject\|throw new Error" test/docs-panel.test.js` → 0 kết quả.
- Test "Cửa khử trùng HỎNG" (`:524-543`) chỉ mô phỏng `res.error` (promise **resolve** với field lỗi), không mô phỏng **reject**.
Contract violated:
- Lý do được nêu cho `.catch` là "service worker vừa nạp lại thì nó *reject*... cú bấm chết câm" — đúng kịch bản không test nào tạo ra.
Plausible failure mode (mutation sống sót):
- Xoá `.catch((e) => ({error: ...}))` → 0 test đỏ, dù production quay lại lỗi "cú bấm chết câm" mà commit này vừa sửa.
Durable solution hypothesis:
- `h.reply(() => { throw new Error('service worker reloading'); })` cho type `bundle-filter`; assert `flash()` hiện lỗi rõ ràng thay vì unhandled rejection.
Disconfirming check:
- Đọc `test/dom-harness.js:520-523` — xác nhận `sendMessage` không có nhánh reject nào.

### F020 [P2] Khứ hồi `canonicalUrl(videoId)` → `videoIdFrom(u)` có thể đánh rơi ứng viên im lặng, không rổ nào đếm

Severity: P2 | Confidence: low-medium
Source pointer: `src/youtube/content.js:210-214`; `src/common/shared.js` (`canonicalUrl`, `videoIdFrom` + `clean`)
Evidence:
- `canonicalUrl` chỉ nội suy chuỗi, không kiểm khuôn dạng. `videoIdFrom` chỉ chấp nhận id thoả `/^[\w-]{11}$/`.
- `badgeGate` chỉ kiểm `c.videoId` truthy. `currentVideoId()` (`src/youtube/transcript.js:28-35`) không áp cùng regex nghiêm ngặt.
- `keepIds` lọc `.filter(Boolean)` → id không hợp lệ biến mất khỏi `toAsk` mà không vào `keep`, `dropped`, `restricted`, hay `unknown`.
Contract violated:
- "Ba lý do bị loại được đếm RIÊNG" / "Im lặng bỏ link là đúng lỗi `sidebar.js` đã dính hai lần" (`filterBundle` JSDoc).
Plausible failure mode:
- Candidate với `videoId` không đúng 11 ký tự → mất trắng: không clipboard, không Hàng đợi, không xuất hiện trong toast.
Durable solution hypothesis:
- Validate `c.videoId` bằng regex ngay ở `badgeGate` (đẩy vào `unknown` thay vì rơi im lặng), hoặc khớp `keep` bằng `Map<videoId, candidate>` dựng từ chính mảng gửi đi thay vì parse ngược chuỗi trả về.
Disconfirming check:
- `sed -n '20,36p' src/youtube/transcript.js` so với `videoIdFrom` trong `src/common/shared.js` — nếu hai hàm cùng luật, finding này sai.

### F021 [P2] `recordCopied` là read-modify-write không khoá — hai tab copy gần đồng thời làm mất dòng Sổ

Severity: P2 | Confidence: medium
Source pointer: `src/background/service-worker.js:693-708`
Evidence:
- `getCopiedLog()` → sửa mảng trong RAM → `chrome.storage.local.set` toàn bộ mảng. `rg -n "withLock|mutex" src/` → 0 hit toàn repo.
Contract violated:
- Tính đầy đủ của Sổ ("tồn tại để chống trùng") — mất dòng nghĩa là lượt sau không nhận ra link đã copy.
Plausible failure mode:
- Hai `BUNDLE_COPIED` interleave qua `await`, cùng đọc bản `log` cũ, cả hai `set()` — lời gọi sau ghi đè, mất dòng của lời gọi trước dù `writeText` của nó đã thành công thật.
- Pattern có từ trước, nhưng commit này thêm **hai nút Copy lại thật** ở hai bề mặt, làm tăng khả năng va chạm.
Durable solution hypothesis:
- Hàng đợi ghi tuần tự (một promise chain) cho `KEYS.COPIED`, hoặc merge theo key khi đọc lại trước khi `set`.
Disconfirming check:
- `rg -n "getCopiedLog\(\)" src/background/service-worker.js` — xác nhận không có nguyên thủ khoá nào bao quanh.

### F022 [P2] Lỗi cửa 2 return sớm mà không `enqueueLeftover(gate1.restricted)` — video badge-rejected mất dấu

Severity: P2 | Confidence: medium
Source pointer: `src/youtube/content.js:207-211`
Evidence:
```
if (res && res.error) {
  toast(`Không tra được Sổ đã copy: ${res.error}`, 'error');
  return { copied: 0, error: res.error };
}
```
- Không gọi `enqueueLeftover(gate1.restricted)` — các video đã bị cửa 1 loại (huy hiệu nói private) biến mất khỏi mọi rổ.
- Bản `main` cũng return sớm tương tự, nhưng phép hoán vị làm lỗi này xảy ra **sớm hơn** trong pipeline nên phơi bày nhiều candidate hơn.
Contract violated:
- "Ba lý do bị loại được đếm RIÊNG"; tinh thần "không đánh rơi Mục nào".
Plausible failure mode:
- Service worker lỗi lúc tra Sổ → 12 video private đã biết chắc không được xếp vào Hàng đợi; người dùng chỉ thấy một toast lỗi chung chung.
Durable solution hypothesis:
- Gọi `enqueueLeftover(gate1.restricted)` trước khi return ở nhánh lỗi cửa 2.
Disconfirming check:
- `git show main:src/youtube/content.js | sed -n '186,200p'` so với `sed -n '206,216p' src/youtube/content.js` — cả hai đều thiếu.

### F023 [P2] Payload nghèo `{videoId}` ở nhánh Copy lại, và `askGate` không ghi lại `meta` vừa đo — Hàng đợi nhận `title` rỗng, `privacy: unknown`

Severity: P2 | Confidence: medium-high
Source pointer: `src/youtube/content.js:361`, `:164-169` (`askGate` không enrich), `:284-291` (`enqueueLeftover`)
Evidence:
- `urls.map((u) => ({ videoId: videoIdFrom(u) }))` — mất `title`/`privacy`/`accessible`.
- `askGate` gọi `T.describe(c.videoId)` lấy `meta` chính xác nhưng chỉ `restricted.push(c)` / `unknown.push(c)` với `c` gốc chưa enrich (hành vi này có từ `main`, nhưng nay cộng dồn với payload nghèo).
- `enqueueLeftover` → `privacy: i.privacy || i.privacyHint || PRIVACY.UNKNOWN` → luôn `UNKNOWN`; `title: undefined`.
- `popup.js:242-244` fallback về `item.videoId` (chuỗi 11 ký tự vô nghĩa).
Contract violated:
- Không phá cái neo clipboard, nhưng vứt đi chính kết quả cửa 3 vừa trả tiền để có.
Plausible failure mode:
- Copy lại 50 video, 10 bị cửa 3 xác nhận `RESTRICTED` → cả 10 vào Hàng đợi với `privacy:'unknown'` → `resolveMeta` phải mở tab hỏi lại `YT_DESCRIBE` cho cả 10, một lượt hỏi thừa cho thứ vừa đo xong vài giây trước. Popup hiện videoId thô.
Durable solution hypothesis:
- Trong `askGate`: `restricted.push(Object.assign({}, c, { privacy: meta && meta.privacy }))`. Và giữ `Map<videoId, candidate>` cho `lastDropped` thay vì chỉ `url[]`.
Disconfirming check:
- `sed -n '164,169p' src/youtube/content.js` so `git show main:src/youtube/content.js | sed -n '153,161p'` — giống hệt, xác nhận phần enrich là pre-existing; phần payload nghèo là mới.

### F024 [P2] `src/youtube/panel.js:141` — `copy()` transcript có thể `writeText('')` khi `segments` rỗng sau lọc

Severity: P2 | Confidence: low-medium
Source pointer: `src/youtube/panel.js:138-144`, `src/youtube/srt.js:64-71`
Evidence:
- `toTxt(segments)` lọc `.filter((s) => s && s.text)` rồi `if (!list.length) return '';`
- `panel.js` không guard `current.segments.length` trước `writeText`; nút "Sao chép" không `disabled` khi mảng rỗng (chỉ `current === null` mới chặn).
Contract violated:
- Luật rõ trong `handOff` JSDoc: "`writeText('')` xoá trắng thứ người dùng đang giữ" — đây là đường tới `writeText` duy nhất chưa có chốt chặn rỗng.
- Ngoài diff, nhưng thuộc cùng cái neo mà commit này đang siết.
Plausible failure mode:
- Video có transcript rỗng/toàn ký hiệu → `writeText('')` xoá clipboard, đồng thời báo "Đã sao chép transcript vào clipboard".
Durable solution hypothesis:
- Guard `if (!text) { toast('Transcript rỗng — không copy'); return; }` trước `writeText`.
Disconfirming check:
- `rg -n "function extract" -A30 src/youtube/transcript.js` — nếu `extract()` tự ném khi 0 dòng, finding này bị bác bỏ.

### F025 [P3] `lastDropped` (docs) không reset khi bảng đóng/mở lại hoặc `load()` sang trang khác

Severity: P3 | Confidence: medium
Source pointer: `src/docs/content.js:403` (khai báo trong closure `buildPanel`), `:229-234` (`open`/`close`), `load()` (~`:614-620`)
Evidence:
- Panel là singleton nhớ (`let panel = null; if (!panel) panel = buildPanel();`). `close()` chỉ set `display:none`. `load()` chỉ `rows = next; boxes.clear(); search.value=''; render();` — không đụng `setRecopy`.
Contract violated:
- JSDoc `:398-400`: "nó là danh sách người dùng vừa được báo, không phải một danh sách tính lại sau đó."
Plausible failure mode:
- Đóng bảng, điều hướng sang trang docs khác, mở lại → nút "Copy lại N link đã có" hiện URL của phiên trước, người dùng tưởng thuộc trang hiện tại.
Durable solution hypothesis:
- Gọi `setRecopy([])` trong `load()`.
Disconfirming check:
- `rg -n "function load" -A10 src/docs/content.js` — xác nhận không có `setRecopy`.

### F026 [P3] `copyBundle` gọi `setRecopy(dropped)` trước khi biết `measureAndCopy` thành công — ghi đè danh sách chưa xử lý của lượt trước

Severity: P3 | Confidence: high
Source pointer: `src/docs/content.js:445`, `:456`
Evidence:
- `setRecopy(dropped.map(...))` ở `:445`, `await measureAndCopy(keep, ...)` ở `:456` — ghi đè xảy ra trước.
Contract violated:
- Cùng nguyên tắc F011/F001: chỉ buông/ghi đè khi biết kết quả.
Plausible failure mode:
- Lượt 1 sinh `dropped_A` (chưa bấm Copy lại). Đổi tick, lượt 2 trên tập rời rạc sinh `dropped_B` → `dropped_A` mất khỏi UI mà không cảnh báo, kể cả khi lượt 2 sau đó thất bại toàn bộ.
Durable solution hypothesis:
- Hợp nhất (union) `lastDropped` thay vì overwrite, hoặc chỉ `setRecopy` sau khi `measureAndCopy` trả kết quả.
Disconfirming check:
- `sed -n '424,457p' src/docs/content.js` — xác nhận thứ tự hai lời gọi.

### F027 [P3] `dropped.length` đổi ngữ nghĩa sau hoán vị — cùng một video nhận hai nhãn khác nhau ở hai lượt bấm

Severity: P3 | Confidence: high
Source pointer: `src/youtube/content.js:209-224`; so `git show main:src/youtube/content.js:170-176`
Evidence:
- Trước: `dropped` tính trên `urls` — tập đã được cửa 3 XÁC NHẬN public. Sau: tính trên `gate1.asking` — mới chỉ qua cửa 1, chưa qua cửa 3.
Contract violated:
- "Ba lý do bị loại được đếm RIÊNG... 'cả 12 link đều private' thì hành động được."
Plausible failure mode:
- Lượt 1: "12 video private/unlisted → Hàng đợi". Lượt 2 cùng playlist: "12 link đã có trong Sổ hoặc Hàng đợi — nút Copy lại". Người dùng bấm *Copy lại* tưởng lấy được 12 link public bị bỏ sót; cửa 3 lại từ chối cả 12 (đúng thiết kế, nhưng kỳ vọng đã bị đặt sai).
Durable solution hypothesis:
- Phân biệt trong nhãn: `why === 'queued'` nên nói "đang chờ trong Hàng đợi" chứ không gộp vào "đã có trong Sổ" (trùng hướng sửa với F002).
Disconfirming check:
- So `git show main:src/youtube/content.js` với `sed -n '199,224p' src/youtube/content.js` — xác nhận tập đầu vào của cửa 2 đã đổi.

### F028 [P3] `gate1.restricted` không bao giờ tra Hàng đợi — thông điệp "N private/unlisted → Hàng đợi" lặp lại dù 0 Mục mới được thêm

Severity: P3 | Confidence: high (sự tồn tại) / low (có phải bug hay đánh đổi chấp nhận được)
Source pointer: `src/youtube/content.js:116-129`, `:284-291`
Evidence:
- Cửa 2 chỉ tra `gate1.asking`. `enqueueLeftover` gọi `MSG.ENQUEUE` mỗi lượt; `enqueue()` phía service worker dedupe theo `itemKey` nên không tạo dòng trùng — nhưng **thông điệp** thì lặp y hệt.
- Hành vi có từ `main` (`buildBundle` cũng push thẳng từ badge), không phải regression.
Plausible failure mode:
- Bấm *Copy link công khai* 10 lần trên trang có 1 video bị badge chặn → cả 10 lần đều báo "1 video private/unlisted → Hàng đợi", không có cách nào biết 9 lần sau không có gì thay đổi.
Durable solution hypothesis:
- Đọc `res.added` từ `enqueueLeftover` và báo con số thật, hoặc cho `gate1.restricted` đi qua cùng phép tra "đã ở Hàng đợi chưa".
Disconfirming check:
- `git show main:src/youtube/content.js | sed -n '112,127p'` — xác nhận pre-existing.

### F029 [P3] Nút `×` vẫn bấm được trong lúc "Đang hỏi…" — dismiss có thể bị lượt đang chạy phủ quyết hoặc nuốt mất

Severity: P3 | Confidence: medium
Source pointer: `src/youtube/content.js:329-334`, `:339-345`, `:363-368`
Evidence:
- Chỉ `go.disabled = true` khi recopy chạy; `x.addEventListener('click', hideRecopy)` không có guard theo `go.disabled`.
Plausible failure mode:
- Bấm `×` giữa lúc "Đang hỏi…" → `recopyEl = null`. `finally` (`:367`) không kích hoạt (đúng), nhưng nếu một `handOff` khác chạy song song gọi `showRecopy(urls)` thì thẻ tái xuất hiện ngược ý người dùng vừa dismiss.
Durable solution hypothesis:
- Disable/ẩn `×` khi `go.disabled === true`, hoặc dùng cờ `dismissed` để mọi hậu xử lý tôn trọng quyết định của người dùng.
Disconfirming check:
- `sed -n '322,346p' src/youtube/content.js` — xác nhận không có guard.

### F030 [P3] TEST GAP: không file test nào chạy `filterBundle` thật cùng lúc với content script — hai phép chuẩn hoá URL không bao giờ được đối chiếu

Severity: P3 | Confidence: high
Source pointer: `test/dom-harness.js:306-319` (youtube), `:502-514` (docs); `src/background/service-worker.js:653`
Evidence:
- Cả hai harness tự trả `{keep: message.urls, dropped: []}` hoặc để test tự định nghĩa response. Không file test nào `require` cả `service-worker.js` lẫn `content.js` trong cùng tiến trình.
- `filterBundle` thật chỉ được gọi từ `test/copied-log.test.js`, với URL gõ tay, **không** đi qua `canonicalUrl(videoId)` thật của content script.
Contract violated:
- Kiến trúc test tách lớp che đúng chỗ F020 chỉ ra (`canonicalUrl` ↔ `bundleKey`/`videoIdFrom`/`docKey`).
Plausible failure mode:
- Đổi định dạng URL ở một phía → không test nào đỏ, vì hai phía luôn được kiểm tách biệt qua mock.
Durable solution hypothesis:
- Một test tích hợp nạp cả hai file, nối `chrome.runtime.sendMessage` của content script thẳng vào listener thật của service worker, chạy kịch bản copy-lần-2.
Disconfirming check:
- `grep -rn "require(path.join(ROOT" test/*.test.js` — không file nào nạp cả hai.

### F031 [P3] TEST GAP: assert `.hidden` (IDL property) mù với cascade CSS; `src/docs/overlay.css` thiếu `[hidden]{display:none!important}`

Severity: P3 | Confidence: medium
Source pointer: `test/docs-panel.test.js:444`, `:450`, `:502`, `:540`; `src/docs/overlay.css`
Evidence:
- Test chỉ đọc `btn.hidden` — phản ánh có/không có attribute, độc lập với việc CSS có thực sự ẩn hay không.
- Hiện tại `.btn` **không** set `display` nên `[hidden]{display:none}` của UA vẫn thắng — không phải bug hôm nay, nhưng bất biến này giòn: một author rule `display` cho `.btn` sẽ thắng UA rule bất kể thứ tự.
- `popup.css:52` đã có `[hidden]{display:none!important}`; `docs/overlay.css` thì không.
Plausible failure mode (mutation sống sót):
- Thêm `.btn { display: inline-flex; }` vào `overlay.css` → nút *Copy lại* hiện trên trình duyệt thật dù `hidden === true`, nhưng `docs-panel.test.js` vẫn xanh 100%.
Durable solution hypothesis:
- Thêm `[hidden] { display: none !important; }` vào `src/docs/overlay.css`, đồng bộ với `popup.css`.
Disconfirming check:
- `grep -n "display" src/docs/overlay.css | grep -i "\.btn"` và `grep -n "\[hidden\]" src/docs/overlay.css src/popup/popup.css`.

### F032 [P3] TEST GAP: field `from` của `bundle-copied` không bao giờ được assert

Severity: P3 | Confidence: medium
Source pointer: `src/youtube/content.js:350-352`, `:256`; `test/youtube-bundle.test.js`
Evidence:
- `grep -n "\.from\b" test/youtube-bundle.test.js` → 0 assertion nào kiểm giá trị `from` của `bundle-copied`/`enqueue`, cả ở ca copy thường lẫn copy lại.
Plausible failure mode (mutation sống sót):
- Đổi `onRecopyClick` thành luôn `handOff(..., { from: '' })` (bỏ capture `lastDroppedFrom`) → 0 test đỏ, dù "Sổ ghi đúng ngữ cảnh gốc của lượt copy lại" mất âm thầm.
Durable solution hypothesis:
- `eq(msgs(h,'bundle-copied').pop().from, expectedLabel, ...)` cho cả hai ca với `from` khác nhau rõ rệt.
Disconfirming check:
- `grep -n "from" test/youtube-bundle.test.js` — hiện không có assertion nào về field này.

### F033 [P3] `note()` hard-code tiêu đề "YouTube → NotebookLM" cho cả lượt copy khởi từ bảng docs

Severity: P3 | Confidence: high
Source pointer: `src/background/service-worker.js:1382`; call site `:284` phục vụ cả `src/docs/content.js:533`
Evidence:
- `title: \`YouTube → NotebookLM — ${title}\`` — chuỗi cứng duy nhất cho MỌI `note()`.
- `test/handoff-jump.test.js` chỉ kiểm `body.message`, không kiểm `body.title`.
Contract violated:
- Nguyên tắc "không vờ như biết cái mình không biết" — gắn nhãn sai nguồn gốc.
Plausible failure mode:
- Người dùng bấm Copy trên bảng docs, nhận thông báo "YouTube → NotebookLM — Đã copy..." dù không đụng gì tới YouTube; khó phân biệt luồng nào khi dùng song song.
Durable solution hypothesis:
- `note()` nhận `title` đầy đủ từ call site, hoặc prefix theo `from`/`label` đã có sẵn trong cả hai `handOff`.
Disconfirming check:
- `rg -n "YouTube → NotebookLM" src/background/service-worker.js` — một chỗ định nghĩa, hai call site dùng chung.

### F034 [P3] `note()` cắt 300 ký tự từ cuối — phần "đáng đọc nhất" nằm ở cuối chuỗi

Severity: P3 | Confidence: medium
Source pointer: `src/background/service-worker.js:1383`
Evidence:
- `message: String(message).slice(0, 300)`.
- Đo worst-case hiện tại: YouTube ~193 ký tự (999 mỗi loại + tripped), docs ~166 — **chưa** vượt 300. Chuỗi ở NFC nên `.slice` đếm đúng ký tự hiển thị.
- Nhưng `parts.push(...)` mới được thêm 2 lần trong chính commit này, và các phần đáng đọc (`restricted`/`unknown`/`dropped`) luôn được push **sau** "Đã copy N link" nên nằm cuối. Chrome notification `basic` còn cắt ngắn hơn nữa trên nhiều nền tảng — rủi ro kép không được ghi ở đâu.
Contract violated:
- Bất biến ngầm "`parts.join(' · ')` luôn < 300" không có test nào giữ.
Plausible failure mode:
- Thêm một `parts.push` nữa, hoặc playlist > 999 video → phần bị cắt đúng là phần commit tự nhận là "đáng đọc nhất".
Durable solution hypothesis:
- Đặt phần counts lên đầu message; hoặc test biên assert `parts.join(' · ').length < 300` với input 999 mỗi loại.
Disconfirming check:
- `rg -n "slice\(0, 300\)" src/background/service-worker.js`; `rg -n "300" test/` → không có test nào.

### F035 [P3] `.btn--ghost` được gắn cho cả nút *Copy lại* lẫn *Copy link* nhưng không được định nghĩa trong `src/docs/overlay.css`

Severity: P3 | Confidence: high
Source pointer: `src/docs/content.js:283-284`; `src/docs/overlay.css`
Evidence:
- `grep -n "btn--ghost" src/docs/overlay.css` → 0 kết quả. Class chỉ tồn tại ở `src/popup/popup.css`, không áp dụng vì bảng docs dùng Shadow DOM riêng với `:host { all: initial }` chỉ nạp `overlay.css`.
Plausible failure mode:
- Cả *Copy lại* lẫn *Copy link* render giống hệt nút chính *Thêm N trang* (xanh `#1a73e8`) — không có phân cấp hành động nào. Không phải regression (nút `copy` đã vậy từ trước), nút mới chỉ kế thừa.
Durable solution hypothesis:
- Thêm `.btn--ghost { background: transparent; color: #1a73e8; border: 1px solid #1a73e8; }` vào `overlay.css`.
Disconfirming check:
- `grep -n "^\.btn" src/docs/overlay.css` — chỉ có `.btn`, `.btn:hover`, `.btn:disabled`.

### F036 [P3] `copyBtn.textContent = original` trong `finally` là code chết — `syncCounts()` ghi đè ngay dòng sau

Severity: P3 | Confidence: high
Source pointer: `src/docs/content.js:543-546`; `syncCounts` `:305-312`
Evidence:
- `finally { copyBtn.textContent = original; recopyBtn.disabled = false; syncCounts(); }` và `syncCounts` gán vô điều kiện `copyBtn.textContent = n ? \`Copy ${n} link\` : 'Copy link';`
- Bằng chứng phụ (bác bỏ một nghi ngờ khác): `syncCounts` cũng gán lại `copyBtn.disabled`/`goBtn.disabled` theo `checkedRows().length`, nên **không** có ca nút chết cứng dù `finally` không reset trực tiếp.
Durable solution hypothesis:
- Bỏ biến `original` và dòng gán thừa; để `syncCounts()` là nguồn sự thật duy nhất.
Disconfirming check:
- Đọc `:305-312` và `:543-546` cạnh nhau.

### F037 [P3] Comment `BUNDLE_FILTER` không ghi field `counts`, và `counts` không có consumer nào ở production

Severity: P3 | Confidence: high
Source pointer: `src/common/shared.js:39`; `src/background/service-worker.js:679-682`
Evidence:
- Comment: `{urls} -> {keep, dropped}`. Code trả thêm `counts: {copied, queued}`.
- `rg -n "counts" src/youtube/content.js src/docs/content.js` → rỗng. Chỉ `test/copied-log.test.js:120` assert nó.
- Field có từ trước; commit này chạm đúng dòng comment liền kề mà không cập nhật.
Plausible failure mode:
- Ai đó gỡ `counts` (tưởng an toàn vì comment không nhắc) → `copied-log.test.js` đỏ bất ngờ.
Durable solution hypothesis:
- Sửa comment thành `{urls} -> {keep, dropped, counts}`, hoặc gỡ `counts` khỏi `filterBundle` và sửa test tương ứng (ưu tiên gỡ thứ không có tác dụng).
Disconfirming check:
- `rg -n "counts" src/ test/`.

### F038 [P3] Ticket 006 đặc tả `{keep, dropped, reason}` nhưng code trả `{keep, dropped, counts}` + `dropped[i].why`

Severity: P3 | Confidence: high (khác biệt câu chữ) / low (có phải bug hành vi hay chỉ viết tắt)
Source pointer: `docs/tickets/006-duong-trao-tay.md:144`, `:697`; `src/background/service-worker.js:670-682`
Evidence:
- Ticket: "service worker trả `{ keep, dropped, reason }`". Không có field `reason` top-level nào tồn tại; lý do nằm ở cấp item (`why`).
Durable solution hypothesis:
- Sửa câu chữ ticket cho khớp, hoặc thêm field `reason` top-level nếu có bề mặt tương lai cần tổng hợp theo lý do.
Disconfirming check:
- `grep -n "reason" docs/tickets/006-duong-trao-tay.md` đối chiếu `sed -n '653,682p' src/background/service-worker.js`.

### F039 [P3] `hideRecopy` gắn thẳng làm click handler — nhận `MouseEvent` làm tham số đầu

Severity: P3 | Confidence: low (footgun tiềm ẩn, chưa gây lỗi)
Source pointer: `src/youtube/content.js:334`, `:339`
Evidence:
- `x.addEventListener('click', hideRecopy);` và `function hideRecopy() { ... }` không khai tham số nào — hiện tại vô hại.
Plausible failure mode:
- Ai đó thêm tham số cho `hideRecopy` (ví dụ khi sửa F009 để hỗ trợ multi-slot) sẽ vô tình nhận `Event` object mà không có type-check nào cảnh báo.
Durable solution hypothesis:
- `x.addEventListener('click', () => hideRecopy());`
Disconfirming check:
- `grep -n "function hideRecopy" -A6 src/youtube/content.js`.

### F040 [P3] Overlay YouTube không có Shadow DOM/reset và hard-code nền tối — trái với bảng docs

Severity: P3 | Confidence: high (sự kiện) / low (có phải lỗi của commit này)
Source pointer: `src/youtube/overlay.css:136-165`; `src/youtube/content.js:313`
Evidence:
- `showRecopy` gắn thẳng vào `document.documentElement`, cô lập chỉ dựa vào tiền tố `nblm-` + specificity. Đối chứng: `src/docs/content.js:251` dùng `attachShadow` thật với `:host { all: initial }`.
- `rg -n "prefers-color-scheme|prefers-reduced-motion" src/youtube/overlay.css` → 0 hit. YouTube có light mode; overlay hard-code `#202124`/`#e8eaed`.
- Kế thừa nguyên trạng từ `.nblm-toast`/`#nblm-bar`, **không** phải regression mới. `test/ui-isolation.test.js` chỉ gác tiền tố id và `OWN_UI`, không gác reset CSS.
Durable solution hypothesis:
- Ngoài phạm vi patch này; nếu sửa thì phải sửa đồng loạt cả ba overlay YouTube.
Disconfirming check:
- `rg -n "attachShadow" src/youtube/` → 0 hit.

### F041 [P3] `#nblm-bar` có thể chồng `#nblm-recopy` trên viewport hẹp — `clearSelection()` chạy sau `handOff`

Severity: P3 | Confidence: medium
Source pointer: `src/youtube/content.js:672-683`; `src/youtube/overlay.css:65-75`
Evidence:
- `if (act === 'copy') { ... await handOff(picked); ... clearSelection(); }` — `showRecopy` chạy bên trong `handOff` trong khi `#nblm-bar` còn nguyên trên DOM.
- `#nblm-bar { left: 50%; bottom: 24px; transform: translateX(-50%) }` vs `.nblm-recopy { right: 24px; bottom: 96px }`.
Plausible failure mode:
- Cửa sổ hẹp + thanh nổi nhiều nút → tràn sang phải, chồng thẻ recopy vừa xuất hiện.
Durable solution hypothesis:
- Trì hoãn `showRecopy` tới sau `clearSelection()`, hoặc đặt thẻ lệch trục hoành của thanh nổi.
Disconfirming check:
- `rg -n "clearSelection\(\)" src/youtube/content.js` — xác nhận thứ tự.

### F042 [P3] `toastEl`/`recopyEl` không có guard `isConnected` — biến JS có thể trỏ vào node mồ côi

Severity: P3 | Confidence: low
Source pointer: `src/youtube/content.js:66-69`, `:311-313`; đối chứng `src/youtube/panel.js:56-58`
Evidence:
- `panel.js`: `if (!panel || !panel.isConnected) panel = build();`
- `content.js` chỉ kiểm `if (!toastEl)` / `if (!recopyEl)` — falsy theo biến JS, không kiểm `.isConnected`.
Plausible failure mode:
- Nếu node bị gỡ khỏi DOM mà biến không được đặt `null`, `showRecopy` `replaceChildren` vào hư không — người dùng không thấy nút nào, không có lỗi nào nổi lên. Chưa quan sát được YouTube thật sự làm điều này với con trực tiếp của `<html>`.
Durable solution hypothesis:
- `if (!recopyEl || !recopyEl.isConnected) { ... }`, đồng bộ với `ensure()` của `panel.js`.
Disconfirming check:
- `rg -n "isConnected" src/youtube/` → chỉ có ở `panel.js:57`.

### F043 [P3] Không có trần kích thước Sổ; `recordCopied` ghi lại toàn bộ log mỗi lần

Severity: P3 | Confidence: high
Source pointer: `src/background/service-worker.js:693-708`, `:712`
Evidence:
- `COPIED_PAGE = 50` chỉ giới hạn số dòng **hiển thị** ở popup. `recordCopied` `push` vô hạn và `chrome.storage.local.set` toàn bộ mảng mỗi lượt.
- Khớp `manifest.json` có `unlimitedStorage` và thiết kế ticket ("Sổ chỉ lớn lên, xoá bằng nút tay") — không phải bug chức năng.
Plausible failure mode:
- Ghi chậm dần tuyến tính theo kích thước Sổ; cộng với F021 (không khoá) làm cửa sổ đua rộng hơn theo thời gian.
Durable solution hypothesis:
- Không cần sửa; nếu muốn, cắt log theo ngưỡng tuổi/số dòng khi ghi.
Disconfirming check:
- `sed -n '693,715p' src/background/service-worker.js`.

### F044 [P3] `if (summary)` biến "có báo hay không" thành bất biến ngầm của call site

Severity: P3 | Confidence: high
Source pointer: `src/background/service-worker.js:284`
Evidence:
- `rg -n "JUMP_NOTEBOOK" src/` → đúng 2 call site (`src/youtube/content.js:272`, `src/docs/content.js:533`), cả hai đều truyền `summary`. Không có bề mặt nào hiện tại bị câm.
Plausible failure mode:
- Bề mặt thứ ba gọi `JUMP_NOTEBOOK` quên truyền `summary` → im lặng bỏ qua thông báo, không warning, không error — đúng loại "im lặng sai" mà commit này vừa sửa ở chỗ khác.
Durable solution hypothesis:
- Log/cảnh báo khi `JUMP_NOTEBOOK` tới mà không có `summary`, hoặc đặt `summary` thành tham số bắt buộc trong hình dạng message ghi ở `shared.js`.
Disconfirming check:
- `rg -n "JUMP_NOTEBOOK" src/` — nếu xuất hiện call site thứ ba không có `summary`, finding này chuyển từ rủi ro thành bug đang active.

## Verification Queue

- F001: `sed -n '199,222p;339,369p' src/youtube/content.js; sed -n '460,480p' src/docs/content.js` — tìm nhánh gán `dropped` khác `[]` khi `skipDedupe`
- F002: `rg -n "d\.url|why" src/youtube/content.js src/docs/content.js` — tìm chỗ lọc theo `why`
- F003: `git diff main...HEAD -- src/docs/content.js | grep -n "disabled = true"` + `sed -n '424,460p' src/docs/content.js`
- F004: `rg -n "await send\(MSG.BUNDLE_COPIED" src/youtube/content.js` + đọc `send()` `:40-47`
- F005: `rg -n "notifications.create" src/background/service-worker.js`; `rg -n "note\(" test/handoff-jump.test.js`
- F006: `grep -n "bundle-filter" test/youtube-bundle.test.js`; `grep -n "drop:" test/docs-panel.test.js`
- F007: quét fixture trong `test/youtube-bundle.test.js` tìm `videoId` lặp
- F008: đọc `src/youtube/content.js:199-288` tìm `await` không bọc try/catch
- F009: `rg -n "session|generation|inFlight|token" src/youtube/content.js`
- F010: `sed -n '258,286p' src/background/service-worker.js`
- F011: `sed -n '467,538p' src/docs/content.js` — xác nhận `return true` không xét `blocked`
- F012: `sed -n '279,290p;467,476p' src/docs/content.js`; `rg -n "dismiss" src/docs/content.js`
- F013: ghép chuỗi dài nhất từ `src/youtube/content.js:229-234`, đếm ký tự, ước lượng dòng ở 380px/13px
- F014: `sed -n '486,546p' src/docs/content.js` — đếm cặp try/catch
- F015: `grep -n "copyBtn.textContent\|recopyBtn.textContent" src/docs/content.js`
- F016: `rg -n "aria-label|aria-live|role=" src/youtube/content.js`
- F017: `grep -n "onNavigate" -A8 src/youtube/content.js`
- F018: `rg -n "fullscreen" src/` (0 hit); cần trình duyệt thật để xác nhận hành vi top layer
- F019: đọc `test/dom-harness.js:520-523`; `grep -n "reject\|throw new Error" test/docs-panel.test.js`
- F020: `sed -n '20,36p' src/youtube/transcript.js` so `videoIdFrom` trong `src/common/shared.js`
- F021: `rg -n "getCopiedLog\(\)|withLock|mutex" src/`
- F022: `git show main:src/youtube/content.js | sed -n '186,200p'` so `sed -n '206,216p' src/youtube/content.js`
- F023: `sed -n '164,169p' src/youtube/content.js` so `git show main:src/youtube/content.js | sed -n '153,161p'`
- F024: `rg -n "function extract" -A30 src/youtube/transcript.js` — có ném khi 0 dòng không
- F025: `rg -n "function load" -A10 src/docs/content.js`
- F026: `sed -n '424,457p' src/docs/content.js`
- F027: `git show main:src/youtube/content.js | sed -n '170,180p'` so `sed -n '199,224p' src/youtube/content.js`
- F028: `git show main:src/youtube/content.js | sed -n '112,127p'`
- F029: `sed -n '322,346p' src/youtube/content.js`
- F030: `grep -rn "require(path.join(ROOT" test/*.test.js`
- F031: `grep -n "\[hidden\]" src/docs/overlay.css src/popup/popup.css`; `grep -n "display" src/docs/overlay.css | grep -i "\.btn"`
- F032: `grep -n "from" test/youtube-bundle.test.js`
- F033: `rg -n "YouTube → NotebookLM" src/background/service-worker.js`
- F034: `rg -n "slice\(0, 300\)" src/background/service-worker.js`; `rg -n "300" test/`
- F035: `grep -n "btn--ghost" src/docs/overlay.css src/popup/popup.css`
- F036: đọc `src/docs/content.js:305-312` và `:543-546` cạnh nhau
- F037: `rg -n "counts" src/ test/`
- F038: `grep -n "reason" docs/tickets/006-duong-trao-tay.md` + `sed -n '653,682p' src/background/service-worker.js`
- F039: `grep -n "function hideRecopy" -A6 src/youtube/content.js`
- F040: `rg -n "attachShadow" src/youtube/`; `rg -n "prefers-color-scheme" src/youtube/overlay.css`
- F041: `rg -n "clearSelection\(\)" src/youtube/content.js`
- F042: `rg -n "isConnected" src/youtube/`
- F043: `sed -n '693,715p' src/background/service-worker.js`
- F044: `rg -n "JUMP_NOTEBOOK" src/`

## Strongest Reason Not To Merge Yet

Tính năng chính của commit — nút *Copy lại* trên YouTube — tự huỷ đường quay lại của chính nó ở mọi lượt thất bại (F001). Vì `skipDedupe: true` khiến `dropped` luôn là `[]`, dòng `showRecopy(dropped..., label)` ở `src/youtube/content.js:222` luôn quy về `hideRecopy()`, và nó chạy **trước** cả kiểm `keep.length` lẫn `writeText`. Bấm *Copy lại*, cửa 3 từ chối hết hoặc clipboard bị từ chối vì tab mất focus, thì thẻ đã biến mất, `lastDropped` đã bị xoá, và cơ chế phục hồi trong `finally` không bao giờ kích hoạt (F008) vì `handOff` không ném. Người dùng mất đúng cái mà commit message mô tả là lý do tồn tại của nút này: "đường lấy lại MỘT link là *Xoá sổ* toàn bộ, hai nhịp, không hoàn tác."

Bản docs của cùng tính năng viết đúng luật (`setRecopy(copied ? [] : urls)`) và có test cho ca thất bại — nên đây không phải chuyện thiếu khái niệm, mà là một bề mặt bị bỏ sót. Cộng thêm F002 (Copy lại đưa Mục `why:'queued'` lên clipboard rồi ghi Sổ, trong khi Lượt chạy vẫn sẽ tạo Nguồn cho Mục đó — Nguồn trùng phải xoá tay, đúng thứ `CONTEXT.md` cảnh báo) và F003 (bảng docs mất chốt disable đồng bộ, mở lại đúng cửa sổ double-click mà cả commit này được viết ra để đóng), ba chỗ này đều tấn công thẳng vào mục tiêu đã tuyên bố.

Bộ test không bắt được điều đó, và F006/F007 cho biết vì sao: mọi ca "cửa 2 loại" ở cả hai bề mặt đều là all-or-nothing, nên mutation thay phép lọc từng phần tử bằng một điều kiện nhị phân sống sót toàn bộ suite — và phép khử trùng `videoId` mới thêm trong `badgeGate` không có một dòng test nào.

## Next Receive Prompt

Use /ultra-review-receive to verify docs/ultrareview/26-08-31-duong-trao-tay-copy-lai-round-1.md and implement confirmed owner-clean fixes.
