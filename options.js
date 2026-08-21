// Trang Cài đặt — nơi sửa được nhãn và selector khi Google đổi giao diện, mà không phải sửa
// code (ticket 004).
//
// Ghi đè *gộp thêm* vào mặc định và đứng trước, chứ không thay thế: một ghi đè cho `addSource`
// mà thay thế hẳn sẽ vứt luôn mọi nhãn tiếng Anh lẫn tiếng Việt đang chạy tốt, và người dùng
// chỉ biết điều đó khi giao diện đổi lần sau.
//
// Phần chạm `chrome.*` nằm hết trong hàm và chỉ khởi động khi có `document`, nên test nạp được
// file này ngoài trình duyệt để gọi thẳng phần thuần (`test/settings.test.js`).
(function (root) {
  'use strict';

  if (root.NBLM_OPTIONS) return;

  const S = root.NBLM_SHARED;
  if (!S) throw new Error('options: cần src/common/shared.js nạp trước');

  const FIELD_PREFIX = `${S.EXT_PREFIX}opt-`;
  /** Một khoá trong `chrome.storage.sync`, giữ cả bộ cài đặt. */
  const STORAGE_KEY = 'settings';

  /** Mỗi setting của `DEFAULTS` phải có một ô nhập — `test/settings.test.js` canh đúng chuyện đó. */
  const SETTING_KEYS = Object.freeze(Object.keys(S.DEFAULTS));
  /** Hai bộ ghi đè: nhãn (chữ hiển thị) và selector CSS. Gộp chung là hạ chữ thường cả CSS. */
  const OVERRIDE_KEYS = Object.freeze(['labelOverrides', 'selectorOverrides']);

  const fieldId = (key) => `${FIELD_PREFIX}${key}`;
  const STATUS_ID = 'nblm-opt-status';
  const SAVE_ID = 'nblm-opt-save';
  const RESET_ID = 'nblm-opt-reset';

  const defaultSettings = () => ({ ...S.DEFAULTS, labelOverrides: {}, selectorOverrides: {} });

  // ------------------------------------------------------------ phần thuần

  /**
   * Đọc một bộ ghi đè từ chữ người dùng gõ.
   *
   * Nuốt lỗi ở đây là kiểu hỏng tệ nhất của cả trang này: người dùng gõ sai một dấu phẩy, bấm
   * Lưu, thấy báo "đã lưu", rồi ngồi đợi một ghi đè không bao giờ có tác dụng. Nên sai cú pháp
   * là **từ chối lưu** và nói ra sai ở đâu.
   */
  function parseOverrides(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: true, value: {} };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { ok: false, error: `JSON không đọc được — ${error.message}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'phải là một object dạng { "tên nhóm": ["…", "…"] }' };
    }

    const value = {};
    const bad = [];
    for (const [key, list] of Object.entries(parsed)) {
      if (Array.isArray(list) && list.every((item) => typeof item === 'string')) {
        value[key] = list.map((item) => item.trim()).filter(Boolean);
      } else {
        bad.push(key);
      }
    }
    if (bad.length > 0) return { ok: false, error: `mỗi nhóm phải là một mảng chuỗi — sai ở: ${bad.join(', ')}` };
    return { ok: true, value };
  }

  const formatOverrides = (value) => {
    const map = value && typeof value === 'object' ? value : {};
    return Object.keys(map).length === 0 ? '' : JSON.stringify(map, null, 2);
  };

  /**
   * Hình dạng mà `resolve()` của mỗi lớp selector nhận: nhóm CSS ở ngoài, nhãn nằm dưới
   * `labels`. Đây là chỗ duy nhất biết cách nối trang Cài đặt với bộ selector — nếu không,
   * mỗi content script lại tự đoán một kiểu.
   */
  function overridesFrom(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const css = s.selectorOverrides && typeof s.selectorOverrides === 'object' ? s.selectorOverrides : {};
    const labels = s.labelOverrides && typeof s.labelOverrides === 'object' ? s.labelOverrides : {};
    return { ...css, labels };
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /** Bộ cài đặt đọc từ storage có thể thiếu khoá hoặc sai kiểu — vá lại bằng mặc định. */
  function normalizeSettings(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    const out = defaultSettings();
    for (const key of SETTING_KEYS) {
      if (s[key] == null) continue;
      out[key] = typeof S.DEFAULTS[key] === 'number' ? toNumber(s[key], S.DEFAULTS[key]) : String(s[key]);
    }
    for (const key of OVERRIDE_KEYS) {
      if (s[key] && typeof s[key] === 'object' && !Array.isArray(s[key])) out[key] = s[key];
    }
    return out;
  }

  // -------------------------------------------------------------- phần DOM

  function byId(doc, id) {
    const node = doc.getElementById(id);
    if (!node) throw new Error(`options: trang Cài đặt thiếu ô "#${id}"`);
    return node;
  }

  function fillForm(doc, settings) {
    const values = normalizeSettings(settings);
    for (const key of SETTING_KEYS) byId(doc, fieldId(key)).value = String(values[key]);
    for (const key of OVERRIDE_KEYS) byId(doc, fieldId(key)).value = formatOverrides(values[key]);
  }

  /** Trả `{ ok: false, error }` thay vì ném: lỗi ở đây là lỗi của người gõ, không phải của code. */
  function readForm(doc) {
    const out = defaultSettings();
    for (const key of SETTING_KEYS) {
      const raw = byId(doc, fieldId(key)).value;
      out[key] = typeof S.DEFAULTS[key] === 'number'
        ? toNumber(raw, S.DEFAULTS[key])
        : S.collapse(raw) || S.DEFAULTS[key];
    }
    for (const key of OVERRIDE_KEYS) {
      const parsed = parseOverrides(byId(doc, fieldId(key)).value);
      if (!parsed.ok) return { ok: false, error: `${key}: ${parsed.error}` };
      out[key] = parsed.value;
    }
    return { ok: true, value: out };
  }

  /** Gợi ý dựng từ chính bộ mặc định đang chạy — trang này không tự viết lại selector nào. */
  function fillPlaceholders(doc) {
    const NB = root.NBLM_NB_SELECTORS;
    if (!NB) return;
    const firstOf = (groups) => {
      const sample = {};
      for (const [key, list] of Object.entries(groups)) if (list.length > 0) sample[key] = [list[0]];
      return sample;
    };
    byId(doc, fieldId('labelOverrides')).placeholder = formatOverrides(firstOf(NB.DEFAULT_LABELS));
    byId(doc, fieldId('selectorOverrides')).placeholder = formatOverrides(firstOf(NB.DEFAULT_SELECTORS));
  }

  // ---------------------------------------------------------------- storage

  const storage = () => root.chrome && root.chrome.storage && root.chrome.storage.sync;

  async function load() {
    const area = storage();
    if (!area) return defaultSettings();
    const bag = await area.get(STORAGE_KEY);
    return normalizeSettings(bag && bag[STORAGE_KEY]);
  }

  async function save(settings) {
    const area = storage();
    if (!area) throw new Error('options: không có chrome.storage.sync để lưu');
    await area.set({ [STORAGE_KEY]: settings });
  }

  function init(doc) {
    const status = byId(doc, STATUS_ID);
    const say = (text, state) => {
      status.textContent = text;
      if (state) status.setAttribute('data-state', state);
      else status.removeAttribute('data-state');
    };

    fillPlaceholders(doc);
    load().then((settings) => fillForm(doc, settings)).catch((error) => say(String(error.message), 'error'));

    byId(doc, SAVE_ID).addEventListener('click', () => {
      const read = readForm(doc);
      if (!read.ok) {
        say(`Chưa lưu — ${read.error}`, 'error');
        return;
      }
      save(read.value).then(() => say('Đã lưu.')).catch((error) => say(String(error.message), 'error'));
    });

    byId(doc, RESET_ID).addEventListener('click', () => {
      fillForm(doc, defaultSettings());
      say('Đã đưa về mặc định — bấm Lưu để áp dụng.');
    });
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => init(root.document));
    } else {
      init(root.document);
    }
  }

  root.NBLM_OPTIONS = Object.freeze({
    FIELD_PREFIX,
    STORAGE_KEY,
    SETTING_KEYS,
    OVERRIDE_KEYS,
    STATUS_ID,
    SAVE_ID,
    RESET_ID,
    fieldId,
    defaultSettings,
    parseOverrides,
    formatOverrides,
    overridesFrom,
    normalizeSettings,
    fillForm,
    readForm,
    init,
    load,
    save,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
