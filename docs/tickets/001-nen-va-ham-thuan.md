---
status: done
commits: [feced80, 181c5cf]
labels: [ready-for-agent]
blocked_by: []
spec: docs/spec/0001-notebooklm-importer.md
---

# 001 — Nền extension và tầng hàm thuần

## Delivers
Chrome nạp được extension bằng Load unpacked, popup mở ra và hiện một hàng đợi rỗng. Cùng lúc,
Seam 1 (hàm thuần) có test chạy được bằng `bash test/run.sh`.

## Scope
- `manifest.json` Manifest V3, `minimum_chrome_version` 111.
- Module hằng số + hàm thuần dùng chung: bóc videoId mọi định dạng URL, bóc playlist id kể cả
  `WL`/`LL`, khử trùng lặp, bỏ dấu tiếng Việt (kể cả `đ`), mốc `[mm:ss]`/`[h:mm:ss]`, gộp
  transcript theo cửa sổ thời gian, dựng thân Nguồn kèm header ngữ cảnh, gói Nguồn gộp theo
  trần 500.000 từ, đặt tên Nguồn gộp (ADR 0010), khoá Sổ đã import (ADR 0006), chuẩn hoá URL
  tài liệu (phân biệt hash-route với neo trong trang), gộp ghi đè selector.
- Popup vỏ: khung hàng đợi, chưa cần chạy gì.
- `test/run.sh`.

## Acceptance
- `bash test/run.sh` xanh **và** in `tests N` với N > 0.
- Runner phải liệt kê file test rõ ràng: `node --test test/` trên Node 22 resolve `test/` thành
  module và chết bằng `MODULE_NOT_FOUND`, trông y hệt một test đỏ. Đã xảy ra thật ở repo này.
- Suite chạy 0 file phải là đỏ, không phải xanh.
- Trả lời được: test nào chết nếu hoán vị `itemId` ↔ `notebookId` trong khoá Sổ đã import?

## Nghiệm thu (Lead, 2026-08-21)

- Lead tự chạy `bash test/run.sh`: 57/57 xanh, Node 22.23.1.
- Hoán vị `host` → `hostname` ở `docIdentity()` và kiểm cùng-host: hai test chết đúng chỗ.
  Trước khi peer bổ sung, cặp này hở — suite xanh 55/55 sau hoán vị.
- Commit chỉ gồm file của ticket; tài liệu của Lead không bị đụng.
