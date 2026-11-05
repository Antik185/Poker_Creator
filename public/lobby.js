// Start with polling so restrictive mobile networks can establish a session;
  // Socket.IO will upgrade to WebSocket when the route supports it.
  const socket = io({ path: '/realtime/' });
  let currentRoomId = null;
  let myName = '';
  let mySocketId = null;
  let currentMaxPlayers = 6;
  let scheduledState = null;
  let scheduledClockOffset = 0;
  let scheduledClockTimer = null;
  let _refreshTimer = null;
  let currentLobbyTotalSecs = 60;

  const pathParts = window.location.pathname.split('/');
  const urlCode = pathParts[2]?.toUpperCase() || null;
  const page = document.querySelector('.lobby-page');
  const missingLobby = page?.dataset.lobbyState === 'missing';
  const initialAccount = !document.querySelector('[data-auth-user]')?.hidden;

  const bannerImage = document.getElementById('lobbyBannerImage');
  function setBannerImage(loaded) {
    document.getElementById('lobbyBanner').dataset.background = loaded ? 'image' : 'fallback';
    if (bannerImage) bannerImage.hidden = !loaded;
  }
  if (bannerImage) {
    bannerImage.addEventListener('load', () => setBannerImage(true));
    bannerImage.addEventListener('error', () => setBannerImage(false));
    if (bannerImage.complete) setBannerImage(bannerImage.naturalWidth > 0);
  }

  function updateHero(title, status, scheduled = false) {
    if (title) document.getElementById('lobbyTitle').textContent = title;
    document.getElementById('lobbyKind').textContent = scheduled ? 'Турнир AntikPoker' : 'Комната AntikPoker';
    document.getElementById('lobbyHeroStatus').textContent = status;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-lobby-action]');
    if (!button || button.disabled) return;
    const actions = { join: doJoin, 'copy-code': copyCode, 'copy-link': copyLink,
      register: registerForTournament, seat: takeTournamentSeat, spectate: () => spectateTournament(button.dataset.tableId || ''),
      'open-levels': openBlindLevelsModal, 'close-levels': () => closeBlindLevelsModal(),
      'close-levels-backdrop': () => closeBlindLevelsModal(event),
      'confirm-name': () => confirmName(button.dataset.code || urlCode),
      'watch-room': () => { window.location.href = `/r/${encodeURIComponent(currentRoomId)}`; } };
    actions[button.dataset.lobbyAction]?.();
  });
  document.getElementById('codeInput').addEventListener('input', event => {
    event.target.value = event.target.value.toUpperCase();
  });

  // A login/logout in another tab must re-enter through the existing server checks,
  // never silently replace the identity owning an active seat.
  async function syncLobbyAccount() {
    try {
      const session = await window.AntikApi?.session({ refresh: true });
      if (session && Boolean(session.authenticated) !== initialAccount) window.location.reload();
    } catch (_) {}
  }
  window.addEventListener('antik:auth-changed', syncLobbyAccount);
  window.addEventListener('pageshow', event => { if (event.persisted) syncLobbyAccount(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncLobbyAccount(); });

  socket.on('connect', () => {
    mySocketId = socket.id;
    if (currentRoomId && urlCode && !missingLobby) joinLobby(urlCode, myName);
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (missingLobby) return;
    if (urlCode) {
      document.getElementById('joinForm').style.display = 'none';
      document.getElementById('lobbyView').style.display = 'block';
      document.getElementById('codeDisplay').textContent = urlCode;
      updateShareLink(urlCode);

      const savedName = localStorage.getItem('pokerName') || '';
      myName = savedName;
      joinLobby(urlCode, savedName);
    } else {
      document.getElementById('joinForm').style.display = 'block';
      document.getElementById('lobbyView').style.display = 'none';
      document.getElementById('nameInput').value = localStorage.getItem('pokerName') || '';
    }
  });

  function showNamePrompt(code) {
    if (document.getElementById('nameBar')) return;
    const view = document.getElementById('lobbyView');
    const bar = document.createElement('div');
    bar.id = 'nameBar';
    bar.className = 'lobby-name-bar';
    bar.innerHTML = `
      <input id="nameBarInput" aria-label="Ваш ник" placeholder="Ваш ник" maxlength="18">
      <button data-lobby-action="confirm-name" data-code="${escHtml(code)}">Войти</button>
    `;
    view.prepend(bar);
    const inp = document.getElementById('nameBarInput');
    inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(code); });
  }

  function confirmName(code) {
    const name = document.getElementById('nameBarInput')?.value.trim() || 'Player';
    myName = name;
    localStorage.setItem('pokerName', name);
    document.getElementById('nameBar')?.remove();
    joinLobby(code, name);
  }

  function doJoin() {
    const code = document.getElementById('codeInput').value.trim().toUpperCase();
    const name = document.getElementById('nameInput').value.trim() || 'Player';
    if (code.length !== 4) { showStatus('Введите 4-значный код', 'error'); return; }
    localStorage.setItem('pokerName', name);
    myName = name;
    window.location.assign(`/lobby/${encodeURIComponent(code)}`);
  }

  function getPlayerId() {
    let id = localStorage.getItem('pokerPlayerId');
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      localStorage.setItem('pokerPlayerId', id);
    }
    return id;
  }

  async function joinLobby(code, name) {
    try {
      const identity = await window.AntikGameEntry.ensure();
      myName = identity.name;
      socket.emit('joinLobby', { code });
    } catch (error) { showStatus(error.message, 'error'); }
  }

  socket.on('identityChanged', ({ message }) => { showStatus(message, 'error'); });

  // Socket events
  socket.on('lobbyJoined', ({ roomId, secondsLeft, totalSeconds, players, maxPlayers }) => {
    scheduledState = null;
    clearInterval(scheduledClockTimer);
    scheduledClockTimer = null;
    document.body.classList.remove('scheduled-page');
    document.querySelector('.lobby-card')?.classList.remove('scheduled-card');
    document.getElementById('scheduledView').style.display = 'none';
    document.getElementById('quickTimerWrap').style.display = 'flex';
    document.getElementById('quickPlayersSection').style.display = 'block';
    document.getElementById('lobbyCodeLabel').textContent = 'КОД КОМНАТЫ';
    currentMaxPlayers = Number(maxPlayers) === 9 ? 9 : 6;
    currentLobbyTotalSecs = Math.max(1, Number(totalSeconds) || Number(secondsLeft) || 60);
    currentRoomId = roomId;
    document.getElementById('joinForm').style.display = 'none';
    document.getElementById('lobbyView').style.display = 'block';
    const code = urlCode || document.getElementById('codeInput')?.value.toUpperCase();
    document.getElementById('codeDisplay').textContent = code;
    updateShareLink(code);
    updateTimer(secondsLeft);
    renderPlayers(players);
    showStatus('');
  });

  socket.on('lobbyTick', ({ secondsLeft, totalSeconds, players, maxPlayers }) => {
    if (maxPlayers) currentMaxPlayers = Number(maxPlayers) === 9 ? 9 : 6;
    if (totalSeconds) currentLobbyTotalSecs = Math.max(1, Number(totalSeconds));
    updateTimer(secondsLeft);
    renderPlayers(players);
  });

  socket.on('lobbyStart', ({ roomId, seatIdx, name: assignedName, pending, waitHands }) => {
    currentRoomId = roomId;
    if (pending) {
      localStorage.setItem('pokerPendingTournamentEntry', JSON.stringify({ roomId, waitHands: waitHands || 1, at: Date.now() }));
    } else {
      localStorage.removeItem('pokerPendingTournamentEntry');
    }
    // Use assigned name if server provided one, else our own name
    const finalName = assignedName || myName || localStorage.getItem('pokerName') || 'Player';
    triggerRedirect(roomId, seatIdx, finalName);
  });

  socket.on('lobbyError', (msg) => { showStatus(msg, 'error'); });
  socket.on('lobbyNeedsName', ({ code } = {}) => showNamePrompt(code || urlCode));
  socket.on('tournamentRegistrationError', msg => {
    const el = document.getElementById('scheduledStatus');
    if (el) { el.textContent = msg; el.style.color = '#e05a5a'; }
  });
  socket.on('tournamentSeatError', msg => {
    const el = document.getElementById('scheduledStatus');
    if (el) { el.textContent = msg; el.style.color = '#e05a5a'; }
  });

  socket.on('scheduledLobbyState', info => {
    scheduledState = info;
    scheduledClockOffset = Number(info.serverNow || Date.now()) - Date.now();
    currentRoomId = info.roomId;
    currentMaxPlayers = Number(info.maxPlayers) === 9 ? 9 : 6;
    document.body.classList.add('scheduled-page');
    document.querySelector('.lobby-card')?.classList.add('scheduled-card');
    document.getElementById('joinForm').style.display = 'none';
    document.getElementById('lobbyView').style.display = 'block';
    document.getElementById('nameBar')?.remove();
    document.getElementById('scheduledView').style.display = 'block';
    document.getElementById('quickTimerWrap').style.display = 'none';
    document.getElementById('quickPlayersSection').style.display = 'none';
    document.getElementById('lobbyCodeLabel').textContent = 'КОД ТУРНИРА';
    document.getElementById('codeDisplay').textContent = info.code || urlCode || '----';
    updateShareLink(info.code || urlCode);
    renderScheduledTournament();
    clearInterval(scheduledClockTimer);
    scheduledClockTimer = setInterval(updateScheduledClock, 1000);
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => joinLobby(info.code || urlCode, myName), 5000);
  });

  // Game already running — show live table info + spectate button
  socket.on('lobbyInProgress', (info) => {
    clearInterval(scheduledClockTimer);
    scheduledClockTimer = null;
    currentMaxPlayers = Number(info.maxPlayers) === 9 ? 9 : 6;
    currentRoomId = info.roomId;
    document.getElementById('joinForm').style.display = 'none';
    document.getElementById('lobbyView').style.display = 'block';
    document.getElementById('nameBar')?.remove();
    document.getElementById('lobbyCodeLabel').textContent = 'КОД КОМНАТЫ';
    const code = urlCode || document.getElementById('codeInput')?.value.toUpperCase() || '----';
    document.getElementById('codeDisplay').textContent = code;
    updateShareLink(code);
    showStatus('');
    updateHero('', info.gameOver ? 'Игра завершена' : 'Игра идёт');

    const tw = document.querySelector('.timer-wrap');
    if (tw) tw.innerHTML = `
      <div class="live-room-info">
        <div class="live-room-status">
          <span class="live-room-dot"></span>
          ${info.gameOver ? 'Игра завершена' : 'Игра уже идёт'}
        </div>
        <div class="live-room-meta">
          Столов: ${info.tables || 1} · Раздача №${info.handNum || 0} · Участников: ${info.totalEntrants || info.players.length}
        </div>
        <button class="scheduled-action primary" data-lobby-action="watch-room">Смотреть игру</button>
      </div>`;

    const secLabel = document.querySelector('.players-section .sec-label');
    if (secLabel) secLabel.textContent = `За столом · ${info.players.length}/${currentMaxPlayers}`;
    const list = document.getElementById('playersList');
    if (!info.players || !info.players.length) {
      list.innerHTML = '<div class="players-empty">За столом никого нет</div>';
    } else {
      list.innerHTML = info.players.map(p => `
        <div class="player-item">
          <div class="player-avatar">${escHtml((p.name || 'P')[0].toUpperCase())}</div>
          <div class="player-name">${escHtml(p.name)}</div>
          <span class="player-stack">${(+p.stack).toFixed(2)}</span>
          <span class="player-connection${p.connected ? ' connected' : ''}"></span>
        </div>`).join('');
    }

    // Live refresh while the page is open
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => {
      socket.emit('joinLobby', { code, name: myName || 'Player', playerId: getPlayerId() });
    }, 5000);
  });

  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor(total % 86400 / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const seconds = total % 60;
    const clock = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
    return days > 0 ? `${days} дн. ${clock}` : clock;
  }

  function countdownCells(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const values = [
      Math.floor(total / 86400),
      Math.floor(total % 86400 / 3600),
      Math.floor(total % 3600 / 60),
      total % 60
    ];
    return values.map(value => `<span class="countdown-cell">${String(value).padStart(2, '0')}</span>`).join('<span class="countdown-separator">:</span>');
  }

  function renderScheduledTournament() {
    if (!scheduledState) return;
    const info = scheduledState;
    document.getElementById('scheduledTitle').textContent = info.title || 'Турнир';
    updateHero(info.title, '', true);
    document.getElementById('scheduledCodeDisplay').textContent = info.code || urlCode || '----';
    document.getElementById('scheduledDescription').textContent = info.description || 'Описание турнира не добавлено.';
    document.getElementById('scheduledDateText').textContent = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'full', timeStyle: 'short'
    }).format(new Date(info.startAt));
    const structure = info.structure || {};
    const anteLabels = {
      CLASSIC_ANTE: 'Classic Ante',
      BIG_BLIND_ANTE: 'Big Blind Ante',
      NO_ANTE: 'Без ante'
    };
    document.getElementById('structureSummary').innerHTML = `
      <div class="structure-stat"><span>Формат</span><b>${currentMaxPlayers}-Max</b></div>
      <div class="structure-stat"><span>Стартовый стек</span><b>${Number(structure.startStack || 0).toLocaleString('ru-RU')}</b></div>
      <div class="structure-stat"><span>Уровень</span><b>${Math.round(Number(structure.levelDurationSec || 180) / 60)} мин.</b></div>
      <div class="structure-stat"><span>Ante</span><b>${anteLabels[structure.anteType] || 'Classic Ante'}</b></div>
      <div class="structure-stat"><span>Участников</span><b>до ${Number(info.maxEntrants || currentMaxPlayers)}</b></div>`;
    document.getElementById('blindLevelsSubtitle').textContent = `Все уровни · по ${Math.round(Number(structure.levelDurationSec || 180) / 60)} мин.`;
    document.getElementById('structureLevels').innerHTML = (structure.levels || []).map(level => `
      <div class="structure-level">
        <b>${level.level}</b><span>${level.sb}</span><span>${level.bb}</span><span>${level.ante}</span>
      </div>`).join('');

    const registrations = [...(info.registrations || [])].sort((a, b) => {
      const aActive = a.status === 'ACTIVE';
      const bActive = b.status === 'ACTIVE';
      if (info.status !== 'finished' && aActive !== bActive) return aActive ? -1 : 1;
      if (aActive && bActive) return Number(b.stack || 0) - Number(a.stack || 0);
      const aPlace = a.status === 'WINNER' ? 1 : Number(a.eliminatedPlace || 999999);
      const bPlace = b.status === 'WINNER' ? 1 : Number(b.eliminatedPlace || 999999);
      return aPlace - bPlace;
    });
    document.getElementById('registeredTitle').textContent = info.status === 'finished'
      ? `Итоговые места · ${registrations.length}`
      : `Участники · ${Number(info.activeRegistrations ?? registrations.length)}/${Number(info.maxEntrants || currentMaxPlayers)}`;
    document.getElementById('registeredPlayers').innerHTML = registrations.length
      ? registrations.map((player, index) => {
        const place = player.status === 'WINNER' ? 1 : Number(player.eliminatedPlace || 0);
        const terminal = player.status === 'ELIMINATED' || player.status === 'WINNER';
        return `<div class="registered-player${player.status === 'ELIMINATED' ? ' eliminated' : ''}${player.status === 'WINNER' ? ' winner' : ''}">
          <span class="registered-number">${place || index + 1}</span>
          <img width="32" height="32" alt="" loading="lazy" src="${escHtml(player.avatarUrl || '/avatars/a76faaf75b6381bf141dd719f325be43.png')}">
          <span class="registered-name">${escHtml(player.name)}</span>
          ${player.isBot ? '<span class="registered-me">BOT</span>' : ''}
          ${player.isYou ? '<span class="registered-me">ВЫ</span>' : ''}
          ${!terminal ? `<span class="registered-table">${player.tableNumber ? `СТОЛ ${Number(player.tableNumber)}` : 'ОЖИДАЕТ'}${player.stack != null && Number.isFinite(Number(player.stack)) ? ` · ${Number(player.stack).toLocaleString('ru-RU')}` : ''}</span>` : ''}
          ${player.status === 'WINNER' ? '<span class="registered-out">🏆 ПОБЕДИТЕЛЬ · 1 МЕСТО</span>' : ''}
          ${player.status === 'ELIMINATED' ? `<span class="registered-out">ВЫБЫЛ${player.eliminatedPlace ? ` · ${player.eliminatedPlace} место` : ''}</span>` : ''}
        </div>`;
      }).join('')
      : '<div class="players-empty">Пока никто не зарегистрировался</div>';

    const mttSummary = document.getElementById('mttSummary');
    const mttTables = document.getElementById('mttTables');
    const showMtt = info.status === 'running' || info.status === 'finished' || Number(info.activeTables) > 1;
    const showActiveTables = info.status !== 'finished' && (info.status === 'running' || Number(info.activeTables) > 0);
    mttSummary.style.display = showMtt ? 'grid' : 'none';
    mttTables.style.display = showActiveTables ? 'grid' : 'none';
    if (showMtt) {
      mttSummary.innerHTML = info.status === 'finished' ? `
        <div class="mtt-stat"><b>🏆 ${escHtml(info.winnerName || '—')}</b><span>Победитель</span></div>
        <div class="mtt-stat"><b>${registrations.length}</b><span>Участников</span></div>
        <div class="mtt-stat"><b>${info.finishedAt ? new Intl.DateTimeFormat('ru-RU', { dateStyle:'short', timeStyle:'short' }).format(new Date(info.finishedAt)) : 'Завершён'}</b><span>Финиш</span></div>` : `
        <div class="mtt-stat"><b>${Number(info.playersRemaining || 0)}</b><span>Осталось</span></div>
        <div class="mtt-stat"><b>${Number(info.activeTables || 0)}</b><span>Столов</span></div>
        <div class="mtt-stat"><b>${info.finalTable ? 'Да' : 'Нет'}</b><span>Финальный</span></div>
        ${info.clock ? `<div class="mtt-stat"><b>№${Number(info.clock.level || 1)} · ${Number(info.clock.sb || 0)}/${Number(info.clock.bb || 0)}/${Number(info.clock.ante || 0)}</b><span>Уровень · SB/BB/Ante</span></div>
        <div class="mtt-stat"><b id="mttLevelCountdown">${info.clock.remainingMs == null ? '—' : formatCountdown(Number(info.clock.remainingMs))}</b><span>До нового уровня</span></div>
        <div class="mtt-stat"><b>${info.clock.next ? `${Number(info.clock.next.sb)}/${Number(info.clock.next.bb)}/${Number(info.clock.next.ante)}` : 'Финальный уровень'}</b><span>Следующий</span></div>` : ''}`;
      mttTables.innerHTML = showActiveTables ? (info.tables || []).map(table => `
        <button type="button" class="mtt-table" data-lobby-action="spectate" data-table-id="${escHtml(table.tableId || '')}">
          <div class="mtt-table-head"><b>Стол №${Number(table.tableNumber || 1)}</b><span>${escHtml(table.status || 'ACTIVE')} · раздача ${Number(table.handNum || 0)}</span></div>
          <div class="mtt-table-players">${(table.players || []).map(player => `${player.isBot ? 'BOT ' : ''}${escHtml(player.name)} · ${Number(player.stack || 0).toLocaleString('ru-RU')}`).join(' · ') || 'Ожидает игроков'}</div>
        </button>`).join('') : '';
    }

    const nameInput = document.getElementById('scheduledNameInput');
    if (nameInput && !nameInput.value) nameInput.value = myName || localStorage.getItem('pokerName') || '';
    updateScheduledClock();
  }

  function updateScheduledClock() {
    if (!scheduledState) return;
    const now = Date.now() + scheduledClockOffset;
    const untilStart = Number(scheduledState.startAt) - now;
    const seatingOpen = now >= Number(scheduledState.seatingOpensAt);
    const isRunning = scheduledState.status === 'running' || scheduledState.status === 'starting' || untilStart <= 0;
    const isFinished = scheduledState.status === 'finished';
    updateHero(scheduledState.title, isFinished ? 'Турнир завершён' : isRunning ? 'Турнир идёт' : seatingOpen ? 'Посадка открыта' : 'Ожидаем начала турнира', true);
    const isEliminated = scheduledState.playerStatus === 'ELIMINATED';
    const isActiveRegistration = scheduledState.registered && !isEliminated;
    const registrationClosesAt = Number(scheduledState.registrationClosesAt || scheduledState.startAt);
    const countdown = document.getElementById('scheduledCountdown');
    const countdownLabel = document.querySelector('.scheduled-countdown-label');
    const levelCountdown = document.getElementById('mttLevelCountdown');
    if (!isFinished && levelCountdown && scheduledState.clock?.nextLevelAt) {
      levelCountdown.textContent = formatCountdown(Number(scheduledState.clock.nextLevelAt) - now);
    }
    countdown.classList.toggle('status-text', isFinished || isRunning);
    if (isFinished) {
      countdownLabel.textContent = 'Статус';
      countdown.textContent = 'ЗАВЕРШЁН';
    } else if (isRunning) {
      countdownLabel.textContent = 'Статус';
      countdown.textContent = 'ТУРНИР ИДЁТ';
    } else {
      countdownLabel.textContent = seatingOpen ? 'Старт через' : 'До начала';
      countdown.innerHTML = countdownCells(untilStart);
    }

    const registerRow = document.querySelector('.scheduled-register');
    const registerButton = document.getElementById('registerTournamentButton');
    const registrationOpen = !isFinished
      && now < registrationClosesAt
      && Number(scheduledState.activeRegistrations || 0) < Number(scheduledState.maxEntrants || currentMaxPlayers);
    registerRow.style.display = scheduledState.registered ? 'none' : 'flex';
    registerButton.disabled = !registrationOpen;
    registerButton.textContent = registrationOpen ? 'Зарегистрироваться' : 'Регистрация закрыта';

    const seatButton = document.getElementById('takeSeatButton');
    seatButton.style.display = isActiveRegistration && !isFinished ? 'block' : 'none';
    seatButton.disabled = !seatingOpen && !isRunning;
    seatButton.textContent = isRunning ? 'Вернуться за стол' : seatingOpen
      ? 'Сесть за стол'
      : `Посадка через ${formatCountdown(Number(scheduledState.seatingOpensAt) - now)}`;

    const spectateButton = document.getElementById('spectateTournamentButton');
    spectateButton.style.display = !isFinished && isRunning && (!scheduledState.registered || isEliminated) ? 'block' : 'none';
    spectateButton.textContent = 'Смотреть игру';
    const lateInfo = document.getElementById('lateRegistrationInfo');
    const afkInfo = document.getElementById('afkRulesInfo');
    if (afkInfo) afkInfo.textContent = scheduledState.afkAutoExclude
      ? `Автоисключение AFK: ${Number(scheduledState.afkTimeoutMinutes) || 20} мин. без подтверждения возвращения.`
      : 'Автоисключение AFK отключено.';
    lateInfo.classList.toggle('closed', isFinished || now >= registrationClosesAt);
    if (isFinished) {
      lateInfo.textContent = 'Турнир завершён · регистрация закрыта';
    } else if (now < Number(scheduledState.startAt)) {
      lateInfo.textContent = `Регистрация открыта · после старта ещё ${Number(scheduledState.lateRegistrationMinutes || 0)} мин.`;
    } else if (now < registrationClosesAt) {
      lateInfo.textContent = `Поздняя регистрация закроется через ${formatCountdown(registrationClosesAt - now)}`;
    } else {
      lateInfo.textContent = 'Поздняя регистрация закрыта';
    }
    const status = document.getElementById('scheduledStatus');
    status.style.color = '';
    status.textContent = isFinished
      ? (scheduledState.playerStatus === 'WINNER'
        ? 'Вы победили в турнире · 1 место.'
        : isEliminated
          ? `Турнир завершён · ваше место ${scheduledState.eliminatedPlace || '—'}.`
          : `Турнир завершён · победитель: ${scheduledState.winnerName || '—'}.`)
      : isEliminated
      ? `Вы выбыли${scheduledState.eliminatedPlace ? ` · место ${scheduledState.eliminatedPlace}` : ''}. Доступен режим просмотра.`
      : scheduledState.registered
      ? (seatingOpen || isRunning ? 'Вы зарегистрированы. Место закреплено за вами.' : 'Вы зарегистрированы. Посадка откроется за 5 минут до начала.')
       : registrationOpen ? 'Нажмите зарегистрироваться, чтобы закрепить место.' : 'Регистрация недоступна.';
  }

  async function registerForTournament() {
    if (!scheduledState) return;
    try {
      const identity = await window.AntikGameEntry.ensure();
      myName = identity.name;
      socket.emit('registerTournament', { code: scheduledState.code || urlCode });
    } catch (error) {
      document.getElementById('scheduledStatus').textContent = error.message;
    }
  }

  function takeTournamentSeat() {
    if (!scheduledState) return;
    socket.emit('claimTournamentSeat', { code: scheduledState.code || urlCode, playerId: getPlayerId() });
  }

  function spectateTournament(tableId = '') {
    if(scheduledState?.status === 'finished') return;
    const roomId = tableId || scheduledState?.roomId;
    if (roomId) window.location.href = `/r/${encodeURIComponent(roomId)}`;
  }

  function openBlindLevelsModal() {
    const modal = document.getElementById('blindLevelsModal');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.blind-levels-close')?.focus();
  }

  function closeBlindLevelsModal(event) {
    const modal = document.getElementById('blindLevelsModal');
    if (event && event.target !== modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeBlindLevelsModal();
  });

  // UI
  function updateTimer(secs) {
    if (!document.getElementById('timerNum')) return;
    document.getElementById('timerNum').textContent = secs;
    document.getElementById('timerSub').textContent = secs > 0 ? 'Ожидаем игроков...' : 'Запускаем!';
    const offset = 213.6 * (1 - Math.max(0, Math.min(1, secs / currentLobbyTotalSecs)));
    document.getElementById('timerArc').style.strokeDashoffset = offset;
    document.getElementById('timerArc').style.stroke =
      secs > 30 ? 'var(--gold)' : secs > 10 ? '#e8884a' : '#e05a5a';
  }

  // DOM-diff player list — no flicker
  function renderPlayers(players) {
    const list = document.getElementById('playersList');
    const secLabel = document.querySelector('.players-section .sec-label');
    if (secLabel) secLabel.textContent = `Игроки в лобби · ${(players || []).length}/${currentMaxPlayers}`;
    if (!players || players.length === 0) {
      list.innerHTML = '<div class="players-empty">Пока никого нет...</div>';
      return;
    }
    const empty = list.querySelector('.players-empty');
    if (empty) empty.remove();

    const currentIds = new Set(players.map(p => p.id));

    // Remove departed players
    list.querySelectorAll('[data-pid]').forEach(el => {
      if (!currentIds.has(el.dataset.pid)) {
        el.style.cssText += 'opacity:0;transform:translateX(20px);transition:all 0.3s;';
        setTimeout(() => el.remove(), 300);
      }
    });

    // Add new players only
    players.forEach((p, i) => {
      if (list.querySelector(`[data-pid="${p.id}"]`)) return;
      const isMe = p.name === myName;
      const letter = (p.name || 'P')[0].toUpperCase();
      const div = document.createElement('div');
      div.className = 'player-item';
      div.dataset.pid = p.id;
      div.innerHTML = `
        <div class="player-avatar">${letter}</div>
        <div class="player-name">${escHtml(p.name)}</div>
        ${i === 0 ? '<span class="player-host">ХОСТ</span>' : ''}
        ${isMe ? '<span class="player-you">ВЫ</span>' : ''}
      `;
      list.appendChild(div);
    });
  }

  function updateShareLink(code) {
    document.getElementById('shareLinkText').textContent = `${location.origin}/lobby/${code}`;
  }

  async function copyTextToClipboard(text) {
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) {}
    area.remove();
    return copied;
  }

  async function copyCode() {
    const copied = await copyTextToClipboard(document.getElementById('codeDisplay').textContent.trim());
    toast(copied ? 'Код скопирован!' : 'Не удалось скопировать код');
  }

  async function copyLink() {
    const code = document.getElementById('codeDisplay').textContent.trim();
    const copied = await copyTextToClipboard(`${location.origin}/lobby/${code}`);
    toast(copied ? 'Ссылка скопирована!' : 'Не удалось скопировать ссылку');
  }

  function triggerRedirect(roomId, seatIdx, name) {
    document.getElementById('redirectOverlay').classList.add('show');
    setTimeout(() => {
      const finalName = encodeURIComponent(name || myName || localStorage.getItem('pokerName') || 'Player');
      const seatParam = (seatIdx !== undefined && seatIdx !== null) ? `&seat=${seatIdx}` : '';
      window.location.href = `/r/${roomId}?name=${finalName}${seatParam}`;
    }, 1500);
  }

  function showStatus(msg, type) {
    const el = document.getElementById(document.getElementById('joinForm').style.display === 'block' ? 'joinStatus' : 'statusMsg');
    if (el) { el.textContent = msg; el.className = type || ''; }
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('joinForm').style.display !== 'none') doJoin();
  });
