/*
 * Từ điển nhãn + selector cho giao diện NotebookLM.
 *
 * NotebookLM là app Angular Material và Google đổi DOM khá thường xuyên, nên
 * mọi thứ dễ vỡ đều gom hết vào đây. Cách so khớp chính là theo *chữ hiển thị*
 * (aria-label / textContent) đã bỏ dấu, nên vẫn chạy khi class name đổi và
 * hoạt động với cả giao diện tiếng Anh lẫn tiếng Việt.
 *
 * Người dùng ghi đè được ở trang Options bằng JSON có cùng cấu trúc — các
 * mảng sẽ được *gộp thêm* chứ không thay thế, nên chỉ cần bổ sung nhãn mới.
 */
;(function (root) {
  'use strict';

  const BASE = {
    /**
     * Nhãn (đã bỏ dấu, chữ thường) để mở hộp thoại thêm nguồn.
     * Thứ tự = thứ tự ưu tiên khi khớp chính xác, nên nhãn cụ thể phải đứng
     * trước nhãn chung chung ('add' rất dễ đụng nút "Add note").
     */
    addSource: [
      'add source', 'add sources', 'new source', 'upload source',
      'them nguon', 'them cac nguon', 'nguon moi', 'tai nguon len',
      'add', 'them',
    ],
    /** Chip/nút chọn loại nguồn là liên kết web. */
    websiteChip: ['website', 'web site', 'link', 'web page', 'trang web', 'lien ket', 'duong dan'],
    /** Chip/nút chọn loại nguồn YouTube. */
    youtubeChip: ['youtube', 'youtube video', 'video youtube'],
    /** Chip/nút chọn loại nguồn văn bản dán tay. */
    pasteChip: [
      'copied text', 'paste text', 'pasted text', 'copy text', 'text',
      'van ban da sao chep', 'dan van ban', 'van ban sao chep', 'van ban',
    ],
    /** Nút xác nhận trong hộp thoại. */
    submit: ['insert', 'add', 'upload', 'submit', 'done', 'chen', 'them', 'tai len', 'xong', 'hoan tat'],
    /** Nút đóng / huỷ hộp thoại. */
    cancel: ['cancel', 'close', 'huy', 'dong', 'bo qua'],

    /** Selector CSS thử theo thứ tự. */
    css: {
      dialog: [
        'mat-dialog-container',
        '[role="dialog"]',
        '.mat-mdc-dialog-container',
        'upload-dialog',
      ],
      sourceList: [
        '.source-list',
        '[role="list"].sources',
        'labs-tailwind-source-list',
        '.single-source-container',
      ],
      urlInput: [
        'input[formcontrolname="url"]',
        'input[type="url"]',
        'input[placeholder*="URL" i]',
        'input[placeholder*="http" i]',
        'input[type="text"]',
        'input:not([type])',
      ],
      textArea: [
        'textarea[formcontrolname="text"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      titleInput: [
        'input[formcontrolname="title"]',
        'input[placeholder*="title" i]',
        'input[placeholder*="tieu de" i]',
        'input[placeholder*="tiêu đề" i]',
      ],
      clickable: [
        'button',
        '[role="button"]',
        'mat-chip',
        '.mat-mdc-chip',
        '[role="menuitem"]',
        'a[role="button"]',
      ],
      errorNodes: [
        'mat-error',
        '.mat-mdc-form-field-error',
        '[role="alert"]',
        '.error-message',
        '[class*="error" i]',
      ],
    },

    /**
     * Câu báo lỗi chắc chắn là thất bại. Chỉ dùng để quét snackbar/toast *sau
     * khi* hộp thoại đã đóng — không quét toàn bộ hộp thoại, vì chữ bình thường
     * trong đó (ví dụ bộ đếm "Source limit 3/50") sẽ gây báo lỗi giả.
     */
    strongErrorPatterns: [
      'could not', "couldn't", 'unable to', 'failed to', 'not supported',
      'unsupported', 'invalid url', 'try again', 'no transcript', 'error adding',
      'khong the', 'khong ho tro', 'khong hop le', 'da xay ra loi', 'thu lai sau',
    ],

    /** Lỗi do đã chạm giới hạn số nguồn — phải dừng hẳn hàng đợi. */
    limitPatterns: [
      'source limit', 'maximum number of sources', 'reached the limit',
      'gioi han nguon', 'da dat gioi han', 'toi da so nguon',
    ],

    /** Nơi NotebookLM hiện thông báo nổi. */
    snackbar: ['mat-snack-bar-container', '.mat-mdc-snack-bar-container', '[role="alert"]'],
  };

  /** Gộp override của người dùng: mảng thì nối thêm, object thì merge sâu. */
  function merge(base, override) {
    if (!override || typeof override !== 'object') return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const key of Object.keys(override)) {
      const a = out[key];
      const b = override[key];
      if (Array.isArray(a) && Array.isArray(b)) {
        out[key] = Array.from(new Set(b.concat(a))); // ưu tiên nhãn người dùng thêm
      } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        out[key] = merge(a, b);
      } else {
        out[key] = b;
      }
    }
    return out;
  }

  root.NBLM_SELECTORS = {
    BASE,
    build(overrides) {
      return merge(BASE, overrides);
    },
  };
})(globalThis);
