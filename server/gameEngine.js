'use strict';

const { randomUUID } = require('crypto');
const { TournamentClock } = require('./tournamentClock');
const { ANTE_TYPES, PRESETS } = require('../public/tournament-structure');

const _CV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const _CN = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const _money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function _combos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [..._combos(t, k - 1).map(c => [h, ...c]), ..._combos(t, k)];
}

function _eval5(cards) {
  const nums = cards.map(c => _CV[c.v] || 0).sort((a, b) => b - a);
  const suits = cards.map(c => c.s);
  const isFlush = new Set(suits).size === 1;
  const cnt = {};
  nums.forEach(n => cnt[n] = (cnt[n] || 0) + 1);
  const grps = Object.entries(cnt).map(([v, c]) => ({ v: +v, c })).sort((a, b) => b.c - a.c || b.v - a.v);
  const uniq = [...new Set(nums)].sort((a, b) => b - a);
  let isStraight = false, strHi = 0;
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] - uniq[i + 4] === 4) { isStraight = true; strHi = uniq[i]; break; }
  }
  if (!isStraight && uniq.includes(14) && [2, 3, 4, 5].every(v => uniq.includes(v))) { isStraight = true; strHi = 5; }
  const sc = (r, ...vs) => r * 16 ** 5 + (vs[0] || 0) * 16 ** 4 + (vs[1] || 0) * 16 ** 3 + (vs[2] || 0) * 16 ** 2 + (vs[3] || 0) * 16 + (vs[4] || 0);
  const kickers = (excl) => { const ex = [...excl]; return nums.filter(n => { const i = ex.indexOf(n); if (i >= 0) { ex.splice(i, 1); return false; } return true; }); };
  if (isFlush && isStraight && strHi === 14) return { rank: 9, score: sc(9, 14), desc: 'Роял-флеш' };
  if (isFlush && isStraight) return { rank: 8, score: sc(8, strHi), desc: `Стрит-флеш до ${_CN[strHi]}` };
  if (grps[0].c === 4) {
    const [k0] = kickers(Array(4).fill(grps[0].v));
    return { rank: 7, score: sc(7, grps[0].v, k0), desc: `Каре из ${_CN[grps[0].v]}` };
  }
  if (grps[0].c === 3 && grps[1]?.c === 2)
    return { rank: 6, score: sc(6, grps[0].v, grps[1].v), desc: `Фулл-хаус ${_CN[grps[0].v]} на ${_CN[grps[1].v]}` };
  if (isFlush) return { rank: 5, score: sc(5, ...nums), desc: `Флеш с высшей картой ${_CN[nums[0]]}` };
  if (isStraight) return { rank: 4, score: sc(4, strHi), desc: `Стрит до ${_CN[strHi]}` };
  if (grps[0].c === 3) {
    const [k0, k1] = kickers(Array(3).fill(grps[0].v));
    return { rank: 3, score: sc(3, grps[0].v, k0, k1), desc: `Тройка ${_CN[grps[0].v]}` };
  }
  if (grps[0].c === 2 && grps[1]?.c === 2) {
    const [k0] = kickers([grps[0].v, grps[0].v, grps[1].v, grps[1].v]);
    return { rank: 2, score: sc(2, grps[0].v, grps[1].v, k0), desc: `Две пары ${_CN[grps[0].v]}-${_CN[grps[1].v]}` };
  }
  if (grps[0].c === 2) {
    const [k0, k1, k2] = kickers([grps[0].v, grps[0].v]);
    return { rank: 1, score: sc(1, grps[0].v, k0, k1, k2), desc: `Пара ${_CN[grps[0].v]}` };
  }
  return { rank: 0, score: sc(0, ...nums), desc: `Старшая карта ${_CN[nums[0]]}` };
}

function getBestScore(hole, board) {
  const all = [...hole, ...board];
  if (all.length < 5) return -1;
  let best = -Infinity;
  const combos = _combos(all, 5);
  for (const c of combos) { const s = _eval5(c).score; if (s > best) best = s; }
  return best;
}

class PokerRoom {
  constructor(id, config, io, options = {}) {
    this.id = id;
    this.config = config;
    this.io = io;
    this.maxPlayers = Number(config.maxPlayers) === 9 ? 9 : 6;
    this.G = {
      seats: Array(this.maxPlayers).fill(null),
      deck: [],
      board: [],
      pot: 0,
      currentBet: 0,
      phase: 'WAITING',
      dealerSeat: 0,
      actingSeat: -1,
      handNum: 0,
      boardPeekIdx: -1,
      actingDeadline: null,
      turnTimeMs: null,
      minRaise: Number(config.bb) || 0.10,
      currentSb: Number(config.sb) || 0.05,
      currentBb: Number(config.bb) || 0.10,
      currentAnte: 0,
      blindLevel: 1,
      blindLevelStartedAt: null,
      nextBlindAt: null
    };
    this.TURN_MS = (Number(config.turnTimeSec) > 0 ? Number(config.turnTimeSec) * 1000 : 30000);
    this.OFFLINE_TURN_MS = 4000;
    this.sockets = new Map(); // socket.id -> seatIdx
    this.players = new Map(); // playerId -> seatIdx (persistent identity)
    this.turnTimer = null;
    this._startTimeout = null;
    this._transitionTimeouts = new Set();
    this.disposed = false;
    this.totalEntrants = 0;   // everyone who ever took a seat (for "place N of M")
    this.eliminatedCount = 0;
    this.gameOver = false;
    this.chatMessages = [];
    this.effectCooldowns = new Map();
    this.activeEffectTargets = new Map();
    this.onPersist = typeof options.onPersist === 'function' ? options.onPersist : null;
    this.onEliminated = typeof options.onEliminated === 'function' ? options.onEliminated : null;
    this.onGameOver = typeof options.onGameOver === 'function' ? options.onGameOver : null;
    this.getTournamentPlayers = typeof options.getTournamentPlayers === 'function'
      ? options.getTournamentPlayers : null;
    this.ownsTournamentClock = !options.tournamentClock;
    this.tournamentClock = options.tournamentClock || new TournamentClock({
      durationSec: Number(config.levelDurationSec) || PRESETS.HYPER_TURBO,
      snapshot: options.snapshot?.tournamentClock
    });
    if (options.snapshot) this._restoreSnapshot(options.snapshot);
    this._unsubscribeTournamentClock = this.tournamentClock.subscribe(state => {
      if (this.disposed) return;
      this.io.to(this.id).emit('blindLevelUp', this._publicTournamentState(state));
      this.broadcastState();
    });
  }

  dispose() {
    this.disposed = true;
    this.clearTurnTimer();
    clearTimeout(this._scheduledStartTimer);
    this._scheduledStartTimer = null;
    clearTimeout(this._startTimeout);
    this._startTimeout = null;
    for (const timer of this._transitionTimeouts) clearTimeout(timer);
    this._transitionTimeouts.clear();
    if (this._unsubscribeTournamentClock) this._unsubscribeTournamentClock();
    if (this.ownsTournamentClock) this.tournamentClock.dispose();
  }

  _schedule(fn, ms) {
    const timer = setTimeout(() => {
      this._transitionTimeouts.delete(timer);
      if (!this.disposed) fn();
    }, ms);
    this._transitionTimeouts.add(timer);
    return timer;
  }

  getSnapshot() {
    return {
      version: 2,
      game: {
        ...this.G,
        actingDeadline: null,
        turnTimeMs: null,
        seats: this.G.seats.map(s => s ? { ...s, id: null, connected: false } : null)
      },
      totalEntrants: this.totalEntrants,
      eliminatedCount: this.eliminatedCount,
      gameOver: this.gameOver,
      tournamentClock: this.tournamentClock.snapshot()
    };
  }

  _restoreSnapshot(snapshot) {
    if (!snapshot || ![1, 2].includes(snapshot.version) || !snapshot.game) return;
    const seats = Array.isArray(snapshot.game.seats)
      ? snapshot.game.seats.slice(0, this.maxPlayers).map(s => s ? {
        ...s,
        id: null,
        connected: false,
        publicPlayerId: s.publicPlayerId || randomUUID()
      } : null)
      : Array(this.maxPlayers).fill(null);
    while (seats.length < this.maxPlayers) seats.push(null);
    this.G = {
      ...this.G,
      ...snapshot.game,
      seats,
      actingDeadline: null,
      turnTimeMs: null,
      minRaise: Number(snapshot.game.minRaise) > 0 ? Number(snapshot.game.minRaise) : Number(this.config.bb)
    };
    this.G.currentSb = Number(this.G.currentSb) > 0 ? Number(this.G.currentSb) : Number(this.config.sb);
    this.G.currentBb = Number(this.G.currentBb) > 0 ? Number(this.G.currentBb) : Number(this.config.bb);
    this.G.currentAnte = Number(this.G.currentAnte) || 0;
    this.G.blindLevel = Math.max(1, Number(this.G.blindLevel) || 1);
    this.totalEntrants = Math.max(Number(snapshot.totalEntrants) || 0, seats.filter(Boolean).length);
    this.eliminatedCount = Math.max(0, Number(snapshot.eliminatedCount) || 0);
    this.gameOver = !!snapshot.gameOver;
    seats.forEach((s, i) => { if (s?.playerId) this.players.set(s.playerId, i); });
  }

  resumeAfterRestore() {
    if (this.disposed || this.gameOver) return;
    if (this.G.phase === 'SHOWDOWN') {
      this._schedule(() => {
        this._processEliminations();
        this.G.phase = 'WAITING';
        if (!this._checkGameOver()) this.maybeStartHand();
        this.broadcastState();
      }, 1000);
      return;
    }
    if (['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(this.G.phase)) {
      if (this.G.actingSeat === -1 || this.roundOver()) {
        this._schedule(() => this.advancePhase(), 1000);
      } else {
        this.startTurnTimer();
        this.scheduleBotAction();
        this.broadcastState();
      }
    }
  }

  // True when face-down cards must be revealed to everyone (showdown / all-in runout)
  _revealAll() {
    const inHandCount = this.G.seats.filter(s => s && s.inHand).length;
    if (inHandCount <= 1) return false;
    if (this.G.phase === 'SHOWDOWN') return true;
    return this.G.phase !== 'WAITING' && this.G.actingSeat === -1;
  }

  _anteType() {
    return Object.values(ANTE_TYPES).includes(this.config.anteType)
      ? this.config.anteType
      : ANTE_TYPES.CLASSIC_ANTE;
  }

  _publicTournamentState(state = this.tournamentClock.getState()) {
    const anteType = this._anteType();
    return {
      level: state.level,
      sb: state.sb,
      bb: state.bb,
      ante: anteType === ANTE_TYPES.CLASSIC_ANTE ? state.ante : 0,
      bba: anteType === ANTE_TYPES.BIG_BLIND_ANTE ? state.bb : 0,
      anteType,
      remainingMs: state.remainingMs,
      nextLevel: state.next
    };
  }

  // Build the state as seen by one viewer: own cards real, others hidden, no deck
  sanitizedState(viewerSeat) {
    const G = this.G;
    const reveal = this._revealAll();
    const tournament = this._publicTournamentState();
    const localAlive = G.seats
      .map((seat, seatIdx) => seat && seat.stack > 0
        ? { roomId: this.id, seatIdx, stack: seat.stack }
        : null)
      .filter(Boolean);
    const alive = (this.getTournamentPlayers?.() || localAlive)
      .sort((a, b) => b.stack - a.stack || a.roomId.localeCompare(b.roomId) || a.seatIdx - b.seatIdx);
    const playerPosition = viewerSeat >= 0
      ? alive.findIndex(item => item.roomId === this.id && item.seatIdx === viewerSeat) + 1
      : 0;
    const seats = G.seats.map((s, i) => {
      if (!s) return null;
      const { cards, id, playerId, publicPlayerId, ...pub } = s;
      let outCards = [];
      if (cards && cards.length === 2) {
        outCards = (i === viewerSeat || reveal) ? cards : [{ hidden: true }, { hidden: true }];
      }
      return { ...pub, playerId: publicPlayerId, cards: outCards };
    });
    return {
      seats,
      board: G.board,
      pot: G.pot,
      currentBet: G.currentBet,
      minRaise: G.minRaise,
      phase: G.phase,
      dealerSeat: G.dealerSeat,
      actingSeat: G.actingSeat,
      handNum: G.handNum,
      boardPeekIdx: G.boardPeekIdx,
      turnTimeMs: G.turnTimeMs,
      turnRemainingMs: G.actingDeadline ? Math.max(0, G.actingDeadline - Date.now()) : null,
      serverNow: Date.now(),
      yourSeat: (viewerSeat === undefined || viewerSeat === null) ? -1 : viewerSeat,
      gameOver: this.gameOver,
      totalEntrants: this.totalEntrants,
      maxPlayers: this.maxPlayers,
      currentSb: G.currentSb,
      currentBb: G.currentBb,
      currentAnte: G.currentAnte,
      handBlindLevel: G.blindLevel,
      blindLevel: tournament.level,
      blindRemainingMs: tournament.remainingMs,
      blindLevelDurationMs: this.tournamentClock.durationSec * 1000,
      tournamentSb: tournament.sb,
      tournamentBb: tournament.bb,
      tournamentAnte: tournament.ante,
      tournamentBba: tournament.bba,
      anteType: tournament.anteType,
      nextBlindLevel: tournament.nextLevel,
      playerPosition: Math.max(0, playerPosition),
      playersRemaining: alive.length
    };
  }

  broadcastState() {
    if (this.onPersist) this.onPersist(this.getSnapshot());
    const ids = this.io.sockets.adapter.rooms.get(this.id);
    if (!ids) return;
    for (const sid of ids) {
      const sock = this.io.sockets.sockets.get(sid);
      if (!sock) continue;
      const seatIdx = this.sockets.has(sid) ? this.sockets.get(sid) : -1;
      sock.emit('stateUpdate', this.sanitizedState(seatIdx));
    }
  }

  broadcastAction(seatIdx, action, amount, isAllIn = false) {
    this.io.to(this.id).emit('playerActionEffect', { seatIdx, action, amount, isAllIn });
  }

  addPlayer(seatIdx, player) {
    if (this.gameOver) return false;
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= this.maxPlayers) return false;
    if (this.G.seats[seatIdx]) return false;
    if (player.playerId && this.players.has(player.playerId)) return false;
    const connected = player.connected !== false;
    this.G.seats[seatIdx] = {
      ...player,
      publicPlayerId: player.publicPlayerId || randomUUID(),
      stack: this.config.startStack,
      bet: 0,
      inHand: false,
      acted: false,
      cards: [],
      lastAction: '',
      isBot: false,
      contributed: 0,
      connected,
      sittingOut: !connected || player.sittingOut === true
    };
    if (player.playerId) this.players.set(player.playerId, seatIdx);
    this.totalEntrants++;

    this.broadcastState();
    this.maybeStartHand();
    return true;
  }

  requestTableEffect(socketId, targetPlayerId, effectId) {
    const senderSeat = this.sockets.get(socketId);
    if (senderSeat === undefined || senderSeat < 0) return { ok: false, code: 'NOT_SEATED' };
    if (this.gameOver) return { ok: false, code: 'GAME_OVER' };
    if (effectId !== 'rocket_01') return { ok: false, code: 'UNKNOWN_EFFECT' };

    const sender = this.G.seats[senderSeat];
    const targetSeat = this.G.seats.findIndex(seat => seat?.publicPlayerId === targetPlayerId);
    const target = targetSeat >= 0 ? this.G.seats[targetSeat] : null;
    if (!sender || !sender.connected) return { ok: false, code: 'NOT_AVAILABLE' };
    if (!target || (!target.isBot && !target.connected)) return { ok: false, code: 'TARGET_GONE' };
    if (senderSeat === targetSeat) return { ok: false, code: 'SELF_TARGET' };

    const now = Date.now();
    const cooldownUntil = this.effectCooldowns.get(sender.publicPlayerId) || 0;
    if (cooldownUntil > now) {
      return { ok: false, code: 'COOLDOWN', retryAfterMs: cooldownUntil - now };
    }
    const targetBusyUntil = this.activeEffectTargets.get(target.publicPlayerId) || 0;
    if (targetBusyUntil > now) {
      return { ok: false, code: 'TARGET_BUSY', retryAfterMs: targetBusyUntil - now };
    }

    const event = {
      eventId: randomUUID(),
      tableId: this.id,
      fromPlayerId: sender.publicPlayerId,
      targetPlayerId: target.publicPlayerId,
      effectId,
      serverStartTime: now + 120,
      startDelayMs: 120
    };
    const senderCooldownUntil = now + 10_000;
    const targetEffectUntil = event.serverStartTime + 3_200;
    this.effectCooldowns.set(sender.publicPlayerId, senderCooldownUntil);
    this.activeEffectTargets.set(target.publicPlayerId, targetEffectUntil);
    this._schedule(() => {
      if (this.effectCooldowns.get(sender.publicPlayerId) === senderCooldownUntil) {
        this.effectCooldowns.delete(sender.publicPlayerId);
      }
    }, 10_000);
    this._schedule(() => {
      if (this.activeEffectTargets.get(target.publicPlayerId) === targetEffectUntil) {
        this.activeEffectTargets.delete(target.publicPlayerId);
      }
    }, targetEffectUntil - now);
    this.io.to(this.id).emit('rocket_attack_started', event);
    return { ok: true, event };
  }

  // Re-attach a returning player (new socket) to their reserved seat
  reconnectPlayer(playerId, socketId) {
    if (!playerId) return -1;
    const seatIdx = this.players.get(playerId);
    if (seatIdx === undefined) return -1;
    const p = this.G.seats[seatIdx];
    if (!p) { this.players.delete(playerId); return -1; }
    for (const [sid, idx] of [...this.sockets]) {
      if (idx === seatIdx && sid !== socketId) this.sockets.delete(sid);
    }
    p.id = socketId;
    p.connected = true;
    p.sittingOut = false;
    this.sockets.set(socketId, seatIdx);
    // Resume a persisted hand as soon as any participant returns. The returning
    // actor gets a full clock; an absent actor gets the short AFK clock.
    const actor = this.G.seats[this.G.actingSeat];
    if (actor?.inHand && !this.turnTimer) {
      this.startTurnTimer(this.G.actingSeat === seatIdx ? this.TURN_MS : undefined);
    } else if (this.G.actingSeat === seatIdx && p.inHand) {
      this.startTurnTimer(this.TURN_MS);
    }
    this.maybeStartHand();
    return seatIdx;
  }

  onDisconnect(socketId) {
    const seatIdx = this.sockets.get(socketId);
    this.sockets.delete(socketId);
    if (seatIdx === undefined) return;
    const p = this.G.seats[seatIdx];
    if (!p || p.id !== socketId) return; // seat already taken over by a newer socket
    p.connected = false;
    p.sittingOut = true;
    // If it's their turn — shorten the clock so the table doesn't wait long
    if (this.G.actingSeat === seatIdx && p.inHand) {
      this.startTurnTimer(this.OFFLINE_TURN_MS);
    }
    this.broadcastState();
  }

  // Tournament rules: anyone with chips is dealt in. Offline players check
  // when free and fold when facing a bet, so the game never stalls.
  eligibleCount() {
    return this.G.seats.filter(s => s && s.stack > 0).length;
  }

  // Don't burn hands in a room where literally nobody is watching
  hasActivePresence() {
    return this.G.seats.some(s => s && (s.isBot || s.connected));
  }

  scheduledStartReady() {
    if (this.config.launchMode !== 'scheduled') return true;
    const startAt = Date.parse(this.config.scheduledStartAt);
    return Number.isFinite(startAt) && Date.now() >= startAt;
  }

  maybeStartHand() {
    if (this.disposed || this.gameOver) return;
    if (this.G.phase !== 'WAITING') return;
    if (!this.scheduledStartReady()) return;
    if (this.eligibleCount() < 2) return;
    if (this.config.launchMode !== 'scheduled' && !this.hasActivePresence()) return;
    if (this._startTimeout) return;
    this._startTimeout = setTimeout(() => {
      this._startTimeout = null;
      this.startHand();
    }, 3000);
  }

  clearTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.G.actingDeadline = null;
  }

  startTurnTimer(ms) {
    this.clearTurnTimer();
    const seatIdx = this.G.actingSeat;
    if (seatIdx === -1) return;
    const p = this.G.seats[seatIdx];
    if (!p) return;
    if (!ms) ms = (p.isBot || p.connected) ? this.TURN_MS : this.OFFLINE_TURN_MS;
    this.G.turnTimeMs = ms;
    this.G.actingDeadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      const idx = this.G.actingSeat;
      const cur = this.G.seats[idx];
      if (!cur || !cur.inHand) return;
      const toCall = this.G.currentBet - cur.bet;
      this.doAction(idx, toCall > 0 ? 'fold' : 'call', 0);
    }, ms + 200);
  }

  fillWithBots(reservedSeats = new Set()) {
    const BOT_NAMES = [
      { name: 'Coffee_Time', flag: '🇱🇻', ava: 0 },
      { name: 'DlmaDIDlma', flag: '🇷🇺', ava: 1 },
      { name: 'CallDeFarol1', flag: '🇦🇷', ava: 2 },
      { name: 'sdszfyzc', flag: '🇨🇳', ava: 3 },
      { name: 'faker77777', flag: '🇨🇳', ava: 5 },
      { name: 'RiverPilot', flag: '🇨🇦', ava: 4 },
      { name: 'PocketAce', flag: '🇬🇧', ava: 1 },
      { name: 'NightGrinder', flag: '🇩🇪', ava: 3 },
    ];
    let bIdx = 0;
    let added = 0;
    for (let i = 0; i < this.maxPlayers; i++) {
      if (!this.G.seats[i] && !reservedSeats.has(i) && bIdx < BOT_NAMES.length) {
        const b = BOT_NAMES[bIdx++];
        this.G.seats[i] = {
          publicPlayerId: randomUUID(),
          name: b.name,
          flag: b.flag,
          stack: this.config.startStack,
          bet: 0,
          inHand: false,
          acted: false,
          cards: [],
          lastAction: '',
          isBot: true,
          avatar: b.ava,
          connected: true,
          contributed: 0,
          canRaise: true
        };
        this.totalEntrants++;
        added++;
      }
    }
    if (added > 0) {
      this.broadcastState();
      this.maybeStartHand();
    }
    return added;
  }

  activePlayerCount() {
    return this.G.seats.filter(s => s !== null).length;
  }

  startHand() {
    if (this.disposed || this.gameOver) return;
    clearTimeout(this._startTimeout);
    this._startTimeout = null;
    if (!this.scheduledStartReady()) {
      this.G.phase = 'WAITING';
      this.G.actingSeat = -1;
      this.clearTurnTimer();
      this.broadcastState();
      return;
    }
    // Нужны минимум двое с фишками и хоть кто-то подключённый
    if (this.eligibleCount() < 2 || (this.config.launchMode !== 'scheduled' && !this.hasActivePresence())) {
      this.G.phase = 'WAITING';
      this.G.actingSeat = -1;
      this.clearTurnTimer();
      this.broadcastState();
      return;
    }

    this._applyTournamentLevelForNextHand();
    this.G.handNum++;
    this.G.phase = 'PREFLOP';
    this.G.board = [];
    this.G.pot = 0;
    this.G.deck = this.makeDeck();
    this.G.boardPeekIdx = -1;
    this.shuffle(this.G.deck);

    this.G.seats.forEach(s => {
      if (s) {
        // Оффлайн-игроки тоже в раздаче: платят обязательные ставки и действуют автоматически.
        s.inHand = s.stack > 0;
        s.cards = [];
        s.bet = 0;
        s.acted = false;
        s.canRaise = true;
        s.lastAction = '';
        s.contributed = 0;
      }
    });

    this.G.dealerSeat = this.nextSeat(this.G.dealerSeat);
    const inHandCount = this.G.seats.filter(s => s && s.inHand).length;
    let sbIdx, bbIdx;
    if (inHandCount === 2) {
      // Хедз-ап: баттон ставит малый блайнд и ходит первым на префлопе
      sbIdx = this.G.dealerSeat;
      bbIdx = this.nextSeat(sbIdx);
    } else {
      sbIdx = this.nextSeat(this.G.dealerSeat);
      bbIdx = this.nextSeat(sbIdx);
    }

    // Forced contributions are collected exactly once before any cards are dealt.
    this._collectAntes(bbIdx);
    this.postBlind(sbIdx, this.G.currentSb);
    this.postBlind(bbIdx, this.G.currentBb);
    this.G.seats.forEach(s => {
      if (s?.inHand) s.cards = [this.G.deck.pop(), this.G.deck.pop()];
    });
    // A short all-in big blind does not reduce the full preflop bring-in.
    this.G.currentBet = this.G.currentBb;
    this.G.minRaise = this.G.currentBb;
    this.G.actingSeat = this.nextSeat(bbIdx);

    const playersAbleToBet = this.G.seats.filter(s => s && s.inHand && s.stack > 0).length;
    if (this.G.actingSeat === -1 || playersAbleToBet < 2) {
      this.G.actingSeat = -1;
      this.broadcastState();
      this._schedule(() => this.advancePhase(), 1200);
    } else {
      this.startTurnTimer();
      this.broadcastState();
      this.scheduleBotAction();
    }
  }

  scheduleBotAction() {
    if (this.disposed) return;
    if (this.G.actingSeat === -1) return;
    const p = this.G.seats[this.G.actingSeat];
    if (!p || !p.isBot) return;

    const delay = 1500 + Math.random() * 2000;
    this._schedule(() => {
      if (this.G.actingSeat === -1) return;
      const bot = this.G.seats[this.G.actingSeat];
      if (!bot || !bot.isBot) return;

      const toCall = this.G.currentBet - bot.bet;
      let action = 'call';
      let amount = 0;

      // Bots occasionally react so custom emoji/GIF placement can be checked in a live room.
      if (Math.random() < 0.18) {
        const configured = [
          ...(Array.isArray(this.config.reactions) ? this.config.reactions : []),
          ...(Array.isArray(this.config.customReactions) ? this.config.customReactions : [])
        ];
        const reactions = configured.length ? configured : ['🎰', '🔥', '😂', '👏'];
        const content = reactions[Math.floor(Math.random() * reactions.length)];
        this.io.to(this.id).emit('reaction', {
          seatIdx: this.G.actingSeat,
          content,
          type: typeof content === 'string' && content.startsWith('data:') ? 'img' : 'emoji'
        });
      }

      const roll = Math.random();
      if (toCall > 0) {
        const pressure = toCall / Math.max(bot.stack + toCall, this.G.currentBb);
        const foldChance = Math.min(0.65, 0.33 + pressure * 0.5);
        if (roll < foldChance) {
          action = 'fold';
        } else if (roll < foldChance + 0.12 && bot.stack > toCall + this.G.currentBb) {
          action = 'raise';
          amount = this.G.currentBet + Math.max(this.G.currentBb * 2, toCall);
        }
      } else if (roll < 0.2) {
        action = 'raise';
        amount = this.G.currentBet + this.G.currentBb * 2;
      }

      this.doAction(this.G.actingSeat, action, amount);
    }, delay);
  }

  makeDeck() {
    const S = ['♠', '♥', '♦', '♣'], V = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const d = [];
    S.forEach(s => V.forEach(v => d.push({ v, s })));
    return d;
  }

  shuffle(d) {
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[d[i], d[j]] = [d[j], d[i]]; }
  }

  postBlind(idx, amt) {
    const p = this.G.seats[idx];
    if (!p) return;
    const actual = _money(Math.min(amt, p.stack));
    p.stack = _money(p.stack - actual);
    p.bet = _money(p.bet + actual);
    this.G.pot = _money(this.G.pot + actual);
    p.contributed = _money((p.contributed || 0) + actual);
    if (p.stack < 0.005) p.stack = 0;
  }

  postAnte(idx, amt) {
    const p = this.G.seats[idx];
    if (!p || amt <= 0) return;
    const actual = _money(Math.min(amt, p.stack));
    p.stack = _money(p.stack - actual);
    this.G.pot = _money(this.G.pot + actual);
    p.contributed = _money((p.contributed || 0) + actual);
    if (p.stack < 0.005) p.stack = 0;
  }

  _applyTournamentLevelForNextHand() {
    const level = this.tournamentClock.start();
    this.G.currentSb = level.sb;
    this.G.currentBb = level.bb;
    this.G.blindLevel = level.level;
    this.G.currentAnte = this._anteType() === ANTE_TYPES.CLASSIC_ANTE
      ? level.ante
      : (this._anteType() === ANTE_TYPES.BIG_BLIND_ANTE ? level.bb : 0);
  }

  _collectAntes(bbIdx) {
    const anteType = this._anteType();
    if (anteType === ANTE_TYPES.NO_ANTE) return;
    if (anteType === ANTE_TYPES.BIG_BLIND_ANTE) {
      this._postAnteOnce(bbIdx, this.G.currentBb);
      return;
    }
    this.G.seats.forEach((seat, seatIdx) => {
      if (seat?.inHand) this._postAnteOnce(seatIdx, this.G.currentAnte);
    });
  }

  _postAnteOnce(idx, amount) {
    const player = this.G.seats[idx];
    if (!player || !player.inHand || player.antePaidHand === this.G.handNum) return;
    player.antePaidHand = this.G.handNum;
    this.postAnte(idx, amount);
  }

  nextSeat(from) {
    let i = (from + 1) % this.maxPlayers;
    while (i !== from) {
      if (this.G.seats[i] && this.G.seats[i].inHand && this.G.seats[i].stack > 0) return i;
      i = (i + 1) % this.maxPlayers;
    }
    // fallback: return from if it itself qualifies, else -1
    return (this.G.seats[from] && this.G.seats[from].inHand && this.G.seats[from].stack > 0) ? from : -1;
  }

  doAction(seatIdx, action, raiseTo) {
    if (this.disposed) return false;
    if (!['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(this.G.phase)) return false;
    if (seatIdx !== this.G.actingSeat) return false;
    const p = this.G.seats[seatIdx];
    if (!p || !p.inHand) return false;

    raiseTo = Number(raiseTo);
    if (!Number.isFinite(raiseTo) || raiseTo < 0) raiseTo = 0;
    if (action === 'check') action = 'call'; // чек = колл при нулевой ставке
    if (!['fold', 'call', 'raise'].includes(action)) return false;

    let isFullRaise = false;
    if (action === 'raise') {
      const toCall = Math.max(0, this.G.currentBet - p.bet);
      const maxTotal = p.bet + p.stack;
      if (maxTotal <= this.G.currentBet + 0.004 || p.canRaise === false) {
        action = 'call'; // фишек хватает только на колл (олл-ин)
      } else {
        const minRaiseTo = this.G.currentBet + this.G.minRaise;
        const wantsAllIn = raiseTo >= maxTotal - 0.004;
        raiseTo = wantsAllIn ? maxTotal : Math.max(raiseTo, minRaiseTo);
        raiseTo = Math.min(raiseTo, maxTotal);
        const raiseSize = raiseTo - this.G.currentBet;
        isFullRaise = raiseSize >= this.G.minRaise - 0.004;
      }
    }

    this.clearTurnTimer();
    let isAllIn = false;

    if (action === 'fold') {
      p.inHand = false; p.cards = []; p.lastAction = 'FOLD';
      p.canRaise = false;
    } else if (action === 'call') {
      const toCall = Math.min(Math.max(0, this.G.currentBet - p.bet), p.stack);
      p.stack = _money(p.stack - toCall);
      p.bet = _money(p.bet + toCall);
      this.G.pot = _money(this.G.pot + toCall);
      p.contributed = _money((p.contributed || 0) + toCall);
      p.lastAction = (toCall === 0 && this.G.currentBet === 0) ? 'CHECK' : 'CALL';
      p.canRaise = false;
      if (p.stack < 0.005) { p.stack = 0; p.lastAction = 'ALL-IN'; isAllIn = true; }
    } else if (action === 'raise') {
      const previousBet = this.G.currentBet;
      const toAdd = Math.min(Math.max(0, raiseTo - p.bet), p.stack);
      p.stack = _money(p.stack - toAdd);
      p.bet = _money(p.bet + toAdd);
      this.G.pot = _money(this.G.pot + toAdd);
      p.contributed = _money((p.contributed || 0) + toAdd);
      this.G.currentBet = p.bet;
      p.lastAction = previousBet < 0.005 ? 'BET' : 'RAISE';
      p.canRaise = false;
      if (p.stack < 0.005) { p.stack = 0; p.lastAction = 'ALL-IN'; isAllIn = true; }
      if (isFullRaise) this.G.minRaise = this.G.currentBet - previousBet;
      this.G.seats.forEach((s, i) => {
        if (!s || !s.inHand || i === seatIdx || s.stack <= 0) return;
        if (s.bet < this.G.currentBet - 0.004) s.acted = false;
        if (isFullRaise) s.canRaise = true;
      });
    }
    p.acted = true;
    const effectAction = p.lastAction === 'CHECK' ? 'check' : (p.lastAction === 'BET' ? 'bet' : action);
    this.broadcastAction(seatIdx, effectAction, action === 'raise' ? p.bet : 0, isAllIn);
    this.afterAction();
    return true;
  }

  afterAction() {
    if (this.disposed) return;
    const inHand = this.G.seats.filter(s => s && s.inHand);
    if (inHand.length <= 1) {
      this.G.actingSeat = -1;
      this.clearTurnTimer();
      this._schedule(() => this.endHand(), 1200);
    } else if (this.roundOver()) {
      this.clearTurnTimer();
      this._schedule(() => this.advancePhase(), 700);
    } else {
      this.G.actingSeat = this.nextSeat(this.G.actingSeat);
      this.startTurnTimer();
      this.scheduleBotAction();
    }
    this.broadcastState();
  }

  roundOver() {
    const active = this.G.seats.filter(s => s && s.inHand && s.stack > 0);
    return active.every(p => p.acted && Math.abs(p.bet - this.G.currentBet) < 0.005);
  }

  advancePhase() {
    if (this.disposed) return;
    this.G.seats.forEach(s => {
      if (s) {
        s.bet = 0;
        s.acted = false;
        s.canRaise = true;
        s.lastAction = '';
      }
    });
    this.G.currentBet = 0;
    this.G.minRaise = this.G.currentBb;
    this.G.boardPeekIdx = -1;

    if (this.G.phase === 'PREFLOP') {
      this.G.phase = 'FLOP';
      this.G.board.push(this.G.deck.pop(), this.G.deck.pop(), this.G.deck.pop());
    } else if (this.G.phase === 'FLOP') {
      this.G.phase = 'TURN'; this.G.board.push(this.G.deck.pop());
    } else if (this.G.phase === 'TURN') {
      this.G.phase = 'RIVER'; this.G.board.push(this.G.deck.pop());
    } else {
      this.endHand(); return;
    }

    const activeCount = this.G.seats.filter(s => s && s.inHand && s.stack > 0).length;
    if (activeCount < 2) {
      // All remaining players are all-in — run out the board automatically
      this.G.actingSeat = -1;
      this.clearTurnTimer();
      if (this.G.phase === 'TURN' || this.G.phase === 'RIVER') {
        this.G.boardPeekIdx = this.G.board.length - 1;
        this.broadcastState();
        this._schedule(() => this.advancePhase(), 4200);
      } else {
        this.broadcastState();
        this._schedule(() => this.advancePhase(), 1500);
      }
    } else {
      const nextActor = this.nextSeat(this.G.dealerSeat);
      this.G.actingSeat = nextActor;
      this.startTurnTimer();
      this.broadcastState();
      this.scheduleBotAction();
    }
  }

  _distributePots() {
    const ap = this.G.seats.filter(s => s && s.inHand);
    if (ap.length === 1) return [{ winners: ap, pot: this.G.pot }];

    const allContribs = this.G.seats.filter(s => s && (s.contributed || 0) > 0);
    const pots = [];
    const levels = [...new Set(allContribs.map(p => p.contributed || 0))]
      .filter(v => v > 0)
      .sort((a, b) => a - b);
    let prevLevel = 0;

    for (const level of levels) {
      const contributors = allContribs.filter(s => (s.contributed || 0) >= level);
      const potSize = _money((level - prevLevel) * contributors.length);
      const eligible = ap.filter(p => (p.contributed || 0) >= level);
      prevLevel = level;
      if (potSize <= 0 || eligible.length === 0) continue;

      const scores = eligible.map(p => getBestScore(p.cards, this.G.board));
      const best = Math.max(...scores);
      const winners = eligible.filter((_, idx) => scores[idx] === best);
      pots.push({ winners, pot: potSize });
    }

    const distributed = _money(pots.reduce((sum, p) => sum + p.pot, 0));
    const remainder = _money(this.G.pot - distributed);
    if (remainder > 0.004 && pots.length) {
      pots[pots.length - 1].pot = _money(pots[pots.length - 1].pot + remainder);
    }
    return pots;
  }

  endHand() {
    if (this.disposed) return;
    this.G.phase = 'SHOWDOWN';
    this.G.boardPeekIdx = -1;
    this.G.actingSeat = -1;
    this.G.seats.forEach(s => { if (s) s.lastAction = ''; });
    this.clearTurnTimer();

    const pots = this._distributePots();

    let firstWinnerSeat = -1;
    let firstPot = 0;
    let splitIdxs = null;
    let totalWonByName = {};

    pots.forEach(({ winners, pot }) => {
      if (winners.length === 1) {
        const winner = winners[0];
        winner.stack = _money(winner.stack + pot);
        const si = this.G.seats.indexOf(winner);
        if (firstWinnerSeat < 0) { firstWinnerSeat = si; firstPot = pot; }
        totalWonByName[winner.name] = _money((totalWonByName[winner.name] || 0) + pot);
      } else {
        const potCents = Math.round(pot * 100);
        const baseCents = Math.floor(potCents / winners.length);
        let oddCents = potCents - baseCents * winners.length;
        const ordered = [...winners].sort((a, b) => this.G.seats.indexOf(a) - this.G.seats.indexOf(b));
        ordered.forEach(p => {
          const award = (baseCents + (oddCents-- > 0 ? 1 : 0)) / 100;
          p.stack = _money(p.stack + award);
          totalWonByName[p.name] = _money((totalWonByName[p.name] || 0) + award);
        });
        if (firstWinnerSeat < 0) {
          splitIdxs = winners.map(p => this.G.seats.indexOf(p));
          firstPot = (baseCents + (potCents % winners.length > 0 ? 1 : 0)) / 100;
        }
      }
    });

    this.G.pot = 0;
    this.broadcastState();

    const winnerName = firstWinnerSeat >= 0 ? this.G.seats[firstWinnerSeat].name : '';
    const totalWon = totalWonByName[winnerName] || firstPot;

    this.io.to(this.id).emit('handWinners', {
      winnerName,
      firstPot,
      totalWon,
      firstWinnerSeat,
      splitIdxs,
      pots: pots.map(p => ({
        winners: p.winners.map(w => this.G.seats.indexOf(w)),
        pot: p.pot
      }))
    });

    this._schedule(() => {
      if (this.disposed) return;
      this._processEliminations();
      this.G.phase = 'WAITING';
      if (this._checkGameOver()) { this.broadcastState(); return; }
      this.startHand();
    }, 5000);
  }

  // Bust-outs: free the seat, announce the player's finishing place
  _processEliminations() {
    const busted = [];
    this.G.seats.forEach((s, i) => { if (s && s.stack < 0.005) busted.push({ s, i }); });
    // Меньше вложил в руку = меньше был стек = хуже место
    busted.sort((a, b) => (a.s.contributed || 0) - (b.s.contributed || 0));
    for (const { s, i } of busted) {
      const place = Math.max(1, this.totalEntrants - this.eliminatedCount);
      this.eliminatedCount++;
      for (const [sid, idx] of this.sockets) {
        if (idx === i) this.io.to(sid).emit('eliminated', { place, total: this.totalEntrants });
      }
      this.io.to(this.id).emit('playerEliminated', { seatIdx: i, name: s.name, place, total: this.totalEntrants });
      this.onEliminated?.({ playerId: s.playerId || null, place, seatIdx: i, name: s.name });
      this.G.seats[i] = null;
      if (s.playerId) this.players.delete(s.playerId);
      for (const [sid, idx] of [...this.sockets]) {
        if (idx === i) this.sockets.delete(sid);
      }
    }
  }

  _checkGameOver() {
    if (this.gameOver) return true;
    if (this.eliminatedCount === 0) return false;
    const alive = this.G.seats.filter(s => s && s.stack > 0);
    if (alive.length !== 1) return false;
    this.gameOver = true;
    this.clearTurnTimer();
    clearTimeout(this._startTimeout);
    this._startTimeout = null;
    const winner = alive[0];
    this.io.to(this.id).emit('gameOver', {
      winnerName: winner.name,
      winnerSeat: this.G.seats.indexOf(winner),
      total: this.totalEntrants
    });
    this.onGameOver?.({ winnerName: winner.name, winnerSeat: this.G.seats.indexOf(winner) });
    return true;
  }
}

module.exports = { PokerRoom, getBestScore };
