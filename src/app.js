'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const rateLimit = require('express-rate-limit');
const { verifyPassword, createSession, validateSession, destroySession, loadSessions, exportSessions } = require('./auth');

/**
 * Cria e retorna a aplicação Express configurada.
 * Não chama app.listen — isso é responsabilidade de server.js.
 *
 * @param {object} config
 * @param {string}   config.rootDir    - __dirname do projeto raiz
 * @param {string}   config.PYTHON_CMD - executável python (ex: "python3")
 * @param {Function} config.spawn      - child_process.spawn (injetável para testes)
 * @param {object}   [config.writeRateLimit] - { windowMs, limit } das rotas de gravação (padrão: 120 req/min por IP)
 * @param {object}   [config.readRateLimit]  - { windowMs, limit } das rotas de dados de cards (padrão: 600 req/min por IP)
 * @param {number}   [config.chartScriptTimeoutMs] - tempo máximo de execução de um script de gráfico (padrão: 30000)
 */
function createApp(config = {}) {
  const rootDir    = config.rootDir    || path.resolve(__dirname, '..');
  const PYTHON_CMD = config.PYTHON_CMD || 'python';
  // Injeção de dependência: permite substituir em testes sem jest.mock()
  const spawnFn    = config.spawn      || require('child_process').spawn;
  const writeRateLimit = Object.assign({ windowMs: 60 * 1000, limit: 120 }, config.writeRateLimit);
  const readRateLimit  = Object.assign({ windowMs: 60 * 1000, limit: 600 }, config.readRateLimit);
  const chartScriptTimeoutMs = config.chartScriptTimeoutMs || 30 * 1000;

  const CONFIGS_PATH   = path.join(rootDir, 'configs');
  const VIEWS_PATH     = path.join(CONFIGS_PATH, 'views.json');
  const CARDS_PATH     = path.join(rootDir, 'cards', 'cards-list.json');
  const USERS_PATH     = path.join(CONFIGS_PATH, 'users.json');
  const SESSIONS_PATH  = path.join(CONFIGS_PATH, 'sessions.json');

  // Load persisted sessions on startup
  try {
    const raw = fs.readFileSync(SESSIONS_PATH, 'utf8');
    loadSessions(JSON.parse(raw));
  } catch { /* file absent or corrupt — start with empty sessions */ }

  function persistSessions() {
    const data = JSON.stringify(exportSessions(), null, 2);
    fs.writeFile(SESSIONS_PATH, data, 'utf8', () => {});
  }

  const app = express();

  // Block direct static access to /logs/* — content is only available via /api/logs (authenticated)
  app.use('/logs', (req, res) => res.status(403).end());

  // Runtime data (public/local-*/ and rootDir/local-pages) requires login when auth is enabled.
  // Accepts the Bearer header (fetch) or the HttpOnly session cookie (iframes, links).
  app.use((req, res, next) => {
    if (!isProtectedStaticPath(req.path)) return next();
    if (!isAuthEnabled()) return next();
    if (validateSession(getToken(req) || getCookieToken(req))) return next();
    return res.status(401).json({ error: 'Não autorizado.' });
  });

  app.use(express.static(path.join(rootDir, 'public')));
  app.use(express.json());
  app.use('/local-pages', express.static(path.join(rootDir, 'local-pages')));

  // ------------------------------------------------------------------ auth helpers

  function readUsers() {
    try {
      if (!fs.existsSync(USERS_PATH)) return [];
      return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    } catch {
      return [];
    }
  }

  function isAuthEnabled() {
    const users = readUsers();
    return Array.isArray(users) && users.length > 0;
  }

  function getToken(req) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return null;
  }

  // Session cookie — mirrors the Bearer token so iframes/links can load protected
  // static data. Accepted ONLY by the static data guard, never by /api (no CSRF surface).
  const SESSION_COOKIE = 'painel_session';

  function getCookieToken(req) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === SESSION_COOKIE) {
        try { return decodeURIComponent(part.slice(idx + 1).trim()) || null; } catch { return null; }
      }
    }
    return null;
  }

  function setSessionCookie(req, res, token) {
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
  }

  function clearSessionCookie(req, res) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
  }

  /**
   * True when a static URL points inside a runtime data folder (local-*).
   * Decodes and normalizes like serve-static would, so "%6Cocal-events",
   * "/./local-events", "//local-events" or "LOCAL-EVENTS" (case-insensitive
   * filesystems) cannot bypass it. A bare "/local-x" (no trailing slash) is
   * left alone: it is either a view route or a directory redirect.
   */
  function isProtectedStaticPath(urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath); } catch { return true; }
    const normalized = path.posix.normalize('/' + decoded.replace(/\\/g, '/'));
    const segments   = normalized.split('/').filter(Boolean);
    if (!segments.length || !segments[0].toLowerCase().startsWith('local-')) return false;
    return segments.length > 1 || normalized.endsWith('/');
  }

  /**
   * Resolves a ?file= parameter for the data APIs (partial-csv, csv-count, file-info).
   * Only files inside the public/local-* folders are allowed — blocks configs/, sessions,
   * absolute paths, "../" and symlinks/junctions that escape the folder.
   * Outside paths always get 403 (checked lexically first → no existence oracle).
   * @returns {Promise<{path: string}|{status: number, error: string}>}
   */
  async function resolveDataFile(fileParam) {
    if (typeof fileParam !== 'string' || !fileParam) {
      return { status: 400, error: 'Parâmetro "file" é obrigatório.' };
    }
    const denied = { status: 403, error: 'Acesso negado: somente arquivos em public/local-*.' };
    if (fileParam.includes('\0')) return denied;

    const publicDir = path.resolve(rootDir, 'public');
    const candidate = path.resolve(rootDir, fileParam);
    if (!isInsideDataDir(candidate, publicDir)) return denied;

    let realFile;
    try { realFile = await fs.promises.realpath(candidate); } catch {
      return { status: 404, error: 'Arquivo não encontrado' };
    }
    let realPublic;
    try { realPublic = await fs.promises.realpath(publicDir); } catch { realPublic = publicDir; }
    if (!isInsideDataDir(realFile, realPublic)) return denied;

    return { path: realFile };
  }

  function isInsideDataDir(absPath, publicDir) {
    const rel = path.relative(publicDir, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    const parts = rel.split(path.sep);
    return parts.length > 1 && parts[0].toLowerCase().startsWith('local-');
  }

  /** True when absPath is a .py file inside scriptsDir (any depth). */
  function isInsideScriptsDir(absPath, scriptsDir) {
    const rel = path.relative(scriptsDir, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    return path.extname(absPath).toLowerCase() === '.py';
  }

  /**
   * True when some chart card in cards-list.json declares exactly this script
   * (in any dataset) together with this source file. The frontend sends the
   * card's own values, so legitimate charts always match; anything else is a
   * request to run something no editor configured.
   */
  async function isDeclaredChartScript(scriptAbs, sourceParam) {
    let cards;
    try {
      cards = JSON.parse(await fs.promises.readFile(CARDS_PATH, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
    if (!Array.isArray(cards)) return false;

    const sourceAbs = sourceParam ? path.resolve(rootDir, sourceParam) : null;
    return cards.some(card => {
      if (!card || card.cardType !== 'chart') return false;
      const datasets = card.chart && card.chart.data && card.chart.data.datasets;
      if (!Array.isArray(datasets)) return false;
      const declaresScript = datasets.some(d =>
        d && typeof d.script === 'string' && d.script && path.resolve(rootDir, d.script) === scriptAbs);
      if (!declaresScript) return false;
      const declaredSource = typeof card.sourceItems === 'string' && card.sourceItems ? card.sourceItems : null;
      if (!declaredSource || !sourceAbs) return !declaredSource && !sourceAbs;
      return path.resolve(rootDir, declaredSource) === sourceAbs;
    });
  }

  /**
   * Validates a POST /api/chart-data request before anything is spawned:
   *   1. scriptPath must be a .py inside scripts/ (lexical check → 403, no oracle)
   *   2. the script + sourceFile pair must be declared by a chart card (403)
   *   3. script realpath must still be inside scripts/ (symlinks/junctions → 403)
   *   4. sourceFile, when present, goes through resolveDataFile (public/local-* only)
   * @returns {Promise<{args: string[]}|{status: number, error: string}>}
   */
  async function resolveChartScript(scriptParam, sourceParam) {
    if (typeof scriptParam !== 'string' || !scriptParam) {
      return { status: 400, error: 'Parâmetro "scriptPath" é obrigatório.' };
    }
    const hasSource = sourceParam !== undefined && sourceParam !== null && sourceParam !== '';
    if (hasSource && typeof sourceParam !== 'string') {
      return { status: 400, error: 'Parâmetro "sourceFile" inválido.' };
    }

    const denied = { status: 403, error: 'Acesso negado: somente scripts .py em scripts/.' };
    if (scriptParam.includes('\0')) return denied;

    const scriptsDir = path.resolve(rootDir, 'scripts');
    const candidate  = path.resolve(rootDir, scriptParam);
    if (!isInsideScriptsDir(candidate, scriptsDir)) return denied;

    if (!(await isDeclaredChartScript(candidate, hasSource ? sourceParam : null))) {
      return { status: 403, error: 'Acesso negado: script não declarado em nenhum card de gráfico.' };
    }

    let realScript;
    try { realScript = await fs.promises.realpath(candidate); } catch {
      return { status: 404, error: 'Script não encontrado' };
    }
    let realScriptsDir;
    try { realScriptsDir = await fs.promises.realpath(scriptsDir); } catch { realScriptsDir = scriptsDir; }
    if (!isInsideScriptsDir(realScript, realScriptsDir)) return denied;

    const args = [realScript];
    if (hasSource) {
      const source = await resolveDataFile(sourceParam);
      if (source.status) return source;
      args.push(source.path);
    }
    return { args };
  }

  function requireAuth(req, res, next) {
    const token   = getToken(req);
    const session = validateSession(token);
    if (!session) return res.status(401).json({ error: 'Não autorizado.' });
    req.session = session;
    next();
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (!req.session) return next(); // auth bypassed (no users configured)
      if (role === 'editor' && req.session.role !== 'editor') {
        return res.status(403).json({ error: 'Permissão insuficiente.' });
      }
      next();
    };
  }

  // Rate limiting — IP → { count, windowStart }
  const loginAttempts = new Map();
  const MAX_ATTEMPTS  = 5;
  const WINDOW_MS     = 15 * 60 * 1000;

  // Rate limiting das rotas de gravação (POST/DELETE de configuração + backup).
  // Só nas rotas de escrita: leituras de cards e WebSocket ficam livres
  // para não afetar painéis abertos o dia todo. Limite folgado porque, conforme a
  // rede (ex.: Docker), vários usuários podem chegar com o mesmo IP.
  const writeLimiter = rateLimit({
    windowMs: writeRateLimit.windowMs,
    limit:    writeRateLimit.limit,
    standardHeaders: 'draft-7',
    legacyHeaders:   false,
    message: { error: 'Muitas requisições. Aguarde um instante e tente novamente.' },
  });

  // Rate limiting das rotas que leem arquivos de dados dos cards (partial-csv,
  // csv-count, file-info) e de chart-data. Separado e bem mais folgado que o de
  // gravação: o painel chama essas rotas a cada carga e a cada atualização via
  // WebSocket, mas partial-csv/csv-count leem o CSV inteiro a cada chamada e
  // chart-data cria um processo Python por chamada.
  const readLimiter = rateLimit({
    windowMs: readRateLimit.windowMs,
    limit:    readRateLimit.limit,
    standardHeaders: 'draft-7',
    legacyHeaders:   false,
    message: { error: 'Muitas requisições. Aguarde um instante e tente novamente.' },
  });

  // ------------------------------------------------------------------ GET /ping (unprotected)
  app.get('/ping', (req, res) => {
    res.json({ status: 'ok' });
  });

  // ------------------------------------------------------------------ GET /api/auth/status
  app.get('/api/auth/status', (req, res) => {
    res.json({ authEnabled: isAuthEnabled() });
  });

  // ------------------------------------------------------------------ POST /api/auth/login
  app.post('/api/auth/login', async (req, res) => {
    const ip  = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();

    const attempts = loginAttempts.get(ip);
    if (attempts) {
      if (now - attempts.windowStart < WINDOW_MS) {
        if (attempts.count >= MAX_ATTEMPTS) {
          const remaining = Math.ceil((WINDOW_MS - (now - attempts.windowStart)) / 60000);
          return res.status(429).json({ error: `Muitas tentativas. Tente novamente em ${remaining} minuto(s).` });
        }
      } else {
        loginAttempts.delete(ip);
      }
    }

    const { username, password } = req.body || {};
    const users = readUsers();
    const user  = users.find(u => u.username === username);

    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      const cur = loginAttempts.get(ip);
      if (cur) {
        cur.count += 1;
      } else {
        loginAttempts.set(ip, { count: 1, windowStart: now });
      }
      await new Promise(r => setTimeout(r, 200));
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = createSession(user.username, user.role);
    persistSessions();
    setSessionCookie(req, res, token);
    res.json({ token, role: user.role, name: user.name });
  });

  // ------------------------------------------------------------------ POST /api/auth/logout
  app.post('/api/auth/logout', (req, res) => {
    const token = getToken(req);
    if (token) { destroySession(token); persistSessions(); }
    clearSessionCookie(req, res);
    res.sendStatus(200);
  });

  // ------------------------------------------------------------------ GET /api/auth/me
  app.get('/api/auth/me', (req, res) => {
    if (!isAuthEnabled()) {
      return res.json({ username: 'admin', role: 'editor', name: 'Admin' });
    }
    const token   = getToken(req);
    const session = validateSession(token);
    if (!session) {
      clearSessionCookie(req, res);
      return res.status(401).json({ error: 'Não autorizado.' });
    }
    // Refreshes the cookie on every SPA load (covers sessions created before the cookie existed)
    setSessionCookie(req, res, token);
    const users = readUsers();
    const user  = users.find(u => u.username === session.username);
    res.json({ username: session.username, role: session.role, name: user ? user.name : session.username });
  });

  // ------------------------------------------------------------------ Global auth middleware for /api/*
  // Bypassed automatically when no users are configured (backward compatible with tests)
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    if (!isAuthEnabled()) return next();
    requireAuth(req, res, next);
  });

  // ------------------------------------------------------------------ helpers
  function layoutPath(viewName) {
    return path.join(CONFIGS_PATH, `layout.config-${viewName}.json`);
  }

  /**
   * Converte um título livre num slug seguro para nome de arquivo.
   * Ex: "Minha Visão"  →  "minha-visao"
   */
  function slugify(str) {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // remove diacríticos
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')      // remove caracteres especiais
      .replace(/\s+/g, '-')              // espaços → hífens
      .replace(/-+/g, '-')              // hífens múltiplos → um
      .replace(/^-|-$/g, '');            // remove hífen nas bordas (já colapsados acima; sem quantificador → sem ReDoS)
  }

  // ------------------------------------------------------------------ GET /api/layout/:viewName
  app.get('/api/layout/:viewName', (req, res) => {
    const viewPath = layoutPath(req.params.viewName);

    if (!fs.existsSync(viewPath)) {
      return res.json([]);
    }

    fs.readFile(viewPath, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: `Erro ao ler configuração para visão "${req.params.viewName}"` });
      }
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(500).json({ error: `Erro ao interpretar configuração para visão "${req.params.viewName}"` });
      }
    });
  });

  // ------------------------------------------------------------------ POST /api/layout/:viewName
  app.post('/api/layout/:viewName', writeLimiter, requireRole('editor'), (req, res) => {
    const viewPath = layoutPath(req.params.viewName);

    fs.writeFile(viewPath, JSON.stringify(req.body, null, 2), 'utf8', (err) => {
      if (err) {
        return res.status(500).send('Erro ao salvar configuração');
      }
      res.sendStatus(200);
    });
  });

  // ------------------------------------------------------------------ GET /api/views
  app.get('/api/views', (req, res) => {
    fs.readFile(VIEWS_PATH, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') return res.json([]);
        return res.status(500).json({ error: 'Erro ao ler visões' });
      }
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(500).json({ error: 'Erro ao interpretar visões' });
      }
    });
  });

  // ------------------------------------------------------------------ POST /api/views
  app.post('/api/views', writeLimiter, requireRole('editor'), (req, res) => {
    const { title } = req.body;

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'O campo "title" é obrigatório.' });
    }

    const value = slugify(title.trim());

    if (!value) {
      return res.status(400).json({ error: 'Título inválido: não gerou um identificador válido.' });
    }

    fs.readFile(VIEWS_PATH, 'utf8', (err, data) => {
      let views;
      if (err) {
        if (err.code !== 'ENOENT') return res.status(500).json({ error: 'Erro ao ler visões' });
        views = [];
      } else {
        try {
          views = JSON.parse(data);
        } catch {
          return res.status(500).json({ error: 'Erro ao interpretar visões' });
        }
      }

      if (views.some(v => v.value === value)) {
        return res.status(409).json({ error: `Já existe uma visão com o identificador "${value}".` });
      }

      const newView = { value, title: title.trim() };
      views.push(newView);

      fs.writeFile(VIEWS_PATH, JSON.stringify(views, null, 2), 'utf8', (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: 'Erro ao salvar visões' });
        }

        // Cria o arquivo de layout vazio para a nova visão
        const lPath = layoutPath(value);
        fs.writeFile(lPath, '[]', 'utf8', (layoutErr) => {
          if (layoutErr) {
            return res.status(500).json({ error: 'Visão criada, mas erro ao inicializar o layout.' });
          }
          res.status(201).json(newView);
        });
      });
    });
  });

  // ------------------------------------------------------------------ DELETE /api/views/:viewName
  app.delete('/api/views/:viewName', writeLimiter, requireRole('editor'), (req, res) => {
    const { viewName } = req.params;

    fs.readFile(VIEWS_PATH, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao ler visões' });
      }

      let views;
      try {
        views = JSON.parse(data);
      } catch {
        return res.status(500).json({ error: 'Erro ao interpretar visões' });
      }

      if (!views.some(v => v.value === viewName)) {
        return res.status(404).json({ error: `Visão "${viewName}" não encontrada.` });
      }

      const updated = views.filter(v => v.value !== viewName);

      fs.writeFile(VIEWS_PATH, JSON.stringify(updated, null, 2), 'utf8', (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: 'Erro ao salvar visões' });
        }

        // Remove o arquivo de layout se existir (falha silenciosa — não impede o sucesso)
        const lPath = layoutPath(viewName);
        if (fs.existsSync(lPath)) {
          fs.unlink(lPath, () => {});
        }

        res.sendStatus(200);
      });
    });
  });

  // ------------------------------------------------------------------ GET /api/cards
  app.get('/api/cards', (req, res) => {
    fs.readFile(CARDS_PATH, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao ler os cards' });
      }
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(500).json({ error: 'Erro ao interpretar os cards' });
      }
    });
  });

  // ------------------------------------------------------------------ POST /api/cards
  app.post('/api/cards', writeLimiter, requireRole('editor'), (req, res) => {
    const cards = req.body;

    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'O body deve ser um array de cards.' });
    }

    const ids = cards.map(c => c.id).filter(Boolean);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      return res.status(400).json({ error: 'IDs de cards duplicados.' });
    }

    for (const card of cards) {
      if (!card.id || !card.id.trim()) {
        return res.status(400).json({ error: 'Todo card deve ter um "id".' });
      }
      if (!card.cardType || !card.cardType.trim()) {
        return res.status(400).json({ error: `Card "${card.id}" deve ter um "cardType".` });
      }
    }

    fs.writeFile(CARDS_PATH, JSON.stringify(cards, null, 2), 'utf8', (err) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao salvar os cards.' });
      }
      res.sendStatus(200);
    });
  });

  // ------------------------------------------------------------------ DELETE /api/cards/:cardId
  app.delete('/api/cards/:cardId', writeLimiter, requireRole('editor'), (req, res) => {
    const cardId = req.params.cardId;

    fs.readFile(CARDS_PATH, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao ler os cards.' });
      }

      let cards;
      try {
        cards = JSON.parse(data);
      } catch {
        return res.status(500).json({ error: 'Erro ao interpretar os cards.' });
      }

      const index = cards.findIndex(c => c.id === cardId);
      if (index === -1) {
        return res.status(404).json({ error: `Card "${cardId}" não encontrado.` });
      }

      cards.splice(index, 1);

      fs.writeFile(CARDS_PATH, JSON.stringify(cards, null, 2), 'utf8', (writeErr) => {
        if (writeErr) {
          return res.status(500).json({ error: 'Erro ao salvar os cards.' });
        }
        res.sendStatus(200);
      });
    });
  });

  // ------------------------------------------------------------------ GET /api/health
  app.get('/api/health', (req, res) => {
    const base = {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    if (typeof config.getHealthInfo === 'function') {
      Object.assign(base, config.getHealthInfo());
    }

    res.json(base);
  });

  // ------------------------------------------------------------------ GET /version
  app.get('/version', (req, res) => {
    const versionPath = path.join(rootDir, 'version.json');
    fs.readFile(versionPath, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao ler a versão' });
      }
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(500).json({ error: 'Erro ao interpretar a versão' });
      }
    });
  });

  // ------------------------------------------------------------------ GET /api/csv-count
  app.get('/api/csv-count', readLimiter, async (req, res) => {
    const resolved = await resolveDataFile(req.query.file);
    if (resolved.status) return res.status(resolved.status).json({ error: resolved.error });
    const filePath = resolved.path;

    try {
      let count = 0;
      let isHeader = true;
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream });

      for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        if (line.trim()) count++;
      }

      res.json({ count });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao processar CSV' });
    }
  });

  // ------------------------------------------------------------------ GET /api/file-info
  // Metadados do arquivo de origem (data de modificação) — usado no rodapé dos cards.
  // fs.stat entrega o mtime tanto em Windows quanto em Linux; a data é normalizada
  // em ISO 8601 (UTC) e formatada no fuso local pelo front-end.
  app.get('/api/file-info', readLimiter, async (req, res) => {
    const resolved = await resolveDataFile(req.query.file);
    if (resolved.status) return res.status(resolved.status).json({ error: resolved.error });
    const filePath = resolved.path;

    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    if (!stats.isFile()) {
      return res.status(400).json({ error: 'O caminho informado não é um arquivo.' });
    }

    res.json({
      mtime: stats.mtime.toISOString(),
      size: stats.size,
    });
  });

  // ------------------------------------------------------------------ GET /api/partial-csv
  app.get('/api/partial-csv', readLimiter, async (req, res) => {
    const limit    = parseInt(req.query.limit) || 10;
    const resolved = await resolveDataFile(req.query.file);
    if (resolved.status) return res.status(resolved.status).json({ error: resolved.error });
    const filePath = resolved.path;

    try {
      const lines = [];
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream });

      let headerLine = null;

      for await (const line of rl) {
        if (!headerLine) {
          headerLine = line;
          continue;
        }
        lines.push(line);
        if (lines.length > limit) lines.shift();
      }

      const finalCsv = [headerLine, ...lines].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.send(finalCsv);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao processar CSV' });
    }
  });

  // ------------------------------------------------------------------ POST /api/chart-data
  // Executa somente scripts .py de scripts/ declarados por um card de gráfico
  // (ver resolveChartScript). O stderr nunca volta ao cliente: um traceback do
  // Python mostra linhas do arquivo executado — fica só no log do servidor.
  const STDERR_LOG_LIMIT = 4000;

  app.post('/api/chart-data', readLimiter, async (req, res) => {
    const { scriptPath, sourceFile } = req.body || {};

    let resolved;
    try {
      resolved = await resolveChartScript(scriptPath, sourceFile);
    } catch (err) {
      console.error('[chart-data] erro ao validar o script:', err.message);
      return res.status(500).json({ error: 'Erro ao ler os cards' });
    }
    if (resolved.status) return res.status(resolved.status).json({ error: resolved.error });

    const scriptLabel = path.relative(rootDir, resolved.args[0]);
    let finished = false;
    let stdout = '';
    let stderr = '';

    const finish = (status, body) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      res.status(status).json(body);
    };

    let python;
    try {
      python = spawnFn(PYTHON_CMD, resolved.args);
    } catch (err) {
      console.error(`[chart-data] falha ao iniciar ${scriptLabel}:`, err.message);
      return res.status(500).json({ error: 'Não foi possível executar o script.' });
    }

    const timer = setTimeout(() => {
      console.error(`[chart-data] ${scriptLabel} excedeu ${chartScriptTimeoutMs} ms — processo encerrado`);
      try { python.kill(); } catch { /* processo já encerrado */ }
      finish(504, { error: 'Tempo limite excedido ao executar o script.' });
    }, chartScriptTimeoutMs);

    python.stdout.on('data', d => { stdout += d.toString(); });
    python.stderr.on('data', d => {
      if (stderr.length < STDERR_LOG_LIMIT) stderr += d.toString();
    });

    // Sem este listener, um PYTHON_CMD inexistente (ENOENT) derrubaria o servidor.
    python.on('error', (err) => {
      console.error(`[chart-data] falha ao executar ${scriptLabel}:`, err.message);
      finish(500, { error: 'Não foi possível executar o script.' });
    });

    python.on('close', (code) => {
      if (finished) return; // já respondido (tempo limite ou erro ao iniciar)
      if (code === 0) return finish(200, { output: stdout.trim() });
      console.error(`[chart-data] ${scriptLabel} terminou com código ${code}:`,
        stderr.trim().slice(0, STDERR_LOG_LIMIT));
      finish(500, { error: `Erro ao executar o script (code ${code})` });
    });
  });

  // ------------------------------------------------------------------ GET /api/logs
  app.get('/api/logs', (req, res) => {
    const logsDir = path.join(rootDir, 'public', 'logs');

    if (!fs.existsSync(logsDir)) {
      return res.json([]);
    }

    fs.readdir(logsDir, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao listar logs' });
      }
      const logs = files
        .filter(f => f.endsWith('.log'))
        .sort();
      res.json(logs);
    });
  });

  // ------------------------------------------------------------------ GET /api/logs/:filename
  app.get('/api/logs/:filename', (req, res) => {
    const { filename } = req.params;

    // Bloqueia traversal e garante somente .log
    if (filename.includes('..') || filename.includes('/') || !filename.endsWith('.log')) {
      return res.status(400).json({ error: 'Nome de arquivo inválido.' });
    }

    const filePath = path.join(rootDir, 'public', 'logs', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao ler arquivo de log.' });
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(data);
    });
  });

  // ------------------------------------------------------------------ GET /api/uptime-config
  app.get('/api/uptime-config', (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
      return res.status(400).json({ error: 'Parâmetro "file" é obrigatório.' });
    }

    const resolved = path.resolve(rootDir, filePath);
    const relative = path.relative(path.resolve(rootDir), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(400).json({ error: 'Caminho inválido.' });
    }

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    fs.readFile(resolved, 'utf8', (err, data) => {
      if (err) return res.status(500).json({ error: 'Erro ao ler arquivo.' });
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(500).json({ error: 'Arquivo JSON inválido.' });
      }
    });
  });

  // ------------------------------------------------------------------ POST /api/uptime-config
  app.post('/api/uptime-config', writeLimiter, requireRole('editor'), (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
      return res.status(400).json({ error: 'Parâmetro "file" é obrigatório.' });
    }

    const resolved = path.resolve(rootDir, filePath);
    const relative = path.relative(path.resolve(rootDir), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(400).json({ error: 'Caminho inválido.' });
    }

    const { servicesStatus, notificationHook } = req.body;
    if (!Array.isArray(servicesStatus)) {
      return res.status(400).json({ error: 'Campo "servicesStatus" deve ser um array.' });
    }

    // Preserva campos de sistema do arquivo atual (status, lastStatusOn/Offline, lastChecked)
    fs.readFile(resolved, 'utf8', (err, data) => {
      let current = {};
      if (!err) {
        try { current = JSON.parse(data); } catch { /* arquivo corrompido — sobrescreve */ }
      }

      const currentServices = current.servicesStatus || [];

      // Mescla: mantém campos de monitoramento existentes; substitui campos editáveis.
      // Usa 'service' (systemd) ou 'url' (http) como chave de correspondência.
      const merged = servicesStatus.map(incoming => {
        const existing = currentServices.find(s =>
          (incoming.service && s.service === incoming.service) ||
          (incoming.url && s.url === incoming.url)
        ) || {};
        return {
          ...incoming,
          notificationHookMode: incoming.notificationHookMode || 'when-offline',
          // campos gerenciados pelo script — valor do arquivo atual tem prioridade
          status:            existing.status            ?? incoming.status            ?? 'offline',
          lastStatusOnline:  existing.lastStatusOnline  ?? incoming.lastStatusOnline  ?? '',
          lastStatusOffline: existing.lastStatusOffline ?? incoming.lastStatusOffline ?? '',
        };
      });

      const updated = {
        ...current,
        notificationHook: notificationHook ?? (current.notificationHook || ''),
        lastChecked:      current.lastChecked || '',
        servicesStatus:   merged,
      };

      fs.writeFile(resolved, JSON.stringify(updated, null, 2), 'utf8', (writeErr) => {
        if (writeErr) return res.status(500).json({ error: 'Erro ao salvar arquivo.' });
        res.sendStatus(200);
      });
    });
  });

  // ------------------------------------------------------------------ POST /api/cve-assessment
  app.post('/api/cve-assessment', writeLimiter, requireRole('editor'), (req, res) => {
    const filePath = req.query.file;
    if (!filePath) {
      return res.status(400).json({ error: 'Parâmetro "file" é obrigatório.' });
    }

    const resolved = path.resolve(rootDir, filePath);
    const relative = path.relative(path.resolve(rootDir), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(400).json({ error: 'Caminho inválido.' });
    }

    const { reportItemId, cveId, assessment } = req.body;

    if (!reportItemId || !cveId) {
      return res.status(400).json({ error: 'Campos "reportItemId" e "cveId" são obrigatórios.' });
    }

    const validAssessments = ['Not Affected', 'Acknowledge/Mitigating', 'False Positive', 'Accepted Risk', ''];
    if (assessment === undefined || !validAssessments.includes(assessment)) {
      return res.status(400).json({ error: 'Valor de "assessment" inválido.' });
    }

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    fs.readFile(resolved, 'utf8', (err, data) => {
      if (err) return res.status(500).json({ error: 'Erro ao ler arquivo.' });

      let report;
      try {
        report = JSON.parse(data);
      } catch {
        return res.status(500).json({ error: 'Arquivo JSON inválido.' });
      }

      const reportItem = (report.report_items || []).find(item => item.id === reportItemId);
      if (!reportItem) {
        return res.status(404).json({ error: `Item "${reportItemId}" não encontrado.` });
      }

      const cve = (reportItem.cves || []).find(c => c.cve_id === cveId);
      if (!cve) {
        return res.status(404).json({ error: `CVE "${cveId}" não encontrado.` });
      }

      cve.assessment = assessment;

      fs.writeFile(resolved, JSON.stringify(report, null, 4), 'utf8', (writeErr) => {
        if (writeErr) return res.status(500).json({ error: 'Erro ao salvar arquivo.' });
        res.sendStatus(200);
      });
    });
  });

  // ------------------------------------------------------------------ GET /api/backup
  app.get('/api/backup', writeLimiter, requireRole('editor'), (req, res) => {
    const archiver = require('archiver');

    const BACKUP_DIRS = [
      { fsPath: path.join(rootDir, 'configs'),                  zipPrefix: 'configs' },
      { fsPath: path.join(rootDir, 'public', 'local-data-uptimes'), zipPrefix: 'public/local-data-uptimes' },
      { fsPath: path.join(rootDir, 'public', 'local-data-charts'), zipPrefix: 'public/local-data-charts' },
      { fsPath: path.join(rootDir, 'public', 'local-events'),    zipPrefix: 'public/local-events' },
      { fsPath: path.join(rootDir, 'public', 'local-pages'),     zipPrefix: 'public/local-pages' },
    ];

    const backupDir  = path.join(rootDir, '_backup');
    const backupPath = path.join(backupDir, 'backup.zip');

    const output = fs.createWriteStream(backupPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      res.download(backupPath, 'backup.zip');
    });

    archive.on('error', (err) => {
      res.status(500).json({ error: 'Erro ao gerar backup.' });
    });

    archive.pipe(output);

    // cards-list.json
    if (fs.existsSync(CARDS_PATH)) {
      archive.file(CARDS_PATH, { name: 'cards/cards-list.json' });
    }

    // Directories
    for (const dir of BACKUP_DIRS) {
      if (fs.existsSync(dir.fsPath)) {
        archive.directory(dir.fsPath, dir.zipPrefix);
      }
    }

    archive.finalize();
  });

  // ------------------------------------------------------------------ Login page
  app.get('/login', (req, res) => {
    res.sendFile(path.join(rootDir, 'public', 'login.html'));
  });

  // ------------------------------------------------------------------ SPA fallback
  app.get('/:view?', (req, res) => {
    res.sendFile(path.join(rootDir, 'public', 'index.html'));
  });

  return app;
}

module.exports = { createApp };