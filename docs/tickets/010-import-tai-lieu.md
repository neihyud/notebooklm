---
status: done
labels: [ready-for-agent]
blocked_by: [005, 009]
spec: docs/spec/0001-notebooklm-importer.md
---

# 010 — Import Nhánh tài liệu end-to-end

## Delivers
Chọn một Nhánh tài liệu trong Bảng chọn → cả nhánh thành một Nguồn trong Notebook đích.

## Scope
- Nối hàng đợi tài liệu vào engine (ticket 003).
- Cắt theo ranh giới Nhánh; nhánh nào một mình vượt trần mới cắt theo số từ (ADR 0005).
- Phím tắt `Alt+Shift+D`, popup, và menu chuột phải để gọi Bảng chọn.

## Acceptance
- Import một nhánh 40 trang: đúng **một** Nguồn, không phải 40.
- 80 trang tài liệu **không** bị xếp hàng sau các video đang trích (ADR 0007) — đo bằng nhật ký
  chạy của engine.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN**, sau hai vòng vá. Commit `0b230a2` (chỗ nối) + `9f5b264` (vòng hai).

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 619, 22 file.` (nền 567 / 19 file)

### Vòng một — cổng review của peer bắt bốn lỗi, một trong đó là hạng lỗi ticket 009
`src/docs/content.js` **thiếu `install(root)` lúc nạp**. Suite xanh 609/609 vì mọi test gọi thẳng
`C.install(...)`; Chrome nạp file thì không ai gọi, nên `waitForTab(PING_DOCS)` timeout 10 giây và
**Bảng chọn không bao giờ mở**. Cùng hình với `.filter` trên `children` của ticket 009: thứ chỉ
đúng khi file được *nạp* thì test gọi thẳng hàm không bao giờ chạm tới.

Peer không vá một dòng. Nó cho `test/manifest.test.js` nạp **cả chuỗi `importScripts`/content
script vào một ngữ cảnh V8 sạch** (`node:vm`) rồi đếm listener, và suy chuỗi nào cần kiểm từ mã
nguồn thay vì chép tay — nên nó phủ luôn `youtube/watch.js` và `notebooklm/content.js` (gỡ
`install` ở từng file, cùng test ấy chết ở cả hai), và sẽ phủ chuỗi thứ tư nếu ai thêm. Có một test
đối chứng cho chuỗi cầu MAIN world (0 listener, cố ý) để test kia không thành thứ luôn đúng.

Ba lỗi còn lại: `options` viết tay nuốt mất `selectors` của trang Cài đặt nên `findSidebar` rơi về
mặc định; `Phải mở tab ẩn: N trang` đếm cả nhánh nấc-2-**hỏng** nên nói ngược ở đúng ca nó sinh ra
để nói đúng; menu chuột phải `contexts: ['page']` biến mất khi bấm vào link, tức vào chính sidebar.

### Vòng hai — cặp Lead chọn, ngoài danh sách của peer, và nó hở
**`docsTabId` ↔ `hiddenTabId`.** Hai số nguyên cùng kiểu, cả hai đều là tab id hợp lệ, cả hai đều
đứng ở trang tài liệu. Đổi vai ở `readHiddenTab` và ở nhánh `DOC_TAB_GO`:

```
readHiddenTab():  const tabId = await ensureHiddenTab();  →  const tabId = docsTabId;
DOC_TAB_GO:       chrome.tabs.update(await ensureHiddenTab(), …)  →  …(docsTabId, …)
```

→ `test/run.sh: XANH — tests 614, 21 file.` Không một test nào chết.

Hành vi sau hoán vị: nấc 2 lái **tab người dùng đang đọc** qua 80 trang. Mọi lời gọi `chrome.*`
thành công, không ngoại lệ, không badge lỗi; `hiddenTabId` thành code chết mà không ai phạt. Peer
đã tự ghi lớp `chrome.*` là "chỉ đọc bằng mắt" — nhưng **chưa phủ** và **phủ rồi mà lọt** là hai
chuyện, và chỗ này phủ được: repo đã tiêm `chrome` giả ở nơi khác.

Sau vá (`test/service-worker.test.js`, mới): Lead chạy lại đúng hai phép trên, **cả hai ĐỎ**
(A: 5 test chết, B: 2 test chết). Cách canh là **quan hệ**, không phải hình dạng — tập tab bị tiêm
files ∪ tab nhận `PING_DOCS`/`EXTRACT_DOC` phải **rời** tập tab bị `executeScript(func)` ∪
`tabs.update` ∪ `tabs.remove`; kèm một test đối chứng khẳng định một lượt chạy chạm **ba** tab, để
"rời nhau" không tự đúng vì chỉ có một tab trong cuộc. Peer kiểm thêm bốn cặp cùng hạng
(`extractDoc` vào tab ẩn; `closeHiddenTab` đóng tab đang đọc; `DOC_TAB_GO` về `docsHome`; tab ẩn
mở `active: true`) — đều chết.

### Harness xanh nhầm — peer tự bắt, đáng ghi thành hình
Bản `test/service-worker.test.js` đầu tiên gọi thẳng `func.call({location, document})`, nhưng
`snapshotOfPage` đọc `location` như biến tự do nên trong `vm` nó ném `ReferenceError` — mà
`readHiddenTab` nuốt mọi lỗi vào vòng thử lại 40 lượt. **Năm test vẫn xanh, về một lượt đọc chưa
bao giờ thành công**, và cả file chạy 80 giây. Thứ để lộ ra là `duration_ms`, không phải một
assertion. Cùng hạng với ticket 016: hỏng ở **thước đo**, không ở sản phẩm.

### ADR 0007 — đo bằng nhật ký chạy, không bằng lập luận
3 video × 200ms + 80 trang tài liệu, một lời gọi `runImport`:
```
trang tài liệu trích xong TRƯỚC video đầu tiên : 80/80
mốc trích xong của trang tài liệu cuối cùng    : + 169ms
mốc trích xong của video ĐẦU TIÊN              : + 203ms
số lượt đẩy chồng nhau nhiều nhất              : 1 (ADR 0007 đòi 1)
Nguồn đã tạo: 4 — docs.acme.dev — Hướng dẫn: 80 mục   ← ADR 0005: một nhánh, một Nguồn
```

### Nợ ghi lại
- `hiddenTabId` sống trong bộ nhớ service worker: MV3 khởi động lại giữa lượt chạy thì **rò một
  tab**. Chưa test được vì cần vứt rồi dựng lại ngữ cảnh giữa chừng.
- Hai lượt `PICK_DOCS` trên hai tab khác nhau: `docsTabId` chỉ nhớ tab cuối. Có chủ ý, chưa có test.
- `contexts: ['all']` chỉ được canh ở mức mã nguồn.
- Vẫn **chưa có lượt chạy nào trên Chrome thật** — đó là ticket 012.
