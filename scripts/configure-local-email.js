'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');

function configureLocalEmail(sourcePath, { port } = {}) {
  if (!sourcePath) throw new Error('Pass the credentials file path; never pass the API key as an argument');
  if (port !== undefined && (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535)) {
    throw new Error('Invalid local port');
  }
  const lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
  const labels = lines.map((line, index) => /resend\s*api/i.test(line) ? index : -1).filter(index => index >= 0);
  if (labels.length !== 1) throw new Error('Expected one Resend API label in the credentials file');
  const nearby = lines.slice(Math.max(0, labels[0] - 1), labels[0] + 4).join('\n');
  const keys = [...new Set(nearby.match(/\bre_[A-Za-z0-9_-]{16,}\b/g) || [])];
  if (keys.length !== 1) throw new Error('Expected one API key next to the Resend API label');

  const root = path.resolve(__dirname, '..');
  const destination = path.join(root, '.env.local');
  const previous = fs.existsSync(destination) ? parseEnv(fs.readFileSync(destination, 'utf8')) : {};
  const values = {
    ...previous,
    NODE_ENV: previous.NODE_ENV || 'development',
    HOST: previous.HOST || '127.0.0.1',
    PORT: String(port || previous.PORT || '3000'),
    PUBLIC_BASE_URL: port ? `http://localhost:${port}` : (previous.PUBLIC_BASE_URL || 'http://localhost:3000'),
    SMTP_HOST: 'smtp.resend.com', SMTP_PORT: '465', SMTP_USER: 'resend',
    SMTP_PASSWORD: '', SMTP_FROM: 'AntikPoker <noreply@antikpoker.online>',
    EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: keys[0],
    EMAIL_VERIFICATION_SECRET: previous.EMAIL_VERIFICATION_SECRET || crypto.randomBytes(48).toString('base64url')
  };
  const contents = Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n"\\]/.test(value)) {
      throw new Error('Unsupported value in existing local configuration; file was not changed');
    }
    return `${key}="${value}"`;
  }).join('\n') + '\n';
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { configured: true, file: destination, transport: values.EMAIL_TRANSPORT };
}

if (require.main === module) {
  try { console.log(JSON.stringify(configureLocalEmail(process.argv[2], { port: process.argv[3] }))); }
  catch { console.error('Unable to configure local email. No credentials were printed. Check the source label and local config format.'); process.exitCode = 1; }
}
module.exports = { configureLocalEmail };
