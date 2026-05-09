import { useState } from "react";
import {
  Button,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownload20Regular, Copy20Regular } from "@fluentui/react-icons";
import type { ValueIntersection } from "../api/client";
import type { DimMemberInfo } from "../types/generated";
import type { DimName } from "../types/dims";
import {
  IntersectionPicker,
  isComplete,
  type PartialIntersection,
} from "./IntersectionPicker";
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
  preview: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  buttonRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
});

interface Props {
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  initialIntersection: PartialIntersection;
}

export function InsertLookupPanel({ dimensionsByName, initialIntersection }: Props) {
  const styles = useStyles();
  const [intersection, setIntersection] = useState<PartialIntersection>(initialIntersection);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const complete = isComplete(intersection);
  const formula = complete ? buildFormula(intersection) : "";

  async function onInsert() {
    if (!complete) return;
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const address = await writeFormulaToActiveCell(formula);
      setStatus({ kind: "ok", message: `Inserted into ${address}.` });
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!complete) return;
    try {
      await navigator.clipboard.writeText(formula);
      setStatus({ kind: "ok", message: "Formula copied to clipboard." });
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    }
  }

  return (
    <div className={styles.root}>
      <Text className={styles.hint}>
        Build a <code>=VENA.LOOKUP(...)</code> formula by picking the six
        members. Insert pastes it into the currently selected cell; Copy
        puts it on the clipboard.
      </Text>
      <IntersectionPicker
        value={intersection}
        dimensionsByName={dimensionsByName}
        onChange={setIntersection}
        disabled={busy}
      />
      {complete && (
        <Text className={styles.preview} title={formula}>
          {formula}
        </Text>
      )}
      <div className={styles.buttonRow}>
        <Button
          appearance="primary"
          icon={<ArrowDownload20Regular />}
          disabled={!complete || busy}
          onClick={onInsert}
        >
          {busy ? "Inserting…" : "Insert into selected cell"}
        </Button>
        <Button
          appearance="secondary"
          icon={<Copy20Regular />}
          disabled={!complete || busy}
          onClick={onCopy}
        >
          Copy
        </Button>
      </div>
      <StatusBar status={status} showLoading={false} />
    </div>
  );
}

/**
 * Compose a `=VENA.LOOKUP(...)` formula string from a fully-resolved
 * intersection. Member ids go into double-quoted string literals — the
 * Office.js custom function expects strings.
 */
export function buildFormula(intersection: ValueIntersection): string {
  const args = [
    intersection.account,
    intersection.entity,
    intersection.costcenter,
    intersection.period,
    intersection.scenario,
    intersection.version,
  ].map((s) => `"${s.replace(/"/g, '""')}"`);
  return `=VENA.LOOKUP(${args.join(", ")})`;
}

/**
 * Write a formula into the active cell. Returns the cell's address.
 * If a multi-cell range is selected, writes only into the top-left cell.
 */
async function writeFormulaToActiveCell(formula: string): Promise<string> {
  return Excel.run(async (ctx) => {
    const sel = ctx.workbook.getSelectedRange();
    const target = sel.getCell(0, 0);
    target.load(["address"]);
    target.formulas = [[formula]];
    await ctx.sync();
    return String(target.address ?? "");
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
