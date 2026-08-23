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

  /**
   * Nhãn người đọc cho **đường đẩy** của một Nguồn — hai giá trị `pushTextSource` trả về
   * (ADR 0012). Bảng tra ở đây, không rải trong `formatSummary`: hai nhãn cùng kiểu chuỗi cho
   * hai vai ngược nhau, và đổi chỗ chúng vẫn cho một bảng đọc trôi chảy nói ngược sự thật —
   * đúng hình mà `WORKSPACE_PROTOCOL.md` ghi cho bảng xác nhận ở ticket 007.
   *
   * Trường trên Nguồn tên `pushVia` chứ không phải `via`, và đó là chủ ý: repo này đã có ba thứ
   * khác mang tên `via` — đường trích transcript (`panel|innertube|dom`), nấc trích tài liệu
   * (`fetch|tab`), kiểu cây sidebar (`lists|blocks|flat`) — và không thứ nào liên quan tới đây.
   */
  const PUSH_VIA_LABEL = Object.freeze({
    rpc: 'đường RPC',
    dom: 'đường lui (DOM)',
  });

  /**
   * Đường đẩy mà adapter vừa đi, đọc từ giá trị nó trả về.
   *
   * Adapter im lặng là hạng **không rõ**, không phải đường chính. Đoán `'rpc'` ở đây là làm bảng
   * tổng kết báo đường chính đang sống vào đúng lúc nó vừa chết — mà đó là cả lý do ticket này
   * tồn tại: khi shape payload trôi theo cohort (ADR 0012), mọi lượt đẩy lặng lẽ rơi về đường
   * lui và không có triệu chứng nào khác.
   */
  function pushViaOf(result) {
    const via = result && typeof result === 'object' ? result.via : null;
    return typeof via === 'string' ? via.trim() : '';
  }

  /**
   * `Object.hasOwn` chứ không phải `PUSH_VIA_LABEL[via] || …`: bảng tra là object literal, nên
   * phép tra trần cũng thấy cả thuộc tính kế thừa. Một `via` tên `'toString'` hay `'constructor'`
   * lấy được một **hàm** (truthy) và bảng tổng kết in ra `function toString() { [native code] }`
   * thay vì rơi vào đúng nhánh "đường lạ" mà nhánh ấy tồn tại để đón.
   */
  const pushViaLabel = (via) => (Object.hasOwn(PUSH_VIA_LABEL, via)
    ? PUSH_VIA_LABEL[via]
    : (via ? `đường lạ (${via})` : 'đường không rõ'));

  /**
   * Nguồn vừa đẩy có mang **đúng tên ta đặt** không — rỗng nghĩa là có, ngược lại là câu nói ra
   * chỗ lệch.
   *
   * Câu hỏi là một, còn bằng chứng thì mỗi đường một loại — nên chỗ hợp nhất nằm ở đây, không
   * nằm trong một trong hai đường:
   *
   *   - đường DOM tự tay điền ô tiêu đề, nên thứ nó biết là **điền được hay không** (`named`),
   *     kèm sẵn câu chữ cho người đọc (`warning` của `addTextSource`);
   *   - đường RPC không có khái niệm "không đặt được tên" — nó gửi tiêu đề trong `params` — mà
   *     có thứ mạnh hơn: **tên Nguồn trong phản hồi**, tức tên notebook thật sự đang giữ. Shape
   *     `params` trôi theo cohort (ADR 0012) thì request vẫn thành công và tên vẫn khác, nên
   *     "gửi đi rồi" không phải bằng chứng nào cả; tên đọc lại được thì là.
   *
   * Không xác nhận được thì nói ra, đừng im — cùng luật với `pushViaOf`: im lặng là hạng *chưa
   * biết*, không phải hạng *ổn*. Tên Nguồn là vĩnh viễn (ADR 0010) và ADR 0009 đọc chính tên ấy
   * để biết phần nào đã có, nên một lượt chạy mà Sổ đã import và notebook nói hai chuyện khác
   * nhau không sửa lại được — và nó không có triệu chứng nào khác.
   */
  function nameWarningOf(intended, result) {
    // **Không chuẩn hoá ở đây.** `labelOf`/`S.bundleName` đã đặt tên bằng đúng chuỗi hai đường
    // đẩy gửi đi, nên phép so là phép so chuỗi trần: thêm một phép chuẩn hoá thứ ba ở chỗ so là
    // dựng lại đúng con bọ nó vừa vá, chỉ ở một lớp khác — và lần này nó **giấu** chỗ lệch thay
    // vì bịa ra chỗ lệch.
    const wanted = String(intended || '');
    if (!wanted) return ''; // Nguồn không đặt tên thì không có cái tên nào để mất
    const r = result && typeof result === 'object' ? result : {};
    if (r.named === false) {
      const said = typeof r.warning === 'string' ? r.warning.trim() : '';
      return said || `không đặt được tên — NotebookLM sẽ tự đặt tên thay cho "${wanted}"`;
    }
    const got = typeof r.name === 'string' ? r.name : '';
    // `.trim()` sống sót đúng ở đây, và chỉ cho câu hỏi *"có đọc được cái tên nào không"* — một
    // chuỗi toàn khoảng trắng không phải một cái tên. Nó không đụng vào phép so bằng, nên nó
    // không tạo ra được một dương tính giả nào.
    if (!got.trim()) return `lượt đẩy không nói Nguồn mang tên gì — không xác nhận được "${wanted}"`;
    return got === wanted ? '' : `notebook đang để tên "${got}", không phải "${wanted}"`;
  }

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

  /**
   * Tên người đọc của một Mục — và với **Nguồn lẻ, đây chính là tên Nguồn** sẽ nằm vĩnh viễn
   * trong notebook (ADR 0002, ADR 0010).
   *
   * Vì vậy nó phải là **đúng chuỗi hai đường đẩy gửi đi**: cả `buildParams` (RPC) lẫn
   * `addTextSource` (DOM) đặt `S.collapse(source.name)` vào ô tiêu đề. Chuẩn hoá ở chỗ *đặt
   * tên*, một lần — không phải ở chỗ so. Hai phép chuẩn hoá khác nhau trên cùng một chuỗi là
   * một lượt đẩy hoàn toàn đúng bị bảng tổng kết báo mất tên: tiêu đề YouTube có khoảng trắng
   * đôi thì ta ghi `"Video  giua"` còn notebook giữ `"Video giua"`.
   *
   * `S.bundleName` đã `collapse` sẵn cả nguồn gốc lẫn Nhánh, nên trước đó chỉ Nguồn lẻ hở.
   *
   * `S.collapse` bỏ mọi thứ không phải chuỗi — **cùng phép** mà `S.ledgerKey` áp cho id, nên một
   * Mục id không phải chuỗi đã chết ở `ledgerKey` trước khi tới đây. Không thêm phép ép kiểu:
   * hàng rào thứ hai cho một luật đã có hàng rào là code chết, và code chết không test nào canh.
   */
  const labelOf = (item) => S.collapse(item && item.title) || S.collapse(item && item.id);

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
    // `S.collapse` chứ không phải `String(...)`: Notebook đích đi thẳng vào `S.ledgerKey`, và
    // `ledgerKey` collapse vế của nó. Chuẩn hoá ở **chỗ đặt** — một lần, ngay đây — thì phép
    // collapse bên trong `ledgerKey` thành ra vô hại, và `!notebookId` ở dòng dưới đúng bằng
    // điều kiện `ledgerKey` áp cho vế Notebook. Giữ `String(cfg.notebookId || '')` là nhận một
    // Notebook đích mà `ledgerKey` sẽ từ chối, rồi từ chối nó ở giữa vòng chạy.
    const notebookId = S.collapse(cfg.notebookId);
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

    // Mục nào không dựng được khoá Sổ đã import thì không đi tiếp được, và cửa vào hỏi điều đó
    // bằng cách **gọi thẳng `S.ledgerKey`** — không chép lại điều kiện của nó. Một bản chép là
    // hàng rào thứ hai cho cùng một luật, và hai hàng rào thì trôi khỏi nhau: bản cũ hỏi
    // `String(item.id).trim()` nên `{ id: 7 }` lọt qua cửa, chạy được một quãng, rồi ném ở
    // `ledgerKey` **sau khi** đã đẩy Nguồn đầu.
    //
    // Loại Mục chứ không từ chối cả lượt: một Mục hỏng không được chặn cả playlist 300 video
    // (ADR 0008 — mục hỏng không chặn Nguồn), và bảng tổng kết là chỗ đảm bảo nó không biến mất
    // im lặng. Loại *có tên tuổi*: nó vẫn phải có một dòng mang tên người đọc được.
    //
    // Khoá dựng được ở đây **chính là** khoá khử trùng, cùng lý do: hai Mục cùng một ô Sổ là
    // **một** Mục theo đúng định nghĩa của Sổ đã import (ADR 0006). Khử trùng bằng một phép
    // chuẩn hoá khác thì `'v x'` và `'v  x'` cùng vào một Nguồn gộp — cùng nội dung vào notebook
    // hai lần, Sổ ghi một ô, và Nguồn đã đẩy không xoá được (ADR 0010). Tính một lần rồi mang
    // theo, vì hai lời gọi `ledgerKey` ở cùng một cửa vào là hai chỗ trôi được.
    const usable = [];
    const rejected = [];
    const ledgerKeyOf = new Map();
    for (const item of incoming) {
      let key;
      try {
        key = S.ledgerKey(item && item.id, notebookId);
      } catch {
        rejected.push({ id: `(không có id #${rejected.length + 1}: ${labelOf(item) || 'không rõ'})` });
        continue;
      }
      ledgerKeyOf.set(item, key);
      usable.push(item);
    }
    const queued = S.dedupe(usable, (item) => ledgerKeyOf.get(item));

    const ledger = new Set(state.ledger);
    const log = {
      notebookId,
      queued: [...queued.map((i) => i.id), ...rejected.map((r) => r.id)],
      sources: [],
      skipped: [],
      dropped: rejected.map((r) => ({ id: r.id, stage: 'queue', reason: 'Mục hàng đợi không có id dùng được cho Sổ đã import' })),
      deferred: [],
      trace: [],
      stopped: false,
      // Lỗi không lường trước làm chết một hàng đợi giữa chừng. Rỗng ở mọi lượt chạy lành —
      // nó có mặt để một lỗi như thế *hiện ra* thay vì bốc hơi cùng cả nhật ký.
      failures: [],
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
      let result;
      try {
        result = await cfg.push(source);
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
      // Nguồn đã nằm trong notebook rồi, và extension không xoá được nó (ADR 0010). Vì vậy Sổ đã
      // import và bảng kế toán được ghi **ngay tại đây**, trước mọi phép đọc `result` bên dưới:
      // nếu một trong những phép ấy ném, thứ mất đi chỉ là *nhãn đường đẩy* — chứ không phải
      // bằng chứng rằng Nguồn này đã tồn tại. Ngược lại thì lần chạy sau đẩy nó lần thứ hai.
      //
      // Nguồn gộp vẫn ghi vào Sổ **từng mục một**, để một lần import lẻ sau đó biết là trùng
      // (ADR 0006).
      for (const item of items) ledger.add(S.ledgerKey(item.id, notebookId));
      log.sources.push(source);
      // Đường đẩy gắn vào **chính Nguồn vừa đẩy**, ngay tại lượt đẩy ấy: đó là chỗ duy nhất còn
      // biết cặp (Nguồn, đường) là của nhau. Ghép lại sau bằng thứ tự hai danh sách là mở đúng
      // cửa cho việc gán `via` của Nguồn A cho Nguồn B, mà hai chuỗi ấy cùng kiểu và cùng tập
      // giá trị hợp lệ nên bảng tổng kết vẫn đọc trôi chảy.
      source.pushVia = pushViaOf(result);
      // Cùng chỗ, cùng lý do: `source.name` là tên **ta đặt** cho đúng Nguồn này, và `result` là
      // thứ đường đẩy nói về đúng Nguồn ấy. Ghép hai thứ lại sau bằng thứ tự hai danh sách là mở
      // cửa cho cảnh báo của Nguồn A đứng dưới tên Nguồn B — hai chuỗi cùng kiểu, và bảng tổng
      // kết vẫn đọc trôi chảy trong khi nó chỉ sai đúng cái tên người dùng cần.
      source.nameWarning = nameWarningOf(source.name, result);
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

    // Một danh sách hàng đợi, dùng cho cả lúc chạy lẫn lúc đọc kết quả. Hai mảng rời nhau phải
    // khớp chỉ số là đúng hình "hai thứ cùng kiểu, mỗi thứ một vai": đảo một trong hai thì lý do
    // của hàng đợi này đứng dưới tên hàng đợi kia, và bảng tổng kết vẫn đọc trôi chảy.
    const queues = [VIDEO_QUEUE, DOCS_QUEUE];
    // `allSettled`, không phải `all`: `all` ném ngay khi hàng đợi thứ nhất chết, để hàng đợi kia
    // chạy tiếp và ghi vào một `log` mà người gọi đã không còn cầm. Ở đây cả hai chạy hết rồi mới
    // tính sổ.
    const runs = await Promise.allSettled(queues.map((queue) => runOne(queue, byQueue[queue])));
    await pushChain;
    queues.forEach((queue, index) => {
      if (runs[index].status === 'rejected') {
        log.failures.push({ queue, reason: messageOf(runs[index].reason) });
      }
    });

    // Một lỗi không lường trước ở giữa vòng chạy **không được ném ra ngoài**: người gọi ghi
    // `log.state` xuống storage ngay sau khi `runQueue` trả về, nên một exception là mất trắng
    // Sổ đã import vừa cập nhật — và những Nguồn đã đẩy sẽ bị đẩy lại ở lần sau, mà Nguồn đã đẩy
    // thì không xoá được (ADR 0010). Cửa vào ở trên chỉ chặn được ca đã biết; đây mới là chỗ
    // chặn được cả ca chưa nghĩ tới.
    //
    // Đổi lại, lỗi phải *hiện ra*: nó vào bảng tổng kết (ADR 0008), và mọi Mục chưa kịp ra ở
    // đâu được trả về hàng đợi kèm một dòng — nếu không chúng biến mất khỏi phép kế toán.
    if (log.failures.length) {
      const accounted = new Set();
      for (const source of log.sources) for (const id of source.itemIds) accounted.add(id);
      for (const entry of [...log.skipped, ...log.dropped, ...log.deferred]) accounted.add(entry.id);
      for (const item of queued) {
        if (accounted.has(item.id)) continue;
        log.deferred.push({ id: item.id, reason: 'lượt chạy hỏng giữa chừng' });
        requeue(item);
      }
    }

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
    // Đếm theo **Nguồn đã tạo**, không theo lượt đẩy đã thử: một lượt đẩy ném ra thì không có
    // Nguồn nào trong notebook, và đếm nó vào đây là báo một con số "đã rơi về đường lui" gồm
    // cả những Nguồn chưa hề tồn tại.
    //
    // Đếm bằng `Map`, không bằng object trần, và đó không phải chuyện sạch sẽ: trên một object
    // literal thì `counts['constructor'] || 0` lấy được **hàm** `Object` nên phép cộng thành
    // phép nối chuỗi, còn `counts['__proto__'] = 1` bị setter nuốt lặng và Nguồn ấy **biến mất
    // khỏi phép đếm** — đúng hạng hỏng âm thầm mà cả bảng tổng kết này tồn tại để chặn
    // (ADR 0008). `Map` không có prototype để đụng vào; bản đổ ra vẫn là object thuần JSON.
    const viaCounts = new Map();
    let unnamed = 0;
    for (const source of log.sources) {
      const via = source.pushVia || '';
      viaCounts.set(via, (viaCounts.get(via) || 0) + 1);
      if (source.nameWarning) unnamed += 1;
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
      failures: (log.failures || []).length,
      pushVia: Object.fromEntries(viaCounts),
      unnamed,
      words: log.sources.reduce((sum, s) => sum + s.words, 0),
      stopped: log.stopped,
      leaked,
      duplicated,
      balanced: leaked.length === 0 && duplicated.length === 0,
    };
  }

  /**
   * Phần trong ngoặc của dòng "Nguồn đã tạo": bao nhiêu Nguồn đi đường nào.
   *
   * Sắp theo khoá để thứ tự không đổi theo thứ tự đẩy — một bảng tổng kết đổi thứ tự giữa hai
   * lần chạy giống nhau là một bảng không so được với lần trước. Rỗng khi chưa Nguồn nào ra đời.
   */
  function pushViaTally(counts) {
    const keys = Object.keys(counts || {}).sort();
    if (keys.length === 0) return '';
    return ` (${keys.map((via) => `${counts[via]} ${pushViaLabel(via)}`).join(', ')})`;
  }

  /** Bảng tổng kết dạng chữ, để popup và log cùng đọc được. */
  function formatSummary(log) {
    const s = log.summary || summarize(log);
    const lines = [
      `Notebook đích: ${log.notebookId}`,
      `Hàng đợi: ${s.queued} mục — ${s.imported} đã import, ${s.skipped} bỏ qua, ${s.dropped} rớt`
        + `${s.deferred ? `, ${s.deferred} còn nợ` : ''}`,
      `Nguồn đã tạo: ${s.sources}${pushViaTally(s.pushVia)}`,
    ];
    // Đường đẩy đi cùng **từng** dòng Nguồn, không chỉ nằm ở con số tổng: hai Nguồn hoán vị
    // đường cho nhau vẫn cho đúng cùng một con số tổng, nên con số một mình không phân biệt
    // được. Dòng này là chỗ duy nhất nói được "Nguồn NÀY đi đường nào".
    for (const source of log.sources) {
      lines.push(`  + ${source.name}: ${source.itemIds.length} mục, ${source.words} từ`
        + `${source.overflow ? ' (vượt trần)' : ''} — ${pushViaLabel(source.pushVia)}`);
    }
    // Tên Nguồn đứng thành mục riêng chứ không nối vào dòng của chính nó: đây là câu duy nhất
    // trong cả bảng mà người dùng **không sửa lại được** (ADR 0010 — extension không sửa, không
    // xoá Nguồn), nên nó phải đọc được ở dạng một danh sách ngắn thay vì nằm cuối một dòng dài.
    // Con số ở đầu mục lấy từ phép đếm của `summarize`, còn các dòng lấy từ `log.sources`: hai
    // đường, nên một phép đếm lệch hiện ra thành đầu mục nói khác thân mục.
    const unnamed = log.sources.filter((source) => source.nameWarning);
    if (unnamed.length) {
      lines.push(`Tên Nguồn KHÔNG theo ý ta — ${s.unnamed} Nguồn (NotebookLM tự đặt, và tên Nguồn là vĩnh viễn):`);
      for (const source of unnamed) lines.push(`  ! ${source.name}: ${source.nameWarning}`);
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
    // Lượt chạy chết giữa chừng là câu người dùng phải đọc được, không phải một exception nuốt cả
    // bảng: những Nguồn đã liệt kê ở trên **đã vào notebook rồi** và không xoá được (ADR 0010),
    // nên câu này nói luôn rằng Sổ đã import giữ chúng lại — đó là thứ ngăn lần chạy sau đẩy trùng.
    if (log.failures && log.failures.length) {
      lines.push(`LƯỢT CHẠY HỎNG GIỮA CHỪNG — Sổ đã import vẫn giữ ${s.sources} Nguồn đã đẩy:`);
      for (const entry of log.failures) lines.push(`  ! hàng đợi ${entry.queue}: ${entry.reason}`);
    }
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
