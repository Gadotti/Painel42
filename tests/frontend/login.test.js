/**
 * @jest-environment jsdom
 */

// login.js is a self-executing IIFE that reads/writes window.location and
// patches window.fetch at load time. jsdom's real location cannot be
// spied on (navigation is not implemented), so each test runs the real
// file against a fake `window` whose `location` is a plain object — the
// redirect target is then just `win.location.href`.

const fs   = require('fs');
const path = require('path');

const LOGIN_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'login.js'),
  'utf8'
);

const ORIGIN = 'http://painel.test';

const LOGIN_HTML = `
  <form id="login-form">
    <input type="text" id="login-username">
    <input type="password" id="login-password">
    <p id="login-error"></p>
    <button type="submit">Entrar</button>
  </form>`;

const SPA_HTML = `
  <li id="backup-item"></li>
  <button id="btn-logout"></button>`;

// Fetch response stub
function res(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
};

/**
 * Runs login.js against a fresh document and a fake window.
 * @param {string} pathAndQuery  e.g. "/login?next=%2Fseguranca"
 * @param {string} html          body markup for the page
 * @param {jest.Mock} fetchMock  backing (original) fetch
 */
function loadLogin(pathAndQuery, html, fetchMock) {
  const url = new URL(pathAndQuery, ORIGIN);
  const doc = document.implementation.createHTMLDocument('test');
  doc.body.innerHTML = html;

  const win = {
    location: {
      origin:   ORIGIN,
      pathname: url.pathname,
      search:   url.search,
      href:     url.href,
    },
    fetch: fetchMock,
  };

  new Function('window', 'document', 'localStorage', LOGIN_JS)(win, doc, localStorage);
  return { win, doc };
}

function submitLogin(doc, username = 'ana', password = 's3cret') {
  doc.getElementById('login-username').value = username;
  doc.getElementById('login-password').value = password;
  doc.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
}

// Where the browser actually lands for a given location.href value
const dest = (win) => new URL(win.location.href, ORIGIN).href;

const LOGIN_OK = { token: 'tok-123', role: 'editor', name: 'Ana' };

beforeEach(() => {
  localStorage.clear();
});

// ====================================================================
// Login page — redirect after successful login (?next=)
// ====================================================================
describe('login page — redirect target after login', () => {
  async function loginWithNext(nextRaw) {
    const fetchMock = jest.fn().mockResolvedValue(res(200, LOGIN_OK));
    const query = nextRaw === undefined ? '' : '?next=' + encodeURIComponent(nextRaw);
    const { win, doc } = loadLogin('/login' + query, LOGIN_HTML, fetchMock);
    submitLogin(doc);
    await flush();
    return { win, doc, fetchMock };
  }

  test('without ?next= goes to the dashboard root', async () => {
    const { win } = await loginWithNext(undefined);
    expect(dest(win)).toBe(ORIGIN + '/');
  });

  test('stores token, role and name in localStorage', async () => {
    await loginWithNext('/seguranca');
    expect(localStorage.getItem('painel_token')).toBe('tok-123');
    expect(localStorage.getItem('painel_role')).toBe('editor');
    expect(localStorage.getItem('painel_name')).toBe('Ana');
  });

  test('posts credentials to /api/auth/login', async () => {
    const { fetchMock } = await loginWithNext(undefined);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'ana', password: 's3cret' }),
    }));
  });

  test.each([
    ['/seguranca',              ORIGIN + '/seguranca'],
    ['/seguranca?x=1',          ORIGIN + '/seguranca?x=1'],
    ['/infra?a=1&b=2#topo',     ORIGIN + '/infra?a=1&b=2#topo'],
    ['  /seguranca  ',          ORIGIN + '/seguranca'],
    // "./" segment collapses to "//evil.com" as a *path*; must stay on origin
    ['/.//evil.com',            ORIGIN + '//evil.com'],
  ])('allows same-origin path %j', async (next, expected) => {
    const { win } = await loginWithNext(next);
    expect(win.location.href).toBe(expected);
    expect(new URL(win.location.href, ORIGIN).origin).toBe(ORIGIN);
  });

  test.each([
    // XSS — script execution via URL scheme
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    // Open redirect — absolute / protocol-relative
    'https://evil.com',
    'http://evil.com/login',
    '//evil.com',
    '///evil.com',
    // Backslash variants (browser treats "\" as "/")
    '\\evil.com',
    '\\\\evil.com',
    '/\\evil.com',
    // Tab / newline are stripped by the URL parser → "//evil.com"
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r\n/evil.com',
    // Not a path at all
    'seguranca',
    '',
    '   ',
  ])('blocks unsafe target %j and falls back to "/"', async (next) => {
    const { win } = await loginWithNext(next);
    expect(dest(win)).toBe(ORIGIN + '/');
  });

  test('round-trip: next produced by redirectToLogin is accepted after login', async () => {
    // 1) SPA on a view receives 401 → redirected to /login?next=...
    const spaFetch = jest.fn()
      .mockResolvedValueOnce(res(200, { authEnabled: false })) // /api/auth/status on load
      .mockResolvedValueOnce(res(401, {}));                    // any API call
    const spa = loadLogin('/seguranca?filtro=critico', SPA_HTML, spaFetch);
    await flush();
    await spa.win.fetch('/api/cards');
    expect(spa.win.location.href).toBe('/login?next=' + encodeURIComponent('/seguranca?filtro=critico'));

    // 2) Login page with that exact URL → back to the original view
    const loginFetch = jest.fn().mockResolvedValue(res(200, LOGIN_OK));
    const login = loadLogin(spa.win.location.href, LOGIN_HTML, loginFetch);
    submitLogin(login.doc);
    await flush();
    expect(login.win.location.href).toBe(ORIGIN + '/seguranca?filtro=critico');
  });
});

// ====================================================================
// Login page — validation and error handling
// ====================================================================
describe('login page — validation and errors', () => {
  test('empty fields show message and do not call the API', async () => {
    const fetchMock = jest.fn();
    const { win, doc } = loadLogin('/login', LOGIN_HTML, fetchMock);
    submitLogin(doc, '   ', '');
    await flush();
    expect(doc.getElementById('login-error').textContent).toBe('Preencha todos os campos.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(win.location.href).toBe(ORIGIN + '/login');
  });

  test('invalid credentials show server error and do not redirect', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(401, { error: 'Usuário ou senha inválidos.' }));
    const { win, doc } = loadLogin('/login?next=%2Fseguranca', LOGIN_HTML, fetchMock);
    submitLogin(doc);
    await flush();
    expect(doc.getElementById('login-error').textContent).toBe('Usuário ou senha inválidos.');
    expect(localStorage.getItem('painel_token')).toBeNull();
    expect(win.location.href).toBe(ORIGIN + '/login?next=%2Fseguranca');
  });

  test('error response without message uses generic text', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(500, {}));
    const { doc } = loadLogin('/login', LOGIN_HTML, fetchMock);
    submitLogin(doc);
    await flush();
    expect(doc.getElementById('login-error').textContent).toBe('Erro ao fazer login.');
  });

  test('network failure shows communication error and re-enables the button', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    const { doc } = loadLogin('/login', LOGIN_HTML, fetchMock);
    const btn = doc.querySelector('button[type="submit"]');
    submitLogin(doc);
    expect(btn.disabled).toBe(true);
    await flush();
    expect(doc.getElementById('login-error').textContent).toBe('Erro de comunicação com o servidor.');
    expect(btn.disabled).toBe(false);
  });
});

// ====================================================================
// Patched fetch (all pages)
// ====================================================================
describe('patched fetch', () => {
  function loadSpa(pathAndQuery, fetchMock) {
    // first call is /api/auth/status from the SPA bootstrap
    fetchMock.mockResolvedValueOnce(res(200, { authEnabled: false }));
    return loadLogin(pathAndQuery, SPA_HTML, fetchMock);
  }

  test('adds Bearer token to same-origin requests', async () => {
    localStorage.setItem('painel_token', 'tok-abc');
    const fetchMock = jest.fn().mockResolvedValue(res(200, {}));
    const { win } = loadSpa('/', fetchMock);
    await flush();
    await win.fetch('/api/cards', { headers: { 'X-Test': '1' } });
    const [, opts] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(opts.headers).toEqual({ 'X-Test': '1', Authorization: 'Bearer tok-abc' });
  });

  test('does not leak the token to absolute external URLs', async () => {
    localStorage.setItem('painel_token', 'tok-abc');
    const fetchMock = jest.fn().mockResolvedValue(res(200, {}));
    const { win } = loadSpa('/', fetchMock);
    await flush();
    await win.fetch('https://api.example.com/data');
    const [, opts] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(opts).toBeUndefined();
  });

  test('401 clears the session and redirects to /login with the current view as next', async () => {
    localStorage.setItem('painel_token', 'tok-abc');
    localStorage.setItem('painel_role', 'viewer');
    localStorage.setItem('painel_name', 'Ana');
    const fetchMock = jest.fn().mockResolvedValue(res(401, {}));
    const { win } = loadSpa('/infra?x=1', fetchMock);
    await flush();
    await win.fetch('/api/cards');
    expect(localStorage.getItem('painel_token')).toBeNull();
    expect(localStorage.getItem('painel_role')).toBeNull();
    expect(localStorage.getItem('painel_name')).toBeNull();
    expect(win.location.href).toBe('/login?next=%2Finfra%3Fx%3D1');
  });

  test('401 on the root view redirects to /login without next', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(401, {}));
    const { win } = loadSpa('/', fetchMock);
    await flush();
    await win.fetch('/api/cards');
    expect(win.location.href).toBe('/login');
  });
});

// ====================================================================
// SPA bootstrap (index.html)
// ====================================================================
describe('SPA bootstrap', () => {
  test('auth disabled — no redirect', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200, { authEnabled: false }));
    const { win } = loadLogin('/seguranca', SPA_HTML, fetchMock);
    await flush();
    expect(win.location.href).toBe(ORIGIN + '/seguranca');
  });

  test('auth enabled without token — redirects to login keeping the view', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200, { authEnabled: true }));
    const { win } = loadLogin('/seguranca', SPA_HTML, fetchMock);
    await flush();
    expect(win.location.href).toBe('/login?next=%2Fseguranca');
  });

  test('auth enabled with invalid token — clears session and redirects', async () => {
    localStorage.setItem('painel_token', 'expired');
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(res(200, { authEnabled: true }))
      .mockResolvedValueOnce(res(401, {}));
    const { win } = loadLogin('/seguranca', SPA_HTML, fetchMock);
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/me', { headers: { Authorization: 'Bearer expired' } });
    expect(localStorage.getItem('painel_token')).toBeNull();
    expect(win.location.href).toBe('/login?next=%2Fseguranca');
  });

  test('auth enabled with valid token — stays on the page', async () => {
    localStorage.setItem('painel_token', 'tok-ok');
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(res(200, { authEnabled: true }))
      .mockResolvedValueOnce(res(200, { username: 'ana' }));
    const { win } = loadLogin('/seguranca', SPA_HTML, fetchMock);
    await flush();
    expect(win.location.href).toBe(ORIGIN + '/seguranca');
  });

  test('viewer role hides the backup menu item; editor keeps it', () => {
    const fetchMock = jest.fn().mockResolvedValue(res(200, { authEnabled: false }));

    localStorage.setItem('painel_role', 'viewer');
    const viewer = loadLogin('/', SPA_HTML, fetchMock);
    viewer.doc.dispatchEvent(new Event('DOMContentLoaded'));
    expect(viewer.doc.getElementById('backup-item').style.display).toBe('none');

    localStorage.setItem('painel_role', 'editor');
    const editor = loadLogin('/', SPA_HTML, fetchMock);
    editor.doc.dispatchEvent(new Event('DOMContentLoaded'));
    expect(editor.doc.getElementById('backup-item').style.display).toBe('');
  });

  test('logout calls the API, clears the session and goes to /login', async () => {
    localStorage.setItem('painel_token', 'tok-abc');
    localStorage.setItem('painel_role', 'editor');
    const fetchMock = jest.fn().mockResolvedValue(res(200, { authEnabled: false }));
    const { win, doc } = loadLogin('/seguranca', SPA_HTML, fetchMock);
    doc.dispatchEvent(new Event('DOMContentLoaded'));
    doc.getElementById('btn-logout').click();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-abc' },
    });
    expect(localStorage.getItem('painel_token')).toBeNull();
    expect(win.location.href).toBe('/login');
  });
});
