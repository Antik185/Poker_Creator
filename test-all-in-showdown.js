'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PokerRoom } = require('./server/gameEngine');

function recordingIo() {
  const events = [];
  return {
    events,
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to(roomId) {
      return {
        emit(name, payload) { events.push({ roomId, name, payload }); }
      };
    }
  };
}

function player(name, cards, contributed, options = {}) {
  return {
    name,
    cards,
    contributed,
    stack: options.stack ?? 0,
    bet: 0,
    inHand: options.inHand !== false,
    acted: true,
    canRaise: false,
    lastAction: 'ALL-IN',
    connected: true,
    isBot: false,
    playerId: options.playerId || `player-${name}`,
    publicPlayerId: options.publicPlayerId || `public-${name}`
  };
}

function card(v, s) { return { v, s }; }

function winnerEvents(io) {
  return io.events.filter(event => event.name === 'handWinners');
}

function createRoom(id, options = {}) {
  const io = options.io || recordingIo();
  const room = new PokerRoom(id, {
    startStack: 1000,
    sb: 5,
    bb: 10,
    maxPlayers: options.maxPlayers || 6
  }, io, {
    tournamentMode: options.tournamentMode === true,
    snapshot: options.snapshot
  });
  return { room, io };
}

function setHeadsUpAllIn(room, phase, board, deck) {
  room.G.handNum = 1;
  room.G.phase = phase;
  room.G.board = board.slice();
  room.G.deck = deck.slice();
  room.G.pot = 200;
  room.G.actingSeat = -1;
  room.G.seats[0] = player('A', [card('A', 'S'), card('A', 'H')], 100);
  room.G.seats[1] = player('B', [card('K', 'D'), card('Q', 'D')], 100);
}

function advanceNow(room) {
  room._clearHandStep();
  return room.advancePhase();
}

function testRiverChangesLeader() {
  const { room, io } = createRoom('river-changes-leader');
  setHeadsUpAllIn(room, 'TURN', [
    card('K', 'S'), card('7', 'H'), card('2', 'D'), card('3', 'C')
  ], [card('K', 'C')]);

  assert.equal(room.endHand(), false, 'a contested turn must not finalize');
  assert.equal(room.G.pot, 200);
  assert.equal(winnerEvents(io).length, 0);

  assert.equal(advanceNow(room), true);
  assert.equal(room.G.phase, 'RIVER');
  assert.equal(room.G.board.length, 5);
  assert.equal(winnerEvents(io).length, 0, 'river reveal is not showdown');

  assert.equal(advanceNow(room), true);
  assert.equal(room.G.phase, 'SHOWDOWN');
  assert.equal(room.G.seats[1].stack, 200, 'river trips beat turn-leading aces');
  assert.equal(winnerEvents(io).length, 1);
  assert.equal(winnerEvents(io)[0].payload.handNum, 1);
  assert.equal(winnerEvents(io)[0].payload.winnerName, 'B');

  assert.equal(room.endHand(), false, 'same hand cannot finalize twice');
  assert.equal(room.advancePhase(), false, 'stale transition cannot finalize showdown');
  assert.equal(room.G.seats[1].stack, 200);
  assert.equal(winnerEvents(io).length, 1);
  room.dispose();
}

function testAllInRunoutFromEveryStreet() {
  const cases = [
    {
      phase: 'PREFLOP',
      board: [],
      deck: [card('J', 'C'), card('8', 'C'), card('4', 'C'), card('3', 'H'), card('2', 'S')],
      expectedBoards: [3, 4, 5]
    },
    {
      phase: 'FLOP',
      board: [card('2', 'S'), card('3', 'H'), card('4', 'C')],
      deck: [card('J', 'C'), card('8', 'C')],
      expectedBoards: [4, 5]
    },
    {
      phase: 'TURN',
      board: [card('2', 'S'), card('3', 'H'), card('4', 'C'), card('8', 'C')],
      deck: [card('J', 'C')],
      expectedBoards: [5]
    }
  ];

  cases.forEach(({ phase, board, deck, expectedBoards }) => {
    const { room, io } = createRoom(`all-in-${phase.toLowerCase()}`);
    setHeadsUpAllIn(room, phase, board, deck);
    expectedBoards.forEach(expectedBoardLength => {
      assert.equal(advanceNow(room), true);
      assert.equal(room.G.board.length, expectedBoardLength);
      assert.equal(winnerEvents(io).length, 0, `${phase}: no winner before showdown`);
    });
    assert.equal(room.G.phase, 'RIVER');
    assert.equal(advanceNow(room), true);
    assert.equal(room.G.phase, 'SHOWDOWN');
    assert.equal(winnerEvents(io).length, 1, `${phase}: exactly one final result`);
    room.dispose();
  });
}

function testLockedWinnerStillGetsRiver() {
  const { room, io } = createRoom('locked-winner-river');
  room.G.handNum = 1;
  room.G.phase = 'TURN';
  room.G.board = [card('A', 'D'), card('A', 'C'), card('K', 'S'), card('Q', 'H')];
  room.G.deck = [card('2', 'D')];
  room.G.pot = 200;
  room.G.actingSeat = -1;
  room.G.seats[0] = player('Quads', [card('A', 'S'), card('A', 'H')], 100);
  room.G.seats[1] = player('DrawingDead', [card('K', 'D'), card('Q', 'D')], 100);

  assert.equal(advanceNow(room), true);
  assert.equal(room.G.board.length, 5);
  assert.equal(winnerEvents(io).length, 0);
  assert.equal(advanceNow(room), true);
  assert.equal(winnerEvents(io)[0].payload.winnerName, 'Quads');
  room.dispose();
}

function testNormalStreetTransitionKeepsHoleCardsPrivate() {
  const { room } = createRoom('normal-street-transition');
  room.G.handNum = 1;
  room.G.phase = 'PREFLOP';
  room.G.actingSeat = 0;
  room.G.currentBet = 10;
  room.G.minRaise = 10;
  room.G.pot = 20;
  room.G.seats[0] = player('A', [card('A', 'S'), card('K', 'H')], 10, { stack: 90 });
  room.G.seats[1] = player('B', [card('Q', 'S'), card('J', 'H')], 10, { stack: 90 });
  room.G.seats.slice(0, 2).forEach(seat => {
    seat.bet = 10;
    seat.acted = false;
    seat.canRaise = true;
    seat.lastAction = '';
  });

  assert.equal(room.doAction(0, 'raise', 20), true);
  assert.equal(room.G.actingSeat, 1);
  assert.equal(room.doAction(1, 'call', 0), true);
  assert.equal(room.G.actingSeat, -1, 'the completed street is locked before the flop');
  assert.deepEqual(room.G.seats.slice(0, 2).map(seat => seat.stack), [80, 80]);

  assert.equal(room._isAllInRunout(), false);
  assert.deepEqual(room.sanitizedState(0).seats[1].cards, [{ hidden: true }, { hidden: true }]);

  room.G.seats[1].stack = 0;
  assert.equal(room._isAllInRunout(), true);
  assert.deepEqual(room.sanitizedState(0).seats[1].cards, room.G.seats[1].cards);
  room.dispose();
}

function testSidePotsAndUncalledRefund() {
  const { room, io } = createRoom('three-side-pots');
  room.G.handNum = 1;
  room.G.phase = 'RIVER';
  room.G.board = [
    card('2', 'S'), card('3', 'H'), card('4', 'D'), card('8', 'C'), card('J', 'S')
  ];
  room.G.pot = 900;
  room.G.actingSeat = -1;
  room.G.seats[0] = player('A', [card('A', 'S'), card('A', 'H')], 100);
  room.G.seats[1] = player('B', [card('K', 'S'), card('K', 'H')], 300);
  room.G.seats[2] = player('C', [card('Q', 'S'), card('Q', 'H')], 500);

  assert.equal(room.endHand(), true);
  assert.deepEqual(room.G.seats.slice(0, 3).map(seat => seat.stack), [300, 400, 200]);
  const payload = winnerEvents(io)[0].payload;
  assert.deepEqual(payload.pots, [
    { winners: [0], pot: 300 },
    { winners: [1], pot: 400 }
  ]);
  assert.deepEqual(payload.refunds, [
    { seatIdx: 2, name: 'C', amount: 200 }
  ]);
  assert.deepEqual(payload.winnerSeatIdxs, [0, 1]);
  assert.deepEqual(payload.awards, [
    { seatIdx: 0, name: 'A', amount: 300 },
    { seatIdx: 1, name: 'B', amount: 400 }
  ]);
  assert.equal(room.endHand(), false);
  assert.deepEqual(room.G.seats.slice(0, 3).map(seat => seat.stack), [300, 400, 200]);
  room.dispose();
}

function testWinnerCanAlsoReceiveUncalledRefund() {
  const { room, io } = createRoom('winner-and-refund');
  room.G.handNum = 1;
  room.G.phase = 'RIVER';
  room.G.board = [
    card('2', 'S'), card('3', 'H'), card('4', 'D'), card('8', 'C'), card('J', 'S')
  ];
  room.G.pot = 900;
  room.G.actingSeat = -1;
  room.G.seats[0] = player('A', [card('K', 'S'), card('K', 'H')], 100);
  room.G.seats[1] = player('B', [card('Q', 'S'), card('Q', 'H')], 300);
  room.G.seats[2] = player('C', [card('A', 'S'), card('A', 'H')], 500);

  assert.equal(room.endHand(), true);
  const payload = winnerEvents(io)[0].payload;
  assert.deepEqual(room.G.seats.slice(0, 3).map(seat => seat.stack), [0, 0, 900]);
  assert.deepEqual(payload.winnerSeatIdxs, [2]);
  assert.deepEqual(payload.awards, [
    { seatIdx: 2, name: 'C', amount: 700 }
  ]);
  assert.deepEqual(payload.refunds, [
    { seatIdx: 2, name: 'C', amount: 200 }
  ]);
  room.dispose();
}

function testRaiseRejectedWhenNobodyCanRespond() {
  const { room } = createRoom('uncalled-raise-guard');
  room.G.handNum = 1;
  room.G.phase = 'PREFLOP';
  room.G.actingSeat = 2;
  room.G.currentBet = 300;
  room.G.minRaise = 200;
  room.G.pot = 400;
  room.G.seats[0] = player('A', [], 100);
  room.G.seats[0].bet = 100;
  room.G.seats[1] = player('B', [], 300);
  room.G.seats[1].bet = 300;
  room.G.seats[2] = player('C', [], 0, { stack: 500 });
  room.G.seats[2].canRaise = true;

  assert.equal(room.canSeatRaise(2), false);
  assert.equal(room.doAction(2, 'raise', 500), false);
  assert.equal(room.G.seats[2].bet, 0);
  assert.equal(room.G.seats[2].contributed, 0);
  assert.equal(room.G.seats[2].stack, 500);
  assert.equal(room.G.currentBet, 300);

  assert.equal(room.doAction(2, 'call', 0), true);
  assert.equal(room.G.seats[2].bet, 300);
  assert.equal(room.G.seats[2].contributed, 300);
  assert.equal(room.G.seats[2].stack, 200);
  assert.equal(room.G.currentBet, 300);
  room.dispose();
}

function testFoldEndsImmediately() {
  const { room, io } = createRoom('fold-immediate');
  room.G.handNum = 1;
  room.G.phase = 'FLOP';
  room.G.board = [card('2', 'S'), card('3', 'H'), card('4', 'D')];
  room.G.pot = 200;
  room.G.seats[0] = player('Winner', [card('A', 'S'), card('A', 'H')], 100, { stack: 900 });
  room.G.seats[1] = player('Folder', [], 100, { stack: 900, inHand: false });

  assert.equal(room.endHand(), true);
  assert.equal(room.G.seats[0].stack, 1100);
  assert.equal(winnerEvents(io).length, 1);
  room.dispose();
}

function testCompletedBettingRoundLocksFurtherActions() {
  const { room } = createRoom('round-transition-lock');
  room.G.handNum = 1;
  room.G.phase = 'FLOP';
  room.G.actingSeat = 0;
  room.G.currentBet = 20;
  room.G.seats[0] = player('A', [card('A', 'S'), card('A', 'H')], 20, { stack: 980 });
  room.G.seats[1] = player('B', [card('K', 'S'), card('K', 'H')], 20, { stack: 980 });
  room.G.seats[0].bet = 20;
  room.G.seats[1].bet = 20;

  room.afterAction();
  assert.equal(room.G.actingSeat, -1, 'the street is locked while its transition is pending');
  assert.equal(room.doAction(0, 'call', 0), false, 'a repeated command cannot postpone the transition');
  room.dispose();
}

async function testDuplicateTimersAndRestore() {
  const { room, io } = createRoom('duplicate-timers');
  setHeadsUpAllIn(room, 'RIVER', [
    card('2', 'S'), card('3', 'H'), card('4', 'D'), card('8', 'C'), card('J', 'S')
  ], []);

  room._scheduleHandStep(() => room.advancePhase(), 10);
  room._scheduleHandStep(() => room.advancePhase(), 10);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(winnerEvents(io).length, 1, 'competing timers emit one result');
  const paidStacks = room.G.seats.slice(0, 2).map(seat => seat.stack);
  const snapshot = room.getSnapshot();
  assert.equal(snapshot.finalizedHandNum, 1);

  const restoredIo = recordingIo();
  const { room: restored } = createRoom('duplicate-timers', { io: restoredIo, snapshot });
  assert.equal(restored.endHand(), false, 'restored showdown stays finalized');
  assert.deepEqual(restored.G.seats.slice(0, 2).map(seat => seat.stack), paidStacks);
  assert.equal(winnerEvents(restoredIo).length, 0);
  restored.dispose();
  room.dispose();
}

function testTournamentModeUsesSameGuard() {
  const { room, io } = createRoom('mtt-all-in', { tournamentMode: true });
  setHeadsUpAllIn(room, 'TURN', [
    card('K', 'S'), card('7', 'H'), card('2', 'D'), card('3', 'C')
  ], [card('K', 'C')]);

  assert.equal(room.endHand(), false);
  assert.equal(advanceNow(room), true);
  assert.equal(winnerEvents(io).length, 0);
  assert.equal(advanceNow(room), true);
  assert.equal(winnerEvents(io).length, 1);
  assert.equal(room.endHand(), false);
  room.dispose();
}

function testClientRejectsDuplicateAndStaleWinners() {
  const js = fs.readFileSync(path.join(__dirname, 'public', 'poker.js'), 'utf8');
  assert.match(js, /_seenHandWinnerEvents\.has\(eventId\)/);
  assert.match(js, /handNum !== Number\(G\.handNum\)/);
  assert.match(js, /if\(G\.phase !== 'SHOWDOWN'\) return/);
  assert.match(js, /revealPeekCard\(\(\)=>presentHandWinners\(payload\)\)/);
  assert.match(js, /const mainPotWinnerSeatIdxs = Array\.isArray\(pots\?\.\[0\]\?\.winners\)/);
  assert.match(js, /showWin\(isSingleSplitPot \? 'SPLIT POT' : 'ПОБЕДИТЕЛИ', firstPot, -1, mainPotWinnerSeatIdxs, subtitle\)/);
}

(async () => {
  testRiverChangesLeader();
  testAllInRunoutFromEveryStreet();
  testLockedWinnerStillGetsRiver();
  testNormalStreetTransitionKeepsHoleCardsPrivate();
  testSidePotsAndUncalledRefund();
  testWinnerCanAlsoReceiveUncalledRefund();
  testRaiseRejectedWhenNobodyCanRespond();
  testFoldEndsImmediately();
  testCompletedBettingRoundLocksFurtherActions();
  await testDuplicateTimersAndRestore();
  testTournamentModeUsesSameGuard();
  testClientRejectsDuplicateAndStaleWinners();
  console.log('PASS  all-in river/showdown finalization, side pots and MTT (13/13 scenarios)');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
