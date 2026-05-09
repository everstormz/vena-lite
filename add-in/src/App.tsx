import { useCallback, useEffect, useState } from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  BranchFork20Regular,
  Calculator20Regular,
  Database20Regular,
  TableEdit20Regular,
  TableSimple20Regular,
} from "@fluentui/react-icons";
import {
  fetchDimMembers,
  fetchDrivers,
  fetchSlice,
  newRequestId,
  submitDeltas,
} from "./api/client";
import { writeFactsToActiveSheet } from "./excel/refresh";
import { buildBaseline, loadBaseline, storeBaseline } from "./excel/baseline";
import { detectDeltas } from "./excel/delta";
import {
  readCurrentValuesFromActiveSheet,
  type LayoutDescriptor,
} from "./excel/submit";
import {
  defaultFilterState,
  dropUnknownMembers,
  loadFilterState,
  storeFilterState,
  type FilterState,
} from "./excel/filters";
import type { AxisSpec } from "./excel/axes";
import type { PageFilters, AxisHierarchy, PivotOpts } from "./excel/pivot";
import { depthsFromRoots, expandToSubtree } from "./excel/hierarchy";
import { CopyScenarioPanel } from "./components/CopyScenarioPanel";
import { DefineDriverPanel } from "./components/DefineDriverPanel";
import { DimensionManagerPanel } from "./components/DimensionManagerPanel";
import { AxisDesigner } from "./components/AxisDesigner";
import { OverridePanel } from "./components/OverridePanel";
import { QuickAddPanel } from "./components/QuickAddPanel";
import { InsertLookupPanel } from "./components/InsertLookupPanel";
import type { PartialIntersection } from "./components/IntersectionPicker";
import { AppHeader } from "./components/AppHeader";
import { AppToolbar } from "./components/AppToolbar";
import { StatusBar, type Status } from "./components/StatusBar";
import { SectionHeader } from "./components/SectionHeader";
import { ConfirmDialog } from "./components/ConfirmDialog";
import type { DimMemberInfo, DriverInfo, SubmittedCell } from "./types/generated";
import { DIM_NAMES, type DimName } from "./types/dims";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    fontFamily: tokens.fontFamilyBase,
    minHeight: "100vh",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  topBar: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  statusSlot: {
    padding: `0 ${tokens.spacingHorizontalL} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
  },
  driverHint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    padding: `0 ${tokens.spacingHorizontalL}`,
  },
  changeList: {
    maxHeight: "200px",
    overflowY: "auto",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
  },
});

function preferredDefault(members: DimMemberInfo[], preferred: string): string {
  const leaves = members.filter((m) => m.is_leaf);
  if (leaves.some((m) => m.id === preferred)) return preferred;
  return leaves[0]?.id ?? "";
}

function buildPageFilters(state: FilterState): PageFilters {
  const onAxis = new Set<DimName>([...state.axes.rows, ...state.axes.cols]);
  const out: PageFilters = {};
  for (const d of DIM_NAMES) {
    if (onAxis.has(d)) continue;
    if (state.filters[d].length === 1) out[d] = state.filters[d][0];
  }
  return out;
}

interface ValidationResult {
  valid: boolean;
  reason: string;
}

function validateRefresh(state: FilterState): ValidationResult {
  if (state.axes.rows.length === 0 && state.axes.cols.length === 0) {
    return { valid: true, reason: "" };
  }
  const onAxis = new Set<DimName>([...state.axes.rows, ...state.axes.cols]);
  const unconstrained: string[] = [];
  for (const d of DIM_NAMES) {
    if (onAxis.has(d)) continue;
    if (state.filters[d].length !== 1) unconstrained.push(d);
  }
  if (unconstrained.length === 0) return { valid: true, reason: "" };
  return {
    valid: false,
    reason: `Pick exactly one for: ${unconstrained.join(", ")}`,
  };
}

function validateSubmit(
  state: FilterState,
  dimsByName: Partial<Record<DimName, DimMemberInfo[]>>,
): ValidationResult {
  const offending: string[] = [];
  for (const d of DIM_NAMES) {
    const memberById = new Map(
      (dimsByName[d] ?? []).map((m) => [m.id, m] as const),
    );
    for (const id of state.filters[d]) {
      const m = memberById.get(id);
      if (m && !m.is_leaf) offending.push(`${d}/${id}`);
    }
  }
  if (offending.length === 0) return { valid: true, reason: "" };
  return {
    valid: false,
    reason: `Non-leaf selections cannot submit: ${offending.join(", ")}`,
  };
}

/**
 * Pre-pick the first leaf member for each non-axis dim that has no
 * selection yet. Run once on first load so Refresh is enabled out of the
 * box; user-edited filters survive (we only fill empties).
 */
function autoFillDefaults(
  state: FilterState,
  byName: Partial<Record<DimName, DimMemberInfo[]>>,
): FilterState {
  const onAxis = new Set<DimName>([...state.axes.rows, ...state.axes.cols]);
  let touched = false;
  const filters = { ...state.filters };
  for (const d of DIM_NAMES) {
    if (onAxis.has(d)) continue;
    if ((filters[d] ?? []).length > 0) continue;
    const firstLeaf = (byName[d] ?? []).find((m) => m.is_leaf);
    if (firstLeaf) {
      filters[d] = [firstLeaf.id];
      touched = true;
    }
  }
  return touched ? { ...state, filters } : state;
}

function describeAxes(axes: AxisSpec): string {
  if (axes.rows.length === 0 && axes.cols.length === 0) return "long-format";
  const rows = axes.rows.length === 0 ? "(none)" : axes.rows.join(" × ");
  const cols = axes.cols.length === 0 ? "(none)" : axes.cols.join(" × ");
  return `${rows} × ${cols}`;
}

function singleSelection(
  state: FilterState,
  dim: DimName,
  byName: Partial<Record<DimName, DimMemberInfo[]>>,
): string | undefined {
  const sel = state.filters[dim];
  if (sel.length !== 1) return undefined;
  const id = sel[0];
  const m = (byName[dim] ?? []).find((x) => x.id === id);
  return m?.display_name ?? id;
}

/**
 * Derive a partial intersection from filter state — any dim with exactly
 * one selection seeds the corresponding key. Used to pre-fill the Cell
 * tools sub-pickers so common cases need fewer clicks.
 */
function intersectionFromFilters(state: FilterState): PartialIntersection {
  const out: PartialIntersection = {};
  for (const d of DIM_NAMES) {
    const sel = state.filters[d];
    if (sel.length === 1) out[d] = sel[0];
  }
  return out;
}

export default function App() {
  const styles = useStyles();
  const [dimensionsByName, setDimensionsByName] = useState<
    Partial<Record<DimName, DimMemberInfo[]>>
  >({});
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const driverAccounts = new Set(drivers.map((d) => d.account));
  const [filterState, setFilterState] = useState<FilterState>(defaultFilterState());
  const [drillRows, setDrillRows] = useState(false);
  const [lastLayout, setLastLayout] = useState<LayoutDescriptor | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading", what: "init" });
  const [pendingDeltas, setPendingDeltas] = useState<SubmittedCell[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reloadDropdowns = useCallback(async () => {
    const [account, entity, costcenter, period, scenario, version, drivers] =
      await Promise.all([
        fetchDimMembers("account"),
        fetchDimMembers("entity"),
        fetchDimMembers("costcenter"),
        fetchDimMembers("period"),
        fetchDimMembers("scenario"),
        fetchDimMembers("version"),
        fetchDrivers(),
      ]);
    const byName: Record<DimName, DimMemberInfo[]> = {
      account: account.members,
      entity: entity.members,
      costcenter: costcenter.members,
      period: period.members,
      scenario: scenario.members,
      version: version.members,
    };
    setDimensionsByName(byName);
    setDrivers(drivers.drivers);
    return byName;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const byName = await reloadDropdowns();
        const persisted = loadFilterState();
        const { state: cleaned, droppedCount } = dropUnknownMembers(persisted, byName);
        const seeded = autoFillDefaults(cleaned, byName);
        setFilterState(seeded);
        if (droppedCount > 0) {
          setStatus({
            kind: "ok",
            message: `Removed ${droppedCount} stale filter member${droppedCount === 1 ? "" : "s"}.`,
          });
        } else {
          setStatus({ kind: "idle" });
        }
      } catch (err) {
        setStatus({ kind: "error", message: `Failed to load: ${errMsg(err)}` });
      }
    })();
  }, [reloadDropdowns]);

  const refreshValidation = validateRefresh(filterState);
  const submitValidation = validateSubmit(filterState, dimensionsByName);

  function setFilter(dim: DimName, next: string[]) {
    setFilterState((prev) => ({
      ...prev,
      filters: { ...prev.filters, [dim]: next },
    }));
  }
  function setAxes(next: AxisSpec) {
    setFilterState((prev) => ({ ...prev, axes: next }));
  }

  async function onRefresh() {
    if (!refreshValidation.valid) return;
    setStatus({ kind: "loading", what: "refresh" });
    const t0 = performance.now();
    try {
      // If drill-into-rows is on AND the row axis is a single dim, expand
      // each selected member's subtree into the slice filter so the response
      // contains rolled-up rows for parents and per-leaf rows for descendants.
      // The pivot then arranges them post-order with Excel outline grouping.
      const drillDim =
        drillRows && filterState.axes.rows.length === 1
          ? filterState.axes.rows[0]
          : null;
      let rowsHierarchy: AxisHierarchy | undefined;
      const filters: { [k: string]: { members: string[] } } = {};
      for (const d of DIM_NAMES) {
        const sel = filterState.filters[d];
        if (sel.length === 0) continue;
        if (d === drillDim) {
          const members = dimensionsByName[d] ?? [];
          const expanded = expandToSubtree(sel, members);
          filters[d] = { members: expanded };
          rowsHierarchy = {
            order: expanded,
            depth: depthsFromRoots(sel, members),
          };
        } else {
          filters[d] = { members: sel };
        }
      }
      const resp = await fetchSlice({ filters });
      const pageFilters = buildPageFilters(filterState);
      const opts: PivotOpts = rowsHierarchy ? { rowsHierarchy } : {};
      await writeFactsToActiveSheet(
        resp.rows,
        filterState.axes,
        pageFilters,
        driverAccounts,
        opts,
      );
      await storeBaseline(buildBaseline(resp.rows));
      await storeFilterState(filterState);
      const layout: LayoutDescriptor = {
        rows: filterState.axes.rows,
        cols: filterState.axes.cols,
        pageFilters,
      };
      setLastLayout(layout);
      const ms = Math.round(performance.now() - t0);
      setStatus({
        kind: "ok",
        message: `Refreshed ${resp.total} cells, ${describeAxes(filterState.axes)}, ${ms} ms.`,
      });
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    }
  }

  async function onSubmitClick() {
    if (!lastLayout || !submitValidation.valid) return;
    setStatus({ kind: "loading", what: "submit" });
    try {
      const baseline = loadBaseline();
      if (Object.keys(baseline).length === 0) {
        // lastLayout is non-null here (gated above), so the baseline is empty
        // because the last Refresh returned 0 rows — not because we never
        // refreshed. Point users at the right fix.
        setStatus({
          kind: "error",
          message:
            "Last refresh returned 0 cells, so there's nothing to diff against. Widen your filters and refresh again, or use Cell tools → Add a cell to write a fresh value directly.",
        });
        return;
      }
      const current = await readCurrentValuesFromActiveSheet(lastLayout);
      const deltas = detectDeltas(baseline, current);
      if (deltas.length === 0) {
        setStatus({ kind: "ok", message: "No changes to submit." });
        return;
      }
      setPendingDeltas(deltas);
      setConfirmOpen(true);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    }
  }

  async function onConfirmSubmit() {
    setConfirmOpen(false);
    if (pendingDeltas.length === 0) return;
    setStatus({ kind: "loading", what: "submit" });
    try {
      const requestId = newRequestId();
      const cells = pendingDeltas as [SubmittedCell, ...SubmittedCell[]];
      const resp = await submitDeltas({ request_id: requestId, cells });
      const next = { ...loadBaseline() };
      for (const d of pendingDeltas) {
        const k = `${d.account}|${d.entity}|${d.costcenter}|${d.period}|${d.scenario}|${d.version}`;
        next[k] = d.value;
      }
      await storeBaseline(next);
      // Refresh =VENA cells anywhere in the workbook.
      await triggerWorkbookRecalc();
      setStatus({
        kind: "ok",
        message: `Submitted ${resp.accepted_count} change${resp.accepted_count === 1 ? "" : "s"}. Refresh to see driver recompute.`,
      });
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setPendingDeltas([]);
    }
  }

  const initLoading = status.kind === "loading" && status.what === "init";
  const refreshing = status.kind === "loading" && status.what === "refresh";
  const submitting = status.kind === "loading" && status.what === "submit";
  const busy = refreshing || submitting;

  const accounts = dimensionsByName.account ?? [];
  const scenarios = dimensionsByName.scenario ?? [];
  const versions = dimensionsByName.version ?? [];

  const sourceScenarioDefault =
    filterState.filters.scenario.length === 1
      ? filterState.filters.scenario[0]
      : preferredDefault(scenarios, "Actual");
  const sourceVersionDefault =
    filterState.filters.version.length === 1
      ? filterState.filters.version[0]
      : preferredDefault(versions, "v1");
  const refreshDisabled = busy || !refreshValidation.valid;
  const submitDisabled = busy || !lastLayout || !submitValidation.valid;
  const submitReason = !lastLayout
    ? "Click Refresh first."
    : !submitValidation.valid
      ? submitValidation.reason
      : "";
  const refreshReason = refreshValidation.valid ? "" : refreshValidation.reason;

  const headerScenario = singleSelection(filterState, "scenario", dimensionsByName);
  const headerVersion = singleSelection(filterState, "version", dimensionsByName);

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <AppHeader scenario={headerScenario} version={headerVersion} />
        <AppToolbar
          refreshDisabled={refreshDisabled || initLoading}
          refreshing={refreshing}
          refreshReason={refreshReason}
          submitDisabled={submitDisabled || initLoading}
          submitting={submitting}
          submitReason={submitReason}
          onRefresh={onRefresh}
          onSubmit={onSubmitClick}
        />
        <div className={styles.statusSlot}>
          <StatusBar status={status} />
        </div>
      </div>

      {!initLoading && (
        <div className={styles.body}>
          {driverAccounts.size > 0 && (
            <Text className={styles.driverHint}>
              Driver accounts (gray, read-only): {[...driverAccounts].sort().join(", ")}
            </Text>
          )}

          <Accordion collapsible multiple defaultOpenItems={["layout"]}>
            <AccordionItem value="layout">
              <AccordionHeader>
                <SectionHeader icon={<TableSimple20Regular />} label="Layout" />
              </AccordionHeader>
              <AccordionPanel>
                <AxisDesigner
                  filters={filterState.filters}
                  axes={filterState.axes}
                  dimensionsByName={dimensionsByName}
                  onFilterChange={setFilter}
                  onAxesChange={setAxes}
                  drillRows={drillRows}
                  onDrillRowsChange={setDrillRows}
                  disabled={busy}
                />
              </AccordionPanel>
            </AccordionItem>

            <AccordionItem value="copy">
              <AccordionHeader>
                <SectionHeader icon={<BranchFork20Regular />} label="Scenarios" />
              </AccordionHeader>
              <AccordionPanel>
                <CopyScenarioPanel
                  scenarios={scenarios}
                  versions={versions}
                  defaultSourceScenario={sourceScenarioDefault}
                  defaultSourceVersion={sourceVersionDefault}
                  onCopied={() => {
                    void reloadDropdowns();
                  }}
                />
              </AccordionPanel>
            </AccordionItem>

            <AccordionItem value="define">
              <AccordionHeader>
                <SectionHeader
                  icon={<Calculator20Regular />}
                  label="Drivers"
                  count={drivers.length}
                />
              </AccordionHeader>
              <AccordionPanel>
                <DefineDriverPanel
                  accounts={accounts}
                  drivers={drivers}
                  onDefined={() => {
                    void reloadDropdowns();
                  }}
                />
              </AccordionPanel>
            </AccordionItem>

            <AccordionItem value="manage">
              <AccordionHeader>
                <SectionHeader icon={<Database20Regular />} label="Dimensions" />
              </AccordionHeader>
              <AccordionPanel>
                <DimensionManagerPanel
                  dimensionsByName={dimensionsByName}
                  onChanged={() => {
                    void reloadDropdowns();
                  }}
                />
              </AccordionPanel>
            </AccordionItem>

            <AccordionItem value="cell-tools">
              <AccordionHeader>
                <SectionHeader icon={<TableEdit20Regular />} label="Cell tools" />
              </AccordionHeader>
              <AccordionPanel>
                <Accordion collapsible defaultOpenItems={["add"]}>
                  <AccordionItem value="add">
                    <AccordionHeader>Add a cell</AccordionHeader>
                    <AccordionPanel>
                      <QuickAddPanel
                        dimensionsByName={dimensionsByName}
                        initialIntersection={intersectionFromFilters(filterState)}
                        driverAccounts={driverAccounts}
                        onAdded={() => {
                          void reloadDropdowns();
                        }}
                      />
                    </AccordionPanel>
                  </AccordionItem>
                  <AccordionItem value="insert">
                    <AccordionHeader>Insert =VENA.LOOKUP formula</AccordionHeader>
                    <AccordionPanel>
                      <InsertLookupPanel
                        dimensionsByName={dimensionsByName}
                        initialIntersection={intersectionFromFilters(filterState)}
                      />
                    </AccordionPanel>
                  </AccordionItem>
                  <AccordionItem value="override">
                    <AccordionHeader>Override an existing cell</AccordionHeader>
                    <AccordionPanel>
                      <OverridePanel
                        layout={lastLayout}
                        driverAccounts={driverAccounts}
                        onChanged={() => {
                          void reloadDropdowns();
                        }}
                      />
                    </AccordionPanel>
                  </AccordionItem>
                </Accordion>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Submit ${pendingDeltas.length} change${pendingDeltas.length === 1 ? "" : "s"}?`}
        body={
          <div className={styles.changeList}>
            {pendingDeltas.map((d, i) => (
              <div key={i}>
                {d.account}/{d.entity}/{d.costcenter}/{d.period} → {d.value}
              </div>
            ))}
          </div>
        }
        confirmLabel="Submit"
        onConfirm={onConfirmSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function triggerWorkbookRecalc(): Promise<void> {
  // Force Excel to re-evaluate all =VENA(...) custom-function cells. Excel
  // would otherwise cache results until inputs change.
  await Excel.run(async (ctx) => {
    ctx.workbook.application.calculate("Full");
    await ctx.sync();
  });
}
