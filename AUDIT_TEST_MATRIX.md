# AntikPoker Audit Test Matrix

Дата: 2026-10-26  
Версия: `59c7728936ddaef9efb18863d4343c36919577ca`

Статусы: `PASS` — проверка выполнена и ожидаемый результат получен; `FAIL` — воспроизводимый дефект; `RISK` — анализ доказал опасную ветку, но production race/атака не воспроизведены; `NOT TESTED` — объективно не проверено.

## 1. Poker engine

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| Базовый lifecycle hand | PREFLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN -> next hand | Основные сценарии проходят | PASS | `test-engine.js`, `test-e2e.js` |
| Нормальный raise/call без all-in | Торговля продолжается, all-in runout/music не включаются | После fixes `9b00793` проходит | PASS | `npm test`, exact runout predicate tests |
| Победитель только после открытия river | Не завершать на закрытой последней карте | Проходит после предыдущего fix | PASS | all-in/effects/client release tests |
| Возврат вкладки с закрытой river-анимацией | Финальная карта восстанавливается face-up | Проходит после `59c7728` | PASS | client/mobile regression tests; физический iPhone не проверен |
| Две action-capable руки | Не считать состоянием all-in runout | Проходит | PASS | `test-all-in-showdown.js` |
| Короткий all-in blind против deep stack | Deep stack получает fold/call | Ход пропущен, `actingSeat=-1`, вклады 7/5 | FAIL | `test-audit-diagnostics.js` / POKER-001 |
| `check` перед существующей ставкой | Reject без мутации | Сервер списывает call 50 | FAIL | `test-audit-diagnostics.js` / POKER-002 |
| `raise NaN` | Reject без мутации | Сервер делает min raise до 40 | FAIL | `test-audit-diagnostics.js` / POKER-002 |
| Short all-in raise/reopen | Raise rights по правилам | Покрытые существующие cases проходят | PASS | `test-all-in-showdown.js`; нужен property fuzz после POKER-002 |
| Heads-up BTN/SB/BB/order | SB=button; first preflop, last postflop | Существующие vectors проходят | PASS | `test-engine.js` |
| 6-max/9-max sparse seats | Пропуск пустых/неактивных мест | Покрытые scenarios проходят | PASS | engine/tournament suites |
| Uncontested fold win | Немедленная выплата без следующих cards | Нормальный runtime проходит | PASS | engine tests |
| Uncontested fold win after restore | Немедленная выплата | Открывается TURN | FAIL | `test-audit-diagnostics.js` / RECOVERY-001 |
| Повторный `endHand()` | Один result/payout | Идемпотентность проходит | PASS | all-in/reliability tests |
| Board не более 5 cards | Инвариант сохраняется | Нарушений в suite не найдено | PASS | engine/all-in tests; random property test отсутствует |
| Уникальность physical cards | Нет дублей deck/hole/board | В покрытых deals проходит | PASS | engine vectors; exhaustive random sequence отсутствует |

## 2. Evaluator, showdown и pots

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| Все 5-card category counts | Канонические 2 598 960 counts | Полное совпадение | PASS | `test-audit-diagnostics.js` exhaustive enumeration |
| High card..Royal Flush | 10 корректных категорий | Совпали | PASS | независимые reference vectors |
| Wheel и ace-high straight | Правильный порядок | Совпал | PASS | reference vectors |
| Pair kickers | Лексикографическое сравнение | Совпало | PASS | reference vectors |
| Flush kickers | Лексикографическое сравнение | Совпало | PASS | reference vectors |
| Best five of seven | Выбирается максимум | Full house найден | PASS | reference vector |
| Board tie | Равные лучшие пять | Scores равны | PASS | reference vector |
| River changes winner | Winner пересчитывается по 7 cards | Совпало с эталоном | PASS | reference vector |
| Main/side pots, 2+ all-ins | Каждый pot имеет eligible contenders | Покрытые cases проходят | PASS | `test-all-in-showdown.js`, tournament tests |
| Uncalled excess | Возврат, не отдельный contested pot | Покрытые cases проходят | PASS | all-in tests/code review |
| Winner + refund одновременно | Оба начисления сохраняются | Покрытый scenario проходит | PASS | all-in regression suite |
| Folded player eligibility | Не может выиграть pot | Проходит | PASS | all-in tests |
| Chip conservation | До=после в покрытых hands | Проходит | PASS | engine/all-in/reliability suites |
| Split odd chip | Первый winner слева от button | Получает lowest seat index | FAIL | `test-audit-diagnostics.js` / POKER-003 |
| Random action property testing | Все invariants на множестве seeded traces | Harness отсутствует | NOT TESTED | Требуется после P1 fixes |

## 3. Timers, concurrency и reconnect

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| Duplicate commandId | Не выполнить действие дважды | Проходит | PASS | Socket.IO E2E |
| Stale turnId | Reject | Проходит | PASS | Socket.IO E2E |
| Action другого seat/socket | Reject | Проходит | PASS | identity/socket tests |
| Reconnect текущего actor | Сохранить оставшееся время | Deadline продлён ~29 s | FAIL | `test-audit-diagnostics.js` / TIMER-001 |
| Уже queued stale timer callback | Не трогать новую hand/seat | Callback читает текущий seat и folds его | RISK | искусственный callback proof; production race не наблюдался |
| Bot stale callback | Не действовать в новом state | Generation guard не доказан | RISK | code review; отдельный fake-timer test нужен |
| Room disposal | Все timers очищены | Реализация и tests проходят | PASS | reliability tests/code review |
| Two tabs same identity | State не corrupt, policy определена | Базовая reconnect semantics покрыта | PASS | socket/identity tests; UX policy ограниченно проверена |
| Wi-Fi/mobile handoff | Reconnect без duplicate action | Реальное устройство/сети отсутствуют | NOT TESTED | Нужен mobile acceptance |

## 4. MTT

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| Create/register/double registration | Корректная запись, без дубля | Проходит | PASS | `test-tournament-lifecycle.js`, MTT tests |
| Late registration | До deadline разрешено, после запрещено | 14/14 | PASS | `test-late-registration.js` |
| Scheduled start | Запуск в нужном состоянии | 12/12 | PASS | `test-scheduled-tournament.js` |
| Blind levels/clock | Hand использует зафиксированный level | Покрытые cases проходят | PASS | clock/MTT tests |
| Table balancing | Без потери/дубля stack/player | Проходит | PASS | `test-mtt-manager.js`, `test-mtt-real.js` |
| Move during active destination hand | Новый player не входит в текущую hand | Проходит | PASS | move journal/lifecycle review/tests |
| Crash PREPARED/COMMITTED move | Идемпотентное восстановление | Проходит | PASS | stage4 reliability tests |
| Empty table/final table cleanup | Корректная финализация | Проходит | PASS | tournament E2E 14/14 |
| Finished tournament restart | Не запускает новую hand | Проходит | PASS | lifecycle/restart tests |
| Equal busts same hand | Deterministic contribution ordering | Проходит согласно текущему алгоритму | PASS | code/tests; house rule нужно документировать |
| Near-simultaneous busts on different tables | Места по определённому house rule | Зависит от callback order | RISK | MTT-001; правило продукта не задано |

## 5. Persistence and operations

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| SQLite WAL/FK/busy timeout | Включены | Включены | PASS | `server/db.js` review |
| Process kill/restart | Последний acknowledged snapshot восстановлен | Version 50, chips 10000 | PASS | `node test-database-reliability.js` |
| 500 local DB writes | Измеримые latency | p95 0.064 ms, p99 0.142 ms | PASS | local microbenchmark; не production load |
| Backup create + verify | Читаемый DB + файлы | Проверка ok | PASS | `npm run backup`, `verify-backup.js` |
| Restart PREFLOP/FLOP/all-in/post-award | Без duplicate/loss | Покрытые cases проходят, кроме fold-win restore | FAIL | restart suites + RECOVERY-001 |
| Power loss / host crash | Durability SLA соблюдён | `synchronous=NORMAL`; не симулировалось | NOT TESTED | OPS-001 |
| Automated backup retention/offsite | Настроены и проверены | В repo не обнаружены | NOT TESTED | scripts есть, scheduler/runbook нет |
| Production journal | Доступен для incident review | Deploy user не имеет доступа | NOT TESTED | permission limitation |
| Actual Nginx config | TLS/WSS/cache корректны | Не прочитан из-за TLS file permissions | NOT TESTED | repo example просмотрен |

## 6. Security

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| v2 identity cookie | Подписана, HttpOnly, клиент не выбирает ID | Проходит | PASS | `test-player-identity.js`, code review |
| Legacy v1 seat identity | Нельзя занять чужой seat | Доверяет известному client playerId | FAIL | IDENTITY-001 |
| Stack/cards/winner from client | Сервер игнорирует | Проходит | PASS | server handlers/engine review |
| Hidden cards in state/API | Не передаются | Не обнаружены | PASS | sanitization + socket tests |
| Crypto shuffle | CSPRNG | `crypto.randomInt` | PASS | engine review |
| Chat/name XSS | Экранируется | Проходит | PASS | security/client tests |
| Admin auth/session | Random HttpOnly/Strict, rate-limited | Проходит | PASS | admin/security tests |
| Upload traversal/SVG/size | Reject | Проходит | PASS | fixed generated names, no SVG, 5 MB |
| Upload magic bytes/decode | Реальный формат подтверждён | Только MIME metadata | RISK | UPLOAD-001 |
| `npm audit --omit=dev` | Нет High advisories | 2 High | FAIL | body-parser 2.3.0, multer 2.4.0 |
| Global Socket flood | Ограничен | Общего limiter нет | RISK | SOCKET-001 |
| External pentest | Нет exploitable paths | Не выполнялся | NOT TESTED | Требуется отдельно |

## 7. Client/mobile/audio/effects

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| Client release regression | UI contract сохраняется | Проходит | PASS | client/mobile/audio 22/22 |
| Background river recovery | Card/winner согласованы | Автоматический recovery test проходит | PASS | commit `59c7728`; physical mobile не проверен |
| Fold/call/raise button state | Соответствует server state | Покрытые scenarios проходят | PASS | client tests; POKER-002 остаётся server issue |
| Call sound waiting loop | Не повторяется без action | Current audio tests проходят | PASS | audio regression suite |
| Custom action sounds | Check/call/fold/bet/raise/all-in | Assets подключены, tests проходят | PASS | public sounds/client tests |
| First all-in music | Быстро и стабильно | Большой lazy desktop WAV | RISK | PERF-002 |
| First rocket effect | Начинается вовремя | 4.23 MB cold assets | RISK | PERF-001 |
| 320/360/375/390/430 CSS widths | Нет overlap/clipping | Automated geometry tests проходят | PASS | mobile geometry test; real devices not tested |
| Orientation and browser background throttling | Correct on iOS/Android | Только simulated/document visibility tests | NOT TESTED | Нужны физические devices |

## 8. RU routing and performance

| Проверка | Ожидание | Факт | Статус | Доказательство / ограничение |
|---|---|---|---|---|
| Apex public health/static | 200 через Cloudflare | 200 | PASS | read-only HTTP checks |
| `www` intended Gcore route | CNAME/TLS/WSS к Gcore | Cloudflare A, 301 на apex | FAIL | DNS + HTTP / EDGE-001 |
| Country routing in app | RU получает alternate edge | Runtime env переменных нет | FAIL | `/proc/<pid>/environ` / EDGE-001 |
| RU full gameplay | HTML+JS+Socket stable | Не подтверждено; user reports intermittent white screen | NOT TESTED | Нужны probes из нескольких RU AS |
| Static caching with valid cookie | Versioned assets cache HIT | MISS -> HIT | PASS | public header probe |
| Static caching before identity cookie | Не создавать per-user bypass | Set-Cookie/BYPASS | RISK | P3 cache hygiene, не доказанная root cause |
| 10-30 simultaneous users | p95 action latency within SLA | Не измерялось | NOT TESTED | staging load test required |
| Long memory soak | RSS/timers stable | Не выполнялся | NOT TESTED | staging only |

## 9. Выполненные команды

```text
npm test                                      PASS
node test-database-reliability.js             PASS
node test-mtt-real.js                         PASS
node test-scheduled-tournament.js             12/12 PASS (isolated temp server/db)
node test-late-registration.js                14/14 PASS (isolated temp server/db)
node test-audit-diagnostics.js                evaluator PASS; 6 defects/risks reproduced
npm run backup -- <temp-dir>                  PASS
node scripts/verify-backup.js <backup-dir>    PASS
npm audit --omit=dev --json                   FAIL: 2 High advisories
```

`test-audit-diagnostics.js` является диагностическим harness и не меняет production logic.
