'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-history-'));
process.env.POKER_DB_PATH = path.join(dir, 'history.sqlite');
const Database = require('better-sqlite3');
const oldDb = new Database(process.env.POKER_DB_PATH);
oldDb.exec(require('./server/migrations').MIGRATIONS[0].sql);
oldDb.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
  INSERT INTO schema_migrations VALUES (1, 'existing accounts', CURRENT_TIMESTAMP);
  INSERT INTO users (id,username,username_normalized,email,email_normalized,password_hash)
    VALUES ('existing-user','ExistingUser','existinguser','existing@example.test','existing@example.test','preserved-hash');`);
oldDb.close();
let db = require('./server/db');
const { GameIdentityService } = require('./server/gameIdentity');
const { safeReturnPath } = require('./server/userAuth');
const pass = message => console.log(`PASS  ${message}`);

function user(name) {
  const id = randomUUID();
  db.createUser({ id, username: name, usernameNormalized: name.toLowerCase(),
    email: `${name}@example.com`, emailNormalized: `${name.toLowerCase()}@example.com`, passwordHash: 'test-only' });
  return db.getOrCreateAccountGameplayIdentity(id);
}
function tournament(id) {
  db.saveRoom(id, 'Community', { launchMode: 'scheduled', tournamentTitle: `Tournament ${id}`,
    scheduledStartAt: new Date(Date.now() - 1000).toISOString() }, null, null);
}
function register(id, identity) {
  return db.registerTournamentPlayer(id, identity.playerId, identity.name, 90, 5000, identity);
}

try {
  const migrated = new Database(process.env.POKER_DB_PATH);
  assert.equal(migrated.prepare('SELECT password_hash FROM users WHERE id = ?').get('existing-user').password_hash, 'preserved-hash');
  assert.equal(migrated.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 2);
  migrated.close();
  pass('migration upgrades an existing v1 database without modifying its account');
  const a = user('AccountA'), b = user('AccountB');
  const service = new GameIdentityService({ db, userAuth: {}, playerIdentity: {}, randomInt: (() => {
    const values = [123, 123, 124]; return () => values.shift();
  })() });
  const guest = service.ensureGuest(randomUUID());
  assert.equal(guest.name, 'Guest00000123');
  const guest2 = service.ensureGuest(randomUUID());
  assert.equal(guest2.name, 'Guest00000124');
  assert.throws(() => service.ensureGuest(a.playerId), /authenticated session/);
  assert.equal(db.getOrCreateAccountGameplayIdentity(a.userId).playerId, a.playerId);
  pass('guest names retry collisions; account identity cannot be claimed as guest');

  tournament('finished');
  register('finished', a); register('finished', b); register('finished', guest);
  register('finished', a);
  assert.equal(db.listUserTournamentResults(a.userId).total, 1);
  assert.throws(() => register('finished', { ...a, type: 'GUEST', userId: null }), /IDENTITY_CONFLICT/);
  db.saveTournamentState('finished', { status: 'RUNNING' });
  db.markTournamentFinalTablePlayers('finished', [a.playerId, b.playerId]);
  db.markTournamentEliminated('finished', guest.playerId, 3);
  db.markTournamentEliminated('finished', b.playerId, 2);
  db.markTournamentWinner('finished', a.playerId, 15000);
  const finishedAt = Date.now();
  db.saveTournamentState('finished', { status: 'FINISHED', finishedAt });
  db.saveTournamentState('finished', { status: 'FINISHED', finishedAt });
  const history = db.listUserTournamentResults(a.userId);
  assert.equal(history.total, 1);
  assert.equal(history.items[0].finalPlace, 1);
  assert.equal(history.items[0].participantCount, 3);
  assert.equal(history.items[0].finishedAt, finishedAt);
  assert.equal(history.items[0].reachedFinalTable, true);
  assert.equal(db.listUserTournamentResults(b.userId).items[0].finalPlace, 2);
  assert.deepEqual(db.getUserTournamentStats(a.userId), { played: 1, wins: 1, finalTables: 1 });
  pass('authoritative places and real final-table marks persist once, including offline participants');

  tournament('cancelled'); register('cancelled', a);
  db.deleteRoom('cancelled');
  const cancelled = db.listUserTournamentResults(a.userId).items.find(item => item.tournamentId === 'cancelled');
  assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.finalPlace, null);
  db.deleteRoom('finished');
  assert.equal(db.listUserTournamentResults(a.userId).total, 2);
  assert.deepEqual(db.getUserTournamentStats(a.userId), { played: 1, wins: 1, finalTables: 1 });
  assert.equal(db.listUserTournamentResults(a.userId, { limit: 1, offset: 1 }).items.length, 1);
  assert.equal(db.listUserTournamentResults('stranger').total, 0);
  db.close(); delete require.cache[require.resolve('./server/db')]; db = require('./server/db');
  assert.equal(db.listUserTournamentResults(a.userId).total, 2);
  assert.equal(db.getGameplayIdentity(guest.playerId).name, guest.name);
  pass('history survives cancellation, room deletion and restart; stats exclude cancellations');

  for (const value of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/\n/evil.invalid']) {
    assert.equal(safeReturnPath(value), '/profile');
  }
  assert.equal(safeReturnPath('/lobby/ABCD?x=1'), '/lobby/ABCD?x=1');
  pass('login return path cannot redirect to an external origin');
} finally {
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
}
