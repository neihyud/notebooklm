/*
 * Extension tự chụp CẤU TRÚC DOM khi nó lạc đường (ticket 004).
 *
 * Bản chụp là một ĐƯỜNG DỮ LIỆU SONG SONG: nó rời khỏi automation.js đi vào
 * chrome.storage.local rồi sang trang Options, và không nằm trên đường đi của một
 * Lượt chạy. Không assertion nào của `test/notebooklm-dom.test.js` nhìn tới nó —
 * nên mọi thứ ở đây phải tự canh lấy mình:
 *
 *   - ghi ĐÚNG tình huống vào ĐÚNG khoá (hoán vị hai nhãn tình huống -> nội dung
 *     nằm nhầm khoá, mà hình dạng vẫn y hệt);
 *   - `fields` và `buttons` là hai mảng CÙNG KIỂU trong một bản chụp;
 *   - `sourcesBefore`/`sourcesAfter` là hai số cùng kiểu;
 *   - `listFound` là một boolean quyết định owner đi sửa `sourceList` hay `sourceItem`;
 *   - và ghi hỏng thì Lượt chạy vẫn phải chạy tiếp, vì bản chụp chỉ là phụ phẩm.
 *
 * Ràng buộc CỨNG được kiểm ở mục 6: bản chụp mang cấu trúc, KHÔNG mang nội dung
 * của owner.
 */
const { loadFixture } = require('./dom-harness.js');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

/**
 * Ba tình huống, đọc thẳng từ mã nguồn chứ không gõ lại chuỗi.
 * Chưa có thì thay bằng ba chỗ trống GIỐNG NHAU: assertion đầu tiên sẽ đỏ đúng
 * chỗ, thay vì cả file ném TypeError và giấu mất mọi thứ phía sau.
 */
const R = loadFixture().A.REPORT || { URL_INPUT_FALLBACK: '(chưa có)', SUBMIT_NOT_FOUND: '(chưa có)', SOURCE_LIST_UNREADABLE: '(chưa có)' };

const NUT_CHEN = '<button class="nut-chen"><span class="mdc-button__label">Chèn</span></button>';
const NGUON = (n) =>
  Array.from({ length: n }, (_, i) => `<div class="single-source-container">Nguồn ${i + 1}</div>`).join('');

/** Hộp thoại có ô nhập văn bản + nút Chèn; bấm Chèn thì hộp thoại đóng như thật. */
function fixtureChen(bodyHtml = '', extra = '') {
  const g = loadFixture(
    `<input formcontrolname="title"><textarea class="real-paste-area"></textarea>${extra}${NUT_CHEN}`,
    bodyHtml
  );
  g.doc.querySelector('.nut-chen').addEventListener('click', () => g.dialog.remove());
  return g;
}

/**
 * Khoá lưu bản chụp là thứ DUY NHẤT owner đọc để biết mình đang xem cái gì —
 * nó hiện nguyên văn trên trang Options. Hoán vị hai giá trị trong `REPORT` thì
 * mã nguồn vẫn nhất quán với chính nó (cả code lẫn test đều gọi qua hằng số),
 * chỉ có owner là đọc nhầm. Nên phải neo TÊN vào NỘI DUNG:
 *   - tên có "url-input" thì bên trong phải là selector đã khớp;
 *   - tên có "submit"    thì bên trong phải là danh sách nhãn đã thử;
 *   - tên có "source-list" thì bên trong phải là phán quyết về danh sách Nguồn.
 */
function tenKhopNoiDung(key, rep) {
  const d = (rep && rep.detail) || {};
  if (/url-input/.test(key)) return typeof d.matchedSelector === 'string';
  if (/submit/.test(key)) return Array.isArray(d.labelsTried);
  if (/source-list/.test(key)) return typeof d.listFound === 'boolean';
  return false;
}

/** Soi mọi bản chụp trong một storage. */
function moiKhoaKhop(g) {
  return Object.entries(g.reports()).every(([k, v]) => tenKhopNoiDung(k, v));
}

(async () => {
  ok(R && R.URL_INPUT_FALLBACK && R.SUBMIT_NOT_FOUND && R.SOURCE_LIST_UNREADABLE,
    `automation phải công bố tên ba tình huống, nhận: ${JSON.stringify(R)}`);
  ok(new Set(Object.values(R)).size === 3, `ba tình huống phải là ba chuỗi KHÁC nhau, nhận: ${JSON.stringify(R)}`);
  // Tên phải TỰ MÔ TẢ. Đây là hằng số duy nhất trong file này được ghim theo chữ,
  // và ghim có lý do: chính chuỗi này là câu mà owner đọc trên trang Options.
  ok(/url.*input/.test(R.URL_INPUT_FALLBACK), `tên tình huống ô nhập phải nói về ô nhập, nhận: ${JSON.stringify(R.URL_INPUT_FALLBACK)}`);
  ok(/submit/.test(R.SUBMIT_NOT_FOUND), `tên tình huống nút xác nhận phải nói về nút, nhận: ${JSON.stringify(R.SUBMIT_NOT_FOUND)}`);
  ok(/source.*list/.test(R.SOURCE_LIST_UNREADABLE), `tên tình huống danh sách Nguồn phải nói về danh sách, nhận: ${JSON.stringify(R.SOURCE_LIST_UNREADABLE)}`);

  /* ---------- 1. Tình huống 1: chỉ khớp được nhờ selector dự phòng rộng ---------- */

  // Hai selector rộng KHÁC nhau, mỗi cái một ca: bản chụp phải ghi đúng cái đã
  // khớp, không phải cái đầu danh sách và cũng không phải một chuỗi cứng.
  for (const [html, selector] of [
    ['<input type="text">', 'input[type="text"]'],
    ['<input>', 'input:not([type])'],
  ]) {
    const g = loadFixture(html);
    await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch(() => {});
    const rep = g.reports()[R.URL_INPUT_FALLBACK];
    ok(!!rep, `khớp được nhờ ${selector} thì phải có bản chụp, nhận: ${JSON.stringify(Object.keys(g.reports()))}`);
    ok(rep && rep.detail.matchedSelector === selector,
      `bản chụp phải ghi đúng selector đã khớp (${selector}), nhận: ${JSON.stringify(rep && rep.detail)}`);
    ok(rep && rep.situation === R.URL_INPUT_FALLBACK,
      `bản chụp phải tự khai đúng tình huống của nó, nhận: ${JSON.stringify(rep && rep.situation)}`);
    ok(moiKhoaKhop(g), `mọi khoá phải mang đúng nội dung mà tên nó hứa, nhận: ${JSON.stringify(Object.entries(g.reports()).map(([k, v]) => [k, v.detail]))}`);
  }

  // Chiều ngược lại — đây mới là chỗ tình huống 1 có nghĩa: khớp được bằng
  // selector CỤ THỂ thì KHÔNG chụp, nếu không mọi lượt chạy đều đẻ ra bản chụp
  // và bản chụp thành vô nghĩa.
  {
    const g = loadFixture('<input formcontrolname="url">');
    await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch(() => {});
    ok(!g.reports()[R.URL_INPUT_FALLBACK],
      `khớp được input[formcontrolname="url"] thì KHÔNG được chụp, nhận: ${JSON.stringify(g.reports()[R.URL_INPUT_FALLBACK] || null)}`);
  }

  /* ---------- 2. Tình huống 2: không tìm ra nút xác nhận ---------- */

  // Bản chụp state-main KHÔNG có nút xác nhận nào — đây là trạng thái thật của
  // fixture, không phải giả định.
  const g2 = loadFixture('<input type="text">');
  await g2.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch(() => {});
  const repThat = g2.reports()[R.SUBMIT_NOT_FOUND];
  ok(!!repThat, `không tìm ra nút xác nhận thì phải có bản chụp, nhận: ${JSON.stringify(Object.keys(g2.reports()))}`);
  // Chưa có bản chụp thì mọi assertion phía dưới vẫn phải ĐỎ có lời, không phải
  // ném TypeError rồi giấu nốt phần còn lại của file.
  const RONG = { detail: {}, fields: [], buttons: [], outline: [], customTags: {} };
  const repSubmit = repThat || RONG;
  const repUrl = g2.reports()[R.URL_INPUT_FALLBACK] || RONG;

  // Hoán vị hai nhãn tình huống ở hai chỗ gọi thì hai khối dưới đây đổi chỗ nhau:
  // mỗi khoá phải mang đúng NỘI DUNG của tình huống mình.
  ok(Array.isArray(repSubmit.detail.labelsTried) && repSubmit.detail.labelsTried.length > 0,
    `bản chụp "không thấy nút" phải kèm danh sách nhãn đã thử, nhận: ${JSON.stringify(repSubmit.detail)}`);
  ok(repSubmit.detail.matchedSelector === undefined,
    `bản chụp "không thấy nút" KHÔNG được mang chi tiết của tình huống ô nhập, nhận: ${JSON.stringify(repSubmit.detail)}`);
  ok(repUrl.detail.labelsTried === undefined,
    `bản chụp ô nhập KHÔNG được mang chi tiết của tình huống nút, nhận: ${JSON.stringify(repUrl.detail)}`);
  ok(moiKhoaKhop(g2), `mọi khoá phải mang đúng nội dung mà tên nó hứa, nhận: ${JSON.stringify(Object.entries(g2.reports()).map(([k, v]) => [k, v.detail]))}`);

  /* ---------- 3. fields và buttons: hai mảng CÙNG KIỂU trong một bản chụp ---------- */

  const nhan = (r) => ((r && r.buttons) || []).map((b) => b.label);
  const the = (list) => (list || []).map((n) => n.tag);

  ok(Array.isArray(repSubmit.fields) && Array.isArray(repSubmit.buttons),
    `bản chụp hộp thoại phải có cả fields lẫn buttons, nhận: ${JSON.stringify(Object.keys(repSubmit))}`);
  ok(the(repSubmit.fields).every((t) => ['input', 'textarea'].includes(t)),
    `fields chỉ được chứa ô nhập, nhận: ${JSON.stringify(the(repSubmit.fields))}`);
  ok(the(repSubmit.buttons).every((t) => t === 'button'),
    `buttons chỉ được chứa nút, nhận: ${JSON.stringify(the(repSubmit.buttons))}`);
  ok(nhan(repSubmit).includes('trang web') && nhan(repSubmit).includes('van ban da sao chep'),
    `buttons phải mang nhãn thật của các nút trong hộp thoại, nhận: ${JSON.stringify(nhan(repSubmit))}`);
  ok((repSubmit.fields || []).every((f) => f.label === undefined),
    `fields không mang nhãn nút, nhận: ${JSON.stringify(repSubmit.fields)}`);

  /* ---------- 4. Bản chụp phải ĐỦ để tái dựng phép chọn ---------- */
  // Chạy trên chính fixture DOM thật: nếu owner dán bản chụp về, Lead phải sửa
  // được selector chỉ bằng những gì có trong đó.

  const discover = (repSubmit.fields || []).find((f) => f.attrs.formcontrolname === 'discoverSourcesQuery');
  ok(!!discover, `bản chụp phải nêu được formcontrolname của ô nhập, nhận: ${JSON.stringify((repSubmit.fields || []).map((f) => f.attrs))}`);
  ok(discover && discover.path.includes('source-discovery-query-box'),
    `đường CSS phải leo tới được phần tử tổ tiên có tên, nhận: ${JSON.stringify(discover && discover.path)}`);
  // CHIỀU của đường mới là thứ dùng được: 'tổ tiên > … > chính nó'. Dựng ngược
  // thì vẫn đủ mọi mẩu, đọc vẫn xuôi tai, mà dán vào querySelector là chọn trượt.
  {
    // Bỏ dấu '…' mở đầu (đường bị trần độ sâu cắt) — thứ đang kiểm là CHIỀU.
    const doan = (discover ? discover.path : '').split(' > ').filter((t) => t !== '…');
    ok(doan[doan.length - 1].startsWith('textarea'),
      `phần tử được mô tả phải đứng CUỐI đường CSS, nhận: ${JSON.stringify(discover && discover.path)}`);
    ok(doan[0].startsWith('div') || doan[0].startsWith('mat-dialog-container'),
      `tổ tiên phải đứng ĐẦU đường CSS, nhận: ${JSON.stringify(discover && discover.path)}`);
    ok(/^… > /.test(discover ? discover.path : ''),
      `đường bị trần độ sâu cắt phải nói ra bằng '…', nhận: ${JSON.stringify(discover && discover.path)}`);
    ok(repSubmit.fields.length > 1 && !/^… > /.test((repSubmit.fields[1] || {}).path || ''),
      `đường leo được tới gốc thì KHÔNG được gắn '…', nhận: ${JSON.stringify((repSubmit.fields[1] || {}).path)}`);
    ok(doan.indexOf('source-discovery-query-box') < doan.length - 1,
      `tổ tiên phải nằm TRƯỚC phần tử, nhận: ${JSON.stringify(discover && discover.path)}`);
  }
  ok(discover && typeof discover.attrs.placeholder === 'string' && discover.attrs.placeholder.length > 0,
    `bản chụp phải giữ placeholder (thứ để viết selector), nhận: ${JSON.stringify(discover && discover.attrs)}`);
  ok(discover && discover.visible === true, `ô đang hiện phải được ghi là visible, nhận: ${JSON.stringify(discover && discover.visible)}`);

  const nutTrangWeb = (repSubmit.buttons || []).find((b) => b.label === 'trang web');
  ok(nutTrangWeb && /drop-zone-icon-button/.test(nutTrangWeb.attrs.class || ''),
    `bản chụp nút phải giữ class thật, nhận: ${JSON.stringify(nutTrangWeb && nutTrangWeb.attrs)}`);
  ok(nutTrangWeb && typeof nutTrangWeb.attrs.jslog === 'string',
    `bản chụp nút phải giữ jslog, nhận: ${JSON.stringify(nutTrangWeb && nutTrangWeb.attrs)}`);
  // Chỗ cắt phải nhìn thấy được: class của ô này dài hơn trần, và một tên class
  // bị cắt cụt mà không có dấu thì trông hệt như tên class thật.
  ok(discover && /…$/.test(discover.attrs.class || ''),
    `class dài quá trần phải được đánh dấu chỗ cắt, nhận: ${JSON.stringify(discover && discover.attrs.class)}`);
  ok(nutTrangWeb && !/…$/.test(nutTrangWeb.attrs.class || ''),
    `class vừa trần thì KHÔNG được gắn dấu cắt, nhận: ${JSON.stringify(nutTrangWeb && nutTrangWeb.attrs.class)}`);

  // Nhãn nút cũng có trần, và trần đó hẹp hơn trần thuộc tính: một nhãn dài bất
  // thường gần như chắc chắn là chữ của owner lọt vào chỗ đáng ra chỉ có nhãn nút.
  {
    const dai = 'Tên một Nguồn rất dài của owner lẽ ra không được nằm ở đây chút nào cả';
    const g = loadFixture(`<input type="text"><button aria-label="${dai}"></button>`);
    await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch(() => {});
    const nhanDai = ((g.reports()[R.SUBMIT_NOT_FOUND] || {}).buttons || []).map((b) => b.label).find((l) => /^ten mot nguon/.test(l));
    ok(!!nhanDai, `tiền đề: nút nhãn dài phải có mặt trong bản chụp, nhận: ${JSON.stringify(((g.reports()[R.SUBMIT_NOT_FOUND] || {}).buttons || []).map((b) => b.label))}`);
    ok(nhanDai && nhanDai.length <= 61 && /…$/.test(nhanDai),
      `nhãn dài phải bị cắt và đánh dấu, nhận (${nhanDai && nhanDai.length} ký tự): ${JSON.stringify(nhanDai)}`);
    ok(nhanDai && !nhanDai.includes('không được nằm ở đây'), 'phần đuôi của nhãn dài phải bị cắt bỏ thật');
  }

  ok(repSubmit.customTags && repSubmit.customTags['source-discovery-query-box'] === 1,
    `bản chụp phải điểm danh thẻ tuỳ biến của Angular, nhận: ${JSON.stringify(repSubmit.customTags)}`);
  ok((repSubmit.outline || []).some((line) => line.includes('drop-zone-container')),
    `khung xương phải nêu được vùng chứa nút, nhận: ${JSON.stringify((repSubmit.outline || []).slice(0, 12))}`);
  ok(repSubmit.truncated === false, `bản chụp một hộp thoại bình thường không được bị cắt, nhận: ${JSON.stringify(repSubmit.truncated)}`);

  /* ---------- 5. Tình huống 3: không đọc được danh sách Nguồn ---------- */

  // 5a — không thấy cả KHUNG danh sách.
  {
    const g = fixtureChen('');
    const r = await g.A.addTextSource('Tiêu đề', 'Nội dung', { timeout: 2000 });
    const rep = g.reports()[R.SOURCE_LIST_UNREADABLE];
    ok(r.ok === true && r.verified === false, `tiền đề: lượt chạy vẫn ra "chưa xác minh được", nhận: ${JSON.stringify(r)}`);
    ok(!!rep, `không đọc được danh sách Nguồn thì phải có bản chụp, nhận: ${JSON.stringify(Object.keys(g.reports()))}`);
    ok(rep && rep.detail.listFound === false,
      `không thấy khung danh sách thì listFound phải là false, nhận: ${JSON.stringify(rep && rep.detail)}`);
  }

  // 5b — THẤY khung nhưng không đọc nổi Nguồn nào bên trong. Cùng một tình huống
  // với 5a nhưng cách sửa khác hẳn (sourceItem chứ không phải sourceList), nên
  // `listFound` phải phân biệt được hai ca — hoán vị nó là chỉ owner đi sai đường.
  {
    const g = fixtureChen('<labs-tailwind-source-list><div class="nguon-kieu-moi"></div></labs-tailwind-source-list>');
    await g.A.addTextSource('Tiêu đề', 'Nội dung', { timeout: 2000 });
    const rep = g.reports()[R.SOURCE_LIST_UNREADABLE];
    ok(rep && rep.detail.listFound === true,
      `thấy khung mà không đọc nổi Nguồn thì listFound phải là true, nhận: ${JSON.stringify(rep && rep.detail)}`);
    ok(rep && (rep.customTags || {})['labs-tailwind-source-list'] === 1,
      `bản chụp trang phải điểm danh thẻ của danh sách Nguồn, nhận: ${JSON.stringify(rep && rep.customTags)}`);
    ok(rep && (rep.outline || []).some((line) => line.includes('nguon-kieu-moi')),
      `khung xương phải nêu được class của phần tử Nguồn, nhận: ${JSON.stringify(rep && (rep.outline || []).slice(0, 12))}`);
  }

  // 5c — đếm được TRƯỚC, mất danh sách SAU. Hai số cùng kiểu trong một bản chụp:
  // hoán vị chúng thì owner đọc ngược hẳn diễn biến.
  {
    const g = fixtureChen(`<labs-tailwind-source-list>${NGUON(2)}</labs-tailwind-source-list>`);
    g.doc.querySelector('.nut-chen').addEventListener('click', () => {
      g.doc.querySelector('labs-tailwind-source-list').remove();
    });
    await g.A.addTextSource('Tiêu đề', 'Nội dung', { timeout: 2000 });
    const rep = g.reports()[R.SOURCE_LIST_UNREADABLE];
    ok(rep && rep.detail.sourcesBefore === 2,
      `sourcesBefore phải là số ĐẾM TRƯỚC (2), nhận: ${JSON.stringify(rep && rep.detail)}`);
    ok(rep && rep.detail.sourcesAfter === null,
      `sourcesAfter phải là null (đọc không được SAU), nhận: ${JSON.stringify(rep && rep.detail)}`);
  }

  // 5d — đọc được cả trước lẫn sau thì KHÔNG chụp gì cả.
  {
    const g = fixtureChen(`<labs-tailwind-source-list>${NGUON(2)}</labs-tailwind-source-list>`);
    const list = g.doc.querySelector('labs-tailwind-source-list');
    g.doc.querySelector('.nut-chen').addEventListener('click', () => list.insertAdjacentHTML('beforeend', NGUON(1)));
    const r = await g.A.addTextSource('Tiêu đề', 'Nội dung', { timeout: 2000 });
    ok(r.verified === true, `tiền đề: lượt chạy này xác minh được, nhận: ${JSON.stringify(r)}`);
    ok(!g.reports()[R.SOURCE_LIST_UNREADABLE],
      `đọc được danh sách thì không được chụp, nhận: ${JSON.stringify(g.reports()[R.SOURCE_LIST_UNREADABLE] || null)}`);
    // Lượt chạy này TÌM ĐƯỢC nút Chèn (hộp thoại có nút "Chèn" thật). Chụp cả
    // lúc tìm được là biến bản chụp thành thứ luôn có mặt, và một thứ luôn có
    // mặt thì không còn là tín hiệu nữa.
    ok(!g.reports()[R.SUBMIT_NOT_FOUND],
      `tìm được nút xác nhận thì KHÔNG được chụp, nhận: ${JSON.stringify(g.reports()[R.SUBMIT_NOT_FOUND] || null)}`);
    ok(Object.keys(g.reports()).length === 0,
      `lượt chạy trơn tru không được để lại bản chụp nào, nhận: ${JSON.stringify(Object.keys(g.reports()))}`);
  }

  // 5e — bản chụp phải là hộp thoại NHƯ LÚC TÌM THẤY, chưa bị chính extension
  // động vào. Gõ vào ô là Angular chạy validate và dựng thêm phần tử; chụp sau
  // đó thì owner đọc phải một hộp thoại do ta gây ra, không phải hộp thoại đã
  // làm ta lạc đường.
  {
    const g = loadFixture('<input type="text" class="o-rong">');
    g.doc.querySelector('.o-rong').addEventListener('input', () => {
      g.doc.querySelector('[mat-dialog-content]')
        .insertAdjacentHTML('beforeend', '<mat-error class="loi-hien-sau-khi-go"></mat-error>');
    });
    await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch(() => {});
    const rep = g.reports()[R.URL_INPUT_FALLBACK];
    ok(!!g.doc.querySelector('.loi-hien-sau-khi-go'), 'tiền đề: hộp thoại có đổi hình dạng sau khi gõ');
    ok(rep && !JSON.stringify(rep).includes('loi-hien-sau-khi-go'),
      `bản chụp phải chụp TRƯỚC khi gõ, nhận: ${JSON.stringify((rep && rep.outline || []).slice(-6))}`);
  }

  /* ---------- 6. RIÊNG TƯ: bản chụp mang cấu trúc, KHÔNG mang nội dung ---------- */

  const BIMAT = 'BIMAT-KHONG-DUOC-RO-RA-9f3a2b';

  {
    // Đường hộp thoại: giá trị BIMAT nằm trong ô nhập (cả do người dùng gõ lẫn do
    // chính extension ghi vào), trong nhãn phần tử ngoài hộp thoại, và trong tiêu
    // đề notebook.
    const g = loadFixture(
      `<input type="text" value="${BIMAT}"><textarea class="da-go">${BIMAT}</textarea>` +
        `<div contenteditable="true">${BIMAT}</div>`,
      `<h1 class="notebook-title">${BIMAT}</h1>`
    );
    await g.A.addUrlSource(`https://example.com/${BIMAT}`, { timeout: 300 }).catch(() => {});
    const bai = JSON.stringify(g.reports());
    ok(Object.keys(g.reports()).length >= 2, `tiền đề: phải có bản chụp để mà soi, nhận: ${JSON.stringify(Object.keys(g.reports()))}`);
    ok(bai.includes('formcontrolname'), 'tiền đề: bản chụp phải có nội dung cấu trúc thật (nếu rỗng thì phép kiểm riêng tư vô nghĩa)');
    ok(!bai.includes(BIMAT), `bản chụp hộp thoại KHÔNG được mang nội dung của owner, tìm thấy chuỗi bí mật trong: ${bai.slice(0, 400)}`);
  }

  {
    // Đường danh sách Nguồn: BIMAT nằm trong chữ của Nguồn, trong aria-label và
    // title của nó, trong nhãn nút của trang, và trong tiêu đề notebook.
    const g = fixtureChen(
      `<h1 class="notebook-title">${BIMAT}</h1>` +
        '<labs-tailwind-source-list-v2>' +
        `<div class="nguon-kieu-moi" aria-label="${BIMAT}" title="${BIMAT}" placeholder="${BIMAT}">${BIMAT}</div>` +
        `<button aria-label="${BIMAT}">${BIMAT}</button>` +
        '</labs-tailwind-source-list-v2>'
    );
    await g.A.addTextSource(BIMAT, `transcript ${BIMAT}`, { timeout: 2000 });
    const rep = g.reports()[R.SOURCE_LIST_UNREADABLE];
    const bai = JSON.stringify(rep) || '';
    ok(!!rep, `tiền đề: phải có bản chụp trang để mà soi, nhận: ${JSON.stringify(Object.keys(g.reports()))}`);
    ok(bai.includes('labs-tailwind-source-list-v2'), 'tiền đề: bản chụp trang phải nêu được thẻ của danh sách');
    ok(!bai.includes(BIMAT), `bản chụp trang KHÔNG được mang nội dung Nguồn của owner, tìm thấy chuỗi bí mật trong: ${bai.slice(0, 400)}`);
    // Cả kho storage chứ không riêng một bản chụp — kể cả bản chụp hộp thoại của
    // cùng lượt chạy này.
    ok(!JSON.stringify(g.reports()).includes(BIMAT), 'không bản chụp nào trong storage được mang nội dung của owner');
  }

  /* ---------- 7. Chỉ giữ bản GẦN NHẤT cho mỗi tình huống ---------- */

  {
    const g = loadFixture('<input type="text">');
    await g.A.addUrlSource('https://example.com/mot', { timeout: 300 }).catch(() => {});
    const lan1 = g.reports()[R.SUBMIT_NOT_FOUND];
    ok(!nhan(lan1).includes('nut moi toanh'), 'tiền đề: lần chụp đầu chưa có nút mới');

    g.doc.querySelector('[mat-dialog-content]').insertAdjacentHTML(
      'beforeend',
      '<button class="nut-moi"><span class="mdc-button__label">Nút mới toanh</span></button>'
    );
    await g.A.addUrlSource('https://example.com/hai', { timeout: 300 }).catch(() => {});
    const lan2 = g.reports()[R.SUBMIT_NOT_FOUND];

    ok(nhan(lan2).includes('nut moi toanh'), `bản chụp phải là bản GẦN NHẤT, nhận: ${JSON.stringify(nhan(lan2))}`);
    ok(!Array.isArray(g.reports()), 'bản chụp không được tích thành nhật ký (mảng)');
    ok(Object.keys(g.reports()).length === 2,
      `hai lượt chạy chỉ được để lại hai tình huống, nhận: ${JSON.stringify(Object.keys(g.reports()))}`);
    ok(Object.keys(g.reports()).every((k) => Object.values(R).includes(k)),
      `mọi khoá phải là một tình huống đã khai báo, nhận: ${JSON.stringify(Object.keys(g.reports()))}`);
  }

  /* ---------- 8. Trần dung lượng ---------- */

  {
    const to = '<labs-tailwind-source-list>' +
      Array.from({ length: 2000 }, (_, i) => `<div class="hang-rat-dai-de-lam-day-ban-chup-${i}"><span class="con"></span></div>`).join('') +
      '</labs-tailwind-source-list>';
    const g = fixtureChen(to);
    await g.A.addTextSource('Tiêu đề', 'Nội dung', { timeout: 2000 });
    const rep = g.reports()[R.SOURCE_LIST_UNREADABLE];
    const co = (JSON.stringify(rep) || '').length;
    ok(co <= 40000, `bản chụp phải nằm dưới trần dung lượng, nhận ${co} ký tự`);
    ok(rep && rep.truncated === true, `bản chụp bị cắt phải tự khai truncated:true, nhận: ${JSON.stringify(rep && rep.truncated)}`);
    ok(rep && rep.detail.listFound === true, 'bị cắt thì vẫn phải giữ được phần chẩn đoán');
  }

  // 8b — vượt trần bằng chính phần cấu trúc, không phải bằng khung xương: nhánh
  // cuối cùng của phép cắt phải buông cả fields/buttons mà VẪN giữ phần chẩn
  // đoán. Không có ca này thì nhánh đó là code chết và không ai biết.
  {
    const dai = 'x'.repeat(200);
    const nhoi =
      Array.from({ length: 60 }, () => `<input type="search" aria-label="${dai}" placeholder="${dai}" jslog="${dai}">`).join('') +
      Array.from({ length: 60 }, () => `<button aria-label="${dai}" jslog="${dai}"><span class="mdc-button__label">nut</span></button>`).join('');
    const g = loadFixture(`<input type="text">${nhoi}`);
    await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch(() => {});
    const rep = g.reports()[R.SUBMIT_NOT_FOUND];
    const co = (JSON.stringify(rep) || '').length;
    ok(co <= 40000, `bản chụp hộp thoại khổng lồ vẫn phải nằm dưới trần, nhận ${co} ký tự`);
    ok(rep && rep.truncated === true, `bị cắt thì phải khai truncated:true, nhận: ${JSON.stringify(rep && rep.truncated)}`);
    ok(rep && Array.isArray(rep.detail.labelsTried) && rep.detail.labelsTried.length > 0,
      `phần chẩn đoán phải sống sót qua phép cắt, nhận: ${JSON.stringify(rep && rep.detail)}`);
    ok(rep && rep.situation === R.SUBMIT_NOT_FOUND, 'tình huống phải sống sót qua phép cắt');
  }

  // 8c — vượt trần vì khung xương: nhánh cắt ĐẦU TIÊN phải buông khung xương mà
  // GIỮ fields/buttons. Thứ tự buông ấy là cả giá trị của bản chụp: ô nhập và
  // nút là thứ sửa được selector, khung xương chỉ là bối cảnh.
  {
    const dai = 'x'.repeat(200);
    const nhoi =
      Array.from({ length: 40 }, () => `<input type="search" aria-label="${dai}" placeholder="${dai}" jslog="${dai}">`).join('') +
      Array.from({ length: 300 }, (_, i) => `<div class="hang-dai-de-lam-day-khung-xuong-${i}"><span class="con-cua-no"></span></div>`).join('');
    const g = loadFixture(`<input type="text">${nhoi}`);
    await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch(() => {});
    const rep = g.reports()[R.SUBMIT_NOT_FOUND];
    const co = (JSON.stringify(rep) || '').length;
    ok(co <= 40000, `phải nằm dưới trần, nhận ${co} ký tự`);
    ok(rep && rep.truncated === true, `bị cắt thì phải khai truncated:true, nhận: ${JSON.stringify(rep && rep.truncated)}`);
    ok(rep && Array.isArray(rep.fields) && rep.fields.length > 1,
      `phải giữ fields khi buông khung xương, nhận: ${JSON.stringify(rep && (rep.fields || []).length)}`);
    ok(rep && (rep.outline || []).length <= 41,
      `khung xương phải là thứ bị buông trước, nhận ${rep && (rep.outline || []).length} dòng`);
  }

  /* ---------- 9. Bản chụp là PHỤ PHẨM: ghi hỏng không được giết lượt chạy ---------- */

  {
    const g = fixtureChen('');
    g.win.chrome.storage.local.set = async () => { throw new Error('storage đầy'); };
    const r = await g.A.addTextSource('Tiêu đề', 'Nội dung', { timeout: 2000 });
    ok(r.ok === true && r.verified === false,
      `ghi bản chụp hỏng thì lượt chạy vẫn phải trả kết quả như thường, nhận: ${JSON.stringify(r)}`);
  }
  {
    const g = loadFixture('<input type="text">');
    g.win.chrome.storage.local.set = async () => { throw new Error('storage đầy'); };
    let loi = null;
    await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 300 }).catch((e) => (loi = e));
    ok(loi && /nút Chèn/.test(loi.message || ''),
      `ghi bản chụp hỏng không được nuốt mất lỗi thật, nhận: ${JSON.stringify(loi && loi.message)}`);
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
