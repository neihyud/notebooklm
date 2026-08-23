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

  /**
   * Ô mà extension KHÔNG BAO GIỜ được ghi vào — xem `FORBIDDEN_WRITE_TARGETS`
   * trong selectors.js. Chặn ngay ở đây vì mọi phép tìm ô nhập đều đi qua
   * `queryFirst`; chặn một chỗ là đủ cho cả urlInput, textArea lẫn titleInput.
   */
  function isForbiddenTarget(el) {
    return root.NBLM_SELECTORS.FORBIDDEN_WRITE_TARGETS.some((sel) => el.matches(sel));
  }

  /**
   * Như `queryFirst`, nhưng nói thêm selector NÀO đã khớp.
   *
   * Ai khớp là chuyện quan trọng chứ không phải chi tiết vụn: khớp được
   * `input[formcontrolname="url"]` nghĩa là ta biết mình đang gõ vào đâu, còn
   * khớp được `input[type="text"]` thì chỉ nghĩa là hộp thoại có một ô nhập nào
   * đó. Hai ca đó cần hai phản ứng khác nhau — xem `REPORT.URL_INPUT_FALLBACK`.
   */
  function queryFirstWith(root_, selectors) {
    for (const sel of selectors) {
      for (const el of root_.querySelectorAll(sel)) {
        if (isForbiddenTarget(el)) continue;
        if (isVisible(el)) return { el, selector: sel };
      }
    }
    return null;
  }

  function queryFirst(root_, selectors) {
    const hit = queryFirstWith(root_, selectors);
    return hit ? hit.el : null;
  }

  /**
   * `<mat-icon>` là icon font: tên glyph nằm ngay trong textContent, nên nút
   * "Trang web" đọc thô ra thành "linkvideo_youtubeTrang web". Chuỗi rác đó từng
   * làm `youtubeChip` khớp trúng nút Trang web và `submit` khớp trúng nút "Tải
   * tệp lên" (qua glyph 'upload'). Đọc `.mdc-button__label` cũng không cứu được:
   * nút chọn kho có `<mat-icon>` nằm *bên trong* chính span đó.
   */
  const ICON_TEXT = 'mat-icon, .mat-icon, [data-mat-icon-type="font"]';

  /**
   * Chữ chỉ dành cho trình đọc màn hình — mắt không thấy. Angular Material rắc
   * `.cdk-visually-hidden` khá thoải mái (bản chụp state-main có sẵn một cái), và
   * một cái nằm trong nút là đủ làm nhãn hiển thị lệch khỏi mọi phép khớp chính xác.
   */
  const SCREEN_READER_TEXT = '.cdk-visually-hidden, [class*="visually-hidden" i], .sr-only';

  /** Chữ trong `el` sau khi xoá trắng mọi phần tử khớp `strip`. */
  function textWithout(el, strip) {
    const clone = el.cloneNode(true);
    // Khoảng trắng chứ không xoá hẳn: giữ ranh giới giữa hai đoạn chữ liền nhau.
    for (const node of clone.querySelectorAll(strip)) node.textContent = ' ';
    return clone.textContent || '';
  }

  /**
   * Các cách gọi tên một phần tử, mỗi cách là một ứng viên khớp ĐỘC LẬP.
   *
   * Cố tình không nối chúng lại: nút vừa có aria-label="Chèn" vừa hiện chữ "Chèn"
   * nối lại thành "chen chen", không khớp chính xác với gì cả. Hai biến thể chữ
   * cũng cố ý giữ cả hai — bản bỏ chữ trợ năng là thứ mắt thật sự thấy, bản giữ
   * lại phòng trường hợp nhãn duy nhất của nút nằm đúng trong đoạn trợ năng đó.
   */
  function labelsOf(el) {
    const parts = [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      textWithout(el, `${ICON_TEXT}, ${SCREEN_READER_TEXT}`),
      textWithout(el, ICON_TEXT),
    ];
    return Array.from(new Set(parts.map(norm).filter(Boolean)));
  }

  /** Một chuỗi để in ra cho người đọc (thông báo lỗi, ảnh chụp hiện trạng). */
  function labelOf(el) {
    return labelsOf(el)[0] || '';
  }

  /**
   * Tìm phần tử bấm được mà một trong các nhãn hiển thị của nó khớp CHÍNH XÁC
   * một nhãn trong `labels`.
   *
   * Không có pha khớp-chứa. Pha đó từng là lưới an toàn cho chuỗi rác của icon
   * font, nhưng nó chính là nguồn của mọi lần bấm nhầm: 'youtube' khớp trúng
   * glyph 'video_youtube', 'upload' khớp trúng glyph 'upload' của nút tải tệp.
   * Nhãn đã sạch thì khớp chính xác là đủ — và khi không khớp, không tìm thấy gì
   * còn hơn là bấm nhầm một nút khác.
   */
  function findByLabel(scope, labels) {
    const candidates = [];
    for (const sel of S.css.clickable) {
      for (const el of scope.querySelectorAll(sel)) {
        if (!isVisible(el) || isDisabled(el)) continue;
        candidates.push({ el, labels: labelsOf(el) });
      }
    }
    // Duyệt theo thứ tự ưu tiên của mảng nhãn chứ không theo thứ tự DOM, để
    // 'add source' luôn thắng 'add'.
    for (const label of labels.map(norm).filter(Boolean)) {
      for (const c of candidates) {
        if (c.labels.includes(label)) return c.el;
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
      const chip = findByLabel(dialog, labels);
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
  /* đối chiếu kết quả thật                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Số Nguồn đang hiển thị trong notebook, hoặc `null` khi KHÔNG đọc được.
   *
   * `null` chứ không phải `0`, và đây là điểm mấu chốt của cả hàm: `0` là một số
   * đếm được, nó sẽ trôi thẳng vào phép so `sau === trước + 1` và biến một
   * selector sai thành một phán quyết sai. `null` thì không so được với gì, nên
   * buộc phải đi ra nhánh "chưa xác minh được".
   *
   * Selector ở `S.css.sourceList`/`sourceItem` chưa từng chạy trên DOM thật của
   * NotebookLM (xem ghi chú tại chỗ khai báo). Hàm này chính là cơ chế phát hiện
   * lúc chạy cho chúng: sai thì ra `null`, và `null` hiện thành chữ trong popup.
   */
  function countSources() {
    const list = queryFirst(document, S.css.sourceList);
    if (!list) return null;
    for (const sel of S.css.sourceItem) {
      const n = list.querySelectorAll(sel).length;
      if (n > 0) return n;
    }
    // Khung có mà không đọc nổi Nguồn nào bên trong: không phân biệt được
    // "notebook rỗng" với "selector item sai", nên vẫn là chưa xác minh được.
    return null;
  }

  /**
   * Chờ danh sách Nguồn lắng lại sau khi hộp thoại đóng — NotebookLM cập nhật nó
   * bất đồng bộ, đếm ngay lập tức thì lần nào cũng ra số cũ.
   * Hết giờ thì trả về con số đọc được ở lần cuối (kể cả `null`).
   */
  async function settledSourceCount(before) {
    try {
      // Bọc trong object vì `0` là giá trị đếm hợp lệ nhưng falsy — waitFor sẽ
      // coi là chưa đạt và chờ hết giờ một cách vô nghĩa.
      const box = await waitFor(
        () => {
          const n = countSources();
          return n !== null && n !== before ? { n } : null;
        },
        { timeout: 8000, interval: 300, label: 'danh sách Nguồn cập nhật' }
      );
      return box.n;
    } catch (_) {
      return countSources();
    }
  }

  /**
   * Ba kết cục, không phải hai. Hộp thoại đóng chỉ nói cái *cửa* đã đóng; câu hỏi
   * thật là notebook có thêm đúng một Nguồn hay không.
   *
   *   đếm được + tăng đúng 1  -> ok, verified
   *   đếm được + không tăng 1 -> LỖI, kèm số trước/sau và ảnh chụp hộp thoại
   *   không đếm được          -> ok nhưng verified:false, và phải nói ra tới popup
   */
  async function confirmSourceAdded(before) {
    // Không đếm được TRƯỚC thì không có gì để so, nên chờ danh sách cập nhật
    // cũng không đổi được kết luận: chờ xong vẫn phải trả `verified:false`.
    //
    // Bản trước của comment này biện minh bằng "8s cho MỖI mục = 12 phút cho 89
    // video". Con số đó SAI và đã lan sang `docs/tickets/001-PHAN-TICH.md` trước
    // khi bị bắt: 8000 là `timeout` của `waitFor`, tức là TRẦN, không phải nhịp
    // chờ cứng — `settledSourceCount` dò mỗi 300ms và trả về ngay lần đầu thấy
    // đạt, nên đường thuận tốn ~300ms/mục (~27s cho 89 video). Chỉ ca danh sách
    // không bao giờ đổi mới phải trả đủ 8s. Việc trả sớm ở đây vẫn đúng, nhưng
    // đúng vì KHÔNG CÓ GÌ ĐỂ SO, không phải vì tiết kiệm thời gian.
    const after = before === null ? null : await settledSourceCount(before);
    if (before === null || after === null) {
      // Chỗ DUY NHẤT biết chắc "không đọc được danh sách Nguồn", và biết vào lúc
      // hộp thoại đã đóng — tức là trang đang ở đúng hình dạng owner nhìn thấy.
      // `listFound` tách hai ca cần hai cách sửa khác hẳn nhau: không thấy khung
      // (sửa `sourceList`) hay thấy khung mà không đọc nổi Nguồn (sửa `sourceItem`).
      await recordReport(
        REPORT.SOURCE_LIST_UNREADABLE,
        {
          sourcesBefore: before,
          sourcesAfter: after,
          listFound: !!queryFirst(document, S.css.sourceList),
          selectorsTried: {
            sourceList: S.css.sourceList.slice(0, REPORT_LIMITS.labels),
            sourceItem: S.css.sourceItem.slice(0, REPORT_LIMITS.labels),
          },
        },
        () => pageStructure(document.body)
      );
      return {
        ok: true,
        verified: false,
        sourcesBefore: before,
        sourcesAfter: after,
        unverified: 'Không đọc được danh sách Nguồn của notebook nên chưa xác minh được nguồn đã vào hay chưa.',
      };
    }
    if (after === before + 1) {
      return { ok: true, verified: true, sourcesBefore: before, sourcesAfter: after };
    }
    return {
      ok: false,
      verified: true,
      sourcesBefore: before,
      sourcesAfter: after,
      // Số Nguồn CÓ tăng, chỉ là không đúng 1. Nguồn đã ghi vào notebook thật
      // rồi, nên tầng trên tuyệt đối không được thử lại bằng đường khác: thêm
      // nguồn không idempotent, thử lại là để lại một bản trùng phải xoá tay.
      sourceAdded: after > before,
      error:
        `Hộp thoại đã đóng nhưng số Nguồn không tăng đúng 1 (trước: ${before}, sau: ${after})` +
        ` — ${dialogSnapshot()}`,
    };
  }

  /* ------------------------------------------------------------------ */
  /* bản chụp cấu trúc khi lạc đường                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Ba tình huống đáng chụp. Mỗi cái là một câu hỏi mà chỉ DOM thật của owner
   * trả lời được, và máy dựng thì không có Chrome đã đăng nhập để tự hỏi.
   */
  const REPORT = {
    /** Tìm được ô nhập URL, nhưng chỉ nhờ selector vơ bèo vạt tép. */
    URL_INPUT_FALLBACK: 'url-input-fallback',
    /** Không có nút xác nhận nào khớp `S.submit`. */
    SUBMIT_NOT_FOUND: 'submit-not-found',
    /** Không đọc được danh sách Nguồn, nên không đối chiếu được kết quả. */
    SOURCE_LIST_UNREADABLE: 'source-list-unreadable',
  };

  /**
   * Trần dung lượng. Bản chụp nằm trong `chrome.storage.local` của owner và chỉ
   * để đọc bằng mắt — một trang NotebookLM đầy Nguồn có hàng chục nghìn phần tử,
   * chép hết vào storage là vô ích lẫn vô duyên.
   */
  const REPORT_LIMITS = { path: 12, nodes: 40, outline: 400, tags: 60, attr: 200, label: 60, labels: 50, json: 40000 };

  /**
   * Thuộc tính được phép chép lại — DANH SÁCH TRẮNG, không phải danh sách đen.
   *
   * `value` không có ở đây và sẽ không bao giờ có: nó là thứ owner gõ vào. Cũng
   * không có `textContent` — chữ trong hộp thoại là tiêu đề notebook, tên Nguồn,
   * nội dung transcript. Bản chụp này để sửa selector, không phải để đọc trộm.
   */
  const SAFE_ATTRS = [
    'id', 'formcontrolname', 'role', 'type', 'name', 'placeholder', 'aria-label',
    'aria-haspopup', 'aria-disabled', 'contenteditable', 'jslog',
  ];

  /** Thẻ không nói gì về cấu trúc mà lại rất nhiều. */
  const NOISE_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path', 'g', 'defs', 'use', 'symbol', 'br']);

  /**
   * Tên gọn của một phần tử: thẻ + tối đa hai class.
   * Ưu tiên class RIÊNG của ứng dụng, vì `mat-mdc-*`/`mdc-*` có ở khắp nơi và
   * không giúp viết được selector nào.
   */
  function nodeToken(el) {
    const all = Array.from(el.classList || []).filter((c) => !/^ng-/.test(c));
    const own = all.filter((c) => !/^(mat|mdc|cdk)-/.test(c));
    const pick = (own.length ? own : all).slice(0, 2).map((c) => '.' + c.slice(0, 30)).join('');
    return el.tagName.toLowerCase() + pick;
  }

  /**
   * Đường CSS từ tổ tiên xuống `el` — thứ để owner viết lại selector.
   * Leo hết tới `stop` thì đường là trọn vẹn; đụng trần thì mở đầu bằng '…' để
   * không ai tưởng mẩu đầu tiên là gốc của vùng.
   */
  function cssPath(el, stop) {
    const parts = [];
    let node = el;
    let tronVen = true;
    while (node && node.nodeType === 1) {
      parts.unshift(nodeToken(node));
      if (node === stop) break;
      if (parts.length >= REPORT_LIMITS.path) {
        tronVen = node.parentElement === null;
        break;
      }
      node = node.parentElement;
    }
    return (tronVen ? '' : '… > ') + parts.join(' > ');
  }

  /**
   * Cắt ngắn và ĐÁNH DẤU chỗ cắt.
   * Không đánh dấu thì `class="… mdc-text-field__"` trông y như một tên class
   * trọn vẹn, và owner dựng lại một selector không bao giờ khớp thứ gì.
   */
  function catNgan(text, max) {
    const raw = String(text);
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  }

  function attrsOf(el) {
    const out = {};
    for (const name of SAFE_ATTRS) {
      if (el.hasAttribute(name)) out[name] = catNgan(el.getAttribute(name), REPORT_LIMITS.attr);
    }
    const cls = Array.from(el.classList || []).join(' ');
    if (cls) out.class = catNgan(cls, REPORT_LIMITS.attr);
    return out;
  }

  /** Một phần tử, mô tả bằng cấu trúc thuần. `visible`/`disabled` là lý do phổ biến nhất khiến phép tìm trượt. */
  function describeNode(el, scope) {
    return {
      tag: el.tagName.toLowerCase(),
      path: cssPath(el, scope),
      attrs: attrsOf(el),
      visible: isVisible(el),
      disabled: isDisabled(el),
    };
  }

  /**
   * Khung xương của một vùng: CHỈ tên thẻ, class và role. Không nhãn, không chữ.
   * Đây là dạng an toàn nhất, nên nó là dạng duy nhất dùng cho vùng ngoài hộp
   * thoại — nơi mọi nhãn đều có thể là tên Nguồn của owner.
   */
  function outlineOf(scope, maxDepth) {
    const lines = [];
    let complete = true;
    (function walk(el, depth) {
      if (depth > maxDepth) {
        if (el.children.length) complete = false;
        return;
      }
      for (const child of el.children) {
        if (lines.length >= REPORT_LIMITS.outline) {
          complete = false;
          return;
        }
        const tag = child.tagName.toLowerCase();
        if (NOISE_TAGS.has(tag)) continue;
        const role = child.getAttribute('role');
        lines.push('  '.repeat(depth) + nodeToken(child) + (role ? `[role=${role}]` : ''));
        walk(child, depth + 1);
      }
    })(scope, 0);
    return { lines, complete };
  }

  /**
   * Điểm danh thẻ tuỳ biến (`labs-tailwind-source-list`, `single-source`…).
   * Đây là mẩu tin đắt nhất khi Google đổi tên component: một cái tên mới trong
   * bảng này là đủ để sửa `S.css.sourceList`.
   */
  function customTagCensus(scope) {
    const count = {};
    for (const el of scope.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (!tag.includes('-') || NOISE_TAGS.has(tag)) continue;
      count[tag] = (count[tag] || 0) + 1;
    }
    const all = Object.entries(count).sort((a, b) => b[1] - a[1]);
    return { tags: Object.fromEntries(all.slice(0, REPORT_LIMITS.tags)), complete: all.length <= REPORT_LIMITS.tags };
  }

  /**
   * Điểm danh class có chữ "source" — mẩu tin nhắm thẳng vào `S.css.sourceItem`.
   *
   * Khung xương có trần dung lượng nên có thể cắt trước khi chạm tới danh sách
   * Nguồn; phép điểm danh này quét cả cây nên không bỏ sót. Class là chuỗi do
   * ứng dụng đặt, không phải chữ của owner.
   */
  function sourceClassCensus(scope) {
    const count = {};
    for (const el of scope.querySelectorAll('[class*="source" i]')) {
      for (const cls of el.classList) {
        if (!/source/i.test(cls)) continue;
        count[cls] = (count[cls] || 0) + 1;
      }
    }
    const all = Object.entries(count).sort((a, b) => b[1] - a[1]);
    return { classes: Object.fromEntries(all.slice(0, REPORT_LIMITS.tags)), complete: all.length <= REPORT_LIMITS.tags };
  }

  /**
   * Vùng hộp thoại: ô nhập và nút bấm, kèm nhãn nút.
   * Nhãn nút được phép chép vì nó là chữ của giao diện Google, và vì không có nó
   * thì bản chụp không trả lời được câu hỏi duy nhất đáng hỏi: nút xác nhận thật
   * tên là gì.
   */
  function dialogStructure(dialog) {
    const fields = [];
    for (const el of dialog.querySelectorAll('input, textarea, [contenteditable="true"]')) {
      if (fields.length >= REPORT_LIMITS.nodes) break;
      fields.push(describeNode(el, dialog));
    }

    const buttons = [];
    const seen = new Set();
    for (const sel of S.css.clickable) {
      for (const el of dialog.querySelectorAll(sel)) {
        if (seen.has(el) || buttons.length >= REPORT_LIMITS.nodes) continue;
        seen.add(el);
        // Nhãn bị cắt ngắn có chủ đích: nhãn nút thật thì ngắn, còn một chuỗi dài
        // xuất hiện ở đây gần như chắc chắn là chữ của owner lọt vào (tên Nguồn
        // trong một nút, chẳng hạn) — cắt là thu hẹp thiệt hại. `dialogSnapshot()`
        // cắt ở 24 ký tự vì đúng lý do đó.
        buttons.push(Object.assign(describeNode(el, dialog), { label: catNgan(labelOf(el), REPORT_LIMITS.label) }));
      }
    }

    // Sâu 20 tầng: hộp thoại Angular Material lồng tới 16 tầng chỉ để bọc một ô
    // nhập, mà chính ô nhập ấy là thứ cần nhìn thấy.
    const outline = outlineOf(dialog, 20);
    const census = customTagCensus(dialog);
    return {
      fields,
      buttons,
      outline: outline.lines,
      customTags: census.tags,
      // Trần nào chạm cũng phải nói ra: một bản chụp thiếu mà im lặng sẽ khiến
      // owner kết luận "trong hộp thoại không có ô nào như thế".
      truncated: !outline.complete || !census.complete ||
        fields.length >= REPORT_LIMITS.nodes || buttons.length >= REPORT_LIMITS.nodes,
    };
  }

  /**
   * Vùng trang (ngoài hộp thoại): KHÔNG nhãn, KHÔNG thuộc tính chữ.
   *
   * Cố ý nghèo hơn `dialogStructure`: ở đây mỗi `aria-label` rất có thể chính là
   * tên một Nguồn của owner, và thứ cần tìm — tên thẻ và class của danh sách
   * Nguồn — thì khung xương đã nói đủ.
   */
  function pageStructure(scope) {
    const outline = outlineOf(scope, 12);
    const census = customTagCensus(scope);
    const classes = sourceClassCensus(scope);
    return {
      outline: outline.lines,
      customTags: census.tags,
      sourceLikeClasses: classes.classes,
      truncated: !outline.complete || !census.complete || !classes.complete,
    };
  }

  /** Cắt cho vừa trần, và NÓI RA là đã cắt. */
  function capReport(report) {
    if (JSON.stringify(report).length <= REPORT_LIMITS.json) return report;
    const short = Object.assign({}, report, {
      truncated: true,
      outline: (report.outline || []).slice(0, 40).concat('… đã cắt bớt cho vừa trần dung lượng'),
    });
    if (JSON.stringify(short).length <= REPORT_LIMITS.json) return short;
    // Phần chẩn đoán (`detail`) là thứ cuối cùng được buông.
    return {
      situation: report.situation,
      at: report.at,
      inNotebook: report.inNotebook,
      detail: report.detail,
      truncated: true,
    };
  }

  /**
   * Ghi bản chụp vào storage — MỘT bản gần nhất cho mỗi tình huống.
   *
   * Là phụ phẩm, không phải mục đích: hỏng thì kêu một tiếng trong console rồi
   * đi tiếp. Một lượt import đang chạy tốt không được chết vì cái máy quay.
   *
   * @param {Function} build hàm dựng phần cấu trúc — gọi trong try để cả việc
   *                         duyệt DOM hỏng cũng không văng ra ngoài.
   */
  async function recordReport(situation, detail, build) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
      const report = capReport(
        Object.assign(
          {
            situation,
            at: new Date().toISOString(),
            inNotebook: inNotebook(),
            truncated: false,
            detail,
          },
          build()
        )
      );
      await root.NBLM.saveDomReport(situation, report);
      return report;
    } catch (e) {
      console.warn('[NBLM] không ghi được bản chụp cấu trúc DOM:', (e && e.message) || e);
      return null;
    }
  }

  /**
   * Tìm nút xác nhận; không thấy thì chụp lại hộp thoại TRƯỚC khi ném lỗi.
   *
   * Gom vào một hàm chứ không lặp ở hai chỗ gọi: hai chỗ đó (đường URL và đường
   * dán văn bản) mà lệch nhau thì một trong hai đường sẽ im lặng không chụp gì,
   * và không có gì báo cho ai biết.
   */
  async function findSubmitButton(dialog) {
    try {
      return await waitFor(() => findByLabel(dialog, S.submit), { timeout: 8000, label: 'nút Chèn' });
    } catch (e) {
      // `.slice(0, n)`: `S.submit` gộp cả nhãn người dùng thêm ở trang Options,
      // nên độ dài của nó không có trần nào — mà bản chụp thì có.
      await recordReport(
        REPORT.SUBMIT_NOT_FOUND,
        { labelsTried: S.submit.slice(0, REPORT_LIMITS.labels) },
        () => dialogStructure(dialog)
      );
      throw e;
    }
  }

  /* ------------------------------------------------------------------ */
  /* thao tác cấp cao                                                    */
  /* ------------------------------------------------------------------ */

  /** Thêm nguồn từ URL (video public / unlisted). */
  async function addUrlSource(url, { timeout = 90000 } = {}) {
    // Đếm TRƯỚC khi mở hộp thoại: hộp thoại phủ lên trang và có thể làm danh
    // sách Nguồn không còn hiển thị được nữa.
    const before = countSources();
    const dialog = await ensureAddSourceDialog();

    const isYouTube = /youtube\.com|youtu\.be/i.test(url);
    await pickChip(dialog, isYouTube ? [S.youtubeChip, S.websiteChip] : [S.websiteChip]);

    const hit = await waitFor(() => queryFirstWith(dialog, S.css.urlInput), {
      timeout: 10000,
      label: 'ô nhập URL',
    });
    // Chụp TRƯỚC khi gõ: gõ xong thì Angular đổi class, thêm mat-error, và bản
    // chụp không còn là hộp thoại mà ta đã chọn ô trên đó nữa.
    if (root.NBLM_SELECTORS.BROAD_FALLBACK_SELECTORS.includes(hit.selector)) {
      await recordReport(REPORT.URL_INPUT_FALLBACK, { matchedSelector: hit.selector }, () => dialogStructure(dialog));
    }
    setValue(hit.el, url);
    await sleep(400);

    const submit = await findSubmitButton(dialog);
    clickReal(submit);

    const result = await awaitDialogResolution(timeout);
    if (!result.ok) {
      await closeDialog();
      return result;
    }
    return confirmSourceAdded(before);
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
    // Xem ghi chú cùng chỗ trong addUrlSource.
    const before = countSources();
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
      const submit = await findSubmitButton(dialog);

      const nhanNut = labelOf(submit).slice(0, 30);
      step = `bấm nút "${nhanNut}"`;
      clickReal(submit);

      step = 'chờ NotebookLM xử lý';
      const result = await awaitDialogResolution(timeout);
      if (!result.ok) {
        result.error = `[bước: ${step}${pickedChip ? '' : '; KHÔNG chọn được loại nguồn'}] ${result.error} — ${dialogSnapshot()}`;
        await closeDialog();
        return result;
      }

      step = 'đối chiếu số Nguồn';
      const confirmed = await confirmSourceAdded(before);
      if (!confirmed.ok) {
        // Nhãn nút đã bấm là mẩu tin quan trọng nhất ở đây: "số Nguồn không tăng"
        // một mình không phân biệt được bấm nhầm nút với bấm đúng mà server từ
        // chối. `dialogSnapshot()` không cứu được vì tới lúc này hộp thoại đã đóng.
        confirmed.error =
          `[bước: ${step}${pickedChip ? '' : '; KHÔNG chọn được loại nguồn'}] ${confirmed.error}` +
          ` — đã bấm nút "${nhanNut}"`;
      }
      return confirmed;
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
    REPORT,
    addUrlSource,
    addTextSource,
    inNotebook,
    closeDialog,
    // xuất ra để gỡ lỗi trong DevTools console
    _internals: { findByLabel, labelOf, labelsOf, queryFirst, queryFirstWith, clickReal, setValue, openDialog, countSources, confirmSourceAdded, dialogStructure, pageStructure, get selectors() { return S; } },
  };
})(globalThis);
