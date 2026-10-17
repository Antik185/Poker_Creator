'use strict';

const assert = require('node:assert/strict');
const { PokerRoom } = require('./server/gameEngine');
const { TournamentClock } = require('./server/tournamentClock');
const { ANTE_TYPES } = require('./public/tournament-structure');
const db = require('./server/db');

function fakeIo() {
  return {
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to() { return { emit() {} }; }
  };
}

function player(name, stack, bet, contributed, cards) {
  return {
    name, stack, bet, contributed, cards,
    inHand: true, acted: false, canRaise: true,
    lastAction: '', connected: true, isBot: false
  };
}

function testSidePots() {
  const room = new PokerRoom('side-pot', { startStack: 100, sb: 1, bb: 2 }, fakeIo());
  room.G.board = [
    { v: '2', s: 'S' }, { v: '3', s: 'H' }, { v: '4', s: 'D' },
    { v: '8', s: 'C' }, { v: 'K', s: 'S' }
  ];
  room.G.pot = 450;
  room.G.seats[0] = player('A', 0, 0, 100, [{ v: 'A', s: 'S' }, { v: 'A', s: 'H' }]);
  room.G.seats[1] = player('B', 0, 0, 300, [{ v: 'Q', s: 'S' }, { v: 'Q', s: 'H' }]);
  room.G.seats[2] = { ...player('C', 0, 0, 50, []), inHand: false };
  const pots = room._distributePots();
  assert.deepEqual(pots.map(p => ({ pot: p.pot, winners: p.winners.map(w => w.name) })), [
    { pot: 150, winners: ['A'] },
    { pot: 100, winners: ['A'] },
    { pot: 200, winners: ['B'] }
  ]);
  room.dispose();
}

function testRaiseTo() {
  const room = new PokerRoom('raise-to', { startStack: 10, sb: 0.05, bb: 0.10 }, fakeIo());
  room.G.phase = 'PREFLOP';
  room.G.currentBet = 0.10;
  room.G.minRaise = 0.10;
  room.G.pot = 0.20;
  room.G.actingSeat = 0;
  room.G.seats[0] = player('A', 9.9, 0.1, 0.1, []);
  room.G.seats[1] = player('B', 9.9, 0.1, 0.1, []);
  assert.equal(room.doAction(0, 'raise', 0.30), true);
  assert.ok(Math.abs(room.G.seats[0].bet - 0.30) < 0.0001);
  assert.ok(Math.abs(room.G.currentBet - 0.30) < 0.0001);
  assert.ok(Math.abs(room.G.minRaise - 0.20) < 0.0001);
  room.dispose();
}

function testShortAllInDoesNotReopen() {
  const room = new PokerRoom('short-allin', { startStack: 10, sb: 0.05, bb: 0.10 }, fakeIo());
  room.G.phase = 'FLOP';
  room.G.currentBet = 0.50;
  room.G.minRaise = 0.50;
  room.G.pot = 1;
  room.G.actingSeat = 1;
  room.G.seats[0] = { ...player('A', 9.5, 0.5, 0.5, []), acted: true, canRaise: false };
  room.G.seats[1] = player('B', 0.2, 0.5, 0.5, []);
  room.doAction(1, 'raise', 0.70);
  assert.ok(Math.abs(room.G.currentBet - 0.70) < 0.0001);
  assert.equal(room.G.seats[0].acted, false);
  assert.equal(room.G.seats[0].canRaise, false);
  room.doAction(0, 'raise', 2.00);
  assert.ok(Math.abs(room.G.currentBet - 0.70) < 0.0001);
  assert.ok(Math.abs(room.G.seats[0].bet - 0.70) < 0.0001);
  room.dispose();
}

function testSnapshotRoundTrip() {
  const io = fakeIo();
  const room = new PokerRoom('snapshot', { startStack: 10, sb: 0.05, bb: 0.10 }, io);
  room.totalEntrants = 2;
  room.G.handNum = 7;
  room.G.phase = 'TURN';
  room.G.board = [{ v: 'A', s: 'S' }];
  room.G.seats[0] = { ...player('A', 8.5, 0, 1.5, []), playerId: 'player_A', id: 'socket-old' };
  const snapshot = room.getSnapshot();
  const restored = new PokerRoom('snapshot', room.config, io, { snapshot });
  assert.equal(restored.G.handNum, 7);
  assert.equal(restored.G.phase, 'TURN');
  assert.equal(restored.G.seats[0].stack, 8.5);
  assert.equal(restored.G.seats[0].connected, false);
  assert.equal(restored.players.get('player_A'), 0);

  const key = `test-${Date.now()}`;
  db.saveRoom(key, 'TEST', room.config, null, null);
  db.saveRoomState(key, snapshot);
  assert.equal(db.getRoomState(key).game.handNum, 7);
  db.deleteRoom(key);
  room.dispose();
  restored.dispose();
}

function tournamentRoom(id, playerCount, options = {}) {
  const room = new PokerRoom(id, {
    startStack: options.startStack || 1000,
    sb: 25,
    bb: 50,
    maxPlayers: playerCount === 9 ? 9 : 6,
    levelDurationSec: 180,
    anteType: options.anteType || ANTE_TYPES.CLASSIC_ANTE
  }, fakeIo(), options.clock ? { tournamentClock: options.clock } : {});
  for (let i = 0; i < playerCount; i++) {
    room.G.seats[i] = player(`P${i + 1}`, options.stacks?.[i] ?? (options.startStack || 1000), 0, 0, []);
  }
  room.totalEntrants = playerCount;
  return room;
}

function testClassicAnteSixPlayers() {
  const room = tournamentRoom('ante-6', 6);
  room.startHand();
  assert.equal(room.G.pot, 111);
  assert.equal(room.G.seats.reduce((sum, seat) => sum + (seat.contributed || 0), 0), 111);
  room.dispose();
}

function testClassicAnteNinePlayers() {
  const room = tournamentRoom('ante-9', 9);
  room.startHand();
  assert.equal(room.G.pot, 129);
  room.dispose();
}

function testFoldKeepsAnte() {
  const room = tournamentRoom('ante-fold', 6);
  room.startHand();
  const potBefore = room.G.pot;
  const actor = room.G.actingSeat;
  assert.equal(room.doAction(actor, 'fold', 0), true);
  assert.equal(room.G.pot, potBefore);
  assert.equal(room.G.seats[actor].contributed, 6);
  room.dispose();
}

function testPartialAnteAllIn() {
  const stacks = [1000, 1000, 1000, 3, 1000, 1000];
  const room = tournamentRoom('ante-short', 6, { stacks });
  room.startHand();
  assert.equal(room.G.seats[3].stack, 0);
  assert.equal(room.G.seats[3].contributed, 3);
  assert.equal(room.G.seats[3].bet, 0);
  assert.ok(room.G.seats.every(seat => seat.stack >= 0));
  room.dispose();
}

function testBlindsAlsoPayClassicAnte() {
  const room = tournamentRoom('ante-blinds', 6);
  room.startHand();
  const sb = room.G.seats.find(seat => seat.bet === 25);
  const bb = room.G.seats.find(seat => seat.bet === 50);
  assert.equal(sb.contributed, 31);
  assert.equal(bb.contributed, 56);
  room.dispose();
}

function testAnteOnlyOncePerHand() {
  const room = tournamentRoom('ante-once', 6);
  room.startHand();
  const bbIdx = room.G.seats.findIndex(seat => seat.bet === 50);
  const potBefore = room.G.pot;
  const contributionsBefore = room.G.seats.map(seat => seat.contributed);
  room._collectAntes(bbIdx);
  assert.equal(room.G.pot, potBefore);
  assert.deepEqual(room.G.seats.map(seat => seat.contributed), contributionsBefore);
  room.dispose();
}

function testLevelChangesOnlyForNextHand() {
  const clock = new TournamentClock({ durationSec: 180 });
  const room = tournamentRoom('level-boundary', 6, { clock });
  room._applyTournamentLevelForNextHand();
  assert.deepEqual([room.G.currentSb, room.G.currentBb, room.G.currentAnte], [25, 50, 6]);
  clock.startedAt = Date.now() - 180001;
  assert.equal(clock.getState().level, 2);
  assert.deepEqual([room.G.currentSb, room.G.currentBb, room.G.currentAnte], [25, 50, 6]);
  room._applyTournamentLevelForNextHand();
  assert.deepEqual([room.G.currentSb, room.G.currentBb, room.G.currentAnte], [30, 60, 7]);
  room.dispose();
  clock.dispose();
}

function testSharedTournamentClockAcrossTables() {
  const clock = new TournamentClock({ durationSec: 180, startedAt: Date.now() - 360001 });
  const tableA = tournamentRoom('shared-a', 6, { clock });
  const tableB = tournamentRoom('shared-b', 6, { clock });
  tableA._applyTournamentLevelForNextHand();
  tableB._applyTournamentLevelForNextHand();
  assert.equal(tableA.G.blindLevel, 3);
  assert.equal(tableB.G.blindLevel, 3);
  assert.deepEqual(
    [tableA.G.currentSb, tableA.G.currentBb, tableA.G.currentAnte],
    [tableB.G.currentSb, tableB.G.currentBb, tableB.G.currentAnte]
  );
  tableA.dispose();
  tableB.dispose();
  clock.dispose();
}

function testExplicitAnteModes() {
  const bbaRoom = tournamentRoom('ante-bba', 6, { anteType: ANTE_TYPES.BIG_BLIND_ANTE });
  bbaRoom.startHand();
  assert.equal(bbaRoom.G.pot, 125);
  const bbaPayers = bbaRoom.G.seats.filter(seat => seat.contributed > seat.bet);
  assert.equal(bbaPayers.length, 1);
  assert.equal(bbaPayers[0].contributed - bbaPayers[0].bet, 50);
  bbaRoom.dispose();

  const noAnteRoom = tournamentRoom('ante-none', 6, { anteType: ANTE_TYPES.NO_ANTE });
  noAnteRoom.startHand();
  assert.equal(noAnteRoom.G.pot, 75);
  assert.ok(noAnteRoom.G.seats.every(seat => seat.contributed === seat.bet));
  noAnteRoom.dispose();
}

testSidePots();
testRaiseTo();
testShortAllInDoesNotReopen();
testSnapshotRoundTrip();
testClassicAnteSixPlayers();
testClassicAnteNinePlayers();
testFoldKeepsAnte();
testPartialAnteAllIn();
testBlindsAlsoPayClassicAnte();
testAnteOnlyOncePerHand();
testLevelChangesOnlyForNextHand();
testSharedTournamentClockAcrossTables();
testExplicitAnteModes();
console.log('PASS  engine rules, persistence, ante and tournament clock (13/13)');
