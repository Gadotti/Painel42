'use strict';

const request = require('supertest');
const fs      = require('fs');
const { createApp } = require('../src/app');

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync:       jest.fn(),
  readFile:         jest.fn(),
  writeFile:        jest.fn(),
  createReadStream: jest.fn(),
}));

const ROOT = '/fake/root';
const app  = createApp({ rootDir: ROOT, PYTHON_CMD: 'python' });

// ============================================================ /api/views
describe('GET /api/views', () => {
  afterEach(() => jest.clearAllMocks());

  test('retorna lista de views quando o arquivo existe', async () => {
    const views = [
      { value: 'default', title: 'Principal' },
      { value: 'infra',   title: 'Infraestrutura' },
    ];
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(views)));

    const res = await request(app).get('/api/views');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(views);
  });

  test('retorna array vazio com 200 quando views.json não existe (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    fs.readFile.mockImplementation((p, enc, cb) => cb(err));

    const res = await request(app).get('/api/views');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('retorna 500 quando o arquivo não pode ser lido por erro de I/O', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(new Error('disk error')));

    const res = await request(app).get('/api/views');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  test('retorna 500 quando o conteúdo não é JSON válido', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, '{INVALID'));

    const res = await request(app).get('/api/views');

    expect(res.status).toBe(500);
  });
});

// ============================================================ /api/cards
describe('GET /api/cards', () => {
  afterEach(() => jest.clearAllMocks());

  test('retorna lista de cards', async () => {
    const cards = [{ id: 'uptime-card', cardType: 'uptime' }];
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(cards)));

    const res = await request(app).get('/api/cards');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cards);
  });

  test('retorna 500 quando o arquivo não pode ser lido', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(new Error('fail')));

    const res = await request(app).get('/api/cards');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  test('retorna 500 com JSON malformado', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, 'NOT_JSON'));

    const res = await request(app).get('/api/cards');

    expect(res.status).toBe(500);
  });
});

// ============================================================ /version
describe('GET /version', () => {
  afterEach(() => jest.clearAllMocks());

  test('retorna a versão atual', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify({ version: '1.5' })));

    const res = await request(app).get('/version');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: '1.5' });
  });

  test('retorna 500 quando o arquivo de versão não pode ser lido', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(new Error('missing')));

    const res = await request(app).get('/version');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});
