// Lái một Chrome thật **có nạp chính extension này** — khung dùng chung của `verify-live.mjs`,
// `verify-docs.mjs` và `probe-sidebar.mjs` (ticket 012).
//
// Vì sao nói chuyện thẳng với Chrome bằng CDP thay vì qua Playwright, dù ticket viết theo API
// của Playwright (`launchPersistentContext`, `context.serviceWorkers()`): **repo này không có
// dependency nào và cố ý giữ như vậy** — `test/helpers/fake-dom.js` mở đầu bằng đúng câu đó, và
// `tools/audit-fake-dom.mjs` (ticket 016) đã chọn cùng đường vì cùng lý do. Máy này có sẵn nhị
// phân Chrome for Testing mà Playwright tải về, *không* có gói `playwright` (`npm ls -g` không
// liệt kê nó, `require.resolve('playwright')` ném MODULE_NOT_FOUND). Cài thêm một dependency chỉ
// để gọi ba API là đổi một ràng buộc kiến trúc của repo trong một ticket kiểm chứng.
//
// Từng thứ của Playwright được thay bằng gì, không bỏ cái nào:
//   • `launchPersistentContext(userDataDir, …)` → `--user-data-dir=<thư mục tạm>`. Đó chính là
//     thứ "persistent context" nghĩa là, và là điều kiện để MV3 chạy: một profile thật.
//   • `--disable-extensions-except` / `--load-extension` → truyền thẳng, cùng giá trị.
//   • `context.serviceWorkers()` → `Target.getTargets` lọc `type === 'service_worker'`, đúng
//     nguồn dữ liệu mà Playwright đọc.
//
// Khuôn đóng trình duyệt chép từ `tools/audit-fake-dom.mjs`: `Browser.close` trước, rồi mới
// `kill` rồi mới `rmSync`. Ticket 016 đo được 11 thư mục `/tmp` sót lại sau 11 lượt khi làm sai
// thứ tự ấy.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_CACHE = join(process.env.HOME || '', '.cache', 'ms-playwright');

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bản Chromium mà Playwright đã tải sẵn. Không tải gì, không chạm mạng. Cùng phép dò với ticket 016. */
/**
 * Nhận ra service worker của **chính extension này** giữa đám worker Chrome tự nạp.
 *
 * Chrome khởi động vài component extension của riêng nó (Web Store, hangout services) và worker
 * của chúng cũng là `type: 'service_worker'`. Đường dẫn khai trong `manifest.json` là thứ duy
 * nhất phân biệt được — nên nó ở đây một lần, chứ không chép làm hai bản trong hai script.
 */
export const OWN_WORKER_PATH = '/src/background/service-worker.js';

/** Vị từ dùng cho cả `serviceWorkers({ match })` lẫn phép lọc danh sách trả về. */
export const isOwnWorker = (target) => String((target && target.url) || '').endsWith(OWN_WORKER_PATH);

export function findChrome(explicit) {
  if (explicit) return explicit;
  if (process.env.CHROME) return process.env.CHROME;
  if (!existsSync(CHROME_CACHE)) return null;
  // So theo **số**: `sort()` chuỗi xếp `chromium-999` sau `chromium-1234`, nên bản mới nhất lại
  // là bản bị bỏ qua, và cả lượt đo chạy trên một Chromium cũ mà không ai biết.
  const revision = (dir) => Number((dir.match(/(\d+)$/) || [0, 0])[1]);
  const dirs = readdirSync(CHROME_CACHE)
    .filter((d) => d.startsWith('chromium-'))
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

/** Nguồn của extension, ghép theo đúng thứ tự `manifest.json` nạp chúng. */
export function readSources(files) {
  return files.map((rel) => `// ==== ${rel} ====\n${readFileSync(join(REPO_ROOT, rel), 'utf8')}`).join('\n');
}

// ------------------------------------------------------------------ phiên CDP

function devtoolsEndpoint(child) {
  let stderr = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome không báo cổng DevTools sau 30s:\n${stderr}`)), 30000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    // Đường dẫn trỏ vào một chương trình không phải Chrome thì nó thoát ngay; không bắt lấy điều
    // đó là bắt người chạy ngồi chờ đủ 30 giây mới biết mình gõ sai `--chrome`.
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

/**
 * Lớp gửi/nhận CDP: một `send()` có `sessionId`, và một sổ đăng ký sự kiện theo phiên.
 *
 * Không có hai dòng `failAll` thì Chrome chết giữa chừng = mọi `send()` treo vĩnh viễn, và một
 * công cụ dựng để chạy lại thường xuyên lại hỏng theo kiểu không có thông báo nào.
 */
function connection(socket, child) {
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  const failAll = (reason) => {
    for (const { reject } of pending.values()) reject(new Error(reason));
    pending.clear();
  };
  socket.addEventListener('close', () => failAll('Chrome đóng kết nối DevTools giữa chừng'));
  child.on('exit', (code) => failAll(`Chrome thoát giữa chừng (mã ${code})`));

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      for (const listener of listeners) listener(message);
      return;
    }
    const settle = pending.get(message.id);
    if (!settle) return;
    pending.delete(message.id);
    if (message.error) settle.reject(new Error(`CDP ${message.method || ''} ${message.error.message}`));
    else settle.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = (nextId += 1);
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

  return { send, on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Xoá thư mục profile, thử lại vài nhịp — chép nguyên từ `tools/audit-fake-dom.mjs`.
 *
 * `maxRetries` của `rmSync` không cứu được ca này: đám tiến trình con của Chrome còn ghi nốt vài
 * chục mili-giây sau khi tiến trình chính đã thoát. **Cảnh báo chứ không ném** nếu vẫn không xoá
 * được — một thư mục tạm sót lại không đáng làm hỏng cả lượt đo, nhưng im lặng nuốt lỗi thì lần
 * sau không ai biết /tmp đang đầy dần.
 */
async function removeProfile(profile) {
  for (let tries = 1; ; tries += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      if (tries >= 20) {
        console.error(`live-browser: không xoá được ${profile} (${error.code}) — dọn tay giúp.`);
        return;
      }
      await wait(50);
    }
  }
}

// ------------------------------------------------------------------ một tab

/**
 * Một tab đã gắn phiên.
 *
 * `goto` chờ `Page.loadEventFired` **và** một nhịp lặng, vì mọi trang trong ticket này là SPA
 * (YouTube, Docusaurus, VitePress): `load` bắn khi khung đã xong, còn nội dung thì tới sau.
 */
function pageHandle(conn, sessionId, targetId) {
  const send = (method, params) => conn.send(method, params, sessionId);

  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const reply = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      // Cho biểu thức chạy như đang có thao tác người dùng. Cần vì phép đo bấm đúng nút
      // Transcript của YouTube, và một phần hành vi của trang chỉ mở ra khi có kích hoạt tạm
      // thời. (Chuyện `let`/`const` ở tầng ngoài cùng không giẫm chân nhau qua nhiều lượt nạp
      // là do mỗi `Runtime.evaluate` là một script riêng, không liên quan tới cờ này.)
      userGesture: true,
    });
    if (reply.exceptionDetails) {
      const detail = reply.exceptionDetails;
      const text = detail.exception ? (detail.exception.description || detail.exception.value) : detail.text;
      throw new Error(`lỗi trong trang: ${text}`);
    }
    return reply.result.value;
  };

  const goto = async (url, { timeoutMs = 60000, settleMs = 2500 } = {}) => {
    let loaded = false;
    const off = conn.on((message) => {
      if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') loaded = true;
    });
    try {
      const result = await send('Page.navigate', { url });
      if (result && result.errorText) throw new Error(`không mở được ${url}: ${result.errorText}`);
      const deadline = Date.now() + timeoutMs;
      while (!loaded && Date.now() < deadline) await wait(100);
      if (!loaded) throw new Error(`hết ${timeoutMs}ms mà ${url} chưa bắn load`);
    } finally {
      off();
    }
    await wait(settleMs);
    return evaluate('location.href');
  };

  return { targetId, sessionId, evaluate, goto, send };
}

// ------------------------------------------------------------------ trình duyệt

/**
 * Mở Chrome có nạp extension, chạy `fn`, rồi đóng sạch.
 *
 * `--headless=new` nạp được extension MV3 (khác `--headless` cũ, vốn tắt hẳn hệ extension). Nếu
 * một lượt chạy báo `serviceWorkers: []` thì đó là **một lỗi phải báo**, không phải một bước bỏ
 * qua được — nên hàm này chỉ *trả về* danh sách, không tự quyết định thay người gọi.
 */
export async function withExtensionBrowser(options, fn) {
  const {
    chrome = null,
    extensionPath = REPO_ROOT,
    headless = process.env.HEADED ? false : true,
    windowSize = '1440,900',
  } = options || {};

  const bin = findChrome(chrome);
  if (!bin) throw new Error('không tìm thấy Chromium. Chỉ ra bằng --chrome <đường dẫn> hoặc CHROME=<đường dẫn>.');
  if (!existsSync(join(extensionPath, 'manifest.json'))) {
    throw new Error(`${extensionPath} không có manifest.json — đây không phải thư mục extension.`);
  }

  const profile = mkdtempSync(join(tmpdir(), 'nblm-live-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--mute-audio',
    `--window-size=${windowSize}`,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  let socket = null;
  let conn = null;
  // `try` bắt đầu ngay sau `spawn`, không phải sau khi nối được: Chrome khởi động mà không bao
  // giờ báo cổng DevTools vẫn phải bị giết.
  try {
    socket = await openSocket(await devtoolsEndpoint(child));
    conn = connection(socket, child);
    await conn.send('Target.setDiscoverTargets', { discover: true });
    const { product, revision } = await conn.send('Browser.getVersion');

    const newPage = async (url = 'about:blank') => {
      const target = await conn.send('Target.createTarget', { url });
      const attached = await conn.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const page = pageHandle(conn, attached.sessionId, target.targetId);
      await page.send('Page.enable', {});
      await page.send('Runtime.enable', {});
      return page;
    };

    /**
     * Bản đối ứng của `context.serviceWorkers()`.
     *
     * Service worker của MV3 khởi động **lười**: Chrome dựng nó khi có sự kiện đầu tiên, nên hỏi
     * ngay lúc trình duyệt vừa mở thì danh sách rỗng một cách hợp lệ. `timeoutMs` là chỗ phân
     * biệt "chưa kịp" với "không bao giờ" — và chỉ cái thứ hai mới là lỗi của extension.
     */
    const serviceWorkers = async ({ timeoutMs = 15000, match = null } = {}) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const { targetInfos } = await conn.send('Target.getTargets');
        const workers = targetInfos.filter((t) => t.type === 'service_worker');
        // Dừng khi thấy đúng worker đang chờ, không phải khi thấy **một** worker nào đó: Chrome
        // tự nạp vài component extension của riêng nó, và worker của chúng sẵn sàng trước worker
        // của extension đang thử. Dừng ở "danh sách không rỗng" là biến `timeoutMs` thành vô
        // dụng đúng lúc cần nó nhất — trả về danh sách chỉ có worker của Chrome, người gọi lọc
        // ra rỗng, rồi báo "extension không khởi động" cho một extension đang khởi động bình
        // thường. Vẫn trả về **cả** danh sách để người gọi in ra được những gì có mặt.
        const wanted = match ? workers.filter(match) : workers;
        if (wanted.length > 0 || Date.now() >= deadline) return workers;
        await wait(250);
      }
    };

    return await fn({
      chromePath: bin,
      version: `${product} (revision ${revision})`,
      profile,
      newPage,
      serviceWorkers,
      send: conn.send,
    });
  } finally {
    // `Browser.close` chứ không chỉ `child.kill()`: SIGTERM chỉ với tới tiến trình trình duyệt,
    // còn đám zygote/renderer của nó vẫn đang ghi vào profile — nên `rmSync` ngay sau đó luôn là
    // `ENOTEMPTY` và mỗi lượt chạy bỏ lại một thư mục tạm trong /tmp (ticket 016: 11 thư mục sau
    // 11 lượt).
    if (conn) await conn.send('Browser.close').catch(() => {});
    if (socket) socket.close();
    child.kill();
    await new Promise((resolve) => (child.exitCode === null ? child.once('exit', resolve) : resolve()));
    await removeProfile(profile);
  }
}
