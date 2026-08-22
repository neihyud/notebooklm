---
status: proposed
---

# Tách `tools/` ra khỏi sản phẩm

Đường `yt-dlp` nhanh gấp khoảng ba lần đường extension với video private và chạy được cả khi
trình duyệt đóng — nghĩa là ở đúng use case flagship, con đường phụ thắng con đường chính.
Giữ nó trong cùng repo buộc tài liệu của sản phẩm phải quảng cáo cho thứ thay thế chính nó,
và điều đó bóp méo cả hai. Tách ra, không phải vì nó tệ mà vì ngược lại.

## Ranh giới

Chỉ phần `yt-dlp` tách ra: `fetch-transcripts.sh`, `subs-to-md.mjs`, `txt-to-md.mjs`,
`videos.txt`. Các script kiểm chứng trên trang thật (`verify-live.mjs`, `verify-docs.mjs`,
`probe-sidebar.mjs`) ở lại — chúng chạy chính mã nguồn của extension và là công cụ test của nó,
không phải đường thay thế.

## Consequences

Người chỉ cần file transcript nên được chỉ thẳng sang công cụ kia. Việc ghi transcript ra đĩa
vẫn giữ trong extension, nhưng mục đích thu hẹp lại đúng một việc: cứu transcript đã trích khi
khâu đẩy vào NotebookLM trục trặc, thay vì trích xong rồi vứt đi. Hình dạng cuối của nó ở
ADR 0011.
