'use strict';

const assert = require('node:assert/strict');
const { PlayerIdentityService, parseCookies, resolveRoomPlayerId } = require('./server/playerIdentity');

const service = new PlayerIdentityService({ secret: 'identity-unit-test-secret-at-least-32-bytes' });
const session = service.createSession();

assert.equal(service.verify(session.token), session.playerId, 'signed token verifies');
assert.equal(service.verify(`${session.token.slice(0, -1)}x`), null, 'tampered token is rejected');
assert.equal(service.fromCookieHeader(`other=x; poker_player=${encodeURIComponent(session.token)}`), session.playerId,
  'identity is read from an HttpOnly cookie header');
assert.equal(parseCookies('a=1; b=hello%20world').b, 'hello world', 'cookie parser decodes values');
assert.equal(resolveRoomPlayerId({ identityVersion: 2 }, session.playerId, 'attacker-id'), session.playerId,
  'v2 rooms ignore a claimed browser playerId');
assert.equal(resolveRoomPlayerId({ identityVersion: 1 }, session.playerId, 'legacy-player'), session.playerId,
  'legacy rooms reject browser-controlled reconnect identifiers');
assert.equal(resolveRoomPlayerId({ identityVersion: 1 }, null, 'legacy-player'), null,
  'legacy claims are unusable without a server identity');
const victim = service.createSession();
const attacker = service.createSession();
assert.equal(resolveRoomPlayerId({ identityVersion: 1 }, attacker.playerId, victim.playerId), attacker.playerId,
  'a stolen public or legacy id cannot replace the attacker server identity');
assert.equal(resolveRoomPlayerId({ identityVersion: 2 }, victim.playerId, attacker.playerId), victim.playerId,
  'two tabs with the same signed session resolve to the same owner');
assert.match(service.serialize(session.token, { secure: true }), /HttpOnly; SameSite=Lax;.*; Secure$/,
  'production cookie supports Secure and HttpOnly attributes');

console.log('PASS  signed server player identity');
