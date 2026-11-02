'use strict';

(() => {
  let pending;
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.timeout(12000), ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось проверить игровую сессию');
    return data;
  }
  async function choose() {
    const session = await request('/api/game/identity');
    if (!session.authenticated && !session.resumed) {
      let remembered = '';
      try { remembered = localStorage.getItem('antikGuestChoice'); } catch (_) {}
      if (remembered !== session.identity.name) {
        await new Promise(resolve => {
          const panel = document.createElement('div');
          panel.className = 'game-entry-overlay';
          const card = document.createElement('section');
          card.className = 'game-entry-card';
          card.setAttribute('role', 'dialog');
          card.setAttribute('aria-modal', 'true');
          const title = document.createElement('h2');
          title.textContent = 'Как присоединиться?';
          const text = document.createElement('p');
          text.textContent = 'Аккаунт сохраняет аватар и историю турниров. Можно играть и без регистрации.';
          const login = document.createElement('a');
          login.href = `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
          login.textContent = 'Войти в аккаунт';
          const guest = document.createElement('button');
          guest.type = 'button';
          guest.textContent = 'Играть как гость';
          guest.onclick = () => { panel.remove(); resolve(); };
          card.append(title, text, login, guest);
          panel.append(card);
          document.body.append(panel);
          login.focus();
        });
      }
    }
    const { identity } = await request('/api/game/identity/select', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: session.authenticated ? 'account' : 'guest' })
    });
    if (identity.type === 'GUEST') {
      try { localStorage.setItem('antikGuestChoice', identity.name); } catch (_) {}
    }
    for (const id of ['nameInput', 'scheduledNameInput', 'playerNameInput']) {
      const field = document.getElementById(id);
      if (field) { field.value = identity.name; field.readOnly = true; }
    }
    return identity;
  }
  window.AntikGameEntry = {
    ensure() {
      if (!pending) pending = choose().catch(error => { pending = null; throw error; });
      return pending;
    }
  };
})();
