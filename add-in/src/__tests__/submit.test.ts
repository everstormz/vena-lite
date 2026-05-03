import { readCurrentValuesFromActiveSheet, type LayoutDescriptor } from "../excel/submit";

function setupSheetMock(matrix: (string | number)[][]): { syncs: number } {
  const captured = { syncs: 0 };
  const used = {
    rowCount: matrix.length,
    columnCount: matrix[0]?.length ?? 0,
    values: matrix,
    load: (_props: string[]) => {
      // properties are pre-set on this mock; load is a no-op
    },
  };
  const sheet = { getUsedRange: () => used };
  const ctx = {
    workbook: { worksheets: { getActiveWorksheet: () => sheet } },
    sync: async () => {
      captured.syncs += 1;
    },
  };
  (globalThis as unknown as { Excel: unknown }).Excel = {
    run: async (cb: (c: typeof ctx) => Promise<unknown>) => cb(ctx),
  };
  return captured;
}

afterEach(() => {
  delete (globalThis as unknown as { Excel?: unknown }).Excel;
});

const LONG_FORMAT_LAYOUT: LayoutDescriptor = {
  rows: [],
  cols: [],
  pageFilters: {},
};

test("long-format: maps cols 0..6 to SubmittedCell, preserving decimals as strings", async () => {
  setupSheetMock([
    ["account", "entity", "costcenter", "period", "scenario", "version", "value"],
    ["4000_Revenue", "E001_US", "CC100_Sales", "2026-01", "Actual", "v1", "123.456789"],
    ["5000_OpEx", "E001_US", "CC100_Sales", "2026-02", "Actual", "v1", "50.000000"],
  ]);
  const cells = await readCurrentValuesFromActiveSheet(LONG_FORMAT_LAYOUT);
  expect(cells).toHaveLength(2);
  expect(cells[0]).toEqual({
    account: "4000_Revenue",
    entity: "E001_US",
    costcenter: "CC100_Sales",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
    value: "123.456789",
  });
  expect(typeof cells[0].value).toBe("string");
});

test("long-format: too-narrow sheet returns empty array (no error)", async () => {
  setupSheetMock([["account", "entity"]]);
  expect(await readCurrentValuesFromActiveSheet(LONG_FORMAT_LAYOUT)).toEqual([]);
});

test("pivot two-axis: reconstructs intersections from row col + page filters", async () => {
  // Layout: row=account, col=period; entity/costcenter/scenario/version are page filters.
  setupSheetMock([
    ["entity=E001_US | costcenter=CC100_Sales | scenario=Actual | version=v1", "", ""],
    ["account", "2026-01", "2026-02"],
    ["4000_Revenue", "100.000000", "200.000000"],
    ["5000_OpEx", "50.000000", "75.000000"],
  ]);
  const cells = await readCurrentValuesFromActiveSheet({
    rows: ["account"],
    cols: ["period"],
    pageFilters: {
      entity: "E001_US",
      costcenter: "CC100_Sales",
      scenario: "Actual",
      version: "v1",
    },
  });
  expect(cells).toHaveLength(4);
  expect(cells[0]).toEqual({
    account: "4000_Revenue",
    entity: "E001_US",
    costcenter: "CC100_Sales",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
    value: "100.000000",
  });
  expect(cells[3]).toEqual({
    account: "5000_OpEx",
    entity: "E001_US",
    costcenter: "CC100_Sales",
    period: "2026-02",
    scenario: "Actual",
    version: "v1",
    value: "75.000000",
  });
});

test("pivot two-axis: empty cells are skipped (no submission for blanks)", async () => {
  setupSheetMock([
    ["entity=E001_US | costcenter=CC100_Sales | scenario=Actual | version=v1", "", ""],
    ["account", "2026-01", "2026-02"],
    ["4000_Revenue", "100.000000", ""],   // 2026-02 blank → skip
    ["5000_OpEx", "", "75.000000"],        // 2026-01 blank → skip
  ]);
  const cells = await readCurrentValuesFromActiveSheet({
    rows: ["account"],
    cols: ["period"],
    pageFilters: {
      entity: "E001_US",
      costcenter: "CC100_Sales",
      scenario: "Actual",
      version: "v1",
    },
  });
  expect(cells).toHaveLength(2);
  expect(cells.map((c) => `${c.account}/${c.period}`)).toEqual([
    "4000_Revenue/2026-01",
    "5000_OpEx/2026-02",
  ]);
});

test("pivot single-axis: uses col B as the value, ignores 'value' header text", async () => {
  setupSheetMock([
    ["entity=E001_US | costcenter=CC100_Sales | period=2026-01 | scenario=Actual | version=v1", ""],
    ["account", "value"],
    ["4000_Revenue", "100.000000"],
    ["5000_OpEx", "50.000000"],
  ]);
  const cells = await readCurrentValuesFromActiveSheet({
    rows: ["account"],
    cols: [],
    pageFilters: {
      entity: "E001_US",
      costcenter: "CC100_Sales",
      period: "2026-01",
      scenario: "Actual",
      version: "v1",
    },
  });
  expect(cells).toHaveLength(2);
  expect(cells[0].account).toBe("4000_Revenue");
  expect(cells[0].period).toBe("2026-01");
  expect(cells[0].value).toBe("100.000000");
});

test("pivot: exactly one context.sync per submit read", async () => {
  const captured = setupSheetMock([
    ["title", "", ""],
    ["account", "2026-01", "2026-02"],
    ["A", "1", "2"],
  ]);
  await readCurrentValuesFromActiveSheet({
    rows: ["account"],
    cols: ["period"],
    pageFilters: {
      entity: "E", costcenter: "C", scenario: "Actual", version: "v1",
    },
  });
  expect(captured.syncs).toBe(1);
});

// === Slice 10: stacked axes ===

test("stacked rows: row tuple parsed from leading rowsLen cols", async () => {
  // rows = [account, costcenter], cols = [period]
  // headerRowCount = 1 title + 1 col header = 2; data starts at row 2; col data starts at col 2.
  setupSheetMock([
    ["entity=E001_US | scenario=Actual | version=v1", "", "", ""],
    ["account", "costcenter", "2026-01", "2026-02"],
    ["4000", "CC100", "10.000000", "20.000000"],
    ["5000", "CC200", "30.000000", ""],
  ]);
  const cells = await readCurrentValuesFromActiveSheet({
    rows: ["account", "costcenter"],
    cols: ["period"],
    pageFilters: { entity: "E001_US", scenario: "Actual", version: "v1" },
  });
  expect(cells).toHaveLength(3);
  expect(cells[0]).toEqual({
    account: "4000",
    entity: "E001_US",
    costcenter: "CC100",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
    value: "10.000000",
  });
  expect(cells[2]).toEqual({
    account: "5000",
    entity: "E001_US",
    costcenter: "CC200",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
    value: "30.000000",
  });
});

test("stacked cols: col tuple parsed from cols.length header rows", async () => {
  // rows = [account], cols = [period, scenario]
  // headerRowCount = 1 title + 2 col headers = 3; data starts at row 3; col data starts at col 1.
  setupSheetMock([
    ["entity=E | costcenter=C | version=v1", "", "", "", ""],
    ["", "2026-01", "2026-01", "2026-02", "2026-02"],
    ["account", "Actual", "Forecast", "Actual", "Forecast"],
    ["4000", "10", "11", "20", "21"],
  ]);
  const cells = await readCurrentValuesFromActiveSheet({
    rows: ["account"],
    cols: ["period", "scenario"],
    pageFilters: { entity: "E", costcenter: "C", version: "v1" },
  });
  expect(cells).toHaveLength(4);
  expect(cells[0]).toEqual({
    account: "4000",
    entity: "E",
    costcenter: "C",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
    value: "10",
  });
  expect(cells[3]).toEqual({
    account: "4000",
    entity: "E",
    costcenter: "C",
    period: "2026-02",
    scenario: "Forecast",
    version: "v1",
    value: "21",
  });
});

test("stacked rows + stacked cols: full Cartesian round-trip", async () => {
  // rows = [account, costcenter], cols = [period, scenario]
  // dataStartRow = 1 + 2 = 3; dataStartCol = 2.
  setupSheetMock([
    ["entity=E | version=v1", "", "", "", ""],
    ["", "", "2026-01", "2026-01", "2026-02"],
    ["account", "costcenter", "Actual", "Forecast", "Actual"],
    ["4000", "CC100", "1", "2", "3"],
    ["5000", "CC100", "4", "", "6"],
  ]);
  const cells = await readCurrentValuesFromActiveSheet({
    rows: ["account", "costcenter"],
    cols: ["period", "scenario"],
    pageFilters: { entity: "E", version: "v1" },
  });
  expect(cells).toHaveLength(5);
  const k = (c: { account: string; costcenter: string; period: string; scenario: string }) =>
    `${c.account}/${c.costcenter}/${c.period}/${c.scenario}`;
  expect(cells.map(k)).toEqual([
    "4000/CC100/2026-01/Actual",
    "4000/CC100/2026-01/Forecast",
    "4000/CC100/2026-02/Actual",
    "5000/CC100/2026-01/Actual",
    "5000/CC100/2026-02/Actual",
  ]);
});
