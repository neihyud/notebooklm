/*
 * Offscreen document — chỉ làm đúng một việc: dựng blob URL hộ service worker.
 *
 * Vì sao cần cả một tài liệu ẩn cho việc này: service worker MV3 không có
 * `URL.createObjectURL` (bị bỏ đi vì dễ rò bộ nhớ). Đường thay thế hiển nhiên là
 * `data:` URL, nhưng Chromium **bỏ qua `saveAs: false` với data URL** — mỗi file
 * tải về lại bật hộp thoại "Save as". Tải 89 file thành 89 lần bấm.
 *
 * Blob URL không dính lỗi đó, và offscreen document là ngữ cảnh duy nhất được
 * phép tạo nó.
 */
;(function () {
  'use strict';

  const HANDLED = new Set(['offscreen-blob-url']);

  // Tự thu hồi sau một khoảng: giữ mãi thì rò bộ nhớ, mà thu hồi ngay sau khi
  // gọi downloads.download() thì hỏng — lúc đó Chrome mới bắt đầu đọc blob.
  const TTL_MS = 120000;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !HANDLED.has(message.type)) return false;

    try {
      const blob = new Blob([message.text], { type: message.mime || 'text/plain' });
      const url = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(url), TTL_MS);
      sendResponse({ ok: true, url });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
    return true;
  });
})();
