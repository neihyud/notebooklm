/*
 * Bề mặt (a)(b)(c) trên YouTube — trang watch, thanh nổi chọn hàng loạt, và
 * bảng "Import toàn bộ".
 *
 * Vì sao file này tồn tại: tới trước ticket 006, `src/youtube/content.js` không
 * có MỘT DÒNG test nào. Đo 2026-08-28 — `test/run.sh` chạy `test/*.test.js`, và
 * không file nào trong đó nạp `content.js`; phía YouTube chỉ `srt.js` và
 * `transcript.js` được phủ. Ba lối vào chính của extension chạy trần.
 *
 * Cái file này chứng nhận, và cái nó KHÔNG chứng nhận:
 *   - CÓ: cú bấm nào gửi tin gì lên background, với đối số nào; huy hiệu đọc ra
 *     mức riêng tư nào; hộp xác nhận trả lời gì thì hành động gì xảy ra.
 *   - KHÔNG: selector có khớp DOM thật của YouTube hay không. Markup trong
 *     harness do tôi gõ, nên một test như thế chỉ chứng nhận thứ tôi vừa gõ —
 *     đúng rủi ro số 1 trong `WORKSPACE_PROTOCOL.md`. Chỉ `tools/verify-live.mjs`
 *     trả lời được câu đó.
 */
const { loadYouTubePage, videoCard, WATCH_ROW } = require('./dom-harness.js');

let pass = 0, fail = 0;
const ok = (cond, m) => (cond ? pass++ : (fail++, console.log(`❌ ${m}`)));
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want), `${m}\n   nhận: ${JSON.stringify(got)}\n   cần : ${JSON.stringify(want)}`);

const meta = (over = {}) =>
  Object.assign({ title: 'Tiêu đề', channel: 'Kênh', durationSec: 90, privacy: 'public', hasCaptions: true }, over);

async function run() {
  /* ================================================================== */
  /* (a) trang watch — nút "NotebookLM" và nút "Transcript"             */
  /* ================================================================== */

  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async () => meta(),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply(() => ({ added: 1 }));
    await h.tick(80);

    ok(!!h.$('#nblm-watch-button'), '(a) phải chèn nút NotebookLM vào hàng nút của trang watch');
    ok(!!h.$('#nblm-transcript-button'), '(a) phải chèn nút Transcript');
    eq(h.$('#nblm-watch-button').dataset.videoId, 'aaaaaaaaaaa', '(a) nút phải mang videoId của trang');

    h.click('#nblm-watch-button');
    await h.tick(80);

    eq(h.calls.describe, ['aaaaaaaaaaa'], '(a) bấm nút phải hỏi metadata đúng videoId');
    eq(h.sent.length, 1, '(a) một cú bấm gửi đúng một tin');
    eq(h.sent[0].type, 'enqueue', '(a) tin phải là enqueue');
    eq(h.sent[0].items, [{
      videoId: 'aaaaaaaaaaa', title: 'Tiêu đề', channel: 'Kênh',
      durationSec: 90, privacy: 'public', hasCaptions: true,
    }], '(a) Mục xếp hàng phải mang nguyên metadata đọc được');
  }

  /*
   * Video private: vẫn xếp hàng, và phải nói ra rằng transcript được trích tại
   * máy. Câu đó là cam kết ở README, không phải lời trấn an — nếu nó biến mất
   * thì người dùng không còn cách nào biết extension không đổi chế độ hiển thị.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async () => meta({ privacy: 'private' }),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply(() => ({ added: 1 }));
    await h.tick(80);
    h.click('#nblm-watch-button');
    await h.tick(80);

    eq(h.sent[0].items[0].privacy, 'private', '(a) privacy private phải đi theo Mục');
    ok(/private/i.test(h.toast()) && /máy bạn/i.test(h.toast()),
      `(a) video private phải báo rằng transcript trích tại máy — toast nhận được: "${h.toast()}"`);
  }

  /*
   * `describe` hỏng thì vẫn xếp hàng với privacy `unknown` — background sẽ tự mở
   * tab đọc lại. Fail-open ở ĐÂY là đúng, vì Mục còn đi qua `resolveMeta` phía
   * service worker trước khi tới `planFor`.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async () => { throw new Error('không đọc được player'); },
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply(() => ({ added: 1 }));
    await h.tick(80);
    h.click('#nblm-watch-button');
    await h.tick(80);

    eq(h.sent[0].items, [{ videoId: 'aaaaaaaaaaa', privacy: 'unknown' }],
      '(a) describe hỏng thì vẫn xếp hàng, privacy unknown');
    ok(/chưa đọc được metadata/.test(h.toast()), `(a) phải nói ra vì sao thiếu metadata — nhận: "${h.toast()}"`);
  }

  /* Nút Transcript chỉ đóng/mở bảng, không xếp hàng gì cả. */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async () => meta(),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.click('#nblm-transcript-button');
    eq(h.calls.panel, [{ act: 'open', videoId: 'aaaaaaaaaaa', langs: ['vi', 'en'] }],
      'nút Transcript phải mở bảng với ngôn ngữ ưu tiên trong settings');
    h.click('#nblm-transcript-button');
    eq(h.calls.panel[1], { act: 'close' }, 'bấm lần hai phải đóng bảng');
    eq(h.sent, [], 'nút Transcript không được xếp hàng gì');
  }

  /* ================================================================== */
  /* (b) thanh nổi chọn hàng loạt                                        */
  /* ================================================================== */

  const listBody = [
    videoCard('vidpublic01', 'Công khai'),
    videoCard('vidprivat02', 'Riêng tư', 'Private'),
    videoCard('vidunlist03', 'Không công khai', 'Unlisted'),
  ].join('');

  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);

    const boxes = h.$$('.nblm-pick input');
    eq(boxes.length, 3, '(b) mỗi thẻ video phải được gắn một checkbox');
    ok(!h.$('#nblm-bar'), '(b) chưa tick gì thì chưa hiện thanh nổi');

    boxes[0].checked = true;
    boxes[0].dispatchEvent(new h.win.Event('change'));
    ok(!!h.$('#nblm-bar'), '(b) tick một video phải hiện thanh nổi');
    ok(/1 video đã chọn/.test(h.$('.nblm-bar__count').textContent), '(b) thanh nổi phải đếm đúng');

    h.reply(() => ({ added: 1 }));
    h.click('[data-act="import"]');
    await h.tick(80);

    eq(h.sent.length, 1, '(b) bấm Import gửi đúng một tin');
    eq(h.sent[0].items, [{ videoId: 'vidpublic01', title: 'Công khai', privacy: 'unknown' }],
      '(b) video không huy hiệu phải đi với privacy unknown — huy hiệu vắng mặt KHÔNG có nghĩa là công khai');
    ok(!h.$('#nblm-bar'), '(b) import xong phải bỏ chọn và gỡ thanh nổi');
  }

  /*
   * Huy hiệu đọc ra mức riêng tư. `readItem` dùng một cặp regex chạy SAU `norm()`
   * (bỏ dấu), khác hẳn cặp của `privacyFromRenderer` phía page-bridge — hai bộ
   * đọc, hai luật. Ghim cả hai nhãn để sửa một chỗ mà quên chỗ kia thì thấy ngay.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.reply(() => ({ added: 3 }));
    h.$$('.nblm-pick input').forEach((b) => { b.checked = true; b.dispatchEvent(new h.win.Event('change')); });
    h.click('[data-act="import"]');
    await h.tick(80);

    eq(h.sent[0].items.map((i) => [i.videoId, i.privacy]), [
      ['vidpublic01', 'unknown'],
      ['vidprivat02', 'private'],
      ['vidunlist03', 'unlisted'],
    ], '(b) huy hiệu Private/Unlisted phải đọc ra đúng mức, không huy hiệu thì unknown');
  }

  /* "Chọn hết trang" tick mọi thẻ ĐANG có trong DOM — kể cả trăm thẻ đã cuộn qua. */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    const first = h.$$('.nblm-pick input')[0];
    first.checked = true;
    first.dispatchEvent(new h.win.Event('change'));

    h.click('[data-act="all"]');
    eq(h.$$('.nblm-pick input').filter((b) => b.checked).length, 3, '(b) "Chọn hết trang" phải tick mọi thẻ');
    ok(/3 video đã chọn/.test(h.$('.nblm-bar__count').textContent), '(b) đếm phải cập nhật sau khi chọn hết');

    h.click('[data-act="clear"]');
    eq(h.$$('.nblm-pick input').filter((b) => b.checked).length, 0, '(b) "Bỏ chọn" phải gỡ hết tick');
    ok(!h.$('#nblm-bar'), '(b) bỏ chọn hết thì thanh nổi biến mất');
  }

  /* Tắt `bulkSelectUI` là gỡ sạch giao diện chèn thêm, không để lại checkbox mồ côi. */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      settings: { bulkSelectUI: false },
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    eq(h.$$('.nblm-pick').length, 0, '(b) tắt bulkSelectUI thì không gắn checkbox nào');
  }

  /* ================================================================== */
  /* (c) Import toàn bộ playlist / kênh                                  */
  /* ================================================================== */

  const playlistCtx = { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' };
  const playlistItems = {
    items: [
      { videoId: 'vidpublic01', title: 'Công khai', privacy: 'public', accessible: true },
      { videoId: 'vidprivat02', title: 'Riêng tư', privacy: 'private', accessible: true },
      { videoId: 'vidblocked3', title: 'Không xem được', privacy: 'private', accessible: false },
    ],
  };

  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      bridge: async (kind) => (kind === 'context' ? playlistCtx : playlistItems),
    });
    await h.tick(80);

    ok(!!h.$('[data-act="all-import"]'), '(c) trang playlist phải có nút Import toàn bộ');
    h.click('[data-act="all-import"]');
    await h.tick(80);

    const dialog = h.$('.nblm-modal');
    ok(!!dialog, '(c) phải hiện hộp xác nhận trước khi xếp hàng');
    const text = dialog.textContent;
    ok(/2 video/.test(text), `(c) phải đếm video import được (accessible), nhận: "${text}"`);
    ok(/1 video private/.test(text), '(c) phải nói riêng số video private của chính mình');
    ok(/1 video bị bỏ qua/.test(text), '(c) phải nói số video không có quyền xem');
    eq(h.sent, [], '(c) chưa xác nhận thì chưa gửi gì lên background');

    h.click('.nblm-modal__btn:not(.nblm-modal__btn--primary)');
    await h.tick(60);
    ok(!h.$('.nblm-modal'), '(c) bấm Huỷ phải đóng hộp');
    eq(h.sent, [], '(c) bấm Huỷ thì không xếp hàng gì cả');
  }

  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      bridge: async (kind) => (kind === 'context' ? playlistCtx : playlistItems),
    });
    await h.tick(80);
    h.reply(() => ({ added: 2 }));
    h.click('[data-act="all-import"]');
    await h.tick(80);
    h.click('.nblm-modal__btn--primary');
    await h.tick(80);

    eq(h.sent.length, 1, '(c) xác nhận rồi mới gửi đúng một tin');
    eq(h.sent[0].items.map((i) => i.videoId), ['vidpublic01', 'vidprivat02'],
      '(c) chỉ video accessible mới được xếp hàng');
  }

  /* Playlist rỗng phải NÓI RA — tiền lệ `importEverything`, không phải im lặng như `enqueue`. */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      bridge: async (kind) => (kind === 'context' ? playlistCtx : { items: [] }),
    });
    await h.tick(80);
    h.click('[data-act="all-import"]');
    await h.tick(80);

    ok(!h.$('.nblm-modal'), '(c) không có video nào thì không hiện hộp xác nhận');
    ok(/Không tìm thấy video nào/.test(h.toast()), `(c) phải báo ra khi rỗng — nhận: "${h.toast()}"`);
    eq(h.sent, [], '(c) rỗng thì không gửi gì');
  }

  /* Quét hỏng: báo lỗi, và trả nút về trạng thái bấm lại được. */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody,
      bridge: async (kind) => {
        if (kind === 'context') return playlistCtx;
        throw new Error('InnerTube từ chối');
      },
    });
    await h.tick(80);
    h.click('[data-act="all-import"]');
    await h.tick(80);

    ok(/InnerTube từ chối/.test(h.toast()), `(c) lỗi quét phải hiện nguyên văn — nhận: "${h.toast()}"`);
    ok(!h.$('[data-act="all-import"]').disabled, '(c) quét hỏng rồi vẫn phải bấm lại được');
  }

  /* ================================================================== */
  /* router tin nhắn — ba content script gặp nhau trên một tab           */
  /* ================================================================== */

  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async () => meta(),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);

    eq(await h.dispatch({ type: 'yt-ping' }), { ok: true, videoId: 'aaaaaaaaaaa' },
      'router phải trả lời yt-ping');
    eq(await h.dispatch({ type: 'yt-describe', videoId: 'bbbbbbbbbbb' }), { ok: true, meta: meta() },
      'router phải trả lời yt-describe');

    /*
     * Tin của script khác: listener phải trả `false` NGAY và không đụng
     * `sendResponse`. Trả lời hộ là cướp mất phản hồi của content script kia —
     * Chrome lấy câu đến trước — và chuyện đó đã giết một tab thật rồi.
     */
    let answered = false;
    const result = await new Promise((resolve) => {
      const ret = h.dispatch({ type: 'nlm-ping' });
      ret.then(() => (answered = true));
      setTimeout(() => resolve(answered), 30);
    });
    ok(result === false, 'router KHÔNG được trả lời tin của content script khác (nlm-ping)');
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
