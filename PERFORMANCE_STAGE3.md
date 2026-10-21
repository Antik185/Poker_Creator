# Mobile Performance Stage 3

Date: 2026-10-21

## Result

- Monte Carlo equity and outs calculation now runs in a dedicated Web Worker.
  Stale calculations are ignored by request ID and state fingerprint.
- Seat DOM is persistent. A state update replaces only seats whose rendered
  data changed instead of rebuilding all six or nine seats.
- Reactions run in an isolated effects layer outside game-state DOM. Rocket
  effects were already isolated and remain independent from table rendering.
- Mobile rocket explosion drawing is capped at 30 FPS and creates fewer smoke
  nodes. Its timing and server synchronization are unchanged.
- GIF reactions use asynchronous decoding, isolated paint containment, and the
  existing concurrency limit of two on mobile and three on desktop.
- Client diagnostics collect load, state-update, render, and Long Task samples
  in `window.__POKER_PERF__` and publish compact latest/summary values on the
  root DOM element for remote troubleshooting.
- Legacy embedded reaction data is removed or externalized at startup. An
  invalid 3.43 MB legacy GIF no longer remains inside every parsed room config.

## Changed Files

- `public/equity-worker.js`: asynchronous equity and outs calculation.
- `public/poker.js`: Worker orchestration, stale-result protection, incremental
  seats, client metrics, isolated reactions, and adaptive mobile VFX.
- `public/poker.html`: reaction layer and cache fingerprints.
- `public/poker.css`: isolated effects paint and reaction compositing hints.
- `server/index.js`: cleanup of all legacy embedded reaction data, including
  files that exceed the current per-file limit.
- `test-client-performance.js`: Worker correctness and architecture checks.
- `test-runner.js`, `package.json`: client test integration.

## Measurements

Measured in the real local browser UI with a nine-player bot table. Mobile was
an explicit 390x844 browser viewport; it was not a physical phone or a mobile
network. Durations are milliseconds.

| Measurement | Before | After |
| --- | ---: | ---: |
| Six-player flop equity blocking the UI thread | 1082.62 | asynchronous Worker dispatch |
| Desktop render average | not instrumented | 3.02 |
| Desktop render p95 / max | not instrumented | 8.10 / 8.10 |
| Desktop stateUpdate p95 / max | not instrumented | 8.60 / 8.60 |
| Mobile render average | not instrumented | 3.09 |
| Mobile render p95 / max | not instrumented | 10.90 / 10.90 |
| Mobile stateUpdate p95 / max | not instrumented | 11.10 / 11.10 |
| Long Tasks during 15-second mobile run | unknown | 0 |
| Cold localhost load | user reported up to about 60 s | 52.9 |
| Cold transfer / decoded resources | unknown | 290,355 / 381,341 bytes |
| Largest legacy config | 4,567,299 bytes | 463 bytes |

An unchanged render patched zero seats. A normal flop action patched two of the
nine seats; the old renderer recreated all nine on every update.

## Verification

- Client Worker and rendering architecture test: passed.
- Complete release suite: passed.
- Multiplayer E2E: 23/23.
- Rocket authorization and synchronization: 9/9.
- Tournament E2E: 14/14.
- Browser desktop nine-player bot table: passed.
- Browser mobile 390x844 nine-player bot table: passed.
- No browser console warnings or errors were observed during the profile.

## Audio And Effects

- An all-in action starts music from `playerActionEffect` immediately, before
  the acting player responds.
- Mobile browsers prohibit audible autoplay before the first user gesture. A
  spectator who has not touched the page cannot receive all-in audio until a
  gesture unlocks audio; application code cannot safely bypass this policy.
- Call, check, fold, and raise cues use Web Audio and resume the context after a
  user gesture. Card/chip samples use absolute cached URLs.
- Rocket events remain server-authoritative and clock-synchronized. Visual
  effects and GIF reactions cannot capture input or rebuild game seats.

## Remaining Risks

- The viewport profile does not replace Chrome Android and Safari iOS traces on
  physical devices under constrained CPU and network conditions.
- The 3.74 MB all-in WAV and rocket image set are lazy, but their first use can
  still produce network/decode latency. Converting the WAV to a compressed
  mobile-friendly asset should be evaluated without changing its loop quality.
- Very large animated GIFs can still consume significant decoder memory even
  with concurrency limits. Server-side transcoding to animated WebP/video is a
  future deployment concern, not a safe narrow patch.
- Initial-load results are localhost measurements and must not be interpreted
  as production Internet latency.

## Rollback

1. Deploy the commit immediately before Stage 3.
2. No schema rollback is required.
3. Restoring the database backup is unnecessary: legacy reaction cleanup only
   removes invalid oversized embedded data that clients already rejected.
4. If the Worker must be disabled temporarily, revert `public/poker.js` and
   remove `public/equity-worker.js`; the retained main-thread fallback continues
   to calculate the same values.
