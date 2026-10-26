'use strict';

const crypto = require('node:crypto');

const TOKEN_VERSION = 'v1';
const DEFAULT_COOKIE = 'poker_player';
const DEFAULT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { cookies[key] = decodeURIComponent(value); }
    catch { cookies[key] = value; }
  }
  return cookies;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class PlayerIdentityService {
  constructor({ secret, cookieName = DEFAULT_COOKIE, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    if (!secret || Buffer.byteLength(String(secret), 'utf8') < 32) {
      throw new Error('PLAYER_SESSION_SECRET must contain at least 32 bytes');
    }
    this.secret = String(secret);
    this.cookieName = cookieName;
    this.maxAgeMs = maxAgeMs;
  }

  sign(playerId = crypto.randomUUID()) {
    const id = String(playerId);
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error('Invalid server player id');
    const payload = Buffer.from(id, 'utf8').toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret)
      .update(`${TOKEN_VERSION}.${payload}`)
      .digest('base64url');
    return `${TOKEN_VERSION}.${payload}.${signature}`;
  }

  verify(token) {
    const [version, payload, suppliedSignature, extra] = String(token || '').split('.');
    if (version !== TOKEN_VERSION || !payload || !suppliedSignature || extra !== undefined) return null;
    const expectedSignature = crypto.createHmac('sha256', this.secret)
      .update(`${version}.${payload}`)
      .digest('base64url');
    if (!safeEqual(suppliedSignature, expectedSignature)) return null;
    try {
      const playerId = Buffer.from(payload, 'base64url').toString('utf8');
      return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(playerId) ? playerId : null;
    } catch {
      return null;
    }
  }

  fromCookieHeader(header) {
    return this.verify(parseCookies(header)[this.cookieName]);
  }

  createSession() {
    const playerId = crypto.randomUUID();
    return { playerId, token: this.sign(playerId) };
  }

  serialize(token, { secure = false, clear = false } = {}) {
    const maxAge = clear ? 0 : Math.floor(this.maxAgeMs / 1000);
    const value = clear ? '' : encodeURIComponent(token);
    return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
}

function resolveRoomPlayerId(config, serverPlayerId, legacyPlayerId) {
  // Room version and browser payloads cannot establish seat ownership. Legacy
  // seats stay unclaimed unless their persisted owner already matches the
  // signed server identity; production migration is an explicit operator task.
  void config;
  void legacyPlayerId;
  return serverPlayerId || null;
}

module.exports = { PlayerIdentityService, parseCookies, resolveRoomPlayerId };
