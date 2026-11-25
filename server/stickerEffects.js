'use strict';

const { randomInt, randomUUID } = require('node:crypto');

const SNOWBALL_DURATION_MS = 1800;
const START_DELAY_MS = 240;
const COOLDOWN_MS = 10_000;
const TARGET_COOLDOWN_MS = 4000;
const MAX_ACTIVE = 2;
const cooldowns = new Map();
const GLOBAL_PLAYER_COOLDOWN_MS = 120_000;
const GLOBAL_TABLE_COOLDOWN_MS = 180_000;
const SNOWSTORM_DURATION_MS = 40_000;
const globalCooldowns = new Map();
const CAT_THIEF_COOLDOWN_MS = 25_000;
const CAT_THIEF_DURATION_MS = 5_500;
const catThiefCooldowns = new Map();
const tables = new WeakMap();

function hold(map, key, now, duration) {
  const until = now + duration;
  map.set(key, until);
  setTimeout(() => {
    if (map.get(key) === until) map.delete(key);
  }, duration).unref();
}

function requestRocketEffect(room, socketId, targetPlayerId, effectId) {
  const sender = room.G.seats[room.sockets.get(socketId)];
  const target = room.G.seats.find(seat => seat?.publicPlayerId === targetPlayerId);
  // Let the rocket handler keep its existing validation and target-lock behavior.
  if (effectId === 'rocket_01' && !room.gameOver && sender?.connected &&
      target && target !== sender && (target.connected || target.isBot)) {
    const retryAfterMs = (cooldowns.get(sender.playerId) || 0) - Date.now();
    if (retryAfterMs > 0) return { ok: false, code: 'COOLDOWN', retryAfterMs };
  }
  const result = room.requestTableEffect(socketId, targetPlayerId, effectId);
  if (result.ok) {
    hold(cooldowns, sender.playerId, result.event.serverStartTime - result.event.startDelayMs, COOLDOWN_MS);
  }
  return result;
}

function requestStickerEffect(room, socketId, payload, now = Date.now()) {
  const { effectId, targetPlayerId } = payload;
  const targeted = effectId === 'snowball';
  if ((!targeted && effectId !== 'snowstorm' && effectId !== 'cat_thief') ||
      Object.keys(payload).some(key => key !== 'type' && key !== 'effectId' && (!targeted || key !== 'targetPlayerId')) || (targeted &&
      (typeof targetPlayerId !== 'string' || !targetPlayerId.length || targetPlayerId.length > 64))) {
    return { code: 'INVALID_EFFECT' };
  }

  const seatIdx = room.sockets.get(socketId);
  const sender = room.G.seats[seatIdx];
  if (!sender?.connected || !sender.playerId || !sender.publicPlayerId || room.gameOver) return { code: 'NOT_AVAILABLE' };
  if (effectId === 'snowstorm') return requestSnowstorm(room, sender, now);
  if (effectId === 'cat_thief') return requestCatThief(room, sender, now);
  const target = room.G.seats.find(seat => seat?.publicPlayerId === targetPlayerId);
  if (!target || (!target.connected && !target.isBot)) return { code: 'TARGET_GONE' };
  if (target === sender) return { code: 'SELF_TARGET' };

  const retryAfterMs = (cooldowns.get(sender.playerId) || 0) - now;
  if (retryAfterMs > 0) return { code: 'COOLDOWN', retryAfterMs };
  const table = tableEffects(room);
  if ((table.targets.get(target.publicPlayerId) || 0) > now) return { code: 'TARGET_BUSY' };
  table.active = table.active.filter(until => until > now);
  if (table.active.length >= MAX_ACTIVE) return { code: 'TABLE_BUSY' };

  hold(cooldowns, sender.playerId, now, COOLDOWN_MS);
  hold(table.targets, target.publicPlayerId, now, TARGET_COOLDOWN_MS);
  table.active.push(now + START_DELAY_MS + SNOWBALL_DURATION_MS);
  return { event: {
    type: 'effect', effectId, eventId: randomUUID(), tableId: room.id,
    fromPlayerId: sender.publicPlayerId, targetPlayerId: target.publicPlayerId,
    serverStartTime: now + START_DELAY_MS, startDelayMs: START_DELAY_MS,
    cooldownUntil: now + COOLDOWN_MS
  } };
}

function tableEffects(room) {
  if (!tables.has(room)) tables.set(room, { targets: new Map(), active: [], globalUntil: 0, globalEvent: null, catThiefEvent: null });
  return tables.get(room);
}

function requestCatThief(room, sender, now) {
  const playerRetry = (catThiefCooldowns.get(sender.playerId) || 0) - now;
  if (playerRetry > 0) return { code:'CAT_THIEF_COOLDOWN', retryAfterMs:playerRetry };
  const table = tableEffects(room);
  const tableRetry = (table.catThiefEvent?.serverEndTime || 0) - now;
  if (tableRetry > 0) return { code:'CAT_THIEF_ACTIVE', retryAfterMs:tableRetry };

  const occupied = room.G.seats.filter(seat => seat?.publicPlayerId && (seat.connected || seat.isBot));
  const target = occupied[randomInt(occupied.length)];
  hold(catThiefCooldowns, sender.playerId, now, CAT_THIEF_COOLDOWN_MS);
  const serverStartTime = now + START_DELAY_MS;
  const eventId = randomUUID();
  const side = Number.parseInt(eventId[0],16) % 2 ? 'left' : 'right';
  const event = {
    type:'effect', effectId:'cat_thief', eventId, tableId:room.id,
    fromPlayerId:sender.publicPlayerId, targetPlayerId:target.publicPlayerId, side, serverStartTime,
    durationMs:CAT_THIEF_DURATION_MS, serverEndTime:serverStartTime+CAT_THIEF_DURATION_MS, startDelayMs:START_DELAY_MS
  };
  table.catThiefEvent = event;
  return { event };
}

function activeCatThiefEffect(room, now = Date.now()) {
  const event = tables.get(room)?.catThiefEvent;
  return event && event.serverEndTime - now > 650 ? event : null;
}

function activeGlobalEffect(room, now = Date.now()) {
  const table = tables.get(room);
  if (!table?.globalEvent) return null;
  if (table.globalEvent.serverEndTime <= now) table.globalEvent = null;
  return table.globalEvent;
}

function requestSnowstorm(room, sender, now) {
  const table = tableEffects(room);
  const playerRetry = (globalCooldowns.get(sender.playerId) || 0) - now;
  const tableRetry = table.globalUntil - now;
  if (activeGlobalEffect(room, now)) return { code: 'GLOBAL_ACTIVE', retryAfterMs: tableRetry };
  if (playerRetry > 0 && playerRetry >= tableRetry) {
    return { code: 'GLOBAL_PLAYER_COOLDOWN', retryAfterMs: playerRetry };
  }
  if (tableRetry > 0) return { code: 'GLOBAL_TABLE_COOLDOWN', retryAfterMs: tableRetry };

  hold(globalCooldowns, sender.playerId, now, GLOBAL_PLAYER_COOLDOWN_MS);
  const serverStartTime = now + START_DELAY_MS;
  const serverEndTime = serverStartTime + SNOWSTORM_DURATION_MS;
  const event = {
    type: 'effect', effectId: 'snowstorm', eventId: randomUUID(), tableId: room.id,
    fromPlayerId: sender.publicPlayerId, serverStartTime, serverEndTime, durationMs: SNOWSTORM_DURATION_MS,
    startDelayMs: START_DELAY_MS
  };
  table.globalEvent = event;
  table.globalUntil = serverEndTime + GLOBAL_TABLE_COOLDOWN_MS;
  return { event };
}

module.exports = { activeCatThiefEffect, activeGlobalEffect, requestRocketEffect, requestStickerEffect };
