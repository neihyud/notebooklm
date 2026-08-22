---
status: open
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
