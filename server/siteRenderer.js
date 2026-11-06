'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SITE_ROOT = path.join(__dirname, '../public/site');
const ASSET_VERSION = '20261106return1';

function read(...parts) {
  return fs.readFileSync(path.join(SITE_ROOT, ...parts), 'utf8').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function replaceTokens(template, values) {
  return template.replace(/{{([A-Z0-9_]+)}}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

function createSiteRenderer() {
  const layout = read('templates', 'layout.html');
  const header = read('components', 'header.html');
  const footer = read('components', 'footer.html');
  const pages = {
    home: read('pages', 'home.html'),
    coming: read('pages', 'coming-soon.html'),
    login: read('pages', 'login.html'),
    register: read('pages', 'register.html'),
    verifyEmail: read('pages', 'verify-email.html'),
    profile: read('pages', 'profile.html'),
    tournaments: read('pages', 'tournaments.html'),
    lobby: read('pages', 'lobby.html')
  };
  const homeComponents = ['hero', 'proof', 'about', 'features', 'roadmap', 'cta']
    .map(name => read('components', `${name}.html`))
    .join('\n');

  function render(content, { page, title, description, preloads = '', user = null, socketScript = '' } = {}) {
    return replaceTokens(layout, {
      TITLE: escapeHtml(title),
      DESCRIPTION: escapeHtml(description),
      PAGE: escapeHtml(page),
      HEADER: replaceTokens(header, {
        AUTH_GUEST_HIDDEN: user ? 'hidden' : '',
        AUTH_USER_HIDDEN: user ? '' : 'hidden',
        AUTH_NAME: escapeHtml(user?.username || ''),
        AUTH_AVATAR: escapeHtml(user?.avatarUrl || '/avatars/a76faaf75b6381bf141dd719f325be43.png')
      }),
      CONTENT: content,
      FOOTER: footer,
      PRELOADS: preloads,
      PAGE_STYLES: ['tournaments', 'lobby'].includes(page) ? `<link rel="stylesheet" href="/site/css/${page}.css?v=${ASSET_VERSION}">\n<link rel="stylesheet" href="/game-entry.css?v=${ASSET_VERSION}">` : '',
      PAGE_SCRIPTS: page === 'tournaments' ? `<script defer src="/game-entry.js?v=${ASSET_VERSION}"></script>\n<script defer src="/site/js/tournaments.js?v=${ASSET_VERSION}"></script>`
        : page === 'lobby' ? `<script defer src="/game-entry.js?v=${ASSET_VERSION}"></script>\n${socketScript}\n<script defer src="/lobby.js?v=${ASSET_VERSION}"></script>` : '',
      ASSET_VERSION
    });
  }

  return {
    home: user => render(replaceTokens(pages.home, { HOME_COMPONENTS: homeComponents }), {
      user,
      page: 'home',
      title: 'AntikPoker — покер, который объединяет',
      description: 'Браузерный покер для друзей и сообществ: свои комнаты, оформление и MTT-турниры.',
      preloads: '<link rel="preload" as="image" href="/site/assets/images/dlicom-poker.webp" fetchpriority="high">'
    }),
    coming: (data, user) => render(replaceTokens(pages.coming, Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, escapeHtml(value)])
    )), {
      user,
      page: data.COMING_VIEW,
      title: `${data.COMING_TITLE} — AntikPoker`,
      description: data.COMING_DESCRIPTION,
      preloads: `<link rel="preload" as="image" href="${escapeHtml(data.COMING_IMAGE)}" fetchpriority="high">`
    }),
    login: () => render(pages.login, {
      page: 'login', title: 'Войти — AntikPoker', description: 'Вход в аккаунт AntikPoker.'
    }),
    register: () => render(pages.register, {
      page: 'register', title: 'Регистрация — AntikPoker', description: 'Создание аккаунта AntikPoker.'
    }),
    profile: user => render(pages.profile, {
      user,
      page: 'profile', title: 'Профиль — AntikPoker', description: 'Профиль аккаунта AntikPoker.'
    }),
    verifyEmail: user => render(pages.verifyEmail, {
      user,
      page: 'verify-email', title: 'Подтвердите почту — AntikPoker', description: 'Завершение регистрации AntikPoker.'
    }),
    tournaments: user => render(pages.tournaments, {
      user,
      page: 'tournaments', title: 'Турниры — AntikPoker',
      description: 'Расписание MTT, регистрация и возвращение за турнирный стол AntikPoker.'
    }),
    lobby: ({ room = null, code = '', status = '', preview = null, user = null, socketScript = '<script defer src="/realtime/socket.io.js?v=4.8.4"></script>' } = {}) => {
      const scheduled = room?.config?.launchMode === 'scheduled';
      const missing = !room && !!code;
      const title = room ? (scheduled ? room.config.tournamentTitle || room.brand : room.brand) : missing ? 'Лобби не найдено' : 'Войти в комнату';
      const statuses = { finished: 'Турнир завершён', running: 'Турнир идёт', starting: 'Турнир начинается', seating: 'Посадка открыта', scheduled: 'Ожидаем начала турнира' };
      const image = preview?.hasBackgroundPreview && /^\/api\/lobby-previews\/[a-zA-Z0-9-]+\/preview\?v=[a-f0-9]{24}$/.test(preview.previewUrl)
        ? `<img id="lobbyBannerImage" class="lobby-banner-image" src="${escapeHtml(preview.previewUrl)}" width="640" height="400" alt="" decoding="async" fetchpriority="high">` : '';
      const config = room?.config || {};
      const stats = !scheduled && room ? [
        ['Формат', `${Number(config.maxPlayers) === 9 ? 9 : 6}-Max`],
        ['Стартовый стек', Number(config.startStack || 0).toLocaleString('ru-RU')],
        ['Блайнды', `${Number(config.sb || 0)} / ${Number(config.bb || 0)}`]
      ] : [];
      const content = replaceTokens(pages.lobby, {
        LOBBY_STATE: missing ? 'missing' : room ? 'ready' : 'entry',
        LOBBY_MODE: scheduled ? 'scheduled' : 'instant',
        LOBBY_TITLE: escapeHtml(title),
        LOBBY_KIND: scheduled ? 'Турнир AntikPoker' : 'Комната AntikPoker',
        LOBBY_STATUS: escapeHtml(missing ? 'Проверьте код или вернитесь к каталогу турниров.' : statuses[status] || 'Пригласите друзей за стол'),
        LOBBY_IMAGE: image,
        LOBBY_ERROR_HIDDEN: missing ? '' : 'hidden',
        LOBBY_ERROR: missing ? 'Комната не найдена или больше недоступна.' : '',
        ROOM_DETAILS: stats.length ? `<section class="quick-room-details" aria-label="Параметры комнаты">${stats.map(([label, value]) => `<div class="structure-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</section>` : ''
      });
      return render(content, { user, socketScript, page: 'lobby', title: `${title} — AntikPoker`,
        description: 'Лобби AntikPoker: параметры игры, участники, регистрация и переход за стол.' });
    },
    assetVersion: ASSET_VERSION
  };
}

module.exports = { createSiteRenderer, escapeHtml, ASSET_VERSION };
