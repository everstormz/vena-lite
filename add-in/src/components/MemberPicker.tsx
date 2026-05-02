import { Dropdown, Option, Field } from "@fluentui/react-components";
import type { DimMemberInfo } from "../types/generated";
import { memberLabelFromInfo } from "../excel/dim_tree";

interface Props {
  label: string;
  members: DimMemberInfo[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * Dropdown for picking one dim member. Only leaf members are listed (parent
 * members exist for hierarchy queries on /slice but you don't "pick" a
 * scenario rollup as the active scenario).
 *
 * Slice 9: option text uses `display_name` if set, falling back to id.
 */
export function MemberPicker({ label, members, value, onChange, disabled }: Props) {
  const leaves = members.filter((m) => m.is_leaf);
  const labelFor = (id: string): string => {
    const m = leaves.find((x) => x.id === id);
    return m ? memberLabelFromInfo(m) : id;
  };
  return (
    <Field label={label}>
      <Dropdown
        value={labelFor(value)}
        selectedOptions={[value]}
        disabled={disabled || leaves.length === 0}
        onOptionSelect={(_e, data) => {
          if (data.optionValue) onChange(data.optionValue);
        }}
      >
        {leaves.map((m) => (
          <Option key={m.id} value={m.id} text={memberLabelFromInfo(m)}>
            {memberLabelFromInfo(m)}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}
