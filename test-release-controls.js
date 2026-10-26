'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const client = fs.readFileSync(path.join(__dirname, 'public', 'poker.js'), 'utf8');
const lobby = fs.readFileSync(path.join(__dirname, 'public', 'lobby.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server', 'index.js'), 'utf8');
const actionBar = client.slice(
  client.indexOf('function renderActionBar()'),
  client.indexOf('function syncBetVal()')
);

assert.match(actionBar, /const suggested=G\.currentBet>0 \? G\.currentBet\*3 : G\.pot;/,
  'new turns default to a pot bet or a 3x raise');
assert.match(actionBar, /const canRaise = canSeatRaise\(G\.userSeat\)/,
  'the action bar uses the complete raise eligibility check');
assert.match(actionBar, /btnRaise\.style\.display=canRaise\?'':'none'/,
  'an unavailable raise is removed from the action bar');
assert.match(actionBar, /betRow\.style\.display=canRaise\?'flex':'none'/,
  'raise sizing controls are hidden with an unavailable raise');

const staleAmountBlocks = [...actionBar.matchAll(/if \(lastCall !== -1 && lastCall !== toCall\) \{([\s\S]*?)\n\s*\}/g)];
assert.equal(staleAmountBlocks.length, 2, 'both pre-action stale amount paths are covered');
for (const [, body] of staleAmountBlocks) {
  assert.match(body, /chkPre2\.checked = false/, 'a fixed call amount is cleared after a raise');
  assert.doesNotMatch(body, /chkPre1/, 'check/fold survives a changed call amount');
}

assert.match(client, /tournament_table_expired[\s\S]*goToTournamentLobby\(lobbyCode\)/,
  'expired tournament tables return clients to their tournament lobby');
assert.match(client, /В лобби турнира/,
  'finished tournament overlay links to the matching tournament lobby');
assert.match(client, /function goToTournamentLobby\(lobbyCode=CFG\.lobbyCode\)/,
  'tournament navigation uses the server-provided lobby code');
assert.doesNotMatch(lobby, /Посмотреть итоговый стол/,
  'finished lobby does not offer an empty final table');
assert.match(lobby, /if\(scheduledState\?\.status === 'finished'\) return/,
  'client blocks stale spectate actions for a finished tournament');
assert.match(lobby, /\.registered-list[^}]*scrollbar-color:#6c6049 #171d27/,
  'participant list uses a scoped dark-gold scrollbar');
assert.match(server, /persistedTournament\?\.status === 'FINISHED'/,
  'finished tournament status is restored from SQLite snapshots');
assert.match(server, /socket\.emit\('tournament_table_finished'/,
  'server rejects old finished table URLs with a terminal payload');
assert.match(server, /replace\(\/--table-\\d\+\$\/, ''\)/,
  'server resolves stale secondary table URLs back to the tournament root');
assert.match(server, /FINISHED_TOURNAMENT_CLEANUP_MS = 2 \* 60 \* 1000/,
  'finished tournament tables have a two-minute lifetime');
assert.match(server, /client\?\.emit\('tournament_table_expired'/,
  'remaining clients are notified before a finished table is disposed');
assert.match(server, /room\.validateAction\(seatIdx, action, amount, \{ commandId, turnId \}\)/,
  'the socket layer validates every action before applying it');
assert.match(server, /if \(!actionStatus\.ok\)[\s\S]*reason: actionStatus\.reason/,
  'the client receives the authoritative rejection reason instead of a coerced action');

console.log('PASS  release controls, pre-actions and tournament table lifecycle');
