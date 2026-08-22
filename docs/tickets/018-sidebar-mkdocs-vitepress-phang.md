---
status: open
labels: [ready-for-agent]
blocked_by: [012]
spec: docs/spec/0001-notebooklm-importer.md
---

# 018 — `buildTree` suy biến thành danh sách phẳng trên MkDocs Material và VitePress

## Vì sao ticket này tồn tại

Ticket 012 quét bốn bộ tạo docs thật. Hai trong bốn cho cây **phẳng**:

- **MkDocs Material**: 94 mục, không quan hệ cha con. MkDocs chèn `<nav class="md-nav">` **giữa**
  `<li>` và `<ul>` con, nên `childrenMatching(li, 'ul, ol')` thấy 0.
- **VitePress**: sidebar dựng bằng `div`/`section`, không `ul`/`li`.

Hệ quả: đơn vị **Nhánh** của ADR 0005 suy biến. "Một nhánh 40 trang ra đúng một Nguồn" thành 94
mục phẳng — người dùng tick một mục thì được một Nguồn một trang, và muốn cả nhánh thì phải tick
tay từng mục.

Đây là **quan sát**, không phải lỗi làm hỏng lần chạy: Bảng chọn vẫn mở, vẫn import được. Nên nó
xếp sau 017 và 013.

## Delivers

`buildTree` đọc được quan hệ cha con trên cả hai bộ tạo, hoặc nói rõ vì sao không nên cố.

## Scope

- Chỗ sửa là `src/docs/sidebar.js` và `src/docs/selectors.js`, không phải `picker.js`.
- Ranh giới cần giữ: đừng biến `childrenMatching` thành "bới xuống mọi cấp" — làm thế thì trên một
  sidebar lồng ba cấp, cháu thành con và mọi nhánh gộp làm một.
- `via: 'flat'` phải còn là kết quả hợp lệ cho sidebar thật sự phẳng, không phải một trạng thái lỗi.

## Acceptance

- `node tools/verify-docs.mjs` → dán output thật cho **cả bốn** bộ tạo. Docusaurus và Sphinx+RTD
  đang đúng, không được hỏng đi.
- Trả lời được: test nào chết nếu `via: 'lists'` và `via: 'flat'` hoán vị cho nhau? Cả hai đều là
  nhãn hợp lệ và cả hai đều cho một Bảng chọn mở được.
- Trả lời được: test nào chết nếu phép bới cha con nhảy qua **hai** cấp thay vì một?
- Suite xanh, in `tests N`.
