'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const Database = require('better-sqlite3');
const { testMailEnvironment, verifiedRegistration, cookies } = require('./test-email-helper');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-catalog-'));
process.env.POKER_DB_PATH = path.join(directory, 'catalog.sqlite');
const db = require('./server/db');
const base = 'http://127.0.0.1:3124';
const sockets = [];
let server;
let output = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = message => console.log(`PASS  ${message}`);

async function start() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: __dirname,
    env: { ...process.env, ...testMailEnvironment(directory), NODE_ENV:'test', PORT:'3124', HOST:'127.0.0.1',
      ADMIN_PASSWORD:'catalog-test-admin', REQUIRE_HTTPS:'0', PUBLIC_EDGE_URL:'',
      PLAYER_SESSION_SECRET:'catalog-player-secret-at-least-32-bytes',
      USER_AUTH_SECRET:'catalog-user-secret-at-least-32-bytes',
      AUTH_ARGON2_MEMORY:'8192', AUTH_ARGON2_PASSES:'2', PROFILE_AVATAR_DIR:path.join(directory,'avatars') },
    stdio:['ignore','pipe','pipe']
  });
  output='';
  server.stdout.on('data', chunk=>{output+=chunk;});
  server.stderr.on('data', chunk=>{output+=chunk;});
  for (let i=0;i<200;i++) {
    try { if ((await fetch(`${base}/healthz`, {signal:AbortSignal.timeout(1000)})).ok) return; } catch (_) {}
    if (server.exitCode !== null) break;
    await sleep(60);
  }
  throw Error(`Catalog server failed: ${output}`);
}
async function stop() {
  for (const socket of sockets) socket.close();
  if (!server || server.exitCode !== null) return;
  const exited = new Promise(resolve=>server.once('exit',resolve));
  server.kill(); await exited; server=null;
}
function client(cookie='') {return {cookie,csrf:''};}
async function request(c,url,{method='GET',json,body}={}) {
  const headers={Cookie:c.cookie,Origin:base};
  if (json !== undefined) headers['Content-Type']='application/json';
  if (c.csrf) headers['X-CSRF-Token']=c.csrf;
  const res=await fetch(base+url,{method,headers,body:json===undefined?body:JSON.stringify(json),redirect:'manual',signal:AbortSignal.timeout(10000)});
  const jar=new Map(c.cookie.split('; ').filter(Boolean).map(pair=>{const n=pair.indexOf('=');return [pair.slice(0,n),pair.slice(n+1)];}));
  for (const pair of res.headers.getSetCookie()) {const p=pair.split(';')[0],n=p.indexOf('=');jar.set(p.slice(0,n),p.slice(n+1));}
  c.cookie=[...jar].map(([key,value])=>`${key}=${value}`).join('; ');
  const data=res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text();
  if (data?.csrfToken) c.csrf=data.csrfToken;
  return {res,data};
}
function event(socket,name) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off(name,done);reject(Error(`Missing ${name}`));},5000);
    function done(value) {clearTimeout(timer);resolve(value);}
    socket.once(name,done);
  });
}
async function connect(c) {
  const socket=io(base,{path:'/realtime/',transports:['websocket'],forceNew:true,reconnection:false,extraHeaders:{Cookie:c.cookie,Origin:base}});
  sockets.push(socket);await event(socket,'connect');return socket;
}
async function register(socket,code,extra={}) {
  const state=event(socket,'scheduledLobbyState');
  socket.emit('registerTournament',{code,...extra});return state;
}
async function create(admin,config) {
  const form=new FormData();form.append('config',JSON.stringify(config));
  const result=await request(admin,'/api/rooms',{method:'POST',body:form});
  assert.equal(result.res.status,200,JSON.stringify(result.data));return result.data;
}
async function catalog(c) {
  const result=await request(c,'/api/tournaments');
  assert.equal(result.res.status,200);assert.equal(result.res.headers.get('cache-control'),'no-store');
  return result.data.items;
}

(async()=>{
  try {
    await start();
    const visitor=client(),admin=client();
    assert.deepEqual(await catalog(visitor),[]);
    const login=await request(admin,'/api/admin/login',{method:'POST',json:{password:'catalog-test-admin'}});
    assert.equal(login.res.status,200);
    const created=await create(admin,{launchMode:'scheduled',scheduledStartAt:new Date(Date.now()+120000).toISOString(),
      tournamentTitle:'Catalog real admin MTT',tournamentDescription:'Actual schedule',maxPlayers:6,maxEntrants:6,startStack:5000});
    const instant=await create(admin,{launchMode:'instant',brand:'Ordinary room',lobbyWaitSeconds:3600});
    let items=await catalog(visitor);
    assert.equal(items.length,1);assert.equal(items[0].id,created.roomId);
    assert.equal(items[0].title,'Catalog real admin MTT');assert.equal(items[0].registeredCount,0);
    assert.equal(items[0].maxEntrants,6);assert.equal(items[0].canRegister,true);
    assert.equal(items[0].lobbyUrl,`/lobby/${created.code}`);
    assert.equal((await request(visitor,`/api/rooms/${instant.roomId}`)).res.status,200);
    assert.equal((await request(visitor,`/lobby/${created.code}`)).res.status,200);
    const page=await request(visitor,'/tournaments');assert.match(page.data,/id="tournamentList"/);
    assert.doesNotMatch(page.data,/Пример фирменного оформления/);
    pass('real admin-created scheduled MTT appears automatically; ordinary rooms stay separate and existing lobby links survive');

    const signup=await verifiedRegistration(base,{username:'CatalogAccount',email:'catalog@example.test',
      password:'catalog-account-password',passwordConfirmation:'catalog-account-password'},path.join(directory,'email-outbox.jsonl'));
    assert.equal(signup.status,200);
    const account=client(cookies(signup));const accountResult=await signup.json();
    for (const route of ['/','/rooms','/tournaments','/profile']) {
      const html=(await request(account,route)).data;
      assert.match(html,/data-auth-guest hidden/);assert.match(html,/data-auth-user >/);
      assert.match(html,/data-user-name>CatalogAccount</);
    }
    pass('real verified HttpOnly session renders account header on every main page before client fetch');

    const guest=client();
    const identity=(await request(guest,'/api/game/identity')).data.identity;
    assert.match(identity.name,/^Guest\d{8}$/);
    const guestSocket=await connect(guest),accountSocket=await connect(account);
    const guestState=await register(guestSocket,created.code,{name:'forged',playerId:'forged'});
    assert.equal(guestState.registrations[0].name,identity.name);
    const accountState=await register(accountSocket,created.code);
    assert.ok(accountState.registrations.some(p=>p.name==='CatalogAccount'&&p.isYou));
    assert.equal(accountState.activeRegistrations,2);
    await register(accountSocket,created.code);await register(guestSocket,created.code);
    items=await catalog(account);assert.equal(items[0].registeredCount,2);
    assert.equal(items[0].registered,true);assert.equal(items[0].playerStatus,'ACTIVE');assert.equal(items[0].canRegister,false);
    assert.equal((await catalog(visitor))[0].registered,false);
    assert.equal('registrations' in items[0],false);assert.equal('userId' in items[0],false);
    const forbidden=event(accountSocket,'tournamentRegistrationError');
    accountSocket.emit('registerTournament',{code:created.code,identityMode:'guest'});
    assert.match(await forbidden,/только через свой аккаунт/);
    pass('catalog uses existing Socket.IO registration: stable guests, mandatory account identity, duplicate prevention and private personal state');

    const full=await create(admin,{launchMode:'scheduled',scheduledStartAt:new Date(Date.now()+180000).toISOString(),
      tournamentTitle:'Full MTT',tournamentBotCount:6,maxEntrants:6});
    const fullItem=(await catalog(visitor)).find(item=>item.id===full.roomId);
    assert.equal(fullItem.registeredCount,6);assert.equal(fullItem.registrationOpen,false);assert.equal(fullItem.canRegister,false);
    const fullError=event(guestSocket,'tournamentRegistrationError');
    guestSocket.emit('registerTournament',{code:full.code});assert.match(await fullError,/места/);
    pass('full tournament disables registration and server rejects a forged registration attempt');

    await stop();
    const room=db.getRoom(created.roomId);
    db.updateRoomConfig(created.roomId,{...room.config,scheduledStartAt:new Date(Date.now()-60000).toISOString(),lateRegistrationMinutes:0});
    await start();
    const running=(await catalog(account)).find(item=>item.id===created.roomId);
    assert.equal(running.status,'running');assert.equal(running.registrationOpen,false);
    assert.equal(running.playerStatus,'ACTIVE');assert.equal(running.registeredCount,2);
    const lateGuest=client();await request(lateGuest,'/api/game/identity');const lateSocket=await connect(lateGuest);
    const closed=event(lateSocket,'tournamentRegistrationError');lateSocket.emit('registerTournament',{code:created.code});
    assert.match(await closed,/регистрация уже закрыта/);
    const returning=await connect(account);assert.equal((await register(returning,created.code)).activeRegistrations,2);
    const seat=event(returning,'lobbyStart');returning.emit('claimTournamentSeat',{code:created.code});
    const assignment=await seat;assert.equal(assignment.roomId,created.roomId);
    const state=event(returning,'stateUpdate');returning.emit('joinRoom',{roomId:created.roomId});
    assert.ok((await state).yourSeat>=0);
    pass('restart/refresh preserves catalog and participation; running MTT refuses new late entrants but existing account returns to its seat');

    await stop();
    const entries=db.listTournamentRegistrations(created.roomId);
    const owner=entries.find(p=>p.user_id===accountResult.user.id),other=entries.find(p=>!p.user_id);
    db.markTournamentEliminated(created.roomId,other.player_id,2);
    db.markTournamentWinner(created.roomId,owner.player_id,10000);
    db.saveTournamentState(created.roomId,{status:'FINISHED',finishedAt:Date.now(),winnerPlayerId:owner.player_id});
    // Completed-state fixtures are confined to this disposable database; gameplay completion has its own integration suite.
    await start();
    items=await catalog(account);
    const finished=items.find(item=>item.id===created.roomId);
    assert.equal(finished.status,'finished');assert.equal(finished.canRegister,false);
    assert.equal(finished.registeredCount,2);assert.equal(finished.playerStatus,'WINNER');assert.equal(items.at(-1).id,created.roomId);
    const history=(await request(account,'/api/profile/tournaments')).data;
    assert.equal(history.total,1);assert.equal(history.items[0].finalPlace,1);assert.equal(history.items[0].status,'COMPLETED');
    const eliminated=await connect(guest);const eliminatedError=event(eliminated,'tournamentRegistrationError');
    eliminated.emit('registerTournament',{code:created.code});assert.match(await eliminatedError,/выбыли/);
    assert.equal((await catalog(guest)).find(item=>item.id===created.roomId).playerStatus,'ELIMINATED');
    pass('completed/eliminated status is real, finished cards sort last, no re-entry and account result is retained in existing MTT history');

    await request(account,'/api/auth/session');
    assert.equal((await request(account,'/api/auth/logout',{method:'POST',json:{}})).res.status,200);
    assert.match((await request(account,'/')).data,/data-auth-user hidden/);
    assert.equal((await request(account,'/profile')).res.status,302);
    const raw=new Database(process.env.POKER_DB_PATH);
    assert.equal(raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,3);
    assert.equal(raw.pragma('integrity_check',{simple:true}),'ok');raw.close();
    pass('logout invalidates server header/profile; no new migrations, isolated database integrity OK');
  } finally {
    await stop();db.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
