# ATLAS – Digital Twin Engineering Preparation Platform

**Advanced Twin-based Lifecycle and Activity System** – Enterprise-class planning and decision intelligence for industrial preparation and build-up lifecycle control.

---

## Branch: `cursor/tool-python-consistency-db55`

**Base:** `planner-python`

This branch implements a **100% Python backend** with server-rendered pages (Jinja2), planner module integration, and REST API. All core logic runs in Python.

---

## Agent Update Instructions

**IMPORTANT:** When making any changes to this codebase through an agent:

1. Update this README to reflect the changes
2. Update the "Last Agent Update" timestamp below
3. Add a brief entry to the "Changelog" section
4. Ensure all file paths, routes, and APIs documented here match the code

---

## Last Agent Update

- **Date:** 2026-03-16
- **Scope:** Flash Messages — success/error feedback on login, add, edit, delete

---

## Tech Stack

| Layer | Technology |
|-------|-------------|
| Backend | Python 3.10+, Flask 3.x |
| Templates | Jinja2 (server-rendered) |
| Database | SQLite (`atlas_data.db`) |
| Auth | Flask sessions (server) + Bearer tokens (API) |
| Static Pages | HTML, CSS, Vanilla JS (Gantt, Calendar, etc.) |
| Charts | Chart.js |
| Import | SheetJS (xlsx) |

---

## Project Structure

```
/workspace/
├── app.py                    # Main Flask app – routes, auth, API
├── requirements.txt          # Flask, flask-cors
├── start.sh                  # Startup script
├── atlas_data.db             # SQLite database (created on first run)
│
├── planner/                  # Python-only planner module
│   ├── __init__.py           # Package exports
│   ├── schema.py             # Activity schema, sanitization, COLUMN_SCHEMA
│   ├── config.py             # DB path config (uses ATLAS_DB_PATH)
│   └── storage.py            # SQLite state, projects, activities, baselines, actions
│
├── templates/                # Jinja2 server-rendered pages
│   ├── base.html             # Base layout, nav
│   ├── login.html            # Sign-in (form POST to Python)
│   ├── dashboard.html        # Executive dashboard
│   ├── activities.html       # Activity Master (add/edit/delete)
│   └── activity_edit.html    # Edit activity form
│
├── css/
│   └── styles.css            # Global styles
├── js/                       # Client-side scripts (for static HTML pages)
├── *.html                    # Static HTML (gantt, calendar, etc.)
└── tests/                    # Playwright browser tests
```

---

## Run

### With Python Backend (recommended)

```bash
pip install -r requirements.txt
python3 app.py
```

Or use a custom port:

```bash
PORT=5002 python3 app.py
```

Or use the startup script:

```bash
./start.sh
```

Open `http://localhost:5000` (or your port). Data is stored in `atlas_data.db`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 5000 | Server port |
| `ATLAS_DB_PATH` | `./atlas_data.db` | SQLite database path |
| `ATLAS_SECRET_KEY` | Random hex | Flask session secret |

---

## Routes

### Python-Rendered (Server-Side)

| Method | Route | Description |
|-------|-------|-------------|
| GET | `/` | Dashboard (requires auth) |
| GET | `/dashboard` | Same as `/` |
| GET | `/login` | Login page; `?demo=planner` quick-logs in |
| POST | `/login` | Process login form |
| GET | `/logout` | Clear session, redirect to login |
| GET | `/activities` | Activity list (requires auth) |
| POST | `/activities/add` | Add activity (form POST) |
| GET | `/activities/<id>/edit` | Edit activity form |
| POST | `/activities/<id>/edit` | Save activity edits |
| POST | `/activities/<id>/delete` | Delete activity |

### REST API

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api` | API info |
| GET | `/api/health` | Health check |
| GET | `/api/state` | Full application state (JSON) |
| PUT/POST | `/api/state` | Save state (JSON body) |
| POST | `/api/auth/login` | Login (JSON: username, password, rememberMe) |
| GET/POST | `/api/auth/me` | Current user (Bearer token) |
| POST | `/api/auth/logout` | Logout (Bearer token) |
| GET | `/api/backup` | Download SQLite backup |
| POST | `/api/restore` | Restore from .db backup |

### Static Files

| Route | Description |
|-------|-------------|
| `/css/styles.css` | Global CSS |
| `/gantt` | Gantt chart (static HTML) |
| `/calendar` | Calendar (static HTML) |
| `/network` | Network diagram |
| `/materials` | Material intelligence |
| `/intelligence` | Delay, risk, optimization |
| `/risk-register` | Risk register |
| `/anomaly-center` | Anomalies, baselines, actions |

---

## Planner Module (Python)

### Exports (`from planner import ...`)

- `get_state()` – Full state dict (projects, activeProjectId, settings)
- `save_state(state)` – Persist state
- `get_active_project()` – Active project dict
- `get_activities()` – Activities for active project
- `save_activities(activities)` – Save activities
- `add_activity(activity)` – Add activity to active project
- `delete_activity(activity_id)` – Delete by activityId
- `COLUMN_SCHEMA`, `sanitize_activity`, `create_empty_activity`, `generate_activity_id`

### Storage

- Uses `atlas_data.db` (same as app)
- Table: `atlas_state` (key, value, updated_at)
- State key: `industrial_planning_intelligence_state_v1`

---

## Demo Credentials

| Role | Username | Password |
|------|----------|----------|
| Planner | planner | planner123 |
| Management | management | management123 |
| Technician | technician | technician123 |

**Quick Demo:** Open `/login?demo=planner` to auto-login as Planner.

---

## Mandatory Import Columns

Excel/CSV import (when using import features) requires:

- Activity ID, Phase, Activity Name, Sub Activity
- Base Effort Hours, Required Materials, Required Tools
- Material Ownership, Material Lead Time, Dependencies

---

## Roles and Permissions

| Role | Capabilities |
|------|--------------|
| Planner | Full access: projects, activities, import/export, optimization |
| Management | Same as Planner |
| Technician | Activities, execution fields (status, completion, dates, remarks) |

---

## Testing

```bash
npm install
npm run test:browser
```

Uses Playwright for browser tests.

---

## Changelog

### 2026-03-16
- **Flash messages:** Success/error feedback for login, add, edit, delete (Flask flash)
- **Activity Edit:** Edit page, form, Edit button in activities list
- README fully rewritten for `cursor/tool-python-consistency-db55`
- Added planner module integration
- Server-rendered login, dashboard, activities
- Jinja2 templates (base, login, dashboard, activities)
- Planner `config.py` updated to use workspace `atlas_data.db`
- REST API: `/api/auth/me`, `/api/auth/logout`, `/api/restore`
- Agent update instructions added

### Previous (planner-python base)
- Python backend with Flask
- Planner module (schema, storage)
- SQLite persistence

---

## Repository

- **Repo:** TOOL-X
- **Branch:** `cursor/tool-python-consistency-db55`
- **Base branch:** `planner-python`
