# Database Stage 2

Date: 2026-10-21

## Result

- SQLite now runs in WAL mode with a 5-second busy timeout and foreign keys.
- The default durability mode is `synchronous=NORMAL`. Set
  `SQLITE_SYNCHRONOUS=FULL` when protection against host power loss is more
  important than write latency.
- Room and tournament snapshots use prepared statements and expose aggregate
  write latency metrics for diagnostics.
- A game snapshot is committed before its corresponding `stateUpdate` is sent.
  The previous 120 ms deferred-save crash window has been removed.
- Graceful shutdown checkpoints WAL and closes the database.
- Runtime backup and verification scripts cover the SQLite database, uploads,
  checksums, database integrity, and JSON snapshot readability.

## Changed Files

- `server/db.js`: WAL configuration, prepared writes, metrics, online backup,
  checkpoint, configurable test database, and clean close.
- `server/gameEngine.js`: synchronous snapshot persistence before broadcast.
- `server/index.js`: database checkpoint and close during graceful shutdown.
- `scripts/backup-runtime.js`: consistent online database and upload backup.
- `scripts/verify-backup.js`: checksum, integrity, upload, and snapshot checks.
- `test-database-reliability.js`: crash recovery, chip conservation, and write
  latency coverage.
- `package.json`: database test and backup commands.
- `.gitignore`: runtime backups are excluded from Git.

## Backup And Restore Verification

The pre-change backup contains:

- SQLite database: 56,340,480 bytes.
- Rooms: 200.
- Room snapshots: 151.
- Tournament registrations: 29.
- Tournament snapshots: 18.
- Tournament table snapshots: 18.
- Uploads: 44 files.

The restored database returned `PRAGMA integrity_check = ok`. All 187 stored
snapshots parsed as JSON, and all restored upload SHA-256 hashes matched the
source files.

## Measurements

Measured locally on Node.js 24. Values are milliseconds.

| Operation | Before p50 | Before p95 | Before p99 | After p50 | After p95 | After p99 | After max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Snapshot write | 80.98 | 114.02 | 139.88 | 0.022 | 0.062 | 0.121 | 0.593 |
| Game command with persistence | n/a | 172.88 | 248.55 | 0.034 | 0.089 | 0.325 | 5.438 |

The reliability process was killed with `SIGKILL` after acknowledging snapshot
version 50. Reopening the database restored version 50, returned an intact
database, preserved exactly 10,000 tournament chips, and retained both player
registrations and table references.

## Verification

- Database reliability and `SIGKILL` recovery: passed.
- Complete release suite: passed.
- Engine, ante, and tournament clock: 13/13.
- Tournament lifecycle: 4/4.
- MTT seating, balancing, and chip conservation: 19/19.
- Real multi-table tournament shared-level test: passed.
- Scheduled tournament server E2E: 12/12.
- Late registration and reconnect server E2E: 14/14.
- Generated runtime backup verification: 44 uploads and 187 snapshots passed.

## Remaining Risks

- `synchronous=NORMAL` protects database consistency and committed data from a
  Node process crash. A sudden operating-system or host power failure may lose
  the newest committed WAL frames. Use `SQLITE_SYNCHRONOUS=FULL` for strict
  power-loss durability and remeasure production latency.
- WAL supports concurrent readers but this application must still run as one
  Node writer process. Horizontal scaling requires a shared transactional data
  store and distributed room ownership.
- A WAL checkpoint can cause occasional tail latency. Production Linux metrics
  must be monitored after deployment.
- A table move still spans multiple persisted records. Crash-safe,
  idempotent MTT migration is intentionally handled in Stage 4.

## Rollback

1. Stop the application before replacing database files.
2. Deploy the commit immediately before Stage 2.
3. Restore `poker.db` and `public/uploads/` from the verified backup.
4. Remove stale `poker.db-wal` and `poker.db-shm` only while the service is
   stopped and only when restoring the matching main database backup.
5. Start the service and run `PRAGMA integrity_check`, then verify room and
   tournament snapshot counts before accepting traffic.
