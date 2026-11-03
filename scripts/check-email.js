'use strict';

const { createMailer } = require('../server/emailMailer');
const { validateRegistration } = require('../server/userAuth');

async function main() {
  const mailer = createMailer();
  console.log(JSON.stringify(await mailer.verifyConnection()));
  const recipient = process.argv[2];
  if (!recipient) return;
  const valid = validateRegistration({ username: 'EmailTest', email: recipient,
    password: 'not-an-account-password', passwordConfirmation: 'not-an-account-password' });
  if (valid.errors.email) throw new Error('INVALID_RECIPIENT');
  const result = await mailer.sendTestEmail(recipient);
  console.log(JSON.stringify({ accepted: true, messageId: result.messageId, inboxDeliveryConfirmed: false }));
}

main().catch(error => {
  // SMTP errors may contain credentials or message data. Print only safe codes.
  console.error(JSON.stringify({ emailCheckFailed: true,
    code: /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'EMAIL_CHECK_FAILED',
    responseCode: Number(error.responseCode) || null }));
  process.exitCode = 1;
});
