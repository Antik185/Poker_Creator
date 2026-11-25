'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = app.listen(0, '127.0.0.1');
  const io = new Server(server, { path: '/realtime/' });
  let browser;
  try {
    if (!server.listening) await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    browser = await chromium.launch(process.env.CHROMIUM_EXE ? { executablePath: process.env.CHROMIUM_EXE } : {});
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [width,height,seats,touch,reduced] of [
      [1366,768,6,false], [1366,768,9,false], [390,844,6,true], [390,844,9,true],
      [320,720,6,true], [320,720,9,true], [844,390,9,true], [390,844,9,true,true]
    ]) await checkCatThiefLayout(browser,base,{width,height},seats,touch,reduced);
    for (const layout of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      for (const size of [6, 9]) await checkLayout(browser, base, layout, size);
    }
    await checkLayout(browser, base, { width: 390, height: 844 }, 9, true);
    for (const [width,height,seats,touch,reduced] of [
      [320,720,6,true], [430,920,9,true], [844,390,9,true],
      [1200,720,6,false], [1920,1080,6,false], [2560,1440,9,false], [390,844,9,true,true]
    ]) await checkSnowstorm(browser, base, { width,height }, seats, touch, reduced);
    await checkSlowSnowstormArt(browser,base);
  } finally {
    try { await browser?.close(); }
    finally { await io.close(); }
  }
}

async function checkSnowstorm(browser, base, viewport, seats, touch, reduced = false) {
  const page = await browser.newPage({ viewport,isMobile:touch,hasTouch:touch,reducedMotion:reduced ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const portrait = touch && viewport.width < viewport.height;
  try {
    await page.goto(base + '/poker.html', { waitUntil:'domcontentloaded' });
    await page.evaluate(({seats,portrait,custom}) => {
      setTableSize(seats);
      openTablePreview();
      setPreviewDevice(portrait ? 'phone' : 'desktop');
      _tablePreviewMode = false;
      G.seats[seats-1] = null;
      renderTable();
      if(custom){
        CFG.feltType = 'photo';
        CFG.feltPhotoUrl = '/effects/snowstorm-flake.webp';
        applyFelt();
        document.querySelector('.gr-room').style.backgroundImage = 'url(/effects/snowball.webp)';
      }
      preloadStickers();
      const original = drawSnowstorm;
      window.stormPaint = [];
      window.windSounds = [];
      const play = _gameAudioManager.play.bind(_gameAudioManager);
      _gameAudioManager.mediaUnlocked = true;
      _gameAudioManager.play = (src, options) => {
        if (src !== SNOWSTORM_WIND_SOUND) return play(src, options);
        window.windSounds.push(options);
        return Promise.resolve(true);
      };
      drawSnowstorm = (...args) => {
        const before = performance.now();
        original(...args);
        window.stormPaint.push({ms:performance.now()-before,small:args[4]});
      };
    }, {seats,portrait,custom:viewport.width !== 320 && viewport.width !== 1920});
    await page.waitForFunction(() => _rocketAssets.snowstorm.naturalWidth > 0 && _rocketAssets.snowCap.naturalWidth > 0);
    await page.waitForFunction(() => preloadSnowstormTheme().every(asset => asset.ready));
    const sprite = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const image = _rocketAssets.snowstorm;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image,0,0);
      return [ctx.getImageData(0,0,1,1).data[3], ctx.getImageData(canvas.width/2,canvas.height/2,1,1).data[3]];
    });
    assert.deepEqual(sprite, [0,255], 'the source sprite has a transparent background and visible flake');
    const playerNames = () => page.locator('.pk-seat:not(.empty) .pk-name').allTextContents();
    const names = await playerNames();
    assert.equal(names.length, seats-1);
    assert.ok(names.some(name => name.includes('(you)')));
    const trigger = page.locator('#reactionBtnEl');
    const canvas = page.locator('.sticker-effects-canvas');
    const railSnow = page.locator('.big-rail > .snowstorm-rail');
    const railOpacity = () => railSnow.evaluate(el => Number(getComputedStyle(el).opacity));
    const theme = page.locator('.snowstorm-theme');
    const themeOpacity = () => theme.evaluateAll(elements => elements.map(el => +getComputedStyle(el).opacity));
    const originalArt = () => page.evaluate(() => [document.querySelector('.gr-room').style.backgroundImage,
      document.getElementById('bigFeltPhoto').style.backgroundImage]);
    const original = await originalArt();
    assert.equal(await theme.count(),0);
    await trigger.click();
    const storm = page.locator('#reactionPickerEl .rp-grid').getByRole('button', {name:'Снежная буря'});
    assert.equal(await storm.locator('img').getAttribute('src'), '/effects/snowstorm-flake.webp');
    await storm.click();
    await canvas.waitFor();
    await page.waitForFunction(() => _stickerPlayback?.effects[0]?.windSoundHandled);
    const initialSounds = await page.evaluate(() => window.windSounds);
    if (reduced) assert.deepEqual(initialSounds,[]);
    else {
      assert.equal(initialSounds.length,1,'the soundtrack starts with the snowfall');
      assert.equal(initialSounds[0].channel,'effect');
      assert.equal(initialSounds[0].volume,.26);
      assert.ok(initialSounds[0].startAt < .25);
    }
    assert.equal(await page.locator('#playerContextMenu.show').count(), 0);
    await seekStorm(page,1000);
    assert.equal(await railSnow.count(),0,'the rail is clear before the gust');
    assert.equal(await theme.count(),2);
    assert.ok((await themeOpacity()).every(alpha => alpha > 0 && alpha < .45),'both originals crossfade into winter art');
    const placement = await theme.evaluateAll(elements => elements.map(el => ({parent:el.parentElement.className,
      clip:getComputedStyle(el.parentElement).overflow,pointer:getComputedStyle(el).pointerEvents,
      size:getComputedStyle(el).backgroundSize,art:el.style.backgroundImage})));
    const suffix = viewport.width <= 650 ? '-mobile' : '';
    assert.ok(placement[0].parent.includes('gr-room') && placement[0].art.includes(`winter-room${suffix}.webp`));
    assert.ok(placement[1].parent.includes('big-felt') && placement[1].clip === 'hidden' && placement[1].art.includes(`winter-felt${suffix}.webp`));
    assert.ok(placement.every(el => el.pointer === 'none' && el.size === 'cover'));
    assert.deepEqual(await originalArt(),original);
    const physics = await page.evaluate(() => {
      const flakes = _stickerPlayback.effects[0].flakes;
      const bounds = document.getElementById('tableEffectsLayer').getBoundingClientRect();
      const mean = values => values.reduce((sum,value) => sum+value,0)/values.length;
      return {
        count:flakes.length,
        startsAbove:flakes.every(flake => snowstormFlakeAt(flake,0,bounds).y < 0),
        falls:flakes.every(flake => snowstormFlakeAt(flake,1900,bounds).y > snowstormFlakeAt(flake,950,bounds).y),
        gust:mean(flakes.map(flake => snowstormFlakeAt(flake,5200,bounds).x-snowstormFlakeAt(flake,4100,bounds).x))/bounds.width,
        calm:mean(flakes.map(flake => snowstormFlakeAt(flake,7200,bounds).x-snowstormFlakeAt(flake,6100,bounds).x))/bounds.width
      };
    });
    assert.equal(physics.count,28);
    assert.ok(physics.startsAbove && physics.falls && physics.gust > .1 && Math.abs(physics.calm) < .04);
    const wind = await page.evaluate(() => {
      const sample = document.createElement('canvas');
      sample.width = 480;
      sample.height = 400;
      const ctx = sample.getContext('2d');
      const stroke = ctx.stroke.bind(ctx);
      let strokes = 0;
      ctx.stroke = () => { strokes++; stroke(); };
      return [3900, 4430, 4740, 5260, 5600].map(age => {
        strokes = 0;
        ctx.clearRect(0,0,sample.width,sample.height);
        drawSnowstormWind(ctx,sample,age);
        const pixels = ctx.getImageData(0,0,sample.width,sample.height).data;
        let alpha = 0, x = 0, max = 0;
        for (let i=3; i<pixels.length; i+=4) {
          alpha += pixels[i];
          x += pixels[i] * (((i-3)/4)%sample.width);
          max = Math.max(max,pixels[i]);
        }
        return { alpha, x:alpha ? x/alpha/sample.width : null, max, strokes };
      });
    });
    assert.equal(wind[0].alpha,0);
    assert.equal(wind[4].alpha,0);
    assert.ok(wind[1].x < .35 && wind[3].x > .77, 'the wind crosses from left to right');
    assert.equal(wind[2].strokes,12,'six streams, each with one soft outer stroke and one core');
    assert.ok(wind[2].max >= 34 && wind[2].max <= 112 && wind[2].alpha > 0,'visible, translucent streams');
    await seekStorm(page,4050);
    const sounds = await page.evaluate(() => window.windSounds);
    assert.deepEqual(sounds,initialSounds,'the gust does not start a duplicate track');
    await seekStorm(page,5000);
    assert.deepEqual(await themeOpacity(),[1,1]);
    assert.ok((await railOpacity()) > .04 && (await railOpacity()) < .45,'snow builds gradually during the gust');
    assert.equal(await canvas.evaluate(el => getComputedStyle(el).pointerEvents),'none');
    if (!reduced) {
      const {painted,protectedUI} = await canvas.evaluate(el => {
        const {left,top,width,height} = el.getBoundingClientRect();
        const pixels = el.getContext('2d').getImageData(0,0,el.width,el.height).data;
        const protectedUI = [...document.querySelectorAll('#actionControls,#gameRoom .blinds-badge,#gameRoom .pk-bet-chip.show')]
          .map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height)
          .every(rect => {
            const x = Math.floor((rect.left-left+rect.width/2)*el.width/width);
            const y = Math.floor((rect.top-top+rect.height/2)*el.height/height);
            return x < 0 || y < 0 || x >= el.width || y >= el.height || pixels[(y*el.width+x)*4+3] === 0;
          });
        return {painted:pixels.some((value,i) => i%4 === 3 && value > 30),protectedUI};
      });
      assert.ok(painted, 'falling flakes are actually drawn');
      assert.ok(protectedUI, 'wind leaves action buttons, blind and bet labels clear');
      if (process.env.STICKER_SCREENSHOT_DIR) {
        await seekStorm(page,4720);
        await page.screenshot({path:path.join(process.env.STICKER_SCREENSHOT_DIR,`snowstorm-wind-${viewport.width}.png`)});
      }
    }
    const atPlate = () => page.locator('.pk-seat:not(.empty) .pk-plate').evaluateAll(plates => plates.map(plate => {
      const cap = getComputedStyle(plate,'::after');
      return [+cap.opacity,cap.pointerEvents,parseFloat(cap.bottom),plate.clientHeight,parseFloat(cap.height)];
    }));
    await seekStorm(page,20_000);
    const caps = await atPlate();
    assert.equal(caps.length,seats-1);
    assert.ok(caps.every(([alpha,pointer,bottom,height]) => alpha === 1 && pointer === 'none' && bottom >= height-3));
    assert.ok(caps.every(cap => cap[4] === (portrait ? 11 : 18)), 'the larger snow cap stays above the name');
    assert.equal(await page.locator('.pk-seat.empty .pk-plate').count(),0);
    assert.deepEqual(await playerNames(),names);
    assert.equal(await railOpacity(),1);
    await assertRailShape(railSnow);
    if (process.env.STICKER_SCREENSHOT_DIR) {
      await page.screenshot({path:path.join(process.env.STICKER_SCREENSHOT_DIR,`snowstorm-rail-${viewport.width}.png`)});
    }
    const buttonIsClickable = await page.locator('#btnFold').evaluate(button => {
      const {left,top,width,height} = button.getBoundingClientRect();
      return !!document.elementFromPoint(left+width/2,top+height/2)?.closest('#btnFold');
    });
    assert.ok(buttonIsClickable, 'snowstorm does not intercept the Fold button');
    await page.setViewportSize({width:viewport.width+12,height:viewport.height+25});
    await seekStorm(page,31_600);
    assert.ok((await atPlate()).every(([alpha]) => alpha === 1), 'caps remain on occupied plates after resize');
    assert.equal(await railOpacity(),1,'snow remains on the rail until the melt');
    assert.deepEqual(await themeOpacity(),[1,1]);
    await assertRailShape(railSnow);
    await page.evaluate(() => {
      CFG.roomBgC1='#432154'; CFG.roomBgC2='#192635'; applyRoomBackground();
      CFG.feltType='photo'; CFG.feltPhotoUrl='/effects/popcorn-animation-icon.webp'; applyFelt();
    });
    const changed = await originalArt();
    assert.notDeepEqual(changed,original);
    await seekStorm(page,36_000);
    assert.ok((await atPlate()).every(([alpha]) => alpha > .15 && alpha < .85));
    assert.ok(Math.abs(await railOpacity()-(await atPlate())[0][0]) < .05,'rail and nameplates melt together');
    assert.ok((await themeOpacity()).every(alpha => alpha > .44 && alpha < .55),'both original layers show through during the return');
    await page.evaluate(() => { _stickerPlayback.effects[0].started = performance.now()-40_010; });
    await canvas.waitFor({state:'detached'});
    assert.equal(await page.locator('.snowstorm-snow').count(),0);
    assert.equal(await railSnow.count(),0);
    assert.equal(await theme.count(),0);
    assert.deepEqual(await originalArt(),changed,'current user art survives without restoring stale settings');
    assert.equal(await page.locator('#gameRoom').evaluate(room => room.style.getPropertyValue('--snowstorm-cover')),'');
    await deliverSnowstorm(page,5200,'mid-storm');
    await page.waitForFunction(() => _stickerPlayback?.effects[0]?.windSoundHandled);
    const midStormSounds = await page.evaluate(() => window.windSounds);
    if (reduced) assert.deepEqual(midStormSounds,[]);
    else {
      assert.equal(midStormSounds.length,2);
      assert.ok(midStormSounds[1].startAt >= 5.15 && midStormSounds[1].startAt < 5.7,'late playback seeks into the soundtrack');
    }
    await page.evaluate(() => resetTableStickerEffects());
    await deliverSnowstorm(page,20_000,'restored-storm');
    await page.waitForFunction(() => [...document.querySelectorAll('.snowstorm-theme')].length === 2 &&
      [...document.querySelectorAll('.snowstorm-theme')].every(el => +el.style.opacity === 1));
    const restoredStart = await page.evaluate(() => _stickerPlayback.effects[0].started);
    await deliverSnowstorm(page,20_500,'restored-storm');
    assert.equal(await page.evaluate(() => _stickerPlayback.effects[0].started),restoredStart,'duplicate snapshot does not restart the event');
    await page.evaluate(() => resetTableStickerEffects());
    await deliverSnowstorm(page,36_000,'restored-storm');
    await page.waitForFunction(() => {
      const cover = Number(document.getElementById('gameRoom').style.getPropertyValue('--snowstorm-cover'));
      return cover > 0 && cover < 1;
    });
    assert.ok((await themeOpacity()).length === 2 && (await themeOpacity()).every(alpha => alpha > .44 && alpha < .55));
    assert.deepEqual(await page.evaluate(() => window.windSounds),midStormSounds,'audio is already over during the melt');
    await page.evaluate(() => {
      setEffectsSoundEnabled(false);
      playSnowstormWindSound({},SNOWSTORM_GUST_START,false);
      setEffectsSoundEnabled(true);
      _gameAudioManager.mediaUnlocked = false;
      Object.defineProperty(navigator,'userActivation',{value:{hasBeenActive:false},configurable:true});
      try { playSnowstormWindSound({},SNOWSTORM_GUST_START,false); }
      finally { delete navigator.userActivation; }
    });
    assert.deepEqual(await page.evaluate(() => window.windSounds),midStormSounds,'muted or locked audio must be silent');
    await page.evaluate(() => setEffectsEnabled(false));
    await canvas.waitFor({state:'detached'});
    assert.equal(await page.locator('.snowstorm-snow').count(),0);
    assert.equal(await railSnow.count(),0);
    assert.equal(await theme.count(),0);
    await page.evaluate(() => setEffectsEnabled(true));
    await deliverSnowstorm(page,40_010,'expired-storm');
    assert.equal(await canvas.count(),0);
    await page.evaluate(() => setEffectsEnabled(false));
    await trigger.click();
    assert.equal(await storm.count(),0,'disabled effects are not offered');
    const paints = await page.evaluate(() => window.stormPaint);
    if (reduced) assert.equal(paints.length,0, 'reduced motion draws only caps');
    else assert.ok(paints.length && paints.some(paint => paint.small === touch));
    assert.deepEqual(errors,[]);
    console.log(`PASS  Snowstorm 2.0 ${viewport.width}x${viewport.height} ${seats}-max${reduced ? ' reduced motion' : ''}: crossfade, current art restoration, timing, resize and resume`);
  } finally { await page.close(); }
}

async function assertRailShape(railSnow) {
  await railSnow.page().waitForFunction(() => {
    const rail = document.querySelector('.big-rail');
    return rail?.querySelector('.snowstorm-rail')?.getAttribute('viewBox') === `0 0 ${rail.clientWidth} ${rail.clientHeight}`;
  });
  const shape = await railSnow.evaluate(el => {
    const rail = el.parentElement;
    const felt = rail.parentElement.querySelector('.big-felt');
    const rx = rail.clientWidth/2, ry = rail.clientHeight/2;
    const innerX = felt.offsetWidth/2, innerY = felt.offsetHeight/2;
    const paths = [...el.querySelectorAll('path')];
    const fits = paths.every(path => {
      const length = path.getTotalLength();
      return length > 0 && Array.from({length:22},(_,i) => path.getPointAtLength(length*i/22)).every(({x,y}) =>
        Math.hypot((x-rx)/rx,(y-ry)/ry) < 1.003 && Math.hypot((x-rx)/innerX,(y-ry)/innerY) > .985);
    });
    return {patches:paths.length,fits,pointer:getComputedStyle(el).pointerEvents,
      behind:+getComputedStyle(rail).zIndex < +getComputedStyle(felt).zIndex};
  });
  assert.deepEqual(shape,{patches:12,fits:true,pointer:'none',behind:true});
}

async function deliverSnowstorm(page,age,eventId) {
  await page.evaluate(({age,eventId}) => {
    const serverStartTime = Date.now()+_serverClockOffset-age;
    receiveTableEffect({effectId:'snowstorm',eventId,serverStartTime,durationMs:40_000,serverEndTime:serverStartTime+40_000});
  },{age,eventId});
}

async function checkSlowSnowstormArt(browser,base) {
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  let releaseRoom;
  const delivery = new Promise(resolve => { releaseRoom = resolve; });
  try {
    await page.route('**/snowstorm-winter-room-mobile.webp',async route => {
      await delivery;
      await route.continue();
    });
    await page.route('**/snowstorm-winter-felt-mobile.webp',route => route.abort());
    await page.goto(base+'/poker.html');
    await page.evaluate(() => {
      setTableSize(9); openTablePreview(); setPreviewDevice('phone');
      CFG.feltType='photo'; CFG.feltPhotoUrl='/effects/snowball.webp'; applyFelt();
    });
    await deliverSnowstorm(page,20_000,'delayed-art');
    await page.locator('.snowstorm-rail').waitFor();
    assert.equal(await page.locator('.snowstorm-theme').count(),0,'original art stays visible while winter assets are missing');
    assert.match(await page.locator('#bigFeltPhoto').evaluate(el => el.style.backgroundImage),/snowball.webp/);
    releaseRoom();
    await page.waitForFunction(() => {
      const layer=document.querySelector('.snowstorm-room-theme');
      return layer && +layer.style.opacity < .7;
    });
    await page.waitForFunction(() => document.querySelector('.snowstorm-room-theme')?.style.opacity === '1');
    assert.equal(await page.locator('.snowstorm-felt-theme').count(),0,'a broken felt asset never hides the original');
    assert.match(await page.locator('#bigFeltPhoto').evaluate(el => el.style.backgroundImage),/snowball.webp/);
    const age = await page.evaluate(() => performance.now()-_stickerPlayback.effects[0].started);
    assert.ok(age > 20_000 && age < 23_000,'late image arrival never restarts the storm');
    await page.evaluate(() => resetTableStickerEffects());
    assert.equal(await page.locator('.snowstorm-theme,.snowstorm-rail').count(),0);
    console.log('PASS Snowstorm 2.0 slow and failed artwork retains the original and joins the current phase smoothly');
  } finally { releaseRoom(); await page.close(); }
}

async function seekStorm(page, age) {
  const frame = await page.evaluate(age => {
    const playback = _stickerPlayback;
    playback.effects[0].started = performance.now()-age;
    return playback.last;
  }, age);
  await page.waitForFunction(frame => _stickerPlayback?.last > frame, frame);
}

async function checkLayout(browser, base, viewport, seats, reducedMotion = false) {
  const mobile = viewport.width < 500;
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(installSampler);
    await page.goto(base + '/poker.html', { waitUntil: 'domcontentloaded' });
    if (!mobile && seats === 6) {
      await page.evaluate(() => goStep(3));
      const setting = page.locator('#settingsReactionsGrid').getByRole('button', { name: 'Popcorn' });
      assert.equal(await setting.getAttribute('aria-pressed'), 'true');
      await setting.click();
      assert.equal(await setting.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => JSON.parse(JSON.stringify(CFG)).popcornEnabled), false);
      await setting.click();
      assert.equal(await setting.getAttribute('aria-pressed'), 'true');
    }
    await page.evaluate(({ seats, mobile }) => {
      setTableSize(seats);
      openTablePreview();
      setPreviewDevice(mobile ? 'phone' : 'desktop');
      if (mobile || seats !== 6) _tablePreviewMode = false;
      _effectsSoundEnabled = false;
      preloadStickers();
    }, { seats, mobile });
    await page.waitForFunction(mobile => document.getElementById('gameRoom').classList.contains('mobile-portrait') === mobile, mobile);
    assert.equal(await page.locator('.pk-seat .pk-ava').count(), seats);
    await page.waitForFunction(() => ['snowball','popcorn','popcornFrames'].every(id => _rocketAssets[id].naturalWidth > 0));
    await page.waitForFunction(() => ['#potEl','#actionControls','.you-seat .pk-card','#communityEl .bcard'].every(selector => document.querySelector(selector)?.getBoundingClientRect().width > 0));

    const trigger = page.locator('#reactionBtnEl');
    const target = page.locator('.pk-seat[data-seat="1"] .pk-ava');
    const menu = page.locator('#playerContextMenu');
    const rocket = menu.getByRole('menuitem', { name: /Ракета/ });
    const snowball = menu.getByRole('menuitem', { name: /Snowball/ });
    const popcorn = page.locator('#reactionPickerEl').getByRole('button', { name: /Popcorn/ });
    await trigger.click();
    await popcorn.waitFor();
    assert.ok(await popcorn.isEnabled());
    await trigger.click();
    if (!mobile && seats === 6) {
      await page.evaluate(() => { CFG.popcornEnabled = false; });
      await trigger.click();
      assert.equal(await popcorn.count(), 0);
      await trigger.click();
      await page.evaluate(() => { CFG.popcornEnabled = true; });
    }
    await target.click();
    await menu.waitFor();
    assert.equal(await menu.getByRole('menuitem').count(), 2);
    assert.equal((await menu.textContent()).trim(), '', 'only icons before cooldown');
    assert.ok(await rocket.isEnabled());
    assert.equal(await page.locator('.sticker-effects-canvas').count(), 0, 'selecting the avatar only opens the menu');
    if (!mobile && seats === 6) {
      await trigger.click();
      await trigger.click();
    } else await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await target.click();
    await snowball.click();
    await menu.waitFor({ state: 'hidden' });
    if (!reducedMotion) {
      await page.waitForFunction(() => stickerSample('flight'), null, { timeout: 950 });
      await page.waitForFunction(() => stickerSample('backs'), null, { timeout: 850 });
    }
    if (!reducedMotion) await page.setViewportSize({ width: viewport.width + 18, height: viewport.height + 32 });
    await page.waitForFunction(() => stickerSample('splash'), null, { timeout: 1300 });
    await page.waitForFunction(() => stickerSample('settled'), null, { timeout: 900 });
    if (!reducedMotion) await page.waitForFunction(() => stickerSample('wipeTop'), null, { timeout: 700 });
    await page.waitForFunction(() => stickerSample('half'), null, { timeout: 700 });
    if (!reducedMotion) await page.waitForFunction(() => stickerSample('wipeBottom'), null, { timeout: 700 });
    await page.waitForFunction(() => stickerSample('cleared'), null, { timeout: 900 });
    await page.locator('.sticker-effects-canvas').waitFor({ state: 'detached', timeout: 2100 });
    await target.click();
    assert.ok(await snowball.isDisabled() && await rocket.isDisabled(), 'snowball also cools down rocket');
    await trigger.click();
    assert.ok(await popcorn.isEnabled(), 'snowball does not cool down popcorn');
    const cooldown = await page.evaluate(() => _tableEffectCooldownUntil);

    await popcorn.click();
    await popcorn.waitFor({ state: 'detached' });
    await page.waitForFunction(() => stickerSample('popcorn'), null, { timeout: 1500 });
    if (process.env.STICKER_SCREENSHOT_DIR && !reducedMotion) await page.screenshot({ path: path.join(process.env.STICKER_SCREENSHOT_DIR, `popcorn-${mobile ? 'mobile' : 'desktop'}-${seats}.png`) });
    await page.waitForFunction(() => stickerSample('popcornEmpty'), null, { timeout: 1900 });
    await page.locator('.sticker-effects-canvas').waitFor({ state: 'detached', timeout: 2500 });
    assert.equal(await page.evaluate(() => _tableEffectCooldownUntil), cooldown, 'popcorn does not change the rocket and snowball countdown');
    if (seats === 6 && !reducedMotion) await checkPopcornOnFold(page, trigger, popcorn);
    if (mobile && seats === 9 && !reducedMotion) {
      await page.evaluate(() => { _tableEffectCooldownUntil = 0; });
      await target.click();
      await rocket.click();
      await target.click();
      assert.ok(await rocket.isDisabled() && await snowball.isDisabled(), 'rocket also cools down snowball');
      await trigger.click();
      assert.ok(await popcorn.isEnabled(), 'rocket does not cool down popcorn');
      await popcorn.click();
      await page.waitForFunction(() => stickerSample('popcorn'), null, { timeout: 900 });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS  ${mobile ? 'mobile' : 'desktop'} ${seats}-max${reducedMotion ? ' reduced motion' : ' with resize'}: picker, flight, two snow wipes, popcorn and pixel masks`);
  } finally { await page.close(); }

}

async function checkCatThiefLayout(browser,base,viewport,seats,touch,reduced = false){
  const page = await browser.newPage({viewport,isMobile:touch,hasTouch:touch,reducedMotion:reduced ? 'reduce' : 'no-preference'});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  const portrait = touch && viewport.width < viewport.height;
  try {
    await page.goto(base+'/poker.html',{waitUntil:'domcontentloaded'});
    await page.evaluate(({seats,portrait}) => {
      setTableSize(seats);
      openTablePreview();
      setPreviewDevice(portrait ? 'phone' : 'desktop');
      _tablePreviewMode = false;
      _effectsSoundEnabled = false;
      preloadStickers();
    },{seats,portrait});
    await page.waitForFunction(portrait => document.getElementById('gameRoom').classList.contains('mobile-portrait') === portrait,portrait);
    assert.equal(await page.locator('.pk-seat .pk-ava').count(),seats);
    await page.locator('#reactionBtnEl').click();
    await checkCatThief(page,viewport,seats,reduced);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
}

async function checkCatThief(page,viewport,seats,reduced){
  const button = page.locator('#reactionPickerEl').getByRole('button',{name:'Кот-воришка'});
  assert.equal(await button.locator('img').getAttribute('src'),'/assets/reactions/cat-thief/cat-head-front.webp');
  await page.waitForFunction(() => _rocketAssets.cat_thief.naturalWidth > 0 && Object.keys(CAT_THIEF_SPRITES).every(id => _rocketAssets[id].naturalWidth > 0));
  await button.click();
  const canvas = page.locator('.sticker-effects-canvas');
  await canvas.waitFor();
  assert.equal(await canvas.evaluate(el => getComputedStyle(el).pointerEvents),'none');
  await page.waitForFunction(() => {
    const scene = _stickerPlayback?.effects[0];
    return scene?.catThiefRoute?.targetPlayerId && scene.catThiefRoute.targetPlayerId === scene.event.targetPlayerId;
  });
  const metrics = await page.evaluate(reduced => {
    const room = document.getElementById('gameRoom');
    const bounds = document.getElementById('tableEffectsLayer').getBoundingClientRect();
    const sample = document.createElement('canvas');
    sample.width = Math.ceil(bounds.width);
    sample.height = Math.ceil(bounds.height);
    const ctx = sample.getContext('2d',{willReadFrequently:true});
    const item = {event:_stickerPlayback.effects[0].event};
    const obstacles = stickerObstacles(bounds,CAT_THIEF_PROTECTED);
    const routeFor = target => catThiefGeometry(room,bounds,obstacles,null,target,item.event.side);
    const route = routeFor(item.event.targetPlayerId);
    const targets = [...room.querySelectorAll('.pk-seat[data-player-id]')].map(seat => {
      const id = seat.dataset.playerId;
      const candidate = routeFor(id);
      if(!candidate) return {id,missing:true};
      const {cx,cy,rx,ry,chipX,chipY} = candidate;
      const avatar = stickerAvatarGeometry(id,bounds);
      const angle = Math.atan2((avatar.y-cy)/ry,(avatar.x-cx)/rx);
      const offset = Math.atan2((chipY-cy)/ry,(chipX-cx)/rx)-angle;
      const rig = catThiefProps(candidate,catThiefPose(3370,false));
      const shoulderX = rig.rootX+candidate.dir*rig.shoulder.x;
      const crestY = cy-candidate.railRy*Math.sqrt(Math.max(0,1-((shoulderX-cx)/candidate.railRx)**2));
      const headCrestY = cy-candidate.railRy*Math.sqrt(Math.max(0,1-((rig.rootX-cx)/candidate.railRx)**2));
      return {id,upper:candidate.upperRail,drift:Math.abs(Math.atan2(Math.sin(offset),Math.cos(offset))),
        radius:Math.hypot((chipX-cx)/rx,(chipY-cy)/ry),
        reach:Math.hypot(chipX-candidate.headX,chipY-candidate.y)/candidate.size,
        lift:Math.abs(chipY-candidate.y)/candidate.size,
        corner:Math.abs((candidate.edgeX-cx)/rx) >= .34 && Math.abs((candidate.edgeY-cy)/ry) >= .53 &&
          candidate.upperRail === (candidate.edgeY<cy),
        scale:candidate.size/Math.max(48,Math.min(112,Math.min(rx,ry)*.43)),
        aboveRail:!candidate.upperRail || (rig.bodyY+candidate.size*.10 < headCrestY && rig.rootY+rig.shoulder.y < crestY)};
    });
    const paint = (age,bodyOnly = false) => {
      ctx.clearRect(0,0,sample.width,sample.height);
      if(bodyOnly){
        const pose = catThiefPose(age,reduced);
        drawCatThiefBody(ctx,route,pose,catThiefProps(route,pose));
      }
      else drawCatThief(ctx,bounds,room,item,age,reduced);
      const x0 = Math.max(0,Math.floor(route.left-5)), y0 = Math.max(0,Math.floor(route.top-5));
      const width = Math.min(sample.width,Math.ceil(route.right+5))-x0;
      const height = Math.min(sample.height,Math.ceil(route.bottom+12))-y0;
      const pixels = ctx.getImageData(x0,y0,width,height).data;
      let head = 0, armOnRail = 0, count = 0;
      for(let py=0;py<height;py+=2) for(let px=0;px<width;px+=2){
        if(pixels[(py*width+px)*4+3] < 64) continue;
        const x = x0+px, y = y0+py;
        if(!bodyOnly && obstacles.some(r => x > r.left+2 && x < r.right-2 && y > r.top+2 && y < r.bottom-2)) throw new Error(`Cat Thief overlaps gameplay at age ${age}`);
        const feltRadius = ((x-route.cx)/route.rx)**2+((y-route.cy)/route.ry)**2;
        const railRadius = ((x-route.cx)/route.railRx)**2+((y-route.cy)/route.railRy)**2;
        if(bodyOnly && (route.upperRail ? railRadius < .98 : feltRadius > 1.02)) throw new Error('The body crosses its rail mask');
        if(y < route.y-route.size*.18) head++;
        else if(feltRadius > 1.02) armOnRail++;
        count++;
      }
      return {head,armOnRail,count};
    };
    paint(1100,true);
    paint(1660,true);
    const frames = [320,1100,1660,2450,3300,4140,5460].map(age => paint(age));
    const props = [2500,3300,4410,5460].map(age => catThiefProps(route,catThiefPose(age,reduced)));
    const connectsAt = age => {
      const pose = catThiefPose(age,false);
      const rig = catThiefProps(route,pose);
      ctx.clearRect(0,0,sample.width,sample.height);
      drawCatThiefBody(ctx,route,pose,rig);
      drawCatThiefPaws(ctx,route,pose,rig);
      drawCatThiefFace(ctx,route,pose,rig);
      const {width,height} = sample;
      const {data} = ctx.getImageData(0,0,width,height);
      const pending = [];
      if(route.upperRail){
        // The real rail separates the face from the foreground paw on the far side.
        for(const t of [0,.12,.25]){
          const x = rig.rootX+route.dir*(rig.shoulder.x+(rig.front.x-rig.shoulder.x)*t);
          const y = rig.rootY+rig.shoulder.y+(rig.front.y-rig.shoulder.y)*t;
          pending.push(Math.round(y)*width+Math.round(x));
        }
      } else pending.push(Math.round(rig.rootY-route.size*.30)*width+Math.round(rig.rootX));
      while(pending.length){
        const at = pending.pop();
        if(at < 0 || at >= width*height || data[at*4+3] < 140) continue;
        data[at*4+3] = 0;
        if(Math.hypot(at%width-rig.pawX,Math.floor(at/width)-rig.pawY) < route.size*.10) return true;
        pending.push(at-1,at+1,at-width,at+width);
      }
      return false;
    };
    const connected = reduced || [3030,3370,4000].every(connectsAt);
    // For all active poses, changing the rail mask must not alter either paw.
    const pawClearsRail = [1650,2650,3370,4380].every(age => {
      const pose = catThiefPose(age,false), rig = catThiefProps(route,pose);
      const pixelsFor = rail => {
        ctx.clearRect(0,0,sample.width,sample.height);
        drawCatThiefPaws(ctx,rail,pose,rig);
        const x = Math.max(0,Math.floor(route.left)), y = Math.max(0,Math.floor(route.top));
        return ctx.getImageData(x,y,Math.min(sample.width,Math.ceil(route.right))-x,
          Math.min(sample.height,Math.ceil(route.bottom))-y).data;
      };
      const paws = pixelsFor(route), tinyRail = pixelsFor({...route,railRx:1,railRy:1});
      return paws.some((channel,index) => index%4 === 3 && channel > 150) &&
        paws.every((channel,index) => channel === tinyRail[index]);
    });
    const upperTarget = targets.find(target => target.upper);
    let restingArmsVisible = true;
    if(upperTarget){
      const upper = routeFor(upperTarget.id), pose = catThiefPose(1650,false), rig = catThiefProps(upper,pose);
      ctx.clearRect(0,0,sample.width,sample.height);
      drawCatThiefPaws(ctx,upper,pose,rig);
      restingArmsVisible = [[rig.shoulder,rig.front],[rig.supportShoulder,rig.support]].every(([shoulder,paw]) => {
        const x = Math.round(rig.rootX+upper.dir*(shoulder.x*.36+paw.x*.64));
        const y = Math.round(rig.rootY+shoulder.y*.84+paw.y*.16);
        return ctx.getImageData(x-2,y-2,5,5).data.some((channel,index) => index%4 === 3 && channel > 150);
      });
    }
    const start = performance.now();
    for(let i=0;i<24;i++) drawCatThief(ctx,bounds,room,item,3400+i*25,reduced);
    const cpu = (performance.now()-start)/24;
    const end = props.at(-1);
    return {frames,props,targets,connected,pawClearsRail,restingArmsVisible,target:route.targetPlayerId,upper:route.upperRail,eyeTurns:[catThiefPose(1100,reduced).glance,catThiefPose(1660,reduced).glance],
      size:route.size,exitsFelt:Math.hypot((end.chipX-route.cx)/route.rx,(end.chipY-route.cy)/route.ry)>1,
      cpu,addsSharedCooldown:_tableEffectCooldownUntil>0};
  },reduced);
  assert.equal(metrics.targets.length,seats);
  assert.ok(metrics.targets.every(target => !target.missing && target.drift <= (seats === 9 ? 1.151 : .641) && target.radius < 1 &&
    target.reach <= 1.281 && target.lift <= .621 && target.scale === 1 && (seats !== 9 || target.corner)),
    `every player gets a chip nearby and within a short reach of the cat (${JSON.stringify(metrics.targets)})`);
  assert.ok(metrics.pawClearsRail,'both paws must stay visible independently of the rail mask');
  assert.ok(metrics.restingArmsVisible,'both forearms must already be drawn in the idle pose');
  assert.ok(metrics.targets.every(target => target.aboveRail),`the upper pose lifts the head, torso and shoulder above the rail (${JSON.stringify(metrics.targets)})`);
  if(viewport.width === 1366) assert.ok(metrics.targets.some(target => target.upper),'the cat can emerge behind the upper rail');
  const [ears,lookLeft,lookRight,,,,gone] = metrics.frames;
  assert.ok(lookLeft.head >= 35 && lookRight.head >= 35,`face visible from both sides (${JSON.stringify(metrics)})`);
  assert.equal(gone.count,0,'the art disappears when the cat ducks');
  assert.equal(metrics.addsSharedCooldown,false);
  assert.ok(metrics.cpu < 20,`Cat Thief warm frame costs ${metrics.cpu.toFixed(2)} ms`);
  const [before,grasp,sliding] = metrics.props;
  assert.ok(Math.abs(before.chipX-grasp.chipX) < .001,'decorative chip only moves after grasp');
  if(!reduced){
    assert.ok(metrics.connected,`the body, rail and reaching paw meet naturally (${metrics.target}, upper=${metrics.upper})`);
    assert.ok(ears.head < lookLeft.head/3,'ears peek out before the whole face');
    assert.ok(metrics.eyeTurns[0] < 0 && metrics.eyeTurns[1] > 0,'the cat glances both ways');
    assert.ok(Math.hypot(grasp.chipX-sliding.chipX,grasp.chipY-sliding.chipY) > metrics.size*.09,'chip slides toward the cat');
    for(const frame of [grasp,sliding]){
      assert.equal(frame.chipX,frame.pawX,'chip moves with the grasp point');
      assert.ok(Math.abs(frame.chipY-frame.pawY-metrics.size*.12) < .001);
    }
    assert.ok(metrics.exitsFelt,'decorative chip goes under the felt');
    if(process.env.STICKER_SCREENSHOT_DIR){
      await page.waitForFunction(() => {
        const item = _stickerPlayback?.effects.find(item => item.event.effectId === 'cat_thief');
        return item && performance.now()-item.started >= 3380;
      });
      await page.screenshot({path:path.join(process.env.STICKER_SCREENSHOT_DIR,`catthief-rig-${viewport.width}-${viewport.height}-${seats}.png`)});
    }
  } else assert.equal(grasp.chipX,sliding.chipX,'reduced motion keeps the prop stationary');
  if(viewport.width === 1366 && seats === 6){
    const sounds = await page.evaluate(() => {
      const original = _gameAudioManager.play;
      const settings = [isMuted,masterVolume,_effectsSoundEnabled];
      const calls = [];
      try {
        _gameAudioManager.play = (src,options) => calls.push({src,options});
        masterVolume = .5;
        _effectsSoundEnabled = true;
        isMuted = true;
        playCatThiefSlide({catThiefRoute:{}},3450,false);
        isMuted = false;
        _effectsSoundEnabled = false;
        playCatThiefSlide({catThiefRoute:{}},3450,false);
        _effectsSoundEnabled = true;
        playCatThiefSlide({catThiefRoute:{}},3450,true);
        const item = {catThiefRoute:{}};
        playCatThiefSlide(item,3399,false);
        playCatThiefSlide(item,3450,false);
        playCatThiefSlide(item,3480,false);
        return calls;
      } finally {
        [isMuted,masterVolume,_effectsSoundEnabled] = settings;
        _gameAudioManager.play = original;
      }
    });
    assert.equal(sounds.length,1,'only one audible chip slide, respecting mute, reduced motion and effect sounds');
    assert.match(sounds[0].src,/chips-pile-movement-slide/);
    assert.equal(sounds[0].options.channel,'effect');
    assert.equal(sounds[0].options.volume,.16);
  }
  if(viewport.width === 390 && seats === 9 && !reduced){
    const lastWidth = await page.evaluate(() => {
      document.getElementById('gameRoom').classList.remove('table-preview-phone');
      _previewDevice = 'desktop';
      const item = _stickerPlayback.effects[0];
      item.started = performance.now()-1700;
      return item.catThiefRoute.roomWidth;
    });
    await page.setViewportSize({width:844,height:390});
    // Viewport emulation preserves the old portrait zoom unless it is reset.
    const device = await page.context().newCDPSession(page);
    await device.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await device.detach();
    await page.evaluate(() => adjustTableScale());
    await page.waitForFunction(lastWidth => {
      const route = _stickerPlayback?.effects[0]?.catThiefRoute;
      const bounds = document.getElementById('tableEffectsLayer').getBoundingClientRect();
      return route?.roomWidth !== lastWidth && route?.roomWidth === bounds.width && route.rx > route.ry;
    },lastWidth,{timeout:1400});
  }
  await canvas.waitFor({state:'detached',timeout:6400});
  if(viewport.width === 1366 && seats === 6){
    await page.evaluate(() => {
      const serverStartTime = Date.now()+_serverClockOffset-3700;
      const event = {effectId:'cat_thief',eventId:'late-cat-snapshot',targetPlayerId:'local-seat-1',serverStartTime,serverEndTime:serverStartTime+5500};
      receiveTableEffect(event);
      receiveTableEffect(event);
    });
    await page.waitForFunction(() => {
      const items = _stickerPlayback?.effects;
      return items?.length === 1 && performance.now()-items[0].started >= 3700;
    });
    await page.evaluate(() => {
      resetTableStickerEffects();
      const serverStartTime = Date.now()+_serverClockOffset-5150;
      receiveTableEffect({effectId:'cat_thief',eventId:'nearly-over-cat',targetPlayerId:'local-seat-1',serverStartTime,serverEndTime:serverStartTime+5500});
      if(_catThiefStartTimer !== null || _stickerPlayback) throw new Error('An almost finished Cat Thief snapshot was not skipped');
    });
  }
  console.log(`PASS  Cat Thief ${viewport.width}x${viewport.height} ${seats}-max${reduced ? ' reduced motion' : ''} (${metrics.cpu.toFixed(2)} ms/frame JS)`);
}

async function checkPopcornOnFold(page, trigger, popcorn) {
  const cards = '.you-seat .pk-cards .pk-card';
  await trigger.click();
  await popcorn.click();
  await page.waitForFunction(() => stickerSample('popcorn'));
  const { origin, left, top } = await page.evaluate(cards => {
    const { left, top } = document.querySelector(cards).getBoundingClientRect();
    const origin = window.lastPopcornDraw;
    window.popcornFoldDraws = [];
    doFoldAnim(G.userSeat, () => {
      Object.assign(G.seats[G.userSeat], { inHand: false, cards: [] });
      renderSeats();
    });
    return { origin, left, top };
  }, cards);
  await page.waitForFunction(({ cards, left, top }) => {
    const rect = document.querySelector(cards)?.getBoundingClientRect();
    return rect && Math.hypot(rect.left - left, rect.top - top) > 4;
  }, { cards, left, top }, { timeout: 600 });
  await page.locator(cards).first().waitFor({ state: 'detached', timeout: 1000 });
  await page.waitForFunction(() => window.lastPopcornDraw.frame >= 4, null, { timeout: 1400 });
  const draws = await page.evaluate(() => window.popcornFoldDraws);
  assert.ok(draws.length > 5);
  assert.ok(draws.every(({ x, y }) => Math.hypot(x - origin.x, y - origin.y) < 1),
    'Popcorn stays at its launch position while cards move and after they disappear');
  await page.locator('.sticker-effects-canvas').waitFor({ state: 'detached', timeout: 2500 });
}

// Inspect pixels rather than treating a mounted but empty canvas as a successful effect.
function installSampler() {
  let popcornFrame = -1;
  let popcornSize = 0;
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
    if (this.canvas.classList.contains('sticker-effects-canvas') && image.src.endsWith('/popcorn-animation.webp')) {
      const tile = image.naturalWidth / 3;
      popcornFrame = args[0] / tile + 3 * args[1] / tile;
      popcornSize = args[6];
      window.lastPopcornDraw = { frame: popcornFrame, x: args[4] + args[6] / 2, y: args[5] + args[7] / 2 };
      window.popcornFoldDraws?.push(window.lastPopcornDraw);
    }
    return draw.call(this, image, ...args);
  };
  window.stickerSample = (stage) => {
    const playback = _stickerPlayback;
    const item = playback?.effects[0];
    if (!item) return false;
    const age = performance.now() - item.started;
    const stageBounds = {
      flight: [145, 505], backs: [335, 549], splash: [635, 830], settled: [895, 995],
      wipeTop: [1090, 1200], half: [1315, 1368], wipeBottom: [1460, 1570], cleared: [1730, 1799],
      popcorn: [125, 220], popcornEmpty: [1690, 1930]
    };
    if (age < stageBounds[stage][0] || age > stageBounds[stage][1]) return false;
    const { canvas } = playback;
    const bounds = canvas.getBoundingClientRect();
    const sx = canvas.width / bounds.width, sy = canvas.height / bounds.height;
    const anchor = stickerAvatarGeometry(item.event.targetPlayerId || item.event.fromPlayerId, bounds);
    const source = stickerAvatarGeometry(item.event.fromPlayerId, bounds);
    if (!anchor || !source) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const isPopcorn = stage.startsWith('popcorn');
    const obstacles = stickerObstacles(bounds, STICKER_PROTECTED);
    if (!isPopcorn) obstacles.push(...stickerObstacles(bounds, SNOWBALL_FACE_CARDS));
    const cards = isPopcorn
      ? stickerObstacles(bounds, '.you-seat .pk-cards .pk-card')
      : stickerObstacles(bounds, '.pk-seat[data-seat="1"] .pk-card.back');
    if (isPopcorn && popcornFrame !== (stage === 'popcornEmpty' ? 7 : 0)) return false;
    if (isPopcorn && Math.abs(popcornSize - 2 * Math.max(40, Math.min(86, source.size * 1.18))) > 1) {
      throw Error('Popcorn should render at twice its original size');
    }
    let visible = 0, topSnow = 0, bottomSnow = 0, bridge = 0, cuff = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4;
      if (pixels[offset + 3] < 20) continue;
      const px = (x + .5) / sx, py = (y + .5) / sy;
      if (obstacles.some(r => px > r.left + 4 && px < r.right - 4 && py > r.top + 4 && py < r.bottom - 4)) {
        throw Error('Effect overlaps a protected region');
      }
      if (isPopcorn && cards.some(r => px > r.left && px < r.right && py > r.top && py < r.bottom)) visible++;
      if (stage === 'backs' && cards.some(r => px > r.left + 4 && px < r.right - 4 && py > r.top + 4 && py < r.bottom - 4)) visible++;
      if (stage === 'flight' && Math.hypot(px - source.x, py - source.y) > 10 && Math.hypot(px - anchor.x, py - anchor.y) > 10) visible++;
      if (stage === 'cleared' || (stage === 'splash' && Math.hypot(px - anchor.x, py - anchor.y) < anchor.size * 1.6)) visible++;
      if (!isPopcorn && Math.abs(px - anchor.x) < anchor.size*.56 && Math.abs(py - anchor.y) < anchor.size*.45) {
        const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
        if (r > 232 && g > 239 && b > 244 && pixels[offset + 3] > 112) {
          if (py < anchor.y - anchor.size*.245) topSnow++;
          if (py > anchor.y - anchor.size*.10) bottomSnow++;
          if (Math.abs(py - (anchor.y - anchor.size*.16)) < anchor.size*.04 && Math.abs(px - anchor.x) < anchor.size*.17) bridge++;
        }
        if (Math.abs(r - 114) < 7 && Math.abs(g - 179) < 7 && Math.abs(b - 229) < 7) cuff++;
      }
    }
    if (stage === 'settled') return topSnow >= 12 && bottomSnow >= 12 && bridge >= 12;
    if (stage === 'wipeTop' || stage === 'wipeBottom') return cuff >= 4;
    if (stage === 'half') return topSnow <= 4 && bottomSnow >= 12;
    if (stage === 'cleared') return visible === 0;
    return visible >= 20;
  };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
