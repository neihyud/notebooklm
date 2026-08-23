---
status: open
labels: [ready-for-agent, risk]
blocked_by: []
spec: docs/spec/0001-notebooklm-importer.md
---

# 022 — Cửa vào `runQueue` chặn thiếu một nửa, và cái lọt qua làm mất Sổ đã import

## Vì sao ticket này tồn tại

Peer của ticket 021 tìm ra trong lúc rà một chuyện khác; Lead đã tự chạy lại và **xác nhận**.

`queue-engine.js:176` — cửa vào chỉ đòi id **khác rỗng** (`String(item.id).trim()`), trong khi
`S.ledgerKey` đòi id **là chuỗi** (`collapse` gạt mọi thứ không phải chuỗi). Một Mục `{ id: 7 }`
lọt qua cửa, chạy được một quãng, rồi **ném giữa vòng chạy**.

Đo được (Lead chạy, 2026-08-23):
```
items: [{ id: 'aaa', … }, { id: 7, … }]
→ NÉM: ledgerKey: thiếu mục
→ nhưng đã đẩy thành công: ["Video một"]
```

Hậu quả nằm ở hai dòng ấy đọc cùng nhau. `runQueue` ném **sau khi** đã đẩy Nguồn đầu, nên:

1. **Nhật ký của lượt chạy mất** — không có bảng tổng kết, người dùng không biết Nguồn nào đã vào.
2. **Sổ đã import vừa cập nhật cũng mất** — lần chạy sau không biết Nguồn ấy đã có.

Cộng lại: lần chạy sau **đẩy lại** Nguồn đã đẩy. Nguồn đã đẩy thì extension không sửa và không
xoá được (ADR 0010), và quota là 50/notebook. Đây đúng hạng rủi ro mà `WORKSPACE_PROTOCOL.md` xếp
số một, tới qua một cửa vào tồn tại **để chặn chính nó**: chú thích ngay tại cửa mô tả đúng hậu
quả này.

Lỗi có từ ticket 005. Không phải hồi quy của 021.

## Delivers

Mục không dùng được bị chặn **ở cửa**, khi chưa có gì bị đẩy đi.

## Scope

- Cửa vào `runQueue` và `S.ledgerKey` phải đòi **cùng một điều kiện**. Chỗ sửa đúng là chỗ khiến
  hai điều kiện ấy không thể trôi khỏi nhau nữa — đừng chép điều kiện của `ledgerKey` thành một
  bản thứ hai ở cửa vào (đúng cái bẫy "hai hàng rào cho một luật" mà ticket 015 đã gỡ một lần).
- Quyết định Mục hỏng bị **loại** hay cả lượt bị **từ chối trước khi chạy**, và nói rõ vì sao.
  Hai lựa chọn khác nhau ở chỗ: loại thì lượt chạy vẫn chạy phần còn lại, từ chối thì người dùng
  biết ngay là danh sách của họ có vấn đề. ADR 0008 (bảng tổng kết) là chỗ để tra.
- **Không** đổi hợp đồng của `S.ledgerKey`.

## Acceptance

- Trả lời được: test nào chết nếu cửa vào và `ledgerKey` lại đòi hai điều kiện khác nhau? Đây là
  câu hỏi chính của ticket, và nó là câu hỏi về **quan hệ giữa hai chỗ**, không phải về một chuỗi.
- Trả lời được: test nào chết nếu `runQueue` ném **sau** khi đã đẩy ít nhất một Nguồn? Phải có một
  test hỏi thẳng rằng **Sổ đã import giữ được** những gì đã đẩy, kể cả khi lượt chạy hỏng giữa
  chừng — đó mới là thứ ngăn được cú đẩy trùng, chứ không phải phép kiểm ở cửa.
- Fixture ≥2 Mục, và Mục hỏng **không** nằm đầu cũng không nằm cuối, cũng không ở tâm đối xứng
  (`WORKSPACE_PROTOCOL.md` v10) — Mục hỏng nằm đầu thì không Nguồn nào kịp đẩy và cả ticket mất
  nghĩa.
- Suite xanh, in `tests N`.
