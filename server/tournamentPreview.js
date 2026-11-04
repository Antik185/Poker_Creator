'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const MAX_BYTES = 96 * 1024;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_BYTES = 6 * 1024 * 1024;

function createTournamentPreviews({ uploadDirectory, getRoom, urlPrefix = '/api/tournaments' }) {
  const root = fs.realpathSync(uploadDirectory);
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let cacheBytes = 0;
  let working = 0;

  function source(file, id) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw Error('Invalid preview source');
    const key = crypto.createHash('sha256').update(`v2:${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).digest('hex').slice(0, 24);
    return { file, key, url: `${urlPrefix}/${encodeURIComponent(id)}/preview?v=${key}` };
  }

  // Keep the old default WebP URL usable for cached clients; new cards use CSS instead.
  const brand = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#2456a5"/><stop offset="1" stop-color="#a3d9ff"/></linearGradient></defs><rect width="640" height="400" fill="url(#b)"/><path d="M485 80h45l100 240h-52l-20-52H455l-20 52h-50z M472 224h69l-34-89z" fill="white" fill-rule="evenodd" opacity=".2"/></svg>');
  const brandKey = crypto.createHash('sha256').update(brand).digest('hex').slice(0, 24);
  const fallback = { buffer: brand, key: brandKey, url: `${urlPrefix}/default/preview?v=${brandKey}` };

  function describe(room) {
    // Only existing local room artwork is eligible; never fetch a user-supplied URL.
    for (const url of [room?.felt_url, room?.config?.feltPhotoUrl]) {
      if (typeof url !== 'string' || !/^\/uploads\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(url)) continue;
      try {
        const file = fs.realpathSync(path.join(root, url.slice('/uploads/'.length)));
        if (path.dirname(file) !== root) continue;
        return source(file, room.id);
      } catch (_) { /* Missing artwork uses the next existing source or the shared fallback. */ }
    }
    return fallback;
  }

  function remember(key, value) {
    if (cache.has(key)) cacheBytes -= cache.get(key).buffer.length;
    cache.set(key, value);
    cacheBytes += value.buffer.length;
    while (cache.size > 64 || cacheBytes > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).buffer.length;
      cache.delete(oldest);
    }
    return value;
  }

  async function encode(input) {
    const buffer = input.buffer || await fs.promises.readFile(input.file);
    if (buffer.length > MAX_SOURCE_BYTES) throw Error('Preview source too large');
    for (const [width, quality] of [[640, 68], [480, 55], [320, 45]]) {
      const result = await sharp(buffer, { limitInputPixels: 16000000, animated: false })
        .rotate().resize(width, Math.round(width * 5 / 8), { fit: 'cover' }).flatten({ background: '#12264b' })
        .webp({ quality, effort: 3 }).toBuffer();
      if (result.length <= MAX_BYTES) {
        return { buffer: result, etag: `"${crypto.createHash('sha256').update(result).digest('hex')}"` };
      }
    }
    throw Error('Preview exceeds byte limit');
  }

  function drain() {
    while (working < 2 && queue.length) {
      const { input, resolve, reject } = queue.shift();
      working++;
      encode(input).then(value => resolve(remember(input.key, value)), reject).finally(() => { working--; drain(); });
    }
  }

  function get(input) {
    if (cache.has(input.key)) {
      const hit = cache.get(input.key);
      cache.delete(input.key);
      if (!hit.expiresAt || hit.expiresAt > Date.now()) {
        cache.set(input.key, hit);
        if (hit.failed) return Promise.reject(Error('Preview source unavailable'));
        return Promise.resolve(hit);
      }
      cacheBytes -= hit.buffer.length;
    }
    if (pending.has(input.key)) return pending.get(input.key);
    if (queue.length >= 16) return Promise.reject(Object.assign(Error('Preview queue full'), { code: 'PREVIEW_BUSY' }));
    const job = new Promise((resolve, reject) => { queue.push({ input, resolve, reject }); drain(); })
      .finally(() => pending.delete(input.key));
    pending.set(input.key, job);
    return job;
  }

  async function handler(req, res) {
    const room = req.params.id === 'default' ? null : getRoom(req.params.id);
    const input = describe(room);
    if (req.params.id !== 'default' && input === fallback) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(404).end();
    }
    try {
      const value = await get(input);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('ETag', value.etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match'] === value.etag) return res.status(304).end();
      return res.type('webp').send(value.buffer);
    } catch (error) {
      if (input === fallback || error.code === 'PREVIEW_BUSY') {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).end();
      }
      if (!cache.get(input.key)?.failed) remember(input.key, { failed: true, buffer: Buffer.alloc(0), expiresAt: Date.now() + 60000 });
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(404).end();
    }
  }

  return {
    urlFor: room => describe(room).url,
    forRoom(room) { const input = describe(room); return { previewUrl: input.url, hasBackgroundPreview: input !== fallback }; },
    handler
  };
}

module.exports = { createTournamentPreviews };
