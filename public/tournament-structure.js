'use strict';

(function exposeTournamentStructure(root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.POKER_TOURNAMENT = value;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildTournamentStructure() {
  const LEVELS = [
    [25, 50, 6], [30, 60, 7], [40, 80, 9], [50, 100, 12],
    [60, 120, 14], [80, 160, 19], [90, 180, 21], [100, 200, 24],
    [125, 250, 30], [150, 300, 36], [200, 400, 48], [250, 500, 60],
    [300, 600, 72], [350, 700, 84], [400, 800, 96], [500, 1000, 120],
    [600, 1200, 144], [800, 1600, 192], [1000, 2000, 240], [1250, 2500, 300],
    [1500, 3000, 360], [1750, 3500, 420], [2000, 4000, 480], [2250, 4500, 540],
    [2500, 5000, 600], [2750, 5500, 660], [3000, 6000, 720], [3500, 7000, 840],
    [4000, 8000, 960], [4500, 9000, 1080], [5000, 10000, 1200], [5500, 11000, 1320],
    [6000, 12000, 1440], [7000, 14000, 1680], [8000, 16000, 1920], [9000, 18000, 2160],
    [10000, 20000, 2400], [12500, 25000, 3000], [15000, 30000, 3600], [17500, 35000, 4200],
    [20000, 40000, 4800], [22500, 45000, 5400], [25000, 50000, 6000], [27500, 55000, 6600],
    [30000, 60000, 7200], [35000, 70000, 8400], [40000, 80000, 9600], [45000, 90000, 10800],
    [50000, 100000, 12000], [55000, 110000, 13200], [60000, 120000, 14400]
  ].map(([sb, bb, ante], index) => Object.freeze({ level: index + 1, sb, bb, ante }));

  const PRESETS = Object.freeze({
    HYPER_TURBO: 180,
    TURBO: 300,
    REGULAR: 600,
    DEEP_STACK: 900
  });

  const ANTE_TYPES = Object.freeze({
    CLASSIC_ANTE: 'CLASSIC_ANTE',
    BIG_BLIND_ANTE: 'BIG_BLIND_ANTE',
    NO_ANTE: 'NO_ANTE'
  });

  return Object.freeze({
    LEVELS: Object.freeze(LEVELS),
    PRESETS,
    ANTE_TYPES
  });
}));
