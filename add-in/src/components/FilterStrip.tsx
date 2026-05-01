import { makeStyles, tokens } from "@fluentui/react-components";
import type { DimMemberInfo } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";
import { MultiMemberPicker } from "./MultiMemberPicker";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
});

interface Props {
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  filters: Record<DimName, string[]>;
  onChange: (dim: DimName, next: string[]) => void;
  disabled?: boolean;
}

const LABELS: Record<DimName, string> = {
  account: "Account",
  entity: "Entity",
  costcenter: "Cost center",
  period: "Period",
  scenario: "Scenario",
  version: "Version",
};

export function FilterStrip({ dimensionsByName, filters, onChange, disabled }: Props) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      {DIM_NAMES.map((d) => (
        <MultiMemberPicker
          key={d}
          label={LABELS[d]}
          members={dimensionsByName[d] ?? []}
          selected={filters[d]}
          onChange={(next) => onChange(d, next)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
