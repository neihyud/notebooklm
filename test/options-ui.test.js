/*
 * Hình dạng mới của trang Cài đặt: tab nối được với panel cho trình đọc màn hình,
 * thanh Lưu chỉ hiện khi có thay đổi thật, và Khôi phục mặc định phải qua xác nhận.
 *
 * Nạp options.html + options.js THẬT vào jsdom; `chrome` là stub, phần còn lại nguyên bản.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));
const eq = (got, want, m) => ok(got === want, `${m} — mong ${JSON.stringify(want)}, nhận ${JSON.stringify(got)}`);

function openOptions() {
  const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://test/options.html' });
  const win = dom.window;

  /** Mọi lần ghi xuống storage — để thấy nút nào thực sự GHI, không chỉ đổi chữ. */
  const writes = [];
  let store = {};
  win.chrome = {
    storage: {
      local: {
        get: async (k) => (store[k] ? { [k]: store[k] } : {}),
        set: async (obj) => {
          writes.push(obj);
          Object.assign(store, obj);
        },
      },
    },
  };
  win.navigator.clipboard = { writeText: async () => {} };

  win.eval(fs.readFileSync(path.join(ROOT, 'src/common/shared.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8'));
  win.__writes = writes;
  return win;
}

const settle = () => new Promise((r) => setTimeout(r, 40));
const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));
const key = (win, el, k) => {
  const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
};

(async () => {
  /* ---------------------------------------------------------------- */
  /* 1. Tab nối được với panel — hợp đồng của role="tablist"            */
  /* ---------------------------------------------------------------- */
  {
    const win = openOptions();
    await settle();
    const tabs = [...win.document.querySelectorAll('.opt-tab')];
    ok(tabs.length >= 3, `phải có ít nhất 3 tab, nhận ${tabs.length}`);

    for (const tab of tabs) {
      const id = tab.getAttribute('aria-controls');
      ok(!!id, `tab "${tab.textContent.trim()}" thiếu aria-controls`);
      const panel = id && win.document.getElementById(id);
      ok(!!panel, `aria-controls của "${tab.textContent.trim()}" trỏ tới panel không tồn tại: ${id}`);
      // Chiều ngược lại: panel phải chỉ về đúng cái tab đang trỏ tới nó, chứ không
      // phải một tab bất kỳ — hoán vị hai giá trị này vẫn cho hai chuỗi hợp lệ.
      ok(panel && panel.getAttribute('aria-labelledby') === tab.id,
        `panel ${id} phải aria-labelledby="${tab.id}", nhận ${panel && panel.getAttribute('aria-labelledby')}`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 2. Roving tabindex + phím mũi tên                                  */
  /* ---------------------------------------------------------------- */
  {
    const win = openOptions();
    await settle();
    const tabs = [...win.document.querySelectorAll('.opt-tab')];

    eq(tabs[0].tabIndex, 0, 'tab đang chọn nằm trong thứ tự Tab');
    eq(tabs[1].tabIndex, -1, 'tab không chọn bị lấy ra khỏi thứ tự Tab');

    key(win, tabs[0], 'ArrowRight');
    eq(tabs[1].getAttribute('aria-selected'), 'true', 'mũi tên phải chuyển sang tab kế');
    eq(win.document.getElementById('panel-strategy').hidden, false, 'và panel tương ứng hiện ra');
    eq(win.document.getElementById('panel-basic').hidden, true, 'panel cũ ẩn đi');
    eq(tabs[1].tabIndex, 0, 'tabindex đi theo tab đang chọn');
    eq(tabs[0].tabIndex, -1, 'tab cũ rời khỏi thứ tự Tab');

    key(win, tabs[1], 'End');
    eq(tabs[2].getAttribute('aria-selected'), 'true', 'phím End nhảy tới tab cuối');

    key(win, tabs[2], 'ArrowRight');
    eq(tabs[0].getAttribute('aria-selected'), 'true', 'từ tab cuối thì vòng về tab đầu');
  }

  /* ---------------------------------------------------------------- */
  /* 3. Thanh Lưu chỉ hiện khi có thay đổi THẬT                         */
  /* ---------------------------------------------------------------- */
  {
    const win = openOptions();
    await settle();
    const bar = win.document.getElementById('savebar');
    const save = win.document.getElementById('save');

    eq(bar.hidden, true, 'mới mở trang thì không có gì để lưu');
    eq(save.disabled, true, 'và nút Lưu tắt');

    const langs = win.document.getElementById('preferredLangs');
    langs.value = 'en, fr';
    langs.dispatchEvent(new win.Event('input', { bubbles: true }));

    eq(bar.hidden, false, 'đổi một ô thì thanh Lưu hiện');
    eq(save.disabled, false, 'và nút Lưu bật');
    ok(/1 thay đổi/.test(win.document.getElementById('dirtyCount').textContent),
      `phải đếm đúng số ô đã đổi, nhận: ${JSON.stringify(win.document.getElementById('dirtyCount').textContent)}`);

    // Đổi ô thứ hai ở TAB KHÁC: một nút Lưu gánh cả ba tab, con số phải nói ra điều đó.
    const delay = win.document.getElementById('delayMs');
    delay.value = '1234';
    delay.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(/2 thay đổi/.test(win.document.getElementById('dirtyCount').textContent),
      `đổi ô ở tab khác vẫn phải được đếm, nhận: ${JSON.stringify(win.document.getElementById('dirtyCount').textContent)}`);

    // Trả ô về đúng giá trị cũ thì hết "bẩn" — đếm theo giá trị, không theo số lần gõ.
    langs.value = 'vi, en';
    langs.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(/1 thay đổi/.test(win.document.getElementById('dirtyCount').textContent),
      `gõ về giá trị cũ thì không còn tính là thay đổi, nhận: ${JSON.stringify(win.document.getElementById('dirtyCount').textContent)}`);

    // Lưu: assert HÀNH ĐỘNG — có ghi xuống storage, và giá trị đúng là cái vừa gõ.
    win.__writes.length = 0;
    click(win, save);
    await settle();
    eq(win.__writes.length, 1, 'bấm Lưu phải ghi xuống storage đúng một lần');
    const written = win.__writes[0] && Object.values(win.__writes[0])[0];
    eq(written && written.delayMs, 1234, 'giá trị vừa gõ phải là giá trị được ghi');
    eq(bar.hidden, true, 'lưu xong thì thanh Lưu biến mất');
  }

  /* ---------------------------------------------------------------- */
  /* 4. Bỏ thay đổi trả về giá trị ĐANG LƯU, không phải mặc định        */
  /* ---------------------------------------------------------------- */
  {
    const win = openOptions();
    await settle();
    const langs = win.document.getElementById('preferredLangs');
    const cu = langs.value;

    langs.value = 'zz';
    langs.dispatchEvent(new win.Event('input', { bubbles: true }));
    eq(win.document.getElementById('savebar').hidden, false, 'đã bẩn');

    win.__writes.length = 0;
    click(win, win.document.getElementById('discard'));
    await settle();
    eq(langs.value, cu, 'Bỏ thay đổi trả ô về giá trị đang lưu');
    eq(win.document.getElementById('savebar').hidden, true, 'và thanh Lưu ẩn lại');
    eq(win.__writes.length, 0, 'Bỏ thay đổi KHÔNG được ghi gì xuống storage');
  }

  /* ---------------------------------------------------------------- */
  /* 5. Khôi phục mặc định: rời khỏi nút Lưu, và cần xác nhận           */
  /* ---------------------------------------------------------------- */
  {
    const win = openOptions();
    await settle();
    const reset = win.document.getElementById('reset');

    // Hình dạng: nút phá hoại không còn là anh em của nút Lưu.
    const bar = win.document.getElementById('savebar');
    ok(!bar.contains(reset), 'Khôi phục mặc định không được nằm trong thanh Lưu');
    ok(reset.closest('.danger'), 'nó phải nằm trong vùng nguy hiểm riêng');

    win.__writes.length = 0;
    click(win, reset);
    await settle();
    eq(win.__writes.length, 0, 'cú bấm đầu KHÔNG được khôi phục gì');

    click(win, reset);
    await settle();
    eq(win.__writes.length, 1, 'cú bấm thứ hai mới thực sự khôi phục');
  }

  /* ---------------------------------------------------------------- */
  /* 6. Hai ô JSON, hai dòng báo lỗi riêng                              */
  /* ---------------------------------------------------------------- */
  {
    const win = openOptions();
    await settle();
    const rpc = win.document.getElementById('rpcOverrides');
    const sel = win.document.getElementById('selectorOverrides');

    rpc.value = '{ hỏng';
    rpc.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(/không hợp lệ/.test(win.document.getElementById('rpcJsonStatus').textContent),
      'ô RPC hỏng thì báo dưới ô RPC');
    eq(win.document.getElementById('jsonStatus').textContent, '',
      'và KHÔNG báo nhầm xuống dòng của ô selector');

    sel.value = '{ "addSource": ["x"] }';
    sel.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(/hợp lệ/.test(win.document.getElementById('jsonStatus').textContent),
      'ô selector đúng cú pháp thì báo dưới ô selector');
    ok(/không hợp lệ/.test(win.document.getElementById('rpcJsonStatus').textContent),
      'và dòng báo lỗi của ô RPC vẫn nguyên — hai ô không dùng chung một chỗ');

    // Lưu khi còn ô hỏng: không được ghi, và phải mở đúng tab chứa ô đó.
    win.__writes.length = 0;
    click(win, win.document.getElementById('save'));
    await settle();
    eq(win.__writes.length, 0, 'JSON hỏng thì không ghi gì xuống storage');
    eq(win.document.getElementById('panel-advanced').hidden, false,
      'và trang phải mở đúng tab chứa ô đang hỏng');
  }

  /* ---------------------------------------------------------------- */
  /* 7. Mỗi ô nhập có nhãn nối đúng vào nó                              */
  /* ---------------------------------------------------------------- */
  {
    const win = openOptions();
    await settle();
    const controls = [...win.document.querySelectorAll('.field input, .field select, .field textarea')];
    ok(controls.length > 15, `phải có nhiều ô nhập trong bố cục .field, nhận ${controls.length}`);
    for (const el of controls) {
      const label = win.document.querySelector(`label[for="${el.id}"]`);
      ok(!!label, `ô "${el.id}" không có <label for> trỏ vào nó`);
    }
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
