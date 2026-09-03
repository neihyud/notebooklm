/*
 * Content script trên notebooklm.google.com.
 * Nhận lệnh từ background và chạy thao tác thêm nguồn, kèm một chỉ báo tiến độ
 * nhỏ để người dùng thấy extension đang làm gì (và bấm dừng được).
 */
;(function () {
  'use strict';

  const { MSG } = globalThis.NBLM;
  const A = globalThis.NBLM_AUTOMATION;

  globalThis.NBLM.getSettings().then((s) => A.configure(s.selectorOverrides));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[globalThis.NBLM.KEYS.SETTINGS]) {
      A.configure((changes[globalThis.NBLM.KEYS.SETTINGS].newValue || {}).selectorOverrides);
    }
  });

  /* ------------------------------------------------------------------ */
  /* chỉ báo tiến độ                                                     */
  /* ------------------------------------------------------------------ */

  let hud = null;
  let hideTimer = null;

  function showHud(text, { spinning = true } = {}) {
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'nblm-hud';
      hud.innerHTML =
        '<span class="nblm-hud__spin"></span><span class="nblm-hud__text"></span>' +
        '<button type="button" class="nblm-hud__stop">Dừng</button>';
      hud.querySelector('.nblm-hud__stop').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: MSG.STOP });
        showHud('Đang dừng sau mục hiện tại…', { spinning: false });
      });
      document.documentElement.appendChild(hud);
    }
    hud.querySelector('.nblm-hud__text').textContent = text;
    hud.classList.toggle('nblm-hud--spinning', spinning);
    hud.classList.add('nblm-hud--show');
    clearTimeout(hideTimer);
  }

  function hideHud(finalText) {
    if (!hud) return;
    if (finalText) {
      hud.querySelector('.nblm-hud__text').textContent = finalText;
      hud.classList.remove('nblm-hud--spinning');
    }
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hud && hud.classList.remove('nblm-hud--show'), 5000);
  }

  /* ------------------------------------------------------------------ */
  /* router                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Chỉ những loại tin script này thực sự xử lý — xem ghi chú cùng tên trong
   * `src/docs/content.js`. Trả lời tin của script khác là cướp mất phản hồi của
   * nó (Chrome lấy câu trả lời đến trước), và lỗi hiện ra sẽ trỏ sai chỗ hoàn toàn.
   */
  const HANDLED = new Set([
    MSG.NLM_PING,
    MSG.NLM_ADD_URL,
    MSG.NLM_ADD_TEXT,
    MSG.NLM_LIST_NOTEBOOKS,
    MSG.NLM_CREATE_NOTEBOOK,
    'nblm-hud',
  ]);

  /**
   * Trả nguyên vẹn cả `verified` lẫn `unverified` về background.
   *
   * `verified: false` nghĩa là "đã thêm xong nhưng KHÔNG đọc được danh sách Nguồn
   * nên không đối chiếu được" — nó phải đi hết đường tới popup. Nuốt ở đây là
   * quay lại đúng khuyết tật cũ: báo xong dựa trên một tín hiệu không phải kết quả.
   */
  function reply(result) {
    return {
      ok: result.ok,
      error: result.error || null,
      limit: !!result.limit,
      verified: result.verified === true,
      unverified: result.unverified || null,
      // "Đã ghi vào notebook nhưng không đúng 1 Nguồn" — background cần biết để
      // KHÔNG thử lại bằng đường khác và tạo ra bản trùng.
      sourceAdded: result.sourceAdded === true,
    };
  }

  function hudDone(label, result) {
    return result.verified === true ? `Đã thêm: ${label}` : `Đã thêm (chưa xác minh được): ${label}`;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !HANDLED.has(message.type)) return false; // của script khác — im lặng
    (async () => {
      try {
        switch (message.type) {
          case MSG.NLM_PING:
            sendResponse({ ok: true, inNotebook: A.inNotebook(), url: location.href });
            return;

          case MSG.NLM_ADD_URL: {
            showHud(`Đang thêm: ${message.label || message.url}`);
            const result = await A.addUrlSource(message.url);
            if (result.ok) hideHud(hudDone(message.label || message.url, result));
            else showHud(`Lỗi: ${result.error}`, { spinning: false });
            sendResponse(reply(result));
            return;
          }

          case MSG.NLM_ADD_TEXT: {
            showHud(`Đang thêm transcript: ${message.title}`);
            const result = await A.addTextSource(message.title, message.text);
            if (result.ok) hideHud(hudDone(message.title, result));
            else showHud(`Lỗi: ${result.error}`, { spinning: false });
            sendResponse(reply(result));
            return;
          }

          /*
           * Hai lượt gốc. KHÔNG hiện HUD: chúng chạy do owner đang nhìn vào
           * popup, nên chỗ báo trạng thái là popup. Một HUD nhấp nháy trên tab
           * NotebookLM lúc owner không nhìn tab đó chỉ là nhiễu.
           *
           * `NBLM_RPC` không có thì trả `ok:false` chứ không ném: file rpc.js
           * nạp trước content.js trong `manifest.json`, nhưng lối tiêm bằng
           * `chrome.scripting` cũng chạy qua đây và ta không muốn một lỗi lạ.
           */
          case MSG.NLM_LIST_NOTEBOOKS: {
            const R = globalThis.NBLM_RPC;
            if (!R) { sendResponse({ ok: false, notebooks: [], status: 'no-rpc-module' }); return; }
            sendResponse(await R.listNotebooks());
            return;
          }

          case MSG.NLM_CREATE_NOTEBOOK: {
            const R = globalThis.NBLM_RPC;
            if (!R) { sendResponse({ ok: false, notebookId: null, status: 'no-rpc-module' }); return; }
            sendResponse(await R.createNotebook(message.title));
            return;
          }

          case 'nblm-hud':
            if (message.done) hideHud(message.message);
            else showHud(message.message, { spinning: message.spinning !== false });
            sendResponse({ ok: true });
            return;

          default:
            sendResponse({ ok: false, error: `lệnh lạ: ${message.type}` });
        }
      } catch (e) {
        const error = (e && e.message) || String(e);
        showHud(`Lỗi: ${error}`, { spinning: false });
        try { await A.closeDialog(); } catch (_) {}
        sendResponse({ ok: false, error });
      }
    })();
    return true;
  });
})();
