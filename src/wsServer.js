'use strict';

const WebSocket = require('ws');
const { URL }   = require('url');

/**
 * Normaliza um caminho parcial recebido do cliente (ou do chokidar) para a
 * forma usada como chave no Map `watchedFiles`. Precisa ser idêntica tanto na
 * recepção da mensagem `watch` quanto no processamento do evento `change`.
 */
function sanitizePath(partialPath) {
  let p = partialPath.replace(/\/\//g, '/');
  p = p.replace(/\//g, '\\');
  return p;
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
            if (watcher) watcher.add(sanitizedPath);
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
    watcher.on('change', (changedPath) => {
      const sanitizedPath = sanitizePath(changedPath);
      if (verbose) console.log(`Alteração detectada em: ${sanitizedPath}`);

      const cardIds = watchedFiles.get(sanitizedPath);
      if (cardIds) {
        cardIds.forEach((cardId) => broadcast({ type: 'update', cardId }));
      }
    });
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

module.exports = { createWebSocketServer, sanitizePath };
