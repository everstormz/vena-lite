# Vena-lite — Phase 4 handoff

**Status:** Phase 4 complete. Single-slice UX refinement pass on top of
Phase 3 — no new vertical feature slice and **zero backend changes**, but
five interconnected user-facing improvements. **192 backend tests + 124
add-in tests passing**, ruff clean, Pydantic ↔ TypeScript drift gate
green. Single-user, localhost only.

Read this after [`phase-1-handoff.md`](phase-1-handoff.md),
[`phase-2-handoff.md`](phase-2-handoff.md), and
[`phase-3-handoff.md`](phase-3-handoff.md). Phase 4 is a delta on top.

---

## TL;DR

Phase 3 shipped a working multi-axis taskpane plus `=VENA.LOOKUP` and
overrides. Five concrete pain points remained:

1. **Cluttered taskpane.** 516-line `App.tsx`, four accordion panels
   stacked under a busy header, status messaging scattered in three
   places, two-click "Delete → Confirm" pattern that read as a glitch.
2. **Drivers panel forced you to pick an existing account.** A dropdown
   blocked the natural flow of "I want a new computed field called
   `Profit_Margin`."
3. **Submit-only data entry was confusing for new intersections.** If
   no fact existed yet at a target intersection, the Refresh-baseline-
   diff pipeline got in the way. There was no "just write this one
   value" path.
4. **No way to drill into hierarchies.** A user with `Total_PnL` as a
   parent saw only the rolled-up total — getting a breakdown required
   manually adding every leaf to the filter.
5. **Misleading error messages.** "No baseline. Click Refresh first."
   showed up after a successful 0-row refresh, which is a different
   problem.

Phase 4 closed all five:

- **Polished UI shell.** Sticky header + sticky toolbar + icon-led
  accordion. Six new shared components (`AppHeader`, `AppToolbar`,
  `StatusBar`, `SectionHeader`, `ConfirmDialog`, `EmptyState`).
  `@fluentui/react-icons` added as the icon source. App.tsx → ~360
  lines after factoring.
- **Inline driver-account creation.** Replaced the dropdown with a
  text Account ID input. If the typed id doesn't exist, the panel
  calls `POST /dimensions/account/members` (creates as a root-level
  leaf) before `POST /drivers/define` — one click from "I want a
  computed metric called X" to "X is computing." Smart hint badges
  flag the four cases (new / existing leaf / existing with driver /
  parent — backend will reject).
- **Cell tools sub-accordion.** Three sub-sections inside the existing
  Cell tools accordion: **Add a cell** (`QuickAddPanel` — pick the
  six dims, type a value, write directly via `/submit` with no
  Refresh), **Insert `=VENA.LOOKUP` formula** (`InsertLookupPanel` —
  same picker, builds the formula and pastes into the active cell or
  clipboard), **Override** (existing). All three share a new
  `IntersectionPicker` component (six leaf-only `MemberPicker`s).
- **Hierarchy drill** (Phase 4's biggest single feature). A "Drill
  into row hierarchy" Switch in the Layout section. When on, every
  selected row-axis member is expanded to its full subtree
  client-side; the slice response includes rolled-up parent rows AND
  per-leaf rows; the pivot emits them in post-order with depth-aware
  indentation; refresh.ts applies Excel-native `range.group("ByRows")`
  calls. The user collapses/expands subtrees with Excel's own +/−
  gutter — entirely Excel-native UI, no taskpane round-trip.
- **Better error wording.** "No baseline" message now distinguishes
  "0-row refresh" (the actual common case) from "never refreshed"
  (already gated by the Submit button).

The big architectural moves: **post-order traversal** for drill (because
Office.js doesn't expose `summaryRowsBelow`), **client-side filter
expansion** for drill (no backend hierarchy endpoint needed),
**CJS Jest preset** (so React component tests can render Fluent UI),
and a small **shared-component vocabulary** (`StatusBar`,
`ConfirmDialog`, `EmptyState`, `SectionHeader`, `IntersectionPicker`)
that future panels will reuse.

---

## What was built

Phase 4 doesn't fit the slice model of Phases 1–3 — it's a single
polish pass, presented here as five themes. All shipped together.

### Theme 1 — Polished taskpane shell

**Ship:** sticky header + sticky toolbar + icon-led accordion
sections. New shared component vocabulary used across the rewritten
existing panels.

**Tests:** 91 → 104 add-in (+13: 7 ConfirmDialog + 6 StatusBar). 192
backend unchanged.

**New files:**

- [`add-in/src/components/AppHeader.tsx`](../../add-in/src/components/AppHeader.tsx)
  — title + scenario/version chips (read from filterState single
  selections) + Settings icon placeholder
- [`add-in/src/components/AppToolbar.tsx`](../../add-in/src/components/AppToolbar.tsx)
  — primary Refresh + Submit buttons with leading icons + a single
  validation caption (consolidates Phase 3's two scattered
  `<Text className={styles.reason}>` lines)
- [`add-in/src/components/StatusBar.tsx`](../../add-in/src/components/StatusBar.tsx)
  — wraps Fluent v9 `MessageBar`. Three intents (success / error /
  loading). Replaces panel-internal `{kind: "ok" | "error", msg}`
  status renders. Exports the shared `Status` type.
- [`add-in/src/components/SectionHeader.tsx`](../../add-in/src/components/SectionHeader.tsx)
  — icon + label + optional count badge for `<AccordionHeader>` content
- [`add-in/src/components/ConfirmDialog.tsx`](../../add-in/src/components/ConfirmDialog.tsx)
  — wraps Fluent `<Dialog>`. Replaces (a) the inline submit-confirm
  dialog markup in App.tsx, (b) the two-click delete patterns in
  DimensionManagerPanel + DefineDriverPanel
- [`add-in/src/components/EmptyState.tsx`](../../add-in/src/components/EmptyState.tsx)
  — icon + title + hint. Used in DriversPanel (no drivers) and
  OverridePanel (no cell inspected)

**Modified files:**

- [`add-in/src/App.tsx`](../../add-in/src/App.tsx) — extracted header
  + toolbar; replaced inline submit dialog with `<ConfirmDialog/>`;
  Cell tools accordion item now hosts a sub-accordion (see Theme 3);
  `Status` type relocated to StatusBar
- [`add-in/src/components/AxisDesigner.tsx`](../../add-in/src/components/AxisDesigner.tsx)
  — chip layout reworked: drag handle + label + ✕ remove button per
  chip; `mergeClasses` instead of string concat; sub-accordion holds
  the six MultiMemberPickers under "Filters"; new `<DrillToggle/>`
  (see Theme 4)
- [`add-in/src/components/CopyScenarioPanel.tsx`](../../add-in/src/components/CopyScenarioPanel.tsx)
  — From → To two-column layout with arrow icon between
- [`add-in/src/components/DefineDriverPanel.tsx`](../../add-in/src/components/DefineDriverPanel.tsx)
  — see Theme 2
- [`add-in/src/components/DimensionManagerPanel.tsx`](../../add-in/src/components/DimensionManagerPanel.tsx)
  — inline-mid-tree edit form gone. Per-row Edit button now opens a
  proper `<Dialog>`. Tree row indent uses
  `paddingInlineStart: depth * spacingHorizontalM` instead of NBSP
  prefixes. Add-member form moved to a collapsed sub-Accordion.
- [`add-in/src/components/OverridePanel.tsx`](../../add-in/src/components/OverridePanel.tsx)
  — Inspected cell shows `<Badge>` for overridden / driver state.
  EmptyState rendered before inspect.
- [`add-in/index.html`](../../add-in/index.html) — loading skeleton
  matches new Segoe UI / 600-weight title aesthetic
- [`add-in/jest.config.cjs`](../../add-in/jest.config.cjs) — switched
  from `ts-jest/presets/default-esm` to `ts-jest/presets/default`
  (CJS) so Jest's resolver picks Fluent's `lib-commonjs` bundles
  via `package.json` `main`. See Architectural decisions for why.
- [`add-in/jest.setup.cjs`](../../add-in/jest.setup.cjs) (new) —
  `ResizeObserver`, `IntersectionObserver`, `matchMedia` polyfills
  for jsdom

**Dependencies added:**

- `@fluentui/react-icons: ^2.0.325` (production)

### Theme 2 — Inline driver-account creation

**Ship:** the Drivers panel's "Output account" dropdown is gone.
Replaced with an Account ID text input that auto-creates the
account if it doesn't exist. Smart hint badges show what'll happen.

**Tests:** no test changes (panel logic is straightforward).

**Key file:** [`add-in/src/components/DefineDriverPanel.tsx`](../../add-in/src/components/DefineDriverPanel.tsx)

**Flow:** on the Define click, the panel checks if `accounts.some(a =>
a.id === trimmedId)`. If not, it calls `addDimMember("account", {
id, display_name, parent: null, ordinal: 0, rollup_op: "sum" })`,
then calls `defineDriver({ account: id, formula })`. Both happen in
the same async handler. If the account exists, the addDimMember call
is skipped. If the account exists AND has a driver already,
`defineDriver` is upsert (`INSERT OR REPLACE`) and just replaces the
formula.

**Hint badges** (using Fluent `<Badge>` in the Field's `hint` slot):

| State | Badge color | Text |
|---|---|---|
| New id (not in `accounts`) | informative | "New — will be created as a root-level leaf account." |
| Existing leaf, no driver | informative | "Existing leaf account." |
| Existing with driver | warning | "Already has a driver — defining replaces the formula." |
| Existing parent | warning | "This is a parent account — drivers must be on leaves. Backend will reject." |

**Display name field** is rendered conditionally — only when the id is
new. Updating an existing account's display_name is the Dimensions
panel's job.

**Button label adapts**: `"Create account & define driver"` when new,
`"Define driver"` when reusing. Provides instant feedback that the
panel will do two things.

### Theme 3 — Cell tools sub-accordion

**Ship:** the Cell tools accordion item is now a container for three
sub-tools. Adds two new write paths that bypass the Refresh-baseline-
diff pipeline entirely.

**Tests:** no new test files; the new panels are UI orchestration over
existing API calls (matching the Slice 9 / Slice 11 pattern of skipping
panel-level tests).

**New files:**

- [`add-in/src/components/IntersectionPicker.tsx`](../../add-in/src/components/IntersectionPicker.tsx)
  — six stacked `MemberPicker`s. Controlled component. Exports
  `PartialIntersection` type and `isComplete()` guard. Reusable for
  future panels that need a manually-assembled intersection.
- [`add-in/src/components/QuickAddPanel.tsx`](../../add-in/src/components/QuickAddPanel.tsx)
  — IntersectionPicker + value Input + "Add cell" button. Calls
  `submitDeltas({ cells: [{ ...intersection, value }] })` for a
  single-cell write. Triggers `application.calculate("Full")` after
  success so `=VENA.LOOKUP` cells refetch.
- [`add-in/src/components/InsertLookupPanel.tsx`](../../add-in/src/components/InsertLookupPanel.tsx)
  — IntersectionPicker + live formula preview + Insert / Copy
  buttons. Writes the formula into the selected cell via
  `sel.getCell(0, 0).formulas = [[formula]]` so a multi-cell range
  selection still works (uses the top-left).

**Modified file:**

- [`add-in/src/App.tsx`](../../add-in/src/App.tsx) — Cell tools
  AccordionItem now contains `<Accordion collapsible
  defaultOpenItems={["add"]}>` with three sub-items: Add a cell /
  Insert =VENA.LOOKUP formula / Override an existing cell. Helper
  `intersectionFromFilters(state)` derives a partial intersection
  from single-selection page filters, passed as
  `initialIntersection` to QuickAdd and InsertLookup so they're
  pre-filled with the user's current filter context.

### Theme 4 — Hierarchy drill

**Ship:** Vena/Anaplan-style row-axis drill. Excel's outline gutter
provides the +/− interaction natively.

**Tests:** 104 → 124 add-in (+20: 13 hierarchy + 3 pivot + 4
refresh). 192 backend unchanged.

**New file:** [`add-in/src/excel/hierarchy.ts`](../../add-in/src/excel/hierarchy.ts)
— pure JS helpers:

- `subtreePostOrder(rootId, members)` — depth-first post-order
  traversal of a subtree. Returns `[...descendants, rootId]`.
- `depthsFromRoots(roots, members)` — `Map<memberId, number>` of
  depth relative to the closest root in the input set. BFS.
- `expandToSubtree(filterIds, members)` — for each filter id, expand
  to its subtree post-order; dedupe; preserve user's pick order at
  the top level.
- `groupingRanges(depths)` — `Map<level, GroupRange[]>` of contiguous
  row index ranges where `depth >= level`. Drives the
  `range.group("ByRows")` calls in refresh.ts.

**Modified files:**

- [`add-in/src/excel/pivot.ts`](../../add-in/src/excel/pivot.ts) —
  new `AxisHierarchy` and `PivotOpts` types. When
  `opts.rowsHierarchy` is supplied AND `axes.rows.length === 1`, row
  tuples are sorted in `hierarchy.order` (post-order) instead of
  alphabetic, and each data row carries its `depth` in the new
  `rowDepths` field. Indent prefix (2 spaces × depth) prepended to
  the first row label cell.
- [`add-in/src/excel/refresh.ts`](../../add-in/src/excel/refresh.ts)
  — accepts `opts: PivotOpts`, passes through to `buildPivot`. After
  the matrix write (still inside the same `Excel.run` block, still
  ONE `await context.sync()`), walks the depth array and calls
  `range.group("ByRows")` outer-level-first for nested outline
  groups. **Pre-clear pattern**: 8 ungroup calls on the clear range
  before grouping, so toggling drill off → on → off doesn't leave
  leftover groups.
- [`add-in/src/components/AxisDesigner.tsx`](../../add-in/src/components/AxisDesigner.tsx)
  — adds `<DrillToggle/>` Switch below the three lanes. Only enabled
  when `axes.rows.length === 1` (multi-dim stacked drill is out of
  scope for v1). Hint adapts: "needs a Rows dim" / "needs single-dim
  Rows" / "expands subtree" / "show parents alongside children."
- [`add-in/src/App.tsx`](../../add-in/src/App.tsx) — `drillRows`
  state. On Refresh, if drill is on AND row axis is single-dim, the
  filter for that dim is replaced with `expandToSubtree(...)` and
  the slice request goes out with the expanded list. Backend's
  `aggregate_to_requested` does the right thing — emits a row per
  requested member with sum-rollup for parents.

**Backend: no changes.** `/slice` already supported arbitrary multi-
member filters with parent expansion + per-member aggregation since
Slice 4. The drill feature is entirely client-side.

### Theme 5 — "No baseline" message clarification

**Ship:** the misleading "No baseline. Click Refresh first." error
text is gone. Replaced with the actual diagnosis.

**Modified file:** [`add-in/src/App.tsx`](../../add-in/src/App.tsx) —
the `Object.keys(baseline).length === 0` branch now reads:

> "Last refresh returned 0 cells, so there's nothing to diff against.
> Widen your filters and refresh again, or use Cell tools → Add a cell
> to write a fresh value directly."

The `lastLayout` gate above the baseline check guarantees
`lastLayout !== null` at this point, so the only way to reach the
empty-baseline branch is a 0-row refresh.

---

## Architectural decisions & why

### Post-order traversal for drill (Phase 4)

**Problem.** OLAP-style drill (parent above children, +/− on the
parent row) is the Vena/Anaplan convention. Excel's row outline
grouping has a single direction parameter, "Summary rows below
detail" (`xlSummaryBelow` in VBA), which controls whether the +/−
gutter icon appears next to the row above or below the group. The
default is "below detail" — meaning the +/− shows next to the LAST
row of the group, which is implicitly the "summary."

**Solution.** Office.js (`@types/office-js@^1.0.580`) doesn't expose
`summaryRowsBelow` as a settable property. There's no JS API to flip
the direction programmatically. Rather than ship a janky pre-order
layout where the +/− gutter icon ends up in a confusing spot
(between groups, not on the parent row), we use **post-order**
traversal: descendants first, parent last. With "summary below
detail" ON (the unchangeable default), the parent row is the last
row of its subtree, and the +/− lands next to it — exactly where
users expect.

**Why this is also fine UX:**

- Matches the "subtotals at the bottom" convention in financial
  reports (income statements, balance sheets).
- Indent makes the hierarchy obvious even before collapsing
  (children get more indent, parent flush left at the bottom).
- Excel's collapse hides the children block; the parent row stays
  visible at its position.

**Rejected: pre-order (parent above children).** Standard OLAP shape,
but the +/− gutter icon would land on the row AFTER the group (next
parent or empty). Visually confusing. Documented as the v1
limitation in the drill toggle's hint text.

**Rejected: setting summaryRowsBelow via undocumented Office.js
properties / proxy hacks.** Tried; no public API surface for it.
`worksheet.outline` doesn't exist in the type definitions. Future
Excel-JS-API release may expose it (1.10+ added some outline APIs;
worth checking in v2).

### Client-side filter expansion for drill (Phase 4)

**Problem.** When the user has `account: [Total_PnL]` selected and
toggles drill, the response needs to include both the rolled-up
`Total_PnL` row AND each leaf descendant. The cube has only leaves;
parents are computed at read time.

**Solution.** Client-side: `expandToSubtree(["Total_PnL"], members)`
walks the dim tree to produce `["4000_Revenue", "5000_OpEx",
"Total_PnL"]` (post-order). The slice filter is sent with this
expanded list. The backend's existing `aggregate_to_requested`
emits one row per requested member, computing the sum from leaves.

**Why this is the right shape:**

- Backend stays untouched. /slice's hierarchy semantics already
  handle this.
- The client owns the dim model anyway (`dimensionsByName` is
  fetched at mount and refreshed on every dim CRUD), so subtree
  computation is local — no extra round-trip.
- The order of the filter list is the order the response rows
  appear in (the backend preserves the request order in
  `aggregate_to_requested`'s output). So post-order in → post-order
  out, and pivot.ts's hierarchy-aware sort just confirms what the
  backend already produced.

**Rejected: backend "include hierarchy" flag.** Would have required a
new `SliceRequest.include_rollups: boolean` field, schema bump,
generated TS types, and modifications to `query.aggregate_to_requested`
to walk ancestors. The client-side expansion approach is simpler and
the dim-model-on-client invariant was already in place.

### Excel-native +/− grouping vs. taskpane controls (Phase 4)

**Problem.** Where do the expand/collapse controls live? The two
options:
- **Excel's outline gutter** (left-hand margin shows +/− next to
  parent rows; Excel handles row hide/show automatically when
  clicked).
- **Taskpane controls** (per-parent toggle in the Layout section;
  toggling re-fetches and re-renders the pivot).

**Solution.** Excel's outline gutter. `range.group("ByRows")` produces
this for free. State lives in the .xlsx itself (Excel persists
outline level + collapse state with the workbook). No taskpane
state to manage; no React re-renders on every click; no round-trips
to the backend.

**Why this is the right shape:**

- Native Excel feel — users already know how to use +/−.
- Zero state management in React for what gets shown.
- Excel's outline supports up to 8 nested levels and is perf-
  optimized for that.
- Free persistence: drill state survives saving and reopening the
  workbook, even if the taskpane drill toggle resets.

**Trade-off:** the Excel-native UI doesn't easily expose programmatic
"start collapsed" — we'd need `worksheet.showOutlineLevels(...)`
which is per-worksheet, not per-group. Default is fully expanded.
Acceptable for v1.

**Rejected: per-parent expand toggle in taskpane.** More dev work
(state, re-render logic, persistence to Office Settings if you
want it to survive reopens), worse UX (taskpane already busy), and
forces a round-trip on every click (because the pivot has to
re-render).

### Source-side dim member creation in Drivers (Phase 4)

**Problem.** Pre-Phase-4, defining a driver required the account to
already exist. Users had to go to the Dimensions panel, add the
member, come back to Drivers, define the formula. Two-trip flow
for what feels like a single intent ("create a computed metric
called X").

**Solution.** The DefineDriverPanel composes `addDimMember` +
`defineDriver` client-side. Detects "is this id new?" from the
`accounts` prop, calls addDimMember conditionally, then defineDriver
unconditionally. New account is a root-level leaf with no parent
(`parent: null`).

**Why this is the right shape:**

- Both endpoints are already public and well-tested.
- Client-side composition is idempotent under retry only if
  addDimMember is idempotent — it isn't strictly (POST creates a
  new audit row each time), but the dim_member PRIMARY KEY catches
  the duplicate, returning a 409 that the client could handle. We
  don't currently retry, so this is theoretical.
- The new-account default (root-level, ordinal 0) is a reasonable
  starting point; user can re-parent via the Dimensions panel.

**Rejected: a new backend endpoint `POST /drivers/define` with
`auto_create_account: true`.** Would have required schema work and
duplicates the addDimMember logic. Client-side composition is
simpler at v1 scale.

### Sub-accordion inside Cell tools (Phase 4)

**Problem.** Adding three new write paths (Add cell / Insert formula
/ Override) to the taskpane could either be:
- Three top-level accordion items (Layout / Scenarios / Drivers /
  Dimensions / **Add cell** / **Insert formula** / **Override**) →
  7 top-level items, busy
- One Cell tools accordion item with three sub-items

**Solution.** Sub-accordion. Phase 3's "Cell tools" header keeps its
position; expanding it reveals three sub-Accordion items. Default
opens "Add a cell" (the most common use case after a successful
Refresh fails to capture an empty intersection).

**Why this is the right shape:**

- Top-level accordion stays at 5 items (Layout / Scenarios / Drivers
  / Dimensions / Cell tools).
- Mental grouping is preserved — all three sub-tools operate on
  individual cells.
- Only one sub-tool form is visible at a time, less cognitive load.

**Trade-off:** two clicks to reach Override now (expand Cell tools
+ expand Override). For Override-heavy workflows this adds friction.
Acceptable since Add cell is the more common entry point.

### CJS Jest preset for Fluent UI tests (Phase 4)

**Problem.** Phase 3's jest.config.cjs used
`ts-jest/presets/default-esm` (ESM mode). Fluent v9
(`@fluentui/react-components`) ships ESM at `lib/index.js` and CJS
at `lib-commonjs/index.js`. Jest's resolver in ESM mode picks the
ESM path, but Jest can't parse the `export` keyword without
transformers. Adding component tests for `<ConfirmDialog/>` and
`<StatusBar/>` triggered "Unexpected token 'export'" errors.

**Solution.** Switched to `ts-jest/presets/default` (CJS). With ESM
mode off, Jest's resolver respects each Fluent package's `main`
field (`lib-commonjs/index.js`), which is plain CJS and parses
fine. ts-jest is configured with `module: "commonjs"` in its inline
tsconfig.

**Why this is the right shape:**

- Zero `moduleNameMapper` hacks (the ESM-mode workarounds chained
  per-package mappings to redirect to lib-commonjs subpaths, and
  broke on transitive `@fluentui/react-icons/lib/providers`
  requires).
- ts-jest's CJS preset is the well-trodden path for Fluent v9 +
  Jest. The Fluent docs use it.
- Existing 91 tests (pure JS, no React) pass on either preset; the
  switch was lossless.

**Rejected: `ts-jest/presets/js-with-ts-esm` + transformIgnorePatterns
exception for Fluent packages.** Tried; fights the resolver because
.js files in Fluent packages require ESM transformation, but the
implementation is brittle.

**Rejected: babel-jest for .js files in node_modules.** Adds a
dependency for marginal benefit.

**Rejected: ESM mode + moduleNameMapper redirects to lib-commonjs.**
Got it 80% working, but transitive imports kept slipping through
(every Fluent sub-package would need its own mapping). Maintenance
burden too high.

### Polyfill jsdom for Fluent component tests (Phase 4)

**Problem.** Fluent's `MessageBar` calls `ResizeObserver` in a layout
effect; `Combobox` and `Dropdown` use `IntersectionObserver`;
several components query `window.matchMedia`. jsdom doesn't ship
any of these.

**Solution.** [`add-in/jest.setup.cjs`](../../add-in/jest.setup.cjs)
provides no-op shims. Wired via `setupFiles: ["<rootDir>/jest.setup.cjs"]`
in jest.config.cjs.

**Why this is the right shape:**

- Single setup file, no per-test boilerplate.
- No-op shims are sufficient because tests assert on rendered output,
  not on layout-effect behavior.
- Future Fluent component tests just work without re-discovering this.

### `<ConfirmDialog/>` shared component (Phase 4)

**Problem.** Phase 1–3 had three different "are you sure?" patterns:
- Submit confirm: a Fluent `<Dialog>` inlined in App.tsx with a
  scrollable delta list
- Driver undefine: two-click "Undefine" → "Confirm" button toggle
- Member delete: same two-click pattern in DimensionManagerPanel

The two-click pattern is unclear (looks like a glitch on first
encounter). The inline submit-dialog markup duplicated what would
become a shared component.

**Solution.** [`add-in/src/components/ConfirmDialog.tsx`](../../add-in/src/components/ConfirmDialog.tsx)
wraps Fluent's `<Dialog>` with props: `{ open, title, body,
confirmLabel?, destructive?, busy?, onConfirm, onCancel }`.
Destructive prop adds a Delete icon to the confirm button + a
Warning icon to the title. Busy prop disables both buttons (used
by panels that want to keep the dialog open during the async
action).

**Used by:**
- App.tsx submit-confirm (replaces inline markup)
- DefineDriverPanel undefine-confirm (replaces two-click)
- DimensionManagerPanel delete-confirm (replaces two-click)

**Why this is the right shape:**

- Fluent v9's `<Dialog>` already handles focus management,
  keyboard nav (Escape to cancel), and overlay rendering via
  Portal. Wrapping it in a thin component just standardizes the
  prop shape.
- One file to update if we ever want to add an "undo" affordance,
  a confirmation timer, or a "don't ask again" checkbox.

---

## Data models / schemas

**No backend changes.** Phase 4 is entirely client-side polish + drill.
Backend tests at 192 by inspection; nothing modified.

**No new wire types.** Pydantic schemas unchanged.

**No new persisted state shape.**

- Office Settings keys: `vena_lite.baseline.v1`, `vena_lite.filters.v2`
  — both unchanged from Phase 3.
- The drill state (`drillRows: boolean`) lives in React only. Reset to
  false on every taskpane mount. Intentionally not persisted (see
  Considered & rejected).

**Component contracts** (the new shared types worth knowing):

```ts
// StatusBar.tsx
export interface Status {
  kind: "idle" | "loading" | "ok" | "error";
  message?: string;
  what?: string;  // "init" | "refresh" | "submit" | "copy" | ...
}

// IntersectionPicker.tsx
export type PartialIntersection = Partial<ValueIntersection>;
export function isComplete(v: PartialIntersection): v is ValueIntersection;

// pivot.ts
export interface AxisHierarchy {
  order: string[];                // post-order traversal of axis members
  depth: Map<string, number>;     // member id → depth (0 = root)
}
export interface PivotOpts {
  rowsHierarchy?: AxisHierarchy;  // applies only when axes.rows.length === 1
}
export interface PivotResult {
  matrix: (string | number)[][];
  driverFillCoords: FillCoord[];
  headerRowCount: number;
  rowDepths: number[];            // length = sortedRows.length, all 0 if no hierarchy
}

// hierarchy.ts
export interface GroupRange { start: number; length: number; }
```

---

## Considered & rejected

### Theme 1 (UI shell)

- **Three top-level Cell tools accordion items.** Rejected — would
  push top-level navigation to 7 items. Sub-accordion preserves the
  5-item structure.
- **`@testing-library/jest-dom` matchers** (`toBeInTheDocument()`).
  Rejected — would have required a `setupFilesAfterEach` entry and
  per-test imports. Plain Jest matchers (`queryByText(...).not.toBeNull()`)
  are sufficient for our component-test depth.
- **Dark mode toggle.** Rejected for v1; theme is hardcoded to
  `webLightTheme`. Adding a toggle requires a theme context, a
  Settings menu (today the gear icon is a placeholder), and visual
  QA of every panel in dark mode. Out of scope.
- **Manifest TaskpaneWidth setting.** Not a manifest v1.0 field;
  Excel uses its default width. The redesign assumes ~320px.
- **Auto-dismiss success status after N seconds.** Considered for
  StatusBar; rejected — explicit messages help users learn the model
  ("Refreshed 96 cells, account × period, 240 ms.").

### Theme 2 (driver inline-create)

- **Combobox with allowFreeform.** Considered allowing the user to
  either pick an existing account from a dropdown OR type a new id.
  Rejected — Fluent v9's Combobox `freeform` mode has UX quirks
  (the new value isn't always preserved on blur), and the smart
  hint badge approach handles all four cases (new / existing leaf
  / existing with driver / parent) with a plain Input.
- **A new backend endpoint that creates account + driver in one
  shot.** Rejected — duplicates existing endpoint logic, and the
  client-side composition is straightforward.

### Theme 3 (Cell tools sub-accordion)

- **IntersectionPicker as a tree-aware picker** (collapsible
  hierarchy + select). Rejected for v1 — `MemberPicker` (single-
  select, leaves only) is enough for now. Re-evaluate once dim
  trees deepen.
- **Quick Add auto-creating new dim members from picker text.**
  Rejected — keeps the panel's contract simple ("submit to an
  existing intersection"). For new members, users go to Dimensions
  panel first.
- **InsertLookupPanel writing to multiple cells in a selection.**
  Rejected — would require a UI for "fill mode" (same formula
  vs. interpolated members). Top-left cell only is the simple
  contract.

### Theme 4 (drill)

- **Pre-order traversal (parent above children).** Rejected — see
  Architectural decisions. Office.js can't flip Excel's summary
  direction, so the +/− gutter icon would end up in a confusing
  spot.
- **Stacked-axis drill.** Rejected for v1 — the post-order traversal
  is ambiguous when rows is `[account, costcenter]`: do you walk
  account hierarchy first, or costcenter first, or both? Punt to
  v2 if needed; for now, `<DrillToggle/>` requires
  `axes.rows.length === 1` and shows a hint when not satisfied.
- **Cols drill.** Same arguments as stacked-axis. Adds a second
  `colsHierarchy` to PivotOpts and a second axis-grouping
  computation. Out of scope.
- **Persisting drill state to FilterState v3.** Rejected — drill is
  a view preference, and the cost of a schema bump (parser update,
  v2 → v3 migration, generated.ts changes) outweighs the benefit
  for v1. Re-evaluate if users want it.
- **Backend "include hierarchy rollups" flag.** Rejected — see
  Architectural decisions. /slice already handles it.
- **Auto-expanding drill on first parent select.** Rejected —
  explicit user toggle is more discoverable and respects user
  intent.
- **Taskpane-side expand/collapse controls per parent.** Rejected
  in favor of Excel's outline gutter. See Architectural decisions.

### Theme 5 (error wording)

- **Parsing INTERSECTION_INVALID error responses for friendly
  StatusBar rendering.** Considered after the user hit a multi-cell
  rejection. Deferred — would require client-side error parsing
  (`reason` grouping, cell-index mapping back to row/col positions).
  Tracked under Known issues.

---

## Known issues / TODOs

### Theme 1 (UI shell)

- **Settings gear icon in `AppHeader` is a placeholder** — clicks do
  nothing. No menu yet. When we have preferences (theme, default
  scenario, etc.), this is where they go.
- **`<Badge>` in `<Field hint>` is technically a type abuse** — the
  `hint` prop expects a string. Fluent renders the badge JSX fine,
  but type-checking only works because we're casting via `ReactNode`.
- **`@testing-library/jest-dom` not enabled.** Tests use
  `expect(screen.queryByText(...)).not.toBeNull()` instead of the
  more readable `.toBeInTheDocument()`. Easy upgrade if we want it.

### Theme 2 (driver inline-create)

- **New accounts default to `parent: null` (root-level).** If users
  want their new computed accounts under `Total_PnL`, they need to
  re-parent via the Dimensions panel. Not awful, but adds a step.
  A future enhancement: "Place under" picker in DefineDriverPanel.
- **No cycle-pre-check.** If you type a formula that would cycle, the
  backend rejects with a 400 at define time (existing behavior). UX
  could surface this earlier (parse the formula client-side, list
  identifiers, check against existing driver dependencies). Not
  worth the complexity for v1.
- **No formula syntax highlighting / autocomplete.** Plain Textarea.
  Future: a tiny editor that knows the account ids and `+ - * /`
  grammar.

### Theme 3 (Cell tools)

- **Quick Add doesn't auto-create new dim members.** If the user
  picks an unfamiliar combination, they have to add the member via
  Dimensions panel first. Acceptable v1 limitation; we can layer
  auto-create on the IntersectionPicker if the friction is real.
- **InsertLookupPanel writes only into the top-left of a multi-cell
  selection.** Multi-cell fill (same formula across the range)
  would be a one-line change but could surprise users.
- **Clipboard copy uses `navigator.clipboard.writeText`** — which is
  a Promise that may reject on older WebView2 versions or if the
  taskpane isn't focused. Wrapped in try/catch; falls back to the
  status error. Enough for v1.

### Theme 4 (drill)

- **Excel's "Summary rows below detail" must stay ON for the +/− to
  appear next to parent rows.** This is the default; if the user
  toggles it off in Data → Outline → settings, the +/− gutter ends
  up in the wrong spot. Document this in user docs (we don't have
  any yet).
- **Drill state resets every taskpane reload.** A user who toggles
  drill, refreshes, saves the workbook, closes Excel, reopens —
  Excel groups persist (good!) but the drill toggle is back to off
  (less ideal — toggling it on again then refreshing will replace
  the groups). Persist to FilterState v3 in v2 if real users complain.
- **No way to set a default expansion level.** Excel's
  `worksheet.showOutlineLevels(rowLevels, columnLevels)` could
  collapse to depth N initially. Refresh.ts doesn't call it; the
  user sees the full subtree expanded by default. A "start
  collapsed" toggle next to the drill switch would be cheap to add.
- **Multi-cell drill labels in the row label column include indent
  spaces.** The submit reader (`submit.ts`) uses `String(row[0]
  ?? "").trim()` for row label cells, which strips them safely. But
  if the indent character ever changes from space, submit would
  need updating in lockstep.
- **Excel grouping max 8 levels.** Hierarchies deeper than 8 will
  silently fail to group beyond level 8. Demo hierarchy is 3
  levels max; not a real concern at v1.
- **`range.ungroup("ByRows")` called on a flat range is a silent
  no-op.** Refresh.ts calls it 8 times unconditionally to wipe any
  prior outline. If Office.js ever changes this to throw, the
  cleanup pattern breaks.

### Theme 5 (error wording)

- **INTERSECTION_INVALID multi-cell rejection still dumps raw JSON
  in StatusBar.** A friendly parser ("12 cells rejected: Gross
  Profit is driver-controlled — use Override instead.") would
  improve UX dramatically. Deferred.

### Operational

- **Vite dev server's `strictPort: true` (Phase 3) means a stale
  Vite from a prior session blocks startup.** Phase 4 work
  occasionally hit this — find via `Get-NetTCPConnection
  -LocalPort 3000`, kill the PID, restart.
- **CJS Jest preset means tests run faster but `import` syntax in
  test files is transpiled to `require`.** Pre-existing tests had
  no issue; but if a future test imports a package that's
  ESM-only with no CJS build, that test will fail to resolve.
  Workaround: per-test `moduleNameMapper`.

---

## What the next Phase needs to know

### Invariants to preserve (cumulative)

Phases 1–3's invariants 1–18 still hold. Plus:

19. **Backend untouched in Phase 4.** /slice's "expand parents to
    leaves, aggregate to requested members" semantics is what makes
    drill work without backend changes. Don't simplify
    `aggregate_to_requested` to "leaves only" without first
    replacing the client-side drill expansion.
20. **Hierarchy drill uses post-order traversal.** Don't switch to
    pre-order without first verifying that Office.js can set
    `summaryRowsBelow = false`. The +/− gutter icon position
    depends on this.
21. **`range.ungroup("ByRows")` × 8 in refresh.ts is the cleanup
    pattern.** Removing it leaves stale outline groups across drill
    toggle on/off cycles.
22. **Drill is rows-only AND single-dim only.** `<DrillToggle/>`'s
    `supported` predicate enforces this. Don't try to drill on
    multi-dim or col axes without redesigning.
23. **Drill state is NOT persisted.** Office Settings shape is still
    v2 (filters, axes). If you persist drill in v3, write the v2 →
    v3 migration in `parseFilterState`.
24. **`<ConfirmDialog/>` is the canonical destructive-action UI.**
    Two-click button toggles are out. New destructive endpoints get
    a ConfirmDialog wrapper.
25. **`<StatusBar/>` is the canonical status sink.** Per-panel
    `<Text className={styles.error}>` should not return — use the
    shared `Status` type.
26. **`<IntersectionPicker/>` is the canonical 6-dim picker.** Reuse
    it for any future panel that assembles a full intersection.
27. **`@fluentui/react-icons` is on the production dependency
    list.** Verify icon names exist before importing — naming is
    `<Name><Size><Style>` (e.g. `Calculator24Regular`); not all
    sizes exist for every icon. Use `node -e "const f =
    require('@fluentui/react-icons'); console.log('X' in f);"`
    to check.
28. **Jest preset is `ts-jest/presets/default` (CJS).** Don't switch
    back to ESM without re-doing the Fluent UI moduleNameMapper
    work. The setup file
    [`add-in/jest.setup.cjs`](../../add-in/jest.setup.cjs)
    polyfills `ResizeObserver`, `IntersectionObserver`, and
    `matchMedia` for jsdom — required for any test that renders a
    Fluent component.
29. **Griffel `makeStyles` rejects bare numbers in CSS values.**
    `padding: 2` is a type error; use `padding: "2px"` or a Fluent
    token (`tokens.spacingHorizontalXS`). Phase 4 hit this several
    times during initial component creation.
30. **Driver inline-create makes new accounts root-level leaves.**
    `parent: null`, `ordinal: 0`, `rollup_op: "sum"`. If the
    default ever changes, update DefineDriverPanel.tsx's
    `onDefine` handler.

### Phase 5 candidates

Carrying forward Phase 1–3's deferred directions plus new ones from
Phase 4:

- **Stacked-axis drill.** Pre-Phase-5 design question: which dim's
  hierarchy comes first, and how do we visualize a 2D-tree (row =
  [accountSubtree × costcenterSubtree])? Vena does this; worth a
  look.
- **Drill on cols.** Symmetrical to rows, easier than stacked.
- **Persist drill state in FilterState v3.** Adds the schema bump,
  v2 → v3 migration, drill toggle remembers last state across
  reopens. ~50 lines.
- **Friendly INTERSECTION_INVALID error parsing.** Group rejected
  cells by `reason`, show actionable hints ("12 cells rejected:
  Gross Profit is driver-controlled. Use Cell tools → Override").
  ~40 lines in client.ts + StatusBar adapter.
- **Audit-log viewer in the taskpane.** Phase 2 deferred
  Direction B. Reuse the dim_member CRUD pattern: a new accordion
  item that fetches `GET /audit?source=...&limit=...` and renders
  rows. New backend endpoint needed.
- **Multi-cell override.** Phase 3 §Slice 12 candidate. Today's
  OverridePanel handles one cell at a time.
- **Settings menu wiring.** Today the gear icon in AppHeader is a
  placeholder. Hooks for: theme toggle, default scenario,
  units/locale, "show driver hint banner".
- **CSV importer for chart of accounts.** Phase 1 Direction A.
  Real planning needs real data.
- **Auth + remote deployment.** Phase 1 Direction C. Largest
  scope.

### Things you'd break if you didn't know

- **Adding a new accordion item without `<SectionHeader/>` in the
  header looks out of place.** All Phase 4 accordion items use
  `<SectionHeader icon={...} label="..."/>` for consistency.
- **`useStyles` patterns require all CSS values to be strings or
  Fluent tokens — no bare numbers.** Griffel rejects them at type-
  check time.
- **The Jest setup file polyfills (`jest.setup.cjs`) are required
  for any test that renders a Fluent component.** Forgetting them
  surfaces as `win.ResizeObserver is not a constructor` in the
  test.
- **`@fluentui/react-icons` resolves icons by exact name.** Verify
  before importing.
- **`pivot.ts` indent uses 2 spaces per depth.** Submit.ts trims
  the row label cell on read, so indent is invisible to the
  backend. Don't change to non-whitespace indent without updating
  submit.ts.
- **Drill expansion happens in App.tsx's `onRefresh`.** Moving it
  somewhere else breaks the assumption that `/slice` receives the
  expanded filter.
- **`range.ungroup()` on a flat range is a silent no-op.** Don't
  depend on errors as control flow.
- **Excel's outline max 8 levels.** If hierarchy exceeds, refresh.ts
  silently fails to group beyond level 8. Cap or warn if real
  hierarchies get deeper.
- **CJS Jest preset means `import` in test files is transpiled to
  `require`.** ESM-only npm packages won't resolve in tests.
- **Cell tools sub-accordion's `defaultOpenItems={["add"]}`** — if
  you change "add" to a different value the default opens nothing
  (Fluent uses the literal string match).

### Critical reading list (refresh)

In order:

1. [`SPEC.md`](../../SPEC.md) — domain contract.
2. [`CLAUDE.md`](../../CLAUDE.md) — never-do-this list + entry points.
3. [`phase-1-handoff.md`](phase-1-handoff.md) — Phase 1 (Slices 1–7).
4. [`phase-2-handoff.md`](phase-2-handoff.md) — Phase 2 (Slices 8–9).
5. [`phase-3-handoff.md`](phase-3-handoff.md) — Phase 3 (Slices 10–11).
6. **This file** — Phase 4 polish + drill.
7. [`add-in/src/App.tsx`](../../add-in/src/App.tsx) — taskpane shell;
   the Cell tools sub-accordion structure + drill expansion in
   onRefresh.
8. [`add-in/src/excel/hierarchy.ts`](../../add-in/src/excel/hierarchy.ts)
   — drill helpers; pure JS, well-tested.
9. [`add-in/src/excel/pivot.ts`](../../add-in/src/excel/pivot.ts) —
   hierarchy-aware row sort + post-order traversal + indent.
10. [`add-in/src/excel/refresh.ts`](../../add-in/src/excel/refresh.ts)
    — `range.group("ByRows")` pattern; cleanup-ungroup-8-times.
11. [`add-in/src/components/DefineDriverPanel.tsx`](../../add-in/src/components/DefineDriverPanel.tsx)
    — client-side compose `addDimMember` + `defineDriver`. Pattern
    for any future panel that does similar two-step backend
    composition.
12. [`add-in/src/components/IntersectionPicker.tsx`](../../add-in/src/components/IntersectionPicker.tsx)
    — canonical 6-dim picker; controlled component contract.
13. [`add-in/src/components/ConfirmDialog.tsx`](../../add-in/src/components/ConfirmDialog.tsx)
    + [`StatusBar.tsx`](../../add-in/src/components/StatusBar.tsx)
    — shared component vocabulary; copy this shape for new shared
    pieces.
14. [`add-in/jest.config.cjs`](../../add-in/jest.config.cjs) +
    [`jest.setup.cjs`](../../add-in/jest.setup.cjs) — the test
    infrastructure for Fluent component tests.

Then run `cd backend && uv run pytest -q` and
`cd add-in && npm test` to confirm green (192 + 124 = 316), then
start the demo per the Phase 1 runbook.
