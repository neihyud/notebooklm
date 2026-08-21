#!/usr/bin/env node
/*
 * Chuyển phụ đề .vtt/.srt (do yt-dlp tải) sang .md và .txt.
 *
 *   node tools/subs-to-md.mjs [thư-mục] [md|txt|both]
 *
 * Dùng đúng hàm toMarkdown của extension nên kết quả giống hệt bản extension tự
 * tải, kể cả timestamp là link nhảy tới đúng giây.
 *
 * Chỗ khó nhất là phụ đề TỰ ĐỘNG của YouTube: nó cuộn như bảng điện tử — mỗi
 * khối lặp lại nguyên dòng trước rồi thêm vài chữ mới, kèm thẻ định thời từng từ
 * (`<00:00:01.234><c> chữ</c>`). Đổ thẳng ra file là transcript dài gấp đôi và
 * lặp đến mức không đọc nổi. Nên phải bóc thẻ, rồi chỉ giữ phần THỰC SỰ mới của
 * mỗi khối.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.argv[2] || path.join(os.homedir(), 'Downloads', 'Transcript YouTube');
const WANT = (process.argv[3] || 'both').toLowerCase();

globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
await import(path.join(ROOT, 'src/common/shared.js'));
await import(path.join(ROOT, 'src/youtube/srt.js'));
const { NBLM_SRT } = globalThis;

const stamp = (s) =>
  s.split(':').map(parseFloat).reduce((a, n) => a * 60 + n, 0);

/** Bỏ thẻ định thời từng từ và thực thể HTML. */
const clean = (line) =>
  line
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/<\/?c[^>]*>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

function parseCues(text) {
  const cues = [];
  const re = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->|\n\d+\s*\n\d{2}:|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[3]
      .split('\n')
      .map((l) => clean(l.replace(/^\d+$/, '')))
      .filter(Boolean);
    if (body.length) {
      cues.push({ start: stamp(m[1].replace(',', '.')), end: stamp(m[2].replace(',', '.')), lines: body });
    }
  }
  return cues;
}

/**
 * Gộp các khối cuộn thành transcript đọc được.
 * Với mỗi khối, chỉ giữ phần chưa từng xuất hiện ở khối liền trước.
 */
function toSegments(cues) {
  const out = [];
  let prev = '';
  for (const cue of cues) {
    const full = cue.lines.join(' ').trim();
    if (!full) continue;

    let fresh = full;
    if (prev && full.startsWith(prev)) fresh = full.slice(prev.length).trim();
    else if (prev === full) fresh = '';
    else {
      // chồng lấn một phần: cắt phần đuôi của prev trùng đầu của full
      for (let n = Math.min(prev.length, full.length); n > 12; n--) {
        if (prev.endsWith(full.slice(0, n))) { fresh = full.slice(n).trim(); break; }
      }
    }
    prev = full;
    if (!fresh) continue;

    const last = out[out.length - 1];
    if (last && cue.start - last.start < 1.5) last.text = `${last.text} ${fresh}`.trim();
    else out.push({ start: cue.start, end: cue.end, text: fresh });
  }
  return out;
}

if (!fs.existsSync(DIR)) {
  console.error(`Không thấy thư mục: ${DIR}`);
  process.exit(1);
}

let ok = 0;
let skipped = 0;
for (const name of fs.readdirSync(DIR).sort()) {
  if (!/\.(vtt|srt)$/i.test(name)) continue;

  const segments = toSegments(parseCues(fs.readFileSync(path.join(DIR, name), 'utf-8')));
  if (!segments.length) {
    console.log(`  ⚠ ${name} — không bóc được dòng nào`);
    skipped++;
    continue;
  }

  // "007 - 8RZgejm5Hbc - Tiêu đề.en.vtt" -> id + tiêu đề
  const base = name.replace(/\.(en|vi|[a-z]{2}(-[A-Za-z]+)?)?\.(vtt|srt)$/i, '');
  const m = /^(\d+)\s*-\s*([A-Za-z0-9_-]{11})\s*-\s*(.+)$/.exec(base);
  const meta = m
    ? { videoId: m[2], title: m[3] }
    : { title: base.replace(/^\d+\s*-\s*/, '') };

  if (WANT === 'md' || WANT === 'both') {
    fs.writeFileSync(path.join(DIR, `${base}.md`), NBLM_SRT.toMarkdown(segments, meta), 'utf-8');
  }
  if (WANT === 'txt' || WANT === 'both') {
    fs.writeFileSync(path.join(DIR, `${base}.txt`), NBLM_SRT.toTxt(segments, { timestamps: true }), 'utf-8');
  }
  ok++;
}

console.log(`\n${ok} file đã chuyển sang ${WANT}${skipped ? `, ${skipped} bỏ qua` : ''}`);
