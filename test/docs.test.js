global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
require(__dirname + '/../src/common/shared.js');
const N = global.NBLM;
let pass = 0, fail = 0;
const eq = (a, b, m) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : (fail++, console.log(`❌ ${m}\n   nhận: ${JSON.stringify(a)}\n   mong: ${JSON.stringify(b)}`));
};

// docKey — khoá chống trùng cho trang tài liệu
eq(N.docKey('https://Example.COM/docs/intro/'), 'https://example.com/docs/intro', 'hạ host + bỏ / cuối');
eq(N.docKey('https://example.com/docs/intro#install'), 'https://example.com/docs/intro', 'bỏ neo trong trang');
eq(N.docKey('https://example.com/docs//a///b'), 'https://example.com/docs/a/b', 'gộp / lặp');
eq(N.docKey('https://example.com/a?utm_source=x&b=1'), 'https://example.com/a?b=1', 'bỏ tham số theo dõi');
eq(N.docKey('ftp://example.com/x'), null, 'giao thức lạ');
eq(N.docKey('không phải url'), null, 'chuỗi rác');
eq(N.docKey(''), null, 'rỗng');

// Hash *là* đường dẫn với docsify & co — bỏ đi là gom cả trăm trang thành một.
eq(N.docKey('https://example.com/#/guide/start'), 'https://example.com/#/guide/start', 'giữ hash-route');
eq(N.docKey('https://example.com/#!/api'), 'https://example.com/#!/api', 'giữ hash-route kiểu #!');
eq(
  N.docKey('https://example.com/#/a') === N.docKey('https://example.com/#/b'),
  false,
  'hai hash-route khác nhau không được trùng khoá'
);
eq(
  N.docKey('https://example.com/docs/x#phan-1') === N.docKey('https://example.com/docs/x#phan-2'),
  true,
  'hai neo trong cùng trang phải chung khoá'
);

// urlLabel — tên hiển thị khi chưa biết tiêu đề
eq(N.urlLabel('https://example.com/docs/getting-started'), 'getting started', 'label từ path');
eq(N.urlLabel('https://example.com/#/guide/intro'), 'intro', 'label từ hash-route');
eq(N.urlLabel('https://example.com/a/b/page.html'), 'page', 'bỏ đuôi file');
eq(N.urlLabel('https://example.com/'), 'example.com', 'path rỗng → hostname');

// buildDocsSourceText — header phải giữ được đường về trang gốc
const meta = {
  url: 'https://docs.example.com/guide/routing',
  title: 'Routing',
  site: 'docs.example.com',
  section: 'Guide / Cơ bản',
  method: 'fetch:.theme-doc-markdown',
};
const text = N.buildDocsSourceText(meta, '# Routing\n\n```js\nconst a = 1;\n```', {});
eq(text.includes('URL: https://docs.example.com/guide/routing'), true, 'header có URL gốc');
eq(text.includes('Mục: Guide / Cơ bản'), true, 'header có breadcrumb');
eq(text.includes('Tài liệu: docs.example.com'), true, 'header có tên site');
eq(text.includes('```js'), true, 'thân bài giữ nguyên khối code');
eq(text.startsWith('Routing\n'), true, 'dòng đầu là tiêu đề');

// Cắt bớt khi vượt giới hạn một nguồn
const long = N.buildDocsSourceText(meta, 'x'.repeat(100), { docsMaxChars: 50 });
eq(long.includes('đã cắt bớt 50 ký tự'), true, 'có ghi chú cắt bớt');
eq(long.includes('x'.repeat(51)), false, 'đã cắt thật chứ không chỉ ghi chú');

// Trang rỗng vẫn phải ra nguồn đọc được, không phải chuỗi trống
eq(N.buildDocsSourceText(meta, '', {}).includes('(trang không có nội dung đọc được)'), true, 'nội dung rỗng');

// docsSourceTitle
eq(N.docsSourceTitle({ title: 'Routing', site: 'nextjs.org' }), 'Routing — nextjs.org', 'tiêu đề nguồn');
eq(
  N.docsSourceTitle({ url: 'https://example.com/docs/http-caching', site: '' }),
  'http caching',
  'không có title thì suy từ URL'
);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
