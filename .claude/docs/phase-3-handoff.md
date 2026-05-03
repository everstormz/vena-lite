# Vena-lite — Phase 3 handoff

**Status:** Phase 3 complete. Two slices shipped on top of Phase 2: **Slice
10** (multi-axis pivot UX with drag-drop axis composition) and **Slice 11**
(Excel custom function `=VENA.LOOKUP` + per-intersection driver overrides).
**192 backend tests + 91 add-in tests passing**, ruff clean, Pydantic ↔
TypeScript drift gate green. Single-user, localhost only.

Read this after [`phase-1-handoff.md`](phase-1-handoff.md) and
[`phase-2-handoff.md`](phase-2-handoff.md). Phase 3 is a delta on top.

---

## TL;DR

Phase 2 shipped a single-axis pivot taskpane with dim manager + driver
lifecycle. Two gaps remained:

1. The pivot was one row dim × one col dim. Real planners stack dims
   (Account × CostCenter on rows, Period × Scenario on cols).
2. Driver-controlled accounts were strictly read-only via `/submit`. There
   was no escape hatch for the one-off "I want this specific cell to be
   X regardless of the formula" override that every Vena/Anaplan user
   reaches for. And there was no way to pull a single cube value into a
   spreadsheet cell elsewhere in the workbook.

Phase 3 closed both:

- **Slice 10** turned the taskpane into a Vena/Anaplan-style report
  builder: three lanes (Rows / Columns / Page) with drag-drop dim chips
  via `@dnd-kit/core`, multi-row/column header stacking, a one-shot
  filter-state migration to v2, and auto-filled page-filter defaults so
  Refresh works out of the box.
- **Slice 11** added two complementary capabilities: (a) `=VENA.LOOKUP(...)`
  Excel custom function backed by a new `GET /value` endpoint, and (b)
  per-intersection driver overrides via `POST/DELETE /overrides`. The
  override is encoded in the existing `source` column (no cube schema
  migration); recalc skips overridden intersections; the override ↔
  release lifecycle round-trips through the new `OverridePanel`
  accordion item.

The big architectural moves: AxisSpec replacing the
single-axis-or-null sentinel pattern; pipe-delimited tuple keys for the
multi-axis pivot's cellMap; source-sentinel approach for overrides; and
plain-JS `public/functions.js` as the custom-function implementation
(rejected: TypeScript bundled by Vite — the hashed filename broke the
manifest's stable Script URL).

---

## What was built

### Slice 10 — Multi-axis pivot UX (drag-drop axis composition)

**Ship:** the two single-select `AxisPicker`s + the always-visible
`FilterStrip` are gone. Replaced by a single `AxisDesigner` with three
sortable lanes (Rows / Columns / Page) and per-dim member pickers
underneath. Dims drag between lanes via `@dnd-kit/sortable`. The pivot
extends to multi-dim row tuples and multi-dim col tuples, with stacked
col-header rows above the data block. Backend zero-touch — `/slice`
already accepted arbitrary multi-dim filters and aggregated parents.
Persisted state migrates v1 → v2 in-place on first load.

**Tests:** 154 → 192 backend (+0 in Slice 10 — no backend changes;
+38 in Slice 11), 51 → 91 add-in (+40 in Slice 10: axes 18, pivot
stacked-axis 4, filters v1→v2 8, submit stacked 3, refresh stacked 3,
overrides cell-address 6 — Slice 11; +ten more from earlier passes).

**Key files:**

Add-in:
- [`add-in/src/excel/axes.ts`](../../add-in/src/excel/axes.ts) — pure
  helpers: `AxisSpec`, `tupleKey`, `parseTuple`, `pageFilterDims`,
  `laneOf`, `moveDim`, `reorderInLane`. Exhaustively unit-tested.
- [`add-in/src/excel/pivot.ts`](../../add-in/src/excel/pivot.ts) —
  rewritten to take `axes: AxisSpec` instead of `rowAxis | null`,
  `colAxis | null`. Stacked tuples, `cellMap` keyed on
  `"${rowKey}||${colKey}"` (double-pipe between axes; single-pipe
  inside). `headerRowCount` returned for refresh's bold range.
- [`add-in/src/excel/refresh.ts`](../../add-in/src/excel/refresh.ts) —
  signature change to `axes: AxisSpec`. Bolds rows
  `[0, headerRowCount)` as a single range. ONE batched range write +
  ONE `await context.sync()` invariant intact.
- [`add-in/src/excel/submit.ts`](../../add-in/src/excel/submit.ts) —
  `LayoutDescriptor` shape change. Reads multi-row col headers to
  reconstruct col tuples; reads multi-col row labels to reconstruct
  row tuples. Long-format (both axes empty) preserved.
- [`add-in/src/excel/filters.ts`](../../add-in/src/excel/filters.ts) —
  v1 → v2 schema with one-shot in-place migration. Office Settings key
  bumped to `vena_lite.filters.v2`. v1 key untouched on read so a
  downgrade still works. `axes` replaces `rowAxis`/`colAxis`.
- [`add-in/src/components/AxisDesigner.tsx`](../../add-in/src/components/AxisDesigner.tsx)
  — three SortableContext lanes; `useDroppable` on the lane container
  for empty-lane drops; `useSortable` chips with drag handles. Below
  the lanes, a stack of MultiMemberPickers — one per dim.
- [`add-in/src/App.tsx`](../../add-in/src/App.tsx) — replaced two
  `AxisPicker`s + `FilterStrip` with `<AxisDesigner />`. Added
  `autoFillDefaults` on first dropdown load so page-filter dims get
  pre-picked and Refresh enables out of the gate. Added
  `triggerWorkbookRecalc` after Submit so `=VENA.LOOKUP` cells refetch.

Deleted:
- `add-in/src/components/AxisPicker.tsx`
- `add-in/src/components/FilterStrip.tsx`

Dependencies:
- `@dnd-kit/core: ^6.3.0`
- `@dnd-kit/sortable: ^8.0.0`
- `@dnd-kit/utilities: ^3.2.2`

**Notable decisions:**

- **`AxisSpec = { rows: DimName[]; cols: DimName[] }`** replaces the
  null-sentinel pattern. Long-format = both empty. Single-axis = one
  element. Stacked = multi-element. Cleaner than scattered
  `rowAxis === null` checks.
- **Pipe-delimited tuple keys.** `tupleKey([])` for blank tuples,
  `"4000_Revenue"` for single, `"4000_Revenue|CC100_Sales"` for
  stacked. CellMap key joins on `||` between the two axes' tuples.
  Document the invariant: **no member id may contain `|`** (none do
  today; tighten the picker layer if that ever changes).
- **One batched range write + one `context.sync()` per Refresh stays
  sacred.** Multi-row headers grow the matrix vertically, but it's
  still ONE 2D array written via `range.values =`. Driver gray-fills
  + bold range queue alongside, flush in the lone sync.
- **Drag-drop semantics:** drop a chip on a chip in the same lane =
  reorder; drop on a chip in another lane = move (append at target's
  index); drop on an empty lane area = move-to-end. Implemented with
  `closestCenter` collision detection. Pure mutation logic
  (`moveDim`, `reorderInLane`) lives in `axes.ts` and IS unit-tested;
  the JSX orchestration in `AxisDesigner.tsx` is not (matches the
  Slice 9 DimensionManagerPanel pattern).
- **Filter-state v1 → v2 migration:** `parseFilterState` detects v1 by
  the absence of `axes`/`version` field and presence of `rowAxis`/
  `colAxis`. Migrates inline: string → `[string]`, null → `[]`.
  Idempotent on v2 input. `loadFilterState` falls back to the v1 key
  on first load if v2 is empty (handles the upgrade path on workbooks
  saved with Phase 2).
- **`autoFillDefaults` in App.tsx** — on first load, any non-axis dim
  with no filter selection gets pre-filled with its first leaf member.
  Closes the cold-start UX gap where Refresh was grayed out by default.
  Only fills empties; never overrides user picks.
- **Stacked col-header layout.** With `cols.length` col-axis dims,
  there are `cols.length` col header rows. The LAST col header row
  also carries the row-dim names in the row-label columns (matches
  Slice 8's `[rowAxis, ...colMembers]` for the single-axis case).
- **Driver gray-fill generalizes** to: account in `rows` → fill the
  whole data row of any driver-account row tuple; account in `cols`
  → fill the whole data column of any driver-account col tuple;
  account in `pageFilters` → fill the whole data block (Slice 8
  behavior). Helper `computeDriverFills` factored out of pivot.ts'
  buildPivotMatrix.
- **`vite.config.ts` adds `host: true` + `strictPort: true`.** Default
  Vite binding is IPv6-only on some Windows 11 builds, which broke
  IPv4-first clients (`curl.exe`, `npm run start` post-launch
  validation). `strictPort` fails fast if 3000 is taken instead of
  silently switching ports — manifest hardcodes 3000.

### Slice 11 — Linked cells (`=VENA.LOOKUP`) + per-intersection driver overrides

**Ship:** two complementary capabilities.

1. **`=VENA.LOOKUP(account, entity, costcenter, period, scenario, version)`**
   Excel custom function. Backed by a new `GET /value` endpoint that
   wraps a single-intersection cube lookup. The Office namespace is
   `VENA`; the function name is `LOOKUP`; users type
   `=VENA.LOOKUP("4000_Revenue", "E001_US", ...)`. After a successful
   `/submit`, `/overrides` POST, or `/overrides` DELETE, the taskpane
   triggers `workbook.application.calculate("Full")` so `=VENA.LOOKUP`
   cells refetch.

2. **Per-intersection driver overrides.** A new accordion item
   "Override cell" detects the user's selected cell in the active
   sheet, parses it back to an intersection via the LayoutDescriptor +
   sheet matrix, and exposes Override / Release buttons. Override
   writes a fact at the driver-controlled intersection with
   `source='override:<rid>'`. `cube.lookup_overrides` finds it, recalc
   skips it. Release evaluates the formula and writes
   `source='driver:released:<rid>'`, which the next lookup_overrides
   no longer flags — recalc resumes for that cell.

**Tests:** 175 → 192 backend (+17: cube_store 3, recalc 4, overrides 7,
values 3); 85 → 91 add-in (+6: overrides cell-address 6).

**Key files:**

Backend:
- [`backend/src/vena_lite/cube/store.py`](../../backend/src/vena_lite/cube/store.py)
  — `lookup_overrides(intersections) → set[IntersectionKey]`. Same
  SQL shape as `lookup_current_values` plus `WHERE source LIKE
  'override:%'`. Uses `facts_current` so it only considers the
  latest fact per intersection.
- [`backend/src/vena_lite/calc/recalc.py`](../../backend/src/vena_lite/calc/recalc.py)
  — `compute_driver_cells` accepts `overrides: set[IntersectionKey]`.
  Inner loop skips emit when `(account, *tkey)` is in the set.
  `recalc_for_submit` and `recalc_for_initial_define` precompute the
  set via `cube.lookup_overrides(candidates)` and pass it down.
- [`backend/src/vena_lite/audit.py`](../../backend/src/vena_lite/audit.py)
  — new helper `build_override_release_audit_rows`. `details` JSON
  is `{"action": "release"}`. Source = `'override'`.
- [`backend/src/vena_lite/api/overrides.py`](../../backend/src/vena_lite/api/overrides.py)
  — `POST /overrides` (set), `DELETE /overrides` (release). Both
  validate that account is driver-controlled; DELETE additionally
  requires intersection to be currently overridden (else 400
  NOT_OVERRIDDEN). Mirrors the nested-transaction pattern from
  `/submit`.
- [`backend/src/vena_lite/api/values.py`](../../backend/src/vena_lite/api/values.py)
  — `GET /value`. Six query params, returns 404 if no fact, else
  `{value, source, loaded_at}` (Decimal-as-string per wire
  convention).
- [`backend/src/vena_lite/schemas/overrides.py`](../../backend/src/vena_lite/schemas/overrides.py)
  — `OverrideRequest`, `OverrideReleaseRequest`, `OverrideResponse`,
  `OverrideIntersection`.
- [`backend/src/vena_lite/schemas/values.py`](../../backend/src/vena_lite/schemas/values.py)
  — `ValueResponse`.
- [`backend/src/vena_lite/main.py`](../../backend/src/vena_lite/main.py)
  — registers the two new routers.

Add-in:
- [`add-in/manifest.xml`](../../add-in/manifest.xml) — added
  `VersionOverrides` block with `xsi:type="VersionOverridesV1_0"` and
  a `CustomFunctions` ExtensionPoint. Schema-validated. **Manifest
  Version bumped to `1.0.0.0`** (the validator rejects sub-1.0).
- [`add-in/public/functions.js`](../../add-in/public/functions.js) —
  hand-authored plain JS. `LOOKUP` function registered via
  `CustomFunctions.associate("LOOKUP", LOOKUP)`. Uses **absolute URL**
  `https://localhost:3000/api/value?...` (relative paths fail in the
  custom-functions Web Worker). Wrapped in try/catch that returns
  errors as cell strings rather than throwing — Excel turns thrown
  errors into opaque `#VALUE!` which is hard to debug.
- [`add-in/public/functions.html`](../../add-in/public/functions.html)
  — runtime page that loads office.js + functions.js.
- [`add-in/public/functions.json`](../../add-in/public/functions.json)
  — Office Custom Functions metadata. `id="LOOKUP"`, `name="LOOKUP"`,
  six string parameters, string result.
- [`add-in/src/components/OverridePanel.tsx`](../../add-in/src/components/OverridePanel.tsx)
  — fourth accordion item. "Inspect selected cell" reads the active
  sheet's selected range + used range matrix; `intersectionAtCell`
  computes the dim intersection. Override / Release buttons call
  `postOverride` / `releaseOverride` then trigger recalc.
- [`add-in/src/excel/cell_address.ts`](../../add-in/src/excel/cell_address.ts)
  — pure `intersectionAtCell(matrix, rowIndex, colIndex, layout)` for
  Slice 11, used by OverridePanel. Mirrors submit.ts's normalization.
  Unit-tested.
- [`add-in/src/api/client.ts`](../../add-in/src/api/client.ts) —
  `fetchValue`, `postOverride`, `releaseOverride` typed wrappers.
  `releaseOverride` uses a new `deleteJsonWithBody` helper since
  DELETE /overrides takes a JSON body.

**Notable decisions:**

- **Source sentinel, no schema migration.** Override stickiness is
  encoded in the existing `source` TEXT column on `facts`. Override
  writes use `source='override:<rid>'`; releases use
  `source='driver:released:<rid>'`. `lookup_overrides` filters on
  `WHERE source LIKE 'override:%'`. The cube schema is unchanged.
  Rejected: adding `is_override BOOLEAN` — the cube has no
  `_apply_migrations` analogue and we didn't want to introduce one
  for v1.
- **Two-endpoint REST pair.** POST /overrides for SET, DELETE
  /overrides for RELEASE. Rejected: per-cell `is_override` flag in
  `/submit` — would have overloaded `/submit`'s validation. The two
  endpoints share a router file and are nearly symmetric, just with
  opposite cube-source strings.
- **Recalc skip-logic.** Inside `compute_driver_cells`, before
  evaluating the formula at `(account, tkey)`, check if
  `(account, *tkey)` is in the precomputed overrides set. If so,
  emit nothing — the override fact stays as the current value, and
  downstream drivers consuming this account will see the override
  via `lookup_current_values` (it's the latest fact in
  `facts_current`).
- **One override-set fetch per recalc batch.** `recalc_for_submit`
  and `recalc_for_initial_define` build a candidate
  `(driver_account, intersection)` list once, call
  `cube.lookup_overrides()` once, pass the set down to
  `compute_driver_cells`. Avoids N+1 queries.
- **Release writes a new fact, not a tombstone.** `DELETE /overrides`
  evaluates the formula at the released intersections (with
  `overrides=set()` so the override doesn't re-trigger the skip),
  then writes the result with `source='driver:released:<rid>'`. The
  next `lookup_overrides` call no longer flags the cell, so future
  recalcs include it. Audit row carries `source='override'` +
  `details={"action":"release"}` so the release is queryable
  alongside SET rows.
- **Strict 400 NOT_OVERRIDDEN on release.** DELETE /overrides
  validates that EVERY listed intersection is currently overridden;
  if any is not, returns 400 with the offending list. Rejected:
  tolerant "compute and write anyway" — would add spurious release
  rows to the audit log.
- **Custom function as plain JS in `public/`.** `public/functions.js`
  is hand-authored, served by Vite as static at `/functions.js`. No
  TS, no bundling. Rejected: TypeScript source bundled by Vite —
  Vite's hashed filenames (`functions-D3F6jF29.js`) broke the
  manifest's stable Script URL. Plain JS has no build step, stable
  URL, no transpilation. The function is small enough that losing TS
  doesn't hurt; the equivalent backend test
  (`test_get_value_returns_seeded_intersection`) covers the data
  path.
- **Custom function uses absolute URL.** `https://localhost:3000/api/value?...`,
  not `/api/value`. Excel's custom-functions runtime is a Web Worker
  whose origin is `blob:` (or similar non-page origin), so relative
  paths fail with "Network request failed". Discovered the hard way.
- **Manifest non-shared CustomFunctions runtime (V1_0).** Schema:
  `Script` → `Page` → `Metadata` → `Namespace`, in that order.
  Rejected: shared runtime (V1_1 nested in V1_0 with `Runtimes` +
  `Runtime` element) — would have required hosting
  `CustomFunctions.associate` inside `main.tsx` and dealing with
  Vite bundle hashing for the script URL anyway.
- **Excel built-in re-eval gating + manual `application.calculate`
  after writes.** No in-process cache for `=VENA.LOOKUP`. Excel
  only re-calls custom functions when their inputs change, so static
  cells don't burn round-trips. After a successful write, the
  taskpane forces re-evaluation via
  `workbook.application.calculate("Full")`.
- **Errors-as-strings inside the custom function.** Wrapped
  `LOOKUP`'s body in `try/catch` that returns `"VENA exc: <message>"`
  or `"VENA HTTP <status>: <text>"` instead of throwing. Excel turns
  thrown errors into opaque `#VALUE!`. Returning a string puts the
  diagnostic right in the cell, which made the worker-relative-URL
  bug visible immediately.
- **OverridePanel relies on the LayoutDescriptor + sheet matrix to
  reconstruct intersections.** `intersectionAtCell` lives in
  `cell_address.ts` (pure, unit-tested) and mirrors submit.ts's
  normalization. The panel reads the worksheet's `getUsedRange`
  values once on Inspect, computes the intersection, then queries
  `GET /value` for the current state.

---

## Architectural decisions & why

### Source sentinel for overrides (Slice 11)

**Problem.** Overrides need to (a) survive recalc, and (b) be detectable
by the recalc routine so it can skip them. The natural shape would be a
boolean column on `facts`, but the cube has no migration helper and
adding one for a single column is overkill at v1 scale.

**Solution.** Encode override status in the existing `source` TEXT
column. Override writes use `source='override:<request_id>'`; release
writes use `source='driver:released:<request_id>'`.
`cube.lookup_overrides` filters on `WHERE source LIKE 'override:%'`.

**Why this shape:**

- Zero schema cost. The cube's `source` column was already there for
  audit traceability; we just add new prefixes.
- `facts_current` view already exposes `source`, so reads pick up the
  override naturally — latest `loaded_at` wins.
- `LIKE 'override:%'` correctly matches SET rows but not RELEASE
  rows (which use `driver:released:<rid>`). This is the lifecycle
  hinge: after release, the cell is no longer in the override set,
  so future recalcs include it again.
- The audit log uses a SEPARATE `source` value (`'override'` for both
  SET and RELEASE rows, with `details` JSON discriminating). The
  cube's source string and the audit's source string are
  orthogonal — they serve different consumers.

**Rejected alternative: `is_override BOOLEAN` column on facts.** Would
have required a `_apply_migrations`-style helper on
`DuckDBCubeStore.__init__` (currently not present) plus a careful
ordering: the column has to exist before any writer references it.
Sentinel string avoids this entirely.

### `AxisSpec` over null-sentinels (Slice 10)

**Problem.** Phase 2's pipeline used `rowAxis: DimName | null` and
`colAxis: DimName | null`. Every consumer (pivot.ts, refresh.ts,
submit.ts, App.tsx) had its own null-check. Multi-axis stacking
required unifying the shape.

**Solution.** A single `AxisSpec = { rows: DimName[]; cols: DimName[] }`.
Long-format is `{ rows: [], cols: [] }`. Single-axis is `{ rows: ["account"], cols: [] }`. Stacked
is `{ rows: ["account", "costcenter"], cols: ["period", "scenario"] }`.
Same shape used by FilterState (persisted), LayoutDescriptor (passed to
submit), and pivot.ts (consumed by refresh.ts).

**Why this shape:**

- One mental model for the whole pipeline. `axes.rows.length === 0`
  replaces `rowAxis === null`. `axes.rows.includes(d)` replaces
  `d === rowAxis`.
- Stacked tuples drop in cleanly: `axes.rows.map(d => row[d])`
  produces the row tuple. No special-casing.
- Persisted state reflects the same shape. v1 → v2 migration is a
  trivial wrap (`rowAxis: "account"` → `rows: ["account"]`).

**Trade-off.** Pivot.ts retains a small normalization step:
rows-empty + cols-non-empty swaps to rows-only. Matches Slice 8's
behavior — putting all dims on Cols is just a vertical layout.
Document it in pivot.ts and mirror it in submit.ts and
cell_address.ts.

### Plain-JS custom function in `public/` (Slice 11)

**Problem.** Excel's custom-functions runtime needs a stable Script URL
(non-shared mode requires `<Script>`). Vite's bundle filenames are
hashed (`functions-D3F6jF29.js`), so we can't reference a stable URL
in dev unless we configure rollup output names — which fights Vite's
defaults.

**Solution.** Author the function as plain JavaScript in
`add-in/public/functions.js`. Vite serves files in `public/` as static
at the root URL, so `/functions.js` is stable. No bundling, no
transpilation. The function body is ~30 lines and deliberately small.

**Why this shape:**

- Stable URL works for both dev and (future) prod with no
  configuration.
- No build step to babysit. `npm run dev` serves the file as-is.
- The function is purely fetch + JSON; TypeScript would add little
  value for ~30 lines.
- Dropping the TS `src/functions/functions.ts` + its test means we
  lose 4 unit tests, but `test_values_endpoint.py` exercises the
  same data path on the backend side.

**Rejected: shared runtime mode.** Would have hosted
`CustomFunctions.associate` inside `main.tsx` (Vite-bundled) and used
the taskpane's index.html as the runtime page. Two problems:
(1) the `Runtime` element requires `VersionOverridesV1_1` nested
inside `V1_0`, doubling the manifest's nesting; (2) the bundle
filename problem is just relocated — main.tsx is also hashed. Plain
JS in public/ avoids both.

### Drag-drop semantics (Slice 10)

**Problem.** Three-lane drag-drop has more cases than a straight
sortable list. Same-lane reorder vs cross-lane move vs drop on empty
lane vs drop on a chip in another lane.

**Solution.** Each lane is a `useDroppable` (so empty-lane drops have
a target) and contains a `SortableContext` (so chips inside reorder
naturally). Each chip is a `useSortable` item. `onDragEnd` inspects
`over.id`:

- Starts with `lane:` → move to that lane (append at end via
  `moveDim`).
- Equals another dim id and same lane → reorder via `reorderInLane`.
- Equals another dim id and different lane → cross-lane move via
  `moveDim` (append at end).

Pure mutation logic in `axes.ts` is unit-tested with 18 cases.
JSX orchestration in `AxisDesigner.tsx` is not — matches the Slice 9
pattern with `DimensionManagerPanel`.

### Web Worker fetch (Slice 11)

**Problem.** Excel's custom-functions runtime is a Web Worker. Its
`self.location` doesn't inherit the page's origin for relative URL
resolution — `fetch("/api/value")` resolves to a `blob:` URL and
fails with "Network request failed."

**Solution.** Use absolute URLs everywhere in `functions.js`.
Hardcoded to `https://localhost:3000/api/value?...`. The 3000 port
is fixed by `vite.config.ts` (`strictPort: true` enforces it).

**Why this is fine for v1.** The dev environment is hardcoded.
Production deployment will need the URL parameterized — flag as a
TODO when shipping.

### Auto-fill page-filter defaults (Slice 10)

**Problem.** Default `FilterState` has empty filter arrays for all dims.
The Refresh-gate rule ("each non-axis dim has exactly one selection")
means Refresh starts grayed out, with four dropdowns the user must
manually populate. Bad cold-start UX.

**Solution.** `autoFillDefaults` in App.tsx's first-load `useEffect`
walks each non-axis dim and pre-picks the first leaf member if the
dim has no selection. Only fills empties — never overrides user
picks.

**Why this is safe.** The user can change any picked value via the
existing pickers. Re-loading the dropdowns on dim changes doesn't
re-trigger the auto-fill (only the first `useEffect` does). User
state survives.

---

## Data models / schemas

### `facts.source` vocabulary (Slice 11 extension)

| `source` value | written by | meaning |
|---|---|---|
| `seed` | seed CLI | initial demo seed |
| `submit:<rid>` | POST /submit | user write |
| `copy:<rid>:from=<scn>/<ver>` | POST /scenarios/copy | scenario fork |
| `driver:initial:<rid>` | POST /drivers/define | driver materialize |
| `driver:<rid>` | recalc_for_submit | driver recompute |
| `override:<rid>` *(new)* | POST /overrides | manual override SET |
| `driver:released:<rid>` *(new)* | DELETE /overrides | override RELEASE |

**Critical invariant:** `cube.lookup_overrides` filters on `WHERE source
LIKE 'override:%'`, which matches SET rows but NOT RELEASE rows. This
is the lifecycle hinge — release un-flags the cell.

### `audit_log.source` vocabulary (Slice 11 extension)

| `source` value | written by | `details` JSON |
|---|---|---|
| `submit` | POST /submit | NULL |
| `copy` | POST /scenarios/copy | NULL |
| `driver:initial` | POST /drivers/define | NULL |
| `driver` | recalc_for_submit | NULL |
| `dim_change` | dim CRUD endpoints | `{dim, member, field, before, after}` |
| `driver_change` | driver lifecycle | `{account, action, formula}` |
| `override` *(new)* | POST /overrides (SET) | NULL |
| `override` *(new)* | DELETE /overrides (RELEASE) | `{"action": "release"}` |

**Note** the audit log uses ONE `source` value (`override`) for both
override SET and RELEASE; the `details` JSON discriminates. This
keeps the audit consumer's filter simple ("show me all override
events") while still letting tooling separate the two phases via
JSON.

`AuditRow` tuple shape unchanged from Phase 2 (12-tuple). No schema
migration needed.

### `FilterState` shape (Slice 10 v2)

```ts
// v1 (Phase 2)
{ filters: Record<DimName, string[]>, rowAxis: DimName | null, colAxis: DimName | null }
// v2 (Slice 10)
{ filters: Record<DimName, string[]>, axes: { rows: DimName[]; cols: DimName[] } }
```

Office Settings key: `vena_lite.filters.v2`. Stored payload also
includes `version: 2` for explicit detection. v1 key (`vena_lite.filters.v1`)
is read on first load if v2 is empty (one-shot upgrade), then
overwritten on next save.

### `LayoutDescriptor` shape (Slice 10)

```ts
{ rows: DimName[]; cols: DimName[]; pageFilters: PageFilters }
```

Long-format = both arrays empty. Same normalization as pivot.ts:
rows-empty + cols-non-empty becomes rows-only on read.

### Wire types added in Phase 3 (Pydantic → TypeScript)

| Type | Slice | Purpose |
|---|---|---|
| `OverrideRequest` | 11 | POST /overrides body |
| `OverrideIntersection` | 11 | Intersection-only payload (no value) |
| `OverrideReleaseRequest` | 11 | DELETE /overrides body |
| `OverrideResponse` | 11 | Both endpoints' return shape |
| `ValueResponse` | 11 | GET /value return shape |

Slice 10 added zero wire types — the pivot logic is pure client-side.

### Office Custom Functions metadata (Slice 11)

`add-in/public/functions.json`:
```json
{
  "functions": [{
    "id": "LOOKUP",          // matches CustomFunctions.associate("LOOKUP", ...)
    "name": "LOOKUP",        // appears in Excel as VENA.LOOKUP
    "result": { "type": "string" },
    "parameters": [6 string params, in dim order]
  }]
}
```

Manifest namespace = `VENA`. Together: `=VENA.LOOKUP(...)`.

---

## Considered & rejected

### Slice 10

- **Auto-refresh on filter change** — manual Refresh stays the gate,
  same reason as Slice 8. Avoids burning round-trips while the user
  composes a multi-dim layout.
- **Drag-drop reordering of axes via separate per-axis component** —
  rejected for UI complexity. Three-lane SortableContext is simpler
  and more discoverable.
- **Hand-authored ordering of stacked col tuples** — let lex-sort
  handle it. The user can re-order axes via drag, but member sort
  inside a tuple is implicit. Add manual sort when there's evidence
  it matters.
- **Title row with explicit page-filter dim labels stacked vertically**
  — kept the inline `entity=E001 | scenario=Actual | ...` format for
  cell-merging simplicity in Excel.
- **Persist v1 key on every store after migration** — no, rewrite to
  v2 only. v1 key is left on first load (so a downgrade still works);
  next save overwrites with v2.

### Slice 11

- **`is_override BOOLEAN` column on `facts`** — rejected because it
  requires a cube migration helper (currently absent). Source
  sentinel is simpler for v1.
- **Per-cell `is_override` flag in `/submit`** — rejected to avoid
  overloading `/submit`'s validation. `/overrides` is a separate
  router file with its own validators.
- **Tolerant "release if overridden, no-op otherwise"** — rejected.
  Strict 400 NOT_OVERRIDDEN keeps the audit log meaningful (no
  spurious release rows for never-overridden cells).
- **In-process cache for `=VENA.LOOKUP`** — Excel's built-in re-eval
  gating is sufficient. At v1 scale (~100 cells), each
  `application.calculate("Full")` triggers ~100 sequential GETs;
  acceptable. Revisit when cells exceed ~1000.
- **Shared runtime for the custom function** — rejected. Would have
  required nested `VersionOverridesV1_1` with `Runtimes` element and
  CustomFunctions.associate inside main.tsx. Plain JS in public/ is
  simpler and keeps the runtimes isolated.
- **TypeScript source for `functions.ts`** — Vite's hashed bundle
  filenames break the manifest's stable Script URL. Plain JS in
  public/ has stable URL, no build step, no transpilation. The
  function is small enough that losing TS doesn't hurt.
- **Tests for `OverridePanel`** — UI orchestration only; pure logic
  in `cell_address.ts` is unit-tested. Same pattern as Slice 9
  `DimensionManagerPanel`.
- **Throwing on errors inside `LOOKUP`** — Excel turns thrown errors
  into opaque `#VALUE!`. Wrapping in try/catch and returning the
  error as a cell string makes diagnosis trivial. Production may
  want to revert to throwing once stable.
- **Application.calculate trigger on every `Refresh`** — rejected;
  Refresh writes the pivot values directly, so `=VENA.LOOKUP` cells
  pointing INSIDE the pivot don't need refetching. Cells pointing
  OUTSIDE the pivot already trigger their own re-eval when their
  inputs change. The trigger on Submit/Override/Release covers the
  "I just wrote new data" case.

---

## Known issues / TODOs

### Slice 10

- **Griffel CSS shorthand workaround.** `borderStyle` and `borderColor`
  longhand are rejected by Griffel's typing (they're 4-side
  shorthand for the per-side properties, which Griffel disallows).
  AxisDesigner's `laneBoxOver` style uses `border: \`1px solid
  ${tokens.colorBrandStroke1}\`` instead. Document so future
  components don't trip over it.
- **`Refresh` does NOT trigger `application.calculate`.** Only
  Submit / Override / Release do. `=VENA.LOOKUP` cells pointing
  outside the pivot's data block will refetch only when their
  inputs change. If a user has a `=VENA.LOOKUP` referencing a cell
  the pivot just wrote, the value is already correct from the
  Refresh's batched range write; if it references something else,
  it'll only update when that something changes.
- **Inline-reason labels use raw dim names** ("entity, costcenter"
  rather than "Entity, Cost center"). Minor.
- **`getRangeByIndexes(0, 0, 500, 50).clear()` is a fixed
  rectangle.** Pre-Slice-10 issue, still present.

### Slice 11

- **`functions.js` is hand-rolled plain JS** — no TypeScript
  type-checking on the function body. The test file was deleted
  because it tested a TS module that no longer exists. The function
  body is tiny, so risk is low; if it grows beyond ~50 lines,
  consider re-introducing TS via a separate Vite entry with
  configured output naming.
- **Manifest production deployment will need a different Script URL.**
  `https://localhost:3000/functions.js` is dev-only. Update
  `bt:Url id="Functions.Script.Url"` (and `.Page.Url`,
  `.Metadata.Url`) when shipping.
- **`functions.js` has hardcoded `https://localhost:3000`** for the
  fetch URL. Same dev-only constraint.
- **Override release is "all or nothing".** DELETE /overrides
  validates ALL intersections must be currently overridden, else
  400. Could be tolerant (filter to overridden subset, release just
  those). Strict for audit cleanliness for now.
- **`triggerWorkbookRecalc` is duplicated** in App.tsx and
  OverridePanel.tsx. Trivial to share via a helper. Skip for v1.
- **`bt:Url` IDs in the manifest are case-sensitive** and `resid`
  lookups don't validate at parse time — typos fail silently at
  runtime. Watch out if adding new resources.
- **No metric on `/value` latency.** At v1 scale (~100 `=VENA.LOOKUP`
  cells), each `application.calculate("Full")` triggers ~100
  sequential GETs. Acceptable for v1; revisit at higher scale with
  batch endpoint or in-process cache.
- **`audit_log` has no index on `source`.** Queries that filter by
  source (e.g. "show all override events") will scan. v1 fine; add
  index when it matters.
- **Override audit details JSON is `{"action":"release"}` only for
  the RELEASE path.** SET path uses `details=NULL`. Symmetric
  shape (`{"action":"set"}` for SET) would be nice for downstream
  parsers but isn't strictly necessary.

### Operational gotchas surfaced this phase

These bit during dev. Pin them so future-you doesn't re-discover.

1. **Manifest version `0.1.0` is rejected.** `office-addin-manifest
   validate` flags it as "version too low." Use `1.0.0.0` (4-part)
   or any 1.x+ semver.

2. **CustomFunctions ExtensionPoint child order is fixed.** Schema
   requires `Script` → `Page` → `Metadata` → `Namespace`. Out-of-order
   = "invalid child element" error.

3. **`VersionOverridesV1_0` doesn't allow `<Runtime>`.** Only
   `<Script>`. Shared runtime mode requires V1_1 nested inside V1_0.
   We chose non-shared, so it's not an issue, but if Slice 12 wants
   shared runtime, follow the nested-versionoverrides pattern.

4. **Excel custom-functions runtime is a Web Worker.** `fetch("/api/...")`
   returns "Network request failed" because the worker's origin is
   `blob:` not `https://localhost:3000`. Use absolute URLs.

5. **Manifest changes need a full Excel cache wipe + re-sideload.**
   `Get-Process EXCEL | Stop-Process -Force; Remove-Item
   "$env:LOCALAPPDATA\Microsoft\Office\16.0\Wef\*"; npm run start`.
   Otherwise Excel uses the cached pre-Slice-11 manifest and shows
   "add-in is no longer available."

6. **Vite's default `localhost` binding is IPv6-only on some Windows
   11 builds.** `Test-NetConnection localhost -Port 3000` succeeds
   (it tries IPv6 first then IPv4) but `curl.exe` (IPv4-first) fails.
   Fix: `host: true` in `vite.config.ts`.

7. **Vite HMR doesn't reload `public/` during dev.** Files in public/
   are served as static; the Excel custom-functions runtime caches
   `functions.js` after first registration. Changes need a full
   Excel restart + cache wipe.

8. **PowerShell parses `&` as an operator.** `curl.exe -k <url>`
   MUST quote URLs with `&`:
   `curl.exe -k "https://localhost:3000/api/value?a=b&c=d"`.

9. **Namespace ≠ function name.** `=VENA.VENA(...)` is what you get
   if both are `VENA`. We picked namespace=`VENA`, function=`LOOKUP`,
   so users type `=VENA.LOOKUP(...)`.

10. **Refresh button is grayed by default if non-axis dims have no
    selection.** `autoFillDefaults` in App.tsx's first-load useEffect
    pre-picks first leaves. If you remove this, the cold-start UX
    requires four manual dropdown picks before Refresh enables.

---

## What the next Phase needs to know

### Invariants to preserve (Phase 1 + Phase 2 + Phase 3 cumulative)

Phase 2's invariants 1–10 still hold. Plus:

11. **`facts.source` vocabulary is a discriminated set.** Adding a
    new fact source value means adding a new prefix.
    `lookup_overrides` matches on `LIKE 'override:%'` exactly; don't
    reuse `override` for a different kind. `driver:released:` is
    similarly reserved.
12. **Filter state v2 is the persisted shape.** Bump to v3 with a
    new key (`vena_lite.filters.v3`) when adding new fields. Keep
    the v1 → v2 migration path; add v2 → v3 alongside.
13. **Manifest must validate** against `office-addin-manifest validate`
    before sideload. Run as part of CI if Slice 12 introduces manifest
    changes.
14. **Custom function URLs are absolute and dev-only.** When shipping,
    update `functions.js`, `functions.json`, manifest URLs together.
15. **`AxisSpec` is the single source of truth for axes.** No more
    null-sentinels. Pipe-delimited tuple keys for stacked axes. No
    member id may contain `|`.
16. **`OverridePanel` mirrors `submit.ts`'s normalization** —
    rows-empty + cols-non-empty swaps to rows-only. Same as
    `pivot.ts`. `cell_address.ts.intersectionAtCell` uses this rule.
17. **Excel's custom-functions runtime is a Web Worker.** Any new
    fetch from `public/functions.js` must use absolute URLs. Same
    for any future workers Slice 12+ might introduce.
18. **`autoFillDefaults` only fills empties.** User-set filters
    survive. If Slice 12 changes this, document the side effect.

### Slice 12 candidates

Per the deferred directions from Phase 1 + Phase 2:

- **Audit-log viewer in Excel** (Phase 2 deferred Direction B). Could
  reuse the dim_member CRUD pattern: a new accordion item that
  fetches from `GET /audit?source=...&limit=...` and renders rows.
- **Real chart of accounts importer** (Phase 1 Direction A). CSV →
  cube. Would need a new `POST /import` endpoint and an upload
  control in the taskpane.
- **Multi-cell override** — current OverridePanel handles one cell.
  Bulk override would need range selection + per-cell value input.
- **Auth + remote deployment** (Phase 1 Direction C). Largest scope;
  meaningful only if shipping.
- **Property-based parser tests, Playwright E2E, perf benchmarks**
  (Phase 1 Direction D). Rigor pass.

### Things you'd break if you didn't know

- **Recalc skip-logic must precompute the override set** before
  calling `compute_driver_cells`. If you call without the set,
  recalc will overwrite overrides on the next /submit. The
  `recalc_for_submit` and `recalc_for_initial_define` wrappers both
  do this — DON'T call `compute_driver_cells` directly without
  passing `overrides`.
- **`facts_current` view exposes `source`** — depend on it for the
  override-detection. If the view is ever rebuilt, preserve the
  column.
- **Manifest deployment needs three URLs in sync:** Script URL,
  Page URL, Metadata URL. If ports/paths change, update all three.
- **`functions.js` cannot use ES modules.** Excel's
  custom-functions runtime loads it as a classic script via
  manifest's `<Script>` element. No `import`/`export`.
- **The two-step "force-close + cache-wipe + npm run start"** is the
  reliable manifest-change workflow. Skipping any step usually
  results in Excel running on the stale manifest.
- **`AxisSpec.rows.length === 0 && AxisSpec.cols.length === 0`** is
  the long-format predicate. Used by pivot.ts, refresh.ts, submit.ts,
  cell_address.ts. Don't try to normalize in some files but not
  others.
- **`autoFillDefaults`** runs on first load only. If Slice 12 adds
  a "reset filters" button, decide whether to re-trigger.

### Critical reading list (refresh)

In order:

1. [`SPEC.md`](../../SPEC.md) — domain contract.
2. [`CLAUDE.md`](../../CLAUDE.md) — never-do-this list + entry points.
3. [`phase-1-handoff.md`](phase-1-handoff.md) — Phase 1 (Slices 1–7).
4. [`phase-2-handoff.md`](phase-2-handoff.md) — Phase 2 (Slices 8–9).
5. **This file** — Phase 3 (Slices 10–11).
6. [`backend/src/vena_lite/main.py`](../../backend/src/vena_lite/main.py)
   — wires everything; one-screen overview.
7. [`backend/src/vena_lite/api/overrides.py`](../../backend/src/vena_lite/api/overrides.py)
   — Slice 11 transactional pattern; mirror for any future
   override-style endpoint.
8. [`backend/src/vena_lite/calc/recalc.py`](../../backend/src/vena_lite/calc/recalc.py)
   — override skip-logic. The `compute_driver_cells` `overrides`
   parameter is the contract.
9. [`add-in/src/components/AxisDesigner.tsx`](../../add-in/src/components/AxisDesigner.tsx)
   — Slice 10 dnd-kit pattern.
10. [`add-in/src/excel/pivot.ts`](../../add-in/src/excel/pivot.ts) —
    multi-axis tuple-key pivot.
11. [`add-in/public/functions.js`](../../add-in/public/functions.js)
    — minimal custom function pattern; copy this shape for any
    future custom function.
12. [`add-in/manifest.xml`](../../add-in/manifest.xml) — V1_0
    non-shared CustomFunctions; child-element order is significant.
13. [`add-in/src/components/OverridePanel.tsx`](../../add-in/src/components/OverridePanel.tsx)
    — Slice 11 UI pattern; how to derive an intersection from a
    selected cell.

Then run `cd backend && uv run pytest -q` and
`cd add-in && npm test` to confirm green, then start the demo per the
Phase 1 runbook.
