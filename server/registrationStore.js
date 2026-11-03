'use strict';

const crypto = require('node:crypto');

function createRegistrationStore(db) {
  const get = owner => db.prepare('SELECT * FROM pending_registrations WHERE owner_hash = ?').get(owner);
  const cleanup = (now = Date.now()) => {
    db.prepare('DELETE FROM pending_registrations WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM email_verification_limits WHERE expires_at <= ?').run(now);
  };
  return {
    cleanup, get,
    cancel: owner => db.prepare('DELETE FROM pending_registrations WHERE owner_hash = ?').run(owner),
    consume: db.transaction((key, limit, windowMs, now) => {
      const row = db.prepare('SELECT * FROM email_verification_limits WHERE key = ?').get(key);
      if (row && row.expires_at > now && row.count >= limit) return false;
      db.prepare(`INSERT INTO email_verification_limits VALUES (?,1,?)
        ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count+1 END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END`)
        .run(key, now + windowMs, now, now);
      return true;
    }),
    begin: db.transaction(row => {
      const current = get(row.owner_hash);
      if (current && current.expires_at > row.created_at
        && (current.resend_available_at > row.created_at || current.sending_until > row.created_at)) {
        return { error: 'Подождите перед повторной отправкой', status: 429 };
      }
      db.prepare('DELETE FROM pending_registrations WHERE owner_hash = ?').run(row.owner_hash);
      const columns = Object.keys(row);
      db.prepare(`INSERT INTO pending_registrations (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        .run(...columns.map(key => row[key]));
      return { row };
    }),
    reserveResend: db.transaction((owner, hash, now) => {
      const row = get(owner);
      if (!row || row.expires_at <= now) return { status: 410, error: 'Регистрация истекла. Начните заново' };
      if (row.sending_until > now || row.resend_available_at > now || row.send_count >= 6) {
        return { status: 429, error: 'Повторная отправка пока недоступна или исчерпан лимит' };
      }
      db.prepare(`UPDATE pending_registrations SET code_hash=?, code_expires_at=?, attempts_count=0,
        send_count=send_count+1, resend_available_at=?, sending_until=?, delivery_state='SENDING'
        WHERE owner_hash=?`).run(hash, now + 600000, now + 60000, now + 60000, owner);
      return { row: get(owner) };
    }),
    delivered: (id, hash, accepted) => db.prepare(`UPDATE pending_registrations
      SET delivery_state=?, code_hash=CASE WHEN ? THEN code_hash ELSE NULL END, sending_until=0
      WHERE id=? AND code_hash=? AND delivery_state='SENDING'`)
      .run(accepted ? 'SENT' : 'FAILED', accepted ? 1 : 0, id, hash),
    confirm: db.transaction((owner, matches, now, onRegistered = () => {}) => {
      const row = get(owner);
      if (!row || row.expires_at <= now) return { status: 410, error: 'Регистрация истекла. Начните заново' };
      if (row.delivery_state !== 'SENT') return { status: 409, error: 'Сначала успешно отправьте код' };
      if (row.attempts_count >= 5) return { status: 429, error: 'Попытки исчерпаны. Запросите новый код' };
      if (row.code_expires_at <= now) return { status: 410, error: 'Код истёк. Запросите новый код' };
      db.prepare('UPDATE pending_registrations SET attempts_count=attempts_count+1 WHERE id=?').run(row.id);
      if (!matches(row)) return { status: 400, error: 'Неверный код подтверждения' };
      let userId = row.user_id;
      if (row.kind === 'EXISTING') {
        const user = db.prepare('SELECT id, email_normalized FROM users WHERE id=?').get(row.user_id);
        if (!user || user.email_normalized !== row.email_normalized) return { status: 409, error: 'Данные аккаунта изменились' };
        db.prepare('UPDATE users SET email_verified_at=COALESCE(email_verified_at,?), updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(new Date(now).toISOString(), user.id);
      } else {
        if (db.prepare('SELECT 1 FROM users WHERE username_normalized=? OR email_normalized=?')
          .get(row.username_normalized, row.email_normalized)) {
          return { status: 409, error: 'Логин или email уже занят. Измените данные регистрации' };
        }
        userId = crypto.randomUUID();
        db.prepare(`INSERT INTO users (id,username,username_normalized,email,email_normalized,password_hash,email_verified_at)
          VALUES (?,?,?,?,?,?,?)`).run(userId, row.username, row.username_normalized,
          row.email, row.email_normalized, row.password_hash, new Date(now).toISOString());
        onRegistered(userId);
      }
      db.prepare('DELETE FROM pending_registrations WHERE id=?').run(row.id);
      return { success: true, userId, existingAccount: row.kind === 'EXISTING', returnTo: '/profile' };
    })
  };
}

module.exports = { createRegistrationStore };
