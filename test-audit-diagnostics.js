'use strict';

const assert = require('node:assert/strict');
const { PokerRoom, getBestScore } = require('./server/gameEngine');

function recordingIo() {
  const events = [];
  return {
    events,
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to(roomId) {
      return { emit(name, payload) { events.push({ roomId, name, payload }); } };
    }
  };
}

function card(v, s) { return { v, s }; }

function player(name, cards, contributed, options = {}) {
  return {
    name,
    cards,
    contributed,
    stack: options.stack ?? 0,
    bet: options.bet ?? 0,
    inHand: options.inHand !== false,
    acted: options.acted ?? true,
    canRaise: options.canRaise ?? true,
    lastAction: '',
    connected: options.connected !== false,
    isBot: false,
    playerId: options.playerId || `player-${name}`,
    publicPlayerId: `public-${name}`
  };
}

function createRoom(id, io = recordingIo(), options = {}) {
  return new PokerRoom(id, {
    startStack: 1000,
    sb: 5,
    bb: 10,
    maxPlayers: 6,
    turnTimeSec: 30
  }, io, options);
}

function detectOddChipSeatOrdering() {
  const io = recordingIo();
  const room = createRoom('audit-odd-chip', io);
  room.G.handNum = 1;
  room.G.phase = 'RIVER';
  room.G.dealerSeat = 4;
  room.G.actingSeat = -1;
  room.G.board = [
    card('A', 'H'), card('K', 'D'), card('Q', 'C'), card('J', 'S'), card('2', 'H')
  ];
  room.G.pot = 0.03;
  room.G.seats[0] = player('Seat0', [card('10', 'C'), card('3', 'C')], 0.01);
  room.G.seats[1] = player('Loser', [card('9', 'C'), card('8', 'C')], 0.01);
  room.G.seats[5] = player('Seat5', [card('10', 'D'), card('4', 'D')], 0.01);

  assert.equal(room.endHand(), true);
  const actualOddChipSeat = room.G.seats[0].stack > room.G.seats[5].stack ? 0 : 5;
  const expectedOddChipSeat = 5; // first tied winner clockwise from dealer seat 4
  room.dispose();
  return {
    confirmed: actualOddChipSeat !== expectedOddChipSeat,
    dealerSeat: 4,
    tiedWinnerSeats: [0, 5],
    expectedOddChipSeat,
    actualOddChipSeat
  };
}

function verifyReconnectTimerPreserved() {
  const room = createRoom('audit-reconnect-timer');
  room.G.phase = 'FLOP';
  room.G.actingSeat = 0;
  room.G.currentBet = 0;
  room.G.seats[0] = player('Actor', [], 0, {
    stack: 100,
    playerId: 'actor',
    acted: false
  });
  room.G.seats[1] = player('Other', [], 0, { stack: 100, playerId: 'other' });
  room.players.set('actor', 0);
  room.startTurnTimer(1000);
  const deadlineBeforeReconnect = room.G.actingDeadline;
  assert.equal(room.reconnectPlayer('actor', 'socket-new'), 0);
  assert.equal(room.G.actingDeadline, deadlineBeforeReconnect, 'reconnect must preserve the absolute deadline');
  assert.equal(room.reconnectPlayer('actor', 'socket-newer'), 0);
  assert.equal(room.G.actingDeadline, deadlineBeforeReconnect, 'rapid tab replacement must not extend the clock');
  room.dispose();
  return { passed: true, deadlinePreserved: deadlineBeforeReconnect };
}

function captureTurnTimer(room) {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let capturedCallback = null;
  global.setTimeout = callback => {
    capturedCallback = callback;
    return { auditTimer: true };
  };
  global.clearTimeout = () => {};
  try {
    room.startTurnTimer(1000);
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
  assert.equal(typeof capturedCallback, 'function');
  return capturedCallback;
}

function staleTurnRoom(id) {
  const room = createRoom(id);
  room.G.handNum = 11;
  room.G.phase = 'FLOP';
  room.G.turnId = 20;
  room.G.currentBet = 10;
  room.G.minRaise = 10;
  room.G.actingSeat = 0;
  room.G.seats[0] = player('OriginalActor', [], 10, { stack: 90, bet: 10, acted: false });
  room.G.seats[1] = player('NextActor', [], 0, { stack: 100, bet: 0, acted: false });
  room.broadcastAction = () => {};
  room.afterAction = () => {};
  return room;
}

function verifyStaleTurnCallbacks() {
  const mutations = [
    room => { room.G.handNum += 1; },
    room => { room.G.turnId += 1; },
    room => { room.G.phase = 'TURN'; },
    room => { room.G.actingSeat = 1; }
  ];

  mutations.forEach((mutate, index) => {
    const room = staleTurnRoom(`audit-stale-turn-${index}`);
    const callback = captureTurnTimer(room);
    mutate(room);
    const before = actionState(room);
    callback();
    assert.equal(actionState(room), before, `stale timer mutation ${index} must not act`);
    room.dispose();
  });

  const botRoom = staleTurnRoom('audit-stale-bot');
  botRoom.G.seats[0].isBot = true;
  let botCallback = null;
  botRoom._schedule = callback => {
    botCallback = callback;
    return { auditBotTimer: true };
  };
  botRoom.scheduleBotAction();
  assert.equal(typeof botCallback, 'function');
  botRoom.G.turnId += 1;
  botRoom.G.actingSeat = 1;
  const botState = actionState(botRoom);
  botCallback();
  assert.equal(actionState(botRoom), botState, 'stale bot callback must not act for the next player');
  botRoom.dispose();

  return { passed: true, guardedTimerTransitions: mutations.length, botGuarded: true };
}

function detectFoldWinRestoreTransition() {
  const source = createRoom('audit-restore-source');
  source.G.handNum = 7;
  source.G.phase = 'FLOP';
  source.G.actingSeat = -1;
  source.G.board = [card('2', 'S'), card('7', 'H'), card('J', 'D')];
  source.G.deck = [card('A', 'C'), card('K', 'C')];
  source.G.pot = 20;
  source.G.seats[0] = player('FoldWinner', [card('A', 'S'), card('A', 'H')], 10, { stack: 90 });
  source.G.seats[1] = player('Folded', [], 10, { stack: 90, inHand: false });
  const snapshot = source.getSnapshot();
  source.dispose();

  const restored = createRoom('audit-restore-target', recordingIo(), { snapshot });
  let scheduledStep = null;
  restored._scheduleHandStep = callback => { scheduledStep = callback; };
  restored.resumeAfterRestore();
  assert.equal(typeof scheduledStep, 'function');
  scheduledStep();
  const phaseAfterResume = restored.G.phase;
  const boardLengthAfterResume = restored.G.board.length;
  restored.dispose();
  return {
    confirmed: phaseAfterResume === 'TURN' && boardLengthAfterResume === 4,
    expected: 'SHOWDOWN with immediate uncontested payout',
    actual: `${phaseAfterResume} with ${boardLengthAfterResume} board cards`
  };
}

function verifyShortBlindDecision() {
  const room = createRoom('audit-short-blind-action');
  room.config.launchMode = 'instant';
  room.config.anteType = 'NO_ANTE';
  room.tournamentClock.start = () => ({ level: 1, sb: 5, bb: 10, ante: 0 });
  room.G.seats[0] = player('ShortBigBlind', [], 0, { stack: 7, playerId: 'short-bb' });
  room.G.seats[1] = player('DeepSmallBlind', [], 0, { stack: 100, playerId: 'deep-sb' });
  room.startHand();
  assert.equal(room.G.actingSeat, 1, 'the deep small blind must act against the short all-in big blind');
  assert.equal(room.G.currentBet - room.G.seats[1].bet, 2);
  assert.equal(room.validateAction(1, 'check', 0).reason, 'CHECK_REQUIRES_NO_BET');
  assert.equal(room.validateAction(1, 'call', 0).ok, true);
  assert.equal(room.doAction(1, 'call', 0), true);
  assert.equal(room.G.seats[0].contributed, 7);
  assert.equal(room.G.seats[1].contributed, 7);
  assert.equal(room.G.pot, 14);
  assert.equal(
    room.G.pot + room.G.seats.reduce((sum, seat) => sum + Number(seat?.stack || 0), 0),
    107,
    'chips must be conserved after the short blind call'
  );
  room.dispose();

  const decisionMatrix = [];
  for (const occupiedSeats of [3, 6, 9]) {
    const matrixRoom = new PokerRoom(
      `audit-pending-${occupiedSeats}`,
      { startStack: 1000, sb: 5, bb: 10, maxPlayers: occupiedSeats === 9 ? 9 : 6 },
      recordingIo()
    );
    matrixRoom.G.phase = 'PREFLOP';
    matrixRoom.G.currentBet = 100;
    for (let index = 0; index < occupiedSeats; index++) {
      matrixRoom.G.seats[index] = player(`P${index}`, [], 100, {
        stack: 0,
        bet: 100,
        acted: true
      });
    }
    matrixRoom.G.seats[0].stack = 900;
    matrixRoom.G.seats[0].bet = 80;
    matrixRoom.G.seats[0].acted = false;
    assert.equal(matrixRoom.hasPendingBettingDecision(), true, `${occupiedSeats}-handed unmatched bet needs action`);
    matrixRoom.G.seats[0].bet = 100;
    assert.equal(matrixRoom.hasPendingBettingDecision(), false, `${occupiedSeats}-handed matched lone stack runs out`);
    if (occupiedSeats > 1) {
      matrixRoom.G.seats[1].stack = 900;
      matrixRoom.G.seats[1].acted = false;
      assert.equal(matrixRoom.hasPendingBettingDecision(), true, `${occupiedSeats}-handed two live stacks need action`);
    }
    decisionMatrix.push(occupiedSeats);
    matrixRoom.dispose();
  }

  return { passed: true, headsUpCall: 2, decisionMatrix };
}

function actionState(room) {
  return JSON.stringify({
    phase: room.G.phase,
    actingSeat: room.G.actingSeat,
    turnId: room.G.turnId,
    currentBet: room.G.currentBet,
    minRaise: room.G.minRaise,
    pot: room.G.pot,
    seats: room.G.seats,
    processedCommands: [...room.processedActionCommands]
  });
}

function createActionRoom(id, options = {}) {
  const room = createRoom(id);
  room.G.phase = 'FLOP';
  room.G.handNum = 1;
  room.G.currentBet = options.currentBet ?? 20;
  room.G.minRaise = options.minRaise ?? 20;
  room.G.actingSeat = options.actingSeat ?? 0;
  room.G.seats[0] = player('Actor', [], 0, {
    stack: options.actorStack ?? 100,
    bet: options.actorBet ?? 0,
    acted: false
  });
  room.G.seats[1] = player('Other', [], options.otherBet ?? room.G.currentBet, {
    stack: options.otherStack ?? 100,
    bet: options.otherBet ?? room.G.currentBet,
    acted: true,
    canRaise: options.otherCanRaise ?? true
  });
  room.afterAction = () => {};
  room.broadcastAction = () => {};
  return room;
}

function assertRejectedWithoutMutation(room, action, amount, expectedReason) {
  const before = actionState(room);
  const status = room.validateAction?.(0, action, amount) || { ok: room.doAction(0, action, amount) };
  assert.equal(status.ok, false, `${action} ${String(amount)} must be rejected`);
  if (expectedReason) assert.equal(status.reason, expectedReason);
  assert.equal(actionState(room), before, 'a rejected action must not mutate game state');
}

function verifyStrictActionValidation() {
  const checkRoom = createRoom('audit-check-coercion');
  checkRoom.G.phase = 'FLOP';
  checkRoom.G.handNum = 1;
  checkRoom.G.currentBet = 50;
  checkRoom.G.minRaise = 20;
  checkRoom.G.actingSeat = 0;
  checkRoom.G.seats[0] = player('Checker', [], 0, { stack: 100, bet: 0, acted: false });
  checkRoom.G.seats[1] = player('Bettor', [], 50, { stack: 50, bet: 50, acted: true });
  checkRoom.afterAction = () => {};
  checkRoom.broadcastAction = () => {};
  assertRejectedWithoutMutation(checkRoom, 'check', 0, 'CHECK_REQUIRES_NO_BET');
  checkRoom.dispose();

  const noBetRoom = createActionRoom('audit-call-without-bet', { currentBet: 0, minRaise: 10, otherBet: 0 });
  assertRejectedWithoutMutation(noBetRoom, 'call', 0, 'CALL_REQUIRES_BET');
  assert.equal(noBetRoom.doAction(0, 'check', 0), true);
  assert.equal(noBetRoom.G.seats[0].lastAction, 'CHECK');
  noBetRoom.dispose();

  const invalidRaises = [
    [Number.NaN, 'INVALID_RAISE_AMOUNT'],
    [Number.POSITIVE_INFINITY, 'INVALID_RAISE_AMOUNT'],
    ['40', 'INVALID_RAISE_AMOUNT'],
    [-1, 'INVALID_RAISE_AMOUNT'],
    [40.001, 'INVALID_RAISE_AMOUNT'],
    [30, 'RAISE_BELOW_MINIMUM'],
    [101, 'RAISE_EXCEEDS_STACK']
  ];
  invalidRaises.forEach(([amount, reason], index) => {
    const room = createActionRoom(`audit-invalid-raise-${index}`);
    assertRejectedWithoutMutation(room, 'raise', amount, reason);
    room.dispose();
  });

  const callRoom = createActionRoom('audit-valid-call');
  assert.equal(callRoom.doAction(0, 'call', 0), true);
  assert.equal(callRoom.G.seats[0].bet, 20);
  callRoom.dispose();

  const minRaiseRoom = createActionRoom('audit-valid-min-raise');
  assert.equal(minRaiseRoom.doAction(0, 'raise', 40), true);
  assert.equal(minRaiseRoom.G.seats[0].bet, 40);
  minRaiseRoom.dispose();

  const shortAllInRoom = createActionRoom('audit-valid-short-all-in', {
    actorStack: 30,
    otherCanRaise: false
  });
  assert.equal(shortAllInRoom.doAction(0, 'raise', 30), true);
  assert.equal(shortAllInRoom.G.seats[0].stack, 0);
  assert.equal(shortAllInRoom.G.seats[1].canRaise, false, 'a short all-in must not reopen raising rights');
  shortAllInRoom.dispose();

  const fullAllInRoom = createActionRoom('audit-valid-full-all-in');
  assert.equal(fullAllInRoom.doAction(0, 'raise', 100), true);
  assert.equal(fullAllInRoom.G.seats[0].stack, 0);
  fullAllInRoom.dispose();

  return {
    passed: true,
    rejectedWithoutMutation: 9,
    accepted: ['check', 'call', 'min raise', 'short all-in', 'full all-in']
  };
}

function verifyAllFiveCardCategoryCounts() {
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suits = ['S', 'H', 'D', 'C'];
  const deck = suits.flatMap(s => values.map(v => card(v, s)));
  const counts = Array(10).fill(0);
  const base = 16 ** 5;
  let total = 0;

  for (let a = 0; a < 48; a++) {
    for (let b = a + 1; b < 49; b++) {
      for (let c = b + 1; c < 50; c++) {
        for (let d = c + 1; d < 51; d++) {
          for (let e = d + 1; e < 52; e++) {
            const rank = Math.floor(getBestScore([], [deck[a], deck[b], deck[c], deck[d], deck[e]]) / base);
            counts[rank]++;
            total++;
          }
        }
      }
    }
  }

  const expected = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 36, 4];
  assert.equal(total, 2598960);
  assert.deepEqual(counts, expected);
  return { total, counts, expected, passed: true };
}

function verifyReferenceShowdowns() {
  const categoryBase = 16 ** 5;
  const score = cards => getBestScore([], cards);
  const category = cards => Math.floor(score(cards) / categoryBase);

  const categoryVectors = [
    { expected: 0, cards: [card('A', 'S'), card('K', 'D'), card('9', 'C'), card('7', 'H'), card('3', 'S')] },
    { expected: 1, cards: [card('A', 'S'), card('A', 'D'), card('K', 'C'), card('Q', 'H'), card('2', 'S')] },
    { expected: 2, cards: [card('A', 'S'), card('A', 'D'), card('K', 'C'), card('K', 'H'), card('Q', 'S')] },
    { expected: 3, cards: [card('A', 'S'), card('A', 'D'), card('A', 'C'), card('K', 'H'), card('Q', 'S')] },
    { expected: 4, cards: [card('2', 'S'), card('3', 'H'), card('4', 'D'), card('5', 'C'), card('6', 'S')] },
    { expected: 5, cards: [card('A', 'S'), card('J', 'S'), card('8', 'S'), card('4', 'S'), card('2', 'S')] },
    { expected: 6, cards: [card('A', 'S'), card('A', 'D'), card('A', 'C'), card('K', 'H'), card('K', 'S')] },
    { expected: 7, cards: [card('A', 'S'), card('A', 'D'), card('A', 'C'), card('A', 'H'), card('K', 'S')] },
    { expected: 8, cards: [card('9', 'S'), card('10', 'S'), card('J', 'S'), card('Q', 'S'), card('K', 'S')] },
    { expected: 9, cards: [card('10', 'S'), card('J', 'S'), card('Q', 'S'), card('K', 'S'), card('A', 'S')] }
  ];
  assert.deepEqual(categoryVectors.map(vector => category(vector.cards)), categoryVectors.map(vector => vector.expected));

  const wheel = score([card('A', 'S'), card('2', 'H'), card('3', 'D'), card('4', 'C'), card('5', 'S')]);
  const sixHighStraight = score([card('2', 'S'), card('3', 'H'), card('4', 'D'), card('5', 'C'), card('6', 'S')]);
  assert.ok(sixHighStraight > wheel, 'six-high straight must beat a wheel');

  const pairWithJackKicker = score([card('A', 'S'), card('A', 'D'), card('K', 'C'), card('Q', 'H'), card('J', 'S')]);
  const pairWithTenKicker = score([card('A', 'H'), card('A', 'C'), card('K', 'D'), card('Q', 'S'), card('10', 'H')]);
  assert.ok(pairWithJackKicker > pairWithTenKicker, 'pair kicker ordering must be lexicographic');

  const jackHighFlushKicker = score([card('A', 'S'), card('J', 'S'), card('8', 'S'), card('4', 'S'), card('2', 'S')]);
  const tenHighFlushKicker = score([card('A', 'H'), card('10', 'H'), card('9', 'H'), card('4', 'H'), card('2', 'H')]);
  assert.ok(jackHighFlushKicker > tenHighFlushKicker, 'flush kickers must be compared in order');

  const sharedRoyalBoard = [card('10', 'S'), card('J', 'S'), card('Q', 'S'), card('K', 'S'), card('A', 'S')];
  const playerOneBoardTie = getBestScore([card('2', 'C'), card('3', 'D')], sharedRoyalBoard);
  const playerTwoBoardTie = getBestScore([card('A', 'D'), card('A', 'C')], sharedRoyalBoard);
  assert.equal(playerOneBoardTie, playerTwoBoardTie, 'identical best five cards on the board must tie');

  const bestFiveFromSeven = getBestScore(
    [card('A', 'S'), card('A', 'H')],
    [card('A', 'D'), card('K', 'C'), card('K', 'H'), card('2', 'S'), card('3', 'D')]
  );
  assert.equal(Math.floor(bestFiveFromSeven / categoryBase), 6, 'best five of seven must detect a full house');

  const turnBoard = [card('A', 'C'), card('K', 'D'), card('7', 'S'), card('2', 'H')];
  const riverBoard = [...turnBoard, card('10', 'S')];
  const playerOne = [card('A', 'D'), card('A', 'H')];
  const playerTwo = [card('Q', 'S'), card('J', 'S')];
  assert.ok(getBestScore(playerOne, turnBoard) > getBestScore(playerTwo, turnBoard), 'player one must lead on the turn');
  assert.ok(getBestScore(playerTwo, riverBoard) > getBestScore(playerOne, riverBoard), 'river must be able to change the winner');

  return {
    passed: true,
    categoryVectors: categoryVectors.length,
    checks: ['wheel', 'pair kickers', 'flush kickers', 'board tie', 'best five of seven', 'river changes winner']
  };
}

const startedAt = Date.now();
const result = {
  oddChip: detectOddChipSeatOrdering(),
  reconnectTimer: verifyReconnectTimerPreserved(),
  staleTurnCallback: verifyStaleTurnCallbacks(),
  foldWinRestore: detectFoldWinRestoreTransition(),
  shortBlindAction: verifyShortBlindDecision(),
  actionValidation: verifyStrictActionValidation(),
  evaluator: verifyAllFiveCardCategoryCounts(),
  referenceShowdowns: verifyReferenceShowdowns()
};
result.elapsedMs = Date.now() - startedAt;
console.log(JSON.stringify(result, null, 2));
