# antikpoker

Server-authoritative six-seat Texas Hold'em tournament room with custom branding,
GIF/image reactions, spectators, reconnect support and persistent room state.

## Run

```bash
npm ci
npm test
npm start
```

The server listens on `PORT` (default `3000`). Open `http://localhost:3000`.

Room creation is available at `/admin`. Set `ADMIN_PASSWORD` to protect the
constructor in production. The public `/` page only allows players to join an
existing room by code. Development mode remains password-free unless
`ADMIN_PASSWORD` is set.

## Production

- Use one Node.js instance per SQLite database. Multi-instance deployment requires
  a shared Socket.IO adapter and a transactional shared database.
- Persist `poker.db` and `public/uploads/` on durable storage.
- Terminate HTTPS at a reverse proxy and proxy WebSocket upgrades.
- Set `TRUST_PROXY=1` only when exactly one trusted reverse proxy is in front of
  the Node.js process.
- Set `PLAYER_SESSION_SECRET` to a persistent random value of at least 32 bytes.
  Changing it signs every player out and prevents reserved-seat reconnects.
- Set a strong `ADMIN_PASSWORD`. Production mode fails closed when it is missing:
  room creation remains unavailable until the password is configured.
- After a domain points to the server, issue a TLS certificate, adapt
  `deploy/nginx-poker.conf.example`, and set `REQUIRE_HTTPS=1`. Socket.IO then
  uses WSS through the same reverse proxy endpoint.
- Run `npm ci --omit=dev` from the committed lockfile.
- Check `GET /healthz` in the process manager/load balancer.

## Limits

- Room creation: 20 per source IP per hour.
- Felt/logo files: JPEG, PNG, GIF or WebP, up to 5 MB each.
- Custom reactions: up to 8, 3 MB each.
- Socket.IO message size: 5 MB.
