const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { PokerRoom } = require('./gameEngine');
const { TournamentClock } = require('./tournamentClock');
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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REACTION_BYTES = 3 * 1024 * 1024;
const ROOM_CREATE_LIMIT = 20;
const SCHEDULED_SEATING_MS = 5 * 60 * 1000;
const MAX_SCHEDULE_DELAY_MS = 2_000_000_000;
const roomCreateWindows = new Map();

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
  cfg.fillWithBots = cfg.fillWithBots === true;
  cfg.lobbyWaitSeconds = Math.round(numberInRange(cfg.lobbyWaitSeconds, 60, 10, 3600));
  cfg.brand = cleanText(cfg.brand, 32, '');
  cfg.launchMode = cfg.launchMode === 'scheduled' ? 'scheduled' : 'instant';
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
    ? cfg.customReactions.slice(0, 8).filter(validReactionDataUrl)
    : [];
  return cfg;
}

function createRoomInstance(roomId, config) {
  config = normalizeConfig({ ...config, tournamentId: config.tournamentId || roomId });
  const snapshot = db.getRoomState(roomId);
  const tournamentId = config.tournamentId || roomId;
  let tournamentClock = tournamentClocks.get(tournamentId);
  if (!tournamentClock) {
    tournamentClock = new TournamentClock({
      durationSec: config.levelDurationSec,
      snapshot: snapshot?.tournamentClock
    });
    tournamentClocks.set(tournamentId, tournamentClock);
  }
  const room = new PokerRoom(roomId, config, io, {
    snapshot,
    tournamentClock,
    getTournamentPlayers: () => [...rooms.entries()]
      .filter(([otherId, otherRoom]) => otherId === roomId || otherRoom.tournamentId === tournamentId)
      .flatMap(([otherId, otherRoom]) => otherRoom.G.seats
        .map((seat, seatIdx) => seat && seat.stack > 0
          ? { roomId: otherId, seatIdx, stack: seat.stack }
          : null)
        .filter(Boolean)),
    onPersist: snapshot => {
      try { db.saveRoomState(roomId, snapshot); }
      catch (error) { console.error(`[Persistence] Failed to save room ${roomId}:`, error); }
    },
    onEliminated: ({ playerId, place }) => {
      if (playerId) db.markTournamentEliminated(roomId, playerId, place);
      const roomRecord = db.getRoom(roomId);
      if (roomRecord?.code) broadcastScheduledLobby(roomRecord.code);
    },
    onGameOver: () => {
      const roomRecord = db.getRoom(roomId);
      if (roomRecord?.code) broadcastScheduledLobby(roomRecord.code);
      const sockets = io.sockets.adapter.rooms.get(roomId);
      if (!sockets || sockets.size === 0) scheduleRoomCleanup(roomId);
    }
  });
  room.tournamentId = tournamentId;
  room.resumeAfterRestore();
  scheduleScheduledTournament(room);
  return room;
}

function isScheduledRoom(dbRoomOrConfig) {
  const config = dbRoomOrConfig?.config || dbRoomOrConfig;
  return config?.launchMode === 'scheduled' && Number.isFinite(Date.parse(config.scheduledStartAt));
}

function lateRegistrationClosesAt(config) {
  return Date.parse(config.scheduledStartAt) + Number(config.lateRegistrationMinutes || 0) * 60_000;
}

function ensureTournamentSeat(room, registration, preferredSeat = null) {
  if (!room || !registration || registration.status === 'ELIMINATED' || room.gameOver) return -1;
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
  db.markTournamentSeated(room.id, registration.player_id, seatIdx);
  return seatIdx;
}

function scheduledLobbyPayload(dbRoom, playerId) {
  const config = normalizeConfig(dbRoom.config);
  const registrations = db.listTournamentRegistrations(dbRoom.id);
  const liveRoom = rooms.get(dbRoom.id);
  const now = Date.now();
  const startAt = Date.parse(config.scheduledStartAt);
  const seatingOpensAt = startAt - SCHEDULED_SEATING_MS;
  const registrationClosesAt = lateRegistrationClosesAt(config);
  const registration = playerId
    ? registrations.find(player => player.player_id === playerId)
    : null;
  const activeRegistrations = registrations.filter(player => player.status !== 'ELIMINATED');
  const gameRunning = !!liveRoom && (liveRoom.G.handNum > 0 || liveRoom.gameOver);
  const registrationOpen = !liveRoom?.gameOver && now < registrationClosesAt && activeRegistrations.length < config.maxPlayers;
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
    status: liveRoom?.gameOver ? 'finished' : gameRunning ? 'running' : now >= startAt ? 'starting' : now >= seatingOpensAt ? 'seating' : 'scheduled',
    registered: !!registration,
    playerStatus: registration?.status || null,
    eliminatedPlace: registration?.eliminated_place || null,
    seatIdx: registration?.seat_idx ?? null,
    registrationOpen,
    canTakeSeat: registration?.status === 'ACTIVE' && now >= seatingOpensAt && !liveRoom?.gameOver,
    maxPlayers: config.maxPlayers,
    activeRegistrations: activeRegistrations.length,
    registrations: registrations.map(player => ({
      name: player.name,
      status: player.status,
      seatIdx: player.seat_idx,
      eliminatedPlace: player.eliminated_place,
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

function activateScheduledTournament(room) {
  if (!room || room.disposed || !isScheduledRoom(room.config)) return;
  const startAt = Date.parse(room.config.scheduledStartAt);
  if (Date.now() + 25 < startAt) return scheduleScheduledTournament(room);
  room.tournamentClock.start(startAt);
  const registrations = db.listTournamentRegistrations(room.id)
    .filter(registration => registration.status !== 'ELIMINATED')
    .slice(0, room.maxPlayers);
  registrations.forEach((registration, preferredSeat) => {
    ensureTournamentSeat(room, registration, preferredSeat);
  });
  if (room.config.fillWithBots) room.fillWithBots();
  room.broadcastState();
  room.maybeStartHand();
  const roomRecord = db.getRoom(room.id);
  if (roomRecord?.code) broadcastScheduledLobby(roomRecord.code);
}

function scheduleScheduledTournament(room) {
  clearTimeout(room?._scheduledStartTimer);
  if (!room || room.disposed || !isScheduledRoom(room.config)) return;
  const arm = () => {
    if (room.disposed) return;
    const remaining = Date.parse(room.config.scheduledStartAt) - Date.now();
    if (remaining <= 25) return activateScheduledTournament(room);
    room._scheduledStartTimer = setTimeout(arm, Math.min(remaining, MAX_SCHEDULE_DELAY_MS));
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
  if (!roomId || roomCleanups.has(roomId)) return;
  const activeRoom = rooms.get(roomId);
  if (activeRoom && isScheduledRoom(activeRoom.config) && !activeRoom.gameOver) return;
  roomCleanups.set(roomId, setTimeout(() => {
    roomCleanups.delete(roomId);
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
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// Explicit CSP
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", 
    "default-src 'self' data: blob:; " +
    "img-src * data: blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "script-src 'self' 'unsafe-inline'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none';");
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/poker.html'));
});

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

app.post('/api/rooms', (req, res, next) => {
  if (!roomCreationAllowed(req.ip)) return res.status(429).json({ error: 'Too many rooms created. Try again later.' });
  upload.fields([{ name: 'felt', maxCount: 1 }, { name: 'logo', maxCount: 1 }])(req, res, next);
}, (req, res) => {
  try {
    const config = normalizeConfig(JSON.parse(req.body.config || '{}'));
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
    
    // Create room in memory
    const room = createRoomInstance(roomId, config);
    rooms.set(roomId, room);
    room.broadcastState();

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
          players: lobby.players,
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
  res.sendFile(path.join(__dirname, '../public/lobby.html'));
});

app.get('/r/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/poker.html'));
});

// --- Socket.io ---
io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentSeatIdx = -1;

  // --- Lobby events ---
  socket.on('joinLobby', ({ code, name, playerId } = {}) => {
    const codeUp = code?.toUpperCase();
    const lobby = lobbies.get(codeUp);
    const dbRoom = codeUp ? db.getRoomByCode(codeUp) : null;
    if (!dbRoom) return socket.emit('lobbyError', 'Лобби не найдено или уже закрыто');
    const safePlayerId = cleanPlayerId(playerId);
    if (isScheduledRoom(dbRoom)) {
      if (!rooms.has(dbRoom.id) && (Date.now() >= Date.parse(dbRoom.config.scheduledStartAt) || db.getRoomState(dbRoom.id))) {
        rooms.set(dbRoom.id, createRoomInstance(dbRoom.id, dbRoom.config));
      }
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
      players: lobby.players,
      maxPlayers
    });
    io.to(`lobby:${codeUp}`).emit('lobbyTick', {
      secondsLeft: lobby.secondsLeft,
      totalSeconds: lobby.totalSeconds,
      players: lobby.players,
      maxPlayers
    });
  });

  socket.on('registerTournament', ({ code, name, playerId } = {}) => {
    const codeUp = cleanText(code, 8).toUpperCase();
    const dbRoom = db.getRoomByCode(codeUp);
    const safePlayerId = cleanPlayerId(playerId);
    const safeName = cleanText(name, 18, '');
    if (!dbRoom || !isScheduledRoom(dbRoom)) {
      return socket.emit('tournamentRegistrationError', 'Турнир не найден');
    }
    if (!safePlayerId || !safeName) {
      return socket.emit('tournamentRegistrationError', 'Введите ник для регистрации');
    }
    const config = normalizeConfig(dbRoom.config);
    let room = rooms.get(dbRoom.id);
    if (!room && (Date.now() >= Date.parse(config.scheduledStartAt) || db.getRoomState(dbRoom.id))) {
      room = createRoomInstance(dbRoom.id, config);
      rooms.set(dbRoom.id, room);
    }
    const existing = db.getTournamentRegistration(dbRoom.id, safePlayerId);
    if (existing?.status === 'ELIMINATED') {
      return socket.emit('tournamentRegistrationError', 'Вы уже выбыли из этого турнира');
    }
    if (!existing && (room?.gameOver || Date.now() >= lateRegistrationClosesAt(config))) {
      return socket.emit('tournamentRegistrationError', 'Поздняя регистрация уже закрыта');
    }
    if (!existing && room && room.G.seats.every(Boolean)) {
      return socket.emit('tournamentRegistrationError', 'Все места за столом уже заняты');
    }
    try {
      const registration = db.registerTournamentPlayer(dbRoom.id, safePlayerId, safeName, config.maxPlayers);
      if (room && Date.now() >= Date.parse(config.scheduledStartAt)) {
        const seatIdx = ensureTournamentSeat(room, registration);
        if (seatIdx < 0) {
          return socket.emit('tournamentRegistrationError', 'Все места за столом уже заняты');
        }
        room.broadcastState();
      }
      socket.join(`lobby:${codeUp}`);
      socket.data.lobbyCode = codeUp;
      socket.data.lobbyPlayerId = safePlayerId;
      socket.data.lobbyName = safeName;
      broadcastScheduledLobby(codeUp);
    } catch (error) {
      const message = error.code === 'TOURNAMENT_FULL'
        ? 'Все места за столом уже заняты'
        : error.code === 'ALREADY_ELIMINATED'
          ? 'Вы уже выбыли из этого турнира'
          : 'Не удалось зарегистрироваться';
      socket.emit('tournamentRegistrationError', message);
    }
  });

  socket.on('claimTournamentSeat', ({ code, playerId } = {}) => {
    const codeUp = cleanText(code, 8).toUpperCase();
    const dbRoom = db.getRoomByCode(codeUp);
    const safePlayerId = cleanPlayerId(playerId);
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
    if (registration.status === 'ELIMINATED') {
      return socket.emit('tournamentSeatError', 'Вы уже выбыли из этого турнира');
    }
    let room = rooms.get(dbRoom.id);
    if (!room) {
      room = createRoomInstance(dbRoom.id, dbRoom.config);
      rooms.set(dbRoom.id, room);
    }
    if (room.gameOver) {
      return socket.emit('tournamentSeatError', 'Турнир уже завершён');
    }
    const activeRegistrations = db.listTournamentRegistrations(dbRoom.id)
      .filter(player => player.status !== 'ELIMINATED');
    const preferredSeat = activeRegistrations.findIndex(player => player.player_id === safePlayerId);
    const seatIdx = ensureTournamentSeat(room, registration, preferredSeat);
    if (seatIdx < 0) return socket.emit('tournamentSeatError', 'Все места за столом уже заняты');
    socket.emit('lobbyStart', { roomId: dbRoom.id, seatIdx, name: registration.name });
  });

  socket.on('joinRoom', (payload) => {
    const roomId = typeof payload === 'string' ? payload : payload?.roomId;
    const playerId = cleanPlayerId((payload && typeof payload === 'object') ? payload.playerId : null);
    if (!roomId) return;

    let room = rooms.get(roomId);
    if (!room) {
      const dbRoom = db.getRoom(roomId);
      if (dbRoom) {
        room = createRoomInstance(roomId, dbRoom.config);
        rooms.set(roomId, room);
      } else {
        return socket.emit('error', 'Room not found');
      }
    }

    currentRoomId = roomId;
    socket.join(roomId);
    cancelRoomCleanup(roomId);
    socket.emit('roomConfig', room.config);
    socket.emit('chatHistory', room.chatMessages || []);

    // Returning player (refresh / network drop) — re-attach to reserved seat
    const reconnectedSeat = room.reconnectPlayer(playerId, socket.id);
    if (reconnectedSeat >= 0) {
      currentSeatIdx = reconnectedSeat;
      socket.emit('autoSeated', { seatIdx: reconnectedSeat, name: room.G.seats[reconnectedSeat].name });
      console.log(`[Room] Reconnected ${room.G.seats[reconnectedSeat].name} to seat ${reconnectedSeat} in room ${roomId}`);
    } else {
      // Check if this player has a pre-assigned seat from the lobby
      const assignMap = lobbySeats.get(roomId);
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
    const safePlayerId = cleanPlayerId(playerId);
    let requestedSeatIdx = seatIdx;
    if (isScheduledRoom(room.config)) {
      const startAt = Date.parse(room.config.scheduledStartAt);
      if (Date.now() < startAt - SCHEDULED_SEATING_MS) {
        return socket.emit('sitDenied', 'Посадка откроется за 5 минут до начала');
      }
      const registration = db.getTournamentRegistration(currentRoomId, safePlayerId);
      if (!registration) {
        return socket.emit('sitDenied', 'Для посадки нужна регистрация в турнире');
      }
      if (registration.status === 'ELIMINATED') {
        return socket.emit('sitDenied', 'Вы уже выбыли из этого турнира');
      }
      const activeRegistrations = db.listTournamentRegistrations(currentRoomId)
        .filter(player => player.status !== 'ELIMINATED');
      const preferredSeat = activeRegistrations.findIndex(player => player.player_id === safePlayerId);
      requestedSeatIdx = ensureTournamentSeat(room, registration, preferredSeat);
      if (requestedSeatIdx < 0) return socket.emit('sitDenied', 'Все места за столом уже заняты');
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

  socket.on('playerAction', ({ action, amount } = {}) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const seatIdx = room.sockets.get(socket.id);
    if (seatIdx !== undefined && seatIdx !== -1) {
      room.doAction(seatIdx, action, amount);
    }
  });

  // Broadcast reactions to all other players in the room
  socket.on('reaction', ({ content, type } = {}) => {
    if (!currentRoomId) return;
    if (currentSeatIdx === -1) return;
    const now = Date.now();
    if (now - (socket.data.lastReactionAt || 0) < 750) return;
    socket.data.lastReactionAt = now;
    if (type === 'emoji') {
      content = cleanText(content, 32);
    } else if (type === 'img') {
      if (!validReactionDataUrl(content)) return;
    } else {
      return;
    }
    // Broadcast to everyone else in the room
    socket.to(currentRoomId).emit('reaction', { seatIdx: currentSeatIdx, content, type });
  });

  socket.on('rocket_attack_request', ({ tableId, targetPlayerId, effectId } = {}) => {
    const room = rooms.get(currentRoomId);
    if (!room || tableId !== currentRoomId) {
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
    const message = {
      id: `${now}-${socket.id.slice(0, 6)}`,
      seatIdx,
      name: seat?.name || cleanText(name, 18, 'Зритель'),
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
        players: lobby.players
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
    if (!isScheduledRoom(dbRoom) || rooms.has(dbRoom.id)) continue;
    const registrations = db.listTournamentRegistrations(dbRoom.id);
    const snapshot = db.getRoomState(dbRoom.id);
    if (!registrations.length && !snapshot) continue;
    if (snapshot?.gameOver) continue;
    try {
      const room = createRoomInstance(dbRoom.id, dbRoom.config);
      rooms.set(dbRoom.id, room);
      console.log(`[Restore] Scheduled tournament ${dbRoom.code} restored`);
    } catch (error) {
      console.error(`[Restore] Failed to restore scheduled tournament ${dbRoom.code}:`, error);
    }
  }
}

const HOST = process.env.HOST || '0.0.0.0';
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
  for (const room of rooms.values()) room.dispose();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
