# Hình dạng batchexecute đo được từ một extension đang chạy thật

- nguồn: extension `gcglcbfmophnppdlbhckfmfiofaajibm` ("Youtube Summary with AI", publisher
  ytuong.ai), bản **1.5.4**, tải từ Chrome Web Store và giải nén ngày 2026-08-24.
- đây là **đặc tả giao thức đọc ra được**, không phải code chép về. Giao thức là của Google;
  cách viết dưới đây là của repo này.
- vì sao đáng tin hơn `notebooklm-py`: đây là sản phẩm đang bán, đang chạy được trên máy người
  dùng thật. Nhưng nó vẫn là quan sát một thời điểm — vẫn phải phát hiện lúc chạy, không ghim.

## Xác nhận đúng những gì `rpc.js` đang đoán

| Thứ | Giá trị | `rpc.js` đoán |
|---|---|---|
| rpc id thêm nguồn | `izAoDd` | ✅ đúng |
| đường | `/_/LabsTailwindUi/data/batchexecute` | ✅ đúng |
| vỏ `f.req` | `[[[id, JSON.stringify(args), null, index]]]`, `index = "generic"` | ✅ đúng |
| `source-path` | `/notebook/{id}`, hoặc `/` khi không có notebook | ✅ đúng |
| khoá token `at` trong `WIZ_global_data` | `SNlM0e` | ✅ đúng hình dạng |

`rpc.js` cố ý **không ghim tên khoá `SNlM0e`** mà neo theo hình dạng chuỗi. Quyết định đó vẫn đúng —
giờ chỉ là có thêm một mẫu để đối chiếu.

## Đối chiếu với `src/notebooklm/rpc.js` sau bản sửa của ticket 001

Peer đã tự tìm ra cùng kết luận từ một oracle khác và viết lại `buildParams`. Ba điểm khớp:
`notebookId` phải nằm **trong** params (không chỉ ở query `source-path`); URL đơn không ở ô 2;
mã loại chỉ tồn tại với văn bản dán. Còn **hai chỗ lệch** với bản 1.5.4 đang bán:

**1. Số phần tử của `args`, và độ bọc của đặc tả nguồn.**

| | extension 1.5.4 | `rpc.js` hiện tại |
|---|---|---|
| `args` | **4** phần tử | **3** phần tử |
| đặc tả nguồn | `[spec]` — bọc **đơn** | `[[spec]]` — bọc **đôi** |
| phần tử #3 | `[2]` | gộp vào `templateBlock` |
| phần tử #4 | `[1,null×9,[1]]` | gộp vào `templateBlock` |

`rpc.js` dựng `[ [[spec]], notebookId, [2,null,null,[1,null×9,[1]]] ]`; extension gửi
`[ [spec], notebookId, [2], [1,null×9,[1]] ]`. Cùng các thành phần, khác cách nhóm.

Đáng lưu ý: nghi thức hoán vị của peer chấm "bọc đôi → bọc đơn = 12 đỏ". Nếu bọc đơn mới đúng thì
**12 assertion đó đang ghim một hình dạng sai** — đúng cái bẫy "test ghim hằng số chép tay".
Chỉ probe trên tab thật mới phân xử được; cả hai đều là oracle bên thứ ba.

**2. Thứ tự `addSourceIds`.**

`rpc.js` để `['ozz5Z', 'izAoDd']`, với lý do đã ghi rõ: id nhiều khả năng đúng phải đứng trước, vì
id lạ cho `rpc-id-stale` → `not-sent` → thử tiếp (an toàn), còn id có thật mà bị từ chối có thể cho
frame rỗng → `unknown` → dừng hẳn.

Lập luận đúng, nhưng dữ kiện có thể ngược: bản **1.5.4, build tháng 4/2026** — mới hơn tài liệu
cộng đồng — vẫn dùng `izAoDd`. Chưa có bằng chứng nào cho `ozz5Z` trong một sản phẩm đang chạy.
Rủi ro thấp (id sai chỉ tốn một request thừa), nhưng thứ tự nên theo bằng chứng mạnh nhất.

**3. Tham số URL.** Ngoài `rpcids`, `source-path`, `_reqid`, `rt`, extension còn gửi `bl`
(build label, từ `WIZ_global_data.cfb2h`), `f.sid` (từ `FdrFJe`) và `hl`. `rpc.js` không gửi.
Chưa rõ cái nào bắt buộc — cần đo.

## Chỗ `rpc.js` làm TỐT HƠN — đừng đánh đổi khi sửa

- **Phát hiện rpc id lỗi thời.** Họ tách phản hồi theo dòng, lấy mảng JSON parse được đầu tiên,
  rồi đọc `[0][2]` — **không kiểm rpc id**. Google xoay id thì họ không biết. `readEnvelope()`
  của mình chỉ nhận frame `wrb.fr` mang đúng id đã gửi.
- **`credentials`.** Họ dùng `include` vì gọi từ service worker (khác origin). `rpc.js` gọi từ
  content script cùng origin nên `same-origin` vừa đủ và hẹp hơn — giữ nguyên.
- **Hằng số chép tay.** Họ hardcode `bl: "boq_labs-tailwind-frontend_20250902.08_p1"` làm mặc
  định — một build label từ 2025-09-02, sẽ lỗi thời. Nếu ta cần `bl` thì đọc từ trang, đừng chép.

## Chỗ KHÔNG được chép

`inject.js` của họ ghi token `SNlM0e` **và địa chỉ email người dùng** (`oPEP7c`) vào
`window.localStorage` của trang NotebookLM. Mọi script chạy trên trang đó đọc được — kể cả script
của Google lẫn của extension khác. Đây là đúng thứ `README.md` mục *Cam kết* nói extension này
không làm.

## Phía YouTube họ yếu hơn hẳn

`yt-inject.js` chỉ hút `ytcfg` (InnerTube key, client version, `VISITOR_DATA`). **Không** mượn
`Authorization: SAPISIDHASH`, **không** đụng PoToken — nên không lấy được transcript video
private. `src/youtube/page-bridge.js` của repo này làm cả hai.

## Một khác biệt kiến trúc đáng cân nhắc riêng

Họ gọi RPC từ **service worker**, content script chỉ làm nhiệm vụ hút token rồi chuyển đi. Đổi lại
họ cần `host_permissions` và `credentials: include`. Cái được: thêm Nguồn **không cần mở tab
NotebookLM**. `rpc.js` hiện phải có tab đang mở vì nó chạy trong content script.

Đó là ticket riêng nếu muốn, không phải việc của 001.
