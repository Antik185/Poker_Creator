'use strict';

const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, 'public', 'poker.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'poker.html'), 'utf8');
const lobby = fs.readFileSync(path.join(__dirname, 'public', 'lobby.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server', 'index.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, 'server', 'gameEngine.js'), 'utf8');
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
check('one AudioManager owns cached sounds, music, effects and Web Audio',
  /class GameAudioManager/.test(js)
  && /this\.templates = new Map\(\)/.test(js)
  && /this\.music = null/.test(js)
  && /channel:'effect'/.test(js));
check('browser speech synthesis is not used for poker actions',
  !/speechSynthesis|SpeechSynthesisUtterance/.test(js));
check('all spoken actions use canonical static resources',
  ['action-fold.mp3', 'action-check.wav', 'action-call.mp3', 'action-bet.mp3', 'action-raise.mp3', 'action-all-in.mp3']
    .every(file => js.includes(`/sounds/${file}`)
      && fs.statSync(path.join(__dirname, 'public', 'sounds', file)).size > 1000));
check('mute and volume preferences survive navigation and table changes',
  /localStorage\.getItem\('pokerMuted'\)/.test(js)
  && /localStorage\.setItem\('pokerMuted'/.test(js)
  && /localStorage\.getItem\('pokerMasterVolume'\)/.test(js)
  && /localStorage\.setItem\('pokerMasterVolume'/.test(js));
check('unmute performs an explicit user-gesture media unlock',
  /unlockGameAudio\(true\)/.test(js)
  && /const AUDIO_UNLOCK_PROBE = 'data:audio\/wav;base64,/.test(js)
  && /const probe = new Audio\(AUDIO_UNLOCK_PROBE\)/.test(js)
  && /if\(this\.mediaUnlockPromise\) return this\.mediaUnlockPromise/.test(js)
  && /Promise\.resolve\(probe\.play\(\)\)/.test(js));
check('action effects are unique and ignored outside an active hand',
  /const eventId = `\$\{this\.id\}:\$\{this\.G\.handNum\}:\$\{\+\+this\.actionEventSequence\}`/.test(engine)
  && /playerActionEffect'[\s\S]{0,160}eventId/.test(engine)
  && /_seenActionEffects\.has\(eventId\)/.test(js)
  && /G\.phase === 'WAITING' \|\| G\.phase === 'SHOWDOWN'/.test(js));
check('blocked playback is handled and exposes a user unlock prompt',
  /catch\(error=>\{[\s\S]*this\.markBlocked\(error\)/.test(js)
  && /id="audioUnlockPrompt"/.test(html)
  && /Нажмите, чтобы включить звуки игры/.test(html));
check('game samples are cached and preloaded once through AudioManager',
  /preload\(paths\)\{[\s\S]*paths\.forEach\(path=>this\.template\(path\)\)/.test(js)
  && /preloadGameSounds\(\)/.test(js));
check('all-in music is excluded from critical preload and has a smaller mobile source',
  /this\.music\.preload = 'none'/.test(js)
  && /allin_user_loop_mobile\.wav/.test(js)
  && !/preload\(paths\)\{[\s\S]{0,120}this\.ensureMusic\(\)/.test(js)
  && fs.statSync(path.join(__dirname, 'public', 'sounds', 'allin_user_loop_mobile.wav')).size < 800 * 1024);
check('realtime retains the polling-first Socket.IO handshake for mobile compatibility',
  /io\(\{ path: '\/realtime\/' \}\)/.test(js)
  && /io\(\{ path: '\/realtime\/' \}\)/.test(lobby)
  && !/transports: \['websocket', 'polling'\]/.test(js)
  && !/transports: \['websocket', 'polling'\]/.test(lobby));
check('backgrounding suspends sounds and foregrounding recovers both audio engines',
  /visibilitychange[\s\S]*suspendGameAudio\(\)[\s\S]*recoverGameAudio\(\)/.test(js)
  && /pageshow',recoverGameAudio/.test(js)
  && /this\.resumeContext\(\)/.test(js));
check('reaction renderer derives mobile mode before limiting active effects',
  /function _fireReactionAtSeat\([\s\S]*const mobilePortrait=document\.getElementById\('gameRoom'\)[\s\S]*const limit=mobilePortrait\?2:3/.test(js));

const failed = checks.filter(check => !check.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} passed ===`);
process.exit(failed.length ? 1 : 0);
