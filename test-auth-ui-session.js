'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
let resolveSession;
const context = { window, Headers, AbortController, setTimeout, clearTimeout, fetch: () => new Promise(resolve => { resolveSession = resolve; }) };
vm.runInNewContext(fs.readFileSync('public/site/js/api.js','utf8'),context);
(async()=>{
  const api = window.AntikApi;
  const stale = api.session({refresh:true});
  const authenticated = {authenticated:true,user:{id:'new-user'},csrfToken:'new-csrf'};
  api.setSession(authenticated);
  resolveSession({ok:true,headers:new Headers({'Content-Type':'application/json'}),json:async()=>({authenticated:false})});
  assert.equal(await stale,authenticated);
  assert.equal(await api.session(),authenticated);
  const staleLogout = api.session({refresh:true});
  const loggedOut={authenticated:false};
  api.setSession(loggedOut);
  resolveSession({ok:true,headers:new Headers({'Content-Type':'application/json'}),json:async()=>authenticated});
  assert.equal(await staleLogout,loggedOut);
  console.log('PASS  stale session fetch cannot overwrite automatic login or restore a logged-out UI session');
})().catch(error=>{console.error(error);process.exitCode=1;});
