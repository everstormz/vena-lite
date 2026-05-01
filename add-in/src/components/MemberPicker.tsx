import { Dropdown, Option, Field } from "@fluentui/react-components";
import type { DimMemberInfo } from "../types/generated";

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
 */
export function MemberPicker({ label, members, value, onChange, disabled }: Props) {
  const leaves = members.filter((m) => m.is_leaf);
  return (
    <Field label={label}>
      <Dropdown
        value={value}
        selectedOptions={[value]}
        disabled={disabled || leaves.length === 0}
        onOptionSelect={(_e, data) => {
          if (data.optionValue) onChange(data.optionValue);
        }}
      >
        {leaves.map((m) => (
          <Option key={m.id} value={m.id}>
            {m.id}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}
