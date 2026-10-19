'use strict';

const { randomUUID } = require('node:crypto');
const { io } = require('./node_modules/socket.io/client-dist/socket.io.js');
const db = require('./server/db');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const sockets = [];
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function check(name, condition, detail = '') {
  results.push(!!condition);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : ` (${detail})`}`);
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = payload => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

async function connect() {
  const socket = io(BASE, { path: '/realtime/', transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await waitForEvent(socket, 'connect');
  return socket;
}

function createPastTournament(minutesAgo, lateRegistrationMinutes) {
  const roomId = `late-${randomUUID()}`;
  const config = {
    launchMode: 'scheduled',
    scheduledStartAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    lateRegistrationMinutes,
    tournamentTitle: 'Late Registration Test',
    tournamentDescription: 'Persistent tournament lifecycle test.',
    maxPlayers: 6,
    startStack: 5000,
    tournamentSpeed: 'HYPER_TURBO',
    anteType: 'CLASSIC_ANTE'
  };
  const code = db.saveRoom(roomId, '', config, null, null);
  return { roomId, code };
}

async function lobbyState(socket, code, playerId) {
  const state = waitForEvent(socket, 'scheduledLobbyState');
  socket.emit('joinLobby', { code, playerId });
  return state;
}

(async () => {
  const open = createPastTournament(2, 10);
  const lobby = await connect();
  const initial = await lobbyState(lobby, open.code, 'late-alice');
  check('late registration remains open after start', initial.registrationOpen === true);
  check('late registration deadline is synchronized', initial.registrationClosesAt > initial.serverNow);

  const registeredEvent = waitForEvent(lobby, 'scheduledLobbyState');
  lobby.emit('registerTournament', { code: open.code, playerId: 'late-alice', name: 'Alice' });
  const registered = await registeredEvent;
  check('late player is registered once', registered.registered && registered.activeRegistrations === 1);
  check('late player receives a persistent seat', Number.isInteger(registered.seatIdx));
  check('registration list identifies current player', registered.registrations.some(player => player.name === 'Alice' && player.isYou));

  const table = await connect();
  let tableState = null;
  table.on('stateUpdate', state => { tableState = state; });
  table.emit('joinRoom', { roomId: open.roomId, playerId: 'late-alice' });
  await sleep(600);
  check('registered player reconnects to reserved seat', tableState?.yourSeat === registered.seatIdx);
  const stackBefore = tableState?.seats?.[registered.seatIdx]?.stack;
  check('late player receives starting stack once', stackBefore === 5000, `stack=${stackBefore}`);

  table.close();
  await sleep(350);
  const spectator = await connect();
  let spectatorState = null;
  spectator.on('stateUpdate', state => { spectatorState = state; });
  spectator.emit('joinRoom', { roomId: open.roomId, playerId: 'late-spectator' });
  await sleep(500);
  const offlineSeat = spectatorState?.seats?.[registered.seatIdx];
  check('absent player seat remains visible', offlineSeat?.name === 'Alice');
  check('absent player is offline and sitting out', offlineSeat?.connected === false && offlineSeat?.sittingOut === true);

  const returning = await connect();
  let returningState = null;
  returning.on('stateUpdate', state => { returningState = state; });
  returning.emit('joinRoom', { roomId: open.roomId, playerId: 'late-alice' });
  await sleep(500);
  check('returning player keeps stack and seat', returningState?.yourSeat === registered.seatIdx
    && returningState?.seats?.[registered.seatIdx]?.stack === stackBefore);

  db.markTournamentEliminated(open.roomId, 'late-alice', 2);
  const eliminatedState = await lobbyState(lobby, open.code, 'late-alice');
  check('eliminated status survives lobby refresh', eliminatedState.playerStatus === 'ELIMINATED' && eliminatedState.eliminatedPlace === 2);
  const reentryError = waitForEvent(lobby, 'tournamentRegistrationError');
  lobby.emit('registerTournament', { code: open.code, playerId: 'late-alice', name: 'Alice' });
  check('re-entry is rejected', /выбыли/i.test(await reentryError));

  const closed = createPastTournament(16, 10);
  const closedLobby = await connect();
  const closedState = await lobbyState(closedLobby, closed.code, 'too-late');
  check('registration is closed after deadline', closedState.registrationOpen === false);
  const closedError = waitForEvent(closedLobby, 'tournamentRegistrationError');
  closedLobby.emit('registerTournament', { code: closed.code, playerId: 'too-late', name: 'Too Late' });
  check('new player is rejected after deadline', /закрыта/i.test(await closedError));

  sockets.forEach(socket => socket.close());
  const passed = results.filter(Boolean).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(error => {
  sockets.forEach(socket => socket.close());
  console.error(error.stack || error);
  process.exit(1);
});
