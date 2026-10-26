# Identity v1 to v2 migration plan

## Security decision

Legacy room identity values came from browser payloads. They cannot prove who owns a
persisted seat or tournament registration. The server must never bind a new signed
session to a legacy value supplied by a client.

The safe policy is fail-closed:

- all live requests use the signed server identity, regardless of room version;
- a signed identity may not reclaim a persisted seat stored under a different legacy ID;
- no automatic v1-to-v2 seat or registration ownership migration is permitted;
- legacy sessions whose owner cannot be verified are drained or terminated by an
  operator, not silently reassigned.

## Production procedure

1. Take and verify a database/uploads backup using the existing backup verifier.
2. Inventory rooms whose config has `identityVersion < 2`, including active hands,
   registrations, and scheduled tournaments.
3. Stop creating new v1 sessions and announce a maintenance window for any active v1
   room. Prefer allowing an active event to finish before deployment.
4. For an unfinished v1 room, choose one explicit operator action:
   - postpone deployment until the room finishes; or
   - terminate the legacy session and create a new v2 room/registration set from an
     independently verified administrative roster.
5. Deploy the server-only resolver. Do not copy a client-claimed ID into a signed
   identity and do not update persisted seat ownership from a reconnect request.
6. Verify that a victim ID supplied by another browser cannot reconnect, view private
   cards, act, react as the victim, or claim a tournament registration.
7. After the drain window, update only inactive room configuration metadata to v2 or
   archive those rooms. This data operation requires separate approval and a rollback
   checkpoint.

## Rollback

Rollback restores application code and the verified database backup together. Do not
restore the vulnerable payload-ID resolver merely to recover an unverified seat.

## Release gate

No production migration or room termination is part of this code change. Deployment
remains blocked until the v1 inventory is reviewed and the operator selects a policy
for every active legacy room.
