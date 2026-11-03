# AntikPoker V2.3

## Scope

- Development branch only. No production, VPS, DNS, Cloudflare, Gcore or Nginx changes.
- Local preview: http://localhost:3001.
- V2.3 supersedes the post-confirmation login step described in the V2.2 report.

## Email Confirmation And Automatic Login

- A correct email code creates the user, consumes the pending registration and
  persists a fresh auth session in one SQLite transaction.
- A session-write failure rolls back account creation and code consumption.
- Repeated confirmation cannot create another user or session.
- The existing HttpOnly/SameSite cookie is issued after commit and uses Secure
  when accessed through trusted HTTPS proxy handling.
- No password repost, session token in JSON/URL, or browser token storage.
- The interface immediately updates its auth state and opens `/profile`.
- Existing login/logout, guest seat ownership and reconnect rules remain intact.

## Avatar Interaction

- Click the avatar to open its upload/delete menu; deletion is shown only for
  a custom avatar. Hover/focus displays a camera overlay without layout changes.
- File selection opens a preview with Save and Cancel. Cancel performs no write.
- Upload/delete use the existing API, CSRF, auth and image validation pipeline.
- Busy controls prevent parallel writes. Failed uploads retain the current
  avatar and preview for retry.
- Success refreshes the profile, header and existing live-seat update mechanism.
- Native keyboard buttons, Escape/focus handling, touch-sized actions and
  viewport-bounded mobile menu are included.

## Main Files

- `server/userAuth.js`, `server/db.js`: session preparation, atomic persistence
  and post-commit cookie publication.
- `server/registrationStore.js`, `server/emailVerification.js`: atomic signup
  and automatic login after confirmation.
- `public/site/js/verification.js`, `public/site/pages/verify-email.html`:
  immediate auth-state update and profile navigation.
- `public/site/js/api.js`, `public/site/js/auth.js`: session state and avatar
  cache updates; stale session responses cannot undo automatic login/logout.
- `public/site/pages/profile.html`, `public/site/js/profile.js`,
  `public/site/css/auth.css`: interactive avatar menu and preview flow.
- `server/siteRenderer.js`: versioned site assets (`20261103c`).

## Verification

- Full `npm test`: PASS (including the two new UI regression tests).
- `git diff --check`: PASS.
- Automated: email verification, authentication, profile/avatar API, avatar UI,
  stale-session UI races, guest/account separation and existing release tests.
- Browser: signup -> code -> authenticated profile, refresh, avatar save/cancel/
  delete, header synchronization, keyboard controls and narrow mobile viewport.
- Browser QA used an isolated test database and fake email delivery.
- Physical Android/iOS photo pickers have not been tested on actual devices.

## Manual Check

1. Open http://localhost:3001/register with a new login and accessible email.
2. Enter the code: the header should show the account and `/profile` should open
   without entering the password again. Refresh to verify the session persists.
3. Click the profile avatar, choose a PNG/JPEG/WebP up to 5 MiB, inspect the
   preview, cancel once, then select again and save.
4. Check the profile/header avatar; use the avatar menu to delete it and restore
   the default. Test the same menu by touch and with Enter/Space/Escape.
