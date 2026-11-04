'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/poker.js', 'utf8');
const first = source.indexOf('function _tournamentStartCountdownText(');
const last = source.indexOf('\nsetInterval(', first);
assert.ok(first >= 0 && last > first);
const start = Date.parse('2026-11-05T18:00:00Z');
const config = { launchMode: 'scheduled', scheduledStartAt: new Date(start).toISOString(), tournamentStatus: 'REGISTERING' };
const game = { phase: 'WAITING', handNum: 0, userSeat: 2, seats: [null, null, { name: 'Guest12345678' }] };
const value = { textContent: '' }, panel = { hidden: true, querySelector: () => value };
let localNow = start - 240_000;
const context = { CFG: config, G: game, _serverClockOffset: 0, Date: { parse: Date.parse, now: () => localNow },
  document: { getElementById: () => panel } };
vm.createContext(context);
vm.runInContext(source.slice(first, last), context);
const text = (remaining, cfg = config, state = game) => context._tournamentStartCountdownText(cfg, state, start - remaining);
for (const [remaining, expected] of [[300001, ''], [300000, '5:00'], [299001, '5:00'], [299000, '4:59'], [61000, '1:01'], [1000, '0:01'], [1, '0:01'], [0, ''], [-1000, '']]) {
  assert.equal(text(remaining), expected);
}
for (const state of [{ ...game, userSeat: -1 }, { ...game, seats: [] }, { ...game, handNum: 1 },
  { ...game, phase: 'PREFLOP' }, { ...game, gameOver: true }]) assert.equal(text(120000, config, state), '');
for (const cfg of [{ ...config, launchMode: 'instant' }, { ...config, tournamentStatus: 'RUNNING' },
  { ...config, tournamentStatus: 'FINISHED' }, { ...config, scheduledStartAt: 'invalid' }]) assert.equal(text(120000, cfg), '');
const before = JSON.stringify({ config, game });
for (const skew of [-3_600_000, 0, 3_600_000]) {
  localNow = start - 240_000 + skew; context._serverClockOffset = -skew;
  context.renderTournamentStartCountdown(); assert.equal(panel.hidden, false); assert.equal(value.textContent, '4:00');
  // A resumed page calculates from the current server-aligned clock, not missed interval ticks.
  localNow += 90_000; context.renderTournamentStartCountdown(); assert.equal(value.textContent, '2:30');
  localNow += 150_000; context.renderTournamentStartCountdown(); assert.equal(panel.hidden, true);
}
assert.equal(JSON.stringify({ config, game }), before);
game.userSeat = -1; context.renderTournamentStartCountdown(); assert.equal(panel.hidden, true);
game.userSeat = 2; localNow = start - 200_000; context._serverClockOffset = 0;
context.renderTournamentStartCountdown(); assert.equal(value.textContent, '3:20'); assert.equal(panel.hidden, false);
context.document.getElementById = () => null;
assert.doesNotThrow(() => context.renderTournamentStartCountdown());
const html = fs.readFileSync('public/poker.html', 'utf8'), css = fs.readFileSync('public/poker.css', 'utf8');
assert.match(html, /id="tournamentStartCountdown"[^>]*role="timer"[^>]*hidden/);
assert.match(css, /\.tournament-start-countdown\{[^}]*position:absolute;[^}]*left:50%;top:50%/);
assert.match(css, /\.tournament-start-countdown\[hidden\]\{display:none/);
assert.match(source, /else \{ recoverVisibleGameState\(\); renderTournamentStartCountdown\(\); \}/);
console.log('PASS  seated scheduled-start countdown: five-minute window, server clock skew, resume/reconnect, start/finished/instant guards and unchanged data');
