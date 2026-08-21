require(__dirname + '/../src/notebooklm/selectors.js');
const S = global.NBLM_SELECTORS;
let pass=0, fail=0;
const ok=(c,m)=> c?pass++:(fail++,console.log('❌ '+m));

const merged = S.build({ addSource:['them nguon moi'], css:{ urlInput:['input#custom'] } });
ok(merged.addSource[0]==='them nguon moi', 'nhãn người dùng được ưu tiên đầu');
ok(merged.addSource.includes('add source'), 'nhãn mặc định vẫn còn (gộp, không thay thế)');
ok(merged.css.urlInput[0]==='input#custom', 'selector người dùng ưu tiên');
ok(merged.css.urlInput.includes('input[type="text"]'), 'selector mặc định vẫn còn');
ok(merged.css.textArea.length===S.BASE.css.textArea.length, 'nhánh không đụng tới giữ nguyên');
ok(S.BASE.addSource[0]==='add source', 'BASE không bị sửa đổi');
ok(JSON.stringify(S.build(null))===JSON.stringify(S.BASE), 'override null = mặc định');

// 'add'/'them' phải nằm cuối để không bắt nhầm nút "Add note"
const i = S.BASE.addSource.indexOf('add');
ok(i === S.BASE.addSource.length-2, "'add' xếp gần cuối danh sách ưu tiên");
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
