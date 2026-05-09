import {
  Badge,
  Button,
  Text,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Settings20Regular, Tag20Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
  },
  titleBlock: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    minWidth: 0,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    marginTop: tokens.spacingVerticalXXS,
  },
  badgeIcon: {
    marginRight: "2px",
    verticalAlign: "middle",
  },
});

interface Props {
  scenario?: string;
  version?: string;
  onSettingsClick?: () => void;
}

export function AppHeader({ scenario, version, onSettingsClick }: Props) {
  const styles = useStyles();
  const hasContext = Boolean(scenario || version);
  return (
    <div className={styles.root}>
      <div className={styles.titleBlock}>
        <Title3 as="h1">Vena-lite</Title3>
        <Text className={styles.subtitle}>Excel-native planning</Text>
        {hasContext && (
          <div className={styles.badgeRow}>
            {scenario && (
              <Badge appearance="tint" color="brand" size="small">
                <Tag20Regular className={styles.badgeIcon} />
                {scenario}
              </Badge>
            )}
            {version && (
              <Badge appearance="tint" color="informative" size="small">
                {version}
              </Badge>
            )}
          </div>
        )}
      </div>
      <Button
        appearance="subtle"
        size="small"
        icon={<Settings20Regular />}
        aria-label="Settings"
        onClick={onSettingsClick}
        title="Settings (coming soon)"
      />
    </div>
  );
}
