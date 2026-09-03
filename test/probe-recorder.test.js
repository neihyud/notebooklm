/*
 * Bộ ghi của `tools/probe-notebooklm.mjs` — chạy nó ngoài trình duyệt.
 *
 * VÌ SAO CÓ FILE NÀY. Probe là công cụ owner chạy TAY, một lần, trên phiên
 * đăng nhập thật, và bốn ticket (008/009/011/012) đang chờ đúng một lượt chạy
 * đó. Nếu bộ ghi hỏng thì cái giá không phải là một test đỏ — mà là owner mất
 * cả một phiên rồi mới biết. Nên phần thuần logic của nó phải chạy được ở đây.
 *
 * FILE NÀY KHÔNG CHỨNG NHẬN GÌ VỀ GIAO THỨC CỦA GOOGLE.
 * Ba payload dưới đây do ta dựng, theo hình dạng đọc được từ hai extension khác
 * (`docs/notebooklm-rpc-do-duoc-2.md`). Chúng là ĐẦU VÀO để thử bộ giải mã, KHÔNG
 * phải bằng chứng. Vì thế mọi khẳng định ở đây đều là **tính chất của bộ ghi**
 * — "hình dạng vào bằng hình dạng ra", "không chuỗi nào lọt" — chứ tuyệt đối
 * không có khẳng định nào kiểu "url nằm ở ô 7". Ghim ô số ở đây là tự chứng
 * nhận giả thuyết của chính mình, đúng cái bẫy mà `WORKSPACE_PROTOCOL.md` gọi
 * là test ghim hằng số chép tay.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

const TOOL = path.join(__dirname, '..', 'tools', 'probe-notebooklm.mjs');
const src = fs.readFileSync(TOOL, 'utf8');
const i = src.indexOf('const RECORDER = `');
const j = src.indexOf('\n})()`;', i);
ok(i !== -1 && j !== -1, 'cắt được khối RECORDER ra khỏi tools/probe-notebooklm.mjs');

const MARKER = { url: 'https://example.com/nblm-probe-abc123', youtube: 'https://www.youtube.com/watch?v=nblmPROBEa', title: 'nblm-probe-title-abc123', text: 'nblm-probe-text-abc123 noi dung' };
let rec = src.slice(i + 'const RECORDER = `'.length, j) + '\n})()';
rec = rec.replace('${JSON.stringify(MARKER)}', JSON.stringify(MARKER));
ok(!rec.includes('${'), 'RECORDER chỉ có đúng một chỗ nội suy (MARKER) — không còn ${…} nào sót');

/** Hình dạng: mọi chuỗi thành 'S', còn lại giữ nguyên. Dùng để so vào/ra. */
const hinhDang = (v) =>
  typeof v === 'string' ? 'S'
    : Array.isArray(v) ? v.map(hinhDang)
      : (v && typeof v === 'object') ? Object.keys(v).reduce((o, k) => ((o[k] = hinhDang(v[k])), o), {})
        : v;

const BASE = 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute';
const AT = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1234567890123';
const dungReq = (rpcId, args, sourcePath) => ({
  url: `${BASE}?rpcids=${rpcId}&source-path=${encodeURIComponent(sourcePath)}&rt=c&bl=boq_x`,
  body: (() => { const b = new URLSearchParams(); b.set('f.req', JSON.stringify([[[rpcId, JSON.stringify(args), null, 'generic']]])); b.set('at', AT); return b.toString(); })(),
  args,
});
const dungRes = (rpcId, payload) => ")]}'\n\n" + JSON.stringify([['wrb.fr', rpcId, JSON.stringify(payload), null, null, null, 'generic']]);

const NB = 'nb-xyz';
const LUOT = [
  { ten: 'tGMBJ (xoá nguồn)', ...dungReq('tGMBJ', [[['src-abc-1234567890abcdef']], [2]], '/notebook/' + NB), payload: [1] },
  {
    ten: 'izAoDd batch 2 nguồn',
    ...dungReq('izAoDd', [[[null, null, null, null, null, null, null, ['https://a.example/x'], null, null, 1],
      [null, null, null, null, null, null, null, ['https://b.example/y'], null, null, 1]],
    NB, [2], [1, null, null, null, null, null, null, null, null, null, [1]]], '/notebook/' + NB),
    payload: [[['src-new-1111111111'], ['src-new-2222222222']], 3],
  },
  { ten: 'wXbhsf (liệt kê notebook)', ...dungReq('wXbhsf', [null, 1, null, [2]], '/'), payload: [[['Ten notebook rieng', null, NB]]] },
  { ten: 'izAoDd mang chuỗi mốc', ...dungReq('izAoDd', [[[null, [MARKER.title, MARKER.text], null, 2, null, null, null, null, null, null, 1]], NB, [2], [1]], '/notebook/' + NB), payload: [['src-marker-000000'], 3] },
];

/* môi trường giả — vm context chỉ có builtin JS, phải cấp URL/URLSearchParams */
const win = {
  location: { origin: 'https://notebooklm.google.com', href: 'https://notebooklm.google.com/' },
  /*
   * Khớp theo BODY chứ không theo URL: hai lượt izAoDd trong LUOT có URL giống
   * hệt nhau (cùng rpc id, cùng notebook), nên khớp theo URL thì lượt sau nhận
   * phản hồi của lượt trước — và test đỏ ở chỗ không liên quan gì tới bộ ghi.
   */
  fetch: async (input, init) => {
    const b = init && init.body;
    const l = LUOT.find((x) => x.body === b);
    return { clone: () => ({ text: async () => (l ? dungRes(JSON.parse(new URLSearchParams(l.body).get('f.req'))[0][0][0], l.payload) : '') }) };
  },
  XMLHttpRequest: function () {},
  URL, URLSearchParams,
};
win.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
win.window = win;
const ctx = vm.createContext(win);
vm.runInContext('var window = this;', ctx);
ok(vm.runInContext(rec, ctx) === 'da cai', 'RECORDER cài được ngoài trình duyệt');

(async () => {
  for (const l of LUOT) await win.fetch(l.url, { method: 'POST', body: l.body });
  const calls = (win.__nblmProbe && win.__nblmProbe.calls) || [];

  ok(calls.length === LUOT.length, `ghi đủ ${LUOT.length} lượt (thực tế ${calls.length}) — bọc fetch không nuốt lượt nào`);

  if (calls.length === LUOT.length) {
    for (let k = 0; k < LUOT.length; k++) {
      const c = calls[k], l = LUOT[k];
      ok(c.req.rpcId === JSON.parse(new URLSearchParams(l.body).get('f.req'))[0][0][0], `${l.ten}: rpc id đọc đúng`);
      ok(c.req.query['source-path'] === new URL(l.url).searchParams.get('source-path'), `${l.ten}: source-path giữ nguyên, không bị che`);
      /*
       * Khẳng định cốt lõi: bộ che thay CHUỖI, không đụng CẤU TRÚC. Mọi thứ bốn
       * ticket cần đo (ô nào chứa gì, id nằm ở lớp mảng thứ mấy) đều là cấu trúc.
       */
      ok(JSON.stringify(hinhDang(c.req.params)) === JSON.stringify(hinhDang(l.args)),
        `${l.ten}: hình dạng args VÀO bằng hình dạng RA`);
      ok(JSON.stringify(hinhDang(c.res.frames[0] && c.res.frames[0].payload)) === JSON.stringify(hinhDang(l.payload)),
        `${l.ten}: hình dạng payload phản hồi VÀO bằng RA`);
      ok(c.req.atCoMat === true && c.req.atDoDai === AT.length, `${l.ten}: ghi nhận CÓ token và độ dài, mà không ghi token`);
    }

    /* Điều kiện dò batch của vòng lặp trong main() — nếu nó sai thì bước 5 của
     * hướng dẫn im lặng không ghi nhận gì, và ticket 008 tưởng là đã đo. */
    const batch = calls.find((c) => c.req.rpcId === 'izAoDd' && Array.isArray(c.req.params) && Array.isArray(c.req.params[0]) && c.req.params[0].length >= 2);
    ok(!!batch, 'nhận ra được lượt izAoDd mang từ 2 nguồn trở lên');
    const don = calls.filter((c) => c.req.rpcId === 'izAoDd' && Array.isArray(c.req.params) && Array.isArray(c.req.params[0]) && c.req.params[0].length >= 2);
    ok(don.length === 1, 'lượt izAoDd MỘT nguồn không bị nhận nhầm là batch');
  }

  /* Bảo mật — đây là lời hứa in ngay đầu công cụ, nên nó phải có test. */
  const het = JSON.stringify(calls);
  ok(!het.includes(AT), 'token `at` không lọt vào bản ghi');
  ok(!het.includes('a.example') && !het.includes('b.example'), 'URL nguồn không lọt vào bản ghi');
  ok(!het.includes('Ten notebook rieng'), 'tên notebook không lọt vào bản ghi');
  ok(!het.includes('src-abc-1234567890abcdef') && !het.includes('src-new-1111111111'), 'sourceId thật không lọt vào bản ghi');

  /* Ngoại lệ CÓ CHỦ Ý: chuỗi mốc do chính script sinh ra thì phải hiện nguyên,
   * vì đó là cách duy nhất biết ô nào chứa gì. Mất nó là mất cả phép đo. */
  ok(het.includes('MARKER:title') && het.includes('MARKER:text'), 'chuỗi mốc được giữ lại dưới dạng nhãn MARKER:*');
  ok(!het.includes(MARKER.text), 'nhưng nội dung mốc thật thì vẫn không in ra');

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
