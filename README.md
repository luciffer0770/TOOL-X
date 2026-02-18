# Industrial Planning Intelligence Platform

Enterprise-class, frontend-only planning and decision intelligence system for preparation and build-up lifecycle control.

## Highlights

- Multi-page architecture to avoid clutter:
  - `index.html` - executive dashboard
  - `activities.html` - manual activity management + Excel import/export
  - `gantt.html` - Gantt timeline and dependency chain view
  - `materials.html` - material ownership and supply intelligence
  - `intelligence.html` - delay, risk, root-cause, and what-if optimization
- Multi-project lifecycle control:
  - Create, rename, switch, and delete projects
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

`http://localhost:8080/index.html`

## Data Handling

- Activity records are editable directly in the data grid.
- Insert new activity rows above/below existing rows to place activities in the middle.
- Excel import merges by `Activity ID` (or replaces all records if selected).
- Export is available as CSV and JSON.
- Column visibility can be toggled without losing editability of fields.
