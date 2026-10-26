# AntikPoker Stabilization Report

Дата: 2026-10-26

База аудита: `59c7728936ddaef9efb18863d4343c36919577ca`

Базовый commit отчётов: `78d268f`

Последний commit исправлений: `0c2acab`

## Итог

Все подтверждённые P1-дефекты игрового кода из исходного аудита исправлены и закрыты воспроизводимыми регрессионными тестами. В проверенных сценариях не найдено пропажи или дублирования фишек, преждевременного Showdown, повторной выплаты либо воздействия устаревшего таймера на новый ход.

Production, DNS, Cloudflare/Gcore, Nginx и режим SQLite не изменялись. Для неограниченного публичного запуска итоговый статус остаётся **NO-GO**, пока не пройдены реальные RU HTTP/WSS acceptance-проверки и staging-нагрузка 10-30 одновременных игроков. Для ограниченного закрытого canary кодовая база существенно стабильнее, но это не заменяет указанные release gates.

## Резервная копия

Перед работами проверена копия:

`C:\Users\Antik\AppData\Local\Temp\antikpoker-stabilization-backups\2026-10-25T23-01-40-282Z`

Результат проверки: `ok=true`, 50 uploads, 333 snapshots, 46 registrations. Миграции production-данных не выполнялись.

## Исправленные проблемы

| ID | Причина | Исправление | Commit |
|---|---|---|---|
| POKER-002 | Сервер нормализовал недопустимые действия: Check мог стать Call, `raise NaN` становился min-raise | Строгая валидация Fold/Check/Call/Bet/Raise до мутации; `actionRejected`; клиент не превращает Raise в Call | `942ae2a` |
| POKER-001 | Завершение торговли учитывало только количество способных ставить игроков и пропускало обязательное решение против короткого all-in blind | Отдельная проверка незакрытого `toCall`; SB 5 против BB all-in 7 получает Fold/Call 2 | `569bb92` |
| TIMER-001/RACE-001 | Reconnect продлевал ход, а callback ориентировался на текущее, а не захваченное состояние | Сохраняется абсолютный deadline; callbacks проверяют room, hand, phase, turnId, seat и player | `02f13ee` |
| RECOVERY-001 | Восстановленная fold-win hand могла открыть лишнюю улицу | Один оставшийся contender немедленно завершает hand; all-in runout нескольких игроков сохранён | `900a72f` |
| POKER-003 | Odd chip назначался по абсолютному seat index | Победители упорядочиваются по часовой стрелке слева от Button для каждого банка | `c6f015b` |
| IDENTITY-001 | Legacy v1 доверял известному client `playerId` | Seat identity всегда берётся из подписанной серверной сессии; подготовлен план безопасного прекращения v1 | `f21ded4` |
| DEP-001/DEP-002 | Уязвимые transitive `body-parser` и `multer` | Обновлены совместимые зависимости; проверены upload, limits, abort и HTTP middleware | `ff5bb17` |
| Audit harness | Часть диагностики сообщала факт, но не падала при регрессии | Реальные assertions, non-zero exit, exhaustive evaluator и включение в `npm test` | `d849384` |
| Long-run coverage | Не было воспроизводимого длительного invariant-теста | 1000 seeded hands для 2/3/6/9 игроков, 25 770 действий, chips/timers/memory checks | `b105036` |
| UPLOAD-001 | Upload доверял multipart MIME metadata | Проверка magic bytes PNG/JPEG/GIF/WebP до создания комнаты; mismatch даёт 400 и удаляется | `90d833d` |
| PERF-001 | 4,33 МБ rocket-слоёв грузились только после первого события | Low-priority idle preload только после фактической посадки за стол | `91aa35d` |
| PERF-002 | Desktop all-in loop требовал cold download 3,7 МБ | Все браузеры используют совместимый PCM WAV 623 КБ той же длительности | `0c2acab` |

## Уже исправленное до этой серии

Повторно подтверждены ранее внесённые исправления: normal raise/call не запускает all-in runout, победитель ждёт открытия River, foreground recovery заменяет закрытую финальную карту, uncalled excess возвращается отдельно от выигрыша, игрок может одновременно получить refund и award, а refund без выигрыша не создаёт winner crown.

## Изменённые области

- Движок и таймеры: `server/gameEngine.js`.
- Identity: `server/playerIdentity.js`, `IDENTITY_V1_MIGRATION_PLAN.md`.
- HTTP/upload/Socket responses: `server/index.js`.
- Клиентские controls/audio/effects: `public/poker.js`.
- Dependencies: `package.json`, `package-lock.json`.
- Regression/release tests: `test-audit-diagnostics.js`, `test-game-soak.js`, `test-admin-auth.js`, `test-player-identity.js`, `test-audio-reactions.js`, `test-runner.js` и связанные E2E/reliability tests.

Пользовательская папка `ukrainian_avatars_12.10-18.10_over10/` не изменялась и не включалась в commits.

## Проверки

| Проверка | Результат |
|---|---|
| `npm test` после каждого логического этапа | PASS; финальный полный release suite PASS |
| `npm run test:tournament` | PASS: engine, side pots, lifecycle, multi-table MTT, recovery |
| Scheduled tournament | 12/12 PASS в изолированной temp DB |
| Late registration | 15/15 PASS в изолированной temp DB |
| `npm run test:database` | PASS: SIGKILL restore version 50, 10 000 chips; 500 writes, p95 0,0614 ms, p99 0,1398 ms |
| `npm run test:security` | PASS: signed identity, cookies, same-origin admin, seat hijack/reconnect |
| `npm run test:audit` | PASS: 2 598 960 evaluator hands и все исправленные audit regressions |
| `npm run test:soak` | PASS: seed `1103547991`, 1000 hands, 25 770 actions, heap growth 2 784 560 bytes |
| `node test-mobile-geometry.js` | 12/12 PASS |
| `node test-audio-reactions.js` | 23/23 PASS |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Backup verification | PASS |

## Игровые инварианты

- Сумма `stacks + pot` проверяется после каждого действия в soak-тесте и сохраняется.
- Stack, bet и pot не становятся отрицательными.
- Каждая hand создаёт ровно одно событие победителя.
- Повторный `endHand` не даёт повторную выплату.
- Main/side pots, uncalled refund, ties и odd chips проверены отдельными vectors.
- PREFLOP/FLOP/TURN/RIVER restore и all-in runout проверены.
- Reconnect не обновляет deadline и не даёт дополнительного времени.
- Старые timer/bot callbacks не действуют после смены hand/turn/player.

## Объективно не выполнено

- Реальный HTTP/HTTPS/WSS/Socket.IO прогон из нескольких российских AS и мобильных операторов.
- Физические iOS/Android проверки background/foreground, orientation и autoplay.
- Staging load 10-30 реальных Socket.IO-клиентов с p95/p99 action RTT, reconnect storm, RSS и event-loop lag.
- Power-loss/host-loss тест SQLite; проверен process `SIGKILL`, но не потеря питания.
- Внешний pentest.
- Production restore drill, backup retention/offsite scheduler и rollout/rollback exercise.

## P0/P1 и новые ошибки

Подтверждённых оставшихся P0/P1 в проверенном игровом коде нет. Новых функциональных дефектов в автоматических прогонах не найдено. Operational launch blocker остаётся: реальный RU edge и WSS gameplay не подтверждены из этой среды. Остаточные P2/P3 перечислены в `ANTIKPOKER_REMAINING_ISSUES.md`.

## Вердикт

**NO-GO для неограниченного публичного запуска.** Причина не в известном P1 игрового движка, а в невыполненных внешних release gates: RU end-to-end gameplay и staging load. После успешного выполнения `RU_EDGE_VALIDATION_PLAN.md`, нагрузки 10-30 клиентов и проверяемого rollback статус можно пересмотреть до **GO WITH CONDITIONS** для canary. Полный **GO** разумен только после canary-периода с мониторингом action RTT, reconnect rate, event-loop lag, RSS, DB errors и payout invariants.
