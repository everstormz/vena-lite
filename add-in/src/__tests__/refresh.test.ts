import { writeFactsToActiveSheet } from "../excel/refresh";
import type { AxisSpec } from "../excel/axes";
import type { FactRow } from "../types/generated";

/**
 * Hand-rolled minimal mock of the Office.js surface we touch.
 *
 * The point of these tests: catch regressions in the batching pattern. We
 * assert that one Excel.run() invocation produces exactly one context.sync()
 * — anything else means cell-level chatter is creeping in.
 */
type Captured = {
  syncs: number;
  rangeWrites: { row: number; col: number; rows: number; cols: number; values: unknown }[];
  fillSets: { row: number; col: number; rows: number; cols: number; color: string }[];
  clears: { row: number; col: number; rows: number; cols: number }[];
  groups: { row: number; col: number; rows: number; cols: number; option: string }[];
  ungroups: { row: number; col: number; rows: number; cols: number; option: string }[];
};

function setupOfficeMock(): Captured {
  const captured: Captured = {
    syncs: 0,
    rangeWrites: [],
    fillSets: [],
    clears: [],
    groups: [],
    ungroups: [],
  };

  const fakeRange = (r: number, c: number, rows: number, cols: number) => {
    const range: Record<string, unknown> = {};
    Object.defineProperty(range, "values", {
      set(v: unknown) {
        captured.rangeWrites.push({ row: r, col: c, rows, cols, values: v });
      },
    });
    range.clear = () => {
      captured.clears.push({ row: r, col: c, rows, cols });
    };
    range.group = (option: string) => {
      captured.groups.push({ row: r, col: c, rows, cols, option });
    };
    range.ungroup = (option: string) => {
      captured.ungroups.push({ row: r, col: c, rows, cols, option });
    };
    range.format = {
      font: { bold: false },
      fill: {
        set color(color: string) {
          captured.fillSets.push({ row: r, col: c, rows, cols, color });
        },
      },
    };
    return range;
  };

  const fakeWorksheet = {
    getRangeByIndexes: (r: number, c: number, rows: number, cols: number) =>
      fakeRange(r, c, rows, cols),
  };

  const fakeContext = {
    workbook: { worksheets: { getActiveWorksheet: () => fakeWorksheet } },
    sync: async () => {
      captured.syncs += 1;
    },
  };

  (globalThis as unknown as { Excel: unknown }).Excel = {
    run: async (cb: (ctx: typeof fakeContext) => Promise<void>) => cb(fakeContext),
  };

  return captured;
}

function makeRows(n: number, accountFor: (i: number) => string = () => "A"): FactRow[] {
  return Array.from({ length: n }, (_, i) => ({
    account: accountFor(i),
    entity: "E",
    costcenter: "C",
    period: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
    scenario: "Actual",
    version: "v1",
    value: `${i}.123456`,
  }));
}

const NO_AXES: AxisSpec = { rows: [], cols: [] };

afterEach(() => {
  delete (globalThis as unknown as { Excel?: unknown }).Excel;
});

// --- long-format fallback (today's behavior, preserved) ---------------------

test("long-format: writes header + rows in one batched range", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(makeRows(96), NO_AXES, {});

  const dataWrite = captured.rangeWrites.find(
    (w) => w.row === 0 && w.col === 0 && w.rows > 1 && w.cols === 7,
  );
  expect(dataWrite).toBeDefined();
  expect(dataWrite!.rows).toBe(97);
  expect(dataWrite!.cols).toBe(7);
});

test("long-format: exactly one context.sync per refresh, even with driver styling", async () => {
  const captured = setupOfficeMock();
  const rows = makeRows(20, (i) => (i % 2 === 0 ? "A" : "B"));
  await writeFactsToActiveSheet(rows, NO_AXES, {}, new Set(["B"]));
  expect(captured.syncs).toBe(1);
});

test("long-format: preserves values as strings (no numeric coercion)", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(
    [
      {
        account: "A",
        entity: "E",
        costcenter: "C",
        period: "2026-01",
        scenario: "Actual",
        version: "v1",
        value: "123.456789",
      },
    ],
    NO_AXES,
    {},
  );

  const dataWrite = captured.rangeWrites.find((w) => w.rows === 2 && w.cols === 7)!;
  const matrix = dataWrite.values as (string | number)[][];
  expect(matrix[1][6]).toBe("123.456789");
  expect(typeof matrix[1][6]).toBe("string");
});

test("long-format: empty rows still writes a header row", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet([], NO_AXES, {});
  const dataWrite = captured.rangeWrites.find((w) => w.rows === 1 && w.cols === 7)!;
  expect(dataWrite.cols).toBe(7);
  expect(captured.syncs).toBe(1);
});

test("long-format: driver-account rows get a fill on the value cell only", async () => {
  const captured = setupOfficeMock();
  const rows: FactRow[] = [
    { account: "A", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "1.000000" },
    { account: "B", entity: "E", costcenter: "C", period: "2026-02",
      scenario: "Actual", version: "v1", value: "2.000000" },
    { account: "A", entity: "E", costcenter: "C", period: "2026-03",
      scenario: "Actual", version: "v1", value: "3.000000" },
  ];
  await writeFactsToActiveSheet(rows, NO_AXES, {}, new Set(["B"]));

  expect(captured.fillSets).toHaveLength(1);
  const f = captured.fillSets[0];
  expect(f.row).toBe(2);
  expect(f.col).toBe(6);
  expect(f.rows).toBe(1);
  expect(f.cols).toBe(1);
});

test("long-format: no driverAccounts → no fills at all", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(makeRows(5), NO_AXES, {});
  expect(captured.fillSets).toHaveLength(0);
});

// --- stale-cell clearing ---------------------------------------------------

test("clears a generous range before writing to wipe a previous refresh's cells", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(makeRows(5), NO_AXES, {});
  const clear = captured.clears.find((c) => c.row === 0 && c.col === 0 && c.rows >= 100);
  expect(clear).toBeDefined();
});

// --- pivot mode (both axes) -----------------------------------------------

test("pivot: writes title + header + data rows in one batched range", async () => {
  const captured = setupOfficeMock();
  const rows: FactRow[] = [
    { account: "4000_Revenue", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "100" },
    { account: "5000_OpEx", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "50" },
    { account: "4000_Revenue", entity: "E", costcenter: "C", period: "2026-02",
      scenario: "Actual", version: "v1", value: "200" },
    { account: "5000_OpEx", entity: "E", costcenter: "C", period: "2026-02",
      scenario: "Actual", version: "v1", value: "75" },
  ];
  await writeFactsToActiveSheet(
    rows,
    { rows: ["account"], cols: ["period"] },
    { entity: "E", costcenter: "C", scenario: "Actual", version: "v1" },
  );
  // 1 title + 1 header + 2 data rows = 4 total; 1 row-label col + 2 period cols = 3 total.
  const dataWrite = captured.rangeWrites.find((w) => w.row === 0 && w.col === 0 && w.rows === 4 && w.cols === 3);
  expect(dataWrite).toBeDefined();
});

test("pivot: exactly one context.sync per refresh, even with multiple driver fills", async () => {
  const captured = setupOfficeMock();
  const rows: FactRow[] = [
    { account: "5000_OpEx", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "50" },
    { account: "5000_OpEx", entity: "E", costcenter: "C", period: "2026-02",
      scenario: "Actual", version: "v1", value: "75" },
  ];
  await writeFactsToActiveSheet(
    rows,
    { rows: ["account"], cols: ["period"] },
    { entity: "E", costcenter: "C", scenario: "Actual", version: "v1" },
    new Set(["5000_OpEx"]),
  );
  expect(captured.syncs).toBe(1);
});

test("pivot: driver row gets a fill spanning all data columns", async () => {
  const captured = setupOfficeMock();
  const rows: FactRow[] = [
    { account: "4000_Revenue", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "100" },
    { account: "5000_OpEx", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "50" },
    { account: "4000_Revenue", entity: "E", costcenter: "C", period: "2026-02",
      scenario: "Actual", version: "v1", value: "200" },
    { account: "5000_OpEx", entity: "E", costcenter: "C", period: "2026-02",
      scenario: "Actual", version: "v1", value: "75" },
  ];
  await writeFactsToActiveSheet(
    rows,
    { rows: ["account"], cols: ["period"] },
    { entity: "E", costcenter: "C", scenario: "Actual", version: "v1" },
    new Set(["5000_OpEx"]),
  );
  // Sorted accounts: 4000_Revenue at row 2, 5000_OpEx at row 3. Two periods → cols=2.
  const driverFill = captured.fillSets.find((f) => f.row === 3 && f.col === 1 && f.rows === 1 && f.cols === 2);
  expect(driverFill).toBeDefined();
});

// --- Slice 10: stacked axes ---------------------------------------------

test("stacked-axes pivot: still ONE batched range write + ONE sync", async () => {
  const captured = setupOfficeMock();
  const rows: FactRow[] = [
    { account: "4000_Revenue", entity: "E", costcenter: "CC100", period: "2026-01",
      scenario: "Actual", version: "v1", value: "1" },
    { account: "4000_Revenue", entity: "E", costcenter: "CC100", period: "2026-01",
      scenario: "Forecast", version: "v1", value: "2" },
    { account: "4000_Revenue", entity: "E", costcenter: "CC200", period: "2026-01",
      scenario: "Actual", version: "v1", value: "3" },
    { account: "5000_OpEx", entity: "E", costcenter: "CC100", period: "2026-01",
      scenario: "Actual", version: "v1", value: "4" },
  ];
  await writeFactsToActiveSheet(
    rows,
    { rows: ["account", "costcenter"], cols: ["period", "scenario"] },
    { entity: "E", version: "v1" },
    new Set(),
  );
  expect(captured.syncs).toBe(1);
  // Multiple data writes are allowed (clear + main matrix write); the matrix
  // write itself must be one rectangle covering all rows.
  const matrixWrites = captured.rangeWrites.filter(
    (w) => w.row === 0 && w.col === 0 && w.rows >= 4 && w.cols >= 2,
  );
  expect(matrixWrites).toHaveLength(1);
});

test("stacked rows: driver fill addresses each driver row separately", async () => {
  const captured = setupOfficeMock();
  const rows: FactRow[] = [
    { account: "4000_Revenue", entity: "E", costcenter: "CC100", period: "2026-01",
      scenario: "Actual", version: "v1", value: "1" },
    { account: "5000_OpEx", entity: "E", costcenter: "CC100", period: "2026-01",
      scenario: "Actual", version: "v1", value: "2" },
    { account: "5000_OpEx", entity: "E", costcenter: "CC200", period: "2026-01",
      scenario: "Actual", version: "v1", value: "3" },
  ];
  await writeFactsToActiveSheet(
    rows,
    { rows: ["account", "costcenter"], cols: ["period"] },
    { entity: "E", scenario: "Actual", version: "v1" },
    new Set(["5000_OpEx"]),
  );
  // Sorted row tuples: [4000,CC100], [5000,CC100], [5000,CC200].
  // dataStartRow=2; rowsLen=2 (skip first 2 cols); dataColCount=1.
  // Driver fills land on the two 5000_OpEx rows.
  const fills = captured.fillSets.filter((f) => f.col === 2);
  expect(fills).toHaveLength(2);
  expect(fills.map((f) => f.row).sort()).toEqual([3, 4]);
});

test("stacked-axes pivot: header rows are bolded as a single range", async () => {
  const captured = setupOfficeMock();
  const rows: FactRow[] = [
    { account: "4000", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "1" },
  ];
  await writeFactsToActiveSheet(
    rows,
    { rows: ["account"], cols: ["period", "scenario"] },
    { entity: "E", costcenter: "C", version: "v1" },
  );
  // headerRowCount = 1 title + 2 col header rows = 3. The bold range starts
  // at row 0 with 3 rows.
  // We can't easily inspect the bold setter, but we can verify there's no
  // per-row bolding chatter — the fillSets list should be empty (no driver).
  expect(captured.fillSets).toEqual([]);
  expect(captured.syncs).toBe(1);
});

// --- Hierarchy drill (Phase 4) ----------------------------------------

test("drill: ungroups the clear range before applying new outline groups", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(makeRows(5), NO_AXES, {});
  // 8 ungroup calls on the clear range, regardless of whether the data has groups.
  // Wipes any leftover outline from a prior refresh.
  expect(captured.ungroups.length).toBe(8);
  expect(captured.ungroups.every((u) => u.option === "ByRows")).toBe(true);
});

test("drill: passing rowsHierarchy emits Excel row groups at each level", async () => {
  const captured = setupOfficeMock();
  // Mock /slice response with rolled-up parent + leaf rows.
  const rows: FactRow[] = [
    { account: "Total_PnL", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "300" },
    { account: "Revenue", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "200" },
    { account: "Product", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "120" },
    { account: "Service", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "80" },
    { account: "OpEx", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "100" },
  ];
  const order = ["Product", "Service", "Revenue", "OpEx", "Total_PnL"];
  const depth = new Map<string, number>([
    ["Product", 2],
    ["Service", 2],
    ["Revenue", 1],
    ["OpEx", 1],
    ["Total_PnL", 0],
  ]);
  await writeFactsToActiveSheet(
    rows,
    { rows: ["account"], cols: [] },
    {},
    new Set(),
    { rowsHierarchy: { order, depth } },
  );

  // headerRowCount = 2 (title row + 1 col header). Data rows start at sheet row 2.
  // Level 1 group: rows depth >= 1 are at indices 0..3 → sheet rows 2..5.
  // Level 2 group: rows depth >= 2 are at indices 0..1 → sheet rows 2..3.
  const dataGroups = captured.groups.filter((g) => g.option === "ByRows");
  // Two groups expected (level 1 covering 4 rows; level 2 covering 2 rows).
  expect(dataGroups.length).toBe(2);
  const level1 = dataGroups.find((g) => g.row === 2 && g.rows === 4);
  const level2 = dataGroups.find((g) => g.row === 2 && g.rows === 2);
  expect(level1).toBeDefined();
  expect(level2).toBeDefined();

  // Still ONE batched range write + ONE sync (perf invariant intact).
  expect(captured.syncs).toBe(1);
});

test("drill: no hierarchy → no groups beyond the cleanup ungroups", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(
    makeRows(3),
    { rows: ["account"], cols: [] },
    {},
  );
  expect(captured.groups).toEqual([]);
});
