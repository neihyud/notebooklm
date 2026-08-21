// Bản lưu transcript: chuyển segment thành `md` / `srt` / `vtt` — Seam 1, ADR 0011.
//
// Ghi ra đĩa là **hành vi mặc định**, không phải một chế độ phải nhớ bấm: lúc biết mình cần
// tới file thì transcript đã mất rồi. Vì vậy file này nằm ở tầng hàm thuần — nó phải chạy
// được cả ở service worker lẫn trong tab, và phải test được không cần Chrome.
//
// Không có `.txt`: nó là `.md` bị lược mất cấu trúc (ADR 0011). Định dạng lạ thì ném lỗi chứ
// không lặng lẽ rơi về `md` — người dùng chọn `.srt` mà nhận về `.md` là một cái sai không có
// triệu chứng nào cho tới lúc nạp file vào player.
//
// Hai cặp cùng kiểu của `WORKSPACE_PROTOCOL.md` nằm trọn trong file này:
//   - `start` ↔ `end` của một segment: hoán vị vẫn ra file phụ đề parse được;
//   - dấu phân cách mili-giây `,` (SRT) ↔ `.` (VTT): file sai định dạng vẫn mở được ở nhiều
//     player, nên hỏng ở đây im lặng gần như tuyệt đối.
// `test/transcript-format.test.js` chốt từng ký tự của dòng mốc, không chỉ hình dạng của nó.
(function (root) {
  'use strict';

  if (root.NBLM_TRANSCRIPT_FORMAT) return;

  const S = root.NBLM_SHARED;
  if (!S) throw new Error('youtube/srt: cần src/common/shared.js nạp trước');

  const FORMATS = Object.freeze(['md', 'srt', 'vtt']);

  const MIME = Object.freeze({
    md: 'text/markdown',
    // Kiểu MIME đăng ký của SubRip. `text/plain` cũng mở được, nhưng nó nói sai về nội dung.
    srt: 'application/x-subrip',
    vtt: 'text/vtt',
  });

  /** Dấu ngăn mili-giây. Đây **là** khác biệt định dạng giữa hai loại file, không phải phong cách. */
  const SRT_MS_SEP = ',';
  const VTT_MS_SEP = '.';

  const CUE_ARROW = ' --> ';

  /** Cue cuối cùng (và cue trước một segment rỗng) không có mốc kết nào để mượn. */
  const DEFAULT_CUE_SECONDS = 4;

  /** Trần độ dài tên file, kể cả đuôi. Một số hệ thống tệp dừng ở 255 byte — tiếng Việt là 2–3
   * byte mỗi chữ, nên 120 ký tự là chỗ an toàn mà vẫn đọc được tên. */
  const MAX_FILENAME = 120;

  const seconds = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // ------------------------------------------------------------------ mốc thời gian

  /**
   * `HH:MM:SS<sep>mmm`. Dấu ngăn mili-giây là **tham số**, không phải hằng số trong thân hàm:
   * có đúng hai chỗ gọi và hai chỗ ấy truyền hai ký tự khác nhau, nên hoán vị chúng cho nhau
   * là một phép hoán vị thấy được trong test.
   */
  function clock(value, separator) {
    const totalMs = Math.round(seconds(value) * 1000);
    const ms = totalMs % 1000;
    const total = Math.floor(totalMs / 1000);
    const pad = (n, width) => String(n).padStart(width, '0');
    return `${pad(Math.floor(total / 3600), 2)}:${pad(Math.floor((total % 3600) / 60), 2)}`
      + `:${pad(total % 60, 2)}${separator}${pad(ms, 3)}`;
  }

  /**
   * Điền `end` cho những segment không có — đường DOM chỉ đọc được mốc bắt đầu.
   *
   * Mốc kết mượn của segment **kế tiếp**, không phải của chính nó: mượn nhầm là mọi cue dài
   * 0 giây và phụ đề nhấp nháy rồi biến mất. `end` không lớn hơn `start` là dữ liệu hỏng chứ
   * không phải một cue rỗng, nên nó cũng đi đường mượn.
   */
  function withEnds(segments, options) {
    const cue = seconds(options && options.cueSeconds) || DEFAULT_CUE_SECONDS;
    const list = (segments || []).filter((s) => s && S.collapse(s.text));
    return list.map((segment, index) => {
      const start = seconds(segment.start);
      const given = seconds(segment.end);
      if (given > start) return { start, end: given, text: S.collapse(segment.text) };
      const next = list[index + 1] ? seconds(list[index + 1].start) : 0;
      return {
        start,
        end: next > start ? next : start + cue,
        text: S.collapse(segment.text),
      };
    });
  }

  // ------------------------------------------------------------------ ba định dạng

  /** `&` và `<` là ký tự đánh dấu của WebVTT; để trần thì player đọc cue text thành thẻ. */
  const escapeVtt = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const cueLine = (segment, separator) =>
    `${clock(segment.start, separator)}${CUE_ARROW}${clock(segment.end, separator)}`;

  /** SubRip: khối đánh số **từ 1**, đếm theo cue thật sự ghi ra chứ không theo chỉ số mảng vào. */
  function toSrt(segments, options) {
    return withEnds(segments, options)
      .map((segment, index) => `${index + 1}\n${cueLine(segment, SRT_MS_SEP)}\n${segment.text}\n`)
      .join('\n');
  }

  /** WebVTT: không đánh số (cue id là tuỳ chọn), và bắt buộc có dòng `WEBVTT` mở đầu. */
  function toVtt(segments, options) {
    const body = withEnds(segments, options)
      .map((segment) => `${cueLine(segment, VTT_MS_SEP)}\n${escapeVtt(segment.text)}\n`)
      .join('\n');
    return `WEBVTT\n\n${body}`;
  }

  /**
   * Markdown: **đúng thân một Nguồn** — header ngữ cảnh rồi từng dòng kèm mốc. Dùng chung
   * `sourceBody` của Seam 1 chứ không dựng lại: đó là lý do `.md` là định dạng mặc định, và
   * là lý do file trên đĩa với Nguồn trong notebook không bao giờ lệch nhau.
   *
   * Chỉ `md` mới gộp theo cửa sổ thời gian. `srt`/`vtt` là file phụ đề để nạp lại vào player,
   * gộp 30 giây một cue là làm hỏng đúng công dụng của chúng.
   */
  function toMarkdown(meta, segments, options) {
    const window_ = options && options.mergeWindowSeconds != null
      ? Number(options.mergeWindowSeconds)
      : S.DEFAULTS.mergeWindowSeconds;
    return S.sourceBody(meta, S.mergeSegments(segments, window_));
  }

  // ------------------------------------------------------------------ tên file

  /** Ký tự Windows/macOS không nhận trong tên file, cộng ký tự điều khiển. */
  const ILLEGAL_RE = /[\\/:*?"<>|\u0000-\u001f]/g;

  /**
   * Phần tên do người dùng đặt (tiêu đề video) — thứ duy nhất trong tên file mà extension
   * không kiểm soát nội dung.
   *
   * `chrome.downloads.download` từ chối đường dẫn tuyệt đối và mọi đường dẫn chứa `..`, nên
   * một tiêu đề như `../../etc/passwd` không chỉ xấu mà còn làm hỏng cả lần tải. Gộp dãy dấu
   * chấm lại là chỗ chặn `..`, không phải chỗ làm đẹp.
   */
  function safeSegment(value) {
    return S.collapse(String(value == null ? '' : value).replace(ILLEGAL_RE, ' '))
      .replace(/\.{2,}/g, '.')
      .replace(/^[.\s]+|[.\s]+$/g, '');
  }

  /**
   * Tên file của Bản lưu. `videoId` luôn có mặt: hai video khác nhau trùng tiêu đề là chuyện
   * thường, mà `conflictAction: 'uniquify'` của Chrome thì thêm ` (1)` — một hậu tố không nói
   * được video nào là video nào.
   */
  function fileName(meta, format) {
    const m = meta || {};
    const ext = `.${extensionOf(format)}`;
    const id = safeSegment(m.videoId);
    const title = safeSegment(m.title);
    const tail = id ? `${id}${ext}` : ext;
    if (!title) return id ? tail : `transcript${ext}`;

    const room = MAX_FILENAME - tail.length - ' — '.length;
    const cut = room > 0 ? S.collapse(title.slice(0, room)) : '';
    return cut ? `${cut} — ${tail}` : tail;
  }

  function extensionOf(format) {
    const key = String(format || '').toLowerCase();
    if (!FORMATS.includes(key)) {
      throw new Error(`Bản lưu transcript: không có định dạng "${format}" — chỉ có ${FORMATS.join(', ')}`);
    }
    return key;
  }

  /**
   * Data URL, vì service worker của MV3 **không có** `URL.createObjectURL` (Chromium
   * 40876652: cố ý không mở lại, nó rò bộ nhớ). Percent-encoding chứ không base64: `btoa`
   * chết trên mọi ký tự ngoài Latin-1, tức là chết trên gần như mọi transcript tiếng Việt.
   */
  function dataUrl(text, mime) {
    return `data:${mime || 'text/plain'};charset=utf-8,${encodeURIComponent(String(text == null ? '' : text))}`;
  }

  /**
   * Một Bản lưu hoàn chỉnh: tên file, MIME và thân file của đúng một định dạng.
   */
  function render(format, meta, segments, options) {
    const key = extensionOf(format);
    const text = key === 'md'
      ? toMarkdown(meta, segments, options)
      : (key === 'srt' ? toSrt(segments, options) : toVtt(segments, options));
    return { format: key, filename: fileName(meta, key), mime: MIME[key], text };
  }

  root.NBLM_TRANSCRIPT_FORMAT = Object.freeze({
    FORMATS,
    MIME,
    SRT_MS_SEP,
    VTT_MS_SEP,
    DEFAULT_CUE_SECONDS,
    MAX_FILENAME,
    clock,
    withEnds,
    toSrt,
    toVtt,
    toMarkdown,
    safeSegment,
    fileName,
    extensionOf,
    dataUrl,
    render,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
