#!/usr/bin/env node
//
// Ticket 012 — chạy **chính mã nguồn** của lớp tài liệu trên bốn trang docs công khai thật, mỗi
// bộ tạo một trang: Docusaurus, MkDocs Material, VitePress, Sphinx + Read the Docs.
//
// Bốn bộ tạo chứ không phải bốn trang: `src/docs/selectors.js` mở đầu bằng đúng câu "ở đây không
// có một sản phẩm nào để nhắm". Cả cách chọn thân bài lẫn cách dò sidebar đều dựa vào **hành vi**
// (khối sâu nhất giữ gần trọn chữ; cột hẹp đầy link cùng site) chứ không dựa vào tên class — nên
// phép kiểm duy nhất có nghĩa là chạy trên những trang dựng HTML khác hẳn nhau.
//
// Bảy tiêu chí của Acceptance nằm ở `tools/live-checks.mjs` và có test riêng
// (`test/live-checks.test.js`). Ở đây chỉ có phần **đo trong trình duyệt** — chỗ không test được
// bằng cây giả, và cũng là chỗ hai lỗi "chỉ lộ ra ở Chrome" của ticket 009 và 010 đã sống được
// qua một suite xanh.
//
//   node tools/verify-docs.mjs [--url <url>]… [--chrome <đường dẫn>] [--headed] [--json]
//
// `--url` lặp lại được và **thay hẳn** danh sách mặc định.
// Thoát 1 khi có tiêu chí đỏ, 2 khi không chạy được lượt đo.

import { withExtensionBrowser, readSources, isOwnWorker } from './live-browser.mjs';
import { DOC_CHECK_IDS, checkDocPage } from './live-checks.mjs';

/**
 * Bốn trang mặc định, mỗi bộ tạo một trang, và mỗi trang là **tài liệu chính thức của chính bộ
 * tạo ấy** — thứ ít có khả năng biến mất nhất, và cũng là bản dựng chuẩn nhất của theme đó.
 * Mỗi trang cố ý chọn trang có khối code nhiều dòng: tiêu chí "khối code không dính thành một
 * dòng" không kiểm được gì trên một trang chỉ có chữ.
 */
const DEFAULT_URLS = Object.freeze([
  { generator: 'Docusaurus', url: 'https://docusaurus.io/docs/installation' },
  { generator: 'MkDocs Material', url: 'https://squidfunk.github.io/mkdocs-material/setup/changing-the-colors/' },
  { generator: 'VitePress', url: 'https://vitepress.dev/guide/getting-started' },
  { generator: 'Sphinx + RTD', url: 'https://sphinx-rtd-theme.readthedocs.io/en/stable/configuring.html' },
]);

/** Nạp vào trang theo đúng thứ tự phụ thuộc giữa các file. */
const DOC_SOURCES = [
  'src/common/shared.js',
  'src/docs/selectors.js',
  'src/docs/markdown.js',
  'src/docs/extract.js',
  'src/docs/sidebar.js',
];

/**
 * Đo một trang tài liệu **trong trình duyệt**, rồi để `checkDocPage()` phán quyết ở Node.
 *
 * Ranh giới đó là cố ý: mọi phép so nằm ở Node vì ở đó chúng có test, còn ở đây chỉ có những
 * thứ **chỉ trình duyệt thật mới trả lời được** — `innerText` của một `<pre>` (số dòng code
 * người đọc nhìn thấy), `getBoundingClientRect` (bề ngang cột mà `sidebar.js` chấm điểm), và
 * chính cái DOM sống mà cây giả đang mô phỏng.
 *
 * `codeRenderedLines` cố ý **không** dùng `MD.codeLines()` của extension: một phép kiểm dùng lại
 * đúng hàm đang bị nghi ngờ thì không kiểm được gì. `innerText` là trọng tài độc lập — nó là số
 * dòng trình duyệt thật sự dựng ra, và cũng đúng là số dòng người dùng copy được từ trang.
 */
const MEASURE = `(() => {
  const S = window.NBLM_SHARED;
  const D = window.NBLM_DOCS_SELECTORS;
  const MD = window.NBLM_DOCS_MARKDOWN;
  const X = window.NBLM_DOCS_EXTRACT;
  const B = window.NBLM_DOCS_SIDEBAR;
  const sel = D.DEFAULT;
  const url = location.href;
  const root = document.body;
  // Chép đúng \`pageOptions()\` của \`src/docs/content.js\`. Thiếu \`metrics\` là dấu hiệu "cột hẹp"
  // của \`findSidebar\` trả 0 ở **mọi** khối — \`narrowness()\` chỉ đọc bề ngang khung nhìn từ
  // adapter, không có đường lui về DOM như bề ngang khối. Đo không có nó là đo một phép chấm chỉ
  // còn ba dấu hiệu, tức đo một thứ sản phẩm không chạy.
  const options = { selectors: sel, metrics: { viewport: () => Number(window.innerWidth) || 0 } };

  // ---- thân bài, đúng đường sản phẩm đi
  const picked = X.pickMainBlock(root, options);
  const cleaned = X.cleanBlock(picked, options);
  const read = X.readDocument(root, options);

  // ---- số dòng code **hiện ra trên màn hình**, đo trên phần tử sống
  const junk = sel.css('chrome') + ', ' + sel.css('dropped') + ', ' + sel.OWN_UI;
  // Đi ngược lên **chỉ tới \`picked\`**, không dùng \`closest()\`: \`cleanBlock\` gỡ rác *bên trong*
  // bản sao của thân bài, nên một tổ tiên nằm NGOÀI thân bài không loại được khối code nào.
  // \`closest(junk)\` thì trèo lên tận \`<html>\` — ở VitePress nó gặp \`<div class="VPDoc has-aside">\`
  // (khớp \`[class*="aside"]\`) và tuyên bố cả 21 khối code của trang là rác, trong khi Markdown
  // dựng ra đủ cả 21. Đo sai chiều ấy cho ra một "phát hiện" hoàn toàn tưởng tượng.
  const survives = (node, stop) => {
    for (let n = node; n && n !== stop; n = n.parentElement) if (n.matches(junk)) return false;
    return true;
  };
  // Đếm dòng **không rỗng**, cả ở đây lẫn ở phía fence (\`fenceLineCounts\`).
  //
  // Không phải để dễ dãi: \`innerText\` chèn một dòng trống giữa mỗi dòng code ở những theme dựng
  // mỗi dòng thành một phần tử khối (MkDocs Material: khối 3 dòng ra 5 dòng \`innerText\`, khối 22
  // dòng ra 43 — luôn đúng 2n−1). Đếm cả dòng trống là so một vế đã nhân đôi với một vế chưa,
  // rồi báo mọi khối code của mọi trang MkDocs là bị nuốt mất một nửa. Cái giá của phép đếm này:
  // dòng trống *thật* trong code không được canh — chấp nhận được, vì mất dòng trống là lỗi
  // trình bày, còn mất dòng code là mất nội dung.
  const renderedLines = (pre) => pre.innerText
    .split('\\n')
    .filter((line) => S.collapse(line) !== '')
    .length;
  const pres = Array.from(picked.querySelectorAll(sel.css('codeBlock')))
    .filter((pre) => survives(pre, picked));

  // ---- sidebar
  const found = B.readSidebar(root, url, options);
  const flat = B.flatten(found.nodes);
  const stray = { anchor: 0, foreign: 0 };
  for (const node of flat) {
    if (!node.url) continue;
    const kind = B.linkKind(node.url, url).kind;
    if (kind === 'anchor') stray.anchor += 1;
    else if (kind === 'foreign') stray.foreign += 1;
  }

  return {
    url,
    title: read.title,
    markdown: read.markdown,
    codeRenderedLines: pres.map(renderedLines),
    main: {
      tag: picked.tagName,
      className: String(picked.className || '').slice(0, 90),
      fellBackToRoot: picked === root,
      chars: S.collapse(cleaned.textContent).length,
      headings: cleaned.querySelectorAll(sel.css('heading')).length,
    },
    sidebar: {
      outcome: found.outcome,
      via: found.via,
      taken: found.taken,
      total: found.total,
      anchors: found.anchors,
      containerTag: found.container ? found.container.tagName : '',
      containerClass: found.container ? String(found.container.className || '').slice(0, 90) : '',
      containerWidth: found.container ? Math.round(found.container.getBoundingClientRect().width) : 0,
      viewport: window.innerWidth,
      labels: flat.map((node) => node.label),
      stray,
    },
  };
})()`;

// ------------------------------------------------------------------ báo cáo

function printPage(entry) {
  const { generator, requested, measure, report, error } = entry;
  console.log(`## ${generator}`);
  console.log(`   yêu cầu : ${requested}`);
  if (error) {
    console.log(`   ✗ không đo được: ${error}`);
    console.log('');
    return;
  }
  console.log(`   đứng ở  : ${measure.url}`);
  console.log(`   tiêu đề : ${JSON.stringify(measure.title)}`);
  console.log(`   thân bài: <${measure.main.tag} class="${measure.main.className}">, `
    + `${measure.main.chars} ký tự, ${measure.main.headings} đề mục`);
  console.log(`   sidebar : <${measure.sidebar.containerTag} class="${measure.sidebar.containerClass}">, `
    + `rộng ${measure.sidebar.containerWidth}/${measure.sidebar.viewport}px, `
    + `${measure.sidebar.labels.length} mục`);
  console.log(`   Markdown: ${measure.markdown.length} ký tự, ${measure.codeRenderedLines.length} khối code trên trang`);
  for (const check of report.checks) {
    console.log(`   ${check.ok ? '✓' : '✗'} ${check.id.padEnd(28)} ${check.detail}`);
  }
  console.log('');
}

function printSummary(entries) {
  const width = Math.max(...DOC_CHECK_IDS.map((id) => id.length));
  const heads = entries.map((e) => e.generator.slice(0, 15).padStart(16));
  console.log('## Bảng tổng kết — tiêu chí × bộ tạo');
  console.log(`${''.padEnd(width)} ${heads.join('')}`);
  for (const id of DOC_CHECK_IDS) {
    const cells = entries.map((entry) => {
      if (entry.error) return '?'.padStart(16);
      const row = entry.report.checks.find((c) => c.id === id);
      return (row && row.ok ? 'đạt' : 'ĐỎ').padStart(16);
    });
    console.log(`${id.padEnd(width)} ${cells.join('')}`);
  }
}

// ------------------------------------------------------------------ main

/**
 * Giá trị đi kèm một cờ, và **ném khi thiếu**. `argv[i + 1]` trần thì `--url` ở cuối dòng lệnh
 * cho ra `undefined`, và `undefined` là một URL tương đối hợp lệ với `Page.navigate` — lượt chạy
 * đi quét một trang không tồn tại rồi báo bảy tiêu chí đỏ như thể sản phẩm hỏng.
 */
function value(argv, i) {
  if (argv[i + 1] === undefined) throw new Error(`${argv[i]} thiếu giá trị đi kèm`);
  return argv[i + 1];
}

function parseArgs(argv) {
  const out = { urls: [], chrome: null, headed: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--headed') out.headed = true;
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--url') { out.urls.push({ generator: `(--url ${out.urls.length + 1})`, url: value(argv, i) }); i += 1; }
    else if (argv[i] === '--chrome') { out.chrome = value(argv, i); i += 1; }
    else throw new Error(`tham số không hiểu: ${argv[i]}`);
  }
  if (out.urls.length === 0) out.urls = [...DEFAULT_URLS];
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = await withExtensionBrowser({ chrome: args.chrome, headless: !args.headed }, async (ctx) => {
    // `match` chứ không chỉ `timeoutMs`: Chrome tự nạp component extension của riêng nó, nên
    // "danh sách không rỗng" có thể đúng mà vẫn chưa có worker của extension này.
    const all = await ctx.serviceWorkers({ timeoutMs: 20000, match: isOwnWorker });
    const own = all.filter(isOwnWorker);
    const sources = readSources(DOC_SOURCES);
    const entries = [];

    for (const target of args.urls) {
      // Một tab **mới cho mỗi trang**: bốn bộ tạo này đều là SPA, và `WORKSPACE_PROTOCOL.md` v5
      // gọi tên đúng hình "một thứ của trang A còn sống trên trang B". Dùng lại một tab là tự
      // rước đúng thứ đó vào phép đo dựng ra để bắt nó.
      const page = await ctx.newPage();
      try {
        await page.goto(target.url, { settleMs: 3000 });
        await page.evaluate(sources, { awaitPromise: false });
        const measure = await page.evaluate(MEASURE, { awaitPromise: false });
        entries.push({ ...target, requested: target.url, measure, report: checkDocPage(measure) });
      } catch (error) {
        // Một trang không truy cập được là một kết quả, không phải một lượt chạy hỏng: ba trang
        // còn lại vẫn phải đo xong và vẫn phải được dán vào handback.
        entries.push({ ...target, requested: target.url, error: String((error && error.message) || error) });
      } finally {
        await ctx.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
      }
    }

    return { chrome: { path: ctx.chromePath, version: ctx.version }, workers: { all, own }, entries };
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('# Kiểm chứng lớp tài liệu trên trang thật (ticket 012)');
    console.log(`# Chromium  : ${result.chrome.version}`);
    console.log(`# nhị phân  : ${result.chrome.path}`);
    console.log(`# Node      : ${process.version}`);
    console.log(`# service worker của extension : ${result.workers.own.length ? result.workers.own.map((w) => w.url).join(', ') : 'KHÔNG CÓ'}`);
    console.log('');
    for (const entry of result.entries) printPage(entry);
    printSummary(result.entries);
  }

  const failures = [];
  if (result.workers.own.length === 0) failures.push('service worker của extension không khởi động');
  for (const entry of result.entries) {
    if (entry.error) { failures.push(`${entry.generator}: không đo được — ${entry.error}`); continue; }
    for (const check of entry.report.checks) {
      if (!check.ok) failures.push(`${entry.generator} / ${check.id}: ${check.detail}`);
    }
  }

  if (!args.json) {
    console.log('');
    console.log('-'.repeat(72));
    console.log(failures.length === 0 ? 'XANH — bốn bộ tạo, bảy tiêu chí, không chỗ nào đỏ.' : `ĐỎ (${failures.length}):`);
    for (const failure of failures) console.log(`  • ${failure}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`verify-docs: ${error && error.stack ? error.stack : error}`);
  process.exit(2);
});
