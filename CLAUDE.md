# CLAUDE.md — Painel de Monitoramento

## Project Overview

Self-hosted real-time security and infrastructure monitoring dashboard. Renders configurable card-based layouts (charts, event lists, uptime monitors, CVE reports, iframes) with multiple independent "views". Updates cards in real time via WebSocket when data files change on disk.

Local-first architecture: data produced externally by Python scripts (uptime, CVE, breach feeds) written to JSON/CSV files that the server watches and broadcasts.

---

## Repository Layout

```
├── server.js                    # Bootstrap: app.listen + WebSocket server
├── src/app.js                   # Express app factory (createApp) — all route logic lives here
├── server-config.json           # HTTP port, address, python command
├── version.json                 # Current version
├── release.py                   # Versioned .zip build
├── jest.setup.js                # Silences logs during tests
│
├── tests/
│   ├── app.smoke.test.js              # App creation and SPA fallback
│   ├── api.layout.test.js             # GET /api/layout/:viewName
│   ├── api.layout.save.test.js        # POST /api/layout/:viewName
│   ├── api.meta.test.js               # GET /api/views, /api/cards, /version
│   ├── api.csv.test.js                # GET /api/partial-csv, GET /api/csv-count
│   ├── api.fileinfo.test.js           # GET /api/file-info
│   ├── api.chartdata.test.js          # POST /api/chart-data
│   ├── api.views.manage.test.js       # POST /api/views, DELETE /api/views
│   ├── api.logs.test.js               # GET /api/logs, GET /api/logs/:filename
│   ├── api.uptime.test.js             # GET/POST /api/uptime-config
│   ├── api.cve.assessment.test.js     # POST /api/cve-assessment
│   ├── api.cards.manage.test.js       # POST /api/cards, DELETE /api/cards/:cardId
│   ├── api.health.test.js            # GET /api/health
│   ├── api.backup.test.js            # GET /api/backup
│   └── frontend/
│       ├── load-script.js             # Helper: loads vanilla JS into Jest global scope
│       ├── helpers.test.js            # csvToJson, parseCSVLine
│       ├── main.test.js               # createCardElement, getLayoutConfig, adjustFrameZoom, loadCardsContent dispatch
│       ├── cardcontent-cve.test.js    # CVE assets toggle, assessment panel, dropdowns
│       ├── cardcontent-metric.test.js # loadCardContentMetric — all source types, subscriptions
│       ├── cardcontent-dynamic-list.test.js # footer with the source file's last-modified date
│       ├── cardeditor.test.js         # updateSourceRowVisibility, openMetricEditor
│       ├── uptimeeditor.test.js       # custom dropdown (open/close/select), modal lifecycle
│       └── healthcheck.test.js        # Health check modal open/close/render
│
├── public/
│   ├── index.html               # SPA shell — scripts loaded in strict order
│   ├── favicon.svg              # Four-square icon (accent #cc785c)
│   ├── websocket-config.json    # WebSocket host/port for the frontend
│   ├── css/
│   │   ├── main.css             # Design tokens (:root), reset, grid, cards, `.card-footer`, modal base, buttons, resize
│   │   ├── drawer.css           # Floating side drawer menu
│   │   ├── event-list.css       # List card
│   │   ├── frame-card.css       # iframe card + zoom
│   │   ├── highlight.css        # Update pulse animation
│   │   ├── uptime-card.css      # Uptime card
│   │   ├── cve-assets.css       # CVE assets board
│   │   ├── dynamic-list.css    # Dynamic list card
│   │   ├── metric-card.css     # Metric KPI card
│   │   ├── modal-addcard.css    # Add card modal
│   │   ├── modal-views.css      # Manage views modal
│   │   ├── modal-cardeditor.css # Card editor modal
│   │   ├── modal-logviewer.css  # Log viewer modal
│   │   ├── modal-uptime.css     # Uptime editor modal
│   │   └── modal-health.css     # Health check modal
│   └── js/
│       ├── consts.js            # DOM references and shared state
│       ├── drawer.js            # Drawer toggle, localStorage, version
│       ├── main.js              # Core: layout, card creation, view management, content dispatch
│       ├── cardcontent-chart.js # Chart card content loader (Chart.js)
│       ├── cardcontent-list.js  # List card content loader (CSV events)
│       ├── cardcontent-uptime.js # Uptime card content loader
│       ├── cardcontent-cve.js   # CVE assets content loader + assessment dropdown
│       ├── cardcontent-dynamic-list.js # Dynamic list content loader (custom separator/fields)
│       ├── cardcontent-metric.js # Metric card content loader (KPI aggregation)
│       ├── eventListeners.js    # DOM event wiring, interaction init
│       ├── carddrag.js          # Drag-and-drop card reordering
│       ├── resizecards.js       # Mouse-resize card spans
│       ├── cardsettings.js      # Settings modal (title, cols, rows, removal)
│       ├── addcards.js          # Add card modal
│       ├── socketListeners.js   # WebSocket connection and file subscriptions
│       ├── helpers.js           # CSV parsing (semicolon-delimited)
│       ├── view-selector.js     # Custom dropdown synced to hidden <select>
│       ├── cardeditor.js        # Card definitions editor modal (CRUD on cards-list.json)
│       ├── manageviews.js       # Create/delete views modal
│       ├── logviewer.js         # Log viewer modal
│       ├── uptimeeditor.js      # Uptime config editor modal
│       ├── healthcheck.js       # Health check modal (server, WebSocket, watchers)
│       └── backup.js            # Backup download trigger
│
├── cards/
│   ├── cards-list.json          # Master card registry (gitignored, per-instance)
│   ├── cards-examples.json      # Reference card definitions
│   └── card.schema.json         # JSON Schema for card structure
│
├── configs/                     # Gitignored — created per deployment
│   ├── views.json               # List of views (value + title)
│   └── layout.config-{view}.json  # One layout file per view
│
├── scripts/
│   ├── check_status.py          # Async uptime checker (asyncio/aiohttp)
│   ├── count_events_by_weekday.py  # Aggregates CSV into weekday counts
│   ├── cache/                   # External API cache (NVD, Vulners)
│   └── logs/                    # Execution logs (.log)
│
└── public/local-*/              # Runtime data (gitignored)
    ├── local-events/            # Event CSVs and CVE report JSON
    ├── local-data-uptimes/      # Uptime results
    ├── local-data-charts/       # Pre-computed chart data
    └── local-pages/             # Embedded HTML pages (e.g. SSLabs)
```

> `public/local-*/`, `configs/`, and `cards/cards-list.json` are gitignored (instance-specific data).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| HTTP server | Express 4.x |
| Real-time | WebSocket (`ws` 8.x) |
| File watching | Chokidar 4.x |
| Frontend | Vanilla JS (ES6+), no framework/bundler |
| Charts | Chart.js (CDN) |
| Data scripts | Python 3 (`asyncio`, `aiohttp`) |
| Tests | Jest 29.x + Supertest 7.x |

---

## Architecture

### Server

- **`server.js` is bootstrap only** — reads configs, calls `createApp()`, starts `app.listen` + WebSocket. Zero route logic.
- **`src/app.js` is the app factory** — exports `createApp({ rootDir, PYTHON_CMD, spawn })`. Does not call `app.listen`. Tests import the app without a real server.
- WebSocket runs on a **separate port** (default `8123`) from HTTP (default `3123`).
- Layout configs are flat JSON arrays (`layout.config-{view}.json`). Frontend is authoritative; saving always POSTs the full layout.

### WebSocket

- `watchedFiles`: `Map<sanitizedPath, Set<cardId>>` — `Set` prevents duplicates.
- `sanitizePath()` must be applied both when receiving client `watch` messages and when processing Chokidar `change` events — ensures identical Map keys.
- Chokidar started with `{ ignoreInitial: true }`.

### Frontend

- Single HTML page SPA. Scripts loaded via `<script>` tags in strict dependency order.
- Cards rendered from merge: layout config (order, spans, title, zoom) over card definition (type, data, source paths).
- Content loading is **type-dispatched** in `loadCardsContent()` — one function per `cardType`.
- View selector: `<select id="view-selector">` is the source of truth; `view-selector.js` syncs a custom dropdown via `MutationObserver`.

### Data Flow

```
Python script → writes file (CSV/JSON)
  → Chokidar detects change
    → WebSocket broadcast { type: "update", cardId }
      → Browser reloads card content
```

---

## Card Types

| `cardType` | Renderer | Data source |
|---|---|---|
| `chart` | Chart.js canvas | Inline JSON or Python via `/api/chart-data` |
| `list` | `<ul>` event list | CSV via `/api/partial-csv` |
| `uptime` | Status list + footer "Última verificação" | JSON (direct fetch from `public/`), date from `lastChecked` |
| `cve-assets` | Collapsible table + footer "Última varredura" | JSON (direct fetch from `public/`), date from `last_scan` |
| `dynamic-list` | Configurable `<ul>` list + footer with the source file's last-modified date | CSV via `/api/partial-csv` (custom separator), mtime via `/api/file-info` |
| `metric` | KPI numeric counter | Aggregated from source card files |
| `frame` | `<iframe>` with zoom | URL or local HTML |

Card definitions live in `cards/cards-list.json`, schema in `card.schema.json`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/views` | View list (`configs/views.json`) |
| `POST` | `/api/views` | Create view (generates slug, creates empty layout) |
| `DELETE` | `/api/views/:viewName` | Remove view and delete layout file |
| `GET` | `/api/cards` | Card registry (`cards-list.json`) |
| `POST` | `/api/cards` | Save full card registry (validates IDs and cardTypes) |
| `DELETE` | `/api/cards/:cardId` | Remove a card by ID from the registry |
| `GET` | `/api/layout/:viewName` | View layout (empty array if not found) |
| `POST` | `/api/layout/:viewName` | Save full view layout |
| `GET` | `/api/partial-csv?file=&limit=N` | Last N lines of CSV (preserves header) |
| `GET` | `/api/csv-count?file=` | Total data row count in a CSV (excl. header and blank lines) |
| `GET` | `/api/file-info?file=` | File metadata — `{ mtime (ISO 8601 UTC), size }` via `fs.promises.stat` (works on Windows and Linux) |
| `GET` | `/api/logs` | List `.log` files in `scripts/logs/` |
| `GET` | `/api/logs/:filename` | Log file content (validates path traversal) |
| `GET` | `/api/uptime-config?file=` | Uptime config JSON (validates path traversal) |
| `POST` | `/api/uptime-config?file=` | Save uptime config with **smart merge** (preserves `status`, `lastStatusOnline`, `lastStatusOffline` from existing services matched by URL) |
| `POST` | `/api/cve-assessment?file=` | Update CVE assessment field (matches by reportItem + CVE ID) |
| `POST` | `/api/chart-data` | Spawn Python script, return JSON stdout |
| `GET` | `/api/health` | Server status, uptime, WebSocket info, active watchers |
| `GET` | `/api/backup` | Generate and download zip with configs, cards-list, local-* data |
| `GET` | `/version` | Returns `version.json` |
| `GET` | `/:view?` | SPA fallback → `index.html` |

---

## Coding Conventions

### JavaScript

- **No framework, no build step.** ES6+ with `async/await`. Scripts via `<script>` tags.
- **DOM queries centralized in `consts.js`**. Exception: optional IIFEs use **lazy DOM resolution** (see below).
- **Lazy DOM resolution in IIFEs** — `getElementById` inside functions, never at the top. Only check at the top: the anchor element (e.g. root modal). If `null`, return immediately. Prevents `TypeError` when elements don't exist.
- **Functions are globally scoped** — no module system. Avoid naming collisions.
- **`createCardElement(config)` is pure** — returns a DOM node with no side effects. Content loading is separate via `loadCardsContent()`.
- **`saveLayoutConfig()` is fire-and-forget** — always POSTs the full DOM state. Never patch individual fields.
- **Expand/collapse via `.expanded` class** + CSS `max-height` transitions. Exception: elements using `display: none/block` directly via JS — in that case avoid `overflow: hidden` on the parent.
- **Dependency injection** — `child_process.spawn` passed via `createApp({ spawn })`, not imported via destructuring at the top.
- **Duplicate slugify** — the same function exists in `app.js` (backend) and `manageviews.js` (frontend). Keep them consistent.

#### Custom dropdown (combobox) pattern

**Never use a native `<select>` element.** All dropdowns must follow the custom pattern for visual consistency.
The `dropdown-in` keyframe is defined in `drawer.css` and is globally available.

### Python

- Scripts run standalone or spawned by the server. Chart scripts print JSON: `{ "labels": [...], "data": [...] }`.
- `check_status.py` uses `asyncio`/`aiohttp` — do not convert to synchronous.
- Cache in `scripts/cache/` for external APIs.

### CSS

- **BEM-style** for card components: `.asset-card`, `.asset-row`, `.asset-collapsible`.
- Each card type has its own CSS file under `public/css/`. Do not add cross-card styles to a card-specific file.
- **Design tokens** in `:root` (`main.css`) — always use variables, never hardcoded hex:

  | Token | Value | Usage |
  |---|---|---|
  | `--app-bg` | `#1c1c28` | Page background |
  | `--surface-bg` | `#252535` | Modals and dropdowns |
  | `--card-bg` | `#2b2b3d` | Card background |
  | `--border-subtle` | `rgba(255,255,255,0.07)` | Card borders |
  | `--border-mid` | `rgba(255,255,255,0.11)` | Input/modal borders |
  | `--text` | `#c8c8d4` | Default text |
  | `--text-muted` | `#6b6b80` | Labels, metadata |
  | `--text-bright` | `#f0f0f5` | Headings |
  | `--accent` | `#cc785c` | Highlight (buttons, logo icon) |
  | `--ease-std` | `cubic-bezier(0.4,0,0.2,1)` | Standard easing |
  | `--radius-sm/md/lg` | `6px / 8px / 12px` | Border-radius |

- **Font:** `'Segoe UI', system-ui, -apple-system, sans-serif` (not `Arial`).
- **Scrollbars:** `3px` width, thumb `rgba(255,255,255,0.12)`, radius `2px`.
- **Card footers** (`dynamic-list`, `uptime`, `cve-assets`): the shared `.card-footer` class in `main.css` owns the look (right-aligned, monospace, `--text-muted`, top border, `flex: 0 0 auto`). Card-specific classes (`.dynamic-list-footer`, `.uptime-footer`, `.asset-footer`) are JS/structural hooks only — do not restyle them per card. To keep the footer out of the scroll area, the card wrapper is `display: flex; flex-direction: column` and only the list region gets `flex: 1 1 auto; min-height: 0; overflow-y: auto`.
- **Collapsibles:** padding on inner children, never on the element with `max-height: 0`.
- **`overflow: hidden`** only on containers with `max-height` transition, never on parents with children toggled via `display: block`.

---

## Testing

### Mock Rules

- **`fs`** — never mock the entire module. Use a factory with `jest.requireActual`:
  ```js
  jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(),
    readFile:   jest.fn(),
    readdir:    jest.fn(),
    writeFile:  jest.fn(),
    unlink:     jest.fn(),
    createReadStream: jest.fn(),
  }));
  ```
- **`child_process.spawn`** — do not mock the module. Inject via `createApp({ spawn: jest.fn() })`.
- **Fake Python processes** — use plain `EventEmitter` for `stdout`/`stderr`, never `Readable` streams. Use `mockImplementation(() => makeFakePython(...))`, never `mockReturnValue` (executes the factory before listeners are attached).

### Front-end Tests

- Environment: `@jest-environment jsdom` docblock per file (backend tests stay `node`).
- **Loading scripts**: use `tests/frontend/load-script.js` helper — reads a vanilla JS file, extracts `function` declarations, and assigns them to `globalThis`.
- Set up globals from `consts.js` (e.g. `grid`, `viewSelector`, `chartInstances`) manually in `beforeAll`.
- `jsdom` does not support `innerText` — use `textContent` in assertions.
