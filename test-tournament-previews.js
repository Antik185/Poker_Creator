'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const { createTournamentPreviews } = require('./server/tournamentPreview');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antik-previews-'));
  const root = path.join(dir, 'uploads'); fs.mkdirSync(root);
  let server;
  try {
    const original = await sharp({ create: { width: 2600, height: 1800, channels: 3, background: '#b53529' } }).png().toBuffer();
    fs.writeFileSync(path.join(root, 'felt.png'), original);
    fs.writeFileSync(path.join(root, 'broken.jpg'), 'not an image');
    const outside = path.join(dir, 'private.png'); fs.writeFileSync(outside, original);
    let symlink = false;
    try { fs.symlinkSync(outside, path.join(root, 'link.png')); symlink = true; } catch (_) { /* Windows may restrict symlinks. */ }
    const rooms = {
      art: { id: 'art', felt_url: '/uploads/felt.png' },
      config: { id: 'config', config: { feltPhotoUrl: '/uploads/felt.png' } },
      logo: { id: 'logo', logo_url: '/uploads/felt.png' },
      broken: { id: 'broken', felt_url: '/uploads/broken.jpg' },
      missing: { id: 'missing', felt_url: '/uploads/absent.png' },
      traversal: { id: 'traversal', felt_url: '/uploads/../private.png' },
      remote: { id: 'remote', felt_url: 'https://example.invalid/large.png' },
      symlink: { id: 'symlink', felt_url: '/uploads/link.png' }
    };
    const previews = createTournamentPreviews({ uploadDirectory: root, getRoom: id => rooms[id] });
    const app = express(); app.get('/api/tournaments/:id/preview', previews.handler);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function preview(id, headers) {
      const res = await fetch(`${base}/api/tournaments/${id}/preview`, { headers });
      return { res, buffer: Buffer.from(await res.arrayBuffer()) };
    }
    const result = await preview('art');
    assert.equal(result.res.status, 200); assert.equal(result.res.headers.get('content-type'), 'image/webp');
    const metadata = await sharp(result.buffer).metadata();
    assert.equal(metadata.width, 640); assert.equal(metadata.height, 400);
    assert.ok(result.buffer.length <= 96 * 1024); assert.notDeepEqual(result.buffer, original);
    assert.equal((await preview('art', { 'If-None-Match': result.res.headers.get('etag') })).res.status, 304);
    assert.deepEqual((await preview('config')).buffer, result.buffer);
    assert.equal(previews.forRoom(rooms.art).hasBackgroundPreview,true);
    assert.equal(previews.forRoom(rooms.config).hasBackgroundPreview,true);
    assert.equal(previews.forRoom(rooms.logo).hasBackgroundPreview,false);
    assert.equal(previews.urlFor(rooms.logo),previews.urlFor(null));
    assert.equal((await preview('logo')).res.status,404);
    assert.match(previews.urlFor(rooms.art), /^\/api\/tournaments\/art\/preview\?v=[a-f0-9]{24}$/);
    console.log(`PASS  room/config BG only, logo excluded, bounded 640x400 WebP (${result.buffer.length} bytes), ETag/304`);
    const fallback = await preview('default');
    assert.equal(fallback.res.status,200);assert.equal((await sharp(fallback.buffer).metadata()).format,'webp');
    assert.ok(fallback.buffer.length<=96*1024);
    for (const id of ['broken', 'missing', 'traversal', 'remote', 'unknown', ...(symlink ? ['symlink'] : [])]) {
      const unavailable=await preview(id);
      assert.equal(unavailable.res.status,404,id);assert.equal(unavailable.buffer.length,0,id);
    }
    assert.equal(previews.forRoom(rooms.missing).hasBackgroundPreview,false);
    assert.equal(previews.forRoom(rooms.remote).hasBackgroundPreview,false);
    assert.match((await preview('broken')).res.headers.get('cache-control'), /max-age=60$/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'felt.png')), original);
    assert.deepEqual(fs.readdirSync(root).sort(), ['broken.jpg', 'felt.png', ...(symlink ? ['link.png'] : [])].sort());
    const oldUrl = previews.urlFor(rooms.art);
    fs.writeFileSync(path.join(root, 'felt.png'), await sharp({ create: { width: 800, height: 500, channels: 3, background: '#208750' } }).png().toBuffer());
    assert.notEqual(previews.urlFor(rooms.art), oldUrl);
    assert.notEqual((await preview('art')).res.headers.get('etag'), result.res.headers.get('etag'));
    fs.writeFileSync(path.join(root, 'large.png'), Buffer.alloc(5 * 1024 * 1024 + 1));
    rooms.large = { id: 'large', felt_url: '/uploads/large.png' };
    assert.equal((await preview('large')).res.status,404);
    fs.writeFileSync(path.join(root, 'pixels.png'), await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#124' } }).png().toBuffer());
    rooms.pixels = { id: 'pixels', felt_url: '/uploads/pixels.png' };
    assert.equal((await preview('pixels')).res.status,404);
    const noisy = crypto.randomBytes(1100 * 700 * 3);
    fs.writeFileSync(path.join(root, 'noise.png'), await sharp(noisy, { raw: { width: 1100, height: 700, channels: 3 } }).png().toBuffer());
    rooms.noise = { id: 'noise', felt_url: '/uploads/noise.png' };
    assert.ok((await preview('noise')).buffer.length <= 96 * 1024);
    console.log('PASS  invalid/oversized/high-pixel/local-escape/remote sources signal CSS fallback; legacy default WebP remains branded; originals unchanged');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
