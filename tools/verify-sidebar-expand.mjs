#!/usr/bin/env node
/*
 * Đo trên TRANG THẬT: mở các section đóng thì sidebar mọc thêm bao nhiêu link.
 *
 * Vì sao cần script này bên cạnh `test/sidebar-expand.test.js`: test kia chạy
 * trong jsdom trên sidebar dựng tay, nên nó chứng nhận *cơ chế* (bấm gì, dừng
 * khi nào) chứ không chứng nhận rằng cơ chế ấy khớp với theme ngoài đời. Chỉ
 * chỗ này mới trả lời được "Docusaurus hôm nay còn unmount link con không".
 *
 * In ra: số link trước khi mở → sau khi mở, thời gian, số link TRÙNG trong cây,
 * và độ sâu. Thoát khác 0 nếu có link trùng hoặc có trang nào mở xong lại ít đi.
 *
 * Đo 2026-09-04, Brave headless:
 *     9 →   50  (+41)  171ms  docusaurus.io/docs          <- theme unmount
 *    94 →   94  (+ 0)   80ms  mkdocs-material             <- đóng bằng CSS, vốn đã đủ
 *   240 →  240  (+ 0)   93ms  docs.astro.build
 *
 * Dùng: node tools/verify-sidebar-expand.mjs <url>...
 * Trình duyệt lấy từ $CHROME_BIN, mặc định /usr/bin/brave.
 */
import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
const ROOT=path.join(path.dirname(new URL(import.meta.url).pathname),'..'); const URLS=process.argv.slice(2);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
fs.rmSync('/tmp/nblm-verify',{recursive:true,force:true});
const chrome=spawn(process.env.CHROME_BIN || '/usr/bin/brave',['--user-data-dir=/tmp/nblm-verify','--remote-debugging-pipe','--headless=new','--window-size=1680,1050','--no-first-run','--no-default-browser-check','about:blank'],{stdio:['ignore','ignore','inherit','pipe','pipe']});
const [,,,wr,rd]=chrome.stdio; let id=0,buf=Buffer.alloc(0); const pending=new Map();
rd.on('data',(c)=>{buf=Buffer.concat([buf,c]);let i;while((i=buf.indexOf(0))!==-1){let m=null;try{m=JSON.parse(buf.subarray(0,i).toString());}catch{}buf=buf.subarray(i+1);if(m?.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}}});
const send=(method,params={},sessionId)=>new Promise((res,rej)=>{const n=++id;pending.set(n,(m)=>(m.error?rej(new Error(`${method}: ${m.error.message}`)):res(m.result)));wr.write(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})})+'\0');});
await sleep(3500);
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId:S}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Runtime.enable',{},S);
await send('Emulation.setDeviceMetricsOverride',{width:1680,height:1050,deviceScaleFactor:1,mobile:false},S);
const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},S);if(r.exceptionDetails)return{__err:r.exceptionDetails.exception?.description??r.exceptionDetails.text};return r.result?.value;};
const SRC=['src/common/shared.js','src/docs/markdown.js','src/docs/extract.js','src/docs/sidebar.js'].map(f=>fs.readFileSync(path.join(ROOT,f),'utf8'));
let fail=0;
for(const url of URLS){
  await send('Page.navigate',{url},S); await sleep(7000);
  await ev(`globalThis.chrome = globalThis.chrome || { storage:{ local:{ get:async()=>({}), set:async()=>{} } } };`);
  for(const s of SRC) await ev(s);
  const r = await ev(`(async ()=>{
    const t0 = Date.now();
    const before = globalThis.NBLM_DOCS_SIDEBAR.detect();
    const after  = await globalThis.NBLM_DOCS_SIDEBAR.detectExpanded();
    const ms = Date.now() - t0;
    const dup = (() => { const seen=new Set(); let d=0;
      (function walk(ns){for(const n of ns){ if(n.url){ const k=globalThis.NBLM.docKey(n.url); if(seen.has(k)) d++; seen.add(k);} walk(n.children||[]); }})(after?after.tree:[]);
      return d; })();
    return { ms, before: before?before.count:0, after: after?after.count:0, dup,
             maxDepth: (function md(ns,l){let m=l;for(const n of ns)m=Math.max(m,md(n.children||[],l+1));return m;})(after?after.tree:[],0) };
  })()`);
  if (r?.__err) { console.log(`FAIL ${url}: ${r.__err.slice(0,150)}`); fail++; continue; }
  const gain = r.after - r.before;
  console.log(`${String(r.before).padStart(4)} → ${String(r.after).padStart(4)}  (+${String(gain).padStart(3)})  ${String(r.ms).padStart(4)}ms  trùng=${r.dup} sâu=${r.maxDepth}  ${url}`);
  if (r.dup > 0) { console.log('   ^^ CÓ LINK TRÙNG'); fail++; }
  if (r.after < r.before) { console.log('   ^^ MỞ XONG LẠI ÍT HƠN'); fail++; }
}
console.log(fail ? `\n${fail} vấn đề` : '\nkhông có link trùng, không ca nào giảm');
process.exitCode = fail ? 1 : 0;
chrome.kill('SIGKILL');
