'use strict';

const assert = require('node:assert/strict');
const { PokerRoom } = require('./server/gameEngine');

const HANDS_PER_TABLE = 250;
const START_STACK = 1_000_000;
const BASE_SEED = 0x41c6ce57;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fakeIo() {
  let winnerEvents = 0;
  return {
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to() {
      return {
        emit(name) {
          if (name === 'handWinners') winnerEvents += 1;
        }
      };
    },
    get winnerEvents() { return winnerEvents; }
  };
}

function chipTotal(room) {
  return Math.round((room.G.pot + room.G.seats.reduce(
    (sum, seat) => sum + Number(seat?.stack || 0), 0
  )) * 100) / 100;
}

function assertTableInvariant(room, expectedChips, label) {
  assert.equal(chipTotal(room), expectedChips, `${label}: chips are conserved`);
  assert.ok(room.G.pot >= 0, `${label}: pot is non-negative`);
  room.G.seats.forEach((seat, seatIdx) => {
    if (!seat) return;
    assert.ok(seat.stack >= 0, `${label}: seat ${seatIdx} stack is non-negative`);
    assert.ok(seat.bet >= 0, `${label}: seat ${seatIdx} bet is non-negative`);
  });
}

function runTableSoak(playerCount, seed) {
  const random = seededRandom(seed);
  const io = fakeIo();
  const room = new PokerRoom(`soak-${playerCount}`, {
    startStack: START_STACK,
    sb: 5,
    bb: 10,
    maxPlayers: playerCount === 9 ? 9 : 6,
    turnTimeSec: 30,
    launchMode: 'instant',
    anteType: 'NO_ANTE'
  }, io, { tournamentMode: true });
  room.tournamentClock.start = () => ({ level: 1, sb: 5, bb: 10, ante: 0 });
  room.startTurnTimer = () => {};
  room.scheduleBotAction = () => {};
  room._schedule = () => null;

  let queuedStep = null;
  room._scheduleHandStep = callback => {
    queuedStep = callback;
    return { soakStep: true };
  };

  room.shuffle = deck => {
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
    }
  };

  for (let seatIdx = 0; seatIdx < playerCount; seatIdx += 1) {
    assert.equal(room.addPlayer(seatIdx, {
      id: `socket-${seatIdx}`,
      playerId: `soak-player-${playerCount}-${seatIdx}`,
      name: `Player ${seatIdx}`,
      stack: START_STACK,
      avatar: seatIdx % 6,
      connected: true
    }), true);
  }

  const expectedChips = playerCount * START_STACK;
  let actions = 0;
  for (let hand = 1; hand <= HANDS_PER_TABLE; hand += 1) {
    room.G.phase = 'WAITING';
    room.G.actingSeat = -1;
    queuedStep = null;
    room.startHand();
    assert.equal(room.G.handNum, hand, `${playerCount}-player hand counter`);

    let handGuard = 0;
    while (room.G.phase !== 'SHOWDOWN') {
      handGuard += 1;
      assert.ok(handGuard < 500, `${playerCount}-player hand ${hand} cannot stall`);
      assertTableInvariant(room, expectedChips, `${playerCount}-player hand ${hand}`);

      if (queuedStep) {
        const step = queuedStep;
        queuedStep = null;
        step();
        continue;
      }

      const seatIdx = room.G.actingSeat;
      assert.ok(seatIdx >= 0, `${playerCount}-player hand ${hand} has an actor or transition`);
      const actor = room.G.seats[seatIdx];
      const contenders = room.G.seats.filter(seat => seat?.inHand).length;
      const toCall = Math.max(0, room.G.currentBet - actor.bet);
      const roll = random();
      let action = toCall > 0 ? 'call' : 'check';
      let amount = 0;

      if (toCall > 0 && contenders > 2 && roll < 0.08) {
        action = 'fold';
      } else if (roll < 0.20 && room.canSeatRaise(seatIdx)) {
        const target = room.G.currentBet + room.G.minRaise;
        if (target <= actor.bet + actor.stack) {
          action = 'raise';
          amount = target;
        }
      }

      assert.equal(room.doAction(seatIdx, action, amount), true,
        `${playerCount}-player hand ${hand}: ${action} is accepted`);
      actions += 1;
    }

    assertTableInvariant(room, expectedChips, `${playerCount}-player showdown ${hand}`);
    assert.equal(io.winnerEvents, hand, `${playerCount}-player hand emits one winner event`);
    assert.equal(room.turnTimer, null);
    assert.equal(room._transitionTimeouts.size, 0);
  }

  room.dispose();
  return { playerCount, hands: HANDS_PER_TABLE, actions, seed };
}

const memoryBefore = process.memoryUsage().heapUsed;
const results = [2, 3, 6, 9].map((playerCount, index) => (
  runTableSoak(playerCount, BASE_SEED + index)
));
const heapGrowth = process.memoryUsage().heapUsed - memoryBefore;
assert.ok(heapGrowth < 64 * 1024 * 1024, `heap growth remains bounded (${heapGrowth} bytes)`);

console.log(JSON.stringify({
  passed: true,
  seed: BASE_SEED,
  totalHands: results.reduce((sum, result) => sum + result.hands, 0),
  totalActions: results.reduce((sum, result) => sum + result.actions, 0),
  heapGrowth,
  tables: results
}, null, 2));
