---
status: done
commits: [f669750]
labels: [ready-for-agent]
blocked_by: [001]
spec: docs/spec/0001-notebooklm-importer.md
---

# 002 — Trích transcript, định tuyến theo Mức riêng tư

## Delivers
Cho một videoId, lấy được transcript. Video private đi thẳng đường DOM; unlisted/public thử
InnerTube rồi `timedtext` rồi mới DOM (ADR 0003).

## Scope
- Ba đường trích và bộ định tuyến chọn đường theo Mức riêng tư — **không thử tuần tự khi đã
  biết là private**.
- Cầu MAIN world đọc `ytcfg` và mượn header `Authorization: SAPISIDHASH` **chỉ để liệt kê
  playlist**; ranh giới này là ràng buộc của `WORKSPACE_PROTOCOL.md`.
- Bọc postMessage thành Promise.
- Đường DOM: một lần thử lại với tab được kích hoạt, và báo lỗi rõ khi cửa sổ quá hẹp
  (panel bị giữ ẩn, không có gì để quét).

## Acceptance
- Bộ định tuyến có test: private không bao giờ gọi hai adapter API.
- Hàm dò nút trên trang phải loại trừ giao diện của chính extension trước khi quét — nút
  "Transcript" do extension thêm vào đứng ngay đầu hàng nút, quét mọi `<button>` khớp
  `/transcript/i` là bấm vào chính mình.
- Nhắm phần tử bấm được trong cùng, không nhắm wrapper: `querySelectorAll` trả theo thứ tự DOM
  nên wrapper luôn đứng trước `<button>` thật.
- Nhãn trợ năng lẫn trong dòng segment không được nuốt vào transcript.

## Nghiệm thu (Lead, 2026-08-22)

- Lead tự chạy `bash test/run.sh`: 153/153 xanh (+65).
- Ranh giới cứng của `WORKSPACE_PROTOCOL.md` được dịch thành code: `AUTH_OPS = ['listPlaylist']`.
  Lead hoán vị `allowsAuth` sang dùng `OPS` → hai test chết đúng chỗ.
- Hoán vị ngoài danh sách 22 của peer: `PRIVATE_ROUTE` ↔ `API_ROUTE` trong `routeFor()` → 4 test chết.
- Peer bắt 4 lỗi thật qua review, đáng kể nhất: `NodeList` không có `.filter` (cả đường DOM sẽ
  ném `TypeError` ngay lần chạy đầu trên trang thật — suite không thấy vì cây giả trả về Array;
  peer sửa cả cây giả), và hook `fetch` chuyền `this` nguyên xi gây `Illegal invocation` cho
  chính request của YouTube.
