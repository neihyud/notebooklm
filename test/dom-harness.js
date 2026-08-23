/*
 * Nạp mã nguồn THẬT của extension vào một DOM THẬT (jsdom) dựng từ fixture đã chụp.
 *
 * Vì sao là jsdom chứ không phải shim tự viết: thứ đang được kiểm ở đây chính là
 * `querySelectorAll` phân giải ra phần tử nào, theo thứ tự nào, và `textContent`
 * gộp chữ của <mat-icon> ra sao. Một shim tự viết sẽ là *bản cài đặt của chính tôi*
 * cho hai thứ đó — test khi ấy chứng nhận cái shim, không chứng nhận trình duyệt.
 * Đây đúng là điều `tools/verify-live.mjs:7` đã cảnh báo.
 *
 * Hai thứ được thay thế, và chỉ hai thứ:
 *   - Layout: jsdom không tính layout nên getBoundingClientRect luôn 0x0, làm
 *     `isVisible()` loại sạch mọi phần tử. Trả về một rect khác 0. `display:none`
 *     và `opacity:0` vẫn do getComputedStyle thật của jsdom quyết định.
 *   - Thời gian chờ của `waitFor`: rút ngắn timeout, GIỮ NGUYÊN ngữ nghĩa
 *     (trả về ngay lần dò đầu thấy truthy, ném lỗi khi hết giờ).
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'notebooklm-add-source-state-main.html');

/**
 * @param {string} extraHtml HTML chèn thêm vào cuối mat-dialog-content, SAU ô Khám phá nguồn.
 * @param {string} bodyHtml  HTML chèn vào <body>, NGOÀI hộp thoại — chỗ duy nhất dựng
 *                           được danh sách Nguồn của notebook, vốn không nằm trong bản chụp.
 * @param {boolean} opts.withContentScript nạp thêm `src/notebooklm/content.js` (router tin
 *                           nhắn) và trả về `dispatch()` để gửi tin như background vẫn gửi.
 */
function loadFixture(extraHtml = '', bodyHtml = '', { withContentScript = false } = {}) {
  const fragment = fs.readFileSync(FIXTURE, 'utf8');

  // Bản chụp bắt đầu từ `.dialog-container` — phần tử host của Angular Material
  // (`mat-dialog-container`) nằm NGOÀI bản chụp, nên bọc lại ở đây. Đây là thứ
  // DUY NHẤT không có trong bản chụp; mọi phần tử được kiểm bên dưới đều nguyên văn.
  const dom = new JSDOM(
    `<!doctype html><html><body><mat-dialog-container role="dialog">${fragment}</mat-dialog-container></body></html>`,
    { runScripts: 'outside-only', url: 'https://notebooklm.google.com/notebook/abc123' }
  );
  const win = dom.window;

  if (extraHtml) {
    win.document.querySelector('[mat-dialog-content]').insertAdjacentHTML('beforeend', extraHtml);
  }
  if (bodyHtml) win.document.body.insertAdjacentHTML('beforeend', bodyHtml);

  // Layout giả — xem ghi chú đầu file.
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0 };
  };

  const load = (rel) => win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  load('src/common/shared.js');

  // Rút ngắn thời gian chờ, giữ nguyên ngữ nghĩa. Phải đặt TRƯỚC khi nạp
  // automation.js vì file đó destructure `waitFor`/`sleep` ngay lúc nạp.
  const realWaitFor = win.NBLM.waitFor;
  win.NBLM.waitFor = (fn, opts) => realWaitFor(fn, Object.assign({}, opts, { timeout: 250, interval: 15 }));

  // `sleep` cũng phải rút, và vì cùng một lý do — nhưng ở đây nó còn quyết định
  // test có *bắt được lỗi* hay không, không chỉ chạy nhanh hay chậm: nhịp
  // `sleep(1200)` trong `awaitDialogResolution` dài hơn mọi độ trễ mà test dựng
  // được, nên nó vô tình che luôn phép chờ danh sách Nguồn cập nhật. Rút xuống
  // rồi thì hai nhịp chờ tách bạch ra và test phân biệt được chúng.
  const realSleep = win.NBLM.sleep;
  win.NBLM.sleep = (ms) => realSleep(Math.min(ms, 40));

  // `chrome.storage.local` là storage THẬT của extension thu nhỏ lại thành một
  // object: automation.js ghi bản chụp DOM thẳng vào đó, nên test phải đọc được
  // đúng thứ đã ghi. Cài TRƯỚC khi nạp automation.js, và cài cho MỌI test chứ
  // không chỉ chế độ content script — bản chụp không đi qua content script.
  const store = {};
  let router = null;
  win.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (router = fn) },
      sendMessage: () => {},
    },
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (obj) => Object.assign(store, JSON.parse(JSON.stringify(obj))),
        remove: async (key) => { delete store[key]; },
      },
      onChanged: { addListener() {} },
    },
  };

  load('src/notebooklm/selectors.js');
  load('src/notebooklm/automation.js');

  // Content script chỉ được nạp khi test cần nó: nó gắn listener và một HUD vào
  // DOM, thứ mọi test khác trong file này không quan tâm.
  let dispatch = null;
  if (withContentScript) {
    load('src/notebooklm/content.js');
    /** Gửi một tin như background vẫn gửi, nhận đúng object mà content script trả lời. */
    dispatch = (message) => new Promise((resolve) => router(message, {}, resolve));
  }

  return {
    dispatch,
    store,
    /**
     * Bản chụp DOM mà automation.js đã ghi vào storage, theo tình huống.
     * Đọc khoá qua `NBLM.KEYS` chứ không gõ lại chuỗi: gõ lại là chép tay một
     * hằng số, và test sẽ xanh cả khi hai đầu ghi/đọc lệch nhau.
     */
    reports: () => store[win.NBLM.KEYS.DOM_REPORTS] || {},
    win,
    doc: win.document,
    dialog: win.document.querySelector('mat-dialog-container'),
    S: win.NBLM_SELECTORS.build(null),
    A: win.NBLM_AUTOMATION,
    I: win.NBLM_AUTOMATION._internals,
    discoverBox: win.document.querySelector('[formcontrolname="discoverSourcesQuery"]'),
    /** Nhãn hiển thị thật của một nút, đọc độc lập với labelOf: chỉ text trong .mdc-button__label, bỏ mat-icon. */
    visibleLabel(el) {
      const holder = el.querySelector('.mdc-button__label') || el;
      return Array.from(holder.querySelectorAll('span'))
        .filter((s) => !s.querySelector('span') && !s.classList.contains('mdc-button__ripple'))
        .map((s) => s.textContent.trim())
        .filter(Boolean)
        .join(' ');
    },
  };
}

/**
 * Nạp `src/youtube/transcript.js` THẬT vào jsdom, kèm một panel transcript dựng tay.
 *
 * Khác `loadFixture` ở đúng một điểm, và cố ý: repo KHÔNG có bản chụp trang watch
 * của YouTube, nên markup dưới đây là do tôi gõ ra. Vì vậy harness này KHÔNG được
 * dùng để chứng nhận selector — một test như thế chỉ chứng nhận thứ tôi vừa gõ, đúng
 * cái bẫy `WORKSPACE_PROTOCOL.md` xếp đầu bảng dominant risks. Thứ nó chứng nhận được
 * là *luồng điều khiển*: vòng cuộn tiêu hết ngân sách thì người gọi có biết hay không,
 * và mốc thời gian với lời thoại của CÙNG một dòng có đi đúng trường của nhau không.
 * Selector có khớp DOM thật hay không thì chỉ `tools/verify-live.mjs` trả lời được.
 *
 * @param {number} total  tổng số dòng transcript mà "YouTube" chịu nạp; Infinity =
 *                        danh sách không bao giờ ngừng dài ra (video rất dài).
 * @param {number} page   số dòng nạp thêm mỗi lần danh sách bị cuộn tới đáy.
 */
function loadTranscriptPanel({ total = Infinity, page = 5 } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <ytd-transcript-renderer>
         <ytd-transcript-segment-list-renderer>
           <div id="segments-container"></div>
         </ytd-transcript-segment-list-renderer>
       </ytd-transcript-renderer>
     </body></html>`,
    { runScripts: 'outside-only', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }
  );
  const win = dom.window;

  // Layout giả — cùng lý do như loadFixture: không có nó thì isVisible() loại sạch.
  win.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40, x: 0, y: 0 };
  };

  const holder = win.document.querySelector('#segments-container');
  const stats = { scrolls: 0 };
  const append = () => {
    for (let k = 0; k < page; k++) {
      const i = holder.children.length;
      if (i >= total) return;
      // Mốc thời gian của dòng i là i giây, lời thoại là "dòng i" — hai chuỗi
      // KHÁC HẲN nhau để đổi chỗ hai trường là lộ ngay, chứ không ra một giá trị
      // vẫn parse được thành số hợp lệ.
      holder.insertAdjacentHTML(
        'beforeend',
        `<transcript-segment-view-model>
           <div class="ytwTranscriptSegmentViewModelTimestamp">0:${String(i).padStart(2, '0')}</div>
           <div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">${i} seconds</div>
           <span role="text">dòng ${i}</span>
         </transcript-segment-view-model>`
      );
    }
  };
  append();

  // YouTube nạp thêm dòng khi danh sách bị cuộn tới đáy. jsdom không có cuộn thật,
  // nên móc vào đúng lời gọi mà `loadAllSegments` dùng để đẩy danh sách đi tiếp.
  win.Element.prototype.scrollIntoView = function () {
    stats.scrolls++;
    append();
  };

  const load = (rel) => win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  load('src/common/shared.js');

  // Rút nhịp chờ, giữ nguyên ngữ nghĩa — phải đặt TRƯỚC khi nạp transcript.js vì
  // file đó destructure `waitFor`/`sleep` ngay lúc nạp. `loadAllSegments` nghỉ 250ms
  // mỗi vòng và chạy tới 40 vòng, không rút thì riêng nó đã 10 giây.
  const realWaitFor = win.NBLM.waitFor;
  win.NBLM.waitFor = (fn, opts) => realWaitFor(fn, Object.assign({}, opts, { timeout: 250, interval: 5 }));
  const realSleep = win.NBLM.sleep;
  win.NBLM.sleep = (ms) => realSleep(Math.min(ms, 1));

  load('src/youtube/transcript.js');

  return { win, T: win.NBLM_TRANSCRIPT, stats, count: () => holder.children.length };
}

module.exports = { loadFixture, loadTranscriptPanel };
