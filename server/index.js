const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { PokerRoom } = require('./gameEngine');
const { TournamentClock } = require('./tournamentClock');
const { TournamentManager, TABLE_STATES } = require('./tournamentManager');
const { PlayerIdentityService, parseCookies, resolveRoomPlayerId } = require('./playerIdentity');
const { LEVELS, PRESETS, ANTE_TYPES } = require('../public/tournament-structure');

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  path: '/realtime/',
  maxHttpBufferSize: 5 * 1024 * 1024,
  perMessageDeflate: false
});

const PORT = process.env.PORT || 3000;

// Rooms in memory
const rooms = new Map();
const tournamentClocks = new Map();
const tournaments = new Map();

// Lobbies: code → { roomId, players: [{id, name}], timer, secondsLeft, started }
const lobbies = new Map();

// Store lobby seat assignments so players can auto-sit when they arrive at the room.
// Keyed by persistent playerId (the lobby page and the room page are different
// socket connections, so socket.id is useless here).
// lobbySeats: roomId → Map<playerId, {seatIdx, name, flag}>
const lobbySeats = new Map();

// Pending deletion timers for rooms with no connected sockets
const roomCleanups = new Map();
const ROOM_CLEANUP_MS = 10 * 60 * 1000;
const FINISHED_TOURNAMENT_CLEANUP_MS = 2 * 60 * 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REACTION_BYTES = 3 * 1024 * 1024;
const REACTION_UPLOAD_DIR = path.join(__dirname, '../public/uploads/reactions');
const ROOM_CREATE_LIMIT = 20;
const SCHEDULED_SEATING_MS = 5 * 60 * 1000;
const MAX_SCHEDULE_DELAY_MS = 2_000_000_000;
const roomCreateWindows = new Map();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const ADMIN_AUTH_REQUIRED = process.env.NODE_ENV === 'production' || !!ADMIN_PASSWORD;
const ADMIN_COOKIE = 'poker_admin';
const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_LIMIT = 5;
const adminSessions = new Map();
const adminLoginWindows = new Map();
const REQUIRE_HTTPS = process.env.REQUIRE_HTTPS === '1';
const PLAYER_SESSION_SECRET = String(process.env.PLAYER_SESSION_SECRET || (
  ADMIN_AUTH_REQUIRED ? '' : 'local-development-player-session-secret-v1'
));
if (Buffer.byteLength(PLAYER_SESSION_SECRET, 'utf8') < 32) {
  throw new Error('PLAYER_SESSION_SECRET must be configured with at least 32 bytes');
}
const playerIdentity = new PlayerIdentityService({ secret: PLAYER_SESSION_SECRET });

const PUBLIC_DIR = path.join(__dirname, '../public');

function replaceRequired(source, marker, replacement, pageName) {
  if (!source.includes(marker)) {
    throw new Error(`Unable to build ${pageName}: missing ${marker}`);
  }
  return source.replace(marker, () => replacement);
}

function buildCriticalPages() {
  const fonts = fs.readFileSync(path.join(PUBLIC_DIR, 'fonts.css'), 'utf8');
  const pokerCss = fs.readFileSync(path.join(PUBLIC_DIR, 'poker.css'), 'utf8');
  const tournamentStructure = fs.readFileSync(path.join(PUBLIC_DIR, 'tournament-structure.js'), 'utf8');
  const pokerJs = fs.readFileSync(path.join(PUBLIC_DIR, 'poker.js'), 'utf8');
  const socketClient = fs.readFileSync(
    path.join(__dirname, '../node_modules/socket.io/client-dist/socket.io.min.js'),
    'utf8'
  );

  let home = fs.readFileSync(path.join(PUBLIC_DIR, 'home.html'), 'utf8');
  home = replaceRequired(
    home,
    '  <link href="/fonts.css?v=20261019b" rel="stylesheet">',
    `  <style data-critical-fonts>\n${fonts}\n  </style>`,
    'home page'
  );

  let admin = fs.readFileSync(path.join(PUBLIC_DIR, 'poker.html'), 'utf8');
  admin = replaceRequired(
    admin,
    '<link rel="stylesheet" href="/fonts.css?v=20261019b">',
    `<style data-critical-fonts>\n${fonts}\n</style>`,
    'admin page'
  );
  admin = replaceRequired(
    admin,
    '<link rel="stylesheet" href="/poker.css?v=20261023b">',
    `<style data-admin-bundle="poker.css">\n${pokerCss}\n</style>`,
    'admin page'
  );
  admin = replaceRequired(
    admin,
    '<script src="/realtime/socket.io.js?v=4.8.4"></script>',
    `<script data-admin-bundle="socket.io">\n${socketClient}\n</script>`,
    'admin page'
  );
  admin = replaceRequired(
    admin,
    '<script src="/tournament-structure.js?v=20261019c"></script>',
    `<script data-admin-bundle="tournament-structure">\n${tournamentStructure}\n</script>`,
    'admin page'
  );
  admin = replaceRequired(
    admin,
    '<script src="/poker.js?v=20261024b"></script>',
    `<script data-admin-bundle="poker.js">\n${pokerJs}\n</script>`,
    'admin page'
  );

  const game = admin
    .replace('<title>antikpoker Constructor</title>', '<title>antikpoker Table</title>')
    .replace('<body>', `<body class="game-active server-game-route">
<style data-game-bootstrap>
  body.server-game-route > .bg-fixed,
  body.server-game-route > nav,
  body.server-game-route > .page { display:none!important; }
  body.server-game-route #gameRoom { display:flex!important; }
</style>`);

  let lobby = fs.readFileSync(path.join(PUBLIC_DIR, 'lobby.html'), 'utf8');
  lobby = replaceRequired(
    lobby,
    '<link href="/fonts.css?v=20261019b" rel="stylesheet">',
    `<style data-critical-fonts>\n${fonts}\n</style>`,
    'lobby page'
  );
  lobby = replaceRequired(
    lobby,
    '<script src="/realtime/socket.io.js?v=4.8.4"></script>',
    `<script data-lobby-bundle="socket.io">\n${socketClient}\n</script>`,
    'lobby page'
  );
  return { home, admin, game, lobby };
}

const criticalPages = buildCriticalPages();

function secureRequest(req) {
  return req.secure;
}

function adminToken(req) {
  return parseCookies(req.headers.cookie)[ADMIN_COOKIE] || '';
}

function hasAdminAccess(req) {
  if (!ADMIN_AUTH_REQUIRED) return true;
  if (!ADMIN_PASSWORD) return false;
  const token = adminToken(req);
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function safePasswordMatch(candidate) {
  const supplied = Buffer.from(String(candidate || ''), 'utf8');
  const expected = Buffer.from(ADMIN_PASSWORD, 'utf8');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function adminLoginAllowed(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const attempts = (adminLoginWindows.get(key) || []).filter(ts => now - ts < ADMIN_LOGIN_WINDOW_MS);
  adminLoginWindows.set(key, attempts);
  return attempts.length < ADMIN_LOGIN_LIMIT;
}

function recordAdminLoginFailure(ip) {
  const key = ip || 'unknown';
  const attempts = adminLoginWindows.get(key) || [];
  attempts.push(Date.now());
  adminLoginWindows.set(key, attempts);
}

function requireAdmin(req, res, next) {
  if (hasAdminAccess(req)) return next();
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin access is not configured' });
  return res.status(401).json({ error: 'Admin authentication required' });
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  const expected = `${secureRequest(req) ? 'https' : 'http'}://${req.get('host')}`;
  if (origin === expected) return next();
  return res.status(403).json({ error: 'Cross-origin request rejected' });
}

function cleanText(value, maxLength, fallback = '') {
  const text = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (text || fallback).slice(0, maxLength);
}

function cleanDescription(value, maxLength = 1200) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function cleanPlayerId(value) {
  const id = String(value || '');
  return /^[a-zA-Z0-9_-]{3,80}$/.test(id) ? id : null;
}

function numberInRange(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function cleanHexColor(value, fallback) {
  const color = String(value || '');
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

function validReactionDataUrl(value) {
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)) return false;
  const payload = value.slice(value.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor(payload.length * 3 / 4) - padding <= MAX_REACTION_BYTES;
}

function validReactionAssetUrl(value) {
  return typeof value === 'string'
    && /^\/uploads\/reactions\/[a-f0-9-]+\.(png|jpe?g|gif|webp)$/i.test(value);
}

function persistReactionAssets(input) {
  const cfg = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  if (!Array.isArray(cfg.customReactions)) return cfg;
  fs.mkdirSync(REACTION_UPLOAD_DIR, { recursive: true });
  cfg.customReactions = cfg.customReactions.slice(0, 8).map(value => {
    if (validReactionAssetUrl(value)) return value;
    if (!validReactionDataUrl(value)) return null;
    const match = /^data:image\/(png|jpeg|gif|webp);base64,(.+)$/i.exec(value);
    if (!match) return null;
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const filename = `${uuidv4()}.${ext}`;
    fs.writeFileSync(path.join(REACTION_UPLOAD_DIR, filename), Buffer.from(match[2], 'base64'));
    return `/uploads/reactions/${filename}`;
  }).filter(Boolean);
  return cfg;
}

function normalizeConfig(input) {
  const cfg = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  cfg.sb = LEVELS[0].sb;
  cfg.bb = LEVELS[0].bb;
  cfg.startStack = numberInRange(cfg.startStack, cfg.bb * 100, cfg.bb, 1_000_000);
  if (cfg.startStack < cfg.bb) cfg.startStack = cfg.bb;
  cfg.startStack = Math.round(cfg.startStack * 100) / 100;
  cfg.turnTimeSec = numberInRange(cfg.turnTimeSec, 30, 5, 180);
  cfg.tournamentSpeed = Object.hasOwn(PRESETS, cfg.tournamentSpeed)
    ? cfg.tournamentSpeed : 'HYPER_TURBO';
  cfg.levelDurationSec = PRESETS[cfg.tournamentSpeed];
  cfg.anteType = Object.values(ANTE_TYPES).includes(cfg.anteType)
    ? cfg.anteType : ANTE_TYPES.CLASSIC_ANTE;
  delete cfg.blindLevelMinutes;
  delete cfg.blindIncreasePercent;
  delete cfg.anteEnabled;
  cfg.maxPlayers = Number(cfg.maxPlayers) === 9 ? 9 : 6;
  cfg.maxEntrants = Math.round(numberInRange(cfg.maxEntrants, 90, cfg.maxPlayers, 2000));
  cfg.fillWithBots = cfg.fillWithBots === true;
  cfg.lobbyWaitSeconds = Math.round(numberInRange(cfg.lobbyWaitSeconds, 60, 10, 3600));
  cfg.brand = cleanText(cfg.brand, 32, '');
  cfg.launchMode = cfg.launchMode === 'scheduled' ? 'scheduled' : 'instant';
  const requestedBotCount = Number(cfg.tournamentBotCount);
  cfg.tournamentBotCount = cfg.launchMode === 'scheduled' && Number.isFinite(requestedBotCount)
    ? Math.round(Math.min(cfg.maxEntrants, Math.max(0, requestedBotCount)))
    : 0;
  cfg.tournamentTitle = cleanText(cfg.tournamentTitle, 80, '');
  cfg.tournamentDescription = cleanDescription(cfg.tournamentDescription);
  cfg.lateRegistrationMinutes = Math.round(numberInRange(cfg.lateRegistrationMinutes, 10, 0, 120));
  const scheduledAt = Date.parse(cfg.scheduledStartAt);
  cfg.scheduledStartAt = cfg.launchMode === 'scheduled' && Number.isFinite(scheduledAt)
    ? new Date(scheduledAt).toISOString()
    : null;
  cfg.seatingOpenMinutes = 5;
  cfg.roomBgC1 = cleanHexColor(cfg.roomBgC1, '#1c1c1c');
  cfg.roomBgC2 = cleanHexColor(cfg.roomBgC2, '#060606');
  cfg.roomBgAngle = numberInRange(cfg.roomBgAngle, 135, 0, 360);
  cfg.mobileLogoMode = cfg.mobileLogoMode === 'manual' ? 'manual' : 'auto';
  cfg.mobileLogoPos = ['top-left', 'top-center', 'top-right'].includes(cfg.mobileLogoPos)
    ? cfg.mobileLogoPos : 'top-left';
  cfg.mobileLogoSize = numberInRange(cfg.mobileLogoSize, 30, 16, 200);
  cfg.mobileLogoOffset = numberInRange(cfg.mobileLogoOffset, 8, 0, 150);
  cfg.mobileBrandFontSize = numberInRange(cfg.mobileBrandFontSize, 11, 8, 60);
  cfg.mobileFeltMode = cfg.mobileFeltMode === 'manual' ? 'manual' : 'auto';
  cfg.mobileFeltPhotoMode = cfg.mobileFeltPhotoMode === 'logo' ? 'logo' : 'fill';
  cfg.mobileFeltZoom = numberInRange(cfg.mobileFeltZoom, 130, 5, 200);
  cfg.mobileFeltOverlay = numberInRange(cfg.mobileFeltOverlay, 40, 0, 80);
  cfg.mobileFeltPanX = numberInRange(cfg.mobileFeltPanX, 0, -50, 50);
  cfg.mobileFeltPanY = numberInRange(cfg.mobileFeltPanY, 0, -50, 50);
  cfg.reactions = Array.isArray(cfg.reactions)
    ? cfg.reactions.slice(0, 32).map(v => cleanText(v, 16)).filter(Boolean)
    : [];
  cfg.customReactions = Array.isArray(cfg.customReactions)
    ? cfg.customReactions.slice(0, 8).filter(value => validReactionDataUrl(value) || validReactionAssetUrl(value))
    : [];
  // Existing rooms remain on the payload identity adapter until they expire.
  // Every room created after this release is explicitly upgraded to v2 below.
  cfg.identityVersion = Number(cfg.identityVersion) >= 2 ? 2 : 1;
  return cfg;
}

function playerIdFor(socket, config, claimedPlayerId) {
  return resolveRoomPlayerId(config, socket.data.serverPlayerId, cleanPlayerId(claimedPlayerId));
}

function publicLobbyPlayers(lobby) {
  return (lobby?.players || []).map(player => ({ name: player.name }));
}

function createRoomInstance(roomId, config, options = {}) {
  const tournamentId = options.tournamentId || config.tournamentId || roomId;
  config = normalizeConfig({ ...config, tournamentId });
  const manager = tournaments.get(tournamentId) || null;
  const snapshot = options.snapshot || (!manager && roomId === tournamentId ? db.getRoomState(roomId) : null);
  let tournamentClock = manager?.clock || tournamentClocks.get(tournamentId);
  if (!tournamentClock) {
    tournamentClock = new TournamentClock({
      durationSec: config.levelDurationSec,
      snapshot: snapshot?.tournamentClock
    });
    tournamentClocks.set(tournamentId, tournamentClock);
  }
  const tableNumber = Math.max(1, Number(options.tableNumber) || 1);
  const room = new PokerRoom(roomId, config, io, {
    snapshot,
    tournamentClock,
    tournamentMode: !!manager,
    tableNumber,
    canStartHand: tableId => manager ? manager.canStartHand(tableId) : true,
    onBetweenHands: tableId => manager ? manager.onTableBetweenHands(tableId) : true,
    resolveElimination: event => manager ? manager.resolveElimination(event) : null,
    getTournamentMeta: () => manager ? manager.getMetaForTable(roomId) : null,
    getTournamentPlayers: () => manager
      ? manager.getTournamentPlayers()
      : [...rooms.entries()]
        .filter(([otherId, otherRoom]) => otherId === roomId || otherRoom.tournamentId === tournamentId)
        .flatMap(([otherId, otherRoom]) => otherRoom.G.seats
          .map((seat, seatIdx) => seat && seat.stack > 0
            ? { roomId: otherId, seatIdx, stack: seat.stack }
            : null)
          .filter(Boolean)),
    onPersist: roomSnapshot => {
      try {
        if (manager) {
          const table = manager.getTable(roomId);
          db.saveTournamentTableState(
            tournamentId,
            roomId,
            table?.number || tableNumber,
            table?.status || TABLE_STATES.ACTIVE,
            roomSnapshot
          );
        } else {
          db.saveRoomState(roomId, roomSnapshot);
        }
      } catch (error) {
        console.error(`[Persistence] Failed to save table ${roomId}:`, error);
      }
    },
    onEliminated: ({ playerId, place }) => {
      if (!manager && playerId) db.markTournamentEliminated(tournamentId, playerId, place);
      const roomRecord = db.getRoom(tournamentId);
      if (roomRecord?.code) broadcastScheduledLobby(roomRecord.code);
    },
    onGameOver: () => {
      const roomRecord = db.getRoom(tournamentId);
      if (roomRecord?.code) broadcastScheduledLobby(roomRecord.code);
      const sockets = io.sockets.adapter.rooms.get(roomId);
      if (!manager && (!sockets || sockets.size === 0)) scheduleRoomCleanup(roomId);
    }
  });
  room.tournamentId = tournamentId;
  room.tableNumber = tableNumber;
  room.resumeAfterRestore();
  return room;
}

function createTournamentManager(tournamentId, rawConfig) {
  const existing = tournaments.get(tournamentId);
  if (existing) return existing;
  const config = normalizeConfig({ ...rawConfig, tournamentId });
  const managerSnapshot = db.getTournamentState(tournamentId);
  let tournamentClock = tournamentClocks.get(tournamentId);
  if (!tournamentClock) {
    tournamentClock = new TournamentClock({
      durationSec: config.levelDurationSec,
      snapshot: managerSnapshot?.tournamentClock
    });
    tournamentClocks.set(tournamentId, tournamentClock);
  }
  let manager;
  manager = new TournamentManager({
    id: tournamentId,
    config,
    io,
    clock: tournamentClock,
    snapshot: managerSnapshot,
    createTable: ({ tableId, tableNumber }) => {
      const saved = db.listTournamentTableStates(tournamentId)
        .find(table => table.table_id === tableId);
      const room = createRoomInstance(tableId, config, {
        tournamentId,
        tableNumber,
        snapshot: saved?.state || (tableId === tournamentId ? db.getRoomState(tournamentId) : null)
      });
      rooms.set(tableId, room);
      return room;
    },
    closeTable: (tableId, table) => {
      table.room.dispose();
      rooms.delete(tableId);
      db.deleteTournamentTableState(tournamentId, tableId);
    },
    saveState: (id, state) => db.saveTournamentState(id, state),
    assignPlayer: (id, playerId, tableId, seatIdx, stack, moved) =>
      db.markTournamentSeated(id, playerId, tableId, seatIdx, stack, moved),
    prepareMove: move => db.prepareTournamentMove(move),
    commitMove: (id, moveId, tableId, seatIdx, stack) =>
      db.commitTournamentMove(id, moveId, tableId, seatIdx, stack),
    resolveMove: (id, moveId, status) => db.resolveTournamentMove(id, moveId, status),
    setPlayerPending: (id, playerId, stack) => db.setTournamentPlayerPending(id, playerId, stack),
    markEliminated: (id, playerId, place) => db.markTournamentEliminated(id, playerId, place),
    markWinner: (id, playerId, stack) => db.markTournamentWinner(id, playerId, stack),
    isRegistrationClosed: () => Date.now() >= lateRegistrationClosesAt(config),
    registrationClosesAt: lateRegistrationClosesAt(config),
    onChanged: () => {
      const record = db.getRoom(tournamentId);
      if (record?.code) broadcastScheduledLobby(record.code);
      if (manager?.status === 'FINISHED') {
        const finalTable = manager.activeTables()[0];
        if (finalTable) scheduleRoomCleanup(finalTable.id);
      }
    },
    onPlayerMoved: event => {
      const destination = {
        eventId: event.moveId,
        tournamentId,
        roomId: tournamentId,
        tableId: event.toTableId,
        tableNumber: event.tableNumber,
        seatIdx: event.seatIdx
      };
      const recipients = new Set(event.socketId ? [event.socketId] : []);
      for (const connectedSocket of io.sockets.sockets.values()) {
        if (connectedSocket.data.tournamentId === tournamentId
          && connectedSocket.data.tournamentPlayerId === event.accountPlayerId) {
          recipients.add(connectedSocket.id);
        }
      }
      for (const socketId of recipients) io.to(socketId).emit('tournament_player_moved', destination);
    }
  });
  tournaments.set(tournamentId, manager);

  const savedTables = db.listTournamentTableStates(tournamentId);
  if (savedTables.length) {
    for (const saved of savedTables) {
      if (saved.status === TABLE_STATES.CLOSED) continue;
      const room = createRoomInstance(saved.table_id, config, {
        tournamentId,
        tableNumber: saved.table_no,
        snapshot: saved.state
      });
      rooms.set(saved.table_id, room);
      manager.addRestoredTable({
        tableId: saved.table_id,
        tableNumber: saved.table_no,
        // Pending balancing plans are intentionally rebuilt after a restart.
        status: TABLE_STATES.ACTIVE,
        room
      });
    }
  } else {
    manager.ensureTable(1);
  }
  manager.syncRegistrations(db.listTournamentRegistrations(tournamentId));
  const recoveredMoves = manager.recoverPendingMoves(db.listPendingTournamentMoves(tournamentId));
  if (Object.values(recoveredMoves).some(Boolean)) {
    console.log(`[Restore] Tournament ${tournamentId} move recovery`, recoveredMoves);
  }
  scheduleScheduledTournament(manager);
  return manager;
}

function isScheduledRoom(dbRoomOrConfig) {
  const config = dbRoomOrConfig?.config || dbRoomOrConfig;
  return config?.launchMode === 'scheduled' && Number.isFinite(Date.parse(config.scheduledStartAt));
}

function lateRegistrationClosesAt(config) {
  return Date.parse(config.scheduledStartAt) + Number(config.lateRegistrationMinutes || 0) * 60_000;
}

function ensureTournamentSeat(room, registration, preferredSeat = null) {
  if (!room || !registration || registration.status !== 'ACTIVE' || room.gameOver) return -1;
  const manager = tournaments.get(room.tournamentId || room.id);
  if (manager) {
    const seated = manager.seatRegistration(registration);
    return seated ? seated.seatIdx : -1;
  }
  const existingSeat = room.players.get(registration.player_id);
  if (existingSeat !== undefined) return existingSeat;

  const candidates = [registration.seat_idx, preferredSeat]
    .map(Number)
    .filter(idx => Number.isInteger(idx) && idx >= 0 && idx < room.maxPlayers);
  let seatIdx = candidates.find(idx => !room.G.seats[idx]);
  if (seatIdx === undefined) seatIdx = room.G.seats.findIndex(seat => !seat);
  if (seatIdx < 0) return -1;

  const added = room.addPlayer(seatIdx, {
    id: null,
    playerId: registration.player_id,
    name: registration.name,
    flag: '🏳️',
    avatar: seatIdx % 6,
    connected: false,
    sittingOut: true
  });
  if (!added) return -1;
  db.markTournamentSeated(room.id, registration.player_id, room.id, seatIdx, room.G.seats[seatIdx].stack);
  return seatIdx;
}

function scheduledLobbyPayload(dbRoom, playerId) {
  const config = normalizeConfig(dbRoom.config);
  const registrations = db.listTournamentRegistrations(dbRoom.id);
  const manager = tournaments.get(dbRoom.id);
  const persistedTournament = manager ? null : db.getTournamentState(dbRoom.id);
  const liveRoom = rooms.get(manager?.resolveTableForPlayer(playerId) || dbRoom.id);
  const mtt = manager?.publicState() || null;
  const now = Date.now();
  const startAt = Date.parse(config.scheduledStartAt);
  const seatingOpensAt = startAt - SCHEDULED_SEATING_MS;
  const registrationClosesAt = lateRegistrationClosesAt(config);
  const registration = playerId
    ? registrations.find(player => player.player_id === playerId)
    : null;
  const activeRegistrations = registrations.filter(player => player.status === 'ACTIVE');
  const winnerRegistration = registrations.find(player => player.status === 'WINNER') || null;
  const tournamentFinished = manager?.status === 'FINISHED'
    || persistedTournament?.status === 'FINISHED'
    || liveRoom?.gameOver;
  const gameRunning = !tournamentFinished && (
    manager?.status === 'RUNNING'
    || persistedTournament?.status === 'RUNNING'
    || (!!liveRoom && liveRoom.G.handNum > 0)
  );
  const registrationOpen = !tournamentFinished && now < registrationClosesAt
    && activeRegistrations.length < config.maxEntrants;
  return {
    roomId: dbRoom.id,
    code: dbRoom.code,
    title: config.tournamentTitle || dbRoom.brand || 'Турнир',
    description: config.tournamentDescription || '',
    startAt,
    seatingOpensAt,
    registrationClosesAt,
    lateRegistrationMinutes: config.lateRegistrationMinutes,
    serverNow: now,
    status: tournamentFinished ? 'finished' : gameRunning ? 'running' : now >= startAt ? 'starting' : now >= seatingOpensAt ? 'seating' : 'scheduled',
    registered: !!registration,
    playerStatus: registration?.status || null,
    eliminatedPlace: registration?.eliminated_place || null,
    seatIdx: registration?.seat_idx ?? null,
    registrationOpen,
    canTakeSeat: registration?.status === 'ACTIVE' && now >= seatingOpensAt && !tournamentFinished,
    maxPlayers: config.maxPlayers,
    maxEntrants: config.maxEntrants,
    activeRegistrations: activeRegistrations.length,
    playersRemaining: tournamentFinished ? (winnerRegistration ? 1 : 0) : (mtt?.playersRemaining ?? activeRegistrations.length),
    activeTables: tournamentFinished ? 0 : (mtt?.activeTables ?? (activeRegistrations.length ? 1 : 0)),
    finalTable: !!(mtt?.finalTable || persistedTournament?.finalTable),
    winnerName: mtt?.winnerName || winnerRegistration?.name || null,
    finishedAt: mtt?.finishedAt || persistedTournament?.finishedAt || null,
    clock: tournamentFinished ? null : (mtt?.clock || null),
    tables: tournamentFinished ? [] : (mtt?.tables || []),
    registrations: registrations.map(player => ({
      name: player.name,
      status: player.status,
      seatIdx: player.seat_idx,
      tableId: player.table_id,
      tableNumber: tournamentFinished ? null : (manager?.getTable(player.table_id)?.number || null),
      stack: player.stack,
      eliminatedPlace: player.eliminated_place,
      isBot: player.is_bot === 1,
      isYou: !!playerId && player.player_id === playerId,
      registeredAt: player.registered_at
    })),
    structure: {
      speed: config.tournamentSpeed,
      levelDurationSec: config.levelDurationSec,
      anteType: config.anteType,
      startStack: config.startStack,
      levels: LEVELS.map(level => ({ level: level.level, sb: level.sb, bb: level.bb, ante: level.ante }))
    }
  };
}

function emitScheduledLobbyState(socket, dbRoom, playerId) {
  socket.emit('scheduledLobbyState', scheduledLobbyPayload(dbRoom, playerId));
}

function broadcastScheduledLobby(code) {
  const dbRoom = db.getRoomByCode(code);
  if (!dbRoom || !isScheduledRoom(dbRoom)) return;
  const socketIds = io.sockets.adapter.rooms.get(`lobby:${code}`) || [];
  for (const socketId of socketIds) {
    const client = io.sockets.sockets.get(socketId);
    if (client) emitScheduledLobbyState(client, dbRoom, client.data.lobbyPlayerId || null);
  }
}

function activateScheduledTournament(manager) {
  if (!manager || manager.disposed || !isScheduledRoom(manager.config)) return;
  const startAt = Date.parse(manager.config.scheduledStartAt);
  if (Date.now() + 25 < startAt) return scheduleScheduledTournament(manager);
  const registrations = db.listTournamentRegistrations(manager.id)
    .filter(registration => registration.status === 'ACTIVE');
  manager.start(registrations, startAt);
  const roomRecord = db.getRoom(manager.id);
  if (roomRecord?.code) broadcastScheduledLobby(roomRecord.code);
}

function scheduleScheduledTournament(manager) {
  clearTimeout(manager?._scheduledStartTimer);
  if (!manager || manager.disposed || !isScheduledRoom(manager.config)) return;
  const arm = () => {
    if (manager.disposed) return;
    const remaining = Date.parse(manager.config.scheduledStartAt) - Date.now();
    if (remaining <= 25) return activateScheduledTournament(manager);
    manager._scheduledStartTimer = setTimeout(arm, Math.min(remaining, MAX_SCHEDULE_DELAY_MS));
  };
  arm();
}

function roomCreationAllowed(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const recent = (roomCreateWindows.get(key) || []).filter(ts => now - ts < 60 * 60 * 1000);
  if (recent.length >= ROOM_CREATE_LIMIT) return false;
  recent.push(now);
  roomCreateWindows.set(key, recent);
  return true;
}

function scheduleRoomCleanup(roomId) {
  if (!roomId) return;
  const activeRoom = rooms.get(roomId);
  const tournamentId = activeRoom?.tournamentId;
  const manager = tournamentId ? tournaments.get(tournamentId) : null;
  if (manager && manager.status !== 'FINISHED') return;
  const cleanupKey = manager ? `tournament:${tournamentId}` : roomId;
  if (manager) {
    const hasSockets = manager.activeTables().some(table => {
      const clients = io.sockets.adapter.rooms.get(table.id);
      return clients && clients.size > 0;
    });
    const delay = hasSockets ? FINISHED_TOURNAMENT_CLEANUP_MS : 0;
    const pending = roomCleanups.get(cleanupKey);
    if (pending && delay > 0) return;
    if (pending) {
      clearTimeout(pending);
      roomCleanups.delete(cleanupKey);
    }
    roomCleanups.set(cleanupKey, setTimeout(() => {
      roomCleanups.delete(cleanupKey);
      const liveManager = tournaments.get(tournamentId);
      if (!liveManager || liveManager.status !== 'FINISHED') return;
      const lobbyCode = db.getRoom(tournamentId)?.code || null;
      const tables = liveManager.activeTables();
      for (const table of tables) {
        const socketIds = [...(io.sockets.adapter.rooms.get(table.id) || [])];
        for (const socketId of socketIds) {
          const client = io.sockets.sockets.get(socketId);
          client?.emit('tournament_table_expired', { tournamentId, lobbyCode });
          client?.leave(table.id);
        }
        table.room.dispose();
        rooms.delete(table.id);
        db.deleteTournamentTableState(tournamentId, table.id);
      }
      liveManager.dispose();
      tournaments.delete(tournamentId);
      tournamentClocks.get(tournamentId)?.dispose();
      tournamentClocks.delete(tournamentId);
      console.log(`[Cleanup] Finished tournament ${tournamentId} tables closed`);
    }, delay));
    return;
  }
  if (roomCleanups.has(cleanupKey)) return;
  roomCleanups.set(cleanupKey, setTimeout(() => {
    roomCleanups.delete(cleanupKey);
    const sockets = io.sockets.adapter.rooms.get(roomId);
    if (sockets && sockets.size > 0) return;
    const room = rooms.get(roomId);
    if (room) {
      const tournamentId = room.tournamentId || roomId;
      room.dispose();
      rooms.delete(roomId);
      const stillUsed = [...rooms.values()].some(other => other.tournamentId === tournamentId);
      if (!stillUsed) {
        tournamentClocks.get(tournamentId)?.dispose();
        tournamentClocks.delete(tournamentId);
      }
    }
    lobbySeats.delete(roomId);
    console.log(`[Cleanup] Room ${roomId} removed from memory`);
  }, ROOM_CLEANUP_MS));
}

function cancelRoomCleanup(roomId) {
  const t = roomCleanups.get(roomId);
  if (t) { clearTimeout(t); roomCleanups.delete(roomId); }
}

function _startLobbyGame(code, roomId) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  const maxPlayers = lobby.maxPlayers || rooms.get(roomId)?.maxPlayers || 6;

  // Assign seat indices in order
  const seatAssignments = [];
  let seatIdx = 0;
  for (const p of lobby.players) {
    if (seatIdx >= maxPlayers) break;
    seatAssignments.push({ socketId: p.id, playerId: p.playerId, seatIdx, name: p.name, flag: p.flag || '🏳️' });
    seatIdx++;
  }

  // Save assignments for when players arrive at the room
  const assignMap = new Map();
  for (const sa of seatAssignments) {
    assignMap.set(sa.playerId || sa.socketId, sa);
  }
  lobbySeats.set(roomId, assignMap);

  // Notify each client of their assigned seat
  for (const sa of seatAssignments) {
    io.to(sa.socketId).emit('lobbyStart', { roomId, seatIdx: sa.seatIdx, name: sa.name });
  }
  lobbies.delete(code);
}

// Middleware
app.use((req, res, next) => {
  if (REQUIRE_HTTPS && !secureRequest(req)) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
    }
    return res.status(426).json({ error: 'HTTPS required' });
  }
  if (secureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  let playerId = playerIdentity.fromCookieHeader(req.headers.cookie);
  if (!playerId) {
    const session = playerIdentity.createSession();
    playerId = session.playerId;
    res.append('Set-Cookie', playerIdentity.serialize(session.token, { secure: secureRequest(req) }));
  }
  req.playerId = playerId;
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// Explicit CSP
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", 
    "default-src 'self' data: blob:; " +
    "img-src * data: blob:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; " +
    "script-src 'self' 'unsafe-inline'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none';");
  next();
});

app.get('/api/admin/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ enabled: !!ADMIN_PASSWORD, authenticated: hasAdminAccess(req) });
});

app.get('/api/player/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ authenticated: !!req.playerId });
});

app.post('/api/admin/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin access is not configured' });
  if (!adminLoginAllowed(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  if (!safePasswordMatch(req.body?.password)) {
    recordAdminLoginFailure(req.ip);
    return res.status(401).json({ error: 'Incorrect password' });
  }

  adminLoginWindows.delete(req.ip || 'unknown');
  const token = crypto.randomBytes(32).toString('base64url');
  adminSessions.set(token, Date.now() + ADMIN_SESSION_MS);
  const secure = secureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ADMIN_SESSION_MS / 1000)}${secure}`);
  res.json({ success: true });
});

app.post('/api/admin/logout', requireSameOrigin, (req, res) => {
  const token = adminToken(req);
  if (token) adminSessions.delete(token);
  const secure = secureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  res.json({ success: true });
});

// Root route
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(criticalPages.home);
});

app.get(['/admin', '/admin/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(hasAdminAccess(req) ? criticalPages.admin : criticalPages.home);
});

app.get('/poker.html', (req, res) => {
  res.redirect(hasAdminAccess(req) ? '/admin' : '/');
});

app.use('/uploads', express.static(path.join(__dirname, '../public/uploads'), {
  index: false,
  maxAge: '30d',
  immutable: true
}));
app.use('/effects', express.static(path.join(__dirname, '../public/effects'), {
  index: false,
  maxAge: '30d',
  immutable: true
}));
app.use('/sounds', express.static(path.join(__dirname, '../public/sounds'), {
  index: false,
  maxAge: '30d',
  immutable: true
}));
app.use(express.static(path.join(__dirname, '../public'), { index: false, maxAge: '1h' }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: Math.floor(process.uptime()) });
});

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../public/uploads'));
  },
  filename: (req, file, cb) => {
    const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
    const ext = extensions[file.mimetype];
    if (!ext) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)),
  limits: { fileSize: MAX_IMAGE_BYTES, fieldSize: 40 * 1024 * 1024, files: 2, fields: 4, parts: 6 }
});

// --- API Endpoints ---

app.post('/api/rooms', requireSameOrigin, requireAdmin, (req, res, next) => {
  if (!roomCreationAllowed(req.ip)) return res.status(429).json({ error: 'Too many rooms created. Try again later.' });
  upload.fields([{ name: 'felt', maxCount: 1 }, { name: 'logo', maxCount: 1 }])(req, res, next);
}, (req, res) => {
  try {
    const config = normalizeConfig(persistReactionAssets(JSON.parse(req.body.config || '{}')));
    config.identityVersion = 2;
    if (config.launchMode === 'scheduled') {
      const startAt = Date.parse(config.scheduledStartAt);
      if (!Number.isFinite(startAt) || startAt < Date.now() + 60_000) {
        const error = new Error('Выберите время начала минимум через одну минуту');
        error.statusCode = 400;
        throw error;
      }
    }
    const brand = cleanText(req.body.brand ?? config.brand, 32, '');
    const roomId = uuidv4();
    config.tournamentId = roomId;
    
    let feltUrl = null;
    let logoUrl = null;
    
    if (req.files?.felt) feltUrl = `/uploads/${req.files.felt[0].filename}`;
    if (req.files?.logo) logoUrl = `/uploads/${req.files.logo[0].filename}`;
    
    config.feltPhotoUrl = feltUrl;
    config.logoUrl = logoUrl;

    const code = db.saveRoom(roomId, brand, config, feltUrl, logoUrl);
    
    // MTT coordination is enabled only for scheduled tournaments. Instant rooms
    // retain the original single-table lifecycle.
    if (config.launchMode === 'scheduled') {
      db.ensureTournamentBots(roomId, config.tournamentBotCount, config.startStack);
      createTournamentManager(roomId, config);
    } else {
      const room = createRoomInstance(roomId, config);
      rooms.set(roomId, room);
      room.broadcastState();
    }

    // Instant rooms keep a configurable countdown. Scheduled tournaments use
    // persistent registrations and their absolute server start time instead.
    if (config.launchMode !== 'scheduled') {
      const totalSeconds = config.lobbyWaitSeconds;
      let secondsLeft = totalSeconds;
      const lobbyTimer = setInterval(() => {
        secondsLeft--;
        const lobby = lobbies.get(code);
        if (!lobby) { clearInterval(lobbyTimer); return; }
        lobby.secondsLeft = secondsLeft;
        io.to(`lobby:${code}`).emit('lobbyTick', {
          secondsLeft,
          totalSeconds: lobby.totalSeconds,
          players: publicLobbyPlayers(lobby),
          maxPlayers: lobby.maxPlayers
        });
        if (secondsLeft <= 0) {
          clearInterval(lobbyTimer);
          lobby.started = true;
          _startLobbyGame(code, roomId);
        }
      }, 1000);

      lobbies.set(code, {
        roomId,
        players: [],
        timer: lobbyTimer,
        secondsLeft: totalSeconds,
        totalSeconds,
        started: false,
        maxPlayers: config.maxPlayers
      });
    }
    
    res.json({ success: true, roomId, code, launchMode: config.launchMode, scheduledStartAt: config.scheduledStartAt });
  } catch (error) {
    console.error('Error creating room:', error);
    for (const files of Object.values(req.files || {})) {
      for (const file of files) fs.unlink(file.path, () => {});
    }
    res.status(error.statusCode || (error instanceof SyntaxError ? 400 : 500)).json({
      error: error.statusCode ? error.message : (error instanceof SyntaxError ? 'Invalid room configuration' : 'Failed to create room')
    });
  }
});

app.get('/api/rooms/:id', (req, res) => {
  const room = db.getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

// Look up room by short code
app.get('/api/code/:code', (req, res) => {
  const room = db.getRoomByCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ roomId: room.id, code: room.code });
});

// Lobby page
app.get('/lobby/:code', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(criticalPages.lobby);
});

app.get('/r/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(criticalPages.game);
});

// --- Socket.io ---
io.use((socket, next) => {
  socket.data.serverPlayerId = playerIdentity.fromCookieHeader(socket.handshake.headers.cookie)
    || playerIdentity.verify(socket.handshake.auth?.playerSessionToken)
    || crypto.randomUUID();
  next();
});

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentSeatIdx = -1;

  socket.on('clockSync', (clientSentAt, acknowledge) => {
    if (typeof acknowledge === 'function') acknowledge({ clientSentAt, serverNow: Date.now() });
  });

  // --- Lobby events ---
  socket.on('joinLobby', ({ code, name, playerId } = {}) => {
    const codeUp = code?.toUpperCase();
    const lobby = lobbies.get(codeUp);
    const dbRoom = codeUp ? db.getRoomByCode(codeUp) : null;
    if (!dbRoom) return socket.emit('lobbyError', 'Лобби не найдено или уже закрыто');
    const safePlayerId = playerIdFor(socket, dbRoom.config, playerId);
    if (isScheduledRoom(dbRoom)) {
      if (!tournaments.has(dbRoom.id)) createTournamentManager(dbRoom.id, dbRoom.config);
      socket.join(`lobby:${codeUp}`);
      socket.data.lobbyCode = codeUp;
      socket.data.lobbyPlayerId = safePlayerId;
      emitScheduledLobbyState(socket, dbRoom, safePlayerId);
      return;
    }
    if (!cleanText(name, 18, '')) return socket.emit('lobbyNeedsName', { code: codeUp });
    let liveRoom = dbRoom ? rooms.get(dbRoom.id) : null;
    if (!liveRoom && dbRoom && db.getRoomState(dbRoom.id)) {
      liveRoom = createRoomInstance(dbRoom.id, dbRoom.config);
      rooms.set(dbRoom.id, liveRoom);
    }
    // Игра за столом уже идёт (сели напрямую, минуя лобби) или лобби закрыто —
    // вместо обратного отсчёта показываем состояние идущей игры
    const gameRunning = liveRoom && (liveRoom.G.handNum > 0 || liveRoom.gameOver);
    if (!lobby || lobby.started || gameRunning) {
      // Игра стартовала в обход лобби — обратный отсчёт больше не нужен
      if (gameRunning && lobby && !lobby.started) {
        clearInterval(lobby.timer);
        lobbies.delete(codeUp);
      }
      if (dbRoom) {
        const seats = liveRoom ? liveRoom.G.seats.filter(Boolean) : [];
        return socket.emit('lobbyInProgress', {
          roomId: dbRoom.id,
          players: seats.map(s => ({
            name: s.name,
            stack: s.stack,
            connected: s.isBot ? true : !!s.connected
          })),
          handNum: liveRoom ? liveRoom.G.handNum : 0,
          gameOver: liveRoom ? liveRoom.gameOver : false,
          totalEntrants: liveRoom ? liveRoom.totalEntrants : 0,
          maxPlayers: liveRoom?.maxPlayers || Number(dbRoom.config?.maxPlayers) || 6,
          tables: 1
        });
      }
      return socket.emit('lobbyError', 'Лобби не найдено или уже закрыто');
    }

    socket.join(`lobby:${codeUp}`);
    socket.data.lobbyCode = codeUp;
    socket.data.lobbyPlayerId = safePlayerId;
    socket.data.lobbyName = cleanText(name, 18, 'Player');

    // Same player rejoining (e.g. page refresh) replaces their old entry
    if (safePlayerId) {
      lobby.players = lobby.players.filter(p => p.playerId !== safePlayerId);
    }
    if (!lobby.players.find(p => p.id === socket.id)) {
      lobby.players.push({ id: socket.id, playerId: safePlayerId, name: socket.data.lobbyName });
    }

    // The configured countdown is authoritative, even when the table fills.
    const maxPlayers = lobby.maxPlayers || liveRoom?.maxPlayers || Number(dbRoom?.config?.maxPlayers) || 6;

    socket.emit('lobbyJoined', {
      roomId: lobby.roomId,
      secondsLeft: lobby.secondsLeft,
      totalSeconds: lobby.totalSeconds,
      players: publicLobbyPlayers(lobby),
      maxPlayers
    });
    io.to(`lobby:${codeUp}`).emit('lobbyTick', {
      secondsLeft: lobby.secondsLeft,
      totalSeconds: lobby.totalSeconds,
      players: publicLobbyPlayers(lobby),
      maxPlayers
    });
  });

  socket.on('registerTournament', ({ code, name, playerId } = {}) => {
    const codeUp = cleanText(code, 8).toUpperCase();
    const dbRoom = db.getRoomByCode(codeUp);
    const safePlayerId = dbRoom ? playerIdFor(socket, dbRoom.config, playerId) : null;
    const safeName = cleanText(name, 18, '');
    if (!dbRoom || !isScheduledRoom(dbRoom)) {
      return socket.emit('tournamentRegistrationError', 'Турнир не найден');
    }
    if (!safePlayerId || !safeName) {
      return socket.emit('tournamentRegistrationError', 'Введите ник для регистрации');
    }
    const config = normalizeConfig(dbRoom.config);
    const manager = tournaments.get(dbRoom.id) || createTournamentManager(dbRoom.id, config);
    const existing = db.getTournamentRegistration(dbRoom.id, safePlayerId);
    if (existing && existing.status !== 'ACTIVE') {
      const message = existing.status === 'WINNER'
        ? 'Турнир уже завершён'
        : 'Вы уже выбыли из этого турнира';
      return socket.emit('tournamentRegistrationError', message);
    }
    if (!existing && (manager.status === 'FINISHED' || Date.now() >= lateRegistrationClosesAt(config))) {
      return socket.emit('tournamentRegistrationError', 'Поздняя регистрация уже закрыта');
    }
    try {
      const registration = db.registerTournamentPlayer(
        dbRoom.id,
        safePlayerId,
        safeName,
        config.maxEntrants,
        config.startStack
      );
      socket.data.lobbyPlayerId = safePlayerId;
      socket.data.lobbyName = safeName;
      manager.register(registration);
      socket.join(`lobby:${codeUp}`);
      socket.join(`tournament:${dbRoom.id}`);
      socket.data.lobbyCode = codeUp;
      broadcastScheduledLobby(codeUp);
    } catch (error) {
      const message = error.code === 'TOURNAMENT_FULL'
        ? 'Все места за столом уже заняты'
        : error.code === 'TOURNAMENT_FINISHED'
          ? 'Турнир уже завершён'
        : error.code === 'ALREADY_ELIMINATED'
          ? 'Вы уже выбыли из этого турнира'
          : 'Не удалось зарегистрироваться';
      socket.emit('tournamentRegistrationError', message);
    }
  });

  socket.on('claimTournamentSeat', ({ code, playerId } = {}) => {
    const codeUp = cleanText(code, 8).toUpperCase();
    const dbRoom = db.getRoomByCode(codeUp);
    const safePlayerId = dbRoom ? playerIdFor(socket, dbRoom.config, playerId) : null;
    if (!dbRoom || !isScheduledRoom(dbRoom) || !safePlayerId) {
      return socket.emit('tournamentSeatError', 'Турнир не найден');
    }
    const startAt = Date.parse(dbRoom.config.scheduledStartAt);
    if (Date.now() < startAt - SCHEDULED_SEATING_MS) {
      return socket.emit('tournamentSeatError', 'Посадка откроется за 5 минут до начала');
    }
    const registration = db.getTournamentRegistration(dbRoom.id, safePlayerId);
    if (!registration) {
      return socket.emit('tournamentSeatError', 'Сначала зарегистрируйтесь в турнире');
    }
    if (registration.status !== 'ACTIVE') {
      const message = registration.status === 'WINNER'
        ? 'Турнир уже завершён'
        : 'Вы уже выбыли из этого турнира';
      return socket.emit('tournamentSeatError', message);
    }
    const manager = tournaments.get(dbRoom.id) || createTournamentManager(dbRoom.id, dbRoom.config);
    if (manager.status === 'FINISHED') {
      return socket.emit('tournamentSeatError', 'Турнир уже завершён');
    }
    const seated = manager.seatRegistration(registration);
    const pendingTableId = manager.resolveTableForPlayer(safePlayerId);
    if (!seated && !pendingTableId) return socket.emit('tournamentSeatError', 'Не удалось открыть турнирный стол');
    const tableId = seated?.tableId || pendingTableId;
    socket.data.tournamentPlayerId = safePlayerId;
    socket.join(`tournament:${dbRoom.id}`);
    socket.emit('lobbyStart', {
      roomId: dbRoom.id,
      tableId,
      tableNumber: manager.getTable(tableId)?.number || 1,
      seatIdx: seated?.seatIdx ?? -1,
      name: registration.name,
      pending: !seated,
      waitHands: !seated ? 1 : 0
    });
  });

  socket.on('joinRoom', (payload) => {
    const requestedRoomId = typeof payload === 'string' ? payload : payload?.roomId;
    const claimedPlayerId = (payload && typeof payload === 'object') ? payload.playerId : null;
    if (!requestedRoomId) return;

    const directlyRequestedRoom = rooms.get(requestedRoomId);
    const derivedTournamentId = directlyRequestedRoom?.tournamentId
      || String(requestedRoomId).replace(/--table-\d+$/, '');
    let manager = tournaments.get(requestedRoomId)
      || tournaments.get(directlyRequestedRoom?.tournamentId)
      || tournaments.get(derivedTournamentId)
      || null;
    let dbRoom = db.getRoom(manager?.id || requestedRoomId)
      || (derivedTournamentId !== requestedRoomId ? db.getRoom(derivedTournamentId) : null);
    const persistedTournament = dbRoom && isScheduledRoom(dbRoom)
      ? db.getTournamentState(dbRoom.id)
      : null;
    const identityConfig = manager?.config || directlyRequestedRoom?.config || dbRoom?.config || {};
    const playerId = playerIdFor(socket, identityConfig, claimedPlayerId);

    // A terminal MTT is a lobby/results resource, never a live table. This guard
    // also covers old secondary-table URLs after their in-memory rooms are gone.
    if (dbRoom && isScheduledRoom(dbRoom)
      && (manager?.status === 'FINISHED' || persistedTournament?.status === 'FINISHED')) {
      const registrations = db.listTournamentRegistrations(dbRoom.id);
      const participant = registrations.find(entry => entry.player_id === playerId) || null;
      const winner = registrations.find(entry => entry.status === 'WINNER') || null;
      socket.emit('tournament_table_finished', {
        tournamentId: dbRoom.id,
        lobbyCode: dbRoom.code,
        winnerName: winner?.name || null,
        total: registrations.length,
        playerStatus: participant?.status || null,
        eliminatedPlace: participant?.eliminated_place || null
      });
      return;
    }
    if (dbRoom && isScheduledRoom(dbRoom)) {
      manager = manager || createTournamentManager(dbRoom.id, dbRoom.config);
    }
    const assignedPlayer = manager?.getPlayer(playerId);
    let roomId = manager
      ? (assignedPlayer?.tableId || (requestedRoomId === manager.id
        ? manager.resolveTableForPlayer(null)
        : requestedRoomId))
      : requestedRoomId;
    let room = rooms.get(roomId);
    if (!room) {
      dbRoom = dbRoom || db.getRoom(roomId);
      if (dbRoom) {
        room = createRoomInstance(roomId, dbRoom.config);
        rooms.set(roomId, room);
      } else {
        return socket.emit('error', 'Room not found');
      }
    }

    if (currentRoomId && currentRoomId !== roomId) socket.leave(currentRoomId);
    currentRoomId = roomId;
    currentSeatIdx = -1;
    socket.data.currentRoomId = roomId;
    socket.data.tournamentId = manager?.id || null;
    socket.data.tournamentPlayerId = manager ? playerId : null;
    socket.join(roomId);
    if (manager) socket.join(`tournament:${manager.id}`);
    cancelRoomCleanup(roomId);
    socket.emit('roomConfig', {
      ...room.config,
      roomId,
      rootRoomId: manager?.id || roomId,
      lobbyCode: manager ? dbRoom?.code || null : null,
      tableNumber: room.tableNumber || 1,
      tournamentMode: !!manager,
      tournamentStatus: manager?.status || null,
      participationStatus: assignedPlayer?.status || null,
      eliminatedPlace: assignedPlayer?.eliminatedPlace || null,
      pendingTournamentEntry: !!(manager && assignedPlayer?.status === 'ACTIVE' && !assignedPlayer.tableId)
    });
    socket.emit('chatHistory', room.chatMessages || []);

    // Returning player (refresh / network drop) — re-attach to reserved seat
    const canReconnectSeat = !manager || assignedPlayer?.status === 'ACTIVE';
    const reconnectedSeat = canReconnectSeat ? room.reconnectPlayer(playerId, socket.id) : -1;
    if (reconnectedSeat >= 0) {
      currentSeatIdx = reconnectedSeat;
      socket.emit('autoSeated', { seatIdx: reconnectedSeat, name: room.G.seats[reconnectedSeat].name });
      console.log(`[Room] Reconnected ${room.G.seats[reconnectedSeat].name} to seat ${reconnectedSeat} in table ${roomId}`);
    } else {
      // Check if this player has a pre-assigned seat from the lobby
      const assignMap = manager ? null : lobbySeats.get(roomId);
      const assignKey = playerId || socket.id;
      if (assignMap && assignMap.has(assignKey)) {
        const sa = assignMap.get(assignKey);
        const success = room.addPlayer(sa.seatIdx, {
          id: socket.id,
          playerId: playerId || null,
          name: sa.name,
          flag: sa.flag || '🏳️',
          avatar: sa.seatIdx % 6
        });
        if (success) {
          room.sockets.set(socket.id, sa.seatIdx);
          currentSeatIdx = sa.seatIdx;
          socket.emit('autoSeated', { seatIdx: sa.seatIdx, name: sa.name });
          console.log(`[Lobby] Auto-seated ${sa.name} at seat ${sa.seatIdx} in room ${roomId}`);
        }
        assignMap.delete(assignKey);
        if (success && room.config.fillWithBots) {
          const reservedSeats = new Set([...assignMap.values()].map(item => item.seatIdx));
          room.fillWithBots(reservedSeats);
        }
        if (assignMap.size === 0) lobbySeats.delete(roomId);
      }
    }

    room.broadcastState();
  });

  socket.on('sitAtTable', ({ seatIdx, name, flag, avatarIdx, playerId } = {}) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (currentSeatIdx !== -1) return;

    // Player already has a seat in this room (another tab / lost socket) — re-attach
    const safePlayerId = playerIdFor(socket, room.config, playerId);
    let requestedSeatIdx = seatIdx;
    if (isScheduledRoom(room.config)) {
      const tournamentId = room.tournamentId || currentRoomId;
      const manager = tournaments.get(tournamentId);
      const startAt = Date.parse(room.config.scheduledStartAt);
      if (Date.now() < startAt - SCHEDULED_SEATING_MS) {
        return socket.emit('sitDenied', 'Посадка откроется за 5 минут до начала');
      }
      const registration = db.getTournamentRegistration(tournamentId, safePlayerId);
      if (!registration) {
        return socket.emit('sitDenied', 'Для посадки нужна регистрация в турнире');
      }
      if (registration.status !== 'ACTIVE') {
        const message = registration.status === 'WINNER'
          ? 'Турнир уже завершён'
          : 'Вы уже выбыли из этого турнира';
        return socket.emit('sitDenied', message);
      }
      const seated = manager?.seatRegistration(registration);
      if (!seated) return socket.emit('sitDenied', 'Не удалось назначить турнирный стол');
      if (seated.tableId !== currentRoomId) {
        socket.emit('tournament_player_moved', {
          eventId: crypto.randomUUID(),
          tournamentId,
          roomId: tournamentId,
          tableId: seated.tableId,
          tableNumber: manager.getTable(seated.tableId)?.number || 1,
          seatIdx: seated.seatIdx
        });
        return;
      }
      requestedSeatIdx = seated.seatIdx;
    }
    if (safePlayerId && room.players.has(safePlayerId)) {
      const idx = room.reconnectPlayer(safePlayerId, socket.id);
      if (idx >= 0) {
        currentSeatIdx = idx;
        socket.emit('autoSeated', { seatIdx: idx, name: room.G.seats[idx].name });
        room.broadcastState();
      }
      return;
    }

    console.log(`[Socket] sitAtTable seat=${requestedSeatIdx} room=${currentRoomId}`);
    const cleanName = cleanText(name, 18, 'Player');
    const cleanFlag = cleanText(flag, 8, '🌍');
    const cleanAvatar = Number.isInteger(avatarIdx) && avatarIdx >= 0 && avatarIdx < 6 ? avatarIdx : 0;
    const success = room.addPlayer(requestedSeatIdx, {
      id: socket.id,
      playerId: safePlayerId,
      name: cleanName,
      flag: cleanFlag,
      avatar: cleanAvatar
    });

    if (success) {
      currentSeatIdx = requestedSeatIdx;
      room.sockets.set(socket.id, requestedSeatIdx);
      socket.emit('autoSeated', { seatIdx: requestedSeatIdx, name: cleanName });
      if (room.config.fillWithBots) room.fillWithBots();
      room.broadcastState();
    } else {
      socket.emit('sitDenied', 'Место уже занято');
    }
  });

  socket.on('playerAction', ({ action, amount, commandId, turnId } = {}) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const seatIdx = room.sockets.get(socket.id);
    if (seatIdx !== undefined && seatIdx !== -1) {
      if (typeof commandId !== 'string' || !commandId || !Number.isInteger(Number(turnId))) {
        socket.emit('actionRejected', {
          reason: 'INVALID_COMMAND',
          turnId: room.G.turnId,
          actingSeat: room.G.actingSeat
        });
        return;
      }
      const commandStatus = room.actionCommandStatus(commandId, turnId);
      if (commandStatus.duplicate) return;
      if (!commandStatus.ok) {
        socket.emit('actionRejected', {
          reason: commandStatus.reason,
          turnId: room.G.turnId,
          actingSeat: room.G.actingSeat
        });
        return;
      }
      room.doAction(seatIdx, action, amount, { commandId, turnId });
    }
  });

  // Broadcast reactions to all other players in the room
  socket.on('reaction', ({ content, type } = {}) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    const authoritativeSeatIdx = room?.sockets.get(socket.id);
    if (authoritativeSeatIdx === undefined || authoritativeSeatIdx < 0) return;
    const now = Date.now();
    if (now - (socket.data.lastReactionAt || 0) < 750) return;
    socket.data.lastReactionAt = now;
    if (type === 'emoji') {
      content = cleanText(content, 32);
      if (!room || !room.config.reactions.includes(content)) return;
    } else if (type === 'img') {
      if (!room || !room.config.customReactions.includes(content)) return;
    } else {
      return;
    }
    // Broadcast to everyone else in the room
    socket.to(currentRoomId).emit('reaction', { seatIdx: authoritativeSeatIdx, content, type });
  });

  socket.on('rocket_attack_request', ({ tableId, targetPlayerId, effectId } = {}) => {
    const room = rooms.get(currentRoomId);
    if (!room || (tableId !== currentRoomId && tableId !== room.tournamentId)) {
      return socket.emit('rocket_attack_rejected', { code: 'ROOM_MISMATCH' });
    }
    const safeTargetId = cleanPlayerId(targetPlayerId);
    if (!safeTargetId) {
      return socket.emit('rocket_attack_rejected', { code: 'INVALID_TARGET' });
    }
    const result = room.requestTableEffect(socket.id, safeTargetId, cleanText(effectId, 24));
    if (!result.ok) {
      socket.emit('rocket_attack_rejected', {
        code: result.code,
        retryAfterMs: Math.max(0, Number(result.retryAfterMs) || 0)
      });
    }
  });

  socket.on('chatMessage', ({ text, name } = {}) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const now = Date.now();
    if (now - (socket.data.lastChatAt || 0) < 700) return;
    const cleanMessage = cleanText(text, 200);
    if (!cleanMessage) return;
    socket.data.lastChatAt = now;

    const seatIdx = room.sockets.has(socket.id) ? room.sockets.get(socket.id) : -1;
    const seat = seatIdx >= 0 ? room.G.seats[seatIdx] : null;
    const manager = tournaments.get(room.tournamentId || room.id);
    const participant = manager?.getPlayer(socket.data.tournamentPlayerId);
    const message = {
      id: `${now}-${socket.id.slice(0, 6)}`,
      seatIdx,
      name: seat?.name || participant?.name || cleanText(name, 18, 'Зритель'),
      participantStatus: participant?.status || null,
      tournamentPlace: participant?.status === 'WINNER'
        ? 1
        : (participant?.status === 'ELIMINATED' ? Number(participant.eliminatedPlace) || null : null),
      text: cleanMessage,
      at: now
    };
    room.chatMessages.push(message);
    if (room.chatMessages.length > 60) room.chatMessages.splice(0, room.chatMessages.length - 60);
    io.to(currentRoomId).emit('chatMessage', message);
  });

  socket.on('disconnect', () => {
    // Remove from lobby
    const code = socket.data?.lobbyCode;
    if (code && lobbies.has(code)) {
      const lobby = lobbies.get(code);
      lobby.players = lobby.players.filter(p => p.id !== socket.id);
      io.to(`lobby:${code}`).emit('lobbyTick', {
        secondsLeft: lobby.secondsLeft,
        totalSeconds: lobby.totalSeconds,
        players: publicLobbyPlayers(lobby),
        maxPlayers: lobby.maxPlayers
      });
    }
    // Game room disconnect: место остаётся за игроком, помечаем оффлайн
    const room = rooms.get(currentRoomId);
    if (room) {
      room.onDisconnect(socket.id);
      const remaining = io.sockets.adapter.rooms.get(currentRoomId);
      if (!remaining || remaining.size === 0) scheduleRoomCleanup(currentRoomId);
    }
  });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload rejected: ${error.code}` });
  }
  console.error('Unhandled request error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

function restoreScheduledRooms() {
  for (const dbRoom of db.listRooms()) {
    if (!isScheduledRoom(dbRoom) || tournaments.has(dbRoom.id)) continue;
    const registrations = db.listTournamentRegistrations(dbRoom.id);
    const snapshot = db.getTournamentState(dbRoom.id) || db.getRoomState(dbRoom.id);
    if (!registrations.length && !snapshot) continue;
    if (snapshot?.status === 'FINISHED' || snapshot?.gameOver) continue;
    try {
      const manager = createTournamentManager(dbRoom.id, dbRoom.config);
      if (manager.status === 'RUNNING' || Date.now() >= Date.parse(dbRoom.config.scheduledStartAt)) {
        manager.start(registrations, Date.parse(dbRoom.config.scheduledStartAt));
      }
      console.log(`[Restore] Scheduled tournament ${dbRoom.code} restored`);
    } catch (error) {
      console.error(`[Restore] Failed to restore scheduled tournament ${dbRoom.code}:`, error);
    }
  }
}

function migrateReactionAssets() {
  for (const room of db.listRooms()) {
    const hasEmbeddedReaction = room.config?.customReactions?.some(value =>
      typeof value === 'string' && /^data:image\//i.test(value));
    if (!hasEmbeddedReaction) continue;
    try {
      db.updateRoomConfig(room.id, persistReactionAssets(room.config));
      console.log(`[Migration] Reaction assets externalized for room ${room.code}`);
    } catch (error) {
      console.error(`[Migration] Failed to externalize reactions for ${room.code}:`, error);
    }
  }
}

const HOST = process.env.HOST || '0.0.0.0';
migrateReactionAssets();
restoreScheduledRooms();
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT} (network: ${HOST}:${PORT})`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] ${signal}`);
  for (const lobby of lobbies.values()) clearInterval(lobby.timer);
  for (const timer of roomCleanups.values()) clearTimeout(timer);
  for (const tournament of tournaments.values()) tournament.dispose();
  for (const room of rooms.values()) room.dispose();
  server.close(() => {
    try {
      db.checkpoint('TRUNCATE');
      db.close();
    } catch (error) {
      console.error('[Shutdown] SQLite close failed:', error);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
