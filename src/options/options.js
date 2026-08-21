/* Trang cài đặt. */
(() => {
  'use strict';

  const { DEFAULTS, getSettings, setSettings } = globalThis.NBLM;
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
  };

  async function load() {
    const settings = await getSettings();
    for (const [key, field] of Object.entries(FIELDS)) field.write(field.el(), settings[key]);
  }

  async function save() {
    const status = $('jsonStatus');
    const patch = {};
    for (const [key, field] of Object.entries(FIELDS)) {
      try {
        patch[key] = field.read(field.el());
      } catch (e) {
        status.textContent = `JSON ghi đè selector không hợp lệ: ${(e && e.message) || e}`;
        status.classList.add('error');
        return;
      }
    }
    status.textContent = '';
    status.classList.remove('error');
    await setSettings(patch);

    const saved = $('saved');
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 2000);
  }

  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', async () => {
    await setSettings(Object.assign({}, DEFAULTS));
    await load();
  });

  // Kiểm tra JSON ngay khi gõ, đỡ phải bấm Lưu mới biết sai.
  $('selectorOverrides').addEventListener('input', (e) => {
    const status = $('jsonStatus');
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

  load();
})();
