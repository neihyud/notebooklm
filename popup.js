// Popup vỏ (ticket 001): dựng khung hai hàng đợi và hiện trạng thái rỗng.
//
// Hai hàng đợi là hai hàng riêng chứ không phải một hàng lọc theo loại (ADR 0007) — khung ở
// đây đã theo đúng hình dạng đó để ticket 003 nối engine vào mà không phải dựng lại.
(function () {
  'use strict';

  const { DEFAULTS } = globalThis.NBLM_SHARED;

  /** Hàng đợi thật do service worker giữ (ticket 003); ở ticket này luôn rỗng. */
  const QUEUES = [
    { list: 'nblm-video-list', empty: 'nblm-video-empty', count: 'nblm-video-count', items: [] },
    { list: 'nblm-docs-list', empty: 'nblm-docs-empty', count: 'nblm-docs-count', items: [] },
  ];

  function renderQueue(queue) {
    const list = document.getElementById(queue.list);
    const empty = document.getElementById(queue.empty);
    const count = document.getElementById(queue.count);

    count.textContent = `${queue.items.length} mục`;
    list.replaceChildren(
      ...queue.items.map((item) => {
        const li = document.createElement('li');
        li.textContent = item.title || item.id;
        return li;
      }),
    );
    list.hidden = queue.items.length === 0;
    empty.hidden = queue.items.length > 0;
  }

  function render() {
    document.getElementById('nblm-download-dir').textContent = DEFAULTS.downloadDir;
    QUEUES.forEach(renderQueue);
  }

  render();
})();
