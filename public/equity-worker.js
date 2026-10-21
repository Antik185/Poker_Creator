'use strict';

const VALUES = Object.freeze({
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14
});

function combinations(items, size) {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...tail] = items;
  return [
    ...combinations(tail, size - 1).map(combo => [head, ...combo]),
    ...combinations(tail, size)
  ];
}

function evaluateFive(cards) {
  const nums = cards.map(card => VALUES[card.v]).sort((a, b) => b - a);
  const flush = new Set(cards.map(card => card.s)).size === 1;
  const counts = {};
  nums.forEach(value => { counts[value] = (counts[value] || 0) + 1; });
  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const unique = [...new Set(nums)].sort((a, b) => b - a);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) {
      straightHigh = unique[i];
      break;
    }
  }
  if (!straightHigh && unique.includes(14) && [2, 3, 4, 5].every(value => unique.includes(value))) {
    straightHigh = 5;
  }
  const score = (rank, ...values) => rank * 16 ** 5
    + (values[0] || 0) * 16 ** 4
    + (values[1] || 0) * 16 ** 3
    + (values[2] || 0) * 16 ** 2
    + (values[3] || 0) * 16
    + (values[4] || 0);
  const kickers = excluded => {
    const remaining = [...excluded];
    return nums.filter(value => {
      const index = remaining.indexOf(value);
      if (index < 0) return true;
      remaining.splice(index, 1);
      return false;
    });
  };

  if (flush && straightHigh) return score(straightHigh === 14 ? 9 : 8, straightHigh);
  if (groups[0].count === 4) return score(7, groups[0].value, ...kickers(Array(4).fill(groups[0].value)));
  if (groups[0].count === 3 && groups[1]?.count === 2) return score(6, groups[0].value, groups[1].value);
  if (flush) return score(5, ...nums);
  if (straightHigh) return score(4, straightHigh);
  if (groups[0].count === 3) return score(3, groups[0].value, ...kickers(Array(3).fill(groups[0].value)));
  if (groups[0].count === 2 && groups[1]?.count === 2) {
    return score(2, groups[0].value, groups[1].value,
      ...kickers([groups[0].value, groups[0].value, groups[1].value, groups[1].value]));
  }
  if (groups[0].count === 2) {
    return score(1, groups[0].value, ...kickers([groups[0].value, groups[0].value]));
  }
  return score(0, ...nums);
}

function evaluateBest(hole, board) {
  const cards = [...hole, ...board];
  if (cards.length < 5) return -1;
  let best = -Infinity;
  for (const combo of combinations(cards, 5)) best = Math.max(best, evaluateFive(combo));
  return best;
}

function makeDeck() {
  const deck = [];
  for (const suit of ['♠', '♥', '♦', '♣']) {
    for (const value of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) {
      deck.push({ v: value, s: suit });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function calculateEquity(players, board) {
  const needed = 5 - board.length;
  const iterations = needed === 0 ? 1 : 1500;
  const wins = new Array(players.length).fill(0);
  if (needed === 0) {
    const scores = players.map(player => evaluateBest(player.cards, board));
    const best = Math.max(...scores);
    const winners = scores.filter(value => value === best).length;
    scores.forEach((value, index) => { if (value === best) wins[index] = 1 / winners; });
    return wins.map(value => Math.round(value * 100));
  }

  const used = new Set([
    ...players.flatMap(player => player.cards.map(card => card.v + card.s)),
    ...board.map(card => card.v + card.s)
  ]);
  const remaining = makeDeck().filter(card => !used.has(card.v + card.s));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const runout = [...board, ...shuffle([...remaining]).slice(0, needed)];
    const scores = players.map(player => evaluateBest(player.cards, runout));
    const best = Math.max(...scores);
    const winners = scores.filter(value => value === best).length;
    scores.forEach((value, index) => { if (value === best) wins[index] += 1 / winners; });
  }
  return wins.map(value => Math.round(value / iterations * 100));
}

function getOuts(playerIndex, players, board) {
  if (board.length >= 5) return { outs: [], runnerRunner: false };
  const used = new Set([
    ...players.flatMap(player => player.cards.map(card => card.v + card.s)),
    ...board.map(card => card.v + card.s)
  ]);
  const remaining = makeDeck().filter(card => !used.has(card.v + card.s));
  const player = players[playerIndex];
  const opponents = players.filter((_, index) => index !== playerIndex);
  const currentScore = evaluateBest(player.cards, board);
  const currentOpponent = Math.max(...opponents.map(opponent => evaluateBest(opponent.cards, board)));
  if (currentScore >= currentOpponent) return { outs: [], runnerRunner: false };

  const outs = remaining.filter(card => {
    const nextBoard = [...board, card];
    const playerScore = evaluateBest(player.cards, nextBoard);
    return playerScore > Math.max(...opponents.map(opponent => evaluateBest(opponent.cards, nextBoard)));
  });
  if (outs.length) return { outs: outs.slice(0, 12), runnerRunner: false };

  if (board.length === 3) {
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const nextBoard = [...board, remaining[i], remaining[j]];
        const playerScore = evaluateBest(player.cards, nextBoard);
        const opponentScore = Math.max(...opponents.map(opponent => evaluateBest(opponent.cards, nextBoard)));
        if (playerScore > opponentScore) return { outs: [], runnerRunner: true };
      }
    }
  }
  return { outs: [], runnerRunner: false };
}

self.onmessage = event => {
  const { requestId, fingerprint, players, board } = event.data || {};
  if (!Number.isInteger(requestId) || !Array.isArray(players) || !Array.isArray(board)) return;
  try {
    const percentages = calculateEquity(players, board);
    const leader = Math.max(...percentages);
    const equity = {};
    players.forEach((player, index) => {
      const result = percentages[index] < leader && board.length >= 3
        ? getOuts(index, players, board)
        : { outs: [], runnerRunner: false };
      equity[player.seatIdx] = {
        pct: percentages[index],
        isLeader: percentages[index] === leader && percentages[index] > 0,
        outs: result.outs,
        runnerRunner: result.runnerRunner
      };
    });
    self.postMessage({ requestId, fingerprint, equity });
  } catch (error) {
    self.postMessage({ requestId, fingerprint, error: error?.message || 'Equity calculation failed' });
  }
};
