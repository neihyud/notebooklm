/*
 * Hình dạng mới của popup sau đợt rà UI: thẻ trạng thái, chip lọc, tiến độ tổng,
 * menu gom thao tác xoá, nhãn nút đếm động, và ngữ cảnh tab hiện tại.
 *
 * Mỗi khẳng định ở đây ghim một CHỖ cụ thể (phần tử nào, thuộc tính nào) chứ không
 * đọc `textContent` của cả dòng: hai chuỗi cùng kiểu nằm chung một dòng thì hoán vị
 * chúng vẫn cho ra một dòng đọc hợp lý, và phép kiểm sẽ vẫn xanh.
 *
 * Nạp popup.html + popup.js THẬT vào jsdom; `chrome` là stub, phần còn lại nguyên bản.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));
const eq = (got, want, m) => ok(got === want, `${m} — mong ${JSON.stringify(want)}, nhận ${JSON.stringify(got)}`);

/**
 * @param {object[]} queue
 * @param {{running?: boolean, activeUrl?: string, ytTabs?: number}} opts
 */
function renderPopup(queue, opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'chrome-extension://test/popup.html' });
  const win = dom.window;

  const sent = [];
  win.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg.type);
        return msg.type === 'get-state'
          ? { queue, settings: { notebookUrl: '' }, running: !!opts.running }
          : {};
      },
      onMessage: { addListener() {} },
      openOptionsPage() {},
    },
    tabs: {
      // Hai truy vấn khác nhau phải trả lời khác nhau, đúng như Chrome thật:
      // "tab đang xem" và "mọi tab YouTube" không phải một.
      query: async (q) => {
        if (q && q.url) return Array.from({ length: opts.ytTabs || 0 }, () => ({ url: 'https://www.youtube.com/watch?v=x' }));
        return opts.activeUrl ? [{ url: opts.activeUrl, title: 'tab' }] : [];
      },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };

  win.eval(fs.readFileSync(path.join(ROOT, 'src/common/shared.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'src/popup/popup.js'), 'utf8'));
  win.__sent = sent;
  return win;
}

const settle = () => new Promise((r) => setTimeout(r, 40));
const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));

const V = (id, over) => Object.assign({ id, videoId: id.padEnd(11, 'x'), title: `video ${id}` }, over);

(async () => {
  /* ---------------------------------------------------------------- */
  /* 1. Thẻ trạng thái: mỗi kết quả một thẻ riêng, không lẫn metadata   */
  /* ---------------------------------------------------------------- */
  {
    const win = renderPopup([
      V('a', { status: 'done', verified: true, site: 'youtube.com', textLength: 5000 }),
      V('b', { status: 'done', verified: false, unverified: 'không đọc được danh sách' }),
      V('c', { status: 'error', error: 'hỏng' }),
      V('d', { status: 'pending' }),
      V('e', { status: 'importing' }),
    ]);
    await settle();

    const byTitle = (t) =>
      [...win.document.querySelectorAll('#list .item')].find((li) =>
        li.querySelector('.item__title').textContent === t
      );
    const pill = (t) => {
      const li = byTitle(t);
      const p = li && li.querySelector('.item__status');
      return p ? p.textContent : null;
    };

    eq(pill('video a'), 'Xong', 'Nguồn đã đối chiếu được mang thẻ "Xong"');
    eq(pill('video b'), 'Chưa xác minh', 'Nguồn chưa đối chiếu được mang thẻ riêng, không phải "Xong"');
    eq(pill('video c'), 'Lỗi', 'mục hỏng mang thẻ "Lỗi"');
    eq(pill('video d'), 'Chờ', 'mục chưa chạy mang thẻ "Chờ"');
    eq(pill('video e'), 'Đang thêm', 'mục đang import mang thẻ "Đang thêm"');

    // Thẻ phải nằm ngoài metadata: nếu trạng thái lại bị nối vào chuỗi
    // "site · thời lượng · nguồn" như trước thì phép kiểm này đỏ.
    const metaA = byTitle('video a').querySelector('.item__meta');
    ok(metaA && !/Xong/.test(metaA.textContent), `trạng thái không được nằm trong .item__meta, nhận: ${JSON.stringify(metaA && metaA.textContent)}`);
    ok(metaA && /youtube\.com/.test(metaA.textContent), 'metadata vẫn giữ site');

    // Màu thẻ đi kèm ý nghĩa, không phải trang trí: "chưa xác minh" không được
    // dùng chung lớp với "xong".
    const clsOf = (t) => byTitle(t).querySelector('.item__status').className;
    ok(/pill--done/.test(clsOf('video a')), 'thẻ Xong dùng lớp pill--done');
    ok(/pill--warn/.test(clsOf('video b')), 'thẻ Chưa xác minh dùng lớp pill--warn');
    ok(/pill--error/.test(clsOf('video c')), 'thẻ Lỗi dùng lớp pill--error');
    ok(clsOf('video a') !== clsOf('video b'), 'hai kết quả khác nhau không được dùng chung lớp thẻ');
  }

  /* ---------------------------------------------------------------- */
  /* 2. Chip đếm kiêm bộ lọc                                            */
  /* ---------------------------------------------------------------- */
  {
    const win = renderPopup([
      V('a', { status: 'done', verified: true }),
      V('b', { status: 'done', verified: true }),
      V('c', { status: 'error', error: 'x' }),
      V('d', { status: 'pending' }),
    ]);
    await settle();

    const chip = (key) => win.document.querySelector(`#counts .chip[data-filter="${key}"]`);
    // Ghim theo slot: con số của "xong" phải nằm trong chip "xong", không phải
    // "có số 2 đâu đó trên thanh".
    eq(chip('all').querySelector('.chip__n').textContent, '4', 'chip Tất cả đếm cả hàng đợi');
    eq(chip('done').querySelector('.chip__n').textContent, '2', 'chip xong đếm đúng 2');
    eq(chip('error').querySelector('.chip__n').textContent, '1', 'chip lỗi đếm đúng 1');
    eq(chip('pending').querySelector('.chip__n').textContent, '1', 'chip chờ đếm đúng 1');

    click(win, chip('error'));
    await settle();
    const shown = [...win.document.querySelectorAll('#list .item')];
    eq(shown.length, 1, 'lọc "lỗi" chỉ còn mục lỗi');
    eq(shown[0].querySelector('.item__title').textContent, 'video c', 'và đúng là mục lỗi đó');
    eq(chip('error').getAttribute('aria-pressed'), 'true', 'chip đang lọc phải nói ra qua aria-pressed');

    click(win, chip('error'));
    await settle();
    eq(win.document.querySelectorAll('#list .item').length, 4, 'bấm lại chip đang chọn thì bỏ lọc');
  }

  /* ---------------------------------------------------------------- */
  /* 3. Tiến độ tổng chỉ hiện khi đang chạy                             */
  /* ---------------------------------------------------------------- */
  {
    const queue = [
      V('a', { status: 'done', verified: true }),
      V('b', { status: 'error', error: 'x' }),
      V('c', { status: 'pending' }),
      V('d', { status: 'pending' }),
    ];

    const dung = renderPopup(queue, { running: false });
    await settle();
    eq(dung.document.getElementById('progress').hidden, true, 'không chạy thì không có thanh tiến độ');

    const chay = renderPopup(queue, { running: true });
    await settle();
    eq(chay.document.getElementById('progress').hidden, false, 'đang chạy thì hiện thanh tiến độ');
    eq(chay.document.getElementById('progress-text').textContent, '2/4', 'đếm mục đã ngã ngũ trên tổng số');
    eq(chay.document.getElementById('progress-bar').style.width, '50%', 'bề rộng thanh khớp tỉ lệ');
  }

  /* ---------------------------------------------------------------- */
  /* 4. Thao tác xoá nằm sau một cú bấm mở menu                         */
  /* ---------------------------------------------------------------- */
  {
    const win = renderPopup([V('a', { status: 'done', verified: true })]);
    await settle();

    const menu = win.document.getElementById('queue-menu');
    const btn = win.document.getElementById('queue-menu-btn');
    const clearAll = win.document.getElementById('clear-all');

    // Hình dạng: nút xoá KHÔNG còn là anh em của nút Chạy.
    const actions = win.document.querySelector('.queue__actions');
    ok(actions.contains(win.document.getElementById('run')), 'nút Chạy vẫn ở thanh công cụ');
    ok(menu.contains(clearAll), 'Xoá hết nằm trong menu');
    ok(menu.contains(win.document.getElementById('clear-done')), 'Xoá mục đã xong nằm trong menu');
    ok(menu.contains(win.document.getElementById('retry')), 'Thử lại lỗi nằm trong menu');

    eq(menu.hidden, true, 'menu đóng khi mới mở popup');
    eq(btn.getAttribute('aria-expanded'), 'false', 'aria-expanded nói ra trạng thái đóng');
    click(win, btn);
    eq(menu.hidden, false, 'bấm ⋯ mở menu');
    eq(btn.getAttribute('aria-expanded'), 'true', 'aria-expanded nói ra trạng thái mở');

    // Hai bước xác nhận: assert HÀNH ĐỘNG (lệnh nào được gửi), không assert chữ.
    win.__sent.length = 0;
    click(win, clearAll);
    await settle();
    ok(!win.__sent.includes('clear-all'), `cú bấm đầu KHÔNG được xoá, đã gửi: ${JSON.stringify(win.__sent)}`);

    click(win, clearAll);
    await settle();
    ok(win.__sent.includes('clear-all'), `cú bấm thứ hai mới xoá, đã gửi: ${JSON.stringify(win.__sent)}`);
  }

  /* ---------------------------------------------------------------- */
  /* 5. Nhãn nút đếm theo số link ĐỌC ĐƯỢC, không phải số dòng          */
  /* ---------------------------------------------------------------- */
  {
    const win = renderPopup([]);
    await settle();
    const bulk = win.document.getElementById('bulk');
    const add = win.document.getElementById('add-bulk');

    eq(add.disabled, true, 'chưa dán gì thì không bấm Thêm được');

    bulk.value = 'https://www.youtube.com/watch?v=aaaaaaaaaaa\nhttps://youtu.be/bbbbbbbbbbb';
    bulk.dispatchEvent(new win.Event('input', { bubbles: true }));
    eq(add.textContent, 'Thêm 2 link vào hàng đợi', 'nhãn nói đúng số link');
    eq(add.disabled, false, 'có link thì bấm được');

    // Dòng rác không được tính vào con số — đây là chỗ "số dòng" và "số link" tách nhau.
    bulk.value = 'https://www.youtube.com/watch?v=aaaaaaaaaaa\nkhông phải link\nvẫn không phải link';
    bulk.dispatchEvent(new win.Event('input', { bubbles: true }));
    eq(add.textContent, 'Thêm 1 link vào hàng đợi', 'ba dòng nhưng chỉ một link');
    ok(/bỏ qua 2 dòng/.test(win.document.getElementById('bulk-hint').textContent),
      `hint phải nói ra số dòng bị bỏ, nhận: ${JSON.stringify(win.document.getElementById('bulk-hint').textContent)}`);

    // Trần quét là con số nằm trong Cài đặt; chỗ dán link phải nói ra nó.
    ok(/500/.test(win.document.getElementById('bulk-hint').textContent),
      'hint phải nhắc trần quét hàng loạt đang đặt ở đâu');
  }

  /* ---------------------------------------------------------------- */
  /* 6. Ngữ cảnh tab: trả lời TRƯỚC khi bấm                             */
  /* ---------------------------------------------------------------- */
  {
    const thuong = renderPopup([], { activeUrl: 'https://example.com/doc', ytTabs: 0 });
    await settle();
    eq(thuong.document.getElementById('import-playlist').disabled, true,
      'trang thường: không quét được playlist');
    eq(thuong.document.getElementById('collect-tabs').disabled, true,
      'không có tab YouTube nào thì nút gom tab tắt');
    eq(thuong.document.getElementById('collect-links').disabled, false,
      'trang web đọc được thì vẫn quét link được');
    ok(thuong.document.getElementById('import-playlist').title.length > 0,
      'nút bị tắt phải nói lý do qua title');

    const playlist = renderPopup([], {
      activeUrl: 'https://www.youtube.com/playlist?list=PL123',
      ytTabs: 3,
    });
    await settle();
    eq(playlist.document.getElementById('import-playlist').disabled, false,
      'đang ở playlist thì quét được');
    eq(playlist.document.getElementById('collect-tabs').disabled, false,
      'có tab YouTube thì gom được');
    ok(/\(3\)/.test(playlist.document.getElementById('collect-tabs').textContent),
      `nhãn nói ra số tab đếm được, nhận: ${JSON.stringify(playlist.document.getElementById('collect-tabs').textContent)}`);

    const trong = renderPopup([], { activeUrl: 'chrome://extensions', ytTabs: 0 });
    await settle();
    eq(trong.document.getElementById('collect-links').disabled, true,
      'trang chrome:// không quét link được');
  }

  /* ---------------------------------------------------------------- */
  /* 7. Trần dựng DOM phải NÓI RA, không cắt im lặng                    */
  /* ---------------------------------------------------------------- */
  {
    const nhieu = Array.from({ length: 250 }, (_, i) => V(`v${i}`, { status: 'pending' }));
    const win = renderPopup(nhieu);
    await settle();

    eq(win.document.querySelectorAll('#list .item').length, 200, 'chỉ dựng 200 dòng');
    const more = win.document.getElementById('list-more');
    eq(more.hidden, false, 'phần dôi ra phải có dòng thông báo');
    ok(/50/.test(more.textContent), `dòng đó phải nói đúng còn bao nhiêu, nhận: ${JSON.stringify(more.textContent)}`);
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
