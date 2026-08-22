---
status: done
labels: [ready-for-agent, bug]
blocked_by: []
spec: docs/spec/0001-notebooklm-importer.md
---

# 014 — Khai thêm host `notebook.google.com` (bug đang tồn tại)

## Vì sao ticket này chen lên trước

Từ 2026-07-16 Google đổi tên NotebookLM thành "Gemini Notebook", và
`https://notebooklm.google.com/` **302 sang `https://notebook.google.com/`**. `batchexecute` thì
dual-serve trên cả hai host (probe live 2026-08-04, ghi trong ADR 0028 của `notebooklm-py`).

`manifest.json` của repo này chỉ khai `https://notebooklm.google.com/*`, ở **cả hai chỗ**:
- `host_permissions` (dòng 15)
- `content_scripts[2].matches` (dòng 53)

Hệ quả nếu tài khoản đã bị chuyển cohort: content script `src/notebooklm/content.js` **không nạp**
trên trang đã redirect, nên toàn bộ đường đẩy hiện tại (ticket 003, 004) im lặng không làm gì.
Đây là bug của đường DOM đang có, **không** phải chuyện của ADR 0012.

## Delivers

Extension chạy đúng trên cả hai host, bất kể tài khoản đã bị chuyển hay chưa.

## Scope

- `host_permissions` và `content_scripts` khai cả hai host.
- Chỗ nào trong code hard-code hostname thì gom về một hằng số — `service-worker.js:38`
  (`NOTEBOOK_URL`) và mọi `chrome.tabs.query` lọc theo URL là ứng viên. Tìm hết bằng `rg`, đừng
  sửa mỗi chỗ bạn nhớ.
- Tab đang mở ở host này phải được nhận ra là tab NotebookLM khi extension đang tìm host kia —
  nếu không, mỗi lần đẩy lại mở thêm một tab mới bên cạnh tab đã có.

## Acceptance

- Trả lời được: **test nào chết** nếu hoán vị hai hostname cho nhau ở bất kỳ chỗ nào chúng xuất
  hiện? Hai chuỗi cùng kiểu, đều là host Google hợp lệ, và với tài khoản chưa bị chuyển thì hoán
  vị vẫn cho một lần chạy "thành công".
- Trả lời được: test nào chết nếu chỉ khai một trong hai host? Một danh sách thiếu một phần tử
  không có triệu chứng nào cho tới khi gặp đúng cohort.
- `test/manifest.test.js` đã canh chuỗi nạp script; mở rộng nó để canh luôn tập host, hoặc nói rõ
  vì sao không nên.
- Suite xanh, in `tests N`.

## Ngoài phạm vi

Không đụng gì tới đường RPC (ticket 015). Ticket này chỉ sửa host.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `28ca096`. Không cần vá vòng hai.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 499, 16 file.` (+8)

### Ba phép thử Lead chạy, cả ba ĐỎ
1. **Đảo thứ tự `NOTEBOOK_HOSTS`** (`['notebook…', 'notebooklm…']`) → ĐỎ. Đây là cặp Lead chọn vì
   peer tự viết "thứ tự có nghĩa: phần tử đầu là host mà extension tự mở tab tới" — và lý do đúng:
   chiều redirect chỉ có một, host cũ dẫn sang host mới cho tài khoản đã chuyển, **chiều ngược lại
   không có gì bảo đảm**.
2. **Bỏ host thứ hai khỏi hằng số** → ĐỎ (câu acceptance 2).
3. **Bỏ host thứ hai khỏi `manifest.json` mà giữ nguyên hằng số** → ĐỎ. Tức phép đối chiếu chạy
   **hai chiều**, không chỉ một.

### Thiết kế đáng ghi
Peer không sửa ba chỗ rồi thôi. Nó dựng một hằng số `NOTEBOOK_HOSTS` duy nhất, suy
`NOTEBOOK_MATCH_PATTERNS` từ đó, và cho `test/manifest.test.js` đối chiếu **cả ba** chỗ dùng
(`host_permissions`, `content_scripts.matches`, `chrome.tabs.query`) với đúng hằng số ấy. Giữ đúng
tinh thần ticket 008 vừa lập: không thêm một danh sách viết tay thứ hai.

### Nợ ghi lại
Chưa xác minh tài khoản của owner đã bị chuyển cohort hay chưa. Việc đó không cần thiết nữa —
extension giờ chạy đúng ở cả hai trạng thái — nhưng nếu muốn biết thì một `curl -I
https://notebooklm.google.com/` **không đăng nhập** là đủ.
