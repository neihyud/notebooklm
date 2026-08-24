/*
 * Đường thêm Nguồn qua batchexecute — ĐẶT TRƯỚC đường DOM, không thay nó.
 *
 * File này nạp SAU `automation.js` và bọc lại đúng hai hàm `addUrlSource` /
 * `addTextSource`. `automation.js` không đổi một dòng nào và vẫn là lưới an
 * toàn: mọi ca RPC không dùng được đều rơi xuống nó.
 *
 * Vì sao không cần quyền mới: content script này chạy trên chính
 * `notebooklm.google.com`, nên `fetch` ở đây là same-origin và Chrome tự gắn
 * cookie phiên. Không đọc cookie, không lưu token, không gửi gì ra ngoài origin.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CÁI GÌ Ở ĐÂY LÀ GIẢ THUYẾT, CÁI GÌ KHÔNG
 *
 * Giả thuyết — TOÀN BỘ lấy từ tài liệu cộng đồng (`notebooklm-py`,
 * `notebooklm-mcp-cli`), CHƯA đo trên một request thật của owner:
 *
 *   - hai rpc id `ozz5Z`/`izAoDd` và thứ tự thử chúng;
 *   - đường `/_/LabsTailwindUi/data/batchexecute`;
 *   - việc notebook id phải nằm TRONG `args` chứ không chỉ ở query;
 *   - vị trí URL / cặp [tiêu đề, nội dung] / mã loại BÊN TRONG `spec`, và ô
 *     hằng số ở cuối `spec`;
 *   - hai khối hằng số ở đuôi `args` mà ta chép nguyên và KHÔNG biết nghĩa;
 *   - **cách nhóm `args`** — hai oracle bên thứ ba MÂU THUẪN nhau ở đúng chỗ
 *     này (4 ô/bọc đơn so với 3 ô/bọc đôi). Đây là giả thuyết lớn nhất, và là
 *     lý do `argsShape` là dữ liệu owner sửa được chứ không phải cấu trúc cứng.
 *     Khác mọi giả thuyết trên: hình dạng sai KHÔNG dò được lúc chạy, vì nó cho
 *     frame rỗng → `unknown` → dừng hẳn, không phải `rpc-id-stale` → thử tiếp.
 *
 * Tất cả nằm gọn trong `BASE` bên dưới, và owner ghi đè được từ trang Cài đặt
 * mà không cần bản mới — `tools/probe-notebooklm.mjs` là thứ đo ra giá trị thật.
 *
 * KHÔNG phải giả thuyết, và là lý do file này vẫn an toàn khi mọi giả thuyết
 * trên đều sai: `readEnvelope()` chỉ kết luận "đã thêm" khi server trả về một
 * frame `wrb.fr` mang ĐÚNG rpc id mà ta vừa gửi. Google xoay id thì không có
 * frame nào khớp, ta biết ngay trong chính lượt chạy đó và rơi xuống DOM. Đây
 * là cơ chế phát hiện lúc chạy; không có assertion nào ghim một rpc id cụ thể,
 * vì một assertion như thế chỉ chứng nhận thứ ta gõ.
 */
;(function (root) {
  'use strict';

  const { norm } = root.NBLM;
  // Dùng lại đúng hàm gộp của selectors.js chứ không chép lại: ràng buộc "ghi đè
  // là GỘP THÊM chứ không thay thế" phải là cùng một hành vi ở cả hai chỗ, và
  // cách chắc chắn nhất là cùng một hàm.
  const merge = root.NBLM_SELECTORS.merge;

  /* ------------------------------------------------------------------ */
  /* giả thuyết ngoại sinh — owner ghi đè được ở trang Cài đặt            */
  /* ------------------------------------------------------------------ */

  const BASE = {
    /**
     * Đường tới batchexecute. MẢNG vì owner thêm được đường mới lên đầu mà giữ
     * đường cũ làm dự phòng. Đường sai trả 404 hoặc HTML — không ghi gì.
     */
    paths: ['/_/LabsTailwindUi/data/batchexecute'],
    /**
     * rpc id của "thêm nguồn", thử theo thứ tự. Thử nhiều id là AN TOÀN chứ
     * không phải liều: id sai thì server không chạy gì cả (xem `readEnvelope`),
     * nên không có nguy cơ ghi trùng. Vòng lặp dừng ngay khi một id cho kết quả
     * khác `not-sent`.
     *
     * THỨ TỰ có chủ ý, và đây là chỗ dễ đặt ngược. Id KHÔNG tồn tại cho tài
     * khoản này thì server không trả frame nào khớp → `rpc-id-stale` →
     * `not-sent` → thử id kế tiếp: đó là ca ta xử lý được. Còn id có tồn tại mà
     * từ chối thì rất có thể trả về một frame rỗng → `unknown` → DỪNG hẳn, và
     * id sau không bao giờ tới lượt. Nên id nhiều khả năng đúng phải đứng trước.
     *
     * Bằng chứng mạnh nhất hiện có xếp `izAoDd` trước: một extension đang bán,
     * build 04/2026, vẫn dùng nó (`docs/notebooklm-rpc-do-duoc.md`). `ozz5Z`
     * chỉ có trong changelog của một thư viện — giữ lại làm ứng viên dự phòng
     * chứ không cho đứng đầu.
     */
    addSourceIds: ['izAoDd', 'ozz5Z'],
    /**
     * CÁCH NHÓM `args`, dưới dạng dữ liệu chứ không phải cấu trúc cứng.
     *
     * Hai oracle bên thứ ba mâu thuẫn nhau ở đúng chỗ này, và KHÔNG oracle nào
     * là một request thật của owner:
     *
     *   - extension "Youtube Summary with AI" 1.5.4 (bán trên Web Store, build
     *     04/2026, `docs/notebooklm-rpc-do-duoc.md`): 4 ô, nguồn bọc ĐƠN —
     *     `[ [spec], notebookId, [2], [1,null×9,[1]] ]`. Đây là mặc định.
     *   - `notebooklm-py` (tài liệu cộng đồng): 3 ô, nguồn bọc ĐÔI —
     *     `[ [[spec]], notebookId, [2,null,null,[1,null×9,[1]]] ]`. Dán vào
     *     `rpcOverrides.argsShape` để đổi sang biến thể này:
     *     `[{dat:'sources',boc:2},{dat:'notebookId'},{hang:[2,null,null,[1,null,null,null,null,null,null,null,null,null,[1]]]}]`
     *
     * Vì sao là dữ liệu chứ không phải `if`: hình dạng sai thì server trả frame
     * rỗng → `unknown` → DỪNG hẳn, nên KHÔNG dò được lúc chạy như dò rpc id. Ta
     * chỉ gửi được một hình dạng, và người duy nhất phân xử được là owner với
     * `tools/probe-notebooklm.mjs`. Để nó ở đây thì owner đổi được mà không cần
     * bản mới — và không assertion nào trong repo ghim số ô hay số lớp bọc.
     */
    argsShape: [
      { dat: 'sources', boc: 1 },
      { dat: 'notebookId' },
      { hang: [2] },
      { hang: [1, null, null, null, null, null, null, null, null, null, [1]] },
    ],
    /** Vị trí trong `spec`, tức `params[0][0][0]`. */
    slots: { text: 1, url: 2, kind: 3, youtubeUrl: 7 },
    /** `spec` là mảng 11 phần tử, phần thừa để `null`. */
    specLength: 11,
    /**
     * Giá trị cố định mọi loại nguồn đều mang. Cộng đồng gọi index 10 là "type
     * indicator", nhưng cả ba loại đều là `1` nên ta không đoán nghĩa của nó —
     * chỉ chép đúng vị trí và đúng giá trị đã quan sát được.
     */
    specConstants: { 10: 1 },
    /**
     * Mã loại nguồn. Tài liệu cộng đồng chỉ nêu MỘT mã (2 = văn bản dán), nên
     * hai mã còn lại để `null` — cố ý bỏ trống chứ không đoán bừa một con số.
     */
    kindCodes: { text: 2, url: null, youtube: null },
    /**
     * Hình dạng của token `at`: chuỗi base64url, dấu hai chấm, mốc thời gian ms.
     *
     * Neo theo HÌNH DẠNG chứ không theo tên khoá là chủ ý. Mọi tài liệu bên
     * ngoài đều nói khoá tên `SNlM0e`; ghim tên đó là chép tay thêm một hằng số
     * ngoại sinh nữa. Hình dạng thì tự kiểm được: không giá trị nào trong
     * `WIZ_global_data` khớp thì ta biết mình không có token và không gửi gì.
     */
    atPatterns: ['^[A-Za-z0-9_-]{8,}:[0-9]{10,16}$'],
  };

  /** Tình huống được ghi vào bản chụp cho owner đọc ở trang Cài đặt. */
  const REPORT = {
    /** RPC đang bật nhưng không dùng được — đã rơi xuống DOM. */
    RPC_UNUSABLE: 'rpc-unusable',
    /**
     * Lượt DỪNG hẳn: không ai biết notebook đã được ghi hay chưa, và không có
     * đường DOM chạy bù. Khoá riêng chứ không dùng chung với `RPC_UNUSABLE`:
     * hai ca này đòi hai hành động khác nhau của owner — một ca chỉ là "RPC
     * chậm/hỏng, đã có DOM lo", ca kia là "hãy mở notebook kiểm bằng mắt".
     */
    RPC_UNKNOWN: 'rpc-unknown',
  };

  /**
   * Ba kết cục, không phải hai. Cái ở giữa là lý do file này không đơn giản hơn
   * được: "không biết" KHÔNG được rơi xuống DOM, vì thêm Nguồn không idempotent
   * và thử lại là để lại một bản trùng phải xoá tay.
   */
  const OUTCOME = {
    /** Server đã nhận và trả dữ liệu cho đúng rpc id ta gửi. */
    ADDED: 'added',
    /**
     * Chắc chắn chưa có gì được ghi — an toàn để chạy đường DOM.
     *
     * Chỉ những trạng thái CHỨNG MINH được điều đó mới vào đây: ta dừng trước
     * khi gửi, hoặc server trả lời mà lời đó nói nó không chạy gì. Một `fetch`
     * ném ra thì KHÔNG chứng minh được gì cả — xem `transport` ở `outcomeFor`.
     */
    NOT_SENT: 'not-sent',
    /** Server đã thấy request nhưng ta không đọc được kết quả. Không thử lại. */
    UNKNOWN: 'unknown',
  };

  /* ------------------------------------------------------------------ */
  /* cấu hình lúc chạy                                                    */
  /* ------------------------------------------------------------------ */

  let config = merge(BASE, null);
  let enabled = false;
  /**
   * Lần đọc storage đầu tiên. Khai báo ở ĐÂY chứ không cạnh chỗ gán bên dưới:
   * `tryRpc` await nó, và một `let` nằm sau chỗ dùng thì chỉ an toàn chừng nào
   * chưa ai gọi trong lúc file đang nạp — ràng buộc vô hình đó không đáng giữ.
   */
  let ready = Promise.resolve();
  let limitPatterns = root.NBLM_SELECTORS.build(null).limitPatterns;

  /** @param {object} settings toàn bộ settings, không phải riêng phần ghi đè. */
  function configure(settings) {
    const s = settings || {};
    const ov = s.rpcOverrides;
    config = merge(BASE, ov);
    // NGOẠI LỆ có chủ ý với luật gộp chung. `merge` nối hai mảng lại và ưu tiên
    // phần người dùng thêm — đúng cho `paths`/`addSourceIds`, nơi "thêm một ứng
    // viên nữa" là điều owner muốn. `argsShape` thì ngược hẳn: nó là MỘT bản mô
    // tả hoàn chỉnh, không phải danh sách ứng viên. Nối biến thể 3 ô vào sau
    // biến thể 4 ô cho ra một `args` 7 ô mà không oracle nào từng thấy — và
    // hỏng thầm lặng, vì request vẫn gửi đi, chỉ là sai.
    if (ov && typeof ov === 'object' && Object.prototype.hasOwnProperty.call(ov, 'argsShape')) {
      config.argsShape = ov.argsShape;
    }
    enabled = s.rpcEnabled === true;
    // Câu chữ nhận diện "đã chạm giới hạn 50 nguồn" chỉ có MỘT nguồn sự thật
    // trong repo, và nó nằm ở selectors.js. Đọc lại từ đó (kèm ghi đè của owner)
    // thay vì chép sang đây một mảng thứ hai sẽ lệch dần.
    limitPatterns = root.NBLM_SELECTORS.build(s.selectorOverrides).limitPatterns;
  }

  /* ------------------------------------------------------------------ */
  /* đọc token `at` — giá trị này KHÔNG BAO GIỜ ra khỏi thân request       */
  /* ------------------------------------------------------------------ */

  /**
   * Cắt một object/array JSON cân bằng ngoặc bắt đầu tại `start`.
   *
   * Có một bản gần giống trong `src/youtube/page-bridge.js`. Cố ý không hợp
   * nhất: file đó chạy ở MAIN world và KHÔNG nạp `shared.js`, nên hoán chỗ nào
   * cũng không dùng chung được — gộp lên `shared.js` chỉ tạo ra một phụ thuộc
   * mà bên kia không với tới.
   */
  function sliceBalanced(text, start) {
    const open = text[start];
    if (open !== '{' && open !== '[') return null;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function looksLikeAtToken(value, cfg) {
    if (typeof value !== 'string' || !value) return false;
    return cfg.atPatterns.some((p) => {
      try {
        return new RegExp(p).test(value);
      } catch (_) {
        return false; // owner gõ regex hỏng thì bỏ qua mẫu đó, đừng giết cả lượt
      }
    });
  }

  /**
   * Token CSRF `at` của trang, đọc từ `WIZ_global_data` nhúng trong HTML.
   *
   * Content script chạy ở ISOLATED world nên KHÔNG thấy `window.WIZ_global_data`
   * của trang — nhưng thấy được *chữ* của thẻ `<script>` đã in nó ra, và đó là
   * đường dùng ở đây. Đường còn lại là dựng một cầu nối MAIN world kiểu
   * `src/youtube/page-bridge.js`; nó đắt hơn (thêm một content script vào
   * manifest, thêm một giao thức postMessage) nên chỉ đáng làm nếu đo được rằng
   * đường DOM không lấy được token. `tools/probe-notebooklm.mjs` đo đúng hai
   * đường đó cạnh nhau.
   *
   * @returns {{token: string, key: string|null, source: string}|null}
   *   `token` chỉ được đi vào thân request. `key`/`source` là thứ an toàn để ghi
   *   vào bản chụp — xem `describeAt()`.
   */
  function readAtToken(doc, cfg) {
    const scripts = doc && doc.querySelectorAll ? doc.querySelectorAll('script') : [];
    for (const el of scripts) {
      const text = el.textContent || '';
      const at = text.indexOf('WIZ_global_data');
      if (at === -1) continue;

      const open = text.indexOf('{', at);
      const json = open === -1 ? null : sliceBalanced(text, open);
      if (json) {
        let data = null;
        try {
          data = JSON.parse(json);
        } catch (_) {
          data = null;
        }
        if (data && typeof data === 'object') {
          for (const key of Object.keys(data)) {
            if (looksLikeAtToken(data[key], cfg)) {
              return { token: data[key], key, source: 'WIZ_global_data' };
            }
          }
        }
      }

      // Parse hỏng (Google đổi cách in ra, hoặc object bị cắt) thì vẫn còn dò
      // được theo hình dạng ngay trong chính đoạn script đó. Hẹp hơn quét cả
      // trang: chỉ nhìn script đã khai WIZ_global_data.
      for (const p of cfg.atPatterns) {
        let re;
        try {
          re = new RegExp(`"(${String(p).replace(/^\^|\$$/g, '')})"`, 'g');
        } catch (_) {
          continue;
        }
        const m = re.exec(text);
        if (m) return { token: m[1], key: null, source: 'WIZ_global_data (dò theo hình dạng)' };
      }
    }
    return null;
  }

  /** Phần AN TOÀN của token để ghi vào bản chụp: có/không, khoá nào — không có giá trị. */
  function describeAt(found) {
    return {
      atTokenFound: !!found,
      atKey: (found && found.key) || null,
      atSource: (found && found.source) || null,
    };
  }

  /**
   * Xoá token khỏi một chuỗi trước khi nó đi vào log/thông báo/bản chụp.
   * Lưới cuối: mọi câu chữ do RPC sinh ra đều đi qua đây.
   */
  function redact(text, token) {
    const s = String(text == null ? '' : text);
    if (!token) return s;
    return s.split(token).join('‹at›');
  }

  /* ------------------------------------------------------------------ */
  /* dựng payload                                                         */
  /* ------------------------------------------------------------------ */

  function notebookIdFrom(pathname) {
    const m = /\/notebook\/([^/?#]+)/.exec(String(pathname || ''));
    return m ? m[1] : null;
  }

  /**
   * Cùng phép nhận diện với `addUrlSource` của `automation.js` (nó chọn chip
   * YouTube hay chip Trang web), chỉ khác chỗ dùng: ở đây nó chọn ô nào trong
   * payload. Hai chỗ phải đồng ý với nhau, nếu không cùng một URL sẽ thành hai
   * loại Nguồn khác nhau tuỳ đường nào chạy.
   */
  function isYouTubeUrl(url) {
    return /youtube\.com|youtu\.be/i.test(String(url || ''));
  }

  /**
   * Ghi `value` vào đúng index, chèn `null` cho các ô còn trống.
   *
   * KHÔNG dùng `arr[i] = v` trực tiếp: mảng thưa (sparse) trông giống mảng đủ
   * khi in ra, nhưng `JSON.stringify` biến lỗ thành `null` chỉ khi lỗ nằm giữa
   * — đuôi thiếu thì mất hẳn. Server đọc theo VỊ TRÍ, nên một phần tử hụt ở
   * đuôi làm lệch toàn bộ ý nghĩa của request.
   */
  function putAt(arr, index, value) {
    if (typeof index !== 'number' || index < 0 || Math.floor(index) !== index) return arr;
    while (arr.length <= index) arr.push(null);
    arr[index] = value;
    return arr;
  }

  /**
   * `spec` — mảng thưa mô tả MỘT nguồn, mỗi ô là một loại nội dung.
   *
   * Thứ tự `[title, text]` trong ô văn bản KHÔNG phải chi tiết vụn: hoán vị nó
   * thì mỗi Nguồn mang tiêu đề là cả bản transcript, mà request vẫn 200.
   */
  function buildSpec(spec, cfg) {
    const { slots, kindCodes } = cfg;
    const one = [];

    if (spec.kind === 'text') {
      putAt(one, slots.text, [spec.title, spec.text]);
      putAt(one, slots.kind, kindCodes.text);
    } else if (spec.kind === 'youtube') {
      putAt(one, slots.youtubeUrl, [spec.url]);
      putAt(one, slots.kind, kindCodes.youtube);
    } else {
      putAt(one, slots.url, [spec.url]);
      putAt(one, slots.kind, kindCodes.url);
    }

    // Hằng số cố định đi SAU phần theo loại: nếu owner ghi đè một slot trỏ trúng
    // ô hằng số, ta muốn biết bằng cách thấy hằng số thắng, chứ không phải thấy
    // một request nửa nọ nửa kia.
    const fixed = cfg.specConstants || {};
    for (const key of Object.keys(fixed)) putAt(one, Number(key), fixed[key]);

    const want = Number(cfg.specLength) || 0;
    while (one.length < want) one.push(null);
    return one;
  }

  /** Bọc `value` thêm `lan` lớp mảng: `boc:1` → `[spec]`, `boc:2` → `[[spec]]`. */
  function bocLai(value, lan) {
    let out = value;
    const n = Number(lan) || 0;
    for (let i = 0; i < n; i++) out = [out];
    return out;
  }

  /**
   * Dựng `args` theo đúng `cfg.argsShape` — file này KHÔNG biết `args` có mấy ô
   * hay nguồn bọc mấy lớp, nó chỉ đọc bản mô tả. Đó là chủ ý: cách nhóm là hằng
   * số ngoại sinh y như `slots`, và hai oracle đang mâu thuẫn về nó.
   */
  function buildParams(spec, cfg, notebookId) {
    const shape = Array.isArray(cfg.argsShape) ? cfg.argsShape : [];
    const params = [];
    for (let i = 0; i < shape.length; i++) {
      const o = shape[i];
      if (!o || typeof o !== 'object') {
        putAt(params, i, null);
      } else if (o.dat === 'sources') {
        putAt(params, i, bocLai(buildSpec(spec, cfg), o.boc));
      } else if (o.dat === 'notebookId') {
        putAt(params, i, notebookId);
      } else if (Object.prototype.hasOwnProperty.call(o, 'hang')) {
        putAt(params, i, o.hang);
      } else {
        putAt(params, i, null);
      }
    }
    return params;
  }

  /**
   * `_reqid` phải khác nhau giữa các lượt — batchexecute dùng nó để ghép request
   * với response. Một hằng số chép tay ở đây trông vẫn chạy được cho tới lúc hai
   * lượt chạy chồng lên nhau.
   */
  function newReqId() {
    return 100000 + Math.floor(Math.random() * 899999);
  }

  function buildUrl({ path, rpcId, notebookId, reqid }) {
    const q = new URLSearchParams();
    q.set('rpcids', rpcId);
    q.set('source-path', `/notebook/${notebookId}`);
    q.set('_reqid', String(reqid));
    q.set('rt', 'c');
    return `${path}?${q.toString()}`;
  }

  function buildBody({ rpcId, params, at }) {
    // Hai tầng JSON là đúng giao thức batchexecute chứ không phải nhầm:
    // `f.req` là mảng các lời gọi, và tham số của mỗi lời gọi là một CHUỖI JSON.
    const freq = JSON.stringify([[[rpcId, JSON.stringify(params), null, 'generic']]]);
    const body = new URLSearchParams();
    body.set('f.req', freq);
    body.set('at', at);
    return body.toString();
  }

  /* ------------------------------------------------------------------ */
  /* đọc phản hồi                                                         */
  /* ------------------------------------------------------------------ */

  const PREFIX = ")]}'";

  /** Mọi chuỗi trong một cấu trúc lồng, có trần độ sâu và số lượng. */
  function collectStrings(node, out = [], depth = 0) {
    if (out.length >= 200 || depth > 12) return out;
    if (typeof node === 'string') {
      out.push(node);
      return out;
    }
    if (Array.isArray(node)) {
      for (const item of node) collectStrings(item, out, depth + 1);
    } else if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) collectStrings(node[key], out, depth + 1);
    }
    return out;
  }

  function isLimitText(text) {
    const t = norm(text);
    if (!t) return false;
    return limitPatterns.some((p) => t.includes(norm(p)));
  }

  /**
   * Phân biệt "đã thêm" với "đã gửi".
   *
   * "Đã gửi" là fetch trả về — nó không nói gì cả. "Đã thêm" ở đây có nghĩa hẹp
   * và kiểm được: thân phản hồi đúng là batchexecute (có prefix `)]}'`), và
   * trong đó có một frame `wrb.fr` mang CHÍNH rpc id ta vừa gửi, với dữ liệu
   * parse được. Đó cũng là cơ chế phát hiện id đã lỗi thời: Google xoay id thì
   * không frame nào khớp và ta trả `rpc-id-stale`.
   *
   * Nó KHÔNG có nghĩa "một Nguồn đã hiện trong notebook" — hình dạng payload
   * chưa ai đo, nên người gọi trả `verified:false` chứ không dám nói xác minh rồi.
   */
  function readEnvelope(text, rpcId) {
    const body = String(text == null ? '' : text);
    if (body.trimStart().indexOf(PREFIX) !== 0) return { status: 'not-batchexecute' };

    const frames = [];
    let i = body.indexOf(PREFIX) + PREFIX.length;
    for (;;) {
      const open = body.indexOf('[', i);
      if (open === -1) break;
      const json = sliceBalanced(body, open);
      if (!json) break;
      i = open + json.length;
      let chunk = null;
      try {
        chunk = JSON.parse(json);
      } catch (_) {
        continue;
      }
      if (Array.isArray(chunk)) for (const f of chunk) if (Array.isArray(f)) frames.push(f);
    }

    const mine = frames.find((f) => f[0] === 'wrb.fr' && f[1] === rpcId);
    const raw = mine ? mine[2] : null;
    let payload = null;
    let payloadBroken = false;
    if (raw !== null && raw !== undefined && raw !== '') {
      try {
        payload = JSON.parse(raw);
      } catch (_) {
        payloadBroken = true;
      }
    }
    // Thành công THẮNG phép dò chữ bên dưới. Đây là cùng một bài học với
    // `dialogErrorText()` ở `automation.js`: quét chữ rộng tay thì một bộ đếm
    // "Source limit 3/50" nằm lẫn trong phản hồi đủ để huỷ oan cả hàng đợi.
    if (Array.isArray(payload) && payload.length) return { status: 'ok', frames, payload };

    // Chỉ khi KHÔNG có kết quả nào mới đi tìm câu báo giới hạn — và tìm thấy thì
    // đây không phải lỗi của riêng mục này mà là lệnh dừng cả hàng đợi.
    if (collectStrings(frames).some(isLimitText)) return { status: 'limit', frames, limit: true };

    if (!mine) {
      const errors = frames.filter((f) => f[0] === 'er').length;
      const ids = frames.filter((f) => f[0] === 'wrb.fr').map((f) => f[1]);
      return {
        status: 'rpc-id-stale',
        frames,
        detail:
          'server không trả frame nào cho rpc id đã gửi' +
          (ids.length ? `; nó trả cho: ${ids.join(', ')}` : '; không có frame wrb.fr nào') +
          (errors ? `; ${errors} frame lỗi` : ''),
      };
    }
    if (payloadBroken) return { status: 'unreadable-payload', frames };
    return { status: 'empty-payload', frames };
  }

  /**
   * Trạng thái nào thì được phép chạy lại bằng đường DOM.
   *
   * Mặc định của `switch` là UNKNOWN chứ không phải NOT_SENT, và đó là chủ ý:
   * thêm một trạng thái mới mà quên xếp hạng nó thì hậu quả là "chậm và phải
   * kiểm bằng mắt", không phải "âm thầm thêm Nguồn hai lần".
   */
  function outcomeFor(status) {
    switch (status) {
      case 'ok':
        return OUTCOME.ADDED;
      case 'disabled':
      case 'no-notebook-id':
      case 'no-at-token':
      case 'not-batchexecute':
      case 'rpc-id-stale':
      case 'limit':
      case 'http-client-error':
      // Ta dừng trước khi có byte nào rời máy: chắc chắn chưa ghi gì.
      case 'no-fetch':
      case 'rpc-internal':
        return OUTCOME.NOT_SENT;
      /**
       * `transport` = `fetch` ném ra. Trình duyệt KHÔNG cho biết request đã rời
       * máy hay chưa, nên đây là hai ca gộp làm một: hoặc chưa gửi được gì,
       * hoặc đã gửi và server đã ghi xong rồi mới mất phản hồi. Xếp nó vào
       * `not-sent` là khẳng định một điều ta không biết, và cái giá của việc
       * đoán sai là một Nguồn trùng phải xoá tay — thử id thứ hai là lần ghi
       * thứ hai, rồi đường DOM là lần thứ ba.
       */
      case 'transport':
      case 'http-server-error':
      case 'empty-payload':
      case 'unreadable-payload':
        return OUTCOME.UNKNOWN;
      default:
        return OUTCOME.UNKNOWN;
    }
  }

  /** Một kết quả của lượt RPC, với `outcome` luôn suy ra từ `status`. */
  function ket(fields) {
    return Object.assign({}, fields, { outcome: outcomeFor(fields.status) });
  }

  /* ------------------------------------------------------------------ */
  /* một lần gọi                                                          */
  /* ------------------------------------------------------------------ */

  async function attemptOnce({ path, rpcId, params, at, notebookId, fetchImpl, reqid }) {
    const url = buildUrl({ path, rpcId, notebookId, reqid });
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        // 'same-origin' chứ không phải 'include': ta chỉ gọi chính origin này,
        // và cờ hẹp hơn thì không có cách nào lỡ gửi cookie đi nơi khác.
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: buildBody({ rpcId, params, at }),
      });
    } catch (e) {
      return { status: 'transport', detail: redact((e && e.message) || String(e), at) };
    }

    const http = Number(res && res.status) || 0;
    let text = '';
    try {
      text = await res.text();
    } catch (_) {
      text = '';
    }

    if (http >= 500) return { status: 'http-server-error', http };
    if (http >= 400) return { status: 'http-client-error', http };

    const read = readEnvelope(text, rpcId);
    return Object.assign({ http }, read);
  }

  /* ------------------------------------------------------------------ */
  /* một lượt: thử hết ứng viên, rồi kết luận                             */
  /* ------------------------------------------------------------------ */

  function stopTrying(r) {
    return outcomeFor(r.status) !== OUTCOME.NOT_SENT || r.status === 'limit';
  }

  async function tryRpc(spec, opts) {
    // Chờ lần đọc storage đầu tiên: một tin đến sớm hơn nó mà chạy bằng cấu hình
    // mặc định thì công tắc `rpcEnabled` của owner im lặng không có tác dụng.
    await ready;
    const o = opts || {};
    const cfg = config;
    const fetchImpl = o.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    const doc = o.document || root.document;
    const pathname = o.pathname || (root.location && root.location.pathname) || '';

    // Các lối ra sớm KHÔNG tự khai `outcome`. `outcomeFor` là nơi DUY NHẤT xếp
    // hạng một trạng thái, và mặc định của nó là `unknown` — nghĩa là quên xếp
    // hạng một trạng thái mới thì lượt đó dừng lại chứ không lặng lẽ ghi hai
    // lần. Tự khai `outcome` ngay tại chỗ trả về sẽ đi vòng qua đúng cái lưới ấy.
    if (!enabled) return ket({ status: 'disabled', reason: 'đường RPC đang tắt trong Cài đặt', quiet: true });
    if (!fetchImpl) return ket({ status: 'no-fetch', reason: 'trang không có fetch' });

    const notebookId = notebookIdFrom(pathname);
    if (!notebookId) {
      return ket({ status: 'no-notebook-id', reason: 'URL hiện tại không có /notebook/<id>' });
    }

    const found = readAtToken(doc, cfg);
    if (!found) {
      return Object.assign(
        ket({ status: 'no-at-token', reason: 'không tìm thấy token `at` trong WIZ_global_data của trang' }),
        describeAt(null)
      );
    }

    const params = buildParams(spec, cfg, notebookId);
    const tried = [];
    let last = null;

    for (const path of cfg.paths) {
      for (const rpcId of cfg.addSourceIds) {
        const r = await attemptOnce({
          path,
          rpcId,
          params,
          at: found.token,
          notebookId,
          fetchImpl,
          reqid: o.reqid == null ? newReqId() : o.reqid,
        });
        // `path`/`rpcId` là hằng số ngoại sinh chứ không phải bí mật — chúng
        // chính là thứ owner cần đọc khi đi sửa. Token thì không có mặt ở đây.
        tried.push({ path, rpcId, status: r.status, http: r.http == null ? null : r.http });
        last = r;
        // Dừng ngay khi một ứng viên cho kết quả khác "chắc chắn chưa ghi gì".
        // `limit` xếp vào `not-sent` (không có gì được ghi) nhưng vẫn phải dừng:
        // thử id tiếp theo cũng chỉ nhận đúng câu đó.
        if (stopTrying(r)) break;
      }
      if (last && stopTrying(last)) break;
    }

    const status = (last && last.status) || 'no-fetch';
    return Object.assign(
      ket({
        status,
        limit: !!(last && last.limit),
        reason: redact(
          `${status}${last && last.http ? ` (HTTP ${last.http})` : ''}${last && last.detail ? ` — ${last.detail}` : ''}`,
          found.token
        ),
        tried,
      }),
      describeAt(found)
    );
  }

  /* ------------------------------------------------------------------ */
  /* nối vào hai hàm đang có                                              */
  /* ------------------------------------------------------------------ */

  const UNVERIFIED_RPC =
    'Backend NotebookLM đã nhận lệnh thêm Nguồn qua RPC (trả dữ liệu cho đúng rpc id đã gửi), ' +
    'nhưng đường RPC không đọc danh sách Nguồn nên chưa đối chiếu được số Nguồn trước/sau.';

  function addedResult() {
    return {
      ok: true,
      error: null,
      limit: false,
      verified: false,
      unverified: UNVERIFIED_RPC,
      // Đã ghi vào notebook rồi: tầng trên tuyệt đối không được thử đường khác.
      sourceAdded: true,
    };
  }

  function unknownResult(attempt) {
    return {
      ok: false,
      limit: attempt.limit === true,
      verified: false,
      unverified: null,
      // KHÔNG phải "chắc chắn đã thêm" mà là "không được thử lại": server đã
      // thấy request, nên chạy tiếp đường DOM có thể để lại một bản trùng.
      sourceAdded: true,
      error:
        `Đường RPC không đọc được kết quả của lệnh thêm Nguồn (${attempt.reason}). ` +
        'Không rõ notebook đã được ghi hay chưa, và thêm Nguồn không idempotent, ' +
        'nên không chạy lại bằng đường nào nữa — hãy mở notebook kiểm bằng mắt.',
    };
  }

  function limitResult(attempt) {
    return {
      ok: false,
      limit: true,
      verified: false,
      unverified: null,
      sourceAdded: false,
      error: `Đường RPC báo đã chạm giới hạn số Nguồn của notebook (${attempt.reason}).`,
    };
  }

  /** @param {boolean} daRoiXuongDom lượt này có chạy tiếp đường DOM hay không. */
  async function saveReport(khoa, spec, attempt, daRoiXuongDom) {
    try {
      await root.NBLM.saveDomReport(khoa, {
        // KHÔNG đặt tên khoá này là `at`: đó là tên của token, và một khoá
        // mang tên ấy là lời mời cho bản sửa sau điền đúng thứ cấm điền.
        luc: new Date().toISOString(),
        kind: spec.kind,
        reason: attempt.reason,
        status: attempt.status,
        atTokenFound: attempt.atTokenFound === true,
        atKey: attempt.atKey || null,
        atSource: attempt.atSource || null,
        // Phân biệt hai lượt trông giống nhau trong bản chụp: một lượt đã có
        // đường DOM chạy bù, một lượt DỪNG hẳn và đang chờ owner mở notebook
        // kiểm bằng mắt. Thiếu trường này thì hai ca đó đọc ra như nhau.
        daRoiXuongDom: daRoiXuongDom === true,
        tried: attempt.tried || [],
        idsTried: config.addSourceIds.slice(0, 20),
        pathsTried: config.paths.slice(0, 20),
      });
    } catch (_) {
      /* bản chụp hỏng không được làm hỏng lượt import */
    }
  }

  /**
   * Thử RPC, hỏng thì rơi xuống `runDom`.
   *
   * `runDom` là một closure chứ không phải hai đối số (title, text): nhờ vậy chỉ
   * có MỘT chỗ trong file này gọi hàm DOM, và thứ tự đối số ở chỗ đó nằm ngay
   * cạnh chỗ dựng payload để đối chiếu.
   */
  async function route(spec, runDom) {
    let attempt;
    try {
      attempt = await tryRpc(spec);
    } catch (e) {
      // Bản thân đường RPC hỏng thì phải trong suốt với người dùng: rơi xuống
      // DOM, đúng như khi nó trả `not-sent`.
      // Lỗi CỦA CHÍNH ta, ném ra trước khi `attemptOnce` kịp gọi `fetch` (hoặc
      // sau khi nó đã trả về): không có request nào lửng lơ, nên rơi xuống DOM
      // là an toàn. Khác hẳn `transport`, là lúc request đã rời tay ta.
      attempt = ket({ status: 'rpc-internal', reason: `đường RPC lỗi: ${(e && e.message) || e}` });
    }

    if (attempt.outcome === OUTCOME.ADDED) return addedResult();
    if (attempt.limit === true) return limitResult(attempt);
    if (attempt.outcome === OUTCOME.UNKNOWN) {
      // Ca ĐÁNG ghi bản chụp nhất, chứ không phải ca được miễn: đây là lượt duy
      // nhất kết thúc mà không ai biết notebook đã được ghi hay chưa, và owner
      // chỉ có bản chụp để lần lại xem chuyện gì đã xảy ra.
      if (!attempt.quiet) await saveReport(REPORT.RPC_UNKNOWN, spec, attempt, false);
      return unknownResult(attempt);
    }

    if (!attempt.quiet) await saveReport(REPORT.RPC_UNUSABLE, spec, attempt, true);

    const dom = await runDom();
    // Vì sao RPC bị bỏ qua chỉ đi vào chỗ này và vào bản chụp. Không đính khi
    // đường DOM thành công: lúc đó nó là chuyện nội bộ, không phải tin của owner.
    if (dom && dom.ok === false && attempt.reason) {
      dom.error = dom.error
        ? `${dom.error} — (đã bỏ qua đường RPC: ${attempt.reason})`
        : `đường DOM thất bại không kèm lý do — (đã bỏ qua đường RPC: ${attempt.reason})`;
    }
    return dom;
  }

  const DOM = root.NBLM_AUTOMATION;

  // Không có `automation.js` thì không bọc gì cả — `tools/probe-notebooklm.mjs`
  // nạp file này một mình để đo `readAtToken` trên trang thật.
  if (DOM) {
    root.NBLM_AUTOMATION = Object.assign({}, DOM, {
      addUrlSource(url, opts) {
        return route({ kind: isYouTubeUrl(url) ? 'youtube' : 'url', url }, () => DOM.addUrlSource(url, opts));
      },
      addTextSource(title, text, opts) {
        return route({ kind: 'text', title, text }, () => DOM.addTextSource(title, text, opts));
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* nạp cấu hình                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * `content.js` chỉ chuyển `selectorOverrides` cho `A.configure`, và ticket
   * yêu cầu không sửa file đó — nên phần cấu hình của RPC tự đọc lấy. `ready`
   * tồn tại để một tin đến sớm hơn lần đọc storage đầu tiên không lặng lẽ chạy
   * bằng cấu hình mặc định.
   */
  if (typeof root.chrome !== 'undefined' && root.chrome && root.chrome.storage) {
    ready = root.NBLM.getSettings().then(configure, () => {});
    root.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[root.NBLM.KEYS.SETTINGS]) {
        configure(changes[root.NBLM.KEYS.SETTINGS].newValue || {});
      }
    });
  }

  root.NBLM_RPC = {
    BASE,
    REPORT,
    OUTCOME,
    configure,
    tryRpc,
    get config() {
      return config;
    },
    get enabled() {
      return enabled;
    },
    // xuất ra để test và để gỡ lỗi trong DevTools console
    _internals: {
      sliceBalanced,
      readAtToken,
      describeAt,
      redact,
      notebookIdFrom,
      isYouTubeUrl,
      putAt,
      bocLai,
      buildSpec,
      buildParams,
      buildUrl,
      buildBody,
      newReqId,
      readEnvelope,
      outcomeFor,
      collectStrings,
      isLimitText,
      route,
    },
  };
})(globalThis);
