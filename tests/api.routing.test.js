'use strict';

// Fixa o comportamento de roteamento que depende do path-to-regexp (empacotado
// pelo express). O upgrade do express 4.18 -> 4.22 atualiza o path-to-regexp;
// estes testes garantem que os padrões de rota usados continuam resolvendo:
//   - parâmetro opcional do SPA fallback  /:view?   (raiz e segmento único)
//   - parâmetros nomeados                 /api/layout/:viewName, /api/cards/:cardId
//   - parsing de query string (qs)        ?file=...&limit=...

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

describe('Roteamento — SPA fallback /:view? (parâmetro opcional)', () => {
  afterEach(() => jest.clearAllMocks());

  test('raiz "/" é capturada pelo fallback (parâmetro opcional ausente)', async () => {
    fs.existsSync.mockReturnValue(true);
    const res = await request(app).get('/');
    expect(res.status).not.toBe(404);
  });

  test('segmento único "/infra" é capturado pelo fallback', async () => {
    fs.existsSync.mockReturnValue(true);
    const res = await request(app).get('/infra');
    expect(res.status).not.toBe(404);
  });
});

describe('Roteamento — parâmetros nomeados', () => {
  afterEach(() => jest.clearAllMocks());

  test('/api/layout/:viewName extrai o parâmetro e resolve o handler', async () => {
    fs.existsSync.mockReturnValue(false); // layout inexistente -> []
    const res = await request(app).get('/api/layout/minha-visao');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('/api/layout/:viewName aceita parâmetro com hífens e dígitos', async () => {
    fs.existsSync.mockReturnValue(false);
    const res = await request(app).get('/api/layout/view-2024-01');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('DELETE /api/cards/:cardId roteia para o handler de remoção (404 do recurso, não da rota)', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify([{ id: 'outro', cardType: 'list' }])));
    const res = await request(app).delete('/api/cards/inexistente');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/inexistente/);
  });
});

describe('Roteamento — query string (qs)', () => {
  afterEach(() => jest.clearAllMocks());

  test('parseia múltiplos parâmetros file e limit', async () => {
    fs.existsSync.mockReturnValue(true);
    const { Readable } = require('stream');
    const csv = ['h', 'a', 'b', 'c'].join('\n');
    fs.createReadStream.mockReturnValue(Readable.from([csv]));

    const res = await request(app).get('/api/partial-csv?file=/data/x.csv&limit=2');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  test('parâmetro "file" com caracteres percent-encoded é decodificado', async () => {
    fs.existsSync.mockReturnValue(false);
    // %2F = "/" ; o handler deve receber o caminho decodificado e responder 404 (arquivo ausente)
    const res = await request(app).get('/api/csv-count?file=%2Fdata%2Fevents.csv');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/não encontrado/);
  });
});
