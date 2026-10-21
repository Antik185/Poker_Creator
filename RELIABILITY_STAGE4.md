# Stage 4: MTT Reliability

## Scope

This stage adds crash-safe tournament table moves and stale-command protection without changing hand evaluation or betting rules.

## Changes

- Every browser action carries a cryptographically random `commandId` and the server-issued `turnId`.
- Socket actions with a missing, duplicate, or stale command identity are rejected before game state changes.
- Internal bot and offline actions keep using the direct engine API.
- Tournament moves use a durable SQLite journal with `PREPARED`, `COMMITTED`, `ROLLED_BACK`, and `RECOVERED_PENDING` states.
- Preparing a move records source, destination, seat, stack, and whether `move_count` must increase.
- Committing a move updates the registration and journal atomically and is idempotent.
- Startup recovery reconciles the journal with persisted table snapshots:
  - player at target: commit the move;
  - player at source: roll back the move;
  - player absent from both: retain the stack as pending for reseating;
  - player on both tables: keep the target and remove the duplicate.

## Verification

- `node test-stage4-reliability.js`
  - successful persistent move;
  - crash before source export;
  - crash after source export;
  - crash after target import;
  - duplicate seat recovery;
  - replayed commit increments `move_count` once;
  - duplicate and stale action commands change no game state.
- `npm run test:tournament`: all engine, lifecycle, MTT balancing, real multi-table, and recovery tests passed.
- `npm test`: full release suite passed, including multiplayer `23/23`, rocket `9/9`, and tournament `14/14`.
- `test-scheduled-tournament.js`: `12/12` passed.
- `test-late-registration.js`: `14/14` passed.

## Measurements

On the local WAL/NORMAL test database:

- move journal prepare average: about `0.17 ms`;
- atomic registration commit average: about `0.16 ms`;
- chip total before/after every tested migration: unchanged;
- duplicate seats after recovery: `0`;
- duplicated `move_count` increments after replay: `0`.

Before this stage, a process exit between source export, target import, and registration update had no durable recovery record. After this stage, all tested interruption points produce one seat or a pending player with the original stack.

## Remaining Risks

- SQLite `synchronous=NORMAL` protects process crashes through WAL, but a host power loss can still lose the newest WAL frames. Stage 2 backups remain required.
- Recovery assumes table snapshots represent a between-hands migration, which is enforced by the tournament manager. Manual database edits can violate that invariant.
- HTTPS/WSS still requires a domain pointed at the server before a public certificate can be issued.

## Rollback

1. Stop the service.
2. Revert the Stage 4 commit and reinstall/restart the application.
3. The additive `tournament_moves` table can remain; older code ignores it.
4. If data rollback is required, restore the pre-deploy SQLite backup and its WAL/SHM files using the Stage 2 restore procedure.
