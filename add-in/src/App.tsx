import { useCallback, useEffect, useState } from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Text,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
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
import type { PageFilters } from "./excel/pivot";
import { CopyScenarioPanel } from "./components/CopyScenarioPanel";
import { DefineDriverPanel } from "./components/DefineDriverPanel";
import { DimensionManagerPanel } from "./components/DimensionManagerPanel";
import { AxisDesigner } from "./components/AxisDesigner";
import { OverridePanel } from "./components/OverridePanel";
import type { DimMemberInfo, DriverInfo, SubmittedCell } from "./types/generated";
import { DIM_NAMES, type DimName } from "./types/dims";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    fontFamily: tokens.fontFamilyBase,
  },
  buttonRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
  status: { color: tokens.colorNeutralForeground2, minHeight: "1.4em" },
  error: { color: tokens.colorPaletteRedForeground1 },
  reason: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
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
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

type Status =
  | { kind: "idle" }
  | { kind: "loading"; what: "init" | "refresh" | "submit" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

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

export default function App() {
  const styles = useStyles();
  const [dimensionsByName, setDimensionsByName] = useState<
    Partial<Record<DimName, DimMemberInfo[]>>
  >({});
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const driverAccounts = new Set(drivers.map((d) => d.account));
  const [filterState, setFilterState] = useState<FilterState>(defaultFilterState());
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
      const filters: { [k: string]: { members: string[] } } = {};
      for (const d of DIM_NAMES) {
        if (filterState.filters[d].length > 0) {
          filters[d] = { members: filterState.filters[d] };
        }
      }
      const resp = await fetchSlice({ filters });
      const pageFilters = buildPageFilters(filterState);
      await writeFactsToActiveSheet(
        resp.rows,
        filterState.axes,
        pageFilters,
        driverAccounts,
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
        setStatus({
          kind: "error",
          message: "No baseline. Click Refresh first.",
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
  const accountForDriverDefault = preferredDefault(accounts, accounts[0]?.id ?? "");

  const refreshDisabled = busy || !refreshValidation.valid;
  const submitDisabled = busy || !lastLayout || !submitValidation.valid;
  const submitReason = !lastLayout
    ? "Click Refresh first."
    : !submitValidation.valid
      ? submitValidation.reason
      : "";

  return (
    <div className={styles.root}>
      <Title3>Vena-lite</Title3>

      {initLoading && (
        <div className={styles.status}>
          <Spinner size="tiny" label="Loading dimensions…" />
        </div>
      )}

      {!initLoading && (
        <>
          <AxisDesigner
            filters={filterState.filters}
            axes={filterState.axes}
            dimensionsByName={dimensionsByName}
            onFilterChange={setFilter}
            onAxesChange={setAxes}
            disabled={busy}
          />

          <div className={styles.buttonRow}>
            <Button appearance="primary" disabled={refreshDisabled} onClick={onRefresh}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Button appearance="secondary" disabled={submitDisabled} onClick={onSubmitClick}>
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </div>

          {!refreshValidation.valid && (
            <Text className={styles.reason}>Refresh: {refreshValidation.reason}</Text>
          )}
          {submitDisabled && submitReason && refreshValidation.valid && (
            <Text className={styles.reason}>Submit: {submitReason}</Text>
          )}

          {driverAccounts.size > 0 && (
            <Text className={styles.hint}>
              Driver accounts (gray, read-only): {[...driverAccounts].sort().join(", ")}
            </Text>
          )}

          <div className={styles.status}>
            {status.kind === "ok" && <Text>{status.message}</Text>}
            {status.kind === "error" && (
              <Text className={styles.error}>Error: {status.message}</Text>
            )}
          </div>

          <Accordion collapsible multiple>
            <AccordionItem value="copy">
              <AccordionHeader>Copy scenario</AccordionHeader>
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
              <AccordionHeader>Define driver</AccordionHeader>
              <AccordionPanel>
                <DefineDriverPanel
                  accounts={accounts}
                  defaultAccount={accountForDriverDefault}
                  drivers={drivers}
                  onDefined={() => {
                    void reloadDropdowns();
                  }}
                />
              </AccordionPanel>
            </AccordionItem>
            <AccordionItem value="manage">
              <AccordionHeader>Manage dimensions</AccordionHeader>
              <AccordionPanel>
                <DimensionManagerPanel
                  dimensionsByName={dimensionsByName}
                  onChanged={() => {
                    void reloadDropdowns();
                  }}
                />
              </AccordionPanel>
            </AccordionItem>
            <AccordionItem value="override">
              <AccordionHeader>Override cell</AccordionHeader>
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
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={(_e, data) => setConfirmOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              Submit {pendingDeltas.length} change
              {pendingDeltas.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogContent>
              <div className={styles.changeList}>
                {pendingDeltas.map((d, i) => (
                  <div key={i}>
                    {d.account}/{d.entity}/{d.costcenter}/{d.period} → {d.value}
                  </div>
                ))}
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={onConfirmSubmit}>
                Submit
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
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
