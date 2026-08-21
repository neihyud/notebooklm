// Chỗ nối của ticket 005: trích → **ghi Bản lưu ra đĩa** → đẩy vào Notebook đích.
//
// Ba mảnh của ba ticket trước (trích ở tab YouTube, engine hàng đợi, đẩy ở tab NotebookLM)
// đều đã có test riêng. Thứ chỉ xuất hiện khi ghép chúng lại là **thứ tự**, và ADR 0011 nói
// thứ tự nào là đúng: transcript phải nằm trên đĩa *trước* khi thử đẩy. Một chế độ "chỉ tải
// về" phải bật trước khi chạy thì không cứu được gì — lúc biết mình cần tới nó thì transcript
// đã mất rồi.
//
// Vì vậy việc ghi đĩa nằm **bên trong** adapter trích của engine, không nằm cạnh nó: engine
// gọi `push` sau khi `extract` trả về, nên đặt ở đây là thứ tự ấy thành ra không thể đảo được
// bằng một lần sửa vô ý ở chỗ khác.
//
// File này không chạm `chrome.*`: mọi lối ra (trích, ghi đĩa, đẩy) là adapter được tiêm, nên
// toàn bộ đường đi test được bằng adapter giả — `test/importer.test.js`.
(function (root) {
  'use strict';

  if (root.NBLM_IMPORTER) return;

  const S = root.NBLM_SHARED;
  const F = root.NBLM_TRANSCRIPT_FORMAT;
  const E = root.NBLM_ENGINE;
  if (!S) throw new Error('background/importer: cần src/common/shared.js nạp trước');
  if (!F) throw new Error('background/importer: cần src/youtube/srt.js nạp trước');
  if (!E) throw new Error('background/importer: cần src/background/queue-engine.js nạp trước');

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  const settingsOf = (settings) => ({ ...S.DEFAULTS, ...(settings && typeof settings === 'object' ? settings : {}) });

  /**
   * Meta của một video: những gì đọc được **trên trang** thắng những gì hàng đợi đoán từ link
   * — trang là thứ vừa nhìn thấy thật. Đúng cho `title`, `channel`, `privacy`, `durationSeconds`.
   *
   * Hai trường đi ngược chiều ấy, và cả hai đều cố ý:
   *
   *   - `videoId` lấy của Mục: nó là khoá của Mục hàng đợi, của Sổ đã import và của tên file,
   *     nên nó không phải thứ trang được quyền đổi.
   *   - `url` **cũng** lấy của Mục — dòng `pick(i.url, m.url)` dưới đây không phải lỗi gõ.
   *     `url` là thứ duy nhất trong meta không mô tả nội dung, mà là **địa chỉ để quay lại**:
   *     `contextHeader` in nó thành `- Link gốc: …` trong thân mỗi Nguồn, và đó là chỗ người
   *     dùng nhấn để kiểm chứng một trích dẫn. Mục hàng đợi biết người dùng đã yêu cầu video
   *     nào — `itemFromLink` lấy nó từ chính link vừa bấm chuột phải. Trang chỉ biết tab đang
   *     hiển thị gì, và tab ấy có thể là một trang watch khác hẳn (bấm chuột phải lên một video
   *     gợi ý ở sidebar là đúng trường hợp đó, và cả hai URL đều hợp lệ nên không gì lộ ra).
   *     Lấy url của trang là dựng một Nguồn mang transcript video A với Link gốc trỏ video B.
   *
   * Nói gọn: nội dung theo trang, **danh tính theo Mục**. `videoId` và `url` là danh tính.
   */
  function mergeMeta(item, meta) {
    const i = item || {};
    const m = meta || {};
    const pick = (a, b) => S.collapse(a) || S.collapse(b);
    const duration = Number(m.durationSeconds) || Number(i.durationSeconds) || 0;
    return {
      videoId: S.collapse(i.id) || S.collapse(m.videoId),
      title: pick(m.title, i.title),
      channel: pick(m.channel, i.channel),
      url: pick(i.url, m.url),
      privacy: pick(m.privacy, i.privacy),
      durationSeconds: duration > 0 ? duration : 0,
    };
  }

  /**
   * Mục hàng đợi từ một cú bấm **menu chuột phải trên link**.
   *
   * `linkUrl` và `pageUrl` là hai chuỗi cùng kiểu nằm cạnh nhau trong cùng một object của
   * Chrome, và trên một trang watch thì cả hai đều là URL YouTube hợp lệ: hoán vị chúng vẫn
   * ra một lần import "thành công", chỉ là của **video đang xem** chứ không phải video vừa
   * bấm. Đó là lý do hàm này tồn tại thay vì hai dòng trong service worker.
   */
  function itemFromLink(info) {
    const url = S.collapse(info && info.linkUrl);
    const id = S.parseVideoId(url);
    if (!id) return null;
    return { id, kind: 'video', url, title: S.collapse(info && info.linkText) };
  }

  /** Mục hàng đợi từ chính tab đang mở — nút trên trang, phím tắt, và popup đều đi đường này. */
  function itemFromTab(tab) {
    const t = tab || {};
    const url = S.collapse(t.url);
    const id = S.parseVideoId(url);
    if (!id) return null;
    return { id, kind: 'video', url, title: S.collapse(t.title) };
  }

  /**
   * Đường dẫn tương đối trong thư mục Tải về.
   *
   * `chrome.downloads.download` **báo lỗi cả lần tải** với đường dẫn tuyệt đối hoặc có `..`,
   * nên tên thư mục người dùng gõ ở trang Cài đặt phải được rửa ở đây. Rửa từng đoạn một chứ
   * không rửa cả chuỗi: `/` là thứ duy nhất được giữ lại làm dấu phân cấp.
   */
  function downloadPath(dir, filename) {
    const parts = String(dir == null ? '' : dir)
      .split('/')
      .map((part) => F.safeSegment(part))
      .filter(Boolean);
    return [...parts, filename].join('/');
  }

  /**
   * Một Mục hàng đợi thành (Bản lưu trên đĩa, thân Nguồn).
   *
   * Thân Nguồn **luôn** là bản `md` kể cả khi Bản lưu là `srt`/`vtt`: header ngữ cảnh là thứ
   * NotebookLM đọc để trích dẫn đúng tên video và tên kênh (ADR 0002), còn định dạng file chỉ
   * là chuyện của cái file.
   */
  function buildTranscript(item, extracted, settings) {
    const config = settingsOf(settings);
    const ex = extracted || {};
    const segments = Array.isArray(ex.segments) ? ex.segments : [];
    if (segments.length === 0) throw new Error('trích xong nhưng không có segment nào');

    const meta = mergeMeta(item, ex.meta);
    const options = { mergeWindowSeconds: config.mergeWindowSeconds };
    const rendered = F.render(config.transcriptFormat, meta, segments, options);
    const body = rendered.format === 'md' ? rendered.text : F.toMarkdown(meta, segments, options);

    return {
      meta,
      body,
      words: S.countWords(body),
      file: {
        format: rendered.format,
        filename: downloadPath(config.downloadDir, rendered.filename),
        mime: rendered.mime,
        text: rendered.text,
        url: F.dataUrl(rendered.text, rendered.mime),
      },
    };
  }

  /**
   * Trích một mục rồi ghi Bản lưu — theo đúng thứ tự đó, và chờ ghi xong mới trả về.
   *
   * Ghi đĩa hỏng **không** huỷ lần import: mất Bản lưu là mất một tấm lưới an toàn, còn bỏ
   * luôn lần đẩy là vứt đúng cái việc người dùng đang muốn làm. Nó được ghi lại thành một
   * dòng để bảng tổng kết nói ra, thay vì im lặng.
   */
  async function extractAndSave(item, settings, deps, collect) {
    if (typeof deps.extractVideo !== 'function') throw new Error('importer: thiếu adapter trích');
    const extracted = await deps.extractVideo(item);
    const built = buildTranscript(item, extracted, settings);

    if (typeof deps.saveFile === 'function') {
      try {
        await deps.saveFile(built.file);
        collect.saved.push(built.file);
      } catch (error) {
        collect.saveFailures.push({ id: item.id, filename: built.file.filename, reason: messageOf(error) });
      }
    }
    return built;
  }

  /**
   * Chạy hàng đợi đầy đủ: trích, ghi Bản lưu, rồi đẩy vào Notebook đích.
   *
   * Trả về đúng nhật ký của engine, thêm `saved` và `saveFailures` — nếu không, câu hỏi "ngắt
   * mạng giữa chừng thì file còn không?" chỉ trả lời được bằng cách đi mở thư mục Tải về.
   */
  async function runImport(config) {
    const cfg = config || {};
    const deps = cfg.deps || {};
    const settings = settingsOf(cfg.settings);
    const collect = { saved: [], saveFailures: [] };

    const log = await E.runQueue({
      notebookId: cfg.notebookId,
      items: cfg.items,
      state: cfg.state,
      options: { maxWords: settings.maxWordsPerSource, ...(cfg.options || {}) },
      extract: async (item) => {
        const built = await extractAndSave(item, settings, deps, collect);
        return { text: built.body, words: built.words };
      },
      push: async (source) => {
        if (typeof deps.pushSource !== 'function') throw new Error('importer: thiếu adapter đẩy');
        return deps.pushSource(source);
      },
    });

    log.saved = collect.saved;
    log.saveFailures = collect.saveFailures;
    return log;
  }

  /**
   * Mục cần chạy cho một lối vào: hàng đợi còn nợ **cộng** mục đang xem, không phải cái này
   * thay cái kia. `runQueue` đã gộp như vậy cho đường import; đường chỉ-ghi-Bản-lưu không đi
   * qua engine nên phải gộp ở đây, nếu không thì mở một video mới lúc hàng đợi còn nợ rồi bấm
   * "ghi Bản lưu" là chính video đang xem bị bỏ qua, im lặng.
   */
  function itemsToRun(pending, current) {
    return S.dedupe([...(pending || []), ...(current || [])].filter(Boolean), (item) => String(item.id));
  }

  /**
   * Chạy hàng đợi **mà không đụng NotebookLM**: chỉ trích và ghi Bản lưu.
   *
   * Không đi qua engine, và đó là chủ ý: engine ghi Sổ đã import cho mọi Nguồn đẩy thành công
   * (ADR 0006), mà ở đây không có Nguồn nào vào notebook nào cả. Ghi Sổ ở đây là chặn mất lần
   * import thật sau đó — một cái hỏng không có triệu chứng cho tới khi người dùng thấy video
   * "đã import" mà notebook trống.
   */
  async function saveOnly(config) {
    const cfg = config || {};
    const deps = cfg.deps || {};
    const settings = settingsOf(cfg.settings);
    const collect = { saved: [], saveFailures: [] };
    const failed = [];

    for (const item of S.dedupe((cfg.items || []).filter(Boolean), (i) => String(i.id))) {
      try {
        await extractAndSave(item, settings, deps, collect);
      } catch (error) {
        failed.push({ id: item.id, reason: messageOf(error) });
      }
    }

    for (const failure of collect.saveFailures) failed.push({ id: failure.id, reason: failure.reason });
    return { saved: collect.saved, failed };
  }

  /** Bảng tổng kết dạng chữ của một lượt "chỉ tải về" — popup và log cùng đọc được. */
  function formatSaveReport(report) {
    const r = report || { saved: [], failed: [] };
    const lines = [`Bản lưu transcript: ${r.saved.length} file, ${r.failed.length} mục rớt`];
    for (const file of r.saved) lines.push(`  + ${file.filename}`);
    for (const failure of r.failed) lines.push(`  - ${failure.id}: ${failure.reason}`);
    return lines.join('\n');
  }

  root.NBLM_IMPORTER = Object.freeze({
    itemsToRun,
    itemFromLink,
    itemFromTab,
    mergeMeta,
    downloadPath,
    buildTranscript,
    runImport,
    saveOnly,
    formatSaveReport,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
