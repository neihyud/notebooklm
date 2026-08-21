// Thao tác giao diện NotebookLM để thêm một Nguồn văn bản — ticket 004.
//
// NotebookLM bản consumer không có API công khai; giao diện của nó nói chuyện với backend qua
// `batchexecute` với các RPC id mà Google xoay vòng không báo trước, nên bám vào đó là bảo đảm
// sẽ hỏng. Cách còn lại là làm đúng như người dùng thật: bấm *Thêm nguồn* → chọn *Văn bản đã
// sao chép* → điền → bấm *Chèn*, ngay trong tab đã đăng nhập. Không đọc, không lưu, không gửi
// đi cookie hay token nào.
//
// File này **không** chứa selector nào: mọi thứ dễ vỡ nằm ở `selectors.js` và ghi đè được từ
// trang Cài đặt. Nó cũng không chạm `chrome.*`, không chạm `document` toàn cục và không đọc
// đồng hồ — mọi lần chờ đi qua adapter `page` được tiêm, nên toàn bộ luồng test được bằng cây
// node giả (`test/notebooklm.test.js`).
//
// Chuỗi sự kiện của một cú bấm lặp lại ở `src/youtube/transcript.js` chứ không gom về
// `src/common/shared.js`: shared.js theo hợp đồng là hàm thuần, không chạm DOM. Hai file này
// nạp trên hai tab khác nhau và không bao giờ gặp nhau.
(function (root) {
  'use strict';

  if (root.NBLM_AUTOMATION) return;

  const S = root.NBLM_SHARED;
  const N = root.NBLM_NB_SELECTORS;
  if (!S) throw new Error('notebooklm/automation: cần src/common/shared.js nạp trước');
  if (!N) throw new Error('notebooklm/automation: cần src/notebooklm/selectors.js nạp trước');

  /**
   * Nhịp của một lượt đẩy. `settleMs` là điều đáng nói nhất: **hộp thoại đóng chưa chắc là
   * xong** — NotebookLM đóng hộp thoại trước, rồi mới báo lỗi ở khay thông báo. Trả về "ok"
   * ngay lúc đóng là ghi vào Sổ đã import một nguồn chưa bao giờ vào notebook.
   */
  const TIMING = Object.freeze({
    stepMs: 120,
    dialogTries: 40,
    formTries: 40,
    closeTries: 100,
    settleMs: 1200,
    // Ô tiêu đề dựng cùng ô nội dung, nên ngân sách chờ ngắn: một playlist 55 nguồn mà chờ
    // đủ `formTries` cho mỗi nguồn không có ô ấy là cộng thêm vài phút cho cả lượt chạy.
    titleTries: 5,
  });

  /** Một cú bấm thật: Angular Material không phản ứng với mỗi `click`. */
  const PRESS_SEQUENCE = Object.freeze(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);

  /** Nhãn ngắn không tham gia khớp mờ — cùng ngưỡng với bên YouTube (spec 0001). */
  const MIN_FUZZY_LABEL = 4;

  const collapse = (value) => S.collapse(value);

  /** Nhận cả bộ selector đã dựng sẵn lẫn object ghi đè thô, để người gọi khỏi dựng lại mỗi bước. */
  function selectorsOf(options) {
    const given = options && options.selectors;
    if (!given) return N.DEFAULT;
    return typeof given.css === 'function' ? given : N.resolve(given);
  }

  function defaultEvent(type) {
    const init = { bubbles: true, cancelable: true, composed: true };
    const Pointer = root.PointerEvent;
    const Mouse = root.MouseEvent;
    if (type.startsWith('pointer') && typeof Pointer === 'function') return new Pointer(type, init);
    if ((type === 'input' || type === 'change') && typeof root.Event === 'function') {
      return new root.Event(type, { bubbles: true });
    }
    if (typeof Mouse === 'function') return new Mouse(type, init);
    throw new Error('notebooklm/automation: ngữ cảnh không có MouseEvent — phải tiêm `createEvent`');
  }

  const eventFactory = (options) => (options && options.createEvent) || defaultEvent;

  // -------------------------------------------------- khớp theo chữ hiển thị

  function matchesLabel(node, label) {
    const aria = S.foldLabel(node.getAttribute('aria-label') || '');
    const text = S.foldLabel(node.textContent || '');
    return label.length >= MIN_FUZZY_LABEL
      ? aria.includes(label) || text.includes(label)
      : aria === label || text === label;
  }

  /**
   * Phần tử bấm được **trong cùng**. `querySelectorAll` trả theo thứ tự tài liệu nên wrapper
   * luôn đứng trước phần tử thật — mà bấm wrapper thì Angular không phản hồi, và triệu chứng
   * là "hộp thoại không bao giờ mở", không phải một lỗi.
   */
  function innermostClickable(node, sel) {
    const css = sel.css('pressable');
    // `querySelectorAll` trả NodeList: phải `Array.from` trước khi dùng phương thức của Array.
    const inside = Array.from(node.querySelectorAll(css)).filter((n) => !n.closest(sel.OWN_UI));
    for (const candidate of inside) {
      if (candidate.querySelectorAll(css).length === 0) return candidate;
    }
    return inside[0] || node;
  }

  /**
   * Tìm phần tử theo chữ hiển thị đã bỏ dấu.
   *
   * Vòng ngoài là **nhãn**, vòng trong mới là phần tử. Đảo hai vòng lại là để thứ tự DOM quyết
   * định: một nút "Add" đứng trước sẽ thắng nhãn `"add source"` cụ thể hơn, và extension bấm
   * nhầm nút mà không có triệu chứng nào ngoài "hộp thoại lạ".
   */
  function findByLabel(node, key, options) {
    if (!node) return null;
    const sel = selectorsOf(options);
    const labels = sel.label(key);
    if (labels.length === 0) throw new Error(`findByLabel: không có nhóm nhãn "${key}"`);

    const candidates = Array.from(node.querySelectorAll(sel.css('clickable')))
      .filter((n) => !n.closest(sel.OWN_UI));

    for (const label of labels) {
      for (const candidate of candidates) {
        if (matchesLabel(candidate, label)) return innermostClickable(candidate, sel);
      }
    }
    return null;
  }

  const firstOwned = (node, sel, key) => (node
    ? Array.from(node.querySelectorAll(sel.css(key))).filter((n) => !n.closest(sel.OWN_UI))
    : []);

  /** Hộp thoại đang mở. Lấy cái **cuối cùng**: Material xếp hộp thoại mới lên trên, ở cuối cây. */
  function findDialog(node, options) {
    const sel = selectorsOf(options);
    const open = firstOwned(node, sel, 'dialog');
    return open.length > 0 ? open[open.length - 1] : null;
  }

  function findTextInput(dialog, options) {
    return firstOwned(dialog, selectorsOf(options), 'textInput')[0] || null;
  }

  function findTitleInput(dialog, options) {
    return firstOwned(dialog, selectorsOf(options), 'titleInput')[0] || null;
  }

  function isDisabled(node, options) {
    return !!node && node.matches(selectorsOf(options).css('disabled'));
  }

  // ------------------------------------------------------------ nhận diện lỗi

  const firstMessage = (nodes) => {
    for (const node of nodes) {
      const text = collapse(node.textContent);
      if (text) return text;
    }
    return null;
  };

  /**
   * Lỗi trong hộp thoại — **chỉ** đọc phần tử chuyên báo lỗi.
   *
   * Quét toàn bộ chữ trong hộp thoại là cách chắc chắn để huỷ oan một lần import đang chạy
   * tốt: NotebookLM hiển thị những dòng bình thường như bộ đếm "Source limit 3/50", và một
   * bộ dò theo từ khoá sẽ đọc "limit" thành "đã chạm giới hạn".
   */
  function readError(node, options) {
    const sel = selectorsOf(options);
    return firstMessage(firstOwned(node, sel, 'error'));
  }

  /**
   * Lỗi hiện muộn ở khay thông báo, sau khi hộp thoại đã đóng.
   *
   * Khay mang cả tin mừng lẫn tin dữ ("Đã thêm nguồn" cũng nằm ở đây), nên chỉ khay
   * `assertive` — thứ khớp nhóm selector báo lỗi — mới được coi là hỏng.
   */
  function readSnackbarError(node, options) {
    const sel = selectorsOf(options);
    const errorCss = sel.css('error');
    for (const bar of firstOwned(node, sel, 'snackbar')) {
      const text = bar.matches(errorCss) ? collapse(bar.textContent) : firstMessage(firstOwned(bar, sel, 'error'));
      if (text) return text;
    }
    return null;
  }

  // ------------------------------------------------------------ gán và bấm

  /** Value accessor thật của ô nhập, tìm ngược lên chuỗi prototype. */
  function valueAccessor(node) {
    let proto = Object.getPrototypeOf(node);
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && typeof desc.set === 'function') return desc;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  /**
   * Điền một ô nhập: gán qua **native value setter**, rồi mới phát event.
   *
   * Gán thẳng `node.value = x` trúng vào property mà Angular/React đặt chồng lên phần tử, nên
   * value accessor của framework không bao giờ chạy: ô nhập hiện chữ nhưng form vẫn coi là
   * rỗng, nút Chèn vẫn mờ, và không có lỗi nào để đọc. Phát event trước rồi mới gán cũng hỏng
   * y như vậy — lúc framework đọc lại thì ô còn rỗng.
   */
  function setNativeValue(node, value, options) {
    const text = value == null ? '' : String(value);
    const accessor = valueAccessor(node);
    if (!accessor && !('value' in node)) {
      throw new Error(`setNativeValue: <${String(node.tagName).toLowerCase()}> không nhận được giá trị — không phải ô nhập`);
    }

    if (accessor) accessor.set.call(node, text);
    else node.value = text;

    const read = accessor && accessor.get ? accessor.get.call(node) : node.value;
    if (read !== text) throw new Error('setNativeValue: gán xong mà ô nhập không nhận được giá trị');

    const create = eventFactory(options);
    node.dispatchEvent(create('input'));
    node.dispatchEvent(create('change'));
    return text;
  }

  function pressElement(node, options) {
    const create = eventFactory(options);
    for (const type of PRESS_SEQUENCE) node.dispatchEvent(create(type));
    return [...PRESS_SEQUENCE];
  }

  // ------------------------------------------------------- một lượt đẩy Nguồn

  const fail = (detail) => new Error(`addTextSource: ${detail}`);

  /**
   * Thêm một Nguồn văn bản vào Notebook đích đang mở ở tab này.
   *
   * `page` là adapter của tab: `root()` trả cây node đang hiển thị, `wait(ms)` nhường quyền
   * cho trang dựng lại giao diện. Mọi lần chờ đi qua đó, nên hàm này không đọc đồng hồ và
   * chạy được nguyên vẹn trên cây node giả.
   *
   * Ném lỗi khi không chắc nguồn đã vào — người gọi (engine hàng đợi) coi đó là mục rớt và
   * ghi lý do vào bảng tổng kết, thay vì lặng lẽ ghi vào Sổ đã import.
   */
  async function addTextSource(source, page, options) {
    const src = source || {};
    const body = collapse(src.body) ? String(src.body) : '';
    if (!body) throw fail('Nguồn rỗng — không đẩy một nguồn không có chữ nào');
    if (!page || typeof page.root !== 'function' || typeof page.wait !== 'function') {
      throw fail('thiếu adapter trang');
    }

    const opts = { ...(options || {}), selectors: selectorsOf(options) };
    const name = collapse(src.name);
    const dialogNow = () => findDialog(page.root(), opts);

    async function waitFor(find, tries) {
      for (let i = 0; i < tries; i += 1) {
        const found = find();
        if (found) return found;
        await page.wait(TIMING.stepMs);
      }
      return null;
    }

    const addButton = findByLabel(page.root(), 'addSource', opts);
    if (!addButton) throw fail('không thấy nút thêm nguồn trên trang NotebookLM');
    pressElement(addButton, opts);

    if (!await waitFor(dialogNow, TIMING.dialogTries)) {
      throw fail('đã bấm thêm nguồn nhưng hộp thoại không mở');
    }

    const chip = await waitFor(() => findByLabel(dialogNow(), 'pasteChip', opts), TIMING.dialogTries);
    if (!chip) throw fail('hộp thoại không có mục dán văn bản');
    pressElement(chip, opts);

    const bodyBox = await waitFor(() => findTextInput(dialogNow(), opts), TIMING.formTries);
    if (!bodyBox) throw fail('không thấy ô nhập nội dung trong hộp thoại');
    setNativeValue(bodyBox, body, opts);

    // Tên Nguồn vào ô tiêu đề, thân Nguồn vào ô nội dung. Hai ô cùng kiểu "ô nhập": đổi chỗ
    // hai giá trị vẫn ra một lần import "thành công", chỉ là nguồn mang tên bằng cả transcript
    // — mà Nguồn đã đẩy thì không sửa được nữa (ADR 0010).
    const titleBox = name
      ? await waitFor(() => findTitleInput(dialogNow(), opts), TIMING.titleTries)
      : null;
    if (titleBox) setNativeValue(titleBox, name, opts);

    const submit = await waitFor(() => {
      const button = findByLabel(dialogNow(), 'submit', opts);
      return button && !isDisabled(button, opts) ? button : null;
    }, TIMING.formTries);
    if (!submit) throw fail('nút chèn nguồn không sáng lên — NotebookLM chưa nhận nội dung vừa điền');
    pressElement(submit, opts);

    let closed = false;
    for (let i = 0; i < TIMING.closeTries; i += 1) {
      const dialog = dialogNow();
      if (!dialog) {
        closed = true;
        break;
      }
      const message = readError(dialog, opts);
      if (message) throw fail(`NotebookLM báo lỗi — ${message}`);
      await page.wait(TIMING.stepMs);
    }
    if (!closed) throw fail('hộp thoại không đóng sau khi bấm chèn — không rõ nguồn đã vào hay chưa');

    // Hộp thoại đóng chưa chắc là xong: lỗi hay hiện muộn ở khay thông báo.
    await page.wait(TIMING.settleMs);
    const late = readSnackbarError(page.root(), opts);
    if (late) throw fail(`NotebookLM báo lỗi sau khi hộp thoại đóng — ${late}`);

    // Không đặt được tên thì NotebookLM tự đặt, và tên đó vĩnh viễn (ADR 0010) — lần import
    // lại đọc tên để biết phần nào đã có (ADR 0009). Trả `ok` kèm `name` như thể đã đặt là
    // nói dối người gọi, nên chỗ này nói thẳng ra.
    const result = { ok: true, name: src.name ? String(src.name) : '', named: !!titleBox };
    if (name && !titleBox) {
      result.warning = `không thấy ô tiêu đề trong hộp thoại — NotebookLM sẽ tự đặt tên thay cho "${name}"`;
    }
    return result;
  }

  root.NBLM_AUTOMATION = Object.freeze({
    TIMING,
    PRESS_SEQUENCE,
    findByLabel,
    innermostClickable,
    findDialog,
    findTextInput,
    findTitleInput,
    isDisabled,
    readError,
    readSnackbarError,
    setNativeValue,
    pressElement,
    addTextSource,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
