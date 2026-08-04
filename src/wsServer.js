'use strict';

const WebSocket = require('ws');
const path      = require('path');
const { URL }   = require('url');

/**
 * Normaliza um caminho parcial recebido do cliente (ou do chokidar) para a
 * forma usada como chave no Map `watchedFiles`. Precisa ser idêntica tanto na
 * recepção da mensagem `watch` quanto no processamento do evento `change`.
 *
 * A chave é sempre em formato POSIX ("/") para que o mesmo card produza a mesma
 * chave no Windows (chokidar emite "\") e no Linux (chokidar emite "/").
 * NÃO usar esta forma para falar com o chokidar — veja toNativePath().
 */
function sanitizePath(partialPath) {
  return String(partialPath)
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim();
}

/**
 * Converte a chave canônica para o caminho real do sistema de arquivos, com o
 * separador nativo do SO. É esta forma que vai para watcher.add(): no Linux,
 * "public\local-events\a.csv" seria um nome de arquivo literal (com barras
 * invertidas no nome), e o watcher nunca dispararia.
 */
function toNativePath(sanitized) {
  return path.normalize(sanitized);
}

/**
 * Cria o servidor WebSocket e conecta o pipeline de file-watching.
 * Não lê configs nem inicia o HTTP — isso é responsabilidade de server.js.
 * Espelha o padrão de createApp: factory injetável, testável sem efeitos globais.
 *
 * @param {object} config
 * @param {number}   config.port               - porta do WebSocket (0 = efêmera, útil em testes)
 * @param {object}   [config.watcher]          - instância chokidar (precisa de .add e .on('change'))
 * @param {Function} [config.isAuthEnabled]    - () => boolean  (default: auth desligada)
 * @param {Function} [config.validateSession]  - (token) => session|null
 * @param {boolean}  [config.verbose]
 * @param {object}   [config.WebSocketImpl]    - injeção da lib ws (default: require('ws'))
 * @returns {{ wss, clients, watchedFiles, broadcast, sanitizePath, getHealthInfo }}
 */
function createWebSocketServer(config = {}) {
  const WS              = config.WebSocketImpl || WebSocket;
  const isAuthEnabled   = config.isAuthEnabled   || (() => false);
  const validateSession = config.validateSession || (() => null);
  const verbose         = !!config.verbose;
  const watcher         = config.watcher;

  const wss          = new WS.Server({ port: config.port });
  const watchedFiles = new Map(); // sanitizedPath -> Set<cardId>
  const clients      = new Set();

  function broadcast(messageObj) {
    const message = JSON.stringify(messageObj);
    clients.forEach((ws) => {
      if (ws.readyState === WS.OPEN) {
        ws.send(message);
      }
    });
  }

  wss.on('connection', (ws, req) => {
    const urlObj = new URL(req.url, 'http://localhost');
    const token  = urlObj.searchParams.get('token') || '';

    // Rejeita se auth estiver configurada e o token for inválido
    if (isAuthEnabled() && !validateSession(token)) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    if (verbose) console.log('Cliente WebSocket conectado.');
    clients.add(ws);

    ws.on('message', (raw) => {
      try {
        const { type, filePath, cardId } = JSON.parse(raw);

        if (type === 'watch') {
          const sanitizedPath = sanitizePath(filePath);

          if (!watchedFiles.has(sanitizedPath)) {
            watchedFiles.set(sanitizedPath, new Set());
            if (watcher) watcher.add(toNativePath(sanitizedPath));
          }
          watchedFiles.get(sanitizedPath).add(cardId);
          if (verbose) console.log(`Monitorando: ${sanitizedPath} -> ${cardId}`);
        }
      } catch (err) {
        if (verbose) console.error('Erro ao processar mensagem WebSocket:', err.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (verbose) console.log('Cliente desconectado.');
    });
  });

  if (watcher) {
    // 'add' também notifica: scripts que gravam de forma atômica (tmp + rename,
    // comum ao escrever em pasta de rede) recriam o inode e o chokidar pode
    // emitir unlink+add em vez de change. Com ignoreInitial:true, um 'add' após
    // o registro sempre significa arquivo recriado.
    const onFsEvent = (event) => (changedPath) => {
      const sanitizedPath = sanitizePath(changedPath);
      if (verbose) console.log(`Alteração detectada (${event}) em: ${sanitizedPath}`);

      const cardIds = watchedFiles.get(sanitizedPath);
      if (cardIds) {
        cardIds.forEach((cardId) => broadcast({ type: 'update', cardId }));
      } else if (verbose) {
        console.log(`  (ignorado — nenhum card assinou "${sanitizedPath}")`);
      }
    };

    watcher.on('change', onFsEvent('change'));
    watcher.on('add', onFsEvent('add'));
  }

  function getHealthInfo() {
    const watched = {};
    watchedFiles.forEach((cardIds, filePath) => {
      watched[filePath] = Array.from(cardIds);
    });

    const addr = wss.address();
    return {
      websocket: {
        status: addr ? 'ok' : 'error',
        // porta realmente vinculada (em produção == config.port)
        port: addr ? addr.port : config.port,
        connectedClients: clients.size,
      },
      watchers: {
        totalFiles: watchedFiles.size,
        watched,
      },
    };
  }

  return { wss, clients, watchedFiles, broadcast, sanitizePath, getHealthInfo };
}

module.exports = { createWebSocketServer, sanitizePath, toNativePath };
