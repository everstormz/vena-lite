# Vena-lite Makefile (mirror of tasks.ps1; CI uses this on Linux).
.PHONY: dev test test-cov types seed lint fmt clean help

CUBE = $(CURDIR)/cube.duckdb

dev:
	cd backend && uv run uvicorn vena_lite.main:app --reload --host 127.0.0.1 --port 8000

test:
	cd backend && uv run pytest

test-cov:
	cd backend && uv run pytest --cov=vena_lite --cov-report=term-missing

types:
	cd backend && uv run python scripts/generate_ts_types.py

seed:
	rm -f $(CUBE)
	cd backend && uv run python -m vena_lite.cli seed $(CUBE)

lint:
	cd backend && uv run ruff check .

fmt:
	cd backend && uv run ruff format .

clean:
	rm -f $(CUBE)

help:
	@echo "Tasks: dev | test | test-cov | types | seed | lint | fmt | clean"
