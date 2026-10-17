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
`);

// Add code column if missing (migration for existing DBs)
try { db.exec('ALTER TABLE rooms ADD COLUMN code TEXT UNIQUE'); } catch(e) {}

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
      db.prepare('DELETE FROM room_states WHERE room_id = ?').run(roomId);
      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    });
    tx();
  }
};
