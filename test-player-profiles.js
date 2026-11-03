'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const { io } = require('socket.io-client');
const { testMailEnvironment, lastCode } = require('./test-email-helper');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-profiles-'));
const base = 'http://127.0.0.1:3119';
const password = 'profiles-test-password';
const sockets = [];
let server, database;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => console.log(`PASS  ${name}`);

async function until(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, done); reject(new Error(`Missing ${name}`)); }, 5000);
    function done(data) { clearTimeout(timer); resolve(data); }
    socket.once(name, done);
  });
}
async function start() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3119',
      ...testMailEnvironment(dir),
      ADMIN_PASSWORD: '', PUBLIC_EDGE_URL: '', POKER_DB_PATH: path.join(dir, 'test.sqlite'),
      PROFILE_AVATAR_DIR: path.join(dir, 'avatars'),
      PLAYER_SESSION_SECRET: 'profiles-test-player-secret-at-least-32',
      USER_AUTH_SECRET: 'profiles-test-user-secret-at-least-32',
      AUTH_ARGON2_MEMORY: '8192', AUTH_ARGON2_PASSES: '2' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.pipe(process.stderr);
  if (process.env.PROFILE_TEST_DEBUG) server.stdout.pipe(process.stdout);
  await until(async () => { try { return (await fetch(`${base}/healthz`)).ok; } catch { return false; } }, 'server');
}
async function stop() {
  if (!server) return;
  const stopped = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await stopped;
  server = null;
}
function client() { return { cookies: new Map(), csrf: '' }; }
function cookie(c) { return [...c.cookies].map(([key, value]) => `${key}=${value}`).join('; '); }
async function request(c, url, { method = 'GET', json, body, csrf = c.csrf, origin = base } = {}) {
  const headers = { Cookie: cookie(c), Origin: origin };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(base + url, { method, headers,
    body: json === undefined ? body : JSON.stringify(json), redirect: 'manual', signal: AbortSignal.timeout(10000) });
  for (const value of res.headers.getSetCookie()) {
    const pair = value.split(';')[0]; const sep = pair.indexOf('=');
    c.cookies.set(pair.slice(0, sep), pair.slice(sep + 1));
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (data?.csrfToken) c.csrf = data.csrfToken;
  return { status: res.status, data, res };
}
async function register(c, username) {
  await request(c, '/api/auth/registration');
  const result = await request(c, '/api/auth/register', { method: 'POST', json: {
    username, email: `${username}@example.com`, password, passwordConfirmation: password
  } });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  const confirmed = await request(c, '/api/auth/verify-email', { method: 'POST', json: {
    code: lastCode(path.join(dir, 'email-outbox.jsonl'), `${username}@example.com`)
  } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.authenticated, true);
  return confirmed.data.user;
}
async function connect(c, headers = {}) {
  const socket = io(base, { path: '/realtime/', transports: ['websocket'], forceNew: true,
    reconnection: false, extraHeaders: { Cookie: cookie(c), Origin: base, ...headers } });
  sockets.push(socket);
  socket.on('stateUpdate', state => { socket.state = state; });
  if (process.env.PROFILE_TEST_DEBUG) socket.onAny((name, data) => console.log('SOCKET', name, name === 'stateUpdate' ? data.yourSeat : data));
  await event(socket, 'connect');
  return socket;
}
async function createRoom(c, config = {}) {
  const data = new FormData(); data.append('config', JSON.stringify({ brand: 'Profiles test', ...config }));
  const result = await request(c, '/api/rooms', { method: 'POST', body: data });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
async function join(socket, roomId) {
  const ready = event(socket, 'stateUpdate'); socket.emit('joinRoom', { roomId }); await ready;
}
async function upload(c, bytes, type = 'image/png', extra = {}) {
  const form = new FormData(); form.append('avatar', new Blob([bytes], { type }), '../../avatar.png');
  return request(c, '/api/profile/avatar', { method: 'POST', body: form, ...extra });
}

(async () => {
  try {
    await start();
    database = new Database(path.join(dir, 'test.sqlite'));
    const account = client(), other = client(), guest = client();
    const user = await register(account, 'ProfileAlice'); await register(other, 'ProfileBob');
    assert.equal((await request(account, '/api/game/identity')).data.identity.name, 'ProfileAlice');
    assert.equal((await request(account, '/api/game/identity/select', { method: 'POST', json: { mode: 'guest' } })).status, 403);
    const guestIdentity = (await request(guest, '/api/game/identity')).data.identity;
    assert.match(guestIdentity.name, /^Guest\d{8}$/);
    assert.deepEqual((await request(guest, '/api/game/identity')).data.identity, guestIdentity);
    assert.equal((await request(guest, '/api/profile/tournaments')).status, 401);
    pass('account mode is mandatory; guest identity is stable and private APIs require login');
    const foreign = io(base, { path: '/realtime/', transports: ['websocket'], forceNew: true,
      reconnection: false, extraHeaders: { Cookie: cookie(account), Origin: 'https://evil.invalid' } });
    sockets.push(foreign);
    assert.match((await event(foreign, 'connect_error')).message, /Cross-origin/);
    foreign.close();
    pass('cross-origin authenticated Socket.IO handshake is rejected');

    const png = await sharp({ create: { width: 900, height: 500, channels: 3, background: '#ffcc00' } }).png().toBuffer();
    assert.equal((await upload(guest, png)).status, 401);
    assert.equal((await upload(account, png, 'image/png', { csrf: '' })).status, 403);
    assert.equal((await upload(account, png, 'image/png', { origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await upload(account, Buffer.from('<svg onload="alert(1)"></svg>'))).status, 415);
    assert.equal((await upload(account, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
    const uploaded = await upload(account, png, 'application/octet-stream');
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
    const avatar = uploaded.data.user.avatarUrl;
    assert.match(avatar, /^\/profile-avatars\/[0-9a-f-]+\.webp\?v=\d+$/);
    const bytes = Buffer.from(await (await fetch(base + avatar)).arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 256); assert.equal(metadata.height, 256);
    assert.equal(metadata.exif, undefined);
    assert.equal((await request(other, '/api/auth/session')).data.user.avatarUrl, null);
    pass('avatar validates decoded content, size, CSRF and owner; reencodes a 256px WebP');

    const room = await createRoom(account);
    const a = await connect(account); await join(a, room.roomId);
    let denied = event(a, 'sitDenied');
    a.emit('sitAtTable', { seatIdx: 0, identityMode: 'guest' }); await denied;
    const seated = event(a, 'autoSeated');
    a.emit('sitAtTable', { seatIdx: 0, name: 'Impostor', userId: 'victim', avatarUrl: 'https://evil.invalid/x' }); await seated;
    await until(() => a.state?.seats[0]?.name === 'ProfileAlice', 'account seating');
    assert.equal(a.state.seats[0].avatarUrl, avatar);
    const stableStack = a.state.seats[0].stack;
    const second = client();
    assert.equal((await request(second, '/api/auth/login', { method: 'POST', json: { login: 'ProfileAlice', password } })).status, 200);
    const b = await connect(second); await join(b, room.roomId);
    await until(() => b.state?.yourSeat === 0, 'second device resumes seat');
    assert.equal(b.state.seats.filter(Boolean).length, 1);
    assert.equal(b.state.seats[0].stack, stableStack);
    await until(() => !a.connected || a.state?.yourSeat === -1, 'old controller revoked');
    pass('socket ignores forged name/avatar; second device resumes the same account seat');

    const replacement = await upload(account, png);
    assert.equal(replacement.status, 200);
    assert.equal((await fetch(base + avatar)).status, 404);
    await until(() => b.state?.seats[0]?.avatarUrl === replacement.data.user.avatarUrl, 'live avatar update');
    assert.equal((await request(account, '/api/profile/avatar', { method: 'DELETE' })).status, 200);
    await until(() => !b.state?.seats[0]?.avatarUrl, 'default avatar restored');
    assert.equal(fs.readdirSync(path.join(dir, 'avatars')).length, 0);
    pass('avatar replacement/deletion updates active seats and removes old files');
    let limited = false;
    for (let i = 0; i < 11; i++) {
      const result = await upload(account, Buffer.from('not an image'));
      if (result.status === 429) { limited = true; break; }
      assert.equal(result.status, 415);
    }
    assert.equal(limited, true);
    pass('avatar writes are rate limited, including invalid uploads');

    const disconnected = event(b, 'disconnect');
    assert.equal((await request(second, '/api/auth/logout', { method: 'POST' })).status, 200);
    await disconnected;
    const afterLogout = await connect(second); await join(afterLogout, room.roomId);
    assert.equal(afterLogout.state.yourSeat, -1);
    assert.equal(afterLogout.state.seats[0].name, 'ProfileAlice');
    assert.equal(afterLogout.state.seats[0].stack, stableStack);
    pass('logout revokes control without transferring the account seat or stack to a guest');

    const guestRoom = await createRoom(account);
    const g = await connect(guest); await join(g, guestRoom.roomId);
    const guestSeat = event(g, 'autoSeated'); g.emit('sitAtTable', { seatIdx: 0, name: 'ProfileAlice' }); await guestSeat;
    await until(() => g.state?.seats[0]?.name === guestIdentity.name, 'guest seating');
    assert.equal((await request(guest, '/api/auth/login', { method: 'POST', json: { login: 'ProfileAlice', password } })).status, 409);
    g.close();
    const rejoined = await connect(guest); await join(rejoined, guestRoom.roomId);
    assert.equal(rejoined.state.yourSeat, 0); assert.equal(rejoined.state.seats[0].name, guestIdentity.name);
    pass('active guest cannot be converted by login; reconnect preserves guest seat');

    const tournament = await createRoom(account, { launchMode: 'scheduled', scheduledStartAt: new Date(Date.now() + 600000).toISOString() });
    const mtt = await connect(account);
    let lobby = event(mtt, 'scheduledLobbyState'); mtt.emit('joinLobby', { code: tournament.code }); await lobby;
    denied = event(mtt, 'tournamentRegistrationError'); mtt.emit('registerTournament', { code: tournament.code, identityMode: 'guest' }); await denied;
    lobby = event(mtt, 'scheduledLobbyState'); mtt.emit('registerTournament', { code: tournament.code, name: 'Fake', userId: 'fake' }); await lobby;
    lobby = event(mtt, 'scheduledLobbyState'); mtt.emit('registerTournament', { code: tournament.code }); await lobby;
    const registration = database.prepare('SELECT * FROM tournament_registrations WHERE room_id = ?').get(tournament.roomId);
    assert.equal(registration.user_id, user.id); assert.equal(registration.name, 'ProfileAlice');
    const history = await request(account, '/api/profile/tournaments');
    assert.equal(history.data.total, 1); assert.equal(history.data.items[0].status, 'SCHEDULED');
    assert.equal((await request(other, `/api/profile/tournaments?userId=${user.id}`)).data.total, 0);
    pass('MTT registration has immutable server account owner; private history is idempotent');
    const expiring = await connect(other);
    const expired = event(expiring, 'disconnect');
    database.prepare('UPDATE auth_sessions SET expires_at = ? WHERE user_id = ?').run(1,
      database.prepare('SELECT id FROM users WHERE username = ?').get('ProfileBob').id);
    await expired;
    pass('expired account session disconnects an idle socket');

    for (const s of sockets) s.close();
    await stop(); await start();
    assert.equal((await request(guest, '/api/game/identity')).data.identity.name, guestIdentity.name);
    assert.equal((await request(account, '/api/profile/tournaments')).data.total, 1);
    const restored = await connect(guest); await join(restored, guestRoom.roomId);
    assert.equal(restored.state.yourSeat, 0); assert.equal(restored.state.seats[0].name, guestIdentity.name);
    pass('guest seat, account session and MTT history survive server restart');
  } finally {
    for (const socket of sockets) socket.close();
    database?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
