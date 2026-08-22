// Đường đẩy qua RPC `izAoDd` — ticket 015, thi hành ADR 0012.
//
// Thứ tự của file này là thứ tự ràng buộc 1 của ADR: **bộ đọc phản hồi đứng trước đường gửi**.
// Lý do là hình lỗi của `batchexecute` — lỗi nghiệp vụ đến **kèm HTTP 200**, nên một
// `if (!res.ok) throw` nuốt sạch cả lớp lỗi ấy và đường RPC thành một quyết định tệ.
//
// Hai luật của WORKSPACE_PROTOCOL v9 áp thẳng vào cách dựng fixture ở đây:
//
//   1. **Fixture một phần tử không phân biệt được phép rút gọn nào.** Bộ đọc duyệt một *danh
//      sách frame*, nên mọi phản hồi giả dưới đây có ≥2 frame khác nhau đôi một, và frame
//      "đặc biệt" **không nằm ở đầu hay cuối** — nằm đầu thì `[0]` lọt, nằm cuối thì `at(-1)`
//      lọt. Bản mạnh nhất của luật ấy là `wrb.fr` của một rpcid khác kẹp hai bên frame thật:
//      lấy nhầm frame vẫn ra một object parse được.
//   2. **Không gửi một request thật nào.** Mọi phản hồi ở đây là chuỗi dựng tay theo hình dạng
//      capture ghi trong ADR 0012; `fetch` luôn là stub đếm lượt gọi. Lần chạy thật đầu tiên
//      cần owner cho phép riêng (`WORKSPACE_PROTOCOL.md`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/notebooklm/rpc.js';
// Phản hồi giả dựng theo hình dạng capture, dùng chung với harness service worker.
import {
  AT, SID, HEAD, TAIL, SOURCE_ID, SOURCE_TITLE as TITLE,
  batchResponse, wrap, wrbFrame, okPayload, WIZ_HTML,
} from './helpers/batchexecute.js';
// Service worker thật + `chrome` giả + `fetch` giả, cùng ghi vào một sổ.
import '../src/common/messages.js';
import {
  bootServiceWorker, fakeResponse, SITE, DOCS_PAGE, DOCS_TAB, NOTEBOOK_TAB,
} from './helpers/service-worker.js';

const S = globalThis.NBLM_SHARED;
const R = globalThis.NBLM_RPC;
const M = globalThis.NBLM_MESSAGES;

const NB = 'nb-1234abcd';
const TOKENS = Object.freeze({ at: AT, sid: SID });

const BODY = 'Than Nguon: mot dong transcript.';
const SOURCE = Object.freeze({ notebookId: NB, name: TITLE, body: BODY, itemIds: ['a', 'b', 'c'] });

const ok200 = (text) => ({ status: 200, text });

// =========================================================== bộ đọc phản hồi

test('reader — chunk nào cũng được duyệt, và frame của rpcid mình mới được đọc', () => {
  // Ba `wrb.fr`, cùng kiểu, cùng parse được. Frame thật nằm **giữa**: lấy `[0]` hay `at(-1)`
  // đều ra một frame hợp lệ của rpcid khác, và không có gì đỏ ở tầng dưới.
  const text = batchResponse([
    ['wrb.fr', 'XXXXXX', JSON.stringify([[['nham-truoc']]]), null, null, null, 'generic'],
    wrbFrame(okPayload(2)),
    ['wrb.fr', 'ZZZZZZ', JSON.stringify([[['nham-sau']]]), null, null, null, 'generic'],
  ]);
  const read = R.readResponse(ok200(text));
  assert.equal(read.outcome, 'ok', JSON.stringify(read));
  assert.equal(read.sourceId, SOURCE_ID);
  assert.equal(read.name, TITLE);
});

test('reader — HTTP 200 mang `er` frame là THẤT BẠI, không phải thành công', () => {
  const read = R.readResponse(ok200(wrap(['er', R.RPC_ID, 14, null, null, 'lỗi phía server'])));
  assert.equal(read.outcome, 'rejected');
  assert.equal(read.reason, 'er');
  assert.equal(read.code, 14);
});

test('reader — HTTP 200 mang `wrb.fr` payload null + google.rpc.Status ở index 5 là THẤT BẠI', () => {
  for (const [code, name] of [[3, 'INVALID_ARGUMENT'], [5, 'NOT_FOUND'], [9, 'FAILED_PRECONDITION']]) {
    const read = R.readResponse(ok200(wrap(wrbFrame(null, [code, `hỏng ${code}`, []]))));
    assert.equal(read.outcome, 'rejected', `${code}: ${JSON.stringify(read)}`);
    assert.equal(read.reason, 'status');
    assert.equal(read.code, code);
    assert.equal(read.name, name);
  }
});

test('reader — `UserDisplayableError` nhúng ở index 5 đọc ra được câu chữ cho người dùng', () => {
  const details = [['type.googleapis.com/google.internal.labs.tailwind.UserDisplayableError',
    ['Bạn đã đạt giới hạn 50 nguồn cho notebook này.']]];
  const read = R.readResponse(ok200(wrap(wrbFrame(null, [8, 'RESOURCE_EXHAUSTED', details]))));
  assert.equal(read.outcome, 'rejected');
  assert.equal(read.reason, 'user');
  assert.match(read.message, /50 nguồn/);
});

test('reader — HTTP 400 là CSRF hết hạn, một hạng riêng chứ không phải lỗi transport', () => {
  const read = R.readResponse({ status: 400, text: '' });
  assert.equal(read.outcome, 'csrf');
});

test('reader — HTTP 429 và 5xx là lớp transport, thử lại được', () => {
  for (const status of [429, 500, 503]) {
    const read = R.readResponse({ status, text: '' });
    assert.equal(read.outcome, 'transport', String(status));
    assert.equal(read.retryable, true);
    assert.equal(read.httpStatus, status);
  }
});

test('reader — HTTP 403 là transport nhưng KHÔNG thử lại: thử lại một lần từ chối là vô nghĩa', () => {
  const read = R.readResponse({ status: 403, text: '' });
  assert.equal(read.outcome, 'transport');
  assert.equal(read.retryable, false);
});

test('reader — HTTP 200 trả HTML đăng nhập KHÔNG được coi là thành công', () => {
  // Ca này là lý do cả bộ đọc tồn tại: phiên hết hạn thì Google trả 200 kèm trang đăng nhập.
  const read = R.readResponse(ok200('<!doctype html><html><body>Đăng nhập</body></html>'));
  assert.equal(read.outcome, 'malformed');
});

test('reader — thân JSON không có prefix chống XSSI KHÔNG phải một phản hồi batchexecute', () => {
  // Prefix là thứ duy nhất phân biệt "đã parse câu trả lời của Google" với "đã parse một mảng
  // JSON tình cờ nằm ở đó". Bỏ nó ra khỏi cùng một thân phản hồi: mọi frame vẫn nguyên vẹn, vẫn
  // parse được, và kết quả vẫn phải là *không đọc*.
  const framed = wrap(wrbFrame(okPayload(2)));
  const stripped = framed.slice(framed.indexOf('\n') + 1);
  assert.equal(R.readResponse(ok200(framed)).outcome, 'ok', 'đối chứng: cùng thân ấy kèm prefix thì đọc được');
  assert.equal(R.readResponse(ok200(stripped)).outcome, 'malformed');
});

test('reader — HTTP 200 mà không có frame nào của rpcid mình KHÔNG được coi là thành công', () => {
  const read = R.readResponse(ok200(batchResponse([HEAD, ['e', 4, null, null, 131], TAIL])));
  assert.equal(read.outcome, 'malformed');
});

test('reader — trạng thái READY là mã 2; mọi mã khác ở CÙNG vị trí là chưa xác nhận', () => {
  // Hai số cùng kiểu ở cùng chỗ: hoán vị vẫn cho một phản hồi parse được, và nếu chỉ hình dạng
  // được canh thì "nguồn chưa vào" ghi vào Sổ đã import như một lượt thành công.
  assert.equal(R.readResponse(ok200(wrap(wrbFrame(okPayload(2))))).outcome, 'ok');
  for (const code of [1, 3, 4]) {
    const read = R.readResponse(ok200(wrap(wrbFrame(okPayload(code)))));
    assert.equal(read.outcome, 'notReady', `mã ${code}: ${JSON.stringify(read)}`);
    assert.equal(read.sourceStatus, code);
  }
});

test('reader — `wrb.fr` có mặt nhưng đọc không ra trạng thái thì KHÔNG được coi là thành công', () => {
  const read = R.readResponse(ok200(wrap(wrbFrame([[[['src-1'], TITLE]]]))));
  assert.equal(read.outcome, 'malformed');
});

// ---------------------------------------------- đường lui: hạng nào được rơi về DOM

test('đường lui — INVALID_ARGUMENT rơi về DOM, NOT_FOUND thì không: hai mã cùng kiểu, hai vai', () => {
  // Ba mã gRPC là ba hằng số cùng đơn vị. Hoán vị 3 ↔ 5 vẫn cho hai phản hồi parse được và hai
  // câu lỗi hợp lý — thứ đổi là **vai**: 3 là shape trôi theo cohort (chưa ghi gì, đường lui
  // cứu được), 5 là notebook không còn (đường lui đâm vào đúng bức tường ấy).
  const at = (code) => R.readResponse(ok200(wrap(wrbFrame(null, [code, `hỏng ${code}`, []]))));
  assert.equal(R.canFallBackToDom(at(3)), true, 'INVALID_ARGUMENT phải rơi về đường lui');
  assert.equal(R.canFallBackToDom(at(5)), false, 'NOT_FOUND mà rơi về đường lui là mở thêm một tab để hỏng lần nữa');
  assert.equal(R.canFallBackToDom(at(9)), false, 'FAILED_PRECONDITION là từ chối sạch, không phải shape trôi');
});

test('đường lui — hạng "không biết đã ghi hay chưa" KHÔNG BAO GIỜ rơi về DOM', () => {
  // Rơi về đường lui sau một lượt có thể đã ghi là dựng hai Nguồn cho một mục — mà Nguồn đã
  // đẩy thì không xoá được (ADR 0010) và quota chỉ có 50.
  assert.equal(R.canFallBackToDom({ outcome: 'transport', httpStatus: 503, retryable: true }), false);
  assert.equal(R.canFallBackToDom({ outcome: 'malformed', detail: 'x' }), false);
  assert.equal(R.canFallBackToDom({ outcome: 'notReady', sourceStatus: 1 }), false);
  assert.equal(R.canFallBackToDom({ outcome: 'rejected', reason: 'user', message: 'quota' }), false);
  // Đối chứng: bốn hạng chắc chắn chưa ghi gì thì rơi về được.
  assert.equal(R.canFallBackToDom({ outcome: 'csrf' }), true);
  assert.equal(R.canFallBackToDom({ outcome: 'rejected', reason: 'er', code: 14 }), true);
  assert.equal(R.canFallBackToDom({ outcome: 'tooLarge', chars: 1 }), true);
  assert.equal(R.canFallBackToDom({ outcome: 'noTokens' }), true);
});


// =========================================================== token từ WIZ_global_data

test('WIZ — `SNlM0e` là token CSRF, `FdrFJe` là session id: hai chuỗi, hai vai', () => {
  // HTML mẫu mang một chuỗi có `{`, `}` và dấu ngoặc kép escape bên trong: bộ cắt phải cân
  // ngoặc, không được dừng ở dấu `}` đầu tiên nó gặp.
  const tokens = R.parseWizGlobalData(WIZ_HTML);
  assert.equal(tokens.at, AT);
  assert.equal(tokens.sid, SID);
});

test('WIZ — thiếu một trong hai khoá thì ném ngay, không trả token rỗng đi gửi', () => {
  assert.throws(() => R.parseWizGlobalData('<html>không có gì</html>'), /WIZ_global_data/);
  assert.throws(() => R.parseWizGlobalData('window.WIZ_global_data = {"SNlM0e":"x"};'), /FdrFJe/);
  assert.throws(() => R.parseWizGlobalData('window.WIZ_global_data = {"FdrFJe":"x"};'), /SNlM0e/);
});

// =========================================================== dựng request

function paramsOf(req) {
  const form = new URLSearchParams(req.body);
  const envelope = JSON.parse(form.get('f.req'));
  const call = envelope[0][0];
  assert.equal(call[0], R.RPC_ID, 'lớp ngoài f.req phải mang đúng rpcid');
  return JSON.parse(call[1]);
}

const build = (extra) => R.buildRequest({ notebookId: NB, source: SOURCE, tokens: TOKENS, lang: 'vi', ...extra });

test('request — `SNlM0e` vào body (`at`), `FdrFJe` vào query (`f.sid`); hoán vị vẫn gửi đi được', () => {
  const req = build();
  const query = new URL(req.url).searchParams;
  const form = new URLSearchParams(req.body);
  assert.equal(form.get('at'), AT, 'token CSRF phải nằm ở body');
  assert.equal(query.get('f.sid'), SID, 'session id phải nằm ở query');
  // Và mỗi giá trị chỉ ở đúng một chỗ — hoán vị không được "vẫn đúng một nửa".
  assert.equal(query.get('at'), null);
  assert.equal(form.get('f.sid'), null);
});

test('request — query mang rpcids, source-path của đúng notebook, hl và rt=c', () => {
  const query = new URL(build().url).searchParams;
  assert.equal(query.get('rpcids'), R.RPC_ID);
  assert.equal(query.get('source-path'), `/notebook/${NB}`);
  assert.equal(query.get('hl'), 'vi');
  assert.equal(query.get('rt'), 'c');
});

test('request — notebookId trong `source-path` và trong params là CÙNG một id', () => {
  // Hai chỗ cùng kiểu chuỗi: lệch nhau thì request vẫn gửi đi được, và Nguồn vào nhầm notebook
  // là vĩnh viễn (ADR 0010).
  const req = R.buildRequest({ notebookId: NB, source: { ...SOURCE, notebookId: NB }, tokens: TOKENS, lang: 'en' });
  const [, inParams] = paramsOf(req);
  assert.equal(inParams, NB);
  assert.equal(new URL(req.url).searchParams.get('source-path'), `/notebook/${inParams}`);
});

test('request — body kết thúc bằng dấu `&`, đúng như capture', () => {
  assert.equal(build().body.endsWith('&'), true, build().body.slice(-40));
});

test('request — client chỉ tự đặt đúng một header, và KHÔNG mượn header ký nào', () => {
  // Ràng buộc 5 của ADR 0012: đường này không liên quan `AUTH_OPS` hay `page-bridge.js`.
  const req = build();
  assert.deepEqual(Object.keys(req.headers), ['Content-Type']);
  assert.match(req.headers['Content-Type'], /application\/x-www-form-urlencoded/);
  assert.equal(req.method, 'POST');
});

test('request — tiêu đề và nội dung nằm đúng ô của mình trong params', () => {
  // Đúng cặp mà WORKSPACE_PROTOCOL đã ghi cho hộp thoại DOM (ticket 004), nhưng ở đây là hai
  // phần tử **cạnh nhau trong một mảng** — dễ hoán vị hơn chứ không khó hơn. Khoá hẳn hình
  // dạng: shape này trôi theo cohort, nên sửa nó phải là một lần sửa có chủ ý.
  const [entries] = paramsOf(build());
  assert.deepEqual(entries[0], [null, [BODY, TITLE]]);
});

test('request — MỘT request MỘT nguồn: params không bao giờ mang hơn một entry', () => {
  // Ràng buộc 2 của ADR 0012: `ADD_SOURCE` nhiều entry **âm thầm bỏ hàng thất bại** trừ khi mọi
  // entry đều fail. Nguồn gộp mang nhiều `itemIds` vẫn phải là đúng một entry.
  const [entries] = paramsOf(build());
  assert.equal(entries.length, 1, `gửi ${entries.length} entry trong một lượt izAoDd`);
  assert.equal(SOURCE.itemIds.length > 1, true, 'fixture phải là Nguồn gộp, nếu không test này rỗng tuếch');
});

test('request — từ chối dựng khi thiếu notebookId, thân Nguồn, hay một trong hai token', () => {
  assert.throws(() => R.buildRequest({ notebookId: '', source: SOURCE, tokens: TOKENS }), /notebook/i);
  assert.throws(() => R.buildRequest({ notebookId: NB, source: { ...SOURCE, body: '  ' }, tokens: TOKENS }), /rỗng/);
  assert.throws(() => R.buildRequest({ notebookId: NB, source: SOURCE, tokens: { sid: SID } }), /SNlM0e/);
  assert.throws(() => R.buildRequest({ notebookId: NB, source: SOURCE, tokens: { at: AT } }), /FdrFJe/);
});

test('request — endpoint dựng từ hằng số host của shared.js, không viết lại hostname', () => {
  assert.equal(new URL(build().url).hostname, S.NOTEBOOK_HOSTS[0]);
});

// =========================================================== một lượt đẩy

function fakeFetch(replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error(`fetch lần ${calls.length} không có phản hồi soạn sẵn`);
    return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, text: async () => reply.text || '' };
  };
  return { impl, calls };
}

function tokenReader(tokens) {
  const calls = [];
  return {
    read: async (force) => { calls.push(!!force); return tokens[Math.min(calls.length - 1, tokens.length - 1)]; },
    calls,
  };
}

const push = (config) => R.pushTextSource({ notebookId: NB, source: SOURCE, lang: 'en', ...config });

test('đẩy — một lượt thành công gọi fetch đúng MỘT lần và trả về id nguồn', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, text: wrap(wrbFrame(okPayload(2))) }]);
  const { read } = tokenReader([TOKENS]);
  const result = await push({ fetchImpl: impl, readTokens: read });
  assert.equal(result.ok, true);
  assert.equal(result.via, 'rpc');
  assert.equal(result.sourceId, SOURCE_ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
});

test('đẩy — HTTP 400 thì lấy token mới rồi thử lại ĐÚNG một lần, và lần hai dùng token mới', async () => {
  const fresh = { at: 'token-csrf-moi', sid: SID };
  const { impl, calls } = fakeFetch([
    { status: 400, text: '' },
    { status: 200, text: wrap(wrbFrame(okPayload(2))) },
  ]);
  const reader = tokenReader([TOKENS, fresh]);
  const result = await push({ fetchImpl: impl, readTokens: reader.read });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(reader.calls, [false, true], 'lượt hai phải đòi token MỚI, không dùng lại bản đã hết hạn');
  assert.equal(new URLSearchParams(calls[0].init.body).get('at'), AT);
  assert.equal(new URLSearchParams(calls[1].init.body).get('at'), fresh.at);
});

test('đẩy — HTTP 400 hai lần thì dừng ở lần thử thứ hai, không thử lần ba', async () => {
  // Ba phản hồi soạn sẵn, không hai: nếu chỉ soạn hai thì lượt gửi thứ ba chết vì *hết phản hồi*
  // chứ không vì ngân sách, và test sẽ đỏ vì một lý do chẳng liên quan tới thứ nó canh.
  const four = [400, 400, 400].map((status) => ({ status, text: '' }));
  const { impl, calls } = fakeFetch(four);
  const reader = tokenReader([TOKENS, TOKENS, TOKENS]);
  await assert.rejects(() => push({ fetchImpl: impl, readTokens: reader.read }), /CSRF|400/);
  assert.equal(calls.length, 2, `gọi fetch ${calls.length} lần — "retry đúng một lần" là đúng hai lượt gửi`);
});

test('đẩy — HTTP 200 kèm lỗi nghiệp vụ vẫn là NÉM, không phải trả về ok', async () => {
  const { impl } = fakeFetch([{ status: 200, text: wrap(wrbFrame(null, [9, 'FAILED_PRECONDITION', []])) }]);
  const { read } = tokenReader([TOKENS]);
  await assert.rejects(() => push({ fetchImpl: impl, readTokens: read }), /FAILED_PRECONDITION/);
});

test('đẩy — `notReady` nói rõ Nguồn ĐÃ được tạo, vì engine sẽ xếp mục ấy lại vào hàng đợi', async () => {
  // Ca duy nhất mà ta cầm sẵn id của Nguồn vừa tạo mà vẫn phải báo hỏng. `queue-engine` coi mọi
  // lượt đẩy hỏng là mục rớt **và** requeue, nên nếu câu lỗi không nói ra thì lần chạy sau dựng
  // Nguồn thứ hai cho cùng một mục — vĩnh viễn (ADR 0010), và tiêu một suất trong quota 50.
  const { impl } = fakeFetch([{ status: 200, text: wrap(wrbFrame(okPayload(1))) }]);
  const { read } = tokenReader([TOKENS]);
  const error = await push({ fetchImpl: impl, readTokens: read }).then(() => null, (e) => e);
  assert.ok(error);
  assert.match(error.message, new RegExp(SOURCE_ID), 'câu lỗi phải mang id Nguồn vừa được tạo');
  assert.match(error.message, /ĐÃ được tạo/);
  assert.match(error.message, /chạy lại/);
  assert.equal(error.fallback, false, 'Nguồn đã tồn tại thì đường lui chỉ dựng thêm bản thứ hai');
});

test('đẩy — 429 KHÔNG thử lại: một lượt có thể đã ghi rồi, gửi lại là dựng Nguồn thứ hai', async () => {
  const { impl, calls } = fakeFetch([{ status: 429, text: '' }]);
  const { read } = tokenReader([TOKENS]);
  await assert.rejects(() => push({ fetchImpl: impl, readTokens: read }), /429/);
  assert.equal(calls.length, 1);
});

test('đẩy — Nguồn quá lớn rơi về đường lui và KHÔNG gửi request nào, cũng không đọc token', async () => {
  // Ràng buộc 4 của ADR 0012: service worker bị Chrome giết khi một `fetch()` mất hơn 30 giây,
  // và mất SW *giữa chừng một lượt ghi đã gửi đi* là đúng trạng thái "không biết nguồn đã vào
  // hay chưa" mà cả repo dựng lên để tránh.
  const { impl, calls } = fakeFetch([]);
  const reader = tokenReader([TOKENS]);
  const big = { ...SOURCE, body: 'x'.repeat(R.MAX_BODY_CHARS + 1) };
  const error = await push({ source: big, fetchImpl: impl, readTokens: reader.read }).then(() => null, (e) => e);
  assert.ok(error, 'Nguồn quá lớn phải ném để người gọi rơi về đường lui');
  assert.equal(error.fallback, true);
  assert.equal(calls.length, 0, 'đã gửi request cho một Nguồn lẽ ra không được gửi');
  assert.equal(reader.calls.length, 0);
  // Đối chứng: ngay dưới ngưỡng thì vẫn đi đường RPC.
  assert.equal(R.tooLargeForRpc({ body: 'x'.repeat(R.MAX_BODY_CHARS) }), false);
  assert.equal(R.tooLargeForRpc(big), true);
});

test('đẩy — đọc token hỏng cũng rơi về đường lui, và chưa gửi request nào', async () => {
  // Cùng hạng với shape trôi: `WIZ_global_data` đọc không ra nghĩa là hiểu biết của ta về trang
  // đã cũ — mà lúc ấy chưa có lượt POST nào đi cả, nên đường lui không thể dựng Nguồn thứ hai.
  const { impl, calls } = fakeFetch([]);
  const read = async () => { throw new Error('không thấy WIZ_global_data'); };
  const error = await push({ fetchImpl: impl, readTokens: read }).then(() => null, (e) => e);
  assert.ok(error);
  assert.equal(error.fallback, true);
  assert.equal(calls.length, 0);
});

test('đẩy — lỗi mang cờ `fallback` đúng theo bảng hạng lỗi, không phải cứ hỏng là rơi về DOM', async () => {
  const cases = [
    ['er', wrap(['er', R.RPC_ID, 14]), 200, true],
    ['INVALID_ARGUMENT', wrap(wrbFrame(null, [3, 'x', []])), 200, true],
    ['NOT_FOUND', wrap(wrbFrame(null, [5, 'x', []])), 200, false],
    ['transport', '', 503, false],
    ['malformed', '<html>đăng nhập</html>', 200, false],
  ];
  for (const [name, text, status, expected] of cases) {
    const { impl } = fakeFetch([{ status, text }]);
    const { read } = tokenReader([TOKENS]);
    const error = await push({ fetchImpl: impl, readTokens: read }).then(() => null, (e) => e);
    assert.ok(error, `${name}: lẽ ra phải ném`);
    assert.equal(!!error.fallback, expected, `${name}: cờ fallback sai — ${error.message}`);
  }
});

// =========================================================== bề mặt module

test('đẩy — bảng hạng lỗi và cờ trên lỗi thật KHÔNG BAO GIỜ lệch nhau', async () => {
  // `canFallBackToDom` là một hàm **export**: một chỗ gọi sau này có thể hỏi nó thay vì đọc cờ
  // trên lỗi. Bảng mà nói khác hành vi thật thì chỗ gọi ấy sai lặng — và sai nặng nhất đúng ở
  // hai hạng chưa gửi gì đi (`tooLarge`, `noTokens`), nơi câu trả lời sai là "đừng rơi về đường
  // lui" cho một Nguồn mà đường lui cứu được.
  const big = { ...SOURCE, body: 'x'.repeat(R.MAX_BODY_CHARS + 1) };
  const cases = [
    ['tooLarge', { source: big, fetchImpl: fakeFetch([]).impl, readTokens: tokenReader([TOKENS]).read }],
    ['noTokens', { fetchImpl: fakeFetch([]).impl, readTokens: async () => { throw new Error('WIZ hỏng'); } }],
    ['csrf', { fetchImpl: fakeFetch([{ status: 400, text: '' }, { status: 400, text: '' }]).impl, readTokens: tokenReader([TOKENS]).read }],
    ['er', { fetchImpl: fakeFetch([{ status: 200, text: wrap(['er', R.RPC_ID, 14]) }]).impl, readTokens: tokenReader([TOKENS]).read }],
    ['status', { fetchImpl: fakeFetch([{ status: 200, text: wrap(wrbFrame(null, [5, 'x', []])) }]).impl, readTokens: tokenReader([TOKENS]).read }],
    ['transport', { fetchImpl: fakeFetch([{ status: 503, text: '' }]).impl, readTokens: tokenReader([TOKENS]).read }],
    ['notReady', { fetchImpl: fakeFetch([{ status: 200, text: wrap(wrbFrame(okPayload(1))) }]).impl, readTokens: tokenReader([TOKENS]).read }],
  ];
  for (const [name, config] of cases) {
    const error = await push(config).then(() => null, (e) => e);
    assert.ok(error, `${name}: lẽ ra phải ném`);
    assert.equal(error.fallback, R.canFallBackToDom(error.outcome),
      `${name}: cờ trên lỗi là ${error.fallback} còn bảng nói ${R.canFallBackToDom(error.outcome)}`);
  }
});

test('module — chỉ có đường text, không có biến thể URL nào', () => {
  // Ràng buộc 3 của ADR 0012: đường URL đổ mọi nguyên nhân về **một mã `9` duy nhất** và
  // **luôn để lại ghost row ăn quota** (50 nguồn/notebook, xoá tay trong NotebookLM). Khoá bề
  // mặt module lại để việc thêm một biến thể URL không lọt vào bằng một lần sửa vô ý.
  assert.deepEqual(Object.keys(R).sort(), [
    'GRPC_CODE', 'MAX_BODY_CHARS', 'RPC_ID', 'SOURCE_STATUS_READY', 'WIZ_KEYS',
    'buildParams', 'buildRequest', 'canFallBackToDom', 'parseFrames', 'parseWizGlobalData',
    'pushTextSource', 'readResponse', 'tooLargeForRpc',
  ]);
});

// ============================================ dây nối ở service worker (đường chính / đường lui)

/**
 * Từ đây xuống là service worker **thật**, nạp vào một ngữ cảnh V8 sạch với `chrome` giả và
 * `fetch` giả cùng ghi vào một sổ. Không hàm nào được gọi thẳng: câu hỏi duy nhất đáng hỏi ở
 * tầng này là *"lượt đẩy đi đường nào"*, và nó chỉ trả lời được khi cả hai lối ra — `fetch` của
 * đường RPC và `chrome.tabs` của đường lui — nằm chung một sổ.
 */
const posts = (sw) => sw.log.filter((row) => row.api === 'fetch' && row.method === 'POST');
const gets = (sw) => sw.log.filter((row) => row.api === 'fetch' && row.method === 'GET');

/** Chỉ chặn lượt `POST`; `GET` rơi về mặc định của harness (HTML mang `WIZ_global_data`). */
function scriptedPost(replies) {
  let sent = 0;
  return async (_href, init) => {
    if (((init && init.method) || 'GET') !== 'POST') return null;
    const reply = replies[Math.min(sent, replies.length - 1)];
    sent += 1;
    return fakeResponse(reply.status, reply.text);
  };
}

/** Một trang tài liệu quá lớn để đi đường RPC — ràng buộc 4 của ADR 0012. */
const hugeDoc = (layer, _tab, message) => {
  if (layer !== 'docs' || M.typeOf(message) !== M.TYPES.EXTRACT_DOC) return undefined;
  const markdown = `## Trang rất dài\n\n${'chữ '.repeat(R.MAX_BODY_CHARS / 3)}`;
  return {
    ok: true,
    result: { url: message.url, title: 'Trang rất dài', markdown, chars: markdown.length, via: 'fetch', escalated: false },
  };
};

/**
 * **Hai** Nhánh, nên **hai** Nguồn — không phải một.
 *
 * Một lượt chạy một Nguồn không phân biệt được bất kỳ phép rút gọn nào ở tầng này
 * (WORKSPACE_PROTOCOL v9): "một request một nguồn" trùng với "một request cả lượt", và "đọc
 * token một lần rồi giữ lại" trùng với "đọc lại token mỗi lần đẩy". Cả hai luật chỉ có nghĩa
 * khi lượt chạy có từ hai Nguồn trở lên. `groupKey()` cắt theo Nhánh, nên hai `branch` khác
 * nhau là hai Nguồn.
 */
const TWO_BRANCHES = [
  { url: `${SITE}/guide/cai-dat`, title: 'Cài đặt', branch: 'Hướng dẫn' },
  { url: `${SITE}/api/tong-quan`, title: 'Tổng quan', branch: 'API' },
];

async function runDocsImport(given, pages = TWO_BRANCHES) {
  const sw = bootServiceWorker(given);
  await sw.send({ type: M.TYPES.PICK_DOCS });
  const answer = await sw.send({
    type: M.TYPES.IMPORT_DOCS, page: DOCS_PAGE, pages,
  }, { tab: { id: DOCS_TAB, url: DOCS_PAGE } });
  return { sw, answer };
}

test('service worker — đường chính là RPC, và MỘT request cho MỖI Nguồn', async () => {
  // Ràng buộc 2 của ADR 0012 nhìn từ tầng dây nối: hai Nguồn phải là **hai** lượt gửi. Gộp
  // chúng lại thì `ADD_SOURCE` âm thầm bỏ hàng thất bại trừ khi mọi hàng đều fail.
  const { sw, answer } = await runDocsImport();
  assert.equal(answer.ok, true, answer.error);

  const sent = posts(sw);
  assert.equal(sent.length, 2, `hai Nguồn mà gửi ${sent.length} request`);
  for (const row of sent) assert.match(row.url, /\/batchexecute\?/);
  assert.deepEqual([...sw.messaged(M.TYPES.PUSH_SOURCE)], [], 'đường RPC không được mở tab NotebookLM nào');
});

test('service worker — trong request thật, `SNlM0e` ở body và `FdrFJe` ở query', async () => {
  // Cùng phép canh với test dựng request, nhưng đi qua **cả dây nối**: token do service worker
  // tự đọc từ HTML, rồi tự đưa vào đúng hai chỗ. Hoán vị hai chuỗi ấy vẫn ra một request gửi
  // đi được, nên đây là chỗ duy nhất nói được nó đúng chỗ.
  const { sw } = await runDocsImport();
  const sent = posts(sw)[0];
  assert.equal(new URLSearchParams(sent.body).get('at'), AT);
  assert.equal(new URL(sent.url).searchParams.get('f.sid'), SID);
});

test('service worker — token đọc MỘT lần cho cả lượt, và chỉ đọc lại khi bị HTTP 400', async () => {
  // Hai Nguồn, hai lượt gửi, **một** lượt đọc trang chủ: giữ lại token là điều duy nhất phân
  // biệt được ở đây, và nó chỉ phân biệt được khi lượt chạy có hơn một Nguồn.
  const clean = await runDocsImport();
  assert.equal(posts(clean.sw).length, 2, 'fixture phải có hai lượt gửi, nếu không test này rỗng tuếch');
  assert.equal(gets(clean.sw).length, 1, 'lượt sạch không được tải lại trang chủ lần nào nữa');

  const retried = await runDocsImport({
    fetch: scriptedPost([{ status: 400, text: '' }, { status: 200, text: wrap(wrbFrame(okPayload(2))) }]),
  }, [TWO_BRANCHES[0]]);
  assert.equal(retried.answer.ok, true, retried.answer.error);
  assert.equal(posts(retried.sw).length, 2, 'CSRF hết hạn thì thử lại đúng một lần');
  assert.equal(gets(retried.sw).length, 2, 'lượt thử lại phải lấy token MỚI, không dùng lại bản đã hết hạn');
});

test('service worker — INVALID_ARGUMENT rơi về đường lui qua tab; NOT_FOUND thì mục rớt', async () => {
  // Hai mã gRPC cùng kiểu ở cùng một chỗ, hai vai khác hẳn nhau (xem `canFallBackToDom`), và
  // hoán vị chúng vẫn cho hai lượt chạy trót lọt — chỉ là một lượt mở thêm một tab để hỏng lần
  // nữa, còn lượt kia vứt mất đường lui đúng lúc cần nó nhất.
  const drift = await runDocsImport({
    fetch: scriptedPost([{ status: 200, text: wrap(wrbFrame(null, [3, 'shape đã trôi', []])) }]),
  });
  assert.equal(drift.answer.ok, true, drift.answer.error);
  assert.deepEqual([...drift.sw.messaged(M.TYPES.PUSH_SOURCE)], [NOTEBOOK_TAB], 'shape trôi phải rơi về đường lui');
  assert.doesNotMatch(drift.answer.result.summary, /Mục rớt/);

  const gone = await runDocsImport({
    fetch: scriptedPost([{ status: 200, text: wrap(wrbFrame(null, [5, 'không thấy notebook', []])) }]),
  });
  assert.deepEqual([...gone.sw.messaged(M.TYPES.PUSH_SOURCE)], [], 'NOT_FOUND mà mở tab là đâm vào đúng bức tường ấy');
  assert.match(gone.answer.result.summary, /Mục rớt/);
  assert.match(gone.answer.result.summary, /NOT_FOUND/);
});

test('service worker — mỗi lần rơi về đường lui đều để lại một dòng cảnh báo', async () => {
  // Đường lui chạy **thành công**, nên `log.dropped` rỗng và bảng tổng kết trông y hệt một lượt
  // RPC sạch. Nếu không có dòng này thì shape trôi theo cohort làm chết đường chính mà không ai
  // biết, và cả extension lặng lẽ chạy trên đường không có tín hiệu xong việc.
  const drift = await runDocsImport({
    fetch: scriptedPost([{ status: 200, text: wrap(wrbFrame(null, [3, 'shape đã trôi', []])) }]),
  });
  assert.equal(drift.sw.warnings.length, 2, 'hai Nguồn rơi về đường lui phải là hai dòng cảnh báo');
  for (const line of drift.sw.warnings) assert.match(line, /INVALID_ARGUMENT/);

  // Đối chứng: lượt đi trọn đường RPC không được cảnh báo gì, nếu không dòng ấy thành nhiễu.
  const clean = await runDocsImport();
  assert.deepEqual(clean.sw.warnings, []);
});

test('service worker — Nguồn quá lớn đi thẳng đường lui, KHÔNG gửi request nào', async () => {
  const { sw, answer } = await runDocsImport({ answer: hugeDoc });
  assert.equal(answer.ok, true, answer.error);
  assert.equal(posts(sw).length, 0, 'đã gửi request cho một Nguồn lẽ ra không được gửi');
  assert.deepEqual([...sw.messaged(M.TYPES.PUSH_SOURCE)], [NOTEBOOK_TAB]);
});
