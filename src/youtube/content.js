/*
 * Isolated world. Giao diện trên YouTube:
 *   - Trang watch: nút "→ NotebookLM" và nút "Transcript" cạnh nút Like/Share.
 *   - Trang danh sách (playlist, kênh, tìm kiếm, trang chủ, Watch Later):
 *     checkbox chọn hàng loạt + thanh hành động nổi.
 *   - Trang playlist/kênh: thêm nút import TOÀN BỘ (quét qua InnerTube, không
 *     phụ thuộc vào việc đã cuộn tới đâu).
 *   - Nhận lệnh từ background để mô tả video / trích transcript / quét playlist.
 */
;(function () {
  'use strict';

  const {
    MSG, PRIVACY, BUNDLE, videoIdFrom, canonicalUrl, norm, sleep,
    badgeRejects, bundleVerdict, mapWithLimit,
  } = globalThis.NBLM;
  const T = globalThis.NBLM_TRANSCRIPT;
  const P = globalThis.NBLM_PANEL;
  const B = globalThis.NBLM_BRIDGE;

  let settings = Object.assign({}, globalThis.NBLM.DEFAULTS);
  const selected = new Map(); // videoId -> {videoId, title, privacyHint}
  let pageCtx = { kind: 'other' }; // playlist/kênh mà trang này import toàn bộ được

  globalThis.NBLM.getSettings().then((s) => {
    settings = s;
    refreshBulkUI();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[globalThis.NBLM.KEYS.SETTINGS]) {
      settings = Object.assign({}, globalThis.NBLM.DEFAULTS, changes[globalThis.NBLM.KEYS.SETTINGS].newValue || {});
      refreshBulkUI();
    }
  });

  /* ------------------------------------------------------------------ */
  /* nhắn tin với background                                             */
  /* ------------------------------------------------------------------ */

  async function send(type, payload) {
    try {
      return await chrome.runtime.sendMessage(Object.assign({ type }, payload || {}));
    } catch (e) {
      // Xảy ra khi extension vừa được nạp lại / cập nhật — báo cho người dùng
      // thay vì để promise rejection rơi vào hư không.
      return { error: `Không liên lạc được với extension (${(e && e.message) || e}). Hãy tải lại trang.` };
    }
  }

  async function enqueue(items) {
    if (!items.length) return null;
    const res = await send(MSG.ENQUEUE, { items });
    if (res && res.error) toast(`Lỗi: ${res.error}`, 'error');
    else if (res && res.added === 0) toast('Các video này đã có trong hàng đợi rồi.', 'warn');
    else toast(`Đã thêm ${(res && res.added) || items.length} video vào hàng đợi NotebookLM`, 'ok');
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* toast                                                               */
  /* ------------------------------------------------------------------ */

  let toastEl = null;
  let toastTimer = null;
  function toast(message, kind = 'ok') {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'nblm-toast';
      overlayRoot().appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.dataset.kind = kind;
    toastEl.classList.add('nblm-toast--show');
    // Toast vừa đổi nội dung là vừa đổi chiều cao; thẻ *Copy lại* đứng trên nó
    // phải đo lại, nếu không thì lượt sau nó nằm đè lên đúng bản tổng kết này.
    layoutRecopy();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('nblm-toast--show');
      layoutRecopy();
    }, 4200);
  }

  /* ------------------------------------------------------------------ */
  /* Đường trao tay — gom link vào clipboard rồi dừng                    */
  /* ------------------------------------------------------------------ */

  /**
   * Trần đồng thời cho cửa 3. Một video = một lượt `innertube('player')` bằng
   * phiên đăng nhập của người dùng, nên một playlist 200 video mà huy hiệu không
   * loại được cái nào là 200 lượt POST tới YouTube. Rate limit ở lượt chạy hàng
   * loạt là rủi ro đã ghi trong `WORKSPACE_PROTOCOL.md`, không phải lo xa.
   *
   * Con số 4 là SUY ĐOÁN mượn của ràng buộc 7 trong ticket 006 — chưa ai đo
   * ngưỡng thật của YouTube trên tài khoản owner. Đo rồi thì sửa ở đây.
   */
  const BUNDLE_LIMIT = 4;

  /**
   * Cầu dao: quá ngần này lượt hỏi hỏng LIÊN TIẾP thì dừng hỏi hẳn, phần còn lại
   * rơi về Hàng đợi. Fail-closed — thứ dừng lại là *quyền vào clipboard*, không
   * phải cả thao tác. Hỏng liên tiếp gần như luôn nghĩa là YouTube đang chặn, và
   * hỏi tiếp chỉ làm nó chặn lâu hơn.
   */
  const BUNDLE_BREAKER = 3;

  /**
   * Link bị cửa 2 loại ở lượt gần nhất — nguyên liệu cho nút *Copy lại*.
   *
   * Giữ ở đây chứ không hỏi lại service worker: danh sách phải là đúng cái người
   * dùng vừa được báo, không phải một danh sách tính lại sau đó.
   */
  let lastDropped = [];
  let lastDroppedFrom = '';

  /**
   * Khuôn dạng videoId của YouTube. Cửa 1 ép nó vì mọi thứ dưới đây giả định
   * `canonicalUrl(id)` rồi `videoIdFrom(...)` trả lại đúng `id` — mà `videoIdFrom`
   * mới là bên áp luật này, `canonicalUrl` thì chỉ nội suy chuỗi. Không ép ở đây
   * thì một id lệch khuôn sẽ rơi ra khỏi mọi rổ ở cửa 2 mà không ai đếm.
   */
  const VIDEO_ID = /^[\w-]{11}$/;

  /**
   * Cửa 1 — huy hiệu trên thẻ video. Miễn phí, CHỈ ĐƯỢC LOẠI.
   *
   * Khử trùng lặp theo `videoId` ngay tại đây: một playlist có thể chứa cùng một
   * video hai lần, và không gộp thì cửa 3 trả tiền hai lượt hỏi cho cùng một câu.
   *
   * `invalid` được trả RIÊNG chứ không `continue` im lặng: bỏ một mục mà không
   * đếm là đúng lỗi `sidebar.js` đã dính hai lần.
   */
  function badgeGate(candidates) {
    const restricted = [];
    const asking = [];
    const invalid = [];
    const seen = new Set();

    for (const c of candidates) {
      if (!c) continue;
      if (!c.videoId || !VIDEO_ID.test(c.videoId)) {
        if (c.videoId) invalid.push(c);
        continue;
      }
      if (seen.has(c.videoId)) continue;
      seen.add(c.videoId);
      const privacy = c.privacy || c.privacyHint;
      if (badgeRejects({ privacy, accessible: c.accessible })) restricted.push(c);
      else asking.push(c);
    }
    return { restricted, asking, invalid };
  }

  /**
   * Cửa 3 — hỏi player response. Vị ngữ DUY NHẤT cấp phép một URL vào clipboard.
   *
   * Cái neo: KHÔNG có đường nào tới `writeText` mà không qua đây. Nút *Copy lại*
   * cũng phải đi qua, và đó không phải nghi thức thừa — danh sách của nút đó là
   * `dropped`, thứ cửa 2 loại ra TRƯỚC khi ai hỏi player response, nên nó chưa
   * bao giờ được cấp phép. Bỏ cửa 3 khỏi nhánh đó là mở đúng cái vòng lặp ticket
   * 006 đã chỉ ra: cửa 3 đẩy video bị loại sang Hàng đợi, cửa 2 lại tra Hàng đợi,
   * nên video private vừa bị chặn ở lượt 1 nằm trong `dropped` ở lượt 2.
   *
   * @param {Array} candidates `{videoId, title, privacy|privacyHint, accessible}`
   * @returns {{urls: string[], restricted: Array, unknown: Array, tripped: boolean}}
   */
  async function askGate(candidates) {
    const restricted = [];
    const unknown = [];

    let strike = 0;   // lượt hỏng liên tiếp
    let tripped = false;

    const asked = await mapWithLimit(candidates, BUNDLE_LIMIT, async (c) => {
      if (tripped) return { c, meta: null };
      try {
        // `noFallback`: một lượt hỏi hỏng không được biến thành một lượt tải
        // nguyên trang watch — xem `getPlayerResponse` trong page-bridge.js.
        const meta = await T.describe(c.videoId, { noFallback: true });
        strike = 0;
        return { c, meta };
      } catch (_) {
        if (++strike >= BUNDLE_BREAKER) tripped = true;
        return { c, meta: null };
      }
    });

    const urls = [];
    for (const { c, meta } of asked) {
      const { verdict } = bundleVerdict(c.videoId, meta);
      if (verdict === BUNDLE.ACCEPT) urls.push(canonicalUrl(c.videoId));
      else if (verdict === BUNDLE.RESTRICTED) restricted.push(withMeta(c, meta));
      else unknown.push(withMeta(c, meta));
    }
    return { urls, restricted, unknown, tripped };
  }

  /**
   * Rót `meta` cửa 3 vừa mua được vào ứng viên trước khi nó rơi xuống Hàng đợi.
   *
   * Ứng viên đi vào cửa 3 có thể chỉ mang mỗi `videoId` — nhánh *Copy lại* dựng
   * chúng từ URL. Cửa 3 vừa trả tiền để biết tiêu đề và mức riêng tư thật; vứt
   * đi rồi để Hàng đợi hiện một dòng trống là trả tiền hai lần cho cùng câu hỏi.
   * Thứ ứng viên tự khai vẫn thắng: huy hiệu trên thẻ là quan sát tại chỗ.
   */
  function withMeta(c, meta) {
    if (!meta) return c;
    return {
      ...c,
      title: c.title || meta.title || '',
      privacy: c.privacy || c.privacyHint || meta.privacy || PRIVACY.UNKNOWN,
    };
  }

  /**
   * Gom rồi trao tay: ghi clipboard, và đẩy phần không đủ điều kiện về Hàng đợi.
   *
   * Ba cửa, theo đúng thứ tự này — và thứ tự là nội dung chứ không phải cách xếp:
   *
   *   cửa 1  huy hiệu, miễn phí, CHỈ ĐƯỢC LOẠI
   *   cửa 2  khử trùng qua Sổ đã copy + Hàng đợi, một lượt tin, CHỈ ĐƯỢC LOẠI
   *   cửa 3  hỏi player response, một request MỖI video, CHỈ ĐƯỢC NHẬN
   *
   * Cửa 2 đứng TRƯỚC cửa 3 vì cửa 3 là cửa duy nhất tốn tiền: chỉ thứ chưa nằm
   * ở đâu mới đáng hỏi. Đảo lại thì bấm *Copy link công khai* lần thứ hai trên
   * một playlist 200 video là 200 lượt POST tới YouTube để rồi vứt cả 200.
   *
   * Bó rỗng thì KHÔNG chạm clipboard. `writeText('')` xoá trắng thứ người dùng
   * đang giữ, và họ mất nó để đổi lấy một thông báo. Đây là ca thường gặp chứ
   * không phải ca biên: bấm copy lần thứ hai trên cùng một playlist là rơi thẳng
   * vào nó.
   *
   * Ba lý do bị loại được đếm RIÊNG. "Đã copy 0 link" là câu vô nghĩa; "cả 12
   * link đều private" thì hành động được.
   *
   * @param {boolean} opts.skipDedupe bỏ qua cửa 2 — dành riêng cho nút *Copy lại*.
   *   Nó KHÔNG bỏ qua cửa 3; xem ghi chú ở `askGate`.
   */
  async function handOff(candidates, { verb = 'Đã copy', from = '', skipDedupe = false } = {}) {
    const label = from || pageCtx.title || location.href;
    const gate1 = badgeGate(candidates);

    // Cửa 2 — khử trùng. Service worker là chỗ duy nhất cầm luật khoá.
    let toAsk = gate1.asking;
    let dropped = [];   // why === 'copied' — nút *Copy lại* đi tới được
    let queued = [];    // why === 'queued'  — KHÔNG, xem ghi chú dưới đây
    let lost = 0;       // url cửa 2 trả về mà không khớp ứng viên nào
    if (gate1.asking.length && !skipDedupe) {
      // Giữ ứng viên theo ĐÚNG chuỗi URL đã gửi đi, thay vì `videoIdFrom` chuỗi
      // trả về rồi dò lại. Vòng `canonicalUrl` → `videoIdFrom` là hai phép chuẩn
      // hoá của hai bên khác nhau; lệch một ký tự là ứng viên rơi khỏi mọi rổ mà
      // không ai đếm — đúng cái bẫy `gate1.invalid` sinh ra để chặn.
      const byUrl = new Map(gate1.asking.map((c) => [canonicalUrl(c.videoId), c]));
      const res = await send(MSG.BUNDLE_FILTER, { urls: [...byUrl.keys()] });
      if (res && res.error) {
        toast(`Không tra được Sổ đã copy: ${res.error} — chưa copy gì cả.`, 'error');
        // Cửa 1 đã kết luận xong phần của nó rồi. Bỏ luôn cả nhóm này chỉ vì cửa
        // 2 hỏng là vứt một kết luận không hề phụ thuộc vào cửa 2.
        if (gate1.restricted.length) await enqueueLeftover(gate1.restricted);
        return { copied: 0, error: res.error, restricted: gate1.restricted.length };
      }
      const out = ((res && res.dropped) || []).filter((d) => d && d.url);
      dropped = out.filter((d) => d.why === 'copied');
      queued = out.filter((d) => d.why !== 'copied');

      const kept = (res && res.keep) || [];
      toAsk = kept.map((u) => byUrl.get(u)).filter(Boolean);
      // Một toast riêng ở đây bị chính bản tổng kết đè mất vài nhịp sau — cùng
      // một phần tử toast. Con số đi CHUNG một câu thì mới đọc được.
      lost = kept.length - toAsk.length;
    }

    // Cửa 3 — chỉ chạy trên thứ cửa 2 cho qua.
    const { urls: keep, restricted: askedOut, unknown, tripped } = await askGate(toAsk);
    const restricted = gate1.restricted.concat(gate1.invalid, askedOut);
    const leftover = restricted.concat(unknown);

    // Chỉ nhánh ĐI QUA cửa 2 mới được động vào tấm thẻ *Copy lại*. Nhánh
    // `skipDedupe` chính là cú bấm nút đó; để nó tự dựng lại thẻ từ `dropped`
    // rỗng của mình là để nút tự xoá mình ngay giữa lượt chạy nó vừa mở.
    if (!skipDedupe) {
      if (dropped.length) showRecopy(dropped.map((d) => d.url), label);
      else hideRecopy();
    }

    if (!keep.length) {
      const why = [];
      if (restricted.length) why.push(`${restricted.length} video private/unlisted`);
      if (unknown.length) why.push(`${unknown.length} video không hỏi được`);
      if (dropped.length) why.push(`${dropped.length} link đã có trong Sổ đã copy`);
      if (queued.length) why.push(`${queued.length} link đang nằm trong Hàng đợi`);
      if (lost > 0) why.push(`${lost} link quay về không khớp ứng viên nào`);
      toast(
        why.length
          ? `Không link nào vào được Bó: ${why.join(' · ')}.${recopyHint(dropped, queued)}`
          : 'Không có video nào để copy.',
        'warn'
      );
      if (leftover.length) await enqueueLeftover(leftover);
      return {
        copied: 0, restricted: restricted.length, unknown: unknown.length,
        dropped: dropped.length, queued: queued.length,
      };
    }

    try {
      // `await` xong mới được làm gì tiếp — đóng giao diện trước khi clipboard
      // ghi xong là mất trắng nội dung.
      await navigator.clipboard.writeText(keep.join('\n'));
    } catch (e) {
      // Clipboard API từ chối khi tài liệu không được focus. Nói ra đường thủ
      // công thay vì im lặng nuốt — người dùng đang đứng trước một cái nút vừa
      // bấm mà không có gì xảy ra.
      toast(`Không ghi được clipboard (${(e && e.message) || e}) — tất cả đã vào Hàng đợi.`, 'error');
      // Sổ KHÔNG được ghi ở nhánh này. Clipboard chưa nhận gì cả.

      await enqueueLeftover(candidates.filter((c) => c && c.videoId));
      return { copied: 0, restricted: restricted.length, unknown: unknown.length, clipboardFailed: true };
    }

    // Ghi Sổ SAU khi clipboard đã nhận thật — ghi trước là để Sổ nói dối, và lần
    // sau nó lọc mất đúng những link chưa bao giờ tới clipboard.
    //
    // Kết quả phải được ĐỌC. Sổ hỏng là hỏng câm: lượt này vẫn xong, chỉ lượt
    // sau mới copy trùng, và lúc đó không còn gì trỏ về đây nữa.
    const book = await send(MSG.BUNDLE_COPIED, { urls: keep, from: label });
    const bookErr = (book && book.error) || (book ? '' : 'không có hồi âm');

    /*
     * Bản tổng kết phải dựng TRƯỚC cú nhảy, vì cú nhảy là thứ quyết định nó được
     * đọc ở đâu. `JUMP_NOTEBOOK` bật tab notebook lên và focus cửa sổ, nên tab
     * này thành tab nền — một toast ở đây là một bản báo cáo không ai đọc, và nó
     * mang đúng phần đáng đọc nhất ("12 private/unlisted → Hàng đợi"). Nhảy được
     * thì service worker báo bằng thông báo hệ thống; không nhảy được thì người
     * dùng còn đứng đây, và toast là đúng chỗ.
     */
    const parts = [`${verb} ${keep.length} link công khai`];
    if (restricted.length) parts.push(`${restricted.length} private/unlisted → Hàng đợi`);
    if (unknown.length) parts.push(`${unknown.length} không hỏi được → Hàng đợi`);
    if (dropped.length) parts.push(`${dropped.length} bỏ vì đã có trong Sổ — nút "Copy lại" ở góc màn hình`);
    if (queued.length) parts.push(`${queued.length} đang nằm trong Hàng đợi — mở popup để xử lý`);
    if (lost > 0) parts.push(`${lost} link quay về không khớp ứng viên nào — đã bỏ qua`);
    if (tripped) parts.push('đã dừng hỏi vì YouTube liên tục từ chối');
    if (bookErr) parts.push(`chưa ghi được Sổ đã copy (${bookErr}) — lần sau có thể copy trùng`);

    const jump = await send(MSG.JUMP_NOTEBOOK, { summary: parts.join(' · ') });
    if (!jump || !jump.jumped) {
      // Im lặng ở đây là im lặng sai: clipboard đã có nội dung mà người dùng không
      // biết mang đi đâu, và không có cú nhảy nào để tự nói hộ.
      parts.push(jumpWhy(jump));
      toast(parts.join(' · '), 'warn');
    } else if (bookErr || jump.noted === false) {
      // Nhảy được thì bản tổng kết đi bằng thông báo hệ thống — trừ khi thông báo
      // không tới nơi (`noted === false`), hoặc trong đó có tin xấu về Sổ. Cả hai
      // ca đều phải để lại vết trên chính tab này, vì tab kia không mang chúng.
      toast(parts.join(' · '), 'warn');
    }

    if (leftover.length) await enqueueLeftover(leftover);
    return {
      copied: keep.length,
      restricted: restricted.length,
      unknown: unknown.length,
      dropped: dropped.length,
      queued: queued.length,
      tripped,
    };
  }

  /** Vì sao không đứng trước ô "Thêm nguồn" — nói ra đường thủ công tương ứng. */
  function jumpWhy(jump) {
    const why = jump && jump.why;
    if (why === 'tab-gone') return 'tab notebook đã đóng — mở lại rồi Ctrl+V';
    if (why === 'no-target') return 'chưa đặt notebook đích — mở notebook rồi Ctrl+V';
    return 'không sang được notebook — mở notebook rồi Ctrl+V';
  }

  /**
   * Câu chỉ đường sau một lượt không copy được gì.
   *
   * *Copy lại* chỉ nhận thứ bị loại vì ĐÃ COPY. Thứ bị loại vì đang nằm trong
   * Hàng đợi thì hầu hết vào đó do chính cửa 3 đẩy xuống, nên đưa chúng ngược
   * lên cửa 3 là hỏi lại một câu vừa bị trả lời "không" — mất tiền, và cái nút
   * hứa một việc nó không làm được.
   */
  function recopyHint(dropped, queued) {
    const say = [];
    if (dropped.length) say.push('Dùng nút "Copy lại" ở góc màn hình để copy cả những cái đã có trong Sổ.');
    if (queued.length) say.push('Phần đang nằm trong Hàng đợi thì mở popup để xử lý.');
    if (!say.length) say.push('Tất cả đã vào Hàng đợi.');
    return ` ${say.join(' ')}`;
  }

  /**
   * Nút *Copy lại* — chỗ duy nhất đi tới `dropped`.
   *
   * Vì sao là một phần tử ĐỨNG YÊN chứ không phải "bấm lại nút cũ lần nữa":
   * nút cũ thường không còn ở đó. Thanh nổi tự gỡ mình khi hết mục được tick
   * (`renderBar`), và cú bấm copy nào cũng kết thúc bằng `clearSelection()`;
   * bảng *Import toàn bộ* thì đã đóng. Một lời dặn "bấm lại" trỏ vào một cái nút
   * đã biến mất thì tệ hơn im lặng.
   *
   * Cũng KHÔNG tự tắt sau vài giây: lượt copy thành công kết thúc bằng cú nhảy
   * sang tab notebook, nên người dùng chỉ nhìn lại tab này về sau. Nó phải còn
   * đó lúc họ quay lại, và chỉ biến mất khi họ bấm.
   */
  let recopyEl = null;

  /**
   * Số thế hệ của tấm thẻ. Tăng mỗi lần thẻ được dựng lại hoặc bị gỡ.
   *
   * Nó tồn tại vì `onRecopyClick` `await` một lượt `handOff` dài, và trong lúc
   * chờ, người dùng vẫn bấm được *Copy link công khai* ở chỗ khác — lượt đó có
   * `dropped` của riêng nó và có quyền thay thẻ. Cú `finally` của lượt cũ không
   * được phép dựng lại danh sách đã chết đè lên danh sách đang sống; so thế hệ
   * là cách duy nhất nó biết mình đã hết lượt.
   */
  let recopyGen = 0;

  /**
   * Dựng thẻ. KHÔNG bao giờ tự gỡ — danh sách rỗng là không có gì để nói, không
   * phải mệnh lệnh xoá thứ đang hiện. Chỉ `hideRecopy` mới được gỡ.
   */
  function showRecopy(urls, from) {
    const list = (Array.isArray(urls) ? urls : []).filter(Boolean);
    if (!list.length) return;

    lastDropped = list;
    lastDroppedFrom = from || '';
    recopyGen++;

    if (!recopyEl) {
      recopyEl = document.createElement('div');
      recopyEl.id = 'nblm-recopy';
      recopyEl.className = 'nblm-recopy';
      // Thẻ báo một việc vừa xảy ra mà không ai yêu cầu, nên `status`/`polite`:
      // đọc nốt câu đang đọc rồi mới nói, đừng cắt ngang.
      recopyEl.setAttribute('role', 'status');
      recopyEl.setAttribute('aria-live', 'polite');
      overlayRoot().appendChild(recopyEl);
    }

    const text = document.createElement('span');
    text.className = 'nblm-recopy__text';
    // Kèm nguồn: thẻ sống qua cả cú chuyển trang, nên "12 link" không nói được
    // 12 link CỦA CÁI GÌ khi người dùng đã sang playlist khác.
    text.textContent = lastDroppedFrom
      ? `${lastDropped.length} link từ "${short(lastDroppedFrom)}" đã có trong Sổ đã copy`
      : `${lastDropped.length} link đã có trong Sổ đã copy`;

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'nblm-recopy__go';
    go.dataset.act = 'recopy';
    go.textContent = `Copy lại ${lastDropped.length} link`;
    go.title = 'Copy cả những link đã có trong Sổ đã copy';
    go.addEventListener('click', onRecopyClick);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'nblm-recopy__x';
    x.dataset.act = 'dismiss';
    x.textContent = '×';
    x.title = 'Bỏ qua';
    // `×` là một ký tự nhân, không phải một cái tên. Trình đọc màn hình đọc nó
    // đúng như thế nếu không có nhãn.
    x.setAttribute('aria-label', 'Bỏ qua thẻ Copy lại');
    x.addEventListener('click', hideRecopy);

    recopyEl.replaceChildren(text, go, x);
    layoutRecopy();
  }

  function hideRecopy() {
    lastDropped = [];
    lastDroppedFrom = '';
    recopyGen++;
    if (recopyEl) {
      recopyEl.remove();
      recopyEl = null;
    }
  }

  /** Cắt nguồn cho vừa một dòng — tiêu đề playlist của YouTube dài tuỳ ý. */
  function short(s, max = 42) {
    const t = String(s || '').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  async function onRecopyClick(event) {
    const el = event.currentTarget;
    if (el.disabled) return;
    // Chụp lại TRƯỚC khi bất cứ ai ghi đè `lastDropped`.
    const urls = lastDropped.slice();
    const from = lastDroppedFrom;
    if (!urls.length) return hideRecopy();

    const gen = recopyGen;
    el.disabled = true;
    el.textContent = 'Đang hỏi…';

    let res = null;
    try {
      res = await handOff(
        urls.map((u) => ({ videoId: videoIdFrom(u) })).filter((c) => c.videoId),
        { verb: 'Đã copy lại', from, skipDedupe: true }
      );
    } finally {
      // Nhánh `skipDedupe` không động vào thẻ, nên số phận của thẻ là việc của
      // đúng chỗ này. Ba ca, và ca giữa mới là ca hay bị bỏ quên:
      //   - lượt này đã hết thời (`gen` cũ) → không đụng vào thẻ của lượt khác
      //   - copy được hết → gỡ thẻ
      //   - copy được MỘT PHẦN, hoặc ném giữa chừng → dựng lại đúng phần còn nợ
      if (recopyGen === gen) {
        if (res && res.copied) hideRecopy();
        else showRecopy(urls, from);
      }
    }
  }

  /**
   * Đặt thẻ ngay trên toast, đo theo chiều cao THẬT của toast.
   *
   * Khoảng cách cứng không làm được việc này: toast mang bản tổng kết nhiều vế
   * ("12 private/unlisted → Hàng đợi · 3 không hỏi được…") nên nó cao hai, ba,
   * bốn dòng tuỳ lượt. Một con số chọn cho hai dòng thì bốn dòng là chồng lên
   * nhau, và thứ bị che là cái nút.
   */
  function layoutRecopy() {
    if (!recopyEl) return;
    const up = toastEl && toastEl.isConnected && toastEl.classList.contains('nblm-toast--show');
    const h = up && toastEl.getBoundingClientRect ? toastEl.getBoundingClientRect().height : 0;
    // 24px là mép dưới của toast trong overlay.css; 12px là khe giữa hai thẻ.
    // Toast tắt rồi thì thẻ tụt xuống chỗ của nó — không có gì để tránh nữa.
    recopyEl.style.bottom = `${Math.round(h ? 24 + h + 12 : 24)}px`;
  }

  /**
   * Chỗ treo overlay. Fullscreen dựng một tầng riêng: mọi thứ ngoài phần tử
   * fullscreen đều không vẽ, kể cả `position: fixed` trên `<html>`. Phải treo
   * vào chính phần tử đó thì thẻ mới còn nhìn thấy được.
   */
  function overlayRoot() {
    return document.fullscreenElement || document.documentElement;
  }

  document.addEventListener('fullscreenchange', () => {
    const root = overlayRoot();
    for (const el of [toastEl, recopyEl]) {
      if (el && el.isConnected && el.parentNode !== root) root.appendChild(el);
    }
    layoutRecopy();
  });

  /** Xếp hàng phần bị loại, im lặng — người dùng đã đọc con số ở bản tổng kết rồi. */
  async function enqueueLeftover(items) {
    const payload = items.map((i) => ({
      videoId: i.videoId,
      title: i.title,
      privacy: i.privacy || i.privacyHint || PRIVACY.UNKNOWN,
    }));
    if (payload.length) await send(MSG.ENQUEUE, { items: payload });
  }

  /* ------------------------------------------------------------------ */
  /* nút trên trang watch                                                */
  /* ------------------------------------------------------------------ */

  function watchActionRow() {
    return (
      document.querySelector('#top-level-buttons-computed') ||
      document.querySelector('ytd-menu-renderer #top-level-buttons') ||
      document.querySelector('#actions #menu')
    );
  }

  function ensureWatchButton() {
    const videoId = T.currentVideoId();
    const row = watchActionRow();
    if (!videoId || !row) return;

    let btn = document.querySelector('#nblm-watch-button');
    if (btn && btn.parentElement === row) {
      btn.dataset.videoId = videoId;
    } else {
      if (btn) btn.remove();
      btn = document.createElement('button');
      btn.id = 'nblm-watch-button';
      btn.className = 'nblm-btn';
      btn.type = 'button';
      btn.dataset.videoId = videoId;
      btn.title = 'Thêm video này vào NotebookLM (video private sẽ được trích transcript cục bộ)';
      btn.innerHTML = '<span class="nblm-btn__dot"></span><span class="nblm-btn__label">NotebookLM</span>';
      btn.addEventListener('click', onWatchClick);
      row.prepend(btn);
    }

    /*
     * Nút THỨ BA, không phải sửa nút cũ. Nút "NotebookLM" và `onWatchClick` giữ
     * nguyên hành vi xếp hàng: nó là lối vào người dùng đã quen, và nút "→
     * NotebookLM" trong bảng transcript mang đúng nhãn đó. Hai nút cùng chữ mà
     * rẽ hai hướng là một cái bẫy — hoặc đổi cả hai, hoặc không đổi cái nào.
     */
    let cbtn = document.querySelector('#nblm-copy-button');
    if (cbtn && cbtn.parentElement === row) {
      cbtn.dataset.videoId = videoId;
    } else {
      if (cbtn) cbtn.remove();
      cbtn = document.createElement('button');
      cbtn.id = 'nblm-copy-button';
      cbtn.className = 'nblm-btn nblm-btn--ghost';
      cbtn.type = 'button';
      cbtn.dataset.videoId = videoId;
      cbtn.title = 'Copy link video vào clipboard để tự dán vào NotebookLM (chỉ video công khai)';
      cbtn.textContent = 'Copy link';
      cbtn.addEventListener('click', onCopyClick);
      btn.after(cbtn);
    }

    let tbtn = document.querySelector('#nblm-transcript-button');
    if (tbtn && tbtn.parentElement === row) {
      tbtn.dataset.videoId = videoId;
      return;
    }
    if (tbtn) tbtn.remove();

    tbtn = document.createElement('button');
    tbtn.id = 'nblm-transcript-button';
    tbtn.className = 'nblm-btn nblm-btn--ghost';
    tbtn.type = 'button';
    tbtn.dataset.videoId = videoId;
    tbtn.title = 'Xem, tìm, sao chép và tải transcript (chạy được cả với video private của bạn)';
    tbtn.textContent = 'Transcript';
    tbtn.addEventListener('click', () => {
      if (P.isOpen()) P.close();
      else P.open(tbtn.dataset.videoId, settings.preferredLangs);
    });
    cbtn.after(tbtn);
  }

  async function onCopyClick(event) {
    const el = event.currentTarget;
    const videoId = el.dataset.videoId;
    if (!videoId || el.disabled) return;

    el.disabled = true;
    const original = el.textContent;
    el.textContent = 'Đang hỏi…';
    try {
      await handOff([{ videoId }]);
    } finally {
      el.textContent = original;
      el.disabled = false;
    }
  }

  /** Panel gọi ngược lên đây khi bấm "→ NotebookLM", để dùng chung một đường xếp hàng. */
  globalThis.NBLM_SEND_CURRENT = function (videoId, meta) {
    enqueue([
      {
        videoId,
        title: meta && meta.title,
        channel: meta && meta.channel,
        durationSec: meta && meta.durationSec,
        privacy: (meta && meta.privacy) || PRIVACY.UNKNOWN,
      },
    ]);
  };

  async function onWatchClick(event) {
    const btn = event.currentTarget;
    const videoId = btn.dataset.videoId;
    if (!videoId || btn.disabled) return;

    btn.disabled = true;
    btn.classList.add('nblm-btn--busy');
    const label = btn.querySelector('.nblm-btn__label');
    const original = label.textContent;
    label.textContent = 'Đang đọc…';

    try {
      const meta = await T.describe(videoId);
      label.textContent = 'Đang xếp hàng…';
      await enqueue([
        {
          videoId,
          title: meta.title,
          channel: meta.channel,
          durationSec: meta.durationSec,
          privacy: meta.privacy,
          hasCaptions: meta.hasCaptions,
        },
      ]);
      if (meta.privacy === PRIVACY.PRIVATE) {
        toast('Video private — sẽ trích transcript ngay tại máy bạn, KHÔNG đổi chế độ hiển thị.', 'ok');
      }
    } catch (e) {
      // Vẫn xếp hàng được: background sẽ tự mở tab để lấy metadata.
      await enqueue([{ videoId, privacy: PRIVACY.UNKNOWN }]);
      toast(`Đã xếp hàng (chưa đọc được metadata: ${(e && e.message) || e})`, 'warn');
    } finally {
      label.textContent = original;
      btn.disabled = false;
      btn.classList.remove('nblm-btn--busy');
    }
  }

  /* ------------------------------------------------------------------ */
  /* chọn hàng loạt trên trang danh sách                                 */
  /* ------------------------------------------------------------------ */

  const ITEM_SELECTOR = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-panel-video-renderer',
  ].join(',');

  function readItem(node) {
    const link = node.querySelector('a#thumbnail[href], a#video-title[href], a.yt-simple-endpoint[href]');
    const videoId = link && videoIdFrom(link.getAttribute('href'));
    if (!videoId) return null;

    const titleEl = node.querySelector('#video-title, yt-formatted-string#video-title, h3 a');
    const title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';

    // Huy hiệu "Private"/"Unlisted" trên thẻ video cho phép biết trước mức riêng
    // tư, đỡ một vòng hỏi InnerTube. Chỉ đọc đúng phần tử huy hiệu — dò cả chữ
    // trong thẻ sẽ dính tiêu đề video có chứa từ "private".
    let privacyHint = PRIVACY.UNKNOWN;
    const badges = node.querySelectorAll('ytd-badge-supported-renderer, .badge, [class*="badge"]');
    for (const badge of badges) {
      const text = norm(badge.textContent);
      if (!text) continue;
      if (/\bprivate\b|\brieng tu\b/.test(text)) privacyHint = PRIVACY.PRIVATE;
      else if (/\bunlisted\b|khong cong khai/.test(text)) privacyHint = PRIVACY.UNLISTED;
    }
    return { videoId, title, privacyHint };
  }

  function decorateItem(node) {
    if (node.querySelector(':scope > .nblm-pick')) return;
    const info = readItem(node);
    if (!info) return;

    const box = document.createElement('label');
    box.className = 'nblm-pick';
    box.title = 'Chọn để import vào NotebookLM';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(info.videoId);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const fresh = readItem(node) || info;
      if (input.checked) selected.set(fresh.videoId, fresh);
      else selected.delete(fresh.videoId);
      renderBar();
    });

    box.appendChild(input);
    node.style.position = node.style.position || 'relative';
    node.appendChild(box);
  }

  function scanItems() {
    if (!settings.bulkSelectUI) return;
    document.querySelectorAll(ITEM_SELECTOR).forEach(decorateItem);
  }

  function removeBulkUI() {
    document.querySelectorAll('.nblm-pick').forEach((el) => el.remove());
    const bar = document.querySelector('#nblm-bar');
    if (bar) bar.remove();
  }

  function canImportAll() {
    return !!(pageCtx && (pageCtx.kind === 'playlist' || pageCtx.kind === 'channel') && pageCtx.playlistId);
  }

  function barButton(act, label, primary = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nblm-bar__btn' + (primary ? ' nblm-bar__btn--primary' : '');
    b.dataset.act = act;
    b.textContent = label;
    return b;
  }

  function renderBar() {
    let bar = document.querySelector('#nblm-bar');
    if (!selected.size && !canImportAll()) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'nblm-bar';
      bar.addEventListener('click', onBarClick);
      document.documentElement.appendChild(bar);
    }

    const count = document.createElement('span');
    count.className = 'nblm-bar__count';
    // textContent chứ không innerHTML: tiêu đề playlist là dữ liệu người khác đặt.
    count.textContent = selected.size ? `${selected.size} video đã chọn` : pageCtx.title || '';

    const parts = [count];
    if (canImportAll()) {
      parts.push(
        barButton('all-import', pageCtx.kind === 'channel' ? 'Import toàn bộ kênh' : 'Import toàn bộ playlist', true)
      );
    }
    if (selected.size) {
      parts.push(barButton('import', `Import ${selected.size} đã chọn`, !canImportAll()));
      parts.push(barButton('copy', `Copy ${selected.size} link`));
      parts.push(barButton('clear', 'Bỏ chọn'));
    }
    // Trang watch có playlist ở cột phải cũng vào được nhánh canImportAll(), mà ở
    // đó không có thẻ video nào để tick — đừng hiện nút không làm gì.
    if (settings.bulkSelectUI && document.querySelector(ITEM_SELECTOR)) {
      parts.push(barButton('all', 'Chọn hết trang'));
    }

    bar.replaceChildren(...parts);
  }

  function clearSelection() {
    selected.clear();
    document.querySelectorAll('.nblm-pick input').forEach((i) => (i.checked = false));
    renderBar();
  }

  async function onBarClick(event) {
    const act = event.target && event.target.dataset && event.target.dataset.act;
    if (!act) return;

    if (act === 'clear') return clearSelection();

    if (act === 'all') {
      document.querySelectorAll(ITEM_SELECTOR).forEach((node) => {
        const info = readItem(node);
        if (info) selected.set(info.videoId, info);
        const input = node.querySelector(':scope > .nblm-pick input');
        if (input) input.checked = true;
      });
      renderBar();
      return;
    }

    if (act === 'copy') {
      const picked = Array.from(selected.values());
      const el = event.target;
      const original = el.textContent;
      el.disabled = true;
      el.textContent = 'Đang hỏi…';
      try {
        // Cửa 3 hỏi TỪNG videoId đã tick, tại đây chứ không lúc tick. "Chọn hết
        // trang" tick mọi thẻ đã cuộn qua, nên đây có thể là hàng trăm lượt hỏi.
        await handOff(picked);
      } finally {
        el.textContent = original;
        el.disabled = false;
      }
      clearSelection();
      return;
    }

    if (act === 'import') {
      const items = Array.from(selected.values()).map((i) => ({
        videoId: i.videoId,
        title: i.title,
        privacy: i.privacyHint,
      }));
      clearSelection();
      await enqueue(items);
      return;
    }

    if (act === 'all-import') await importEverything(event.target);
  }

  /* ------------------------------------------------------------------ */
  /* import toàn bộ playlist / kênh                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Quét qua InnerTube chứ không đọc DOM: "Chọn hết trang" chỉ lấy được những
   * video đã cuộn tới, còn cách này lấy đủ cả playlist vài trăm video.
   */
  async function importEverything(button) {
    const ctx = pageCtx;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Đang quét…';

    try {
      const res = await B.call(
        'playlist',
        { playlistId: ctx.playlistId, max: settings.maxBulkVideos },
        180000
      );
      const all = res.items || [];
      const usable = all.filter((i) => i.accessible);
      const blocked = all.length - usable.length;
      const priv = usable.filter((i) => i.privacy === PRIVACY.PRIVATE).length;

      if (!usable.length) {
        toast('Không tìm thấy video nào import được ở đây.', 'warn');
        return;
      }

      const lines = [`Tìm thấy ${usable.length} video trong "${ctx.title}".`];
      if (priv) lines.push(`${priv} video private của bạn — sẽ trích transcript tại máy, không đổi chế độ hiển thị.`);
      if (blocked) lines.push(`${blocked} video bị bỏ qua vì bạn không có quyền xem (private của người khác, hoặc đã xoá).`);
      if (res.truncated) lines.push(`Đã dừng ở giới hạn ${settings.maxBulkVideos} video — chỉnh trong Cài đặt nếu cần nhiều hơn.`);
      lines.push('Video đã có trong hàng đợi sẽ tự động bị loại.');

      const act = await chooseDialog({
        title: 'Import toàn bộ vào NotebookLM?',
        lines,
        actions: [
          { act: 'copy', label: 'Copy link công khai' },
          { act: 'import', label: `Import ${usable.length} video`, primary: true },
        ],
      });
      if (!act) return;   // Huỷ — và huỷ tốn ĐÚNG 0 lượt hỏi player response

      if (act === 'copy') {
        // Cửa 3 chạy ở đây, sau khi người dùng đã chọn — không phải lúc quét
        // xong. Đối xứng với cửa đo docs: bấm rồi mới trả tiền.
        await handOff(usable);
        return;
      }

      await enqueue(
        usable.map((i) => ({
          videoId: i.videoId,
          title: i.title,
          channel: i.channel,
          durationSec: i.durationSec,
          privacy: i.privacy,
        }))
      );
    } catch (e) {
      toast(`Không quét được danh sách: ${(e && e.message) || e}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  /**
   * Hộp chọn hành động, dựng bằng DOM — nội dung có tiêu đề video nên tránh innerHTML.
   *
   * Trả về **tên hành động** hoặc `null` khi huỷ, chứ không phải boolean. Đó là
   * đổi chữ ký chứ không phải thêm một cái nút: hộp này giờ có hai lối đi khác
   * hẳn nhau — xếp hàng, hoặc trao tay qua clipboard — và một boolean không nói
   * được cái nào.
   */
  function chooseDialog({ title, lines, actions, cancelLabel = 'Huỷ' }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'nblm-modal';

      const box = document.createElement('div');
      box.className = 'nblm-modal__box';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      const h = document.createElement('h2');
      h.className = 'nblm-modal__title';
      h.textContent = title;
      box.appendChild(h);

      for (const line of lines) {
        const p = document.createElement('p');
        p.className = 'nblm-modal__line';
        p.textContent = line;
        box.appendChild(p);
      }

      const row = document.createElement('div');
      row.className = 'nblm-modal__row';

      const no = barButton('no', cancelLabel);
      no.className = 'nblm-modal__btn';
      row.appendChild(no);

      const buttons = actions.map((a) => {
        const b = barButton(a.act, a.label, !!a.primary);
        b.className = 'nblm-modal__btn' + (a.primary ? ' nblm-modal__btn--primary' : '');
        row.appendChild(b);
        return b;
      });

      box.appendChild(row);
      back.appendChild(box);

      const finish = (value) => {
        back.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') finish(null);
      };

      no.addEventListener('click', () => finish(null));
      buttons.forEach((b, i) => b.addEventListener('click', () => finish(actions[i].act)));
      back.addEventListener('click', (e) => {
        if (e.target === back) finish(null);
      });
      document.addEventListener('keydown', onKey);

      document.documentElement.appendChild(back);
      (buttons.find((_, i) => actions[i].primary) || buttons[0] || no).focus();
    });
  }

  /** Hỏi cầu nối trang xem đây có phải playlist/kênh import toàn bộ được không. */
  async function refreshContext() {
    try {
      pageCtx = await B.call('context', {}, 15000);
    } catch (_) {
      pageCtx = { kind: 'other' };
    }
    renderBar();
  }

  function refreshBulkUI() {
    if (settings.bulkSelectUI) scanItems();
    else removeBulkUI();
  }

  /* ------------------------------------------------------------------ */
  /* vòng đời SPA                                                        */
  /* ------------------------------------------------------------------ */

  let scanTimer = null;
  let lastUrl = location.href;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      ensureWatchButton();
      scanItems();
      // MutationObserver bắn liên tục trên YouTube, mà hỏi cầu nối trang thì tốn;
      // chỉ hỏi lại khi URL thực sự đổi.
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onNavigate();
      }
    }, 350);
  }

  function onNavigate() {
    selected.clear();
    P.reset();
    P.close();
    renderBar();
    refreshContext();
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('yt-navigate-finish', () => {
    lastUrl = location.href;
    onNavigate();
    scheduleScan();
  });

  scheduleScan();
  refreshContext();

  /* ------------------------------------------------------------------ */
  /* lệnh từ background                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Chỉ những loại tin script này thực sự xử lý — xem ghi chú cùng tên trong
   * `src/docs/content.js`. Trả lời tin của script khác là cướp mất phản hồi của
   * nó (Chrome lấy câu trả lời đến trước), và lỗi hiện ra sẽ trỏ sai chỗ hoàn toàn.
   */
  const HANDLED = new Set([
    MSG.YT_PING, MSG.YT_DESCRIBE, MSG.YT_EXTRACT, MSG.YT_CONTEXT, MSG.YT_PLAYLIST, 'nblm-toast',
    MSG.SHORTCUT_HANDOFF,
  ]);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !HANDLED.has(message.type)) return false; // của script khác — im lặng
    (async () => {
      try {
        switch (message.type) {
          case MSG.YT_PING:
            sendResponse({ ok: true, videoId: T.currentVideoId() });
            return;

          case MSG.YT_DESCRIBE:
            sendResponse({ ok: true, meta: await T.describe(message.videoId) });
            return;

          case MSG.YT_EXTRACT: {
            // Trang cần ổn định trước khi quét panel transcript.
            if (document.readyState !== 'complete') {
              await new Promise((r) => window.addEventListener('load', r, { once: true }));
            }
            await sleep(600);
            const result = await T.extract(message.videoId, message.langs);
            sendResponse({ ok: true, result });
            return;
          }

          case MSG.YT_CONTEXT:
            sendResponse({ ok: true, context: await B.call('context', {}, 15000) });
            return;

          case MSG.YT_PLAYLIST: {
            const res = await B.call(
              'playlist',
              { playlistId: message.playlistId, max: message.max || settings.maxBulkVideos },
              180000
            );
            sendResponse({ ok: true, ...res });
            return;
          }

          case MSG.SHORTCUT_HANDOFF: {
            /*
             * Phím tắt vòng qua service worker rồi về đây. `handled: true` nghĩa
             * là lượt này đã có kết cục — copy được, hoặc `handOff` đã tự xếp
             * hàng phần không copy được. Service worker đọc đúng cờ này để biết
             * có phải xếp hàng thay không, nên nó KHÔNG được đặt trước khi
             * `handOff` chạy xong.
             *
             * Chỗ này là nơi câu hỏi "phím tắt còn giữ được user activation
             * không" được trả lời bằng hành vi thật chứ bằng phán đoán: nếu
             * `writeText` từ chối, `handOff` đi nhánh clipboardFailed, tự xếp
             * hàng, và vẫn trả về handled — người dùng mất Bó link nhưng không
             * mất video.
             */
            const res = await handOff([{ videoId: message.videoId }], { from: 'Phím tắt' });
            // Nhánh duy nhất `handOff` KHÔNG tự xếp hàng: tra Sổ hỏng. Nhận
            // handled ở đó là bỏ rơi video giữa đường.
            sendResponse({ handled: !(res && res.error) });
            return;
          }

          case 'nblm-toast':
            toast(message.message, message.kind);
            sendResponse({ ok: true });
            return;

          default:
            sendResponse({ ok: false, error: `lệnh lạ: ${message.type}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || String(e) });
      }
    })();
    return true; // giữ kênh cho phản hồi bất đồng bộ
  });

  // Phím tắt Alt+Shift+Y đi qua background, nhưng cũng hỗ trợ khi focus ở trang.
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'Y' || e.key === 'y')) {
      const btn = document.querySelector('#nblm-watch-button');
      if (btn) btn.click();
    }
  });
})();
