// Minimal CDP client (node >= 22, global WebSocket, no deps)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(port = 9333, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--hide-scrollbars', ...extra, 'about:blank'],
    { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch (e) {}
    await sleep(200);
  }
  return { proc, port, dir };
}

class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; this.errors = []; this.warnings = []; this.reqFailures = [];
    ws.onmessage = m => { const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
      else if (d.method) this._event(d); }; }
  _event(d) {
    const p = d.params;
    if (d.method === 'Runtime.exceptionThrown') this.errors.push('EXCEPTION ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text) + ' @' + p.exceptionDetails.url + ':' + p.exceptionDetails.lineNumber);
    else if (d.method === 'Runtime.consoleAPICalled') {
      const txt = p.args.map(a => a.value ?? a.description ?? '').join(' ');
      if (p.type === 'error') this.errors.push('console.error ' + txt);
      else if (p.type === 'warning') this.warnings.push('console.warn ' + txt);
    } else if (d.method === 'Log.entryAdded') {
      const e = p.entry;
      if (e.level === 'error') this.errors.push(`log.error [${e.source}] ${e.text} ${e.url || ''}`);
      else if (e.level === 'warning') this.warnings.push(`log.warning [${e.source}] ${e.text}`);
    } else if (d.method === 'Network.loadingFailed' && !p.canceled) this.reqFailures.push(`${p.errorText} ${p.requestId}`);
    else if (d.method === 'Network.responseReceived' && p.response.status >= 400) this.reqFailures.push(`HTTP ${p.response.status} ${p.response.url}`);
    for (const h of this.handlers) h(d);
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async ev(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expr.slice(0, 200)); return r.result.value; }
  async goto(url, wait = 600) { const loaded = new Promise(res => { const h = d => { if (d.method === 'Page.loadEventFired') { this.handlers = this.handlers.filter(x => x !== h); res(); } }; this.handlers.push(h); setTimeout(res, 15000); });
    await this.send('Page.navigate', { url }); await loaded; await sleep(wait); }
  async viewport(w, h, mobile = false) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); }
  async shot(file, full = false) { const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); }
  async click(sel) { const pt = await this.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!pt) throw new Error('click: no element ' + sel);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }); }
  async focus(sel) { await this.ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); }
  async type(text) { await this.send('Input.insertText', { text }); }
  async key(key, code, vk) { for (const t of ['keyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type: t, key, code: code || key, windowsVirtualKeyCode: vk, text: t === 'keyDown' && key === 'Enter' ? '\r' : undefined }); }
  async enter() { await this.key('Enter', 'Enter', 13); }
  async waitFor(expr, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await this.ev(expr)) return Date.now() - t0; } catch (e) {} await sleep(50); } throw new Error('timeout waiting for ' + expr); }
}

async function newPage(port) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  const p = new Page(ws); p.targetId = t.id;
  await p.send('Runtime.enable'); await p.send('Log.enable'); await p.send('Page.enable'); await p.send('Network.enable');
  return p;
}
export { launch, newPage, sleep, CHROME };
