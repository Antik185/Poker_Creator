'use strict';

(() => {
  if (document.body.dataset.page !== 'tournaments') return;
  const api = window.AntikApi;
  const list = document.getElementById('tournamentList');
  const message = document.getElementById('tournamentsMessage');
  const refresh = document.getElementById('refreshTournaments');
  let loading = false;
  let joining = false;
  let lastSnapshot = '';

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function render(items) {
    list.replaceChildren();
    if (!items.length) {
      list.append(element('p', 'Пока нет доступных турниров', 'catalog-message'));
      return;
    }
    for (const item of items) {
      const card = element('article', '', 'tournament-card');
      card.dataset.status = item.status;
      const labels = { scheduled: 'Запланирован', seating: 'Посадка открыта', starting: 'Начинается', running: 'Турнир идёт', finished: 'Завершён' };
      card.append(element('span', labels[item.status] || 'Турнир', 'tournament-status'), element('h2', item.title));
      if (item.description) card.append(element('p', item.description));
      const meta = element('dl', '', 'tournament-meta');
      const start = new Date(item.startAt);
      for (const [label, value] of [
        ['Начало', new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(start)],
        ['Участники', `${item.registeredCount}${item.maxEntrants ? ` / ${item.maxEntrants}` : ''}`],
        ['Регистрация', item.registrationOpen ? 'Открыта' : 'Закрыта']
      ]) {
        const row = element('div', '');
        row.append(element('dt', label), element('dd', value));
        meta.append(row);
      }
      card.append(meta);
      if (item.playerStatus) card.append(element('p', ({ ACTIVE: 'Вы зарегистрированы', ELIMINATED: 'Вы выбыли из турнира', WINNER: 'Вы победили в турнире' })[item.playerStatus] || 'Участие зарегистрировано'));
      const actions = element('div', '', 'tournament-actions');
      if (item.canRegister) {
        const button = element('button', 'Присоединиться', 'btn btn-primary');
        button.type = 'button';
        button.addEventListener('click', () => join(item, button));
        actions.append(button);
      }
      const link = element('a', item.playerStatus === 'ACTIVE' && item.status !== 'finished' ? 'Перейти к турниру' : 'Открыть лобби', item.playerStatus === 'ACTIVE' && item.status !== 'finished' ? 'btn btn-primary' : '');
      link.href = item.lobbyUrl;
      actions.append(link);
      card.append(actions);
      if (item.needsEmailVerification && item.registrationOpen && !item.registered) card.append(element('p', 'Подтвердите email в профиле для регистрации'));
      list.append(card);
    }
  }

  async function load() {
    if (loading || joining || document.hidden) return;
    loading = true;
    refresh.disabled = true;
    try {
      const result = await api.request('/api/tournaments');
      const snapshot = JSON.stringify(result.items);
      if (snapshot !== lastSnapshot) { render(result.items); lastSnapshot = snapshot; }
      message.textContent = '';
    } catch (error) {
      message.textContent = `${error.message}. Список не обновлён. Нажмите «Обновить» для повтора.`;
    } finally {
      loading = false;
      refresh.disabled = false;
      list.setAttribute('aria-busy', 'false');
    }
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
      message.textContent = error.message;
    } finally {
      socket?.disconnect();
      joining = false;
      button.disabled = false;
      button.textContent = 'Присоединиться';
    }
  }

  refresh.addEventListener('click', load);
  const timer = setInterval(load, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('online', load);
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  load();
})();
