import { Combobox, Option, Field } from "@fluentui/react-components";
import type { DimMemberInfo } from "../types/generated";
import { buildTree, memberLabel } from "../excel/dim_tree";

interface Props {
  label: string;
  members: DimMemberInfo[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

// Non-breaking space (U+00A0) survives HTML whitespace collapsing, unlike a regular space.
const INDENT = "  ";

/**
 * Multi-select picker for one dim. Hierarchy-aware: parents render above their
 * leaves with two-space indent. Selecting a parent means "include this subtree"
 * — the backend's expand_filters handles leaf expansion + aggregation.
 *
 * Empty selection means "no filter on this dim" (all leaves). For non-axis dims,
 * App.tsx's refresh-gate enforces "exactly one selection".
 *
 * Slice 9: option text uses `display_name` if set, falling back to id.
 */
export function MultiMemberPicker({
  label,
  members,
  selected,
  onChange,
  disabled,
}: Props) {
  const tree = buildTree(members);
  return (
    <Field label={label}>
      <Combobox
        multiselect
        selectedOptions={selected}
        placeholder="(all)"
        disabled={disabled || members.length === 0}
        onOptionSelect={(_e, data) => onChange(data.selectedOptions)}
      >
        {tree.map((n) => (
          <Option key={n.id} value={n.id} text={memberLabel(n)}>
            {INDENT.repeat(n.depth) + memberLabel(n)}
          </Option>
        ))}
      </Combobox>
    </Field>
  );
}
