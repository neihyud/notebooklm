---
status: proposed
---

# Chỉ phân phối bằng Load unpacked, không lên Chrome Web Store

Extension cần hook `fetch`/`XHR` ở MAIN world để mượn header `Authorization: SAPISIDHASH` mà
YouTube tự gửi cho InnerTube, và cần tự động hoá giao diện NotebookLM — một sản phẩm Google
không có API công khai. Cả hai gần như chắc chắn không qua được review của Chrome Web Store,
bất kể không có dữ liệu nào rời khỏi máy. Chọn từ bỏ kênh phân phối đó để giữ lại hai cơ chế,
thay vì cắt cơ chế để đổi lấy kênh phân phối.

## Consequences

Đây là tiền đề của mọi quyết định phía sau: không có ràng buộc "phải qua review", ta được
phép dùng những đường mà một extension công khai không dùng được. Đổi lại, người dùng phải tự
bật Developer mode, và mọi cập nhật đều là thủ công.

Nếu sau này muốn lên Web Store, quyết định này không đảo ngược được rẻ — nó kéo theo việc bỏ
`page-bridge.js` và tìm đường khác cho toàn bộ luồng NotebookLM.
