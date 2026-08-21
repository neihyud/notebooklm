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
(function (root) {
  'use strict';

  if (root.NBLM_BRIDGE_PROTOCOL) return;

  const OPS = Object.freeze(['ytcfg', 'listPlaylist']);
  const AUTH_OPS = Object.freeze(['listPlaylist']);

  root.NBLM_BRIDGE_PROTOCOL = Object.freeze({
    REQUEST: 'nblm-bridge-request',
    RESPONSE: 'nblm-bridge-response',
    OPS,
    YTCFG: 'ytcfg',
    LIST_PLAYLIST: 'listPlaylist',
    AUTH_OPS,
    serves: (op) => OPS.includes(op),
    allowsAuth: (op) => AUTH_OPS.includes(op),
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
