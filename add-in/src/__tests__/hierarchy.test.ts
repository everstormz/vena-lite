import {
  depthsFromRoots,
  expandToSubtree,
  groupingRanges,
  subtreePostOrder,
} from "../excel/hierarchy";
import type { DimMemberInfo } from "../types/generated";

// Tiny test fixture: a 3-level hierarchy.
//   Total_PnL
//     Revenue
//       Product
//       Service
//     OpEx
//   Other_Root  (sibling root)
const FIXTURE: DimMemberInfo[] = [
  { id: "Total_PnL", parent: null, is_leaf: false, display_name: null },
  { id: "Revenue", parent: "Total_PnL", is_leaf: false, display_name: null },
  { id: "Product", parent: "Revenue", is_leaf: true, display_name: null },
  { id: "Service", parent: "Revenue", is_leaf: true, display_name: null },
  { id: "OpEx", parent: "Total_PnL", is_leaf: true, display_name: null },
  { id: "Other_Root", parent: null, is_leaf: true, display_name: null },
];

// --- subtreePostOrder ----------------------------------------------------

test("subtreePostOrder: leaf returns just itself", () => {
  expect(subtreePostOrder("OpEx", FIXTURE)).toEqual(["OpEx"]);
});

test("subtreePostOrder: parent yields descendants then self", () => {
  expect(subtreePostOrder("Revenue", FIXTURE)).toEqual([
    "Product",
    "Service",
    "Revenue",
  ]);
});

test("subtreePostOrder: nested hierarchy is fully post-ordered", () => {
  expect(subtreePostOrder("Total_PnL", FIXTURE)).toEqual([
    "Product",
    "Service",
    "Revenue",
    "OpEx",
    "Total_PnL",
  ]);
});

test("subtreePostOrder: unknown root returns singleton", () => {
  expect(subtreePostOrder("Mystery", FIXTURE)).toEqual(["Mystery"]);
});

// --- depthsFromRoots -----------------------------------------------------

test("depthsFromRoots: roots get depth 0, children 1, grandchildren 2", () => {
  const d = depthsFromRoots(["Total_PnL"], FIXTURE);
  expect(d.get("Total_PnL")).toBe(0);
  expect(d.get("Revenue")).toBe(1);
  expect(d.get("OpEx")).toBe(1);
  expect(d.get("Product")).toBe(2);
  expect(d.get("Service")).toBe(2);
});

test("depthsFromRoots: members outside any root's subtree are absent", () => {
  const d = depthsFromRoots(["Total_PnL"], FIXTURE);
  expect(d.has("Other_Root")).toBe(false);
});

test("depthsFromRoots: multiple roots union their subtrees", () => {
  const d = depthsFromRoots(["Total_PnL", "Other_Root"], FIXTURE);
  expect(d.get("Total_PnL")).toBe(0);
  expect(d.get("Other_Root")).toBe(0);
  expect(d.get("Revenue")).toBe(1);
});

// --- expandToSubtree -----------------------------------------------------

test("expandToSubtree: parent expands to descendants + self in post-order", () => {
  expect(expandToSubtree(["Revenue"], FIXTURE)).toEqual([
    "Product",
    "Service",
    "Revenue",
  ]);
});

test("expandToSubtree: leaves stay singletons", () => {
  expect(expandToSubtree(["OpEx", "Other_Root"], FIXTURE)).toEqual([
    "OpEx",
    "Other_Root",
  ]);
});

test("expandToSubtree: dedupes overlapping selections", () => {
  // Selecting both Revenue and Product (a child of Revenue) should still
  // yield each id once, in the order encountered by the post-order walk.
  const out = expandToSubtree(["Revenue", "Product"], FIXTURE);
  expect(out).toEqual(["Product", "Service", "Revenue"]);
});

// --- groupingRanges ------------------------------------------------------

test("groupingRanges: flat list (all depth 0) produces no groups", () => {
  expect(groupingRanges([0, 0, 0]).size).toBe(0);
});

test("groupingRanges: single subtree yields one level-1 range", () => {
  // depths: [Product=2, Service=2, Revenue=1, OpEx=1, Total_PnL=0]
  const ranges = groupingRanges([2, 2, 1, 1, 0]);
  expect(ranges.get(1)).toEqual([{ start: 0, length: 4 }]);
  expect(ranges.get(2)).toEqual([{ start: 0, length: 2 }]);
});

test("groupingRanges: two sibling subtrees split level-1 ranges", () => {
  // [child=1, parent=0, child=1, parent=0]
  const ranges = groupingRanges([1, 0, 1, 0]);
  expect(ranges.get(1)).toEqual([
    { start: 0, length: 1 },
    { start: 2, length: 1 },
  ]);
  expect(ranges.has(2)).toBe(false);
});

test("groupingRanges: empty input is empty", () => {
  expect(groupingRanges([]).size).toBe(0);
});
