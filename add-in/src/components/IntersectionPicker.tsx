import { makeStyles, tokens } from "@fluentui/react-components";
import type { ValueIntersection } from "../api/client";
import type { DimMemberInfo } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";
import { MemberPicker } from "./MemberPicker";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
});

/**
 * Six leaf-only single-select pickers, one per dim. Used by Quick Add,
 * Insert Lookup Formula, and (future) bulk Override panels — anywhere the
 * user needs to assemble a fully-resolved intersection by hand.
 *
 * Controlled component: the parent owns the state. Pass `value` as a partial
 * intersection (any subset of the six dims) and receive `onChange` callbacks
 * with the merged next state.
 */
export type PartialIntersection = Partial<ValueIntersection>;

interface Props {
  value: PartialIntersection;
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>;
  onChange: (next: PartialIntersection) => void;
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

export function IntersectionPicker({
  value,
  dimensionsByName,
  onChange,
  disabled,
}: Props) {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      {DIM_NAMES.map((d) => (
        <MemberPicker
          key={d}
          label={LABELS[d]}
          members={dimensionsByName[d] ?? []}
          value={value[d] ?? ""}
          onChange={(next) => onChange({ ...value, [d]: next })}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/**
 * True iff every dim has a non-empty selection — i.e. the partial
 * intersection is fully resolved and safe to submit.
 */
export function isComplete(v: PartialIntersection): v is ValueIntersection {
  return DIM_NAMES.every((d) => Boolean(v[d]));
}
