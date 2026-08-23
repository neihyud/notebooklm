/* Popup: xem/điều khiển hàng đợi, chọn notebook đích, dán link hàng loạt. */
(() => {
  'use strict';

  const { MSG, STATUS, PRIVACY, KIND, canonicalUrl, videoIdFrom, parseUrlList, fmtTime, urlLabel } =
    globalThis.NBLM;

  const $ = (id) => document.getElementById(id);
  const els = {
    notebookUrl: $('notebook-url'),
    notebookHint: $('notebook-hint'),
    useCurrent: $('use-current'),
    bulk: $('bulk'),
    addBulk: $('add-bulk'),
    addCurrent: $('add-current'),
    scanDocs: $('scan-docs'),
    importPlaylist: $('import-playlist'),
    collectTabs: $('collect-tabs'),
    collectLinks: $('collect-links'),
    collectHint: $('collect-hint'),
    list: $('list'),
    empty: $('empty'),
    counts: $('counts'),
    run: $('run'),
    stop: $('stop'),
    retry: $('retry'),
    clearDone: $('clear-done'),
    clearAll: $('clear-all'),
    openOptions: $('open-options'),
  };

  const send = (type, payload) => chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */

  const STATUS_TEXT = {
    [STATUS.PENDING]: 'Chờ',
    [STATUS.EXTRACTING]: 'Đang trích nội dung…',
    [STATUS.IMPORTING]: 'Đang thêm vào NotebookLM…',
    [STATUS.DONE]: 'Xong',
    [STATUS.ERROR]: 'Lỗi',
    [STATUS.SKIPPED]: 'Bỏ qua',
  };

  const isDoc = (item) => item.kind === KIND.DOCS;

  /** Thẻ nhãn bên trái dòng. Chỉ dựng từ hằng số nội bộ — không có dữ liệu trang. */
  function tagHtml(item) {
    if (isDoc(item)) return '<span class="tag tag--docs">tài liệu</span>';
    if (item.privacy === PRIVACY.PRIVATE) return '<span class="tag tag--private">private</span>';
    if (item.privacy === PRIVACY.UNLISTED) return '<span class="tag tag--unlisted">unlisted</span>';
    if (item.privacy === PRIVACY.PUBLIC) return '<span class="tag">public</span>';
    return '';
  }

  function modeText(item) {
    if (item.mode === 'text') return isDoc(item) ? 'nguồn: nội dung trang' : 'nguồn: transcript dán tay';
    if (item.mode === 'url') return isDoc(item) ? 'nguồn: link trang' : 'nguồn: link YouTube';
    return '';
  }

  /**
   * Chỉ `done` mới có chuyện xác minh: mục lỗi thì đã biết là hỏng rồi.
   * `undefined` (mục `done` từ trước bản vá, còn nằm trong hàng đợi cũ của owner)
   * KHÔNG phải `false` — không có dữ liệu thì im, đừng dựng báo động ngược dòng.
   */
  const isUnverified = (item) => item.status === STATUS.DONE && item.verified === false;

  function itemTitle(item) {
    if (item.title) return item.title;
    return isDoc(item) ? urlLabel(item.url) : item.videoId;
  }

  function render(state) {
    const { queue, settings, running } = state;

    if (document.activeElement !== els.notebookUrl) {
      els.notebookUrl.value = settings.notebookUrl || '';
    }
    els.notebookHint.textContent = settings.notebookUrl
      ? ''
      : 'Chưa đặt notebook đích — extension sẽ dùng tab NotebookLM nào đang mở sẵn.';

    const counts = queue.reduce((acc, i) => {
      acc[i.status] = (acc[i.status] || 0) + 1;
      return acc;
    }, {});
    const pending = (counts[STATUS.PENDING] || 0) + (counts[STATUS.EXTRACTING] || 0) + (counts[STATUS.IMPORTING] || 0);
    els.counts.textContent = queue.length
      ? `— ${pending} chờ · ${counts[STATUS.DONE] || 0} xong · ${counts[STATUS.ERROR] || 0} lỗi`
      : '';

    els.run.hidden = running;
    els.stop.hidden = !running;
    els.run.disabled = !pending;
    els.retry.disabled = !(counts[STATUS.ERROR] || 0);
    els.clearDone.disabled = !(counts[STATUS.DONE] || 0);
    els.clearAll.disabled = !queue.length;
    els.empty.hidden = queue.length > 0;

    els.list.replaceChildren(
      ...queue
        .slice()
        .reverse()
        .map((item) => {
          const li = document.createElement('li');
          li.className = 'item';
          li.dataset.status = item.status;
          if (item.status === STATUS.DONE && typeof item.verified === 'boolean') {
            li.dataset.verified = String(item.verified);
          }

          const dot = document.createElement('span');
          dot.className = 'item__dot';

          const body = document.createElement('div');
          body.className = 'item__body';

          const link = document.createElement('a');
          link.className = 'item__title';
          link.href = item.url || canonicalUrl(item.videoId);
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = itemTitle(item);
          body.appendChild(link);

          const meta = document.createElement('div');
          meta.className = 'item__meta';
          meta.innerHTML = tagHtml(item);
          // Chữ này cố ý nằm ngay cạnh "Xong" chứ không phải một biểu tượng nhỏ:
          // "đã vào" và "chưa biết có vào không" là hai kết quả khác nhau, và
          // toàn bộ ticket này tồn tại vì trước đó chúng trông giống hệt nhau.
          const parts = [
            isUnverified(item) ? `${STATUS_TEXT[STATUS.DONE]} — chưa xác minh được` : STATUS_TEXT[item.status] || item.status,
          ];
          if (item.site) parts.push(item.site);
          if (item.durationSec) parts.push(fmtTime(item.durationSec));
          const mode = modeText(item);
          if (mode) parts.push(mode);
          if (item.textLength) parts.push(`${Math.round(item.textLength / 1000)}k ký tự`);
          meta.append(parts.join(' · '));
          body.appendChild(meta);

          if (item.error) {
            const err = document.createElement('div');
            err.className = 'item__error';
            err.textContent = item.error;
            body.appendChild(err);
          }

          if (isUnverified(item)) {
            const warn = document.createElement('div');
            warn.className = 'item__unverified';
            warn.textContent =
              item.unverified || 'Không đối chiếu được kết quả nên chưa xác minh được nguồn đã vào hay chưa.';
            body.appendChild(warn);
          }

          // Bản sao xuống đĩa hỏng là một chuyện KHÁC với Nguồn chưa xác minh
          // được, nên nó có dòng riêng: Nguồn vẫn có thể đã vào hoàn hảo trong
          // khi ~/Downloads không có gì. Gộp chung một dòng là người đọc mất khả
          // năng biết cái nào hỏng.
          if (item.copyError) {
            const warn = document.createElement('div');
            warn.className = 'item__copy-error';
            warn.textContent = `Bản sao xuống đĩa: ${item.copyError}`;
            body.appendChild(warn);
          }

          const remove = document.createElement('button');
          remove.className = 'item__remove';
          remove.type = 'button';
          remove.title = 'Xoá khỏi hàng đợi';
          remove.textContent = '×';
          remove.addEventListener('click', async () => {
            await send(MSG.REMOVE, { id: item.id });
            refresh();
          });

          li.append(dot, body, remove);
          return li;
        })
    );
  }

  async function refresh() {
    const state = await send(MSG.GET_STATE);
    if (state && state.queue) render(state);
  }

  /* ---------------------------------------------------------------- */
  /* sự kiện                                                           */
  /* ---------------------------------------------------------------- */

  els.notebookUrl.addEventListener('change', async () => {
    await globalThis.NBLM.setSettings({ notebookUrl: els.notebookUrl.value.trim() });
    refresh();
  });

  els.useCurrent.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = (tab && tab.url) || '';
    if (!/^https:\/\/notebooklm\.google\.com\/notebook\//.test(url)) {
      els.notebookHint.textContent = 'Tab hiện tại không phải một notebook. Hãy mở notebook đích rồi bấm lại.';
      return;
    }
    const clean = url.split('?')[0].split('#')[0];
    els.notebookUrl.value = clean;
    await globalThis.NBLM.setSettings({ notebookUrl: clean });
    refresh();
  });

  els.addBulk.addEventListener('click', async () => {
    const ids = parseUrlList(els.bulk.value);
    if (!ids.length) {
      els.bulk.focus();
      return;
    }
    await send(MSG.ENQUEUE, { items: ids.map((videoId) => ({ videoId })), autoRun: false });
    els.bulk.value = '';
    refresh();
  });

  // "Thêm tab hiện tại" phục vụ cả hai loại nguồn: là video thì đi đường video,
  // còn lại coi như một trang tài liệu.
  els.addCurrent.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = (tab && tab.url) || '';
    const videoId = videoIdFrom(url);

    if (!videoId && !/^https?:/.test(url)) {
      els.notebookHint.textContent = 'Tab hiện tại không phải trang web đọc được.';
      return;
    }
    const item = videoId
      ? { videoId }
      : { kind: KIND.DOCS, url, title: (tab && tab.title) || '', site: hostOf(url) };

    await send(MSG.ENQUEUE, { items: [item], autoRun: false });
    refresh();
  });

  els.scanDocs.addEventListener('click', async () => {
    const res = await send(MSG.OPEN_DOCS_PANEL);
    if (res && res.error) {
      els.notebookHint.textContent = res.error;
      return;
    }
    window.close(); // bảng chọn nằm trong trang, popup che mất thì vô nghĩa
  });

  /* ---------------------------------------------------------------- */
  /* thu gom hàng loạt                                                 */
  /* ---------------------------------------------------------------- */

  /** Quét playlist có thể mất vài chục giây — khoá nút và báo kết quả tại chỗ. */
  async function collect(button, type, busyLabel) {
    const original = button.textContent;
    const buttons = [els.importPlaylist, els.collectTabs, els.collectLinks];
    buttons.forEach((b) => (b.disabled = true));
    button.textContent = busyLabel;
    els.collectHint.classList.remove('error');
    els.collectHint.textContent = 'Đang quét…';

    try {
      const res = (await send(type)) || {};
      if (res.error) {
        els.collectHint.textContent = res.error;
        els.collectHint.classList.add('error');
        return;
      }
      const bits = [`Đã thêm ${res.added || 0} video`];
      if (res.skipped) bits.push(`${res.skipped} đã có sẵn`);
      if (res.blocked) bits.push(`${res.blocked} không có quyền xem`);
      if (res.truncated) bits.push('đã chạm trần quét');
      els.collectHint.textContent = bits.join(' · ') + '.';
      refresh();
    } finally {
      button.textContent = original;
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  els.importPlaylist.addEventListener('click', () =>
    collect(els.importPlaylist, MSG.IMPORT_PLAYLIST, 'Đang quét danh sách…')
  );
  els.collectTabs.addEventListener('click', () =>
    collect(els.collectTabs, MSG.COLLECT_TABS, 'Đang gom tab…')
  );
  els.collectLinks.addEventListener('click', () =>
    collect(els.collectLinks, MSG.COLLECT_PAGE_LINKS, 'Đang quét link…')
  );

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  els.run.addEventListener('click', () => send(MSG.RUN).then(refresh));
  els.stop.addEventListener('click', () => send(MSG.STOP).then(refresh));
  els.retry.addEventListener('click', () => send(MSG.RETRY, {}).then(refresh));
  els.clearDone.addEventListener('click', () => send(MSG.CLEAR_DONE).then(refresh));
  els.clearAll.addEventListener('click', () => send(MSG.CLEAR_ALL).then(refresh));
  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === MSG.STATE_CHANGED) refresh();
  });

  // Trạng thái đổi trong lúc popup mở (ví dụ đang chạy hàng đợi).
  setInterval(refresh, 1500);
  refresh();
})();
