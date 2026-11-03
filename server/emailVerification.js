'use strict';

const crypto = require('node:crypto');
const { parseCookies } = require('./playerIdentity');
const { createMailer } = require('./emailMailer');

const COOKIE = 'antik_registration';
const LIFETIME = 60 * 60 * 1000;
function equal(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function registerEmailVerification(app, { db, auth, requireSameOrigin, beforeAuthenticate,
  onAuthenticated, validateRegistration, hashPassword, safeReturnPath, env = process.env }) {
  const secret = env.EMAIL_VERIFICATION_SECRET || '';
  let base;
  try { base = new URL(env.PUBLIC_BASE_URL); } catch {}
  const configured = Buffer.byteLength(secret) >= 32 && base && !base.username && !base.password
    && (base.protocol === 'https:' || (env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(base.hostname)));
  const store = db.registrationStore;
  const mailer = createMailer(env);
  const locks = new Set();
  const digest = value => crypto.createHmac('sha256', secret).update(value).digest('hex');
  const token = req => parseCookies(req.headers.cookie)[COOKIE] || '';
  const owner = req => digest(`owner:${token(req)}`);
  const codeHash = (id, code) => digest(`code:${id}:${code}`);
  const cleanupTimer = setInterval(() => store.cleanup(), 60000);
  cleanupTimer.unref();
  store.cleanup();

  function status(req) {
    const row = store.get(owner(req));
    return { csrfToken: digest(`csrf:${token(req)}`), pending: row ? {
      email: row.email.replace(/^(.).+(@.+)$/, '$1***$2'), username: row.username,
      expiresAt: row.expires_at, codeExpiresAt: row.code_expires_at,
      resendAvailableAt: row.resend_available_at, deliveryState: row.delivery_state,
      existingAccount: row.kind === 'EXISTING'
    } : null, serverNow: Date.now() };
  }
  function ready(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    if (!configured) return res.status(503).json({ error: 'Подтверждение почты ещё не настроено. Обратитесь к администратору' });
    store.cleanup(); next();
  }
  function csrf(req, res, next) {
    if (!/^[\w-]{43}$/.test(token(req)) || !equal(req.get('x-csrf-token'), digest(`csrf:${token(req)}`))) {
      return res.status(403).json({ error: 'Обновите страницу регистрации: CSRF-проверка не пройдена' });
    }
    if (!req.is('application/json')) return res.status(415).json({ error: 'Требуется JSON' });
    next();
  }
  function rate(req, label, email, limit, window = LIFETIME) {
    const now = Date.now();
    return store.consume(digest(`${label}:ip:${req.ip}`), label === 'send' ? 50 : 100, window, now)
      && store.consume(digest(`${label}:email:${email}`), limit, window, now);
  }
  function newCode(row) {
    let code;
    do { code = crypto.randomInt(1000000).toString().padStart(6, '0'); }
    while (row?.code_hash && equal(row.code_hash, codeHash(row.id, code)));
    return code;
  }
  async function deliver(row, code, req, res) {
    try {
      await mailer.sendCode(row.email, code);
      if (store.delivered(row.id, row.code_hash, true).changes !== 1) {
        return res.status(409).json({ error: 'Заявка изменилась. Обновите страницу' });
      }
      return res.status(202).json({ ...status(req), verificationRequired: true });
    } catch {
      store.delivered(row.id, row.code_hash, false);
      return res.status(503).json({ error: 'Не удалось отправить письмо. Попробуйте повторно через минуту', ...status(req) });
    }
  }
  const guarded = handler => async (req, res, next) => {
    const key = owner(req);
    if (locks.has(key)) return res.status(409).json({ error: 'Запрос уже обрабатывается' });
    locks.add(key);
    try { await handler(req, res); } catch (error) { next(error); } finally { locks.delete(key); }
  };
  const guards = [requireSameOrigin, ready, csrf];
  app.get('/api/auth/registration', ready, (req, res) => {
    if (!/^[\w-]{43}$/.test(token(req))) {
      const value = crypto.randomBytes(32).toString('base64url');
      res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${req.secure ? '; Secure' : ''}`);
      req.headers.cookie = `${req.headers.cookie || ''}; ${COOKIE}=${value}`;
    }
    const session = auth.sessionFromRequest(req, { touch: false });
    const row = store.get(owner(req));
    if (row?.kind === 'EXISTING' && row.user_id !== session?.user.id) store.cancel(owner(req));
    res.json(status(req));
  });
  app.post('/api/auth/register', ...guards, guarded(async (req, res) => {
    if (auth.sessionFromRequest(req, { touch: false })) return res.status(409).json({ error: 'Сначала выйдите из аккаунта' });
    const values = validateRegistration(req.body);
    if (!values.valid) return res.status(400).json({ error: 'Проверьте поля формы', fields: values.errors });
    const fields = {};
    if (!db.isUsernameAvailable(values.usernameNormalized)) fields.username = 'Этот логин уже занят';
    if (db.getUserForAuthentication(values.emailNormalized)) fields.email = 'Этот email уже используется';
    if (Object.keys(fields).length) return res.status(409).json({ error: 'Аккаунт уже существует', fields });
    const conflict = beforeAuthenticate(req);
    if (conflict) return res.status(409).json({ error: conflict });
    if (!rate(req, 'send', values.emailNormalized, 6)) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже' });
    const previous = store.get(owner(req));
    if (previous && previous.resend_available_at > Date.now()) return res.status(429).json({ error: 'Подождите минуту перед повторным запросом' });
    const password = await hashPassword(values.password);
    const now = Date.now(), id = crypto.randomUUID(), code = newCode(previous);
    const result = store.begin({ id, owner_hash: owner(req), kind: 'REGISTER', user_id: null,
      username: values.username, username_normalized: values.usernameNormalized, email: values.email,
      email_normalized: values.emailNormalized, password_hash: password, code_hash: codeHash(id, code),
      code_expires_at: now + 600000, resend_available_at: now + 60000, sending_until: now + 60000,
      delivery_state: 'SENDING', created_at: now, expires_at: now + LIFETIME, return_to: safeReturnPath(req.body?.returnTo) });
    if (result.error) return res.status(result.status).json(result);
    return deliver(result.row, code, req, res);
  }));
  app.post('/api/auth/start-email-verification', ...guards, guarded(async (req, res) => {
    const session = auth.sessionFromRequest(req, { touch: false });
    if (!session) return res.status(401).json({ error: 'Войдите в существующий аккаунт' });
    if (session.user.emailVerifiedAt) return res.status(409).json({ error: 'Почта уже подтверждена' });
    const user = db.getUserForAuthentication(session.user.email.toLowerCase());
    if (!rate(req, 'send', user.email_normalized, 6)) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже' });
    const now = Date.now(), id = crypto.randomUUID(), code = newCode(store.get(owner(req)));
    const result = store.begin({ id, owner_hash: owner(req), kind: 'EXISTING', user_id: user.id,
      username: user.username, username_normalized: user.username_normalized, email: user.email,
      email_normalized: user.email_normalized, password_hash: null, code_hash: codeHash(id, code),
      code_expires_at: now + 600000, resend_available_at: now + 60000, sending_until: now + 60000,
      delivery_state: 'SENDING', created_at: now, expires_at: now + LIFETIME, return_to: '/profile' });
    if (result.error) return res.status(result.status).json(result);
    return deliver(result.row, code, req, res);
  }));
  function owned(req) {
    const row = store.get(owner(req));
    if (row?.kind === 'EXISTING' && auth.sessionFromRequest(req, { touch: false })?.user.id !== row.user_id) return null;
    return row;
  }
  app.post('/api/auth/resend-verification', ...guards, guarded(async (req, res) => {
    const row = owned(req);
    if (!row) return res.status(410).json({ error: 'Начните подтверждение заново' });
    if (!rate(req, 'send', row.email_normalized, 6)) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже' });
    const code = newCode(row), hash = codeHash(row.id, code);
    const result = store.reserveResend(owner(req), hash, Date.now());
    if (result.error) return res.status(result.status).json(result);
    return deliver(result.row, code, req, res);
  }));
  app.post('/api/auth/verify-email', ...guards, (req, res) => {
    const row = owned(req);
    if (!row) return res.status(410).json({ error: 'Начните подтверждение заново' });
    if (!rate(req, 'verify', row.email_normalized, 30, 900000)) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже' });
    if (row.kind === 'REGISTER') {
      if (auth.sessionFromRequest(req, { touch: false })) {
        return res.status(409).json({ error: 'Вы уже вошли в аккаунт. Выйдите перед завершением другой регистрации' });
      }
      const conflict = beforeAuthenticate(req);
      if (conflict) return res.status(409).json({ error: conflict });
    }
    const code = String(req.body?.code || '');
    let newSession;
    const result = store.confirm(owner(req), current => /^\d{6}$/.test(code) && equal(current.code_hash, codeHash(current.id, code)), Date.now(), userId => {
      newSession = auth.prepareSession(userId, req);
      auth.persistSession(newSession);
    });
    if (!result.success) return res.status(result.status).json(result);
    const sessionInfo = newSession ? auth.publishSession(newSession, req, res) : auth.sessionFromRequest(req, { touch: false });
    if (newSession) onAuthenticated(req);
    return res.json({ success: true, existingAccount: result.existingAccount,
      authenticated: true, user: db.getUserById(result.userId),
      csrfToken: sessionInfo.csrfToken, expiresAt: sessionInfo.expiresAt, returnTo: '/profile' });
  });
  app.post('/api/auth/cancel-registration', ...guards, guarded(async (req, res) => {
    store.cancel(owner(req)); res.json({ success: true });
  }));
}

module.exports = { registerEmailVerification };
