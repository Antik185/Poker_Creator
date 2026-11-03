'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.events={};this.attributes={};this.dataset={};this.disabled=false;}
  addEventListener(type,handler){(this.events[type]||=[]).push(handler);}
  fire(type,event={}){for(const handler of this.events[type]||[])handler(event);}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(key,value){this.attributes[key]=value;}
}
const elements=Object.fromEntries(['tournamentList','tournamentsMessage','refreshTournaments'].map(id=>[id,new Element()]));
const document=new Element();document.body={dataset:{page:'tournaments'}};document.hidden=false;
document.getElementById=id=>elements[id];document.createElement=tag=>new Element(tag);
const window=new Element();
let pending;
let timer;
let requests=0;
let chosen=0;
const visits=[];
const socket=new Element();socket.once=socket.addEventListener;socket.on=socket.addEventListener;
socket.emitted=[];socket.emit=(...args)=>socket.emitted.push(args);
socket.connect=()=>socket.fire('connect');socket.disconnect=()=>{socket.disconnected=true;};
window.io=()=>socket;
window.AntikGameEntry={ensure:async()=>{chosen++;}};
window.AntikApi={request:()=>{requests++;return new Promise((resolve,reject)=>{pending={resolve,reject};});}};
const location={assign:url=>visits.push(url),reload:()=>{}};
const context={window,document,location,Intl,Date,JSON,Error,setTimeout,clearTimeout,
  setInterval:callback=>{timer=callback;return 1;},clearInterval:()=>{timer=null;}};
const item={id:'real-id',code:'ABCD',title:'<img onerror="bad">',description:'Real server description',status:'scheduled',startAt:Date.now()+60000,
  registeredCount:2,maxEntrants:90,registrationOpen:true,canRegister:true,registered:false,lobbyUrl:'/lobby/ABCD'};
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
function button(){return elements.tournamentList.children[0].children.find(n=>n.className==='tournament-actions').children[0];}
(async()=>{
  vm.runInNewContext(fs.readFileSync('public/site/js/tournaments.js','utf8'),context);
  assert.equal(requests,1);pending.resolve({items:[item]});await flush();
  const card=elements.tournamentList.children[0];
  assert.equal(card.children.find(n=>n.tag==='h2').textContent,item.title);
  timer();pending.reject(Error('offline'));await flush();
  assert.equal(elements.tournamentList.children[0],card);
  assert.match(elements.tournamentsMessage.textContent,/offline/);
  document.hidden=true;timer();assert.equal(requests,2);
  document.hidden=false;timer();pending.resolve({items:[{...item,status:'running',registeredCount:3}]});await flush();
  assert.equal(elements.tournamentList.children[0].dataset.status,'running');
  assert.equal(elements.tournamentsMessage.textContent,'');
  console.log('PASS  real data is text-only, automatic refresh updates status, failed reload keeps cards and hidden pages do not poll');

  const join=button();join.fire('click');join.fire('click');await flush();
  assert.equal(chosen,1);assert.equal(join.disabled,true);
  assert.equal(socket.emitted.length,1);assert.equal(socket.emitted[0][0],'registerTournament');
  assert.equal(JSON.stringify(socket.emitted[0][1]),JSON.stringify({code:'ABCD'}));
  assert.equal(visits.length,0);
  socket.fire('scheduledLobbyState',{code:'ABCD',registered:true});await flush();
  assert.deepEqual(visits,['/lobby/ABCD']);assert.equal(socket.disconnected,true);
  console.log('PASS  direct join uses existing identity and registration event once, navigates only after server confirmation');

  timer();pending.resolve({items:[{...item,status:'finished',canRegister:false,registrationOpen:false,registered:true,playerStatus:'WINNER'}]});await flush();
  assert.equal(elements.tournamentList.children[0].children.find(n=>n.className==='tournament-actions').children.some(n=>n.tag==='button'),false);
  timer();pending.resolve({items:[]});await flush();
  assert.equal(elements.tournamentList.children[0].textContent,'Пока нет доступных турниров');
  console.log('PASS  finished cards have no registration button and empty catalog shows the specified message');
})().catch(error=>{console.error(error);process.exitCode=1;});
