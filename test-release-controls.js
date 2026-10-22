'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = fs.readFileSync(path.join(__dirname, 'public', 'poker.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server', 'index.js'), 'utf8');
const actionBar = client.slice(
  client.indexOf('function renderActionBar()'),
  client.indexOf('function syncBetVal()')
);

assert.match(actionBar, /const suggested=G\.currentBet>0 \? G\.currentBet\*3 : G\.pot;/,
  'new turns default to a pot bet or a 3x raise');

const staleAmountBlocks = [...actionBar.matchAll(/if \(lastCall !== -1 && lastCall !== toCall\) \{([\s\S]*?)\n\s*\}/g)];
assert.equal(staleAmountBlocks.length, 2, 'both pre-action stale amount paths are covered');
for (const [, body] of staleAmountBlocks) {
  assert.match(body, /chkPre2\.checked = false/, 'a fixed call amount is cleared after a raise');
  assert.doesNotMatch(body, /chkPre1/, 'check/fold survives a changed call amount');
}

assert.match(client, /tournament_table_expired[\s\S]*window\.location\.href='\/'/,
  'expired tournament tables return clients to the home page');
assert.doesNotMatch(client, /В лобби турнира/,
  'finished tournament overlay no longer links back to a closed lobby');
assert.match(server, /FINISHED_TOURNAMENT_CLEANUP_MS = 2 \* 60 \* 1000/,
  'finished tournament tables have a two-minute lifetime');
assert.match(server, /client\?\.emit\('tournament_table_expired'/,
  'remaining clients are notified before a finished table is disposed');

console.log('PASS  release controls, pre-actions and tournament table lifecycle');
