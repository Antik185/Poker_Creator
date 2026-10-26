# RU Edge Validation Plan

Цель: подтвердить полный игровой маршрут для российских пользователей до country switch. Этот план не разрешает изменение DNS/CDN/Nginx и не предполагает переключение пользователей на непроверенный hostname.

## 1. Изолированная подготовка

1. Выбрать один кандидат hostname, например `www.antikpoker.online`, без изменения apex.
2. Проверить Gcore resource status, origin URL, origin Host header, SNI и certificate chain.
3. До DNS-переключения тестировать через provider preview/temporary host либо локальный hosts override только на тестовых устройствах.
4. Не включать `PUBLIC_EDGE_COUNTRIES=RU`, пока весь acceptance ниже не пройдёт.
5. Подготовить rollback: удалить/отключить country redirect и вернуть только candidate CNAME; apex не менять одновременно.

## 2. Матрица сетей

Минимум три независимых российских маршрута:

- Домашний ISP, ранее воспроизводивший белый экран.
- Мобильный оператор через LTE/5G.
- Другой ISP/AS или внешний RU probe.

Контроль: одна non-RU сеть и VPN должны продолжать использовать обычный Cloudflare path без ухудшения.

## 3. HTTP/HTTPS и ресурсы

Для каждого маршрута выполнить cold-cache и repeat-cache:

- `GET /`, `/admin`, `/lobby/<code>`, `/r/<roomId>`, `/healthz`, `/api/code/<code>`.
- HTTP должен предсказуемо перейти на HTTPS без loop.
- HTTPS: валидный hostname/SAN, полная chain, TLS 1.2/1.3, без mixed content.
- HTML, versioned JS/CSS, fonts, sounds, avatars, uploads и effect assets получают 200/304, не 5xx/timeout.
- Проверить `Content-Type`, `nosniff`, `Cache-Control`, compression и отсутствие случайного cache HIT для user-specific HTML/API.
- Повторная загрузка должна брать immutable/versioned static assets из cache; cookies не должны делать их private без причины.

Записать HAR, DNS answer, edge POP, TTFB, download time и ошибки console/network.

## 4. Cookies и identity handoff

- Первый вход получает подписанную серверную identity cookie с ожидаемыми `HttpOnly`, `SameSite` и `Secure` под HTTPS.
- Redirect на candidate host переносит identity только через одноразовый handoff и удаляет token из URL.
- Back/refresh не создаёт redirect loop и не меняет seat/player identity.
- Replay handoff отклоняется.
- Две вкладки соблюдают текущую replacement policy; чужой `playerId` не захватывает seat.
- Admin cookie не утекает на неподходящий domain/path и admin mutation остаётся same-origin.

## 5. Socket.IO/WSS gameplay

Проверить Network frames и серверные события, а не только открытую страницу:

1. Polling handshake `/realtime/` проходит через edge.
2. WebSocket upgrade использует `wss://<candidate>/realtime/`, возвращает `101` и остаётся подключённым не менее 30 минут.
3. Если upgrade недоступен, polling fallback сохраняет gameplay без циклических reconnect.
4. Два игрока из разных RU сетей и один non-RU игрок садятся за стол.
5. Выполнить Fold, Check, Call, Raise, All-in, reactions и chat.
6. Проверить turn timer, flop/turn/river, showdown, payout и следующую hand.
7. Отключить сеть на 5-15 секунд, восстановить её и подтвердить тот же seat/stack и сохранённый deadline.
8. Переключить Wi-Fi/LTE и background/foreground на River.
9. Пройти tournament lobby, регистрацию, table move, elimination, final table и возврат в lobby.
10. Открыть admin, создать тестовую комнату с небольшим валидным image upload и удалить тестовые данные штатным способом.

## 6. Acceptance thresholds

- 0 белых экранов и 0 обязательных ручных refresh в 30 cold starts на сеть.
- 0 redirect loops, TLS/certificate, CORS, mixed-content и cookie errors.
- 0 потерянных player actions и seat identity changes.
- 0 duplicate payout/chip drift.
- Успешный reconnect во всех запланированных network interruptions.
- Не менее 99% HTTP/static requests без 5xx/timeout в тестовой выборке.
- Зафиксировать p50/p95/p99 navigation, Socket connect и action round-trip; численный SLA утвердить до rollout.

## 7. Canary и rollback

После полного acceptance включать маршрут сначала для контролируемой группы/короткого окна, не для всего RU сразу. Наблюдать HTTP 4xx/5xx, Socket connect failures, reconnect rate, action RTT, event-loop lag, RSS и DB errors.

Rollback выполняется при повторяющемся white screen, росте Socket failures, redirect loop, identity mismatch, missed action или chip invariant alert: отключить country redirect, вернуть RU на проверенный основной host и сохранить HAR/logs для разбора. Не менять apex и CDN resource одновременно в первой итерации.
