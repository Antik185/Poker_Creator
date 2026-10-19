'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3113;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'release-test-admin-password';

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

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, 'server/index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ADMIN_PASSWORD: PASSWORD
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
    assert(adminPage.includes('/poker.js?v=') && adminPage.includes('/poker.css?v='), 'admin assets are cache-versioned');
    assert(!adminPage.includes('rel="preload" as="image"'), 'admin page does not preload heavy game effects');

    const fontCss = await fetch(`${BASE_URL}/fonts.css`).then(response => response.text());
    assert(fontCss.includes("url('/fonts/") && !fontCss.includes('fonts.gstatic.com'), 'fonts are served locally');

    const logout = await fetch(`${BASE_URL}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert(logout.ok, 'admin session can be closed');
  } finally {
    server.kill('SIGTERM');
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
