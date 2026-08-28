/*
 * Bề mặt (d) — bảng chọn link trên trang tài liệu.
 *
 * Cùng lý do tồn tại như `youtube-bundle.test.js`: tới trước ticket 006,
 * `src/docs/content.js` không có test nào. Đo 2026-08-28 — `rg -n "src/docs/"
 * test/` chỉ ra hit ở `manifest.test.js`, và ở đó `'src/docs/content.js'` là một
 * phần tử CHUỖI trong mảng đem so với `manifest.content_scripts`; không file nào
 * nạp file này. `docs.test.js` chỉ nạp `shared.js` để test `docKey`.
 *
 * Chứng nhận: cây sidebar phẳng hoá ra bao nhiêu dòng, tick lan truyền cha→con
 * thế nào, và cú bấm Thêm gửi đúng những URL nào lên background.
 * KHÔNG chứng nhận: `sidebar.js` có dò đúng sidebar thật hay không — nó bị thay
 * bằng stub, vì bản thật chấm điểm bằng `getBoundingClientRect` mà jsdom không
 * có layout. `tools/verify-docs.mjs` là chỗ trả lời câu đó.
 */
const { loadDocsPage, docNode } = require('./dom-harness.js');

let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

/** Cây thử: một nhóm không có URL, hai trang con, một trang lẻ. */
const tree = () => [
  docNode('Bắt đầu', null, [
    docNode('Cài đặt', 'https://docs.example.dev/guide/install', [], 1),
    docNode('Cấu hình', 'https://docs.example.dev/guide/config', [], 1),
  ]),
  docNode('API', 'https://docs.example.dev/api'),
];

const check = (h, i) => {
  const box = h.panelAll('.row input')[i];
  box.checked = true;
  box.dispatchEvent(new h.win.Event('change'));
  return box;
};

async function run() {
  /* ---------------------------------------------------------------- */
  /* nút mở bảng                                                       */
  /* ---------------------------------------------------------------- */

  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    ok(!!h.launcher(), '(d) dò thấy sidebar thì phải hiện nút mở bảng');
    ok(/3 trang/.test(h.launcher().textContent),
      `(d) nút phải đếm số trang CÓ URL, không đếm nhóm — nhận: "${h.launcher().textContent}"`);
    h.close();
  }

  /* Sidebar dưới 3 link thì không mở bảng: một mục lục hai dòng không đáng một bảng chọn. */
  {
    const h = loadDocsPage({ tree: [docNode('A', 'https://docs.example.dev/a')] });
    await h.tick(80);
    ok(!h.launcher(), '(d) sidebar dưới 3 trang thì không hiện nút');
    h.close();
  }

  {
    const h = loadDocsPage({ tree: tree(), settings: { docsLauncher: false } });
    await h.tick(80);
    ok(!h.launcher(), '(d) tắt docsLauncher thì không hiện nút');
    h.close();
  }

  /* ---------------------------------------------------------------- */
  /* bảng chọn: phẳng hoá, tick lan truyền                             */
  /* ---------------------------------------------------------------- */

  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);

    ok(h.visible(), '(d) bấm nút phải mở bảng');
    eq(h.panelAll('.row').length, 4, '(d) cây phải phẳng hoá thành 4 dòng — 3 trang + 1 nhóm');
    eq(h.panelAll('.row--group').length, 1, '(d) nhóm không có URL phải được đánh dấu riêng');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 0 trang', '(d) chưa tick thì nút Thêm đếm 0');
    ok(h.panel('[data-act="import"]').disabled, '(d) chưa tick thì nút Thêm phải khoá');

    /* Nhóm chỉ hiện số trang con — người dùng phải biết tick nó là tick mấy cái. */
    ok(/2 trang/.test(h.panelAll('.row')[0].textContent),
      `(d) dòng nhóm phải hiện số trang con — nhận: "${h.panelAll('.row')[0].textContent}"`);

    /* Tick nhóm phải lan xuống mọi con. */
    check(h, 0);
    eq(h.panelAll('.row input').filter((b) => b.checked).length, 3,
      '(d) tick nhóm phải tick luôn cả hai trang con');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 2 trang',
      '(d) nút Thêm chỉ đếm dòng CÓ URL, nhóm không được tính là một trang');
    h.close();
  }

  /* Tick một con: nhóm phải về trạng thái lửng, không phải đã tick. */
  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);

    check(h, 1);
    const group = h.panelAll('.row input')[0];
    ok(group.indeterminate, '(d) tick một trong hai con thì nhóm phải ở trạng thái lửng');
    ok(!group.checked, '(d) nhóm chưa đủ con thì không được hiện là đã tick');

    check(h, 2);
    ok(group.checked && !group.indeterminate, '(d) tick đủ mọi con thì nhóm thành đã tick');
    h.close();
  }

  /* Chọn hết / Bỏ chọn / Đảo. */
  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);

    h.click('[data-act="all"]');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 3 trang', '(d) "Chọn hết" phải tick mọi trang');

    h.click('[data-act="none"]');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 0 trang', '(d) "Bỏ chọn" phải gỡ hết');

    check(h, 3);            // chỉ trang API
    h.click('[data-act="invert"]');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 2 trang',
      '(d) "Đảo" chỉ đảo dòng có URL, không đụng nhóm');
    h.close();
  }

  /* ---------------------------------------------------------------- */
  /* bấm Thêm — dữ liệu gửi lên background                             */
  /* ---------------------------------------------------------------- */

  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    h.reply(() => ({ added: 2, skipped: 0 }));

    h.click('[data-act="all"]');
    h.click('[data-act="import"]');
    await h.tick(80);

    eq(h.sent.length, 1, '(d) một cú bấm gửi đúng một tin');
    eq(h.sent[0].type, 'enqueue', '(d) tin phải là enqueue');
    eq(h.sent[0].autoRun, true, '(d) "Chạy ngay" bật mặc định thì phải gửi autoRun');
    eq(h.sent[0].items.map((i) => [i.kind, i.url]), [
      ['docs', 'https://docs.example.dev/guide/install'],
      ['docs', 'https://docs.example.dev/guide/config'],
      ['docs', 'https://docs.example.dev/api'],
    ], '(d) chỉ dòng có URL mới thành Mục, và URL đi nguyên như bảng đang hiện');
    ok(h.sent[0].items.every((i) => i.section !== undefined), '(d) Mục phải mang tên mục cha để popup hiện được ngữ cảnh');
    ok(!h.visible(), '(d) xếp hàng xong thì đóng bảng');
    h.close();
  }

  /* Bỏ tick "Chạy ngay" thì không được tự chạy — đó là công tắc của người dùng. */
  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    h.reply(() => ({ added: 1, skipped: 0 }));

    const runNow = h.panel('.panel__runnow');
    runNow.checked = false;
    check(h, 3);
    h.click('[data-act="import"]');
    await h.tick(80);

    eq(h.sent[0].autoRun, false, '(d) bỏ tick "Chạy ngay" thì autoRun phải là false');
    h.close();
  }

  /* Background báo lỗi: bảng phải ở nguyên đó với lựa chọn còn nguyên, không đóng mất. */
  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    h.reply(() => ({ error: 'hàng đợi hỏng' }));

    h.click('[data-act="all"]');
    h.click('[data-act="import"]');
    await h.tick(80);

    ok(h.visible(), '(d) lỗi thì KHÔNG đóng bảng — đóng là mất trắng lựa chọn của người dùng');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 3 trang', '(d) lỗi rồi nút Thêm phải bấm lại được');
    ok(!h.panel('[data-act="import"]').disabled, '(d) lỗi rồi nút Thêm không được kẹt ở trạng thái khoá');
    h.close();
  }

  /* Không dò thấy sidebar: nói ra, đừng mở một bảng rỗng. */
  {
    const h = loadDocsPage({ tree: null });
    await h.tick(80);
    ok(!h.launcher(), '(d) không có sidebar thì không hiện nút');
    eq(await h.dispatch({ type: 'docs-panel' }), { ok: true, hasSidebar: false, count: 0 },
      '(d) popup gọi mở bảng mà không có sidebar thì phải trả lời hasSidebar:false');
    h.close();
  }

  /* ---------------------------------------------------------------- */
  /* router — ba content script gặp nhau trên một tab                  */
  /* ---------------------------------------------------------------- */

  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);

    const ping = await h.dispatch({ type: 'docs-ping' });
    eq([ping.ok, ping.hasSidebar, ping.count], [true, true, 3], '(d) docs-ping phải báo có sidebar và đếm đúng');

    let answered = false;
    const result = await new Promise((resolve) => {
      h.dispatch({ type: 'nlm-ping' }).then(() => (answered = true));
      setTimeout(() => resolve(answered), 30);
    });
    ok(result === false, '(d) router KHÔNG được trả lời tin của content script khác (nlm-ping)');
    h.close();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
