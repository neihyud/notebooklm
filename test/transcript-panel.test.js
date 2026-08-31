/*
 * Panel transcript trên trang watch — `src/youtube/panel.js`.
 *
 * File này trước đây KHÔNG có test nào chạm tới, và chỗ hở lộ ra đúng ở luật đã
 * ghi cho Đường trao tay: **bó rỗng không được chạm clipboard**. `writeText('')`
 * xoá trắng thứ người dùng đang giữ, và họ mất nó để đổi lấy một dòng "đã sao
 * chép". Luật đó áp cho mọi đường tới `writeText`, không riêng đường Bó link.
 *
 * Harness ở đây cố ý nhỏ: nạp `shared.js` + `srt.js` + `panel.js` thật vào
 * jsdom, `NBLM_TRANSCRIPT` là stub vì nó nói chuyện với YouTube thật. Nó chứng
 * nhận *luồng điều khiển* — cú bấm nào đưa gì tới clipboard — chứ KHÔNG chứng
 * nhận selector của YouTube; `tools/verify-live.mjs` mới là chỗ đó.
 */
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log(`❌ ${m}`)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

/**
 * @param {Array} segments transcript mà `T.extract` trả về cho lượt mở panel.
 */
function loadPanel({ segments = [] } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  });
  const win = dom.window;

  const writes = [];
  win.navigator.clipboard = { writeText: async (t) => { writes.push(t); } };

  // `panel.js` destructure `root.NBLM` ngay dòng đầu — phải có mặt TRƯỚC khi nạp.
  const run = (rel) => win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  run('src/common/shared.js');
  run('src/youtube/srt.js');

  win.NBLM_TRANSCRIPT = {
    extract: async () => ({ segments, meta: { title: 'Video thử' }, method: 'stub' }),
    currentVideoId: () => 'aaaaaaaaaaa',
  };
  run('src/youtube/panel.js');

  return {
    win,
    writes,
    P: win.NBLM_PANEL,
    $: (sel) => win.document.querySelector(sel),
    click(sel) {
      const el = win.document.querySelector(sel);
      if (!el) throw new Error(`không tìm thấy phần tử để bấm: ${sel}`);
      el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      return el;
    },
    status: () => {
      const el = win.document.querySelector('.nblm-panel__status');
      return el && !el.hidden ? el.textContent : '';
    },
    tick: (ms = 30) => new Promise((r) => setTimeout(r, ms)),
    close: () => win.close(),
  };
}

(async () => {
  /* Ca thường: có transcript thì copy đúng nội dung của nó. */
  {
    const h = loadPanel({ segments: [{ start: 0, text: 'xin chào' }, { start: 5, text: 'tạm biệt' }] });
    await h.P.open('aaaaaaaaaaa');
    await h.tick();
    h.click('[data-act="copy"]');
    await h.tick();

    eq(h.writes, ['[0:00] xin chào\n[0:05] tạm biệt'],
      'ca dựng sai thì mọi assertion sau vô nghĩa — đường copy bình thường phải chạy được');
    h.close();
  }

  /*
   * Transcript toàn dòng RỖNG: `toTxt` lọc bỏ mọi đoạn không có chữ và trả về
   * chuỗi rỗng. Đây không phải ca biên dựng ra cho vui — YouTube trả về dòng
   * trống cho đoạn chỉ có nhạc, và `onClick` cho qua vì `current` vẫn truthy và
   * `segments.length` vẫn dương.
   *
   * Assertion phải là `writes`, KHÔNG phải câu status: hoán vị "bỏ hẳn phép
   * chặn" vẫn cho status "Đã sao chép", nên assert câu chữ sẽ xanh cả hai chiều.
   *
   * Fixture dùng chuỗi RỖNG hẳn, không phải khoảng trắng: `toTxt` lọc theo
   * `s.text` truthy nên `'   '` lọt qua và ra `'[0:05] '` — một chuỗi trông rỗng
   * mà `writeText` vẫn nhận. Đó là một lỗi KHÁC, ở `srt.js`, và ca này không
   * nhận vơ nó.
   */
  {
    const h = loadPanel({ segments: [{ start: 0, text: '' }, { start: 5, text: '' }] });
    await h.P.open('aaaaaaaaaaa');
    await h.tick();
    h.click('[data-act="copy"]');
    await h.tick();

    eq(h.writes, [],
      'transcript rỗng KHÔNG được chạm clipboard — writeText("") xoá trắng thứ người dùng đang giữ');
    ok(/Chưa có gì để sao chép/.test(h.status()),
      `và phải nói ra vì sao, chứ không im lặng — nhận: "${h.status()}"`);
    h.close();
  }

  /* Không có transcript nào: cùng một luật, và đây là đường tới đó ngắn nhất. */
  {
    const h = loadPanel({ segments: [] });
    await h.P.open('aaaaaaaaaaa');
    await h.tick();
    h.click('[data-act="copy"]');
    await h.tick();

    eq(h.writes, [], 'không có đoạn nào thì cũng không chạm clipboard');
    h.close();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
