'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { createSiteRenderer } = require('./server/siteRenderer');
const previewMode = process.argv.includes('--serve');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-lobby-pages-'));
process.env.POKER_DB_PATH = path.join(directory, 'lobby.sqlite');
const db = require('./server/db');
const Database = require('better-sqlite3');
const base = 'http://127.0.0.1:3133';
const artworkName = 'lobby-test-' + crypto.randomUUID() + '.png';
const brokenName = 'lobby-test-' + crypto.randomUUID() + '.jpg';
const uploadRoot = path.join(__dirname, 'public/uploads');
const artifacts = [artworkName, brokenName].map(name => path.join(uploadRoot, name));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => console.log('PASS  ' + name);
let server, raw;

function clientChecks() {
  const template = fs.readFileSync('public/site/pages/lobby.html', 'utf8');
  const source = fs.readFileSync('public/lobby.js', 'utf8');
  assert.doesNotMatch(template, /\bon(?:click|input|error|load)=|style=/);
  assert.doesNotMatch(source, /onclick=|style="|tournament-lobby-bg/);
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.events = {}; this.value = ''; this.hidden = false;
      const values = new Set(); this.classList = { add: x => values.add(x), remove: x => values.delete(x),
        toggle: (x, yes) => yes ? values.add(x) : values.delete(x) }; }
    addEventListener(name, handler) { this.events[name] = handler; }
    setAttribute() {}
  }
  const nodes = Object.fromEntries([...template.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  nodes.lobbyBannerImage = new Element();
  const page = new Element(); page.dataset.lobbyState = 'ready';
  const auth = new Element(); auth.hidden = false;
  const selectors = { '.lobby-page': page, '[data-auth-user]': auth };
  const document = new Element(); document.body = new Element();
  document.getElementById = id => nodes[id] || null;
  document.querySelector = selector => selectors[selector] || (selectors[selector] = new Element());
  const location = { pathname: '/lobby/ABCD', search: '', origin: base, reload: () => {} };
  const window = new Element(); window.location = location;
  window.AntikGameEntry = { ensure: async () => ({ type: 'ACCOUNT', name: 'LobbyAccount' }) };
  const socket = { on: (name, handler) => { socket[name] = handler; }, emit: (...args) => sent.push(args) };
  const sent = [];
  vm.runInNewContext(source, { window, document, location, io: () => socket, Date, Intl, Number, String, Set,
    localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} });
  nodes.lobbyBannerImage.events.error(); assert.equal(nodes.lobbyBanner.dataset.background, 'fallback');
  assert.equal(nodes.lobbyBannerImage.hidden, true);
  nodes.lobbyBannerImage.events.load(); assert.equal(nodes.lobbyBanner.dataset.background, 'image');
  const state = { roomId: 'saved-id', code: 'ABCD', title: 'Existing tournament', description: 'Existing description',
    serverNow: Date.now(), startAt: Date.now() + 120000, seatingOpensAt: Date.now() - 180000,
    registrationClosesAt: Date.now() + 600000, lateRegistrationMinutes: 8,
    status: 'seating', maxPlayers: 9, maxEntrants: 90, activeRegistrations: 1,
    structure: { startStack: 5000, levelDurationSec: 180, levels: [{ level: 1, sb: 25, bb: 50, ante: 6 }] },
    registrations: [{ name: '<img src=x onerror="attack()">', avatarUrl: '/avatars/a.png" onerror="attack()', status: 'ACTIVE', stack: 5000 }] };
  socket.scheduledLobbyState(state);
  assert.equal(nodes.lobbyTitle.textContent, state.title);
  assert.equal(nodes.scheduledDescription.textContent, state.description);
  assert.match(nodes.registeredPlayers.innerHTML, /&lt;img/);
  assert.match(nodes.registeredPlayers.innerHTML, /&quot;/);
  assert.equal(nodes.registerTournamentButton.disabled, false);
  assert.match(nodes.scheduledCountdown.innerHTML, /countdown-cell/);
  socket.scheduledLobbyState({ ...state, status: 'finished', winnerName: 'Winner', registered: true,
    playerStatus: 'WINNER', registrations: [{ name: 'Winner', status: 'WINNER', eliminatedPlace: 1 }] });
  assert.match(nodes.lobbyHeroStatus.textContent, /завершён/);
  assert.match(nodes.registeredPlayers.innerHTML, /ПОБЕДИТЕЛЬ/);
  assert.equal(nodes.takeSeatButton.style.display, 'none');
  assert.equal(nodes.spectateTournamentButton.style.display, 'none');
  assert.equal(nodes.registerTournamentButton.disabled, true);
  pass('client preserves countdown, participants, final places and actions; broken banner falls back; dynamic attributes are escaped');
}

function fixture(title, maxPlayers, { scheduled = true, art = '', finished = false } = {}) {
  title = title.slice(0, 80);
  const id = crypto.randomUUID();
  const code = db.saveRoom(id, title, { brand: title, launchMode: scheduled ? 'scheduled' : 'instant',
    tournamentTitle: title, tournamentDescription: 'Тестовое описание. Параметры, участники и действия сохранены.',
    scheduledStartAt: new Date(Date.now() + 86400000).toISOString(), maxPlayers, maxEntrants: 90,
    startStack: 5000, sb: 25, bb: 50, lobbyWaitSeconds: 3600, lateRegistrationMinutes: 10 }, art || null, null);
  if (scheduled) {
    const players = ['PreviewPlayer', 'PlayerWithALongNickname'];
    for (let n = 0; n < players.length; n++) db.registerTournamentPlayer(id, 'fixture-' + id + '-' + n, players[n], 90, 5000);
    if (finished) {
      db.markTournamentEliminated(id, 'fixture-' + id + '-1', 2);
      db.markTournamentWinner(id, 'fixture-' + id + '-0', 10000);
      db.saveTournamentState(id, { status: 'FINISHED', finishedAt: Date.now(), winnerName: players[0] });
    }
  }
  return { id, code, title, url: base + '/lobby/' + code };
}

async function main() {
  clientChecks();
  await sharp({ create: { width: 1800, height: 1000, channels: 3, background: '#4d83c6' } })
    .composite([{ input: Buffer.from('<svg width="1800" height="1000"><circle cx="1300" cy="260" r="290" fill="#8fd7e9"/><path d="M0 650L900 180L1300 1000H0Z" fill="#243f72"/></svg>') }]).png().toFile(artifacts[0]);
  fs.writeFileSync(artifacts[1], 'not an image');
  const originalHash = crypto.createHash('sha256').update(fs.readFileSync(artifacts[0])).digest('hex');
  const fixtures = [fixture('Poker night at Dlicom!', 9, { art: '/uploads/' + artworkName, finished: true }),
    fixture('Вечерний турнир сообщества AntikPoker — длинное название для проверки мобильного экрана', 9, { art: '/uploads/' + artworkName }),
    fixture('AntikPoker · 6-Max', 6), fixture('Обычная комната · 9-Max', 9, { scheduled: false, art: '/uploads/' + artworkName }),
    fixture('Повреждённая обложка', 6, { art: '/uploads/' + brokenName }), fixture('Обычная комната · 6-Max', 6, { scheduled: false })];
  server = spawn(process.execPath, ['server/index.js'], { cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3133', ADMIN_PASSWORD: '',
      PUBLIC_EDGE_URL: '', REQUIRE_HTTPS: '0', PROFILE_AVATAR_DIR: path.join(directory, 'avatars'),
      PLAYER_SESSION_SECRET: 'lobby-test-only-player-secret-32-bytes', USER_AUTH_SECRET: 'lobby-test-only-auth-secret-32-bytes' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
  for (let n = 0; n < 160; n++) {
    try { if (output.includes('Server running at http://localhost:3133') && (await fetch(base + '/healthz', { signal: AbortSignal.timeout(1000) })).ok) break; } catch (_) {}
    if (n === 159 || server.exitCode !== null) throw Error('Preview server failed: ' + output);
    await sleep(70);
  }
  raw = new Database(process.env.POKER_DB_PATH, { readonly: true });
  const rows = () => ['rooms', 'tournament_registrations', 'tournament_states'].map(table => raw.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all());
  const before = rows();
  for (const item of fixtures) {
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await fetch(item.url); assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const policy = response.headers.get('content-security-policy');
      assert.ok(policy.includes("script-src 'self' 'sha256-")); assert.ok(!policy.includes('unsafe-inline'));
      const html = await response.text();
      assert.match(html, /class="navbar"/); assert.match(html, /data-auth-user hidden/);
      assert.ok(html.includes(item.title)); assert.doesNotMatch(html, /{{[A-Z_]+}}|tournament-lobby-bg|class="bg"/);
      assert.match(html, /src="\/lobby.js\?v=/); assert.match(html, /href="\/site\/css\/lobby.css\?v=/);
      assert.equal(db.getRoomByCode(item.code).id, item.id);
    }
  }
  const photo = await (await fetch(fixtures[3].url)).text();
  const previewPath = photo.match(/id="lobbyBannerImage"[^>]+src="([^"]+)"/)[1];
  const preview = await fetch(base + previewPath); assert.equal(preview.status, 200);
  const bytes = Buffer.from(await preview.arrayBuffer()); assert.ok(bytes.length <= 96 * 1024);
  assert.equal((await sharp(bytes).metadata()).width, 640);
  assert.equal((await fetch(base + '/api/tournaments/' + fixtures[3].id + '/preview')).status, 404);
  assert.equal((await fetch(base + '/api/lobby-previews/missing/preview')).status, 404);
  assert.equal((await fetch(base + '/api/lobby-previews/default/preview')).status, 404);
  const broken = await (await fetch(fixtures[4].url)).text();
  assert.equal((await fetch(base + broken.match(/id="lobbyBannerImage"[^>]+src="([^"]+)"/)[1])).status, 404);
  const missing = await (await fetch(base + '/lobby/0000')).text(); assert.match(missing, /data-lobby-state="missing"/);
  for (const route of ['/lobby', '/lobby/', '/lobby.html']) assert.match(await (await fetch(base + route)).text(), /data-lobby-state="entry"/);
  assert.deepEqual(rows(), before, 'GET lobby requests must not alter rooms, IDs, codes, registrations or saved state'); raw.close();
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(artifacts[0])).digest('hex'), originalHash);
  const renderer = createSiteRenderer();
  const accountHtml = renderer.lobby({ room: db.getRoom(fixtures[0].id), user: { username: '<Account>', avatarUrl: '/avatars/a.png' } });
  assert.match(accountHtml, /data-auth-guest hidden/); assert.match(accountHtml, /data-user-name>&lt;Account&gt;</);
  pass('existing ordinary/scheduled 6-max and 9-max URLs, refresh, finished and missing rooms use shared layout without DB changes');
  pass('strict CSP permits only the exact Socket.IO bundle; public-room previews remain bounded/local-only and do not expose tournament-only endpoints');
  if (previewMode) {
    console.log(JSON.stringify({ base, fixtures, directory }, null, 2));
    process.on('SIGTERM', () => server.kill());
    process.on('SIGINT', () => server.kill());
    await new Promise(resolve => server.once('exit', resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
  if (raw?.open) raw.close();
  db.close();
  for (const artifact of artifacts) { assert.equal(path.dirname(path.resolve(artifact)), path.resolve(uploadRoot)); if (fs.existsSync(artifact)) fs.unlinkSync(artifact); }
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});
