/*
 * Nửa còn lại của bản chụp DOM: nó phải ĐẾN ĐƯỢC TAY OWNER.
 *
 * automation.js ghi rất trung thực vào `chrome.storage.local` cũng vô nghĩa nếu
 * trang Options hiện nhầm thứ, chép nhầm ô, hay nút Xoá xoá nhầm khoá. Đây là
 * đoạn cuối của một đường dữ liệu song song, và không assertion nào khác nhìn tới.
 *
 * Nạp options.html + options.js THẬT vào jsdom; `chrome` và clipboard là stub,
 * phần còn lại nguyên bản.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

// Đọc tên khoá từ chính mã nguồn, không gõ lại chuỗi.
global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
require(path.join(ROOT, 'src/common/shared.js'));
const { KEYS } = global.NBLM;

/** Hai bản chụp KHÁC HẲN nhau, để thấy được cái nào hiện ra chỗ nào. */
const BAN_CHUP = {
  'submit-not-found': {
    situation: 'submit-not-found',
    at: '2026-08-24T01:00:00.000Z',
    detail: { labelsTried: ['chen', 'them'] },
    buttons: [{ tag: 'button', label: 'trang web', path: 'div.drop-zone-actions > button.drop-zone-icon-button', attrs: {} }],
  },
  'source-list-unreadable': {
    situation: 'source-list-unreadable',
    at: '2026-08-24T02:00:00.000Z',
    detail: { listFound: false, sourcesBefore: null, sourcesAfter: null },
    customTags: { 'labs-tailwind-source-list-v2': 1 },
  },
};

const OVERRIDE_CUA_OWNER = { submit: ['luu roi day nhe'] };

function renderOptions(store) {
  const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://test/options.html' });
  const win = dom.window;

  const clipboard = [];
  win.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj) => Object.assign(store, JSON.parse(JSON.stringify(obj))),
        remove: async (key) => { delete store[key]; },
      },
    },
  };
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => clipboard.push(text) },
  });

  win.eval(fs.readFileSync(path.join(ROOT, 'src/common/shared.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8'));

  const $ = (id) => win.document.getElementById(id);
  return {
    win, $, clipboard, store,
    text: () => $('domReports').textContent,
    /** Chờ hai vòng microtask/timer để load() và loadDomReports() chạy xong. */
    settle: () => new Promise((r) => win.setTimeout(r, 10)),
  };
}

(async () => {
  /* ---------- 1. Có bản chụp: hiện ra, và hiện đúng của ai ---------- */
  {
    const g = renderOptions({
      [KEYS.SETTINGS]: { selectorOverrides: OVERRIDE_CUA_OWNER },
      [KEYS.DOM_REPORTS]: BAN_CHUP,
    });
    await g.settle();
    const text = g.text();

    ok(text.includes('submit-not-found') && text.includes('source-list-unreadable'),
      `phải hiện đủ mọi tình huống đã chụp, nhận: ${JSON.stringify(text.slice(0, 200))}`);
    // Nội dung riêng của từng bản chụp — hiện nhầm bản này sang chỗ bản kia thì
    // hai assertion dưới không cùng xanh được.
    ok(text.includes('labelsTried') && text.includes('trang web'),
      `phải hiện chi tiết của bản chụp "không thấy nút", nhận: ${JSON.stringify(text.slice(0, 300))}`);
    ok(text.includes('labs-tailwind-source-list-v2') && text.includes('listFound'),
      `phải hiện chi tiết của bản chụp "không đọc được danh sách", nhận: ${JSON.stringify(text.slice(0, 300))}`);
    ok(g.$('domReportsStatus').textContent.includes('2 tình huống'),
      `dòng trạng thái phải đếm đúng số tình huống, nhận: ${JSON.stringify(g.$('domReportsStatus').textContent)}`);
    ok(g.$('copyDomReports').disabled === false && g.$('clearDomReports').disabled === false,
      'có bản chụp thì hai nút phải bấm được');

    /* ---- 2. Nút Sao chép chép ĐÚNG bản chụp, không phải ô nào khác ---- */
    // Trên trang này có hai khối chữ JSON cạnh nhau: bản chụp và ô Ghi đè
    // selector. Chép nhầm ô thì owner gửi về đúng thứ chính owner vừa gõ vào.
    g.$('copyDomReports').click();
    await g.settle();

    ok(g.clipboard.length === 1, `bấm một lần phải chép một lần, nhận: ${g.clipboard.length}`);
    ok(g.clipboard[0] === text, 'chuỗi chép ra phải LÀ chuỗi đang hiện');
    ok(g.clipboard[0].includes('source-list-unreadable'), 'chuỗi chép ra phải là bản chụp');
    ok(!g.clipboard[0].includes('luu roi day nhe'),
      `chuỗi chép ra không được là nội dung ô Ghi đè selector, nhận: ${JSON.stringify(g.clipboard[0].slice(0, 200))}`);
    ok(g.$('selectorOverrides').value.includes('luu roi day nhe'),
      'tiền đề: ô Ghi đè selector đang thật sự có nội dung khác để mà chép nhầm');
    ok(/đã sao chép/i.test(g.$('domReportsStatus').textContent),
      `chép xong phải báo, nhận: ${JSON.stringify(g.$('domReportsStatus').textContent)}`);
  }

  /* ---------- 3. Chưa có bản chụp nào ---------- */
  {
    const g = renderOptions({ [KEYS.SETTINGS]: {} });
    await g.settle();
    ok(/chưa có bản chụp/i.test(g.text()), `chưa có gì thì phải nói ra, nhận: ${JSON.stringify(g.text())}`);
    ok(g.$('copyDomReports').disabled === true && g.$('clearDomReports').disabled === true,
      'không có bản chụp thì hai nút phải tắt');
  }

  /* ---------- 4. Nút Xoá: xoá bản chụp, KHÔNG đụng thứ khác ---------- */
  {
    const store = {
      [KEYS.SETTINGS]: { selectorOverrides: OVERRIDE_CUA_OWNER, notebookUrl: 'https://notebooklm.google.com/notebook/abc' },
      [KEYS.QUEUE]: [{ id: 'a', title: 'mục đang chờ' }],
      [KEYS.DOM_REPORTS]: BAN_CHUP,
    };
    const g = renderOptions(store);
    await g.settle();

    g.$('clearDomReports').click();
    await g.settle();

    ok(store[KEYS.DOM_REPORTS] === undefined,
      `Xoá phải dọn sạch bản chụp, nhận: ${JSON.stringify(Object.keys(store))}`);
    // Ba khoá cùng nằm trong một storage: xoá nhầm khoá là mất hàng đợi hoặc mất
    // cài đặt của owner, mà giao diện thì trông y hệt lúc xoá đúng.
    ok(store[KEYS.SETTINGS] && store[KEYS.SETTINGS].notebookUrl === 'https://notebooklm.google.com/notebook/abc',
      `Xoá bản chụp không được đụng vào Cài đặt, nhận: ${JSON.stringify(store[KEYS.SETTINGS])}`);
    ok(Array.isArray(store[KEYS.QUEUE]) && store[KEYS.QUEUE].length === 1,
      `Xoá bản chụp không được đụng vào Hàng đợi, nhận: ${JSON.stringify(store[KEYS.QUEUE])}`);
    ok(/chưa có bản chụp/i.test(g.text()), `xoá xong màn hình phải cập nhật, nhận: ${JSON.stringify(g.text().slice(0, 80))}`);
    ok(g.$('copyDomReports').disabled === true, 'xoá xong thì nút Sao chép phải tắt');
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
