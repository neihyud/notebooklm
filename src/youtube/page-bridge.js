/*
 * MAIN world, chạy ở document_start trên youtube.com.
 *
 * Nhiệm vụ: content script (isolated world) không đọc được biến của trang
 * (ytcfg, ytInitialPlayerResponse) và không tự ký được header xác thực
 * InnerTube. File này chạy trong chính ngữ cảnh trang nên làm được cả hai,
 * rồi trả kết quả qua window.postMessage.
 *
 * Mấu chốt cho video PRIVATE: ta mượn đúng bộ header (Authorization:
 * SAPISIDHASH ...) mà YouTube tự gửi cho InnerTube, nên request của ta được
 * xác thực y hệt phiên đăng nhập của chủ video. Không đụng gì tới chế độ
 * hiển thị của video.
 */
(() => {
  'use strict';

  const REQ = 'NBLM_YT_REQ';
  const RES = 'NBLM_YT_RES';
  const origFetch = window.fetch.bind(window);

  /* ------------------------------------------------------------------ */
  /* 1. Mượn header xác thực từ chính request InnerTube của YouTube       */
  /* ------------------------------------------------------------------ */

  let captured = null;

  const KEEP = new Set([
    'authorization',
    'x-goog-authuser',
    'x-goog-pageid',
    'x-goog-visitor-id',
    'x-origin',
    'x-youtube-client-name',
    'x-youtube-client-version',
    'x-youtube-bootstrap-logged-in',
    'x-goog-api-format-version',
  ]);

  function harvest(headers) {
    if (!headers) return null;
    const out = {};
    const put = (k, v) => {
      const key = String(k).toLowerCase();
      if (KEEP.has(key) && v != null && v !== '') out[key] = String(v);
    };
    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) headers.forEach((v, k) => put(k, v));
      else if (Array.isArray(headers)) headers.forEach((pair) => pair && put(pair[0], pair[1]));
      else Object.keys(headers).forEach((k) => put(k, headers[k]));
    } catch (_) {
      return null;
    }
    return Object.keys(out).length ? out : null;
  }

  function remember(headers) {
    const h = harvest(headers);
    if (!h) return;
    // Ưu tiên bộ header có Authorization; nếu chưa có thì gộp dần.
    captured = h.authorization ? Object.assign({}, captured, h) : Object.assign({}, h, captured);
  }

  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/youtubei/v1/') !== -1) {
        remember(init && init.headers);
        if (input && typeof input !== 'string' && input.headers) remember(input.headers);
      }
    } catch (_) {
      /* tuyệt đối không được làm hỏng trang */
    }
    return origFetch(input, init);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__nblmUrl = String(url || ''); } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    try {
      if (String(this.__nblmUrl || '').indexOf('/youtubei/v1/') !== -1) remember({ [key]: value });
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };

  /** Dự phòng: tự ký SAPISIDHASH nếu chưa mượn được header nào. */
  async function sapisidAuth() {
    const m = /(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID|__Secure-1PAPISID)=([^;]+)/.exec(document.cookie || '');
    if (!m) return null;
    const ts = Math.floor(Date.now() / 1000);
    const payload = `${ts} ${decodeURIComponent(m[1])} ${location.origin}`;
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(payload));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return `SAPISIDHASH ${ts}_${hex}`;
  }

  /* ------------------------------------------------------------------ */
  /* 2. Đọc cấu hình InnerTube của trang                                  */
  /* ------------------------------------------------------------------ */

  function readCfg() {
    let data = {};
    try {
      if (window.ytcfg && typeof window.ytcfg.get === 'function') {
        data = {
          apiKey: window.ytcfg.get('INNERTUBE_API_KEY'),
          context: window.ytcfg.get('INNERTUBE_CONTEXT'),
          clientName: window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME'),
          clientVersion: window.ytcfg.get('INNERTUBE_CLIENT_VERSION'),
        };
      } else if (window.ytcfg && window.ytcfg.data_) {
        const d = window.ytcfg.data_;
        data = {
          apiKey: d.INNERTUBE_API_KEY,
          context: d.INNERTUBE_CONTEXT,
          clientName: d.INNERTUBE_CONTEXT_CLIENT_NAME,
          clientVersion: d.INNERTUBE_CLIENT_VERSION,
        };
      }
    } catch (_) {}

    const context = data.context ? JSON.parse(JSON.stringify(data.context)) : {
      client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' },
    };
    return {
      apiKey: data.apiKey || null,
      context,
      clientName: data.clientName || 1,
      clientVersion: data.clientVersion || (context.client && context.client.clientVersion) || '2.20240101.00.00',
    };
  }

  async function innertube(path, body) {
    const cfg = readCfg();
    const headers = Object.assign(
      { 'content-type': 'application/json', 'x-goog-api-format-version': '2' },
      captured || {}
    );
    if (!headers.authorization) {
      const auth = await sapisidAuth();
      if (auth) {
        headers.authorization = auth;
        headers['x-origin'] = location.origin;
      }
    }
    headers['x-youtube-client-name'] = String(cfg.clientName);
    headers['x-youtube-client-version'] = cfg.clientVersion;

    const url =
      `${location.origin}/youtubei/v1/${path}?prettyPrint=false` +
      (cfg.apiKey ? `&key=${encodeURIComponent(cfg.apiKey)}` : '');

    const res = await origFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(Object.assign({ context: cfg.context }, body)),
    });
    if (!res.ok) {
      // Kèm cả thân phản hồi: "HTTP 400" trần trụi không phân biệt được lỗi
      // params sai, thiếu xác thực, hay video không có transcript.
      let detail = '';
      try {
        detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 200);
      } catch (_) {}
      throw new Error(`InnerTube ${path} trả HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    return res.json();
  }

  /* ------------------------------------------------------------------ */
  /* 3. Tiện ích phân tích JSON nhúng trong HTML                          */
  /* ------------------------------------------------------------------ */

  /** Cắt object JSON cân bằng ngoặc bắt đầu tại vị trí `start`. */
  function sliceBalanced(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  function extractJson(html, varName) {
    const patterns = [
      new RegExp(`var\\s+${varName}\\s*=\\s*`),
      new RegExp(`window\\s*\\[\\s*["']${varName}["']\\s*\\]\\s*=\\s*`),
      new RegExp(`${varName}\\s*=\\s*`),
    ];
    for (const re of patterns) {
      const m = re.exec(html);
      if (!m) continue;
      const start = m.index + m[0].length;
      if (html[start] !== '{') continue;
      const json = sliceBalanced(html, start);
      if (!json) continue;
      try {
        return JSON.parse(json);
      } catch (_) {
        /* thử pattern kế tiếp */
      }
    }
    return null;
  }

  /** Duyệt sâu, thu mọi giá trị mà `pick(key, value)` trả về khác null. */
  function deepCollect(node, pick, out = [], depth = 0) {
    if (!node || typeof node !== 'object' || depth > 40) return out;
    if (Array.isArray(node)) {
      for (const item of node) deepCollect(item, pick, out, depth + 1);
      return out;
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      const hit = pick(key, value);
      if (hit != null) out.push(hit);
      deepCollect(value, pick, out, depth + 1);
    }
    return out;
  }

  function currentVideoId() {
    try {
      const u = new URL(location.href);
      return u.searchParams.get('v') || (/^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(u.pathname) || [])[1] || null;
    } catch (_) {
      return null;
    }
  }

  /** Tải HTML trang watch bằng chính phiên đăng nhập hiện tại. */
  async function fetchWatchPage(videoId) {
    const res = await origFetch(`${location.origin}/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Không tải được trang watch (HTTP ${res.status})`);
    const html = await res.text();
    return {
      player: extractJson(html, 'ytInitialPlayerResponse'),
      data: extractJson(html, 'ytInitialData'),
    };
  }

  /* ------------------------------------------------------------------ */
  /* 4. Metadata video                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * @param {boolean} opts.noFallback tắt nhánh tải nguyên trang watch khi
   *   `innertube('player')` hỏng.
   *
   *   Nhánh đó đúng khi hỏi MỘT video: nó cứu được ca InnerTube từ chối. Nhưng
   *   nó tải nguyên trang watch, nên hỏi 200 video là 200 lượt tải HTML đầy đủ —
   *   một cái giá không ai nhìn thấy ở chỗ nó phát sinh. Người gọi hàng loạt bật
   *   cờ này và coi lỗi là "không biết", tức Hàng đợi; fail-closed, không
   *   fail-open.
   */
  async function getPlayerResponse(videoId, { noFallback = false } = {}) {
    const live = window.ytInitialPlayerResponse;
    if (live && live.videoDetails && live.videoDetails.videoId === videoId) return live;

    try {
      const viaRpc = await innertube('player', { videoId });
      if (viaRpc && viaRpc.videoDetails) return viaRpc;
    } catch (e) {
      if (noFallback) throw e;
      /* rơi xuống cách tải HTML */
    }
    if (noFallback) throw new Error('Không hỏi được player response qua InnerTube');
    const { player } = await fetchWatchPage(videoId);
    if (!player) throw new Error('Không đọc được dữ liệu player của video');
    return player;
  }

  function metaFrom(playerResponse) {
    const vd = (playerResponse && playerResponse.videoDetails) || {};
    const mf =
      (playerResponse && playerResponse.microformat && playerResponse.microformat.playerMicroformatRenderer) || {};
    const status = (playerResponse && playerResponse.playabilityStatus) || {};
    const tracks =
      (playerResponse &&
        playerResponse.captions &&
        playerResponse.captions.playerCaptionsTracklistRenderer &&
        playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks) ||
      [];

    let privacy = 'public';
    if (vd.isPrivate === true) privacy = 'private';
    else if (mf.isUnlisted === true) privacy = 'unlisted';
    if (/LOGIN_REQUIRED|UNPLAYABLE/i.test(status.status || '') && /private/i.test(status.reason || '')) {
      privacy = 'private';
    }

    return {
      videoId: vd.videoId || null,
      title: vd.title || null,
      channel: vd.author || null,
      channelId: vd.channelId || null,
      durationSec: Number(vd.lengthSeconds || 0),
      publishedAt: mf.publishDate || mf.uploadDate || null,
      description: vd.shortDescription || '',
      privacy,
      hasCaptions: tracks.length > 0,
      captionLangs: tracks.map((t) => ({
        code: t.languageCode,
        kind: t.kind || 'manual',
        name: (t.name && (t.name.simpleText || (t.name.runs || []).map((r) => r.text).join(''))) || t.languageCode,
      })),
      playable: (status.status || 'OK') === 'OK',
      reason: status.reason || null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 5. Transcript — hai đường trong ngữ cảnh trang                       */
  /* ------------------------------------------------------------------ */

  function scoreTrack(track, langs) {
    const code = String(track.languageCode || '').toLowerCase();
    const isAsr = track.kind === 'asr';
    let score = 0;
    const idx = langs.findIndex((l) => code === l || code.startsWith(`${l}-`));
    if (idx >= 0) score += 100 - idx * 10;
    if (!isAsr) score += 30; // phụ đề người làm luôn tốt hơn tự động
    return score;
  }

  function pickTrack(tracks, langs) {
    const list = (tracks || []).filter((t) => t && t.baseUrl);
    if (!list.length) return null;
    return list.slice().sort((a, b) => scoreTrack(b, langs) - scoreTrack(a, langs))[0];
  }

  /** Đường A: endpoint timedtext. Nhanh nhất nhưng nhiều video nay chặn bằng PoToken. */
  async function viaTimedtext(playerResponse, langs) {
    const tracks =
      (playerResponse.captions &&
        playerResponse.captions.playerCaptionsTracklistRenderer &&
        playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks) ||
      [];
    // Nói rõ hỏng ở đâu thay vì trả null chung chung: bốn nguyên nhân dưới đây
    // cần bốn cách xử lý khác hẳn nhau, gộp lại thành "không có dữ liệu" là
    // người đọc log không lần ra được gì.
    if (!tracks.length) throw new Error('player response không khai caption track nào');

    const track = pickTrack(tracks, langs);
    if (!track) {
      throw new Error(
        `có ${tracks.length} caption track nhưng không track nào có baseUrl ` +
          `(${tracks.map((t) => t.languageCode || '?').join(', ')})`
      );
    }

    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set('fmt', 'json3');
    const res = await origFetch(url.toString(), { credentials: 'include' });
    const body = await res.text();

    if (!body.trim()) {
      const gated = /[?&]exp=xpe\b/.test(track.baseUrl);
      throw new Error(
        `timedtext trả body rỗng${gated ? ' (baseUrl có exp=xpe — bị PoToken chặn)' : ''}`
      );
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      throw new Error(`timedtext trả nội dung không phải JSON: ${body.slice(0, 80)}`);
    }
    const segments = (data.events || [])
      .filter((e) => e && e.segs)
      .map((e) => ({
        start: (e.tStartMs || 0) / 1000,
        end: ((e.tStartMs || 0) + (e.dDurationMs || 0)) / 1000,
        text: e.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim(),
      }))
      .filter((s) => s.text);
    if (!segments.length) throw new Error('timedtext trả JSON nhưng không có dòng nào');
    return { segments, method: `timedtext:${track.languageCode}${track.kind === 'asr' ? ':asr' : ''}` };
  }

  /** Đường B: InnerTube get_transcript — cùng nguồn dữ liệu mà panel "Show transcript" dùng. */
  async function viaTranscriptRpc(videoId) {
    const params = await transcriptParams(videoId);
    if (!params) return null;

    const json = await innertube('get_transcript', { params });
    const segments = deepCollect(json, (k, v) => (k === 'transcriptSegmentRenderer' && v ? v : null))
      .map((s) => ({
        start: Number(s.startMs || 0) / 1000,
        end: Number(s.endMs || 0) / 1000,
        text: runsText(s.snippet),
      }))
      .filter((s) => s.text);
    return segments.length ? { segments, method: 'innertube:get_transcript' } : null;
  }

  async function transcriptParams(videoId) {
    const pick = (data) => {
      const hits = deepCollect(data, (k, v) =>
        k === 'getTranscriptEndpoint' && v && v.params ? v.params : null
      );
      return hits[0] || null;
    };

    if (currentVideoId() === videoId && window.ytInitialData) {
      const p = pick(window.ytInitialData);
      if (p) return p;
    }
    const { data } = await fetchWatchPage(videoId);
    return pick(data);
  }

  function runsText(snippet) {
    if (!snippet) return '';
    if (snippet.simpleText) return String(snippet.simpleText).trim();
    return (snippet.runs || []).map((r) => r.text || '').join('').trim();
  }

  /* ------------------------------------------------------------------ */
  /* 6. Liệt kê playlist / kênh                                           */
  /* ------------------------------------------------------------------ */

  /** Huy hiệu "Private"/"Unlisted" gắn trên thẻ video trong playlist. */
  function privacyFromRenderer(renderer) {
    const labels = deepCollect(renderer, (k, v) =>
      k === 'metadataBadgeRenderer' && v ? String(v.label || v.tooltip || '') : null
    ).map((s) => s.toLowerCase());

    if (labels.some((l) => /private|riêng tư/.test(l))) return 'private';
    if (labels.some((l) => /unlisted|không công khai/.test(l))) return 'unlisted';
    return 'unknown';
  }

  function nextContinuation(json) {
    const tokens = deepCollect(json, (k, v) => {
      if (k !== 'continuationItemRenderer' || !v) return null;
      const cmd = v.continuationEndpoint && v.continuationEndpoint.continuationCommand;
      return (cmd && cmd.token) || null;
    });
    return tokens[0] || null;
  }

  /**
   * Duyệt hết một playlist qua InnerTube browse + continuation.
   *
   * Mọi thứ đều quy về playlist: kênh dùng playlist "uploads" (UC… -> UU…),
   * Xem sau là "WL", Đã thích là "LL". Nhờ vậy chỉ cần một đường code cho cả bốn
   * trường hợp thay vì mỗi loại một endpoint riêng.
   */
  async function playlistItems(playlistId, max) {
    const limit = Math.max(1, Number(max) || 500);
    const seenTokens = new Set();
    const seenVideos = new Set();
    const items = [];

    let json = await innertube('browse', { browseId: `VL${playlistId}` });

    for (let page = 0; page < 200; page++) {
      const renderers = deepCollect(json, (k, v) =>
        (k === 'playlistVideoRenderer' || k === 'playlistPanelVideoRenderer') && v && v.videoId ? v : null
      );

      for (const r of renderers) {
        if (seenVideos.has(r.videoId)) continue;
        seenVideos.add(r.videoId);
        items.push({
          videoId: r.videoId,
          title: runsText(r.title),
          channel: runsText(r.shortBylineText || r.longBylineText),
          durationSec: Number(r.lengthSeconds || 0) || 0,
          privacy: privacyFromRenderer(r),
          // Video private của người KHÁC vẫn nằm trong playlist nhưng ta không có
          // quyền xem, nên cũng không trích được transcript — đánh dấu để bỏ qua.
          accessible: r.isPlayable !== false,
        });
        if (items.length >= limit) return { items, truncated: true };
      }

      const token = nextContinuation(json);
      // Token lặp lại nghĩa là server không tiến thêm — thoát, đừng quay vòng vô tận.
      if (!token || seenTokens.has(token)) break;
      seenTokens.add(token);
      json = await innertube('browse', { continuation: token });
    }

    return { items, truncated: false };
  }

  function firstDeep(node, key, pick) {
    const hits = deepCollect(node, (k, v) => (k === key && v ? pick(v) : null));
    return hits.find((h) => h) || null;
  }

  /** Trang hiện tại có thể import hàng loạt từ nguồn nào? */
  function pageContext() {
    const u = new URL(location.href);
    const list = u.searchParams.get('list');
    const data = window.ytInitialData;

    if (u.pathname === '/playlist' && list) {
      const named = { WL: 'Xem sau', LL: 'Video đã thích' }[list];
      return {
        kind: 'playlist',
        playlistId: list,
        title: named || firstDeep(data, 'playlistHeaderRenderer', (v) => runsText(v.title)) || 'Playlist',
      };
    }

    // Playlist "RD…" là mix do YouTube tự sinh vô hạn, không phải danh sách thật.
    if (u.pathname === '/watch' && list && !/^RD/.test(list)) {
      return {
        kind: 'playlist',
        playlistId: list,
        title: firstDeep(data, 'playlistHeaderRenderer', (v) => runsText(v.title)) || 'Playlist của video này',
      };
    }

    if (/^\/(channel|c|user|@)/.test(u.pathname)) {
      const meta = document.querySelector('meta[itemprop="identifier"]');
      const channelId =
        firstDeep(data, 'channelMetadataRenderer', (v) => v.externalId) ||
        (meta && meta.getAttribute('content'));
      if (channelId && /^UC/.test(channelId)) {
        return {
          kind: 'channel',
          playlistId: `UU${channelId.slice(2)}`, // playlist "uploads" của kênh
          title: firstDeep(data, 'channelMetadataRenderer', (v) => v.title) || 'Kênh này',
        };
      }
    }

    return { kind: 'other' };
  }

  /* ------------------------------------------------------------------ */
  /* 7. Giao thức postMessage                                             */
  /* ------------------------------------------------------------------ */

  const handlers = {
    async meta({ videoId, noFallback }) {
      const id = videoId || currentVideoId();
      if (!id) throw new Error('Không xác định được videoId');
      return metaFrom(await getPlayerResponse(id, { noFallback: !!noFallback }));
    },

    async transcript({ videoId, langs }) {
      const id = videoId || currentVideoId();
      if (!id) throw new Error('Không xác định được videoId');
      const preferred = Array.isArray(langs) && langs.length ? langs : ['vi', 'en'];
      const playerResponse = await getPlayerResponse(id);
      const meta = metaFrom(playerResponse);
      const attempts = [];

      for (const [name, fn] of [
        ['innertube', () => viaTranscriptRpc(id)],
        ['timedtext', () => viaTimedtext(playerResponse, preferred)],
      ]) {
        try {
          const got = await fn();
          if (got) return Object.assign({ meta }, got);
          attempts.push(`${name}: không có dữ liệu`);
        } catch (e) {
          attempts.push(`${name}: ${(e && e.message) || e}`);
        }
      }
      return { meta, segments: [], method: null, attempts };
    },

    async playlist({ playlistId, max }) {
      if (!playlistId) throw new Error('Thiếu playlistId');
      return playlistItems(playlistId, max);
    },

    async context() {
      return pageContext();
    },
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__nblm !== REQ || !handlers[msg.op]) return;

    let payload = null;
    let error = null;
    try {
      payload = await handlers[msg.op](msg.args || {});
    } catch (e) {
      error = (e && e.message) || String(e);
    }
    window.postMessage({ __nblm: RES, id: msg.id, payload, error }, location.origin);
  });
})();
