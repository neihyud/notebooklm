// Đầu bên tab NotebookLM của đường đi ticket 005.
//
// `addTextSource` (ticket 004) thao tác giao diện đúng như người dùng thật, nên nó phải chạy
// **trong** tab NotebookLM đã đăng nhập. Service worker không có DOM; việc của nó là gửi một
// Nguồn vào đây và chờ trả lời.
//
// File này cố ý mỏng: không selector nào (chúng ở `selectors.js`), không logic đẩy nào (nó ở
// `automation.js`). Thứ duy nhất của riêng nó là **kỷ luật định tuyến** — im lặng với tin
// không phải của mình — và một adapter trang. `test/notebooklm.test.js` canh phần thứ nhất.
(function (root) {
  'use strict';

  if (root.NBLM_NB_CONTENT) return;

  const S = root.NBLM_SHARED;
  const M = root.NBLM_MESSAGES;
  const N = root.NBLM_NB_SELECTORS;
  const A = root.NBLM_AUTOMATION;
  if (!S) throw new Error('notebooklm/content: cần src/common/shared.js nạp trước');
  if (!M) throw new Error('notebooklm/content: cần src/common/messages.js nạp trước');
  if (!N) throw new Error('notebooklm/content: cần src/notebooklm/selectors.js nạp trước');
  if (!A) throw new Error('notebooklm/content: cần src/notebooklm/automation.js nạp trước');

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  /** Adapter trang của `addTextSource`: cây node đang hiển thị, và một cách nhường quyền. */
  function createPage(doc, wait) {
    return {
      root: () => doc.body || doc,
      wait,
    };
  }

  /**
   * `undefined` nghĩa là **im lặng**: tin không phải của listener này (spec 0001).
   *
   * Tin đẩy Nguồn mang theo `notebookId` của Notebook đích mà service worker đang nhắm. Tab
   * này có thể đã bị người dùng chuyển sang notebook khác trong lúc hàng đợi chạy — đẩy tiếp
   * là đưa Nguồn vào **sai notebook**, mà Nguồn đã đẩy thì không xoá được (ADR 0010). Nên
   * lệch id là từ chối, không phải cảnh báo.
   */
  function handleMessage(message, deps) {
    if (!M.isFor('notebooklm', message)) return undefined;
    if (M.typeOf(message) === M.TYPES.PING_NOTEBOOKLM) {
      return Promise.resolve({ ok: true, result: { notebookId: deps.currentNotebookId() } });
    }

    return (async () => {
      try {
        // Chọn nhánh trước, soi tải trọng sau — cùng lý do với `src/youtube/watch.js`: một loại
        // tin khai mà quên nhánh, nếu mang theo `source.notebookId`, sẽ chết bằng câu "tab này
        // đang mở notebook khác" thay vì nói ra rằng không ai xử lý nó.
        if (M.typeOf(message) !== M.TYPES.PUSH_SOURCE) throw M.unrouted('notebooklm', message);

        const source = message.source || {};
        const here = deps.currentNotebookId();
        // `here` rỗng cũng là lệch: NotebookLM đá về danh sách notebook khi Notebook đích đã bị
        // xoá, và bỏ qua chốt chặn đúng lúc đó là chạy `addTextSource` trên một trang không phải
        // notebook nào cả.
        if (source.notebookId && source.notebookId !== here) {
          throw new Error(`tab này đang mở "${here || 'không phải một notebook'}", không phải "${source.notebookId}"`);
        }
        return { ok: true, result: await deps.addTextSource(source) };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    })();
  }

  function install(target) {
    const doc = target.document;
    const chrome_ = target.chrome;
    if (!chrome_ || !chrome_.runtime) return;

    const wait = (ms) => new Promise((resolve) => target.setTimeout(resolve, ms));

    async function selectorOptions() {
      const area = chrome_.storage && chrome_.storage.sync;
      const bag = area ? await area.get('settings') : null;
      const settings = (bag && bag.settings) || {};
      // Đọc lại mỗi lượt đẩy: người dùng sửa nhãn ở trang Cài đặt vì giao diện *đang* hỏng,
      // nên bắt họ tải lại tab NotebookLM mới thấy tác dụng là bắt sai người.
      return {
        selectors: N.resolve({
          ...(settings.selectorOverrides || {}),
          labels: settings.labelOverrides || {},
        }),
      };
    }

    const deps = {
      currentNotebookId: () => S.parseNotebookId(target.location.href) || '',
      addTextSource: async (source) => A.addTextSource(source, createPage(doc, wait), await selectorOptions()),
    };

    chrome_.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const answer = handleMessage(message, deps);
      if (!answer) return false; // im lặng với tin không phải của mình
      answer.then(sendResponse);
      return true; // giữ kênh mở cho câu trả lời async
    });
  }

  root.NBLM_NB_CONTENT = Object.freeze({ createPage, handleMessage, install });

  if (root.document && root.chrome && root.chrome.runtime) install(root);
})(typeof globalThis !== 'undefined' ? globalThis : self);
