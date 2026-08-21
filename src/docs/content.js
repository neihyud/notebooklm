/*
 * Content script cho trang tài liệu bất kỳ.
 *
 * Hai vai:
 *   1. Giao diện — nút mở "bảng chọn link" khi dò thấy sidebar, và chính bảng đó.
 *   2. Công nhân trích nội dung — background gọi xuống để fetch/đọc từng trang.
 *
 * Bảng chọn dựng trong shadow DOM: trang tài liệu nào cũng có CSS riêng và khá
 * hung hãn (reset toàn cục, `* { box-sizing }`, z-index cao), để ngoài shadow là
 * vỡ giao diện ngay trang đầu tiên gặp phải.
 */
;(function () {
  'use strict';

  const { MSG, KIND, DEFAULTS, KEYS, getSettings, urlLabel, sleep } = globalThis.NBLM;
  const SB = globalThis.NBLM_DOCS_SIDEBAR;
  const EX = globalThis.NBLM_DOCS_EXTRACT;

  let settings = Object.assign({}, DEFAULTS);
  let detection = null;   // kết quả dò sidebar gần nhất
  let panel = null;       // giao diện bảng chọn (dựng lười)

  const extractOpts = () => ({
    keepLinks: !!settings.docsKeepLinks,
    keepImages: settings.docsKeepImages !== false,
    minChars: Number(settings.docsMinChars) || 0,
  });

  /* -------------------------------------------------------------------- */
  /* dò sidebar + nút mở bảng                                              */
  /* -------------------------------------------------------------------- */

  function detect() {
    try {
      detection = SB.detect();
    } catch (_) {
      detection = null;
    }
    return detection;
  }

  let launcher = null;

  function refreshLauncher() {
    const wanted = settings.docsLauncher && detection && detection.count >= 3;
    if (!wanted) {
      if (launcher) {
        launcher.remove();
        launcher = null;
      }
      return;
    }
    if (!launcher) {
      launcher = document.createElement('button');
      launcher.id = 'nblm-docs-launcher';
      launcher.type = 'button';
      launcher.addEventListener('click', () => open());
      style(launcher, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: '2147482900',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        height: '38px',
        padding: '0 16px',
        border: 'none',
        borderRadius: '19px',
        background: '#1a73e8',
        color: '#fff',
        font: '500 13px/1 "Roboto", system-ui, sans-serif',
        boxShadow: '0 4px 16px rgba(0,0,0,.28)',
        cursor: 'pointer',
      });
      document.documentElement.appendChild(launcher);
    }
    launcher.textContent = `→ NotebookLM · ${detection.count} trang`;
    launcher.title = 'Mở bảng chọn link tài liệu để import vào NotebookLM';
  }

  function style(el, props) {
    for (const [key, value] of Object.entries(props)) el.style.setProperty(hyphenate(key), value, 'important');
  }

  function hyphenate(name) {
    return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  }

  /* -------------------------------------------------------------------- */
  /* bảng chọn                                                             */
  /* -------------------------------------------------------------------- */

  /** Cây sidebar -> danh sách phẳng có quan hệ cha/con, để render và tick lan truyền. */
  function flatten(tree) {
    const rows = [];
    (function walk(nodes, parent) {
      for (const node of nodes) {
        const row = {
          id: rows.length,
          title: node.title || urlLabel(node.url || ''),
          url: node.url || null,
          depth: Math.min(4, node.depth || 0),
          parent,
          children: [],
        };
        rows.push(row);
        if (parent !== null) rows[parent].children.push(row.id);
        walk(node.children || [], row.id);
      }
    })(tree, null);
    return rows;
  }

  function open() {
    if (!detection) detect();
    if (!detection) {
      flash('Không dò thấy sidebar tài liệu trên trang này.');
      return;
    }
    if (!panel) panel = buildPanel();
    panel.load(flatten(detection.tree));
    panel.host.style.setProperty('display', 'block', 'important');
  }

  function close() {
    if (panel) panel.host.style.setProperty('display', 'none', 'important');
  }

  function buildPanel() {
    const host = document.createElement('div');
    host.id = 'nblm-docs-root';
    style(host, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      zIndex: '2147483000',
      width: '0',
      height: '0',
      display: 'none',
    });

    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = chrome.runtime.getURL('src/docs/overlay.css');
    shadow.appendChild(sheet);

    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `
      <header class="panel__head">
        <div>
          <div class="panel__title">Tài liệu → NotebookLM</div>
          <div class="panel__site"></div>
        </div>
        <button type="button" class="panel__icon" data-act="close" title="Đóng">×</button>
      </header>
      <div class="panel__tools">
        <input type="search" class="panel__search" placeholder="Lọc theo tên hoặc đường dẫn…" spellcheck="false">
        <div class="panel__btns">
          <button type="button" class="chip" data-act="all">Chọn hết</button>
          <button type="button" class="chip" data-act="none">Bỏ chọn</button>
          <button type="button" class="chip" data-act="invert">Đảo</button>
        </div>
      </div>
      <div class="panel__list"></div>
      <footer class="panel__foot">
        <p class="panel__note">
          Mỗi trang được trích nội dung <strong>ngay tại máy bạn</strong> rồi dán vào NotebookLM
          dưới dạng nguồn văn bản — NotebookLM thường không đọc nổi link tài liệu render bằng JS.
        </p>
        <div class="panel__go">
          <label class="panel__run"><input type="checkbox" class="panel__runnow" checked> Chạy ngay</label>
          <button type="button" class="btn" data-act="import" disabled>Thêm 0 trang</button>
        </div>
      </footer>`;
    shadow.appendChild(el);
    document.documentElement.appendChild(host);

    const list = el.querySelector('.panel__list');
    const search = el.querySelector('.panel__search');
    const goBtn = el.querySelector('[data-act="import"]');
    const runNow = el.querySelector('.panel__runnow');

    let rows = [];
    const boxes = new Map(); // id -> input

    function checkedRows() {
      return rows.filter((r) => r.url && boxes.get(r.id) && boxes.get(r.id).checked);
    }

    function syncCounts() {
      const n = checkedRows().length;
      goBtn.disabled = !n;
      goBtn.textContent = n ? `Thêm ${n} trang` : 'Thêm 0 trang';

      // Nhóm không có URL vẫn cần hiện trạng thái theo con của nó.
      for (const row of rows) {
        if (row.url || !row.children.length) continue;
        const box = boxes.get(row.id);
        if (!box) continue;
        const kids = descendants(row).filter((r) => r.url);
        const on = kids.filter((r) => boxes.get(r.id).checked).length;
        box.checked = kids.length > 0 && on === kids.length;
        box.indeterminate = on > 0 && on < kids.length;
      }
    }

    function descendants(row) {
      const out = [];
      const stack = row.children.slice();
      while (stack.length) {
        const child = rows[stack.pop()];
        if (!child) continue;
        out.push(child);
        stack.push(...child.children);
      }
      return out;
    }

    function setRow(row, value) {
      const box = boxes.get(row.id);
      if (box) {
        box.checked = value;
        box.indeterminate = false;
      }
      for (const kid of descendants(row)) {
        const kidBox = boxes.get(kid.id);
        if (kidBox) {
          kidBox.checked = value;
          kidBox.indeterminate = false;
        }
      }
    }

    function render() {
      const query = search.value.trim().toLowerCase();
      const visible = new Set();
      if (query) {
        for (const row of rows) {
          const hay = `${row.title} ${row.url || ''}`.toLowerCase();
          if (!hay.includes(query)) continue;
          visible.add(row.id);
          for (let p = row.parent; p !== null && p !== undefined; p = rows[p].parent) visible.add(p);
        }
      }

      list.replaceChildren(
        ...rows
          .filter((row) => !query || visible.has(row.id))
          .map((row) => {
            const line = document.createElement('label');
            line.className = row.url ? 'row' : 'row row--group';
            line.style.paddingLeft = `${8 + row.depth * 14}px`;

            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = boxes.has(row.id) ? boxes.get(row.id).checked : false;
            box.indeterminate = boxes.has(row.id) ? boxes.get(row.id).indeterminate : false;
            box.addEventListener('change', () => {
              setRow(row, box.checked);
              syncCounts();
            });
            boxes.set(row.id, box);

            const text = document.createElement('span');
            text.className = 'row__title';
            text.textContent = row.title;

            const hint = document.createElement('span');
            hint.className = 'row__path';
            hint.textContent = row.url ? shortPath(row.url) : `${descendants(row).filter((r) => r.url).length} trang`;

            line.append(box, text, hint);
            return line;
          })
      );
      syncCounts();
    }

    el.addEventListener('click', async (event) => {
      const act = event.target && event.target.dataset && event.target.dataset.act;
      if (!act) return;

      if (act === 'close') return close();
      if (act === 'all') {
        rows.forEach((r) => setRow(r, true));
        return syncCounts();
      }
      if (act === 'none') {
        rows.forEach((r) => setRow(r, false));
        return syncCounts();
      }
      if (act === 'invert') {
        for (const row of rows) {
          if (!row.url) continue;
          const box = boxes.get(row.id);
          if (box) box.checked = !box.checked;
        }
        return syncCounts();
      }
      if (act === 'import') {
        const picked = checkedRows();
        if (!picked.length) return;
        goBtn.disabled = true;
        goBtn.textContent = 'Đang xếp hàng…';
        try {
          const res = await chrome.runtime.sendMessage({
            type: MSG.ENQUEUE,
            autoRun: runNow.checked,
            items: picked.map((row) => ({
              kind: KIND.DOCS,
              url: row.url,
              title: row.title,
              site: siteName(),
              section: sectionOf(row, rows),
            })),
          });
          if (res && res.error) flash(`Lỗi: ${res.error}`);
          else {
            flash(`Đã xếp hàng ${(res && res.added) || 0} trang${res && res.skipped ? `, bỏ qua ${res.skipped} trùng` : ''}.`);
            close();
          }
        } catch (e) {
          flash(`Lỗi: ${(e && e.message) || e}`);
        } finally {
          syncCounts();
        }
      }
    });

    search.addEventListener('input', render);
    el.querySelector('.panel__site').textContent = siteName();

    return {
      host,
      load(next) {
        rows = next;
        boxes.clear();
        search.value = '';
        render();
      },
    };
  }

  function shortPath(url) {
    try {
      const u = new URL(url);
      return (globalThis.NBLM.isHashRoute(u.hash) ? u.hash : u.pathname) || '/';
    } catch (_) {
      return url;
    }
  }

  function siteName() {
    return location.hostname.replace(/^www\./, '');
  }

  /** Đường dẫn nhóm cha, dùng làm trường "Mục" trong nguồn NotebookLM. */
  function sectionOf(row, rows) {
    const parts = [];
    for (let p = row.parent; p !== null && p !== undefined; p = rows[p].parent) {
      if (rows[p].title) parts.unshift(rows[p].title);
    }
    return parts.join(' / ').slice(0, 200);
  }

  /* -------------------------------------------------------------------- */
  /* thông báo nhỏ                                                         */
  /* -------------------------------------------------------------------- */

  let toastEl = null;
  let toastTimer = null;
  function flash(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      style(toastEl, {
        position: 'fixed',
        right: '20px',
        bottom: '68px',
        zIndex: '2147483001',
        maxWidth: '360px',
        padding: '11px 14px',
        borderRadius: '10px',
        background: '#202124',
        color: '#e8eaed',
        font: '400 13px/1.45 "Roboto", system-ui, sans-serif',
        boxShadow: '0 8px 28px rgba(0,0,0,.45)',
        pointerEvents: 'none',
      });
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.style.setProperty('opacity', '1', 'important');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.style.setProperty('opacity', '0', 'important'), 4500);
  }

  /* -------------------------------------------------------------------- */
  /* trích nội dung theo yêu cầu của background                            */
  /* -------------------------------------------------------------------- */

  /**
   * Đọc trang *đang hiển thị*, chờ nội dung ổn định rồi mới chốt.
   *
   * Bẫy rất dễ lọt ở đây: với docs kiểu docsify, điều hướng `#/a` → `#/b` **không
   * tải lại trang**. Tab báo 'complete' ngay lập tức trong khi DOM vẫn còn nguyên
   * nội dung trang trước — đọc luôn là gán nhầm nội dung trang cũ cho URL mới,
   * và nguồn trong NotebookLM sai mà nhìn vẫn hợp lý.
   */
  async function readLive(url, timeout) {
    const opts = extractOpts();
    const floor = Math.max(1, Number(settings.docsMinChars) || 0);
    const deadline = Date.now() + (timeout || 10000);
    const wanted = url ? globalThis.NBLM.docKey(url) : null;

    // 1. Chờ SPA chuyển sang đúng route được yêu cầu.
    while (wanted && globalThis.NBLM.docKey(location.href) !== wanted && Date.now() < deadline) {
      await sleep(200);
    }

    // 2. Chờ nội dung dày lên rồi đứng yên. `stable` đếm số lần đo liên tiếp
    //    không đổi: trùng một lần có thể chỉ là khoảng lặng giữa hai lượt render,
    //    trùng hai lần thì gần như chắc chắn đã dựng xong.
    let best = EX.fromLive(opts);
    let stable = 0;
    while (Date.now() < deadline) {
      await sleep(350);
      const next = EX.fromLive(opts);
      stable = next.chars === best.chars ? stable + 1 : 0;
      if (next.chars > best.chars) best = next;
      if (best.chars >= floor && stable >= 2) break;
    }
    return Object.assign(best, { url: location.href });
  }

  /* -------------------------------------------------------------------- */
  /* vòng đời                                                              */
  /* -------------------------------------------------------------------- */

  getSettings().then((s) => {
    settings = s;
    detect();
    refreshLauncher();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEYS.SETTINGS]) return;
    settings = Object.assign({}, DEFAULTS, changes[KEYS.SETTINGS].newValue || {});
    refreshLauncher();
  });

  // Docs hiện đại đều là SPA: đổi trang không tải lại tài liệu. Chỉ cần so URL
  // theo nhịp chậm — rẻ hơn nhiều so với treo MutationObserver trên mọi trang web.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    detect();
    refreshLauncher();
  }, 1500);

  /**
   * Chỉ những loại tin script này thực sự xử lý.
   *
   * BẮT BUỘC phải lọc trước, và tuyệt đối không trả lời loại tin của script khác.
   * Một tab có thể có *nhiều* content script cùng sống: `exclude_matches` chỉ chi
   * phối lúc Chrome tự tiêm, còn `chrome.scripting.executeScript` thì tiêm được
   * vào bất cứ đâu — bấm bảng chọn tài liệu trên chính tab NotebookLM là script
   * này nằm luôn ở đó. Khi hai listener cùng nghe, Chrome lấy *phản hồi đến
   * trước*: chỉ cần trả lời "lệnh lạ" cho `nlm-ping` là cướp mất câu trả lời của
   * content script NotebookLM, và import chết bằng một lỗi trỏ sai hoàn toàn chỗ.
   */
  const HANDLED = new Set([MSG.DOCS_PING, MSG.DOCS_PANEL, MSG.DOCS_FETCH, MSG.DOCS_READ]);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !HANDLED.has(message.type)) return false; // của script khác — im lặng
    (async () => {
      try {
        switch (message.type) {
          case MSG.DOCS_PING:
            if (!detection) detect();
            sendResponse({
              ok: true,
              url: location.href,
              title: document.title,
              hasSidebar: !!detection,
              count: detection ? detection.count : 0,
            });
            return;

          case MSG.DOCS_PANEL:
            open();
            sendResponse({ ok: true, hasSidebar: !!detection, count: detection ? detection.count : 0 });
            return;

          case MSG.DOCS_FETCH: {
            const doc = await EX.fromUrl(message.url, extractOpts());
            sendResponse({ ok: true, doc, method: 'fetch' });
            return;
          }

          case MSG.DOCS_READ: {
            if (document.readyState !== 'complete') {
              await new Promise((r) => window.addEventListener('load', r, { once: true }));
            }
            const doc = await readLive(message.url, message.timeout);
            sendResponse({ ok: true, doc, method: 'tab' });
            return;
          }

          default:
            // Không tới được: HANDLED đã lọc ở trên.
            sendResponse({ ok: false, error: `lệnh lạ: ${message.type}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || String(e) });
      }
    })();
    return true;
  });
})();
