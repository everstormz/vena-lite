import type { ReactNode } from "react";
import { Text, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  icon: {
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
  },
  label: {
    fontWeight: tokens.fontWeightSemibold,
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    marginLeft: tokens.spacingHorizontalXS,
  },
});

interface Props {
  icon: ReactNode;
  label: string;
  /** Optional count badge rendered in muted text after the label. */
  count?: number;
}

export function SectionHeader({ icon, label, count }: Props) {
  const styles = useStyles();
  return (
    <span className={styles.root}>
      <span className={styles.icon}>{icon}</span>
      <Text className={styles.label}>{label}</Text>
      {typeof count === "number" && count > 0 && (
        <Text className={styles.count}>({count})</Text>
      )}
    </span>
  );
}
