// Bất biến "mọi id do extension tạo mang một tiền tố chung" (spec 0001, ticket 006).
//
// Đây là bất biến **không có triệu chứng** khi hỏng: một id lạc quy ước vẫn dựng ra giao diện
// chạy tốt, chỉ có `OWN_UI = [id^="nblm-"]` là thôi nhìn thấy nó — và hậu quả rơi xuống chỗ
// khác hẳn: `findTranscriptButton` bấm vào chính extension, `readVideoMeta` nuốt chữ trên nút
// của chính extension vào tiêu đề. Vì vậy nó phải được canh bằng một lượt **quét thật** các id
// sinh ra trong code, chứ không bằng một hằng số chép sang chỗ khác.
//
// Bốn lượt quét, mỗi lượt bịt một lối khác nhau cho một id lạc lọt lưới:
//   A1 — id viết thẳng trong HTML của extension;
//   A2 — chỗ code **gắn** id vào một phần tử (`setAttribute('id', …)`, `.id = …`);
//   A3 — hằng số tên `*_ID` / `*_IDS` **được dùng làm id** ở đâu đó (kể cả id của menu chuột
//        phải, thứ không phải phần tử DOM nên A2 không thấy);
//   B  — id **thật sự sinh ra lúc chạy**: dựng panel bằng cây giả rồi đi bộ trên cây.
//
// Mỗi lượt quét tự kiểm rằng nó có tìm thấy gì đó: một biểu thức quét hỏng trả về mảng rỗng
// và "xanh" đúng như một cây sạch. Kiểm ngược: đổi một id trong `src/youtube/panel.js` thành
// `panel-x`, hoặc thêm `node.setAttribute('id', 'x')` ở bất kỳ file nào — phải có test đỏ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { el } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/common/messages.js';
import '../src/youtube/selectors.js';
import '../src/youtube/srt.js';
import '../src/youtube/transcript.js';
import '../src/youtube/watch.js';
import '../src/youtube/panel.js';

const S = globalThis.NBLM_SHARED;
const P = globalThis.NBLM_PANEL;

const url = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => readFileSync(url(name), 'utf8');

function sourceFiles(dir = 'src') {
  const out = [];
  for (const entry of readdirSync(url(dir))) {
    const path = `${dir}/${entry}`;
    if (statSync(url(path)).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.js')) out.push(path);
  }
  return out.sort();
}

const JS_FILES = [...sourceFiles(), 'popup.js', 'options.js'];
const HTML_FILES = ['popup.html', 'options.html'];
const SHARED = read('src/common/shared.js');

/**
 * Giá trị chuỗi của một biểu thức id, đọc **từ chính source**: chuỗi thì lấy thẳng, template
 * thì thay từng `${…}`, tên thì tra ngược lại khai báo `const` trong cùng file — và tra cả
 * `src/common/shared.js`, vì `EXT_PREFIX` sống ở đó.
 *
 * Phần `${…}` không tra được thay bằng `?`: giá trị chạy lúc runtime không đọc được ở đây,
 * nhưng **tiền tố** thì vẫn đọc được, mà tiền tố mới là thứ đang canh.
 */
function literalOf(expr, source, depth = 0) {
  const e = String(expr).trim().replace(/[,;)]+$/, '');
  if (depth > 4) return null;
  if (/^'[^']*'$/.test(e) || /^"[^"]*"$/.test(e)) return e.slice(1, -1);
  if (/^`[^`]*`$/.test(e)) {
    return e.slice(1, -1).replace(/\$\{([^}]*)\}/g, (_, inner) => {
      const value = literalOf(inner, source, depth + 1);
      return value === null ? '?' : value;
    });
  }
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(e)) {
    const name = e.split('.').pop();
    for (const text of [source, SHARED]) {
      const decl = text.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`));
      if (decl) return literalOf(decl[1], text, depth + 1);
      const prop = text.match(new RegExp(`(?:^|[{,\\s])${name}:\\s*([^,\\n]+)`));
      if (prop) return literalOf(prop[1], text, depth + 1);
    }
  }
  return null;
}

/** Bỏ dòng chú thích: một id ví dụ trong comment không phải một id extension tạo ra. */
const codeOf = (source) => source
  .split('\n')
  .filter((line) => {
    const trimmed = line.trim();
    return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
  })
  .join('\n');

// ------------------------------------------------------------------ A1: id trong HTML

test('id — mọi id viết thẳng trong HTML của extension mang tiền tố chung', () => {
  const found = [];
  for (const file of HTML_FILES) {
    for (const match of read(file).matchAll(/\sid="([^"]+)"/g)) found.push([file, match[1]]);
  }
  assert.ok(found.length >= 20, `quét được ${found.length} id trong HTML — biểu thức quét hỏng, không phải trang sạch`);
  const strays = found.filter(([, id]) => !id.startsWith(S.EXT_PREFIX)).map(([file, id]) => `${file}: #${id}`);
  assert.deepEqual(strays, [], `id lạc quy ước "${S.EXT_PREFIX}…":\n${strays.join('\n')}`);
});

// ------------------------------------------------- A2: chỗ code gắn id vào phần tử

test('id — mọi chỗ code gắn id vào một phần tử đều gắn một id mang tiền tố chung', () => {
  const sites = [];
  for (const file of JS_FILES) {
    const code = codeOf(read(file));
    for (const match of code.matchAll(/setAttribute\(\s*'id'\s*,\s*([^)]+)\)/g)) sites.push([file, match[1]]);
    // `(?!=)`: `item.id == null` là một phép so sánh, không phải một lần gắn id.
    for (const match of code.matchAll(/\b\w+\.id\s*=(?!=)\s*([^;\n]+)/g)) sites.push([file, match[1]]);
  }
  assert.ok(sites.length >= 2, `quét được ${sites.length} chỗ gắn id — biểu thức quét hỏng`);

  const problems = [];
  for (const [file, expr] of sites) {
    const value = literalOf(expr, read(file));
    if (value === null) {
      // Không đọc được thành chữ thì phải đọc được thành **hằng số đã quét ở A3**; nếu không,
      // lượt quét này chỉ đang giả vờ kiểm một chỗ mà nó không hiểu.
      if (!/_IDS?\b/.test(expr)) problems.push(`${file}: gắn id từ "${expr.trim()}" — không lần ra được giá trị`);
    } else if (!value.startsWith(S.EXT_PREFIX)) {
      problems.push(`${file}: gắn id "${value}" (từ ${expr.trim()})`);
    }
  }
  assert.deepEqual(problems, [], `id lạc quy ước "${S.EXT_PREFIX}…":\n${problems.join('\n')}`);
});

// ------------------------------------------------------- A3: hằng số tên *_ID / *_IDS

/**
 * Hằng số ấy có thật sự **được dùng làm id** không. Phân biệt bằng chỗ dùng chứ không bằng
 * tên: `NOT_A_VIDEO_ID` trong `shared.js` cũng tên `_ID` nhưng là một giá trị của YouTube mà
 * extension đọc vào, không phải một id extension đặt ra — loại nó bằng một danh sách miễn trừ
 * là mở đúng cái cửa mà test này sinh ra để đóng.
 */
const usedAsId = (code, name) => new RegExp(
  `setAttribute\\(\\s*'id'\\s*,\\s*${name}\\b|\\.id\\s*=(?!=)\\s*${name}\\b|\\bid:\\s*${name}\\b|#\\$\\{${name}\\b`,
).test(code);

test('id — mọi hằng số được dùng làm id đều mang tiền tố chung, kể cả id của menu chuột phải', () => {
  const consts = [];
  for (const file of JS_FILES) {
    const code = codeOf(read(file));
    for (const match of code.matchAll(/\b(?:const|let|var)\s+(\w*_IDS?)\s*=\s*([\s\S]{0,400}?);\n/g)) {
      const [, name, body] = match;
      if (!usedAsId(code, name)) continue;
      const values = [...body.matchAll(/(`[^`]*`|'[^']*')/g)].map((m) => literalOf(m[1], code));
      for (const value of values) consts.push([file, name, value]);
    }
  }
  assert.ok(consts.length >= 5, `quét được ${consts.length} hằng số id — biểu thức quét hỏng`);

  const strays = consts
    .filter(([, , value]) => value === null || !value.startsWith(S.EXT_PREFIX))
    .map(([file, name, value]) => `${file}: ${name} = ${value === null ? '(không đọc được)' : value}`);
  assert.deepEqual(strays, [], `id lạc quy ước "${S.EXT_PREFIX}…":\n${strays.join('\n')}`);
});

test('id — lượt quét hằng số nhìn thấy đúng những id mà ba ticket trước đã đặt', () => {
  // Tự kiểm lượt quét: nếu biểu thức ở trên thôi khớp một dạng khai báo nào đó, nó im lặng
  // trả về ít hơn — và một lượt quét trống rỗng vẫn xanh.
  const names = [];
  for (const file of JS_FILES) {
    for (const match of codeOf(read(file)).matchAll(/\b(?:const|let|var)\s+(\w*_IDS?)\s*=/g)) names.push(match[1]);
  }
  for (const expected of ['BUTTON_ID', 'CONTEXT_MENU_ID', 'PANEL_ID', 'SAVE_IDS']) {
    assert.ok(names.includes(expected), `lượt quét không thấy ${expected} — biểu thức quét hỏng`);
  }
});

// ------------------------------------------------------- B: id thật sự sinh ra lúc chạy

test('id — đi bộ trên cây panel vừa dựng: mọi node mang id đều mang tiền tố chung', async () => {
  const page = el('div', { id: 'page' }, [
    el('div', { id: 'secondary' }, []),
    el('ytd-watch-metadata', {}, [el('div', { id: 'top-level-buttons-computed' }, [])]),
  ]);
  const doc = {
    createElement: (tag) => el(tag),
    querySelector: (selector) => page.querySelector(selector),
    querySelectorAll: (selector) => page.querySelectorAll(selector),
  };

  const controller = P.createController({
    doc,
    root: page,
    extract: async () => ({
      meta: { videoId: 'dQw4w9WgXcQ', title: 'Video' },
      segments: [{ start: 0, text: 'một dòng' }],
    }),
    clipboard: { writeText: async () => {} },
    download: () => {},
    options: {},
  });
  await controller.open();
  P.mountToggle(page, doc, () => {}, {});

  // Id của trang (`page`, `secondary`, hàng nút) là của YouTube, không phải của extension:
  // chỉ những node extension **vừa tạo** mới nằm trong vùng phải mang tiền tố.
  const created = Array.from(page.querySelectorAll('*'))
    .filter((node) => node.getAttribute('id') && node.closest(`#${P.PANEL_ID}`) !== null);
  const ids = [P.PANEL_ID, P.TOGGLE_ID, ...created.map((node) => node.getAttribute('id'))];

  assert.ok(ids.length >= 8, `panel chỉ sinh ra ${ids.length} id — cây giả không dựng đủ, không phải panel gọn`);
  for (const id of ids) assert.ok(id.startsWith(S.EXT_PREFIX), `id sinh ra lúc chạy lạc quy ước: ${id}`);
  assert.equal(page.querySelector(`#${P.TOGGLE_ID}`).getAttribute('id'), P.TOGGLE_ID);
});

test('id — OWN_UI của cả hai lớp suy từ EXT_PREFIX, nên panel tự loại mình khỏi mọi lượt quét', () => {
  // `OWN_UI` là chỗ bất biến này *có tác dụng*: hai file selectors đều dựng nó từ `EXT_PREFIX`
  // chứ không chép tay chuỗi `nblm-`.
  for (const path of ['src/youtube/selectors.js', 'src/notebooklm/selectors.js']) {
    assert.match(codeOf(read(path)), /OWN_UI\s*=\s*`\[id\^="\$\{S\.EXT_PREFIX\}"\]`/, path);
  }
  assert.equal(globalThis.NBLM_YT_SELECTORS.OWN_UI, `[id^="${S.EXT_PREFIX}"]`);
});
