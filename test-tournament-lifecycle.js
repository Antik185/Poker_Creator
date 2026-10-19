'use strict';

const assert = require('node:assert/strict');
const { PokerRoom } = require('./server/gameEngine');
const { ANTE_TYPES } = require('./public/tournament-structure');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeIo() {
  return {
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to() { return { emit() {} }; }
  };
}

function makeRoom(id, options = {}) {
  return new PokerRoom(id, {
    launchMode: 'scheduled',
    scheduledStartAt: new Date(Date.now() - 60_000).toISOString(),
    startStack: options.startStack || 1000,
    sb: 25,
    bb: 50,
    maxPlayers: options.maxPlayers || 6,
    anteType: ANTE_TYPES.CLASSIC_ANTE,
    levelDurationSec: 180
  }, fakeIo(), options.callbacks || {});
}

function offlineSeat(name, playerId, stack = 1000) {
  return {
    id: null,
    playerId,
    publicPlayerId: `public-${playerId}`,
    name,
    flag: '🏳️',
    avatar: 0,
    stack,
    bet: 0,
    inHand: false,
    acted: false,
    cards: [],
    lastAction: '',
    isBot: false,
    contributed: 0,
    connected: false,
    sittingOut: true,
    canRaise: true
  };
}

async function testOfflineForcedBets() {
  const room = makeRoom('offline-forced');
  for (let i = 0; i < 6; i++) {
    room.G.seats[i] = offlineSeat(`P${i + 1}`, `offline-${i}`);
    room.players.set(`offline-${i}`, i);
  }
  room.totalEntrants = 6;
  room.startHand();
  assert.equal(room.G.pot, 111);
  assert.ok(room.G.seats.every(seat => seat.contributed >= 6));
  assert.equal(room.G.seats.filter(seat => seat.bet === 25).length, 1);
  assert.equal(room.G.seats.filter(seat => seat.bet === 50).length, 1);
  assert.ok(room.G.seats.every(seat => seat.stack >= 0));
  room.dispose();
}

async function captureOfflineAction(toCall) {
  const room = makeRoom(`offline-action-${toCall}`);
  room.OFFLINE_TURN_MS = 5;
  room.G.phase = 'FLOP';
  room.G.currentBet = toCall;
  room.G.minRaise = 50;
  room.G.actingSeat = 0;
  room.G.seats[0] = { ...offlineSeat('Away', 'away'), inHand: true, bet: 0 };
  room.G.seats[1] = { ...offlineSeat('Other', 'other'), inHand: true, bet: toCall, acted: true };
  room.players.set('away', 0);
  room.players.set('other', 1);
  const actions = [];
  const original = room.doAction.bind(room);
  room.doAction = (seatIdx, action, amount) => {
    actions.push({ seatIdx, action });
    return original(seatIdx, action, amount);
  };
  room.startTurnTimer();
  await sleep(260);
  room.dispose();
  return actions[0]?.action;
}

async function testOfflineActions() {
  assert.equal(await captureOfflineAction(0), 'call');
  assert.equal(await captureOfflineAction(50), 'fold');
}

async function testReconnectKeepsSeatAndStack() {
  const room = makeRoom('offline-reconnect');
  room.G.seats[2] = offlineSeat('Returner', 'returner', 643);
  room.players.set('returner', 2);
  room.totalEntrants = 1;
  assert.equal(room.reconnectPlayer('returner', 'socket-new'), 2);
  assert.equal(room.G.seats[2].stack, 643);
  assert.equal(room.G.seats[2].connected, true);
  assert.equal(room.G.seats[2].sittingOut, false);
  assert.equal(room.addPlayer(3, { playerId: 'returner', name: 'Duplicate' }), false);
  room.dispose();
}

async function testAllOfflineCanFinish() {
  let elimination = null;
  let winner = null;
  const room = makeRoom('offline-finish', {
    callbacks: {
      onEliminated: event => { elimination = event; },
      onGameOver: event => { winner = event; }
    }
  });
  room.G.seats[0] = offlineSeat('Busted', 'busted', 0);
  room.G.seats[1] = offlineSeat('Winner', 'winner', 2000);
  room.players.set('busted', 0);
  room.players.set('winner', 1);
  room.totalEntrants = 2;
  room._processEliminations();
  assert.equal(room._checkGameOver(), true);
  assert.equal(elimination.playerId, 'busted');
  assert.equal(elimination.place, 2);
  assert.equal(winner.winnerName, 'Winner');
  assert.equal(room.gameOver, true);
  room.dispose();
}

(async () => {
  await testOfflineForcedBets();
  await testOfflineActions();
  await testReconnectKeepsSeatAndStack();
  await testAllOfflineCanFinish();
  console.log('PASS  scheduled tournament offline lifecycle (4/4)');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
