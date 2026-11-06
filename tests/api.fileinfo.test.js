'use strict';

const request   = require('supertest');
const fs        = require('fs');
const path      = require('path');
const { createApp } = require('../src/app');

// Apenas fs.promises.stat/realpath são mockados: fs.stat (callback) continua real
// porque é usado internamente pelo express.static em toda requisição.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    readFile:   jest.fn(),
    promises: { ...actual.promises, stat: jest.fn(), realpath: jest.fn() },
  };
});

const ROOT = '/fake/root';
const app  = createApp({ rootDir: ROOT, PYTHON_CMD: 'python' });

const DATA_FILE = 'public/local-events/events.csv';
const DATA_ABS  = path.resolve(ROOT, DATA_FILE);

describe('GET /api/file-info', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // por padrão o arquivo existe e não é link: realpath devolve o próprio caminho
    fs.promises.realpath.mockImplementation(async p => p);
  });

  test('retorna 400 quando o parâmetro "file" está ausente', async () => {
    const res = await request(app).get('/api/file-info');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file/);
  });

  test('retorna 404 quando o arquivo não existe', async () => {
    fs.promises.realpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const res = await request(app).get(`/api/file-info?file=${DATA_FILE}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/não encontrado/);
    expect(fs.promises.stat).not.toHaveBeenCalled();
  });

  test('retorna 400 quando o caminho não é um arquivo', async () => {
    fs.promises.stat.mockResolvedValue({
      isFile: () => false,
      mtime:  new Date('2025-03-10T14:32:00.000Z'),
      size:   0,
    });

    const res = await request(app).get('/api/file-info?file=public/local-events/subpasta');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não é um arquivo/);
  });

  test('retorna mtime em ISO 8601 e o tamanho do arquivo', async () => {
    fs.promises.stat.mockResolvedValue({
      isFile: () => true,
      mtime:  new Date('2025-03-10T14:32:05.000Z'),
      size:   2048,
    });

    const res = await request(app).get(`/api/file-info?file=${DATA_FILE}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mtime: '2025-03-10T14:32:05.000Z', size: 2048 });
  });

  test('resolve o caminho relativo à raiz do projeto e consulta o caminho real', async () => {
    fs.promises.stat.mockResolvedValue({
      isFile: () => true,
      mtime:  new Date('2025-03-10T14:32:05.000Z'),
      size:   10,
    });

    const res = await request(app).get(`/api/file-info?file=${encodeURIComponent(DATA_FILE)}`);

    expect(res.status).toBe(200);
    expect(fs.promises.realpath).toHaveBeenCalledWith(DATA_ABS);
    expect(fs.promises.stat).toHaveBeenCalledWith(DATA_ABS);
  });

  test.each([
    ['caminho absoluto Windows fora do projeto', 'E:\\dados\\eventos.csv'],
    ['caminho absoluto Unix fora do projeto',    '/etc/passwd'],
    ['configs/ (usuários e sessões)',            'configs/sessions.json'],
    ['traversal a partir de local-*',            'public/local-events/../../configs/users.json'],
    ['arquivo de public/ fora de local-*',       'public/js/main.js'],
  ])('retorna 403 sem consultar o disco: %s', async (_, file) => {
    const res = await request(app).get(`/api/file-info?file=${encodeURIComponent(file)}`);

    expect(res.status).toBe(403);
    expect(fs.promises.realpath).not.toHaveBeenCalled();
    expect(fs.promises.stat).not.toHaveBeenCalled();
  });
});
