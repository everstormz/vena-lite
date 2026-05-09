import { Button, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowSync20Regular, Save20Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: `0 ${tokens.spacingHorizontalL} ${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  buttonRow: {
    display: "flex",
    gap: tokens.spacingHorizontalS,
  },
  button: {
    flex: 1,
  },
  reason: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    minHeight: "1.4em",
  },
});

interface Props {
  refreshDisabled: boolean;
  refreshing: boolean;
  refreshReason: string;
  submitDisabled: boolean;
  submitting: boolean;
  submitReason: string;
  onRefresh: () => void;
  onSubmit: () => void;
}

export function AppToolbar({
  refreshDisabled,
  refreshing,
  refreshReason,
  submitDisabled,
  submitting,
  submitReason,
  onRefresh,
  onSubmit,
}: Props) {
  const styles = useStyles();
  // One reason caption: prefer the active blocker.
  const caption = refreshReason || submitReason;

  const refreshBtn = (
    <Button
      appearance="primary"
      icon={<ArrowSync20Regular />}
      disabled={refreshDisabled}
      onClick={onRefresh}
      className={styles.button}
    >
      {refreshing ? "Refreshing…" : "Refresh"}
    </Button>
  );
  const submitBtn = (
    <Button
      appearance="secondary"
      icon={<Save20Regular />}
      disabled={submitDisabled}
      onClick={onSubmit}
      className={styles.button}
    >
      {submitting ? "Submitting…" : "Submit"}
    </Button>
  );

  return (
    <div className={styles.root}>
      <div className={styles.buttonRow}>
        {refreshDisabled && refreshReason ? (
          <Tooltip content={refreshReason} relationship="label">
            <span className={styles.button}>{refreshBtn}</span>
          </Tooltip>
        ) : (
          refreshBtn
        )}
        {submitDisabled && submitReason ? (
          <Tooltip content={submitReason} relationship="label">
            <span className={styles.button}>{submitBtn}</span>
          </Tooltip>
        ) : (
          submitBtn
        )}
      </div>
      <Text className={styles.reason}>{caption || " "}</Text>
    </div>
  );
}
