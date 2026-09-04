/* Popup: xem/điều khiển hàng đợi, chọn notebook đích, dán link hàng loạt. */
(() => {
  'use strict';

  const { MSG, STATUS, PRIVACY, KIND, canonicalUrl, videoIdFrom, parseUrlList, fmtTime, urlLabel } =
    globalThis.NBLM;

  const $ = (id) => document.getElementById(id);
  const els = {
    notebookUrl: $('notebook-url'),
    accountClear: $('account-clear'),
    notebookHint: $('notebook-hint'),
    useCurrent: $('use-current'),
    accountRow: $('notebook-account-row'),
    accountSelect: $('account-select'),
    accountNote: $('account-note'),
    notebookSelect: $('notebook-select'),
    notebookRefresh: $('notebook-refresh'),
    notebookCreate: $('notebook-create'),
    notebookName: $('notebook-name'),
    notebookCreateGo: $('notebook-create-go'),
    notebookCreateCancel: $('notebook-create-cancel'),
    bulk: $('bulk'),
    bulkHint: $('bulk-hint'),
    addBulk: $('add-bulk'),
    addCurrent: $('add-current'),
    scanDocs: $('scan-docs'),
    importPlaylist: $('import-playlist'),
    collectTabs: $('collect-tabs'),
    collectLinks: $('collect-links'),
    collectHint: $('collect-hint'),
    queueHead: $('queue-head'),
    list: $('list'),
    listMore: $('list-more'),
    empty: $('empty'),
    counts: $('counts'),
    progress: $('progress'),
    progressBar: $('progress-bar'),
    progressText: $('progress-text'),
    run: $('run'),
    stop: $('stop'),
    retry: $('retry'),
    clearDone: $('clear-done'),
    clearAll: $('clear-all'),
    queueMenuBtn: $('queue-menu-btn'),
    queueMenu: $('queue-menu'),
    openOptions: $('open-options'),
    tabQueue: $('tab-queue'),
    tabAdd: $('tab-add'),
    tabQueueBadge: $('tab-queue-badge'),
    panelQueue: $('panel-queue'),
    panelAdd: $('panel-add'),
    emptyAddBtn: $('empty-add-btn'),
    copied: $('copied'),
    copiedCount: $('copied-count'),
    copiedList: $('copied-list'),
    copiedMore: $('copied-more'),
    clearCopied: $('clear-copied'),
  };

  /** Gửi message lên background với cơ chế bắt lỗi mất kết nối service worker. */
  const send = async (type, payload) => {
    try {
      return await chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
    } catch (err) {
      console.warn('[NBLM popup]', type, err);
      if (els.notebookHint) {
        els.notebookHint.textContent = 'Mất kết nối với service worker. Hãy mở lại popup.';
        els.notebookHint.classList.add('error');
      }
      return { error: err.message };
    }
  };

  /** Khoá chống bấm liên tiếp (double click) khi async request đang chạy. */
  let isActionPending = false;
  async function withActionLock(fn) {
    if (isActionPending) return;
    isActionPending = true;
    try {
      await fn();
    } finally {
      isActionPending = false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* chọn notebook bằng danh sách (ticket 011)                         */
  /* ---------------------------------------------------------------- */

  /** Giá trị đặc biệt của `<option>` đầu danh sách. */
  const TAO_MOI = '__tao-moi__';

  /**
   * Năm trạng thái, và KHÔNG trạng thái nào là ngõ cụt. Đây là phần đáng đọc
   * nhất của tính năng, nên nó nằm trong một hàm chứ không rải ra các handler.
   *
   * Chỗ dễ làm sai: gộp "chưa mở NotebookLM" với "đã mở nhưng chưa có notebook
   * nào". Hai ca đó cần hai câu khác nhau, vì hành động tiếp theo của owner
   * khác nhau — một bên đi mở tab, một bên bấm tạo. Backend phân biệt chúng
   * bằng `needsTab`; nếu popup gộp lại thì phần phân biệt ấy vứt đi.
   *
   * Nhãn lúc hỏng nói VIỆC CẦN LÀM, không nói "Lỗi".
   *
   * @returns id notebook mà hàm này TỰ chọn thay owner và vì thế caller phải
   *   ghi lại vào `notebookUrl`; `null` khi không có gì phải ghi.
   */
  function renderNotebookSelect(state, data) {
    const sel = els.notebookSelect;
    const opt = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      return o;
    };
    sel.innerHTML = '';

    if (state === 'chua-nap') {
      sel.append(opt('', 'Bấm ↻ để nạp danh sách'));
      sel.disabled = true;
      return;
    }
    if (state === 'dang-nap') {
      sel.append(opt('', 'Đang nạp danh sách…'));
      sel.disabled = true;
      return;
    }
    if (state === 'khong-co-tab') {
      sel.append(opt('', 'Mở NotebookLM rồi bấm ↻'));
      sel.disabled = true;
      return;
    }
    /*
     * Hai ca "với tới được backend". Mục tạo mới đứng ĐẦU ở cả hai — Chốt 3 của
     * ticket 011 — và chính nó khiến ca "0 notebook" không còn là ngõ cụt.
     *
     * KHÔNG có placeholder "Chọn notebook…". Nó từng chiếm đúng chỗ đầu tiên
     * mà Chốt 3 dành cho mục tạo mới, và nó là một dòng chết: chọn nó không
     * làm gì cả. Oracle B cũng không có placeholder — danh sách của họ bắt đầu
     * thẳng bằng `+ Create new notebook`.
     */
    const list = (data && data.notebooks) || [];
    sel.append(opt(TAO_MOI, '+ Tạo notebook mới'));
    for (const nb of list) {
      sel.append(opt(nb.id, nb.title || `(không tên) ${nb.id.slice(0, 8)}`));
    }
    sel.disabled = false;

    /*
     * Chọn sẵn cái nào.
     *
     * Ưu tiên notebook đang lưu trong `notebookUrl`; nó không còn trong danh
     * sách thì lùi về notebook THẬT đầu tiên chứ không để mục tạo mới đứng
     * hiện — cùng cách oracle B làm, và vì cùng lý do: mục tạo mới đứng hiện
     * mà owner đã có notebook thì cú bấm kế tiếp tạo ra một sổ rỗng thừa.
     *
     * Chỉ khi KHÔNG có notebook nào thì mục tạo mới mới là cái đang hiện.
     */
    const dangLuu = (/\/notebook\/([^/?#]+)/.exec(els.notebookUrl.value.trim()) || [])[1];
    const khop = dangLuu && list.some((nb) => nb.id === dangLuu);
    if (khop) {
      sel.value = dangLuu;
      return null;
    }
    if (list.length) {
      sel.selectedIndex = 1; // mục ngay sau TAO_MOI
      return sel.value;
    }
    sel.selectedIndex = 0;
    return null;
  }

  /**
   * Ghi notebook đích. Một chỗ duy nhất biết hình dạng URL, vì giờ có HAI
   * đường tới đây: owner tự chọn trong dropdown, và dropdown tự chọn hộ.
   */
  async function datNotebook(id) {
    const clean = `https://notebooklm.google.com/notebook/${id}`;
    els.notebookUrl.value = clean;
    await globalThis.NBLM.setSettings({ notebookUrl: clean });
  }

  function moKhungTao(mo) {
    els.notebookCreate.hidden = !mo;
    if (mo) {
      els.notebookName.value = '';
      els.notebookName.focus();
    }
  }

  /**
   * Hàng chọn tài khoản (ticket 013).
   *
   * ẨN HẲN khi không đọc được `ListAccounts`, hoặc khi chỉ có đúng một tài
   * khoản: một dropdown một dòng không cho owner quyết định gì, chỉ chiếm chỗ.
   * Đó cũng chính là đường lùi cho điều kiện đảo ngược số 1 của ticket.
   */
  function renderAccounts(r) {
    const row = els.accountRow;
    const sel = els.accountSelect;
    const list = (r && r.accounts) || [];
    /*
     * Ẩn khi một dropdown một dòng không cho quyết định gì — TRỪ khi tài khoản
     * đã chọn không còn trong danh sách. Lúc đó ẩn đi là bỏ owner lại trong ngõ
     * cụt: câu note bảo "chọn lại tài khoản ở trên" mà "ở trên" không có gì.
     * Còn một mục thật cộng mục "không còn đăng nhập" là đủ để chọn lại.
     */
    const thieu = r && r.selected && !list.some((a) => a.email === r.selected);
    if (!r || !r.ok || (list.length < 2 && !thieu) || !list.length) {
      row.hidden = true;
      sel.textContent = '';
      return;
    }
    sel.textContent = '';
    for (const a of list) {
      const o = document.createElement('option');
      o.value = a.email;
      o.textContent = a.isDefault ? `${a.email} (mặc định)` : a.email;
      sel.append(o);
    }
    /*
     * Tài khoản đã chọn KHÔNG còn trong danh sách (đăng xuất ở nơi khác).
     *
     * Gán thẳng `sel.value` cho một giá trị không có option nào mang thì
     * `selectedIndex` thành -1 và dropdown hiện ra TRẮNG TRƠN — chụp bằng
     * Brave thật mới thấy, jsdom báo xanh. Trắng trơn là câu tệ nhất có thể:
     * nó trông như hỏng, trong khi sự thật là "tài khoản kia đã đăng xuất".
     * Nên nói ra bằng một option riêng, khoá lại để không chọn lại được.
     */
    const co = list.some((a) => a.email === r.selected);
    if (r.selected && !co) {
      const o = document.createElement('option');
      o.value = '';
      o.disabled = true;
      o.textContent = `${r.selected} — không còn đăng nhập`;
      sel.prepend(o);
      sel.selectedIndex = 0;
    } else {
      sel.value = r.selected || (list.find((a) => a.isDefault) || list[0]).email;
    }
    row.hidden = false;
  }

  /**
   * Câu "đang dùng tài khoản nào". Hiện CHỈ khi ta không chắc.
   *
   * Ticket 013, Kết quả 3: không có tài khoản nào được chọn thì phải NÓI RA là
   * đang dùng mặc định. Im lặng ở đây đúng là chế độ hỏng mà ticket tồn tại để
   * chặn — ghi vào nhầm tài khoản mà không báo gì.
   */
  function renderAccountNote(account, acc) {
    const el = els.accountNote;
    const thoat = els.accountClear;
    thoat.hidden = true;
    if (!account || account.source === 'chosen') {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    /*
     * `acc.status` từng được tính, truyền hết đường lên đây rồi BỊ BỎ. Nên hai
     * ca rất khác nhau hiện ra y hệt nhau: "bạn thật sự chỉ có một tài khoản",
     * và "`ListAccounts` đổi hình dạng nên ta không nhận ra tài khoản nào".
     * Ca thứ hai là điều kiện đảo ngược số 1 đang xảy ra — im lặng ở đó thì
     * owner không bao giờ biết phép dò đã hỏng.
     */
    const dochong = acc && (!acc.ok || (acc.status === 'empty' && !acc.accounts.length));
    /*
     * Câu cho `chosen-missing` phải trỏ vào điều khiển CÓ THẬT. Hàng chọn ẩn
     * mà vẫn viết "chọn lại tài khoản ở trên" thì chính câu hướng dẫn là ngõ
     * cụt — nó bảo owner làm một việc không làm được.
     */
    const ket = els.accountRow.hidden;
    const text = {
      tab: 'Đang dùng tài khoản của tab NotebookLM đang mở.',
      default: 'Chưa chọn tài khoản — đang dùng tài khoản Google mặc định (authuser=0).',
      'chosen-missing': ket
        ? 'Tài khoản đã chọn không còn đăng nhập, và không đọc được danh sách để chọn lại. Chưa gửi request nào.'
        : 'Tài khoản đã chọn không còn đăng nhập. Chưa gửi request nào — chọn lại tài khoản ở trên.',
    }[account.source];
    if (!text) {
      el.hidden = true;
      return;
    }
    // Chỉ ghép cho `tab`/`default`: câu `chosen-missing` lúc kẹt đã tự nói ra
    // chuyện không đọc được danh sách, ghép nữa là lặp ý.
    el.textContent = dochong && account.source !== 'chosen-missing'
      ? `Không đọc được danh sách tài khoản Google. ${text}`
      : text;
    el.hidden = false;
    // Ngõ cụt duy nhất còn lại: đã chọn một tài khoản không dùng được, mà danh
    // sách không đủ để chọn lại. Bỏ chọn là đường lùi về hành vi trước 013.
    if (account.source === 'chosen-missing' && ket) thoat.hidden = false;
  }

  async function napTaiKhoan() {
    let r = null;
    try {
      r = await send(MSG.LIST_ACCOUNTS);
    } catch (_) {
      r = null;
    }
    renderAccounts(r);
    return r;
  }

  /**
   * Lượt liệt kê. CHỈ gọi từ hai chỗ: nút ↻, và ngay sau khi tạo notebook xong.
   * Không có lối gọi nào lúc popup mở — đó là ràng buộc thay cho việc gắn tính
   * năng này sau công tắc `rpcEnabled` (xem ticket 011, Chốt 3).
   */
  async function napDanhSach() {
    renderNotebookSelect('dang-nap');
    const acc = await napTaiKhoan();
    let r = null;
    try {
      r = await send(MSG.LIST_NOTEBOOKS);
    } catch (_) {
      r = null;
    }
    renderAccountNote(r && r.account, acc);
    if (!r || (!r.ok && r.needsTab)) {
      renderNotebookSelect('khong-co-tab');
      els.notebookHint.textContent =
        'Chưa có tab NotebookLM nào đang mở. Mở notebooklm.google.com rồi bấm ↻.';
      return;
    }
    if (!r.ok) {
      // Với tới tab được nhưng backend không trả danh sách đọc được. KHÔNG phải
      // ngõ cụt: mục "Tạo notebook mới" vẫn còn, và ô dán URL vẫn nguyên.
      renderNotebookSelect('co-tab', { notebooks: [] });
      els.notebookHint.textContent = 'Không đọc được danh sách notebook — vẫn dán URL vào ô dưới được.';
      return;
    }
    /*
     * Dropdown có thể TỰ chọn một notebook thay owner (khi cái đang lưu không
     * còn trong danh sách). Không ghi lại thì nhãn “Gửi tới” nói một đằng,
     * lượt import chạy một nẻo — backend đọc `notebookUrl`, không đọc dropdown.
     * Oracle B ghi ngay tại đúng hai nhánh fallback này, vì cùng lý do.
     */
    const canGhi = renderNotebookSelect('co-tab', r);
    if (canGhi) await datNotebook(canGhi);

    if (r.notebooks.length) {
      els.notebookHint.textContent = '';
      return;
    }
    /*
     * 0 notebook: mục tạo mới là mục ĐANG HIỆN, nên bảo owner “chọn” nó là một
     * ngõ cụt: chọn lại cái đang chọn không phát `change`. Mở thẳng khung tạo.
     * Chỉ làm ở đây chứ không trong render: nhánh `!r.ok` bên trên cũng dựng
     * danh sách rỗng, nhưng ở đó ta KHÔNG biết tài khoản có notebook hay không.
     */
    els.notebookHint.textContent = 'Tài khoản chưa có notebook nào — đặt tên rồi bấm Tạo.';
    moKhungTao(true);
  }

  /* ---------------------------------------------------------------- */
  /* điều hướng tab                                                    */
  /* ---------------------------------------------------------------- */

  function switchTab(target) {
    resetClearAllBtn();
    resetClearCopiedBtn();
    closeQueueMenu();
    const isQueue = target === 'queue';
    // Roving tabindex: chỉ tab đang chọn nhận được phím Tab, hai mũi tên đi
    // giữa hai tab — đúng hợp đồng của role="tablist".
    if (els.tabQueue) {
      els.tabQueue.classList.toggle('is-active', isQueue);
      els.tabQueue.setAttribute('aria-selected', String(isQueue));
      els.tabQueue.tabIndex = isQueue ? 0 : -1;
    }
    if (els.tabAdd) {
      els.tabAdd.classList.toggle('is-active', !isQueue);
      els.tabAdd.setAttribute('aria-selected', String(!isQueue));
      els.tabAdd.tabIndex = isQueue ? -1 : 0;
    }
    if (els.panelQueue) els.panelQueue.hidden = !isQueue;
    if (els.panelAdd) els.panelAdd.hidden = isQueue;
  }

  function handleTabKeydown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      switchTab('add');
      if (els.tabAdd) els.tabAdd.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      switchTab('queue');
      if (els.tabQueue) els.tabQueue.focus();
    }
  }

  if (els.tabQueue) {
    els.tabQueue.addEventListener('click', () => switchTab('queue'));
    els.tabQueue.addEventListener('keydown', handleTabKeydown);
  }
  if (els.tabAdd) {
    els.tabAdd.addEventListener('click', () => switchTab('add'));
    els.tabAdd.addEventListener('keydown', handleTabKeydown);
  }
  if (els.emptyAddBtn) {
    els.emptyAddBtn.addEventListener('click', () => {
      switchTab('add');
      if (els.bulk) els.bulk.focus();
    });
  }

  /* ---------------------------------------------------------------- */
  /* menu thao tác hàng đợi                                            */
  /* ---------------------------------------------------------------- */

  function closeQueueMenu() {
    if (!els.queueMenu) return;
    els.queueMenu.hidden = true;
    if (els.queueMenuBtn) els.queueMenuBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleQueueMenu() {
    if (!els.queueMenu) return;
    const willOpen = els.queueMenu.hidden;
    if (!willOpen) {
      closeQueueMenu();
      return;
    }
    resetClearAllBtn();
    els.queueMenu.hidden = false;
    if (els.queueMenuBtn) els.queueMenuBtn.setAttribute('aria-expanded', 'true');
    const first = els.queueMenu.querySelector('.menu__item:not([disabled])');
    if (first) first.focus();
  }

  if (els.queueMenuBtn) {
    els.queueMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleQueueMenu();
    });
  }
  if (els.queueMenu) {
    els.queueMenu.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', () => closeQueueMenu());

  /* ---------------------------------------------------------------- */
  /* bảo vệ thao tác xoá (2-step confirm)                             */
  /* ---------------------------------------------------------------- */

  let clearAllTimer = null;
  function resetClearAllBtn() {
    if (clearAllTimer) clearTimeout(clearAllTimer);
    clearAllTimer = null;
    if (els.clearAll) {
      els.clearAll.textContent = 'Xoá hết hàng đợi';
      els.clearAll.classList.remove('is-confirming');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      resetClearAllBtn();
      if (els.queueMenu && !els.queueMenu.hidden) {
        closeQueueMenu();
        if (els.queueMenuBtn) els.queueMenuBtn.focus();
      }
    }
  });

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Nhãn ngắn trên thẻ trạng thái. Cố ý ngắn: nó là thứ được quét bằng mắt,
   * còn lý do dài thì đã có dòng riêng bên dưới.
   */
  const PILL = {
    [STATUS.PENDING]: { text: 'Chờ', cls: 'pill--idle' },
    [STATUS.EXTRACTING]: { text: 'Đang trích', cls: 'pill--busy' },
    [STATUS.IMPORTING]: { text: 'Đang thêm', cls: 'pill--busy' },
    [STATUS.DONE]: { text: 'Xong', cls: 'pill--done' },
    [STATUS.ERROR]: { text: 'Lỗi', cls: 'pill--error' },
    [STATUS.SKIPPED]: { text: 'Bỏ qua', cls: 'pill--idle' },
  };

  /** Trần số dòng dựng ra DOM. Phần dôi ra được NÓI RA, không im lặng cắt. */
  const MAX_RENDER = 200;

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

  /**
   * "Đã vào" và "chưa biết có vào không" là hai kết quả khác nhau, nên chúng là
   * hai thẻ khác màu chứ không phải một chữ "Xong" kèm hậu tố lọt giữa metadata.
   * Toàn bộ ticket này tồn tại vì trước đó chúng trông giống hệt nhau.
   */
  function pillOf(item) {
    if (isUnverified(item)) return { text: 'Chưa xác minh', cls: 'pill--warn' };
    return PILL[item.status] || { text: item.status, cls: 'pill--idle' };
  }

  function itemTitle(item) {
    if (item.title) return item.title;
    return isDoc(item) ? urlLabel(item.url) : item.videoId;
  }

  /* Bộ lọc theo trạng thái. Mặc định 'all' — người mở popup thấy đúng hàng đợi. */
  let filter = 'all';
  const FILTERS = {
    all: () => true,
    pending: (i) => i.status === STATUS.PENDING || i.status === STATUS.EXTRACTING || i.status === STATUS.IMPORTING,
    done: (i) => i.status === STATUS.DONE,
    error: (i) => i.status === STATUS.ERROR,
  };

  function renderChips(counts, total) {
    if (!els.counts) return;
    const specs = [
      { key: 'all', label: 'Tất cả', n: total, cls: '' },
      { key: 'pending', label: 'chờ', n: counts.pending, cls: 'chip--idle' },
      { key: 'done', label: 'xong', n: counts.done, cls: 'chip--done' },
      { key: 'error', label: 'lỗi', n: counts.error, cls: 'chip--error' },
    ];
    els.counts.replaceChildren(
      ...specs
        .filter((s) => s.key === 'all' || s.n > 0)
        .map((s) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `chip ${s.cls}${filter === s.key ? ' is-active' : ''}`.trim();
          b.dataset.filter = s.key;
          b.setAttribute('aria-pressed', String(filter === s.key));
          const num = document.createElement('span');
          num.className = 'chip__n';
          num.textContent = String(s.n);
          b.append(num, document.createTextNode(' ' + s.label));
          b.addEventListener('click', () => {
            filter = filter === s.key ? 'all' : s.key;
            refresh();
          });
          return b;
        })
    );
    els.counts.hidden = total === 0;
  }

  function renderProgress(counts, total, running) {
    if (!els.progress) return;
    const settled = counts.done + counts.error + counts.skipped;
    if (!running || total === 0) {
      els.progress.hidden = true;
      return;
    }
    els.progress.hidden = false;
    const pct = total ? Math.round((settled / total) * 100) : 0;
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${settled}/${total}`;
  }

  function buildItem(item) {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.status = item.status;
    if (item.status === STATUS.DONE && typeof item.verified === 'boolean') {
      li.dataset.verified = String(item.verified);
    }

    const body = document.createElement('div');
    body.className = 'item__body';

    const head = document.createElement('div');
    head.className = 'item__head';

    const title = itemTitle(item);
    const link = document.createElement('a');
    link.className = 'item__title';
    link.href = item.url || canonicalUrl(item.videoId);
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = title;
    link.title = title;

    const pill = pillOf(item);
    const badge = document.createElement('span');
    badge.className = `item__status pill ${pill.cls}`;
    badge.textContent = pill.text;

    head.append(link, badge);
    body.appendChild(head);

    // Metadata thuần: không còn gánh trạng thái, nên nó được phép mờ đi.
    const meta = document.createElement('div');
    meta.className = 'item__meta';
    meta.innerHTML = tagHtml(item);
    const parts = [];
    if (item.site) parts.push(item.site);
    if (item.durationSec) parts.push(fmtTime(item.durationSec));
    const mode = modeText(item);
    if (mode) parts.push(mode);
    if (item.textLength) parts.push(`${Math.round(item.textLength / 1000)}k ký tự`);
    if (parts.length) meta.append(parts.join(' · '));
    if (meta.innerHTML || parts.length) body.appendChild(meta);

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
    remove.setAttribute('aria-label', `Xoá ${title} khỏi hàng đợi`);
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      await withActionLock(async () => {
        await send(MSG.REMOVE, { id: item.id });
        await refresh();
      });
    });

    li.append(body, remove);
    return li;
  }

  function render(state) {
    const { queue, settings, running } = state;

    if (document.activeElement !== els.notebookUrl) {
      els.notebookUrl.value = settings.notebookUrl || '';
    }
    els.notebookHint.textContent = settings.notebookUrl
      ? ''
      : 'Chưa đặt notebook đích — extension sẽ dùng tab NotebookLM nào đang mở sẵn.';

    const raw = queue.reduce((acc, i) => {
      acc[i.status] = (acc[i.status] || 0) + 1;
      return acc;
    }, {});
    const counts = {
      pending: (raw[STATUS.PENDING] || 0) + (raw[STATUS.EXTRACTING] || 0) + (raw[STATUS.IMPORTING] || 0),
      done: raw[STATUS.DONE] || 0,
      error: raw[STATUS.ERROR] || 0,
      skipped: raw[STATUS.SKIPPED] || 0,
    };

    renderChips(counts, queue.length);
    renderProgress(counts, queue.length, running);

    if (els.tabQueueBadge) {
      if (counts.pending > 0) {
        els.tabQueueBadge.textContent = String(counts.pending);
        els.tabQueueBadge.hidden = false;
      } else {
        els.tabQueueBadge.hidden = true;
      }
    }

    els.run.hidden = running;
    els.stop.hidden = !running;
    els.run.disabled = !counts.pending;
    els.retry.disabled = !counts.error;
    els.clearDone.disabled = !counts.done;
    els.clearAll.disabled = !queue.length;
    els.queueMenuBtn.disabled = !queue.length;
    if (!queue.length) closeQueueMenu();
    els.empty.hidden = queue.length > 0;
    // Hàng đợi trống thì thanh công cụ chỉ còn hai nút mờ không bấm được —
    // thẻ trống bên dưới đã có lối đi riêng, nên cất nó đi.
    els.queueHead.hidden = queue.length === 0;

    const shown = queue.slice().reverse().filter(FILTERS[filter] || FILTERS.all);
    els.list.replaceChildren(...shown.slice(0, MAX_RENDER).map(buildItem));

    // Trần dựng DOM phải nhìn thấy được: một danh sách bị cắt im lặng đọc y hệt
    // một danh sách đã hiện đủ.
    if (shown.length > MAX_RENDER) {
      els.listMore.hidden = false;
      els.listMore.textContent = `Còn ${shown.length - MAX_RENDER} mục nữa không hiển thị — hàng đợi vẫn xử lý đủ.`;
    } else if (queue.length && !shown.length) {
      els.listMore.hidden = false;
      els.listMore.textContent = 'Không có mục nào khớp bộ lọc đang chọn.';
    } else {
      els.listMore.hidden = true;
    }

    renderCopied(state.copied);
  }

  /* ---------------------------------------------------------------- */
  /* Sổ đã copy                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * @param {{total: number, rows: Array<{url, at, from}>}} copied service worker
   *   gửi `total` THẬT kèm một lát cắt — xem ghi chú ở `case MSG.GET_STATE`.
   *   Đừng suy `total` ra từ `rows.length`: hai số đó cố ý khác nhau, và lấy
   *   nhầm là con số đếm nói dối đúng lúc Sổ đã lớn.
   */
  function renderCopied(copied) {
    const total = (copied && copied.total) || 0;
    const rows = (copied && copied.rows) || [];

    els.copied.hidden = total === 0;
    if (total === 0) {
      els.copiedList.replaceChildren();
      // Đóng lại: mở sẵn một khu rỗng thì lần sau nó bung ra giữa hàng đợi.
      els.copied.open = false;
      resetClearCopiedBtn();
      return;
    }

    els.copiedCount.textContent = String(total);
    els.copiedList.replaceChildren(...rows.map(buildCopiedRow));

    if (total > rows.length) {
      els.copiedMore.hidden = false;
      els.copiedMore.textContent = `Còn ${total - rows.length} dòng cũ hơn không hiển thị — Sổ vẫn lọc đủ cả ${total}.`;
    } else {
      els.copiedMore.hidden = true;
    }
  }

  function buildCopiedRow(row) {
    const li = document.createElement('li');
    li.className = 'copied__row';

    // Link mở được: Sổ nói "đã copy cái này rồi", và câu hỏi kế tiếp gần như
    // luôn là "cái nào?". Bắt người dùng đọc URL thô để tự trả lời là bắt sai.
    const a = document.createElement('a');
    a.className = 'copied__url';
    a.href = row.url || '';
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = urlLabel(row.url || '');
    a.title = row.url || '';

    const meta = document.createElement('span');
    meta.className = 'copied__meta';
    // `from` là chỗ gom được (playlist/kênh/trang). Rỗng thì bỏ hẳn, đừng in
    // dấu · lẻ loi.
    meta.textContent = [row.at ? fmtTime(row.at) : '', row.from || ''].filter(Boolean).join(' · ');

    li.append(a, meta);
    return li;
  }

  /*
   * Xoá sổ dùng đúng nghi thức hai nhịp của "Xoá hết hàng đợi": Sổ giữ mãi
   * theo thiết kế, nên một cú bấm nhầm ở đây làm mọi link đã copy có thể vào
   * notebook lần thứ hai mà không cách nào lấy lại.
   */
  let clearCopiedTimer = null;
  function resetClearCopiedBtn() {
    if (clearCopiedTimer) clearTimeout(clearCopiedTimer);
    clearCopiedTimer = null;
    if (els.clearCopied) {
      els.clearCopied.textContent = 'Xoá sổ';
      els.clearCopied.classList.remove('is-confirming');
    }
  }

  els.clearCopied.addEventListener('click', async () => {
    if (!clearCopiedTimer) {
      els.clearCopied.textContent = 'Chắc chắn xoá sổ?';
      els.clearCopied.classList.add('is-confirming');
      clearCopiedTimer = setTimeout(resetClearCopiedBtn, 3500);
      return;
    }
    resetClearCopiedBtn();
    await withActionLock(async () => {
      await send(MSG.CLEAR_COPIED);
      refresh();
    });
  });

  async function refresh() {
    const state = await send(MSG.GET_STATE);
    if (state && state.queue) render(state);
  }

  /* ---------------------------------------------------------------- */
  /* ngữ cảnh tab hiện tại                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Ba nút thu gom đều thao tác trên tab đang mở. Trước đây phải bấm mới biết
   * tab đó có dùng được không; giờ trả lời trước khi bấm.
   */
  async function updateTabContext() {
    let url = '';
    let ytTabs = 0;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      url = (tab && tab.url) || '';
      const all = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      ytTabs = (all || []).length;
    } catch (_) {
      /* không đọc được tab thì để nút mở, người dùng bấm sẽ nhận lỗi cụ thể */
    }

    const isWeb = /^https?:/i.test(url);
    const isYouTube = /^https:\/\/(www\.)?youtube\.com\//i.test(url);
    const isListPage = isYouTube && /[?&]list=|\/(channel\/|c\/|user\/|@)/i.test(url);

    setCtx(els.importPlaylist, isListPage, isYouTube
      ? 'Tab hiện tại là YouTube nhưng không phải playlist hay trang kênh.'
      : 'Mở một playlist hoặc trang kênh YouTube rồi bấm lại.');
    setCtx(els.collectTabs, ytTabs > 0, 'Không có tab YouTube nào đang mở.');
    setCtx(els.collectLinks, isWeb, 'Tab hiện tại không phải trang web đọc được.');
    setCtx(els.scanDocs, isWeb, 'Tab hiện tại không phải trang web đọc được.');
    setCtx(els.addCurrent, isWeb, 'Tab hiện tại không phải trang web đọc được.');

    if (els.collectTabs && ytTabs > 0) {
      els.collectTabs.textContent = `Mọi tab YouTube đang mở (${ytTabs})`;
    }
  }

  function setCtx(btn, usable, why) {
    if (!btn) return;
    btn.disabled = !usable;
    btn.title = usable ? '' : why;
  }

  /* ---------------------------------------------------------------- */
  /* sự kiện                                                           */
  /* ---------------------------------------------------------------- */

  els.notebookUrl.addEventListener('change', async () => {
    await globalThis.NBLM.setSettings({ notebookUrl: els.notebookUrl.value.trim() });
    refresh();
  });

  els.useCurrent.addEventListener('click', async () => {
    await withActionLock(async () => {
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
  });

  els.notebookRefresh.addEventListener('click', () => withActionLock(napDanhSach));

  /*
   * Đổi tài khoản thì nạp lại danh sách notebook NGAY, không đợi owner bấm ↻:
   * để nguyên danh sách cũ bên dưới một tài khoản mới là nói dối bằng giao
   * diện — owner sẽ chọn một notebook không thuộc tài khoản đang hiện.
   */
  els.accountSelect.addEventListener('change', () =>
    withActionLock(async () => {
      const email = els.accountSelect.value;
      try {
        await send(MSG.SELECT_ACCOUNT, { email });
      } catch (_) {
        return;
      }
      // Chỉ xoá Ô hiển thị. Phần XUỐNG ĐĨA do `doiTaiKhoan()` bên service
      // worker lo — nó là chỗ duy nhất biết đổi tài khoản kéo theo những gì,
      // nên trang Cài đặt đổi tài khoản cũng được dọn y hệt. Ghi lại ở đây nữa
      // thì hai cơ chế cùng giữ một luật, và hoán vị chỗ nào cũng xanh.
      els.notebookUrl.value = '';
      await napDanhSach();
    })
  );

  /* Bỏ chọn tài khoản: gửi email rỗng, service worker quy về `null`. Đó là
     cùng một đường với đổi tài khoản, nên `doiTaiKhoan()` dọn y hệt. */
  els.accountClear.addEventListener('click', () =>
    withActionLock(async () => {
      try {
        await send(MSG.SELECT_ACCOUNT, { email: '' });
      } catch (_) {
        return;
      }
      els.notebookUrl.value = '';
      await napDanhSach();
    })
  );

  els.notebookSelect.addEventListener('change', async () => {
    const v = els.notebookSelect.value;
    if (!v) return;
    if (v === TAO_MOI) {
      moKhungTao(true);
      els.notebookSelect.value = '';
      return;
    }
    moKhungTao(false);
    await withActionLock(async () => {
      await datNotebook(v);
      refresh();
    });
  });

  els.notebookCreateCancel.addEventListener('click', () => moKhungTao(false));

  /*
   * LƯỢT GHI DUY NHẤT của popup này. Bốn ràng buộc từ ticket 011, và cả bốn đều
   * nhìn thấy được ngay ở đây:
   *   - chỉ chạy khi owner bấm nút này (không có lối gọi nào khác);
   *   - tên rỗng thì DỪNG, không tự đặt tên;
   *   - `notebookUrl` do background ghi ngay khi có id thật;
   *   - chạm trần quota có câu riêng, không lẫn vào "lỗi".
   */
  async function taoNotebook() {
    const name = els.notebookName.value.trim();
    if (!name) {
      els.notebookHint.textContent = 'Đặt tên cho notebook mới trước đã.';
      els.notebookName.focus();
      return;
    }
    els.notebookCreateGo.disabled = true;
    els.notebookHint.textContent = 'Đang tạo notebook…';
    let r = null;
    try {
      r = await send(MSG.CREATE_NOTEBOOK, { title: name });
    } catch (_) {
      r = null;
    }
    els.notebookCreateGo.disabled = false;

    if (r && r.ok && r.url) {
      moKhungTao(false);
      els.notebookUrl.value = r.url;
      els.notebookHint.textContent = `Đã tạo “${name}” và đặt làm notebook đích.`;
      await napDanhSach();
      refresh();
      return;
    }
    if (r && r.limit) {
      els.notebookHint.textContent =
        'Tài khoản đã chạm trần số notebook của NotebookLM. Xoá bớt notebook rồi thử lại.';
      return;
    }
    if (r && r.status === 'created-but-no-id') {
      // Notebook ĐÃ tồn tại trên tài khoản. Nói ra, vì "thử lại" ở đây sẽ tạo
      // cái thứ hai — đúng chế độ hỏng tích luỹ mà ticket 011 cảnh báo.
      els.notebookHint.textContent =
        'Notebook có thể đã được tạo nhưng không đọc được id. Bấm ↻ để kiểm trước khi tạo lại.';
      return;
    }
    if (r && r.needsTab) {
      els.notebookHint.textContent = 'Chưa có tab NotebookLM nào đang mở. Mở nó rồi thử lại.';
      return;
    }
    els.notebookHint.textContent = 'Không tạo được notebook. Bấm ↻ để kiểm trước khi thử lại.';
  }

  els.notebookCreateGo.addEventListener('click', () => withActionLock(taoNotebook));
  els.notebookName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      withActionLock(taoNotebook);
    }
  });

  els.bulk.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      els.addBulk.click();
    }
  });

  /**
   * Nhãn nút đếm theo đúng số link đọc được, chứ không phải số dòng đã gõ:
   * dán 30 dòng mà chỉ 12 dòng là link YouTube thì con số phải nói ra điều đó.
   */
  let bulkCap = 0;
  async function loadBulkCap() {
    try {
      const s = await globalThis.NBLM.getSettings();
      bulkCap = Number(s && s.maxBulkVideos) || 0;
    } catch (_) {
      bulkCap = 0;
    }
    updateBulkCount();
  }

  function updateBulkCount() {
    if (!els.addBulk) return;
    const n = parseUrlList(els.bulk.value).length;
    els.addBulk.textContent = n ? `Thêm ${n} link vào hàng đợi` : 'Thêm vào hàng đợi';
    els.addBulk.disabled = n === 0;

    if (!els.bulkHint) return;
    const capText = bulkCap ? `Trần quét hàng loạt hiện đặt ở ${bulkCap} video (đổi trong Cài đặt).` : '';
    const lines = els.bulk.value.split('\n').filter((l) => l.trim()).length;
    if (n === 0) {
      els.bulkHint.textContent = lines
        ? `Không đọc được link YouTube nào trong ${lines} dòng đã dán. ${capText}`.trim()
        : capText;
      els.bulkHint.classList.toggle('error', lines > 0);
      return;
    }
    els.bulkHint.classList.remove('error');
    const bo = lines > n ? ` · bỏ qua ${lines - n} dòng không phải link YouTube` : '';
    els.bulkHint.textContent = `${n} link đọc được${bo}. ${capText}`.trim();
  }

  els.bulk.addEventListener('input', updateBulkCount);

  els.addBulk.addEventListener('click', async () => {
    const ids = parseUrlList(els.bulk.value);
    if (!ids.length) {
      els.bulk.focus();
      return;
    }
    await withActionLock(async () => {
      await send(MSG.ENQUEUE, { items: ids.map((videoId) => ({ videoId })), autoRun: false });
      els.bulk.value = '';
      updateBulkCount();
      switchTab('queue');
      refresh();
    });
  });

  // "Thêm tab hiện tại" phục vụ cả hai loại nguồn: là video thì đi đường video,
  // còn lại coi như một trang tài liệu.
  els.addCurrent.addEventListener('click', async () => {
    await withActionLock(async () => {
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
      switchTab('queue');
      refresh();
    });
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
      if ((res.added || 0) > 0) {
        switchTab('queue');
      }
    } finally {
      button.textContent = original;
      // Trả nút về đúng trạng thái theo ngữ cảnh tab, không bật lại tất cả.
      await updateTabContext();
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

  els.run.addEventListener('click', () => withActionLock(async () => {
    await send(MSG.RUN);
    refresh();
  }));

  els.stop.addEventListener('click', () => withActionLock(async () => {
    await send(MSG.STOP);
    refresh();
  }));

  els.retry.addEventListener('click', () => withActionLock(async () => {
    closeQueueMenu();
    await send(MSG.RETRY, {});
    refresh();
  }));

  els.clearDone.addEventListener('click', () => withActionLock(async () => {
    closeQueueMenu();
    await send(MSG.CLEAR_DONE);
    refresh();
  }));

  els.clearAll.addEventListener('click', async () => {
    if (!clearAllTimer) {
      els.clearAll.textContent = 'Chắc chắn xoá?';
      els.clearAll.classList.add('is-confirming');
      clearAllTimer = setTimeout(resetClearAllBtn, 3500);
      return;
    }
    resetClearAllBtn();
    closeQueueMenu();
    await withActionLock(async () => {
      await send(MSG.CLEAR_ALL);
      refresh();
    });
  });

  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === MSG.STATE_CHANGED) refresh();
  });

  // Trạng thái đổi trong lúc popup mở (ví dụ đang chạy hàng đợi).
  setInterval(refresh, 1500);
  refresh();
  updateTabContext();
  loadBulkCap();
})();
