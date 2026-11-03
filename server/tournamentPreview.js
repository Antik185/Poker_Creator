'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const MAX_BYTES = 96 * 1024;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_BYTES = 6 * 1024 * 1024;

function createTournamentPreviews({ uploadDirectory, fallbackFile, getRoom }) {
  const root = fs.realpathSync(uploadDirectory);
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let cacheBytes = 0;
  let working = 0;

  function source(file, id) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw Error('Invalid preview source');
    const key = crypto.createHash('sha256').update(`v1:${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).digest('hex').slice(0, 24);
    return { file, key, url: `/api/tournaments/${encodeURIComponent(id)}/preview?v=${key}` };
  }

  const fallback = source(fs.realpathSync(fallbackFile), 'default');

  function describe(room) {
    // Only existing local room artwork is eligible; never fetch a user-supplied URL.
    for (const url of [room?.felt_url, room?.config?.feltPhotoUrl, room?.logo_url, room?.config?.logoUrl]) {
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
    const buffer = await fs.promises.readFile(input.file);
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
        return Promise.resolve(hit);
      }
      cacheBytes -= hit.buffer.length;
    }
    if (pending.has(input.key)) return pending.get(input.key);
    if (queue.length >= 16) return Promise.reject(Error('Preview queue full'));
    const job = new Promise((resolve, reject) => { queue.push({ input, resolve, reject }); drain(); })
      .finally(() => pending.delete(input.key));
    pending.set(input.key, job);
    return job;
  }

  async function handler(req, res) {
    const room = req.params.id === 'default' ? null : getRoom(req.params.id);
    const input = describe(room);
    try {
      let value;
      let temporaryFallback = false;
      try { value = await get(input); }
      catch (_) {
        if (input.key === fallback.key) throw Error('Fallback unavailable');
        value = remember(input.key, { ...await get(fallback), expiresAt: Date.now() + 60000 });
        // A broken source should not be decoded on every refresh.
        temporaryFallback = true;
      }
      res.setHeader('Cache-Control', temporaryFallback || value.expiresAt ? 'public, max-age=60' : 'public, max-age=3600');
      res.setHeader('ETag', value.etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match'] === value.etag) return res.status(304).end();
      return res.type('webp').send(value.buffer);
    } catch (_) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).end();
    }
  }

  return { urlFor: room => describe(room).url, handler };
}

module.exports = { createTournamentPreviews };
