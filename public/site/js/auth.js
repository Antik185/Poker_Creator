'use strict';

(() => {
  const api = window.AntikApi;
  if (!api) return;

  function setMessage(form, message, success = false) {
    const box = form.querySelector('[data-form-message]');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('success', success);
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('[data-field-error]').forEach(element => { element.textContent = ''; });
    form.querySelectorAll('.auth-field').forEach(element => element.classList.remove('is-invalid'));
  }

  function showFieldErrors(form, fields = {}) {
    Object.entries(fields).forEach(([name, message]) => {
      const input = form.elements.namedItem(name);
      const label = input?.closest('.auth-field');
      const error = form.querySelector(`[data-field-error="${CSS.escape(name)}"]`);
      if (label) label.classList.add('is-invalid');
      if (error) error.textContent = message;
    });
  }

  function setBusy(form, busy) {
    const button = form.querySelector('[type="submit"]');
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? 'Подождите…' : button.dataset.label;
  }

  function updateHeader(session) {
    const authenticated = Boolean(session?.authenticated && session.user);
    document.querySelectorAll('[data-auth-guest]').forEach(element => { element.hidden = authenticated; });
    document.querySelectorAll('[data-auth-user]').forEach(element => { element.hidden = !authenticated; });
    if (!authenticated) return;
    document.querySelectorAll('[data-user-name]').forEach(element => { element.textContent = session.user.username; });
    document.querySelectorAll('[data-user-initial]').forEach(element => { element.textContent = session.user.username.slice(0, 1).toUpperCase(); });
  }

  async function logout(button) {
    button.disabled = true;
    try {
      await api.request('/api/auth/logout', { method: 'POST' });
      api.setSession({ authenticated: false });
      location.assign('/');
    } catch (error) {
      button.disabled = false;
      alert(error.message);
    }
  }

  document.querySelectorAll('[data-toggle-password]').forEach(button => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.textContent = visible ? 'Показать' : 'Скрыть';
      button.setAttribute('aria-label', visible ? 'Показать пароль' : 'Скрыть пароль');
    });
  });

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearFieldErrors(loginForm);
    setMessage(loginForm, '');
    setBusy(loginForm, true);
    const data = new FormData(loginForm);
    try {
      const result = await api.request('/api/auth/login', {
        method: 'POST',
        json: { login: data.get('login'), password: data.get('password') }
      });
      api.setSession({ authenticated: true, ...result });
      setMessage(loginForm, 'Вход выполнен', true);
      location.assign('/profile');
    } catch (error) {
      setMessage(loginForm, error.message);
    } finally {
      setBusy(loginForm, false);
    }
  });

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    let availabilityTimer;
    const usernameInput = registerForm.elements.namedItem('username');
    usernameInput.addEventListener('input', () => {
      clearTimeout(availabilityTimer);
      const label = usernameInput.closest('.auth-field');
      label.classList.remove('is-available', 'is-invalid');
      const error = registerForm.querySelector('[data-field-error="username"]');
      error.textContent = '';
      const username = usernameInput.value.trim();
      if (username.length < 3) return;
      availabilityTimer = setTimeout(async () => {
        try {
          const result = await api.request(`/api/auth/username-available?username=${encodeURIComponent(username)}`);
          if (usernameInput.value.trim() !== username) return;
          label.classList.toggle('is-available', result.available);
          label.classList.toggle('is-invalid', result.valid && !result.available);
          error.textContent = result.valid && !result.available ? 'Этот логин уже занят' : '';
        } catch (_) {}
      }, 350);
    });

    registerForm.addEventListener('submit', async event => {
      event.preventDefault();
      clearFieldErrors(registerForm);
      setMessage(registerForm, '');
      const data = new FormData(registerForm);
      const values = {
        username: data.get('username'),
        email: data.get('email'),
        password: data.get('password'),
        passwordConfirmation: data.get('passwordConfirmation')
      };
      if (String(values.password).length < 10) {
        showFieldErrors(registerForm, { password: 'Пароль должен содержать не менее 10 символов' });
        return;
      }
      if (values.password !== values.passwordConfirmation) {
        showFieldErrors(registerForm, { passwordConfirmation: 'Пароли не совпадают' });
        return;
      }
      setBusy(registerForm, true);
      try {
        const result = await api.request('/api/auth/register', { method: 'POST', json: values });
        api.setSession({ authenticated: true, ...result });
        setMessage(registerForm, 'Аккаунт создан', true);
        location.assign('/profile');
      } catch (error) {
        showFieldErrors(registerForm, error.payload?.fields);
        setMessage(registerForm, error.message);
      } finally {
        setBusy(registerForm, false);
      }
    });
  }

  function renderProfile(user) {
    const username = document.querySelector('[data-profile-username]');
    if (!username) return;
    username.textContent = user.username;
    document.querySelector('[data-profile-initial]').textContent = user.username.slice(0, 1).toUpperCase();
    document.querySelector('[data-profile-email]').textContent = user.email;
    document.querySelector('[data-profile-created]').textContent = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(user.createdAt));
    document.querySelector('[data-profile-verified]').textContent = user.emailVerifiedAt ? 'Подтверждён' : 'Не подтверждён';
  }

  api.session({ refresh: true }).then(session => {
    updateHeader(session);
    if (document.body.dataset.page === 'profile') {
      if (!session.authenticated) location.replace('/login');
      else renderProfile(session.user);
    } else if (session.authenticated && ['login', 'register'].includes(document.body.dataset.page)) {
      location.replace('/profile');
    }
    document.querySelectorAll('[data-auth-logout]').forEach(button => button.addEventListener('click', () => logout(button)));
  }).catch(() => {
    updateHeader({ authenticated: false });
    document.querySelectorAll('[data-auth-logout]').forEach(button => button.addEventListener('click', () => logout(button)));
  });
})();
