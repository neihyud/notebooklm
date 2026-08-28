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
    eq(h.sent, [], '(a) link đã vào clipboard thì KHÔNG xếp hàng nữa — Đường trao tay dừng ở đó');
    ok(/1 link công khai/.test(h.toast()), `(a) phải nói đã copy mấy link — nhận: "${h.toast()}"`);
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
    h.reply(() => ({ added: 1 }));
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(h.clipboard.writes, [], '(a) video private KHÔNG được chạm clipboard');
    eq(h.sent.length, 1, '(a) video private phải rơi về Hàng đợi');
    eq(sentItems(h), [{ videoId: 'aaaaaaaaaaa', title: undefined, privacy: 'unknown' }],
      '(a) Mục rơi về Hàng đợi giữ nguyên videoId');
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
    h.reply(() => ({ added: 1 }));
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    eq(h.clipboard.writes, [], '(a) hỏi không được thì KHÔNG copy — fail-closed');
    eq(h.sent.length, 1, '(a) hỏi không được thì rơi về Hàng đợi');
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
    h.reply(() => ({ added: 1 }));
    await h.tick(80);
    h.$$('.nblm-pick input').forEach((b) => { b.checked = true; b.dispatchEvent(new h.win.Event('change')); });

    ok(!!h.$('[data-act="copy"]'), '(b) thanh nổi phải có nút Copy link');
    h.click('[data-act="copy"]');
    await h.tick(120);

    eq(h.clipboard.writes, ['https://www.youtube.com/watch?v=vidpublic01\nhttps://www.youtube.com/watch?v=vidpublic02'],
      '(b) Bó link là URL trần, mỗi dòng một cái, không tiêu đề không dòng trống');
    eq(asked.sort(), ['vidpublic01', 'vidpublic02'],
      '(b) cửa 1 phải loại video có huy hiệu Private mà KHÔNG tốn một request nào');
    eq(h.sent.length, 1, '(b) video bị loại phải rơi về Hàng đợi');
    eq(sentItems(h).map((i) => i.videoId), ['vidprivat03'], '(b) chỉ video bị loại mới xếp hàng');
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
    h.reply(() => ({ added: 1 }));
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
    h.reply(() => ({ added: 1 }));
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
    h.reply(() => ({ added: 1 }));
    await h.tick(80);
    h.click('#nblm-copy-button');
    await h.tick(80);

    ok(/Không ghi được clipboard/.test(h.toast()), `clipboard từ chối phải nói ra — nhận: "${h.toast()}"`);
    eq(h.sent.length, 1, 'clipboard từ chối thì link phải rơi về Hàng đợi, không mất trắng');
    eq(sentItems(h).map((i) => i.videoId), ['aaaaaaaaaaa'], 'đúng video vừa bấm phải được cứu');
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
    h.reply(() => ({ added: 1 }));
    await h.tick(80);
    h.$$('.nblm-pick input').forEach((b) => { b.checked = true; b.dispatchEvent(new h.win.Event('change')); });
    h.click('[data-act="copy"]');
    await h.tick(150);

    ok(n < 9, `cầu dao phải dừng hỏi trước khi chạy hết 9 video, đã hỏi ${n}`);
    eq(h.clipboard.writes, [], 'cầu dao nhả rồi thì không link nào vào clipboard');
    eq(sentItems(h).length, 9, 'cả 9 video phải rơi về Hàng đợi, không mất cái nào');
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

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
