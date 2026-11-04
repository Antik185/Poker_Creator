'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/poker.js', 'utf8');
const css = fs.readFileSync('public/poker.css', 'utf8');
const responsive = fs.readFileSync('public/site/css/responsive.css', 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.parentElement = null; this.dataset = {}; this.events = new Map(); this.style = {}; this._classes = new Set();
    this.classList = { contains: value => this._classes.has(value), add: value => this._classes.add(value), remove: value => this._classes.delete(value),
      toggle: (value, force) => { if (force ?? !this._classes.has(value)) this._classes.add(value); else this._classes.delete(value); } };
  }
  set className(value) { this._classes = new Set(value.split(' ')); }
  get className() { return [...this._classes].join(' '); }
  get isConnected() { return this === body || !!this.parentElement?.isConnected; }
  appendChild(node) { node.remove(); this.children.push(node); node.parentElement = this; return node; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
  getBoundingClientRect() {
    if (this.id === 'reactionPickerEl') {
      const mobile = this.classList.contains('mobile-reaction-picker');
      const width = Math.min(mobile ? 246 : 200, parseFloat(this.style.maxWidth) || Infinity);
      const rows = Math.ceil((CFG.reactions.length + CFG.customReactions.length) / 4);
      return { width, height: Math.min(rows * (mobile ? 58 : 46) + 14, parseFloat(this.style.maxHeight) || Infinity) };
    }
    return this.rect;
  }
}
const body = new Element('body'), table = body.appendChild(new Element()), room = body.appendChild(new Element());
const avatar = new Element(), board = new Element(), button = table.appendChild(new Element()), toastElement = new Element();
button.id = 'reactionBtnEl';
room.classList.add('mobile-portrait');
avatar.rect = { left: 100, top: 650, width: 70, height: 70, bottom: 720 };
board.rect = { left: 100, top: 350, width: 160, height: 80, bottom: 430 };
const document = new Element(); document.body = body;
document.createElement = tag => new Element(tag);
const search = (root, id) => root.id === id ? root : root.children.map(node => search(node, id)).find(Boolean);
document.getElementById = id => ({ gameRoom: room, communityEl: board, toast: toastElement })[id] || search(body, id);
document.querySelector = selector => selector === '.big-table' ? table : null;
let avatarExists = true, phone = true;
table.querySelector = selector => avatarExists && selector === `.pk-seat[data-seat="${G.userSeat}"] .pk-ava` ? avatar : null;
const CFG = { reactions: ['smile', 'heart', 'wave', 'clap', 'ok', 'star', 'laugh', 'hello'], customReactions: ['/uploads/reactions/sample.gif'] };
const G = { userSeat: 4, phase: 'FLOP', seats: [null, null, null, null, { name: 'Guest12345678' }] };
const window = { innerWidth: 390, innerHeight: 844, visualViewport: { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 } };
const emitted = [], effects = [], names = [];
const context = { document, window, CFG, G, Math, Number, _isMobileTableView: () => phone,
  _staticPreviewCanvas: () => new Element('canvas'), _activeReactionEls: [], syncWinnerCrowns() {},
  _positionReactionEntry() {}, socket: { emit: (...args) => emitted.push(args) },
  _fireReactionAtSeat: (...args) => effects.push(args), toast: name => names.push(name) };
vm.createContext(context);
vm.runInContext('let _reactionLocked = false;', context);
vm.runInContext(section('function _buildPickerItems()', 'function _rpClick(')
  + section('function _rpClick(', '// Settings page reaction management')
  + section('function _closePickerOutside(', 'function _dataUrlToFreshObjectUrl(')
  + section('function fireReaction(', 'function fireBotReaction(')
  + section('function syncAvatarAnchoredEffects()', 'function renderReactionBtn(')
  + section('function showTablePlayerName(', 'function _seatNodeFromHtml('), context);

const picker = () => document.getElementById('reactionPickerEl');
const place = (...args) => context._reactionPickerPlacement(...args);
for (const width of [320, 360, 375, 390, 430]) {
  for (const count of [6, 9]) {
    for (const left of [0, width / 2 - 35, width - 70]) {
      const bounds = { left: 0, top: 0, width, height: 800 };
      const anchor = { left, top: 650, bottom: 720, width: 70, height: 70 };
      const result = place(anchor, bounds, { width: 246, height: 246 }, board.rect);
      assert.ok(result.left >= 8 && result.left + 246 <= width - 8, `${width}/${count}`);
      assert.equal(result.top + result.maxHeight, anchor.top - 10);
      assert.ok(result.top >= board.rect.bottom + 8);
    }
  }
}
const below = place({ left: 5, top: 10, bottom: 70, width: 60 }, { left: 0, top: 0, width: 320, height: 500 }, { width: 246, height: 188 });
assert.equal(below.top, 80);
const tiny = place({ left: 0, top: 10, bottom: 90, width: 70 }, { left: 0, top: 0, width: 320, height: 100 }, { width: 246, height: 246 });
assert.ok(tiny.top >= 8 && tiny.top + tiny.maxHeight <= 92);
console.log('PASS  pure geometry: 320/360/375/390/430, 6/9-seat edge/center anchors, 10px gap, board clearance and constrained-height fallback');

context.toggleReactionPicker();
assert.equal(picker().parentElement, body);
assert.match(picker().style.cssText, /position:fixed;z-index:1100/);
assert.equal(parseFloat(picker().style.top) + parseFloat(picker().style.maxHeight), avatar.rect.top - 10);
assert.equal(document.events.get('click').size, 1);
context.toggleReactionPicker(); assert.equal(picker(), undefined); assert.equal(document.events.get('click').size, 0);
context.toggleReactionPicker();
const childOfButton = button.appendChild(new Element());
context._closePickerOutside({ target: childOfButton }); assert.ok(picker());
context._closePickerOutside({ target: picker().children[0] }); assert.ok(picker());
context._closePickerOutside({ target: new Element() }); assert.equal(picker(), undefined);
console.log('PASS  mobile picker escapes clipped table to body; repeat, inside, nested-button and outside click behavior preserved');

context.toggleReactionPicker();
G.userSeat = 1; G.seats[1] = { name: 'ReconnectedPlayer' };
avatar.rect = { left: 500, top: 200, bottom: 260, width: 60, height: 60 };
window.visualViewport = { width: 844, height: 390, offsetLeft: 0, offsetTop: 0 };
room.classList.remove('mobile-portrait');
context.syncAvatarAnchoredEffects();
assert.equal(picker().parentElement, body); assert.ok(parseFloat(picker().style.top) >= 8);
window.visualViewport = { width: 320, height: 350, offsetLeft: 40, offsetTop: 80 };
context.positionReactionPicker();
assert.ok(parseFloat(picker().style.left) >= 48);
assert.ok(parseFloat(picker().style.left) + 246 <= 352);
assert.ok(parseFloat(picker().style.top) >= 88);
assert.ok(parseFloat(picker().style.top) + parseFloat(picker().style.maxHeight) <= 422);
phone = false;
context.positionReactionPicker();
assert.equal(picker().parentElement, table); assert.equal(picker().classList.contains('mobile-reaction-picker'), false);
assert.equal(picker().style.cssText, 'position:absolute;z-index:400;left:500px;bottom:0px;');
phone = true; avatarExists = false; context.positionReactionPicker();
assert.equal(picker(), undefined); assert.equal(document.events.get('click').size, 0);
avatarExists = true;
console.log('PASS  current seat is re-read after reconnect, landscape/coarse pointer and VisualViewport offsets clamp correctly, desktop positioning preserved');

context.toggleReactionPicker();
const items = picker().children[0].children;
items.at(-1).onclick();
assert.equal(picker(), undefined);
assert.equal(JSON.stringify(emitted), JSON.stringify([['reaction', { content: CFG.customReactions[0], type: 'img' }]]));
assert.equal(effects[0][0], G.userSeat);
context.fireReaction(CFG.reactions[0], 'emoji'); assert.equal(emitted.length, 1);
vm.runInContext('_reactionLocked = false;', context);
context.toggleReactionPicker(); picker().children[0].children[0].onclick();
assert.equal(emitted[1][1].content, CFG.reactions[0]); assert.equal(emitted[1][1].type, 'emoji');
console.log('PASS  existing image/emoji selection, local animation and socket payload unchanged; one-reaction lock preserved');

for (const name of ['Alex', 'Guest12345678', 'LongRegisteredPlayerName', '<b>VeryLongName</b>']) {
  G.seats[1].name = name;
  const before = JSON.stringify(G);
  context.toggleReactionPicker();assert.ok(picker());
  context.showTablePlayerName({ stopPropagation() {} }, 1);
  assert.equal(names.at(-1), name); assert.equal(JSON.stringify(G), before);
  assert.equal(picker(),undefined);assert.equal(document.events.get('click').size,0);
}
assert.ok(toastElement.classList.contains('player-name-toast'));
assert.match(source, /class="pk-name"[^>]*title="\$\{safeName\}"[^>]*aria-label="Полное имя: \$\{safeName\}"/);
assert.match(source, /class="pk-name-text">\$\{safeName\}<\/span>/);
assert.match(css, /\.pk-name-text\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
assert.match(css, /\.pk-name\{[^}]*width:120px;max-width:120px/);
assert.match(css, /mobile-portrait \.pk-name\{[^}]*width:74px;max-width:74px/);
assert.match(css, /mobile-portrait\.table-9 \.pk-name\{[^}]*width:66px;max-width:66px/);
assert.match(source, /addEventListener\('click', _closePickerOutside, true\)/);
assert.match(responsive, /@media\(max-width:520px\)\{\.navbar \.nav-inner\{column-gap:8px\}\.navbar \.account-slot\{width:auto;min-width:0\}/);
assert.match(responsive, /@media\(max-width:350px\)\{\.navbar \.nav-inner\{column-gap:6px\}/);
console.log('PASS  full names preserved in data/tooltip/tap, visual ellipsis bounds only, mobile-only header slot/gap CSS contracts (not a browser render)');
