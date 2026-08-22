---
status: done
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

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `e8717c6`. Không cần vá vòng hai.

### Bằng chứng Lead tự chạy
```
bash test/run.sh          → XANH — tests 771, 25 file.   (nền 766 / 25)
node tools/verify-docs.mjs → XANH — bốn bộ tạo, bảy tiêu chí, 7×4 ô đều `đạt`
```

### Câu hỏi mở của ticket: peer **không** dùng đường thoát
Ticket cho phép trả lời "vì sao không nên cố". Peer không lấy, và trả bằng số đo:

| bộ tạo | trước | sau |
|---|---|---|
| MkDocs Material | `via=flat`, 94 mục phẳng | `via=lists`, **8 Nhánh** (17/22/15/16/4/7/12/1 trang) |
| VitePress | `via=flat`, 17 mục phẳng | `via=blocks`, **5 Nhánh** |
| Docusaurus | `via=lists`, 9/9 | không đổi |
| Sphinx + RTD | `via=lists`, 11/12 | không đổi |

Chỗ sửa MkDocs **không cần một tên theme nào**: `<nav>` chen giữa `<li>` và `<ul>` con chỉ là một
lớp bọc, nên `directItems` đi xuyên mọi lớp bọc *không phải mục* và **dừng ngay** ở mục đầu tiên
mỗi nhánh — đúng ranh giới ticket dặn giữ. VitePress mới phải dùng đường tắt theo tên
(`navItemBlock`), vì Vue nhét cả cụm mục con vào đúng **một** `<li>`.

### Ba phép xanh dưới hoán vị, peer tự tìm rồi tự vá
Đây là phần đáng đọc nhất của handback, và cả ba đều là **fixture nghèo hơn trang thật** — đúng
hạng lỗi mà `WORKSPACE_PROTOCOL.md` v9 lập luật, lần này lộ ra ba lần trong một ticket:

- **#6 `directItems` bới xuống MỌI cấp → xanh 770/770.** Đúng ranh giới ticket dặn giữ, và nó lọt.
  Chẩn đoán của peer đáng ghi: sổ "đã nhận" cộng luật "mục không link không nhánh thì bỏ" **tự
  sửa** hậu quả — lượt duyệt sâu nhận hết link trước, bản sao phẳng bị bỏ, ra đúng cùng một cây.
  Bất biến đang tựa vào hai cơ chế mà chỉ một cái được canh. Vá bằng cách export `directItems` và
  canh **thẳng phép bới** (`directItems(batDau,'li')` = 3, đối chứng `querySelectorAll('li')` = 7),
  không canh qua `buildTree` nữa. Chạy lại → ĐỎ.
- **#9 `ownLabel` bỏ phép loại nhánh dẫn tới mục con → xanh.** Fixture để `md-nav__title` rỗng,
  trang thật lặp lại tên nhóm. Vá fixture theo trang thật → ĐỎ.
- **#13 bỏ luật "mục không link không nhánh thì bỏ" → xanh.** Fixture không có mục lục trong
  trang; MkDocs thật treo 11 neo `#` ngay dưới mục đang mở. Vá fixture → ĐỎ.

### Gỡ, không thêm bùa
Hoán vị #23/#26 cho thấy `ownLabel` có ba điều kiện loại mà **hai cái đầu bị cái thứ ba bao trọn**.
Peer gỡ cả hai thay vì thêm test giữ chúng; bốn bộ tạo thật vẫn đúng. Đúng hướng mà chỉ dẫn của
owner đặt ra: ưu tiên gỡ thứ không có tác dụng hơn là thêm lớp bảo vệ mới.

### Phép Lead tự chạy — cặp mà danh sách 29 phép của peer KHÔNG nêu
**Hoán vị `children` giữa hai Nhánh anh em.** Hai mảng cùng kiểu, và phép hoán vị giữ nguyên
**mọi** thứ mà bảng cổng đo được: đủ link, `taken`, `total`, `via`, và cả `depth` (hai cụm con đều
ở `depth+1`). Thứ duy nhất vỡ là **tương ứng nhãn ↔ cây con** — tức đúng đơn vị Nhánh của ADR
0005. Hậu quả thật: người dùng tick "Bắt đầu" và nhận 22 trang của "Cài đặt", trong một Nguồn gộp
mang tên "Bắt đầu" — và tên Nguồn là vĩnh viễn (ADR 0010).

Kết quả: **ĐỎ**, 10 test chết, gồm đúng những cái phải chết:
```
✖ nhánh — tick một mục cha là chọn cả nhánh CON của nó
✖ nhánh — mỗi trang gửi đi mang tên NHÁNH đã tick, không mang tên của chính nó
✖ đi hết đường — tick một nhánh 40 trang trong Bảng chọn THẬT rồi chạy: đúng một Nguồn
✖ nhánh — tick một mục con KHÔNG kéo theo mục cha và các mục anh em của nó
✖ import — gửi đi theo THỨ TỰ CÂY, không phải thứ tự bấm chuột
```
Cây khôi phục sạch sau phép thử.

### Nợ ghi lại
1. **`navItemBlock` chỉ có một dòng, đo trên đúng một trang VitePress.** GitBook, docsify, VuePress
   2 chưa đo. Sai thì mất đường tắt chứ không mất nội dung (rơi về `flat`, đủ link) — nhưng
   "VitePress đọc được" hiện là một câu về `vitepress.dev/guide`, không phải về mọi bản dựng.
2. **Không có fixture cho theme đặt tên nhóm và danh sách con trong *cùng một* phần tử bọc.** Khi
   ấy `ownLabel` trả rỗng → mất một cấp Nhánh, **không dòng nào báo**. Chưa gặp trên bốn bộ tạo đã
   đo. Đây là chỗ Lead sẽ soi đầu tiên nếu có báo cáo "cây nông hơn thực tế".
3. **Sphinx + RTD vẫn `11/12` link và phẳng hoàn toàn** — y hệt nền, ticket này không chạm. Trang
   đo chỉ mở nhánh của trang đang đọc nên chưa biết cây có sâu không ở trang khác.
4. **`via` chưa tới mắt người dùng.** `picker.js` giữ trong `state.tree`, `statusLine()` không đọc.
   Tên trùng với `via` của đường đẩy RPC/DOM ở ticket 019 — **hai thứ khác nhau**, đừng gộp.
