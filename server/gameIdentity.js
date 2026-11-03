'use strict';

const crypto = require('node:crypto');

const GUEST_NAME_PATTERN = /^Guest\d{8}$/;

class GameIdentityService {
  constructor({ db, playerIdentity, userAuth, randomInt = crypto.randomInt } = {}) {
    if (!db || !playerIdentity || !userAuth) {
      throw new Error('GameIdentityService requires db, playerIdentity and userAuth');
    }
    this.db = db;
    this.playerIdentity = playerIdentity;
    this.userAuth = userAuth;
    this.randomInt = randomInt;
  }

  createGuestName() {
    return `Guest${this.randomInt(100_000_000).toString().padStart(8, '0')}`;
  }

  ensureGuest(playerId) {
    const current = this.db.getGameplayIdentity(playerId);
    if (current) {
      if (current.type !== 'GUEST') throw new Error('Account identity requires an authenticated session');
      return current;
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        return this.db.ensureGuestGameplayIdentity(playerId, this.createGuestName());
      } catch (error) {
        if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
        const raced = this.db.getGameplayIdentity(playerId);
        if (raced) return raced;
      }
    }
    throw new Error('Unable to allocate a unique guest identity');
  }

  accountForRequest(req) {
    const session = this.userAuth.sessionFromRequest(req, { touch: false });
    if (!session) return { session: null, identity: null };
    const identity = session.user.emailVerifiedAt
      ? this.db.getOrCreateAccountGameplayIdentity(session.user.id)
      : (this.db.getAccountGameplayIdentity(session.user.id) || {
        type: 'ACCOUNT', userId: session.user.id, playerId: null,
        name: session.user.username, avatarUrl: session.user.avatarUrl
      });
    return { session, identity };
  }

  requestIdentity(req) {
    const account = this.accountForRequest(req);
    if (account.identity) return { ...account, guest: null };
    return {
      session: null,
      identity: this.ensureGuest(req.playerId),
      guest: this.db.getGameplayIdentity(req.playerId)
    };
  }

  attachSocket(socket) {
    const cookiePlayerId = this.playerIdentity.fromCookieHeader(socket.handshake.headers.cookie)
      || this.playerIdentity.verify(socket.handshake.auth?.playerSessionToken)
      || crypto.randomUUID();
    const guest = this.ensureGuest(cookiePlayerId);
    const { session, identity: account } = this.accountForRequest(socket.request);
    socket.data.cookiePlayerId = cookiePlayerId;
    socket.data.guestIdentity = guest;
    socket.data.accountSession = session;
    socket.data.accountIdentity = account;
    socket.data.serverPlayerId = account?.playerId || guest.playerId;
    return { account, guest, session };
  }
}

module.exports = { GameIdentityService, GUEST_NAME_PATTERN };
