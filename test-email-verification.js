'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { io } = require('socket.io-client');
const { testMailEnvironment, lastCode } = require('./test-email-helper');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-email-'));
const dbPath = path.join(dir, 'test.sqlite');
const outbox = path.join(dir, 'email-outbox.jsonl');
const base = 'http://127.0.0.1:3124';
const password = 'email-verification-test-password';
const sockets = [];
let server, db, logs = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => console.log(`PASS  ${name}`);
async function start() {
  server = spawn(process.execPath, ['server/index.js'], { cwd: __dirname,
    env: { ...process.env, ...testMailEnvironment(dir), PORT: '3124', HOST: '127.0.0.1', NODE_ENV: 'test',
      ADMIN_PASSWORD: '', PUBLIC_EDGE_URL: '', POKER_DB_PATH: dbPath,
      TRUST_PROXY: '1',
      PROFILE_AVATAR_DIR: path.join(dir, 'avatars'), AUTH_ARGON2_MEMORY: '8192', AUTH_ARGON2_PASSES: '2',
      PLAYER_SESSION_SECRET: 'email-test-player-secret-at-least-32', USER_AUTH_SECRET: 'email-test-user-secret-at-least-32' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/healthz')).ok) return; } catch {}
    await sleep(75);
  }
  throw new Error(`Server unavailable: ${logs}`);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise(resolve => server.once('exit', resolve)); server.kill(); await done; server = null;
}
function client() { return { cookies: new Map(), csrf: '' }; }
function cookie(c) { return [...c.cookies].map(([key,value]) => `${key}=${value}`).join('; '); }
async function req(c, route, { json, method = json === undefined ? 'GET' : 'POST', csrf = c.csrf, origin = base, extraHeaders = {} } = {}) {
  const response = await fetch(base + route, { method, redirect: 'manual',
    headers: { Cookie: cookie(c), Origin: origin, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...extraHeaders }, body: json === undefined ? undefined : JSON.stringify(json) });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0], sep = pair.indexOf('='); c.cookies.set(pair.slice(0,sep), pair.slice(sep+1));
  }
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  return { status: response.status, data, response };
}
async function init(c) { const result = await req(c, '/api/auth/registration'); c.csrf = result.data.csrfToken; return result; }
async function begin(name, email = `${name}@example.test`, c = client()) {
  await init(c);
  const result = await req(c, '/api/auth/register', { json: { username: name, email, password, passwordConfirmation: password } });
  return { c, email, result };
}
function confirm(c, code, options = {}) { return req(c, '/api/auth/verify-email', { json: { code }, ...options }); }
function pending(email) { return db.prepare('SELECT * FROM pending_registrations WHERE email=?').get(email); }
function retryNow(email) { db.prepare('UPDATE pending_registrations SET resend_available_at=0,sending_until=0 WHERE email=?').run(email); }
async function login(c, name) {
  const result = await req(c, '/api/auth/login', { json: { login: name, password } });
  if (result.data?.csrfToken) c.authCsrf = result.data.csrfToken;
  return result;
}
async function room() {
  const form = new FormData(); form.append('config', '{}');
  const response = await fetch(base + '/api/rooms', { method: 'POST', body: form });
  return (await response.json()).roomId;
}
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, done); reject(new Error(`Missing ${name}`)); }, 5000);
    function done(value) { clearTimeout(timer); resolve(value); } socket.once(name, done);
  });
}
async function connect(c) {
  const socket = io(base, { path: '/realtime/', transports: ['websocket'], forceNew: true,
    reconnection: false, extraHeaders: { Cookie: cookie(c), Origin: base } });
  sockets.push(socket); await event(socket, 'connect'); return socket;
}

(async () => {
  try {
    await start(); db = new Database(dbPath);
    const a = await begin('EmailAlice'); assert.equal(a.result.status, 202);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gameplay_identities WHERE identity_type='ACCOUNT'").get().n, 0);
    assert.match(pending(a.email).password_hash, /^\$argon2id\$/);
    assert.notEqual(pending(a.email).code_hash, lastCode(outbox,a.email));
    assert.equal((await login(a.c, 'EmailAlice')).status, 401);
    assert.equal((await req(a.c, '/profile')).status, 302);
    assert.equal((await req(a.c, '/api/game/identity')).data.identity.type, 'GUEST');
    const refreshed = await init(a.c); assert.ok(refreshed.data.pending);
    assert.equal(refreshed.response.headers.get('cache-control'), 'no-store');
    const rawCookie = refreshed.response.headers.get('set-cookie'); assert.equal(rawCookie, null);
    pass('pending signup has no user, auth session, account identity or profile access; refresh resumes it');
    const invalidRecipient = await begin('BadRecipient','one@example.test,two@example.test');
    assert.equal(invalidRecipient.result.status,400);
    assert.equal((await req(a.c,'/api/auth/register',{json:{username:'EmailOther',email:'other@example.test',password,passwordConfirmation:password},csrf:''})).status,403);

    const outsider = client(); await init(outsider);
    assert.equal((await confirm(outsider, lastCode(outbox,a.email))).status, 410);
    assert.equal((await req(a.c, '/api/auth/verify-email', { json: { code: lastCode(outbox,a.email) }, csrf: '' })).status, 403);
    assert.equal((await req(a.c, '/api/auth/resend-verification', { json: {}, origin: 'https://evil.test' })).status, 403);
    assert.equal((await confirm(a.c, 'wrong')).status, 400);
    const correct = lastCode(outbox,a.email);
    const guestCookie = a.c.cookies.get('poker_player');
    a.c.cookies.set('antik_user_session','attacker-fixed-session');
    const secureProxy = { origin: base.replace('http:','https:'), extraHeaders: { 'X-Forwarded-Proto':'https' } };
    const outcomes = await Promise.all([confirm(a.c, correct, secureProxy), confirm(a.c, correct, secureProxy)]);
    assert.deepEqual(outcomes.map(result=>result.status).sort(), [200,410]);
    const automatic = outcomes.find(result=>result.status===200);
    assert.equal(automatic.data.authenticated,true);
    assert.equal(automatic.data.returnTo,'/profile');
    assert.ok(!JSON.stringify(automatic.data).includes(a.c.cookies.get('antik_user_session')));
    const authCookie = automatic.response.headers.getSetCookie().find(value=>value.startsWith('antik_user_session='));
    assert.ok(authCookie.includes('HttpOnly') && authCookie.includes('Secure') && authCookie.includes('SameSite=Lax'));
    assert.notEqual(a.c.cookies.get('antik_user_session'),'attacker-fixed-session');
    assert.equal(a.c.cookies.get('poker_player'),guestCookie);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
    const user = db.prepare('SELECT * FROM users').get(); assert.ok(user.email_verified_at);
    assert.equal((await req(a.c, '/api/auth/session')).data.authenticated, true);
    assert.equal((await req(a.c, '/profile')).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?').get(user.id).n,1);
    assert.equal(pending(a.email), undefined);
    assert.equal((await confirm(a.c,correct)).status,410);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?').get(user.id).n,1);
    assert.equal((await req(a.c,'/api/auth/logout',{json:{},csrf:automatic.data.csrfToken})).status,200);
    assert.equal((await req(a.c,'/api/auth/session')).data.authenticated,false);
    assert.equal((await login(a.c, 'EmailAlice')).status,200);
    assert.equal((await req(a.c, '/api/auth/profile')).data.user.emailVerifiedAt,user.email_verified_at);
    pass('confirmation atomically creates one account and session; proxy cookies, fixation protection, refresh and logout work');

    const expired = await begin('ExpiredCode');
    const beforeInvalid = db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n;
    db.prepare('UPDATE pending_registrations SET code_expires_at=1 WHERE email=?').run(expired.email);
    assert.equal((await confirm(expired.c,lastCode(outbox,expired.email))).status,410);
    assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get(expired.email),undefined);
    const exhausted = await begin('WrongCode');
    const good = lastCode(outbox,exhausted.email), bad = good === '000000' ? '000001' : '000000';
    for (let i=0;i<5;i++) assert.equal((await confirm(exhausted.c,bad)).status,400);
    assert.equal((await confirm(exhausted.c,good)).status,429);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,beforeInvalid);
    assert.equal((await req(exhausted.c,'/api/auth/resend-verification',{json:{}})).status,429);
    retryNow(exhausted.email);
    assert.equal((await req(exhausted.c,'/api/auth/resend-verification',{json:{email:a.email}})).status,202);
    assert.notEqual(lastCode(outbox,exhausted.email),good);
    assert.equal((await confirm(exhausted.c,good)).status,400);
    assert.equal((await confirm(exhausted.c,lastCode(outbox,exhausted.email))).status,200);
    pass('expired and exhausted codes fail; resend has a cooldown, ignores email input and invalidates the old code');

    const atomic = await begin('AtomicSignup');
    const atomicCode = lastCode(outbox,atomic.email);
    db.exec(`CREATE TRIGGER test_session_failure BEFORE INSERT ON auth_sessions
      WHEN (SELECT username FROM users WHERE id=NEW.user_id)='AtomicSignup'
      BEGIN SELECT RAISE(ABORT,'test session failure'); END;`);
    assert.equal((await confirm(atomic.c,atomicCode)).status,500);
    assert.equal(db.prepare("SELECT id FROM users WHERE username='AtomicSignup'").get(),undefined);
    assert.ok(pending(atomic.email));
    assert.equal(atomic.c.cookies.has('antik_user_session'),false);
    db.exec('DROP TRIGGER test_session_failure');
    assert.equal((await confirm(atomic.c,atomicCode)).status,200);
    pass('session persistence failure rolls back user creation and code consumption, so confirmation can be retried');

    const mailfail = await begin('MailFailure','mailfail@example.test');
    assert.equal(mailfail.result.status,503); assert.equal(pending(mailfail.email).delivery_state,'FAILED');
    assert.equal((await confirm(mailfail.c,'123456')).status,409);
    assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get(mailfail.email),undefined);
    const duplicate = await begin('DupSignup');
    assert.equal((await req(duplicate.c,'/api/auth/register',{json:{ username:'DupSignup',email:duplicate.email,password,passwordConfirmation:password }})).status,429);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pending_registrations WHERE email=?').get(duplicate.email).n,1);
    const takeover = await begin('DupSignup','different@example.test');
    assert.equal((await confirm(duplicate.c,lastCode(outbox,duplicate.email))).status,200);
    assert.equal((await confirm(takeover.c,lastCode(outbox,takeover.email))).status,409);
    assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get(takeover.email),undefined);
    pass('mail rejection cannot create an account; repeated signup and competing usernames cannot create partial users');
    const sameEmailA = await begin('SameEmailA','shared@example.test');
    const codeA = lastCode(outbox,sameEmailA.email);
    const sameEmailB = await begin('SameEmailB','shared@example.test');
    assert.equal((await confirm(sameEmailA.c,codeA)).status,200);
    assert.equal((await confirm(sameEmailB.c,lastCode(outbox,sameEmailB.email))).status,409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get(sameEmailA.email).n,1);

    const edit = await begin('EditSignup'); const old = lastCode(outbox,edit.email);
    assert.equal((await req(edit.c,'/api/auth/cancel-registration',{json:{}})).status,200);
    assert.equal((await confirm(edit.c,old)).status,410);
    const stale = await begin('StaleSignup');
    db.prepare('UPDATE pending_registrations SET expires_at=1 WHERE email=?').run(stale.email);
    await init(stale.c); assert.equal(pending(stale.email),undefined);
    const restart = await begin('RestartSignup');
    for (const socket of sockets) socket.close();
    await stop(); await start();
    assert.equal((await confirm(restart.c,lastCode(outbox,restart.email))).status,200);
    pass('editing invalidates the pending code, expired signups are cleaned, valid confirmation survives restart');

    const legacyId = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id,username,username_normalized,email,email_normalized,password_hash)
      VALUES (?,'LegacyUser','legacyuser','legacy@example.test','legacy@example.test',?)`).run(legacyId,user.password_hash);
    const legacy = client(); assert.equal((await login(legacy,'LegacyUser')).status,200);
    assert.equal((await req(legacy,'/api/game/identity')).data.identity.type,'ACCOUNT');
    assert.equal(db.prepare('SELECT player_id FROM gameplay_identities WHERE user_id=?').get(legacyId),undefined);
    const legacySocket = await connect(legacy);
    const denied = event(legacySocket,'error'); legacySocket.emit('joinRoom',{roomId:await room()});
    assert.match(await denied,/email/);
    await init(legacy);
    assert.equal((await req(legacy,'/api/auth/start-email-verification',{json:{}})).status,202);
    assert.equal((await confirm(outsider,lastCode(outbox,'legacy@example.test'))).status,410);
    assert.equal((await confirm(legacy,lastCode(outbox,'legacy@example.test'))).status,200);
    assert.equal(db.prepare('SELECT id FROM users WHERE email=?').get('legacy@example.test').id,legacyId);
    assert.ok((await req(legacy,'/api/auth/session')).data.user.emailVerifiedAt);
    pass('legacy account keeps its ID and profile, cannot create new gameplay identity, and verifies only in its own session');

    const s = await connect(a.c), id = await room();
    let update = event(s,'stateUpdate'); s.emit('joinRoom',{roomId:id}); await update;
    let seat = event(s,'autoSeated'); s.emit('sitAtTable',{seatIdx:0}); await seat;
    db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(user.id);
    s.close(); const resumed = await connect(a.c);
    seat = event(resumed,'autoSeated'); resumed.emit('joinRoom',{roomId:id}); assert.equal((await seat).seatIdx,0);
    const noNew = event(resumed,'error'); resumed.emit('joinRoom',{roomId:await room()}); assert.match(await noNew,/email/);
    assert.equal(db.prepare('SELECT id FROM users WHERE id=?').get(user.id).id,user.id);
    pass('legacy active seat reconnect is retained while a new room is blocked');

    const limited = await begin('ResendLimit');
    for (let i=0;i<5;i++) { retryNow(limited.email); assert.equal((await req(limited.c,'/api/auth/resend-verification',{json:{}})).status,202); }
    retryNow(limited.email); assert.equal((await req(limited.c,'/api/auth/resend-verification',{json:{}})).status,429);
    const secure = await fetch(base+'/api/auth/registration',{headers:{'X-Forwarded-Proto':'https'}});
    assert.ok(secure.headers.get('set-cookie').includes('HttpOnly'));
    assert.ok(secure.headers.get('set-cookie').includes('Secure'));
    assert.ok(secure.headers.get('set-cookie').includes('SameSite=Strict'));
    for (const {code} of fs.readFileSync(outbox,'utf8').trim().split('\n').map(line=>JSON.parse(line))) assert.ok(!logs.includes(code),'codes are never logged');
    pass('resends are bounded and plaintext codes never appear in application logs');
  } finally {
    for (const socket of sockets) socket.close(); db?.close(); await stop();
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
