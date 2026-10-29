'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TournamentManager,
  getTargetDistribution
} = require('./server/tournamentManager');
const { TournamentClock } = require('./server/tournamentClock');
const {
  TOURNAMENT_AVATAR_ENTRIES,
  tournamentAvatarForNickname
} = require('./server/tournamentAvatars');

function fakeIo(events = []) {
  return { to(room) { return { emit(name, payload) { events.push({ room, name, payload }); } }; } };
}

class FakeRoom {
  constructor(id, maxPlayers) {
    this.id = id;
    this.maxPlayers = maxPlayers;
    this.G = {
      seats: Array(maxPlayers).fill(null),
      phase: 'WAITING',
      actingSeat: -1,
      dealerSeat: 0,
      handNum: 0
    };
    this.paused = false;
    this.gameOver = false;
    this.players = new Map();
    this.sockets = new Map();
  }

  isBetweenHands() { return this.G.phase === 'WAITING'; }
  setTournamentPaused(value) { this.paused = !!value; }
  maybeStartHand() {}
  broadcastState() {}
  dispose() {}

  importTournamentPlayer(seatIdx, player) {
    if (this.G.seats[seatIdx]) return false;
    if (player.playerId && this.players.has(player.playerId)) return false;
    this.G.seats[seatIdx] = {
      ...player,
      stack: Number(player.stack),
      cards: [],
      bet: 0,
      contributed: 0,
      inHand: false,
      connected: false
    };
    if (player.playerId) this.players.set(player.playerId, seatIdx);
    return true;
  }

  exportTournamentPlayer(playerId) {
    const seatIdx = this.G.seats.findIndex(player => player?.playerId === playerId);
    if (seatIdx < 0) return null;
    const player = this.G.seats[seatIdx];
    this.G.seats[seatIdx] = null;
    this.players.delete(playerId);
    return { player, seatIdx };
  }

  finishTournament(winner) {
    this.gameOver = true;
    this.winner = winner;
  }
}

function registrations(count, stack = 5000) {
  return Array.from({ length: count }, (_, index) => ({
    player_id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    status: 'ACTIVE',
    table_id: null,
    seat_idx: null,
    stack,
    move_count: 0
  }));
}

function botRegistrations(count, stack = 5000) {
  return registrations(count, stack).map((player, index) => ({
    ...player,
    player_id: `bot-${index + 1}`,
    name: `Bot ${index + 1}`,
    is_bot: 1
  }));
}

function createManager(maxSeats = 9, registrationClosed = false) {
  const rooms = new Map();
  const assignments = new Map();
  const winners = [];
  const events = [];
  const clock = {
    stoppedAt: null,
    start() {},
    stop(at) { this.stoppedAt = at; },
    getState() {
      return {
        level: 1, sb: 25, bb: 50, ante: 6, remainingMs: 180000,
        next: { level: 2, sb: 30, bb: 60, ante: 7 }
      };
    },
    subscribe() { return () => {}; },
    snapshot() { return { startedAt: 1, durationSec: 180, stoppedAt: this.stoppedAt }; }
  };
  const manager = new TournamentManager({
    id: 'tournament-test',
    config: { maxPlayers: maxSeats, maxEntrants: 1000, startStack: 5000 },
    io: fakeIo(events),
    clock,
    randomInt: () => 0,
    resolveAvatarUrl: tournamentAvatarForNickname,
    createTable: ({ tableId }) => {
      const room = new FakeRoom(tableId, maxSeats);
      rooms.set(tableId, room);
      return room;
    },
    closeTable: tableId => rooms.delete(tableId),
    assignPlayer: (_tournamentId, playerId, tableId, seatIdx, stack, moved) => {
      assignments.set(playerId, { tableId, seatIdx, stack, moved });
    },
    markWinner: (_tournamentId, playerId, stack) => winners.push({ playerId, stack }),
    isRegistrationClosed: () => registrationClosed
  });
  return { manager, rooms, assignments, winners, clock, events };
}

assert.equal(TOURNAMENT_AVATAR_ENTRIES.length, 45, 'all provided Ukrainian avatars are mapped');
assert.equal(
  new Set(TOURNAMENT_AVATAR_ENTRIES.map(([nickname]) => nickname.normalize('NFKC').trim().toLowerCase())).size,
  TOURNAMENT_AVATAR_ENTRIES.length,
  'tournament avatar nicknames are unique after normalization'
);
for (const [, avatarUrl] of TOURNAMENT_AVATAR_ENTRIES) {
  assert.equal(
    fs.existsSync(path.join(__dirname, 'public', avatarUrl.replace(/^\//, ''))),
    true,
    `${avatarUrl} exists`
  );
}
assert.equal(tournamentAvatarForNickname('  ANTIK  '), '/avatars/ua-antik.png');
assert.equal(tournamentAvatarForNickname('AARAN207'), '/avatars/ua-aaran207.png');
assert.equal(tournamentAvatarForNickname('Benjamin .／.'), '/avatars/ua-benjamin.png');
assert.equal(tournamentAvatarForNickname('iam.sisi'), '/avatars/ua-iam-sisi.png');
assert.equal(tournamentAvatarForNickname('Printsessa | Hapi'), '/avatars/ua-printsessa-hapi.png');
assert.equal(tournamentAvatarForNickname('sk_maruf99_86417'), '/avatars/ua-sk-maruf99-86417.png');
assert.equal(tournamentAvatarForNickname('YURA014054'), '/avatars/ua-yura014054.png');
assert.equal(tournamentAvatarForNickname('YUMMI89'), '/avatars/ua-yummi89.png');
assert.equal(tournamentAvatarForNickname('Unlisted player'), null);

{
  const { manager } = createManager(6);
  const listed = registrations(1)[0];
  listed.name = 'Antik';
  manager.start([listed]);
  const listedSeat = manager.activeTables()[0].room.G.seats.find(Boolean);
  assert.equal(listedSeat.avatarUrl, '/avatars/ua-antik.png');

  const unlisted = { ...registrations(1)[0], player_id: 'random-player', name: 'Random Player' };
  const seated = manager.seatRegistration(unlisted);
  const randomSeat = manager.getTable(seated.tableId).room.G.seats[seated.seatIdx];
  assert.equal(randomSeat.avatarUrl, undefined, 'unlisted players keep the existing random avatar');
}

function counts(manager) {
  return manager.activeTables()
    .map(table => table.room.G.seats.filter(Boolean).length)
    .sort((a, b) => b - a);
}

function chips(manager) {
  return manager.activeTables().reduce((total, table) => total + table.room.G.seats
    .filter(Boolean)
    .reduce((sum, player) => sum + Number(player.stack), 0), 0);
}

function forceDistribution(manager, desiredCounts, stack = 5000) {
  manager.tables.clear();
  manager.players.clear();
  let playerNo = 1;
  desiredCounts.forEach((count, tableIndex) => {
    const table = manager.ensureTable(tableIndex + 1);
    for (let seatIdx = 0; seatIdx < count; seatIdx++) {
      const player = {
        playerId: `forced-${playerNo}`,
        name: `Forced ${playerNo}`,
        stack,
        status: 'ACTIVE',
        moveCount: 0
      };
      table.room.importTournamentPlayer(seatIdx, player);
      manager.players.set(player.playerId, {
        ...player,
        tableId: table.id,
        seatIdx
      });
      playerNo++;
    }
  });
  manager.status = 'RUNNING';
}

function executeBalance(manager) {
  manager.pendingPlan = manager._buildBalancePlan('test');
  assert.ok(manager.pendingPlan, 'balance plan must exist');
  manager._pausePlanTables(manager.pendingPlan);
  assert.equal(manager._tryExecutePlan(), true);
}

for (const [players, maxSeats, expected] of [
  [9, 9, [9]],
  [10, 9, [5, 5]],
  [13, 9, [7, 6]],
  [18, 9, [9, 9]],
  [19, 9, [7, 6, 6]],
  [27, 9, [9, 9, 9]],
  [30, 9, [8, 8, 7, 7]]
]) {
  assert.deepEqual(getTargetDistribution(players, maxSeats), expected);
}

{
  const { manager } = createManager(9);
  manager.start(registrations(30), Date.now());
  assert.deepEqual(counts(manager), [8, 8, 7, 7]);
  assert.equal(chips(manager), 30 * 5000);
  assert.equal('playerId' in manager.publicState().players[0], false, 'private reconnect ids stay server-side');
}

{
  const { manager } = createManager(9);
  manager.start([...registrations(1), ...botRegistrations(50)], Date.now());
  assert.deepEqual(counts(manager), [9, 9, 9, 8, 8, 8], '50 test bots are balanced across MTT tables');
  assert.equal(manager.activePlayers().filter(player => player.isBot).length, 50);
  const botSeats = manager.activeTables().flatMap(table => table.room.G.seats.filter(seat => seat?.isBot));
  assert.equal(botSeats.length, 50, 'bot registrations become playable bot seats');
  assert.equal(manager.publicState().players.filter(player => player.isBot).length, 50);
}

{
  const { manager } = createManager(9);
  const pending = registrations(2).map(player => ({ ...player, stack: null }));
  manager.start(pending, Date.now());
  assert.deepEqual(manager.activePlayers().map(player => player.stack), [5000, 5000]);
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [9, 1]);
  const restored = [...manager.players.values()].map(player => ({
    player_id: player.playerId,
    name: player.name,
    status: player.status,
    table_id: player.tableId,
    seat_idx: player.seatIdx,
    stack: player.stack,
    move_count: player.moveCount
  }));
  manager.start(restored, Date.now());
  assert.deepEqual(counts(manager), [5, 5], 'start balances restored/pre-seated tables before play');
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [9]);
  const source = manager.getTable(manager.tableIdFor(1));
  source.room.G.phase = 'FLOP';
  const late = {
    ...registrations(1)[0],
    player_id: 'late-player',
    name: 'Late Player'
  };
  manager.register(late);
  assert.ok(manager.pendingPlan, 'late registration waits for the source hand');
  const seated = manager.seatRegistration(late);
  assert.equal(seated.tableId, manager.tableIdFor(2), 'late player can claim the pending destination seat');
  source.room.G.phase = 'WAITING';
  assert.equal(manager.onTableBetweenHands(source.id), true, 'stale pending move completes idempotently');
  assert.deepEqual(counts(manager), [5, 5], 'late registration balances 9+1 into 5+5');
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [5, 4]);
  const staleFinalPlan = manager._buildBalancePlan('pre-late-final-assembly');
  manager.pendingPlan = staleFinalPlan;
  manager._pausePlanTables(staleFinalPlan);
  assert.equal(staleFinalPlan.closing.length, 1, 'nine-player plan would consolidate to one table');

  const late = {
    ...registrations(1)[0],
    player_id: 'late-during-final-assembly',
    name: 'Late During Final Assembly'
  };
  manager.register(late);

  assert.equal(manager.activePlayers().length, 10, 'late entrant is included in the live field immediately');
  assert.equal(manager.activeTables().length, 2, 'stale final-table plan does not close the second table');
  assert.deepEqual(counts(manager), [5, 5], 'replacement plan seats all ten players across two tables');
  assert.equal(manager.finalTable, false, 'final table is not announced for a ten-player field');
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [9, 4]);
  const before = chips(manager);
  executeBalance(manager);
  assert.deepEqual(counts(manager), [7, 6]);
  assert.equal(chips(manager), before);
}

for (const [beforeCounts, expectedCounts] of [
  [[8, 5], [7, 6]],
  [[9, 3], [6, 6]],
  [[4, 9], [7, 6]]
]) {
  const { manager } = createManager(9);
  forceDistribution(manager, beforeCounts);
  const before = chips(manager);
  executeBalance(manager);
  assert.deepEqual(counts(manager), expectedCounts);
  assert.equal(chips(manager), before);
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [9, 4]);
  const plan = manager._buildBalancePlan('active-hand');
  manager._pausePlanTables(plan);
  const sourceId = plan.moves.find(move => move.fromTableId)?.fromTableId;
  manager.getTable(sourceId).room.G.phase = 'FLOP';
  manager.pendingPlan = plan;
  assert.equal(manager._tryExecutePlan(), false, 'active hand blocks movement');
  manager.getTable(sourceId).room.G.phase = 'WAITING';
  assert.equal(manager._tryExecutePlan(), true, 'movement resumes between hands');
  assert.deepEqual(counts(manager), [7, 6]);
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [8, 5]);
  const plan = manager._buildBalancePlan('target-keeps-playing');
  const move = plan.moves.find(item => item.fromTableId);
  const source = manager.getTable(move.fromTableId);
  const target = manager.getTable(move.toTableId);
  target.room.G.phase = 'FLOP';
  manager.pendingPlan = plan;
  manager._pausePlanTables(plan);
  assert.equal(source.room.paused, true, 'source pauses before its next hand');
  assert.equal(target.room.paused, false, 'running destination table is not paused');
  assert.equal(manager._tryExecutePlan(), true, 'move does not wait for destination hand');
  const moved = target.room.G.seats.find(seat => seat?.playerId === move.playerId);
  assert.equal(moved?.inHand, false, 'moved player waits for the destination next hand');
  assert.deepEqual(counts(manager), [7, 6]);
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [9, 4]);
  executeBalance(manager);
  assert.notEqual(manager.getPlayer('forced-3').tableId, manager.tableIdFor(1), 'next BB is moved first');
}

{
  const { manager } = createManager(9);
  const table = manager.ensureTable(1);
  table.room.G.dealerSeat = 0;
  table.room.importTournamentPlayer(4, { playerId: 'position-anchor', name: 'Anchor', stack: 5000 });
  const seat = manager._chooseTargetSeat(table.room);
  assert.ok(![1, 2, 3].includes(seat), 'target seat does not turn the moved player into the next SB');
}

{
  const { manager } = createManager(9);
  forceDistribution(manager, [9, 4, 4]);
  const before = chips(manager);
  executeBalance(manager);
  assert.deepEqual(counts(manager), [9, 8]);
  assert.equal(manager.activeTables().length, 2);
  assert.equal(chips(manager), before);
}

{
  const { manager, events } = createManager(9, true);
  forceDistribution(manager, [5, 4]);
  const plan = manager._buildBalancePlan('final-table');
  manager.pendingPlan = plan;
  manager._pausePlanTables(plan);
  assert.ok(events.some(event => event.name === 'table_paused_for_balancing'
    && event.payload.finalAssembly === true), 'final assembly is identified to clients');
  const target = manager.getTable(plan.moves[0].toTableId);
  target.room.G.phase = 'FLOP';
  assert.equal(manager._tryExecutePlan(), false, 'final table waits for every affected hand');
  target.room.G.phase = 'WAITING';
  assert.equal(manager._tryExecutePlan(), true);
  assert.deepEqual(counts(manager), [9]);
  assert.equal(manager.finalTable, true);
  assert.ok(events.some(event => event.name === 'table_resumed'
    && event.payload.finalAssembly === true), 'final table resume keeps final-assembly context');
}

{
  const { manager, winners, clock } = createManager(6, true);
  manager.start(registrations(2), Date.now());
  manager.resolveElimination({ playerId: 'player-2' });
  const state = manager.publicState();
  assert.equal(manager.status, 'FINISHED');
  assert.equal(manager.getPlayer('player-1').status, 'WINNER');
  assert.equal(manager.getPlayer('player-1').eliminatedPlace, 1);
  assert.equal(manager.getPlayer('player-1').tableId, null);
  assert.equal(clock.stoppedAt, manager.finishedAt, 'blind clock stops with the tournament');
  assert.deepEqual(winners.map(item => item.playerId), ['player-1']);
  assert.equal(state.activeTables, 0);
  assert.equal(state.winnerName, 'Player 1');
  assert.ok(state.tables.every(table => table.status === 'FINISHED'));
}

{
  const { manager, winners } = createManager(6, false);
  manager.start(registrations(2), Date.now());
  manager.resolveElimination({ playerId: 'player-2' });
  assert.equal(manager.status, 'FINISHED', 'last registered player wins without waiting for late registration');
  assert.deepEqual(winners.map(item => item.playerId), ['player-1']);
}

{
  const clock = new TournamentClock({ durationSec: 180 });
  clock.start(1_000);
  const stopped = clock.stop(91_000);
  const muchLater = clock.getState(999_999_999);
  assert.equal(muchLater.level, stopped.level);
  assert.equal(muchLater.remainingMs, stopped.remainingMs, 'finished blind clock remains frozen');
  assert.equal(clock.snapshot().stoppedAt, 91_000);
  clock.dispose();
}

console.log('PASS  MTT seating, fast balancing, terminal state and chip conservation');
