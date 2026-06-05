'use strict';

const fs   = require('fs');
const path = require('path');
const chokidar  = require('chokidar');

const { createApp }     = require('./src/app');
const { validateSession } = require('./src/auth');
const { createWebSocketServer } = require('./src/wsServer');

const VERBOSE = process.argv.includes('--verbose');

// ------------------------------------------------------------------ configs
const SERVERCONFIG_PATH = path.join(__dirname, 'server-config.json');
const WSCONFIG_PATH     = path.join(__dirname, 'public', 'websocket-config.json');

let serverConfig = {};
try {
  serverConfig = JSON.parse(fs.readFileSync(SERVERCONFIG_PATH, 'utf-8'));
} catch (err) {
  console.error(`Erro ao ler server-config.json: ${err.message}`);
  process.exit(1);
}

let wsConfig = {};
try {
  wsConfig = JSON.parse(fs.readFileSync(WSCONFIG_PATH, 'utf-8'));
} catch (err) {
  console.error(`Erro ao ler websocket-config.json: ${err.message}`);
  process.exit(1);
}

const PORT       = serverConfig.port       || 3123;
const ADDRESS    = serverConfig.address    || 'localhost';
const PYTHON_CMD = serverConfig.python_cmd || 'python';
const WSPORT     = wsConfig.port           || 8123;

console.log('Configurações carregadas:', { PORT, ADDRESS, PYTHON_CMD, WSPORT });

// ------------------------------------------------------------------ WebSocket
const watcher = chokidar.watch([], { ignoreInitial: true, usePolling: true, interval: 3000 });

// auth habilitada se houver usuários configurados (lido a cada conexão)
function isAuthEnabled() {
  try {
    const usersPath = path.join(__dirname, 'configs', 'users.json');
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    return Array.isArray(users) && users.length > 0;
  } catch { /* no users file — auth not configured */ }
  return false;
}

const { getHealthInfo } = createWebSocketServer({
  port: WSPORT,
  watcher,
  isAuthEnabled,
  validateSession,
  verbose: VERBOSE,
});

console.log(`WebSocket server escutando na porta ${WSPORT}`);

// ------------------------------------------------------------------ HTTP
const app = createApp({
  rootDir: __dirname,
  PYTHON_CMD,
  getHealthInfo,
});

app.listen(PORT, ADDRESS, () => {
  console.log(`Servidor rodando em http://${ADDRESS}:${PORT}`);
});