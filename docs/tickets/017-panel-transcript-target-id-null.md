---
status: done
labels: [ready-for-agent, bug]
blocked_by: [012]
spec: docs/spec/0001-notebooklm-importer.md
---

# 017 — Panel transcript đang mở mang `target-id = null`, và `narrow-window` là chẩn đoán sai

## Vì sao ticket này tồn tại

Ticket 012 chạy chính extension này trên Chrome for Testing 151 với một video công khai thật. Lead
chạy lại độc lập và ra cùng kết quả:

```
node tools/verify-live.mjs --video jNQXAC9IVRw

nút Transcript  : đã bấm — "Show transcript"
số lượt quét    : 24
segment         : 0
dòng segment có trên trang (ngoài mọi ràng buộc panel) : 3
lý do           : narrow-window — cửa sổ quá hẹp…            ← cửa sổ 1440px
  panel target-id="PAmodern_transcript_view"                HIDDEN    dòng=0  khớp selector 'panel'=true
  panel target-id=null                                      EXPANDED  dòng=3  khớp selector 'panel'=false
  panel target-id="engagement-panel-searchable-transcript"   HIDDEN    dòng=0  khớp selector 'panel'=true
```

Panel **đang mở** mang `target-id = null`, nên nó không khớp
`ytd-engagement-panel-section-list-renderer[target-id*="transcript"]`
(`src/youtube/selectors.js:27`). Hai panel **khớp** selector thì đều ẩn. Extension nhìn thấy đúng
những panel ẩn, kết luận "cửa sổ quá hẹp", và dừng.

Hai chuyện, không phải một:

1. **Selector không bắt được panel đang mở.** Transcript có ở đó, 3 dòng, rộng 494px.
2. **`narrow-window` là chẩn đoán sai, và nó cắt luôn đường lui.** `watch.js:140` và
   `transcript.js:390` cố ý **không thử lại** khi `REASON.NARROW` — logic ấy đúng cho cửa sổ hẹp
   thật, nhưng ở đây nó biến một lần dò hụt thành một lần bỏ cuộc.

Mức nghiêm trọng: ADR 0003 định tuyến **video riêng tư sang DOM-only**, nên đây là đường **duy
nhất** của chúng. Và ticket 012 cho thấy đường InnerTube đã chết hẳn (`get_transcript` trả 400 với
cả params do chính YouTube đúc) — tức hôm nay đây là đường duy nhất của **mọi** video.

Lỗi phụ thuộc video: trên `dQw4w9WgXcQ` panel mở mang `target-id="PAmodern_transcript_view"` và
đường này chạy tốt, 24 segment. Một lần thử tay sẽ không thấy gì.

## Delivers

Đường DOM trích được transcript trên cả hai video, và `narrow-window` chỉ được nói khi cửa sổ
thật sự hẹp.

## Scope

- Selector `panel` bắt được panel transcript đang mở kể cả khi `target-id` vắng mặt. Mọi nhãn và
  selector phải ở `src/youtube/selectors.js` và ghi đè được từ trang Cài đặt
  (`WORKSPACE_PROTOCOL.md`) — **không** rải điều kiện mới ra `transcript.js`.
- Phân biệt được ba trạng thái, đừng gộp: *không có panel nào* / *có panel nhưng đang ẩn vì layout
  hẹp* / *có panel đang mở mà ta không nhận ra*. Trạng thái thứ ba hôm nay đang bị gọi tên bằng
  trạng thái thứ hai.
- `REASON.NARROW` chỉ được kết luận khi có bằng chứng về **bề rộng**, không phải khi chỉ thấy
  thuộc tính `visibility`. Bằng chứng đo được thì phải đo (`getBoundingClientRect` giờ đã có trong
  cây giả — ticket 016).

## Acceptance

- `node tools/verify-live.mjs --video jNQXAC9IVRw` → xanh, dán output thật.
- `node tools/verify-live.mjs --video dQw4w9WgXcQ` → vẫn xanh, dán output thật. Không được sửa
  video này thành hỏng để video kia chạy.
- Trả lời được: **test nào chết** nếu selector quay lại bản chỉ khớp `target-id*="transcript"`?
- Trả lời được: test nào chết nếu `REASON.NARROW` được trả về cho một panel rộng 494px?
- Trả lời được: hai trạng thái "panel ẩn vì hẹp" ↔ "panel mở mà không nhận ra" — hoán vị hai lý do
  ấy cho nhau thì test nào chết? Cả hai đều là chuỗi lý do hợp lệ và cả hai đều dừng lượt chạy.
- Suite xanh, in `tests N`. Đụng `test/helpers/fake-dom.js` thì chạy `node tools/audit-fake-dom.mjs`.

## Ranh giới

- **Không đụng đường InnerTube** — đó là ticket 013, và nó đã chết vì lý do khác hẳn.
- Không đăng nhập Google. Video công khai, ghi rõ id đã dùng.
- Không nới `viaDom` thành "cứ thử lại mãi": nếu bạn gỡ lối tắt NARROW thì phải nói rõ trần mới là
  gì và vì sao.

---

## Nghiệm thu — 2026-08-22, Lead

**Trạng thái: ĐÃ NHẬN**, sau hai vòng. Commit `e2a8460` + `861a955`.

### Bằng chứng Lead tự chạy
```
bash test/run.sh                                → XANH — tests 695, 24 file   (nền 677 / 24)
node tools/verify-live.mjs --video jNQXAC9IVRw  → ✓ DOM  3 segment   (trước ticket này: 0)
node tools/verify-live.mjs --video dQw4w9WgXcQ  → ✓ DOM 24 segment   (không hỏng đi)
```
Ba dòng đỏ còn lại trong cả hai lượt đều thuộc đường InnerTube — ticket 013.

### Vòng một — sửa đúng hai chuyện, không phải một
Selector bắt được panel không mang `target-id`, **và** `REASON.NARROW` chỉ được kết luận khi mọi
panel ẩn đều đo ra 0px bề rộng. Thêm `REASON.UNRECOGNIZED` tách khỏi `NARROW`: "panel đang mở mà
selector không nhận ra" không còn bị gọi tên bằng "cửa sổ hẹp" — và vì `NARROW` cắt đường lui
(`transcript.js:460`), gọi sai tên ở đây là bỏ cuộc, không phải chỉ báo nhầm.

Peer khai thẳng một chỗ nó **không** canh được, và khai đúng: hoán vị hai *giá trị chuỗi* của
`REASON.NARROW` ↔ `REASON.UNRECOGNIZED` không giết test nào, vì mọi so sánh đều qua hằng số nên hai
đầu dịch cùng nhau và không consumer nào đọc chuỗi trần. Thứ canh được là **quan hệ tình huống →
lý do → câu chữ**. Lead nhận lập luận này.

Nó cũng khai một đường lui đã mất: bản cũ quét cả cây node khi không panel nào khớp, và bản này bỏ
đi. Cố ý — quét mù cả trang là cách nhặt phải panel của video A trên trang video B (đúng hạng lỗi
ticket 006) và nó giấu việc selector đã hỏng — nhưng đây là một khả năng thật đã mất, ghi lại.

### Vòng hai — cặp Lead chọn, ngoài danh sách của peer, và nó hở
**`Math.max` ↔ `Math.min` trên `widths`.** Hai phép rút gọn cùng kiểu, cùng trả một số px hợp lệ.

→ `test/run.sh: XANH — tests 691, 24 file.` Không một test nào chết.

Chúng chỉ khác nhau khi có **nhiều hơn một** panel ẩn — đúng hình của trang thật: dump live cho
**ba** panel, 0px / 494px / 0px. Với `min`, panel 0px thắng → `REASON.NARROW` → cắt đường lui. Tức
hoán vị này **dựng lại đúng con bọ ticket 017 vừa gỡ**, chỉ khác là chỉ xảy ra khi trang có nhiều
panel.

Vì sao suite không bắt: test mới dựng **một** panel, mà ở n=1 thì `max`, `min`, `widths[0]`,
`widths.at(-1)` là cùng một số — fixture ấy về nguyên tắc không phân biệt được bất kỳ phép rút gọn
nào.

Sau vá, Lead chạy lại **cả ba** biến thể: `Math.min` → ĐỎ, `widths[0]` → ĐỎ, `widths.at(-1)` → ĐỎ.
Fixture mới đặt panel rộng **ở giữa** — đầu hoặc cuối thì `[0]`/`at(-1)` vẫn lọt. Vòng hai
**không đụng một dòng mã sản phẩm nào**: `Math.max` vốn đã đúng, chỗ hỏng là thước đo.

Peer soi lại cả khối theo cùng câu hỏi và tìm thêm ba chỗ cùng hạng, mỗi chỗ một test: `some` ↔
`every` trên phép đo `null`; `panels.length` ↔ `open.length` (9 test chết); `strays.length` ↔
`panels.length` trong câu thông báo.

### Luật rút ra, đáng ghi vào protocol
**Fixture một phần tử không phân biệt được bất kỳ phép rút gọn nào trên tập.** `max`, `min`,
`[0]`, `at(-1)`, `some`, `every` trùng nhau hết ở n=1. Chỗ nào code rút một tập thành một số hay
một boolean thì fixture phải có ≥2 phần tử khác nhau đôi một, và phần tử "đặc biệt" **không được
nằm ở đầu hay cuối**.

### Nợ ghi lại
- **`REASON.NARROW` gần như không với tới được trên YouTube hôm nay.** Chrome ở khuôn này kẹp bề
  rộng tối thiểu ở 500px (`--window-size=360,760` vẫn ra `innerWidth 500`), và ở 500px thì YouTube
  dựng transcript ở chỗ khác — bản sửa này vẫn trích được 24 segment. Nhánh ấy giờ chỉ còn được
  canh bằng test cây giả.
- Không test nào chạy `tools/verify-live.mjs` như một module, nên **một lỗi cú pháp trong file ấy
  vẫn để cả suite xanh**. Peer tự gây ra một lỗi như thế giữa chừng và chỉ biết khi chạy tay.
