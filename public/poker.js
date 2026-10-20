'use strict';

const TOURNAMENT = window.POKER_TOURNAMENT;

// ═══════════════════════════════════════════════════════
//  CONFIGURATION  (edit this to brand your room)
// ═══════════════════════════════════════════════════════
const CFG = {
  brand: '',
  brandLetter: '',
  logoUrl: null,        // will be set if operator uploads a logo
  feltType: 'color',   // 'color' | 'photo'
  feltC1:'#35c955', feltC2:'#28a842', feltC3:'#1e8a35', feltC4:'#146025',
  feltPhotoUrl: null,
  feltOverlay: 40,
  feltZoom: 130,
  feltPanX: 0, feltPanY: 0,
  feltMode: 'fill',  // 'fill' | 'logo'
  roomBgC1: '#1c1c1c',
  roomBgC2: '#060606',
  roomBgAngle: 135,
  logoPos: 'top-left',   // top-left | top-center | top-right
  logoSize: 38,
  logoOffset: 16,
  brandFontSize: 14,
  mobileLogoMode: 'auto',
  mobileLogoPos: 'top-left',
  mobileLogoSize: 30,
  mobileLogoOffset: 8,
  mobileBrandFontSize: 11,
  mobileFeltMode: 'auto',
  mobileFeltPhotoMode: 'fill',
  mobileFeltZoom: 130,
  mobileFeltOverlay: 40,
  mobileFeltPanX: 0,
  mobileFeltPanY: 0,
  tableLogoVisible: true,
  reactions: ['🎰','💸','🔥','🐸','💀','👑','🚀','😂','❤️','👏','🤯','😤'],
  customReactions: [],  // {url, isGif} uploaded by user
  sb: 25,
  bb: 50,
  startStack: 5000,
  tournamentSpeed: 'HYPER_TURBO',
  levelDurationSec: TOURNAMENT.PRESETS.HYPER_TURBO,
  anteType: TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE,
  maxPlayers: 6,
  maxEntrants: 90,
  tournamentBotCount: 0,
  fillWithBots: false,
  launchMode: 'instant',
  lobbyWaitSeconds: 60,
  tournamentTitle: '',
  tournamentDescription: '',
  scheduledStartAt: null,
  seatingOpenMinutes: 5,
  lateRegistrationMinutes: 10,
};

// Avatar pool — paths relative to poker.html (which is in e:\pokerRoom\)
const AVATARS = [
  '/avatars/ca542146e6540e535ca26a65dac45d3a.png',
  '/avatars/8d38a5b8f7b789ee09c0b8bbce7ec57a.png',
  '/avatars/f38f10dce6b953ccbd55d6019f0850e7.png',
  '/avatars/70fc7b922b62f1dc10a4525742cd6568.png',
  '/avatars/a76faaf75b6381bf141dd719f325be43.png',
  '/avatars/fabc06a478a72e2ad7c3e9a37e295d60.png',
];

const BOT_NAMES = [
  {name:'Coffee_Time',  flag:'🇱🇻', ava:0},
  {name:'DlmaDIDlma',  flag:'🇷🇺', ava:1},
  {name:'CallDeFarol1',flag:'🇦🇷', ava:2},
  {name:'sdszfyzc',    flag:'🇨🇳', ava:3},
  {name:'faker77777',  flag:'🇨🇳', ava:5},
];

// ═══════════════════════════════════════════════════════
//  HAND EVALUATOR
// ═══════════════════════════════════════════════════════
const _CV = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
const _CN = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A'};

function _combos(arr, k){
  if(k===0) return [[]];
  if(arr.length<k) return [];
  const [h,...t]=arr;
  return [..._combos(t,k-1).map(c=>[h,...c]),..._combos(t,k)];
}

function _eval5(cards){
  if(!Array.isArray(cards) || cards.length !== 5 || cards.some(card => !card?.v || !card?.s)){
    return {rank:-1,score:-Infinity,desc:''};
  }
  const nums=cards.map(c=>_CV[c.v]).sort((a,b)=>b-a);
  const suits=cards.map(c=>c.s);
  const isFlush=new Set(suits).size===1;
  const cnt={};
  nums.forEach(n=>cnt[n]=(cnt[n]||0)+1);
  const grps=Object.entries(cnt).map(([v,c])=>({v:+v,c})).sort((a,b)=>b.c-a.c||b.v-a.v);
  const uniq=[...new Set(nums)].sort((a,b)=>b-a);
  let isStraight=false,strHi=0;
  for(let i=0;i<=uniq.length-5;i++){
    if(uniq[i]-uniq[i+4]===4){isStraight=true;strHi=uniq[i];break;}
  }
  if(!isStraight&&uniq.includes(14)&&[2,3,4,5].every(v=>uniq.includes(v))){isStraight=true;strHi=5;}
  // Each card value (2-14) fits in 4 bits. rank (0-9) in the top slot.
  // Encodes ALL tiebreak kickers so comparisons are always correct.
  const sc=(r,...vs)=>r*16**5+(vs[0]||0)*16**4+(vs[1]||0)*16**3+(vs[2]||0)*16**2+(vs[3]||0)*16+(vs[4]||0);
  // Remove listed values from sorted nums; return remaining kickers (desc).
  const kickers=(excl)=>{const ex=[...excl];return nums.filter(n=>{const i=ex.indexOf(n);if(i>=0){ex.splice(i,1);return false;}return true;});};
  if(isFlush&&isStraight&&strHi===14) return{rank:9,score:sc(9,14),                    desc:'Роял-флеш'};
  if(isFlush&&isStraight)             return{rank:8,score:sc(8,strHi),                  desc:`Стрит-флеш до ${_CN[strHi]}`};
  if(grps[0].c===4){const[k0]=kickers(Array(4).fill(grps[0].v));
                    return{rank:7,score:sc(7,grps[0].v,k0),                              desc:`Каре из ${_CN[grps[0].v]}`};}
  if(grps[0].c===3&&grps[1]?.c===2)
                    return{rank:6,score:sc(6,grps[0].v,grps[1].v),                      desc:`Фулл-хаус ${_CN[grps[0].v]} на ${_CN[grps[1].v]}`};
  if(isFlush)       return{rank:5,score:sc(5,...nums),                                  desc:`Флеш с высшей картой ${_CN[nums[0]]}`};
  if(isStraight)    return{rank:4,score:sc(4,strHi),                                   desc:`Стрит до ${_CN[strHi]}`};
  if(grps[0].c===3){const[k0,k1]=kickers(Array(3).fill(grps[0].v));
                    return{rank:3,score:sc(3,grps[0].v,k0,k1),                          desc:`Тройка ${_CN[grps[0].v]}`};}
  if(grps[0].c===2&&grps[1]?.c===2){const[k0]=kickers([grps[0].v,grps[0].v,grps[1].v,grps[1].v]);
                    return{rank:2,score:sc(2,grps[0].v,grps[1].v,k0),                  desc:`Две пары ${_CN[grps[0].v]}-${_CN[grps[1].v]}`};}
  if(grps[0].c===2){const[k0,k1,k2]=kickers([grps[0].v,grps[0].v]);
                    return{rank:1,score:sc(1,grps[0].v,k0,k1,k2),                      desc:`Пара ${_CN[grps[0].v]}`};}
  return            {rank:0,score:sc(0,...nums),                                        desc:`Старшая карта ${_CN[nums[0]]}`};
}

function getHandDesc(holeCards, board){
  if(!holeCards||holeCards.length<2) return null;
  if(board.length===0){
    const n=holeCards.map(c=>_CV[c.v]);
    if(n[0]===n[1]) return `Покетная пара ${_CN[n[0]]}`;
    return null;
  }
  const all=[...holeCards,...board];
  let best=null;
  for(const c of _combos(all,5)){
    const r=_eval5(c);
    if(!best||r.score>best.score) best=r;
  }
  return best?.desc||null;
}

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
//  WIN EQUITY (Monte Carlo)
// ═══════════════════════════════════════════════════════
function _evalBest(hole, board){
  const all=[...(hole || []),...(board || [])].filter(card => card?.v && card?.s);
  if(all.length<5) return -1;
  const combos=_combos(all,5);
  let best=-Infinity;
  for(const c of combos){ const s=_eval5(c).score; if(s>best) best=s; }
  return best;
}

function _calcEquity(players, knownBoard){
  const needed=5-knownBoard.length;
  const N=needed===0?1:1500;
  const wins=new Array(players.length).fill(0);
  if(needed===0){
    const sc=players.map(p=>_evalBest(p.cards,knownBoard));
    const best=Math.max(...sc); const nw=sc.filter(s=>s===best).length;
    sc.forEach((s,i)=>{ if(s===best) wins[i]=1/nw; });
    return wins.map(w=>Math.round(w*100));
  }
  const used=new Set([...players.flatMap(p=>p.cards.map(c=>c.v+c.s)),...knownBoard.map(c=>c.v+c.s)]);
  const rem=makeDeck().filter(c=>!used.has(c.v+c.s));
  for(let n=0;n<N;n++){
    const deck=shuffle([...rem]);
    const board=[...knownBoard,...deck.slice(0,needed)];
    const sc=players.map(p=>_evalBest(p.cards,board));
    const best=Math.max(...sc); const nw=sc.filter(s=>s===best).length;
    sc.forEach((s,i)=>{ if(s===best) wins[i]+=1/nw; });
  }
  return wins.map(w=>Math.round(w/N*100));
}

// Returns { outs: Card[], runnerRunner: bool }
function _getOuts(userCards, board, activePlayers) {
  const ap = activePlayers.filter(p => p.cards && p.cards.length === 2 && p.cards[0] && p.cards[0].v);
  if (ap.length < 2 || board.length >= 5) return { outs: [], runnerRunner: false };

  const used = new Set([
    ...board.map(c => c.v + c.s),
    ...ap.flatMap(p => p.cards.map(c => c.v + c.s))
  ]);
  const rem = makeDeck().filter(c => !used.has(c.v + c.s));

  const opponents = ap.filter(p => p.cards !== userCards);
  if (!opponents.length) return { outs: [], runnerRunner: false };

  const currentUserScore = _evalBest(userCards, board);
  const currentBestOpponent = Math.max(...opponents.map(p => _evalBest(p.cards, board)));

  // Already winning — no outs needed
  if (currentUserScore >= currentBestOpponent) return { outs: [], runnerRunner: false };

  // Single-card outs
  const outs = [];
  for (const card of rem) {
    const nextBoard = [...board, card];
    const userScore = _evalBest(userCards, nextBoard);
    const bestOpp = Math.max(...opponents.map(p => _evalBest(p.cards, nextBoard)));
    if (userScore > bestOpp) outs.push(card);
  }

  if (outs.length > 0) return { outs: outs.slice(0, 12), runnerRunner: false };

  // No single-card outs — check runner-runner (only possible on flop: board.length===3)
  if (board.length === 3) {
    for (let i = 0; i < rem.length; i++) {
      for (let j = i + 1; j < rem.length; j++) {
        const nextBoard = [...board, rem[i], rem[j]];
        const userScore = _evalBest(userCards, nextBoard);
        const bestOpp = Math.max(...opponents.map(p => _evalBest(p.cards, nextBoard)));
        if (userScore > bestOpp) return { outs: [], runnerRunner: true };
      }
    }
  }

  return { outs: [], runnerRunner: false };
}

let _lastEqFingerprint = '';

function _updateEquity(){
  // Учитываем только реально видимые карты (сервер шлёт {hidden:true} для чужих)
  const ap=activePlayers().filter(p=>p.cards&&p.cards.length===2&&p.cards[0]&&p.cards[0].v);
  if(ap.length<2){ G.equity={}; _lastEqFingerprint=''; return; }
  
  // Use only visible board cards for calculation to maintain suspense
  const visibleBoard = (G.boardPeekIdx !== -1) 
    ? G.board.slice(0, G.boardPeekIdx) 
    : G.board;

  // Fingerprint for caching to prevent fluctuations if no visible info changed
  const fingerprint = JSON.stringify(visibleBoard) + 
    ap.map(p => G.seats.indexOf(p) + ':' + p.cards.map(c => c.v + c.s).join('')).sort().join('|') +
    (G.phase === 'SHOWDOWN' || G.actingSeat === -1 ? 'allin' : 'active');

  if (fingerprint === _lastEqFingerprint) return;
  _lastEqFingerprint = fingerprint;

  const eq=_calcEquity(ap, visibleBoard);
  G.equity={};
  
  const maxPct = Math.max(...eq);

  ap.forEach((p,i)=>{ 
    const idx=G.seats.indexOf(p); 
    if(idx>=0) {
      G.equity[idx] = {
        pct: eq[i],
        isLeader: eq[i] === maxPct && eq[i] > 0,
        outs: [],
        runnerRunner: false,
      };
      // Outs for any player who is behind
      if (eq[i] < maxPct && visibleBoard.length >= 3) {
        const outsResult = _getOuts(p.cards, visibleBoard, ap);
        G.equity[idx].outs = outsResult.outs;
        G.equity[idx].runnerRunner = outsResult.runnerRunner;
      }
    }
  });
}

// ═══════════════════════════════════════════════════════
//  SOUND HELPERS (MP3)
// ═══════════════════════════════════════════════════════
function playSound(path, vol=1.0){
  if(isMuted||masterVolume===0) return;
  const a=new Audio(path);
  a.preload='auto';
  a.volume=Math.min(1,masterVolume*vol);
  a.play().catch(()=>{});
}

// ═══════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════
const G = {
  seats: Array(6).fill(null),
  deck: [],
  board: [],
  pot: 0,
  currentBet: 0,
  minRaise: CFG.bb,
  currentSb: CFG.sb,
  currentBb: CFG.bb,
  currentAnte: 0,
  blindLevel: 1,
  handBlindLevel: 1,
  tournamentSb: CFG.sb,
  tournamentBb: CFG.bb,
  tournamentAnte: TOURNAMENT.LEVELS[0].ante,
  tournamentBba: 0,
  anteType: CFG.anteType,
  nextBlindLevel: TOURNAMENT.LEVELS[1],
  nextBlindAt: null,
  phase: 'WAITING',
  dealerSeat: 0,
  actingSeat: -1,
  userSeat: -1,
  handNum: 0,
  botTimers: [],
  equity: {},        // physicalSeat → win%
  boardPeekIdx: -1,  // индекс карты лежащей рубашкой (ожидает открытия)
};

let _chipDisplayMode = (() => {
  try { return localStorage.getItem('pokerChipDisplayMode') === 'bb' ? 'bb' : 'money'; }
  catch (_) { return 'money'; }
})();

function _trimAmount(value, maxDecimals=2){
  return Number(value).toFixed(maxDecimals).replace(/\.?0+$/,'');
}

function formatTableAmount(value){
  const amount = Number(value) || 0;
  if(_chipDisplayMode === 'bb'){
    const bb = Number(G.currentBb) || Number(CFG.bb) || 1;
    return `${_trimAmount(amount / bb)} BB`;
  }
  return `$${amount.toFixed(2)}`;
}

function toggleChipDisplayMode(event){
  event?.stopPropagation?.();
  _chipDisplayMode = _chipDisplayMode === 'bb' ? 'money' : 'bb';
  try { localStorage.setItem('pokerChipDisplayMode', _chipDisplayMode); } catch (_) {}
  renderSeats();
  renderPot();
  renderActionBar();
}

// Dealer button: standalone element on the table felt, one per seat position
// Big-table 1540×840, felt ellipse semi-axes ~750×400 centered at (770,420)
const DEALER_BTN_POS_6 = [
  'bottom:11%; left:60%',
  'top:60%; left:8%',
  'top:19%; left:17%',
  'top:5%; left:60%',
  'top:19%; right:17%',
  'top:60%; right:8%',
];
const DEALER_BTN_POS_9 = [
  'bottom:11%; left:57%',
  'bottom:19%; left:28%',
  'top:58%; left:8%',
  'top:25%; left:14%',
  'top:7%; left:37%',
  'top:7%; right:37%',
  'top:25%; right:14%',
  'top:58%; right:8%',
  'bottom:19%; right:28%',
];
const DEALER_BTN_POS_9_MOBILE = [
  'bottom:7%; left:57%',
  'bottom:11%; left:28%',
  'top:58%; left:8%',
  'top:25%; left:14%',
  'top:7%; left:37%',
  'top:7%; right:37%',
  'top:25%; right:14%',
  'top:58%; right:8%',
  'bottom:11%; right:28%',
];
let _prevDealerSeat = -1;

// --- Socket.io Networking ---
const socket = (typeof io !== 'undefined') ? io({ path: '/realtime/' }) : null;

// Persistent identity: survives page refresh and network drops,
// so the server can re-attach us to our reserved seat.
function getPlayerId(){
  let id = localStorage.getItem('pokerPlayerId');
  if(!id){
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    localStorage.setItem('pokerPlayerId', id);
  }
  return id;
}

let _currentRoomId = null;     // set when we join a room
let _serverTurnSync = null;    // { remain, total, at } from last stateUpdate
let _serverClockOffset = 0;    // server Date.now() minus local Date.now()
let _serverClockSynced = false;
let _blindSync = null;         // { remain, at } from last stateUpdate
let _timerTurnKey = null;      // dedupe key so the timer isn't restarted on every render
let _eliminated = false;       // busted out of the tournament — spectator mode
let _elimPlace = 0;            // место, на котором вылетели (для финального оверлея)
let _mobileEquityVisible = true;
let _mobileEquityHand = -1;
let _mobileEquityHideTimer = null;
let _chatMessages = [];
let _chatOpen = false;
let _chatUnread = 0;
const _seatChatTimers = new Map();
let _effectsEnabled = localStorage.getItem('pokerEffectsEnabled') !== '0';
let _effectsSoundEnabled = localStorage.getItem('pokerEffectsSoundEnabled') !== '0';
let _rocketCooldownUntil = 0;
let _rocketMenuSeat = -1;
let _rocketMenuCooldownTimer = null;
const _seenTableEffects = new Set();

function syncServerClock(samples=3){
  if(!socket?.connected) return;
  let remaining=samples;
  let best=null;
  const sample=()=>{
    const sent=Date.now();
    socket.emit('clockSync', sent, payload=>{
      const received=Date.now();
      const rtt=received-sent;
      const offset=Number(payload?.serverNow)-(sent+received)/2;
      if(Number.isFinite(offset)&&(!best||rtt<best.rtt)) best={rtt,offset};
      if(--remaining>0) setTimeout(sample,80);
      else if(best){ _serverClockOffset=best.offset; _serverClockSynced=true; }
    });
  };
  sample();
}

if (socket) {
  // Auto re-join after a network drop: socket.io reconnects, we re-enter the room
  socket.on('connect', () => {
    syncServerClock();
    if (_inMultiplayer && _currentRoomId) {
      socket.emit('joinRoom', { roomId: _currentRoomId, playerId: getPlayerId() });
    }
  });

  socket.on('roomConfig', (config) => {
    Object.assign(CFG, config);
    CFG.maxPlayers = Number(CFG.maxPlayers) === 9 ? 9 : 6;
    applyFelt();
    applyScreenLogo();
    applyFeltLogo();
    // The constructor is not visible in a live room. Rendering its GIF grid here
    // would download and decode every custom reaction during the critical load.
    if(!_inMultiplayer) renderSettingsReactions();
    
    // Update bar info
    document.getElementById('grBrand').textContent = CFG.brand;
    const tablePrefix = CFG.tournamentMode ? `Стол №${Number(CFG.tableNumber || 1)} · ` : '';
    document.getElementById('grInfo').textContent = `${tablePrefix}NL Hold'em ${CFG.maxPlayers}-Max · ${_chips(CFG.sb)}/${_chips(CFG.bb)}`;
    syncTableSizeLabels();
    updatePendingTournamentEntry(!!config.pendingTournamentEntry);
  });

  socket.on('tournament_player_moved', ({ roomId, tableNumber }) => {
    localStorage.removeItem('pokerPendingTournamentEntry');
    updatePendingTournamentEntry(false);
    G.userSeat = -1;
    _timerTurnKey = null;
    stopTimer();
    toast(`Вы пересажены за стол №${Number(tableNumber || 1)}`);
    socket.emit('joinRoom', { roomId: roomId || _currentRoomId, playerId: getPlayerId() });
  });

  socket.on('table_paused_for_balancing', () => {
    toast('Стол на короткой паузе: идёт балансировка');
  });

  socket.on('table_resumed', () => {
    toast('Балансировка завершена');
  });

  socket.on('stateUpdate', (serverG) => {
    const oldUserSeat = G.userSeat;
    const oldHandNum = G.handNum;
    const oldPhase = G.phase;
    const oldBoardLen = G.board.length;
    Object.assign(G, serverG);
    if(!_serverClockSynced && Number.isFinite(Number(serverG.serverNow))) {
      _serverClockOffset = Number(serverG.serverNow) - Date.now();
    }
    // Server tells us authoritatively which seat is ours (survives refresh)
    G.userSeat = (typeof serverG.yourSeat === 'number' && serverG.yourSeat >= 0)
      ? serverG.yourSeat : oldUserSeat;
    if (_eliminated) G.userSeat = -1;

    // Deal sounds: new hand → hole cards; same hand → new board cards
    if (G.handNum !== oldHandNum && G.phase === 'PREFLOP' && oldHandNum > 0) {
      const n = G.seats.filter(s => s && s.inHand).length;
      for (let i = 0; i < n; i++) setTimeout(sndCard, i * 80);
    } else if (G.handNum === oldHandNum && G.board.length > oldBoardLen) {
      for (let i = 0; i < G.board.length - oldBoardLen; i++) {
        setTimeout(() => playSound('/sounds/card_deal02.mp3', 0.75), i * 130);
      }
    }

    // Late joiner / reconnect after the tournament already finished
    if (G.gameOver && !document.getElementById('endOverlay')) {
      const alive = G.seats.map((s, i) => ({ s, i })).filter(x => x.s && x.s.stack > 0);
      if (alive.length === 1) showGameOverOverlay(alive[0].s.name, alive[0].i, G.totalEntrants || 0);
    }

    // Sync turn clock against server (uses remaining ms, immune to clock skew)
    _serverTurnSync = (serverG.turnRemainingMs != null)
      ? { remain: serverG.turnRemainingMs, total: serverG.turnTimeMs || 30000, at: Date.now() }
      : null;
    _blindSync = (serverG.blindRemainingMs != null)
      ? { remain: serverG.blindRemainingMs, at: Date.now() }
      : null;

    if (G.userSeat >= 0) {
      localStorage.removeItem('pokerPendingTournamentEntry');
      updatePendingTournamentEntry(false);
      const joinBar = document.getElementById('actionBarJoin');
      if (joinBar) joinBar.style.display = 'none';
    }

    if (G.handNum !== oldHandNum || (oldPhase === 'SHOWDOWN' && G.phase === 'WAITING')) {
      hideWin();
      ANIM.reset();
    }
    if (G.handNum !== oldHandNum || G.phase === 'WAITING') stopAllInMusic();
    if (G.phase !== 'WAITING' && G.phase !== 'SHOWDOWN' && G.actingSeat === -1 && activePlayers().length > 1) {
      startAllInMusic();
    }
    _updateEquity();
    renderTable();
  });

  // You busted out of the tournament — seat is gone, you become a spectator
  socket.on('eliminated', ({ place, total }) => {
    _eliminated = true;
    _elimPlace = place;
    G.userSeat = -1;
    stopTimer();
    showElimOverlay(place, total);
    renderTable();
  });

  socket.on('playerEliminated', ({ name, place, total }) => {
    toast(`${name} выбыл — место ${place} из ${total}`);
    sndFold();
  });

  socket.on('gameOver', ({ winnerName, winnerSeat, total }) => {
    stopAllInMusic();
    showGameOverOverlay(winnerName, winnerSeat, total);
  });

  socket.on('blindLevelUp', ({ level, sb, bb, ante, bba, anteType, remainingMs, nextLevel }) => {
    G.blindLevel=level;
    G.tournamentSb=sb;
    G.tournamentBb=bb;
    G.tournamentAnte=ante||0;
    G.tournamentBba=bba||0;
    G.anteType=anteType||CFG.anteType;
    G.nextBlindLevel=nextLevel||null;
    _blindSync=remainingMs==null?null:{remain:remainingMs,at:Date.now()};
    const forced=ante?` · Ante ${_chips(ante)}`:(bba?` · BBA ${_chips(bba)}`:'');
    toast(`Уровень ${level}: ${_chips(sb)} / ${_chips(bb)}${forced}`);
    sndRaise();
    renderBlindInfo();
  });

  socket.on('sitDenied', (msg) => {
    G.userSeat = -1;
    toast(msg || 'Место уже занято');
    const joinBar = document.getElementById('actionBarJoin');
    if (joinBar) joinBar.style.display = 'flex';
    renderTable();
  });

  socket.on('playerActionEffect', ({ seatIdx, action, amount, isAllIn }) => {
    const p = G.seats[seatIdx];
    if (!p) return;
    if (isAllIn) startAllInMusic();

    if (action === 'fold') {
      sndFold();
      doFoldAnim(seatIdx, () => {});
    } else if (action === 'call' || action === 'check') {
      const isCheck = (action === 'check');
      speak(isAllIn ? 'All in' : (isCheck ? 'Check' : 'Call'));
      isCheck ? sndCheck() : sndChip();
    } else if (action === 'raise' || action === 'bet') {
      speak(isAllIn ? 'All in' : (action === 'bet' ? 'Bet' : 'Raise'));
      sndRaise();
    }
  });

  socket.on('error', (err) => {
    toast(`Error: ${err}`);
  });

  // Incoming reaction from another player
  socket.on('reaction', ({ seatIdx, content, type }) => {
    fireBotReaction(seatIdx, content, type);
  });

  socket.on('rocket_attack_started', (effectEvent) => {
    receiveTableEffect(effectEvent);
  });

  socket.on('rocket_attack_rejected', ({ code, retryAfterMs } = {}) => {
    if(code === 'COOLDOWN' && retryAfterMs > 0) {
      _rocketCooldownUntil = Date.now() + retryAfterMs;
      toast(`Ракета перезаряжается: ${Math.ceil(retryAfterMs / 1000)} сек.`);
    } else if(code === 'TARGET_BUSY') {
      toast('В эту цель уже летит эффект');
    } else if(code === 'TARGET_GONE') {
      toast('Игрок уже покинул стол');
    } else {
      toast('Сейчас запустить ракету нельзя');
    }
    closePlayerContextMenu();
  });

  socket.on('chatHistory', (messages) => {
    _chatMessages = Array.isArray(messages) ? messages.slice(-60) : [];
    renderGameChat();
  });

  socket.on('chatMessage', (message) => {
    if (!message || typeof message.text !== 'string') return;
    _chatMessages.push(message);
    if (_chatMessages.length > 60) _chatMessages.shift();
    showSeatChatBubble(message);
    if (!_chatOpen) {
      _chatUnread++;
      updateChatUnread();
    }
    renderGameChat();
  });

  // Auto-seat from lobby: server pre-assigned us a seat when we joined the room
  socket.on('autoSeated', ({ seatIdx, name }) => {
    G.userSeat = seatIdx;
    console.log(`[Client] Auto-seated at seat ${seatIdx} as "${name}"`);
    // Hide join bar, show action controls
    const joinBar = document.getElementById('actionBarJoin');
    if (joinBar) joinBar.style.display = 'none';
    renderTable();
  });

  // Receive winners to trigger chips fly, sounds, and UI
  socket.on('handWinners', ({ winnerName, firstPot, totalWon, firstWinnerSeat, splitIdxs, pots }) => {
    stopAllInMusic();
    playSound('/sounds/sports-poker-chips-pile-movement-slide-short-felt-table-01.mp3', 0.85);
    
    if (pots && pots.length > 0) {
      pots.forEach(p => p.winners.forEach(si => _animateChipsToWinner(si)));
    } else if (splitIdxs) {
      splitIdxs.forEach(si => _animateChipsToWinner(si));
    } else if (firstWinnerSeat >= 0) {
      _animateChipsToWinner(firstWinnerSeat);
    }

    if (splitIdxs) {
      showWin('SPLIT POT', firstPot, -1, splitIdxs);
    } else {
      showWin(winnerName, totalWon, firstWinnerSeat);
    }
  });
}

// ─── Animation tracking (reset each hand) ───────────────
const ANIM = {
  boardShown: 0,
  seatCards: new Set(),    // seat indices whose hole cards have been deal-animated
  seatRevealed: new Set(), // seat indices whose face-up reveal has been animated
  peekRevealedIdx: -1,     // index of peek card just revealed (render it no-anim)
  reset(){ this.boardShown=0; this.seatCards.clear(); this.seatRevealed.clear(); this.peekRevealedIdx=-1; }
};

function activePlayers(){ return G.seats.filter(s=>s&&s.inHand); }
function nextSeat(from){
  const count=G.seats.length || 6;
  let i=(from+1)%count;
  while(i!==from){if(G.seats[i]&&G.seats[i].inHand&&G.seats[i].stack>0)return i;i=(i+1)%count;}
  return G.seats[from]&&G.seats[from].inHand&&G.seats[from].stack>0 ? from : -1;
}
function nextSeatAny(from){
  const count=G.seats.length || 6;
  let i=(from+1)%count;
  while(i!==from){if(G.seats[i]&&G.seats[i].inHand)return i;i=(i+1)%count;}
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
    p.contributed=(p.contributed||0)+toCall;
    p.lastAction= toCall===0 ? 'CHECK' : 'CALL';
    if(p.stack<0.005) { p.stack=0; p.lastAction='ALL-IN'; speak('All in'); startAllInMusic(); }
    else speak(p.lastAction==='CHECK'?'Check':'Call');
  } else if(action==='check'){
    p.lastAction='CHECK';
    speak('Check');
  } else if(action==='raise'){
    const maxTotal = p.bet + p.stack;
    const minRaiseTo = G.currentBet + (G.minRaise || CFG.bb);
    const totalBet = Math.min(Math.max(raiseAmt, minRaiseTo), maxTotal);
    const previousBet = G.currentBet;
    const toAdd = Math.min(totalBet - p.bet, p.stack);
    p.stack-=toAdd; p.bet+=toAdd; G.pot+=toAdd;
    p.contributed=(p.contributed||0)+toAdd;
    G.currentBet = p.bet;
    if(G.currentBet - previousBet >= (G.minRaise || CFG.bb) - 0.004) G.minRaise = G.currentBet - previousBet;
    p.lastAction=previousBet<0.005?'BET':'RAISE';
    if(p.stack<0.005) { p.stack=0; p.lastAction='ALL-IN'; speak('All in'); startAllInMusic(); }
    else speak(p.lastAction==='BET'?'Bet':'Raise');
    G.seats.forEach((s,i)=>{ if(s&&s.inHand&&i!==seatIdx&&s.stack>0&&s.bet<G.currentBet-0.004) s.acted=false; });
  }
  p.acted=true;
  afterAction(seatIdx);
}

function afterAction(seatIdx){
  const ap = activePlayers();
  if(ap.length<=1){
    renderTable(); // clear fold animation immediately; endHand will re-render after delay
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

let _peekTimer = null;
let _peekCountInterval = null;
let _peekDrag = null;
let _peekDragCleanup = null;

// ═══════════════════════════════════════════════════════
//  CANVAS CORNER-PEEL PEEK ANIMATION
// ═══════════════════════════════════════════════════════
const PEEK_CW = 124, PEEK_CH = 176;
const PEEK_PAD = 40; // Padding for shadows and flap
const CANVAS_W = PEEK_CW + PEEK_PAD * 2;
const CANVAS_H = PEEK_CH + PEEK_PAD * 2;

function _peekRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y,   x+w, y+r,   r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x,   y+h, x,   y+h-r, r);
  ctx.lineTo(x, y+r); ctx.arcTo(x,   y,   x+r, y,     r);
  ctx.closePath();
}

function _peekDrawBack(ctx) {
  // Dark red card back matching the existing .pk-card.back / .bcard.back style
  const grd = ctx.createLinearGradient(0, 0, PEEK_CW * 0.5, PEEK_CH);
  grd.addColorStop(0, '#8c1a1a');
  grd.addColorStop(1, '#4e0d0d');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, PEEK_CW, PEEK_CH);
  // Diagonal stripe pattern like the CSS repeating-linear-gradient
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 3;
  for (let i = -PEEK_CH; i < PEEK_CW + PEEK_CH; i += 8) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + PEEK_CH, PEEK_CH); ctx.stroke();
  }
  // Inner border
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, PEEK_CW - 1, PEEK_CH - 1);
}

function _peekDrawFace(ctx, card) {
  const isRed = card.s === '♥' || card.s === '♦';
  const col = isRed ? '#c41c1c' : '#141414';

  // Background — matching CSS: linear-gradient(160deg, #f8f3e8, #eee4ce)
  const grd = ctx.createLinearGradient(26.5, -9.7, 97.5, 185.7);
  grd.addColorStop(0, '#f8f3e8');
  grd.addColorStop(1, '#eee4ce');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, PEEK_CW, PEEK_CH);
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, PEEK_CW - 1, PEEK_CH - 1);
  ctx.fillStyle = col;

  // Размеры/позиции 1-в-1 с CSS .bcard, иначе карта «прыгает» при замене канваса на DOM

  // 1. Large Rank (top-left) — CSS: .bcard .card-v-top { font-size:54px; top:6px; left:8px; line-height:0.85; font-weight:900 }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = "900 54px 'Bebas Neue', sans-serif";
  ctx.fillText(card.v, 8, 2);

  // 2. Small Suit (below rank) — CSS: .bcard .card-s-top { font-size:32px; top:58px; left:8px; line-height:1 }
  ctx.font = "32px 'Bebas Neue', sans-serif";
  ctx.fillText(card.s, 8, 58);

  // 3. Giant Suit (bottom-right) — CSS: .bcard .card-s-big { font-size:88px; bottom:12px; right:12px; line-height:0.8; opacity:0.95 }
  // На мобильной (portrait) медиа-запрос уменьшает её до 64px
  const bigPx = (window.matchMedia && matchMedia('(max-aspect-ratio: 4/5)').matches) ? 64 : 88;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.font = `${bigPx}px 'Bebas Neue', sans-serif`;
  ctx.globalAlpha = 0.95;
  // line-height:0.8 — глиф выступает за line-box на font*0.1 вниз
  ctx.fillText(card.s, PEEK_CW - 12, PEEK_CH - 12 + bigPx * 0.1);
  ctx.globalAlpha = 1.0;
}

/**
 * Draw a drop shadow outside the card boundaries on the table
 */
/**
 * Peek render: t=0 (back), t=1 (face) 
 */
function _peekRender(canvas, t, card) {
  const ctx = canvas.getContext('2d');
  const CW = PEEK_CW, CH = PEEK_CH;
  const PAD = PEEK_PAD;
  
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (t <= 0.001) {
    ctx.save();
    ctx.translate(PAD, PAD);
    _peekRoundedRect(ctx, 0, 0, CW, CH, 12);
    ctx.clip();
    _peekDrawBack(ctx);
    ctx.restore();
    return;
  }
  if (t >= 0.999) {
    ctx.save();
    ctx.translate(PAD, PAD);
    _peekRoundedRect(ctx, 0, 0, CW, CH, 12);
    ctx.clip();
    _peekDrawFace(ctx, card);
    ctx.restore();
    return;
  }

  const ax = CW * (1 - t), ay = CH;   // fold point on bottom
  const bx = CW,           by = CH * (1 - t); // fold point on right

  ctx.save();
  ctx.translate(PAD, PAD);

  // 1. Draw the card back with a hole
  ctx.save();
  _peekRoundedRect(ctx, 0, 0, CW, CH, 12);
  ctx.clip();
  _peekDrawBack(ctx);
  
  // Cut the hole
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(CW, CH);
  ctx.lineTo(bx, by);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 2. Reflected flap
  const fdx = bx - ax, fdy = by - ay;
  const flen = Math.sqrt(fdx * fdx + fdy * fdy);
  const fnx = fdx / flen, fny = fdy / flen;

  const ra = 2 * fnx * fnx - 1;
  const rb = 2 * fnx * fny;
  const rc = 2 * fnx * fny;
  const rd = 2 * fny * fny - 1;
  const re = ax * (1 - ra) - ay * rb;
  const rf = ay * (1 - rd) - ax * rc;
  const rox = ra * CW + rb * CH + re;
  const roy = rc * CW + rd * CH + rf;

  ctx.save();
  // Flap shadow (on the hole/felt)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(rox, roy); ctx.lineTo(bx, by); ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Draw flap face
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(rox, roy); ctx.lineTo(bx, by); ctx.closePath();
  ctx.clip();
  ctx.transform(ra, rc, rb, rd, re, rf);
  _peekDrawFace(ctx, card);
  ctx.restore();

  // 3. Fold line highlight/shadow (can spill out of CW,CH)
  ctx.save();
  const fg = ctx.createLinearGradient(ax, ay, rox, roy);
  fg.addColorStop(0, 'rgba(0,0,0,0.25)');
  fg.addColorStop(0.5, 'rgba(0,0,0,0.02)');
  fg.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(rox, roy); ctx.lineTo(bx, by); ctx.closePath();
  ctx.fill();
  
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.restore(); // end PAD translate
}

function _peekAnimateTo(canvas, card, from, to, onDone, duration) {
  const dur = duration || 380, start = performance.now();
  function frame(now) {
    let p = Math.min((now - start) / dur, 1);
    p = 1 - Math.pow(1 - p, 3); // ease-out cubic
    _peekRender(canvas, from + (to - from) * p, card);
    if (p < 1) requestAnimationFrame(frame);
    else { _peekRender(canvas, to, card); if (onDone) onDone(); }
  }
  requestAnimationFrame(frame);
}

/* Corner hint SVG — animated arrows pointing up-left */
function _peekCornerHintSVG() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '32'); svg.setAttribute('height', '32');
  svg.setAttribute('viewBox', '0 0 26 26');
  const style = document.createElementNS(ns, 'style');
  style.textContent = `
    @keyframes ch { 0%,100%{opacity:.3;transform:translate(0,0)} 50%{opacity:.9;transform:translate(-2px,-2px)} }
    .ch { animation: ch 1.3s ease-in-out infinite; transform-origin: 13px 13px; }
  `;
  svg.appendChild(style);
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('class', 'ch');
  const p1 = document.createElementNS(ns, 'path');
  p1.setAttribute('d', 'M18 20 L10 12 L18 12');
  p1.setAttribute('fill', 'none');
  p1.setAttribute('stroke', 'rgba(255,255,255,0.6)');
  p1.setAttribute('stroke-width', '1.8');
  p1.setAttribute('stroke-linecap', 'round');
  p1.setAttribute('stroke-linejoin', 'round');
  const p2 = document.createElementNS(ns, 'path');
  p2.setAttribute('d', 'M21 17 L13 9 L13 17');
  p2.setAttribute('fill', 'none');
  p2.setAttribute('stroke', 'rgba(255,255,255,0.3)');
  p2.setAttribute('stroke-width', '1.5');
  p2.setAttribute('stroke-linecap', 'round');
  p2.setAttribute('stroke-linejoin', 'round');
  g.appendChild(p1); g.appendChild(p2);
  svg.appendChild(g);
  return svg;
}

function advancePhase(){
  G.seats.forEach(s=>{ if(s){ s.bet=0; s.acted=false; s.lastAction=''; } });
  G.currentBet=0;
  const ap=activePlayers();
  if(ap.length<=1){ endHand(); return; }

  if(G.phase==='PREFLOP'){
    G.phase='FLOP';
    G.board.push(G.deck.pop(),G.deck.pop(),G.deck.pop());
    [0,130,260].forEach(d=>setTimeout(()=>playSound('/sounds/card_deal02.mp3',0.75),d));
  } else if(G.phase==='FLOP'){
    G.phase='TURN'; G.board.push(G.deck.pop());
  } else if(G.phase==='TURN'){
    G.phase='RIVER'; G.board.push(G.deck.pop());
  } else if(G.phase==='RIVER'){
    G.phase='SHOWDOWN'; endHand(); return;
  }

  const canBet = ap.filter(p=>p.stack>0);
  if(canBet.length <= 1){
    G.actingSeat = -1;
    // TURN и RIVER в all-in: кладём рубашкой, ждём взаимодействия
    if(G.phase==='TURN' || G.phase==='RIVER'){
      G.boardPeekIdx = G.board.length - 1;
      playSound('/sounds/card_deal02.mp3', 0.75);
      _updateEquity();
      renderTable();
      return;
    }
    // FLOP — сразу лицом
    _updateEquity();
    renderTable();
    setTimeout(advancePhase, 1500);
    return;
  }

  G.actingSeat = nextSeat(G.dealerSeat);
  renderTable();
  scheduleBot();
}

// _startPeekCountdown removed — replaced by auto-peel in _initPeekDrag

function _finishPeekReveal(){
  if(G.boardPeekIdx < 0) return;

  // Strip ids from the revealed canvas wrap BEFORE anything else.
  // Both TURN and RIVER peek cards use id="boardPeekWrap"/"boardPeekCanvas".
  // If the TURN canvas id is left in the DOM, _initPeekDrag() for the RIVER card
  // will find the TURN wrap first (getElementById returns the first match) and
  // re-initialize the TURN canvas with the RIVER card's back — causing the visual
  // glitch where "5th card appears in place of 4th".
  const revWrap   = document.getElementById('boardPeekWrap');
  const revCanvas = document.getElementById('boardPeekCanvas');
  if(revWrap)   revWrap.removeAttribute('id');
  if(revCanvas) revCanvas.removeAttribute('id');

  G.boardPeekIdx = -1;
  _peekCurrentT = 0;

  // Keep ANIM.boardShown = G.board.length so renderBoard SKIPS the board.
  // The canvas already shows the correct face card — leave it as-is.
  ANIM.boardShown = G.board.length;

  playSound('/sounds/card_deal02.mp3', 0.75);
  _updateEquity();
  renderTable(); // renderBoard skips; seats/pot/equity still update
  if (typeof _inMultiplayer === 'undefined' || !_inMultiplayer) {
    setTimeout(advancePhase, 1200);
  }
}

function revealPeekCard(){
  if(G.boardPeekIdx < 0) return;
  clearTimeout(_peekTimer); _peekTimer = null;
  
  const canvas = document.getElementById('boardPeekCanvas');
  const card = G.board[G.boardPeekIdx];
  
  if(_peekDragCleanup){ _peekDragCleanup(); _peekDragCleanup = null; }
  _peekDrag = null;

  if(canvas && card){
    const currentT = _peekCurrentT || 0;
    if(currentT >= 0.98){
      _finishPeekReveal();
    } else {
      // Faster finish animation if it's already mostly open
      const dur = currentT > 0.6 ? 300 : 650;
      _peekAnimateTo(canvas, card, currentT, 1, _finishPeekReveal, dur);
    }
  } else {
    _finishPeekReveal();
  }
}

let _peekCurrentT = 0;

function _initPeekDrag(){
  const wrap = document.getElementById('boardPeekWrap');
  const canvas = document.getElementById('boardPeekCanvas');
  if(!wrap || !canvas) return;
  if(_peekDragCleanup){ _peekDragCleanup(); _peekDragCleanup = null; }

  const card = G.board[G.boardPeekIdx];
  if(!card) return;

  let dragging = false, startX = 0, startY = 0;
  _peekCurrentT = 0;
  let animating = false;
  let autoPeelRaf = null;
  let autoPeelDone = false;

  // Initial render
  _peekRender(canvas, 0, card);

  // Auto-reveal logic: smooth transition to halfway by end of timer
  const TOTAL_DURATION = 2600; 
  const autoRevealStart = performance.now();

  // Force full reveal so it smoothly opens before server finishes phase
  clearTimeout(_peekTimer);
  _peekTimer = setTimeout(() => {
    revealPeekCard();
  }, TOTAL_DURATION);

  function autoRevealFrame(now) {
    if(dragging || animating || autoPeelDone || G.boardPeekIdx < 0) return;
    const elapsed = now - autoRevealStart;
    const p = Math.min(elapsed / TOTAL_DURATION, 1);
    
    // Smooth ease-out to 50%
    _peekCurrentT = (1 - Math.pow(1 - p, 2)) * 0.5;
    
    _peekRender(canvas, _peekCurrentT, card);
    
    if(p < 1) {
      autoPeelRaf = requestAnimationFrame(autoRevealFrame);
    } else {
      autoPeelDone = true;
    }
  }
  autoPeelRaf = requestAnimationFrame(autoRevealFrame);

  function stopAutoPeel() {
    if(autoPeelRaf) { cancelAnimationFrame(autoPeelRaf); autoPeelRaf = null; }
    autoPeelDone = true;
  }

  const gx = e => e.touches ? e.touches[0].clientX : e.clientX;
  const gy = e => e.touches ? e.touches[0].clientY : e.clientY;

  function onStart(e){
    if(animating || G.boardPeekIdx < 0) return;
    stopAutoPeel();
    dragging = true;
    startX = gx(e); startY = gy(e);
    canvas.style.cursor = 'grabbing';
    if(e.cancelable) e.preventDefault();
  }

  function onMove(e){
    if(!dragging || animating || G.boardPeekIdx < 0) return;
    const dx = gx(e) - startX;
    const dy = gy(e) - startY;
    
    const tableEl = document.querySelector('.big-table');
    const scale = tableEl ? (tableEl.getBoundingClientRect().width / tableEl.offsetWidth || 1) : 1;
    
    // drag left (-dx) and/or up (-dy) lifts the bottom-right corner
    const diag = Math.max(-dx - dy, 0) / scale;
    _peekCurrentT = Math.min(diag / 160, 1);
    _peekRender(canvas, _peekCurrentT, card);
    if(e.cancelable) e.preventDefault();
  }

  function onEnd(){
    if(!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
    if(animating || G.boardPeekIdx < 0) return;
    const from = _peekCurrentT;
    animating = true;
    if(_peekCurrentT >= 0.40){
      // Passed threshold — fully reveal
      revealPeekCard();
    } else {
      // Snap back
      _peekAnimateTo(canvas, card, from, 0, ()=>{
        animating = false;
        _peekCurrentT = 0;
      });
    }
  }

  function cleanup(){
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
  }

  function onStartWrapper(e){
    onStart(e);
    document.addEventListener('mousemove', onMove, {passive:false});
    document.addEventListener('mouseup', onEndWrapper);
    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('touchend', onEndWrapper);
  }

  function onEndWrapper(e){
    onEnd();
    cleanup();
  }

  wrap.addEventListener('mousedown', onStartWrapper);
  wrap.addEventListener('touchstart', onStartWrapper, {passive:false});
  _peekDragCleanup = ()=>{
    stopAutoPeel();
    wrap.removeEventListener('mousedown', onStartWrapper);
    wrap.removeEventListener('touchstart', onStartWrapper);
    cleanup();
    _peekDrag = null;
  };
}

let _winChips = [];

function _getBetChipPos(seatEl, tableRect, scale=1){
  const r = seatEl.getBoundingClientRect();
  const sx = (r.left - tableRect.left) / scale;
  const sy = (r.top  - tableRect.top) / scale;
  const sw = r.width / scale, sh = r.height / scale;
  if(seatEl.classList.contains('dir-bottom'))    return {x: sx+sw/2,       y: sy-55};
  if(seatEl.classList.contains('dir-top'))       return {x: sx+sw/2,       y: sy+sh+55};
  if(seatEl.classList.contains('dir-left'))      return {x: sx+sw+55,      y: sy+sh/2};
  if(seatEl.classList.contains('dir-right'))     return {x: sx-55,         y: sy+sh/2};
  if(seatEl.classList.contains('dir-top-left'))  return {x: sx+160+20,     y: sy+sh+20};
  if(seatEl.classList.contains('dir-top-right')) return {x: sx+sw-160-20,  y: sy+sh+20};
  return {x: sx+sw/2, y: sy+sh/2};
}

function _animateChipsToWinner(winnerSeatIdx){
  const tableEl = document.querySelector('.big-table');
  if(!tableEl) return;
  const potEl = document.getElementById('potEl');
  if(!potEl || potEl.style.display === 'none') return;
  const seatEl = tableEl.querySelector(`[data-seat="${winnerSeatIdx}"]`);
  if(!seatEl) return;

  const tableRect = tableEl.getBoundingClientRect();
  const potRect   = potEl.getBoundingClientRect();
  const scale = tableRect.width / 1540 || 1;
  const dest = _getBetChipPos(seatEl, tableRect, scale);

  const sx = (potRect.left + potRect.width  / 2 - tableRect.left) / scale;
  const sy = (potRect.top  + potRect.height / 2 - tableRect.top) / scale;

  for(let i = 0; i < 10; i++){
    const chip = document.createElement('div');
    chip.className = 'win-chip-fly';
    chip.style.left = `${sx - 11}px`;
    chip.style.top  = `${sy - 4}px`;
    tableEl.appendChild(chip);
    _winChips.push(chip);

    // Double-rAF ensures initial paint before transition starts
    setTimeout(()=>{
      requestAnimationFrame(()=> requestAnimationFrame(()=>{
        const scatter = (Math.random() - 0.5) * 26;
        chip.style.left = `${dest.x - 11 + scatter}px`;
        chip.style.top  = `${dest.y - 4  + (Math.random()-0.5)*16}px`;
        // Chips stay visible — cleared by hideWin()
      }));
    }, i * 80);
  }
}

// ── Main pot / side-pot distribution ─────────────────────────────────────────────────────────────────────
// Classic side-pot algorithm:
//   1. Sort active players by total contribution (ascending).
//   2. For each contribution level, the pot slice = (level − prevLevel)
//      × (number of ALL seats — active + folded — that contributed > prevLevel).
//   3. Only active (non-folded) players at that level or above are eligible to win.
// This naturally handles "uncallable excess": the over-contributor wins their own
// side-pot and effectively gets that money back, with no mid-street refund needed.
function _distributePots(evalFn){
  const ap = activePlayers(); // currently active (not folded) players
  if(ap.length === 1) return [{ winners: ap, pot: G.pot }];

  // All seats that put any money in this hand (active + folded)
  const allContribs = G.seats.filter(s => s && (s.contributed || 0) > 0);

  // Active players sorted by total contribution ascending
  const sorted = ap.map(p => ({ p, contrib: p.contributed || 0 }))
                   .sort((a, b) => a.contrib - b.contrib);

  const pots = [];
  let remaining = G.pot;
  let prevLevel = 0;

  for(let i = 0; i < sorted.length; i++){
    const level = sorted[i].contrib;
    if(level <= prevLevel) continue;

    // Number of players (active + folded) who contributed to this level
    // = those who put in more than prevLevel
    const numContributors = allContribs.filter(s => (s.contributed || 0) > prevLevel).length;
    const potSlice = (level - prevLevel) * numContributors;
    const potSize = Math.min(potSlice, remaining);
    if(potSize <= 0) continue;
    remaining -= potSize;

    // Eligible winners: active players at this contribution level or above
    const eligible = sorted.slice(i);
    const scores = eligible.map(e => evalFn(e.p));
    const best = Math.max(...scores);
    const winners = eligible.filter((_, idx) => scores[idx] === best).map(e => e.p);
    pots.push({ winners, pot: potSize });
    prevLevel = level;
  }

  // Any remainder (e.g. from folded players at a level nobody active reached)
  if(remaining > 0.001){
    const scores = ap.map(p => evalFn(p));
    const best = Math.max(...scores);
    const winners = ap.filter((_, i) => scores[i] === best);
    pots.push({ winners, pot: remaining });
  }
  return pots;
}

function endHand(){
  G.phase='SHOWDOWN';
  G.seats.forEach(s=>{ if(s) s.lastAction=''; });
  const ap = activePlayers();
  _updateEquity(); // финальный процент (0/50/100%)

  if(G.board.length === 5 || (ap.length > 1 && G.board.length > 0)){
    // Full board or all-in runout — distribute using side-pot logic
    const evalFn = p => _evalBest(p.cards, G.board);
    const pots = _distributePots(evalFn);

    let firstWinnerSeat = -1;
    let firstPot = 0;
    let splitIdxs = null;

    pots.forEach(({ winners, pot }) => {
      if(winners.length === 1){
        const winner = winners[0];
        const si = G.seats.indexOf(winner);
        winner.stack += pot;
        if(firstWinnerSeat < 0){ firstWinnerSeat = si; firstPot = pot; }
        _animateChipsToWinner(si);
      } else {
        const share = pot / winners.length;
        winners.forEach(p => { p.stack += share; });
        if(firstWinnerSeat < 0){
          splitIdxs = winners.map(p => G.seats.indexOf(p));
          firstPot = share;
        }
      }
    });

    G.pot = 0;
    playSound('/sounds/sports-poker-chips-pile-movement-slide-short-felt-table-01.mp3', 0.85);
    renderTable();
    if(splitIdxs){
      showWin('SPLIT POT', firstPot, -1, splitIdxs);
    } else {
      const winnerName = G.seats[firstWinnerSeat]?.name || '';
      const totalWon = pots.reduce((s, p2) => {
        const si = G.seats.indexOf(p2.winners[0]);
        return si === firstWinnerSeat ? s + p2.pot : s;
      }, 0);
      showWin(winnerName, totalWon || firstPot, firstWinnerSeat);
    }
  } else {
    // Someone folded — one winner takes all
    const winner = ap[0];
    const won = G.pot;
    const winnerSeatIdx = G.seats.indexOf(winner);
    _animateChipsToWinner(winnerSeatIdx);
    playSound('/sounds/sports-poker-chips-pile-movement-slide-short-felt-table-01.mp3', 0.85);
    winner.stack += won;
    G.pot = 0;
    renderTable();
    showWin(winner.name, won, winnerSeatIdx);
  }

  setTimeout(startHand, 3200);
}

function startHand(){
  applyLocalTournamentLevel();
  G.handNum++;
  G.deck = shuffle(makeDeck());
  G.board = [];
  G.pot = 0;
  G.currentBet = 0;
  ANIM.reset();
  G.equity = {};
  G.boardPeekIdx = -1;
  clearTimeout(_peekTimer); _peekTimer = null;
  clearInterval(_peekCountInterval); _peekCountInterval = null;
  clearBotTimers();
  _stopBotRandomReactions();
  hideWin();

  let active=0;
  G.seats.forEach(s=>{
    if(s){ s.inHand=s.stack>0; s.bet=0; s.acted=false; s.lastAction=''; s.cards=[]; s.contributed=0; if(s.inHand)active++; }
  });
  if(active<2){ G.phase='WAITING'; renderTable(); return; }

  const seatCount=G.seats.length || 6;
  let d=(G.dealerSeat+1)%seatCount;
  while(!G.seats[d]||!G.seats[d].inHand) d=(d+1)%seatCount;
  G.dealerSeat=d;

  let sbIdx,bbIdx;
  if(active===2){
    sbIdx=G.dealerSeat;
    bbIdx=nextSeat(sbIdx);
  }else{
    sbIdx=nextSeat(G.dealerSeat);
    bbIdx=nextSeat(sbIdx);
  }
  collectLocalAntes(bbIdx);
  postBlind(sbIdx,G.currentSb);
  postBlind(bbIdx,G.currentBb);
  G.seats.forEach((s,i)=>{ if(s&&s.inHand){ s.cards=[G.deck.pop(),G.deck.pop()]; setTimeout(sndCard,i*80); } });
  G.currentBet = G.currentBb;
  G.minRaise = G.currentBb;
  G.seats[sbIdx].acted=false;
  G.seats[bbIdx].acted=false;

  G.phase='PREFLOP';
  G.actingSeat = nextSeat(bbIdx);

  if(G.actingSeat===-1||G.seats.filter(s=>s&&s.inHand&&s.stack>0).length<2){
    G.actingSeat=-1;
    renderTable();
    setTimeout(advancePhase,1200);
  }else{
    renderTable();
    scheduleBot();
    _scheduleBotRandomReaction();
  }
}

function postBlind(idx, amt){
  const p=G.seats[idx];
  if(!p) return;
  const a=Math.min(amt,p.stack);
  p.stack-=a; p.bet+=a; G.pot+=a;
  p.contributed=(p.contributed||0)+a;
}

function postAnte(idx,amt){
  const p=G.seats[idx];
  if(!p||amt<=0)return;
  const actual=Math.min(amt,p.stack);
  p.stack=Math.round((p.stack-actual)*100)/100;
  G.pot=Math.round((G.pot+actual)*100)/100;
  p.contributed=Math.round(((p.contributed||0)+actual)*100)/100;
  if(p.stack<0.005)p.stack=0;
}

function applyLocalTournamentLevel(){
  const now=Date.now();
  const duration=(Number(CFG.levelDurationSec)||180)*1000;
  if(!G.tournamentStartedAt)G.tournamentStartedAt=now;
  const index=Math.min(TOURNAMENT.LEVELS.length-1,Math.floor((now-G.tournamentStartedAt)/duration));
  const level=TOURNAMENT.LEVELS[index];
  G.currentSb=level.sb;
  G.currentBb=level.bb;
  G.blindLevel=level.level;
  G.handBlindLevel=level.level;
  G.currentAnte=CFG.anteType===TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE
    ? level.ante
    : (CFG.anteType===TOURNAMENT.ANTE_TYPES.BIG_BLIND_ANTE?level.bb:0);
  G.tournamentSb=level.sb;
  G.tournamentBb=level.bb;
  G.tournamentAnte=CFG.anteType===TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE?level.ante:0;
  G.tournamentBba=CFG.anteType===TOURNAMENT.ANTE_TYPES.BIG_BLIND_ANTE?level.bb:0;
  G.anteType=CFG.anteType;
  G.nextBlindLevel=TOURNAMENT.LEVELS[index+1]||null;
  G.nextBlindAt=G.nextBlindLevel?G.tournamentStartedAt+(index+1)*duration:null;
}

function collectLocalAntes(bbIdx){
  if(CFG.anteType===TOURNAMENT.ANTE_TYPES.NO_ANTE)return;
  if(CFG.anteType===TOURNAMENT.ANTE_TYPES.BIG_BLIND_ANTE){
    postLocalAnteOnce(bbIdx,G.currentBb);
    return;
  }
  G.seats.forEach((seat,seatIdx)=>{if(seat?.inHand)postLocalAnteOnce(seatIdx,G.currentAnte);});
}

function postLocalAnteOnce(idx,amount){
  const player=G.seats[idx];
  if(!player||!player.inHand||player.antePaidHand===G.handNum)return;
  player.antePaidHand=G.handNum;
  postAnte(idx,amount);
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
  window.speechSynthesis.cancel(); // flush stuck queue (Chrome bug)
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
let _botTimers = [];
function clearBotTimers(){ G.botTimers.forEach(clearTimeout); G.botTimers=[]; }

// ─── Random bot reactions for testing/atmosphere ──────────────────────────
let _botRxTimer = null;
function _stopBotRandomReactions(){ clearTimeout(_botRxTimer); _botRxTimer = null; }

function _scheduleBotRandomReaction(){
  _stopBotRandomReactions();
  const delay = 3000 + Math.random() * 5000; // 3-8 sec between reactions
  _botRxTimer = setTimeout(()=>{
    if(G.phase === 'WAITING') return;
    // Pick a random bot seat that is occupied
    const botSeats = G.seats.map((s,i)=>({s,i})).filter(x=>x.s && x.s.isBot);
    if(botSeats.length > 0){
      const {i} = botSeats[Math.floor(Math.random() * botSeats.length)];
      const all = [...CFG.reactions, ...CFG.customReactions];
      if(all.length){
        const rx = all[Math.floor(Math.random() * all.length)];
        const isImg = CFG.customReactions.includes(rx);
        fireBotReaction(i, rx, isImg ? 'img' : 'emoji');
      }
    }
    _scheduleBotRandomReaction(); // reschedule
  }, delay);
}


function scheduleBot(){
  if(G.actingSeat<0) return;
  const p=G.seats[G.actingSeat];
  if(!p||!p.isBot||!p.inHand) return;
  const delay = 2500+Math.random()*2000;
  const t = setTimeout(()=>{
    if(G.actingSeat<0||!G.seats[G.actingSeat]?.isBot) return;
    // ~12% chance bot plays a random reaction before acting
    if(Math.random() < 0.12){
      const all = [...CFG.reactions, ...CFG.customReactions];
      if(all.length){
        const rx = all[Math.floor(Math.random() * all.length)];
        const isImg = rx.startsWith('data:');
        fireBotReaction(G.actingSeat, rx, isImg ? 'img' : 'emoji');
      }
    }
    const toCall = G.currentBet - p.bet;
    const r = Math.random();
    if(toCall <= 0) {
      if(r < 0.15) doAction(G.actingSeat, 'raise', (G.currentBb||CFG.bb) * 2);
      else doAction(G.actingSeat, 'check');
    } else {
      if(r < 0.10) doAction(G.actingSeat, 'raise', toCall * 2);
      else if(r < 0.55) doAction(G.actingSeat, 'fold');
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
let _allInMusicAudio = null;
let _allInMusicRequested = false;
let _allInMusicPlaying = false;
let _audioUnlocked = false;
function initAudio(){
  if(!audioCtx) window.AudioContext = window.AudioContext || window.webkitAudioContext;
  if(!audioCtx && window.AudioContext) audioCtx = new AudioContext();
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function ensureAllInAudio(){
  if(!_allInMusicAudio){
    _allInMusicAudio=new Audio('/sounds/allin_user_loop_fixed.wav');
    _allInMusicAudio.loop=true;
    _allInMusicAudio.preload='auto';
    _allInMusicAudio.addEventListener('pause',()=>{ _allInMusicPlaying=false; });
  }
  return _allInMusicAudio;
}
function unlockGameAudio(){
  initAudio();
  const audio=ensureAllInAudio();
  if(_audioUnlocked){
    if(_allInMusicRequested&&!_allInMusicPlaying) startAllInMusic();
    return;
  }
  const oldMuted=audio.muted;
  audio.muted=true;
  const attempt=audio.play();
  if(attempt?.then) attempt.then(()=>{
    audio.pause();
    audio.currentTime=0;
    audio.muted=oldMuted;
    _audioUnlocked=true;
    if(_allInMusicRequested) startAllInMusic();
  }).catch(()=>{ audio.muted=oldMuted; });
}
function playBeep(freq, type, dur, vol=0.1) {
  if(isMuted || masterVolume === 0) return;
  initAudio();
  if(!audioCtx) return;
  if(audioCtx.state==='suspended'){
    audioCtx.resume().then(()=>playBeep(freq,type,dur,vol)).catch(()=>{});
    return;
  }
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
// Звуки игровых событий
function sndCard(){ playBeep(900,'triangle',0.045,0.25); }
function sndChip(){ playBeep(420,'triangle',0.07,0.3); }
function sndFold(){ playBeep(280,'sine',0.18,0.25); }
function sndCheck(){ playBeep(600,'sine',0.06,0.18); }
function sndRaise(){ playBeep(520,'triangle',0.04,0.3); setTimeout(()=>playBeep(700,'triangle',0.07,0.3),60); }
function sndWin(){
  [440,554,659,880].forEach((f,i)=>setTimeout(()=>playBeep(f,'sine',0.25,0.35),i*110));
}
function startAllInMusic(){
  _allInMusicRequested=true;
  if(isMuted || masterVolume === 0 || _allInMusicPlaying) return;
  const audio=ensureAllInAudio();
  audio.volume = Math.min(0.55,masterVolume*0.7);
  audio.play().then(()=>{ _allInMusicPlaying=true; _audioUnlocked=true; }).catch(()=>{});
}
function stopAllInMusic(){
  _allInMusicRequested=false;
  if(!_allInMusicAudio) return;
  _allInMusicAudio.pause();
  _allInMusicAudio.currentTime = 0;
  _allInMusicPlaying=false;
}
function toggleMute(){
  isMuted = !isMuted;
  if(isMuted){
    stopAllInMusic();
    stopEffectSounds();
  }
  const btn = document.getElementById('muteIconBtn');
  if(btn) btn.textContent = isMuted ? '🔇' : '🔊';
}
function changeVol(e){
  masterVolume = e.target.value / 100;
  if(_allInMusicAudio) _allInMusicAudio.volume = Math.min(0.55,masterVolume*0.7);
  _effectAudios.forEach(audio => {
    audio.volume = Math.min(1, masterVolume * (audio._effectVolumeFactor || .35));
  });
  if (masterVolume === 0) {
      isMuted = true;
      stopAllInMusic();
      stopEffectSounds();
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

let _timerTotal = 10000;

function startTimer(){
  clearInterval(timerInterval);
  if(_inMultiplayer && _serverTurnSync){
    // Server-authoritative clock: remaining time as reported by the server
    _timerTotal = _serverTurnSync.total;
    timerMs = Math.max(0, _serverTurnSync.remain - (Date.now() - _serverTurnSync.at));
  } else {
    _timerTotal = 10000; // single-player: 5s main + 5s extra
    timerMs = 10000;
  }
  lastTimerTick=Date.now();
  lastTimerSec=Math.ceil(timerMs/1000);
  updateTimerUI();

  timerInterval=setInterval(()=>{
    const now=Date.now();
    const dt=now-lastTimerTick;
    lastTimerTick=now;
    timerMs-=dt;
    updateTimerUI();
    if(timerMs<=0){
      clearInterval(timerInterval);
      // Auto-action: check if free, otherwise fold (server enforces the same)
      const p = G.seats[G.userSeat];
      const toCall = p ? (G.currentBet - p.bet) : 1;
      uiAction(toCall > 0 ? 'fold' : 'check');
    }
  },50);
}

function stopTimer(){ clearInterval(timerInterval); setTimerBar(0,''); }

function updateTimerUI(){
  const total = _timerTotal || 10000;
  const pct = Math.max(0, Math.min(100, timerMs / total * 100));
  let cls = '';
  if(timerMs <= 5000) cls = 'danger';
  else if(timerMs <= Math.min(10000, total * 0.4)) cls = 'warn';
  setTimerBar(pct, cls);

  const secLeft = Math.ceil(timerMs / 1000);
  if(secLeft !== lastTimerSec){
    if(secLeft === 10 && lastTimerSec > 10) {
      playBeep(600, 'sine', 0.15, 0.4); // 10 секунд осталось — «тыц»
    } else if (secLeft <= 5 && secLeft > 0 && lastTimerSec > secLeft) {
      playBeep(800, 'square', 0.1, 0.2); // 5..1 beeps
    }
    lastTimerSec = secLeft;
  }
}

function setTimerBar(pct, cls){
  const pt=document.getElementById('userPlateTimer');
  if(pt){ pt.style.width=pct+'%'; pt.className='pk-plate-timer'+(cls?' '+cls:''); }
}

// Countdown bar over the currently acting opponent (multiplayer only)
setInterval(()=>{
  if(!_inMultiplayer || !_serverTurnSync) return;
  const el = document.getElementById('oppPlateTimer');
  if(!el) return;
  const remain = _serverTurnSync.remain - (Date.now() - _serverTurnSync.at);
  const pct = Math.max(0, Math.min(100, remain / (_serverTurnSync.total || 30000) * 100));
  el.style.width = pct + '%';
  el.className = 'pk-plate-timer' + (remain <= 5000 ? ' danger' : remain <= 10000 ? ' warn' : '');
}, 100);

// ═══════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════

let _tableLayoutFrame = 0;

function scheduleTableLayout() {
  cancelAnimationFrame(_tableLayoutFrame);
  _tableLayoutFrame = requestAnimationFrame(() => {
    _tableLayoutFrame = 0;
    adjustTableScale();
    applyScreenLogo();
    applyFelt();
  });
}

function syncLiveVisualViewport() {
  const gameRoom = document.getElementById('gameRoom');
  const viewport = window.visualViewport;
  const useViewport = !!(gameRoom?.classList.contains('open') && !_tablePreviewMode && viewport);
  gameRoom?.classList.toggle('live-visual-viewport', useViewport);
  if (!gameRoom) return;
  if (useViewport) {
    gameRoom.style.setProperty('--game-vv-width', `${Math.round(viewport.width)}px`);
    gameRoom.style.setProperty('--game-vv-height', `${Math.round(viewport.height)}px`);
  } else {
    gameRoom.style.removeProperty('--game-vv-width');
    gameRoom.style.removeProperty('--game-vv-height');
  }
}

function adjustTableScale() {
  syncLiveVisualViewport();
  const room = document.querySelector('.gr-room');
  const table = document.querySelector('.big-table');
  if (!room || !table || room.clientWidth === 0) return;

  const rw = room.clientWidth;
  const rh = room.clientHeight;
  
  const phonePreview = document.getElementById('gameRoom')?.classList.contains('table-preview-phone');
  const isPortrait = phonePreview || (rw / rh) <= 0.8;

  syncMobileActionLayout(isPortrait);
  if (isPortrait) {
    const mobileDesignWidth = 430;
    const mobileDesignHeight = Math.max(1, Math.round(mobileDesignWidth * rh / rw));
    table.style.setProperty('--mobile-table-width', `${mobileDesignWidth}px`);
    table.style.setProperty('--mobile-table-height', `${mobileDesignHeight}px`);
  } else {
    table.style.removeProperty('--mobile-table-width');
    table.style.removeProperty('--mobile-table-height');
  }

  const virtualW = 1750;
  const virtualH = 1150;
  const scaleByWidth = isPortrait
    ? Math.max(0, rw - 4) / table.offsetWidth
    : rw / virtualW;
  const scaleByHeight = isPortrait
    ? Math.max(0, rh - 4) / table.offsetHeight
    : rh / virtualH;

  // On portrait screens the transformed table must remain fully inside the room.
  let scale = Math.min(scaleByWidth, scaleByHeight);
  if (scale > 1.3) scale = 1.3;

  table.style.transform = `scale(${scale})`;
  if (document.getElementById('reactionBtnEl')) requestAnimationFrame(renderReactionBtn);
}

function syncMobileActionLayout(isPortrait) {
  const gameRoom = document.getElementById('gameRoom');
  const room = gameRoom?.querySelector('.gr-room');
  const table = gameRoom?.querySelector('.big-table');
  const controls = document.getElementById('actionControls');
  if (!gameRoom || !room || !table || !controls) return;

  gameRoom.classList.toggle('mobile-portrait', isPortrait);
  if (isPortrait) {
    if (controls.parentElement !== room) room.appendChild(controls);
    controls.classList.add('mobile-actions');
  } else {
    if (controls.parentElement !== table) table.appendChild(controls);
    controls.classList.remove('mobile-actions');
  }
  if (document.getElementById('reactionBtnEl')) renderReactionBtn();
}

// 6-seat positions around the oval table
const SEAT_POS = [
  {style:'bottom: -2%;  left: 50%; transform: translateX(-50%);', isUser:true}, 
  {style:'top: 50%;     right: -2%; transform: translateY(-50%);'},           
  {style:'top: 4%;      right: 4%;'},                                        
  {style:'top: -6%;     left: 50%; transform: translateX(-50%);'},             
  {style:'top: 4%;      left: 4%;'},                                         
  {style:'top: 50%;     left: -2%; transform: translateY(-50%);'},            
];

// Clockwise flow: 0(bottom) -> 5(left) -> 4(top-left) -> 3(top) -> 2(top-right) -> 1(right)
const ORDERED_SEAT_POS_6 = [
  {...SEAT_POS[0], dir: 'dir-bottom'},
  {...SEAT_POS[5], dir: 'dir-left'},
  {...SEAT_POS[4], dir: 'dir-top-left'},
  {...SEAT_POS[3], dir: 'dir-top'},
  {...SEAT_POS[2], dir: 'dir-top-right'},
  {...SEAT_POS[1], dir: 'dir-right'},
];

// 9-max: hero at the bottom, two lower-side seats, two side seats,
// two upper corners and two players across the top edge.
const ORDERED_SEAT_POS_9 = [
  {style:'bottom:-2%; left:50%; transform:translateX(-50%);', dir:'dir-bottom'},
  {style:'bottom:10%; left:14%;', dir:'dir-bottom-left'},
  {style:'top:50%; left:-2%; transform:translateY(-50%);', dir:'dir-left'},
  {style:'top:5%; left:4%;', dir:'dir-top-left'},
  {style:'top:-7%; left:30%;', dir:'dir-top-inner-left'},
  {style:'top:-7%; right:30%;', dir:'dir-top-inner-right'},
  {style:'top:5%; right:4%;', dir:'dir-top-right'},
  {style:'top:50%; right:-2%; transform:translateY(-50%);', dir:'dir-right'},
  {style:'bottom:10%; right:14%;', dir:'dir-bottom-right'},
];

function tableSeatCount(){
  return G.seats.length === 9 || Number(G.maxPlayers) === 9 || Number(CFG.maxPlayers) === 9 ? 9 : 6;
}

function syncTableSizeLabels(){
  const count=tableSeatCount();
  const tableType=document.getElementById('tableTypeDisplay');
  if(tableType) tableType.textContent=`NL Hold'em ${count}-Max`;
  const launchType=document.getElementById('launchGameType');
  if(launchType) launchType.textContent=`${count}-Max NL Hold'em`;
  const settingsSub=document.getElementById('gameSettingsSub');
  if(settingsSub) settingsSub.textContent=`NL Hold'em ${count}-max tournament`;
  document.querySelectorAll('.table-size-btn').forEach(btn=>btn.classList.toggle('on', Number(btn.dataset.size)===count));
  const botMode=document.getElementById('launchBotMode');
  if(botMode) botMode.textContent=CFG.launchMode==='scheduled'
    ? CFG.tournamentBotCount>0
      ? `Турнир · тестовых ботов: ${CFG.tournamentBotCount}`
      : 'Предварительная регистрация · посадка за 5 минут до старта'
    : CFG.fillWithBots
      ? `Тестовый режим: свободные места займут боты (${count}-Max)`
      : 'Игроки входят через лобби · реальные карты и ставки';
}

function _datetimeLocalValue(date){
  const pad=value=>String(value).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setLaunchMode(mode){
  CFG.launchMode=mode==='scheduled'?'scheduled':'instant';
  document.querySelectorAll('.launch-mode-btn').forEach(button=>{
    button.classList.toggle('on',button.dataset.mode===CFG.launchMode);
  });
  const scheduled=document.getElementById('scheduledTournamentSettings');
  if(scheduled) scheduled.style.display=CFG.launchMode==='scheduled'?'block':'none';
  const instant=document.getElementById('instantRoomSettings');
  if(instant) instant.style.display=CFG.launchMode==='instant'?'block':'none';
  const instantBots=document.getElementById('instantBotFillOption');
  if(instantBots) instantBots.style.display=CFG.launchMode==='instant'?'flex':'none';
  const startInput=document.getElementById('cfgScheduledStartAt');
  if(startInput){
    const minimum=new Date(Date.now()+60_000);
    startInput.min=_datetimeLocalValue(minimum);
    if(CFG.launchMode==='scheduled'&&!startInput.value){
      startInput.value=_datetimeLocalValue(new Date(Date.now()+24*60*60*1000));
    }
  }
  const title=document.getElementById('launchTitle');
  const subtitle=document.getElementById('launchSubtitle');
  const button=document.getElementById('launchRoomButton');
  if(title) title.textContent=CFG.launchMode==='scheduled'?'Schedule Tournament 🏆':'Ready to Launch 🎰';
  if(subtitle) subtitle.textContent=CFG.launchMode==='scheduled'
    ? 'Проверьте настройки, дату и описание турнира.'
    : 'Your room is configured. Launch when ready.';
  if(button) button.textContent=CFG.launchMode==='scheduled'?'📅 Создать турнир':'🚀 Launch Room';
  syncTableSizeLabels();
}

function onLobbyWaitSeconds(value){
  const parsed=Math.round(Number(value));
  CFG.lobbyWaitSeconds=Number.isFinite(parsed)?Math.min(3600,Math.max(10,parsed)):60;
  const summary=document.getElementById('instantModeSummary');
  if(summary){
    const minutes=Math.floor(CFG.lobbyWaitSeconds/60);
    const seconds=CFG.lobbyWaitSeconds%60;
    summary.textContent=minutes>0
      ? `Старт через ${minutes} мин.${seconds?` ${seconds} сек.`:''}`
      : `Старт через ${seconds} сек.`;
  }
}

function onTournamentBotCount(value){
  const maxEntrants=Math.max(CFG.maxPlayers,Math.round(Number(document.getElementById('cfgMaxEntrants')?.value)||CFG.maxEntrants));
  const parsed=Math.round(Number(value));
  CFG.tournamentBotCount=Number.isFinite(parsed)?Math.min(maxEntrants,Math.max(0,parsed)):0;
  const input=document.getElementById('cfgTournamentBotCount');
  if(input) input.max=String(maxEntrants);
  if(input&&Number(input.value)!==CFG.tournamentBotCount) input.value=CFG.tournamentBotCount;
  syncTableSizeLabels();
}

function setTableSize(size){
  CFG.maxPlayers=Number(size)===9 ? 9 : 6;
  syncTableSizeLabels();
}

function toggleFillWithBots(el){
  CFG.fillWithBots=!CFG.fillWithBots;
  el?.classList.toggle('on', CFG.fillWithBots);
  syncTableSizeLabels();
}

function renderTable(){
  const gameRoom=document.getElementById('gameRoom');
  if(gameRoom) gameRoom.classList.toggle('table-9', tableSeatCount()===9);
  syncMobileEquityVisibility();
  syncTableSizeLabels();
  renderBlindInfo();
  renderSeats();
  renderBoard();
  renderPot();
  renderActionBar();
  renderDealerButton();
  renderReactionBtn();
}

function _chips(value){
  const number=Number(value)||0;
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
}

function _anteLabel(type, classicAnte, bba){
  if(type===TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE) return `Ante ${_chips(classicAnte)}`;
  if(type===TOURNAMENT.ANTE_TYPES.BIG_BLIND_ANTE) return `BBA ${_chips(bba)}`;
  return 'Без ante';
}

function renderBlindInfo(){
  const sb=Number(G.currentSb)||Number(CFG.sb)||25;
  const bb=Number(G.currentBb)||Number(CFG.bb)||50;
  const ante=Number(G.currentAnte)||0;
  const anteType=G.anteType||CFG.anteType;
  const blinds=document.getElementById('blindsDisplay');
  if(blinds) blinds.textContent=`${_chips(sb)} / ${_chips(bb)} · ${_anteLabel(anteType,ante,ante)}`;
  const info=document.getElementById('grInfo');
  if(info) info.textContent=`NL Hold'em ${tableSeatCount()}-Max · ${_chips(sb)}/${_chips(bb)}`;
  renderTournamentHud();
  updateBlindClockUI();
}

function renderTournamentHud(){
  const level=Math.max(1,Number(G.blindLevel)||1);
  const sb=Number(G.tournamentSb)||Number(G.currentSb)||25;
  const bb=Number(G.tournamentBb)||Number(G.currentBb)||50;
  const anteType=G.anteType||CFG.anteType;
  const ante=Number(G.tournamentAnte)||0;
  const bba=Number(G.tournamentBba)||0;
  const next=G.nextBlindLevel;
  const levelEl=document.getElementById('hudLevel');
  const blindsEl=document.getElementById('hudBlinds');
  const nextEl=document.getElementById('hudNext');
  const positionEl=document.getElementById('hudPosition');
  if(levelEl) levelEl.textContent=`Ур. ${level}`;
  if(blindsEl) blindsEl.textContent=`${_chips(sb)} / ${_chips(bb)} · ${_anteLabel(anteType,ante,bba)}`;
  if(nextEl) {
    const nextAnte=anteType===TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE?next?.ante:0;
    const nextBba=anteType===TOURNAMENT.ANTE_TYPES.BIG_BLIND_ANTE?next?.bb:0;
    nextEl.textContent=next
      ? `След.: ${_chips(next.sb)} / ${_chips(next.bb)} · ${_anteLabel(anteType,nextAnte,nextBba)}`
      : 'След.: последний уровень';
  }
  const position=Number(G.playerPosition)||(_eliminated?_elimPlace:0);
  const total=_eliminated?(Number(G.totalEntrants)||0):(Number(G.playersRemaining)||0);
  if(positionEl) positionEl.textContent=`Место: ${position||'—'} / ${total||'—'}`;
}

function updateBlindClockUI(){
  const hudTimer=document.getElementById('hudTimer');
  let remain=_blindSync ? Math.max(0,_blindSync.remain-(Date.now()-_blindSync.at)) : null;
  if(remain==null&&G.nextBlindAt) remain=Math.max(0,Number(G.nextBlindAt)-Date.now());
  if(remain==null&&Number(G.blindLevel)>=TOURNAMENT.LEVELS.length){
    if(hudTimer) hudTimer.textContent='--:--';
    return;
  }
  if(remain==null) remain=(Number(CFG.levelDurationSec)||180)*1000;
  const totalSec=Math.ceil(remain/1000);
  const min=Math.floor(totalSec/60);
  const sec=String(totalSec%60).padStart(2,'0');
  if(hudTimer) hudTimer.textContent=`${min}:${sec}`;
}
setInterval(()=>updateBlindClockUI(),1000);

function syncMobileEquityVisibility(){
  const room = document.getElementById('gameRoom');
  const mobile = !!room?.classList.contains('mobile-portrait');
  const revealing = (G.phase === 'SHOWDOWN') ||
    (G.phase !== 'WAITING' && G.actingSeat === -1 && activePlayers().length > 1);

  if(!mobile || !revealing){
    _mobileEquityVisible = true;
    _mobileEquityHand = -1;
    clearTimeout(_mobileEquityHideTimer);
    _mobileEquityHideTimer = null;
    return;
  }

  if(_mobileEquityHand === G.handNum) return;
  _mobileEquityHand = G.handNum;
  _mobileEquityVisible = true;
  clearTimeout(_mobileEquityHideTimer);
  _mobileEquityHideTimer = setTimeout(() => {
    _mobileEquityVisible = false;
    _mobileEquityHideTimer = null;
    document.querySelectorAll('#gameRoom.mobile-portrait .pk-equity-bubble').forEach(el => el.remove());
  }, 2000);
}

function renderDealerButton(){
  const tableEl = document.querySelector('.big-table');
  if(!tableEl) return;

  let el = document.getElementById('dealerBtnEl');
  const shouldShow = G.phase !== 'WAITING' && G.seats[G.dealerSeat] != null;

  if(!shouldShow){
    if(el) el.style.display = 'none';
    return;
  }

  if(!el){
    el = document.createElement('div');
    el.id = 'dealerBtnEl';
    el.className = 'pk-dealer';
    el.textContent = 'D';
    tableEl.appendChild(el);
  }

  const seatCount=tableSeatCount();
  const dealerVisual = G.userSeat >= 0 ? (G.dealerSeat - G.userSeat + seatCount) % seatCount : G.dealerSeat;
  const mobilePortrait = document.getElementById('gameRoom')?.classList.contains('mobile-portrait');
  const positions=seatCount===9
    ? (mobilePortrait ? DEALER_BTN_POS_9_MOBILE : DEALER_BTN_POS_9)
    : DEALER_BTN_POS_6;
  el.style.cssText = `position:absolute;z-index:200;display:flex;${positions[dealerVisual]};`;
  if(G.dealerSeat !== _prevDealerSeat){
    el.classList.remove('pk-dealer-new');
    void el.offsetWidth; // force reflow to restart animation
    el.classList.add('pk-dealer-new');
    _prevDealerSeat = G.dealerSeat;
  } else {
    el.style.display = 'flex';
  }
}

// ═══════════════════════════════════════════════════════
//  REACTIONS
// ═══════════════════════════════════════════════════════
// Seat 0 at bottom:-80px in big-table (1540×840).
// pk-plate (~70px) → plate center at bottom ≈ -45px from big-table bottom
// pk-body center (avatar) → at bottom ≈ 62px from big-table bottom
const _RX_BTN_STYLE = 'bottom:-45px;left:calc(50% - 155px)'; // left of name plate
let _reactionLocked = false; // only one reaction at a time
const _activeReactionEls = [];

function renderReactionBtn(){
  const tableEl = document.querySelector('.big-table');
  if(!tableEl) return;
  const roomEl = document.querySelector('.gr-room');
  const mobilePortrait = document.getElementById('gameRoom')?.classList.contains('mobile-portrait');
  const hostEl = mobilePortrait ? roomEl : tableEl;
  let btn = document.getElementById('reactionBtnEl');
  const shouldShow = G.phase !== 'WAITING' && G.userSeat !== -1 && G.seats[G.userSeat] != null;
  if(!shouldShow){
    if(btn) btn.style.display = 'none';
    hideReactionPicker();
    return;
  }
  if(!btn){
    btn = document.createElement('div');
    btn.id = 'reactionBtnEl';
    btn.className = 'reaction-btn';
    btn.innerHTML = '😊';
    btn.onclick = e => {
      e.stopPropagation();
      if (_tablePreviewMode) openPreviewEditor('reactions');
      else toggleReactionPicker();
    };
    hostEl.appendChild(btn);
  }
  if(btn.parentElement !== hostEl) hostEl.appendChild(btn);
  btn.classList.toggle('mobile-reaction-btn', mobilePortrait);
  if(mobilePortrait){
    const roomRect=roomEl.getBoundingClientRect();
    const heroEl=tableEl.querySelector('.you-seat');
    const heroAnchor=heroEl?.querySelector('.pk-ava') || heroEl;
    const heroRect=heroAnchor?.getBoundingClientRect();
    const buttonSize=56;
    const left=heroRect
      ? Math.max(6,Math.min(roomRect.width-buttonSize-6,heroRect.left-roomRect.left-buttonSize-8))
      : 6;
    const top=heroRect
      ? Math.max(6,Math.min(roomRect.height-buttonSize-6,heroRect.top-roomRect.top+(heroRect.height-buttonSize)/2))
      : roomRect.height-buttonSize-6;
    btn.style.cssText=`position:absolute;z-index:700;display:flex;left:${left}px;top:${top}px;`;
  } else {
    btn.style.cssText=`position:absolute;z-index:210;display:flex;${_RX_BTN_STYLE};`;
  }
}

// Draw one static frame of a GIF/image onto a canvas (prevents GIF animation in previews)
function _staticPreviewCanvas(dataUrl, size){
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.style.cssText = `width:${size}px;height:${size}px;display:block;`;
  const img = new Image();
  img.onload = () => {
    // Draw at load time — captures the first decoded frame before animation advances
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth  - s) / 2;
    const sy = (img.naturalHeight - s) / 2;
    canvas.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size, size);
  };
  img.src = dataUrl;
  return canvas;
}

// In-game picker — read-only selection only
function _buildPickerItems(){
  const all = [...CFG.reactions, ...CFG.customReactions];
  return all.map((r, i) => {
    const isImg = i >= CFG.reactions.length;
    const div = document.createElement('div');
    div.className = 'rp-item';
    div.dataset.idx = i;
    div.dataset.type = isImg ? 'img' : 'emoji';
    div.onclick = () => _rpClick(div);
    if(isImg){
      div.appendChild(_staticPreviewCanvas(r, 32));
    } else {
      div.textContent = r;
    }
    return div;
  });
}

function toggleReactionPicker(){
  const existing = document.getElementById('reactionPickerEl');
  if(existing){ existing.remove(); document.removeEventListener('click', _closePickerOutside); return; }
  const tableEl = document.querySelector('.big-table');
  if(!tableEl) return;
  const roomEl = document.querySelector('.gr-room');
  const mobilePortrait = document.getElementById('gameRoom')?.classList.contains('mobile-portrait');
  const btn = document.getElementById('reactionBtnEl');
  const picker = document.createElement('div');
  picker.id = 'reactionPickerEl';
  picker.className = 'reaction-picker';
  const all = [...CFG.reactions, ...CFG.customReactions];
  if(!all.length){
    picker.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:4px 0;">Нет реакций</div>';
  } else {
    const grid = document.createElement('div');
    grid.className = 'rp-grid';
    _buildPickerItems().forEach(item => grid.appendChild(item));
    picker.appendChild(grid);
  }
  (mobilePortrait ? roomEl : tableEl).appendChild(picker);
  picker.classList.toggle('mobile-reaction-picker', mobilePortrait);
  picker.style.cssText = mobilePortrait
    ? 'position:absolute;z-index:520;left:50%;bottom:212px;transform:translateX(-50%);'
    : 'position:absolute;z-index:400;left:500px;bottom:0px;';
  setTimeout(()=>{ document.addEventListener('click', _closePickerOutside); }, 0);
}

function _rpClick(el){
  const idx = +el.dataset.idx;
  const type = el.dataset.type;
  const all = [...CFG.reactions, ...CFG.customReactions];
  const val = all[idx];
  fireReaction(val, type);
}

// Settings page reaction management
function renderSettingsReactions(){
  const grid = document.getElementById('settingsReactionsGrid');
  if(!grid) return;
  grid.innerHTML = '';
  const all = [...CFG.reactions, ...CFG.customReactions];
  all.forEach((r, i) => {
    const isImg = i >= CFG.reactions.length;
    const item = document.createElement('div');
    item.className = 'settings-rx-item';
    if(isImg){
      item.appendChild(_staticPreviewCanvas(r, 28));
    } else {
      item.textContent = r;
    }
    const del = document.createElement('div');
    del.className = 'settings-rx-del';
    del.textContent = '✕';
    del.onclick = () => removeSettingsReaction(i);
    item.appendChild(del);
    grid.appendChild(item);
  });
  if (_tablePreviewMode && document.getElementById('previewEditorPanel')?.dataset.editor === 'reactions') {
    renderPreviewReactionsEditor();
  }
}

function removeSettingsReaction(idx){
  if(idx < CFG.reactions.length) CFG.reactions.splice(idx,1);
  else CFG.customReactions.splice(idx-CFG.reactions.length,1);
  renderSettingsReactions();
}

function _closePickerOutside(e){
  const picker = document.getElementById('reactionPickerEl');
  if(!picker){ document.removeEventListener('click', _closePickerOutside); return; }
  if(!picker.contains(e.target) && e.target.id !== 'reactionBtnEl'){
    picker.remove();
    document.removeEventListener('click', _closePickerOutside);
  }
}

function hideReactionPicker(){
  const p = document.getElementById('reactionPickerEl');
  if(p) p.remove();
  document.removeEventListener('click', _closePickerOutside);
}

function _dataUrlToFreshObjectUrl(dataUrl){
  // Creates a unique Blob URL so GIFs always restart from frame 0
  if(typeof dataUrl!=='string'||!dataUrl.startsWith('data:')) return dataUrl;
  try{
    const arr=dataUrl.split(',');
    const mime=arr[0].match(/:(.*?);/)[1];
    const bstr=atob(arr[1]);
    const u8=new Uint8Array(bstr.length);
    for(let i=0;i<bstr.length;i++) u8[i]=bstr.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8],{type:mime}));
  }catch(e){ return dataUrl; }
}

function fireReaction(content, type){
  if(_reactionLocked) return;
  _reactionLocked = true;
  hideReactionPicker();
  _fireReactionAtSeat(G.userSeat, content, type, true);
  // Broadcast reaction to other players via server
  if(socket) socket.emit('reaction', { content, type });
}

function fireBotReaction(physicalSeat, content, type){
  _fireReactionAtSeat(physicalSeat, content, type, false);
}

function toggleGameChat(force){
  const chat = document.getElementById('gameChat');
  if(!chat) return;
  _chatOpen = typeof force === 'boolean' ? force : !_chatOpen;
  chat.classList.toggle('open', _chatOpen);
  if(_chatOpen){
    _chatUnread = 0;
    updateChatUnread();
    renderGameChat();
    if(!_isMobileTableView()) setTimeout(() => document.getElementById('gameChatInput')?.focus(), 0);
  }
}

function updatePendingTournamentEntry(forcePending){
  const gameRoom=document.getElementById('gameRoom');
  if(!gameRoom) return;
  let stored=null;
  try{ stored=JSON.parse(localStorage.getItem('pokerPendingTournamentEntry')||'null'); }catch(e){}
  const pending=forcePending || (!!stored && Date.now()-(stored.at||0)<6*60*60*1000 && G.userSeat<0);
  let badge=document.getElementById('pendingTournamentEntry');
  if(!pending){ badge?.remove(); return; }
  if(!badge){
    badge=document.createElement('div');
    badge.id='pendingTournamentEntry';
    badge.className='pending-tournament-entry';
    gameRoom.appendChild(badge);
  }
  badge.innerHTML='<b>Вы зарегистрированы</b><span>Вы вступите в игру со следующей раздачи</span>';
}

function updateChatUnread(){
  const badge = document.getElementById('gameChatUnread');
  if(!badge) return;
  badge.textContent = _chatUnread > 99 ? '99+' : String(_chatUnread || '');
  badge.classList.toggle('show', _chatUnread > 0);
}

function renderGameChat(){
  const list = document.getElementById('gameChatMessages');
  if(!list) return;
  if(!_chatMessages.length){
    list.innerHTML = '<div class="game-chat-empty">Сообщений пока нет</div>';
    return;
  }
  list.innerHTML = _chatMessages.map(message => {
    const mine = Number(message.seatIdx) === G.userSeat && G.userSeat >= 0;
    return `<div class="game-chat-msg ${mine?'mine':''}"><span class="game-chat-name">${_esc(message.name || 'Зритель')}:</span>${_esc(message.text || '')}</div>`;
  }).join('');
  list.scrollTop = list.scrollHeight;
}

function showSeatChatBubble(message){
  const seatIdx = Number(message?.seatIdx);
  if(!Number.isInteger(seatIdx) || seatIdx < 0) return;
  const seat = document.querySelector(`.big-table .pk-seat[data-seat="${seatIdx}"]`);
  if(!seat) return;

  const previous = _seatChatTimers.get(seatIdx);
  if(previous){
    clearInterval(previous.typing);
    clearTimeout(previous.remove);
    previous.bubble?.remove();
  }

  const bubble = document.createElement('div');
  bubble.className = 'seat-chat-bubble';
  const text = document.createElement('div');
  text.className = 'seat-chat-bubble-text';
  bubble.append(text);

  const avatar = seat.querySelector('.pk-ava');
  const table = document.querySelector('.big-table');
  const room = document.querySelector('.gr-room');
  if(!avatar || !table || !room) return;
  const avatarRect = avatar.getBoundingClientRect();
  const mobile = document.getElementById('gameRoom')?.classList.contains('mobile-portrait');
  if(mobile){
    const roomRect = room.getBoundingClientRect();
    const rawCx = avatarRect.left + avatarRect.width/2 - roomRect.left;
    const cx = Math.max(76,Math.min(roomRect.width-76,rawCx));
    const top = Math.max(62,avatarRect.top - roomRect.top - 8);
    bubble.style.cssText = `left:${cx}px;top:${top}px;`;
    room.appendChild(bubble);
  } else {
    const tableRect = table.getBoundingClientRect();
    const scale = tableRect.width/table.offsetWidth || 1;
    const rawCx = (avatarRect.left + avatarRect.width/2 - tableRect.left)/scale;
    const cx = Math.max(115,Math.min(table.offsetWidth-115,rawCx));
    const top = Math.max(70,(avatarRect.top - tableRect.top)/scale - 12);
    bubble.style.cssText = `left:${cx}px;top:${top}px;`;
    table.appendChild(bubble);
  }

  const chars = Array.from(String(message.text || '').slice(0,200));
  text.textContent = chars.join('');
  const record = { typing:null, remove:null, bubble };
  record.remove = setTimeout(() => {
    bubble.remove();
    _seatChatTimers.delete(seatIdx);
  },Math.min(5500,2200+chars.length*20));
  _seatChatTimers.set(seatIdx,record);
}

function submitGameChat(event){
  event?.preventDefault();
  const input = document.getElementById('gameChatInput');
  const text = input?.value.trim();
  if(!text) return false;
  const name = G.seats[G.userSeat]?.name || localStorage.getItem('pokerName') || 'Зритель';
  if(socket && _inMultiplayer){
    socket.emit('chatMessage', { text, name });
  } else {
    const message = { id: `local-${Date.now()}`, seatIdx: G.userSeat, name, text, at: Date.now() };
    _chatMessages.push(message);
    if(_chatMessages.length > 60) _chatMessages.shift();
    showSeatChatBubble(message);
    renderGameChat();
  }
  input.value = '';
  return false;
}

function _fireReactionAtSeat(seatIdx, content, type, isUser){
  const tableEl = document.querySelector('.big-table');
  if(!tableEl) { if(isUser) _reactionLocked=false; return; }
  const seatEl = tableEl.querySelector(`[data-seat="${seatIdx}"]`);
  if(!seatEl) { if(isUser) _reactionLocked=false; return; }
  const avaEl = seatEl.querySelector('.pk-ava');
  if(!avaEl) { if(isUser) _reactionLocked=false; return; }

  const tableRect = tableEl.getBoundingClientRect();
  const avaRect = avaEl.getBoundingClientRect();
  const mobilePortrait = document.getElementById('gameRoom')?.classList.contains('mobile-portrait');
  const roomEl = document.querySelector('.gr-room');
  const hostEl = mobilePortrait ? roomEl : tableEl;
  const BOX = type === 'emoji' ? (mobilePortrait ? 145 : 205) : (mobilePortrait ? 180 : 280);
  const el = document.createElement('div');

  const previousForSeat=_activeReactionEls.find(entry=>entry.seatIdx===seatIdx);
  previousForSeat?.remove();
  const limit=mobilePortrait?2:3;
  while(_activeReactionEls.length>=limit) _activeReactionEls[0]?.remove();

  if(mobilePortrait){
    const roomRect = roomEl.getBoundingClientRect();
    const cx = avaRect.left + avaRect.width / 2 - roomRect.left;
    const cy = avaRect.top + avaRect.height / 2 - roomRect.top;
    const left = Math.max(4, Math.min(roomRect.width - BOX - 4, cx - BOX / 2));
    const top = Math.max(4, Math.min(roomRect.height - BOX - 4, cy - BOX / 2 - 22));
    el.style.cssText = `position:absolute;top:${top}px;left:${left}px;width:${BOX}px;height:${BOX}px;z-index:530;pointer-events:none;`;
  } else {
    // Convert screen coordinates back to the unscaled desktop table coordinate space.
    const scale = tableRect.width / tableEl.offsetWidth || 1;
    const cx = (avaRect.left + avaRect.width / 2 - tableRect.left) / scale;
    const cy = (avaRect.top + avaRect.height / 2 - tableRect.top) / scale;
    el.style.cssText = `position:absolute;top:${cy - BOX/2 - 30}px;left:${cx - BOX/2 + 5}px;z-index:300;pointer-events:none;`;
  }
  
  const originalRemove=el.remove.bind(el);
  let released=false;
  let entry=null;
  const unlock = ()=>{
    if(released) return;
    released=true;
    if(isUser) _reactionLocked=false;
    const index=_activeReactionEls.indexOf(entry);
    if(index>=0) _activeReactionEls.splice(index,1);
    originalRemove();
  };
  entry={seatIdx,remove:unlock};
  _activeReactionEls.push(entry);

  if(type === 'img'){
    const isGif = /^data:image\/gif/i.test(content) || /\.gif(?:\?|$)/i.test(content);
    el.className = isGif ? 'reaction-float reaction-float-gif' : 'reaction-float';
    const objUrl = _dataUrlToFreshObjectUrl(content);
    const img = document.createElement('img');
    img.src = objUrl;
    img.style.cssText = `height:${BOX}px;width:${BOX}px;object-fit:contain;display:block;`;
    el.appendChild(img);
    el.addEventListener('animationend', ()=>{
      if(objUrl.startsWith?.('blob:')) URL.revokeObjectURL(objUrl);
      unlock();
    });
  } else {
    el.className = 'reaction-float emoji-std';
    if(mobilePortrait) el.style.fontSize='126px';
    el.textContent = content;
    el.addEventListener('animationend', unlock);
  }
  hostEl.appendChild(el);
}

// ═══════════════════════════════════════════════════════
//  TABLE EFFECTS — ROCKET ATTACK
// ═══════════════════════════════════════════════════════
const _effectAudios = new Set();
const _effectSoundLastPlayed = new Map();
const ROCKET_ASSET_PATHS = Object.freeze({
  rocket: '/effects/texas-rocket.png',
  reticle: '/effects/texas-reticle.png',
  chips: '/effects/texas-chip-set.png',
  icon: '/effects/texas-rocket-icon.png'
});
const ROCKET_EXPLOSION_TOTAL_MS = 1_050;
const ROCKET_CHIP_SPRITES = Object.freeze([
  { x:46,  y:65,  w:445, h:430 },
  { x:500, y:65,  w:370, h:350 },
  { x:875, y:160, w:365, h:385 },
  { x:50,  y:540, w:445, h:335 },
  { x:500, y:450, w:215, h:450 },
  { x:790, y:560, w:445, h:420 },
  { x:45,  y:870, w:465, h:340 },
  { x:615, y:955, w:500, h:270 }
]);
const _rocketAssets = {};
function preloadTableEffects(){
  for(const key of ['rocket','reticle','chips']){
    if(_rocketAssets[key]) continue;
    const image=new Image();
    image.decoding='async';
    image.src=ROCKET_ASSET_PATHS[key];
    _rocketAssets[key]=image;
  }
}

function setEffectsEnabled(enabled){
  _effectsEnabled = !!enabled;
  localStorage.setItem('pokerEffectsEnabled', _effectsEnabled ? '1' : '0');
  if(!_effectsEnabled){
    document.getElementById('tableEffectsLayer')?.replaceChildren();
    document.querySelectorAll('.pk-ava.rocket-target-hit').forEach(el => el.classList.remove('rocket-target-hit'));
  }
  syncEffectsSettingsUI();
}

function setEffectsSoundEnabled(enabled){
  _effectsSoundEnabled = !!enabled;
  localStorage.setItem('pokerEffectsSoundEnabled', _effectsSoundEnabled ? '1' : '0');
  if(!_effectsSoundEnabled) stopEffectSounds();
  syncEffectsSettingsUI();
}

function syncEffectsSettingsUI(){
  const effects = document.getElementById('effectsEnabledToggle');
  const sound = document.getElementById('effectsSoundToggle');
  if(effects) effects.checked = _effectsEnabled;
  if(sound) sound.checked = _effectsSoundEnabled;
}

function toggleEffectsSettings(event, force){
  event?.stopPropagation?.();
  closePlayerContextMenu();
  const panel = document.getElementById('effectsSettingsPanel');
  if(!panel) return;
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('show');
  panel.classList.toggle('show', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  syncEffectsSettingsUI();
}

function playEffectSound(path, volume=0.35, minIntervalMs=0){
  if(!_effectsSoundEnabled || isMuted || masterVolume === 0) return;
  const now = Date.now();
  if(minIntervalMs > 0 && now - (_effectSoundLastPlayed.get(path) || 0) < minIntervalMs) return;
  _effectSoundLastPlayed.set(path, now);
  const audio = new Audio(path);
  audio.preload = 'auto';
  audio.loop = false;
  audio._effectVolumeFactor = volume;
  audio.volume = Math.min(1, Math.max(0, masterVolume * volume));
  _effectAudios.add(audio);
  const release = () => _effectAudios.delete(audio);
  audio.addEventListener('ended', release, { once:true });
  audio.addEventListener('error', release, { once:true });
  audio.play().catch(release);
}

function stopEffectSounds(){
  _effectAudios.forEach(audio => {
    audio.pause();
    audio.currentTime = 0;
  });
  _effectAudios.clear();
}

function _seatElementByPlayerId(playerId){
  return [...document.querySelectorAll('.big-table .pk-seat[data-player-id]')]
    .find(el => el.dataset.playerId === playerId) || null;
}

function _targetAvatarByPlayerId(playerId){
  return _seatElementByPlayerId(playerId)?.querySelector('.pk-ava') || null;
}

function closePlayerContextMenu(){
  const menu = document.getElementById('playerContextMenu');
  if(!menu) return;
  clearInterval(_rocketMenuCooldownTimer);
  _rocketMenuCooldownTimer = null;
  menu.classList.remove('show');
  menu.classList.remove('rocket-menu');
  menu.setAttribute('aria-hidden','true');
  menu.replaceChildren();
  _rocketMenuSeat = -1;
}

function updateRocketMenuCooldown(){
  const menu = document.getElementById('playerContextMenu');
  const button = menu?.querySelector('.player-context-action');
  const icon = button?.querySelector('.player-context-effect-icon');
  const timer = button?.querySelector('.rocket-cooldown-time');
  if(!button || !icon || !timer || _rocketMenuSeat < 0) return;
  const remaining = Math.max(0, _rocketCooldownUntil - Date.now());
  const progress = 1 - Math.min(1, remaining / 10_000);
  button.disabled = remaining > 0;
  button.classList.toggle('cooling', remaining > 0);
  button.setAttribute('aria-label', remaining > 0
    ? `Ракета перезаряжается: ${Math.ceil(remaining / 1000)} секунд`
    : 'Запустить ракету');
  icon.style.setProperty('--cooldown-angle', `${progress * 360}deg`);
  timer.textContent = remaining > 0 ? String(Math.ceil(remaining / 1000)) : '';
  if(remaining <= 0 && _rocketMenuCooldownTimer){
    clearInterval(_rocketMenuCooldownTimer);
    _rocketMenuCooldownTimer = null;
  }
}

function openPlayerContextMenu(event, seatIdx){
  event?.stopPropagation?.();
  const seat = G.seats[seatIdx];
  if(!seat || seatIdx === G.userSeat || G.userSeat < 0 || G.gameOver) return;
  if(seat.connected === false && !seat.isBot){ toast('Игрок не в сети'); return; }
  const avatar = event?.currentTarget?.classList?.contains('pk-ava')
    ? event.currentTarget : document.querySelector(`.pk-seat[data-seat="${seatIdx}"] .pk-ava`);
  const room = document.querySelector('.gr-room');
  const menu = document.getElementById('playerContextMenu');
  if(!avatar || !room || !menu) return;

  toggleEffectsSettings(null, false);
  _rocketMenuSeat = seatIdx;
  menu.classList.add('rocket-menu');
  menu.innerHTML = `
    <button class="player-context-action rocket-only" type="button" role="menuitem" aria-label="Запустить ракету" title="Ракета" onclick="launchRocketAttack(${seatIdx})">
      <span class="player-context-effect-icon">
        <img src="${ROCKET_ASSET_PATHS.icon}" alt="">
        <i class="rocket-cooldown-wipe"></i>
        <b class="rocket-cooldown-time"></b>
      </span>
    </button>`;
  updateRocketMenuCooldown();
  if(_rocketCooldownUntil > Date.now()){
    _rocketMenuCooldownTimer = setInterval(updateRocketMenuCooldown, 100);
  }
  menu.classList.add('show');
  menu.setAttribute('aria-hidden','false');

  const roomRect = room.getBoundingClientRect();
  const avatarRect = avatar.getBoundingClientRect();
  const desiredLeft = avatarRect.left + avatarRect.width/2 - roomRect.left + 18;
  const desiredTop = avatarRect.top + avatarRect.height/2 - roomRect.top - 18;
  const left = Math.max(8, Math.min(roomRect.width - menu.offsetWidth - 8, desiredLeft));
  const top = Math.max(8, Math.min(roomRect.height - menu.offsetHeight - 8, desiredTop));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function launchRocketAttack(seatIdx){
  const target = G.seats[seatIdx];
  const targetPlayerId = target?.playerId || `local-seat-${seatIdx}`;
  if(!target || seatIdx === G.userSeat || !targetPlayerId) return closePlayerContextMenu();
  const remaining = _rocketCooldownUntil - Date.now();
  if(remaining > 0){
    toast(`Ракета перезаряжается: ${Math.ceil(remaining/1000)} сек.`);
    return closePlayerContextMenu();
  }
  closePlayerContextMenu();
  if(socket && _inMultiplayer){
    socket.emit('rocket_attack_request', {
      tableId: _currentRoomId,
      targetPlayerId,
      effectId: 'rocket_01'
    });
    return;
  }

  const fromPlayerId = G.seats[G.userSeat]?.playerId || `local-seat-${G.userSeat}`;
  _rocketCooldownUntil = Date.now() + 10_000;
  receiveTableEffect({
    eventId: `preview-${Date.now()}`,
    tableId: 'preview',
    fromPlayerId,
    targetPlayerId,
    effectId: 'rocket_01',
    serverStartTime: Date.now(),
    startDelayMs: 0
  });
}

function receiveTableEffect(effectEvent){
  if(!effectEvent || effectEvent.effectId !== 'rocket_01' || !effectEvent.eventId) return;
  if(_seenTableEffects.has(effectEvent.eventId)) return;
  _seenTableEffects.add(effectEvent.eventId);
  setTimeout(() => _seenTableEffects.delete(effectEvent.eventId), 60_000);

  const ownPublicId = G.seats[G.userSeat]?.playerId;
  if(ownPublicId && effectEvent.fromPlayerId === ownPublicId) {
    _rocketCooldownUntil = Date.now() + 10_000;
  }
  if(!_effectsEnabled) return;
  preloadTableEffects();
  const serverDelta = Number(effectEvent.serverStartTime) - (Date.now() + _serverClockOffset);
  const delay = Math.abs(serverDelta) <= 5_000
    ? Math.max(0, serverDelta)
    : Math.max(0, Math.min(500, Number(effectEvent.startDelayMs) || 0));
  const lateByMs=Math.max(0,-serverDelta);
  setTimeout(() => playRocketAttack({...effectEvent,_lateByMs:lateByMs}), delay);
}

function _rocketSeed(value){
  let hash = 2166136261;
  for(const char of String(value || 'rocket')){
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function _rocketRandom(seed){
  let state = seed || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function _createRocketExplosionModel(seed){
  const random = _rocketRandom(_rocketSeed(seed));
  return {
    lobes: Array.from({length:12}, (_, index) => ({
      angle: index * Math.PI / 6 + (random() - .5) * .28,
      reach: .72 + random() * .4,
      size: .68 + random() * .48,
      phase: random() * Math.PI * 2
    })),
    chips: Array.from({length:8}, (_, index) => ({
      angle: index * Math.PI * 2 / 8 + (random() - .5) * .78,
      distance: 72 + random() * 88,
      gravity: 20 + random() * 72,
      delay: 25 + random() * 190,
      duration: 540 + random() * 300,
      size: 74 + random() * 20,
      spin: (random() > .5 ? 1 : -1) * (Math.PI * (2.5 + random() * 3.5)),
      sprite: index % ROCKET_CHIP_SPRITES.length
    })),
    sparks: Array.from({length:12}, (_, index) => ({
      angle: index * Math.PI / 6 + (random() - .5) * .38,
      distance: 120 + random() * 58,
      delay: random() * 75,
      width: 2 + random() * 2.6
    })),
    smoke: Array.from({length:7}, (_, index) => ({
      angle: -Math.PI * .92 + index * Math.PI / 8 + (random() - .5) * .3,
      distance: 34 + random() * 42,
      radius: 30 + random() * 26,
      delay: 260 + random() * 160
    }))
  };
}

function _createRocketImpact(playbackRate=1, seed='rocket'){
  const timeScale = 1 / Math.max(.1, playbackRate);
  const impact = document.createElement('div');
  impact.className = 'rocket-impact';
  impact.style.setProperty('--rocket-flash-duration', `${110 * timeScale}ms`);
  impact.style.setProperty('--rocket-wave-duration', `${320 * timeScale}ms`);
  impact.style.setProperty('--rocket-wave-delay', `${65 * timeScale}ms`);
  impact.style.setProperty('--rocket-heat-duration', `${620 * timeScale}ms`);
  impact.innerHTML = `
    <div class="rocket-impact-flash"></div>
    <div class="rocket-shockwave"></div>
    <div class="rocket-shockwave second"></div>
    <canvas class="rocket-explosion-frames" width="384" height="384"></canvas>
    <div class="rocket-impact-vignette"></div>`;
  impact.querySelector('.rocket-explosion-frames')._rocketVfxModel = _createRocketExplosionModel(seed);
  return impact;
}

function _rocketExplosionTimeline(elapsed){
  const clamped = Math.max(0, Math.min(ROCKET_EXPLOSION_TOTAL_MS, elapsed));
  const progress = clamped / ROCKET_EXPLOSION_TOTAL_MS;
  const easeOutCubic = value => 1 - Math.pow(1 - value, 3);
  const easeInOut = value => -(Math.cos(Math.PI * value) - 1) / 2;
  const scale = .88 + .16 * easeOutCubic(Math.min(1, progress / .42));
  const fadeProgress = Math.max(0, Math.min(1, (progress - .78) / .22));
  return { progress, scale, opacity: 1 - easeInOut(fadeProgress) };
}

function _drawRocketChip(context, chip, progress){
  const travel = 1 - Math.pow(1 - progress, 3);
  const x = Math.cos(chip.angle) * chip.distance * travel;
  const y = Math.sin(chip.angle) * chip.distance * travel + chip.gravity * progress * progress;
  const rotation = chip.spin * progress;
  const perspective = .78 + Math.abs(Math.cos(rotation)) * .22;
  const alpha = progress > .78 ? 1 - (progress - .78) / .22 : 1;
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(1, perspective);
  context.globalAlpha *= Math.max(0, alpha);
  context.shadowColor = 'rgba(0,0,0,.75)';
  context.shadowBlur = 9;
  const sheet = _rocketAssets.chips;
  const sprite = ROCKET_CHIP_SPRITES[chip.sprite];
  if(sheet?.complete && sheet.naturalWidth && sprite){
    const ratio = sprite.w / sprite.h;
    const width = ratio >= 1 ? chip.size : chip.size * ratio;
    const height = ratio >= 1 ? chip.size / ratio : chip.size;
    context.drawImage(
      sheet,
      sprite.x, sprite.y, sprite.w, sprite.h,
      -width / 2, -height / 2, width, height
    );
  } else {
    context.fillStyle = chip.sprite % 2 ? '#15171c' : '#c51624';
    context.beginPath();
    context.arc(0, 0, chip.size * .35, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#f5c14c';
    context.lineWidth = 4;
    context.stroke();
  }
  context.restore();
}

function _drawProceduralRocketExplosion(canvas, elapsed){
  if(!canvas) return false;
  const context = canvas.getContext('2d');
  if(!context) return false;
  const model = canvas._rocketVfxModel || _createRocketExplosionModel('fallback');
  const clamp = value => Math.max(0, Math.min(1, value));
  const easeOut = value => 1 - Math.pow(1 - clamp(value), 3);
  const progress = clamp(elapsed / ROCKET_EXPLOSION_TOTAL_MS);
  const blast = easeOut(elapsed / 300);
  const fireAlpha = 1 - easeOut((elapsed - 420) / 520);
  const smokeAlpha = easeOut((elapsed - 250) / 280) * (1 - easeOut((elapsed - 820) / 230));
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(cx, cy);

  context.globalCompositeOperation = 'source-over';
  for(const puff of model.smoke){
    const puffProgress = clamp((elapsed - puff.delay) / 620);
    if(puffProgress <= 0) continue;
    const travel = easeOut(puffProgress);
    const x = Math.cos(puff.angle) * puff.distance * travel;
    const y = Math.sin(puff.angle) * puff.distance * travel - 28 * travel;
    const radius = puff.radius * (.35 + travel * .95);
    const gradient = context.createRadialGradient(x - radius*.2, y - radius*.2, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(125,113,101,${.42 * smokeAlpha})`);
    gradient.addColorStop(.45, `rgba(61,55,53,${.36 * smokeAlpha})`);
    gradient.addColorStop(1, 'rgba(20,19,20,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.globalCompositeOperation = 'lighter';
  const pulse = 1 + Math.sin(elapsed * .045) * .035;
  for(const lobe of model.lobes){
    const reach = (20 + 92 * blast * lobe.reach) * pulse;
    const x = Math.cos(lobe.angle + Math.sin(elapsed*.006 + lobe.phase)*.045) * reach;
    const y = Math.sin(lobe.angle + Math.sin(elapsed*.006 + lobe.phase)*.045) * reach;
    const radius = (24 + 34 * lobe.size) * (.42 + blast * .58) * (1 - progress * .34);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,250,196,${.92 * fireAlpha})`);
    gradient.addColorStop(.2, `rgba(255,188,37,${.9 * fireAlpha})`);
    gradient.addColorStop(.55, `rgba(255,63,10,${.62 * fireAlpha})`);
    gradient.addColorStop(1, 'rgba(98,4,0,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  const coreRadius = 30 + 72 * blast;
  const core = context.createRadialGradient(0, 0, 0, 0, 0, coreRadius);
  core.addColorStop(0, `rgba(255,255,238,${fireAlpha})`);
  core.addColorStop(.16, `rgba(255,225,72,${.98 * fireAlpha})`);
  core.addColorStop(.48, `rgba(255,91,9,${.82 * fireAlpha})`);
  core.addColorStop(1, 'rgba(120,4,0,0)');
  context.fillStyle = core;
  context.beginPath();
  context.arc(0, 0, coreRadius, 0, Math.PI * 2);
  context.fill();

  for(const spark of model.sparks){
    const sparkProgress = clamp((elapsed - spark.delay) / 580);
    if(sparkProgress <= 0 || sparkProgress >= 1) continue;
    const travel = easeOut(sparkProgress);
    const start = 24 + travel * spark.distance;
    const tail = Math.max(9, 28 * (1 - sparkProgress));
    const x1 = Math.cos(spark.angle) * start;
    const y1 = Math.sin(spark.angle) * start;
    const x2 = Math.cos(spark.angle) * (start - tail);
    const y2 = Math.sin(spark.angle) * (start - tail);
    context.globalAlpha = 1 - sparkProgress;
    context.strokeStyle = '#ffe981';
    context.lineWidth = spark.width;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x1, y1);
    context.stroke();
  }

  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  for(const chip of model.chips){
    const chipProgress = clamp((elapsed - chip.delay) / chip.duration);
    if(chipProgress > 0 && chipProgress < 1) _drawRocketChip(context, chip, chipProgress);
  }
  context.restore();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  canvas.dataset.progress = progress.toFixed(3);
  canvas.dataset.chips = String(model.chips.length);
  return true;
}

function playRocketAttack(effectEvent){
  const layer = document.getElementById('tableEffectsLayer');
  if(!layer || !_effectsEnabled) return;
  const explosionOnly = effectEvent?.previewExplosionOnly === true;
  const playbackRate = explosionOnly
    ? Math.max(.25, Math.min(1, Number(effectEvent.explosionPlaybackRate) || 1))
    : 1;
  const explosionSizeScale = explosionOnly
    ? Math.max(.6, Math.min(1.4, Number(effectEvent.explosionSizeScale) || 1))
    : 1;
  const flightStartMs = 700;
  const impactStartMs = explosionOnly ? 0 : 1_650;
  const effectEndMs = impactStartMs + (ROCKET_EXPLOSION_TOTAL_MS + 220) / playbackRate;
  const root = document.createElement('div');
  root.className = `rocket-effect-instance${explosionOnly ? ' preview-only' : ''}`;
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

  let lock = null;
  if(!explosionOnly){
    lock = document.createElement('div');
    lock.className = 'rocket-lock';
    lock.innerHTML = `
      <i class="rocket-lock-halo"></i>
      <img class="rocket-lock-art" src="${ROCKET_ASSET_PATHS.reticle}" alt="">
      <i class="rocket-lock-scan"></i>
      <span class="rocket-lock-center"><img src="${ROCKET_ASSET_PATHS.reticle}" alt=""></span>`;
    root.appendChild(lock);
  }
  layer.classList.toggle('reduced-motion', matchMedia('(prefers-reduced-motion: reduce)').matches);
  layer.appendChild(root);

  let projectile = null;
  let impact = null;
  let launchX = 0;
  let launchY = -100;
  let previousX = 0;
  let previousY = 0;
  let lastSmokeAt = 0;
  let lastAvatar = null;
  let lastTarget = null;
  let flightControlOne = null;
  let flightArc = 0;
  let flightArcSide = -1;
  const startedAt = performance.now() - Math.max(0,Number(effectEvent?._lateByMs)||0);

  const playerPoint = playerId => {
    const avatar = _targetAvatarByPlayerId(playerId);
    if(!avatar) return null;
    const layerRect = layer.getBoundingClientRect();
    const avatarRect = avatar.getBoundingClientRect();
    return {
      avatar,
      x: avatarRect.left + avatarRect.width/2 - layerRect.left,
      y: avatarRect.top + avatarRect.height/2 - layerRect.top,
      avatarSize: Math.max(28, Math.min(avatarRect.width, avatarRect.height)),
      width: layerRect.width,
      height: layerRect.height
    };
  };
  const targetPoint = () => playerPoint(effectEvent.targetPlayerId);

  const clearTargetHit = avatar => {
    if(!avatar) return;
    avatar.classList.remove('rocket-target-hit');
    avatar.style.removeProperty('--rocket-shake-a');
    avatar.style.removeProperty('--rocket-shake-b');
    avatar.style.removeProperty('--rocket-shake-c');
    avatar.style.removeProperty('--rocket-shake-d');
    avatar.style.removeProperty('--rocket-shake-duration');
  };

  const cleanup = () => {
    clearTargetHit(lastAvatar);
    document.querySelectorAll('.pk-ava.rocket-target-hit').forEach(clearTargetHit);
    root.remove();
  };

  const addSmokePuff = (x, y, angle, avatarSize, now) => {
    if(layer.classList.contains('reduced-motion') || now - lastSmokeAt < 27) return;
    lastSmokeAt = now;
    const puff = document.createElement('i');
    const size = avatarSize * (.27 + Math.random() * .13);
    const duration = 760 + Math.random() * 260;
    const sideways = (Math.random() - .5) * avatarSize * .26;
    puff.className = 'rocket-smoke-puff';
    puff.style.left = `${x - Math.cos(angle) * avatarSize * .28}px`;
    puff.style.top = `${y - Math.sin(angle) * avatarSize * .28}px`;
    puff.style.setProperty('--rocket-smoke-size', `${size}px`);
    puff.style.setProperty('--rocket-smoke-duration', `${duration}ms`);
    puff.style.setProperty('--rocket-smoke-opacity', String(.5 + Math.random() * .13));
    puff.style.setProperty('--rocket-smoke-x', `${-Math.cos(angle) * avatarSize * .25 - Math.sin(angle) * sideways}px`);
    puff.style.setProperty('--rocket-smoke-y', `${-Math.sin(angle) * avatarSize * .25 + Math.cos(angle) * sideways - avatarSize * .08}px`);
    root.insertBefore(puff, projectile);
    puff.addEventListener('animationend', () => puff.remove(), { once:true });
  };

  const frame = now => {
    if(!root.isConnected || !_effectsEnabled) return cleanup();
    const elapsed = now - startedAt;
    const liveTarget = targetPoint();
    if(liveTarget) lastTarget = liveTarget;
    const target = liveTarget || lastTarget;
    if(!target){
      if(elapsed < effectEndMs) requestAnimationFrame(frame);
      else cleanup();
      return;
    }
    root.style.setProperty('--rocket-lock-size', `${target.avatarSize * .75}px`);
    root.style.setProperty('--rocket-projectile-size', `${target.avatarSize * 1.35}px`);
    root.style.setProperty('--rocket-impact-size', `${target.avatarSize * .88 * explosionSizeScale}px`);
    if(lock){
      lock.style.left = `${target.x}px`;
      lock.style.top = `${target.y}px`;
    }

    if(!explosionOnly && elapsed >= flightStartMs && !projectile && elapsed < impactStartMs){
      projectile = document.createElement('div');
      projectile.className = 'rocket-projectile';
      projectile.innerHTML = `<i class="rocket-flight-aura"></i><i class="rocket-engine-glow"></i><img src="${ROCKET_ASSET_PATHS.rocket}" alt="">`;
      root.appendChild(projectile);
      const source = playerPoint(effectEvent.fromPlayerId) || {
        x: target.width * .5,
        y: target.height * .9
      };
      launchX = source.x;
      launchY = source.y;
      const risingFlight = launchY > target.y + target.avatarSize;
      flightArcSide = risingFlight ? -1 : (target.x >= launchX ? -1 : 1);
      flightArc = Math.min(280, Math.max(105, target.width * .2));
      const verticalDistance = Math.max(target.avatarSize * 2, Math.abs(launchY - target.y));
      flightControlOne = {
        x: launchX + flightArcSide * flightArc,
        y: launchY - Math.min(verticalDistance * .32, target.height * .3)
      };
      previousX = launchX;
      previousY = launchY;
    }

    if(projectile && elapsed < impactStartMs){
      const linear = Math.max(0,Math.min(1,(elapsed-flightStartMs)/(impactStartMs-flightStartMs)));
      const t = Math.pow(linear,1.35);
      const inv = 1-t;
      const verticalDistance = Math.max(target.avatarSize * 2, Math.abs(launchY - target.y));
      const controlTwo = {
        x: target.x + flightArcSide * flightArc * .62,
        y: target.y + Math.min(verticalDistance * .24, target.height * .22)
      };
      const x = inv*inv*inv*launchX
        + 3*inv*inv*t*flightControlOne.x
        + 3*inv*t*t*controlTwo.x
        + t*t*t*target.x;
      const y = inv*inv*inv*launchY
        + 3*inv*inv*t*flightControlOne.y
        + 3*inv*t*t*controlTwo.y
        + t*t*t*target.y;
      const angleRad = Math.atan2(y-previousY,x-previousX);
      const angle = angleRad*180/Math.PI;
      const scale = .58 + linear*.42;
      projectile.style.transform = `translate(${x-projectile.offsetWidth/2}px,${y-projectile.offsetHeight/2}px) rotate(${angle}deg) scale(${scale})`;
      addSmokePuff(x, y, angleRad, target.avatarSize, now);
      previousX=x; previousY=y;
    }

    if(elapsed >= impactStartMs && projectile){
      projectile.remove();
      projectile = null;
    }
    if(elapsed >= impactStartMs && !impact){
      root.querySelectorAll('.rocket-projectile').forEach(el => el.remove());
      lock?.remove();
      lock = null;
      impact = _createRocketImpact(playbackRate, effectEvent.eventId || effectEvent.targetPlayerId);
      const impactPoint = { x: target.x, y: target.y };
      impact.style.left = `${impactPoint.x}px`;
      impact.style.top = `${impactPoint.y}px`;
      root.appendChild(impact);
    }
    if(impact){
      const blastElapsed = Math.max(0, (elapsed - impactStartMs) * playbackRate);
      const timeline = _rocketExplosionTimeline(blastElapsed);
      const canvas = impact.querySelector('.rocket-explosion-frames');
      _drawProceduralRocketExplosion(canvas, blastElapsed);
      canvas.style.transform = `scale(${timeline.scale})`;
      impact.style.opacity = String(timeline.opacity);
    }
    const shakeElapsed = (elapsed - impactStartMs) * playbackRate;
    if(impact && shakeElapsed >= 0 && shakeElapsed < 230 && target.avatar?.isConnected){
      if(lastAvatar !== target.avatar){
        clearTargetHit(lastAvatar);
        lastAvatar = target.avatar;
        const amplitude = Math.max(1.5, Math.min(4, target.avatarSize * .065));
        target.avatar.style.setProperty('--rocket-shake-a', `${amplitude}px`);
        target.avatar.style.setProperty('--rocket-shake-b', `${-amplitude * .7}px`);
        target.avatar.style.setProperty('--rocket-shake-c', `${amplitude * .38}px`);
        target.avatar.style.setProperty('--rocket-shake-d', `${-amplitude * .16}px`);
        target.avatar.style.setProperty('--rocket-shake-duration', `${230 / playbackRate}ms`);
      }
      target.avatar.classList.add('rocket-target-hit');
    } else {
      clearTargetHit(lastAvatar);
    }
    if(elapsed < effectEndMs) requestAnimationFrame(frame);
    else cleanup();
  };
  requestAnimationFrame(frame);
}

function previewTexasExplosion(playbackRate=1){
  if(!_tablePreviewMode) return;
  const targetSeat = document.querySelector('.big-table .pk-seat:not(.you-seat)[data-player-id]');
  const targetPlayerId = targetSeat?.dataset.playerId;
  if(!targetPlayerId) return;
  document.querySelectorAll('.rocket-effect-instance.preview-only').forEach(el => el.remove());
  const sizeScale = Number(document.getElementById('explosionPreviewSize')?.value) || 1;
  playRocketAttack({
    targetPlayerId,
    previewExplosionOnly: true,
    explosionPlaybackRate: playbackRate,
    explosionSizeScale: sizeScale
  });
}

function onReactionFile(e){
  const files = Array.from(e.target.files);
  const slots = Math.max(0, 8 - CFG.customReactions.length);
  if(files.length > slots) toast('Максимум 8 пользовательских реакций');
  files.slice(0, slots).forEach(f => {
    if(f.size > 3*1024*1024){ toast('Максимум 3 МБ на одну реакцию'); return; }
    const r = new FileReader();
    r.onload = ev => {
      CFG.customReactions.push(ev.target.result);
      renderSettingsReactions();
      toast('Реакция добавлена ✓');
    };
    r.readAsDataURL(f);
  });
  e.target.value = '';
}

function renderSeats(){
  const container=document.getElementById('seatsEl');
  if(!container) return;
  const seatCount=tableSeatCount();
  const positions=seatCount===9 ? ORDERED_SEAT_POS_9 : ORDERED_SEAT_POS_6;
  let html='';
  G.seats.forEach((seat, idx)=>{
    const visualIdx = G.userSeat >= 0 ? (idx - G.userSeat + seatCount) % seatCount : idx;
    const pos=positions[visualIdx];
    if(!seat){
      const alreadySeated = G.userSeat >= 0 || _eliminated || G.gameOver || (_inMultiplayer && G.handNum > 0);
      if(alreadySeated){
        // Don't render empty seat as clickable
        html+=`<div class="pk-seat empty ${pos.dir}" style="${pos.style}; pointer-events:none; opacity:0.35;">
          <div class="pk-body"><div class="pk-ava"><div class="pk-init" style="font-size:18px;color:rgba(255,255,255,0.15);">+</div></div></div>
        </div>`;
      } else {
        html+=`<div class="pk-seat empty ${pos.dir}" style="${pos.style}" onclick="uiSitDown(${idx})">
          <div class="pk-body"><div class="pk-ava"><div class="pk-init" style="font-size:18px;color:rgba(255,255,255,0.2);">SEAT</div></div></div>
          <div class="empty-sit-label">CLICK TO SIT</div>
        </div>`;
      }
      return;
    }
    const isActing = idx===G.actingSeat && G.phase!=='WAITING' && G.phase!=='SHOWDOWN';
    const isYou = idx===G.userSeat;
    const isOffline = seat.connected === false && !seat.isBot;
    const avaExtra = (isActing?'active':isYou?'you':'') + (isOffline?' offline':'');
    const plateExtra = (isActing?'active ':'')+(isYou?'you ':'')+(!seat.inHand?'folded':'');
    const youSeatClass = isYou?'you-seat':'';
    const publicPlayerId = _esc(seat.playerId || `local-seat-${idx}`);
    const canTargetEffect = !isYou && G.userSeat >= 0 && !isOffline && !G.gameOver;
    const avatarEffectAttrs = canTargetEffect
      ? ` role="button" tabindex="0" title="Действия с игроком" onclick="openPlayerContextMenu(event,${idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPlayerContextMenu(event,${idx})}"`
      : '';

    // Equity bubble
    const showDueToAllIn2 = G.phase!=='WAITING' && G.phase!=='SHOWDOWN' && G.actingSeat===-1 && activePlayers().length>1;
    const mobilePortrait = document.getElementById('gameRoom')?.classList.contains('mobile-portrait');
    const showEquity = (showDueToAllIn2 || G.phase==='SHOWDOWN') &&
      (!mobilePortrait || _mobileEquityVisible) && G.equity[idx] !== undefined;
    
    let bubbleHtml = '';
    if (showEquity) {
      const eq = G.equity[idx];
      const theme = eq.isLeader ? 'win' : 'loss';
      let outsHtml = '';
      if (eq.outs && eq.outs.length > 0) {
        outsHtml = `<div class="pk-eq-outs">` + eq.outs.map(c => {
          const colorClass = (c.s==='♥'||c.s==='♦') ? 'o-r' : 'o-b';
          return `<div class="pk-out-card ${colorClass}"><span class="out-v">${c.v}</span><span class="out-s">${c.s}</span></div>`;
        }).join('') + `</div>`;
      } else if (eq.runnerRunner) {
        outsHtml = `<div class="pk-eq-runner">RUNNER-RUNNER</div>`;
      }
      bubbleHtml = `
        <div class="pk-equity-bubble ${theme} show">
          <div class="pk-eq-val">${eq.pct.toFixed(2)}%</div>
          ${outsHtml}
        </div>`;
    }

    // ─── Cards ───────────────────────────────────────────────
    // Determine animation class: only animate the FIRST time cards are shown
    let cardsHtml='';
    if(seat.cards && seat.cards.length===2 && seat.inHand){
      const firstTime = !ANIM.seatCards.has(idx);
      if(firstTime) ANIM.seatCards.add(idx);
      const animA = firstTime ? 'deal-first' : 'no-anim';
      const animB = firstTime ? 'deal-second" style="animation-delay:.2s' : 'no-anim';

      // В мультиплеере сервер скрывает чужие карты ({hidden:true}) до вскрытия
      const hasRealCards = !!(seat.cards[0] && seat.cards[0].v);
      const showDueToAllIn = (G.phase!=='WAITING' && G.phase!=='SHOWDOWN' && G.actingSeat===-1 && activePlayers().length>1);
      const isRevealing = (showDueToAllIn || G.phase==='SHOWDOWN') && !isYou;
      const firstReveal = isRevealing && !ANIM.seatRevealed.has(idx);
      if(firstReveal) ANIM.seatRevealed.add(idx);

      if((isYou || showDueToAllIn || G.phase==='SHOWDOWN') && hasRealCards){
        const c0=seat.cards[0], c1=seat.cards[1];
        // Only animate reveal the very first time this seat's cards are flipped face-up
        const cardACls = isRevealing ? (firstReveal ? 'deal-first' : 'no-anim') : animA;
        const cardBCls = isRevealing ? (firstReveal ? 'deal-second" style="animation-delay:.15s' : 'no-anim') : animB;

        cardsHtml=`<div class="pk-cards">
          <div class="pk-card face pk-card-${cardColor(c0)} ${cardACls}">
            <div class="card-v-top">${c0.v}</div>
            <div class="card-s-top">${c0.s}</div>
            <div class="card-s-big">${c0.s}</div>
          </div>
          <div class="pk-card face pk-card-${cardColor(c1)} ${cardBCls}">
            <div class="card-v-top">${c1.v}</div>
            <div class="card-s-top">${c1.s}</div>
            <div class="card-s-big">${c1.s}</div>
          </div>
        </div>`;
      } else {
        // Face-down: no animation needed on re-renders
        cardsHtml=`<div class="pk-cards"><div class="pk-card back no-anim"></div><div class="pk-card back no-anim"></div></div>`;
      }
    }

    // Avatar
    const safeName = _esc(seat.name || 'Player');
    const safeFlag = _esc(seat.flag || '🌍');
    let avaUrl = typeof seat.avatarUrl === 'string' && /^\/avatars\/[a-zA-Z0-9._-]+$/.test(seat.avatarUrl)
      ? seat.avatarUrl : null;
    if(!avaUrl && Number.isInteger(seat.avatar) && seat.avatar >= 0 && seat.avatar < AVATARS.length) avaUrl = AVATARS[seat.avatar];

    let avaInner = avaUrl
      ? `<img src="${avaUrl}" alt="${safeName}">`
      : `<div class="pk-init">${_esc((seat.name || 'P').charAt(0).toUpperCase())}</div>`;

    // Large visible bet chip structure
    let betChipHtml = '';
    if (seat.bet > 0 && G.phase !== 'WAITING') {
      const chipCount = Math.min(3, Math.ceil(seat.bet / (G.currentBb || CFG.bb || 0.10) / 5));
      let stacks = '';
      for (let i = 0; i < chipCount; i++) {
        stacks += `<div class="pk-bet-chip-disc" style="background:#c9a020; z-index:${10-i}"></div>`;
      }
      betChipHtml = `
      <div class="pk-bet-chip show">
        <div class="pk-bet-stack">${stacks}</div>
        <div class="pk-bet-amt">${formatTableAmount(seat.bet)}</div>
      </div>`;
    }

    let badgeClass='', badgeText='';
    if(seat.lastAction){
      switch(seat.lastAction){
        case 'BET':   badgeClass='bet';   badgeText='BET'; break;
        case 'RAISE': badgeClass='raise'; badgeText='RAISE'; break;
        case 'CALL':  badgeClass='call';  badgeText='CALL';  break;
        case 'FOLD':  badgeClass='fold';  badgeText='FOLD';  break;
        case 'CHECK': badgeClass='check'; badgeText='CHECK'; break;
        case 'ALL-IN':badgeClass='allin'; badgeText='ALL-IN';break;
      }
    }
    const badgeHtml = badgeText ? `<div class="pk-badge ${badgeClass} show">${badgeText}${seat.lastAction==='FOLD'?'':seat.bet>0?' '+formatTableAmount(seat.bet):''}</div>` : '';
    const timerBar = isYou
      ? `<div class="pk-plate-timer" id="userPlateTimer"></div>`
      : (isActing && _inMultiplayer ? `<div class="pk-plate-timer" id="oppPlateTimer"></div>` : '');
    const offlineHtml = isOffline ? `<div class="pk-offline-tag">НЕ В СЕТИ</div>` : '';
    const stackClass = seat.stack < (G.currentBb || CFG.bb || 0.10)*5 ? 'low' : '';

    // Комбинация — для игрока всегда, для остальных при вскрытии карт
    // Use visibleBoard (same as equity) so combo is hidden while peek card is face-down
    const visibleBoard = (G.boardPeekIdx !== undefined && G.boardPeekIdx >= 0) ? G.board.slice(0, G.boardPeekIdx) : G.board;
    const cardsVisible = isYou || showDueToAllIn2 || G.phase==='SHOWDOWN';
    const handDesc = cardsVisible && seat.inHand && seat.cards?.length===2 && seat.cards[0]?.v && visibleBoard.length>=3
      ? getHandDesc(seat.cards, visibleBoard) : null;
    const handStrHtml = handDesc ? `<div class="pk-hand-str ${isYou?'':'pk-hand-str-bot'}">${handDesc}</div>` : '';

    const nameContent = `${safeName}${isYou?' <span style="font-size:10px;opacity:0.5;">(you)</span>':''}`;

    html+=`
    <div class="pk-seat ${youSeatClass} ${handDesc?'hand-visible':''} ${pos.dir}" data-seat="${idx}" data-player-id="${publicPlayerId}" style="${pos.style}">
      ${bubbleHtml}
      <div class="pk-body">
        ${cardsHtml}
        <div class="pk-ava ${avaExtra}${canTargetEffect?' effect-targetable':''}"${avatarEffectAttrs}>${avaInner}</div>
        ${offlineHtml}
        <div class="pk-lvl">50</div>
        <div class="pk-flag">${safeFlag}</div>
      </div>
      <div class="pk-plate ${plateExtra}">
        ${badgeHtml}
        ${timerBar}
        <div class="pk-name">${nameContent}</div>
        <div class="pk-chips ${stackClass}"${isYou?' role="button" tabindex="0" title="Переключить $ / BB" onclick="toggleChipDisplayMode(event)" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleChipDisplayMode(event)}"':''}>${formatTableAmount(seat.stack)}</div>
      </div>
      ${handStrHtml}
      ${betChipHtml}
    </div>`;
  });
  container.innerHTML=html;
}

function renderBoard(){
  const el=document.getElementById('communityEl');
  if(!el) return;

  const prev = ANIM.boardShown;
  if(G.board.length === prev && G.board.length !== 0 && ANIM.peekRevealedIdx < 0) {
    return;
  }

  const peekRevealedIdx = ANIM.peekRevealedIdx;
  ANIM.peekRevealedIdx = -1;

  el.innerHTML='';
  for(let i=0; i<5; i++){
    const c = G.board[i];
    if(c){
      const isPeekRevealed = i === peekRevealedIdx;
      const isNew = i >= prev && !isPeekRevealed;
      const animClass = isNew ? 'board-anim' : 'no-anim';
      const delay = isNew ? ((i - prev) * 0.12).toFixed(2) : '0';
      const animStyle = isNew ? `animation-delay:${delay}s;` : '';

      if(i === G.boardPeekIdx){
        el.innerHTML+=`<div class="board-peek-wrap ${animClass}" style="${animStyle}" id="boardPeekWrap">
          <canvas id="boardPeekCanvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
        </div>`;
      } else {
        const cc=cardColor(c);
        el.innerHTML+=`<div class="bcard face bc-${cc} ${animClass}" style="${animStyle}">
          <div class="card-v-top">${c.v}</div>
          <div class="card-s-top">${c.s}</div>
          <div class="card-s-big">${c.s}</div>
        </div>`;
      }
    } else {
        el.innerHTML+=`<div class="bcard empty-slot"></div>`;
    }
    if(i===2) el.innerHTML+=`<div class="street-gap"></div>`;
  }

  ANIM.boardShown = G.board.length;
  if(G.boardPeekIdx >= 0) _initPeekDrag();
}

function renderPot(){
  const el=document.getElementById('potEl');
  if(!el) return;
  if(G.pot>0){
    el.style.display='flex';
    el.querySelector('.pot-badge').textContent=`Pot: ${formatTableAmount(G.pot)}`;
    // chips
    const chips=el.querySelector('.pot-chips');
    const currentBb=G.currentBb||CFG.bb||0.10;
    const stacks=[
      {color:'#c9a020',count:Math.min(5,Math.ceil(G.pot/currentBb*0.5))},
      {color:'#e05252',count:Math.min(4,Math.ceil(G.pot/currentBb*0.3))},
      {color:'#4b9fe8',count:Math.min(3,Math.ceil(G.pot/currentBb*0.2))},
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

  // Join prompt — show only when not yet seated (and not knocked out)
  const joinEl = document.getElementById('actionBarJoin');
  const spectating = _inMultiplayer && G.handNum > 0 && !seated; // игра уже идёт — наблюдатель
  if(joinEl) joinEl.style.display = (seated || _eliminated || G.gameOver || spectating) ? 'none' : 'flex';

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
        btnCall.innerHTML=`Колл<br><span class="sub" style="font-size:14px;">${formatTableAmount(toCall)}</span>`; 
        btnCall.onclick=()=>uiAction('call'); 
      }
    }


    // Update slider range
    const sl = document.getElementById('betSlider');
    const maxRaiseTo = p.bet + p.stack;
    const canRaise = p.canRaise !== false && maxRaiseTo > G.currentBet + 0.004;
    const minRaiseTo = Math.min(maxRaiseTo, G.currentBet + (G.minRaise || CFG.bb));
    sl.min = Math.round(minRaiseTo*100);
    sl.max = Math.round(maxRaiseTo*100);
    if(+sl.value < +sl.min || +sl.value > +sl.max) sl.value = sl.min;
    if(btnRaise) btnRaise.classList.toggle('inactive', !canRaise);
    if(betRow) betRow.style.opacity = canRaise ? '1' : '0.35';
    syncBetVal();

    // Restart the clock only when the turn actually changes, not on every re-render
    const turnKey = `${G.handNum}:${G.phase}:${G.actingSeat}`;
    if(_timerTurnKey !== turnKey){
      _timerTurnKey = turnKey;
      startTimer();
    }
  } else {
    _timerTurnKey = null;
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
           lblPre2.textContent = `Колл ${formatTableAmount(toCall)}`;
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
  if(elAmt) elAmt.textContent=formatTableAmount(v);
  const raiseBtn = document.getElementById('btnRaise');
  if(raiseBtn){
     const prefix = G.currentBet===0 ? 'Бет' : 'Рейз до';
     raiseBtn.innerHTML = `${prefix}<br><span class="sub" style="font-size:14px;">${formatTableAmount(v)}</span>`;
  }
}

// ═══════════════════════════════════════════════════════
//  UI ACTIONS
// ═══════════════════════════════════════════════════════
// Tracks whether we're in multiplayer (joined a room via socket)
let _inMultiplayer = false;

function uiAction(action){
  if(G.userSeat<0||G.actingSeat!==G.userSeat) return;
  stopTimer();
  
  if(action==='check_fold'){
     const p = G.seats[G.userSeat];
     const toCall = G.currentBet - p.bet;
     action = (toCall <= 0) ? 'check' : 'fold';
  }
  
  let raiseAmt=0;
  if(action==='raise'){
    const p = G.seats[G.userSeat];
    if(!p || p.canRaise===false || p.bet+p.stack<=G.currentBet+0.004) return;
    raiseAmt=document.getElementById('betSlider').value/100;
  }

  if(_inMultiplayer && socket){
    // Multiplayer: send action to server — it will broadcastState to all clients
    socket.emit('playerAction', { action, amount: raiseAmt });
  } else {
    // Single-player: run locally
    doAction(G.userSeat, action, raiseAmt);
  }
}

function uiSetBet(pct){
  const p=G.seats[G.userSeat];
  if(!p) return;
  const toCall=G.currentBet - p.bet;
  const potAmt=G.pot+toCall;
  const sl=document.getElementById('betSlider');
  const target=G.currentBet + potAmt*pct;
  const amt=Math.max(+sl.min, Math.min(+sl.max, Math.round(target*100)));
  sl.value=amt;
  syncBetVal();
}

function uiSitDown(seatIdx){
  if(G.userSeat >= 0) return; // already seated — ignore
  if(_eliminated){ toast('Вы выбыли из игры — режим наблюдателя'); return; }
  if(G.gameOver){ toast('Игра уже завершена'); return; }
  if(_inMultiplayer && G.handNum > 0){ toast('Игра уже идёт — режим наблюдателя'); return; }
  const name = document.getElementById('playerNameInput')?.value.trim()
             || localStorage.getItem('pokerName')
             || '';
  if(!name){
    toast('Введите ваш ник в поле снизу');
    return;
  }
  G.userSeat = seatIdx;
  socket.emit('sitAtTable', {
    seatIdx,
    name,
    flag: '🏳️',
    avatarIdx: Math.floor(Math.random() * AVATARS.length),
    playerId: getPlayerId()
  });
}

// ═══════════════════════════════════════════════════════
//  FELT / LOGO APPLY
// ═══════════════════════════════════════════════════════
function _isMobileTableView(){
  const room=document.getElementById('gameRoom');
  if(room?.classList.contains('table-preview-phone')) return true;
  return !_tablePreviewMode && !!window.matchMedia?.('(max-width: 950px) and (pointer: coarse)').matches;
}

function _effectiveFeltSettings(mini){
  const mobile=!mini&&_isMobileTableView();
  if(!mobile || CFG.mobileFeltMode!=='manual'){
    return {mode:CFG.feltMode,zoom:CFG.feltZoom,overlay:CFG.feltOverlay,panX:CFG.feltPanX,panY:CFG.feltPanY};
  }
  return {
    mode:CFG.mobileFeltPhotoMode||CFG.feltMode,
    zoom:Number(CFG.mobileFeltZoom)||CFG.feltZoom,
    overlay:Number(CFG.mobileFeltOverlay)||0,
    panX:Number(CFG.mobileFeltPanX)||0,
    panY:Number(CFG.mobileFeltPanY)||0
  };
}

function _applyPhotoLayer(photoEl, overlayEl, mini){
  if(!photoEl) return;
  if(CFG.feltType==='photo'&&CFG.feltPhotoUrl){
    const settings=_effectiveFeltSettings(mini);
    const isLogo = settings.mode==='logo';
    photoEl.style.backgroundImage=`url(${CFG.feltPhotoUrl})`;
    photoEl.style.backgroundRepeat='no-repeat';
    if(isLogo){
      // Centre the image at user-controlled size; felt colour shows around it
      const sz = `auto ${settings.zoom}%`;
      photoEl.style.backgroundSize=sz;
      photoEl.style.backgroundPosition=`${50+settings.panX}% ${50+settings.panY}%`;
      photoEl.style.opacity=String(1 - settings.overlay/100);
      if(overlayEl) overlayEl.style.background='transparent';
    } else {
      // Fill: image tiles/scales to cover the felt
      photoEl.style.backgroundSize=`${settings.zoom}% ${settings.zoom}%`;
      photoEl.style.backgroundPosition=`${50+settings.panX}% ${50+settings.panY}%`;
      photoEl.style.opacity='1';
      if(overlayEl) overlayEl.style.background=`rgba(0,0,0,${settings.overlay/100})`;
    }
  } else {
    photoEl.style.opacity='0';
    if(overlayEl) overlayEl.style.background='transparent';
  }
}

function applyFelt(){
  applyRoomBackground();
  const grad=`radial-gradient(ellipse 70% 55% at 50% 40%,${CFG.feltC1} 0%,${CFG.feltC2} 35%,${CFG.feltC3} 65%,${CFG.feltC4} 100%)`;
  const bs=document.getElementById('bigFeltSurface');
  if(bs) bs.style.background=grad;
  _applyPhotoLayer(document.getElementById('bigFeltPhoto'), document.getElementById('bigFeltOverlay'), false);

  // mini preview — same logic, same function
  const ms=document.getElementById('miniFeltSurface');
  if(ms) ms.style.background=grad;
  _applyPhotoLayer(document.getElementById('miniFeltPhoto'), document.getElementById('miniFeltOverlay'), true);
}

function applyRoomBackground(){
  const c1 = CFG.roomBgC1 || '#1c1c1c';
  const c2 = CFG.roomBgC2 || '#060606';
  const angle = Number.isFinite(Number(CFG.roomBgAngle)) ? Number(CFG.roomBgAngle) : 135;
  const background = `linear-gradient(${angle}deg,${c1} 0%,${c2} 100%)`;
  const room = document.querySelector('.gr-room');
  const mini = document.querySelector('.mini-bg');
  if(room) room.style.background = background;
  if(mini) mini.style.background = background;
}

function setRoomBackground(c1,c2,angle){
  const first=document.getElementById('roomBgC1');
  const second=document.getElementById('roomBgC2');
  const slider=document.getElementById('roomBgAngle');
  if(first) first.value=c1;
  if(second) second.value=c2;
  if(slider) slider.value=angle;
  updateRoomBackground();
}

function updateRoomBackground(){
  CFG.roomBgC1=document.getElementById('roomBgC1')?.value||CFG.roomBgC1;
  CFG.roomBgC2=document.getElementById('roomBgC2')?.value||CFG.roomBgC2;
  CFG.roomBgAngle=Number(document.getElementById('roomBgAngle')?.value)||0;
  const label=document.getElementById('roomBgAngleVal');
  if(label) label.textContent=`${CFG.roomBgAngle}°`;
  applyRoomBackground();
}

function syncDefaultStackFromBb(value){
  const bb=Number(value);
  const stack=document.getElementById('cfgStack');
  if(Number.isFinite(bb)&&bb>0&&stack) stack.value=(bb*100).toFixed(2);
}

function updateTournamentSettings(){
  const speed=document.getElementById('cfgTournamentSpeed')?.value||'HYPER_TURBO';
  const anteType=document.getElementById('cfgAnteType')?.value||TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE;
  CFG.tournamentSpeed=Object.hasOwn(TOURNAMENT.PRESETS,speed)?speed:'HYPER_TURBO';
  CFG.levelDurationSec=TOURNAMENT.PRESETS[CFG.tournamentSpeed];
  CFG.anteType=Object.values(TOURNAMENT.ANTE_TYPES).includes(anteType)
    ? anteType : TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE;
}

function applyScreenLogo(){
  const el=document.getElementById('screenLogoEl');
  if(!el) return;
  const brand=String(CFG.brand||'').trim();
  const hasLogo=!!CFG.logoUrl;
  const hasName=!!brand;
  const compact=_isMobileTableView();
  const manualMobile=compact&&CFG.mobileLogoMode==='manual';
  const logoPos=manualMobile?(CFG.mobileLogoPos||CFG.logoPos):CFG.logoPos;
  const effectiveSize=manualMobile?CFG.mobileLogoSize:(compact?Math.min(CFG.logoSize,34):CFG.logoSize);
  const effectiveOffset=manualMobile?CFG.mobileLogoOffset:(compact?Math.min(CFG.logoOffset,10):CFG.logoOffset);
  const effectiveFont=manualMobile?CFG.mobileBrandFontSize:(compact?Math.min(CFG.brandFontSize,12):CFG.brandFontSize);
  el.style.display=(hasLogo||hasName)?'flex':'none';

  // position with offset
  const off=effectiveOffset+'px';
  el.style.top=off; el.style.left='auto'; el.style.right='auto'; el.style.transform='';
  if(logoPos==='top-left') el.style.left=off;
  else if(logoPos==='top-center'){ el.style.left='50%'; el.style.transform='translateX(-50%)'; }
  else el.style.right=off;

  // img or letter
  const imgEl=document.getElementById('slImgEl');
  const nameEl=document.getElementById('slNameEl');
  if(imgEl){
    imgEl.style.display=(hasLogo||hasName)?'flex':'none';
    imgEl.style.width=effectiveSize+'px'; imgEl.style.height=effectiveSize+'px';
    imgEl.style.fontSize=(effectiveSize*0.52)+'px';
    if(hasLogo){
      imgEl.style.background='transparent';
      imgEl.innerHTML=`<img src="${CFG.logoUrl}" style="width:100%;height:100%;object-fit:contain;">`;
    } else {
      imgEl.style.background='';
      imgEl.innerHTML=hasName?`<span>${_esc(CFG.brandLetter||brand.charAt(0))}</span>`:'';
    }
  }
  if(nameEl){
    nameEl.textContent=brand;
    nameEl.style.fontSize=effectiveFont+'px';
    nameEl.style.display=hasName&&(!compact||brand.length<=12)?'block':'none';
  }

  // mini badge — position only (size stays fixed in preview)
  const mb=document.getElementById('miniLogoBadge');
  if(mb){
    mb.style.display=(hasLogo||hasName)?'flex':'none';
    mb.style.top='8px'; mb.style.left='auto'; mb.style.right='auto'; mb.style.transform='';
    if(CFG.logoPos==='top-left') mb.style.left='10px';
    else if(CFG.logoPos==='top-center'){ mb.style.left='50%'; mb.style.transform='translateX(-50%)'; }
    else mb.style.right='10px';
  }
  const ml=document.getElementById('miniLogoName');
  const mi=document.getElementById('miniLogoImg');
  if(ml){ ml.textContent=brand.substring(0,12); ml.style.display=hasName?'block':'none'; }
  if(mi){
    mi.style.display=(hasLogo||hasName)?'flex':'none';
    if(hasLogo){
      mi.style.background='transparent';
      mi.innerHTML=`<img src="${CFG.logoUrl}" style="width:100%;height:100%;object-fit:contain;">`;
    } else {
      mi.style.background='';
      mi.innerHTML=hasName?`<span>${_esc(CFG.brandLetter||brand.charAt(0))}</span>`:'';
    }
  }
}

function applyFeltLogo(){
  const el=document.getElementById('feltLogoEl');
  if(!el) return;
  el.innerHTML='';
  el.style.display='none';
  if(!CFG.tableLogoVisible || (!CFG.logoUrl && !String(CFG.brand||'').trim())) return;
  el.style.display='block';
  if(CFG.logoUrl){
    el.innerHTML=`<img src="${CFG.logoUrl}" alt="">`;
  } else {
    el.textContent=CFG.brand;
  }
}

// ═══════════════════════════════════════════════════════
//  WIN DISPLAY
// ═══════════════════════════════════════════════════════
function showWin(name, amt, winnerSeatIdx, splitIdxs){
  stopAllInMusic();
  const el=document.getElementById('winFlash');
  if(!el) return;
  el.querySelector('.win-title').textContent=name.toUpperCase();
  el.querySelector('.win-sub').textContent=
    splitIdxs ? `каждый получает ${formatTableAmount(amt)} 🤝` : `wins ${formatTableAmount(amt)}! 🎉`;
  el.classList.add('show');
  sndWin();
  hideWinnerCrown();
  const tableEl = document.querySelector('.big-table');
  if(!tableEl) return;
  tableEl.classList.add('winner-visible');
  // Одиночная победа — одна корона
  const crownSeats = splitIdxs ?? (winnerSeatIdx >= 0 ? [winnerSeatIdx] : []);
  crownSeats.forEach((si, i) => {
    const seatEl = tableEl.querySelector(`[data-seat="${si}"]`);
    if(!seatEl) return;
    seatEl.classList.add('winner-seat');
    const crown = document.createElement('div');
    crown.id = i === 0 ? 'winnerCrownEl' : `winnerCrownEl_${i}`;
    crown.className = 'winner-crown';
    const face = document.createElement('span');
    face.className = 'winner-crown-face';
    face.textContent = '👑';
    crown.appendChild(face);
    seatEl.appendChild(crown);
  });
}
function hideWin(){
  const el=document.getElementById('winFlash');
  if(el) el.classList.remove('show');
  document.querySelector('.big-table')?.classList.remove('winner-visible');
  hideWinnerCrown();
  _winChips.forEach(c=>c.remove());
  _winChips=[];
}
function hideWinnerCrown(){
  document.querySelectorAll('[id^="winnerCrownEl"]').forEach(c=>c.remove());
  document.querySelectorAll('.pk-seat.winner-seat').forEach(s=>s.classList.remove('winner-seat'));
}

// ═══════════════════════════════════════════════════════
//  TOURNAMENT END OVERLAYS (elimination / victory)
// ═══════════════════════════════════════════════════════
function _esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _ensureEndOverlay(){
  let el = document.getElementById('endOverlay');
  if(!el){
    el = document.createElement('div');
    el.id = 'endOverlay';
    el.className = 'end-overlay';
    document.body.appendChild(el);
  }
  return el;
}

function showElimOverlay(place, total){
  const el = _ensureEndOverlay();
  el.innerHTML = `
    <div class="end-card">
      <div class="end-icon">💀</div>
      <div class="end-title">Вы выбыли</div>
      <div class="end-place">${place}<span class="end-place-total"> / ${total}</span></div>
      <div class="end-sub">Ваше место в турнире</div>
      <div class="end-btns">
        <button class="end-btn ghost" onclick="hideEndOverlay()">👁 Смотреть игру</button>
        <button class="end-btn" onclick="window.location.href='/'">Выйти</button>
      </div>
    </div>`;
  el.classList.add('show');
}

function showGameOverOverlay(winnerName, winnerSeat, total){
  const el = _ensureEndOverlay();
  const isYou = winnerSeat >= 0 && winnerSeat === G.userSeat;
  if(isYou) sndWin();
  // Своё место: победитель — 1, вылетевший — его место, чистый зритель — без места
  const myPlace = isYou ? 1 : (_eliminated ? _elimPlace : 0);
  const placeHtml = myPlace
    ? `<div class="end-place">${myPlace}<span class="end-place-total"> / ${total||'?'}</span></div>
      <div class="end-sub">${isYou ? 'Вы победили в турнире!' : 'Ваше место · Победитель: ' + _esc(winnerName)}</div>`
    : `<div class="end-sub">Победитель: ${_esc(winnerName)}</div>`;
  el.innerHTML = `
    <div class="end-card ${isYou ? 'win' : ''}">
      <div class="end-icon">${isYou ? '🏆' : '🏁'}</div>
      <div class="end-title">${isYou ? 'ПОБЕДА!' : 'Игра окончена'}</div>
      ${placeHtml}
      <div class="end-btns">
        <button class="end-btn" onclick="window.location.href='/'">В главное меню</button>
      </div>
    </div>`;
  el.classList.add('show');
}

function hideEndOverlay(){
  const el = document.getElementById('endOverlay');
  if(el) el.remove();
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
  const brand=(document.getElementById('cfgBrand')?.value||'').trim().toUpperCase();
  const slug=document.getElementById('cfgSlug')?.value||'my-room';
  CFG.brand=brand;
  CFG.brandLetter=brand.charAt(0)||'';
  syncTableSizeLabels();
  const brandSlug=brand.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-');
  document.querySelectorAll('#cfgUrl').forEach(url=>{
    url.innerHTML=brandSlug
      ? `pokerroom.io/<b>${brandSlug}</b>/${slug||'room'}`
      : `pokerroom.io/${slug||'room'}`;
  });
  applyScreenLogo();
  applyFelt();
  applyFeltLogo();
}

function _feltColorApply(c1,c2,c3,c4,swatchEl){
  document.querySelectorAll('.fc-swatch').forEach(s=>s.classList.remove('on'));
  if(swatchEl) swatchEl.classList.add('on');
  CFG.feltC1=c1; CFG.feltC2=c2; CFG.feltC3=c3; CFG.feltC4=c4;
  applyFelt();
}

function pickFelt(el){
  _feltColorApply(el.dataset.c1, el.dataset.c2, el.dataset.c3, el.dataset.c4||el.dataset.c3, el);
}

function onCustomFeltColor(hex){
  // derive 4 gradient stops: lighten/darken base color
  function h2rgb(h){ return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]; }
  function blend(h,t,w){ return '#'+h2rgb(h).map(v=>Math.round(v+(w-v)*t).toString(16).padStart(2,'0')).join(''); }
  const c1=blend(hex,0.35,255), c2=blend(hex,0.15,255), c3=hex, c4=blend(hex,0.30,0);
  const sw=document.getElementById('fcCustomSwatch');
  if(sw) sw.style.background=c3;
  _feltColorApply(c1,c2,c3,c4,sw);
}

let _pendingFeltFile = null;
let _pendingLogoFile = null;

function onFeltFile(e){
  const f=e.target.files[0]; if(!f) return;
  _pendingFeltFile = f;
  e.target.value=''; // reset so same file can be re-selected
  if(f.size>5*1024*1024){ toast('File too large (max 5MB)'); return; }
  const r=new FileReader();
  r.onload=ev=>{
    CFG.feltPhotoUrl=ev.target.result; CFG.feltType='photo';
    const img=document.getElementById('feltPrevImg');
    img.src=CFG.feltPhotoUrl; img.classList.add('show');
    document.getElementById('feltUpZone').classList.add('has-file');
    document.getElementById('feltSliders').style.display='block';
    document.querySelectorAll('.fc-swatch').forEach(s=>s.classList.remove('on'));
    applyFelt();
    if(_tablePreviewMode && document.getElementById('previewEditorPanel')?.dataset.editor==='felt') openPreviewEditor('felt');
    toast('Background uploaded ✓');
  };
  r.readAsDataURL(f);
}

function onLogoFile(e){
  const f=e.target.files[0]; if(!f) return;
  e.target.value='';
  if(f.size>2*1024*1024){ toast('Logo too large (max 2MB)'); return; }
  _pendingLogoFile = f;
  const r=new FileReader();
  r.onload=ev=>{
    CFG.logoUrl=ev.target.result;
    const img=document.getElementById('logoPrevImg');
    img.src=CFG.logoUrl; img.classList.add('show');
    document.getElementById('logoUpZone').classList.add('has-file');
    const removeButton=document.getElementById('removeLogoButton');
    if(removeButton) removeButton.style.display='block';
    applyScreenLogo(); applyFeltLogo();
    if(_tablePreviewMode && document.getElementById('previewEditorPanel')?.dataset.editor==='logo') openPreviewEditor('logo');
    toast('Logo uploaded ✓');
  };
  r.readAsDataURL(f);
}

function _syncFeltInput(handlerName, value){
  const input=document.querySelector(`#step1 input[oninput*="${handlerName}"]`);
  if(input) input.value=value;
}
function onFeltOverlay(v){ CFG.feltOverlay=+v; _syncFeltInput('onFeltOverlay',v); document.getElementById('overlayVal').textContent=v+'%'; applyFelt(); }
function onFeltZoom(v){ CFG.feltZoom=+v; _syncFeltInput('onFeltZoom',v); document.getElementById('zoomVal').textContent=v+'%'; applyFelt(); }
function onFeltPanX(v){ CFG.feltPanX=+v; _syncFeltInput('onFeltPanX',v); document.getElementById('panXVal').textContent=v+'%'; applyFelt(); }
function onFeltPanY(v){ CFG.feltPanY=+v; _syncFeltInput('onFeltPanY',v); document.getElementById('panYVal').textContent=v+'%'; applyFelt(); }
function onFeltMode(mode){
  CFG.feltMode=mode;
  document.querySelectorAll('.felt-mode-btn').forEach(b=>b.classList.toggle('on', b.dataset.mode===mode));
  // Adjust zoom slider range and default per mode
  const sl=document.getElementById('feltZoomSlider');
  const lbl=document.getElementById('zoomLbl');
  const ovLbl=document.getElementById('overlayLbl');
  const overlaySl=document.querySelector('[oninput*="onFeltOverlay"]');
  const panXSl=document.querySelector('[oninput*="onFeltPanX"]');
  const panYSl=document.querySelector('[oninput*="onFeltPanY"]');
  if(mode==='logo'){
    CFG.feltZoom=50; CFG.feltOverlay=0; CFG.feltPanX=0; CFG.feltPanY=0;
    if(sl){ sl.min=5; sl.max=100; sl.value=50; }
    if(overlaySl) overlaySl.value=0;
    if(panXSl) panXSl.value=0;
    if(panYSl) panYSl.value=0;
    document.getElementById('zoomVal').textContent='50%';
    document.getElementById('overlayVal').textContent='0%';
    document.getElementById('panXVal').textContent='0%';
    document.getElementById('panYVal').textContent='0%';
    if(lbl) lbl.textContent='Размер';
    if(ovLbl) ovLbl.innerHTML='Прозрачность <span class="fg-hint">0% = непрозрачно</span>';
  } else {
    CFG.feltZoom=130; CFG.feltOverlay=40; CFG.feltPanX=0; CFG.feltPanY=0;
    if(sl){ sl.min=50; sl.max=200; sl.value=130; }
    if(overlaySl) overlaySl.value=40;
    if(panXSl) panXSl.value=0;
    if(panYSl) panYSl.value=0;
    document.getElementById('zoomVal').textContent='130%';
    document.getElementById('overlayVal').textContent='40%';
    document.getElementById('panXVal').textContent='0%';
    document.getElementById('panYVal').textContent='0%';
    if(lbl) lbl.textContent='Zoom';
    if(ovLbl) ovLbl.innerHTML='Darkness <span class="fg-hint">keep cards readable</span>';
  }
  applyFelt();
}

function pickLogoPos(el){
  document.querySelectorAll('.pos-btn').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
  CFG.logoPos=el.dataset.pos;
  applyScreenLogo();
}

function onLogoSize(v){ CFG.logoSize=Math.max(1,+v); _syncNumSlider('logoSzSlider','logoSzVal',CFG.logoSize); applyScreenLogo(); }
function onLogoOffset(v){ CFG.logoOffset=Math.max(0,+v); _syncNumSlider('logoOffsetSlider','logoOffsetVal',CFG.logoOffset); applyScreenLogo(); }
function onBrandFontSize(v){ CFG.brandFontSize=Math.max(1,+v); _syncNumSlider('brandFontSzSlider','brandFontSzVal',CFG.brandFontSize); applyScreenLogo(); }
function _syncNumSlider(sliderId, inputId, val){
  const sl=document.getElementById(sliderId); if(sl) sl.value=Math.min(+sl.max,val);
  const inp=document.getElementById(inputId); if(inp) inp.value=val;
}

// ═══════════════════════════════════════════════════════
//  GAME ROOM OPEN / CLOSE
// ═══════════════════════════════════════════════════════
let _pendingRoomId = null;
let _pendingRoomCode = null;

async function openRoom(){
  // Gather final settings
  CFG.brand=(document.getElementById('cfgBrand')?.value||'').trim().toUpperCase();
  CFG.brandLetter=CFG.brand.charAt(0);
  const sbInput=document.getElementById('cfgSb')?.value;
  const bbInput=document.getElementById('cfgBb')?.value;
  const stInput=document.getElementById('cfgStack')?.value;
  if(sbInput) CFG.sb=parseFloat(sbInput)||25;
  if(bbInput) CFG.bb=parseFloat(bbInput)||50;
  if(stInput) CFG.startStack=parseFloat(stInput)||5000;
  updateTournamentSettings();
  CFG.tournamentTitle=(document.getElementById('cfgTournamentTitle')?.value||'').trim();
  CFG.tournamentDescription=(document.getElementById('cfgTournamentDescription')?.value||'').trim();
  const lateRegistrationValue=Math.round(Number(document.getElementById('cfgLateRegistrationMinutes')?.value));
  CFG.lateRegistrationMinutes=Number.isFinite(lateRegistrationValue)
    ? Math.min(120,Math.max(0,lateRegistrationValue))
    : 10;
  const maxEntrantsValue=Math.round(Number(document.getElementById('cfgMaxEntrants')?.value));
  CFG.maxEntrants=Number.isFinite(maxEntrantsValue)
    ? Math.min(2000,Math.max(CFG.maxPlayers,maxEntrantsValue))
    : 90;
  onTournamentBotCount(document.getElementById('cfgTournamentBotCount')?.value||0);
  onLobbyWaitSeconds(document.getElementById('cfgLobbyWaitSeconds')?.value||CFG.lobbyWaitSeconds);
  if(CFG.launchMode==='scheduled'){
    const localStart=document.getElementById('cfgScheduledStartAt')?.value;
    const startMs=localStart?new Date(localStart).getTime():NaN;
    if(!Number.isFinite(startMs)||startMs<Date.now()+60_000){
      goStep(3);
      toast('Выберите время начала минимум через одну минуту');
      return;
    }
    CFG.scheduledStartAt=new Date(startMs).toISOString();
    if(!CFG.tournamentTitle) CFG.tournamentTitle=CFG.brand||'Poker Tournament';
  }else{
    CFG.scheduledStartAt=null;
    CFG.tournamentTitle='';
    CFG.tournamentDescription='';
    CFG.tournamentBotCount=0;
  }

  // Multi-part form for uploads
  const formData = new FormData();
  const configToSend = {...CFG};
  delete configToSend.feltPhotoUrl; 
  delete configToSend.logoUrl;

  formData.append('config', JSON.stringify(configToSend));
  formData.append('brand', CFG.brand);

  if (_pendingFeltFile) formData.append('felt', _pendingFeltFile);
  if (_pendingLogoFile) formData.append('logo', _pendingLogoFile);

  try {
    const res = await fetch('/api/rooms', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      _pendingRoomId = data.roomId;
      _pendingRoomCode = data.code;
      const modalLabel=document.getElementById('modalRoomCodeLabel');
      const modalHint=document.getElementById('modalRoomCodeHint');
      if(modalLabel) modalLabel.textContent=data.launchMode==='scheduled'?'КОД ВАШЕГО ТУРНИРА':'КОД ВАШЕЙ КОМНАТЫ';
      if(modalHint) modalHint.textContent=data.launchMode==='scheduled'
        ? 'Отправьте участникам код или ссылку для регистрации'
        : 'Скажи этот код другим игрокам';
      // Show lobby code modal
      document.getElementById('modalRoomCode').textContent = data.code;
      const modal = document.getElementById('lobbyCodeModal');
      modal.style.display = 'flex';
    } else {
      toast("Error: " + (data.error || "Room creation failed"));
    }
  } catch(e) {
    console.error(e);
    toast("Server connection failed");
  }
}

function copyRoomCode() {
  if (_pendingRoomCode) {
    navigator.clipboard?.writeText(_pendingRoomCode).then(() => toast('Код скопирован!'));
  }
}

function copyLobbyLink() {
  if (_pendingRoomCode) {
    const url = `${window.location.origin}/lobby/${_pendingRoomCode}`;
    navigator.clipboard?.writeText(url).then(() => toast('Ссылка скопирована!'));
  }
}

function goToLobbyAsHost() {
  if (_pendingRoomCode) {
    window.location.href = `/lobby/${_pendingRoomCode}`;
  }
}

let _tablePreviewMode = false;
let _tablePreviewSnapshot = null;
let _previewDevice = 'desktop';

function previewEditFromClick(event, editor) {
  if (!_tablePreviewMode) return;
  event?.stopPropagation();
  openPreviewEditor(editor);
}

function _previewRange(label, value, min, max, handler, suffix = '') {
  return `<div class="pe-group">
    <div class="pe-label"><span>${label}</span><span class="pe-value">${value}${suffix}</span></div>
    <input class="pe-range" type="range" min="${min}" max="${max}" value="${value}"
      oninput="${handler}(this.value);this.previousElementSibling.querySelector('.pe-value').textContent=this.value+'${suffix}'">
  </div>`;
}

function openPreviewEditor(editor) {
  if (!_tablePreviewMode) return;
  const panel = document.getElementById('previewEditorPanel');
  const title = document.getElementById('previewEditorTitle');
  const body = document.getElementById('previewEditorBody');
  if (!panel || !title || !body) return;
  panel.dataset.editor = editor;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.querySelectorAll('.preview-edit-tabs button').forEach((btn, i) => {
    btn.classList.toggle('on', ['logo','felt','reactions'][i] === editor);
  });
  const phone = _previewDevice === 'phone';

  if (editor === 'logo') {
    const manual = phone && CFG.mobileLogoMode === 'manual';
    const pos = manual ? CFG.mobileLogoPos : CFG.logoPos;
    const size = manual ? CFG.mobileLogoSize : CFG.logoSize;
    const fontSize = manual ? CFG.mobileBrandFontSize : CFG.brandFontSize;
    const offset = manual ? CFG.mobileLogoOffset : CFG.logoOffset;
    const phoneMode = phone ? `<div class="pe-group pe-mobile-mode">
      <div class="pe-label">Настройки для телефона</div>
      <div class="pe-row" style="grid-template-columns:1fr 1fr">
        <button class="pe-choice ${CFG.mobileLogoMode==='auto'?'on':''}" onclick="previewSetMobileMode('logo','auto')">Авто</button>
        <button class="pe-choice ${CFG.mobileLogoMode==='manual'?'on':''}" onclick="previewSetMobileMode('logo','manual')">Вручную</button>
      </div>
    </div>` : '';
    const controls = !phone || manual ? `<div class="pe-group">
        <div class="pe-label">Расположение</div>
        <div class="pe-row">
          <button class="pe-choice ${pos==='top-left'?'on':''}" onclick="previewSetLogoPos('top-left')">Слева</button>
          <button class="pe-choice ${pos==='top-center'?'on':''}" onclick="previewSetLogoPos('top-center')">Центр</button>
          <button class="pe-choice ${pos==='top-right'?'on':''}" onclick="previewSetLogoPos('top-right')">Справа</button>
        </div>
      </div>
      ${_previewRange('Размер логотипа', size, 16, 200, 'previewLogoSize', ' px')}
      ${_previewRange('Размер названия', fontSize, 8, 60, 'previewBrandFontSize', ' px')}
      ${_previewRange('Отступ от края', offset, 0, 150, 'previewLogoOffset', ' px')}`
      : '<div class="pe-note pe-auto-note">Авто подбирает безопасный размер и отступ на основе настроек ПК, чтобы логотип не перекрывал стол.</div>';
    title.textContent = 'Логотип и название';
    body.innerHTML = `
      ${phoneMode}
      <div class="pe-group">
        <div class="pe-label">Название бренда</div>
        <input class="pe-input" maxlength="32" value="${_esc(CFG.brand || '')}" placeholder="Оставьте пустым, чтобы скрыть"
          oninput="previewBrandChange(this.value)">
      </div>
      <div class="pe-group"><button class="pe-upload" type="button" onclick="document.getElementById('logoFileInput').click()">Загрузить другое лого</button></div>
      ${controls}
      <div class="pe-group"><button class="pe-choice ${CFG.tableLogoVisible?'on':''}" style="width:100%" onclick="previewToggleFeltLogo()">Логотип на сукне: ${CFG.tableLogoVisible?'включён':'выключен'}</button></div>
      ${CFG.logoUrl?'<div class="pe-group"><button class="pe-upload" type="button" onclick="removePreviewLogo()">Удалить загруженное лого</button></div>':''}
      <div class="pe-note">Мобильный профиль применяется в горизонтальном режиме телефона. По умолчанию используется безопасная автонастройка.</div>`;
  } else if (editor === 'felt') {
    const manual = phone && CFG.mobileFeltMode === 'manual';
    const mode = manual ? CFG.mobileFeltPhotoMode : CFG.feltMode;
    const zoom = manual ? CFG.mobileFeltZoom : CFG.feltZoom;
    const overlay = manual ? CFG.mobileFeltOverlay : CFG.feltOverlay;
    const panX = manual ? CFG.mobileFeltPanX : CFG.feltPanX;
    const panY = manual ? CFG.mobileFeltPanY : CFG.feltPanY;
    const phoneMode = phone ? `<div class="pe-group pe-mobile-mode">
      <div class="pe-label">Настройки для телефона</div>
      <div class="pe-row" style="grid-template-columns:1fr 1fr">
        <button class="pe-choice ${CFG.mobileFeltMode==='auto'?'on':''}" onclick="previewSetMobileMode('felt','auto')">Авто</button>
        <button class="pe-choice ${CFG.mobileFeltMode==='manual'?'on':''}" onclick="previewSetMobileMode('felt','manual')">Вручную</button>
      </div>
    </div>` : '';
    const controls = !phone || manual ? `<div class="pe-group">
        <div class="pe-label">Режим фотографии</div>
        <div class="pe-row" style="grid-template-columns:1fr 1fr">
          <button class="pe-choice ${mode==='fill'?'on':''}" onclick="previewSetFeltMode('fill')">Заполнить</button>
          <button class="pe-choice ${mode==='logo'?'on':''}" onclick="previewSetFeltMode('logo')">По центру</button>
        </div>
      </div>
      ${_previewRange(mode==='logo'?'Размер фото':'Масштаб фото', zoom, mode==='logo'?5:50, mode==='logo'?100:200, 'previewFeltZoom', '%')}
      ${_previewRange(mode==='logo'?'Прозрачность':'Затемнение', overlay, 0, 80, 'previewFeltOverlay', '%')}
      ${_previewRange('Смещение по горизонтали', panX, -50, 50, 'previewFeltPanX', '%')}
      ${_previewRange('Смещение по вертикали', panY, -50, 50, 'previewFeltPanY', '%')}`
      : '<div class="pe-note pe-auto-note">Авто сохраняет композицию ПК и адаптирует её к горизонтальному экрану телефона.</div>';
    title.textContent = 'Фон игрового стола';
    body.innerHTML = `
      ${phoneMode}
      <div class="pe-group"><button class="pe-upload" type="button" onclick="document.getElementById('feltFileInput').click()">Загрузить другое фото</button></div>
      <div class="pe-group">
        <div class="pe-label">Цвет сукна</div>
        <input type="color" value="${CFG.feltC3}" style="width:100%;height:42px;border:0;background:transparent;cursor:pointer" oninput="previewSetFeltColor(this.value)">
      </div>
      ${controls}
      <div class="pe-note">Нажимайте на фон стола повторно, чтобы быстро вернуться к этим настройкам.</div>`;
  } else {
    title.textContent = 'GIF и реакции';
    body.innerHTML = `
      <button class="pe-upload" type="button" onclick="document.getElementById('reactionFileInput').click()">Добавить GIF / JPG / PNG</button>
      <div class="pe-reactions" id="previewReactionGrid"></div>
      <div class="pe-reaction-hint">До 3 МБ на один файл, общего лимита размера нет. Нажмите на реакцию, чтобы увидеть её над игроком; крестик удаляет её.</div>`;
    renderPreviewReactionsEditor();
  }
}

function closePreviewEditor() {
  const panel = document.getElementById('previewEditorPanel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  panel.dataset.editor = '';
  document.querySelectorAll('.preview-edit-tabs button').forEach(btn => btn.classList.remove('on'));
}

function previewBrandChange(value) {
  const input = document.getElementById('cfgBrand');
  if (input) input.value = value;
  updateCfgPreview();
  document.getElementById('grBrand').textContent = CFG.brand;
}

function previewSetLogoPos(pos) {
  if (_previewDevice === 'phone' && CFG.mobileLogoMode === 'manual') CFG.mobileLogoPos = pos;
  else {
    CFG.logoPos = pos;
    document.querySelectorAll('.pos-btn').forEach(btn => btn.classList.toggle('on', btn.dataset.pos === pos));
  }
  applyScreenLogo();
  openPreviewEditor('logo');
}

function previewSetMobileMode(kind, mode) {
  if (kind === 'logo') {
    if (mode === 'manual' && CFG.mobileLogoMode !== 'manual') {
      CFG.mobileLogoPos = CFG.logoPos;
      CFG.mobileLogoSize = Math.min(CFG.logoSize, 34);
      CFG.mobileLogoOffset = Math.min(CFG.logoOffset, 10);
      CFG.mobileBrandFontSize = Math.min(CFG.brandFontSize, 12);
    }
    CFG.mobileLogoMode = mode;
  } else {
    if (mode === 'manual' && CFG.mobileFeltMode !== 'manual') {
      CFG.mobileFeltPhotoMode = CFG.feltMode;
      CFG.mobileFeltZoom = CFG.feltZoom;
      CFG.mobileFeltOverlay = CFG.feltOverlay;
      CFG.mobileFeltPanX = CFG.feltPanX;
      CFG.mobileFeltPanY = CFG.feltPanY;
    }
    CFG.mobileFeltMode = mode;
  }
  applyScreenLogo();
  applyFelt();
  openPreviewEditor(kind);
}

function previewLogoSize(v){
  if(_previewDevice==='phone'&&CFG.mobileLogoMode==='manual') CFG.mobileLogoSize=Math.max(1,+v);
  else onLogoSize(v);
  applyScreenLogo();
}
function previewLogoOffset(v){
  if(_previewDevice==='phone'&&CFG.mobileLogoMode==='manual') CFG.mobileLogoOffset=Math.max(0,+v);
  else onLogoOffset(v);
  applyScreenLogo();
}
function previewBrandFontSize(v){
  if(_previewDevice==='phone'&&CFG.mobileLogoMode==='manual') CFG.mobileBrandFontSize=Math.max(1,+v);
  else onBrandFontSize(v);
  applyScreenLogo();
}

function previewSetFeltMode(mode){
  if(_previewDevice==='phone'&&CFG.mobileFeltMode==='manual'){
    CFG.mobileFeltPhotoMode=mode;
    CFG.mobileFeltZoom=mode==='logo'?50:130;
    CFG.mobileFeltOverlay=mode==='logo'?0:40;
    CFG.mobileFeltPanX=0;
    CFG.mobileFeltPanY=0;
    applyFelt();
  } else onFeltMode(mode);
  openPreviewEditor('felt');
}
function previewFeltZoom(v){ if(_previewDevice==='phone'&&CFG.mobileFeltMode==='manual') CFG.mobileFeltZoom=+v; else onFeltZoom(v); applyFelt(); }
function previewFeltOverlay(v){ if(_previewDevice==='phone'&&CFG.mobileFeltMode==='manual') CFG.mobileFeltOverlay=+v; else onFeltOverlay(v); applyFelt(); }
function previewFeltPanX(v){ if(_previewDevice==='phone'&&CFG.mobileFeltMode==='manual') CFG.mobileFeltPanX=+v; else onFeltPanX(v); applyFelt(); }
function previewFeltPanY(v){ if(_previewDevice==='phone'&&CFG.mobileFeltMode==='manual') CFG.mobileFeltPanY=+v; else onFeltPanY(v); applyFelt(); }

function previewToggleFeltLogo() {
  CFG.tableLogoVisible = !CFG.tableLogoVisible;
  document.getElementById('feltLogoToggle')?.classList.toggle('on', CFG.tableLogoVisible);
  applyFeltLogo();
  openPreviewEditor('logo');
}

function removePreviewLogo() {
  removeLogoAsset();
  openPreviewEditor('logo');
}

function removeConstructorLogo() {
  removeLogoAsset();
  toast('Логотип удалён');
}

function removeLogoAsset() {
  CFG.logoUrl = null;
  _pendingLogoFile = null;
  const fileInput = document.getElementById('logoFileInput');
  if (fileInput) fileInput.value = '';
  const img = document.getElementById('logoPrevImg');
  if (img) { img.src = ''; img.classList.remove('show'); }
  document.getElementById('logoUpZone')?.classList.remove('has-file');
  const removeButton = document.getElementById('removeLogoButton');
  if (removeButton) removeButton.style.display = 'none';
  applyScreenLogo();
  applyFeltLogo();
}

function previewSetFeltColor(hex) {
  const original = document.getElementById('feltCustomColor');
  if (original) original.value = hex;
  onCustomFeltColor(hex);
}

function renderPreviewReactionsEditor() {
  const grid = document.getElementById('previewReactionGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const all = [...CFG.reactions, ...CFG.customReactions];
  all.forEach((reaction, idx) => {
    const custom = idx >= CFG.reactions.length;
    const item = document.createElement('div');
    item.className = 'pe-reaction';
    item.title = 'Показать на столе';
    item.onclick = () => previewReaction(idx);
    if (custom) item.appendChild(_staticPreviewCanvas(reaction, 42));
    else item.textContent = reaction;
    const del = document.createElement('span');
    del.className = 'pe-reaction-del';
    del.textContent = '✕';
    del.onclick = event => { event.stopPropagation(); removeSettingsReaction(idx); };
    item.appendChild(del);
    grid.appendChild(item);
  });
}

function previewReaction(idx) {
  const all = [...CFG.reactions, ...CFG.customReactions];
  const reaction = all[idx];
  if (!reaction) return;
  _fireReactionAtSeat(G.userSeat, reaction, idx >= CFG.reactions.length ? 'img' : 'emoji', false);
}

function setPreviewDevice(device) {
  if (!_tablePreviewMode) return;
  _previewDevice = device === 'phone' ? 'phone' : 'desktop';
  const room = document.getElementById('gameRoom');
  room.classList.toggle('table-preview-phone', _previewDevice === 'phone');
  document.querySelectorAll('.preview-device-switch button').forEach(btn => btn.classList.toggle('on', btn.dataset.device === _previewDevice));
  applyScreenLogo();
  applyFelt();
  const editor=document.getElementById('previewEditorPanel')?.dataset.editor;
  if(editor) openPreviewEditor(editor);
  requestAnimationFrame(adjustTableScale);
}

function openTablePreview() {
  updateCfgPreview();
  const sb = parseFloat(document.getElementById('cfgSb')?.value);
  const bb = parseFloat(document.getElementById('cfgBb')?.value);
  const stack = parseFloat(document.getElementById('cfgStack')?.value);
  if (Number.isFinite(sb) && sb > 0) CFG.sb = sb;
  if (Number.isFinite(bb) && bb > 0) CFG.bb = bb;
  if (Number.isFinite(stack) && stack > 0) CFG.startStack = stack;
  updateTournamentSettings();

  _tablePreviewSnapshot = JSON.parse(JSON.stringify(G));
  _tablePreviewMode = true;
  _inMultiplayer = false;
  stopTimer();
  clearBotTimers();
  _stopBotRandomReactions();
  ANIM.reset();

  const demoSeat = (name, avatar, cards, bet = 0, lastAction = '') => ({
    name, avatar, flag: '🏳️', stack: CFG.startStack - bet, bet, contributed: bet,
    cards, inHand: true, acted: true, lastAction, connected: true, isBot: true
  });
  const unit=CFG.bb;
  const demoSeats = [
    demoSeat('You', 0, [{v:'A',s:'♠'},{v:'K',s:'♠'}], unit*3, 'CALL'),
    demoSeat('RiverKing', 1, [{hidden:true},{hidden:true}], 0, ''),
    demoSeat('LuckyAce', 2, [{hidden:true},{hidden:true}], unit*6, 'RAISE'),
    demoSeat('NightOwl', 3, [{hidden:true},{hidden:true}], 0, ''),
    demoSeat('AllInMax', 4, [{hidden:true},{hidden:true}], unit*6, 'CALL'),
    demoSeat('ChipMaster', 5, [{hidden:true},{hidden:true}], 0, 'FOLD'),
    demoSeat('AceHunter', 0, [{hidden:true},{hidden:true}], unit*3, 'CALL'),
    demoSeat('RiverFox', 1, [{hidden:true},{hidden:true}], 0, ''),
    demoSeat('QueenHigh', 2, [{hidden:true},{hidden:true}], unit*6, 'CALL')
  ];
  G.seats = demoSeats.slice(0, Number(CFG.maxPlayers) === 9 ? 9 : 6);
  G.maxPlayers = G.seats.length;
  G.board = [{v:'10',s:'♠'},{v:'J',s:'♦'},{v:'4',s:'♣'},{v:'Q',s:'♥'}];
  G.pot = unit*21;
  G.currentBet = unit*6;
  G.minRaise = CFG.bb;
  G.currentSb = CFG.sb;
  G.currentBb = CFG.bb;
  G.currentAnte = CFG.anteType===TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE
    ? TOURNAMENT.LEVELS[0].ante
    : (CFG.anteType===TOURNAMENT.ANTE_TYPES.BIG_BLIND_ANTE?CFG.bb:0);
  G.blindLevel = 1;
  G.handBlindLevel = 1;
  G.tournamentSb = CFG.sb;
  G.tournamentBb = CFG.bb;
  G.tournamentAnte = CFG.anteType===TOURNAMENT.ANTE_TYPES.CLASSIC_ANTE?TOURNAMENT.LEVELS[0].ante:0;
  G.tournamentBba = CFG.anteType===TOURNAMENT.ANTE_TYPES.BIG_BLIND_ANTE?CFG.bb:0;
  G.anteType = CFG.anteType;
  G.nextBlindLevel = TOURNAMENT.LEVELS[1];
  G.nextBlindAt = Date.now() + CFG.levelDurationSec * 1000;
  _blindSync = null;
  G.phase = 'TURN';
  G.dealerSeat = G.seats.length === 9 ? 6 : 4;
  G.actingSeat = 0;
  G.userSeat = 0;
  G.playerPosition = 1;
  G.playersRemaining = G.seats.length;
  G.handNum = 1;
  G.boardPeekIdx = -1;
  G.equity = {};

  const gameRoom = document.getElementById('gameRoom');
  gameRoom.classList.add('open', 'table-preview-mode');
  setPreviewDevice('desktop');
  document.getElementById('grBrand').textContent = CFG.brand;
  document.getElementById('grInfo').textContent = `NL Hold'em ${G.seats.length}-Max · ${_chips(CFG.sb)}/${_chips(CFG.bb)}`;
  const blinds = document.getElementById('blindsDisplay');
  if (blinds) blinds.textContent = `${_chips(CFG.sb)} / ${_chips(CFG.bb)} · ${_anteLabel(CFG.anteType,G.currentAnte,G.currentAnte)}`;
  applyFelt();
  applyScreenLogo();
  applyFeltLogo();
  renderTable();

  document.body.style.overflow = 'hidden';
  requestAnimationFrame(adjustTableScale);
}

function closeTablePreview() {
  if (!_tablePreviewMode) return;
  closePreviewEditor();
  document.getElementById('gameRoom').classList.remove('open', 'table-preview-mode', 'table-preview-phone');
  stopTimer();
  clearBotTimers();
  _stopBotRandomReactions();
  hideReactionPicker();
  if (_tablePreviewSnapshot) {
    for (const key of Object.keys(G)) {
      if (!Object.prototype.hasOwnProperty.call(_tablePreviewSnapshot, key)) delete G[key];
    }
    Object.assign(G, _tablePreviewSnapshot);
  }
  _tablePreviewSnapshot = null;
  _tablePreviewMode = false;
  _previewDevice = 'desktop';
  ANIM.reset();
  document.body.style.overflow = '';
}

// Join modal (for players)
function openJoinModal() {
  const modal = document.getElementById('joinModal');
  modal.style.display = 'flex';
  document.getElementById('joinCodeInput').focus();
  // Pre-fill name
  document.getElementById('joinNameInput').value = localStorage.getItem('pokerName') || '';
}

function goToLobby() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  const name = document.getElementById('joinNameInput').value.trim() || 'Player';
  if (code.length !== 4) {
    document.getElementById('joinModalError').textContent = 'Введите 4-значный код';
    return;
  }
  localStorage.setItem('pokerName', name);
  window.location.href = `/lobby/${code}`;
}

async function logoutAdmin() {
  try { await fetch('/api/admin/logout', { method: 'POST' }); }
  finally { window.location.href = '/'; }
}

function closeRoom(){
  if (_tablePreviewMode) {
    closeTablePreview();
    return;
  }
  window.location.href = '/';
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  syncEffectsSettingsUI();
  window.addEventListener('resize', scheduleTableLayout);
  window.addEventListener('orientationchange', scheduleTableLayout);
  window.visualViewport?.addEventListener('resize', scheduleTableLayout);
  window.visualViewport?.addEventListener('scroll', scheduleTableLayout);
  const roomResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(scheduleTableLayout)
    : null;
  const tableRoom = document.querySelector('.gr-room');
  if (tableRoom) roomResizeObserver?.observe(tableRoom);
  const pathParts = window.location.pathname.split('/');
  const roomId = (pathParts[1] === 'r') ? pathParts[2] : null;

  if (roomId) {
    document.getElementById('gameRoom').classList.add('open');
    document.body.classList.add('game-active');
    document.body.style.overflow = 'hidden';
    adjustTableScale();
    if (socket) {
      _inMultiplayer = true;
      _currentRoomId = roomId;
      socket.emit('joinRoom', { roomId, playerId: getPlayerId() });

      // Auto-sit if arriving from lobby via URL params
      const urlParams = new URLSearchParams(window.location.search);
      const urlSeat = urlParams.get('seat');
      const urlName = urlParams.get('name');
      if (urlSeat !== null && urlName) {
        const seatIdx = parseInt(urlSeat, 10);
        const name = decodeURIComponent(urlName);
        // Wait briefly for joinRoom to be processed, then sit
        setTimeout(() => {
          if (G.userSeat < 0) { // not yet seated by autoSeated event
            G.userSeat = seatIdx;
            socket.emit('sitAtTable', {
              seatIdx,
              name,
              flag: '\uD83C\uDFF3\uFE0F',
              avatarIdx: seatIdx % 6,
              playerId: getPlayerId()
            });
            const joinBar = document.getElementById('actionBarJoin');
            if (joinBar) joinBar.style.display = 'none';
            renderTable();
          }
        }, 400);
      }
    }
  } else {
    goStep(1);
    setLaunchMode(CFG.launchMode);
    applyFelt();
    applyScreenLogo();
    applyFeltLogo();
    renderSettingsReactions();
  }

  // Close modals on backdrop click
  document.getElementById('joinModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('joinModal'))
      document.getElementById('joinModal').style.display = 'none';
  });
  document.getElementById('lobbyCodeModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('lobbyCodeModal'))
      document.getElementById('lobbyCodeModal').style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePlayerContextMenu();
      toggleEffectsSettings(null, false);
    }
    if (e.key === 'Escape' && _tablePreviewMode) {
      if(document.getElementById('previewEditorPanel')?.classList.contains('open')) closePreviewEditor();
      else closeTablePreview();
    }
  });
  document.addEventListener('pointerdown', e => {
    unlockGameAudio();
    const menu = document.getElementById('playerContextMenu');
    if(menu?.classList.contains('show') && !menu.contains(e.target) && !e.target.closest?.('.effect-targetable')) {
      closePlayerContextMenu();
    }
    const settings = document.getElementById('effectsSettingsPanel');
    if(settings?.classList.contains('show') && !settings.contains(e.target) && !e.target.closest?.('#effectsSettingsButton')) {
      toggleEffectsSettings(null, false);
    }
  });

  // Enter key in join modal
  document.getElementById('joinCodeInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') goToLobby();
  });
  document.getElementById('joinNameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') goToLobby();
  });
});
