# PS-ETW Preparation Planner

This repository now runs from the Python platform in `psetw_py/`.

## Run

```bash
cd psetw_py
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e ".[dev]"
cp .env.example .env
python3 -m uvicorn psetw_platform.main:app --host 0.0.0.0 --port 8000 --reload
```

Open:

- `http://localhost:8000/ui/login`
- `http://localhost:8000/docs`

Demo users:

- planner / planner123
- management / management123
- technician / technician123

## Notes

- The implementation is Python-first (FastAPI + SQLAlchemy + Jinja templates).
- Legacy static frontend assets were removed from this branch.
