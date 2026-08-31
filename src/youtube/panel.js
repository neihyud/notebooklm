/*
 * Panel transcript trên trang watch.
 *
 * Dùng lại đúng cascade trích transcript của NBLM_TRANSCRIPT, nên video private
 * của bạn cũng xem/tải được y như video public — cùng một cơ chế xác thực.
 *
 * DOM YouTube đã biết trước nên chỉ cần tiền tố `nblm-` là đủ tách biệt, không
 * cần shadow DOM như panel cho trang tài liệu lạ.
 */
;(function (root) {
  'use strict';

  const { fmtTime, norm } = root.NBLM;
  const T = root.NBLM_TRANSCRIPT;
  const F = root.NBLM_SRT;

  let panel = null;
  let current = null; // { videoId, segments, meta, method }
  const cache = new Map(); // videoId -> current (mở lại không phải trích lại)

  /* ------------------------------------------------------------------ */
  /* dựng khung                                                          */
  /* ------------------------------------------------------------------ */

  function build() {
    const el = document.createElement('aside');
    el.id = 'nblm-panel';
    el.innerHTML = `
      <header class="nblm-panel__head">
        <span class="nblm-panel__title">Transcript</span>
        <button type="button" class="nblm-panel__x" data-act="close" title="Đóng">×</button>
      </header>
      <div class="nblm-panel__tools">
        <input type="search" class="nblm-panel__search" placeholder="Tìm trong transcript…" spellcheck="false">
        <div class="nblm-panel__row">
          <button type="button" class="nblm-panel__btn" data-act="copy">Sao chép</button>
          <button type="button" class="nblm-panel__btn" data-act="dl-txt">.txt</button>
          <button type="button" class="nblm-panel__btn" data-act="dl-srt">.srt</button>
          <button type="button" class="nblm-panel__btn" data-act="dl-md">.md</button>
          <button type="button" class="nblm-panel__btn nblm-panel__btn--primary" data-act="send">→ NotebookLM</button>
        </div>
        <label class="nblm-panel__check">
          <input type="checkbox" class="nblm-panel__ts" checked> Kèm timestamp khi sao chép
        </label>
      </div>
      <div class="nblm-panel__status"></div>
      <ol class="nblm-panel__list"></ol>
      <footer class="nblm-panel__foot"></footer>`;

    el.addEventListener('click', onClick);
    el.querySelector('.nblm-panel__search').addEventListener('input', (e) => filter(e.target.value));
    document.documentElement.appendChild(el);
    return el;
  }

  function ensure() {
    if (!panel || !panel.isConnected) panel = build();
    return panel;
  }

  function status(message, kind = '') {
    const box = ensure().querySelector('.nblm-panel__status');
    box.textContent = message || '';
    box.dataset.kind = kind;
    box.hidden = !message;
  }

  /* ------------------------------------------------------------------ */
  /* hiển thị                                                           */
  /* ------------------------------------------------------------------ */

  function render() {
    const list = ensure().querySelector('.nblm-panel__list');
    list.replaceChildren(
      ...current.segments.map((seg) => {
        const li = document.createElement('li');
        li.className = 'nblm-panel__line';
        li.dataset.text = norm(seg.text);

        const stamp = document.createElement('button');
        stamp.type = 'button';
        stamp.className = 'nblm-panel__stamp';
        stamp.textContent = fmtTime(seg.start);
        stamp.title = 'Nhảy tới đoạn này';
        stamp.addEventListener('click', () => seek(seg.start));

        const text = document.createElement('span');
        text.className = 'nblm-panel__text';
        text.textContent = seg.text;

        li.append(stamp, text);
        return li;
      })
    );

    const title = current.meta && current.meta.title;
    ensure().querySelector('.nblm-panel__title').textContent = title || 'Transcript';
    ensure().querySelector('.nblm-panel__foot').textContent =
      `${current.segments.length} dòng · nguồn: ${current.method || 'n/a'}`;
  }

  function filter(query) {
    const q = norm(query);
    for (const li of ensure().querySelectorAll('.nblm-panel__line')) {
      li.hidden = q ? !li.dataset.text.includes(q) : false;
    }
  }

  /** Nhảy tới đúng giây trong trình phát của trang. */
  function seek(seconds) {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;
    video.currentTime = seconds;
    const playing = video.play();
    if (playing && playing.catch) playing.catch(() => {}); // trình duyệt có thể chặn autoplay
  }

  /* ------------------------------------------------------------------ */
  /* hành động                                                          */
  /* ------------------------------------------------------------------ */

  function download(format) {
    const spec = F.FORMATS[format];
    const meta = Object.assign({ videoId: current.videoId }, current.meta || {});
    const blob = new Blob([spec.render(current.segments, meta)], { type: `${spec.mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = F.fileName(meta, spec.ext);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Thu hồi ngay lập tức là hỏng tải trên một số bản Chrome — cho một nhịp.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function copy() {
    const withTs = ensure().querySelector('.nblm-panel__ts').checked;
    const text = F.toTxt(current.segments, { timestamps: withTs });
    // Bó rỗng KHÔNG chạm clipboard, cùng một luật với Đường trao tay:
    // `writeText('')` xoá trắng thứ người dùng đang giữ, và họ mất nó để đổi lấy
    // một dòng "đã sao chép". `toTxt` trả về chuỗi rỗng khi transcript chưa tải
    // xong hoặc bộ lọc cắt sạch đoạn — cả hai đều bấm được cái nút này.
    if (!text) {
      status('Chưa có gì để sao chép — transcript đang rỗng.', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      status('Đã sao chép transcript vào clipboard.', 'ok');
    } catch (e) {
      status(`Không sao chép được: ${(e && e.message) || e}`, 'error');
    }
  }

  async function onClick(event) {
    const act = event.target && event.target.dataset && event.target.dataset.act;
    if (!act) return;

    if (act === 'close') return close();
    if (!current) return;

    if (act === 'copy') return copy();
    if (act === 'dl-txt') return download('txt');
    if (act === 'dl-srt') return download('srt');
    if (act === 'dl-md') return download('md');
    if (act === 'send' && typeof root.NBLM_SEND_CURRENT === 'function') {
      root.NBLM_SEND_CURRENT(current.videoId, current.meta);
      status('Đã đưa video vào hàng đợi NotebookLM.', 'ok');
    }
  }

  /* ------------------------------------------------------------------ */
  /* vòng đời                                                           */
  /* ------------------------------------------------------------------ */

  async function open(videoId, langs) {
    ensure().classList.add('nblm-panel--show');

    if (cache.has(videoId)) {
      current = cache.get(videoId);
      status('');
      render();
      return;
    }

    current = null;
    ensure().querySelector('.nblm-panel__list').replaceChildren();
    ensure().querySelector('.nblm-panel__foot').textContent = '';
    status('Đang trích transcript…');

    try {
      const result = await T.extract(videoId, langs);
      current = {
        videoId,
        segments: result.segments,
        meta: Object.assign({ videoId }, result.meta || {}),
        method: result.method,
      };
      cache.set(videoId, current);
      status('');
      render();
    } catch (e) {
      status((e && e.message) || String(e), 'error');
    }
  }

  function close() {
    if (panel) panel.classList.remove('nblm-panel--show');
  }

  function isOpen() {
    return !!panel && panel.classList.contains('nblm-panel--show');
  }

  /** Đổi video trong SPA thì transcript cũ không còn đúng nữa. */
  function reset() {
    current = null;
    if (panel) {
      panel.querySelector('.nblm-panel__list').replaceChildren();
      panel.querySelector('.nblm-panel__search').value = '';
      panel.querySelector('.nblm-panel__foot').textContent = '';
    }
  }

  root.NBLM_PANEL = { open, close, isOpen, reset };
})(globalThis);
