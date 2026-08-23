---
status: done
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

---

## Nghiệm thu — 2026-08-23, Lead

**Trạng thái: ĐÃ NHẬN**, sau hai vòng. Commit `a4d8ce0` + `c65986d`.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 796, 25 file.` (nền 783 / 25)

### Vòng một — câu trả lời đúng hơn thứ ticket hình dung
Ticket hỏi "hai đường có nên nói cùng một ngôn ngữ không". Peer trả lời **có, và `rpc.js` không
cần sửa một dòng nào**: chỗ nối hỏi *một* câu — "Nguồn này có mang đúng tên ta đặt không?" — và
mỗi đường trả lời bằng bằng chứng nó có. Đường DOM tự tay điền ô tiêu đề nên biết **điền được hay
không**; đường RPC nhận về **tên notebook đang thật sự giữ**, tức bằng chứng *mạnh hơn*: shape
`params` mà trôi thì request vẫn thành công còn tên vẫn khác. Lead nhận lập luận này.

P9 (stub tab trả `{ sourceId }` — thứ `addTextSource` **không bao giờ** trả, nên cả nhánh
`named`/`warning` vắng mặt khỏi mọi test đi qua harness ấy) peer tự tìm, và vá bằng **một test
đối chứng mới** chứ không bằng cách chỉnh assert cũ.

### Vòng hai — Lead tìm ra một lỗ mà P1–P11 không phủ
Danh sách vòng một canh *hình dạng* và *tương ứng giữa các Nguồn* rất kỹ, nhưng không canh **hai
phép chuẩn hoá khác nhau trên cùng một chuỗi**. Lead đo trên code vòng một:

```
tiêu đề: "Video  giua"  (hai dấu cách — YouTube cho phép)
push:    ({ ok: true, via: 'rpc', name: S.collapse(source.name) })   ← đúng thứ đường RPC làm
→ unnamed = 1
→ "notebook đang để tên "Video giua", không phải "Video  giua""
```
Cú đẩy **hoàn toàn đúng** mà bảng báo mất tên. Nguyên nhân: `rpc.js:514` gửi `S.collapse(...)`
(gộp cả khoảng trắng bên trong), `nameWarningOf` so bằng `.trim()` (chỉ hai đầu), và
`queue-engine.js:133` `labelOf = String(item.title)` **không** collapse.

Đây là dương tính giả trong đúng cái tín hiệu ticket tồn tại để tạo ra, và nó nổ ở **lần chạy thật
đầu tiên** — trộn lẫn với chính món nợ peer đã ghi ("nếu NotebookLM chuẩn hoá tiêu đề thì cả bảng
đầy dòng `!`"), tức hai nguyên nhân khác hẳn cho cùng một triệu chứng.

**Peer sửa ở chỗ ĐẶT TÊN, không ở chỗ SO** — và đó là hướng đúng hơn thứ Lead gợi ý. Hệ quả dây
chuyền peer rút ra: vì ta luôn gửi chuỗi đã chuẩn hoá, mọi khoảng trắng trong tên nhận về là thứ
**phía kia thêm vào**, nên phép so thành so chuỗi trần và **lệch chỉ ở khoảng trắng đầu/cuối giờ
ĐƯỢC BÁO** — vòng một nuốt nó. `.trim()` sống sót đúng một chỗ: câu hỏi *"có đọc được cái tên nào
không"*, nhánh cho hạng `chưa xác nhận`.

`S.bundleName` peer kiểm và **sạch** — nó collapse cả `source` lẫn `branch` trước khi nối, có test
canh (`playlist('Khoá  học\tRust')`) chứ không phải chỉ đọc code. Nguồn lẻ là đường hở duy nhất.

### Lead chạy lại, cả hai chiều
```
khoảng trắng đôi + đẩy đúng          → unnamed = 0, cảnh báo ["","","",""]
notebook đổi tên THẬT                → unnamed = 1
```
Và một phép ngoài danh sách P1–P11/Q1–Q5: **chuẩn hoá một vế** (`S.collapse(r.name)`, để vế ta đặt
trần) — biến thể một chiều mà Q2 (cả hai vế) không phủ. **ĐỎ**, chết đúng ở
`runQueue — notebook thêm khoảng trắng vào tên ta gửi thì VẪN báo, không nuốt`.

Peer chạy lại **toàn bộ** P1–P11 + năm phép Q mới trên cây cuối (đúng, vì chỗ nối đã đổi nên số
vòng một không dùng lại được). Không phép nào xanh.

### Cổng review — peer gỡ chứ không thêm
Peer đã thêm `String()` ép kiểu vào `labelOf` rồi **tự gỡ ra**: `S.ledgerKey` cũng dùng `collapse`
nên id không phải chuỗi đã chết trước đó — hàng rào thứ hai cho một luật đã có hàng rào là code
chết. Đúng hướng owner đặt ra.

### Phát hiện ngoài phạm vi → **ticket 022**, Lead đã tự xác minh
Peer báo cửa vào `runQueue` chặn thiếu một nửa. Lead không nhận qua lời kể mà chạy lại:
```
items: [{ id: 'aaa' }, { id: 7 }]
→ NÉM: ledgerKey: thiếu mục
→ nhưng đã đẩy thành công: ["Video một"]
```
Ném **sau** khi đã đẩy, nên nhật ký *và* Sổ đã import của lượt ấy mất theo → lần sau đẩy lại Nguồn
đã đẩy, mà Nguồn đã đẩy thì không xoá được (ADR 0010). Lỗi có từ ticket 005, không phải hồi quy
của 021. Peer đúng khi không tự sửa.

### Nợ ghi lại
- Tên notebook echo về vẫn **chưa từng đối chiếu capture thật** — nhưng sau vòng này nguyên nhân đã
  **tách bạch**: chuẩn hoá phía ta đã khoá bằng test, nên một dòng `!` ở lượt chạy thật là chuyện
  NotebookLM thật sự sửa tên, tức đúng dữ liệu ticket 020 đang chờ.
- Nhánh `named === false` vẫn đi qua stub, không qua `content.js` thật (giới hạn từ ticket 019).
