---
status: done
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

---

## Nghiệm thu — 2026-08-23, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `c55c255`. Không cần vá vòng hai.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 802, 25 file.` (nền 796 / 25)

Phép Lead dùng để mở ticket, chạy lại: `OK {"queued":2,"imported":1,"dropped":1,"balanced":true}`
— trước đó là `NÉM: ledgerKey: thiếu mục` sau khi đã đẩy một Nguồn.

### Nửa quan trọng hơn — và peer làm đúng nửa ấy
Brief dặn: đây không phải chuyện kiểm đầu vào, vì cửa nào cũng có ca chưa nghĩ tới. Peer làm cả hai
nửa, và nửa thứ hai là nửa đáng giá:

- **Cửa vào gọi thẳng `S.ledgerKey`**, không chép điều kiện. Khoá dựng ở đó **chính là** khoá khử
  trùng, mang theo qua `ledgerKeyOf` — nên chỉ còn **một** lời gọi `ledgerKey`, một chỗ trôi thay
  vì hai. Đúng thứ ticket đòi ("không thể trôi khỏi nhau nữa"), không phải hàng rào thứ hai.
- **`runQueue` không ném ra ngoài nữa sau khi đã đẩy.** `ledger.add` + `log.sources.push` chạy
  **ngay** khi `cfg.push` trả về, trước mọi phép đọc `result`; hai hàng đợi chạy `allSettled`; lỗi
  vào `log.failures` → bảng tổng kết; Mục chưa ra ở đâu quay lại hàng đợi kèm dòng `còn nợ`.

**Quyết định loại-Mục thay vì từ-chối-cả-lượt**, và lý do đúng: từ chối cả lượt đổi một Mục hỏng
lấy cả một playlist 300 video không chạy — ngược ADR 0008. Điều kiện để loại là an toàn chính là
bảng tổng kết: Mục bị loại vẫn có một dòng người đọc được, và `summary.balanced` canh kế toán.

### Ba phép xanh, hai lần vá bằng cách GỠ
- "Khoá khử trùng tính lần hai" xanh → peer **gỡ** lời gọi `ledgerKey` thứ hai (tính một lần, mang
  qua `Map`). Sau đó phép M1 giết **hai** test thay vì một.
- "Hoán vị hai nhãn hàng đợi" không có test nào canh → peer thêm test canh cặp `(queue, reason)`
  khi **cả hai** hàng đợi chết vì hai lý do khác nhau, **rồi gỡ luôn chỗ trôi**: `allSettled` và
  vòng đọc kết quả lấy từ **cùng một** mảng. Đo lại: hoán vị không còn phân biệt được.
- Hai phép xanh còn lại peer **không** vá, và Lead đồng ý: không ca nào phân biệt được, thêm assert
  ở đó là hàng rào cho một luật không tồn tại.

Fixture mới đều là **4 Mục, Mục hỏng ở vị trí hai** (luật v10). Test id-hỏng chạy toàn bộ fixture
cho **7** giá trị (`7, 0, false, true, {}, ['x'], '   '`), và lấy câu trả lời đúng bằng cách **gọi
lại chính `S.ledgerKey`** thay vì chép điều kiện — chép thì test cũng trôi y như code đã trôi.

### Phép Lead tự chạy — ngoài 16 phép của peer
Peer có phép "bỏ **cả** khối kế toán lại phần dở dang". Lead bỏ **riêng** phần đóng góp của
`log.sources` vào `accounted`: khối vẫn chạy, chỉ khác ở chỗ Mục **đã đẩy thành công** cũng bị trả
về hàng đợi — tức đúng cú đẩy trùng mà cả ticket này tồn tại để chặn, và đúng hạng ADR 0010 không
lấy lại được.

**ĐỎ**, 2 test:
```
✖ runQueue — ném giữa chừng: Sổ đã import giữ được những gì đã đẩy (ticket 022)
✖ runQueue — bảng tổng kết nói đúng hàng đợi nào chết, không lẫn hai hàng (ticket 022)
```
Cây khôi phục sạch sau phép thử.

### Phát hiện ngoài phạm vi → **ticket 023**, Lead đã xác minh
`service-worker.js:371` là `const failed = log.dropped.length;` — đúng như peer mô tả. Lỗi của
ticket 022 nằm ở `log.failures`, nên lượt chạy hỏng giữa chừng đi vào nhánh thành công và **badge
bị xoá trắng**. Câu cảnh báo có trong bảng tổng kết ở popup, nhưng badge là thứ thấy được mà không
cần mở popup. Peer đúng khi không tự sửa file ngoài phạm vi.

### Nợ ghi lại
- **Cửa sổ giữa `cfg.push()` trả về và `ledger.add`** thu hẹp tối đa nhưng không đóng được: nếu
  chính `cfg.push` đẩy xong rồi mới ném thì Nguồn đã ở trong notebook mà chưa có ô Sổ. Đó là hợp
  đồng của adapter, engine không nhìn thấy — ghi ra để đừng ai tưởng ticket này đóng hết.
- **Nội dung đã trích của bó chưa chốt bị vứt** khi lượt chạy chết giữa chừng; Mục quay lại hàng
  đợi và lần sau trích lại (video private 15–20 giây/mục, ADR 0003). Mất thời gian, không mất dữ
  liệu.
