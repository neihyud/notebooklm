// Đường đẩy chính của ADR 0012: một Nguồn văn bản vào Notebook đích bằng một request
// `batchexecute` với RPC id `izAoDd`. `automation.js` (ticket 004) giữ nguyên làm đường lui.
//
// Lý do đổi **không** phải tốc độ. Là **tín hiệu xong việc**: đường DOM chờ `settleMs: 1200`
// rồi quét khay thông báo và tự thừa nhận rằng hộp thoại đóng chưa chắc là xong; đường này
// nhận về source id + tiêu đề + trạng thái ngay trong thân phản hồi, đồng bộ.
//
// Đổi lại, hai đường hỏng theo hai kiểu khác nhau — và đó là lý do giữ cả hai:
//
//   | đường | hỏng vì          | triệu chứng                                  |
//   |-------|------------------|----------------------------------------------|
//   | DOM   | selector đổi     | `findByLabel` trả null → ném ngay             |
//   | RPC   | **shape** trôi   | request đi lọt, HTTP 200, một mã gRPC chung   |
//
// Vì vậy thứ tự trong file này là thứ tự ràng buộc 1 của ADR: **bộ đọc phản hồi trước, đường
// gửi sau**. Lỗi nghiệp vụ của `batchexecute` đến kèm HTTP 200, nên `if (!res.ok) throw` nuốt
// sạch cả lớp lỗi ấy — và đó là điều duy nhất biến ADR 0012 thành một quyết định tệ.
//
// File này không chạm `chrome.*` và không tự gọi `fetch`: cả hai lối ra (`fetchImpl`,
// `readTokens`) là adapter được tiêm, nên toàn bộ đường đi test được **mà không gửi một
// request thật nào** — `test/notebooklm-rpc.test.js`.
//
// **Ranh giới auth**: đường này không mượn `Authorization: SAPISIDHASH` và không liên quan tới
// `AUTH_OPS` hay `src/youtube/page-bridge.js` (ràng buộc 5, ADR 0003). Nó cần đúng cookie mà
// Chrome đã giữ sẵn, cộng hai giá trị đọc từ `WIZ_global_data` của HTML trang chủ.
(function (root) {
  'use strict';

  if (root.NBLM_RPC) return;

  const S = root.NBLM_SHARED;
  if (!S) throw new Error('notebooklm/rpc: cần src/common/shared.js nạp trước');

  /**
   * RPC id của `ADD_SOURCE`. Đo được: **không bị Google xoay lần nào trong 7,5 tháng** (quét 76
   * commit chạm bảng RPC của `notebooklm-py`). Thứ thật sự trôi là *shape payload*, không phải
   * id — xem `buildParams` và `RESULT_LAYOUT`.
   */
  const RPC_ID = 'izAoDd';

  /** Endpoint dual-serve trên cả hai host của `S.NOTEBOOK_HOSTS` (ticket 014). */
  const ENDPOINT_PATH = '/_/LabsTailwindUi/data/batchexecute';

  /**
   * Hai giá trị đọc từ **cùng một** `WIZ_global_data`, mỗi cái một vai và một chỗ đứng:
   * `SNlM0e` là token CSRF và đi vào **thân** request (`at=`), `FdrFJe` là session id và đi vào
   * **query** (`f.sid=`). Hai chuỗi cùng kiểu lấy từ cùng một object: hoán vị chúng vẫn ra một
   * request gửi đi được, nên chỗ duy nhất canh được là test.
   */
  const WIZ_KEYS = Object.freeze({ at: 'SNlM0e', sid: 'FdrFJe' });

  /** Prefix chống XSSI đứng đầu mọi phản hồi `batchexecute`. */
  const XSSI_PREFIX = ")]}'";

  /**
   * Ba mã `google.rpc.Status` mà điều tra thấy đường text trả về. Chúng là ba hằng số **cùng
   * đơn vị**, và vai khác nhau chứ không phải mức độ nặng nhẹ khác nhau — xem `canFallBackToDom`.
   */
  const GRPC_CODE = Object.freeze({ INVALID_ARGUMENT: 3, NOT_FOUND: 5, FAILED_PRECONDITION: 9 });
  const GRPC_NAME = Object.freeze(Object.fromEntries(
    Object.entries(GRPC_CODE).map(([name, code]) => [code, name]),
  ));

  /** Loại lỗi nhúng mang câu chữ soạn cho người dùng (quota, rate limit). */
  const USER_ERROR_TYPE = 'UserDisplayableError';

  /** Trạng thái "nguồn đã vào và dùng được". Trong payload nó là cặp `[null, 2]`. */
  const SOURCE_STATUS_READY = 2;

  /**
   * Trần kích thước để còn đi đường RPC, tính bằng **ký tự của thân Nguồn**.
   *
   * **Con số này chưa được đo.** Giới hạn thật của request không có ở phía client, không có
   * trong tài liệu, và capture lớn nhất điều tra tìm được là 374 byte — "không thấy ai chặn"
   * không phải "đã đo thấy chạy". Thứ *đã* đo được là đầu kia: Chrome chấm dứt service worker
   * của MV3 khi một response `fetch()` mất hơn 30 giây, và mất service worker **giữa chừng một
   * lượt ghi đã gửi đi** là đúng trạng thái "không biết nguồn đã vào hay chưa" mà cả repo này
   * dựng lên để tránh.
   *
   * 200.000 ký tự ≈ 30.000 từ ≈ 3,5 giờ nói, và nó **dưới xa** một Nguồn gộp cực đại
   * (`maxWordsPerSource` = 500.000 từ). Đo bằng ký tự nguồn chứ không bằng byte trên dây là một
   * lựa chọn có giá phải trả, và giá ấy ghi ra đây thay vì để người sau tự phát hiện: thân
   * request là `encodeURIComponent` của JSON, nên **một ký tự tiếng Việt có dấu thành 9 byte**
   * (`%E1%BA%A1`). 200.000 ký tự tiếng Việt là khoảng **1,8 MB trên dây**, không phải 200 KB —
   * tức so nó với capture 374 byte là hơn bốn nghìn lần, không phải năm trăm. Vẫn chọn đơn vị
   * này vì nó là một phép đo rẻ (`tooLargeForRpc` không dựng chuỗi nào), còn đo byte thật thì
   * phải `encodeURIComponent` cả thân Nguồn chỉ để đếm — một chuỗi tạm 27 MB trong service
   * worker cho mỗi lượt đẩy.
   *
   * Nguồn vượt ngưỡng **không được thử gửi** — nó rơi về đường DOM, thứ chạy trong một tab và
   * không có trần 30 giây (ưu thế duy nhất còn lại của đường cũ, và nó có thật). Có capture
   * thật rồi thì chỉnh con số này, đừng gỡ cổng.
   */
  const MAX_BODY_CHARS = 200000;

  const str = (value) => (typeof value === 'string' ? value : '');
  const bodyOf = (source) => str(source && source.body);

  // ==================================================================== bộ đọc

  /**
   * Thân phản hồi → **danh sách frame phẳng**.
   *
   * Hình dạng: prefix chống XSSI, rồi các chunk `<số byte>\n<JSON>`, mỗi chunk là một mảng
   * frame. Số byte cố ý **không** được dùng để cắt chuỗi: nó đếm byte UTF-8 còn JavaScript cắt
   * theo mã đơn vị UTF-16, nên một tiêu đề tiếng Việt là đủ để hai con số lệch nhau và cả
   * phản hồi thành "hỏng" trong khi nó lành lặn. Frame không bao giờ chứa xuống dòng thô (chuỗi
   * bên trong đã được JSON escape), nên tách theo dòng là đủ và không lệ thuộc bảng mã.
   *
   * Thiếu prefix là **không phải** một phản hồi `batchexecute`: phiên hết hạn thì Google trả
   * HTTP 200 kèm HTML đăng nhập, và nuốt ca đó là nuốt đúng lớp lỗi mà ADR 0012 sợ nhất.
   */
  function parseFrames(text) {
    const raw = str(text);
    const at = raw.indexOf(XSSI_PREFIX);
    if (at === -1) throw new Error('phản hồi không có prefix chống XSSI — không phải một phản hồi batchexecute');

    const frames = [];
    for (const line of raw.slice(at + XSSI_PREFIX.length).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || /^\d+$/.test(trimmed)) continue; // dòng đếm byte của chunk
      if (trimmed[0] !== '[') continue;
      let chunk;
      try {
        chunk = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!Array.isArray(chunk)) continue;
      // Một chunk là **mảng frame**; nhưng một frame lẻ cũng là mảng, nên phân biệt bằng phần
      // tử đầu chứ không bằng độ dài.
      if (chunk.every((entry) => Array.isArray(entry))) frames.push(...chunk);
      else frames.push(chunk);
    }
    return frames;
  }

  /** Payload nhúng của `batchexecute` là JSON **đã stringify một lần nữa**. */
  function decodeNested(value) {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Câu chữ của `UserDisplayableError` nhúng trong `details` của một `google.rpc.Status`.
   *
   * Duyệt cây theo cấu trúc — tìm mảng nào mang chuỗi type-url của lỗi ấy, rồi lấy chuỗi đầu
   * tiên trong chính mảng đó không phải một type-url. Không dò theo từ khoá trong cả thân
   * phản hồi: `readError` của đường DOM đã ghi lại vì sao (một bộ dò từ khoá đọc bộ đếm
   * "Source limit 3/50" thành "đã chạm giới hạn" và huỷ oan một lượt import đang chạy tốt).
   */
  function findUserDisplayableError(node) {
    if (!Array.isArray(node)) return null;
    const marks = node.some((entry) => typeof entry === 'string' && entry.includes(USER_ERROR_TYPE));
    if (marks) {
      const message = firstPlainString(node);
      if (message) return message;
    }
    for (const entry of node) {
      const found = findUserDisplayableError(entry);
      if (found) return found;
    }
    return null;
  }

  function firstPlainString(node) {
    if (typeof node === 'string') return node.includes('type.googleapis.com') ? null : node;
    if (!Array.isArray(node)) return null;
    for (const entry of node) {
      const found = firstPlainString(entry);
      if (found) return found;
    }
    return null;
  }

  /**
   * Ô lỗi của một frame `wrb.fr` — index 5, nơi cả `google.rpc.Status` lẫn `UserDisplayableError`
   * cùng nằm. Một đường đọc, hai hạng ra: lỗi có câu chữ cho người dùng (quota, rate limit) tách
   * khỏi lỗi chỉ có mã.
   */
  function readErrorSlot(slot) {
    const blob = decodeNested(slot);
    if (blob == null) return null;

    const user = findUserDisplayableError(blob);
    if (user) return { outcome: 'rejected', reason: 'user', message: user };

    if (Array.isArray(blob) && typeof blob[0] === 'number') {
      const code = blob[0];
      const name = GRPC_NAME[code] || `code ${code}`;
      return { outcome: 'rejected', reason: 'status', code, name, message: str(blob[1]) || name };
    }
    return null;
  }

  /**
   * Chỗ đọc kết quả trong payload của `wrb.fr`: `[[ [[id], title, [null, status]] ]]`.
   *
   * **Shape này trôi theo cohort** (ADR 0012): rollout chia theo tài khoản, nên tài khoản đã
   * migrate và chưa migrate nhận shape khác nhau, và hai bộ reverse-engineer độc lập tới hôm nay
   * vẫn bất đồng về shape trong khi thống nhất tuyệt đối về id. Vì vậy bộ đọc **hỏng đóng**:
   * đọc không ra trạng thái thì trả `malformed`, không trả `ok`. Nguồn có thể đã vào thật, nhưng
   * "có thể" không được ghi vào Sổ đã import như một lượt thành công (ADR 0006).
   */
  const RESULT_LAYOUT = Object.freeze({ sources: 0, id: 0, title: 1, status: 2, statusCode: 1 });

  const idOf = (slot) => (typeof slot === 'string' ? slot : (Array.isArray(slot) ? str(slot[0]) : ''));

  function readSuccess(payload) {
    const list = Array.isArray(payload) ? payload[RESULT_LAYOUT.sources] : null;
    const entry = Array.isArray(list) ? list[0] : null;
    if (!Array.isArray(entry)) return null;

    const pair = entry[RESULT_LAYOUT.status];
    const status = Array.isArray(pair) ? pair[RESULT_LAYOUT.statusCode] : null;
    if (typeof status !== 'number') return null;

    // `sourceStatus`, không phải `status`: mã HTTP cũng là một số nằm trong cùng loại object
    // này (`httpStatus`), và hai con số cùng kiểu dùng chung một tên khoá là đúng hình lỗi mà
    // WORKSPACE_PROTOCOL ghi là hạng lặp lại của repo — hoán vị chúng vẫn cho hai số hợp lệ.
    const shared = {
      sourceId: idOf(entry[RESULT_LAYOUT.id]),
      name: str(entry[RESULT_LAYOUT.title]),
      sourceStatus: status,
    };
    return status === SOURCE_STATUS_READY
      ? { outcome: 'ok', ...shared }
      : { outcome: 'notReady', ...shared };
  }

  const frameFor = (frames, tag) => frames.find((f) => Array.isArray(f) && f[0] === tag && f[1] === RPC_ID) || null;

  /**
   * Một phản hồi HTTP → một hạng kết quả. Đây là hàm mà cả ticket 015 xoay quanh.
   *
   * Sáu ca phải phân biệt được **bằng code**, và năm trong sáu ca đến kèm HTTP 200 hoặc 400 —
   * tức `res.ok` một mình không nói gì:
   *
   *   `ok`        — `wrb.fr` mang source id + tiêu đề + trạng thái READY
   *   `notReady`  — `wrb.fr` đọc được nhưng trạng thái không phải READY: chưa xác nhận
   *   `rejected`  — `er` frame, `google.rpc.Status`, hoặc `UserDisplayableError` nhúng
   *   `csrf`      — HTTP 400, token hết hạn
   *   `transport` — HTTP 429/5xx (thử lại được) hoặc mã khác (không)
   *   `malformed` — không đọc ra được gì chắc chắn: HTML đăng nhập, shape đã trôi, frame
   *                 vắng mặt, hoặc `er` và `wrb.fr` cùng có mặt cho rpcid của mình
   */
  function readResponse(response) {
    const res = response || {};
    const status = Number(res.status);

    if (status === 400) return { outcome: 'csrf', httpStatus: status };
    if (status === 429 || status >= 500) return { outcome: 'transport', httpStatus: status, retryable: true };
    if (status !== 200) return { outcome: 'transport', httpStatus: status, retryable: false };

    let frames;
    try {
      frames = parseFrames(res.text);
    } catch (error) {
      return { outcome: 'malformed', detail: error.message };
    }

    const er = frameFor(frames, 'er');
    const wrb = frameFor(frames, 'wrb.fr');

    // Cả `er` LẪN `wrb.fr` cùng mang rpcid của mình trong một phản hồi: không đọc theo frame nào
    // cả. Đây không phải chuyện chọn frame nào **đứng trước** — thứ tự trong danh sách không mang
    // nghĩa gì, và hai cách đọc nói hai điều trái ngược nhau về đúng câu hỏi duy nhất mà bộ đọc
    // này tồn tại để trả lời: **đã ghi hay chưa ghi**.
    //
    //   đọc theo `er`   → `rejected`/`er` → được phép rơi về đường DOM. Nếu `wrb.fr` là thật thì
    //                     Nguồn ĐÃ có, và đường lui dựng cái thứ hai — không xoá được (ADR 0010),
    //                     ăn quota 50/notebook.
    //   đọc theo `wrb.fr` → `ok` → mục vào **Sổ đã import**. Nếu `er` là thật thì Nguồn chưa hề
    //                     tồn tại, mà ADR 0006/0009 đọc Sổ ấy nên mục KHÔNG BAO GIỜ được thử lại.
    //                     Đúng hạng "mất dữ liệu âm thầm".
    //
    // Cả hai đều là khẳng định một điều mình không biết. `malformed` là hạng nói đúng thứ mình
    // biết — "không rõ đã ghi hay chưa" — và nó hỏng đóng: không rơi về đường lui, mục KHÔNG vào
    // Sổ, lượt chạy báo hỏng kèm lý do, lần sau thử lại. Ta trả giá bằng một mục hỏng nhìn thấy
    // được, thay vì bằng một Nguồn thừa vĩnh viễn hoặc một mục mất im lặng.
    //
    // Và tổ hợp này bất khả theo chính cách ta gửi: một `rpcids`, một entry trong envelope (ràng
    // buộc "một request một nguồn"). Gặp nó nghĩa là giả định về server đã sai — chỗ để dừng,
    // không phải chỗ để đoán. Chưa đo được trên phản hồi thật: không ai được gửi request thật ở
    // ticket này, nên đây là quy tắc chọn theo hậu quả, không phải theo quan sát.
    if (er && wrb) {
      return { outcome: 'malformed', detail: `phản hồi mang CẢ \`er\` lẫn \`wrb.fr\` cho ${RPC_ID} — không rõ nguồn đã được ghi hay chưa` };
    }

    if (er) return { outcome: 'rejected', reason: 'er', code: er[2], message: str(er[5]) || `er ${er[2]}` };
    if (!wrb) return { outcome: 'malformed', detail: `không có frame nào của ${RPC_ID} trong ${frames.length} frame` };

    const failure = readErrorSlot(wrb[5]);
    if (failure) return failure;

    const success = readSuccess(decodeNested(wrb[2]));
    if (success) return success;

    return { outcome: 'malformed', detail: `frame ${RPC_ID} không đọc ra trạng thái nguồn — shape có thể đã trôi` };
  }

  /**
   * Hạng nào được phép rơi về đường DOM.
   *
   * Ranh giới là **"chắc chắn chưa ghi gì"**, không phải "hỏng nặng hay nhẹ". Rơi về đường lui
   * sau một lượt *có thể* đã ghi là dựng hai Nguồn cho một mục — mà Nguồn đã đẩy thì extension
   * không sửa và không xoá được (ADR 0010), và quota chỉ có 50 nguồn một notebook.
   *
   *   rơi về được: `tooLarge` và `noTokens` (chưa gửi gì đi), `csrf` (request bị từ chối trước
   *     khi tới nghiệp vụ), `er` (envelope bị từ chối), `INVALID_ARGUMENT` (đúng triệu chứng
   *     của shape trôi theo cohort — ca mà đường lui tồn tại vì nó);
   *   không: `NOT_FOUND` và `FAILED_PRECONDITION` (từ chối sạch, đường lui đâm vào cùng bức
   *     tường), `user` (quota — mở tab để chạm đúng quota ấy), `transport`, `notReady`,
   *     `malformed` (cả ba đều là "không biết đã ghi hay chưa").
   */
  function canFallBackToDom(outcome) {
    const o = outcome || {};
    // Hai hạng này chưa gửi gì đi, theo đúng nghĩa đen: `tooLarge` chưa ra khỏi `pushTextSource`,
    // còn `noTokens` xảy ra trước lượt POST đầu tiên — hoặc ngay sau một lượt vừa nhận HTTP 400,
    // tức một lượt đã biết chắc là bị từ chối.
    if (o.outcome === 'tooLarge' || o.outcome === 'noTokens') return true;
    if (o.outcome === 'csrf') return true;
    if (o.outcome !== 'rejected') return false;
    if (o.reason === 'er') return true;
    return o.reason === 'status' && o.code === GRPC_CODE.INVALID_ARGUMENT;
  }

  // ==================================================== token từ WIZ_global_data

  /** Object literal cân ngoặc bắt đầu ở `open`, bỏ qua ngoặc nằm trong chuỗi. */
  function balancedObject(text, open) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = open; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(open, i + 1);
      }
    }
    throw new Error('WIZ_global_data không đóng ngoặc');
  }

  /**
   * `SNlM0e` và `FdrFJe` từ HTML của `GET /` trên host NotebookLM.
   *
   * Ném khi thiếu một trong hai, thay vì trả chuỗi rỗng: một request mang `at=` rỗng vẫn gửi đi
   * được và quay về HTTP 400, tức lỗi lộ ra ở một chỗ không nói được nguyên nhân thật (phiên
   * đăng nhập đã hết, chứ không phải token hết hạn).
   */
  function parseWizGlobalData(html) {
    const text = str(html);
    const at = text.indexOf('WIZ_global_data');
    if (at === -1) {
      throw new Error('không thấy WIZ_global_data trong HTML NotebookLM — nhiều khả năng phiên đăng nhập đã hết');
    }
    const open = text.indexOf('{', at);
    if (open === -1) throw new Error('WIZ_global_data không có thân object');

    let data;
    try {
      data = JSON.parse(balancedObject(text, open));
    } catch (error) {
      throw new Error(`WIZ_global_data không parse được: ${error.message}`);
    }

    const token = str(data[WIZ_KEYS.at]);
    const session = str(data[WIZ_KEYS.sid]);
    if (!token) throw new Error(`WIZ_global_data thiếu ${WIZ_KEYS.at} (token CSRF)`);
    if (!session) throw new Error(`WIZ_global_data thiếu ${WIZ_KEYS.sid} (session id)`);
    return { at: token, sid: session };
  }

  // ==================================================================== đường gửi

  /**
   * `params` của biến thể **text**, và chỉ biến thể text.
   *
   * Hai ràng buộc nằm ngay trong hình dạng này, mỗi cái một lý do đã đo:
   *
   *   1. **Một entry, luôn luôn.** `ADD_SOURCE` nhiều entry *âm thầm bỏ qua các hàng thất bại*
   *      trừ khi mọi entry đều fail — đúng loại rủi ro `packSources()` mà ADR 0008 dựng bảng
   *      tổng kết để chặn, mở lại ở một tầng thấp hơn nơi bảng tổng kết không nhìn thấy. Nguồn
   *      gộp mang nhiều `itemIds` vẫn là **một** entry.
   *   2. **Không có biến thể URL.** Đường URL đổ mọi nguyên nhân (domain chết, 404, 403, 500)
   *      về một mã `9` duy nhất, và *luôn* để lại ghost row ăn quota phải vào NotebookLM xoá
   *      tay. Đường text là ca duy nhất trong bảng probe từ chối **sạch**.
   *
   * `[content, title]` là hai chuỗi **cạnh nhau trong một mảng** — đúng cặp mà
   * `WORKSPACE_PROTOCOL.md` đã ghi cho hộp thoại DOM (ô tiêu đề ↔ ô nội dung, ticket 004),
   * nhưng ở đây dễ hoán vị hơn chứ không khó hơn: hoán vị vẫn ra một Nguồn "thành công", chỉ
   * là nó mang tên bằng cả transcript, và tên Nguồn là vĩnh viễn (ADR 0010).
   *
   * **Shape này trôi theo cohort và chưa được đối chiếu với một capture thật.** Nó là chỗ đầu
   * tiên phải soi khi phản hồi trả về `INVALID_ARGUMENT`.
   */
  function buildParams(config) {
    const cfg = config || {};
    const notebookId = S.collapse(cfg.notebookId);
    const source = cfg.source || {};
    const content = bodyOf(source);
    const title = S.collapse(source.name);

    if (!notebookId) throw new Error('buildParams: thiếu id Notebook đích');
    if (!S.collapse(content)) throw new Error('buildParams: Nguồn rỗng — không đẩy một nguồn không có chữ nào');

    return [[[null, [content, title]]], notebookId];
  }

  /**
   * Một request `batchexecute` hoàn chỉnh. Không gửi gì cả — chỉ mô tả.
   *
   * Header client tự đặt đúng **một** cái. Không `Origin`, không `Referer`, không
   * `Authorization`: client Python trong điều tra không gửi cái nào và vẫn được 200, còn gửi
   * thêm là mở một biến chưa ai đo. Cookie thì Chrome tự gắn.
   */
  function buildRequest(config) {
    const cfg = config || {};
    const tokens = cfg.tokens || {};
    const at = str(tokens.at);
    const sid = str(tokens.sid);
    if (!at) throw new Error(`buildRequest: thiếu token CSRF (${WIZ_KEYS.at})`);
    if (!sid) throw new Error(`buildRequest: thiếu session id (${WIZ_KEYS.sid})`);

    const params = buildParams(cfg);
    const notebookId = params[1];
    const envelope = [[[RPC_ID, JSON.stringify(params), null, 'generic']]];

    const query = new URLSearchParams({
      rpcids: RPC_ID,
      'source-path': `/notebook/${notebookId}`,
      'f.sid': sid,
      hl: S.collapse(cfg.lang) || 'en',
      rt: 'c',
    });

    return {
      method: 'POST',
      url: `https://${S.NOTEBOOK_HOSTS[0]}${ENDPOINT_PATH}?${query.toString()}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      // Dấu `&` ở đuôi có trong capture. Giữ nguyên: không ai đo được nó có bắt buộc không, và
      // gỡ một thứ đã thấy chạy để đổi lấy sự gọn mắt là đổi sai chiều.
      body: `f.req=${encodeURIComponent(JSON.stringify(envelope))}&at=${encodeURIComponent(at)}&`,
    };
  }

  /** Nguồn có vượt trần để còn đi đường RPC không — xem `MAX_BODY_CHARS`. */
  const tooLargeForRpc = (source) => bodyOf(source).length > MAX_BODY_CHARS;

  function pushError(message, outcome) {
    const error = new Error(`đẩy qua RPC: ${message}`);
    error.outcome = outcome;
    error.fallback = canFallBackToDom(outcome);
    return error;
  }

  const describe = (read) => {
    if (read.outcome === 'rejected') return read.reason === 'status' ? `${read.name} — ${read.message}` : read.message;
    if (read.outcome === 'notReady') {
      // Ca duy nhất mà ta **biết chắc** Nguồn đã nằm trong notebook — id nó nằm ngay trong tay —
      // mà vẫn phải báo hỏng, vì trạng thái không nói được nó dùng được hay không. Engine coi
      // mọi lượt đẩy hỏng là mục rớt và **xếp lại vào hàng đợi**, nên chạy lại mà không kiểm là
      // dựng Nguồn thứ hai cho cùng một mục — mà Nguồn đã đẩy thì không xoá được (ADR 0010) và
      // quota chỉ có 50. Câu chữ này là thứ duy nhất tới được bảng tổng kết.
      return `Nguồn ĐÃ được tạo (id ${read.sourceId || 'không rõ'}) nhưng trạng thái là `
        + `${read.sourceStatus}, không phải READY — kiểm tra notebook trước khi chạy lại, `
        + 'chạy lại sẽ tạo thêm một Nguồn nữa';
    }
    if (read.outcome === 'transport') return `HTTP ${read.httpStatus}`;
    if (read.outcome === 'csrf') return `HTTP 400 sau khi đã lấy token CSRF mới — không phải chuyện token hết hạn`;
    return read.detail || 'không đọc được phản hồi';
  };

  /**
   * Ngân sách gửi lại, và **chỉ** cho hạng `csrf` (HTTP 400 = token CSRF hết hạn).
   *
   * Một, không phải hai, và cũng không phải "đến khi nào được": mọi hạng lỗi khác không nói
   * được lượt vừa rồi đã ghi hay chưa, nên gửi lại là dựng Nguồn thứ hai cho cùng một mục. Một
   * con số ở đúng một chỗ — hai hàng rào cho cùng một luật thì hàng rào thừa thành code chết,
   * và code chết không có test nào canh được.
   */
  const CSRF_RETRIES = 1;

  /**
   * Đẩy **một** Nguồn văn bản. Ném khi không chắc nguồn đã vào — người gọi coi đó là mục rớt.
   */
  async function pushTextSource(config) {
    const cfg = config || {};
    const source = cfg.source || {};
    if (typeof cfg.fetchImpl !== 'function') throw new Error('pushTextSource: thiếu adapter fetch');
    if (typeof cfg.readTokens !== 'function') throw new Error('pushTextSource: thiếu adapter đọc token');

    if (tooLargeForRpc(source)) {
      const outcome = { outcome: 'tooLarge', chars: bodyOf(source).length };
      throw pushError(
        `Nguồn ${bodyOf(source).length} ký tự vượt trần ${MAX_BODY_CHARS} — không gửi, rơi về đường lui`,
        outcome,
      );
    }

    // Đọc token hỏng — không thấy `WIZ_global_data`, HTML đã đổi, mạng đứt — là hạng **chắc
    // chắn chưa gửi gì**: nó xảy ra trước lượt POST đầu tiên, và ở lượt làm mới thì lượt POST
    // duy nhất đã đi qua là lượt vừa nhận HTTP 400. Đúng cùng hạng với `INVALID_ARGUMENT`: hiểu
    // biết của ta về giao thức đã cũ, và đường lui tồn tại cho đúng chuyện đó.
    const tokensOrFallback = async (fresh) => {
      try {
        return await cfg.readTokens(fresh);
      } catch (error) {
        throw pushError(error.message, { outcome: 'noTokens' });
      }
    };

    let tokens = await tokensOrFallback(false);
    let read = null;

    for (let attempt = 0; attempt <= CSRF_RETRIES; attempt += 1) {
      const request = buildRequest({ notebookId: cfg.notebookId, source, tokens, lang: cfg.lang });
      const response = await cfg.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        // Cookie phiên đăng nhập của owner là **cả** phần auth của đường này.
        credentials: 'include',
      });
      read = readResponse({ status: response.status, text: await response.text() });

      if (read.outcome === 'ok') {
        return { ok: true, via: 'rpc', sourceId: read.sourceId, name: read.name, status: read.sourceStatus };
      }
      if (read.outcome !== 'csrf' || attempt === CSRF_RETRIES) break;
      tokens = await tokensOrFallback(true);
    }

    throw pushError(describe(read), read);
  }

  root.NBLM_RPC = Object.freeze({
    RPC_ID,
    WIZ_KEYS,
    GRPC_CODE,
    SOURCE_STATUS_READY,
    MAX_BODY_CHARS,
    parseFrames,
    parseWizGlobalData,
    readResponse,
    canFallBackToDom,
    buildParams,
    buildRequest,
    tooLargeForRpc,
    pushTextSource,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
