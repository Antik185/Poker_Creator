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
  ['action-fold.mp3', 'action-check.mp3', 'action-call.mp3', 'action-bet.mp3', 'action-raise.mp3', 'action-all-in.mp3']
    .every(file => js.includes(`/sounds/${file}`)
      && fs.statSync(path.join(__dirname, 'public', 'sounds', file)).size > 1000));
check('latest table action interrupts stale voice and multiplayer fold is announced',
  /function speak\(text\)[\s\S]{0,220}stopChannel\('action'\)[\s\S]{0,160}channel:'action'/.test(js)
  && /if \(action === 'fold'\) \{\s*speak\('Fold'\);/.test(js));
check('smart action voice is the default and only announces significant actions',
  /const SMART_ACTION_VOICE = new Set\(\['bet', 'raise', 'all in'\]\)/.test(js)
  && /localStorage\.getItem\('pokerActionVoiceMode'\) === 'full' \? 'full' : 'smart'/.test(js)
  && /actionVoiceMode !== 'full' && !SMART_ACTION_VOICE\.has\(action\)/.test(js));
check('players can switch between smart and full action voice modes',
  /data-action-voice-mode="smart"/.test(html)
  && /data-action-voice-mode="full"/.test(html)
  && /localStorage\.setItem\('pokerActionVoiceMode', actionVoiceMode\)/.test(js)
  && /button\.setAttribute\('aria-checked', selected \? 'true' : 'false'\)/.test(js));
check('call keeps its chip sound when smart voice suppresses the spoken action',
  /p\.lastAction==='CHECK' \? sndCheck\(\) : sndChip\(\)/.test(js)
  && /isCheck \? sndCheck\(\) : sndChip\(\)/.test(js));
check('check badge never displays the posted blind amount',
  /const actionShowsAmount = \['BET','RAISE','CALL','ALL-IN'\]\.includes\(seat\.lastAction\)/.test(js)
  && /actionShowsAmount&&seat\.bet>0/.test(js));
check('a stale call button is normalized to a free check',
  /if\(action==='call'&&toCall<0\.005\) action='check'/.test(js));
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
check('blocked playback exposes the unlock prompt on desktop but not on mobile tables',
  /catch\(error=>\{[\s\S]*this\.markBlocked\(error\)/.test(js)
  && /id="audioUnlockPrompt"/.test(html)
  && /Нажмите, чтобы включить звуки игры/.test(html)
  && /const mobileTable = _isMobileTableView\(\);[\s\S]{0,160}const show = !mobileTable/.test(js));
check('game samples are cached and preloaded once through AudioManager',
  /preload\(paths\)\{[\s\S]*paths\.forEach\(path=>this\.template\(path\)\)/.test(js)
  && /preloadGameSounds\(\)/.test(js));
check('all-in music is excluded from critical preload and uses one compact cross-browser source',
  /this\.music\.preload = 'none'/.test(js)
  && /allin_user_loop_mobile\.wav/.test(js)
  && !/allin_user_loop_fixed\.wav/.test(js)
  && !/preload\(paths\)\{[\s\S]{0,120}this\.ensureMusic\(\)/.test(js)
  && fs.statSync(path.join(__dirname, 'public', 'sounds', 'allin_user_loop_mobile.wav')).size < 800 * 1024);
check('all-in music recovers from mobile pause and ended events without parallel play attempts',
  /this\.music\.addEventListener\('pause',[\s\S]{0,180}scheduleMusicRecovery/.test(js)
  && /this\.music\.addEventListener\('ended',[\s\S]{0,220}scheduleMusicRecovery/.test(js)
  && /if\(this\.musicPlayPromise\) return this\.musicPlayPromise/.test(js));
check('normal street transitions do not enter all-in reveal or music mode',
  /function isAllInRunout\(\)[\s\S]{0,260}contenders\.filter\(p=>p\.stack>0\)\.length<=1/.test(js)
  && (js.match(/isAllInRunout\(\)/g) || []).length >= 6
  && !/G\.actingSeat === -1 && activePlayers\(\)\.length > 1/.test(js)
  && /_isAllInRunout\(\)[\s\S]{0,320}contenders\.filter\(s => s\.stack > 0\)\.length <= 1/.test(engine));
check('rocket menu uses a compact preloaded icon',
  /icon: '\/effects\/texas-rocket-icon-menu\.png'/.test(js)
  && /preloadRocketMenuIcon\(\)/.test(js)
  && fs.statSync(path.join(__dirname, 'public', 'effects', 'texas-rocket-icon-menu.png')).size < 100 * 1024);
check('heavy rocket layers preload at low priority only after taking a seat',
  /function preloadTableEffectsWhenIdle\(\)/.test(js)
  && /requestIdleCallback\(load,\{timeout:2000\}\)/.test(js)
  && /image\.fetchPriority='low'/.test(js)
  && /oldUserSeat<0 && G\.userSeat>=0[\s\S]{0,100}preloadTableEffectsWhenIdle\(\)/.test(js)
  && !/DOMContentLoaded[\s\S]{0,300}preloadTableEffects\(\)/.test(js));
check('table redirect keeps its status text without the slot icon',
  /Игра начинается!/.test(lobby)
  && /Садимся за стол\.\.\./.test(lobby)
  && !/class="redirect-icon"/.test(lobby)
  && !lobby.includes('🎰'));
check('winner presentation waits for the final board-card reveal',
  /revealPeekCard\(\(\)=>presentHandWinners\(payload\)\)/.test(js)
  && /serverG\.phase === 'SHOWDOWN'[\s\S]{0,180}oldBoardPeekIdx/.test(js)
  && /this\.G\.phase === 'RIVER' \? 6000 : 4200/.test(engine));
check('realtime retains the polling-first Socket.IO handshake for mobile compatibility',
  /io\(\{ path: '\/realtime\/' \}\)/.test(js)
  && /io\(\{ path: '\/realtime\/' \}\)/.test(lobby)
  && !/transports: \['websocket', 'polling'\]/.test(js)
  && !/transports: \['websocket', 'polling'\]/.test(lobby));
check('backgrounding suspends sounds and foregrounding recovers both audio engines',
  /function recoverVisibleGameState\(\)\{[\s\S]{0,80}recoverGameAudio\(\)/.test(js)
  && /visibilitychange[\s\S]{0,180}suspendGameAudio\(\)[\s\S]{0,180}recoverVisibleGameState\(\)/.test(js)
  && /pageshow',recoverVisibleGameState/.test(js)
  && /this\.resumeContext\(\)/.test(js));
check('foregrounding after showdown replaces a stale face-down river canvas',
  js.includes("if(document.visibilityState==='hidden' || G.phase!=='SHOWDOWN' || G.boardPeekIdx < 0) return;")
  && js.includes('ANIM.peekRevealedIdx = G.boardPeekIdx;')
  && /function recoverVisibleGameState\(\)[\s\S]{0,420}_finishPeekReveal\(\)/.test(js)
  && /visibilitychange[\s\S]{0,180}recoverVisibleGameState\(\)/.test(js));
check('reaction renderer derives mobile mode before limiting active effects',
  /function _fireReactionAtSeat\([\s\S]*const mobilePortrait=document\.getElementById\('gameRoom'\)[\s\S]*const limit=mobilePortrait\?2:3/.test(js));

const failed = checks.filter(check => !check.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} passed ===`);
process.exit(failed.length ? 1 : 0);
