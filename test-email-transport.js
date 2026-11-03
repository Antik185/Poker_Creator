'use strict';

// Test subprocess preload only. Production has no outbox endpoint or fake-mail flag.
const fs = require('node:fs');
process.env.EMAIL_VERIFICATION_SECRET = 'test-email-verification-secret-with-at-least-32-bytes';
process.env.PUBLIC_BASE_URL = 'https://antikpoker.test';
require('./server/emailMailer').createMailer = () => ({
  async sendCode(email, code) {
    if (email.startsWith('mailfail@')) throw new Error('simulated transport rejection');
    fs.appendFileSync(process.env.TEST_EMAIL_OUTBOX, `${JSON.stringify({ email, code })}\n`);
  }
});
