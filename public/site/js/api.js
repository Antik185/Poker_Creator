'use strict';

(() => {
  let currentSession = null;
  let sessionRevision = 0;
  let pendingSession = null;

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (options.json !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (!headers.has('X-CSRF-Token') && !['GET', 'HEAD', 'OPTIONS'].includes(method) && currentSession?.csrfToken) {
      headers.set('X-CSRF-Token', currentSession.csrfToken);
    }
    try {
      const response = await fetch(path, {
        method,
        headers,
        body: options.json === undefined ? options.body : JSON.stringify(options.json),
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal
      });
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : null;
      if (!response.ok) {
        const error = new Error(payload?.error || `Ошибка запроса (${response.status})`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Сервер отвечает слишком долго. Попробуйте ещё раз');
      if (error instanceof TypeError) throw new Error('Нет связи с сервером. Проверьте подключение и повторите попытку');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function session({ refresh = false } = {}) {
    if (currentSession && !refresh) return currentSession;
    if (pendingSession) return pendingSession;
    const revision = sessionRevision;
    const pending = request('/api/auth/session').then(result => {
      if (revision === sessionRevision) currentSession = result;
      return currentSession;
    }).catch(error => {
      if (revision !== sessionRevision && currentSession) return currentSession;
      throw error;
    }).finally(() => {
      if (pendingSession === pending) pendingSession = null;
    });
    pendingSession = pending;
    return pending;
  }

  function setSession(value) {
    sessionRevision++;
    currentSession = value;
    pendingSession = null;
  }

  window.AntikApi = { request, session, setSession };
})();
