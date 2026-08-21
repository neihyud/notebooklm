// Bọc postMessage thành Promise — phía content script của cầu MAIN world.
//
// `window.postMessage` là một kênh không có khái niệm "trả lời": mọi tin đều tới mọi listener
// trên cùng cửa sổ. Ba thứ ở đây làm nên phần "Promise":
//
//   1. **Tương ứng theo id.** Hai lượt hỏi cùng lúc trả lời về ngược thứ tự là chuyện thường;
//      ghép "trả lời đầu tiên tới" với "lượt hỏi đang chờ" là sai mà không có triệu chứng —
//      cả hai lượt vẫn nhận được một kết quả *hợp lệ*, chỉ là của nhau.
//   2. **Im lặng với tin không phải của mình.** Ba content script gặp nhau trên một tab; trả
//      lời sai còn tệ hơn không trả lời (spec 0001).
//   3. **Hẹn giờ.** Cầu không trả lời thì hàng đợi phải thấy một lỗi có lời, không phải một
//      Promise treo giữ chỗ mãi mãi.
(function (root) {
  'use strict';

  if (root.NBLM_BRIDGE_CLIENT) return;

  const P = root.NBLM_BRIDGE_PROTOCOL;
  if (!P) throw new Error('bridge-client: cần src/youtube/bridge-protocol.js nạp trước');

  const DEFAULT_TIMEOUT_MS = 8000;

  function createBridgeClient(options) {
    const opts = options || {};
    const win = opts.window || root;
    if (!win || typeof win.postMessage !== 'function') throw new Error('bridge-client: thiếu cửa sổ để nói chuyện');

    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const setTimer = opts.setTimeout || root.setTimeout.bind(root);
    const clearTimer = opts.clearTimeout || root.clearTimeout.bind(root);
    const origin = opts.origin || (win.location && win.location.origin) || '*';

    let counter = 0;
    const newId = opts.newId || (() => `nblm-${Date.now().toString(36)}-${(counter += 1)}`);

    /** id → chỗ nhận trả lời. Là `Map` chứ không phải một biến: hai lượt hỏi có thể chồng nhau. */
    const pending = new Map();

    function onMessage(event) {
      if (event.source !== win) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.tag !== P.RESPONSE) return;

      const entry = pending.get(data.id);
      if (!entry) return; // id lạ, hoặc lượt hỏi đã hết hạn — im lặng
      pending.delete(data.id);
      entry.settle(data);
    }

    win.addEventListener('message', onMessage);

    function request(op, params) {
      return new Promise((resolve, reject) => {
        const id = newId();
        const timer = setTimer(() => {
          pending.delete(id);
          reject(new Error(`cầu MAIN world không trả lời "${op}" trong ${timeoutMs}ms`));
        }, timeoutMs);

        pending.set(id, {
          settle(data) {
            clearTimer(timer);
            if (data.ok) resolve(data.result);
            else reject(new Error(data.error || `cầu MAIN world báo lỗi ở "${op}"`));
          },
        });

        win.postMessage({ tag: P.REQUEST, id, op, params: params || null }, origin);
      });
    }

    function dispose() {
      win.removeEventListener('message', onMessage);
      pending.clear();
    }

    return { request, dispose };
  }

  root.NBLM_BRIDGE_CLIENT = Object.freeze({ DEFAULT_TIMEOUT_MS, createBridgeClient });
})(typeof globalThis !== 'undefined' ? globalThis : self);
