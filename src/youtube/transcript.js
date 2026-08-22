// Ba đường trích transcript và bộ định tuyến theo Mức riêng tư — ADR 0003.
//
// Điểm cốt lõi của ADR 0003: **không thử tuần tự khi đã biết là private.** PoToken là cơ chế
// chứng minh nguồn gốc chứ không phải xác thực, nên với video private cả hai đường API hỏng vì
// lý do cấu trúc — thử rồi hỏng chỉ tốn hai lần gọi mạng ở *mọi* video. Mức riêng tư biết
// trước khi trích, nên định tuyến thẳng.
//
// Ranh giới đi kèm, và là ràng buộc của `WORKSPACE_PROTOCOL.md`: header
// `Authorization: SAPISIDHASH` mà `page-bridge.js` mượn được **chỉ dùng để liệt kê playlist**.
// Không đường nào trong file này gửi nó đi — `test/transcript.test.js` canh chuyện đó.
//
// File này không chạm `chrome.*` và không chạm `document` toàn cục: mọi hàm DOM nhận vào một
// cây node, mọi lần gọi mạng đi qua adapter được tiêm. Đó là điều kiện để test bằng cây giả.
(function (root) {
  'use strict';

  if (root.NBLM_TRANSCRIPT) return;

  const S = root.NBLM_SHARED;
  const Y = root.NBLM_YT_SELECTORS;
  if (!S) throw new Error('youtube/transcript: cần src/common/shared.js nạp trước');
  if (!Y) throw new Error('youtube/transcript: cần src/youtube/selectors.js nạp trước');

  const PRIVATE = 'private';

  /**
   * Chuỗi phương án cho video *không* private. Thứ tự này là ADR 0003 + ADR 0013, không phải
   * tuỳ chọn — và nó được xếp theo **số đo trên trang thật**, không theo suy đoán (ticket 013):
   *
   *   - `panel` (`/youtubei/v1/get_panel`) đứng đầu vì nó là endpoint mà **chính giao diện
   *     YouTube** gọi khi người ta bấm nút Transcript, và nó chạy: 3/3 video có phụ đề trả
   *     HTTP 200 kèm đủ segment, kể cả một video mà đường DOM trích được 0 dòng.
   *   - `innertube` (`get_transcript`) tụt xuống hàng hai vì nó **đã chết**: HTTP 400
   *     FAILED_PRECONDITION với cả chuỗi `params` do chính YouTube đúc. Giữ lại chứ không xoá
   *     (xoá code là quyết định của owner), nhưng nó chỉ chạy sau khi `panel` đã hỏng.
   *   - `timedtext` **không còn trong tuyến**: `exp=xpe` trả HTTP 200 body 0 byte ở 3/3 video và
   *     ở cả năm biến thể URL đã thử. Một mục tuyến không bao giờ thắng chỉ tổ thêm một dòng lý
   *     do sai vào bảng tổng kết (`viaTimedText` vẫn còn trong file, xem ADR 0013).
   */
  const API_ROUTE = Object.freeze(['panel', 'innertube', 'dom']);
  const PRIVATE_ROUTE = Object.freeze(['dom']);

  /**
   * Vì sao một lượt quét không ra transcript. Bốn lý do, và ranh giới giữa chúng là thứ người
   * đọc lỗi dựa vào để biết phải làm gì:
   *
   *   - `NARROW` — panel bị layout hẹp giữ ẩn. Người dùng kéo rộng cửa sổ là xong; chờ thêm thì
   *     vô ích, nên đây là lý do **duy nhất** cắt đường thử lại (`viaDom`, `watch.scanPanel`).
   *   - `UNRECOGNIZED` — panel đang mở, chữ nằm ngay đó, nhưng không selector nào của
   *     `selectors.js` với tới. Người dùng không làm gì được; phải sửa selector (hoặc ghi đè từ
   *     trang Cài đặt). Ticket 017: đúng ca này từng bị gọi tên là `NARROW`, và vì `NARROW` cắt
   *     đường lui nên một lần dò hụt thành một lần bỏ cuộc.
   *   - `NO_PANEL` / `EMPTY` — chưa thấy gì / chưa dựng xong: chờ thêm là hết.
   *
   * `NARROW` và `UNRECOGNIZED` là một cặp hoán vị được: cả hai đều là lý do hợp lệ, cả hai đều
   * dừng lượt chạy, nên đổi chỗ chúng không làm hỏng lần chạy nào — chỉ đẩy người đọc lỗi đi
   * sai hướng (`WORKSPACE_PROTOCOL.md`). `test/transcript.test.js` canh quan hệ ấy.
   */
  const REASON = Object.freeze({
    NARROW: 'narrow-window',
    UNRECOGNIZED: 'panel-unrecognized',
    NO_PANEL: 'no-panel',
    EMPTY: 'empty',
    // Hai mã dưới đây là của đường mạng, và chúng tồn tại **vì chúng phải khác nhau**
    // (ticket 013). Chúng là hai câu trả lời khác hẳn nhau cho cùng một triệu chứng "0 segment":
    NO_CAPTIONS: 'no-captions',
    BLANK: 'blank-response',
  });

  /** Một cú bấm thật. `el.click()` một mình không mở được panel của YouTube. */
  const PRESS_SEQUENCE = Object.freeze(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);

  /** Nhãn ngắn không tham gia khớp mờ — cùng ngưỡng với bên NotebookLM (spec 0001). */
  const MIN_FUZZY_LABEL = 4;

  const INNERTUBE_ENDPOINT = 'https://www.youtube.com/youtubei/v1/get_transcript';

  /**
   * Hai giá trị lui của `context.client`, tách ra thành hằng **có tên theo vai trò** vì `hl` và
   * `gl` là một cặp hoán vị được: hai chuỗi cùng kiểu, lấy từ cùng một đối tượng `ytcfg`, đi vào
   * hai trường nằm cạnh nhau. Đổi chỗ chúng thì request vẫn HTTP 200, vẫn đủ segment, mốc vẫn
   * tăng dần — nhưng `hl` là thứ chọn **ngôn ngữ bản transcript trả về**, nên ở một video có
   * nhiều bản phụ đề nó lấy về bản sai ngôn ngữ mà không có triệu chứng nào. Tên Nguồn dựng từ
   * đó là vĩnh viễn (ADR 0010) và ADR 0009 đọc chính tên ấy để biết phần nào đã có.
   *
   * Vì sao một phép đo trên trang thật *không* bắt được: video tiếng Anh + giao diện tiếng Anh
   * thì gửi sai cả hai trường vẫn rơi về đúng một kết quả. Đó là fixture n=1 của ticket 017,
   * lần này n=1 nằm ở **lựa chọn video** chứ không ở fixture — nên chỗ canh phải là test dữ liệu
   * dưới đây, không phải `tools/verify-live.mjs`.
   */
  const FALLBACK_LANGUAGE = 'vi'; // → hl
  const FALLBACK_COUNTRY = 'VN'; // → gl

  /**
   * `context.client` của InnerTube — **một bản duy nhất** cho cả `get_transcript` lẫn
   * `get_panel`. Trước ticket 013 nó là hai khối chép tay giống hệt nhau trong cùng file này;
   * sửa một bản để bản kia lệch đi là đúng loại nợ mà ticket 014 vừa dọn.
   *
   * (`page-bridge.js` vẫn giữ bản riêng của nó, và đó là chủ ý: file kia chạy ở MAIN world, nơi
   * mỗi phụ thuộc thêm vào là một lần nữa phải xin owner duyệt phạm vi.)
   *
   * `clientName` ở đây là **tên** (`WEB`), còn con số `1` là thứ đi ở header
   * `X-Youtube-Client-Name` (`innertubeHeaders`). Hai trường cùng tên, hai dạng giá trị khác
   * nhau, hai chỗ khác nhau — nên chúng cũng là một cặp phải canh.
   */
  function innertubeClient(ytcfg) {
    const cfg = ytcfg || {};
    return {
      clientName: cfg.clientName === '1' || !cfg.clientName ? 'WEB' : String(cfg.clientName),
      clientVersion: String(cfg.clientVersion || ''),
      hl: String(cfg.hl || FALLBACK_LANGUAGE),
      gl: String(cfg.gl || FALLBACK_COUNTRY),
    };
  }

  /**
   * Header của một lượt gọi InnerTube. Không có `Authorization` ở đây, và sẽ không bao giờ có:
   * hai đường mạng của file này chỉ chạy cho video unlisted/public — thứ không cần biết "bạn là
   * ai" — còn header mượn được thì thuộc về việc liệt kê playlist (ADR 0003,
   * `WORKSPACE_PROTOCOL.md`). Hàm này không nhận tham số nào để thêm header, nên không có đường
   * nào chuyền lén một cái vào.
   */
  function innertubeHeaders(ytcfg) {
    const cfg = ytcfg || {};
    return {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': String(cfg.clientName || '1'),
      'X-Youtube-Client-Version': String(cfg.clientVersion || ''),
    };
  }

  const collapse = (value) => S.collapse(value);
  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));
  /** Mã máy đọc được của một lỗi trích, hoặc chuỗi rỗng khi lỗi không tự khai mã nào. */
  const codeOf = (error) => (error && error.reason ? String(error.reason) : '');

  /** Gắn mã vào một lỗi rồi ném — dạng viết gọn của cặp `reason` + `message` dùng khắp file. */
  function reasoned(code, message) {
    const error = new Error(message);
    error.reason = code;
    return error;
  }
  const selectorsOf = (options) => (options && options.selectors ? Y.resolve(options.selectors) : Y.DEFAULT);

  /** Mili-giây của InnerTube/timedtext sang giây. Chuỗi `"1000"` cũng là dạng hợp lệ ở đó. */
  function seconds(ms) {
    const n = Number(ms);
    return Number.isFinite(n) && n > 0 ? n / 1000 : 0;
  }

  // ------------------------------------------------------------------ định tuyến

  function routeFor(privacy) {
    return privacy === PRIVATE ? [...PRIVATE_ROUTE] : [...API_ROUTE];
  }

  /**
   * Chạy tuyến cho tới đường đầu tiên trả về được, rồi trả `{ segments, via, attempts }`.
   *
   * `attempts` là thứ duy nhất nói được *vì sao* một video rớt — engine hàng đợi đưa lý do đó
   * thẳng vào bảng tổng kết, nơi một mục mất tích phải hiện ra thành một dòng (ADR 0008).
   */
  async function fetchTranscript(request, paths, options) {
    const req = request || {};
    const route = routeFor(req.privacy);
    const attempts = [];

    for (const name of route) {
      const path = paths && paths[name];
      if (typeof path !== 'function') {
        attempts.push({ path: name, ok: false, reason: 'không có adapter cho đường này', code: '' });
        continue;
      }
      try {
        const segments = await path(req, options);
        if (Array.isArray(segments) && segments.length > 0) {
          attempts.push({ path: name, ok: true, segments: segments.length, code: '' });
          return { segments, via: name, attempts };
        }
        attempts.push({ path: name, ok: false, reason: 'trả về rỗng', code: REASON.EMPTY });
      } catch (error) {
        // `reason` là câu chữ cho người đọc; `code` là **dữ liệu** cho máy đọc. Hai ca "video
        // không có phụ đề" và "gọi được mà không ra dòng nào" phải tách nhau ở đây chứ không ở
        // câu chữ, vì câu chữ đổi được mà quyết định "có ghi vào Sổ đã import không" thì không
        // được đổi theo (ticket 013, ADR 0009).
        attempts.push({ path: name, ok: false, reason: messageOf(error), code: codeOf(error) });
      }
    }

    const trail = attempts.map((a) => `${a.path} — ${a.reason}`).join('; ');
    const error = new Error(`không lấy được transcript của ${req.videoId || '(không rõ video)'}: ${trail}`);
    error.attempts = attempts;
    throw error;
  }

  // ------------------------------------------------------- đường 1: InnerTube

  /** Gom mọi giá trị nằm dưới một khoá, ở bất kỳ độ sâu nào — hình dạng lồng của InnerTube đổi luôn. */
  function collectByKey(node, key, out) {
    const acc = out || [];
    if (Array.isArray(node)) {
      for (const child of node) collectByKey(child, key, acc);
      return acc;
    }
    if (!node || typeof node !== 'object') return acc;
    for (const [k, value] of Object.entries(node)) {
      if (k === key) acc.push(value);
      else collectByKey(value, key, acc);
    }
    return acc;
  }

  const snippetText = (snippet) => {
    if (!snippet) return '';
    if (Array.isArray(snippet.runs)) return collapse(snippet.runs.map((r) => (r && r.text) || '').join(''));
    return collapse(snippet.simpleText);
  };

  /**
   * `startMs` và `endMs` là hai chuỗi số cùng kiểu nằm cạnh nhau: hoán vị chúng vẫn ra segment
   * "hợp lệ" và vẫn dựng được file SRT mở lên xem được. Test phải chốt từng cặp giá trị.
   */
  function parseInnertubeTranscript(payload) {
    const out = [];
    for (const seg of collectByKey(payload, 'transcriptSegmentRenderer')) {
      if (!seg) continue;
      const text = snippetText(seg.snippet);
      if (!text) continue;
      out.push({ start: seconds(seg.startMs), end: seconds(seg.endMs), text });
    }
    return out;
  }

  async function viaInnertube(request, net, options) {
    const req = request || {};
    const cfg = req.ytcfg || {};
    if (!net || typeof net.post !== 'function') throw new Error('InnerTube: thiếu adapter mạng');
    if (!cfg.apiKey) throw new Error('InnerTube: chưa đọc được ytcfg của tab YouTube');

    const headers = innertubeHeaders(cfg);
    const body = {
      context: { client: innertubeClient(cfg) },
      videoId: String(req.videoId || ''),
    };
    // `get_transcript` nhận `params` dạng protobuf base64 của videoId. Mã hoá dưới đây **chưa
    // kiểm được trên API thật** ở đây (không có mạng trong test) — `tools/verify-live.mjs` là
    // chỗ phát hiện nếu sai; `videoId` vẫn gửi kèm nên còn một đường cho máy chủ hiểu.
    const params = transcriptParams(body.videoId);
    if (params) body.params = params;

    const payload = await net.post({
      url: `${INNERTUBE_ENDPOINT}?key=${encodeURIComponent(cfg.apiKey)}&prettyPrint=false`,
      headers,
      body,
    });

    const segments = parseInnertubeTranscript(payload);
    if (segments.length === 0) throw new Error('InnerTube: get_transcript không trả về segment nào');
    return segments;
  }

  /** protobuf `{1: videoId}` rồi base64url — dạng `params` mà `get_transcript` nhận. */
  function transcriptParams(videoId) {
    if (!videoId) return '';
    const bytes = [0x0a, videoId.length, ...Array.from(videoId, (c) => c.charCodeAt(0))];
    const raw = String.fromCharCode(...bytes);
    const b64 = typeof root.btoa === 'function' ? root.btoa(raw) : Buffer.from(raw, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_');
  }

  // ------------------------------------------------------- đường 2: get_panel

  const PANEL_ENDPOINT = 'https://www.youtube.com/youtubei/v1/get_panel';

  /**
   * Danh tính của bảng transcript trong InnerTube. Chuỗi này đo được, không đoán: nó là
   * `panelId` mà chính trang gửi đi khi bấm nút Transcript, và cũng là `target-id` của panel
   * transcript trên DOM (`tools/verify-live.mjs` in ra cả hai).
   */
  const PANEL_ID = 'PAmodern_transcript_view';

  /**
   * `params` của `get_panel`: protobuf `{149: {1: videoId, 3: 1}}` rồi base64url.
   *
   * Khác `transcriptParams()` của `get_transcript` ở chỗ nó **đã được đối chiếu byte với byte**
   * với chuỗi trang thật gửi đi (`qgkPCgtqTlFYQUM5SVZSdxgB` cho `jNQXAC9IVRw`), chứ không viết
   * theo hiểu biết. Đó là khác biệt mà ticket 012 trả giá để học.
   */
  function panelParams(videoId) {
    const id = String(videoId || '');
    if (!id) return '';
    const inner = [0x0a, id.length, ...Array.from(id, (c) => c.charCodeAt(0)), 0x18, 0x01];
    const bytes = [0xaa, 0x09, inner.length, ...inner];
    const raw = String.fromCharCode(...bytes);
    const b64 = typeof root.btoa === 'function' ? root.btoa(raw) : Buffer.from(raw, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_');
  }

  /** Chữ của một `transcriptSegmentViewModel`: `simpleText`, hoặc `runs` khi YouTube tách đoạn. */
  const viewModelText = (model) => {
    if (!model) return '';
    if (Array.isArray(model.runs)) return collapse(model.runs.map((r) => (r && r.text) || '').join(''));
    return collapse(model.simpleText);
  };

  /** `transcriptSegmentViewModel` đầu tiên nằm trong một mục dòng thời gian, hoặc `null`. */
  function segmentViewModel(item) {
    const timeline = item && item.item && item.item.timelineItemViewModel;
    const contents = timeline && Array.isArray(timeline.contentItems) ? timeline.contentItems : [];
    for (const content of contents) {
      if (content && content.transcriptSegmentViewModel) return content.transcriptSegmentViewModel;
    }
    return null;
  }

  /**
   * Mốc bắt đầu của một mục: **số giây của `watchEndpoint`**, không phải chuỗi mốc hiển thị.
   *
   * Hai giá trị này cùng đơn vị và trên trang thật luôn bằng nhau (`"0:01"` ↔ `1`), nên hoán vị
   * chúng không làm hỏng lần chạy nào — đúng hình "hai nguồn cùng đơn vị, một cái đo được một
   * cái là hình chiếu" của `WORKSPACE_PROTOCOL.md`. Chọn số đo được vì chuỗi hiển thị phụ thuộc
   * ngôn ngữ giao diện và mất nghĩa ở video dài; chuỗi chỉ là đường lui khi YouTube không gửi số.
   */
  function segmentStart(item, model) {
    const endpoint = item && item.onTap && item.onTap.innertubeCommand && item.onTap.innertubeCommand.watchEndpoint;
    // `== null` chứ không phải `Number(...)` trần: `Number(null)` là **0**, một con số hoàn toàn
    // hợp lệ và lọt qua mọi phép kiểm `isFinite`. Một `watchEndpoint: null` (hay
    // `startTimeSeconds: null`) vì thế sẽ thành "dòng này bắt đầu ở giây 0" thay vì rơi về chuỗi
    // mốc — và một dòng mốc 0 chen giữa transcript vẫn dựng ra file SRT mở lên xem được.
    const raw = endpoint == null ? undefined : endpoint.startTimeSeconds;
    const measured = raw == null ? NaN : Number(raw);
    if (Number.isFinite(measured) && measured >= 0) return measured;
    return parseClock(model && model.timestamp);
  }

  /**
   * `get_panel` → `{ start, text }[]`.
   *
   * Mốc và chữ đọc **từ cùng một mục**, không phải từ hai lượt gom rồi ghép theo chỉ số. Trong
   * cùng danh sách ấy có những mục **không phải segment** — tiêu đề chương
   * (`timelineChapterViewModel`) mang `watchEndpoint` đầy đủ nhưng không có dòng chữ nào — nên
   * hai lượt gom song song sẽ lệch nhau đúng một nấc kể từ chương đầu tiên, và kết quả vẫn là
   * một transcript trông hoàn toàn hợp lệ với mọi mốc sai chỗ.
   */
  function parsePanelTranscript(payload) {
    const out = [];
    for (const item of collectByKey(payload, 'macroMarkersPanelItemViewModel')) {
      const model = segmentViewModel(item);
      if (!model) continue; // tiêu đề chương và mọi thứ không phải một dòng transcript
      const text = viewModelText(model);
      if (!text) continue;
      out.push({ start: segmentStart(item, model), text });
    }
    return out;
  }

  /**
   * Đường `get_panel` — endpoint mà **chính giao diện YouTube** gọi khi người ta bấm nút
   * Transcript (đo ở ticket 012, chọn ở ADR 0013).
   *
   * Hàm này phải trả lời được hai câu hỏi khác hẳn nhau mà triệu chứng giống hệt nhau —
   * "0 segment" — và phải trả lời **bằng dữ liệu**, vì một lượt trích "thành công" mà rỗng sẽ
   * ghi vào Sổ đã import một video chưa hề trích được gì (ADR 0009):
   *
   *   - `NO_CAPTIONS` — video này không có phụ đề. Bằng chứng: `captionTracks` rỗng *của đúng
   *     video này*, hoặc câu trả lời không có khối `content` nào (đo được: một video không phụ
   *     đề trả HTTP 200 dài 960 byte, chỉ có `responseContext` và `trackingParams`).
   *   - `BLANK` — có khối `content` mà không đọc ra dòng nào. Đây là **hỏng**, không phải
   *     "không có phụ đề", và nó là ca mà `timedtext` rơi vào ở mọi video (HTTP 200, 0 byte).
   *
   * Ảnh chụp `playerResponse` chỉ được dùng khi nó **nói về đúng video này**. Đo trên trang
   * thật: sau một lần điều hướng SPA, `location.href` đã sang video B mà
   * `ytInitialPlayerResponse.videoDetails.videoId` vẫn là video A, kèm nguyên danh sách caption
   * track của A. Tin nó lúc ấy là tuyên bố "video B không có phụ đề" dựa trên video A — đúng
   * hình lặp lại "một thứ của video A còn sống trên trang video B" (`WORKSPACE_PROTOCOL.md`).
   * Ảnh chụp lệch id vì thế bị **bỏ qua**, không bị coi là lỗi: nó không phải bằng chứng chống
   * lại video này, nó chỉ không phải bằng chứng về video này. Câu trả lời của `get_panel` mới
   * là chỗ phân biệt cuối cùng.
   */
  async function viaPanel(request, net) {
    const req = request || {};
    const cfg = req.ytcfg || {};
    const videoId = String(req.videoId || '');
    if (!net || typeof net.post !== 'function') throw new Error('get_panel: thiếu adapter mạng');
    if (!cfg.apiKey) throw new Error('get_panel: chưa đọc được ytcfg của tab YouTube');
    if (!videoId) throw new Error('get_panel: không biết đang trích video nào');

    const player = req.player || null;
    const aboutThisVideo = !!(player && player.videoId && player.videoId === videoId);
    if (aboutThisVideo && Array.isArray(player.captionTracks) && player.captionTracks.length === 0) {
      throw reasoned(
        REASON.NO_CAPTIONS,
        `get_panel: trang khai video ${videoId} không có caption track nào — không có phụ đề để trích`,
      );
    }

    const payload = await net.post({
      url: `${PANEL_ENDPOINT}?key=${encodeURIComponent(cfg.apiKey)}&prettyPrint=false`,
      headers: innertubeHeaders(cfg),
      body: {
        context: { client: innertubeClient(cfg) },
        panelId: PANEL_ID,
        params: panelParams(videoId),
      },
    });

    if (!payload || !payload.content) {
      throw reasoned(
        REASON.NO_CAPTIONS,
        `get_panel: câu trả lời không có khối content — YouTube nói video ${videoId} không có bảng transcript`,
      );
    }
    const segments = parsePanelTranscript(payload);
    if (segments.length === 0) {
      throw reasoned(
        REASON.BLANK,
        `get_panel: có khối content nhưng không đọc ra dòng nào của video ${videoId} — HTTP 200 rỗng là HỎNG, không phải "video không có phụ đề"`,
      );
    }
    return segments;
  }

  // ------------------------------------------------------- đường 3: timedtext

  /**
   * `tStartMs` và `dDurationMs` cũng là một cặp cùng kiểu hoán vị được: đổi chỗ vẫn ra segment
   * có start và end hợp lệ, chỉ là sai chỗ. `end` suy ra bằng cộng, không phải bằng gán.
   */
  function parseTimedText(payload) {
    const events = payload && Array.isArray(payload.events) ? payload.events : [];
    const out = [];
    for (const event of events) {
      // Event không có `segs` là định nghĩa cửa sổ hiển thị, không phải chữ.
      if (!event || !Array.isArray(event.segs)) continue;
      const text = collapse(event.segs.map((s) => (s && typeof s.utf8 === 'string' ? s.utf8 : '')).join(''));
      if (!text) continue;
      const start = seconds(event.tStartMs);
      out.push({ start, end: start + seconds(event.dDurationMs), text });
    }
    return out;
  }

  /** Luôn xin `fmt=json3`: không phải phân tích XML, nên đường này chạy được cả ngoài trang. */
  function asJson3(baseUrl) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('fmt', 'json3');
      return url.toString();
    } catch {
      return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`;
    }
  }

  async function viaTimedText(request, net) {
    const req = request || {};
    const base = req.captionBaseUrl;
    if (!base) throw new Error('timedtext: video không có caption track nào để lấy');
    if (!net || typeof net.get !== 'function') throw new Error('timedtext: thiếu adapter mạng');

    const payload = await net.get(asJson3(String(base)));
    const segments = parseTimedText(payload);
    // `exp=xpe` trả body rỗng kèm HTTP 200 cho mọi request lập trình — trông y hệt "video này
    // không có phụ đề", nên phải gọi đúng tên nó ra.
    if (segments.length === 0) throw new Error('timedtext: body rỗng — dấu hiệu exp=xpe, thiếu PoToken');
    return segments;
  }

  // ------------------------------------------------------------ đường 4: DOM

  function matchesAnyLabel(node, labels) {
    const aria = S.foldLabel(node.getAttribute('aria-label') || '');
    const text = S.foldLabel(node.textContent || '');
    return labels.some((label) => (label.length >= MIN_FUZZY_LABEL
      ? aria.includes(label) || text.includes(label)
      : aria === label || text === label));
  }

  /**
   * Phần tử bấm được **trong cùng**. `querySelectorAll` trả theo thứ tự tài liệu nên wrapper
   * (`ytd-button-renderer`) luôn đứng trước `<button>` thật — mà bấm wrapper thì YouTube không
   * phản hồi, và triệu chứng là "panel không bao giờ mở", không phải một lỗi.
   */
  function innermostClickable(node, sel) {
    const css = sel.css('pressable');
    // `querySelectorAll` trả NodeList: phải `Array.from` trước khi dùng phương thức của Array.
    const inside = Array.from(node.querySelectorAll(css)).filter((el) => !el.closest(sel.OWN_UI));
    for (const el of inside) {
      if (el.querySelectorAll(css).length === 0) return el;
    }
    return inside[0] || node;
  }

  /**
   * Nút "Transcript" của trang — **sau khi** đã loại giao diện của chính extension.
   *
   * Extension tự thêm một nút nhãn "Transcript" đứng ngay đầu hàng nút, nên quét mọi `<button>`
   * khớp `/transcript/i` là bấm vào chính mình: panel không bao giờ mở, và đường DOM chết câm
   * với một thông báo đổ lỗi cho YouTube.
   */
  function findTranscriptButton(root_, options) {
    if (!root_) return null;
    const sel = selectorsOf(options);
    const labels = sel.label('transcriptButton');

    for (const node of root_.querySelectorAll(sel.css('clickable'))) {
      if (node.closest(sel.OWN_UI)) continue;
      if (!matchesAnyLabel(node, labels)) continue;
      return innermostClickable(node, sel);
    }
    return null;
  }

  function defaultEvent(type) {
    const init = { bubbles: true, cancelable: true, composed: true };
    const Pointer = root.PointerEvent;
    const Mouse = root.MouseEvent;
    if (type.startsWith('pointer') && typeof Pointer === 'function') return new Pointer(type, init);
    if (typeof Mouse === 'function') return new Mouse(type, init);
    throw new Error('pressElement: ngữ cảnh không có MouseEvent — phải tiêm `createEvent`');
  }

  function pressElement(node, options) {
    const create = (options && options.createEvent) || defaultEvent;
    for (const type of PRESS_SEQUENCE) node.dispatchEvent(create(type));
    return [...PRESS_SEQUENCE];
  }

  /** Chữ của một dòng segment khi không có phần tử chữ riêng: bỏ mốc và nhãn trợ năng rồi mới đọc. */
  function fallbackText(row, sel) {
    const copy = row.cloneNode(true);
    for (const junk of copy.querySelectorAll(`${sel.css('segmentTimestamp')}, ${sel.css('segmentNoise')}`)) {
      junk.remove();
    }
    return collapse(copy.textContent);
  }

  /**
   * Một dòng segment thành `{ start, text }`.
   *
   * Nhãn trợ năng ("1 second") nằm *bên trong* dòng: đọc `textContent` cả dòng là nuốt luôn
   * chuỗi đó vào giữa transcript — sai mà vẫn đọc trôi chảy, nên không ai phát hiện.
   */
  function readSegment(row, sel) {
    const stamp = row.querySelector(sel.css('segmentTimestamp'));
    const textNode = row.querySelector(sel.css('segmentText'));
    const text = textNode ? collapse(textNode.textContent) : fallbackText(row, sel);
    if (!text) return null;
    return { start: parseClock(stamp ? stamp.textContent : ''), text };
  }

  /** `mm:ss` hoặc `h:mm:ss` → giây. Thứ không đọc được ra 0, không ra NaN. */
  function parseClock(value) {
    const parts = String(value == null ? '' : value).trim().split(':');
    if (parts.length < 2 || parts.length > 3) return 0;
    let total = 0;
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isFinite(n) || n < 0) return 0;
      total = total * 60 + n;
    }
    return total;
  }

  /**
   * Bề rộng đo được của một node, hoặc `null` khi **không đo được**.
   *
   * `null` không phải 0: 0 là bằng chứng "panel không chiếm chỗ nào", còn `null` là "chưa có
   * bằng chứng nào". Chỉ cái thứ nhất mới đủ để nói cửa sổ quá hẹp.
   */
  function measuredWidth(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return null;
    const rect = node.getBoundingClientRect();
    const width = rect ? Number(rect.width) : NaN;
    return Number.isFinite(width) ? width : null;
  }

  /**
   * Quét panel transcript đang mở. Không ném lỗi — trả lý do, để người gọi quyết định thử lại
   * hay dừng. Phân biệt bốn lý do là cả điểm của hàm này (xem `REASON`): chỉ `NARROW` mới đáng
   * dừng hẳn, và đúng vì thế nó là lý do phải có bằng chứng chắc nhất.
   *
   * Ba trạng thái dễ bị gộp thành một, và ticket 017 gộp thật:
   *   1. *không có panel nào* — `panels` rỗng, trang cũng không có dòng segment nào;
   *   2. *có panel nhưng đang ẩn vì layout hẹp* — panel nhận ra được, đều ẩn, đo ra 0px;
   *   3. *có panel đang mở mà ta không nhận ra* — trên trang có dòng segment nằm ngoài mọi panel
   *      nhận ra được. Chữ có sẵn ở đó; thiếu là selector, không phải bề rộng cửa sổ.
   *
   * Trạng thái 3 là **lỗi**, không phải một đường lui: bản trước quét cả cây node khi không panel
   * nào khớp, và ca đó trả về segment như thường. Đổi lại có chủ đích — chữ chỉ được đọc từ một
   * panel mình nhận ra. Quét mù cả trang là cách nhặt phải panel của video A còn treo trên trang
   * video B (`WORKSPACE_PROTOCOL.md` v5), và nó giấu luôn việc selector đã hỏng: chỗ duy nhất
   * chữa được ca này là `selectors.js` (hoặc ghi đè từ trang Cài đặt), nên nó phải nói ra.
   */
  function scanTranscriptPanel(root_, options) {
    const sel = selectorsOf(options);
    const opened = !!(options && options.opened);
    if (!root_) return { ok: false, reason: REASON.NO_PANEL, message: 'không có cây node để quét' };

    const ours = (node) => !node.closest(sel.OWN_UI);
    const panels = Array.from(root_.querySelectorAll(sel.css('panel'))).filter(ours);
    // Ẩn xét bằng `closest`, không bằng `matches`: khối trong thừa hưởng trạng thái ẩn của panel
    // ngoài mà không mang thuộc tính ấy (`selectors.js`, nhóm `panelHidden`).
    const open = panels.filter((panel) => !panel.closest(sel.css('panelHidden')));

    // `Set` chứ không phải mảng: hai selector của nhóm `panel` khớp **lồng nhau** trên layout
    // hiện tại, nên cùng một dòng đến hai lần và transcript ra gấp đôi. Thứ tự Set là thứ tự
    // gặp đầu tiên, tức thứ tự tài liệu của panel ngoài cùng.
    const rows = new Set();
    for (const panel of open) {
      for (const row of panel.querySelectorAll(sel.css('segment'))) if (ours(row)) rows.add(row);
    }

    if (rows.size > 0) {
      const segments = [...rows].map((row) => readSegment(row, sel)).filter(Boolean);
      if (segments.length === 0) {
        return { ok: false, reason: REASON.EMPTY, message: 'panel có segment nhưng không đọc được chữ nào' };
      }
      return { ok: true, segments };
    }

    // Không đọc được dòng nào từ panel mình nhận ra — giờ mới đi chẩn đoán, và chẩn đoán bắt đầu
    // bằng câu hỏi rẻ nhất: chữ có nằm sẵn trên trang không?
    const strays = Array.from(root_.querySelectorAll(sel.css('segment')))
      .filter((row) => ours(row) && !row.closest(sel.css('panel')));
    if (strays.length > 0) {
      return {
        ok: false,
        reason: REASON.UNRECOGNIZED,
        message: `panel transcript đang mở mà selector không nhận ra: ${strays.length} dòng segment nằm ngoài mọi panel bắt được`,
      };
    }
    if (panels.length === 0) {
      return { ok: false, reason: REASON.NO_PANEL, message: 'chưa thấy panel transcript trên trang' };
    }
    if (open.length > 0) {
      return { ok: false, reason: REASON.EMPTY, message: 'panel đã mở nhưng chưa có segment nào' };
    }
    // `…_HIDDEN` là trạng thái của *mọi* panel đang đóng, không riêng panel bị layout hẹp giữ
    // lại. Chưa bấm mở thì nó chỉ có nghĩa là đang đóng.
    if (!opened) {
      return { ok: false, reason: REASON.EMPTY, message: 'panel transcript đang đóng — chưa bấm mở, hoặc cú bấm chưa ăn' };
    }

    const widths = panels.map(measuredWidth);
    if (widths.some((width) => width === null)) {
      return { ok: false, reason: REASON.EMPTY, message: 'panel đang ẩn nhưng không đo được bề rộng nào — chưa đủ căn cứ nói cửa sổ hẹp' };
    }
    const widest = Math.max(...widths);
    if (widest > 0) {
      return {
        ok: false,
        reason: REASON.EMPTY,
        message: `panel khai đang ẩn nhưng vẫn chiếm ${Math.round(widest)}px bề rộng — chưa đủ căn cứ nói cửa sổ hẹp`,
      };
    }
    return {
      ok: false,
      reason: REASON.NARROW,
      message: 'cửa sổ quá hẹp: đã bấm mở nhưng YouTube vẫn giữ panel transcript ẩn và không chiếm một pixel bề rộng nào',
    };
  }

  function domError(request, result) {
    const detail = (result && (result.message || result.reason)) || 'không rõ lý do';
    const error = new Error(`DOM: ${detail} (${(request && request.videoId) || 'không rõ video'})`);
    error.reason = (result && result.reason) || REASON.NO_PANEL;
    return error;
  }

  /**
   * Đường DOM, phía điều phối: quét, và **đúng một lần** thử lại với tab được kích hoạt.
   *
   * Chrome bóp hiệu năng tab nền nên player đôi khi chưa dựng xong panel — kích hoạt tab chữa
   * được đúng cái đó. Nó không chữa được cửa sổ hẹp: chiều rộng vẫn là chiều rộng, nên gặp
   * `NARROW` là báo ngay thay vì đốt thêm một lượt.
   */
  async function viaDom(request, page) {
    if (!page || typeof page.scan !== 'function') throw new Error('DOM: thiếu adapter trang');

    const first = await page.scan({ activated: false });
    if (first && first.ok) return first.segments;
    if (first && first.reason === REASON.NARROW) throw domError(request, first);

    if (typeof page.activate === 'function') await page.activate();
    const second = await page.scan({ activated: true });
    if (second && second.ok) return second.segments;
    throw domError(request, second);
  }

  root.NBLM_TRANSCRIPT = Object.freeze({
    REASON,
    PRESS_SEQUENCE,
    PANEL_ID,
    routeFor,
    fetchTranscript,
    parseClock,
    innertubeClient,
    innertubeHeaders,
    parseInnertubeTranscript,
    viaInnertube,
    panelParams,
    parsePanelTranscript,
    viaPanel,
    parseTimedText,
    viaTimedText,
    findTranscriptButton,
    innermostClickable,
    pressElement,
    scanTranscriptPanel,
    viaDom,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
