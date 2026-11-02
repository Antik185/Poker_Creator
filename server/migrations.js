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
  },
  {
    version: 2,
    name: 'player profiles gameplay identities and tournament history',
    sql: `
      ALTER TABLE users ADD COLUMN avatar_path TEXT;
      ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER;

      CREATE TABLE gameplay_identities (
        player_id TEXT PRIMARY KEY,
        identity_type TEXT NOT NULL CHECK(identity_type IN ('ACCOUNT', 'GUEST')),
        user_id TEXT UNIQUE,
        guest_name TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        CHECK(
          (identity_type = 'ACCOUNT' AND user_id IS NOT NULL AND guest_name IS NULL)
          OR (identity_type = 'GUEST' AND user_id IS NULL AND guest_name IS NOT NULL)
        )
      );

      CREATE UNIQUE INDEX idx_gameplay_identities_user
        ON gameplay_identities(user_id) WHERE user_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_gameplay_identities_guest_name
        ON gameplay_identities(guest_name) WHERE guest_name IS NOT NULL;

      ALTER TABLE tournament_registrations ADD COLUMN user_id TEXT;
      ALTER TABLE tournament_registrations ADD COLUMN identity_type TEXT NOT NULL DEFAULT 'LEGACY';
      ALTER TABLE tournament_registrations ADD COLUMN avatar_url TEXT;

      CREATE INDEX idx_tournament_registrations_user
        ON tournament_registrations(user_id, registered_at);

      CREATE TABLE user_tournament_results (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tournament_id TEXT NOT NULL,
        gameplay_player_id TEXT NOT NULL,
        tournament_name TEXT NOT NULL,
        community_name TEXT,
        registered_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        participant_count INTEGER,
        final_place INTEGER,
        reached_final_table INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, tournament_id)
      );

      CREATE INDEX idx_user_tournament_results_history
        ON user_tournament_results(user_id, registered_at DESC, id DESC);
      CREATE INDEX idx_user_tournament_results_tournament
        ON user_tournament_results(tournament_id, gameplay_player_id);
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
