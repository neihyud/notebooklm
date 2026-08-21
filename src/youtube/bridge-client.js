/*
 * Isolated world. Bọc giao thức postMessage với page-bridge.js thành Promise.
 */
;(function (root) {
  'use strict';

  const REQ = 'NBLM_YT_REQ';
  const RES = 'NBLM_YT_RES';

  function call(op, args, timeout = 45000) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error(`Cầu nối trang hết thời gian chờ (${op})`));
      }, timeout);

      function onMessage(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.__nblm !== RES || msg.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.payload);
      }

      window.addEventListener('message', onMessage);
      window.postMessage({ __nblm: REQ, id, op, args: args || {} }, location.origin);
    });
  }

  root.NBLM_BRIDGE = { call };
})(globalThis);
