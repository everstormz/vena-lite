# Vena-lite — repo context

Lightweight single-user financial planning tool. Excel front-end (Office.js,
Slice 2+), FastAPI + DuckDB backend. Read SPEC.md before any nontrivial change
— it is the domain contract.

## Stack
- Backend: Python 3.11+, FastAPI, Pydantic v2, DuckDB (cube), SQLite (metadata, Slice 4+)
- Add-in: Office.js + Vite + React 19 + TypeScript + Fluent UI v9 (hand-rolled, not Yeoman)
- Calc: hand-rolled formula parser + CalcEngine (no `eval`); pure functions over Decimal
- Tests: pytest (backend, 192), Jest with ts-jest CJS preset (add-in, 124)

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
- Don't pass bare numbers to Griffel `makeStyles` CSS values
  (Phase 4). `padding: 2` is a type error — use `padding: "2px"`
  or a Fluent token (`tokens.spacingHorizontalXS`). Phase 4 hit this
  several times; the pattern is now consistent across components.
- Don't switch the Jest preset back to ESM (Phase 4). It's
  `ts-jest/presets/default` (CJS) so Jest's resolver picks Fluent's
  `lib-commonjs` bundles via `package.json` `main`. ESM mode tripped
  on transitive `@fluentui/react-icons/lib/providers` imports.
  `add-in/jest.setup.cjs` polyfills `ResizeObserver`,
  `IntersectionObserver`, and `matchMedia` — required for any test
  that renders a Fluent component.
- Don't switch hierarchy-drill traversal from post-order to
  pre-order (Phase 4) without first verifying Office.js can set
  `summaryRowsBelow = false`. Excel's default is "summary below
  detail" and Office.js doesn't expose the toggle, so post-order
  (descendants above parent) is what puts the +/− gutter icon on
  the parent row.
- Don't drop the 8× `range.ungroup("ByRows")` cleanup in
  `refresh.ts` (Phase 4). It wipes leftover outline groups so
  toggling drill off → on → off doesn't accumulate stale grouping.
- Don't use the two-click "Click again to confirm" delete pattern
  for new destructive actions (Phase 4). Use `<ConfirmDialog/>`
  from `add-in/src/components/ConfirmDialog.tsx` — it's the
  canonical shape and replaces the old patterns in
  `DimensionManagerPanel` and `DefineDriverPanel`.
- Don't bypass `<StatusBar/>` (Phase 4) by rendering panel-internal
  `<Text className={styles.error}>`. Use the shared `Status` type
  from `StatusBar.tsx`.
- Don't reinvent the 6-dim picker (Phase 4). Use
  `<IntersectionPicker/>` from
  `add-in/src/components/IntersectionPicker.tsx`. It's leaves-only
  + controlled.
- Don't try to drill on a stacked or col axis (Phase 4 v1
  limitation). `<DrillToggle/>` requires `axes.rows.length === 1`.
  Stacked-axis drill is ambiguous (which dim's hierarchy first?)
  and out of scope. Cols drill is symmetric to rows but adds a
  second axis-grouping computation in pivot/refresh.
- Don't persist `drillRows` state to Office Settings without bumping
  filters to v3 (Phase 4). Today drill is React-only. Schema bump
  + v2 → v3 migration must land together.

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
- `add-in/src/App.tsx` — taskpane shell. Sticky header + sticky toolbar + accordion (Layout / Scenarios / Drivers / Dimensions / Cell tools). Cell tools is a sub-accordion: Add a cell / Insert =VENA.LOOKUP / Override (Phase 4). `drillRows` state + filter expansion via `expandToSubtree` on Refresh (Phase 4). `triggerWorkbookRecalc` after Submit forces `=VENA.LOOKUP` to refetch (Slice 11). `autoFillDefaults` pre-picks first leaf for each non-axis dim on first load (Slice 10)
- `add-in/src/types/dims.ts` — canonical narrow `DimName` union + `DIM_NAMES` constant
- `add-in/src/excel/axes.ts` — pure `AxisSpec` helpers: `tupleKey`, `parseTuple`, `pageFilterDims`, `laneOf`, `moveDim`, `reorderInLane` (Slice 10)
- `add-in/src/excel/hierarchy.ts` — pure drill helpers (Phase 4): `subtreePostOrder`, `depthsFromRoots`, `expandToSubtree`, `groupingRanges`. No Office.js
- `add-in/src/excel/refresh.ts` — Office.js batched range write; multi-axis aware (Slice 10); applies `range.group("ByRows")` + 8× `ungroup` cleanup for hierarchy drill (Phase 4)
- `add-in/src/excel/pivot.ts` — pure multi-axis pivot transform; pipe-delimited tuple keys (Slice 10); `AxisHierarchy` + `PivotOpts` + `rowDepths` for drill (Phase 4); no Office.js
- `add-in/src/excel/filters.ts` — Office Settings persistence (key `vena_lite.filters.v2`); v1→v2 in-place migration (Slice 10). Drill state intentionally NOT persisted (Phase 4)
- `add-in/src/excel/baseline.ts` — Office Settings snapshot for delta detection
- `add-in/src/excel/delta.ts` — pure delta detection
- `add-in/src/excel/submit.ts` — Office.js read-current-values; multi-axis `LayoutDescriptor` (Slice 10); `.trim()` on row labels handles drill indent (Phase 4)
- `add-in/src/excel/dim_tree.ts` — shared `buildTree` + `memberLabel*` helpers (Slice 9)
- `add-in/src/excel/cell_address.ts` — `intersectionAtCell` for OverridePanel (Slice 11); pure
- `add-in/src/api/client.ts` — typed fetch wrapper; helpers per HTTP verb (postJson/patchJson/deleteJson/deleteJsonWithBody for Slice 11 release)
- `add-in/src/components/AppHeader.tsx` — Phase 4 sticky title + scenario/version chips + Settings placeholder
- `add-in/src/components/AppToolbar.tsx` — Phase 4 sticky Refresh + Submit buttons; consolidated validation caption
- `add-in/src/components/StatusBar.tsx` — Phase 4 unified status sink wrapping Fluent `MessageBar`; canonical `Status` type
- `add-in/src/components/SectionHeader.tsx` — Phase 4 icon + label + count for accordion headers
- `add-in/src/components/ConfirmDialog.tsx` — Phase 4 canonical destructive-action UI; replaces two-click delete patterns
- `add-in/src/components/EmptyState.tsx` — Phase 4 empty-list / no-cell-inspected placeholder
- `add-in/src/components/IntersectionPicker.tsx` — Phase 4 canonical 6-dim picker (leaves only); controlled component used by Quick Add + Insert Lookup
- `add-in/src/components/QuickAddPanel.tsx` — Phase 4 Cell tools sub-section: pick + write a single cell via `/submit`, no Refresh/baseline needed
- `add-in/src/components/InsertLookupPanel.tsx` — Phase 4 Cell tools sub-section: build a `=VENA.LOOKUP(...)` formula and insert into selected cell or copy to clipboard
- `add-in/src/components/MemberPicker.tsx` — single-select; renders `display_name ?? id`
- `add-in/src/components/MultiMemberPicker.tsx` — multi-select with depth-indent (Slice 8)
- `add-in/src/components/AxisDesigner.tsx` — three drag-drop lanes (Rows/Columns/Page); chip drag handle + ✕ remove (Phase 4); `@dnd-kit/sortable` (Slice 10); `<DrillToggle/>` Switch for hierarchy drill (Phase 4)
- `add-in/src/components/CopyScenarioPanel.tsx` — Slice 5 scenario copy UI; From → To layout (Phase 4)
- `add-in/src/components/DefineDriverPanel.tsx` — Slice 6 define + Slice 9 undefine; Phase 4 inline account creation (auto-creates as root-level leaf if id is new) + smart hint badges
- `add-in/src/components/DimensionManagerPanel.tsx` — Slice 9 dim CRUD UI; Phase 4 inline edit form replaced with proper `<Dialog/>`, depth-based indent instead of NBSP, add-member sub-Accordion
- `add-in/src/components/OverridePanel.tsx` — Slice 11 override SET / RELEASE UI; Phase 4 Overridden / Driver `<Badge/>` + EmptyState before inspect
- `add-in/public/functions.js` — plain-JS `=VENA.LOOKUP` implementation (Slice 11). Absolute URLs only (Web Worker context)
- `add-in/public/functions.html` — custom-functions runtime page (Slice 11)
- `add-in/public/functions.json` — Office Custom Functions metadata (Slice 11)
- `add-in/manifest.xml` — sideloaded into Excel; V1_0 non-shared CustomFunctions ExtensionPoint (Slice 11). Run `npx office-addin-manifest validate manifest.xml` after edits
- `add-in/vite.config.ts` — HTTPS dev server + /api proxy to backend; `host: true` + `strictPort: true` (Slice 10)
- `add-in/jest.config.cjs` — Phase 4 CJS preset; Fluent UI's `lib-commonjs` resolves naturally
- `add-in/jest.setup.cjs` — Phase 4 jsdom polyfills (`ResizeObserver`, `IntersectionObserver`, `matchMedia`)

### Project
- `SPEC.md` — domain contract
- `.claude/docs/phase-1-handoff.md` — Phase 1 architecture (Slices 1–7)
- `.claude/docs/phase-2-handoff.md` — Phase 2 architecture (Slices 8–9)
- `.claude/docs/phase-3-handoff.md` — Phase 3 architecture (Slices 10–11)
- `.claude/docs/phase-4-handoff.md` — Phase 4 architecture (UI polish + hierarchy drill)
- `tasks.ps1` (Windows) / `Makefile` (Linux/Mac/CI) — workflow entry points

## Current state
Phase 1 (Slices 1–7), Phase 2 (Slices 8–9), Phase 3 (Slices 10–11),
and Phase 4 (UI polish + hierarchy drill) shipped. The taskpane is a
Vena/Anaplan-style report builder with a sticky header + toolbar and
five icon-led accordion sections (Layout / Scenarios / Drivers /
Dimensions / Cell tools). Layout has three drag-drop lanes
(Rows/Columns/Page) via `@dnd-kit/sortable` with multi-dim axis
stacking, plus a "Drill into row hierarchy" Switch that uses Excel's
native row outline gutter for +/− interaction (Phase 4). Cell tools
is a sub-accordion with three sub-sections: Add a cell (single-cell
write via `/submit`, no Refresh needed), Insert =VENA.LOOKUP formula
(builds + writes into selected cell or clipboard), and Override (the
Slice 11 single-cell override flow).

The dim model is editable from the taskpane with an alias layer
(mutable `display_name`, immutable `member_id`). The Drivers panel
auto-creates new accounts inline if the typed id doesn't exist —
typing `Profit_Margin` in a fresh field creates it as a root-level
leaf and defines the formula in one click (Phase 4). Drivers can be
undefined; prior computed facts stay (append-only). Single
driver-cells can be manually overridden via Cell tools → Override;
the override sticks through subsequent recalcs until released.

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

Hierarchy drill (Phase 4) is single-axis-rows only and entirely
client-side: when toggled on, App.tsx expands the row dim's filter
to include each selected member's full subtree
(`expandToSubtree`), the `/slice` response includes rolled-up
parent rows + per-leaf rows, pivot.ts emits them post-order
(descendants above parent, indented) with a `rowDepths` array, and
refresh.ts calls `range.group("ByRows")` per outline level so the
user gets Excel's native +/− gutter on parent rows. State lives in
the .xlsx outline (free persistence on save); the React drill
toggle is intentionally not persisted.

Phase 4 also shipped a shared component vocabulary that future
panels should reuse: `<AppHeader/>`, `<AppToolbar/>`,
`<StatusBar/>`, `<SectionHeader/>`, `<ConfirmDialog/>`,
`<EmptyState/>`, `<IntersectionPicker/>`. The Jest preset switched
from ESM to CJS so React component tests can render Fluent UI
without `moduleNameMapper` hacks; `jest.setup.cjs` provides jsdom
polyfills for `ResizeObserver`, `IntersectionObserver`, and
`matchMedia`. New dep: `@fluentui/react-icons`.

Read `.claude/docs/phase-4-handoff.md` for Phase 4 deltas (UI
polish + drill architecture, decisions, invariants, gotchas);
`.claude/docs/phase-3-handoff.md` for Phase 3 (Slice 10 + Slice
11); `.claude/docs/phase-2-handoff.md` for Phase 2 (Slices 8–9);
`.claude/docs/phase-1-handoff.md` for the original Phase 1
baseline (Slices 1–7).
