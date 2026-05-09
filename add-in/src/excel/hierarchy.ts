import type { DimMemberInfo } from "../types/generated";

/**
 * Hierarchy helpers used by the pivot drill feature. All pure JS; no
 * Office.js or React dependencies.
 *
 * The dim model stores a single parent_member_id per member (zero or one
 * parent). Roots have parent === null. Depth of a member relative to a
 * traversal root is the number of edges between them.
 */

/**
 * Post-order traversal of the subtree rooted at `rootId`: descendants
 * first (recursively), then the root itself. Returns
 * `[...descendants, rootId]`.
 *
 * Why post-order: Excel's outline grouping default is "summary rows below
 * detail" (Office.js doesn't expose the toggle). With post-order, parent
 * rows land BELOW their children — Excel puts the +/− gutter icon next
 * to the parent row, which is what users expect. This also matches the
 * financial-report convention of subtotals at the bottom of their group.
 *
 * If `rootId` doesn't exist in `members`, returns `[rootId]` as a
 * self-rooted singleton.
 */
export function subtreePostOrder(
  rootId: string,
  members: DimMemberInfo[],
): string[] {
  const childrenByParent = indexChildren(members);
  const out: string[] = [];
  function walk(id: string): void {
    const kids = childrenByParent.get(id) ?? [];
    for (const k of kids) walk(k.id);
    out.push(id);
  }
  walk(rootId);
  if (out.length === 0) out.push(rootId);
  return out;
}

/**
 * Compute depth of each member in `members` relative to the closest
 * ancestor that is in `roots`. Members not in any root's subtree are
 * absent from the returned map.
 *
 * Roots get depth 0, their direct children get 1, grandchildren 2, etc.
 */
export function depthsFromRoots(
  roots: readonly string[],
  members: DimMemberInfo[],
): Map<string, number> {
  const childrenByParent = indexChildren(members);
  const depth = new Map<string, number>();
  for (const root of roots) {
    if (!depth.has(root)) depth.set(root, 0);
    const queue: string[] = [root];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const d = depth.get(id) ?? 0;
      const kids = childrenByParent.get(id) ?? [];
      for (const k of kids) {
        if (!depth.has(k.id)) {
          depth.set(k.id, d + 1);
          queue.push(k.id);
        }
      }
    }
  }
  return depth;
}

/**
 * Expand a filter list into the full set of subtree members for each entry,
 * preserving the user's pick order at the top level. Result is in post-
 * order — descendants before their parent — suitable for use as both the
 * slice filter AND the pivot's row order.
 *
 * - Leaves stay singletons.
 * - Parents become [...descendants, parent].
 * - Duplicates removed (idempotent if a member appears under multiple roots,
 *   though the dim model today is a forest so this shouldn't happen).
 */
export function expandToSubtree(
  filterIds: readonly string[],
  members: DimMemberInfo[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of filterIds) {
    for (const sub of subtreePostOrder(id, members)) {
      if (!seen.has(sub)) {
        seen.add(sub);
        out.push(sub);
      }
    }
  }
  return out;
}

/**
 * Group children by their parent_member_id (null for roots). Children inside
 * each parent's bucket retain their original ordering from `members` so
 * downstream traversals respect the dim model's `ordinal` ordering when the
 * caller has pre-sorted by it.
 */
function indexChildren(
  members: DimMemberInfo[],
): Map<string | null, DimMemberInfo[]> {
  const out = new Map<string | null, DimMemberInfo[]>();
  for (const m of members) {
    const p = m.parent ?? null;
    const arr = out.get(p) ?? [];
    arr.push(m);
    out.set(p, arr);
  }
  return out;
}

/**
 * Walk a sequence of depths and emit (start, length) ranges for each
 * outline level d >= 1. Each emitted range covers a contiguous run of
 * indices where depth[i] >= d. Used by refresh.ts to call
 * `range.group("ByRows")` the right number of times to produce nested
 * Excel outline groups.
 *
 * Example: depths [0, 1, 2, 2, 1, 0]
 *   level 1 → [(1, 4)]      — rows 1..4 (depth >= 1)
 *   level 2 → [(2, 2)]      — rows 2..3 (depth >= 2)
 */
export interface GroupRange {
  start: number;
  length: number;
}
export function groupingRanges(depths: readonly number[]): Map<number, GroupRange[]> {
  const out = new Map<number, GroupRange[]>();
  if (depths.length === 0) return out;
  const maxDepth = Math.max(...depths);
  for (let level = 1; level <= maxDepth; level++) {
    const ranges: GroupRange[] = [];
    let i = 0;
    while (i < depths.length) {
      if (depths[i] >= level) {
        let j = i;
        while (j < depths.length && depths[j] >= level) j++;
        ranges.push({ start: i, length: j - i });
        i = j;
      } else {
        i++;
      }
    }
    if (ranges.length > 0) out.set(level, ranges);
  }
  return out;
}
