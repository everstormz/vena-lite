import type { DimMemberInfo } from "../types/generated";

export interface TreeNode {
  id: string;
  depth: number;
  displayName: string | null;
  isLeaf: boolean;
}

/**
 * Walk a flat list of dim members into a depth-ordered tree representation.
 * Roots first, children after their parents. Orphans (parent set but missing)
 * are surfaced at depth 0 so they're never silently dropped.
 *
 * Used by MultiMemberPicker for indented option rendering and by
 * DimensionManagerPanel for the editable tree view.
 */
export function buildTree(members: DimMemberInfo[]): TreeNode[] {
  const byParent = new Map<string | null, DimMemberInfo[]>();
  for (const m of members) {
    const p = m.parent ?? null;
    const arr = byParent.get(p) ?? [];
    arr.push(m);
    byParent.set(p, arr);
  }
  const out: TreeNode[] = [];
  function walk(parent: string | null, depth: number): void {
    const children = byParent.get(parent) ?? [];
    for (const m of children) {
      out.push({
        id: m.id,
        depth,
        displayName: m.display_name ?? null,
        isLeaf: m.is_leaf,
      });
      walk(m.id, depth + 1);
    }
  }
  walk(null, 0);
  if (out.length < members.length) {
    const seen = new Set(out.map((n) => n.id));
    for (const m of members) {
      if (!seen.has(m.id)) {
        out.push({
          id: m.id,
          depth: 0,
          displayName: m.display_name ?? null,
          isLeaf: m.is_leaf,
        });
      }
    }
  }
  return out;
}

/** User-facing label for a member: alias if set, id otherwise. */
export function memberLabel(member: { id: string; displayName?: string | null }): string {
  return member.displayName ?? member.id;
}

/** Same as memberLabel but for the raw DimMemberInfo wire shape. */
export function memberLabelFromInfo(m: DimMemberInfo): string {
  return m.display_name ?? m.id;
}
