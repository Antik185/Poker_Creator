'use strict';

const assert = require('node:assert/strict');
const { PokerRoom } = require('./server/gameEngine');
const { TournamentManager } = require('./server/tournamentManager');
const { TournamentClock } = require('./server/tournamentClock');
const { ANTE_TYPES } = require('./public/tournament-structure');

function fakeIo() {
  return {
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map()
    },
    to() { return { emit() {} }; }
  };
}

function registrations(count, botCount = 0) {
  return Array.from({ length: count }, (_, index) => ({
    player_id: `real-player-${index + 1}`,
    name: index < botCount ? `Bot ${index + 1}` : `Real ${index + 1}`,
    status: 'ACTIVE',
    table_id: null,
    seat_idx: null,
    stack: 5000,
    move_count: 0,
    is_bot: index < botCount ? 1 : 0
  }));
}

async function main() {
  const io = fakeIo();
  const clock = new TournamentClock({ durationSec: 180 });
  const config = {
    maxPlayers: 9,
    maxEntrants: 90,
    startStack: 5000,
    sb: 25,
    bb: 50,
    anteType: ANTE_TYPES.CLASSIC_ANTE,
    levelDurationSec: 180,
    turnTimeSec: 30,
    launchMode: 'scheduled',
    scheduledStartAt: new Date(Date.now() - 1000).toISOString()
  };
  const rooms = new Map();
  let manager;
  manager = new TournamentManager({
    id: 'real-mtt',
    config,
    io,
    clock,
    createTable: ({ tableId, tableNumber }) => {
      const room = new PokerRoom(tableId, config, io, {
        tournamentClock: clock,
        tournamentMode: true,
        tableNumber,
        canStartHand: id => manager.canStartHand(id),
        onBetweenHands: id => manager.onTableBetweenHands(id),
        resolveElimination: event => manager.resolveElimination(event),
        getTournamentMeta: () => manager.getMetaForTable(tableId),
        getTournamentPlayers: () => manager.getTournamentPlayers()
      });
      rooms.set(tableId, room);
      return room;
    },
    closeTable: tableId => rooms.delete(tableId),
    isRegistrationClosed: () => false
  });

  try {
    manager.start(registrations(10, 8), Date.now());
    assert.deepEqual(
      manager.activeTables().map(table => table.room.G.seats.filter(Boolean).length),
      [5, 5]
    );
    const botSeats = manager.activeTables().flatMap(table => table.room.G.seats.filter(seat => seat?.isBot));
    assert.equal(botSeats.length, 8);
    assert.ok(botSeats.every(seat => seat.connected && !seat.sittingOut));
    await new Promise(resolve => setTimeout(resolve, 3300));
    const tables = manager.activeTables();
    assert.equal(tables.length, 2);
    for (const table of tables) {
      assert.equal(table.room.G.handNum, 1);
      assert.equal(table.room.G.phase, 'PREFLOP');
      assert.equal(table.room.G.seats.filter(seat => seat?.inHand).length, 5);
      assert.equal(table.room.G.currentSb, 25);
      assert.equal(table.room.G.currentBb, 50);
      assert.equal(table.room.G.currentAnte, 6);
    }
    assert.notEqual(tables[0].room.G.deck, tables[1].room.G.deck);
    assert.notDeepEqual(tables[0].room.G.deck, tables[1].room.G.deck);
    console.log('PASS  real MTT starts two independent 5-player tables with a shared level');
  } finally {
    for (const room of rooms.values()) room.dispose();
    manager.dispose();
    clock.dispose();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
