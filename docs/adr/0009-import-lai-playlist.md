---
status: proposed
---

# Import lại playlist thì sinh nguồn bổ sung, không dựng lại từ đầu

NotebookLM không cho sửa một Nguồn đã tạo, và Sổ đã import khoá theo cặp (video, notebook)
nên khi playlist có thêm video, những video cũ được nhận ra là trùng còn video mới thì không.
Chọn tạo một nguồn gộp mới chỉ chứa phần mới. Phương án dựng lại từ đầu bắt trích lại toàn bộ
— với 300 video private là vài tiếng — để lấy về 12 video.

## Consequences

Notebook sẽ có "Playlist X — phần 1", "— phần 2"… cộng thêm "Playlist X — bổ sung 1". Xấu về
mặt tên gọi, và cách duy nhất làm nó chịu được là đặt tên nguồn cho rõ ràng ngay từ đầu —
quy tắc ở ADR 0010.
