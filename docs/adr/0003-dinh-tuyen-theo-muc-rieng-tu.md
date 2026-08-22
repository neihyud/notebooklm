---
status: proposed
---

# Với video private, đi thẳng đường DOM thay vì thử tuần tự các đường API

PoToken không phải cơ chế xác thực mà là cơ chế chứng minh nguồn gốc: `timedtext` có `exp=xpe`
trả về body rỗng kèm HTTP 200 cho mọi request lập trình, kể cả request mang cookie hợp lệ của
phiên đã đăng nhập. Mượn header `SAPISIDHASH` trả lời được "bạn là ai" nhưng không chạm tới
câu "bạn có phải player thật không", nên với video private cả hai đường API đều hỏng vì lý do
cấu trúc. Mức riêng tư đã biết trước khi trích, nên định tuyến thẳng sang đường DOM thay vì
thử-rồi-hỏng qua hai nấc.

## Consequences

`page-bridge.js` vẫn cần thiết, nhưng cho việc liệt kê playlist qua InnerTube — không phải cho
việc lấy transcript của video private. Đó là hai mục đích khác nhau và trước đây bị lẫn làm một.

Nếu YouTube nới ràng buộc PoToken, một lần thử thăm dò định kỳ rẻ hơn nhiều so với thử-rồi-hỏng
ở mọi video.
