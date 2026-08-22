// Giao ước giữa content script và cầu MAIN world — và, quan trọng hơn, **phạm vi** của cầu.
//
// File này cố ý không phụ thuộc gì cả: `page-bridge.js` chạy ở MAIN world, nơi không có gì của
// extension được nạp sẵn, nên hai bên chỉ chia nhau đúng những hằng số dưới đây.
//
// `AUTH_OPS` là ranh giới của `WORKSPACE_PROTOCOL.md` viết thành code: header
// `Authorization: SAPISIDHASH` mượn của YouTube chỉ đi kèm việc **liệt kê playlist**. Với video
// private, hai đường API hỏng vì lý do cấu trúc chứ không vì thiếu xác thực (ADR 0003), nên
// thêm một op vào đây không giúp lấy được transcript — nó chỉ mở rộng phạm vi của file
// nhạy cảm nhất repo, và đó là quyết định của owner.
//
// `playerResponse` (ticket 013) là op thứ ba, và nó nằm ngoài `AUTH_OPS` **theo định nghĩa của
// việc nó làm**: `ytInitialPlayerResponse` là một biến toàn cục mà một tab ẩn danh chưa đăng nhập
// cũng đọc được nguyên vẹn. Nó không hỏi máy chủ điều gì, nên không có gì để ký tên vào.
(function (root) {
  'use strict';

  if (root.NBLM_BRIDGE_PROTOCOL) return;

  const OPS = Object.freeze(['ytcfg', 'playerResponse', 'listPlaylist']);
  const AUTH_OPS = Object.freeze(['listPlaylist']);

  root.NBLM_BRIDGE_PROTOCOL = Object.freeze({
    REQUEST: 'nblm-bridge-request',
    RESPONSE: 'nblm-bridge-response',
    OPS,
    YTCFG: 'ytcfg',
    PLAYER_RESPONSE: 'playerResponse',
    LIST_PLAYLIST: 'listPlaylist',
    AUTH_OPS,
    serves: (op) => OPS.includes(op),
    allowsAuth: (op) => AUTH_OPS.includes(op),
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
