// Hằng số và hàm thuần dùng chung — Seam 1 của spec 0001.
//
// File này là classic script, không phải ES module: content script của Manifest V3 không nạp
// được `import`, và manifest xếp thứ tự nạp theo chuỗi phụ thuộc. Vì vậy API gắn vào
// `globalThis.NBLM_SHARED`; test ở `test/shared.test.js` import lấy side effect rồi đọc ra.
//
// Ở đây chỉ có hàm thuần: không chạm `chrome.*`, không chạm DOM, không đọc đồng hồ. Đó là
// điều kiện để test gọi thẳng.
(function (root) {
  'use strict';

  if (root.NBLM_SHARED) return; // content script có thể bị tiêm hai lần trên cùng một tab

  // ------------------------------------------------------------------ hằng số

  /** Tiền tố của mọi id do extension tạo, để hàm dò phần tử loại được giao diện của chính mình. */
  const EXT_PREFIX = 'nblm-';

  /** Trần của NotebookLM cho một Nguồn. Giống nhau ở mọi gói. */
  const MAX_WORDS_PER_SOURCE = 500000;

  const DEFAULTS = Object.freeze({
    downloadDir: 'Transcript YouTube',
    transcriptFormat: 'md',
    mergeWindowSeconds: 30,
    maxWordsPerSource: MAX_WORDS_PER_SOURCE,
    docsMinChars: 600,
    // Tốc độ nói trung bình, dùng để ước lượng số Nguồn từ tổng thời lượng (ADR 0008).
    wordsPerMinute: 150,
  });

  const LEDGER_SEP = '::';

  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{2,}$/;
  const BARE_PLAYLIST_RE = /^(?:WL|LL|(?:PL|UU|OL|RD|FL|SP|TL)[A-Za-z0-9_-]{2,})$/;

  const YT_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'gaming.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
  ]);
  const YT_SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
  /** Những đoạn path mà videoId đứng ngay sau: /embed/ID, /shorts/ID… */
  const VIDEO_PATH_PREFIXES = new Set(['embed', 'v', 'e', 'shorts', 'live']);
  /** `/embed/videoseries?list=…` là embed cả playlist — và dài đúng 11 ký tự như một videoId. */
  const NOT_A_VIDEO_ID = new Set(['videoseries']);

  // ------------------------------------------------------------- tiện ích nhỏ

  const str = (value) => (typeof value === 'string' ? value : '');
  const collapse = (value) => str(value).replace(/\s+/g, ' ').trim();

  /** Số dương dùng được, hoặc 0. Dùng cho cả mốc thời gian lẫn số từ. */
  function positiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // -------------------------------------------------------- YouTube: bóc id

  function asVideoId(candidate) {
    const id = candidate || '';
    if (NOT_A_VIDEO_ID.has(id)) return null;
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  /**
   * Bóc videoId từ mọi định dạng URL YouTube, hoặc từ chính một videoId trần.
   * Trả `null` khi không chắc — thà không nhận còn hơn nhận nhầm id của host khác.
   */
  function parseVideoId(input) {
    const raw = str(input).trim();
    if (!raw) return null;
    if (VIDEO_ID_RE.test(raw)) return asVideoId(raw);

    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);

    if (YT_SHORT_HOSTS.has(host)) {
      return asVideoId(segments[0]);
    }
    if (!YT_HOSTS.has(host)) return null;

    if (segments.length >= 2 && VIDEO_PATH_PREFIXES.has(segments[0])) {
      return asVideoId(segments[1]);
    }

    return asVideoId(url.searchParams.get('v'));
  }

  /**
   * Bóc playlist id. `WL` (Xem sau) và `LL` (Video đã thích) là id hợp lệ dù không có tiền tố
   * `PL` — một điều kiện kiểu `^PL` sẽ loại oan đúng hai playlist người dùng hay import nhất.
   */
  function parsePlaylistId(input) {
    const raw = str(input).trim();
    if (!raw) return null;
    if (BARE_PLAYLIST_RE.test(raw)) return raw;

    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    const host = url.hostname.toLowerCase();
    if (!YT_HOSTS.has(host) && !YT_SHORT_HOSTS.has(host)) return null;

    const list = url.searchParams.get('list') || '';
    return PLAYLIST_ID_RE.test(list) ? list : null;
  }

  // --------------------------------------------------- NotebookLM: bóc notebookId

  /**
   * Hai host của **cùng một sản phẩm**. Google đổi tên NotebookLM thành "Gemini Notebook"
   * (2026-07-16): `notebooklm.google.com` 302 sang `notebook.google.com`, và `batchexecute`
   * dual-serve trên cả hai. Việc chuyển chạy theo cohort, nên cùng một lúc có tài khoản còn ở
   * host cũ, tài khoản đã sang host mới. Nhận thiếu một trong hai thì với đúng nhóm tài khoản
   * kia, content script không nạp và cả đường đẩy **im lặng** không làm gì.
   *
   * Thứ tự có nghĩa: phần tử đầu là host mà extension tự mở tab tới (`notebookUrl`). Chiều
   * redirect chỉ có một — host cũ dẫn sang host mới cho tài khoản đã chuyển, chiều ngược lại
   * không có gì bảo đảm.
   */
  const NOTEBOOK_HOSTS = Object.freeze(['notebooklm.google.com', 'notebook.google.com']);
  const NOTEBOOK_HOST_SET = new Set(NOTEBOOK_HOSTS);

  /**
   * Mẫu host cho `host_permissions`, `content_scripts.matches` và `chrome.tabs.query` — suy từ
   * đúng danh sách trên. Ba chỗ ấy phải nhắc tới cùng một tập host: khai ở chỗ này mà quên chỗ
   * kia là hỏng lặng, và `test/manifest.test.js` đối chiếu cả ba với hằng số này.
   */
  const NOTEBOOK_MATCH_PATTERNS = Object.freeze(NOTEBOOK_HOSTS.map((host) => `https://${host}/*`));

  const NOTEBOOK_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

  /** URL của một notebook, dùng khi phải mở tab mới. */
  const notebookUrl = (notebookId) => `https://${NOTEBOOK_HOSTS[0]}/notebook/${str(notebookId)}`;

  /**
   * Bóc id Notebook đích từ URL của tab NotebookLM đang mở.
   *
   * Đây là khoá của Sổ đã import (ADR 0006), nên nhận nhầm còn tệ hơn không nhận: một chuỗi
   * lạ vẫn dựng được khoá "hợp lệ", và chống trùng lặp sai *âm thầm*. Vì vậy chỉ đúng host
   * NotebookLM — một trong `NOTEBOOK_HOSTS` — và đúng đoạn path `notebook/<id>` mới được nhận.
   */
  function parseNotebookId(input) {
    const raw = str(input).trim();
    if (!raw) return null;

    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!NOTEBOOK_HOST_SET.has(url.hostname.toLowerCase())) return null;

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'notebook') return null;
    return NOTEBOOK_ID_RE.test(segments[1] || '') ? segments[1] : null;
  }

  // ------------------------------------------------------------ khử trùng lặp

  /** Giữ lần xuất hiện đầu tiên, giữ nguyên thứ tự vào. */
  function dedupe(list, keyFn) {
    const key = typeof keyFn === 'function' ? keyFn : (item) => item;
    const seen = new Set();
    const out = [];
    for (const item of list || []) {
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return out;
  }

  // ------------------------------------------------------- bỏ dấu tiếng Việt

  /**
   * Bỏ dấu, giữ nguyên hoa/thường. `đ`/`Đ` không phải chữ có dấu mà là chữ cái riêng, nên
   * `normalize('NFD')` không đụng tới nó — phải thay tay.
   */
  function deaccent(value) {
    return str(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  /** Dạng dùng để so khớp: chữ thường, không dấu, khoảng trắng gộp lại. */
  function foldLabel(value) {
    return collapse(deaccent(value)).toLowerCase();
  }

  // -------------------------------------------------------- mốc thời gian

  /** `[mm:ss]` dưới một giờ, `[h:mm:ss]` từ một giờ trở lên. */
  function stamp(seconds) {
    const total = Math.floor(positiveNumber(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `[${h}:${pad(m)}:${pad(s)}]` : `[${pad(m)}:${pad(s)}]`;
  }

  /**
   * Gộp segment phụ đề thành dòng theo cửa sổ thời gian.
   * Mốc của dòng là start của segment **mở** cửa sổ — lấy start của segment cuối thì mọi mốc
   * trong nguồn lệch về sau, mà file vẫn trông hợp lệ.
   */
  function mergeSegments(segments, windowSeconds) {
    const width = positiveNumber(windowSeconds);
    const out = [];
    let current = null;

    for (const segment of segments || []) {
      if (!segment) continue;
      const text = collapse(segment.text);
      if (!text) continue;
      const start = positiveNumber(segment.start);

      if (current && width > 0 && start - current.start < width) {
        current.text += ` ${text}`;
        continue;
      }
      current = { start, text };
      out.push(current);
    }
    return out;
  }

  // ------------------------------------------------- header ngữ cảnh + thân Nguồn

  /**
   * Header ngữ cảnh của một Nguồn. Với Nguồn gộp, trích dẫn của NotebookLM chỉ tên được cả
   * nguồn gộp, nên tiêu đề/kênh/link gốc của từng video phải nằm ngay trong thân (ADR 0002).
   */
  function contextHeader(meta) {
    const m = meta || {};
    const lines = [];
    const title = collapse(m.title);
    const channel = collapse(m.channel);
    const url = collapse(m.url);
    const privacy = collapse(m.privacy);
    const duration = positiveNumber(m.durationSeconds);

    if (title) lines.push(`# ${title}`);
    if (channel) lines.push(`- Kênh: ${channel}`);
    if (url) lines.push(`- Link gốc: ${url}`);
    // `Number(null) === 0`, nên chỉ kiểm "hữu hạn" là in ra một thời lượng không ai đo được.
    if (duration > 0) lines.push(`- Thời lượng: ${stamp(duration)}`);
    if (privacy) lines.push(`- Mức riêng tư: ${privacy}`);
    return lines.join('\n');
  }

  /** Thân một Nguồn: header ngữ cảnh, rồi từng dòng transcript kèm mốc. */
  function sourceBody(meta, lines) {
    const header = contextHeader(meta);
    const body = (lines || [])
      .filter((line) => line && collapse(line.text))
      .map((line) => `${stamp(line.start)} ${collapse(line.text)}`)
      .join('\n');
    if (!header) return body;
    if (!body) return header;
    return `${header}\n\n${body}`;
  }

  function countWords(text) {
    const t = collapse(text);
    return t ? t.split(' ').length : 0;
  }

  // ------------------------------------------------------------ gói Nguồn gộp

  /**
   * Gom các phần lại thành ít Nguồn nhất có thể, chốt một Nguồn ngay khi phần kế tiếp làm nó
   * vượt trần (ADR 0005, ADR 0008) — không đợi biết tổng số phần.
   *
   * Bất biến: mọi phần vào đều ra, đúng một lần, đúng thứ tự. Gộp nguồn khiến mất một mục
   * thành vô hình, nên phần đơn lẻ vượt trần vẫn được giữ trong Nguồn riêng và đánh dấu
   * `overflow` để bảng tổng kết nói ra được, thay vì lặng lẽ bỏ.
   */
  function packSources(parts, options) {
    const max = positiveNumber(options && options.maxWords) || MAX_WORDS_PER_SOURCE;
    const packs = [];
    let current = null;

    for (const item of parts || []) {
      if (!item) continue;
      const words = Number.isFinite(Number(item.words)) && item.words != null
        ? Number(item.words)
        : countWords(item.text);

      if (current && current.words + words > max) current = null; // chốt Nguồn đang gom
      if (!current) {
        current = { items: [], words: 0 };
        packs.push(current);
      }

      current.items.push(item);
      current.words += words;

      if (current.words > max) {
        current.overflow = true; // một mình đã vượt trần
        current = null;
      }
    }
    return packs;
  }

  /**
   * Tên Nguồn gộp, suy từ (nguồn gốc, chỉ số phần) và chỉ từ đó (ADR 0010). Không mẫu số:
   * lúc chốt phần 1 chưa ai biết sẽ có mấy phần, mà Nguồn đã đẩy đi thì không sửa được nữa.
   */
  function bundleName(spec) {
    const { kind, source, part, branch } = spec || {};
    const name = collapse(source);
    if (!name) throw new Error('bundleName: thiếu tên nguồn gốc');

    if (kind === 'docs') {
      const branchName = collapse(branch);
      if (!branchName) throw new Error('bundleName: thiếu tên Nhánh tài liệu');
      return `${name} — ${branchName}`;
    }

    const index = Number(part);
    if (!Number.isInteger(index) || index < 1) {
      throw new Error(`bundleName: chỉ số phần không hợp lệ: ${String(part)}`);
    }
    if (kind === 'playlist') return `${name} — phần ${index}`;
    if (kind === 'supplement') return `${name} — bổ sung ${index}`;
    throw new Error(`bundleName: loại Nguồn gộp lạ: ${String(kind)}`);
  }

  // -------------------------------------------- ước lượng số Nguồn trước khi chạy

  /**
   * Ước lượng số Nguồn một playlist sẽ tốn, **từ tổng thời lượng** — số từ chỉ biết sau khi
   * trích, mà bảng xác nhận phải nói ra con số trước khi trích mục nào (ADR 0005, 0008).
   *
   * Ở Seam 1 chứ không ở engine: bảng xác nhận được vẽ trên chính tab YouTube, nơi engine
   * hàng đợi không được nạp — và ước lượng là hàm thuần của (thời lượng, tốc độ nói, trần
   * mỗi Nguồn), không cần biết gì về một lượt chạy.
   *
   * Trả về `approximate: true` và một nhãn mang dấu `≈`: đây là ước lượng, và nó phải được
   * trình bày đúng như một ước lượng. `unknownDurations` là số mục không biết thời lượng —
   * chúng không vào ước lượng, nên người đọc cần thấy con số đó ngay cạnh.
   */
  function estimateSources(items, options) {
    const opts = options || {};
    const perMinute = Number(opts.wordsPerMinute) || DEFAULTS.wordsPerMinute;
    const max = Number(opts.maxWords) || DEFAULTS.maxWordsPerSource;
    const list = (items || []).filter(Boolean);

    let totalSeconds = 0;
    let unknownDurations = 0;
    for (const item of list) {
      const seconds = Number(item.durationSeconds);
      if (Number.isFinite(seconds) && seconds > 0) totalSeconds += seconds;
      else unknownDurations += 1;
    }

    const estimatedWords = Math.round((totalSeconds / 60) * perMinute);
    const sources = list.length === 0 ? 0 : Math.max(1, Math.ceil(estimatedWords / max));

    return {
      approximate: true,
      basis: 'duration',
      items: list.length,
      totalSeconds,
      estimatedWords,
      unknownDurations,
      sources,
      label: `≈ ${sources} Nguồn (ước lượng từ tổng thời lượng ${stamp(totalSeconds)}`
        + `${unknownDurations ? `, ${unknownDurations} mục chưa biết thời lượng` : ''})`,
    };
  }

  // ------------------------------------------------- khoá Sổ đã import (ADR 0006)

  /**
   * Khoá của Sổ đã import: cặp (mục, Notebook đích), **đúng thứ tự đó**.
   *
   * Hoán vị hai vế vẫn cho một chuỗi trông hợp lệ, nên hỏng ở đây không có triệu chứng: lần
   * chạy đầu vẫn đúng, chỉ chống trùng lặp là sai. Mã hoá từng vế để một mục là URL (có `:`,
   * `/`, `#`) không giả mạo được dấu phân cách.
   */
  function ledgerKey(itemId, notebookId) {
    const item = collapse(itemId);
    const notebook = collapse(notebookId);
    if (!item) throw new Error('ledgerKey: thiếu mục');
    if (!notebook) throw new Error('ledgerKey: thiếu Notebook đích');
    return `${encodeURIComponent(item)}${LEDGER_SEP}${encodeURIComponent(notebook)}`;
  }

  // ------------------------------------------------- chuẩn hoá URL tài liệu

  const trimTrailingSlash = (value) => (value.length > 1 ? value.replace(/\/+$/, '') : value);

  /**
   * Định danh một trang tài liệu — đây là khoá khử trùng lặp của hàng đợi tài liệu, nên hai
   * cách viết của cùng một trang phải ra cùng một chuỗi, nếu không trang đó vào Nguồn gộp hai
   * lần và tiêu quota hai lần.
   *
   * `scheme` lấy theo trang đang mở chứ không ép về https: docs nội bộ chỉ chạy http thì ép
   * https là fetch hỏng.
   */
  function docIdentity(url, scheme) {
    const protocol = scheme || url.protocol;
    const path = trimTrailingSlash(url.pathname);
    // `#/guide/intro` kiểu docsify: hash *chính là* đường dẫn trang, phải giữ.
    // `#cai-dat`: neo trong trang, cùng một trang — bỏ đi thì hai link trỏ về một chỗ trùng nhau.
    const hash = url.hash.startsWith('#/') ? trimTrailingSlash(url.hash) : '';
    return `${protocol}//${url.host}${path}${url.search}${hash}`;
  }

  /**
   * Định danh trang của một URL đứng **một mình** — không có trang gốc nào để giải tương đối.
   *
   * `normalizeDocUrl` trả `null` cho cả ba chuyện khác hẳn nhau (khác host, giao thức lạ, trỏ
   * về chính trang gốc), nên nó không dùng làm phép so "hai URL này có cùng một trang không".
   * Đây là hàm cho việc đó, và nó dùng chung đúng `docIdentity` ở trên: hai cách viết của cùng
   * một trang phải ra cùng một chuỗi ở *mọi* chỗ trong repo, nếu không khoá khử trùng lặp và
   * phép so của nấc 2 lệch nhau — mà lệch thì không có triệu chứng nào.
   */
  function docPageId(input) {
    const raw = collapse(input);
    if (!raw) return '';
    let url;
    try {
      url = new URL(raw);
    } catch {
      return '';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return docIdentity(url, url.protocol);
  }

  /**
   * Hai URL có trỏ về **cùng một trang tài liệu** không.
   *
   * Bỏ qua `http` ↔ `https`, và chỉ chỗ này bỏ qua: nâng cấp giao thức là chuyện máy chủ tự
   * làm giữa lúc điều hướng, nên coi nó là hai trang khác nhau sẽ từ chối oan mọi trang docs
   * chạy http. Khác host, khác đường dẫn, khác hash-route thì vẫn là hai trang — đó là thứ
   * phép so này sinh ra để chốt: nội dung đọc được phải thuộc về đúng URL đã yêu cầu.
   */
  function sameDocPage(a, b) {
    const left = docPageId(a);
    const right = docPageId(b);
    if (!left || !right) return false;
    const bare = (id) => id.replace(/^https?:/, '');
    return bare(left) === bare(right);
  }

  /**
   * Chuẩn hoá một link trong trang tài liệu về định danh trang, hoặc `null` nếu không phải
   * link điều hướng: khác host, giao thức lạ, hoặc neo trỏ về chính trang đang mở (mục lục
   * "On this page" toàn loại này — import vào là nhân bản trùng lặp).
   */
  function normalizeDocUrl(href, baseUrl) {
    const raw = collapse(href);
    if (!raw) return null;

    let base = null;
    let url;
    try {
      if (baseUrl) base = new URL(baseUrl);
      url = base ? new URL(raw, base) : new URL(raw);
    } catch {
      return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (base && url.host !== base.host) return null;

    const scheme = base ? base.protocol : url.protocol;
    const identity = docIdentity(url, scheme);
    if (base && identity === docIdentity(base, scheme)) return null;
    return identity;
  }

  // --------------------------------------------------- gộp ghi đè selector

  /**
   * Gộp nhãn người dùng ghi đè *thêm vào* mặc định, nhãn người dùng đứng trước. Thay thế hẳn
   * là sai: một ghi đè cho `addSource` sẽ vứt luôn mọi nhãn tiếng Anh lẫn tiếng Việt có sẵn.
   * Không sửa vào bộ mặc định.
   */
  function mergeSelectorOverrides(defaults, overrides) {
    const base = defaults && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {};
    const extra = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {};

    const out = {};
    for (const key of dedupe([...Object.keys(base), ...Object.keys(extra)])) {
      const added = Array.isArray(extra[key]) ? extra[key] : [];
      const kept = Array.isArray(base[key]) ? base[key] : [];
      out[key] = dedupe([...added, ...kept].map(foldLabel).filter(Boolean));
    }
    return out;
  }

  root.NBLM_SHARED = Object.freeze({
    EXT_PREFIX,
    MAX_WORDS_PER_SOURCE,
    DEFAULTS,
    NOTEBOOK_HOSTS,
    NOTEBOOK_MATCH_PATTERNS,
    collapse,
    parseVideoId,
    parsePlaylistId,
    parseNotebookId,
    notebookUrl,
    dedupe,
    deaccent,
    foldLabel,
    stamp,
    mergeSegments,
    contextHeader,
    sourceBody,
    countWords,
    packSources,
    bundleName,
    estimateSources,
    ledgerKey,
    docPageId,
    sameDocPage,
    normalizeDocUrl,
    mergeSelectorOverrides,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
