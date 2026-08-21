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
  const HANDLED = new Set([MSG.NLM_PING, MSG.NLM_ADD_URL, MSG.NLM_ADD_TEXT, 'nblm-hud']);

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
            if (result.ok) hideHud(`Đã thêm: ${message.label || message.url}`);
            else showHud(`Lỗi: ${result.error}`, { spinning: false });
            sendResponse({ ok: result.ok, error: result.error || null, limit: !!result.limit });
            return;
          }

          case MSG.NLM_ADD_TEXT: {
            showHud(`Đang thêm transcript: ${message.title}`);
            const result = await A.addTextSource(message.title, message.text);
            if (result.ok) hideHud(`Đã thêm: ${message.title}`);
            else showHud(`Lỗi: ${result.error}`, { spinning: false });
            sendResponse({ ok: result.ok, error: result.error || null, limit: !!result.limit });
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
