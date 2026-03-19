# PS-ETW Python Platform (Greenfield Replatform)

This directory contains the Python-first replatform foundation for PS-ETW.

## Goals

- Enterprise-ready Python architecture.
- Security-by-default API and authentication model.
- Traceable, testable domain logic.
- Standards alignment support (ASPICE-style process traceability, ISO/SAE 21434 secure engineering practices, NIST SSDF, OWASP ASVS).

## Tech Stack

- **FastAPI** for API contracts and OpenAPI documentation.
- **SQLAlchemy 2.x** for persistence layer.
- **Pydantic v2** for strict validation and typed settings.
- **JWT** (bearer token) auth with role-based authorization.
- **Pytest + Ruff + MyPy + Bandit** for quality and security gates.

## Quick Start

```bash
cd psetw_py
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn psetw_platform.main:app --reload --host 0.0.0.0 --port 8000
```

API docs:

- `http://localhost:8000/docs`
- `http://localhost:8000/redoc`

Web UI (server-rendered):

- `http://localhost:8000/ui/login`
- After login, the app redirects to `/ui/dashboard`

## Default Demo Users

When `PSETW_SEED_DEMO_USERS=true`:

- planner / planner123 (role: planner)
- management / management123 (role: management)
- technician / technician123 (role: technician)

## Quality Commands

```bash
ruff check src tests
mypy src
bandit -q -r src
pytest
```

## Phase 2 Planning APIs (in progress)

The replatform now includes dedicated planning endpoints:

- `GET /api/v1/projects/{project_id}/planning/timeline-bounds`
- `GET /api/v1/projects/{project_id}/planning/phase-progress`
- `GET /api/v1/projects/{project_id}/planning/gantt`
- `GET /api/v1/projects/{project_id}/planning/calendar`
- `GET /api/v1/projects/{project_id}/planning/network`
- `GET /api/v1/projects/{project_id}/planning/materials-health`
- `POST /api/v1/projects/{project_id}/planning/simulate`
- `GET /api/v1/projects/{project_id}/dashboard/overview`

Legacy frontend compatibility endpoints (for transition period):

- `GET|PUT|POST /api/state`
- `POST /api/auth/login`
- `GET|POST /api/auth/me`
- `POST /api/auth/logout`

Python-rendered UI endpoints:

- `/ui/dashboard`
- `/ui/activities`
- `/ui/calendar`
- `/ui/delay-optimization`
- `/ui/engine-description`
- `/ui/anomaly-center`
- `/ui/settings`

## Python UI Feature Parity Progress

The server-rendered Python UI is actively closing parity with the previous tool.

Implemented in Python UI now:

- Activity creation/edit/delete with rich planning/risk/material fields
- Activity search + phase/status filtering + pagination
- Bulk activity operations (status update and delete)
- Spreadsheet import for Activities (`.xlsx`, `.csv`) with merge/replace mode
- Activity export (`.csv`, `.xlsx`, `.json`)
- Executive dashboard with KPI cards, operational insight panels, and risk/delay views
- Delay & optimization page with root-cause updates and trend views
- Engine description page for requirement document uploads (`.xlsx`, `.xls`, `.csv`, `.docx`) and parsed summary capture
- Baseline lock/restore and action management from Python UI anomaly workflow

Note:

- The target is parity (or better) with the previous frontend, while keeping the new Python-first architecture.
- Additional parity hardening is ongoing for advanced interaction workflows.

## Directory Layout

```text
psetw_py/
├── src/psetw_platform/
│   ├── core/            # config, logging, auth security
│   ├── routers/         # HTTP route modules
│   ├── services/        # domain/application services
│   ├── database.py      # SQLAlchemy engine/session/base
│   ├── dependencies.py  # shared FastAPI dependencies
│   ├── models.py        # persistence entities
│   ├── schemas.py       # API DTO schemas
│   └── main.py          # app bootstrap + router wiring
├── tests/               # API and security behavior tests
└── pyproject.toml
```
