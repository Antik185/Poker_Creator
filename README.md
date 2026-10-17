# PokerRoom

Server-authoritative six-seat Texas Hold'em tournament room with custom branding,
GIF/image reactions, spectators, reconnect support and persistent room state.

## Run

```bash
npm ci
npm test
npm start
```

The server listens on `PORT` (default `3000`). Open `http://localhost:3000`.

## Production

- Use one Node.js instance per SQLite database. Multi-instance deployment requires
  a shared Socket.IO adapter and a transactional shared database.
- Persist `poker.db` and `public/uploads/` on durable storage.
- Terminate HTTPS at a reverse proxy and proxy WebSocket upgrades.
- Set `TRUST_PROXY=1` only when exactly one trusted reverse proxy is in front of
  the Node.js process.
- Run `npm ci --omit=dev` from the committed lockfile.
- Check `GET /healthz` in the process manager/load balancer.

## Limits

- Room creation: 20 per source IP per hour.
- Felt/logo files: JPEG, PNG, GIF or WebP, up to 5 MB each.
- Custom reactions: up to 8, 1 MB each and 1.4 MB total encoded payload.
- Socket.IO message size: 2 MB.
