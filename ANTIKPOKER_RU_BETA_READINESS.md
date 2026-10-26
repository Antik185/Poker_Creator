# AntikPoker RU Beta Readiness

Дата: 2026-10-26  
Целевая бета: 2026-10-29

## Ограничение этой проверки

Основной production-домен, DNS, Cloudflare/Gcore, Nginx и production-процесс не изменялись. Проверки выполнялись локально и на изолированном hostname-контракте. Переключать российский трафик или менять основной домен до завершения реальных acceptance-проверок запрещено.

## Краткий результат

- Приложение локально обслуживает через альтернативный hostname главную, health API, versioned JS, авторизацию администратора, админку, стол, Socket.IO polling и прямой WebSocket.
- Полный release suite проходит, включая игровой движок, all-in/showdown, side pots, reconnect, identity, MTT и E2E.
- Добавлена публичная read-only страница `/diagnostics`, которая проверяет обязательные ресурсы, API, polling и WebSocket на текущем hostname без показа cookies, токенов или паролей.
- У входа в админку появились ограниченные по времени запросы, проверка принятия session cookie и видимая ошибка вместо бесконечной загрузки.
- RU-облегченные страницы админки и стола показывают bootstrap-статус и понятную ошибку вместо пустого экрана. Стол считается загруженным только после реального Socket.IO-соединения.
- Реальный резервный адрес через Gcore и доступность из российских сетей в этой среде не проверены. Поэтому готовность к российской бете не подтверждена.

## 1. Белый экран

### Что установлено

В приложении был подтвержден опасный сценарий: облегченные RU-страницы загружали критические CSS/JS отдельными запросами, но до выполнения `poker.js` не имели независимого видимого состояния ошибки. Если JS или Socket.IO не загружался либо зависал, пользователь мог видеть пустую или неработающую страницу без объяснения и возможности диагностики.

Исправлено:

- в HTML добавлен независимый inline bootstrap guard;
- через 12 секунд показывается ошибка и доступны повторная загрузка и `/diagnostics`;
- для страницы стола guard снимается только после фактического Socket.IO `connect`;
- `connect_error` показывает сетевую ошибку и ссылку на проверку polling/WebSocket.

### Что не установлено

Точная внешняя причина прежнего белого экрана не установлена. Нет HAR/console/DNS/TLS trace с проблемной российской мобильной сети. Нельзя утверждать, что причиной была блокировка Cloudflare, Gcore, IPv6, TLS либо конкретный ресурс.

Для установления точной причины нужен отчет `/diagnostics` и сетевой trace непосредственно с проблемного подключения.

## 2. Зависание админки после пароля

### Подтвержденная слабость клиента

Запрос входа и последующая навигация не имели ограниченного времени ожидания. При зависшем API/CDN-запросе интерфейс мог оставаться в состоянии загрузки без понятной ошибки. После успешного POST клиент также не проверял, что браузер действительно принял admin session cookie, до перехода на `/admin`.

Исправлено:

1. Каждый сетевой attempt ограничен 8 секундами через `AbortController`.
2. Транзиентный сетевой сбой повторяется с ограниченным числом попыток.
3. После login выполняется same-origin `GET /api/admin/session`.
4. Переход продолжается только при `authenticated: true`.
5. Если `/admin` не открылся за 10 секунд, пользователь получает сообщение и ссылку на диагностику.

### Cookie и авторизация

Локальные тесты подтверждают:

- admin cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`;
- за корректно настроенным HTTPS proxy cookie также получает `Secure`;
- cross-origin admin mutation отклоняется;
- альтернативный hostname может выполнить login и открыть authenticated `/admin` на том же hostname.

Фактическая причина конкретного production-зависания полностью не доказана без HAR и server/edge logs. Исправление устраняет бесконечное ожидание и позволяет отличить timeout, непринятую cookie и сбой загрузки admin assets.

## 3. Hostname и запросы

Клиент использует same-origin пути:

- API: `/api/...`;
- Socket.IO client и transport: `/realtime/`;
- JS/CSS/fonts/sounds/effects: пути текущего hostname.

В коде не обнаружен отдельный обязательный Cloudflare hostname для игрового API или Socket.IO. Поэтому корректно настроенный резервный hostname способен обслуживать весь маршрут целиком, а не только HTML.

Живые Gcore origin Host/SNI, cache rules и WebSocket policy из репозитория определить нельзя. Они должны быть проверены на самом кандидате.

Безопасная внешняя GET-проверка 2026-10-26 установила, что текущий `https://www.antikpoker.online` не является независимым резервным маршрутом. Cloudflare отвечает `301 Moved Permanently` на apex для всех проверенных путей:

- `/` -> `https://antikpoker.online/`;
- `/healthz` -> `https://antikpoker.online/healthz`;
- `/admin` -> `https://antikpoker.online/admin`;
- `/r/reserve-route-check` -> тот же path на apex;
- `/realtime/?EIO=4&transport=polling...` -> тот же query/path на apex.

Запросы выполнялись без follow redirect, поэтому основной домен не использовался для проверки приложения. Этот результат доказывает, что `www` сейчас возвращает пользователя на основной Cloudflare route и не может быть принят как Gcore failover.

## 4. Текущая схема edge routing в приложении

- `PUBLIC_EDGE_URL` задает HTTPS origin резервного hostname.
- `PUBLIC_EDGE_COUNTRIES` задает ISO-коды стран для перенаправления.
- Country redirect применяется к lobby и table routes, а не к главной или `/admin`.
- Идентичность игрока передается на edge одноразовым server-side handoff с TTL 60 секунд.
- Handoff удаляется из URL, повторное использование не восстанавливает прежнюю identity.
- Оба hostname ведут к одному Express/Socket.IO процессу и общему игровому состоянию.

Локальный тест подтверждает этот контракт. Он не подтверждает, что текущий Gcore resource уже направлен на тот же origin и корректно передает WebSocket.

## 5. Изменения

- `public/home.html`: timeout/retry, проверка admin session, navigation watchdog, ссылка на диагностику.
- `public/poker.html`: независимый bootstrap guard и обновленный version marker.
- `public/poker.js`: готовность стола только после Socket.IO connect; видимый connect error.
- `public/diagnostics.html`: новая безопасная same-origin диагностика.
- `server/index.js`: no-store route `/diagnostics`, сборка облегченных страниц с новым marker.
- `test-admin-auth.js`: regressions для timeout, session, diagnostics, RU bootstrap и realtime.
- `test-client-performance.js`: актуальный client marker.
- `test-edge-handoff.js`: полный альтернативный-hostname контракт.

Папка `ukrainian_avatars_12.10-18.10_over10/` не изменялась.

## 6. Автоматические проверки

`npm test`: **PASS**.

В полном прогоне подтверждены:

- engine, action validation, side pots, uncalled refund, River/showdown и single payout;
- 1000-hand deterministic soak без chip drift;
- MTT seating, balancing, recovery, lifecycle и final state;
- server identity, seat ownership, refresh/reconnect и same-origin admin security;
- mobile foreground recovery и восстановление закрытого River;
- audio/effects regressions;
- главная, админка, lobby и table routes;
- резервный hostname: home, health API, game JS, admin login/session/page, table;
- Socket.IO polling handshake и прямой WebSocket на резервном-hostname контракте;
- one-time identity handoff и защита от replay/redirect loop.

Это локальная проверка кода и proxy semantics, не внешний Gcore/RU acceptance.

## 7. Реальные российские сети

В этом прогоне не проверена ни одна реальная российская сеть. Требуемые подтверждения отсутствуют для:

- домашнего российского ISP;
- мобильного LTE/5G;
- третьего независимого ISP/AS;
- физического Android/iOS;
- 30-минутного WSS/polling соединения;
- реальной игры и MTT через резервный CDN.

## 8. Socket.IO и MTT

- Socket.IO path: `/realtime/`.
- Локально работают polling handshake, direct WebSocket и обычный upgrade/fallback контракт.
- Локальные gameplay/reconnect/MTT tests проходят.
- Socket.IO и MTT **из РФ через фактический резервный адрес не подтверждены**.

## 9. Резервный адрес

Проверенного внешнего резервного адреса пока нет. Текущий `www.antikpoker.online` отвечает через Cloudflare и перенаправляет главную, health, admin, table и Socket.IO polling обратно на apex. Поэтому он **не является резервным маршрутом** и не подходит даже для начала Gcore acceptance.

Нужен отдельный candidate hostname или исправленный `www`, который без redirect обслуживает все эти пути через Gcore и тот же origin. Основной домен не переключать и `PUBLIC_EDGE_COUNTRIES=RU` не включать до полного acceptance.

## 10. Обязательная ручная приемка резервного маршрута

Для каждого из трех российских подключений без VPN:

1. Открыть `https://<reserve-host>/diagnostics` и сохранить скопированный отчет.
2. Убедиться, что PASS получили health, player/admin session API, JS, CSS, tournament structure, Socket.IO client, fonts, sound, image, polling и WebSocket.
3. Выполнить 30 cold starts главной без белого экрана и ручного refresh.
4. Войти тестовым администратором на этом же hostname; создать тестовую комнату и открыть admin dashboard.
5. Открыть lobby по коду и прямую ссылку table; проверить Network/Console на timeout, 4xx/5xx, redirect loop, TLS, CORS, CSP и cookie errors.
6. Подключить минимум двух RU-игроков и одного контрольного non-RU игрока.
7. Выполнить Fold, Check, Call, Raise, All-in, Flop, Turn, River, showdown, payout и следующую hand.
8. Отключить сеть на 5-15 секунд, восстановить ее и подтвердить прежние seat/stack/turn state.
9. Переключить Wi-Fi/LTE и background/foreground на River.
10. Провести MTT: registration, seating, table move, elimination, final table и завершение.
11. Держать соединение не менее 30 минут; записать reconnect count и p50/p95/p99 action RTT.
12. Повторить smoke test через основной маршрут из non-RU сети.

Для Android HAR/console можно получить через Chrome remote debugging (`chrome://inspect/#devices`) с включенной USB debugging. Отчеты не должны содержать пароль, `Cookie`, `Set-Cookie`, handoff token или полный URL с секретным query.

## 11. Acceptance gate

Резервный маршрут принимается только при одновременном выполнении:

- 0/30 белых экранов на каждой сети;
- 0 обязательных refresh;
- 0 TLS, redirect, CORS, cookie и mixed-content ошибок;
- polling и WebSocket проходят на каждой сети;
- нет циклического reconnect;
- нет потери seat/player identity, действий, ставок или выплат;
- reconnect восстанавливает актуальный server state;
- полный пробный MTT завершается;
- основной non-RU маршрут не ухудшен.

## 12. Риски

- Причина внешней RU-нестабильности пока не локализована сетевым trace.
- Текущий `www` указывает на Cloudflare redirect к apex, а не на независимый Gcore route.
- Gcore DNS/TLS/origin/cache/WebSocket конфигурация не подтверждена.
- Локальный hostname-тест не моделирует российскую фильтрацию, мобильный NAT, packet loss или edge POP.
- Admin session host-only: login нужно выполнять на том hostname, где открывается admin; cookie намеренно не переносится через URL.
- Нельзя внедрять автоматический failover до реального canary: если HTML не получен, клиентский JS не сможет переключить маршрут.

## 13. Rollback

Production изменений в этой работе нет, поэтому инфраструктурный rollback не требуется.

Для будущего canary rollback должен быть подготовлен заранее:

1. отключить country redirect на уровне env/процесса;
2. вернуть RU пользователей на последний проверенный основной маршрут;
3. не менять одновременно apex DNS, CDN resource и приложение;
4. сохранить HAR, edge/server logs и диагностические отчеты;
5. откатывать application commit штатным `git revert`, затем повторять smoke tests.

## Вердикт

**NOT READY**

Кодовые предохранители и локальный резервный-hostname контракт готовы, но нет доказательства, что фактический резервный CDN загружает главную, админку, lobby, table, API и Socket.IO из реальных российских сетей. До такого доказательства основной рабочий домен и RU routing менять нельзя.
