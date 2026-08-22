// Test toàn vẹn của **kỷ luật định tuyến tin nhắn** (ticket 011, spec 0001).
//
// Vì sao nó phải tồn tại: ticket 010 khai `http://*/*` + `https://*/*` vào `host_permissions` và
// tiêm lớp tài liệu bằng `chrome.scripting.executeScript`. Từ lúc ấy, Bảng chọn tiêm được vào
// **chính tab youtube.com và tab notebook.google.com** — nơi hai content script kia đã sống sẵn.
// Ba script gặp nhau trên một tab không còn là giả thuyết.
//
// Ba điều đọc lại từ tài liệu Chrome, không chép theo trí nhớ:
//   - "To respond asynchronously using `sendResponse()`, return a literal `true` … Doing so will
//     keep the message channel open" (Message Passing). Không trả `true` và không trả Promise =
//     **im lặng**, Chrome coi như listener này không nhận.
//   - "only the first listener to respond, reject, or throw an error will affect the sender; all
//     other listeners will run, but their results will be ignored" (Message Passing). Nên một
//     script trả lời `{ok:false}` cho ping của script kia là đủ giết cả đường đi sau đó.
//   - `executeScript` **không** nhận `matches` lẫn `excludeMatches` — chỉ `RegisteredContentScript`
//     của `registerContentScripts()` có `excludeMatches` (tài liệu `chrome.scripting`). Nên
//     `exclude_matches` trong manifest không chặn được đường tiêm; chốt chặn phải ở trong code.
//
// Dùng lại hai công cụ có sẵn, không dựng cái thứ ba: `helpers/extension.js` nạp cả chuỗi script
// vào một ngữ cảnh V8 sạch (đúng cách Chrome nạp vào tab), `helpers/service-worker.js` nạp service
// worker thật với một `chrome` giả có ghi sổ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/common/messages.js';
import { CHAINS, MANIFEST, loadChainInFreshContext } from './helpers/extension.js';
import {
  bootServiceWorker, DOCS_TAB, NOTEBOOK_TAB, YOUTUBE_TAB,
  DOCS_PAGE, NOTEBOOK_PAGE, YOUTUBE_PAGE, NOTEBOOK_ID,
} from './helpers/service-worker.js';

const S = globalThis.NBLM_SHARED;
const M = globalThis.NBLM_MESSAGES;

const ALL_TYPES = Object.values(M.TYPES);

// ------------------------------------------------------------------ bảng loại tin

test('định tuyến — mỗi loại tin thuộc về ĐÚNG MỘT listener', () => {
  // Hai nửa của cùng một ràng buộc, và cả hai đều là hỏng lặng:
  //   - 0 listener: thêm một loại tin mà quên khai `ACCEPTS` → `isFor` trả false ở mọi script,
  //     tin bay đi không ai nhận, người gửi chờ hết giờ;
  //   - 2 listener: hai script cùng nhận → Chrome lấy phản hồi đến trước, và cái đến trước
  //     đổi theo từng lượt.
  const owners = new Map(ALL_TYPES.map((type) => [type, []]));
  for (const [script, types] of Object.entries(M.ACCEPTS)) {
    for (const type of types) owners.get(type)?.push(script);
  }
  const problems = [...owners]
    .filter(([, list]) => list.length !== 1)
    .map(([type, list]) => `${type}: ${list.length === 0 ? 'không listener nào nhận' : `${list.length} listener cùng nhận (${list.join(', ')})`}`);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('định tuyến — mọi loại tin trong ACCEPTS là một loại tin có thật trong TYPES', () => {
  const known = new Set(ALL_TYPES);
  const unknown = Object.entries(M.ACCEPTS)
    .flatMap(([script, types]) => types.filter((type) => !known.has(type)).map((type) => `${script}: ${type}`));
  assert.deepEqual(unknown, [], `ACCEPTS khai loại tin không có trong TYPES:\n${unknown.join('\n')}`);
});

test('định tuyến — không hai loại tin nào dùng chung một chuỗi trên dây', () => {
  // Trên dây chỉ có chuỗi, không có tên hằng số. Hai hằng số cùng chuỗi nghĩa là hai listener
  // cùng nhận một tin thật, dù `ACCEPTS` trông vẫn rời nhau hoàn toàn.
  const byWire = new Map();
  for (const [name, wire] of Object.entries(M.TYPES)) {
    byWire.set(wire, [...(byWire.get(wire) || []), name]);
  }
  const clashes = [...byWire].filter(([, names]) => names.length > 1).map(([wire, names]) => `${wire} ← ${names.join(', ')}`);
  assert.deepEqual(clashes, [], clashes.join('\n'));
});

test('định tuyến — chuỗi trên dây của mỗi loại tin suy được từ tên hằng số của nó', () => {
  // Đây là mỏ neo duy nhất giữ hai chuỗi khỏi hoán vị cho nhau. Mọi chỗ khác trong repo nhắc tới
  // loại tin bằng **tên hằng**, nên đổi chỗ giá trị của `PING_DOCS` và `PING_YOUTUBE` giữ nguyên
  // mọi thứ nhất quán: script tài liệu vẫn nhận đúng `TYPES.PING_DOCS`, chỉ là trên dây nó nghe
  // ping của chuỗi YouTube. Không có luật đặt tên thì không test nào thấy được lần hoán vị ấy.
  const wrong = Object.entries(M.TYPES)
    .map(([name, wire]) => [name, wire, `${S.EXT_PREFIX}${name.toLowerCase().replace(/_/g, '-')}`])
    .filter(([, wire, expected]) => wire !== expected)
    .map(([name, wire, expected]) => `${name} = '${wire}', phải là '${expected}'`);
  assert.deepEqual(wrong, [], wrong.join('\n'));
});

// ------------------------------------------------------ listener thật trên tab thật

/**
 * Ba lớp content script, mỗi lớp gắn với **chuỗi nạp thật** của nó (tìm theo file, không theo
 * chỉ số), và với thứ mà ping của nó phải trả về.
 *
 * `field`/`value` là mỏ neo ngoài `ACCEPTS`: phản hồi phải mang danh tính của **chính tab đang
 * chạy**. Không có nó thì hoán vị `ACCEPTS.youtube` ↔ `ACCEPTS.notebooklm` vẫn cho một router
 * chạy được và nhất quán với chính nó — mỗi listener chỉ đơn giản nhận nhầm tập tin nhắn.
 */
const LAYERS = [
  {
    script: 'youtube',
    file: 'src/youtube/watch.js',
    href: YOUTUBE_PAGE,
    ping: M.TYPES.PING_YOUTUBE,
    field: 'ready',
    value: true,
  },
  {
    script: 'notebooklm',
    file: 'src/notebooklm/content.js',
    href: NOTEBOOK_PAGE,
    ping: M.TYPES.PING_NOTEBOOKLM,
    field: 'notebookId',
    value: NOTEBOOK_ID,
  },
  {
    script: 'docs',
    file: 'src/docs/content.js',
    href: DOCS_PAGE,
    ping: M.TYPES.PING_DOCS,
    field: 'page',
    value: S.docPageId(DOCS_PAGE),
  },
];

/** Listener duy nhất mà một chuỗi tự đăng ký khi được nạp vào một tab ở `href`. */
function listenerOf(layer) {
  const chain = CHAINS.find((entry) => entry.tab && entry.files.includes(layer.file));
  assert.ok(chain, `không còn chuỗi nạp nào mang ${layer.file}`);
  const { listeners } = loadChainInFreshContext(chain.files, { href: layer.href });
  assert.equal(listeners.length, 1, `${chain.name}: nạp xong có ${listeners.length} listener, cần đúng 1`);
  return listeners[0];
}

/**
 * Listener có **nhận** tin này không, theo đúng ranh giới của MV3: giữ kênh trả lời mở nghĩa là
 * trả về literal `true`, hoặc trả về một Promise. Mọi thứ khác — `false`, `undefined` — là im
 * lặng, và Chrome coi như listener này không có mặt.
 */
const claims = (returned) => returned === true || (returned != null && typeof returned.then === 'function');

/**
 * Gửi một tin vào listener và chờ **có giới hạn**.
 *
 * Giữ kênh mở rồi không bao giờ gọi `sendResponse` là một lỗi MV3 có thật — `return true` mà
 * quên đường trả lời. Chờ không giới hạn thì lỗi ấy treo cả suite thay vì làm một test đỏ, mà
 * `test/run.sh` không có đồng hồ nào cắt ngang.
 */
function respond(listener, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`giữ kênh mở cho ${message.type} rồi không bao giờ trả lời`)), 2000);
    const kept = listener(message, {}, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
    if (!claims(kept)) {
      clearTimeout(timer);
      reject(new Error(`im lặng với chính tin của mình (${message.type})`));
    }
  });
}

test('định tuyến — mỗi content script IM LẶNG với mọi tin không phải của mình', async () => {
  const problems = [];
  let foreignChecked = 0;
  for (const layer of LAYERS) {
    const listener = listenerOf(layer);
    for (const type of ALL_TYPES) {
      const mine = M.ACCEPTS[layer.script].includes(type);
      if (!mine) foreignChecked += 1;
      const returned = listener({ type }, {}, () => {});
      if (claims(returned) !== mine) {
        problems.push(`${layer.script}: ${type} → ${mine ? 'im lặng với tin CỦA MÌNH' : 'TRẢ LỜI tin của script khác'}`);
      }
    }
  }
  // Vế đối chứng: nếu không tin lạ nào được hỏi thì nửa quan trọng của test trên là rỗng tuếch.
  assert.ok(foreignChecked > 0, 'không hỏi tin lạ nào — test này đang đo một tập rỗng');
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('định tuyến — ping của mỗi lớp trả ok:true kèm danh tính của CHÍNH tab đang chạy', async () => {
  // Hai thứ cùng lúc, và cả hai đều nằm ngoài `ACCEPTS`:
  //   - `ok: true`: `waitForTab` chỉ tin `ok:true`, nên bỏ nó khỏi handler ping là tab không bao
  //     giờ được coi là sẵn sàng — mà triệu chứng là chờ 10 giây rồi báo một lỗi trỏ sai chỗ.
  //   - trường danh tính: nó buộc phản hồi phải đến **từ lớp sống trên tab ấy**. Hoán vị hai tập
  //     `ACCEPTS` cho nhau vẫn cho một router nhất quán; chỉ chỗ này thấy được.
  for (const layer of LAYERS) {
    const listener = listenerOf(layer);
    const answer = await respond(listener, { type: layer.ping });
    assert.equal(answer.ok, true, `${layer.script}: ping trả ${JSON.stringify(answer)}`);
    assert.equal(answer.result[layer.field], layer.value,
      `${layer.script}: ping trả ${JSON.stringify(answer.result)}, cần ${layer.field} = ${layer.value}`);
  }
});

// ------------------------------------------ bảng khai ↔ tập nhánh thật của router

/**
 * Mọi router trong repo, cùng một cách lái: một tin vào, một câu trả lời ra.
 *
 * Service worker nằm chung danh sách với ba content script chứ không đứng riêng, và đó là cả
 * điểm của test dưới đây: nó là listener **thứ tư**, nó cũng có bản khai `ACCEPTS`, và trước
 * ticket này nó là listener duy nhất không ai đối chiếu với bản khai của chính nó.
 */
const ROUTERS = [
  ...LAYERS.map((layer) => ({
    script: layer.script,
    ask: (type) => respond(listenerOf(layer), { type }),
  })),
  {
    script: 'background',
    // Một lượt khởi động cho mỗi loại tin: `IMPORT_DOCS` và `PICK_DOCS` ghi vào trạng thái sống
    // của service worker (`docsTabId`, `running`), nên dùng chung một lượt là để loại tin hỏi
    // sau chạy trên trạng thái mà loại tin hỏi trước để lại.
    ask: (type) => bootServiceWorker().send({ type }),
  },
];

test('định tuyến — loại tin đã KHAI NHẬN mà router không có nhánh nào cho nó là một lỗi, không phải một câu trả lời', async () => {
  // Phép phá bắt được: thêm một loại tin, khai đủ vào `ACCEPTS` (đúng một listener, không trùng
  // chuỗi), rồi **quên viết nhánh**. Mọi test hình dạng vẫn xanh — bảng khai hoàn toàn hợp lệ.
  // Thứ hỏng là **quan hệ** giữa bảng khai và tập nhánh thật, và nó hỏng im lặng: `isFor` trả
  // true, tin rơi xuống nhánh cuối của router, và nhánh cuối luôn là việc thật của loại tin
  // khác. Người gọi nhận `ok: true` cho một việc chưa bao giờ chạy.
  //
  // `ACCEPTS.background` ↔ tập nhánh của service worker đã hở đúng như vậy: `GET_STATE` từng là
  // nhánh "còn lại", nên mọi loại tin quên nhánh đều trả về trạng thái popup kèm `ok: true`.
  const problems = [];
  let checked = 0;
  for (const router of ROUTERS) {
    for (const type of M.ACCEPTS[router.script]) {
      checked += 1;
      const answer = await router.ask(type);
      // Nhánh chạy rồi hỏng vẫn là có nhánh — chỉ mốc `UNROUTED` mới là "không ai xử lý".
      if (String((answer && answer.error) || '').includes(M.UNROUTED)) {
        problems.push(`${router.script}: ${type} → ${answer.error}`);
      }
    }
  }
  assert.equal(checked, ALL_TYPES.length, 'mỗi loại tin phải được lái qua đúng router đã khai nhận nó');
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('định tuyến — mốc UNROUTED mà test trên dò đúng là mốc các router ném ra', () => {
  // Vế đối chứng. Nếu `UNROUTED` và câu mà `unrouted()` dựng lệch nhau thì test trên không bao
  // giờ đỏ được — nó sẽ dò một chuỗi không xuất hiện ở đâu cả, và im lặng đúng như thứ nó canh.
  assert.ok(M.UNROUTED.length > 0);
  assert.match(M.unrouted('background', { type: M.TYPES.GET_STATE }).message, new RegExp(M.UNROUTED));
  assert.match(M.unrouted('background', { type: M.TYPES.GET_STATE }).message, /background/);
});

// ------------------------------------------------------------------ service worker

test('định tuyến — service worker im lặng với mọi tin của tab, và nhận mọi tin của mình', async () => {
  const sw = bootServiceWorker();
  const problems = [];
  for (const type of ALL_TYPES) {
    const mine = M.ACCEPTS.background.includes(type);
    const returned = sw.listener({ type }, {}, () => {});
    if (claims(returned) !== mine) {
      problems.push(`background: ${type} → ${mine ? 'im lặng với tin CỦA MÌNH' : 'TRẢ LỜI tin của content script'}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

// ------------------------------------------------------- đường tiêm Bảng chọn

const injected = (sw) => [...sw.touched(['scripting.files'])];

test('đường tiêm — Bảng chọn tiêm được vào một trang tài liệu thật', async () => {
  // Vế đối chứng của hai test dưới: nếu Bảng chọn từ chối mọi trang thì "từ chối youtube.com"
  // đúng vì một lý do chẳng liên quan gì.
  const sw = bootServiceWorker({ activeTab: DOCS_TAB });
  const answer = await sw.send({ type: M.TYPES.PICK_DOCS });
  assert.equal(answer.ok, true, answer.error);
  assert.deepEqual(injected(sw), [DOCS_TAB]);
});

for (const [name, tabId, page] of [['youtube.com', YOUTUBE_TAB, YOUTUBE_PAGE], ['NotebookLM', NOTEBOOK_TAB, NOTEBOOK_PAGE]]) {
  test(`đường tiêm — Bảng chọn TỪ CHỐI chạy trên tab ${name}, và không tiêm gì cả`, async () => {
    const sw = bootServiceWorker({ activeTab: tabId });
    // Tab id và URL là hai thứ cùng kiểu đi cặp với nhau; neo chúng lại thì một lần ghép nhầm
    // không lặng lẽ biến test này thành hai lượt kiểm cùng một tab.
    assert.equal(sw.tabs.get(tabId).url, page);
    const answer = await sw.send({ type: M.TYPES.PICK_DOCS });

    // Khẳng định thật nằm ở đây, không ở `ok: false`. Bỏ chốt chặn đi thì lượt tiêm vẫn có thể
    // hỏng vì một lý do khác rồi trả về `{ok:false}` — và test sẽ xanh về một lần chặn chưa bao
    // giờ xảy ra. Thứ duy nhất chứng minh chốt chặn có tác dụng là **sổ ghi rỗng**.
    assert.deepEqual(injected(sw), [],
      `đã tiêm lớp tài liệu vào tab ${name} — nơi một content script khác đang sống`);
    assert.deepEqual([...sw.messaged(M.TYPES.PING_DOCS, M.TYPES.OPEN_DOC_PICKER)], []);
    assert.equal(answer.ok, false, `Bảng chọn mở được trên ${page}`);
    assert.match(answer.error, /content script/i, answer.error);
  });
}

test('đường tiêm — chốt chặn đọc đúng tập host của content_scripts, không một danh sách thứ hai', () => {
  // `exclude_matches` không chi phối `executeScript`, nên chốt chặn nằm trong code — và code ấy
  // phải hỏi đúng tập host mà manifest khai. Hai danh sách là hai câu trả lời cho cùng một tab.
  // Đọc thẳng `content_scripts` chứ không lọc `CHAINS`: một entry mất khoá `matches` phải làm
  // test này đỏ, không phải làm nó bỏ qua entry ấy rồi vẫn xanh.
  for (const [index, entry] of MANIFEST.content_scripts.entries()) {
    assert.ok(Array.isArray(entry.matches) && entry.matches.length > 0,
      `content_scripts[${index}] không khai matches — Chrome không nạp nó ở đâu cả`);
    for (const pattern of entry.matches) {
      assert.ok(S.CONTENT_SCRIPT_MATCH_PATTERNS.includes(pattern),
        `content_scripts[${index}]: Chrome nạp content script trên ${pattern} mà chốt chặn không biết tới mẫu này`);
    }
  }
  assert.equal(S.hasOwnContentScript(DOCS_PAGE), false, 'chốt chặn khoá luôn cả trang tài liệu');
});

// ------------------------------------------------- chỉ tin ok:true, không tin "có trả lời"

test('đường tiêm — tab trả lời ping mà thiếu ok:true thì KHÔNG được coi là sẵn sàng', async () => {
  // "Có phản hồi" và "sẵn sàng" là hai chuyện. Một tab vừa bị tiêm nửa chừng vẫn trả lời được,
  // và nếu `waitForTab` tin "có trả lời" thì lượt trích sau đó chạy trên một lớp chưa nạp xong.
  const sw = bootServiceWorker({
    activeTab: DOCS_TAB,
    answer: (_layer, tab, message) => (M.typeOf(message) === M.TYPES.PING_DOCS
      ? { result: { page: S.docPageId(tab.url) } } // đúng nội dung, thiếu đúng `ok`
      : undefined),
  });
  const answer = await sw.send({ type: M.TYPES.PICK_DOCS });

  assert.equal(answer.ok, false, 'nhận một tab chưa sẵn sàng là sẵn sàng');
  assert.match(answer.error, /không phản hồi/, answer.error);
  // Và nó phải **thử lại** chứ không bỏ cuộc sau một lượt: bỏ cuộc ngay là một chốt chặn khác
  // hẳn, và nó sẽ đánh rớt mọi tab chỉ đơn giản là nạp hơi chậm.
  const pings = sw.log.filter((row) => row.type === M.TYPES.PING_DOCS).length;
  assert.ok(pings > 1, `chỉ hỏi ${pings} lượt rồi bỏ cuộc`);
  // Không lượt nào đi tiếp sang việc thật.
  assert.deepEqual([...sw.messaged(M.TYPES.OPEN_DOC_PICKER)], []);
});
