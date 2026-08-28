# 007 — `parseUrlList` nuốt link và bịa ra id

- status: draft — **chưa giao**
- class: cross-module → `WORKSPACE_PROTOCOL.md:100-102` xếp *"bất cứ thay đổi nào chạm
  `src/common/shared.js`"* vào hạng này. Cần review seat độc lập, không tự nhận là tiny.
- tách từ: `docs/tickets/006-duong-trao-tay.md` → "Không thuộc phạm vi". Ticket 006 **không**
  sửa hai lỗi này; nó chỉ phát hiện ra chúng lúc điều tra.
- blocked-by: một trong ba chỗ phải sửa là `src/popup/popup.js` (mục 3), đang có 222 dòng chưa
  commit của một luồng khác. Hai chỗ còn lại — `src/common/shared.js` và
  `src/background/service-worker.js` — **sạch**. Chia bước theo đúng đường đó, xem "Thứ tự".
- không đụng: `rpc.js`, `automation.js`, `selectors.js`, `manifest.json`.

## Bối cảnh

`parseUrlList` (`src/common/shared.js:242-253`) tách một khối text tự do thành danh sách
`videoId`. Ba chỗ gọi nó, và cả ba đều đưa vào thứ **không phải** danh sách URL YouTube sạch:

| gọi từ | đầu vào thật là gì |
|---|---|
| `collectFromPage` (`src/background/service-worker.js:1251`) | mọi `a[href]` của một trang bất kỳ |
| menu chuột phải `nblm-selection` (`:1513`) | `info.selectionText` — **văn xuôi người dùng bôi đen** |
| ô dán hàng loạt của popup (`src/popup/popup.js:334`) | text người dùng dán |

Hàm chỉ trả về `videoId`. Mọi thứ khác biến mất, và không ai đếm.

## Hai lỗi, đo được

Đo 2026-08-25, nạp `src/common/shared.js` thật vào một sandbox `vm` **có `URL` trong scope**
(thiếu `URL` thì mọi nhánh URL rơi vào `catch (_) { return null }` và cho ra một bảng số
sai toàn bộ — tôi đã dính đúng bẫy đó ở lần đo đầu, ghi ra đây để người sau khỏi lặp lại):

| đầu vào | `parseUrlList` trả về |
|---|---|
| `'doc javascripts here'` | `['javascripts']` |
| `'transcripts'` | `['transcripts']` |
| `'javascripts https://youtu.be/bbbbbbbbbbb'` | `['javascripts','bbbbbbbbbbb']` |
| `'https://docs.python.org/3/tutorial/ https://youtu.be/aaaaaaaaaaa'` | `['aaaaaaaaaaa']` |
| `'https://example.com/a https://example.com/b'` | `[]` |
| `'Xem tài liệu tại https://vitepress.dev/guide/what-is-vitepress'` | `[]` |

### Lỗi 1 — id ma từ một từ tiếng Anh 11 ký tự

`videoIdFrom` mở đầu bằng `if (/^[\w-]{11}$/.test(raw)) return raw;` (`shared.js:212`). Bất kỳ
từ nào đúng 11 ký tự `[\w-]` đều thành một videoId. `javascripts` và `transcripts` — **hai từ
xuất hiện thường xuyên trong chính miền của extension này** — đều lọt.

`canonicalUrl` không có guard, nên id ma đi thẳng thành
`https://www.youtube.com/watch?v=javascripts` (đo thật).

Nó **không** hỏng câm hoàn toàn: `resolveMeta` (`src/background/service-worker.js:552-557`) ép
một lượt `YT_DESCRIBE` và `throw` khi không đọc được, nên Mục ma sẽ dừng ở `ERROR`. Nhưng:
- Hàng đợi có thêm một Mục rác phải xoá tay.
- Ở hàng thứ ba của bảng trên, id ma **đi kèm một link thật** — người dùng thấy "đã thêm 2
  video" và không có lý do gì để nghi ngờ cho tới lúc một cái đỏ lên.

### Lỗi 2 — URL không phải YouTube biến mất, và có chỗ biến mất hoàn toàn im lặng

Ticket 006 bản đầu viết *"vứt im lặng"*. Đo lại thì **đó là nói quá**, và chỗ nói quá lại che
mất đúng ca tệ nhất. Ba mức khác nhau:

1. **Có báo** — `collectFromPage:1252` (*"Không thấy link YouTube nào trên trang này."*) và
   menu chuột phải `:1516` (*"Không nhận ra video YouTube nào từ lựa chọn đó."*), khi kết quả
   rỗng hoàn toàn. Câu chữ đúng sự thật, chỉ là vô ích với người vừa bôi đen 20 link docs.
2. **Im lặng một phần** — danh sách **trộn**. `ids.length > 0` nên nhánh báo lỗi không chạy;
   link docs bay mất mà không ai đếm. Đây là hàng thứ tư của bảng trên.
3. **Im lặng tuyệt đối** — `src/popup/popup.js:334-337`:
   ```js
   const ids = parseUrlList(els.bulk.value);
   if (!ids.length) {
     els.bulk.focus();
     return;
   }
   ```
   Dán 20 link docs vào ô đó thì ô nhấp nháy focus và **không một chữ nào** được nói ra. Nút
   trông như hỏng.

Đáng nói: extension này **có** đường xử lý tài liệu (`KIND.DOCS`), và menu chuột phải
`nblm-docs-link` (`:1500-1508`) định tuyến đúng cho **một** link. Nên đây không phải "tính năng
chưa có" — nó là ba lối vào không với được tới một đường đã tồn tại.

## Kết quả cần có

### 1. Gỡ nhánh id trần khỏi `videoIdFrom`, đừng bọc thêm lớp lọc

Ba đường đã cân:

- **(A) `parseUrlList` chỉ nhận id trần khi *mọi* token đều parse được.** Bỏ — đo được là
  không cắn: `'javascripts https://youtu.be/bbbbbbbbbbb'` có **cả hai** token parse được, nên
  luật này cho id ma đi qua nguyên vẹn. Đây là hàng thứ ba của bảng, chọn (A) là sửa xong mà
  ca tệ nhất vẫn còn.
- **(B) thêm cờ `parseUrlList(text, { bareIds })`**, bật ở ô popup, tắt ở menu chuột phải. Chạy
  được, nhưng phải luồn một tham số qua ba call site để giữ một tính năng **chưa từng được
  quảng cáo ở đâu**: nhãn ô là *"Dán link YouTube (mỗi dòng một link)"* và placeholder chỉ có
  URL đầy đủ (`src/popup/popup.html:64`, `:67` — cả bản đang sửa dở lẫn bản `HEAD` đều thế).
- **(C) gỡ hẳn nhánh `/^[\w-]{11}$/` khỏi `videoIdFrom`** ← **chọn cái này.** Mọi call site
  khác của `videoIdFrom` đều đưa vào một URL (`tab.url`, `link.href`, `info.linkUrl`,
  `info.pageUrl`, `raw.url`), nên nhánh id trần chỉ phục vụ đúng `parseUrlList`, nơi nó đang
  gây hại.

**Nhưng (C) buộc phải xoá một test đang xanh** — `test/shared.test.js:17`:
`eq(N.videoIdFrom('dQw4w9WgXcQ'), 'dQw4w9WgXcQ', 'id trần')`. Xoá một test để thay đổi của mình
đi qua là loại việc phải **nói ra và biện minh**, không được lẳng lặng làm. Nên trước khi xoá,
peer phải trình bằng chứng cho đúng một câu: *không call site nào ngoài `parseUrlList` từng đưa
một id trần vào `videoIdFrom`.* Cách đo được đặt hàng:

- liệt kê **hết** call site bằng `rg -n "videoIdFrom\("` (đo 2026-08-25 được 9 chỗ trong `src`);
- với `service-worker.js:495` (`raw.videoId || videoIdFrom(raw.url || '')`) thì lần ngược xem
  `raw.url` có bao giờ là một id trần không — đây là chỗ duy nhất trong 9 chỗ mà câu trả lời
  không hiển nhiên từ tên biến.

Nếu bằng chứng **không** đứng được thì lùi về (B) và ghi lý do. Đừng chọn (A).

### 2. Link bị bỏ phải đếm được

`parseUrlList` trả thêm danh sách những token **là URL hợp lệ nhưng không phải YouTube**. Hình
dạng đề xuất: giữ nguyên giá trị trả về cũ là mảng id, thêm một hàm chị em
`parseUrlList.withRejects(text) → { ids, others }`, để ba call site chuyển dần chứ không phải
sửa hết trong một nhát. Peer được quyền đề xuất hình dạng khác — nhưng phải nói rõ nó ảnh
hưởng bao nhiêu call site.

Ba call site nói ra con số đó:
- `collectFromPage` → thêm `others` vào kết quả trả về; popup hiện *"bỏ qua N link không phải
  YouTube"*.
- menu chuột phải → `note()` nói đúng số, thay vì *"Không nhận ra video YouTube nào"*.
- ô popup → **thay `focus()` câm bằng một câu**. Đây là thay đổi nhỏ nhất trong ba cái và là
  cái sửa được ca tệ nhất.

**Không thuộc phạm vi**: định tuyến những URL đó sang `KIND.DOCS`. Đó là một tính năng, cần
quyết định riêng (hàng đợi trộn hai loại, `enqueue` phải nhận `kind` từ ba lối vào mới). Ticket
này dừng ở **làm cho nhìn thấy được**.

## Thứ tự

Chia theo trạng thái cây làm việc, không theo "logic trước UI sau":

1. **`src/common/shared.js` + `test/shared.test.js`** — gỡ nhánh id trần, thêm `withRejects`.
   Cây sạch, làm được ngay. Kết thúc bằng `bash test/run.sh` xanh.
2. **`src/background/service-worker.js`** — hai call site. Cũng sạch.
3. **`src/popup/popup.js`** — chờ luồng UI kia commit. **Không** stash hộ họ, không sửa đè.

Bước 1 và 2 đứng độc lập được: sau chúng, ô popup vẫn câm nhưng không còn bịa id ma nữa.

## Ràng buộc

1. Không thêm permission nào vào `manifest.json`.
2. Không đụng `parseUrlList` theo hướng làm nó *đoán nhiều hơn*. Lỗi ở đây là đoán quá tay.
3. Không sửa `src/popup/*` khi luồng kia còn chưa commit.
4. Xoá test thì phải nêu tên test, lý do, và bằng chứng — xem mục 1.

## Kiểm chứng

`bash test/run.sh` phải xanh. Baseline đo trên cây sạch khi nhận ticket; con số hiện tại là
**787 pass / 0 fail** (đo 2026-08-25 trên `d37a9ec` + 6 file UI chưa commit — *không* phải cây
sạch, nên đo lại chứ đừng chép).

Fixture cho `test/shared.test.js` lấy thẳng từ bảng "Hai lỗi, đo được" bên trên — sáu hàng đó
là sáu ca đã đo, không phải ví dụ bịa.

## Ở acceptance sẽ hỏi

Ba hoán vị. Mỗi câu nói rõ **chiều nào phải đỏ**.

1. **Trả lại nhánh `/^[\w-]{11}$/` vào `videoIdFrom`.** Chiều phải đỏ: **bản hoán vị**. Assert
   `parseUrlList('doc javascripts here')` **deepEqual `[]`**.

   Và bắt buộc thêm ca trộn: `parseUrlList('javascripts https://youtu.be/bbbbbbbbbbb')`
   **deepEqual `['bbbbbbbbbbb']`** — so mảng, **ghim cả độ dài**. Một assert kiểu
   `ids.includes('bbbbbbbbbbb')` sẽ **xanh cả hai chiều**, vì id thật vẫn có mặt ở bản hoán vị;
   repo này đã dính đúng hình dạng đó rồi (`memory: includes bắt nhầm chỗ`). Thiếu ca trộn thì
   hoán vị chỉ canh được ca dễ.

2. **Trả về `others.length` thay vì `others`.** Chiều phải đỏ: **bản hoán vị**. Fixture:
   `'https://docs.python.org/3/tutorial/ https://example.com/a https://youtu.be/aaaaaaaaaaa'`.
   Assert `ids` deepEqual `['aaaaaaaaaaa']` **và** `others` deepEqual đúng hai URL kia, **đúng
   thứ tự xuất hiện**. Chỉ assert `others.length === 2` là xanh cả hai chiều — đó chính là hoán
   vị này, nên đừng viết assert kiểu đó rồi tưởng mình đã canh.

3. **Hoán vị hai vế của `{ ids, others }`.** Cả hai là mảng chuỗi, cùng hình dạng, nên mọi
   assert kiểu "trả về hai mảng" xanh cả hai chiều — mà hệ quả thật là toàn bộ link docs bị
   xếp hàng làm video và ngược lại. Ghim theo **slot**: với fixture ở câu 2, assert
   `ids[0] === 'aaaaaaaaaaa'` **và** `others[0].startsWith('https://docs.python.org')`. Hai vế
   phải khác *loại nội dung*, không chỉ khác tên biến.

Câu nào trả lời là "không test nào" thì đó vẫn là kết quả hợp lệ — **nhưng phải nói ra**.
