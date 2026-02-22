# ATLAS Planning

**Activity & Timeline Lifecycle Planning** – Enterprise-class, frontend-only planning and decision intelligence system for preparation and build-up lifecycle control.

## Highlights

- Multi-page architecture to avoid clutter:
  - `login.html` - role-based sign-in
  - `index.html` - executive dashboard
  - `activities.html` - manual activity management + Excel import/export
  - `gantt.html` - Gantt timeline and dependency chain view
  - `materials.html` - material ownership and supply intelligence
  - `intelligence.html` - delay, risk, root-cause, and what-if optimization
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
- Entirely browser-side processing and storage:
  - No backend required
  - All data saved in `localStorage`
- Advanced intelligence logic in frontend runtime:
  - Delay detection
  - Risk scoring and level derivation
  - Dependency blocking analysis
  - Critical path approximation
  - What-if scenario simulation (manpower, lead-time, overtime)

## Run

Serve as static files from any web server, for example:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080/` or `http://localhost:8080/login.html`

**Quick access:** Use the "Quick Demo (Planner)" button on the login page, or add `?dev=1` to any app URL to auto-login as planner (e.g. `http://localhost:8080/index.html?dev=1`).

**Note:** In remote dev environments (e.g. Cursor cloud), use the port-forwarding URL shown in the Ports panel instead of localhost.

## Demo Login Credentials

- Planner: `planner` / `planner123`
- Management: `management` / `management123`
- Execution: `technician` / `technician123`

## Data Handling

- Activity records are editable directly in the data grid.
- Insert new activity rows above/below existing rows to place activities in the middle.
- Excel import merges by `Activity ID` (or replaces all records if selected).
- Export is available as CSV and JSON.
- Column visibility can be toggled without losing editability of fields.
