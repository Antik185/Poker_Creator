'use strict';
// E2E multiplayer test: seating, card hiding, turns, disconnect, reconnect
const { io } = require('./node_modules/socket.io/client-dist/socket.io.js');

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
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  const c = { s, playerId, state: null, seat: -1, events: [] };
  s.on('stateUpdate', g => { c.state = g; });
  s.on('autoSeated', d => { c.seat = d.seatIdx; c.events.push(['autoSeated', d]); });
  s.on('sitDenied', m => c.events.push(['sitDenied', m]));
  return c;
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
  // 1. Create room
  const { roomId, code } = await createRoom({ startStack: 5000, brand: 'TEST' });
  check('room created', !!roomId, `roomId=${roomId} code=${code}`);

  // 2. Three players join and sit
  const A = makeClient('test-A'), B = makeClient('test-B'), C = makeClient('test-C');
  for (const c of [A, B, C]) {
    await new Promise(r => c.s.on('connect', r));
    c.s.emit('joinRoom', { roomId, playerId: c.playerId });
  }
  await sleep(300);
  A.s.emit('sitAtTable', { seatIdx: 0, name: 'Alice', flag: 'X', avatarIdx: 0, playerId: 'test-A' });
  B.s.emit('sitAtTable', { seatIdx: 1, name: 'Bob', flag: 'X', avatarIdx: 1, playerId: 'test-B' });
  C.s.emit('sitAtTable', { seatIdx: 2, name: 'Carl', flag: 'X', avatarIdx: 2, playerId: 'test-C' });
  await waitFor(() => A.seat === 0 && B.seat === 1 && C.seat === 2, 5000, 'seating');
  check('all three seated', A.seat === 0 && B.seat === 1 && C.seat === 2);

  // duplicate seat attempt
  const D = makeClient('test-D');
  await new Promise(r => D.s.on('connect', r));
  D.s.emit('joinRoom', { roomId, playerId: 'test-D' });
  await sleep(200);
  D.s.emit('sitAtTable', { seatIdx: 0, name: 'Dup', flag: 'X', avatarIdx: 0, playerId: 'test-D' });
  await waitFor(() => D.events.some(e => e[0] === 'sitDenied'), 3000, 'sitDenied');
  check('occupied seat denied', D.events.some(e => e[0] === 'sitDenied'));

  // 3. Hand starts (3s delay)
  await waitFor(() => A.state && A.state.phase === 'PREFLOP', 8000, 'hand start');
  await waitFor(() => D.state && D.state.handNum === A.state.handNum && D.state.seats?.[0]?.cards?.length === 2, 3000, 'spectator state');
  check('hand started', A.state && A.state.phase === 'PREFLOP', `phase=${A.state?.phase}`);

  // 4. Card privacy
  const aOwn = A.state.seats[0].cards;
  const aSeesB = A.state.seats[1].cards;
  check('A sees own cards', aOwn.length === 2 && !!aOwn[0].v, JSON.stringify(aOwn));
  check('A does NOT see B cards', aSeesB.length === 2 && aSeesB[0].hidden === true && !aSeesB[0].v, JSON.stringify(aSeesB));
  check('no deck leaked', A.state.deck === undefined);
  check('spectator D sees no cards', D.state.seats[0].cards[0].hidden === true);
  check('yourSeat correct', A.state.yourSeat === 0 && B.state.yourSeat === 1 && D.state.yourSeat === -1);

  // 5. Turn timer present
  check('turn timer broadcast', A.state.turnRemainingMs > 0 && A.state.turnTimeMs === 30000,
    `remain=${A.state.turnRemainingMs} total=${A.state.turnTimeMs}`);

  // 6. Acting player calls; turn passes
  const clients = { 0: A, 1: B, 2: C };
  let actor = A.state.actingSeat;
  check('acting seat valid', actor >= 0 && actor <= 2, `actingSeat=${actor}`);
  clients[actor].s.emit('playerAction', { action: 'call', amount: 0 });
  await waitFor(() => A.state.actingSeat !== actor, 3000, 'turn passes');
  check('turn passed after call', A.state.actingSeat !== actor, `now acting=${A.state.actingSeat}`);

  // invalid action from non-actor must be ignored
  const nonActor = [0, 1, 2].find(i => i !== A.state.actingSeat);
  const potBefore = A.state.pot;
  clients[nonActor].s.emit('playerAction', { action: 'raise', amount: 999 });
  await sleep(500);
  check('out-of-turn action ignored', A.state.pot === potBefore && A.state.actingSeat !== nonActor);

  // 7. Disconnect the acting player mid-hand: seat must stay, auto-fold within ~8s
  const actor2 = A.state.actingSeat;
  const obs = actor2 === 0 ? B : A; // an observer that stays connected
  const expectedOfflineAction = Math.max(0, A.state.currentBet - A.state.seats[actor2].bet) > 0.004
    ? 'FOLD'
    : 'CHECK';
  clients[actor2].s.close();
  await waitFor(() => obs.state.seats[actor2] && obs.state.seats[actor2].connected === false, 4000, 'offline flag');
  check('seat kept after disconnect', obs.state.seats[actor2] !== null);
  check('marked offline', obs.state.seats[actor2] && obs.state.seats[actor2].connected === false);
  await waitFor(() => obs.state.actingSeat !== actor2, 10000, 'offline auto-action');
  check('offline player auto-acted (~7s)', obs.state.actingSeat !== actor2);
  check('offline player auto-checks or auto-folds correctly', obs.state.seats[actor2].lastAction === expectedOfflineAction,
    `expected=${expectedOfflineAction} action=${obs.state.seats[actor2].lastAction}`);

  // 8. Reconnect with same playerId -> same seat, same stack
  const stackBefore = obs.state.seats[actor2].stack;
  const R = makeClient(clients[actor2].playerId);
  await new Promise(r => R.s.on('connect', r));
  R.s.emit('joinRoom', { roomId, playerId: clients[actor2].playerId });
  await waitFor(() => R.seat === actor2, 4000, 'reconnect');
  check('reconnected to same seat', R.seat === actor2, `seat=${R.seat}`);
  await waitFor(() => R.state && R.state.seats[actor2].connected === true, 3000, 'online flag');
  check('marked online again', R.state.seats[actor2].connected === true);
  check('stack preserved', R.state.seats[actor2].stack === stackBefore, `stack=${R.state.seats[actor2].stack}`);

  // 9. Play hand to completion: everyone calls/checks until showdown or hand end
  const all = { 0: A, 1: B, 2: C };
  all[actor2] = R;
  const t0 = Date.now();
  let sawShowdown = false;
  while (Date.now() - t0 < 60000) {
    const st = (obs.state) || {};
    if (st.phase === 'SHOWDOWN') { sawShowdown = true; break; }
    const act = st.actingSeat;
    if (act >= 0 && all[act]) all[act].s.emit('playerAction', { action: 'call', amount: 0 });
    await sleep(400);
  }
  check('hand reached showdown', sawShowdown, `phase=${obs.state.phase} board=${obs.state.board?.length}`);
  if (sawShowdown) {
    const revealed = obs.state.seats.filter(s => s && s.inHand && s.cards.length === 2);
    check('cards revealed at showdown', revealed.length > 1 && revealed.every(s => !!s.cards[0].v));
  }

  // 10. Next hand starts automatically
  await waitFor(() => obs.state.phase === 'PREFLOP' && obs.state.handNum === 2, 15000, 'next hand');
  check('next hand auto-started', obs.state.handNum === 2 && obs.state.phase === 'PREFLOP',
    `handNum=${obs.state.handNum} phase=${obs.state.phase}`);

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(2); });
