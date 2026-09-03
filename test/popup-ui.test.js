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
  const ghi = [];
  win.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg.type);
        if (msg.type === 'get-state') {
          return { queue, settings: { notebookUrl: opts.notebookUrl || '' }, running: !!opts.running, copied: opts.copied };
        }
        if (msg.type === 'list-accounts') return opts.accounts || { ok: false, accounts: [], selected: null };
        if (msg.type === 'list-notebooks') return opts.notebooks || { ok: false, needsTab: true, notebooks: [] };
        return {};
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
    storage: { local: { get: async () => ({}), set: async (o) => { ghi.push(o); } } },
  };
  win.__ghi = ghi;

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

  /* ---------------------------------------------------------------- */
  /* Sổ đã copy: khu gập trong tab Hàng đợi                             */
  /* ---------------------------------------------------------------- */

  /* Chưa copy gì: khu này không có gì để nói, và "Xoá sổ" không có gì để xoá. */
  {
    const win = renderPopup([]);
    await settle();
    ok(win.document.getElementById('copied').hidden, 'Sổ rỗng thì khu Sổ phải ẩn hẳn');
  }

  /*
   * Sổ nằm trong tab Hàng đợi, KHÔNG ở Cài đặt và không ở tab "+ Thêm nguồn":
   * câu hỏi nó trả lời — "cái này copy rồi chưa" — luôn xuất hiện ngay cạnh
   * hàng đợi.
   */
  {
    const win = renderPopup([], {
      copied: {
        total: 2,
        rows: [
          { url: 'https://a.dev/docs/x', at: 1735689600000, from: 'a.dev' },
          { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', at: 1735689000000, from: 'playlist X' },
        ],
      },
    });
    await settle();
    const box = win.document.getElementById('copied');
    ok(!box.hidden, 'có dòng thì khu Sổ phải hiện');
    ok(box.closest('#panel-queue') !== null, 'Sổ phải nằm trong tab Hàng đợi, không phải tab Thêm nguồn');
    eq(win.document.getElementById('copied-count').textContent, '2', 'phải hiện số dòng của Sổ');

    const rows = Array.from(win.document.querySelectorAll('#copied-list .copied__row'));
    eq(rows.length, 2, 'mỗi dòng Sổ một mục');
    /*
     * Ghim từng CHỖ, không đọc textContent cả dòng: URL và "gom từ đâu" nằm
     * chung một dòng, nên hoán vị hai chuỗi ấy vẫn cho ra một dòng đọc hợp lý.
     */
    eq(rows[0].querySelector('.copied__url').getAttribute('href'), 'https://a.dev/docs/x',
      'URL phải mở được — Sổ nói "đã copy cái này", câu hỏi kế tiếp luôn là "cái nào"');
    ok(/playlist X/.test(rows[1].querySelector('.copied__meta').textContent),
      'phải nói ra link được gom từ đâu');
    ok(win.document.getElementById('copied-more').hidden,
      'hiện đủ thì không được nói là còn dòng ẩn');
  }

  /*
   * Sổ lớn hơn lát cắt service worker gửi. Đây là hoán vị đắt nhất của khối
   * này: đếm bằng `rows.length` cho ra "50" trong khi Sổ đang lọc 120 link, và
   * con số ấy sai đúng vào lúc người dùng cần nó.
   */
  {
    const rows = Array.from({ length: 50 }, (_, i) => ({ url: `https://a.dev/p/${i}`, at: 1735689600000, from: 'a.dev' }));
    const win = renderPopup([], { copied: { total: 120, rows } });
    await settle();
    eq(win.document.getElementById('copied-count').textContent, '120',
      'con số phải là tổng THẬT của Sổ, không phải số dòng đang hiện');
    const more = win.document.getElementById('copied-more');
    ok(!more.hidden, 'danh sách bị cắt phải tự khai — bị cắt im lặng đọc y hệt đã hiện đủ');
    ok(/70/.test(more.textContent) && /120/.test(more.textContent),
      `phải nói rõ còn bao nhiêu dòng ẩn và Sổ vẫn lọc đủ bao nhiêu — nhận: "${more.textContent}"`);
  }

  /*
   * Xoá sổ dùng đúng nghi thức hai nhịp của "Xoá hết hàng đợi". Sổ giữ mãi theo
   * thiết kế, nên một cú bấm nhầm làm mọi link đã copy có thể vào notebook lần
   * thứ hai, và không có đường lấy lại.
   */
  {
    const win = renderPopup([], {
      copied: { total: 1, rows: [{ url: 'https://a.dev/docs/x', at: 1735689600000, from: 'a.dev' }] },
    });
    await settle();
    const btn = win.document.getElementById('clear-copied');
    win.__sent.length = 0;

    click(win, btn);
    await settle();
    ok(!win.__sent.includes('clear-copied'), 'cú bấm ĐẦU không được xoá gì — Sổ không hoàn tác được');
    ok(/Chắc chắn/.test(btn.textContent), `cú bấm đầu phải đổi thành lời hỏi lại — nhận: "${btn.textContent}"`);

    click(win, btn);
    await settle();
    ok(win.__sent.includes('clear-copied'), 'cú bấm THỨ HAI mới thật sự xoá Sổ');
    eq(btn.textContent, 'Xoá sổ', 'xoá xong nút phải trở lại nhãn thường');
  }

  /* ---------------------------------------------------------------- */
  /* Dropdown tài khoản — ticket 013                                    */
  /* ---------------------------------------------------------------- */
  {
    /*
     * Tài khoản đã chọn KHÔNG còn trong danh sách trả về.
     *
     * Khuyết tật đã đo (chụp bằng Brave thật, `tools/chup-popup.mjs`): gán
     * `sel.value` cho một giá trị không option nào mang thì `selectedIndex`
     * thành -1 và dropdown hiện ra TRẮNG TRƠN — trông như hỏng, trong khi sự
     * thật là "tài khoản kia đã đăng xuất". jsdom không thấy chỗ trắng, nhưng
     * NÓ THẤY `selectedIndex`, nên lưới đặt được ở đây.
     */
    const win = renderPopup([], {
      accounts: {
        ok: true,
        selected: 'da-dang-xuat@gmail.com',
        accounts: [
          { email: 'con@gmail.com', name: 'Con', index: 0, isDefault: true },
          { email: 'khac@gmail.com', name: 'Khac', index: 1, isDefault: false },
        ],
      },
      notebooks: { ok: true, needsTab: false, notebooks: [], account: { source: 'chosen-missing', authuser: null } },
    });
    await settle();
    click(win, win.document.getElementById('notebook-refresh'));
    await settle();

    const sel = win.document.getElementById('account-select');
    ok(sel.selectedIndex !== -1, 'tài khoản biến mất: dropdown KHÔNG được rỗng lựa chọn (-1 = hiện ra trắng trơn)');
    // `?.` chứ không phải truy cập thẳng: selectedIndex = -1 thì `options[-1]`
    // là undefined và cả FILE test chết, cho 0 dòng đỏ — mà 0 dòng đỏ vì sập
    // không phải là xanh. Phải đỏ tử tế thì phép đo mới đọc được.
    const dangChon = sel.options[sel.selectedIndex];
    ok(/không còn đăng nhập/.test(dangChon?.textContent || ''),
      'tài khoản biến mất: ô hiện NÓI RA lý do, không im lặng');
    ok(dangChon?.disabled === true,
      'tài khoản biến mất: mục đó khoá lại, không chọn lại được');
    ok([...sel.options].some((o) => o.value === 'con@gmail.com'),
      'tài khoản biến mất: các tài khoản còn sống vẫn chọn được');
  }

  {
    // Một tài khoản thì hàng chọn PHẢI ẩn — dropdown một dòng không cho quyết
    // định gì, chỉ chiếm chỗ trong popup 400px.
    const win = renderPopup([], {
      accounts: { ok: true, selected: null, accounts: [{ email: 'chu@gmail.com', name: 'C', index: 0, isDefault: true }] },
      notebooks: { ok: true, needsTab: false, notebooks: [], account: { source: 'tab', authuser: '0' } },
    });
    await settle();
    click(win, win.document.getElementById('notebook-refresh'));
    await settle();
    ok(win.document.getElementById('notebook-account-row').hidden === true, 'một tài khoản: hàng chọn ẩn');
  }

  {
    // Hai tài khoản thì hiện, và chọn đúng cái đang lưu.
    const win = renderPopup([], {
      accounts: {
        ok: true, selected: 'khac@gmail.com',
        accounts: [
          { email: 'chu@gmail.com', name: 'C', index: 0, isDefault: true },
          { email: 'khac@gmail.com', name: 'K', index: 1, isDefault: false },
        ],
      },
      notebooks: { ok: true, needsTab: false, notebooks: [], account: { source: 'chosen', authuser: '1' } },
    });
    await settle();
    click(win, win.document.getElementById('notebook-refresh'));
    await settle();
    const sel = win.document.getElementById('account-select');
    ok(win.document.getElementById('notebook-account-row').hidden === false, 'hai tài khoản: hàng chọn hiện');
    ok(sel.value === 'khac@gmail.com', 'hai tài khoản: chọn đúng cái đang lưu, không rơi về mặc định');
    ok(win.document.getElementById('account-note').hidden === true, 'đã chọn tài khoản thì KHÔNG hiện câu cảnh báo');
  }

  {
    // Mỗi dropdown phải có nhãn RIÊNG trỏ đúng vào nó. Không có nhãn thì email
    // đọc ra như thể nó là "notebook đích" — đo bằng ảnh chụp Brave thật.
    const win = renderPopup([]);
    await settle();
    const d = win.document;
    const nhan = (id) => [...d.querySelectorAll('label')].find((l) => l.getAttribute('for') === id);
    ok(!!nhan('account-select'), 'dropdown tài khoản có nhãn riêng');
    ok(!!nhan('notebook-select'), 'dropdown notebook có nhãn riêng');
    ok(nhan('account-select') !== nhan('notebook-select'), 'hai dropdown KHÔNG dùng chung một nhãn');
  }

  /* ---------------------------------------------------------------- */
  /* Dropdown notebook: thứ tự mục, mục chọn sẵn, và ghi xuống settings */
  /* ---------------------------------------------------------------- */

  /** Chạy một lượt ↻ rồi trả về dropdown notebook + sổ ghi settings. */
  async function napXong(opts) {
    const win = renderPopup([], opts);
    await settle();
    click(win, win.document.getElementById('notebook-refresh'));
    await settle();
    const sel = win.document.getElementById('notebook-select');
    // `__ghi` là mọi lượt chrome.storage.local.set; chỉ lấy phần notebookUrl.
    const urls = win.__ghi.filter((o) => o.settings).map((o) => o.settings.notebookUrl);
    return { win, sel, urls, nhan: [...sel.options].map((o) => o.textContent) };
  }

  const NB2 = { ok: true, needsTab: false, notebooks: [{ id: 'nb-mot', title: 'Ghi chép luận văn' }, { id: 'nb-hai', title: 'Đọc tuần này' }] };

  {
    // Chưa lưu notebook nào. Mục tạo mới đứng ĐẦU (Chốt 3 của ticket 011),
    // nhưng mục ĐANG HIỆN là notebook thật đầu tiên — để cú bấm kế tiếp không
    // tạo ra một sổ rỗng thừa. Ghim theo SLOT, vì hai mục này hoán vị cho nhau
    // vẫn ra một danh sách đọc hợp lý.
    const { sel, urls, nhan } = await napXong({ notebooks: NB2 });
    eq(sel.options.length, 3, 'ba mục: tạo mới + hai notebook');
    eq(nhan[0], '+ Tạo notebook mới', 'slot 0 là mục tạo mới');
    eq(sel.options[1].value, 'nb-mot', 'slot 1 là notebook thật đầu tiên');
    eq(sel.selectedIndex, 1, 'mục đang hiện là notebook thật, KHÔNG phải mục tạo mới');

    // Placeholder chết đã gỡ: nó từng chiếm đúng slot 0 mà Chốt 3 dành cho mục
    // tạo mới, và chọn nó không làm gì cả.
    ok(![...sel.options].some((o) => o.value === ''), 'không còn mục rỗng nào trong danh sách');

    // Dropdown tự chọn hộ thì PHẢI ghi xuống settings. Không ghi thì nhãn
    // "Gửi tới" hiện một notebook mà lượt import không hề đi tới.
    eq(urls.length, 1, 'lựa chọn tự động được ghi xuống settings đúng một lần');
    eq(urls[0], 'https://notebooklm.google.com/notebook/nb-mot', 'ghi đúng id của mục đang hiện');
  }

  {
    // Đã lưu một notebook CÒN trong danh sách: giữ nguyên nó, và không ghi lại
    // gì cả. Cặp này tách "trả về id đang chọn" khỏi "trả về id cần ghi".
    const { sel, urls } = await napXong({
      notebooks: NB2,
      notebookUrl: 'https://notebooklm.google.com/notebook/nb-hai',
    });
    eq(sel.value, 'nb-hai', 'notebook đang lưu thắng, không rơi về mục đầu danh sách');
    eq(urls.length, 0, 'đang khớp sẵn thì KHÔNG ghi đè settings');
  }

  {
    // Đã lưu một notebook KHÔNG còn trong danh sách (đổi tài khoản, hoặc đã
    // xoá). Rơi về notebook thật đầu tiên, và ghi lại — nếu chỉ rơi mà không
    // ghi thì settings vẫn trỏ vào cái đã mất.
    const { sel, urls } = await napXong({
      notebooks: NB2,
      notebookUrl: 'https://notebooklm.google.com/notebook/nb-da-mat',
    });
    eq(sel.selectedIndex, 1, 'notebook đã mất: rơi về notebook thật đầu tiên');
    eq(urls[0], 'https://notebooklm.google.com/notebook/nb-mot', 'và ghi đè cái đã mất trong settings');
  }

  {
    // Tài khoản không có notebook nào. Đây là ca DUY NHẤT mục tạo mới đứng hiện
    // — và vì chọn lại cái đang chọn không phát `change`, popup phải tự mở
    // khung tạo. Bảo owner "chọn + Tạo notebook mới" là một ngõ cụt.
    const { win, sel, urls, nhan } = await napXong({
      notebooks: { ok: true, needsTab: false, notebooks: [] },
    });
    eq(sel.options.length, 1, '0 notebook: chỉ còn mục tạo mới');
    eq(nhan[0], '+ Tạo notebook mới', 'và nó là mục tạo mới');
    eq(win.document.getElementById('notebook-create').hidden, false, '0 notebook: khung tạo tự mở, không đợi một cú change không bao giờ tới');
    eq(urls.length, 0, '0 notebook: không ghi gì xuống settings');
  }

  {
    // Không đọc được danh sách cũng dựng ra một danh sách rỗng, nhưng ở đó ta
    // KHÔNG biết tài khoản có notebook hay không — mở khung tạo là đoán mò.
    const { win } = await napXong({ notebooks: { ok: false, needsTab: false, notebooks: [] } });
    eq(win.document.getElementById('notebook-create').hidden, true, 'list hỏng: KHÔNG tự mở khung tạo');
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
