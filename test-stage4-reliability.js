'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-stage4-'));
process.env.POKER_DB_PATH = path.join(tempDir, 'stage4.sqlite');

const db = require('./server/db');
const { PokerRoom } = require('./server/gameEngine');
const { TournamentManager } = require('./server/tournamentManager');

function fakeIo() {
  return {
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to() { return { emit() {} }; }
  };
}

function actionPlayer(name) {
  return {
    name,
    stack: 100,
    bet: 0,
    contributed: 0,
    cards: [],
    inHand: true,
    acted: false,
    canRaise: true,
    lastAction: '',
    connected: true,
    isBot: false
  };
}

function testActionCommands() {
  const room = new PokerRoom('command-test', { startStack: 100, sb: 1, bb: 2 }, fakeIo());
  room.G.phase = 'FLOP';
  room.G.actingSeat = 0;
  room.G.turnId = 41;
  room.G.seats[0] = actionPlayer('A');
  room.G.seats[1] = actionPlayer('B');

  assert.equal(room.sanitizedState(0).turnId, 41, 'turnId is synchronized to clients');
  assert.equal(room.doAction(0, 'check', 0, { commandId: 'command-0001', turnId: 41 }), true);
  assert.equal(room.G.turnId, 42, 'turnId advances with the actor');
  assert.equal(room.actionCommandStatus('command-0001', 42).reason, 'DUPLICATE');

  const beforeReplay = JSON.stringify(room.getSnapshot().game);
  assert.equal(room.doAction(1, 'call', 0, { commandId: 'command-0001', turnId: 42 }), false);
  assert.equal(JSON.stringify(room.getSnapshot().game), beforeReplay, 'duplicate command changes no game state');
  assert.equal(room.actionCommandStatus('command-0002', 41).reason, 'STALE_TURN');
  assert.equal(room.doAction(1, 'call', 0, { commandId: 'command-0002', turnId: 41 }), false);
  assert.equal(room.doAction(1, 'check', 0, { commandId: 'command-0003', turnId: 42 }), true);
  room.dispose();
}

class FakeRoom {
  constructor(id, maxPlayers = 6) {
    this.id = id;
    this.maxPlayers = maxPlayers;
    this.G = {
      seats: Array(maxPlayers).fill(null),
      phase: 'WAITING',
      actingSeat: -1,
      dealerSeat: 0,
      handNum: 0
    };
    this.players = new Map();
  }

  isBetweenHands() { return true; }
  setTournamentPaused() {}
  maybeStartHand() {}
  broadcastState() {}
  dispose() {}

  importTournamentPlayer(seatIdx, player) {
    if (this.G.seats[seatIdx]) return false;
    this.G.seats[seatIdx] = {
      ...player,
      stack: Number(player.stack),
      cards: [],
      bet: 0,
      contributed: 0,
      inHand: false,
      connected: false
    };
    this.players.set(player.playerId, seatIdx);
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
}

function clock() {
  return {
    subscribe() { return () => {}; },
    getState() { return { level: 1, sb: 25, bb: 50, ante: 6, remainingMs: 180000, next: null }; },
    snapshot() { return { startedAt: 1, durationSec: 180 }; },
    start() {}
  };
}

function setupRecovery(label, placement, prepare = true) {
  const tournamentId = `stage4-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sourceId = `${tournamentId}--source`;
  const targetId = `${tournamentId}--target`;
  const playerId = `player-${label}`;
  db.saveRoom(tournamentId, 'Stage 4', { maxPlayers: 6, startStack: 1000 }, null, null);
  db.registerTournamentPlayer(tournamentId, playerId, `Player ${label}`, 6, 1000);
  db.markTournamentSeated(tournamentId, playerId, sourceId, 0, 1000, false);
  if (prepare) {
    db.prepareTournamentMove({
      tournamentId,
      moveId: `move-${label}`,
      playerId,
      fromTableId: sourceId,
      fromSeatIdx: 0,
      toTableId: targetId,
      toSeatIdx: 2,
      stack: 1000,
      countsAsMove: true
    });
  }

  const source = new FakeRoom(sourceId);
  const target = new FakeRoom(targetId);
  const seat = { playerId, name: `Player ${label}`, stack: 1000 };
  if (placement === 'source' || placement === 'duplicate') source.importTournamentPlayer(0, seat);
  if (placement === 'target' || placement === 'duplicate') target.importTournamentPlayer(2, seat);

  const manager = new TournamentManager({
    id: tournamentId,
    config: { maxPlayers: 6, maxEntrants: 100, startStack: 1000 },
    io: fakeIo(),
    clock: clock(),
    createTable() { throw new Error('unexpected table creation'); },
    closeTable() {},
    assignPlayer: (id, idPlayer, tableId, seatIdx, stack, moved) =>
      db.markTournamentSeated(id, idPlayer, tableId, seatIdx, stack, moved),
    prepareMove: move => db.prepareTournamentMove(move),
    commitMove: (...args) => db.commitTournamentMove(...args),
    resolveMove: (...args) => db.resolveTournamentMove(...args),
    setPlayerPending: (...args) => db.setTournamentPlayerPending(...args)
  });
  manager.addRestoredTable({ tableId: sourceId, tableNumber: 1, room: source });
  manager.addRestoredTable({ tableId: targetId, tableNumber: 2, room: target });
  manager.syncRegistrations(db.listTournamentRegistrations(tournamentId));
  return { manager, tournamentId, playerId, sourceId, targetId, source, target };
}

function occurrences(source, target, playerId) {
  return [source, target].flatMap(room => room.G.seats.filter(seat => seat?.playerId === playerId));
}

function testMoveRecovery() {
  {
    const ctx = setupRecovery('normal-commit', 'source', false);
    ctx.manager._executeMove('normal-plan', {
      playerId: ctx.playerId,
      fromTableId: ctx.sourceId,
      toTableId: ctx.targetId
    });
    const registration = db.getTournamentRegistration(ctx.tournamentId, ctx.playerId);
    assert.equal(registration.table_id, ctx.targetId);
    assert.equal(registration.move_count, 1);
    assert.equal(registration.stack, 1000);
    assert.equal(db.listPendingTournamentMoves(ctx.tournamentId).length, 0);
    assert.equal(occurrences(ctx.source, ctx.target, ctx.playerId).length, 1);
    ctx.manager.dispose();
  }

  {
    const ctx = setupRecovery('before-export', 'source');
    const result = ctx.manager.recoverPendingMoves(db.listPendingTournamentMoves(ctx.tournamentId));
    const registration = db.getTournamentRegistration(ctx.tournamentId, ctx.playerId);
    assert.equal(result.rolledBack, 1);
    assert.equal(registration.table_id, ctx.sourceId);
    assert.equal(registration.move_count, 0);
    assert.equal(occurrences(ctx.source, ctx.target, ctx.playerId).length, 1);
    ctx.manager.dispose();
  }

  {
    const ctx = setupRecovery('after-export', 'missing');
    const result = ctx.manager.recoverPendingMoves(db.listPendingTournamentMoves(ctx.tournamentId));
    const registration = db.getTournamentRegistration(ctx.tournamentId, ctx.playerId);
    assert.equal(result.pending, 1);
    assert.equal(registration.table_id, null);
    assert.equal(registration.seat_idx, null);
    assert.equal(registration.stack, 1000, 'stack survives an interrupted export');
    assert.equal(registration.move_count, 0);
    ctx.manager.dispose();
  }

  {
    const ctx = setupRecovery('after-import', 'target');
    const pending = db.listPendingTournamentMoves(ctx.tournamentId);
    const first = ctx.manager.recoverPendingMoves(pending);
    const second = ctx.manager.recoverPendingMoves(pending);
    const registration = db.getTournamentRegistration(ctx.tournamentId, ctx.playerId);
    assert.equal(first.committed, 1);
    assert.equal(second.committed, 1, 'replaying recovery is accepted');
    assert.equal(registration.table_id, ctx.targetId);
    assert.equal(registration.seat_idx, 2);
    assert.equal(registration.stack, 1000);
    assert.equal(registration.move_count, 1, 'idempotent commit increments move count once');
    assert.equal(occurrences(ctx.source, ctx.target, ctx.playerId).length, 1);
    ctx.manager.dispose();
  }

  {
    const ctx = setupRecovery('duplicate', 'duplicate');
    const result = ctx.manager.recoverPendingMoves(db.listPendingTournamentMoves(ctx.tournamentId));
    const registration = db.getTournamentRegistration(ctx.tournamentId, ctx.playerId);
    assert.equal(result.duplicatesRemoved, 1);
    assert.equal(registration.table_id, ctx.targetId);
    assert.equal(registration.move_count, 1);
    assert.equal(occurrences(ctx.source, ctx.target, ctx.playerId).length, 1, 'restart removes duplicate seat');
    assert.equal(occurrences(ctx.source, ctx.target, ctx.playerId)[0].stack, 1000);
    ctx.manager.dispose();
  }
}

try {
  testActionCommands();
  testMoveRecovery();
  const metrics = db.getWriteMetrics();
  const prepareMs = metrics.tournamentMovePrepare?.averageMs || 0;
  const commitMs = metrics.tournamentMoveCommit?.averageMs || 0;
  console.log(`PASS  stage 4 command and MTT recovery reliability (prepare ${prepareMs.toFixed(3)} ms, commit ${commitMs.toFixed(3)} ms)`);
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
