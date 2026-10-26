# AntikPoker Remaining Issues

Дата повторной оценки: 2026-10-26

Ниже перечислены только нерешённые либо частично сниженные риски. Подтверждённых P0/P1 в локально проверенном игровом коде нет.

## P2

### EDGE-001 — RU маршрут не принят end-to-end

- **Текущий статус:** приложение умеет country routing, one-time identity handoff и защиту от redirect loop; автоматические локальные tests проходят. Фактические DNS/Gcore/TLS/WSS настройки и доступность из нескольких RU AS в этой работе не изменялись и не подтверждены.
- **Что может произойти:** белый экран, `NetworkError`, загрузка HTML без JS, polling без upgrade, потеря reconnect или недоступная админка/игра.
- **Вероятность:** неизвестна; пользователь ранее наблюдал нестабильность, поэтому считать низкой нельзя.
- **Опасность исправления:** высокая, поскольку ошибочный DNS/redirect может отключить всех RU-пользователей.
- **Production-инфраструктура:** да. Выполнить `RU_EDGE_VALIDATION_PLAN.md` до переключения трафика.

### LOAD-001 / SOCKET-001 — нет production-like flood/load profile

- **Текущий статус:** payload ограничен 5 МБ; chat/reaction/rocket/action имеют локальные guards/cooldowns; общего per-IP/per-identity token bucket и connection cap нет.
- **Что может произойти:** reconnect storm либо злонамеренный event flood создаст CPU/RAM/DB pressure; слишком жёсткий limiter, наоборот, заблокирует мобильные reconnect.
- **Вероятность:** средняя после публичного запуска, ниже в закрытом турнире.
- **Опасность исправления:** средняя; параметры без измерений легко ломают легитимных игроков за NAT.
- **Production-инфраструктура:** для корректной настройки нужны staging load и метрики. Сначала 10-30 клиентов, затем отдельный limiter commit с тестом burst/reconnect.

### OPS-001 — SQLite durability SLA не выбран

- **Текущий статус:** WAL, foreign keys, `busy_timeout=5000`, synchronous persistence и process-kill restore проходят. Default остаётся `SQLITE_SYNCHRONOUS=NORMAL`.
- **Что может произойти:** при power/host failure могут потеряться последние transactions; process crash в тесте восстановился корректно.
- **Вероятность:** низкая, но ущерб для активного турнира высокий.
- **Опасность исправления:** средняя/высокая для latency из-за дополнительных fsync.
- **Production-инфраструктура:** да. Не менять на `FULL` без staging p50/p95/p99, power-loss model и согласованного SLA.

### MTT-001 — simultaneous busts на разных столах

- **Текущий статус:** одинаковые вылеты внутри одной hand упорядочены детерминированно; между столами place зависит от порядка callback.
- **Что может произойти:** два почти одновременных вылета получат порядок по scheduler timing, а не по stack-at-hand-start или единому barrier.
- **Вероятность:** низкая/средняя в большом MTT; влияние на призовые потенциально высокое.
- **Опасность исправления:** высокая, потому что это изменение house rule и persistence protocol.
- **Production-инфраструктура:** нет, но требуется решение продукта. После утверждения правила нужны cross-table barrier/timestamp tests и миграционно совместимый state.

### UPLOAD-001 — decode/re-encode не выполняется

- **Текущий статус:** MIME spoofing закрыт magic-byte validation, SVG запрещён, имя генерируется сервером, размер ограничен 5 МБ, `nosniff` включён. Полный безопасный decode/re-encode и dimension cap отсутствуют.
- **Что может произойти:** сложный polyglot или decoder bomb с корректной сигнатурой попадёт через admin-only upload.
- **Вероятность:** низкая при защищённой admin-сессии.
- **Опасность исправления:** средняя: image library добавит native dependency и может изменить GIF/alpha/quality.
- **Production-инфраструктура:** нет. Перед реализацией выбрать поддерживаемый decoder и проверить PNG/JPEG/GIF/WebP, animation, EXIF, pixel limit и malformed corpus.

## P3 и остаточные ограничения

### PERF-001 — rocket transfer остаётся большим

Cold-event задержка снижена фоновым low-priority preload после посадки, но используемые слои всё ещё весят около 4,33 МБ. Следующий шаг: подготовить визуально идентичные WebP/AVIF/уменьшенные PNG variants, проверить старые Safari и измерить decoded memory на телефонах.

### PERF-002 — неиспользуемый большой WAV остаётся в репозитории

Клиент использует только `allin_user_loop_mobile.wav` размером 623 КБ. Старый `allin_user_loop_fixed.wav` 3,7 МБ больше не загружается, но его удаление/архивацию лучше выполнить отдельно после проверки внешних ссылок и deployment cleanup.

### Mobile/browser acceptance

Автоматические geometry, visibility recovery и audio state tests проходят, но нужны физические Chrome Android, Safari iOS и Firefox Android: первое открытие, audio unlock, повторные all-ins, rocket, background на River, reconnect при смене Wi-Fi/LTE и поворот экрана.

### Operations

- Настроить backup scheduler, retention, offsite copy и регулярный restore drill.
- Добавить readiness с DB writable, event-loop lag, RSS, sockets и snapshot errors.
- Убрать `X-Powered-By`, постепенно заменить CSP `unsafe-inline` на nonce/hash.
- Не создавать identity cookie для immutable static resources.
- Добавить CI gate для `npm test` и `npm audit --omit=dev`.
- Провести внешний pentest до широкого публичного запуска.

## Условия пересмотра NO-GO

1. RU plan проходит для landing, lobby, table, admin, API, Socket.IO gameplay и reconnect минимум из трёх сетей/AS.
2. Staging load 10-30 клиентов показывает приемлемые p95/p99, без chip drift, duplicate payout, timer/listener growth и неконтролируемого RSS.
3. Документированы application/DB/edge rollback и проверен restore.
4. Утверждены SQLite durability SLA и MTT simultaneous-bust rule либо явно приняты как launch exceptions.
