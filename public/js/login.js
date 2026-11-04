(function () {
  'use strict';

  var LS_TOKEN = 'painel_token';
  var LS_ROLE  = 'painel_role';
  var LS_NAME  = 'painel_name';

  function getToken() {
    return localStorage.getItem(LS_TOKEN);
  }

  // Validates the ?next= redirect target used after login.
  // Only same-origin paths are allowed — blocks javascript: URLs (XSS) and
  // external destinations (open redirect), including variants the browser
  // normalizes into "//host" ("/\host", tab/newline-separated slashes).
  function sanitizeNextPath(next) {
    if (typeof next !== 'string') return '/';
    var trimmed = next.trim();
    if (trimmed.charAt(0) !== '/' || trimmed.charAt(1) === '/' || trimmed.charAt(1) === '\\') return '/';
    try {
      // Absolute href (not pathname) so "/.//host" stays on this origin
      var url = new URL(trimmed, window.location.origin);
      return url.origin === window.location.origin ? url.href : '/';
    } catch (e) {
      return '/';
    }
  }

  function clearAuth() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ROLE);
    localStorage.removeItem(LS_NAME);
  }

  function redirectToLogin() {
    if (window.location.pathname === '/login') return;
    var next = window.location.pathname + window.location.search;
    window.location.href = '/login' + (next && next !== '/' ? '?next=' + encodeURIComponent(next) : '');
  }

  // Keep original fetch reference before patching
  var _origFetch = window.fetch.bind(window);

  // Patch fetch: inject Authorization header + intercept 401
  window.fetch = function (url, options) {
    var token  = getToken();
    var urlStr = typeof url === 'string' ? url : String(url);
    var isLocal = !urlStr.match(/^https?:\/\//);
    if (token && isLocal) {
      options = Object.assign({}, options);
      options.headers = Object.assign({}, options.headers, {
        'Authorization': 'Bearer ' + token,
      });
    }
    return _origFetch(url, options).then(function (response) {
      if (response.status === 401 && window.location.pathname !== '/login') {
        clearAuth();
        redirectToLogin();
      }
      return response;
    });
  };

  // ---- Login page (login.html) ----
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    var errorEl = document.getElementById('login-error');

    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.textContent = '';

      var username = document.getElementById('login-username').value.trim();
      var password = document.getElementById('login-password').value;

      if (!username || !password) {
        errorEl.textContent = 'Preencha todos os campos.';
        return;
      }

      var btn = loginForm.querySelector('button[type="submit"]');
      btn.disabled = true;

      _origFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (result) {
          if (!result.ok) {
            errorEl.textContent = result.data.error || 'Erro ao fazer login.';
            return;
          }
          localStorage.setItem(LS_TOKEN, result.data.token);
          localStorage.setItem(LS_ROLE,  result.data.role);
          localStorage.setItem(LS_NAME,  result.data.name);
          var params = new URLSearchParams(window.location.search);
          var next   = params.get('next') || '/';
          window.location.href = sanitizeNextPath(next);
        })
        .catch(function () {
          errorEl.textContent = 'Erro de comunicação com o servidor.';
        })
        .finally(function () {
          btn.disabled = false;
        });
    });

    return; // Login page: nothing else to do
  }

  // ---- SPA (index.html) — check auth on load ----
  var token = getToken();

  _origFetch('/api/auth/status')
    .then(function (res) { return res.json(); })
    .then(function (status) {
      if (!status.authEnabled) return; // No users configured — open access

      if (!token) { redirectToLogin(); return; }

      _origFetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (res) {
          if (!res.ok) { clearAuth(); redirectToLogin(); }
        })
        .catch(function () { /* network error — let the SPA load */ });
    })
    .catch(function () { /* network error — let the SPA load */ });

  // ---- Role-based UI + Logout button ----
  document.addEventListener('DOMContentLoaded', function () {
    // Hide editor-only items for viewers
    var role = localStorage.getItem(LS_ROLE);
    if (role && role !== 'editor') {
      var backupItem = document.getElementById('backup-item');
      if (backupItem) backupItem.style.display = 'none';
    }

    var logoutBtn = document.getElementById('btn-logout');
    if (!logoutBtn) return;

    logoutBtn.addEventListener('click', function () {
      var t = getToken();
      var logoutReq = t
        ? _origFetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + t },
          })
        : Promise.resolve();

      logoutReq
        .catch(function () {})
        .finally(function () {
          clearAuth();
          window.location.href = '/login';
        });
    });
  });
})();
