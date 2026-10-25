'use strict';

function normalizeTournamentNickname(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const TOURNAMENT_AVATAR_ENTRIES = Object.freeze([
  ['Antik', '/avatars/ua-antik.png'],
  ['Antonina', '/avatars/ua-antonina.png'],
  ['Benjamin .／.', '/avatars/ua-benjamin.png'],
  ['denys.h', '/avatars/ua-denys-h.png'],
  ['drkamilla', '/avatars/ua-drkamilla.png'],
  ['ecodeath', '/avatars/ua-ecodeath.png'],
  ['Kuznets', '/avatars/ua-kuznets.png'],
  ['Liqued', '/avatars/ua-liqued.png'],
  ['mary', '/avatars/ua-mary.png'],
  ['Printsessa ｜ Hapi', '/avatars/ua-printsessa-hapi.png'],
  ['Resonans', '/avatars/ua-resonans.png'],
  ['Romenskij', '/avatars/ua-romenskij.png'],
  ['superman', '/avatars/ua-superman.png'],
  ['tarasheviuk', '/avatars/ua-tarasheviuk.png'],
  ['Ts', '/avatars/ua-ts.png'],
  ['Wolf_kea', '/avatars/ua-wolf-kea.png'],
  ['YaroslavPysar', '/avatars/ua-yaroslavpysar.png']
]);

const TOURNAMENT_AVATARS = new Map(
  TOURNAMENT_AVATAR_ENTRIES.map(([nickname, avatarUrl]) => [
    normalizeTournamentNickname(nickname),
    avatarUrl
  ])
);

function tournamentAvatarForNickname(nickname) {
  return TOURNAMENT_AVATARS.get(normalizeTournamentNickname(nickname)) || null;
}

module.exports = {
  TOURNAMENT_AVATAR_ENTRIES,
  normalizeTournamentNickname,
  tournamentAvatarForNickname
};
