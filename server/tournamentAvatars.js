'use strict';

function normalizeTournamentNickname(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const TOURNAMENT_AVATAR_ENTRIES = Object.freeze([
  ['aaran207', '/avatars/ua-aaran207.png'],
  ['alpha_0x01', '/avatars/ua-alpha-0x01.png'],
  ['annietouch', '/avatars/ua-annietouch.png'],
  ['Antik', '/avatars/ua-antik.png'],
  ['antik185', '/avatars/ua-antik185.png'],
  ['Antonina', '/avatars/ua-antonina.png'],
  ['Benjamin .／.', '/avatars/ua-benjamin.png'],
  ['bogdanov5223', '/avatars/ua-bogdanov5223.png'],
  ['bonjour1w', '/avatars/ua-bonjour1w.png'],
  ['borsch737', '/avatars/ua-borsch737.png'],
  ['bugan9289', '/avatars/ua-bugan9289.png'],
  ['denys.h', '/avatars/ua-denys-h.png'],
  ['drkamilla', '/avatars/ua-drkamilla.png'],
  ['ecodeath', '/avatars/ua-ecodeath.png'],
  ['gift', '/avatars/ua-gift.png'],
  ['herzman', '/avatars/ua-herzman.png'],
  ['iam.sisi', '/avatars/ua-iam-sisi.png'],
  ['jonni_0503', '/avatars/ua-jonni-0503.png'],
  ['Kuznets', '/avatars/ua-kuznets.png'],
  ['Liqued', '/avatars/ua-liqued.png'],
  ['liqued2544', '/avatars/ua-liqued2544.png'],
  ['mary', '/avatars/ua-mary.png'],
  ['mary75', '/avatars/ua-mary75.png'],
  ['miretu', '/avatars/ua-miretu.png'],
  ['nefor0ok', '/avatars/ua-nefor0ok.png'],
  ['nerozkazuy', '/avatars/ua-nerozkazuy.png'],
  ['Printsessa ｜ Hapi', '/avatars/ua-printsessa-hapi.png'],
  ['raju000076366', '/avatars/ua-raju000076366.png'],
  ['Resonans', '/avatars/ua-resonans.png'],
  ['Romenskij', '/avatars/ua-romenskij.png'],
  ['sk_maruf99_86417', '/avatars/ua-sk-maruf99-86417.png'],
  ['smsajjadboy', '/avatars/ua-smsajjadboy.png'],
  ['sofiia097155', '/avatars/ua-sofiia097155.png'],
  ['sshizzzaa', '/avatars/ua-sshizzzaa.png'],
  ['superman', '/avatars/ua-superman.png'],
  ['tarasheviuk', '/avatars/ua-tarasheviuk.png'],
  ['tor_29317', '/avatars/ua-tor-29317.png'],
  ['totosha1284', '/avatars/ua-totosha1284.png'],
  ['Ts', '/avatars/ua-ts.png'],
  ['versus777', '/avatars/ua-versus777.png'],
  ['wazenhagen', '/avatars/ua-wazenhagen.png'],
  ['Wolf_kea', '/avatars/ua-wolf-kea.png'],
  ['YaroslavPysar', '/avatars/ua-yaroslavpysar.png'],
  ['yura014054', '/avatars/ua-yura014054.png']
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
