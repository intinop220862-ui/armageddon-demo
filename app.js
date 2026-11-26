'use strict';
const byId = id => document.getElementById(id);
const labels = {normal:'Normal', anomaly:'Anomaly', worst_anomaly:'Worst anomaly', offline:'ออฟไลน์', unknown:'รอผลจำแนก'};
const pages = {overview:['ภาพรวมเครื่องจักร','Monitor'],alerts:['ศูนย์แจ้งเตือน','Alerts'],history:['ประวัติการวัด','History'],settings:['ตั้งค่าหน้าจอ','Settings']};
const classes = ['normal','anomaly','worst_anomaly'];
const healthText = {'Waiting for samples':'กำลังรอตัวอย่างจากแหล่งข้อมูล','Collecting samples':'กำลังสะสมตัวอย่างให้ครบหน้าต่าง','Receiving samples':'รับข้อมูลและประมวลผลแล้ว','Constant sensor window':'สัญญาณค้างทั้งสามแกน','No recent sample':'สัญญาณขาดหาย','Recorded file finished':'เล่นไฟล์บันทึกจบแล้ว','Sample gap; collecting a new window':'ตัวอย่างขาดหาย กำลังเริ่มหน้าต่างใหม่'};
const finite = x => typeof x === 'number' && Number.isFinite(x);
const pct = x => finite(x) ? (x*100).toFixed(1)+'%' : '—';
const clockFmt = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const time = x => finite(x) ? clockFmt.format(new Date(x*1000)) : '—';
const day = x => finite(x) ? new Date(x*1000).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok'}) : '';
const markTime = x => finite(x) ? day(x)+' '+time(x) : '—';
const elem = (tag, content, cls) => {const node=document.createElement(tag); if(content!==null && content!==undefined) node.textContent=content; if(cls)node.className=cls; return node;};
const list = x => Array.isArray(x)?x:[];
const read = (key,fallback) => {try{return localStorage.getItem('armageddon-'+key)??fallback;}catch{return fallback;}};
const pref = {theme:read('theme','dark'),units:read('units','g'),range:Number(read('range','300')),notices:read('notices','true')==='true'};
if(![60,300,900].includes(pref.range))pref.range=300;
if(!['dark','light'].includes(pref.theme))pref.theme='dark';
if(pref.units!=='mg')pref.units='g';
const unitScale = () => pref.units==='mg'?1000:1;
const state = {data:{}, api:false, paused:null, view:'overview', performance:null, lastAlert:null, alertKey:'', feedbackToken:0};

function notify(message){
    byId('feedback').textContent=message;
    const token=++state.feedbackToken;
    setTimeout(()=>{if(token===state.feedbackToken)byId('feedback').textContent='';},6500);
}
function setPref(key,value){
    pref[key]=value;
    try{localStorage.setItem('armageddon-'+key,String(value));}catch{}
    syncPrefs();
    render();
}
function syncPrefs(){
    document.documentElement.dataset.theme=pref.theme;
    byId('theme').value=pref.theme;
    byId('units').value=pref.units;
    byId('notices').checked=pref.notices;
    byId('range').value=byId('historyRange').value=String(pref.range);
}
function route(){
    const hash=location.hash.slice(1);
    state.view=Object.hasOwn(pages,hash)?hash:'overview';
    Object.keys(pages).forEach(k=>byId(k).hidden=k!==state.view);
    document.querySelectorAll('nav a').forEach(a=>{
        const active=a.hash==='#'+state.view;
        a.classList.toggle('current',active);
        if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    });
    [byId('pageTitle').textContent,byId('pageContext').textContent]=pages[state.view];
    if(state.view==='history')loadPerformance();
    render();
}
function metric(id,value,unit){
    const node=byId(id);
    node.textContent=value??'—';
    if(unit && value!=null)node.append(elem('small',unit));
}
function details(container, rows){
    container.replaceChildren(...rows.map(([k,v])=>{
        const r=elem('div');r.append(elem('dt',k),elem('dd',v));return r;
    }));
}
function current(){
    const d=state.data;
    if(!state.api || !d.connected)return 'offline';
    return Object.hasOwn(labels,d.state)?d.state:'unknown';
}
function render(){
    const d=state.data, cls=current(), predicted=classes.includes(cls);
    const source={board:d.connected?'สัญญาณสด':'บอร์ดออฟไลน์',offline:'ออฟไลน์',replay:'เล่นไฟล์บันทึก'}[d.source]||'ออฟไลน์';
    byId('source').textContent=state.api?source:'API ออฟไลน์';
    byId('source').dataset.source=state.api && (d.connected||d.source==='replay')?d.source:'offline';
    const notifications=list(d.alerts).filter(a=>!a.acknowledged).length;
    byId('alertCount').textContent=String(notifications);
    byId('alertCount').hidden=!notifications;
    document.querySelector('.nav-device .led').classList.toggle('on',d.source==='board'&&state.api&&d.connected);
    if(state.view==='overview'){
        byId('statusCard').dataset.state=cls;
        byId('classification').textContent=labels[cls];
        byId('health').textContent=state.api?(healthText[d.health]||d.health||'รอสถานะระบบ'):'เชื่อมต่อโปรแกรมรับข้อมูลไม่ได้';
        byId('updated').textContent=markTime(d.updated_at);
        byId('version').textContent=d.model_version||'—';
        byId('sensor').textContent=!state.api?'ขาดการเชื่อมต่อ':d.source==='replay'?'อ่านไฟล์บันทึก':d.connected?'เชื่อมต่อ':'ขาดการเชื่อมต่อ';
        byId('rpmSource').textContent=finite(d.rpm)&&state.api&&d.connected?(d.source==='replay'?'ค่าที่บันทึกไว้ในไฟล์':'ค่ารอบจากแหล่งวัด'):'รอข้อมูล RPM';
        metric('rpm',state.api&&d.connected&&finite(d.rpm)?d.rpm.toLocaleString('en-US'):null,'RPM');
        metric('confidence',predicted?pct(d.confidence):null);
        metric('latency',predicted&&finite(d.latency_ms)?Number(d.latency_ms).toFixed(1):null,'ms');
        for(const c of classes){
            const probability=predicted?d.probabilities?.[c]:null;
            byId('score-'+c).textContent=pct(probability);
            byId('fill-'+c).style.width=(finite(probability)?Math.max(0,Math.min(100,probability*100)):0)+'%';
        }
    }else if(state.view==='alerts'){
        renderAlerts();
    }else if(state.view==='history'){
        renderHistory();
    }else{
        details(byId('systemDetails'),[
            ['แหล่งข้อมูล',source],['อุปกรณ์ / ไฟล์',d.source_detail||'—'],['โมเดล',d.model_version||'—'],
            ['ขนาดหน้าต่าง',finite(d.window_samples)?d.window_samples+' ตัวอย่าง':'—'],['อัปเดตล่าสุด',markTime(d.updated_at)],
            ['การเชื่อมต่อ API',state.api?'เชื่อมต่อ':'ออฟไลน์'],['บริการ',location.origin]
        ]);
    }
    drawCharts();
}
function renderAlerts(){
    const alerts=list(state.data.alerts).filter(a=>!byId('onlyOpen').checked||!a.acknowledged).sort((a,b)=>b.t-a.t);
    const key=JSON.stringify([state.api,alerts]);
    if(key===state.alertKey)return;
    state.alertKey=key;
    if(!alerts.length){byId('alertList').replaceChildren(elem('p','ยังไม่มีเหตุการณ์ในรายการนี้','empty'));return;}
    byId('alertList').replaceChildren(...alerts.map(a=>{
        const row=elem('div',null,'event');
        const stamp=elem('div',time(a.t));stamp.append(elem('small',day(a.t)));
        const badge=elem('div',labels[a.state]||'ไม่ทราบ','pill '+a.state);
        badge.append(elem('small',a.state==='worst_anomaly'?'ระดับรุนแรง':'ระดับเฝ้าระวัง'));
        const action=elem(a.acknowledged?'span':'button',a.acknowledged?'รับทราบแล้ว':'รับทราบ',a.acknowledged?'muted':'action');
        if(!a.acknowledged){
            action.disabled=!state.api;
            action.addEventListener('click',async()=>{
                action.disabled=true;
                try{
                    const res=await fetch('/api/alerts/'+encodeURIComponent(a.id)+'/ack',{method:'POST',signal:AbortSignal.timeout(3500)});
                    if(!res.ok)throw Error();
                    await refresh();
                }catch{notify('รับทราบเหตุการณ์ไม่สำเร็จ กรุณาลองอีกครั้ง');}
                finally{action.disabled=!state.api;}
            });
        }
        row.append(stamp,badge,elem('span',pct(a.confidence)),action);
        return row;
    }));
}
function renderHistory(){
    const d=state.data;
    const summary=d.history_summary||{};
    byId('counts').replaceChildren(...classes.map(k=>{
        const item=elem('div',null,k);
        const count=summary.counts?(summary.counts[k]??0):null, duration=summary.duration_s?(summary.duration_s[k]??0):null;
        item.append(elem('span',labels[k]),elem('strong',finite(count)?count+' ครั้ง':'—'),elem('small',finite(duration)?duration.toFixed(1)+' s':'—'));
        return item;
    }));
    const rows=list(d.history).slice().sort((a,b)=>b.t-a.t);
    byId('historyUnit').textContent='RMS ('+pref.units+')';
    if(rows.length){
        byId('historyRows').replaceChildren(...rows.map(h=>{
            const tr=elem('tr');
            [markTime(h.t),labels[h.state]||'ไม่ทราบ',pct(h.confidence),finite(h.rms)?(h.rms*unitScale()).toFixed(pref.units==='g'?4:1):'—',finite(h.rpm)?String(h.rpm):'—'].forEach(v=>tr.append(elem('td',v)));
            return tr;
        }));
    }else{
        const tr=elem('tr'),td=elem('td','ยังไม่มีประวัติผลจำแนก','empty');td.colSpan=5;tr.append(td);byId('historyRows').replaceChildren(tr);
    }
    const p=state.performance;
    if(!p){byId('performance').textContent='ยังไม่มีผลประเมินในบริการนี้';return;}
    const measured=p.available?p:p.development;
    if(!measured){byId('performance').textContent='รอผลทดสอบจากรอบเดินเครื่องอิสระ';return;}
    const dl=elem('dl',null,'system-lines');
    details(dl,[['วิธีประเมิน',measured.method||measured.evidence||'ดูรายงานโมเดล'],['Accuracy',pct(measured.accuracy)],['Macro F1',finite(measured.macro_f1)?measured.macro_f1.toFixed(3):'—'],['ไฟล์ที่ประเมิน',measured.n_files??'—'],['กลุ่มประเมิน',measured.n_groups??'—']]);
    byId('performance').replaceChildren(elem('p',p.available?'ผลชุดทดสอบอิสระ':'ผลระหว่างพัฒนา · รอทดสอบรอบเดินเครื่องอิสระ','muted'),dl);
}
async function loadPerformance(){
    if(state.performance?.available)return;
    try{const res=await fetch('/api/performance',{cache:'no-store',signal:AbortSignal.timeout(3500)});if(res.ok)state.performance=await res.json();}catch{}
    if(state.view==='history')renderHistory();
}
function setupBars(){
    for(const c of classes){
        const row=elem('div',null,'classrow '+c),head=elem('header'),pc=elem('span','—','pct'),track=elem('div',null,'track'),fill=elem('div',null,'fill');
        pc.id='score-'+c;fill.id='fill-'+c;
        head.append(elem('span',labels[c]),pc);track.append(fill);row.append(head,track);byId('bars').append(row);
    }
}
function graph(id,lines,unit,xUnit,readId,empty){
    const canvas=byId(id),w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    const dpi=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpi)||canvas.height!==Math.round(h*dpi)){canvas.width=Math.round(w*dpi);canvas.height=Math.round(h*dpi);}
    const ctx=canvas.getContext('2d');
    ctx.setTransform(dpi,0,0,dpi,0,0);ctx.clearRect(0,0,w,h);
    const style=getComputedStyle(document.documentElement),color=k=>style.getPropertyValue(k).trim();
    const box={l:48,r:w-12,t:10,b:h-23};
    ctx.font='10px Consolas, monospace';ctx.lineWidth=1;ctx.strokeStyle=color('--grid');
    for(let i=0;i<=4;i++){
        const x=box.l+(box.r-box.l)*i/4,y=box.t+(box.b-box.t)*i/4;
        ctx.beginPath();ctx.moveTo(x,box.t);ctx.lineTo(x,box.b);ctx.moveTo(box.l,y);ctx.lineTo(box.r,y);ctx.stroke();
    }
    const valid=lines.map(s=>({...s,points:s.points.filter(p=>finite(p[0])&&finite(p[1]))})).filter(s=>s.points.length);
    if(!valid.length){
        ctx.fillStyle=color('--muted');ctx.font='12px Tahoma, sans-serif';ctx.textAlign='center';ctx.fillText(empty,w/2,h/2);
        canvas.onpointermove=null;byId(readId).textContent='';return;
    }
    let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
    for(const series of valid)for(const [x,y] of series.points){
        xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
    }
    if(xmin===xmax)xmin-=1;
    let pad=(ymax-ymin)*0.08 || Math.max(Math.abs(ymax)*.03,unit==='RPM'?1:.0001);
    ymin-=pad;ymax+=pad;
    if(id!=='wave')ymin=Math.max(0,ymin);
    const xPixel=x=>box.l+(x-xmin)/(xmax-xmin)*(box.r-box.l);
    const yPixel=y=>box.b-(y-ymin)/(ymax-ymin)*(box.b-box.t);
    const format=x=>Math.abs(x)>=1000?Number(x.toPrecision(3)).toLocaleString('en-US'):Math.abs(x)<.01&&x!==0?x.toExponential(1):Number(x.toPrecision(3)).toString();
    for(let i=0;i<=4;i++){
        ctx.fillStyle=color('--muted');ctx.textAlign='right';
        const y=ymin+(ymax-ymin)*i/4,x=xmin+(xmax-xmin)*i/4;
        ctx.fillText(format(y),box.l-4,yPixel(y)+3);
        ctx.textAlign='center';ctx.fillText(format(x),xPixel(x),h-6);
    }
    for(const series of valid){
        ctx.strokeStyle=color(series.color);ctx.fillStyle=color(series.color);ctx.lineWidth=1.35;ctx.beginPath();
        series.points.forEach(([x,y],i)=>{if(i)ctx.lineTo(xPixel(x),yPixel(y));else ctx.moveTo(xPixel(x),yPixel(y));});
        ctx.stroke();
        if(series.points.length===1){const [x,y]=series.points[0];ctx.fillRect(xPixel(x)-2,yPixel(y)-2,4,4);}
    }
    canvas.onpointermove=e=>{
        const x=xmin+(e.offsetX-box.l)/(box.r-box.l)*(xmax-xmin);
        const near=valid.map(s=>s.points.reduce((a,b)=>Math.abs(b[0]-x)<Math.abs(a[0]-x)?b:a));
        byId(readId).textContent=format(near[0][0])+' '+xUnit+'  ·  '+valid.map((s,i)=>s.label+' '+format(near[i][1])+' '+unit).join('  ·  ');
    };
    canvas.onpointerleave=()=>byId(readId).textContent='';
}
function drawCharts(){
    if(!['overview','history'].includes(state.view))return;
    const d=state.paused||state.data;
    const history=list(d.history),end=history.reduce((n,item)=>Math.max(n,item.t||0),0);
    const recent=history.filter(x=>x.t>=end-pref.range).sort((a,b)=>a.t-b.t);
    const factor=unitScale();
    if(state.view==='history'){
        graph('rpmTrend',[{label:'RPM',color:'--y',points:recent.map(h=>[h.t-end,h.rpm])}],'RPM','s','rpmRead','ยังไม่มีรอบเครื่องในช่วงที่เลือก');
        return;
    }
    const samples=list(d.waveform),last=samples.at(-1)?.t;
    const usable=Boolean(state.paused)||(state.api&&d.connected);
    byId('waveTime').textContent=state.paused?'หยุดที่ '+time(d.updated_at):'';
    byId('waveUnit').textContent='ความเร่ง ('+pref.units+')';
    byId('rmsUnit').textContent='RMS ('+pref.units+')';
    byId('specUnit').textContent='แอมพลิจูด ('+pref.units+')';
    graph('wave',['x','y','z'].map(k=>({label:k.toUpperCase(),color:'--'+k,points:usable?samples.map(p=>[p.t-last,finite(p[k])?p[k]*factor:null]):[]})),pref.units,'s','waveRead','รอสัญญาณความเร่ง');
    graph('spectrum',[{label:'FFT',color:'--x',points:usable?list(d.spectrum).map(p=>[p.hz,finite(p.amplitude)?p.amplitude*factor:null]):[]}],pref.units,'Hz','specRead','รอหน้าต่างสัญญาณครบ');
    graph('trend',[{label:'RMS',color:'--y',points:recent.map(h=>[h.t-end,finite(h.rms)?h.rms*factor:null])}],pref.units,'s','trendRead','ยังไม่มีประวัติแรงสั่น');
}
async function refresh(){
    try{
        const res=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(3500)});
        if(!res.ok)throw Error();
        const payload=await res.json();
        if(!payload||!Object.hasOwn(labels,payload.state)||typeof payload.connected!=='boolean')throw Error();
        state.data=payload;state.api=true;
        const latest=list(payload.alerts).reduce((v,a)=>Math.max(v,a.t||0),0);
        if(pref.notices && state.lastAlert!==null && latest>state.lastAlert && state.view!=='alerts')notify('พบเหตุการณ์ใหม่ ดูรายละเอียดที่ศูนย์แจ้งเตือน');
        state.lastAlert=latest;
    }catch{state.api=false;}
    render();
}
byId('pause').addEventListener('click',()=>{
    state.paused=state.paused?null:structuredClone(state.data);
    byId('pause').setAttribute('aria-pressed',String(Boolean(state.paused)));
    byId('pause').textContent=state.paused?'▶ ดูต่อ':'Ⅱ หยุดกราฟ';
    drawCharts();
});
byId('themeButton').addEventListener('click',()=>setPref('theme',pref.theme==='dark'?'light':'dark'));
for(const k of ['theme','units'])byId(k).addEventListener('change',e=>setPref(k,e.target.value));
for(const k of ['range','historyRange'])byId(k).addEventListener('change',e=>setPref('range',Number(e.target.value)));
byId('notices').addEventListener('change',e=>setPref('notices',e.target.checked));
byId('onlyOpen').addEventListener('change',renderAlerts);
window.addEventListener('resize',drawCharts);
window.addEventListener('hashchange',route);
setupBars();syncPrefs();route();
const updateClock=()=>byId('clock').textContent=time(Date.now()/1000);
updateClock();setInterval(updateClock,1000);
(async function poll(){await refresh();setTimeout(poll,850);})();
