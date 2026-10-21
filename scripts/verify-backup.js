'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function fail(message) {
  throw new Error(message);
}

const backupDir = path.resolve(process.argv[2] || '');
const manifestPath = path.join(backupDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('manifest.json not found');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const databasePath = path.join(backupDir, manifest.database.file);
if (sha256(databasePath) !== manifest.database.sha256) fail('database checksum mismatch');
for (const upload of manifest.uploads) {
  const uploadPath = path.join(backupDir, 'uploads', upload.path);
  if (!fs.existsSync(uploadPath) || sha256(uploadPath) !== upload.sha256) {
    fail(`upload checksum mismatch: ${upload.path}`);
  }
}

const db = new Database(databasePath, { readonly: true, fileMustExist: true });
if (db.pragma('integrity_check', { simple: true }) !== 'ok') fail('SQLite integrity_check failed');
let snapshots = 0;
for (const table of ['room_states', 'tournament_states', 'tournament_table_states']) {
  for (const row of db.prepare(`SELECT state FROM ${table}`).iterate()) {
    JSON.parse(row.state);
    snapshots++;
  }
}
const registrations = db.prepare('SELECT COUNT(*) AS count FROM tournament_registrations').get().count;
db.close();
console.log(JSON.stringify({ ok: true, uploads: manifest.uploads.length, snapshots, registrations }));
