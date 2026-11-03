'use strict';

// Read-only VPS inventory. Never import server/db: importing it runs migrations.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || '/var/www/poker-room');
const report = { capturedAt: new Date().toISOString(), root };
const run = (command, args) => {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim(); }
  catch { return null; }
};
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const pid = run('systemctl', ['show', 'poker-room.service', '-p', 'MainPID', '--value']);
const environment = Object.fromEntries((read(`/proc/${pid}/environ`) || '').split('\0').filter(Boolean)
  .map(entry => { const separator = entry.indexOf('='); return [entry.slice(0, separator), entry.slice(separator + 1)]; }));
const safeKeys = ['NODE_ENV', 'HOST', 'PORT', 'POKER_DB_PATH', 'PROFILE_AVATAR_DIR',
  'TRUST_PROXY', 'REQUIRE_HTTPS', 'EMAIL_TRANSPORT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'PUBLIC_BASE_URL'];
report.runtime = {
  pid, node: process.version, npm: run('npm', ['--version']),
  argon2Available: typeof require('node:crypto').argon2 === 'function',
  service: run('systemctl', ['show', 'poker-room.service', '-p', 'User', '-p', 'Group', '-p', 'WorkingDirectory', '-p', 'FragmentPath']),
  environment: Object.fromEntries(safeKeys.filter(key => environment[key] !== undefined).map(key => [key, environment[key]])),
  secretsPresent: Object.fromEntries(['ADMIN_PASSWORD', 'PLAYER_SESSION_SECRET', 'USER_AUTH_SECRET',
    'EMAIL_VERIFICATION_SECRET', 'SMTP_PASSWORD', 'RESEND_API_KEY'].map(key => [key, Boolean(environment[key])])),
  environmentReadable: Boolean(read(`/proc/${pid}/environ`)),
  environmentFiles: []
};
const unit = run('systemctl', ['cat', 'poker-room.service']) || '';
report.runtime.environmentFiles = [...unit.matchAll(/^EnvironmentFile=-?(.+)$/gm)].map(match => match[1].trim());
report.runtime.environmentFilePermissions = report.runtime.environmentFiles.map(file => {
  try { const stat = fs.statSync(file); return { file, mode: (stat.mode & 0o777).toString(8), uid: stat.uid, gid: stat.gid }; }
  catch { return { file, readable: false }; }
});
report.git = { branch: run('git', ['-C', root, 'branch', '--show-current']),
  commit: run('git', ['-C', root, 'rev-parse', 'HEAD']), status: run('git', ['-C', root, 'status', '--short']) };
report.topLevelFiles = fs.readdirSync(root);
report.disk = run('df', ['-h', root]);
report.memory = run('free', ['-m']);
report.ports = run('ss', ['-ltnp']);
const nginx = run('sudo', ['-n', 'nginx', '-T']);
report.nginx = nginx === null ? { readable: false } : { directives: nginx.split('\n').filter(line =>
  /^\s*(?:server_name|listen|proxy_pass|proxy_http_version|proxy_(?:read|send)_timeout|ssl_certificate(?:_key)?|return\s+30[1278])\s/.test(line)
  || /^\s*proxy_set_header\s+(?:Host|X-Forwarded-Proto|X-Forwarded-For|Upgrade|Connection)\s/.test(line)) };
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const databasePath = path.resolve(root, environment.POKER_DB_PATH || 'poker.db');
const db = new Database(databasePath, { readonly: true, fileMustExist: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
report.database = { path: databasePath, bytes: fs.statSync(databasePath).size,
  journalMode: db.pragma('journal_mode', { simple: true }), integrity: db.pragma('integrity_check', { simple: true }), counts: {} };
for (const table of ['rooms', 'room_states', 'tournament_registrations', 'tournament_states', 'users',
  'auth_sessions', 'gameplay_identities', 'pending_registrations', 'user_tournament_results']) {
  if (tables.includes(table)) report.database.counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}
report.database.migrations = tables.includes('schema_migrations')
  ? db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() : [];
report.database.registrationStatuses = tables.includes('tournament_registrations')
  ? db.prepare('SELECT status, COUNT(*) AS n FROM tournament_registrations GROUP BY status').all() : [];
report.database.rooms = tables.includes('room_states') ? db.prepare('SELECT room_id, state FROM room_states').all().map(row => {
  const state = JSON.parse(row.state);
  const seats = state.seats || state.game?.seats || state.engine?.seats || [];
  return { id: row.room_id, phase: state.phase || state.game?.phase || state.engine?.phase, gameOver: state.gameOver || state.engine?.gameOver || false,
    seats: seats.filter(Boolean).length, connectedSeats: seats.filter(seat => seat?.connected).length, keys: Object.keys(state) };
}) : [];
report.database.tournaments = tables.includes('tournament_states')
  ? db.prepare('SELECT t.tournament_id, t.state, r.code FROM tournament_states t JOIN rooms r ON r.id=t.tournament_id').all().map(row => {
    const state = JSON.parse(row.state);
    return { id: row.tournament_id, code: row.code, status: state.status };
  }) : [];
report.database.activeTables = tables.includes('tournament_table_states')
  ? db.prepare("SELECT tournament_id, table_id, state FROM tournament_table_states WHERE status='ACTIVE'").all().map(row => {
    const state = JSON.parse(row.state);
    const seats = state.seats || state.game?.seats || state.engine?.seats || [];
    return { tournamentId: row.tournament_id, tableId: row.table_id, phase: state.phase || state.game?.phase || state.engine?.phase,
      seats: seats.filter(Boolean).length, connectedSeats: seats.filter(seat => seat?.connected).length };
  }) : [];
db.close();
report.sourceHashes = Object.fromEntries(['server/index.js', 'server/gameEngine.js', 'server/db.js', 'public/poker.js', 'package-lock.json']
  .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
report.uploadDirectories = ['public/uploads', environment.PROFILE_AVATAR_DIR || 'public/uploads/profile-avatars'].map(directory => {
  const absolute = path.resolve(root, directory);
  return { path: absolute, exists: fs.existsSync(absolute) };
});
console.log(JSON.stringify(report, null, 2));
const tls = require('node:tls');
const socket = tls.connect({ host: 'smtp.resend.com', port: 465, servername: 'smtp.resend.com', rejectUnauthorized: true,
  minVersion: 'TLSv1.2' }, () => {
  console.log(JSON.stringify({ smtp465Tls: true, authorized: socket.authorized, protocol: socket.getProtocol() }));
  socket.destroy();
});
socket.setTimeout(12000, () => { console.log(JSON.stringify({ smtp465Tls: false, error: 'TIMEOUT' })); socket.destroy(); });
socket.on('error', error => console.log(JSON.stringify({ smtp465Tls: false, error: error.code || 'ERROR' })));
