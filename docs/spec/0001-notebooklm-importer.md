---
labels: [ready-for-agent]
---

# Spec 0001 — NotebookLM Importer

Từ vựng dùng trong spec này theo `CONTEXT.md`. Mọi quyết định đã chốt nằm ở `docs/adr/0001`–`0011`;
spec không lặp lại lý do, chỉ dẫn chiếu.

## Problem Statement

Người dùng có hai loại tài liệu mà NotebookLM không đọc được, vì cùng một lý do kỹ thuật: khi
nhận một URL, máy chủ Google đi lấy nội dung **không kèm phiên đăng nhập của người dùng và không
chạy JavaScript**.

- Video YouTube **private** của chính họ: với máy chủ ấy chỉ là video không có quyền xem.
- Trang tài liệu dựng bằng JavaScript (Docusaurus, GitBook, docsify, VitePress): máy chủ nhận
  về cái khung rỗng, nên Nguồn tạo ra trống trơn hoặc chỉ có mỗi menu.

Cách duy nhất còn lại là làm thủ công: mở từng trang, bôi đen, sao chép, dán vào NotebookLM.
Với một playlist vài trăm video hoặc một bộ docs vài chục trang thì đó không phải là lựa chọn.

## Solution

Một Chrome extension **Trích cục bộ** nội dung ngay trong trình duyệt người dùng — nơi phiên
đăng nhập đã có sẵn và trang đã render đầy đủ — rồi đẩy vào Notebook đích dưới dạng Nguồn văn
bản, bằng cách thao tác giao diện đúng như người dùng thật.

## User Stories

1. Là người sở hữu video private, tôi muốn import video đó vào notebook, để không phải chuyển
   nó sang public chỉ vì NotebookLM.
2. Là người xem một video public, tôi muốn bấm một nút cạnh nút Like để đưa nó vào notebook.
3. Là người dùng bàn phím, tôi muốn một phím tắt làm việc đó mà không rời tay khỏi bàn phím.
4. Là người có một playlist vài trăm video, tôi muốn import cả playlist mà không phải cuộn hết
   trang để extension "thấy" chúng.
5. Là người có playlist lớn, tôi muốn biết **trước khi chạy** nó sẽ tiêu bao nhiêu Nguồn, để
   không chạm trần 50 nguồn giữa chừng.
6. Là người import cả playlist, tôi muốn cả playlist thành ít Nguồn nhất có thể, để quota
   không cạn.
7. Là người import cả playlist, tôi muốn biết video nào rớt và vì sao, vì Nguồn gộp khiến mất
   một mục trở nên vô hình.
8. Là người có playlist đang lớn dần, tôi muốn import lại chỉ phần mới, chứ không trích lại
   toàn bộ.
9. Là người chọn vài video trên trang playlist, tôi muốn tick checkbox trên từng thumbnail rồi
   import một lượt.
10. Là người đang đọc một bài blog đầy link video, tôi muốn quét mọi link YouTube trên trang đó.
11. Là người mở sẵn nhiều tab YouTube, tôi muốn gom hết chúng vào hàng đợi.
12. Là người có sẵn danh sách link, tôi muốn dán thẳng vào popup.
13. Là người đang xem một video, tôi muốn mở Transcript trong panel bên phải, tìm trong đó
    (gõ không dấu vẫn khớp), và bấm timestamp để video nhảy tới đúng đoạn.
14. Là người cần transcript ra file, tôi muốn tải `.md` / `.srt` / `.vtt`.
15. Là người vừa mất một lần import vì NotebookLM lỗi, tôi muốn transcript đã trích **vẫn còn
    trên đĩa**, chứ không phải trích lại từ đầu.
16. Là người đọc docs, tôi muốn extension tự nhận ra sidebar và cho tôi chọn Nhánh tài liệu
    trong một Bảng chọn dựng đúng cây mục lục.
17. Là người dùng Bảng chọn, tôi muốn tick một mục cha là chọn cả nhánh con, và muốn có ô lọc.
18. Là người import một Nhánh tài liệu, tôi muốn cả nhánh thành một Nguồn, để 120 trang docs
    không ăn hết quota.
19. Là người đọc docs nội bộ cần đăng nhập, tôi muốn extension vẫn đọc được, vì nó fetch bằng
    chính phiên của tôi.
20. Là người import docs, tôi không muốn Nguồn nào dính sidebar, breadcrumb, prev/next hay
    "Edit this page", vì chúng lặp ở mọi trang và NotebookLM sẽ trích dẫn nhầm sang menu.
21. Là lập trình viên đọc docs, tôi muốn khối code trong Nguồn giữ nguyên nhiều dòng và đúng
    ngôn ngữ, chứ không dính thành một dòng khổng lồ.
22. Là người chạy hàng đợi dài, tôi muốn nó lưu bền qua các lần khởi động lại trình duyệt.
23. Là người chạy hàng đợi dài, tôi muốn xem tiến độ, dừng, và thử lại từ popup.
24. Là người import cả video lẫn docs, tôi không muốn 80 trang docs phải xếp hàng sau những
    video mỗi cái 20 giây.
25. Là người đã import một video rồi, tôi không muốn nó vào lại cùng notebook lần nữa.
26. Là người dùng nhiều notebook, tôi muốn import lại cùng video đó vào notebook **khác** mà
    không bị chặn.
27. Là người dọn hàng đợi cho gọn mắt, tôi không muốn mất luôn chống trùng lặp.
28. Là người gặp lúc Google đổi giao diện NotebookLM, tôi muốn sửa nhãn trong Cài đặt thay vì
    phải sửa code.
29. Là người dùng giao diện tiếng Việt, tôi muốn extension khớp được nhãn tiếng Việt lẫn tiếng Anh.
30. Là người quan tâm quyền riêng tư, tôi muốn chắc rằng extension không đọc, không lưu, không
    gửi đi cookie hay token nào, và không có khả năng đổi chế độ hiển thị video của tôi.

## Implementation Decisions

- **Định tuyến theo Mức riêng tư, không thử tuần tự.** PoToken là cơ chế chứng minh nguồn gốc
  chứ không phải xác thực, nên với video private cả hai đường API hỏng vì lý do cấu trúc. Xem
  ADR 0003.
- **`page-bridge` chỉ phục vụ liệt kê playlist**, không phục vụ transcript của video private.
  Đây là ranh giới, không phải chi tiết: mở rộng phạm vi file đó là quyết định của owner
  (`WORKSPACE_PROTOCOL.md`).
- **Hai hàng đợi**, song song ở khâu trích, xếp lượt ở khâu đẩy (ADR 0007). NotebookLM chỉ có
  một hộp thoại thêm nguồn — đó là lý do ràng buộc độc quyền tồn tại.
- **Sổ đã import tách khỏi hàng đợi**, khoá theo cặp (mục, Notebook đích) (ADR 0006).
- **Nguồn gộp đẩy dần**: chốt và đẩy ngay khi chạm ngưỡng, không đợi biết tổng số phần
  (ADR 0008). Kéo theo **tên nguồn không mang mẫu số** (ADR 0010).
- **Ước lượng số Nguồn trước khi chạy dựa trên tổng thời lượng**, không dựa trên số từ — số từ
  chỉ biết sau khi trích.
- **Bản lưu transcript là hành vi mặc định**, ghi ra đĩa trước khi thử đẩy (ADR 0011).
- **Mọi nhãn và selector của NotebookLM tập trung một chỗ**, ghi đè được từ Cài đặt. Nhãn viết
  thường không dấu; mảng ghi đè được *gộp thêm* vào mặc định và đứng trước.
- **Khớp phần tử theo chữ hiển thị đã bỏ dấu**, duyệt theo thứ tự ưu tiên của mảng nhãn để
  `"add source"` luôn thắng `"add"`. Nhãn dưới 4 ký tự không tham gia khớp mờ.
- **Gán giá trị ô nhập qua native value setter** rồi mới phát event, và phát đủ chuỗi
  `pointerdown → mousedown → pointerup → mouseup → click`; Angular Material không phản ứng với
  mỗi `click`, và gán thẳng `.value` không kích hoạt value accessor của Angular.
- **Nhận diện lỗi chỉ đọc phần tử chuyên báo lỗi**, không quét toàn bộ chữ trong hộp thoại —
  NotebookLM hiển thị những dòng bình thường như bộ đếm "Source limit 3/50", quét cả cụm sẽ
  huỷ oan một lần import đang chạy tốt.
- **Dò sidebar bằng chấm điểm hành vi**, không nhắm theme cụ thể. Dấu hiệu mạnh nhất: khối có
  chứa link trỏ về chính trang đang mở.
- **Chỉ tin đường dựng cây theo `<ul>` khi nó gom được ≥80% số link thật trong container**,
  không đủ thì rơi về xếp phẳng; và **mỗi lượt dựng có sổ "đã nhận" riêng**.
- **Trích nội dung docs hai nấc**: fetch từ tab cùng origin trước (rẻ, và mang theo cookie
  phiên nên đọc được docs nội bộ), chỉ mở tab ẩn khi nấc 1 trả về nội dung mỏng bất thường.
  Nấc 2 phải chờ **URL khớp rồi nội dung đứng yên** — với docsify, `#/a → #/b` không tải lại
  trang nên tab báo `complete` trong khi DOM còn nguyên nội dung cũ.
- **Sang Markdown chứ không `textContent`**: Prism-react và Shiki dựng mỗi dòng code thành một
  phần tử riêng không có ký tự `\n` nào.
- **Ba content script có thể gặp nhau trên cùng một tab.** Mỗi listener lọc theo tập loại tin
  nó nhận và **im lặng** với tin không phải của mình — trả lời sai còn tệ hơn không trả lời.
- **Giao diện extension phải tách khỏi giao diện trang**: mọi id do extension tạo mang một tiền
  tố chung, và mọi hàm dò tìm phần tử của trang phải loại trừ giao diện của chính mình trước.

## Testing Decisions

Test tốt ở repo này kiểm **hành vi bên ngoài** của module, không kiểm cách nó làm. Ưu tiên ít
seam; ba seam dưới đây là đủ cho toàn bộ spec.

- **Seam 1 — hàm thuần.** Bóc videoId, khử trùng lặp, bỏ dấu, gộp transcript theo mốc, dựng
  thân nguồn, gói Nguồn gộp theo trần, đặt tên nguồn, khoá Sổ đã import, chuẩn hoá URL tài
  liệu, gộp ghi đè selector, và bộ chuyển `md`/`srt`/`vtt`. Test gọi thẳng, không cần DOM.
- **Seam 2 — engine hàng đợi, tách khỏi API của Chrome.** Engine nhận vào danh sách Mục hàng
  đợi cùng hai adapter (trích, đẩy) và trả về nhật ký chạy. Toàn bộ ADR 0005–0009 kiểm được ở
  đây bằng adapter giả: cắt đúng chỗ, mục hỏng không chặn nguồn, bảng tổng kết liệt kê mục
  rớt, độc quyền ở khâu đẩy trong khi trích chạy song song, Sổ đã import chặn đúng cặp.
- **Seam 3 — module DOM nhận cây node, trả dữ liệu.** Chuyển Markdown, chọn thân bài, dựng cây
  sidebar đều nhận một cây node và trả giá trị thuần, nên test được bằng cây giả; và kiểm lại
  trên trang thật bằng script kiểm chứng.

Cộng ba test soát tính toàn vẹn: manifest (mọi đường dẫn tồn tại, không file JS mồ côi, thứ tự
nạp đúng chuỗi phụ thuộc, các mảng script trong service worker khớp từng dòng với
`content_scripts`), cấu hình (mọi setting có ô nhập, mọi id popup tham chiếu đều tồn tại), và
kỷ luật định tuyến tin nhắn.

Mỗi test toàn vẹn **phải được kiểm ngược bằng cách cố tình phá thứ nó canh** và phải in ra chi
tiết lệch. Một test toàn vẹn chưa từng thấy đỏ là một test chưa biết có tác dụng không.

`WORKSPACE_PROTOCOL.md` liệt kê các **cặp cùng kiểu hoán vị được mà suite vẫn xanh**; ticket
chạm cặp nào phải trả lời được: test nào chết khi hoán vị?

## Out of Scope

- Phát hành lên Chrome Web Store (ADR 0001).
- Đường `yt-dlp` chạy ngoài trình duyệt — tách sang repo riêng (ADR 0004).
- Trình duyệt không phải Chromium.
- Bất kỳ khả năng nào đổi chế độ hiển thị video, gọi API cập nhật video, hay chạm YouTube Studio.
- Sửa hay xoá Nguồn đã đẩy vào NotebookLM — nền tảng không cho.
- Đồng bộ tự động khi video hoặc trang tài liệu đổi nội dung: Nguồn dán tay là ảnh chụp tại
  một thời điểm.

## Further Notes

Cửa sổ phải đủ rộng thì đường DOM mới chạy: panel transcript nằm ở cột phải, layout hẹp thì
YouTube giữ nó ở trạng thái ẩn và không có gì để quét. Đây là điều kiện môi trường, không phải
lỗi — nhưng nó phải được báo cho người dùng chứ không im lặng trả về rỗng.
