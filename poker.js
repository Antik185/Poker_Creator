'use strict';

// ═══════════════════════════════════════════════════════
//  CONFIGURATION  (edit this to brand your room)
// ═══════════════════════════════════════════════════════
const CFG = {
  brand: 'STACKROOM',
  brandLetter: 'S',
  logoUrl: null,        // will be set if operator uploads a logo
  feltType: 'color',   // 'color' | 'photo'
  feltC1:'#35c955', feltC2:'#28a842', feltC3:'#1e8a35', feltC4:'#146025',
  feltPhotoUrl: null,
  feltOverlay: 40,
  feltZoom: 130,
  feltPanX: 0, feltPanY: 0,
  logoPos: 'top-left',   // top-left | top-center | top-right
  logoSize: 38,
  tableLogoVisible: true,
  reactions: ['🎰','💸','🔥','🐸','💀','👑','🚀'],
  sb: 0.05,
  bb: 0.10,
  startStack: 10.00,
};

// Avatar pool — paths relative to poker.html (which is in e:\pokerRoom\)
const AVATARS = [
  'avatars/ca542146e6540e535ca26a65dac45d3a.png',
  'avatars/8d38a5b8f7b789ee09c0b8bbce7ec57a.png',
  'avatars/f38f10dce6b953ccbd55d6019f0850e7.png',
  'avatars/70fc7b922b62f1dc10a4525742cd6568.png',
  'avatars/a76faaf75b6381bf141dd719f325be43.png',
  'avatars/fabc06a478a72e2ad7c3e9a37e295d60.png',
];

const BOT_NAMES = [
  {name:'Coffee_Time',  flag:'🇱🇻', ava:0},
  {name:'DlmaDIDlma',  flag:'🇷🇺', ava:1},
  {name:'CallDeFarol1',flag:'🇦🇷', ava:2},
  {name:'sdszfyzc',    flag:'🇨🇳', ava:3},
  {name:'faker77777',  flag:'🇨🇳', ava:5},
];

// ═══════════════════════════════════════════════════════
//  DECK / HAND UTILS
// ═══════════════════════════════════════════════════════
function makeDeck(){
  const S=['♠','♥','♦','♣'], V=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const d=[];
  S.forEach(s=>V.forEach(v=>d.push({v,s})));
  return d;
}
function shuffle(d){
  for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
  return d;
}
function cardColor(c){return c.s==='♥'||c.s==='♦'?'r':'b';}

// ═══════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════
const G = {
  seats: Array(6).fill(null),
  deck: [],
  board: [],
  pot: 0,
  currentBet: 0,
  phase: 'WAITING',
  dealerSeat: 0,
  actingSeat: -1,
  userSeat: -1,
  handNum: 0,
  botTimers: [],
};

// ─── Animation tracking (reset each hand) ───────────────
const ANIM = {
  boardShown: 0,     // how many board cards have been animated already
  seatCards: new Set(), // seat indices whose hole cards have been animated
  reset(){ this.boardShown=0; this.seatCards.clear(); }
};

function activePlayers(){ return G.seats.filter(s=>s&&s.inHand); }
function nextSeat(from){
  let i=(from+1)%6;
  while(i!==from){if(G.seats[i]&&G.seats[i].inHand&&G.seats[i].stack>0)return i;i=(i+1)%6;}
  return G.seats[from]&&G.seats[from].inHand&&G.seats[from].stack>0 ? from : -1;
}
function nextSeatAny(from){
  let i=(from+1)%6;
  while(i!==from){if(G.seats[i]&&G.seats[i].inHand)return i;i=(i+1)%6;}
  return from;
}

// ═══════════════════════════════════════════════════════
//  ACTION ENGINE
// ═══════════════════════════════════════════════════════
function doAction(seatIdx, action, raiseAmt){
  if(G.phase==='WAITING'||G.phase==='SHOWDOWN') return;
  if(seatIdx!==G.actingSeat) return;
  const p=G.seats[seatIdx];
  clearBotTimers();
  p.lastAction='';

  if(action==='fold'){
    speak('Fold');
    G.actingSeat = -1; // Prevent duplicate actions during animation
    doFoldAnim(seatIdx, ()=>{
      p.inHand=false; p.lastAction='FOLD'; p.cards=[];
      ANIM.seatCards.delete(seatIdx);
      afterAction(seatIdx);
    });
    return;
  } else if(action==='call'){
    const toCall=Math.min(G.currentBet - p.bet, p.stack);
    p.stack-=toCall; p.bet+=toCall; G.pot+=toCall;
    p.lastAction= toCall===0 ? 'CHECK' : 'CALL';
    if(p.stack===0) { p.lastAction='ALL-IN'; speak('All in'); }
    else speak(p.lastAction==='CHECK'?'Check':'Call');
  } else if(action==='check'){
    p.lastAction='CHECK';
    speak('Check');
  } else if(action==='raise'){
    const totalBet = G.currentBet + raiseAmt;
    const toAdd = Math.min(totalBet - p.bet, p.stack);
    p.stack-=toAdd; p.bet+=toAdd; G.pot+=toAdd;
    G.currentBet = p.bet;
    p.lastAction='RAISE';
    if(p.stack===0) { p.lastAction='ALL-IN'; speak('All in'); }
    else speak('Raise');
    G.seats.forEach((s,i)=>{ if(s&&s.inHand&&i!==seatIdx&&s.stack>0) s.acted=false; });
  }
  p.acted=true;
  afterAction(seatIdx);
}

function afterAction(seatIdx){
  const ap = activePlayers();
  if(ap.length<=1){
    setTimeout(endHand, 1200);
    return;
  }
  if(roundOver()){
    setTimeout(advancePhase, 700);
  } else {
    G.actingSeat = nextSeat(seatIdx);
    scheduleBot();
  }
  renderTable();
}

function roundOver(){
  const active = G.seats.filter(s=>s&&s.inHand);
  for(const p of active){
    if(p.stack===0) continue; // all-in, skip
    if(!p.acted) return false;
    if(p.bet < G.currentBet) return false; // still needs to call
  }
  return true;
}

function advancePhase(){
  G.seats.forEach(s=>{ if(s){ s.bet=0; s.acted=false; s.lastAction=''; } });
  G.currentBet=0;
  const ap=activePlayers();
  if(ap.length<=1){ endHand(); return; }

  if(G.phase==='PREFLOP'){
    G.phase='FLOP';
    G.board.push(G.deck.pop(),G.deck.pop(),G.deck.pop());
  } else if(G.phase==='FLOP'){
    G.phase='TURN'; G.board.push(G.deck.pop());
  } else if(G.phase==='TURN'){
    G.phase='RIVER'; G.board.push(G.deck.pop());
  } else if(G.phase==='RIVER'){
    G.phase='SHOWDOWN'; endHand(); return;
  }

  // Fast forward if everyone is all-in or only one player has money
  const canBet = ap.filter(p=>p.stack>0);
  if(canBet.length <= 1) {
    G.actingSeat = -1;
    renderTable();
    setTimeout(advancePhase, 1500);
    return;
  }

  // set first to act (left of dealer)
  G.actingSeat = nextSeat(G.dealerSeat);
  renderTable();
  scheduleBot();
}

function endHand(){
  G.phase='SHOWDOWN';
  const ap = activePlayers();
  // Simple winner selection: random if no evaluation, else whoever's left
  const winner = ap[Math.floor(Math.random()*ap.length)];
  const won = G.pot;
  winner.stack += won;
  G.pot=0;
  renderTable();
  showWin(winner.name, won);
  setTimeout(startHand, 3200);
}

function startHand(){
  G.handNum++;
  G.deck = shuffle(makeDeck());
  G.board = [];
  G.pot = 0;
  G.currentBet = 0;
  ANIM.reset(); // ← reset animation tracking each new hand
  clearBotTimers();
  hideWin();

  let active=0;
  G.seats.forEach(s=>{
    if(s){ s.inHand=s.stack>0; s.bet=0; s.acted=false; s.lastAction=''; s.cards=[]; if(s.inHand)active++; }
  });
  if(active<2){ G.phase='WAITING'; renderTable(); return; }

  let d=(G.dealerSeat+1)%6;
  while(!G.seats[d]||!G.seats[d].inHand) d=(d+1)%6;
  G.dealerSeat=d;

  G.seats.forEach(s=>{ if(s&&s.inHand) s.cards=[G.deck.pop(),G.deck.pop()]; });

  const sbIdx = nextSeat(G.dealerSeat);
  const bbIdx = nextSeat(sbIdx);
  postBlind(sbIdx, CFG.sb);
  postBlind(bbIdx, CFG.bb);
  G.currentBet = CFG.bb;
  G.seats[sbIdx].acted=false;
  G.seats[bbIdx].acted=false;

  G.phase='PREFLOP';
  G.actingSeat = nextSeat(bbIdx);

  renderTable();
  scheduleBot();
}

function postBlind(idx, amt){
  const p=G.seats[idx];
  if(!p) return;
  const a=Math.min(amt,p.stack);
  p.stack-=a; p.bet+=a; G.pot+=a;
}

// ═══════════════════════════════════════════════════════
//  FOLD ANIMATION HELPER
// ═══════════════════════════════════════════════════════
function doFoldAnim(seatIdx, callback) {
  const seatEl = document.querySelector(`[data-seat="${seatIdx}"]`);
  if (!seatEl) { callback(); return; }
  const cards = seatEl.querySelector('.pk-cards');
  if (cards) {
    cards.querySelectorAll('.pk-card').forEach((c, ci) => {
      c.style.animationDelay = (ci * 0.06) + 's';
      c.classList.remove('no-anim');
      c.classList.add('fold-anim');
    });
    setTimeout(callback, 480);
  } else {
    callback();
  }
}
// ═══════════════════════════════════════════════════════
//  VOICE / SOUND UTILS
// ═══════════════════════════════════════════════════════
function speak(text){
  if(typeof SpeechSynthesisUtterance === 'undefined') return;
  if(isMuted || masterVolume === 0) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 1.1;
  u.pitch = 1.0;
  u.volume = masterVolume;
  window.speechSynthesis.speak(u);
}
// ═══════════════════════════════════════════════════════
//  BOT LOGIC
// ═══════════════════════════════════════════════════════
function clearBotTimers(){ G.botTimers.forEach(clearTimeout); G.botTimers=[]; }

function scheduleBot(){
  if(G.actingSeat<0) return;
  const p=G.seats[G.actingSeat];
  if(!p||!p.isBot||!p.inHand) return;
  const delay = 2500+Math.random()*2000;
  const t = setTimeout(()=>{
    if(G.actingSeat<0||!G.seats[G.actingSeat]?.isBot) return;
    const toCall = G.currentBet - p.bet;
    const r = Math.random();
    if(toCall <= 0) {
      if(r < 0.15) doAction(G.actingSeat, 'raise', CFG.bb * 2);
      else doAction(G.actingSeat, 'check');
    } else {
      if(r < 0.10) doAction(G.actingSeat, 'raise', toCall * 2);
      else if(r < 0.35) doAction(G.actingSeat, 'fold');
      else doAction(G.actingSeat, 'call');
    }
  }, delay);
  G.botTimers.push(t);
}

// ═══════════════════════════════════════════════════════
//  AUDIO ENGINE
// ═══════════════════════════════════════════════════════
let isMuted = false;
let masterVolume = 0.5;
let audioCtx = null;
function initAudio(){
  if(!audioCtx) window.AudioContext = window.AudioContext || window.webkitAudioContext;
  if(!audioCtx && window.AudioContext) audioCtx = new AudioContext();
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function playBeep(freq, type, dur, vol=0.1) {
  if(isMuted || masterVolume === 0) return;
  initAudio();
  if(!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol * masterVolume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch(e) {}
}
function toggleMute(){
  isMuted = !isMuted;
  const btn = document.getElementById('muteIconBtn');
  if(btn) btn.textContent = isMuted ? '🔇' : '🔊';
}
function changeVol(e){
  masterVolume = e.target.value / 100;
  if (masterVolume === 0) {
      isMuted = true;
      const btn = document.getElementById('muteIconBtn');
      if(btn) btn.textContent = '🔇';
  } else if (isMuted) {
      isMuted = false;
      const btn = document.getElementById('muteIconBtn');
      if(btn) btn.textContent = '🔊';
  }
}

// ═══════════════════════════════════════════════════════
//  ACTION TIMER (for user turn)
// ═══════════════════════════════════════════════════════
let timerInterval=null;
let timerMs=10000;
let lastTimerTick=0;
let lastTimerSec=-1;

function startTimer(){
  clearInterval(timerInterval);
  timerMs=10000; // 5s main + 5s extra
  lastTimerTick=Date.now();
  lastTimerSec=10;
  updateTimerUI();
  
  timerInterval=setInterval(()=>{
    const now=Date.now();
    const dt=now-lastTimerTick;
    lastTimerTick=now;
    timerMs-=dt;
    updateTimerUI();
    if(timerMs<=0){
      clearInterval(timerInterval);
      doAction(G.userSeat,'fold');
    }
  },50);
}

function stopTimer(){ clearInterval(timerInterval); setTimerBar(0,''); }

function updateTimerUI(){
  let pct = 100;
  let cls = '';
  // Out of 10s total: first 5s base time (bar full), last 5s extra time (bar shrinks)
  if(timerMs <= 5000){
    pct = Math.max(0, timerMs) / 50;
    cls = timerMs <= 3000 ? 'danger' : 'warn';
  }
  setTimerBar(pct, cls);
  
  const secLeft = Math.ceil(timerMs / 1000);
  if(secLeft !== lastTimerSec){
    if(secLeft === 5 && lastTimerSec > 5) {
      playBeep(600, 'sine', 0.15, 0.4); // Start of extra time "тыц"
    } else if (secLeft <= 3 && secLeft > 0 && lastTimerSec > secLeft) {
      playBeep(800, 'square', 0.1, 0.2); // 3, 2, 1 beeps
    }
    lastTimerSec = secLeft;
  }
}

function setTimerBar(pct, cls){
  const pt=document.getElementById('userPlateTimer');
  if(pt){ pt.style.width=pct+'%'; pt.className='pk-plate-timer'+(cls?' '+cls:''); }
}

// ═══════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════

// 6-seat positions around the oval table
// Clockwise: 0 (you bottom), 5 (left), 4 (top-left), 3 (top-center), 2 (top-right), 1 (right)
// Positions relative to the 1000x520 table container
// Moving them INWARD (more positive/less extreme values) so they don't clip off-screen
const SEAT_POS = [
  {style:'bottom: -80px;  left: 50%; transform: translateX(-50%);', isUser:true}, // 0 bottom
  {style:'top: 50%;      right: -50px; transform: translateY(-50%);'},           // 1 right
  {style:'top: -20px;    right: 30px;'},                                        // 2 top-right
  {style:'top: -140px;   left: 50%; transform: translateX(-50%);'},             // 3 top
  {style:'top: -20px;    left: 30px;'},                                         // 4 top-left
  {style:'top: 50%;      left: -50px; transform: translateY(-50%);'},            // 5 left
];

// Clockwise flow: 0(bottom) -> 5(left) -> 4(top-left) -> 3(top) -> 2(top-right) -> 1(right)
const ORDERED_SEAT_POS = [
  {...SEAT_POS[0], dir: 'dir-bottom'},
  {...SEAT_POS[5], dir: 'dir-left'},
  {...SEAT_POS[4], dir: 'dir-top-left'},
  {...SEAT_POS[3], dir: 'dir-top'},
  {...SEAT_POS[2], dir: 'dir-top-right'},
  {...SEAT_POS[1], dir: 'dir-right'},
];

function renderTable(){
  renderSeats();
  renderBoard();
  renderPot();
  renderActionBar();
  // Note: applyFelt/applyScreenLogo/applyFeltLogo are called separately
  // on config changes only — not on every game tick.
}

function renderSeats(){
  const container=document.getElementById('seatsEl');
  if(!container) return;
  let html='';
  G.seats.forEach((seat, idx)=>{
    const pos=ORDERED_SEAT_POS[idx];
    if(!seat){
      html+=`<div class="pk-seat empty ${pos.dir}" style="${pos.style}" onclick="uiSitDown(${idx})">
        <div class="pk-body"><div class="pk-ava"><div class="pk-init" style="font-size:18px;color:rgba(255,255,255,0.2);">SEAT</div></div></div>
        <div class="empty-sit-label">CLICK TO SIT</div>
      </div>`;
      return;
    }
    const isActing = idx===G.actingSeat && G.phase!=='WAITING' && G.phase!=='SHOWDOWN';
    const isYou = idx===G.userSeat;
    const avaExtra = isActing?'active':isYou?'you':'';
    const plateExtra = (isActing?'active ':'')+(isYou?'you ':'')+(!seat.inHand?'folded':'');
    const youSeatClass = isYou?'you-seat':'';

    // ─── Cards ───────────────────────────────────────────────
    // Determine animation class: only animate the FIRST time cards are shown
    let cardsHtml='';
    if(seat.cards && seat.cards.length===2 && seat.inHand){
      const firstTime = !ANIM.seatCards.has(idx);
      if(firstTime) ANIM.seatCards.add(idx);
      const animA = firstTime ? 'deal-anim' : 'no-anim';
      const animB = firstTime ? 'deal-anim" style="animation-delay:.2s' : 'no-anim';

      const showDueToAllIn = (G.phase!=='WAITING' && G.phase!=='SHOWDOWN' && G.actingSeat===-1 && activePlayers().length>1);
      const isRevealing = (showDueToAllIn || G.phase==='SHOWDOWN') && !isYou;
      
      if(isYou || showDueToAllIn || G.phase==='SHOWDOWN'){
        const c0=seat.cards[0], c1=seat.cards[1];
        // If it's a new reveal for the board/all-in, use animations. isYou cards already handled by firstTime.
        const cardACls = isRevealing ? 'deal-anim' : animA;
        const cardBCls = isRevealing ? 'deal-anim" style="animation-delay:.15s' : animB;

        cardsHtml=`<div class="pk-cards">
          <div class="pk-card face pk-card-${cardColor(c0)} ${cardACls}"><div class="pk-cv">${c0.v}</div><div class="pk-cs">${c0.s}</div></div>
          <div class="pk-card face pk-card-${cardColor(c1)} ${cardBCls}"><div class="pk-cv">${c1.v}</div><div class="pk-cs">${c1.s}</div></div>
        </div>`;
      } else {
        // Face-down: no animation needed on re-renders
        cardsHtml=`<div class="pk-cards"><div class="pk-card back no-anim"></div><div class="pk-card back no-anim"></div></div>`;
      }
    }

    // Avatar
    let avaInner = seat.avatarUrl
      ? `<img src="${seat.avatarUrl}" alt="${seat.name}">`
      : `<div class="pk-init">${seat.name.charAt(0).toUpperCase()}</div>`;

    const dealerBtn = G.dealerSeat===idx ? `<div class="pk-dealer">D</div>` : '';

    // Large visible bet chip structure
    let betChipHtml = '';
    if (seat.bet > 0 && G.phase !== 'WAITING') {
      const chipCount = Math.min(3, Math.ceil(seat.bet / CFG.bb / 5));
      let stacks = '';
      for (let i = 0; i < chipCount; i++) {
        stacks += `<div class="pk-bet-chip-disc" style="background:#c9a020; z-index:${10-i}"></div>`;
      }
      betChipHtml = `
      <div class="pk-bet-chip show">
        <div class="pk-bet-stack">${stacks}</div>
        <div class="pk-bet-amt">$${seat.bet.toFixed(2)}</div>
      </div>`;
    }

    let badgeClass='', badgeText='';
    if(seat.lastAction){
      switch(seat.lastAction){
        case 'RAISE': badgeClass='raise'; badgeText='RAISE'; break;
        case 'CALL':  badgeClass='call';  badgeText='CALL';  break;
        case 'FOLD':  badgeClass='fold';  badgeText='FOLD';  break;
        case 'CHECK': badgeClass='check'; badgeText='CHECK'; break;
        case 'ALL-IN':badgeClass='allin'; badgeText='ALL-IN';break;
      }
    }
    const badgeHtml = badgeText ? `<div class="pk-badge ${badgeClass} show">${badgeText}${seat.lastAction==='FOLD'?'':seat.bet>0?' $'+seat.bet.toFixed(2):''}</div>` : '';
    const timerBar = isYou ? `<div class="pk-plate-timer" id="userPlateTimer"></div>` : '';
    const stackClass = seat.stack < CFG.bb*5 ? 'low' : '';

    html+=`
    <div class="pk-seat ${youSeatClass} ${pos.dir}" data-seat="${idx}" style="${pos.style}">
      <div class="pk-body">
        ${cardsHtml}
        <div class="pk-ava ${avaExtra}">${avaInner}</div>
        <div class="pk-lvl">50</div>
        <div class="pk-flag">${seat.flag||'🌍'}</div>
        ${dealerBtn}
      </div>
      <div class="pk-plate ${plateExtra}">
        ${badgeHtml}
        ${timerBar}
        <div class="pk-name">${seat.name}${isYou?' <span style="font-size:10px;opacity:0.5;">(you)</span>':''}</div>
        <div class="pk-chips ${stackClass}">$${seat.stack.toFixed(2)}</div>
      </div>
      ${betChipHtml}
    </div>`;
  });
  container.innerHTML=html;
}

function renderBoard(){
  const el=document.getElementById('communityEl');
  if(!el) return;

  // Only fully re-render when number of board cards changes or on reset
  const prev = ANIM.boardShown;
  if(G.board.length === prev && G.board.length !== 0) {
    // Board hasn't changed — skip re-render to avoid animation re-trigger
    return;
  }

  el.innerHTML='';
  for(let i=0; i<5; i++){
    const c = G.board[i];
    if(c){
        const isNew = i >= prev; // this card was just added
        const animClass = isNew ? 'board-anim' : 'no-anim';
        const delay = isNew ? ((i - prev) * 0.12).toFixed(2) : '0';
        const animStyle = isNew ? `animation-delay:${delay}s;` : '';
        const cc=cardColor(c);
        el.innerHTML+=`<div class="bcard face bc-${cc} ${animClass}" style="${animStyle}">
          <div class="bc-corner"><span>${c.v}</span><span>${c.s}</span></div>
          <div class="bcv">${c.v}</div><div class="bcs">${c.s}</div>
        </div>`;
    } else {
        // Invisible space-holding slot so the board is always horizontally aligned for 5 cards
        el.innerHTML+=`<div class="bcard empty-slot"></div>`;
    }
    // Gap after flop
    if(i===2) el.innerHTML+=`<div class="street-gap"></div>`;
  }

  ANIM.boardShown = G.board.length;
}

function renderPot(){
  const el=document.getElementById('potEl');
  if(!el) return;
  if(G.pot>0){
    el.style.display='flex';
    el.querySelector('.pot-badge').textContent=`Pot: $${G.pot.toFixed(2)}`;
    // chips
    const chips=el.querySelector('.pot-chips');
    const stacks=[
      {color:'#c9a020',count:Math.min(5,Math.ceil(G.pot/CFG.bb*0.5))},
      {color:'#e05252',count:Math.min(4,Math.ceil(G.pot/CFG.bb*0.3))},
      {color:'#4b9fe8',count:Math.min(3,Math.ceil(G.pot/CFG.bb*0.2))},
    ];
    chips.innerHTML=stacks.map(st=>{
      let s=`<div style="display:flex;flex-direction:column;gap:0;margin-right:3px;">`;
      for(let i=0;i<st.count;i++) s+=`<div class="pchip" style="background:${st.color};margin-top:${i?'-1px':'0'};"></div>`;
      return s+'</div>';
    }).join('');
  } else {
    el.style.display='none';
  }
}

function uiCheckPre(n){
  if(n===1 && document.getElementById('chkPre1').checked) document.getElementById('chkPre2').checked=false;
  if(n===2 && document.getElementById('chkPre2').checked) document.getElementById('chkPre1').checked=false;
}

function renderActionBar(){
  const isUserTurn = G.actingSeat===G.userSeat && G.phase!=='WAITING' && G.phase!=='SHOWDOWN';
  const seated = G.userSeat >= 0;
  const p = G.seats[G.userSeat];

  // Join prompt — show only when not yet seated
  const joinEl = document.getElementById('actionBarJoin');
  if(joinEl) joinEl.style.display = seated ? 'none' : 'flex';

  const btnFold  = document.getElementById('btnFold');
  const btnCall  = document.getElementById('btnCall');
  const btnRaise = document.getElementById('btnRaise');
  const betRow   = document.getElementById('betRow');
  
  const actionGrp = document.getElementById('actionBtnsGrp');
  const preGrp    = document.getElementById('preActionsGrp');
  const lblPre1   = document.getElementById('lblPre1');
  const lblPre2   = document.getElementById('lblPre2');
  const chkPre1   = document.getElementById('chkPre1');
  const chkPre2   = document.getElementById('chkPre2');

  const inHand = p && p.inHand && p.stack>0;
  let showingPre = false;

  if(isUserTurn){
    const toCall = G.currentBet - p.bet;
    
    // Safety check: if the amount to call changed right before our turn, abort pre-action
    const lastCall = parseFloat(preGrp.dataset.lastCall || '-1');
    if (lastCall !== -1 && lastCall !== toCall) {
        if(chkPre1) chkPre1.checked = false;
        if(chkPre2) chkPre2.checked = false;
    }
    if(preGrp) preGrp.dataset.lastCall = toCall;

    // Auto-execute pre-actions if checked
    const doAuto1 = chkPre1 && chkPre1.checked;
    const doAuto2 = chkPre2 && chkPre2.checked;
    if(chkPre1) chkPre1.checked = false;
    if(chkPre2) chkPre2.checked = false;

    if(doAuto1){
      if(toCall<=0) uiAction('check'); else uiAction('fold');
      return;
    } else if(doAuto2){
      if(toCall<=0) uiAction('check'); else uiAction('call');
      return;
    }

    const acBox = document.getElementById('actionControls');
    if(acBox) acBox.style.display = seated ? 'flex' : 'none';

    if(actionGrp) actionGrp.style.display='flex';
    if(preGrp) preGrp.style.display='none';

    [btnFold, btnCall, btnRaise].forEach(b=>b?.classList.remove('inactive'));
    if(betRow) betRow.style.opacity='1';

    // Update buttons
    if(btnCall){
      if(toCall<=0){ 
        btnFold.innerHTML='Чек / Фолд';
        btnFold.onclick=()=>uiAction('check_fold');
        btnCall.innerHTML='Чек'; 
        btnCall.onclick=()=>uiAction('check'); 
      }
      else{ 
        btnFold.innerHTML='Фолд';
        btnFold.onclick=()=>uiAction('fold');
        btnCall.innerHTML=`Колл<br><span class="sub" style="font-size:14px;">$${toCall.toFixed(2)}</span>`; 
        btnCall.onclick=()=>uiAction('call'); 
      }
    }


    // Update slider range
    const sl = document.getElementById('betSlider');
    const minR = Math.max(CFG.bb, toCall + CFG.bb);
    sl.min = Math.round(minR*100);
    sl.max = Math.round(p.stack*100);
    if(+sl.value < +sl.min) sl.value = sl.min;
    syncBetVal();

    startTimer();
  } else {
    [btnFold, btnCall, btnRaise].forEach(b=>b?.classList.add('inactive'));
    if(betRow) betRow.style.opacity='0.35';
    stopTimer();

    if(seated && p){
      if(inHand && !p.acted && G.phase!=='WAITING' && G.phase!=='SHOWDOWN'){
        if(actionGrp) actionGrp.style.display='none';
        if(preGrp) preGrp.style.display='flex';
        showingPre = true;

        const toCall = G.currentBet - p.bet;
        
        // If the amount to call changed since last rendered, uncheck boxes
        const lastCall = parseFloat(preGrp.dataset.lastCall || '-1');
        if (lastCall !== -1 && lastCall !== toCall) {
            chkPre1.checked = false;
            chkPre2.checked = false;
        }
        preGrp.dataset.lastCall = toCall;

        if(toCall <= 0) {
           lblPre1.textContent = 'Чек / Фолд';
           lblPre2.textContent = 'Чек';
        } else {
           lblPre1.textContent = 'Фолд';
           lblPre2.textContent = `Колл $${toCall.toFixed(2)}`;
        }
      }
    }

    if(!showingPre){
      if(actionGrp) actionGrp.style.display='flex';
      if(preGrp) preGrp.style.display='none';
    }

    const acBox = document.getElementById('actionControls');
    if(acBox) acBox.style.display = seated ? 'flex' : 'none';
  }
}

function syncBetVal(){
  const sl=document.getElementById('betSlider');
  if(!sl) return;
  const v=sl.value/100;
  const elAmt = document.getElementById('betAmtVal');
  if(elAmt) elAmt.textContent='$'+v.toFixed(2);
  const raiseBtn = document.getElementById('btnRaise');
  if(raiseBtn){
     const prefix = G.currentBet===0 ? 'Бет' : 'Рейз до';
     raiseBtn.innerHTML = `${prefix}<br><span class="sub" style="font-size:14px;">$${v.toFixed(2)}</span>`;
  }
}

// ═══════════════════════════════════════════════════════
//  UI ACTIONS
// ═══════════════════════════════════════════════════════
function uiAction(action){
  if(G.userSeat<0||G.actingSeat!==G.userSeat) return;
  stopTimer();
  
  if(action==='check_fold'){
     const p = G.seats[G.userSeat];
     const toCall = G.currentBet - p.bet;
     action = (toCall <= 0) ? 'check' : 'fold';
  }
  
  let raiseAmt=0;
  if(action==='raise') raiseAmt=document.getElementById('betSlider').value/100;
  doAction(G.userSeat, action, raiseAmt);
}

function uiSetBet(pct){
  const p=G.seats[G.userSeat];
  if(!p) return;
  const toCall=G.currentBet - p.bet;
  const potAmt=G.pot+toCall;
  const sl=document.getElementById('betSlider');
  const amt=Math.max(+sl.min, Math.min(+sl.max, Math.round(potAmt*pct*100)));
  sl.value=amt;
  syncBetVal();
}

function uiSitDown(seatIdx){
  if(G.userSeat>=0){ toast('Already seated!'); return; }
  if(G.seats[seatIdx]){ toast('Seat taken!'); return; }
  const name=document.getElementById('playerNameInput').value.trim()||'Player';
  G.seats[seatIdx]={
    name, flag:'🌍', avatarUrl: AVATARS[4]||'',
    stack: CFG.startStack, isBot:false, isUser:true,
    inHand:false, bet:0, acted:false, lastAction:'', cards:[],
  };
  G.userSeat=seatIdx;

  // fill remaining seats with bots (up to 5 bots)
  let bIdx=0;
  G.seats.forEach((s,i)=>{
    if(!s && bIdx<BOT_NAMES.length){
      const b=BOT_NAMES[bIdx++];
      G.seats[i]={
        name:b.name, flag:b.flag, avatarUrl:AVATARS[b.ava]||'',
        stack:CFG.startStack, isBot:true,
        inHand:false, bet:0, acted:false, lastAction:'', cards:[],
      };
    }
  });

  renderTable();
  toast(`Welcome, ${name}! Starting hand…`);
  setTimeout(startHand, 1800);
}

// ═══════════════════════════════════════════════════════
//  FELT / LOGO APPLY
// ═══════════════════════════════════════════════════════
function applyFelt(){
  const grad=`radial-gradient(ellipse 70% 55% at 50% 40%,${CFG.feltC1} 0%,${CFG.feltC2} 35%,${CFG.feltC3} 65%,${CFG.feltC4} 100%)`;
  ['bigFeltSurface'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.background=grad;
  });
  const photo=document.getElementById('bigFeltPhoto');
  const overlay=document.getElementById('bigFeltOverlay');
  if(CFG.feltType==='photo'&&CFG.feltPhotoUrl){
    photo.style.backgroundImage=`url(${CFG.feltPhotoUrl})`;
    photo.style.backgroundSize=CFG.feltZoom+'%';
    photo.style.backgroundPosition=`${50+CFG.feltPanX}% ${50+CFG.feltPanY}%`;
    photo.style.opacity='1';
    overlay.style.background=`rgba(0,0,0,${CFG.feltOverlay/100})`;
  } else {
    photo.style.opacity='0';
    overlay.style.background='transparent';
  }

  // mini preview
  const ms=document.getElementById('miniFeltSurface');
  if(ms){ ms.style.background=grad; }
  const mp=document.getElementById('miniFeltPhoto');
  const mo=document.getElementById('miniFeltOverlay');
  if(mp&&mo){
    if(CFG.feltType==='photo'&&CFG.feltPhotoUrl){
      mp.style.backgroundImage=`url(${CFG.feltPhotoUrl})`;mp.style.opacity='1';
      mo.style.background=`rgba(0,0,0,${CFG.feltOverlay/100})`;
    } else { mp.style.opacity='0'; mo.style.background='transparent'; }
  }
}

function applyScreenLogo(){
  const el=document.getElementById('screenLogoEl');
  if(!el) return;
  // position
  el.style.top='16px'; el.style.left='auto'; el.style.right='auto'; el.style.transform='';
  if(CFG.logoPos==='top-left') el.style.left='16px';
  else if(CFG.logoPos==='top-center'){ el.style.left='50%'; el.style.transform='translateX(-50%)'; }
  else el.style.right='16px';

  // img or letter
  const imgEl=document.getElementById('slImgEl');
  const nameEl=document.getElementById('slNameEl');
  if(imgEl){
    imgEl.style.width=CFG.logoSize+'px'; imgEl.style.height=CFG.logoSize+'px';
    imgEl.style.fontSize=(CFG.logoSize*0.52)+'px';
    if(CFG.logoUrl){
      imgEl.innerHTML=`<img src="${CFG.logoUrl}" style="width:100%;height:100%;object-fit:contain;">`;
    } else {
      imgEl.innerHTML=`<span>${CFG.brandLetter}</span>`;
    }
  }
  if(nameEl) nameEl.textContent=CFG.brand;

  // mini badge
  const ml=document.getElementById('miniLogoName');
  const mi=document.getElementById('miniLogoImg');
  if(ml) ml.textContent=CFG.brand.substring(0,12);
  if(mi){
    if(CFG.logoUrl) mi.innerHTML=`<img src="${CFG.logoUrl}" style="width:100%;height:100%;object-fit:contain;">`;
    else mi.innerHTML=`<span>${CFG.brandLetter}</span>`;
  }
}

function applyFeltLogo(){
  const el=document.getElementById('feltLogoEl');
  if(!el) return;
  el.innerHTML='';
  if(!CFG.tableLogoVisible) return;
  if(CFG.logoUrl){
    el.innerHTML=`<img src="${CFG.logoUrl}" alt="${CFG.brand}">`;
  } else {
    el.textContent=CFG.brand;
  }
}

// ═══════════════════════════════════════════════════════
//  WIN DISPLAY
// ═══════════════════════════════════════════════════════
function showWin(name, amt){
  const el=document.getElementById('winFlash');
  if(!el) return;
  el.querySelector('.win-title').textContent=`${name.toUpperCase()}`;
  el.querySelector('.win-sub').textContent=`wins $${amt.toFixed(2)}! 🎉`;
  el.classList.add('show');
}
function hideWin(){
  const el=document.getElementById('winFlash');
  if(el) el.classList.remove('show');
}

// ═══════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════
let toastTimer=null;
function toast(msg){
  const el=document.getElementById('toast');
  if(!el) return;
  el.textContent=msg;
  el.style.transform='translateY(0)'; el.style.opacity='1';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{el.style.transform='translateY(60px)';el.style.opacity='0';},2500);
}

// ═══════════════════════════════════════════════════════
//  CONFIGURATOR STEPS
// ═══════════════════════════════════════════════════════
let cfgStep=1;
function goStep(n){
  cfgStep=n;
  document.querySelectorAll('.form-card').forEach(c=>c.classList.remove('active'));
  document.getElementById('step'+n).classList.add('active');
  document.querySelectorAll('.prg-step').forEach((s,i)=>{
    s.classList.remove('active','done');
    if(i+1<n) s.classList.add('done');
    if(i+1===n) s.classList.add('active');
  });
  for(let i=1;i<=3;i++){const l=document.getElementById('line-'+i);if(l)l.classList.toggle('done',i<n);}
  window.scrollTo({top:0,behavior:'smooth'});
  updateCfgPreview();
}

function updateCfgPreview(){
  const brand=(document.getElementById('cfgBrand')?.value||'STACKROOM').toUpperCase();
  const slug=document.getElementById('cfgSlug')?.value||'my-room';
  CFG.brand=brand;
  CFG.brandLetter=brand.charAt(0)||'S';
  const brandSlug=brand.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-')||'brand';
  const url=document.getElementById('cfgUrl');
  if(url) url.innerHTML=`pokerroom.io/<b>${brandSlug}</b>/${slug||'room'}`;
  applyScreenLogo();
  applyFelt();
  applyFeltLogo();
}

function pickFelt(el){
  document.querySelectorAll('.fc-swatch').forEach(s=>s.classList.remove('on'));
  el.classList.add('on');
  CFG.feltC1=el.dataset.c1; CFG.feltC2=el.dataset.c2;
  CFG.feltC3=el.dataset.c3; CFG.feltC4=el.dataset.c4||el.dataset.c3;
  CFG.feltType='color'; CFG.feltPhotoUrl=null;
  const pimg=document.getElementById('feltPrevImg');
  if(pimg){ pimg.classList.remove('show'); document.getElementById('feltUpZone').classList.remove('has-file'); }
  document.getElementById('feltSliders').style.display='none';
  applyFelt();
}

function onFeltFile(e){
  const f=e.target.files[0]; if(!f) return;
  if(f.size>5*1024*1024){ toast('File too large (max 5MB)'); return; }
  const r=new FileReader();
  r.onload=ev=>{
    CFG.feltPhotoUrl=ev.target.result; CFG.feltType='photo';
    const img=document.getElementById('feltPrevImg');
    img.src=CFG.feltPhotoUrl; img.classList.add('show');
    document.getElementById('feltUpZone').classList.add('has-file');
    document.getElementById('feltSliders').style.display='block';
    document.querySelectorAll('.fc-swatch').forEach(s=>s.classList.remove('on'));
    applyFelt(); toast('Background uploaded ✓');
  };
  r.readAsDataURL(f);
}

function onLogoFile(e){
  const f=e.target.files[0]; if(!f) return;
  if(f.size>2*1024*1024){ toast('Logo too large (max 2MB)'); return; }
  const r=new FileReader();
  r.onload=ev=>{
    CFG.logoUrl=ev.target.result;
    const img=document.getElementById('logoPrevImg');
    img.src=CFG.logoUrl; img.classList.add('show');
    document.getElementById('logoUpZone').classList.add('has-file');
    applyScreenLogo(); applyFeltLogo(); toast('Logo uploaded ✓');
  };
  r.readAsDataURL(f);
}

function onFeltOverlay(v){ CFG.feltOverlay=+v; document.getElementById('overlayVal').textContent=v+'%'; applyFelt(); }
function onFeltZoom(v){ CFG.feltZoom=+v; document.getElementById('zoomVal').textContent=v+'%'; applyFelt(); }
function onFeltPanX(v){ CFG.feltPanX=+v; document.getElementById('panXVal').textContent=v+'%'; applyFelt(); }
function onFeltPanY(v){ CFG.feltPanY=+v; document.getElementById('panYVal').textContent=v+'%'; applyFelt(); }

function pickLogoPos(el){
  document.querySelectorAll('.pos-btn').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
  CFG.logoPos=el.dataset.pos;
  applyScreenLogo();
}

function onLogoSize(v){ CFG.logoSize=+v; document.getElementById('logoSzVal').textContent=v+'px'; applyScreenLogo(); }

// ═══════════════════════════════════════════════════════
//  GAME ROOM OPEN / CLOSE
// ═══════════════════════════════════════════════════════
function openRoom(){
  // read final settings
  CFG.brand=(document.getElementById('cfgBrand')?.value||'STACKROOM').toUpperCase();
  CFG.brandLetter=CFG.brand.charAt(0);
  const sbInput=document.getElementById('cfgSb')?.value;
  const bbInput=document.getElementById('cfgBb')?.value;
  const stInput=document.getElementById('cfgStack')?.value;
  if(sbInput) CFG.sb=parseFloat(sbInput)||0.05;
  if(bbInput) CFG.bb=parseFloat(bbInput)||0.10;
  if(stInput) CFG.startStack=parseFloat(stInput)||10;

  const room=document.getElementById('gameRoom');
  room.classList.add('open');
  document.body.style.overflow='hidden';

  // Update bar info
  document.getElementById('grBrand').textContent=CFG.brand;
  document.getElementById('grInfo').textContent=`NL Hold'em · $${CFG.sb.toFixed(2)}/$${CFG.bb.toFixed(2)}`;

  renderTable();
  toast(`${CFG.brand} room is live! Choose a seat to play.`);
}

function closeRoom(){
  document.getElementById('gameRoom').classList.remove('open');
  document.body.style.overflow='';
  // reset game
  G.seats=Array(6).fill(null);
  G.phase='WAITING'; G.userSeat=-1; G.handNum=0;
  clearBotTimers(); stopTimer(); hideWin();
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded',()=>{
  goStep(1);
  applyFelt();
  applyScreenLogo();
  applyFeltLogo();
});
