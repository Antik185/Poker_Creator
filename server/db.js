const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const dbPath = process.env.POKER_DB_PATH
  ? path.resolve(process.env.POKER_DB_PATH)
  : path.join(__dirname, '../poker.db');
const db = new Database(dbPath);
const synchronousMode = String(process.env.SQLITE_SYNCHRONOUS || 'NORMAL').toUpperCase() === 'FULL'
  ? 'FULL' : 'NORMAL';

db.pragma('journal_mode = WAL');
db.pragma(`synchronous = ${synchronousMode}`);
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('wal_autocheckpoint = 1000');

const writeMetrics = new Map();

function measuredWrite(name, write) {
  const startedAt = process.hrtime.bigint();
  try {
    return write();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const metric = writeMetrics.get(name) || { count: 0, totalMs: 0, maxMs: 0, over10ms: 0 };
    metric.count++;
    metric.totalMs += elapsedMs;
    metric.maxMs = Math.max(metric.maxMs, elapsedMs);
    if (elapsedMs >= 10) metric.over10ms++;
    writeMetrics.set(name, metric);
  }
}

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    brand TEXT NOT NULL,
    config TEXT NOT NULL,
    felt_url TEXT,
    logo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS room_states (
    room_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tournament_registrations (
    room_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    table_id TEXT,
    seat_idx INTEGER,
    stack REAL,
    move_count INTEGER NOT NULL DEFAULT 0,
    eliminated_place INTEGER,
    is_bot INTEGER NOT NULL DEFAULT 0,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, player_id),
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tournament_registrations_room
    ON tournament_registrations(room_id, registered_at);

  CREATE TABLE IF NOT EXISTS tournament_states (
    tournament_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tournament_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tournament_table_states (
    tournament_id TEXT NOT NULL,
    table_id TEXT NOT NULL,
    table_no INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    state TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tournament_id, table_id),
    FOREIGN KEY(tournament_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tournament_table_states_tournament
    ON tournament_table_states(tournament_id, table_no);

  CREATE TABLE IF NOT EXISTS tournament_moves (
    tournament_id TEXT NOT NULL,
    move_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    from_table_id TEXT,
    from_seat_idx INTEGER,
    to_table_id TEXT NOT NULL,
    to_seat_idx INTEGER NOT NULL,
    stack REAL NOT NULL,
    counts_as_move INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PREPARED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tournament_id, move_id),
    FOREIGN KEY(tournament_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tournament_moves_pending
    ON tournament_moves(tournament_id, status, created_at);
`);

// Add code column if missing (migration for existing DBs)
try { db.exec('ALTER TABLE rooms ADD COLUMN code TEXT UNIQUE'); } catch(e) {}
try { db.exec("ALTER TABLE tournament_registrations ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'"); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN table_id TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN seat_idx INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN stack REAL'); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN move_count INTEGER NOT NULL DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN eliminated_place INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0'); } catch(e) {}

const TOURNAMENT_BOT_NAMES = [
  'Coffee_Time', 'RiverPilot', 'PocketAce', 'NightGrinder', 'BluffMachine',
  'ChipStorm', 'RoyalFlush', 'TurnHunter', 'SilentRaise', 'TableCaptain',
  'LuckyRiver', 'DeepStack', 'CardShark', 'RedButton', 'FinalBoss',
  'AceOrbit', 'GoldenChip', 'QuickCall', 'WildDealer', 'StackBuilder'
];

function ensureTournamentBots(roomId, requestedCount, startStack) {
  const count = Math.max(0, Math.floor(Number(requestedCount) || 0));
  const stack = Number.isFinite(Number(startStack)) ? Number(startStack) : null;
  const ensure = db.transaction(() => {
    const existing = db.prepare(`
      SELECT player_id, name, status, table_id, seat_idx, stack, move_count,
             eliminated_place, is_bot, registered_at
      FROM tournament_registrations
      WHERE room_id = ? AND is_bot = 1
      ORDER BY registered_at ASC, rowid ASC
    `).all(roomId);
    const insert = db.prepare(`
      INSERT INTO tournament_registrations (room_id, player_id, name, stack, is_bot)
      VALUES (?, ?, ?, ?, 1)
    `);
    for (let index = existing.length; index < count; index++) {
      const baseName = TOURNAMENT_BOT_NAMES[index % TOURNAMENT_BOT_NAMES.length];
      const cycle = Math.floor(index / TOURNAMENT_BOT_NAMES.length);
      const name = cycle > 0 ? `${baseName}_${cycle + 1}` : baseName;
      const playerId = `tbot_${crypto.randomUUID().replace(/-/g, '')}`;
      insert.run(roomId, playerId, name, stack);
    }
    return db.prepare(`
      SELECT player_id, name, status, table_id, seat_idx, stack, move_count,
             eliminated_place, is_bot, registered_at
      FROM tournament_registrations
      WHERE room_id = ? AND is_bot = 1
      ORDER BY registered_at ASC, rowid ASC
    `).all(roomId);
  });
  return ensure();
}

// Generate unique 4-char code (A-Z, 2-9, no ambiguous chars)
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  } while (db.prepare('SELECT 1 FROM rooms WHERE code=?').get(code));
  return code;
}

const saveRoomStateStatement = db.prepare(`
  INSERT INTO room_states (room_id, state, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(room_id) DO UPDATE SET
    state = excluded.state,
    updated_at = CURRENT_TIMESTAMP
`);
const saveTournamentStateStatement = db.prepare(`
  INSERT INTO tournament_states (tournament_id, state, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(tournament_id) DO UPDATE SET
    state = excluded.state,
    updated_at = CURRENT_TIMESTAMP
`);
const saveTournamentTableStateStatement = db.prepare(`
  INSERT INTO tournament_table_states (tournament_id, table_id, table_no, status, state, updated_at)
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(tournament_id, table_id) DO UPDATE SET
    table_no = excluded.table_no,
    status = excluded.status,
    state = excluded.state,
    updated_at = CURRENT_TIMESTAMP
`);

const prepareTournamentMoveTransaction = db.transaction(move => {
  db.prepare(`
    INSERT OR IGNORE INTO tournament_moves (
      tournament_id, move_id, player_id, from_table_id, from_seat_idx,
      to_table_id, to_seat_idx, stack, counts_as_move, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARED')
  `).run(
    move.tournamentId, move.moveId, move.playerId, move.fromTableId || null,
    Number.isInteger(move.fromSeatIdx) ? move.fromSeatIdx : null,
    move.toTableId, move.toSeatIdx, Number(move.stack), move.countsAsMove ? 1 : 0
  );
  const row = db.prepare(`
    SELECT * FROM tournament_moves WHERE tournament_id = ? AND move_id = ?
  `).get(move.tournamentId, move.moveId);
  if (!row
      || row.player_id !== move.playerId
      || row.from_table_id !== (move.fromTableId || null)
      || row.from_seat_idx !== (Number.isInteger(move.fromSeatIdx) ? move.fromSeatIdx : null)
      || row.to_table_id !== move.toTableId
      || row.to_seat_idx !== move.toSeatIdx
      || Number(row.stack) !== Number(move.stack)
      || Number(row.counts_as_move) !== (move.countsAsMove ? 1 : 0)) {
    throw new Error('TOURNAMENT_MOVE_ID_CONFLICT');
  }
  return row;
});

const commitTournamentMoveTransaction = db.transaction((tournamentId, moveId, tableId, seatIdx, stack) => {
  const row = db.prepare(`
    SELECT * FROM tournament_moves WHERE tournament_id = ? AND move_id = ?
  `).get(tournamentId, moveId);
  if (!row) throw new Error('TOURNAMENT_MOVE_NOT_PREPARED');
  if (row.status === 'COMMITTED') return { committed: true, alreadyCommitted: true };
  if (row.status !== 'PREPARED') throw new Error(`TOURNAMENT_MOVE_${row.status}`);
  const result = db.prepare(`
    UPDATE tournament_registrations
    SET table_id = ?, seat_idx = ?, stack = ?, move_count = move_count + ?
    WHERE room_id = ? AND player_id = ? AND status = 'ACTIVE'
  `).run(tableId, seatIdx, Number(stack), row.counts_as_move ? 1 : 0, tournamentId, row.player_id);
  if (result.changes !== 1) throw new Error('TOURNAMENT_MOVE_PLAYER_NOT_ACTIVE');
  db.prepare(`
    UPDATE tournament_moves SET status = 'COMMITTED', updated_at = CURRENT_TIMESTAMP
    WHERE tournament_id = ? AND move_id = ?
  `).run(tournamentId, moveId);
  return { committed: true, alreadyCommitted: false };
});

module.exports = {
  saveRoom: (id, brand, config, felt_url, logo_url) => {
    const code = generateCode();
    const stmt = db.prepare('INSERT OR REPLACE INTO rooms (id, code, brand, config, felt_url, logo_url) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(id, code, brand, JSON.stringify(config), felt_url, logo_url);
    return code;
  },
  getRoom: (id) => {
    const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?');
    const row = stmt.get(id);
    if (!row) return null;
    return { ...row, config: JSON.parse(row.config) };
  },
  getRoomByCode: (code) => {
    const stmt = db.prepare('SELECT * FROM rooms WHERE code = ?');
    const row = stmt.get(code.toUpperCase());
    if (!row) return null;
    return { ...row, config: JSON.parse(row.config) };
  },
  listRooms: () => db.prepare('SELECT * FROM rooms ORDER BY created_at ASC').all()
    .map(row => {
      try { return { ...row, config: JSON.parse(row.config) }; }
      catch { return null; }
    })
    .filter(Boolean),
  updateRoomConfig: (roomId, config) => db.prepare(`
    UPDATE rooms SET config = ? WHERE id = ?
  `).run(JSON.stringify(config), roomId),
  listTournamentRegistrations: (roomId) => db.prepare(`
    SELECT player_id, name, status, table_id, seat_idx, stack, move_count, eliminated_place, is_bot, registered_at
    FROM tournament_registrations
    WHERE room_id = ?
    ORDER BY registered_at ASC, rowid ASC
  `).all(roomId),
  getTournamentRegistration: (roomId, playerId) => db.prepare(`
    SELECT player_id, name, status, table_id, seat_idx, stack, move_count, eliminated_place, is_bot, registered_at
    FROM tournament_registrations
    WHERE room_id = ? AND player_id = ?
  `).get(roomId, playerId),
  registerTournamentPlayer: (roomId, playerId, name, maxPlayers, startStack = null) => {
    const register = db.transaction(() => {
      const existing = db.prepare(`
        SELECT player_id, name, status, table_id, seat_idx, stack, move_count, eliminated_place, is_bot, registered_at
        FROM tournament_registrations
        WHERE room_id = ? AND player_id = ?
      `).get(roomId, playerId);
      if (existing) {
        if (existing.is_bot) {
          const error = new Error('BOT_ID_RESERVED');
          error.code = 'BOT_ID_RESERVED';
          throw error;
        }
        if (existing.status === 'ELIMINATED') {
          const error = new Error('ALREADY_ELIMINATED');
          error.code = 'ALREADY_ELIMINATED';
          throw error;
        }
        if (existing.status === 'WINNER') {
          const error = new Error('TOURNAMENT_FINISHED');
          error.code = 'TOURNAMENT_FINISHED';
          throw error;
        }
        db.prepare('UPDATE tournament_registrations SET name = ? WHERE room_id = ? AND player_id = ?')
          .run(name, roomId, playerId);
        return { ...existing, name, alreadyRegistered: true };
      }
      const count = db.prepare("SELECT COUNT(*) AS count FROM tournament_registrations WHERE room_id = ? AND status = 'ACTIVE'")
        .get(roomId).count;
      if (count >= maxPlayers) {
        const error = new Error('TOURNAMENT_FULL');
        error.code = 'TOURNAMENT_FULL';
        throw error;
      }
      db.prepare(`
        INSERT INTO tournament_registrations (room_id, player_id, name, stack)
        VALUES (?, ?, ?, ?)
      `).run(roomId, playerId, name, Number.isFinite(Number(startStack)) ? Number(startStack) : null);
      return db.prepare(`
        SELECT player_id, name, status, table_id, seat_idx, stack, move_count, eliminated_place, is_bot, registered_at
        FROM tournament_registrations
        WHERE room_id = ? AND player_id = ?
      `).get(roomId, playerId);
    });
    return register();
  },
  ensureTournamentBots,
  markTournamentSeated: (roomId, playerId, tableId, seatIdx, stack, moved = false) => db.prepare(`
    UPDATE tournament_registrations
    SET table_id = ?, seat_idx = ?, stack = ?,
        move_count = move_count + ?
    WHERE room_id = ? AND player_id = ? AND status = 'ACTIVE'
  `).run(tableId, seatIdx, stack, moved ? 1 : 0, roomId, playerId),
  prepareTournamentMove: move => measuredWrite('tournamentMovePrepare', () =>
    prepareTournamentMoveTransaction(move)),
  commitTournamentMove: (tournamentId, moveId, tableId, seatIdx, stack) =>
    measuredWrite('tournamentMoveCommit', () =>
      commitTournamentMoveTransaction(tournamentId, moveId, tableId, seatIdx, stack)),
  resolveTournamentMove: (tournamentId, moveId, status) => {
    const safeStatus = ['ROLLED_BACK', 'RECOVERED_PENDING'].includes(status) ? status : 'ROLLED_BACK';
    return measuredWrite('tournamentMoveResolve', () => db.prepare(`
      UPDATE tournament_moves SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE tournament_id = ? AND move_id = ? AND status = 'PREPARED'
    `).run(safeStatus, tournamentId, moveId));
  },
  listPendingTournamentMoves: tournamentId => db.prepare(`
    SELECT tournament_id, move_id, player_id, from_table_id, from_seat_idx,
           to_table_id, to_seat_idx, stack, counts_as_move, status
    FROM tournament_moves
    WHERE tournament_id = ? AND status = 'PREPARED'
    ORDER BY created_at ASC, rowid ASC
  `).all(tournamentId),
  setTournamentPlayerPending: (roomId, playerId, stack) => measuredWrite(
    'tournamentMovePending',
    () => db.prepare(`
      UPDATE tournament_registrations
      SET table_id = NULL, seat_idx = NULL, stack = ?
      WHERE room_id = ? AND player_id = ? AND status = 'ACTIVE'
    `).run(Number(stack), roomId, playerId)
  ),
  updateTournamentPlayerStack: (roomId, playerId, stack) => db.prepare(`
    UPDATE tournament_registrations
    SET stack = ?
    WHERE room_id = ? AND player_id = ? AND status = 'ACTIVE'
  `).run(stack, roomId, playerId),
  markTournamentEliminated: (roomId, playerId, place) => db.prepare(`
    UPDATE tournament_registrations
    SET status = 'ELIMINATED', eliminated_place = ?, table_id = NULL, seat_idx = NULL, stack = 0
    WHERE room_id = ? AND player_id = ?
  `).run(place, roomId, playerId),
  markTournamentWinner: (roomId, playerId, stack) => db.prepare(`
    UPDATE tournament_registrations
    SET status = 'WINNER', eliminated_place = 1, table_id = NULL, seat_idx = NULL, stack = ?
    WHERE room_id = ? AND player_id = ?
  `).run(Number(stack), roomId, playerId),
  saveTournamentState: (tournamentId, state) => measuredWrite('tournamentState', () =>
    saveTournamentStateStatement.run(tournamentId, JSON.stringify(state))),
  getTournamentState: (tournamentId) => {
    const row = db.prepare('SELECT state FROM tournament_states WHERE tournament_id = ?').get(tournamentId);
    if (!row) return null;
    try { return JSON.parse(row.state); } catch { return null; }
  },
  saveTournamentTableState: (tournamentId, tableId, tableNo, status, state) =>
    measuredWrite('tournamentTableState', () => saveTournamentTableStateStatement
      .run(tournamentId, tableId, tableNo, status, JSON.stringify(state))),
  listTournamentTableStates: (tournamentId) => db.prepare(`
    SELECT table_id, table_no, status, state
    FROM tournament_table_states
    WHERE tournament_id = ?
    ORDER BY table_no ASC
  `).all(tournamentId).map(row => {
    try { return { ...row, state: JSON.parse(row.state) }; }
    catch { return null; }
  }).filter(Boolean),
  deleteTournamentTableState: (tournamentId, tableId) => db.prepare(`
    DELETE FROM tournament_table_states WHERE tournament_id = ? AND table_id = ?
  `).run(tournamentId, tableId),
  saveRoomState: (roomId, state) => {
    return measuredWrite('roomState', () => saveRoomStateStatement.run(roomId, JSON.stringify(state)));
  },
  getRoomState: (roomId) => {
    const row = db.prepare('SELECT state FROM room_states WHERE room_id = ?').get(roomId);
    if (!row) return null;
    try { return JSON.parse(row.state); } catch { return null; }
  },
  deleteRoomState: (roomId) => {
    db.prepare('DELETE FROM room_states WHERE room_id = ?').run(roomId);
  },
  deleteRoom: (roomId) => {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM tournament_registrations WHERE room_id = ?').run(roomId);
      db.prepare('DELETE FROM tournament_table_states WHERE tournament_id = ?').run(roomId);
      db.prepare('DELETE FROM tournament_states WHERE tournament_id = ?').run(roomId);
      db.prepare('DELETE FROM room_states WHERE room_id = ?').run(roomId);
      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    });
    tx();
  },
  getStorageInfo: () => ({
    path: dbPath,
    journalMode: db.pragma('journal_mode', { simple: true }),
    synchronous: db.pragma('synchronous', { simple: true }),
    busyTimeout: db.pragma('busy_timeout', { simple: true }),
    walAutocheckpoint: db.pragma('wal_autocheckpoint', { simple: true })
  }),
  getWriteMetrics: () => Object.fromEntries([...writeMetrics].map(([name, metric]) => [name, {
    count: metric.count,
    averageMs: metric.count ? metric.totalMs / metric.count : 0,
    maxMs: metric.maxMs,
    over10ms: metric.over10ms
  }])),
  checkpoint: (mode = 'PASSIVE') => db.pragma(`wal_checkpoint(${mode})`),
  backup: destination => db.backup(destination),
  close: () => db.close()
};
