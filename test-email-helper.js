'use strict';

const fs = require('node:fs');
function testMailEnvironment(directory) {
  return {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require "${require.resolve('./test-email-transport').replaceAll('\\', '/')}"`,
    TEST_EMAIL_OUTBOX: require('node:path').join(directory, 'email-outbox.jsonl')
  };
}
function lastCode(filename, email) {
  const rows = fs.readFileSync(filename, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return rows.filter(row => row.email.toLowerCase() === email.toLowerCase()).at(-1)?.code;
}
function cookies(response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }
async function verifiedRegistration(base, values, outbox) {
  const init = await fetch(`${base}/api/auth/registration`);
  const bootstrap = await init.json();
  let cookie = cookies(init);
  const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': bootstrap.csrfToken };
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers, body: JSON.stringify(values) });
  if (response.status !== 202) return response;
  const verification = await fetch(`${base}/api/auth/verify-email`, {
    method: 'POST', headers, body: JSON.stringify({ code: lastCode(outbox, values.email) })
  });
  if (verification.status !== 200) throw new Error(`Verification failed: ${await verification.text()}`);
  const combinedHeaders = new Headers(verification.headers);
  for (const initialCookie of init.headers.getSetCookie()) combinedHeaders.append('Set-Cookie', initialCookie);
  return new Response(verification.body, { status: verification.status, headers: combinedHeaders });
}
module.exports = { testMailEnvironment, lastCode, verifiedRegistration, cookies };
