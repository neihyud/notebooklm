// Ticket 010 — lớp `chrome.*` của service worker cho nhánh tài liệu.
//
// File này tồn tại vì một hoán vị lọt qua cả suite: đổi vai `docsTabId` ↔ `hiddenTabId` trong
// `readHiddenTab` và trong nhánh `DOC_TAB_GO`. Hai số nguyên cùng kiểu, cả hai đều là tab id
// hợp lệ, cả hai đều đang mở đúng trang tài liệu — nên **mọi lời gọi `chrome.*` đều thành
// công**, không ngoại lệ nào, không badge lỗi nào, 614 test vẫn xanh. Hành vi thật sau hoán vị
// là nấc 2 lái tab người dùng đang đọc đi qua 80 trang, còn `hiddenTabId` thành code chết.
//
// Không hình dạng nào bắt được nó: cả hai vai đều là `number`, và cả hai đường đi đều chạy
// trót lọt. Chỉ **quan hệ** giữa hai tập tab id nói ra được — tab của Bảng chọn và tab của
// nấc 2 phải rời nhau, và đó là điều duy nhất mọi test dưới đây khẳng định.
//
// Cách chạy nằm ở `helpers/service-worker.js`: nạp đúng chuỗi `importScripts` của service worker
// vào một ngữ cảnh V8 sạch với một `chrome` giả có ghi sổ, rồi lái nó qua chính listener mà nó tự
// đăng ký. Không hàm nào của service worker được gọi thẳng — gọi thẳng là bỏ qua đúng phần dây
// nối đang cần kiểm. File này giữ phần **hai vai tab rời nhau**; phần kỷ luật định tuyến và chốt
// chặn đường tiêm ở `test/routing.test.js`, trên cùng harness ấy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/common/shared.js';
import '../src/common/messages.js';
import '../src/notebooklm/rpc.js';
// `chrome` giả có ghi sổ + service worker thật trong ngữ cảnh V8 sạch: `helpers/service-worker.js`.
// Ticket 011 tách nó ra để `test/routing.test.js` lái đúng listener ấy thay vì dựng bản sao thứ hai.
import {
  bootServiceWorker, SITE, DOCS_PAGE, NOTEBOOK_ID, DOCS_TAB, NOTEBOOK_TAB,
} from './helpers/service-worker.js';

const M = globalThis.NBLM_MESSAGES;
const R = globalThis.NBLM_RPC;

/**
 * Trang tài liệu **quá lớn để đi đường RPC** — cách duy nhất còn lại để một lượt đẩy chạm tới
 * tab NotebookLM sau ADR 0012.
 *
 * Từ ticket 015, đường chính là `batchexecute` từ chính service worker: nó không mở tab nào, nên
 * một lượt import bình thường chỉ chạm **hai** tab. Vai thứ ba chỉ xuất hiện ở đường lui, và
 * ràng buộc 4 của ADR 0012 là chỗ duy nhất bắt buộc rơi về đó — service worker của MV3 bị Chrome
 * giết khi một `fetch()` mất hơn 30 giây, nên Nguồn quá lớn **không được thử gửi**.
 */
const hugeDoc = (layer, tab, message) => {
  if (layer !== 'docs' || M.typeOf(message) !== M.TYPES.EXTRACT_DOC) return undefined;
  const markdown = `## Một trang rất dài\n\n${'chữ '.repeat(R.MAX_BODY_CHARS / 2)}`;
  return {
    ok: true,
    result: { url: message.url, title: 'Một trang rất dài', markdown, chars: markdown.length, via: 'fetch', escalated: false },
  };
};

/**
 * Hai tập tab id của hai vai.
 *
 * **Bảng chọn**: tab người dùng đang đọc — nơi được tiêm lớp tài liệu và nơi mọi tin của Bảng
 * chọn/khâu trích đi tới. **Nấc 2**: tab ẩn — nơi bị lái đi, bị chụp ảnh, rồi bị đóng.
 * Cả hai đều là tab đang mở trang tài liệu; điều duy nhất phân biệt chúng là vai.
 */
const picker = (sw) => new Set([
  ...sw.touched(['scripting.files']),
  ...sw.messaged(M.TYPES.PING_DOCS, M.TYPES.OPEN_DOC_PICKER, M.TYPES.EXTRACT_DOC),
]);
const tier2 = (sw) => sw.touched(['scripting.func', 'tabs.update', 'tabs.remove']);

const intersect = (left, right) => [...left].filter((id) => right.has(id));

// ------------------------------------------------------------------ hai vai rời nhau

test('nấc 2 KHÔNG BAO GIỜ chạm tab mà Bảng chọn đang mở — hai vai, hai tab', async () => {
  const sw = bootServiceWorker();
  await sw.send({ type: M.TYPES.PICK_DOCS });
  await sw.send({ type: M.TYPES.DOC_TAB_READ });
  await sw.send({ type: M.TYPES.DOC_TAB_GO, url: `${SITE}/guide/nang-cao` });
  await sw.send({ type: M.TYPES.DOC_TAB_READ });

  const opened = picker(sw);
  const driven = tier2(sw);
  assert.ok(opened.has(DOCS_TAB), `Bảng chọn phải mở ở tab ${DOCS_TAB}, thấy ${[...opened]}`);
  assert.ok(driven.size > 0, 'nấc 2 chưa chạm tab nào — test này đang đo một tập rỗng');
  assert.deepEqual(
    intersect(driven, opened),
    [],
    `nấc 2 lái đúng tab người dùng đang đọc: ${[...driven]} ∩ ${[...opened]}`,
  );
});

test('nấc 2 — tab ẩn là tab do service worker MỞ RA, mở sẵn ở trang người dùng đang đọc', async () => {
  const sw = bootServiceWorker();
  await sw.send({ type: M.TYPES.PICK_DOCS });
  const shot = await sw.send({ type: M.TYPES.DOC_TAB_READ });

  // Ảnh chụp phải **về tới nơi**. `readHiddenTab` nuốt mọi lỗi vào một vòng thử lại 40 lượt rồi
  // mới bỏ cuộc, nên một đường chụp hỏng vẫn để lại đủ dấu vết trong sổ cho mọi khẳng định
  // "tab nào chạm tab nào" bên dưới đúng — chỉ là đúng về một lượt đọc chưa bao giờ thành công.
  assert.equal(shot.ok, true, shot.error);
  assert.equal(shot.result.url, DOCS_PAGE);
  assert.match(shot.result.html, /<html>/);

  const created = sw.log.filter((row) => row.api === 'tabs.create');
  assert.equal(created.length, 1, 'nấc 2 phải mở đúng một tab của riêng nó');
  assert.equal(created[0].active, false, 'tab ẩn mà kích hoạt thì nó cướp màn hình của người dùng');
  // Không `about:blank`: `executeScript` không vào được trang đó, nên lượt `read()` đầu tiên
  // hỏng và mốc "trang cũ" của nấc 2 thành rỗng — cổng chờ mở sớm ở đúng những trang docsify
  // mà nấc 2 sinh ra để cứu.
  assert.equal(created[0].url, DOCS_PAGE);
  assert.equal(tier2(sw).has(created[0].tabId), true);
});

test('nấc 2 — hai lượt đọc dùng LẠI một tab ẩn, không mở một tab cho mỗi trang', async () => {
  const sw = bootServiceWorker();
  await sw.send({ type: M.TYPES.PICK_DOCS });
  for (let i = 0; i < 3; i += 1) {
    await sw.send({ type: M.TYPES.DOC_TAB_GO, url: `${SITE}/guide/t${i}` });
    await sw.send({ type: M.TYPES.DOC_TAB_READ });
  }
  assert.equal(sw.log.filter((row) => row.api === 'tabs.create').length, 1);
  assert.equal(tier2(sw).size, 1, `nấc 2 rải qua nhiều tab: ${[...tier2(sw)]}`);

  // Tab ẩn phải đi tới **trang được yêu cầu**, không về trang chủ của bộ docs. `message.url` và
  // `docsHome` là hai chuỗi cùng kiểu, cùng site, cùng mở được — đổi vai thì nấc 2 đọc đúng một
  // trang ba lần và ba Mục mang ba tên khác nhau cùng một nội dung.
  assert.deepEqual(
    sw.log.filter((row) => row.api === 'tabs.update').map((row) => row.url),
    [`${SITE}/guide/t0`, `${SITE}/guide/t1`, `${SITE}/guide/t2`],
  );
});

// ------------------------------------------------------------------ dọn dẹp

test('hết lượt chạy thì đóng tab ẩn — và KHÔNG đóng tab người dùng đang đọc', async () => {
  const sw = bootServiceWorker();
  await sw.send({ type: M.TYPES.PICK_DOCS });
  await sw.send({ type: M.TYPES.DOC_TAB_READ });

  const answer = await sw.send({
    type: M.TYPES.IMPORT_DOCS,
    page: DOCS_PAGE,
    pages: [
      { url: `${SITE}/guide/cai-dat`, title: 'Cài đặt', branch: 'Hướng dẫn' },
      { url: `${SITE}/guide/cau-hinh`, title: 'Cấu hình', branch: 'Hướng dẫn' },
    ],
  }, { tab: { id: DOCS_TAB, url: DOCS_PAGE } });

  assert.equal(answer.ok, true, answer.error);
  assert.match(answer.result.summary, /docs\.acme\.dev — Hướng dẫn/);

  const removed = sw.log.filter((row) => row.api === 'tabs.remove').map((row) => row.tabId);
  assert.equal(removed.length, 1, `đóng ${removed.length} tab: ${removed}`);
  assert.equal(removed.includes(DOCS_TAB), false, 'vừa đóng mất tab người dùng đang đọc');
  assert.equal(sw.tabs.has(DOCS_TAB), true);

  // Khâu trích đi qua tab Bảng chọn, không qua tab ẩn: tab ẩn không có content script nào cả.
  assert.deepEqual([...sw.messaged(M.TYPES.EXTRACT_DOC)], [DOCS_TAB]);
});

test('một lượt import chạm ba tab, và ba vai không lẫn vào nhau', async () => {
  // Vế đối chứng của test đầu: một lượt chạy thật chạm **nhiều** tab, nên "rời nhau" không
  // phải là điều tự nhiên đúng vì chỉ có một tab trong cuộc. Nguồn ở đây cố ý vượt trần của
  // đường RPC để lượt đẩy rơi về đường lui — xem `hugeDoc`.
  const sw = bootServiceWorker({ answer: hugeDoc });
  await sw.send({ type: M.TYPES.PICK_DOCS });
  await sw.send({
    type: M.TYPES.IMPORT_DOCS,
    page: DOCS_PAGE,
    pages: [{ url: `${SITE}/guide/cai-dat`, title: 'Cài đặt', branch: 'Hướng dẫn' }],
  }, { tab: { id: DOCS_TAB, url: DOCS_PAGE } });
  await sw.send({ type: M.TYPES.DOC_TAB_READ });

  const notebook = sw.messaged(M.TYPES.PUSH_SOURCE);
  assert.deepEqual([...notebook], [NOTEBOOK_TAB]);
  assert.equal(intersect(notebook, picker(sw)).length, 0, 'đẩy Nguồn qua chính tab tài liệu');
  assert.equal(intersect(notebook, tier2(sw)).length, 0, 'đẩy Nguồn qua tab ẩn');
  assert.equal(intersect(tier2(sw), picker(sw)).length, 0);
  assert.equal(new Set([...picker(sw), ...tier2(sw), ...notebook]).size, 3, 'ba vai phải là ba tab');
});
