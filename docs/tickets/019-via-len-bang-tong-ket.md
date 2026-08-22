---
status: open
labels: [ready-for-agent]
blocked_by: [015]
spec: docs/spec/0001-notebooklm-importer.md
---

# 019 — Bảng tổng kết phải nói lượt chạy đi đường nào

## Vì sao ticket này tồn tại

Ticket 015 dựng đường đẩy RPC và giữ `automation.js` làm đường lui. `pushTextSource` trả về
`{ ok, via: 'rpc' | 'dom', sourceId, name, status }` — nhưng `queue-engine.js:185` **vứt giá trị
trả về đi**. Hệ quả: bảng tổng kết không nói được lượt chạy đã đi đường nào, và dấu vết duy nhất
là một `console.warn` trong DevTools của service worker.

Đó là chỗ hỏng đúng lúc người dùng cần nhất. ADR 0012 giữ hai đường **vì chúng hỏng theo hai cách
khác nhau**; không biết mình vừa đi đường nào thì lý do giữ hai đường mất một nửa giá trị. Và với
shape `params` chưa từng được đối chiếu với capture thật (ghi trong nghiệm thu 015), "đường chính
có chạy không" là câu hỏi đầu tiên của mọi lượt chạy thật.

## Delivers

Bảng tổng kết của mỗi lượt chạy nói rõ mỗi Nguồn đi đường nào, và bao nhiêu Nguồn phải rơi về
đường lui.

## Scope

- `queue-engine.js` giữ lại `via` từ `pushSource` và đưa nó lên bảng tổng kết.
- Không đổi hợp đồng trả về của `pushTextSource` (ticket 015 vừa khoá nó bằng test).
- `attempts[].code` của ticket 013 cũng chưa ai đọc — nếu cùng một chỗ nối giải quyết được cả hai
  thì làm luôn, còn không thì nói rõ vì sao tách.

## Acceptance

- Trả lời được: **test nào chết** nếu `via` của Nguồn A bị gán cho Nguồn B? Hai chuỗi cùng kiểu,
  cùng tập giá trị hợp lệ, hoán vị vẫn cho một bảng tổng kết đọc được.
- Trả lời được: test nào chết nếu `via` luôn báo `'rpc'` bất kể đường nào đã chạy?
- Một lượt chạy **hỗn hợp** (một Nguồn đi RPC, một Nguồn rơi về DOM) phải hiện đúng cả hai — fixture
  một Nguồn không phân biệt được gì (`WORKSPACE_PROTOCOL.md` v9, luật fixture một phần tử).
- Suite xanh, in `tests N`.
