'use strict';

// Online preparation snapshot, not the final maintenance-window backup.
// The source is opened read-only; no application imports or schema changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || '/var/www/poker-room');
const destination = path.resolve(process.argv[3] || '');
if (!process.argv[3] || destination === root || destination.startsWith(root + path.sep)) {
  throw new Error('Backup destination must be outside the application directory');
}
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Symlinks require manual backup review');
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? files(absolute, relative) : [{ path: relative, sha256: hash(absolute) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
async function main() {
  fs.mkdirSync(destination, { mode: 0o700 });
  const source = path.join(root, 'public/uploads');
  const before = files(source);
  fs.cpSync(source, path.join(destination, 'uploads'), { recursive: true });
  const db = new Database(path.join(root, 'poker.db'), { readonly: true, fileMustExist: true });
  await db.backup(path.join(destination, 'poker.db'));
  db.close();
  if (JSON.stringify(before) !== JSON.stringify(files(source))) throw new Error('Uploads changed during snapshot; retry');
  if (JSON.stringify(before) !== JSON.stringify(files(path.join(destination, 'uploads')))) throw new Error('Upload copy mismatch');
  const restored = new Database(path.join(destination, 'poker.db'), { readonly: true, fileMustExist: true });
  if (restored.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('SQLite integrity failed');
  const references = new Set();
  function scan(value) {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\/uploads\/([a-zA-Z0-9._/-]+)/g)) references.add(match[1]);
    } else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  }
  const tables = restored.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  const counts = {};
  for (const table of ['rooms', 'room_states', 'tournament_states', 'tournament_table_states', 'tournament_registrations',
    'users', 'auth_sessions', 'gameplay_identities', 'pending_registrations', 'user_tournament_results']) {
    if (!tables.includes(table)) continue;
    counts[table] = restored.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    if (table === 'rooms') for (const row of restored.prepare('SELECT config, felt_url, logo_url FROM rooms').iterate()) {
      scan(JSON.parse(row.config)); scan(row.felt_url); scan(row.logo_url);
    }
    if (['room_states', 'tournament_states', 'tournament_table_states'].includes(table)) {
      for (const row of restored.prepare(`SELECT state FROM ${table}`).iterate()) scan(JSON.parse(row.state));
    }
    if (table === 'users') for (const row of restored.prepare('SELECT avatar_path FROM users WHERE avatar_path IS NOT NULL').iterate()) {
      references.add('profile-avatars/' + row.avatar_path);
    }
  }
  restored.close();
  const missing = [...references].filter(file => {
    const absolute = path.resolve(destination, 'uploads', file);
    return !absolute.startsWith(path.join(destination, 'uploads') + path.sep) || !fs.existsSync(absolute);
  });
  const sourceArchive = path.join(destination, 'application.tar.gz');
  execFileSync('tar', ['-czf', sourceArchive, '--exclude=./node_modules', '--exclude=./backups',
    '--exclude=./poker.db*', '--exclude=./public/uploads', '--exclude=./.env*', '--exclude=./.git', '-C', root, '.']);
  const manifest = { createdAt: new Date().toISOString(), databaseSha256: hash(path.join(destination, 'poker.db')),
    applicationSha256: hash(sourceArchive), counts, uploads: before, references: references.size, missing,
    verified: missing.length === 0, finalMaintenanceBackup: false };
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ destination, ...manifest, uploads: before.length }));
  if (missing.length) process.exitCode = 2;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
