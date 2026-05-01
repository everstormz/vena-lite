import { buildPivot } from "../excel/pivot";
import type { FactRow } from "../types/generated";

function fact(overrides: Partial<FactRow> = {}): FactRow {
  return {
    account: "4000_Revenue",
    entity: "E001_US",
    costcenter: "CC100_Sales",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
    value: "100.000000",
    ...overrides,
  };
}

test("no axis → long-format fallback (7 cols, header at row 0)", () => {
  const rows = [
    fact({ period: "2026-01", value: "1.000000" }),
    fact({ period: "2026-02", value: "2.000000" }),
  ];
  const result = buildPivot(rows, null, null, {}, new Set());
  expect(result.matrix).toHaveLength(3);
  expect(result.matrix[0]).toEqual([
    "account",
    "entity",
    "costcenter",
    "period",
    "scenario",
    "version",
    "value",
  ]);
  expect(result.matrix[1][6]).toBe("1.000000");
  expect(result.headerRowIndex).toBe(0);
  expect(result.driverFillCoords).toEqual([]);
});

test("row axis only → 2-col [rowDim | value] table, headerRowIndex=1", () => {
  const rows = [
    fact({ account: "4000_Revenue", value: "100.000000" }),
    fact({ account: "5000_OpEx", value: "50.000000" }),
  ];
  const result = buildPivot(rows, "account", null, { entity: "E001_US" }, new Set());
  expect(result.matrix[0][0]).toContain("entity=E001_US");
  expect(result.matrix[1]).toEqual(["account", "value"]);
  expect(result.matrix[2]).toEqual(["4000_Revenue", "100.000000"]);
  expect(result.matrix[3]).toEqual(["5000_OpEx", "50.000000"]);
  expect(result.headerRowIndex).toBe(1);
});

test("both axes → title + header + data, missing intersections render as empty string", () => {
  const rows = [
    fact({ account: "4000_Revenue", period: "2026-01", value: "100" }),
    fact({ account: "5000_OpEx", period: "2026-01", value: "50" }),
    fact({ account: "4000_Revenue", period: "2026-03", value: "300" }),
    // (5000_OpEx, 2026-03) intentionally missing
  ];
  const pageFilters = { entity: "E001_US", scenario: "Actual" };
  const result = buildPivot(rows, "account", "period", pageFilters, new Set());

  expect(result.matrix[0][0]).toContain("entity=E001_US");
  expect(result.matrix[0][0]).toContain("scenario=Actual");
  expect(result.matrix[1]).toEqual(["account", "2026-01", "2026-03"]);
  expect(result.matrix[2]).toEqual(["4000_Revenue", "100", "300"]);
  expect(result.matrix[3]).toEqual(["5000_OpEx", "50", ""]);
  expect(result.headerRowIndex).toBe(1);
});

test("driver fill: rowAxis=account fills entire driver row across data cols", () => {
  const rows = [
    fact({ account: "4000_Revenue", period: "2026-01" }),
    fact({ account: "5000_OpEx", period: "2026-01" }),
    fact({ account: "4000_Revenue", period: "2026-02" }),
    fact({ account: "5000_OpEx", period: "2026-02" }),
  ];
  const result = buildPivot(rows, "account", "period", {}, new Set(["5000_OpEx"]));
  // Sorted: 4000_Revenue at row 2, 5000_OpEx at row 3. Two periods → cols=2.
  expect(result.driverFillCoords).toEqual([
    { row: 3, col: 1, rows: 1, cols: 2 },
  ]);
});

test("driver fill: colAxis=account fills entire driver column across data rows", () => {
  const rows = [
    fact({ period: "2026-01", account: "4000_Revenue" }),
    fact({ period: "2026-01", account: "5000_OpEx" }),
    fact({ period: "2026-02", account: "4000_Revenue" }),
    fact({ period: "2026-02", account: "5000_OpEx" }),
  ];
  const result = buildPivot(rows, "period", "account", {}, new Set(["5000_OpEx"]));
  // Sorted accounts: 4000_Revenue at col 1, 5000_OpEx at col 2.
  expect(result.driverFillCoords).toEqual([
    { row: 2, col: 2, rows: 2, cols: 1 },
  ]);
});

test("driver fill: account is page filter → entire data block grayed", () => {
  const rows = [
    fact({ account: "5000_OpEx", entity: "E001_US", period: "2026-01" }),
    fact({ account: "5000_OpEx", entity: "E001_US", period: "2026-02" }),
  ];
  const result = buildPivot(
    rows,
    "entity",
    "period",
    { account: "5000_OpEx" },
    new Set(["5000_OpEx"]),
  );
  expect(result.driverFillCoords).toEqual([
    { row: 2, col: 1, rows: 1, cols: 2 },
  ]);
});

test("long-format driver fill: per-row value cell only (today's behavior)", () => {
  const rows = [
    fact({ account: "4000_Revenue" }),
    fact({ account: "5000_OpEx" }),
    fact({ account: "4000_Revenue", period: "2026-02" }),
  ];
  const result = buildPivot(rows, null, null, {}, new Set(["5000_OpEx"]));
  expect(result.driverFillCoords).toEqual([
    { row: 2, col: 6, rows: 1, cols: 1 },
  ]);
});

test("col-only axis is normalized to row-only", () => {
  const rows = [
    fact({ period: "2026-01", value: "10" }),
    fact({ period: "2026-02", value: "20" }),
  ];
  const result = buildPivot(rows, null, "period", {}, new Set());
  expect(result.matrix[1]).toEqual(["period", "value"]);
  expect(result.matrix[2]).toEqual(["2026-01", "10"]);
  expect(result.matrix[3]).toEqual(["2026-02", "20"]);
});

test("empty rows in pivot mode still produces title + header (no data rows)", () => {
  const result = buildPivot([], "account", "period", { entity: "E001_US" }, new Set());
  expect(result.matrix).toHaveLength(2);
  expect(result.matrix[0][0]).toContain("entity=E001_US");
  // colMembers empty → header is just ["account"]
  expect(result.matrix[1]).toEqual(["account"]);
});

test("page filters render alphabetically in the title strip", () => {
  const result = buildPivot(
    [],
    "account",
    "period",
    { version: "v1", entity: "E001_US", scenario: "Actual" },
    new Set(),
  );
  expect(result.matrix[0][0]).toBe("entity=E001_US | scenario=Actual | version=v1");
});
