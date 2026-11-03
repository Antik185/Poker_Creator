const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { runMigrations } = require('./migrations');

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

// Versioned migrations run after the legacy base schema exists. This lets new
// installations and upgraded databases follow the exact same migration path.
runMigrations(db);

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

const createUserStatement = db.prepare(`
  INSERT INTO users (
    id, username, username_normalized, email, email_normalized, password_hash
  ) VALUES (?, ?, ?, ?, ?, ?)
`);
const createAuthSessionStatement = db.prepare(`
  INSERT INTO auth_sessions (
    id, user_id, session_token_hash, csrf_token_hash, created_at, expires_at, last_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function publicUser(row) {
  if (!row) return null;
  const isoDate = value => {
    const text = String(value || '');
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  };
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatarUrl: /^[0-9a-f-]+\.webp$/i.test(String(row.avatar_path || ''))
      ? `/profile-avatars/${row.avatar_path}?v=${Number(row.avatar_updated_at) || 0}`
      : null,
    emailVerifiedAt: row.email_verified_at || null,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at)
  };
}

function gameplayIdentityRow(playerId) {
  return db.prepare(`
    SELECT g.player_id, g.identity_type, g.user_id, g.guest_name,
           g.created_at, g.last_seen_at, u.username, u.avatar_path, u.avatar_updated_at
    FROM gameplay_identities g
    LEFT JOIN users u ON u.id = g.user_id
    WHERE g.player_id = ?
  `).get(playerId) || null;
}

function publicGameplayIdentity(row) {
  if (!row) return null;
  const account = row.identity_type === 'ACCOUNT';
  return {
    playerId: row.player_id,
    type: row.identity_type,
    userId: account ? row.user_id : null,
    name: account ? row.username : row.guest_name,
    avatarUrl: account && /^[0-9a-f-]+\.webp$/i.test(String(row.avatar_path || ''))
      ? `/profile-avatars/${row.avatar_path}?v=${Number(row.avatar_updated_at) || 0}`
      : null,
    createdAt: Number(row.created_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0
  };
}

const getOrCreateAccountGameplayIdentity = db.transaction(userId => {
  const existing = db.prepare('SELECT player_id FROM gameplay_identities WHERE user_id = ?')
    .get(userId);
  if (existing) {
    db.prepare('UPDATE gameplay_identities SET last_seen_at = ? WHERE player_id = ?')
      .run(Date.now(), existing.player_id);
    return publicGameplayIdentity(gameplayIdentityRow(existing.player_id));
  }
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return null;
  const playerId = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO gameplay_identities (
      player_id, identity_type, user_id, guest_name, created_at, last_seen_at
    ) VALUES (?, 'ACCOUNT', ?, NULL, ?, ?)
  `).run(playerId, userId, now, now);
  return publicGameplayIdentity(gameplayIdentityRow(playerId));
});

function safeTournamentStatus(value) {
  return ['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'].includes(value)
    ? value : 'SCHEDULED';
}

function syncTournamentHistory(tournamentId, state = null) {
  const room = db.prepare('SELECT brand, config FROM rooms WHERE id = ?').get(tournamentId);
  if (!room) return;
  const config = JSON.parse(room.config);
  if (config.launchMode !== 'scheduled') return;
  if (!state) {
    const saved = db.prepare('SELECT state FROM tournament_states WHERE tournament_id = ?').get(tournamentId);
    state = saved ? JSON.parse(saved.state) : { status: 'SCHEDULED' };
  }
  const registrations = db.prepare('SELECT * FROM tournament_registrations WHERE room_id = ?').all(tournamentId);
  const status = state.status === 'FINISHED' ? 'COMPLETED' : state.status === 'RUNNING' ? 'RUNNING' : 'SCHEDULED';
  for (const row of registrations) {
    if (row.identity_type !== 'ACCOUNT' || !row.user_id) continue;
    module.exports.recordUserTournamentParticipation({
      userId: row.user_id, tournamentId, gameplayPlayerId: row.player_id,
      tournamentName: config.tournamentTitle || room.brand || 'AntikPoker',
      communityName: room.brand || null,
      registeredAt: Date.parse(`${row.registered_at.replace(' ', 'T')}Z`) || Date.now(),
      startedAt: status !== 'SCHEDULED' ? Date.parse(config.scheduledStartAt) : null,
      participantCount: registrations.length, status
    });
    db.prepare(`UPDATE user_tournament_results
      SET final_place = ?, finished_at = ?, updated_at = ?
      WHERE user_id = ? AND tournament_id = ? AND status != 'CANCELLED'
    `).run(row.eliminated_place || null, state.finishedAt || null, Date.now(), row.user_id, tournamentId);
  }
}

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
  registrationStore: require('./registrationStore').createRegistrationStore(db),
  createUser: ({ id, username, usernameNormalized, email, emailNormalized, passwordHash }) => {
    createUserStatement.run(id, username, usernameNormalized, email, emailNormalized, passwordHash);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  },
  isUsernameAvailable: usernameNormalized => !db.prepare(
    'SELECT 1 FROM users WHERE username_normalized = ?'
  ).get(usernameNormalized),
  getUserForAuthentication: loginNormalized => db.prepare(`
    SELECT * FROM users
    WHERE username_normalized = ? OR email_normalized = ?
    LIMIT 1
  `).get(loginNormalized, loginNormalized) || null,
  getUserById: userId => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)),
  updateUserAvatar: (userId, avatarPath, updatedAt = Date.now()) => {
    const current = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(userId);
    if (!current) return null;
    db.prepare(`
      UPDATE users SET avatar_path = ?, avatar_updated_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(avatarPath || null, avatarPath ? Number(updatedAt) : null, userId);
    return {
      oldAvatarPath: current.avatar_path || null,
      user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId))
    };
  },
  createAuthSession: db.transaction(({ id, userId, tokenHash, csrfTokenHash, createdAt, expiresAt, previousTokenHash }) => {
    if (previousTokenHash) db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE session_token_hash = ?')
      .run(createdAt, previousTokenHash);
    createAuthSessionStatement.run(
      id, userId, tokenHash, csrfTokenHash, createdAt, expiresAt, createdAt
    );
  }),
  getAuthSessionByTokenHash: tokenHash => db.prepare(`
    SELECT s.id AS session_id, s.user_id, s.csrf_token_hash, s.created_at,
           s.expires_at, s.revoked_at, s.last_seen_at,
           u.id, u.username, u.email, u.avatar_path, u.avatar_updated_at,
           u.email_verified_at, u.created_at AS user_created_at,
           u.updated_at AS user_updated_at
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.session_token_hash = ?
    LIMIT 1
  `).get(tokenHash) || null,
  touchAuthSession: (sessionId, now) => db.prepare(
    'UPDATE auth_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL'
  ).run(now, sessionId),
  revokeAuthSession: (sessionId, now = Date.now()) => db.prepare(
    'UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'
  ).run(now, sessionId),
  revokeAuthSessionByTokenHash: (tokenHash, now = Date.now()) => db.prepare(
    'UPDATE auth_sessions SET revoked_at = ? WHERE session_token_hash = ? AND revoked_at IS NULL'
  ).run(now, tokenHash),
  purgeExpiredAuthSessions: now => db.prepare(
    'DELETE FROM auth_sessions WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)'
  ).run(now, now - 7 * 24 * 60 * 60 * 1000),
  listUserAuthSessions: userId => db.prepare(`
    SELECT id, created_at, expires_at, revoked_at, last_seen_at
    FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId),
  getGameplayIdentity: playerId => publicGameplayIdentity(gameplayIdentityRow(playerId)),
  hasActiveGameplayParticipation: playerId => {
    if (db.prepare("SELECT 1 FROM tournament_registrations WHERE player_id = ? AND status = 'ACTIVE' LIMIT 1").get(playerId)) return true;
    const states = db.prepare('SELECT state FROM room_states').all();
    return states.some(row => {
      try {
        const state = JSON.parse(row.state);
        return !state.gameOver && state.game?.seats?.some(seat => seat?.playerId === playerId);
      } catch { return false; }
    });
  },
  getAccountGameplayIdentity: userId => {
    const row = db.prepare('SELECT player_id FROM gameplay_identities WHERE user_id = ?').get(userId);
    return row ? publicGameplayIdentity(gameplayIdentityRow(row.player_id)) : null;
  },
  getOrCreateAccountGameplayIdentity: userId => getOrCreateAccountGameplayIdentity(userId),
  ensureGuestGameplayIdentity: (playerId, guestName) => {
    const existing = gameplayIdentityRow(playerId);
    if (existing) {
      db.prepare('UPDATE gameplay_identities SET last_seen_at = ? WHERE player_id = ?')
        .run(Date.now(), playerId);
      return publicGameplayIdentity(gameplayIdentityRow(playerId));
    }
    const now = Date.now();
    db.prepare(`
      INSERT INTO gameplay_identities (
        player_id, identity_type, user_id, guest_name, created_at, last_seen_at
      ) VALUES (?, 'GUEST', NULL, ?, ?, ?)
    `).run(playerId, guestName, now, now);
    return publicGameplayIdentity(gameplayIdentityRow(playerId));
  },
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
    SELECT player_id, name, status, table_id, seat_idx, stack, move_count,
           eliminated_place, is_bot, registered_at, user_id, identity_type, avatar_url
    FROM tournament_registrations
    WHERE room_id = ?
    ORDER BY registered_at ASC, rowid ASC
  `).all(roomId),
  getTournamentRegistration: (roomId, playerId) => db.prepare(`
    SELECT player_id, name, status, table_id, seat_idx, stack, move_count,
           eliminated_place, is_bot, registered_at, user_id, identity_type, avatar_url
    FROM tournament_registrations
    WHERE room_id = ? AND player_id = ?
  `).get(roomId, playerId),
  registerTournamentPlayer: (roomId, playerId, name, maxPlayers, startStack = null, identity = {}) => {
    const register = db.transaction(() => {
      const identityType = ['ACCOUNT', 'GUEST'].includes(identity.type) ? identity.type : 'LEGACY';
      const userId = identityType === 'ACCOUNT' ? String(identity.userId || '') || null : null;
      const avatarUrl = /^\/profile-avatars\/[0-9a-f-]+\.webp(?:\?v=\d+)?$/i.test(String(identity.avatarUrl || ''))
        ? String(identity.avatarUrl) : null;
      const existing = db.prepare(`
        SELECT player_id, name, status, table_id, seat_idx, stack, move_count,
               eliminated_place, is_bot, registered_at, user_id, identity_type, avatar_url
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
        if (existing.user_id && existing.user_id !== userId) {
          const error = new Error('TOURNAMENT_IDENTITY_CONFLICT');
          error.code = 'TOURNAMENT_IDENTITY_CONFLICT';
          throw error;
        }
        // Existing participant ownership is immutable, including legacy guests.
        if (existing.identity_type === 'LEGACY') return { ...existing, alreadyRegistered: true };
        if (existing.identity_type !== identityType || (existing.user_id || null) !== userId) {
          throw new Error('TOURNAMENT_IDENTITY_CONFLICT');
        }
        db.prepare(`
          UPDATE tournament_registrations
          SET name = ?, avatar_url = ?
          WHERE room_id = ? AND player_id = ?
        `).run(name, avatarUrl, roomId, playerId);
        syncTournamentHistory(roomId);
        return {
          ...existing,
          name,
          avatar_url: avatarUrl,
          user_id: existing.user_id || userId,
          identity_type: existing.identity_type === 'LEGACY' ? identityType : existing.identity_type,
          alreadyRegistered: true
        };
      }
      const count = db.prepare("SELECT COUNT(*) AS count FROM tournament_registrations WHERE room_id = ? AND status = 'ACTIVE'")
        .get(roomId).count;
      if (count >= maxPlayers) {
        const error = new Error('TOURNAMENT_FULL');
        error.code = 'TOURNAMENT_FULL';
        throw error;
      }
      db.prepare(`
        INSERT INTO tournament_registrations (
          room_id, player_id, name, stack, user_id, identity_type, avatar_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        roomId,
        playerId,
        name,
        Number.isFinite(Number(startStack)) ? Number(startStack) : null,
        userId,
        identityType,
        avatarUrl
      );
      syncTournamentHistory(roomId);
      return db.prepare(`
        SELECT player_id, name, status, table_id, seat_idx, stack, move_count,
               eliminated_place, is_bot, registered_at, user_id, identity_type, avatar_url
        FROM tournament_registrations
        WHERE room_id = ? AND player_id = ?
      `).get(roomId, playerId);
    });
    return register();
  },
  updateTournamentAvatarForUser: (userId, avatarUrl) => db.prepare(`
    UPDATE tournament_registrations SET avatar_url = ? WHERE user_id = ?
  `).run(avatarUrl || null, userId),
  recordUserTournamentParticipation: ({
    userId,
    tournamentId,
    gameplayPlayerId,
    tournamentName,
    communityName = null,
    registeredAt = Date.now(),
    startedAt = null,
    participantCount = null,
    status = 'SCHEDULED'
  }) => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO user_tournament_results (
        id, user_id, tournament_id, gameplay_player_id, tournament_name,
        community_name, registered_at, started_at, participant_count,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, tournament_id) DO UPDATE SET
        tournament_name = excluded.tournament_name,
        community_name = excluded.community_name,
        gameplay_player_id = excluded.gameplay_player_id,
        started_at = COALESCE(user_tournament_results.started_at, excluded.started_at),
        participant_count = COALESCE(excluded.participant_count, user_tournament_results.participant_count),
        status = CASE
          WHEN user_tournament_results.status IN ('COMPLETED', 'CANCELLED')
            THEN user_tournament_results.status
          ELSE excluded.status
        END,
        updated_at = excluded.updated_at
    `).run(
      crypto.randomUUID(), userId, tournamentId, gameplayPlayerId,
      tournamentName, communityName, Number(registeredAt) || now,
      startedAt ? Number(startedAt) : null,
      participantCount == null ? null : Number(participantCount),
      safeTournamentStatus(status), now, now
    );
  },
  markUserTournamentStarted: (tournamentId, startedAt = Date.now(), participantCount = null) => db.prepare(`
    UPDATE user_tournament_results
    SET started_at = COALESCE(started_at, ?),
        participant_count = COALESCE(?, participant_count),
        status = CASE WHEN status = 'SCHEDULED' THEN 'RUNNING' ELSE status END,
        updated_at = ?
    WHERE tournament_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED')
  `).run(
    Number(startedAt),
    participantCount == null ? null : Number(participantCount),
    Date.now(),
    tournamentId
  ),
  markTournamentFinalTablePlayers: (tournamentId, playerIds) => {
    const ids = [...new Set((playerIds || []).filter(Boolean))];
    if (!ids.length) return { changes: 0 };
    const statement = db.prepare(`
      UPDATE user_tournament_results SET reached_final_table = 1, updated_at = ?
      WHERE tournament_id = ? AND gameplay_player_id = ?
    `);
    return db.transaction(() => {
      let changes = 0;
      const now = Date.now();
      for (const playerId of ids) changes += statement.run(now, tournamentId, playerId).changes;
      return { changes };
    })();
  },
  completeUserTournamentResult: (tournamentId, playerId, finalPlace, participantCount, finishedAt = Date.now()) => db.prepare(`
    UPDATE user_tournament_results
    SET final_place = ?, participant_count = ?, finished_at = ?,
        status = 'COMPLETED', updated_at = ?
    WHERE tournament_id = ? AND gameplay_player_id = ?
  `).run(
    Number(finalPlace), Number(participantCount), Number(finishedAt), Date.now(), tournamentId, playerId
  ),
  completeTournamentHistory: (tournamentId, registrations, finishedAt = Date.now()) => {
    const rows = Array.isArray(registrations) ? registrations : [];
    const participantCount = rows.length;
    const statement = db.prepare(`
      UPDATE user_tournament_results
      SET final_place = ?, participant_count = ?, finished_at = ?,
          status = 'COMPLETED', updated_at = ?
      WHERE tournament_id = ? AND gameplay_player_id = ?
    `);
    return db.transaction(() => {
      let changes = 0;
      const now = Date.now();
      for (const registration of rows) {
        if (!registration.user_id || !Number.isInteger(Number(registration.eliminated_place))) continue;
        changes += statement.run(
          Number(registration.eliminated_place), participantCount, Number(finishedAt),
          now, tournamentId, registration.player_id
        ).changes;
      }
      return { changes };
    })();
  },
  cancelTournamentHistory: (tournamentId, finishedAt = Date.now()) => db.prepare(`
    UPDATE user_tournament_results
    SET status = 'CANCELLED', finished_at = ?, updated_at = ?
    WHERE tournament_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED')
  `).run(Number(finishedAt), Date.now(), tournamentId),
  listUserTournamentResults: (userId, { limit = 20, offset = 0 } = {}) => {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const items = db.prepare(`
      SELECT tournament_id, tournament_name, community_name, registered_at,
             started_at, finished_at, participant_count, final_place,
             reached_final_table, status
      FROM user_tournament_results
      WHERE user_id = ?
      ORDER BY registered_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(userId, safeLimit, safeOffset).map(row => ({
      tournamentId: row.tournament_id,
      tournamentName: row.tournament_name,
      communityName: row.community_name || null,
      registeredAt: Number(row.registered_at),
      startedAt: row.started_at == null ? null : Number(row.started_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      participantCount: row.participant_count == null ? null : Number(row.participant_count),
      finalPlace: row.final_place == null ? null : Number(row.final_place),
      reachedFinalTable: row.reached_final_table === 1,
      status: row.status
    }));
    const total = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM user_tournament_results WHERE user_id = ?
    `).get(userId).count);
    return { items, total, limit: safeLimit, offset: safeOffset };
  },
  getUserTournamentStats: userId => {
    const row = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS played,
        SUM(CASE WHEN status = 'COMPLETED' AND final_place = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN status = 'COMPLETED' AND reached_final_table = 1 THEN 1 ELSE 0 END) AS final_tables
      FROM user_tournament_results WHERE user_id = ?
    `).get(userId);
    return {
      played: Number(row?.played) || 0,
      wins: Number(row?.wins) || 0,
      finalTables: Number(row?.final_tables) || 0
    };
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
    db.transaction(() => {
      saveTournamentStateStatement.run(tournamentId, JSON.stringify(state));
      syncTournamentHistory(tournamentId, state);
    })()),
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
      syncTournamentHistory(roomId);
      module.exports.cancelTournamentHistory(roomId);
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
