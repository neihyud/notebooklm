#!/usr/bin/env node
//
// Ticket 012 — script phụ: **dump điểm chấm sidebar** của một trang tài liệu thật.
//
// `verify-docs.mjs` trả lời "đạt hay đỏ". Khi nó đỏ ở tiêu chí sidebar, câu hỏi tiếp theo luôn là
// *vì sao khối kia thắng khối này*, và `findSidebar()` không trả lời được điều đó — nó trả về một
// node. File này mở bụng phép chấm ra: từng ứng viên, từng số hạng trong bốn dấu hiệu, và bước
// thu hẹp đã dừng ở đâu.
//
// Bốn dấu hiệu đều **cùng một đơn vị** (điểm) và cùng thang [0..trọng số], nên đọc tổng điểm một
// mình không nói được gì — đúng lý do `src/docs/sidebar.js` phải ghi rõ vai của từng số. Bảng ở
// đây in **từng số hạng riêng**, không in tổng rồi để người đọc tự đoán.
//
//   node tools/probe-sidebar.mjs --url <url> [--top 12] [--chrome <đường dẫn>] [--headed]
//
// Thoát 2 khi không chạy được lượt đo; ngoài ra luôn 0 — đây là công cụ để nhìn, không phải cổng.

import { withExtensionBrowser, readSources } from './live-browser.mjs';

const DOC_SOURCES = [
  'src/common/shared.js',
  'src/docs/selectors.js',
  'src/docs/markdown.js',
  'src/docs/extract.js',
  'src/docs/sidebar.js',
];

/**
 * Liệt kê ứng viên **giống hệt `tally()`** của `src/docs/sidebar.js`: mọi tổ tiên của mọi link
 * điều hướng. `tally` không nằm trong danh sách export, và đó là chuyện đúng — nó là chi tiết bên
 * trong. Ở đây dựng lại tập ứng viên là chấp nhận được vì file này **không phán quyết gì**: nó
 * chỉ bày ra để người đọc so với node mà `findSidebar()` thật sự chọn, và chính node ấy được
 * đánh dấu trong bảng.
 */
const PROBE = (top) => `(() => {
  const S = window.NBLM_SHARED;
  const D = window.NBLM_DOCS_SELECTORS;
  const B = window.NBLM_DOCS_SIDEBAR;
  const sel = D.DEFAULT;
  const url = location.href;
  const root = document.body;
  // Chép đúng \`pageOptions()\` của \`src/docs/content.js\`. Thiếu \`metrics\` thì \`narrowness()\` trả 0
  // ở mọi khối và cả bảng dưới đây hoà nhau ở đúng số hạng dùng để tách sidebar khỏi khối bọc nó
  // — một bảng chấm điểm sai mà trông hoàn toàn hợp lý.
  const options = { selectors: sel, metrics: { viewport: () => Number(window.innerWidth) || 0 } };

  const links = B.navLinks(root, url, options);
  const byNode = new Map();
  for (const record of links) {
    for (let node = record.anchor.parentElement; node; node = node.parentElement) {
      if (!byNode.has(node)) byNode.set(node, []);
      byNode.get(node).push(record);
      if (node === root) break;
    }
  }

  const chosen = B.findSidebar(root, url, options);
  const describe = (node) => node.tagName.toLowerCase()
    + (node.id ? '#' + node.id : '')
    + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');

  const rows = [];
  for (const [node, records] of byNode) {
    const count = records.length;
    const current = records.some((r) => r.kind === 'current') ? 1 : 0;
    const nested = node.querySelector(sel.css('nestedList')) ? 1 : 0;
    const narrow = B.narrowness(node, options);
    rows.push({
      node: describe(node),
      links: count,
      currentLink: current,
      nestedList: nested,
      width: Math.round(node.getBoundingClientRect().width),
      // Từng số hạng riêng, không gộp: bốn dấu hiệu cùng đơn vị nên một tổng 30 điểm có thể là
      // "đầy link" hoặc là "có link về trang đang mở", và hai chuyện ấy dẫn tới hai cách sửa khác
      // hẳn nhau.
      ptLinks: B.WEIGHT.links * Math.min(count / B.ENOUGH_LINKS, 1),
      ptNested: B.WEIGHT.nested * nested,
      ptColumn: B.WEIGHT.column * narrow,
      ptCurrent: B.WEIGHT.current * current,
      total: B.scoreSidebar(node, url, options),
      isChosen: node === chosen,
    });
  }
  rows.sort((a, b) => b.total - a.total || b.links - a.links);

  const tree = chosen ? B.buildTree(chosen, url, options) : null;
  return {
    url,
    viewport: window.innerWidth,
    totalNavLinks: links.length,
    anchorLinks: B.anchorLinks(root, url, options).length,
    chosen: chosen ? describe(chosen) : null,
    chosenWidth: chosen ? Math.round(chosen.getBoundingClientRect().width) : 0,
    // Ngưỡng thu hẹp đo bằng **số link**, không bằng điểm — nên bảng phải in số link của từng
    // khối con, chứ in điểm là in đúng thứ bước thu hẹp không dùng tới.
    narrowRatio: B.NARROW_RATIO,
    listCoverRatio: B.LIST_COVER_RATIO,
    tree: tree ? { via: tree.via, taken: tree.taken, total: tree.total } : null,
    labels: tree ? B.flatten(tree.nodes).slice(0, 12).map((n) => ({ depth: n.depth, label: n.label, url: n.url })) : [],
    rows: rows.slice(0, ${top}),
  };
})()`;

function parseArgs(argv) {
  const out = { url: '', top: 12, chrome: null, headed: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--headed') out.headed = true;
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--url') { out.url = argv[i + 1]; i += 1; }
    else if (argv[i] === '--top') { out.top = Number(argv[i + 1]); i += 1; }
    else if (argv[i] === '--chrome') { out.chrome = argv[i + 1]; i += 1; }
    else throw new Error(`tham số không hiểu: ${argv[i]}`);
  }
  if (!out.url) throw new Error('thiếu --url <trang tài liệu cần dò>');
  if (!(out.top > 0)) throw new Error('--top phải là số dương');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const dump = await withExtensionBrowser({ chrome: args.chrome, headless: !args.headed }, async (ctx) => {
    const page = await ctx.newPage();
    await page.goto(args.url, { settleMs: 3000 });
    await page.evaluate(readSources(DOC_SOURCES), { awaitPromise: false });
    return { version: ctx.version, ...(await page.evaluate(PROBE(args.top), { awaitPromise: false })) };
  });

  if (args.json) {
    console.log(JSON.stringify(dump, null, 2));
    return;
  }

  console.log('# Điểm chấm sidebar (ticket 012)');
  console.log(`# Chromium : ${dump.version}`);
  console.log(`# trang    : ${dump.url}`);
  console.log(`# khung nhìn: ${dump.viewport}px, ${dump.totalNavLinks} link điều hướng, ${dump.anchorLinks} neo trong trang`);
  console.log('');
  console.log(`findSidebar() chọn : ${dump.chosen || '(không chọn được khối nào)'}  — rộng ${dump.chosenWidth}px`);
  if (dump.tree) {
    console.log(`buildTree()        : lối "${dump.tree.via}", lấy ${dump.tree.taken}/${dump.tree.total} link `
      + `(ngưỡng tin lối <ul>: ${dump.listCoverRatio})`);
  }
  console.log(`ngưỡng thu hẹp     : ${dump.narrowRatio} số link của khối đang đứng`);
  console.log('');

  const head = ['   ', 'link', 'cur', 'ul⊂ul', 'rộng', 'đ.link', 'đ.lồng', 'đ.cột', 'đ.hiệntại', 'TỔNG', 'khối'];
  console.log(`${head[0]}${head[1].padStart(5)}${head[2].padStart(5)}${head[3].padStart(7)}${head[4].padStart(7)}`
    + `${head[5].padStart(8)}${head[6].padStart(8)}${head[7].padStart(8)}${head[8].padStart(11)}${head[9].padStart(7)}  ${head[10]}`);
  for (const row of dump.rows) {
    console.log(`${row.isChosen ? '=> ' : '   '}`
      + `${String(row.links).padStart(5)}${String(row.currentLink).padStart(5)}${String(row.nestedList).padStart(7)}`
      + `${(`${row.width}px`).padStart(7)}${row.ptLinks.toFixed(1).padStart(8)}${row.ptNested.toFixed(1).padStart(8)}`
      + `${row.ptColumn.toFixed(1).padStart(8)}${row.ptCurrent.toFixed(1).padStart(11)}${row.total.toFixed(1).padStart(7)}  ${row.node}`);
  }

  console.log('');
  console.log('12 mục đầu của cây dựng được:');
  for (const item of dump.labels) {
    console.log(`  ${'  '.repeat(item.depth)}- ${item.label}${item.url ? '' : '   (mục nhóm, không import được)'}`);
  }
}

main().catch((error) => {
  console.error(`probe-sidebar: ${error && error.stack ? error.stack : error}`);
  process.exit(2);
});
