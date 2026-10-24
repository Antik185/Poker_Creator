'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3121;
const BASE = `http://127.0.0.1:${PORT}`;
const MAIN_HOST = 'antikpoker.online';
const EDGE_HOST = 'griffin-mining-entry-pools.trycloudflare.com';
const EDGE_ORIGIN = `https://${EDGE_HOST}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS  ${message}`);
}

async function waitForServer(timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Edge handoff test server did not start');
}

function request(urlPath, host, cookie = '', country = '') {
  return fetch(`${BASE}${urlPath}`, {
    redirect: 'manual',
    headers: {
      'x-forwarded-host': host,
      'x-forwarded-proto': 'https',
      ...(country ? { 'cf-ipcountry': country } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    }
  });
}

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server/index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      PUBLIC_EDGE_URL: EDGE_ORIGIN,
      PUBLIC_EDGE_COUNTRIES: 'RU',
      ADMIN_PASSWORD: 'edge-handoff-admin-password',
      PLAYER_SESSION_SECRET: 'edge-handoff-player-session-secret-at-least-32-bytes'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  try {
    await waitForServer();
    const home = await request('/', MAIN_HOST);
    const originalCookie = home.headers.get('set-cookie')?.split(';')[0] || '';
    assert(home.status === 200 && originalCookie.startsWith('poker_player='),
      'main host issues a server player identity');

    const regularLobby = await request('/lobby/ABCD', MAIN_HOST, originalCookie, 'US');
    assert(regularLobby.status === 200,
      'non-target countries stay on the main host');

    const lobbyRedirect = await request('/lobby/ABCD', MAIN_HOST, originalCookie, 'RU');
    const edgeLocation = lobbyRedirect.headers.get('location') || '';
    const edgeUrl = new URL(edgeLocation);
    assert(lobbyRedirect.status === 307 && edgeUrl.origin === EDGE_ORIGIN,
      'main lobby route redirects to the configured public edge');
    assert(edgeUrl.searchParams.has('edge_handoff'),
      'edge redirect carries a one-time identity handoff');

    const handoff = await request(`${edgeUrl.pathname}${edgeUrl.search}`, EDGE_HOST);
    const edgeCookie = handoff.headers.get('set-cookie')?.split(';')[0] || '';
    assert(handoff.status === 302 && handoff.headers.get('location') === '/lobby/ABCD',
      'public edge consumes the handoff and removes it from the URL');
    assert(edgeCookie === originalCookie,
      'public edge restores the same signed player identity');

    const lobby = await request('/lobby/ABCD', EDGE_HOST, edgeCookie);
    const lobbyHtml = await lobby.text();
    assert(lobby.status === 200 && lobbyHtml.includes('data-lobby-bundle="socket.io"'),
      'public edge serves the lobby without redirect loops');

    const reused = await request(`${edgeUrl.pathname}${edgeUrl.search}`, EDGE_HOST);
    const reusedCookie = reused.headers.get('set-cookie')?.split(';')[0] || '';
    assert(reused.status === 302 && reusedCookie && reusedCookie !== originalCookie,
      'identity handoff cannot be replayed');

    const roomRedirect = await request('/r/test-room', MAIN_HOST, originalCookie, 'RU');
    const roomLocation = new URL(roomRedirect.headers.get('location'));
    assert(roomRedirect.status === 307 && roomLocation.origin === EDGE_ORIGIN,
      'direct table links use the same public edge handoff');
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
