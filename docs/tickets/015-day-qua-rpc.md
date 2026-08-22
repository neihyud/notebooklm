---
status: open
labels: [ready-for-agent]
blocked_by: [014]
spec: docs/spec/0001-notebooklm-importer.md
adr: docs/adr/0012-day-qua-rpc-dom-lam-duong-lui.md
---

# 015 — Đẩy nguồn qua RPC `izAoDd`, DOM thành đường lui

**Đọc ADR 0012 trước khi viết dòng nào.** Ticket này thi hành nó, và năm ràng buộc trong đó là
điều kiện nghiệm thu chứ không phải lời khuyên.

## Delivers

Service worker đẩy một Nguồn text vào Notebook đích bằng một request `batchexecute`, đọc được cả
lượt thành công lẫn lượt thất bại từ thân phản hồi. `automation.js` giữ nguyên làm đường lui.

## Đường đi, theo bằng chứng điều tra

| Thứ | Giá trị |
|---|---|
| Endpoint | `https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute` (dual-serve trên `notebook.google.com` — ticket 014) |
| Query | `?rpcids=izAoDd&source-path=/notebook/<nbId>&f.sid=<FdrFJe>&hl=<lang>&rt=c` |
| Body | `f.req=<urlencoded>&at=<SNlM0e>&` — **có dấu `&` ở đuôi** |
| Lớp ngoài `f.req` | `[[[ "izAoDd", "<params đã JSON.stringify>", null, "generic" ]]]` |
| Header client tự đặt | chỉ `Content-Type: application/x-www-form-urlencoded;charset=UTF-8` |
| `SNlM0e`, `FdrFJe` | parse từ `window.WIZ_global_data` trong HTML `GET /` |

Phản hồi có prefix chống XSSI `)]}'`, rồi các chunk `<số byte>\n<JSON>`; kết quả nằm ở frame
`["wrb.fr", "izAoDd", <payload>, …]`.

Shape `params` cụ thể cho biến thể text nằm trong báo cáo điều tra — **đọc lại từ nguồn, đừng
chép từ trí nhớ**, và ghi rõ trong comment rằng shape này **trôi theo cohort** (ADR 0012).

## Thứ tự bắt buộc: reader lỗi TRƯỚC

Ràng buộc 1 của ADR 0012. Viết và test bộ đọc phản hồi **trước** khi viết đường gửi. Nó phải phân
biệt được, bằng code chứ không bằng heuristic:

- **thành công** — frame `wrb.fr` mang source id + title + status (`READY` là `[null,2]`);
- **`er` frame** — `["er", "izAoDd", <code>, …]`;
- **`wrb.fr` payload `null` + `google.rpc.Status` ở index 5** — `3` INVALID_ARGUMENT, `5`
  NOT_FOUND, `9` FAILED_PRECONDITION;
- **`UserDisplayableError` nhúng ở index 5** — quota, rate limit;
- **HTTP 400** — CSRF hết hạn: lấy `SNlM0e` mới rồi retry **đúng một lần**;
- **HTTP 429 / 5xx** — lớp transport.

Lỗi nghiệp vụ đến **kèm HTTP 200**. Nếu `if (!res.ok) throw` là thứ duy nhất canh, cả lớp lỗi này
biến mất im lặng — và đó là điều duy nhất làm ADR 0012 trở thành một quyết định tệ.

## Acceptance

1. Trả lời được: **test nào chết** nếu bộ đọc coi mọi HTTP 200 là thành công? Nếu câu trả lời là
   "không cái nào", ticket chưa xong.
2. Trả lời được: test nào chết nếu hoán vị hai mã trạng thái cùng kiểu — `READY` ↔ một mã lỗi?
   Cả hai là số ở cùng vị trí, hoán vị vẫn cho một phản hồi parse được.
3. Trả lời được: test nào chết nếu hoán vị `SNlM0e` ↔ `FdrFJe`? Hai chuỗi cùng kiểu lấy từ **cùng
   một** đối tượng, một cái vào body một cái vào query — hoán vị vẫn ra một request gửi đi được.
4. Trả lời được: test nào chết nếu `title` ↔ `content` đổi chỗ trong `params`? Đây đúng cặp mà
   `WORKSPACE_PROTOCOL.md` đã ghi cho hộp thoại DOM (ô tiêu đề ↔ ô nội dung, ticket 004); ở đường
   RPC nó là hai phần tử cạnh nhau trong một mảng, tức **dễ hoán vị hơn** chứ không khó hơn.
5. **Một request một nguồn.** Phải có test chốt rằng đường này không bao giờ gửi nhiều entry trong
   một `izAoDd` — ràng buộc 2 của ADR 0012, và lý do là batch **âm thầm bỏ hàng thất bại**.
6. **Chỉ đường text.** Không thêm biến thể URL (ràng buộc 3: ghost row ăn quota).
7. **Nguồn quá lớn rơi về đường lui, không cố gửi** (ràng buộc 4: SW bị giết ở 30 giây). Ngưỡng
   chọn thế nào thì ghi lý do tại chỗ, và nói rõ nó chưa được đo.
8. Suite xanh, in `tests N`.

## Ranh giới cứng

- **Không gửi một request thật nào tới notebook của owner.** Test bằng phản hồi giả dựng từ hình
  dạng capture trong báo cáo điều tra. Lần chạy thật đầu tiên cần owner cho phép riêng
  (`WORKSPACE_PROTOCOL.md`).
- **`AUTH_OPS` không đụng tới** (ràng buộc 5). Đường này không mượn header ký; nó không liên quan
  tới `page-bridge.js` hay ADR 0003.
- **Không xoá `automation.js`** hay bất kỳ test nào của ticket 003/004. Chúng là đường lui.
