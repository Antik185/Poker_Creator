'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const workerSource = fs.readFileSync(path.join(root, 'public/equity-worker.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'public/poker.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/poker.html'), 'utf8');

let response = null;
const sandbox = {
  Math,
  Object,
  Array,
  Set,
  Number,
  String,
  self: { postMessage: message => { response = message; } }
};
vm.runInNewContext(workerSource, sandbox, { filename: 'equity-worker.js' });

const startedAt = performance.now();
sandbox.self.onmessage({ data: {
  requestId: 7,
  fingerprint: 'known-river',
  players: [
    { seatIdx: 0, cards: [{ v: 'A', s: '♠' }, { v: 'A', s: '♥' }] },
    { seatIdx: 4, cards: [{ v: 'K', s: '♠' }, { v: 'K', s: '♥' }] }
  ],
  board: [
    { v: '2', s: '♣' }, { v: '3', s: '♦' }, { v: '4', s: '♣' },
    { v: '5', s: '♦' }, { v: '9', s: '♣' }
  ]
} });
const elapsedMs = performance.now() - startedAt;

assert.equal(response.requestId, 7);
assert.equal(response.fingerprint, 'known-river');
assert.equal(response.error, undefined);
assert.equal(response.equity[0].pct, 100);
assert.equal(response.equity[4].pct, 0);
assert.equal(response.equity[0].isLeader, true);

response = null;
sandbox.self.onmessage({ data: {
  requestId: 8,
  fingerprint: 'split-board',
  players: [
    { seatIdx: 1, cards: [{ v: '2', s: '♣' }, { v: '3', s: '♣' }] },
    { seatIdx: 2, cards: [{ v: '4', s: '♦' }, { v: '5', s: '♦' }] }
  ],
  board: [
    { v: '10', s: '♠' }, { v: 'J', s: '♠' }, { v: 'Q', s: '♠' },
    { v: 'K', s: '♠' }, { v: 'A', s: '♠' }
  ]
} });
assert.equal(response.equity[1].pct, 50);
assert.equal(response.equity[2].pct, 50);

assert.match(clientSource, /new Worker\('\/equity-worker\.js/);
assert.match(clientSource, /window\.__POKER_PERF__/);
assert.match(clientSource, /const _seatRenderCache = new Map\(\)/);
assert.match(html, /id="reactionEffectsLayer"/);
assert.match(html, /poker\.js\?v=20261023b/);

console.log(`PASS  client worker, incremental seats and isolated effects (${elapsedMs.toFixed(2)} ms known river)`);
