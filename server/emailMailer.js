'use strict';

const nodemailer = require('nodemailer');

function createMailer(env = process.env, { request = fetch } = {}) {
  const mode = env.EMAIL_TRANSPORT || 'smtp';
  if (!['smtp', 'resend'].includes(mode)) throw new Error('INVALID_EMAIL_TRANSPORT');
  const apiKey = env.RESEND_API_KEY || '';
  const port = Number(env.SMTP_PORT || 465);
  const ready = mode === 'smtp' && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
  const transport = ready ? nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    logger: false, debug: false
  }) : null;
  async function send(message) {
    if (mode === 'resend') {
      if (!apiKey || !env.SMTP_FROM) throw new Error('MAIL_NOT_CONFIGURED');
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.SMTP_FROM, to: [message.to.address],
          subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        const error = new Error('RESEND_API_REJECTED');
        error.code = 'RESEND_API_REJECTED';
        error.responseCode = response.status;
        throw error;
      }
      const result = await response.json();
      if (!result.id || typeof result.id !== 'string') throw new Error('MAIL_INVALID_RESPONSE');
      return { messageId: result.id };
    }
    if (!transport) throw new Error('MAIL_NOT_CONFIGURED');
    const result = await transport.sendMail({ from: env.SMTP_FROM, ...message });
    if (!result.accepted?.length || result.rejected?.length) throw new Error('MAIL_REJECTED');
    return { messageId: result.messageId };
  }
  return {
    async verifyConnection() {
      if (mode === 'resend') {
        if (!apiKey || !env.SMTP_FROM) throw new Error('MAIL_NOT_CONFIGURED');
        return { transport: 'resend', configured: true, authenticationCheckedOnSend: true };
      }
      if (!transport) throw new Error('MAIL_NOT_CONFIGURED');
      await transport.verify();
      return { transport: 'smtp', authenticated: true };
    },
    async sendTestEmail(email) {
      return send({
        to: { address: email }, subject: 'AntikPoker — проверка отправки писем',
        text: 'Это контрольное письмо AntikPoker. Отправка через Resend настроена. Это не код регистрации, никаких действий не требуется.',
        html: '<h1>AntikPoker</h1><p>Это контрольное письмо. Отправка через Resend настроена.</p><p>Это не код регистрации, никаких действий не требуется.</p>'
      });
    },
    async sendCode(email, code) {
      const verificationUrl = new URL('/verify-email', env.PUBLIC_BASE_URL).href;
      return send({
        to: { address: email },
        subject: 'AntikPoker — подтверждение email',
        text: `Ваш код подтверждения AntikPoker: ${code}\n\nВведите его на сайте: ${verificationUrl}\nКод действует 10 минут.\nЕсли вы не запрашивали код, проигнорируйте это письмо.`,
        html: `<h1>Подтверждение email AntikPoker</h1><p>Ваш код подтверждения:</p><p style="font-size:32px;letter-spacing:6px"><strong>${code}</strong></p><p><a href="${verificationUrl}">Введите его на сайте</a>. Код действует 10 минут.</p><p>Если вы не запрашивали код, проигнорируйте это письмо.</p>`
      });
    }
  };
}

module.exports = { createMailer };
