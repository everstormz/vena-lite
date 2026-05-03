import { buildPivot } from "../excel/pivot";
import type { AxisSpec } from "../excel/axes";
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

const NO_AXES: AxisSpec = { rows: [], cols: [] };

test("no axis → long-format fallback (7 cols, headerRowCount=1)", () => {
  const rows = [
    fact({ period: "2026-01", value: "1.000000" }),
    fact({ period: "2026-02", value: "2.000000" }),
  ];
  const result = buildPivot(rows, NO_AXES, {}, new Set());
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
  expect(result.headerRowCount).toBe(1);
  expect(result.driverFillCoords).toEqual([]);
});

test("row axis only → 2-col [rowDim | value] table, headerRowCount=2", () => {
  const rows = [
    fact({ account: "4000_Revenue", value: "100.000000" }),
    fact({ account: "5000_OpEx", value: "50.000000" }),
  ];
  const result = buildPivot(
    rows,
    { rows: ["account"], cols: [] },
    { entity: "E001_US" },
    new Set(),
  );
  expect(result.matrix[0][0]).toContain("entity=E001_US");
  expect(result.matrix[1]).toEqual(["account", "value"]);
  expect(result.matrix[2]).toEqual(["4000_Revenue", "100.000000"]);
  expect(result.matrix[3]).toEqual(["5000_OpEx", "50.000000"]);
  expect(result.headerRowCount).toBe(2);
});

test("both axes → title + header + data, missing intersections render as empty string", () => {
  const rows = [
    fact({ account: "4000_Revenue", period: "2026-01", value: "100" }),
    fact({ account: "5000_OpEx", period: "2026-01", value: "50" }),
    fact({ account: "4000_Revenue", period: "2026-03", value: "300" }),
  ];
  const pageFilters = { entity: "E001_US", scenario: "Actual" };
  const result = buildPivot(
    rows,
    { rows: ["account"], cols: ["period"] },
    pageFilters,
    new Set(),
  );

  expect(result.matrix[0][0]).toContain("entity=E001_US");
  expect(result.matrix[0][0]).toContain("scenario=Actual");
  expect(result.matrix[1]).toEqual(["account", "2026-01", "2026-03"]);
  expect(result.matrix[2]).toEqual(["4000_Revenue", "100", "300"]);
  expect(result.matrix[3]).toEqual(["5000_OpEx", "50", ""]);
  expect(result.headerRowCount).toBe(2);
});

test("driver fill: account-on-rows fills entire driver row across data cols", () => {
  const rows = [
    fact({ account: "4000_Revenue", period: "2026-01" }),
    fact({ account: "5000_OpEx", period: "2026-01" }),
    fact({ account: "4000_Revenue", period: "2026-02" }),
    fact({ account: "5000_OpEx", period: "2026-02" }),
  ];
  const result = buildPivot(
    rows,
    { rows: ["account"], cols: ["period"] },
    {},
    new Set(["5000_OpEx"]),
  );
  expect(result.driverFillCoords).toEqual([
    { row: 3, col: 1, rows: 1, cols: 2 },
  ]);
});

test("driver fill: account-on-cols fills entire driver column across data rows", () => {
  const rows = [
    fact({ period: "2026-01", account: "4000_Revenue" }),
    fact({ period: "2026-01", account: "5000_OpEx" }),
    fact({ period: "2026-02", account: "4000_Revenue" }),
    fact({ period: "2026-02", account: "5000_OpEx" }),
  ];
  const result = buildPivot(
    rows,
    { rows: ["period"], cols: ["account"] },
    {},
    new Set(["5000_OpEx"]),
  );
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
    { rows: ["entity"], cols: ["period"] },
    { account: "5000_OpEx" },
    new Set(["5000_OpEx"]),
  );
  expect(result.driverFillCoords).toEqual([
    { row: 2, col: 1, rows: 1, cols: 2 },
  ]);
});

test("long-format driver fill: per-row value cell only", () => {
  const rows = [
    fact({ account: "4000_Revenue" }),
    fact({ account: "5000_OpEx" }),
    fact({ account: "4000_Revenue", period: "2026-02" }),
  ];
  const result = buildPivot(rows, NO_AXES, {}, new Set(["5000_OpEx"]));
  expect(result.driverFillCoords).toEqual([
    { row: 2, col: 6, rows: 1, cols: 1 },
  ]);
});

test("col-only axis is normalized to row-only", () => {
  const rows = [
    fact({ period: "2026-01", value: "10" }),
    fact({ period: "2026-02", value: "20" }),
  ];
  const result = buildPivot(rows, { rows: [], cols: ["period"] }, {}, new Set());
  expect(result.matrix[1]).toEqual(["period", "value"]);
  expect(result.matrix[2]).toEqual(["2026-01", "10"]);
  expect(result.matrix[3]).toEqual(["2026-02", "20"]);
});

test("empty rows in pivot mode still produces title + header (no data rows)", () => {
  const result = buildPivot(
    [],
    { rows: ["account"], cols: ["period"] },
    { entity: "E001_US" },
    new Set(),
  );
  // colTuples is empty, but rowsLen=1, colHeaderCount=1 → 1 title + 1 header = 2.
  // Header row's first cell is "account" (rowDim name in last col header row).
  expect(result.matrix).toHaveLength(2);
  expect(result.matrix[0][0]).toContain("entity=E001_US");
  expect(result.matrix[1]).toEqual(["account"]);
  expect(result.headerRowCount).toBe(2);
});

test("page filters render alphabetically in the title strip", () => {
  const result = buildPivot(
    [],
    { rows: ["account"], cols: ["period"] },
    { version: "v1", entity: "E001_US", scenario: "Actual" },
    new Set(),
  );
  expect(result.matrix[0][0]).toBe("entity=E001_US | scenario=Actual | version=v1");
});

// === Slice 10: stacked axes ===

test("stacked rows (account × costcenter), single col axis", () => {
  const rows = [
    fact({ account: "4000_Revenue", costcenter: "CC100_Sales", period: "2026-01", value: "1" }),
    fact({ account: "4000_Revenue", costcenter: "CC200_Mktg", period: "2026-01", value: "2" }),
    fact({ account: "5000_OpEx", costcenter: "CC100_Sales", period: "2026-01", value: "3" }),
  ];
  const result = buildPivot(
    rows,
    { rows: ["account", "costcenter"], cols: ["period"] },
    { entity: "E001_US", scenario: "Actual", version: "v1" },
    new Set(),
  );
  // 1 title + 1 col header = 2 header rows
  expect(result.headerRowCount).toBe(2);
  // Header row: row dim names then col members
  expect(result.matrix[1]).toEqual(["account", "costcenter", "2026-01"]);
  // Sorted row tuples: [4000,CC100], [4000,CC200], [5000,CC100]
  expect(result.matrix[2]).toEqual(["4000_Revenue", "CC100_Sales", "1"]);
  expect(result.matrix[3]).toEqual(["4000_Revenue", "CC200_Mktg", "2"]);
  expect(result.matrix[4]).toEqual(["5000_OpEx", "CC100_Sales", "3"]);
});

test("single row axis, stacked cols (period × scenario)", () => {
  const rows = [
    fact({ account: "4000_Revenue", period: "2026-01", scenario: "Actual", value: "10" }),
    fact({ account: "4000_Revenue", period: "2026-01", scenario: "Forecast", value: "11" }),
    fact({ account: "4000_Revenue", period: "2026-02", scenario: "Actual", value: "20" }),
    fact({ account: "5000_OpEx", period: "2026-01", scenario: "Actual", value: "30" }),
  ];
  const result = buildPivot(
    rows,
    { rows: ["account"], cols: ["period", "scenario"] },
    { entity: "E001_US", costcenter: "CC100_Sales", version: "v1" },
    new Set(),
  );
  // 1 title + 2 col header rows = 3
  expect(result.headerRowCount).toBe(3);
  // Col header row 0 (depth 0 = period): rowDim blank + period values
  expect(result.matrix[1]).toEqual(["", "2026-01", "2026-01", "2026-02"]);
  // Col header row 1 (depth 1 = scenario): rowDim "account" + scenarios
  expect(result.matrix[2]).toEqual(["account", "Actual", "Forecast", "Actual"]);
  // Data rows
  expect(result.matrix[3]).toEqual(["4000_Revenue", "10", "11", "20"]);
  expect(result.matrix[4]).toEqual(["5000_OpEx", "30", "", ""]);
});

test("stacked both axes: cell lookup uses composite tuple keys", () => {
  const rows = [
    fact({ account: "4000_Revenue", costcenter: "CC100_Sales", period: "2026-01", scenario: "Actual", value: "1" }),
    fact({ account: "4000_Revenue", costcenter: "CC100_Sales", period: "2026-02", scenario: "Forecast", value: "2" }),
    fact({ account: "5000_OpEx", costcenter: "CC200_Mktg", period: "2026-01", scenario: "Actual", value: "3" }),
  ];
  const result = buildPivot(
    rows,
    { rows: ["account", "costcenter"], cols: ["period", "scenario"] },
    { entity: "E001_US", version: "v1" },
    new Set(),
  );
  expect(result.headerRowCount).toBe(3);
  // Header rows have 2 row-label blanks then col tuples
  expect(result.matrix[1].slice(0, 2)).toEqual(["", ""]);
  expect(result.matrix[2].slice(0, 2)).toEqual(["account", "costcenter"]);
  // Data: row tuple in first 2 cols, value at right intersection in remaining
  expect(result.matrix[3].slice(0, 2)).toEqual(["4000_Revenue", "CC100_Sales"]);
  // The (4000, CC100, 2026-01, Actual) cell carries "1"; (4000, CC100, 2026-02, Forecast) carries "2"
  // Column tuples sorted lexicographically → values land in those positions.
  const row3 = result.matrix[3];
  expect(row3).toContain("1");
  expect(row3).toContain("2");
});

test("driver fill in stacked rows: account is one component", () => {
  const rows = [
    fact({ account: "4000_Revenue", costcenter: "CC100_Sales", period: "2026-01" }),
    fact({ account: "5000_OpEx", costcenter: "CC100_Sales", period: "2026-01" }),
    fact({ account: "5000_OpEx", costcenter: "CC200_Mktg", period: "2026-01" }),
  ];
  const result = buildPivot(
    rows,
    { rows: ["account", "costcenter"], cols: ["period"] },
    {},
    new Set(["5000_OpEx"]),
  );
  // Sorted rows: [4000,CC100], [5000,CC100], [5000,CC200]. Driver = 5000.
  // dataStartRow = 2; rowsLen = 2 (skip account+costcenter cols); dataColCount = 1.
  expect(result.driverFillCoords).toEqual([
    { row: 3, col: 2, rows: 1, cols: 1 },
    { row: 4, col: 2, rows: 1, cols: 1 },
  ]);
});
