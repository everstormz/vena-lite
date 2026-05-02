# Vena-lite — Phase 2 handoff

**Status:** Phase 2 complete. Two slices shipped on top of Phase 1: **Slice
8** (pivot view / slice-and-dice) and **Slice 9** (dimension manager + alias
layer + driver lifecycle). **175 backend tests + 51 add-in tests passing**,
ruff clean, Pydantic ↔ TypeScript drift gate green. Single-user, localhost
only.

Read this after [`phase-1-handoff.md`](phase-1-handoff.md). Phase 1 holds
all the context (stack, runbook, invariants); Phase 2 is a delta on top.

---

## TL;DR

Phase 1 shipped a working Vena-lite at MVP scope but with two gaps that
made it hard to use for real planning:

1. The Excel taskpane only filtered scenario + version (single-select).
   You couldn't slice across the other four dims, couldn't see results
   pivoted, and couldn't focus on a sub-cube.
2. The dim model was frozen at seed time. To add an account or rename a
   cost center, you edited `hierarchy_seed.py` and re-seeded.

Phase 2 closed both:

- **Slice 8** turned the taskpane into a mini report builder. Six-dim
  multi-select filter strip, row + column axis pickers, client-side pivot,
  filter state persisted to the workbook.
- **Slice 9** made the dim model editable from the UI. POST/PATCH/DELETE
  on `/dimensions/{dim}/members`, an alias layer (mutable display_name,
  immutable member_id), and a "Undefine driver" button.

No backend cube changes. No formula language changes. The big architectural
moves were the alias layer (rename UX without renaming the storage key),
the AuditRow shape extension (len 11 → 12 with a `details` JSON column),
and the additive schema-migration helper that handles existing dbs without
a separate migration tool.

---

## What was built

### Slice 8 — Pivot view (slice-and-dice)

**Ship:** the taskpane filter strip went from two single-select dropdowns
(scenario + version) to six multi-select pickers (all dims) plus row/col
axis pickers. Backend zero-touch — `/slice` already supported arbitrary
multi-dim filters with hierarchy expansion + parent-level aggregation.

Refresh now sends the chosen filters, gets back aggregated rows, and the
client pivots them into a 2D matrix written to A1 of the active sheet.
Single batched range write, single `context.sync` — Phase 1's perf
invariant intact. Filter + axis state persists across workbook reopens via
Office Settings.

**Tests:** 154 backend (unchanged), 16 → 44 add-in (+10 pivot, +8 filters,
+6 submit, +4 refresh extensions).

**Key files:** [`add-in/src/excel/pivot.ts`](../../add-in/src/excel/pivot.ts)
(pure transform), [`add-in/src/excel/filters.ts`](../../add-in/src/excel/filters.ts)
(Office Settings persistence), [`add-in/src/components/MultiMemberPicker.tsx`](../../add-in/src/components/MultiMemberPicker.tsx),
[`add-in/src/components/AxisPicker.tsx`](../../add-in/src/components/AxisPicker.tsx),
[`add-in/src/components/FilterStrip.tsx`](../../add-in/src/components/FilterStrip.tsx),
[`add-in/src/types/dims.ts`](../../add-in/src/types/dims.ts) (canonical
narrow `DimName` union — gotcha #8 from Phase 1 finally addressed),
rewrites of [`refresh.ts`](../../add-in/src/excel/refresh.ts),
[`submit.ts`](../../add-in/src/excel/submit.ts), [`App.tsx`](../../add-in/src/App.tsx).

**Notable decisions:**

- **Pivot, not long-format-with-filters.** The user is a Vena/Anaplan
  expert; "slice and dice" in their world is OLAP pivot, not just
  filtering. Shipping (a) and calling it slice-and-dice would have been
  misnaming.
- **One row dim + one col dim, not stacked headers.** Vena lets you put
  multiple dims on each axis; that's Slice 10 territory.
- **Refresh-gate rule: each non-axis dim must have *exactly one* picker
  selection.** Multi-select on a non-axis dim produces ambiguous pivot
  cells; the gate prevents that. A parent counts as one (the backend
  aggregates the subtree to one resolved member).
- **Submit-disabled when any selected member is non-leaf.** Client-side
  check via `is_leaf` from cached `DimMemberInfo`. The backend rejects
  too, but defensive-disable is more discoverable.
- **`refresh.ts` clears a generous 500×50 rectangle before each write.**
  Fixes a latent bug where a previous larger pivot left orphan cells when
  filters narrow. One-sync invariant preserved (the clear is queued).
- **`pivot.ts` is pure.** Office.js calls live only in `refresh.ts`.
  `pivot.test.ts` runs without an Excel mock.
- **Office Settings key versioning:** `vena_lite.filters.v1`. Defensive
  parse + `dropUnknownMembers` on load.

### Slice 9 — Dimension manager + alias layer + driver lifecycle

**Ship:** a third accordion item ("Manage dimensions") in the taskpane.
Pick a dim, see the tree, edit display_name / ordinal in place, delete
unreferenced members, add new members under any parent. Plus a current-
drivers list in `DefineDriverPanel` with per-row Undefine.

The chart of accounts is now editable from inside Excel. Pickers
(`MemberPicker` and `MultiMemberPicker`) render `display_name ?? id`
everywhere — selection value stays `id`.

**Tests:** 154 → 175 backend (+14 dimensions CRUD, +3 driver lifecycle,
+2 audit `details`/tuple-shape, +2 `dim_model.lookup`), 44 → 51 add-in
(+7 `dim_tree`).

**Key files:**

Backend:
- [`backend/src/vena_lite/api/dimensions.py`](../../backend/src/vena_lite/api/dimensions.py)
  — POST / PATCH / DELETE endpoints + extended GET to include display_name
- [`backend/src/vena_lite/api/drivers.py`](../../backend/src/vena_lite/api/drivers.py)
  — DELETE endpoint
- [`backend/src/vena_lite/audit.py`](../../backend/src/vena_lite/audit.py)
  — `build_dim_change_audit_row`, `build_driver_change_audit_row`,
  extended `build_audit_rows` to emit 12-tuples
- [`backend/src/vena_lite/metadata/store.py`](../../backend/src/vena_lite/metadata/store.py)
  — `_apply_migrations`, `insert_dim_member`, `update_dim_member`,
  `delete_dim_members`, `fetch_dim_member`, `delete_driver`, `last_audit_id`
- [`backend/src/vena_lite/metadata/schema.sql`](../../backend/src/vena_lite/metadata/schema.sql)
  — `display_name` on `dim_member`, `details` on `audit_log`
- [`backend/src/vena_lite/metadata/dim_model.py`](../../backend/src/vena_lite/metadata/dim_model.py)
  — public `lookup(dim, member)` (replaces prior private `_members` access)
- [`backend/src/vena_lite/schemas/dimensions.py`](../../backend/src/vena_lite/schemas/dimensions.py)
  — `display_name` on `DimMemberInfo`; new `DimMemberCreateRequest`,
  `DimMemberUpdateRequest`, `DimMemberMutationResponse`,
  `DimMemberDeleteResponse`
- [`backend/src/vena_lite/schemas/drivers.py`](../../backend/src/vena_lite/schemas/drivers.py)
  — `DriverDeleteResponse`
- [`backend/src/vena_lite/main.py`](../../backend/src/vena_lite/main.py)
  — CORS `allow_methods` extended for PATCH + DELETE

Add-in:
- [`add-in/src/components/DimensionManagerPanel.tsx`](../../add-in/src/components/DimensionManagerPanel.tsx)
- [`add-in/src/excel/dim_tree.ts`](../../add-in/src/excel/dim_tree.ts)
  — extracted shared `buildTree` + `memberLabel*` helpers (used by
  picker + manager)
- [`add-in/src/components/DefineDriverPanel.tsx`](../../add-in/src/components/DefineDriverPanel.tsx)
  — drivers list + Undefine button
- Picker label updates: [`MemberPicker.tsx`](../../add-in/src/components/MemberPicker.tsx),
  [`MultiMemberPicker.tsx`](../../add-in/src/components/MultiMemberPicker.tsx)
- [`add-in/src/api/client.ts`](../../add-in/src/api/client.ts) — 4 new
  wrappers (`addDimMember`, `updateDimMember`, `deleteDimMember`,
  `deleteDriver`) + `patchJson` / `deleteJson` helpers
- [`add-in/src/App.tsx`](../../add-in/src/App.tsx) — `drivers: DriverInfo[]`
  state, third accordion item

**Notable decisions:**

- **Single `audit_log` table with `source` discriminator** (per user
  decision). Reused the existing `source` column rather than adding a
  `kind` column. Added `details TEXT NULL` for kind-specific JSON.
- **Per-member 1:1 `display_name` field** for the alias layer (not a
  multi-alias table). Simplest design that closes the rename UX gap.
  Schema extends cleanly to `dim_alias(dim, alias, member, kind)` if
  multi-alias is ever needed.
- **`member_id` is immutable.** Cube facts and driver formulas reference
  it; "renaming" via the UI changes `display_name` only. Rename of `id`
  is forbidden by the PATCH schema.
- **No reparent in v1** (per user decision). PATCH excludes `parent`. Saved
  the cycle-check work; extending later is straightforward (reuse the
  calc-engine's transitive-closure pattern).
- **Driver undefine semantics** (per user decision): prior computed facts
  stay in the cube; future manual `/submit` to that account becomes legal.
  Backed by the append-only invariant — no facts to clean up.
- **DELETE refuses when facts exist.** Walks `dim_model.get_leaves(dim,
  member)`, queries the cube via `cube.slice({dim: DimFilter(members=
  leaves)})`, returns 409 with `{fact_count, leaves}` if any. Loud
  failure; user must clear the facts first.
- **Schema migrations via `_apply_migrations` introspection.** PRAGMA
  `table_info` + ALTER TABLE if the column is missing. Idempotent —
  fresh installs hit CREATE TABLE (already includes new cols), existing
  dbs hit ALTER once. No separate migration tool.
- **`AuditRow` extended uniformly to 12-tuple.** Mechanical ripple
  through `audit.py` + `submit.py` + `scenarios.py` + `recalc.py` + test
  fixtures. New `build_*_audit_row` helpers make construction declarative.
- **Two-click delete confirmation.** Quick-and-dirty pattern for v1; click
  Delete → button changes to "Confirm" → second click commits. Could be
  upgraded to a Dialog later.

---

## Architectural decisions & why

### The alias layer (Slice 9)

**Problem.** The user wanted rename UX without ever renaming `member_id`,
because cube facts (millions, eventually) and driver formulas reference
it.

**Solution.** Add a mutable `display_name TEXT NULL` column to
`dim_member`. NULL means "no alias, render falls back to id". Pickers
display `display_name ?? id`; selection value stays `id`. Cube schema and
formulas don't change at all.

**Why this shape:**

- Zero migration cost — existing seeded members get NULL, render
  identically to before, user can edit later.
- Cube and driver formulas are immutable in their references. A future
  `=VENA("4000_Revenue", ...)` formula (Slice 11) keeps working forever.
- Extends cleanly to multi-alias if needed: add `dim_alias(dim, alias,
  member, kind)` and treat `display_name` as the "primary alias."

**Rejected alternative: rename via UPDATE on the cube.** Would have
required rewriting all matching fact rows under the new id (volume of
writes), updating audit rows (or losing referential integrity), updating
driver formulas. Append-only invariant would have to be relaxed.
Massive blast radius for a UX nicety.

### audit_log shape extension (Slice 9)

**Problem.** New audit kinds (`dim_change`, `driver_change`) don't have
intersection columns to populate. The original schema enforces NOT NULL
on `account_id`, `entity_id`, etc.

**Solution.** Reuse the existing `source` column as the kind discriminator
(it's already there, defaulting to `'submit'`). Add a `details TEXT NULL`
column for kind-specific JSON. Repurpose intersection columns as sentinels
for non-submit rows: `account_id = "<dim>"`, `entity_id = "<member>"`,
others = `""`. NOT NULL constraints satisfied.

**Why this shape:**

- One table, one query path, one audit log to read for any kind.
- Existing `'submit'` rows untouched (no migration of data, just a
  schema additive ALTER).
- JSON `details` is forward-compatible — Slice 11 can add per-cell
  override audit rows without schema change.

**Rejected alternative: peer table `dim_change_log`.** Would split the
audit history across two tables. The user explicitly wanted one table.

**Rejected alternative: relax NOT NULL on intersection columns.** Would
require dropping and recreating the table (SQLite limitation in
non-recent versions). Sentinel-string repurposing is simpler and
preserves backward compat for SELECT consumers.

### Schema migrations (Slice 9)

**Problem.** `schema.sql` runs idempotently via `executescript` on every
store init. `CREATE TABLE IF NOT EXISTS` handles fresh installs; existing
dbs need ALTER TABLE for new columns. SQLite's ALTER TABLE has no
`IF NOT EXISTS` syntax.

**Solution.** A `_apply_migrations` helper that uses PRAGMA `table_info`
to introspect existing columns and runs ALTER TABLE only if a column is
missing. Called from `__init__` after `executescript`.

**Why this shape:**

- Idempotent — runs on every init, only acts the first time.
- No separate migration tool (alembic, yoyo) for a v1 single-user app.
- Solo dev with one production db doesn't need migration history; the
  introspection-based approach gives just enough.

**Trade-off:** doesn't scale to many migrations. If we add 20 more
columns, this gets unwieldy. At that point, switch to a real migration
tool. For now, 2 columns added in Slice 9 — fine.

### Pure pivot transform (Slice 8)

**Problem.** Pivoting backend slice rows into a 2D matrix is
non-trivial logic — sorting members, building a sparse cell map,
projecting onto axes. If it lives inside `refresh.ts` (which calls
Office.js), tests need an Excel mock.

**Solution.** Extract into [`pivot.ts`](../../add-in/src/excel/pivot.ts).
Pure JS, takes `FactRow[]` + axes + page filters + driverAccounts, returns
`{matrix, driverFillCoords, headerRowIndex}`. `refresh.ts` does only the
Office.js calls (clear, write, queue fills, sync).

**Why this shape:**

- `pivot.test.ts` is fast and Excel-mock-free.
- Refactoring the pivot algorithm doesn't risk breaking the perf
  invariant (one batched write, one sync).
- Driver gray-fill coordinates are computed in `pivot.ts` and consumed
  by `refresh.ts` — cleanly separated.

### LayoutDescriptor for submit (Slice 8)

**Problem.** Pre-Slice 8, `submit.ts` assumed cols 0..6 = the long-format
header. With pivot layouts, the same physical sheet position means
different things depending on what was written.

**Solution.** A `LayoutDescriptor = {rowAxis, colAxis, pageFilters}` that
travels from `App.tsx` (source of truth) into the read path. `submit.ts`
uses it to reconstruct intersections from cell positions. Long-format
fallback (`rowAxis === null && colAxis === null`) preserves Slice 7
behavior.

**Why:** the sheet's column headers are reconstructable but trusting them
is brittle (user can edit them). The picker/axis state in App.tsx is the
truth.

### Refresh-gate rule: exactly one selection per non-axis dim (Slice 8)

**Problem.** If the user picks `entity = [E001_US, E002_UK]` while
`entity` isn't on either axis, the `/slice` response has rows for both
entities. The pivot has ambiguous (rowMember, colMember) cells.

**Solution.** Refresh button disables until every non-axis dim has
*exactly one* picker selection. A parent counts as one (backend aggregates
the subtree to one resolved value). Inline reason text names the
unconstrained dims.

**Why:** safer than letting ambiguity propagate. Matches Vena/Anaplan UX
expectations — page filters are always single-valued.

### `add-in/src/types/dims.ts` (Slice 8)

**Problem.** Phase 1 gotcha #8: Pydantic's `Literal["account", ...]`
collapses to `string` in JSON Schema, so `DimName` doesn't exist as a
narrow type in `generated.ts`. Pre-Slice 8, `client.ts` imported
`DimName` from `generated.ts` — a latent TypeScript error that didn't
fail CI because CI doesn't run `tsc --noEmit`.

**Solution.** Hand-maintained [`add-in/src/types/dims.ts`](../../add-in/src/types/dims.ts)
exports `DIM_NAMES` constant + `DimName` type. All add-in code imports
from here.

**Why not auto-generate:** would require modifying `generate_ts_types.py`
to post-process the output. Hand-maintaining a 6-element list is fine
for v1; if dims grow significantly, revisit.

---

## Data models / schemas

### `dim_member` (Slice 9 extension)

```sql
CREATE TABLE IF NOT EXISTS dim_member (
  dim_name          TEXT NOT NULL,
  member_id         TEXT NOT NULL,
  parent_member_id  TEXT,
  rollup_op         TEXT NOT NULL DEFAULT 'sum',
  ordinal           INTEGER NOT NULL DEFAULT 0,
  display_name      TEXT,                   -- Slice 9: alias; NULL → falls back to member_id
  PRIMARY KEY (dim_name, member_id)
);
```

Empty-string `display_name` is normalized to NULL server-side (single
rendering branch downstream).

### `audit_log` (Slice 9 extension)

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  submit_request_id   TEXT      NOT NULL,
  submitted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  who                 TEXT      NOT NULL DEFAULT 'local',
  account_id          TEXT      NOT NULL,
  entity_id           TEXT      NOT NULL,
  costcenter_id       TEXT      NOT NULL,
  period_id           TEXT      NOT NULL,
  scenario_id         TEXT      NOT NULL,
  version_id          TEXT      NOT NULL,
  before_value        TEXT,
  after_value         TEXT      NOT NULL,
  source              TEXT      NOT NULL DEFAULT 'submit',
  details             TEXT                  -- Slice 9: JSON for non-submit kinds
);
```

`source` discriminator vocabulary:

| `source` | Meaning | Intersection cols | `details` |
|---|---|---|---|
| `submit` | user `/submit` write | real intersection | NULL |
| `copy` | `/scenarios/copy` row | real intersection | NULL |
| `driver:initial` | initial driver compute on `/drivers/define` | real intersection | NULL |
| `driver` | driver recompute on `/submit` | real intersection | NULL |
| `dim_change` | Slice 9 dim_member CRUD | `account_id=dim, entity_id=member, others=""` | `{dim, member, field, before, after}` |
| `driver_change` | Slice 9 driver lifecycle | `account_id=account, others=""` | `{account, action, formula}` |

### `AuditRow` tuple shape (len 12)

```python
AuditRow = tuple[
  str,         # submit_request_id
  str,         # who
  str,         # account_id      (or dim name for dim_change)
  str,         # entity_id       (or member id for dim_change; "" for driver_change)
  str,         # costcenter_id   ("" for non-submit)
  str,         # period_id       ("" for non-submit)
  str,         # scenario_id     ("" for non-submit)
  str,         # version_id      ("" for non-submit)
  str | None,  # before_value
  str,         # after_value
  str,         # source
  str | None,  # details (JSON for non-submit; NULL for submit)
]
```

**Invariant:** all callers must produce 12-element tuples. The unit test
[`test_audit_row_tuple_len_is_12`](../../backend/tests/unit/test_audit_store.py)
pins this. Use the `build_*_audit_row` helpers in
[`audit.py`](../../backend/src/vena_lite/audit.py) rather than constructing
tuples by hand.

### `DimMemberRow` tuple shape (len 6)

```python
DimMemberRow = tuple[
  str,         # dim_name
  str,         # member_id
  str | None,  # parent_member_id
  str,         # rollup_op
  int,         # ordinal
  str | None,  # display_name        (Slice 9)
]
```

Touched by: `cli.py` (seed), `scenarios.py` (auto-create scenario/version),
`hierarchy_seed.py` (Slice 4 demo seed), `conftest.py` (test fixture),
`store.py` (insert / fetch).

### Office Settings keys (add-in)

| Key | Shape | Owner | Used by |
|---|---|---|---|
| `vena_lite.baseline.v1` | `Record<intersection_key, value_string>` | `baseline.ts` | delta detection in `submit.ts` |
| `vena_lite.filters.v1` | `{filters: Record<DimName, string[]>, rowAxis, colAxis}` | `filters.ts` | restored on App mount |

Both versioned. Future Slice 10 will bump filters to `v2` (multi-axis).

### Wire types added in Phase 2 (Pydantic → TypeScript)

| Type | Slice | Purpose |
|---|---|---|
| `DimMemberInfo.display_name?` | 9 | Alias layer |
| `DimMemberCreateRequest` | 9 | POST /dimensions/{dim}/members |
| `DimMemberUpdateRequest` | 9 | PATCH (display_name + ordinal only) |
| `DimMemberMutationResponse` | 9 | POST + PATCH return |
| `DimMemberDeleteResponse` | 9 | DELETE return (incl. cascaded leaves) |
| `DriverDeleteResponse` | 9 | DELETE /drivers/{account} return |

Slice 8 added zero wire types — pivot is pure client-side.

---

## Considered & rejected

### Slice 8

- **Long-format with smart column suppression** — would have been easier
  to ship but doesn't actually let you slice and dice. The Vena-expert
  user would have noticed within 30 seconds.
- **Stacked headers (multiple dims per axis)** — Vena-style, valuable,
  too big for one slice. Slated for Slice 10.
- **Drag-and-drop axis reordering** — same. Slice 10 with `@dnd-kit/core`.
- **Auto-refresh on filter change** — manual Refresh stays the gate.
  Avoids burning round-trips while the user is composing a filter set.
- **Server-side rejection of parent submits as the primary UX** — the
  backend already rejects, but defensive client-side disable + tooltip
  is more discoverable.
- **Hand-add `type DimName = "account" | ...` to `generated.ts`** —
  would have violated the "don't hand-edit generated.ts" rule. Created
  `add-in/src/types/dims.ts` as the canonical narrow type instead.
- **Office.js custom function `=VENA(...)` for linked cells** — too big
  for Slice 8. Slated for Slice 11.

### Slice 9

- **Multi-alias table per member** — `dim_alias(dim, alias, member,
  kind)`. Rejected for v1 — single `display_name` covers the rename UX.
  Schema extends cleanly when needed.
- **Renaming `member_id`** — rejected by user. Append-only cube + driver
  formulas referencing the id mean rename is high blast radius. Alias
  layer is the substitute.
- **Reparenting members via PATCH** — rejected by user for v1. Saves
  cycle-check work. PATCH excludes `parent`.
- **Peer audit table `dim_change_log`** — rejected by user. Single
  audit_log table with `source` discriminator is the chosen shape.
- **Adding a `kind` column to `audit_log`** — considered but rejected.
  The existing `source` column already discriminates audit kinds
  (`submit`, `copy`, `driver`, etc.); reuse it.
- **Per-row `?force=true` for delete** — not implemented. Delete refuses
  if facts exist; user must clear them first via `/submit` or scenario
  copy. Simpler.
- **Driver formula edit UI** — out of scope. The `/drivers/define`
  endpoint is upsert (`INSERT OR REPLACE`) so re-defining replaces; no
  add-in surface for this yet.
- **Cell-level driver overrides** — Slice 11 territory.
- **`_Unset` sentinel pattern in `update_dim_member`** — tried, rejected.
  Type hints became awkward (`type[_Unset]` with `=...` default). Switched
  to a dict-based interface paired with Pydantic
  `model_dump(exclude_unset=True)`.
- **Tests for `DimensionManagerPanel`** — skipped. The panel is mostly UI
  orchestration; the pure logic (`dim_tree.ts`) is unit-tested. Manual
  end-to-end demo covers the rest.
- **Standalone `<TwoClickButton>` shared component** — both
  `DimensionManagerPanel` and `DefineDriverPanel` implement two-click
  confirm. Could dedupe; not worth it for v1.

---

## Known issues / TODOs

### Pre-existing (latent before Phase 2)

- **`vite.config.ts:18`** — `Parameter 'p' implicitly has an 'any' type.`
  Pre-existing. CI doesn't run `tsc --noEmit`, so it hasn't blocked
  anything. Fix: `(p: string)` annotation.

### Slice 8

- **Combobox display in multiselect mode** — Fluent v9 shows selected
  values comma-joined in the input box. Long lists look ugly. Acceptable
  for v1 scale; could control `value` to show "(N selected)" as a polish
  pass.
- **Inline-reason labels use dim names not pretty labels** — "entity,
  costcenter" rather than "Entity, Cost center". Minor.
- **`getRangeByIndexes(0, 0, 500, 50).clear()` is a fixed rectangle** —
  generous but wasteful at large workbook scale. `getUsedRange().clear()`
  would be more precise but requires an extra `context.sync` for the
  used-range introspection. Skipped to preserve the one-sync invariant.
- **`_smoke_decimal_unused` in `test_dimensions_endpoint.py`** — leftover
  dead function from a refactor. Remove on next visit.

### Slice 9

- **Edit form ordinal field shows "0", not the current ordinal** —
  `DimMemberInfo` doesn't currently surface `ordinal` (it's stored in
  `dim_member.ordinal` but not in `GET /dimensions/{dim}/members`
  response). User-facing UX: setting ordinal works, but you can't see
  the current value pre-edit. **TODO:** add `ordinal: int` to
  `DimMemberInfo`.
- **No client-side cycle check on parent picker in Add form** — backend
  rejects on POST anyway. Defer.
- **Two-click delete confirm is quick-and-dirty** — a Dialog would be
  safer for destructive ops. Acceptable for v1.
- **`update_dim_member` ignores unknown keys silently** — could be
  stricter (raise on unknown). v1 fine.
- **`_apply_migrations` is hand-rolled per column** — fine for now (2
  columns). If we add many more, switch to alembic/yoyo.
- **`cube.slice({dim: DimFilter(members=leaves)})` for fact-counting in
  DELETE** — reads all matching rows just to count them. Wasteful for
  large fact volumes. **TODO:** add a `cube.count_facts(filters)` method
  that uses `SELECT COUNT(*)`. v1 scale OK.
- **Seed members render as `id`** (display_name is NULL after migration).
  To onboard real names, either edit per-member via UI or extend
  `hierarchy_seed.py` and re-seed.

### Performance / scale notes

- DimModel reload-on-each-call is cheap at v1 scale (~30 dim members + a
  few drivers). Will need caching as the model grows.
- `audit_log` has no index on `source`. Queries that filter by source
  (e.g. "show me all dim_changes") will scan. v1 fine; add index when it
  matters.

### Operational

- Slice 9's CORS change (allow PATCH + DELETE) means the Vite dev proxy
  must also forward these methods correctly. Vite's default `proxy`
  config does, but worth knowing if you switch to a non-Vite dev server.

---

## What the next Phase needs to know

### Invariants to preserve (Phase 1 + Phase 2 cumulative)

These are the hard rules. Breaking any of them will surface as test
failures (most have a test pinning them) or, worse, silent math errors.

1. **Append-only cube.** No UPDATE / DELETE on `facts`. Latest
   `loaded_at` per intersection wins via `facts_current` view.
2. **Decimal-as-string on the wire.** DuckDB DECIMAL(20,6) → Pydantic
   Decimal → JSON string → TypeScript string.
3. **One batched range write + one `context.sync` per refresh.**
   `pivot.ts` is pure JS; only `refresh.ts` touches Office.js.
   `range.values =` write, plus queued `format.fill.color` and `clear()`
   calls, all flushed by the lone `await context.sync()`.
4. **Pydantic → TypeScript drift gate.** CI's `types-drift.yml` and the
   local `test_generated_ts_matches_committed` test enforce that the
   committed `generated.ts` matches what `generate_ts_types.py` produces.
   Run `.\tasks.ps1 types` after Pydantic changes.
5. **Submit goes leaf-only, can't write to driver accounts.** Slice 9
   added: undefining a driver re-legalizes manual submits to that
   account.
6. **`dim_model` + `calc_engine` reload on every request via
   `Depends(get_metadata)`** (gotcha #6 from Phase 1, still load-bearing).
7. **`member_id` is immutable** (Slice 9). Rename via `display_name`
   only. PATCH schema enforces this.
8. **`AuditRow` is a 12-element tuple** (Slice 9). Use the
   `build_*_audit_row` helpers. The shape-pin test catches accidental
   11-tuples.
9. **`source` discriminator vocabulary is fixed** — adding a new audit
   kind means adding a new source value (don't reuse existing ones).
10. **Office Settings keys are versioned** (`v1` suffix). New shape
    requires bumping to `v2` and writing a migration in the parser.

### Slice 10 (next, per plan)

Pivot UX flexibility: drag-and-drop axes via `@dnd-kit/core`, multi-dim
row + col axes (Vena-style stacked headers), configurable matrix anchor.

- **Backend zero-touch.** `/slice` already returns enough.
- **Add-in:**
  - `pivot.ts` extends to multi-axis tuples (cellMap keyed on a tuple,
    not a string).
  - `submit.ts` `LayoutDescriptor` extends to multi-axis.
  - Office Settings: `vena_lite.filters.v1` → `v2` with a one-shot
    migration in `parseFilterState` (read v1, single-axis values become
    single-element arrays).
  - New `AxisDesigner` replacing the current `FilterStrip` + two
    `AxisPicker`s. Three slots: Rows / Columns / Page. Drag chips
    between them.

### Slice 11 (after Slice 10)

Linked cells + per-intersection driver overrides.

- **Backend:**
  - `GET /value` (single-cell lookup; reuse `cube.lookup`)
  - `POST /overrides` — cube fact at a driver-account intersection that
    `recalc.py` learns to skip on recompute. Needs a flag on facts (e.g.
    `is_override BOOLEAN`) or a sentinel source string.
- **Add-in:**
  - Office.js custom function `=VENA(account, entity, ..., version)`
    registered via the manifest extension.
  - In-memory cache keyed on intersection; invalidated on every
    successful `/submit` and `/scenarios/copy` via `Application.calculate()`.
  - "Override" affordance in the taskpane when a single driver-computed
    cell is selected.

### Things you'd break if you didn't know

- **Schema migrations live in `_apply_migrations`** in
  [`metadata/store.py`](../../backend/src/vena_lite/metadata/store.py).
  Don't put migrations in `schema.sql` — that's the fresh-install schema
  only. Adding a new column means: update the CREATE TABLE in
  `schema.sql` AND add a guarded ALTER TABLE in `_apply_migrations`.
- **Extending `AuditRow`**: adding a column to `audit_log` requires
  updating the tuple type in `store.py`, the SQL in `append_audit_rows`,
  every `build_*_audit_row` builder in `audit.py`, all direct
  constructors, and the shape-pin test.
- **Extending `DimMemberRow`**: similarly, len-6 in Slice 9. Touch
  points: `cli.py`, `scenarios.py`, `hierarchy_seed.py`, `conftest.py`,
  `store.py` (insert / fetch SQL), `dim_model.py` (`__init__` unpack).
- **New pickers must use `memberLabelFromInfo(m)`** from `dim_tree.ts`
  for label rendering — it's the one place that handles the
  `display_name ?? id` fallback.
- **Office Settings key versioning** — new shape requires `v2` + a
  migration. Don't silently overwrite `v1`.
- **CORS `allow_methods`** — currently `[GET, POST, PATCH, DELETE,
  OPTIONS]`. New methods (PUT?) need `main.py` updated.
- **`client.ts` is the one fetch surface.** New endpoints get a typed
  wrapper there; don't inline fetch in components.

### Critical reading list (refresh of Phase 1's, with Phase 2 additions)

In order:

1. [`SPEC.md`](../../SPEC.md) — the domain contract.
2. [`CLAUDE.md`](../../CLAUDE.md) — the "never do this" list and entry points.
3. [`phase-1-handoff.md`](phase-1-handoff.md) — Phase 1 architecture.
4. **This file** — Phase 2 deltas.
5. [`backend/src/vena_lite/main.py`](../../backend/src/vena_lite/main.py)
   — wires the routes; one-screen overview.
6. [`backend/src/vena_lite/api/dimensions.py`](../../backend/src/vena_lite/api/dimensions.py)
   — Slice 9 CRUD pattern, including the audit + atomicity flow for
   non-submit kinds.
7. [`backend/src/vena_lite/audit.py`](../../backend/src/vena_lite/audit.py)
   — the canonical audit-row builders; mirror this pattern when adding
   new audit kinds.
8. [`backend/src/vena_lite/metadata/store.py`](../../backend/src/vena_lite/metadata/store.py)
   — `_apply_migrations` is the model for additive schema changes.
9. [`add-in/src/excel/pivot.ts`](../../add-in/src/excel/pivot.ts) — the
   pivot transform; Slice 10 will extend this.
10. [`add-in/src/excel/refresh.ts`](../../add-in/src/excel/refresh.ts) —
    the Office.js batching pattern, now with stale-cell clear.
11. [`add-in/src/components/DimensionManagerPanel.tsx`](../../add-in/src/components/DimensionManagerPanel.tsx)
    — the Slice 9 UI pattern (tree + edit + add); the form-to-request
    conversion is the part to study.

Then run `cd backend && uv run pytest -q` and `cd add-in && npm test` to
confirm green, then start the demo per the Phase 1 runbook.
