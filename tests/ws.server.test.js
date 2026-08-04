'use strict';

// Testes de integração para src/wsServer.js — exercita a biblioteca `ws` REAL
// (servidor via factory + cliente real) para garantir que o upgrade do pacote
// `ws` não quebre a API usada: WebSocket.Server, connection/message/close,
// broadcast (readyState/OPEN/send), rejeição de auth (close 4401) e o pipeline
// watcher.change -> broadcast.

const WebSocket = require('ws');
const { EventEmitter } = require('events');
const path = require('path');
const { createWebSocketServer, sanitizePath, toNativePath } = require('../src/wsServer');

// --------------------------------------------------------------- utilitários
function waitFor(emitter, event) {
  return new Promise((resolve) => emitter.once(event, (...args) => resolve(args)));
}

async function waitForCondition(fn, timeout = 2000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Tempo esgotado aguardando condição');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Watcher falso compatível com a interface usada: .add(path) e .on('change')
function makeWatcher() {
  const ee = new EventEmitter();
  ee.add = jest.fn();
  return ee;
}

// =========================================================== sanitizePath (puro)
describe('sanitizePath', () => {
  test('mantém a chave em formato POSIX ("/")', () => {
    expect(sanitizePath('public/local-events/x.csv')).toBe('public/local-events/x.csv');
  });

  test('converte "\\" (chokidar no Windows) para a mesma chave POSIX', () => {
    expect(sanitizePath('public\\local-events\\x.csv')).toBe('public/local-events/x.csv');
  });

  test('colapsa barras duplicadas', () => {
    expect(sanitizePath('public//local-events//x.csv')).toBe('public/local-events/x.csv');
  });

  test('caminho sem barras permanece inalterado', () => {
    expect(sanitizePath('arquivo.csv')).toBe('arquivo.csv');
  });

  test('cliente e chokidar produzem a mesma chave independente do separador', () => {
    expect(sanitizePath('public/local-events/x.csv'))
      .toBe(sanitizePath('public\\local-events\\x.csv'));
  });
});

// =========================================================== toNativePath (puro)
describe('toNativePath', () => {
  test('devolve o caminho com o separador nativo do SO', () => {
    expect(toNativePath('public/local-events/x.csv'))
      .toBe(['public', 'local-events', 'x.csv'].join(path.sep));
  });
});

// =========================================================== integração com ws real
describe('createWebSocketServer (integração — ws real)', () => {
  let server, watcher, port, clients;

  beforeEach(async () => {
    watcher = makeWatcher();
    server  = createWebSocketServer({ port: 0, watcher }); // porta 0 = efêmera
    clients = [];
    await waitFor(server.wss, 'listening');
    port = server.wss.address().port;
  });

  afterEach(async () => {
    clients.forEach((c) => { try { c.terminate(); } catch { /* ignore */ } });
    await new Promise((resolve) => server.wss.close(resolve));
  });

  function connect(query = '') {
    const ws = new WebSocket(`ws://localhost:${port}/${query}`);
    clients.push(ws);
    return ws;
  }

  test('aceita conexão e registra o cliente', async () => {
    const ws = connect();
    await waitFor(ws, 'open');
    await waitForCondition(() => server.clients.size === 1);
    expect(server.clients.size).toBe(1);
  });

  test('mensagem "watch" registra o arquivo e chama watcher.add com o caminho sanitizado', async () => {
    const ws = connect();
    await waitFor(ws, 'open');

    const filePath  = 'public/local-events/a.csv';
    const sanitized = sanitizePath(filePath);
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-1' }));

    await waitForCondition(() => server.watchedFiles.has(sanitized));
    expect(server.watchedFiles.get(sanitized).has('card-1')).toBe(true);
    // chokidar recebe o caminho nativo do SO, não a chave canônica do Map
    expect(watcher.add).toHaveBeenCalledWith(toNativePath(sanitized));
  });

  test('múltiplos cards no mesmo arquivo são deduplicados em um Set e watcher.add é chamado uma única vez', async () => {
    const ws = connect();
    await waitFor(ws, 'open');

    const filePath  = 'public/local-events/a.csv';
    const sanitized = sanitizePath(filePath);
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-1' }));
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-2' }));
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-1' })); // duplicado

    await waitForCondition(() => server.watchedFiles.get(sanitized)?.size === 2);
    expect([...server.watchedFiles.get(sanitized)]).toEqual(['card-1', 'card-2']);
    expect(watcher.add).toHaveBeenCalledTimes(1);
  });

  test('evento "change" do watcher dispara broadcast {type:"update"} para o cliente que assinou', async () => {
    const ws = connect();
    await waitFor(ws, 'open');

    const filePath  = 'public/local-events/a.csv';
    const sanitized = sanitizePath(filePath);
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-1' }));
    await waitForCondition(() => server.watchedFiles.has(sanitized));

    const msg = waitFor(ws, 'message');
    // chokidar entrega o caminho com "/"; sanitizePath normaliza para a mesma chave do Map
    watcher.emit('change', filePath);
    const [raw] = await msg;

    expect(JSON.parse(raw.toString())).toEqual({ type: 'update', cardId: 'card-1' });
  });

  test('evento "add" (arquivo recriado por gravação atômica) também dispara update', async () => {
    const ws = connect();
    await waitFor(ws, 'open');

    const filePath  = 'public/local-events/a.csv';
    const sanitized = sanitizePath(filePath);
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-1' }));
    await waitForCondition(() => server.watchedFiles.has(sanitized));

    const msg = waitFor(ws, 'message');
    watcher.emit('add', filePath);
    const [raw] = await msg;

    expect(JSON.parse(raw.toString())).toEqual({ type: 'update', cardId: 'card-1' });
  });

  test('change com separador nativo do SO casa com a chave registrada pelo cliente', async () => {
    const ws = connect();
    await waitFor(ws, 'open');

    const filePath  = 'public/local-events/a.csv';
    const sanitized = sanitizePath(filePath);
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-1' }));
    await waitForCondition(() => server.watchedFiles.has(sanitized));

    const msg = waitFor(ws, 'message');
    // chokidar emite o caminho como o SO o entrega (com "\" no Windows)
    watcher.emit('change', toNativePath(sanitized));
    const [raw] = await msg;

    expect(JSON.parse(raw.toString())).toEqual({ type: 'update', cardId: 'card-1' });
  });

  test('change em arquivo não monitorado não envia nada ao cliente', async () => {
    const ws = connect();
    await waitFor(ws, 'open');

    const received = [];
    ws.on('message', (d) => received.push(d.toString()));

    watcher.emit('change', 'public/local-events/nao-monitorado.csv');
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toEqual([]);
  });

  test('remove o cliente do conjunto ao desconectar', async () => {
    const ws = connect();
    await waitFor(ws, 'open');
    await waitForCondition(() => server.clients.size === 1);

    ws.close();
    await waitForCondition(() => server.clients.size === 0);
    expect(server.clients.size).toBe(0);
  });

  test('mensagem malformada não derruba o servidor; um "watch" posterior ainda funciona', async () => {
    const ws = connect();
    await waitFor(ws, 'open');

    ws.send('isto-nao-e-json');
    const filePath  = 'public/local-events/b.csv';
    const sanitized = sanitizePath(filePath);
    ws.send(JSON.stringify({ type: 'watch', filePath, cardId: 'card-9' }));

    await waitForCondition(() => server.watchedFiles.has(sanitized));
    expect(server.watchedFiles.get(sanitized).has('card-9')).toBe(true);
  });

  test('broadcast envia somente para clientes com readyState OPEN', () => {
    const open    = { readyState: WebSocket.OPEN,    send: jest.fn() };
    const closing = { readyState: WebSocket.CLOSING, send: jest.fn() };
    server.clients.add(open);
    server.clients.add(closing);

    server.broadcast({ type: 'update', cardId: 'x' });

    const expected = JSON.stringify({ type: 'update', cardId: 'x' });
    expect(open.send).toHaveBeenCalledWith(expected);
    expect(closing.send).not.toHaveBeenCalled();
  });

  test('getHealthInfo reflete clientes conectados e arquivos monitorados', async () => {
    const ws = connect();
    await waitFor(ws, 'open');
    ws.send(JSON.stringify({ type: 'watch', filePath: 'public/local-events/c.csv', cardId: 'card-5' }));
    await waitForCondition(() => server.watchedFiles.size === 1);

    const info = server.getHealthInfo();
    expect(info.websocket.status).toBe('ok');
    expect(info.websocket.port).toBe(port);
    expect(info.websocket.connectedClients).toBe(1);
    expect(info.watchers.totalFiles).toBe(1);
    expect(info.watchers.watched['public/local-events/c.csv']).toEqual(['card-5']);
  });
});

// =========================================================== autenticação na conexão
describe('createWebSocketServer — autenticação na conexão', () => {
  let server, port;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.wss.close(resolve));
    server = null;
  });

  async function start(opts) {
    server = createWebSocketServer({ port: 0, ...opts });
    await waitFor(server.wss, 'listening');
    port = server.wss.address().port;
  }

  test('fecha com código 4401 quando auth está ligada e o token é inválido', async () => {
    await start({ isAuthEnabled: () => true, validateSession: () => null });

    const ws = new WebSocket(`ws://localhost:${port}/?token=invalido`);
    const [code] = await waitFor(ws, 'close');

    expect(code).toBe(4401);
    expect(server.clients.size).toBe(0);
  });

  test('aceita a conexão quando o token é válido', async () => {
    await start({
      isAuthEnabled:   () => true,
      validateSession: (t) => (t === 'bom' ? { username: 'u', role: 'editor' } : null),
    });

    const ws = new WebSocket(`ws://localhost:${port}/?token=bom`);
    await waitFor(ws, 'open');
    await waitForCondition(() => server.clients.size === 1);

    expect(server.clients.size).toBe(1);
    ws.terminate();
  });

  test('aceita sem token quando a auth está desligada', async () => {
    await start({ isAuthEnabled: () => false });

    const ws = new WebSocket(`ws://localhost:${port}/`);
    await waitFor(ws, 'open');
    await waitForCondition(() => server.clients.size === 1);

    expect(server.clients.size).toBe(1);
    ws.terminate();
  });
});
