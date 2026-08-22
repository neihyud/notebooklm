---
status: done
labels: [ready-for-agent]
blocked_by: [005, 010]
spec: docs/spec/0001-notebooklm-importer.md
---

# 011 — Kỷ luật định tuyến tin nhắn và ba test toàn vẹn

## Delivers
Ba content script gặp nhau trên cùng một tab mà không giết nhau, và ba ràng buộc cấu trúc có
test canh.

## Scope
- Mỗi listener lọc theo tập loại tin nó nhận và **im lặng** với tin không phải của mình —
  không trả `{ok:false}`, vì trả lời sai còn tệ hơn không trả lời. Chrome lấy phản hồi đến
  trước, nên một script trả lời "lệnh lạ" cho ping của script kia là đủ để mọi thứ sau đó chết
  bằng một lỗi trỏ sai hẳn chỗ, kéo dài tới khi tab được tải lại.
- Bảng chọn tài liệu từ chối chạy trên youtube.com và notebooklm.google.com.
- Hàm bảo đảm script chỉ tin phản hồi có `ok: true`, không tin "có phản hồi".
- `exclude_matches` **không** chi phối `chrome.scripting.executeScript` — nó chỉ chi phối lúc
  Chrome tự tiêm.
- Ba test toàn vẹn: manifest, cấu hình, định tuyến tin nhắn.

## Acceptance
- Mỗi test toàn vẹn phải được **kiểm ngược bằng cách cố tình phá** thứ nó canh, và phải in ra
  chi tiết lệch. Handback phải kèm output của các lần phá đó.
- Cụ thể phải thử: xoá một file khỏi danh sách script, đảo thứ tự hai file, xoá `css` của một
  nhóm, thêm một loại tin mà quên khai báo, cho hai content script cùng nhận một loại tin, bỏ
  `ok: true` khỏi handler ping.
- Cảnh báo có thật: một test kiểu này từng **xanh nhầm** vì cửa sổ quét trượt sang nhánh kế bên
  và bắt nhầm `ok: true` của nó. Test chưa từng thấy đỏ là test chưa biết có tác dụng không.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN**, sau hai vòng. Commit `d89f4f4` + `afa1ab5`.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 638, 23 file.` (nền 619 / 22 file)

### Vòng một
Sáu phép phá bắt buộc chạy đủ. Hai chỗ peer trả lời thẳng thay vì bịa:
- **`css`: không có đối tượng.** `grep -c '"css"' manifest.json` → 0; extension dựng giao diện
  bằng inline style + shadow DOM. Peer chạy phép gần nhất (xoá nhóm `world: "MAIN"` → 3 fail).
- **Đảo `shared.js` ↔ `messages.js` trong `DOCS_SCRIPTS` không làm suite đỏ, và đó không phải lỗ
  hổng**: `messages.js` không phụ thuộc `shared.js`, nên hoán vị ấy là no-op cả trong test lẫn trên
  Chrome. Peer đảo một cặp **có** phụ thuộc thay thế → 4 fail. Đây là cách trả lời đúng cho một
  phép phá không có tác dụng: đổi phép, đừng đổi kết luận.

Chốt chặn đặt đúng chỗ: `exclude_matches` **không** chi phối `chrome.scripting.executeScript`
(nó không nhận `matches` lẫn `excludeMatches`; chỉ `registerContentScripts` có), nên chặn nằm ở
đường tiêm — `S.hasOwnContentScript` đọc `CONTENT_SCRIPT_MATCH_PATTERNS`, cùng tập host manifest
khai, không một danh sách viết tay thứ hai.

Ba chỗ peer tự phá ra rồi tự vá, cả ba đáng ghi:
1. `hasOwnContentScript` nằm ngoài `try` — `matchesPattern` ném khi gặp mẫu gõ sai, mà menu chuột
   phải và phím tắt không `await` → **unhandled rejection, không huy hiệu, không dấu vết**.
2. Test ping `await` vô hạn: `return true` mà quên `sendResponse` (lỗi MV3 có thật) làm **treo cả
   suite** thay vì làm đỏ.
3. Ký tự `\0` lạc vào helper lúc chép `patternToRegExp` — cũng là lý do git coi bản trước của
   `service-worker.test.js` là **binary**. Đã bỏ hẳn ký tự trung gian.

### Vòng hai — cặp Lead chọn, ngoài danh sách của peer, và nó hở
**Bảng khai `ACCEPTS.background` ↔ tập nhánh thật trong router.** Khai một loại tin đủ (`TYPES` +
`ACCEPTS.background`) mà **không viết nhánh nào** cho nó:

→ `test/run.sh: XANH — tests 636, 23 file.` Không một test nào chết.

Hành vi: `isFor('background', …)` trả true, không nhánh nào khớp, nó rơi xuống catch-all cuối
router — chỗ mang comment `// Còn lại đúng một loại` — và trả **`{ ok: true, result: <trạng thái
popup> }`**. Đây đúng thứ ticket 011 tồn tại để chặn, chỉ khác chỗ phát sinh: ticket lo hai script
tranh nhau trả lời, còn đây là **một listener tự trả lời sai cho chính mình**, phá thẳng luật
"chỉ tin `ok: true`, không tin có phản hồi".

Bất đối xứng là chỗ nhìn ra nó: peer đã lái **ba** content script thật để chứng minh chúng chỉ trả
lời đúng tập chúng khai; listener **thứ tư** — service worker — có bảng khai mà không test nào lái
nó đối chiếu với bảng ấy. `// Còn lại đúng một loại` là bất biến viết bằng chữ, không có gì cưỡng
chế.

Sau vá: `GET_STATE` có nhánh riêng như tám loại kia, và nhánh cuối của **cả bốn** router là
`M.unrouted(script, message)` — **ném**, vì khai nhận mà không xử lý là lỗi lập trình, không phải
một lượt chạy hỏng. Test lái cả bốn router qua **mọi** loại tin chúng khai
(`checked === ALL_TYPES.length` chặn test rỗng tuếch) rồi đòi không câu trả lời nào chạm mốc
`UNROUTED`; có vế đối chứng riêng canh `M.UNROUTED` và câu `unrouted()` dựng phải khớp nhau — lệch
thì test kia dò một chuỗi không tồn tại và im lặng đúng như thứ nó canh.

Lead chạy lại phép của mình sau vá: **ĐỎ**. Chết ở cả hai chiều (khai mà không nhánh; có nhánh mà
quên khai).

Cổng review của peer bắt thêm: `watch.js` và `notebooklm/content.js` soi tải trọng (`videoId`,
`source.notebookId`) **trước** khi chọn nhánh, nên một loại tin quên nhánh sẽ chết bằng
`tab này đang mở "dQw4w9WgXcQ", không phải video "AAAAAAAAAAA"` — lỗi trỏ hẳn sang chuyện khác,
đúng hình ticket này tồn tại để chặn. Đã đảo thứ tự.

### Nợ ghi lại
- Menu chuột phải **vẫn hiện** trên youtube.com và NotebookLM: `contextMenus` chỉ có
  `documentUrlPatterns`, không có `excludeDocumentUrlPatterns`, nên diễn đạt phép loại trừ đòi một
  danh sách viết tay thứ hai. Bấm vào thì nhận huy hiệu lỗi. Quyết định có chủ ý của peer, Lead
  giữ nguyên.
- `YOUTUBE_MATCH_PATTERNS` rộng hơn `YT_HOSTS` (`studio.youtube.com` bị chặn Bảng chọn dù không
  mang video nào). Cố ý, nhưng đây là lần đầu hai danh sách youtube trong `shared.js` khác phạm vi.
- Loại tin so bằng chuỗi viết thẳng (không qua `TYPES`) là code chết mà không test nào chỉ ra —
  bắt nó cần quét mã nguồn, tức canh hình dạng.
- **Ba ticket liên tiếp (010, 011, và 016 trước đó) đều ghi "chưa chạy trên Chrome thật" vào phần
  không phủ được.** Đó là ticket 012, và nó là ticket kế tiếp.
