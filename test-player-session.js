'use strict';

const { io } = require('./node_modules/socket.io/client-dist/socket.io.js');

async function createPlayerSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/player/session`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Player session failed: ${response.status}`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Player session cookie was not returned');
  return cookie;
}

function playerSessionToken(cookie) {
  const separator = String(cookie || '').indexOf('=');
  return separator >= 0 ? decodeURIComponent(cookie.slice(separator + 1)) : '';
}

async function connectPlayer(baseUrl, cookie = null, options = {}) {
  const sessionCookie = cookie || await createPlayerSession(baseUrl);
  const socket = io(baseUrl, {
    path: '/realtime/',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { Cookie: sessionCookie },
    auth: { playerSessionToken: playerSessionToken(sessionCookie) },
    ...options
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
  return { socket, cookie: sessionCookie };
}

module.exports = { createPlayerSession, connectPlayer, playerSessionToken };
