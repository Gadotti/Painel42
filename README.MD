# Painel42

Self-hosted, real-time security and infrastructure monitoring dashboard. Displays configurable cards organized in independent views. Data is produced externally (Python scripts or any tool) and written to JSON/CSV files; the server detects changes and pushes updates to cards via WebSocket automatically.

---

## Screenshots

Dashboard principal com cards de métricas KPI, board de CVEs por ativo, monitoramento de uptime, listas de eventos (breaches), e múltiplos gráficos de atividade — tudo atualizado em tempo real via WebSocket.

![Dashboard](imgs/dashboard.PNG)

Modal de edição do monitoramento de serviços, onde é possível configurar URLs, respostas HTTP esperadas e webhooks de notificação por serviço.

![Editar Monitoramento](imgs/monitoring-edition.PNG)

---

## Requirements

- Node.js 18+
- Python 3.9+ *(only required for uptime monitoring and chart data scripts)*

---

## Quickstart

```bash
npm install

# Create the first user (enables authentication)
node create-user.js

npm start
# → http://localhost:3123/login

# Enable verbose logging (WebSocket clients, file watchers, detected changes)
npm start -- --verbose
```

Port and bind address are configured in `server-config.json` and `websocket-config.json`.

If no users exist, the dashboard runs without authentication — useful during initial setup.
Once the first user is created, all API endpoints require a valid session.

---

## Features

- **Multiple views** — independent layouts, switchable from the sidebar
- **Real-time updates** — WebSocket pushes file changes to the browser without page reload
- **Drag, resize, and configure** — cards can be reordered, resized, titled, and removed directly in the UI
- **Six card types** — chart, list, dynamic-list, uptime, CVE assets, iframe
- **Uptime monitoring** — async URL checker with online/offline history and webhook notifications
- **CVE assessment** — collapsible asset board with per-CVE assessment panel
- **Backup** — one-click download of all configs and local data as a zip
- **Health check** — server status, WebSocket info, and active file watchers

---

## Authentication

Users are created exclusively via CLI — there is no registration form in the UI.

```bash
node create-user.js                     # create a new user (interactive)
node create-user.js --list              # list all users
node create-user.js --delete <username> # remove a user
node create-user.js --reset <username>  # reset a user's password
```

**Roles**

| Role | Access |
|---|---|
| `viewer` | Read-only — can view all cards and dashboards |
| `editor` | Full access — can create, edit, delete cards, views, and download backups |

Sessions are stored in memory and are lost when the server restarts; users simply log in again.
The `editor` role is required for all write operations (layout changes, card edits, backup download).

---

## Card Types

| Type | Description |
|---|---|
| `chart` | Chart.js graph (line, bar, doughnut) — inline data or computed via Python script |
| `list` | Event list from a semicolon-delimited CSV |
| `dynamic-list` | Configurable list: custom separator, up to 3 typed fields (Text, Date, or URL) |
| `uptime` | Availability monitor for services and URLs |
| `cve-assets` | Asset board with associated CVEs and inline assessment panel |
| `frame` | Iframe with zoom controls for local or external pages |

---

## Examples

`cards/cards-examples.json` contains ready-to-use card definitions for all types. Copy and adapt them into `cards/cards-list.json`.

`cards/card.schema.json` documents the full structure of each card type.

---

## Project Structure

```
├── server.js              # Bootstrap — starts HTTP + WebSocket servers
├── src/app.js             # Express app factory, all API routes
├── server-config.json     # HTTP port and address
├── public/
│   ├── index.html         # SPA shell
│   ├── css/               # Design system and per-component styles
│   └── js/                # Vanilla JS — layout, cards, modals, WebSocket
├── cards/
│   ├── cards-list.json    # Active card registry (gitignored, per-instance)
│   ├── cards-examples.json
│   └── card.schema.json
├── configs/               # Views and layouts (gitignored, per-instance)
├── scripts/
│   ├── check_status.py    # Async uptime checker for HTTP/TCP services (asyncio + aiohttp)
│   ├── check_systemd.py   # Async status checker for Linux systemd services
│   └── count_events_by_weekday.py
└── tests/                 # Jest + Supertest — backend and frontend unit tests
```

---

## Python Scripts

Both uptime scripts share the same JSON structure and CLI interface. The config file is read and written in-place on every run.

**Shared JSON format (`public/local-data-uptimes/*.json`)**

```json
{
  "lastChecked": "",
  "notificationHook": "http://host/notify?name={{name}}&status={{status}}&date={{lastStatusOffline}}",
  "servicesStatus": [
    {
      "name": "Display name",
      "status": "",
      "notificationHookMode": "when-offline",
      "lastStatusOnline": "",
      "lastStatusOffline": ""
    }
  ]
}
```

`notificationHookMode` accepts `"when-offline"`, `"when-online"`, or `"off"`. Notifications fire only on state transitions to avoid repeated alerts.

| Script | Purpose | Service field | Extra fields |
|---|---|---|---|
| `scripts/check_status.py` | Checks HTTP/TCP service availability | `url` | `expectedHttpRespose` (e.g. `"200"` or `"0-399"`) |
| `scripts/check_systemd.py` | Checks Linux systemd service status via `systemctl is-active` | `service` (unit name, e.g. `nginx`) | — |
| `scripts/count_events_by_weekday.py` | Aggregates a CSV into per-weekday counts for chart cards | — | — |

**Usage**

```bash
python scripts/check_status.py public/local-data-uptimes/uptime-results.json
python scripts/check_systemd.py public/local-data-uptimes/uptime-systemd.json

# Options (both scripts)
--timeout 10          # systemctl/request timeout in seconds (default: 5)
--log-dir /path/logs  # log output directory (default: scripts/logs/)
```

Notification hook placeholders:

| Placeholder | Description |
|---|---|
| `{{name}}` | Display name of the service |
| `{{url}}` | Service URL (`check_status.py` only) |
| `{{service}}` | Systemd unit name (`check_systemd.py` only) |
| `{{status}}` | Current status (`online` or `offline`) |
| `{{lastStatusOffline}}` | ISO timestamp of last offline event |

---

## Release & Deploy

```bash
# Build a release zip
python release.py
# → _deploys/{version}.zip

# On the target server
unzip {version}.zip -d painel/
cd painel/
npm install
npm start
```

The zip respects `.gitignore` and renames `server-config.json` and `websocket-config.json` to `*-SAMPLE` to avoid overwriting existing production configs.

---

## Testing

```bash
npm test                # run all tests
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

---

## License

This project is unlicensed. Use at your own discretion.
