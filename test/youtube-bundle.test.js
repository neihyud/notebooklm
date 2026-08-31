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

/*
 * `playable` có mặt ở đây là CỐ Ý, và nó đã bắt được một lỗi của chính file này:
 * bản fixture đầu tiên thiếu trường đó, và mọi test Đường trao tay đỏ với lý do
 * "không hỏi được". Đúng như thiết kế — `bundleVerdict` đòi đủ ba điều kiện và
 * fail-closed, nên một meta thiếu trường không được coi là công khai.
 */
/*
 * Đọc Mục của tin đã gửi mà KHÔNG crash khi không có tin nào.
 *
 * Không phải phòng thủ thừa: đo 2026-08-28, gỡ cửa 1 khỏi `buildBundle` làm ba
 * assertion đỏ rồi `h.sent[0].items` ném `TypeError`, và cú ném đó nuốt luôn số
 * pass/fail của cả file. Một hoán vị mà kết quả là "không in ra gì" thì không đo
 * được thiệt hại — đúng bài học của `docs/adr/0001-duong-trao-tay.md`.
 */
const sentItems = (h, i = 0) => ((h.sent[i] && h.sent[i].items) || []);

/*
 * Từ mục 3 trở đi, một cú bấm copy gửi tới BA loại tin: `bundle-filter` (cửa 2),
 * `bundle-copied` (ghi Sổ), và `enqueue` cho phần bị loại. Đọc `h.sent[0]` là
 * đọc nhầm tin — lọc theo loại, đừng đếm theo thứ tự.
 */
const enq = (h) => h.sent.filter((m) => m.type === 'enqueue');
const enqItems = (h, i = 0) => ((enq(h)[i] && enq(h)[i].items) || []);
const msgs = (h, type) => h.sent.filter((m) => m.type === type);

/*
 * Bản tổng kết của một Bó đi KÈM CÚ NHẢY, không ở lại tab YouTube.
 *
 * Đọc `h.toast()` cho ca nhảy được là đọc một bản báo cáo trên tab vừa bị bỏ
 * lại: `jumpToNotebook` bật tab notebook lên rồi focus cửa sổ. Assertion cũ ghim
 * đúng chỗ đó, tức nó chứng nhận một chuỗi người dùng không bao giờ nhìn thấy —
 * và phần đáng đọc nhất của chuỗi ấy là số video rơi về Hàng đợi.
 */
const summary = (h) => {
  const m = msgs(h, 'jump-notebook').pop();
  return (m && m.summary) || '';
};

const meta = (over = {}) =>
  Object.assign(
    { title: 'Tiêu đề', channel: 'Kênh', durationSec: 90, privacy: 'public', hasCaptions: true, playable: true },
    over
  );

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

    eq(h.calls.describe.map((c) => c.videoId), ['aaaaaaaaaaa'], '(a) bấm nút phải hỏi metadata đúng videoId');
    eq(h.sent.length, 1, '(a) một cú bấm gửi đúng một tin');
    eq(h.sent[0].type, 'enqueue', '(a) tin phải là enqueue');
    eq(sentItems(h), [{
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

    eq((sentItems(h)[0] || {}).privacy, 'private', '(a) privacy private phải đi theo Mục');
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

    eq(sentItems(h), [{ videoId: 'aaaaaaaaaaa', privacy: 'unknown' }],
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
    eq(sentItems(h), [{ videoId: 'vidpublic01', title: 'Công khai', privacy: 'unknown' }],
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

    eq(sentItems(h).map((i) => [i.videoId, i.privacy]), [
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
    eq(sentItems(h).map((i) => i.videoId), ['vidpublic01', 'vidprivat02'],
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
  /* Đường trao tay — Bó link vào clipboard                              */
  /* ================================================================== */

  /* --- (a) nút thứ ba trên trang watch ----------------------------- */

  {
    const asked = [];
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id, opts) => { asked.push({ id, opts }); return meta({ videoId: id }); },
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);

    ok(!!h.$('#nblm-copy-button'), '(a) phải có nút Copy link, và là nút THỨ BA');
    ok(!!h.$('#nblm-watch-button'), '(a) nút NotebookLM cũ phải còn nguyên');
    eq(h.$('#nblm-watch-button').nextElementSibling.id, 'nblm-copy-button',
      '(a) nút Copy link đứng sau nút NotebookLM');

    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(h.clipboard.writes, ['https://www.youtube.com/watch?v=aaaaaaaaaaa'],
      '(a) video công khai phải vào clipboard dưới dạng watch?v= — dạng duy nhất có báo cáo chạy được');
    eq(asked[0].opts, { noFallback: true },
      '(a) cửa 3 phải tắt nhánh tải trang watch: một lượt hỏi hỏng không được thành một lượt tải HTML đầy đủ');
    eq(enq(h), [], '(a) link đã vào clipboard thì KHÔNG xếp hàng nữa — Đường trao tay dừng ở đó');
    ok(/1 link công khai/.test(summary(h)),
      `(a) phải nói đã copy mấy link, và nói trong bản tổng kết đi kèm cú nhảy — nhận: "${summary(h)}"`);
    eq(h.toast(), '',
      '(a) nhảy được rồi thì KHÔNG dựng toast ở tab này nữa — tab YouTube vừa thành tab nền, không ai đọc');
    h.close();
  }

  /*
   * Video private trên trang watch: KHÔNG chạm clipboard, và rơi về Hàng đợi.
   * Đây là chốt duy nhất giữ `README.md:15` còn đúng trên đường này — Bó link bỏ
   * hẳn service worker ra ngoài nên `planFor` không đi theo.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id, privacy: 'private' }),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(h.clipboard.writes, [], '(a) video private KHÔNG được chạm clipboard');
    eq(enq(h).length, 1, '(a) video private phải rơi về Hàng đợi');
    eq(enqItems(h), [{ videoId: 'aaaaaaaaaaa', title: 'Tiêu đề', privacy: 'private' }],
      '(a) Mục rơi về Hàng đợi mang theo `meta` cửa 3 vừa mua được — không phải một dòng trống');
    ok(/private/.test(h.toast()), `(a) phải nói ra vì sao không copy được — nhận: "${h.toast()}"`);
    h.close();
  }

  /* Hỏi không được thì cũng không đoán: Hàng đợi, và nói rõ đó là hạng khác. */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async () => { throw new Error('InnerTube từ chối'); },
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(h.clipboard.writes, [], '(a) hỏi không được thì KHÔNG copy — fail-closed');
    eq(enq(h).length, 1, '(a) hỏi không được thì rơi về Hàng đợi');
    ok(/không hỏi được/.test(h.toast()),
      `(a) "không hỏi được" phải tách khỏi "private" — hai hạng, hai cách xử lý. Nhận: "${h.toast()}"`);
    h.close();
  }

  /* --- (b) thanh nổi ------------------------------------------------ */

  const listBody2 = [
    videoCard('vidpublic01', 'Công khai một'),
    videoCard('vidpublic02', 'Công khai hai'),
    videoCard('vidprivat03', 'Riêng tư', 'Private'),
  ].join('');

  {
    const asked = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody2,
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.$$('.nblm-pick input').forEach((b) => { b.checked = true; b.dispatchEvent(new h.win.Event('change')); });

    ok(!!h.$('[data-act="copy"]'), '(b) thanh nổi phải có nút Copy link');
    h.click('[data-act="copy"]');
    await h.tick(120);

    eq(h.clipboard.writes, ['https://www.youtube.com/watch?v=vidpublic01\nhttps://www.youtube.com/watch?v=vidpublic02'],
      '(b) Bó link là URL trần, mỗi dòng một cái, không tiêu đề không dòng trống');
    eq(asked.sort(), ['vidpublic01', 'vidpublic02'],
      '(b) cửa 1 phải loại video có huy hiệu Private mà KHÔNG tốn một request nào');
    eq(enq(h).length, 1, '(b) video bị loại phải rơi về Hàng đợi');
    eq(enqItems(h).map((i) => i.videoId), ['vidprivat03'], '(b) chỉ video bị loại mới xếp hàng');
    h.close();
  }

  /*
   * Hoán vị 1 của mục acceptance: danh sách của (b) và của (c).
   *
   * Cả hai đều trả một mảng URL cùng hình dạng, nên assert *kết quả* xanh cả hai
   * chiều. Cái ghim được là **cú bấm nào sinh ra Bó nào** — hai bề mặt chạy trên
   * cùng một trang, với hai tập video KHÁC nhau, và mỗi cú bấm phải cho ra đúng
   * tập của nó.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody2,
      describe: async (id) => meta({ videoId: id }),
      bridge: async (kind) =>
        kind === 'context'
          ? { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' }
          : { items: [{ videoId: 'vidfromapi9', title: 'Chỉ có trong playlist', privacy: 'unknown', accessible: true }] },
    });
    await h.tick(80);

    /* (b): tick đúng MỘT thẻ trên trang */
    const box = h.$$('.nblm-pick input')[0];
    box.checked = true;
    box.dispatchEvent(new h.win.Event('change'));
    h.click('[data-act="copy"]');
    await h.tick(120);

    /* (c): quét playlist, chọn hành động copy trong bảng */
    h.click('[data-act="all-import"]');
    await h.tick(120);
    h.click('[data-act="copy"]');
    await h.tick(120);

    eq(h.clipboard.writes, [
      'https://www.youtube.com/watch?v=vidpublic01',
      'https://www.youtube.com/watch?v=vidfromapi9',
    ], 'hoán vị (b)/(c): mỗi cú bấm phải sinh ra ĐÚNG Bó của bề mặt mình, không phải Bó của bề mặt kia');
    h.close();
  }

  /* --- (c) bảng Import toàn bộ -------------------------------------- */

  {
    const asked = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody2,
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async (kind) =>
        kind === 'context'
          ? { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' }
          : {
              items: [
                { videoId: 'vidpublic01', title: 'Một', privacy: 'unknown', accessible: true },
                { videoId: 'vidprivat03', title: 'Hai', privacy: 'private', accessible: true },
                { videoId: 'vidblocked4', title: 'Ba', privacy: 'private', accessible: false },
              ],
            },
    });
    await h.tick(80);
    h.click('[data-act="all-import"]');
    await h.tick(120);

    ok(!!h.$('.nblm-modal [data-act="copy"]'), '(c) bảng xác nhận phải có hành động Copy link');
    ok(!!h.$('.nblm-modal [data-act="import"]'), '(c) hành động Import cũ phải còn');
    eq(asked, [], '(c) mở bảng KHÔNG được tốn lượt hỏi nào — trả tiền sau khi người dùng chọn');

    h.click('.nblm-modal [data-act="copy"]');
    await h.tick(120);

    eq(h.clipboard.writes, ['https://www.youtube.com/watch?v=vidpublic01'],
      '(c) chỉ video qua đủ ba cửa mới vào Bó');
    eq(asked, ['vidpublic01'],
      '(c) huy hiệu private loại trước, chỉ phần còn lại mới tốn request');
    h.close();
  }

  /* Huỷ tốn ĐÚNG 0 lượt hỏi — đó là lý do cửa 3 chạy sau khi chọn, không trước. */
  {
    const asked = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody2,
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async (kind) =>
        kind === 'context'
          ? { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' }
          : { items: [{ videoId: 'vidpublic01', title: 'Một', privacy: 'unknown', accessible: true }] },
    });
    await h.tick(80);
    h.click('[data-act="all-import"]');
    await h.tick(120);
    h.click('.nblm-modal [data-act="no"]');
    await h.tick(80);

    eq(asked, [], '(c) bấm Huỷ phải tốn 0 lượt hỏi player response');
    eq(h.clipboard.writes, [], '(c) bấm Huỷ thì không chạm clipboard');
    h.close();
  }

  /* --- Bó rỗng, clipboard từ chối, cầu dao -------------------------- */

  /*
   * Bó rỗng KHÔNG được chạm clipboard. `writeText('')` xoá trắng thứ người dùng
   * đang giữ — họ mất nó để đổi lấy một thông báo. Ca này thường gặp: bấm copy
   * lần hai trên một playlist toàn video private là rơi thẳng vào đây.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id, privacy: 'unlisted' }),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(h.clipboard.writes, [], 'Bó rỗng thì KHÔNG gọi writeText — writeText("") xoá trắng clipboard của người dùng');
    ok(/private\/unlisted/.test(h.toast()), `Bó rỗng phải nói rõ vì sao — nhận: "${h.toast()}"`);
    h.close();
  }

  /* Clipboard từ chối (trang không được focus): nói ra, và cứu bằng Hàng đợi. */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
      writeText: async () => { throw new Error('Document is not focused'); },
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    ok(/Không ghi được clipboard/.test(h.toast()), `clipboard từ chối phải nói ra — nhận: "${h.toast()}"`);
    eq(enq(h).length, 1, 'clipboard từ chối thì link phải rơi về Hàng đợi, không mất trắng');
    eq(enqItems(h).map((i) => i.videoId), ['aaaaaaaaaaa'], 'đúng video vừa bấm phải được cứu');
    h.close();
  }

  /*
   * Cầu dao. Hỏng liên tiếp gần như luôn nghĩa là YouTube đang chặn; hỏi tiếp
   * chỉ làm nó chặn lâu hơn. Thứ dừng lại là *quyền vào clipboard*, không phải
   * cả thao tác — phần còn lại rơi về Hàng đợi, fail-closed.
   */
  {
    let n = 0;
    const cards = Array.from({ length: 9 }, (_, i) => videoCard(`vidbreaker${i}`, `V${i}`)).join('');
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: cards,
      describe: async () => { n++; throw new Error('429'); },
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.$$('.nblm-pick input').forEach((b) => { b.checked = true; b.dispatchEvent(new h.win.Event('change')); });
    h.click('[data-act="copy"]');
    await h.tick(150);

    ok(n < 9, `cầu dao phải dừng hỏi trước khi chạy hết 9 video, đã hỏi ${n}`);
    eq(h.clipboard.writes, [], 'cầu dao nhả rồi thì không link nào vào clipboard');
    eq(enqItems(h).length, 9, 'cả 9 video phải rơi về Hàng đợi, không mất cái nào');
    h.close();
  }

  /* ================================================================== */
  /* mục 6 — sau khi copy: nhảy sang tab notebook, và DỪNG                */
  /* ================================================================== */

  /*
   * Thứ tự ba tin là nội dung chứ không phải cách xếp: `bundle-copied` ghi Sổ,
   * và Sổ chỉ được nói thật sau khi clipboard đã nhận. Nhảy tab TRƯỚC khi ghi Sổ
   * là đẩy người dùng sang tab khác trong lúc lượt này còn dở — tab nền bị Chrome
   * hạ ưu tiên, và một `sendMessage` chưa xong ở đó là một Sổ ghi thiếu.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    const types = h.sent.map((m) => m.type);
    eq(msgs(h, 'jump-notebook').length, 1, 'copy xong phải nhảy sang tab NotebookLM, đúng một lần');
    ok(types.indexOf('jump-notebook') > types.indexOf('bundle-copied'),
      `nhảy tab phải SAU khi ghi Sổ xong — thứ tự nhận được: ${JSON.stringify(types)}`);
    ok(!/notebook đích/.test(h.toast()),
      `nhảy được thì đừng dặn gì thêm — nhận: "${h.toast()}"`);
    h.close();
  }

  /*
   * Bó rỗng: KHÔNG nhảy. Nhảy sang notebook với một clipboard chưa được ghi là
   * mời người dùng dán thứ họ đang giữ từ trước — và đó là ca thường gặp, bấm
   * copy lần thứ hai trên cùng một danh sách rơi thẳng vào nó.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id, privacy: 'private' }),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(msgs(h, 'jump-notebook').length, 0, 'Bó rỗng thì KHÔNG nhảy — clipboard chưa nhận gì cả');
    h.close();
  }

  /* Clipboard từ chối: cũng không nhảy, vì cũng không có gì để dán. */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
      writeText: async () => { throw new Error('Document is not focused'); },
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(msgs(h, 'jump-notebook').length, 0, 'clipboard từ chối thì không nhảy — không có gì để dán');
    h.close();
  }

  /*
   * Chưa đặt notebook đích. Ticket gọi thẳng ca này ra: im lặng ở đây là im lặng
   * SAI, vì người dùng đang cầm một clipboard vừa ghi xong mà không biết mang đi
   * đâu — và không có cú nhảy nào để tự nói hộ.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    // Đúng hình dạng service worker thật trả về khi chưa đặt notebook đích —
    // `why` là thứ quyết định câu chỉ đường, nên fixture không được bỏ nó.
    h.jump.jumped = false;
    h.jump.why = 'no-target';
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(h.clipboard.writes.length, 1, 'chưa đặt đích KHÔNG được huỷ cú copy — clipboard vẫn phải có nội dung');
    ok(/1 link công khai/.test(h.toast()), `vẫn phải báo đã copy mấy link — nhận: "${h.toast()}"`);
    ok(/chưa đặt notebook đích/.test(h.toast()),
      `phải nói ra rằng chưa có đích để nhảy tới — nhận: "${h.toast()}"`);
    ok(/Ctrl\+V/.test(h.toast()),
      `phải chỉ đường thủ công, không bỏ người dùng đứng đó — nhận: "${h.toast()}"`);
    h.close();
  }

  /* ================================================================== */
  /* thứ tự ba cửa, và nút Copy lại                                      */
  /* ================================================================== */

  /*
   * Cửa 2 đứng TRƯỚC cửa 3, và đây là chỗ đo cái giá của thứ tự đó.
   *
   * Cửa 3 là cửa duy nhất tốn tiền: một video = một lượt `innertube('player')`.
   * Đảo lại thì bấm copy lần thứ hai trên một danh sách đã copy hết vẫn trả đủ
   * N lượt POST tới YouTube để rồi cửa 2 vứt cả N — và cầu dao không cứu được,
   * vì mọi lượt hỏi đó đều THÀNH CÔNG.
   *
   * Assertion phải là `asked`, không phải clipboard: hai thứ tự cửa cho ra cùng
   * một clipboard rỗng, nên assert kết quả sẽ xanh cả hai chiều hoán vị.
   */
  const listBody3 = [
    videoCard('vidcopied01', 'Đã copy một'),
    videoCard('vidcopied02', 'Đã copy hai'),
    videoCard('vidcopied03', 'Đã copy ba'),
  ].join('');

  /** Background coi MỌI url là đã có trong Sổ. */
  const allDropped = (m) => {
    if (m.type === 'bundle-filter') {
      return { keep: [], dropped: (m.urls || []).map((u) => ({ url: u, why: 'copied' })) };
    }
    if (m.type === 'bundle-copied') return { added: (m.urls || []).length };
    if (m.type === 'jump-notebook') return { jumped: true, tabId: 1 };
    if (m.type === 'enqueue') return { added: (m.items || []).length };
    return {};
  };

  const tickAll = (h) =>
    h.$$('.nblm-pick input').forEach((b) => { b.checked = true; b.dispatchEvent(new h.win.Event('change')); });

  /*
   * Bấm nút Copy lại, và KHÔNG ném khi nó vắng mặt.
   *
   * `h.click()` ném `Error` cho phần tử không tìm thấy, mà một cú ném ở đây nuốt
   * luôn dòng tổng kết của cả file: hoán vị "không dựng nút Copy lại" khi ấy đo
   * ra "không in được gì" thay vì một con số fail. Đúng bài học của
   * `docs/adr/0001-duong-trao-tay.md` — thiệt hại phải đếm được.
   */
  const clickRecopy = (h) => {
    const btn = h.$('#nblm-recopy .nblm-recopy__go');
    if (!btn) return false;
    h.click(btn);
    return true;
  };

  {
    const asked = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody3,
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply(allDropped);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(asked, [],
      'cửa 2 loại sạch thì cửa 3 KHÔNG được hỏi lượt nào — cửa 3 là cửa duy nhất tốn request');
    eq(msgs(h, 'bundle-filter').length, 1, 'cửa 2 chạy đúng một lượt cho cả Bó');
    eq(h.clipboard.writes, [], 'không link nào qua được cửa 2 thì không chạm clipboard');
    h.close();
  }

  /*
   * Nút *Copy lại* phải là một phần tử ĐỨNG YÊN, không phải lời dặn "bấm lại nút
   * cũ lần nữa". Nút cũ thường không còn ở đó: `onBarClick` kết thúc bằng
   * `clearSelection()`, và `renderBar` tự gỡ thanh nổi khi hết mục được tick.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody3,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply(allDropped);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    const chip = h.$('#nblm-recopy');
    ok(!!chip, 'cửa 2 loại link thì phải hiện nút Copy lại — con số không kèm cách bấm là im lặng bỏ link');
    // `chip &&` chứ không `chip.textContent` trần: nút vắng mặt phải ra MỘT DÒNG
    // FAIL nữa, không phải một cú ném nuốt mất dòng tổng kết của cả file.
    const chipText = chip ? chip.textContent : '';
    ok(/3/.test(chipText), `nút Copy lại phải mang đúng số link bị loại — nhận: "${chipText}"`);
    ok(!h.$('[data-act="copy"]'),
      'thanh nổi đã tự gỡ sau cú bấm — đó là lý do nút Copy lại không được gắn vào nó');
    h.close();
  }

  /*
   * Bấm *Copy lại*: bỏ qua cửa 2 (đó là việc người dùng vừa yêu cầu), NHƯNG vẫn
   * phải qua cửa 3. Ghim cả hai vế trong một ca — bỏ vế nào cũng thành một hoán
   * vị xanh: chỉ ghim cửa 2 thì bỏ luôn cửa 3 vẫn xanh, chỉ ghim cửa 3 thì giữ
   * nguyên cửa 2 (tức nút không làm gì) vẫn xanh.
   */
  {
    const asked = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody3,
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply(allDropped);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    ok(clickRecopy(h), 'phải có nút Copy lại để bấm — không có thì mọi assertion dưới đây vô nghĩa');
    await h.tick(200);

    eq(msgs(h, 'bundle-filter').length, 1,
      'Copy lại KHÔNG tra Sổ lần nữa — cửa 2 chính là thứ người dùng vừa bảo bỏ qua');
    eq(asked.slice().sort(), ['vidcopied01', 'vidcopied02', 'vidcopied03'],
      'Copy lại VẪN phải qua cửa 3: danh sách của nó bị cửa 2 loại trước khi ai hỏi player response');
    eq(h.clipboard.writes, [
      'https://www.youtube.com/watch?v=vidcopied01\nhttps://www.youtube.com/watch?v=vidcopied02\nhttps://www.youtube.com/watch?v=vidcopied03',
    ], 'Copy lại phải đưa đủ cả ba link vào clipboard');
    ok(/Đã copy lại 3 link/.test(summary(h)),
      `bản tổng kết phải phân biệt copy lại với copy lần đầu — nhận: "${summary(h)}"`);
    ok(!h.$('#nblm-recopy'), 'copy lại xong thì nút tự gỡ — danh sách đó đã hết vai');
    h.close();
  }

  /*
   * Con số trong bản tổng kết phải là con số Hàng đợi THẬT SỰ nhận, không phải
   * con số gửi đi.
   *
   * Hàng đợi khử trùng theo `itemKey`, nên bấm *Copy link công khai* mười lần
   * trên một trang có một video bị huy hiệu chặn thì cả mười lần đều báo "1
   * video private/unlisted → Hàng đợi" trong khi chín lần sau không thêm gì.
   * Một con số lặp lại y hệt mà không phản ánh việc gì đang xảy ra thì người
   * dùng không có cách nào biết là không có gì thay đổi.
   *
   * Ghim CHỮ chứ không ghim số: cả hai bản đều in ra "2", nên assert con số sẽ
   * xanh cả hai chiều hoán vị.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: [videoCard('vidprivat01', 'Riêng một', 'Private'), videoCard('vidprivat02', 'Riêng hai', 'Private')].join(''),
      describe: async (id) => meta({ videoId: id, privacy: 'private' }),
      bridge: async () => ({ kind: 'other' }),
    });
    // Hàng đợi đã có sẵn cả hai: `added: 0`.
    h.reply((m) => {
      if (m.type === 'bundle-filter') return { keep: m.urls || [], dropped: [] };
      if (m.type === 'enqueue') return { added: 0, skipped: (m.items || []).length };
      if (m.type === 'jump-notebook') return { jumped: true, tabId: 1 };
      return {};
    });
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(200);

    const said = summary(h) || h.toast();
    ok(/đã có sẵn trong Hàng đợi/.test(said),
      `Hàng đợi không nhận thêm gì thì phải NÓI RA, không báo "→ Hàng đợi" như lần đầu — nhận: "${said}"`);
    ok(!/2 → Hàng đợi/.test(said),
      `và không được báo con số gửi đi như thể nó là con số đã thêm — nhận: "${said}"`);
    h.close();
  }

  /*
   * Cùng một luật ở NHÁNH KIA. `handOff` có hai đường dựng bản tổng kết — bó
   * rỗng (`why`) và bó có hàng (`parts`) — và chúng là hai đoạn code riêng. Ca
   * trên chỉ đi qua đường thứ nhất; đo hoán vị 2026-08-31, sửa riêng dòng ở
   * `parts` cho 0 đỏ. Một nhánh xanh không nói gì về nhánh còn lại.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: [videoCard('vidcongkhai', 'Công khai'), videoCard('vidprivat03', 'Riêng ba', 'Private')].join(''),
      describe: async (id) => meta({ videoId: id, privacy: id === 'vidprivat03' ? 'private' : 'public' }),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply((m) => {
      if (m.type === 'bundle-filter') return { keep: m.urls || [], dropped: [] };
      if (m.type === 'enqueue') return { added: 0, skipped: (m.items || []).length };
      if (m.type === 'bundle-copied') return { added: (m.urls || []).length };
      if (m.type === 'jump-notebook') return { jumped: true, tabId: 1 };
      return {};
    });
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(200);

    const said = summary(h) || h.toast();
    ok(/Đã copy 1 link/.test(said),
      `ca dựng sai thì assertion sau vô nghĩa — phải có link công khai để đi vào nhánh này, nhận: "${said}"`);
    ok(/đã có sẵn trong Hàng đợi/.test(said),
      `nhánh "bó có hàng" cũng phải nói con số THẬT — nhận: "${said}"`);
    ok(!/1 → Hàng đợi/.test(said),
      `và cũng không được báo con số gửi đi — nhận: "${said}"`);
    h.close();
  }

  /*
   * Node bị gỡ khỏi DOM mà biến vẫn trỏ vào nó: mọi lần ghi sau đó rơi vào hư
   * không — không lỗi, không chữ, và người dùng không thấy gì cả.
   *
   * Đây là ca thật trên YouTube: SPA thay cả cây khi chuyển trang, và overlay
   * treo vào `document.documentElement` chứ không vào một host riêng. Ca này
   * dựng lại đúng tình huống đó bằng cách gỡ tay hai phần tử.
   *
   * Assertion phải là "phần tử MỚI có mặt trong DOM và mang đúng chữ", không
   * phải "biến còn truthy": hoán vị bỏ `isConnected` giữ nguyên biến truthy nên
   * assert trên biến sẽ xanh cả hai chiều.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody3,
      describe: async (id) => meta({ videoId: id }),
      bridge: async (kind) =>
        kind === 'context' ? { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' } : { items: [] },
    });
    h.reply(allDropped);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    const chip = h.$('#nblm-recopy');
    const toastNode = h.$('.nblm-toast');
    ok(!!chip && !!toastNode, 'ca dựng sai thì assertion sau vô nghĩa — cả thẻ lẫn toast phải có mặt trước đã');
    if (chip) chip.remove();
    if (toastNode) toastNode.remove();

    // Lượt copy thứ hai: cả hai phải mọc lại, không ghi vào cái xác cũ.
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(200);

    const chip2 = h.$('#nblm-recopy');
    ok(!!chip2 && chip2 !== chip,
      'thẻ bị gỡ khỏi DOM thì lượt sau phải dựng thẻ MỚI, không ghi vào node đã chết');
    ok(/3 link/.test((chip2 && chip2.textContent) || ''),
      `và thẻ mới phải mang đủ nội dung — nhận: "${(chip2 && chip2.textContent) || ''}"`);
    const toast2 = h.$('.nblm-toast');
    ok(!!toast2 && (toast2.textContent || '').length > 0,
      `toast bị gỡ cũng phải mọc lại kèm chữ — nhận: "${toast2 ? toast2.textContent : '(không có toast)'}"`);
    h.close();
  }

  /*
   * `from` của `bundle-copied` — ngữ cảnh mà Sổ ghi lại cho mỗi dòng.
   *
   * Ca này phải dựng CHỦ ĐÍCH cho `pageCtx` đổi giữa hai cú bấm, nếu không nó
   * chứng nhận nhầm chỗ: thẻ *Copy lại* chụp `lastDroppedFrom` lúc dựng, còn
   * `handOff` khi thiếu `from` thì rơi về `pageCtx.title`. Trên một trang đứng
   * yên, hai đường cho cùng một chuỗi — hoán vị "bỏ hẳn phép chụp" vẫn xanh.
   * Đúng cái bẫy hai-cơ-chế-cùng-giữ-một-luật.
   *
   * Và đây chính là ca thật, không phải ca dựng cho vui: thẻ sống qua cả cú
   * chuyển trang. Người dùng bấm copy trên playlist A, sang playlist B, rồi mới
   * bấm *Copy lại* — Sổ phải ghi A, vì đó là nơi những link ấy đến từ.
   */
  {
    let ctx = { kind: 'playlist', playlistId: 'PLA', title: 'Playlist A' };
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PLA',
      body: listBody3,
      describe: async (id) => meta({ videoId: id }),
      bridge: async (kind) => (kind === 'context' ? ctx : { items: [] }),
    });
    h.reply(allDropped);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    /*
     * Sang "playlist B". Phải bắn `yt-navigate-finish`, KHÔNG phải chạm DOM:
     * `refreshContext()` chỉ chạy ở `onNavigate`, còn `MutationObserver` chỉ
     * kích `scheduleScan` (quét thẻ video). Đo 2026-08-31: bản dùng
     * `insertAdjacentHTML` để hoán vị "copy lại quên chụp nguồn" sống sót 0 đỏ,
     * vì `pageCtx.title` vẫn là 'Playlist A' — ca xanh mà không đo được gì.
     */
    ctx = { kind: 'playlist', playlistId: 'PLB', title: 'Playlist B' };
    h.win.dispatchEvent(new h.win.Event('yt-navigate-finish'));
    await h.tick(150);
    ok(/Playlist A/.test((h.$('#nblm-recopy') || {}).textContent || ''),
      `ca dựng sai thì assertion sau vô nghĩa — thẻ phải vẫn mang nguồn cũ, nhận: "${(h.$('#nblm-recopy') || {}).textContent || ''}"`);

    ok(clickRecopy(h), 'phải có nút Copy lại để bấm');
    await h.tick(200);

    const book = msgs(h, 'bundle-copied').pop();
    eq(book && book.from, 'Playlist A',
      `Sổ phải ghi ngữ cảnh GỐC của những link này, không phải trang đang đứng — nhận: ${JSON.stringify(book && book.from)}`);
    h.close();
  }

  /*
   * Vế còn lại: lượt copy THƯỜNG lấy `from` từ trang đang đứng. Không có vế này
   * thì hoán vị "luôn dùng một chuỗi cứng" vẫn xanh ở ca trên.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PLC',
      body: listBody3,
      describe: async (id) => meta({ videoId: id }),
      bridge: async (kind) =>
        kind === 'context' ? { kind: 'playlist', playlistId: 'PLC', title: 'Playlist C' } : { items: [] },
    });
    h.reply((m) => {
      if (m.type === 'bundle-filter') return { keep: m.urls || [], dropped: [] };
      if (m.type === 'bundle-copied') return { added: (m.urls || []).length };
      if (m.type === 'jump-notebook') return { jumped: true, tabId: 1 };
      return {};
    });
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    const book = msgs(h, 'bundle-copied').pop();
    eq(book && book.from, 'Playlist C',
      `lượt copy thường phải ghi tên trang đang đứng — nhận: ${JSON.stringify(book && book.from)}`);
    h.close();
  }

  /*
   * Cái neo, đo thẳng: một video private lọt vào `dropped` thì nút *Copy lại*
   * KHÔNG được đưa nó lên clipboard.
   *
   * Đây không phải ca giả định. Cửa 3 đẩy video bị loại sang Hàng đợi, mà cửa 2
   * tra cả Hàng đợi — nên đúng video private bị chặn ở lượt 1 sẽ nằm trong
   * `dropped` ở lượt 2. Bỏ cửa 3 khỏi nhánh Copy lại là đóng vòng lặp đó lại
   * thành một đường rò.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: videoCard('vidprivat09', 'Riêng tư'),
      describe: async (id) => meta({ videoId: id, privacy: 'private' }),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply(allDropped);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    ok(clickRecopy(h), 'ca dựng sai thì mọi assertion sau đều vô nghĩa — nút phải có mặt trước đã');

    /*
     * Đọc NGAY, trước bất kỳ `tick` nào: `onRecopyClick` khoá hai nút đồng bộ
     * rồi mới `await handOff`, và `finally` dựng lại thẻ với nút × mới toanh —
     * chờ một nhịp là cửa sổ quan sát đóng lại. Cùng cái bẫy đã ghi cho nhịp
     * chờ dài nuốt nhịp chờ ngắn.
     *
     * Vì sao khoá ×: bấm × giữa lúc "Đang hỏi…" thì thẻ biến mất trong khi lượt
     * vẫn chạy tới clipboard và toast — người dùng thấy mình đã huỷ, máy thì
     * không huỷ gì cả.
     */
    {
      const go = h.$('#nblm-recopy .nblm-recopy__go');
      const x = h.$('#nblm-recopy .nblm-recopy__x');
      ok(go && go.disabled === true,
        `trong lúc chờ, nút Copy lại phải khoá — nhận: ${go ? go.disabled : '(không có nút)'}`);
      ok(x && x.disabled === true,
        `và nút × cũng phải khoá — nhận: ${x ? x.disabled : '(không có nút)'}`);
    }

    await h.tick(200);

    eq(h.clipboard.writes, [],
      'video private đi qua nút Copy lại vẫn bị cửa 3 chặn — không có đường nào tới writeText mà không qua cửa 3');
    eq(enqItems(h, enq(h).length - 1).map((i) => i.videoId), ['vidprivat09'],
      'và nó phải rơi về Hàng đợi, không mất trắng');
    /*
     * Thẻ phải CÒN Ở ĐÓ. Lượt copy lại không đưa được gì lên clipboard, nên
     * danh sách của nó chưa hết vai — gỡ thẻ ở đây là vứt bản duy nhất còn giữ
     * nó, và người dùng không có đường nào lấy lại ngoài xoá sạch Sổ.
     */
    ok(!!h.$('#nblm-recopy'),
      'copy lại KHÔNG copy được gì thì thẻ phải ở lại — nhánh skipDedupe không được tự gỡ thẻ của chính nó');
    h.close();
  }

  /*
   * Thẻ *Copy lại* sống qua cả cú chuyển trang và không tự tắt, nên nó phải tự
   * nói được nó đang giữ link CỦA CÁI GÌ. "12 link" trên một playlist khác là
   * một con số không truy được về đâu.
   *
   * Và nó phải đọc được bằng trình đọc màn hình: `role="status"` +
   * `aria-live="polite"` để nói mà không cắt ngang, `aria-label` cho nút × —
   * `×` là một ký tự nhân, không phải một cái tên.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody3,
      describe: async (id) => meta({ videoId: id }),
      bridge: async (kind) =>
        kind === 'context'
          ? { kind: 'playlist', playlistId: 'PL123', title: 'Khoá học Rust' }
          : { items: [] },
    });
    h.reply(allDropped);
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    const chip = h.$('#nblm-recopy');
    ok(!!chip, 'ca dựng sai thì mọi assertion sau vô nghĩa — thẻ phải có mặt');
    const text = chip ? chip.textContent : '';
    ok(/Khoá học Rust/.test(text),
      `thẻ phải mang tên nguồn của danh sách nó đang giữ — nhận: "${text}"`);

    eq(chip && chip.getAttribute('role'), 'status',
      'thẻ báo một việc vừa xảy ra mà không ai yêu cầu — role="status"');
    eq(chip && chip.getAttribute('aria-live'), 'polite',
      'và "polite": đọc nốt câu đang đọc rồi mới nói, đừng cắt ngang');
    const x = chip ? chip.querySelector('.nblm-recopy__x') : null;
    ok(x && (x.getAttribute('aria-label') || '').length > 1,
      'nút × phải có aria-label — không có thì trình đọc màn hình đọc ra "dấu nhân"');

    /*
     * Vị trí thẻ phải được TÍNH lúc chạy, không phải một con số cứng trong CSS.
     * Bản tổng kết dài ngắn tuỳ lượt nên toast cao hai, ba, bốn dòng — một con
     * số chọn cho hai dòng thì bốn dòng là chồng lên nhau, và thứ bị che là cái
     * nút.
     *
     * PHẠM VI CA NÀY, nói thẳng: đo được nhánh né `#nblm-bar`, KHÔNG đo được
     * nhánh né toast. Thanh chọn hàng loạt còn đứng đó lúc assertion chạy nên
     * `heightOf` trả 40 (harness trả rect cố định 120x40) và con số ra 24+40+12.
     * Toast thì không: harness bóp mọi `setTimeout` xuống ≤20ms nên hẹn giờ tắt
     * toast 4200ms bắn xong trước khi đọc tới, và `nblm-toast--show` đã rụng.
     * Chỗ toast chồng lấn thật phải chụp bằng trình duyệt thật mới thấy — đúng
     * bài học đã ghi cho ca nút Dừng.
     *
     * Ghim CON SỐ chứ không ghim "có style inline": `24px` cũng là style inline,
     * nên hoán vị bỏ hẳn phép né thanh vẫn xanh nếu chỉ assert là có ghi.
     */
    ok(chip && chip.style.bottom === '76px',
      `thẻ phải đứng trên #nblm-bar (24 mép + 40 cao + 12 khe) — nhận: "${chip ? chip.style.bottom || '(không có style inline)' : ''}"`);

    /*
     * Và tụt về chỗ nghỉ khi không còn gì ở mép dưới. Không có vế này thì hoán
     * vị "luôn trả 76px" cũng xanh, và thẻ sẽ lơ lửng giữa màn hình trắng.
     * `fullscreenchange` là đường công khai duy nhất gọi lại `layoutRecopy()`.
     */
    const bar = h.$('#nblm-bar');
    if (bar) bar.remove();
    h.win.document.dispatchEvent(new h.win.Event('fullscreenchange'));
    ok(chip && chip.style.bottom === '24px',
      `thanh biến mất thì thẻ tụt xuống mép — nhận: "${chip ? chip.style.bottom : ''}"`);
    h.close();
  }

  /*
   * Cửa 2 trả về một url KHÔNG khớp ứng viên nào.
   *
   * `filterBundle` hôm nay dựng `keep` từ chính chuỗi nó nhận, nên ca này chỉ tới
   * được khi service worker phá hợp đồng của chính nó. Vẫn phải có đường ra: đây
   * đúng là hình dạng "bỏ một mục mà không đếm" — thứ `sidebar.js` đã dính hai
   * lần — và một con số nói ra được thì còn lần theo được.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody3,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply((m) => {
      if (m.type === 'bundle-filter') {
        // Trả về một url chưa từng được gửi đi.
        return { keep: ['https://www.youtube.com/watch?v=khonggui99'], dropped: [] };
      }
      if (m.type === 'jump-notebook') return { jumped: true, tabId: 1 };
      return { added: 1 };
    });
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes, [], 'url lạ KHÔNG được đi tiếp — nó không phải ứng viên nào của lượt này');
    ok(/không khớp ứng viên nào/.test(h.toast()),
      `và số link rơi mất phải được NÓI RA, không im lặng bỏ — nhận: "${h.toast()}"`);
    h.close();
  }

  /* Không có link nào bị loại thì không dựng nút — một cái nút không làm gì là một cái bẫy. */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(120);

    eq(h.clipboard.writes.length, 1, 'ca dựng sai thì assertion sau vô nghĩa — lượt copy phải thành công đã');
    ok(!h.$('#nblm-recopy'), 'cửa 2 không loại gì thì KHÔNG có nút Copy lại');
    h.close();
  }

  /* ================================================================== */
  /* mục 7 — phím tắt nhờ tab trao tay                                   */
  /* ================================================================== */

  /*
   * Service worker gửi `shortcut-handoff` xuống đây vì nó không biết privacy và
   * không có `navigator.clipboard`. Cờ `handled` nó nhận lại quyết định có xếp
   * hàng thay hay không, nên cờ đó phải nói đúng sự thật của lượt này.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);

    const res = await h.dispatch({ type: 'shortcut-handoff', videoId: 'aaaaaaaaaaa' });
    await h.tick(80);

    eq(res, { handled: true }, 'phím tắt trên video công khai: tab tự xử, service worker không xếp hàng thay');
    eq(h.clipboard.writes, ['https://www.youtube.com/watch?v=aaaaaaaaaaa'],
      'phím tắt phải đi qua đúng đường Bó link, không có đường tắt riêng');
    eq(enq(h), [], 'đã copy thì không xếp hàng — nếu không, một lượt phím tắt cho ra hai bản');
    h.close();
  }

  /*
   * Phím tắt trên video private. `handled: true` mà KHÔNG copy — vì `handOff` đã
   * tự xếp hàng rồi. Đây là chỗ dễ đọc nhầm nhất của mục 7: `handled` nghĩa là
   * "lượt này đã có kết cục", không phải "đã copy".
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id, privacy: 'private' }),
      bridge: async () => ({ kind: 'other' }),
    });
    await h.tick(80);

    const res = await h.dispatch({ type: 'shortcut-handoff', videoId: 'aaaaaaaaaaa' });
    await h.tick(80);

    eq(res, { handled: true }, 'video private: tab đã tự xếp hàng, đó cũng là một kết cục');
    eq(h.clipboard.writes, [], 'video private không được chạm clipboard, kể cả qua phím tắt');
    eq(enqItems(h).map((i) => i.videoId), ['aaaaaaaaaaa'], 'video private phải nằm trong Hàng đợi');
    h.close();
  }

  /*
   * Tra Sổ hỏng — nhánh DUY NHẤT `handOff` không tự xếp hàng. Nhận `handled` ở
   * đây là bỏ rơi video giữa đường: tab không copy, không xếp hàng, và service
   * worker tưởng xong việc.
   */
  {
    const h = loadYouTubePage({
      body: WATCH_ROW,
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply((m) => (m.type === 'bundle-filter' ? { error: 'storage hỏng' } : {}));
    await h.tick(80);

    const res = await h.dispatch({ type: 'shortcut-handoff', videoId: 'aaaaaaaaaaa' });
    await h.tick(80);

    eq(res, { handled: false },
      'tra Sổ hỏng phải trả handled:false để service worker xếp hàng thay — không ca nào được im lặng');
    eq(h.clipboard.writes, [], 'tra Sổ hỏng thì không copy');
    h.close();
  }

  /*
   * Cửa 2 hỏng KHÔNG được xoá kết luận của cửa 1.
   *
   * Huy hiệu là quan sát tại chỗ, không phụ thuộc vào Sổ đã copy chút nào. Bỏ cả
   * nhóm chỉ vì cửa 2 không tra được là vứt một kết luận đã có sẵn — và video
   * private ấy biến mất khỏi mọi rổ: không clipboard, không Hàng đợi, không một
   * con số nào.
   */
  {
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: [
        videoCard('vidprivat07', 'Riêng tư', 'Private'),
        videoCard('vidpublic08', 'Công khai'),
      ].join(''),
      describe: async (id) => meta({ videoId: id }),
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply((m) => (m.type === 'bundle-filter' ? { error: 'storage hỏng' } : { added: 1 }));
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(h.clipboard.writes, [], 'ca dựng sai thì assertion sau vô nghĩa — cửa 2 hỏng thì không copy');
    eq(enqItems(h, enq(h).length - 1).map((i) => i.videoId), ['vidprivat07'],
      'video bị huy hiệu loại vẫn phải rơi về Hàng đợi — cửa 1 không cần cửa 2 để kết luận');
    h.close();
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

  /* ================================================================== */
  /* cửa 1 — khử trùng theo videoId, và mục lệch khuôn                   */
  /* ================================================================== */

  /*
   * Một playlist chứa CÙNG một video hai lần là chuyện thường, và đường quét
   * InnerTube trả về đúng như thế — nó không đi qua `selected` (Map theo
   * videoId) nên không có ai gộp hộ.
   *
   * Assertion phải là `asked`, KHÔNG phải clipboard: bỏ hẳn phép gộp thì
   * clipboard vẫn ra một dòng (cửa 2 gộp theo `bundleKey`, `writeText` nhận
   * mảng đã lọc), nên assert kết quả là một hoán vị xanh. Cái đắt tiền là
   * SỐ LƯỢT HỎI, và chỉ nó mới phân biệt được hai nhánh.
   */
  {
    const asked = [];
    const filtered = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody2,
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async (kind) =>
        kind === 'context'
          ? { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' }
          : {
              items: [
                { videoId: 'vidpublic01', title: 'Một', privacy: 'unknown', accessible: true },
                { videoId: 'vidpublic01', title: 'Một (lặp)', privacy: 'unknown', accessible: true },
                { videoId: 'vidprivat05', title: 'Riêng tư', privacy: 'private', accessible: true },
                { videoId: 'vidprivat05', title: 'Riêng tư (lặp)', privacy: 'private', accessible: true },
              ],
            },
    });
    h.reply((m) => {
      if (m.type === 'bundle-filter') {
        filtered.push((m.urls || []).slice());
        return { keep: m.urls || [], dropped: [] };
      }
      if (m.type === 'bundle-copied') return { added: (m.urls || []).length };
      if (m.type === 'jump-notebook') return { jumped: true, tabId: 1 };
      if (m.type === 'enqueue') return { added: (m.items || []).length };
      return {};
    });
    await h.tick(80);
    h.click('[data-act="all-import"]');
    await h.tick(120);
    h.click('.nblm-modal [data-act="copy"]');
    await h.tick(150);

    eq(asked, ['vidpublic01'],
      'cùng một videoId hai lần trong playlist chỉ được tốn ĐÚNG một lượt hỏi player response');
    eq(filtered, [['https://www.youtube.com/watch?v=vidpublic01']],
      'và cửa 2 cũng chỉ nhận một url — gộp ở cửa 1 thì cửa dưới không phải gộp lại');

    /*
     * Vế thứ ba, và là vế duy nhất chỉ cửa 1 giữ được: video bị HUY HIỆU loại
     * không đi qua cửa 2, nên phép gộp theo url ở đó không với tới nó. Bỏ `seen`
     * ở cửa 1 là xếp cùng một video private vào Hàng đợi hai lần.
     */
    eq(enqItems(h, enq(h).length - 1).map((i) => i.videoId), ['vidprivat05'],
      'video private lặp hai lần chỉ được xếp hàng MỘT Mục — cửa 2 không gộp hộ rổ này');
    h.close();
  }

  /*
   * Mục có `videoId` lệch khuôn: bỏ thì được, bỏ IM LẶNG thì không.
   *
   * `canonicalUrl(id)` chỉ nội suy chuỗi, còn `videoIdFrom` mới áp luật khuôn
   * dạng — nên một id 9 ký tự dựng ra một url mà chính extension đọc lại không
   * ra id. Nó rơi khỏi `keep`, rơi khỏi `dropped`, rơi khỏi mọi con số trong bản
   * tổng kết. Đây đúng là lỗi `sidebar.js` đã dính hai lần.
   */
  {
    const asked = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: listBody2,
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async (kind) =>
        kind === 'context'
          ? { kind: 'playlist', playlistId: 'PL123', title: 'Playlist thử' }
          : {
              items: [
                { videoId: 'vidpublic01', title: 'Một', privacy: 'unknown', accessible: true },
                { videoId: 'ngan', title: 'Lệch khuôn', privacy: 'unknown', accessible: true },
              ],
            },
    });
    await h.tick(80);
    h.click('[data-act="all-import"]');
    await h.tick(120);
    h.click('.nblm-modal [data-act="copy"]');
    await h.tick(150);

    eq(asked, ['vidpublic01'], 'id lệch khuôn KHÔNG được tốn một lượt hỏi');
    eq(enqItems(h, enq(h).length - 1).map((i) => i.videoId), ['ngan'],
      'nhưng nó phải rơi về Hàng đợi, không bốc hơi — bỏ mà không đếm là lỗi đã dính hai lần');
    h.close();
  }

  /* ================================================================== */
  /* cửa 2 loại MỘT PHẦN, và hai lý do loại là hai lối đi                */
  /* ================================================================== */

  /*
   * Ca hỗn hợp: một link đã có trong Sổ, một link đang trong Hàng đợi, một link
   * sạch. Ba ca một lượt, vì chúng chỉ phân biệt được khi đứng cạnh nhau.
   *
   * `why === 'queued'` KHÔNG được vào nút *Copy lại*. Hầu hết Mục trong Hàng đợi
   * vào đó do chính cửa 3 đẩy xuống, nên đưa chúng ngược lên cửa 3 là hỏi lại
   * một câu vừa bị trả lời "không" — tốn tiền, và cái nút hứa một việc nó không
   * làm được. Gộp cả hai lý do vào một con số thì hoán vị nào cũng xanh.
   */
  {
    const asked = [];
    const h = loadYouTubePage({
      url: 'https://www.youtube.com/playlist?list=PL123',
      body: [
        videoCard('vidcopied01', 'Đã copy'),
        videoCard('vidqueued02', 'Đang xếp hàng'),
        videoCard('vidpublic03', 'Còn sạch'),
      ].join(''),
      describe: async (id) => { asked.push(id); return meta({ videoId: id }); },
      bridge: async () => ({ kind: 'other' }),
    });
    h.reply((m) => {
      if (m.type === 'bundle-filter') {
        const keep = [], dropped = [];
        for (const u of m.urls || []) {
          if (u.includes('vidcopied01')) dropped.push({ url: u, why: 'copied' });
          else if (u.includes('vidqueued02')) dropped.push({ url: u, why: 'queued' });
          else keep.push(u);
        }
        return { keep, dropped };
      }
      if (m.type === 'bundle-copied') return { added: (m.urls || []).length };
      if (m.type === 'jump-notebook') return { jumped: true, tabId: 1 };
      if (m.type === 'enqueue') return { added: (m.items || []).length };
      return {};
    });
    await h.tick(80);
    tickAll(h);
    h.click('[data-act="copy"]');
    await h.tick(150);

    eq(asked, ['vidpublic03'],
      'ca dựng sai thì mọi assertion sau vô nghĩa — chỉ link qua cửa 2 mới được hỏi');
    eq(h.clipboard.writes, ['https://www.youtube.com/watch?v=vidpublic03'],
      'phần sạch vẫn phải tới clipboard — cửa 2 loại một phần không phải loại cả Bó');

    const chip = h.$('#nblm-recopy');
    ok(!!chip, 'có link bị loại vì đã copy thì phải có nút Copy lại');
    const chipText = chip ? chip.textContent : '';
    ok(/Copy lại 1 link/.test(chipText),
      `nút Copy lại chỉ được đếm phần bị loại vì ĐÃ COPY (1), không gộp phần đang trong Hàng đợi — nhận: "${chipText}"`);

    const s = summary(h);
    ok(/1 bỏ vì đã có trong Sổ/.test(s),
      `bản tổng kết phải nói riêng phần đã có trong Sổ — nhận: "${s}"`);
    ok(/1 đang nằm trong Hàng đợi/.test(s),
      `và nói riêng phần đang trong Hàng đợi, vì hai lý do dẫn tới hai việc khác nhau — nhận: "${s}"`);

    asked.length = 0;
    ok(clickRecopy(h), 'phải có nút Copy lại để bấm');
    await h.tick(200);

    eq(asked, ['vidcopied01'],
      'Copy lại chỉ đưa phần bị loại vì đã copy lên cửa 3 — link đang trong Hàng đợi không đi lối này');
    h.close();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
