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
import { readCurrentValuesFromActiveSheet } from "./excel/submit";
import { CopyScenarioPanel } from "./components/CopyScenarioPanel";
import { DefineDriverPanel } from "./components/DefineDriverPanel";
import { MemberPicker } from "./components/MemberPicker";
import type { DimMemberInfo, SubmittedCell } from "./types/generated";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    fontFamily: tokens.fontFamilyBase,
  },
  pickerRow: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  buttonRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
  status: { color: tokens.colorNeutralForeground2, minHeight: "1.4em" },
  error: { color: tokens.colorPaletteRedForeground1 },
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

export default function App() {
  const styles = useStyles();
  const [scenarios, setScenarios] = useState<DimMemberInfo[]>([]);
  const [versions, setVersions] = useState<DimMemberInfo[]>([]);
  const [accounts, setAccounts] = useState<DimMemberInfo[]>([]);
  const [driverAccounts, setDriverAccounts] = useState<Set<string>>(new Set());

  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [selectedVersion, setSelectedVersion] = useState<string>("");

  const [status, setStatus] = useState<Status>({ kind: "loading", what: "init" });
  const [pendingDeltas, setPendingDeltas] = useState<SubmittedCell[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reloadDropdowns = useCallback(async () => {
    const [sc, ve, ac, drv] = await Promise.all([
      fetchDimMembers("scenario"),
      fetchDimMembers("version"),
      fetchDimMembers("account"),
      fetchDrivers(),
    ]);
    setScenarios(sc.members);
    setVersions(ve.members);
    setAccounts(ac.members);
    setDriverAccounts(new Set(drv.drivers.map((d) => d.account)));
    setSelectedScenario((prev) => prev || preferredDefault(sc.members, "Actual"));
    setSelectedVersion((prev) => prev || preferredDefault(ve.members, "v1"));
  }, []);

  useEffect(() => {
    reloadDropdowns()
      .then(() => setStatus({ kind: "idle" }))
      .catch((err) =>
        setStatus({
          kind: "error",
          message: `Failed to load dim members: ${errMsg(err)}`,
        }),
      );
  }, [reloadDropdowns]);

  async function onRefresh() {
    if (!selectedScenario || !selectedVersion) {
      setStatus({ kind: "error", message: "Pick a scenario + version first." });
      return;
    }
    setStatus({ kind: "loading", what: "refresh" });
    const t0 = performance.now();
    try {
      const resp = await fetchSlice({
        filters: {
          scenario: { members: [selectedScenario] },
          version: { members: [selectedVersion] },
        },
      });
      await writeFactsToActiveSheet(resp.rows, driverAccounts);
      await storeBaseline(buildBaseline(resp.rows));
      setStatus({
        kind: "ok",
        message: `Refreshed ${resp.total} rows for ${selectedScenario}/${selectedVersion} in ${Math.round(performance.now() - t0)} ms.`,
      });
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    }
  }

  async function onSubmitClick() {
    setStatus({ kind: "loading", what: "submit" });
    try {
      const baseline = loadBaseline();
      if (Object.keys(baseline).length === 0) {
        setStatus({
          kind: "error",
          message: "No baseline. Click Refresh first to capture current cube values.",
        });
        return;
      }
      const current = await readCurrentValuesFromActiveSheet();
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
    setStatus({ kind: "loading", what: "submit" });
    try {
      const requestId = newRequestId();
      const resp = await submitDeltas({ request_id: requestId, cells: pendingDeltas });
      const next = { ...loadBaseline() };
      for (const d of pendingDeltas) {
        const k = `${d.account}|${d.entity}|${d.costcenter}|${d.period}|${d.scenario}|${d.version}`;
        next[k] = d.value;
      }
      await storeBaseline(next);
      setStatus({
        kind: "ok",
        message: `Submitted ${resp.accepted_count} change${resp.accepted_count === 1 ? "" : "s"}. Refresh to see driver recompute (if any).`,
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
  const defaultAccount = preferredDefault(accounts, accounts[0]?.id ?? "");

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
          <div className={styles.pickerRow}>
            <MemberPicker
              label="Scenario"
              members={scenarios}
              value={selectedScenario}
              onChange={setSelectedScenario}
              disabled={busy}
            />
            <MemberPicker
              label="Version"
              members={versions}
              value={selectedVersion}
              onChange={setSelectedVersion}
              disabled={busy}
            />
          </div>

          <div className={styles.buttonRow}>
            <Button appearance="primary" disabled={busy} onClick={onRefresh}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Button appearance="secondary" disabled={busy} onClick={onSubmitClick}>
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </div>

          {driverAccounts.size > 0 && (
            <Text className={styles.hint}>
              Driver accounts (gray cells, read-only):{" "}
              {[...driverAccounts].sort().join(", ")}
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
                  defaultSourceScenario={selectedScenario}
                  defaultSourceVersion={selectedVersion}
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
                  defaultAccount={defaultAccount}
                  onDefined={() => {
                    void reloadDropdowns();
                  }}
                />
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={(_e, data) => setConfirmOpen(data.open)}
      >
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
