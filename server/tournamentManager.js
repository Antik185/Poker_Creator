'use strict';

const crypto = require('crypto');

const TABLE_STATES = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  BREAKING: 'BREAKING',
  FINISHED: 'FINISHED',
  CLOSED: 'CLOSED'
});

function getRequiredTableCount(activePlayers, maxSeats) {
  const players = Math.max(0, Number(activePlayers) || 0);
  const seats = Math.max(2, Number(maxSeats) || 2);
  return players === 0 ? 0 : Math.ceil(players / seats);
}

function getTargetDistribution(activePlayers, maxSeats) {
  const tableCount = getRequiredTableCount(activePlayers, maxSeats);
  if (!tableCount) return [];
  const base = Math.floor(activePlayers / tableCount);
  const extra = activePlayers % tableCount;
  return Array.from({ length: tableCount }, (_, index) => base + (index < extra ? 1 : 0));
}

function secureShuffle(values, randomInt = crypto.randomInt) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

class TournamentManager {
  constructor(options) {
    this.id = options.id;
    this.config = options.config;
    this.io = options.io;
    this.clock = options.clock;
    this.maxSeats = Number(this.config.maxPlayers) === 9 ? 9 : 6;
    this.maxEntrants = Math.max(this.maxSeats, Number(this.config.maxEntrants) || 90);
    this.createTable = options.createTable;
    this.closeTable = options.closeTable;
    this.saveState = options.saveState || (() => {});
    this.assignPlayer = options.assignPlayer || (() => {});
    this.prepareMove = options.prepareMove || (() => {});
    this.commitMove = options.commitMove || (() => ({ committed: true }));
    this.resolveMove = options.resolveMove || (() => {});
    this.setPlayerPending = options.setPlayerPending || (() => {});
    this.markEliminated = options.markEliminated || (() => {});
    this.markWinner = options.markWinner || (() => {});
    this.onChanged = options.onChanged || (() => {});
    this.onPlayerMoved = options.onPlayerMoved || (() => {});
    this.isRegistrationClosed = options.isRegistrationClosed || (() => false);
    this.registrationClosesAt = Number(options.registrationClosesAt) || null;
    this.randomInt = options.randomInt || crypto.randomInt;
    this.tables = new Map();
    this.players = new Map();
    this.status = options.snapshot?.status || 'SCHEDULED';
    this.nextTableNumber = Math.max(1, Number(options.snapshot?.nextTableNumber) || 1);
    this.finalTable = !!options.snapshot?.finalTable;
    this.finishedAt = Number(options.snapshot?.finishedAt) || null;
    this.winnerPlayerId = options.snapshot?.winnerPlayerId || null;
    this.stateVersion = Math.max(0, Number(options.snapshot?.stateVersion) || 0);
    this.moveJournal = Array.isArray(options.snapshot?.moveJournal)
      ? options.snapshot.moveJournal.slice(-200) : [];
    this.balanceScheduled = false;
    this.balanceRunning = false;
    this.pendingPlan = null;
    this.registrationCloseTimer = null;
    this.disposed = false;
    this._unsubscribeClock = this.clock.subscribe(state => {
      if (this.disposed || this.status !== 'RUNNING') return;
      this.stateVersion++;
      this._persist();
      this.io.to(`tournament:${this.id}`).emit('tournament_level_changed', {
        eventId: crypto.randomUUID(),
        stateVersion: this.stateVersion,
        tournamentId: this.id,
        level: state.level,
        sb: state.sb,
        bb: state.bb,
        ante: state.ante,
        remainingMs: state.remainingMs,
        nextLevel: state.next
      });
      this.onChanged();
    });
  }

  tableIdFor(number) {
    return number === 1 ? this.id : `${this.id}--table-${number}`;
  }

  addRestoredTable({ tableId, tableNumber, status = TABLE_STATES.ACTIVE, room }) {
    const entry = {
      id: tableId,
      number: Number(tableNumber) || 1,
      status: Object.values(TABLE_STATES).includes(status) ? status : TABLE_STATES.ACTIVE,
      room
    };
    this.tables.set(tableId, entry);
    this.nextTableNumber = Math.max(this.nextTableNumber, entry.number + 1);
    room.tableNumber = entry.number;
    room.tablePaused = entry.status !== TABLE_STATES.ACTIVE;
    this._indexRoomPlayers(entry);
    return entry;
  }

  syncRegistrations(registrations) {
    for (const registration of registrations || []) {
      const existing = this.players.get(registration.player_id) || {};
      const existingHasStack = existing.stack !== null && existing.stack !== undefined
        && Number.isFinite(Number(existing.stack));
      const registrationHasStack = registration.stack !== null && registration.stack !== undefined
        && Number.isFinite(Number(registration.stack));
      this.players.set(registration.player_id, {
        ...existing,
        playerId: registration.player_id,
        name: registration.name,
        status: registration.status || 'ACTIVE',
        tableId: existing.tableId || registration.table_id || null,
        seatIdx: Number.isInteger(existing.seatIdx) ? existing.seatIdx
          : (Number.isInteger(registration.seat_idx) ? registration.seat_idx : null),
        stack: existingHasStack ? Number(existing.stack)
          : (registrationHasStack ? Number(registration.stack) : Number(this.config.startStack)),
        moveCount: Math.max(Number(existing.moveCount) || 0, Number(registration.move_count) || 0),
        eliminatedPlace: registration.eliminated_place || null,
        isBot: registration.is_bot === 1 || registration.isBot === true || existing.isBot === true
      });
    }
    for (const table of this.activeTables()) this._indexRoomPlayers(table);

    // A crash can happen after the source-table snapshot was persisted but
    // before the registration row received its new table. Treat stale seat
    // references as pending instead of losing the player or their stack.
    const actualSeats = new Map();
    for (const table of this.activeTables()) {
      table.room.G.seats.forEach((seat, seatIdx) => {
        if (seat?.playerId) actualSeats.set(seat.playerId, { tableId: table.id, seatIdx, stack: seat.stack });
      });
    }
    for (const player of this.activePlayers()) {
      const actual = actualSeats.get(player.playerId);
      if (actual) {
        player.tableId = actual.tableId;
        player.seatIdx = actual.seatIdx;
        player.stack = Number(actual.stack);
        continue;
      }
      player.tableId = null;
      player.seatIdx = null;
    }
  }

  recoverPendingMoves(moves) {
    const summary = { committed: 0, rolledBack: 0, pending: 0, duplicatesRemoved: 0 };
    for (const move of moves || []) {
      const record = this.players.get(move.player_id);
      if (!record || record.status !== 'ACTIVE') {
        this.resolveMove(this.id, move.move_id, 'ROLLED_BACK');
        summary.rolledBack++;
        continue;
      }

      const occurrences = [];
      for (const table of this.activeTables()) {
        table.room.G.seats.forEach((seat, seatIdx) => {
          if (seat?.playerId === move.player_id) {
            occurrences.push({ table, seat, seatIdx });
          }
        });
      }
      const target = occurrences.find(item => item.table.id === move.to_table_id);
      const source = occurrences.find(item => item.table.id === move.from_table_id);
      const canonical = target || source || occurrences[0] || null;

      for (const occurrence of occurrences) {
        if (occurrence === canonical) continue;
        const removed = occurrence.table.room.exportTournamentPlayer(move.player_id);
        if (!removed) throw new Error(`Unable to remove duplicate tournament seat for ${move.player_id}`);
        summary.duplicatesRemoved++;
      }

      if (!canonical) {
        const stack = Math.max(0, Number(move.stack) || Number(record.stack) || 0);
        record.tableId = null;
        record.seatIdx = null;
        record.stack = stack;
        this.setPlayerPending(this.id, record.playerId, stack);
        this.resolveMove(this.id, move.move_id, 'RECOVERED_PENDING');
        summary.pending++;
        continue;
      }

      record.tableId = canonical.table.id;
      record.seatIdx = canonical.seatIdx;
      record.stack = Math.max(0, Number(canonical.seat.stack) || 0);
      if (canonical === target) {
        const committed = this.commitMove(
          this.id,
          move.move_id,
          canonical.table.id,
          canonical.seatIdx,
          record.stack
        );
        if (!committed?.alreadyCommitted && Number(move.counts_as_move)) {
          record.moveCount = (Number(record.moveCount) || 0) + 1;
        }
        summary.committed++;
      } else {
        this.assignPlayer(
          this.id,
          record.playerId,
          canonical.table.id,
          canonical.seatIdx,
          record.stack,
          false
        );
        this.resolveMove(this.id, move.move_id, 'ROLLED_BACK');
        summary.rolledBack++;
      }
    }
    return summary;
  }

  _indexRoomPlayers(table) {
    table.room.G.seats.forEach((seat, seatIdx) => {
      if (!seat?.playerId) return;
      const existing = this.players.get(seat.playerId) || {};
      this.players.set(seat.playerId, {
        ...existing,
        playerId: seat.playerId,
        publicPlayerId: seat.publicPlayerId || existing.publicPlayerId || null,
        name: seat.name,
        status: ['ELIMINATED', 'WINNER'].includes(existing.status) ? existing.status : 'ACTIVE',
        tableId: table.id,
        seatIdx,
        stack: Number(seat.stack),
        moveCount: Number(existing.moveCount) || 0,
        isBot: seat.isBot === true
      });
    });
  }

  activeTables() {
    return [...this.tables.values()]
      .filter(table => table.status !== TABLE_STATES.CLOSED)
      .sort((a, b) => a.number - b.number);
  }

  activePlayers() {
    return [...this.players.values()].filter(player => player.status === 'ACTIVE');
  }

  getTable(tableId) {
    return this.tables.get(tableId) || null;
  }

  getPlayer(playerId) {
    return this.players.get(playerId) || null;
  }

  resolveTableForPlayer(playerId) {
    const player = this.players.get(playerId);
    if (player?.tableId && this.tables.get(player.tableId)?.status !== TABLE_STATES.CLOSED) {
      return player.tableId;
    }
    return this.activeTables()[0]?.id || null;
  }

  getTournamentPlayers() {
    const result = [];
    for (const table of this.activeTables()) {
      table.room.G.seats.forEach((seat, seatIdx) => {
        if (seat && seat.stack > 0) {
          result.push({
            roomId: table.id,
            tableId: table.id,
            tableNumber: table.number,
            seatIdx,
            playerId: seat.playerId,
            name: seat.name,
            stack: seat.stack
          });
        }
      });
    }
    for (const player of this.activePlayers()) {
      if (!player.tableId && player.stack > 0) {
        result.push({
          roomId: '', tableId: '', tableNumber: 0, seatIdx: -1,
          playerId: player.playerId, name: player.name, stack: player.stack
        });
      }
    }
    return result;
  }

  getMetaForTable(tableId) {
    const table = this.tables.get(tableId);
    return {
      tournamentId: this.id,
      tableNumber: table?.number || 1,
      activeTables: this.activeTables().length,
      finalTable: this.finalTable,
      totalEntrants: this.players.size,
      playersRemaining: this.activePlayers().length,
      status: this.status,
      stateVersion: this.stateVersion
    };
  }

  canStartHand(tableId) {
    return this.status === 'RUNNING' && this.tables.get(tableId)?.status === TABLE_STATES.ACTIVE;
  }

  _ensureTable(number = null) {
    const tableNumber = number || this.nextTableNumber++;
    const tableId = this.tableIdFor(tableNumber);
    const existing = this.tables.get(tableId);
    if (existing) return existing;
    const room = this.createTable({ tableId, tableNumber });
    const entry = { id: tableId, number: tableNumber, status: TABLE_STATES.ACTIVE, room };
    this.tables.set(tableId, entry);
    this.nextTableNumber = Math.max(this.nextTableNumber, tableNumber + 1);
    return entry;
  }

  ensureTable(number = null) {
    return this._ensureTable(number);
  }

  start(registrations, startedAt = Date.now()) {
    if (this.disposed || this.status === 'FINISHED') return;
    this.syncRegistrations(registrations);
    this.status = 'RUNNING';
    this.clock.start(startedAt);
    this._armRegistrationClose();
    if (this.activeTables().length === 0) {
      this._initialSeating();
    } else {
      // Balance synchronously before any table is allowed to start its first hand.
      // Otherwise a pre-seated 9+1 field can begin playing before becoming 5+5.
      this.pendingPlan = this._buildBalancePlan('restore-or-start');
      if (this.pendingPlan) {
        this._pausePlanTables(this.pendingPlan);
        this._tryExecutePlan();
      }
    }
    this._touch('tournament_started');
    for (const table of this.activeTables()) table.room.maybeStartHand();
  }

  register(registration) {
    this.syncRegistrations([registration]);
    if (this.status === 'RUNNING' && !this.balanceRunning && !this.pendingPlan) {
      this.pendingPlan = this._buildBalancePlan('late-registration');
      if (this.pendingPlan) {
        this._pausePlanTables(this.pendingPlan);
        this._tryExecutePlan();
      }
    } else if (this.status === 'RUNNING') {
      this.requestBalance('late-registration');
    }
    this._touch('registration');
    return this.players.get(registration.player_id);
  }

  seatRegistration(registration) {
    this.syncRegistrations([registration]);
    const record = this.players.get(registration.player_id);
    if (!record || record.status !== 'ACTIVE') return null;
    if (record.tableId && this.tables.get(record.tableId)?.room.G.seats[record.seatIdx]) return record;
    let target = this.activeTables()
      .filter(table => this._tableCount(table) < this.maxSeats)
      .sort((a, b) => this._tableCount(a) - this._tableCount(b) || a.number - b.number)[0];
    if (!target) target = this._ensureTable();
    if (!this._seatPendingPlayer(record, target)) return null;
    this._touch('tournament_tables_updated');
    if (this.status === 'RUNNING') this.requestBalance('player-seated');
    return record;
  }

  _initialSeating() {
    const active = secureShuffle(this.activePlayers(), this.randomInt);
    const distribution = getTargetDistribution(active.length, this.maxSeats);
    let offset = 0;
    distribution.forEach((count, tableIndex) => {
      const table = this._ensureTable(tableIndex + 1);
      const seats = secureShuffle(Array.from({ length: this.maxSeats }, (_, i) => i), this.randomInt)
        .slice(0, count);
      for (let index = 0; index < count; index++) {
        this._seatPendingPlayer(active[offset++], table, seats[index]);
      }
    });
  }

  _seatPendingPlayer(record, table, requestedSeat = null) {
    if (!record || record.status !== 'ACTIVE') return false;
    let seatIdx = Number.isInteger(requestedSeat) && !table.room.G.seats[requestedSeat]
      ? requestedSeat : this._chooseTargetSeat(table.room);
    if (seatIdx < 0) return false;
    const added = table.room.importTournamentPlayer(seatIdx, {
      playerId: record.playerId,
      publicPlayerId: record.publicPlayerId,
      name: record.name,
      flag: record.flag || '🏳️',
      avatar: Number(record.avatar) || seatIdx % 6,
      stack: record.stack,
      isBot: record.isBot === true,
      connected: record.isBot === true,
      sittingOut: record.isBot !== true
    });
    if (!added) return false;
    record.tableId = table.id;
    record.seatIdx = seatIdx;
    record.stack = Number(table.room.G.seats[seatIdx].stack);
    record.publicPlayerId = table.room.G.seats[seatIdx].publicPlayerId || record.publicPlayerId || null;
    this.assignPlayer(this.id, record.playerId, table.id, seatIdx, record.stack, false);
    return true;
  }

  onTableBetweenHands(tableId) {
    if (this.disposed || this.status !== 'RUNNING') return false;
    this._syncStacks();
    if (!this.pendingPlan && !this.balanceRunning) {
      this.pendingPlan = this._buildBalancePlan('hand-complete');
      if (this.pendingPlan) this._pausePlanTables(this.pendingPlan);
    }
    this._tryExecutePlan();
    const table = this.tables.get(tableId);
    return table?.status === TABLE_STATES.ACTIVE;
  }

  requestBalance(reason = 'state-change') {
    if (this.disposed || this.status !== 'RUNNING') return;
    if (this.balanceScheduled) return;
    this.balanceScheduled = true;
    queueMicrotask(() => {
      this.balanceScheduled = false;
      if (this.disposed || this.balanceRunning || this.status !== 'RUNNING') return;
      if (!this.pendingPlan) this.pendingPlan = this._buildBalancePlan(reason);
      if (!this.pendingPlan) {
        this._maybeFinalizeTable();
        this._finishIfReady();
        return;
      }
      this._pausePlanTables(this.pendingPlan);
      this._tryExecutePlan();
    });
  }

  _tableCount(table) {
    return table.room.G.seats.filter(seat => seat && seat.stack > 0).length;
  }

  _buildBalancePlan(reason) {
    const activePlayers = this.activePlayers();
    const desiredCounts = getTargetDistribution(activePlayers.length, this.maxSeats);
    if (!desiredCounts.length) return null;

    let tables = this.activeTables();
    while (tables.length < desiredCounts.length) {
      this._ensureTable();
      tables = this.activeTables();
    }

    const ranked = [...tables].sort((a, b) => this._tableCount(b) - this._tableCount(a) || a.number - b.number);
    const retained = ranked.slice(0, desiredCounts.length);
    const closing = ranked.slice(desiredCounts.length);
    const targets = new Map();
    retained.forEach((table, index) => targets.set(table.id, desiredCounts[index]));
    closing.forEach(table => targets.set(table.id, 0));

    const pending = activePlayers.filter(player => !player.tableId || !this.tables.has(player.tableId));
    const deficits = [];
    const excess = [];
    for (const table of tables) {
      const delta = (targets.get(table.id) || 0) - this._tableCount(table);
      if (delta > 0) deficits.push({ table, count: delta });
      if (delta < 0) excess.push({ table, count: -delta });
    }

    const moves = [];
    for (const player of pending) {
      const target = deficits.find(item => item.count > 0);
      if (!target) break;
      moves.push({ playerId: player.playerId, fromTableId: null, toTableId: target.table.id });
      target.count--;
    }
    for (const source of excess) {
      const breaking = closing.some(table => table.id === source.table.id);
      const breakingPlayers = breaking
        ? secureShuffle(source.table.room.G.seats.filter(Boolean).map(player => player.playerId), this.randomInt)
        : [];
      while (source.count > 0) {
        const target = deficits.find(item => item.count > 0);
        if (!target) break;
        moves.push({
          playerId: breaking ? breakingPlayers.shift() : null,
          fromTableId: source.table.id,
          toTableId: target.table.id,
          breaking
        });
        source.count--;
        target.count--;
      }
    }

    if (!moves.length && !closing.length) return null;
    const affected = new Set();
    for (const move of moves) {
      if (move.fromTableId) affected.add(move.fromTableId);
      affected.add(move.toTableId);
    }
    closing.forEach(table => affected.add(table.id));
    return {
      id: crypto.randomUUID(),
      reason,
      moves,
      closing: closing.map(table => table.id),
      affected: [...affected],
      finalAssembly: desiredCounts.length === 1 && closing.length > 0 && this.isRegistrationClosed(),
      createdAt: Date.now()
    };
  }

  _pausePlanTables(plan) {
    const blockingTables = plan.finalAssembly
      ? plan.affected
      : [...new Set(plan.moves.map(move => move.fromTableId).filter(Boolean))];
    for (const tableId of blockingTables) {
      const table = this.tables.get(tableId);
      if (!table || table.status === TABLE_STATES.CLOSED) continue;
      table.status = plan.closing.includes(tableId) ? TABLE_STATES.BREAKING : TABLE_STATES.PAUSED;
      table.room.setTournamentPaused(true);
      this.io.to(tableId).emit('table_paused_for_balancing', {
        tournamentId: this.id,
        tableId,
        moveId: plan.id,
        stateVersion: this.stateVersion + 1
      });
    }
  }

  _tryExecutePlan() {
    const plan = this.pendingPlan;
    if (!plan || this.balanceRunning) return false;
    const blockingTables = plan.finalAssembly
      ? plan.affected
      : [...new Set(plan.moves.map(move => move.fromTableId).filter(Boolean))];
    const ready = blockingTables.every(tableId => {
      const table = this.tables.get(tableId);
      return !table || table.status === TABLE_STATES.CLOSED || table.room.isBetweenHands();
    });
    if (!ready) return false;
    this.balanceRunning = true;
    this._syncStacks();
    const chipsBefore = this._activeChipTotal();
    try {
      for (const move of plan.moves) this._executeMove(plan.id, move);
      if (plan.finalAssembly) {
        const finalTable = this.activeTables().find(table => !plan.closing.includes(table.id));
        if (finalTable) {
          this._randomizeTableSeats(
            finalTable,
            plan.id,
            new Set(plan.moves.map(move => move.playerId).filter(Boolean))
          );
        }
      }
      for (const tableId of plan.closing) this._closeEmptyTable(tableId);
      this._syncStacks();
      const chipsAfter = this._activeChipTotal();
      if (Math.abs(chipsAfter - chipsBefore) > 0.004) {
        throw new Error(`Chip conservation failed: ${chipsBefore} -> ${chipsAfter}`);
      }
      this.moveJournal.push({ id: plan.id, reason: plan.reason, at: Date.now(), moves: plan.moves.length });
      this.moveJournal = this.moveJournal.slice(-200);
      this.pendingPlan = null;
      this._resumeTables();
      this._maybeFinalizeTable();
      this._touch('tournament_tables_updated');
    } catch (error) {
      console.error(`[Tournament ${this.id}] Balance ${plan.id} failed:`, error);
      this.pendingPlan = null;
      this._syncStacks();
      this._resumeTables();
      setTimeout(() => this.requestBalance('balance-recovery'), 0);
      return false;
    } finally {
      this.balanceRunning = false;
    }
    this.requestBalance('post-move');
    return true;
  }

  _executeMove(moveId, move) {
    const target = this.tables.get(move.toTableId);
    if (!target) throw new Error(`Missing target table ${move.toTableId}`);
    let record;
    let exported = null;
    let source = null;
    if (move.fromTableId) {
      source = this.tables.get(move.fromTableId);
      if (!source) throw new Error(`Missing move source table ${move.fromTableId}`);
      const playerId = move.playerId || this._nextBigBlindCandidate(source.room);
      record = this.players.get(playerId);
      if (!record) throw new Error(`Missing move source player for ${move.fromTableId}`);
    } else {
      record = this.players.get(move.playerId);
    }
    if (!record) throw new Error('Missing tournament player');

    // A late registrant may claim this destination seat while the original
    // balance plan is waiting for another table's hand to finish. The pending
    // move is then already satisfied and must not import the player twice.
    const existingTargetSeat = target.room.G.seats
      .findIndex(player => player?.playerId === record.playerId);
    if (record.tableId === target.id && existingTargetSeat >= 0) {
      record.seatIdx = existingTargetSeat;
      record.stack = Number(target.room.G.seats[existingTargetSeat].stack);
      move.playerId = record.playerId;
      move.fromSeatIdx = existingTargetSeat;
      move.toSeatIdx = existingTargetSeat;
      return;
    }

    const seatIdx = move.breaking
      ? this._chooseRandomTargetSeat(target.room)
      : this._chooseTargetSeat(target.room);
    const oldTableId = record.tableId;
    const oldSeatIdx = record.seatIdx;
    if (seatIdx < 0) throw new Error(`No destination seat for ${record.playerId}`);
    const durableMoveId = crypto.createHash('sha256')
      .update(`${this.id}:${moveId}:${record.playerId}`)
      .digest('hex');
    this.prepareMove({
      tournamentId: this.id,
      moveId: durableMoveId,
      playerId: record.playerId,
      fromTableId: oldTableId,
      fromSeatIdx: oldSeatIdx,
      toTableId: target.id,
      toSeatIdx: seatIdx,
      stack: record.stack,
      countsAsMove: !!oldTableId
    });

    let imported = false;
    try {
      if (source) {
        exported = source.room.exportTournamentPlayer(record.playerId);
        if (!exported) throw new Error(`Unable to export ${record.playerId}`);
      }
      const player = exported?.player || {
        playerId: record.playerId,
        publicPlayerId: record.publicPlayerId || null,
        name: record.name,
        flag: record.flag || '🏳️',
        avatar: Number(record.avatar) || seatIdx % 6,
        stack: record.stack,
        isBot: record.isBot === true,
        connected: record.isBot === true,
        sittingOut: record.isBot !== true
      };
      imported = target.room.importTournamentPlayer(seatIdx, player);
      if (!imported) throw new Error(`Unable to import ${record.playerId} into ${target.id}`);

      const stack = Number(target.room.G.seats[seatIdx].stack);
      const commit = this.commitMove(this.id, durableMoveId, target.id, seatIdx, stack);
      record.tableId = target.id;
      record.seatIdx = seatIdx;
      record.stack = stack;
      if (!commit?.alreadyCommitted && oldTableId) {
        record.moveCount = (Number(record.moveCount) || 0) + 1;
      }
    } catch (error) {
      if (imported) target.room.exportTournamentPlayer(record.playerId);
      if (exported && source) {
        const restored = source.room.importTournamentPlayer(exported.seatIdx, exported.player);
        if (!restored) throw new Error(`Move rollback failed for ${record.playerId}: ${error.message}`);
      }
      this.resolveMove(this.id, durableMoveId, 'ROLLED_BACK');
      throw error;
    }

    move.playerId = record.playerId;
    move.fromSeatIdx = oldSeatIdx;
    move.toSeatIdx = seatIdx;
    this.onPlayerMoved({
      moveId: durableMoveId,
      tournamentId: this.id,
      playerId: record.publicPlayerId || null,
      accountPlayerId: record.playerId,
      socketId: exported?.player?.id || null,
      fromTableId: oldTableId,
      toTableId: target.id,
      tableNumber: target.number,
      seatIdx
    });
  }

  _nextBigBlindCandidate(room) {
    const occupied = index => !!(room.G.seats[index] && room.G.seats[index].stack > 0);
    const nextOccupied = from => {
      for (let step = 1; step <= room.maxPlayers; step++) {
        const index = (from + step) % room.maxPlayers;
        if (occupied(index)) return index;
      }
      return -1;
    };
    const sb = nextOccupied(room.G.dealerSeat);
    const bb = sb >= 0 ? nextOccupied(sb) : -1;
    return bb >= 0 ? room.G.seats[bb]?.playerId : null;
  }

  _chooseTargetSeat(room) {
    const empty = room.G.seats.map((seat, index) => seat ? -1 : index).filter(index => index >= 0);
    if (!empty.length) return -1;
    const occupied = index => !!(room.G.seats[index] && room.G.seats[index].stack > 0);
    let nextOccupiedDistance = room.maxPlayers + 1;
    for (let step = 1; step <= room.maxPlayers; step++) {
      const index = (room.G.dealerSeat + step) % room.maxPlayers;
      if (occupied(index)) { nextOccupiedDistance = step; break; }
    }
    const ordered = empty
      .map(index => ({
        index,
        distance: (index - room.G.dealerSeat + room.maxPlayers) % room.maxPlayers || room.maxPlayers
      }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index);
    // A new player becomes the next SB only when inserted before the first
    // occupied seat clockwise from the button. Prefer every other legal seat.
    return (ordered.find(item => item.distance > nextOccupiedDistance) || ordered[ordered.length - 1]).index;
  }

  _chooseRandomTargetSeat(room) {
    const empty = room.G.seats.map((seat, index) => seat ? -1 : index).filter(index => index >= 0);
    if (!empty.length) return -1;
    return empty[this.randomInt(empty.length)];
  }

  _randomizeTableSeats(table, moveId, alreadyMoved = new Set()) {
    const room = table.room;
    const seated = room.G.seats
      .map((player, seatIdx) => player ? { player, seatIdx } : null)
      .filter(Boolean);
    if (seated.length < 2) return;
    const shuffledPlayers = secureShuffle(seated, this.randomInt);
    const targetSeats = secureShuffle(
      Array.from({ length: room.maxPlayers }, (_, index) => index),
      this.randomInt
    ).slice(0, seated.length);
    const nextSeats = Array(room.maxPlayers).fill(null);
    room.players.clear();
    room.sockets.clear();
    shuffledPlayers.forEach((entry, index) => {
      const seatIdx = targetSeats[index];
      const player = {
        ...entry.player,
        cards: [],
        bet: 0,
        contributed: 0,
        inHand: false,
        acted: false,
        lastAction: ''
      };
      nextSeats[seatIdx] = player;
      if (player.playerId) room.players.set(player.playerId, seatIdx);
      if (player.id && this.io.sockets.sockets.get(player.id)) room.sockets.set(player.id, seatIdx);
      const record = this.players.get(player.playerId);
      if (record) {
        const moved = record.tableId !== table.id || record.seatIdx !== seatIdx;
        record.tableId = table.id;
        record.seatIdx = seatIdx;
        record.stack = Number(player.stack);
        const countAsMove = moved && !alreadyMoved.has(record.playerId);
        record.moveCount = (Number(record.moveCount) || 0) + (countAsMove ? 1 : 0);
        this.assignPlayer(this.id, record.playerId, table.id, seatIdx, record.stack, countAsMove);
        if (moved && player.id) {
          this.onPlayerMoved({
            moveId,
            tournamentId: this.id,
            playerId: record.playerId,
            accountPlayerId: record.playerId,
            socketId: player.id,
            fromTableId: table.id,
            toTableId: table.id,
            tableNumber: table.number,
            seatIdx
          });
        }
      }
    });
    room.G.seats = nextSeats;
    room.G.dealerSeat = targetSeats[this.randomInt(targetSeats.length)];
    room.broadcastState();
  }

  _activeChipTotal() {
    return this.activePlayers().reduce((total, player) => total + Number(player.stack || 0), 0);
  }

  _armRegistrationClose() {
    clearTimeout(this.registrationCloseTimer);
    this.registrationCloseTimer = null;
    if (!this.registrationClosesAt || this.status !== 'RUNNING') return;
    const arm = () => {
      if (this.disposed || this.status !== 'RUNNING') return;
      const remaining = this.registrationClosesAt - Date.now();
      if (remaining > 0) {
        this.registrationCloseTimer = setTimeout(arm, Math.min(remaining, 2_147_000_000));
        return;
      }
      this.registrationCloseTimer = null;
      this._maybeFinalizeTable();
      this.requestBalance('registration-closed');
      this._touch('tournament_registration_closed');
      this._finishIfReady();
    };
    arm();
  }

  _closeEmptyTable(tableId) {
    const table = this.tables.get(tableId);
    if (!table) return;
    if (this._tableCount(table) !== 0) throw new Error(`Refusing to close non-empty table ${tableId}`);
    table.status = TABLE_STATES.CLOSED;
    table.room.setTournamentPaused(true);
    this.io.to(tableId).emit('table_closed', {
      tournamentId: this.id,
      tableId,
      stateVersion: this.stateVersion + 1
    });
    this.closeTable(tableId, table);
  }

  _resumeTables() {
    for (const table of this.activeTables()) {
      if (table.status === TABLE_STATES.ACTIVE || table.status === TABLE_STATES.FINISHED) continue;
      table.status = TABLE_STATES.ACTIVE;
      table.room.setTournamentPaused(false);
      this.io.to(table.id).emit('table_resumed', {
        tournamentId: this.id,
        tableId: table.id,
        stateVersion: this.stateVersion + 1
      });
      table.room.maybeStartHand();
    }
  }

  resolveElimination(event) {
    const record = this.players.get(event.playerId);
    if (!record || record.status !== 'ACTIVE') {
      return { place: record?.eliminatedPlace || 1, total: this.players.size };
    }
    const place = Math.max(1, this.activePlayers().length);
    record.status = 'ELIMINATED';
    record.eliminatedPlace = place;
    record.stack = 0;
    record.tableId = null;
    record.seatIdx = null;
    this.markEliminated(this.id, record.playerId, place);
    this.io.to(`tournament:${this.id}`).emit('tournament_player_eliminated', {
      eventId: crypto.randomUUID(),
      stateVersion: ++this.stateVersion,
      tournamentId: this.id,
      playerId: record.playerId,
      name: record.name,
      place,
      total: this.players.size
    });
    this._finishIfReady();
    this.requestBalance('elimination');
    this._persist();
    return { place, total: this.players.size };
  }

  _finishIfReady() {
    if (this.status !== 'RUNNING' || !this.isRegistrationClosed()) return false;
    const alive = this.activePlayers();
    if (alive.length !== 1 || this.players.size < 2) return false;
    const winner = alive[0];
    this.status = 'FINISHED';
    this.finishedAt = Date.now();
    this.winnerPlayerId = winner.playerId;
    this.finalTable = true;
    this.pendingPlan = null;
    this.clock.stop?.(this.finishedAt);
    for (const table of this.activeTables()) {
      table.status = TABLE_STATES.FINISHED;
      table.room.finishTournament(winner, this.players.size);
    }
    winner.status = 'WINNER';
    winner.eliminatedPlace = 1;
    winner.tableId = null;
    winner.seatIdx = null;
    this.markWinner(this.id, winner.playerId, winner.stack);
    this.io.to(`tournament:${this.id}`).emit('tournament_finished', {
      eventId: crypto.randomUUID(),
      stateVersion: ++this.stateVersion,
      tournamentId: this.id,
      winnerName: winner.name,
      winnerPlayerId: winner.publicPlayerId || null,
      total: this.players.size
    });
    this._persist();
    this.onChanged();
    return true;
  }

  _maybeFinalizeTable() {
    if (this.isRegistrationClosed() && this.activeTables().length === 1 && this.activePlayers().length <= this.maxSeats) {
      if (!this.finalTable) {
        this.finalTable = true;
        this.io.to(`tournament:${this.id}`).emit('tournament_final_table_started', {
          eventId: crypto.randomUUID(),
          stateVersion: ++this.stateVersion,
          tournamentId: this.id,
          tableId: this.activeTables()[0]?.id
        });
      }
    }
  }

  _syncStacks() {
    for (const table of this.activeTables()) {
      table.room.G.seats.forEach((seat, seatIdx) => {
        if (!seat?.playerId) return;
        const record = this.players.get(seat.playerId);
        if (!record || record.status !== 'ACTIVE') return;
        record.stack = Number(seat.stack);
        record.tableId = table.id;
        record.seatIdx = seatIdx;
        this.assignPlayer(this.id, record.playerId, table.id, seatIdx, record.stack, false);
      });
    }
  }

  publicState() {
    this._syncStacks();
    const clock = this.clock.getState();
    return {
      tournamentId: this.id,
      status: this.status,
      stateVersion: this.stateVersion,
      totalEntrants: this.players.size,
      playersRemaining: this.activePlayers().length,
      activeTables: this.status === 'FINISHED' ? 0 : this.activeTables().length,
      finalTable: this.finalTable,
      winnerPlayerId: this.players.get(this.winnerPlayerId)?.publicPlayerId || null,
      winnerName: this.players.get(this.winnerPlayerId)?.name || null,
      finishedAt: this.finishedAt,
      clock: {
        level: clock.level,
        sb: clock.sb,
        bb: clock.bb,
        ante: clock.ante,
        remainingMs: clock.remainingMs,
        nextLevelAt: clock.nextLevelAt,
        next: clock.next ? {
          level: clock.next.level,
          sb: clock.next.sb,
          bb: clock.next.bb,
          ante: clock.next.ante
        } : null
      },
      tables: this.activeTables().map(table => ({
        tableId: table.id,
        tableNumber: table.number,
        status: this.status === 'FINISHED' ? TABLE_STATES.FINISHED : table.status,
        handNum: table.room.G.handNum,
        players: table.room.G.seats.filter(Boolean).map(seat => ({
          name: seat.name,
          stack: seat.stack,
          connected: seat.isBot || !!seat.connected,
          isBot: seat.isBot === true
        }))
      })),
      players: [...this.players.values()].map(player => ({
        publicPlayerId: player.publicPlayerId || null,
        name: player.name,
        status: player.status,
        tableId: player.tableId,
        tableNumber: this.tables.get(player.tableId)?.number || null,
        seatIdx: player.seatIdx,
        stack: player.stack,
        moveCount: player.moveCount,
        eliminatedPlace: player.eliminatedPlace,
        isBot: player.isBot === true
      }))
    };
  }

  snapshot() {
    return {
      version: 2,
      status: this.status,
      nextTableNumber: this.nextTableNumber,
      finalTable: this.finalTable,
      finishedAt: this.finishedAt,
      winnerPlayerId: this.winnerPlayerId,
      stateVersion: this.stateVersion,
      moveJournal: this.moveJournal,
      tournamentClock: this.clock.snapshot()
    };
  }

  _persist() {
    this.saveState(this.id, this.snapshot());
  }

  _touch(eventName) {
    this.stateVersion++;
    this._persist();
    this.io.to(`tournament:${this.id}`).emit(eventName, {
      eventId: crypto.randomUUID(),
      stateVersion: this.stateVersion,
      ...this.publicState()
    });
    this.onChanged();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.registrationCloseTimer);
    this.registrationCloseTimer = null;
    if (this._unsubscribeClock) this._unsubscribeClock();
    this.pendingPlan = null;
    this.tables.clear();
    this.players.clear();
  }
}

module.exports = {
  TABLE_STATES,
  TournamentManager,
  getRequiredTableCount,
  getTargetDistribution,
  secureShuffle
};
