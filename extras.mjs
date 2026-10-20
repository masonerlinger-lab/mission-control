import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import os from 'node:os'; import { execFile, spawn } from 'node:child_process';
const DIR = path.dirname(fileURLToPath(import.meta.url)), HOME = process.env.MC_HOME || os.homedir();
const EVF = DIR + '\\freeze-events.json', HISF = DIR + '\\freeze-history.json', CTRL = HOME + '\\gev-train-control.json', TST = HOME + '\\gev-train-status.json', TSTATE = DIR + '\\train-state.json';
const MAXH = 1800;
let hist = [], events = [], lastEv = {}, lastTick = Date.now(), lastEvtCheck = new Date(), snapFn = null;
try { events = JSON.parse(fs.readFileSync(EVF, 'utf8')).slice(-300); } catch {}
try { hist = JSON.parse(fs.readFileSync(HISF, 'utf8')).filter((s) => Date.now() - s.t < 3600e3); } catch {}
const ps = (cmd, ms = 20000) => new Promise((r) => execFile('powershell', ['-NoProfile', '-Command', cmd], { timeout: ms, windowsHide: true, maxBuffer: 8e6 }, (e, o, se) => r({ ok: !e, out: (o || '') + (se || '') })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (f, o) => { try { fs.writeFileSync(f, JSON.stringify(o)); } catch {} };
const TOP = `
$ErrorActionPreference='SilentlyContinue'
$p=@{}; Get-Process | %{ $p[[int]$_.Id]=$_ }
$perf=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ?{$_.IdProcess -gt 0 -and $_.Name -ne '_Total' -and $_.Name -ne 'Idle'}
$cpu=$perf | sort PercentProcessorTime -desc | select -first 5 | %{ [pscustomobject]@{name=$_.Name;pid=$_.IdProcess;v=[int]$_.PercentProcessorTime} }
$ram=$p.Values | sort WorkingSet64 -desc | select -first 5 | %{ [pscustomobject]@{name=$_.ProcessName;pid=$_.Id;v=[int]($_.WorkingSet64/1MB)} }
$g=@{}; (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ea 0).CounterSamples | ?{$_.CookedValue -gt 0 -and $_.InstanceName -match 'pid_(\\d+)'} | %{ $k=[int]$matches[1]; $g[$k]=[double]$g[$k]+$_.CookedValue }
$gpu=$g.GetEnumerator() | sort Value -desc | select -first 5 | %{ [pscustomobject]@{name=$(if($p[[int]$_.Key]){$p[[int]$_.Key].ProcessName}else{'?'});pid=$_.Key;v=[int]$_.Value} }
@{cpu=@($cpu);ram=@($ram);gpu=@($gpu)} | ConvertTo-Json -Depth 4 -Compress`;
async function topProcs() { const r = await ps(TOP, 25000); try { const j = JSON.parse(r.out.trim().split('\n').pop()); for (const k of ['cpu', 'ram', 'gpu']) if (!Array.isArray(j[k])) j[k] = j[k] ? [j[k]] : []; return j; } catch { return { cpu: [], ram: [], gpu: [], error: 'capture failed' }; } }
async function logEvent(type, detail) {
  const now = Date.now(); if (now - (lastEv[type] || 0) < 30000) return; lastEv[type] = now;
  const ev = { t: now, time: new Date(now).toLocaleString(), type, detail }; events.push(ev); events = events.slice(-300); save(EVF, events);
  ev.top = await topProcs(); save(EVF, events);
}
async function checkDriver() {
  const since = lastEvtCheck; lastEvtCheck = new Date();
  const r = await ps(`Get-WinEvent -FilterHashtable @{LogName='System';StartTime=[datetime]'${since.toISOString()}'} -ea 0 | ?{ ($_.ProviderName -eq 'Display' -and $_.Id -eq 4101) -or $_.ProviderName -eq 'nvlddmkm' -or $_.Id -eq 141 } | select -first 3 | %{ $_.TimeCreated.ToString('s')+' '+$_.ProviderName+' id'+$_.Id } `);
  const l = r.out.trim(); if (l) logEvent('gpu-driver-reset', l.replace(/\r?\n/g, '; '));
}
function sample() {
  const now = Date.now(), gap = now - lastTick; lastTick = now; if (!snapFn) return;
  const s = snapFn(), g = s.gpu;
  const pt = { t: now, gt: g?.temp ?? null, gu: g?.util ?? null, gv: g ? Math.round(1000 * g.memUsed / g.memTotal) / 10 : null, cpu: s.cpu.pct, ram: s.ram.pct };
  const prev = hist.slice(-4); hist.push(pt); if (hist.length > MAXH) hist.shift();
  if (gap > 5000) logEvent('stall', `sampler gap ${(gap / 1000).toFixed(1)}s (event loop/system stalled)`);
  if (pt.ram > 90) logEvent('ram', `RAM ${pt.ram}%`);
  if (prev.length && pt.gt != null) { const o = prev[0]; if (o.gt != null && pt.gt - o.gt >= 8) logEvent('gpu-temp-jump', `GPU temp ${o.gt}C -> ${pt.gt}C in ${prev.length * 2}s`); if (o.gu != null && Math.abs(pt.gu - o.gu) >= 70) logEvent('gpu-util-jump', `GPU util ${o.gu}% -> ${pt.gu}%`); }
}
export function init(getSnap) { snapFn = getSnap; setInterval(sample, 2000); setInterval(() => { save(HISF, hist); }, 30000); setInterval(checkDriver, 60000); }
// ---- training control
function readJ(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
const STOPF = HOME + '\\gev-train-stopped.flag', PAUSEF = HOME + '\\gev-train-paused.flag';
let TP = { procs: [], t: 0 };
const KINDS = { driver: /driver\.py/, extract: /extract\.py/, evalr: /evalr\.py/, download: /download\.py/, writer: /status_writer\.py/ };
async function scanTrain() {
  const r = await ps(`Get-CimInstance Win32_Process | ?{ $_.Name -match 'python' -and $_.CommandLine -match 'driver\\.py|extract\\.py|evalr\\.py|download\\.py|status_writer\\.py' } | %{ [pscustomobject]@{p=$_.ProcessId;pp=$_.ParentProcessId;c=$_.CommandLine} } | ConvertTo-Json -Compress`, 15000);
  try { let j = JSON.parse(r.out.trim() || '[]'); if (!Array.isArray(j)) j = [j]; TP = { t: Date.now(), procs: j.map((x) => ({ pid: x.p, kind: Object.keys(KINDS).find((k) => KINDS[k].test(x.c)) })) }; } catch {}
}
setInterval(scanTrain, 3000); scanTrain();
const pidsOf = (...k) => TP.procs.filter((p) => k.includes(p.kind)).map((p) => p.pid);
function trainInfo() {
  const work = pidsOf('driver', 'extract', 'evalr', 'download'), drv = pidsOf('driver'); const stopped = fs.existsSync(STOPF);
  const running = work.length > 0; const paused = running && fs.existsSync(PAUSEF); const st = readJ(TST);
  const fresh = !!(st && st.updated && Date.now() - new Date(st.updated).getTime() < 120e3);
  const msg = stopped && !running ? 'stopped by you (auto-restart disabled until Start)' : !running ? 'no training processes found' : paused ? 'paused (processes suspended)' : (st && st.phase) || 'running';
  return { configured: true, script: 'GevTrainAutoStart (driver.py + extractor + downloader)', running, paused, pid: drv[0] || work[0] || null, stopped, statusFresh: fresh, procs: TP.procs.length, status: st, message: msg };
}
const SUSP = (verb, pids) => `Add-Type -Name N -Namespace W -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);'; foreach($i in @(${pids.join(',')})){ try{ $p=Get-Process -Id $i -ea Stop; [W.N]::${verb}($p.Handle) | Out-Null }catch{} }`;
async function trainAct(a) {
  await scanTrain(); const ti = trainInfo(); const work = pidsOf('driver', 'extract', 'evalr', 'download');
  if (a === 'start') {
    if (ti.running) return { ok: true, result: ti.paused ? 'Already running (paused). Use Resume.' : 'Already running. Nothing to do.' };
    try { fs.unlinkSync(STOPF); } catch {} try { fs.unlinkSync(PAUSEF); } catch {}
    const r = await ps('Start-ScheduledTask -TaskName GevTrainAutoStart', 15000); return { ok: r.ok, result: 'Started (resuming from saved features). Stop flag cleared.', error: r.ok ? undefined : r.out };
  }
  if (a === 'pause') {
    if (!ti.running) return { ok: false, error: 'not running' };
    const resume = ti.paused; const r = await ps(SUSP(resume ? 'NtResumeProcess' : 'NtSuspendProcess', work));
    if (resume) { try { fs.unlinkSync(PAUSEF); } catch {} } else fs.writeFileSync(PAUSEF, String(Date.now()));
    return { ok: r.ok, result: (resume ? 'Resumed ' : 'Paused ') + work.length + ' processes', error: r.ok ? undefined : r.out };
  }
  if (a === 'stop') {
    fs.writeFileSync(STOPF, String(Date.now()));
    if (ti.paused) await ps(SUSP('NtResumeProcess', work));
    try { fs.unlinkSync(PAUSEF); } catch {}
    for (const pid of work) await ps(`taskkill /PID ${pid} /T /F`, 8000);
    await scanTrain(); return { ok: true, result: 'Stopped driver, extractor and downloader. Auto-restart is off until you press Start.' };
  }
  return { ok: false, error: 'bad action' };
}// ---- buttons
async function restartGodsEye() {
  await ps(`Get-CimInstance Win32_Process | ?{ ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and $_.CommandLine -like '*gods-eye-view*' -and $_.CommandLine -notlike '*mission-control*' } | %{ Stop-Process -Id $_.ProcessId -Force -ea 0 }`);
  await sleep(2000);
  await ps('Start-ScheduledTask -TaskName GodsEyeAutoStart');
  for (let i = 0; i < 30; i++) { await sleep(2000); try { const r = await fetch('http://localhost:4173/', { signal: AbortSignal.timeout(2500) }); if (r.status === 200) return { ok: true, result: "God's Eye is back (HTTP 200) after ~" + (i * 2 + 2) + 's' }; } catch {} }
  return { ok: false, error: "God's Eye did not return 200 within 60s" };
}
async function freeMem() {
  const before = os.freemem();
  const r = await ps("$n=0; Get-CimInstance Win32_Process | ?{$_.CommandLine -like '*geoclip_service.py*'} | %{Stop-Process -Id $_.ProcessId -Force; $n++}; $n");
  await sleep(2500); const freed = (os.freemem() - before) / 1073741824; const n = parseInt(r.out.trim().split('\n').pop()) || 0;
  return { ok: true, result: n ? `Stopped GeoCLIP service (${n} process). Freed about ${Math.max(0, freed).toFixed(2)} GB RAM. It restarts on demand.` : 'GeoCLIP service was not running; nothing to free.' };
}
async function chromeList() {
  const r = await ps(`Get-Process chrome -ea 0 | sort WorkingSet64 -desc | select -first 8 | %{ [pscustomobject]@{pid=$_.Id;mb=[int]($_.WorkingSet64/1MB);title=$_.MainWindowTitle} } | ConvertTo-Json -Compress`);
  let j = []; try { j = JSON.parse(r.out); if (!Array.isArray(j)) j = [j]; } catch {}
  return { ok: true, result: j.length ? 'Top Chrome processes by memory (nothing closed):\n' + j.map((p) => `PID ${p.pid}: ${p.mb} MB ${p.title ? '- ' + p.title : ''}`).join('\n') : 'No Chrome processes found.' };
}
const okOrigin = (req) => { const o = req.headers.origin || ''; return !o || /^http:\/\/(localhost|127\.0\.0\.1):4180$/.test(o); };
export async function handle(req, res, u) {
  const J = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); return true; };
  if (u === '/extras.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(DIR + '\\extras.js')); return true; }
  if (u === '/api/freeze') return J({ events: events.slice(-60).reverse(), hist });
  if (u === '/api/train') return J(trainInfo());
  if (req.method === 'POST' && u.startsWith('/api/')) {
    if (!okOrigin(req)) return J({ ok: false, error: 'forbidden' }, 403);
    let m;
    if (u === '/api/act/godseye') return J(await restartGodsEye());
    if (u === '/api/act/freemem') return J(await freeMem());
    if (u === '/api/act/chrome') return J(await chromeList());
    if ((m = u.match(/^\/api\/train\/(start|pause|stop)$/))) return J(await trainAct(m[1]));
  }
  return false;
}
