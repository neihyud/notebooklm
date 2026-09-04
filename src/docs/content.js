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

  const { MSG, KIND, DEFAULTS, KEYS, getSettings, urlLabel, sleep, mapWithLimit } = globalThis.NBLM;
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

  /*
   * Dò sidebar mà KHÔNG đụng vào trang.
   *
   * `expand: false` là bắt buộc ở đây, không phải tuỳ chọn cho gọn. Hàm này chạy
   * lúc trang vừa tải và lặp mỗi 1500ms khi SPA đổi URL, chỉ để biết có nên hiện
   * nút launcher và ghi số lên nó. Cho nó mở section là extension tự bung toàn bộ
   * sidebar của người dùng khi họ chưa bấm gì — một tác động thấy được lên trang
   * của người khác, đổi lấy một con số trang trí trên nút.
   *
   * Chỗ mở đúng chỗ là `open()`: người dùng đã bấm, và con số lúc đó mới có hệ quả.
   */
  function detect() {
    try {
      detection = SB.detect();
    } catch (_) {
      detection = null;
    }
    return detection;
  }

  /** Dò lại có mở section — chỉ dùng khi người dùng đã bấm mở bảng chọn. */
  async function detectExpanded() {
    try {
      detection = (await SB.detectExpanded()) || detection;
    } catch (_) {
      /* giữ nguyên `detection` cũ: thà thiếu link còn hơn mất cả bảng */
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
  /* Cửa đo — NotebookLM có đọc nổi trang này không                        */
  /* -------------------------------------------------------------------- */

  /** Trần đồng thời cho cửa đo. Xem `mapWithLimit` và ràng buộc 7 của ticket 006. */
  const PROBE_LIMIT = 4;

  /**
   * Ngưỡng ký tự của vế thứ hai.
   *
   * Đo 2026-08-25 trên 19 trang thật, fetch ẩn danh + `fromDocument` trong jsdom:
   *   - chặn dưới: sáu trang vỏ JS thật, năm bộ tạo khác nhau (docsify ×2,
   *     Angular Material, swagger-ui, ng-bootstrap, Vite SPA) — `chars` đúng
   *     bằng **0**, không phải "gần 0".
   *   - chặn trên: trang SSR nhỏ nhất vẫn có chữ mà rơi `fallback` là
   *     `example.com` với **113** ký tự.
   * Cửa sổ an toàn là `1 ≤ N ≤ 113`; chọn 100 để lệch về phía cao.
   *
   * Lệch về phía nào là có lý do: hai lỗi KHÔNG cân nhau. TẮT nhầm thì trang được
   * nêu tên và người dùng đi đường Dán text — vốn là mặc định. BẬT nhầm thì
   * NotebookLM lặng lẽ nuốt một Nguồn rỗng, đúng cái bug extension này sinh ra để chữa.
   *
   * Đừng mượn `docsMinChars: 600` (`src/common/shared.js`): nó phục vụ quyết định
   * khác — "trang này rỗng quá, mở tab ẩn đọc lại". Hai quyết định thì không dùng
   * chung một ngưỡng.
   */
  const PROBE_MIN_CHARS = 100;

  /**
   * Trang này có thân bài trong HTML thô không?
   *
   * Chữ ký của "vỏ JS rỗng" là `how === 'fallback'` KÈM `chars` gần 0, không
   * phải mỗi `chars`: `chars` là độ dài Markdown *sau* khi dọn `JUNK_SELECTORS`,
   * nên `chars` thấp gộp hai nguyên nhân khác hẳn nhau làm một.
   *
   * Vế `chars` gần như không làm việc — trên 19 trang đo được, `how ===
   * 'fallback'` một mình đã tách đúng 17/17 trang docs. Nhưng đừng bỏ: nó cứu
   * đúng hai ca, `example.com` (113 ký tự, `score` DƯƠNG +110, rơi `fallback`
   * chỉ vì 110 < floor 200) và `info.cern.ch` (212 ký tự, `score` ÂM -25,5 vì
   * gần như toàn link). Cả hai server-render thật, có chữ thật. Gate chỉ xét
   * `how` sẽ TẮT nhầm cả hai.
   */
  function passesProbe(doc) {
    if (!doc) return false;
    return doc.how !== 'fallback' || Number(doc.chars || 0) >= PROBE_MIN_CHARS;
  }

  /**
   * Đo từng URL đã tick, và CHỈ lúc bấm nút copy.
   *
   * Không đo lúc mở bảng: `flatten()` duyệt hết cây sidebar và không có trần
   * nào — một site Docusaurus cỡ vừa là 200+ dòng, tức 200 lượt fetch cho một cú
   * bấm chưa xảy ra. Vì vậy nút copy LUÔN bật; trả tiền sau khi bấm.
   *
   * Parse ở đây, trong tab tài liệu, chứ không ở service worker: `DOMParser`
   * KHÔNG tồn tại trong MV3 service worker (doc chính thức của Chrome, và
   * `chrome.offscreen` có hẳn một `reason` tên `DOM_PARSER` — reason đó không tồn
   * tại nếu service worker tự parse được). Đường offscreen chạy được nhưng đắt
   * thật: repo chỉ có MỘT offscreen document, và document hiện tại tạo với
   * `reasons: ['BLOBS']` cho đường tải file — đường nào tạo trước thì chốt luôn
   * `reasons`. Tab tài liệu thì đang mở sẵn và có `DOMParser`. Ít bộ phận chuyển
   * động nhất.
   */
  async function probeUrls(urls, onProgress) {
    let done = 0;
    return mapWithLimit(urls, PROBE_LIMIT, async (url) => {
      const res = await chrome.runtime.sendMessage({ type: MSG.DOCS_RAW_FETCH, url }).catch((e) => ({
        error: (e && e.message) || String(e),
      }));

      let verdict;
      if (!res || res.error) {
        // Không đo được thì KHÔNG đoán. Fail-closed: trang rơi về Dán text.
        verdict = { url, ok: false, why: (res && res.error) || 'không tải được' };
      } else if (/text\/(plain|markdown)|application\/(json|yaml)/i.test(res.type || '')) {
        // File thô — không có vỏ JS nào để rỗng.
        verdict = { url, ok: true, how: 'raw', chars: (res.html || '').trim().length };
      } else {
        try {
          /*
           * KHÔNG dùng `extractOpts()` ở đây, và đây là cái bẫy chính của mục này:
           * `extractOpts()` mang theo `minChars: settings.docsMinChars` (mặc định
           * 600), thứ đi thẳng vào `pickRoot` thành `floor = max(200, 600)`. Với
           * floor 600 thì cả những trang SSR có thân bài thật cũng rơi `fallback`,
           * và cửa đo TẮT nhầm hàng loạt.
           *
           * `docsMinChars` phục vụ một quyết định KHÁC — "trang này rỗng quá, mở
           * tab ẩn đọc lại". Hai quyết định thì không dùng chung một ngưỡng. Phép
           * đo 19 trang dựng nên `PROBE_MIN_CHARS` chạy với `opts = {}`, tức
           * floor 200; cửa đo phải chạy đúng điều kiện đó.
           */
          const doc = EX.fromHtml(res.html || '', res.finalUrl || url, {
            keepLinks: !!settings.docsKeepLinks,
            keepImages: settings.docsKeepImages !== false,
          });
          verdict = { url, ok: passesProbe(doc), how: doc.how, chars: doc.chars };
          if (!verdict.ok) verdict.why = 'HTML thô không có thân bài (trang dựng bằng JavaScript)';
        } catch (e) {
          verdict = { url, ok: false, why: (e && e.message) || String(e) };
        }
      }

      done++;
      if (onProgress) onProgress(done, urls.length);
      return verdict;
    });
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

  async function open() {
    await detectExpanded();
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
          <button type="button" class="btn btn--ghost" data-act="recopy" hidden>Copy lại</button>
          <button type="button" class="btn btn--x" data-act="recopy-dismiss" aria-label="Bỏ qua danh sách Copy lại" title="Bỏ qua" hidden>×</button>
          <button type="button" class="btn btn--ghost" data-act="copy" disabled>Copy link</button>
          <button type="button" class="btn" data-act="import" disabled>Thêm 0 trang</button>
        </div>
      </footer>`;
    shadow.appendChild(el);
    document.documentElement.appendChild(host);

    const list = el.querySelector('.panel__list');
    const search = el.querySelector('.panel__search');
    const goBtn = el.querySelector('[data-act="import"]');
    const copyBtn = el.querySelector('[data-act="copy"]');
    const recopyBtn = el.querySelector('[data-act="recopy"]');
    const recopyX = el.querySelector('[data-act="recopy-dismiss"]');
    const runNow = el.querySelector('.panel__runnow');

    let rows = [];
    const boxes = new Map(); // id -> input

    /**
     * Một lượt copy đang chạy.
     *
     * Cửa khử trùng và cửa đo đều là một vòng `await`, và trong lúc chờ thì cái
     * nút vẫn bấm được: `syncCounts()` bật lại nó theo số dòng đang tick, chứ
     * không theo "đang bận hay không". Hai lượt chồng nhau là hai lượt cùng ghi
     * `copyBtn.textContent` và cùng gọi `writeText` — bản thắng là bản về sau.
     */
    let busy = false;

    function checkedRows() {
      return rows.filter((r) => r.url && boxes.get(r.id) && boxes.get(r.id).checked);
    }

    function syncCounts() {
      const n = checkedRows().length;
      goBtn.disabled = busy || !n;
      goBtn.textContent = n ? `Thêm ${n} trang` : 'Thêm 0 trang';
      // Nút copy LUÔN bật khi có dòng được tick — cửa đo chạy sau cú bấm, không
      // trước. Đo lúc mở bảng là 200 fetch cho một cú bấm chưa xảy ra. Ngoại lệ
      // duy nhất là `busy`: tick thêm một dòng giữa lượt đo không được phép mở
      // đường cho lượt thứ hai chen vào.
      copyBtn.disabled = busy || !n;
      copyBtn.textContent = n ? `Copy ${n} link` : 'Copy link';

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

    /**
     * Link bị cửa khử trùng loại ở lượt gần nhất — nguyên liệu cho nút *Copy lại*.
     * Sống trong closure của bảng: nó là danh sách người dùng vừa được báo, không
     * phải một danh sách tính lại sau đó.
     */
    let lastDropped = [];

    /**
     * @param {string[]} urls danh sách mới.
     * @param {boolean} opts.merge gộp vào danh sách đang giữ thay vì thay thế.
     *   Một lượt copy trên tập dòng KHÁC không biết gì về nợ của lượt trước, nên
     *   ghi đè là lặng lẽ vứt phần người dùng chưa xử lý — kể cả khi chính lượt
     *   này sau đó trượt sạch cửa đo.
     */
    function setRecopy(urls, { merge = false } = {}) {
      const next = (Array.isArray(urls) ? urls : []).filter(Boolean);
      lastDropped = merge ? [...new Set([...lastDropped, ...next])] : next;
      const on = lastDropped.length > 0;
      recopyBtn.hidden = !on;
      // Nút bỏ qua đi liền với nút Copy lại — ẩn/hiện cùng nhau, nếu không thì
      // một dấu × mồ côi đứng lại giữa hàng nút.
      recopyX.hidden = !on;
      recopyBtn.textContent = `Copy lại ${lastDropped.length} link đã có`;
    }

    /**
     * Đường trao tay cho trang tài liệu: khử trùng, đo, ghi clipboard, rồi dừng.
     *
     * Khử trùng ĐỨNG TRƯỚC cửa đo, vì cửa đo là thứ tốn tiền: mỗi trang là một
     * lượt fetch HTML thô. Đảo lại thì bấm *Copy N link* lần thứ hai trên một
     * sidebar 200 trang là 200 lượt fetch để rồi vứt cả 200.
     *
     * URL đem đi copy là `row.url` — đúng thứ bảng đang hiện. KHÔNG dùng `key`
     * (`docKey`): đó là khoá *so trùng*, không phải "bản sạch" để dán. `docKey`
     * percent-encode chữ có dấu (`/tiếng-việt` → `/ti%E1%BA%BFng-vi%E1%BB%87t`),
     * bỏ `:443`, và cắt `/` cuối. Dán vẫn chạy, nhưng URL hiện ra khác cái người
     * dùng vừa nhìn thấy. Hai vai, hai chuỗi.
     */
    async function copyBundle(picked) {
      const urls = picked.map((r) => r.url);

      // Khoá NGAY, đồng bộ, trước cái `await` đầu tiên. Bấm hai lần liền tay là
      // hai lượt cùng chạy: `res` của lượt đầu về sau lượt sau, `setRecopy` ghi
      // đè nhau, và cửa đo chạy hai lần cho cùng một danh sách.
      if (busy) return;
      busy = true;
      copyBtn.disabled = true;
      recopyBtn.disabled = true;
      goBtn.disabled = true;
      try {
        await runCopyBundle(urls);
      } finally {
        busy = false;
        recopyBtn.disabled = false;
        syncCounts();
      }
    }

    async function runCopyBundle(urls) {
      // `.catch` chứ không để trần: service worker vừa nạp lại thì `sendMessage`
      // *reject*, và một promise rejection trong handler click này không có ai
      // bắt — cú bấm chết câm. Biến nó thành đúng hình dạng lỗi ở dưới.
      const res = await chrome.runtime
        .sendMessage({ type: MSG.BUNDLE_FILTER, urls })
        .catch((e) => ({ error: (e && e.message) || String(e) }));
      /*
       * Lỗi của cửa khử trùng KHÔNG được đọc thành "không có gì để copy". Cả hai
       * ca cùng cho `keep` rỗng, nhưng một bên là "đã có rồi" còn bên kia là
       * "chưa tra được" — và bên thứ hai mà báo thành bên thứ nhất thì người dùng
       * vừa trả tiền cho một lượt đo xong nhận một câu sai nguyên nhân.
       */
      if (res && res.error) {
        flash(`Không tra được Sổ đã copy: ${res.error} — chưa copy gì cả, thử lại sau.`);
        return;
      }
      const keep = (res && res.keep) || [];
      const out = ((res && res.dropped) || []).filter((d) => d && d.url);
      /*
       * Chỉ thứ bị loại vì ĐÃ COPY mới vào nút *Copy lại*. Thứ bị loại vì đang
       * nằm trong Hàng đợi thì việc của nó là chạy trong Hàng đợi — copy lại link
       * của một trang mà cửa đo đã kết luận là rỗng thân bài chỉ dựng lại đúng
       * cái Nguồn rỗng người dùng vừa tránh được. Hai lý do, hai lối đi.
       */
      const dropped = out.filter((d) => d.why === 'copied');
      const queued = out.filter((d) => d.why !== 'copied');
      setRecopy(dropped.map((d) => d.url), { merge: true });

      if (!keep.length) {
        const why = [];
        if (dropped.length) why.push(`${dropped.length} link đã có trong Sổ đã copy`);
        if (queued.length) why.push(`${queued.length} link đang nằm trong Hàng đợi`);
        flash(
          why.length
            ? `Không copy được gì: ${why.join(' · ')}.${dropped.length ? ` Dùng nút "Copy lại ${dropped.length} link đã có".` : ' Mở popup để xử lý Hàng đợi.'}`
            : 'Không có trang nào để copy.'
        );
        return;
      }

      await measureAndCopy(keep, { dropped: dropped.length, queued: queued.length, progressEl: copyBtn });
    }

    /**
     * Nút *Copy lại* — chỗ duy nhất đi tới `dropped`, và nó vẫn phải qua cửa đo.
     *
     * Bỏ cửa đo ở nhánh này là bỏ đúng thứ giữ cho Bó link không sinh Nguồn rỗng:
     * `dropped` bị loại TRƯỚC khi ai đo nó, nên trong đó có thể là một trang
     * docsify dựng toàn bộ thân bài bằng JavaScript. Khử trùng thì bỏ được — đó
     * chính là việc người dùng vừa yêu cầu — cửa đo thì không.
     */
    async function recopyBundle() {
      if (busy) return;
      const urls = lastDropped.slice();
      if (!urls.length) return setRecopy([]);

      busy = true;
      copyBtn.disabled = true;
      recopyBtn.disabled = true;
      goBtn.disabled = true;
      try {
        // Chỉ buông danh sách khi clipboard đã nhận thật. Buông trước rồi cửa đo
        // hỏng giữa chừng là vứt mất bản duy nhất còn giữ nó — người dùng không
        // có đường nào lấy lại ngoài xoá sạch Sổ.
        //
        // Và "nhận thật" là nhận từng link một, không phải cả gói: cửa đo cho
        // qua 8 trong 12 thì 4 trang còn lại vẫn chưa tới clipboard. Buông sạch
        // là mất chúng; giữ nguyên cả 12 là bắt người dùng copy trùng 8 cái vừa
        // copy xong. Giữ đúng phần còn nợ.
        const res = await measureAndCopy(urls, { verb: 'Đã copy lại', progressEl: recopyBtn });
        setRecopy(res.ok ? res.blocked : urls);
      } finally {
        busy = false;
        recopyBtn.disabled = false;
        syncCounts();
      }
    }

    /**
     * Cửa đo → clipboard → Sổ → nhảy tab. Dùng chung cho cả hai nút, vì cái neo
     * là "không có đường nào tới `writeText` mà không qua cửa đo" — hai bản chép
     * tay của đoạn này là hai chỗ để cái neo tuột ra.
     *
     * @param {HTMLElement} opts.progressEl nút để hiện tiến độ đo. Phải là nút
     *   người dùng VỪA BẤM: đếm "Đang đo 3/12" trên nút *Copy link* trong khi
     *   người ta bấm *Copy lại* là báo tiến độ ở chỗ không ai nhìn.
     * @returns {{ok: boolean, passed: string[], blocked: string[]}} `ok` là
     *   clipboard đã nhận thật hay chưa; `blocked` là phần KHÔNG tới được
     *   clipboard — `recopyBundle` đọc nó để biết còn nợ những gì.
     */
    async function measureAndCopy(urls, { verb = 'Đã copy', dropped = 0, queued = 0, progressEl = copyBtn } = {}) {
      const original = progressEl.textContent;
      const fail = (msg) => { flash(msg); return { ok: false, passed: [], blocked: urls.slice() }; };

      try {
        progressEl.textContent = `Đang đo 0/${urls.length}…`;
        const verdicts = await probeUrls(
          urls,
          (done, total) => { progressEl.textContent = `Đang đo ${done}/${total}…`; }
        );

        const passed = verdicts.filter((v) => v.ok).map((v) => v.url);
        const blocked = verdicts.filter((v) => !v.ok);

        if (!passed.length) {
          // Bó rỗng: KHÔNG chạm clipboard. `writeText('')` xoá trắng thứ người
          // dùng đang giữ, và họ mất nó để đổi lấy một thông báo.
          return fail(
            `Không trang nào vào được Bó link: cả ${blocked.length} trang đều dựng thân bài bằng JavaScript ` +
            'hoặc không tải được. Dùng nút "Thêm N trang" — nội dung sẽ được trích ngay tại máy bạn.'
          );
        }

        try {
          await navigator.clipboard.writeText(passed.join('\n'));
        } catch (e) {
          return fail(`Không ghi được clipboard: ${(e && e.message) || e}`);
        }

        /*
         * TỪ ĐÂY TRỞ XUỐNG clipboard ĐÃ nhận. Mọi hỏng hóc sau vạch này đều là
         * hỏng của việc ghi Sổ hoặc của cú nhảy, KHÔNG phải của việc copy — và
         * gộp chúng vào một câu "Không copy được" là nói dối đúng chiều nguy
         * hiểm: người dùng đi copy lại một thứ đang nằm sẵn trong clipboard.
         * Nên không cái nào được phép ném ra ngoài; tất cả đi bằng `.catch`.
         */
        const book = await chrome.runtime
          .sendMessage({ type: MSG.BUNDLE_COPIED, urls: passed, from: siteName() })
          .catch((e) => ({ error: (e && e.message) || String(e) }));
        const bookErr = (book && book.error) || (book ? '' : 'không có hồi âm');

        /*
         * Bản tổng kết dựng TRƯỚC cú nhảy và đi kèm nó. Mục 6 bật tab notebook
         * lên rồi focus cửa sổ, nên tab tài liệu này thành tab nền ngay sau đó —
         * `flash` ở đây là bản báo cáo không ai đọc, mà nó mang đúng phần đáng
         * đọc nhất: những trang trượt cửa đo và cái giá của nguồn dán từ link.
         */
        const parts = [`${verb} ${passed.length} link`];
        if (blocked.length) parts.push(`${blocked.length} trang không có thân bài trong HTML thô → dùng "Thêm N trang"`);
        if (dropped) parts.push(`${dropped} đã có trong Sổ — nút "Copy lại"`);
        if (queued) parts.push(`${queued} đang nằm trong Hàng đợi`);
        if (bookErr) parts.push(`chưa ghi được Sổ đã copy (${bookErr}) — lần sau có thể copy trùng`);
        /*
         * Nói ra sự đánh đổi thay vì để người dùng tự phát hiện. Cửa đo trả lời
         * "Nguồn có RỖNG không", KHÔNG trả lời "Nguồn có SẠCH không": máy chủ
         * Google cào cả trang, không cào riêng khối thân bài, nên một trang qua
         * cửa vẫn cho ra Nguồn dính sidebar và footer. Đo 2026-08-24: phần dôi
         * ra ~10-14% với đa số trang, nhưng mkdocs-material là ~61%.
         */
        parts.push('link dán vào NotebookLM sẽ kèm cả menu điều hướng của trang');

        const jump = await chrome.runtime
          .sendMessage({ type: MSG.JUMP_NOTEBOOK, summary: parts.join(' · '), source: 'Tài liệu' })
          .catch(() => null);
        if (!jump || !jump.jumped) {
          parts.push(jumpWhy(jump));
          flash(parts.join(' · '));
        } else if (bookErr || jump.noted === false) {
          // Nhảy được thì bản tổng kết đi bằng thông báo hệ thống. Thông báo câm
          // hoặc trong đó có tin xấu về Sổ thì phải để lại vết ngay trên tab này.
          flash(parts.join(' · '));
        }
        return { ok: true, passed, blocked: blocked.map((v) => v.url) };
      } catch (e) {
        // Chỉ còn cửa đo mới ném tới được đây — clipboard chưa nhận gì cả.
        return fail(`Không đo được: ${(e && e.message) || e}`);
      } finally {
        progressEl.textContent = original;
      }
    }

    /** Vì sao không đứng trước ô "Thêm nguồn" — nói ra đường thủ công tương ứng. */
    function jumpWhy(jump) {
      const why = jump && jump.why;
      if (why === 'tab-gone') return 'tab notebook đã đóng — mở lại rồi Ctrl+V';
      if (why === 'no-target') return 'chưa đặt notebook đích — mở notebook rồi Ctrl+V';
      return 'không sang được notebook — mở notebook rồi Ctrl+V';
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
      if (act === 'copy') {
        const picked = checkedRows();
        if (!picked.length) return;
        await copyBundle(picked);
        return;
      }

      if (act === 'recopy') {
        await recopyBundle();
        return;
      }

      // Thẻ *Copy lại* không tự tắt — nó phải còn đó lúc người dùng quay lại từ
      // tab notebook. Nên phải có đúng một cách để nói "thôi, bỏ đi".
      if (act === 'recopy-dismiss') {
        return setRecopy([]);
      }

      if (act === 'import') {
        const picked = checkedRows();
        if (!picked.length) return;
        if (busy) return;
        busy = true;
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
          busy = false;
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
        // Bảng là singleton nhớ: `close()` chỉ đặt `display:none`, nên không
        // buông ở đây là mở lại trên trang khác vẫn thấy "Copy lại N link đã có"
        // của trang trước. Danh sách đó là thứ người dùng vừa được báo TRÊN MỘT
        // TRANG KHÁC; giữ nó lại là đổi nghĩa của chính con số.
        setRecopy([]);
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
      // Tiền tố `nblm-` như mọi phần tử extension chèn vào trang — xem
      // `test/ui-isolation.test.js`. Không có id thì nó vừa lọt lưới loại trừ
      // của chính extension, vừa không quan sát được từ test.
      toastEl.id = 'nblm-docs-toast';
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
            // Phải await: `open()` mở các section đóng và số link chỉ đúng sau đó.
            await open();
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
