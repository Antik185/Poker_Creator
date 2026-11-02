'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const sharp = require('sharp');

const AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_INPUT_PIXELS = 40_000_000;
const AVATAR_MAX_DIMENSION = 8192;
const AVATAR_SIZE = 256;
const AVATAR_RATE_WINDOW_MS = 60 * 60 * 1000;
const AVATAR_RATE_LIMIT = 10;
const AVATAR_FILENAME_PATTERN = /^[0-9a-f-]+\.webp$/i;

function createProfileRoutes({ app, db, userAuth, requireSameOrigin, avatarDirectory, onAvatarChanged }) {
  const attempts = new Map();
  const busy = new Set();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AVATAR_BYTES, files: 1, fields: 0, parts: 1 }
  });

  function avatarAllowed(userId) {
    const now = Date.now();
    const recent = (attempts.get(userId) || []).filter(timestamp => now - timestamp < AVATAR_RATE_WINDOW_MS);
    if (recent.length >= AVATAR_RATE_LIMIT) {
      attempts.set(userId, recent);
      return false;
    }
    recent.push(now);
    attempts.set(userId, recent);
    return true;
  }

  async function unlinkAvatar(filename) {
    if (!AVATAR_FILENAME_PATTERN.test(String(filename || ''))) return;
    try { await fs.promises.unlink(path.join(avatarDirectory, filename)); }
    catch (error) { if (error.code !== 'ENOENT') console.error('[Avatar] Unable to remove old file:', error); }
  }

  const requireSession = userAuth.requireSession.bind(userAuth);
  const requireCsrf = userAuth.requireCsrf.bind(userAuth);
  function limitWrites(req, res, next) {
    const id = req.userSession.user.id;
    if (busy.has(id)) return res.status(409).json({ error: 'Изображение уже обрабатывается' });
    if (!avatarAllowed(id)) return res.status(429).json({ error: 'Слишком много изменений аватара. Попробуйте позже' });
    busy.add(id);
    res.once('finish', () => busy.delete(id));
    next();
  }

  app.post(
    '/api/profile/avatar',
    requireSameOrigin,
    requireSession,
    requireCsrf,
    limitWrites,
    (req, res, next) => upload.single('avatar')(req, res, error => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Файл аватара должен быть не больше 5 МБ' });
      }
      return res.status(400).json({ error: 'Не удалось прочитать файл аватара' });
    }),
    async (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      const userId = req.userSession.user.id;
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Выберите изображение' });

      const filename = `${crypto.randomUUID()}.webp`;
      const temporary = `.${filename}.tmp`;
      const temporaryPath = path.join(avatarDirectory, temporary);
      const finalPath = path.join(avatarDirectory, filename);
      let committed = false;
      try {
        await fs.promises.mkdir(avatarDirectory, { recursive: true });
        const image = sharp(req.file.buffer, {
          failOn: 'error',
          limitInputPixels: AVATAR_INPUT_PIXELS,
          sequentialRead: true
        });
        const metadata = await image.metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format)
          || !metadata.width || !metadata.height
          || metadata.width > AVATAR_MAX_DIMENSION || metadata.height > AVATAR_MAX_DIMENSION
          || Number(metadata.pages || 1) !== 1) {
          return res.status(415).json({ error: 'Поддерживаются обычные PNG, JPEG и WebP до 8192×8192' });
        }
        await image
          .rotate()
          .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
          .webp({ quality: 84, effort: 5 })
          .toFile(temporaryPath);
        await fs.promises.rename(temporaryPath, finalPath);
        const updated = db.updateUserAvatar(userId, filename, Date.now());
        if (!updated) {
          await unlinkAvatar(filename);
          return res.status(404).json({ error: 'Профиль не найден' });
        }
        committed = true;
        await unlinkAvatar(updated.oldAvatarPath);
        db.updateTournamentAvatarForUser(userId, updated.user.avatarUrl);
        onAvatarChanged?.(userId, updated.user.avatarUrl);
        return res.json({ user: updated.user });
      } catch (error) {
        try { await fs.promises.unlink(temporaryPath); } catch (_) {}
        if (!committed) await unlinkAvatar(filename);
        if (!committed && (!error.code || /image|png|jpeg|webp|buffer|pixel/i.test(error.message))) {
          return res.status(415).json({ error: 'Файл не является допустимым изображением' });
        }
        return next(error);
      }
    }
  );

  app.delete(
    '/api/profile/avatar',
    requireSameOrigin,
    requireSession,
    requireCsrf,
    limitWrites,
    async (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const updated = db.updateUserAvatar(req.userSession.user.id, null);
        if (!updated) return res.status(404).json({ error: 'Профиль не найден' });
        await unlinkAvatar(updated.oldAvatarPath);
        db.updateTournamentAvatarForUser(req.userSession.user.id, null);
        onAvatarChanged?.(req.userSession.user.id, null);
        return res.json({ user: updated.user });
      } catch (error) {
        return next(error);
      }
    }
  );

  app.get('/api/profile/tournaments', requireSession, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const page = Math.min(1_000_000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const result = db.listUserTournamentResults(req.userSession.user.id, {
      limit,
      offset: (page - 1) * limit
    });
    res.json({ ...result, page, pages: Math.max(1, Math.ceil(result.total / limit)) });
  });

  app.get('/api/profile/tournament-stats', requireSession, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(db.getUserTournamentStats(req.userSession.user.id));
  });
}

module.exports = {
  createProfileRoutes,
  AVATAR_FILENAME_PATTERN,
  AVATAR_SIZE,
  AVATAR_BYTES,
  AVATAR_MAX_DIMENSION
};
