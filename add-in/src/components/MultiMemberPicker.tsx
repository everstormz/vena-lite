import { Combobox, Option, Field } from "@fluentui/react-components";
import type { DimMemberInfo } from "../types/generated";

interface Props {
  label: string;
  members: DimMemberInfo[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

// Non-breaking space (U+00A0) survives HTML whitespace collapsing, unlike a regular space.
const INDENT = "  ";

interface TreeNode {
  id: string;
  depth: number;
}

function buildTree(members: DimMemberInfo[]): TreeNode[] {
  const byParent = new Map<string | null, DimMemberInfo[]>();
  for (const m of members) {
    const p = m.parent ?? null;
    const arr = byParent.get(p) ?? [];
    arr.push(m);
    byParent.set(p, arr);
  }
  const out: TreeNode[] = [];
  function walk(parent: string | null, depth: number) {
    const children = byParent.get(parent) ?? [];
    for (const m of children) {
      out.push({ id: m.id, depth });
      walk(m.id, depth + 1);
    }
  }
  walk(null, 0);
  if (out.length < members.length) {
    const seen = new Set(out.map((n) => n.id));
    for (const m of members) {
      if (!seen.has(m.id)) out.push({ id: m.id, depth: 0 });
    }
  }
  return out;
}

/**
 * Multi-select picker for one dim. Hierarchy-aware: parents render above their
 * leaves with two-space indent. Selecting a parent means "include this subtree"
 * — the backend's expand_filters handles leaf expansion + aggregation.
 *
 * Empty selection means "no filter on this dim" (all leaves). For non-axis dims,
 * App.tsx's refresh-gate enforces "exactly one selection".
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
          <Option key={n.id} value={n.id} text={n.id}>
            {INDENT.repeat(n.depth) + n.id}
          </Option>
        ))}
      </Combobox>
    </Field>
  );
}
