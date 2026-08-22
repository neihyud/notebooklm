// Phản hồi `batchexecute` giả — dựng theo hình dạng capture ghi trong ADR 0012, không lấy từ
// một request thật nào. Lần chạy thật đầu tiên vào notebook của owner cần owner cho phép riêng
// (`WORKSPACE_PROTOCOL.md`, mục `prohibited without explicit authority`).
//
// Dùng chung ở hai chỗ: `test/notebooklm-rpc.test.js` dựng các fixture phân biệt sáu hạng lỗi,
// còn `test/helpers/service-worker.js` lấy đúng bộ này làm phản hồi mặc định của `fetch` giả.
// Một bản sao thứ hai là một bản sẽ lệch — và lệch thì cả hai bên vẫn xanh.

/** RPC id của `ADD_SOURCE`. Viết thẳng ở đây chứ không đọc từ module đang được kiểm. */
export const RPC_ID = 'izAoDd';

/** Hai chuỗi cùng kiểu lấy từ **cùng một** `WIZ_global_data` — một vào body, một vào query. */
export const AT = 'token-csrf-SNlM0e-xyz';
export const SID = 'session-id-FdrFJe-987';

export const WIZ_HTML = `<html><head><script nonce="x">window.WIZ_global_data = {`
  + `"cfb2h":"boq_labs","SNlM0e":"${AT}","w2btAe":"{\\"1\\":\\"}\\"}","FdrFJe":"${SID}"};`
  + `</script></head><body>Gemini Notebook</body></html>`;

/**
 * Prefix chống XSSI, rồi các chunk `<số byte>\n<JSON>`.
 *
 * Chia frame thành **hai chunk**, không phải một: phản hồi thật đến theo nhiều chunk, và một
 * fixture một chunk không phân biệt được "duyệt mọi chunk" với "đọc chunk đầu".
 */
export function batchResponse(frames) {
  const chunks = [[frames[0]], frames.slice(1)];
  let out = ")]}'\n\n";
  for (const chunk of chunks) {
    const json = JSON.stringify(chunk);
    out += `${json.length}\n${json}\n`;
  }
  return out;
}

/** Frame nhiễu thật của `batchexecute`, đứng hai bên frame đang cần đọc. */
export const HEAD = ['di', 25];
export const TAIL = ['af.httprm', 25, '-8330585918003296000', 5];

/**
 * Frame đang cần đọc **không bao giờ ở đầu hay cuối** danh sách (WORKSPACE_PROTOCOL v9): nằm
 * đầu thì `[0]` lọt, nằm cuối thì `at(-1)` lọt, và ở n=1 thì `some`/`every`/`find` trùng nhau.
 */
export const wrap = (special) => batchResponse([HEAD, special, TAIL]);

export const wrbFrame = (payload, slot5) => [
  'wrb.fr', RPC_ID,
  payload == null ? null : JSON.stringify(payload),
  null, null,
  slot5 == null ? null : slot5,
  'generic',
];

/** Frame `er` — server từ chối cả lượt dispatch, và nó đến kèm HTTP 200. */
export const erFrame = (code = 14, message = 'lỗi phía server') => ['er', RPC_ID, code, null, null, message];

export const SOURCE_ID = 'src-abc-123';
export const SOURCE_TITLE = 'Tieu de Nguon';

/**
 * Payload của một lượt thêm nguồn: id + **tiêu đề notebook đang giữ** + trạng thái (`READY` là
 * `[null, 2]`).
 *
 * `title` là một tham số chứ không phải một hằng, vì đó là chỗ duy nhất phản hồi nói ra tên
 * Nguồn thật sự — và tên Nguồn là vĩnh viễn (ADR 0010). Một fixture luôn trả `SOURCE_TITLE` cho
 * mọi request nói rằng notebook đặt cùng một cái tên cho mọi Nguồn, tức nó **phát biểu một điều
 * sai** ngay lúc người gọi bắt đầu đối chiếu tên gửi đi với tên nhận về (ticket 021).
 */
export const okPayload = (statusCode, title = SOURCE_TITLE) => [[[[SOURCE_ID], title, [null, statusCode]]]];

/** Phản hồi của một lượt thành công, mang đúng tiêu đề mà notebook đang giữ. */
export const successBody = (title = SOURCE_TITLE) => wrap(wrbFrame(okPayload(2, title)));

/** Phản hồi của một lượt thành công — mặc định của `fetch` giả trong harness service worker. */
export const SUCCESS_BODY = successBody();

// ------------------------------------------------------- đọc lại một request đã gửi

/**
 * Đường đi tới một nút **trong mẫu**, và giá trị ở đúng đường ấy trong một cây khác.
 *
 * Cả hai chỗ đọc `params` — test dựng request và `fetch` giả của harness — đi qua đây, để không
 * chỗ nào **chép lại** shape: ticket 015 xanh 766 với cặp `content`/`title` đảo đúng vì test của
 * nó đối chiếu `buildParams` với một hằng số chép tay từ ticket. Khi capture về, chỗ phải sửa là
 * `TEXT_PARAMS_SPECIMEN`; mọi chỗ đọc ở đây tự đi theo.
 */
export function pathTo(node, mark, trail = []) {
  if (node === mark) return trail;
  if (!Array.isArray(node)) return null;
  for (let i = 0; i < node.length; i += 1) {
    const found = pathTo(node[i], mark, [...trail, i]);
    if (found) return found;
  }
  return null;
}

export const nodeAt = (root, path) => path.reduce((node, i) => node[i], root);

/**
 * Thân một request `batchexecute` đã gửi → `params` của lượt gọi bên trong.
 *
 * Lớp bọc `f.req` là hình dạng của **giao thức**, không phải của `izAoDd`, nên nó ở đây cùng
 * chỗ với bộ dựng phản hồi giả — một bản sao thứ hai là một bản sẽ lệch.
 */
export function paramsOfBody(body) {
  const envelope = JSON.parse(new URLSearchParams(String(body)).get('f.req'));
  const call = envelope[0][0];
  if (call[0] !== RPC_ID) throw new Error(`lớp ngoài f.req mang rpcid "${call[0]}", không phải ${RPC_ID}`);
  return JSON.parse(call[1]);
}
