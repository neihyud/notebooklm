#!/usr/bin/env node
/*
 * Chuyển transcript .txt đã tải sang .md.
 *
 *   node tools/txt-to-md.mjs [thư mục]        # mặc định ~/Downloads/Transcript YouTube
 *
 * Vì sao cần: bản .txt chỉ có dòng `[m:ss] lời thoại`, không mang theo tiêu đề,
 * kênh hay videoId — nên chuyển thẳng sẽ ra .md cụt đầu, mất luôn link về nguồn.
 * Công cụ này dò lại metadata từ hàng đợi trong storage của extension (khớp theo
 * tiêu đề trong tên file), rồi dựng .md bằng ĐÚNG hàm toMarkdown mà extension
 * dùng — nên kết quả giống hệt bản tải trực tiếp ở định dạng .md.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.argv[2] || path.join(os.homedir(), 'Downloads', 'Transcript YouTube');

globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
await import(path.join(ROOT, 'src/common/shared.js'));
await import(path.join(ROOT, 'src/youtube/srt.js'));
const { NBLM, NBLM_SRT } = globalThis;

/* -- đọc hàng đợi từ storage của extension để lấy videoId/kênh/thời lượng -- */

function loadQueue() {
  const base = path.join(os.homedir(), '.config/BraveSoftware/Brave-Browser');
  let profiles = [];
  try { profiles = fs.readdirSync(base); } catch { return []; }

  let best = [];
  for (const p of profiles) {
    const dir = path.join(base, p, 'Local Extension Settings', 'akoekkcppimjmbomlpaadiahcpmbbedn');
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .map((f) => path.join(dir, f))
      .filter((f) => fs.statSync(f).isFile())
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);

    let blob = '';
    for (const f of files) blob += fs.readFileSync(f, 'latin1');
    blob = Buffer.from(blob, 'latin1').toString('utf-8');

    for (const arr of balancedArrays(blob, '[{"addedAt":')) {
      if (Array.isArray(arr) && arr.length && arr[0] && arr[0].videoId && arr.length >= best.length) {
        best = arr;
      }
    }
  }
  return best;
}

/** Cắt mọi mảng JSON cân bằng ngoặc bắt đầu bằng `start`. */
function balancedArrays(text, start) {
  const out = [];
  let i = 0;
  for (;;) {
    i = text.indexOf(start, i);
    if (i === -1) break;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < Math.min(text.length, i + 8_000_000); j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) {
          try { out.push(JSON.parse(text.slice(i, j + 1))); } catch {}
          break;
        }
      }
    }
    i += start.length;
  }
  return out;
}

/* -- phân tích file .txt --------------------------------------------- */

const toSeconds = (stamp) =>
  String(stamp).split(':').map((n) => parseInt(n, 10)).reduce((a, n) => a * 60 + n, 0);

function parseTxt(content) {
  const segments = [];
  for (const line of content.split('\n')) {
    const m = /^\s*\[(\d{1,2}(?::\d{2}){1,2})\]\s*(.+)$/.exec(line);
    if (m) segments.push({ start: toSeconds(m[1]), end: null, text: m[2].trim() });
  }
  return segments;
}

/* -- chạy ------------------------------------------------------------- */

if (!fs.existsSync(DIR)) {
  console.error(`Không thấy thư mục: ${DIR}`);
  process.exit(1);
}

const queue = loadQueue();
console.log(`đọc được ${queue.length} mục trong hàng đợi để dò metadata\n`);

const byTitle = new Map();
for (const it of queue) if (it.title) byTitle.set(NBLM.norm(it.title), it);

let ok = 0, skipped = 0;
for (const name of fs.readdirSync(DIR).sort()) {
  if (!name.endsWith('.txt')) continue;

  const segments = parseTxt(fs.readFileSync(path.join(DIR, name), 'utf-8'));
  if (!segments.length) {
    console.log(`  ⚠ ${name} — không có dòng nào dạng [m:ss], bỏ qua`);
    skipped++;
    continue;
  }

  // "001 - Tiêu đề (1).txt" -> "Tiêu đề"
  const title = name.replace(/\.txt$/, '').replace(/^\d+\s*-\s*/, '').replace(/\s*\(\d+\)$/, '');
  const hit = byTitle.get(NBLM.norm(title));
  const meta = {
    title,
    videoId: hit && hit.videoId,
    channel: hit && hit.channel,
    durationSec: hit && hit.durationSec,
  };

  const out = path.join(DIR, `${name.replace(/\.txt$/, '')}.md`);
  fs.writeFileSync(out, NBLM_SRT.toMarkdown(segments, meta), 'utf-8');
  console.log(`  ✓ ${path.basename(out)} — ${segments.length} dòng${meta.videoId ? ` · có link nguồn (${meta.videoId})` : ' · KHÔNG dò được videoId, thiếu link'}`);
  ok++;
}

console.log(`\n${ok} file đã chuyển${skipped ? `, ${skipped} bỏ qua` : ''}`);
