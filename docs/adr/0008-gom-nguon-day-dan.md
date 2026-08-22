---
status: proposed
---

# Nguồn gộp đẩy dần, mục hỏng không chặn nguồn

Cắt theo dung lượng (ADR 0005) đòi biết số từ, mà số từ chỉ biết sau khi trích — với video
private mỗi mục tốn 15–20 giây (ADR 0003), nên trích hết rồi mới gộp nghĩa là hỏng ở video
290 thì mất trắng vài tiếng. Vì vậy gom tới khi chạm ngưỡng thì **chốt nguồn đó và đẩy ngay**,
rồi mở nguồn kế.

Khi một mục hỏng, nó **không chặn** nguồn đang gom: nguồn vẫn gom tiếp và vẫn chốt theo ngưỡng
như thường, mục hỏng quay lại hàng đợi. Điều bị cấm là *đợi* mục hỏng — không phải *gom tiếp*.
Đọc thành "hỏng thì chốt nguồn ngay" là sai: một playlist 10 video mất phụ đề sẽ sinh 10 Nguồn,
ngược hẳn mục đích gộp.

## Considered Options

Cắt theo số video cố định để khỏi cần biết số từ: bị loại vì một playlist toàn video ba tiếng
sẽ vượt trần 500.000 từ ngay ở nguồn đầu.

Giữ nguồn mở và thử lại mục hỏng tới cùng: bị loại. Mục hỏng thường hỏng vì lý do dai dẳng —
không có phụ đề, mất quyền xem — nên chặn cả nguồn để đợi nó là đổi một thứ chắc chắn mất lấy
một thứ có lẽ không bao giờ tới.

## Ước lượng trước khi chạy

ADR 0005 đòi bảng xác nhận nói trước sẽ tốn bao nhiêu nguồn, nhưng số từ chỉ biết sau khi
trích. Ước lượng vì vậy dựa trên **tổng thời lượng video** — InnerTube đã trả về sẵn khi liệt
kê playlist — quy đổi theo tốc độ nói trung bình. Đây là ước lượng, phải trình bày như ước
lượng; con số thật chỉ chốt được lúc chạy xong.

## Consequences

Gộp nguồn khiến việc mất một mục trở nên vô hình: 54 video trong một nguồn trông y hệt 55.
Bảng tổng kết cuối lần chạy **phải** liệt kê mục nào rớt và vì sao — không có nó, quyết định
này âm thầm nuốt dữ liệu.
