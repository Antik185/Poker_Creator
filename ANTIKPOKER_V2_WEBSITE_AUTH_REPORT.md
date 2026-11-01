# AntikPoker V2 Website and Authentication Report

## 1. Result

AntikPoker now has a modular public website and a separate persistent user-account
system. The work is isolated on branch `codex/antikpoker-v2-auth`; production,
Cloudflare, Gcore, DNS and Nginx were not changed.

The approved `AntikPoker-menu-arts-auth-v9` layout was preserved and split into
maintainable templates, components, styles, scripts and same-origin image assets.
The existing poker room, lobby, administrator and player-session flows remain
separate and continue to use their existing routes and identities.

## 2. Project Structure

```text
public/site/
  assets/images/          Local WebP artwork used by the public site
  components/             Header, footer and home-page sections
  css/                    Variables, base, layout, components, pages, auth, responsive
  js/                     API, navigation, showcase, authentication and bootstrap
  pages/                  Home, login, registration, profile and coming-soon pages
  templates/layout.html   Shared document shell
server/
  migrations.js           Versioned SQLite schema migrations
  siteRenderer.js         Cached server-side composition of HTML fragments
  userAuth.js             Registration, login, session and logout implementation
  db.js                   Prepared account/session database operations
  index.js                Public pages, existing game routes and static assets
test-user-auth.js          Account and public-site regression coverage
```

## 3. HTML, CSS and JavaScript Split

- Home sections are independent HTML fragments in `public/site/components/`.
- Shared markup is assembled through `public/site/templates/layout.html`.
- CSS is divided by responsibility rather than kept in one generated document.
- Browser logic is split into API, navigation, showcase and authentication modules.
- The public pages use a strict page-specific CSP and do not require inline scripts.
- `/site` serves versioned same-origin assets with long-lived immutable caching.

## 4. Images and Initial Loading

The four embedded design images were extracted to WebP files under
`public/site/assets/images/`; the rendered page contains no base64 image payloads.
The initially visible showcase artwork is preloaded by the server renderer.

Custom poker-table felt uploads are optimized in the browser before upload:

- images larger than 1600 px on either axis are resized proportionally;
- supported still images are converted to WebP at quality 0.84;
- animated GIF files are preserved to avoid destroying animation;
- the selected image is previewed from an object URL without a second file read;
- an existing room felt is preloaded in the room HTML, and room configuration also
  starts a high-priority client preload as a fallback.

The action-bar preset row (`1/2 Pot`, `2/3 Pot`, and related controls) now explicitly
returns to full opacity when it becomes the local player's turn.

## 5. Editing the Home Page

Edit section content in `public/site/components/*.html`. Shared navigation and footer
content live in `header.html` and `footer.html`. Page-specific presentation belongs in
`public/site/css/home.css`; shared controls belong in `components.css`; responsive
rules belong in `responsive.css`. Bump `SITE_ASSET_VERSION` in
`server/siteRenderer.js` when a release must invalidate cached browser assets.

## 6. Rooms and Tournaments

`/rooms` and `/tournaments` are real routed pages but intentionally display a
coming-soon state. The current game entry remains at `/play`, lobby links remain at
`/lobby/:code`, and tables remain at `/r/:id`.

When a real catalog is implemented, the page fragments can be replaced without
changing the game engine. Catalog APIs should return public projections only and
must continue to enforce tournament and seat changes server-side.

## 7. Registration and Login

Available routes:

- `GET /register` and `POST /api/auth/register`
- `GET /login` and `POST /api/auth/login`
- `GET /profile` and `GET /api/auth/profile`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/auth/username-available`

Usernames and emails are normalized and unique without case sensitivity. Passwords
must contain 10-256 characters and are stored using Argon2id, never as plaintext.
The default Argon2id parameters are 64 MiB memory, three passes and one lane.
Login supports either username or email and uses a generic failure response to avoid
account enumeration. A per-source login rate limit is enforced.

## 8. Sessions and Security

- Session identifiers are random opaque values; only SHA-256 hashes are stored.
- Sessions persist in SQLite for 30 days and survive application restarts.
- The cookie is host-only, `HttpOnly`, `SameSite=Lax`, and `Secure` under HTTPS.
- Login rotates any current session to prevent session fixation.
- Multiple devices are supported with independent revocable sessions.
- Logout requires a session-bound CSRF token.
- Registration and login require same-origin JSON requests.
- Account sessions do not grant administrator rights and do not replace the existing
  `poker_player` gameplay identity.

`USER_AUTH_SECRET` should be a persistent random value of at least 32 bytes. When it
is absent, the application deliberately falls back to `PLAYER_SESSION_SECRET`.

## 9. SQLite Migrations

`server/migrations.js` creates and records schema version 1 in
`schema_migrations`. It adds `users`, `auth_sessions`, normalized unique indexes,
session lookup indexes and a cascading foreign key. Migrations execute transactionally
when `server/db.js` opens the database. Database access uses prepared statements.

The database path is controlled by `POKER_DB_PATH`; otherwise the existing project
database is used. Back up the database before applying migrations in production.

## 10. Local Run

Node.js 24.7 or newer is required because authentication uses the built-in
`crypto.argon2` implementation.

```powershell
npm ci
$env:PLAYER_SESSION_SECRET = '<persistent-random-value-at-least-32-bytes>'
$env:USER_AUTH_SECRET = '<separate-persistent-random-value-at-least-32-bytes>'
$env:ADMIN_PASSWORD = '<strong-admin-password>'
npm test
npm start
```

Open `http://localhost:3000/` for the public site, `/register` for an account,
`/play` to join by code, `/admin` for room administration, and `/diagnostics` for
transport diagnostics.

## 11. Verification

The complete `npm test` release suite passed. Focused coverage also passed for:

- user registration, Argon2id hashes and case-insensitive uniqueness;
- login by username/email, generic failures and rate limiting;
- persistent, expired and revoked sessions, rotation, CSRF and multi-device use;
- owner-only profile data and separation from administrator privileges;
- migration execution and restart persistence;
- official pages, local assets, CSP and legacy route compatibility;
- felt optimization/preloading and action-bar active-state restoration;
- admin authentication, edge handoff, database reliability and the full poker engine.

Desktop and 390 px mobile layouts were visually checked, including the mobile menu
and registration form. No horizontal overflow was observed.

## 12. Intentionally Not Implemented

- Email verification, password recovery and email delivery.
- Linking a website account to an existing player/tournament identity.
- A live public room or tournament catalog.
- OAuth, two-factor authentication and session-management UI.
- Changes to Russian traffic routing. The current availability issue is external to
  this application and depends on ISP/Gcore reachability, so no production routing
  workaround was introduced in this branch.

## 13. Safe Production Release and Rollback

1. Keep the current domain unchanged and deploy this branch to an isolated staging
   host with a copied database and uploads directory.
2. Configure persistent `PLAYER_SESSION_SECRET`, `USER_AUTH_SECRET` and
   `ADMIN_PASSWORD`; enable HTTPS and set `TRUST_PROXY=1` only behind exactly one
   trusted reverse proxy.
3. Back up the production database, application revision and `public/uploads/`.
4. Run `npm ci --omit=dev`, `npm test`, migration startup, `/healthz`, registration,
   login/logout, administrator login, lobby, table and Socket.IO/WSS smoke tests.
5. Release by switching the application revision only after staging succeeds. Do not
   combine this release with Cloudflare, Gcore, DNS or Nginx routing changes.
6. Roll back by restoring the previous application revision. Migration version 1 is
   additive, so the previous application can ignore its new tables; retain the backup
  for a full database restore if required.
