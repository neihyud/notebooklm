/*
 * Isolated world. Điều phối chuỗi phương án lấy transcript.
 *
 * Thứ tự thử:
 *   1. InnerTube get_transcript  (qua page-bridge, dùng phiên đăng nhập của bạn)
 *   2. timedtext baseUrl         (nhanh, nhưng nhiều video bị chặn PoToken)
 *   3. Quét DOM panel "Show transcript" trên chính trang watch
 *      -> đáng tin nhất, vì player thật của YouTube tự sinh PoToken.
 *
 * Cách 3 chỉ dùng được khi tab đang mở đúng video đó; background sẽ tự mở tab
 * nền cho từng video khi cần.
 */
;(function (root) {
  'use strict';

  const { waitFor, sleep } = root.NBLM;

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function currentVideoId() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('v') || (/^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(u.pathname) || [])[1] || null;
    } catch (_) {
      return null;
    }
  }

  /** "1:23" / "01:02:03" -> giây */
  function parseTimestamp(text) {
    const parts = String(text || '').trim().split(':').map((p) => parseInt(p, 10));
    if (!parts.length || parts.some(Number.isNaN)) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  const TRANSCRIPT_LABEL = /(show\s*transcript|open\s*transcript|transcript|ban\s*chep\s*loi|chep\s*loi|hien\s*ban\s*ghi|xem\s*ban\s*ghi)/i;

  /**
   * Mọi thứ do extension chèn vào trang.
   *
   * BẮT BUỘC phải loại trừ: nút "Transcript" của chính extension cũng khớp
   * TRANSCRIPT_LABEL, lại nằm đầu hàng nút nên được tìm thấy TRƯỚC nút thật của
   * YouTube. Kết quả là hàm dưới bấm vào chính nó, panel YouTube không bao giờ
   * mở, và phương án DOM — vốn là đường đáng tin nhất cho video private — chết
   * câm. Đã xảy ra thật.
   */
  const OWN_UI = '[id^="nblm-"], .nblm-modal, .nblm-toast, .nblm-pick';

  function isOwnUi(el) {
    return !!(el.closest && el.closest(OWN_UI));
  }

  function labelOf(el) {
    return root.NBLM.norm(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`);
  }

  /**
   * Bấm chuột "thật".
   *
   * Nút "Show transcript" ở layout YouTube mới KHÔNG phản ứng với `el.click()`
   * đơn thuần — đã kiểm chứng trên trang thật: .click() để panel ở trạng thái
   * HIDDEN, còn chuỗi pointer đầy đủ thì panel chuyển sang EXPANDED. Cùng bài
   * học đã gặp với Angular Material bên NotebookLM (xem clickReal ở automation.js).
   */
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

  function findTranscriptButton() {
    const candidates = Array.from(
      document.querySelectorAll(
        'button, tp-yt-paper-button, ytd-button-renderer, ytd-menu-service-item-renderer, [role="menuitem"], [role="button"]'
      )
    ).filter((el) => isVisible(el) && !isOwnUi(el) && TRANSCRIPT_LABEL.test(labelOf(el)));

    if (!candidates.length) return null;

    // Ưu tiên nhãn nói rõ hành động ("Show transcript") hơn nhãn trống trơn chỉ
    // có mỗi chữ "transcript", vốn dễ là tiêu đề mục hoặc nhãn của thứ khác.
    const explicit = /(show|open|hien|xem)\s*(transcript|ban\s*chep\s*loi|ban\s*ghi)/i;
    const picked = candidates.find((el) => explicit.test(labelOf(el))) || candidates[0];

    // Nhắm phần tử bấm được TRONG CÙNG. querySelectorAll trả theo thứ tự DOM nên
    // wrapper <ytd-button-renderer> luôn đứng trước <button> thật bên trong nó, mà
    // bấm vào wrapper thì YouTube không phản hồi. Đã kiểm chứng trên trang thật.
    const inner = picked.querySelector('button, [role="button"]');
    return inner && isVisible(inner) ? inner : picked;
  }

  /** Nút transcript nằm trong phần mô tả đã mở rộng, nên phải bung mô tả trước. */
  async function expandDescription() {
    const expander =
      document.querySelector('#description-inline-expander #expand') ||
      document.querySelector('tp-yt-paper-button#expand') ||
      document.querySelector('#expand');
    if (expander && isVisible(expander)) {
      clickReal(expander);
      await sleep(400);
    }
  }

  /*
   * YouTube tồn tại song song HAI layout transcript và phải đỡ được cả hai:
   *
   *   cũ  — <ytd-transcript-renderer> chứa <ytd-transcript-segment-renderer>
   *          với .segment-timestamp và .segment-text
   *   mới — engagement panel target-id "PAmodern_transcript_view" chứa
   *          <transcript-segment-view-model> với .ytwTranscriptSegmentViewModelTimestamp
   *          và một <span role="text"> chứa lời thoại
   *
   * Bản mới đã được xác minh trên trang thật; bản cũ giữ lại vì YouTube tung
   * layout theo từng nhóm người dùng, không đồng loạt.
   */
  function transcriptPanel() {
    const legacy = document.querySelector('ytd-transcript-renderer, ytd-transcript-search-panel-renderer');
    if (legacy && isVisible(legacy)) return legacy;

    return (
      Array.from(document.querySelectorAll('ytd-engagement-panel-section-list-renderer')).find(
        (p) => /transcript/i.test(p.getAttribute('target-id') || '') && isVisible(p)
      ) || null
    );
  }

  function segmentNodes() {
    return Array.from(
      document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model')
    );
  }

  function segmentStamp(node) {
    const el = node.querySelector('.ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp');
    return el ? el.textContent : '';
  }

  /**
   * Lấy lời thoại của một dòng.
   *
   * Bẫy ở layout mới: cạnh mốc thời gian hiển thị còn có một div nhãn trợ năng
   * ("1 second"). Dùng innerText của cả dòng sẽ nuốt luôn chuỗi đó vào giữa
   * transcript. Nên nhắm đúng span lời thoại, và nếu không thấy thì cắt bỏ hai
   * div mốc thời gian rồi mới lấy phần còn lại.
   */
  function segmentText(node) {
    const legacy = node.querySelector('yt-formatted-string.segment-text, .segment-text');
    if (legacy) return legacy.textContent || '';

    const span = node.querySelector('span[role="text"], .ytAttributedStringHost');
    if (span) return span.textContent || '';

    const clone = node.cloneNode(true);
    clone
      .querySelectorAll('.ytwTranscriptSegmentViewModelTimestamp, .ytwTranscriptSegmentViewModelTimestampA11yLabel')
      .forEach((el) => el.remove());
    return clone.textContent || '';
  }

  /**
   * Trần số vòng cuộn. Phải có trần: danh sách ảo hoá của YouTube không có dấu
   * hiệu "hết" nào đọc được, nên vòng lặp chỉ dừng được bằng hai điều — số dòng
   * thôi tăng, hoặc hết ngân sách.
   */
  const SCROLL_ROUNDS = 40;

  /**
   * Cuộn hết danh sách cho tới khi số dòng không tăng nữa.
   *
   * @returns {{settled: boolean, rounds: number}} `settled:false` = ra khỏi vòng
   * lặp vì HẾT NGÂN SÁCH chứ không phải vì danh sách đã hết. Người gọi bắt buộc
   * phải phân biệt: đó là ranh giới giữa "đủ transcript" và "mất phần đuôi mà
   * không ai biết".
   */
  async function loadAllSegments() {
    const panel = transcriptPanel();
    const container =
      document.querySelector('ytd-transcript-segment-list-renderer #segments-container') ||
      document.querySelector('#segments-container') ||
      (panel && Array.from(panel.querySelectorAll('*')).find((el) => el.scrollHeight > el.clientHeight + 50)) ||
      panel;
    let previous = -1;
    let settled = false;
    let rounds = 0;
    for (let i = 0; i < SCROLL_ROUNDS; i++) {
      rounds = i + 1;
      const count = segmentNodes().length;
      if (count === previous) {
        settled = true;
        break;
      }
      previous = count;
      if (container && container.scrollHeight > container.clientHeight) {
        container.scrollTop = container.scrollHeight;
      } else {
        const last = segmentNodes().pop();
        if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' });
      }
      await sleep(250);
    }
    if (container) container.scrollTop = 0;
    return { settled, rounds };
  }

  /** Phương án 3: quét panel transcript trên trang. */
  async function fromPanel() {
    if (!transcriptPanel() && !segmentNodes().length) {
      await expandDescription();
      const button = findTranscriptButton();
      if (!button) throw new Error('không tìm thấy nút "Hiện bản chép lời" trên trang');
      const label = (button.getAttribute('aria-label') || button.textContent || '').replace(/\s+/g, ' ').trim();
      clickReal(button);

      // Chờ panel HOẶC các dòng transcript. Chỉ chờ mỗi panel là hỏng khi
      // isVisible() trả false lúc panel đang trượt vào, hoặc khi YouTube đổi tên
      // phần tử bọc — trong khi các dòng thì đã có sẵn trong DOM.
      try {
        await waitFor(() => transcriptPanel() || segmentNodes().length > 0, {
          timeout: 20000,
          label: 'panel transcript',
        });
      } catch (_) {
        throw new Error(
          `panel transcript không mở sau khi bấm nút "${label.slice(0, 60)}" — ` +
            'có thể nút đó không phải nút transcript, hoặc video này không có bản chép lời'
        );
      }
    }
    await waitFor(() => segmentNodes().length > 0, { timeout: 15000, label: 'các dòng transcript' });
    const scan = await loadAllSegments();

    const segments = segmentNodes()
      .map((node) => ({
        start: parseTimestamp(segmentStamp(node)),
        end: null,
        text: segmentText(node).replace(/\s+/g, ' ').trim(),
      }))
      .filter((s) => s.text);

    if (!segments.length) throw new Error('panel transcript rỗng');

    // Hết ngân sách cuộn trong khi danh sách VẪN còn dài ra: phần đuôi chắc chắn
    // còn thiếu. Vẫn trả về phần đã lấy được — nó dùng được — nhưng kèm theo lý
    // do, vì hai nhánh ở đây trả cùng một hình dạng và người gọi không có cách
    // nào khác để phân biệt.
    return {
      segments,
      method: 'dom:panel',
      truncated: scan.settled
        ? null
        : `Chỉ lấy được ${segments.length} dòng: danh sách transcript vẫn còn dài ra sau ${scan.rounds} vòng cuộn ` +
          '(trần của extension), nên phần đuôi của video này nhiều khả năng bị thiếu.',
    };
  }

  /* ------------------------------------------------------------------ */
  /* điều phối                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * @param {boolean} opts.noFallback xem `getPlayerResponse` trong `page-bridge.js`
   *   — người gọi hàng loạt tắt nhánh tải trang watch để một lượt hỏi hỏng không
   *   biến thành một lượt tải HTML đầy đủ.
   */
  async function describe(videoId, { noFallback = false } = {}) {
    return root.NBLM_BRIDGE.call(
      'meta',
      { videoId: videoId || currentVideoId(), noFallback },
      30000
    );
  }

  /**
   * Số hiệu build, gắn vào mọi thông báo lỗi.
   *
   * Lý do rất cụ thể: Chrome giữ nguyên code cũ trong các tab đang mở cho tới khi
   * extension được reload VÀ tab được tải lại. Đã mất một vòng chẩn đoán vì báo
   * lỗi từ build cũ trông y hệt báo lỗi từ build mới. Có số hiệu thì nhìn dòng
   * lỗi là biết ngay đang chạy bản nào.
   */
  function build() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_) {
      return '?';
    }
  }

  /**
   * @returns {{meta: object, segments: Array, method: string}}
   */
  async function extract(videoId, langs) {
    const id = videoId || currentVideoId();
    if (!id) throw new Error('Không xác định được videoId');

    const attempts = [];
    let meta = null;

    // 1 + 2: hai đường trong ngữ cảnh trang.
    try {
      const viaPage = await root.NBLM_BRIDGE.call('transcript', { videoId: id, langs }, 60000);
      if (viaPage) {
        meta = viaPage.meta || null;
        if (viaPage.segments && viaPage.segments.length) return viaPage;
        if (viaPage.attempts) attempts.push(...viaPage.attempts);
      }
    } catch (e) {
      attempts.push(`page-bridge: ${(e && e.message) || e}`);
    }

    // 3: quét DOM — chỉ khi tab này đúng là trang của video đó.
    if (currentVideoId() === id) {
      try {
        const viaDom = await fromPanel();
        return Object.assign({ meta: meta || (await describe(id).catch(() => null)) }, viaDom);
      } catch (e) {
        attempts.push(`dom: ${(e && e.message) || e}`);
      }
    } else {
      attempts.push('dom: tab hiện tại không phải trang của video này');
    }

    // Không lấy được meta thì mọi chẩn đoán bên dưới đều vô nghĩa — hỏi lại lần cuối.
    if (!meta) meta = await describe(id).catch(() => null);

    if (meta && meta.hasCaptions === false) {
      throw new Error(
        'Video này không có phụ đề nào (kể cả tự động), nên không có gì để trích. ' +
          'Vào YouTube Studio → video này → Phụ đề để bật hoặc tải phụ đề lên, rồi thử lại. ' +
          'YouTube thường chưa sinh phụ đề tự động cho video mới tải lên.'
      );
    }

    // Có phụ đề nhưng cả ba đường đều hỏng: kèm luôn tình trạng video vào thông
    // báo, vì nếu không thì người đọc log không tài nào phân biệt được
    // "phụ đề bị chặn" với "video không phát được".
    const facts = [];
    if (meta) {
      const langs_ = (meta.captionLangs || []).map((l) => `${l.code}${l.kind === 'asr' ? '(tự động)' : ''}`);
      facts.push(`phụ đề: ${langs_.length ? langs_.join(', ') : 'không có'}`);
      if (meta.playable === false) facts.push(`video không phát được: ${meta.reason || 'không rõ lý do'}`);
      if (meta.privacy) facts.push(`chế độ: ${meta.privacy}`);
    }
    throw new Error(
      `[build ${build()}] Không lấy được transcript${facts.length ? ` (${facts.join('; ')})` : ''}. ` +
        `Đã thử — ${attempts.join(' | ')}`
    );
  }

  root.NBLM_TRANSCRIPT = { extract, describe, currentVideoId, fromPanel };
})(globalThis);
