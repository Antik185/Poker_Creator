# Mobile Audio and MTT Final Fix Report

Date: 2026-10-24

## 1. Mobile audio

### Cause

- Poker actions were voiced through `speechSynthesis`, so the voice, timing and availability depended on the browser and operating system.
- Short game sounds, rocket sounds and all-in music used separate audio objects and separate lifecycle logic.
- The previous unlock probe was muted. A successful muted `play()` does not reliably unlock later audible playback in iOS Safari.
- Rejected `HTMLMediaElement.play()` promises only changed an internal flag; the player did not get a usable recovery control.
- Mute and master volume were not persisted.

### Fix

- Added one client-side `GameAudioManager` for cached media, Web Audio beeps, effects, all-in music, mute, volume, background/foreground recovery and playback errors.
- Replaced browser TTS with canonical PCM WAV files for Fold, Check, Call, Bet, Raise and All-in.
- Audio unlock now runs inside an actual pointer/click gesture with an audible-media probe.
- When browser policy still blocks playback, the table shows `Нажмите, чтобы включить звуки игры`.
- The sound icon distinguishes muted, ready and locked states.
- Mute and volume are stored in `localStorage` and survive navigation or an MTT table move.
- Rocket/effect sounds now use the same manager instead of creating an independent player.

Files: `public/poker.js`, `public/poker.html`, `public/poker.css`, `public/sounds/action-*.wav`.

## 2. Finished MTT routing and persistence

### Cause

- The final overlay always linked to `/`.
- The tournament lobby deliberately exposed `Посмотреть итоговый стол` after `FINISHED`.
- After the live tournament manager was removed or the process restarted, the lobby did not use the persisted `tournament_states` FINISHED snapshot.
- A stale secondary-table URL could fall through room creation instead of resolving to the tournament root.

### Fix

- Elimination, winner and terminal-table screens route to `/lobby/<lobbyCode>` and use the code supplied by the server.
- Finished lobbies retain results but expose no table/spectate controls.
- Lobby state uses the persisted FINISHED snapshot, persisted finish time and the registration marked `WINNER` after restart.
- FINISHED payloads return zero active tables and no table list.
- `joinRoom` resolves `--table-N` URLs to the tournament root and returns `tournament_table_finished` without creating a `PokerRoom`.
- Connected clients removed by the two-minute table cleanup are sent back to the same tournament lobby.

Files: `server/index.js`, `public/poker.js`, `public/lobby.html`.

## 3. Mobile layout and lobby design

- Portrait action panel width changed from `min(205px, 49vw)` to `min(192px, 46vw)`; padding and compact bet controls were reduced without changing desktop styles.
- Main action buttons remain 42 px high (the existing touch target size) instead of being reduced further.
- The complete hero seat is moved up 10 px, so cards, badges, reactions, crown and hand label stay aligned.
- Tournament participant scrollbar is scoped to `.registered-list` and uses a dark track with a muted gold thumb in Chromium/WebKit and Firefox.

Files: `public/poker.css`, `public/lobby.html`.

## 4. Automated verification

- `node --check public/poker.js` — passed.
- `node --check server/index.js` — passed.
- Audio/reaction checks — 13/13 passed.
- Mobile geometry checks — 12/12 passed.
- Tournament release controls — passed.
- Lobby/observer checks — 8/8 passed.
- Full `npm test` release suite — passed.
- Main multiplayer E2E — 23/23 passed.
- Rocket multiplayer E2E — 9/9 passed.
- Tournament E2E — 14/14 passed.
- `git diff --check` — passed (only repository CRLF conversion warnings).

The full suite also covered engine rules, ante/clock logic, signed identity, restart recovery, security, MTT balancing/final state, bots, reconnect, spectators and card privacy.

## 5. Browser/device coverage

No physical iPhone, Android device, Safari or Firefox instance was available in this environment. The implementation and automated checks verify the browser-policy paths, state restoration and responsive CSS, but they do not prove speaker output or visual fit on a physical device.

Required release smoke test on real hardware:

1. iOS Safari: first tap unlock, Call/Raise/Fold/All-in, mute/unmute, background/foreground.
2. Android Chrome: the same sequence.
3. MTT move between tables while all-in music/effects are idle and while sound is enabled.
4. Portrait widths 320, 360, 375, 390 and 430 CSS px, plus landscape.

## 6. Known limitations and rollback

- Mobile browsers can revoke audio permission after OS-level interruption. The manager recovers automatically when allowed and otherwise displays the explicit unlock button; browser policy cannot be bypassed.
- The six canonical voice files were generated locally from a system voice. Confirm redistribution rights for that voice before a commercial public release, or replace the files with licensed recordings while keeping the same filenames.
- Exact perceived loudness still varies by device speaker and OS processing even though every browser now receives the same source files.

Rollback is file-local: revert the files listed above and remove `public/sounds/action-*.wav`. No database schema or poker rule changes were made.
