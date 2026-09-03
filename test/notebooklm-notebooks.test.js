/*
 * Hai lượt đứng ở GỐC notebooklm.google.com: liệt kê notebook (`listNotebooks`)
 * và tạo notebook (`createNotebook`). Ticket `docs/tickets/011-*.md`.
 *
 * Cùng một kỷ luật với `test/notebooklm-rpc.test.js`, và vì cùng một lý do:
 * KHÔNG ghim rpc id, KHÔNG ghim `source-path`, KHÔNG gõ tay ô số. Tất cả đọc
 * lại từ `NBLM_RPC.config` — hằng số ngoại sinh đổi thì test vẫn nói đúng một
 * chuyện, và một assertion gõ tay `'wXbhsf'` sẽ xanh vĩnh viễn sau khi Google
 * xoay id.
 *
 * Cái test này LÀM: sự tương ứng hai đầu. Ô nào trong bản mô tả thì lấy ra
 * trường nào; `source-path` thật sự gửi đi có đúng cái bản mô tả nói không;
 * phản hồi hình dạng nào thì đi nhánh nào; và — quan trọng nhất — nhánh hỏng
 * nào thì TUYỆT ĐỐI không được đụng tới thứ owner đã gõ tay.
 */
const { loadFixture } = require('./dom-harness.js');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

const AT = 'AFcWxH0abcdefgHIJKLmnop:1756000000000';
const wizScript = (v) => `<script nonce="abc">window.WIZ_global_data = ${JSON.stringify(v)};</script>`;
const envelope = (frames) => {
  const json = JSON.stringify(frames);
  return `)]}'\n\n${json.length}\n${json}\n`;
};
const wrb = (rpcId, payload) => ['wrb.fr', rpcId, payload === null ? null : JSON.stringify(payload), null, null, null, 'generic'];

/** jsdom + rpc.js + fetch giả. `rpcEnabled` để MẶC ĐỊNH (tắt) — xem khẳng định (a). */
function scene({ plan, wiz, settings } = {}) {
  const values = wiz === undefined ? { cfb2h: 'boq_x', SNlM0e: AT, qwAQke: 'LabsTailwind' } : wiz;
  const f = loadFixture('', values ? wizScript(values) : '', {
    withRpc: true,
    settings: settings || {},
  });
  const calls = [];
  const queue = (plan || []).slice();
  f.win.fetch = async (url, init) => {
    calls.push([url, init]);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) throw new TypeError('Failed to fetch');
    return { status: next.status == null ? 200 : next.status, text: async () => next.body || '' };
  };
  f.calls = calls;
  return f;
}

const decode = (call) => {
  const [url, init] = call;
  const body = new URLSearchParams(init.body);
  const freq = JSON.parse(body.get('f.req'));
  return {
    query: new URLSearchParams(url.slice(url.indexOf('?') + 1)),
    rpcId: freq[0][0][0],
    params: JSON.parse(freq[0][0][1]),
    at: body.get('at'),
    raw: `${url} ${init.body}`,
  };
};

(async () => {
  /* ================================================================ */
  /* liệt kê                                                           */
  /* ================================================================ */

  {
    const f = scene({ plan: [] });
    const cfg = f.win.NBLM_RPC.config;
    const E = cfg.listNotebooks;

    // Hai chuỗi KHÁC HẲN NHAU. Id trùng tiêu đề thì hoán vị hai ô xanh cả hai
    // chiều — đúng bẫy `duong-du-lieu-song-song`.
    const ID = 'nb-id-1234567890';
    const TITLE = 'Notebook nghien cuu cua toi';
    const row = [];
    row[E.slots.id] = ID;
    row[E.slots.title] = TITLE;

    f.win.fetch = async (url, init) => {
      f.calls.push([url, init]);
      return { status: 200, text: async () => envelope([wrb(E.rpcId, [[row]])]) };
    };

    const r = await f.win.NBLM_RPC.listNotebooks();
    ok(r.ok === true, 'liệt kê: phản hồi đọc được thì ok');
    ok(r.notebooks.length === 1, `liệt kê: đúng 1 notebook, nhận ${r.notebooks.length}`);
    ok(r.notebooks[0] && r.notebooks[0].id === ID, 'liệt kê: `id` lấy từ đúng ô mà cấu hình khai');
    ok(r.notebooks[0] && r.notebooks[0].title === TITLE, 'liệt kê: `title` lấy từ đúng ô mà cấu hình khai');

    const c = decode(f.calls[0]);
    ok(c.rpcId === E.rpcId, 'liệt kê: gửi đúng rpc id trong cấu hình');
    ok(c.query.get('source-path') === E.sourcePath,
      `liệt kê: source-path gửi đi là "${c.query.get('source-path')}", cấu hình nói "${E.sourcePath}"`);
    /*
     * Khẳng định trên đọc cấu hình ở CẢ HAI VẾ, nên đổi cấu hình thì nó đi
     * theo — nó chứng nhận "gửi đúng thứ mình khai", không hơn. Cái dưới đây
     * mới ghim được tiền đề thiết kế: hai lượt gốc phải đứng ở GỐC. Mất tính
     * chất đó là mất luôn lý do dropdown chạy được từ một tab bất kỳ.
     */
    ok(!String(c.query.get('source-path')).includes('/notebook/'),
      'liệt kê: source-path KHÔNG được là đường notebook — nếu không thì phải đứng trong một notebook mới liệt kê được');
    ok(JSON.stringify(c.params) === JSON.stringify(E.args), 'liệt kê: args gửi đi đúng bản mô tả');
    ok(!c.raw.includes(AT.split(':')[0]) || c.at === AT, 'liệt kê: token chỉ nằm ở trường `at`');
  }

  {
    // (a) Ràng buộc quan trọng nhất của lượt đọc: KHÔNG gắn sau `rpcEnabled`.
    // `scene` để settings mặc định, tức `rpcEnabled` tắt.
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.listNotebooks;
    f.win.fetch = async (url, init) => {
      f.calls.push([url, init]);
      return { status: 200, text: async () => envelope([wrb(E.rpcId, [[]])]) };
    };
    const r = await f.win.NBLM_RPC.listNotebooks();
    ok(f.win.NBLM_RPC.enabled === false, '(a) bối cảnh: `rpcEnabled` đang TẮT');
    ok(f.calls.length === 1, '(a) liệt kê vẫn chạy khi `rpcEnabled` tắt — nó chỉ đọc');
    ok(r.ok === true && r.notebooks.length === 0,
      '(a) tài khoản không có notebook nào là ok:true + mảng rỗng, KHÔNG phải lỗi');
  }

  {
    /*
     * Đọc NHẦM Ô — ca mà một assertion không bắt được.
     *
     * `slots.id` và `slots.title` cùng kiểu, cùng mảng. Mọi fixture đều phải
     * dựng theo `slots`, nên đảo hai ô thì fixture đảo theo và assertion xanh
     * cả hai chiều (đo thật: hoán vị đó cho 36 pass / 0 fail). Cái bắt được nó
     * là `idPattern` — một cơ chế phát hiện LÚC CHẠY, không phải một assert.
     *
     * Ở đây ta dựng thẳng một dòng mà ô `id` mang một TIÊU ĐỀ (có khoảng
     * trắng), và đòi nó bị bỏ.
     *
     * NÓI THẲNG GIỚI HẠN, vì nó là kết quả của một phép đo chứ không phải một
     * chỗ chưa làm xong: **hoán vị `slots.id` ↔ `slots.title` KHÔNG đỏ được ở
     * bất kỳ test nào trong file này, và cũng không đỏ được ở bất kỳ file nào
     * khác.** Lý do là cấu trúc, không phải sơ suất: `slots` ĐỊNH NGHĨA nghĩa
     * của hai ô, nên mọi fixture đều phải dựng theo nó, và hai vế đảo cùng
     * nhau. Muốn nó đỏ thì phải gõ tay một con số ô — tức chứng nhận một hằng
     * số ngoại sinh mà chỉ `tools/probe-notebooklm.mjs` mới đo được.
     *
     * Cái đứng thay không phải một assertion mà là hậu quả LÚC CHẠY: đọc nhầm
     * ô thì `idPattern` bỏ dòng đó, dropdown rỗng, `notebookUrl` không đổi. Và
     * chính cơ chế ấy thì test được — bốn khẳng định `idPattern` bên dưới đỏ
     * khi ta làm hỏng nó (đo: nhận-tất → 4 đỏ; mẫu-hỏng-thì-nhận → 1 đỏ).
     */
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.listNotebooks;
    const row = [];
    row[E.slots.id] = 'Ten notebook co khoang trang';
    row[E.slots.title] = 'nb-id-1234567890';
    f.win.fetch = async () => ({ status: 200, text: async () => envelope([wrb(E.rpcId, [[row]])]) });
    const r = await f.win.NBLM_RPC.listNotebooks();
    ok(r.ok === true, 'đọc nhầm ô: vẫn ok:true — với tới backend được');
    ok(r.notebooks.length === 0,
      'đọc nhầm ô: dòng có "id" là một cái tên phải bị BỎ, không được đi vào dropdown');

    const L = f.win.NBLM_RPC._internals.looksLikeNotebookId;
    ok(L('nb-id-1234567890', E) === true, 'idPattern: nhận một id thật');
    ok(L('Ten notebook co khoang trang', E) === false, 'idPattern: từ chối một cái tên');
    ok(L('a/b/c12345', E) === false, 'idPattern: từ chối chuỗi có dấu gạch chéo');
    ok(L('abc', E) === false, 'idPattern: từ chối chuỗi quá ngắn');
    ok(L('x', { idPattern: '' }) === false, 'idPattern rỗng thì TỪ CHỐI TẤT, không phải nhận tất');
  }

  {
    // Không có token → không được gửi gì cả, và không được ném.
    const f = scene({ plan: [], wiz: null });
    const r = await f.win.NBLM_RPC.listNotebooks();
    ok(f.calls.length === 0, 'không có token thì KHÔNG phát request nào');
    ok(r.ok === false && r.notebooks.length === 0, 'không có token: ok:false, danh sách rỗng, không ném');
  }

  {
    // Frame của rpc id KHÁC → không được nhận nhầm thành danh sách.
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.listNotebooks;
    f.win.fetch = async () => ({ status: 200, text: async () => envelope([wrb('id-khac-hoan-toan', [[['x', null, 'y']]])]) });
    const r = await f.win.NBLM_RPC.listNotebooks();
    ok(r.ok === false && r.notebooks.length === 0,
      'frame mang rpc id khác thì không được đọc thành danh sách');
    ok(E.rpcId !== 'id-khac-hoan-toan', 'bối cảnh: hai id thật sự khác nhau');
  }

  /* ================================================================ */
  /* tạo                                                               */
  /* ================================================================ */

  {
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.createNotebook;
    const TITLE = 'Ten do owner go vao';
    const NEW_ID = 'nb-vua-tao-0987654321';

    // Dựng payload theo ĐÚNG đường đầu tiên mà cấu hình khai, không gõ tay.
    const payload = [];
    let cur = payload;
    const p0 = E.idPaths[0];
    for (let i = 0; i < p0.length - 1; i++) {
      cur[p0[i]] = [];
      cur = cur[p0[i]];
    }
    cur[p0[p0.length - 1]] = NEW_ID;

    f.win.fetch = async (url, init) => {
      f.calls.push([url, init]);
      return { status: 200, text: async () => envelope([wrb(E.rpcId, payload)]) };
    };

    const r = await f.win.NBLM_RPC.createNotebook(TITLE);
    ok(r.ok === true, 'tạo: payload đọc được thì ok');
    ok(r.notebookId === NEW_ID, 'tạo: trả về ID SERVER CẤP, không phải tên owner gõ');
    ok(r.notebookId !== TITLE, 'tạo: id và tiêu đề không bị đảo cho nhau');

    const c = decode(f.calls[0]);
    ok(c.rpcId === E.rpcId, 'tạo: gửi đúng rpc id trong cấu hình');
    ok(c.query.get('source-path') === E.sourcePath, 'tạo: source-path đúng bản mô tả');
    ok(!String(c.query.get('source-path')).includes('/notebook/'),
      'tạo: source-path KHÔNG được là đường notebook — lượt tạo không đứng trong notebook nào');
    ok(c.params[E.titleSlot] === TITLE, 'tạo: tiêu đề vào đúng ô mà cấu hình khai');
    ok(JSON.stringify(f.win.NBLM_RPC.config.createNotebook.args[E.titleSlot]) === 'null',
      'tạo: bản mô tả trong `config` KHÔNG bị ghi đè bởi lượt vừa rồi');
  }

  {
    // Ca hỏng tệ nhất của Chốt 3: chạm trần quota. Payload rỗng KHÔNG phải lỗi
    // parse, và tuyệt đối không được moi ra một id.
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.createNotebook;
    f.win.fetch = async (url, init) => {
      f.calls.push([url, init]);
      return { status: 200, text: async () => envelope([wrb(E.rpcId, null)]) };
    };
    const r = await f.win.NBLM_RPC.createNotebook('Ten gi do');
    ok(r.ok === false, 'chạm trần: KHÔNG được báo thành công');
    ok(r.limit === true, 'chạm trần: có cờ `limit` riêng, không lẫn vào lỗi chung');
    ok(r.notebookId === null, 'chạm trần: notebookId là null, KHÔNG phải undefined lọt ra ngoài');
    ok(typeof r.notebookId !== 'undefined', 'chạm trần: không trả undefined — bên gọi sẽ ghi nó vào settings');
  }

  {
    // Tên rỗng: dừng TRƯỚC khi gửi. Không tự đặt tên.
    const f = scene({ plan: [] });
    for (const bad of ['', '   ', null, undefined]) {
      const r = await f.win.NBLM_RPC.createNotebook(bad);
      ok(r.ok === false && r.status === 'no-title', `tên rỗng (${JSON.stringify(bad)}): từ chối, không tự đặt tên`);
    }
    ok(f.calls.length === 0, 'tên rỗng: KHÔNG phát request nào — không có notebook rác nào được tạo');
  }

  {
    // Server trả frame đúng id nhưng không có id đọc được. Notebook CÓ THỂ đã
    // được tạo — câu trả lời phải khác "chưa tạo gì", vì hai câu dẫn tới hai
    // hành động khác nhau của owner.
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.createNotebook;
    f.win.fetch = async () => ({ status: 200, text: async () => envelope([wrb(E.rpcId, [12345])]) });
    const r = await f.win.NBLM_RPC.createNotebook('Ten gi do');
    ok(r.ok === false, 'không đọc được id: không báo thành công');
    ok(r.status === 'created-but-no-id', 'không đọc được id: có trạng thái RIÊNG, không lẫn với "chưa gửi được"');
    ok(r.notebookId === null, 'không đọc được id: notebookId null');
  }

  {
    // Không có token → không gửi, không tạo gì.
    const f = scene({ plan: [], wiz: null });
    const r = await f.win.NBLM_RPC.createNotebook('Ten gi do');
    ok(f.calls.length === 0, 'tạo: không có token thì KHÔNG phát request nào');
    ok(r.ok === false && r.notebookId === null, 'tạo: không có token thì không báo thành công');
  }

  /* ---------------------------------------------------------------- */
  /* `authuser` — ticket 013                                            */
  /* ---------------------------------------------------------------- */

  {
    // Đường CŨ (content script, đọc token từ tab): KHÔNG được kèm authuser.
    // Token là của tài khoản cái tab đang đứng; gắn thêm một authuser do người
    // khác chọn là đúng ca ghi vào nhầm tài khoản mà ticket 013 tồn tại để chặn.
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.listNotebooks;
    f.win.fetch = async (u, i) => (f.calls.push([u, i]), { status: 200, text: async () => envelope([wrb(E.rpcId, [[]])]) });
    await f.win.NBLM_RPC.listNotebooks({ authuser: '7' });
    const url = String(f.calls[0][0]);
    ok(
      !url.includes('authuser'),
      'không truyền `at` thì authuser bị BỎ QUA — token của tab không đi kèm authuser của người khác'
    );
    ok((f.calls[0][1] || {}).credentials === 'same-origin', 'đường content script giữ credentials hẹp');
  }

  {
    // Đường MỚI (service worker): `at` và `authuser` đi cùng nhau, hoặc không đi.
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.listNotebooks;
    f.win.fetch = async (u, i) => (f.calls.push([u, i]), { status: 200, text: async () => envelope([wrb(E.rpcId, [[]])]) });
    await f.win.NBLM_RPC.listNotebooks({
      at: 'TOKEN-NGOAI', authuser: '2', origin: 'https://notebooklm.google.com', credentials: 'include',
    });
    const [url, init] = f.calls[0];
    const q = new URL(String(url)).searchParams;
    ok(q.get('authuser') === '2', 'truyền `at` kèm authuser thì authuser vào URL');
    ok(String(init.body).includes(encodeURIComponent('TOKEN-NGOAI')), 'token truyền vào là token được gửi');
    ok(init.credentials === 'include', 'service worker gọi cross-origin thì phải include');
    ok(String(url).startsWith('https://notebooklm.google.com/'), 'origin tường minh cho URL tuyệt đối');
  }

  {
    // authuser rỗng/null không được biến thành chuỗi "null" trong URL.
    const f = scene({ plan: [] });
    const E = f.win.NBLM_RPC.config.listNotebooks;
    f.win.fetch = async (u, i) => (f.calls.push([u, i]), { status: 200, text: async () => envelope([wrb(E.rpcId, [[]])]) });
    await f.win.NBLM_RPC.listNotebooks({ at: 'T', authuser: null });
    ok(!String(f.calls[0][0]).includes('authuser'), 'authuser null → không có tham số, không phải "null"');
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
