'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const Database = require('better-sqlite3');

const mode = process.argv[2];

function snapshot(version) {
  return {
    version: 2,
    sequence: version,
    game: {
      phase: 'FLOP', handNum: 7, pot: 200, actingSeat: 0,
      seats: [
        { playerId: 'db-player-a', name: 'Alice', stack: 4800, bet: 0, contributed: 200, inHand: true },
        { playerId: 'db-player-b', name: 'Bob', stack: 5000, bet: 0, contributed: 0, inHand: true }
      ]
    }
  };
}

if (mode === 'writer') {
  process.env.POKER_DB_PATH = process.argv[3];
  const db = require('./server/db');
  const roomId = 'database-reliability-room';
  db.saveRoom(roomId, '', { startStack: 5000 }, null, null);
  db.registerTournamentPlayer(roomId, 'db-player-a', 'Alice', 6, 5000);
  db.registerTournamentPlayer(roomId, 'db-player-b', 'Bob', 6, 5000);
  db.markTournamentSeated(roomId, 'db-player-a', roomId, 0, 4800, false);
  db.markTournamentSeated(roomId, 'db-player-b', roomId, 1, 5000, false);
  let version = 0;
  const write = () => {
    version++;
    db.saveRoomState(roomId, snapshot(version));
    process.send?.({ type: 'committed', version });
    setTimeout(write, 2);
  };
  write();
} else {
  (async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-db-reliability-'));
    const databasePath = path.join(directory, 'poker.db');
    let lastAcknowledged = 0;
    const child = fork(__filename, ['writer', databasePath], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('writer did not commit in time')), 10000);
      child.on('message', message => {
        if (message?.type !== 'committed') return;
        lastAcknowledged = message.version;
        if (lastAcknowledged >= 50) {
          clearTimeout(timeout);
          child.kill('SIGKILL');
        }
      });
      child.once('exit', resolve);
      child.once('error', reject);
    });

    const raw = new Database(databasePath, { readonly: true, fileMustExist: true });
    assert.equal(raw.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(raw.pragma('journal_mode', { simple: true }), 'wal');
    const state = JSON.parse(raw.prepare('SELECT state FROM room_states WHERE room_id = ?')
      .get('database-reliability-room').state);
    assert.ok(state.sequence >= lastAcknowledged, 'last acknowledged snapshot survives SIGKILL');
    const chipTotal = state.game.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.game.pot;
    assert.equal(chipTotal, 10000, 'restored snapshot conserves all chips');
    const registrations = raw.prepare(`
      SELECT player_id, stack, table_id, seat_idx
      FROM tournament_registrations WHERE room_id = ? ORDER BY player_id
    `).all('database-reliability-room');
    assert.deepEqual(registrations.map(row => row.stack), [4800, 5000]);
    assert.ok(registrations.every(row => row.table_id === 'database-reliability-room'));
    raw.close();

    process.env.POKER_DB_PATH = databasePath;
    const db = require('./server/db');
    const durations = [];
    for (let version = state.sequence + 1; version <= state.sequence + 500; version++) {
      const startedAt = process.hrtime.bigint();
      db.saveRoomState('database-reliability-room', snapshot(version));
      durations.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    }
    durations.sort((a, b) => a - b);
    const storage = db.getStorageInfo();
    const metrics = db.getWriteMetrics();
    assert.equal(storage.journalMode, 'wal');
    assert.equal(storage.synchronous, 1);
    assert.equal(storage.busyTimeout, 5000);

    const { PokerRoom } = require('./server/gameEngine');
    let persisted = 0;
    const room = new PokerRoom('sync-persist', { startStack: 5000, sb: 25, bb: 50 }, {
      sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
      to: () => ({ emit: () => {} })
    }, { onPersist: () => { persisted++; } });
    room.broadcastState();
    assert.equal(persisted, 1, 'broadcast persists synchronously before returning');
    assert.equal(room._persistTimer, null, 'no deferred snapshot timer remains');
    room.dispose();

    const commandRoom = new PokerRoom('database-reliability-room', {
      startStack: 5000, sb: 25, bb: 50, turnTimeSec: 30
    }, {
      sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
      to: () => ({ emit: () => {} })
    }, { onPersist: stateValue => db.saveRoomState('database-reliability-room', stateValue) });
    commandRoom.addPlayer(0, { playerId: 'command-a', name: 'Alice' });
    commandRoom.addPlayer(1, { playerId: 'command-b', name: 'Bob' });
    const commandDurations = [];
    for (let index = 0; index < 500; index++) {
      commandRoom.clearTurnTimer();
      commandRoom.G.phase = 'PREFLOP';
      commandRoom.G.actingSeat = index % 2;
      commandRoom.G.currentBet = 0;
      commandRoom.G.pot = 0;
      commandRoom.G.seats.forEach(seat => {
        if (seat) Object.assign(seat, {
          stack: 5000, bet: 0, contributed: 0, inHand: true, acted: false, canRaise: true
        });
      });
      const startedAt = process.hrtime.bigint();
      assert.equal(commandRoom.doAction(index % 2, 'check', 0), true);
      commandDurations.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    }
    commandRoom.dispose();
    db.checkpoint('TRUNCATE');
    db.close();

    const percentile = value => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))];
    commandDurations.sort((a, b) => a - b);
    const commandPercentile = value => commandDurations[
      Math.min(commandDurations.length - 1, Math.floor(commandDurations.length * value))
    ];
    console.log(JSON.stringify({
      ok: true,
      killedAfterAcknowledgedVersion: lastAcknowledged,
      restoredVersion: state.sequence,
      chipTotal,
      writes: durations.length,
      p50Ms: percentile(0.50),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: durations[durations.length - 1],
      commandP50Ms: commandPercentile(0.50),
      commandP95Ms: commandPercentile(0.95),
      commandP99Ms: commandPercentile(0.99),
      commandMaxMs: commandDurations[commandDurations.length - 1],
      measuredWrites: metrics.roomState
    }));
    fs.rmSync(directory, { recursive: true, force: true });
  })().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
