// Cầu MAIN world: đọc `ytcfg` và mượn header `Authorization: SAPISIDHASH` của YouTube.
//
// ĐÂY LÀ FILE NHẠY CẢM NHẤT REPO. Nó chạy trong ngữ cảnh của trang, hook `fetch`/`XHR`, và
// nhìn thấy đúng bộ header mà YouTube tự gửi cho InnerTube. Phạm vi của nó — `NBLM_BRIDGE_PROTOCOL.OPS`
// — là **hai việc**: đọc ytcfg, và liệt kê playlist. Mở rộng phạm vi file này là quyết định
// của owner, không phải của Lead và không phải của peer (`WORKSPACE_PROTOCOL.md`).
//
// Vì sao transcript **không** đi qua đây: PoToken là chứng minh nguồn gốc chứ không phải xác
// thực. Header mượn được trả lời "bạn là ai", không chạm tới câu "bạn có phải player thật
// không", nên với video private nó không mở được đường nào — chỉ làm phạm vi rộng ra vô ích
// (ADR 0003).
//
// Ba cái ở dưới là thuần và test được (`test/bridge.test.js`); phần hook chỉ tự cài khi thật
// sự đang ở trong một trang.
(function (root) {
  'use strict';

  if (root.NBLM_PAGE_BRIDGE) return;

  const P = root.NBLM_BRIDGE_PROTOCOL;
  if (!P) throw new Error('page-bridge: cần src/youtube/bridge-protocol.js nạp trước');

  const INNERTUBE_MARK = '/youtubei/';
  const BROWSE_ENDPOINT = 'https://www.youtube.com/youtubei/v1/browse';

  const str = (value) => (value == null ? '' : String(value));

  // ------------------------------------------------------------------ mượn header

  /** Cặp header dạng `Headers`, mảng, hay object thuần — cả ba đều gặp trên trang YouTube. */
  function headerEntries(headers) {
    if (!headers) return [];
    if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
      const out = [];
      headers.forEach((value, name) => out.push([name, value]));
      return out;
    }
    if (Array.isArray(headers)) return headers;
    if (typeof headers === 'object') return Object.entries(headers);
    return [];
  }

  /**
   * Nhặt `Authorization` **chỉ từ chính request InnerTube của YouTube**. Hẹp lại theo URL để
   * cầu không vô tình gom header của bất kỳ request nào khác trên trang.
   */
  function captureAuth(url, headers) {
    if (!str(url).includes(INNERTUBE_MARK)) return '';
    for (const [name, value] of headerEntries(headers)) {
      if (str(name).toLowerCase() === 'authorization') return str(value);
    }
    return '';
  }

  /** Header mượn chỉ đi kèm op được phép — mọi op khác nhận về object rỗng, không phải `undefined`. */
  function authHeadersFor(op, borrowed) {
    if (!P.allowsAuth(op) || !borrowed) return {};
    return { Authorization: str(borrowed) };
  }

  // ------------------------------------------------------------------ đọc ytcfg

  function ytcfgValue(ytcfg, key) {
    if (!ytcfg) return undefined;
    if (typeof ytcfg.get === 'function') {
      try {
        return ytcfg.get(key);
      } catch {
        return undefined;
      }
    }
    if (ytcfg.data_ && typeof ytcfg.data_ === 'object' && key in ytcfg.data_) return ytcfg.data_[key];
    return ytcfg[key];
  }

  /**
   * Ảnh chụp `ytcfg` theo **danh sách trắng**, không phải danh sách đen. Đây là khác biệt quan
   * trọng: `ytcfg` chứa `DELEGATED_SESSION_ID`, `ID_TOKEN`, `visitorData`… và YouTube thêm
   * trường mới bất cứ lúc nào. Chọn ra năm trường InnerTube cần thì một trường lạ *không bao
   * giờ* lọt sang phía extension; lọc bỏ những trường đã biết thì mỗi lần YouTube thêm gì đó
   * là một lần rò không ai thấy.
   */
  function ytcfgSnapshot(ytcfg) {
    const context = ytcfgValue(ytcfg, 'INNERTUBE_CONTEXT') || {};
    const client = context.client || {};
    return {
      apiKey: str(ytcfgValue(ytcfg, 'INNERTUBE_API_KEY')),
      clientName: str(ytcfgValue(ytcfg, 'INNERTUBE_CLIENT_NAME') || client.clientName),
      clientVersion: str(ytcfgValue(ytcfg, 'INNERTUBE_CLIENT_VERSION') || client.clientVersion),
      hl: str(client.hl),
      gl: str(client.gl),
    };
  }

  /**
   * `context.client` của InnerTube: `clientName` ở đây là **tên** (`WEB`), còn con số `1` là
   * thứ đi ở header `X-Youtube-Client-Name`. Bản sao nhỏ này cố ý không dùng chung với
   * `transcript.js`: file kia chạy ở ISOLATED world, còn ở đây mỗi phụ thuộc thêm vào là một
   * lần nữa phải xin owner duyệt phạm vi.
   */
  function innertubeClient(snapshot) {
    return {
      clientName: !snapshot.clientName || snapshot.clientName === '1' ? 'WEB' : snapshot.clientName,
      clientVersion: snapshot.clientVersion,
      hl: snapshot.hl,
      gl: snapshot.gl,
    };
  }

  // ------------------------------------------------------------------ điều phối

  const fail = (message) => ({ ok: false, error: String(message) });

  /**
   * Xử lý một yêu cầu từ content script. Không ném ra ngoài: mọi lỗi thành một câu trả lời có
   * lời, vì đầu bên kia là một Promise đang chờ — ném ra đây là để nó treo mãi.
   */
  async function handleRequest(message, deps) {
    const op = str(message && message.op);
    if (!P.serves(op)) {
      return fail(`cầu MAIN world không phục vụ "${op}" — phạm vi của nó chỉ có: ${P.OPS.join(', ')}`);
    }

    const params = (message && message.params) || {};
    if (op === P.YTCFG) return { ok: true, result: ytcfgSnapshot(deps.ytcfg) };

    // Còn lại đúng một op: liệt kê playlist, chỗ duy nhất header mượn được đi ra.
    const headers = authHeadersFor(op, deps.borrowedAuth);
    if (!headers.Authorization) {
      return fail('chưa mượn được header Authorization của YouTube — hãy để trang tải xong rồi thử lại');
    }

    try {
      // Cầu chỉ chuyển đúng một lượt gọi. Phân trang và bóc dữ liệu nằm ngoài MAIN world:
      // càng ít logic ở file này càng ít thứ phải xin owner duyệt.
      const snapshot = ytcfgSnapshot(deps.ytcfg);
      const result = await deps.fetchJson({
        // `key` đi ở query string, `client` **không** mang apiKey: đó là hình dạng InnerTube
        // nhận. Nhét apiKey vào `context.client` thì máy chủ trả 400 và triệu chứng là
        // "liệt kê playlist không bao giờ chạy", không phải một lỗi đọc ra được.
        url: `${BROWSE_ENDPOINT}?key=${encodeURIComponent(snapshot.apiKey)}&prettyPrint=false`,
        headers: {
          'Content-Type': 'application/json',
          'X-Youtube-Client-Name': snapshot.clientName || '1',
          'X-Youtube-Client-Version': snapshot.clientVersion,
          ...headers,
        },
        body: {
          context: { client: innertubeClient(snapshot) },
          ...(params.continuation ? { continuation: str(params.continuation) } : {}),
          ...(params.browseId ? { browseId: str(params.browseId) } : {}),
        },
      });
      return { ok: true, result };
    } catch (error) {
      return fail(error && error.message ? error.message : error);
    }
  }

  // ------------------------------------------------------------------ cài vào trang

  /**
   * Chỉ cài khi thật sự đang ở trong một trang. Nhờ vậy file này `require` được vào node để
   * test ba hàm trên — thứ duy nhất còn lại ở đây là phần không test tự động được.
   */
  function install(target) {
    let borrowedAuth = '';

    const originalFetch = target.fetch;
    if (typeof originalFetch === 'function') {
      target.fetch = function (input, init) {
        try {
          const url = input && input.url ? input.url : input;
          const headers = (init && init.headers) || (input && input.headers);
          borrowedAuth = captureAuth(url, headers) || borrowedAuth;
        } catch {
          // Hook không bao giờ được làm hỏng request của trang.
        }
        // `this` là `undefined` khi trang gọi `fetch(...)` trần trong module strict — gọi
        // `apply(undefined)` là `Illegal invocation`, tức hook làm hỏng request của chính trang.
        return originalFetch.apply(this || target, arguments);
      };
    }

    const XHR = target.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const open = XHR.prototype.open;
      const setRequestHeader = XHR.prototype.setRequestHeader;
      XHR.prototype.open = function (method, url) {
        this.__nblmUrl = str(url);
        return open.apply(this, arguments);
      };
      XHR.prototype.setRequestHeader = function (name, value) {
        const borrowed = captureAuth(this.__nblmUrl, { [str(name)]: value });
        if (borrowed) borrowedAuth = borrowed;
        return setRequestHeader.apply(this, arguments);
      };
    }

    const deps = {
      get ytcfg() {
        return target.ytcfg;
      },
      get borrowedAuth() {
        return borrowedAuth;
      },
      async fetchJson(request) {
        const response = await originalFetch.call(target, request.url, {
          method: 'POST',
          credentials: 'include',
          headers: request.headers,
          body: JSON.stringify(request.body),
        });
        if (!response.ok) throw new Error(`InnerTube trả HTTP ${response.status}`);
        return response.json();
      },
    };

    target.addEventListener('message', async (event) => {
      // Ba content script có thể gặp nhau trên cùng một tab: im lặng với tin không phải của
      // mình còn hơn trả lời sai (spec 0001).
      if (event.source !== target) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.tag !== P.REQUEST) return;

      const response = await handleRequest(data, deps);
      target.postMessage({ ...response, tag: P.RESPONSE, id: data.id }, target.location.origin);
    });
  }

  root.NBLM_PAGE_BRIDGE = Object.freeze({
    captureAuth,
    authHeadersFor,
    ytcfgSnapshot,
    handleRequest,
    install,
  });

  if (root.document && typeof root.addEventListener === 'function') install(root);
})(typeof globalThis !== 'undefined' ? globalThis : self);
