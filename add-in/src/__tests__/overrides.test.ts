import { intersectionAtCell } from "../excel/cell_address";
import type { LayoutDescriptor } from "../excel/submit";

test("long-format: returns intersection from value-cell row", () => {
  const matrix = [
    ["account", "entity", "costcenter", "period", "scenario", "version", "value"],
    ["4000_Revenue", "E001_US", "CC100_Sales", "2026-01", "Actual", "v1", "100"],
    ["5000_OpEx", "E001_US", "CC100_Sales", "2026-01", "Actual", "v1", "50"],
  ];
  const layout: LayoutDescriptor = { rows: [], cols: [], pageFilters: {} };
  expect(intersectionAtCell(matrix, 1, 6, layout)).toEqual({
    account: "4000_Revenue",
    entity: "E001_US",
    costcenter: "CC100_Sales",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
  });
});

test("long-format: rejects clicks outside the value column", () => {
  const matrix = [["a", "b", "c", "d", "e", "f", "g"], ["1", "2", "3", "4", "5", "6", "7"]];
  const layout: LayoutDescriptor = { rows: [], cols: [], pageFilters: {} };
  expect(intersectionAtCell(matrix, 1, 0, layout)).toBeNull();
  expect(intersectionAtCell(matrix, 0, 6, layout)).toBeNull(); // header row
});

test("pivot single-axis: combines row tuple with page filters", () => {
  // rows=[account], cols=[period]: 1 title + 1 col header + data starts at row 2.
  const matrix = [
    ["entity=E001_US | costcenter=CC100 | scenario=Actual | version=v1", "", "", ""],
    ["account", "2026-01", "2026-02", "2026-03"],
    ["4000_Revenue", "100", "200", "300"],
    ["5000_OpEx", "50", "75", "90"],
  ];
  const layout: LayoutDescriptor = {
    rows: ["account"],
    cols: ["period"],
    pageFilters: {
      entity: "E001_US",
      costcenter: "CC100",
      scenario: "Actual",
      version: "v1",
    },
  };
  expect(intersectionAtCell(matrix, 3, 2, layout)).toEqual({
    account: "5000_OpEx",
    entity: "E001_US",
    costcenter: "CC100",
    period: "2026-02",
    scenario: "Actual",
    version: "v1",
  });
});

test("pivot stacked rows: row tuple parsed from leading rowsLen cols", () => {
  // rows=[account, costcenter], cols=[period]: dataStartRow=2, dataStartCol=2.
  const matrix = [
    ["entity=E | scenario=Actual | version=v1", "", "", ""],
    ["account", "costcenter", "2026-01", "2026-02"],
    ["4000", "CC100", "10", "20"],
    ["5000", "CC200", "30", "40"],
  ];
  const layout: LayoutDescriptor = {
    rows: ["account", "costcenter"],
    cols: ["period"],
    pageFilters: { entity: "E", scenario: "Actual", version: "v1" },
  };
  expect(intersectionAtCell(matrix, 3, 3, layout)).toEqual({
    account: "5000",
    costcenter: "CC200",
    entity: "E",
    period: "2026-02",
    scenario: "Actual",
    version: "v1",
  });
});

test("pivot stacked cols: col tuple parsed from cols.length header rows", () => {
  // rows=[account], cols=[period, scenario]: dataStartRow=3, dataStartCol=1.
  const matrix = [
    ["entity=E | costcenter=C | version=v1", "", "", "", ""],
    ["", "2026-01", "2026-01", "2026-02", "2026-02"],
    ["account", "Actual", "Forecast", "Actual", "Forecast"],
    ["4000", "10", "11", "20", "21"],
  ];
  const layout: LayoutDescriptor = {
    rows: ["account"],
    cols: ["period", "scenario"],
    pageFilters: { entity: "E", costcenter: "C", version: "v1" },
  };
  expect(intersectionAtCell(matrix, 3, 2, layout)).toEqual({
    account: "4000",
    entity: "E",
    costcenter: "C",
    period: "2026-01",
    scenario: "Forecast",
    version: "v1",
  });
});

test("pivot: clicks in header zone or row-label zone return null", () => {
  const matrix = [
    ["title", "", ""],
    ["account", "2026-01", "2026-02"],
    ["4000", "10", "20"],
  ];
  const layout: LayoutDescriptor = {
    rows: ["account"],
    cols: ["period"],
    pageFilters: { entity: "E", costcenter: "C", scenario: "S", version: "V" },
  };
  // row 0 (title) → null
  expect(intersectionAtCell(matrix, 0, 1, layout)).toBeNull();
  // row 1 (col header) → null
  expect(intersectionAtCell(matrix, 1, 1, layout)).toBeNull();
  // col 0 (row-label) → null
  expect(intersectionAtCell(matrix, 2, 0, layout)).toBeNull();
});
