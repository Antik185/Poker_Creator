'use strict';

const MIGRATIONS = [
  {
    version: 1,
    name: 'user accounts and persistent auth sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_normalized TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        email_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized
        ON users(username_normalized);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
        ON users(email_normalized);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_token_hash TEXT NOT NULL UNIQUE,
        csrf_token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        last_seen_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_token_hash
        ON auth_sessions(session_token_hash);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
        ON auth_sessions(user_id, revoked_at, expires_at);
    `
  }
];

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(row => Number(row.version))
  );
  const insert = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.version, migration.name);
    })();
  }
}

module.exports = { runMigrations, MIGRATIONS };
