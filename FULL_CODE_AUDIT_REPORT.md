# Полный технический аудит AntikPoker

Дата аудита: 2026-10-26  
Аудируемый commit: `59c7728936ddaef9efb18863d4343c36919577ca`  
Статус: **NO-GO для публичного запуска до устранения P1**

## 1. Резюме для владельца

Проект уже имеет существенно более сильную основу, чем типичный прототип: сервер является источником истины, карты перемешиваются криптографическим генератором, закрытые карты фильтруются перед отправкой, команды привязаны к сокету и `turnId`, snapshots пишутся синхронно до рассылки, а MTT-пересадки имеют журналируемые стадии. Полный существующий test suite проходит. Проверка evaluator по всем 2 598 960 пятикарточным наборам и отдельным эталонным showdown-сценариям также прошла.

Тем не менее текущая версия **не готова к публичному запуску**. Диагностические сценарии подтвердили серьёзные ошибки в редких игровых состояниях:

- решение игрока пропускается, если второй участник раздачи поставил неполный all-in блайнд;
- сервер принимает `check` перед ставкой как `call`, а некорректный `raise` может превратить в минимальный raise;
- reconnect заново выдаёт полный таймер;
- после рестарта выигранная фолдами раздача может открыть следующую улицу;
- нечётная фишка при split pot выдаётся по номеру места, а не первому победителю слева от button;
- callback таймера не защищён поколением/ходом и потенциально способен примениться к следующему игроку;
- legacy-комнаты с identity v1 допускают восстановление места по известному клиентскому `playerId`;
- две установленные зависимости имеют опубликованные High severity DoS advisory;
- intended RU edge в production фактически не активен: `www` перенаправляется обратно на apex Cloudflare, а процесс не имеет переменных альтернативного edge. Надёжная игра из РФ не доказана.

Недавние исправления ложного all-in между улицами и восстановления закрытой river после возврата вкладки присутствуют в аудируемом commit и прошли регрессионные тесты.

## 2. Объём и ограничения

Проверены собственные серверные, клиентские, SQLite, MTT, backup, security и deployment-модули; сторонний `node_modules` проверен по версиям и `npm audit`, но не читался построчно. Выполнены unit, integration, Socket.IO E2E, tournament E2E, persistence, backup и дополнительные диагностические тесты.

Безопасные read-only проверки production выполнялись без нагрузочного воздействия и без изменения данных. Не выполнялись:

- физические тесты на iPhone/Android и реальное переключение Wi-Fi/mobile;
- полный тест 10-30 одновременных пользователей с p50/p95/p99, CPU и RAM;
- exhaustive crash injection в каждой инструкции между SQLite commit и broadcast;
- чтение production journal и фактического Nginx-конфига: у пользователя deploy недостаточно прав;
- проверка российских операторов из нескольких AS/регионов;
- внешний penetration test и длительный memory soak.

## 3. Карта архитектуры

```text
Browser
  -> Cloudflare / Nginx / HTTPS
  -> Express HTTP + Socket.IO (server/index.js)
  -> PokerRoom (server/gameEngine.js)
       -> TournamentClock
       -> server-authoritative deck/actions/pots/showdown
  -> TournamentManager (server/tournamentManager.js)
       -> multi-table registration/balancing/move journal/finalization
  -> SQLite (server/db.js, better-sqlite3, WAL)
  -> sanitized stateUpdate / result events
  -> public/poker.js renders UI, animation and sound
```

### Источники истины

| Состояние | Источник истины | Клиент может менять |
|---|---|---|
| Колода, hole cards, board, фаза | `PokerRoom` | Нет; только запросить действие |
| Stack, bet, contribution, pot | `PokerRoom` | Нет |
| Очередь и таймер | `PokerRoom` | Нет |
| Комбинация и победитель | серверный evaluator / `endHand()` | Нет |
| Room/MTT snapshot и результаты | SQLite | Нет |
| MTT-регистрация и пересадка | `TournamentManager` + SQLite move journal | Только допустимые API-команды |
| Анимация, звук, локальная геометрия | `public/poker.js` | Да, визуально |
| Идентичность | подписанный HttpOnly cookie; legacy v1 имеет исключение | В v2 нет; в v1 есть риск |

Критические Socket.IO-действия разрешаются через соответствие `socket -> seat`, `turnId` и ограниченный набор уже обработанных `commandId`. Сервер не доверяет клиенту stack, cards или winner. Передача state проходит sanitization, скрывающую чужие карты до showdown/действительного all-in runout.

## 4. Что подтверждено корректным

- Все существующие release-тесты проходят, включая engine, all-in, Socket.IO E2E, MTT lifecycle, MTT E2E, identity, admin/security, restart, client/mobile/audio и effects.
- Evaluator правильно классифицировал все 2 598 960 комбинаций из пяти карт: `1302540 / 1098240 / 123552 / 54912 / 10200 / 5108 / 3744 / 624 / 36 / 4`.
- Независимые vectors подтвердили high card через royal flush, wheel, kicker pair, kicker flush, board tie, best five of seven и смену победителя river-картой.
- All-in/side-pot suite, возврат uncalled bet и сохранение фишек в покрытых сценариях проходят.
- Повторный `endHand()` защищён, а последнее исправление не объявляет showdown до river.
- Закрытые карты не обнаружены в sanitized Socket state до разрешённого показа.
- MTT registration, late registration, balancing, lifecycle, финализация и crash recovery журнала пересадки проходят существующие тесты.
- SQLite работает в WAL, имеет busy timeout и foreign keys. Kill/restart diagnostic восстановил подтверждённую версию `50` и `10000` chips.
- Backup был создан и проверен: SQLite, uploads, snapshots и registrations читаются корректно.
- XSS-критичные тексты экранируются; avatar URL ограничен; upload имеет лимит 5 MB, разрешённые MIME и генерируемое имя/расширение.
- Production service работает от `deploy`, с `Restart=always`, `NoNewPrivileges=yes`, `ProtectSystem=full`, `PrivateTmp=yes` и `LimitNOFILE=65536`.

## 5. Подтверждённые баги

### POKER-001 — P1 — пропуск решения против короткого all-in блайнда

**Место:** `server/gameEngine.js:792-796`, начало торговли после обязательных ставок.  
**Причина:** условие `playersAbleToBet < 2` автоматически переводит раздачу в runout, хотя единственный игрок со стеком ещё может иметь `toCall > 0` или право fold.  
**Воспроизведение:** heads-up, SB имеет 100, BB имеет 7, blinds 5/10. BB ставит 7 all-in, SB поставил 5.  
**Ожидание:** SB получает выбор fold или call 2.  
**Факт:** `actingSeat=-1`, переход запускается без решения; вклады остаются 7/5.  
**Подтверждение:** `test-audit-diagnostics.js`, `shortBlindAction.confirmed=true`.  
**Минимальное исправление:** один общий predicate «торговля действительно завершена», учитывающий unmatched bet каждого живого игрока, и применение его во всех переходах улиц.  
**Риск регрессии:** all-in runout, heads-up, short BB/ante; нужны детерминированные тесты по всем улицам.

### POKER-002 — P1 — сервер молча меняет смысл недопустимого действия

**Место:** `server/gameEngine.js:937-961`, `doAction()`.  
**Причина:** ветка `check/call` вычисляет и списывает `toCall` независимо от заявленного слова; нечисловой/малый `raiseTo` нормализуется в допустимый raise.  
**Воспроизведение:** отправить `check` при `toCall=50`; отдельно отправить `raise` с `NaN` при current bet 20/min raise 20.  
**Ожидание:** обе команды отклонены, состояние не меняется, клиент получает понятную ошибку/актуальный state.  
**Факт:** check списывает 50 как call; invalid raise становится raise to 40.  
**Подтверждение:** `test-audit-diagnostics.js`, `actionSemanticCoercion.confirmed=true`.  
**Минимальное исправление:** строгая таблица разрешённых server-side actions и валидация конечного integer/денежной единицы до мутации.  
**Риск регрессии:** боты и старые клиенты, которые отправляют `check` как универсальный check/call; обновить их одновременно.

### TIMER-001 — P1 — reconnect продлевает время текущего хода

**Место:** `server/gameEngine.js:571-595`, `reconnectPlayer()`.  
**Причина:** активному игроку вызывается новый `startTurnTimer(TURN_MS)` вместо сохранения оставшегося времени до `actingDeadline`.  
**Воспроизведение:** дождаться последней секунды хода и переподключиться.  
**Ожидание:** остаётся примерно одна секунда либо применяется явно определённая reconnect policy.  
**Факт:** deadline увеличился примерно на 29 секунд.  
**Подтверждение:** `test-audit-diagnostics.js`, `reconnectTimer.confirmed=true`.  
**Минимальное исправление:** сохранять абсолютный deadline и запускать `max(0, deadline-now)`; не выдавать новый полный ход.  
**Риск регрессии:** offline timeout и восстановление после process restart.

### RECOVERY-001 — P1 — restore открывает лишнюю улицу после победы фолдами

**Место:** `server/gameEngine.js:241-259`, `resumeAfterRestore()`.  
**Причина:** snapshot с `actingSeat=-1` возобновляет street transition, не проверяя, что остался один contender.  
**Воспроизведение:** snapshot на flop после fold всех кроме одного, до завершения отложенного payout; затем restore.  
**Ожидание:** немедленная uncontested payout без rabbit hunting.  
**Факт:** состояние переходит на TURN и board растёт с 3 до 4 карт.  
**Подтверждение:** `test-audit-diagnostics.js`, `foldWinRestore.confirmed=true`.  
**Минимальное исправление:** при resume сначала проверять terminal hand conditions и идемпотентно завершать hand.  
**Риск регрессии:** snapshots во время all-in runout и delayed showdown.

### POKER-003 — P1 — нечётная фишка split pot выдаётся не по позиции button

**Место:** `server/gameEngine.js:1169-1177`, сортировка winners при split.  
**Причина:** победители сортируются по абсолютному индексу seat.  
**Воспроизведение:** dealer seat 4, равные победители seats 0 и 5, pot 0.03.  
**Ожидание:** лишняя минимальная единица seat 5, первому победителю слева от button. Это соответствует Poker TDA Rule 21.  
**Факт:** её получает seat 0.  
**Подтверждение:** `test-audit-diagnostics.js`, `oddChip.confirmed=true`.  
**Минимальное исправление:** сортировать tied winners по циклическому расстоянию от `dealerSeat + 1`, отдельно для каждого pot.  
**Риск регрессии:** heads-up, dead button и несколько side pots; правило нужно зафиксировать как room rule.

### IDENTITY-001 — P1 — legacy identity позволяет занять известное место

**Место:** `server/playerIdentity.js:79-83`, `server/index.js:389-397`.  
**Причина:** для persisted комнат `identityVersion=1` сервер принимает клиентский legacy `playerId`; v2 правильно использует подписанную серверную identity.  
**Воспроизведение:** узнать/угадать legacy playerId существующего места и подключиться к legacy-комнате с этим ID.  
**Ожидание:** только владелец подписанного HttpOnly identity может восстановить место.  
**Факт:** compatibility path допускает восстановление по клиентскому ID.  
**Подтверждение:** анализ ветки и unit-тест, который явно сохраняет legacy-поведение. Новые комнаты получают v2 в `server/index.js:997`.  
**Минимальное исправление:** миграция всех persisted комнат на v2 с контролируемым one-time reconnect, затем удаление trust path.  
**Риск регрессии:** старые активные ссылки/сессии потеряют seat без миграционного окна.

### DEP-001 — P1 — публично достижимый High severity DoS в body-parser

**Место:** lockfile устанавливает `body-parser 2.3.0` transitively через Express; `server/index.js:879` глобально включает JSON parsing.  
**Причина:** advisory `GHSA-27r3-jxmh-p828`, trailing bytes after compressed request body; исправление доступно в `>=2.4.0`.  
**Воспроизведение:** специально сформированный compressed HTTP body на endpoint, проходящий parser.  
**Ожидание:** запрос ограниченно отклонён без длительного удержания ресурсов.  
**Факт:** установленная версия входит в уязвимый диапазон.  
**Подтверждение:** `npm audit --omit=dev --json`, 2 High findings суммарно.  
**Минимальное исправление:** обновить Express/lockfile до версии с body-parser >=2.4, затем прогнать полный HTTP/Socket/E2E suite.  
**Риск регрессии:** parsing ошибок/лимитов и Express middleware semantics.

### EDGE-001 — P1 — production не использует заявленный отдельный RU edge

**Место:** runtime/deployment configuration, а не игровая функция.  
**Причина:** production process не имеет `PUBLIC_EDGE_URL`/`PUBLIC_EDGE_COUNTRIES`; `www.antikpoker.online` резолвится в Cloudflare и отвечает 301 обратно на apex.  
**Воспроизведение:** DNS lookup и HTTP к `www`; запрос к Node с `CF-IPCountry: RU`.  
**Ожидание:** российский пользователь стабильно получает весь HTML/JS/WSS через рабочий проверенный маршрут без redirect loop.  
**Факт:** Node отдаёт RU-light HTML, но JS, sounds и Socket.IO остаются на apex Cloudflare; `www` не является Gcore route. Жалоба пользователя на случайный white screen/NetworkError согласуется с отсутствием end-to-end bypass, хотя операторский блок не воспроизводился из среды аудита.  
**Подтверждение:** runtime env `/proc/.../environ`, DNS от системного/Google/Cloudflare resolver, HTTP headers и direct localhost request на VPS.  
**Минимальное исправление:** сначала определить один канонический RU hostname, настроить CNAME/TLS/WebSocket на Gcore и origin Host/SNI, затем включить country routing без redirect loop и проверить из нескольких RU AS.  
**Риск регрессии:** cookies, SameSite, CORS, Socket.IO origin, cache HTML и split-brain между двумя hostnames.

## 6. Подтверждённые значимые недостатки

### DEP-002 — P2 — High severity DoS advisory в Multer

**Место:** `package.json:33`, установлен `multer 2.4.0`; upload middleware `server/index.js:972-991`.  
**Причина:** `GHSA-q7qp-rjg7-q26m`, pending async fileFilter after request teardown; исправление в 2.5+.  
**Сценарий:** оборвать специально сформированный upload во время async filter.  
**Факт:** vulnerable version установлена. Reachability уже уже, чем DEP-001, потому что upload требует admin/same-origin.  
**Исправление:** обновить Multer, протестировать valid/invalid MIME, abort, oversized и multi-file upload.  
**Риск:** изменение ошибок/cleanup временных файлов.

### PERF-001 — P2 — первый rocket effect загружает около 4.23 MB в момент события

**Место:** `public/poker.js:860` и assets `public/effects/texas-rocket.png`, `texas-reticle.png`, `texas-chip-set.png`.  
**Причина:** большие 1254x1254 PNG загружаются только при `rocket_attack_started`; общий transfer source-size около 4.23 MB.  
**Сценарий:** первый rocket на медленном мобильном соединении.  
**Ожидание:** эффект начинается синхронно с событием.  
**Факт:** cold fetch конкурирует с 900 ms start delay и может показать запоздалую/неполную анимацию.  
**Исправление:** WebP/AVIF или меньшие PNG, preload после входа за стол с low-priority, готовность эффекта до старта.  
**Риск:** память мобильного браузера и старые Safari formats.

### PERF-002 — P2 — desktop all-in loop весит около 3.65 MB и lazy-load

**Место:** `public/poker.js:2140-2141`, `public/sounds/allin_user_loop_fixed.wav`.  
**Причина:** большой WAV загружается при первом использовании.  
**Сценарий:** первый all-in на нестабильной сети.  
**Факт:** начало может задержаться/оборваться; mobile variant около 608 KB.  
**Исправление:** оптимизированный совместимый codec или меньший WAV, controlled preload после audio unlock, единый audio state machine.  
**Риск:** autoplay restrictions и несовместимость codec.

### OPS-001 — P2 — production SQLite использует `synchronous=NORMAL`

**Место:** production env не задаёт `SQLITE_SYNCHRONOUS`, применяется default NORMAL.  
**Причина:** при WAL NORMAL хорошая latency, но последние transactions могут быть потеряны при host/power failure, хотя process crash обычно переживается.  
**Подтверждение:** runtime env + DB configuration; process kill/restart test прошёл.  
**Исправление:** документированно выбрать durability SLA; для реальных денег/ценности рассмотреть FULL и измерить p95/p99 до изменения.  
**Риск:** FULL увеличит fsync latency на 2 vCPU/2 GB VPS.

## 7. Потенциальные риски, требующие отдельной проверки

### RACE-001 — Potential P1 — stale turn timer может наказать следующего игрока

**Место:** `server/gameEngine.js:652-668`.  
**Основание:** callback не захватывает ожидаемые `handNum`, `turnId` и seat; при исполнении читает текущий `actingSeat`. Искусственно вызванный старый callback после смены seat сфолдил нового игрока. Это доказывает отсутствие guard, но не доказывает, что Node `clearTimeout` race уже случался production.  
**Проверка/решение:** generation token + captured seat/hand/phase; fake timer test с callback, уже поставленным в event queue.

### MTT-001 — Potential P2 — порядок почти одновременных вылетов зависит от callback timing

**Место:** `server/gameEngine.js:1231-1245`, `server/tournamentManager.js:866-890`.  
**Основание:** внутри одной hand eliminations сортируются вкладом, но между столами итоговое место присваивается по текущей длине active players в порядке поступления callbacks.  
**Риск:** два игрока на разных столах могут получить места по scheduler timing, если house rule требует сравнивать starting stacks/время hand.  
**Действие:** сначала письменно определить tournament rule, затем batch/barrier или monotonic elimination sequence.

### SOCKET-001 — Potential P2 — нет общего connection/event rate limiting

**Место:** Socket.IO handlers в `server/index.js`.  
**Основание:** chat/reaction/effect имеют локальные cooldown, но нет общего per-IP/per-identity token bucket и лимита одновременных sockets.  
**Риск:** CPU/memory/DB pressure и reconnect storm.  
**Действие:** изолированный flood test, размеры payload и метрики event loop lag; только затем лимиты.

### UPLOAD-001 — Potential P2 — MIME доверяется multipart metadata

**Место:** `server/index.js:972-991`.  
**Основание:** fixed extension, auth, size limit и `nosniff` снижают риск, но content signature/decoding не проверяются.  
**Риск:** polyglot/decompression bomb в admin-only канале.  
**Действие:** magic-byte validation и безопасное re-encode raster/GIF.

### LOAD-001 — Potential P2 — заявленная начальная нагрузка не измерена end-to-end

**Основание:** SQLite microbenchmark показал 500 writes p95 0.064 ms, p99 0.142 ms в текущем локальном окружении, но это не Socket.IO gameplay load.  
**Неизвестно:** p50/p95/p99 action latency, event loop lag, RSS и browser CPU при 10-30 пользователях.  
**Действие:** отдельный staging soak с фиксированным сценарием, без production.

## 8. Улучшения P3

- `healthz` (`server/index.js:967`) проверяет process/room count, но не writable DB, snapshot lag, event loop lag или MTT manager health.
- CSP содержит `unsafe-inline`; `X-Powered-By: Express` не отключён. Это не доказанная эксплуатация, но unnecessary exposure.
- Global identity/session middleware ставит cookie и на static assets; первый uncookied asset имеет Cloudflare `BYPASS`. После cookie повторный versioned JS даёт MISS/HIT, поэтому это cache hygiene, не причина основного RU сбоя.
- Root-level `poker.js/html/css` и `public/app/*` расходятся с фактически обслуживаемым `public/*`, увеличивая риск развернуть не тот файл.
- `test-runner.js` не включает все scripts (`test-database-reliability`, `test-mtt-real`, scheduled/late registration), хотя они проходят отдельно.
- Нет CI workflow, lint/typecheck и обязательной проверки lockfile advisories.
- Backup/verify scripts существуют, но в репозитории нет scheduler, retention, offsite policy и restore drill документации.
- Systemd не задаёт конечный `MemoryMax`; `ProtectHome=no`; production journal недоступен deploy-пользователю.
- README частично устарел относительно 9-max/MTT и не содержит полного systemd/env runbook.
- Public room metadata endpoint раскрывает конфигурацию комнаты; секретных карт не найдено, но минимизация ответа предпочтительна.

## 9. All-in, pots и showdown

Evaluator и покрытые showdown/side-pot сценарии корректны. Uncalled excess возвращается отдельно, а игрок может одновременно получить refund и выигрыш другого pot. Folded players не входят в contenders. Двойной payout в проверенных сценариях не найден.

Вывод ограниченный: из-за POKER-001, POKER-002, POKER-003 и RACE-001 нельзя утверждать, что весь жизненный цикл ставок и выплат безопасен во всех edge cases. После исправлений нужен property-based chip conservation suite с несколькими all-ins, short raises и deterministic decks.

## 10. MTT и восстановление

Существующая архитектура MTT сильная: PREPARED/COMMITTED move journal, пауза source table, import без участия в уже начатой hand и restart tests. Регистрация, late registration и lifecycle проходят. Подтверждённой потери/дублирования chips в протестированных MTT-переездах нет.

Блокеры: RECOVERY-001 для обычной hand terminal state, неопределённая политика MTT-001 и отсутствие exhaustive crash matrix по каждому transaction boundary. Поэтому MTT можно оценить как «хорошо покрыт, но не окончательно доказан».

## 11. Безопасность

Положительно: server-authoritative actions, signed identity v2, random admin sessions, HttpOnly/SameSite cookies, timing-safe password compare, admin rate limit/same-origin mutation, safe generated upload names, no SVG, crypto shuffle, hidden-card sanitization, HSTS/CSP/nosniff/frame restrictions.

Блокеры: IDENTITY-001 и DEP-001. DEP-002 следует обновить тем же dependency release. Security review не является penetration test и не доказывает отсутствие неизвестных уязвимостей.

## 12. Ответы на финальные вопросы

1. **Правильно ли реализован Texas Hold'em?** Основная модель и evaluator корректны, но весь движок пока нет: подтверждены ошибки действий, короткого блайнда и odd chip.
2. **Есть ли подтверждённые ошибки расчёта фишек?** Да: POKER-003 неверно назначает odd chip; POKER-001 может завершить торговлю при неуравненных вкладах.
3. **Безопасны ли All-in / Side Pot / Showdown?** Покрытые сценарии проходят, но общий ответ «полностью безопасны» невозможен до исправления P1 и новых invariant tests.
4. **Надёжны ли таймеры и переходы?** Нет: TIMER-001 подтверждён, RACE-001 имеет доказанный missing guard.
5. **Могут ли скрытые карты раскрываться раньше?** В проверенных payload/flows не обнаружено; абсолютной гарантии без сетевого fuzzing нет.
6. **Может ли reconnect сломать состояние?** Он подтверждённо меняет timer semantics; двойного действия в покрытых `turnId/commandId` тестах не найдено.
7. **Насколько надёжны MTT и balancing?** Хорошо покрыты и проходят, но simultaneous cross-table elimination policy не определена.
8. **Можно ли потерять/задвоить chips после restart?** В выполненных tests не обнаружено; RECOVERY-001 показывает неверный phase transition, а power-loss при SQLite NORMAL остаётся операционным риском.
9. **Есть ли серьёзные уязвимости?** Да: legacy seat identity и две High severity dependency advisories.
10. **Выдержит ли сервер начальную нагрузку?** Не доказано: end-to-end load/soak не выполнен. SQLite microbenchmark сам по себе недостаточен.
11. **Что критично не проверено?** Реальные RU сети/операторы, 10-30 user load, физические mobile browsers, production logs/Nginx, exhaustive crash injection и внешний pentest.
12. **Можно ли запускать публично?** **Нет, пока не закрыты все P1 и release gates из `AUDIT_FIX_PLAN.md`.**

## 13. Итоговый вердикт

**NO-GO.** P0 не найдено, но набор подтверждённых P1 затрагивает обязательные решения игрока, семантику ставок, таймеры, восстановление, распределение chip, identity и доступность целевого RU-трафика. После закрытия P1, повторного полного suite и RU/WebSocket acceptance проект может перейти в **GO WITH CONDITIONS**; P2 performance/dependency/operations должны иметь владельца и срок до расширения аудитории.

Правило odd chip сверялось с [официальными Poker TDA Rules, Rule 21](https://www.pokertda.com/view-poker-tda-rules/).
