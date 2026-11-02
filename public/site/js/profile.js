'use strict';

(() => {
  if (document.body.dataset.page !== 'profile') return;
  const api = window.AntikApi;
  const form = document.getElementById('avatarForm');
  const fileInput = document.getElementById('avatarFile');
  const preview = document.getElementById('avatarPreview');
  const message = document.getElementById('avatarMessage');
  let previewUrl;
  let busy = false;
  let page = 1;
  let historyBusy = false;

  function resetPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.hidden = true;
    preview.removeAttribute('src');
    fileInput.value = '';
  }
  function updateButtons() {
    fileInput.disabled = busy;
    document.getElementById('saveAvatar').disabled = busy || !fileInput.files.length;
    document.getElementById('deleteAvatar').disabled = busy;
  }
  fileInput.addEventListener('change', () => {
    message.textContent = '';
    const file = fileInput.files[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.hidden = true;
    if (file) {
      if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        resetPreview();
        message.textContent = 'Выберите PNG, JPEG или WebP до 5 МБ';
      } else {
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.hidden = false;
      }
    }
    updateButtons();
  });

  async function saveAvatar(remove = false) {
    if (busy) return;
    busy = true;
    updateButtons();
    message.textContent = 'Сохраняем…';
    try {
      await api.session({ refresh: true });
      const data = new FormData();
      if (!remove) data.append('avatar', fileInput.files[0]);
      const result = await api.request('/api/profile/avatar', {
        method: remove ? 'DELETE' : 'POST', body: remove ? undefined : data,
        timeoutMs: 30000
      });
      resetPreview();
      window.dispatchEvent(new CustomEvent('antik:profile-updated', { detail: result.user }));
      message.textContent = remove ? 'Стандартный аватар восстановлен' : 'Аватар сохранён';
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; updateButtons(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); saveAvatar(); });
  document.getElementById('deleteAvatar').addEventListener('click', () => saveAvatar(true));

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
