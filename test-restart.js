'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { io } = require('./node_modules/socket.io/client-dist/socket.io.js');
const db = require('./server/db');
const { createPlayerSession, playerSessionToken } = require('./test-player-session');

const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function startServer() {
  return spawn(process.execPath, [path.join(__dirname, 'server/index.js')], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function waitForServer(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise(resolve => {
      const req = http.get(`${BASE}/healthz`, res => { res.resume(); resolve(res.statusCode === 200); });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error('Restart test server did not start');
}

function stopServer(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 6000).unref();
  });
}

function client(playerId, cookie) {
  const socket = io(BASE, { path: '/realtime/', transports: ['websocket'], forceNew: true, reconnection: false,
    extraHeaders: { Cookie: cookie }, auth: { playerSessionToken: playerSessionToken(cookie) } });
  const result = { socket, state: null, seat: -1 };
  socket.on('stateUpdate', state => { result.state = state; });
  socket.on('autoSeated', data => { result.seat = data.seatIdx; });
  return result;
}

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fn()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

(async () => {
  let server = startServer();
  let roomId;
  try {
    await waitForServer();
    const body = new URLSearchParams({ config: JSON.stringify({ startStack: 5000 }) });
    const response = await fetch(`${BASE}/api/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      signal: AbortSignal.timeout(10000)
    });
    ({ roomId } = await response.json());

    const cookieA = await createPlayerSession(BASE);
    const cookieB = await createPlayerSession(BASE);
    const a = client('restart-A', cookieA);
    const b = client('restart-B', cookieB);
    await Promise.all([a, b].map(c => new Promise(resolve => c.socket.once('connect', resolve))));
    a.socket.emit('joinRoom', { roomId, playerId: 'restart-A' });
    b.socket.emit('joinRoom', { roomId, playerId: 'restart-B' });
    await sleep(150);
    a.socket.emit('sitAtTable', { seatIdx: 0, name: 'Alice', avatarIdx: 0, playerId: 'restart-A' });
    b.socket.emit('sitAtTable', { seatIdx: 1, name: 'Bob', avatarIdx: 1, playerId: 'restart-B' });
    await waitFor(() => a.state?.phase === 'PREFLOP', 8000, 'initial hand');
    const expectedHand = a.state.handNum;
    const expectedStack = a.state.seats[0].stack;
    a.socket.close();
    b.socket.close();
    await sleep(200);
    await stopServer(server);

    server = startServer();
    await waitForServer();
    const returning = client('restart-A', cookieA);
    await new Promise(resolve => returning.socket.once('connect', resolve));
    returning.socket.emit('joinRoom', { roomId, playerId: 'restart-A' });
    await waitFor(() => returning.seat === 0 && returning.state, 5000, 'restored player');
    if (returning.state.handNum !== expectedHand) throw new Error('Hand number was not restored');
    if (returning.state.seats[0].stack !== expectedStack) throw new Error('Stack was not restored');
    if (!returning.state.seats[1]) throw new Error('Opponent seat was not restored');
    returning.socket.close();
    console.log('PASS  process restart restores active room');
  } finally {
    await stopServer(server);
    if (roomId) db.deleteRoom(roomId);
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
