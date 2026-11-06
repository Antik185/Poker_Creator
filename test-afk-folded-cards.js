'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-v25-'));
process.env.POKER_DB_PATH = path.join(dir, 'isolated.sqlite');
const db = require('./server/db');
const { PokerRoom } = require('./server/gameEngine');
const { TournamentManager } = require('./server/tournamentManager');
const { afkConfig } = require('./server/tournamentAfk');
const resources = [];
const pass = text => console.log('PASS  ' + text);
let guestNumber = 0;
function tournament(count = 4, overrides = {}, saved = null) {
  let now = saved?.now || Date.now();
  const id = saved?.id || randomUUID(), events = [], rooms = new Map();
  const config = { maxPlayers: 6, maxEntrants: 90, startStack: 5000, sb: 25, bb: 50,
    launchMode: 'scheduled', scheduledStartAt: new Date(Date.now() - 10000).toISOString(),
    afkAutoExclude: true, afkTimeoutMinutes: 20, ...overrides };
  if (!saved) db.saveRoom(id, 'AFK isolated test', config, null, null);
  const identities = saved?.identities || Array.from({ length: count }, (_, index) => {
    if (index > 1) return db.ensureGuestGameplayIdentity(randomUUID(), 'Guest' + String(++guestNumber).padStart(8, '0'));
    const userId = randomUUID(), name = 'Test' + userId.replace(/-/g, '').slice(0, 12);
    db.createUser({ id: userId, username: name, usernameNormalized: name.toLowerCase(),
      email: name + '@example.test', emailNormalized: name.toLowerCase() + '@example.test', passwordHash: 'test-only' });
    return db.getOrCreateAccountGameplayIdentity(userId);
  });
  if (!saved) for (const identity of identities) db.registerTournamentPlayer(id, identity.playerId, identity.name, 90, 5000, identity);
  const io = { sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
    to(room) { return { emit(name, payload) { events.push({ room, name, payload }); } }; } };
  const clock = { durationSec: 180, start() { return this.getState(); }, stop() {}, subscribe() { return () => {}; }, snapshot() { return {}; },
    getState() { return { level: 1, sb: 25, bb: 50, ante: 0, remainingMs: 999999 }; } };
  let manager;
  function roomFor(tableId, snapshot) {
    const room = new PokerRoom(tableId, config, io, { tournamentMode: true, tournamentClock: clock, snapshot,
      resolveElimination: event => manager.resolveElimination(event),
      onBetweenHands: table => manager.onTableBetweenHands(table),
      getTournamentMeta: () => manager.getMetaForTable(tableId), getTournamentPlayers: () => manager.getTournamentPlayers(),
      onPresenceChanged: (pid, online) => manager.playerPresenceChanged(pid, online),
      onManualAction: pid => manager.confirmAfkReturn(pid), getAfkState: pid => manager.getAfkState(pid),
      onPersist: state => db.saveTournamentTableState(id, tableId, 1, 'ACTIVE', state) });
    room.maybeStartHand = () => {};
    rooms.set(tableId, room);
    return room;
  }
  manager = new TournamentManager({ id, config, io, clock, now: () => now, randomInt: () => 0, snapshot: saved?.snapshot,
    createTable: ({ tableId }) => roomFor(tableId), closeTable: tableId => rooms.get(tableId)?.dispose(),
    saveState: (tid, state) => db.saveTournamentState(tid, state),
    assignPlayer: (...args) => db.markTournamentSeated(...args),
    markEliminated: (...args) => db.markTournamentEliminated(...args), markWinner: (...args) => db.markTournamentWinner(...args),
    isRegistrationClosed: () => false });
  if (saved) for (const [tableId, snapshot] of saved.rooms) manager.addRestoredTable({ tableId, tableNumber: 1, room: roomFor(tableId, snapshot) });
  const h = { id, manager, rooms, identities, events, now: () => now,
    advance(ms) { now += ms; manager.tickAfk(); },
    seat(index) { const p = manager.getPlayer(identities[index].playerId); return { p, room: rooms.get(p.tableId), seat: rooms.get(p.tableId)?.G.seats[p.seatIdx] }; },
    connect(index, sid = 'socket-' + index) { const { room } = h.seat(index); room.reconnectPlayer(identities[index].playerId, sid); room.broadcastState(); },
    offline(index) { const { room, seat } = h.seat(index); room.onDisconnect(seat.id); },
    start() { manager.start(db.listTournamentRegistrations(id), now); },
    addLate(identity = db.ensureGuestGameplayIdentity(randomUUID(), 'Guest' + String(++guestNumber).padStart(8, '0'))) {
      const registration = db.registerTournamentPlayer(id, identity.playerId, identity.name, 90, 5000, identity);
      identities.push(identity); manager.register(registration); manager.seatRegistration(registration);
      return identities.length - 1;
    },
    close() { for (const room of rooms.values()) room.dispose(); manager.dispose(); } };
  resources.push(h);
  return h;
}
try {
  assert.equal(afkConfig({ launchMode: 'scheduled' }).afkAutoExclude, false);
  assert.equal(afkConfig({ launchMode: 'instant', afkAutoExclude: true }).afkAutoExclude, false);
  assert.equal(afkConfig({ launchMode: 'scheduled', afkTimeoutMinutes: -1 }).afkTimeoutMinutes, 20);
  for (const minutes of [5, 10, 15, 20, 30]) assert.equal(afkConfig({ afkTimeoutMinutes: minutes }).afkTimeoutMinutes, minutes);
  const waiting = tournament(); waiting.manager.syncRegistrations(db.listTournamentRegistrations(waiting.id));
  waiting.advance(100 * 60000); assert.equal(waiting.manager.afk.size, 0);
  waiting.start(); assert.equal(waiting.manager.afk.size, 4);
  assert.ok([...waiting.manager.afk.values()].every(entry => entry.since === waiting.now()));
  waiting.close();
  for (const setting of [false, undefined]) {
    const h = tournament(3, { afkAutoExclude: setting }); h.start(); h.advance(31 * 60000);
    assert.equal(h.manager.activePlayers().length, 3); assert.equal(h.manager.afk.size, 0); h.close();
  }
  pass('legacy/disabled/instant compatibility, allowed limits, no AFK before actual MTT start');

  {
    const h=tournament(3,{afkTimeoutMinutes:5}); h.start(); h.connect(0); h.connect(2);
    h.advance(5*60000-1); assert.equal(h.manager.getPlayer(h.identities[1].playerId).status,'ACTIVE');
    h.advance(1); assert.equal(h.manager.getPlayer(h.identities[1].playerId).status,'ELIMINATED');
    assert.equal(h.manager.getPlayer(h.identities[1].playerId).eliminatedPlace,3); h.close();
  }
  pass('five-minute AFK limit uses authoritative time and the ordinary elimination path');

  {
    const h = tournament(3); h.start(); for(let i=0;i<3;i++) h.connect(i);
    const late = h.addLate(), pid = h.identities[late].playerId;
    h.advance(0); h.advance(30000); h.connect(late);
    assert.equal(h.seat(late).seat.connected, true);
    assert.equal(h.manager.getAfkState(pid), null, 'first late table entry is not a return from AFK');
    assert.equal(h.seat(late).room.sanitizedState(h.seat(late).p.seatIdx).ownAfk, null);
    h.offline(late); h.advance(12000);
    const deadline = h.manager.afk.get(pid).deadline;
    h.manager.register(db.getTournamentRegistration(h.id, pid)); h.connect(late, 'late-refresh');
    assert.equal(h.manager.afk.get(pid).deadline, deadline, 'repeat registration/reconnect does not reset real AFK');
    assert.equal(h.manager.confirmAfkReturn(pid), true); h.close();
  }
  pass('first late registration joins without AFK after slow loading; later disconnect retains the existing deadline');

  {
    const h = tournament(3); h.start(); for(let i=0;i<3;i++) h.connect(i);
    const userId = randomUUID(), name = 'Late' + userId.replace(/-/g, '').slice(0,12);
    db.createUser({ id:userId, username:name, usernameNormalized:name.toLowerCase(), email:name+'@example.test',
      emailNormalized:name.toLowerCase()+'@example.test', passwordHash:'test-only' });
    const late = h.addLate(db.getOrCreateAccountGameplayIdentity(userId)), pid = h.identities[late].playerId;
    h.advance(0); h.advance(30000);
    const saved = { id:h.id, identities:h.identities, now:h.now(), snapshot:db.getTournamentState(h.id),
      rooms:[...h.rooms].map(([tid,room])=>[tid,room.getSnapshot()]) };
    h.close();
    const restored = tournament(4, {}, saved); restored.start(); restored.connect(late);
    assert.equal(restored.manager.getAfkState(pid), null, 'first account entry stays first after server restart');
    restored.offline(late); restored.advance(10000); restored.connect(late);
    assert.ok(restored.manager.getAfkState(pid), 'the one-time initial entry allowance is consumed'); restored.close();
  }
  pass('first late account connection survives a saved SQLite snapshot without granting a reusable AFK reset');

  {
    const h = tournament(3,{afkTimeoutMinutes:5}); h.start(); for(let i=0;i<3;i++) h.connect(i);
    const late=h.addLate(), pid=h.identities[late].playerId;
    h.advance(0); h.advance(5*60000);
    assert.equal(h.manager.getPlayer(pid).status,'ELIMINATED','never connecting does not bypass the AFK limit'); h.close();
  }
  pass('an absent late registrant still expires normally instead of receiving unlimited AFK protection');

  {
    const h=tournament(3,{afkTimeoutMinutes:5}); h.start(); for(let i=0;i<3;i++) h.connect(i);
    const late=h.addLate(), pid=h.identities[late].playerId;
    h.manager.afk.get(pid).deadline=h.now();
    h.connect(late);
    assert.equal(h.manager.afk.has(pid),true,'first connection cannot cancel an expired deadline before the watchdog tick');
    h.advance(0); assert.equal(h.manager.getPlayer(pid).status,'ELIMINATED'); h.close();
  }
  pass('first late connection cannot undo expiry in the interval before the watchdog processes it');

  {
    const h = tournament(); h.start(); for (let i = 0; i < 4; i++) h.connect(i);
    assert.equal(h.manager.afk.size, 0);
    h.offline(1); const initial = { ...h.manager.afk.get(h.identities[1].playerId) };
    h.advance(2000); h.connect(1); assert.equal(h.manager.afk.size, 0, 'technical reconnect under grace');
    h.offline(1); h.advance(12 * 60000); h.connect(1);
    assert.equal(h.manager.afk.get(h.identities[1].playerId).since, h.now() - 12 * 60000);
    h.connect(1, 'new-tab'); h.advance(500);
    assert.ok(h.manager.afk.has(h.identities[1].playerId), 'refresh does not forgive accumulated AFK');
    h.seat(1).room.onDisconnect('socket-1');
    assert.equal(h.seat(1).seat.connected, true, 'old-tab disconnect cannot mark new owner offline');
    assert.equal(h.manager.confirmAfkReturn(h.identities[1].playerId), true);
    assert.equal(h.manager.afk.size, 0);
    h.offline(1); const repeated = h.manager.afk.get(h.identities[1].playerId);
    assert.equal(repeated.deadline, h.now() + 20 * 60000); assert.ok(repeated.since > initial.since);
    assert.equal(h.manager.confirmAfkReturn(h.identities[1].playerId), false, 'offline cannot acknowledge'); h.close();
  }
  pass('immediate disconnect timestamp, grace, refresh/tab replacement, explicit owner return and new deadline');

  {
    const h = tournament(); h.start(); h.connect(0);
    const offline = h.identities.slice(1).map(p => p.playerId).sort();
    h.advance(20 * 60000);
    assert.equal(h.manager.status, 'FINISHED');
    assert.equal(h.manager.afkRemovedChips, 15000); assert.equal(h.manager.getPlayer(h.identities[0].playerId).stack, 5000);
    assert.deepEqual(offline.map(pid => h.manager.getPlayer(pid).eliminatedPlace), [4, 3, 2]);
    assert.equal(db.listUserTournamentResults(h.identities[0].userId).items[0].finalPlace, 1);
    assert.equal(db.listUserTournamentResults(h.identities[1].userId).items[0].status, 'COMPLETED');
    assert.equal(db.listTournamentRegistrations(h.id).filter(row => row.status === 'WINNER').length, 1);
    const events = h.events.filter(event => event.name === 'tournament_finished').length;
    h.advance(3000000); assert.equal(h.events.filter(event => event.name === 'tournament_finished').length, events);
    assert.equal(h.manager.confirmAfkReturn(offline[0]), false); h.close();
  }
  pass('stable simultaneous AFK places 4/3/2, single winner, chips removed not awarded, account history and guests');

  {
    const h = tournament(3); h.start(); h.connect(0); h.connect(2);
    const old = h.manager.afk.get(h.identities[1].playerId).deadline;
    h.advance(11 * 60000);
    const saved = { id: h.id, identities: h.identities, now: h.now(), snapshot: db.getTournamentState(h.id),
      rooms: [...h.rooms].map(([tid, room]) => [tid, room.getSnapshot()]) };
    h.close();
    const restored = tournament(3, {}, saved); restored.start(); restored.connect(0); restored.connect(2);
    assert.equal(restored.manager.afk.get(restored.identities[1].playerId).deadline, old);
    restored.advance(9 * 60000);
    assert.equal(restored.manager.getPlayer(restored.identities[1].playerId).status, 'ELIMINATED');
    assert.equal(restored.manager.activePlayers().length, 2); restored.close();
  }
  pass('saved SQLite tournament snapshot preserves remaining AFK deadline across Node restart');

  {
    const h = tournament(3); h.start(); h.connect(0); h.connect(2);
    const { room } = h.seat(1); room.startHand(); room.clearTurnTimer();
    const before = JSON.stringify(room.G);
    h.advance(20 * 60000);
    assert.equal(JSON.stringify(room.G), before, 'expiry never removes active bets, blinds, cards or pots');
    assert.equal(h.manager.getPlayer(h.identities[1].playerId).status, 'ACTIVE');
    assert.equal(h.manager.getAfkState(h.identities[1].playerId).pending, true);
    h.connect(1);
    assert.equal(h.manager.confirmAfkReturn(h.identities[1].playerId), false, 'late reconnect cannot undo expiry');
    const expiredSeat = h.seat(1).p.seatIdx;
    room.G.actingSeat = expiredSeat;
    assert.equal(room.validateAction(expiredSeat, 'fold', 0, { fromClient: true }).reason, 'AFK_EXPIRED');
    room.G.phase = 'WAITING'; room.G.actingSeat = -1; room.G.pot = 0;
    room.G.seats.forEach(seat => { if(seat) seat.inHand = false; });
    h.manager.onTableBetweenHands(room.id);
    assert.equal(h.manager.getPlayer(h.identities[1].playerId).status, 'ELIMINATED'); h.close();
  }
  pass('active-hand expiry latches; client actions blocked; only safe between-hand elimination');

  {
    const h = tournament(3); h.start(); h.connect(0); h.connect(2);
    const { room } = h.seat(1); room.G.pot = 50;
    h.advance(20 * 60000);
    assert.equal(h.manager.getPlayer(h.identities[1].playerId).status, 'ACTIVE');
    assert.equal(room.G.pot, 50); assert.equal(h.manager.afkRemovedChips, 0);
    room.G.pot = 0; h.manager.tickAfk();
    assert.equal(h.manager.getPlayer(h.identities[1].playerId).status, 'ELIMINATED'); h.close();
  }
  pass('a residual pot prevents forfeiture without crashing or counting unremoved chips');

  {
    const h = tournament(3); h.start(); for(let i = 0; i < 3; i++) h.connect(i);
    const { room } = h.seat(0); room.startHand(); room.clearTurnTimer();
    let actor = room.G.actingSeat, playerId = room.G.seats[actor].playerId;
    h.manager.afk.set(playerId, { since: h.now() - 60000, deadline: h.now() + 60000 });
    room.doAction(actor, 'fold', 0); assert.ok(h.manager.afk.has(playerId), 'automatic action never confirms return');
    actor = room.G.actingSeat; playerId = room.G.seats[actor].playerId;
    h.manager.afk.set(playerId, { since: h.now() - 60000, deadline: h.now() + 60000 });
    room.doAction(actor, 'fold', 0, { fromClient: true, manual: true });
    assert.ok(!h.manager.afk.has(playerId), 'accepted manual action confirms owner participation'); h.close();
  }
  pass('server automatic Check/Fold does not reset AFK; validated manual Fold resets it');

  {
    const h = tournament(3); h.start(); h.connect(0); h.connect(1);
    const { room } = h.seat(2);
    const ordered = h.identities.map(identity => h.manager.getPlayer(identity.playerId).seatIdx);
    const contributions = [100, 300, 500], ranks = ['A', 'K', 'Q'];
    ordered.forEach((idx, i) => Object.assign(room.G.seats[idx], {
      cards: [{ v: ranks[i], s: '♠' }, { v: ranks[i], s: '♥' }],
      stack: i === 2 ? 2000 : 0, contributed: contributions[i], bet: contributions[i], inHand: true
    }));
    Object.assign(room.G, { phase: 'RIVER', handNum: 1, actingSeat: -1, pot: 900,
      board: [{ v: '2', s: '♣' }, { v: '3', s: '♦' }, { v: '7', s: '♥' }, { v: '9', s: '♠' }, { v: 'J', s: '♦' }] });
    let complete;
    room._schedule = fn => { complete = fn; };
    h.advance(20 * 60000); assert.equal(room.G.pot, 900);
    assert.equal(room.endHand(), true);
    assert.equal(room.G.seats[ordered[0]].stack, 300);
    assert.equal(room.G.seats[ordered[1]].stack, 400);
    assert.equal(room.G.seats[ordered[2]].stack, 2200, 'uncalled 200 returned before AFK forfeiture');
    const hand = h.events.find(event => event.name === 'handWinners').payload;
    assert.deepEqual(hand.pots.map(pot => pot.pot), [300, 400]);
    assert.deepEqual(hand.refunds.map(refund => refund.amount), [200]);
    room.startHand = () => {};
    complete();
    assert.equal(h.manager.afkRemovedChips, 2200);
    assert.equal(room.G.seats[ordered[0]].stack + room.G.seats[ordered[1]].stack, 700);
    assert.equal(h.manager.getPlayer(h.identities[2].playerId).eliminatedPlace, 3); h.close();
  }
  pass('real all-in side pots 300/400 and uncalled refund 200 settle before only remaining AFK stack is removed');

  {
    const h = tournament(8); h.start(); for(let i = 0; i < 8; i++) h.connect(i);
    const participant = h.identities[1].playerId;
    h.offline(1); h.advance(12 * 60000);
    const deadline = h.manager.afk.get(participant).deadline;
    const { room, p } = h.seat(1), target = h.manager.activeTables().find(table => table.id !== p.tableId);
    const exported = room.exportTournamentPlayer(participant);
    p.tableId = null; p.seatIdx = null;
    assert.ok(h.manager._seatPendingPlayer(p, target, target.room.G.seats.findIndex(seat => !seat)));
    h.connect(1, 'moved-owner');
    assert.equal(h.manager.afk.get(participant).deadline, deadline);
    assert.equal(h.manager.confirmAfkReturn(participant), true);
    assert.equal(h.manager.afk.has(participant), false);
    assert.equal(exported.player.stack, h.seat(1).seat.stack); h.close();
  }
  pass('AFK deadline belongs to participant, survives table move and device reconnect');

  for (const maxPlayers of [6, 9]) {
    const h = tournament(3, { maxPlayers }); h.start(); for(let i = 0; i < 3; i++) h.connect(i);
    const { room } = h.seat(0); room.startHand(); room.clearTurnTimer();
    const seatIdx = room.G.actingSeat, player = room.G.seats[seatIdx], cards = JSON.parse(JSON.stringify(player.cards));
    assert.equal(room.sanitizedState(seatIdx).ownFoldedCards, null);
    assert.equal(room.doAction(seatIdx, 'fold', 0), true);
    assert.deepEqual(player.cards, []); assert.equal(player.inHand, false);
    assert.deepEqual(room.sanitizedState(seatIdx).ownFoldedCards.cards, cards);
    for (const viewer of [-1, ...room.G.seats.map((_, idx) => idx).filter(idx => idx !== seatIdx)]) {
      const state = room.sanitizedState(viewer);
      assert.equal(state.ownFoldedCards, null); assert.deepEqual(state.seats[seatIdx].cards, []);
      assert.ok(!Object.hasOwn(state, 'privateFoldedHands'));
    }
    const snapshot = room.getSnapshot();
    const restored = new PokerRoom('restore', h.manager.config, { sockets: { adapter: { rooms: new Map() } } }, { snapshot });
    try {
      restored.reconnectPlayer(player.playerId, 'fresh-owner');
      assert.deepEqual(restored.sanitizedState(seatIdx).ownFoldedCards.cards, cards);
      const foreign = JSON.parse(JSON.stringify(snapshot)); foreign.game.seats[seatIdx].playerId = 'different-owner';
      const replaced = new PokerRoom('foreign', h.manager.config, { sockets: { adapter: { rooms: new Map() } } }, { snapshot: foreign });
      assert.equal(replaced.sanitizedState(seatIdx).ownFoldedCards, null); replaced.dispose();
      restored.G.phase = 'SHOWDOWN'; assert.equal(restored.sanitizedState(seatIdx).ownFoldedCards, null);
      restored.G.phase = 'WAITING'; restored.startHand(); assert.equal(restored.foldedHands.size, 0);
      assert.equal(restored.doAction(seatIdx, 'call', 0), false);
    } finally { restored.dispose(); }
    h.close();
  }
  pass('6/9-max folded cards only in owner state; spectators/reconnect/new owner/new hand/finished hand privacy');
} finally {
  resources.forEach(h => h.close()); db.close(); fs.rmSync(dir, { recursive: true, force: true });
}
