/*
 * Chuyển transcript sang các định dạng tải xuống được.
 *
 * Thuần hàm, không đụng DOM — nhờ vậy test được bằng node mà không cần trình duyệt.
 */
;(function (root) {
  'use strict';

  const { fmtTime, canonicalUrl } = root.NBLM;

  /**
   * Bổ sung mốc kết thúc cho từng dòng.
   *
   * Cần thiết vì hai nguồn transcript cho dữ liệu khác nhau: InnerTube và
   * timedtext có sẵn `end`, còn phương án quét DOM panel chỉ đọc được mốc bắt
   * đầu (`end: null`). SRT thì bắt buộc phải có mốc kết thúc, nên suy ra từ mốc
   * bắt đầu của dòng kế tiếp; dòng cuối cùng cho thêm một khoảng mặc định.
   */
  function withEnds(segments, tailSeconds = 4) {
    const list = (segments || [])
      .filter((s) => s && s.text)
      .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end), text: String(s.text).trim() }));

    return list.map((s, i) => {
      let end = s.end;
      if (!Number.isFinite(end) || end <= s.start) {
        const next = list[i + 1];
        end = next && next.start > s.start ? next.start : s.start + tailSeconds;
      }
      return { start: s.start, end, text: s.text };
    });
  }

  /** "00:01:02,500" — SRT dùng dấu phẩy ngăn mili giây, WebVTT dùng dấu chấm. */
  function srtStamp(seconds, decimalMark = ',') {
    const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    return (
      `${pad(Math.floor(ms / 3600000))}:` +
      `${pad(Math.floor((ms % 3600000) / 60000))}:` +
      `${pad(Math.floor((ms % 60000) / 1000))}` +
      `${decimalMark}${pad(ms % 1000, 3)}`
    );
  }

  function toSrt(segments) {
    const list = withEnds(segments);
    if (!list.length) return '';
    return (
      list
        .map((s, i) => `${i + 1}\n${srtStamp(s.start)} --> ${srtStamp(s.end)}\n${s.text}`)
        .join('\n\n') + '\n'
    );
  }

  function toVtt(segments) {
    const list = withEnds(segments);
    const body = list
      .map((s) => `${srtStamp(s.start, '.')} --> ${srtStamp(s.end, '.')}\n${s.text}`)
      .join('\n\n');
    return `WEBVTT\n\n${body}\n`;
  }

  function toTxt(segments, { timestamps = true } = {}) {
    const list = (segments || []).filter((s) => s && s.text);
    if (!list.length) return '';
    if (!timestamps) {
      return list.map((s) => s.text.trim()).join(' ').replace(/\s{2,}/g, ' ');
    }
    return list.map((s) => `[${fmtTime(s.start)}] ${s.text.trim()}`).join('\n');
  }

  /**
   * Markdown có timestamp là link nhảy thẳng tới đúng giây trong video — mở lại
   * sau vài tháng vẫn lần được về nguồn.
   */
  function toMarkdown(segments, meta = {}) {
    const list = (segments || []).filter((s) => s && s.text);
    const url = meta.videoId ? canonicalUrl(meta.videoId) : null;
    const out = [`# ${meta.title || 'Transcript YouTube'}`, ''];

    if (meta.channel) out.push(`- **Kênh:** ${meta.channel}`);
    if (url) out.push(`- **Nguồn:** ${url}`);
    if (meta.durationSec) out.push(`- **Thời lượng:** ${fmtTime(meta.durationSec)}`);
    out.push('', '## Transcript', '');

    for (const s of list) {
      const stamp = fmtTime(s.start);
      const link = url ? `[${stamp}](${url}&t=${Math.floor(s.start)}s)` : stamp;
      out.push(`- ${link} ${s.text.trim()}`);
    }
    return out.join('\n') + '\n';
  }

  /** Tên file an toàn trên mọi hệ điều hành (Windows cấm \ / : * ? " < > |). */
  function fileName(meta, ext) {
    const base = String(meta.title || meta.videoId || 'transcript')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'transcript';
    return `${base}.${ext}`;
  }

  const FORMATS = {
    txt: { ext: 'txt', mime: 'text/plain', render: (segs, meta) => toTxt(segs, { timestamps: true }) },
    srt: { ext: 'srt', mime: 'application/x-subrip', render: (segs) => toSrt(segs) },
    vtt: { ext: 'vtt', mime: 'text/vtt', render: (segs) => toVtt(segs) },
    md: { ext: 'md', mime: 'text/markdown', render: (segs, meta) => toMarkdown(segs, meta) },
  };

  root.NBLM_SRT = { withEnds, srtStamp, toSrt, toVtt, toTxt, toMarkdown, fileName, FORMATS };
})(globalThis);
