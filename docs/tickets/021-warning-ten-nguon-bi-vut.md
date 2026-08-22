---
status: open
labels: [ready-for-agent]
blocked_by: []
spec: docs/spec/0001-notebooklm-importer.md
---

# 021 — `warning` "không đặt được tên Nguồn" bị vứt ở cùng chỗ với `via`

## Vì sao ticket này tồn tại

Ticket 019 nối `pushVia` từ `pushSource` lên bảng tổng kết. Cùng giá trị trả về ấy còn mang một
trường nữa **cũng bị vứt ở đúng dòng đó**: `addTextSource` trả `{ ok, name, named, warning }`, và
`warning` là câu *"không thấy ô tiêu đề trong hộp thoại — NotebookLM sẽ tự đặt tên thay cho X"*.

Peer của ticket 019 tìm ra và **không** tự làm, vì ticket không hỏi. Đúng kỷ luật, nên nó thành
ticket này.

Vì sao đáng làm chứ không phải chuyện trang trí: **tên Nguồn là vĩnh viễn** (ADR 0010 — extension
không sửa và không xoá Nguồn được), và **ADR 0009 đọc chính tên ấy để biết phần nào đã có**. Một
lượt chạy mà NotebookLM tự đặt tên thay ta là một lượt chạy mà Sổ đã import và notebook thật
**nói hai chuyện khác nhau** — im lặng, và không sửa lại được.

## Delivers

Bảng tổng kết nói ra Nguồn nào không được đặt tên theo ý ta, ngay trong lượt chạy ấy.

## Scope

- Cùng chỗ nối của ticket 019 (`queue-engine.js`, chỗ giữ giá trị trả về của `pushSource`).
  **Không cần một dòng plumbing nào** — giá trị đã nằm sẵn ở đó.
- Đường RPC (`src/notebooklm/rpc.js`) trả `name` và `status` chứ không trả `warning`. Quyết định
  xem hai đường có nên nói cùng một ngôn ngữ ở chỗ này không, và **nói rõ vì sao** — đừng lặng lẽ
  chỉ nối một đường.
- Không đổi hợp đồng trả về của `pushTextSource` (ticket 015 đã khoá bằng test).

## Acceptance

- Trả lời được: test nào chết nếu `warning` của Nguồn A bị gán cho Nguồn B? Hai chuỗi cùng kiểu,
  và một lượt chạy có **một** Nguồn cảnh báo thì mọi hoán vị đều xanh — xem `WORKSPACE_PROTOCOL.md`
  v10, gồm cả luật **tâm đối xứng** vừa thêm sau ticket 019.
- Trả lời được: test nào chết nếu `warning` luôn im lặng khi `named === false`?
- Suite xanh, in `tests N`.
