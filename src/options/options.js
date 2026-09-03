/* Trang cài đặt. */
(() => {
  'use strict';

  const { DEFAULTS, getSettings, setSettings, getDomReports, clearDomReports } = globalThis.NBLM;
  const $ = (id) => document.getElementById(id);

  const FIELDS = {
    notebookUrl: { el: () => $('notebookUrl'), read: (el) => el.value.trim(), write: (el, v) => (el.value = v || '') },
    preferredLangs: {
      el: () => $('preferredLangs'),
      read: (el) => el.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      write: (el, v) => (el.value = (v || []).join(', ')),
    },
    includeTimestamps: { el: () => $('includeTimestamps'), read: (el) => el.checked, write: (el, v) => (el.checked = !!v) },
    groupSeconds: {
      el: () => $('groupSeconds'),
      read: (el) => Math.max(0, Number(el.value) || 0),
      write: (el, v) => (el.value = Number(v) || 0),
    },
    unlistedMode: { el: () => $('unlistedMode'), read: (el) => el.value, write: (el, v) => (el.value = v) },
    publicFallbackToTranscript: {
      el: () => $('publicFallbackToTranscript'),
      read: (el) => el.checked,
      write: (el, v) => (el.checked = !!v),
    },
    delayMs: {
      el: () => $('delayMs'),
      read: (el) => Math.max(300, Number(el.value) || DEFAULTS.delayMs),
      write: (el, v) => (el.value = Number(v) || DEFAULTS.delayMs),
    },
    autoCloseTabs: { el: () => $('autoCloseTabs'), read: (el) => el.checked, write: (el, v) => (el.checked = !!v) },
    bulkSelectUI: { el: () => $('bulkSelectUI'), read: (el) => el.checked, write: (el, v) => (el.checked = !!v) },
    saveTranscriptCopy: {
      el: () => $('saveTranscriptCopy'),
      read: (el) => el.checked,
      write: (el, v) => (el.checked = !!v),
    },
    downloadFormat: { el: () => $('downloadFormat'), read: (el) => el.value, write: (el, v) => (el.value = v || 'txt') },
    downloadSubfolder: {
      el: () => $('downloadSubfolder'),
      read: (el) => el.value.trim(),
      write: (el, v) => (el.value = v == null ? '' : v),
    },
    maxBulkVideos: {
      el: () => $('maxBulkVideos'),
      read: (el) => Math.max(1, Number(el.value) || DEFAULTS.maxBulkVideos),
      write: (el, v) => (el.value = Number(v) || DEFAULTS.maxBulkVideos),
    },

    docsLauncher: { el: () => $('docsLauncher'), read: (el) => el.checked, write: (el, v) => (el.checked = !!v) },
    docsMode: { el: () => $('docsMode'), read: (el) => el.value, write: (el, v) => (el.value = v) },
    docsKeepLinks: { el: () => $('docsKeepLinks'), read: (el) => el.checked, write: (el, v) => (el.checked = !!v) },
    docsKeepImages: { el: () => $('docsKeepImages'), read: (el) => el.checked, write: (el, v) => (el.checked = !!v) },
    docsMaxChars: {
      el: () => $('docsMaxChars'),
      read: (el) => Math.max(0, Number(el.value) || 0),
      write: (el, v) => (el.value = Number(v) || 0),
    },
    docsMinChars: {
      el: () => $('docsMinChars'),
      read: (el) => Math.max(0, Number(el.value) || 0),
      write: (el, v) => (el.value = Number(v) || 0),
    },
    selectorOverrides: {
      el: () => $('selectorOverrides'),
      read: (el) => {
        const raw = el.value.trim();
        if (!raw) return null;
        return JSON.parse(raw); // lỗi cú pháp được bắt ở save()
      },
      write: (el, v) => (el.value = v ? JSON.stringify(v, null, 2) : ''),
    },

    rpcEnabled: { el: () => $('rpcEnabled'), read: (el) => el.checked, write: (el, v) => (el.checked = !!v) },
    rpcOverrides: {
      el: () => $('rpcOverrides'),
      read: (el) => {
        const raw = el.value.trim();
        if (!raw) return null;
        return JSON.parse(raw); // như selectorOverrides: lỗi cú pháp bắt ở save()
      },
      write: (el, v) => (el.value = v ? JSON.stringify(v, null, 2) : ''),
    },

    /* Chuẩn hoá về chữ thường ở ĐÚNG MỘT chỗ — service worker so khớp email
       bằng chữ thường, nên lưu hoa thường lẫn lộn là lỡ một cách im lặng. */
    nlmAccount: {
      el: () => $('nlmAccount'),
      read: (el) => el.value.trim().toLowerCase() || null,
      write: (el, v) => (el.value = v || ''),
    },
    accountOverrides: {
      el: () => $('accountOverrides'),
      read: (el) => {
        const raw = el.value.trim();
        if (!raw) return null;
        return JSON.parse(raw); // như rpcOverrides: lỗi cú pháp bắt ở save()
      },
      write: (el, v) => (el.value = v ? JSON.stringify(v, null, 2) : ''),
    },
  };

  /* Mỗi ô JSON có dòng báo lỗi của riêng nó — ba ô, ba chỗ đọc kết quả. */
  const JSON_STATUS = {
    selectorOverrides: 'jsonStatus',
    rpcOverrides: 'rpcJsonStatus',
    accountOverrides: 'accountJsonStatus',
  };

  /* ------------------------------------------------------------------ */
  /* theo dõi thay đổi chưa lưu                                          */
  /* ------------------------------------------------------------------ */

  /**
   * So sánh giá trị THÔ của ô nhập, không qua read(): ô JSON đang gõ dở vẫn phải
   * đếm được là "đã đổi", chứ không ném lỗi parse giữa lúc đếm.
   */
  const rawOf = (el) => (el.type === 'checkbox' ? String(el.checked) : el.value);

  let baseline = {};

  function snapshot() {
    const s = {};
    for (const key of Object.keys(FIELDS)) s[key] = rawOf(FIELDS[key].el());
    return s;
  }

  function dirtyKeys() {
    return Object.keys(FIELDS).filter((key) => rawOf(FIELDS[key].el()) !== baseline[key]);
  }

  function updateDirty() {
    const n = dirtyKeys().length;
    const bar = $('savebar');
    bar.hidden = n === 0;
    // Nói rõ phạm vi: một nút Lưu cho cả ba tab, không phải chỉ tab đang mở.
    $('dirtyCount').textContent = n
      ? `${n} thay đổi chưa lưu (trên cả ba tab)`
      : '';
    $('save').disabled = n === 0;
  }

  async function load() {
    const settings = await getSettings();
    for (const [key, field] of Object.entries(FIELDS)) field.write(field.el(), settings[key]);
    baseline = snapshot();
    updateDirty();
  }

  async function save() {
    const patch = {};
    for (const [key, field] of Object.entries(FIELDS)) {
      try {
        patch[key] = field.read(field.el());
      } catch (e) {
        // Gọi tên đúng ô đang hỏng, VÀ mở đúng tab chứa nó: dòng báo lỗi nằm dưới
        // một ô cụ thể, mà ô đó có thể đang nằm trong tab người dùng không mở.
        const statusId = JSON_STATUS[key];
        const status = statusId ? $(statusId) : $('jsonStatus');
        status.textContent = `JSON ở ô "${key}" không hợp lệ: ${(e && e.message) || e}`;
        status.classList.add('error');
        showTabOf(field.el());
        field.el().focus();
        return;
      }
    }
    clearJsonStatus('selectorOverrides');
    clearJsonStatus('rpcOverrides');
    await setSettings(patch);

    baseline = snapshot();
    updateDirty();

    const saved = $('saved');
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 2000);
  }

  function clearJsonStatus(key) {
    const status = $(JSON_STATUS[key]);
    if (!status) return;
    status.textContent = '';
    status.classList.remove('error');
  }

  /* ------------------------------------------------------------------ */
  /* bản chụp cấu trúc DOM                                               */
  /* ------------------------------------------------------------------ */

  const KHONG_CO =
    'Chưa có bản chụp nào — extension chỉ ghi khi nó không tìm được ô nhập, nút xác nhận,\n' +
    'hoặc danh sách Nguồn trên giao diện NotebookLM.';

  async function loadDomReports() {
    const reports = await getDomReports();
    const situations = Object.keys(reports);
    // Một chỗ dựng chữ, một chỗ hiện chữ: nút Sao chép đọc lại từ chính phần tử
    // đang hiện, nên không có cách nào chép ra thứ khác với thứ bạn đang đọc.
    $('domReports').textContent = situations.length ? JSON.stringify(reports, null, 2) : KHONG_CO;
    $('domReportsStatus').textContent = situations.length
      ? `${situations.length} tình huống: ${situations.join(', ')}`
      : '';
    $('copyDomReports').disabled = situations.length === 0;
    $('clearDomReports').disabled = situations.length === 0;
  }

  $('copyDomReports').addEventListener('click', async () => {
    const status = $('domReportsStatus');
    try {
      await navigator.clipboard.writeText($('domReports').textContent);
      status.textContent = 'Đã sao chép bản chụp vào clipboard.';
      status.classList.remove('error');
    } catch (e) {
      // Clipboard API từ chối khi trang không được focus — nói ra đường thủ công
      // thay vì im lặng để người dùng tưởng đã chép được.
      status.textContent = `Không sao chép được (${(e && e.message) || e}) — bôi đen đoạn trên rồi Ctrl+C.`;
      status.classList.add('error');
    }
  });

  $('clearDomReports').addEventListener('click', async () => {
    await clearDomReports();
    await loadDomReports();
  });

  /* ------------------------------------------------------------------ */
  /* thanh Lưu                                                           */
  /* ------------------------------------------------------------------ */

  $('save').addEventListener('click', save);

  $('discard').addEventListener('click', async () => {
    // "Bỏ thay đổi" chỉ trả về giá trị ĐANG LƯU, không đụng tới mặc định.
    await load();
    clearJsonStatus('selectorOverrides');
    clearJsonStatus('rpcOverrides');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!$('save').disabled) save();
    }
    if (e.key === 'Escape') resetBtn();
  });

  /* ------------------------------------------------------------------ */
  /* vùng nguy hiểm                                                      */
  /* ------------------------------------------------------------------ */

  let resetTimer = null;
  function resetBtn() {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = null;
    const btn = $('reset');
    btn.textContent = 'Khôi phục mặc định';
    btn.classList.remove('is-confirming');
  }

  $('reset').addEventListener('click', async () => {
    const btn = $('reset');
    if (!resetTimer) {
      btn.textContent = 'Chắc chắn khôi phục?';
      btn.classList.add('is-confirming');
      resetTimer = setTimeout(resetBtn, 4000);
      return;
    }
    resetBtn();
    await setSettings(Object.assign({}, DEFAULTS));
    await load();
  });

  /* ------------------------------------------------------------------ */
  /* kiểm tra JSON ngay khi gõ                                           */
  /* ------------------------------------------------------------------ */

  for (const key of Object.keys(JSON_STATUS)) {
    FIELDS[key].el().addEventListener('input', (e) => {
      const status = $(JSON_STATUS[key]);
      const raw = e.target.value.trim();
      if (!raw) {
        status.textContent = '';
        status.classList.remove('error');
        return;
      }
      try {
        JSON.parse(raw);
        status.textContent = 'JSON hợp lệ.';
        status.classList.remove('error');
      } catch (err) {
        status.textContent = `JSON không hợp lệ: ${err.message}`;
        status.classList.add('error');
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* điều hướng tab                                                      */
  /* ------------------------------------------------------------------ */

  const tabButtons = [...document.querySelectorAll('.opt-tab')];
  const tabPanels = [...document.querySelectorAll('.opt-panel')];

  function showTab(btn) {
    tabButtons.forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
    });
    const targetId = btn.getAttribute('data-target');
    tabPanels.forEach((panel) => {
      panel.hidden = panel.id !== targetId;
    });
  }

  /** Đưa người dùng tới đúng tab chứa một ô nhập (dùng khi báo lỗi lúc Lưu). */
  function showTabOf(el) {
    const panel = el.closest('.opt-panel');
    if (!panel) return;
    const btn = tabButtons.find((b) => b.getAttribute('data-target') === panel.id);
    if (btn) showTab(btn);
  }

  tabButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => showTab(btn));
    btn.addEventListener('keydown', (e) => {
      const last = tabButtons.length - 1;
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      if (next === null) return;
      e.preventDefault();
      showTab(tabButtons[next]);
      tabButtons[next].focus();
    });
  });

  /* Mọi ô nhập đều có thể làm trang "bẩn" — bắt ở tầng document, không gắn tay. */
  document.addEventListener('input', updateDirty);
  document.addEventListener('change', updateDirty);

  load();
  loadDomReports();
})();
