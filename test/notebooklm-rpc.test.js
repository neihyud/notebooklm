/*
 * Đường RPC thêm Nguồn (`src/notebooklm/rpc.js`) chạy trong DOM thật của jsdom.
 *
 * Cái test ở đây KHÔNG làm, và cố ý: ghim rpc id, ghim đường batchexecute, ghim
 * vị trí trong payload. Ba thứ đó là hằng số ngoại sinh — Google đổi lúc nào
 * cũng được, và một assertion ghim chúng sẽ xanh vĩnh viễn sau khi đã sai. Mọi
 * chỗ cần nhắc tới chúng bên dưới đều đọc lại từ `NBLM_RPC.BASE`/`config` chứ
 * không gõ giá trị, nên đổi giá trị trong nguồn thì test vẫn nói đúng một chuyện.
 *
 * Cái test ở đây LÀM: sự tương ứng giữa hai đầu — đối số nào vào ô nào, id nào
 * gửi đi thì đòi id nào trả về, phản hồi hình dạng nào thì đi nhánh nào, và
 * token `at` có rò ra khỏi thân request hay không.
 *
 * Mạng thật thì jsdom không với tới; `fetch` bên dưới là hàm giả ghi lại lời gọi.
 * Vì thế test này KHÔNG chứng nhận rằng backend NotebookLM chấp nhận payload —
 * chỉ `tools/probe-notebooklm.mjs` chạy trên tab thật mới trả lời được.
 */
const { loadFixture } = require('./dom-harness.js');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ */
/* dụng cụ                                                             */
/* ------------------------------------------------------------------ */

const AT = 'AFcWxH0abcdefgHIJKLmnop:1756000000000';

/** Một thẻ <script> in ra WIZ_global_data đúng như trang thật vẫn làm. */
function wizScript(values) {
  return `<script nonce="abc">window.WIZ_global_data = ${JSON.stringify(values)};</script>`;
}

/** Thân phản hồi batchexecute: prefix `)]}'`, rồi các khối kèm độ dài. */
function envelope(frames) {
  const json = JSON.stringify(frames);
  return `)]}'\n\n${json.length}\n${json}\n`;
}

const wrb = (rpcId, payload) => ['wrb.fr', rpcId, payload === null ? null : JSON.stringify(payload), null, null, null, 'generic'];
const er = (rpcId, message) => ['er', rpcId, null, null, null, [message]];
const OK_PAYLOAD = [['nguon-moi-1234'], 3];

/**
 * Một cây jsdom có sẵn WIZ_global_data, rpc.js đã nạp, và `fetch` giả.
 * `plan` là danh sách phản hồi trả về theo thứ tự lời gọi.
 */
function scene({ settings, plan, wiz, domStub } = {}) {
  const values = wiz === undefined ? { cfb2h: 'boq_x', SNlM0e: AT, qwAQke: 'LabsTailwind' } : wiz;
  const f = loadFixture('', values ? wizScript(values) : '', {
    withRpc: true,
    settings: Object.assign({ rpcEnabled: true }, settings),
    domStub,
  });
  const calls = [];
  const queue = (plan || []).slice();
  f.win.fetch = async (url, init) => {
    calls.push([url, init]);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) throw new TypeError('Failed to fetch');
    if (typeof next === 'function') return next(url, init);
    return { status: next.status == null ? 200 : next.status, text: async () => next.body || '' };
  };
  f.calls = calls;
  return f;
}

/**
 * Ô nào trong `args` mang thứ gì — đọc từ chính `argsShape` của module.
 *
 * KHÔNG file test nào ở đây được biết `args` có mấy ô hay nguồn bọc mấy lớp:
 * hai oracle bên thứ ba mâu thuẫn đúng chỗ đó và không ai có request thật, nên
 * một assertion ghim con số là chứng nhận một hình dạng chưa ai xác minh. Cái
 * ghim được là SỰ TƯƠNG ỨNG: thứ ta định gửi có tới đúng ô mà bản mô tả nói không.
 */
const oCua = (cfg, dat) => cfg.argsShape.findIndex((o) => o && o.dat === dat);

const specOf = (params, cfg) => {
  const i = oCua(cfg, 'sources');
  let v = i < 0 ? null : params[i];
  const lop = Number(cfg.argsShape[i] && cfg.argsShape[i].boc) || 0;
  for (let k = 0; k < lop; k++) v = Array.isArray(v) ? v[0] : null;
  // Trả mảng rỗng thay vì để `null[...]` ném ra: hình dạng sai thì mọi assertion
  // đọc ô phải ĐỎ kèm tên ô, chứ không phải làm sập file test ở lần deref đầu —
  // lúc đó cái duy nhất còn đọc được là stack trace, không phải điều đang hỏng.
  return Array.isArray(v) ? v : [];
};

/** Bóc một lời gọi fetch ra thành các mảnh có tên. */
function decode(call) {
  const [url, init] = call;
  const body = new URLSearchParams(init.body);
  const freq = JSON.parse(body.get('f.req'));
  return {
    url,
    query: new URLSearchParams(url.slice(url.indexOf('?') + 1)),
    rpcId: freq[0][0][0],
    params: JSON.parse(freq[0][0][1]),
    at: body.get('at'),
    rawBody: String(init.body),
  };
}

(async () => {
  /* ================================================================== */
  /* 1. Ghi đè của owner: GỘP THÊM, không thay thế                        */
  /* ================================================================== */
  {
    const f = scene({ settings: { rpcOverrides: { addSourceIds: ['id-owner-dan-vao'] } } });
    const R = f.R;
    await f.A.addUrlSource('https://example.com/x').catch(() => {});

    const ids = R.config.addSourceIds;
    ok(ids[0] === 'id-owner-dan-vao', `id owner thêm phải được thử TRƯỚC, nhận: ${JSON.stringify(ids[0])}`);
    ok(
      deepEq(ids.slice(1), R.BASE.addSourceIds),
      `id mặc định phải còn nguyên phía sau (gộp thêm chứ không thay thế), nhận: ${JSON.stringify(ids)}`
    );
    ok(ids.length === R.BASE.addSourceIds.length + 1, `đúng một id được thêm vào, nhận ${ids.length}`);

    // Cùng MỘT hàm gộp với selectorOverrides, không phải bản chép lại: so thẳng
    // kết quả với `NBLM_SELECTORS.merge`. Hai bản cài đặt sẽ lệch nhau lúc nào
    // không hay, và ràng buộc 4 của ticket đòi đúng hành vi này.
    const bangTay = f.win.NBLM_SELECTORS.merge(R.BASE, { addSourceIds: ['id-owner-dan-vao'] });
    ok(deepEq(R.config, bangTay), 'gộp rpcOverrides phải cho kết quả y hệt NBLM_SELECTORS.merge');
  }

  {
    const f = scene({ settings: { rpcOverrides: { slots: { url: 9 } } } });
    await f.A.addUrlSource('https://example.com/x').catch(() => {});
    const R = f.R;
    ok(R.config.slots.url === 9, `slot owner ghi đè phải thắng, nhận ${R.config.slots.url}`);
    ok(
      R.config.slots.youtubeUrl === R.BASE.slots.youtubeUrl,
      'ghi đè MỘT slot không được xoá các slot còn lại (merge sâu, không thay cả object)'
    );
  }

  /* ================================================================== */
  /* 2. Dựng payload — cặp title/text                                     */
  /* ================================================================== */
  {
    const TIEU_DE = 'Tiêu đề của Nguồn';
    const NOI_DUNG = 'Toàn bộ bản transcript dài dằng dặc';
    // `plan` bỏ trống: phản hồi giả phải mang ĐÚNG id mà code vừa gửi, nên dựng
    // envelope theo chính lời gọi thay vì gõ sẵn một id ngoại sinh vào đây.
    const f = scene();
    f.win.fetch = async (url, init) => {
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      f.calls.push([url, init]);
      return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
    };

    const res = await f.A.addTextSource(TIEU_DE, NOI_DUNG);
    ok(f.calls.length === 1, `đúng một request được gửi, nhận ${f.calls.length}`);

    const d = decode(f.calls[0]);
    const slots = f.R.config.slots;
    const cap = specOf(d.params, f.R.config)[slots.text];

    ok(Array.isArray(cap) && cap.length === 2, `ô văn bản phải là cặp [tiêu đề, nội dung], nhận: ${JSON.stringify(cap)}`);
    // Đây là cặp hoán vị số 1 của WORKSPACE_PROTOCOL: hai string cùng kiểu, đổi
    // chỗ thì mỗi Nguồn mang tiêu đề là cả bản transcript mà request vẫn 200.
    ok(cap && cap[0] === TIEU_DE, `phần tử 0 của cặp phải là TIÊU ĐỀ, nhận: ${JSON.stringify(cap && cap[0])}`);
    ok(cap && cap[1] === NOI_DUNG, `phần tử 1 của cặp phải là NỘI DUNG, nhận: ${JSON.stringify(cap && cap[1])}`);
    ok(cap && cap[0] !== cap[1], 'tiêu đề và nội dung không được là cùng một chuỗi');

    ok(specOf(d.params, f.R.config)[slots.url] == null, 'nguồn văn bản KHÔNG được điền ô URL');
    ok(specOf(d.params, f.R.config)[slots.youtubeUrl] == null, 'nguồn văn bản KHÔNG được điền ô URL YouTube');
    ok(
      specOf(d.params, f.R.config)[slots.kind] === f.R.config.kindCodes.text,
      `nguồn văn bản phải mang mã loại của chính nó, nhận: ${JSON.stringify(specOf(d.params, f.R.config)[slots.kind])}`
    );

    ok(res.ok === true, `RPC trả dữ liệu thì kết quả phải ok, nhận: ${JSON.stringify(res)}`);
    ok(f.domCalls.length === 0, `RPC thành công thì KHÔNG được chạy thêm đường DOM, đã gọi: ${JSON.stringify(f.domCalls.map((c) => c.ten))}`);
  }

  /*
   * ---- Mỗi loại URL vào đúng ô mà bản mô tả khai ----
   *
   * Bản trước của khối này khẳng định `slots.url !== slots.youtubeUrl` —
   * "hai ô URL phải là hai vị trí khác nhau, nếu không hai loại Nguồn nhập làm
   * một". Đó là một GIẢ THUYẾT về giao thức của Google khoác áo assertion, và
   * hai oracle độc lập đã bác nó: cả hai đặt URL đơn, YouTube hay không, vào
   * cùng một ô (`docs/notebooklm-rpc-do-duoc-2.md`). Nên nó bị gỡ, không bị sửa
   * cho xanh — thứ nó canh không tồn tại.
   *
   * Cái thay thế không ghim con số nào, và vẫn có răng ở CẢ HAI thế giới: hôm
   * nay hai ô trùng nhau, ngày Google tách chúng ra thì assertion tự đổi vế.
   */
  {
    const mk = async (url) => {
      const f = scene();
      f.win.fetch = async (u, init) => {
        f.calls.push([u, init]);
        const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
        return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
      };
      await f.A.addUrlSource(url);
      return { d: decode(f.calls[0]), slots: f.R.config.slots, cfg: f.R.config };
    };

    const WEB = 'https://example.com/bai-viet';
    const YT = 'https://www.youtube.com/watch?v=abcdefghijk';
    const web = await mk(WEB);
    const yt = await mk(YT);

    const oCua = (r, ten) => specOf(r.d.params, r.cfg)[r.slots[ten]];

    ok(deepEq(oCua(web, 'url'), [WEB]),
      `URL thường phải tới đúng ô slots.url trỏ vào (${web.slots.url}), nhận: ${JSON.stringify(oCua(web, 'url'))}`);
    ok(deepEq(oCua(yt, 'youtubeUrl'), [YT]),
      `URL YouTube phải tới đúng ô slots.youtubeUrl trỏ vào (${yt.slots.youtubeUrl}), nhận: ${JSON.stringify(oCua(yt, 'youtubeUrl'))}`);

    // Cặp CÒN nguy hiểm sau khi hai ô URL nhập làm một: URL rơi vào ô văn bản.
    // Hoán vị `slots.url` với `slots.text` thì hai dòng này đỏ, và đó là cặp
    // duy nhất trong nhóm này còn quan sát được.
    ok(oCua(web, 'text') == null, 'nguồn URL thường KHÔNG được chạm ô văn bản');
    ok(oCua(yt, 'text') == null, 'nguồn URL YouTube KHÔNG được chạm ô văn bản');
  }

  /* ---- hai ô URL trùng nhau phải là chủ ý, và phải có hệ quả kiểm được ---- */
  {
    // Cùng MỘT chuỗi url, ép qua hai `kind` khác nhau. `addUrlSource` tự rẽ theo
    // `isYouTubeUrl` nên không gửi cùng một url qua cả hai nhánh được — gọi
    // thẳng `tryRpc` mới quan sát được đúng thứ đang hỏi.
    const URL_CHUNG = 'https://example.com/mot-duong-dan';
    const mkKind = async (kind) => {
      const f = scene({ plan: [(u, init) => {
        const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
        return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
      }] });
      await f.R.tryRpc({ kind, url: URL_CHUNG });
      return { params: decode(f.calls[0]).params, cfg: f.R.config };
    };

    const a = await mkKind('url');
    const b = await mkKind('youtube');
    const cungO = a.cfg.slots.url === a.cfg.slots.youtubeUrl;

    if (cungO) {
      ok(deepEq(a.params, b.params),
        'hai ô URL trỏ cùng chỗ thì hai `kind` phải dựng ra payload GIỐNG HỆT nhau — ' +
        'lệch nhau nghĩa là còn một chỗ phân biệt hai loại mà config không nói ra: ' +
        `${JSON.stringify(a.params)} so với ${JSON.stringify(b.params)}`);
    } else {
      ok(!deepEq(a.params, b.params),
        'hai ô URL trỏ khác chỗ thì hai `kind` PHẢI dựng ra payload khác nhau, ' +
        'nếu không việc tách hai ô là vô nghĩa');
    }
  }

  /* ---- hình dạng request: hai tầng JSON, và notebook id lấy từ URL ---- */
  {
    const f = scene({ plan: [{ body: envelope([]) }] });
    await f.A.addUrlSource('https://example.com/x');
    const d = decode(f.calls[0]);
    ok(d.rpcId === f.R.config.addSourceIds[0], `id gửi đi phải là ứng viên đầu trong config, nhận: ${JSON.stringify(d.rpcId)}`);
    ok(d.query.get('rpcids') === d.rpcId, 'query `rpcids` phải là chính id nằm trong f.req');
    ok(
      d.query.get('source-path') === `/notebook/${f.win.location.pathname.split('/notebook/')[1]}`,
      `source-path phải lấy id notebook từ URL đang mở, nhận: ${JSON.stringify(d.query.get('source-path'))}`
    );
    ok(Array.isArray(d.params), 'tham số của lời gọi phải là một CHUỖI JSON lồng trong f.req, parse ra mảng');
    ok(f.calls[0][1].method === 'POST', 'batchexecute là POST');
    ok(f.calls[0][1].credentials === 'same-origin', `chỉ gửi cookie cho chính origin này, nhận: ${JSON.stringify(f.calls[0][1].credentials)}`);
    ok(f.calls[0][0].startsWith(f.R.config.paths[0]), 'đường gọi phải là ứng viên đầu trong config');
  }

  /* ================================================================== */
  /* 3. Token `at`: tìm theo HÌNH DẠNG, và không rò ra ngoài              */
  /* ================================================================== */
  {
    const f = scene({ plan: [{ body: envelope([]) }] });
    const I = f.R._internals;

    // Khoá tên gì không quan trọng — đó là chủ ý. Tài liệu bên ngoài nói khoá tên
    // 'SNlM0e'; ghim tên đó là chép tay thêm một hằng số ngoại sinh nữa.
    const la = f.win.document.createElement('div');
    la.innerHTML = wizScript({ cfb2h: 'boq_x', mot_ten_khoa_hoan_toan_khac: AT });
    const doc = { querySelectorAll: () => la.querySelectorAll('script') };
    const hit = I.readAtToken(doc, f.R.config);
    ok(hit && hit.token === AT, `đổi TÊN KHOÁ vẫn phải tìm ra token (khớp theo hình dạng), nhận: ${JSON.stringify(hit)}`);
    ok(hit && hit.key === 'mot_ten_khoa_hoan_toan_khac', `phải nói đúng khoá nào đã dùng, nhận: ${JSON.stringify(hit && hit.key)}`);

    // Không giá trị nào đúng hình dạng -> không có token -> không gửi gì.
    const trong = f.win.document.createElement('div');
    trong.innerHTML = wizScript({ cfb2h: 'boq_x', SNlM0e: 'khong-dung-hinh-dang' });
    ok(
      I.readAtToken({ querySelectorAll: () => trong.querySelectorAll('script') }, f.R.config) === null,
      'giá trị sai hình dạng thì phải trả null chứ không nhận bừa'
    );
    ok(I.readAtToken({ querySelectorAll: () => [] }, f.R.config) === null, 'trang không có WIZ_global_data thì trả null');

    // Nhánh dự phòng: JSON.parse hỏng thì vẫn phải dò được token theo hình dạng
    // ngay trong chính đoạn script đó. Đây là nhánh sinh ra cho ĐÚNG cái ngày
    // Google đổi cách in WIZ_global_data — không test thì nó chết lặng lẽ và chỉ
    // lộ ra vào đúng ngày đó. (Dấu phẩy thừa dưới đây làm JSON.parse ném.)
    const vo = f.win.document.createElement('div');
    vo.innerHTML = `<script>window.WIZ_global_data = {"cfb2h":"x","SNlM0e":"${AT}",};</` + `script>`;
    const duPhong = I.readAtToken({ querySelectorAll: () => vo.querySelectorAll('script') }, f.R.config);
    ok(duPhong && duPhong.token === AT, `JSON hỏng vẫn phải dò ra token theo hình dạng, nhận: ${JSON.stringify(duPhong)}`);
    ok(duPhong && duPhong.key === null, 'nhánh dò theo hình dạng không biết tên khoá, và phải nói thẳng là null');
    ok(duPhong && duPhong.source !== 'WIZ_global_data', 'phải nói rõ token đến từ nhánh dự phòng chứ không phải từ object đã parse');

    // Cùng đoạn script hỏng đó nhưng KHÔNG có giá trị nào đúng hình dạng: vẫn null.
    const voRong = f.win.document.createElement('div');
    voRong.innerHTML = '<script>window.WIZ_global_data = {"cfb2h":"x","SNlM0e":"qua-ngan",};</' + 'script>';
    ok(
      I.readAtToken({ querySelectorAll: () => voRong.querySelectorAll('script') }, f.R.config) === null,
      'nhánh dự phòng không được vơ bừa một chuỗi bất kỳ'
    );
  }

  {
    const f = scene({ plan: [{ body: envelope([]) }] });
    await f.A.addUrlSource('https://example.com/x');
    const d = decode(f.calls[0]);
    ok(d.at === AT, 'token `at` phải được gửi trong thân request — đó là chỗ DUY NHẤT nó được phép đi tới');
  }

  /* ---- token không được xuất hiện ở bất cứ chỗ nào khác ---- */
  {
    // Lỗi transport mang nguyên token trong câu chữ là ca dễ rò nhất: thông báo
    // lỗi của trình duyệt thường kèm cả URL/thân request.
    const f = scene({
      plan: [() => { throw new TypeError(`Failed to fetch (at=${AT})`); }],
    });
    const res = await f.A.addTextSource('Tiêu đề', 'Nội dung');
    const bao = f.reports()[f.R.REPORT.RPC_UNKNOWN];

    ok(!JSON.stringify(res).includes(AT), `token không được lọt vào kết quả trả về: ${JSON.stringify(res).slice(0, 200)}`);
    ok(bao && !JSON.stringify(bao).includes(AT), `token không được lọt vào bản chụp: ${String(JSON.stringify(bao)).slice(0, 200)}`);
    ok(!JSON.stringify(f.store).includes(AT), 'token không được lưu vào storage ở bất cứ khoá nào');
    // `fetch` ném ra KHÔNG chứng minh request chưa rời máy: server có thể đã ghi
    // xong rồi mới mất phản hồi. Chạy tiếp đường DOM lúc đó là Nguồn thứ hai.
    ok(f.domCalls.length === 0, `lỗi transport là "không biết" nên KHÔNG được chạy tiếp đường DOM, nhận ${f.domCalls.length} lượt DOM`);
    ok(res.ok === false && res.sourceAdded === true, 'và phải khoá lại để tầng trên không thử đường khác');
    ok(bao && bao.daRoiXuongDom === false, 'bản chụp phải nói rõ lượt này KHÔNG có đường DOM chạy bù');
    ok(!f.reports()[f.R.REPORT.RPC_UNUSABLE], 'và KHÔNG được ghi nhầm sang khoá "đã rơi xuống DOM"');
  }

  /* ---- trang không có `fetch`: dừng TRƯỚC khi gửi, nên DOM chạy được ---- */
  {
    const f = scene({ domStub: async () => ({ ok: true, error: null, limit: false, verified: true }) });
    delete f.win.fetch;
    const res = await f.A.addUrlSource('https://example.com/khong-co-fetch');
    // Ta chưa gọi được `fetch` lần nào thì chắc chắn chưa có gì rời máy — khác
    // hẳn `fetch` đã gọi rồi mới ném. Gộp hai ca này một nhãn là mất đường DOM
    // cho ca mà đường DOM dùng được.
    ok(f.domCalls.length === 1, `không có fetch thì phải rơi xuống DOM, nhận ${f.domCalls.length} lượt DOM`);
    ok(res.ok === true, `và lượt đó phải thành công, nhận: ${JSON.stringify(res)}`);
  }

  /* ---- lỗi CỦA TA khác lỗi mạng: một bên rơi xuống DOM, bên kia không ---- */
  {
    // `tryRpc` ném ra là lỗi trong chính file này, xảy ra trước khi có request
    // nào rời máy — nên chạy đường DOM là an toàn. Gộp nó chung nhãn với lỗi
    // mạng (`transport`, request có thể đã rời tay ta) là mất luôn đường DOM
    // cho một ca mà đường DOM hoàn toàn dùng được.
    const f = scene({ domStub: async () => ({ ok: true, error: null, limit: false, verified: true }) });
    f.win.document.querySelectorAll = () => { throw new Error('vỡ trong lúc đọc DOM'); };

    const res = await f.A.addUrlSource('https://example.com/loi-cua-ta');
    ok(f.calls.length === 0, 'lỗi của chính ta thì chưa có request nào được gửi');
    ok(f.domCalls.length === 1, `lỗi của chính ta phải rơi xuống DOM, nhận ${f.domCalls.length} lượt DOM`);
    ok(res.ok === true, `và đường DOM chạy được thì lượt này vẫn thành công, nhận: ${JSON.stringify(res)}`);
  }

  /* ================================================================== */
  /* 4. Đọc phản hồi: phân biệt "đã thêm" với "đã gửi"                    */
  /* ================================================================== */
  {
    const f = scene();
    const I = f.R._internals;
    const ID = 'id-dang-dung';

    const doc = (body, id) => I.readEnvelope(body, id == null ? ID : id).status;

    ok(doc(envelope([wrb(ID, OK_PAYLOAD)])) === 'ok', 'frame wrb.fr đúng id + có dữ liệu = đã thêm');
    ok(doc('<!doctype html><html>Đăng nhập</html>') === 'not-batchexecute', 'trang HTML (đã đăng xuất) không phải phản hồi batchexecute');
    ok(doc(envelope([wrb('id-khac', OK_PAYLOAD)])) === 'rpc-id-stale', 'server trả frame cho id KHÁC = id ta gửi đã lỗi thời');
    ok(doc(envelope([er(ID, 'unknown rpcid')])) === 'rpc-id-stale', 'chỉ có frame lỗi = id đã lỗi thời');
    ok(doc(envelope([['di', 27], ['af.httprm', 27, '123', 4]])) === 'rpc-id-stale', 'không frame wrb.fr nào = không có gì trả lời ta');
    ok(doc(envelope([wrb(ID, null)])) === 'empty-payload', 'wrb.fr rỗng = server nhận nhưng không cho kết quả');
    ok(
      I.readEnvelope(envelope([['wrb.fr', ID, '{khong-phai-json', null, null, null, 'generic']]), ID).status === 'unreadable-payload',
      'wrb.fr có dữ liệu không parse được = không đọc nổi kết quả'
    );

    // Frame lỗi mang câu báo giới hạn -> phải nhận ra là limit, không phải id sai.
    ok(doc(envelope([er(ID, 'Source limit reached: 50/50')])) === 'limit', 'câu báo giới hạn phải được nhận ra');

    // ...NHƯNG thành công thắng phép dò chữ. Cùng bài học với `dialogErrorText`:
    // một bộ đếm "Source limit 3/50" lẫn trong phản hồi không được huỷ oan lượt chạy.
    ok(
      doc(envelope([wrb(ID, [['nguon-moi'], 'Source limit 3/50'])])) === 'ok',
      'có dữ liệu trả về thì "source limit" nằm lẫn trong đó KHÔNG được biến thành lỗi giới hạn'
    );

    // Trạng thái lạ phải rơi vào "không biết", không phải "chắc chắn chưa ghi gì":
    // thêm một trạng thái mà quên xếp hạng thì hậu quả phải là chậm, không phải trùng.
    ok(I.outcomeFor('mot-trang-thai-chua-tung-co') === f.R.OUTCOME.UNKNOWN, 'trạng thái lạ mặc định là UNKNOWN');
    ok(I.outcomeFor('rpc-id-stale') === f.R.OUTCOME.NOT_SENT, 'id lỗi thời = chắc chắn chưa ghi gì');
    ok(I.outcomeFor('empty-payload') === f.R.OUTCOME.UNKNOWN, 'server nhận mà không trả gì = không biết');
    ok(I.outcomeFor('ok') === f.R.OUTCOME.ADDED, 'ok = đã thêm');
  }

  /* ================================================================== */
  /* 5. Quyết định rơi xuống DOM                                          */
  /* ================================================================== */

  /** Chạy một ca và trả về những gì quan sát được ở cả hai đường. */
  async function ca(opts) {
    const f = scene(opts);
    const res = await f.A.addTextSource('Tiêu đề X', 'Nội dung Y');
    return { f, res, dom: f.domCalls, fetches: f.calls.length };
  }

  {
    const { res, dom, fetches } = await ca({ settings: { rpcEnabled: false } });
    ok(fetches === 0, `RPC tắt thì KHÔNG được gửi request nào, đã gửi ${fetches}`);
    ok(dom.length === 1 && dom[0].ten === 'addTextSource', `RPC tắt thì chạy thẳng đường DOM, đã gọi: ${JSON.stringify(dom.map((c) => c.ten))}`);
    ok(res.ok === false, 'kết quả phải là kết quả của đường DOM');
  }

  {
    // id lỗi thời -> rơi xuống DOM, và đối số phải đi đúng thứ tự xuống đó.
    const { f, res, dom } = await ca({ plan: [{ body: envelope([wrb('id-google-vua-doi', OK_PAYLOAD)]) }] });
    ok(dom.length === 1 && dom[0].ten === 'addTextSource', 'id lỗi thời phải rơi xuống đường DOM');
    // Đây là chỗ gọi THỨ HAI của cùng cặp (title, text) trong repo — chỗ thứ nhất
    // là router ở content.js. Hoán vị ở đây không chạm payload RPC chút nào.
    ok(dom[0] && dom[0].args[0] === 'Tiêu đề X', `đối số 1 xuống DOM phải là title, nhận: ${JSON.stringify(dom[0] && dom[0].args[0])}`);
    ok(dom[0] && dom[0].args[1] === 'Nội dung Y', `đối số 2 xuống DOM phải là text, nhận: ${JSON.stringify(dom[0] && dom[0].args[1])}`);
    ok(String(res.error).includes('rpc-id-stale'), `đường DOM hỏng thì lý do bỏ RPC phải đi kèm, nhận: ${JSON.stringify(res.error)}`);

    const bao = f.reports()[f.R.REPORT.RPC_UNUSABLE];
    ok(!!bao, 'RPC bật mà không dùng được thì phải ghi bản chụp cho owner');
    // Mọi khoá phải mang đúng nội dung mà tên nó hứa.
    ok(bao && bao.status === 'rpc-id-stale', `khoá 'status' phải là trạng thái, nhận: ${JSON.stringify(bao && bao.status)}`);
    ok(bao && bao.kind === 'text', `khoá 'kind' phải là loại nguồn đang thêm, nhận: ${JSON.stringify(bao && bao.kind)}`);
    ok(bao && bao.atTokenFound === true, `khoá 'atTokenFound' phải nói có tìm ra token hay không, nhận: ${JSON.stringify(bao && bao.atTokenFound)}`);
    ok(bao && bao.atKey === 'SNlM0e', `khoá 'atKey' phải là TÊN khoá đã dùng, nhận: ${JSON.stringify(bao && bao.atKey)}`);
    ok(
      bao && deepEq(bao.tried.map((t) => t.rpcId), f.R.config.addSourceIds),
      `khoá 'tried' phải liệt kê đúng những id đã thử, nhận: ${JSON.stringify(bao && bao.tried)}`
    );
    ok(bao && bao.tried.every((t) => t.status === 'rpc-id-stale'), "mỗi mục trong 'tried' phải mang trạng thái của chính lần thử đó");
  }

  {
    // Đường DOM THÀNH CÔNG thì không được dính thêm chữ của RPC.
    const f = scene({
      plan: [{ body: '<html>đăng nhập</html>' }],
      domStub: async () => ({ ok: true, error: null, limit: false, verified: true }),
    });
    const res = await f.A.addUrlSource('https://example.com/x');
    ok(res.ok === true && res.error === null, `DOM thành công thì kết quả phải sạch, nhận: ${JSON.stringify(res)}`);
  }

  {
    // "Không biết" tuyệt đối KHÔNG được chạy lại đường DOM.
    const { f, res, dom } = await ca({ plan: [{ status: 500 }] });
    ok(dom.length === 0, `HTTP 5xx là "không biết" nên KHÔNG được thử lại bằng DOM, đã gọi: ${JSON.stringify(dom.map((c) => c.ten))}`);
    ok(res.ok === false, 'không đọc được kết quả thì không được báo thành công');
    ok(res.sourceAdded === true, 'phải bật cờ chặn tầng trên thử đường khác (thêm Nguồn không idempotent)');
    ok(!f.reports()[f.R.REPORT.RPC_UNUSABLE], 'ca "không biết" không phải ca RPC-không-dùng-được, đừng ghi nhầm bản chụp');
    // …nhưng cũng KHÔNG được im lặng: đây là lượt duy nhất kết thúc mà owner
    // phải tự mở notebook kiểm, nên nó phải để lại dấu vết ở khoá của riêng nó.
    const bao500 = f.reports()[f.R.REPORT.RPC_UNKNOWN];
    ok(bao500 && bao500.daRoiXuongDom === false, `ca "không biết" phải được ghi vào khoá riêng, nhận: ${JSON.stringify(bao500)}`);
  }

  {
    const { res, dom } = await ca({ plan: [{ status: 400, body: '' }] });
    ok(dom.length === 1, 'HTTP 4xx là "server từ chối trước khi làm gì" nên rơi xuống DOM được');
    ok(res.ok === false, 'kết quả là của đường DOM');
  }

  {
    // Giới hạn 50 nguồn: dừng hẳn, không chạy DOM cho một câu trả lời đã biết.
    const f = scene();
    f.win.fetch = async (u, init) => {
      f.calls.push([u, init]);
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      return { status: 200, text: async () => envelope([er(id, 'Source limit reached')]) };
    };
    const res = await f.A.addUrlSource('https://example.com/x');
    ok(res.limit === true, `câu báo giới hạn phải thành cờ limit, nhận: ${JSON.stringify(res)}`);
    ok(res.ok === false, 'chạm giới hạn không phải thành công');
    ok(f.domCalls.length === 0, 'đã biết là chạm giới hạn thì chạy lại DOM chỉ để nhận đúng câu đó');
  }

  /* ---- câu chữ nhận diện giới hạn phải đến từ ĐÚNG một khoá settings ---- */
  {
    // `selectorOverrides` và `rpcOverrides` là hai object ghi đè cùng kiểu, cùng
    // được `NBLM_SELECTORS.build` tiêu thụ. Lấy nhầm cái nào thì đường DOM và
    // đường RPC nhận diện "đã chạm giới hạn" theo hai danh sách khác nhau — và
    // không có triệu chứng nào cho tới lúc một lượt chạy 89 mục đi tiếp sau khi
    // notebook đã đầy.
    const CUM = 'notebook nay da day nguon';
    const chay = async (settings) => {
      const f = scene({ settings });
      f.win.fetch = async (u, init) => {
        f.calls.push([u, init]);
        const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
        return { status: 200, text: async () => envelope([er(id, 'Notebook nay da day nguon')]) };
      };
      return { res: await f.A.addUrlSource('https://example.com/x'), f };
    };

    const dungCho = await chay({ selectorOverrides: { limitPatterns: [CUM] } });
    ok(dungCho.res.limit === true, `cụm chữ owner thêm ở selectorOverrides phải có tác dụng cho cả đường RPC, nhận: ${JSON.stringify(dungCho.res)}`);
    ok(dungCho.f.domCalls.length === 0, 'đã nhận ra giới hạn thì không chạy lại đường DOM');

    const nhamCho = await chay({ rpcOverrides: { limitPatterns: [CUM] } });
    ok(nhamCho.res.limit !== true, 'cùng cụm chữ đặt ở rpcOverrides thì KHÔNG được có tác dụng — nó không phải khoá của danh sách này');
    ok(nhamCho.f.domCalls.length === 1, 'không nhận ra giới hạn thì đó là ca id lỗi thời, rơi xuống DOM');
  }

  {
    // RPC thành công: không DOM, và nói thẳng là CHƯA xác minh được.
    const f = scene();
    f.win.fetch = async (u, init) => {
      f.calls.push([u, init]);
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
    };
    const res = await f.A.addUrlSource('https://example.com/x');
    ok(res.ok === true, 'RPC trả dữ liệu cho đúng id = đã thêm');
    ok(res.verified === false, '"server nhận lệnh" KHÔNG phải "đã đối chiếu số Nguồn" — không được nhận vơ verified');
    ok(typeof res.unverified === 'string' && res.unverified.length > 0, 'phải nói ra vì sao chưa xác minh được, để popup hiện đúng chữ đó');
    ok(res.sourceAdded === true, 'đã ghi vào notebook thì tầng trên không được thử đường khác');
    ok(res.limit === false, 'thành công thì không phải ca giới hạn');
  }

  /* ---- nhiều ứng viên id: dừng ngay khi một cái ăn ---- */
  {
    const f = scene({ settings: { rpcOverrides: { addSourceIds: ['id-owner-thu-truoc'] } } });
    f.win.fetch = async (u, init) => {
      f.calls.push([u, init]);
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      const body = id === 'id-owner-thu-truoc' ? envelope([er(id, 'unknown rpcid')]) : envelope([wrb(id, OK_PAYLOAD)]);
      return { status: 200, text: async () => body };
    };
    const res = await f.A.addUrlSource('https://example.com/x');
    ok(f.calls.length === 2, `id đầu hỏng thì thử id kế, nhận ${f.calls.length} lời gọi`);
    ok(decode(f.calls[0]).rpcId === 'id-owner-thu-truoc', 'id owner thêm phải được thử trước');
    ok(decode(f.calls[1]).rpcId === f.R.BASE.addSourceIds[0], 'id kế phải là id mặc định');
    ok(res.ok === true, 'id dự phòng ăn thì lượt này vẫn thành công');
    ok(f.domCalls.length === 0, 'đã thành công bằng RPC thì không rơi xuống DOM');
  }

  {
    const f = scene({ settings: { rpcOverrides: { addSourceIds: ['id-owner-thu-truoc'] } } });
    f.win.fetch = async (u, init) => {
      f.calls.push([u, init]);
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
    };
    await f.A.addUrlSource('https://example.com/x');
    ok(f.calls.length === 1, `id đầu đã ăn thì DỪNG, không được gửi tiếp id nào (mỗi lần gửi thêm là một bản trùng), nhận ${f.calls.length}`);
  }

  /* ---- không ở trong notebook nào thì không gửi gì ---- */
  {
    const f = scene({ plan: [{ body: envelope([]) }] });
    const I = f.R._internals;
    ok(I.notebookIdFrom('/notebook/abc123') === 'abc123', 'đọc id notebook từ đường dẫn');
    ok(I.notebookIdFrom('/') === null, 'trang danh sách không có id notebook');
    const attempt = await f.R.tryRpc({ kind: 'url', url: 'https://example.com/x' }, { pathname: '/' });
    ok(attempt.status === 'no-notebook-id', `không có id notebook thì dừng trước khi gửi, nhận: ${attempt.status}`);
    ok(f.calls.length === 0, 'và không gửi request nào');
  }

  /* ================================================================== */
  /* 6. `_reqid` phải khác nhau giữa các lượt                             */
  /* ================================================================== */
  {
    const f = scene({ plan: [{ body: envelope([]) }] });
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(f.R._internals.newReqId());
    ok(ids.size > 40, `_reqid phải lấy từ nguồn ngẫu nhiên chứ không phải hằng số, 50 lần cho ${ids.size} giá trị khác nhau`);

    await f.A.addUrlSource('https://example.com/a');
    await f.A.addUrlSource('https://example.com/b');
    ok(
      decode(f.calls[0]).query.get('_reqid') !== decode(f.calls[1]).query.get('_reqid'),
      'hai lượt liên tiếp không được mang cùng một _reqid'
    );
  }

  /* ================================================================== */
  /* 11. Bộ khung `args`: mọi ô đi đúng chỗ bản mô tả nói                 */
  /* ================================================================== */
  {
    const f = scene({ plan: [(u, init) => {
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
    }] });
    await f.A.addUrlSource('https://example.com/khung');

    const d = decode(f.calls[0]);
    const cfg = f.R.config;

    // ĐƯỜNG DỮ LIỆU SONG SONG. Id notebook chảy vào HAI chỗ của cùng một
    // request: query `source-path` và ô `notebookId` của `args`. Assert riêng lẻ
    // từng chỗ vẫn xanh khi hai chỗ mang hai id khác nhau — mà đó đúng là ca
    // hỏng thật: server ghi vào notebook này còn ta tưởng ghi vào notebook kia.
    const trongUrl = String(d.query.get('source-path') || '').split('/notebook/')[1];
    const trongParams = d.params[oCua(cfg, 'notebookId')];
    ok(typeof trongParams === 'string' && trongParams.length > 0,
      `id notebook phải nằm TRONG args, không chỉ ở query, nhận: ${JSON.stringify(trongParams)}`);
    ok(trongParams === trongUrl,
      `id notebook ở params và ở query phải là MỘT, nhận params=${JSON.stringify(trongParams)} query=${JSON.stringify(trongUrl)}`);
    ok(trongParams === f.win.location.pathname.split('/notebook/')[1],
      'id notebook phải lấy từ đường dẫn trang đang mở');

    // Bọc ĐÚNG SỐ LỚP mà bản mô tả khai — không phải "đúng hai lớp". Mỗi lớp
    // phải là mảng một phần tử: ta gửi đúng một nguồn mỗi lượt, nên bất kỳ lớp
    // nào dài hơn 1 là đã nhét thừa thứ gì đó vào lô.
    {
      const i = oCua(cfg, 'sources');
      const lop = Number(cfg.argsShape[i].boc) || 0;
      let v = d.params[i];
      for (let k = 0; k < lop; k++) {
        ok(Array.isArray(v) && v.length === 1,
          `lớp bọc thứ ${k + 1}/${lop} phải là mảng một phần tử, nhận: ${JSON.stringify(v)}`);
        v = Array.isArray(v) ? v[0] : null;
      }
      ok(Array.isArray(v), `sau ${lop} lớp bọc phải là mảng spec, nhận: ${JSON.stringify(v)}`);
    }

    const spec = specOf(d.params, cfg);
    ok(spec.length === cfg.specLength, `spec phải đủ ${cfg.specLength} ô, nhận: ${spec.length}`);
    for (const k of Object.keys(cfg.specConstants)) {
      ok(spec[Number(k)] === cfg.specConstants[k],
        `ô hằng số ${k} phải mang đúng giá trị cố định, nhận: ${JSON.stringify(spec[Number(k)])}`);
    }

    // Ô hằng số hiện nằm đúng ở ô cuối, nên spec tình cờ đủ dài mà KHÔNG cần
    // chèn thêm ô nào — phép chèn trong `buildSpec` chỉ có việc thật khi spec
    // phải dài hơn ô hằng số cuối. Ca đó có thật: Google thêm ô ở đuôi, owner
    // nâng `specLength` mà không có giá trị mới nào để điền vào.
    {
      const DAI = cfg.specLength + 2;
      const h = scene({ settings: { rpcOverrides: { specLength: DAI } }, plan: [(u, init) => {
        const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
        return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
      }] });
      await h.A.addUrlSource('https://example.com/dai-hon');
      const hs = specOf(decode(h.calls[0]).params, h.R.config);
      ok(hs.length === DAI, `owner nâng specLength thì spec phải dài đúng ${DAI} ô, nhận: ${hs.length}`);
      ok(hs.every((v) => v !== undefined), 'ô chèn thêm phải là null, không phải lỗ trống');
    }

    // Mọi ô hằng số đi nguyên vẹn, ở đúng ô của nó — bao nhiêu ô cũng được.
    cfg.argsShape.forEach((o, i) => {
      if (!o || !Object.prototype.hasOwnProperty.call(o, 'hang')) return;
      ok(deepEq(d.params[i], o.hang),
        `ô hằng số thứ ${i} phải đi nguyên vẹn, nhận: ${JSON.stringify(d.params[i])}`);
    });

    ok(d.params.length === cfg.argsShape.length,
      `args phải có đúng số ô bản mô tả khai (${cfg.argsShape.length}), nhận: ${d.params.length}`);
    // Không ô nào bị bỏ trống thành `undefined`: JSON.stringify nuốt mất lỗ ở
    // đuôi, và server đọc theo vị trí.
    ok(d.params.every((v) => v !== undefined), 'args không được có ô undefined');
  }

  /* ================================================================== */
  /* 12. `argsShape` được THAY nguyên khối, và thực sự đổi được request   */
  /* ================================================================== */
  {
    const echo = (u, init) => {
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      return { status: 200, text: async () => envelope([wrb(id, OK_PAYLOAD)]) };
    };

    // Biến thể `notebooklm-py`: 3 ô, nguồn bọc ĐÔI. Bản mặc định là biến thể của
    // extension 1.5.4: 4 ô, bọc ĐƠN. Hai oracle mâu thuẫn đúng chỗ này, nên điều
    // repo phải bảo đảm KHÔNG phải "hình dạng nào đúng" — mà là owner đổi được
    // sang hình dạng kia mà không cần bản mới, và đổi xong request đổi theo thật.
    const BA_O = [
      { dat: 'sources', boc: 2 },
      { dat: 'notebookId' },
      { hang: [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]] },
    ];

    const f = scene({ settings: { rpcOverrides: { argsShape: BA_O } }, plan: [echo] });
    await f.A.addUrlSource('https://example.com/bien-the-kia');
    const cfg = f.R.config;

    ok(deepEq(cfg.argsShape, BA_O),
      `ghi đè argsShape phải THAY nguyên khối, nhận: ${JSON.stringify(cfg.argsShape)}`);
    ok(cfg.argsShape.length === BA_O.length,
      `bản mô tả bị nối dài ra thay vì bị thay: ${cfg.argsShape.length} ô`);

    const d = decode(f.calls[0]);
    ok(d.params.length === BA_O.length,
      `request phải đi theo bản mô tả của owner (${BA_O.length} ô), nhận: ${d.params.length}`);
    // Bọc đôi thật sự: hai lớp mảng rồi mới tới spec.
    ok(Array.isArray(d.params[0]) && Array.isArray(d.params[0][0]) && Array.isArray(d.params[0][0][0]),
      `nguồn phải bọc đúng 2 lớp như owner khai, nhận: ${JSON.stringify(d.params[0])}`);
    ok(deepEq(d.params[2], BA_O[2].hang), 'khối hằng số của owner phải là khối thực sự gửi đi');
    // Và spec bên trong vẫn nguyên vẹn — đổi cách nhóm không được làm hỏng nội dung.
    const spec = specOf(d.params, cfg);
    ok(spec.length === cfg.specLength && deepEq(spec[cfg.slots.url], ['https://example.com/bien-the-kia']),
      `đổi cách nhóm không được đụng tới nội dung spec, nhận: ${JSON.stringify(spec)}`);

    // Đối chứng ngược: bản mặc định phải KHÁC bản vừa ghi đè. Thiếu vế này thì
    // cả khối trên vẫn xanh kể cả khi `configure` bỏ qua ghi đè và hai bên trùng nhau.
    const m = scene({ plan: [echo] });
    await m.A.addUrlSource('https://example.com/mac-dinh');
    ok(decode(m.calls[0]).params.length !== d.params.length,
      'bản mặc định và bản owner ghi đè phải cho ra hai hình dạng KHÁC nhau');

    // Đối chứng: `addSourceIds` vẫn theo luật GỘP THÊM. Hai khoá cùng nằm trong
    // một object override mà đi hai luật khác nhau — nếu ai đó gỡ ngoại lệ ở
    // `configure`, chỉ vế trên đổ, còn vế này vẫn xanh và chỉ đúng chỗ sai.
    const g = scene({ settings: { rpcOverrides: { addSourceIds: ['id-cua-owner'] } } });
    await g.A.addUrlSource('https://example.com/doi-chung').catch(() => {}); // để settings kịp nạp
    ok(g.R.config.addSourceIds.length > 1 && g.R.config.addSourceIds[0] === 'id-cua-owner',
      `addSourceIds phải gộp thêm và ưu tiên id owner, nhận: ${JSON.stringify(g.R.config.addSourceIds)}`);
  }

  /* ================================================================== */
  /* 13. Thứ tự id: `unknown` phải DỪNG, `not-sent` mới được thử tiếp      */
  /* ================================================================== */
  {
    // Vì sao thứ tự trong `addSourceIds` quan trọng: id đầu mà trả về một frame
    // khớp nhưng rỗng thì ta KHÔNG biết server đã ghi hay chưa, nên không được
    // thử id sau — thử tiếp là nguy cơ hai Nguồn trùng. Đây là hợp đồng của ta,
    // không phải hằng số của Google, nên nó ghim được.
    const f = scene({ settings: { rpcOverrides: { addSourceIds: ['id-thu-nhat'] } }, plan: [(u, init) => {
      const id = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][0];
      return { status: 200, text: async () => envelope([wrb(id, null)]) };
    }] });
    const res = await f.A.addUrlSource('https://example.com/rong');

    ok(f.calls.length === 1, `frame rỗng thì DỪNG ở id đầu, không thử id sau, nhận ${f.calls.length} lời gọi`);
    ok(res.ok === false && res.sourceAdded === true,
      'frame rỗng cho kết quả "không chạy lại bằng đường nào nữa"');
    ok(f.domCalls.length === 0, 'và cũng không rơi xuống đường DOM');

    // Đối chứng: id KHÔNG khớp thì được thử tiếp, vì lúc đó chắc chắn chưa ghi gì.
    const g = scene({ settings: { rpcOverrides: { addSourceIds: ['id-la-mot', 'id-la-hai'] } }, plan: [
      { status: 200, body: envelope([wrb('id-cua-server-khac', OK_PAYLOAD)]) },
    ] });
    await g.A.addUrlSource('https://example.com/lac').catch(() => {});
    ok(g.calls.length > 1, `id không khớp thì phải thử ứng viên kế tiếp, nhận ${g.calls.length} lời gọi`);
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
