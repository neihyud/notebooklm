#!/usr/bin/env node
/* Dò xem `rate()` chấm điểm những khối nào trên một trang — để hiểu vì sao detect() chọn sai. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URLS = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync('/tmp/nblm-probe', { recursive: true, force: true });
const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome-stable', [
  '--user-data-dir=/tmp/nblm-probe', '--remote-debugging-pipe',
  '--window-size=1680,1050', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: ['ignore', 'ignore', 'inherit', 'pipe', 'pipe'] });

const [, , , wr, rd] = chrome.stdio;
let id = 0, buf = Buffer.alloc(0);
const pending = new Map();
rd.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  let i;
  while ((i = buf.indexOf(0)) !== -1) {
    let m = null;
    try { m = JSON.parse(buf.subarray(0, i).toString()); } catch {}
    buf = buf.subarray(i + 1);
    if (m?.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  wr.write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});

await sleep(3500);
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, S);
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false }, S);

const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, S);
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result?.value;
};

const SRC = ['src/common/shared.js', 'src/docs/markdown.js', 'src/docs/extract.js', 'src/docs/sidebar.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));

for (const url of URLS) {
  console.log(`\n── ${url}`);
  await send('Page.navigate', { url }, S);
  await sleep(6000);
  await ev(`globalThis.chrome = globalThis.chrome || { storage:{ local:{ get:async()=>({}), set:async()=>{} } } };`);
  for (const s of SRC) await ev(s);

  const out = await ev(`(() => {
    const SEL = ['nav','aside','[role="navigation"]','.theme-doc-sidebar-container','.menu.thin-scrollbar',
      '.md-nav--primary','.md-sidebar--primary','.wy-nav-side','.sphinxsidebar','.bd-sidebar','.VPSidebar',
      '.sidebar','.docs-sidebar','.side-nav','.sidenav','.docs-nav','.toc-nav',
      '[class*="sidebar" i]','[id*="sidebar" i]','[data-testid*="sidebar" i]','.sidebar-nav'];
    const seen = new Set(); const rows = [];
    for (const sel of SEL) {
      let found; try { found = document.querySelectorAll(sel); } catch { continue; }
      for (const el of found) {
        if (seen.has(el)) continue; seen.add(el);
        const all = el.querySelectorAll('a[href]').length;
        let usable = 0, anchors = 0, offsite = 0;
        for (const a of el.querySelectorAll('a[href]')) {
          const u = globalThis.NBLM_DOCS_SIDEBAR.usableUrl(a, location.href);
          if (u) usable++;
          else {
            try { const p = new URL(a.getAttribute('href'), location.href);
              if (p.host !== location.host) offsite++; else anchors++; } catch {}
          }
        }
        const r = el.getBoundingClientRect();
        rows.push({ sel, tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,42),
          all, usable, anchors, offsite, w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    const picked = globalThis.NBLM_DOCS_SIDEBAR.detect();
    return { rows: rows.filter(r => r.all >= 3).sort((a,b) => b.usable - a.usable).slice(0, 10),
             picked: picked ? { count: picked.count, cls: (picked.container.className||'').toString().slice(0,42),
                                tag: picked.container.tagName.toLowerCase() } : null };
  })()`);

  if (out?.__err) { console.log('  lỗi:', out.__err.slice(0, 200)); continue; }
  console.log('  ứng viên (dùng được / neo trong trang / khác site / tổng a[href]):');
  for (const r of out.rows) {
    console.log(`    ${String(r.usable).padStart(4)} / ${String(r.anchors).padStart(4)} / ${String(r.offsite).padStart(3)} / ${String(r.all).padStart(4)}  ${r.w}x${r.h}  ${r.tag}.${r.cls}`);
  }
  console.log('  detect() chọn:', out.picked ? `${out.picked.count} link — ${out.picked.tag}.${out.picked.cls}` : 'null');
}

chrome.kill('SIGKILL');
