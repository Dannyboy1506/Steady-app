const DAY = 86400000;
const MILESTONES = [1,3,7,14,21,30,60,90,180,365];
const TRIGGERS = ["Boredom","Stress","Loneliness","Phone in bed","Late night","After scrolling","Anxiety","Habit/autopilot","Tiredness"];
const PROMPTS = [
  "What were you feeling right before?",
  "Where were you, and what had you just been doing?",
  "What did you actually need in that moment?",
  "What would tomorrow-you want you to remember?"
];
const QUOTES = [
  "Discipline is choosing between what you want now and what you want most.",
  "Every streak starts at zero. You're already moving.",
  "The urge is a wave — it rises, peaks, and passes whether you act or not.",
  "You don't have to win the whole day. Just this next ten minutes.",
  "Progress isn't a straight line. A reset is data, not a verdict.",
  "The version of you a year from now is built in moments exactly like this one."
];
const MOODS = [
  { id:'struggling', label:'Rough', path:'M8 15c1.2-1.5 2.8-2 4-2s2.8.5 4 2' },
  { id:'tough', label:'Tough', path:'M8 15.5c1.2-1 2.8-1.3 4-1.3s2.8.3 4 1.3' },
  { id:'okay', label:'Okay', path:'M8 15h8' },
  { id:'good', label:'Good', path:'M8 14c1.2 1 2.8 1.3 4 1.3s2.8-.3 4-1.3' },
  { id:'strong', label:'Strong', path:'M8 13.5c1.2 1.5 2.8 2 4 2s2.8-.5 4-2' }
];

let state = {
  startDate: Date.now(),
  history: [],
  longest: 0,
  why: "",
  reminderOn: false,
  pin: null
};
let selectedTriggers = [];
let selectedLogTriggers = [];
let monthCursor = new Date(); monthCursor.setDate(1);
let currentView = 'today';
let breathing = false, breathTimer = null, breathStart = null, breathPhaseTimer = null;
let entriesShown = 15;
const ENTRY_PAGE = 15;
let deferredInstallPrompt = null;

function load(){
  try{
    const raw = localStorage.getItem('steady-state');
    if(raw) state = Object.assign(state, JSON.parse(raw));
  }catch(e){}
}
function save(){
  try{ localStorage.setItem('steady-state', JSON.stringify(state)); }catch(e){}
}

/* ---- PIN hashing (Web Crypto, SHA-256) — never store a plaintext PIN ---- */
async function hashPin(pin){
  const enc = new TextEncoder().encode('steady-salt-v1:' + pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ---- Store: single place that mutates state + persists, instead of
   scattering direct `state.x = y` writes through the UI code. ---- */
const Store = {
  resetStreak(note, triggers){
    state.history.unshift({date:Date.now(), type:'reset', text:note, triggers:[...triggers], streakLength:streakDays()});
    state.startDate = Date.now();
    save();
  },
  addNote(text, triggers){
    state.history.unshift({date:Date.now(), type:'note', text, triggers:[...triggers], streakLength:streakDays()});
    save();
  },
  addCheckin(moodId){
    const todayK = todayKey(Date.now());
    const idx = state.history.findIndex(h=>h.type==='checkin' && todayKey(h.date)===todayK);
    const entry = { date:Date.now(), type:'checkin', mood:moodId, text:'', triggers:[], streakLength:streakDays() };
    if(idx>-1) state.history[idx]=entry; else state.history.unshift(entry);
    save();
  },
  deleteEntry(i){ state.history.splice(i,1); save(); },
  setWhy(text){ state.why = text; save(); },
  bumpLongest(d){ if(d > state.longest){ state.longest = d; save(); } },
  setReminder(on){ state.reminderOn = on; save(); },
  async setPin(pin){ state.pin = await hashPin(pin); save(); },
  clearPin(){ state.pin = null; save(); },
  wipe(){
    localStorage.removeItem('steady-state');
    state={startDate:Date.now(), history:[], longest:0, why:'', reminderOn:false, pin:null};
    save();
  },
  replaceAll(data){ state = Object.assign(state, data); save(); }
};

function todayKey(ts){ const d=new Date(ts); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
function fmtLong(ts){ return new Date(ts).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}); }

function streakDays(){ return Math.floor((Date.now()-state.startDate)/DAY); }
function nextMilestone(d){ return MILESTONES.find(m=>m>d) ?? null; }
function prevMilestone(d){ const arr=[...MILESTONES].reverse(); return arr.find(m=>m<=d) ?? 0; }

function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.style.display='block';
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>{t.style.display='none';},2600);
}

function renderToday(){
  const d = streakDays();
  document.getElementById('dayCount').textContent = d;
  document.getElementById('dayLbl').textContent = d===1?'day':'days';
  document.getElementById('sinceLine').textContent = d===0
    ? hoursMinsSince()
    : 'since ' + fmtLong(state.startDate);
  const nm = nextMilestone(d);
  document.getElementById('nextMilestone').textContent = nm ? `${nm-d} day${nm-d===1?'':'s'} to ${nm}-day mark` : 'Beyond tracked milestones — incredible';

  const pm = prevMilestone(d);
  const progress = nm ? (d-pm)/(nm-pm) : 1;
  const r=108.5, c=2*Math.PI*r;
  const ring=document.getElementById('ringProgress');
  ring.setAttribute('stroke-dasharray', c);
  ring.setAttribute('stroke-dashoffset', c*(1-Math.min(progress,1)));

  if(d > state.longest){ Store.bumpLongest(d); }
  document.getElementById('longestVal').textContent = state.longest + 'd';
  document.getElementById('resetsVal').textContent = state.history.filter(h=>h.type==='reset').length;

  document.getElementById('quoteBox').textContent = '"' + QUOTES[new Date().getDate() % QUOTES.length] + '"';
  renderMoodRow();
}
function hoursMinsSince(){
  const el = Date.now()-state.startDate;
  const h = Math.floor((el%DAY)/3600000), m = Math.floor((el%3600000)/60000);
  return `${h}h ${m}m into a new streak`;
}

/* ---- Quick check-in (one tap) ---- */
function moodFaceSvg(m, selected){
  return `<svg viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="9" cy="10" r="1" fill="currentColor"/>
    <circle cx="15" cy="10" r="1" fill="currentColor"/>
    <path d="${m.path}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}
function renderMoodRow(){
  const row=document.getElementById('moodRow');
  row.innerHTML='';
  const todayEntry = state.history.find(h=>h.type==='checkin' && todayKey(h.date)===todayKey(Date.now()));
  MOODS.forEach(m=>{
    const btn=document.createElement('button');
    btn.className='mood-btn'+(todayEntry && todayEntry.mood===m.id ? ' today-pick':'');
    btn.innerHTML = moodFaceSvg(m) + `<span class="lbl">${m.label}</span>`;
    btn.onclick=()=>quickCheckin(m, btn);
    row.appendChild(btn);
  });
  document.getElementById('checkinHint').textContent = todayEntry
    ? `checked in: ${MOODS.find(x=>x.id===todayEntry.mood)?.label.toLowerCase()}`
    : 'how are you feeling right now?';
}
function quickCheckin(mood, btnEl){
  Store.addCheckin(mood.id);

  btnEl.classList.add('pop');
  setTimeout(()=>btnEl.classList.remove('pop'), 500);
  renderMoodRow();

  const confirmEl=document.getElementById('checkinConfirm');
  confirmEl.textContent = MOOD_MESSAGES[mood.id];
  confirmEl.classList.add('show');
  clearTimeout(confirmEl._t);
  confirmEl._t=setTimeout(()=>confirmEl.classList.remove('show'), 2400);

  if(navigator.vibrate) try{ navigator.vibrate(12); }catch(e){}
}
const MOOD_MESSAGES = {
  struggling: "Logged. Ride it out — try the SOS breathing if it helps.",
  tough: "Logged. One check-in at a time.",
  okay: "Logged. Steady as it goes.",
  good: "Logged. Nice.",
  strong: "Logged. Keep that going."
};

/* ---- Confetti (milestone celebration) ---- */
function burstConfetti(){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas=document.getElementById('confettiCanvas');
  canvas.classList.remove('hidden');
  const dpr=window.devicePixelRatio||1;
  canvas.width=innerWidth*dpr; canvas.height=innerHeight*dpr;
  canvas.style.width=innerWidth+'px'; canvas.style.height=innerHeight+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
  const colors=['#8fae8b','#c9a86a','#eae6dd','#b98878'];
  const N=46;
  const parts=Array.from({length:N},()=> ({
    x: innerWidth/2 + (Math.random()-0.5)*60,
    y: innerHeight*0.32,
    vx: (Math.random()-0.5)*7,
    vy: -Math.random()*6-4,
    g: 0.22+Math.random()*0.12,
    size: 4+Math.random()*4,
    rot: Math.random()*Math.PI,
    vr: (Math.random()-0.5)*0.3,
    color: colors[Math.floor(Math.random()*colors.length)]
  }));
  let frame=0;
  function tick(){
    frame++;
    ctx.clearRect(0,0,innerWidth,innerHeight);
    let alive=false;
    parts.forEach(p=>{
      p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr;
      if(p.y<innerHeight+20) alive=true;
      ctx.save();
      ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle=p.color;
      ctx.globalAlpha = Math.max(0, 1-frame/90);
      ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
      ctx.restore();
    });
    if(alive && frame<95){ requestAnimationFrame(tick); }
    else { canvas.classList.add('hidden'); ctx.clearRect(0,0,innerWidth,innerHeight); }
  }
  tick();
}

function buildTags(container, selArrRef, onToggle){
  container.innerHTML='';
  TRIGGERS.forEach(t=>{
    const el=document.createElement('button');
    el.className='tag'+(onToggle.sel.includes(t)?' on':'');
    el.textContent=t;
    el.onclick=()=>{
      const i=onToggle.sel.indexOf(t);
      if(i>-1) onToggle.sel.splice(i,1); else onToggle.sel.push(t);
      buildTags(container, selArrRef, onToggle);
    };
    container.appendChild(el);
  });
}

function toggleResetPanel(){
  const p=document.getElementById('resetPanel');
  p.classList.toggle('hidden');
  if(!p.classList.contains('hidden')){
    document.getElementById('resetPrompt').textContent = "No judgment here — a reset is just data. " + PROMPTS[Math.floor(Math.random()*PROMPTS.length)];
    selectedTriggers=[];
    buildTags(document.getElementById('triggerTags'), selectedTriggers, {sel:selectedTriggers});
  }
}

function confirmReset(){
  const note = document.getElementById('resetNote').value.trim();
  Store.resetStreak(note, selectedTriggers);
  document.getElementById('resetNote').value='';
  toggleResetPanel();
  renderToday();
  toast('Logged. Fresh count started — you\'ve got this.');
}

function saveNote(){
  const txt=document.getElementById('logNote').value.trim();
  if(!txt) return;
  Store.addNote(txt, selectedLogTriggers);
  document.getElementById('logNote').value='';
  selectedLogTriggers.length=0;
  buildTags(document.getElementById('logTriggerTags'), selectedLogTriggers, {sel:selectedLogTriggers});
  toast('Note saved.');
  go('today');
}

function checkMilestone(){
  const d=streakDays();
  if(MILESTONES.includes(d)){
    const key='milestone-'+d+'-'+todayKey(state.startDate);
    if(sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key,'1');
    toast(`🎉 ${d}-day milestone reached`);
    burstConfetti();
    if(navigator.vibrate) try{ navigator.vibrate([15,60,15,60,25]); }catch(e){}
  }
}

/* ---- History / calendar ---- */
function renderCalendar(){
  const y=monthCursor.getFullYear(), m=monthCursor.getMonth();
  document.getElementById('calLabel').textContent = monthCursor.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const grid=document.getElementById('calGrid');
  grid.innerHTML='';
  ['S','M','T','W','T','F','S'].forEach(d=>{
    const e=document.createElement('div'); e.className='cal-dow'; e.textContent=d; grid.appendChild(e);
  });
  const first=new Date(y,m,1), startWd=first.getDay(), daysIn=new Date(y,m+1,0).getDate();
  const resetDays=new Set(state.history.filter(h=>h.type==='reset').map(h=>todayKey(h.date)));
  const noteDays=new Set(state.history.filter(h=>h.type==='note').map(h=>todayKey(h.date)));
  const checkinDays=new Set(state.history.filter(h=>h.type==='checkin').map(h=>todayKey(h.date)));
  const streakStartKey=todayKey(state.startDate);
  for(let i=0;i<startWd;i++){ grid.appendChild(document.createElement('div')); }
  for(let d=1; d<=daysIn; d++){
    const dt=new Date(y,m,d); const key=todayKey(dt.getTime());
    const cell=document.createElement('div');
    let cls='cal-cell';
    if(resetDays.has(key)) cls+=' reset';
    else if(key>=streakStartKey && dt<=new Date()) cls+=' streak';
    if(noteDays.has(key) && !resetDays.has(key)) cls+=' note';
    if(checkinDays.has(key) && !resetDays.has(key)) cls+=' checkin';
    cell.className=cls;
    cell.textContent=d;
    grid.appendChild(cell);
  }
}
function shiftMonth(n){ monthCursor=new Date(monthCursor.getFullYear(), monthCursor.getMonth()+n, 1); renderCalendar(); }

function renderEntries(){
  const list=document.getElementById('entryList');
  const loadMoreBtn=document.getElementById('loadMoreBtn');
  list.innerHTML='';
  if(state.history.length===0){
    list.innerHTML='<div class="empty-state"><div class="em-ic">◔</div>Your journey starts here.<br>Log your first check-in to see it show up.</div>';
    loadMoreBtn.classList.add('hidden');
    return;
  }
  const visible = state.history.slice(0, entriesShown);
  visible.forEach((h,idx)=>{
    const el=document.createElement('div');
    el.className='entry '+h.type;
    let tagsHtml = (h.triggers&&h.triggers.length) ? `<div class="tagstrip">${h.triggers.map(t=>`<span>${t}</span>`).join('')}</div>` : '';
    let kindLabel = 'Note';
    if(h.type==='reset') kindLabel = `Reset · ${h.streakLength}d streak ended`;
    if(h.type==='checkin') kindLabel = `Check-in · ${MOODS.find(m=>m.id===h.mood)?.label || h.mood}`;
    el.innerHTML = `
      <div class="row">
        <span class="kind">${kindLabel}</span>
        <span class="date">${fmtLong(h.date)}</span>
      </div>
      ${tagsHtml}
      ${h.text?`<div class="txt">${escapeHtml(h.text)}</div>`:''}
      <button class="del" onclick="deleteEntry(${idx})">delete</button>
    `;
    list.appendChild(el);
  });
  loadMoreBtn.classList.toggle('hidden', entriesShown >= state.history.length);
}
function loadMoreEntries(){ entriesShown += ENTRY_PAGE; renderEntries(); }
function deleteEntry(i){ Store.deleteEntry(i); renderHistoryView(); }
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

function renderTriggerChart(){
  const counts={};
  state.history.forEach(h=>{ (h.triggers||[]).forEach(t=>{ counts[t]=(counts[t]||0)+1; }); });
  const canvas=document.getElementById('triggerChart');
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const w=canvas.clientWidth||320, hgt=140;
  canvas.width=w*dpr; canvas.height=hgt*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,hgt);
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(entries.length===0){
    ctx.fillStyle='#5c6664'; ctx.font='12px sans-serif';
    ctx.fillText('No trigger data yet — tag triggers when you check in or log a note.', 4, 20);
    return;
  }
  const max=Math.max(...entries.map(e=>e[1]));
  const barH=16, gap=8, top=6;
  entries.forEach(([name,count],i)=>{
    const y=top+i*(barH+gap);
    const barW=(count/max)*(w-90);
    ctx.fillStyle='#232c2e';
    ctx.fillRect(90,y,w-90,barH);
    ctx.fillStyle='#8fae8b';
    ctx.fillRect(90,y,barW,barH);
    ctx.fillStyle='#8b9694'; ctx.font='11px sans-serif'; ctx.textAlign='right';
    ctx.fillText(name, 84, y+barH-4);
    ctx.fillStyle='#eae6dd'; ctx.textAlign='left';
    ctx.fillText(count, 90+barW+6, y+barH-4);
  });
}

/* ---- Year heatmap (GitHub-style) ---- */
function renderHeatmap(){
  const grid=document.getElementById('heatmapGrid');
  grid.innerHTML='';
  const days=180; // ~6 months, keeps it scrollable but not huge
  const resetSet=new Set(state.history.filter(h=>h.type==='reset').map(h=>todayKey(h.date)));
  const activitySet={}; // key -> count of notes/checkins that day
  state.history.forEach(h=>{
    if(h.type==='note'||h.type==='checkin'){
      const k=todayKey(h.date);
      activitySet[k]=(activitySet[k]||0)+1;
    }
  });
  const streakStartKey=todayKey(state.startDate);
  const start=new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-(days-1));
  // pad to start on Sunday so weeks align into 7-row columns
  const lead=start.getDay();
  for(let i=0;i<lead;i++){ const c=document.createElement('div'); c.className='hm-cell hm-0'; grid.appendChild(c); }
  for(let i=0;i<days;i++){
    const dt=new Date(start); dt.setDate(start.getDate()+i);
    const key=todayKey(dt.getTime());
    let cls='hm-cell ';
    if(resetSet.has(key)) cls+='hm-r';
    else{
      const count=activitySet[key]||0;
      const inStreak = key>=streakStartKey && dt<=new Date();
      if(count>=2) cls+='hm-3';
      else if(count===1) cls+='hm-2';
      else if(inStreak) cls+='hm-1';
      else cls+='hm-0';
    }
    const cell=document.createElement('div');
    cell.className=cls;
    cell.title=key;
    grid.appendChild(cell);
  }
  requestAnimationFrame(()=>{ const sc=grid.parentElement; sc.scrollLeft=sc.scrollWidth; });
}

/* ---- Share streak (Canvas + Web Share API) ---- */
async function shareStreak(){
  const d=streakDays();
  const W=1080,H=1080;
  const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  const grad=ctx.createRadialGradient(W/2,H*0.35,50,W/2,H*0.35,W*0.8);
  grad.addColorStop(0,'#1b2426'); grad.addColorStop(1,'#12181a');
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);

  ctx.strokeStyle='#232c2e'; ctx.lineWidth=18;
  ctx.beginPath(); ctx.arc(W/2,H*0.42,300,0,Math.PI*2); ctx.stroke();
  const nm=nextMilestone(d), pm=prevMilestone(d);
  const progress = nm ? (d-pm)/(nm-pm) : 1;
  ctx.strokeStyle='#8fae8b'; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(W/2,H*0.42,300,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(progress,1)); ctx.stroke();

  ctx.fillStyle='#eae6dd'; ctx.textAlign='center';
  ctx.font='170px Georgia, serif';
  ctx.fillText(String(d), W/2, H*0.42+55);
  ctx.font='28px sans-serif'; ctx.fillStyle='#8b9694';
  ctx.fillText((d===1?'DAY':'DAYS')+' STEADY', W/2, H*0.42+120);

  ctx.font='36px Georgia, serif'; ctx.fillStyle='#8fae8b';
  ctx.fillText('☾ Steady', W/2, H*0.86);

  const blob = await new Promise(res=>canvas.toBlob(res,'image/png'));
  const file = new File([blob], 'steady-'+d+'-days.png', {type:'image/png'});

  if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
    try{
      await navigator.share({ files:[file], title:'Steady', text:`${d} ${d===1?'day':'days'} steady.` });
      return;
    }catch(e){ /* user cancelled or share failed — fall through to download */ }
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='steady-'+d+'-days.png';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Image saved — share it however you like.');
}

function renderHistoryView(){ renderCalendar(); entriesShown=ENTRY_PAGE; renderEntries(); renderTriggerChart(); renderHeatmap(); }

/* ---- SOS breathing ---- */
function toggleBreathing(){
  breathing = !breathing;
  const btn=document.getElementById('sosToggle');
  const circleEl=document.getElementById('breathCircle');
  circleEl.setAttribute('aria-pressed', String(breathing));
  circleEl.setAttribute('aria-label', breathing ? 'Stop breathing exercise' : 'Start breathing exercise');
  if(breathing){
    btn.textContent='Stop';
    breathStart=Date.now();
    runBreathCycle();
    breathTimer=setInterval(()=>{
      const s=Math.floor((Date.now()-breathStart)/1000);
      document.getElementById('sosTimer').textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')} elapsed`;
    },1000);
  } else {
    btn.textContent='Start';
    clearInterval(breathTimer); clearTimeout(breathPhaseTimer);
    const circle=document.getElementById('breathCircle');
    circle.className='breath-circle';
    document.getElementById('breathLabel').textContent='tap to begin';
  }
}
document.getElementById('breathCircle')?.addEventListener('click', toggleBreathing);
document.getElementById('breathCircle')?.addEventListener('keydown', e=>{
  if(e.code==='Space' || e.code==='Enter'){ e.preventDefault(); toggleBreathing(); }
});
function runBreathCycle(){
  const circle=document.getElementById('breathCircle');
  const label=document.getElementById('breathLabel');
  const phases=[ ['in','Breathe in',4000], ['hold','Hold',7000], ['out','Breathe out',8000] ];
  let i=0;
  function step(){
    if(!breathing) return;
    const [cls,text,dur]=phases[i%phases.length];
    circle.className='breath-circle '+cls;
    label.textContent=text;
    if(navigator.vibrate) try{ navigator.vibrate(8); }catch(e){}
    i++;
    breathPhaseTimer=setTimeout(step,dur);
  }
  step();
}

/* ---- Navigation ---- */
function go(view){
  currentView=view;
  history.replaceState(null,'','#'+view);
  ['today','sos','log','history','settings'].forEach(v=>{
    document.getElementById('view-'+v).classList.toggle('hidden', v!==view);
  });
  document.querySelectorAll('nav.bottom button').forEach(b=>{
    b.classList.toggle('active', b.dataset.v===view);
  });
  if(view==='today') renderToday();
  if(view==='history') renderHistoryView();
  if(view==='log'){
    document.getElementById('logPrompt').textContent = PROMPTS[Math.floor(Math.random()*PROMPTS.length)];
    selectedLogTriggers.length=0;
    buildTags(document.getElementById('logTriggerTags'), selectedLogTriggers, {sel:selectedLogTriggers});
  }
  if(view==='sos'){
    document.getElementById('sosWhyBox').innerHTML = state.why
      ? `<div style="font-family:var(--sans);font-size:12px;color:var(--dim);margin-bottom:6px;letter-spacing:.5px;">YOUR WHY</div><div style="font-family:var(--sans);font-size:13.5px;color:#c9c4b8;line-height:1.5;">${escapeHtml(state.why)}</div>`
      : `<div style="font-family:var(--sans);font-size:13px;color:var(--dim);">Add "your why" in Settings — it'll show up here when you need it.</div>`;
  }
  if(view==='settings'){
    document.getElementById('whyText').value = state.why || '';
    document.getElementById('reminderSwitch').classList.toggle('on', !!state.reminderOn);
    document.getElementById('pinSwitch').classList.toggle('on', !!state.pin);
  }
}

/* ---- Settings actions ---- */
document.getElementById('whyText')?.addEventListener('blur', e=>{ Store.setWhy(e.target.value); });

function toggleReminder(){
  if(!state.reminderOn){
    if(!('Notification' in window)){ toast('Notifications not supported here.'); return; }
    Notification.requestPermission().then(perm=>{
      if(perm==='granted'){
        Store.setReminder(true);
        document.getElementById('reminderSwitch').classList.add('on');
        scheduleReminder();
        toast('Daily reminder on — works while the app is open.');
      } else {
        toast('Permission denied.');
      }
    });
  } else {
    Store.setReminder(false);
    document.getElementById('reminderSwitch').classList.remove('on');
  }
}
function scheduleReminder(){
  if(!state.reminderOn) return;
  // Best-effort: only fires while app/tab is alive, since background push needs a server.
  setTimeout(()=>{
    if(state.reminderOn && Notification.permission==='granted'){
      new Notification('Steady', {body:'Quick check-in — how are you doing today?', icon:'icons/icon-192.png'});
    }
    scheduleReminder();
  }, 24*60*60*1000);
}

/* ---- Custom modal system (replaces prompt()/confirm()) ---- */
function openModal(html){
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal(){
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modalBox').innerHTML='';
}

function togglePinSetting(){
  if(!state.pin){
    openModal(`
      <h3>Set a PIN</h3>
      <p>4–6 digits. This locks the app when you reopen it. There's no recovery if you forget it — you'd need to erase app data.</p>
      <input type="tel" inputmode="numeric" maxlength="6" class="pin-set-input" id="pinSetInput" placeholder="••••" autofocus>
      <div class="modal-row">
        <button class="btn-primary" onclick="submitNewPin()">Set PIN</button>
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      </div>
    `);
    setTimeout(()=>document.getElementById('pinSetInput')?.focus(), 50);
  } else {
    openModal(`
      <h3>Remove PIN</h3>
      <p>Enter your current PIN to turn off app lock.</p>
      <input type="tel" inputmode="numeric" maxlength="6" class="pin-set-input" id="pinRemoveInput" placeholder="••••" autofocus>
      <div class="modal-row">
        <button class="btn-rust" onclick="submitRemovePin()">Remove</button>
        <button class="btn-ghost" onclick="closeModal()">Cancel</button>
      </div>
    `);
    setTimeout(()=>document.getElementById('pinRemoveInput')?.focus(), 50);
  }
}
async function submitNewPin(){
  const v=document.getElementById('pinSetInput').value;
  if(!/^\d{4,6}$/.test(v)){ toast('PIN must be 4-6 digits.'); return; }
  await Store.setPin(v);
  document.getElementById('pinSwitch').classList.add('on');
  closeModal();
  toast('PIN set.');
}
async function submitRemovePin(){
  const v=document.getElementById('pinRemoveInput').value;
  const h=await hashPin(v);
  if(h===state.pin){
    Store.clearPin();
    document.getElementById('pinSwitch').classList.remove('on');
    closeModal();
    toast('PIN removed.');
  } else {
    toast('Incorrect PIN.');
  }
}

function exportData(){
  const blob=new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='steady-backup-'+todayKey(Date.now())+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Backup downloaded.');
}
function importData(ev){
  const file=ev.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(typeof data.startDate!=='number' || !Array.isArray(data.history)) throw new Error('bad format');
      Store.replaceAll(data);
      toast('Backup restored.');
      go('today');
    }catch(err){ toast('Could not read that file.'); }
  };
  reader.readAsText(file);
  ev.target.value='';
}
function wipeData(){
  openModal(`
    <h3>Erase all data?</h3>
    <p>This deletes your streak, history, and settings from this device. It cannot be undone.</p>
    <div class="modal-row">
      <button class="btn-rust" onclick="confirmWipe()">Erase everything</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>
  `);
}
function confirmWipe(){
  Store.wipe();
  closeModal();
  toast('All data erased.');
  go('today');
}

/* ---- Lock screen ---- */
async function migrateLegacyPin(){
  // Pre-hashing versions stored the raw PIN. A SHA-256 hex digest is always
  // 64 chars; anything shorter still sitting in state.pin is legacy plaintext.
  if(state.pin && !/^[0-9a-f]{64}$/.test(state.pin)){
    const legacy = state.pin;
    state.pin = await hashPin(legacy);
    save();
  }
}
function updatePinDots(len){
  document.querySelectorAll('#pinDots .pin-dot').forEach((dot,i)=>{
    dot.classList.toggle('filled', i<len);
  });
}
function checkLock(){
  if(state.pin){
    document.getElementById('lockscreen').classList.remove('hidden');
    const input=document.getElementById('pinInput');
    input.value=''; updatePinDots(0);
    input.focus();
    input.oninput=async ()=>{
      const v=input.value.replace(/\D/g,'').slice(0,6);
      input.value=v;
      updatePinDots(v.length);
      if(v.length>=4){
        const h=await hashPin(v);
        if(h===state.pin){
          document.getElementById('lockscreen').classList.add('hidden');
        } else if(v.length>=4){
          document.getElementById('pinErr').textContent='Incorrect PIN';
          document.querySelectorAll('#pinDots .pin-dot').forEach(d=>d.classList.add('wrong'));
          setTimeout(()=>{
            input.value=''; updatePinDots(0);
            document.querySelectorAll('#pinDots .pin-dot').forEach(d=>d.classList.remove('wrong'));
          },400);
        }
      }
    };
  }
}
document.getElementById('lockBtn').onclick=()=>{ if(state.pin) checkLock(); else go('settings'); };

/* ---- Install prompt (Add to Home Screen) ---- */
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  const row=document.getElementById('installRow');
  if(row) row.style.display='flex';
});
function triggerInstall(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.finally(()=>{
    deferredInstallPrompt=null;
    const row=document.getElementById('installRow');
    if(row) row.style.display='none';
  });
}
window.addEventListener('appinstalled', ()=>{ toast('Installed. You can open Steady from your home screen now.'); });

/* ---- Offline awareness (app shell already works offline via the service worker) ---- */
window.addEventListener('offline', ()=>toast("You're offline — your data is safe on this device."));
window.addEventListener('online', ()=>toast('Back online.'));

/* ---- Init ---- */
async function init(){
  load();
  await migrateLegacyPin();
  buildTags(document.getElementById('triggerTags'), selectedTriggers, {sel:selectedTriggers});
  buildTags(document.getElementById('logTriggerTags'), selectedLogTriggers, {sel:selectedLogTriggers});
  const hashView = (location.hash || '').replace('#','');
  const validViews = ['today','sos','log','history','settings'];
  go(validViews.includes(hashView) ? hashView : 'today');
  checkMilestone();
  checkLock();
  if(state.reminderOn) scheduleReminder();
  setInterval(()=>{ if(currentView==='today') renderToday(); }, 60000);
}
init();

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}
