// Ticket 008 — cây node của một trang tài liệu thành Markdown (Seam 3).
//
// Bẫy lớn nhất của file này, và lý do nó không được phép dùng `textContent`: Prism-react
// (Docusaurus) và Shiki dựng **mỗi dòng code thành một phần tử riêng, không có ký tự `\n`
// nào**. `textContent` trả về 40 dòng dính liền thành một dòng khổng lồ — vẫn là một chuỗi
// "hợp lệ", vẫn vào được Nguồn, chỉ là không ai đọc được nữa. Fixture ở đây **tự kiểm chứng
// điều đó** trước khi kiểm bộ chuyển: nếu `pre.textContent` có `\n` thì fixture không còn
// trung thực và mọi assertion dưới nó thành vô nghĩa.
//
// Cặp cùng kiểu hoán vị được ở lớp này: `language-*` của khối code này ↔ của khối kia. Hoán vị
// vẫn ra hai fence mở đúng khuôn, chỉ là mở sai ngôn ngữ — nên mọi assertion về ngôn ngữ ở đây
// canh **quan hệ (thân fence ↔ nhãn fence)**, không khoá riêng nhãn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el } from './helpers/fake-dom.js';
import '../src/common/shared.js';
import '../src/docs/selectors.js';
import '../src/docs/markdown.js';

const MD = globalThis.NBLM_DOCS_MARKDOWN;

// ------------------------------------------------------------------ fixture khối code

/**
 * Khối code kiểu Prism-react: mỗi dòng là một `<div class="token-line">`, cột số dòng là một
 * `<span class="linenumber">` nằm *bên trong* dòng, và **không một ký tự `\n` nào** trong cây.
 */
function prismBlock(lines, language) {
  const rows = lines.map((text, index) => el('div', { class: 'token-line' }, [
    el('span', { class: 'linenumber' }, [String(index + 1)]),
    el('span', { class: 'token plain' }, [text]),
  ]));
  return el('pre', { class: `prism-code language-${language}` }, [
    el('button', { class: 'copyButton_node' }, ['Copy']),
    el('code', { class: `language-${language}` }, rows),
  ]);
}

/** Khối code kiểu Shiki: `<span class="line">` ngăn nhau bằng text node `\n` trong `<code>`. */
function shikiBlock(lines, language) {
  const children = [];
  lines.forEach((text, index) => {
    if (index > 0) children.push('\n');
    children.push(el('span', { class: 'line' }, [el('span', { class: 'sk' }, [text])]));
  });
  return el('pre', { class: 'shiki', 'data-lang': language }, [el('code', {}, children)]);
}

/** Khối code thường: một text node duy nhất, có `\n` thật. */
function plainBlock(text, language) {
  return el('pre', {}, [el('code', { class: `language-${language}` }, [text])]);
}

/** Tách mọi fence trong markdown thành cặp (nhãn ngôn ngữ, thân). */
function fencesOf(markdown) {
  const out = [];
  const re = /^(`{3,})([^\n]*)\n([\s\S]*?)\n\1$/gm;
  let match;
  while ((match = re.exec(markdown)) !== null) out.push({ language: match[2], body: match[3] });
  return out;
}

const FORTY = Array.from({ length: 40 }, (_, i) => `const step${i + 1} = ${i + 1};`);

// ------------------------------------------------------------------ khối code nhiều dòng

test('markdown — khối 40 dòng kiểu Prism ra fence 40 dòng, không phải một dòng', () => {
  const pre = prismBlock(FORTY, 'jsx');
  // Fixture phải trung thực: đây chính là hình dạng khiến `textContent` sai.
  assert.equal(pre.textContent.includes('\n'), false, 'fixture Prism mà có \\n thì nó không còn là bẫy');

  const [fence] = fencesOf(MD.toMarkdown(pre));
  const lines = fence.body.split('\n');
  assert.equal(lines.length, 40, `fence phải có 40 dòng, đang có ${lines.length}`);
  assert.equal(lines[6], 'const step7 = 7;');
  assert.equal(lines[39], 'const step40 = 40;');
});

test('markdown — cột số dòng và nút Copy không lọt vào fence', () => {
  const [fence] = fencesOf(MD.toMarkdown(prismBlock(FORTY, 'jsx')));
  assert.equal(fence.body.includes('Copy'), false, 'nút Copy lọt vào code');
  for (const line of fence.body.split('\n')) {
    assert.match(line, /^const step\d+ = \d+;$/, `dòng dính số thứ tự: ${line}`);
  }
});

test('markdown — Shiki: mỗi `.line` là một dòng, dòng trống ở giữa được giữ', () => {
  const pre = shikiBlock(['def a():', '', '    return 1'], 'python');
  const [fence] = fencesOf(MD.toMarkdown(pre));
  assert.deepEqual(fence.body.split('\n'), ['def a():', '', '    return 1']);
});

test('markdown — khối code thường vẫn cắt theo `\\n` thật, và giữ nguyên thụt đầu dòng', () => {
  const pre = plainBlock('def a():\n    return 1\n', 'python');
  const [fence] = fencesOf(MD.toMarkdown(pre));
  assert.deepEqual(fence.body.split('\n'), ['def a():', '    return 1']);
});

test('markdown — code chứa dấu ``` thì fence phải dài hơn, nếu không nó tự đóng sớm', () => {
  const pre = plainBlock('in đậm: ```js\nxong', 'md');
  const markdown = MD.toMarkdown(pre);
  const [fence] = fencesOf(markdown);
  assert.ok(fence, `không đọc lại được fence nào từ:\n${markdown}`);
  assert.deepEqual(fence.body.split('\n'), ['in đậm: ```js', 'xong']);
});

// ------------------------------------------------------------------ ngôn ngữ của fence

test('markdown — mỗi fence mở đúng ngôn ngữ của **chính khối** nó bọc', () => {
  // Hai khối cùng kiểu nằm cạnh nhau: hoán vị hai nhãn vẫn ra hai fence hợp lệ. Vì vậy
  // assertion dưới đây neo nhãn vào **thân** của chính fence ấy, không kiểm hai nhãn rời.
  const doc = el('div', {}, [
    prismBlock(['const a = <App />;'], 'jsx'),
    shikiBlock(['print(1)'], 'python'),
    plainBlock('SELECT 1;', 'sql'),
  ]);
  const fences = fencesOf(MD.toMarkdown(doc));
  assert.equal(fences.length, 3);
  assert.deepEqual(
    fences.map((f) => [f.language, f.body]),
    [['jsx', 'const a = <App />;'], ['python', 'print(1)'], ['sql', 'SELECT 1;']],
  );
});

test('markdown — không đoán được ngôn ngữ thì fence để trống, không bịa', () => {
  const [fence] = fencesOf(MD.toMarkdown(el('pre', {}, [el('code', {}, ['xin chao'])])));
  assert.equal(fence.language, '');
});

test('markdown — `language-none` và class trang trí không thành nhãn ngôn ngữ', () => {
  const pre = el('pre', { class: 'line-numbers language-none' }, [el('code', {}, ['abc'])]);
  assert.equal(fencesOf(MD.toMarkdown(pre))[0].language, '');
});

// ------------------------------------------------------------------ cấu trúc văn bản

test('markdown — cấp đề mục giữ nguyên, một `#` cho mỗi cấp', () => {
  const doc = el('div', {}, [
    el('h1', {}, ['Cài đặt']),
    el('h2', {}, ['Trên Linux']),
    el('h3', {}, ['Ubuntu']),
  ]);
  assert.equal(MD.toMarkdown(doc), '# Cài đặt\n\n## Trên Linux\n\n### Ubuntu');
});

test('markdown — đoạn văn, chữ đậm/nghiêng, code inline và link', () => {
  const doc = el('div', {}, [
    el('p', {}, [
      'Chạy ',
      el('code', {}, ['npm i']),
      ' rồi mở ',
      el('a', { href: '/guide/start' }, ['trang bắt đầu']),
      ', xem ',
      el('strong', {}, ['kỹ']),
      ' phần ',
      el('em', {}, ['cấu hình']),
      '.',
    ]),
  ]);
  assert.equal(MD.toMarkdown(doc), 'Chạy `npm i` rồi mở [trang bắt đầu](/guide/start), xem **kỹ** phần *cấu hình*.');
});

test('markdown — danh sách phẳng và danh sách lồng', () => {
  const doc = el('div', {}, [
    el('ul', {}, [
      el('li', {}, ['một']),
      el('li', {}, [
        'hai',
        el('ol', {}, [el('li', {}, ['hai-một']), el('li', {}, ['hai-hai'])]),
      ]),
    ]),
  ]);
  assert.equal(MD.toMarkdown(doc), '- một\n- hai\n  1. hai-một\n  2. hai-hai');
});

test('markdown — bảng ra bảng pipe, có dòng ngăn cách', () => {
  const doc = el('table', {}, [
    el('thead', {}, [el('tr', {}, [el('th', {}, ['Cờ']), el('th', {}, ['Ý nghĩa'])])]),
    el('tbody', {}, [el('tr', {}, [el('td', {}, ['--dry']), el('td', {}, ['chạy thử'])])]),
  ]);
  assert.equal(MD.toMarkdown(doc), '| Cờ | Ý nghĩa |\n| --- | --- |\n| --dry | chạy thử |');
});

test('markdown — trích dẫn và đường kẻ ngang', () => {
  const doc = el('div', {}, [
    el('blockquote', {}, [el('p', {}, ['Cẩn thận với quota.'])]),
    el('hr', {}),
    el('p', {}, ['Hết.']),
  ]);
  assert.equal(MD.toMarkdown(doc), '> Cẩn thận với quota.\n\n---\n\nHết.');
});

test('markdown — script/style không thành chữ trong Nguồn', () => {
  const doc = el('div', {}, [
    el('script', {}, ['window.x = 1;']),
    el('style', {}, ['.a { color: red }']),
    el('p', {}, ['Nội dung thật.']),
  ]);
  assert.equal(MD.toMarkdown(doc), 'Nội dung thật.');
});

test('markdown — `<br>` là xuống dòng, không phải mất khoảng trắng', () => {
  const doc = el('p', {}, ['dòng một', el('br', {}), 'dòng hai']);
  assert.equal(MD.toMarkdown(doc), 'dòng một\ndòng hai');
});

test('markdown — ảnh giữ alt và src, link rỗng thì bỏ hẳn', () => {
  const doc = el('p', {}, [
    el('img', { src: '/img/a.png', alt: 'Sơ đồ' }),
    el('a', { href: '/x' }, []),
  ]);
  assert.equal(MD.toMarkdown(doc), '![Sơ đồ](/img/a.png)');
});
