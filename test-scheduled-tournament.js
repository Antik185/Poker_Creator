'use strict';

const { io } = require('./node_modules/socket.io/client-dist/socket.io.js');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const results = [];
const sockets = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function check(name, condition) {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = payload => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

async function connect() {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await waitForEvent(socket, 'connect');
  return socket;
}

async function scheduledState(socket, code, playerId, name = '') {
  const state = waitForEvent(socket, 'scheduledLobbyState');
  socket.emit('joinLobby', { code, playerId, name });
  return state;
}

(async () => {
  const startAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const body = new URLSearchParams({
    config: JSON.stringify({
      launchMode: 'scheduled',
      scheduledStartAt: startAt,
      tournamentTitle: 'Friday Test Championship',
      tournamentDescription: 'Полное тестовое описание турнира.',
      maxPlayers: 6,
      startStack: 5000,
      tournamentSpeed: 'HYPER_TURBO',
      anteType: 'CLASSIC_ANTE'
    })
  });
  const response = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000)
  });
  const created = await response.json();
  check('scheduled tournament is created', response.ok && created.launchMode === 'scheduled');

  const viewer = await connect();
  const publicState = await scheduledState(viewer, created.code, 'viewer-001');
  check('lobby is viewable without a nickname', publicState.title === 'Friday Test Championship');
  check('full description is returned', publicState.description === 'Полное тестовое описание турнира.');
  check('exact blind structure is returned', publicState.structure?.levels?.length === 51);
  check('registration is initially open', publicState.registrationOpen && !publicState.registered);
  check('seating opens inside the five-minute window', publicState.canTakeSeat === false && publicState.seatingOpensAt < Date.now());

  const aliceStatePromise = waitForEvent(viewer, 'scheduledLobbyState');
  viewer.emit('registerTournament', { code: created.code, playerId: 'scheduled-alice', name: 'Alice' });
  const aliceState = await aliceStatePromise;
  check('first player is registered persistently', aliceState.registered && aliceState.registrations.length === 1);

  const bob = await connect();
  await scheduledState(bob, created.code, 'scheduled-bob');
  const bobStatePromise = waitForEvent(bob, 'scheduledLobbyState');
  bob.emit('registerTournament', { code: created.code, playerId: 'scheduled-bob', name: 'Bob' });
  const bobState = await bobStatePromise;
  check('second player appears in registration list', bobState.registrations.map(player => player.name).join(',') === 'Alice,Bob');

  const seatReady = waitForEvent(viewer, 'lobbyStart');
  viewer.emit('claimTournamentSeat', { code: created.code, playerId: 'scheduled-alice' });
  const assignment = await seatReady;
  check('registered player receives their seat', assignment.seatIdx === 0 && assignment.roomId === created.roomId);

  const table = await connect();
  let tableState = null;
  table.on('stateUpdate', state => { tableState = state; });
  table.emit('joinRoom', { roomId: created.roomId, playerId: 'scheduled-alice' });
  await sleep(700);
  check('player is seated before start', tableState?.yourSeat === 0);
  check('hand cannot start before scheduled time', tableState?.phase === 'WAITING' && tableState?.handNum === 0);

  const outsider = await connect();
  outsider.emit('joinRoom', { roomId: created.roomId, playerId: 'scheduled-outsider' });
  await sleep(150);
  const denied = waitForEvent(outsider, 'sitDenied');
  outsider.emit('sitAtTable', { seatIdx: 3, name: 'Outsider', playerId: 'scheduled-outsider' });
  check('unregistered player cannot take a seat', /регистрац/i.test(await denied));

  sockets.forEach(socket => socket.close());
  const passed = results.filter(Boolean).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => {
  sockets.forEach(socket => socket.close());
  console.error(error.stack || error);
  process.exit(1);
});
