# MTT and Mobile Bugfix Report

Date: 2026-10-22

## Scope

This release keeps the existing poker hand evaluator and betting engine intact. It changes MTT table movement and terminal states, mobile table geometry, reaction/effect anchoring, mobile audio recovery, and observer UX.

## Stage 1: MTT Reliability

### Root causes

- Ordinary balancing waited for both source and target tables to become idle. A long hand at the target table therefore delayed a late registrant or moved player for multiple hands.
- Tournament completion did not have a complete terminal state. The level clock and table lifecycle could remain active after a winner was known.
- Eliminated clients could retain pending-seat messaging intended for active players.

### Changes

- Ordinary balancing now waits only for the source hand to finish. The target table continues its current hand without being paused.
- A player moved into a running target table is present as a spectator and enters on the next hand. No player is inserted into a hand already in progress.
- Final-table consolidation still waits for every affected table because all source tables must be closed atomically.
- Added the terminal `FINISHED` table/tournament state, persisted winner status/place, stopped level clock, and prevented new hands after completion.
- Normalized active-player checks to the `ACTIVE` registration status.
- Removed pending-next-hand notices for eliminated spectators.

### Result

- The balancing transaction itself is synchronous; measured prepare/commit execution in the unit scenario is below 1 ms. User-visible waiting is bounded by completion of the source hand, not the target hand.
- The target table is never paused for ordinary balancing.
- A moved player cannot act until the next target-table hand.
- Finished tournaments have no active level timer or newly started table hand.

## Stage 2: Mobile Geometry

### Root causes

- The portrait table occupied the full available width, leaving no safe inset on narrow devices.
- The hero blind/bet chip used a fixed position that could overlap hole cards after responsive scaling.
- Reactions and the winner crown were positioned relative to replaceable seat markup rather than the rendered avatar rectangle.
- Chat used a sub-16 px input font, which triggers focus zoom in iOS Safari.

### Changes

- Added a 4% portrait scale inset while retaining responsive sizing from the real viewport.
- Moved the hero bet chip outside the hole-card area.
- Reactions and the crown now anchor to `getBoundingClientRect()` of the current avatar and resynchronize after resize, orientation, visual viewport, and layout changes.
- Mobile chat input is 16 px.

### Measurements

- In-app mobile viewport: 390 px wide.
- Rendered table width: approximately 368.6 px.
- Horizontal safe gap: approximately 10.7 px on each side.
- Vertical gap: approximately 14.4 px.
- Six-seat and nine-seat layouts were visually inspected in the in-app browser; all avatar anchors remained inside the viewport.

Physical iOS Safari and Android Chrome were not available in the automated environment. Keyboard, safe-area, and audio-policy behavior still require a final check on real phones.

## Stage 3: Reactions, GIFs, and Audio

### Root causes

- One bot-reaction branch treated only `data:` URLs as images. Persisted `/uploads/reactions/...` GIF URLs were rendered as oversized text.
- Audio objects were created cold for every event and the client did not consistently recover a suspended/interrupted mobile audio context.
- Muting all-in music discarded the intent to resume it after unmuting.

### Changes

- Added a shared image-reaction detector for uploaded URLs and data URLs.
- The server accepts only reactions configured for the room, preventing arbitrary reaction payload injection.
- Added sample preloading after a user gesture, reusable cloned audio templates, active-sound lifecycle tracking, and suspended AudioContext recovery.
- All-in music preserves its requested state while muted and resumes after audio is unlocked again.
- Broken GIF assets fail closed without rendering replacement text.

## Stage 4: Lobby and Observer UX

- MTT room payloads now carry the lobby code so leaving a table returns to the correct tournament lobby.
- Eliminated-player and game-over overlays use the same exit route.
- A persisted `WINNER` registration reconstructs the victory screen after refresh without reclaiming a seat.
- Chat names and tournament places come from authoritative server registrations.
- Spectators can toggle all stacks and the pot between currency and big blinds.
- Finished tournament lobbies sort and display final places.

## Verification

The full release suite passed:

- Engine: 13/13.
- Scheduled tournament lifecycle: 5/5.
- Security and signed identity: passed.
- Restart restoration: passed.
- MTT manager and reliability: passed.
- Mobile geometry: 7/7.
- Audio and reactions: 8/8.
- Lobby and observer UX: 8/8.
- Multiplayer e2e: 23/23.
- Rocket effect: 9/9.
- Tournament e2e: 14/14.

## Remaining Risks

- GIF decoding cost depends on the uploaded asset dimensions and frame rate. The existing per-file size limit does not guarantee a cheap decode path on old phones.
- Real-device browser policies can differ from desktop emulation, especially iOS audio unlock, virtual keyboard resizing, and safe-area handling.
- Multi-process deployment still requires shared Socket.IO transport/state before the Node service can be horizontally scaled beyond one process.

## Rollback

- MTT reliability and terminal-state changes: revert commit `1f535f8`.
- Mobile, effects, audio, and observer changes: revert the subsequent release commit containing this report.
- Database migrations were not added in this batch, so rollback does not require schema restoration.
