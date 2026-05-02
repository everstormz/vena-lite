import { useState } from "react";
import {
  Button,
  Field,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { defineDriver, deleteDriver, newRequestId } from "../api/client";
import type { DimMemberInfo, DriverInfo } from "../types/generated";
import { MemberPicker } from "./MemberPicker";

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
  driversList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  driverRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyMonospace,
  },
  driverLabel: { flex: 1 },
});

interface Props {
  accounts: DimMemberInfo[]; // leaves only — parents would be rejected by backend
  defaultAccount: string;
  drivers: DriverInfo[];
  onDefined: () => void;
}

export function DefineDriverPanel({
  accounts,
  defaultAccount,
  drivers,
  onDefined,
}: Props) {
  const styles = useStyles();
  const [account, setAccount] = useState(defaultAccount);
  const [formula, setFormula] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingUndefine, setPendingUndefine] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  async function onDefine() {
    setBusy(true);
    setStatus(null);
    try {
      const resp = await defineDriver({
        request_id: newRequestId(),
        account,
        formula,
      });
      setStatus({
        kind: "ok",
        msg: `Defined. Initial compute wrote ${resp.initial_computed_count} cells.`,
      });
      setFormula("");
      onDefined();
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onUndefine(driverAccount: string) {
    if (pendingUndefine !== driverAccount) {
      setPendingUndefine(driverAccount);
      setStatus({
        kind: "ok",
        msg: `Click Undefine again to confirm removal of driver for ${driverAccount}.`,
      });
      return;
    }
    setBusy(true);
    try {
      await deleteDriver(driverAccount, newRequestId());
      setStatus({
        kind: "ok",
        msg: `Undefined ${driverAccount}. Future submits to this account are now allowed.`,
      });
      setPendingUndefine(null);
      onDefined();
    } catch (err) {
      setStatus({
        kind: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.root}>
      <MemberPicker
        label="Output account"
        members={accounts}
        value={account}
        onChange={setAccount}
        disabled={busy}
      />
      <Field label="Formula">
        <Textarea
          value={formula}
          onChange={(_, d) => setFormula(d.value)}
          disabled={busy}
          placeholder="e.g. 4000_Revenue * 0.5"
          rows={3}
        />
      </Field>
      <Text className={styles.hint}>
        Operators: + - * / parens. Identifiers are leaf account ids
        (e.g. 4000_Revenue). Submitting at this account will be rejected
        once the driver is defined.
      </Text>
      <Button
        appearance="primary"
        disabled={busy || !account || !formula.trim()}
        onClick={onDefine}
      >
        {busy ? "Defining…" : "Define driver"}
      </Button>

      {drivers.length > 0 && (
        <div className={styles.driversList}>
          <Text className={styles.hint}>Current drivers:</Text>
          {drivers.map((d) => (
            <div key={d.account} className={styles.driverRow}>
              <Text className={styles.driverLabel}>
                {d.account} = {d.formula}
              </Text>
              <Button
                size="small"
                appearance={pendingUndefine === d.account ? "primary" : "subtle"}
                disabled={busy}
                onClick={() => onUndefine(d.account)}
              >
                {pendingUndefine === d.account ? "Confirm" : "Undefine"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {status && (
        <Text className={status.kind === "error" ? styles.error : styles.status}>
          {status.kind === "error" ? `Error: ${status.msg}` : status.msg}
        </Text>
      )}
    </div>
  );
}
