// Bảng loại tin nhắn — nơi duy nhất một chuỗi `nblm-…` của kênh tin nhắn được viết ra.
//
// Ba content script có thể gặp nhau trên cùng một tab, và Chrome lấy **phản hồi đến trước**:
// một script trả lời cho tin của script khác là đủ để mọi thứ sau đó chết bằng một lỗi trỏ
// sai hẳn chỗ (spec 0001). Điều kiện để "im lặng với tin không phải của mình" kiểm được là
// mỗi listener khai trước tập loại tin nó nhận — `ACCEPTS` là bản khai đó.
//
// Ticket 011 sẽ dựng test kỷ luật định tuyến trên chính bảng này; ở ticket 005 nó đã phải
// đúng, vì nếu không thì đường đi demo được cũng không chạy.
(function (root) {
  'use strict';

  if (root.NBLM_MESSAGES) return;

  const TYPES = Object.freeze({
    /** Service worker → tab YouTube: còn sống không, content script nạp xong chưa. */
    PING_YOUTUBE: 'nblm-ping-youtube',
    /** Service worker → tab NotebookLM: cùng việc, loại tin **khác** — hai tab không chung kênh. */
    PING_NOTEBOOKLM: 'nblm-ping-notebooklm',
    /** Service worker → tab YouTube: trích transcript của video đang mở. */
    EXTRACT_TRANSCRIPT: 'nblm-extract-transcript',
    /** Service worker → tab NotebookLM: thêm một Nguồn văn bản. */
    PUSH_SOURCE: 'nblm-push-source',
    /** Tab YouTube → service worker: kích hoạt tab này (đường DOM cần tab được nhìn thấy). */
    ACTIVATE_TAB: 'nblm-activate-tab',
    /** Nút trên trang / phím tắt / menu chuột phải / popup → service worker: import một video. */
    IMPORT_VIDEO: 'nblm-import-video',
    /** Popup → service worker: chạy hàng đợi mà **không** đụng NotebookLM (chỉ ghi Bản lưu). */
    SAVE_ONLY: 'nblm-save-only',
    /** Popup → service worker: đọc trạng thái để vẽ. */
    GET_STATE: 'nblm-get-state',
    /** Popup → service worker: lấy notebook ở tab hiện tại làm Notebook đích. */
    USE_CURRENT_NOTEBOOK: 'nblm-use-current-notebook',

    // -------------------------------------------------------------- lớp tài liệu (ticket 010)

    /** Service worker → tab tài liệu: Bảng chọn đã tiêm xong chưa. */
    PING_DOCS: 'nblm-ping-docs',
    /** Service worker → tab tài liệu: mở Bảng chọn Nhánh tài liệu. */
    OPEN_DOC_PICKER: 'nblm-open-doc-picker',
    /** Service worker → tab tài liệu: trích một trang tài liệu (hai nấc, ADR trong extract.js). */
    EXTRACT_DOC: 'nblm-extract-doc',
    /**
     * Phím tắt / menu chuột phải / popup → service worker: gọi Bảng chọn trên tab đang mở.
     *
     * **Khác** `OPEN_DOC_PICKER` một cách có chủ ý, dù hai việc nghe như một: tin này đi *tới*
     * service worker, tin kia đi *từ* nó ra tab tài liệu. Một loại tin dùng cho cả hai chiều là
     * một loại tin mà hai listener cùng nhận — đúng thứ kỷ luật định tuyến cấm (spec 0001).
     */
    PICK_DOCS: 'nblm-pick-docs',
    /** Bảng chọn → service worker: đưa những trang đã tick vào hàng đợi tài liệu. */
    IMPORT_DOCS: 'nblm-import-docs',
    /**
     * Tab tài liệu → service worker: ảnh chụp của **tab ẩn** (nấc 2), và một lệnh điều hướng nó.
     *
     * Nấc 2 phải chạy ở tab tài liệu chứ không ở service worker: nó so **cây node** của hai lượt
     * đọc, mà service worker của MV3 không có `DOMParser` để dựng lại cây từ HTML. Còn tab ẩn thì
     * chỉ `chrome.tabs` mới lái được. Nên nấc 2 nằm hai bên và nói chuyện qua hai loại tin này.
     */
    DOC_TAB_READ: 'nblm-doc-tab-read',
    DOC_TAB_GO: 'nblm-doc-tab-go',
  });

  /**
   * Ai nhận loại tin nào. Một loại tin nằm ở hai listener **trên cùng một tab** là lỗi định
   * tuyến — đó là thứ ticket 011 dựng test.
   */
  const ACCEPTS = Object.freeze({
    youtube: Object.freeze([TYPES.PING_YOUTUBE, TYPES.EXTRACT_TRANSCRIPT]),
    notebooklm: Object.freeze([TYPES.PING_NOTEBOOKLM, TYPES.PUSH_SOURCE]),
    docs: Object.freeze([TYPES.PING_DOCS, TYPES.OPEN_DOC_PICKER, TYPES.EXTRACT_DOC]),
    background: Object.freeze([
      TYPES.ACTIVATE_TAB,
      TYPES.IMPORT_VIDEO,
      TYPES.SAVE_ONLY,
      TYPES.GET_STATE,
      TYPES.USE_CURRENT_NOTEBOOK,
      TYPES.PICK_DOCS,
      TYPES.IMPORT_DOCS,
      TYPES.DOC_TAB_READ,
      TYPES.DOC_TAB_GO,
    ]),
  });

  const typeOf = (message) => (message && typeof message === 'object' ? String(message.type || '') : '');

  /** `true` chỉ khi tin **thuộc về** listener này. Mọi trường hợp khác: im lặng, không trả lời. */
  function isFor(script, message) {
    const list = ACCEPTS[script];
    if (!list) throw new Error(`messages: không có listener tên "${script}"`);
    return list.includes(typeOf(message));
  }

  root.NBLM_MESSAGES = Object.freeze({ TYPES, ACCEPTS, typeOf, isFor });
})(typeof globalThis !== 'undefined' ? globalThis : self);
