'use strict';

// POST /api/chart-data — executa um script Python e devolve o stdout (JSON do gráfico).
// Regras de segurança cobertas:
//   1) só scripts .py dentro de scripts/ (checagem léxica e após realpath)
//   2) só o par script + sourceFile declarado por um card do tipo "chart"
//   3) sourceFile somente em public/local-* (resolveDataFile)
//   4) stderr nunca volta ao cliente (vai para o log do servidor)
//   5) erro ao iniciar o Python (ENOENT) não derruba o servidor; tempo limite → 504
//   6) readLimiter
// Usa o sistema de arquivos REAL numa pasta temporária; o Python é um spawn falso injetado.

const request          = require('supertest');
const fs               = require('fs');
const os               = require('os');
const path             = require('path');
const { EventEmitter } = require('events');
const { createApp }    = require('../src/app');
const { hashPassword } = require('../src/auth');

const PASSWORD = 'senha-de-teste-123';
const SCRIPT   = 'scripts/count_events_by_weekday.py';
const SOURCE   = 'public/local-events/ransomlook/breachs_posts.csv';
const OUTPUT   = JSON.stringify({ labels: ['Seg', 'Ter'], data: [10, 20] });

let BASE;
let OPEN;      // projeto sem usuários (autenticação desligada)
let AUTH;      // projeto com usuários
let OUTSIDE;   // pasta fora do projeto (com um .py "malicioso")
let JUNCTIONS = [];

const CARDS = [
  { id: 'ransom', cardType: 'chart', sourceItems: SOURCE,
    chart: { type: 'bar', data: { labels: [], datasets: [{ label: 'x', script: SCRIPT }] } } },
  { id: 'segundo-dataset', cardType: 'chart', sourceItems: 'public/local-events/outro.csv',
    chart: { type: 'line', data: { datasets: [{ label: 'fixo', data: [1] }, { label: 's', script: 'scripts/sub/agrega.py' }] } } },
  { id: 'sem-fonte', cardType: 'chart',
    chart: { type: 'bar', data: { datasets: [{ script: 'scripts/sem_fonte.py' }] } } },
  { id: 'fonte-proibida', cardType: 'chart', sourceItems: 'configs/users.json',
    chart: { type: 'bar', data: { datasets: [{ script: SCRIPT }] } } },
  { id: 'escape', cardType: 'chart', sourceItems: SOURCE,
    chart: { type: 'bar', data: { datasets: [{ script: 'scripts/escape/evil.py' }] } } },
  { id: 'script-ausente', cardType: 'chart', sourceItems: SOURCE,
    chart: { type: 'bar', data: { datasets: [{ script: 'scripts/nao_existe.py' }] } } },
  { id: 'fonte-ausente', cardType: 'chart', sourceItems: 'public/local-events/nao_existe.csv',
    chart: { type: 'bar', data: { datasets: [{ script: SCRIPT }] } } },
  // não é gráfico: mesmo com "script" no formato de chart, não autoriza nada
  { id: 'lista', cardType: 'list', sourceItems: SOURCE,
    chart: { data: { datasets: [{ script: 'scripts/check_status.py' }] } } },
  { id: 'inline', cardType: 'chart', chart: { type: 'bar', data: { datasets: [{ data: [1, 2] }] } } },
];

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function scaffold(root, withUsers) {
  write(path.join(root, 'public/index.html'), '<!doctype html><title>SPA</title>');
  write(path.join(root, SCRIPT), 'print("{}")');
  write(path.join(root, 'scripts/sub/agrega.py'), 'print("{}")');
  write(path.join(root, 'scripts/sem_fonte.py'), 'print("{}")');
  write(path.join(root, 'scripts/check_status.py'), '# não declarado como gráfico');
  write(path.join(root, 'scripts/cache/nvd.json'), '{"a": true}');
  write(path.join(root, SOURCE), 'timestamp;evento\n2026-11-06T10:00:00Z;a\n');
  write(path.join(root, 'public/local-events/outro.csv'), 'timestamp;evento\n');
  write(path.join(root, 'public/local-events/payload.py'), 'print("x")');
  write(path.join(root, 'configs/views.json'), '[]');
  write(path.join(root, 'cards/cards-list.json'), JSON.stringify(CARDS));
  if (withUsers) {
    const { salt, hash } = hashPassword(PASSWORD);
    write(path.join(root, 'configs/users.json'), JSON.stringify([
      { name: 'Vi', username: 'viewer-t', role: 'viewer', salt, hash },
    ]));
  } else {
    write(path.join(root, 'configs/users.json'), '[]');
  }
  // junction (Windows, sem admin) / symlink de diretório (Linux): scripts/escape → fora do projeto
  const link = path.join(root, 'scripts/escape');
  fs.symlinkSync(OUTSIDE, link, 'junction');
  JUNCTIONS.push(link);
}

beforeAll(() => {
  BASE    = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-chartdata-'));
  OPEN    = path.join(BASE, 'projeto-aberto');
  AUTH    = path.join(BASE, 'projeto');
  OUTSIDE = path.join(BASE, 'fora');
  write(path.join(OUTSIDE, 'evil.py'), 'import os');
  scaffold(OPEN, false);
  scaffold(AUTH, true);
});

afterAll(() => {
  // remove os links antes, para nunca seguir o destino
  for (const link of JUNCTIONS) { try { fs.unlinkSync(link); } catch { /* ignore */ } }
  fs.rmSync(BASE, { recursive: true, force: true });
});

/** Processo Python falso. Use com mockImplementation, nunca mockReturnValue. */
function fakePython({ stdout = '', stderr = '', exitCode = 0, error = null, hang = false } = {}) {
  const proc  = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill   = jest.fn();
  setImmediate(() => {
    if (error) {
      proc.emit('error', error);
      proc.emit('close', -2); // o Node também emite close depois de um erro de spawn
      return;
    }
    if (hang) return;
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  });
  return proc;
}

function makeApp(opts = {}) {
  const spawn = opts.spawn || jest.fn().mockImplementation(() => fakePython({ stdout: OUTPUT }));
  const app   = createApp({ rootDir: opts.root || OPEN, PYTHON_CMD: opts.python || 'python', spawn, ...opts.config });
  return { app, spawn };
}

const post = (app, body) => request(app).post('/api/chart-data').send(body);
const real = (root, rel) => fs.realpathSync(path.join(root, rel));

// ====================================================================
describe('execução permitida — script e fonte declarados por um card', () => {
  test('executa o script do card e devolve o stdout', async () => {
    const { app, spawn } = makeApp();
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ output: OUTPUT });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('python', [real(OPEN, SCRIPT), real(OPEN, SOURCE)]);
  });

  test('usa o executável Python configurado', async () => {
    const { app, spawn } = makeApp({ python: 'python3' });
    await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(spawn.mock.calls[0][0]).toBe('python3');
  });

  test('devolve o stdout sem espaços e quebras de linha nas pontas', async () => {
    const spawn = jest.fn().mockImplementation(() => fakePython({ stdout: '  {"labels":[],"data":[]}  \n' }));
    const { app } = makeApp({ spawn });
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(res.body.output).toBe('{"labels":[],"data":[]}');
  });

  test('aceita grafia equivalente do mesmo caminho (./, barra invertida)', async () => {
    const { app, spawn } = makeApp();
    const res = await post(app, {
      scriptPath: './scripts\\count_events_by_weekday.py',
      sourceFile: 'public/./local-events/ransomlook/breachs_posts.csv',
    });
    if (path.sep === '\\') {
      expect(res.status).toBe(200);
      expect(spawn).toHaveBeenCalledWith('python', [real(OPEN, SCRIPT), real(OPEN, SOURCE)]);
    } else {
      // no Linux "\" é um caractere comum do nome: não é o script declarado
      expect(res.status).toBe(403);
    }
  });

  test('script declarado em outro dataset e em subpasta de scripts/', async () => {
    const { app, spawn } = makeApp();
    const res = await post(app, { scriptPath: 'scripts/sub/agrega.py', sourceFile: 'public/local-events/outro.csv' });
    expect(res.status).toBe(200);
    expect(spawn).toHaveBeenCalledWith('python',
      [real(OPEN, 'scripts/sub/agrega.py'), real(OPEN, 'public/local-events/outro.csv')]);
  });

  test.each([
    ['sem sourceFile', {}],
    ['sourceFile vazio', { sourceFile: '' }],
    ['sourceFile null', { sourceFile: null }],
  ])('card sem sourceItems: %s → executa só com o script', async (_, extra) => {
    const { app, spawn } = makeApp();
    const res = await post(app, { scriptPath: 'scripts/sem_fonte.py', ...extra });
    expect(res.status).toBe(200);
    expect(spawn).toHaveBeenCalledWith('python', [real(OPEN, 'scripts/sem_fonte.py')]);
  });

  test('cada card de gráfico do painel de exemplo segue funcionando (contrato do frontend)', async () => {
    // o frontend envia { scriptPath: datasets[0].script, sourceFile: card.sourceItems }
    const { app } = makeApp();
    const card = CARDS[0];
    const res = await post(app, { scriptPath: card.chart.data.datasets[0].script, sourceFile: card.sourceItems });
    expect(res.status).toBe(200);
  });
});

// ====================================================================
describe('bloqueios — nada é executado', () => {
  let app;
  let spawn;
  beforeEach(() => { ({ app, spawn } = makeApp()); });
  afterEach(() => expect(spawn).not.toHaveBeenCalled());

  test.each([
    ['sem scriptPath',            { sourceFile: SOURCE }],
    ['scriptPath vazio',          { scriptPath: '' }],
    ['scriptPath array',          { scriptPath: [SCRIPT] }],
    ['scriptPath objeto',         { scriptPath: { a: 1 } }],
    ['sourceFile array',          { scriptPath: SCRIPT, sourceFile: [SOURCE] }],
    ['sourceFile número',         { scriptPath: SCRIPT, sourceFile: 42 }],
  ])('400: %s', async (_, body) => {
    const res = await post(app, body);
    expect(res.status).toBe(400);
  });

  test('400 sem corpo JSON', async () => {
    const res = await request(app).post('/api/chart-data');
    expect(res.status).toBe(400);
  });

  test.each([
    ['configs/users.json (vazaria linhas no traceback)', 'configs/users.json'],
    ['configs/sessions.json',                           'configs/sessions.json'],
    ['traversal a partir de scripts/',                  'scripts/../configs/users.json'],
    ['traversal para .py fora',                         'scripts/../../fora/evil.py'],
    ['caminho absoluto fora do projeto',                'ABS_OUTSIDE'],
    ['caminho absoluto Unix',                           '/usr/lib/python3/http/server.py'],
    ['caminho absoluto Windows',                        'C:\\Python314\\Lib\\http\\server.py'],
    ['arquivo não-.py dentro de scripts/',              'scripts/cache/nvd.json'],
    ['.py fora de scripts/',                            'public/local-events/payload.py'],
    ['a própria pasta scripts/',                        'scripts'],
    ['server.js',                                       'server.js'],
    ['byte nulo',                                       'scripts/count_events_by_weekday.py\0.txt'],
  ])('403: %s', async (_, scriptPath) => {
    if (scriptPath === 'ABS_OUTSIDE') scriptPath = path.join(OUTSIDE, 'evil.py');
    const res = await post(app, { scriptPath, sourceFile: SOURCE });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Acesso negado/);
  });

  test('403: .py de scripts/ que nenhum card de gráfico declara (check_status.py)', async () => {
    const res = await post(app, { scriptPath: 'scripts/check_status.py', sourceFile: 'public/local-events/outro.csv' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/não declarado/);
  });

  test('403: script declarado só por card que não é do tipo chart', async () => {
    const res = await post(app, { scriptPath: 'scripts/check_status.py', sourceFile: SOURCE });
    expect(res.status).toBe(403);
  });

  test.each([
    ['outro arquivo de local-*', 'public/local-events/outro.csv'],
    ['arquivo em configs/',      'configs/users.json.bak'],
    ['caminho absoluto',         '/etc/passwd'],
    ['sem sourceFile',           undefined],
  ])('403: script declarado com fonte diferente da do card (%s)', async (_, sourceFile) => {
    const res = await post(app, { scriptPath: SCRIPT, sourceFile });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/não declarado/);
  });

  test('403: card declara fonte fora de public/local-* (editor não libera leitura arbitrária)', async () => {
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: 'configs/users.json' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/public\/local-\*/);
  });

  test('403: script declarado dentro de scripts/ mas que é junction/symlink para fora', async () => {
    const res = await post(app, { scriptPath: 'scripts/escape/evil.py', sourceFile: SOURCE });
    expect(res.status).toBe(403);
  });

  test('404: script declarado que não existe', async () => {
    const res = await post(app, { scriptPath: 'scripts/nao_existe.py', sourceFile: SOURCE });
    expect(res.status).toBe(404);
  });

  test('404: fonte declarada que não existe', async () => {
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: 'public/local-events/nao_existe.csv' });
    expect(res.status).toBe(404);
  });

});

// ====================================================================
describe('cards-list.json ausente ou corrompido', () => {
  const cardsFile = () => path.join(OPEN, 'cards/cards-list.json');
  afterEach(() => write(cardsFile(), JSON.stringify(CARDS)));

  test('sem cards-list.json → 403 (nenhum script declarado)', async () => {
    fs.unlinkSync(cardsFile());
    const { app, spawn } = makeApp();
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(res.status).toBe(403);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('cards-list.json inválido → 500, sem executar', async () => {
    write(cardsFile(), '{ quebrado');
    const { app, spawn } = makeApp();
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(res.status).toBe(500);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('alteração no cards-list.json vale na hora (sem reiniciar)', async () => {
    const { app } = makeApp();
    expect((await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE })).status).toBe(200);
    write(cardsFile(), JSON.stringify(CARDS.filter(c => c.id !== 'ransom')));
    expect((await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE })).status).toBe(403);
  });
});

// ====================================================================
describe('falhas do script e do processo', () => {
  beforeEach(() => console.error.mockClear());

  test('exit code != 0 → 500 sem stderr na resposta; stderr vai para o log', async () => {
    const leak = '  {"username": "fulano", "hash": "FAKEHASH", "active": true}\nNameError: name \'true\' is not defined';
    const spawn = jest.fn().mockImplementation(() => fakePython({ stderr: leak, exitCode: 1 }));
    const { app } = makeApp({ spawn });

    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro ao executar o script (code 1)' });
    expect(res.text).not.toMatch(/FAKEHASH|NameError/);
    const logged = console.error.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toMatch(/NameError/);
  });

  test('stderr muito grande é truncado no log', async () => {
    const spawn = jest.fn().mockImplementation(() => fakePython({ stderr: 'x'.repeat(50000), exitCode: 1 }));
    const { app } = makeApp({ spawn });
    await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    const logged = console.error.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged.length).toBeLessThan(10000);
  });

  test('Python inexistente (evento error/ENOENT) → 500 e o servidor continua respondendo', async () => {
    const enoent = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' });
    const spawn = jest.fn()
      .mockImplementationOnce(() => fakePython({ error: enoent }))
      .mockImplementation(() => fakePython({ stdout: OUTPUT }));
    const { app } = makeApp({ spawn });

    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Não foi possível executar o script.' });

    const next = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(next.status).toBe(200);
  });

  test('spawn que lança exceção síncrona → 500', async () => {
    const spawn = jest.fn().mockImplementation(() => { throw new Error('EPERM'); });
    const { app } = makeApp({ spawn });
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(res.status).toBe(500);
  });

  test('script que não termina → 504 e o processo é encerrado', async () => {
    let proc;
    const spawn = jest.fn().mockImplementation(() => (proc = fakePython({ hang: true })));
    const { app } = makeApp({ spawn, config: { chartScriptTimeoutMs: 100 } });

    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });

    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/Tempo limite/);
    expect(proc.kill).toHaveBeenCalled();
    // o close que chega depois do kill não gera segunda resposta nem erro
    expect(() => proc.emit('close', null)).not.toThrow();
  });

  test('script rápido não é encerrado pelo tempo limite', async () => {
    let proc;
    const spawn = jest.fn().mockImplementation(() => (proc = fakePython({ stdout: OUTPUT })));
    const { app } = makeApp({ spawn, config: { chartScriptTimeoutMs: 100 } });
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    await new Promise(r => setTimeout(r, 150));
    expect(res.status).toBe(200);
    expect(proc.kill).not.toHaveBeenCalled();
  });
});

// ====================================================================
describe('autenticação', () => {
  test('sem login → 401 e nada é executado', async () => {
    const { app, spawn } = makeApp({ root: AUTH });
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(res.status).toBe(401);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('viewer pode carregar o gráfico declarado, mas não executar outro script', async () => {
    const { app, spawn } = makeApp({ root: AUTH });
    const login = await request(app).post('/api/auth/login').send({ username: 'viewer-t', password: PASSWORD });
    const auth = { Authorization: 'Bearer ' + login.body.token };

    const ok = await request(app).post('/api/chart-data').set(auth).send({ scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(ok.status).toBe(200);

    const blocked = await request(app).post('/api/chart-data').set(auth)
      .send({ scriptPath: 'configs/users.json', sourceFile: SOURCE });
    expect(blocked.status).toBe(403);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

// ====================================================================
describe('rate limiting (readLimiter)', () => {
  test('bloqueia acima do limite com 429 sem executar', async () => {
    const { app, spawn } = makeApp({ config: { readRateLimit: { limit: 2 } } });
    for (let i = 0; i < 2; i++) {
      expect((await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE })).status).toBe(200);
    }
    const blocked = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Muitas requisições/);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test('a cota é compartilhada com as rotas de dados (partial-csv)', async () => {
    const { app } = makeApp({ config: { readRateLimit: { limit: 2 } } });
    await request(app).get(`/api/partial-csv?file=${SOURCE}&limit=1`);
    await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect((await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE })).status).toBe(429);
  });

  test('não consome a cota de gravação', async () => {
    const { app } = makeApp({ config: { writeRateLimit: { limit: 1 } } });
    for (let i = 0; i < 5; i++) {
      expect((await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE })).status).toBe(200);
    }
    const write = await request(app).post('/api/layout/teste').send([]);
    expect(write.status).not.toBe(429);
  });

  test('limite padrão de 600/min informado no cabeçalho', async () => {
    const { app } = makeApp();
    const res = await post(app, { scriptPath: SCRIPT, sourceFile: SOURCE });
    expect(res.headers['ratelimit']).toMatch(/limit=600, remaining=599/);
  });
});
