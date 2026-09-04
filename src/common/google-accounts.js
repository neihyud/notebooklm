/*
 * Tài khoản Google + ngữ cảnh RPC (token `at`, nhãn build `bl`) cho NotebookLM.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ĐỌC CHỖ NÀY TRƯỚC: file này CỐ Ý phá một cam kết cũ
 *
 * `rpc.js` mở đầu bằng câu "không đọc cookie, không lưu token". Vế sau không
 * còn đúng kể từ ticket 013: file này LƯU token `at` xuống
 * `chrome.storage.local`, đúng như Sourclip, và owner đã cho phép rõ ràng ngày
 * 2026-09-03 với cái giá viết sẵn trên màn hình lúc chọn.
 *
 * Vế "không đọc cookie" thì VẪN đúng và không được đụng tới: `manifest.json`
 * không xin quyền `cookies`; ta chỉ đặt `credentials:'include'` để trình duyệt
 * tự gắn cookie phiên vào request đi tới chính Google, và không bao giờ đọc
 * được giá trị cookie đó.
 *
 * Lý do đánh đổi: không có token của tài khoản N thì không hành động được với
 * tư cách tài khoản N, mà token đó chỉ ra từ một lượt tải trang `/?authuser=N`.
 * Ticket 013, mục *Ba đường*, so sánh đầy đủ ba lựa chọn.
 *
 * ────────────────────────────────────────────────────────────────────────
 * RÀNG BUỘC QUAN TRỌNG NHẤT — token và `authuser` không bao giờ rời nhau
 *
 * Token `SNlM0e` thuộc về MỘT tài khoản. Gửi token của A kèm `authuser=B` là
 * đúng hình dạng *đường dữ liệu song song*: hai giá trị ra từ cùng một lượt
 * tải, chảy tới hai chỗ khác nhau trong cùng một request, và không có gì trong
 * kiểu dữ liệu buộc chúng khớp.
 *
 * Sourclip giữ ràng buộc này bằng cách NHỚ gọi hàm xoá cache mỗi lần đổi tài
 * khoản. Đó là một lời hứa của người viết. Ở đây nó là một ràng buộc của cấu
 * trúc: bản ghi cache MANG THEO `authuser` của chính nó, và `getRpcContext()`
 * từ chối mọi bản ghi có `authuser` khác cái đang hỏi. Quên gọi hàm xoá thì
 * cache tự lỡ, chứ không trả nhầm token.
 *
 * ────────────────────────────────────────────────────────────────────────
 * HẰNG SỐ NGOẠI SINH — MỘT PHIẾU, và phiếu đó sẽ hỏng
 *
 * Toàn bộ hình dạng `ListAccounts` dưới đây chỉ có MỘT oracle (Sourclip 1.8.0).
 * Chính oracle đó mang bảy regex vớt cho cùng một phản hồi — dấu hiệu rõ ràng
 * rằng Google đổi hình dạng chỗ này. Ta KHÔNG chép bảy đường lùi; ta để hỏng
 * thành mảng rỗng và lùi về đường "dùng authuser của tab".
 */
;(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* giả thuyết ngoại sinh — owner ghi đè được ở trang Cài đặt            */
  /* ------------------------------------------------------------------ */

  const BASE = {
    /** Endpoint liệt kê tài khoản. Một phiếu duy nhất. */
    listUrl:
      'https://accounts.google.com/ListAccounts?json=standard&source=ogb&md=1&cc=1' +
      '&mn=1&mo=1&gpsia=1&fwput=860&listPages=1&origin=https%3A%2F%2Fwww.google.com',

    /** Dấu nhận biết một phần tử tài khoản trong cây mảng trả về. */
    accountMarker: 'gaia.l.a',

    /**
     * Ô nào mang gì, TRONG một phần tử tài khoản.
     * Cùng luật với `slots` của `rpc.js`: đây là dữ liệu, không phải cấu trúc.
     */
    accountSlots: { marker: 0, name: 2, email: 3, isDefault: 6, index: 7 },

    /** Email chứa chuỗi này là rác của chính endpoint, bỏ đi. */
    dropEmailContaining: '@unknown',

    /**
     * Nhận ra một email. Dùng để TỪ CHỐI lúc chạy khi ô email đọc nhầm sang ô
     * tên — xem `looksLikeEmail`. Đây là thứ đứng thay cho một assertion ghim
     * số ô, đúng bài học của ticket 011.
     */
    emailPattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',

    /** Nơi lấy token. Thử lần lượt, dừng ở cái đầu tiên trả `ok`. */
    origins: ['https://notebooklm.google.com', 'https://notebook.google.com'],

    /** Rút token và nhãn build ra khỏi HTML trang chủ. */
    atPattern: '"SNlM0e":"([^"]+)"',
    blPattern: '"cfb2h":"([^"]+)"',

    /** 12 giờ, đúng bằng Sourclip. Đặt 0 là tắt hẳn việc lưu xuống đĩa. */
    ttlMs: 43200000,

    /** Trần thời gian cho mỗi lượt mạng ở đây. */
    listTimeoutMs: 8000,
    contextTimeoutMs: 5000,
  };

  const CTX_KEY = 'rpcContext';

  let config = BASE;
  /** Bản nhớ trong RAM. Cùng luật khớp `authuser` như bản trên đĩa. */
  let memo = null;

  function configure(overrides) {
    config = overrides && typeof overrides === 'object' ? { ...BASE, ...overrides } : BASE;
  }

  /* ------------------------------------------------------------------ */
  /* đọc ListAccounts                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Có phải một email không?
   *
   * Tồn tại vì lý do rất cụ thể: `accountSlots.email` và `accountSlots.name` là
   * hai chuỗi cùng kiểu đi ra từ cùng một phần tử mảng, nên đảo hai ô đó thì
   * mọi fixture đảo theo và không test nào đỏ được (ticket 011 đã đo đúng ca
   * này và bác bỏ chính dự đoán của nó). Thứ đứng thay là một phép phát hiện
   * LÚC CHẠY: tên hiển thị không có `@`, email thì có.
   *
   * Mẫu thiếu hoặc hỏng thì TỪ CHỐI TẤT, không phải nhận tất — hỏng kiểu im
   * lặng là thứ ticket này tồn tại để chặn.
   */
  function looksLikeEmail(value, cfg) {
    const src = (cfg || config).emailPattern;
    if (typeof value !== 'string' || !value || typeof src !== 'string' || !src) return false;
    let re;
    try {
      re = new RegExp(src);
    } catch (_) {
      return false;
    }
    return re.test(value);
  }

  /** Gom mọi phần tử trông như một bản ghi tài khoản, ở mọi độ sâu. */
  function collectAccountRows(node, cfg, out) {
    const acc = out || [];
    if (!Array.isArray(node)) return acc;
    const s = cfg.accountSlots;
    if (node[s.marker] === cfg.accountMarker && typeof node[s.email] === 'string') acc.push(node);
    for (const child of node) if (Array.isArray(child)) collectAccountRows(child, cfg, acc);
    return acc;
  }

  /** Bỏ tiền tố chống-XSSI rồi parse. Không có bảy đường lùi như oracle. */
  function parseListPayload(text) {
    if (typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (_) {}
    try {
      return JSON.parse(text.replace(/^\s*\)\]\}'\s*/, ''));
    } catch (_) {}
    return null;
  }

  function rowsToAccounts(rows, cfg) {
    const s = cfg.accountSlots;
    const out = [];
    rows.forEach((row) => {
      const email = String(row[s.email] || '').toLowerCase();
      // Ba bộ lọc, ba lý do khác nhau: `dropEmailContaining` là rác của chính
      // endpoint; `looksLikeEmail` và phép kiểm `index` là hai phép dò ô đọc
      // nhầm — hai ô, hai phép dò riêng.
      if (!email || email.includes(cfg.dropEmailContaining)) return;
      if (!looksLikeEmail(email, cfg)) return;
      /*
       * Ô `index` TRỰC TIẾP trở thành `authuser`, tức nó một mình quyết định
       * request đi vào tài khoản nào.
       *
       * Bản trước thiếu số thì lùi về VỊ TRÍ trong mảng. Cú lùi đó bịa ra một
       * ánh xạ email→tài khoản, vì `ListAccounts` không sắp theo `authuser`; và
       * `usable()` không bắt được, vì nó chỉ so con số với con số. Kết quả là
       * ghi vào nhầm tài khoản, hoàn toàn im lặng — đúng thứ ticket 013 tồn tại
       * để chặn. Bỏ hàng đi thay vì đoán.
       *
       * Bỏ hết mọi hàng là một kết quả HỢP LỆ: danh sách rỗng → dropdown ẩn →
       * lùi về đường `authuser` của tab như trước ticket 013. Đó đúng là điều
       * kiện đảo ngược số 1, chứ không phải một ngõ cụt mới.
       */
      const index = row[s.index];
      if (!Number.isInteger(index) || index < 0) return;
      const name = String(row[s.name] || '').trim() || email.split('@')[0];
      out.push({ email, name, index, isDefault: row[s.isDefault] === 1 });
    });
    return out;
  }

  /**
   * Danh sách tài khoản Google đang đăng nhập trên máy.
   *
   * KHÔNG ném, và mảng rỗng là một kết quả hợp lệ nghĩa là "không đọc được" —
   * giao diện phải lùi về đường `authuser` của tab, không được coi là "không có
   * tài khoản nào".
   */
  async function detectAccounts(opts) {
    const o = opts || {};
    const cfg = config;
    const fetchImpl = o.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (!fetchImpl) return { ok: false, accounts: [], status: 'no-fetch' };

    let res;
    try {
      res = await withTimeout(
        (signal) => fetchImpl(cfg.listUrl, { credentials: 'include', signal }),
        cfg.listTimeoutMs,
        o
      );
    } catch (_) {
      return { ok: false, accounts: [], status: 'network' };
    }
    if (!res || !res.ok) return { ok: false, accounts: [], status: 'http-' + ((res && res.status) || 0) };

    const parsed = parseListPayload(await res.text());
    if (!parsed) return { ok: false, accounts: [], status: 'unparsable' };

    const accounts = rowsToAccounts(collectAccountRows(parsed, cfg), cfg);
    return { ok: true, accounts, status: accounts.length ? 'ok' : 'empty' };
  }

  /* ------------------------------------------------------------------ */
  /* ngữ cảnh RPC: token `at` + nhãn `bl`, GẮN LIỀN với một `authuser`     */
  /* ------------------------------------------------------------------ */

  function firstMatch(text, pattern) {
    if (typeof pattern !== 'string' || !pattern) return '';
    let re;
    try {
      re = new RegExp(pattern);
    } catch (_) {
      return '';
    }
    const m = re.exec(text);
    return (m && m[1]) || '';
  }

  function normAuthuser(v) {
    // Chuẩn hoá về CHUỖI ở đúng một chỗ. Nếu để `0` và `'0'` cùng tồn tại thì
    // phép so khớp `authuser` bên dưới sẽ lỡ một cách im lặng — mà đó lại chính
    // là cơ chế an toàn của cả file này.
    return v == null ? '0' : String(v);
  }

  async function readStored(o) {
    const store = o.storage || (root.chrome && root.chrome.storage && root.chrome.storage.local);
    if (!store) return null;
    try {
      const got = await store.get(CTX_KEY);
      return (got && got[CTX_KEY]) || null;
    } catch (_) {
      return null;
    }
  }

  async function writeStored(value, o) {
    const cfg = config;
    // `ttlMs <= 0` nghĩa là owner đã rút quyền lưu xuống đĩa. Đây là một trong
    // bốn *điều kiện đảo ngược* của ticket 013, và chỗ đảo cố ý chỉ có một.
    if (!(cfg.ttlMs > 0)) return;
    const store = o.storage || (root.chrome && root.chrome.storage && root.chrome.storage.local);
    if (!store) return;
    try {
      await store.set({ [CTX_KEY]: value });
    } catch (_) {}
  }

  /**
   * Bản ghi cache còn dùng được cho ĐÚNG `authuser` này không?
   *
   * Ba điều kiện, và điều kiện thứ ba là lý do file này tồn tại.
   */
  function usable(rec, authuser, now, cfg) {
    if (!rec || typeof rec.at !== 'string' || !rec.at) return false;
    if (!(cfg.ttlMs > 0) || !(rec.ts + cfg.ttlMs > now)) return false;
    return normAuthuser(rec.authuser) === normAuthuser(authuser);
  }

  /**
   * Token + nhãn build cho một `authuser` cụ thể.
   *
   * Trả về `{ok, at, bl, authuser, status, fromCache}`. `at` KHÔNG bao giờ đi
   * kèm một `authuser` khác cái vừa hỏi — xem `usable()`.
   */
  async function getRpcContext(authuser, opts) {
    const o = opts || {};
    const cfg = config;
    const want = normAuthuser(authuser);
    const now = typeof o.now === 'number' ? o.now : Date.now();

    if (usable(memo, want, now, cfg)) {
      return { ok: true, at: memo.at, bl: memo.bl, authuser: want, status: 'memo', fromCache: true };
    }
    const stored = await readStored(o);
    if (usable(stored, want, now, cfg)) {
      memo = stored;
      return { ok: true, at: stored.at, bl: stored.bl, authuser: want, status: 'stored', fromCache: true };
    }

    const fetchImpl = o.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (!fetchImpl) return { ok: false, at: '', bl: '', authuser: want, status: 'no-fetch' };

    for (const origin of cfg.origins) {
      const url = origin + '/?authuser=' + encodeURIComponent(want) + '&pageId=none';
      let res;
      try {
        res = await withTimeout(
          (signal) => fetchImpl(url, { credentials: 'include', redirect: 'follow', signal }),
          cfg.contextTimeoutMs,
          o
        );
      } catch (_) {
        continue;
      }
      if (!res || !res.ok) continue;
      const html = await res.text();
      const at = firstMatch(html, cfg.atPattern);
      if (!at) continue;
      const rec = { at, bl: firstMatch(html, cfg.blPattern), authuser: want, ts: now };
      memo = rec;
      await writeStored(rec, o);
      return { ok: true, at: rec.at, bl: rec.bl, authuser: want, status: 'fetched', fromCache: false };
    }
    return { ok: false, at: '', bl: '', authuser: want, status: 'no-at-token' };
  }

  /**
   * Vứt ngữ cảnh đang giữ.
   *
   * Vẫn gọi khi đổi tài khoản — nhưng KHÔNG phải vì tính đúng đắn phụ thuộc vào
   * nó. `usable()` đã chặn ca token-chéo-tài-khoản rồi. Gọi ở đây chỉ để không
   * giữ một token không còn ai dùng nằm trên đĩa lâu hơn cần thiết.
   */
  async function clearRpcContext(opts) {
    const o = opts || {};
    memo = null;
    const store = o.storage || (root.chrome && root.chrome.storage && root.chrome.storage.local);
    if (!store) return;
    try {
      await store.remove(CTX_KEY);
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */

  function withTimeout(run, ms, o) {
    const AC = o.AbortController || root.AbortController;
    if (!AC || !(ms > 0)) return run(undefined);
    const ctrl = new AC();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return Promise.resolve(run(ctrl.signal)).finally(() => clearTimeout(timer));
  }

  root.NBLM_ACCOUNTS = {
    BASE,
    CTX_KEY,
    configure,
    detectAccounts,
    getRpcContext,
    clearRpcContext,
    get config() {
      return config;
    },
    _internals: {
      looksLikeEmail,
      collectAccountRows,
      parseListPayload,
      rowsToAccounts,
      firstMatch,
      normAuthuser,
      usable,
      resetMemo() {
        memo = null;
      },
    },
  };
})(globalThis);
