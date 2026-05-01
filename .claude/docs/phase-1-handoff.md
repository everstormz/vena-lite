# Vena-lite — Phase 1 handoff

**Status:** Phase 1 complete. 7 slices shipped, demo verified end-to-end in
Excel. **154 backend tests + 16 add-in tests passing**, ruff clean,
Pydantic ↔ TypeScript drift gate green. Single-user, localhost only.

This doc is the orientation a competent dev (or future-you after a few
months away) needs to pick up the codebase, run it, extend it, or evaluate
whether to start a Phase 2.

---

## TL;DR

Vena-lite is a lightweight financial planning tool — Excel as the front-end,
DuckDB as a multidimensional cube, FastAPI as the API, SQLite for metadata
(audit log, hierarchy, drivers). It implements the Vena/Anaplan paradigm at
**minimum viable scope**: open Excel → see facts → edit cells → submit →
audit trail + driver recompute happens server-side.

- Repo: `C:\Users\pshur\my-app`
- Backend: Python 3.12, FastAPI, Pydantic v2, DuckDB, SQLite. `uv`-managed.
- Add-in: Office.js + Vite + React 19 + TypeScript + Fluent UI v9.
- Two CI workflows: `backend.yml` (pytest + ruff), `types-drift.yml` (regen
  generated.ts and fail on diff).
- Original build plan (Slice 1 era, mostly historical):
  `~/.claude/plans/i-m-building-a-lightweight-stateless-mochi.md`
- Domain contract: [`SPEC.md`](../../SPEC.md). Read this before any
  nontrivial change.
- Per-repo guidance for AI assistants: [`CLAUDE.md`](../../CLAUDE.md).
- Quickstart: [`README.md`](../../README.md).

---

## The original brief (anchoring document)

Verbatim non-negotiables that should still bind every change:

- Six vertical slices, each end-to-end demoable, merged to main only when
  working.
- **Test-first for cube and calc layers** — define expected numerical
  outcomes BEFORE implementing logic. Silent math errors are the worst
  failure mode for a finance tool and must be prevented by tests, not
  vigilance.
- TypeScript types for the add-in must be generated from Pydantic schemas;
  the build should fail if they drift.
- Append-only cube writes. No updates, no deletes. Versioning via timestamp
  + scenario.

These all hold. Slice 7 added a UX layer on top without violating any of
them.

---

## Repo layout

```
my-app/
├── README.md                    # quickstart (3 PowerShell windows)
├── SPEC.md                      # domain contract — start here for changes
├── CLAUDE.md                    # AI working notes
├── tasks.bat / tasks.ps1        # workflow entry points (Windows)
├── Makefile                     # mirror for Linux/Mac/CI
├── cube.duckdb                  # local cube (gitignored)
├── metadata.sqlite              # local metadata (gitignored)
│
├── backend/
│   ├── pyproject.toml           # uv-managed
│   ├── src/vena_lite/
│   │   ├── main.py              # FastAPI app + CORS + router wiring
│   │   ├── config.py            # cube_path() + metadata_path() (env overrides)
│   │   ├── seed.py              # leaf member lists + 96-fact demo data
│   │   ├── hierarchy_seed.py    # demo parent-child hierarchy
│   │   ├── cli.py               # `python -m vena_lite.cli seed PATH`
│   │   ├── audit.py             # build_audit_rows + intersection_key (pure)
│   │   ├── query.py             # expand_filters + aggregate_to_requested (pure)
│   │   ├── api/
│   │   │   ├── deps.py          # FastAPI dep providers (cube, metadata, dim_model, calc_engine)
│   │   │   ├── slice.py         # POST /slice — read with hierarchy expand+aggregate
│   │   │   ├── submit.py        # POST /submit — write + audit + driver recalc
│   │   │   ├── scenarios.py     # POST /scenarios/copy — fork a (scenario, version)
│   │   │   ├── drivers.py       # POST /drivers/define + GET /drivers
│   │   │   └── dimensions.py    # GET /dimensions/{dim}/members
│   │   ├── cube/
│   │   │   ├── store.py         # DuckDBCubeStore — slice, bulk_insert, lookup, transaction
│   │   │   └── schema.sql       # facts table + facts_current view
│   │   ├── metadata/
│   │   │   ├── store.py         # SQLiteMetadataStore — audit, dim_member, driver
│   │   │   ├── schema.sql       # audit_log + dim_member + driver
│   │   │   └── dim_model.py     # in-memory hierarchy queries
│   │   ├── calc/
│   │   │   ├── parser.py        # tiny formula language (no eval)
│   │   │   ├── engine.py        # CalcEngine: cycle detection + topo sort
│   │   │   └── recalc.py        # orchestration glue: cube ↔ engine ↔ audit
│   │   └── schemas/             # Pydantic v2 — source of truth for wire types
│   ├── scripts/
│   │   └── generate_ts_types.py # runs pydantic-to-typescript
│   └── tests/
│       ├── conftest.py          # tmp_path-scoped DuckDB + SQLite fixtures
│       ├── unit/                # cube, schemas, dim_model, query, parser, engine
│       └── integration/         # endpoint tests + types-drift gate
│
├── add-in/
│   ├── package.json             # vite, react 19, fluent-ui v9, jest 30
│   ├── manifest.xml             # Office Add-in manifest (sideloaded)
│   ├── vite.config.ts           # HTTPS dev cert + /api proxy to backend
│   ├── index.html               # Vite entry; loads office.js
│   ├── src/
│   │   ├── main.tsx             # polls for Office, mounts React
│   │   ├── App.tsx              # taskpane shell; pickers + buttons + dialog
│   │   ├── api/client.ts        # typed fetch wrappers (uses generated.ts)
│   │   ├── excel/
│   │   │   ├── refresh.ts       # one batched range write per refresh
│   │   │   ├── baseline.ts      # Office.js Settings snapshot for diff
│   │   │   ├── delta.ts         # pure detectDeltas(baseline, current)
│   │   │   └── submit.ts        # readCurrentValuesFromActiveSheet
│   │   ├── components/
│   │   │   ├── MemberPicker.tsx
│   │   │   ├── CopyScenarioPanel.tsx
│   │   │   └── DefineDriverPanel.tsx
│   │   ├── types/generated.ts   # AUTO-GENERATED — do not edit
│   │   └── __tests__/{refresh,delta}.test.ts
│   └── public/icon-{16,32,64,80,128}.png  # generated by scripts/generate_icons.py
│
└── .github/workflows/
    ├── backend.yml              # pytest + ruff
    └── types-drift.yml          # regen TS, fail on diff
```

---

## Phase 1 slice-by-slice

Each slice was end-to-end demoable before the next started. The build plan
called for six; Slice 7 was added after the user picked "polish the Excel
UX" as the next direction.

### Slice 1 — Read-only cube

**Ship:** DuckDB-backed cube (`facts` table + `facts_current` view that
dedupes by latest `loaded_at`); FastAPI; `POST /slice` returning long-format
fact rows. Hardcoded six-dim model in `seed.py`. Pydantic→TS generator +
drift gate live from day one even though no add-in existed yet.

**Tests:** 31 backend, all passing. Cube store correctness against the
96-fact seed; FastAPI integration; types-drift gate.

**Key files:** `cube/store.py`, `cube/schema.sql`, `schemas/slice.py`,
`api/slice.py`, `scripts/generate_ts_types.py`.

**Notable decisions:**
- DECIMAL(20, 6) end-to-end. Decimals serialize as **JSON strings** (never
  numbers — JS would coerce to IEEE-754 and lose precision).
- Long format, not pivoted; sparse-friendly, schema-stable across dim changes.
- `facts_current` is a view, not a materialized table. Listed as a known
  perf escape hatch when row count grows.

### Slice 2 — Excel reads cube via Office.js

**Ship:** Hand-rolled Vite + React + Fluent UI v9 add-in. **Refresh** button
pulls all 96 facts and writes them to A1:G97 of the active sheet via a
single batched `range.values` write + one `context.sync` (Office.js perf
rule). CORS on backend; Vite proxies `/api/*` so the HTTPS WebView doesn't
refuse a mixed-content fetch to the HTTP backend.

**Tests:** 4 jest (mocked Office.js). 31 backend unchanged.

**Key files:** `add-in/src/excel/refresh.ts`, `add-in/src/api/client.ts`,
`add-in/src/App.tsx`, `add-in/manifest.xml`, `add-in/vite.config.ts`.

**Notable decisions:**
- Hand-rolled instead of `yo office` because Yeoman's interactive prompts
  hung non-interactively. Vite gives a faster dev loop than the Yeoman
  webpack default.
- `office-addin-dev-certs` for the trusted localhost cert.
- Baseline snapshot lives in **Office.js workbook settings** (custom XML
  part inside the .xlsx) so it persists across saves.
- Race fix: in dev mode Vite's deferred module loader can run main.tsx
  before the classic `<script>` for office.js executes →
  `ReferenceError: Office is not defined` → blank taskpane. Fixed by
  polling for the `Office` global in `src/main.tsx` before mounting React.

### Slice 3 — Excel writes back

**Ship:** `POST /submit` with delta list. Every cell validated against the
v1 hardcoded dim model (any unknown member → 400 INTERSECTION_INVALID,
all-or-nothing). SQLite `audit_log` table; per-cell row with
`submit_request_id`, `who`, `before/after` as **TEXT** (sqlite REAL is
lossy IEEE-754). Add-in: `detectDeltas` (pure), Fluent Dialog confirmation,
`/submit` POST.

**Atomicity model:** cube `bulk_insert` + audit append in nested
transactions. Audit commits FIRST (inner); cube commits SECOND (outer).
Failure modes:
- audit fail → cube hasn't committed → both rollback ✓
- cube fail after audit committed (rare) → ghost audit row pointing at a
  cube change that didn't land — recoverable; preferred over a silent
  cube change with no audit trail.

**Tests:** 56 backend, 13 add-in. New: audit store, submit validation,
submit endpoint integration (incl. atomicity test that mocks
`append_audit_rows` to raise and asserts cube unchanged), delta function.

**Key files:** `metadata/store.py`, `metadata/schema.sql`, `audit.py`,
`api/submit.py`, `schemas/submit.py`,
`add-in/src/excel/{baseline,delta,submit}.ts`.

**Notable gotchas:**
- SQLite `check_same_thread=False` required because FastAPI runs handlers
  on a worker thread different from the one that opened the connection.
- TestClient re-raises server exceptions by default — atomicity test uses
  `pytest.raises(RuntimeError)` around the `client.post` call rather than
  asserting a 500 status.

### Slice 4 — Hierarchies + read-time aggregation

**Ship:** `dim_member(dim, member, parent, rollup_op, ordinal)` table in
SQLite. In-memory `DimModel` (`is_known`, `is_leaf`, `get_leaves`). Pure
`query.py` with `expand_filters` (parent → leaves + back-mapping) and
`aggregate_to_requested` (group + **SUM-only** in v1). `/slice` validates
members against the model (typos → 400 MEMBER_UNKNOWN), expands parents,
queries cube at leaf level, then aggregates back. `/submit` rejects
non-leaf members.

**Tests:** 84 backend. New: dim_model + query unit tests; hierarchy
integration tests on /slice.

**Key files:** `metadata/dim_model.py`, `query.py`, `hierarchy_seed.py`.

**Demo hierarchy:**
- Account: `Total_PnL` → {`4000_Revenue`, `5000_OpEx`}
- Entity: `Worldwide` → {`E001_US`, `E002_UK`}
- Period: `2026-FY` → `2026-Q{1..4}` → months
- CostCenter / Scenario / Version: flat

**Breaking change:** typo in a slice filter member is now `400
MEMBER_UNKNOWN` instead of the silent empty result Slice 1 returned. Loud
failure on typos is the right thing for a finance tool.

### Slice 5 — Scenarios + versioning

**Ship:** `POST /scenarios/copy` with `{request_id, source: {scenario,
version}, target: {...}}`. Reads source via `cube.slice` (latest values
only, no edit history), appends at target with new `loaded_at`, audits each
copied cell. **Auto-registers new target members in `dim_member`** if they
don't yet exist.

**Tests:** 97 backend. New: copy creates dim_members, copies facts, audits,
re-copy is allowed (latest-wins), source unchanged, validation paths.

**Key files:** `api/scenarios.py`, `schemas/scenarios.py`.

**Notable decisions:**
- `get_dim_model` switched to **reload-on-each-call** (no cache) so the
  next request after a copy sees the new members.
- Re-copying over an edited target is allowed; the user loses those edits
  to the latest copy. Audit trail preserves the old before-values. Future
  slice may add a `--force` requirement.

### Slice 6 — Driver-based calc

**Ship:** `driver(account_id PK, formula, defined_at)` table. Hand-rolled
recursive-descent parser in `calc/parser.py` — `+ - * /`, parens,
identifiers, decimal literals. **No `eval`**. `CalcEngine` does cycle
detection (transitive closure on existing graph) + topo sort.
`POST /drivers/define` parses, cycle-checks, then materializes the new
driver's value at every `(entity, costcenter, period, scenario, version)`
tuple in the cube. `/submit` rejects writes to driver accounts and triggers
automatic recompute (in the same transaction) of any driver whose formula
transitively references a submitted account.

**Tests:** 145 backend, 13 add-in. New: parser (tokenizer, precedence,
unary, division-by-zero, references), engine (cycle, topo), drivers
endpoint (define + GET, recalc on submit, leaf-only check, cycle rejection).

**Key files:** `calc/parser.py`, `calc/engine.py`, `calc/recalc.py`,
`api/drivers.py`, `schemas/drivers.py`.

**Notable gotcha:** account ids like `4000_Revenue` start with digits.
Naive `IDENT = [A-Za-z_][A-Za-z0-9_]*` would split this into `NUMBER 4000`
+ `IDENT _Revenue`. Fix: order **IDENT before NUMBER** in the tokenizer
patterns and use `IDENT = [A-Za-z0-9_]*[A-Za-z_][A-Za-z0-9_]*` (must contain
at least one alpha/_). Pure numeric literals still fall through to NUMBER.

### Slice 7 — Excel UX polish

**Ship:** Two new read endpoints: `GET /dimensions/{dim}/members` (feeds
dropdowns) and `GET /drivers` (so the add-in can mark driver cells).
Add-in refactor: scenario + version pickers (Fluent Dropdowns); Refresh
sends those as filters; **Copy scenario** and **Define driver** collapsible
panels (Fluent Accordion) so you don't have to drop to curl. Driver-account
value cells get a gray fill on Refresh as a visual "this is computed"
signal. New `MemberPicker`, `CopyScenarioPanel`, `DefineDriverPanel`
components.

**Tests:** 154 backend, 16 add-in. New: dimensions endpoint, GET drivers,
driver-styling on refresh, cross-scenario delta isolation.

**Key files:** `api/dimensions.py`, `api/drivers.py` (extended),
`add-in/src/components/`, `add-in/src/App.tsx` (rewritten),
`add-in/src/excel/refresh.ts` (driverAccounts param + fill).

**Notable architecture fix found mid-slice:** `get_dim_model` and
`get_calc_engine` were calling `get_metadata()` directly instead of via
FastAPI's `Depends(get_metadata)`, so test overrides on `get_metadata`
didn't cascade. A submit test was leaking through to the user's actual
`metadata.sqlite` and seeing the OpEx driver from a previous demo, doubling
audit rows in an unrelated test. Fix: change both providers to use
`Depends(get_metadata)`.

---

## Architecture & invariants (the contract that binds every slice)

These are the rules every change must respect. They show up across multiple
files; SPEC.md is the canonical source.

### 1. Append-only cube
- `facts` is INSERT-only. Never UPDATE, never DELETE.
- Current value of any cell = the row with the latest `loaded_at` per
  `(account, entity, costcenter, period, scenario, version)`.
- All slice reads go through the `facts_current` view. Never raw `facts`.

### 2. Two orthogonal versionings
- **Time-versioning** (implicit, via `loaded_at`): edit history is
  queryable; latest wins.
- **Scenario/Version dim members** (explicit): independent timelines
  forked via `/scenarios/copy`. They do not interact.

### 3. Decimal-as-string on the wire
- DuckDB `DECIMAL(20,6)` → Pydantic `Decimal` → JSON **string** →
  TypeScript `string` (and `decimal.js` if you ever do client-side math).
- SQLite stores audit `before_value` / `after_value` as TEXT for the same
  reason (REAL is lossy double).

### 4. Pydantic is the source of truth for wire types
- `vena_lite.schemas` package — every BaseModel re-exported from
  `__init__.py`.
- `backend/scripts/generate_ts_types.py` runs `pydantic-to-typescript` and
  writes `add-in/src/types/generated.ts`.
- CI workflow `types-drift.yml` regenerates and fails on diff.
- Local pytest test `test_generated_ts_matches_committed` is the same gate;
  skipped if `json2ts` isn't installed locally.

### 5. Hierarchy = parent-child in `dim_member`; rollup is read-time
- Parents never have rows in `facts`.
- v1 honors **SUM only** as the rollup operator. `dim_member.rollup_op`
  accepts other values for forward compat but they're ignored.
- Slice queries that include parent members expand to leaves, query the
  cube, then aggregate.

### 6. Submit goes leaf-only, can't write to driver accounts
- Validation order in `/submit`: Pydantic shape → every cell's six dim
  members must be **known leaves** → driver-account check → write.
- Reasons surfaced in `INTERSECTION_INVALID`: `unknown`, `non_leaf`, `driver`.

### 7. Atomicity = nested transactions
- Pattern (used in `/submit` and `/scenarios/copy` and `/drivers/define`):
  ```python
  with cube.transaction():        # outer — commits last
      with audit.transaction():   # inner — commits first
          cube.bulk_insert(...)
          audit.append_audit_rows(...)
          # for /submit: also recalc_for_submit(...)
  ```
- Audit-commits-first deliberately: the small leak is "ghost audit row"
  (audit says we changed X but cube didn't), not "silent cube change".

### 8. Driver formulas: no `eval`, ever
- Tiny grammar: `+ - * /`, unary, parens, decimal literals, identifiers.
- Identifiers are leaf account ids (digit-prefixed allowed).
- Cycle detection at definition time (transitive closure).
- Recompute happens IN THE SAME TRANSACTION as the user submit. Formula
  failure rolls the whole submit back.
- Missing input fact → defaults to `Decimal(0)`.

### 9. Office.js perf: one batched range write + one sync per refresh
- `range.values = matrix` with the whole 2D array.
- Per-cell styling (driver gray fills) goes in the same `Excel.run` block
  — property writes are queued and flushed by the single `await context.sync()`.
- Iterating `cell.values = x` per cell is 100–1000× slower. Reject any PR
  that does it.

### 10. dim_model + calc_engine reload on every request
- Implemented via `Depends(get_metadata)` so test overrides cascade.
- Cheap at v1 scale (~30 dim members, a handful of drivers). Will need
  caching when the model grows.

---

## Operational runbook

### Starting Vena-lite (3 PowerShell windows in `C:\Users\pshur\my-app`)

**Window 1 — backend** (`uvicorn` with `--reload`):
```powershell
.\tasks.bat dev
```
Wait for `Uvicorn running on http://127.0.0.1:8000`.

**Window 2 — Vite dev server** (HTTPS via office-addin-dev-certs):
```powershell
cd add-in
npm run dev
```
Wait for `Local: https://localhost:3000/`.

**Window 3 — sideload + open Excel**:
```powershell
cd add-in
npm run start
```
Excel opens with the manifest sideloaded; Vena-lite taskpane appears on the
right.

### Common tasks

| Task | Command |
|---|---|
| Run backend tests | `cd backend && uv run pytest -q` |
| Backend coverage | `cd backend && uv run pytest --cov=vena_lite --cov-report=term-missing` |
| Backend lint | `cd backend && uv run ruff check .` (or `--fix`) |
| Run add-in tests | `cd add-in && npm test` |
| Regenerate TypeScript types | `cd backend && uv run python scripts/generate_ts_types.py` |
| Seed cube + dim_member (idempotent) | `cd backend && uv run python -m vena_lite.cli seed C:\Users\pshur\my-app\cube.duckdb C:\Users\pshur\my-app\metadata.sqlite` |
| Inspect audit log | `cd backend && uv run python -c "import sqlite3; c=sqlite3.connect('../metadata.sqlite'); c.row_factory=sqlite3.Row; print(*[dict(r) for r in c.execute('SELECT * FROM audit_log ORDER BY id DESC LIMIT 10')], sep='\n')"` |
| Inspect cube state via curl | `curl -X POST http://127.0.0.1:8000/slice -H "Content-Type: application/json" -d '{\"filters\":{}}'` |

### Stopping
Close Excel, then Ctrl+C in window 2, then Ctrl+C in window 1.

### Toolchain
- Python 3.12, `uv` 0.11+, Node.js 24 LTS, `npm` 11+, `git`.
- Globally installed npm: `json-schema-to-typescript` (provides `json2ts`,
  required by `pydantic-to-typescript`); `yo` + `generator-office` (legacy,
  unused — the add-in was hand-rolled), `office-addin-dev-certs`,
  `office-addin-debugging`.
- Office: Microsoft 365 Excel desktop at `C:\Program Files\Microsoft
  Office\root\Office16\EXCEL.EXE`. Office.js dev cert installed at
  `C:\Users\pshur\.office-addin-dev-certs\localhost.{crt,key}`.

### Windows ExecutionPolicy

Default Windows ExecutionPolicy blocks `.ps1` scripts. Two ways around it:
1. **One-time fix** (recommended for daily dev):
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Now `tasks.ps1`
   and `npm run dev` work directly.
2. **Wrapper** (no system change): `.\tasks.bat <task>` invokes
   `powershell -ExecutionPolicy Bypass -File tasks.ps1 <task>`.

---

## Test landscape

### Backend (pytest, 154 tests)

```
tests/
├── conftest.py                         # fixtures: cube_path, metadata_path,
│                                       #   empty_store, seeded_store,
│                                       #   metadata_store, hierarchy_seeded_metadata, dim_model
├── unit/
│   ├── test_cube_store.py              # 13 tests — slice correctness, decimal precision,
│   │                                   #   facts_current latest-wins, bulk_insert
│   ├── test_schemas.py                 # 9 tests — Pydantic round-trip, decimal-as-string
│   ├── test_dim_model.py               # 11 tests — is_known, is_leaf, get_leaves recursion
│   ├── test_query.py                   # 11 tests — expand_filters, aggregate_to_requested
│   ├── test_audit_store.py             # 8 tests — append, txn commit/rollback, persistence
│   ├── test_submit_validation.py       # 6 tests — Pydantic schemas for submit
│   ├── test_parser.py                  # 19 tests — tokenize, parse, evaluate, references
│   └── test_calc_engine.py             # 12 tests — would_cycle, affected_in_topo_order
└── integration/
    ├── test_slice_endpoint.py          # 13 tests — basic + hierarchy + 422/400 paths
    ├── test_submit_endpoint.py         # 12 tests — happy path + atomicity + reject paths
    ├── test_scenarios_endpoint.py      # 13 tests — copy + audit + dim_member create + recopy
    ├── test_drivers_endpoint.py        # 12 tests — define + cycle reject + recalc + GET
    ├── test_dimensions_endpoint.py     # 7 tests — leaf flags, parent links, 422
    └── test_types_drift.py             # 1 test — drift gate (skip if no json2ts)
```

### Add-in (jest, 16 tests)

```
src/__tests__/
├── refresh.test.ts                     # 6 tests — batched write, single sync,
│                                       #   string preservation, driver gray fill,
│                                       #   no-fills-when-no-drivers
└── delta.test.ts                       # 10 tests — identity, single delta, multi delta,
                                        #   blank=no-change, intersection-not-in-baseline,
                                        #   trim, cross-scenario isolation, etc.
```

### What's NOT tested
- End-to-end through Excel (no Playwright / Office headless).
- Backend perf at scale (cube > 100k rows).
- Long-running drift between backend uvicorn `--reload` and an open
  taskpane.
- Manual sideload variations (network shared folder, AppCatalog).

---

## Known gotchas (the things that bit during build)

These are mostly absorbed into code/comments, but worth flagging here:

1. **ExecutionPolicy** blocks `tasks.ps1` and `npm.ps1`. See above.
2. **`npm`-as-classic-script vs. `npm.cmd`** — when invoked from PowerShell
   programmatically, `npm.cmd` bypasses the .ps1 wrapper.
3. **Office.js + Vite race**: Vite's deferred module loader can run main.tsx
   before office.js has set the global. Polling pattern in `main.tsx`.
4. **SQLite thread-affinity**: FastAPI's threadpool means the request handler
   isn't on the same thread that opened the connection. `check_same_thread=False`
   is required.
5. **TestClient re-raises** server exceptions by default. Atomicity tests
   use `pytest.raises` around `client.post(...)`, not `assert r.status_code == 500`.
6. **`Depends(get_metadata)` cascade**: `get_dim_model` and
   `get_calc_engine` MUST take metadata via `Depends`, not by calling
   `get_metadata()` directly. Otherwise test overrides on `get_metadata`
   are ignored.
7. **Tokenizer ordering** for digit-prefixed account ids: IDENT before
   NUMBER, with IDENT regex requiring at least one non-digit char.
8. **`DimName` Literal collapses to `string`** in generated TS — JSON
   Schema can't express union-keyed dicts. Runtime safety is intact
   (Pydantic 422s), but TS compile-time narrowness is lost. Manual `type
   DimName = "account" | ...` could be hand-added at the top of
   `generated.ts` if you want it back.
9. **Initial computed count for drivers** = unique non-account
   intersections, not total cube row count. `144 = 48 × 3` if the cube has
   three (scenario, version) branches.
10. **Idempotency**: `/submit` and `/drivers/define` and `/scenarios/copy`
    do **not** dedupe by `request_id`. Re-submitting the same body twice
    creates two audit batches and two cube appends.

---

## Known limitations (what was deliberately out of scope)

These are the candidates for Phase 2 work. Each was flagged in SPEC.md
when it landed.

- **No auth.** Single-user, localhost only. The CORS origin list in
  `main.py` is the only access control.
- **No multi-user.** DuckDB single-writer constraint would also need a
  serialization queue or a different cube engine.
- **No remote deployment.** Localhost is hardcoded in CORS, manifest URL,
  and Vite proxy target.
- **SUM-only rollup.** Per-account `rollup_op` (`weighted_avg`, `last`,
  `first`) is in the schema but ignored.
- **No per-cell deletion.** Append-only by design; blank cell on submit =
  "no change".
- **No idempotency by request_id.** See gotcha #10.
- **No driver listing UI in Excel.** Just a hint text. `GET /drivers` is
  the source.
- **Driver formula language is intentionally tiny.** No `SUM`, `IF`,
  `MAX`, no cross-intersection refs (e.g. previous-period). Same-cell
  arithmetic only.
- **No edit history viewer in Excel.** Read `audit_log` directly via the
  inspect command in the runbook.
- **Forecast scenario is sparse vs. Actual.** One backend test
  (`test_submit_records_null_before_when_no_prior_fact`) is `pytest.skip`'d
  for this reason.
- **No FX translation, no comments on cells, no workflow/approval, no
  cell-level permissions.**

---

## Phase 2 — direction options

Four directions we considered (the user picked "polish UX" → became Slice 7;
the rest remain):

### A. Use it for real planning
Replace the demo seed (`4000_Revenue`, `5000_OpEx`, `E001_US`, etc.) with
the user's actual chart of accounts, entities, and cost centers. Define
real drivers (`TotalComp = Headcount * AvgSalary * (1+Benefits)`).
Multi-year periods. **Most personal-value direction.** Needs: a
seed-importer (CSV → cube?), real hierarchy with depth, more period
granularity (FY24 vs FY26 vs FY27).

### B. Continue UX polish
Audit-log viewer in the taskpane. Filter UI for accounts/entities/periods.
Driver editing / deletion. Account-level styling beyond just driver gray.
Persist selected scenario/version across workbook reopens (Office.js
Settings — same pattern as the baseline).

### C. Harden for sharing
Auth (probably OAuth via Microsoft Identity Platform since we're already
in Office). Backend HTTPS so the Vite proxy isn't needed in prod. Single-
command launcher (or installer) so the user doesn't manage 3 PowerShell
windows. Automated backups for cube + metadata. Request logging +
metrics. **Largest scope — meaningful only if you intend to ship.**

### D. Rigor / quality
Playwright end-to-end through Excel. Property-based tests for the parser
(`hypothesis`). Backend perf benchmarks at 1M+ row scale. Mutation testing
on the calc engine.

The natural progression: A first (makes the tool real for you), then B
(removes UX paper-cuts you'll find using it for real), then C only if you
want to share it.

---

## Critical reading list (for anyone picking this up)

In order:

1. [`SPEC.md`](../../SPEC.md) — the domain contract. Every slice's
   semantics live here.
2. [`CLAUDE.md`](../../CLAUDE.md) — the "never do this" list and entry
   points.
3. [`backend/src/vena_lite/main.py`](../../backend/src/vena_lite/main.py) —
   wires everything; one-screen overview of all routes.
4. [`backend/src/vena_lite/cube/store.py`](../../backend/src/vena_lite/cube/store.py)
   and [`backend/src/vena_lite/cube/schema.sql`](../../backend/src/vena_lite/cube/schema.sql)
   — the cube layer.
5. [`backend/src/vena_lite/api/submit.py`](../../backend/src/vena_lite/api/submit.py)
   — the most invariant-heavy endpoint; demonstrates the nested-transaction
   pattern + driver recalc orchestration.
6. [`backend/src/vena_lite/calc/parser.py`](../../backend/src/vena_lite/calc/parser.py)
   + [`backend/src/vena_lite/calc/engine.py`](../../backend/src/vena_lite/calc/engine.py)
   — the formula language and dependency graph.
7. [`add-in/src/App.tsx`](../../add-in/src/App.tsx) — taskpane shell;
   shows how all the add-in pieces fit.
8. [`add-in/src/excel/refresh.ts`](../../add-in/src/excel/refresh.ts) —
   the Office.js batching pattern.

Once you've read those, run `cd backend && uv run pytest -q` and
`cd add-in && npm test` to confirm everything's green, then start the demo
per the runbook.
