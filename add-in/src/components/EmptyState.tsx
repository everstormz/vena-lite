import type { ReactNode } from "react";
import { Text, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },
  icon: {
    fontSize: "32px",
    color: tokens.colorNeutralForeground4,
    marginBottom: tokens.spacingVerticalXS,
  },
  title: {
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

interface Props {
  icon?: ReactNode;
  title: string;
  hint?: string;
}

export function EmptyState({ icon, title, hint }: Props) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      {icon && <div className={styles.icon}>{icon}</div>}
      <Text className={styles.title}>{title}</Text>
      {hint && <Text className={styles.hint}>{hint}</Text>}
    </div>
  );
}
