'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(id = '') { this.id = id; this.hidden = false; this.disabled = false; this.attributes = {}; this.events = {}; this.files = []; this.children = []; this.textContent = ''; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  fire(type, details = {}) { for (const handler of this.events[type] || []) handler({ preventDefault() {}, ...details }); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  focus() { document.activeElement = this; }
  querySelector() { return this.label ||= new Element(); }
  contains(element) { return this === element || this.children.includes(element); }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  click() { this.clicks = (this.clicks || 0) + 1; this.fire('click'); }
  set value(value) { this._value = value; if (this.id === 'avatarFile' && value === '') this.files = []; }
  get value() { return this._value; }
}
const elements = new Map();
const document = new Element();
document.body = { dataset: { page: 'profile' } };
document.getElementById = id => { if (!elements.has(id)) elements.set(id,new Element(id)); return elements.get(id); };
document.createElement = () => new Element();
const get = document.getElementById;
get('avatarMenu').hidden = get('avatarProgress').hidden = get('deleteAvatar').hidden = true;
get('avatarControl').children = ['avatarTrigger','avatarMenu','uploadAvatar','deleteAvatar'].map(get);
const user = { id:'owner', username:'AvatarOwner', avatarUrl:null };
const calls = [], updates = [];
let pendingRequest;
const window = new Element();
window.dispatchEvent = event => { if (event.type === 'antik:profile-updated') updates.push(event.detail); window.fire(event.type,{ detail:event.detail }); };
window.AntikApi = {
  session: async () => ({ authenticated:true, user }),
  request: async (url, options) => {
    if (url === '/api/profile/avatar') { calls.push(options); return new Promise((resolve,reject)=>{ pendingRequest={resolve,reject}; }); }
    if (url === '/api/profile/tournament-stats') return { played:0,wins:0,finalTables:0 };
    return { items:[], pages:1 };
  }
};
const context = { document, window, Intl, Date,
  CustomEvent: class { constructor(type, {detail}) { this.type=type; this.detail=detail; } },
  FormData: class { append(key,value) { this[key]=value; } }
};
async function flush() { for (let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve)); }
function choose(type='image/png',size=120) { get('avatarFile').files=[{type,size}]; get('avatarFile').fire('change'); }

(async()=>{
  vm.runInNewContext(fs.readFileSync('public/site/js/profile.js','utf8'),context);
  await flush();
  assert.equal(get('avatarTrigger').disabled,false);
  assert.equal(get('deleteAvatar').hidden,true);
  get('avatarTrigger').click();
  assert.equal(get('avatarMenu').hidden,false);
  assert.equal(document.activeElement,get('uploadAvatar'));
  get('avatarControl').fire('keydown',{key:'Escape'});
  assert.equal(get('avatarMenu').hidden,true);
  assert.equal(document.activeElement,get('avatarTrigger'));
  get('avatarTrigger').click(); document.fire('pointerdown',{target:new Element()});
  assert.equal(get('avatarMenu').hidden,true);
  get('avatarTrigger').click(); get('uploadAvatar').click();
  assert.equal(get('avatarFile').clicks,1);
  assert.equal(calls.length,0);
  get('avatarFile').files=[]; get('avatarFile').fire('change'); await flush();
  assert.equal(calls.length,0);
  assert.equal(updates.length,0);
  choose('image/svg+xml');
  choose('image/png',6*1024*1024);
  assert.equal(calls.length,0);
  console.log('PASS  avatar menu, focus, Escape, outside click, picker cancellation and invalid input');

  choose(); await flush();
  assert.equal(calls.length,1);
  choose(); await flush();
  assert.equal(calls.length,1);
  assert.equal(get('avatarTrigger').disabled,true);
  assert.equal(get('avatarProgress').hidden,false);
  assert.equal(get('avatarTrigger').attributes['aria-busy'],'true');
  pendingRequest.reject(new Error('Upload failed')); await flush();
  assert.equal(get('avatarTrigger').disabled,false);
  assert.equal(get('avatarProgress').hidden,true);
  assert.equal(updates.length,0);
  assert.equal(get('avatarMessage').textContent,'Upload failed');
  choose(); await flush();
  const custom={...user,avatarUrl:'/profile-avatars/test.webp?v=1'};
  pendingRequest.resolve({user:custom}); await flush();
  assert.equal(calls.length,2);
  assert.equal(calls[1].method,'POST');
  assert.equal(get('avatarProgress').hidden,true);
  assert.equal(get('avatarFile').value,'');
  assert.equal(get('deleteAvatar').hidden,false);
  assert.equal(updates[0],custom);
  assert.equal(document.activeElement,get('avatarTrigger'));
  get('avatarTrigger').click(); get('deleteAvatar').click(); get('deleteAvatar').click(); await flush();
  assert.equal(calls.length,3);
  assert.equal(calls[2].method,'DELETE');
  pendingRequest.resolve({user}); await flush();
  assert.equal(get('deleteAvatar').hidden,true);
  assert.equal(updates[1],user);
  console.log('PASS  file choice auto-uploads, existing API only, single write, old image kept on failure, retry and immediate update events');

  choose(); await flush();
  window.fire('antik:auth-changed',{detail:{authenticated:false}});
  pendingRequest.resolve({user:custom}); await flush();
  assert.equal(updates.length,2);
  assert.equal(get('avatarTrigger').disabled,true);
  assert.equal(get('avatarProgress').hidden,true);
  console.log('PASS  an avatar response arriving after logout cannot restore the previous account UI');

  const html=fs.readFileSync('public/site/pages/profile.html','utf8');
  const css=fs.readFileSync('public/site/css/auth.css','utf8');
  assert.match(html,/<button[^>]+id="avatarTrigger"[^>]+aria-label="Изменить аватар"/);
  assert.match(html,/aria-haspopup="dialog"/);
  assert.doesNotMatch(html,/avatarPreview|avatarForm|saveAvatar|cancelAvatar/);
  assert.doesNotMatch(fs.readFileSync('public/site/js/profile.js','utf8'),/createObjectURL|revokeObjectURL/);
  assert.match(css,/\.profile-avatar:hover:not\(:disabled\) \.avatar-overlay/);
  assert.match(css,/\.profile-avatar:focus-visible/);
  assert.match(css,/min-height:48px/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/\.avatar-progress/);
  console.log('PASS  native keyboard button, camera overlay, visible focus and touch-sized responsive menu');
})().catch(error=>{console.error(error);process.exitCode=1;});
