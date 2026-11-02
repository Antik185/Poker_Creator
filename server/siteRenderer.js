'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SITE_ROOT = path.join(__dirname, '../public/site');
const ASSET_VERSION = '20261102b';

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
    profile: read('pages', 'profile.html')
  };
  const homeComponents = ['hero', 'proof', 'about', 'features', 'roadmap', 'cta']
    .map(name => read('components', `${name}.html`))
    .join('\n');

  function render(content, { page, title, description, preloads = '' } = {}) {
    return replaceTokens(layout, {
      TITLE: escapeHtml(title),
      DESCRIPTION: escapeHtml(description),
      PAGE: escapeHtml(page),
      HEADER: header,
      CONTENT: content,
      FOOTER: footer,
      PRELOADS: preloads,
      ASSET_VERSION
    });
  }

  return {
    home: () => render(replaceTokens(pages.home, { HOME_COMPONENTS: homeComponents }), {
      page: 'home',
      title: 'AntikPoker — покер, который объединяет',
      description: 'Браузерный покер для друзей и сообществ: свои комнаты, оформление и MTT-турниры.',
      preloads: '<link rel="preload" as="image" href="/site/assets/images/dlicom-poker.webp" fetchpriority="high">'
    }),
    coming: data => render(replaceTokens(pages.coming, Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, escapeHtml(value)])
    )), {
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
    profile: () => render(pages.profile, {
      page: 'profile', title: 'Профиль — AntikPoker', description: 'Профиль аккаунта AntikPoker.'
    }),
    assetVersion: ASSET_VERSION
  };
}

module.exports = { createSiteRenderer, escapeHtml, ASSET_VERSION };
