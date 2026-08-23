/*
 * Chạy mã nguồn THẬT qua DOM THẬT đã chụp của hộp thoại "Thêm nguồn"
 * (`test/fixtures/notebooklm-add-source-state-main.html`, trạng thái state-main).
 *
 * Test ở đây cố tình KHÔNG assert nội dung mảng selector: ghim một hằng số chép
 * tay thì xanh vĩnh viễn kể cả khi Google đổi DOM. Mọi assertion bên dưới đều là
 * kết quả *chạy* selector qua DOM đó.
 */
const { loadFixture } = require('./dom-harness.js');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('❌ ' + m)));

const f = loadFixture();
const { S, I, dialog, discoverBox } = f;
const byVisible = (t) => [...dialog.querySelectorAll('button')].find((b) => f.visibleLabel(b) === t);

const btnWeb = byVisible('Trang web');
const btnPaste = byVisible('Văn bản đã sao chép');
const btnUpload = byVisible('Tải tệp lên');
const btnCorpus = byVisible('Web');
const btnClose = dialog.querySelector('.close-button');

/* ---------- 1. labelOf: chữ của <mat-icon> phải biến mất ---------- */

ok(I.labelOf(btnWeb) === 'trang web', `labelOf nút "Trang web" phải là 'trang web', nhận: ${JSON.stringify(I.labelOf(btnWeb))}`);
ok(!I.labelOf(btnWeb).includes('youtube'), `nhãn nút "Trang web" không được dính chữ icon 'video_youtube', nhận: ${JSON.stringify(I.labelOf(btnWeb))}`);
ok(I.labelOf(btnPaste) === 'van ban da sao chep', `labelOf nút dán văn bản, nhận: ${JSON.stringify(I.labelOf(btnPaste))}`);
ok(I.labelOf(btnUpload) === 'tai tep len', `labelOf nút tải tệp không được dính chữ icon 'upload', nhận: ${JSON.stringify(I.labelOf(btnUpload))}`);
ok(I.labelOf(btnClose) === 'dong', `labelOf nút đóng lấy aria-label, bỏ icon 'close', nhận: ${JSON.stringify(I.labelOf(btnClose))}`);
// Nút này có <mat-icon> nằm BÊN TRONG .mdc-button__label — đọc .mdc-button__label
// một mình vẫn dính 'language'/'keyboard_arrow_down'. Chỉ loại mat-icon mới đúng.
ok(I.labelOf(btnCorpus) === 'web', `labelOf nút chọn kho phải là 'web', nhận: ${JSON.stringify(I.labelOf(btnCorpus))}`);

/* ---------- 2. findByLabel: hết khớp-chứa thì hết bắt nhầm ---------- */

// Giao diện này KHÔNG có nút YouTube riêng. Trước bản vá, youtubeChip bắt trúng
// nút "Trang web" chỉ vì chuỗi 'video_youtube' của icon.
ok(I.findByLabel(dialog, S.youtubeChip) === null, `youtubeChip phải KHÔNG khớp gì (giao diện không có nút YouTube riêng), nhận: ${JSON.stringify(f.visibleLabel(I.findByLabel(dialog, S.youtubeChip) || dialog))}`);

// Không có nút xác nhận nào ở state-main. Trước bản vá, submit bắt trúng
// "Tải tệp lên" qua chữ icon 'upload' — bấm nhầm vào hộp chọn tệp.
ok(I.findByLabel(dialog, S.submit) === null, `submit phải KHÔNG khớp gì ở state-main, nhận: ${JSON.stringify(f.visibleLabel(I.findByLabel(dialog, S.submit) || dialog))}`);

// Cặp hoán vị: hai nút loại nguồn cùng kiểu, phải trỏ đúng nút của mình.
ok(I.findByLabel(dialog, S.websiteChip) === btnWeb, 'websiteChip trỏ đúng nút "Trang web"');
ok(I.findByLabel(dialog, S.pasteChip) === btnPaste, 'pasteChip trỏ đúng nút "Văn bản đã sao chép"');
ok(I.findByLabel(dialog, S.websiteChip) !== I.findByLabel(dialog, S.pasteChip), 'websiteChip và pasteChip không được trỏ chung một nút');
ok(I.findByLabel(dialog, S.websiteChip) !== btnUpload, 'websiteChip không được bắt nhầm nút tải tệp');
ok(I.findByLabel(dialog, S.pasteChip) !== btnUpload, 'pasteChip không được bắt nhầm nút tải tệp');
ok(I.findByLabel(dialog, S.cancel) === btnClose, 'cancel vẫn trỏ đúng nút đóng (khớp aria-label đã làm sạch)');

// Nhãn chung chung xếp CUỐI `addSource` phải thua nhãn cụ thể, kể cả khi nút mang
// nhãn chung chung đứng TRƯỚC trong DOM. Bỏ pha khớp-chứa làm chuyện này quan
// trọng hơn trước: pha đó bỏ qua nhãn dưới 4 ký tự, khớp chính xác thì không —
// nên giờ 'them' khớp thẳng được một nút "Thêm" bất kỳ.
{
  const g = loadFixture(
    '<div class="sidebar-gia-lap">' +
      '<button><mat-icon data-mat-icon-type="font">add</mat-icon><span class="mdc-button__label">Thêm</span></button>' +
      '<button><mat-icon data-mat-icon-type="font">add</mat-icon><span class="mdc-button__label">Thêm nguồn</span></button>' +
    '</div>'
  );
  const btns = [...g.doc.querySelectorAll('.sidebar-gia-lap button')];
  ok(g.I.findByLabel(g.dialog, g.S.addSource) === btns[1], `addSource phải chọn "Thêm nguồn" chứ không phải "Thêm" đứng trước nó trong DOM, nhận: ${JSON.stringify(g.I.labelOf(g.I.findByLabel(g.dialog, g.S.addSource) || g.dialog))}`);
}

// Angular Material rắc `.cdk-visually-hidden` (bản chụp state-main có sẵn một cái).
// Chữ đó mắt không thấy, nên không được tính vào nhãn hiển thị — nếu tính, một nút
// "Chèn" kèm đuôi trợ năng sẽ không khớp chính xác với gì cả và mọi Nguồn đều fail.
{
  const g = loadFixture('<button><span class="mdc-button__label">Chèn</span><span class="cdk-visually-hidden"> nguồn mới</span></button>');
  const btn = g.doc.querySelector('[mat-dialog-content] > button');
  ok(g.I.labelsOf(btn).includes('chen'), `nhãn hiển thị phải bỏ chữ chỉ dành cho trình đọc màn hình, nhận: ${JSON.stringify(g.I.labelsOf(btn))}`);
  ok(g.I.findByLabel(g.dialog, g.S.submit) === btn, 'nút xác nhận có đuôi trợ năng vẫn phải tìm thấy được');
}

/* ---------- 3. Ô Khám phá nguồn bị cấm tuyệt đối khỏi mọi phép tìm ô ghi ---------- */

ok(discoverBox !== null, 'fixture có ô Khám phá nguồn (tiền đề của cả nhóm test này)');
for (const [name, list] of Object.entries({ textArea: S.css.textArea, urlInput: S.css.urlInput, titleInput: S.css.titleInput })) {
  const hit = I.queryFirst(dialog, list);
  ok(hit !== discoverBox, `queryFirst(${name}) không được trả về ô Khám phá nguồn`);
}

// Cặp hoán vị thật: HAI textarea cùng kiểu trong một hộp thoại, ô cấm đứng TRƯỚC
// trong DOM. Code phải chọn ô sau. Đây là chỗ 'textarea' trần + queryFirst sai.
{
  const g = loadFixture('<textarea class="real-paste-area"></textarea>');
  const real = g.doc.querySelector('.real-paste-area');
  const hit = g.I.queryFirst(g.dialog, g.S.css.textArea);
  ok(hit === real, `có textarea hợp lệ thì queryFirst phải trả về NÓ, không phải ô Khám phá nguồn (nhận: ${hit ? hit.getAttribute('formcontrolname') || hit.className : 'null'})`);
  ok(hit !== g.discoverBox, 'queryFirst bỏ qua ô Khám phá nguồn dù nó đứng trước trong DOM');
}

/* ---------- 4. Triệu chứng owner báo, chạy hết đường addTextSource ---------- */

(async () => {
  const g = loadFixture();
  const TITLE = 'Tiêu đề video thử';
  const BODY = 'NOI DUNG TRANSCRIPT KHONG DUOC ROI VAO O TIM KIEM';
  // Ghi lại nút NÀO thật sự bị bấm — bấm nhầm nút loại nguồn là đúng triệu chứng
  // owner báo, và không có gì khác quan sát được nó.
  const clicked = [];
  g.doc.addEventListener('click', (e) => clicked.push(g.I.labelOf(e.target)));
  const result = await g.A.addTextSource(TITLE, BODY, { timeout: 400 });

  ok(clicked.includes('van ban da sao chep'), `addTextSource phải bấm nút "Văn bản đã sao chép", đã bấm: ${JSON.stringify(clicked)}`);
  ok(!clicked.includes('trang web'), `addTextSource không được bấm nút "Trang web", đã bấm: ${JSON.stringify(clicked)}`);
  ok(!clicked.includes('tai tep len'), `addTextSource không được bấm nút "Tải tệp lên", đã bấm: ${JSON.stringify(clicked)}`);

  ok(g.discoverBox.value === '', `ô Khám phá nguồn phải RỖNG sau addTextSource, nhận: ${JSON.stringify(g.discoverBox.value)}`);
  ok(!g.discoverBox.value.includes(BODY), 'transcript không được rơi vào ô Khám phá nguồn');
  ok(!g.discoverBox.value.includes(TITLE), 'tiêu đề không được rơi vào ô Khám phá nguồn');
  ok(result.ok === false, 'không tìm được ô nhập thì phải báo hỏng, không được im lặng coi như xong');
  ok(/ô nhập văn bản/.test(result.error || ''), `lỗi phải nêu đúng bước đang kẹt, nhận: ${JSON.stringify(result.error)}`);

  /* ---- 5. title và text là hai string cùng kiểu: mỗi cái phải vào đúng ô ---- */
  // Hai ô dưới đây là ô GIẢ LẬP: bản chụp state-main chưa có ô nhập nào, và DOM
  // trạng thái sau khi bấm nút loại nguồn thì chưa chụp được. Chỉ hai điều là
  // thật và là thứ đang được kiểm: `textarea` trần cùng
  // `input[formcontrolname="title"]` đều đã có sẵn trong S.css, và ô Khám phá
  // nguồn vẫn đứng TRƯỚC chúng trong DOM.
  const h = loadFixture('<input formcontrolname="title"><textarea class="real-paste-area"></textarea>');
  const area = h.doc.querySelector('.real-paste-area');
  const titleInput = h.doc.querySelector('input[formcontrolname="title"]');
  await h.A.addTextSource(TITLE, BODY, { timeout: 400 });

  ok(area.value === BODY, `transcript phải vào ô văn bản, nhận: ${JSON.stringify(area.value)}`);
  ok(titleInput.value === TITLE, `tiêu đề phải vào ô tiêu đề, nhận: ${JSON.stringify(titleInput.value)}`);
  ok(area.value !== titleInput.value, 'hai ô không được nhận cùng một chuỗi');
  ok(h.discoverBox.value === '', `ô Khám phá nguồn vẫn phải rỗng dù có ô hợp lệ đứng sau, nhận: ${JSON.stringify(h.discoverBox.value)}`);

  /* ---- 6. Đường URL: chỉ có MỘT nút "Trang web" gánh cả link thường lẫn YouTube ---- */
  // `input[type="url"]` là ô GIẢ LẬP (DOM sau khi bấm nút loại nguồn chưa chụp được);
  // selector này vốn đã có trong S.css.urlInput, không phải thứ tôi bịa ra.
  for (const [ten, url] of [['YouTube', 'https://www.youtube.com/watch?v=abc'], ['link thường', 'https://example.com/bai-viet']]) {
    const u = loadFixture('<input type="url">');
    const urlInput = u.doc.querySelector('input[type="url"]');
    const bam = [];
    u.doc.addEventListener('click', (e) => bam.push(u.I.labelOf(e.target)));
    // addUrlSource NÉM lỗi khi không thấy nút Chèn (addTextSource thì trả {ok:false}).
    // Bản chụp state-main không có nút xác nhận và tôi không được bịa nhãn cho nó,
    // nên bắt lỗi ở đây rồi kiểm những gì đã quan sát được trước lúc kẹt.
    await u.A.addUrlSource(url, { timeout: 400 }).catch(() => {});

    ok(bam.includes('trang web'), `${ten}: phải bấm nút "Trang web" (giao diện không có nút YouTube riêng), đã bấm: ${JSON.stringify(bam)}`);
    ok(!bam.includes('van ban da sao chep'), `${ten}: không được bấm nút dán văn bản, đã bấm: ${JSON.stringify(bam)}`);
    ok(urlInput.value === url, `${ten}: URL phải vào ô URL, nhận: ${JSON.stringify(urlInput.value)}`);
    ok(u.discoverBox.value === '', `${ten}: ô Khám phá nguồn phải rỗng, nhận: ${JSON.stringify(u.discoverBox.value)}`);
  }

  // Lệnh cấm neo theo formcontrolname, không neo theo thẻ: ô Khám phá nguồn hiện là
  // <textarea>, nhưng nếu Google đổi sang <input> thì lệnh cấm vẫn phải giữ.
  {
    const v = loadFixture('<input formcontrolname="discoverSourcesQuery" type="text">');
    const giaDang = v.doc.querySelector('input[formcontrolname="discoverSourcesQuery"]');
    ok(v.I.queryFirst(v.dialog, v.S.css.urlInput) !== giaDang, 'lệnh cấm chặn cả <input formcontrolname="discoverSourcesQuery", không chỉ <textarea>');
  }

  /* ---- 7. `ok` phải có nghĩa "Nguồn đã vào", không phải "hộp thoại đã đóng" ---- */
  // Triệu chứng đo 2026-08-23: dán nội dung, bấm nhầm nút, hộp thoại đóng, item `done`
  // — mà notebook không hề có thêm Nguồn nào. Cái *cửa* đóng không phải cái *kết quả*.
  //
  // Danh sách Nguồn là DOM GIẢ LẬP: bản chụp state-main chỉ có hộp thoại, không có
  // danh sách Nguồn của notebook, và tôi không được bịa ra một bản chụp. Vì vậy ba
  // hàng dưới đây kiểm *logic ba nhánh* chứ không chứng nhận selector đúng — và đó
  // chính là lý do nhánh thứ ba (không đọc được danh sách) phải tồn tại: khi selector
  // của tôi sai trên DOM thật, nó rơi vào nhánh đó và NÓI RA, chứ không im lặng.

  const NGUON = (n) =>
    Array.from({ length: n }, (_, i) => `<div class="single-source-container">Nguồn ${i + 1}</div>`).join('');

  /**
   * @param truoc số Nguồn có sẵn; `null` = KHÔNG dựng danh sách nào (đúng như bản chụp thật)
   * @param them  số Nguồn xuất hiện thêm sau khi hộp thoại đóng
   */
  function kichBan({ truoc, them, tre = 0 }) {
    const g = loadFixture(
      '<input formcontrolname="title"><textarea class="real-paste-area"></textarea>' +
        '<button class="nut-chen"><span class="mdc-button__label">Chèn</span></button>',
      truoc === null ? '' : `<labs-tailwind-source-list>${NGUON(truoc)}</labs-tailwind-source-list>`
    );
    const list = g.doc.querySelector('labs-tailwind-source-list');
    g.doc.querySelector('.nut-chen').addEventListener('click', () => {
      // Đúng thứ tự thật: hộp thoại đóng TRƯỚC, danh sách mới cập nhật SAU.
      g.dialog.remove();
      if (!list || !them) return;
      const capNhat = () => list.insertAdjacentHTML('beforeend', NGUON(them));
      // `tre` mô phỏng đúng hành vi thật: NotebookLM đóng hộp thoại rồi mới dựng
      // lại danh sách Nguồn. Đếm ngay lúc đó là đọc trúng số CŨ.
      if (tre) g.win.setTimeout(capNhat, tre);
      else capNhat();
    });
    return g;
  }

  // Hàng 1 — đếm được, tăng đúng 1.
  {
    const g = kichBan({ truoc: 3, them: 1 });
    const r = await g.A.addTextSource(TITLE, BODY, { timeout: 3000 });
    ok(r.ok === true, `thêm được đúng 1 Nguồn thì phải ok, nhận: ${JSON.stringify(r)}`);
    ok(r.verified === true, `đếm được cả trước lẫn sau thì phải verified:true, nhận: ${JSON.stringify(r.verified)}`);
    ok(r.sourcesBefore === 3, `sourcesBefore phải là số ĐẾM TRƯỚC (3), nhận: ${JSON.stringify(r.sourcesBefore)}`);
    ok(r.sourcesAfter === 4, `sourcesAfter phải là số ĐẾM SAU (4), nhận: ${JSON.stringify(r.sourcesAfter)}`);
  }

  // Hàng 2a — hộp thoại đóng mà chẳng có Nguồn nào vào. Đây đúng là ca owner báo.
  {
    const g = kichBan({ truoc: 1, them: 0 });
    const r = await g.A.addTextSource(TITLE, BODY, { timeout: 3000 });
    ok(r.ok === false, `hộp thoại đóng mà số Nguồn không tăng thì KHÔNG được báo xong, nhận: ${JSON.stringify(r)}`);
    ok(/trước: 1/.test(r.error || ''), `lỗi phải nêu số Nguồn trước, nhận: ${JSON.stringify(r.error)}`);
    ok(/sau: 1/.test(r.error || ''), `lỗi phải nêu số Nguồn sau, nhận: ${JSON.stringify(r.error)}`);
    // Không có Nguồn nào vào -> tầng trên ĐƯỢC PHÉP thử lại bằng đường khác.
    ok(r.sourceAdded === false, `không Nguồn nào vào thì sourceAdded phải là false, nhận: ${JSON.stringify(r.sourceAdded)}`);
  }

  // Hàng 2b — tăng 2. Trước/sau KHÁC nhau nên thứ tự in ra quan sát được: hoán vị
  // hai số cùng kiểu này thì hai assertion dưới đổi chỗ và cùng chết.
  {
    const g = kichBan({ truoc: 1, them: 2 });
    const r = await g.A.addTextSource(TITLE, BODY, { timeout: 3000 });
    ok(r.sourceAdded === true, `số Nguồn CÓ tăng thì phải báo sourceAdded để tầng trên không thử lại, nhận: ${JSON.stringify(r.sourceAdded)}`);
    ok(r.ok === false, `tăng 2 Nguồn cũng là sai, không được báo xong, nhận: ${JSON.stringify(r)}`);
    ok(r.sourcesBefore === 1 && r.sourcesAfter === 3, `trước/sau phải là 1 và 3, nhận: ${JSON.stringify([r.sourcesBefore, r.sourcesAfter])}`);
    ok(/trước: 1/.test(r.error || ''), `thông báo phải in 1 vào chỗ "trước", nhận: ${JSON.stringify(r.error)}`);
    ok(/sau: 3/.test(r.error || ''), `thông báo phải in 3 vào chỗ "sau", nhận: ${JSON.stringify(r.error)}`);
    ok(/hộp thoại/i.test(r.error || ''), `lỗi phải kèm ảnh chụp hộp thoại, nhận: ${JSON.stringify(r.error)}`);
    // Bấm nhầm nút là *tác động*, không phải trạng thái — sau khi hộp thoại đóng
    // thì không còn quan sát được ở đâu khác ngoài chính thông báo lỗi này.
    ok(/đã bấm nút "chen"/.test(r.error || ''), `lỗi phải ghi lại nút đã bấm, nhận: ${JSON.stringify(r.error)}`);
  }

  // Hàng 3 — KHÔNG đọc được danh sách. Chạy trên bản chụp NGUYÊN VĂN, không thêm
  // danh sách nào: đây là trạng thái THẬT của fixture, không phải giả định.
  {
    const g = kichBan({ truoc: null, them: 0 });
    const r = await g.A.addTextSource(TITLE, BODY, { timeout: 3000 });
    ok(r.ok === true, `không đọc được danh sách thì vẫn ok (không được huỷ oan), nhận: ${JSON.stringify(r)}`);
    ok(r.verified === false, `không đọc được danh sách thì PHẢI verified:false, nhận: ${JSON.stringify(r.verified)}`);
    ok(r.sourcesBefore === null && r.sourcesAfter === null, `không đếm được phải là null, không được lặng lẽ thành 0, nhận: ${JSON.stringify([r.sourcesBefore, r.sourcesAfter])}`);
    ok(!r.error, `nhánh chưa xác minh được không phải là lỗi, nhận: ${JSON.stringify(r.error)}`);
  }

  // countSources phải trả null chứ không phải 0 khi không có danh sách — 0 là một
  // con số đếm được và sẽ trôi thẳng vào phép so `sau === trước + 1`.
  {
    const g = kichBan({ truoc: null, them: 0 });
    ok(g.I.countSources() === null, `không có danh sách Nguồn thì countSources phải trả null, nhận: ${JSON.stringify(g.I.countSources())}`);
    const h = kichBan({ truoc: 2, them: 0 });
    ok(h.I.countSources() === 2, `countSources phải đếm đúng số Nguồn đang hiện, nhận: ${JSON.stringify(h.I.countSources())}`);
  }

  // Danh sách cập nhật TRỄ sau khi hộp thoại đóng — đọc một phát rồi kết luận
  // ngay thì mọi lần import đều ra "số Nguồn không tăng" và hỏng oan.
  {
    const g = kichBan({ truoc: 4, them: 1, tre: 120 });
    const r = await g.A.addTextSource(TITLE, BODY, { timeout: 3000 });
    ok(r.ok === true && r.verified === true, `danh sách cập nhật trễ 120ms vẫn phải xác minh được, nhận: ${JSON.stringify(r)}`);
    ok(r.sourcesAfter === 5, `phải chờ tới số Nguồn MỚI (5), không lấy số cũ, nhận: ${JSON.stringify(r.sourcesAfter)}`);
  }

  // Không đếm được TRƯỚC thì kết luận đã chắc chắn là "chưa xác minh được" —
  // chờ danh sách cập nhật lúc đó là 8 giây vứt đi cho MỖI mục trong hàng đợi.
  {
    const g = kichBan({ truoc: null, them: 0 });
    const t0 = Date.now();
    const r = await g.I.confirmSourceAdded(null);
    const troi = Date.now() - t0;
    ok(r.verified === false, `confirmSourceAdded(null) phải ra verified:false, nhận: ${JSON.stringify(r)}`);
    // Cửa sổ chờ trong harness là 250ms; vượt 100ms nghĩa là có chờ thật.
    ok(troi < 100, `không đếm được TRƯỚC thì không được chờ danh sách cập nhật, đã chờ ${troi}ms`);
  }

  /* ---- 8. Đường URL cũng phải xác minh, không chỉ đường dán text ---- */
  {
    const g = loadFixture(
      '<input type="url"><button class="nut-chen"><span class="mdc-button__label">Chèn</span></button>',
      '<labs-tailwind-source-list>' + NGUON(5) + '</labs-tailwind-source-list>'
    );
    const list = g.doc.querySelector('labs-tailwind-source-list');
    g.doc.querySelector('.nut-chen').addEventListener('click', () => {
      g.dialog.remove();
      list.insertAdjacentHTML('beforeend', NGUON(1));
    });
    const r = await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 3000 });
    ok(r.ok === true && r.verified === true, `addUrlSource cũng phải xác minh số Nguồn, nhận: ${JSON.stringify(r)}`);
    ok(r.sourcesBefore === 5 && r.sourcesAfter === 6, `addUrlSource: trước/sau phải là 5 và 6, nhận: ${JSON.stringify([r.sourcesBefore, r.sourcesAfter])}`);
  }
  {
    const g = loadFixture(
      '<input type="url"><button class="nut-chen"><span class="mdc-button__label">Chèn</span></button>',
      '<labs-tailwind-source-list>' + NGUON(5) + '</labs-tailwind-source-list>'
    );
    g.doc.querySelector('.nut-chen').addEventListener('click', () => g.dialog.remove());
    const r = await g.A.addUrlSource('https://example.com/bai-viet', { timeout: 3000 });
    ok(r.ok === false, `addUrlSource: hộp thoại đóng mà không có Nguồn mới thì phải báo hỏng, nhận: ${JSON.stringify(r)}`);
  }

  /* ---- 9. content.js phải chuyển verified về background, không nuốt ---- */
  // `limit` và `verified` là hai boolean cùng kiểu trong CÙNG một object trả lời.
  // Hoán vị chúng thì `verified:false` hoá thành `limit:true`, và service worker
  // đọc `limit` là "đã chạm trần Nguồn" -> DỪNG CẢ LƯỢT CHẠY. Một mục chưa xác
  // minh được sẽ giết luôn 88 mục còn lại.
  {
    // Không đọc được danh sách Nguồn -> ok nhưng verified:false.
    const g = loadFixture(
      '<input formcontrolname="title"><textarea class="real-paste-area"></textarea>' +
        '<button class="nut-chen"><span class="mdc-button__label">Chèn</span></button>',
      '',
      { withContentScript: true }
    );
    g.doc.querySelector('.nut-chen').addEventListener('click', () => g.dialog.remove());
    const res = await g.dispatch({ type: 'nlm-add-text', title: TITLE, text: BODY });
    ok(res.ok === true, `content script phải trả ok, nhận: ${JSON.stringify(res)}`);
    ok(res.verified === false, `content script phải chuyển verified:false lên background, nhận: ${JSON.stringify(res.verified)}`);
    ok(res.limit === false, `chưa xác minh được KHÔNG phải là chạm giới hạn Nguồn, nhận: ${JSON.stringify(res.limit)}`);
    ok(typeof res.unverified === 'string' && res.unverified, `lý do chưa xác minh phải đi kèm, nhận: ${JSON.stringify(res.unverified)}`);
  }
  {
    // Đếm được và tăng đúng 1 -> verified:true.
    const g = loadFixture(
      '<input formcontrolname="title"><textarea class="real-paste-area"></textarea>' +
        '<button class="nut-chen"><span class="mdc-button__label">Chèn</span></button>',
      '<labs-tailwind-source-list>' + NGUON(2) + '</labs-tailwind-source-list>',
      { withContentScript: true }
    );
    const list = g.doc.querySelector('labs-tailwind-source-list');
    g.doc.querySelector('.nut-chen').addEventListener('click', () => {
      g.dialog.remove();
      list.insertAdjacentHTML('beforeend', NGUON(1));
    });
    const res = await g.dispatch({ type: 'nlm-add-text', title: TITLE, text: BODY });
    ok(res.ok === true && res.verified === true, `xác minh được thì content script phải trả verified:true, nhận: ${JSON.stringify(res)}`);
    ok(res.limit === false, `verified:true không được rò sang limit, nhận: ${JSON.stringify(res.limit)}`);
    ok(res.unverified === null, `đã xác minh thì không có lý do "chưa xác minh", nhận: ${JSON.stringify(res.unverified)}`);
    ok(res.sourceAdded === false, `thêm đúng 1 Nguồn thì không có chuyện "đã ghi nhưng sai số", nhận: ${JSON.stringify(res.sourceAdded)}`);
  }
  {
    // Tăng 2 -> đã ghi vào notebook thật. Cờ này phải qua được content script,
    // nếu không background sẽ fallback và để lại một Nguồn trùng.
    const g = loadFixture(
      '<input formcontrolname="title"><textarea class="real-paste-area"></textarea>' +
        '<button class="nut-chen"><span class="mdc-button__label">Chèn</span></button>',
      '<labs-tailwind-source-list>' + NGUON(1) + '</labs-tailwind-source-list>',
      { withContentScript: true }
    );
    const list = g.doc.querySelector('labs-tailwind-source-list');
    g.doc.querySelector('.nut-chen').addEventListener('click', () => {
      g.dialog.remove();
      list.insertAdjacentHTML('beforeend', NGUON(2));
    });
    const res = await g.dispatch({ type: 'nlm-add-text', title: TITLE, text: BODY });
    ok(res.ok === false, `tăng 2 Nguồn là sai, content script phải báo hỏng, nhận: ${JSON.stringify(res)}`);
    ok(res.sourceAdded === true, `cờ "đã ghi vào notebook" phải qua được content script, nhận: ${JSON.stringify(res.sourceAdded)}`);
  }

  /* ---- 10. Mỗi loại tin phải đi tới ĐÚNG hàm automation ---- */
  // `MSG.NLM_ADD_URL` và `MSG.NLM_ADD_TEXT` là hai hằng số cùng kiểu trong hai
  // nhãn `case` cạnh nhau. Đổi chỗ đúng hai nhãn đó thì Dán link và Dán text đổi
  // vai: video public đi vào addTextSource(undefined, undefined) tạo Nguồn rỗng,
  // transcript đi vào addUrlSource(undefined). `test/messaging.test.js` không bắt
  // được — nó chỉ canh hai hằng số CÓ MẶT trong `HANDLED`.
  //
  // Phải assert HÀM NÀO ĐƯỢC GỌI, không assert giá trị trả về: hai nhánh trả
  // cùng hình dạng `{ok, error, limit, verified, ...}` nên mọi assertion trên kết
  // quả đều xanh cả hai chiều. Cùng bài học với "hoán vị nút cần ghi lại cú bấm".
  {
    const g = loadFixture('', '', { withContentScript: true });

    // content.js giữ tham chiếu tới object `NBLM_AUTOMATION`, đọc property lúc
    // gọi — nên thay method sau khi nạp vẫn ghi lại được cú gọi thật.
    const goi = [];
    const spy = (ten) => (...args) => {
      goi.push({ ten, args });
      return Promise.resolve({ ok: true, verified: true, sourcesBefore: 1, sourcesAfter: 2 });
    };
    g.win.NBLM_AUTOMATION.addUrlSource = spy('addUrlSource');
    g.win.NBLM_AUTOMATION.addTextSource = spy('addTextSource');

    const URL_VIDEO = 'https://www.youtube.com/watch?v=abcdefghijk';
    await g.dispatch({ type: 'nlm-add-url', url: URL_VIDEO, label: 'Video nào đó' });
    ok(goi.length === 1 && goi[0].ten === 'addUrlSource', `nlm-add-url phải gọi addUrlSource, đã gọi: ${JSON.stringify(goi.map((c) => c.ten))}`);
    ok(goi[0] && goi[0].args[0] === URL_VIDEO, `addUrlSource phải nhận đúng URL trong tin, nhận: ${JSON.stringify(goi[0] && goi[0].args)}`);

    goi.length = 0;
    const TIEU_DE = 'Tiêu đề nguồn';
    const NOI_DUNG = 'Toàn bộ transcript dài';
    await g.dispatch({ type: 'nlm-add-text', title: TIEU_DE, text: NOI_DUNG });
    ok(goi.length === 1 && goi[0].ten === 'addTextSource', `nlm-add-text phải gọi addTextSource, đã gọi: ${JSON.stringify(goi.map((c) => c.ten))}`);
    // title và text là hai string cùng kiểu: router phải đặt chúng đúng thứ tự,
    // không thì mỗi Nguồn mang tiêu đề là cả bản transcript.
    ok(goi[0] && goi[0].args[0] === TIEU_DE, `tham số 1 phải là title, nhận: ${JSON.stringify(goi[0] && goi[0].args[0])}`);
    ok(goi[0] && goi[0].args[1] === NOI_DUNG, `tham số 2 phải là text, nhận: ${JSON.stringify(goi[0] && goi[0].args[1])}`);
    ok(goi[0] && goi[0].args[0] !== goi[0].args[1], 'title và text không được là cùng một chuỗi');
  }

  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
