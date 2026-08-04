'use strict';

const request   = require('supertest');
const fs        = require('fs');
const { createApp } = require('../src/app');

// Apenas fs.promises.stat é mockado: fs.stat (callback) continua real porque é
// usado internamente pelo express.static em toda requisição.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    readFile:   jest.fn(),
    promises: { ...actual.promises, stat: jest.fn() },
  };
});

const ROOT = '/fake/root';
const app  = createApp({ rootDir: ROOT, PYTHON_CMD: 'python' });

describe('GET /api/file-info', () => {
  afterEach(() => jest.clearAllMocks());

  test('retorna 400 quando o parâmetro "file" está ausente', async () => {
    const res = await request(app).get('/api/file-info');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file/);
  });

  test('retorna 404 quando o arquivo não existe', async () => {
    fs.promises.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const res = await request(app).get('/api/file-info?file=/data/events.csv');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/não encontrado/);
  });

  test('retorna 400 quando o caminho não é um arquivo', async () => {
    fs.promises.stat.mockResolvedValue({
      isFile: () => false,
      mtime:  new Date('2025-03-10T14:32:00.000Z'),
      size:   0,
    });

    const res = await request(app).get('/api/file-info?file=/data');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não é um arquivo/);
  });

  test('retorna mtime em ISO 8601 e o tamanho do arquivo', async () => {
    fs.promises.stat.mockResolvedValue({
      isFile: () => true,
      mtime:  new Date('2025-03-10T14:32:05.000Z'),
      size:   2048,
    });

    const res = await request(app).get('/api/file-info?file=/data/events.csv');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mtime: '2025-03-10T14:32:05.000Z', size: 2048 });
  });

  test('consulta o caminho exatamente como recebido (Windows ou Linux)', async () => {
    fs.promises.stat.mockResolvedValue({
      isFile: () => true,
      mtime:  new Date('2025-03-10T14:32:05.000Z'),
      size:   10,
    });

    const winPath = 'E:\\dados\\eventos.csv';
    const res = await request(app).get(`/api/file-info?file=${encodeURIComponent(winPath)}`);

    expect(res.status).toBe(200);
    expect(fs.promises.stat).toHaveBeenCalledWith(winPath);
  });
});
