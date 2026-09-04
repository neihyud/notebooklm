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

/*
 * Một promise rejection không ai bắt trong handler `click` GIẾT cả tiến trình,
 * và cú chết đó nuốt luôn dòng tổng kết của file — hoán vị "bỏ `.catch` quanh
 * `sendMessage`" khi ấy đo ra "không in được gì" thay vì một con số fail. Bắt
 * lại và đếm nó như một dòng đỏ: thiệt hại phải đếm được.
 *
 * Đây cũng đúng là hình dạng lỗi ngoài đời — service worker vừa nạp lại thì
 * `sendMessage` ném, và cú bấm chết câm.
 */
const rejections = [];
process.on('unhandledRejection', (e) => rejections.push((e && e.message) || String(e)));
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

/*
 * Bản tổng kết của một Bó đi KÈM CÚ NHẢY, không ở lại tab tài liệu.
 *
 * Đọc `h.flash()` cho ca nhảy được là đọc một bản báo cáo trên tab vừa bị bỏ
 * lại: `jumpToNotebook` bật tab notebook lên rồi focus cửa sổ. Assertion cũ ghim
 * đúng chỗ đó, tức nó chứng nhận một chuỗi người dùng không bao giờ nhìn thấy.
 */
const summary = (h) => {
  const m = h.sent.filter((x) => x.type === 'jump-notebook').pop();
  return (m && m.summary) || '';
};

const msgs = (h, type) => h.sent.filter((m) => m.type === type);

const check = (h, i) => {
  const box = h.panelAll('.row input')[i];
  box.checked = true;
  box.dispatchEvent(new h.win.Event('change'));
  return box;
};

/*
 * Bỏ tick đi đúng đường của người dùng: đổi `checked` rồi bắn `change`. Gọi
 * thẳng vào `setRow()` là không được — nó nằm trong closure của bảng, và cái
 * cần chứng nhận chính là handler `change` có gọi nó hay không.
 */
const uncheck = (h, i) => {
  const box = h.panelAll('.row input')[i];
  box.checked = false;
  box.dispatchEvent(new h.win.Event('change'));
  return box;
};

/** Trạng thái tick của TỪNG dòng, theo thứ tự — ghim slot chứ không ghim tổng số. */
const states = (h) => h.panelAll('.row input').map((b) => b.checked);

/*
 * Bấm vào cả DÒNG, đúng như người dùng bấm — dòng là một `<label>` bọc ô tick.
 * `check()`/`uncheck()` ở trên lái thẳng ô tick nên bỏ qua đúng lớp này.
 */
const clickRow = (h, i) => h.panelAll('.row')[i].dispatchEvent(
  new h.win.MouseEvent('click', { bubbles: true, cancelable: true }));

/** Cây 3 cấp: cha CÓ url > nhóm không url > hai cháu, cộng một trang em và một trang lẻ. */
const deep = () => [
  docNode('Guide', 'https://docs.example.dev/guide', [
    docNode('Cơ bản', null, [
      docNode('Cài đặt', 'https://docs.example.dev/guide/install', [], 2),
      docNode('Chạy thử', 'https://docs.example.dev/guide/run', [], 2),
    ], 1),
    docNode('Nâng cao', 'https://docs.example.dev/guide/adv', [], 1),
  ]),
  docNode('API', 'https://docs.example.dev/api'),
];

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

  /*
   * Mặc định production — đọc thẳng `NBLM.DEFAULTS`, không đọc lại fixture.
   *
   * `loadDocsPage` cố ý BẬT nút để phần lớn test dưới đây bấm được vào nó. Nếu
   * không có khối này thì fixture là một đường dữ liệu song song: nó chạy cạnh
   * mặc định thật, mang giá trị cùng kiểu, và không assertion nào đối chiếu —
   * ai đổi `DEFAULTS.docsLauncher` về `true` sẽ thấy cả suite vẫn xanh.
   *
   * Vì sao mặc định là TẮT: `detect()` không có ngưỡng điểm, nên nút hiện trên
   * BBC News và Wikipedia (đo 2026-09-03, brave headless — bảng trong
   * `src/common/shared.js`). Đây là setting của CHÍNH ta, không phải hằng số
   * ngoại sinh của Google, nên ghim nó là ghim một hợp đồng ta sở hữu.
   */
  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    ok(
      h.win.NBLM.DEFAULTS.docsLauncher === false,
      '(d) nút nổi phải TẮT SẴN trong production — bật sẵn thì nó tự mời trên ' +
        `mọi trang có 3 link cùng host, nhận: ${JSON.stringify(h.win.NBLM.DEFAULTS.docsLauncher)}`
    );
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

  /*
   * Cú bấm THẬT lên dòng cha, không phải `box.checked = true` rồi bắn `change`.
   *
   * Luật "tick cha thì tick cả con" đã có phép đo giữ: hoán vị
   * `for (const kid of value ? [] : descendants(row))` cho 106 pass / 4 fail /
   * exit 1. Nhưng mọi ca đang có đều lái checkbox bằng tay, nên KHÔNG ca nào
   * hỏi xem người dùng có bấm tới được cái luật ấy không. Dòng là một `<label>`
   * bọc quanh ô tick — đó là thứ duy nhất khiến bấm vào CHỮ cũng tick. Hoán vị
   * `createElement('label')` -> `createElement('div')` giết hẳn đường bấm ấy mà
   * vẫn 110 pass / 0 fail / exit 0 (đo 2026-09-04). Ba khối dưới đây đi bằng
   * `clickRow()` chính vì thế.
   */
  {
    const h = loadDocsPage({ tree: deep() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    eq(h.panelAll('.row__title').map((s) => s.textContent),
      ['Guide', 'Cơ bản', 'Cài đặt', 'Chạy thử', 'Nâng cao', 'API'],
      '(d) tiền đề: cây 3 cấp phải phẳng hoá đúng thứ tự thì chỉ số dòng dưới mới có nghĩa');

    clickRow(h, 0);
    eq(states(h), [true, true, true, true, true, false],
      '(d) bấm vào DÒNG cha có URL phải tick nhóm con, hai cháu và trang em — không chỉ mình nó');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 4 trang',
      '(d) tick cả nhánh thì nút Thêm đếm 4 trang có URL, nhóm giữa không được tính');

    clickRow(h, 0);
    eq(states(h), [false, false, false, false, false, false],
      '(d) bấm lần hai lên chính dòng cha phải bỏ tick toàn bộ nhánh');
    h.close();
  }

  /*
   * Bấm một nhóm đang LỬNG phải tick nốt phần còn thiếu, không phải quét sạch.
   *
   * Đây là chỗ `checked` và `indeterminate` nói hai chuyện khác nhau: ô lửng có
   * `checked === false`, nên nếu handler đọc nhầm nó thành "đang tắt" thì cú bấm
   * ra kết quả ngược. Không ca nào đang ghim nhánh này.
   */
  {
    const h = loadDocsPage({ tree: deep() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);

    clickRow(h, 2);
    const group = h.panelAll('.row input')[1];
    ok(group.indeterminate && !group.checked,
      '(d) tiền đề: mới tick một trong hai cháu thì nhóm giữa phải lửng, chưa phải đã tick');

    clickRow(h, 1);
    eq(states(h), [false, true, true, true, false, false],
      '(d) bấm nhóm đang LỬNG phải tick nốt cháu còn lại, không phải bỏ tick cả nhóm');
    ok(!h.panelAll('.row input')[1].indeterminate,
      '(d) nhóm đã đủ con thì phải thôi lửng');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 2 trang',
      '(d) nhóm giữa không có URL nên chỉ hai cháu được đếm');
    h.close();
  }

  /*
   * Tick cha khi BỘ LỌC đang bật: con bị giấu cũng phải theo.
   *
   * Ô lọc `.panel__search` tới giờ chưa có một ca nào — `grep -n panel__search
   * test/` chỉ ra 0 hit (đo 2026-09-04). Nó không phải chi tiết phụ ở đây: mỗi
   * lượt `render()` dựng lại ô tick MỚI cho riêng dòng đang hiện, và trạng thái
   * của dòng bị giấu sống nhờ ô cũ vẫn nằm trong sổ `boxes`. Hoán vị thêm
   * `boxes.clear()` vào đầu `render()` — tức dòng bị lọc mất sạch trạng thái —
   * vẫn 110 pass / 0 fail / exit 0.
   *
   * Quyết định được ghim ở đây: "cha" nghĩa là CẢ NHÁNH, kể cả phần bộ lọc đang
   * giấu. Nút Thêm nói ra con số thật (4 trang) trong khi chỉ 3 dòng đang hiện —
   * cố ý, để cú bấm không lặng lẽ bỏ sót trang.
   */
  {
    const h = loadDocsPage({ tree: deep() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);

    const box = h.panel('.panel__search');
    box.value = 'install';
    box.dispatchEvent(new h.win.Event('input'));
    await h.tick(20);
    eq(h.panelAll('.row__title').map((s) => s.textContent), ['Guide', 'Cơ bản', 'Cài đặt'],
      '(d) lọc phải giữ lại cả dòng cha của dòng khớp, nếu không dòng con mất chỗ đứng trong cây');

    clickRow(h, 0);
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 4 trang',
      '(d) tick cha khi đang lọc phải tick cả những trang bộ lọc đang giấu');

    box.value = '';
    box.dispatchEvent(new h.win.Event('input'));
    await h.tick(20);
    eq(states(h), [true, true, true, true, true, false],
      '(d) gỡ lọc thì trạng thái tick của dòng từng bị giấu phải còn nguyên');
    h.close();
  }

  /*
   * Bỏ tick cha phải lan xuống mọi con — chiều ngược của khối trên, và nó KHÔNG
   * được khối trên bao. Hoán vị `for (const kid of value ? descendants(row) : [])`
   * trong `setRow()` giữ nguyên 102 pass / 0 fail của cả file, và cả
   * `ui-isolation` (21) lẫn `manifest` (76) — đo 2026-09-04, đây là ba file duy
   * nhất nạp `src/docs/content.js`.
   *
   * Vì sao mù: "Bỏ chọn" gọi `setRow(r, false)` cho MỌI dòng, nên con vẫn sạch
   * kể cả khi cú bấm lên cha không lan xuống. Chỗ duy nhất phân biệt được là
   * một cú bấm bỏ tick lên RIÊNG dòng cha.
   */
  {
    const h = loadDocsPage({ tree: tree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);

    check(h, 0);
    eq(states(h), [true, true, true, false],
      '(d) tiền đề: tick nhóm phải tick cả hai con trước khi đo cú bỏ tick');

    uncheck(h, 0);
    eq(states(h), [false, false, false, false],
      '(d) bỏ tick nhóm phải bỏ tick luôn cả hai trang con');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 0 trang',
      '(d) bỏ tick nhóm rồi thì nút Thêm phải về 0 trang');
    ok(h.panel('[data-act="import"]').disabled, '(d) không còn dòng nào tick thì nút Thêm phải khoá');
    h.close();
  }

  /*
   * Cùng luật cho cha CÓ URL và cho cháu.
   *
   * Hai hình dạng khác hẳn nhóm ở khối trên: `syncCounts()` cố tình bỏ qua mọi
   * dòng có URL (`if (row.url || !row.children.length) continue`), nên với cha
   * có URL thì `setRow()` là đường DUY NHẤT hạ tick của con xuống — không có
   * lớp nào đỡ hộ. Và cháu ở độ sâu 2 chỉ tới được qua nhánh đệ quy của
   * `descendants()`, không qua `row.children`.
   */
  {
    const deep = () => [
      docNode('Guide', 'https://docs.example.dev/guide', [
        docNode('Cơ bản', null, [
          docNode('Cài đặt', 'https://docs.example.dev/guide/install', [], 2),
        ], 1),
        docNode('Nâng cao', 'https://docs.example.dev/guide/adv', [], 1),
      ]),
      docNode('API', 'https://docs.example.dev/api'),
    ];
    const h = loadDocsPage({ tree: deep() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    eq(h.panelAll('.row__title').map((s) => s.textContent),
      ['Guide', 'Cơ bản', 'Cài đặt', 'Nâng cao', 'API'],
      '(d) tiền đề: cây phải phẳng hoá đúng thứ tự thì các chỉ số dòng dưới mới có nghĩa');

    check(h, 0);
    eq(states(h), [true, true, true, true, false],
      '(d) tiền đề: tick cha có URL phải tick cả nhóm con, cháu và trang em');

    uncheck(h, 0);
    eq(states(h), [false, false, false, false, false],
      '(d) bỏ tick cha có URL phải bỏ tick cả nhóm con lẫn CHÁU ở độ sâu 2');
    eq(h.panel('[data-act="import"]').textContent, 'Thêm 0 trang',
      '(d) bỏ tick cha có URL rồi thì không còn trang nào được đếm');
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

  /**
   * Background giả: trả HTML thô như `fetchRawHtml` trả, và ghi lại đã hỏi gì.
   *
   * @param {string[]|'all'} opts.drop url mà cửa khử trùng coi là ĐÃ CÓ trong Sổ
   * @param {string} opts.filterError cửa khử trùng hỏng — ca khác hẳn "đã có rồi"
   */
  const withPages = (h, { fail = [], onFetch = null, drop = [], queue = [], filterError = null, reject = [] } = {}) => {
    h.reply((m) => {
      // Service worker vừa nạp lại / vừa cập nhật thì `sendMessage` *reject*,
      // không trả về `{error}`. Hai hình dạng hỏng khác nhau, và bề mặt phải
      // sống qua cả hai.
      if (reject.includes(m.type)) throw new Error('Extension context invalidated.');
      if (m.type === 'docs-raw-fetch') {
        if (onFetch) onFetch(m.url);
        if (fail.includes(m.url)) return { url: m.url, error: 'HTTP 503' };
        return { url: m.url, finalUrl: m.url, type: 'text/html', html: PAGES[m.url] || '' };
      }
      if (m.type === 'bundle-filter') {
        if (filterError) return { error: filterError };
        const urls = m.urls || [];
        const out = drop === 'all' ? urls : urls.filter((u) => drop.includes(u));
        const q = urls.filter((u) => queue.includes(u) && !out.includes(u));
        return {
          keep: urls.filter((u) => !out.includes(u) && !q.includes(u)),
          dropped: out.map((u) => ({ url: u, why: 'copied' })).concat(q.map((u) => ({ url: u, why: 'queued' }))),
        };
      }
      if (m.type === 'bundle-copied') return { added: (m.urls || []).length };
      if (m.type === 'jump-notebook') return { ...h.jump };
      return {};
    });
  };

  /** Mở bảng chọn và tick hết — ba dòng lặp lại ở gần như mọi ca dưới đây. */
  const openAndTickAll = async (h) => {
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
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

    const note = summary(h);
    ok(/Đã copy 3 link/.test(note), `(d) phải nói đã copy mấy link — nhận: "${note}"`);
    ok(/1 trang không có thân bài/.test(note),
      `(d) phải nêu số trang bị loại, kèm đường đi thay thế — nhận: "${note}"`);
    ok(/menu điều hướng/.test(note),
      '(d) phải nói ra sự đánh đổi: cửa đo trả lời "Nguồn có RỖNG không", không trả lời "Nguồn có SẠCH không"');
    eq(h.flash(), '',
      '(d) nhảy được rồi thì KHÔNG dựng flash ở tab này nữa — tab tài liệu vừa thành tab nền, không ai đọc');
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

  /* ---------------------------------------------------------------- */
  /* khử trùng đứng TRƯỚC cửa đo, và nút Copy lại                       */
  /* ---------------------------------------------------------------- */

  /*
   * Cửa đo là thứ tốn tiền ở bề mặt này: mỗi trang là một lượt fetch HTML thô.
   * Nên khử trùng phải chạy trước — bấm *Copy N link* lần thứ hai trên một
   * sidebar đã copy hết không được tốn một lượt fetch nào.
   *
   * Assertion phải là `asked`, không phải clipboard: hai thứ tự cho ra cùng một
   * clipboard rỗng, nên assert kết quả sẽ xanh cả hai chiều hoán vị.
   */
  {
    const asked = [];
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { drop: 'all', onFetch: (u) => asked.push(u) });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(asked, [],
      '(d) khử trùng loại sạch thì cửa đo KHÔNG được fetch trang nào — cửa đo là cửa duy nhất tốn tiền');
    eq(h.clipboard.writes, [], '(d) không link nào qua khử trùng thì không chạm clipboard');
    ok(!/Cả 0 link/.test(h.flash()), `(d) đừng in một con số 0 vào câu "cả N link" — nhận: "${h.flash()}"`);
    h.close();
  }

  /*
   * Con số link bị loại phải đi KÈM một cách bấm. Im lặng bỏ link là đúng lỗi
   * extension này sinh ra để chữa, và một con số không kèm nút thì cũng chỉ là
   * im lặng có kèm chú thích.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { drop: 'all' });
    h.click('[data-act="all"]');

    ok(h.panel('[data-act="recopy"]').hidden, '(d) chưa có link nào bị loại thì nút Copy lại phải ẩn');

    h.click('[data-act="copy"]');
    await h.tick(150);

    const btn = h.panel('[data-act="recopy"]');
    ok(btn && !btn.hidden, '(d) khử trùng loại link thì phải hiện nút Copy lại');
    ok(/4/.test(btn ? btn.textContent : ''),
      `(d) nút Copy lại phải mang đúng số link bị loại — nhận: "${btn ? btn.textContent : ''}"`);
    h.close();
  }

  /*
   * Bấm *Copy lại*: bỏ qua khử trùng (việc người dùng vừa yêu cầu), NHƯNG vẫn
   * phải qua cửa đo. Ba vế ghim trong một ca, vì bỏ vế nào cũng thành một hoán
   * vị xanh — và vế thứ ba là chỗ dễ tuột nhất: `dropped` bị loại TRƯỚC khi ai
   * đo nó, nên trong đó có thể là một trang dựng thân bài bằng JavaScript.
   */
  {
    const asked = [];
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { drop: 'all', onFetch: (u) => asked.push(u) });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    const btn = h.panel('[data-act="recopy"]');
    ok(!!btn && !btn.hidden, '(d) ca dựng sai thì mọi assertion sau vô nghĩa — nút phải có mặt trước đã');
    if (btn) h.click(btn);
    await h.tick(200);

    eq(msgs(h, 'bundle-filter').length, 1,
      '(d) Copy lại KHÔNG tra Sổ lần nữa — khử trùng chính là thứ người dùng vừa bảo bỏ qua');
    eq(asked.slice().sort(), threeUrls.slice().sort(),
      '(d) Copy lại VẪN phải qua cửa đo: danh sách của nó bị loại trước khi ai đo nó');
    eq(h.clipboard.writes, ['https://a.dev/docs/ssr\nhttps://a.dev/docs/tiny\nhttps://a.dev/docs/junk'],
      '(d) trang dựng bằng JavaScript vẫn bị cửa đo chặn ở nhánh Copy lại — không có đường vòng');
    ok(/Đã copy lại 3 link/.test(summary(h)),
      `(d) bản tổng kết phải phân biệt copy lại với copy lần đầu — nhận: "${summary(h)}"`);
    h.close();
  }

  /*
   * Copy lại mà cửa đo hỏng: danh sách bị loại phải CÒN NGUYÊN.
   *
   * Buông nó trước khi clipboard nhận thật là vứt mất bản duy nhất còn giữ nó —
   * Sổ đã copy không có xoá từng dòng, nên đường lấy lại một link sẽ là *Xoá sổ*
   * toàn bộ, hai nhịp, không hoàn tác. Cái giá quá cao cho một lượt fetch hỏng.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { drop: 'all' });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    ok(!h.panel('[data-act="recopy"]').hidden, '(d) ca dựng sai thì assertion sau vô nghĩa — nút phải hiện trước đã');

    withPages(h, { drop: 'all', fail: threeUrls });   // mọi lượt đo đều hỏng
    h.click(h.panel('[data-act="recopy"]'));
    await h.tick(200);

    eq(h.clipboard.writes, [], '(d) cửa đo hỏng hết thì KHÔNG chạm clipboard');
    const btn = h.panel('[data-act="recopy"]');
    ok(btn && !btn.hidden, '(d) copy lại hỏng thì nút phải CÒN ĐÓ để bấm lại');
    ok(/4/.test(btn ? btn.textContent : ''),
      `(d) và còn nguyên cả 4 link, không rơi mất cái nào — nhận: "${btn ? btn.textContent : ''}"`);
    h.close();
  }

  /*
   * Cửa khử trùng HỎNG không được đọc thành "không có gì để copy".
   *
   * Hai ca cùng cho `keep` rỗng, và đó là cái bẫy: bản trước đọc thẳng
   * `res.keep || []` nên một lượt tra hỏng ra câu "Cả 0 link đều đã có trong Sổ"
   * — vừa vô nghĩa vừa sai nguyên nhân. Bề mặt YouTube xử lý đúng ca này từ đầu;
   * đây là chỗ hai bề mặt lệch nhau.
   */
  {
    const asked = [];
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { filterError: 'storage hỏng', onFetch: (u) => asked.push(u) });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes, [], '(d) tra Sổ hỏng thì KHÔNG copy — fail-closed');
    eq(asked, [], '(d) tra Sổ hỏng thì đừng trả tiền cho cửa đo');
    eq(msgs(h, 'bundle-copied'), [], '(d) tra Sổ hỏng thì không ghi Sổ');
    ok(/storage hỏng/.test(h.flash()),
      `(d) phải nói ra nguyên nhân thật, nguyên văn lỗi — nhận: "${h.flash()}"`);
    ok(!/đã có trong Sổ/.test(h.flash()),
      `(d) KHÔNG được báo "đã có trong Sổ": đó là ca khác hẳn, và nói nhầm thì người dùng đi tìm nhầm chỗ — nhận: "${h.flash()}"`);
    ok(h.panel('[data-act="recopy"]').hidden,
      '(d) tra hỏng thì không có danh sách bị loại nào — đừng dựng một nút Copy lại rỗng');
    h.close();
  }

  /* ---------------------------------------------------------------- */
  /* mục 6 — nhảy sang tab notebook, và DỪNG                           */
  /* ---------------------------------------------------------------- */

  {
    const h = loadDocsPage({ tree: threeTree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    withPages(h);
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    const types = h.sent.map((m) => m.type);
    eq(types.filter((t) => t === 'jump-notebook').length, 1,
      '(d) copy xong phải nhảy sang tab NotebookLM, đúng một lần');
    ok(types.indexOf('jump-notebook') > types.indexOf('bundle-copied'),
      `(d) nhảy tab phải SAU khi ghi Sổ xong — thứ tự nhận được: ${JSON.stringify(types)}`);
    ok(!/notebook đích/.test(h.flash()), `(d) nhảy được thì đừng dặn gì thêm — nhận: "${h.flash()}"`);
    h.close();
  }

  /*
   * Cả ba trang đều trượt cửa đo: clipboard chưa nhận gì, nên không có gì để
   * dán và không có lý do gì để rời trang người dùng đang đứng.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    withPages(h, { fail: threeUrls });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.sent.filter((m) => m.type === 'jump-notebook'), [],
      '(d) Bó rỗng thì KHÔNG nhảy — clipboard chưa nhận gì cả');
    h.close();
  }

  /* Chưa đặt notebook đích: copy vẫn xong, nhưng phải chỉ đường thủ công. */
  {
    const h = loadDocsPage({ tree: threeTree() });
    // Đúng hình dạng service worker thật trả về khi chưa đặt notebook đích —
    // `why` là thứ quyết định câu chỉ đường, nên fixture không được bỏ nó.
    h.jump.jumped = false;
    h.jump.why = 'no-target';
    await h.tick(80);
    h.click(h.launcher());
    await h.tick(60);
    withPages(h);
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes.length, 1, '(d) chưa đặt đích KHÔNG được huỷ cú copy');
    ok(/chưa đặt notebook đích/.test(h.flash()),
      `(d) phải nói ra rằng chưa có đích để nhảy tới — nhận: "${h.flash()}"`);
    ok(/Ctrl\+V/.test(h.flash()), `(d) phải chỉ đường thủ công — nhận: "${h.flash()}"`);
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
      if (m.type === 'bundle-filter') return { keep: m.urls, dropped: [] };
      if (m.type === 'jump-notebook') return { ...h.jump };
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

  /*
   * Bấm *Copy link* hai lần liền tay.
   *
   * Cửa khử trùng và cửa đo đều là một vòng `await`, và trong lúc chờ thì
   * `syncCounts()` bật lại nút theo số dòng đang tick — theo "có gì để copy
   * không", chứ không theo "đang bận hay không". Hai lượt chồng nhau là hai lượt
   * cùng đo, cùng ghi clipboard, và cùng ghi Sổ.
   *
   * Khoá phải là ĐỒNG BỘ, đặt trước cái `await` đầu tiên: đặt sau thì cú bấm thứ
   * hai đã lọt qua rồi.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h);
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    h.click('[data-act="copy"]');   // liền tay, chưa kịp một nhịp nào
    await h.tick(250);

    eq(h.sent.filter((m) => m.type === 'bundle-filter').length, 1,
      'cú bấm thứ hai KHÔNG được mở thêm một lượt — khoá phải đóng trước cái await đầu tiên');
    eq(h.clipboard.writes.length, 1, 'và chỉ được ghi clipboard đúng một lần');
    h.close();
  }

  /* ================================================================== */
  /* sendMessage *reject*, không phải `{error}`                          */
  /* ================================================================== */

  /*
   * Service worker vừa nạp lại thì `chrome.runtime.sendMessage` NÉM, chứ không
   * trả về `{error}`. Trong một handler `click` async thì cú ném đó không có ai
   * bắt: cú bấm chết câm, và người dùng đứng trước một cái nút vừa bấm mà không
   * có gì xảy ra.
   *
   * Ghim ở đúng cửa khử trùng, tức TRƯỚC clipboard: câu báo phải nói rõ chưa
   * copy gì cả, để người dùng biết clipboard của họ còn nguyên.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { reject: ['bundle-filter'] });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes, [], 'cửa khử trùng ném thì KHÔNG được chạm clipboard');
    ok(/chưa copy gì cả/.test(h.flash()),
      `cú bấm không được chết câm — phải nói ra rằng clipboard còn nguyên. Nhận: "${h.flash()}"`);
    ok(!h.panel('[data-act="copy"]').disabled,
      'và nút phải bật lại được — bỏ nó tắt vĩnh viễn là khoá người dùng khỏi lượt thử lại');
    h.close();
  }

  /*
   * `bundle-copied` ném SAU khi clipboard đã nhận. Đây là vạch phân đôi:
   * clipboard CÓ nội dung, chỉ Sổ là chưa ghi được. Báo thành "Không copy được"
   * là nói dối đúng chiều nguy hiểm — người dùng đi copy lại một thứ đang nằm
   * sẵn trong clipboard, và bỏ qua đúng cái tin đáng biết (lần sau sẽ copy trùng).
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { reject: ['bundle-copied'] });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(200);

    eq(h.clipboard.writes.length, 1, 'ca dựng sai thì assertion sau vô nghĩa — clipboard phải nhận được đã');
    ok(!/Không copy được/.test(h.flash()),
      `clipboard đã nhận thì KHÔNG được báo là không copy được — nhận: "${h.flash()}"`);
    ok(/chưa ghi được Sổ/.test(h.flash()),
      `và phải nói ra rằng Sổ chưa ghi được, vì đó là thứ lượt sau phải trả giá — nhận: "${h.flash()}"`);
    h.close();
  }

  /* ================================================================== */
  /* cửa khử trùng loại MỘT PHẦN, hai lý do là hai lối đi                */
  /* ================================================================== */

  /*
   * `why === 'queued'` KHÔNG được vào nút *Copy lại*: copy lại link của một
   * trang đang nằm trong Hàng đợi chỉ dựng lại đúng cái Nguồn rỗng mà Hàng đợi
   * sinh ra để tránh. Gộp hai lý do vào một con số thì hoán vị nào cũng xanh,
   * nên phải ghim con số trên NÚT, không phải tổng số bị loại.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { drop: [threeUrls[0]], queue: [threeUrls[1]] });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(250);

    eq(h.clipboard.writes.length, 1, 'phần sạch vẫn phải tới clipboard — loại một phần không phải loại cả Bó');

    const btn = h.panel('[data-act="recopy"]');
    ok(btn && !btn.hidden, 'có trang bị loại vì đã copy thì nút Copy lại phải hiện');
    ok(/Copy lại 1 link/.test(btn ? btn.textContent : ''),
      `nút chỉ được đếm phần bị loại vì ĐÃ COPY, không gộp phần đang trong Hàng đợi — nhận: "${btn ? btn.textContent : ''}"`);

    /*
     * `h.click` NÉM khi phần tử vắng mặt, và một cú ném ở đây nuốt luôn dòng
     * tổng kết của cả file — hoán vị "gỡ nút ×" khi ấy đo ra "không in được gì"
     * thay vì một con số fail. Thiệt hại phải đếm được.
     */
    const x = h.panel('[data-act="recopy-dismiss"]');
    ok(x && !x.hidden,
      'phải có cách bỏ qua: nút Copy lại không tự tắt, nên không có nút × là nó ở lại vĩnh viễn');
    if (x) {
      h.click(x);
      await h.tick(30);
      ok(h.panel('[data-act="recopy"]').hidden && x.hidden,
        'bấm × thì cả hai nút cùng biến — bỏ lại một dấu × mồ côi là để lại một cái bẫy');
    }
    h.close();
  }

  /*
   * Nợ của lượt trước không được lượt sau lặng lẽ vứt đi.
   *
   * Hai lượt copy trên hai TẬP DÒNG KHÁC NHAU: lượt sau không biết gì về link
   * lượt trước còn nợ, nên ghi đè `lastDropped` là xoá đúng thứ người dùng vừa
   * được báo mà chưa xử lý. Con số trên nút khi ấy tụt xuống, và không có gì
   * nói cho họ biết cái kia đã đi đâu.
   *
   * Ghim con số TRÊN NÚT chứ không ghim `lastDropped`: nút là thứ người dùng
   * đọc, và nó là bản duy nhất còn giữ danh sách đó.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);

    const tick = (i) => {
      const box = h.panelAll('.row input')[i];
      box.checked = true;
      box.dispatchEvent(new h.win.Event('change', { bubbles: true }));
    };

    withPages(h, { drop: [threeUrls[0]] });
    tick(0);
    h.click('[data-act="copy"]');
    await h.tick(250);
    ok(/Copy lại 1 link/.test(h.panel('[data-act="recopy"]').textContent),
      `ca dựng sai thì assertion sau vô nghĩa — lượt đầu phải nợ đúng 1, nhận: "${h.panel('[data-act="recopy"]').textContent}"`);

    withPages(h, { drop: [threeUrls[1]] });
    h.panelAll('.row input').forEach((b) => { b.checked = false; b.dispatchEvent(new h.win.Event('change', { bubbles: true })); });
    tick(1);
    h.click('[data-act="copy"]');
    await h.tick(250);
    ok(/Copy lại 2 link/.test(h.panel('[data-act="recopy"]').textContent),
      `lượt sau phải GỘP vào nợ cũ, không ghi đè — nhận: "${h.panel('[data-act="recopy"]').textContent}"`);
    h.close();
  }

  /*
   * Nhưng nợ đó phải BUÔNG khi bảng nạp trang khác.
   *
   * Bảng là singleton nhớ: `close()` chỉ đặt `display:none`, nên không buông ở
   * `load()` thì mở lại trên trang khác vẫn thấy "Copy lại N link đã có" của
   * trang trước — cùng con số, khác hẳn ý nghĩa. Bấm vào nó là copy link của
   * một trang người dùng đã rời khỏi.
   *
   * Ca này và ca ngay trên là hai vế của cùng một luật, và chúng kéo ngược
   * chiều nhau: giữ khi cùng bảng, buông khi đổi bảng. Thiếu vế nào thì vế kia
   * cũng "sửa" được bằng cách làm sai vế này.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { drop: 'all' });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(250);
    ok(!h.panel('[data-act="recopy"]').hidden,
      'ca dựng sai thì assertion sau vô nghĩa — phải có nợ trước đã');

    // Mở lại: `open()` gọi `panel.load(...)`, đúng đường một trang khác đi qua.
    h.click(h.launcher());
    await h.tick(60);
    ok(h.panel('[data-act="recopy"]').hidden && h.panel('[data-act="recopy-dismiss"]').hidden,
      `nạp lại bảng phải buông nợ cũ — nhận: "${h.panel('[data-act="recopy"]').textContent}"`);
    h.close();
  }

  /*
   * Cửa đo cho qua MỘT PHẦN ở lượt *Copy lại*: nút phải giữ đúng phần còn nợ.
   *
   * Buông sạch là mất những trang chưa tới clipboard; giữ nguyên cả danh sách là
   * bắt người dùng copy trùng phần vừa copy xong. Hai hoán vị này chỉ phân biệt
   * được khi cửa đo cho qua một phần — cho qua hết hoặc trượt hết đều xanh cả hai.
   */
  {
    const h = loadDocsPage({ tree: threeTree() });
    await openAndTickAll(h);
    withPages(h, { drop: 'all' });
    h.click('[data-act="all"]');
    h.click('[data-act="copy"]');
    await h.tick(200);

    const btn = h.panel('[data-act="recopy"]');
    ok(btn && new RegExp(`Copy lại ${threeUrls.length} link`).test(btn.textContent),
      `ca dựng sai thì assertion sau vô nghĩa — nút phải đang giữ đủ ${threeUrls.length} link. Nhận: "${btn ? btn.textContent : ''}"`);

    /*
     * Lượt copy lại: `docs-spa-shell.html` trượt cửa đo (nó dựng thân bài bằng
     * JavaScript), phần còn lại qua. Không cần dựng lỗi giả — fixture đó tồn tại
     * đúng để làm ca này.
     *
     * `onFetch` chộp giao diện ĐANG GIỮA cửa đo: tiến độ là thứ chỉ tồn tại
     * trong lúc đo, đọc sau khi xong là đọc chuỗi đã khôi phục.
     */
    const during = [];
    withPages(h, {
      drop: 'all',
      onFetch: () => during.push({
        recopy: h.panel('[data-act="recopy"]').textContent,
        copy: h.panel('[data-act="copy"]').textContent,
      }),
    });
    h.click('[data-act="recopy"]');
    await h.tick(250);

    ok(during.length > 0, 'ca dựng sai thì assertion sau vô nghĩa — cửa đo phải có chạy');
    ok(during.some((u) => /Đang đo/.test(u.recopy)),
      `tiến độ phải hiện trên chính nút vừa bấm — nhận: ${JSON.stringify(during[0])}`);
    ok(during.every((u) => !/Đang đo/.test(u.copy)),
      `và KHÔNG hiện trên nút Copy link, thứ người dùng không bấm — nhận: ${JSON.stringify(during[0])}`);

    eq(h.clipboard.writes.length, 1, 'phần qua được cửa đo phải tới clipboard');
    const after = h.panel('[data-act="recopy"]');
    ok(after && !after.hidden && /Copy lại 1 link/.test(after.textContent),
      `nút phải còn lại ĐÚNG phần chưa tới clipboard (1), không phải 0 và cũng không phải ${threeUrls.length} — nhận: "${after && !after.hidden ? after.textContent : '(đã ẩn)'}"`);
    h.close();
  }

  // Đặt SAU mọi ca: tới đây `tick()` đã cho microtask queue chạy hết.
  eq(rejections, [], 'không cú bấm nào được để lọt một promise rejection — đó là một cú bấm chết câm');

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
