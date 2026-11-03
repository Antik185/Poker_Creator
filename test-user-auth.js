'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { testMailEnvironment, verifiedRegistration } = require('./test-email-helper');

const PORT = 3118;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'user-auth-admin-password';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-user-auth-'));
const dbPath = path.join(tempDir, 'user-auth.sqlite');
let server;

function pass(message) {
  console.log(`PASS  ${message}`);
}

function cookieHeader(response) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}

async function waitForServer(timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('User auth test server did not start');
}

async function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, 'server/index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testMailEnvironment(tempDir),
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ADMIN_PASSWORD: PASSWORD,
      PLAYER_SESSION_SECRET: 'user-auth-player-session-secret-at-least-32-bytes',
      USER_AUTH_SECRET: 'user-auth-account-session-secret-at-least-32-bytes',
      POKER_DB_PATH: dbPath,
      AUTH_ARGON2_MEMORY: '8192',
      AUTH_ARGON2_PASSES: '2',
      AUTH_LOGIN_LIMIT: '3'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);
  await waitForServer();
}

async function stopServer() {
  if (!server) return;
  server.kill('SIGTERM');
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
  server = null;
}

async function json(pathname, { method = 'GET', cookie = '', body, csrf = '', origin = true } = {}) {
  if (pathname === '/api/auth/register' && !csrf) {
    const init = await fetch(`${BASE_URL}/api/auth/registration`);
    csrf = (await init.json()).csrfToken;
    cookie = cookieHeader(init);
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (origin && method !== 'GET') headers.Origin = BASE_URL;
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  return { response, payload, cookie: cookieHeader(response) };
}

async function register(username, email, password = 'correct horse battery staple') {
  const response = await verifiedRegistration(BASE_URL,
    { username, email, password, passwordConfirmation: password }, path.join(tempDir, 'email-outbox.jsonl'));
  return { response, payload: await response.json(), cookie: cookieHeader(response) };
}

async function login(loginValue, password = 'correct horse battery staple', cookie = '') {
  return json('/api/auth/login', {
    method: 'POST', cookie, body: { login: loginValue, password }
  });
}

(async () => {
  await startServer();
  try {
    const created = await register('AuthPlayer', 'auth@example.com');
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.user.username, 'AuthPlayer');
    assert.ok(created.payload.user.emailVerifiedAt);
    assert.match(created.cookie, /poker_player=/);
    assert.match(created.cookie, /antik_user_session=/);
    pass('email confirmation automatically creates separate account and player cookies');

    const db = new Database(dbPath);
    const stored = db.prepare('SELECT * FROM users WHERE id = ?').get(created.payload.user.id);
    assert.match(stored.password_hash, /^\$argon2id\$/);
    assert.notEqual(stored.password_hash, 'correct horse battery staple');
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 3);
    pass('password is stored with Argon2id and schema migration is versioned');

    const duplicateUsername = await register('AuthPlayer', 'other@example.com');
    assert.equal(duplicateUsername.response.status, 409);
    assert.ok(duplicateUsername.payload.fields.username);
    pass('duplicate username is rejected');

    const duplicateEmail = await register('OtherPlayer', 'auth@example.com');
    assert.equal(duplicateEmail.response.status, 409);
    assert.ok(duplicateEmail.payload.fields.email);
    pass('duplicate email is rejected');

    const caseDuplicate = await register('authplayer', 'AUTH@EXAMPLE.COM');
    assert.equal(caseDuplicate.response.status, 409);
    pass('username and email uniqueness is case-insensitive');

    const invalidEmail = await register('InvalidEmail', 'not-an-email');
    assert.equal(invalidEmail.response.status, 400);
    assert.ok(invalidEmail.payload.fields.email);
    pass('invalid email is rejected');

    const weakPassword = await register('WeakPassword', 'weak@example.com', 'short');
    assert.equal(weakPassword.response.status, 400);
    assert.ok(weakPassword.payload.fields.password);
    pass('weak password is rejected');

    const mismatch = await json('/api/auth/register', {
      method: 'POST',
      body: {
        username: 'Mismatch', email: 'mismatch@example.com',
        password: 'long-enough-password', passwordConfirmation: 'different-password'
      }
    });
    assert.equal(mismatch.response.status, 400);
    assert.ok(mismatch.payload.fields.passwordConfirmation);
    pass('mismatched password confirmation is rejected');

    const usernameLogin = await login('AuthPlayer');
    assert.equal(usernameLogin.response.status, 200);
    assert.equal(usernameLogin.payload.user.username, 'AuthPlayer');
    pass('login by username succeeds');

    const emailLogin = await login('AUTH@EXAMPLE.COM');
    assert.equal(emailLogin.response.status, 200);
    assert.equal(emailLogin.payload.user.username, 'AuthPlayer');
    pass('login by email succeeds without case sensitivity');

    const wrongPassword = await login('AuthPlayer', 'wrong-password-value');
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(wrongPassword.payload.error, 'Неверный логин, email или пароль');
    const missingAccount = await login('missing@example.com', 'wrong-password-value');
    assert.equal(missingAccount.payload.error, wrongPassword.payload.error);
    pass('wrong password and missing account use the same error');

    const noSession = await json('/api/auth/profile');
    assert.equal(noSession.response.status, 401);
    pass('protected profile rejects a missing session');

    const session = await json('/api/auth/session', { cookie: usernameLogin.cookie });
    assert.equal(session.payload.authenticated, true);
    const noCsrfLogout = await json('/api/auth/logout', {
      method: 'POST', cookie: usernameLogin.cookie
    });
    assert.equal(noCsrfLogout.response.status, 403);
    pass('state-changing logout requires CSRF token');

    const logout = await json('/api/auth/logout', {
      method: 'POST', cookie: usernameLogin.cookie, csrf: session.payload.csrfToken
    });
    assert.equal(logout.response.status, 200);
    assert.equal(logout.payload.success, true);
    pass('logout succeeds with valid CSRF token');

    const revoked = await json('/api/auth/session', { cookie: usernameLogin.cookie });
    assert.equal(revoked.payload.authenticated, false);
    pass('logged-out session is revoked server-side');

    const expiring = await login('AuthPlayer');
    const authToken = /antik_user_session=([^;\s]+)/.exec(expiring.cookie)[1];
    const authTokenHash = crypto.createHash('sha256').update(decodeURIComponent(authToken)).digest('hex');
    db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE session_token_hash = ?')
      .run(Date.now() - 1, authTokenHash);
    const expired = await json('/api/auth/session', { cookie: expiring.cookie });
    assert.equal(expired.payload.authenticated, false);
    pass('expired session is rejected and revoked');

    await register('RateTarget', 'rate@example.com');
    for (let index = 0; index < 3; index++) {
      const failed = await login('RateTarget', `incorrect-password-${index}`);
      assert.equal(failed.response.status, 401);
    }
    const limited = await login('RateTarget', 'incorrect-password-final');
    assert.equal(limited.response.status, 429);
    pass('login rate limiting activates after repeated failures');

    const owner = await login('AuthPlayer');
    const ownProfile = await json('/api/auth/profile?userId=someone-else', { cookie: owner.cookie });
    assert.equal(ownProfile.response.status, 200);
    assert.equal(ownProfile.payload.user.id, created.payload.user.id);
    pass('profile API always returns the authenticated owner, never a requested user id');

    const adminPage = await fetch(`${BASE_URL}/admin`, { headers: { Cookie: owner.cookie } }).then(response => response.text());
    assert.ok(!adminPage.includes('Create Your Room'));
    const adminApi = await fetch(`${BASE_URL}/api/rooms`, { method: 'POST', headers: { Cookie: owner.cookie } });
    assert.equal(adminApi.status, 401);
    pass('ordinary user session grants no admin access');

    const deviceOne = await login('AuthPlayer');
    const deviceTwo = await login('auth@example.com');
    const tabOne = await json('/api/auth/session', { cookie: deviceOne.cookie });
    const tabTwo = await json('/api/auth/session', { cookie: deviceOne.cookie });
    const secondDevice = await json('/api/auth/session', { cookie: deviceTwo.cookie });
    assert.ok(tabOne.payload.authenticated && tabTwo.payload.authenticated && secondDevice.payload.authenticated);
    assert.notEqual(
      /antik_user_session=([^;\s]+)/.exec(deviceOne.cookie)[1],
      /antik_user_session=([^;\s]+)/.exec(deviceTwo.cookie)[1]
    );
    pass('two tabs share one session while a second device receives an independent session');

    db.close();
    await stopServer();
    await startServer();
    const afterRestart = await json('/api/auth/session', { cookie: deviceTwo.cookie });
    assert.equal(afterRestart.payload.authenticated, true);
    assert.equal(afterRestart.payload.user.username, 'AuthPlayer');
    pass('persistent auth session survives a server restart');

    const home = await fetch(`${BASE_URL}/`).then(response => response.text());
    assert.match(home, /Покер, который/);
    assert.match(home, /\/site\/assets\/images\/dlicom-poker\.webp/);
    assert.doesNotMatch(home, /data:image\/webp;base64/);
    assert.doesNotMatch(home, /https?:\/\/[^"']+(?:\.js|\.css|\.woff)/);
    pass('official home uses extracted same-origin assets without embedded images');
  } finally {
    await stopServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
