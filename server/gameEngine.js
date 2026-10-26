'use strict';

const { randomUUID, randomInt } = require('crypto');
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
      turnId: 0,
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
    this._handStepTimer = null;
    this._finalizedHandNum = -1;
    this.disposed = false;
    this.totalEntrants = 0;   // everyone who ever took a seat (for "place N of M")
    this.eliminatedCount = 0;
    this.gameOver = false;
    this.chatMessages = [];
    this.effectCooldowns = new Map();
    this.activeEffectTargets = new Map();
    this.processedActionCommands = new Set();
    this.processedActionCommandOrder = [];
    this.actionEventSequence = 0;
    this.onPersist = typeof options.onPersist === 'function' ? options.onPersist : null;
    this._persistTimer = null;
    this._pendingSnapshot = null;
    this.onEliminated = typeof options.onEliminated === 'function' ? options.onEliminated : null;
    this.onGameOver = typeof options.onGameOver === 'function' ? options.onGameOver : null;
    this.tournamentMode = options.tournamentMode === true;
    this.tableNumber = Math.max(1, Number(options.tableNumber) || 1);
    this.tablePaused = false;
    this.canStartHand = typeof options.canStartHand === 'function' ? options.canStartHand : null;
    this.onBetweenHands = typeof options.onBetweenHands === 'function' ? options.onBetweenHands : null;
    this.resolveElimination = typeof options.resolveElimination === 'function'
      ? options.resolveElimination : null;
    this.getTournamentMeta = typeof options.getTournamentMeta === 'function'
      ? options.getTournamentMeta : null;
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
    this.flushPersist();
    this.disposed = true;
    this.clearTurnTimer();
    this._clearHandStep();
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

  _clearHandStep() {
    if (!this._handStepTimer) return;
    clearTimeout(this._handStepTimer);
    this._transitionTimeouts.delete(this._handStepTimer);
    this._handStepTimer = null;
  }

  _scheduleHandStep(fn, ms) {
    this._clearHandStep();
    const expectedHandNum = this.G.handNum;
    const expectedPhase = this.G.phase;
    let timer = null;
    timer = this._schedule(() => {
      if (this._handStepTimer !== timer) return;
      this._handStepTimer = null;
      if (this.G.handNum !== expectedHandNum || this.G.phase !== expectedPhase) return;
      if (this._finalizedHandNum === expectedHandNum) return;
      fn();
    }, ms);
    this._handStepTimer = timer;
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
      finalizedHandNum: this._finalizedHandNum,
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
    this.G.turnId = Math.max(0, Number(this.G.turnId) || 0);
    this.totalEntrants = Math.max(Number(snapshot.totalEntrants) || 0, seats.filter(Boolean).length);
    this.eliminatedCount = Math.max(0, Number(snapshot.eliminatedCount) || 0);
    this.gameOver = !!snapshot.gameOver;
    const restoredFinalizedHandNum = Number(snapshot.finalizedHandNum);
    this._finalizedHandNum = Number.isInteger(restoredFinalizedHandNum)
      ? restoredFinalizedHandNum
      : (this.G.phase === 'SHOWDOWN' ? this.G.handNum : -1);
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
      const contenders = this.G.seats.filter(seat => seat && seat.inHand);
      if (contenders.length === 1) {
        this._scheduleHandStep(() => this.endHand(), 1000);
      } else if (this.G.actingSeat === -1 || this.roundOver()) {
        this._scheduleHandStep(() => this.advancePhase(), 1000);
      } else {
        this.startTurnTimer();
        this.scheduleBotAction();
        this.broadcastState();
      }
    }
  }

  _isAllInRunout() {
    if (!['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(this.G.phase)) return false;
    if (this.G.actingSeat !== -1) return false;
    const contenders = this.G.seats.filter(s => s && s.inHand);
    if (contenders.length <= 1) return false;
    return contenders.filter(s => s.stack > 0).length <= 1;
  }

  // True when face-down cards must be revealed to everyone (showdown / all-in runout)
  _revealAll() {
    const inHandCount = this.G.seats.filter(s => s && s.inHand).length;
    if (inHandCount <= 1) return false;
    return this.G.phase === 'SHOWDOWN' || this._isAllInRunout();
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
    const tournamentMeta = this.getTournamentMeta?.() || {};
    return {
      seats,
      board: G.board,
      pot: G.pot,
      currentBet: G.currentBet,
      minRaise: G.minRaise,
      phase: G.phase,
      dealerSeat: G.dealerSeat,
      actingSeat: G.actingSeat,
      turnId: G.turnId,
      handNum: G.handNum,
      boardPeekIdx: G.boardPeekIdx,
      turnTimeMs: G.turnTimeMs,
      turnRemainingMs: G.actingDeadline ? Math.max(0, G.actingDeadline - Date.now()) : null,
      serverNow: Date.now(),
      yourSeat: (viewerSeat === undefined || viewerSeat === null) ? -1 : viewerSeat,
      gameOver: this.gameOver,
      tournamentId: tournamentMeta.tournamentId || this.tournamentId || this.id,
      tableId: this.id,
      tableNumber: tournamentMeta.tableNumber || this.tableNumber,
      tablePaused: this.tablePaused,
      activeTables: tournamentMeta.activeTables || 1,
      finalTable: !!tournamentMeta.finalTable,
      totalEntrants: tournamentMeta.totalEntrants || this.totalEntrants,
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
      playersRemaining: tournamentMeta.playersRemaining ?? alive.length
    };
  }

  broadcastState() {
    this.queuePersist();
    const ids = this.io.sockets.adapter.rooms.get(this.id);
    if (!ids) return;
    for (const sid of ids) {
      const sock = this.io.sockets.sockets.get(sid);
      if (!sock) continue;
      const seatIdx = this.sockets.has(sid) ? this.sockets.get(sid) : -1;
      sock.emit('stateUpdate', this.sanitizedState(seatIdx));
    }
  }

  queuePersist() {
    if (!this.onPersist || this.disposed) return;
    this._pendingSnapshot = this.getSnapshot();
    // WAL/NORMAL makes this write cheap enough to commit before clients observe
    // the new state. This removes the old 120 ms process-crash loss window.
    this.flushPersist();
  }

  flushPersist() {
    clearTimeout(this._persistTimer);
    this._persistTimer = null;
    const snapshot = this._pendingSnapshot;
    this._pendingSnapshot = null;
    if (!snapshot || !this.onPersist) return;
    this.onPersist(snapshot);
  }

  broadcastAction(seatIdx, action, amount, isAllIn = false) {
    const eventId = `${this.id}:${this.G.handNum}:${++this.actionEventSequence}`;
    this.io.to(this.id).emit('playerActionEffect', { seatIdx, action, amount, isAllIn, eventId });
  }

  _beginTurn(seatIdx) {
    this.G.actingSeat = seatIdx;
    this.G.turnId = Math.max(0, Number(this.G.turnId) || 0) + 1;
  }

  _captureTurnGuard(seatIdx = this.G.actingSeat) {
    return {
      handNum: this.G.handNum,
      turnId: this.G.turnId,
      phase: this.G.phase,
      seatIdx,
      player: this.G.seats[seatIdx] || null
    };
  }

  _isTurnGuardCurrent(expected) {
    if (!expected || this.disposed || this.gameOver) return false;
    if (!['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(this.G.phase)) return false;
    return this.G.handNum === expected.handNum
      && this.G.turnId === expected.turnId
      && this.G.phase === expected.phase
      && this.G.actingSeat === expected.seatIdx
      && this.G.seats[expected.seatIdx] === expected.player
      && !!expected.player?.inHand;
  }

  actionCommandStatus(commandId, turnId) {
    if (commandId == null || commandId === '') return { ok: true, legacy: true };
    const id = String(commandId);
    if (id.length < 8 || id.length > 128) return { ok: false, reason: 'INVALID_COMMAND' };
    if (this.processedActionCommands.has(id)) return { ok: false, duplicate: true, reason: 'DUPLICATE' };
    if (!Number.isInteger(Number(turnId)) || Number(turnId) !== Number(this.G.turnId)) {
      return { ok: false, reason: 'STALE_TURN' };
    }
    return { ok: true };
  }

  _recordActionCommand(commandId) {
    if (commandId == null || commandId === '') return;
    const id = String(commandId);
    this.processedActionCommands.add(id);
    this.processedActionCommandOrder.push(id);
    while (this.processedActionCommandOrder.length > 500) {
      this.processedActionCommands.delete(this.processedActionCommandOrder.shift());
    }
  }

  addPlayer(seatIdx, player) {
    if (this.gameOver) return false;
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= this.maxPlayers) return false;
    if (this.G.seats[seatIdx]) return false;
    if (player.playerId && this.players.has(player.playerId)) {
      const mappedSeat = this.players.get(player.playerId);
      if (this.G.seats[mappedSeat]?.playerId === player.playerId) return false;
      this.players.delete(player.playerId);
    }
    if (player.playerId && this.G.seats.some(seat => seat?.playerId === player.playerId)) return false;
    const connected = player.connected !== false;
    this.G.seats[seatIdx] = {
      ...player,
      publicPlayerId: player.publicPlayerId || randomUUID(),
      stack: Number.isFinite(Number(player.stack)) ? Number(player.stack) : this.config.startStack,
      bet: 0,
      inHand: false,
      acted: false,
      cards: [],
      lastAction: '',
      isBot: player.isBot === true,
      contributed: 0,
      connected,
      sittingOut: !connected || player.sittingOut === true
    };
    if (player.playerId) this.players.set(player.playerId, seatIdx);
    if (player.countEntrant !== false) this.totalEntrants++;

    this.broadcastState();
    this.maybeStartHand();
    return true;
  }

  isBetweenHands() {
    return this.G.phase === 'WAITING' && this.G.actingSeat === -1;
  }

  setTournamentPaused(paused) {
    this.tablePaused = !!paused;
    if (this.tablePaused) {
      clearTimeout(this._startTimeout);
      this._startTimeout = null;
    }
    this.broadcastState();
  }

  exportTournamentPlayer(playerId) {
    if (!this.tournamentMode || !playerId) return null;
    const seatIdx = this.players.get(playerId);
    const player = seatIdx === undefined ? null : this.G.seats[seatIdx];
    if (!player) return null;
    // A player may be removed from a running destination table only while
    // waiting for their first hand. Active-hand participants never move.
    if (!this.isBetweenHands() && player.inHand) return null;
    const exported = { ...player, cards: [], bet: 0, contributed: 0, inHand: false, acted: false };
    this.G.seats[seatIdx] = null;
    this.players.delete(playerId);
    for (const [socketId, mappedSeat] of [...this.sockets]) {
      if (mappedSeat === seatIdx) this.sockets.delete(socketId);
    }
    this.broadcastState();
    return { player: exported, seatIdx };
  }

  importTournamentPlayer(seatIdx, player) {
    if (!this.tournamentMode) return false;
    const isBot = player.isBot === true;
    return this.addPlayer(seatIdx, {
      ...player,
      id: null,
      isBot,
      connected: isBot,
      sittingOut: !isBot,
      countEntrant: false,
      stack: Number(player.stack)
    });
  }

  finishTournament(winner, totalEntrants) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.tablePaused = true;
    this.clearTurnTimer();
    clearTimeout(this._startTimeout);
    this._startTimeout = null;
    const winnerSeat = winner ? this.G.seats.findIndex(seat => seat?.playerId === winner.playerId) : -1;
    this.io.to(this.id).emit('gameOver', {
      winnerName: winner?.name || '',
      winnerSeat,
      total: totalEntrants || this.totalEntrants
    });
    this.broadcastState();
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
      serverStartTime: now + 900,
      startDelayMs: 900
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
    if (p.isBot) return -1;
    for (const [sid, idx] of [...this.sockets]) {
      if (idx === seatIdx && sid !== socketId) {
        this.sockets.delete(sid);
        this.io.to(sid).emit('sessionReplaced', { seatIdx });
      }
    }
    p.id = socketId;
    p.connected = true;
    p.sittingOut = false;
    this.sockets.set(socketId, seatIdx);
    // Resume a persisted hand as soon as any participant returns. A live turn
    // keeps its absolute deadline so reconnecting cannot extend the clock.
    const actor = this.G.seats[this.G.actingSeat];
    if (actor?.inHand && !this.turnTimer) {
      const savedDeadline = Number(this.G.actingDeadline);
      const deadline = Number.isFinite(savedDeadline) && savedDeadline > 0
        ? savedDeadline
        : null;
      this.startTurnTimer(undefined, deadline ? { deadline } : undefined);
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
    if (this.tablePaused || (this.canStartHand && !this.canStartHand(this.id))) return;
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

  startTurnTimer(ms, options = {}) {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    const seatIdx = this.G.actingSeat;
    if (seatIdx === -1) return;
    const p = this.G.seats[seatIdx];
    if (!p) return;
    if (!ms) ms = (p.isBot || p.connected) ? this.TURN_MS : this.OFFLINE_TURN_MS;
    const requestedDeadline = Number(options?.deadline);
    const hasSavedDeadline = Number.isFinite(requestedDeadline) && requestedDeadline > 0;
    const deadline = hasSavedDeadline ? requestedDeadline : Date.now() + ms;
    const remainingMs = Math.max(0, deadline - Date.now());
    const turnGuard = this._captureTurnGuard(seatIdx);
    this.G.turnTimeMs = hasSavedDeadline && Number(this.G.turnTimeMs) > 0
      ? Number(this.G.turnTimeMs)
      : ms;
    this.G.actingDeadline = deadline;
    let timer = null;
    timer = setTimeout(() => {
      if (this.turnTimer !== timer) return;
      this.turnTimer = null;
      if (!this._isTurnGuardCurrent(turnGuard)) return;
      const cur = this.G.seats[seatIdx];
      const toCall = this.G.currentBet - cur.bet;
      this.doAction(seatIdx, toCall > 0 ? 'fold' : 'check', 0);
    }, remainingMs + 200);
    this.turnTimer = timer;
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
    this._clearHandStep();
    clearTimeout(this._startTimeout);
    this._startTimeout = null;
    if (!this.scheduledStartReady()) {
      this.G.phase = 'WAITING';
      this.G.actingSeat = -1;
      this.clearTurnTimer();
      this.broadcastState();
      return;
    }
    if (this.tablePaused || (this.canStartHand && !this.canStartHand(this.id))) {
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
    // Room rule: heads-up action matches the short all-in blind actually posted.
    // Multiway play keeps the configured full big-blind bring-in.
    this.G.currentBet = inHandCount === 2
      ? Math.max(this.G.seats[sbIdx]?.bet || 0, this.G.seats[bbIdx]?.bet || 0)
      : this.G.currentBb;
    this.G.minRaise = this.G.currentBb;
    this._beginTurn(this.nextSeat(bbIdx));

    if (this.G.actingSeat === -1 || !this.hasPendingBettingDecision()) {
      this.G.actingSeat = -1;
      this.broadcastState();
      this._scheduleHandStep(() => this.advancePhase(), 1200);
    } else {
      this.startTurnTimer();
      this.broadcastState();
      this.scheduleBotAction();
    }
  }

  scheduleBotAction() {
    if (this.disposed) return;
    if (this.G.actingSeat === -1) return;
    const seatIdx = this.G.actingSeat;
    const p = this.G.seats[seatIdx];
    if (!p || !p.isBot) return;
    const turnGuard = this._captureTurnGuard(seatIdx);

    const delay = 1500 + Math.random() * 2000;
    this._schedule(() => {
      if (!this._isTurnGuardCurrent(turnGuard)) return;
      const bot = this.G.seats[seatIdx];
      if (!bot || !bot.isBot) return;

      const toCall = this.G.currentBet - bot.bet;
      let action = toCall > 0 ? 'call' : 'check';
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
          seatIdx,
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
        } else if (roll < foldChance + 0.12 && this.canSeatRaise(seatIdx)) {
          action = 'raise';
          amount = this.G.currentBet + Math.max(this.G.currentBb * 2, toCall);
        }
      } else if (roll < 0.2 && this.canSeatRaise(seatIdx)) {
        action = 'raise';
        amount = this.G.currentBet + this.G.currentBb * 2;
      }

      this.doAction(seatIdx, action, amount);
    }, delay);
  }

  makeDeck() {
    const S = ['♠', '♥', '♦', '♣'], V = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const d = [];
    S.forEach(s => V.forEach(v => d.push({ v, s })));
    return d;
  }

  shuffle(d) {
    for (let i = d.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [d[i], d[j]] = [d[j], d[i]];
    }
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

  canSeatRaise(seatIdx) {
    const p = this.G.seats[seatIdx];
    if (!p || !p.inHand || p.canRaise === false) return false;
    if (p.bet + p.stack <= this.G.currentBet + 0.004) return false;
    return this.G.seats.some((seat, idx) => (
      idx !== seatIdx && seat?.inHand && seat.stack > 0
    ));
  }

  hasPendingBettingDecision() {
    const ableToAct = this.G.seats.filter(seat => seat && seat.inHand && seat.stack > 0);
    if (!ableToAct.length) return false;
    if (ableToAct.some(seat => this.G.currentBet - seat.bet > 0.004)) return true;
    if (ableToAct.length < 2) return false;
    return ableToAct.some(seat => !seat.acted || Math.abs(seat.bet - this.G.currentBet) >= 0.005);
  }

  validateAction(seatIdx, action, raiseTo, command = {}) {
    if (this.disposed) return { ok: false, reason: 'ROOM_UNAVAILABLE' };
    if (!['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(this.G.phase)) {
      return { ok: false, reason: 'ACTION_UNAVAILABLE' };
    }
    if (seatIdx !== this.G.actingSeat) return { ok: false, reason: 'NOT_YOUR_TURN' };
    const p = this.G.seats[seatIdx];
    if (!p || !p.inHand || p.stack <= 0) return { ok: false, reason: 'PLAYER_UNAVAILABLE' };
    const commandStatus = this.actionCommandStatus(command.commandId, command.turnId);
    if (!commandStatus.ok) return commandStatus;
    if (!['fold', 'check', 'call', 'raise'].includes(action)) {
      return { ok: false, reason: 'INVALID_ACTION' };
    }

    const toCall = _money(Math.max(0, this.G.currentBet - p.bet));
    if (action === 'check') {
      return toCall < 0.005
        ? { ok: true, action, toCall: 0 }
        : { ok: false, reason: 'CHECK_REQUIRES_NO_BET' };
    }
    if (action === 'call') {
      return toCall >= 0.005
        ? { ok: true, action, toCall: Math.min(toCall, p.stack) }
        : { ok: false, reason: 'CALL_REQUIRES_BET' };
    }
    if (action === 'fold') return { ok: true, action, toCall };
    if (!this.canSeatRaise(seatIdx)) return { ok: false, reason: 'RAISE_UNAVAILABLE' };
    if (typeof raiseTo !== 'number' || !Number.isFinite(raiseTo) || raiseTo < 0) {
      return { ok: false, reason: 'INVALID_RAISE_AMOUNT' };
    }
    const normalizedRaiseTo = _money(raiseTo);
    if (Math.abs(normalizedRaiseTo - raiseTo) > 0.000001) {
      return { ok: false, reason: 'INVALID_RAISE_AMOUNT' };
    }

    const maxTotal = _money(p.bet + p.stack);
    const minRaiseTo = _money(this.G.currentBet + this.G.minRaise);
    if (normalizedRaiseTo > maxTotal + 0.004) {
      return { ok: false, reason: 'RAISE_EXCEEDS_STACK' };
    }
    if (normalizedRaiseTo <= this.G.currentBet + 0.004) {
      return { ok: false, reason: 'RAISE_MUST_INCREASE_BET' };
    }
    const isAllIn = Math.abs(normalizedRaiseTo - maxTotal) < 0.005;
    if (!isAllIn && normalizedRaiseTo < minRaiseTo - 0.004) {
      return { ok: false, reason: 'RAISE_BELOW_MINIMUM' };
    }
    const raiseSize = _money(normalizedRaiseTo - this.G.currentBet);
    return {
      ok: true,
      action,
      raiseTo: normalizedRaiseTo,
      isFullRaise: raiseSize >= this.G.minRaise - 0.004
    };
  }

  doAction(seatIdx, action, raiseTo, command = {}) {
    const validation = this.validateAction(seatIdx, action, raiseTo, command);
    if (!validation.ok) return false;
    const p = this.G.seats[seatIdx];
    raiseTo = validation.raiseTo;
    const isFullRaise = validation.isFullRaise === true;

    this._recordActionCommand(command.commandId);
    this.clearTurnTimer();
    let isAllIn = false;

    if (action === 'fold') {
      p.inHand = false; p.cards = []; p.lastAction = 'FOLD';
      p.canRaise = false;
    } else if (action === 'check') {
      p.lastAction = 'CHECK';
      p.canRaise = false;
    } else if (action === 'call') {
      const toCall = validation.toCall;
      p.stack = _money(p.stack - toCall);
      p.bet = _money(p.bet + toCall);
      this.G.pot = _money(this.G.pot + toCall);
      p.contributed = _money((p.contributed || 0) + toCall);
      p.lastAction = 'CALL';
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
    const effectAction = p.lastAction === 'BET' ? 'bet' : action;
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
      this._scheduleHandStep(() => this.endHand(), 1200);
    } else if (this.roundOver()) {
      this.G.actingSeat = -1;
      this.clearTurnTimer();
      this._scheduleHandStep(() => this.advancePhase(), 700);
    } else {
      this._beginTurn(this.nextSeat(this.G.actingSeat));
      this.startTurnTimer();
      this.scheduleBotAction();
    }
    this.broadcastState();
  }

  roundOver() {
    return !this.hasPendingBettingDecision();
  }

  advancePhase() {
    if (this.disposed || this._finalizedHandNum === this.G.handNum) return false;
    if (!['PREFLOP', 'FLOP', 'TURN', 'RIVER'].includes(this.G.phase)) return false;
    this._clearHandStep();
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
      return this.endHand();
    }

    const activeCount = this.G.seats.filter(s => s && s.inHand && s.stack > 0).length;
    if (activeCount < 2) {
      // All remaining players are all-in — run out the board automatically
      this.G.actingSeat = -1;
      this.clearTurnTimer();
      if (this.G.phase === 'TURN' || this.G.phase === 'RIVER') {
        this.G.boardPeekIdx = this.G.board.length - 1;
        this.broadcastState();
        // The river needs extra network/render margin on slower mobile links.
        // The client auto-peel plus final flip takes about 3.25 seconds.
        const revealDelayMs = this.G.phase === 'RIVER' ? 6000 : 4200;
        this._scheduleHandStep(() => this.advancePhase(), revealDelayMs);
      } else {
        this.broadcastState();
        this._scheduleHandStep(() => this.advancePhase(), 1500);
      }
    } else {
      const nextActor = this.nextSeat(this.G.dealerSeat);
      this._beginTurn(nextActor);
      this.startTurnTimer();
      this.broadcastState();
      this.scheduleBotAction();
    }
    return true;
  }

  _distributePots() {
    const ap = this.G.seats.filter(s => s && s.inHand);
    const allContribs = this.G.seats.filter(s => s && (s.contributed || 0) > 0);
    const pots = [];
    const refunds = [];
    const levels = [...new Set(allContribs.map(p => p.contributed || 0))]
      .filter(v => v > 0)
      .sort((a, b) => a - b);
    let prevLevel = 0;

    for (const level of levels) {
      const contributors = allContribs.filter(s => (s.contributed || 0) >= level);
      const potSize = _money((level - prevLevel) * contributors.length);
      prevLevel = level;
      if (potSize <= 0) continue;

      // A contribution slice with only one participant was never called.
      if (contributors.length === 1) {
        refunds.push({ player: contributors[0], amount: potSize });
        continue;
      }

      const eligible = ap.filter(p => (p.contributed || 0) >= level);
      if (eligible.length === 0) continue;

      let winners = eligible;
      if (eligible.length > 1) {
        const scores = eligible.map(p => getBestScore(p.cards, this.G.board));
        const best = Math.max(...scores);
        winners = eligible.filter((_, idx) => scores[idx] === best);
      }
      pots.push({ winners, pot: potSize });
    }

    const accounted = _money(
      pots.reduce((sum, p) => sum + p.pot, 0)
      + refunds.reduce((sum, refund) => sum + refund.amount, 0)
    );
    const remainder = _money(this.G.pot - accounted);
    if (remainder > 0.004) {
      if (pots.length) pots[pots.length - 1].pot = _money(pots[pots.length - 1].pot + remainder);
      else if (refunds.length) refunds[refunds.length - 1].amount = _money(refunds[refunds.length - 1].amount + remainder);
    }
    return { pots, refunds };
  }

  _winnersClockwiseFromButton(winners) {
    const firstSeat = (this.G.dealerSeat + 1 + this.maxPlayers) % this.maxPlayers;
    return [...winners].sort((left, right) => {
      const leftSeat = this.G.seats.indexOf(left);
      const rightSeat = this.G.seats.indexOf(right);
      const leftDistance = (leftSeat - firstSeat + this.maxPlayers) % this.maxPlayers;
      const rightDistance = (rightSeat - firstSeat + this.maxPlayers) % this.maxPlayers;
      return leftDistance - rightDistance;
    });
  }

  _chipUnitForPot(pot) {
    const tournamentValues = [pot, this.G.currentSb, this.G.currentBb, this.G.currentAnte];
    const usesWholeChips = this.tournamentMode && tournamentValues.every(value => (
      Math.abs(Number(value) - Math.round(Number(value))) < 0.005
    ));
    return usesWholeChips ? 1 : 0.01;
  }

  endHand() {
    if (this.disposed || this.G.handNum <= 0) return false;
    if (this._finalizedHandNum === this.G.handNum) return false;
    const contenders = this.G.seats.filter(s => s && s.inHand);
    if (contenders.length === 0) return false;
    // A contested hand cannot be settled before the full board is available.
    // An uncontested fold win remains immediate on any street.
    if (contenders.length > 1 && this.G.board.length !== 5) return false;

    const finalizedHandNum = this.G.handNum;
    this._finalizedHandNum = finalizedHandNum;
    this._clearHandStep();
    this.G.phase = 'SHOWDOWN';
    this.G.boardPeekIdx = -1;
    this.G.actingSeat = -1;
    this.G.seats.forEach(s => { if (s) s.lastAction = ''; });
    this.clearTurnTimer();

    const { pots, refunds } = this._distributePots();

    const refundDetails = refunds.map(({ player, amount }) => {
      player.stack = _money(player.stack + amount);
      return {
        seatIdx: this.G.seats.indexOf(player),
        name: player.name,
        amount
      };
    });

    let firstWinnerSeat = -1;
    let firstPot = 0;
    let splitIdxs = null;
    const totalWonBySeat = new Map();

    pots.forEach(({ winners, pot }) => {
      if (winners.length === 1) {
        const winner = winners[0];
        winner.stack = _money(winner.stack + pot);
        const si = this.G.seats.indexOf(winner);
        if (firstWinnerSeat < 0) { firstWinnerSeat = si; firstPot = pot; }
        totalWonBySeat.set(si, _money((totalWonBySeat.get(si) || 0) + pot));
      } else {
        const chipUnit = this._chipUnitForPot(pot);
        const potUnits = Math.round(pot / chipUnit);
        const baseUnits = Math.floor(potUnits / winners.length);
        let oddUnits = potUnits - baseUnits * winners.length;
        // Poker TDA rule: odd chips go clockwise to the first tied winner
        // left of the button. Apply the order independently for every pot.
        const ordered = this._winnersClockwiseFromButton(winners);
        ordered.forEach(p => {
          const award = _money((baseUnits + (oddUnits-- > 0 ? 1 : 0)) * chipUnit);
          p.stack = _money(p.stack + award);
          const si = this.G.seats.indexOf(p);
          totalWonBySeat.set(si, _money((totalWonBySeat.get(si) || 0) + award));
        });
        if (firstWinnerSeat < 0) {
          splitIdxs = ordered.map(p => this.G.seats.indexOf(p));
          firstPot = _money((baseUnits + (potUnits % winners.length > 0 ? 1 : 0)) * chipUnit);
        }
      }
    });

    this.G.pot = 0;
    this.broadcastState();

    const winnerName = firstWinnerSeat >= 0 ? this.G.seats[firstWinnerSeat].name : '';
    const totalWon = totalWonBySeat.get(firstWinnerSeat) || firstPot;
    const awards = [...totalWonBySeat.entries()]
      .sort(([seatA], [seatB]) => seatA - seatB)
      .map(([seatIdx, amount]) => ({
        seatIdx,
        name: this.G.seats[seatIdx]?.name || '',
        amount
      }));

    this.io.to(this.id).emit('handWinners', {
      eventId: `${this.id}:${finalizedHandNum}:hand-winners`,
      handNum: finalizedHandNum,
      winnerName,
      firstPot,
      totalWon,
      firstWinnerSeat,
      splitIdxs,
      winnerSeatIdxs: awards.map(award => award.seatIdx),
      winnerNames: awards.map(award => award.name),
      awards,
      refunds: refundDetails,
      pots: pots.map(p => ({
        winners: p.winners.map(w => this.G.seats.indexOf(w)),
        pot: p.pot
      }))
    });

    this._schedule(() => {
      if (this.disposed) return;
      if (this.G.handNum !== finalizedHandNum || this.G.phase !== 'SHOWDOWN') return;
      this._processEliminations();
      this.G.phase = 'WAITING';
      if (this._checkGameOver()) { this.broadcastState(); return; }
      const shouldContinue = this.onBetweenHands ? this.onBetweenHands(this.id) !== false : true;
      if (shouldContinue) this.startHand();
      else this.broadcastState();
    }, 5000);
    return true;
  }

  // Bust-outs: free the seat, announce the player's finishing place
  _processEliminations() {
    const busted = [];
    this.G.seats.forEach((s, i) => { if (s && s.stack < 0.005) busted.push({ s, i }); });
    // Меньше вложил в руку = меньше был стек = хуже место
    busted.sort((a, b) => (a.s.contributed || 0) - (b.s.contributed || 0));
    for (const { s, i } of busted) {
      const resolved = this.resolveElimination?.({
        tableId: this.id,
        playerId: s.playerId || null,
        name: s.name,
        seatIdx: i,
        contributed: s.contributed || 0
      });
      const place = Math.max(1, Number(resolved?.place) || (this.totalEntrants - this.eliminatedCount));
      const total = Math.max(place, Number(resolved?.total) || this.totalEntrants);
      this.eliminatedCount++;
      for (const [sid, idx] of this.sockets) {
        if (idx === i) this.io.to(sid).emit('eliminated', { place, total });
      }
      this.io.to(this.id).emit('playerEliminated', { seatIdx: i, name: s.name, place, total });
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
    if (this.tournamentMode) return false;
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
