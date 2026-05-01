import { Dropdown, Option, Field } from "@fluentui/react-components";
import { DIM_NAMES, type DimName } from "../types/dims";

const NONE_VALUE = "__none__";

interface Props {
  label: string;
  value: DimName | null;
  onChange: (next: DimName | null) => void;
  /** Dim names to disable (e.g. the dim already used on the other axis). */
  disabledDims?: ReadonlySet<DimName>;
  disabled?: boolean;
}

/**
 * Single-select dim picker for the row or column axis. Includes a "(none)"
 * option; when both axes are (none), refresh.ts falls back to the long-format
 * 7-column layout.
 *
 * Pass disabledDims to prevent picking the dim that's already on the other axis.
 */
export function AxisPicker({ label, value, onChange, disabledDims, disabled }: Props) {
  const selected = value ?? NONE_VALUE;
  return (
    <Field label={label}>
      <Dropdown
        value={value ?? "(none)"}
        selectedOptions={[selected]}
        disabled={disabled}
        onOptionSelect={(_e, data) => {
          if (!data.optionValue) return;
          onChange(data.optionValue === NONE_VALUE ? null : (data.optionValue as DimName));
        }}
      >
        <Option key={NONE_VALUE} value={NONE_VALUE} text="(none)">
          (none)
        </Option>
        {DIM_NAMES.map((d) => (
          <Option
            key={d}
            value={d}
            text={d}
            disabled={disabledDims?.has(d) ?? false}
          >
            {d}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}
