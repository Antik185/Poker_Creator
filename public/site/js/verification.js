'use strict';

(() => {
  const api = window.AntikApi;
  const start = document.getElementById('startEmailVerification');
  if (start) start.onclick = async () => {
    start.disabled = true;
    const message = document.getElementById('startVerificationMessage');
    try {
      const pending = await api.request('/api/auth/registration');
      await api.request('/api/auth/start-email-verification', { method: 'POST', json: {},
        timeoutMs: 45000, headers: { 'X-CSRF-Token': pending.csrfToken } });
      location.assign('/verify-email');
    } catch (error) {
      message.textContent = error.message;
      start.disabled = false;
      if (error.payload?.pending) location.assign('/verify-email');
    }
  };
  if (document.body.dataset.page !== 'verify-email') return;
  const form = document.getElementById('verifyEmailForm');
  const details = document.getElementById('verificationDetails');
  const message = document.getElementById('verificationMessage');
  const resend = document.getElementById('resendCode');
  const verify = document.getElementById('verifyCode');
  const edit = document.getElementById('editRegistration');
  let data, busy = false, completed = false, offset = 0;
  function buttons() {
    const now = Date.now() + offset;
    const pending = data?.pending;
    const alive = pending && pending.expiresAt > now && !completed;
    const seconds = Math.max(0, Math.ceil(((pending?.resendAvailableAt || 0) - now) / 1000));
    resend.disabled = busy || !alive || seconds > 0;
    verify.disabled = busy || !alive || pending.deliveryState !== 'SENT';
    document.getElementById('resendCountdown').textContent = alive && seconds ? `Повторная отправка через ${seconds} с` : '';
    if (pending && !alive && !completed) details.textContent = 'Временная регистрация истекла. Начните заново.';
    edit.textContent = pending?.existingAccount ? 'Вернуться в профиль' : 'Исправить email или логин';
    edit.href = pending?.existingAccount ? '/profile' : '/register';
  }
  async function load() {
    data = await api.request('/api/auth/registration');
    offset = data.serverNow - Date.now();
    const pending = data.pending;
    details.textContent = pending ? `Код для ${pending.email}. Логин: ${pending.username}.` : 'Нет действующей регистрации. Начните регистрацию заново или запросите подтверждение из профиля.';
    if (pending?.deliveryState === 'FAILED') message.textContent = 'Письмо не было отправлено. Повторите отправку, когда закончится отсчёт.';
    buttons();
  }
  async function send(path, json = {}) {
    if (busy || completed) return;
    busy = true; buttons(); message.textContent = 'Подождите…';
    try {
      const result = await api.request(path, { method: 'POST', json, timeoutMs: 45000,
        headers: { 'X-CSRF-Token': data.csrfToken } });
      if (path.endsWith('verify-email')) {
        completed = true;
        form.hidden = resend.hidden = edit.hidden = true;
        message.textContent = result.existingAccount ? 'Почта подтверждена' : 'Регистрация успешно завершена';
        api.setSession(result);
        window.dispatchEvent(new CustomEvent('antik:auth-changed', { detail: result }));
        const profile = document.getElementById('verificationProfile');
        profile.hidden = false;
        setTimeout(() => location.replace('/profile'), 500);
      } else { await load(); message.textContent = 'Новый код отправлен. Предыдущий код больше не действует.'; }
    } catch (error) { message.textContent = error.message; await load().catch(() => {}); }
    finally { busy = false; buttons(); }
  }
  form.onsubmit = event => { event.preventDefault(); send('/api/auth/verify-email', { code: form.elements.code.value }); };
  resend.onclick = () => send('/api/auth/resend-verification');
  edit.onclick = async event => {
    if (data?.pending?.existingAccount) return;
    event.preventDefault();
    if (busy) return;
    try {
      await api.request('/api/auth/cancel-registration', { method: 'POST', json: {}, headers: { 'X-CSRF-Token': data.csrfToken } });
      location.assign('/register');
    } catch (error) { message.textContent = error.message; }
  };
  load().catch(error => { message.textContent = error.message; });
  const timer = setInterval(buttons, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();
