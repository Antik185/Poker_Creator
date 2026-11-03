'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const app = path.resolve(process.argv[2]);
const directory = path.resolve(process.argv[3]);
const base = 'https://127.0.0.1:3443';
const ca = fs.readFileSync(path.join(directory, 'tls-cert.pem'));
process.loadEnvFile(path.join(directory, 'staging.env'));
const stateFile = path.join(directory, 'smoke-session.json');
const cookies = {};
let csrf;
const cookie = () => Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
async function request(route, { method = 'GET', json, body, headers = {} } = {}) {
  const payload = json === undefined ? body : Buffer.from(JSON.stringify(json));
  return new Promise((resolve, reject) => {
    const req = https.request(base + route, { method, ca, rejectUnauthorized: true, headers: {
      Cookie: cookie(), Origin: base, ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(payload ? { 'Content-Length': payload.length } : {}), ...headers
    } }, res => {
      for (const value of res.headers['set-cookie'] || []) {
        const pair = value.split(';')[0], separator = pair.indexOf('=');
        cookies[pair.slice(0, separator)] = pair.slice(separator + 1);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text,
          data: String(res.headers['content-type']).includes('application/json') ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject); req.setTimeout(45000, () => req.destroy(new Error('SMOKE_TIMEOUT')));
    if (payload) req.write(payload); req.end();
  });
}
async function realtime(transports, upgrade = false) {
  const { io } = require(path.join(app, 'node_modules/socket.io-client'));
  const socket = io(base, { path: '/realtime/', transports, upgrade, ca, rejectUnauthorized: true,
    reconnection: false, forceNew: true, extraHeaders: { Cookie: cookie(), Origin: base } });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('REALTIME_TIMEOUT')), 15000);
      socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
      socket.once('connect', () => {
        if (!upgrade || socket.io.engine.transport.name === 'websocket') { clearTimeout(timer); resolve(); }
        else socket.io.engine.once('upgrade', () => { clearTimeout(timer); resolve(); });
      });
    });
    assert.equal(socket.io.engine.transport.name, upgrade ? 'websocket' : transports[0]);
  } finally { socket.disconnect(); }
}
async function confirm(code) {
  const saved = JSON.parse(fs.readFileSync(stateFile)); Object.assign(cookies, saved.cookies); csrf = saved.csrf;
  const result = await request('/api/auth/verify-email', { method: 'POST', json: { code } });
  assert.equal(result.status, 200, result.data?.error); assert.equal(result.data.authenticated, true);
  assert.equal(result.data.returnTo, '/profile');
  assert.ok(result.headers['set-cookie'].some(value => /antik_user_session=/.test(value)
    && /HttpOnly/.test(value) && /Secure/.test(value) && /SameSite=Lax/.test(value)));
  fs.writeFileSync(stateFile, JSON.stringify({ cookies, csrf: result.data.csrfToken, confirmationSucceeded: true }), { mode: 0o600 });
  csrf = result.data.csrfToken;
  assert.equal((await request('/profile')).status, 200);
  assert.equal((await request('/api/auth/session')).data.authenticated, true);
  csrf = saved.csrf;
  assert.equal((await request('/api/auth/verify-email', { method: 'POST', json: { code } })).status, 410);
  csrf = result.data.csrfToken;
  assert.equal((await request('/api/auth/logout', { method: 'POST', json: {} })).status, 200);
  assert.equal((await request('/api/auth/session')).data.authenticated, false);
  fs.writeFileSync(path.join(directory, 'email-confirmation-result.json'), JSON.stringify({ verified: true,
    automaticLogin: true, refresh: true, replayRejected: true, logout: true }), { mode: 0o600 });
  console.log('PASS real SMTP registration, single-use code, automatic login, Secure session, profile refresh and logout');
}
async function main() {
  if (process.argv[4] === '--confirm') return confirm(JSON.parse(fs.readFileSync(0, 'utf8')).code);
  for (const route of ['/', '/healthz', '/diagnostics', '/register', '/login', '/site/css/auth.css', '/site/js/profile.js', '/lobby/C3E6']) {
    assert.equal((await request(route)).status, 200, route);
  }
  const login = await request('/api/admin/login', { method: 'POST', json: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(login.status, 200); assert.equal((await request('/admin')).status, 200);
  const identity = await request('/api/game/identity');
  assert.equal(identity.status, 200);
  await realtime(['polling']); await realtime(['websocket']); await realtime(['polling', 'websocket'], true);
  console.log('PASS verified private HTTPS, pages/assets, admin login, polling, WSS and polling-to-WebSocket upgrade');
  const registration = await request('/api/auth/registration'); csrf = registration.data.csrfToken;
  if (!process.env.STAGING_TEST_EMAIL) throw new Error('Set STAGING_TEST_EMAIL to an owner-approved test inbox before sending');
  const password = crypto.randomBytes(24).toString('base64url');
  const result = await request('/api/auth/register', { method: 'POST', json: {
    username: 'V23VpsCheck0311', email: process.env.STAGING_TEST_EMAIL, password, passwordConfirmation: password
  } });
  assert.equal(result.status, 202, result.data?.error);
  fs.writeFileSync(stateFile, JSON.stringify({ cookies, csrf }), { mode: 0o600 });
  console.log('PASS real registration email accepted through Resend SMTP; awaiting owner code');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
