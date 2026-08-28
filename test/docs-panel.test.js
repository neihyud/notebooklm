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
const fs = require('node:fs');
const path = require('node:path');
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
  /* cửa đo — NotebookLM có đọc nổi trang này không                    */
  /* ---------------------------------------------------------------- */

  /*
   * Ba fixture, và cần đúng BA chứ không phải hai: hai trang là đủ để một hoán
   * vị "gate chỉ xét `how`" xanh cả hai chiều. Số đo dưới đây là của `extract.js`
   * THẬT chạy trên HTML thật trong jsdom, không phải giá trị tôi gõ ra:
   *
   *   docs-ssr.html        how = '.theme-doc-markdown'  chars = 1427  -> BẬT
   *   docs-spa-shell.html  how = 'fallback'             chars = 0     -> TẮT
   *   docs-ssr-tiny.html   how = 'fallback'             chars = 121   -> BẬT
   *
   *   docs-junk-body.html  how = '.theme-doc-markdown'  chars = 11    -> BẬT
   *
   * Ca thứ ba tách vế `chars` ra khỏi vế `how`: trang server-render thật, có chữ
   * thật, mà vẫn rơi `fallback`. Nó dựng theo hình dạng `example.com`, thứ đo
   * được 113 ký tự với `score` DƯƠNG (+110) và rơi `fallback` chỉ vì 110 < floor
   * 200. Một "trang SSR ngắn" bất kỳ KHÔNG thay được: trang docs SSR ngắn nhất
   * đo được (173 ký tự) có `how = '.bd-article'`, nên nó bật bất kể ngưỡng.
   *
   * Ca thứ tư tách chiều NGƯỢC LẠI, và nó được thêm vào sau khi đo cho thấy ba
   * fixture đầu để hở: hoán vị "gate chỉ xét `chars`" xanh cả hai chiều với
   * chúng. Nó là hiện thân của câu ticket cảnh báo — `chars` là độ dài Markdown
   * SAU khi dọn `JUNK_SELECTORS`, nên `chars` thấp gộp hai nguyên nhân khác hẳn
   * nhau: trang này có 400+ ký tự chữ THẬT trong HTML thô (Google cào cả trang
   * sẽ lấy được), chỉ là chúng nằm trong một khối `.sidebar` mà `pickRoot` dọn đi.
   */
  const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  const PAGES = {
    'https://a.dev/docs/ssr': fixture('docs-ssr.html'),
    'https://a.dev/docs/spa': fixture('docs-spa-shell.html'),
    'https://a.dev/docs/tiny': fixture('docs-ssr-tiny.html'),
    'https://a.dev/docs/junk': fixture('docs-junk-body.html'),
  };
  const threeUrls = Object.keys(PAGES);
  const threeTree = () => threeUrls.map((u, i) => docNode(`Trang ${i}`, u));

  /** Background giả: trả HTML thô như `fetchRawHtml` trả, và ghi lại đã hỏi gì. */
  const withPages = (h, { fail = [], onFetch = null } = {}) => {
    h.reply((m) => {
      if (m.type === 'docs-raw-fetch') {
        if (onFetch) onFetch(m.url);
        if (fail.includes(m.url)) return { url: m.url, error: 'HTTP 503' };
        return { url: m.url, finalUrl: m.url, type: 'text/html', html: PAGES[m.url] || '' };
      }
      if (m.type === 'bundle-filter') return { keep: m.urls, dropped: [], counts: { copied: 0, queued: 0 } };
      if (m.type === 'bundle-copied') return { added: (m.urls || []).length };
      return {};
    });
  };

  {
    const h = loadDocsPage({ tree: threeTree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);

    ok(!!h.panel('[data-act="copy"]'), '(d) bảng chọn phải có nút Copy link');
    ok(h.panel('[data-act="copy"]').disabled, '(d) chưa tick thì nút Copy khoá');

    const asked = [];
    withPages(h, { onFetch: (u) => asked.push(u) });
    h.click('[data-act="all"]');

    ok(!h.panel('[data-act="copy"]').disabled,
      '(d) nút Copy LUÔN bật khi có dòng tick — cửa đo chạy sau cú bấm, không trước');
    eq(asked, [], '(d) mở bảng và tick KHÔNG được tốn một lượt fetch nào');

    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(asked.sort(), threeUrls.slice().sort(), '(d) bấm copy mới đo, và đo đúng những trang đã tick');
    eq(h.clipboard.writes, ['https://a.dev/docs/ssr\nhttps://a.dev/docs/tiny\nhttps://a.dev/docs/junk'],
      '(d) ba trang có chữ trong HTML thô đều vào Bó; chỉ trang dựng bằng JavaScript bị loại');
    h.close();
  }

  /* Trang bị loại phải được NÊU RA, kèm đường đi thay thế. */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    withPages(h);
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    const note = h.flash();
    ok(/Đã copy 3 link/.test(note), `(d) phải nói đã copy mấy link — nhận: "${note}"`);
    ok(/1 trang không có thân bài/.test(note),
      `(d) phải nêu số trang bị loại, kèm đường đi thay thế — nhận: "${note}"`);
    ok(/menu điều hướng/.test(note),
      '(d) phải nói ra sự đánh đổi: cửa đo trả lời "Nguồn có RỖNG không", không trả lời "Nguồn có SẠCH không"');
    h.close();
  }

  /*
   * Bó rỗng: KHÔNG chạm clipboard. Cùng luật với bề mặt YouTube — `writeText('')`
   * xoá trắng thứ người dùng đang giữ.
   */
  {
    const h = loadDocsPage({ tree: [docNode('SPA', 'https://a.dev/docs/spa'), docNode('SPA 2', 'https://a.dev/docs/spa2'), docNode('SPA 3', 'https://a.dev/docs/spa3')] });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    h.reply((m) =>
      m.type === 'docs-raw-fetch'
        ? { url: m.url, finalUrl: m.url, type: 'text/html', html: PAGES['https://a.dev/docs/spa'] }
        : {}
    );
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes, [], 'Bó rỗng thì KHÔNG gọi writeText');
    eq(h.sent.filter((m) => m.type === 'bundle-copied'), [], 'Bó rỗng thì không ghi Sổ');
    h.close();
  }

  /* Không tải được thì KHÔNG đoán — fail-closed, trang rơi về đường Dán text. */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    withPages(h, { fail: ['https://a.dev/docs/ssr'] });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes, ['https://a.dev/docs/tiny\nhttps://a.dev/docs/junk'],
      'trang fetch hỏng KHÔNG được vào Bó — cửa đo nói dối theo chiều BẬT là tệ hơn không có cửa đo');
    h.close();
  }

  /* Ghi Sổ đúng thứ tự: writeText trước, bundle-copied sau. */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    withPages(h);
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    const copied = h.sent.filter((m) => m.type === 'bundle-copied');
    eq(copied.length, 1, 'phải báo ngược lên để ghi Sổ');
    eq(copied[0].urls, ['https://a.dev/docs/ssr', 'https://a.dev/docs/tiny', 'https://a.dev/docs/junk'],
      'Sổ ghi ĐÚNG những link đã tới clipboard, không phải toàn bộ danh sách đã tick');
    ok(h.sent.findIndex((m) => m.type === 'bundle-filter') < h.sent.findIndex((m) => m.type === 'bundle-copied'),
      'cửa 2 phải chạy trước khi ghi Sổ');
    h.close();
  }

  /* URL đem copy là URL bảng đang hiện, KHÔNG phải docKey. */
  {
    const url = 'https://a.dev/docs/tiếng-việt/';
    const h = loadDocsPage({ tree: [docNode('A', url), docNode('B', 'https://a.dev/docs/b'), docNode('C', 'https://a.dev/docs/c')] });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    h.reply((m) => {
      if (m.type === 'docs-raw-fetch') return { url: m.url, finalUrl: m.url, type: 'text/html', html: PAGES['https://a.dev/docs/ssr'] };
      if (m.type === 'bundle-filter') return { keep: m.urls, dropped: [], counts: {} };
      return { added: 0 };
    });
    const box = h.panelAll('.row input')[0];
    box.checked = true;
    box.dispatchEvent(new h.win.Event('change'));
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes, [url],
      'clipboard nhận URL người dùng nhìn thấy — docKey percent-encode chữ có dấu và cắt / cuối, nó là khoá so trùng chứ không phải bản để dán');
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
