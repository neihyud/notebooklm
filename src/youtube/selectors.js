// MỌI selector và nhãn của YouTube nằm ở đây — và chỉ ở đây.
//
// Cùng lý do với `src/notebooklm/selectors.js`: đường DOM dựa hoàn toàn vào giao diện của một
// sản phẩm không có API, nên nó sẽ hỏng khi Google đổi layout. Selector rải rác ra file khác
// là nợ không trả được (`WORKSPACE_PROTOCOL.md`) — `test/transcript.test.js` canh chuyện đó.
//
// Hai nhóm tách hẳn nhau vì cách gộp ghi đè khác nhau:
//   - `selectors`: chuỗi CSS, giữ nguyên chữ hoa và dấu. `[visibility="…_HIDDEN"]` mà bị hạ
//     chữ thường là hỏng câm.
//   - `labels`: chữ hiển thị, luôn bỏ dấu và hạ chữ thường để khớp mờ (spec 0001).
//
// Classic script như `src/common/shared.js` — content script của MV3 không nạp `import`.
(function (root) {
  'use strict';

  if (root.NBLM_YT_SELECTORS) return;

  const S = root.NBLM_SHARED;
  if (!S) throw new Error('youtube/selectors: cần src/common/shared.js nạp trước');

  const DEFAULT_SELECTORS = Object.freeze({
    /** Ứng viên để dò nút theo chữ hiển thị: gồm cả wrapper, vì chữ nằm ở wrapper. */
    clickable: ['button', 'a', 'ytd-button-renderer', 'yt-button-shape', 'tp-yt-paper-button', '[role="button"]'],
    /** Phần tử thật sự nhận cú bấm. Wrapper **không** nằm trong danh sách này. */
    pressable: ['button', 'a', 'tp-yt-paper-button', '[role="button"]'],
    /**
     * Vùng chứa transcript. Bốn mục, và mục `data-target-id` **không** thừa: đo trên trang thật
     * của `jNQXAC9IVRw` (ticket 017), panel đang mở là một
     * `ytd-engagement-panel-section-list-renderer` **không mang `target-id` nào**, còn danh tính
     * transcript nằm ở `data-target-id="PAmodern_transcript_view"` của `yt-section-list-renderer`
     * bên trong nó. Ba panel *có* `target-id*="transcript"` trên cùng trang ấy thì đều đang ẩn và
     * rỗng — nên bắt panel bằng riêng `target-id` là nhìn thấy đúng những panel không có gì, rồi
     * kết luận sai rằng cửa sổ quá hẹp.
     *
     * Hệ quả: hai mục có thể khớp **lồng nhau** trên cùng một trang (panel ngoài và khối trong).
     * `scanTranscriptPanel` phải khử trùng dòng segment, nếu không transcript ra gấp đôi.
     * Hai mục cuối là layout cũ, giữ để không hỏng câm.
     */
    panel: [
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
      '[target-id*="transcript"]',
      '[data-target-id*="transcript"]',
      'ytd-transcript-renderer',
    ],
    /**
     * Trạng thái YouTube giữ panel ở layout hẹp — không có gì để quét.
     *
     * Xét bằng `closest`, không bằng `matches`: khối trong (`data-target-id`) không mang thuộc
     * tính này, nó thừa hưởng trạng thái ẩn từ panel ngoài. Xét bằng `matches` thì một panel
     * đang ẩn có khối trong lại được coi là đang mở.
     */
    panelHidden: ['[visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"]'],
    segment: ['transcript-segment-view-model', 'ytd-transcript-segment-renderer'],
    /**
     * Mốc thời gian trong một dòng. Mục đầu là layout hiện tại (đo trên trang thật, ticket 017),
     * hai mục sau là layout cũ.
     *
     * Không bắt được mốc thì `parseClock('')` trả 0 — **mọi** segment mốc 0, và `srt.js` vẫn
     * dựng ra file đủ dòng đủ chữ mở lên xem được, chỉ là mọi dòng nằm ở giây 0. Hỏng kiểu này
     * không có triệu chứng nào ngoài việc bấm mốc thì nhảy sai chỗ.
     */
    segmentTimestamp: ['.ytwTranscriptSegmentViewModelTimestamp', '.segment-timestamp', '.segment-start-offset'],
    /** Chữ của dòng. Layout hiện tại gói nó trong `span.ytAttributedStringHost[role="text"]`. */
    segmentText: ['.ytAttributedStringHost', '.segment-text'],
    /**
     * Nhãn trợ năng lẫn trong dòng segment ("1 second"). Đường chính là `segmentText` nên nó
     * không bao giờ lọt vào khi selector chính còn khớp; danh sách này chỉ đỡ cho đường dự
     * phòng. Tên lớp ở đây là thứ dễ lệch nhất khi YouTube đổi layout — `tools/verify-live.mjs`
     * là chỗ phát hiện.
     *
     * Mục đầu là bài học của ticket 017: ở layout hiện tại nhãn ấy **không** mang `aria-hidden`
     * (chính ô *mốc* mới mang), nên hai mục sau không đỡ được nó và đường dự phòng dán "1 second"
     * vào đầu mỗi dòng transcript.
     */
    segmentNoise: [
      '.ytwTranscriptSegmentViewModelTimestampA11yLabel',
      '.segment-duration-label',
      '[class*="duration-label"]',
      '[aria-hidden="true"]',
    ],
    /** Hàng nút Like/Share dưới player — chỗ nút của extension chen vào (ticket 005). */
    actionBar: [
      '#top-level-buttons-computed',
      'ytd-watch-metadata #actions',
      'ytd-menu-renderer #top-level-buttons-computed',
    ],
    videoTitle: ['ytd-watch-metadata h1', 'h1.ytd-watch-metadata', '#title h1'],
    channelName: ['ytd-channel-name a', '#owner #channel-name a', '#upload-info #channel-name a'],
    /** Huy hiệu "Riêng tư"/"Không công khai" — nguồn duy nhất đọc được Mức riêng tư từ DOM. */
    privacyBadge: ['ytd-badge-supported-renderer', '.badge-style-type-simple', '.ytd-video-primary-info-renderer.badge'],
    /** Thời lượng ở thanh player. Trang có nhiều chỗ hiện thời lượng; chỗ này là chỗ đúng nhất. */
    playerDuration: ['.ytp-time-duration'],
    /**
     * Thẻ `<video>` của player — chỗ duy nhất mà một content script nhảy đoạn được.
     *
     * `#movie_player.seekTo()` là **thuộc tính JS của trang**: content script chạy ở ISOLATED
     * world nhìn thấy phần tử nhưng không thấy phương thức ấy, nên gọi nó là `undefined is not
     * a function`. `currentTime` thì là thuộc tính DOM thật của `HTMLMediaElement`, đặt được
     * từ ISOLATED world và player tự đồng bộ theo — và không tải lại trang (ticket 006).
     */
    playerVideo: ['video.html5-main-video', '.html5-main-video', 'video'],
    /** Cột phải của trang watch: chỗ panel transcript của extension đứng (ticket 006). */
    secondaryColumn: ['#secondary-inner', '#secondary', 'ytd-watch-flexy #secondary'],
    /**
     * Một dòng video trên trang playlist / kênh — chỗ checkbox chọn lẻ chen vào (ticket 007).
     *
     * Bốn layout vì trang playlist, tab Videos của kênh, và các kệ đề xuất dùng renderer khác
     * nhau. Danh sách này **chỉ** dùng để gắn checkbox và đọc videoId của dòng; danh sách
     * thật để import đến từ InnerTube qua cầu MAIN world, nên trang cuộn tới đâu không đổi
     * kết quả (ADR 0003, ticket 007).
     */
    playlistRow: [
      'ytd-playlist-video-renderer',
      'ytd-grid-video-renderer',
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
    ],
    /** Link `watch?v=…` bên trong một dòng — nguồn duy nhất đọc được videoId của dòng ấy. */
    playlistRowLink: ['a#video-title', 'a#thumbnail', 'a[href*="watch?v="]'],
    /** Chỗ đặt checkbox trong một dòng: ô thumbnail. Không có thì người gọi treo vào chính dòng. */
    playlistRowThumb: ['ytd-thumbnail', '#thumbnail'],
    /** Tên playlist trên trang — nó thành tên Nguồn gộp, nên đọc sai là sai vĩnh viễn (ADR 0010). */
    playlistTitle: [
      'ytd-playlist-header-renderer h1',
      'yt-dynamic-sizing-view-model h1',
      'ytd-browse[page-subtype="playlist"] h1',
    ],
    /** Id kênh trên trang kênh: `/@handle` không mang `UC…` ở đâu ngoài hai chỗ này. */
    channelIdMeta: ['meta[itemprop="identifier"]', 'meta[itemprop="channelId"]'],
    canonicalLink: ['link[rel="canonical"]'],
  });

  const DEFAULT_LABELS = Object.freeze({
    transcriptButton: [
      'show transcript', 'transcript',
      'hien ban chep loi', 'ban chep loi',
      'hien phu de', 'mo phu de',
    ],
    /**
     * Chữ trên huy hiệu Mức riêng tư. Hai nhóm tách hẳn nhau: `private` và `unlisted` đi hai
     * đường trích khác nhau (ADR 0003), nên đọc nhầm nhóm này thành nhóm kia là thử hai lần
     * gọi mạng chắc chắn hỏng — hoặc tệ hơn, bỏ qua đường DOM là đường duy nhất chạy được.
     */
    privacyPrivate: ['private', 'rieng tu'],
    privacyUnlisted: ['unlisted', 'khong cong khai'],
  });

  /** Selector loại trừ giao diện của chính extension. Suy từ `EXT_PREFIX`, không viết tay lại. */
  const OWN_UI = `[id^="${S.EXT_PREFIX}"]`;

  const asList = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : []);

  /**
   * Gộp ghi đè của người dùng *thêm vào* mặc định, ghi đè đứng trước — cùng quy tắc với
   * `mergeSelectorOverrides` của Seam 1. Thay thế hẳn là sai: một ghi đè cho `segment` sẽ vứt
   * luôn mọi layout khác đang chạy tốt.
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
        if (!list) throw new Error(`youtube/selectors: không có nhóm selector "${key}"`);
        return list.join(', ');
      },
      label(key) {
        return labels[key] || [];
      },
    });
  }

  const DEFAULT = resolve(null);

  root.NBLM_YT_SELECTORS = Object.freeze({
    OWN_UI,
    DEFAULT_SELECTORS,
    DEFAULT_LABELS,
    DEFAULT,
    resolve,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
