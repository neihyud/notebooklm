/*
 * "Chưa xác minh được" phải NHÌN THẤY ĐƯỢC trong popup, không chỉ nằm trong storage.
 *
 * Đây là nửa còn lại của khuyết tật "done không có nghĩa là đã vào": automation có
 * thể trả `verified: false` rất trung thực, nhưng nếu popup vẫn in "Xong" như mọi
 * mục khác thì người dùng vẫn tin nhầm đúng như cũ.
 *
 * Nạp popup.html + popup.js THẬT vào jsdom; `chrome` là stub, phần còn lại nguyên bản.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

const QUEUE = [
  { id: 'a', videoId: 'aaaaaaaaaaa', title: 'Đã đối chiếu', status: 'done', mode: 'text', verified: true },
  {
    id: 'b',
    videoId: 'bbbbbbbbbbb',
    title: 'Không đọc được danh sách',
    status: 'done',
    mode: 'text',
    verified: false,
    unverified: 'Không đọc được danh sách Nguồn của notebook nên chưa xác minh được nguồn đã vào hay chưa.',
  },
  { id: 'c', videoId: 'ccccccccccc', title: 'Hỏng thật', status: 'error', error: 'lỗi gì đó' },
];

function renderPopup(queue) {
  const html = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://test/popup.html' });
  const win = dom.window;

  /** Mọi tin popup gửi lên background — để quan sát nút nào gây ra HÀNH ĐỘNG gì. */
  const sent = [];
  win.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg.type);
        return msg.type === 'get-state' ? { queue, settings: { notebookUrl: '' }, running: false } : {};
      },
      onMessage: { addListener() {} },
      openOptionsPage() {},
    },
    tabs: { query: async () => [] },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };

  win.eval(fs.readFileSync(path.join(ROOT, 'src/common/shared.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'src/popup/popup.js'), 'utf8'));
  win.__sent = sent;
  return win;
}

const CHUA_XAC_MINH = /chưa xác minh/i;

(async () => {
  const win = renderPopup(QUEUE);
  // render() chạy sau một lượt await trong refresh().
  await new Promise((r) => setTimeout(r, 30));

  const items = [...win.document.querySelectorAll('#list .item')];
  ok(items.length === 3, `popup phải dựng đủ 3 dòng, nhận: ${items.length}`);
  if (items.length !== 3) {
    console.log(`${pass} pass, ${fail} fail`);
    process.exit(1);
  }

  // Danh sách được đảo ngược (mới nhất lên đầu), nên tra theo tiêu đề cho chắc.
  const dong = (title) => items.find((li) => li.textContent.includes(title));
  const daDoiChieu = dong('Đã đối chiếu');
  const chuaBiet = dong('Không đọc được danh sách');
  const hong = dong('Hỏng thật');

  ok(CHUA_XAC_MINH.test(chuaBiet.textContent), `mục verified:false phải hiện chữ "chưa xác minh", nhận: ${JSON.stringify(chuaBiet.textContent)}`);
  ok(!CHUA_XAC_MINH.test(daDoiChieu.textContent), `mục verified:true KHÔNG được hiện chữ đó, nhận: ${JSON.stringify(daDoiChieu.textContent)}`);
  ok(!CHUA_XAC_MINH.test(hong.textContent), `mục lỗi cũng không hiện chữ đó (nó hỏng, không phải chưa biết), nhận: ${JSON.stringify(hong.textContent)}`);

  // Phân biệt được bằng máy, không chỉ bằng mắt — để CSS tô khác và để test sau
  // này khỏi phải dò chuỗi tiếng Việt.
  ok(chuaBiet.dataset.verified === 'false', `dòng chưa xác minh phải mang data-verified="false", nhận: ${JSON.stringify(chuaBiet.dataset.verified)}`);
  ok(daDoiChieu.dataset.verified === 'true', `dòng đã xác minh phải mang data-verified="true", nhận: ${JSON.stringify(daDoiChieu.dataset.verified)}`);
  ok(hong.dataset.verified === undefined, `mục chưa xong thì không gắn data-verified, nhận: ${JSON.stringify(hong.dataset.verified)}`);

  // Lý do cụ thể phải tới được người đọc, không dừng ở storage.
  ok(chuaBiet.textContent.includes('danh sách Nguồn'), `lý do do automation gửi lên phải hiện ra, nhận: ${JSON.stringify(chuaBiet.textContent)}`);

  /* ---- mục done cũ (chưa có trường verified) không được biến thành báo động ---- */
  // Hàng đợi sống qua các lần Chrome tắt service worker, nên dữ liệu cũ của owner
  // sẽ gặp code mới — xem WORKSPACE_PROTOCOL, mục expensive-to-reverse.
  {
    const w = renderPopup([{ id: 'x', videoId: 'xxxxxxxxxxx', title: 'Mục cũ', status: 'done', mode: 'text' }]);
    await new Promise((r) => setTimeout(r, 30));
    const li = w.document.querySelector('#list .item');
    ok(!CHUA_XAC_MINH.test(li.textContent), `mục done từ trước bản vá không được hiện cảnh báo, nhận: ${JSON.stringify(li.textContent)}`);
  }

  /* ---- ticket 003: MỘT nút Chạy, và Bản sao xuống đĩa phải nói được lý do ---- */

  {
    const LY_DO_NGUON = 'Không đọc được danh sách Nguồn của notebook.';
    const LY_DO_DIA = 'Chrome không ghi được file (FILE_NO_SPACE)';
    const w = renderPopup([
      { id: 'p', videoId: 'ppppppppppp', title: 'Nguồn vào, file hỏng', status: 'done', mode: 'url', verified: true, copyError: LY_DO_DIA },
      { id: 'q', videoId: 'qqqqqqqqqqq', title: 'Nguồn chưa chắc, file xong', status: 'done', mode: 'url', verified: false, unverified: LY_DO_NGUON, savedFile: 'Transcript YouTube/002 - x.txt' },
    ]);
    await new Promise((r) => setTimeout(r, 30));

    /* --- một nút Chạy duy nhất (owner chốt phiên grilling 2026-08-23) --- */
    // Assert HÀNH ĐỘNG: bấm "Chạy" phải gây ra đúng lệnh chạy hàng đợi, và không
    // còn nút nào trong popup gây ra lệnh chạy thứ hai.
    ok(w.document.querySelector('#run-download') === null, 'nút "Tải transcript" phải biến mất khỏi popup');
    w.__sent.length = 0;
    w.document.getElementById('run').dispatchEvent(new w.Event('click'));
    await new Promise((r) => setTimeout(r, 20));
    ok(w.__sent.includes('run'), `bấm "Chạy" phải gửi lệnh run, đã gửi: ${JSON.stringify(w.__sent)}`);
    ok(
      !w.__sent.includes('run-download'),
      `không còn lệnh chạy riêng cho đường tải đĩa, đã gửi: ${JSON.stringify(w.__sent)}`
    );

    /* --- hai lý do khác nhau, hai chỗ khác nhau --- */
    // `unverified` và `copyError` là hai chuỗi cùng kiểu đi vào cùng một thẻ dòng.
    // Hoán vị chúng vẫn cho ra một dòng nhìn hợp lý — chỉ phép đối chiếu theo
    // TỪNG phần tử mới bắt được, còn `textContent.includes(...)` của cả dòng thì không.
    const items = [...w.document.querySelectorAll('#list .item')];
    const fileHong = items.find((li) => li.textContent.includes('Nguồn vào, file hỏng'));
    const nguonChuaChac = items.find((li) => li.textContent.includes('Nguồn chưa chắc, file xong'));

    const copy = (li) => li.querySelector('.item__copy-error');
    const unver = (li) => li.querySelector('.item__unverified');

    ok(!!copy(fileHong), 'mục ghi file hỏng phải có riêng một dòng .item__copy-error');
    ok(
      copy(fileHong) && copy(fileHong).textContent.includes(LY_DO_DIA),
      `lý do ghi file hỏng phải nằm trong .item__copy-error, nhận: ${JSON.stringify(copy(fileHong) && copy(fileHong).textContent)}`
    );
    ok(!unver(fileHong), `Nguồn đã đối chiếu được thì không dựng dòng "chưa xác minh", nhận: ${JSON.stringify(unver(fileHong) && unver(fileHong).textContent)}`);

    ok(!!unver(nguonChuaChac), 'mục chưa xác minh được Nguồn vẫn phải có dòng .item__unverified');
    ok(
      unver(nguonChuaChac) && unver(nguonChuaChac).textContent.includes(LY_DO_NGUON),
      `lý do chưa xác minh Nguồn phải nằm trong .item__unverified, nhận: ${JSON.stringify(unver(nguonChuaChac) && unver(nguonChuaChac).textContent)}`
    );
    ok(
      !copy(nguonChuaChac),
      `ghi file xong xuôi thì KHÔNG được dựng dòng báo lỗi ghi file, nhận: ${JSON.stringify(copy(nguonChuaChac) && copy(nguonChuaChac).textContent)}`
    );
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
