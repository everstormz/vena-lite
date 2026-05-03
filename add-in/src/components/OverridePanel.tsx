import { useState } from "react";
import {
  Button,
  Field,
  Input,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
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
  status: { color: tokens.colorNeutralForeground2, minHeight: "1.4em" },
  error: { color: tokens.colorPaletteRedForeground1 },
  kvBlock: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: tokens.spacingHorizontalS,
    rowGap: tokens.spacingVerticalXXS,
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyMonospace,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
});

interface Props {
  layout: LayoutDescriptor | null;
  driverAccounts: ReadonlySet<string>;
  onChanged: () => void; // refresh trigger after override / release succeeds
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
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  async function onInspect() {
    setBusy(true);
    setStatus(null);
    setInspected(null);
    try {
      if (!layout) {
        setStatus({ kind: "error", msg: "Click Refresh first." });
        return;
      }
      const cellInfo = await readSelectedCell(layout);
      if (!cellInfo) {
        setStatus({ kind: "error", msg: "Select a single data cell first." });
        return;
      }
      const { intersection, address } = cellInfo;
      // Fetch current value (404 means there's no fact yet — still valid for override)
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
        // 404: no fact yet. Still allow override of an empty cell.
        if (err instanceof Error && err.message.includes("404")) {
          setInspected({ intersection, address, value: "", source: "" });
          setInputValue("");
        } else {
          throw err;
        }
      }
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onOverride() {
    if (!inspected) return;
    setBusy(true);
    setStatus(null);
    try {
      await postOverride({
        request_id: newRequestId(),
        cells: [{ ...inspected.intersection, value: inputValue }],
      });
      await triggerRecalc();
      setStatus({
        kind: "ok",
        msg: `Overrode ${inspected.intersection.account} at ${inspected.address}.`,
      });
      onChanged();
      setInspected(null);
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onRelease() {
    if (!inspected) return;
    setBusy(true);
    setStatus(null);
    try {
      await releaseOverride({
        request_id: newRequestId(),
        cells: [inspected.intersection],
      });
      await triggerRecalc();
      setStatus({
        kind: "ok",
        msg: `Released override at ${inspected.address}.`,
      });
      onChanged();
      setInspected(null);
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  const isDriver = inspected
    ? driverAccounts.has(inspected.intersection.account)
    : false;
  const isOverridden = inspected ? inspected.source.startsWith("override:") : false;

  return (
    <div className={styles.root}>
      <Text className={styles.hint}>
        Select one driver-controlled cell in the sheet, then click Inspect.
        Override sets a manual value that recalc won&rsquo;t replace; Release
        un-pins the cell so the formula takes over again.
      </Text>
      <Button
        appearance="secondary"
        disabled={busy || !layout}
        onClick={onInspect}
      >
        {busy ? "Inspecting…" : "Inspect selected cell"}
      </Button>

      {inspected && (
        <>
          <div className={styles.kvBlock}>
            <Text>cell:</Text>
            <Text>{inspected.address}</Text>
            {DIM_NAMES.map((d) => (
              <span key={d} style={{ display: "contents" }}>
                <Text>{d}:</Text>
                <Text>{inspected.intersection[d as DimName]}</Text>
              </span>
            ))}
            <Text>value:</Text>
            <Text>{inspected.value || "(none)"}</Text>
            <Text>source:</Text>
            <Text>{inspected.source || "(none)"}</Text>
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
              <Button
                appearance="primary"
                disabled={busy || !inputValue.trim()}
                onClick={onOverride}
              >
                {isOverridden ? "Replace override" : "Override"}
              </Button>
              {isOverridden && (
                <Button appearance="subtle" disabled={busy} onClick={onRelease}>
                  Release override
                </Button>
              )}
            </>
          )}
        </>
      )}

      {status && (
        <Text className={status.kind === "error" ? styles.error : styles.status}>
          {status.kind === "error" ? `Error: ${status.msg}` : status.msg}
        </Text>
      )}
    </div>
  );
}

// === Helpers ===

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
