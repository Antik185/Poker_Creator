'use strict';

const fs = require('node:fs');
const path = require('node:path');

const client = fs.readFileSync(path.join(__dirname, 'public', 'poker.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'poker.html'), 'utf8');
const lobby = fs.readFileSync(path.join(__dirname, 'public', 'lobby.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server', 'index.js'), 'utf8');
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
}

check('tournament room config includes its public lobby code',
  /lobbyCode: manager \? dbRoom\?\.code \|\| null : null/.test(server));
check('table close returns to the same tournament lobby',
  /CFG\.tournamentMode && CFG\.lobbyCode[\s\S]*\/lobby\/\$\{encodeURIComponent\(CFG\.lobbyCode\)\}/.test(client));
check('elimination and game-over buttons use the shared close route',
  (client.match(/onclick="closeRoom\(\)"/g) || []).length >= 2);
check('chat place comes from the authoritative tournament participant',
  /participant\?\.status === 'ELIMINATED'[\s\S]*participant\.eliminatedPlace/.test(server));
check('chat renders a terminal tournament place',
  /message\.tournamentPlace[\s\S]*· #/.test(client));
check('spectators can switch the whole table between money and BB',
  /id="chipDisplayToggle"[\s\S]*toggleChipDisplayMode/.test(html)
    && /<div class="pk-chips \$\{stackClass\}" role="button"/.test(client));
check('winner identity survives a refresh in finished view',
  /participationStatus === 'WINNER'[\s\S]*_wonTournament = participationStatus === 'WINNER'/.test(client));
check('finished lobby sorts final places and labels the winner',
  /aPlace - bPlace/.test(lobby) && /ПОБЕДИТЕЛЬ · 1 МЕСТО/.test(lobby));

const failed = checks.filter(check => !check.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} passed ===`);
process.exit(failed.length ? 1 : 0);
