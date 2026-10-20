(function(){
const $=id=>document.getElementById(id);
const host=document.getElementById('xtra');
host.innerHTML=`
<div class="card wide"><h2>QUICK ACTIONS</h2><div id="xbtns"><button data-a="godseye">Restart God's Eye</button><button data-a="freemem">Free memory (stop idle GeoCLIP)</button><button data-a="chrome">Show top Chrome processes</button></div><pre id="xres" style="margin-top:10px;max-height:140px">Ready. Each action asks for confirmation.</pre></div>
<div class="card wide"><h2>LAST HOUR</h2><div id="xgraphs" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px"></div></div>
<div class="card wide"><h2>FREEZE DETECTOR <small style="color:var(--d)">(spikes, stalls, RAM&gt;90%, GPU driver resets)</small></h2><div id="xev" style="max-height:260px;overflow-y:auto;padding-right:6px"></div></div>
<div class="card wide"><h2>TRAINING CONTROL</h2><div id="xtr"></div></div>`;
const FONT='12px "Segoe UI",system-ui,sans-serif';
function chart(cv,o){const dpr=window.devicePixelRatio||1,r=cv.getBoundingClientRect(),W=Math.max(220,r.width),H=Math.max(100,r.height);if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,W,H);x.font=FONT;x.textBaseline='middle';
const L=o.left||46,R=12,T=12,B=24,pw=W-L-R,ph=H-T-B,X=v=>L+(v-o.xmin)/((o.xmax-o.xmin)||1)*pw,Y=v=>T+ph-(v-o.ymin)/((o.ymax-o.ymin)||1)*ph;
x.fillStyle='#08101a';x.fillRect(0,0,W,H);
const n=o.yticks||4;x.lineWidth=1;for(let i=0;i<=n;i++){const v=o.ymin+(o.ymax-o.ymin)*i/n,y=Y(v);x.strokeStyle=i?'#1a3550':'#3b6a8f';x.beginPath();x.moveTo(L,y);x.lineTo(L+pw,y);x.stroke();x.fillStyle='#9fc0d6';x.textAlign='right';x.fillText((o.yfmt?o.yfmt(v):Math.round(v*10)/10)+(o.unit||''),L-6,y)}
x.textAlign='center';(o.xticks||[]).forEach(t=>{x.fillStyle='#9fc0d6';x.fillText(t[1],Math.min(Math.max(X(t[0]),L+14),L+pw-14),H-9)});
(o.lines||[]).forEach(l=>{const y=Y(l.v);x.strokeStyle=l.color;x.lineWidth=1.5;x.setLineDash([6,4]);x.beginPath();x.moveTo(L,y);x.lineTo(L+pw,y);x.stroke();x.setLineDash([]);x.fillStyle=l.color;x.textAlign='right';x.fillText(l.label,L+pw-4,y-8)});
x.lineJoin='round';x.lineCap='round';(o.series||[]).forEach(s=>{const p=s.pts;if(!p.length)return;if(o.fill&&p.length>1){x.fillStyle=s.color+'22';x.beginPath();let st=false,lx=0;p.forEach(q=>{if(q===null){st=false;return}if(!st){x.moveTo(X(q[0]),Y(o.ymin));x.lineTo(X(q[0]),Y(q[1]));st=true}else x.lineTo(X(q[0]),Y(q[1]));lx=X(q[0])});x.lineTo(lx,Y(o.ymin));x.fill()}
x.strokeStyle=s.color;x.lineWidth=2.5;x.beginPath();let st=false;p.forEach(q=>{if(q===null){st=false;return}if(!st){x.moveTo(X(q[0]),Y(q[1]));st=true}else x.lineTo(X(q[0]),Y(q[1]))});x.stroke();
if(s.dots){p.forEach(q=>{if(!q)return;x.fillStyle=s.color;x.beginPath();x.arc(X(q[0]),Y(q[1]),4,0,7);x.fill();x.fillStyle='#e6f4ff';x.textAlign='center';x.fillText(String(q[1]),X(q[0]),Y(q[1])-12)})}})}
const G=[['GPU temperature','gt','#ff7a4d',100,' \u00b0C','Warning above 78 \u00b0C',78],['GPU load','gu','#4de3ff',100,' %','How busy the graphics chip is',null],['GPU memory (VRAM) used','gv','#b48cff',100,' %','Share of the 10 GB card in use',95],['CPU load','cpu','#3dffa0',100,' %','All processor threads combined',null],['RAM used','ram','#ffb020',100,' %','Of 32 GB system memory',90]];
$('xgraphs').innerHTML=G.map(g=>`<div><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:13px;font-weight:600;color:var(--t)">${g[0]}</span><b id="gl_${g[1]}" style="font-size:18px;color:${g[2]}"></b></div><div style="color:var(--d);font-size:11px;margin-bottom:4px">${g[5]} \u00b7 last 60 min</div><canvas id="cv_${g[1]}" style="width:100%;height:150px;border:1px solid var(--line);border-radius:4px"></canvas></div>`).join('');
let LASTH=[];
function draw(h){LASTH=h;const now=Date.now(),t0=now-3600e3;for(const [n,k,c,mx,u,cap,thr] of G){const cv=$('cv_'+k);if(!cv)continue;const pts=[];let last=null;for(const p of h){if(p[k]==null||p.t<t0)continue;if(last&&p.t-last>6000)pts.push(null);pts.push([p.t,Math.min(p[k],mx)]);last=p.t}
chart(cv,{xmin:t0,xmax:now,ymin:0,ymax:mx,unit:u,fill:true,xticks:[[t0,'-60 min'],[t0+1800e3,'-30 min'],[now,'now']],lines:thr?[{v:thr,color:'#ff4d5e',label:'limit '+thr+u}]:[],series:[{pts,color:c}]});
const l=h.length?h[h.length-1][k]:null;$('gl_'+k).textContent=l==null?'':l+u}}
window.addEventListener('resize',()=>{draw(LASTH);if(window.__trd)tr(window.__trd)});
function evs(e){$('xev').innerHTML=e.length?e.map(v=>{const top=v.top?['cpu','ram','gpu'].map(k=>`<div><b>${k.toUpperCase()}</b> `+((v.top[k]||[]).map(p=>`${p.name}(${p.v}${k=='ram'?'MB':'%'})`).join(', ')||'-')+'</div>').join(''):'<div>capturing top processes...</div>';return `<div style="border-top:1px solid var(--line);padding:6px 0"><span class="bad">${v.type}</span> <span style="color:var(--d)">${v.time}</span> ${String(v.detail).replace(/[<&]/g,'')}<div style="color:var(--d);font-size:12px;margin-left:10px">${top}</div></div>`}).join(''):'<span style="color:var(--d)">No freezes or spikes logged yet. Watching every 2s.</span>'}
async function fz(){try{const d=await (await fetch('/api/freeze',{cache:'no-store'})).json();draw(d.hist);evs(d.events)}catch{}}
const TL=$('xtr');let tchart=null;
function tr(d){const s=d.status||{},b=s.baseline||{medianKm:317,within750:21,total:32},h=Array.isArray(s.history)?s.history:[];
TL.innerHTML=`<div class="row"><span>Script</span><b>${d.configured?d.script:'<span class=bad>no training script configured</span>'}</b></div><div class="row"><span>State</span><b>${d.running?(d.paused?'PAUSED':'RUNNING')+' - '+d.message:'IDLE - '+d.message}</b></div>
<div><button data-t="start" ${(!d.configured||d.running)?'disabled':''}>Start</button><button data-t="pause" ${(!d.running)?'disabled':''}>${d.paused?'Resume':'Pause'}</button><button data-t="stop" ${(!d.running)?'disabled':''}>Stop</button></div>
${s.phase||s.status?`<div class="row"><span>Phase</span><b>${s.phase||''} ${s.status||''}</b></div>`:''}${s.percent!=null?`<div class="bar"><i style="width:${s.percent}%"></i></div>`:''}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:10px"><div><div style="color:var(--d);font-size:11px"><b style="font-size:13px;color:var(--t)">Median error distance (km)</b> \u00b7 lower is better<br>Green = new method per round \u00b7 amber dashed = live pinpointer (${b.medianKm} km)</div><canvas id="tc1"  style="width:100%;height:190px;background:#08101a;border:1px solid var(--line)"></canvas></div><div><div style="color:var(--d);font-size:11px"><b style="font-size:13px;color:var(--t)">Share of photos located within 750 km (%)</b> \u00b7 higher is better<br>Green = each round \u00b7 amber dashed = live pinpointer (${b.within750}% on ${b.total} test photos)</div><canvas id="tc2"  style="width:100%;height:190px;background:#08101a;border:1px solid var(--line)"></canvas></div></div>
${h.length?'':'<div style="color:var(--d);margin-top:6px">No history yet. The training script writes a history array to gev-train-status.json (see gev-train-status.example.json).</div>'}`;
window.__trd=d;const rn=h.map((p,i)=>p.label||(i==0?'baseline':'round '+i));tg($('tc1'),h.map(p=>p.medianKm),b.medianKm,false,null,'',' km',rn);tg($('tc2'),h.map(p=>p.within750),b.within750,true,100,'',' %',rn)}
function tg(cv,v,base,up,max,ttl,unit,rounds){const pts=v.map((a,i)=>a==null?null:[i,a]);const all=v.filter(a=>a!=null).concat([base]);let lo=Math.min(...all),hi=Math.max(...all);if(max!=null){lo=0;hi=max}else{lo=0;hi=hi*1.2}
chart(cv,{xmin:-.3,xmax:Math.max(v.length-1,1)+.3,ymin:lo,ymax:hi,unit:unit||'',left:54,yticks:4,yfmt:a=>Math.round(a),xticks:(rounds||[]).map((r,i)=>[i,r]),lines:[{v:base,color:'#ffb020',label:'live pinpointer baseline: '+base+(unit||'')}],series:[{pts,color:'#3dffa0',dots:true}]})}
async function tt(){try{tr(await (await fetch('/api/train',{cache:'no-store'})).json())}catch{}}
document.addEventListener('click',async e=>{const a=e.target.closest('button[data-a]'),t=e.target.closest('button[data-t]');if(!a&&!t)return;
const msg=a?{godseye:"Restart God's Eye server? The globe tab will drop until it is back (~20s).",freemem:'Stop the GeoCLIP service to free RAM? It restarts on demand.',chrome:'List top Chrome processes? (nothing will be closed)'}[a.dataset.a]:`${t.dataset.t.toUpperCase()} training?`;
if(!confirm(msg))return;const b=a||t;b.disabled=true;const o=$('xres');o.textContent='Working...';
try{const r=await (await fetch(a?'/api/act/'+a.dataset.a:'/api/train/'+t.dataset.t,{method:'POST'})).json();o.textContent=(r.ok?'OK: ':'FAILED: ')+(r.result||r.error||'')}catch{o.textContent='Request failed (server restarting?)'}
b.disabled=false;tt();fz()});
fz();tt();setInterval(fz,5000);setInterval(tt,3000);
})();
