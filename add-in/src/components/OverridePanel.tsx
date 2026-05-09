import { useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CursorClick20Regular,
  CursorClick24Regular,
  TableEdit20Regular,
} from "@fluentui/react-icons";
import {
  fetchValue,
  newRequestId,
  postOverride,
  releaseOverride,
  type ValueIntersection,
} from "../api/client";
import { intersectionAtCell } from "../excel/cell_address";
import type { LayoutDescriptor } from "../excel/submit";
import { DIM_NAMES, type DimName } from "../types/dims";
import { EmptyState } from "./EmptyState";
import { StatusBar, type Status } from "./StatusBar";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  inspectedBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  inspectedHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
  },
  cellAddr: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  kvGrid: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: tokens.spacingHorizontalS,
    rowGap: "2px",
    fontSize: tokens.fontSizeBase200,
  },
  dimLabel: {
    color: tokens.colorNeutralForeground3,
    textTransform: "capitalize",
  },
  dimValue: {
    fontFamily: tokens.fontFamilyMonospace,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  valueRow: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    paddingTop: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalXS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  valueAmount: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  valueSource: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontFamily: tokens.fontFamilyMonospace,
  },
  buttonRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
});

interface Props {
  layout: LayoutDescriptor | null;
  driverAccounts: ReadonlySet<string>;
  onChanged: () => void;
}

interface Inspected {
  intersection: ValueIntersection;
  address: string;
  value: string;
  source: string;
}

export function OverridePanel({ layout, driverAccounts, onChanged }: Props) {
  const styles = useStyles();
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onInspect() {
    setBusy(true);
    setStatus({ kind: "idle" });
    setInspected(null);
    try {
      if (!layout) {
        setStatus({ kind: "error", message: "Click Refresh first." });
        return;
      }
      const cellInfo = await readSelectedCell(layout);
      if (!cellInfo) {
        setStatus({
          kind: "error",
          message: "Select a single data cell first.",
        });
        return;
      }
      const { intersection, address } = cellInfo;
      try {
        const resp = await fetchValue(intersection);
        setInspected({
          intersection,
          address,
          value: resp.value,
          source: resp.source,
        });
        setInputValue(resp.value);
      } catch (err) {
        if (err instanceof Error && err.message.includes("404")) {
          setInspected({ intersection, address, value: "", source: "" });
          setInputValue("");
        } else {
          throw err;
        }
      }
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onOverride() {
    if (!inspected) return;
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      await postOverride({
        request_id: newRequestId(),
        cells: [{ ...inspected.intersection, value: inputValue }],
      });
      await triggerRecalc();
      setStatus({
        kind: "ok",
        message: `Overrode ${inspected.intersection.account} at ${inspected.address}.`,
      });
      onChanged();
      setInspected(null);
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRelease() {
    if (!inspected) return;
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      await releaseOverride({
        request_id: newRequestId(),
        cells: [inspected.intersection],
      });
      await triggerRecalc();
      setStatus({
        kind: "ok",
        message: `Released override at ${inspected.address}.`,
      });
      onChanged();
      setInspected(null);
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  const isDriver = inspected
    ? driverAccounts.has(inspected.intersection.account)
    : false;
  const isOverridden = inspected
    ? inspected.source.startsWith("override:")
    : false;

  return (
    <div className={styles.root}>
      <Text className={styles.hint}>
        Select a driver-controlled cell in the sheet and click Inspect. Override
        sets a manual value that survives recalc; Release lets the formula take
        over again.
      </Text>
      <Button
        appearance="secondary"
        icon={<CursorClick20Regular />}
        disabled={busy || !layout}
        onClick={onInspect}
      >
        {busy ? "Inspecting…" : "Inspect selected cell"}
      </Button>

      {!inspected ? (
        <EmptyState
          icon={<CursorClick24Regular />}
          title="No cell inspected"
          hint={
            layout
              ? "Click a data cell, then press Inspect."
              : "Refresh first, then click a data cell."
          }
        />
      ) : (
        <>
          <div className={styles.inspectedBlock}>
            <div className={styles.inspectedHeader}>
              <Text className={styles.cellAddr}>{inspected.address}</Text>
              {isOverridden && (
                <Badge appearance="filled" color="warning" size="small">
                  Overridden
                </Badge>
              )}
              {!isOverridden && isDriver && (
                <Badge appearance="tint" color="brand" size="small">
                  Driver
                </Badge>
              )}
            </div>
            <div className={styles.kvGrid}>
              {DIM_NAMES.map((d) => (
                <span key={d} style={{ display: "contents" }}>
                  <Text className={styles.dimLabel}>{d}</Text>
                  <Text className={styles.dimValue} title={inspected.intersection[d as DimName]}>
                    {inspected.intersection[d as DimName]}
                  </Text>
                </span>
              ))}
            </div>
            <div className={styles.valueRow}>
              <Text className={styles.valueAmount}>
                {inspected.value || "(none)"}
              </Text>
              {inspected.source && (
                <Text className={styles.valueSource}>
                  via {inspected.source}
                </Text>
              )}
            </div>
          </div>

          {!isDriver && (
            <Text className={styles.hint}>
              This account isn&rsquo;t driver-controlled — overrides only apply
              to driver outputs. Use Submit instead.
            </Text>
          )}
          {isDriver && (
            <>
              <Field label="Override value">
                <Input
                  value={inputValue}
                  onChange={(_, d) => setInputValue(d.value)}
                  disabled={busy}
                  placeholder="e.g. 9999.000000"
                />
              </Field>
              <div className={styles.buttonRow}>
                <Button
                  appearance="primary"
                  icon={<TableEdit20Regular />}
                  disabled={busy || !inputValue.trim()}
                  onClick={onOverride}
                >
                  {isOverridden ? "Replace override" : "Override"}
                </Button>
                {isOverridden && (
                  <Button
                    appearance="subtle"
                    disabled={busy}
                    onClick={onRelease}
                  >
                    Release
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}

      <StatusBar status={status} showLoading={false} />
    </div>
  );
}

interface SelectedCellInfo {
  intersection: ValueIntersection;
  address: string;
}

async function readSelectedCell(
  layout: LayoutDescriptor,
): Promise<SelectedCellInfo | null> {
  return Excel.run(async (ctx) => {
    const sel = ctx.workbook.getSelectedRange();
    sel.load(["address", "rowIndex", "columnIndex", "rowCount", "columnCount"]);
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRange();
    used.load(["values", "rowCount", "columnCount"]);
    await ctx.sync();

    if ((sel.rowCount ?? 0) !== 1 || (sel.columnCount ?? 0) !== 1) return null;
    const r = sel.rowIndex ?? 0;
    const c = sel.columnIndex ?? 0;
    const matrix = (used.values ?? []) as (string | number | boolean | null)[][];
    const intersection = intersectionAtCell(matrix, r, c, layout);
    if (!intersection) return null;
    return { intersection, address: String(sel.address ?? "") };
  });
}

async function triggerRecalc(): Promise<void> {
  await Excel.run(async (ctx) => {
    ctx.workbook.application.calculate("Full");
    await ctx.sync();
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
