/*
 * Tài khoản Google + ngữ cảnh RPC. Ticket `docs/tickets/013-*.md`.
 *
 * Câu hỏi trung tâm của file này chỉ có một, và nó KHÔNG phải "code có chạy
 * không": **token `at` có bao giờ đi kèm một `authuser` không phải của nó
 * không?** Mọi thứ khác ở đây là phần phụ.
 *
 * Kỷ luật giống `notebooklm-notebooks.test.js`: không gõ tay ô số, không ghim
 * URL endpoint, không ghim TTL. Đọc lại từ `NBLM_ACCOUNTS.config` — hằng số
 * ngoại sinh đổi thì test vẫn nói đúng một chuyện.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/common/google-accounts.js'), 'utf8');

/** Bộ nhớ `chrome.storage.local` giả, đủ dùng cho get/set/remove. */
function fakeStore(init) {
  const data = { ...(init || {}) };
  return {
    data,
    async get(k) { return k in data ? { [k]: data[k] } : {}; },
    async set(o) { Object.assign(data, o); },
    async remove(k) { delete data[k]; },
  };
}

/** Nạp module vào một ngữ cảnh sạch. `URL`/`URLSearchParams` KHÔNG mặc định có. */
function load() {
  const ctx = { console, setTimeout, clearTimeout, URL, URLSearchParams, AbortController, Promise };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.NBLM_ACCOUNTS._internals.resetMemo();
  return ctx.NBLM_ACCOUNTS;
}

const res = (body, okFlag) => ({ ok: okFlag !== false, status: okFlag === false ? 500 : 200, text: async () => body });

/* ------------------------------------------------------------------ */
/* 1. ListAccounts — sự tương ứng ô ↔ trường, đọc từ config             */
/* ------------------------------------------------------------------ */
{
  const A = load();
  const s = A.config.accountSlots;

  /* Dựng một hàng theo ĐÚNG bản mô tả, không gõ tay vị trí. Hai giá trị cố ý
     khác nhau rõ rệt: một cái có `@`, một cái không — đó là thứ làm phép đảo
     ô có thể đỏ, khác hẳn ca `slots.id`/`slots.title` của ticket 011. */
  const row = [];
  row[s.marker] = A.config.accountMarker;
  row[s.name] = 'Nguyen Van A';
  row[s.email] = 'Nguoi.Dung@Gmail.com';
  row[s.isDefault] = 1;
  row[s.index] = 3;

  const body = ")]}'\n" + JSON.stringify([['wrapper', [row]]]);
  const calls = [];
  A.detectAccounts({ fetch: async (u, i) => (calls.push([u, i]), res(body)) }).then((r) => {
    ok(r.ok === true, 'detectAccounts: phản hồi đọc được thì ok');
    ok(r.accounts.length === 1, 'detectAccounts: nhặt đúng một tài khoản (đệ quy qua lớp bọc)');
    const a = r.accounts[0];
    ok(a.email === 'nguoi.dung@gmail.com', 'email lấy từ ô email VÀ hạ về chữ thường');
    ok(a.name === 'Nguyen Van A', 'name lấy từ ô name, không phải ô email');
    ok(a.index === 3, 'index lấy từ ô index — đây là giá trị sẽ thành `authuser`');
    ok(a.isDefault === true, 'isDefault đọc từ ô isDefault');

    /* Không ghim URL, chỉ ghim những gì PHẢI đúng dù URL đổi thế nào. */
    ok(calls[0][0] === A.config.listUrl, 'gọi đúng endpoint đang cấu hình');
    ok(calls[0][1].credentials === 'include', 'phải include: cookie phiên là thứ duy nhất xác thực');
    ok(
      !String(calls[0][0]).includes('notebooklm'),
      'ListAccounts KHÔNG đi tới notebooklm — origin khác, và đó là điều ticket phải nói ra'
    );
  });
}

/* ------------------------------------------------------------------ */
/* 2. Phép dò lúc chạy thay cho một assertion ghim ô                    */
/* ------------------------------------------------------------------ */
{
  const A = load();
  const s = A.config.accountSlots;
  const mk = (name, email) => {
    const r = [];
    r[s.marker] = A.config.accountMarker;
    r[s.name] = name;
    r[s.email] = email;
    r[s.index] = 0;
    return r;
  };
  const body = JSON.stringify([[mk('Khong Co Cham A', 'that@gmail.com')]]);
  A.detectAccounts({ fetch: async () => res(body) }).then((r) => {
    ok(r.accounts.length === 1, 'hàng có email thật thì nhận');
  });

  /* Ô email mang một cái TÊN — đúng thứ xảy ra khi hai ô bị đảo. Phải bị từ
     chối, chứ không được biến một cái tên thành `authuser` của ai đó. */
  const xau = JSON.stringify([[mk('that@gmail.com', 'Khong Co Cham A')]]);
  A.detectAccounts({ fetch: async () => res(xau) }).then((r) => {
    ok(r.accounts.length === 0, 'ô email mang chuỗi không phải email thì LOẠI (đảo ô bị bắt ở đây)');
  });

  /* Ô `index` — phép dò THỨ HAI, cho ô thứ hai. Nó một mình quyết định
     `authuser`, nên đọc nhầm ô này là ghi vào nhầm tài khoản. Bản trước lùi về
     vị trí trong mảng, tức bịa ra một ánh xạ email→tài khoản mà `usable()`
     không thể bắt (nó chỉ so con số với con số). */
  const mkIdx = (email, idx) => {
    const r = mk('Chu So Huu', email);
    if (idx === undefined) delete r[s.index];
    else r[s.index] = idx;
    return r;
  };
  const chayIdx = (rows, msg, muon) =>
    A.detectAccounts({ fetch: async () => res(JSON.stringify([rows])) }).then((r) => {
      ok(r.accounts.length === muon, `${msg} — mong ${muon}, nhận ${r.accounts.length}`);
    });

  chayIdx([mkIdx('a@gmail.com', 1)], 'ô index là số nguyên thì nhận', 1);
  chayIdx([mkIdx('a@gmail.com', 0)], 'index 0 hợp lệ (tài khoản mặc định)', 1);
  /* Ba hình dạng "ô đã dịch chỗ". KHÔNG hàng nào được lùi về vị trí mảng —
     hai hàng dưới đây nằm ở vị trí 0 và 1, đúng thứ cú lùi cũ sẽ trả về. */
  chayIdx([mkIdx('a@gmail.com', '1')], 'index là chuỗi số thì LOẠI, không ép kiểu', 0);
  chayIdx([mkIdx('a@gmail.com', undefined)], 'thiếu ô index thì LOẠI, không lùi về vị trí mảng', 0);
  chayIdx([mkIdx('a@gmail.com', 1.5)], 'index không nguyên thì LOẠI', 0);
  chayIdx([mkIdx('a@gmail.com', -1)], 'index âm thì LOẠI', 0);
  /* Và loại từng hàng một, chứ không phải cả mảng: hàng lành vẫn phải sống. */
  chayIdx([mkIdx('hong@gmail.com', undefined), mkIdx('lanh@gmail.com', 2)],
    'hàng hỏng bị bỏ, hàng lành vẫn nhận', 1);

  ok(A._internals.looksLikeEmail('a@b.co', A.config) === true, 'looksLikeEmail: nhận email');
  ok(A._internals.looksLikeEmail('Nguyen Van A', A.config) === false, 'looksLikeEmail: loại tên người');
  ok(
    A._internals.looksLikeEmail('a@b.co', { emailPattern: '(' }) === false,
    'mẫu hỏng thì TỪ CHỐI TẤT, không phải nhận tất'
  );
  ok(
    A._internals.looksLikeEmail('a@b.co', {}) === false,
    'thiếu mẫu thì cũng từ chối tất'
  );
}

/* ------------------------------------------------------------------ */
/* 3. TRỌNG TÂM — token không bao giờ rời `authuser` của nó             */
/* ------------------------------------------------------------------ */
{
  const A = load();
  const store = fakeStore();
  const html = (t) => `<script>window.WIZ={"SNlM0e":"${t}","cfb2h":"boq_7"};</script>`;
  const seen = [];
  const fetchFor = (token) => async (u) => (seen.push(u), res(html(token)));

  (async () => {
    const a = await A.getRpcContext('0', { fetch: fetchFor('TOKEN-CUA-0'), storage: store, now: 1000 });
    ok(a.ok && a.at === 'TOKEN-CUA-0', 'lấy được token cho authuser 0');
    ok(a.authuser === '0', 'ngữ cảnh trả về mang theo authuser của chính nó');
    ok(String(seen[0]).includes('authuser=0'), 'URL lấy token có ghim authuser');
    ok(store.data[A.CTX_KEY].authuser === '0', 'bản ghi trên đĩa mang theo authuser — đây là ràng buộc');

    /* Lượt hai, CÙNG authuser: phải dùng lại, không gọi mạng thêm. */
    const lai = await A.getRpcContext('0', { fetch: fetchFor('KHONG-DUOC-GOI'), storage: store, now: 2000 });
    ok(lai.at === 'TOKEN-CUA-0' && lai.fromCache === true, 'cùng authuser thì dùng lại cache');
    ok(seen.length === 1, 'cùng authuser thì KHÔNG gọi mạng lần nữa');

    /* Lượt ba, KHÁC authuser, cache vẫn còn hạn và KHÔNG ai gọi hàm xoá.
       Đây là câu hỏi trung tâm của cả ticket. */
    const b = await A.getRpcContext('1', { fetch: fetchFor('TOKEN-CUA-1'), storage: store, now: 3000 });
    ok(b.at === 'TOKEN-CUA-1', 'đổi authuser thì PHẢI lấy token mới, dù cache còn hạn');
    ok(b.at !== 'TOKEN-CUA-0', 'token của tài khoản 0 KHÔNG được dùng cho tài khoản 1');
    ok(b.authuser === '1', 'authuser trả về là cái vừa hỏi');
    ok(String(seen[1]).includes('authuser=1'), 'lượt lấy token mới ghim đúng authuser mới');
    ok(seen.length === 2, 'đúng hai lượt mạng: một cho mỗi tài khoản');

    /* `usable()` là chỗ giữ luật — kiểm thẳng nó, vì đây là bề mặt mà đột biến
       sẽ nhắm vào. Không phụ thuộc việc ai đó nhớ gọi clearRpcContext(). */
    const cfg = A.config;
    const rec = { at: 'x', ts: 0, authuser: '0' };
    ok(A._internals.usable(rec, '0', 1, cfg) === true, 'usable: khớp authuser, còn hạn → dùng');
    ok(A._internals.usable(rec, '1', 1, cfg) === false, 'usable: LỆCH authuser → từ chối');
    ok(A._internals.usable(rec, 0, 1, cfg) === true, 'usable: 0 và "0" là một (chuẩn hoá ở đúng một chỗ)');
    ok(A._internals.usable(rec, '0', cfg.ttlMs + 1, cfg) === false, 'usable: quá TTL → từ chối');
    ok(A._internals.usable({ ...rec, at: '' }, '0', 1, cfg) === false, 'usable: token rỗng → từ chối');
  })();
}

/* ------------------------------------------------------------------ */
/* 4. TTL và quyền lưu xuống đĩa                                        */
/* ------------------------------------------------------------------ */
{
  const A = load();
  const store = fakeStore();
  const html = '<script>window.WIZ={"SNlM0e":"T","cfb2h":"b"};</script>';
  (async () => {
    await A.getRpcContext('0', { fetch: async () => res(html), storage: store, now: 0 });
    const ttl = A.config.ttlMs;
    A._internals.resetMemo();
    const het = await A.getRpcContext('0', { fetch: async () => res(html), storage: store, now: ttl + 1 });
    ok(het.status === 'fetched', 'quá TTL thì lấy lại, không xài bản cũ trên đĩa');
    A._internals.resetMemo();
    const con = await A.getRpcContext('0', { fetch: async () => res(html), storage: store, now: ttl - 1 });
    ok(con.status === 'stored', 'trong TTL thì đọc thẳng từ đĩa');
  })();

  /* `ttlMs: 0` — điều kiện đảo ngược số 3 của ticket. Một chỗ, một hằng.
     KHÔNG rải `...B.BASE` vào: viết thế là tự tay dựng lại cấu hình đầy đủ, và
     phép gộp — thứ thật sự phải giữ `listUrl`/`accountSlots` — không bị đo. */
  const B = load();
  B.configure({ ttlMs: 0 });
  const store2 = fakeStore();
  (async () => {
    const r = await B.getRpcContext('0', { fetch: async () => res(html), storage: store2, now: 0 });
    ok(r.ok === true && r.at === 'T', 'ttlMs 0 vẫn lấy được token để dùng ngay');
    ok(store2.data[B.CTX_KEY] === undefined, 'ttlMs 0 thì KHÔNG ghi gì xuống đĩa');
  })();

  /* Và phải THU HỒI token đã nằm sẵn trên đĩa. Khẳng định ở trên dùng một store
     RỖNG nên nó chứng nhận rộng hơn cái nó đo: "không ghi thêm" không phải
     "không còn token nào". Ca dưới đây mới là ca Cài đặt quảng cáo. */
  const C = load();
  C.configure({ ttlMs: 0 });
  const store3 = fakeStore({ [C.CTX_KEY]: { at: 'TOKEN-CU', bl: 'b', authuser: '0', ts: 0 } });
  (async () => {
    await C.getRpcContext('0', { fetch: async () => res(html), storage: store3, now: 0 });
    ok(store3.data[C.CTX_KEY] === undefined,
      `ttlMs 0 THU HỒI token đã lưu, nhận: ${JSON.stringify(store3.data[C.CTX_KEY])}`);
  })();
}

/* ------------------------------------------------------------------ */
/* 4b. Luật gộp `accountOverrides`                                      */
/* ------------------------------------------------------------------ */
{
  /* Gộp NÔNG thì `{"accountSlots": {"index": 8}}` — đúng hình dạng placeholder
     in trên màn hình Cài đặt — xoá sạch marker/name/email và không hàng nào
     được nhận nữa. Ví dụ mẫu tự làm hỏng chính nó. */
  const D = load();
  const goc = D.BASE.accountSlots;
  D.configure({ accountSlots: { index: 8 } });
  ok(D.config.accountSlots.index === 8, 'gộp: ô được ghi đè nhận giá trị mới');
  ok(D.config.accountSlots.email === goc.email, 'gộp SÂU: các ô KHÔNG nhắc tới vẫn còn');
  ok(D.config.accountSlots.marker === goc.marker, 'gộp sâu: giữ cả ô marker');
  ok(D.config.listUrl === D.BASE.listUrl, 'gộp: nhánh không nhắc tới giữ nguyên');

  /* Đầu-tới-cuối: ô index dời sang 8 thì hàng dựng theo hình dạng MỚI phải đọc
     được. Chỉ so `config` thôi là chưa chạm tới `rowsToAccounts`. */
  const s8 = D.config.accountSlots;
  const row = [];
  row[s8.marker] = D.config.accountMarker;
  row[s8.name] = 'Chu So Huu';
  row[s8.email] = 'a@gmail.com';
  row[8] = 3;
  D.detectAccounts({ fetch: async () => res(JSON.stringify([[row]])) }).then((r) => {
    ok(r.accounts.length === 1 && r.accounts[0].index === 3,
      `dời ô index bằng override thì đọc đúng, nhận: ${JSON.stringify(r.accounts)}`);
  });

  /* Mảng THAY THẾ, không hợp nhất — khác `rpcOverrides` đúng chỗ này. Ghi đè
     `origins` là để thay, không phải để thêm một origin nữa vào danh sách. */
  const E = load();
  E.configure({ origins: ['https://chi-mot-cho.example'] });
  ok(E.config.origins.length === 1 && E.config.origins[0] === 'https://chi-mot-cho.example',
    `origins bị THAY THẾ chứ không hợp nhất, nhận: ${JSON.stringify(E.config.origins)}`);
}

/* ------------------------------------------------------------------ */
/* 5. Hỏng thì lùi, không hỏng thì ghi sai                              */
/* ------------------------------------------------------------------ */
{
  const A = load();
  A.detectAccounts({ fetch: async () => res('', false) }).then((r) => {
    ok(r.ok === false && r.accounts.length === 0, 'HTTP lỗi → mảng rỗng, không ném');
  });
  A.detectAccounts({ fetch: async () => res('<html>not json</html>') }).then((r) => {
    ok(r.ok === false && r.status === 'unparsable', 'phản hồi không parse được → unparsable');
  });
  A.detectAccounts({
    fetch: async () => { throw new Error('mất mạng'); },
  }).then((r) => {
    ok(r.ok === false && r.status === 'network', 'mất mạng → network, không ném ra ngoài');
  });

  const B = load();
  (async () => {
    const r = await B.getRpcContext('0', { fetch: async () => res('<html>không có token</html>'), storage: fakeStore() });
    ok(r.ok === false && r.status === 'no-at-token', 'HTML không có token → no-at-token, at rỗng');
    ok(r.at === '', 'thất bại thì KHÔNG trả về một token nửa vời');
  })();

  /* clearRpcContext dọn cả hai tầng. */
  const C = load();
  (async () => {
    const store = fakeStore();
    const html = '<script>window.WIZ={"SNlM0e":"T2","cfb2h":"b"};</script>';
    await C.getRpcContext('0', { fetch: async () => res(html), storage: store, now: 0 });
    await C.clearRpcContext({ storage: store });
    ok(store.data[C.CTX_KEY] === undefined, 'clearRpcContext xoá bản trên đĩa');
    const sau = await C.getRpcContext('0', { fetch: async () => res(html), storage: store, now: 1 });
    ok(sau.status === 'fetched', 'clearRpcContext xoá cả bản nhớ trong RAM');
  })();
}

/*
 * Số assertion PHẢI chạy. Không có dòng này thì một promise chưa kịp xong lúc
 * hết 200 ms sẽ làm file báo "ít pass, 0 fail" — tức thiếu phép đo mà vẫn xanh,
 * đúng kiểu hỏng im lặng mà cả repo này viết ra để chặn. Thêm/bớt assertion thì
 * sửa con số này; nó là một phép đếm của CHÍNH file này, không phải một hằng số
 * ngoại sinh chép tay.
 */
const CAN_CO = 56;

setTimeout(() => {
  const daChay = pass + fail;
  if (daChay !== CAN_CO) {
    fail++;
    console.log(`❌ chạy được ${daChay}/${CAN_CO} assertion — có promise chưa xong, kết quả KHÔNG dùng được`);
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail) process.exit(1);
}, 200);
