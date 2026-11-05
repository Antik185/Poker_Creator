'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

if (process.argv.includes('--isolated-server')) {
  assert.ok(process.env.POKER_DB_PATH.startsWith(os.tmpdir()), 'test server must use temporary SQLite');
  const modulePath = require.resolve('./server/tournamentManager');
  const original = require(modulePath), managers = new Map();
  let now = Date.now();
  require.cache[modulePath].exports = { ...original, TournamentManager: class extends original.TournamentManager {
    constructor(options) { super({ ...options, now: () => now }); managers.set(this.id, this); }
  } };
  require('./server/index');
  process.on('message', message => {
    try {
      const manager = managers.get(message.id);
      assert.ok(manager);
      if (message.action === 'start') {
        manager.config.scheduledStartAt = new Date(Date.now() - 10000).toISOString();
        for (const table of manager.activeTables()) {
          table.room.config.scheduledStartAt = manager.config.scheduledStartAt;
          table.room.maybeStartHand = () => {};
        }
        manager.start(require('./server/db').listTournamentRegistrations(manager.id), now);
      }
      if (message.action === 'advance') { now += message.ms; manager.tickAfk(); }
      if (message.action === 'hand') {
        for(const table of manager.activeTables()) { table.room.startHand(); table.room.clearTurnTimer(); }
      }
      process.send({ request: message.request, value: { afk: manager.snapshot().afk,
        players: [...manager.players.values()].map(player => ({ playerId: player.playerId, name: player.name, status: player.status })) } });
    } catch(error) { process.send({ request: message.request, error: error.message }); }
  });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
  const { connectPlayer } = require('./test-player-session');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-v25-socket-'));
  const port = await new Promise(resolve => { const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); });
  const base = 'http://127.0.0.1:' + port, sockets = [], waiting = new Map();
  let sequence = 0, output = '';
  const child = fork(__filename, ['--isolated-server'], { silent: true, env: { ...process.env, NODE_ENV: 'test',
    PORT: String(port), POKER_DB_PATH: path.join(temporary, 'game.sqlite'), PROFILE_AVATAR_DIR: path.join(temporary, 'avatars'),
    ADMIN_PASSWORD: '', REQUIRE_HTTPS: '', PUBLIC_EDGE_URL: '', RESEND_API_KEY: '', SMTP_HOST: '' } });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
  child.on('message', message => { const resolve = waiting.get(message.request); if (resolve) { waiting.delete(message.request); resolve(message); } });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, title) {
    for(let i = 0; i < 400; i++) { if(await check()) return; await sleep(30); }
    throw Error('Timed out: ' + title);
  }
  async function command(id, action, more = {}) {
    const request = ++sequence;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(request); reject(Error('IPC timeout')); }, 4000);
      waiting.set(request, message => { clearTimeout(timer); message.error ? reject(Error(message.error)) : resolve(message.value); });
    });
    child.send({ id, action, request, ...more }); return result;
  }
  async function client(cookie) {
    const player = await connectPlayer(base, cookie); player.state = null;
    player.socket.on('stateUpdate', state => { player.state = state; }); sockets.push(player.socket); return player;
  }
  function event(socket, name) {
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Event timeout: ' + name)), 4000);
      socket.once(name, value => { clearTimeout(timer); resolve(value); }); });
  }
  async function create(config) {
    const response = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ config: JSON.stringify({ launchMode: 'scheduled', scheduledStartAt: new Date(Date.now() + 120000).toISOString(),
        maxPlayers: 6, startStack: 5000, ...config }) }) });
    assert.equal(response.status, 200); return response.json();
  }
  async function register(player, created) {
    let response = event(player.socket, 'scheduledLobbyState'); player.socket.emit('joinLobby', { code: created.code }); await response;
    response = event(player.socket, 'scheduledLobbyState'); player.socket.emit('registerTournament', { code: created.code }); await response;
    const claimed = event(player.socket, 'lobbyStart'); player.socket.emit('claimTournamentSeat', { code: created.code }); await claimed;
    player.socket.emit('joinRoom', { roomId: created.roomId });
    await until(() => player.state?.yourSeat >= 0, 'owner seat');
  }
  try {
    await until(async () => { try { return (await fetch(base + '/healthz')).ok; } catch (_) { return false; } }, 'test server');
    const created = await create({});
    const players = await Promise.all([client(), client(), client()]);
    for(const player of players) await register(player, created);
    let settings = event(players[0].socket, 'roomConfig'); players[0].socket.emit('joinRoom', { roomId: created.roomId });
    const config = await settings; assert.equal(config.afkAutoExclude, true); assert.equal(config.afkTimeoutMinutes, 20);
    await command(created.roomId, 'start');
    players[0].socket.disconnect();
    await until(async () => (await command(created.roomId, 'inspect')).afk.length === 1, 'disconnect starts AFK without skipped turns');
    const original = (await command(created.roomId, 'advance', { ms: 12 * 60000 })).afk[0];
    const returned = await client(players[0].cookie); returned.socket.emit('joinRoom', { roomId: created.roomId });
    await until(() => returned.state?.ownAfk, 'AFK on reconnect');
    assert.equal(returned.state.ownAfk.deadline, original[1].deadline);
    const oldTab = returned;
    const current = await client(players[0].cookie); current.socket.emit('joinRoom', { roomId: created.roomId });
    await until(() => current.state?.ownAfk, 'replacement owner');
    const observer = await client(); observer.socket.emit('joinRoom', { roomId: created.roomId });
    await until(() => observer.state, 'observer');
    observer.socket.emit('confirmAfkReturn', { playerId: original[0], deadline: 9999999999999 });
    oldTab.socket.emit('confirmAfkReturn'); await sleep(100);
    assert.equal((await command(created.roomId, 'inspect')).afk[0][1].deadline, original[1].deadline);
    current.socket.emit('confirmAfkReturn');
    await until(async () => (await command(created.roomId, 'inspect')).afk.length === 0, 'explicit current-owner confirmation');
    current.socket.disconnect();
    await until(async () => (await command(created.roomId, 'inspect')).afk.length === 1, 'second disconnect');
    const expired = await command(created.roomId, 'advance', { ms: 20 * 60000 });
    assert.equal(expired.players.find(player => player.playerId === original[0]).status, 'ELIMINATED');
    const eliminated = await client(players[0].cookie);
    settings = event(eliminated.socket, 'roomConfig'); eliminated.socket.emit('joinRoom', { roomId: created.roomId });
    assert.equal((await settings).participationStatus, 'ELIMINATED');
    await until(() => eliminated.state, 'eliminated spectator'); assert.equal(eliminated.state.yourSeat, -1);
    console.log('PASS  real Socket.IO AFK default, owner/observer/replaced-tab security, no reset on reload, terminal elimination');

    const folded = await create({ afkAutoExclude: false });
    const owners = await Promise.all([client(), client(), client()]);
    for(const owner of owners) await register(owner, folded);
    await command(folded.roomId, 'start'); await command(folded.roomId, 'hand');
    await until(() => owners.every(owner => owner.state?.phase === 'PREFLOP'), 'private hands');
    const folder = owners.find(owner => owner.state.yourSeat === owner.state.actingSeat);
    assert.ok(folder);
    const cards = folder.state.seats[folder.state.yourSeat].cards;
    folder.socket.emit('playerAction', { action: 'fold', amount: 0, commandId: 'folded-card-test-' + Date.now(), turnId: folder.state.turnId });
    await until(() => folder.state?.ownFoldedCards, 'confirmed fold');
    assert.deepEqual(folder.state.ownFoldedCards.cards, cards);
    for(const other of owners.filter(owner => owner !== folder)) {
      assert.equal(other.state.ownFoldedCards, null); assert.deepEqual(other.state.seats[folder.state.yourSeat].cards, []);
    }
    const viewer = await client(); viewer.socket.emit('joinRoom', { roomId: folded.roomId });
    await until(() => viewer.state, 'private fold observer'); assert.equal(viewer.state.ownFoldedCards, null);
    const restored = await client(folder.cookie); restored.socket.emit('joinRoom', { roomId: folded.roomId });
    await until(() => restored.state?.ownFoldedCards, 'private fold reconnect');
    assert.deepEqual(restored.state.ownFoldedCards.cards, cards);
    folder.socket.emit('joinRoom', { roomId: folded.roomId });
    await until(() => folder.state?.ownFoldedCards, 'owner reclaims seat');
    restored.state = null;
    restored.socket.emit('playerAction', { action: 'call', amount: 0, commandId: 'forged-test-command', turnId: folder.state.turnId });
    await sleep(100);
    const stillFolded = folder.state.seats[folder.state.yourSeat]; assert.equal(stillFolded.inHand, false);
    console.log('PASS  real private Fold state/reconnect; opponents and spectators never receive folded cards');
  } catch(error) { error.message += '\nIsolated server: ' + output; throw error; }
  finally {
    sockets.forEach(socket => socket.close());
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
