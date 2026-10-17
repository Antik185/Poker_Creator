'use strict';

const { LEVELS, PRESETS } = require('../public/tournament-structure');

class TournamentClock {
  constructor(options = {}) {
    const snapshot = options.snapshot || {};
    this.durationSec = Number(snapshot.durationSec || options.durationSec) || PRESETS.HYPER_TURBO;
    this.startedAt = Number(snapshot.startedAt || options.startedAt) || null;
    this.listeners = new Set();
    this.timer = null;
  }

  start(now = Date.now()) {
    if (!this.startedAt) this.startedAt = now;
    this._schedule(now);
    return this.getState(now);
  }

  getState(now = Date.now()) {
    const durationMs = this.durationSec * 1000;
    const elapsed = this.startedAt ? Math.max(0, now - this.startedAt) : 0;
    const index = Math.min(LEVELS.length - 1, Math.floor(elapsed / durationMs));
    const current = LEVELS[index];
    const next = LEVELS[index + 1] || null;
    const nextLevelAt = next && this.startedAt ? this.startedAt + (index + 1) * durationMs : null;
    return {
      ...current,
      durationSec: this.durationSec,
      startedAt: this.startedAt,
      nextLevelAt,
      remainingMs: nextLevelAt ? Math.max(0, nextLevelAt - now) : null,
      next
    };
  }

  snapshot() {
    return { startedAt: this.startedAt, durationSec: this.durationSec };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    this._schedule();
    return () => this.listeners.delete(listener);
  }

  _schedule(now = Date.now()) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.startedAt || this.listeners.size === 0) return;
    const state = this.getState(now);
    if (!state.nextLevelAt) return;
    const delay = Math.max(1, state.nextLevelAt - now + 5);
    this.timer = setTimeout(() => {
      this.timer = null;
      const nextState = this.getState();
      for (const listener of this.listeners) listener(nextState);
      this._schedule();
    }, delay);
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

module.exports = { TournamentClock };
