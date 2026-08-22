---
status: done
labels: [ready-for-agent, risk]
blocked_by: []
spec: docs/spec/0001-notebooklm-importer.md
---

# 020 — Shape `params` của `izAoDd` đã trôi, và cặp `[content, title]` của ta đang ĐẢO

## Vì sao ticket này là ưu tiên cao nhất còn lại

Nghiệm thu ticket 015 ghi một món nợ: báo cáo điều tra RPC mà ticket 015 bảo "đọc lại từ nguồn"
**không có trong repo**, nên shape `params` được dựng lại từ chính mô tả trong ticket và **chưa
đối chiếu với capture thật**. Lead đã đi đối chiếu (2026-08-22, chỉ đọc, không gửi request nào).

Kết quả: **hai implementation reverse-engineer độc lập cùng mâu thuẫn với code của ta, ở cùng
những chỗ.**

Code hiện tại — `src/notebooklm/rpc.js`, `buildParams`:

```js
return [[[null, [content, title]]], notebookId];
```

`teng-lin/notebooklm-py`, `src/notebooklm/_source/add.py`:

```python
params = [
    [[None, [title, content], None, 2, None, None, None, None, None, None, 1]],
    notebook_id,
    build_template_block(),
]
```

`jacob-bd/notebooklm-mcp-cli`, `docs/API_REFERENCE.md`:

```python
source_data = [None, [title, text_content], None, 2, None, None, None, None, None, None, 1]
params = [[[source_data]], notebook_id, [2], settings]
```

### Ba chỗ lệch, xếp theo hậu quả

**1. `[content, title]` của ta ĐẢO so với cả hai nguồn.** Cả hai đặt **title trước**. Đây đúng là
cặp mà comment trong `rpc.js` tự cảnh báo — "hoán vị vẫn ra một Nguồn thành công, chỉ là nó mang
tên bằng cả transcript, và tên Nguồn là vĩnh viễn (ADR 0010)". Comment đoán đúng cơ chế và đoán
sai chiều: **ta đang ở phía sai của phép hoán vị đó.**

Đây là chỗ lệch duy nhất **không** hỏng đóng. Hai chỗ dưới làm request bị từ chối (an toàn, rơi về
đường DOM); chỗ này làm request *thành công* với một Nguồn đặt tên bằng nguyên transcript, không
sửa được, không xoá được, ăn một suất trong quota 50.

**2. Spec text dài 11 phần tử, không phải 2.** Có `2` ở chỉ số 3 (chỉ dấu loại nguồn) và `1` ở chỉ
số 10. `notebooklm-py` ghi lý do ngay tại chỗ: *"Nested template block per the Gemini-3.5 wire
migration (#1546): the text spec grew from 8 to 11 elements (slot 3 None -> 2, trailing 1) and the
flat [2],None,None tail collapsed into the shared template block."* Tức shape của ta không chỉ
thiếu — nó là shape **trước** một đợt migration đã xảy ra.

**3. `params` có phần tử thứ ba, ta chỉ có hai.** `notebooklm-py` gọi nó `build_template_block()`;
`notebooklm-mcp-cli` viết `[2], settings` (bốn phần tử top-level). Hai nguồn **không thống nhất**
chỗ này — đúng như ADR 0012 đã lường trước: "hai reverse-engineer độc lập tới hôm nay vẫn bất đồng
về shape trong khi thống nhất tuyệt đối về id".

### Và một điều ADR 0012 nói sai

ADR 0012 chốt: *"RPC id `izAoDd` **không bị Google xoay lần nào trong 7,5 tháng**"*. Changelog của
`notebooklm-mcp-cli` **v0.5.16, 2026-04-04**:

> "Fixed `source_add` (URL type) failing with `RPC error code 3 (INVALID_ARGUMENT)` for some users
> due to Google migrating the `add_source` endpoint. Implemented a dual-RPC fallback: the system
> tries the legacy `izAoDd` endpoint first, and if it returns code 3, automatically retries with
> the new `ozz5Z` endpoint."

Có một id thứ hai — **`ozz5Z`** — và nó xuất hiện theo đúng kiểu ADR 0012 mô tả cho shape: *"for
some users"*, tức theo cohort. Bằng chứng công khai chỉ nói về **loại URL**, mà ta không đi đường
URL (ràng buộc 3 của ADR 0012), nên **chưa kết luận được** đường text có cần `ozz5Z` không. Ghi ra
đây vì nó đảo một tiền đề của ADR, không phải vì đã đo được.

## Delivers

`buildParams` sinh ra shape mà một capture thật xác nhận, và cặp title/content nằm đúng chiều.

## Scope

- Sửa `buildParams` trong `src/notebooklm/rpc.js`. Không đụng bộ đọc phản hồi — nó đã nghiệm thu.
- **Thứ tự làm: capture trước, sửa sau.** Xem mục dưới. Đừng chép shape từ ticket này vào code rồi
  coi là xong — ticket này là *bằng chứng shape của ta sai*, không phải bằng chứng shape kia đúng
  cho cohort của owner.
- Nếu capture cho thấy phần tử thứ ba khác cả hai nguồn: tin capture, và ghi rõ nó khác ở đâu.
- `ozz5Z`: **không** thêm đường lui sang id thứ hai trong ticket này. Ghi nhận và để lại — thêm một
  id chưa đo được vào đường ghi là mở một biến mới ở đúng chỗ ADR 0012 dựng lên để đóng.

## Sửa đề bài — 2026-08-22, Lead

Bản đầu của ticket này bắt **capture trước, sửa sau**. Owner quyết ngược lại, và Lead thấy quyết
định ấy đúng hơn: không ai trong phòng đăng nhập được NotebookLM, nên "chờ capture" trên thực tế
là *không sửa gì cả*, trong khi code hiện tại **chắc chắn** lệch với mọi bằng chứng đang có.

Cân lại bằng hậu quả, không bằng độ chắc chắn:

| | giữ nguyên `[content, title]` | đổi theo hai nguồn |
|---|---|---|
| nếu hai nguồn **đúng** | Nguồn mang tên bằng nguyên transcript, **vĩnh viễn** (ADR 0010) | đúng |
| nếu hai nguồn **sai** | sai | `INVALID_ARGUMENT` → rơi về đường DOM, **hỏng đóng, không mất gì** |

Ô duy nhất mất dữ liệu nằm ở cột "giữ nguyên". Nên **đổi**.

**Ràng buộc đi kèm, vi phạm cái nào thì lập luận trên sụp:**

1. **Bộ đọc phải giữ nguyên tính hỏng đóng.** Cả biện hộ của việc sửa mù nằm ở chỗ shape sai thì
   ra `INVALID_ARGUMENT` rồi rơi về đường DOM. `canFallBackToDom` đang trả `true` cho
   `INVALID_ARGUMENT` — **đừng đụng vào**, và viết một test nói thẳng rằng đây là chỗ dựa của
   ticket này chứ không phải một chi tiết.
2. **Shape phải là một hằng số có tên, kèm xuất xứ ngay tại chỗ**, ghi rõ nó đến từ hai
   implementation công khai chứ không từ một capture. Người sau đọc `buildParams` phải thấy ngay
   mức độ tin cậy của từng phần tử.
3. **Chỗ hai nguồn bất đồng thì nói ra, đừng chọn thầm.** `notebooklm-py` viết phần tử thứ ba là
   `build_template_block()`; `notebooklm-mcp-cli` viết `[2], settings` (bốn phần tử top-level).
   Chọn một, và viết ngay cạnh rằng nguồn kia nói khác.
4. **Không thêm `ozz5Z`.** Xem mục Scope.

## Việc owner làm SAU, để xác minh (không còn là điều kiện tiên quyết)

Không ai trong phòng này đăng nhập được NotebookLM. Một capture thật là **đầu vào bắt buộc**:

1. Mở notebook **nháp**, DevTools → Network, lọc `batchexecute`.
2. Thêm một nguồn **dán chữ** bằng tay, với tiêu đề và nội dung **phân biệt được nhau rõ ràng** —
   ví dụ tiêu đề `AAA-TIEU-DE-AAA`, nội dung `BBB-NOI-DUNG-BBB`. Đừng dùng chuỗi ngắn giống nhau:
   cả ticket này xoay quanh việc hai chuỗi cùng kiểu bị đảo, nên capture phải tự nói ra chiều.
3. Chép giá trị `f.req` ở tab Payload, dán vào ticket này.

Không cần che gì nếu dùng đúng hai chuỗi giả trên — đó là lý do chọn chúng.

## Acceptance

- Test đối chiếu `buildParams` với hằng số shape có xuất xứ, và hằng số ấy **không được chép rời**
  ở hai chỗ — đúng cái bẫy đã cho ticket 015 đi lọt (`WORKSPACE_PROTOCOL.md`, và ghi chép của Lead
  về "test ghim hằng số chép tay"). Khi có capture thì chỉ phải sửa **một** chỗ.
- Trả lời được: test nào chết nếu `canFallBackToDom(INVALID_ARGUMENT)` đổi thành `false`? Đó là
  chỗ dựa của cả ticket này.
- Trả lời được: test nào chết nếu `title` và `content` hoán vị? Câu này đã có một lần trả lời sai
  trong repo — lần này nó phải chết vì **đối chiếu với capture**, không vì một hằng số chép tay.
- Trả lời được: test nào chết nếu chỉ dấu loại `2` ở chỉ số 3 thành `null`?
- Suite xanh, in `tests N`.

## Nguồn

- `teng-lin/notebooklm-py` — `src/notebooklm/_source/add.py`, `docs/rpc-reference.md`
- `jacob-bd/notebooklm-mcp-cli` — `docs/API_REFERENCE.md`, `CHANGELOG.md` v0.5.16 (2026-04-04)
- `LocalKinAI/notebooklm-go` — xác nhận `RPCAddSource = "izAoDd"`, không tài liệu hoá shape

---

## Nghiệm thu — 2026-08-23, Lead

**Trạng thái: ĐÃ NHẬN.** Commit `6326187` + `341a71a`. Không cần vá vòng hai.

### Bằng chứng Lead tự chạy
`bash test/run.sh` → `XANH — tests 783, 25 file.` (nền 778 / 25)

### Hình dạng bản vá — và vì sao nó đúng hơn thứ ticket yêu cầu
Ticket đòi "một hằng số có tên kèm xuất xứ". Peer làm hơn thế: `buildParams` **không còn tự phát
biểu shape**, nó chỉ *điền vào* `TEXT_PARAMS_SPECIMEN` — chỗ duy nhất trong repo phát biểu shape
ấy. Ba chỗ giữ chỗ là ba chuỗi **tự gọi tên mình**, và hai chuỗi đầu đúng bằng hai chuỗi ticket
dặn owner dùng lúc chụp capture (`AAA-TIEU-DE-AAA` / `BBB-NOI-DUNG-BBB`).

Hệ quả đáng giá nhất nằm ở chi tiết ấy: **chiều của cặp tiêu đề/nội dung nằm trong chính chuỗi,
không nằm trong một comment cạnh nó.** Đọc mẫu là đọc ra chiều, không phải tin lời. Và khi capture
về thì nó **dán đè thẳng** lên mẫu — sửa đúng một chỗ.

Từng ô của mẫu đánh dấu `[cả hai]` hay `[bất đồng]`, nên mức tin cậy đọc được tại chỗ. Ô `[0]` là
chỗ hai nguồn bất đồng (một lớp bọc hay hai); peer chọn `notebooklm-py` **và nói rõ** đó cũng là độ
sâu code đang có, tức ô duy nhất trong ba chỗ lệch mà ticket giữ nguyên thay vì đổi.

### Bằng chứng mạnh nhất lấy được mà không đăng nhập
Peer boot service worker **thật** với `chrome` giả + `fetch` giả, chạy trọn một lượt import, in
nguyên văn thân request sẽ đi trên dây:
```
?rpcids=izAoDd&source-path=%2Fnotebook%2Fabcd1234efgh&f.sid=…&hl=en&rt=c
params = [[[ null,
             ["docs.acme.dev — Hướng dẫn",   ← tiêu đề, ô đầu
              "# Một trang\n- Link gốc: …"], ← nội dung, ô sau
             null, 2, null,null,null,null,null,null, 1 ]],
          "abcd1234efgh", [2]]
```
Đây là thứ gần "chạy thật" nhất mà ràng buộc cho phép, và nó **không** gửi một request nào.

### Ba phép xanh mà peer cố ý KHÔNG vá — Lead đồng ý
M1 (hoán vị tiêu đề/nội dung **ngay trong mẫu**), M2 (hoán vị hai giá trị `PARAMS_MARKS`), M6 (gỡ
phần tử thứ ba khỏi mẫu) đều **XANH**.

Cả ba là hoán vị *chính cái mẫu*, tức chính lời khẳng định chưa đo. Lập luận của peer, Lead nhận:
vá chúng đòi một assert thứ hai ghim "tiêu đề đứng trước" trong test — **đúng bản sao thứ hai** mà
Acceptance cấm, và đúng cái bẫy đã cho ticket 015 đi lọt. Chiều của cặp được phát biểu **một lần**,
ở chỗ capture sẽ đè lên. Mọi hoán vị **ngoài** mẫu đều chết (M3, M5, M8, M9, M11 — ĐỎ).

M7 (`canFallBackToDom(INVALID_ARGUMENT)` → `false`) giết **6 test**, gồm một test gọi thẳng tên
tiền đề. Đó là chỗ dựa của cả quyết định "sửa mù", và nó có canh.

### Phép Lead tự chạy — cặp ngoài danh sách M1–M11
Danh sách của peer canh *hình dạng* rất kỹ nhưng không canh **tương ứng giữa nhiều Nguồn trong một
lượt**. Lead chạy hai biến thể:

| phép | kết quả |
|---|---|
| `fillMarks` cache cả mảng — Nguồn thứ hai trở đi dùng lại params của Nguồn đầu | **ĐỎ** (1 test) |
| mỗi lượt vẫn dựng mảng **mới**, chỉ **giá trị** là của Nguồn đầu | **ĐỎ** (1 test) |

Biến thể thứ hai là phép quan trọng: nếu phép canh chỉ so danh tính mảng thì nó sẽ xanh. Nó đỏ,
nên `shape — mỗi lượt dựng một mảng MỚI…` có kiểm **nội dung** thật.

**Nợ ghi ra từ chính phép này:** chỉ **một** test bắt, và nó ở tầng đơn vị. Tầng service worker
không bắt — tức lượt import nhiều Nguồn chưa được canh ở chỗ nó thật sự chạy. Hậu quả nếu lỗi ấy
xảy ra thật: mọi Nguồn sau Nguồn đầu mang nội dung của Nguồn đầu, **vĩnh viễn** (ADR 0010). Chưa
mở ticket vì guard hiện có bắt được cả hai biến thể; ghi ra để lần sau ai chạm `fillMarks` biết
lưới ở đây mỏng.

### Peer tự sửa hai chỗ tài liệu đã lệch
- Runbook chạy thật của ticket 015 bảo owner *"sửa một dòng trong `buildParams`"* — dòng ấy không
  còn. Nay trỏ đúng vào `TEXT_PARAMS_SPECIMEN` kèm cách áp capture.
- `WORKSPACE_PROTOCOL.md` header còn `version: 9` trong khi evolution log đã có v10. **Đây là chỗ
  Lead sót** khi bump v10 ở ticket 019; peer bắt được.

### Việc Lead nợ, nay đã trả
Peer đúng khi không tự viết: ADR 0012 vẫn chốt *"`izAoDd` không bị xoay lần nào trong 7,5 tháng"*.
Đã thêm mục **Đính chính** vào `docs/adr/0012-*`: có id thứ hai `ozz5Z`, bằng chứng công khai chỉ
nói về loại URL, quyết định của ADR **không đổi** — và lý do không đổi là `ozz5Z` xuất hiện kèm
`INVALID_ARGUMENT`, tức rơi đúng vào hạng mà bộ đọc hỏng đóng và cho rơi về đường DOM.

### Còn thiếu bằng chứng ở đâu — nói thẳng
**Chiều của cặp tiêu đề/nội dung vẫn dựa trên hai nguồn công khai, không dựa trên phép đo.** Không
test nào chứng minh được nó tới khi có capture; M1/M2 xanh là cách repo tự thú nhận điều đó thay vì
che đi. Owner chụp capture theo mục *"Việc owner làm SAU"* là đóng được, và chỉ phải sửa một chỗ.
