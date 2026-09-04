/*
 * Bề mặt — `src/docs/sidebar.js`: mở section đóng, và khử trùng khi dựng cây.
 *
 * Vì sao tồn tại: tới trước thay đổi này, `detect()` đọc DOM tĩnh và chỉ thấy
 * những link mà theme tình cờ đang render. Đo 2026-09-04 bằng CDP trên
 * docusaurus.io/docs: 9 link, trong khi mở hết section ra là 50 — sót 5/6 sidebar.
 *
 * Chứng nhận: cú BẤM (bấm vào đâu, bằng chuỗi sự kiện nào, bao nhiêu lượt) và
 * điều kiện dừng. Cố tình không chỉ assert số link cuối: hai cách bấm khác hẳn
 * nhau vẫn cho cùng một con số trên DOM giả lập, nên "đếm link" một mình chứng
 * nhận được cả bản sai.
 *
 * KHÔNG chứng nhận: `detect()` chọn đúng container trên trang thật — nó chấm
 * điểm bằng `getBoundingClientRect`, thứ jsdom luôn trả 0×0. `tools/probe-sidebar.mjs`
 * là chỗ trả lời câu đó.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

const rejections = [];
process.on('unhandledRejection', (e) => rejections.push((e && e.message) || String(e)));

/**
 * Dựng một trang có sidebar, nạp `sidebar.js` THẬT.
 *
 * @param {string} html nội dung sidebar
 * @param {Function} wire gắn hành vi "mở section" — nhận (document, log)
 */
function load(html, wire) {
  const dom = new JSDOM(
    `<!doctype html><html><body><nav id="sb">${html}</nav></body></html>`,
    // `runScripts: 'outside-only'` là bắt buộc: không có nó, `globalThis` bên
    // trong `window.eval` trỏ về global của Node, nên `sidebar.js` gắn API lên
    // nhầm chỗ và `window.NBLM_DOCS_SIDEBAR` là undefined — im lặng, không lỗi.
    { url: 'https://docs.example.dev/guide/intro', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const log = [];
  for (const file of ['src/common/shared.js', 'src/docs/sidebar.js']) {
    window.eval(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  if (wire) wire(window.document, log, window);
  return { window, log, sb: () => window.document.getElementById('sb') };
}

const linkKeys = (window, container) => {
  const SB = window.NBLM_DOCS_SIDEBAR;
  const keys = new Set();
  for (const a of container.querySelectorAll('a[href]')) {
    const u = SB.usableUrl(a, window.location.href);
    const k = u && window.NBLM.docKey(u);
    if (k) keys.add(k);
  }
  return keys.size;
};

/* ------------------------------------------------------------------ */
/* 1. Theme unmount link con (Docusaurus): phải bấm mới có             */
/* ------------------------------------------------------------------ */

/** Ba category đóng, mỗi cái mọc ra 3 link con khi caret bị bấm. */
const UNMOUNTED = `
  <ul>
    <li><a href="/guide/intro">Intro</a></li>
    <li><a href="/guide/setup">Setup</a></li>
    <li><a href="/guide/usage">Usage</a></li>
    ${[1, 2, 3].map((n) => `
      <li class="cat" data-cat="${n}">
        <div><a href="/cat/${n}">Nhóm ${n}</a>
        <button class="caret" aria-expanded="false" data-cat="${n}"></button></div>
      </li>`).join('')}
  </ul>`;

/**
 * Gắn hành vi React: chỉ mở khi nhận đủ chuỗi pointer→mouse→click, và commit DOM
 * ở macrotask KẾ TIẾP chứ không ngay trong handler.
 *
 * Cả hai điều kiện đều lấy từ trang thật, không phải bịa cho khó: `el.click()`
 * một mình không mở được section nào trên docusaurus.io (6 vòng, link đứng yên
 * 9), và đếm ngay sau khi bấm cho 10 trong khi nhường một `setTimeout(0)` cho 30.
 */
function wireReactish(document, log, window) {
  for (const btn of document.querySelectorAll('button.caret')) {
    const seen = new Set();
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      btn.addEventListener(type, () => {
        seen.add(type);
        if (type !== 'click') return;
        if (!['pointerdown', 'mousedown', 'pointerup', 'mouseup'].every((t) => seen.has(t))) {
          log.push(`click-tran:${btn.dataset.cat}`);   // bấm cụt — không mở
          return;
        }
        if (btn.getAttribute('aria-expanded') === 'true') return;
        log.push(`mo:${btn.dataset.cat}`);
        btn.setAttribute('aria-expanded', 'true');
        const li = btn.closest('li');
        window.setTimeout(() => {                       // commit ở tick sau
          const ul = document.createElement('ul');
          ul.innerHTML = [1, 2, 3]
            .map((k) => `<li><a href="/cat/${btn.dataset.cat}/p${k}">Trang ${k}</a></li>`)
            .join('');
          li.appendChild(ul);
        }, 0);
      });
    }
  }
}

(async () => {
  {
    const { window, log, sb } = load(UNMOUNTED, wireReactish);
    const SB = window.NBLM_DOCS_SIDEBAR;

    eq(linkKeys(window, sb()), 6, 'trước khi mở: chỉ 3 link lẻ + 3 link nhóm');

    const count = await SB.expandAll(sb(), window.location.href);
    eq(count, 15, 'sau khi mở: 6 cũ + 9 link con mọc thêm');
    eq(linkKeys(window, sb()), 15, 'DOM thật sự có thêm link, không chỉ số trả về');

    // Cú bấm, không phải kết quả: mỗi category đúng MỘT lần mở, không lần nào cụt.
    eq(log.sort(), ['mo:1', 'mo:2', 'mo:3'], 'mỗi category mở đúng một lần, bằng chuỗi sự kiện đầy đủ');
  }

  /* ------------------------------------------------------------------ */
  /* 2. Bấm cụt bằng .click() KHÔNG mở được — ghim rằng chuỗi là cần     */
  /* ------------------------------------------------------------------ */
  {
    const { window, log, sb } = load(UNMOUNTED, wireReactish);
    for (const b of sb().querySelectorAll('button.caret')) b.click();
    await new Promise((r) => window.setTimeout(r, 10));
    eq(linkKeys(window, sb()), 6, 'chỉ .click(): không link nào mọc thêm');
    eq(log.sort(), ['click-tran:1', 'click-tran:2', 'click-tran:3'], 'handler thấy click cụt');
  }

  /* ------------------------------------------------------------------ */
  /* 3. Không có gì để mở: dừng ngay, không bấm bừa                      */
  /* ------------------------------------------------------------------ */
  {
    const FLAT = `<ul>${[1, 2, 3, 4].map((n) => `<li><a href="/p/${n}">Trang ${n}</a></li>`).join('')}</ul>`;
    const { window, log, sb } = load(FLAT, null);
    const count = await window.NBLM_DOCS_SIDEBAR.expandAll(sb(), window.location.href);
    eq(count, 4, 'sidebar phẳng: số link không đổi');
    eq(log, [], 'không bấm gì cả');
  }

  /* ------------------------------------------------------------------ */
  /* 4. <details> đóng: link con phải vào được cây                       */
  /* ------------------------------------------------------------------ */
  /*
   * Ghim KẾT QUẢ (link vào cây) chứ không ghim `details.open`. `open` chuyển
   * true là do trình duyệt/jsdom tự làm theo spec khi `<summary>` nhận click,
   * nên assert nó là chứng nhận hành vi của nền tảng, không phải của ta: gỡ sạch
   * phần mở của `expandAll` thì assert đó vẫn xanh.
   */
  {
    const DETAILS = `
      <ul>
        <li><a href="/a">A</a></li><li><a href="/b">B</a></li><li><a href="/c">C</a></li>
        <li><details><summary aria-expanded="false">Nhóm</summary>
          <ul><li><a href="/d1">D1</a></li><li><a href="/d2">D2</a></li></ul>
        </details></li>
      </ul>`;
    const { window, sb } = load(DETAILS, null);
    ok(!sb().querySelector('details').open, 'tiền đề: <details> đang đóng');
    const after = await window.NBLM_DOCS_SIDEBAR.detectExpanded();
    eq(after.count, 5, '<details> đóng: 3 link lẻ + 2 link con vẫn vào đủ cây');
  }

  /* ------------------------------------------------------------------ */
  /* 5. aria-expanded nói dối: dừng theo SỐ LINK, không theo thuộc tính  */
  /* ------------------------------------------------------------------ */
  /*
   * Trên trang thật, sau khi mở hết, 5 nút vẫn khai `aria-expanded="false"`
   * trong khi <li> của chúng đã chứa 5/36/8/12/8 thẻ <a> — React không đồng bộ
   * lại thuộc tính. Lấy thuộc tính làm điều kiện dừng là bấm mãi không thôi, và
   * bấm lần hai là ĐÓNG lại thứ vừa mở.
   */
  {
    const LIAR = `
      <ul>
        <li><a href="/a">A</a></li><li><a href="/b">B</a></li><li><a href="/c">C</a></li>
        <li><button id="liar" aria-expanded="false"></button></li>
      </ul>`;
    const { window, log, sb } = load(LIAR, (document, l) => {
      const btn = document.getElementById('liar');
      let opened = false;
      btn.addEventListener('click', () => {
        l.push('bam');
        if (opened) {                                  // bấm lần hai = đóng lại
          const ul = btn.closest('li').querySelector('ul');
          if (ul) ul.remove();
          opened = false;
          return;
        }
        opened = true;
        const ul = document.createElement('ul');
        ul.innerHTML = '<li><a href="/x1">X1</a></li><li><a href="/x2">X2</a></li>';
        btn.closest('li').appendChild(ul);
        // cố tình KHÔNG đặt aria-expanded="true" — đúng như trang thật
      });
    });

    const count = await window.NBLM_DOCS_SIDEBAR.expandAll(sb(), window.location.href);
    eq(count, 5, 'giữ được 2 link vừa mở, không bấm đóng lại');
    eq(log.length, 1, 'bấm ĐÚNG MỘT lượt: bấm lại chính nút đó là đóng lại thứ vừa mở');
    ok(sb().querySelector('#liar').closest('li').querySelector('ul'), 'link con vẫn còn trong DOM');
  }

  /* ------------------------------------------------------------------ */
  /* 6. Không bấm vào <a href>: bấm là điều hướng, mất trang             */
  /* ------------------------------------------------------------------ */
  {
    const ANCHOR = `
      <ul>
        <li><a href="/a">A</a></li><li><a href="/b">B</a></li><li><a href="/c">C</a></li>
        <li><a href="/nhom" id="sublist" aria-expanded="false">Nhóm</a></li>
      </ul>`;
    const { window, log, sb } = load(ANCHOR, (document, l) => {
      document.getElementById('sublist').addEventListener('click', () => l.push('bam-vao-link'));
    });
    await window.NBLM_DOCS_SIDEBAR.expandAll(sb(), window.location.href);
    eq(log, [], 'không bấm vào thẻ <a> có href, dù nó mang aria-expanded="false"');
  }

  /* ------------------------------------------------------------------ */
  /* 7. detectExpanded dựng LẠI cây sau khi mở                           */
  /* ------------------------------------------------------------------ */
  /*
   * Hoán vị mà test này bắt: trả về `found` (cây dựng TRƯỚC lúc bấm) thay vì
   * dựng lại. Số link trong DOM vẫn tăng, nên mọi assert đếm DOM vẫn xanh —
   * chỉ cây giao cho bảng chọn là thiếu.
   */
  {
    const { window, sb } = load(UNMOUNTED, wireReactish);
    const SB = window.NBLM_DOCS_SIDEBAR;
    const before = SB.detect();
    const after = await SB.detectExpanded();
    eq(before.count, 6, 'detect() thường: 6 link, và KHÔNG mở gì');
    eq(linkKeys(window, sb()), 15, 'detectExpanded() có mở section');
    eq(after.count, 15, 'cây trả về được dựng lại trên DOM đã mở');
    ok(SB.countLinks(after.tree) === 15, 'đếm lại từ chính cây: khớp');
  }

  /* ------------------------------------------------------------------ */
  /* 8. detect() thường không được đụng vào trang                        */
  /* ------------------------------------------------------------------ */
  {
    const { window, log, sb } = load(UNMOUNTED, wireReactish);
    window.NBLM_DOCS_SIDEBAR.detect();
    await new Promise((r) => window.setTimeout(r, 20));
    eq(log, [], 'detect() không bấm nút nào');
    eq(linkKeys(window, sb()), 6, 'DOM nguyên vẹn sau detect()');
  }

  /* ------------------------------------------------------------------ */
  /* 9. Nhiều top-level list: URL nằm ở hai list chỉ được vào cây MỘT lần */
  /* ------------------------------------------------------------------ */
  /*
   * Sidebar thật hay chia thành nhiều <ul> anh em thay vì một cây duy nhất. Đo
   * 2026-09-04 trên tailwindcss.com/docs/installation/using-vite: container có
   * 19 top-level list, và `/docs/installation` nằm ở cả list 0 ("Documentation")
   * lẫn list 1 ("Installation") — cây ra 204 node cho 203 URL phân biệt.
   *
   * Ghim cả HAI vế, vì mỗi vế một mình đều chứng nhận được bản sai:
   *   - chỉ đếm node  -> "gộp sạch mọi list làm một" cũng cho số đúng;
   *   - chỉ đếm distinct -> bản làm mất luôn link cũng cho số đúng.
   */
  /*
   * Số link ở đây phải đủ lớn để đường <ul> VƯỢT ngưỡng 80% của `build()`.
   * Nếu không, bỏ hẳn list thứ hai vẫn cho cây tí hon rơi xuống `fromFlat`, và
   * `fromFlat` gom lại đủ 4 link — ca test khi ấy xanh cả với bản đánh rơi cả
   * một list. Đo bằng hoán vị: với 2+3 link, "chỉ dựng list đầu" KHÔNG đỏ.
   */
  const paths = (window, tree) => {
    const out = [];
    (function walk(ns) { for (const n of ns) { if (n.url) out.push(new window.URL(n.url).pathname); walk(n.children || []); } })(tree);
    return out;
  };

  {
    const HAI_LIST = `
      <ul>
        <li><a href="/docs/installation">Documentation</a></li>
        ${['a', 'b', 'c', 'd', 'e', 'f'].map((k) => `<li><a href="/docs/${k}">${k}</a></li>`).join('')}
      </ul>
      <ul>
        <li><a href="/docs/installation">Installation</a></li>
        <li><a href="/docs/x">X</a></li>
        <li><a href="/docs/y">Y</a></li>
      </ul>`;
    const { window, sb } = load(HAI_LIST, null);
    const SB = window.NBLM_DOCS_SIDEBAR;

    eq(linkKeys(window, sb()), 9, 'tiền đề: DOM có 10 thẻ <a> nhưng chỉ 9 URL phân biệt');

    const got = paths(window, SB.detect().tree).sort();
    eq(got.length, 9, 'cây có đúng 9 node mang URL — không nhân bản qua ranh giới list');
    eq(
      got,
      ['/docs/a', '/docs/b', '/docs/c', '/docs/d', '/docs/e', '/docs/f',
       '/docs/installation', '/docs/x', '/docs/y'],
      'và là đúng 9 URL đó — không mất link nào của list thứ hai'
    );
  }

  /* ------------------------------------------------------------------ */
  /* 10. Đường fromFlat cũng phải khử trùng, và phải có sổ RIÊNG         */
  /* ------------------------------------------------------------------ */
  /*
   * `build()` có hai lượt dựng, và ca 9 chỉ với tới lượt đầu. Không có ca này
   * thì hai hoán vị đi qua lượt hai — "fromFlat dùng chung sổ với lượt <ul>" và
   * "fromFlat thôi khử trùng" — đều xanh.
   *
   * Ép rơi xuống `fromFlat` bằng đúng hình dạng đã gặp ngoài đời (ghi trong
   * `build()`): sidebar dựng bằng <div> lồng nhau, trong container lẫn một <ul>
   * nhỏ. Lượt <ul> gom được quá ít so với tổng nên bị loại.
   *
   * Hai ràng buộc của fixture này, cả hai đều học được bằng hoán vị:
   *
   *   - `<ul>` phải có một link RIÊNG (`/docs/u1`) không nằm trong `<div>`.
   *     Nếu không, `<div>` có đủ link bằng cả container và bước thu hẹp của
   *     `detect()` sẽ chọn thẳng `<div>` — bỏ luôn `<ul>` ra ngoài, nên chẳng
   *     còn lượt dựng nào để mà dùng chung sổ.
   *   - Link trùng phải nằm VẮT QUA hai khối. Nếu nó gọn trong một khối thì
   *     container sau khi thu hẹp không còn cặp trùng nào để khử.
   *
   * Đo bản đầu tiên thiếu cả hai: `detect()` trả container là `<div>` 7 link,
   * không `<ul>`, và hai hoán vị "fromFlat dùng chung sổ" / "fromFlat thôi khử
   * trùng" đều XANH.
   *
   * `<ul>` có ĐÚNG 3 link cũng là cố ý, và là chỗ duy nhất trong repo ghim
   * ngưỡng 80% của `build()`. 3 link vượt sàn cứng `Math.max(3, …)` nhưng thua
   * 80% của 8, nên fixture này phân biệt được hai luật: hoán vị ngưỡng về
   * `>= 3` sẽ trả về cây tí hon 3 link thay vì gọi `fromFlat`. Với `<ul>` 2
   * link, cả hai luật cùng loại nó và hoán vị ấy XANH.
   */
  {
    const FLAT_SIDEBAR = `
      <ul>
        <li><a href="/docs/u1">Chỉ có ở list</a></li>
        <li><a href="/docs/u2">Cũng chỉ có ở list</a></li>
        <li><a href="/docs/installation">Documentation</a></li>
      </ul>
      <div>
        <div><a href="/docs/installation">Installation</a></div>
        ${['a', 'b', 'c', 'd', 'e'].map((k) => `<div><a href="/docs/${k}">${k}</a></div>`).join('')}
      </div>`;
    const { window, sb } = load(FLAT_SIDEBAR, null);
    const SB = window.NBLM_DOCS_SIDEBAR;

    eq(linkKeys(window, sb()), 8, 'tiền đề: 9 thẻ <a>, 8 URL phân biệt');

    const picked = SB.detect();
    ok(picked.container.querySelector('ul'), 'tiền đề: container giữ cả <ul> lẫn <div>');

    const got = paths(window, picked.tree).sort();
    eq(got.length, 8, 'fromFlat: 8 node mang URL, link trùng chỉ vào cây một lần');
    eq(
      got,
      ['/docs/a', '/docs/b', '/docs/c', '/docs/d', '/docs/e', '/docs/installation',
       '/docs/u1', '/docs/u2'],
      'fromFlat lấy đủ cả hai khối, không bị sổ của lượt <ul> chặn mất'
    );
  }

  for (const r of rejections) { fail++; console.log(`❌ promise rejection không ai bắt: ${r}`); }
  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail) process.exitCode = 1;
})();
