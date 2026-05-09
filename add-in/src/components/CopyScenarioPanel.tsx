import { useState } from "react";
import {
  Button,
  Input,
  Field,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRight20Regular,
  BranchFork20Regular,
  Copy20Regular,
} from "@fluentui/react-icons";
import { copyScenario, newRequestId } from "../api/client";
import type { DimMemberInfo } from "../types/generated";
import { MemberPicker } from "./MemberPicker";
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
  pair: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  arrow: {
    color: tokens.colorBrandForeground1,
    fontSize: tokens.fontSizeBase400,
  },
  side: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  sideHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
  },
});

interface Props {
  scenarios: DimMemberInfo[];
  versions: DimMemberInfo[];
  defaultSourceScenario: string;
  defaultSourceVersion: string;
  onCopied: () => void;
}

export function CopyScenarioPanel({
  scenarios,
  versions,
  defaultSourceScenario,
  defaultSourceVersion,
  onCopied,
}: Props) {
  const styles = useStyles();
  const [sourceScenario, setSourceScenario] = useState(defaultSourceScenario);
  const [sourceVersion, setSourceVersion] = useState(defaultSourceVersion);
  const [targetScenario, setTargetScenario] = useState("Forecast");
  const [targetVersion, setTargetVersion] = useState("v1");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onCopy() {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const resp = await copyScenario({
        request_id: newRequestId(),
        source: { scenario: sourceScenario, version: sourceVersion },
        target: { scenario: targetScenario, version: targetVersion },
      });
      const created = resp.created_members.length > 0
        ? ` (new: ${resp.created_members.map((m) => `${m.dim}=${m.member}`).join(", ")})`
        : "";
      setStatus({
        kind: "ok",
        message: `Copied ${resp.copied_count} facts${created}.`,
      });
      onCopied();
    } catch (err) {
      setStatus({ kind: "error", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  const canCopy =
    !busy &&
    sourceScenario &&
    sourceVersion &&
    targetScenario.trim() &&
    targetVersion.trim();

  return (
    <div className={styles.root}>
      <Text className={styles.hint}>
        Fork an existing (scenario, version) into a new one. New target members
        are auto-created if they don&rsquo;t exist.
      </Text>

      <div className={styles.pair}>
        <div className={styles.side}>
          <div className={styles.sideHeader}>
            <BranchFork20Regular />
            <span>From</span>
          </div>
          <MemberPicker
            label="Scenario"
            members={scenarios}
            value={sourceScenario}
            onChange={setSourceScenario}
            disabled={busy}
          />
          <MemberPicker
            label="Version"
            members={versions}
            value={sourceVersion}
            onChange={setSourceVersion}
            disabled={busy}
          />
        </div>

        <ArrowRight20Regular className={styles.arrow} />

        <div className={styles.side}>
          <div className={styles.sideHeader}>
            <BranchFork20Regular />
            <span>To</span>
          </div>
          <Field label="Scenario">
            <Input
              value={targetScenario}
              onChange={(_, d) => setTargetScenario(d.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Version">
            <Input
              value={targetVersion}
              onChange={(_, d) => setTargetVersion(d.value)}
              disabled={busy}
            />
          </Field>
        </div>
      </div>

      <Button
        appearance="primary"
        icon={<Copy20Regular />}
        disabled={!canCopy}
        onClick={onCopy}
      >
        {busy ? "Copying…" : "Copy scenario"}
      </Button>
      <StatusBar status={status} showLoading={false} />
    </div>
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
