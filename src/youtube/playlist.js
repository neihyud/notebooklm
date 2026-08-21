// Liệt kê cả playlist qua cầu MAIN world, và bảng xác nhận trước khi chạy — ticket 007.
//
// Đây là **mục đích** của cầu MAIN world (ADR 0003): InnerTube trả về cả playlist bất kể
// trang đã cuộn tới đâu, nên "import 300 video" không còn là "cuộn cho hết rồi quét DOM".
// Cầu chỉ chuyển đúng một lượt gọi mỗi lần — phân trang và bóc dữ liệu nằm ở đây, phía
// ISOLATED world, để `page-bridge.js` không phải rộng thêm ra (`WORKSPACE_PROTOCOL.md`).
//
// Không có DOM và không có `chrome.*` trong file này: nó nhận một adapter `request` và trả
// dữ liệu thuần, nên toàn bộ đường đi kiểm được bằng phản hồi InnerTube giả —
// `test/playlist.test.js`. Phần chạm trang nằm ở `src/youtube/playlist-bar.js`.
(function (root) {
  'use strict';

  if (root.NBLM_PLAYLIST) return;

  const S = root.NBLM_SHARED;
  const Y = root.NBLM_YT_SELECTORS;
  const P = root.NBLM_BRIDGE_PROTOCOL;
  const T = root.NBLM_TRANSCRIPT;
  if (!S) throw new Error('youtube/playlist: cần src/common/shared.js nạp trước');
  if (!Y) throw new Error('youtube/playlist: cần src/youtube/selectors.js nạp trước');
  if (!P) throw new Error('youtube/playlist: cần src/youtube/bridge-protocol.js nạp trước');
  if (!T) throw new Error('youtube/playlist: cần src/youtube/transcript.js nạp trước');

  /** InnerTube gọi một playlist là `VL<id>` ở `browseId`. `WL` → `VLWL`, `LL` → `VLLL`. */
  const BROWSE_PREFIX = 'VL';

  /**
   * Trần số trang phân tới. InnerTube trả 100 mục mỗi trang, nên 200 trang là 20 nghìn video
   * — xa hơn mọi playlist thật. Nó ở đây để một token phân trang lặp vô hạn thành một lần
   * chạy *có kết thúc*, không thành một tab treo cứng.
   */
  const MAX_PAGES = 200;

  const ITEM_RENDERER = 'playlistVideoRenderer';
  const CONTINUATION_RENDERER = 'continuationItemRenderer';

  /**
   * Hai nhóm mục **cùng kiểu** mà hoán vị nhau vẫn ra một bảng xác nhận trông hợp lệ:
   *
   *   - `IMPORTABLE` gồm cả video **private của chính người dùng** — họ xem được, nên đường
   *     DOM trích được (ADR 0003). Đây là đúng cái tính năng này sinh ra để làm.
   *   - `UNAVAILABLE` là mục người dùng **không có quyền xem**: private của người khác, video
   *     đã xoá. Trích chắc chắn hỏng, nên nó không được vào hàng đợi.
   *
   * Hoán vị hai nhóm vẫn giữ nguyên tổng số mục và nguyên con số ước lượng, nhưng đổi hẳn
   * cái gì được import: video riêng của người dùng bị bỏ im lặng, còn mục không xem được thì
   * xếp hàng để hỏng. `test/playlist.test.js` chốt đúng chỗ này.
   */
  const STATUS = Object.freeze({ IMPORTABLE: 'importable', UNAVAILABLE: 'unavailable' });

  const selectorsOf = (options) => {
    const given = options && options.selectors;
    if (!given) return Y.DEFAULT;
    return typeof given.css === 'function' ? given : Y.resolve(given);
  };

  // ------------------------------------------------------------------ đọc JSON InnerTube

  /**
   * Mọi giá trị nằm dưới khoá `key`, ở bất kỳ độ sâu nào.
   *
   * Đi bộ cả cây thay vì men theo đường
   * `contents.twoColumnBrowseResultsRenderer.tabs[0].…`: đường ấy khác nhau giữa trang đầu và
   * trang phân tiếp, khác nhau giữa playlist và kênh, và YouTube đổi nó mà không báo ai. Sai
   * một mắt xích thì triệu chứng là "playlist rỗng" — không phải một lỗi đọc ra được.
   */
  function collect(node, key, out, depth) {
    const bag = out || [];
    const level = depth || 0;
    if (!node || typeof node !== 'object' || level > 30) return bag;
    if (Array.isArray(node)) {
      for (const value of node) collect(value, key, bag, level + 1);
      return bag;
    }
    for (const [name, value] of Object.entries(node)) {
      if (name === key) bag.push(value);
      else collect(value, key, bag, level + 1);
    }
    return bag;
  }

  /** Chữ của InnerTube: `{simpleText}`, `{runs:[{text}]}`, hoặc chuỗi trần — cả ba đều gặp. */
  function textOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return S.collapse(value);
    if (typeof value !== 'object') return '';
    if (typeof value.simpleText === 'string') return S.collapse(value.simpleText);
    if (Array.isArray(value.runs)) return S.collapse(value.runs.map((run) => (run && run.text) || '').join(''));
    if (value.content) return textOf(value.content);
    return '';
  }

  /**
   * Thời lượng của một mục. `lengthSeconds` trước, `lengthText` sau: chuỗi `3:32` phải qua
   * một lần parse nữa, và ước lượng số Nguồn cộng thẳng những con số này (ADR 0008).
   */
  function durationOf(renderer) {
    const seconds = Number(renderer.lengthSeconds);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
    return T.parseClock(textOf(renderer.lengthText));
  }

  /**
   * Mức riêng tư đọc từ huy hiệu của InnerTube. Nhãn chữ lấy ở `selectors.js` chứ không chép
   * lại: đó là cùng bộ nhãn mà `readPrivacy` của trang watch đang dùng, và người dùng ghi đè
   * được từ trang Cài đặt khi YouTube đổi chữ.
   *
   * Đây là **trục khác** với `status`: mức riêng tư nói nội dung thuộc loại nào, `isPlayable`
   * nói người dùng có xem được không. Video private của chính mình là `private` **và** xem
   * được — trộn hai trục làm một là đúng cái lỗi mà `STATUS` ở trên mô tả.
   */
  function privacyOf(renderer, options) {
    const sel = selectorsOf(options);
    const has = (key, label) => sel.label(key).some((known) => label === known);
    for (const badge of collect(renderer.badges || [], 'metadataBadgeRenderer')) {
      const icon = String((badge && badge.icon && badge.icon.iconType) || '');
      const label = S.foldLabel(textOf(badge && badge.label));
      if (icon === 'PRIVACY_PRIVATE' || has('privacyPrivate', label)) return 'private';
      if (icon === 'PRIVACY_UNLISTED' || has('privacyUnlisted', label)) return 'unlisted';
    }
    return 'public';
  }

  /**
   * Một `playlistVideoRenderer` thành một mục của bảng xác nhận, hoặc `null` nếu không đọc
   * được videoId — mục không có danh tính thì không vào hàng đợi được (`runQueue` loại nó ở
   * cửa vào), nên loại ngay ở đây, trước khi nó kịp làm lệch một con số nào.
   *
   * `url` dựng từ `videoId` chứ không lấy `navigationEndpoint` của trang: url là **danh
   * tính**, thứ `contextHeader` in thành `- Link gốc:` để người đọc nhấn vào mà kiểm chứng
   * một trích dẫn (bài học `mergeMeta`, ticket 005). Endpoint của InnerTube còn mang theo
   * `list=` và `index=` của playlist, tức một link trỏ về *vị trí trong playlist* chứ không
   * về video.
   */
  function readItem(renderer, options) {
    const r = renderer && typeof renderer === 'object' ? renderer : {};
    const id = S.parseVideoId(S.collapse(r.videoId));
    if (!id) return null;

    const title = textOf(r.title);
    const playable = r.isPlayable !== false;
    const item = {
      id,
      kind: 'video',
      title,
      channel: textOf(r.shortBylineText) || textOf(r.longBylineText),
      url: `https://www.youtube.com/watch?v=${id}`,
      durationSeconds: durationOf(r),
      privacy: privacyOf(r, options),
      status: playable ? STATUS.IMPORTABLE : STATUS.UNAVAILABLE,
    };
    if (!playable) item.reason = title ? `không có quyền xem (${title})` : 'không có quyền xem';
    return item;
  }

  /** Token phân trang của trang vừa đọc, hoặc chuỗi rỗng khi đã hết. */
  function continuationOf(response) {
    for (const renderer of collect(response, CONTINUATION_RENDERER)) {
      const command = renderer && renderer.continuationEndpoint && renderer.continuationEndpoint.continuationCommand;
      const token = command && command.token;
      if (typeof token === 'string' && token) return token;
    }
    return '';
  }

  /** Tên playlist. Ba chỗ vì trang đầu, header cũ và header mới không cùng một hình dạng. */
  function titleOf(response) {
    for (const key of ['playlistMetadataRenderer', 'playlistHeaderRenderer', 'pageHeaderRenderer']) {
      for (const node of collect(response, key)) {
        const title = textOf(node && node.title) || textOf(node && node.pageTitle);
        if (title) return title;
      }
    }
    return '';
  }

  /** Một phản hồi InnerTube thành (tên playlist, mục, token trang kế). */
  function readPlaylistPage(response, options) {
    return {
      title: titleOf(response),
      items: collect(response, ITEM_RENDERER).map((r) => readItem(r, options)).filter(Boolean),
      continuation: continuationOf(response),
    };
  }

  // ------------------------------------------------------------------ địa chỉ

  function browseIdFor(playlistId) {
    const id = S.parsePlaylistId(playlistId);
    if (!id) throw new Error(`liệt kê playlist: id không đọc được: ${String(playlistId)}`);
    return `${BROWSE_PREFIX}${id}`;
  }

  /**
   * Playlist "mọi video đã tải lên" của một kênh: `UC…` → `UU…`. Đó là cách duy nhất liệt kê
   * cả kênh bằng đúng một đường mà playlist đang dùng, thay vì một đường thứ hai cho kênh.
   */
  function uploadsPlaylistId(channelId) {
    const id = S.collapse(channelId);
    if (!/^UC[A-Za-z0-9_-]{2,}$/.test(id)) return null;
    return `UU${id.slice(2)}`;
  }

  const CHANNEL_SEGMENTS = new Set(['channel', 'c', 'user']);

  /**
   * Trang đang mở có phải chỗ để "Import toàn bộ" không, và của cái gì.
   *
   * Trang watch **không** tính, kể cả khi nó mang `&list=…`: ở đó người dùng đang xem một
   * video, và thanh nổi kèm checkbox trên từng thumbnail sẽ tick lên các video gợi ý ở
   * sidebar. Nút của trang watch là nút import một video (ticket 005).
   */
  function pageTarget(url) {
    let parsed;
    try {
      parsed = new URL(S.collapse(url));
    } catch {
      return null;
    }
    if (!/(^|\.)youtube\.com$/.test(parsed.hostname.toLowerCase())) return null;

    // Định tuyến theo **đoạn path**, không theo tham số truy vấn: `/watch?v=…&list=…` là một
    // trang watch dù nó mang `list=`, nên nó rơi xuống `return null` ở cuối chứ không thành
    // một mục tiêu playlist. Một điều kiện `if (parseVideoId(url)) return null` thêm ở đây chỉ
    // là lớp thứ hai cho cùng một việc — và một lớp không bao giờ chạy là một lớp không ai
    // biết là đã hỏng.
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] === 'playlist') {
      const playlistId = S.parsePlaylistId(parsed.href);
      return playlistId ? { kind: 'playlist', playlistId, channelId: '' } : null;
    }
    if (segments[0] && segments[0].startsWith('@')) return { kind: 'channel', playlistId: '', channelId: '' };
    if (CHANNEL_SEGMENTS.has(segments[0])) {
      const channelId = segments[0] === 'channel' ? S.collapse(segments[1]) : '';
      return { kind: 'channel', playlistId: '', channelId };
    }
    return null;
  }

  // ------------------------------------------------------------------ phân trang

  /**
   * Liệt kê tới hết playlist. Mỗi lượt là một lượt gọi cầu; cầu chỉ biết chuyển một lượt,
   * nên vòng lặp nằm ở đây.
   *
   * Ba thứ cùng canh việc "chạy hết": trần số trang, sổ token đã dùng, và sổ videoId đã thấy.
   * Cái quan trọng là `complete` trong kết quả — một danh sách bị cắt ngắn *im lặng* trông y
   * hệt một playlist ngắn, và cả tính năng này dựng trên lời hứa "lấy đủ bất kể đã cuộn tới
   * đâu".
   */
  async function listPlaylist(config) {
    const cfg = config || {};
    const playlistId = S.parsePlaylistId(cfg.playlistId);
    if (!playlistId) throw new Error(`liệt kê playlist: id không đọc được: ${String(cfg.playlistId)}`);
    if (typeof cfg.request !== 'function') throw new Error('liệt kê playlist: thiếu cầu MAIN world');
    const maxPages = Number(cfg.maxPages) > 0 ? Number(cfg.maxPages) : MAX_PAGES;

    const items = [];
    const seenIds = new Set();
    const seenTokens = new Set();
    let title = '';
    let continuation = '';
    let pages = 0;

    while (pages < maxPages) {
      const params = continuation ? { continuation } : { browseId: browseIdFor(playlistId) };
      const page = readPlaylistPage(await cfg.request(P.LIST_PLAYLIST, params), cfg.options);
      pages += 1;
      if (!title && page.title) title = page.title;

      let added = 0;
      for (const item of page.items) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        items.push(item);
        added += 1;
      }

      const next = page.continuation;
      // Hết token là hết thật. Token lặp lại, hoặc một trang không thêm được mục nào, là
      // vòng lặp — dừng lại và **nói ra** bằng `complete: false`.
      if (!next || seenTokens.has(next)) {
        continuation = seenTokens.has(next) ? next : '';
        break;
      }
      seenTokens.add(next);
      continuation = next;
      if (added === 0) break;
    }

    return { playlistId, title: title || playlistId, items, pages, complete: !continuation };
  }

  // ------------------------------------------------------------------ bảng xác nhận

  /**
   * Bảng xác nhận trước khi chạy (ADR 0005): bao nhiêu video, bao nhiêu là private của chính
   * người dùng, bao nhiêu bị bỏ vì không có quyền xem, và **ước lượng tốn bao nhiêu Nguồn**.
   *
   * Ước lượng tính từ tổng thời lượng của riêng những mục sẽ thật sự import — số từ chỉ biết
   * sau khi trích, mà bảng này phải hiện ra *trước* khi trích mục nào (ADR 0008). Cộng cả mục
   * không xem được vào là ước lượng một thứ sẽ không bao giờ được trích.
   */
  function confirmation(list, options) {
    const items = (list || []).filter(Boolean);
    const importable = items.filter((i) => i.status !== STATUS.UNAVAILABLE);
    const unavailable = items.filter((i) => i.status === STATUS.UNAVAILABLE);
    const privateOwned = importable.filter((i) => i.privacy === 'private');
    const unlisted = importable.filter((i) => i.privacy === 'unlisted');
    const estimate = S.estimateSources(importable, options);

    const lines = [`${items.length} video trong danh sách, ${importable.length} sẽ import.`];
    if (privateOwned.length) lines.push(`${privateOwned.length} video private của bạn — trích bằng đường DOM.`);
    if (unlisted.length) lines.push(`${unlisted.length} video không công khai.`);
    if (unavailable.length) lines.push(`${unavailable.length} mục bỏ vì không có quyền xem.`);
    lines.push(estimate.label);

    return {
      counts: {
        total: items.length,
        importable: importable.length,
        privateOwned: privateOwned.length,
        unlisted: unlisted.length,
        unavailable: unavailable.length,
        estimatedSources: estimate.sources,
      },
      importable,
      unavailable,
      privateOwned,
      estimate,
      lines,
    };
  }

  // ------------------------------------------------------------------ Mục hàng đợi

  /**
   * Nguồn gộp của một playlist: khoá theo **id**, tên theo **tiêu đề**.
   *
   * Hai vế cố ý khác nhau. Khoá là thứ ADR 0009 dùng để biết lần này là *import lại* (sinh
   * `— bổ sung N`) hay *chạy tiếp*; nó phải sống sót qua một lần người dùng đổi tên playlist.
   * Tên thì phải tự mô tả cho người đọc trích dẫn, nên nó là tiêu đề — và chỉ suy từ (nguồn
   * gốc, chỉ số phần), không mẫu số, không ngày giờ (ADR 0010).
   */
  function groupFor(playlistId, title) {
    const id = S.parsePlaylistId(playlistId);
    if (!id) throw new Error(`Nguồn gộp: playlist id không đọc được: ${String(playlistId)}`);
    return { kind: 'playlist', key: `playlist:${id}`, source: S.collapse(title) || id };
  }

  /**
   * Mục hàng đợi cho engine. Mục không có quyền xem **không** đi qua đây: chúng đã có một
   * dòng trong bảng xác nhận, và xếp chúng vào hàng đợi chỉ để rớt ở khâu trích là đổi một
   * bảng tổng kết đọc được lấy vài chục lượt gọi mạng chắc chắn hỏng.
   */
  function queueItems(list, group) {
    const g = group || {};
    const source = S.collapse(g.source);
    const key = S.collapse(g.key);
    if (!source) throw new Error('queueItems: thiếu tên playlist để đặt tên Nguồn gộp');
    if (!key) throw new Error('queueItems: thiếu khoá Nguồn gộp');
    const bundle = { kind: 'playlist', key, source };

    return (list || [])
      .filter((i) => i && i.status !== STATUS.UNAVAILABLE)
      .map((i) => ({
        id: i.id,
        kind: 'video',
        url: i.url,
        title: i.title,
        channel: i.channel,
        privacy: i.privacy,
        durationSeconds: i.durationSeconds,
        group: bundle,
      }));
  }

  root.NBLM_PLAYLIST = Object.freeze({
    BROWSE_PREFIX,
    MAX_PAGES,
    STATUS,
    collect,
    textOf,
    readItem,
    readPlaylistPage,
    browseIdFor,
    uploadsPlaylistId,
    pageTarget,
    listPlaylist,
    confirmation,
    groupFor,
    queueItems,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
