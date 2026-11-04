'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/poker.js', 'utf8');
const a = source.indexOf('function _desktopTableScale('), b = source.indexOf('\nfunction adjustTableScale(', a);
assert.ok(a >= 0 && b > a);
const context = {}; vm.createContext(context); vm.runInContext(source.slice(a, b), context);
const scale = context._desktopTableScale;
for (const [width, height] of [[1366,768],[1440,900],[1536,864],[1600,900],[1920,1080],[2560,1440],
  [1100,586],[1093,614],[900,600],[844,390]]) {
  const roomHeight = height - 80;
  const result = scale(width, roomHeight);
  assert.ok(result > 0 && result <= 1.3);
  assert.ok(result * 1750 <= (width - 12) * 1.03 + 1e-6);
  assert.ok(result * 960 <= (roomHeight - 12) * 1.03 + 1e-6);
  const old = Math.min(width / 1750, roomHeight / 1150, 1.3);
  if (width === 2560) assert.equal(result, old, '2K view keeps its established scale');
  else if (width >= 1000) assert.ok(result > old * 1.1, 'compact view gains meaningful size');
  console.log(`PASS  ${width}x${height}: ${old.toFixed(3)} -> ${result.toFixed(3)}`);
}
assert.ok(scale(1093, 534) >= .55 && scale(1093, 534) <= .57);
assert.ok(scale(1100,506) >= .53 && scale(1100,506) < .531);
for(const content of [{left:-20,right:1020,top:30,bottom:610,width:1040,height:580},{left:100,right:900,top:70,bottom:585,width:800,height:515}]){
  const viewport={left:0,right:1000,top:80,bottom:586,width:1000,height:506},center={x:500,y:333};
  const fit=context._desktopContentFit(content,viewport,center);
  assert.ok(center.x+(content.left-center.x)*fit.factor+fit.x>=viewport.left+.25-1e-6);
  assert.ok(center.x+(content.right-center.x)*fit.factor+fit.x<=viewport.right-.25+1e-6);
  assert.ok(center.y+(content.top-center.y)*fit.factor+fit.y>=viewport.top+.25-1e-6);
  assert.ok(center.y+(content.bottom-center.y)*fit.factor+fit.y<=viewport.bottom-.25+1e-6);
}
assert.ok(scale(1100, 506) > .5, '0.44 baseline becomes larger without cropping the full envelope');
assert.equal(scale(1, 1), 0);
assert.equal(scale(0, 0), 0);
assert.ok(scale(1200, 700) > scale(1000, 500), 'room resize recalculates the scale');
const css = fs.readFileSync('public/poker.css', 'utf8');
assert.match(css, /\.pk-seat\{[^}]*width:180px;height:210px/);
assert.match(css, /mobile-portrait \.pk-seat\{width:122px/);
assert.match(css, /mobile-portrait\.table-9 \.pk-seat\{width:104px/);
assert.ok(168 + 2 * 4 + 2 * 2 <= 180, 'wider desktop name still fits the original seat');
assert.ok(111 + 2 * 4 + 2 <= 122, '6-max mobile name fits existing seat');
assert.ok(96 + 2 * 3 + 2 <= 104, '9-max mobile name fits existing seat');
assert.match(css, /@media\(max-width:400px\)\{#gameRoom\.mobile-portrait:not\(\.table-9\) \.you-seat \.pk-name\{width:98px;max-width:98px/);
assert.match(source, /if \(isPortrait\) scale \*= 0\.96;/);
assert.match(source, /Math\.max\(0, rw - 4\) \/ table\.offsetWidth/);
console.log('PASS  viewport-only desktop fit, original portrait inset and unchanged seat dimensions');
