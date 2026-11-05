'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.dataset = {}; this.disabled = false; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  fire(type, event = {}) { if (!this.disabled) for (const handler of this.events[type] || []) handler(event); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { document.activeElement = this; }
}
const elements = Object.fromEntries(['tournamentList', 'tournamentsMessage', 'refreshTournaments', 'tournamentPanel',
  'tournamentsActiveTab', 'tournamentsFinishedTab'].map(id => [id, Object.assign(new Element(), { id })]));
const document = new Element(); document.body = { dataset: { page: 'tournaments' } }; document.hidden = false;
document.getElementById = id => elements[id]; document.createElement = tag => new Element(tag);
const window = new Element();
const requests = [];
let now = Date.now();
let chosen = 0;
const visits = [];
let reloads = 0;
const socket = new Element(); socket.once = socket.addEventListener; socket.on = socket.addEventListener;
socket.emitted = []; socket.emit = (...args) => socket.emitted.push(args);
socket.connect = () => socket.fire('connect'); socket.disconnect = () => { socket.disconnected = true; };
window.io = () => socket;
window.AntikGameEntry = { ensure: async () => { chosen++; } };
window.AntikApi = { request: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) };
const location = { assign: url => visits.push(url), reload: () => { reloads++; } };
class Clock extends Date { static now() { return now; } }
const context = { window, document, location, Intl, Date: Clock, JSON, Error, setTimeout, clearTimeout,
  setInterval: () => { throw Error('Catalog must not schedule background refresh'); }, clearInterval: () => {} };
const item = { id: 'real-id', code: 'ABCD', title: '<img onerror="bad">', description: 'Real server description', status: 'scheduled',
  startAt: now + 60000, registeredCount: 2, maxEntrants: 90, registrationOpen: true, canRegister: true, registered: false,
  hasBackgroundPreview: true, previewUrl: '/api/tournaments/real-id/preview?v=abc123', lobbyUrl: '/lobby/ABCD' };
const finished = { ...item, status: 'finished', finishedAt: now, canRegister: true, registrationOpen: true };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const content = () => elements.tournamentList.children[0].children.find(n => n.className === 'tournament-card-content');
const banner = () => elements.tournamentList.children[0].children.find(n => n.className === 'tournament-card-banner');
const actions = () => content().children.find(n => n.className === 'tournament-actions');
const activeTab = elements.tournamentsActiveTab, finishedTab = elements.tournamentsFinishedTab;
const reply = async items => { requests.at(-1).resolve({ items }); await flush(); };

(async () => {
  const template = fs.readFileSync('public/site/pages/tournaments.html', 'utf8');
  assert.match(template, /role="tablist"/); assert.match(template, /role="tabpanel"/);
  vm.runInNewContext(fs.readFileSync('public/site/js/tournaments.js', 'utf8'), context);
  assert.equal(requests[0].url, '/api/tournaments?status=active');
  await reply([item, finished]);
  assert.equal(elements.tournamentList.children.length, 1);
  assert.equal(banner().children.find(n => n.tag === 'h2').textContent, item.title);
  assert.equal(content().children.some(n => n.tag === 'h2'),false);
  const card = elements.tournamentList.children[0];
  const image = banner().children.find(n=>n.tag==='img');
  assert.equal(image.loading, 'lazy'); assert.equal(image.decoding, 'async'); assert.equal(image.src, item.previewUrl);
  assert.equal(image.attributes['aria-hidden'], 'true');
  assert.equal(banner().dataset.background,'brand');image.fire('load');assert.equal(banner().dataset.background,'image');
  image.fire('error'); assert.equal(image.hidden, true);assert.equal(banner().dataset.background,'brand');
  assert.equal(image.src,item.previewUrl);
  elements.refreshTournaments.fire('click'); requests.at(-1).reject(Error('offline')); await flush();
  assert.equal(elements.tournamentList.children[0], card); assert.match(elements.tournamentsMessage.textContent, /offline/);
  document.hidden = true; const before = requests.length; elements.refreshTournaments.fire('click'); assert.equal(requests.length, before);
  document.hidden = false;
  document.fire('visibilitychange'); window.fire('online'); window.fire('pageshow', { persisted: true });
  assert.equal(requests.length, before); assert.equal(reloads, 0);
  elements.refreshTournaments.fire('click'); await reply([{ ...item, status: 'running', registeredCount: 3 }]);
  assert.equal(elements.tournamentList.children[0].dataset.status, 'running');
  assert.equal(elements.tournamentsMessage.textContent, '');
  console.log('PASS  manual refresh, no polling/focus/online/bfcache reload, safe text, thumbnail fallback and network error preservation');

  finishedTab.fire('click'); assert.equal(requests.at(-1).url, '/api/tournaments?status=finished');
  assert.equal(elements.tournamentList.children.length, 0); await reply([finished, item]);
  assert.equal(elements.tournamentList.children.length, 1);
  assert.equal(actions().children.some(n => n.tag === 'button'), false);
  assert.equal(elements.tournamentPanel.attributes['aria-labelledby'], finishedTab.id);
  assert.equal(finishedTab.attributes['aria-selected'], 'true');
  assert.ok(content().children.find(n => n.className === 'tournament-meta').children.some(n => n.children[0].textContent === 'Завершение'));
  const archiveCard = elements.tournamentList.children[0], archiveCount = requests.length;
  now += 24 * 60 * 60000;
  document.fire('visibilitychange'); window.fire('online'); window.fire('pageshow', { persisted: true });
  assert.equal(requests.length, archiveCount);
  elements.refreshTournaments.fire('click'); requests.at(-1).reject(Error('archive offline')); await flush();
  assert.equal(elements.tournamentList.children[0], archiveCard);
  window.fire('online'); assert.equal(requests.length, archiveCount + 1);
  console.log('PASS  archive only refreshes on selection/button, keeps completion time and errors, and never allows finished registration');

  let prevented = false;
  finishedTab.fire('keydown', { key: 'Home', preventDefault() { prevented = true; } });
  assert.equal(document.activeElement, activeTab); assert.equal(prevented, true);
  assert.equal(elements.tournamentList.children[0].textContent,
    'Пока нет активных турниров. Новые турниры появятся здесь, когда организаторы их создадут.');
  const oldActive = requests.at(-1);
  activeTab.fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(document.activeElement, finishedTab);
  assert.equal(elements.tournamentList.children[0].dataset.status, 'finished');
  await reply([finished]); oldActive.resolve({ items: [item] }); await flush();
  assert.equal(elements.tournamentList.children[0].dataset.status, 'finished');
  finishedTab.fire('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.equal(elements.tournamentList.children[0].textContent,
    'Пока нет активных турниров. Новые турниры появятся здесь, когда организаторы их создадут.');
  const newItem = { ...item, id: 'another', code: 'EFGH', lobbyUrl: '/lobby/EFGH', previewUrl: 'https://untrusted.test/huge.png' };
  await reply([newItem]); assert.equal(banner().children.some(n=>n.tag==='img'),false);
  assert.equal(reloads, 0);
  console.log('PASS  keyboard tabs, cached first paint, no page reload, stale cross-tab responses cannot resurrect completed MTT');

  const join = actions().children[0]; join.fire('click'); join.fire('click'); await flush();
  assert.equal(chosen, 1); assert.equal(join.disabled, true); assert.equal(finishedTab.disabled, true);
  assert.equal(socket.emitted.length, 1); assert.equal(socket.emitted[0][0], 'registerTournament');
  assert.equal(JSON.stringify(socket.emitted[0][1]), JSON.stringify({ code: 'EFGH' }));
  assert.equal(visits.length, 0);
  socket.fire('scheduledLobbyState', { code: 'EFGH', registered: true }); await flush();
  assert.deepEqual(visits, ['/lobby/EFGH']); assert.equal(socket.disconnected, true);
  window.AntikGameEntry.ensure = async () => { throw Error('Entry cancelled'); };
  join.fire('click'); await flush();
  assert.equal(elements.tournamentsMessage.textContent, 'Entry cancelled');
  assert.equal(finishedTab.disabled, false);
  console.log('PASS  existing identity/register event sent once, server-confirmed navigation and visible join errors');
  elements.refreshTournaments.fire('click'); await reply([]);
  activeTab.fire('keydown', { key: 'End', preventDefault() {} }); await reply([]);
  assert.equal(elements.tournamentList.children[0].textContent, 'Пока нет завершённых турниров.');
  assert.equal(requests.filter(r => r.url.includes('finished')).length, 4);
  console.log('PASS  both empty states and archive requests occur only on archive selection/refresh');
  for (const [tab, status] of [[activeTab,'scheduled'],[finishedTab,'finished']]) {
    tab.fire('click');
    await reply([
      {...item,status},
      {...item,id:'no-bg',status,hasBackgroundPreview:false,previewUrl:'/api/tournaments/default/preview?v=123'},
      {...item,id:'logo-only',status,hasBackgroundPreview:false},
      {...item,id:'broken',status,previewUrl:'/api/tournaments/broken/preview?v=123'}
    ]);
    const cards=elements.tournamentList.children;
    assert.equal(cards.length,4);
    for (const card of cards) {
      const top=card.children[0],body=card.children[1];
      assert.equal(top.className,'tournament-card-banner');
      assert.equal(top.children.find(n=>n.className==='tournament-banner-mark').attributes['aria-hidden'],'true');
      assert.ok(top.children.some(n=>n.tag==='h2'));assert.ok(body.children.some(n=>n.className==='tournament-meta'));
      assert.equal(body.children.find(n=>n.className==='tournament-actions').children.some(n=>n.tag==='button'),status!=='finished');
    }
    assert.equal(cards[1].children[0].children.some(n=>n.tag==='img'),false);
    assert.equal(cards[2].children[0].children.some(n=>n.tag==='img'),false);
    const broken=cards[3].children[0],brokenImage=broken.children.find(n=>n.tag==='img');
    brokenImage.fire('error');assert.equal(brokenImage.hidden,true);assert.equal(broken.dataset.background,'brand');
  }
  const css=fs.readFileSync('public/site/css/tournaments.css','utf8');
  assert.match(css,/\.tournament-card\{[^}]*background:#fff/);
  assert.match(css,/\.tournament-card-banner\{[^}]*height:210px/);
  assert.match(css,/@media\(max-width:700px\).*?\.tournament-card-banner\{height:170px/);
  assert.match(css,/\.tournament-card-background\{[^}]*object-fit:cover/);
  assert.match(css,/\.tournament-card-banner::after\{[^}]*linear-gradient\(180deg,transparent 38%[^}]*#fff 100%/);
  assert.match(css,/\.tournament-actions a:not\(\.btn\)\{color:var\(--blue\)/);
  console.log('PASS  banner/title separated from white content; BG/no-BG/logo-only/broken cases in both tabs; CSS size/fade contracts (not rendered geometry)');
})().catch(error => { console.error(error); process.exitCode = 1; });
