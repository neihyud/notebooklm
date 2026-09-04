/*
 * Bề mặt (p) — popup có nói cho owner biết đang GỬI TỚI notebook nào không.
 *
 * Vì sao tồn tại: khối "Dán URL notebook" gập lại theo mặc định để thôi lặp
 * lại thứ dropdown ngay trên nó đang nói. Nhưng ở trạng thái popup vừa mở, cả
 * ba chỗ cùng câm — dropdown còn treo "Bấm ↻ để nạp danh sách", ô URL có giá
 * trị thật nhưng nằm trong khối gập, và hint để rỗng. Popup khi ấy ghi nhãn
 * "Gửi tới" mà không đâu nói gửi tới đâu.
 *
 * Đo 2026-09-04 bằng Brave headless (`tools/chup-popup.mjs`, DOM=1), bản trước
 * khi vá, cảnh "đã đặt notebook + chưa bấm ↻":
 *     urlValue "…/notebook/abc123" | manualOpen false | hint "" | nbOpts ["Bấm ↻ để nạp danh sách"]
 *
 * Từ lượt bỏ khối "Dán URL notebook", ô URL không còn trong popup nữa, nên hint
 * là chỗ DUY NHẤT nói ra notebook đích — trước đây nó mới chỉ là chỗ duy nhất
 * nói ra khi khối kia đang gập.
 *
 * Chứng nhận: hint nói ra notebook đích ở MỌI trạng thái — id khi popup mới
 * chỉ có id, tên ngay khi cầm được tên. Vế "đã nạp thì hint rỗng" từng được
 * ghim ở đây và đã bị gỡ có chủ ý: nó đúng khi dropdown tự chọn notebook đang
 * lưu (hint im để khỏi lặp lại dropdown), và thành sai đúng lúc dropdown chuyển
 * sang luôn đứng ở "+ Tạo notebook mới" — giữ nó lại là bịt nốt chỗ cuối cùng
 * còn nói ra đích đến.
 *
 * Chứng nhận thêm: nhánh "với tới tab được mà không đọc nổi danh sách" phải chỉ
 * đúng lối thoát còn sống. Lối ấy đã DỜI CHỖ chứ không mất — ô "URL notebook"
 * giờ nằm ở trang Cài đặt.
 *
 * KHÔNG chứng nhận: khối gập có mở ra không, và trông thế nào. jsdom không có
 * cascade CSS; `tools/chup-popup.mjs` là mắt.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

const rejections = [];
process.on('unhandledRejection', (e) => rejections.push((e && e.message) || String(e)));

const NB = 'https://notebooklm.google.com/notebook/abc123';

/**
 * @param {string} notebookUrl notebook đích đang lưu
 * @param {object|null} notebooks phản hồi `list-notebooks`; null = không nạp được
 * @param {boolean} bamNap có bấm ↻ hay không — ràng buộc cử chỉ của ticket 011
 * @param {boolean} quaNhip chờ qua một nhịp `setInterval(refresh, 1500)`
 */
async function moPopup(notebookUrl, notebooks = null, bamNap = false, quaNhip = false, settingsVao = null) {
  const html = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://test/popup.html' });
  const win = dom.window;
  // `settingsVao` cho phép một object settings sống qua NHIỀU lượt mở popup —
  // đúng như `chrome.storage.local` sống qua các lần owner đóng/mở popup.
  const settings = settingsVao || { notebookUrl };
  if (settingsVao) settings.notebookUrl = notebookUrl;

  win.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'get-state') return { ok: true, queue: [], counts: {}, settings, running: false };
        if (msg.type === 'list-notebooks') return notebooks || { ok: false, needsTab: true };
        if (msg.type === 'list-accounts') return { ok: false };
        return {};
      },
      onMessage: { addListener() {} },
      openOptionsPage() {},
    },
    tabs: { query: async () => [] },
    storage: {
      local: {
        get: async () => ({ settings }),
        set: async (o) => Object.assign(settings, (o && o.settings) || {}),
      },
      onChanged: { addListener() {} },
    },
  };

  win.eval(fs.readFileSync(path.join(ROOT, 'src/common/shared.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'src/popup/popup.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 30));

  if (bamNap) {
    win.document.getElementById('notebook-refresh').click();
    await new Promise((r) => setTimeout(r, 60));
  }
  /*
   * Phải chờ qua nhịp `setInterval(refresh, 1500)` của `popup.js:1239`, nếu
   * không ca "đã nạp" chẳng đo gì cả.
   *
   * Ngay sau ↻ thì hint rỗng, vì `napDanhSach()` TỰ đặt `textContent = ''` ở
   * nhánh nạp được. Không chờ qua nhịp thì ca "đã nạp" đang đo đúng cái rỗng
   * tạm thời đó, chứ không đo `render()` — mà `render()` mới là chỗ quyết định
   * hint nói gì ở mọi lượt mở về sau.
   */
  if (quaNhip) await new Promise((r) => setTimeout(r, 1800));
  const $ = (id) => win.document.getElementById(id);
  const doc = {
    hint: $('notebook-hint').textContent,
    selDisabled: $('notebook-select').disabled,
    selLabel: $('notebook-select').selectedOptions[0] ? $('notebook-select').selectedOptions[0].textContent : null,
  };

  /*
   * `popup.js:1239` gọi `setInterval(refresh, 1500)` và không bao giờ dọn — đúng
   * cho một popup mà Chrome tự huỷ khi đóng, nhưng trong Node thì nó giữ event
   * loop sống mãi. Bản đầu tiên của file này in đủ "10 pass, 0 fail" rồi TREO,
   * và `test/run.sh` chạy tuần tự nên nó sẽ treo luôn cả suite, không phải mỗi
   * file này. Đọc xong giá trị thì đóng cửa sổ ngay.
   */
  win.close();
  doc.settings = settings;
  return doc;
}

(async () => {
  /* ---- 1. Đã đặt, CHƯA nạp: đây là trạng thái popup vừa mở ---- */
  {
    const r = await moPopup(NB);
    ok(r.settings.notebookUrl === NB, 'tiền đề: notebook đích đã có trong settings');
    ok(r.selDisabled === true, 'tiền đề: dropdown chưa nạp nên còn khoá');
    ok(
      r.hint.includes('abc123'),
      `hint phải nói ra notebook đích khi không chỗ nào khác nói, nhận: ${JSON.stringify(r.hint)}`
    );
    ok(/↻/.test(r.hint), `hint phải chỉ đường xem tên đầy đủ, nhận: ${JSON.stringify(r.hint)}`);
  }

  /* ---- 2. Đã đặt VÀ đã nạp: dropdown hiện đích, hint VẪN nói ---- */
  /*
   * Trùng lặp có chủ ý, và ca 1 là lý do: trước cú bấm ↻ dropdown còn treo
   * "Bấm ↻ để nạp danh sách", nên hint là chỗ duy nhất nói ra đích. Cho hint im
   * sau khi nạp thì owner được trả lời ở đúng trạng thái họ ÍT gặp nhất, và câm
   * ở trạng thái họ gặp mọi lần mở popup.
   */
  {
    const r = await moPopup(NB, {
      ok: true,
      notebooks: [{ id: 'abc123', title: 'Sổ nghiên cứu' }, { id: 'xyz789', title: 'Sổ khác' }],
    }, true, true);
    ok(r.selDisabled === false, 'tiền đề: đã nạp thì dropdown mở khoá');
    ok(r.selLabel === 'Sổ nghiên cứu', `dropdown "Gửi tới" phải hiện ĐÚNG đích, nhận: ${JSON.stringify(r.selLabel)}`);
    ok(r.hint.includes('Sổ nghiên cứu'), `và hint nói lại, vì trước cú ↻ nó là chỗ duy nhất, nhận: ${JSON.stringify(r.hint)}`);
  }

  /* ---- 3. Lượt mở SAU: đã có tên trong tay thì phải nói tên, không nói id ---- */
  /*
   * Đây mới là ca owner gặp thật. Lượt đầu popup chỉ có id, nhưng lượt bấm ↻ là
   * lần duy nhất popup cầm được tên notebook — không ghi lại thì mọi lượt mở về
   * sau vẫn chỉ có id, và câu "bấm ↻ để thấy tên" thành một vòng lặp vĩnh viễn.
   */
  {
    const chung = { notebookUrl: NB };
    const nap = { ok: true, notebooks: [{ id: 'abc123', title: 'Sổ nghiên cứu' }, { id: 'xyz789', title: 'Sổ khác' }] };

    await moPopup(NB, nap, true, true, chung);          // lượt 1: bấm ↻
    ok(
      chung.notebookLabel && chung.notebookLabel.title === 'Sổ nghiên cứu',
      `lượt bấm ↻ phải ghi lại tên, nhận: ${JSON.stringify(chung.notebookLabel)}`
    );

    const r = await moPopup(NB, null, false, false, chung);   // lượt 2: mở lại, KHÔNG bấm gì
    ok(r.hint.includes('Sổ nghiên cứu'), `lượt mở sau phải nói TÊN, nhận: ${JSON.stringify(r.hint)}`);
    ok(!r.hint.includes('abc123'), `và thôi bắt owner đọc id, nhận: ${JSON.stringify(r.hint)}`);
  }

  /* ---- 4. Đổi sang notebook khác: tên cũ KHÔNG được dính lại ---- */
  /*
   * Hoán vị mà ca này bắt: bỏ phép so `label.url === settings.notebookUrl`.
   * Khi ấy popup hiện tên notebook TRƯỚC ĐÓ cho một notebook hoàn toàn khác —
   * sai im lặng và trông rất đáng tin, đúng kiểu tệ nhất. Hai trong bốn đường
   * ghi `notebookUrl` không biết tên — ô "URL notebook" ở trang Cài đặt
   * (`options.js`), và lượt đổi tài khoản xoá trắng nó ở `service-worker.js` —
   * nên ca này không phải giả tưởng.
   */
  {
    const chung = { notebookUrl: NB };
    await moPopup(NB, { ok: true, notebooks: [{ id: 'abc123', title: 'Sổ nghiên cứu' }] }, true, true, chung);
    ok(chung.notebookLabel && chung.notebookLabel.title === 'Sổ nghiên cứu', 'tiền đề: đã có tên trong storage');

    const KHAC = 'https://notebooklm.google.com/notebook/khac999';
    const r = await moPopup(KHAC, null, false, false, chung);
    ok(!r.hint.includes('Sổ nghiên cứu'), `tên cũ không được dính sang notebook khác, nhận: ${JSON.stringify(r.hint)}`);
    ok(r.hint.includes('khac999'), `phải lùi về id của notebook MỚI, nhận: ${JSON.stringify(r.hint)}`);
  }

  /* ---- 5. Đích rỗng = "+ Tạo notebook mới": phải nói ra LÚC NÀO tạo ---- */
  /*
   * `notebookUrl` rỗng từng nghĩa là "dùng tab NotebookLM nào đang mở sẵn". Nay
   * nó là lựa chọn "+ Tạo notebook mới", và sổ chỉ ra đời khi owner bấm Chạy.
   *
   * Ghim cả thời điểm, không chỉ ý định: "sẽ tạo notebook mới" mà không nói khi
   * nào thì owner không biết mình đang cầm một cú bấm đẻ ra sổ — và đó đúng là
   * thứ họ cần biết trước khi bấm.
   */
  {
    const r = await moPopup('');
    ok(/tạo.*notebook mới/i.test(r.hint), `đích rỗng thì phải nói là sẽ TẠO, nhận: ${JSON.stringify(r.hint)}`);
    ok(/Chạy/.test(r.hint), `và nói rõ tạo lúc bấm Chạy, nhận: ${JSON.stringify(r.hint)}`);
    ok(!/tab NotebookLM nào đang mở/.test(r.hint), 'không còn hứa cái nghĩa cũ "dùng tab đang mở"');
    ok(!r.hint.includes('abc123'), 'và không được lẫn id của ca khác');
  }

  /* ---- 6. URL méo, không rút được id: thà im còn hơn nói sai ---- */
  {
    const r = await moPopup('https://notebooklm.google.com/khong-phai-notebook');
    ok(r.hint === '', `URL không rút được id thì hint để rỗng, nhận: ${JSON.stringify(r.hint)}`);
  }

  /* ---- 7. Với tới tab được nhưng không đọc nổi danh sách ---- */
  /*
   * Nhánh này là chỗ duy nhất popup phải chỉ đường ra, và nó vừa chỉ sai: câu
   * cũ bảo owner "dán URL vào ô dưới" trong khi ô đó đã bị gỡ khỏi popup cùng
   * lượt. Chỉ vào một ô không tồn tại thì tệ hơn im lặng — owner đi tìm mãi
   * một thứ không có, và tưởng extension hỏng thay vì đi tiếp bằng đường khác.
   *
   * Ghim CẢ HAI vế, vì một vế không đủ: "có nhắc Cài đặt" vẫn xanh nếu câu đó
   * còn dính thêm mệnh đề "ô dưới", và "không nhắc ô dưới" vẫn xanh nếu câu
   * biến thành rỗng.
   */
  {
    const r = await moPopup('', { ok: false }, true, false);
    ok(r.selDisabled === false, 'tiền đề: vẫn với tới được backend nên dropdown mở khoá');
    ok(
      r.selLabel === '+ Tạo notebook mới',
      `tiền đề: lối tạo mới vẫn còn, đây không phải ngõ cụt, nhận: ${JSON.stringify(r.selLabel)}`
    );
    ok(
      /Cài đặt/.test(r.hint),
      `phải chỉ sang nơi ô dán URL thực sự đang nằm, nhận: ${JSON.stringify(r.hint)}`
    );
    ok(
      !/ô dưới|ô bên dưới/.test(r.hint),
      `không được chỉ xuống một ô đã bị gỡ khỏi popup, nhận: ${JSON.stringify(r.hint)}`
    );
  }

  for (const e of rejections) { fail++; console.log(`❌ promise rejection không ai bắt: ${e}`); }
  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail) process.exitCode = 1;
})();
