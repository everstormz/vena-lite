import { useState } from "react";
import {
  Button,
  Field,
  Input,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import { newRequestId, submitDeltas } from "../api/client";
import type { DimMemberInfo, SubmittedCell } from "../types/generated";
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
});

interface Props {
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  initialIntersection: PartialIntersection;
  driverAccounts: ReadonlySet<string>;
  onAdded: () => void;
}

export function QuickAddPanel({
  dimensionsByName,
  initialIntersection,
  driverAccounts,
  onAdded,
}: Props) {
  const styles = useStyles();
  const [intersection, setIntersection] = useState<PartialIntersection>(initialIntersection);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const complete = isComplete(intersection);
  const account = intersection.account;
  const isDriver = account ? driverAccounts.has(account) : false;
  const canSubmit = !busy && complete && value.trim().length > 0 && !isDriver;

  async function onAdd() {
    if (!complete) return;
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const cell: SubmittedCell = {
        account: intersection.account!,
        entity: intersection.entity!,
        costcenter: intersection.costcenter!,
        period: intersection.period!,
        scenario: intersection.scenario!,
        version: intersection.version!,
        value: value.trim(),
      };
      const resp = await submitDeltas({
        request_id: newRequestId(),
        cells: [cell],
      });
      await triggerRecalc();
      setStatus({
        kind: "ok",
        message: `Wrote ${resp.accepted_count} cell at ${cell.account}/${cell.period}/${cell.scenario}.`,
      });
      setValue("");
      onAdded();
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <Text className={styles.hint}>
        Write a single value at a fully-specified intersection. Skips
        Refresh — works even when no facts exist yet at this combination.
      </Text>
      <IntersectionPicker
        value={intersection}
        dimensionsByName={dimensionsByName}
        onChange={setIntersection}
        disabled={busy}
      />
      <Field label="Value">
        <Input
          value={value}
          onChange={(_, d) => setValue(d.value)}
          disabled={busy}
          placeholder="e.g. 12500.000000"
        />
      </Field>
      {isDriver && (
        <Text className={styles.hint}>
          {account} is driver-controlled. Submitting here will be rejected —
          use the Override sub-section below to pin a manual value instead.
        </Text>
      )}
      <Button
        appearance="primary"
        icon={<Add20Regular />}
        disabled={!canSubmit}
        onClick={onAdd}
      >
        {busy ? "Adding…" : "Add cell"}
      </Button>
      <StatusBar status={status} showLoading={false} />
    </div>
  );
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
