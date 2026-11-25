'use strict';

const assert = require('node:assert/strict');
const { connectPlayer } = require('./test-player-session');
const { activeCatThiefEffect, activeGlobalEffect, requestStickerEffect } = require('./server/stickerEffects');

const base = process.env.BASE_URL;
assert.equal(base, 'http://127.0.0.1:3107', 'Run with the isolated npm test server');
const sockets = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, description) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`Timeout: ${description}`);
}

async function createRoom(config = {}) {
  const response = await fetch(base + '/api/rooms', {
    method: 'POST', body: new URLSearchParams({ config: JSON.stringify({ brand: 'STICKER_TEST', startStack: 5000, reactions: ['Clap'], ...config }) }),
    signal: AbortSignal.timeout(5000)
  });
  assert.equal(response.status, 200);
  return (await response.json()).roomId;
}

async function join(roomId, seatIdx, cookie) {
  const player = await connectPlayer(base, cookie);
  const { socket } = player;
  sockets.push(socket);
  player.reactions = [];
  socket.on('reaction', event => player.reactions.push(event));
  socket.on('roomConfig', config => { player.config = config; });
  socket.on('stateUpdate', state => { player.state = state; });
  socket.emit('joinRoom', { roomId });
  await until(() => player.state, 'initial state');
  if (seatIdx !== undefined && player.state.yourSeat < 0) socket.emit('sitAtTable', { seatIdx });
  if (seatIdx !== undefined) await until(() => player.state.yourSeat === seatIdx, 'seated player');
  return player;
}

function send(player, effectId, extra = {}) {
  return player.socket.timeout(3000).emitWithAck('reaction', { type: 'effect', effectId, ...extra });
}

function rocket(player, roomId, targetPlayerId, response) {
  return new Promise((resolve, reject) => {
    const receive = event => { clearTimeout(timer); resolve(event); };
    const timer = setTimeout(() => {
      player.socket.off(response, receive);
      reject(new Error(`Timeout: ${response}`));
    }, 3000);
    player.socket.once(response, receive);
    player.socket.emit('rocket_attack_request', { tableId: roomId, targetPlayerId, effectId: 'rocket_01' });
  });
}

function checkGlobalCooldownBoundaries() {
  const roomWith = id => ({
    id, sockets: new Map([['first',0],['second',1]]),
    G: { seats: [1,2].map(i => ({ playerId:`storm-unit-${i}`, publicPlayerId:`${id}-${i}`, connected:true })) }
  });
  const first = roomWith('first-table');
  const second = roomWith('second-table');
  const payload = { type:'effect', effectId:'snowstorm' };
  const now = 1_000_000;
  const {event} = requestStickerEffect(first, 'first', payload, now);
  assert.equal(event.serverStartTime, now + 240);
  assert.equal(event.durationMs, 40_000);
  assert.equal(event.serverEndTime, event.serverStartTime + event.durationMs);
  for(const elapsed of [20_000,36_000,39_999]) assert.deepEqual(activeGlobalEffect(first,event.serverStartTime+elapsed),event);
  assert.equal(activeGlobalEffect(second,event.serverStartTime+20_000),null);
  assert.deepEqual(requestStickerEffect(first,'second',payload,event.serverEndTime-1), {code:'GLOBAL_ACTIVE',retryAfterMs:180_001});
  assert.equal(activeGlobalEffect(first,event.serverEndTime),null);
  assert.deepEqual(requestStickerEffect(first,'second',payload,event.serverEndTime), {code:'GLOBAL_TABLE_COOLDOWN',retryAfterMs:180_000});
  assert.deepEqual(requestStickerEffect(first,'second',payload,event.serverEndTime+179_999), {code:'GLOBAL_TABLE_COOLDOWN',retryAfterMs:1});
  assert.deepEqual(requestStickerEffect(second, 'first', payload, now + 119_999), { code:'GLOBAL_PLAYER_COOLDOWN', retryAfterMs:1 });
  assert.equal(requestStickerEffect(second, 'first', payload, now + 120_000).event.tableId, second.id);
  assert.equal(requestStickerEffect(first,'second',payload,event.serverEndTime+180_000).event.tableId, first.id);
}

function checkCatThiefCooldownBoundaries() {
  const roomWith = id => ({ id, sockets:new Map([['first',0],['second',1]]),
    G:{seats:[1,2,3].map(i => ({playerId:`paw-unit-${i}`,publicPlayerId:`${id}-${i}`,connected:i!==3}))} });
  const first = roomWith('first-paw-table');
  const second = roomWith('second-paw-table');
  const payload = {type:'effect',effectId:'cat_thief'};
  const now = 1_000_000;
  const {event} = requestStickerEffect(first,'first',payload,now);
  assert.equal(event.serverStartTime,now+240);
  const end = event.serverStartTime+5500;
  assert.equal(event.serverEndTime,end);
  assert.equal(event.side, /[13579bdf]/.test(event.eventId[0]) ? 'left' : 'right');
  assert.ok([`${first.id}-1`,`${first.id}-2`].includes(event.targetPlayerId));
  assert.equal(activeCatThiefEffect(first,end-651),event);
  assert.equal(activeCatThiefEffect(first,end-650),null,'reconnect skips the very end of a scene');
  assert.equal(activeCatThiefEffect(second,end-651),null);
  assert.deepEqual(requestStickerEffect(first,'second',payload,end-1),{code:'CAT_THIEF_ACTIVE',retryAfterMs:1});
  assert.equal(requestStickerEffect(first,'second',payload,end).event.tableId,first.id);
  assert.deepEqual(requestStickerEffect(second,'first',payload,now+24_999),{code:'CAT_THIEF_COOLDOWN',retryAfterMs:1});
  assert.equal(requestStickerEffect(second,'first',payload,now+25_000).event.tableId,second.id);
}

(async () => {
  checkGlobalCooldownBoundaries();
  checkCatThiefCooldownBoundaries();
  const room = await createRoom();
  const alice = await join(room, 0);
  const bob = await join(room, 1);
  const carol = await join(room, 2);
  const dana = await join(room, 3);
  const observer = await join(room);
  const other = await join(await createRoom({ popcornEnabled: false }), 0);
  const otherViewer = await join(other.config.roomId);
  await until(() => alice.state.seats[3]?.playerId, 'public IDs');
  assert.equal(alice.config.popcornEnabled, true, 'built-in reaction enabled by default');
  assert.equal(other.config.popcornEnabled, false, 'room setting reaches the table');
  other.socket.emit('reaction', { type: 'popcorn' });
  const [aliceId, bobId, carolId, danaId] = alice.state.seats.map(seat => seat?.playerId);
  observer.socket.emit('reaction', { type: 'popcorn' });
  assert.equal((await send(bob, 'rocket_01')).code, 'INVALID_EFFECT');
  assert.equal((await send(bob, 'snowball')).code, 'INVALID_EFFECT');
  assert.equal((await send(bob, 'popcorn', { targetPlayerId: aliceId, serverStartTime: 0, fromPlayerId: aliceId })).code, 'INVALID_EFFECT');
  assert.equal((await send(bob, 'popcorn', { targetPlayerId: bobId })).code, 'INVALID_EFFECT');
  assert.equal((await send(alice, 'snowball', { targetPlayerId: aliceId })).code, 'SELF_TARGET');
  assert.equal((await send(alice, 'snowball', { targetPlayerId: other.state.seats[0].playerId })).code, 'TARGET_GONE');
  alice.socket.emit('reaction', null);
  const started = Date.now();
  assert.deepEqual(await send(alice, 'snowball', { targetPlayerId: bobId }), { ok: true });
  const viewers = [alice, bob, carol, dana, observer];
  await until(() => viewers.every(player => player.reactions.length === 1), 'snowball broadcast');
  const snow = alice.reactions[0];
  assert.equal(snow.effectId, 'snowball');
  assert.equal(snow.fromPlayerId, aliceId);
  assert.equal(snow.targetPlayerId, bobId);
  assert.ok(snow.eventId && snow.serverStartTime >= started && snow.cooldownUntil - snow.serverStartTime === 9760);
  for (const viewer of viewers) assert.deepEqual(viewer.reactions[0], snow);
  assert.equal(other.reactions.length, 0);

  assert.equal((await send(carol, 'snowball', { targetPlayerId: bobId })).code, 'TARGET_BUSY');
  alice.socket.emit('reaction', { type: 'popcorn' });
  alice.socket.emit('reaction', { type: 'popcorn' });
  await until(() => observer.reactions.some(event => event.type === 'popcorn'), 'popcorn immediately after snowball');
  assert.deepEqual(observer.reactions.filter(event => event.type === 'popcorn'), [{ type: 'popcorn', seatIdx: 0 }]);
  assert.equal(alice.reactions.length, 1, 'the sender renders locally like any emoji');
  assert.equal(otherViewer.reactions.length, 0, 'disabled popcorn is not broadcast');

  bob.socket.emit('reaction', { type: 'popcorn' });
  await until(() => observer.reactions.some(event => event.type === 'popcorn' && event.seatIdx === 1), 'second player popcorn');
  assert.equal((await rocket(bob, room, aliceId, 'rocket_attack_started')).fromPlayerId, bobId, 'popcorn does not block rocket');
  assert.deepEqual(await send(carol, 'snowball', { targetPlayerId: danaId }), { ok: true }, 'popcorn does not take a snowball slot');
  assert.equal((await send(dana, 'snowball', { targetPlayerId: aliceId })).code, 'TABLE_BUSY');
  const denied = await rocket(alice, room, danaId, 'rocket_attack_rejected');
  assert.equal(denied.code, 'COOLDOWN');
  assert.ok(denied.retryAfterMs > 5000 && denied.retryAfterMs <= 10_000);
  const launched = await rocket(dana, room, carolId, 'rocket_attack_started');
  assert.equal(launched.fromPlayerId, danaId);
  assert.equal((await send(dana, 'snowball', { targetPlayerId: aliceId })).code, 'COOLDOWN');
  dana.socket.emit('reaction', { type: 'popcorn' });
  await until(() => observer.reactions.some(event => event.type === 'popcorn' && event.seatIdx === 3), 'popcorn immediately after rocket');
  assert.equal(observer.reactions.filter(event => event.type === 'popcorn' && event.seatIdx === 0).length, 1, 'normal reaction anti-spam applies');

  alice.socket.disconnect();
  const returned = await join(room, 0, alice.cookie);
  assert.equal(returned.state.seats[0].playerId, aliceId);
  assert.equal((await send(returned, 'snowball', { targetPlayerId: bobId })).code, 'COOLDOWN');
  assert.equal(returned.reactions.length, 0, 'old effects are not replayed');
  carol.socket.emit('reaction', { type: 'emoji', content: 'Clap' });
  await until(() => returned.reactions.length === 1, 'legacy emoji after reconnect');
  assert.deepEqual(returned.reactions[0], { seatIdx: 2, content: 'Clap', type: 'emoji' });
  assert.equal(other.reactions.length, 0);

  await sleep(Math.max(0, snow.cooldownUntil + 50 - Date.now()));
  assert.deepEqual(await send(returned, 'snowball', { targetPlayerId: bobId }), { ok: true });
  await until(() => returned.reactions.length === 2 && bob.reactions.some(event => event.eventId === returned.reactions[1].eventId), 'new effect after reconnect');
  assert.equal(returned.reactions[1].fromPlayerId, aliceId);
  console.log('PASS  Snowball/Popcorn socket broadcast, shared rocket cooldown, payload validation, limits and reconnect');

  assert.equal((await send(observer, 'snowstorm')).code, 'NOT_AVAILABLE');
  assert.equal((await send(bob, 'snowstorm', { targetPlayerId:aliceId })).code, 'INVALID_EFFECT');
  assert.equal((await send(bob, 'snowstorm', { serverStartTime:1, cooldownUntil:0 })).code, 'INVALID_EFFECT');
  const clock = Date.now();
  assert.deepEqual(await send(returned, 'snowstorm'), { ok:true }, 'local cooldown does not block global effects');
  const storm = returned.reactions.find(event => event.effectId === 'snowstorm');
  assert.ok(storm?.eventId && storm.serverStartTime >= clock && storm.startDelayMs === 240);
  assert.equal(storm.durationMs,40_000);
  assert.equal(storm.serverEndTime,storm.serverStartTime+40_000);
  assert.equal(storm.fromPlayerId, aliceId);
  assert.equal(storm.tableId, room);
  assert.equal(storm.targetPlayerId, undefined);
  for (const player of [bob,carol,dana,observer]) {
    await until(() => player.reactions.some(event => event.eventId === storm.eventId), 'same-table storm');
    assert.deepEqual(player.reactions.find(event => event.eventId === storm.eventId), storm);
  }
  assert.equal(other.reactions.some(event => event.effectId === 'snowstorm'), false);
  assert.equal(otherViewer.reactions.some(event => event.effectId === 'snowstorm'), false);
  const tableBusy = await send(bob, 'snowstorm');
  assert.equal(tableBusy.code, 'GLOBAL_ACTIVE');
  assert.ok(tableBusy.retryAfterMs > 215_000 && tableBusy.retryAfterMs <= 220_240);
  const lateViewer = await join(room);
  await until(() => lateViewer.reactions.length === 1,'active storm snapshot for a late spectator');
  assert.deepEqual(lateViewer.reactions[0],storm);
  assert.deepEqual(await send(other, 'snowstorm'), { ok:true }, 'the other table is not on cooldown');
  await until(() => otherViewer.reactions.some(event => event.effectId === 'snowstorm'), 'other table receives its own storm');
  assert.equal(observer.reactions.filter(event => event.effectId === 'snowstorm').length, 1);
  returned.socket.disconnect();
  const stormReconnect = await join(room, 0, returned.cookie);
  await until(() => stormReconnect.reactions.length === 1,'reconnect active storm snapshot');
  assert.deepEqual(stormReconnect.reactions[0],storm);
  const playerBusy = await send(stormReconnect, 'snowstorm');
  assert.equal(playerBusy.code,'GLOBAL_ACTIVE');
  const secondTab = await join(room,0,returned.cookie);
  assert.equal((await send(secondTab,'snowstorm')).code,'GLOBAL_ACTIVE');
  console.log('PASS  Snowstorm 40-second snapshots, authoritative timing, isolated tables and 180-second post-event cooldown');

  assert.equal((await send(observer,'cat_thief')).code,'NOT_AVAILABLE');
  assert.equal((await send(bob,'cat_thief',{targetPlayerId:aliceId})).code,'INVALID_EFFECT');
  assert.equal((await send(bob,'cat_thief',{serverStartTime:1})).code,'INVALID_EFFECT');
  assert.equal((await send(bob,'cat_thief',{side:'left',x:1})).code,'INVALID_EFFECT');
  const before = secondTab.state;
  assert.deepEqual(await send(secondTab,'cat_thief'),{ok:true},'separate from Snowstorm and targeted effects');
  const thief = secondTab.reactions.find(event => event.effectId === 'cat_thief');
  assert.ok(thief?.eventId && thief.startDelayMs === 240);
  assert.equal(thief.durationMs,5500);
  assert.equal(thief.serverEndTime,thief.serverStartTime+5500);
  assert.equal(thief.fromPlayerId,aliceId);
  assert.equal(thief.tableId,room);
  assert.ok([aliceId,bobId,carolId,danaId].includes(thief.targetPlayerId),'the server picks an occupied seat in this table');
  for(const player of [bob,observer,lateViewer]){
    await until(() => player.reactions.some(event => event.eventId === thief.eventId),'same-table Cat Thief');
    assert.deepEqual(player.reactions.find(event => event.eventId === thief.eventId),thief);
  }
  assert.equal(otherViewer.reactions.some(event => event.effectId === 'cat_thief'),false);
  assert.deepEqual(await send(other,'cat_thief'),{ok:true},'another table can play its own effect');
  assert.equal(other.reactions.find(event => event.effectId === 'cat_thief').targetPlayerId,other.state.seats[0].playerId,
    'a single occupied seat is a valid target');
  const locked = await send(bob,'cat_thief');
  assert.equal(locked.code,'CAT_THIEF_ACTIVE');
  assert.ok(locked.retryAfterMs > 0 && locked.retryAfterMs <= 5740);
  assert.equal((await send(secondTab,'cat_thief')).code,'CAT_THIEF_COOLDOWN');
  assert.equal(secondTab.state,before,'launch does not emit a game state update');
  secondTab.socket.disconnect();
  const thiefReconnect = await join(room,0,returned.cookie);
  await until(() => thiefReconnect.reactions.some(event => event.eventId === thief.eventId),'active Cat Thief snapshot after reconnect');
  assert.deepEqual(thiefReconnect.reactions.find(event => event.eventId === thief.eventId),thief);
  assert.equal((await send(thiefReconnect,'cat_thief')).code,'CAT_THIEF_COOLDOWN');
  console.log('PASS  Cat Thief table broadcast, cosmetic-only event, one active scene and independent 25-second player cooldown');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const socket of sockets) socket.close();
});
