# ATLAS – Digital Twin Engineering Preparation Platform

**Advanced Twin-based Lifecycle and Activity System** – Enterprise-class, frontend-only planning and decision intelligence system for preparation and build-up lifecycle control.

## Highlights

- Multi-page architecture to avoid clutter:
  - `login.html` - role-based sign-in
  - `index.html` - executive dashboard
  - `activities.html` - manual activity management + Excel import/export
  - `gantt.html` - Gantt timeline and dependency chain view
  - `materials.html` - material ownership and supply intelligence
  - `intelligence.html` - delay, risk, root-cause, and what-if optimization
  - `anomaly-center.html` - anomaly, baseline, and action workflow
- Role-based experience and control:
  - Planner: full planning and optimization access
  - Management: full portfolio visibility and decision controls
  - Execution: status/root-cause updates only in activity tracking
- Multi-project lifecycle control:
  - Create, duplicate template, rename, switch, and delete projects
  - Each project stores its own activity list and analytics context
  - Single UI with isolated project datasets for parallel monitoring
- Full column schema support, including all planning, resource, material, execution, risk, optimization, cost, and audit fields.
- Mandatory import validation for core columns:
  - Activity ID
  - Phase
  - Activity Name
  - Sub Activity
  - Base Effort Hours
  - Required Materials
  - Required Tools
  - Material Ownership
  - Material Lead Time
  - Dependencies
- Python backend with persistent storage:
  - Data stored in SQLite (`atlas_data.db`)
  - Runs fully in Codespace (no local Python required)
  - Falls back to `localStorage` when backend is unavailable
- Advanced intelligence logic in frontend runtime:
  - Delay detection
  - Risk scoring and level derivation
  - Dependency blocking analysis
  - Critical path approximation
  - What-if scenario simulation (manpower, lead-time, overtime)

## Run

### In Codespace (recommended)

No local Python installation needed. Everything runs in Codespace:

```bash
./start.sh
```

Or manually:

```bash
pip install -r requirements.txt
python app.py
```

Then open the forwarded port (e.g. `https://your-codespace-5000.app.github.dev`) from the Ports panel. The backend serves the app and stores data in SQLite.

### Static-only (no backend)

If you prefer not to use the backend, serve static files:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`. Data will be stored in `localStorage` (browser-only).

**Quick access:** Use the "Quick Demo (Planner)" button on the login page, or add `?dev=1` to any app URL to auto-login as planner.

## Demo Login Credentials

- Planner: `planner` / `planner123`
- Management: `management` / `management123`
- Execution: `technician` / `technician123`

## Data Handling

- Activity records are editable directly in the data grid.
- Insert new activity rows above/below existing rows to place activities in the middle.
- Excel import merges by `Activity ID` (or replaces all records if selected).
- Export is available as CSV, JSON, Excel, and PDF.
- Column visibility can be toggled without losing editability of fields.
- Global search (Ctrl+Shift+K), audit trail, onboarding tour, chart export, and theme toggle.
