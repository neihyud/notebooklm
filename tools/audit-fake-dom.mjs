#!/usr/bin/env node
//
// Ticket 016 — chạy CÙNG MỘT bộ phép thử trên hai cây và báo mọi chỗ hai bên trả lời khác nhau:
//
//   • `test/helpers/fake-dom.js` trong Node
//   • DOM thật của Chromium, qua CDP
//
// Vì sao nói chuyện thẳng với Chrome bằng CDP thay vì qua Playwright: repo này **không có
// dependency nào và cố ý giữ như vậy** (`test/helpers/fake-dom.js` mở đầu bằng đúng câu đó).
// Một công cụ dùng để kiểm lại thước đo mà lại chỉ chạy được khi cache npx còn nguyên thì lần
// sau không ai chạy lại được. Node 22 có sẵn `WebSocket` toàn cục, nên cả lớp lái này gói gọn
// trong file này.
//
//   node tools/audit-fake-dom.mjs [--chrome <đường dẫn>] [--all]
//
// `--all` in cả những phép hai bên trả lời giống nhau (mặc định chỉ in chỗ lệch).
// Thoát 1 khi còn chỗ lệch **chưa được đánh dấu cố ý** — để chạy được trong CI về sau.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROBES, browserScript, compare, runFake } from './fake-dom-probes.mjs';

const CHROME_CACHE = join(process.env.HOME || '', '.cache', 'ms-playwright');

/** Bản Chromium mà Playwright đã tải sẵn. Không tải gì, không chạm mạng. */
function findChrome(explicit) {
  if (explicit) return explicit;
  if (process.env.CHROME) return process.env.CHROME;
  if (!existsSync(CHROME_CACHE)) return null;
  const revision = (dir) => Number((dir.match(/(\d+)$/) || [0, 0])[1]);
  const dirs = readdirSync(CHROME_CACHE)
    .filter((d) => d.startsWith('chromium'))
    // So theo **số**: `sort()` chuỗi xếp `chromium-999` sau `chromium-1234`, nên bản mới nhất
    // lại là bản bị bỏ qua, và cả lượt đo chạy trên một Chromium cũ mà không ai biết.
    .sort((a, b) => revision(b) - revision(a));
  for (const dir of dirs) {
    for (const rel of [['chrome-linux64', 'chrome'], ['chrome-linux', 'chrome'],
      ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]) {
      const bin = join(CHROME_CACHE, dir, ...rel);
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

/** Một phiên CDP tối giản: mở trình duyệt, mở một tab, `Runtime.evaluate`, đóng. */
async function withBrowser(bin, fn) {
  const profile = mkdtempSync(join(tmpdir(), 'audit-fake-dom-'));
  const child = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let socket = null;
  let shutdown = null;
  // `try` bắt đầu ngay sau `spawn`, không phải sau khi nối được: Chrome khởi động mà không bao
  // giờ báo cổng DevTools vẫn phải bị giết. Không thế thì mỗi lượt chạy hỏng để lại một Chrome
  // headless mồ côi.
  try {
    const endpoint = await devtoolsEndpoint(child);
    socket = await openSocket(endpoint);
    const open = await session(socket, child);
    shutdown = open.shutdown;
    return await fn(open);
  } finally {
    // `Browser.close` chứ không chỉ `child.kill()`: SIGTERM chỉ với tới tiến trình trình duyệt,
    // còn đám zygote/renderer của nó vẫn đang ghi vào profile — nên `rmSync` ngay sau đó luôn là
    // `ENOTEMPTY` và mỗi lượt chạy bỏ lại một thư mục tạm trong /tmp. Đo thật: 11 thư mục sau
    // 11 lượt.
    if (shutdown) await shutdown().catch(() => {});
    if (socket) socket.close();
    child.kill();
    await new Promise((resolve) => (child.exitCode === null ? child.once('exit', resolve) : resolve()));
    await removeProfile(profile);
  }
}

/**
 * Xoá thư mục profile, thử lại vài nhịp.
 *
 * `maxRetries` của `rmSync` không cứu được ca này (đo: vẫn `ENOTEMPTY` ngay lượt đầu), vì đám
 * tiến trình con của Chrome còn ghi nốt vài chục mili-giây sau khi tiến trình chính đã thoát.
 * Đo thật: 1–2 lượt, ≤54ms. **Cảnh báo chứ không ném** nếu vẫn không xoá được — một thư mục tạm
 * sót lại không đáng làm hỏng cả lượt đo, nhưng im lặng nuốt lỗi thì lần sau không ai biết /tmp
 * đang đầy dần.
 */
async function removeProfile(profile) {
  for (let tries = 1; ; tries += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      if (tries >= 20) {
        console.error(`audit-fake-dom: không xoá được ${profile} (${error.code}) — dọn tay giúp.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/** Chrome in `ws://…` ra stderr khi `--remote-debugging-port=0` đã chọn được cổng. */
function devtoolsEndpoint(child) {
  let stderr = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome không báo cổng DevTools sau 20s:\n${stderr}`)), 20000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    // Đường dẫn trỏ vào một chương trình không phải Chrome thì nó thoát ngay; không bắt lấy
    // điều đó là bắt người chạy ngồi chờ đủ 20 giây mới biết mình gõ sai `--chrome`.
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome thoát ngay (mã ${code}) — đường dẫn có phải nhị phân Chrome không?\n${stderr}`));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/ws:\/\/\S+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
}

function openSocket(endpoint) {
  const socket = new WebSocket(endpoint);
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('không mở được WebSocket tới Chrome')), { once: true });
  });
}

/** Một tab đã gắn phiên, sẵn sàng `evaluate`. */
async function session(socket, child) {
  let nextId = 0;
  const pending = new Map();
  const failAll = (reason) => {
    for (const { reject } of pending.values()) reject(new Error(reason));
    pending.clear();
  };
  // Không có hai dòng này thì Chrome chết giữa chừng = `send()` treo vĩnh viễn, và một công cụ
  // dựng để chạy lại thường xuyên lại hỏng theo kiểu không có thông báo nào.
  socket.addEventListener('close', () => failAll('Chrome đóng kết nối DevTools giữa chừng'));
  child.on('exit', (code) => failAll(`Chrome thoát giữa chừng (mã ${code})`));

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const settle = pending.get(message.id);
    if (!settle) return;
    pending.delete(message.id);
    if (message.error) settle.reject(new Error(`CDP ${message.error.message}`));
    else settle.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const id = attached.sessionId;
  // Một tài liệu HTML chuẩn (không quirks mode): khớp selector class phân biệt hoa thường ở đây.
  // `browserScript()` chốt lại `document.compatMode` một lần nữa trong chính trang, để một lượt
  // điều hướng chưa kịp xong không lặng lẽ biến kết quả selector thành vô nghĩa.
  await send('Page.enable', {}, id);
  await send('Page.navigate', { url: 'data:text/html,<!DOCTYPE html><html><body></body></html>' }, id);

  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, id);
    if (reply.exceptionDetails) {
      const text = reply.exceptionDetails.exception
        ? reply.exceptionDetails.exception.description : reply.exceptionDetails.text;
      throw new Error(`lỗi trong trình duyệt: ${text}`);
    }
    return reply.result.value;
  };

  // `Browser.getVersion` chứ không phải `navigator.userAgent`: userAgent làm tròn thành
  // `151.0.0.0`, mà bằng chứng của ticket này cần đúng số build đã chạy.
  const { product, revision } = await send('Browser.getVersion');
  return { evaluate, version: `${product} (revision ${revision})`, shutdown: () => send('Browser.close') };
}

function parseArgs(argv) {
  const out = { chrome: null, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--all') out.all = true;
    else if (argv[i] === '--chrome') { out.chrome = argv[i + 1]; i += 1; }
    else throw new Error(`tham số không hiểu: ${argv[i]}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bin = findChrome(args.chrome);
  if (!bin) {
    console.error('audit-fake-dom: không tìm thấy Chromium. Chỉ ra bằng --chrome <đường dẫn> hoặc CHROME=<đường dẫn>.');
    process.exit(2);
  }

  const fakeResults = new Map(PROBES.map((probe) => [probe.id, runFake(probe)]));

  const { realResults, version } = await withBrowser(bin, async ({ evaluate, version: ua }) => {
    const raw = await evaluate(browserScript());
    return { realResults: new Map(JSON.parse(raw).map((r) => [r.id, r.result])), version: ua };
  });

  console.log('# Đối chiếu cây giả với DOM thật (ticket 016)');
  console.log(`# Chromium : ${version}`);
  console.log(`# nhị phân : ${bin}`);
  console.log(`# Node     : ${process.version}`);
  console.log(`# phép thử : ${PROBES.length}`);
  console.log('');

  const rows = PROBES.map((probe) => {
    const fake = fakeResults.get(probe.id);
    const real = realResults.has(probe.id) ? realResults.get(probe.id) : 'THIẾU KẾT QUẢ';
    return { probe, fake, real, status: realResults.has(probe.id) ? compare(fake, real) : 'diff' };
  });

  const diffs = rows.filter((r) => r.status === 'diff' && !r.probe.accepted);
  const accepted = rows.filter((r) => r.status === 'diff' && r.probe.accepted);
  const bothThrew = rows.filter((r) => r.status === 'both-threw');

  for (const row of args.all ? rows : diffs.concat(accepted, bothThrew)) {
    const mark = row.status === 'same' ? '  giống'
      : row.status === 'both-threw' ? 'cả hai ném'
        : row.probe.accepted ? 'lệch-cố-ý' : 'LỆCH  ';
    console.log(`${mark}  ${row.probe.id}`);
    if (row.status === 'same' && !args.all) continue;
    if (row.status !== 'same') {
      console.log(`         giả  : ${row.fake}`);
      console.log(`         thật : ${row.real}`);
      console.log(`         dựa vào: ${row.probe.why}`);
      if (row.probe.accepted) console.log(`         chấp nhận: ${row.probe.accepted}`);
    }
    console.log('');
  }

  const byGroup = new Map();
  for (const row of diffs) byGroup.set(row.probe.group, (byGroup.get(row.probe.group) || 0) + 1);

  console.log('-'.repeat(72));
  console.log(`Đã chạy ${PROBES.length} phép thử trên cả hai cây.`);
  console.log(`  giống nhau       : ${rows.filter((r) => r.status === 'same').length}`);
  console.log(`  cả hai cùng ném  : ${bothThrew.length}`);
  console.log(`  lệch nhưng cố ý  : ${accepted.length}  (cây giả thiếu, và thiếu một cách ồn ào)`);
  console.log(`  LỆCH             : ${diffs.length}`
    + (diffs.length ? `  (${[...byGroup].map(([g, n]) => `${g}:${n}`).join(', ')})` : ''));
  process.exit(diffs.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`audit-fake-dom: ${error && error.stack ? error.stack : error}`);
  process.exit(2);
});
