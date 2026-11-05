'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/poker.js', 'utf8');
const html = fs.readFileSync('public/poker.html', 'utf8');
const css = fs.readFileSync('public/poker.css', 'utf8');
const toggledClasses = {};
const elements = Object.fromEntries(['foldedCardsPanel', 'foldedCardsButton', 'afkNotice', 'afkReturnButton', 'afkNoticeText', 'actionControls']
  .map(id => [id, { hidden: true, textContent: '', attributes: {},
    style: {}, setAttribute(key, value) { this.attributes[key] = value; }, classList: { toggle(name,value) { toggledClasses[id+':'+name]=value; } } }]));
let now = 100000, timers = 0, layouts = 0, renderedCards = '';
const calls = [], G = { userSeat: 0, seats: [{ inHand: true }], handNum: 1, phase: 'PREFLOP' };
const context = { G, document: { getElementById: id => elements[id], querySelectorAll: () => [{ remove() { renderedCards = ''; } }] },
  Date: { now: () => now }, CFG: {}, _serverSeatConfirmed: true,
  _inMultiplayer: true, _eliminated: false, _sessionReplaced: false, _currentRoomId: 'table', _serverClockOffset: 0,
  socket: { connected: true, emit: (...args) => calls.push(args) }, _esc: value => String(value),
  cardColor: card => card.s === '♥' || card.s === '♦' ? 'r' : 'b', scheduleTableLayout: () => layouts++,
  renderTable: () => { context.renderParticipationPanel(); const cards = context.foldedCardsForSeat(0);
    renderedCards = cards ? context.faceUpSeatCards(cards, ['no-anim', 'no-anim'], true) : ''; },
  setInterval: () => ++timers, clearInterval: () => {} };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf("let _foldedPreviewKey='';"), source.indexOf('function renderActionBar(){')), context);
assert.equal(context.renderParticipationPanel(), false);
assert.equal(elements.foldedCardsPanel.hidden, true, 'no cards button before confirmed fold');
G.ownFoldedCards = { handNum: 1, cards: [{ v: 'A', s: '♠' }, { v: '10', s: '♥' }] };
context.toggleFoldedCards(); assert.equal(renderedCards, '', 'normal action availability excludes cards toggle');
G.seats[0].inHand = false;
assert.equal(context.renderParticipationPanel(), true);
assert.equal(toggledClasses['actionControls:folded-only'],true,'single-button panel shrinks after Fold');
assert.equal(context.foldedCardsForSeat(0), null);
context.toggleFoldedCards();
assert.match(renderedCards, /class="pk-cards folded-cards"/);
assert.match(renderedCards, /class="card-v-top">A</);
assert.match(renderedCards, /class="card-v-top">10</);
assert.match(renderedCards, /pk-card-r[\s\S]*class="card-v-top">10</, 'red suits retain the ordinary red card class');
assert.equal(context.foldedCardsForSeat(1), null, 'never render on another avatar');
assert.equal(elements.foldedCardsButton.attributes['aria-expanded'], 'true');
context.toggleFoldedCards(); assert.equal(renderedCards, '');
context.toggleFoldedCards(); G.handNum = 2; context.renderTable();
assert.equal(renderedCards, ''); assert.equal(elements.foldedCardsPanel.hidden, true);
G.handNum = 1; context.renderTable(); assert.equal(renderedCards, '', 'previous hand is not automatically reopened');
G.phase = 'SHOWDOWN'; context.renderTable(); assert.equal(elements.foldedCardsPanel.hidden, true);
G.phase = 'FLOP'; G.ownAfk = { since: 10000, deadline: now + 120000 };
context.renderParticipationPanel(); assert.match(elements.afkNoticeText.textContent, /2:00/);
assert.equal(toggledClasses['actionControls:folded-only'],false,'AFK warning retains space for its message');
assert.equal(calls.length, 0, 'never acknowledge on load/render');
context.confirmAfkReturn(); assert.deepEqual(calls, [['confirmAfkReturn']]);
assert.equal(timers, 1, 'repeated rendering reuses the live timer');
context._sessionReplaced = true; context.confirmAfkReturn(); assert.equal(calls.length, 1);
context.renderTable(); assert.equal(renderedCards, '');
context._sessionReplaced = false; G.ownAfk.pending = true;
context.renderParticipationPanel(); assert.equal(elements.afkReturnButton.hidden, true);
context.clearPrivateParticipation(); assert.equal(G.ownFoldedCards, null); assert.equal(renderedCards, '');
assert.ok(layouts > 0); assert.equal(timers, 2);
assert.match(css, /\.pk-cards\.folded-cards\{opacity:1!important;filter:brightness\(\.76\);\}/,
  'folded cards stay opaque and slightly dimmed without desaturating their suits');
assert.match(css, /#gameRoom #actionControls\.participation-only #actionBtnsGrp[^}]*display:none!important/);
assert.match(source, /if\(privateFoldedCards\) cardsHtml=faceUpSeatCards/);
assert.match(html, /id="foldedCardsButton"[^>]*>Сброшенные<br>карты<\/button>/);
assert.match(css, /#gameRoom #actionControls\.folded-only\{width:var\(--folded-button-width\)!important;/);
assert.match(css, /--folded-button-width:64px;--folded-button-height:42px;--folded-button-font:9px/);
assert.match(css, /--mobile-action-width:min\(192px,46vw\);\s*width:var\(--mobile-action-width\)/);
assert.match(css, /#gameRoom\.mobile-portrait #actionControls\.folded-only\.mobile-actions\{[^}]*right:calc\(max\(4px,env\(safe-area-inset-right\)\) \+ var\(--mobile-action-width\) - var\(--folded-button-width\) - 10px\)!important/);
for(const width of [320,360,375,390,430]) for(const safeRight of [0,14,24]){
  const fullWidth=Math.min(192,width*.46), compactWidth=64+10, margin=Math.max(4,safeRight);
  const originalLeft=width-margin-fullWidth;
  const foldedRight=margin+fullWidth-compactWidth;
  assert.ok(Math.abs(width-foldedRight-compactWidth-originalLeft)<1e-6,'mobile folded panel retains the original Fold anchor');
}
assert.doesNotMatch(html, /id="foldedCardsPreview"/);
assert.match(html, /id="cfgAfkAutoExclude"[^>]*checked/); assert.match(html, /value="20" selected/);
assert.match(html, /<option value="5">5 минут<\/option>/);
assert.doesNotMatch(source.slice(source.indexOf("let _foldedPreviewKey='';"), source.indexOf('function renderActionBar(){')),
  /localStorage|sessionStorage|indexedDB|fetch\(/);
console.log('PASS  confirmed Fold-only Cards button, private avatar toggle, shared card markup/font, AFK warning/return');

context.stopTimer=()=>{};
vm.runInContext(source.slice(source.indexOf('function renderActionBar(){'),source.indexOf('function syncBetVal(')),context);
G.ownAfk=null; G.userSeat=0; G.seats[0].inHand=true; G.phase='PREFLOP'; context._serverSeatConfirmed=true;
assert.equal(context.hasSeatControls(),true,'live owner can use controls after authoritative state');
for(const scenario of ['initial','eliminated','missing-seat','replaced','finished','spectator']){
  context._serverSeatConfirmed=scenario!=='initial';
  context._eliminated=scenario==='eliminated'; context._sessionReplaced=scenario==='replaced';
  context.CFG.tournamentStatus=scenario==='finished'?'FINISHED':'RUNNING';
  G.userSeat=scenario==='spectator'?-1:0; G.actingSeat=-1;
  G.seats[0]=scenario==='missing-seat'?null:{inHand:true,stack:5000};
  elements.actionControls.hidden=false; elements.actionControls.style.display='flex';
  context.renderActionBar();
  assert.equal(elements.actionControls.hidden,true,scenario+' cannot flash controls');
  assert.equal(elements.actionControls.style.display,'none');
}
assert.match(html, /id="actionControls" hidden/);
assert.match(css, /#gameRoom #actionControls\[hidden\]\{display:none!important/);
const autoSit=source.slice(source.indexOf('// Auto-sit if arriving'),source.indexOf("  } else {\n    goStep(1);",source.indexOf('// Auto-sit if arriving')));
assert.doesNotMatch(autoSit,/G\.userSeat\s*=/,'URL parameters must never assign client ownership');
assert.match(autoSit,/!_eliminated/);
const assignment=source.slice(source.indexOf('G.userSeat = Number.isInteger(serverG.yourSeat)'),source.indexOf('if(oldUserSeat<0',source.indexOf('G.userSeat = Number.isInteger(serverG.yourSeat)')));
G.seats=[{stack:5000}]; G.userSeat=0; context._eliminated=false; context._sessionReplaced=false;
context.serverG={yourSeat:-1}; vm.runInContext(assignment,context);
assert.equal(G.userSeat,-1,'authoritative spectator state clears an old seat');
assert.equal(context._serverSeatConfirmed,false);
console.log('PASS  first paint, reload/disconnect, eliminated/spectator/missing-seat controls stay hidden; server -1 revokes old ownership');
