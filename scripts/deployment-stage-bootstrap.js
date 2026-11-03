'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const archive = '/home/deploy/antik-v23-aa682a1.tar.gz';
const backup = '/home/deploy/antik-v23-backup-20261103';
const app = '/home/deploy/antik-v23-app-aa682a1';
const expected = 'fba210a1e5e84f10a262505e5e3d310e7c0ef1a4d486a032969e504f7466fe48';
if (crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== expected) throw new Error('Release archive hash mismatch');
fs.mkdirSync(app, { mode: 0o700 });
execFileSync('tar', ['-xzf', archive, '-C', app]);
const configs = path.join(backup, 'system-config.tar.gz');
execFileSync('sudo', ['-n', 'tar', '-czf', configs, '/etc/nginx', '/etc/letsencrypt',
  '/etc/systemd/system/poker-room.service', '/etc/poker-room.env'], { stdio: ['ignore', 'ignore', 'pipe'] });
execFileSync('sudo', ['-n', 'chmod', '600', configs]);
execFileSync('sudo', ['-n', 'tar', '-tzf', configs], { stdio: 'ignore' });
console.log(JSON.stringify({ releaseHashVerified: true, app, configurationBackup: true, productionChanged: false }));
execFileSync('npm', ['ci'], { cwd: app, stdio: 'inherit', timeout: 180000 });
