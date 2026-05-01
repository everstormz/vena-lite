import type { FactRow } from "../types/generated";
import type { DimName } from "../types/dims";

export type PageFilters = Partial<Record<DimName, string>>;

export interface FillCoord {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

export interface PivotResult {
  matrix: (string | number)[][];
  driverFillCoords: FillCoord[];
  headerRowIndex: number;
}

const LONG_FORMAT_HEADERS = [
  "account",
  "entity",
  "costcenter",
  "period",
  "scenario",
  "version",
  "value",
] as const;
const VALUE_LABEL = "value";
const VALUE_COL_LONG = LONG_FORMAT_HEADERS.indexOf(VALUE_LABEL);

/**
 * Build the matrix to write to the active sheet, given backend slice rows
 * and the active layout.
 *
 * Cases:
 *  - No axis: long-format fallback (today's 7-column layout).
 *  - Row axis only: 2-column [rowDim | value] table. Page filter assignments
 *    appear in a title row above the header.
 *  - Both axes: title row + header row + data rows. The (rowMember, colMember)
 *    pair must uniquely identify a fact — App.tsx's refresh-gate enforces
 *    "exactly one selection per non-axis dim" so the backend response is
 *    collision-free here.
 *
 * Driver gray-fill coordinates depend on where account lives (row axis,
 * col axis, or page filter) — see Slice 8 plan, Edge cases section.
 */
export function buildPivot(
  rows: FactRow[],
  rowAxis: DimName | null,
  colAxis: DimName | null,
  pageFilters: PageFilters,
  driverAccounts: ReadonlySet<string>,
): PivotResult {
  // Col-only is just row-only with a different label for the user; normalize.
  if (!rowAxis && colAxis) {
    rowAxis = colAxis;
    colAxis = null;
  }
  if (!rowAxis) {
    return buildLongFormat(rows, driverAccounts);
  }
  return buildPivotMatrix(rows, rowAxis, colAxis, pageFilters, driverAccounts);
}

function buildLongFormat(
  rows: FactRow[],
  driverAccounts: ReadonlySet<string>,
): PivotResult {
  const matrix: (string | number)[][] = [
    [...LONG_FORMAT_HEADERS],
    ...rows.map((r) => [
      r.account,
      r.entity,
      r.costcenter,
      r.period,
      r.scenario,
      r.version,
      r.value,
    ]),
  ];
  const driverFillCoords: FillCoord[] = [];
  rows.forEach((r, i) => {
    if (driverAccounts.has(r.account)) {
      driverFillCoords.push({ row: i + 1, col: VALUE_COL_LONG, rows: 1, cols: 1 });
    }
  });
  return { matrix, driverFillCoords, headerRowIndex: 0 };
}

function buildPivotMatrix(
  rows: FactRow[],
  rowAxis: DimName,
  colAxis: DimName | null,
  pageFilters: PageFilters,
  driverAccounts: ReadonlySet<string>,
): PivotResult {
  const rowMembers = uniqueSorted(rows.map((r) => r[rowAxis]));
  const colMembers = colAxis
    ? uniqueSorted(rows.map((r) => r[colAxis]))
    : [VALUE_LABEL];

  const cellMap = new Map<string, FactRow>();
  for (const r of rows) {
    const rk = r[rowAxis];
    const ck = colAxis ? r[colAxis] : VALUE_LABEL;
    cellMap.set(`${rk}|${ck}`, r);
  }

  const titleStr = Object.entries(pageFilters)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(" | ");

  const totalCols = colMembers.length + 1;
  const titleRow: (string | number)[] = [titleStr, ...new Array(totalCols - 1).fill("")];
  const headerRow: (string | number)[] = [rowAxis, ...colMembers];

  const dataRows: (string | number)[][] = rowMembers.map((rm) => {
    const cells: (string | number)[] = [rm];
    for (const cm of colMembers) {
      const fact = cellMap.get(`${rm}|${cm}`);
      cells.push(fact ? fact.value : "");
    }
    return cells;
  });

  const matrix: (string | number)[][] = [titleRow, headerRow, ...dataRows];

  const driverFillCoords: FillCoord[] = [];
  const dataStartRow = 2;
  const dataColCount = colMembers.length;
  const dataRowCount = rowMembers.length;

  if (rowAxis === "account") {
    rowMembers.forEach((rm, i) => {
      if (driverAccounts.has(rm)) {
        driverFillCoords.push({
          row: dataStartRow + i,
          col: 1,
          rows: 1,
          cols: dataColCount,
        });
      }
    });
  } else if (colAxis === "account") {
    colMembers.forEach((cm, i) => {
      if (driverAccounts.has(cm)) {
        driverFillCoords.push({
          row: dataStartRow,
          col: 1 + i,
          rows: dataRowCount,
          cols: 1,
        });
      }
    });
  } else {
    const accountFilter = pageFilters.account;
    if (
      accountFilter !== undefined &&
      driverAccounts.has(accountFilter) &&
      dataRowCount > 0 &&
      dataColCount > 0
    ) {
      driverFillCoords.push({
        row: dataStartRow,
        col: 1,
        rows: dataRowCount,
        cols: dataColCount,
      });
    }
  }

  return { matrix, driverFillCoords, headerRowIndex: 1 };
}

function uniqueSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort();
}
