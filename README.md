# Vena-lite

Lightweight, single-user financial planning tool. Excel front-end (Office.js,
Slice 2+) against a DuckDB cube + FastAPI backend.

**Status:** All six slices shipped. Slice 6 (driver-based calc) adds
`POST /drivers/define` — formulas like `5000_OpEx = 4000_Revenue * 0.5`
parsed and materialized; `/submit` to a driver input triggers automatic
recompute in the same transaction. See [SPEC.md](SPEC.md) for the contract
and [CLAUDE.md](CLAUDE.md) for working-with-this-repo notes.

## Prerequisites

- Python 3.11+ (3.12 recommended)
- [uv](https://docs.astral.sh/uv/) — `winget install astral-sh.uv`
- Node.js 20+ — `winget install OpenJS.NodeJS.LTS`
- `json-schema-to-typescript` (for TS gen): `npm install -g json-schema-to-typescript`

## Quickstart (Windows PowerShell)

```powershell
# 1. Install backend deps
.\tasks.bat test          # also runs uv sync; expect "31 passed"

# 2. Seed the cube
.\tasks.bat seed          # writes cube.duckdb at repo root

# 3. Run the API
.\tasks.bat dev           # uvicorn on http://127.0.0.1:8000

# 4. In a second shell — query
curl.exe -X POST http://127.0.0.1:8000/slice -H "Content-Type: application/json" -d '{\"filters\":{}}'
# expect: 96 rows
```

Linux/Mac: equivalent `make` targets in [Makefile](Makefile).

## Repo layout

```
backend/                  FastAPI + DuckDB cube
  src/vena_lite/
    api/slice.py          POST /slice endpoint
    cube/store.py         DuckDB read/write layer
    cube/schema.sql       Append-only fact table + facts_current view
    schemas/              Pydantic v2 (source of truth for TS types)
    seed.py               96-fact bootstrap (Slice 1 demo data)
    cli.py                python -m vena_lite.cli seed PATH
  scripts/
    generate_ts_types.py  Pydantic -> TS via pydantic2ts
  tests/                  pytest (unit + integration)

add-in/src/types/
  generated.ts            AUTO-GENERATED from Pydantic. Do not edit.

.github/workflows/
  backend.yml             pytest + ruff on every PR
  types-drift.yml         Fails if generated.ts is out of sync
```

## Common tasks (`tasks.ps1` / `make`)

| Task | What it does |
|------|--------------|
| `test` | Run pytest (`uv sync` first if needed) |
| `test-cov` | pytest + coverage |
| `dev` | Start FastAPI on `127.0.0.1:8000` with reload |
| `seed` | Drop and re-seed `cube.duckdb` |
| `types` | Regenerate `add-in/src/types/generated.ts` |
| `lint` | `ruff check` |
| `fmt` | `ruff format` |
| `clean` | Delete `cube.duckdb` |

## Slice 1 verification (backend only)

```powershell
.\tasks.bat test                       # 31 passed
.\tasks.bat seed; .\tasks.bat dev     # then in another shell:
curl.exe -X POST http://127.0.0.1:8000/slice -H "Content-Type: application/json" -d '{\"filters\":{}}'
# 96 rows; values are JSON strings, not numbers
```

## Slice 2 quickstart (Excel add-in)

One-time setup:
```powershell
cd add-in
npm install
npm run setup-certs    # installs trusted dev cert; will prompt for UAC
python scripts\generate_icons.py
```

Run (three shells):
```powershell
# shell 1: backend
.\tasks.bat seed
.\tasks.bat dev

# shell 2: add-in (Vite dev server on https://localhost:3000)
cd add-in
npm run dev

# shell 3 (one-time per session): sideload into Excel
cd add-in
npm run start          # opens Excel with the add-in loaded
```

Tests:
```powershell
cd add-in
npm test               # Jest, mocks Office.js
```

Vite proxies `/api/*` → `http://127.0.0.1:8000` so the Excel WebView (HTTPS)
doesn't refuse a mixed-content fetch to the backend (HTTP).

## Slice 3 — Excel writes back

Same three-shell setup as Slice 2. In the taskpane:

1. Click **Refresh** — pulls 96 facts into A1:G97 and snapshots them as the
   baseline in workbook settings.
2. Edit one or more cells in column G (the value column).
3. Click **Submit** — diff against baseline, confirmation dialog shows the
   changed cells, click Submit again to commit.
4. The new values land in `cube.duckdb` (append-only) and per-cell rows land
   in `metadata.sqlite`'s `audit_log` table.
5. Click Refresh again to verify the new values come back from the cube.

Inspect the audit log:
```powershell
# Quick peek at the audit log via uv:
cd backend
uv run python -c "import sqlite3; c=sqlite3.connect('../metadata.sqlite'); c.row_factory=sqlite3.Row; print(*[dict(r) for r in c.execute('SELECT * FROM audit_log ORDER BY id DESC LIMIT 10')], sep='\n')"
```
