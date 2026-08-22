---
status: done
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

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `0afe84f`. Không cần vá vòng hai.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 778, 25 file.` (nền 771 / 25)

### Phát hiện đáng giá nhất không phải bảng tổng kết, là luật fixture
Peer dựng fixture ba Nguồn với Nguồn đường-lui **ở giữa** — `[rpc, dom, rpc]` — đúng chữ nghĩa
luật v9 ("không đầu, không cuối"). Nhưng dãy ấy **bằng chính bản đảo ngược của nó**, nên một
`formatSummary` đọc nhãn theo chỉ số đảo ngược vẫn **xanh 777/777**.

Peer tự tìm ra, và **vá bằng fixture chứ không bằng assert**: bốn phần tử, phần tử đặc biệt ở vị
trí hai. Rồi chạy phép chứng ngược (P13: hạ chính fixture ấy xuống n=1 → hoán vị xanh sạch trở
lại) để lần sau không ai phải đo lại.

→ **`WORKSPACE_PROTOCOL.md` lên v10**: "không đầu không cuối" chưa đủ, còn phải **không nằm ở tâm
đối xứng**.

### Cổng review — hai lỗi cùng một gốc, đo được
Phép tra và phép đếm chạy trên **object trần**:
```
via = 'constructor' → dòng bảng in: "function Object() { [native code] }"
via = '__proto__'   → 2 Nguồn nhưng tổng đếm = 1   ← một Nguồn biến mất khỏi phép kế toán
```
Nhánh phòng thủ `đường lạ (…)` hỏng đúng ở lớp giá trị nó tồn tại để đón, và phép đếm mất một
Nguồn **âm thầm** — đúng hạng ADR 0008 dựng bảng tổng kết để chặn. Hôm nay chưa tới được từ sản
phẩm (`via` chỉ đến từ hai hằng), nhưng giá vá là hai dòng: đếm bằng `Map`, tra bằng
`Object.hasOwn`. Gỡ từng nửa đều ĐỎ (P15/P16).

### Phép Lead tự chạy — cặp mà danh sách P1–P16 KHÔNG nêu
**Đảo bucket chỉ trong phép đếm tổng**, để từng dòng vẫn in đúng nhãn còn dòng đầu đếm ngược. P3
đảo *nhãn* (nhất quán cả hai chỗ, tức chỉ là một phép đổi tên), P5/P6 *bỏ hẳn* một bên — không
phép nào phá **tương ứng giữa dòng tổng và các dòng**, mà đó chính là thứ người dùng đọc để biết
lượt chạy đi đường nào.

Kết quả: **ĐỎ**, 6 test, ở cả hai tầng:
```
✖ service worker — lượt chạy HỖN HỢP: bảng tổng kết nói ĐÚNG Nguồn nào đi đường nào
✖ service worker — lượt đi trọn đường RPC không có dòng đường lui nào (đối chứng)
✖ runQueue — bảng tổng kết nói TỪNG Nguồn đi đường nào, không chỉ đếm (ADR 0012)
```
Cây khôi phục sạch sau phép thử.

### Ba câu peer hỏi, Lead trả lời
1. **`via` là bốn thứ, không phải hai** (`buildTree` `lists|blocks|flat`, `pushTextSource`
   `rpc|dom`, `fetchTranscript` `panel|innertube|dom`, `docNotes[].via` `fetch|tab`). Peer đặt
   trường mới là **`pushVia`** để không thành cái thứ năm — **giữ nguyên**. Đổi tên ba cái kia
   chạm bốn lớp và không mua được gì hôm nay; không mở ticket.
2. **`attempts[].code` tách ra — Lead đồng ý với số đo của peer.** `via` chết ở **1** chỗ và không
   đổi hợp đồng nào; `attempts[].code` chết ở **3** chỗ khi trích hỏng và đổi hợp đồng `{ok:false,
   error}` — thứ có 17 chỗ dựng và 8 chỗ đọc, là kỷ luật định tuyến ticket 011 dựng lên. Lập luận
   quyết định là câu thứ hai của peer: nối nửa rẻ (`importer.js`, ca **thành công**) thì món nợ
   **trông như đã trả** trong khi giá trị thật của `code` nằm ở ca **hỏng** (ADR 0009). Không làm
   nửa vời.
3. **`warning` của `addTextSource` chết ở đúng dòng ấy** → mở **ticket 021**. Peer đúng khi không
   tự nới phạm vi.

### Nợ ghi lại
- Phát hiện review thứ ba peer **không** vá, Lead chấp nhận: `assert.ok` trong stub `fetch` của
  `postsInOrder` bị `catch` của `pushSource` nuốt, nên fixture hết kịch bản thì test vẫn đỏ nhưng
  đỏ ở dòng khớp bảng chứ không nói ra lý do thật. Ảnh hưởng chẩn đoán, không ảnh hưởng kết luận.
- **Runbook ticket 015 bước 3 nay đã lỗi.** Câu "DevTools của service worker là chỗ duy nhất nói
  ra đường nào đã chạy" không còn đúng — bảng tổng kết nói thẳng. Đã sửa tại chỗ.
