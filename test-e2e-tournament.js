'use strict';
// E2E tournament test: elimination, victory, in-progress lobby, AFK continuation
const { io } = require('./node_modules/socket.io/client-dist/socket.io.js');
const { randomUUID } = require('node:crypto');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function createRoom(config) {
  const body = new URLSearchParams({ config: JSON.stringify(config) });
  const res = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Room creation failed: ${res.status}`);
  return res.json();
}

function makeClient(playerId) {
  const s = io(BASE, { path: '/realtime/', transports: ['websocket'], forceNew: true });
  const c = { s, playerId, state: null, seat: -1, events: [] };
  s.on('stateUpdate', g => { c.state = g; });
  s.on('autoSeated', d => { c.seat = d.seatIdx; });
  s.on('sitDenied', m => c.events.push(['sitDenied', m]));
  s.on('eliminated', d => c.events.push(['eliminated', d]));
  s.on('playerEliminated', d => c.events.push(['playerEliminated', d]));
  s.on('gameOver', d => c.events.push(['gameOver', d]));
  s.on('lobbyInProgress', d => c.events.push(['lobbyInProgress', d]));
  s.on('lobbyJoined', d => c.events.push(['lobbyJoined', d]));
  s.on('lobbyError', d => c.events.push(['lobbyError', d]));
  return c;
}

function sendAction(client, action, amount = 0) {
  client.s.emit('playerAction', {
    action,
    amount,
    commandId: randomUUID(),
    turnId: client.state?.turnId
  });
}

async function waitFor(fn, timeoutMs = 10000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await sleep(100);
  }
  console.log('  waitFor timeout:', label);
  return false;
}

(async () => {
  // ── Scenario 1: heads-up all-in until bust → elimination + victory ──
  const { roomId, code } = await createRoom({ startStack: 500, brand: 'T1' });
  check('room created', !!roomId, `code=${code}`);

  const A = makeClient('t-A'), B = makeClient('t-B');
  for (const c of [A, B]) {
    await new Promise(r => c.s.on('connect', r));
    c.s.emit('joinRoom', { roomId, playerId: c.playerId });
  }
  await sleep(300);
  A.s.emit('sitAtTable', { seatIdx: 0, name: 'Alice', flag: 'X', avatarIdx: 0, playerId: 't-A' });
  B.s.emit('sitAtTable', { seatIdx: 1, name: 'Bob', flag: 'X', avatarIdx: 1, playerId: 't-B' });
  await waitFor(() => A.seat === 0 && B.seat === 1, 5000, 'seating');
  await waitFor(() => A.state && A.state.phase === 'PREFLOP', 8000, 'hand start');

  // Lobby joined AFTER game started must show in-progress info, not a countdown
  const L = makeClient('t-L');
  await new Promise(r => L.s.on('connect', r));
  L.s.emit('joinLobby', { code, name: 'Late', playerId: 't-L' });
  await waitFor(() => L.events.some(e => e[0] === 'lobbyInProgress' || e[0] === 'lobbyJoined'), 4000, 'lobby resp');
  const lip = L.events.find(e => e[0] === 'lobbyInProgress');
  check('late lobby join → lobbyInProgress', !!lip);
  if (lip) {
    check('lobbyInProgress has players+roomId',
      lip[1].roomId === roomId && lip[1].players.length === 2 && lip[1].players.some(p => p.name === 'Alice'),
      JSON.stringify(lip[1].players));
  }

  // Shove all-in every turn until someone busts
  const clients = { 0: A, 1: B };
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (A.events.some(e => e[0] === 'gameOver') || B.events.some(e => e[0] === 'gameOver')) break;
    const st = A.state || {};
    const act = st.actingSeat;
    if (act >= 0 && clients[act]) sendAction(clients[act], 'raise', 999);
    await sleep(300);
  }

  const elimA = A.events.find(e => e[0] === 'eliminated');
  const elimB = B.events.find(e => e[0] === 'eliminated');
  const elim = elimA || elimB;
  check('loser got eliminated event', !!elim, JSON.stringify(elim && elim[1]));
  check('elimination place 2 of 2', elim && elim[1].place === 2 && elim[1].total === 2);

  const survivor = elimA ? B : A;
  const loser = elimA ? A : B;
  const loserSeat = elimA ? 0 : 1;
  const go = survivor.events.find(e => e[0] === 'gameOver');
  check('gameOver emitted', !!go, JSON.stringify(go && go[1]));
  check('winner is the survivor', go && go[1].winnerName === (elimA ? 'Bob' : 'Alice') && go[1].total === 2);
  const pe = survivor.events.find(e => e[0] === 'playerEliminated');
  check('table-wide playerEliminated', !!pe && pe[1].place === 2);

  await waitFor(() => survivor.state && survivor.state.seats[loserSeat] === null, 8000, 'seat freed');
  check('eliminated seat freed', survivor.state.seats[loserSeat] === null);
  check('state has gameOver flag', survivor.state.gameOver === true);

  // Eliminated player cannot re-sit
  loser.events.length = 0;
  loser.s.emit('sitAtTable', { seatIdx: 5, name: 'Zombie', flag: 'X', avatarIdx: 0, playerId: loser.playerId + '-new' });
  await sleep(800);
  const resat = loser.seat === 5 || (loser.state && loser.state.seats[5]);
  check('no re-entry after game over', !resat);

  // No new hand starts after victory
  const hn = survivor.state.handNum;
  await sleep(6500);
  check('no next hand after victory', survivor.state.handNum === hn && survivor.state.phase !== 'PREFLOP',
    `handNum=${survivor.state.handNum} phase=${survivor.state.phase}`);

  [A, B, L].forEach(c => c.s.close());

  // ── Scenario 2: 3 players, two disconnect mid-game → game continues (AFK auto-fold) ──
  const { roomId: room2 } = await createRoom({ startStack: 500, brand: 'T2' });

  const C = makeClient('t2-C'), D = makeClient('t2-D'), E = makeClient('t2-E');
  for (const c of [C, D, E]) {
    await new Promise(r => c.s.on('connect', r));
    c.s.emit('joinRoom', { roomId: room2, playerId: c.playerId });
  }
  await sleep(300);
  C.s.emit('sitAtTable', { seatIdx: 0, name: 'Carl', flag: 'X', avatarIdx: 0, playerId: 't2-C' });
  D.s.emit('sitAtTable', { seatIdx: 1, name: 'Dana', flag: 'X', avatarIdx: 1, playerId: 't2-D' });
  E.s.emit('sitAtTable', { seatIdx: 2, name: 'Eve', flag: 'X', avatarIdx: 2, playerId: 't2-E' });
  await waitFor(() => C.state && C.state.phase === 'PREFLOP', 8000, 'hand1 start');
  const hand1 = C.state.handNum;

  // Two of three players drop — Carl alone must still see the game progress
  D.s.close();
  E.s.close();
  await sleep(500);

  // Carl just checks/calls when it's his turn; offline players auto-fold
  const tt0 = Date.now();
  let sawNextHand = false;
  while (Date.now() - tt0 < 45000) {
    const st = C.state || {};
    if (st.handNum >= hand1 + 2) { sawNextHand = true; break; }
    if (st.actingSeat === 0) sendAction(C, 'call');
    await sleep(300);
  }
  check('game continues alone vs AFK (2+ hands)', sawNextHand,
    `handNum=${C.state.handNum} (was ${hand1})`);
  check('offline players still dealt in (blinds taxed)',
    C.state.seats[1] === null || C.state.seats[1].stack < 500 || C.state.seats[2] === null || C.state.seats[2].stack < 500,
    `d=${C.state.seats[1]?.stack} e=${C.state.seats[2]?.stack}`);

  C.s.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
