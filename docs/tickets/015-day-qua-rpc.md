---
status: done
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

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN**, sau hai vòng. Commit `776b2f3` + `9aa5cc1`.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 766, 25 file.` (nền 722 / 24)

**Không một request ghi thật nào được gửi.** Mọi phản hồi trong test dựng tay theo hình dạng
capture (`test/helpers/batchexecute.js`); `fetch` luôn là stub đếm lượt. Ràng buộc nặng nhất của
ticket giữ được.

### Vòng một
Bộ đọc lỗi viết **trước** đường gửi (ràng buộc 1), và nó **hỏng đóng**: đọc không ra trạng thái thì
trả `malformed`, không trả `ok`. Tám câu Acceptance đều có tên test chết cụ thể; 34 phép hoán vị
chạy thật.

Ba phép **xanh dưới hoán vị, peer tự tìm rồi tự vá** — đây là phần đáng giá nhất của vòng này:
- `attempt < 2` → `< 3` xanh: **hai hàng rào cho một luật**, hàng rào ngoài là code chết. Gộp về
  một `CSRF_RETRIES` duy nhất.
- prefix XSSI thành tuỳ chọn xanh: fixture HTML đăng nhập không có dòng `[` nào nên **đường nào
  cũng ra `malformed`** — test xanh vì lý do khác với lý do nó tưởng.
- bỏ cache token xanh: fixture service worker chỉ dựng **một** Nguồn, nên "một request một nguồn"
  trùng khít "một request cả lượt". Đúng bẫy n=1 của protocol v9, lần này ở tầng dây nối.

Cổng review bắt 5 lỗi, đáng ghi hai: `canFallBackToDom` **nói ngược hành vi thật** ở 2/6 hạng
(bảng export sai), và `notReady` requeue mục dù đã cầm `sourceId` — chạy lại là **nhân đôi Nguồn
vĩnh viễn**.

### Vòng hai — Lead tìm ra một quy tắc chưa được canh, peer chọn KHÁC và chọn đúng hơn
Lead hoán vị **thứ tự đọc `er` frame ↔ `wrb.fr` frame** → `XANH — tests 764, 25 file`, không test
nào chết. Hai thứ tự chỉ khác nhau khi phản hồi mang **cả hai** frame cùng `izAoDd`.

Lead đề nghị canh quy tắc "`er` thắng". **Peer bác, và lập luận của nó đúng hơn:** cả hai thứ tự
đều là khẳng định một điều mình không biết.
- `er` thắng → rơi về đường DOM. Nếu `wrb.fr` là thật thì Nguồn **đã** có, và đường lui dựng cái
  thứ hai — không xoá được (ADR 0010), ăn quota 50/notebook, vĩnh viễn.
- `wrb.fr` thắng → mục vào Sổ đã import. Nếu `er` là thật thì Nguồn chưa hề tồn tại và ADR
  0006/0009 khiến nó **không bao giờ được thử lại**.

Câu hỏi duy nhất bộ đọc này tồn tại để trả lời là *"đã ghi hay chưa"*, nên hạng đúng là hạng nói ra
đúng thứ mình biết: **`malformed`**. Nó trội hơn phương án Lead đề nghị trên chính rủi ro Lead quan
tâm (không ghi false success) **và** tránh luôn cú ghi mù của đường lui. Thứ duy nhất mất đi là cú
đẩy trong lượt này — mà đó chính là cú có thể nhân đôi.

Peer ghi thẳng trong comment rằng đây là quy tắc chọn **theo hậu quả, không theo quan sát**, và tổ
hợp ấy *bất khả theo chính cách ta gửi* (một `rpcids`, một entry) nên gặp nó nghĩa là giả định về
server đã sai — chỗ để dừng, không phải chỗ để đoán.

Lead chạy lại bốn phép:

| Phép | Kết quả |
|---|---|
| **A** — gỡ cổng, giữ `er` đọc trước (bản trước khi vá) | **ĐỎ** |
| **D** — cổng chỉ bắt khi `er` đứng **trước** `wrb.fr` (quy tắc theo vị trí) | **ĐỎ** |
| **C** — giữ cổng, đảo thứ tự đọc (đúng phép hoán vị gốc của Lead) | **XANH — và đúng** |

C xanh là kết quả **đúng**, không phải lỗ: cổng chặn trước cả hai lượt tra frame, nên hai thứ tự
giờ tương đương thật và không còn hành vi nào để phân biệt. D là phép chứng cho việc kiểm **cả hai
chiều** — canh một chiều thôi thì "đọc theo frame đứng trước" vẫn lọt.

Fixture: 4 frame `[HEAD, x, y, TAIL]`, hai frame quyết định nằm **giữa** (nên `[0]` và `at(-1)` đều
không tình cờ đúng), vòng lặp chạy cả `[er, wrb]` lẫn `[wrb, er]`, kèm test chứng đối để `malformed`
không phải do fixture bốn frame làm hỏng bộ đọc.

### Điều phải chuyển tiếp: báo cáo điều tra RPC KHÔNG có trong repo
Ticket bảo "shape `params` nằm trong báo cáo điều tra — đọc lại từ nguồn". Peer tìm khắp repo, git
history và cây làm việc chính: **không có file nào**. ADR 0012 nhắc agent `8f04c46b` nhưng không
đính kèm gì.

Nên shape hiện tại **dựng lại từ chính mô tả trong ticket**, ghi rõ tại chỗ là *chưa đối chiếu với
capture thật*. Bộ đọc hỏng đóng nên shape sai sẽ ra `INVALID_ARGUMENT` → rơi về đường DOM chứ không
im lặng. **Đây là thứ duy nhất chắn giữa code này và một lần chạy thật thành công.**

### Không phủ được
- Không có cổng Chrome-thật nào cho lớp NotebookLM. `verify-live.mjs`/`verify-docs.mjs` canh lớp
  YouTube và lớp tài liệu, không canh lớp này — và không ai được đăng nhập.
- `via: 'rpc'|'dom'` bị `queue-engine.js:185` vứt đi, nên bảng tổng kết không nói được lượt chạy đi
  đường nào; hiện chỉ có `console.warn`. Lead xác nhận ngoài phạm vi → **ticket 019**.

### Owner cần làm gì để chạy thử thật lần đầu
Extension chưa đẩy một nguồn nào bao giờ. `WORKSPACE_PROTOCOL.md` và ADR 0012 đều chốt: lượt ghi
thật đầu tiên là quyết định của owner.

1. **Tạo một notebook nháp mới.** Đừng dùng notebook có dữ liệu — Nguồn đã đẩy thì extension không
   sửa và không xoá được (ADR 0010), quota 50/notebook.
2. Popup → *Dùng notebook ở tab hiện tại*, trỏ vào notebook nháp ấy.
3. **Mở DevTools của service worker** (`chrome://extensions` → *service worker*) **trước khi** chạy.
   Đây là chỗ duy nhất nói ra đường nào đã chạy: thấy `[nblm] đường RPC không dùng được, rơi về
   đường lui — …` thì đường chính đã chết, và câu sau dấu gạch là lý do.
4. Import **đúng một video ngắn**, rồi mở notebook kiểm ba thứ: (a) có đúng một Nguồn mới; (b)
   **tên Nguồn là tên bó, không phải cả transcript** — nếu ngược lại thì `[content, title]` trong
   `buildParams` bị đảo, sửa một dòng; (c) thân Nguồn đầy đủ.
5. Nếu bảng tổng kết báo mục rớt với `INVALID_ARGUMENT`: **shape đã trôi**. Mở DevTools trên tab
   NotebookLM, thêm một nguồn bằng tay, chép request `batchexecute` ở tab Network, đối chiếu `f.req`
   với `buildParams`. Đó là chỗ duy nhất phải sửa.
6. Nếu thấy `Nguồn ĐÃ được tạo (id …) nhưng trạng thái là N, không phải READY`: **đừng chạy lại
   ngay**, vào notebook kiểm trước — engine đã xếp mục ấy lại vào hàng đợi, chạy lại sẽ dựng Nguồn
   thứ hai.
