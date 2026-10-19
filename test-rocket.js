'use strict';

const { io } = require('./node_modules/socket.io/client-dist/socket.io.js');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function check(name, condition, extra = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(50);
  }
  return false;
}

async function createRoom() {
  const body = new URLSearchParams({ config: JSON.stringify({ startStack: 5000, brand: 'ROCKET_TEST' }) });
  const response = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Room creation failed: ${response.status}`);
  return response.json();
}

function client(playerId) {
  const socket = io(BASE, { path: '/realtime/', transports: ['websocket'], forceNew: true });
  const state = { socket, playerId, seat: -1, game: null, started: [], rejected: [] };
  socket.on('autoSeated', data => { state.seat = data.seatIdx; });
  socket.on('stateUpdate', game => { state.game = game; });
  socket.on('rocket_attack_started', event => state.started.push(event));
  socket.on('rocket_attack_rejected', event => state.rejected.push(event));
  return state;
}

(async () => {
  const { roomId } = await createRoom();
  const alice = client('rocket-A');
  const bob = client('rocket-B');
  const charlie = client('rocket-C');
  for (const current of [alice, bob, charlie]) {
    await new Promise(resolve => current.socket.once('connect', resolve));
    current.socket.emit('joinRoom', { roomId, playerId: current.playerId });
  }
  await sleep(150);
  alice.socket.emit('sitAtTable', { seatIdx: 0, name: 'Alice', avatarIdx: 0, playerId: alice.playerId });
  bob.socket.emit('sitAtTable', { seatIdx: 1, name: 'Bob', avatarIdx: 1, playerId: bob.playerId });
  charlie.socket.emit('sitAtTable', { seatIdx: 2, name: 'Charlie', avatarIdx: 2, playerId: charlie.playerId });
  await waitFor(() => alice.seat === 0 && bob.seat === 1 && charlie.seat === 2 && alice.game?.seats?.[1]?.playerId);

  const alicePublicId = alice.game?.seats?.[0]?.playerId;
  const bobPublicId = alice.game?.seats?.[1]?.playerId;
  check('public effect ids are available', !!alicePublicId && !!bobPublicId);
  check('private reconnect id is not exposed', bobPublicId !== 'rocket-B');

  alice.socket.emit('rocket_attack_request', {
    tableId: roomId,
    targetPlayerId: bobPublicId,
    effectId: 'rocket_01'
  });
  await waitFor(() => alice.started.length === 1 && bob.started.length === 1);
  const aEvent = alice.started[0];
  const bEvent = bob.started[0];
  check('sender receives authoritative event', !!aEvent);
  check('target receives the same event', !!bEvent && bEvent.eventId === aEvent?.eventId);
  check('event identifies sender and target', aEvent?.fromPlayerId === alicePublicId && aEvent?.targetPlayerId === bobPublicId);
  check('event carries server start time', Number.isFinite(aEvent?.serverStartTime));

  charlie.socket.emit('rocket_attack_request', {
    tableId: roomId,
    targetPlayerId: bobPublicId,
    effectId: 'rocket_01'
  });
  await waitFor(() => charlie.rejected.some(event => event.code === 'TARGET_BUSY'));
  check('only one active effect may target a player', charlie.rejected.some(event => event.code === 'TARGET_BUSY'));

  alice.socket.emit('rocket_attack_request', {
    tableId: roomId,
    targetPlayerId: alicePublicId,
    effectId: 'rocket_01'
  });
  await waitFor(() => alice.rejected.some(event => event.code === 'SELF_TARGET'));
  check('self target is rejected', alice.rejected.some(event => event.code === 'SELF_TARGET'));

  alice.socket.emit('rocket_attack_request', {
    tableId: roomId,
    targetPlayerId: bobPublicId,
    effectId: 'rocket_01'
  });
  await waitFor(() => alice.rejected.some(event => event.code === 'COOLDOWN'));
  check('server enforces ten-second cooldown', alice.rejected.some(event => event.code === 'COOLDOWN' && event.retryAfterMs > 9000));

  alice.socket.close();
  bob.socket.close();
  charlie.socket.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  process.exitCode = passed === results.length ? 0 : 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
