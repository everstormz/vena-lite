import { writeFactsToActiveSheet } from "../excel/refresh";
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
};

function setupOfficeMock(): Captured {
  const captured: Captured = { syncs: 0, rangeWrites: [], fillSets: [] };

  const fakeRange = (r: number, c: number, rows: number, cols: number) => {
    const range: Record<string, unknown> = {};
    Object.defineProperty(range, "values", {
      set(v: unknown) {
        captured.rangeWrites.push({ row: r, col: c, rows, cols, values: v });
      },
    });
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

  // @ts-expect-error — partial Excel global for the test
  globalThis.Excel = {
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

afterEach(() => {
  // @ts-expect-error — cleanup
  delete globalThis.Excel;
});

test("writes header + rows in one batched range", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(makeRows(96));

  const dataWrite = captured.rangeWrites.find((w) => w.row === 0 && w.col === 0 && w.rows > 1);
  expect(dataWrite).toBeDefined();
  expect(dataWrite!.rows).toBe(97);
  expect(dataWrite!.cols).toBe(7);
});

test("performs exactly one context.sync per refresh — even with driver styling", async () => {
  const captured = setupOfficeMock();
  const rows = makeRows(20, (i) => (i % 2 === 0 ? "A" : "B"));
  await writeFactsToActiveSheet(rows, new Set(["B"]));
  expect(captured.syncs).toBe(1);
});

test("preserves values as strings (no numeric coercion)", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet([
    {
      account: "A",
      entity: "E",
      costcenter: "C",
      period: "2026-01",
      scenario: "Actual",
      version: "v1",
      value: "123.456789",
    },
  ]);

  const dataWrite = captured.rangeWrites.find((w) => w.rows === 2)!;
  const matrix = dataWrite.values as (string | number)[][];
  expect(matrix[1][6]).toBe("123.456789");
  expect(typeof matrix[1][6]).toBe("string");
});

test("empty rows still writes a header row", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet([]);
  const dataWrite = captured.rangeWrites.find((w) => w.rows === 1)!;
  expect(dataWrite.cols).toBe(7);
  expect(captured.syncs).toBe(1);
});

test("driver-account rows get a fill on the value cell only", async () => {
  const captured = setupOfficeMock();
  // 3 rows: A, B (driver), A
  const rows: FactRow[] = [
    { account: "A", entity: "E", costcenter: "C", period: "2026-01",
      scenario: "Actual", version: "v1", value: "1.000000" },
    { account: "B", entity: "E", costcenter: "C", period: "2026-02",
      scenario: "Actual", version: "v1", value: "2.000000" },
    { account: "A", entity: "E", costcenter: "C", period: "2026-03",
      scenario: "Actual", version: "v1", value: "3.000000" },
  ];
  await writeFactsToActiveSheet(rows, new Set(["B"]));

  // Exactly one fill, on the second data row's value cell (row index 2 = header(0) + row 0 + row 1).
  expect(captured.fillSets).toHaveLength(1);
  const f = captured.fillSets[0];
  expect(f.row).toBe(2);
  expect(f.col).toBe(6); // value column
  expect(f.rows).toBe(1);
  expect(f.cols).toBe(1);
});

test("no driverAccounts → no fills at all", async () => {
  const captured = setupOfficeMock();
  await writeFactsToActiveSheet(makeRows(5));
  expect(captured.fillSets).toHaveLength(0);
});
