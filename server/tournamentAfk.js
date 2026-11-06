'use strict';

const AFK_MINUTES = Object.freeze([5, 10, 15, 20, 30]);
const AFK_GRACE_MS = 5000;
const AFK_LOBBY_RETURN_MS = 120000;
function afkConfig(config) {
  return {
    afkAutoExclude: config.launchMode === 'scheduled' && config.afkAutoExclude === true,
    afkTimeoutMinutes: AFK_MINUTES.includes(Number(config.afkTimeoutMinutes)) ? Number(config.afkTimeoutMinutes) : 20
  };
}
module.exports = { AFK_MINUTES, AFK_GRACE_MS, AFK_LOBBY_RETURN_MS, afkConfig };
