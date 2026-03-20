# ATLAS – Digital Twin Engineering Preparation Platform

**Advanced Twin-based Lifecycle and Activity System** – Enterprise-class planning and decision intelligence for industrial preparation and build-up lifecycle control.

---

## Branch: `cursor/project-management-modules-0589`

This branch includes significant UI/UX enhancements, Gantt chart fixes, Calendar feature improvements, Activity Master refinements, storage/backend updates, and quality-of-life improvements. See [Changes on This Branch](#changes-on-this-branch) for details.

---

## Tech Stack

| Layer    | Technology                                      |
|----------|--------------------------------------------------|
| Frontend | HTML, CSS, Vanilla JavaScript (ES6 modules)      |
| Backend  | Python Flask, SQLite                            |
| Charts   | Chart.js                                        |
| Import   | SheetJS (xlsx)                                  |
| PWA      | Service Worker, IndexedDB fallback               |
| Testing  | Playwright (Chromium)                           |

---

## Project Structure

```
├── app.py              # Flask backend, REST API, SQLite storage
├── start.sh             # Codespace startup script
├── requirements.txt     # Python: Flask, flask-cors
├── package.json        # Node: Playwright for browser tests
├── sw.js               # Service Worker for offline caching
├── index.html          # Executive Dashboard
├── login.html          # Role-based login
├── project-setup.html  # PS-ETW – project onboarding, team roster, workspace prefs
├── engine-description.html # Engine requirement documents, parse summaries, manual overrides
├── activities.html     # Activity Master (CRUD, import/export)
├── gantt.html          # Gantt Chart & Dependencies
├── calendar.html       # Calendar view
├── network.html        # Dependency network
├── materials.html      # Material intelligence
├── intelligence.html   # Delay, risk, what-if optimization
├── risk-register.html  # Risk register
├── anomaly-center.html # Anomalies, baselines, actions
├── audit-log.html      # Full-page audit trail (search, filter, export); routes `/audit`, `/audit-log`
├── css/
│   └── styles.css     # Global styles, theme variables
├── js/
│   ├── common.js      # Utils, modals, toasts, escapeHtml
│   ├── storage.js     # State, API/localStorage, CRUD
│   ├── auth.js        # Login, roles, permissions
│   ├── schema.js      # Activity columns, sanitization
│   ├── analytics.js   # Metrics, risk, critical path
│   ├── activities.js  # Activity Master logic
│   ├── gantt.js       # Gantt chart, drag/resize
│   ├── calendar.js    # Calendar, drag, quick-add
│   ├── dashboard.js   # KPIs, charts
│   ├── audit-log.js   # Audit Log page UI (reads localStorage audit trail from audit.js)
│   ├── materials.js   # Material health, charts
│   ├── intelligence.js # Root cause, simulation
│   ├── anomaly-center.js
│   ├── risk-register.js
│   ├── network.js
│   ├── undo.js        # Undo/redo stack
│   ├── audit.js       # Change history
│   └── ...
└── tests/             # Playwright browser tests
```

---

## Run

### With Python Backend (recommended)

```bash
./start.sh
```

Or:

```bash
pip install -r requirements.txt
python app.py
```

Open the forwarded port URL (e.g. `https://your-codespace-5000.app.github.dev`). Data is stored in SQLite (`atlas_data.db`).

### Static-only (no backend)

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/`. Data uses `localStorage` and IndexedDB fallback.

### Quick Demo

Use **Quick Demo (Planner)** on the login page, or add `?dev=1` to any URL to auto-login as planner.

---

## Pages and Features

### Login (`login.html`)
- Role-based sign-in (Planner, Management, Technician)
- Demo credentials and Quick Demo
- Session with optional "Remember me"

### Project Setup (`project-setup.html`, PS-ETW)
- Per-project configuration: code, customer/OEM, engine identity, trolley, PM, dates, contract, working hours, warning/critical thresholds
- Team roster (name, role, department, contact, access level, notes)
- Workspace preferences: default editor for activity audit trail (replaces the old Activity Master default-editor field)

### Engine Description (`engine-description.html`)
- Upload Excel (.xlsx, .xls), CSV, or Word (.docx) requirement documents per active project
- Optional server storage of originals when using the Python backend with API login (download/delete supported)
- Heuristic parsing into summary panels; partial parses still store the file and allow full manual override of summary fields
- Search and filter by parse status

### Executive Dashboard (`index.html`)
- **KPIs:** Total activities, delayed, high-risk, completion, cost variance
- **Charts:** Phase completion, risk distribution
- **Critical path** and dependency chain
- **Blocked activities** list
- **Priority risks** table
- **Alert Center**
- Role-specific views
- Snapshot date and time range filters

### Activity Master (`activities.html`)
- Full activity CRUD in data grid
- **Sticky columns:** Activity ID and Activity Name stay visible while scrolling
- **Search:** Activity ID, name, phase, comments
- **Pagination:** Configurable page size (10/25/50/100)
- **Bulk actions:** Multi-select, bulk status edit, bulk delete
- **Import:** Excel (merge by ID or replace), JSON
- **Export:** CSV, Excel, JSON, PDF (via Print)
- **Templates:** Save/load activity presets
- **Comments:** Per-activity notes
- **Saved filter presets**
- **Column visibility** toggle
- **Undo/Redo** (Ctrl+Z / Ctrl+Y)

### Gantt Chart (`gantt.html`)
- **Timeline view** with daily date ticks (Day Month format)
- **Drag bars** to move activities between dates
- **Resize handle** on right edge to adjust end date
- **Snap-to-day:** Bars snap to day boundaries during drag/resize
- **Critical path** highlight
- **Delayed** activities highlighted in red
- **Today marker** (vertical red line)
- Phase/Status filters, sort modes (start, risk, delay, completion)
- Zoom (day/week/month), Reset Timeline, Go to Today
- **Dependency lines** (SVG) between bars
- **Dependency Risk Register** table below

### Calendar (`calendar.html`)
- **Month view** of activities by planned dates
- **Today column** highlight
- **Activity count badge** per day
- **Drag to reschedule:** Drag activity to a different day
- **Quick-add:** Double-click empty day to add activity
- **Keyboard navigation:** Arrow keys between activities, Escape to clear
- **Density toggle:** Compact / Normal / Expanded
- **Detail panel:** Right-side details when an activity is selected
- **Status colors:** Completed (green), Delayed (red), In Progress (yellow), Not Started (gray)

### Network Diagram (`network.html`)
- List of activities and their dependencies
- Links to Activity Master
- Blocked activities highlighted

### Materials (`materials.html`)
- KPIs: Ownership counts, pending critical, late materials, avg lead time
- Pie/bar charts
- Filterable table
- CSV export

### Intelligence (`intelligence.html`)
- Risk KPIs (critical, high, medium, low)
- Root cause capture for delayed activities
- Blocked activities list
- Delay/Risk table with actions
- **What-if simulation:** Manpower boost, lead-time reduction, overtime
- Scenario presets and impact table

### Risk Register (`risk-register.html`)
- High-risk activities (score ≥ 40 or High/Critical)
- Filter by risk level
- Inline mitigation notes

### Anomaly Center (`anomaly-center.html`)
- **Anomalies:** Data-quality and logic checks (cycles, missing deps, etc.)
- **Baselines:** Create, compare, variance export
- **Actions:** Create, assign, track corrective actions

### Audit Log (`audit-log.html`, routes `/audit` and `/audit-log`)
- **Full-page trail** of actions recorded via `logAudit` in this browser (localStorage), with search, filters, timeline/table views, pagination, CSV export, and print-to-PDF
- **Quick view:** Sidebar **Audit** still opens the Change History modal with a link to this page

---

## Roles and Permissions

| Role        | Capabilities                                                                 |
|-------------|-------------------------------------------------------------------------------|
| **Planner** | Full access: projects, activities, import/export, optimization, baselines     |
| **Management** | Same as Planner                                                           |
| **Technician** | Activities, execution fields only (status, completion, dates, remarks)   |

---

## Keyboard Shortcuts

| Shortcut      | Action                         |
|---------------|--------------------------------|
| Ctrl+K        | Focus search (Activity Master) |
| Ctrl+Shift+K  | Global cross-page search       |
| Ctrl+N        | Add activity                   |
| Ctrl+E        | Export CSV                     |
| Ctrl+Z        | Undo                           |
| Ctrl+Y        | Redo                           |
| Ctrl+/        | Show shortcuts help            |
| Escape        | Close modal / cancel           |

---

## API Endpoints

| Method | Endpoint        | Description                    |
|--------|-----------------|--------------------------------|
| GET    | /api/health     | Health check                   |
| GET    | /api/state      | Full application state         |
| PUT    | /api/state      | Save state                     |
| POST   | /api/auth/login | Login                          |
| GET    | /api/auth/me    | Current user (Bearer token)    |
| POST   | /api/auth/logout| Logout                         |
| GET    | /api/backup     | Download SQLite backup         |
| POST   | /api/restore    | Restore from .db backup        |
| POST   | /api/engine-docs | Upload requirement file (multipart, Bearer auth) |
| GET    | /api/engine-docs/{id} | Download stored file        |
| DELETE | /api/engine-docs/{id} | Remove stored file blob     |

---

## Mandatory Import Columns

Excel/CSV import requires:

- Activity ID, Phase, Activity Name, Sub Activity  
- Base Effort Hours, Required Materials, Required Tools  
- Material Ownership, Material Lead Time, Dependencies  

---

## Demo Credentials

| Role        | Username    | Password     |
|-------------|-------------|--------------|
| Planner     | planner     | planner123   |
| Management  | management  | management123|
| Technician  | technician  | technician123|

---

## Testing

```bash
npm install
npm run test:browser
```

Uses Playwright to run login, add-activity, storage, and diagnostic tests.

---

## Changes on This Branch

### Gantt Chart
- **Bar position:** Uses planned dates only so bars stay where moved
- **Drag/resize:** Snap to day boundaries
- **Date parsing:** Local date handling to avoid timezone shifts
- **Date serialization:** Uses local date parts for correct save

### Calendar
- Today column highlight
- Activity count badge per day
- Drag to reschedule activities
- Quick-add on double-click empty day
- Keyboard navigation (arrows, Escape)
- Density toggle (compact/expanded)
- Right-side activity detail panel
- Status colors (completed, delayed, in progress)

### Activity Master
- Sticky Activity Name column
- Search includes comments
- Pagination with page size selector
- Last-saved indicator with save status

### Storage
- Retry logic for backend saves (3 attempts)
- Save status events (saving / saved / error)
- Reduced toast noise on normal saves
- **Debounced saves:** State writes are debounced (~450ms) to reduce write frequency on rapid edits

### Backend
- `datetime.utcnow()` replaced with `datetime.now(timezone.utc)` for Python 3.12 compatibility
- **Backup before restore:** Current database is saved as `atlas_data_pre_restore_backup.db` before any restore

### Activity Master (additional)
- **Dependency validation:** Warns when adding dependencies that create cycles or reference missing activity IDs
- **Duplicate button** per row to copy activity + dependencies

### Quality of Life
- **Loading indicators** for import, backup, and restore operations
- **tmp_index.html** removed
- `_memoryCache` used as source of truth during debounce window for consistent reads

### Schema
- `activityName` column order adjusted after `activityId`

---

## License & Repository

Repository: **TOOL-X**  
Branch: **cursor/project-management-modules-0589**
