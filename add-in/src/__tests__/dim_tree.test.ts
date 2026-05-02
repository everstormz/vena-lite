import { buildTree, memberLabel, memberLabelFromInfo } from "../excel/dim_tree";
import type { DimMemberInfo } from "../types/generated";

function m(
  id: string,
  parent: string | null = null,
  display_name: string | null = null,
  is_leaf = true,
): DimMemberInfo {
  return { id, is_leaf, parent, display_name };
}

test("buildTree: roots only (flat dim) all at depth 0, in input order", () => {
  const tree = buildTree([m("A"), m("B"), m("C")]);
  expect(tree.map((n) => [n.id, n.depth])).toEqual([
    ["A", 0], ["B", 0], ["C", 0],
  ]);
});

test("buildTree: parent then child indents children at depth 1", () => {
  const tree = buildTree([
    m("Total", null, null, false),
    m("Rev", "Total"),
    m("OpEx", "Total"),
  ]);
  expect(tree).toEqual([
    { id: "Total", depth: 0, displayName: null, isLeaf: false },
    { id: "Rev", depth: 1, displayName: null, isLeaf: true },
    { id: "OpEx", depth: 1, displayName: null, isLeaf: true },
  ]);
});

test("buildTree: deeper hierarchy (year -> quarter -> month) tracks depth correctly", () => {
  const tree = buildTree([
    m("2026-FY", null, null, false),
    m("2026-Q1", "2026-FY", null, false),
    m("2026-01", "2026-Q1"),
  ]);
  expect(tree.map((n) => [n.id, n.depth])).toEqual([
    ["2026-FY", 0],
    ["2026-Q1", 1],
    ["2026-01", 2],
  ]);
});

test("buildTree: orphan with missing parent is surfaced at depth 0", () => {
  const tree = buildTree([m("A"), m("B", "Ghost")]);
  const ids = tree.map((n) => n.id).sort();
  expect(ids).toEqual(["A", "B"]);
});

test("buildTree: carries display_name through", () => {
  const tree = buildTree([m("4000_Revenue", null, "Revenue")]);
  expect(tree[0].displayName).toBe("Revenue");
});

test("memberLabel falls back to id when displayName is null", () => {
  expect(memberLabel({ id: "X", displayName: null })).toBe("X");
  expect(memberLabel({ id: "X", displayName: "Alias" })).toBe("Alias");
});

test("memberLabelFromInfo handles raw DimMemberInfo shape", () => {
  expect(memberLabelFromInfo({ id: "X", is_leaf: true })).toBe("X");
  expect(memberLabelFromInfo({ id: "X", is_leaf: true, display_name: "Alias" })).toBe("Alias");
});
