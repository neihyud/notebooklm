/*
 * Điều khiển giao diện NotebookLM để thêm nguồn.
 *
 * NotebookLM (bản consumer) không có API công khai; UI nói chuyện với backend
 * qua batchexecute với RPC id mà Google xoay vòng không báo trước. Vì vậy ở đây
 * ta thao tác đúng như người dùng thật: bấm nút, gõ vào ô, bấm Chèn — chạy
 * trong chính tab đã đăng nhập của bạn, không đụng tới cookie hay token nào.
 */
;(function (root) {
  'use strict';

  const { norm, sleep, waitFor } = root.NBLM;

  let S = root.NBLM_SELECTORS.build(null);

  function configure(overrides) {
    S = root.NBLM_SELECTORS.build(overrides);
  }

  /* ------------------------------------------------------------------ */
  /* nguyên thuỷ DOM                                                     */
  /* ------------------------------------------------------------------ */

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function isDisabled(el) {
    return (
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('mat-mdc-button-disabled')
    );
  }

  function queryFirst(root_, selectors) {
    for (const sel of selectors) {
      for (const el of root_.querySelectorAll(sel)) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function labelOf(el) {
    // aria-label ưu tiên; textContent có thể dính cả icon font (chữ "add", "link"...)
    return norm(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.textContent || ''}`);
  }

  /**
   * Tìm phần tử bấm được có nhãn khớp một trong `labels`.
   * Ưu tiên khớp chính xác, rồi mới tới khớp chứa — tránh chuyện nhãn "add"
   * bắt nhầm nút "add note".
   */
  function findByLabel(scope, labels, { exactOnly = false } = {}) {
    const candidates = [];
    for (const sel of S.css.clickable) {
      for (const el of scope.querySelectorAll(sel)) {
        if (!isVisible(el) || isDisabled(el)) continue;
        candidates.push(el);
      }
    }
    const wanted = labels.map(norm).filter(Boolean);

    // Pha 1 — khớp chính xác, duyệt theo thứ tự ưu tiên của mảng nhãn chứ
    // không theo thứ tự DOM, để 'add source' luôn thắng 'add'.
    for (const label of wanted) {
      for (const el of candidates) {
        if (labelOf(el) === label) return el;
      }
    }
    if (exactOnly) return null;

    // Pha 2 — khớp chứa, ưu tiên nhãn dài. Bỏ qua nhãn quá ngắn ('add', 'them')
    // vì khớp mờ với chúng gần như chắc chắn bắt nhầm nút khác.
    for (const label of wanted.slice().sort((a, b) => b.length - a.length)) {
      if (label.length < 4) continue;
      for (const el of candidates) {
        const text = labelOf(el);
        if (text.length <= 60 && text.includes(label)) return el;
      }
    }
    return null;
  }

  /** Bấm chuột "thật" — Angular Material lắng nghe pointer/mouse chứ không chỉ click. */
  function clickReal(el) {
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, isPrimary: true }, base))); } catch (_) {}
    el.dispatchEvent(new MouseEvent('mousedown', base));
    if (el.focus) el.focus();
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, isPrimary: true }, base))); } catch (_) {}
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  /**
   * Gán giá trị qua native setter rồi phát event — bắt buộc, vì gán trực tiếp
   * el.value không kích hoạt được value accessor của Angular.
   */
  function setValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  }

  /* ------------------------------------------------------------------ */
  /* hộp thoại                                                           */
  /* ------------------------------------------------------------------ */

  function openDialog() {
    return queryFirst(document, S.css.dialog);
  }

  /**
   * Chỉ đọc các phần tử *chuyên để báo lỗi*.
   * Cố tình KHÔNG quét toàn bộ chữ trong hộp thoại: NotebookLM hiển thị những
   * dòng bình thường như bộ đếm "Source limit 3/50", quét cả cụm sẽ báo lỗi giả
   * và huỷ oan một lần import đang chạy tốt.
   */
  function dialogErrorText() {
    const dialog = openDialog();
    if (!dialog) return null;
    for (const sel of S.css.errorNodes) {
      for (const node of dialog.querySelectorAll(sel)) {
        if (!isVisible(node)) continue;
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 300);
      }
    }
    return null;
  }

  /** Lỗi hiện ở snackbar sau khi hộp thoại đã đóng — nếu không bắt sẽ tưởng nhầm là thành công. */
  function snackbarErrorText() {
    for (const sel of S.snackbar) {
      for (const node of document.querySelectorAll(sel)) {
        if (!isVisible(node)) continue;
        const raw = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const text = norm(raw);
        if (!text) continue;
        const hit = S.strongErrorPatterns.some((p) => text.includes(norm(p)));
        if (hit) return raw.slice(0, 300);
      }
    }
    return null;
  }

  function isLimitError(message) {
    const text = norm(message);
    return S.limitPatterns.some((p) => text.includes(norm(p)));
  }

  async function closeDialog() {
    const dialog = openDialog();
    if (!dialog) return;
    const cancel = findByLabel(dialog, S.cancel);
    if (cancel) clickReal(cancel);
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
  }

  async function ensureAddSourceDialog() {
    if (openDialog()) return openDialog();

    const trigger = findByLabel(document, S.addSource);
    if (!trigger) {
      throw new Error(
        'Không tìm thấy nút "Thêm nguồn". Hãy mở đúng một notebook (URL dạng ' +
          '/notebook/<id>), hoặc bổ sung nhãn nút vào phần Ghi đè selector trong Options.'
      );
    }
    clickReal(trigger);
    return waitFor(openDialog, { timeout: 12000, label: 'hộp thoại thêm nguồn' });
  }

  /** Chọn chip loại nguồn; một số bản NotebookLM hiện sẵn ô nhập nên chip là tuỳ chọn. */
  async function pickChip(dialog, labelSets) {
    for (const labels of labelSets) {
      const chip = findByLabel(dialog, labels, { exactOnly: true }) || findByLabel(dialog, labels);
      if (chip) {
        clickReal(chip);
        await sleep(600);
        return true;
      }
    }
    return false;
  }

  /** Chờ hộp thoại đóng (thành công) hoặc hiện lỗi. */
  async function awaitDialogResolution(timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!openDialog()) {
        // Hộp thoại đóng chưa chắc là xong: lỗi có thể hiện ở snackbar ngay sau đó.
        await sleep(1200);
        const late = snackbarErrorText();
        if (late) return { ok: false, error: late, limit: isLimitError(late) };
        return { ok: true };
      }
      const error = dialogErrorText();
      if (error) return { ok: false, error, limit: isLimitError(error) };
      await sleep(300);
    }
    return { ok: false, error: 'NotebookLM không phản hồi trong thời gian chờ' };
  }

  /* ------------------------------------------------------------------ */
  /* thao tác cấp cao                                                    */
  /* ------------------------------------------------------------------ */

  /** Thêm nguồn từ URL (video public / unlisted). */
  async function addUrlSource(url, { timeout = 90000 } = {}) {
    const dialog = await ensureAddSourceDialog();

    const isYouTube = /youtube\.com|youtu\.be/i.test(url);
    await pickChip(dialog, isYouTube ? [S.youtubeChip, S.websiteChip] : [S.websiteChip]);

    const input = await waitFor(() => queryFirst(dialog, S.css.urlInput), {
      timeout: 10000,
      label: 'ô nhập URL',
    });
    setValue(input, url);
    await sleep(400);

    const submit = await waitFor(() => findByLabel(dialog, S.submit), {
      timeout: 8000,
      label: 'nút Chèn',
    });
    clickReal(submit);

    const result = await awaitDialogResolution(timeout);
    if (!result.ok) await closeDialog();
    return result;
  }

  /**
   * Chụp lại hiện trạng hộp thoại khi hết giờ.
   *
   * "NotebookLM không phản hồi trong thời gian chờ" một mình thì vô dụng — không
   * phân biệt được: chưa mở hộp thoại / chọn nhầm loại nguồn / không tìm ra ô
   * nhập / bấm nhầm nút / bấm đúng mà server xử lý lâu. Mỗi ca cần một cách sửa
   * khác hẳn nhau, nên gói luôn hiện trạng vào thông báo.
   */
  function dialogSnapshot() {
    const dialog = openDialog();
    if (!dialog) return 'hộp thoại đã đóng';
    const buttons = [];
    for (const sel of S.css.clickable) {
      for (const el of dialog.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const text = labelOf(el).slice(0, 24);
        if (text && !buttons.includes(text)) buttons.push(text);
      }
    }
    const area = queryFirst(dialog, S.css.textArea);
    return (
      `hộp thoại còn mở; ô văn bản: ${area ? `có, ${String(area.value || area.textContent || '').length} ký tự` : 'KHÔNG THẤY'}` +
      `; nút đang hiện: ${buttons.slice(0, 8).join(' / ') || 'không có'}`
    );
  }

  /** Thêm nguồn dạng văn bản dán (video private — transcript đã trích cục bộ). */
  async function addTextSource(title, text, { timeout = 90000 } = {}) {
    let step = 'mở hộp thoại thêm nguồn';
    try {
      const dialog = await ensureAddSourceDialog();

      step = 'chọn loại nguồn "văn bản đã sao chép"';
      const pickedChip = await pickChip(dialog, [S.pasteChip]);

      step = 'tìm ô nhập văn bản';
      const area = await waitFor(() => queryFirst(dialog, S.css.textArea), {
        timeout: 10000,
        label: 'ô nhập văn bản',
      });

      // Điền tiêu đề trước: gõ vào textarea có thể làm giao diện đổi bố cục.
      step = 'điền tiêu đề';
      const titleInput = queryFirst(dialog, S.css.titleInput);
      if (titleInput && titleInput !== area) {
        setValue(titleInput, title);
        await sleep(250);
      }

      step = `dán ${text.length} ký tự`;
      setValue(area, text);
      // Transcript dài làm Angular chạy validate/re-render khá lâu; chờ theo độ
      // dài thay vì một con số cứng.
      await sleep(Math.min(4000, 600 + text.length / 20));

      step = 'tìm nút Chèn';
      const submit = await waitFor(() => findByLabel(dialog, S.submit), {
        timeout: 8000,
        label: 'nút Chèn',
      });

      step = `bấm nút "${labelOf(submit).slice(0, 30)}"`;
      clickReal(submit);

      step = 'chờ NotebookLM xử lý';
      const result = await awaitDialogResolution(timeout);
      if (!result.ok) {
        result.error = `[bước: ${step}${pickedChip ? '' : '; KHÔNG chọn được loại nguồn'}] ${result.error} — ${dialogSnapshot()}`;
        await closeDialog();
      }
      return result;
    } catch (e) {
      const error = `[bước: ${step}] ${(e && e.message) || e} — ${dialogSnapshot()}`;
      await closeDialog().catch(() => {});
      return { ok: false, error };
    }
  }

  /** Đang ở trong một notebook cụ thể (không phải trang danh sách)? */
  function inNotebook() {
    return /\/notebook\/[^/]+/.test(location.pathname);
  }

  root.NBLM_AUTOMATION = {
    configure,
    addUrlSource,
    addTextSource,
    inNotebook,
    closeDialog,
    // xuất ra để gỡ lỗi trong DevTools console
    _internals: { findByLabel, queryFirst, clickReal, setValue, openDialog, get selectors() { return S; } },
  };
})(globalThis);
