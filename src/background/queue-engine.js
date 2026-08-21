// Engine hàng đợi — Seam 2 của spec 0001.
//
// Engine nhận vào danh sách Mục hàng đợi cùng hai adapter (trích, đẩy) và trả về nhật ký
// chạy. Nó **không** chạm `chrome.*`, không chạm DOM, không đọc đồng hồ hệ thống trừ qua
// `options.now`. Đó là điều kiện để toàn bộ ADR 0005–0009 kiểm được bằng adapter giả, không
// cần Chrome: `test/queue-engine.test.js`.
//
// Cũng là classic script như `src/common/shared.js` — service worker nạp bằng `importScripts`,
// nên API gắn vào `globalThis.NBLM_ENGINE` thay vì export.
(function (root) {
  'use strict';

  if (root.NBLM_ENGINE) return;

  const S = root.NBLM_SHARED;
  if (!S) throw new Error('queue-engine: cần src/common/shared.js nạp trước');

  const VIDEO_QUEUE = 'video';
  const DOCS_QUEUE = 'docs';

  /** Ngăn giữa hai phần trong một Nguồn gộp. Header ngữ cảnh của từng phần do khâu trích dựng. */
  const PART_SEPARATOR = '\n\n---\n\n';

  // ------------------------------------------------------------------ trạng thái

  /**
   * Trạng thái lưu bền giữa các lần chạy. Phải là dữ liệu thuần JSON: nó đi qua
   * `chrome.storage`, nên không `Set`, không `Map`, không class.
   *
   * - `ledger`: Sổ đã import, khoá theo cặp (mục, Notebook đích) — ADR 0006. Tách hẳn khỏi
   *   `pending`: dọn hàng đợi không được làm mất chống trùng lặp.
   * - `groups`: mỗi Nguồn gộp một mục — đã chốt mấy phần, mấy nguồn bổ sung, và lần chạy
   *   trước đã chạy hết chưa. `done` là thứ phân biệt *chạy tiếp* với *import lại* (ADR 0009).
   * - `pending`: Mục hàng đợi còn nợ — hỏng, hoặc bị dừng giữa chừng.
   */
  function emptyState() {
    return { ledger: [], groups: {}, pending: [] };
  }

  function normalizeState(state) {
    const s = state && typeof state === 'object' ? state : {};
    const groups = {};
    const src = s.groups && typeof s.groups === 'object' ? s.groups : {};
    for (const key of Object.keys(src)) {
      const g = src[key] || {};
      groups[key] = {
        parts: Number(g.parts) || 0,
        supplements: Number(g.supplements) || 0,
        done: g.done === true,
      };
    }
    return {
      ledger: Array.isArray(s.ledger) ? s.ledger.filter((k) => typeof k === 'string') : [],
      groups,
      pending: Array.isArray(s.pending) ? s.pending.filter(Boolean) : [],
    };
  }

  // ------------------------------------------------------------------ Mục hàng đợi

  const queueOf = (item) => (item && item.kind === DOCS_QUEUE ? DOCS_QUEUE : VIDEO_QUEUE);

  const labelOf = (item) => (item && item.title ? String(item.title) : String((item && item.id) || ''));

  /**
   * Khoá của một Nguồn gộp. Với tài liệu, **Nhánh nằm trong khoá**: đó là cách "cắt theo ranh
   * giới Nhánh" (ADR 0005) thành ra miễn phí — hai nhánh là hai bó, không bao giờ dính vào
   * nhau dù cả hai còn xa trần.
   */
  function groupKey(group) {
    if (!group) return null;
    if (group.key) return String(group.key);
    const kind = group.kind || 'playlist';
    const source = String(group.source || '');
    const branch = group.branch ? `/${group.branch}` : '';
    return `${kind}:${source}${branch}`;
  }

  /** Tên gốc để suy tên nguồn bổ sung: với tài liệu, nhánh là một phần của nguồn gốc. */
  const groupBase = (group) =>
    group.kind === DOCS_QUEUE ? `${group.source} — ${group.branch}` : String(group.source || '');

  /**
   * Tên Nguồn lúc **chốt**, suy từ (nguồn gốc, chỉ số phần) và chỉ từ đó — ADR 0010. Tên phải
   * đặt được ngay lúc chốt vì phần 1 đã đẩy đi từ lâu trước khi biết có mấy phần (ADR 0008).
   *
   * Phần đầu của một Nhánh tài liệu mang đúng tên `<Site> — <Nhánh>`; chỉ khi nhánh đó một
   * mình vượt trần và phải cắt tiếp mới có `— phần 2`, `— phần 3`. Đánh số ngay từ phần 1 sẽ
   * bắt mọi nhánh vừa một nguồn phải mang một chỉ số vô nghĩa.
   */
  function sealedName(group, gstate, supplementMode) {
    if (supplementMode) {
      gstate.supplements += 1;
      return S.bundleName({ kind: 'supplement', source: groupBase(group), part: gstate.supplements });
    }
    gstate.parts += 1;
    if (group.kind === DOCS_QUEUE) {
      return gstate.parts === 1
        ? S.bundleName({ kind: DOCS_QUEUE, source: group.source, branch: group.branch })
        : S.bundleName({ kind: 'playlist', source: groupBase(group), part: gstate.parts });
    }
    return S.bundleName({ kind: 'playlist', source: group.source, part: gstate.parts });
  }

  // ------------------------------------------------------------------ vòng chạy

  /**
   * Chạy hết hàng đợi và trả về nhật ký chạy.
   *
   * Hai hàng đợi chạy **song song ở khâu trích, độc quyền ở khâu đẩy** (ADR 0007): NotebookLM
   * chỉ có một hộp thoại thêm nguồn, nên hai hàng xếp lượt đúng ở chỗ đó và chỉ chỗ đó.
   */
  async function runQueue(config) {
    const cfg = config || {};
    const notebookId = String(cfg.notebookId || '');
    if (!notebookId) throw new Error('runQueue: thiếu Notebook đích');
    if (typeof cfg.extract !== 'function') throw new Error('runQueue: thiếu adapter trích');
    if (typeof cfg.push !== 'function') throw new Error('runQueue: thiếu adapter đẩy');

    const options = cfg.options || {};
    const maxWords = Number(options.maxWords) || S.DEFAULTS.maxWordsPerSource;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

    const state = normalizeState(cfg.state);
    // Chạy tiếp lần trước rồi mới tới mục mới; khử trùng theo id để một mục không vào Nguồn
    // gộp hai lần và tiêu quota hai lần.
    const incoming = [...state.pending, ...(cfg.items || [])].filter(Boolean);
    state.pending = [];

    // Mục không có id không đi tiếp được: `ledgerKey` từ chối nó, và một lỗi ném ra giữa vòng
    // chạy sẽ nuốt luôn nhật ký lẫn Sổ đã import vừa cập nhật — những Nguồn đã đẩy thành công
    // sẽ bị đẩy lại ở lần sau, mà Nguồn đã đẩy thì không xoá được. Loại nó ở cửa vào, và loại
    // *có tên tuổi*: nó vẫn phải có một dòng trong bảng tổng kết.
    const usable = [];
    const rejected = [];
    for (const item of incoming) {
      const id = item.id == null ? '' : String(item.id).trim();
      if (id) usable.push(item);
      else rejected.push({ id: `(không có id #${rejected.length + 1}: ${labelOf(item) || 'không rõ'})` });
    }
    const queued = S.dedupe(usable, (i) => String(i.id).trim());

    const ledger = new Set(state.ledger);
    const log = {
      notebookId,
      queued: [...queued.map((i) => i.id), ...rejected.map((r) => r.id)],
      sources: [],
      skipped: [],
      dropped: rejected.map((r) => ({ id: r.id, stage: 'queue', reason: 'Mục hàng đợi không có id' })),
      deferred: [],
      trace: [],
      stopped: false,
    };

    // Nhóm nào đã chạy xong ở lần trước thì lần này là *import lại*, nên sinh nguồn bổ sung
    // chứ không dựng lại từ đầu (ADR 0009). `done` chỉ đổi ở cuối lần chạy, nên đọc nó lúc
    // chốt là đọc đúng trạng thái của lần trước.
    const groupsInRun = new Set(queued.map((i) => groupKey(i.group)).filter(Boolean));

    const trace = (queue, stage, event, id) => log.trace.push({ at: now(), queue, stage, event, id });

    // Khâu đẩy độc quyền: một dây chuyền promise cho cả hai hàng đợi.
    let pushChain = Promise.resolve();
    function exclusivePush(task) {
      const result = pushChain.then(task, task);
      pushChain = result.then(() => undefined, () => undefined);
      return result;
    }

    const requeue = (item) => state.pending.push(item);

    async function pushSource(source, items, queue, bundle) {
      // Chỉ số phần lấy **bên trong** lượt đẩy độc quyền, không phải lúc chốt: lấy lúc chốt
      // thì một cú đẩy hỏng vẫn tiêu mất một chỉ số, để lại "phần 1, phần 3" trong notebook —
      // trong khi ADR 0010 đặt tên theo (nguồn gốc, chỉ số phần) đúng để lần import sau đọc
      // tên mà biết phần nào đã có. Trả lại chỉ số khi hỏng là an toàn vì khâu đẩy độc quyền:
      // không có lượt đẩy nào khác đang giữ một chỉ số cao hơn.
      const gstate = bundle.group ? groupStateOf(bundle.key) : null;
      const supplement = gstate ? gstate.done : false;
      source.name = gstate ? sealedName(bundle.group, gstate, supplement) : labelOf(items[0]);

      trace(queue, 'push', 'start', source.name);
      try {
        await cfg.push(source);
      } catch (error) {
        if (gstate) {
          if (supplement) gstate.supplements -= 1;
          else gstate.parts -= 1;
        }
        trace(queue, 'push', 'fail', source.name);
        for (const item of items) {
          log.dropped.push({ id: item.id, stage: 'push', source: source.name, reason: messageOf(error) });
          requeue(item);
        }
        return;
      }
      trace(queue, 'push', 'end', source.name);
      log.sources.push(source);
      // Nguồn gộp vẫn ghi vào Sổ **từng mục một**, để một lần import lẻ sau đó biết là trùng
      // (ADR 0006).
      for (const item of items) ledger.add(S.ledgerKey(item.id, notebookId));
    }

    /** Chốt một bó và đẩy ngay, không đợi biết tổng số phần (ADR 0008). */
    function seal(bundle, queue) {
      if (!bundle || bundle.parts.length === 0) return Promise.resolve();
      const items = bundle.parts.map((p) => p.item);
      const source = {
        name: '', // đặt ngay trước khi đẩy, xem `pushSource`
        kind: queue,
        notebookId,
        itemIds: items.map((i) => i.id),
        words: bundle.words,
        body: bundle.parts.map((p) => p.text).join(PART_SEPARATOR),
      };
      if (bundle.overflow) source.overflow = true;
      return exclusivePush(() => pushSource(source, items, queue, bundle));
    }

    function groupStateOf(key) {
      if (!state.groups[key]) state.groups[key] = { parts: 0, supplements: 0, done: false };
      return state.groups[key];
    }

    async function runOne(queue, items) {
      /** Bó đang gom, một bó cho mỗi Nguồn gộp. Nguồn lẻ không đi qua đây. */
      const open = new Map();

      for (const item of items) {
        if (shouldStop()) {
          // Dừng không phải rớt: mục còn nguyên, chỉ là chưa tới lượt. Nó vẫn phải có một
          // dòng trong bảng tổng kết, nếu không nó biến mất khỏi phép kế toán.
          log.stopped = true;
          log.deferred.push({ id: item.id, reason: 'dừng giữa chừng' });
          requeue(item);
          continue;
        }

        if (ledger.has(S.ledgerKey(item.id, notebookId))) {
          log.skipped.push({ id: item.id, reason: 'đã có trong Sổ đã import' });
          continue;
        }

        let extracted;
        trace(queue, 'extract', 'start', item.id);
        try {
          extracted = await cfg.extract(item);
        } catch (error) {
          trace(queue, 'extract', 'fail', item.id);
          // Mục hỏng thường hỏng vì lý do dai dẳng, nên nó **không** giữ bó đang gom lại:
          // bó vẫn gom tiếp và vẫn được chốt với những gì đã có (ADR 0008), còn mục hỏng
          // quay lại hàng đợi để lần chạy sau thử lại.
          log.dropped.push({ id: item.id, stage: 'extract', reason: messageOf(error) });
          requeue(item);
          continue;
        }
        trace(queue, 'extract', 'end', item.id);

        const text = extracted && typeof extracted === 'object' ? String(extracted.text || '') : String(extracted || '');
        if (!text.trim()) {
          log.dropped.push({ id: item.id, stage: 'extract', reason: 'trích ra nội dung rỗng' });
          requeue(item);
          continue;
        }
        const words = extracted && extracted.words != null && Number.isFinite(Number(extracted.words))
          ? Number(extracted.words)
          : S.countWords(text);
        const part = { item, text, words };

        const key = groupKey(item.group);
        if (!key) {
          // Import lẻ: một mục một nguồn (ADR 0002).
          await seal({ parts: [part], words, group: null, key: null }, queue);
          continue;
        }

        let bundle = open.get(key);
        // Cùng quy tắc cắt như `packSources` của Seam 1: phần kế tiếp làm bó vượt trần thì
        // chốt bó đang gom trước, rồi mở bó mới.
        if (bundle && bundle.words + words > maxWords) {
          await seal(bundle, queue);
          open.delete(key);
          bundle = null;
        }
        if (!bundle) {
          bundle = { parts: [], words: 0, group: item.group, key };
          open.set(key, bundle);
        }
        bundle.parts.push(part);
        bundle.words += words;
        if (bundle.words > maxWords) {
          // Một mình đã vượt trần: giữ trong Nguồn riêng và đánh dấu, để bảng tổng kết nói
          // ra được thay vì lặng lẽ bỏ.
          bundle.overflow = true;
          await seal(bundle, queue);
          open.delete(key);
        }
      }

      for (const [key, bundle] of open) {
        await seal(bundle, queue);
        open.delete(key);
      }
    }

    const byQueue = { [VIDEO_QUEUE]: [], [DOCS_QUEUE]: [] };
    for (const item of queued) byQueue[queueOf(item)].push(item);

    await Promise.all([
      runOne(VIDEO_QUEUE, byQueue[VIDEO_QUEUE]),
      runOne(DOCS_QUEUE, byQueue[DOCS_QUEUE]),
    ]);
    await pushChain;

    // Nhóm nào không còn nợ mục nào thì lần chạy này coi như xong: lần import sau vào cùng
    // nhóm là *import lại*, sinh nguồn bổ sung (ADR 0009).
    const stillPending = new Set(state.pending.map((i) => groupKey(i.group)).filter(Boolean));
    for (const key of groupsInRun) {
      if (!stillPending.has(key)) groupStateOf(key).done = true;
    }

    state.ledger = [...ledger];
    log.state = state;
    log.summary = summarize(log);
    return log;
  }

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  // ------------------------------------------------------------------ bảng tổng kết

  /**
   * Bảng tổng kết cuối lần chạy. Gộp nguồn khiến việc mất một mục trở nên vô hình — 54 video
   * trong một nguồn trông y hệt 55 — nên bảng này là điều kiện để quyết định gộp nguồn không
   * âm thầm nuốt dữ liệu (ADR 0008).
   *
   * `leaked` là mục vào hàng đợi mà không ra ở bất cứ đâu; `duplicated` là mục ra hai lần.
   * Cả hai lẽ ra luôn rỗng — chúng có mặt để một lỗi kế toán *hiện ra* thay vì chỉ làm lệch
   * một con số.
   */
  function summarize(log) {
    const imported = [];
    const seen = new Map();
    for (const source of log.sources) {
      for (const id of source.itemIds) {
        imported.push(id);
        seen.set(id, (seen.get(id) || 0) + 1);
      }
    }
    for (const entry of [...log.skipped, ...log.dropped, ...(log.deferred || [])]) {
      seen.set(entry.id, (seen.get(entry.id) || 0) + 1);
    }

    const leaked = log.queued.filter((id) => !seen.has(id));
    const duplicated = [...seen.keys()].filter((id) => seen.get(id) > 1);

    return {
      queued: log.queued.length,
      imported: imported.length,
      skipped: log.skipped.length,
      dropped: log.dropped.length,
      deferred: (log.deferred || []).length,
      sources: log.sources.length,
      words: log.sources.reduce((sum, s) => sum + s.words, 0),
      stopped: log.stopped,
      leaked,
      duplicated,
      balanced: leaked.length === 0 && duplicated.length === 0,
    };
  }

  /** Bảng tổng kết dạng chữ, để popup và log cùng đọc được. */
  function formatSummary(log) {
    const s = log.summary || summarize(log);
    const lines = [
      `Notebook đích: ${log.notebookId}`,
      `Hàng đợi: ${s.queued} mục — ${s.imported} đã import, ${s.skipped} bỏ qua, ${s.dropped} rớt`
        + `${s.deferred ? `, ${s.deferred} còn nợ` : ''}`,
      `Nguồn đã tạo: ${s.sources}`,
    ];
    for (const source of log.sources) {
      lines.push(`  + ${source.name}: ${source.itemIds.length} mục, ${source.words} từ${source.overflow ? ' (vượt trần)' : ''}`);
    }
    if (log.skipped.length) {
      lines.push('Bỏ qua:');
      for (const entry of log.skipped) lines.push(`  - ${entry.id}: ${entry.reason}`);
    }
    if (log.dropped.length) {
      lines.push('Mục rớt:');
      for (const entry of log.dropped) lines.push(`  - ${entry.id} (${entry.stage}): ${entry.reason}`);
    }
    if (log.deferred && log.deferred.length) {
      lines.push('Còn nợ (chưa tới lượt):');
      for (const entry of log.deferred) lines.push(`  - ${entry.id}: ${entry.reason}`);
    }
    if (log.stopped) lines.push(`Đã dừng giữa chừng — còn nợ ${log.state.pending.length} mục.`);
    if (!s.balanced) {
      lines.push(`LỆCH KẾ TOÁN — vào ${s.queued} mục, không ra: [${s.leaked.join(', ')}], ra hai lần: [${s.duplicated.join(', ')}]`);
    }
    return lines.join('\n');
  }

  root.NBLM_ENGINE = Object.freeze({
    VIDEO_QUEUE,
    DOCS_QUEUE,
    PART_SEPARATOR,
    emptyState,
    groupKey,
    runQueue,
    summarize,
    formatSummary,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
