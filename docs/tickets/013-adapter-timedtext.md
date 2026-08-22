---
status: done
labels: [ready-for-agent]
blocked_by: [005, 006]
spec: docs/spec/0001-notebooklm-importer.md
---

# 013 — Adapter `timedtext`: đường trích thứ hai cho video công khai

## Vì sao ticket này tồn tại

Ticket 005 để lại một lỗ có chủ ý. `src/youtube/watch.js` chỉ trích được transcript qua panel DOM.
Với video công khai / unlisted có sẵn phụ đề, `timedtext` cho cùng dữ liệu ấy mà không cần mở panel,
không cần chờ DOM dựng xong, và không hỏng khi YouTube đổi layout. Peer T005 không làm vì nó cần
`captionBaseUrl`, thứ chỉ có trong `ytInitialPlayerResponse` ở MAIN world — và `WORKSPACE_PROTOCOL.md`
lúc đó xếp mọi lần chạm `page-bridge.js` vào quyết định của owner.

Owner đã duyệt 2026-08-22 (protocol v4). Ranh giới thật là **auth**, không phải số op.

## Delivers

Một op mới `playerResponse` trên bridge, và một adapter trích trong `watch.js` dùng `captionBaseUrl`.
Adapter DOM có sẵn vẫn là đường lui, không bị thay thế.

## Ràng buộc không được đảo

- Op mới **không** vào `AUTH_OPS` (`src/youtube/bridge-protocol.js`). Nó đọc dữ liệu mà một tab ẩn
  danh cũng đọc được. Thêm nó vào `AUTH_OPS` là vượt quyền — dừng và hỏi Lead.
- ADR 0003 vẫn nguyên: **video private đi thẳng đường DOM**, không thử `timedtext` trước rồi mới lui.
  PoToken là chuyện cấu trúc, không phải chuyện thử lại. `timedtext` với `exp=xpe` trả HTTP 200 rỗng —
  một lần chạy "thành công" mà không có dòng nào.
- Vì thế: **HTTP 200 với 0 segment là hỏng, không phải là "video không có phụ đề"**. Hai trường hợp
  này phải phân biệt được ở tầng dữ liệu, không phải ở tầng log.
- Thứ tự thử do mức riêng tư quyết định, không do "cái nào nhanh hơn".

## Acceptance

- Trả lời được: **test nào chết** nếu hoán vị hai adapter trích cho nhau (DOM ↔ timedtext) trong bảng
  chọn theo mức riêng tư? Cả hai cùng kiểu hàm và cùng trả về `{segments, meta}`, nên hoán vị vẫn cho
  một lần import "thành công" — với video private thì nó trả về rỗng và Sổ vẫn ghi xong.
- Trả lời được: test nào chết nếu `playerResponse` lọt vào `AUTH_OPS`?
- Một phản hồi `timedtext` HTTP 200 rỗng không được đi tiếp thành một Nguồn.
- Suite xanh, in `tests N`.

## Nợ mang theo từ T005

`ticket 012` phải kiểm `params` protobuf của `get_transcript` trên InnerTube thật. Ticket này thêm
một đường mạng nữa cần kiểm trên trang thật — gộp vào 012, đừng mở ticket kiểm riêng.

---

## Sửa đề bài — 2026-08-22, sau ticket 012

Ticket 012 chạy đường InnerTube trên trang thật. Kết quả đổi tiền đề của ticket này:

```
get_transcript, cùng phiên cùng trang, bốn biến thể:
  - params của sản phẩm      HTTP 400 FAILED_PRECONDITION
  - params YouTube tự đúc    HTTP 400          ← chuỗi của CHÍNH YouTube cũng 400
  - bỏ hẳn params            HTTP 400
  - params rác               HTTP 400
/youtubei/v1/next            HTTP 200 (442361 byte)   ← cùng ngữ cảnh, cùng key, vẫn sống
Endpoint mà CHÍNH TRANG gọi khi bấm nút Transcript: /youtubei/v1/get_panel
```

**`get_transcript` không sai — nó chết.** Params do chính YouTube đúc cũng 400, nên mọi giả thuyết
về mã hoá protobuf đều sai đường. Giao diện đã chuyển sang `get_panel`.

Hệ quả cho ticket này:

- Việc "sửa `params` protobuf" **không còn là việc**. Phát hiện C của ticket 012 (chuỗi sản phẩm là
  tiền tố đúng, thiếu 77 byte) vẫn đúng về mặt mã hoá nhưng đã hết giá trị thực dụng.
- Đường trích thứ hai phải chọn giữa **`timedtext`** (như tên ticket) và **`get_panel`**. Ticket
  này phải **đo cả hai trên trang thật** bằng `tools/verify-live.mjs` trước khi chọn, và ghi lý do
  chọn vào một ADR — đừng chọn bằng lập luận.
- Ràng buộc auth giữ nguyên: đường này **không** vào `AUTH_OPS` (`src/youtube/bridge-protocol.js`).
  Owner đã duyệt một op không-auth cho `page-bridge.js`; đó vẫn là ranh giới.
- Đường DOM đang hỏng trên một lớp video (ticket 017), nên **đừng** giả định có đường lui đang chạy.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN**, sau hai vòng. Commit `34282f7` + `a920a1d`. ADR 0013.

### Bằng chứng Lead tự chạy
```
bash test/run.sh                                → XANH — tests 722, 24 file   (nền 695 / 24)
node tools/verify-live.mjs --video jNQXAC9IVRw  → XANH  DOM 3  / get_panel 3,  chữ trùng 100.0%
node tools/verify-live.mjs --video dQw4w9WgXcQ  → XANH  DOM 24 / get_panel 24, chữ trùng 100.0%
```
Tức đường trích transcript giờ có **hai đường độc lập cùng cho một kết quả**, xác nhận trên trang
thật — không phải hai đường cùng đọc một chỗ.

### Vòng một — chọn bằng số đo, và số đo loại đúng thứ ticket mang tên
Ticket mở ra với tên `timedtext`. Phép đo trên Chrome thật **loại nó**: HTTP 200 với **0 byte**.
`get_transcript` cũng chết, HTTP 400 với mọi biến thể params kể cả chuỗi do chính YouTube đúc.
Đường được chọn là `get_panel` — endpoint mà chính giao diện YouTube gọi. Đây là lý do brief bắt
đo trước khi viết: cả hai ứng viên trong đầu bài đều đã chết, và không lập luận nào từ mã nguồn
cho biết điều đó.

Peer tự đổi cách chấm của cổng live cho đúng: hạ hai phát hiện của ticket 012 xuống **ghi nhận**
(chúng đã thành ADR, để làm cổng là biến một dòng đỏ thành thứ vĩnh viễn không ai đọc) và đổi lại
thêm một tiêu chí **đỏ** mới — `timedtext` bỗng trả về segment, vì ADR chọn `get_panel` *vì* nó
không trả về gì.

Nó cũng tự khai một chỗ **lúc đầu sống sót**: hoán vị *giá trị* của `NO_CAPTIONS` ↔ `BLANK` không
giết test nào, vì mọi assert đều so theo tên hằng nên hai đầu dịch cùng nhau. Đã neo bằng chuỗi
thật, lý do đúng: `attempts[].code` là hợp đồng dữ liệu đi ra ngoài, không phải chi tiết nội bộ.

### Vòng hai — cặp Lead chọn, ngoài danh sách của peer, và nó hở ở CẢ HAI cổng
**`hl` ↔ `gl`** trong ngữ cảnh `viaPanel` — hai chuỗi cùng kiểu lấy từ **cùng một** đối tượng
`ytcfg`, mỗi chuỗi một vai trò và một giá trị mặc định riêng (`'vi'` ↔ `'VN'`).

```
bash test/run.sh                                → XANH — tests 716, 24 file.   không test nào chết
node tools/verify-live.mjs --video dQw4w9WgXcQ  → XANH  DOM 24 / get_panel 24, chữ trùng 100.0%
```

**Cổng Chrome thật cũng không phạt.** Lý do chính là điều peer đã tự khai: cổng chỉ đo `hl=en`.
Trên một video tiếng Anh với giao diện tiếng Anh, gửi sai **cả hai** trường vẫn rơi về đúng một
kết quả — phép đo ấy về nguyên tắc không phân biệt được hai trường. Cùng hình với bài học ticket
017 (fixture n=1), chỉ khác là `n=1` nằm trong **lựa chọn video**, không trong fixture. Đây là lần
đầu một lỗ sống sót qua cổng live, và nó cho thấy cổng live cũng có hạng điểm mù của riêng nó.

Vì sao đáng vá: `hl` chọn **ngôn ngữ transcript trả về**. Video đa ngữ thì hoán vị này lấy về bản
sai ngôn ngữ — request vẫn 200, vẫn có segment, mốc vẫn tăng dần, Nguồn vẫn dựng. Tên Nguồn là
vĩnh viễn (ADR 0010) và ADR 0009 đọc tên ấy để biết phần nào đã có.

Sau vá, Lead chạy **bốn** phép, tất cả **ĐỎ**:

| Phép | Kết quả |
|---|---|
| `cfg.hl` ↔ `cfg.gl`, giữ nguyên mặc định | ĐỎ |
| `FALLBACK_LANGUAGE` ↔ `FALLBACK_COUNTRY`, giữ nguyên nguồn | ĐỎ |
| hoán vị cả hai (phép gốc của Lead) | ĐỎ |
| header `X-Youtube-Client-Name` ↔ `X-Youtube-Client-Version` | ĐỎ |

Peer cũng gộp **hai bản chép tay** của khối `context.client` về một chỗ (`innertubeClient`) — đúng
tinh thần ticket 014: đừng để một danh sách viết tay thứ hai lệch đi trong im lặng.

### Nợ ghi lại
- **Chưa đo `hl` thật sự đổi ngôn ngữ transcript.** Peer khẳng định từ tài liệu InnerTube, không
  từ phép đo; chưa gửi `hl=de` cho một video có nhiều bản phụ đề. Số đo ấy sẽ **củng cố** lý do vá
  chứ không đổi bản vá.
- `get_panel` với **video private** chưa đo — không có video private để thử mà không đăng nhập.
  ADR 0003 giữ nguyên nên đường này không bao giờ chạy cho private, nhưng "nó trả gì" thì chưa biết.
- **Ca `BLANK` chưa gặp thật**: không video nào trong bốn video trả `content` mà 0 dòng. Ranh giới
  `content` có/không đang dựa trên **n=1**.
- **Phân trang chưa đo.** `get_panel` trả cả transcript trong một lượt ở 189 segment (264 KB);
  video ba tiếng thì chưa biết, và không thấy `continuation` nào trong payload.
- `attempts[].code` là dữ liệu đúng nhưng **chưa ai đọc** — chỗ đọc nó để quyết định ghi Sổ
  (ADR 0009) nằm ở service worker, ngoài phạm vi ticket này.
