# AntikPoker Audit Fix Plan

Основание: аудит commit `59c7728936ddaef9efb18863d4343c36919577ca`.  
Цель: перейти из **NO-GO** в **GO WITH CONDITIONS** минимальными проверяемыми изменениями.

## Правила выполнения

1. Исправлять по одному классу риска, отдельным commit.
2. До каждой игровой правки сохранять минимальный failing regression test.
3. Не смешивать poker rules, UI, dependency upgrade и deployment в одном commit.
4. После каждого P1: targeted test, затем полный `npm test`.
5. Перед production: backup + verify, staging smoke, deploy, health, Socket reconnect, rollback command.
6. Не менять production SQLite/Nginx/CDN без backup и заранее записанного rollback.

## Phase 0 — зафиксировать baseline

| Задача | Приоритет | Сложность | Риск | Acceptance |
|---|---:|---:|---:|---|
| Добавить `test-audit-diagnostics.js` в отдельный audit test script | P1 support | S | Низкий | Тест стабильно воспроизводит текущие FAIL и evaluator PASS |
| Зафиксировать room rules: odd chip, BBA, simultaneous MTT busts | P1 support | S | Низкий | Правила записаны в README/runbook и тестовые ожидания не спорны |
| Сделать verified backup перед исправлениями | P1 support | S | Низкий | `backup` и `verify-backup` PASS |

## Phase 1 — P1 игровые блокеры

### 1. POKER-002: строгая server-side валидация действий

**Сложность:** M. **Риск изменения:** высокий, затрагивает игроков и ботов.

Минимальная реализация:

- ввести чистую функцию `getLegalActions(state, seat)` или эквивалентный единый validator;
- `check` разрешать только при `toCall === 0`;
- `call` разрешать при `toCall > 0`, включая short all-in call;
- `bet/raise` принимать только finite integer/денежную единицу и строго допустимый total;
- недопустимое действие возвращает false/error и не меняет state;
- клиентские кнопки используют тот же server contract, но сервер остаётся authority.

Обязательные regression tests:

- check facing bet rejected;
- call with zero toCall policy определена (reject либо explicit check, без скрытой мутации);
- NaN/Infinity/string/negative/fraction/too-low/too-high raise rejected;
- short all-in не reopens action для уже действовавших;
- bot не отправляет недопустимые команды;
- state/chip conservation до и после rejected command.

### 2. POKER-001: корректное завершение betting round

**Сложность:** M. **Риск:** высокий.

- заменить `playersAbleToBet < 2` единым predicate завершённой торговли;
- отдельно учитывать contender со stack > 0 и `toCall > 0` против all-in contribution;
- автоматический runout разрешать только когда ни у кого не осталось обязательного/допустимого решения.

Tests: short BB heads-up, short SB, short ante/BBA, multiway один deep + несколько all-in, каждая street, fold/call outcomes, pot conservation.

### 3. TIMER-001 + RACE-001: deadline и generation guards

**Сложность:** M. **Риск:** высокий.

- timer callback захватывает `handNum`, `turnId`, phase и expected seat;
- перед auto-action проверяет все четыре значения и room active state;
- reconnect не меняет absolute `actingDeadline`;
- restore явно устанавливает новый deadline по documented policy;
- аналогичный token добавить bot timer и delayed street/showdown callbacks.

Tests: reconnect на 29/1/0 seconds, callback после смены seat/phase/hand, clearTimeout callback already queued, dispose, tournament finish, bot/human overlap.

### 4. RECOVERY-001: terminal checks перед resume transition

**Сложность:** S-M. **Риск:** средний.

- в `resumeAfterRestore()` сначала считать live contenders;
- один contender -> идемпотентная uncontested payout;
- несколько contenders + нет возможного действия -> resume all-in runout;
- иначе восстановить actor/deadline;
- не открывать карты после fold win.

Tests: snapshots на PREFLOP/FLOP/TURN/RIVER после final fold, до/после persisted result, repeated resume, crash during scheduled callback.

### 5. POKER-003: odd chip по button order

**Сложность:** S. **Риск:** средний.

- определить cyclic seat order от первой позиции слева от button;
- применять независимо к каждому tied pot;
- не использовать абсолютную сортировку seat index.

Tests: button 0..max-1, sparse seats, heads-up, 3-way tie, несколько side pots, dead button policy.

## Phase 2 — P1 security/dependencies

### 6. IDENTITY-001: удалить legacy seat takeover

**Сложность:** M-L. **Риск:** высокий для старых сессий.

- инвентаризировать persisted rooms identity v1;
- выдать migration token/новую signed identity только доказанному текущему соединению;
- после окна миграции выставить v2 всем rooms;
- удалить fallback на client-supplied playerId;
- логировать только public/hashed identity, не secret cookie.

Tests: victim/attacker same claimed ID, stolen public ID, expired/malformed signature, two tabs legitimate owner, restart legacy migration.

### 7. DEP-001 и DEP-002: обновить HTTP parser dependencies

**Сложность:** S-M. **Риск:** средний.

- обновить Express/lockfile до body-parser >=2.4;
- обновить Multer до >=2.5;
- повторить `npm audit --omit=dev`;
- проверить request size, compressed/trailing body, aborted upload, cleanup и error responses.

Release gate: 0 High/Critical либо документированное исключение с недостижимостью и сроком.

## Phase 3 — P1 RU gameplay route

### 8. EDGE-001: один рабочий RU hostname end-to-end

**Сложность:** L. **Риск:** высокий deployment/network.

Порядок:

1. Не включать application redirect, пока alternate hostname не проходит acceptance.
2. Настроить `www` или новый `ru` CNAME именно на Gcore endpoint, а не Cloudflare.
3. Выпустить/проверить TLS certificate; настроить origin Host/SNI.
4. Проверить обычный HTTP, immutable static, `/socket.io/` polling и WebSocket upgrade.
5. Проверить cookies, admin auth, CORS/SameSite, reconnect и room isolation на этом hostname.
6. Только после этого включить RU routing; исключить redirect между edge и apex.
7. Проверить минимум из трёх российских AS/операторов, с VPN-off, 20 cold loads и 30-минутной игрой.

Acceptance:

- 20/20 cold page loads без white screen/NetworkError;
- JS/CSS/sounds 2xx и корректный cache;
- WebSocket остаётся connected, действия ack без duplicate;
- p95 action RTT определён и приемлем владельцем;
- admin login и gameplay работают;
- non-RU остаётся на текущем быстром Cloudflare path.

Rollback: выключить country redirect и вернуть DNS hostname к предыдущей записи; не менять apex одновременно с первым edge rollout.

## Phase 4 — P2 reliability/performance

| Задача | Сложность | Риск | Обязательная проверка |
|---|---:|---:|---|
| PERF-001 оптимизировать/preload rocket assets | M | Средний | Slow 3G emulation + real mobile; memory snapshot |
| PERF-002 уменьшить/preload all-in audio | M | Средний | Chrome/Firefox/Safari audio unlock, repeated all-ins, background/foreground |
| SOCKET-001 общий token bucket/connection caps | M | Средний | Legit reconnect storm не блокируется, flood ограничен |
| UPLOAD-001 magic-byte validation/re-encode | M | Средний | valid PNG/JPEG/GIF + polyglot/bomb/abort |
| OPS-001 выбрать SQLite NORMAL/FULL по SLA | M | Высокий perf | Staging action/DB p50/p95/p99 и power-loss model |
| MTT-001 определить simultaneous bust rule | M-L | Высокий | Два стола, фиксированные timestamps/stacks, deterministic places |
| Deep health/metrics | M | Низкий | DB writable, event-loop lag, RSS, sockets, snapshot failures |
| Staging load/soak 10-30 users | L | Низкий prod | p50/p95/p99, CPU/RAM/event-loop, 1000+ hands, no timer/listener growth |

## Phase 5 — P3 hardening и сопровождение

- убрать `X-Powered-By`, постепенно отказаться от CSP `unsafe-inline` через nonce/hash;
- не создавать identity cookie на immutable static routes;
- удалить или явно архивировать root/public-app дубли;
- включить все standalone tests в CI/release runner;
- добавить lint/static checks и `npm audit` gate;
- документировать systemd/env/Nginx/Cloudflare/Gcore и rollback;
- настроить backup scheduler, retention, offsite copy и регулярный restore drill;
- добавить конечный MemoryMax после измерения normal RSS;
- расширить `/healthz` или добавить закрытый `/readyz`.

## Финальные release gates

Переход из **NO-GO** возможен только если одновременно выполнено:

1. Все P1 исправлены отдельными regression tests.
2. `npm test` и все standalone suites проходят.
3. `test-audit-diagnostics.js` больше не показывает confirmed failures; expected assertions обновлены только по утверждённым правилам, не для сокрытия дефекта.
4. `npm audit --omit=dev` не показывает High/Critical без согласованного исключения.
5. Verified backup и staging restore завершены.
6. RU acceptance подтверждает загрузку, Socket gameplay, reconnect и admin, а не только landing page.
7. Минимальный staging load test 30 users не показывает duplicate payout, chip drift, timer/listener growth или неприемлемый p95.
8. Есть rollback для application, database snapshot и edge routing.

После gates допустим статус **GO WITH CONDITIONS** с мониторингом error rate, reconnect rate, action RTT, event loop lag, RSS, DB errors и payout invariants. Статус **GO** разумно рассматривать только после ограниченного canary-периода и закрытия операционных P2.
