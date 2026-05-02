# Vena-lite — repo context

Lightweight single-user financial planning tool. Excel front-end (Office.js,
Slice 2+), FastAPI + DuckDB backend. Read SPEC.md before any nontrivial change
— it is the domain contract.

## Stack
- Backend: Python 3.11+, FastAPI, Pydantic v2, DuckDB (cube), SQLite (metadata, Slice 4+)
- Add-in: Office.js + Vite + React 19 + TypeScript + Fluent UI v9 (hand-rolled, not Yeoman)
- Calc: hand-rolled formula parser + CalcEngine (no `eval`); pure functions over Decimal
- Tests: pytest (backend, 175), Jest with ts-jest (add-in, 51)

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
  `Decimal`, JSON wire format = string, TypeScript = string (Slice 2).
- Don't hand-edit `add-in/src/types/generated.ts`. Run `make types` /
  `.\tasks.ps1 types`. The narrow `DimName` lives in
  `add-in/src/types/dims.ts` (hand-maintained — JSON Schema can't express
  Pydantic Literals dict-keyed; gotcha #8 from Phase 1).
- Don't read or write Excel cells one at a time. Use `range.values` (2D
  arrays). Minimize `context.sync()` calls — one per logical operation.
  `pivot.ts` is pure JS so the Office.js block in `refresh.ts` stays
  one-sync.
- Don't write to the cube without a matching audit row in the same
  transaction (Slice 3+).
- Don't introduce new dimensions without updating SPEC.md first. New
  *members* are now editable from the taskpane (Slice 9 dim manager) —
  use that path, not seed edits.
- Don't rename a `member_id` (Slice 9 invariant). Cube facts and driver
  formulas reference it. Use the mutable `display_name` alias instead.
- Don't bypass the `CalcEngine` interface, even for "simple" calcs.
- Don't store values at non-leaf hierarchy members. Parents are computed.
- Don't add auth, remote deployment, or multi-user assumptions in v1.
- Don't bundle string-concatenated SQL anywhere — always parameterized.
  (`PRAGMA table_info(<table>)` in `_apply_migrations` is the one
  exception — table names are internal-only.)
- Don't put schema migrations in `schema.sql`. That's the fresh-install
  schema. Existing-db migrations go in `_apply_migrations` in
  `metadata/store.py` (PRAGMA-introspect + ALTER TABLE if missing).
- Don't construct `AuditRow` tuples by hand — use the `build_*_audit_row`
  helpers in `audit.py`. Tuple is len-12 (Slice 9). Adding a new audit
  kind means adding a new `source` value, not reusing an existing one.
- Don't bypass `client.ts` — it's the one fetch surface for the add-in.
  New endpoints get a typed wrapper there.

## Useful entry points
### Backend
- `backend/src/vena_lite/main.py` — FastAPI app (CORS allows GET/POST/PATCH/DELETE/OPTIONS for the add-in)
- `backend/src/vena_lite/api/deps.py` — shared dependency providers (dim_model + calc_engine reload-on-each-call)
- `backend/src/vena_lite/api/slice.py` — POST /slice
- `backend/src/vena_lite/api/submit.py` — POST /submit (validation + atomic write)
- `backend/src/vena_lite/api/scenarios.py` — POST /scenarios/copy
- `backend/src/vena_lite/api/drivers.py` — POST /drivers/define + GET /drivers + DELETE /drivers/{account} (Slice 9)
- `backend/src/vena_lite/api/dimensions.py` — GET + POST + PATCH + DELETE on /dimensions/{dim}/members (Slice 9 CRUD)
- `backend/src/vena_lite/cube/store.py` — cube reads/writes (transaction context)
- `backend/src/vena_lite/cube/schema.sql` — DuckDB DDL + facts_current view
- `backend/src/vena_lite/metadata/store.py` — SQLite store; `_apply_migrations` is the additive-migration helper
- `backend/src/vena_lite/metadata/schema.sql` — audit_log + dim_member + driver DDL (fresh installs only)
- `backend/src/vena_lite/metadata/dim_model.py` — in-memory hierarchy queries; public `lookup(dim, member)` (Slice 9)
- `backend/src/vena_lite/audit.py` — `build_audit_rows` + `build_dim_change_audit_row` + `build_driver_change_audit_row`
- `backend/src/vena_lite/schemas/` — Pydantic source of truth for wire types
- `backend/src/vena_lite/seed.py` — Slice 1 demo data (cube facts; leaf members)
- `backend/src/vena_lite/hierarchy_seed.py` — Slice 4 demo hierarchy
- `backend/src/vena_lite/query.py` — pure expand_filters + aggregate_to_requested
- `backend/src/vena_lite/calc/parser.py` — formula tokenizer + AST + parse_formula
- `backend/src/vena_lite/calc/engine.py` — CalcEngine: cycle check + topo sort
- `backend/src/vena_lite/calc/recalc.py` — driver recompute orchestration

### Add-in
- `add-in/src/App.tsx` — taskpane UI; mounts the three accordion panels (Copy / Define / Manage dimensions)
- `add-in/src/types/dims.ts` — canonical narrow `DimName` union + `DIM_NAMES` constant
- `add-in/src/excel/refresh.ts` — Office.js batched range write; clears stale cells before write (Slice 8)
- `add-in/src/excel/pivot.ts` — pure pivot transform (Slice 8); no Office.js
- `add-in/src/excel/filters.ts` — Office Settings persistence for filter+axis state (Slice 8)
- `add-in/src/excel/baseline.ts` — Office Settings snapshot for delta detection
- `add-in/src/excel/delta.ts` — pure delta detection
- `add-in/src/excel/submit.ts` — Office.js read-current-values; `LayoutDescriptor`-aware (Slice 8)
- `add-in/src/excel/dim_tree.ts` — shared `buildTree` + `memberLabel*` helpers (Slice 9)
- `add-in/src/api/client.ts` — typed fetch wrapper; one helper per HTTP verb (postJson/patchJson/deleteJson)
- `add-in/src/components/MemberPicker.tsx` — single-select; renders `display_name ?? id`
- `add-in/src/components/MultiMemberPicker.tsx` — multi-select with depth-indent (Slice 8)
- `add-in/src/components/AxisPicker.tsx` — row/col axis dropdown (Slice 8)
- `add-in/src/components/FilterStrip.tsx` — six MultiMemberPickers stacked (Slice 8)
- `add-in/src/components/CopyScenarioPanel.tsx` — Slice 5 scenario copy UI
- `add-in/src/components/DefineDriverPanel.tsx` — Slice 6 define + Slice 9 undefine
- `add-in/src/components/DimensionManagerPanel.tsx` — Slice 9 dim CRUD UI
- `add-in/manifest.xml` — sideloaded into Excel for development
- `add-in/vite.config.ts` — HTTPS dev server + /api proxy to backend

### Project
- `SPEC.md` — domain contract
- `.claude/docs/phase-1-handoff.md` — Phase 1 architecture (Slices 1–7)
- `.claude/docs/phase-2-handoff.md` — Phase 2 architecture (Slices 8–9)
- `tasks.ps1` (Windows) / `Makefile` (Linux/Mac/CI) — workflow entry points

## Current state
Phase 1 (Slices 1–7) and Phase 2 (Slices 8–9) shipped. The taskpane is a
mini report builder: 6-dim multi-select filter strip + row/col axis pickers
+ client-side pivot rendered in one batched range write. The dim model is
editable from the taskpane (POST/PATCH/DELETE on /dimensions/{dim}/members)
with an alias layer (mutable `display_name`, immutable `member_id`).
Drivers can be undefined; prior computed facts stay (append-only).

Audit log is a single table — `source` discriminates kinds (`submit`,
`copy`, `driver:initial`, `driver`, `dim_change`, `driver_change`). The
`details` TEXT column holds kind-specific JSON for non-submit rows.
`AuditRow` is a 12-element tuple; constructors live in `audit.py`.

Schema migrations are additive and idempotent: `_apply_migrations` in
`metadata/store.py` introspects `PRAGMA table_info` and runs `ALTER TABLE`
for missing columns. Fresh installs hit the (updated) `CREATE TABLE` in
`schema.sql`.

Formula language is intentionally tiny: `+ - * /`, parens, identifiers
(including digit-prefixed account ids like `4000_Revenue`), decimal literals.
The tokenizer puts IDENT before NUMBER so `4000_Revenue` is one token, not
NUMBER + bad partial IDENT. Cycle detection happens at definition time via
transitive closure on the existing dependency graph. Formulas reference
`member_id`, never `display_name`.

Read `.claude/docs/phase-2-handoff.md` for Phase 2 deltas (Slice 8 +
Slice 9 architecture, decisions, invariants); read
`.claude/docs/phase-1-handoff.md` for the original Phase 1 baseline
(Slices 1–7).
