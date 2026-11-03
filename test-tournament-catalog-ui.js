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
let timer;
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
  setInterval: callback => { timer = callback; return 1; }, clearInterval: () => { timer = null; } };
const item = { id: 'real-id', code: 'ABCD', title: '<img onerror="bad">', description: 'Real server description', status: 'scheduled',
  startAt: now + 60000, registeredCount: 2, maxEntrants: 90, registrationOpen: true, canRegister: true, registered: false,
  previewUrl: '/api/tournaments/real-id/preview?v=abc123', lobbyUrl: '/lobby/ABCD' };
const finished = { ...item, status: 'finished', finishedAt: now, canRegister: true, registrationOpen: true };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const content = () => elements.tournamentList.children[0].children.find(n => n.className === 'tournament-card-content');
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
  assert.equal(content().children.find(n => n.tag === 'h2').textContent, item.title);
  const card = elements.tournamentList.children[0];
  const image = card.children[0];
  assert.equal(image.loading, 'lazy'); assert.equal(image.decoding, 'async'); assert.equal(image.src, item.previewUrl);
  assert.equal(image.attributes['aria-hidden'], 'true');
  image.fire('error'); assert.equal(image.src, '/api/tournaments/default/preview');
  image.fire('error'); assert.equal(image.hidden, true);
  timer(); requests.at(-1).reject(Error('offline')); await flush();
  assert.equal(elements.tournamentList.children[0], card); assert.match(elements.tournamentsMessage.textContent, /offline/);
  document.hidden = true; const before = requests.length; timer(); assert.equal(requests.length, before);
  document.hidden = false; window.fire('online'); await reply([{ ...item, status: 'running', registeredCount: 3 }]);
  assert.equal(elements.tournamentList.children[0].dataset.status, 'running');
  assert.equal(elements.tournamentsMessage.textContent, '');
  console.log('PASS  safe text, filtered active data, lazy thumbnail fallback, network preservation and hidden-page polling');

  finishedTab.fire('click'); assert.equal(requests.at(-1).url, '/api/tournaments?status=finished');
  assert.equal(elements.tournamentList.children.length, 0); await reply([finished, item]);
  assert.equal(elements.tournamentList.children.length, 1);
  assert.equal(actions().children.some(n => n.tag === 'button'), false);
  assert.equal(elements.tournamentPanel.attributes['aria-labelledby'], finishedTab.id);
  assert.equal(finishedTab.attributes['aria-selected'], 'true');
  assert.ok(content().children.find(n => n.className === 'tournament-meta').children.some(n => n.children[0].textContent === 'Завершение'));
  const archiveCard = elements.tournamentList.children[0], archiveCount = requests.length;
  timer(); now += 59000; timer(); assert.equal(requests.length, archiveCount);
  now += 1001; timer(); requests.at(-1).reject(Error('archive offline')); await flush();
  assert.equal(elements.tournamentList.children[0], archiveCard);
  timer(); assert.equal(requests.length, archiveCount + 1);
  console.log('PASS  archive has completion time, no registration even with inconsistent server flags, bounded refresh and preserved network errors');

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
  await reply([newItem]); assert.equal(elements.tournamentList.children[0].children[0].src, '/api/tournaments/default/preview');
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
  timer(); await reply([]);
  activeTab.fire('keydown', { key: 'End', preventDefault() {} }); await reply([]);
  assert.equal(elements.tournamentList.children[0].textContent, 'Пока нет завершённых турниров.');
  assert.equal(requests.filter(r => r.url.includes('finished')).length, 4);
  console.log('PASS  both empty states and archive requests occur only on archive selection/refresh');
})().catch(error => { console.error(error); process.exitCode = 1; });
