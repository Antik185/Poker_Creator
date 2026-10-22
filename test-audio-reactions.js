'use strict';

const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, 'public', 'poker.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server', 'index.js'), 'utf8');
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
}

check('uploaded reaction URLs are always classified as images',
  /function _isReactionImage\([\s\S]*\/uploads\\\/reactions/.test(js));
check('both bot reaction paths use the shared image classifier',
  (js.match(/_isReactionImage\(rx\)/g) || []).length >= 2);
check('failed GIF loads remove the effect without alt text',
  /img\.alt = '';[\s\S]*img\.addEventListener\('error'/.test(js));
check('server rejects arbitrary text as an emoji reaction',
  /type === 'emoji'[\s\S]*room\.config\.reactions\.includes\(content\)/.test(server));
check('mute pauses all-in music without clearing its request',
  /if\(isMuted\)\{\s*stopAllInMusic\(true\)/.test(js));
check('unmute performs a user-gesture audio unlock',
  /\}else\{\s*unlockGameAudio\(\);/.test(js));
check('game samples are cached and preloaded after interaction',
  /const _soundTemplates = new Map\(\)/.test(js) && /preloadGameSounds\(\)/.test(js));
check('backgrounding suspends sounds and foregrounding recovers both audio engines',
  /visibilitychange[\s\S]*suspendGameAudio\(\)[\s\S]*recoverGameAudio\(\)/.test(js)
  && /pageshow',recoverGameAudio/.test(js)
  && /audioCtx\.state!=='running'/.test(js));
check('reaction renderer derives mobile mode before limiting active effects',
  /function _fireReactionAtSeat\([\s\S]*const mobilePortrait=document\.getElementById\('gameRoom'\)[\s\S]*const limit=mobilePortrait\?2:3/.test(js));

const failed = checks.filter(check => !check.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} passed ===`);
process.exit(failed.length ? 1 : 0);
