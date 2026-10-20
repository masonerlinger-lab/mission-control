import { init as xInit, handle as xHandle } from './extras.mjs'; import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import { execFile, spawn } from 'node:child_process';
const PORT = 4180, HOME = process.env.MC_HOME || os.homedir(), REPO = process.env.GEV_REPO || HOME + '\\Apps\\gods-eye-view';
const TRAIN = HOME + '\\gev-train-status.json', LOG = REPO + '\\.gev-logs\\dev.out.log';
const OLLAMA_EXE = HOME + '\\AppData\\Local\\Programs\\Ollama\\ollama.exe';
let gpu = null, cpuPct = 0, prev = os.cpus(), svc = {}, models = [], pin = null;
function cpuTick() { const c = os.cpus(); let idle = 0, tot = 0; c.forEach((x, i) => { const p = prev[i]; for (const k in x.times) { tot += x.times[k] - p.times[k]; } idle += x.times.idle - p.times.idle; }); prev = c; cpuPct = tot ? Math.round(100 * (1 - idle / tot)) : 0; }
function gpuTick() { execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,power.limit,fan.speed', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (e, o) => { if (e) { gpu = null; return; } const v = o.trim().split('\n')[0].split(',').map((s) => s.trim()); const n = (x) => (isNaN(+x) ? null : +x); gpu = { name: v[0], util: n(v[1]), temp: n(v[2]), memUsed: n(v[3]), memTotal: n(v[4]), power: n(v[5]), powerLimit: n(v[6]), fan: n(v[7]) }; }); }
async function ping(url, ms = 1500) { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return { up: r.status < 500, status: r.status, r }; } catch { return { up: false }; } }
async function svcTick() {
  const [g, gc, ol] = await Promise.all([ping('http://localhost:4173/'), ping('http://127.0.0.1:8765/'), ping('http://127.0.0.1:11434/api/ps')]);
  let m = []; if (ol.up) { try { m = ((await ol.r.json()).models || []).map((x) => ({ name: x.name, vram: Math.round((x.size_vram || 0) / 1048576) })); } catch {} }
  models = m; svc = { godseye: { up: g.up, port: 4173 }, geoclip: { up: gc.up, port: 8765, note: gc.up ? '' : 'idle (starts on demand)' }, ollama: { up: ol.up, port: 11434 } };
}
function pinTick() { try { const st = fs.statSync(LOG); const fd = fs.openSync(LOG, 'r'); const len = Math.min(st.size, 200000); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, st.size - len); fs.closeSync(fd); const lines = b.toString('utf8').split(/\r?\n/).filter((l) => /photo|pinpoint|geoclip/i.test(l)); pin = { lines: lines.slice(-8), logUpdated: st.mtimeMs }; } catch { pin = null; } }
function ps(cmd) { return new Promise((r) => execFile('powershell', ['-NoProfile', '-Command', cmd], { timeout: 15000, windowsHide: true }, (e, o, se) => r({ ok: !e, out: (o || '') + (se || '') }))); }
function detach(exe, args, env) { const c = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: REPO, env: { ...process.env, ...env } }); c.unref(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function restart(which) {
  if (which === 'geoclip') {
    await ps("Get-CimInstance Win32_Process | ?{$_.CommandLine -like '*geoclip_service.py*'} | %{Stop-Process -Id $_.ProcessId -Force}");
    await sleep(1500); detach(REPO + '\\.geovenv\\Scripts\\python.exe', [REPO + '\\server\\standalone\\geoclip_service.py'], { GEOCLIP_PORT: '8765' });
  } else if (which === 'ollama') {
    await ps("Get-Process ollama*,'ollama app' -ea 0 | Stop-Process -Force"); await sleep(2000); detach(OLLAMA_EXE, ['serve']);
  } else return { ok: false, error: 'unknown service' };
  for (let i = 0; i < 20; i++) { await sleep(1500); await svcTick(); if (svc[which]?.up) return { ok: true }; }
  return { ok: false, error: 'did not come back up within 30s (GeoCLIP can take a while to load models)' };
}
function snap() {
  const tot = os.totalmem(), free = os.freemem(); let disk = null; try { const s = fs.statfsSync('C:\\'); disk = { freeGB: +(s.bavail * s.bsize / 1e9).toFixed(1), totalGB: +(s.blocks * s.bsize / 1e9).toFixed(1) }; } catch {}
  let train = null; try { train = JSON.parse(fs.readFileSync(TRAIN, 'utf8')); } catch {}
  const w = [];
  if (gpu?.temp > 78) w.push(`GPU temp ${gpu.temp}°C > 78°C`);
  if (gpu && gpu.memUsed / gpu.memTotal > 0.95) w.push(`VRAM ${Math.round(100 * gpu.memUsed / gpu.memTotal)}% > 95%`);
  if (!gpu) w.push('nvidia-smi unavailable');
  if (1 - free / tot > 0.9) w.push(`RAM ${Math.round(100 * (1 - free / tot))}% > 90%`);
  if (!svc.godseye?.up) w.push("God's Eye (4173) is DOWN"); if (!svc.ollama?.up) w.push('Ollama is DOWN');
  if (svc.geoclip && !svc.geoclip.up) w.push('GeoCLIP service not running (normal when idle; starts on demand)');
  return { t: Date.now(), gpu, cpu: { pct: cpuPct, cores: os.cpus().length }, ram: { usedGB: +((tot - free) / 1073741824).toFixed(1), totalGB: +(tot / 1073741824).toFixed(1), pct: Math.round(100 * (1 - free / tot)) }, disk, svc, models, pin, train, warnings: w, uptime: os.uptime() };
}
setInterval(cpuTick, 2000); setInterval(gpuTick, 2000); setInterval(svcTick, 2000); setInterval(pinTick, 5000); gpuTick(); svcTick(); pinTick();
xInit(snap);
const page = fs.readFileSync(new URL('./index.html', import.meta.url));
http.createServer(async (req, res) => {
  const u = req.url.split('?')[0], J = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
  if (u === '/' || u === '/mission-control') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page); }
  if (u === '/api/status') return J(snap());
  if (await xHandle(req, res, u)) return;
  const m = u.match(/^\/api\/restart\/(geoclip|ollama)$/);
  if (m && req.method === 'POST') { if ((req.headers.origin || '') && !/^http:\/\/(localhost|127\.0\.0\.1):4180$/.test(req.headers.origin)) return J({ ok: false }, 403); return J(await restart(m[1])); }
  J({ error: 'not found' }, 404);
}).listen(PORT, '127.0.0.1', () => console.log('Mission Control on http://localhost:' + PORT));

