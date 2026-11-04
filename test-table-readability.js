'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const js = fs.readFileSync('public/poker.js', 'utf8').replace(/\r\n/g,'\n');
const css = fs.readFileSync('public/poker.css', 'utf8');
const html = fs.readFileSync('public/poker.html', 'utf8');
const section = (start, end) => {
  const a=js.indexOf(start), b=js.indexOf(end,a);
  assert.ok(a>=0 && b>a, start); return js.slice(a,b);
};
const ctx={}; vm.createContext(ctx);
vm.runInContext(section('function _desktopActionFit(', 'function syncDesktopReadability('),ctx);
for(const scale of [.515,.544,.704,.816,.805,.842]){
  for(const obstacle of [[],[{left:850,right:950,bottom:380}]]){
    const anchor={left:obstacle.length?850:607,bottom:559}, bounds={left:0,right:1100,top:80,bottom:586};
    const width=obstacle.length?244:480,height=obstacle.length?214:90;
    const result=ctx._desktopActionFit(scale,width,height,anchor,bounds,obstacle);
    const total=scale*result.zoom;
    const bottom=anchor.bottom+result.shift*scale, top=bottom-height*total;
    assert.ok(total>0 && total<=1);
    assert.ok(58*total>=50 && 22*total>=19, 'laptop panel keeps 19px text and larger buttons');
    assert.ok(anchor.left+width*total<=bounds.right-6+1e-6);
    assert.ok(top>=bounds.top+6-1e-6 && bottom<=bounds.bottom-6+1e-6);
    if(obstacle.length) assert.ok(top>=obstacle[0].bottom+4-1e-6);
  }
}
const constrained=ctx._desktopActionFit(.4,440,71,{left:500,bottom:300},{left:0,right:720,top:60,bottom:390},[]);
assert.ok(constrained.zoom*.4<1, 'narrow fallback respects available width instead of forcing a large scale');
assert.match(css, /desktop-readable #actionControls\{width:480px;transform-origin:left bottom/);
assert.match(css, /desktop-readable #actionControls \.gr-btn\{[^}]*height:58px;font-size:22px/);
assert.match(css, /desktop-readable #actionControls \.bet-pre\{[^}]*font-size:17px/);
assert.match(css, /desktop-readable \.tournament-hud\{font-size:14px/);
assert.match(css, /desktop-readable \.gr-room\{min-height:0;min-width:0;overflow:clip/);
assert.match(css, /side-actions\.showing-pre-actions \.gr-btns\{display:none!important/);
assert.match(js, /amount\.scrollWidth>available/);
assert.match(js, /event\.target\.classList\.contains\('pk-card'\)\) scheduleTableLayout\(\)/);
assert.match(css, /desktop-readable \.pot-badge\{font-size:calc\(16px \/ var\(--table-visual-scale\)\)/);
assert.match(css, /desktop-chat-bubble \.seat-chat-bubble-text\{font-size:max\(16px,calc\(30px \* var\(--table-visual-scale\)\)\)/);
assert.match(css, /desktop-reaction-picker \.rp-item\{width:100%;height:62px;font-size:40px/);
assert.match(css, /desktop-table \.pk-name\{width:168px;max-width:168px/);
assert.match(css, /desktop-readable \.pk-chips\{[^}]*--stack-text-length/);
assert.match(css, /desktop-readable \.pk-bet-amt\{[^}]*--bet-text-length/);
assert.doesNotMatch(css, /desktop-readable[^{}]*\.pk-name(?:\b|-)/);
assert.match(js, /!gameRoom\.classList\.contains\('mobile-portrait'\) && !_isMobileTableView\(\) && scale > 0 && scale < \.99/);
assert.match(js, /controls\.style\.removeProperty\('transform'\)/);
const slider={value:30000,min:15000,max:990000};
const input={value:'',dataset:{unit:'money'},style:{}};
const label={},button={}; let layouts=0;
const elements={betSlider:slider,betAmtInput:input,betAmtVal:label,btnRaise:button};
const G={handNum:1,phase:'FLOP',actingSeat:0,turnId:42,currentBet:100,currentBb:50};
const edits={document:{getElementById:id=>elements[id]||null,activeElement:null},G,CFG:{bb:50},
  _chipDisplayMode:'money',formatTableAmount:value=>'$'+value.toFixed(2),syncDesktopReadability:()=>layouts++};
vm.createContext(edits);
vm.runInContext(section('function syncBetVal(', '// Tracks whether we'),edits);
edits.syncBetVal(); assert.equal(input.value,'$300.00');
for(const [text,expected] of [['250.50',25050],['250,50',25050],['$350.25',35025],['1',15000],['99999999',990000],['4 BB',20000]]){
  input.value=text; edits.commitBetAmount(); assert.equal(Number(slider.value),expected,text);
}
for(const text of ['', '-200', 'NaN', 'Infinity', '1e9', '$2 BB', '<img>', '200oops']){
  const before=slider.value; input.value=text; edits.commitBetAmount(); assert.equal(slider.value,before,text);
}
input.dataset.unit='bb'; input.value='5.5'; edits.commitBetAmount(); assert.equal(slider.value,27500);
edits.document.activeElement=input; input.value='draft'; edits.syncBetVal(); assert.equal(input.value,'draft','state refresh does not destroy an in-progress edit');
G.turnId++; edits.syncBetVal(); assert.notEqual(input.value,'draft','a new turn resets the draft to the valid slider amount');
assert.ok(layouts>0);
assert.match(html, /id="betAmtInput"[^>]*inputmode="decimal"/);
assert.match(html, /onchange="commitBetAmount\(\)"/);
assert.match(css, /\.bet-amount-input\{display:none;\}/);
console.log('PASS desktop panel fit, geometry bounds, wider PC names, unchanged mobile and validated amount editing');
const popup={};vm.createContext(popup);
vm.runInContext(section('function _desktopPickerPlacement(', 'function positionReactionPicker('),popup);
for(const viewport of [{left:0,top:0,width:1100,height:586},{left:0,top:0,width:1366,height:768},{left:0,top:0,width:320,height:300}]){
  const placed=popup._desktopPickerPlacement({left:500,right:600,bottom:530},viewport,{width:298,height:420});
  assert.ok(placed.left>=8 && placed.top>=8);
  assert.ok(placed.left+Math.min(298,viewport.width-16)<=viewport.width-8);
  assert.ok(placed.top+placed.maxHeight<=viewport.height-8);
}
const bounds={left:0,top:80,width:1100,height:506};let anchor;
const host={getBoundingClientRect:()=>bounds,appendChild(b){b.parentElement=this;}};
const avatar={getBoundingClientRect:()=>anchor};
const seat={querySelector:()=>avatar};
const bubble={classList:{toggle(){}},style:{},getBoundingClientRect:()=>({width:280,height:80})};
const chat={document:{querySelector:selector=>selector==='.gr-room'?host:selector==='.big-table'?{}:seat,
  getElementById:()=>({classList:{contains:value=>value==='desktop-readable'}})}};
vm.createContext(chat);vm.runInContext(section('function positionSeatChatBubble(', 'function showSeatChatBubble('),chat);
for(anchor of [{left:490,top:450,width:80,bottom:530},{left:0,top:85,width:80,bottom:165},{left:1020,top:90,width:80,bottom:170}]){
  chat.positionSeatChatBubble(bubble,0);
  assert.ok(parseFloat(bubble.style.left)>=4 && parseFloat(bubble.style.left)+280<=bounds.width-4);
  assert.ok(parseFloat(bubble.style.top)>=4 && parseFloat(bubble.style.top)+80<=bounds.height-4);
}
console.log('PASS larger laptop reactions escape table scale; chat bubbles remain in bounds for edge and upper seats');
