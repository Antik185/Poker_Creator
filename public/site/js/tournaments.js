'use strict';

(() => {
  if (document.body.dataset.page !== 'tournaments') return;
  const api = window.AntikApi;
  const list = document.getElementById('tournamentList');
  const message = document.getElementById('tournamentsMessage');
  const refresh = document.getElementById('refreshTournaments');
  const panel = document.getElementById('tournamentPanel');
  const tabs = {
    active: document.getElementById('tournamentsActiveTab'),
    finished: document.getElementById('tournamentsFinishedTab')
  };
  const views = Object.fromEntries(['active', 'finished'].map(key => [key, {
    items: null, loading: false, error: '', lastAttemptAt: 0
  }]));
  let selected = 'active';
  let joining = false;
  let lastSnapshot = null;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function render(items) {
    list.replaceChildren();
    if (!items.length) {
      list.append(element('p', selected === 'active'
        ? 'Пока нет активных турниров. Новые турниры появятся здесь, когда организаторы их создадут.'
        : 'Пока нет завершённых турниров.', 'catalog-message'));
      return;
    }
    for (const item of items) {
      const finished = item.status === 'finished';
      const card = element('article', '', 'tournament-card');
      card.dataset.status = item.status;
      const banner = element('div', '', 'tournament-card-banner');
      banner.dataset.background = 'brand';
      const mark = element('span', 'A', 'tournament-banner-mark');
      mark.setAttribute('aria-hidden', 'true');
      banner.append(mark);
      if (item.hasBackgroundPreview !== false && /^\/api\/tournaments\/(?!default\/)[a-zA-Z0-9_-]+\/preview(?:\?v=[a-f0-9]+)?$/.test(item.previewUrl || '')) {
        const image = document.createElement('img');
        image.className = 'tournament-card-background';
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        image.width = 640;
        image.height = 400;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('load', () => { banner.dataset.background = 'image'; });
        image.addEventListener('error', () => { image.hidden = true; banner.dataset.background = 'brand'; });
        image.src = item.previewUrl;
        banner.append(image);
      }
      const title = element('h2', item.title);
      title.title = item.title;
      banner.append(title);
      card.append(banner);
      const content = element('div', '', 'tournament-card-content');
      const labels = { scheduled: 'Запланирован', seating: 'Посадка открыта', starting: 'Начинается', running: 'Турнир идёт', finished: 'Завершён' };
      content.append(element('span', labels[item.status] || 'Турнир', 'tournament-status'));
      if (item.description) {
        const description = element('p', item.description, 'tournament-description');
        description.title = item.description;
        content.append(description);
      }
      const meta = element('dl', '', 'tournament-meta');
      const start = new Date(item.startAt);
      const details = [
        ['Начало', new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(start)],
        ['Участники', `${item.registeredCount}${item.maxEntrants ? ` / ${item.maxEntrants}` : ''}`],
        ['Регистрация', !finished && item.registrationOpen ? 'Открыта' : 'Закрыта']
      ];
      if (finished && item.finishedAt) details.push(['Завершение', new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.finishedAt))]);
      for (const [label, value] of details) {
        const row = element('div', '');
        row.append(element('dt', label), element('dd', value));
        meta.append(row);
      }
      content.append(meta);
      if (item.playerStatus) content.append(element('p', ({ ACTIVE: 'Вы зарегистрированы', ELIMINATED: 'Вы выбыли из турнира', WINNER: 'Вы победили в турнире' })[item.playerStatus] || 'Участие зарегистрировано'));
      const actions = element('div', '', 'tournament-actions');
      if (!finished && item.canRegister) {
        const button = element('button', 'Присоединиться', 'btn btn-primary');
        button.type = 'button';
        button.addEventListener('click', () => join(item, button));
        actions.append(button);
      }
      const link = element('a', item.playerStatus === 'ACTIVE' && item.status !== 'finished' ? 'Перейти к турниру' : 'Открыть лобби', item.playerStatus === 'ACTIVE' && item.status !== 'finished' ? 'btn btn-primary' : '');
      link.href = item.lobbyUrl;
      actions.append(link);
      content.append(actions);
      if (item.needsEmailVerification && item.registrationOpen && !item.registered) content.append(element('p', 'Подтвердите email в профиле для регистрации'));
      card.append(content);
      list.append(card);
    }
  }

  function showView() {
    const view = views[selected];
    for (const [key, tab] of Object.entries(tabs)) {
      tab.setAttribute('aria-selected', String(key === selected));
      tab.setAttribute('tabindex', key === selected ? '0' : '-1');
      tab.disabled = joining;
    }
    panel.setAttribute('aria-labelledby', tabs[selected].id);
    list.setAttribute('aria-label', selected === 'active' ? 'Активные турниры' : 'Завершённые турниры');
    list.setAttribute('aria-busy', String(view.loading));
    refresh.disabled = view.loading || joining;
    const snapshot = JSON.stringify([selected, view.items]);
    if (snapshot !== lastSnapshot) {
      if (view.items === null) list.replaceChildren();
      else render(view.items);
      lastSnapshot = snapshot;
    }
    message.textContent = view.error || (view.loading
      ? view.items === null ? `Загрузка ${selected === 'active' ? 'активных' : 'завершённых'} турниров…` : 'Обновляем список…'
      : '');
  }

  async function load(group = selected, force = false) {
    const view = views[group];
    if (view.loading || joining) return;
    if (group === 'finished' && !force && view.lastAttemptAt && Date.now() - view.lastAttemptAt < 60000) return;
    view.loading = true;
    view.error = '';
    view.lastAttemptAt = Date.now();
    showView();
    try {
      const result = await api.request(`/api/tournaments?status=${group}`);
      view.items = result.items.filter(item => (item.status === 'finished') === (group === 'finished'));
      // Terminal records seen in the archive must not reappear from an older active response.
      const finishedIds = new Set(views.finished.items?.map(item => item.id));
      if (views.active.items) views.active.items = views.active.items.filter(item => !finishedIds.has(item.id));
    } catch (error) {
      view.error = `${error.message}. ${view.items === null ? 'Не удалось загрузить список.' : 'Список не обновлён.'} Нажмите «Обновить» для повтора.`;
    } finally {
      view.loading = false;
      showView();
    }
  }

  function selectTab(group, focus = false) {
    if (joining || selected === group) return;
    selected = group;
    showView();
    if (focus) tabs[group].focus();
    load(group, true);
  }
  for (const [group, tab] of Object.entries(tabs)) {
    tab.addEventListener('click', () => selectTab(group));
    tab.addEventListener('keydown', event => {
      const keys = ['active', 'finished'];
      let next;
      if (event.key === 'Home') next = keys[0];
      else if (event.key === 'End') next = keys[1];
      else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) next = keys[1 - keys.indexOf(group)];
      if (next) { event.preventDefault(); selectTab(next, true); }
    });
  }

  async function socketClient() {
    if (window.io) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/realtime/socket.io.js';
      const fail = () => { clearTimeout(timer); script.remove(); reject(new Error('Не удалось подключить игровой клиент. Попробуйте ещё раз')); };
      const timer = setTimeout(fail, 12000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = fail;
      document.head.append(script);
    });
  }

  async function join(item, button) {
    if (joining) return;
    joining = true;
    views[selected].error = '';
    showView();
    button.disabled = true;
    button.textContent = 'Подключаемся…';
    message.textContent = '';
    let socket;
    try {
      await window.AntikGameEntry.ensure();
      await socketClient();
      await new Promise((resolve, reject) => {
        socket = window.io({ path: '/realtime/', transports: ['polling', 'websocket'], reconnection: false, autoConnect: false });
        const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
        const timer = setTimeout(() => finish(new Error('Сервер не подтвердил регистрацию. Откройте лобби и проверьте участие')), 15000);
        socket.once('connect', () => socket.emit('registerTournament', { code: item.code }));
        socket.on('scheduledLobbyState', state => { if (state.code === item.code && state.registered) finish(); });
        socket.once('tournamentRegistrationError', error => finish(new Error(error)));
        socket.once('connect_error', () => finish(new Error('Нет связи с игровым сервером')));
        socket.once('identityChanged', () => finish(new Error('Сессия изменилась. Обновите страницу')));
        socket.connect();
      });
      location.assign(item.lobbyUrl);
    } catch (error) {
      views[selected].error = error.message;
    } finally {
      socket?.disconnect();
      joining = false;
      showView();
      button.disabled = false;
      button.textContent = 'Присоединиться';
    }
  }

  refresh.addEventListener('click', () => load(selected, true));
  load();
})();
