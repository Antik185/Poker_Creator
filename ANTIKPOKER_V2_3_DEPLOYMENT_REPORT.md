# AntikPoker V2.3 Deployment Preflight

Date: 2026-11-03 (Europe/Kaliningrad).

**Status: DEPLOYED. AntikPoker V2.3 is running on https://antikpoker.online.**

## Production Result

- Installed commit: `6f35f33d10577323e79e878b32586d0b6cb20e97`, not the later documentation commits.
- Archive SHA-256 verified before installation:
  `39255493248ad47f0c370617f562d6af32d3e95b6473d768c7a0e2bf9c07a6c5`.
- Service: `poker-room.service`, Node 24.22.0, PID `129404` at final verification.
- Successful service window: 2026-11-03 12:18:34-12:18:39 Europe/Kaliningrad.
- All 222 archived release files were verified after extraction.
- Migrations 1, 2 and 3 applied from the agreed release while the old service was
  stopped. SQLite integrity is OK; foreign_key_check reports zero errors.
- `PLAYER_SESSION_SECRET` and the admin password were preserved. New persistent
  account/email-verification secrets and Resend SMTP settings were installed in
  `/etc/poker-room.env`, root:root 0600. Loaded secrets match that file; values
  were never included in this report or application logs.
- Production SMTP sender: `AntikPoker <noreply@antikpoker.online>`.
- Nginx configuration and the production systemd unit match their pre-deployment
  hashes. DNS, Cloudflare, Gcore and routing were not changed.

### Final Backup And Preservation

- Frozen, restore-checked final backup:
  `/home/deploy/antik-v23-final-2026-11-03T10-18-34-387Z`.
- Final pre-start database SHA-256:
  `9f0f19aac234b4315ae7d5e5bc66854d9da481f44f437a26833bde923e652432`.
- Final old-application archive SHA-256:
  `2ac66b0cda518bf0ad08c766d67aa8091883c5bee07d0bbf290a00d8ed4841f6`.
- Consistent SQLite+uploads copied with the service stopped; restore copy opened,
  integrity and original row counts checked; all referenced uploads present.
- Separate protected configuration archive and previous node_modules retained.
- Only DWJJ (`a23c684d-a2a8-48fa-8774-156e576cbb98`) was removed: one room,
  one tournament state and one table state. It had no registration rows to delete.
- All other 20 original rooms and all 181 original registrations remain. Final
  comparison also preserved original room/table/tournament/move rows (excluding
  automatic updated_at metadata) and every one of the 112 original upload hashes.

### Production Verification

- Public HTTPS health: 200 with valid TLS, including a check from the owner's PC.
- Public home, CSS/JS, login/register/verification pages, diagnostics, lobby and
  table URLs: 200; official-site asset version `20261103c` observed.
- Production admin login/session/page: passed with the preserved password.
- Public Socket.IO polling, direct WSS and polling-to-WebSocket upgrade: passed.
- Real Resend registration to the explicitly approved Gmail+alias: delivered;
  no user existed before the owner's code; confirmation created one account and
  automatic login, Secure/HttpOnly/SameSite cookie and authenticated profile passed.
- Code replay rejected; refresh, logout/revocation and password login passed.
- PNG, JPEG and WebP upload/replacement, public 256px WebP delivery and deletion
  passed using only the newly approved technical account. History/stats APIs passed.
- Owner separately approved one new service room, **2SDB / V2.3 smoke**
  (`8a6b4e20-c14b-471d-8efe-c88e5dde1f4d`). Guest name, seat and stack survived
  disconnect/reconnect, with WebSocket observed on reconnection. No hand was played.
  The room is retained, not silently deleted. No old room was used for mutations.
- Technical account: `V23ReleaseCheck`; primary owner email remains free. Its
  generated credentials are server-private (0600), not in Git or this report.
- Observed final totals: 21 rooms (20 preserved + one authorized smoke room),
  181 registrations, one user, zero pending registrations, zero fabricated MTT results.
- No destructive/full test suite was run against production. The full suite had
  already passed on isolated local/VPS databases.
- Final application journal scan: zero Unhandled/Error/FATAL entries after start.
- Safe machine-readable evidence:
  `/home/deploy/antik-v23-production-final-audit.json`.

### Issues And Recovery

- First attempt stopped before migrations because the operational wrapper closed
  stdin for the protected environment writer. The application candidate was not
  changed. The old schema and every unrelated row were checked before a code-only
  rollback; **no SQLite restore occurred and no new data was overwritten**.
- First service-stop window: 12:10:25-12:13:02 Europe/Kaliningrad. Old public health
  and admin access were verified after recovery; approved DWJJ removal remained.
- Owner explicitly authorized the retry. Wrapper stdin/stdout handling was tested
  locally, a new frozen backup was taken, and the second deployment succeeded.
- A preliminary stdout-wrapper error had also been caught before any production
  stop. Both wrapper I/O cases are covered by the local operational regression check.
- Some initial external transport probes had timeouts / xhr poll errors. Repeated
  public and origin connections succeeded; actual guest reconnect passed over WSS.
  No matching application errors were logged. The transient probe failure cause
  was not established; physical-device/network play tests remain necessary.
- Android/iPhone UI, real multi-player MTT and resulting account history remain
  the owner's next acceptance tests; they are not claimed as production-tested here.

## Historical Preflight Record

The sections below record the environment and plan before publication. The
production outcome above supersedes their earlier staging-only status.

Russian-network access, alternate routing, DNS, Cloudflare and Gcore changes are
excluded at the owner's request. No production proxy configuration was changed.

## Release Candidate

- Branch: `codex/antikpoker-v2-auth`.
- Complete code candidate: `6f35f33d10577323e79e878b32586d0b6cb20e97`.
- Includes V2/V2.1 plus V2.2/V2.3 from `aa682a1` and Linux preflight fixes.
- VPS archive: `/home/deploy/antik-v23-6f35f33.tar.gz`.
- SHA-256: `39255493248ad47f0c370617f562d6af32d3e95b6473d768c7a0e2bf9c07a6c5`.
- During preflight, no push/restart/production migration was performed. Actual
  publication and recovery are recorded in Production Result above.

## Actual VPS

| Component | Observed |
| --- | --- |
| Host | `170.168.33.82`, Ubuntu 24.04 LTS, x64 |
| Runtime | Node `24.22.0`, npm `11.19.1`; `crypto.argon2` available |
| App | `/var/www/poker-room` |
| Service | `poker-room.service`, user/group `deploy`, `/usr/bin/node server/index.js` |
| Listener | `127.0.0.1:3000`, production PID stayed `108630` throughout preflight |
| Proxy | Existing Nginx HTTPS on 443; HTTP/1.1 upgrade headers and 3600s timeouts present |
| HTTPS | Existing Let's Encrypt files, valid until 2027-01-21; main `/healthz`: HTTP 200, TLS verification OK |
| Database | `/var/www/poker-room/poker.db`, WAL, integrity_check OK, about 10 MB |
| Files | `/var/www/poker-room/public/uploads`, 112 files at snapshot time |
| Avatars | No existing production profile-avatar directory |
| Environment | `/etc/poker-room.env`, root:root 0600 |
| Proxy trust | `TRUST_PROXY=1`; Node bound to loopback, Nginx sets forwarded scheme |
| Secrets | Persistent player secret and admin password present; user/mail secrets not yet installed |
| Capacity | About 11 GB disk free after staging; about 1.2 GB RAM available; 3 GB swap |

Player session secret is at least 32 bytes and matches the persistent environment
file; only boolean checks were printed, never the secret itself.

Production has no `.git` directory. Old `.deploy-*` markers do not establish an
exact production revision. `server/index.js` and `public/poker.js` match content
from `c3d763b`; `server/db.js` has no exact match in the inspected local history.
Do not claim a clean Git worktree or use `git pull` for this installation.
The byte-for-byte old application archive is the rollback reference.

## Production Data And DWJJ

- At inspection: 21 rooms, 181 registrations, 21 tournament states, 6 table snapshots.
- No V2 migration tables, user accounts or account sessions existed in production.
- Twenty tournaments were FINISHED; DWJJ was RUNNING with 3 ACTIVE registrations.
- Persisted DWJJ table was WAITING with no occupied seats. Persisted connection
  flags are not proof that nobody can reconnect: recheck live activity at cutover.
- Owner identified DWJJ as a test and authorized removing it.
- At preflight, DWJJ had not been deleted. The running application retained state
  in memory and exposes no tournament-delete API. Removing SQLite rows alone is
  unsafe. Owner explicitly chose removal during a future approved deployment,
  without stopping the current site now.
- Do not remove any other tournament or uploaded image.

## Backup And Restore Check

- Private VPS snapshot: `/home/deploy/antik-v23-backup-20261103`, mode 0700.
- SQLite created with Online Backup API, not a copy of an active WAL main file.
- No `server/db` import, migration or production write was used for the snapshot.
- Upload tree hashes were stable across database backup; copied files match.
- All 111 referenced upload paths exist in the 112-file copy.
- `poker.db` SHA-256: `5ff158f813fb1e34d9c4e6b88953a361a5881a12a602776212f0eba6d91db060`.
- `application.tar.gz` SHA-256: `fcf56e64856e1a69dd795bef73aee8842b7066a6f8e270b44e50d36fc342e7d7`.
- Old code archive excludes runtime DB/WAL, uploads, node_modules and `.env*`.
- Nginx, Let's Encrypt, systemd unit and `/etc/poker-room.env` are separately
  archived in root-owned `system-config.tar.gz`, mode 0600; archive listing checked.
- Restored database and uploads were used in isolated staging. Integrity is OK;
  migrations 1/2/3 preserved every original table count (21 rooms/181 registrations).
- A local data/code/files copy is verified under
  `E:/pokerRoom/backups/vps-preflight-20261103/`, excluded from Git.
- Verified off-VPS archive: `backups/antik-v23-offsite-complete-20261103.tar.gz`;
  SHA-256 `723c3bf28aeedfcec9c7ea629bc2c1287f5a4ae85caaf3d513a55861ef2436ae`.
- Local restore check also passed SQLite integrity, original table counts and all
  112 individual upload hashes after extraction.
- Secret/TLS configuration archive remains root-only on the VPS, not in Git or chat.
- This is a verified preparation snapshot, **not** the final frozen cutover backup.
  A new coordinated backup is required after production writers stop.

## Resend

- VPS outbound `smtp.resend.com:465` succeeds with verified TLS 1.3.
- Staging authenticated to Resend SMTP using the existing owner-provided key,
  transferred over SSH stdin into a private staging environment (0600).
- Sender: `AntikPoker <noreply@antikpoker.online>`.
- One real registration code was delivered to the owner's approved Gmail inbox.
- Owner supplied that code: account creation, automatic login, Secure/HttpOnly/
  SameSite session cookie, `/profile` and session refresh passed.
- SQLite confirmed exactly one verified user, one session and no pending signup.
- Replaying with registration CSRF returned 410; no duplicate user/session.
- Initial smoke harness mixed auth and registration CSRF during its replay check;
  correct server response was 403. Harness fixed; replay rechecked with proper CSRF.
- Logout and avatar/identity/history regressions passed in the complete VPS suite.
- Automated suites use fake mail delivery, never real recipient lists.
- Production mail was unconfigured at preflight; it is now configured as above.

Install these additional settings in the existing root-owned environment file
only during the approved deployment; never replace its existing player secret:

```dotenv
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=<existing Resend key, installed securely, never in command arguments>
SMTP_FROM="AntikPoker <noreply@antikpoker.online>"
EMAIL_VERIFICATION_SECRET=<new persistent random secret, at least 32 bytes>
USER_AUTH_SECRET=<new persistent random secret, at least 32 bytes>
PUBLIC_BASE_URL=https://antikpoker.online
REQUIRE_HTTPS=1
POKER_DB_PATH=/var/www/poker-room/poker.db
PROFILE_AVATAR_DIR=/var/www/poker-room/public/uploads/profile-avatars
```

Port 465 selects implicit TLS in the existing mailer. Certificate verification
is mandatory. Do not copy staging player/admin/auth secrets into production.

## Private Staging And Tests

- App: `/home/deploy/antik-v23-app-aa682a1` (initial extraction directory name).
- Data/secrets: `/home/deploy/antik-v23-data-aa682a1`; copied production DB/uploads.
- Separate transient services: `antik-v23-staging`, `antik-v23-staging-tls`.
- Bound only to `127.0.0.1:3301` and `127.0.0.1:3443`; no public staging listener.
- Separate random auth/player/admin secrets; no shared production session/SSO.
- Private seven-day self-signed test certificate. Test clients explicitly trust
  that certificate and verify its hostname; no `-k` or disabled TLS verification.
- This is private integration staging, not a new public browser/device hostname.
- Pages/assets, diagnostics, admin login, polling, WSS and upgrade passed through TLS.
- Existing tournament E2E scenario passed through this TLS proxy: 15/15, including
  guest names, lobby, play, elimination, victory, no re-entry and AFK continuation.
- Full `npm ci` and `npm test`: PASS locally and on the VPS.
- `npm audit --omit=dev`: zero reported vulnerabilities at preflight time.
- Fixed lockfile `gypfile:false` metadata: clean npm ci no longer mistakenly
  compiles better-sqlite3 despite its packaged prebuilt native binaries.
- Fixed two test assumptions: CRLF/LF-dependent source window and reading the
  upload directory before asynchronous unlink finishes. No gameplay changes.
- Physical Android/iPhone, Yandex/Mail.ru delivery and multi-device user testing
  remain manual checks; do not claim those have been completed.

Dependency versions: better-sqlite3 13.0.3, express 5.3.0, multer 2.5.0,
nodemailer 10.3.1, sharp 0.35.5, socket.io 4.8.4, uuid 14.0.2.

## Original Approved-Window Deployment Plan

1. Obtain explicit production-release approval and a maintenance window. Recheck
   live participants, incomplete tournaments and unexpected new writes.
2. Verify the exact `6f35f33` archive hash. Prepare its dependencies in a separate
   candidate directory using `npm ci --omit=dev`; do not install over live modules.
3. Save the current unit/environment/proxy configuration and old application.
   Keep the existing environment file, player secret and all runtime paths.
4. Stop only `poker-room.service` in the approved window. Do not change DNS/Nginx.
   Existing Nginx may briefly return 502; no maintenance-page change is authorized.
5. Take and verify a fresh DB+uploads backup with production writers stopped.
6. Remove only DWJJ (`a23c684d-a2a8-48fa-8774-156e576cbb98`) transactionally while
   the old process is stopped, checking both ID and code. Preserve its backup and
   all other rooms/files. Verify expected row deltas and no orphan child rows.
7. Install exact candidate files in `/var/www/poker-room`; preserve `poker.db*`,
   uploads and secrets. Retain the old node_modules separately for rollback.
   Never run `git clean`, a broad recursive delete or `rsync --delete` here.
8. Add the secure mail/auth settings above; preserve file ownership and 0600 mode.
9. Start the new service once. Its migrations 1/2/3 apply to the production DB
   only now; never run old and new services concurrently on this database.
10. Check local health, public HTTPS, diagnostics polling/upgrade/WSS, admin login,
    controlled registration/profile/avatar, guest reconnect and logs. Do not run
    the destructive release suite against production or reuse staging test users.
11. Record the installed revision, migration results, data counts and monitoring.
    Authorize public beta only after the manual device checks are accepted.

Budget a 5-10 minute maintenance window, not a guaranteed outage duration.
Node/npm upgrade and production proxy/domain changes are not required.

## Rollback

1. Stop the candidate if health, migration, cookies, mail or WSS checks fail.
2. Preserve a new snapshot of failed-release data and logs before any recovery.
3. Restore the exact old application archive, previous modules and protected
   environment; leave proxy/DNS unchanged. Do not guess an old Git revision.
4. Do not assume additive SQL alone makes V2 gameplay/account identity compatible
   with the old server. Validate schema/identity compatibility on a copy first.
5. If rollback needs the pre-release DB, require explicit approval of any loss
   of post-release accounts/results. Restore the matching uploads set as well.
   Never overwrite new user data with the old snapshot silently.
6. Recheck old health/HTTPS/reconnect, then record the actual recovery outcome.

## Final Checkpoint

Production V2.3 publication and the agreed smoke checks are complete. Data
preservation, frozen backup, secrets, migrations and HTTPS/realtime were verified.
Only manual physical-device and real-play acceptance remain. No additional
feature, redesign, routing change or data restoration was performed.
Post-release rollback must preserve the new account and authorized smoke room;
restoring the pre-release SQLite still requires separate data-loss approval.
