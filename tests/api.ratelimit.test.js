'use strict';

// Rate limiting das rotas de gravação (writeLimiter em src/app.js).
// Só rotas de escrita + backup são limitadas; leituras de cards e chart-data não.

const request = require('supertest');
const fs      = require('fs');
const { EventEmitter } = require('events');
const { createApp } = require('../src/app');

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync:        jest.fn(),
  readFile:          jest.fn(),
  readdir:           jest.fn(),
  writeFile:         jest.fn(),
  unlink:            jest.fn(),
  createReadStream:  jest.fn(),
  createWriteStream: jest.fn(),
}));

const ROOT = '/fake/root';
const MSG  = 'Muitas requisições. Aguarde um instante e tente novamente.';

const WRITE_ROUTES = [
  ['post',   '/api/layout/default'],
  ['post',   '/api/views'],
  ['delete', '/api/views/infra'],
  ['post',   '/api/cards'],
  ['delete', '/api/cards/card-1'],
  ['post',   '/api/uptime-config?file=public/local-data-uptimes/uptime.json'],
  ['post',   '/api/cve-assessment?file=public/local-events/cve.json'],
  ['get',    '/api/backup'],
];

function fakePython() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  process.nextTick(() => {
    p.stdout.emit('data', '{"labels":[],"data":[]}');
    p.emit('close', 0);
  });
  return p;
}

beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  fs.readFile.mockImplementation((p, enc, cb) => cb(null, '[]'));
  fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));
});

// ====================================================================
describe('rotas de gravação são limitadas', () => {
  // limit: 0 bloqueia toda requisição (v7) — prova que o limiter está na rota
  // e que o handler não chega a rodar.
  let app;
  let warnSpy;
  beforeAll(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    app = createApp({ rootDir: ROOT, writeRateLimit: { limit: 0 } });
  });
  afterAll(() => {
    // o único aviso esperado é o de "limit 0" da própria biblioteca
    for (const [w] of warnSpy.mock.calls) expect(String(w && w.code)).toBe('WRN_ERL_MAX_ZERO');
    warnSpy.mockRestore();
  });

  test.each(WRITE_ROUTES)('%s %s → 429 sem executar o handler', async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: MSG });
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(fs.createWriteStream).not.toHaveBeenCalled();
  });
});

// ====================================================================
describe('rotas de leitura não são limitadas', () => {
  test.each([
    ['get', '/api/views'],
    ['get', '/api/layout/default'],
    ['get', '/api/cards'],
    ['get', '/api/health'],
    ['get', '/version'],
  ])('%s %s continua respondendo além do limite de gravação', async (method, url) => {
    const app = createApp({ rootDir: ROOT, writeRateLimit: { limit: 1 } });
    for (let i = 0; i < 5; i++) {
      const res = await request(app)[method](url);
      expect(res.status).not.toBe(429);
    }
  });

  test('POST /api/chart-data (gráficos) não é limitado', async () => {
    const spawn = jest.fn().mockImplementation(() => fakePython());
    const app = createApp({ rootDir: ROOT, spawn, writeRateLimit: { limit: 1 } });
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/chart-data')
        .send({ scriptPath: 'scripts/count_events_by_weekday.py' });
      expect(res.status).toBe(200);
    }
    expect(spawn).toHaveBeenCalledTimes(5);
  });

  test('leituras não consomem a cota de gravação', async () => {
    const app = createApp({ rootDir: ROOT, writeRateLimit: { limit: 1 } });
    for (let i = 0; i < 5; i++) await request(app).get('/api/layout/default');
    const res = await request(app).post('/api/layout/default').send([]);
    expect(res.status).toBe(200);
  });
});

// ====================================================================
describe('limite padrão', () => {
  test('aceita 120 gravações por minuto e bloqueia a 121ª', async () => {
    const app = createApp({ rootDir: ROOT });
    for (let i = 1; i <= 120; i++) {
      const res = await request(app).post('/api/layout/default').send([]);
      if (res.status !== 200) throw new Error(`requisição ${i} retornou ${res.status}`);
    }
    const blocked = await request(app).post('/api/layout/default').send([]);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: MSG });
    expect(fs.writeFile).toHaveBeenCalledTimes(120);
  });

  test('envia cabeçalhos RateLimit padronizados (sem X-RateLimit legado)', async () => {
    const app = createApp({ rootDir: ROOT });
    const res = await request(app).post('/api/layout/default').send([]);
    expect(res.headers['ratelimit']).toBe('limit=120, remaining=119, reset=60');
    expect(res.headers['ratelimit-policy']).toBe('120;w=60');
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  test('cota é compartilhada entre as rotas de gravação', async () => {
    const app = createApp({ rootDir: ROOT, writeRateLimit: { limit: 2 } });
    expect((await request(app).post('/api/layout/default').send([])).status).toBe(200);
    expect((await request(app).post('/api/layout/infra').send([])).status).toBe(200);
    const res = await request(app).post('/api/views').send({ title: 'Nova' });
    expect(res.status).toBe(429);
  });

  test('cada instância do app tem seu próprio contador', async () => {
    const a = createApp({ rootDir: ROOT, writeRateLimit: { limit: 1 } });
    const b = createApp({ rootDir: ROOT, writeRateLimit: { limit: 1 } });
    expect((await request(a).post('/api/layout/default').send([])).status).toBe(200);
    expect((await request(b).post('/api/layout/default').send([])).status).toBe(200);
  });
});
