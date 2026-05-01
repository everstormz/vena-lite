import { useState } from "react";
import {
  Button,
  Input,
  Field,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { copyScenario, newRequestId } from "../api/client";
import type { DimMemberInfo } from "../types/generated";
import { MemberPicker } from "./MemberPicker";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  status: { color: tokens.colorNeutralForeground2, minHeight: "1.4em" },
  error: { color: tokens.colorPaletteRedForeground1 },
});

interface Props {
  scenarios: DimMemberInfo[];
  versions: DimMemberInfo[];
  defaultSourceScenario: string;
  defaultSourceVersion: string;
  onCopied: () => void; // refetch dropdowns in parent
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
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  async function onCopy() {
    setBusy(true);
    setStatus(null);
    try {
      const resp = await copyScenario({
        request_id: newRequestId(),
        source: { scenario: sourceScenario, version: sourceVersion },
        target: { scenario: targetScenario, version: targetVersion },
      });
      const created = resp.created_members.length > 0
        ? ` (new: ${resp.created_members.map((m) => `${m.dim}=${m.member}`).join(", ")})`
        : "";
      setStatus({ kind: "ok", msg: `Copied ${resp.copied_count} facts${created}.` });
      onCopied();
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
        label="Source scenario"
        members={scenarios}
        value={sourceScenario}
        onChange={setSourceScenario}
        disabled={busy}
      />
      <MemberPicker
        label="Source version"
        members={versions}
        value={sourceVersion}
        onChange={setSourceVersion}
        disabled={busy}
      />
      <Field label="Target scenario">
        <Input
          value={targetScenario}
          onChange={(_, d) => setTargetScenario(d.value)}
          disabled={busy}
        />
      </Field>
      <Field label="Target version">
        <Input
          value={targetVersion}
          onChange={(_, d) => setTargetVersion(d.value)}
          disabled={busy}
        />
      </Field>
      <Button
        appearance="primary"
        disabled={busy || !sourceScenario || !sourceVersion || !targetScenario || !targetVersion}
        onClick={onCopy}
      >
        {busy ? "Copying…" : "Copy"}
      </Button>
      {status && (
        <Text className={status.kind === "error" ? styles.error : styles.status}>
          {status.kind === "error" ? `Error: ${status.msg}` : status.msg}
        </Text>
      )}
    </div>
  );
}
