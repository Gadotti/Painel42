'use strict';

const request   = require('supertest');
const fs        = require('fs');
const { Readable } = require('stream');
const { createApp } = require('../src/app');

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync:       jest.fn(),
    readFile:         jest.fn(),
    writeFile:        jest.fn(),
    createReadStream: jest.fn(),
    // realpath valida ?file= (somente public/local-*) e confirma a existência
    promises: { ...actual.promises, realpath: jest.fn() },
  };
});

const ROOT = '/fake/root';
const app  = createApp({ rootDir: ROOT, PYTHON_CMD: 'python' });

// Utilitário: cria um stream legível a partir de uma string
function makeStream(content) {
  const r = new Readable();
  r.push(content);
  r.push(null);
  return r;
}

describe('GET /api/partial-csv', () => {
  afterEach(() => jest.clearAllMocks());

  test('retorna 400 quando o parâmetro "file" está ausente', async () => {
    const res = await request(app).get('/api/partial-csv');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file/);
  });

  test('retorna 404 quando o arquivo não existe', async () => {
    fs.promises.realpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const res = await request(app).get('/api/partial-csv?file=public/local-events/events.csv');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/não encontrado/);
  });

  test('retorna CSV com header + últimas N linhas', async () => {
    fs.promises.realpath.mockImplementation(async p => p);

    const csvContent = [
      'timestamp,event',
      '2024-01-01,login',
      '2024-01-02,logout',
      '2024-01-03,alert',
    ].join('\n');

    fs.createReadStream.mockReturnValue(makeStream(csvContent));

    const res = await request(app)
      .get('/api/partial-csv?file=public/local-events/events.csv&limit=2');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);

    const lines = res.text.split('\n');
    // Deve conter o header
    expect(lines[0]).toBe('timestamp,event');
    // Com limit=2, deve devolver no máximo 2 linhas de dados (+ header)
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  test('respeita o limite padrão de 10 linhas quando limit não é informado', async () => {
    fs.promises.realpath.mockImplementation(async p => p);

    const dataLines = Array.from({ length: 20 }, (_, i) => `2024-01-${String(i+1).padStart(2,'0')},event-${i}`);
    const csvContent = ['timestamp,event', ...dataLines].join('\n');

    fs.createReadStream.mockReturnValue(makeStream(csvContent));

    const res = await request(app).get('/api/partial-csv?file=public/local-events/events.csv');

    expect(res.status).toBe(200);
    const lines = res.text.split('\n').filter(Boolean);
    // header + até 10 linhas de dados
    expect(lines.length).toBeLessThanOrEqual(11);
  });

  test('inclui sempre o header mesmo quando há poucas linhas de dados', async () => {
    fs.promises.realpath.mockImplementation(async p => p);

    const csvContent = 'col1,col2\nval1,val2';
    fs.createReadStream.mockReturnValue(makeStream(csvContent));

    const res = await request(app).get('/api/partial-csv?file=public/local-events/events.csv&limit=10');

    expect(res.status).toBe(200);
    expect(res.text).toContain('col1,col2');
    expect(res.text).toContain('val1,val2');
  });

  test('retorna 500 quando o stream lança exceção', async () => {
    fs.promises.realpath.mockImplementation(async p => p);

    const brokenStream = new Readable({
      read() { this.destroy(new Error('stream error')); },
    });
    fs.createReadStream.mockReturnValue(brokenStream);

    const res = await request(app).get('/api/partial-csv?file=public/local-events/events.csv');

    expect(res.status).toBe(500);
  });
});

describe('GET /api/csv-count', () => {
  afterEach(() => jest.clearAllMocks());

  test('retorna 400 quando o parâmetro "file" está ausente', async () => {
    const res = await request(app).get('/api/csv-count');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file/);
  });

  test('retorna 404 quando o arquivo não existe', async () => {
    fs.promises.realpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const res = await request(app).get('/api/csv-count?file=public/local-events/events.csv');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/não encontrado/);
  });

  test('retorna contagem correta de linhas excluindo o header', async () => {
    fs.promises.realpath.mockImplementation(async p => p);
    const csvContent = ['timestamp;event', 'a;b', 'c;d', 'e;f'].join('\n');
    fs.createReadStream.mockReturnValue(makeStream(csvContent));

    const res = await request(app).get('/api/csv-count?file=public/local-events/events.csv');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  test('não conta linhas vazias', async () => {
    fs.promises.realpath.mockImplementation(async p => p);
    const csvContent = ['header', 'row1', '', 'row2', ''].join('\n');
    fs.createReadStream.mockReturnValue(makeStream(csvContent));

    const res = await request(app).get('/api/csv-count?file=public/local-events/events.csv');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  test('retorna 0 para arquivo com apenas o header', async () => {
    fs.promises.realpath.mockImplementation(async p => p);
    fs.createReadStream.mockReturnValue(makeStream('header\n'));

    const res = await request(app).get('/api/csv-count?file=public/local-events/events.csv');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});
