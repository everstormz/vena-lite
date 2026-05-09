import {
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

export type StatusKind = "idle" | "loading" | "ok" | "error";

export interface Status {
  kind: StatusKind;
  message?: string;
  /** Loading sub-state — what the app is currently doing. */
  what?: string;
}

const useStyles = makeStyles({
  loadingRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
});

interface Props {
  status: Status;
  /** Hide loading state — useful for in-flight buttons that already show a spinner. */
  showLoading?: boolean;
}

const labelFor: Record<string, string> = {
  init: "Loading dimensions…",
  refresh: "Refreshing…",
  submit: "Submitting…",
  copy: "Copying…",
  define: "Defining driver…",
  override: "Saving override…",
};

export function StatusBar({ status, showLoading = true }: Props) {
  const styles = useStyles();
  if (status.kind === "idle") return null;
  if (status.kind === "loading") {
    if (!showLoading) return null;
    const lbl = (status.what && labelFor[status.what]) ?? "Working…";
    return (
      <div className={styles.loadingRow}>
        <Spinner size="tiny" />
        <span>{lbl}</span>
      </div>
    );
  }
  const intent = status.kind === "ok" ? "success" : "error";
  const title = status.kind === "ok" ? "Done" : "Error";
  return (
    <MessageBar intent={intent}>
      <MessageBarBody>
        <MessageBarTitle>{title}</MessageBarTitle>
        {status.message ?? ""}
      </MessageBarBody>
    </MessageBar>
  );
}
