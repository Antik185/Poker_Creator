'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { io: createSocketClient } = require('./node_modules/socket.io/client-dist/socket.io.js');

const PORT = 3113;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'release-test-admin-password';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-admin-auth-'));
const uploadDir = path.join(__dirname, 'public/uploads');
const uploadsBefore = new Set(fs.readdirSync(uploadDir));

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS  ${message}`);
}

async function waitForServer(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error('Admin auth test server did not start');
}

async function abortMultipartUpload(cookie) {
  const boundary = '----antikpoker-aborted-upload';
  const prefix = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="felt"; filename="aborted.png"',
    'Content-Type: image/png',
    '',
    'partial-file-body'
  ].join('\r\n');
  await new Promise(resolve => {
    const request = http.request(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(prefix) + 10_000
      }
    });
    request.on('error', resolve);
    request.write(prefix);
    setTimeout(() => {
      request.destroy();
      resolve();
    }, 20);
  });
}

async function connectDiagnosticSocket(transports) {
  if (transports[0] === 'polling') {
    const response = await fetch(`${BASE_URL}/realtime/?EIO=4&transport=polling&t=${Date.now()}`);
    const body = await response.text();
    if (!response.ok || !body.startsWith('0{') || !body.includes('"upgrades":["websocket"]')) {
      throw new Error(`polling handshake failed: HTTP ${response.status}`);
    }
    return 'polling';
  }
  const socket = createSocketClient(BASE_URL, {
    path: '/realtime/',
    transports,
    reconnection: false,
    timeout: 4000
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${transports[0]} connection timed out`)), 5000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return socket.io.engine.transport.name;
  } finally {
    socket.disconnect();
  }
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server/index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ADMIN_PASSWORD: PASSWORD,
      PLAYER_SESSION_SECRET: 'admin-auth-player-session-secret-at-least-32-bytes',
      POKER_DB_PATH: path.join(tempDir, 'admin-auth.sqlite')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);

  try {
    await waitForServer();

    const home = await fetch(`${BASE_URL}/`).then(response => response.text());
    assert(home.includes('Join Game'), 'public page exposes Join Game');
    assert(!home.includes('Create Your Room'), 'public page hides the room constructor');
    assert(!home.includes('fonts.googleapis.com'), 'public page has no blocking third-party font request');
    assert(!home.includes('href="/fonts.css'), 'public page has no blocking font stylesheet request');
    assert(!home.includes('@font-face'), 'public entry page starts no web-font downloads');
    assert(!home.includes("fetch('/api/admin/session'"), 'admin login shell makes no blocking session request');
    assert(home.includes('fetchWithNetworkRetry(`/api/code/'), 'room lookup retries transient network failures');
    assert(home.includes("fetchWithNetworkRetry('/api/admin/login'"), 'admin login retries transient network failures');
    assert(home.includes('Connection was interrupted. Please try again.'), 'network failures show a useful message');
    assert(home.includes('const NETWORK_ATTEMPT_TIMEOUT_MS = 8000')
      && home.includes('new AbortController()'), 'home API requests have a bounded per-attempt timeout');
    assert(home.includes("fetchWithNetworkRetry('/api/admin/session'")
      && home.includes('Admin session was not accepted'), 'admin login verifies its session cookie before navigation');
    assert(home.includes('Admin page is taking longer than expected'), 'admin navigation cannot stay silently loading');
    assert(home.includes('href="/diagnostics"'), 'home exposes network diagnostics without requiring JavaScript');

    const diagnosticsResponse = await fetch(`${BASE_URL}/diagnostics`);
    const diagnosticsPage = await diagnosticsResponse.text();
    assert(diagnosticsResponse.ok
      && diagnosticsResponse.headers.get('cache-control') === 'no-store'
      && diagnosticsPage.includes('AntikPoker network diagnostics'), 'public diagnostics page is available without authentication');
    assert(diagnosticsPage.includes('/healthz')
      && diagnosticsPage.includes('/api/admin/session')
      && diagnosticsPage.includes('/realtime/socket.io.js')
      && diagnosticsPage.includes("path:'/realtime/'"), 'diagnostics cover API, resources and realtime path');
    assert(diagnosticsPage.includes('No passwords, cookies or tokens')
      && !diagnosticsPage.includes(PASSWORD), 'diagnostics do not expose credentials');
    assert(await connectDiagnosticSocket(['polling']) === 'polling', 'diagnostic polling transport connects');
    assert(await connectDiagnosticSocket(['websocket']) === 'websocket', 'diagnostic WebSocket transport connects');

    const deniedPage = await fetch(`${BASE_URL}/admin`).then(response => response.text());
    assert(!deniedPage.includes('Create Your Room'), 'anonymous admin page stays locked');

    const deniedCreate = await fetch(`${BASE_URL}/api/rooms`, { method: 'POST' });
    assert(deniedCreate.status === 401, 'anonymous room creation is rejected');

    const wrongLogin = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'incorrect' })
    });
    assert(wrongLogin.status === 401, 'incorrect admin password is rejected');

    const login = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD })
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert(login.ok && cookie, 'correct admin password creates a session');

    const adminPage = await fetch(`${BASE_URL}/admin`, { headers: { Cookie: cookie } }).then(response => response.text());
    assert(adminPage.includes('Create Your Room'), 'authenticated admin can open the constructor');
    assert(adminPage.includes('data-admin-bundle="poker.js"')
      && adminPage.includes('data-admin-bundle="poker.css"'), 'non-Russian admin keeps the existing bundled response');
    assert(!adminPage.includes('rel="preload" as="image"'), 'admin page does not preload heavy game effects');

    const validUpload = new FormData();
    validUpload.set('config', JSON.stringify({ startStack: 5000, lobbyWaitSeconds: 120 }));
    validUpload.set('felt', new Blob([
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    ], { type: 'image/png' }), 'felt.png');
    const validUploadResponse = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: validUpload
    });
    assert(validUploadResponse.ok, 'multipart image upload succeeds after dependency update');

    const uploadsBeforeFakeImage = new Set(fs.readdirSync(uploadDir));
    const fakeImageUpload = new FormData();
    fakeImageUpload.set('config', JSON.stringify({ startStack: 5000, lobbyWaitSeconds: 120 }));
    fakeImageUpload.set('felt', new Blob([
      'this is not a PNG image'
    ], { type: 'image/png' }), 'fake.png');
    const fakeImageResponse = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: fakeImageUpload
    });
    const uploadsAfterFakeImage = fs.readdirSync(uploadDir);
    assert(fakeImageResponse.status === 400
      && (await fakeImageResponse.json()).error === 'Uploaded image content does not match its MIME type',
    'multipart metadata cannot disguise a non-image upload');
    assert(uploadsAfterFakeImage.every(name => uploadsBeforeFakeImage.has(name)),
      'rejected image upload is removed from disk');

    const oversizedUpload = new FormData();
    oversizedUpload.set('config', JSON.stringify({ startStack: 5000, lobbyWaitSeconds: 120 }));
    oversizedUpload.set('felt', new Blob([
      new Uint8Array(5 * 1024 * 1024 + 1)
    ], { type: 'image/png' }), 'oversized.png');
    const oversizedResponse = await fetch(`${BASE_URL}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: oversizedUpload
    });
    assert(oversizedResponse.status === 400
      && (await oversizedResponse.json()).error.includes('LIMIT_FILE_SIZE'), 'oversized upload is rejected');

    await abortMultipartUpload(cookie);
    await new Promise(resolve => setTimeout(resolve, 100));
    const healthAfterAbort = await fetch(`${BASE_URL}/healthz`);
    assert(healthAfterAbort.ok, 'aborted multipart upload does not stall the server');

    const russianAdminPage = await fetch(`${BASE_URL}/admin`, {
      headers: { Cookie: cookie, 'cf-ipcountry': 'RU' }
    }).then(response => response.text());
    assert(russianAdminPage.includes('src="/poker.js?v=20261029b"')
      && russianAdminPage.includes('href="/poker.css?v=20261029a"'), 'Russian admin loads cacheable versioned assets');
    assert(!russianAdminPage.includes('data-admin-bundle='), 'Russian admin does not inline the large client bundle');
    assert(Buffer.byteLength(russianAdminPage, 'utf8') < 100_000, 'Russian admin HTML stays small enough for unreliable connections');
    assert(russianAdminPage.includes('id="bootGuard"')
      && russianAdminPage.includes('antikpoker:ready'), 'Russian admin shows a recoverable bootstrap status instead of a blank page');

    const gamePage = await fetch(`${BASE_URL}/r/test-room`).then(response => response.text());
    assert(gamePage.includes('class="game-active server-game-route"'), 'game route hides the constructor before JavaScript starts');
    assert(gamePage.includes('data-admin-bundle="poker.js"')
      && gamePage.includes('data-admin-bundle="poker.css"'), 'non-Russian game keeps its critical assets bundled');
    assert(!gamePage.includes('src="/poker.js') && !gamePage.includes('href="/poker.css'),
      'game route has no blocking poker.js or poker.css request');

    const russianGamePage = await fetch(`${BASE_URL}/r/test-room`, {
      headers: { 'cf-ipcountry': 'RU' }
    }).then(response => response.text());
    assert(russianGamePage.includes('class="game-active server-game-route"'), 'Russian game opens directly in table mode');
    assert(russianGamePage.includes('src="/poker.js?v=20261029b"')
      && russianGamePage.includes('href="/poker.css?v=20261029a"'), 'Russian game loads cacheable versioned assets');
    assert(!russianGamePage.includes('data-admin-bundle='), 'Russian game does not inline the large client bundle');
    assert(Buffer.byteLength(russianGamePage, 'utf8') < 100_000, 'Russian game HTML stays small enough for unreliable connections');
    assert(russianGamePage.includes('id="bootGuard"'), 'Russian table keeps the bootstrap failure guard');

    const pokerClient = await fetch(`${BASE_URL}/poker.js?v=20261029b`).then(response => response.text());
    assert(pokerClient.includes("socket.once('connect'")
      && pokerClient.includes("socket.once('connect_error'"), 'table bootstrap waits for a real Socket.IO connection');

    const lobbyPage = await fetch(`${BASE_URL}/lobby/TEST`).then(response => response.text());
    assert(lobbyPage.includes('data-lobby-bundle="socket.io"'), 'non-Russian lobby keeps the Socket.IO client bundled');
    assert(!lobbyPage.includes('href="/fonts.css'), 'lobby has no blocking font stylesheet request');
    assert(!lobbyPage.includes('src="/realtime/socket.io.js'), 'lobby has no blocking Socket.IO client request');
    assert(lobbyPage.includes("document.execCommand('copy')"), 'lobby copy buttons support plain HTTP fallback');

    const russianLobbyPage = await fetch(`${BASE_URL}/lobby/TEST`, {
      headers: { 'cf-ipcountry': 'RU' }
    }).then(response => response.text());
    assert(russianLobbyPage.includes('src="/realtime/socket.io.js?v=4.8.4"'), 'Russian lobby loads the cacheable Socket.IO client');
    assert(!russianLobbyPage.includes('data-lobby-bundle='), 'Russian lobby does not inline the Socket.IO client');
    assert(Buffer.byteLength(russianLobbyPage, 'utf8') < 100_000, 'Russian lobby HTML stays small enough for unreliable connections');

    const fontCss = await fetch(`${BASE_URL}/fonts.css`).then(response => response.text());
    assert(fontCss.includes("url('/fonts/") && !fontCss.includes('fonts.gstatic.com'), 'fonts are served locally');

    const logout = await fetch(`${BASE_URL}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert(logout.ok, 'admin session can be closed');
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      server.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    for (const name of fs.readdirSync(uploadDir)) {
      if (!uploadsBefore.has(name)) fs.rmSync(path.join(uploadDir, name), { force: true });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
