# Security Stage 1

Date: 2026-10-21

## Result

- New rooms use a server-issued, signed player identity stored in an `HttpOnly`,
  `SameSite=Lax` cookie. Browser-supplied `playerId` values are ignored.
- A second tab with the same authenticated browser session takes control of the
  reserved seat. The previous socket becomes a spectator and cannot submit
  player actions, reactions, or table effects.
- Public instant-lobby payloads expose player names only. Socket IDs and private
  reconnect IDs remain server-side.
- New deck shuffles and short room codes use `crypto.randomInt()`.
- Administrative mutations require the existing admin session and reject a
  mismatched browser `Origin`. HTTPS responses add HSTS and secure cookies.
- `deploy/nginx-poker.conf.example` provides the HTTPS and WebSocket reverse
  proxy configuration. Certificate issuance is blocked until a domain points to
  the server.

## Compatibility

Rooms created before this release have no trusted server session associated
with their existing seats. They retain the legacy reconnect adapter until those
rooms expire; otherwise all active seats would be lost during deployment. New
rooms are marked with `identityVersion: 2` and never trust a client-supplied ID.

The production `PLAYER_SESSION_SECRET` must remain stable across restarts. A
change invalidates player sessions; room snapshots and chip balances remain
intact, but players cannot reclaim v2 seats with the old browser session.

## Verification

- Release suite: engine/restart/admin/multiplayer/effects/AFK tournament passed.
- Engine rules: 13/13.
- Multiplayer E2E: 23/23.
- Rocket authorization: 9/9.
- Tournament E2E: 14/14.
- Scheduled tournament: 12/12.
- Late registration/reconnect: 14/14.
- Tournament lifecycle: 4/4.
- MTT seating, balancing, and chip conservation: 19/19.
- Real MTT: two independent five-player tables start with one shared level.
- Stage 1 integration: ID spoofing, sanitized lobby, spectator isolation,
  multiple tabs, Sit Out, refresh, secure cookies, HSTS, admin auth, and Origin
  rejection passed.

## Measurements

Measured locally on Node.js 24, 100,000 HMAC verifications and 20,000 shuffles:

| Operation | Before | After |
| --- | ---: | ---: |
| Player identity verification | n/a | 4.38 microseconds |
| Shuffle one 52-card deck | 3.80 microseconds | 4.95 microseconds |
| Example one-player lobby payload | 121 bytes | 43 bytes |

The added shuffle cost is about 1.15 microseconds per hand and is negligible on
the target 2 vCPU / 2 GB server.

## TLS Blocker

To enable the production HTTPS redirect and WSS endpoint:

1. Point an A record for the chosen domain or subdomain to `170.168.33.82`.
2. Issue a Let's Encrypt certificate for that hostname.
3. Replace `poker.example.com` in the Nginx template and enable it.
4. Set `TRUST_PROXY=1`, a persistent `PLAYER_SESSION_SECRET`, and
   `REQUIRE_HTTPS=1` in the systemd environment.

Do not enable `REQUIRE_HTTPS=1` before Nginx has a valid certificate and HTTPS
listener, or the public HTTP endpoint will become unusable.

## Rollback

1. Revert the Stage 1 commit and redeploy the previous commit.
2. Keep `poker.db` and `public/uploads/` unchanged; this stage has no schema or
   content migration.
3. Remove `REQUIRE_HTTPS=1` if HTTPS termination is rolled back.
4. Keep the generated `PLAYER_SESSION_SECRET`; retaining it is harmless and
   avoids invalidating sessions if Stage 1 is redeployed.
