// Bảng loại tin nhắn — nơi duy nhất một chuỗi `nblm-…` của kênh tin nhắn được viết ra.
//
// Ba content script có thể gặp nhau trên cùng một tab, và Chrome lấy **phản hồi đến trước**:
// một script trả lời cho tin của script khác là đủ để mọi thứ sau đó chết bằng một lỗi trỏ
// sai hẳn chỗ (spec 0001). Điều kiện để "im lặng với tin không phải của mình" kiểm được là
// mỗi listener khai trước tập loại tin nó nhận — `ACCEPTS` là bản khai đó.
//
// `test/routing.test.js` (ticket 011) canh bảng này: mỗi loại tin thuộc về đúng một listener,
// hai loại tin không dùng chung một chuỗi trên dây, và mỗi listener thật — nạp vào một ngữ cảnh
// V8 sạch như Chrome nạp vào tab — im lặng với mọi tin không phải của mình.
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
   * tuyến, và nó hỏng theo kiểu tệ nhất: Chrome lấy phản hồi đến trước, nên script nào trả lời
   * đổi theo từng lượt. Tên khoá ở đây là tên lớp, và `helpers/service-worker.js` dựng tab giả
   * theo đúng những tên ấy.
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

  /**
   * Mốc của lỗi "khai nhận rồi mà không xử lý" — chuỗi này là thứ test đối chiếu, nên nó nằm ở
   * đây chứ không viết lại trong từng router.
   */
  const UNROUTED = 'không có nhánh nào xử lý loại tin';

  /**
   * Tin **đã khai nhận** mà không nhánh nào trong router xử lý.
   *
   * `ACCEPTS` và tập nhánh thật của một router là hai danh sách cùng kiểu, và chúng lệch nhau
   * theo hai chiều khác hẳn nhau. Chiều "có nhánh mà quên khai" thì `isFor` chặn lại — tin bay
   * đi không ai nhận, người gửi chờ hết giờ, ồn ào. Chiều ngược lại thì **im lặng**: `isFor` trả
   * true, không nhánh nào khớp, và tin rơi xuống nhánh cuối của router. Nhánh cuối ấy luôn là
   * việc thật của một loại tin khác, nên người gọi nhận `ok: true` cho một việc chưa bao giờ
   * chạy — đúng thứ mà luật "chỉ tin `ok: true`" dựa vào để không xảy ra.
   *
   * Vì vậy mọi router trong repo kết bằng lời gọi này thay vì bằng một nhánh bắt-tất-cả, và
   * `test/routing.test.js` lái từng router qua **mọi** loại tin nó khai để bắt đúng chiều im
   * lặng ấy. Ném chứ không trả `{ok:false}`: đây là lỗi lập trình, không phải một lượt chạy hỏng.
   */
  function unrouted(script, message) {
    return new Error(`${script}: ${UNROUTED} "${typeOf(message)}"`);
  }

  /** `true` chỉ khi tin **thuộc về** listener này. Mọi trường hợp khác: im lặng, không trả lời. */
  function isFor(script, message) {
    const list = ACCEPTS[script];
    if (!list) throw new Error(`messages: không có listener tên "${script}"`);
    return list.includes(typeOf(message));
  }

  root.NBLM_MESSAGES = Object.freeze({ TYPES, ACCEPTS, UNROUTED, typeOf, isFor, unrouted });
})(typeof globalThis !== 'undefined' ? globalThis : self);
