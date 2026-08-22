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
  batchResponse, wrap, wrbFrame, erFrame, okPayload, successBody, WIZ_HTML,
  paramsOfBody, pathTo, nodeAt,
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

test('reader — `er` và `wrb.fr` cùng có mặt: KHÔNG đọc theo frame nào, và KHÔNG phụ thuộc thứ tự', () => {
  // Ranh giới ở đây là **"chắc chắn đã ghi hay chắc chắn chưa"**, không phải "frame nào đứng
  // trước". Hai cách đọc nói hai điều trái ngược nhau và cả hai đều tốn thật:
  //
  //   theo `er`     → được rơi về đường DOM → nếu `wrb.fr` thật thì có Nguồn THỨ HAI, không xoá
  //                   được (ADR 0010), ăn quota 50/notebook;
  //   theo `wrb.fr` → mục vào Sổ đã import → nếu `er` thật thì Nguồn chưa hề tồn tại và ADR
  //                   0006/0009 khiến mục KHÔNG BAO GIỜ được thử lại. Mất dữ liệu âm thầm.
  //
  // Nên hạng đúng là `malformed`: hỏng đóng, không rơi về đường lui, không vào Sổ, thử lại lần
  // sau. Kiểm CẢ HAI thứ tự — một thứ tự thôi thì "đọc theo frame đứng trước" vẫn xanh.
  for (const order of [[erFrame(), wrbFrame(okPayload(2))], [wrbFrame(okPayload(2)), erFrame()]]) {
    // Bốn frame, hai frame quyết định nằm GIỮA: `[0]` và `at(-1)` đều không tình cờ đúng.
    const read = R.readResponse(ok200(batchResponse([HEAD, ...order, TAIL])));
    assert.equal(read.outcome, 'malformed', `thứ tự ${order.map((f) => f[0]).join(' → ')}: ${JSON.stringify(read)}`);
    // Không được mang theo dấu vết của một lượt thành công: `sourceId` ở đây là thứ sẽ đi vào Sổ.
    assert.equal(read.sourceId, undefined);
    assert.equal(R.canFallBackToDom(read), false);
  }
});

test('reader — một mình `wrb.fr` vẫn đọc ra ok, và một mình `er` vẫn là rejected (chứng cho test trên)', () => {
  // Chứng đối: `malformed` ở trên đến từ việc HAI frame cùng có mặt, không phải từ việc fixture
  // bốn frame làm hỏng bộ đọc.
  const okRead = R.readResponse(ok200(batchResponse([HEAD, wrbFrame(okPayload(2)), TAIL])));
  assert.equal(okRead.outcome, 'ok', JSON.stringify(okRead));
  const erRead = R.readResponse(ok200(batchResponse([HEAD, erFrame(), TAIL])));
  assert.equal(erRead.outcome, 'rejected', JSON.stringify(erRead));
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

/**
 * `params` của một request đã dựng. Lớp bọc `f.req` gỡ bằng đúng bộ mà `fetch` giả của harness
 * dùng để đọc lại request — hai bản gỡ là hai bản sẽ lệch, và lệch thì cả hai bên vẫn xanh.
 */
const paramsOf = (req) => paramsOfBody(req.body);

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
  const inParams = atMark(paramsOf(req), SPEC.marks.notebookId);
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

// ------------------------------- shape của `params`: mẫu có xuất xứ, và nó nằm ở MỘT chỗ

const SPEC = R.TEXT_PARAMS;

/**
 * Giá trị `buildParams` đặt vào đúng ô mà **mẫu** dành cho chỗ giữ chỗ `mark`.
 *
 * Cả cụm test dưới đây đọc mẫu chứ không chép lại shape (`pathTo` ở `helpers/batchexecute.js`,
 * dùng chung với `fetch` giả của harness): ticket 015 xanh 766 với một cặp `content`/`title` đảo
 * đúng vì test của nó đối chiếu `buildParams` với một hằng số chép tay từ ticket, nên phép hoán
 * vị chỉ chứng minh code khớp hằng số ấy. Khi capture về, chỗ phải sửa là `TEXT_PARAMS_SPECIMEN`
 * — mọi test ở đây tự đi theo.
 */
function atMark(params, mark) {
  const path = pathTo(SPEC.specimen, mark);
  assert.ok(path, `mẫu shape không còn chỗ giữ chỗ \`${mark}\``);
  return nodeAt(params, path);
}

/** Spec của một Nguồn — mảng **chứa** cặp tiêu đề/nội dung, tìm qua mẫu chứ không qua chỉ số. */
function entryOf(params) {
  const path = pathTo(SPEC.specimen, SPEC.marks.title);
  assert.ok(path && path.length >= 2, 'mẫu shape không còn chỗ giữ chỗ tiêu đề');
  return nodeAt(params, path.slice(0, -2));
}

const swap = (text, mark, value) => text.split(JSON.stringify(mark)).join(JSON.stringify(value));

test('shape — mẫu `params` giữ đủ ba chỗ giữ chỗ, mỗi cái đúng MỘT lần', () => {
  // Test này canh chính **cái mẫu**, không canh code. Khi owner dán capture đè lên
  // `TEXT_PARAMS_SPECIMEN`, ba chuỗi `AAA-…`/`BBB-…`/`CCC-…` phải còn nguyên trong đó: dán một
  // capture còn nguyên giá trị thật thì `buildParams` gửi đi tiêu đề của capture cho MỌI Nguồn,
  // request vẫn thành công, và tên Nguồn sai là vĩnh viễn (ADR 0010).
  const flat = JSON.stringify(SPEC.specimen);
  for (const [role, mark] of Object.entries(SPEC.marks)) {
    const hits = flat.split(JSON.stringify(mark)).length - 1;
    assert.equal(hits, 1, `${role}: chỗ giữ chỗ \`${mark}\` xuất hiện ${hits} lần trong mẫu`);
  }
});

test('shape — `buildParams` chỉ thay ba chỗ giữ chỗ, không đụng phần tử nào khác của mẫu', () => {
  // Phát biểu đầy đủ nhất về shape, và nó đối chiếu với **mẫu** chứ không với một hằng số chép
  // tay. Một `fillMarks` đánh rơi phần tử, nhân đôi một mảng con, hay bỏ sót ô thứ ba đều chết ở
  // đây mà không phải viết lại shape lần thứ hai trong test.
  let expected = JSON.stringify(SPEC.specimen);
  expected = swap(expected, SPEC.marks.title, TITLE);
  expected = swap(expected, SPEC.marks.content, BODY);
  expected = swap(expected, SPEC.marks.notebookId, NB);
  assert.deepEqual(paramsOf(build()), JSON.parse(expected));
});

test('shape — tiêu đề và nội dung vào ĐÚNG ô mà mẫu dành cho chúng', () => {
  // Cặp correspondence-critical của WORKSPACE_PROTOCOL, bản nặng nhất trong repo: hoán vị
  // **không** hỏng đóng. Request vẫn ra một Nguồn "thành công", chỉ là nó mang tên bằng cả
  // transcript — không sửa được, không xoá được, ăn một suất quota 50 (ADR 0010).
  //
  // Chiều được phát biểu đúng **một** lần, trong mẫu, bằng hai chuỗi tự gọi tên mình; test đọc
  // vị trí của từng chuỗi rồi đòi `buildParams` đặt đúng đối số vào đó.
  const params = paramsOf(build());
  assert.notEqual(TITLE, BODY, 'hai chuỗi giống nhau thì phép hoán vị không đo được gì');
  assert.equal(atMark(params, SPEC.marks.title), TITLE, 'ô tiêu đề đang mang THÂN Nguồn');
  assert.equal(atMark(params, SPEC.marks.content), BODY, 'ô nội dung đang mang TÊN Nguồn');
});

test('shape — chỉ dấu loại nguồn văn bản còn nguyên, và phần tử cuối KHÔNG phải nó', () => {
  // Hai hằng số cùng đơn vị, hai vai (WORKSPACE_PROTOCOL): `2` nói "nguồn này là văn bản" ở slot
  // 3, `1` là phần tử cuối spec sau đợt di trú 8→11. Hoán vị chúng vẫn ra một spec 11 phần tử
  // parse được, và server thì nhận một loại nguồn khác.
  const entry = entryOf(paramsOf(build()));
  assert.notEqual(SPEC.kindText, SPEC.tail, 'hai hằng số bằng nhau thì hoán vị không đo được gì');
  assert.notEqual(entry.indexOf(SPEC.kindText), -1,
    `spec không còn chỉ dấu loại nguồn nào: ${JSON.stringify(entry)}`);
  assert.equal(entry.at(-1), SPEC.tail, `phần tử cuối của spec: ${JSON.stringify(entry)}`);
  assert.notEqual(entry.at(-1), SPEC.kindText, 'chỉ dấu loại nguồn trôi xuống đuôi spec');
});

test('shape — mỗi lượt dựng một mảng MỚI, mẫu thì đông cứng đến tận đáy', () => {
  // `buildParams` trả về chính mẫu (hay một mảng con của mẫu) thì lượt đẩy sau sửa được payload
  // của lượt trước — và vì mẫu `Object.freeze`, lỗi ấy lộ ra ở một chỗ chẳng liên quan.
  const a = R.buildParams({ notebookId: NB, source: SOURCE });
  const b = R.buildParams({ notebookId: NB, source: { ...SOURCE, name: 'Ten Nguon khac' } });
  assert.equal(Object.isFrozen(a), false, 'params trả về phải là mảng mới, không phải mẫu');
  assert.notEqual(atMark(a, SPEC.marks.title), atMark(b, SPEC.marks.title));
  assert.equal(Object.isFrozen(entryOf(SPEC.specimen)), true, 'mẫu chỉ đông cứng lớp ngoài');
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

test('đẩy — CHỖ DỰA CỦA TICKET 020: shape sai thì hỏng ĐÓNG, và đó là lý do được sửa mù', async () => {
  // Ticket 020 đổi shape `params` **mà không có capture nào** — không ai trong phòng đăng nhập
  // được NotebookLM. Cả biện hộ của lần sửa ấy nằm ở đúng một chuỗi sự kiện: shape sai → server
  // trả `INVALID_ARGUMENT` → `canFallBackToDom` cho hạng ấy rơi về đường DOM → chưa ghi gì,
  // không mất gì. Ô duy nhất mất dữ liệu trong bảng cân của ticket là *giữ nguyên* cặp cũ, vì nó
  // **thành công** với một Nguồn mang tên bằng cả transcript.
  //
  // Nên đây không phải một dòng trong bảng hạng lỗi — nó là **tiền đề**. Đổi
  // `canFallBackToDom(INVALID_ARGUMENT)` thành `false`, hay để bộ đọc coi một phản hồi từ chối
  // là `ok`, thì lập luận của ticket 020 sụp và lần đổi shape kia thành đổi mù không lưới.
  const drift = wrap(wrbFrame(null, [R.GRPC_CODE.INVALID_ARGUMENT, 'shape đã trôi', []]));
  const { impl, calls } = fakeFetch([{ status: 200, text: drift }]);
  const { read } = tokenReader([TOKENS]);
  const error = await push({ fetchImpl: impl, readTokens: read }).then(() => null, (e) => e);

  assert.ok(error, 'một phản hồi từ chối mà không ném là ghi vào Sổ một lượt thành công không có thật');
  assert.equal(error.outcome.outcome, 'rejected');
  assert.equal(error.outcome.code, R.GRPC_CODE.INVALID_ARGUMENT);
  assert.equal(error.fallback, true, 'INVALID_ARGUMENT không rơi về đường lui = ticket 020 mất lưới');
  assert.equal(R.canFallBackToDom(error.outcome), true);

  // Và lượt bị từ chối ấy mang **đúng** shape `buildParams` đang dựng — nếu không thì phép đo
  // trên nói về một payload khác với payload sẽ đi trên dây.
  assert.deepEqual(paramsOf({ body: calls[0].init.body }), R.buildParams({ notebookId: NB, source: SOURCE }));
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
    'GRPC_CODE', 'MAX_BODY_CHARS', 'RPC_ID', 'SOURCE_STATUS_READY', 'TEXT_PARAMS', 'WIZ_KEYS',
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

// ======================================== đường đẩy lên bảng tổng kết (ticket 019)

/**
 * Kịch bản `POST` **theo đúng lượt**, không lặp lại phản hồi cuối như `scriptedPost`.
 *
 * Đó là cả điểm khác: một lượt chạy hỗn hợp cần lượt 1 khác lượt 2 khác lượt 3, và một fixture
 * "lặp lại cái cuối" sẽ im lặng biến mọi lượt thừa thành cùng một hạng. Gửi nhiều hơn số lượt đã
 * soạn là hỏng fixture, không phải chuyện để đoán.
 */
function postsInOrder(replies) {
  let sent = 0;
  return async (_href, init) => {
    if (((init && init.method) || 'GET') !== 'POST') return null;
    assert.ok(sent < replies.length,
      `fixture soạn ${replies.length} lượt POST mà đường đẩy gửi lượt thứ ${sent + 1}`);
    const reply = replies[sent];
    sent += 1;
    return fakeResponse(reply.status, reply.text);
  };
}

/**
 * **Bốn** Nhánh, nên bốn Nguồn — và Nhánh rơi về đường lui là Nhánh **thứ hai**.
 *
 * Luật fixture một phần tử của `WORKSPACE_PROTOCOL.md` v9 cắn đúng ở đây: với một Nguồn thì
 * "đường của Nguồn này" và "đường của cả lượt" là **cùng một câu**, nên gán `via` của Nguồn A
 * cho Nguồn B không phân biệt được với hành vi đúng. Nằm đầu thì `[0]` lọt, nằm cuối thì
 * `at(-1)` lọt.
 *
 * Bốn chứ không ba, và vị trí hai chứ không phải chính giữa: `[rpc, dom, rpc]` **bằng chính bản
 * đảo ngược của nó**, nên với ba Nhánh một bản `formatSummary` đọc nhãn theo chỉ số đảo ngược
 * vẫn xanh cả suite. "Không đầu không cuối" chưa đủ — còn phải không nằm ở tâm đối xứng.
 */
const FOUR_BRANCHES = [
  { url: `${SITE}/guide/cai-dat`, title: 'Cài đặt', branch: 'Hướng dẫn' },
  { url: `${SITE}/api/tong-quan`, title: 'Tổng quan', branch: 'API' },
  { url: `${SITE}/faq/thuong-gap`, title: 'Câu hỏi thường gặp', branch: 'Hỏi đáp' },
  { url: `${SITE}/blog/ghi-chu`, title: 'Ghi chú phát hành', branch: 'Nhật ký' },
];

const OK_BODY = wrap(wrbFrame(okPayload(2)));
/** `INVALID_ARGUMENT` — hạng "chắc chắn chưa ghi gì", đường lui được chạy (ADR 0012). */
const DRIFT_BODY = wrap(wrbFrame(null, [3, 'shape đã trôi', []]));

test('service worker — lượt chạy HỖN HỢP: bảng tổng kết nói ĐÚNG Nguồn nào đi đường nào', async () => {
  // Đây là câu hỏi đầu tiên của mọi lượt chạy thật: đường chính có chạy không (ADR 0012, và
  // shape `params` chưa từng đối chiếu với capture thật — ticket 020). Trước ticket này câu trả
  // lời chỉ nằm trong `console.warn` của DevTools service worker.
  const { sw, answer } = await runDocsImport({
    fetch: postsInOrder([
      { status: 200, text: OK_BODY },
      { status: 200, text: DRIFT_BODY },
      { status: 200, text: OK_BODY },
      { status: 200, text: OK_BODY },
    ]),
  }, FOUR_BRANCHES);

  assert.equal(answer.ok, true, answer.error);
  assert.equal(posts(sw).length, 4, 'bốn Nguồn phải là bốn lượt gửi — ràng buộc 2 của ADR 0012');
  assert.deepEqual([...sw.messaged(M.TYPES.PUSH_SOURCE)], [NOTEBOOK_TAB],
    'đúng Nguồn thứ hai rơi về đường lui, và nó đi qua tab NotebookLM');
  assert.equal(sw.warnings.length, 1, 'một Nguồn rơi về đường lui là một dòng cảnh báo');

  // Tên Nguồn ↔ nhãn đường, **trên cùng một dòng**. Con số tổng một mình không phân biệt được
  // lượt chạy này với lượt chạy đã hoán vị đường giữa hai Nguồn: cả hai đều ra "3 RPC, 1 lui".
  const table = answer.result.summary;
  assert.match(table, /\+ docs\.acme\.dev — Hướng dẫn: [^\n]* — đường RPC$/m, table);
  assert.match(table, /\+ docs\.acme\.dev — API: [^\n]* — đường lui \(DOM\)$/m, table);
  assert.match(table, /\+ docs\.acme\.dev — Hỏi đáp: [^\n]* — đường RPC$/m, table);
  assert.match(table, /\+ docs\.acme\.dev — Nhật ký: [^\n]* — đường RPC$/m, table);
  assert.match(table, /Nguồn đã tạo: 4 \(1 đường lui \(DOM\), 3 đường RPC\)/, table);
});

test('service worker — lượt đi trọn đường RPC không có dòng đường lui nào (đối chứng)', async () => {
  // Đối chứng cho test trên: nếu bảng nói "đường lui" ở cả lượt sạch thì phép đo kia xanh vì lý
  // do khác với lý do nó tưởng.
  const { answer } = await runDocsImport({}, FOUR_BRANCHES);
  const table = answer.result.summary;
  assert.match(table, /Nguồn đã tạo: 4 \(4 đường RPC\)/, table);
  assert.doesNotMatch(table, /đường lui/, table);
  assert.doesNotMatch(table, /đường không rõ/, table);
});

test('service worker — Nguồn quá lớn không gửi request nào, và bảng vẫn gọi tên đường lui', async () => {
  // Hạng `tooLarge` chưa ra khỏi `pushTextSource` (ràng buộc 4 của ADR 0012: SW bị Chrome giết ở
  // 30 giây). Nó vẫn là một Nguồn đã vào notebook qua đường lui, nên bảng phải nói ra — nếu
  // không, một lượt chạy 55 Nguồn quá khổ trông y hệt một lượt RPC sạch.
  const { sw, answer } = await runDocsImport({ answer: hugeDoc });
  assert.equal(posts(sw).length, 0, 'đã gửi request cho một Nguồn lẽ ra không được gửi');
  assert.match(answer.result.summary, /Nguồn đã tạo: 2 \(2 đường lui \(DOM\)\)/, answer.result.summary);
});

// ======================================== tên Nguồn lên bảng tổng kết (ticket 021)

/**
 * Đổi phản hồi của **đúng lượt POST thứ `nth`**; các lượt khác rơi về mặc định của harness, tức
 * echo lại đúng tiêu đề vừa gửi.
 *
 * Khác `postsInOrder` ở chỗ đó: ở đây ba lượt "bình thường" phải mang **ba tiêu đề khác nhau**,
 * nên một danh sách phản hồi soạn sẵn không dựng nổi — soạn tay thì chính chúng cũng thành ba
 * cái tên lệch, và test sẽ xanh vì lý do khác với lý do nó tưởng.
 */
function postNth(nth, reply) {
  let sent = 0;
  return async (_href, init) => {
    if (((init && init.method) || 'GET') !== 'POST') return null;
    sent += 1;
    return sent === nth ? fakeResponse(reply.status, reply.text) : null;
  };
}

/** Câu chữ thật của `addTextSource` khi hộp thoại không có ô tiêu đề. */
const domWarning = (name) => `không thấy ô tiêu đề trong hộp thoại — NotebookLM sẽ tự đặt tên thay cho "${name}"`;

/** Tab NotebookLM đẩy được nhưng **không** điền được ô tiêu đề — nhánh `named: false` của ticket 004. */
const tabCannotName = (layer, _tab, message) => {
  if (layer !== 'notebooklm' || M.typeOf(message) !== M.TYPES.PUSH_SOURCE) return undefined;
  const name = String(message.source.name);
  return { ok: true, result: { ok: true, name, named: false, warning: domWarning(name) } };
};

test('service worker — đường lui đẩy được mà không đặt được tên: bảng gọi ĐÚNG tên Nguồn ấy', async () => {
  // Cùng fixture bốn Nhánh của ticket 019, Nhánh đặc biệt vẫn ở **vị trí hai**: một Nguồn thì
  // "Nguồn này mất tên" trùng khít "cả lượt mất tên"; ba Nguồn với Nguồn đặc biệt ở giữa thì dãy
  // bằng chính bản đảo ngược của nó (WORKSPACE_PROTOCOL v10).
  const { sw, answer } = await runDocsImport({
    fetch: postNth(2, { status: 200, text: DRIFT_BODY }),
    answer: tabCannotName,
  }, FOUR_BRANCHES);

  assert.equal(answer.ok, true, answer.error);
  assert.deepEqual([...sw.messaged(M.TYPES.PUSH_SOURCE)], [NOTEBOOK_TAB], 'đúng Nguồn thứ hai đi đường lui');

  // Lượt đẩy **thành công**, nên không có dòng nào ở "Mục rớt" — trước ticket này cả chuyện
  // NotebookLM tự đặt tên cho Nguồn ấy không để lại dấu vết nào cho người dùng, mà tên Nguồn thì
  // extension không sửa và không xoá được (ADR 0010), còn ADR 0009 đọc chính tên ấy ở lần sau.
  const table = answer.result.summary;
  assert.doesNotMatch(table, /Mục rớt/, table);
  assert.match(table, /^Tên Nguồn KHÔNG theo ý ta — 1 Nguồn/m, table);
  assert.match(table, /^ {2}! docs\.acme\.dev — API: không thấy ô tiêu đề/m, table);
  for (const nhanh of ['Hướng dẫn', 'Hỏi đáp', 'Nhật ký']) {
    assert.doesNotMatch(table, new RegExp(`! docs\\.acme\\.dev — ${nhanh}:`), `${nhanh} đặt được tên mà vẫn bị gọi tên`);
  }
  // Và Nguồn ấy vẫn là Nguồn đi đường lui: hai câu nói về **cùng một** Nguồn, không lệch nhau.
  assert.match(table, /^ {2}\+ docs\.acme\.dev — API: [^\n]* — đường lui \(DOM\)$/m, table);
});

test('service worker — đường RPC nói CÙNG một chuyện: tên notebook đọc lại khác tên ta gửi', async () => {
  // Đường RPC không có khái niệm "không đặt được tên" — nó gửi tiêu đề trong `params` và không
  // bao giờ thấy một ô tiêu đề nào. Nhưng nó nhận về **tên notebook thật sự đang giữ**, nên câu
  // hỏi của ticket 021 vẫn trả lời được ở đúng chỗ nối, và trả lời bằng bằng chứng mạnh hơn.
  //
  // Đây không phải một ca giả định: mẫu `params` của ticket 020 dựng từ hai bộ reverse-engineer
  // và **chưa từng đối chiếu với một capture thật**. Ô tiêu đề sai chỗ thì request vẫn thành
  // công, chỉ là Nguồn mang một cái tên khác — vĩnh viễn.
  const tuDat = 'Than Nguon: mot dong transcript';
  const { sw, answer } = await runDocsImport({
    fetch: postNth(2, { status: 200, text: successBody(tuDat) }),
  }, FOUR_BRANCHES);

  assert.equal(answer.ok, true, answer.error);
  assert.equal(posts(sw).length, 4, 'bốn Nguồn phải là bốn lượt gửi — không lượt nào rơi về đường lui');
  assert.deepEqual([...sw.messaged(M.TYPES.PUSH_SOURCE)], [], 'tên lệch KHÔNG phải lý do để đẩy lần nữa');

  // **Chiều** của cặp: hai chuỗi cùng kiểu ở hai vai ngược nhau. Hoán vị chúng vẫn cho một câu
  // đọc trôi chảy — và nó nói ngược sự thật về cái tên duy nhất người dùng không sửa lại được.
  const table = answer.result.summary;
  assert.match(table, /^Tên Nguồn KHÔNG theo ý ta — 1 Nguồn/m, table);
  assert.match(
    table,
    new RegExp(`^ {2}! docs\\.acme\\.dev — API: notebook đang để tên "${tuDat}", không phải "docs\\.acme\\.dev — API"$`, 'm'),
    table,
  );
  for (const nhanh of ['Hướng dẫn', 'Hỏi đáp', 'Nhật ký']) {
    assert.doesNotMatch(table, new RegExp(`! docs\\.acme\\.dev — ${nhanh}:`), `${nhanh} mang đúng tên mà vẫn bị gọi tên`);
  }
});

test('service worker — lượt mà mọi Nguồn mang đúng tên ta đặt KHÔNG có mục nào (đối chứng)', async () => {
  // Đối chứng cho hai test trên, và nó chỉ có nghĩa vì phản hồi mặc định của harness **echo lại
  // đúng tiêu đề vừa gửi**: một fixture trả cùng một tiêu đề cho mọi request phát biểu rằng
  // notebook đặt lại tên cho mọi Nguồn, và khi ấy mục này hiện ở cả lượt sạch.
  const { answer } = await runDocsImport({}, FOUR_BRANCHES);
  assert.equal(answer.result.summary.includes('Tên Nguồn KHÔNG'), false, answer.result.summary);
  assert.doesNotMatch(answer.result.summary, /^ {2}!/m, answer.result.summary);
});

test('service worker — đường lui ĐẶT ĐƯỢC tên thì bảng không có mục nào (đối chứng cho stub tab)', async () => {
  // Đối chứng cho test đường lui ở trên, và nó canh chính **stub tab**: một stub trả về thứ
  // `addTextSource` không bao giờ trả (`{ sourceId }`, không `name`, không `named`) làm mọi Nguồn
  // đi đường lui rơi vào hạng "chưa xác nhận được tên" ở mọi test khác của file này — im lặng,
  // vì không test nào hỏi tới. Ở đây thì có hỏi.
  const { sw, answer } = await runDocsImport({
    fetch: postNth(2, { status: 200, text: DRIFT_BODY }),
  }, FOUR_BRANCHES);

  assert.deepEqual([...sw.messaged(M.TYPES.PUSH_SOURCE)], [NOTEBOOK_TAB], 'fixture phải có một Nguồn đi đường lui');
  const table = answer.result.summary;
  assert.match(table, /^ {2}\+ docs\.acme\.dev — API: [^\n]* — đường lui \(DOM\)$/m, table);
  assert.equal(table.includes('Tên Nguồn KHÔNG'), false, table);
});
