'use strict';

// Acesso aos arquivos de dados dos cards (public/local-*):
//   1) /api/partial-csv, /api/csv-count, /api/file-info só leem dentro de public/local-*
//   2) arquivos estáticos de local-* exigem login (Bearer ou cookie de sessão)
//   3) cookie de sessão: criado no login, renovado no /me, limpo no logout
//   4) readLimiter nas rotas de dados
// Usa o sistema de arquivos REAL numa pasta temporária (sem mock de fs) para
// exercitar realpath, junctions/symlinks e o express.static de verdade.

const request = require('supertest');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { createApp }  = require('../src/app');
const { hashPassword } = require('../src/auth');

const PASSWORD = 'senha-de-teste-123';
let ROOT;     // projeto com autenticação habilitada
let OPEN;     // projeto sem usuários (autenticação desligada)
let OUTSIDE;  // pasta fora do projeto
let JUNCTION; // public/local-events/escape → configs/

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function scaffold(root, withUsers) {
  write(path.join(root, 'public/index.html'), '<!doctype html><title>SPA</title>');
  write(path.join(root, 'public/login.html'), '<!doctype html><title>Login</title>');
  write(path.join(root, 'public/js/login.js'), '// login');
  write(path.join(root, 'public/css/main.css'), 'body{}');
  write(path.join(root, 'public/local-events/eventos.csv'), 'data;evento\n2026-11-06;a\n2026-11-07;b\n');
  write(path.join(root, 'public/local-data-uptimes/uptime.json'), '{"services":[]}');
  write(path.join(root, 'public/local-pages/sslabs-scan/index.html'), '<h1>SSLabs</h1>');
  write(path.join(root, 'local-pages/relatorio/index.html'), '<h1>Relatorio</h1>');
  write(path.join(root, 'configs/views.json'), '[]');
  if (withUsers) {
    const { salt, hash } = hashPassword(PASSWORD);
    write(path.join(root, 'configs/users.json'), JSON.stringify([
      { name: 'Ed', username: 'editor-t', role: 'editor', salt, hash },
      { name: 'Vi', username: 'viewer-t', role: 'viewer', salt, hash },
    ]));
  }
}

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-datafiles-'));
  ROOT    = path.join(base, 'projeto');
  OPEN    = path.join(base, 'projeto-aberto');
  OUTSIDE = path.join(base, 'fora');
  scaffold(ROOT, true);
  scaffold(OPEN, false);
  write(path.join(OUTSIDE, 'segredo.csv'), 'h\nSEGREDO\n');
  // junction (Windows, sem admin) / symlink de diretório (Linux) que escapa de local-*
  JUNCTION = path.join(ROOT, 'public/local-events/escape');
  fs.symlinkSync(path.join(ROOT, 'configs'), JUNCTION, 'junction');
});

afterAll(() => {
  // remove o link antes, para nunca seguir o destino
  try { fs.unlinkSync(JUNCTION); } catch { /* ignore */ }
  fs.rmSync(path.dirname(ROOT), { recursive: true, force: true });
});

async function login(app, username) {
  const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  return res;
}

function cookieValue(res) {
  const c = (res.headers['set-cookie'] || []).find(s => s.startsWith('painel_session='));
  return c ? c.split(';')[0].slice('painel_session='.length) : undefined;
}

// ====================================================================
describe('rotas de dados — somente public/local-*', () => {
  let app;
  let token;
  beforeAll(async () => {
    app = createApp({ rootDir: ROOT });
    token = (await login(app, 'viewer-t')).body.token; // menor privilégio
  });
  const get = (url) => request(app).get(url).set('Authorization', 'Bearer ' + token);

  test('partial-csv lê o CSV de um card', async () => {
    const res = await get('/api/partial-csv?file=public/local-events/eventos.csv&limit=1');
    expect(res.status).toBe(200);
    expect(res.text).toBe('data;evento\n2026-11-07;b');
  });

  test('csv-count conta as linhas do CSV de um card', async () => {
    const res = await get('/api/csv-count?file=public/local-events/eventos.csv');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2 });
  });

  test('file-info devolve metadados do arquivo de um card', async () => {
    const res = await get('/api/file-info?file=public/local-data-uptimes/uptime.json');
    expect(res.status).toBe(200);
    expect(res.body.size).toBe(15);
  });

  test('aceita separador do Windows no parâmetro', async () => {
    const res = await get('/api/csv-count?file=' + encodeURIComponent('public\\local-events\\eventos.csv'));
    expect(res.status).toBe(path.sep === '\\' ? 200 : 403);
  });

  test('arquivo inexistente dentro de local-* → 404', async () => {
    const res = await get('/api/file-info?file=public/local-events/nao-existe.csv');
    expect(res.status).toBe(404);
  });

  const blocked = () => [
    ['configs/sessions.json',                                'configs/sessions.json'],
    ['configs/users.json',                                   'configs/users.json'],
    ['traversal a partir de local-*',                         'public/local-events/../../configs/users.json'],
    ['traversal relativo para fora do projeto',               '../fora/segredo.csv'],
    ['caminho absoluto fora do projeto',                      path.join(OUTSIDE, 'segredo.csv')],
    ['caminho absoluto de configs',                           path.join(ROOT, 'configs/users.json')],
    ['arquivo de public/ fora de local-*',                    'public/js/login.js'],
    ['a própria pasta public/local-events',                   'public/local-events'],
    ['junction/symlink dentro de local-* que aponta p/ configs', 'public/local-events/escape/users.json'],
    ['byte nulo',                                             'public/local-events/eventos.csv\0.txt'],
  ];

  test.each(['partial-csv', 'csv-count', 'file-info'])('%s bloqueia caminhos fora de public/local-* (403)', async (route) => {
    for (const [label, file] of blocked()) {
      const res = await get(`/api/${route}?limit=999&file=${encodeURIComponent(file)}`);
      if (res.status !== 403) throw new Error(`${route} / ${label}: esperado 403, veio ${res.status} — ${res.text.slice(0, 80)}`);
      expect(res.body.error).toMatch(/Acesso negado/);
      expect(res.text).not.toMatch(/SEGREDO|salt|hash/);
    }
  });

  test('caminho fora do projeto dá 403 exista ou não (sem oráculo de existência)', async () => {
    const a = await get('/api/file-info?file=' + encodeURIComponent(path.join(OUTSIDE, 'segredo.csv')));
    const b = await get('/api/file-info?file=' + encodeURIComponent(path.join(OUTSIDE, 'nao-existe.csv')));
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(a.body).toEqual(b.body);
  });

  test('parâmetro file repetido (array) → 400', async () => {
    const res = await get('/api/csv-count?file=a&file=b');
    expect(res.status).toBe(400);
  });
});

// ====================================================================
describe('arquivos estáticos de local-* exigem login', () => {
  let app;
  let token;
  let cookie;
  beforeAll(async () => {
    app = createApp({ rootDir: ROOT });
    const res = await login(app, 'viewer-t');
    token  = res.body.token;
    cookie = cookieValue(res);
  });

  const DATA_URLS = [
    '/local-events/eventos.csv',
    '/local-data-uptimes/uptime.json',
    '/local-pages/sslabs-scan/',              // iframe do card SSLabs (public/local-pages)
    '/local-pages/sslabs-scan/index.html',
    '/local-pages/relatorio/index.html',      // rootDir/local-pages (segundo mount)
  ];

  test.each(DATA_URLS)('sem login: %s → 401', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  test.each(DATA_URLS)('com Bearer: %s → 200', async (url) => {
    const res = await request(app).get(url).set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
  });

  test.each(DATA_URLS)('com cookie de sessão (iframe/link): %s → 200', async (url) => {
    const res = await request(app).get(url).set('Cookie', 'outro=1; painel_session=' + cookie);
    expect(res.status).toBe(200);
  });

  test('cookie ou token inválido → 401', async () => {
    expect((await request(app).get('/local-events/eventos.csv').set('Cookie', 'painel_session=invalido')).status).toBe(401);
    expect((await request(app).get('/local-events/eventos.csv').set('Authorization', 'Bearer invalido')).status).toBe(401);
  });

  test.each([
    '/%6Cocal-events/eventos.csv',      // letra codificada
    '/local-events%2Feventos.csv',      // barra codificada
    '/LOCAL-EVENTS/eventos.csv',        // maiúsculas (FS case-insensitive)
    '/Local-Events/eventos.csv',
    '//local-events/eventos.csv',       // barra dupla
    '/./local-events/eventos.csv',      // segmento "."
    '/css/../local-events/eventos.csv', // ".." de outra pasta pública
    '/local-events\\eventos.csv',       // barra invertida
    '/%E0%A4%A/local-events/x',         // codificação inválida
  ])('variação de URL não contorna o login: %s', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/2026-11-06/);
  });

  test.each(['/login.html', '/js/login.js', '/css/main.css', '/favicon.svg'])(
    'arquivos da interface continuam públicos: %s', async (url) => {
      const res = await request(app).get(url);
      expect(res.status).not.toBe(401);
    });

  test('rota de view com prefixo "local-" (sem barra final) continua servindo o SPA', async () => {
    const res = await request(app).get('/local-teste');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/SPA/);
  });

  test('sem usuários configurados (auth desligada) os dados continuam acessíveis', async () => {
    const open = createApp({ rootDir: OPEN });
    const res = await request(open).get('/local-events/eventos.csv');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/2026-11-06/);
  });
});

// ====================================================================
describe('cookie de sessão', () => {
  let app;
  beforeAll(() => { app = createApp({ rootDir: ROOT }); });

  test('login grava cookie HttpOnly, SameSite=Strict, Path=/ com o mesmo token', async () => {
    const res = await login(app, 'editor-t');
    const raw = res.headers['set-cookie'].find(s => s.startsWith('painel_session='));
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\//);
    expect(raw).not.toMatch(/Secure/i); // HTTP local; vira Secure atrás de HTTPS (req.secure)
    expect(cookieValue(res)).toBe(res.body.token);
  });

  test('/api/auth/me com Bearer válido renova o cookie (sessões anteriores ao cookie)', async () => {
    const { body } = await login(app, 'editor-t');
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + body.token);
    expect(res.status).toBe(200);
    expect(cookieValue(res)).toBe(body.token);
  });

  test('/api/auth/me com token inválido limpa o cookie', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalido');
    expect(res.status).toBe(401);
    expect(cookieValue(res)).toBe('');
  });

  test('logout limpa o cookie e invalida o acesso aos dados', async () => {
    const { body } = await login(app, 'editor-t');
    const out = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + body.token);
    expect(out.status).toBe(200);
    expect(cookieValue(out)).toBe('');
    const res = await request(app).get('/local-events/eventos.csv').set('Cookie', 'painel_session=' + body.token);
    expect(res.status).toBe(401);
  });

  test('a API NÃO aceita o cookie (só Bearer) — sem superfície de CSRF', async () => {
    const res1 = await login(app, 'editor-t');
    const res = await request(app)
      .post('/api/views')
      .set('Cookie', 'painel_session=' + cookieValue(res1))
      .send({ title: 'Via Cookie' });
    expect(res.status).toBe(401);
    expect((await request(app).get('/api/cards').set('Cookie', 'painel_session=' + cookieValue(res1))).status).toBe(401);
  });
});

// ====================================================================
describe('readLimiter nas rotas de dados', () => {
  test.each(['partial-csv', 'csv-count', 'file-info'])('%s → 429 após o limite', async (route) => {
    const app = createApp({ rootDir: OPEN, readRateLimit: { limit: 2 } });
    const url = `/api/${route}?file=public/local-events/eventos.csv`;
    expect((await request(app).get(url)).status).toBe(200);
    expect((await request(app).get(url)).status).toBe(200);
    const res = await request(app).get(url);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Muitas requisições. Aguarde um instante e tente novamente.' });
  });

  test('limite padrão de 600/min, cota separada da de gravação', async () => {
    const app = createApp({ rootDir: OPEN, writeRateLimit: { limit: 1 } });
    const res = await request(app).get('/api/csv-count?file=public/local-events/eventos.csv');
    expect(res.headers['ratelimit']).toBe('limit=600, remaining=599, reset=60');
    // consumir a cota de gravação não afeta as leituras de dados
    await request(app).post('/api/layout/default').send([]);
    expect((await request(app).post('/api/layout/default').send([])).status).toBe(429);
    expect((await request(app).get('/api/csv-count?file=public/local-events/eventos.csv')).status).toBe(200);
  });

  test('outras leituras (views, cards, layout) não usam o readLimiter', async () => {
    const app = createApp({ rootDir: OPEN, readRateLimit: { limit: 1 } });
    for (let i = 0; i < 4; i++) {
      expect((await request(app).get('/api/views')).status).toBe(200);
    }
  });
});
