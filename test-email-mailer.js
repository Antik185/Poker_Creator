'use strict';

const assert = require('node:assert/strict');
const { createMailer } = require('./server/emailMailer');

(async () => {
  const env = { EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'test-only-not-a-real-key',
    SMTP_FROM: 'AntikPoker <noreply@antikpoker.online>', PUBLIC_BASE_URL: 'https://antikpoker.online' };
  let calls = 0;
  const mailer = createMailer(env, { request: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
    const message = JSON.parse(options.body);
    assert.deepEqual(message.to, ['delivered@resend.dev']);
    assert.equal(message.from, env.SMTP_FROM);
    assert.ok(message.text.includes('000123'));
    assert.ok(message.html.includes('000123'));
    assert.ok(message.text.includes('https://antikpoker.online/verify-email'));
    assert.ok(!message.text.includes('code='));
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ id: 'test-message-id' }) };
  } });
  assert.deepEqual(await mailer.verifyConnection(), { transport: 'resend', configured: true, authenticationCheckedOnSend: true });
  assert.equal(calls, 0, 'configuration check does not pretend to validate the API key');
  assert.deepEqual(await mailer.sendCode('delivered@resend.dev','000123'), { messageId: 'test-message-id' });
  assert.equal(calls,1);
  for (const status of [401,403,422,429,500]) {
    let failures = 0;
    const rejected = createMailer(env, { request: async () => { failures++; return { ok:false, status }; } });
    await assert.rejects(rejected.sendCode('delivered@resend.dev','000123'), error =>
      error.code === 'RESEND_API_REJECTED' && error.responseCode === status && !error.message.includes(env.RESEND_API_KEY));
    assert.equal(failures,1,'no implicit retry or SMTP fallback that could duplicate mail');
  }
  await assert.rejects(createMailer({ ...env, RESEND_API_KEY: '' }).sendCode('delivered@resend.dev','000123'), /MAIL_NOT_CONFIGURED/);
  await assert.rejects(createMailer(env, { request: async () => { throw new DOMException('timeout','TimeoutError'); } }).sendCode('delivered@resend.dev','000123'), { name:'TimeoutError' });
  await assert.rejects(createMailer(env, { request: async () => ({ ok:true, json:async()=>({}) }) }).sendCode('delivered@resend.dev','000123'), /MAIL_INVALID_RESPONSE/);
  assert.throws(()=>createMailer({EMAIL_TRANSPORT:'invalid'}),/INVALID_EMAIL_TRANSPORT/);
  console.log('PASS  Resend HTTPS messages, safe errors, timeout, no duplicate fallback and missing configuration');
})().catch(error=>{console.error(error);process.exitCode=1;});
