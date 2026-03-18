.PHONY: install lint typecheck security test run

install:
	pip install -e ".[dev]"

lint:
	ruff check src tests

typecheck:
	mypy src

security:
	bandit -q -r src

test:
	pytest

run:
	uvicorn psetw_platform.main:app --reload --host 0.0.0.0 --port 8000
