'use strict';

const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, 'public', 'poker.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'public', 'poker.css'), 'utf8');
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
}

check('portrait table keeps a four-percent viewport inset', /if \(isPortrait\) scale \*= 0\.96;/.test(js));
check('mobile chat input prevents iOS focus zoom',
  /mobile-portrait \.game-chat-form input\{font:16px/.test(css)
  && /setMobileChatViewportLock\(true\)/.test(js));
check('hero bet is anchored outside the right card edge', /you-seat\.dir-bottom \.pk-bet-chip\{[^}]*left:auto;right:-56px/.test(css));
check('reactions use live avatar geometry', /function _avatarAnchor\([\s\S]*getBoundingClientRect\(\)[\s\S]*function _positionReactionEntry/.test(js));
check('active reactions are repositioned after layout changes', /_activeReactionEls\.forEach\(_positionReactionEntry\)/.test(js));
check('winner crowns are hosted outside replaceable seat markup', /host\.appendChild\(crown\)/.test(js) && !/seatEl\.appendChild\(crown\)/.test(js));
check('winner crowns are restored after seat rendering', /renderReactionBtn\(\);\s*requestAnimationFrame\(syncAvatarAnchoredEffects\)/.test(js));
check('mobile chat is viewport-fixed and does not focus-scroll on open',
  /mobile-portrait \.game-chat\{position:fixed;/.test(css)
  && /if\(!mobile\) setTimeout\([\s\S]*focus\(\{preventScroll:true\}\)/.test(js));
check('mobile action panel uses compact primary buttons',
  /mobile-portrait #actionControls\.mobile-actions\{[^}]*width:min\(192px,46vw\)/.test(css)
  && /mobile-portrait #actionControls \.gr-btn\{[^}]*height:42px/.test(css));
check('mobile hero is lifted with its attached cards and badges',
  /mobile-portrait \.you-seat\{left:40%!important;bottom:10px!important/.test(css));
check('desktop chat bubbles are larger while mobile text stays unchanged',
  /seat-chat-bubble-text\{font:700 15px/.test(css)
  && /mobile-portrait \.seat-chat-bubble-text\{font-size:11px/.test(css));
check('mobile dealer button uses dedicated hero and lower-side positions',
  /DEALER_BTN_POS_6_MOBILE[\s\S]*bottom:1%; left:41%/.test(js)
  && /DEALER_BTN_POS_9_MOBILE[\s\S]*bottom:4%; left:25%/.test(js));

const failed = checks.filter(check => !check.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} passed ===`);
process.exit(failed.length ? 1 : 0);
