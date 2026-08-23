/*
 * Transcript bị cắt cụt phải NÓI RA, không được im lặng nhận `done`.
 *
 * Khuyết tật: `loadAllSegments` cuộn tối đa 40 vòng rồi dừng, và `fromPanel` chỉ
 * cần `segments.length > 0` là coi như thành công. Video rất dài mất phần đuôi mà
 * không ai biết — đúng biến thể của "done không có nghĩa là đã vào" mà ticket 002
 * đã bịt ở đường NotebookLM: cửa đã đóng nên tưởng là xong.
 *
 * Cạm bẫy khi viết test này (bài học 002): HAI nhánh — cuộn hết danh sách và cuộn
 * hết ngân sách — trả về CÙNG một hình dạng `{segments, method}`. Assert riêng
 * `segments.length > 0` sẽ xanh ở cả hai. Nên phải đòi đúng *trường nào* xuất hiện
 * ở nhánh nào, và nội dung của nó.
 *
 * Harness nạp `src/youtube/transcript.js` THẬT vào jsdom; xem ghi chú giới hạn ở
 * `loadTranscriptPanel` trong `test/dom-harness.js` — file này không chứng nhận selector.
 */
const { loadTranscriptPanel } = require('./dom-harness');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

(async () => {
  /* ---------- 1. danh sách dừng dài ra -> KHÔNG có cảnh báo ---------- */
  {
    const { T, count } = loadTranscriptPanel({ total: 12, page: 5 });
    const res = await T.fromPanel();
    ok(count() === 12, `panel phải nạp đủ 12 dòng trước khi kết luận, nhận: ${count()}`);
    ok(res.segments.length === 12, `phải lấy đủ 12 dòng, nhận: ${res.segments.length}`);
    ok(!res.truncated, `cuộn hết danh sách thì KHÔNG được báo cắt cụt, nhận: ${JSON.stringify(res.truncated)}`);
  }

  /* ---------- 2. danh sách không ngừng dài ra -> PHẢI báo cắt cụt ---------- */
  // Video rất dài: vòng cuộn tiêu hết ngân sách trong khi YouTube vẫn còn nạp thêm.
  {
    const { T, stats } = loadTranscriptPanel({ total: Infinity, page: 5 });
    const res = await T.fromPanel();
    ok(res.segments.length > 0, 'vẫn phải trả về phần transcript đã lấy được, không vứt đi');
    ok(
      typeof res.truncated === 'string' && res.truncated.length > 0,
      `cuộn hết ngân sách mà danh sách còn dài ra thì PHẢI kèm lý do dạng chuỗi, nhận: ${JSON.stringify(res.truncated)}`
    );
    // Hai con số cùng kiểu nằm trong cùng một câu: số dòng lấy được và số vòng đã
    // cuộn. `includes(...)` không đủ — đổi chỗ chúng thì chuỗi vẫn chứa cả hai và
    // vẫn xanh (đã đo). Phải đòi từng con số ở ĐÚNG vị trí của nó.
    ok(
      String(res.truncated).includes(`Chỉ lấy được ${res.segments.length} dòng`),
      `câu cảnh báo phải nêu số DÒNG lấy được (${res.segments.length}) ở đúng chỗ, nhận: ${JSON.stringify(res.truncated)}`
    );
    ok(
      String(res.truncated).includes(`sau ${stats.scrolls} vòng cuộn`),
      `câu cảnh báo phải nêu số VÒNG CUỘN (${stats.scrolls}) ở đúng chỗ, nhận: ${JSON.stringify(res.truncated)}`
    );
    ok(stats.scrolls === 40, `phải cuộn đúng hết ngân sách rồi mới kết luận, đã cuộn: ${stats.scrolls}`);
  }

  /* ---------- 3. mốc thời gian và lời thoại của CÙNG một dòng ---------- */
  // `segmentStamp(node)` và `segmentText(node)` cùng nhận một node, cùng trả string,
  // và cùng đi vào một object. Hoán vị hai lời gọi vẫn cho ra `{start, text}` đủ
  // trường, `parseTimestamp` nuốt chuỗi lạ thành 0 nên không ném lỗi — chỉ phép đối
  // chiếu từng dòng dưới đây mới bắt được.
  {
    const { T } = loadTranscriptPanel({ total: 6, page: 6 });
    const { segments } = await T.fromPanel();
    ok(segments.length === 6, `phải có 6 dòng để đối chiếu, nhận: ${segments.length}`);
    for (let i = 0; i < segments.length; i++) {
      ok(
        segments[i].start === i,
        `dòng ${i}: mốc thời gian phải là ${i} giây (đọc từ ô timestamp), nhận: ${JSON.stringify(segments[i].start)}`
      );
      ok(
        segments[i].text === `dòng ${i}`,
        `dòng ${i}: lời thoại phải là "dòng ${i}" (đọc từ span lời thoại), nhận: ${JSON.stringify(segments[i].text)}`
      );
    }
    // Nhãn trợ năng "3 seconds" nằm ngay cạnh mốc thời gian và rất dễ bị nuốt
    // vào giữa transcript — nó không được xuất hiện trong lời thoại.
    ok(
      !segments.some((s) => /seconds/.test(s.text)),
      `nhãn trợ năng không được lọt vào lời thoại, nhận: ${JSON.stringify(segments.map((s) => s.text))}`
    );
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
