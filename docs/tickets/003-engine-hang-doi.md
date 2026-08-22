---
status: done
commits: [71a791d]
labels: [ready-for-agent]
blocked_by: [001]
spec: docs/spec/0001-notebooklm-importer.md
---

# 003 — Engine hàng đợi (Seam 2), tách khỏi API của Chrome

## Delivers
Một engine thuần nhận danh sách Mục hàng đợi cùng hai adapter (trích, đẩy) và trả về nhật ký
chạy. Toàn bộ ADR 0005–0009 kiểm được ở đây bằng adapter giả, không cần Chrome.

## Scope
- Hai hàng đợi, song song ở khâu trích, **độc quyền ở khâu đẩy** (ADR 0007).
- Gom Nguồn gộp và đẩy dần: chốt phần khi chạm ngưỡng, không đợi biết tổng số phần (ADR 0008).
- Cắt playlist theo dung lượng, tài liệu theo ranh giới Nhánh (ADR 0005).
- Sổ đã import khoá theo cặp (mục, Notebook đích), tách hẳn khỏi hàng đợi (ADR 0006).
- Bảng tổng kết cuối lần chạy: mục nào rớt và vì sao.
- Ước lượng số Nguồn từ tổng thời lượng, trình bày đúng như một ước lượng.
- Trạng thái lưu bền, dừng và thử lại được.

## Acceptance
- Test bằng adapter giả cho từng ràng buộc trên. Riêng ba cái này là bắt buộc:
  - mục hỏng **không** chặn nguồn đang gom; nguồn vẫn được chốt và đẩy với phần đã có;
  - hai hàng trích chồng lấn theo thời gian, nhưng **không bao giờ có hai lần đẩy chồng nhau**;
  - cùng một mục vào hai Notebook đích khác nhau thì **không** bị coi là trùng.
- Bảng tổng kết phải có test: 54 mục vào một nguồn lẽ ra 55 thì test đỏ. Không có test này thì
  quyết định gộp nguồn âm thầm nuốt dữ liệu — xem `WORKSPACE_PROTOCOL.md`.

## Nghiệm thu (Lead, 2026-08-21)

- Lead tự chạy `bash test/run.sh`: 88/88 xanh (57 cũ + 31 mới).
- Hai cặp hoán vị **ngoài** danh sách 24 của peer, cả hai đều bị bắt:
  - `parts` ↔ `supplements` ở nhánh *trả lại chỉ số khi đẩy hỏng* (khác chỗ đặt tên) → chết
    ở "đẩy hỏng không tiêu mất chỉ số phần (ADR 0010)";
  - `group.source` ↔ `groupBase(group)` giữa phần 1 và phần ≥2 của Nhánh tài liệu → chết 2 test.
- Hai câu peer chuyển lên Lead đã quyết: ADR 0008 sửa câu chữ cho khớp cách đọc của peer
  (mục hỏng **không chặn** nguồn, không phải chốt nguồn ngay); ADR 0010 bổ sung mẫu tên cho
  nhánh tài liệu một mình vượt trần.
