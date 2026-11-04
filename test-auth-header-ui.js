'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createSiteRenderer } = require('./server/siteRenderer');
const renderer = createSiteRenderer();
const user = { id:'owner',username:'HeaderPlayer',avatarUrl:'/profile-avatars/own.webp?v=2' };
const renderPages = [u=>renderer.home(u),u=>renderer.coming({COMING_VIEW:'rooms'},u),u=>renderer.tournaments(u),u=>renderer.profile(u),u=>renderer.verifyEmail(u),u=>renderer.lobby({user:u})];
for (const render of renderPages) {
  const html=render(user);
  assert.match(html, /data-auth-guest hidden/);
  assert.match(html, /data-auth-user >/);
  assert.match(html, /data-user-name>HeaderPlayer</);
  assert.match(html, /src="\/profile-avatars\/own.webp\?v=2"/);
  assert.doesNotMatch(html, /{{AUTH_|csrfToken|antik_user_session/);
  const guest=render(null);
  assert.match(guest, /data-auth-user hidden/);
  assert.match(guest, /data-auth-guest >/);
}
assert.match(renderer.home({...user,username:'<img onerror="x">'}), /&lt;img onerror=&quot;x&quot;&gt;/);
console.log('PASS  all site headers render verified account/guest state before JS, escape names and never serialize auth tokens');

class Element {
  constructor() {this.hidden=false;this.disabled=false;this.events={};this.children=[];}
  addEventListener(type,handler) {(this.events[type]||=[]).push(handler);}
  fire(type,detail={}) {for(const handler of this.events[type]||[]) handler(detail);}
  replaceChildren(...nodes) {this.children=nodes;}
  append(node) {this.children.push(node);}
}
const guest=new Element(),account=new Element(),name=new Element(),avatar=new Element(),logout=new Element();
guest.hidden=true;
const document=new Element();
document.body={dataset:{page:'home'}};
document.getElementById=()=>null;
document.querySelector=()=>null;
document.createElement=()=>new Element();
document.querySelectorAll=selector=>({'[data-auth-guest]':[guest],'[data-auth-user]':[account],'[data-user-name]':[name],'[data-user-initial]':[avatar],'[data-auth-logout]':[logout]})[selector]||[];
const window=new Element();
window.dispatchEvent=event=>window.fire(event.type,event);
let resolveSession,rejectSession;
const setSessions=[];
window.AntikApi={
  session:()=>new Promise((resolve,reject)=>{resolveSession=resolve;rejectSession=reject;}),
  setSession:value=>setSessions.push(value),request:async()=>({})
};
const location={search:'',assign:()=>{},replace:()=>{throw Error('unexpected redirect');}};
const context={document,window,location,URLSearchParams,Intl,Date,alert:()=>{},
  CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail;}}};
const flush=async()=>{for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));};
(async()=>{
  vm.runInNewContext(fs.readFileSync('public/site/js/auth.js','utf8'),context);
  assert.equal(guest.hidden,true);
  rejectSession(new Error('offline')); await flush();
  assert.equal(guest.hidden,true);assert.equal(account.hidden,false);
  window.fire('online'); resolveSession({authenticated:true,user});await flush();
  assert.equal(name.textContent,user.username);assert.equal(guest.hidden,true);
  window.fire('online');resolveSession({authenticated:false});await flush();
  assert.equal(guest.hidden,false);assert.equal(account.hidden,true);
  window.fire('antik:auth-changed',{detail:{authenticated:true,user}});
  assert.equal(guest.hidden,true);assert.equal(account.hidden,false);
  logout.fire('click');await flush();
  assert.equal(guest.hidden,false);assert.equal(account.hidden,true);
  assert.equal(setSessions.at(-1).authenticated,false);
  console.log('PASS  delayed/offline session preserves header; confirmed expiry, verified signup and logout update immediately');
})().catch(error=>{console.error(error);process.exitCode=1;});
