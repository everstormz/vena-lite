import { useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Calculator24Regular, Delete20Regular } from "@fluentui/react-icons";
import {
  addDimMember,
  defineDriver,
  deleteDriver,
  newRequestId,
} from "../api/client";
import type { DimMemberInfo, DriverInfo } from "../types/generated";
import { ConfirmDialog } from "./ConfirmDialog";
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
  monospace: {
    fontFamily: tokens.fontFamilyMonospace,
  },
  fieldRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: tokens.spacingHorizontalS,
  },
  fieldGrow: {
    flex: 1,
  },
  driversList: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginTop: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  driversHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
  },
  driverRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalXS,
    borderRadius: tokens.borderRadiusSmall,
  },
  driverRowHover: {
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
  driverLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

interface Props {
  accounts: DimMemberInfo[]; // all account members (parents + leaves) — used for existence check only
  drivers: DriverInfo[];
  onDefined: () => void;
}

export function DefineDriverPanel({ accounts, drivers, onDefined }: Props) {
  const styles = useStyles();
  const [accountId, setAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formula, setFormula] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingUndefine, setPendingUndefine] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const trimmedId = accountId.trim();
  const existing = trimmedId
    ? accounts.find((a) => a.id === trimmedId) ?? null
    : null;
  const isNew = trimmedId.length > 0 && !existing;
  const existingHasDriver = existing
    ? drivers.some((d) => d.account === existing.id)
    : false;

  async function onDefine() {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const id = trimmedId;
      // 1. If the account doesn't exist yet, create it as a root-level leaf.
      //    The user can re-parent it later from the Dimensions panel.
      if (!existing) {
        await addDimMember("account", {
          request_id: newRequestId(),
          id,
          display_name: displayName.trim() || null,
          parent: null,
          ordinal: 0,
          rollup_op: "sum",
        });
      }
      // 2. Define the formula. defineDriver is upsert (INSERT OR REPLACE) so
      //    re-defining on an existing account just replaces its formula.
      const resp = await defineDriver({
        request_id: newRequestId(),
        account: id,
        formula,
      });
      const verb = !existing
        ? "Created"
        : existingHasDriver
          ? "Replaced driver for"
          : "Defined driver for";
      setStatus({
        kind: "ok",
        message: `${verb} ${id}. Initial compute wrote ${resp.initial_computed_count} cells.`,
      });
      setAccountId("");
      setDisplayName("");
      setFormula("");
      onDefined();
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  async function confirmUndefine() {
    if (!pendingUndefine) return;
    const target = pendingUndefine;
    setBusy(true);
    try {
      await deleteDriver(target, newRequestId());
      setStatus({
        kind: "ok",
        message: `Undefined ${target}. Future submits to this account are now allowed.`,
      });
      setPendingUndefine(null);
      onDefined();
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  // Status caption for the ID field — tells the user what will happen.
  let idCaption: { tone: "info" | "warn"; text: string } | null = null;
  if (isNew) {
    idCaption = {
      tone: "info",
      text: "New — will be created as a root-level leaf account.",
    };
  } else if (existing && existingHasDriver) {
    idCaption = {
      tone: "warn",
      text: "Already has a driver — defining replaces the formula.",
    };
  } else if (existing && !existing.is_leaf) {
    idCaption = {
      tone: "warn",
      text: "This is a parent account — drivers must be on leaves. Backend will reject.",
    };
  } else if (existing) {
    idCaption = { tone: "info", text: "Existing leaf account." };
  }

  return (
    <div className={styles.root}>
      <Field
        label="Account ID"
        hint={
          idCaption ? (
            <Badge
              appearance="tint"
              color={idCaption.tone === "warn" ? "warning" : "informative"}
              size="small"
            >
              {idCaption.text}
            </Badge>
          ) : (
            "The account this formula computes (e.g. Profit_Margin)."
          )
        }
      >
        <Input
          value={accountId}
          onChange={(_, d) => setAccountId(d.value)}
          disabled={busy}
          placeholder="e.g. Profit_Margin"
        />
      </Field>
      {isNew && (
        <Field
          label="Display name (optional)"
          hint="Pretty label shown in pickers. Falls back to the id."
        >
          <Input
            value={displayName}
            onChange={(_, d) => setDisplayName(d.value)}
            disabled={busy}
            placeholder="e.g. Profit Margin"
          />
        </Field>
      )}
      <Field label="Formula">
        <Textarea
          value={formula}
          onChange={(_, d) => setFormula(d.value)}
          disabled={busy}
          placeholder="e.g. 4000_Revenue - 5000_OpEx"
          rows={3}
          textarea={{ className: styles.monospace }}
        />
      </Field>
      <Text className={styles.hint}>
        Operators: + - * / parens. Identifiers are leaf account ids (e.g.
        4000_Revenue). Submitting at this account will be rejected once the
        driver is defined.
      </Text>
      <Button
        appearance="primary"
        disabled={busy || !trimmedId || !formula.trim()}
        onClick={onDefine}
      >
        {busy
          ? "Defining…"
          : isNew
            ? "Create account & define driver"
            : "Define driver"}
      </Button>

      <div className={styles.driversList}>
        <div className={styles.driversHeader}>
          <Calculator24Regular style={{ fontSize: 16 }} />
          <span>Current drivers</span>
        </div>
        {drivers.length === 0 ? (
          <EmptyState
            icon={<Calculator24Regular />}
            title="No drivers defined yet"
            hint="Define a formula above to compute one account from others."
          />
        ) : (
          drivers.map((d) => (
            <div
              key={d.account}
              className={`${styles.driverRow} ${styles.driverRowHover}`}
            >
              <Text className={styles.driverLabel} title={`${d.account} = ${d.formula}`}>
                {d.account} = {d.formula}
              </Text>
              <Button
                size="small"
                appearance="subtle"
                disabled={busy}
                icon={<Delete20Regular />}
                aria-label={`Undefine driver ${d.account}`}
                onClick={() => setPendingUndefine(d.account)}
              />
            </div>
          ))
        )}
      </div>

      <StatusBar status={status} showLoading={false} />

      <ConfirmDialog
        open={pendingUndefine !== null}
        title="Undefine driver?"
        body={
          <Text>
            Undefine driver for <strong>{pendingUndefine}</strong>? Existing
            computed facts stay in the cube; future <code>/submit</code> calls
            to this account will be allowed.
          </Text>
        }
        confirmLabel="Undefine"
        destructive
        busy={busy}
        onConfirm={confirmUndefine}
        onCancel={() => setPendingUndefine(null)}
      />
    </div>
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
