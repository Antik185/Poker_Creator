# Аудит производительности, архитектуры и стабильности Poker Creator

Дата аудита: 2026-10-21  
Базовая версия: `eeb5a5d` (`main`)  
Production VPS: 2 vCPU, 1876 MiB RAM, Ubuntu 24.04, Node.js 24.22.0

## Резюме

Текущий VPS достаточен для 10-30 одновременных игроков. На момент замера у него было около 1.4 ГБ доступной памяти, swap не использовался, CPU idle составлял 99-100%, CPU steal был 0%, диск занят на 36%. Покупать более мощный сервер сейчас не требуется.

Основное серверное узкое место находится не в CPU и не в Socket.IO, а в синхронной SQLite с `journal_mode=DELETE` и `synchronous=FULL`. В локальном тесте 30 клиентов на 4 столах это давало задержку действия p95 172.9 мс и p99 248.6 мс. Тот же тест во временной копии с `WAL + synchronous=NORMAL` дал p95 2.6 мс и p99 3.0 мс.

Основное клиентское узкое место находится в полном пересоздании DOM стола на каждый `stateUpdate`, синхронном расчете equity на главном потоке и дорогих GIF/VFX. Это соответствует наблюдаемым подвисаниям на телефонах: сервер в это время может быть свободен, а кадры пропускает браузер конкретного игрока.

Перед публичным релизом есть три блокирующих класса риска:

1. Клиентский `playerId` фактически используется как учетная запись и раскрывается другим участникам обычного лобби. Это позволяет перехватить чужое место.
2. Публичный адрес доступен по HTTP, поэтому пароль администратора, игровой трафик и reconnect-идентификатор не защищены TLS.
3. Колода перемешивается через `Math.random()`, что не соответствует требованиям честной публичной покерной игры.

Микросервисы, Redis и несколько Node-процессов сейчас не нужны. Нужен модульный монолит, один авторитетный процесс игры, SQLite в WAL для текущего масштаба, HTTPS, нормальная игровая сессия и отделенный слой эффектов.

## Методика и границы измерений

Проведено:

- Статический аудит всего `server/` и критического пути `public/poker.js`, `public/poker.css`, `public/poker.html`, `public/lobby.html`.
- Инвентаризация Socket.IO-событий, таймеров, глобальных коллекций, БД и ассетов.
- Проверка production VPS по SSH без генерации боевой нагрузки.
- Изолированный локальный стресс-тест: 30 Socket.IO-клиентов, 4 стола, 20 секунд непрерывных допустимых действий.
- Сравнительный тест одинакового сценария на `DELETE/FULL` и `WAL/NORMAL`.
- Два цикла по 300 подключений/отключений наблюдателей.
- Использованы результаты полного release-набора тестов текущего коммита: engine, multiplayer, MTT, late registration, reconnect, rocket effect.

Не проводилось:

- Нагрузочное тестирование production VPS активными игровыми командами.
- Многочасовой soak-тест.
- Профилирование FPS/Long Tasks на нескольких реальных моделях телефонов.
- Аудит внешней сети хостинга под длительной нагрузкой.

Поэтому результаты стресс-теста являются фактическими для локальной среды и сравнительными для выбора исправления. Оценки масштабирования на 100-500 игроков помечены отдельно.

## 1. Текущая архитектура

### 1.1. Общая схема

```text
Browser (vanilla HTML/CSS/JS)
        |
        | HTTP + Socket.IO (/realtime/)
        v
Nginx :80
        |
        v
Node.js / Express 5 / Socket.IO 4
        |
        +-- PokerRoom: один объект на игровой стол
        +-- TournamentManager: один объект на MTT
        +-- TournamentClock: общий уровень блайндов MTT
        +-- better-sqlite3: комнаты, регистрации, snapshots
        +-- public/uploads: логотипы, фон, реакции
```

Frontend не использует React/Vue. Это один большой vanilla-клиент: `public/poker.js` содержит конструктор, локальную демо-игру, live table, чат, звук, equity и VFX.

Backend запускается как один systemd-сервис `poker-room.service`. Nginx проксирует HTTP и WebSocket на `127.0.0.1:3000`. Docker, Redis и внешний process manager не используются.

### 1.2. Игровые столы и изоляция

В `server/index.js:26-29` хранятся глобальные реестры `rooms`, `tournamentClocks` и `tournaments`. Они содержат ссылки на независимые объекты, а не общее состояние раздачи.

Каждый `PokerRoom` создает собственные:

- `G.seats`, `G.deck`, `G.board`, `G.pot`, `G.actingSeat`;
- `turnTimer`, `_startTimeout`, `_transitionTimeouts`;
- карты `sockets`, `players`, cooldown эффектов;
- чат и snapshot состояния.

Смешивания колод, банков или таймеров между столами в текущем коде не найдено. Общий `TournamentClock` между столами одного MTT является намеренным и корректным.

### 1.3. Путь игрового действия

```text
client socket.emit('playerAction')
  -> server/index.js:1170
  -> seat берется из server-side room.sockets
  -> PokerRoom.doAction() проверяет phase, actingSeat и inHand
  -> меняются stack/bet/pot/очередь
  -> playerActionEffect рассылает короткий визуальный эффект
  -> broadcastState()
  -> отдельный sanitizedState(viewerSeat) для каждого socket
  -> клиент Object.assign(G, state) + equity + полный renderTable()
```

Закрытые карты и колода не передаются посторонним. `sanitizedState()` вырезает внутренний `playerId`, socket id и заменяет чужие карты на `{hidden:true}` до showdown/all-in.

### 1.4. MTT

`TournamentManager` отвечает за регистрацию, столы, балансировку, позднюю регистрацию, выбывания, финальный стол и завершение. Пересадка выполняется только когда все затронутые столы находятся между раздачами (`server/tournamentManager.js:469-476`). Перед и после плана проверяется сумма фишек (`:478-496`).

Уровень блайндов задается одним серверным `TournamentClock`. Комната применяет новый уровень только при следующей раздаче. Клиент получает серверное оставшееся время, а не определяет уровень самостоятельно.

### 1.5. Persistence

Используется одна synchronous SQLite connection через `better-sqlite3`.

Хранятся:

- конфигурации комнат;
- snapshot одиночного стола;
- регистрации MTT;
- snapshot менеджера MTT;
- snapshots столов MTT.

Не хранятся как отдельные сущности:

- реальные пользовательские аккаунты;
- история рук и неизменяемый журнал действий;
- результаты/призы;
- инвентарь косметики;
- аудит административных операций.

Snapshot стола перезаписывается целиком. После текущего исправления запись объединяется окном 120 мс (`gameEngine.js:334-348`), но сама запись остается синхронной и блокирует event loop.

### 1.6. Медиа

Логотипы, фон и реакции сохраняются на локальный диск VPS и обслуживаются Express. Реакции текущей production-базы уже вынесены из Base64 в URL. `/uploads`, `/effects` и `/sounds` имеют immutable cache на 30 дней.

Rocket-ассеты загружаются лениво только при первом эффекте. GIF в picker декодируется при открытии picker, а активные реакции ограничены двумя на телефоне и тремя на desktop.

## 2. Фактические измерения

### 2.1. Production VPS в простое

| Метрика | Значение |
|---|---:|
| CPU | 2 vCPU |
| RAM | 1876 MiB |
| RAM available | 1399 MiB |
| Swap | 3071 MiB, использовано 0 |
| Disk | 20 ГБ, занято 6.6 ГБ (36%) |
| Load average | 0.00 / 0.00 / 0.00 |
| CPU idle, 5 секунд | 99-100% |
| CPU steal | 0% |
| I/O wait | 0-1% |
| Node RSS | около 96 МБ в `ps` |
| systemd MemoryPeak | около 93 МБ |
| Активные TCP | 2 established |
| Текущие рестарты сервиса | 0 |
| OOM за 7 дней | не найден |
| SQLite DB | 9.7 МБ |
| Uploads | 13 МБ |
| Built-in effects | 9.1 МБ |
| Sounds | 3.8 МБ |

Локальный health-check Node занял 3.4 мс, через Nginx 1.9 мс. Это замер на самом VPS, без внешней сетевой задержки.

В журнале есть пять неуспешных запусков от 2026-10-20 во время первоначальной настройки. Текущий запуск имеет `Result=success`, `ExecMainStatus=0`, `NRestarts=0`.

### 2.2. Размер клиента и медиа

| Ресурс | Размер |
|---|---:|
| `poker.html` | 40,006 байт |
| `poker.js` | 194,329 байт |
| `poker.css` | 88,974 байт |
| `tournament-structure.js` | 1,790 байт |
| self-hosted fonts | 103,404 байт |
| avatars, всего | 613,871 байт |
| all-in WAV | 3,738,284 байта |
| rocket icon | 2,218,843 байта |
| reticle | 1,979,840 байт |
| chip sprites | 1,595,969 байт |
| rocket | 756,080 байт |
| неиспользуемый explosion sheet | 2,911,565 байт |

Nginx имеет `gzip on`, но `gzip_proxied any` не включен. Фактический ответ для `poker.js` и `poker.css` прошел без сжатия: 194,329 и 88,974 байта по сети.

Production-конфигурации комнат после миграции имеют по 1,958 байт. До исправления локальная историческая БД содержала конфигурацию до 4,567,275 байт из-за Base64-реакций. Эта проблема уже устранена в текущем build.

### 2.3. WebSocket и нагрузка 30 игроков / 4 стола

Сценарий выполнял действия существенно быстрее обычных людей, поэтому объем трафика является стрессовым, а не прогнозом обычной сессии.

#### Текущий SQLite `DELETE/FULL`

| Метрика | Значение |
|---|---:|
| Клиенты / столы | 30 / 4 |
| Успешные ответы на действия | 315 из 316 |
| Action latency p50 | 1.21 мс |
| Action latency p95 | 172.88 мс |
| Action latency p99 | 248.55 мс |
| Максимум | 249.39 мс |
| `stateUpdate` p50 | 3,020 байт |
| `stateUpdate` p95 | 3,310 байт |
| State messages | 3,132 за 20 секунд |
| State traffic | 9.35 МБ за 20 секунд |

#### Временная копия с `WAL/NORMAL`

| Метрика | Значение |
|---|---:|
| Успешные ответы на действия | 360 из 360 |
| Action latency p50 | 1.43 мс |
| Action latency p95 | 2.57 мс |
| Action latency p99 | 3.00 мс |
| Максимум | 3.66 мс |
| `stateUpdate` p50 | 3,185 байт |
| `stateUpdate` p95 | 3,316 байт |
| State messages | 3,546 за 20 секунд |
| State traffic | 10.68 МБ за 20 секунд |
| Peak RSS | 64.3 МБ |
| CPU, доля одного ядра | 1.5% |

Прямой микро-бенчмарк 200 изменяющихся snapshots по 6 КБ:

| SQLite mode | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|
| DELETE/FULL | 80.98 мс | 114.02 мс | 139.88 мс | 171.85 мс |
| WAL/FULL | 20.07 мс | 28.01 мс | 41.70 мс | 50.01 мс |
| WAL/NORMAL | 0.034 мс | 0.158 мс | 4.19 мс | 6.43 мс |

Вывод подтвержден сравнительным тестом: длинный хвост игровых действий создается fsync SQLite, а не расчетом покера или Socket.IO.

### 2.4. Короткая проверка подключений

После 600 последовательных подключений/отключений наблюдателей:

- RSS вырос примерно с 67.8 до 78.6 МБ;
- private memory вырос с 78.3 до 91.1 МБ;
- число Windows handles осталось 251.

Это не доказывает утечку: V8 обычно не возвращает расширенный heap ОС сразу. Но и не закрывает вопрос. Нужен 2-4-часовой soak-тест с `--trace-gc`, `v8.getHeapStatistics()` и heap snapshots. Постоянной утечки native handles в коротком тесте не видно.

## 3. Найденные проблемы

### P0 — критические до публичного релиза

#### P0.1. Перехват места через клиентский `playerId`

- Код: `public/poker.js:390-400`, `server/index.js:904-927`, `server/index.js:1014-1067`, `server/gameEngine.js:491-514`.
- Риск: обычное лобби рассылает массив `lobby.players`, содержащий внутренние `playerId` и socket id. Сервер затем принимает `playerId` от любого клиента как доказательство личности и перепривязывает место к новому socket.
- Влияние: участник лобби может занять место другого игрока и отправлять Fold/Call/Raise от его имени.
- Воспроизведение: подключиться к одному лобби, прочитать чужой `playerId` из `lobbyTick`, вызвать `joinRoom` с этим ID.
- Статус: подтверждено кодом; эксплуатационный тест намеренно не запускался на production.
- Исправление: не отправлять internal player ID и socket id в lobby payload; выдать серверный reconnect token, привязанный к room/tournament и HttpOnly/signed session; все игровые команды связывать с server-side identity.

#### P0.2. Нет обязательного HTTPS/WSS

- Код/infra: Nginx слушает `:80`; direct IP `http://170.168.33.82` доступен без TLS.
- Риск: перехват admin password, cookie, игровых команд и reconnect identity в локальной/провайдерской сети.
- Статус: подтверждено конфигурацией VPS.
- Исправление: домен, Let's Encrypt, redirect 80 -> 443, WSS, HSTS после проверки, admin только через HTTPS. Прямой HTTP не должен оставаться рабочим интерфейсом администратора.

#### P0.3. Некриптографическое перемешивание колоды

- Код: `server/gameEngine.js`, функция `shuffle()`; используется `Math.random()`.
- Риск: для публичной карточной игры PRNG не дает требуемого уровня непредсказуемости и аудируемой честности.
- Статус: подтверждено кодом.
- Исправление: Fisher-Yates через `crypto.randomInt()`. Добавить детерминированные тесты через injectable RNG; seed/служебные данные никогда не отправлять клиенту. Для денежной игры отдельно потребуется provable-fair/аудит, юридическая и платежная модель.

### P1 — высокий приоритет

#### P1.1. Синхронная SQLite блокирует все столы

- Код: `server/db.js:5-6`, `server/db.js:225-265`, `server/gameEngine.js:322-348`, `server/tournamentManager.js:868-879`.
- Причина: один Node event loop и synchronous `better-sqlite3` в `DELETE/FULL`; snapshot перезаписывается целиком.
- Влияние: один fsync задерживает действия всех комнат, таймеры и Socket.IO.
- Воспроизведение: локальный сценарий 30/4 выше.
- Статус: подтверждено измерениями; p95 172.9 мс против 2.6 мс после WAL/NORMAL.
- Исправление: backup, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout`, подготовленные statements, метрика длительности записи, контролируемый checkpoint. Не отключать persistence.

#### P1.2. Нет command id и turn token

- Код: `server/index.js:1170-1176`, `server/gameEngine.js:841-906`.
- Что уже хорошо: сервер проверяет socket -> seat, phase, `actingSeat`, `inHand`; обычный двойной клик чаще всего игнорируется.
- Остаточный риск: сильно задержанная команда старого хода может прийти, когда тот же игрок снова acting на следующей улице; клиент не передает ожидаемые `handNum`, phase или уникальный turn id.
- Статус: риск подтвержден кодом, фактический инцидент не воспроизведен.
- Исправление: `{commandId, handNum, turnId, action, amount}`; LRU обработанных commandId на стол; отказ при несовпадении hand/turn; возвращать ack с stateVersion.

#### P1.3. Полный DOM render и equity на main thread

- Код: `public/poker.js:488-543`, `:2013-2025`, `:241-280`, `:3231-3408`.
- Причина: каждый `stateUpdate` вызывает `_updateEquity()` и `renderTable()`. `renderSeats()` заменяет `container.innerHTML` для всех игроков. Equity делает 1500 Monte Carlo итераций и дополнительные поиски outs.
- Влияние: потеря кадров, повторное создание изображений/карточек, задержка звука и эффектов на слабых телефонах.
- Статус: подтверждено путем исполнения; браузерный Long Task/FPS еще нужно измерить.
- Исправление: обновлять только изменившиеся слои; сохранять DOM мест; вынести equity в Web Worker либо получать серверный результат только при reveal; применять результат по fingerprint и отменять устаревшую задачу.

#### P1.4. Медиа слишком тяжелые для мобильной сети

- Код: `public/poker.js:1617-1647`, `:2554-2579`, `:2755-2772`.
- Факты: all-in WAV 3.74 МБ загружается при первом pointer unlock; три rocket-картинки суммарно 5.79 МБ загружаются при первом запуске эффекта; пользовательские GIF достигают 3 МБ каждый.
- Влияние: задержка первого эффекта/звука, конкуренция за сеть, decode и память, различный момент запуска на клиентах.
- Статус: размеры измерены; визуальный FPS на устройствах еще не измерен.
- Исправление: WAV -> Opus/AAC/MP3 с fallback; оптимизированные WebP/AVIF/PNG; серверная генерация статичного thumbnail; full animation только при показе; quality budgets.

#### P1.5. Нет резервного копирования, подтвержденного restore-тестом

- Код/infra: snapshots находятся в одном `poker.db`, пользовательские файлы только в `public/uploads`; provider backup ранее был выключен.
- Риск: потеря VPS/диска уничтожит турниры и загруженные бренды.
- Статус: автоматический backup/restore job в проекте не найден.
- Исправление: ежедневный SQLite online backup, отдельный архив uploads, хранение вне VPS, retention 7 daily + 4 weekly, ежемесячный restore drill.

#### P1.6. Пересадка MTT не является одной транзакцией

- Код: `server/tournamentManager.js:518-572`, deferred table persistence в `gameEngine.js:334-348`.
- Риск: crash между export, import и обновлением registration может оставить разные snapshots. Есть восстановление stale seat reference, но дубликат одного playerId в двух сохраненных таблицах явно не удаляется.
- Статус: обычная балансировка и restart tests проходят; torn-write crash window не тестировался.
- Исправление: persist move journal `PREPARED -> COMMITTED`, transaction для registration/manager metadata, idempotent recovery с дедупликацией playerId и проверкой chip conservation.

### P2 — средний приоритет

#### P2.1. Текстовые ответы не сжимаются Nginx

- Конфигурация: `gzip on`, но proxied JS/CSS фактически передаются без gzip.
- Влияние: лишние примерно 200-240 КБ на первый вход только для JS/CSS.
- Исправление: `gzip_proxied any`, `gzip_vary on`, корректные MIME types; лучше отдавать versioned static напрямую из Nginx.

#### P2.2. Admin constructor и live game находятся в одном HTML/JS/CSS

- Код: `public/poker.html`, `public/poker.js`, `public/poker.css`.
- Влияние: игрок парсит DOM и код конструктора, который ему не нужен; сложнее профилировать и поддерживать; ранее скрытый конструктор проявлялся под мобильным чатом.
- Исправление: отдельные entry points `admin.js/admin.css` и `table.js/table.css`, общий модуль format/layout без изменения Socket API.

#### P2.3. Rocket effect вызывает layout на каждом кадре

- Код: `public/poker.js:3037-3051`, `:3088-3196`.
- Причина: `getBoundingClientRect()` цели и effects layer выполняется в каждом animation frame; `projectile.offsetWidth` также может форсировать layout; дым создает DOM-узел примерно каждые 27 мс.
- Влияние: jank во время rocket, особенно одновременно с GIF и renderTable.
- Исправление: измерить координаты один раз и обновлять только на resize/seat layout; использовать transform-only; дым перевести в один canvas/particle pool.

#### P2.4. Sticker picker скачивает полный GIF для статичного preview

- Код: `public/poker.js:2210-2243`.
- Причина: canvas показывает первый кадр, но браузер сначала загружает и декодирует весь GIF.
- Исправление: хранить отдельный thumbnail URL; full URL загружать по click/hover или при получении события.

#### P2.5. Rate limits косметики слишком мягкие и не глобальные

- Код: `server/index.js:1180-1236`.
- Факты: reaction cooldown 750 мс, chat 700 мс; лимиты только на socket и сбрасываются reconnect; нет общего connection/IP limit; `maxHttpBufferSize` равен 5 МБ, хотя команды теперь маленькие.
- Риск: spam увеличивает decode/paint у всех клиентов и создает лишние соединения/память.
- Исправление: reaction 2 секунды, token bucket на session/IP/table, максимальный размер Socket.IO payload 64-128 КБ, лимит наблюдателей/подключений.

#### P2.6. Неограниченные наблюдатели усиливают каждый broadcast

- Код: `server/index.js:1014-1097`, `server/gameEngine.js:322-331`.
- Влияние: каждый spectator получает персональный snapshot; злоумышленник может умножить serialization/egress без участия в игре.
- Исправление: room spectator cap, IP/session connection cap, backpressure/disconnect для медленных клиентов, метрика recipients per broadcast.

#### P2.7. Рейтинг MTT сортируется заново для каждого socket

- Код: `server/gameEngine.js:260-269`, `:322-331`.
- Причина: `getTournamentPlayers()` и `.sort()` вызываются внутри `sanitizedState` каждого получателя.
- Влияние: почти незаметно на 30 игроках, но O(viewers * players log players) на каждое действие при 500 участниках.
- Исправление: один immutable public base snapshot и один cached ranking на stateVersion; приватно подставлять только hole cards/yourSeat.

#### P2.8. Локальный upload не имеет lifecycle и content inspection

- Код: `server/index.js:160-173`, `:711-753`.
- Риск: orphan files после удаления/пересоздания комнат, заполнение 20-ГБ диска; проверяется заявленный MIME, а не magic bytes/dimensions.
- Исправление: проверка сигнатуры и размеров, таблица asset references, cleanup orphan assets, дисковый alert 70/85%.

#### P2.9. Chat spectator может подменять отображаемое имя

- Код: `server/index.js:1216-1236`.
- Риск: незанятый spectator задает произвольное имя; это не влияет на фишки, но позволяет impersonation в чате.
- Исправление: имя только из authenticated session/registration; spectator получает серверный guest id.

### P3 — улучшения

#### P3.1. Нет эксплуатационных метрик

`/healthz` показывает только uptime и число rooms. Нет event-loop lag, WebSocket count, tables/tournaments, command p95, DB latency, broadcast bytes, heap и ошибок.

#### P3.2. Логи неструктурированные

Нужны JSON-события с `tournamentId`, `tableId`, `handNum`, `commandId`, duration и result. Нельзя логировать hole cards, токены и пароль.

#### P3.3. In-memory admin sessions и rate-limit maps не очищаются периодически

Истекшие admin sessions удаляются только при повторном использовании; IP maps очищаются только при новом запросе этого IP. При обычной нагрузке это мало, при сканировании множеством IP карта может расти.

#### P3.4. Неиспользуемые ассеты остаются в deploy

`texas-explosion-sheet.png` весит 2.91 МБ и текущим procedural explosion не используется. Он не входит в critical path, но занимает диск и усложняет asset inventory.

## 4. Что уже исправлено в текущей версии

Следующие ранее критичные причины уже устранены в `eeb5a5d` и не должны быть возвращены:

- Base64 GIF вынесены из room config в immutable URL.
- Медиа больше не пересылается в каждом WebSocket reaction event.
- Скрытая admin-сетка GIF не рендерится при live join.
- Rocket assets загружаются лениво.
- Одновременные реакции ограничены (2 mobile / 3 desktop, одна на seat).
- State persistence объединяется окном 120 мс.
- Late registration показывает pending state и пересаживает игрока между раздачами.
- Игровой звук разблокируется первым pointer event на мобильном.
- Server-side карты скрываются персонально; deck не отправляется.
- Offline игроки получают auto-check/auto-fold и не останавливают турнир.

## 5. Целевая архитектура

### Для 10-30 игроков

```text
HTTPS/WSS (domain + Let's Encrypt)
              |
          Nginx
       /static  \ /api,/realtime
      immutable       |
                      v
             One Node.js process
      +----------+----------+----------+
      | Auth     | Table    | MTT      |
      | Session  | Engine   | Manager  |
      +----------+----------+----------+
                      |
              Persistence service
                      |
               SQLite WAL/NORMAL

Uploaded media -> local disk + offsite backup
Frontend -> Table UI and independent EffectsLayer
```

Один процесс остается преимуществом: игровые команды внутри стола выполняются последовательно без распределенных lock. systemd перезапускает процесс, snapshots восстанавливают игру.

### Только при росте до 100-500

После отдельного load/soak-теста рассмотреть:

- CDN/object storage для пользовательских медиа;
- PostgreSQL для аккаунтов, регистраций, истории и надежных транзакций;
- partitioned table ownership: один стол принадлежит ровно одному game worker;
- sticky WebSocket routing;
- Redis adapter только как transport/presence между процессами, не как источник истины покерной руки;
- отдельный worker для транскодирования медиа и аналитики;
- 4 vCPU / 4-8 ГБ только после измерения event-loop, egress и DB.

Нельзя просто запустить второй Node instance за round-robin Nginx: сейчас состояние rooms находится в памяти одного процесса.

## 6. План безопасной оптимизации

### Этап 0. Backup и наблюдаемость

- Файлы/infra: systemd, backup scripts, `server/index.js`.
- Изменение: offsite backup DB/uploads; расширить health/metrics; command/DB timing histograms.
- Риск: низкий; не включать секреты в metrics/logs.
- Тест: restore на отдельной директории; health при запущенных 4 столах.
- Метрика: backup age, restore success, event-loop p95, DB p95, WS count.
- Откат: удалить metrics endpoint/unit timers, игровой код не меняется.

### Этап 1. HTTPS и identity

- Файлы: `server/index.js`, `public/lobby.html`, `public/poker.js`, Nginx.
- Изменение: TLS; server-issued signed session/reconnect token; убрать internal IDs из lobby payload.
- Риск: старые localStorage ID перестанут быть достаточными; нужна совместимая одноразовая миграция активных комнат.
- Тест: попытка hijack, refresh/reconnect, две вкладки, spectator, late registration, eliminated player.
- Метрика: unauthorized rejects, reconnect success rate.
- Откат: держать предыдущий build и DB backup; feature flag legacy identity только на короткое migration window.

### Этап 2. SQLite WAL

- Файлы: `server/db.js`, `server/gameEngine.js`, `server/tournamentManager.js`.
- Изменение: `WAL/NORMAL`, checkpoint policy, prepared statements, DB timing; сохранить coalesced snapshots.
- Риск: неправильный deploy/backup WAL side files; потеря самого последнего commit возможна при полном отказе питания в NORMAL, но целостность DB сохраняется.
- Тест: полный suite, 30/4 stress, kill -9/restart, backup во время WAL, restore, MTT move/restart.
- Метрика: action p95 < 100 мс, DB p95 < 10 мс, event-loop p95 < 20 мс.
- Откат: остановить сервис, checkpoint, вернуть journal pragma, восстановить backup при необходимости.

### Этап 3. Идемпотентные команды

- Файлы: `server/index.js`, `server/gameEngine.js`, `public/poker.js`, e2e tests.
- Изменение: `commandId`, `handNum`, `turnId`, `stateVersion`, ack/result cache.
- Риск: рассинхронизация старого клиента и нового сервера.
- Тест: double click, delayed old call, timeout/fold race, reconnect action, duplicate packet.
- Метрика: zero duplicate mutations; count stale/duplicate rejects.
- Откат: принимать legacy envelope за feature flag, затем выключить после обновления кешей.

### Этап 4. Frontend rendering и equity

- Файлы: `public/poker.js`, `public/poker.html`, `public/poker.css`; новый `table-renderer.js`/`equity-worker.js`.
- Изменение: постоянные seat nodes, patch changed fields, Web Worker для equity, EffectsLayer вне render table.
- Риск: визуальные регрессии карт/ставок на 6/9-max и mobile.
- Тест: screenshot matrix desktop/mobile, all-in, 9-max, chat/GIF/rocket одновременно.
- Метрика: Long Tasks, frame time, render duration; цель p95 render < 8 мс на среднем телефоне.
- Откат: renderer feature flag на старый full render.

### Этап 5. Медиа-пайплайн

- Файлы: upload API, asset metadata, picker/effects/audio.
- Изменение: thumbnail + optimized full asset, аудио Opus/MP3, размер/разрешение/FPS budgets, orphan cleanup.
- Риск: качество и Safari compatibility.
- Тест: iOS Safari, Android Chrome, desktop; visual/audio A/B; fallback formats.
- Метрика: cold bytes, decode time, effect start skew, dropped frames.
- Откат: хранить оригинал до подтверждения конвертации и переключать URL в config.

### Этап 6. Socket payload и abuse limits

- Файлы: `server/index.js`, `server/gameEngine.js`, client event handlers.
- Изменение: cached base snapshot, private card overlay, rate limits, spectator cap, smaller max buffer, sticker ID.
- Риск: слишком строгие лимиты могут отключить игроков с нестабильной сетью.
- Тест: 30/4 + reconnect storm + cosmetic spam + slow client.
- Метрика: bytes/action, serialize duration, recipients/broadcast, disconnect reasons.
- Откат: лимиты и delta state за feature flags; full snapshot остается fallback.

### Этап 7. Надежность MTT

- Файлы: `server/tournamentManager.js`, `server/db.js`, restart tests.
- Изменение: transactional/idempotent move journal и recovery dedupe.
- Риск: наиболее чувствительный этап для стеков; выполнять после backup/metrics.
- Тест: kill процесса в каждой точке move, multi-bust, final table, chip conservation.
- Метрика: recovery success, duplicate player count = 0, chip delta = 0.
- Откат: предыдущий manager + DB backup до migration.

## 7. Оценка VPS

### Фактический вывод для 10-30 игроков

2 vCPU и 2 ГБ RAM достаточно с большим запасом по CPU и памяти. В тесте 30/4 с WAL процесс использовал peak RSS 64.3 МБ и около 1.5% одного ядра. Production в простое имеет около 1.4 ГБ available RAM и не использует swap.

Первым ограничением сейчас становится synchronous disk latency SQLite. Вторым является клиентский main thread и загрузка/декодирование медиа. Простое увеличение VPS не исправит мобильные подвисания и только частично замаскирует fsync.

### Когда текущего VPS станет недостаточно

Предварительная оценка, требующая повторного теста после исправлений:

- много одновременных cold joins с фонами/GIF без CDN;
- десятки столов с частыми snapshot writes;
- сотни наблюдателей, получающих персональный full state;
- 100-500 игроков и MTT ranking, пересчитываемый на каждого получателя;
- транскодирование изображений/видео в основном Node-процессе;
- несколько Node workers без распределенного ownership столов.

До достижения этих условий апгрейд не нужен. Для следующего решения о VPS нужны 2-4 часа soak-теста, 100/250 synthetic clients и фактические показатели egress, event-loop p95, heap и DB p95.

## 8. Минимальный мониторинг перед релизом

Добавить:

- `monitorEventLoopDelay()` и event-loop utilization;
- RSS, heap used/limit, process uptime;
- Socket.IO connected count;
- active rooms/tables/tournaments/spectators;
- command latency p50/p95/p99;
- DB write latency и errors;
- state messages/bytes и recipients;
- reconnects, stale commands, rate-limit rejects;
- disk usage и backup age.

Alerts:

- health endpoint недоступен 2 минуты;
- RSS > 1.2 ГБ;
- event-loop p95 > 100 мс 5 минут;
- action p95 > 150 мс;
- disk > 70% warning / 85% critical;
- backup старше 26 часов;
- restart/OOM > 0.

## 9. Release gate

Минимум до публичного запуска:

1. Исправить P0.1-P0.3.
2. Перевести SQLite на WAL и повторить 30/4 + restart tests.
3. Настроить backup и HTTPS.
4. Добавить command id/turn token.
5. Уменьшить all-in audio и включить HTTP compression.
6. Проверить Chrome Android и Safari iOS с Performance trace при GIF + all-in + rocket.
7. Выполнить минимум двухчасовой soak без постоянного роста heap/listeners/timers.

После этого текущий VPS и модульный монолит подходят для первого релиза на 10-30 игроков.
