'use strict';

(() => {
  if (document.body.dataset.page !== 'profile') return;
  const api = window.AntikApi;
  const form = document.getElementById('avatarForm');
  const fileInput = document.getElementById('avatarFile');
  const preview = document.getElementById('avatarPreview');
  const message = document.getElementById('avatarMessage');
  const control = document.getElementById('avatarControl');
  const trigger = document.getElementById('avatarTrigger');
  const menu = document.getElementById('avatarMenu');
  const upload = document.getElementById('uploadAvatar');
  const remove = document.getElementById('deleteAvatar');
  const save = document.getElementById('saveAvatar');
  const cancel = document.getElementById('cancelAvatar');
  let previewUrl;
  let busy = false;
  let currentUser = null;
  let page = 1;
  let historyBusy = false;

  function resetPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.hidden = true;
    preview.removeAttribute('src');
    fileInput.value = '';
    form.hidden = true;
  }
  function updateButtons() {
    fileInput.disabled = busy;
    trigger.disabled = busy || !currentUser;
    upload.disabled = busy;
    remove.disabled = busy;
    remove.hidden = !currentUser?.avatarUrl;
    upload.querySelector('span').textContent = currentUser?.avatarUrl ? 'Загрузить новое фото' : 'Загрузить фото';
    save.disabled = busy || !fileInput.files.length;
    cancel.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    trigger.setAttribute('aria-busy', String(busy));
  }
  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  trigger.addEventListener('click', () => {
    if (busy) return;
    if (!menu.hidden) return closeMenu(true);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    upload.focus();
  });
  document.addEventListener('pointerdown', event => { if (!control.contains(event.target)) closeMenu(); });
  control.addEventListener('focusout', event => { if (!control.contains(event.relatedTarget)) closeMenu(); });
  control.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(true); }
  });
  upload.addEventListener('click', () => {
    if (busy) return;
    closeMenu();
    resetPreview();
    message.textContent = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    message.textContent = '';
    const file = fileInput.files[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.hidden = true;
    if (file) {
      if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        resetPreview();
        message.textContent = 'Выберите PNG, JPEG или WebP до 5 МБ';
      } else {
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.hidden = false;
        form.hidden = false;
      }
    } else resetPreview();
    updateButtons();
    if (!form.hidden) save.focus();
  });
  cancel.addEventListener('click', () => {
    if (busy) return;
    resetPreview();
    message.textContent = '';
    updateButtons();
    trigger.focus();
  });

  async function saveAvatar(remove = false) {
    if (busy || !currentUser || (remove ? !currentUser.avatarUrl : !fileInput.files.length)) return;
    busy = true;
    closeMenu();
    updateButtons();
    message.textContent = 'Сохраняем…';
    let saved = false;
    try {
      await api.session({ refresh: true });
      const data = new FormData();
      if (!remove) data.append('avatar', fileInput.files[0]);
      const result = await api.request('/api/profile/avatar', {
        method: remove ? 'DELETE' : 'POST', body: remove ? undefined : data,
        timeoutMs: 30000
      });
      resetPreview();
      currentUser = result.user;
      saved = true;
      window.dispatchEvent(new CustomEvent('antik:profile-updated', { detail: result.user }));
      message.textContent = remove ? 'Стандартный аватар восстановлен' : 'Аватар сохранён';
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; updateButtons(); if (saved) trigger.focus(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); saveAvatar(); });
  remove.addEventListener('click', () => saveAvatar(true));
  function showUser(user) { currentUser = user || null; updateButtons(); }
  window.addEventListener('antik:profile-updated', event => showUser(event.detail));
  window.addEventListener('antik:auth-changed', event => showUser(event.detail.user));
  api.session().then(session => showUser(session.user)).catch(error => { message.textContent = error.message; });
  window.addEventListener('pagehide', () => { if (previewUrl) URL.revokeObjectURL(previewUrl); });

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  async function history() {
    if (historyBusy) return;
    historyBusy = true;
    const errorBox = document.getElementById('historyMessage');
    const retry = document.getElementById('historyRetry');
    const previous = document.getElementById('historyPrevious');
    const next = document.getElementById('historyNext');
    previous.disabled = next.disabled = true;
    errorBox.textContent = 'Загрузка…';
    retry.hidden = true;
    try {
      const stats = await api.request('/api/profile/tournament-stats');
      const result = await api.request(`/api/profile/tournaments?page=${page}`);
      const statsBox = document.getElementById('tournamentStats');
      statsBox.replaceChildren();
      for (const [label, value] of [['Сыграно турниров', stats.played], ['Победы', stats.wins], ['Финальные столы', stats.finalTables]]) {
        const item = element('div', '', 'profile-stat');
        item.append(element('strong', value), element('span', label));
        statsBox.append(item);
      }
      const list = document.getElementById('tournamentHistory');
      list.replaceChildren();
      if (!result.items.length) list.append(element('p', 'Вы пока не участвовали в турнирах. Когда сыграете свой первый MTT через аккаунт, он появится здесь.', 'profile-note'));
      for (const item of result.items) {
        const card = element('article', '', 'history-card');
        const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(item.startedAt || item.registeredAt));
        const labels = { SCHEDULED: 'Запланирован', RUNNING: 'Идёт', COMPLETED: 'Завершён', CANCELLED: 'Отменён' };
        card.append(element('h3', item.tournamentName), element('p', `${date}${item.communityName ? ` · ${item.communityName}` : ''}`));
        card.append(element('p', `Участников: ${item.participantCount ?? '—'} · Место: ${item.finalPlace ?? '—'}`));
        card.append(element('span', labels[item.status] || item.status, 'history-status'));
        list.append(card);
      }
      document.getElementById('historyPage').textContent = `${page} / ${result.pages}`;
      previous.disabled = page <= 1;
      next.disabled = page >= result.pages;
      errorBox.textContent = '';
    } catch (error) {
      errorBox.textContent = error.message;
      retry.hidden = false;
    } finally { historyBusy = false; }
  }
  document.getElementById('historyPrevious').onclick = () => { if (!historyBusy && page > 1) { page--; history(); } };
  document.getElementById('historyNext').onclick = () => { if (!historyBusy) { page++; history(); } };
  document.getElementById('historyRetry').onclick = history;
  history();
})();
