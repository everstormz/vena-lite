# Vena-lite — repo context

Lightweight single-user financial planning tool. Excel front-end (Office.js,
Slice 2+), FastAPI + DuckDB backend. Read SPEC.md before any nontrivial change
— it is the domain contract.

## Stack
- Backend: Python 3.11+, FastAPI, Pydantic v2, DuckDB (cube), SQLite (metadata, Slice 4+)
- Add-in: Office.js + Vite + React 19 + TypeScript + Fluent UI v9 (hand-rolled, not Yeoman)
- Calc: hand-rolled formula parser + CalcEngine (no `eval`); pure functions over Decimal
- Tests: pytest (backend, 192), Jest with ts-jest (add-in, 91)

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
- Don't reuse a `facts.source` prefix for a different kind (Slice 11).
  The vocabulary is `seed`, `submit:`, `copy:`, `driver:initial:`,
  `driver:`, `override:`, `driver:released:`. `cube.lookup_overrides`
  matches on `LIKE 'override:%'` exactly — adding a new
  override-flavored prefix breaks the recalc skip-logic.
- Don't use relative URLs in `add-in/public/functions.js` (Slice 11).
  Excel's custom-functions runtime is a Web Worker whose origin is
  `blob:`, so `fetch("/api/...")` returns "Network request failed."
  Hardcode `https://localhost:3000/api/...`.
- Don't use `null` for axis state anymore (Slice 10). `AxisSpec =
  { rows: DimName[]; cols: DimName[] }` replaces the
  null-or-string sentinel. Long-format = both empty arrays. The
  pipe character `|` is reserved as the tuple-key delimiter — no
  member id may contain it.
- Don't bump `Version` in `manifest.xml` below `1.0.0.0` (Slice 11).
  `office-addin-manifest validate` rejects sub-1.0 as "version too
  low." Always run the validator before sideloading manifest changes.
- Don't write to the cube via /submit at a driver-controlled account
  (Slice 6 invariant). Use POST /overrides instead (Slice 11). The
  /submit validator returns 400 INTERSECTION_INVALID with reason
  `driver`.
- Don't call `compute_driver_cells` directly without passing the
  precomputed `overrides` set (Slice 11). The wrappers
  `recalc_for_submit` and `recalc_for_initial_define` fetch the set
  via `cube.lookup_overrides` once per batch — call those, not the
  inner function.

## Useful entry points
### Backend
- `backend/src/vena_lite/main.py` — FastAPI app (CORS allows GET/POST/PATCH/DELETE/OPTIONS for the add-in)
- `backend/src/vena_lite/api/deps.py` — shared dependency providers (dim_model + calc_engine reload-on-each-call)
- `backend/src/vena_lite/api/slice.py` — POST /slice
- `backend/src/vena_lite/api/submit.py` — POST /submit (validation + atomic write)
- `backend/src/vena_lite/api/scenarios.py` — POST /scenarios/copy
- `backend/src/vena_lite/api/drivers.py` — POST /drivers/define + GET /drivers + DELETE /drivers/{account} (Slice 9)
- `backend/src/vena_lite/api/dimensions.py` — GET + POST + PATCH + DELETE on /dimensions/{dim}/members (Slice 9 CRUD)
- `backend/src/vena_lite/api/overrides.py` — POST + DELETE on /overrides (Slice 11)
- `backend/src/vena_lite/api/values.py` — GET /value, single-cell lookup for `=VENA.LOOKUP` (Slice 11)
- `backend/src/vena_lite/cube/store.py` — cube reads/writes (transaction context); `lookup_overrides` (Slice 11)
- `backend/src/vena_lite/cube/schema.sql` — DuckDB DDL + facts_current view
- `backend/src/vena_lite/metadata/store.py` — SQLite store; `_apply_migrations` is the additive-migration helper
- `backend/src/vena_lite/metadata/schema.sql` — audit_log + dim_member + driver DDL (fresh installs only)
- `backend/src/vena_lite/metadata/dim_model.py` — in-memory hierarchy queries; public `lookup(dim, member)` (Slice 9)
- `backend/src/vena_lite/audit.py` — `build_audit_rows` + `build_dim_change_audit_row` + `build_driver_change_audit_row` + `build_override_release_audit_rows` (Slice 11)
- `backend/src/vena_lite/schemas/` — Pydantic source of truth for wire types
- `backend/src/vena_lite/seed.py` — Slice 1 demo data (cube facts; leaf members)
- `backend/src/vena_lite/hierarchy_seed.py` — Slice 4 demo hierarchy
- `backend/src/vena_lite/query.py` — pure expand_filters + aggregate_to_requested
- `backend/src/vena_lite/calc/parser.py` — formula tokenizer + AST + parse_formula
- `backend/src/vena_lite/calc/engine.py` — CalcEngine: cycle check + topo sort
- `backend/src/vena_lite/calc/recalc.py` — driver recompute orchestration; `compute_driver_cells` honors the override set (Slice 11)

### Add-in
- `add-in/src/App.tsx` — taskpane UI; mounts four accordion panels (Copy / Define / Manage dimensions / Override cell). `triggerWorkbookRecalc` after Submit forces `=VENA.LOOKUP` to refetch (Slice 11). `autoFillDefaults` pre-picks first leaf for each non-axis dim on first load (Slice 10)
- `add-in/src/types/dims.ts` — canonical narrow `DimName` union + `DIM_NAMES` constant
- `add-in/src/excel/axes.ts` — pure `AxisSpec` helpers: `tupleKey`, `parseTuple`, `pageFilterDims`, `laneOf`, `moveDim`, `reorderInLane` (Slice 10)
- `add-in/src/excel/refresh.ts` — Office.js batched range write; multi-axis aware (Slice 10)
- `add-in/src/excel/pivot.ts` — pure multi-axis pivot transform; pipe-delimited tuple keys (Slice 10); no Office.js
- `add-in/src/excel/filters.ts` — Office Settings persistence (key `vena_lite.filters.v2`); v1→v2 in-place migration (Slice 10)
- `add-in/src/excel/baseline.ts` — Office Settings snapshot for delta detection
- `add-in/src/excel/delta.ts` — pure delta detection
- `add-in/src/excel/submit.ts` — Office.js read-current-values; multi-axis `LayoutDescriptor` (Slice 10)
- `add-in/src/excel/dim_tree.ts` — shared `buildTree` + `memberLabel*` helpers (Slice 9)
- `add-in/src/excel/cell_address.ts` — `intersectionAtCell` for OverridePanel (Slice 11); pure
- `add-in/src/api/client.ts` — typed fetch wrapper; helpers per HTTP verb (postJson/patchJson/deleteJson/deleteJsonWithBody for Slice 11 release)
- `add-in/src/components/MemberPicker.tsx` — single-select; renders `display_name ?? id`
- `add-in/src/components/MultiMemberPicker.tsx` — multi-select with depth-indent (Slice 8)
- `add-in/src/components/AxisDesigner.tsx` — three drag-drop lanes (Rows/Columns/Page); `@dnd-kit/sortable` (Slice 10). Replaces AxisPicker + FilterStrip
- `add-in/src/components/CopyScenarioPanel.tsx` — Slice 5 scenario copy UI
- `add-in/src/components/DefineDriverPanel.tsx` — Slice 6 define + Slice 9 undefine
- `add-in/src/components/DimensionManagerPanel.tsx` — Slice 9 dim CRUD UI
- `add-in/src/components/OverridePanel.tsx` — Slice 11 override SET / RELEASE UI
- `add-in/public/functions.js` — plain-JS `=VENA.LOOKUP` implementation (Slice 11). Absolute URLs only (Web Worker context)
- `add-in/public/functions.html` — custom-functions runtime page (Slice 11)
- `add-in/public/functions.json` — Office Custom Functions metadata (Slice 11)
- `add-in/manifest.xml` — sideloaded into Excel; V1_0 non-shared CustomFunctions ExtensionPoint (Slice 11). Run `npx office-addin-manifest validate manifest.xml` after edits
- `add-in/vite.config.ts` — HTTPS dev server + /api proxy to backend; `host: true` + `strictPort: true` (Slice 10)

### Project
- `SPEC.md` — domain contract
- `.claude/docs/phase-1-handoff.md` — Phase 1 architecture (Slices 1–7)
- `.claude/docs/phase-2-handoff.md` — Phase 2 architecture (Slices 8–9)
- `.claude/docs/phase-3-handoff.md` — Phase 3 architecture (Slices 10–11)
- `tasks.ps1` (Windows) / `Makefile` (Linux/Mac/CI) — workflow entry points

## Current state
Phase 1 (Slices 1–7), Phase 2 (Slices 8–9), and Phase 3 (Slices 10–11)
shipped. The taskpane is a Vena/Anaplan-style report builder: three
drag-drop lanes (Rows/Columns/Page) via `@dnd-kit/sortable` with
multi-dim axis stacking, plus per-dim member pickers, a client-side
pivot rendered in one batched range write, and four accordion panels
(Copy / Define / Manage dimensions / Override cell). The dim model is
editable from the taskpane with an alias layer (mutable
`display_name`, immutable `member_id`). Drivers can be undefined;
prior computed facts stay (append-only). Single driver-cells can be
manually overridden; the override sticks through subsequent recalcs
until released.

Excel custom function `=VENA.LOOKUP(account, entity, costcenter,
period, scenario, version)` is registered via the manifest's
CustomFunctions ExtensionPoint (V1_0 non-shared runtime). It hits a
new `GET /value` endpoint. The function body lives in
`add-in/public/functions.js` as plain JS (no TS bundling so the URL
is stable). The Excel custom-functions runtime is a Web Worker, so
the function uses absolute URLs.

Cube `source` vocabulary now discriminates seven kinds: `seed`,
`submit:`, `copy:`, `driver:initial:`, `driver:`, `override:`,
`driver:released:`. `cube.lookup_overrides` filters on
`source LIKE 'override:%'` so released cells are no longer flagged.
Recalc precomputes the override set per batch and skips overridden
intersections, leaving the manual override as the current value.

Audit log is a single table — `source` discriminates kinds (`submit`,
`copy`, `driver:initial`, `driver`, `dim_change`, `driver_change`,
`override`). The `details` TEXT column holds kind-specific JSON for
non-submit rows (`override` SET = NULL, `override` RELEASE =
`{"action":"release"}`). `AuditRow` is a 12-element tuple; constructors
live in `audit.py`.

Schema migrations are additive and idempotent: `_apply_migrations` in
`metadata/store.py` introspects `PRAGMA table_info` and runs `ALTER TABLE`
for missing columns. Fresh installs hit the (updated) `CREATE TABLE` in
`schema.sql`. The cube has NO migration helper (Slice 11 used a source
sentinel to avoid adding one).

Persisted filter state is at v2 (`vena_lite.filters.v2`); v1 is read on
first load for one-shot upgrade. Schema is `{filters, axes: { rows:
DimName[], cols: DimName[] }}` — no more null-sentinels.

Formula language is intentionally tiny: `+ - * /`, parens, identifiers
(including digit-prefixed account ids like `4000_Revenue`), decimal literals.
The tokenizer puts IDENT before NUMBER so `4000_Revenue` is one token, not
NUMBER + bad partial IDENT. Cycle detection happens at definition time via
transitive closure on the existing dependency graph. Formulas reference
`member_id`, never `display_name`.

Read `.claude/docs/phase-3-handoff.md` for Phase 3 deltas (Slice 10 +
Slice 11 architecture, decisions, invariants, gotchas); read
`.claude/docs/phase-2-handoff.md` for Phase 2 (Slices 8–9); read
`.claude/docs/phase-1-handoff.md` for the original Phase 1 baseline
(Slices 1–7).
