'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server/db');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function walk(root, current = root) {
  if (!fs.existsSync(current)) return [];
  return fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(current, entry.name);
    return entry.isDirectory() ? walk(root, absolute) : [{
      path: path.relative(root, absolute).replaceAll('\\', '/'),
      size: fs.statSync(absolute).size,
      sha256: sha256(absolute)
    }];
  });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const outputRoot = path.resolve(process.argv[2] || path.join(root, 'backups'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(outputRoot, stamp);
  const uploadSource = path.join(root, 'public', 'uploads');
  const uploadDestination = path.join(destination, 'uploads');
  fs.mkdirSync(destination, { recursive: true });

  await db.backup(path.join(destination, 'poker.db'));
  if (fs.existsSync(uploadSource)) {
    fs.cpSync(uploadSource, uploadDestination, { recursive: true });
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    database: {
      file: 'poker.db',
      size: fs.statSync(path.join(destination, 'poker.db')).size,
      sha256: sha256(path.join(destination, 'poker.db'))
    },
    uploads: walk(uploadDestination)
  };
  fs.writeFileSync(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  db.close();
  console.log(destination);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
