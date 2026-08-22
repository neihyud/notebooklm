#!/usr/bin/env node
//
// Ticket 012 — chạy **chính mã nguồn** của lớp YouTube trên một trang watch thật, cả hai đường:
//
//   • đường DOM       — bấm nút Transcript, quét panel bằng `scanTranscriptPanel()`
//   • đường get_panel — gọi `/youtubei/v1/get_panel` thật bằng `viaPanel()` (ADR 0013)
//   • đường InnerTube — gọi `get_transcript` thật bằng `viaInnertube()`
//   • đường timedtext — lấy `captionBaseUrl` từ `ytInitialPlayerResponse` rồi tải json3
//
// Ba đường mạng đo **trong cùng một phiên, trên cùng một trang**: đó là điều kiện để so chúng
// với nhau. Ticket 013 chọn `get_panel` bằng đúng bảng số ấy chứ không bằng lập luận, và hai
// đường kia ở lại trong báo cáo để lần đo sau còn đối chứng — một endpoint chết có thể sống lại,
// và cách duy nhất biết được là vẫn hỏi nó.
//
// Vì sao phải chạy thật, bằng số đo chứ không phải lo xa: hai lỗi "chỉ lộ ra ở Chrome" đã lọt
// qua suite xanh của repo này. Ticket 009 gọi `.filter` thẳng lên `node.children` — DOM thật trả
// `HTMLCollection`, Bảng chọn không bao giờ mở, suite 537/537 xanh. Ticket 010 quên
// `install(root)` lúc nạp `src/docs/content.js` — Chrome nạp file thì không listener nào đăng ký,
// suite 609/609 xanh. Cả hai tìm ra do tình cờ.
//
// Đường InnerTube là **chỗ duy nhất** phát hiện được `params` protobuf của `get_transcript` sai:
// nó được viết theo hiểu biết, chưa lần nào chạm API thật, và không test nào chạm mạng. Nên
// script này không dừng khi đường DOM đã xanh — nó chạy cả hai, rồi đối chiếu.
//
// Và `params` không được kiểm bằng "gọi thử xem có ra transcript không". Phép đó không phân biệt
// được *params đúng* với *params sai mà máy chủ bỏ qua*, vì `viaInnertube` gửi kèm `videoId`.
// Phép đúng là **hỏi chính YouTube chuỗi thật là gì**: `/youtubei/v1/next` trả về
// `getTranscriptEndpoint.params` — đúng chuỗi mà giao diện YouTube tự đúc cho video đó. Đặt hai
// chuỗi cạnh nhau thì không còn gì để đoán.
//
//   node tools/verify-live.mjs [--video <id>] [--chrome <đường dẫn>] [--headed] [--json]
//
// Thoát 1 khi có tiêu chí đỏ, 2 khi không chạy được lượt đo.
//
// KHÔNG đăng nhập Google, KHÔNG chạm NotebookLM (`WORKSPACE_PROTOCOL.md`). Chrome for Testing mở
// bằng một profile tạm, không có phiên đăng nhập nào, và mọi request đi ra đều là request mà một
// tab ẩn danh cũng gửi được.

import { withExtensionBrowser, readSources, isOwnWorker } from './live-browser.mjs';
import { compareParams, compareTranscripts } from './live-checks.mjs';

/**
 * Video mặc định: công khai, có phụ đề, và là video đầu tiên của YouTube — thứ gần như chắc chắn
 * còn ở đó lần sau chạy lại. Đổi bằng `--video`.
 */
const DEFAULT_VIDEO = 'jNQXAC9IVRw';

/** Nạp vào MAIN world theo đúng thứ tự `manifest.json` nạp chúng cho tab YouTube. */
const YT_SOURCES = ['src/common/shared.js', 'src/youtube/selectors.js', 'src/youtube/srt.js', 'src/youtube/transcript.js'];

const json = (value) => JSON.stringify(value);

// ------------------------------------------------------------------ script chạy trong trang

/**
 * Ghi lại mọi lời gọi `/youtubei/` mà **chính trang** phát ra.
 *
 * Cài trước khi bấm nút Transcript, vì câu hỏi nó trả lời là: giao diện YouTube hôm nay lấy
 * transcript bằng endpoint nào? Nếu đó không còn là `get_transcript` thì mọi phép đo về `params`
 * của endpoint ấy đang đo một cánh cửa đã khoá.
 */
const RECORDER = `window.__nblmCalls = [];
(() => {
  const original = window.fetch;
  window.fetch = function (input, init) {
    const url = String((input && input.url) || input);
    if (url.includes('/youtubei/')) window.__nblmCalls.push(url.split('?')[0].replace('https://www.youtube.com', ''));
    return original.apply(this, arguments);
  };
})()`;

/**
 * Đường DOM, viết đúng theo `createPage()` của `src/youtube/watch.js`: **bấm đúng một lần** rồi
 * quét lại nhiều lượt.
 *
 * Một lần, không phải mỗi lượt: nút Transcript của YouTube là nút bật/tắt, nên bấm ở lượt hai là
 * đóng lại đúng cái panel vừa mở — và triệu chứng y hệt "video này không có transcript".
 *
 * `rowsOnPage` đếm dòng segment trên **cả trang**, ngoài mọi ràng buộc panel. Nó không phải kết
 * quả của sản phẩm; nó là chứng cứ phân biệt "video này không có transcript" với "transcript
 * nằm ngay đó mà selector không với tới" — hai chuyện cho ra cùng một lỗi.
 */
const domScript = (tries, stepMs) => `(async () => {
  const T = window.NBLM_TRANSCRIPT;
  const Y = window.NBLM_YT_SELECTORS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { pressed: false, buttonLabel: '', tries: 0, segments: [], reason: '', message: '', rowsOnPage: 0, panels: [] };

  const button = T.findTranscriptButton(document);
  if (button) {
    out.buttonLabel = (button.getAttribute('aria-label') || button.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    out.pressed = true;
    T.pressElement(button);
    await sleep(${stepMs});
  }

  for (let i = 0; i < ${tries}; i += 1) {
    out.tries = i + 1;
    const scan = T.scanTranscriptPanel(document, { opened: out.pressed });
    if (scan.ok) { out.segments = scan.segments; out.reason = ''; out.message = ''; break; }
    out.reason = scan.reason || '';
    out.message = scan.message || '';
    await sleep(${stepMs});
  }

  const rowCss = Y.DEFAULT.css('segment');
  out.rowsOnPage = document.querySelectorAll(rowCss).length;
  for (const panel of document.querySelectorAll('ytd-engagement-panel-section-list-renderer')) {
    const rows = panel.querySelectorAll(rowCss).length;
    if (rows === 0 && !panel.matches(Y.DEFAULT.css('panel'))) continue;
    // Hai cột, không một: từ ticket 017, danh tính transcript có thể nằm ở một khối bên trong
    // panel (thuộc tính data-target-id) chứ không ở chính panel. Chỉ in cột thứ nhất là báo
    // "selector không với tới" về đúng cái panel mà selector đang đọc được.
    out.panels.push({
      targetId: panel.getAttribute('target-id'),
      visibility: panel.getAttribute('visibility'),
      rows,
      matchesPanelSelector: panel.matches(Y.DEFAULT.css('panel')),
      innerPanelMatch: !!panel.querySelector(Y.DEFAULT.css('panel')),
      width: Math.round(panel.getBoundingClientRect().width),
    });
  }
  return out;
})()`;

/**
 * Đường InnerTube: gọi `viaInnertube()` thật, và **chụp lại request nó gửi đi**.
 *
 * Chụp request là điểm của cả hàm này. Không có nó thì `params` — thứ duy nhất chưa từng chạm API
 * thật — vẫn nằm trong bụng `viaInnertube` và handback chỉ dán được một con số segment, đúng thứ
 * không trả lời được câu hỏi ticket đặt ra.
 *
 * `credentials: 'include'` và hình dạng header chép đúng `buildTab()` của `src/youtube/watch.js`:
 * một phép kiểm gửi request khác request của sản phẩm thì đo một thứ không ai chạy.
 *
 * `ytcfg` đọc bằng `NBLM_PAGE_BRIDGE.ytcfgSnapshot` — chính cầu MAIN world của extension, đang
 * chạy sẵn trên tab này vì Chrome đã nạp extension. Nếu nó không có ở đây thì content script MAIN
 * world đã không đăng ký, và đó là ca ticket 010 lặp lại.
 */
const innertubeScript = (videoId) => `(async () => {
  const T = window.NBLM_TRANSCRIPT;
  const B = window.NBLM_PAGE_BRIDGE;
  const out = { bridgeInstalled: Boolean(B), ytcfg: null, sent: null, body: '', segments: [], error: '' };
  if (!B) { out.error = 'MAIN world không có NBLM_PAGE_BRIDGE — content script MAIN world chưa đăng ký'; return out; }

  const cfg = B.ytcfgSnapshot(window.ytcfg);
  out.ytcfg = { hasApiKey: Boolean(cfg.apiKey), clientName: cfg.clientName, clientVersion: cfg.clientVersion, hl: cfg.hl, gl: cfg.gl };

  const net = {
    post: async (request) => {
      out.sent = { url: request.url.replace(/key=[^&]*/, 'key=…'), params: request.body.params || '', videoId: request.body.videoId };
      const response = await fetch(request.url, {
        method: 'POST', credentials: 'include', headers: request.headers, body: JSON.stringify(request.body),
      });
      out.sent.status = response.status;
      const text = await response.text();
      out.body = text.slice(0, 300);
      if (!response.ok) throw new Error('InnerTube trả HTTP ' + response.status);
      return JSON.parse(text);
    },
  };

  try {
    out.segments = await T.viaInnertube({ videoId: ${json(videoId)}, ytcfg: cfg }, net, {});
  } catch (error) {
    out.error = String((error && error.message) || error);
  }
  return out;
})()`;

/**
 * Hai ứng viên cho **đường trích thứ hai** (ticket 013), đo cạnh nhau trên cùng một trang.
 *
 * `timedtext` đi qua `captionBaseUrl` trong `ytInitialPlayerResponse` — script này đọc thẳng biến
 * toàn cục ấy, khác hẳn sản phẩm: `playerResponseSnapshot()` cố ý **không** mang `baseUrl` ra
 * khỏi trang (URL đã ký). Chỗ này là phép đo, không phải sản phẩm, nên nó được đọc thứ mà sản
 * phẩm từ chối đọc — và đó chính là thứ cần đo để biết từ chối ấy có đúng không.
 *
 * `get_panel` chạy **chính `viaPanel()` của sản phẩm** và chụp lại request nó gửi đi, đúng khuôn
 * `innertubeScript`: một phép kiểm gửi request khác request của sản phẩm thì đo một thứ không ai
 * chạy.
 */
const candidateScript = (videoId) => `(async () => {
  const T = window.NBLM_TRANSCRIPT;
  const B = window.NBLM_PAGE_BRIDGE;
  const out = { timedtext: null, panel: null, player: null };

  const pr = window.ytInitialPlayerResponse;
  const list = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer;
  const tracks = (list && list.captionTracks) || [];
  const snapshot = B ? B.playerResponseSnapshot(pr) : { videoId: '', captionTracks: [] };
  out.player = {
    prVideoId: snapshot.videoId,
    aboutThisVideo: snapshot.videoId === ${json(videoId)},
    tracks: snapshot.captionTracks.map((t) => t.languageCode + (t.kind ? '/' + t.kind : '')),
    snapshotCarriesBaseUrl: JSON.stringify(snapshot).includes('timedtext'),
  };

  // ---------------------------------------------------------------- ứng viên 1: timedtext
  if (!tracks.length) {
    out.timedtext = { status: 0, bytes: 0, segments: 0, note: 'video không khai caption track nào' };
  } else {
    // \`new URL\` nằm **trong** try, cùng lý do với \`oracleScript\` ở dưới: một caption track
    // thiếu \`baseUrl\` là một kết quả, không phải một lượt chạy hỏng. Để nó ném ra ngoài
    // \`page.evaluate\` là vứt luôn cả phép đo đường DOM và phép đo get_panel vừa xong.
    try {
      const url = new URL(tracks[0].baseUrl);
      url.searchParams.set('fmt', 'json3');
      const response = await fetch(url.toString(), { credentials: 'include' });
      const text = await response.text();
      let segments = 0;
      try { segments = T.parseTimedText(JSON.parse(text)).length; } catch (e) { segments = -1; }
      out.timedtext = {
        status: response.status, bytes: text.length, segments,
        exp: url.searchParams.get('exp') || '',
        head: text.slice(0, 90).replace(/\\s+/g, ' '),
      };
    } catch (error) {
      out.timedtext = { status: -1, bytes: 0, segments: -1, note: 'không đo được', head: String((error && error.message) || error) };
    }
  }

  // ---------------------------------------------------------------- ứng viên 2: get_panel
  if (!B) {
    out.panel = { error: 'MAIN world không có NBLM_PAGE_BRIDGE', segments: [], sent: null };
  } else {
    const cfg = B.ytcfgSnapshot(window.ytcfg);
    const panel = { sent: null, bytes: 0, segments: [], error: '', code: '' };
    const net = {
      post: async (request) => {
        panel.sent = { url: request.url.replace(/key=[^&]*/, 'key=…'), panelId: request.body.panelId, params: request.body.params };
        const response = await fetch(request.url, {
          method: 'POST', credentials: 'include', headers: request.headers, body: JSON.stringify(request.body),
        });
        panel.sent.status = response.status;
        const text = await response.text();
        panel.bytes = text.length;
        panel.hasContent = text.includes('"content"');
        if (!response.ok) throw new Error('get_panel trả HTTP ' + response.status);
        return JSON.parse(text);
      },
    };
    try {
      panel.segments = await T.viaPanel({ videoId: ${json(videoId)}, ytcfg: cfg, player: snapshot }, net, {});
    } catch (error) {
      panel.error = String((error && error.message) || error);
      panel.code = String((error && error.reason) || '');
    }
    out.panel = panel;
  }
  return out;
})()`;

/**
 * Chuỗi `params` **thật** cho video này, hỏi thẳng YouTube.
 *
 * `/youtubei/v1/next` trả về `getTranscriptEndpoint.params` — đúng chuỗi mà giao diện YouTube
 * dùng khi người ta bấm "Show transcript". Đặt nó cạnh chuỗi `transcriptParams()` của sản phẩm
 * đúc ra là phép kiểm trực tiếp, không phụ thuộc vào việc `get_transcript` hôm nay còn sống hay
 * không — và đó là điều kiện để kết luận về `params` vẫn đứng vững khi endpoint đổi.
 *
 * `next` cũng là **đối chứng cho chính lượt đo**: cùng trang, cùng phiên, cùng hình dạng request.
 * Nó trả 200 thì một cái 400 ở `get_transcript` không đổ được cho "chưa đăng nhập" hay "context
 * thiếu trường" nữa.
 */
const oracleScript = (videoId, productParams) => `(async () => {
  const T = window.NBLM_TRANSCRIPT;
  const cfg = window.ytcfg;
  // Trang consent, trang chặn bot hay trang lỗi của YouTube đều không có \`ytcfg\`. Để nguyên
  // \`cfg.get(...)\` thì lượt chạy ném ra khỏi \`page.evaluate\`, \`main()\` thoát 2, và **cả hai**
  // phép đo vừa xong ở trên (đường DOM, đường InnerTube) bị vứt cùng — mất đúng thứ công cụ này
  // sinh ra để dán vào handback. Thiếu \`ytcfg\` là một kết quả, không phải một lượt chạy hỏng.
  if (!cfg || typeof cfg.get !== 'function') {
    return {
      productParams: ${json(productParams)},
      mintedParams: '',
      next: { status: -1, bytes: 0, error: 'trang không có window.ytcfg — nhiều khả năng YouTube trả trang consent hoặc trang chặn, không phải trang xem' },
      tries: [],
    };
  }
  const context = cfg.get('INNERTUBE_CONTEXT');
  const key = cfg.get('INNERTUBE_API_KEY');
  const post = async (path, body) => {
    const response = await fetch('https://www.youtube.com/youtubei/v1/' + path + '?key=' + encodeURIComponent(key) + '&prettyPrint=false', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': String(cfg.get('INNERTUBE_CLIENT_NAME') || '1'),
        'X-Youtube-Client-Version': String(cfg.get('INNERTUBE_CLIENT_VERSION') || '') },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  };

  const out = { productParams: ${json(productParams)}, mintedParams: '', next: null, tries: [] };
  try {
    const next = await post('next', { context, videoId: ${json(videoId)} });
    out.next = { status: next.status, bytes: next.text.length };
    out.mintedParams = (next.text.match(/getTranscriptEndpoint":\\{"params":"([^"]+)"/) || [])[1] || '';
  } catch (error) {
    out.next = { status: -1, bytes: 0, error: String((error && error.message) || error) };
  }

  const variants = [
    ['params của sản phẩm', ${json(productParams)}],
    ['params YouTube tự đúc', out.mintedParams],
    ['bỏ hẳn params', null],
    ['params rác', 'xxxxxxxx'],
  ];
  for (const [name, params] of variants) {
    if (params === '') { out.tries.push({ name, skipped: 'không lấy được chuỗi này' }); continue; }
    const body = { context, videoId: ${json(videoId)} };
    if (params !== null) body.params = params;
    try {
      const reply = await post('get_transcript', body);
      let count = -1;
      try { count = T.parseInnertubeTranscript(JSON.parse(reply.text)).length; } catch (e) { count = -1; }
      out.tries.push({ name, status: reply.status, count, head: reply.text.slice(0, 90).replace(/\\s+/g, ' ') });
    } catch (error) {
      out.tries.push({ name, status: -1, count: -1, head: String((error && error.message) || error) });
    }
  }
  return out;
})()`;

// ------------------------------------------------------------------ báo cáo

function printReport(report) {
  const { video, url, chrome, workers, dom, candidates, innertube, oracle, params, calls, comparison } = report;

  console.log('# Kiểm chứng lớp YouTube trên trang thật (ticket 012)');
  console.log(`# Chromium  : ${chrome.version}`);
  console.log(`# nhị phân  : ${chrome.path}`);
  console.log(`# Node      : ${process.version}`);
  console.log(`# video     : ${video}`);
  console.log(`# URL       : ${url}`);
  console.log('');

  console.log('## Extension đã nạp');
  console.log(`   service worker của extension này : ${workers.own.length ? workers.own.map((w) => w.url).join(', ') : 'KHÔNG CÓ'}`);
  console.log(`   mọi service worker Chrome thấy   : ${workers.all.length}`);
  for (const worker of workers.all) console.log(`     - ${worker.url}`);
  console.log('');

  console.log('## Đường DOM');
  console.log(`   nút Transcript  : ${dom.pressed ? `đã bấm — "${dom.buttonLabel}"` : 'KHÔNG DÒ RA'}`);
  console.log(`   số lượt quét    : ${dom.tries}`);
  console.log(`   segment         : ${dom.segments.length}`);
  console.log(`   dòng segment có trên trang (ngoài mọi ràng buộc panel) : ${dom.rowsOnPage}`);
  if (dom.segments.length === 0) console.log(`   lý do           : ${dom.reason || '?'} — ${dom.message || '?'}`);
  else console.log(`   đầu / cuối      : "${comparison.dom.firstText}" … "${comparison.dom.lastText}"`);
  for (const panel of dom.panels) {
    console.log(`     panel target-id=${json(panel.targetId)} visibility=${panel.visibility} `
      + `dòng=${panel.rows} rộng=${panel.width}px `
      + `selector 'panel' khớp: chính panel=${panel.matchesPanelSelector}, khối trong=${panel.innerPanelMatch}`);
  }
  console.log('');

  console.log('## Hai ứng viên đường trích thứ hai — cùng phiên, cùng trang (ticket 013)');
  const player = candidates.player || {};
  console.log(`   ytInitialPlayerResponse nói về : ${json(player.prVideoId)} `
    + `(đúng video đang mở: ${player.aboutThisVideo})`);
  console.log(`   caption track trang khai        : ${(player.tracks || []).join(', ') || '(không có)'}`);
  console.log(`   ảnh chụp có mang baseUrl ra không : ${player.snapshotCarriesBaseUrl}  (phải là false — URL đã ký)`);
  const tt = candidates.timedtext || {};
  console.log(`   • timedtext  HTTP ${tt.status}, ${tt.bytes} byte, ${tt.segments} segment`
    + `${tt.exp ? `, exp=${tt.exp}` : ''}${tt.note ? ` — ${tt.note}` : ''}`);
  const gp = candidates.panel || {};
  console.log(`   • get_panel  HTTP ${(gp.sent && gp.sent.status) || '-'}, ${gp.bytes} byte, `
    + `${(gp.segments || []).length} segment, khối content: ${gp.hasContent}`);
  if (gp.sent) console.log(`     panelId=${json(gp.sent.panelId)} params=${json(gp.sent.params)}`);
  if (gp.error) console.log(`     lỗi: ${gp.error}  [mã: ${gp.code || '(không có)'}]`);
  console.log('');

  console.log('## Đường InnerTube');
  console.log(`   NBLM_PAGE_BRIDGE ở MAIN world : ${innertube.bridgeInstalled ? 'có' : 'KHÔNG'}`);
  console.log(`   ytcfg           : ${json(innertube.ytcfg)}`);
  if (innertube.sent) {
    console.log(`   params đã gửi   : ${json(innertube.sent.params)}  (videoId kèm theo: ${json(innertube.sent.videoId)})`);
    console.log(`   HTTP            : ${innertube.sent.status}`);
    if (innertube.body) console.log(`   thân trả lời    : ${innertube.body.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  console.log(`   segment         : ${innertube.segments.length}`);
  if (innertube.error) console.log(`   lỗi             : ${innertube.error}`);
  console.log('');

  console.log('## params protobuf — đối chiếu với chuỗi YouTube tự đúc');
  console.log(`   /youtubei/v1/next : HTTP ${oracle.next ? oracle.next.status : '?'} (${oracle.next ? oracle.next.bytes : 0} byte)`
    + `${oracle.next && oracle.next.error ? ` — ${oracle.next.error}` : ''}`);
  console.log(`   sản phẩm đúc ra   : ${json(oracle.productParams)}`);
  console.log(`   YouTube tự đúc    : ${json(oracle.mintedParams)}`);
  console.log(`   ⇒ ${params.verdict}: ${params.note}`);
  console.log('   get_transcript với từng loại params:');
  for (const attempt of oracle.tries) {
    if (attempt.skipped) console.log(`     - ${attempt.name.padEnd(24)} bỏ qua (${attempt.skipped})`);
    else console.log(`     - ${attempt.name.padEnd(24)} HTTP ${attempt.status}, ${attempt.count} segment  ${attempt.head}`);
  }
  console.log('');

  console.log('## Endpoint mà CHÍNH TRANG gọi khi bấm nút Transcript');
  console.log(`   ${calls.length ? [...new Set(calls)].join(', ') : '(không ghi được lời gọi nào)'}`);
  console.log('');

  console.log('## Hai đường của sản phẩm có khớp nhau không (DOM ↔ get_panel)');
  const line = (mark, label, detail) => console.log(`  ${mark}  ${label.padEnd(26)} ${detail}`);
  line(comparison.dom.count > 0 ? '✓' : '✗', 'DOM', `${comparison.dom.count} segment, mốc tăng dần: ${comparison.dom.ordered}`);
  line(comparison.api.count > 0 ? '✓' : '✗', 'get_panel', `${comparison.api.count} segment, mốc tăng dần: ${comparison.api.ordered}`);
  line(comparison.countsMatch ? '✓' : '✗', 'số segment', comparison.countsMatch ? 'khớp' : 'lệch');
  line(comparison.overlap >= 0.8 ? '✓' : '✗', 'chữ trùng nhau', `${(comparison.overlap * 100).toFixed(1)}%`);
  line(comparison.agree ? '✓' : '✗', 'kết luận', comparison.agree ? 'hai đường nói về cùng một video' : 'KHÔNG khớp');
}

// ------------------------------------------------------------------ main

/**
 * Giá trị đi kèm một cờ, và **ném khi thiếu**. `argv[i + 1]` trần thì `--video` ở cuối dòng lệnh
 * cho ra `undefined`, mà `String(undefined)` là chín ký tự chữ nên nó lọt qua đúng phép kiểm
 * dạng id ở dưới — lượt chạy mở `watch?v=undefined` rồi báo cả hai đường trích được 0 segment
 * như thể sản phẩm hỏng.
 */
function value(argv, i) {
  if (argv[i + 1] === undefined) throw new Error(`${argv[i]} thiếu giá trị đi kèm`);
  return argv[i + 1];
}

function parseArgs(argv) {
  const out = { video: DEFAULT_VIDEO, chrome: null, headed: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--headed') out.headed = true;
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--video') { out.video = value(argv, i); i += 1; }
    else if (argv[i] === '--chrome') { out.chrome = value(argv, i); i += 1; }
    else throw new Error(`tham số không hiểu: ${argv[i]}`);
  }
  if (!/^[\w-]{6,}$/.test(String(out.video))) throw new Error(`--video phải là id video, nhận được: ${out.video}`);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const watchUrl = `https://www.youtube.com/watch?v=${args.video}`;

  const report = await withExtensionBrowser({ chrome: args.chrome, headless: !args.headed }, async (ctx) => {
    // Chrome tự nạp vài component extension của riêng nó (Web Store, hangout services), nên
    // "danh sách không rỗng" chưa nói gì — và cũng vì thế `match` phải đi cùng `timeoutMs`: vòng
    // chờ dừng khi thấy đúng worker của extension này, không phải khi thấy worker đầu tiên.
    const all = await ctx.serviceWorkers({ timeoutMs: 20000, match: isOwnWorker });
    const own = all.filter(isOwnWorker);

    const page = await ctx.newPage();
    const url = await page.goto(watchUrl, { settleMs: 6000 });
    await page.evaluate(RECORDER, { awaitPromise: false });
    await page.evaluate(readSources(YT_SOURCES), { awaitPromise: false });

    const dom = await page.evaluate(domScript(24, 500));
    const calls = await page.evaluate('window.__nblmCalls.slice()', { awaitPromise: false });
    const candidates = await page.evaluate(candidateScript(args.video));
    const innertube = await page.evaluate(innertubeScript(args.video));
    const oracle = await page.evaluate(oracleScript(args.video, (innertube.sent && innertube.sent.params) || ''));

    return {
      video: args.video,
      url,
      chrome: { path: ctx.chromePath, version: ctx.version },
      workers: { all, own },
      dom,
      candidates,
      innertube,
      oracle,
      params: compareParams(oracle.productParams, oracle.mintedParams),
      calls,
      comparison: compareTranscripts(dom.segments, candidates.panel.segments),
    };
  });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);

  // Bốn điều kiện đỏ, và mỗi điều kiện là một phát hiện khác nhau — nên chúng được liệt kê riêng
  // chứ không gộp thành một `ok` duy nhất.
  const failures = [];
  if (report.workers.own.length === 0) failures.push('service worker của extension không khởi động');
  if (report.dom.segments.length === 0) {
    failures.push(report.dom.rowsOnPage > 0
      ? `đường DOM không trích được segment nào, dù trên trang có ${report.dom.rowsOnPage} dòng segment (${report.dom.reason})`
      : `đường DOM không trích được segment nào (${report.dom.reason})`);
  }
  if (report.candidates.panel.segments.length === 0) {
    failures.push(`đường get_panel không trích được segment nào (${report.candidates.panel.code || report.candidates.panel.error})`);
  }
  if (report.candidates.player.snapshotCarriesBaseUrl) {
    failures.push('playerResponseSnapshot mang URL timedtext đã ký ra khỏi trang — danh sách trắng thủng');
  }
  // Đếm segment một mình không nói gì về **mốc**: một lượt quét đủ 24 dòng đủ chữ mà mọi mốc
  // bằng 0 vẫn đếm ra 24 (ticket 017 — selector mốc lệch tên lớp, và cả hai video được báo là
  // "chạy tốt"). Nên `ordered` phải là một tiêu chí đỏ, không phải một dòng in ra rồi thôi.
  for (const [name, stats] of [['DOM', report.comparison.dom], ['get_panel', report.comparison.api]]) {
    if (stats.count > 0 && !stats.ordered) {
      failures.push(`đường ${name}: mốc thời gian không tăng dần `
        + `(${stats.distinctStarts} mốc phân biệt trên ${stats.count} segment)`);
    }
  }
  if (!report.comparison.agree) failures.push('hai đường không khớp nhau');

  // Hai phát hiện của ticket 012 **không còn là tiêu chí đỏ**, và đó là một quyết định chứ không
  // phải một lần bỏ sót: ADR 0013 đã chốt rằng `get_transcript` chết và `timedtext` bị PoToken
  // khoá, nên để chúng làm cổng là biến cổng thành một dòng đỏ vĩnh viễn không ai đọc nữa. Chúng
  // xuống mục "ghi nhận": vẫn đo mỗi lượt, vẫn in ra, nhưng không quyết định xanh/đỏ.
  const noted = [];
  if (report.innertube.segments.length === 0) noted.push(`get_transcript vẫn chết: ${report.innertube.error || 'không trích được segment nào'}`);
  if (report.params.verdict !== 'giống-hệt') noted.push(`params protobuf của get_transcript: ${report.params.verdict}`);
  // `note` có mặt nghĩa là **không có phép đo nào** (video không khai caption track, hoặc lượt đo
  // ném). Gộp nó vào câu "timedtext vẫn bị khoá" là khẳng định một số đo chưa từng lấy — đúng cái
  // gộp "không có phụ đề" với "hỏng" mà ticket này tách ra ở tầng dữ liệu.
  if (report.candidates.timedtext.note) {
    noted.push(`timedtext không đo được ở video này: ${report.candidates.timedtext.note}`);
  } else if (report.candidates.timedtext.segments <= 0) {
    noted.push(`timedtext vẫn bị khoá: HTTP ${report.candidates.timedtext.status}, ${report.candidates.timedtext.bytes} byte`);
  } else {
    failures.push('timedtext bỗng trả về segment — ADR 0013 chọn get_panel dựa trên việc nó KHÔNG trả về gì, hãy đo lại');
  }

  if (!args.json) {
    console.log('');
    console.log('-'.repeat(72));
    console.log(failures.length === 0 ? 'XANH — cả hai đường của sản phẩm chạy được và khớp nhau.' : `ĐỎ (${failures.length}):`);
    for (const failure of failures) console.log(`  • ${failure}`);
    if (noted.length) {
      console.log('');
      console.log(`GHI NHẬN (${noted.length}) — đã biết, ADR 0013 đã chốt, không tính là đỏ:`);
      for (const note of noted) console.log(`  • ${note}`);
    }
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`verify-live: ${error && error.stack ? error.stack : error}`);
  process.exit(2);
});
