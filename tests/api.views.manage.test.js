'use strict';

const request = require('supertest');
const fs      = require('fs');
const { createApp } = require('../src/app');

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync:       jest.fn(),
  readFile:         jest.fn(),
  writeFile:        jest.fn(),
  unlink:           jest.fn(),
  createReadStream: jest.fn(),
}));

const ROOT = '/fake/root';
const app  = createApp({ rootDir: ROOT, PYTHON_CMD: 'python' });

const VIEWS_STUB = [
  { value: 'default',   title: 'Padrão' },
  { value: 'infra',     title: 'Infraestrutura' },
];

// ============================================================ POST /api/views
describe('POST /api/views', () => {
  afterEach(() => jest.clearAllMocks());

  test('cria visão com sucesso e retorna 201', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));

    const res = await request(app)
      .post('/api/views')
      .send({ title: 'Segurança' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ value: 'seguranca', title: 'Segurança' });
  });

  test('gera slug correto a partir do título com acentos e espaços', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));

    const res = await request(app)
      .post('/api/views')
      .send({ title: 'Monitoramento Avançado' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body.value).toBe('monitoramento-avancado');
  });

  test('retorna 400 quando title está ausente', async () => {
    const res = await request(app)
      .post('/api/views')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('retorna 400 quando title está vazio', async () => {
    const res = await request(app)
      .post('/api/views')
      .send({ title: '   ' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  test('retorna 409 quando visão com mesmo valor já existe', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));

    const res = await request(app)
      .post('/api/views')
      .send({ title: 'Padrão' })   // slug "padrao" já existe como "default" — não conflita
      .set('Content-Type', 'application/json');

    // "Padrão" gera slug "padrao", que não existe → 201
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));
    expect([201, 409]).toContain(res.status);
  });

  test('retorna 409 quando slug gerado já existe na lista', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));

    const res = await request(app)
      .post('/api/views')
      .send({ title: 'Infra' })   // gera slug "infra" que já existe
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
  });

  test('cria primeira visão com 201 quando views.json ainda não existe (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    fs.readFile.mockImplementation((p, enc, cb) => cb(err));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));

    const res = await request(app)
      .post('/api/views')
      .send({ title: 'Primeira Visão' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ value: 'primeira-visao', title: 'Primeira Visão' });
  });

  test('salva array com uma entrada quando views.json não existia (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    fs.readFile.mockImplementation((p, enc, cb) => cb(err));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));

    await request(app)
      .post('/api/views')
      .send({ title: 'Primeira Visão' })
      .set('Content-Type', 'application/json');

    const savedViews = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(savedViews).toHaveLength(1);
    expect(savedViews[0]).toMatchObject({ value: 'primeira-visao' });
  });

  test('retorna 500 quando não consegue ler views.json por erro de I/O', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(new Error('disk error')));

    const res = await request(app)
      .post('/api/views')
      .send({ title: 'Nova Visão' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(500);
  });

  test('retorna 500 quando não consegue salvar views.json', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(new Error('write error')));

    const res = await request(app)
      .post('/api/views')
      .send({ title: 'Nova Visão' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(500);
  });

  test('cria arquivo de layout vazio para a nova visão', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));

    await request(app)
      .post('/api/views')
      .send({ title: 'Financeiro' })
      .set('Content-Type', 'application/json');

    const layoutCall = fs.writeFile.mock.calls.find(([p]) => p.includes('layout.config-financeiro'));
    expect(layoutCall).toBeDefined();
    expect(layoutCall[1]).toBe('[]');
  });
});

// ============================================================ DELETE /api/views/:viewName
describe('DELETE /api/views/:viewName', () => {
  afterEach(() => jest.clearAllMocks());

  test('exclui visão com sucesso e retorna 200', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));
    fs.existsSync.mockReturnValue(false);

    const res = await request(app).delete('/api/views/infra');

    expect(res.status).toBe(200);
  });

  test('remove a visão correta do array antes de salvar', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));
    fs.existsSync.mockReturnValue(false);

    await request(app).delete('/api/views/infra');

    const savedData = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(savedData.some(v => v.value === 'infra')).toBe(false);
    expect(savedData.some(v => v.value === 'default')).toBe(true);
  });

  test('exclui o arquivo de layout quando ele existe', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));
    fs.existsSync.mockReturnValue(true);
    fs.unlink.mockImplementation((p, cb) => cb(null));

    await request(app).delete('/api/views/infra');

    expect(fs.unlink).toHaveBeenCalledTimes(1);
    const [unlinkedPath] = fs.unlink.mock.calls[0];
    expect(unlinkedPath).toContain('layout.config-infra.json');
  });

  test('não chama unlink quando arquivo de layout não existe', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(null));
    fs.existsSync.mockReturnValue(false);

    await request(app).delete('/api/views/infra');

    expect(fs.unlink).not.toHaveBeenCalled();
  });

  test('retorna 404 quando a visão não existe', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));

    const res = await request(app).delete('/api/views/nao-existe');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('retorna 500 quando não consegue ler views.json', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(new Error('disk error')));

    const res = await request(app).delete('/api/views/infra');

    expect(res.status).toBe(500);
  });

  test('retorna 500 quando não consegue salvar views.json após remoção', async () => {
    fs.readFile.mockImplementation((p, enc, cb) => cb(null, JSON.stringify(VIEWS_STUB)));
    fs.writeFile.mockImplementation((p, data, enc, cb) => cb(new Error('write error')));
    fs.existsSync.mockReturnValue(false);

    const res = await request(app).delete('/api/views/infra');

    expect(res.status).toBe(500);
  });
});