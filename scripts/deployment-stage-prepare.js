'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const backup = path.resolve(process.argv[2]);
const directory = path.resolve(process.argv[3]);
const app = path.resolve(process.argv[4]);
if (!directory.startsWith('/home/deploy/antik-v23-') || directory === backup) throw new Error('Unsafe staging directory');
if (!app.startsWith('/home/deploy/antik-v23-') || !fs.existsSync(path.join(app, 'server/index.js'))) throw new Error('Unsafe staging app');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!input.apiKey || /[\r\n]/.test(input.apiKey)) throw new Error('Missing or invalid staging mail credential');
fs.mkdirSync(directory, { mode: 0o700 });
fs.cpSync(path.join(backup, 'poker.db'), path.join(directory, 'poker.db'));
fs.cpSync(path.join(backup, 'uploads'), path.join(directory, 'uploads'), { recursive: true });
fs.cpSync(path.join(backup, 'uploads'), path.join(app, 'public/uploads'), { recursive: true });
const random = () => crypto.randomBytes(32).toString('base64url');
const environment = {
  NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3301', TRUST_PROXY: '1', REQUIRE_HTTPS: '1',
  POKER_DB_PATH: path.join(directory, 'poker.db'), PROFILE_AVATAR_DIR: path.join(app, 'public/uploads/profile-avatars'),
  PLAYER_SESSION_SECRET: random(), USER_AUTH_SECRET: random(), EMAIL_VERIFICATION_SECRET: random(), ADMIN_PASSWORD: random(),
  EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.resend.com', SMTP_PORT: '465', SMTP_USER: 'resend', SMTP_PASSWORD: input.apiKey,
  SMTP_FROM: 'AntikPoker <noreply@antikpoker.online>', PUBLIC_BASE_URL: 'https://localhost:3443'
};
fs.writeFileSync(path.join(directory, 'staging.env'), Object.entries(environment)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '7',
  '-subj', '/CN=v23-staging.localhost', '-addext', 'subjectAltName=DNS:v23-staging.localhost,DNS:localhost,IP:127.0.0.1',
  '-keyout', path.join(directory, 'tls-key.pem'), '-out', path.join(directory, 'tls-cert.pem')], { stdio: 'ignore' });
fs.chmodSync(path.join(directory, 'tls-key.pem'), 0o600);
console.log(JSON.stringify({ prepared: true, directory, mailTransport: 'smtp', productionChanged: false }));
