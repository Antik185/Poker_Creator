'use strict';

const crypto = require('node:crypto');
const { parseCookies } = require('./playerIdentity');

const COOKIE_NAME = 'antik_user_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,24}$/u;
const EMAIL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/;

if (typeof crypto.argon2 !== 'function') {
  throw new Error('AntikPoker user authentication requires Node.js 24.7+ with crypto.argon2 support');
}

function normalizeIdentity(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function safeReturnPath(value, fallback = '/profile') {
  const path = String(value || '');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
  try {
    const parsed = new URL(path, 'http://antikpoker.local');
    return parsed.origin === 'http://antikpoker.local'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

function validateRegistration(input) {
  const username = String(input?.username || '').trim().normalize('NFKC');
  const email = String(input?.email || '').trim().normalize('NFKC');
  const password = String(input?.password || '');
  const passwordConfirmation = String(input?.passwordConfirmation || '');
  const errors = {};

  if (!USERNAME_PATTERN.test(username)) {
    errors.username = 'Логин должен содержать 3–24 буквы, цифры, точки, дефисы или подчёркивания';
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    errors.email = 'Укажите корректный email';
  }
  if (password.length < 10) errors.password = 'Пароль должен содержать не менее 10 символов';
  if (password.length > 256) errors.password = 'Пароль слишком длинный';
  if (password !== passwordConfirmation) errors.passwordConfirmation = 'Пароли не совпадают';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    username,
    usernameNormalized: normalizeIdentity(username),
    email,
    emailNormalized: normalizeIdentity(email),
    password
  };
}

function hashBuffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function argon2(algorithm, options) {
  return new Promise((resolve, reject) => {
    crypto.argon2(algorithm, options, (error, result) => error ? reject(error) : resolve(result));
  });
}

function argonParameters() {
  return {
    memory: Math.max(8192, Number(process.env.AUTH_ARGON2_MEMORY) || 65536),
    passes: Math.max(2, Number(process.env.AUTH_ARGON2_PASSES) || 3),
    parallelism: 1,
    tagLength: 32
  };
}

async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const params = argonParameters();
  const tag = await argon2('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    ...params
  });
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}`
    + `$${salt.toString('base64url')}$${tag.toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(String(encoded || ''));
  if (!match) return false;
  const [, memory, passes, parallelism, saltText, expectedText] = match;
  const expected = Buffer.from(expectedText, 'base64url');
  const actual = await argon2('argon2id', {
    message: Buffer.from(String(password || ''), 'utf8'),
    nonce: Buffer.from(saltText, 'base64url'),
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicUser(row) {
  const isoDate = value => {
    const text = String(value || '');
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  };
  return {
    id: row.id || row.user_id,
    username: row.username,
    email: row.email,
    avatarUrl: /^[0-9a-f-]+\.webp$/i.test(String(row.avatar_path || ''))
      ? `/profile-avatars/${row.avatar_path}?v=${Number(row.avatar_updated_at) || 0}`
      : null,
    emailVerifiedAt: row.email_verified_at || null,
    createdAt: isoDate(row.user_created_at || row.created_at),
    updatedAt: isoDate(row.user_updated_at || row.updated_at)
  };
}

class UserAuthService {
  constructor({ db, secret, cookieName = COOKIE_NAME, sessionMaxAgeMs = SESSION_MAX_AGE_MS } = {}) {
    if (!db) throw new Error('UserAuthService requires a database');
    if (Buffer.byteLength(String(secret || ''), 'utf8') < 32) {
      throw new Error('USER_AUTH_SECRET must contain at least 32 bytes');
    }
    this.db = db;
    this.secret = String(secret);
    this.cookieName = cookieName;
    this.sessionMaxAgeMs = sessionMaxAgeMs;
    this.loginWindowMs = Math.max(1000, Number(process.env.AUTH_LOGIN_WINDOW_MS) || LOGIN_WINDOW_MS);
    this.loginLimit = Math.max(1, Number(process.env.AUTH_LOGIN_LIMIT) || LOGIN_LIMIT);
    this.loginAttempts = new Map();
    this.dummyHash = hashPassword('invalid-account-password');
    this.db.purgeExpiredAuthSessions(Date.now());
  }

  csrfToken(sessionToken) {
    return crypto.createHmac('sha256', this.secret)
      .update(`csrf:${sessionToken}`)
      .digest('base64url');
  }

  serializeCookie(token, { secure = false, maxAgeMs = this.sessionMaxAgeMs } = {}) {
    const secureAttribute = secure ? '; Secure' : '';
    return `${this.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}${secureAttribute}`;
  }

  clearCookie(secure = false) {
    return this.serializeCookie('', { secure, maxAgeMs: 0 });
  }

  tokenFromRequest(req) {
    return parseCookies(req.headers.cookie)[this.cookieName] || '';
  }

  sessionFromRequest(req, { touch = true } = {}) {
    const token = this.tokenFromRequest(req);
    if (!token) return null;
    const tokenHash = hashBuffer(token);
    const row = this.db.getAuthSessionByTokenHash(tokenHash);
    if (!row || row.revoked_at) return null;
    const now = Date.now();
    if (Number(row.expires_at) <= now) {
      this.db.revokeAuthSession(row.session_id, now);
      return null;
    }
    const csrfToken = this.csrfToken(token);
    if (!safeEqual(hashBuffer(csrfToken), row.csrf_token_hash)) return null;
    if (touch && now - Number(row.last_seen_at || 0) > 5 * 60 * 1000) {
      this.db.touchAuthSession(row.session_id, now);
    }
    return {
      id: row.session_id,
      user: publicUser(row),
      csrfToken,
      expiresAt: Number(row.expires_at),
      tokenHash
    };
  }

  prepareSession(userId, req) {
    const previousToken = this.tokenFromRequest(req);
    const token = crypto.randomBytes(32).toString('base64url');
    const csrfToken = this.csrfToken(token);
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      userId, token, csrfToken,
      tokenHash: hashBuffer(token),
      csrfTokenHash: hashBuffer(csrfToken),
      createdAt: now,
      expiresAt: now + this.sessionMaxAgeMs,
      previousTokenHash: previousToken ? hashBuffer(previousToken) : null
    };
  }

  persistSession(session) {
    this.db.createAuthSession(session);
  }

  publishSession(session, req, res) {
    res.append('Set-Cookie', this.serializeCookie(session.token, { secure: req.secure }));
    return { csrfToken: session.csrfToken, expiresAt: session.expiresAt };
  }

  createSession(userId, req, res) {
    const session = this.prepareSession(userId, req);
    this.persistSession(session);
    return this.publishSession(session, req, res);
  }

  loginKey(req, login) {
    return `${req.ip || 'unknown'}:${normalizeIdentity(login).slice(0, 254)}`;
  }

  loginAllowed(key) {
    const now = Date.now();
    const attempts = (this.loginAttempts.get(key) || []).filter(timestamp => now - timestamp < this.loginWindowMs);
    if (attempts.length) this.loginAttempts.set(key, attempts);
    else this.loginAttempts.delete(key);
    return attempts.length < this.loginLimit;
  }

  recordLoginFailure(key) {
    const attempts = this.loginAttempts.get(key) || [];
    attempts.push(Date.now());
    this.loginAttempts.set(key, attempts);
  }

  requireSession(req, res, next) {
    const session = this.sessionFromRequest(req);
    if (!session) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
    req.userSession = session;
    next();
  }

  requireCsrf(req, res, next) {
    const session = req.userSession || this.sessionFromRequest(req, { touch: false });
    if (!session) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
    if (!safeEqual(req.get('x-csrf-token'), session.csrfToken)) {
      return res.status(403).json({ error: 'CSRF-проверка не пройдена' });
    }
    req.userSession = session;
    next();
  }

  registerRoutes(app, { requireSameOrigin, beforeAuthenticate = () => null,
    onAuthenticated = () => {}, onLogout = () => {} }) {
    require('./emailVerification').registerEmailVerification(app, {
      db: this.db, auth: this, requireSameOrigin, beforeAuthenticate,
      onAuthenticated, validateRegistration, hashPassword, safeReturnPath
    });
    app.get('/api/auth/username-available', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const username = String(req.query.username || '').trim().normalize('NFKC');
      const valid = USERNAME_PATTERN.test(username);
      res.json({ valid, available: valid && this.db.isUsernameAvailable(normalizeIdentity(username)) });
    });

    app.post('/api/auth/login', requireSameOrigin, async (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!req.is('application/json')) return res.status(415).json({ error: 'Требуется JSON-запрос' });
      const login = String(req.body?.login || '').trim();
      const password = String(req.body?.password || '');
      const key = this.loginKey(req, login);
      if (!this.loginAllowed(key)) {
        return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже' });
      }
      try {
        const row = this.db.getUserForAuthentication(normalizeIdentity(login));
        const encoded = row?.password_hash || await this.dummyHash;
        const accepted = await verifyPassword(password, encoded);
        if (!row || !accepted) {
          this.recordLoginFailure(key);
          return res.status(401).json({ error: 'Неверный логин, email или пароль' });
        }
        this.loginAttempts.delete(key);
        const conflict = beforeAuthenticate(req);
        if (conflict) return res.status(409).json({ error: conflict });
        const session = this.createSession(row.id, req, res);
        onAuthenticated(req);
        res.json({
          user: publicUser(row),
          csrfToken: session.csrfToken,
          expiresAt: session.expiresAt,
          returnTo: safeReturnPath(req.body?.returnTo)
        });
      } catch (error) {
        next(error);
      }
    });

    app.get('/api/auth/session', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const session = this.sessionFromRequest(req);
      if (!session) return res.json({ authenticated: false });
      res.json({
        authenticated: true,
        user: session.user,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt
      });
    });

    app.get('/api/auth/profile', this.requireSession.bind(this), (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ user: req.userSession.user });
    });

    app.post(
      '/api/auth/logout',
      requireSameOrigin,
      this.requireSession.bind(this),
      this.requireCsrf.bind(this),
      (req, res) => {
        this.db.revokeAuthSession(req.userSession.id);
        onLogout(req.userSession);
        res.append('Set-Cookie', this.clearCookie(req.secure));
        res.json({ success: true });
      }
    );
  }
}

module.exports = {
  UserAuthService,
  hashPassword,
  verifyPassword,
  validateRegistration,
  normalizeIdentity,
  safeReturnPath,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS
};
