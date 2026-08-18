/* =========================
   Cerdas Cermat Frengki - Bingo.js (MCQ only)
   + Live team name
   + Take Over dari sisa REGULAR (fallback opsional)
   + Simpan TO ke boardCells (questionId/text) seperti Regular (persist)
   + Safe open (skip bad MCQ)
   + Popup feedback + SFX (tanpa BigMark, tanpa hint banner)
   + Operator-driven close/next (klik layar / Enter/Space)
   + Keep colors at game end (no grey-out massal)
   + Bingo color sesuai tim + popup BINGO sticky
   + TO prompt fallback (ambil teks sebelum A–D bila parser kosong)
   + Legacy TO buttons di-hide
   + Timer Dock (Answer/TO 5s & Steal 10s) dengan posisi baseline-locked

   *** UPDATE (FINAL MODE) ***
   + Mode FINAL sama seperti REGULAR: 20 REG + 5 TAKEOVER dari #finalBank
     - Tambahan fungsi: loadFinalBankFromHTML(), startFinal()
     - Tidak mengubah flow engine lainnya
   ========================= */

/* ---------- Utilities ---------- */
function shuffle(arr){ const a=(arr||[]).slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function sum(obj){ return Object.values(obj).reduce((a,b)=>a+b,0); }
function dedupeById(arr){ const s=new Set(); return (arr||[]).filter(x=>x&&x.id&&!s.has(x.id)&&(s.add(x.id),true)); }

/* ---------- Team Colors (inline override for Bingo) ---------- */
const TEAM_COLOR_MAP = {
  A: { bg:'#2F80ED', fg:'#ffffff' }, // biru
  B: { bg:'#27AE60', fg:'#ffffff' }, // hijau
  C: { bg:'#F2994A', fg:'#ffffff' }, // oranye
  D: { bg:'#EB5757', fg:'#ffffff' }  // merah
};

/* ---------- Category helpers ---------- */
function normalizeRegCategory(q){
  const raw=(q.cat||q.category||'').toString().toUpperCase().trim();
  if(['OHIH','RCA','ENV','ESDM'].includes(raw)) return raw;
  const id=(q.id||'').toLowerCase();
  if(id.startsWith('ohih-')) return 'OHIH';
  if(id.startsWith('rca-'))  return 'RCA';
  if(id.startsWith('env-'))  return 'ENV';
  if(id.startsWith('esdm-')) return 'ESDM';
  return '';
}
function normalizeTOCategory(q){
  const raw=(q.cat||q.category||'').toString().toUpperCase().trim();
  if(['TOHIH','TRCA','TENV','TESDM'].includes(raw)) return raw;
  const id=(q.id||'').toLowerCase();
  if(id.startsWith('tohih-')) return 'TOHIH';
  if(id.startsWith('trca-'))  return 'TRCA';
  if(id.startsWith('tenv-'))  return 'TENV';
  if(id.startsWith('tesdm-')) return 'TESDM';
  if(id.startsWith('ohih-')) return 'TOHIH';
  if(id.startsWith('rca-'))  return 'TRCA';
  if(id.startsWith('env-'))  return 'TENV';
  if(id.startsWith('esdm-')) return 'TESDM';
  return '';
}
function groupByKeys(arr, normalizerFn, keys){
  const g=keys.reduce((m,k)=>(m[k]=[],m),{}); g.UNSET=[];
  for(const q of dedupeById(arr||[])){ const k=normalizerFn(q); (keys.includes(k)?g[k]:g.UNSET).push(q); }
  return g;
}
function takeRandom(arr,n){ const a=shuffle(arr||[]); return a.slice(0,Math.min(n,a.length)); }
function removeTaken(poolArr,takenArr){ for(const t of (takenArr||[])){ const i=poolArr.findIndex(x=>x.id===t.id); if(i>=0) poolArr.splice(i,1);} }

/* ---------- Load banks from HTML ---------- */
function readJsonScript(id){
  const el=document.getElementById(id); if(!el) return {items:[]};
  try{
    const raw=el.textContent||el.innerText||'';
    const data=JSON.parse(raw||'{}');
    return (data && Array.isArray(data.items))?data:{items:[]};
  }catch{
    console.warn('Gagal parse JSON:',id);
    return {items:[]};
  }
}
function loadBankFromHTML(){
  const REG=readJsonScript('regularBank').items;
  const TO=readJsonScript('takeoverBank').items; // opsional fallback
  return {reg:REG,to:TO};
}
// Loader finalBank (bank soal tetap di HTML)
function loadFinalBankFromHTML(){
  const F=readJsonScript('finalBank').items;
  return Array.isArray(F)?F:[];
}

/* ---------- Quotas ---------- */
const REGULAR_QUOTA={OHIH:5,RCA:5,ENV:5,ESDM:5}; // 20
const TAKEOVER_TOTAL=5;

/* ---------- Event persistence ---------- */
function eventKey(eventId){ return `quiz-event:${eventId}`; }
function roundStateKey(eventId,roundNo){ return `quiz-state:${eventId}:round${roundNo}`; }
function loadEvent(eventId){ const raw=localStorage.getItem(eventKey(eventId)); if(!raw) return null; try{ return JSON.parse(raw);}catch{return null;} }
function saveEvent(ev){ localStorage.setItem(eventKey(ev.eventId),JSON.stringify(ev)); }

/* ---------- Init event ---------- */
function initEventIfNeeded(eventId){
  let ev=loadEvent(eventId);
  if(ev && ev.reg && ev.to) return ev;

  const {reg,to}=loadBankFromHTML();
  const regG=groupByKeys(reg,normalizeRegCategory,['OHIH','RCA','ENV','ESDM']);
  const toG =groupByKeys(to ,normalizeTOCategory ,['TOHIH','TRCA','TENV','TESDM']);

  ev={
    eventId,
    reg:{
      OHIH:shuffle(regG.OHIH||[]),
      RCA :shuffle(regG.RCA ||[]),
      ENV :shuffle(regG.ENV ||[]),
      ESDM:shuffle(regG.ESDM||[])
    },
    to:{ // fallback bila sisa REG kurang
      TOHIH:shuffle(toG.TOHIH||[]),
      TRCA :shuffle(toG.TRCA||[]),
      TENV :shuffle(toG.TENV||[]),
      TESDM:shuffle(toG.TESDM||[])
    },
    roundsDrawn:0
  };
  saveEvent(ev); return ev;
}

/* ---------- Draw round (REGULAR mode) ---------- */
function drawNextRound(eventId){
  const ev=initEventIfNeeded(eventId);
  if(ev.roundsDrawn>=4) throw new Error("4 rounds already prepared for this event");
  const REG_TOTAL=sum(REGULAR_QUOTA);

  // Regular 20
  let regPicked=[];
  for(const cat of Object.keys(REGULAR_QUOTA)){
    const got=takeRandom(ev.reg[cat]||[], REGULAR_QUOTA[cat]);
    regPicked.push(...got);
  }
  let def=REG_TOTAL-regPicked.length;
  if(def>0){
    const pool=[].concat(ev.reg.OHIH||[],ev.reg.RCA||[],ev.reg.ENV||[],ev.reg.ESDM||[]);
    regPicked.push(...takeRandom(pool,def));
  }
  if(regPicked.length<REG_TOTAL) throw new Error("REGULAR pool < 20. Isi #regularBank.");

  removeTaken(ev.reg.OHIH, regPicked.filter(q=>normalizeRegCategory(q)==='OHIH'));
  removeTaken(ev.reg.RCA , regPicked.filter(q=>normalizeRegCategory(q)==='RCA' ));
  removeTaken(ev.reg.ENV , regPicked.filter(q=>normalizeRegCategory(q)==='ENV' ));
  removeTaken(ev.reg.ESDM, regPicked.filter(q=>normalizeRegCategory(q)==='ESDM'));

  // Take Over 5 dari sisa REG
  const remainReg=[].concat(ev.reg.OHIH||[], ev.reg.RCA||[], ev.reg.ENV||[], ev.reg.ESDM||[]);
  let toPicked = takeRandom(remainReg, TAKEOVER_TOTAL);

  // fallback lunak ke bank TO bila kurang
  if(toPicked.length < TAKEOVER_TOTAL){
    const need = TAKEOVER_TOTAL - toPicked.length;
    const toFlat=[].concat(ev.to.TOHIH||[], ev.to.TRCA||[], ev.to.TENV||[], ev.to.TESDM||[]);
    const extra=takeRandom(toFlat, need);
    toPicked = toPicked.concat(extra);
    removeTaken(ev.to.TOHIH, extra.filter(q=>normalizeTOCategory(q)==='TOHIH'));
    removeTaken(ev.to.TRCA , extra.filter(q=>normalizeTOCategory(q)==='TRCA' ));
    removeTaken(ev.to.TENV , extra.filter(q=>normalizeTOCategory(q)==='TENV' ));
    removeTaken(ev.to.TESDM, extra.filter(q=>normalizeTOCategory(q)==='TESDM'));
  }
  removeTaken(ev.reg.OHIH, toPicked.filter(q=>normalizeRegCategory(q)==='OHIH'));
  removeTaken(ev.reg.RCA , toPicked.filter(q=>normalizeRegCategory(q)==='RCA' ));
  removeTaken(ev.reg.ENV , toPicked.filter(q=>normalizeRegCategory(q)==='ENV' ));
  removeTaken(ev.reg.ESDM, toPicked.filter(q=>normalizeRegCategory(q)==='ESDM'));

  ev.roundsDrawn+=1; saveEvent(ev);
  return { roundNo:ev.roundsDrawn, regular20:shuffle(regPicked), takeover5:shuffle(toPicked) };
}

/* ---------- State ---------- */
let teams={ A:{name:"Tim A",score:0}, B:{name:"Tim B",score:0}, C:{name:"Tim C",score:0}, D:{name:"Tim D",score:0} };
let activeTeam=null, mode="regular", bingoHappened=false, currentCell=null, reassignMode=false;
let eventId=null, roundNo=null;
let regularQuestions=[], takeoverQuestions=[];
let boardCells=[], takeoverQueue=[], takeoverIndex=0, regIndex=0;
let boardLocked=false;

/* ---------- Persist round ---------- */
function saveState(){
  if(!eventId||!roundNo) return;
  const s={eventId,roundNo,mode,bingoHappened,boardCells,takeoverQueue,takeoverIndex,teams,regularQuestions,takeoverQuestions,regIndex,activeTeam};
  localStorage.setItem(roundStateKey(eventId,roundNo), JSON.stringify(s));
}
function loadState(eid,rno){
  const raw=localStorage.getItem(roundStateKey(eid,rno)); if(!raw) return false;
  try{
    const s=JSON.parse(raw);
    eventId=s.eventId; roundNo=s.roundNo;
    mode=s.mode; bingoHappened=s.bingoHappened;
    boardCells=s.boardCells; takeoverQueue=s.takeoverQueue; takeoverIndex=s.takeoverIndex;
    teams=s.teams; regularQuestions=s.regularQuestions||[]; takeoverQuestions=s.takeoverQuestions||[];
    regIndex=typeof s.regIndex==='number'?s.regIndex:0; activeTeam=s.activeTeam||null;

    try{
      if (document.getElementById("teamA")) document.getElementById("teamA").value = teams?.A?.name || "Tim A";
      if (document.getElementById("teamB")) document.getElementById("teamB").value = teams?.B?.name || "Tim B";
      if (document.getElementById("teamC")) document.getElementById("teamC").value = teams?.C?.name || "Tim C";
      if (document.getElementById("teamD")) document.getElementById("teamD").value = teams?.D?.name || "Tim D";
      bindTeamNameInputs();
    }catch{}
    return true;
  }catch{ return false; }
}

/* ---------- Team name live bindings ---------- */
function applyTeamNamesFromInputs(){
  const a = (document.getElementById("teamA")?.value || "").trim();
  const b = (document.getElementById("teamB")?.value || "").trim();
  const c = (document.getElementById("teamC")?.value || "").trim();
  const d = (document.getElementById("teamD")?.value || "").trim();
  teams.A.name = a || "Tim A";
  teams.B.name = b || "Tim B";
  teams.C.name = c || "Tim C";
  teams.D.name = d || "Tim D";
}
function bindTeamNameInputs(){
  const map = [
    { id: "teamA", key: "A" },
    { id: "teamB", key: "B" },
    { id: "teamC", key: "C" },
    { id: "teamD", key: "D" },
  ];
  map.forEach(({id, key}) => {
    const el = document.getElementById(id);
    if(!el) return;
    const v = (el.value || "").trim();
    teams[key].name = v ? v : `Tim ${key}`;
    el.addEventListener("input", () => {
      const nv = (el.value || "").trim();
      teams[key].name = nv ? nv : `Tim ${key}`;
      updateScores(); saveState();
    });
  });
  updateScores();
}

/* ---------- Popup ---------- */
let __popupHideTimer=null;
function showPopup(msg, opts = {}) {
  const el = document.getElementById("popup"); 
  if (!el) return;

  const center = !!opts.center;
  const sticky = !!opts.sticky;

  el.classList.remove('hidden','center-in-box','sticky');

  if (center) el.classList.add('center-in-box');
  else if (sticky) el.classList.add('sticky');

  if (__popupHideTimer) { clearTimeout(__popupHideTimer); __popupHideTimer = null; }
  el.innerText = msg || '';
  el.style.display = "block";

  if (!sticky) {
    __popupHideTimer = setTimeout(() => {
      el.style.display = "none";
      el.classList.remove('center-in-box');
      __popupHideTimer = null;
    }, 1500);
  }
}

/* ---------- Await operator click ---------- */
let __awaitClose = null;
function awaitOperatorClickTo(onContinue){
  if (__awaitClose) return;
  __awaitClose = true;

  const proceed = () => {
    document.removeEventListener('pointerdown', pointerHandler, true);
    document.removeEventListener('keydown', keyHandler, true);
    __awaitClose = null;
    try { onContinue && onContinue(); } catch {}
  };

  const pointerHandler = () => proceed();
  const keyHandler = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); proceed(); } };

  document.addEventListener('pointerdown', pointerHandler, true);
  document.addEventListener('keydown', keyHandler, true);
}

/* ---------- Timer Dock ---------- */
function ensureTimerDock(){
  if (document.getElementById('timerDock')) return;
  const dock = document.createElement('div'); dock.id = 'timerDock';

  const cardL = document.createElement('div'); cardL.id='timerAnswerOrTO'; cardL.className='timerCard mode-answer';
  cardL.innerHTML = '<div class="timerTitle">Answer 5s</div><div class="timerNumber">00</div>';

  const cardR = document.createElement('div'); cardR.id='timerSteal'; cardR.className='timerCard mode-steal hidden';
  cardR.innerHTML = '<div class="timerTitle">Steal 10s</div><div class="timerNumber">00</div>';

  dock.appendChild(cardL); dock.appendChild(cardR);
  document.body.appendChild(dock);
}
ensureTimerDock();

/* Engine */
let __timer = {
  running:false,
  type:null,          // 'answer' | 'steal' | 'to'
  remaining:0,
  iv:null,
  targetCard:null,
  onDone:null
};

function timerSetUI(card, {type, seconds}){
  if(!card) return;
  const title = card.querySelector('.timerTitle');
  const num   = card.querySelector('.timerNumber');

  card.classList.remove('mode-answer','mode-steal','mode-to','muted','hidden');
  if(type==='answer'){ card.classList.add('mode-answer'); title.innerText='Answer 5s'; }
  else if(type==='steal'){ card.classList.add('mode-steal'); title.innerText='Steal 10s'; }
  else if(type==='to'){ card.classList.add('mode-to'); title.innerText='TO 5s'; }
  else { title.innerText='Timer'; }

  card.classList.toggle('muted', seconds > 2);
  num.innerText = String(seconds).padStart(2,'0');
}

function timerPrepare(type, seconds, onDone){
  const cardL = document.getElementById('timerAnswerOrTO');
  const cardR = document.getElementById('timerSteal');

  let card = null;
  if(type==='answer' || type==='to'){ card = cardL; }
  if(type==='steal'){ card = cardR; }

  if(cardL) cardL.classList.toggle('hidden', !(type==='answer' || type==='to'));
  if(cardR) cardR.classList.toggle('hidden', (type!=='steal'));

  __timer.running=false;
  __timer.type=type;
  __timer.remaining=seconds;
  __timer.targetCard=card;
  __timer.onDone = (typeof onDone==='function')?onDone:null;

  if(__timer.iv){ clearInterval(__timer.iv); __timer.iv=null; }
  timerSetUI(card, {type, seconds});

  if(type==='steal'){
    Promise.resolve().then(()=>{ timerStart(); });
  }
}

function timerStart(){
  if(!__timer.type || !__timer.targetCard) return;
  if(__timer.running){ timerReset(); return; }
  __timer.running = true;

  let lastTick = Date.now();
  __timer.iv = setInterval(()=>{
    const now = Date.now();
    if(now - lastTick >= 1000){
      lastTick = now;
      __timer.remaining = Math.max(0, __timer.remaining - 1);
      timerSetUI(__timer.targetCard, {type:__timer.type, seconds:__timer.remaining});
      if(__timer.remaining === 2 || __timer.remaining === 1){ playTimerTick(); }
      if(__timer.remaining === 0){
        playTimerEnd();
        timerStopCore();
        try{ __timer.onDone && __timer.onDone(); }catch{}
      }
    }
  }, 200);
}
function timerStopCore(){
  __timer.running=false;
  if(__timer.iv){ clearInterval(__timer.iv); __timer.iv=null; }
}
function timerReset(){
  timerStopCore();
  if(__timer.targetCard){ timerSetUI(__timer.targetCard, {type:__timer.type, seconds:0}); }
}
function bindTimerCardInteractions(){
  ['timerAnswerOrTO','timerSteal'].forEach(id=>{
    const card = document.getElementById(id); if(!card) return;
    let clicks=0, last=0;
    card.addEventListener('click', ()=>{
      const now = Date.now();
      clicks = (now-last < 280) ? clicks+1 : 1; last = now;
      if(clicks>=2){ card.classList.toggle('circle'); clicks=0; return; }
      const desiredType = (id==='timerAnswerOrTO') ? (__timer.type==='to' ? 'to' : 'answer') : 'steal';
      if(__timer.type === desiredType){ timerStart(); }
    });
  });

  // Auto behavior:
  document.body.addEventListener('click', (ev)=>{
    const t = ev.target;
    const id = t && t.id || '';
    if(!/^score[ABCD]$/.test(id)) return;

    setTimeout(()=>{
      if(mode==='takeover' && __timer.type==='to'){
        if(!__timer.running && __timer.targetCard){
          timerStart();
        }
        return;
      }

      if(__timer.type!=='steal' || mode!=='regular' || currentCell===null) return;
      const cs = (boardCells && boardCells[currentCell]) || null;
      if(!cs || cs.type!=='regular' || cs.dead || cs.attempts!==1) return;

      timerStopCore();
      timerPrepare('answer', 5, ()=>{
        try{ playSfx('wrong'); }catch{}
        try{ wrongAnswerRegular(activeTeam, __currentAnsKey); }catch{}
      });
      timerStart();
    }, 0);
  }, false);

  const qb = document.getElementById('questionBox');
  if(qb){
    const obs = new MutationObserver(()=>{
      const hidden = qb.classList.contains('hidden') || getComputedStyle(qb).display==='none';
      if(hidden){ timerReset(); }
    });
    obs.observe(qb, { attributes:true, attributeFilter:['class','style'] });
  }
}
bindTimerCardInteractions();

/* ---------- Start REGULAR ---------- */
function startGame(){
  applyTeamNamesFromInputs();
  bindTeamNameInputs();

  hideLegacyTOButtons();

  const sid=document.getElementById("sessionId")?.value?.trim();
  if(!sid){ alert("Mohon isi Session ID (sebagai Event ID)."); return; }
  eventId=sid;

  const ev=initEventIfNeeded(eventId);
  let loaded=false;
  if(ev.roundsDrawn>0){
    roundNo=ev.roundsDrawn;
    loaded=loadState(eventId,roundNo);
    if(loaded && mode==="ended") loaded=false;
  }

  if(!loaded){
    try{
      const draw=drawNextRound(eventId);
      roundNo=draw.roundNo; regularQuestions=draw.regular20; takeoverQuestions=draw.takeover5;
      for(let t in teams) teams[t].score=0;
      mode="regular"; bingoHappened=false; currentCell=null; reassignMode=false; regIndex=0; boardLocked=false;
      activeTeam='A';
      generateBoard(); saveState();
    }catch(e){ alert(e.message||"Gagal membuat babak baru (cek bank soal)."); return; }
  }

  timerReset();
  updateScores(); renderBoard();
  document.getElementById("hostControls").classList.add("hidden");
  document.getElementById("questionBox").classList.add("hidden");
  document.getElementById("takeoverBox").classList.toggle("hidden", mode!=="takeover");
  if(mode==="takeover") renderTakeover();
}

/* ---------- START FINAL (20 REG + 5 TO dari #finalBank; flow sama REGULAR) ---------- */
function startFinal(){
  applyTeamNamesFromInputs();
  bindTeamNameInputs();
  hideLegacyTOButtons();

  const sid = document.getElementById("sessionId")?.value?.trim();
  if(!sid){ alert("Mohon isi Session ID (sebagai Event ID)."); return; }
  eventId = sid;

  // Reset skor & state (fresh)
  for(let t in teams) teams[t].score=0;
  activeTeam='A';
  bingoHappened=false;
  currentCell=null;
  reassignMode=false;
  regIndex=0;
  boardLocked=false;

  // Muat 25 dari finalBank (kalau kurang, pakai semua yang ada)
  const finalItems = loadFinalBankFromHTML();
  if(finalItems.length === 0){
    alert("Bank FINAL kosong (#finalBank).");
    return;
  }
  const picked = shuffle(finalItems).slice(0, Math.min(25, finalItems.length));

  // Bagi: 20 untuk REGULAR + 5 untuk TAKEOVER
  regularQuestions  = picked.slice(0, Math.min(20, picked.length));
  takeoverQuestions = picked.slice(20, Math.min(25, picked.length));

  // RoundNo pakai label 'final' untuk storage agar tidak bentrok babak angka
  roundNo = 'final';
  mode="regular";
  generateBoard();
  saveState();

  // UI persis startGame (mulai di REGULAR)
  timerReset();
  updateScores(); renderBoard();
  document.getElementById("hostControls").classList.add("hidden");
  document.getElementById("questionBox").classList.add("hidden");
  document.getElementById("takeoverBox").classList.add("hidden");
}
// expose
window.startFinal = startFinal;

/* ---------- Board ---------- */
function generateBoard(){
  boardCells=Array.from({length:25},(_,idx)=>({
    idx,type:'open',questionId:undefined,text:"",
    answered:false,attempts:0,dead:false,team:"",points:0,
    bingoWin:false
  }));
  takeoverQueue=[]; takeoverIndex=0;
  window.boardCells = boardCells; // debug
}
function assignedRegularCount(){ return (boardCells||[]).filter(c=>c.type==='regular').length; }
function renderBoard(){
  const board=document.getElementById("gameBoard");
  board.classList.toggle('board-locked', !!boardLocked && mode==='regular');
  board.classList.remove('board-bingo');
  board.innerHTML="";

  for(let idx=0; idx<25; idx++){
    const cs=boardCells[idx], cell=document.createElement("div");
    cell.classList.add("cell"); cell.innerText=idx+1;
    if(boardLocked && mode==='regular' && idx===currentCell) cell.classList.add("active");
    if(cs.dead) cell.classList.add("dead");
    if(cs.team) cell.classList.add("team"+cs.team);
    if(cs.bingoWin) cell.classList.add("bingo-win");
    if(mode==='takeover' && cs.type==='takeover'){
      cell.classList.add("takeoverSlot");
      if(takeoverQueue[takeoverIndex]===idx) cell.classList.add("takeoverActive");
    }

    // Bingo inline color (kuat)
    if (cs.bingoWin && cs.team && TEAM_COLOR_MAP[cs.team]) {
      const col = TEAM_COLOR_MAP[cs.team];
      cell.style.setProperty('background-color', col.bg, 'important');
      cell.style.setProperty('color', col.fg, 'important');
      cell.style.opacity = '1';
      cell.style.borderColor = '#16a085';
    }

    cell.dataset.index=String(idx);

    cell.addEventListener("click", ()=>{
      if(reassignMode){ handleReassignDOM(cell); return; }
      if(mode!=="regular") return;
      if(cs.dead || cs.answered) return;
      if(boardLocked && idx!==currentCell) return;

      if(cs.type==='open'){
        const already=assignedRegularCount();
        const quota=(regularQuestions?.length||20);
        if(already>=quota){ maybeStartTakeover(); return; }
        const q=regularQuestions[regIndex]; if(!q){ alert("Bank REGULAR habis."); return; }
        cs.type='regular'; cs.questionId=q.id; cs.text=q.text; regIndex+=1; saveState();
        showQuestionIndex(idx); return;
      }
      if(cs.type==='regular'){ showQuestionIndex(idx); }
    });

    board.appendChild(cell);
  }
}

/* ---------- Parser MCQ ---------- */
function htmlize(text){
  return (text||'')
    .replace(/&(amp;)+lt;br\s*\/?&(amp;)+gt/gi,'\n')
    .replace(/&lt;br\s*\/?&gt;/gi,'\n')
    .replace(/&amp;lt;\/.+?&amp;gt;/gi, '')
}
function extractPromptAndOptions(htmlText){
  let s = htmlize(htmlText)
    .replace(/\r/g,'')
    .replace(/&amp;lt;\/?[^&amp;gt]+&amp;gt;/g, '')
    .replace(/&amp;amp;lt;\/?[^&amp;amp;gt]+&amp;amp;gt;/g,'')
    .replace(/\u00A0/g,' ')
    .replace(/\u200B/g,'');

  const lines = s.split(/\n+/).map(t=>t.trim()).filter(Boolean);
  const optLineRe = /^\s*([A-Da-d])\s*[.\):\-]?\s*(.+)$/;

  const opts = {};
  let promptLines = [];
  let enteringOptions = false;

  for (const raw of lines){
    const line = raw.replace(/\s+/g,' ').trim();
    const m = line.match(optLineRe);
    if (m){
      enteringOptions = true;
      const key = m[1].toLowerCase();
      const val = (m[2] || '').trim();
      if (val) opts[key] = val;
    } else if (!enteringOptions){
      promptLines.push(line);
    }
  }

  if (['a','b','c','d'].filter(k=>opts[k]).length < 2){
    const body = lines.join(' ');
    const inlineRe = /([A-Da-d])\s*[.\):\-]\s*([^A-Da-d]+?)(?=(?:\s+[A-Da-d]\s*[.\):\-]\s*)|$)/g;
    let m, seen = {};
    while ((m = inlineRe.exec(body)) !== null){
      const key = m[1].toLowerCase();
      const val = (m[2] || '').trim();
      if (val && !seen[key]) { opts[key] = val; seen[key] = true; }
    }
    if (promptLines.length === 0){
      const firstA = body.search(/[A-Da-d]\s*[.\):\-]\s*/);
      if (firstA > 0) promptLines = [ body.slice(0, firstA).trim() ];
    }
  }

  return { prompt: (promptLines.join('\n').trim()) || '', options: opts };
}
function derivePromptFromText(questionText){
  const clean = (questionText || "")
    .replace(/<br\s*\/?/gi, '\n')
    .replace(/&amp;amp;lt;\/?[^&amp;amp;gt]+&amp;amp;gt;/g,'')
    .replace(/<\/?[^>]+>/g, '')
    .trim();
  const split = clean.split(/\n\s*[A-Da-d]\s*[.\):\-]\s*/);
  return (split[0] || "").trim();
}

/* ---------- REGULAR tampil & nilai ---------- */
let __currentAnsKey = null;

function getQuestionById(id){
  const qReg=(regularQuestions||[]).find(q=>q.id===id);
  const qTO =(takeoverQuestions||[]).find(q=>q.id===id);
  return qReg||qTO||null;
}
function showQuestionIndex(idx){
  const cs=boardCells[idx];
  if(!cs || cs.type!=="regular" || cs.dead || cs.answered) return;
  currentCell=idx;

  const q=getQuestionById(cs.questionId);
  if(!q){
    showPopup("Soal tidak ditemukan!");
    cs.type='open'; cs.questionId=undefined; cs.text="";
    if (regIndex>0) regIndex -= 1;
    boardLocked=false; currentCell=null;
    saveState(); renderBoard();
    return;
  }

  const ansKey=(q&&q.ans)?String(q.ans).toLowerCase():null;
  __currentAnsKey = ansKey;

  const questionText = cs.text || q.text || "";
  const {prompt, options}=extractPromptAndOptions(questionText);

  const qt=document.getElementById("questionText");
  const answersArea=document.getElementById("answersArea");
  answersArea.innerHTML="";

  let finalPrompt = (prompt && prompt.trim()) ? prompt : derivePromptFromText(questionText);
  finalPrompt = finalPrompt || "Pertanyaan";

  const keys=['a','b','c','d'].filter(k => options[k]);
  if(keys.length === 0){
    showPopup("Pilihan ganda tidak ditemukan. Soal dilewati.");
    cs.type='open'; cs.questionId=undefined; cs.text="";
    if (regIndex>0) regIndex -= 1;
    boardLocked=false; currentCell=null;
    saveState(); renderBoard();
    return;
  }

  qt.innerText = finalPrompt;
  keys.forEach(k=>{
    const btn=document.createElement('button');
    btn.className='answer-btn';
    btn.innerText=`${k.toUpperCase()}. ${options[k]}`;
    btn.onclick=()=>handleAnswerChoiceRegular(k, ansKey);
    answersArea.appendChild(btn);
  });

  document.getElementById("questionBox").classList.remove("hidden");
  boardLocked=true; renderBoard();

  // Answer timer 5s REGULAR
  timerPrepare('answer', 5, ()=>{
    if(!activeTeam){ showPopup("Pilih tim aktif dulu."); return; }
    playSfx('wrong');
    wrongAnswerRegular(activeTeam, __currentAnsKey);
  });
}

function handleAnswerChoiceRegular(chosen, ansKey){
  timerStopCore();

  if(!activeTeam){ showPopup("Pilih pemain aktif dulu.", {center:true}); return; }
  if(!ansKey){ showPopup("Soal belum punya kunci jawaban.", {center:true}); return; }

  if(chosen===ansKey){
    playSfx('correct');
    markChosen(chosen, true, "answersArea");
    answerRegular(activeTeam);
  }else{
    playSfx('wrong');
    markChosen(chosen, false, "answersArea");
    wrongAnswerRegular(activeTeam, ansKey);
  }
}
function markChosen(chosen, isCorrect, containerId){
  const area=document.getElementById(containerId);
  const btn=[...area.querySelectorAll('.answer-btn')]
    .find(b=>b.innerText.trim().toLowerCase().startsWith(chosen.toLowerCase()+'.'));
  if(btn) btn.classList.add(isCorrect?'is-correct':'is-wrong');
}
function highlightCorrectButton(containerId, ansKey){
  const area=document.getElementById(containerId);
  if(!area || !ansKey) return;
  const btn=[...area.querySelectorAll('.answer-btn')]
    .find(b=>b.innerText.trim().toLowerCase().startsWith(ansKey.toLowerCase()+'.'));
  if(btn) btn.classList.add('is-correct');
}
function answerRegular(teamKey){
  timerStopCore();

  if(currentCell===null) return;
  const cs=boardCells[currentCell];
  if(!cs || cs.type!=="regular" || cs.dead) return;

  const points=(cs.attempts===0)?10:5;
  cs.team=teamKey; cs.points=points; cs.answered=true;
  teams[teamKey].score+=points;

  updateScores(); saveState(); renderBoard();
  showPopup(`${teams[teamKey].name} +${points} poin`, {center:true});
  checkBingo(teamKey);

  awaitOperatorClickTo(()=>{
    boardLocked=false; 
    currentCell=null; 
    document.getElementById("questionBox").classList.add("hidden");
    renderBoard();
    maybeStartTakeover();
  });
}
function wrongAnswerRegular(teamKey, ansKey){
  if(currentCell===null) return;
  const cs=boardCells[currentCell];
  if(!cs || cs.type!=="regular" || cs.dead) return;

  const penalty=(cs.attempts===0)?-5:-2;
  teams[teamKey].score+=penalty;

  cs.attempts+=1;
  const nowDead = (cs.attempts>=2);
  if(nowDead){ cs.dead=true; }

  updateScores(); saveState(); renderBoard();
  showPopup(`${teams[teamKey].name} ${penalty} poin`, {center:true});

  if(nowDead){
    highlightCorrectButton("answersArea", ansKey);

    awaitOperatorClickTo(()=>{
      boardLocked=false; 
      currentCell=null; 
      document.getElementById("questionBox").classList.add("hidden");
      renderBoard();
      maybeStartTakeover();
    });
    return;
  }

  timerPrepare('steal', 10, ()=>{
    const cs2=boardCells[currentCell];
    if(cs2){ cs2.dead=true; }
    highlightCorrectButton("answersArea", ansKey);
    showPopup("⏳ Waktu rebut habis — soal hangus.");
    awaitOperatorClickTo(()=>{
      boardLocked=false; currentCell=null; document.getElementById("questionBox").classList.add("hidden");
      renderBoard(); maybeStartTakeover();
    });
  });
}

/* ---------- Reassign ---------- */
function reassignAnswerPrompt(){
  reassignMode=true; alert("🔁 Klik pertanyaan REGULAR yang sudah dijawab untuk direassign.");
}
function handleReassignDOM(cellDiv){
  if(!reassignMode) return;
  const idx=parseInt(cellDiv.dataset.index,10);
  const cs=boardCells[idx];
  if(!cs || cs.type!=='regular' || !cs.answered || cs.dead){
    alert("Hanya REGULAR yang sudah dijawab & belum hangus yang bisa direassign.");
    reassignMode=false; return;
  }
  const prev=cs.team, pts=cs.points||0;
  const newTeam=prompt("Masukkan huruf tim (A/B/C/D):")?.toUpperCase();
  if(!teams[newTeam]){ alert("❌ Tim tidak valid."); reassignMode=false; return; }
  if(prev && prev!==newTeam){
    teams[prev].score-=pts; teams[newTeam].score+=pts; cs.team=newTeam;
    updateScores(); saveState(); renderBoard();
    showPopup(`Reassign: ${pts} poin pindah ke ${teams[newTeam].name}`, {center:true});
    checkBingo(newTeam);
  }
  reassignMode=false;
}

/* ---------- Bingo ---------- */
function checkBingo(teamKey){
  const rows = Array.from({length:5}, (_,r)=>boardCells.slice(r*5,(r+1)*5).map(c=>c.idx));
  const cols = Array.from({length:5}, (_,c)=>[0,1,2,3,4].map(r=>r*5+c));
  const diag1 = [0,6,12,18,24];
  const diag2 = [4,8,12,16,20];
  const hasTeamIdx = idx => boardCells[idx].team === teamKey;

  const winningLines = []
    .concat(rows, cols, [diag1, diag2])
    .filter(line => line.every(hasTeamIdx));

  if (winningLines.length === 0) return;

  bingoHappened=true;

  const winSet = new Set(winningLines.flat());
  boardCells.forEach(c=>{
    if (winSet.has(c.idx)) {
      c.bingoWin = true;
      c.team = teamKey;
    }
  });

  const winnerName = teams[teamKey]?.name || `Tim ${teamKey}`;
  showPopup(`🎉 BINGO! Selamat ${winnerName} lanjut ke final`, {sticky:true});

  timerReset();
  mode="ended"; saveState(); renderBoard();
  document.getElementById("takeoverBox").classList.add("hidden");
}

/* ---------- Regular → Takeover ---------- */
function maybeStartTakeover(){
  if(bingoHappened||mode!=="regular") return;
  const already=(boardCells||[]).filter(c=>c.type==='regular').length;
  const quota=(regularQuestions?.length||20);
  const openIdx=boardCells.filter(c=>c.type==='open').map(c=>c.idx);
  const shouldSwitch=(already>=quota) && (openIdx.length===5);
  if(!shouldSwitch) return;

  openIdx.forEach((i, j)=>{
    const cs=boardCells[i];
    cs.type='takeover';
    const tq = takeoverQuestions[j];
    if (tq){
      cs.questionId = tq.id;
      cs.text = tq.text || "";
    } else {
      cs.questionId = undefined;
      cs.text = "";
    }
  });

  takeoverQueue=openIdx.slice(0, Math.min(openIdx.length, takeoverQuestions.length||openIdx.length));
  takeoverIndex=0;
  mode="takeover"; 
  timerReset();
  saveState();

  document.getElementById("questionBox").classList.add("hidden");
  document.getElementById("takeoverBox").classList.remove("hidden");

  hideLegacyTOButtons();

  renderBoard(); renderTakeover();
}

/* ---------- Takeover (REGULAR & FINAL) ---------- */
function skipTakeover(reason){
  timerStopCore();

  const cellIdx=takeoverQueue[takeoverIndex];
  const cs=boardCells[cellIdx];
  if (cs){ cs.answered=false; cs.dead=true; cs.team=""; cs.points=0; }
  showPopup(reason||"Soal TO dilewati.", {center:true});
  saveState(); renderBoard();

  awaitOperatorClickTo(()=>{
    takeoverIndex+=1;
    renderTakeover();
  });
}
function renderTakeover(){
  if(mode!=="takeover") return;
  const total=takeoverQueue.length, i=takeoverIndex;
  if(i>=total){ endRoundNoBingo(); return; }

  const cellIdx=takeoverQueue[i];
  const cs=boardCells[cellIdx];

  let q = (cs && cs.questionId) ? getQuestionById(cs.questionId) : (takeoverQuestions[i] || null);
  if(!q){ skipTakeover("Soal TO tidak ditemukan."); return; }

  const ansKey=(q&&q.ans)?String(q.ans).toLowerCase():null;
  const qText = (cs && cs.text) ? cs.text : (q.text||"");
  const {prompt,options}=extractPromptAndOptions(qText);

  let finalPrompt = (prompt && prompt.trim()) ? prompt : derivePromptFromText(qText);
  if(!finalPrompt && Object.keys(options).length===0){ skipTakeover("Soal TO kosong."); return; }

  const ttl = document.getElementById('takeoverTitle');
  const prog = document.getElementById('takeoverProgress');
  if (ttl) ttl.innerText = 'Take Over Round';
  if (prog) prog.innerText = `Take Over: ${i+1}/${total}`;

  document.getElementById("takeoverText").innerText=finalPrompt || `Take Over: #${i+1}`;

  const answersArea=document.getElementById("toAnswersArea");
  answersArea.innerHTML="";
  const keys=['a','b','c','d'].filter(k=>options[k]);
  if(keys.length===0){ skipTakeover("Pilihan TO tidak ditemukan."); return; }

  hideLegacyTOButtons();

  keys.forEach(k=>{
    const btn=document.createElement('button');
    btn.className='answer-btn';
    btn.innerText=`${k.toUpperCase()}. ${options[k]}`;
    btn.onclick=()=>{
      timerStopCore();

      if(!activeTeam){ showPopup("Pilih pemain aktif dulu.", {center:true}); return; }
      if(!ansKey){ showPopup("Soal TO belum punya kunci.", {center:true}); return; }
      if(k===ansKey){
        playSfx('correct');
        markChosen(k, true, "toAnswersArea");
        answerTakeover(activeTeam);
      }else{
        playSfx('wrong');
        markChosen(k, false, "toAnswersArea");
        highlightCorrectButton("toAnswersArea", ansKey);
        wrongTakeover(activeTeam, ansKey);
      }
    };
    answersArea.appendChild(btn);
  });

  // Timer TO 5s
  timerPrepare('to', 5, ()=>{
    if(!activeTeam){ showPopup("Pilih pemain aktif dulu."); return; }
    const pen=-10; teams[activeTeam].score+=pen;

    const cellIdx2=takeoverQueue[takeoverIndex];
    const cs2=boardCells[cellIdx2];
    if(cs2){ cs2.answered=false; cs2.dead=true; cs2.team=""; cs2.points=0; }

    saveState(); renderBoard();
    highlightCorrectButton("toAnswersArea", ansKey);
    showPopup(`${teams[activeTeam].name} ${pen} poin`, {center:true});

    awaitOperatorClickTo(()=>{ takeoverIndex+=1; renderTakeover(); });
  });

  renderBoard();
}
function answerTakeover(teamKey){
  timerStopCore();

  if(mode!=="takeover"||!teams[teamKey]) return;
  const pts=20;
  teams[teamKey].score+=pts;

  const cellIdx=takeoverQueue[takeoverIndex];
  const cs=boardCells[cellIdx];
  if(cs){ cs.answered=true; cs.dead=false; cs.team=teamKey; cs.points=pts; }

  updateScores(); showPopup(`${teams[teamKey].name} +${pts} poin`, {center:true});
  checkBingo(teamKey); // Final TETAP menilai bingo sesuai engine
  saveState(); renderBoard();

  awaitOperatorClickTo(()=>{
    takeoverIndex+=1;
    renderTakeover();
  });
}
function wrongTakeover(teamKey, ansKey){
  timerStopCore();

  if(mode!=="takeover"||!teams[teamKey]) return;
  const pen=-10; teams[teamKey].score+=pen;

  const cellIdx=takeoverQueue[takeoverIndex];
  const cs=boardCells[cellIdx];
  if(cs){ cs.answered=false; cs.dead=true; cs.team=""; cs.points=0; }

  updateScores(); showPopup(`${teams[teamKey].name} ${pen} poin`, {center:true});
  saveState(); renderBoard();

  awaitOperatorClickTo(()=>{
    takeoverIndex+=1;
    renderTakeover();
  });
}

/* ---------- End round ---------- */
function endRoundNoBingo(){
  mode="ended"; 
  timerReset();
  saveState(); renderBoard();
  document.getElementById("takeoverBox").classList.add("hidden");

  const standings=[
    {k:'A',name:teams.A.name,score:teams.A.score},
    {k:'B',name:teams.B.name,score:teams.B.score},
    {k:'C',name:teams.C.name,score:teams.C.score},
    {k:'D',name:teams.D.name,score:teams.D.score}
  ].sort((a,b)=>b.score-a.score);

  showPopup(`🏁 Selesai! Peringkat 1: ${standings[0].name} skor ${standings[0].score}`, {sticky:true});
}

/* ---------- Scoreboard ---------- */
function setActiveTeam(k){ if(!teams[k]) return; activeTeam=k; updateScores(); saveState(); }
function updateScores(){
  const a=document.getElementById("scoreA"), b=document.getElementById("scoreB"), c=document.getElementById("scoreC"), d=document.getElementById("scoreD");
  if(!a||!b||!c||!d) return;
  a.innerText=`Tim A (${teams.A.name}): ${teams.A.score}`;
  b.innerText=`Tim B (${teams.B.name}): ${teams.B.score}`;
  c.innerText=`Tim C (${teams.C.name}): ${teams.C.score}`;
  d.innerText=`Tim D (${teams.D.name}): ${teams.D.score}`;
  a.classList.add('teamA'); b.classList.add('teamB'); c.classList.add('teamC'); d.classList.add('teamD');
  [['A',a],['B',b],['C',c],['D',d]].forEach(([k,el])=>{ el.classList.toggle('active',activeTeam===k); el.onclick=()=>setActiveTeam(k); el.title="Klik untuk pilih pemain aktif"; });
}

/* ---------- Admin helpers ---------- */
function resetEvent(){
  const sid=document.getElementById("sessionId")?.value?.trim(); if(!sid) return alert("Isi Session ID dulu.");
  localStorage.removeItem(eventKey(sid)); 
  for(let r=1;r<=4;r++){ localStorage.removeItem(roundStateKey(sid,r)); }
  localStorage.removeItem(roundStateKey(sid,'final')); // bersihkan round final juga
  alert("Event di-reset. Pool akan dibuat ulang setelah Start Game/Start Final.");
}
function nextRound(){
  const sid=document.getElementById("sessionId")?.value?.trim(); if(!sid) return alert("Isi Session ID dulu.");
  eventId=sid;
  try{
    const draw=drawNextRound(eventId);
    roundNo=draw.roundNo; regularQuestions=draw.regular20; takeoverQuestions=draw.takeover5;
    for(let t in teams) teams[t].score=0;
    mode="regular"; bingoHappened=false; currentCell=null; reassignMode=false; regIndex=0; boardLocked=false; activeTeam='A';
    generateBoard(); saveState(); updateScores(); renderBoard();
    timerReset();
    document.getElementById("takeoverBox").classList.add("hidden");
    showPopup(`➡️ Babak ${roundNo} dimulai.`, {center:true});
  }catch(e){ alert(e.message||"Tidak bisa lanjut babak: "+(e?.message||e)); }
}

/* ---------- Legacy TO buttons helper ---------- */
function hideLegacyTOButtons(){
  const m = document.getElementById('legacyTOButtons');
  if (m) m.style.display = 'none';
}

/* ---------- SFX ---------- */
let __audioCtx=null;
function _ensureAudioCtx(){ 
  if(!__audioCtx){ 
    const Ctx=window.AudioContext||window.webkitAudioContext; 
    if(!Ctx) return null; 
    __audioCtx=new Ctx(); 
  } 
  if(__audioCtx.state==='suspended'){ __audioCtx.resume().catch(()=>{});} 
  return __audioCtx; 
}
function playSfx(kind){
  const ctx=_ensureAudioCtx(); if(!ctx) return;
  if(kind==='correct'){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='triangle'; o.frequency.setValueAtTime(660,ctx.currentTime); o.frequency.linearRampToValueAtTime(990,ctx.currentTime+0.22);
    g.gain.setValueAtTime(0.0001,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.25,ctx.currentTime+0.01); g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.25);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.26);
  }else if(kind==='wrong'){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type='square'; o.frequency.setValueAtTime(120,ctx.currentTime);
    g.gain.setValueAtTime(0.25,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.35);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.36);
  }
}
function playTimerTick(){
  const ctx=_ensureAudioCtx(); if(!ctx) return;
  const o=ctx.createOscillator(), g=ctx.createGain();
  o.type='sine'; o.frequency.setValueAtTime(880, ctx.currentTime);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.15);
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.18);
}
function playTimerEnd(){
  const ctx=_ensureAudioCtx(); if(!ctx) return;
  const o=ctx.createOscillator(), g=ctx.createGain();
  o.type='sawtooth'; o.frequency.setValueAtTime(220, ctx.currentTime);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.35);
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.36);
}

/* ---------- Timer Dock positioning ---------- */
let __timerDockBaseline = null;
function __isHidden(el){ return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none'; }
function __computeTimerScaleFrom(cellWidth){
  const base = 80;
  let f = (cellWidth || base) / base;
  return Math.max(0.85, Math.min(1.35, f));
}
function __applyTimerScaleWith(cellWidth){
  const f = __computeTimerScaleFrom(cellWidth);
  const root = document.documentElement;
  const remPx = parseFloat(getComputedStyle(root).fontSize) || 16;

  const baseW = 130, baseH = 92, gap = 12;
  const baseNumRem = 1.8, baseTitleRem = 0.9;

  root.style.setProperty('--timer-card-minw', `${Math.round(baseW * f)}px`);
  root.style.setProperty('--timer-card-minh', `${Math.round(baseH * f)}px`);
  root.style.setProperty('--timer-gap', `${Math.round(gap * f)}px`);
  root.style.setProperty('--timer-number-size', `${(baseNumRem * remPx * f).toFixed(0)}px`);
  root.style.setProperty('--timer-title-size', `${(baseTitleRem * remPx * f).toFixed(0)}px`);
}
function lockTimerDockBaseline(){
  const board = document.getElementById('gameBoard');
  const qb = document.getElementById('questionBox');
  const tob = document.getElementById('takeoverBox');
  if(!board) return;
  if (!__isHidden(qb) || !__isHidden(tob)) return;

  const r = board.getBoundingClientRect();
  const firstCell = document.querySelector('#gameBoard .cell');
  const cw = firstCell ? firstCell.getBoundingClientRect().width : 80;

  __timerDockBaseline = { top: r.top, right: r.right, cellWidth: cw };
}
function positionTimerDock(){
  const dock  = document.getElementById('timerDock');
  const board = document.getElementById('gameBoard');
  if(!dock || !board) return;

  if(!__timerDockBaseline) lockTimerDockBaseline();
  if(!__timerDockBaseline) return;

  const marginRight = 16;

  __applyTimerScaleWith(__timerDockBaseline.cellWidth);

  dock.classList.remove('stack-vert');
  dock.style.visibility = 'hidden';
  dock.style.left = '-9999px';
  dock.style.top  = '-9999px';

  requestAnimationFrame(()=>{
    const dRect2col = dock.getBoundingClientRect();
    const freeRight = window.innerWidth - (__timerDockBaseline.right + marginRight) - 8;
    if (dRect2col.width > freeRight) dock.classList.add('stack-vert');

    const dRect = dock.getBoundingClientRect();
    dock.style.visibility = 'visible';

    let left = __timerDockBaseline.right + marginRight;
    let top  = __timerDockBaseline.top + (board.getBoundingClientRect().height/2) - (dRect.height/2);

    left = Math.min(left, window.innerWidth - dRect.width - 8);
    top  = Math.max(8, Math.min(top, window.innerHeight - dRect.height - 8));

    dock.style.left = `${left}px`;
    dock.style.top  = `${top}px`;
  });
}
window.addEventListener('scroll', positionTimerDock, { passive:true });
window.addEventListener('resize', ()=>{
  __timerDockBaseline = null;
  requestAnimationFrame(()=>{ lockTimerDockBaseline(); positionTimerDock(); });
}, { passive:true });

const __rb_base = renderBoard;
renderBoard = function(){
  __rb_base.apply(this, arguments);
  requestAnimationFrame(()=>{
    lockTimerDockBaseline();
    positionTimerDock();
  });
};

const __rto_base = renderTakeover;
renderTakeover = function(){
  __rto_base.apply(this, arguments);
  requestAnimationFrame(positionTimerDock);
};

const __sqi_base = showQuestionIndex;
showQuestionIndex = function(){
  __sqi_base.apply(this, arguments);
  requestAnimationFrame(positionTimerDock);
};

const __start_base = startGame;
startGame = function(){
  __start_base.apply(this, arguments);
  requestAnimationFrame(()=>{
    __timerDockBaseline = null;
    lockTimerDockBaseline();
    positionTimerDock();
  });
};

const __next_base = nextRound;
nextRound = function(){
  __next_base.apply(this, arguments);
  requestAnimationFrame(()=>{
    __timerDockBaseline = null;
    lockTimerDockBaseline();
    positionTimerDock();
  });
};

requestAnimationFrame(()=>{ lockTimerDockBaseline(); positionTimerDock(); });

/* ---------- Expose ---------- */
window.startGame=startGame;
window.answerTakeover=answerTakeover;
window.answertakeOver=(team)=>answerTakeover(team);
window.wrongTakeover=wrongTakeover;
window.wrongtakeOver=(team)=>wrongTakeover(team);
window.reassignAnswerPrompt=reassignAnswerPrompt;
window.resetEvent=resetEvent;
window.nextRound=nextRound;

/* =========================
   === FULL ADMIN FEATURES ===
   - Mode Panitia (Ctrl+Shift+P or click .site-logo 5x)
   - Admin action on cell: Anulir, Pulihkan, Edit skor manual, Reassign (REG & TO, custom poin)
   - Auto recalculasi Bingo setiap perubahan
   - Tidak mengubah HTML/CSS
   ========================= */

/* ---- Admin: State & Hotkeys ---- */
let adminMode = false;
let __adminClicks = 0;
let __adminTimer = null;

function showAdminToast(){
  showPopup(adminMode ? '🛠️ MODE PANITIA AKTIF' : '🛠️ Mode Panitia NONAKTIF', {center:true});
}
function toggleAdminMode(force){
  adminMode = (typeof force==='boolean') ? !!force : !adminMode;
  showAdminToast();
}
window.toggleAdminMode = toggleAdminMode;

// Hotkey: Ctrl + Shift + P
(function(){
  document.addEventListener('keydown', (e)=>{
    if(e.ctrlKey && e.shiftKey && (e.key.toLowerCase()==='p')){
      e.preventDefault();
      toggleAdminMode();
    }
  }, true);
})();

// Gesture: klik logo 5x cepat untuk aktifkan admin
(function(){
  document.addEventListener('click', (e)=>{
    const tgt = e.target;
    if(!tgt) return;
    const isLogo = tgt.classList && tgt.classList.contains('site-logo');
    if(!isLogo) return;
    __adminClicks++;
    if(__adminTimer){ clearTimeout(__adminTimer); }
    __adminTimer = setTimeout(()=>{ __adminClicks=0; }, 1000);
    if(__adminClicks>=5){
      __adminClicks=0;
      toggleAdminMode(true);
    }
  }, true);
})();

/* ---- Admin: Bingo Recalc ---- */
function _recalcBingoAll(){
  if(!Array.isArray(boardCells)) return;
  boardCells.forEach(c=>{ c.bingoWin = false; });
  const lines = [
    ...Array.from({length:5}, (_,r)=>boardCells.slice(r*5,(r+1)*5).map(c=>c.idx)), // rows
    ...Array.from({length:5}, (_,c)=>[0,1,2,3,4].map(r=>r*5+c)),                  // cols
    [0,6,12,18,24], [4,8,12,16,20]                                               // diags
  ];
  const teamsKeys = ['A','B','C','D'];
  for(const tk of teamsKeys){
    for(const line of lines){
      if(line.every(i => boardCells[i].team === tk)){
        line.forEach(i => boardCells[i].bingoWin = true);
      }
    }
  }
}

/* ---- Admin: Anulir / Pulihkan / Reassign ---- */
function annulCell(idx){
  const cs = boardCells[idx];
  if(!cs) { showPopup('Sel tidak ditemukan', {center:true}); return false; }
  // rollback skor bila ada
  if(cs.answered && cs.team && cs.points){
    const t = cs.team; if(teams[t]) teams[t].score -= (cs.points||0);
  }
  cs.dead = true;
  cs.answered = false;
  cs.team = '';
  cs.points = 0;
  _recalcBingoAll();
  saveState(); updateScores(); renderBoard();
  showPopup('❌ Soal dianulir', {center:true});
  return true;
}
function restoreCell(idx){
  const cs = boardCells[idx];
  if(!cs) { showPopup('Sel tidak ditemukan', {center:true}); return false; }
  cs.dead = false;
  cs.answered = false;
  cs.team = '';
  cs.points = 0;
  _recalcBingoAll();
  saveState(); updateScores(); renderBoard();
  showPopup('🔄 Soal dipulihkan', {center:true});
  return true;
}
function reassignCell(idx, newTeam, newPoints){
  const cs = boardCells[idx];
  if(!cs) { showPopup('Sel tidak ditemukan', {center:true}); return false; }
  if(!cs.answered){ showPopup('Sel belum dijawab, tidak bisa reassign.', {center:true}); return false; }
  if(!teams[newTeam]){ showPopup('Tim tidak valid.', {center:true}); return false; }
  const prevTeam = cs.team || '';
  const prevPts  = cs.points || 0;
  const useCustom = (typeof newPoints==='number' && !Number.isNaN(newPoints));
  const nextPts   = useCustom ? newPoints : prevPts;
  if(prevTeam && teams[prevTeam]) teams[prevTeam].score -= prevPts;
  cs.team = newTeam;
  cs.points = nextPts;
  teams[newTeam].score += nextPts;
  _recalcBingoAll();
  saveState(); updateScores(); renderBoard();
  showPopup(`✅ Reassign ke ${teams[newTeam].name} ${useCustom?`(${nextPts} poin)`: `(+${nextPts} poin)`}`, {center:true});
  return true;
}

/* ---- Admin: Interceptor klik cell ---- */
(function(){
  document.addEventListener('click', (e)=>{
    if(!adminMode) return;
    const cell = e.target && (e.target.closest ? e.target.closest('.cell') : null);
    if(!cell) return;
    e.stopPropagation();
    e.preventDefault();
    const idx = parseInt(cell.dataset.index, 10);
    if(Number.isNaN(idx)) return;
    const cs = boardCells[idx];
    const meta = `#${idx+1} | tipe:${cs?.type||'-'} | dead:${cs?.dead?'Y':'N'} | team:${cs?.team||'-'} | poin:${cs?.points||0}`;
    const choice = prompt(
      `== PANEL PANITIA ==\n${meta}\n\n`+
      `Ketik:\n`+
      `1 = Anulir (abu)\n`+
      `2 = Pulihkan\n`+
      `3 = Edit skor tim (manual)\n`+
      `4 = Reassign ke tim lain (REG/TO)\n`+
      `Lainnya = batal`
    );
    if(choice==='1'){
      annulCell(idx);
    }else if(choice==='2'){
      restoreCell(idx);
    }else if(choice==='3'){
      const t = (prompt('Tim mana? (A/B/C/D)')||'').toUpperCase().trim();
      if(!teams[t]){ alert('Tim tidak valid'); return; }
      const delta = parseInt((prompt('Masukkan perubahan skor (boleh negatif). Contoh: 5 atau -5')||'').trim(),10);
      if(Number.isNaN(delta)){ alert('Angka tidak valid'); return; }
      teams[t].score += delta;
      saveState(); updateScores(); renderBoard();
      showPopup(`🧮 Koreksi skor ${teams[t].name}: ${delta>0?'+':''}${delta} poin`, {center:true});
    }else if(choice==='4'){
      if(!cs.answered){ alert('Sel belum dijawab.'); return; }
      const t = (prompt('Tim baru? (A/B/C/D)')||'').toUpperCase().trim();
      if(!teams[t]){ alert('Tim tidak valid'); return; }
      const npStr = prompt(`Poin baru (opsional). ENTER=pakai ${cs.points||0}`);
      let newPts = Number.NaN;
      if(npStr && npStr.trim()!==''){
        const parsed = parseInt(npStr,10);
        if(Number.isNaN(parsed)){ alert('Angka tidak valid'); return; }
        newPts = parsed;
      }
      reassignCell(idx, t, newPts);
    }
  }, true);
})();

