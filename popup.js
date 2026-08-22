// Popup: chọn Notebook đích, chạy một lượt import, hoặc chỉ tải Bản lưu về.
//
// Hai hàng đợi là hai hàng riêng chứ không phải một hàng lọc theo loại (ADR 0007); khung đã
// theo đúng hình dạng đó từ ticket 001, và ticket 010 đổ nội dung vào hàng tài liệu.
//
// Popup không tự chạy gì: mọi việc đi qua service worker, vì popup đóng lại là mọi Promise
// đang chờ trong nó chết theo — một lượt import 20 giây sẽ không bao giờ về tới đích.
(function () {
  'use strict';

  const S = globalThis.NBLM_SHARED;
  const M = globalThis.NBLM_MESSAGES;
  if (!S) throw new Error('popup: cần src/common/shared.js nạp trước');
  if (!M) throw new Error('popup: cần src/common/messages.js nạp trước');

  const byId = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`popup: trang thiếu ô "#${id}"`);
    return node;
  };

  const QUEUES = [
    { key: 'video', list: 'nblm-video-list', empty: 'nblm-video-empty', count: 'nblm-video-count' },
    { key: 'docs', list: 'nblm-docs-list', empty: 'nblm-docs-empty', count: 'nblm-docs-count' },
  ];

  /**
   * Service worker của MV3 ngủ dậy khi có tin, nhưng ngay sau khi extension được nạp lại thì
   * `sendMessage` reject bằng "Receiving end does not exist". Để nó thoát ra ngoài là popup vẽ
   * trắng không một dòng lỗi, và nút vừa bấm ở lại trạng thái khoá — biến một lỗi tạm thời
   * thành một popup hỏng hẳn.
   */
  const send = async (message) => {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      return { ok: false, error: error && error.message ? String(error.message) : String(error) };
    }
  };

  function renderQueue(queue, items) {
    byId(queue.count).textContent = `${items.length} mục`;
    const list = byId(queue.list);
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      li.textContent = item.title || item.id;
      return li;
    }));
    list.hidden = items.length === 0;
    byId(queue.empty).hidden = items.length > 0;
  }

  function say(text, state) {
    const status = byId('nblm-status');
    status.textContent = text;
    if (state) status.setAttribute('data-state', state);
    else status.removeAttribute('data-state');
  }

  /**
   * Vẽ lại từ trạng thái của service worker.
   *
   * Nút import chỉ sáng khi **cả hai** điều kiện có đủ: tab hiện tại là một video, và đã có
   * Notebook đích. Bấm được rồi mới báo thiếu là bắt người dùng chạy một lượt để biết mình
   * chưa chọn notebook.
   */
  function render(state) {
    const pending = state.pending || [];
    renderQueue(QUEUES[0], pending.filter((item) => item.kind !== 'docs'));
    renderQueue(QUEUES[1], pending.filter((item) => item.kind === 'docs'));

    byId('nblm-target').textContent = state.notebookId || 'chưa chọn';
    byId('nblm-download-dir').textContent = state.downloadDir || S.DEFAULTS.downloadDir;

    const video = state.currentVideo;
    byId('nblm-current').textContent = video ? (video.title || video.id) : 'tab hiện tại không phải video YouTube';
    byId('nblm-import').disabled = !video || !state.notebookId || state.running;
    byId('nblm-save-only').disabled = (!video && pending.length === 0) || state.running;
    byId('nblm-use-notebook').disabled = !state.currentNotebook || state.currentNotebook === state.notebookId;
    // Bảng chọn không cần Notebook đích để **mở** — người dùng tick trước, chọn notebook sau.
    // Khoá nó theo `notebookId` là bắt họ đoán vì sao một cái nút không bấm được.
    byId('nblm-pick-docs').disabled = state.running;

    if (state.running) say('Đang chạy một lượt import…');
  }

  async function refresh() {
    const answer = await send({ type: M.TYPES.GET_STATE });
    if (answer && answer.ok) render(answer.result);
    else say((answer && answer.error) || 'không đọc được trạng thái', 'error');
  }

  /** Mọi nút đều đi chung đường này: khoá nút, gọi, rồi vẽ lại từ trạng thái thật. */
  function wire(id, message, working) {
    byId(id).addEventListener('click', async () => {
      byId(id).disabled = true;
      say(working);
      const answer = await send(message);
      if (answer && answer.ok) say(answer.result && answer.result.summary ? answer.result.summary : 'Xong.');
      else say((answer && answer.error) || 'không rõ lỗi', 'error');
      refresh();
    });
  }

  wire('nblm-import', { type: M.TYPES.IMPORT_VIDEO }, 'Đang trích và đẩy…');
  wire('nblm-save-only', { type: M.TYPES.SAVE_ONLY }, 'Đang trích và ghi Bản lưu…');
  wire('nblm-use-notebook', { type: M.TYPES.USE_CURRENT_NOTEBOOK }, 'Đang đọc tab hiện tại…');
  wire('nblm-pick-docs', { type: M.TYPES.PICK_DOCS }, 'Đang dò sidebar của tab hiện tại…');

  refresh();
})();
