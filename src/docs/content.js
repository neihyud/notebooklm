// Đầu bên **tab tài liệu** của đường đi ticket 010: gọi Bảng chọn ra, và trích một trang.
//
// Không nạp bằng `content_scripts` như hai lớp kia, mà được `chrome.scripting.executeScript`
// tiêm vào khi người dùng gọi Bảng chọn. Lý do là bản chất: trang tài liệu có thể là *bất cứ*
// site nào, nên khai `matches` cho nó nghĩa là chạy code trên mọi trang web người dùng mở, suốt
// ngày, chỉ để chờ một phím tắt.
//
// Vì sao khâu trích chạy ở đây chứ không ở service worker — chỗ mọi việc còn lại của hàng đợi
// đang chạy: cả hai nấc của `src/docs/extract.js` so **cây node**, mà service worker của MV3
// không có `DOMParser` để dựng cây từ HTML. Tab thì có. Đổi lại, tab ẩn của nấc 2 chỉ
// `chrome.tabs` mới lái được, nên nấc 2 nằm hai bên và nói chuyện qua `DOC_TAB_READ`/`DOC_TAB_GO`.
//
// Hợp đồng mà `readViaTab` viết trong doc comment từ ticket 008 và tới đây mới có adapter thật
// để cưỡng chế: **`read()` phải trả lời được TRƯỚC `go()`**. Ảnh chụp trước lúc điều hướng là
// mốc duy nhất phân biệt "trang mới chưa render xong" với "trang cũ đã đứng yên từ lâu" — với
// docsify thì `#/a → #/b` không tải lại trang, nên URL đổi trước DOM. Một adapter chỉ dựng được
// tab ẩn *bên trong* `go()` sẽ để `read()` đầu tiên trả về rỗng, mốc ấy thành `''`, và cổng mở
// sớm ở đúng những trang nấc 2 sinh ra để cứu.
//
// File này không mang selector nào (chúng ở `src/docs/selectors.js`) và không mang logic trích
// nào (nó ở `extract.js`). Của riêng nó là kỷ luật định tuyến và hai adapter — `test/docs-content.test.js`.
(function (root) {
  'use strict';

  if (root.NBLM_DOCS_CONTENT) return;

  const S = root.NBLM_SHARED;
  const M = root.NBLM_MESSAGES;
  const D = root.NBLM_DOCS_SELECTORS;
  const X = root.NBLM_DOCS_EXTRACT;
  const K = root.NBLM_DOCS_PICKER;
  if (!S) throw new Error('docs/content: cần src/common/shared.js nạp trước');
  if (!M) throw new Error('docs/content: cần src/common/messages.js nạp trước');
  if (!D) throw new Error('docs/content: cần src/docs/selectors.js nạp trước');
  if (!X) throw new Error('docs/content: cần src/docs/extract.js nạp trước');
  if (!K) throw new Error('docs/content: cần src/docs/picker.js nạp trước');

  const messageOf = (error) => (error && error.message ? String(error.message) : String(error));

  /** Cây node của một chuỗi HTML — chỉ tab mới làm được việc này, xem đầu file. */
  const parseBody = (target, html) =>
    new target.DOMParser().parseFromString(String(html == null ? '' : html), 'text/html').body;

  /**
   * Nấc 1: `fetch` ngay trong tab tài liệu.
   *
   * `credentials: 'same-origin'` là cả lý do nấc này tồn tại — request đi kèm cookie phiên nên
   * docs nội bộ cần đăng nhập vẫn đọc được (spec 0001, story 19). Bỏ nó đi thì trang nội bộ trả
   * về trang đăng nhập, mà một trang đăng nhập cũng là một trang HTML hợp lệ đầy chữ.
   *
   * Lỗi HTTP phải **ném**: trang 404 của nhiều bộ dựng docs là một trang đầy đủ khung, và nếu
   * coi nó là nội dung thì Nguồn mang đúng chữ "không tìm thấy trang" dưới tên trang thật.
   */
  function sameOriginTier(target) {
    return async (requestedUrl) => {
      const response = await target.fetch(requestedUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`máy chủ trả ${response.status}`);
      const html = await response.text();
      // `response.url` chứ không phải URL đã gõ: redirect là chuyện thường, và `readAt` chốt lại
      // rằng nội dung đọc được đúng là của trang được yêu cầu.
      return { url: S.collapse(response.url) || requestedUrl, root: parseBody(target, html) };
    };
  }

  /**
   * Nấc 2: tab ẩn, do service worker lái qua hai loại tin.
   *
   * `read()` không dựng gì và không đợi gì — nó hỏi service worker ảnh chụp **hiện tại** của tab
   * ẩn, kể cả khi tab ấy còn đang đứng ở trang trước. Đó chính là hợp đồng ở đầu file: lượt đọc
   * đầu tiên xảy ra trước `go()`, và nó là mốc "trang cũ" của cả vòng chờ.
   */
  function hiddenTabTier(target, ask) {
    const demand = async (message, what) => {
      const answer = await ask(message);
      if (!answer || !answer.ok) throw new Error(`nấc 2: ${what} (${(answer && answer.error) || 'không trả lời'})`);
      return answer.result || {};
    };
    return {
      read: async () => {
        const shot = await demand({ type: M.TYPES.DOC_TAB_READ }, 'không đọc được tab ẩn');
        return { url: S.collapse(shot.url), root: parseBody(target, shot.html) };
      },
      go: async (url) => {
        await demand({ type: M.TYPES.DOC_TAB_GO, url }, 'không điều hướng được tab ẩn');
      },
    };
  }

  /**
   * `undefined` nghĩa là **im lặng**: tin không phải của listener này (spec 0001).
   *
   * Ba content script có thể gặp nhau trên cùng một tab — một trang docs *là* một trang bất kỳ,
   * nên nó cũng có thể là một trang YouTube — và Chrome lấy phản hồi đến trước.
   */
  function handleMessage(message, deps) {
    if (!M.isFor('docs', message)) return undefined;
    const type = M.typeOf(message);
    if (type === M.TYPES.PING_DOCS) return Promise.resolve({ ok: true, result: { page: deps.pageId() } });

    return (async () => {
      try {
        if (type === M.TYPES.OPEN_DOC_PICKER) {
          const controller = await deps.openPicker();
          // `null` nghĩa là trang này không có định danh trang nào đọc được (`about:`, `file:`…).
          // Báo thành công ở đây là để người dùng nhìn màn hình không có gì và không hiểu vì sao.
          if (!controller) throw new Error('trang này không phải một trang tài liệu đọc được');
          const state = controller.state();
          return { ok: true, result: { pages: state.tree.total, outcome: state.outcome } };
        }
        if (type === M.TYPES.EXTRACT_DOC) {
          return { ok: true, result: await deps.extractDoc(message.url) };
        }
        throw M.unrouted('docs', message);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    })();
  }

  /**
   * Bộ selector và ngưỡng, đọc lại **mỗi lượt**: người dùng sửa ở trang Cài đặt vì một trang
   * *đang* trích hỏng, nên bắt họ tải lại tab mới thấy tác dụng là bắt sai người.
   */
  async function pageOptions(target, extra) {
    const area = target.chrome.storage && target.chrome.storage.sync;
    const bag = area ? await area.get('settings') : null;
    const settings = (bag && bag.settings) || {};
    return {
      settings,
      selectors: D.resolve({ ...(settings.selectorOverrides || {}), labels: settings.labelOverrides || {} }),
      // Bề ngang khung nhìn: `narrowness` trả 0 khi không đo được, nên thiếu chỗ này là dấu hiệu
      // "cột hẹp" của `findSidebar` chết lặng trên mọi trang thật.
      metrics: { viewport: () => Number(target.innerWidth) || 0 },
      ...(extra || {}),
    };
  }

  /**
   * Cài vào một tab tài liệu và trả về bộ adapter — **trả về**, chứ không chỉ đăng ký listener.
   *
   * `given` chỉ để mở seam: mặc định vẫn là adapter thật, nên hành vi trên trang không đổi.
   */
  function install(target, given) {
    const chrome_ = target.chrome;
    if (!chrome_ || !chrome_.runtime) return null;
    const options = (given && given.options) || {};
    const ask = (message) => chrome_.runtime.sendMessage(message);

    /**
     * Bộ tuỳ chọn **sống** của Bảng chọn: đúng một object đi vào bộ điều khiển, và mỗi lượt mở
     * đổ nội dung mới của `pageOptions` vào đó.
     *
     * Hai đường đi từ trang Cài đặt ra ngoài — một cho khâu trích, một cho khâu dò sidebar — và
     * cả hai phải lấy từ **cùng một chỗ dựng**. Viết tay một object thứ hai ở đây là chỗ hai
     * đường lệch nhau: nó dễ chép thiếu đúng vế `selectors`, mà `selectorsOf` của
     * `src/docs/sidebar.js` thì rơi về mặc định khi thiếu — im lặng. Người dùng khai
     * `selectorOverrides` vì theme của họ không dò được sidebar, trích một trang lẻ thì thấy có
     * tác dụng, còn Bảng chọn thì mãi mãi không.
     *
     * Đổ vào tại chỗ chứ không dựng lại Bảng chọn: `createController` giữ tham chiếu này và đọc
     * lại nó ở mỗi `open()`, nên sửa Cài đặt rồi mở lại là có tác dụng ngay mà không mất những
     * mục đang tick.
     */
    const pickerOptions = {};

    const picker = K.install(target, {
      makeController: given && given.makeController,
      options: pickerOptions,
      // Lối ra duy nhất của Bảng chọn. `page` đi kèm vì hàng đợi lấy tên site từ nó, và tên site
      // là vế `<Site>` của một tên Nguồn vĩnh viễn (ADR 0010).
      send: (pages) => ask({ type: M.TYPES.IMPORT_DOCS, pages, page: target.location.href }),
    });

    const deps = {
      pageId: () => S.docPageId(target.location.href),
      openPicker: async () => {
        Object.assign(pickerOptions, await pageOptions(target, options));
        return picker && picker.open();
      },
      extractDoc: async (url) => X.fetchDocPage(
        { url },
        { sameOrigin: sameOriginTier(target), tab: hiddenTabTier(target, ask) },
        await pageOptions(target, options),
      ),
    };

    chrome_.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const answer = handleMessage(message, deps);
      if (!answer) return false; // im lặng với tin không phải của mình
      answer.then(sendResponse);
      return true; // giữ kênh mở cho câu trả lời async
    });

    return deps;
  }

  root.NBLM_DOCS_CONTENT = Object.freeze({
    parseBody,
    sameOriginTier,
    hiddenTabTier,
    handleMessage,
    install,
  });

  // Cùng dòng cuối với `src/youtube/watch.js` và `src/notebooklm/content.js`, và vì cùng một lý
  // do: file này được **nạp** vào tab chứ không được ai gọi. Thiếu nó thì `executeScript` nạp đủ
  // tám file, không listener nào đăng ký, `waitForTab(PING_DOCS)` chờ hết 10s rồi bỏ cuộc — mà
  // mọi test vẫn xanh vì test nào cũng gọi thẳng `install(…)`. `test/manifest.test.js` canh
  // chỗ này bằng cách nạp cả chuỗi vào một ngữ cảnh sạch, đúng như Chrome làm.
  if (root.document && root.chrome && root.chrome.runtime) install(root);
})(typeof globalThis !== 'undefined' ? globalThis : self);
