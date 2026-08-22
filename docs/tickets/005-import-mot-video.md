---
status: done
labels: [ready-for-agent]
blocked_by: [002, 003, 004]
spec: docs/spec/0001-notebooklm-importer.md
---

# 005 — Import một video end-to-end, kèm Bản lưu transcript

## Delivers
Đường đi đầy đủ đầu tiên: bấm nút trên trang watch (hoặc `Alt+Shift+Y`) → trích → ghi file →
đẩy vào Notebook đích. Đây là ticket đầu tiên demo được cho người ngoài xem.

## Scope
- Nút trên trang watch cạnh Like/Share, phím tắt, và menu chuột phải trên link YouTube.
- Chọn Notebook đích từ popup ("Dùng notebook ở tab hiện tại").
- **Bản lưu transcript ghi ra đĩa trước khi thử đẩy**, mặc định, không phải bật (ADR 0011).
  Định dạng `.md` / `.srt` / `.vtt`; **không có `.txt`**.
- Nút chủ động trong popup để chạy hàng đợi mà không đụng NotebookLM.

## Nợ mang sang từ ticket 002

Năm file `src/youtube/*.js` chưa được khai trong `manifest.json` — hiện là JS mồ côi.
`page-bridge.js` cần `world: "MAIN"` và `run_at: "document_start"`. Ticket này là chỗ nối,
và phải nối xong trước ticket 011 (test toàn vẹn manifest sẽ đỏ nếu còn file mồ côi).

## Acceptance
- Ngắt mạng giữa chừng ở khâu đẩy: file transcript vẫn nằm trên đĩa.
- Trả lời được: test nào chết nếu hoán vị `start` ↔ `end` trong một segment? Nếu câu trả lời là
  "không cái nào", ticket chưa xong.
- Trả lời được: test nào chết nếu hoán vị dấu phân cách mili-giây giữa SRT (`,`) và VTT (`.`)?

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `00a74a2` (thân ticket) + `b7fc4e4` (bản vá sau nghiệm thu).

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 318, 10 file.` (T004 kết ở 218; ticket này +100.)

### Hai câu hỏi ticket bắt trả lời
- *Test nào chết nếu hoán vị `start` ↔ `end` trong một segment?* — hoán vị `stamp(line.start)` →
  `stamp(line.end)` ở `src/common/shared.js:252` (`sourceBody`): suite **ĐỎ**. Trả lời được.
- *Test nào chết nếu hoán vị dấu ms giữa SRT (`,`) và VTT (`.`)?* — hoán vị `SRT_MS_SEP` ↔
  `VTT_MS_SEP` ở `src/youtube/srt.js:34-35`: suite **ĐỎ**. Trả lời được.

### Hở Lead tìm được ngoài 25 hoán vị của peer
`src/background/importer.js`, `mergeMeta`: `url: pick(i.url, m.url)` → `pick(m.url, i.url)`.
Suite **vẫn xanh 314/314**.

Hậu quả thật: `meta.url` đi vào `contextHeader` thành dòng `- Link gốc: …` trong thân mỗi Nguồn —
chỗ người dùng nhấn để kiểm chứng một trích dẫn. `itemFromLink` lấy `i.url` từ link **vừa bấm chuột
phải**; adapter trích (`src/youtube/watch.js:262`) trả `m.url = target.location.href` = **tab đang
mở**. Bấm chuột phải lên một video gợi ý ở sidebar thì hai URL là hai video khác nhau và **cả hai
đều hợp lệ**, nên không gì lộ ra: Nguồn mang transcript video A với Link gốc trỏ video B.

Peer đã mô tả đúng nguy cơ này cho cặp `linkUrl` ↔ `pageUrl` (comment `importer.js:54-57`) và guard
nó ở `itemFromLink` — nhưng để hở lại cùng nguy cơ ấy một tầng bên dưới, ở `mergeMeta`.

**Đã vá** (`b7fc4e4`, +4 test): canh **quan hệ** "danh tính theo Mục, nội dung theo trang", không
khoá chuỗi URL cố định; một test đi tới tận thân Nguồn (`- Link gốc: …`) chứ không dừng ở hàm trung
gian; và một test canh chiều ngược (Mục không có url thì vẫn dùng url trang — "Mục thắng" là ưu
tiên, không phải bỏ hẳn). Lead xác minh lại: suite xanh 318, hoán vị lại dòng 59 → **ĐỎ**.

Comment `mergeMeta` giờ phát biểu bất biến chung — *nội dung theo trang, danh tính theo Mục;
`videoId` và `url` là danh tính* — thay vì chú thích một dòng lẻ.

### Nợ ghi lại, không chặn ticket này
1. `src/background/service-worker.js` và `install()` không có test (thuần keo `chrome.*`) — ticket
   012 phủ bằng kiểm trên trang thật.
2. **Không có adapter `timedtext` trong `watch.js`**: nó cần `captionBaseUrl` từ MAIN world, tức mở
   rộng `src/youtube/page-bridge.js` — `WORKSPACE_PROTOCOL.md` xếp việc đó vào quyết định của
   owner. Peer dừng lại và báo, đúng giao thức. **Đang chờ owner.**
3. `dataUrl` cho `chrome.downloads` có thể chạm giới hạn độ dài URL với video rất dài — chưa đo,
   chưa có ngưỡng. Ticket 012.
4. Chưa từng chạy một lần import thật vào notebook nào (không có authority).
