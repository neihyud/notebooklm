---
status: proposed
---

# Đường trích thứ hai là `get_panel`, không phải `timedtext`

Ticket 013 mở ra với tên `timedtext` trong tiêu đề. Ticket 012 đo trên trang thật rồi sửa đề bài:
`get_transcript` không sai mà **chết**, và endpoint mà chính giao diện YouTube gọi khi người ta
bấm nút Transcript là `/youtubei/v1/get_panel`. Vì thế ADR này chọn giữa hai ứng viên bằng **số
đo**, không bằng lập luận.

## Phép đo

Chrome for Testing 151.0.7922.34, hồ sơ tạm, **không đăng nhập Google**. Bốn video công khai, mỗi
video một trang, ba đường đo trong **cùng một phiên trên cùng một trang** — điều kiện để so được
với nhau. Công cụ: `tools/verify-live.mjs` (hai video đầu) và cùng khuôn đo cho hai video còn lại.

| video | phụ đề trang khai | `timedtext` (qua `captionBaseUrl`) | `get_panel` | đường DOM |
|---|---|---|---|---|
| `jNQXAC9IVRw` | en, de | HTTP 200, **0 byte**, 0 segment | HTTP 200, 11 441 byte, **3 segment** | 3 segment |
| `dQw4w9WgXcQ` | en, en/asr, de-DE, ja, pt-BR, es-419 | HTTP 200, **0 byte**, 0 segment | HTTP 200, 34 888 byte, **24 segment** | 24 segment |
| `M7lc1UVf-VE` | en, en/asr | HTTP 200, **0 byte**, 0 segment | HTTP 200, 264 283 byte, **189 segment** | **0 segment** (`empty`) |
| `aqz-KE-bpKQ` | *(không có)* | không có `captionBaseUrl` | HTTP 200, 960 byte, 0 segment, **không có khối `content`** | 0 segment (`no-panel`) |

`timedtext` còn được thử năm biến thể URL trên `jNQXAC9IVRw`, cùng phiên cùng trang:

```
json3 (như sản phẩm)   HTTP 200, 0 byte      exp=xpe
xml mặc định           HTTP 200, 0 byte
json3 + potc=1         HTTP 200, 0 byte
json3 + c=WEB          HTTP 200, 0 byte
json3, bỏ tham số exp  HTTP 404, 1910 byte   ← trang lỗi HTML, không phải phụ đề
```

Và đường `get_transcript` của ticket 012 vẫn đo lại mỗi lượt: HTTP 400 `FAILED_PRECONDITION` với
cả bốn loại `params`, kể cả chuỗi do chính YouTube đúc.

## Quyết định

**`get_panel` là đường trích thứ hai. `timedtext` không vào tuyến.**

Tuyến cho video không private (`API_ROUTE` trong `src/youtube/transcript.js`) thành
`['panel', 'innertube', 'dom']`:

- `panel` đứng đầu vì nó là đường duy nhất **còn trả về dữ liệu**, và vì nó là endpoint mà chính
  trang gọi — thứ YouTube ít có lý do bỏ nhất.
- `innertube` (`get_transcript`) tụt xuống hàng hai chứ **không bị xoá**: xoá code đã có trong cây
  làm việc là quyết định của owner (`WORKSPACE_PROTOCOL.md`). Nó chỉ chạy sau khi `panel` đã hỏng,
  nên cái giá của việc giữ nó là một lượt gọi thừa **trong nhánh hỏng**, không phải ở mọi video.
- `timedtext` ra khỏi tuyến. `viaTimedText()` và `parseTimedText()` vẫn còn nguyên trong file. Lý
  do bỏ khỏi tuyến chứ không phải bỏ khỏi file: một mục tuyến không có adapter in ra dòng lý do
  *"không có adapter cho đường này"*, mà sự thật là **đã có adapter và endpoint bị PoToken khoá** —
  hai câu trả lời khác hẳn nhau, và `attempts` là thứ duy nhất nói được vì sao một video rớt
  (ADR 0008).

Thứ tự vẫn do **mức riêng tư** quyết định, không do tốc độ: video private đi thẳng đường DOM, ADR
0003 nguyên vẹn. Không có lần "thử đường mạng trước rồi lui".

## Hai ca "0 segment" phải tách nhau ở tầng dữ liệu

Ràng buộc cứng của ticket: *HTTP 200 với 0 segment là **hỏng**, không phải "video không có phụ
đề"*. Nếu gộp, một lượt chạy "thành công" sẽ ghi vào Sổ đã import một video chưa hề trích được gì,
và ADR 0009 đọc chính Sổ ấy để biết phần nào đã có.

Phép đo cho hai chỗ tách được, và cả hai đều là **dữ liệu**, không phải câu chữ trong log:

1. `captionTracks` trong `ytInitialPlayerResponse` — biết trước khi gọi mạng.
2. Khối `content` trong câu trả lời `get_panel`. Video không phụ đề trả 960 byte chỉ có
   `responseContext` và `trackingParams`; video có phụ đề luôn có `content`.

Hai mã đi ra ngoài lớp trích qua `attempts[].code`:

| mã | nghĩa | bằng chứng |
|---|---|---|
| `no-captions` | video này không có phụ đề | `captionTracks` rỗng *của đúng video này*, hoặc trả lời không có `content` |
| `blank-response` | **hỏng** — gọi được mà không ra dòng nào | có `content` mà không đọc ra segment |

`timedtext` rơi trọn vào ô thứ hai ở mọi video đo được. Đó cũng là lý do thực dụng để loại nó:
một đường trích mà ca thành công và ca hỏng cho **cùng một phản hồi** (HTTP 200, rỗng) thì không
phân biệt được bằng gì cả.

## Op mới trên cầu MAIN world, và ranh giới không đổi

`playerResponse` là op thứ ba của `src/youtube/page-bridge.js`. Nó **không** vào `AUTH_OPS` và
không được chạm tới header `Authorization: SAPISIDHASH`: nó chỉ đọc một biến toàn cục mà một tab
ẩn danh chưa đăng nhập cũng đọc được nguyên vẹn, và nó không hỏi máy chủ điều gì. Ranh giới của
`WORKSPACE_PROTOCOL.md` v4 là **auth, không phải số op**.

Ảnh chụp đi ra theo **danh sách trắng**, đúng khuôn `ytcfgSnapshot()`: chỉ `videoId` và
`captionTracks` (mã ngôn ngữ, `kind`, tên). `baseUrl` của từng caption track **không** đi ra — nó
là URL đã ký, và phép đo ở trên cho thấy nó vô dụng.

## Một thứ của video A còn sống trên trang video B

Đo được trên Chrome thật, và nó là hình lặp lại mà `WORKSPACE_PROTOCOL.md` v5 bắt phải soi ở mọi
ticket:

```
mở https://www.youtube.com/watch?v=jNQXAC9IVRw
  location.href                                     jNQXAC9IVRw
  ytInitialPlayerResponse.videoDetails.videoId      jNQXAC9IVRw
bấm một link video khác trên trang (điều hướng SPA, không tải lại trang)
  location.href                                     do7psVA1K3g
  ytInitialPlayerResponse.videoDetails.videoId      jNQXAC9IVRw   ← vẫn là video A
  captionTracks                                     2 track của video A
```

Hệ quả cho thiết kế: ảnh chụp `playerResponse` **chỉ được tin khi nó nói về đúng video đang
hỏi**. Lệch id thì nó bị **bỏ qua**, không bị coi là lỗi — nó không phải bằng chứng chống lại
video này, nó chỉ không phải bằng chứng *về* video này. Tin nó lúc ấy là tuyên bố "video B không
có phụ đề" dựa trên dữ liệu của video A; coi nó là lỗi thì mọi video mở bằng điều hướng SPA đều
mất đường trích thứ hai. Phép phân biệt cuối cùng vì thế nằm ở khối `content` của chính câu trả
lời `get_panel`, không ở ảnh chụp.

## Consequences

- `tools/verify-live.mjs` từ nay đo **ba** đường mạng mỗi lượt và so đường DOM với `get_panel`.
  Hai phát hiện của ticket 012 — `get_transcript` chết, `params` thiếu trường — xuống mục **ghi
  nhận**: vẫn đo, vẫn in, nhưng không còn là tiêu chí đỏ. Để chúng làm cổng là biến cổng thành
  một dòng đỏ vĩnh viễn không ai đọc nữa.
- Ngược lại, `timedtext` **bỗng trả về segment** là một tiêu chí **đỏ** mới: ADR này chọn
  `get_panel` dựa trên việc `timedtext` không trả về gì, nên ngày điều đó đổi là ngày phải đo lại.
- `params` của `get_panel` đối chiếu **byte với byte** với chuỗi trang thật gửi đi
  (`qgkPCgtqTlFYQUM5SVZSdxgB` cho `jNQXAC9IVRw`), khác `transcriptParams()` của `get_transcript`
  vốn viết theo hiểu biết. Đó là khác biệt mà ticket 012 trả giá để học.
- Đường DOM **không bị thay thế**: nó là đường duy nhất chạy được với video private, và
  `M7lc1UVf-VE` cho thấy chiều ngược lại cũng thật — có lớp video mà DOM hỏng còn `get_panel`
  chạy. Hai đường hỏng theo hai cách khác nhau, giữ cả hai vì đúng lý do của ADR 0012.

## Bổ sung 2026-08-22 — `context.client` là một chỗ mà số đo trang thật không canh được

Nghiệm thu vòng một chỉ ra một cặp hoán vị được mà **cả hai cổng đều bỏ lọt**: `hl` ↔ `gl` trong
`context.client`. Hai chuỗi cùng kiểu, lấy từ cùng một đối tượng `ytcfg`, đi vào hai trường nằm
cạnh nhau. Đo thật với phép hoán vị ấy:

```
bash test/run.sh                                XANH — tests 716, 24 file   (không một test nào chết)
node tools/verify-live.mjs --video dQw4w9WgXcQ  XANH — DOM 24 / get_panel 24, chữ trùng 100.0%
```

Cổng Chrome thật không phạt vì mọi phép đo của ADR này chạy trên **video tiếng Anh với giao diện
tiếng Anh**: gửi sai cả hai trường vẫn rơi về đúng một kết quả. Đó là fixture n=1 của ticket 017
dời chỗ — n=1 nằm ở **lựa chọn video**, không ở fixture. Một cổng đo trên trang thật vì thế
không phải cổng mạnh hơn cổng test dữ liệu; nó chỉ mạnh hơn *ở những trục mà phép đo có nhiều
hơn một điểm*.

Vì sao cặp này đáng vá chứ không phải một nốt ruồi: `hl` chọn **ngôn ngữ bản transcript trả về**.
Ở video có nhiều bản phụ đề, hoán vị lấy về bản sai ngôn ngữ mà request vẫn 200, vẫn đủ segment,
mốc vẫn tăng dần, Nguồn vẫn dựng — và tên Nguồn là vĩnh viễn (ADR 0010), còn ADR 0009 đọc chính
tên ấy để biết phần nào đã có. Không có triệu chứng nào ở lần chạy đầu.

Hai thay đổi:

- **Một khối `context.client` duy nhất** (`innertubeClient`) và **một khối header duy nhất**
  (`innertubeHeaders`) trong `src/youtube/transcript.js`, dùng chung cho `get_panel` và
  `get_transcript`. Trước đó là hai bản chép tay giống hệt nhau trong cùng một file — đúng loại
  nợ ticket 014 vừa dọn. Hai giá trị lui thành hằng **đặt tên theo vai trò**
  (`FALLBACK_LANGUAGE` → `hl`, `FALLBACK_COUNTRY` → `gl`), để phép hoán vị đọc lên là thấy sai.
- `page-bridge.js` **vẫn giữ bản riêng** của nó, và đó là chủ ý cũ: file kia chạy ở MAIN world,
  nơi mỗi phụ thuộc thêm vào là một lần nữa phải xin owner duyệt phạm vi. Bản ấy đã được canh —
  năm phép hoán vị cùng hạng (`hl`↔`gl` ở `ytcfgSnapshot`, `hl`↔`gl` ở `innertubeClient`,
  `clientName`↔`clientVersion`, hai header `X-Youtube-Client-*`, và header lấy nhầm bản tên của
  `context`) đều làm `test/bridge.test.js` đỏ.

Ghi lại một điều đo được về **chính cách viết test**: một fixture "đủ trường" không phân biệt
được một bản chép tay lệch ở **giá trị lui**. Với `ytcfg` đủ trường, hai phép hoán vị kiểu
`String(cfg.hl || 'en')` sống sót cả bộ test. Nên bộ fixture của test dùng-chung phải **thiếu
dần các trường** — cái cuối chỉ còn `apiKey`.
