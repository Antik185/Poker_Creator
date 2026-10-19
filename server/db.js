const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../poker.db');
const db = new Database(dbPath);

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
    seat_idx INTEGER,
    eliminated_place INTEGER,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, player_id),
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tournament_registrations_room
    ON tournament_registrations(room_id, registered_at);
`);

// Add code column if missing (migration for existing DBs)
try { db.exec('ALTER TABLE rooms ADD COLUMN code TEXT UNIQUE'); } catch(e) {}
try { db.exec("ALTER TABLE tournament_registrations ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'"); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN seat_idx INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE tournament_registrations ADD COLUMN eliminated_place INTEGER'); } catch(e) {}

// Generate unique 4-char code (A-Z, 2-9, no ambiguous chars)
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (db.prepare('SELECT 1 FROM rooms WHERE code=?').get(code));
  return code;
}

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
  listTournamentRegistrations: (roomId) => db.prepare(`
    SELECT player_id, name, status, seat_idx, eliminated_place, registered_at
    FROM tournament_registrations
    WHERE room_id = ?
    ORDER BY registered_at ASC, rowid ASC
  `).all(roomId),
  getTournamentRegistration: (roomId, playerId) => db.prepare(`
    SELECT player_id, name, status, seat_idx, eliminated_place, registered_at
    FROM tournament_registrations
    WHERE room_id = ? AND player_id = ?
  `).get(roomId, playerId),
  registerTournamentPlayer: (roomId, playerId, name, maxPlayers) => {
    const register = db.transaction(() => {
      const existing = db.prepare(`
        SELECT player_id, name, status, seat_idx, eliminated_place, registered_at
        FROM tournament_registrations
        WHERE room_id = ? AND player_id = ?
      `).get(roomId, playerId);
      if (existing) {
        if (existing.status === 'ELIMINATED') {
          const error = new Error('ALREADY_ELIMINATED');
          error.code = 'ALREADY_ELIMINATED';
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
        INSERT INTO tournament_registrations (room_id, player_id, name)
        VALUES (?, ?, ?)
      `).run(roomId, playerId, name);
      return db.prepare(`
        SELECT player_id, name, status, seat_idx, eliminated_place, registered_at
        FROM tournament_registrations
        WHERE room_id = ? AND player_id = ?
      `).get(roomId, playerId);
    });
    return register();
  },
  markTournamentSeated: (roomId, playerId, seatIdx) => db.prepare(`
    UPDATE tournament_registrations
    SET seat_idx = ?
    WHERE room_id = ? AND player_id = ? AND status = 'ACTIVE'
  `).run(seatIdx, roomId, playerId),
  markTournamentEliminated: (roomId, playerId, place) => db.prepare(`
    UPDATE tournament_registrations
    SET status = 'ELIMINATED', eliminated_place = ?, seat_idx = NULL
    WHERE room_id = ? AND player_id = ?
  `).run(place, roomId, playerId),
  saveRoomState: (roomId, state) => {
    db.prepare(`
      INSERT INTO room_states (room_id, state, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(room_id) DO UPDATE SET
        state = excluded.state,
        updated_at = CURRENT_TIMESTAMP
    `).run(roomId, JSON.stringify(state));
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
      db.prepare('DELETE FROM room_states WHERE room_id = ?').run(roomId);
      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    });
    tx();
  }
};
