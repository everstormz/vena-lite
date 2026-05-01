# Vena-lite — repo context

Lightweight single-user financial planning tool. Excel front-end (Office.js,
Slice 2+), FastAPI + DuckDB backend. Read SPEC.md before any nontrivial change
— it is the domain contract.

## Stack
- Backend: Python 3.11+, FastAPI, Pydantic v2, DuckDB (cube), SQLite (metadata, Slice 4+)
- Add-in: Office.js + React + TypeScript, scaffolded via Yeoman (Slice 2)
- Calc: pandas/numpy behind a CalcEngine interface (Slice 6)
- Tests: pytest (backend), Jest (add-in, Slice 2)

## Build philosophy
- Six vertical slices. Each merges to main only when end-to-end demoable.
- Test-first for cube and calc. Define expected numerical outcomes BEFORE
  implementing. Silent math errors are this tool's worst failure mode.
- Append-only cube writes. The current value of a cell = latest `loaded_at`.
- TypeScript types in `add-in/src/types/generated.ts` are produced by
  `backend/scripts/generate_ts_types.py`. CI fails if they drift.

## Never do this
- Don't UPDATE or DELETE rows in `facts`. Append a new row.
- Don't use floats for monetary values. DuckDB `DECIMAL(20,6)`, Pydantic
  `Decimal`, JSON wire format = string, TypeScript = `decimal.js` (Slice 2).
- Don't hand-edit `add-in/src/types/generated.ts`. Run `make types` /
  `.\tasks.ps1 types`.
- Don't read or write Excel cells one at a time. Use `range.values` (2D
  arrays). Minimize `context.sync()` calls — one per logical operation.
- Don't write to the cube without a matching audit row in the same
  transaction (Slice 3+).
- Don't introduce new dimensions or members without updating SPEC.md first.
- Don't bypass the `CalcEngine` interface, even for "simple" calcs.
- Don't store values at non-leaf hierarchy members. Parents are computed.
- Don't add auth, remote deployment, or multi-user assumptions in v1.
- Don't bundle string-concatenated SQL anywhere — always parameterized.

## Useful entry points
- `backend/src/vena_lite/main.py` — FastAPI app (CORS for the add-in)
- `backend/src/vena_lite/api/deps.py` — shared dependency providers
- `backend/src/vena_lite/api/slice.py` — POST /slice
- `backend/src/vena_lite/api/submit.py` — POST /submit (validation + atomic write)
- `backend/src/vena_lite/cube/store.py` — cube reads/writes (transaction context)
- `backend/src/vena_lite/cube/schema.sql` — DuckDB DDL + facts_current view
- `backend/src/vena_lite/metadata/store.py` — SQLite audit store (transaction context)
- `backend/src/vena_lite/metadata/schema.sql` — audit_log DDL
- `backend/src/vena_lite/audit.py` — pure audit-row builder
- `backend/src/vena_lite/schemas/` — Pydantic source of truth for wire types
- `backend/src/vena_lite/seed.py` — Slice 1 demo data (cube facts; leaf members)
- `backend/src/vena_lite/hierarchy_seed.py` — Slice 4 demo hierarchy
- `backend/src/vena_lite/metadata/dim_model.py` — in-memory hierarchy queries
- `backend/src/vena_lite/query.py` — pure expand_filters + aggregate_to_requested
- `backend/src/vena_lite/calc/parser.py` — formula tokenizer + AST + parse_formula
- `backend/src/vena_lite/calc/engine.py` — CalcEngine: cycle check + topo sort
- `backend/src/vena_lite/calc/recalc.py` — driver recompute orchestration
- `backend/src/vena_lite/api/scenarios.py` — POST /scenarios/copy
- `backend/src/vena_lite/api/drivers.py` — POST /drivers/define
- `add-in/src/App.tsx` — taskpane UI (Refresh + Submit + confirmation dialog)
- `add-in/src/excel/refresh.ts` — Office.js batched range write
- `add-in/src/excel/baseline.ts` — Office.js Settings snapshot
- `add-in/src/excel/delta.ts` — pure delta detection
- `add-in/src/excel/submit.ts` — Office.js read-current-values
- `add-in/src/api/client.ts` — typed fetch wrapper (uses generated.ts)
- `add-in/manifest.xml` — sideloaded into Excel for development
- `add-in/vite.config.ts` — HTTPS dev server + /api proxy to backend
- `SPEC.md` — domain contract
- `tasks.ps1` (Windows) / `Makefile` (Linux/Mac/CI) — workflow entry points

## Current slice
Slice 6: driver-based calc. `POST /drivers/define` registers a formula for
an output account; the formula is parsed (no `eval`), cycle-checked, then
materialized at every cube intersection. `/submit` rejects writes to driver
accounts and triggers automatic recompute (in the same transaction) of any
driver whose formula transitively references a submitted account.

Formula language is intentionally tiny: `+ - * /`, parens, identifiers
(including digit-prefixed account ids like `4000_Revenue`), decimal literals.
The tokenizer puts IDENT before NUMBER so `4000_Revenue` is one token, not
NUMBER + bad partial IDENT. Cycle detection happens at definition time via
transitive closure on the existing dependency graph.

All six slices shipped.
