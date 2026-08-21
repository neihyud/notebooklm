// MỌI selector và nhãn của NotebookLM nằm ở đây — và chỉ ở đây.
//
// NotebookLM bản consumer không có API công khai, nên toàn bộ đường đẩy dựa trên giao diện của
// một sản phẩm Google có thể đổi bất cứ lúc nào. Đó là lý do file này tồn tại và là lý do
// `WORKSPACE_PROTOCOL.md` coi một selector nằm ngoài đây là nợ không trả được:
// `test/notebooklm.test.js` canh chuyện đó.
//
// File **riêng** của lớp NotebookLM, không gom chung với `src/youtube/selectors.js`: hai file
// nạp trên hai tab khác nhau, gom lại là nạp selector của lớp này vào tab của lớp kia.
//
// Hai nhóm tách hẳn nhau vì cách gộp ghi đè khác nhau:
//   - `selectors`: chuỗi CSS, giữ nguyên chữ hoa và dấu. `[role="dialog"]` mà bị hạ chữ
//     thường hay bỏ ngoặc là hỏng câm.
//   - `labels`: chữ hiển thị, luôn bỏ dấu và hạ chữ thường để khớp mờ (spec 0001).
//
// Classic script như `src/common/shared.js` — content script của MV3 không nạp `import`.
(function (root) {
  'use strict';

  if (root.NBLM_NB_SELECTORS) return;

  const S = root.NBLM_SHARED;
  if (!S) throw new Error('notebooklm/selectors: cần src/common/shared.js nạp trước');

  const DEFAULT_SELECTORS = Object.freeze({
    /** Hộp thoại thêm nguồn. Angular Material dựng nó ở cuối `<body>`, ngoài cây của trang. */
    dialog: ['mat-dialog-container', '.mat-mdc-dialog-container', '[role="dialog"]'],
    /** Ứng viên để khớp theo chữ hiển thị: gồm cả wrapper, vì chữ hay nằm ở wrapper. */
    clickable: [
      'button', 'a', '[role="button"]', '[role="option"]', '[role="menuitem"]', '[role="tab"]',
      'mat-chip', 'mat-chip-option', '.mat-mdc-chip',
    ],
    /** Phần tử thật sự nhận cú bấm. Wrapper **không** nằm trong danh sách này. */
    pressable: [
      'button', 'a', '[role="button"]', '[role="option"]', '[role="menuitem"]', '[role="tab"]',
      'mat-chip', 'mat-chip-option',
    ],
    /**
     * Ô nội dung của Nguồn. Không có `[contenteditable]` ở đây: `setNativeValue` gán qua
     * value accessor, mà một khối contenteditable không có `value` nào để gán.
     */
    textInput: ['textarea'],
    /** Ô tiêu đề Nguồn — khác kiểu phần tử với ô nội dung, để hai thứ không đổi chỗ cho nhau. */
    titleInput: ['input[formcontrolname="title"]', 'input[type="text"]'],
    /**
     * Phần tử **chuyên** báo lỗi. Danh sách này cố ý hẹp: quét toàn bộ chữ trong hộp thoại sẽ
     * đọc trúng những dòng bình thường như bộ đếm "Source limit 3/50" và huỷ oan một lần
     * import đang chạy tốt (spec 0001).
     */
    error: ['mat-error', '.mat-mdc-form-field-error', '[role="alert"]'],
    /**
     * Khay thông báo cuối màn hình. Nó mang **cả** tin mừng lẫn tin dữ, nên một mình nó không
     * phải dấu hiệu lỗi: chỉ khay `assertive` (`[role="alert"]`, xem `error`) mới là lỗi, còn
     * `[role="status"]` là thông báo trạng thái.
     */
    snackbar: ['mat-snack-bar-container', '.mat-mdc-snack-bar-container', '.mdc-snackbar'],
    /** Nút còn mờ: Angular Material bỏ qua cú bấm vào nó, im lặng và không báo gì. */
    disabled: ['[disabled]', '[aria-disabled="true"]', '.mat-mdc-button-disabled'],
  });

  /**
   * Nhãn xếp theo **thứ tự ưu tiên**, không phải theo thứ tự chữ cái: `findByLabel` duyệt
   * nhãn ở vòng ngoài nên nhãn đứng trước luôn thắng, bất kể phần tử nào đứng trước trong DOM.
   * Vì thế `"add source"` phải nằm trên `"add"` — đảo hai dòng ấy là bấm nhầm nút.
   *
   * Nhãn dưới 4 ký tự chỉ khớp **chính xác** (`add` không được ăn vào "Add-ons").
   */
  const DEFAULT_LABELS = Object.freeze({
    addSource: ['add source', 'them nguon', 'new source', 'nguon moi', 'add', 'them'],
    pasteChip: ['copied text', 'van ban da sao chep', 'paste text', 'dan van ban', 'van ban thuan', 'text'],
    submit: ['insert', 'chen', 'add source', 'them nguon', 'save', 'luu', 'add', 'them'],
  });

  /** Selector loại trừ giao diện của chính extension. Suy từ `EXT_PREFIX`, không viết tay lại. */
  const OWN_UI = `[id^="${S.EXT_PREFIX}"]`;

  const asList = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : []);

  /**
   * Gộp ghi đè của người dùng *thêm vào* mặc định, ghi đè đứng trước — cùng quy tắc với
   * `mergeSelectorOverrides` của Seam 1. Thay thế hẳn là sai: một ghi đè cho `addSource` sẽ
   * vứt luôn mọi nhãn tiếng Anh lẫn tiếng Việt đang chạy tốt.
   */
  function resolve(overrides) {
    const over = overrides && typeof overrides === 'object' ? overrides : {};
    const selectors = {};
    for (const key of Object.keys(DEFAULT_SELECTORS)) {
      selectors[key] = S.dedupe([...asList(over[key]), ...DEFAULT_SELECTORS[key]]);
    }
    const labels = S.mergeSelectorOverrides(DEFAULT_LABELS, over.labels);

    return Object.freeze({
      OWN_UI,
      selectors: Object.freeze(selectors),
      labels: Object.freeze(labels),
      /** Chuỗi CSS ghép sẵn cho `querySelectorAll` — thứ tự tài liệu do DOM quyết, không do đây. */
      css(key) {
        const list = selectors[key];
        if (!list) throw new Error(`notebooklm/selectors: không có nhóm selector "${key}"`);
        return list.join(', ');
      },
      label(key) {
        return labels[key] || [];
      },
    });
  }

  const DEFAULT = resolve(null);

  root.NBLM_NB_SELECTORS = Object.freeze({
    OWN_UI,
    DEFAULT_SELECTORS,
    DEFAULT_LABELS,
    DEFAULT,
    resolve,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
