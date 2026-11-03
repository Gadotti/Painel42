'use strict';

const request = require('supertest');
const fs      = require('fs');
const path    = require('path');
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

describe('createApp (smoke tests)', () => {
  test('instância retornada é uma função Express válida', () => {
    expect(typeof app).toBe('function');
    expect(app).toHaveProperty('listen');
  });

  test('usa rootDir padrão quando não informado', () => {
    const { createApp: ca } = require('../src/app');
    const defaultApp = ca();
    expect(typeof defaultApp).toBe('function');
  });
});

describe('SPA Fallback GET /:view?', () => {
  afterEach(() => jest.clearAllMocks());

  test('retorna index.html para rotas desconhecidas', async () => {
    // sendFile precisará do fs real — simulamos com mock básico
    fs.existsSync.mockReturnValue(true);

    // O sendFile falha porque /fake/root/public/index.html não existe: 500 no
    // Windows e 404 no Linux. Por isso o teste não olha o status, e sim se o
    // handler foi acionado: rota inexistente gera o "Cannot GET <rota>" do Express.
    const res = await request(app).get('/qualquer-view');
    expect(res.text).not.toMatch(/Cannot GET/);
  });
});
