'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { connectPlayer, createPlayerSession } = require('./test-player-session');

const PORT = 3117;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'stage-one-security-admin-password';
const sockets = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS  ${message}`);
}

async function waitFor(fn, timeoutMs = 6000, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fn()) return;
    await sleep(75);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error('Timed out waiting for security test server');
}

async function client(cookie = null) {
  const connected = await connectPlayer(BASE, cookie);
  const result = { ...connected, state: null, seat: -1, events: [] };
  sockets.push(result.socket);
  result.socket.on('stateUpdate', state => { result.state = state; });
  result.socket.on('autoSeated', payload => { result.seat = payload.seatIdx; });
  result.socket.on('sessionReplaced', payload => result.events.push(['sessionReplaced', payload]));
  result.socket.on('reaction', payload => result.events.push(['reaction', payload]));
  return result;
}

(async () => {
  let createdRoomId = null;
  const child = spawn(process.execPath, [path.join(__dirname, 'server/index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ADMIN_PASSWORD,
      PLAYER_SESSION_SECRET: 'stage-one-player-session-secret-at-least-32-bytes'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  try {
    await waitForServer();

    const sessionResponse = await fetch(`${BASE}/api/player/session`, {
      headers: { 'x-forwarded-proto': 'https' }
    });
    const securePlayerCookie = sessionResponse.headers.get('set-cookie') || '';
    assert(/poker_player=/.test(securePlayerCookie) && /HttpOnly/.test(securePlayerCookie) && /Secure/.test(securePlayerCookie),
      'player identity cookie is HttpOnly and Secure behind HTTPS');
    assert(sessionResponse.headers.get('strict-transport-security')?.includes('max-age='),
      'HTTPS responses include HSTS');

    const anonymousCreate = await fetch(`${BASE}/api/rooms`, { method: 'POST' });
    assert(anonymousCreate.status === 401, 'room creation requires an admin session');

    const login = await fetch(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ password: ADMIN_PASSWORD })
    });
    const adminCookieHeader = login.headers.get('set-cookie') || '';
    const adminCookie = adminCookieHeader.split(';')[0];
    assert(login.ok && /poker_admin=/.test(adminCookie) && /Secure/.test(adminCookieHeader),
      'admin session cookie is protected under HTTPS');

    const csrf = await fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: adminCookie, Origin: 'https://attacker.invalid' }
    });
    assert(csrf.status === 403, 'cross-origin administrative mutation is rejected');

    const body = new URLSearchParams({ config: JSON.stringify({ startStack: 5000, lobbyWaitSeconds: 120 }) });
    const createdResponse = await fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const created = await createdResponse.json();
    createdRoomId = created.roomId || null;
    assert(createdResponse.ok && created.roomId && created.code, 'admin can create a v2 room');

    const cookieA = await createPlayerSession(BASE);
    const cookieB = await createPlayerSession(BASE);
    const cookieSpectator = await createPlayerSession(BASE);
    const a = await client(cookieA);
    const b = await client(cookieB);
    let lobbyPayload = null;
    b.socket.on('lobbyTick', payload => { lobbyPayload = payload; });
    a.socket.emit('joinLobby', { code: created.code, name: 'Alice', playerId: 'same-attacker-value' });
    b.socket.emit('joinLobby', { code: created.code, name: 'Bob', playerId: 'same-attacker-value' });
    await waitFor(() => lobbyPayload?.players?.length === 2, 4000, 'sanitized lobby payload');
    assert(lobbyPayload.players.every(player => Object.keys(player).join(',') === 'name'),
      'public lobby payload contains names only');

    for (const current of [a, b]) {
      current.socket.emit('joinRoom', { roomId: created.roomId, playerId: 'same-attacker-value' });
    }
    await sleep(150);
    a.socket.emit('sitAtTable', { seatIdx: 0, name: 'Alice', playerId: 'same-attacker-value' });
    b.socket.emit('sitAtTable', { seatIdx: 1, name: 'Bob', playerId: 'same-attacker-value' });
    await waitFor(() => a.seat === 0 && b.seat === 1, 5000, 'two secure seats');
    assert(a.state?.yourSeat === 0 && b.state?.yourSeat === 1,
      'browser-supplied playerId cannot merge or hijack seats');

    const spectator = await client(cookieSpectator);
    spectator.socket.emit('joinRoom', { roomId: created.roomId, playerId: 'same-attacker-value' });
    await waitFor(() => spectator.state, 3000, 'spectator state');
    assert(spectator.state.yourSeat === -1, 'spectator cannot claim another player seat');

    const stackBefore = a.state.seats[0].stack;
    const secondTab = await client(cookieA);
    secondTab.socket.emit('joinRoom', { roomId: created.roomId, playerId: 'forged-different-id' });
    await waitFor(() => secondTab.seat === 0 && a.events.some(event => event[0] === 'sessionReplaced'), 4000, 'tab takeover');
    assert(secondTab.state?.yourSeat === 0, 'same server session reconnects in another tab');

    a.events.length = 0;
    a.socket.emit('reaction', { content: '🔥', type: 'emoji' });
    await sleep(350);
    assert(!b.events.some(event => event[0] === 'reaction'), 'replaced tab cannot send seated-player reactions');
    secondTab.socket.emit('reaction', { content: '🔥', type: 'emoji' });
    await waitFor(() => b.events.some(event => event[0] === 'reaction'), 2000, 'authorized reaction');
    assert(true, 'active tab retains normal player controls');

    secondTab.socket.close();
    await waitFor(() => b.state?.seats?.[0]?.connected === false, 3000, 'sit-out state');
    assert(b.state.seats[0].sittingOut === true, 'disconnect marks the reserved seat as sitting out');

    const refreshed = await client(cookieA);
    refreshed.socket.emit('joinRoom', { roomId: created.roomId, playerId: 'another-forged-id' });
    await waitFor(() => refreshed.seat === 0 && refreshed.state?.seats?.[0]?.connected, 4000, 'refresh reconnect');
    assert(refreshed.state.seats[0].stack === stackBefore, 'refresh restores the same seat and stack');
  } finally {
    sockets.forEach(socket => socket.close());
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    if (createdRoomId) require('./server/db').deleteRoom(createdRoomId);
  }
})().catch(error => {
  sockets.forEach(socket => socket.close());
  console.error(error.stack || error);
  process.exitCode = 1;
});
