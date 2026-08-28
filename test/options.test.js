/*
 * Mọi setting trong DEFAULTS phải có ô nhập ở trang Cài đặt.
 *
 * Thêm một key vào DEFAULTS mà quên nối UI thì không có gì báo lỗi — setting cứ
 * nằm im ở giá trị mặc định và người dùng không hiểu vì sao chỉnh không ăn.
 * Kiểm ngược lại cũng cần: ô nhập trỏ vào key không tồn tại thì Lưu sẽ ghi rác.
 */
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
require(__dirname + '/../src/common/shared.js');

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const optionsJs = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
const popupHtml = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(ROOT, 'src/popup/popup.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));

const keys = Object.keys(global.NBLM.DEFAULTS);
ok(keys.length > 0, 'DEFAULTS không rỗng');

for (const key of keys) {
  ok(new RegExp(`^\\s*${key}:`, 'm').test(optionsJs), `options.js thiếu field cho setting "${key}"`);
  ok(optionsHtml.includes(`id="${key}"`), `options.html thiếu ô nhập id="${key}"`);
}

// Nút điều khiển và vùng hiển thị: không phải setting nên không có key trong
// DEFAULTS — nhưng vẫn phải tồn tại trong HTML, vì options.js gọi thẳng
// `$(id).addEventListener` không guard.
const DIEU_KHIEN = [
  'save', 'discard', 'reset', 'saved', 'savebar', 'dirtyCount',
  'jsonStatus', 'rpcJsonStatus',
  'domReports', 'domReportsStatus', 'copyDomReports', 'clearDomReports',
];
for (const id of DIEU_KHIEN) {
  ok(optionsHtml.includes(`id="${id}"`), `options.html thiếu phần tử điều khiển id="${id}"`);
}

// Chiều ngược lại: mọi id trong FIELDS của options.js phải là key thật của DEFAULTS.
for (const m of optionsJs.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) {
  const id = m[1];
  if (DIEU_KHIEN.includes(id)) continue;
  ok(keys.includes(id), `options.js trỏ tới id="${id}" nhưng DEFAULTS không có key đó`);
}

// popup.js gọi els.X.addEventListener không guard, nên id tương ứng phải tồn tại
// trong popup.html — thiếu một cái là popup chết trắng, không hiện gì cả.
for (const m of popupJs.matchAll(/^\s*(\w+):\s*\$\('([\w-]+)'\)/gm)) {
  ok(popupHtml.includes(`id="${m[2]}"`), `popup.html thiếu id="${m[2]}" mà popup.js có tham chiếu`);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
