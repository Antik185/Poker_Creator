'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = 3107;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const root = __dirname;

function run(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, script)], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)));
  });
}

function waitForServer(timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(BASE_URL, res => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - started >= timeoutMs) return reject(new Error('Test server did not start'));
      setTimeout(probe, 150);
    };
    probe();
  });
}

(async () => {
  await run('test-engine.js');
  await run('test-all-in-showdown.js');
  await run('test-stage4-reliability.js');
  await run('test-player-identity.js');
  await run('test-restart.js');
  await run('test-mtt-manager.js');
  await run('test-tournament-lifecycle.js');
  await run('test-edge-handoff.js');
  await run('test-admin-auth.js');
  await run('test-security-stage1.js');
  await run('test-client-performance.js');
  await run('test-mobile-geometry.js');
  await run('test-audio-reactions.js');
  await run('test-release-controls.js');
  await run('test-lobby-observer.js');
  const server = spawn(process.execPath, [path.join(root, 'server/index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);
  try {
    await waitForServer();
    await run('test-e2e.js', { BASE_URL });
    await run('test-rocket.js', { BASE_URL });
    await run('test-e2e-tournament.js', { BASE_URL });
  } finally {
    server.kill('SIGTERM');
  }
  console.log('PASS  complete release test suite');
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
