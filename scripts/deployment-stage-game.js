'use strict';

// Reuse the existing tournament E2E scenario through staging TLS, not production.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const app = path.resolve(process.argv[2]);
const directory = path.resolve(process.argv[3]);
if (!app.startsWith('/home/deploy/antik-v23-') || !directory.startsWith('/home/deploy/antik-v23-')) throw new Error('Staging only');
const code = `
(async () => {
  const base = process.env.BASE_URL;
  const originalFetch = globalThis.fetch;
  const response = await originalFetch(base + '/api/admin/login', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  if (response.status !== 200) throw new Error('Staging admin login failed');
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  globalThis.fetch = (url, options = {}) => originalFetch(url, { ...options,
    headers: { ...options.headers, Cookie: cookie, Origin: base } });
  require(${JSON.stringify(path.join(app, 'test-e2e-tournament.js'))});
})().catch(error => { console.error(error.message); process.exitCode = 1; });
`;
execFileSync(process.execPath, ['--env-file=' + path.join(directory, 'staging.env'), '-e', code], {
  cwd: app, stdio: 'inherit', timeout: 240000,
  env: { ...process.env, BASE_URL: 'https://127.0.0.1:3443', NODE_EXTRA_CA_CERTS: path.join(directory, 'tls-cert.pem') }
});
