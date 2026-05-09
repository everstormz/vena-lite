import type { FactRow } from "../types/generated";
import type { DimName } from "../types/dims";
import { type AxisSpec, tupleKey } from "./axes";

export type PageFilters = Partial<Record<DimName, string>>;

export interface FillCoord {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

/**
 * Hierarchy info for a single-dim axis. When passed to buildPivot, row
 * tuples are sorted in `order` (depth-first traversal of the axis dim's
 * subtree) and each emitted data row carries the corresponding depth so
 * refresh.ts can group child rows under their parent in Excel's outline
 * gutter. `order` membership is what matters — tuples whose first member
 * isn't in `order` fall back to alphabetical placement at the end.
 */
export interface AxisHierarchy {
  order: string[];
  depth: Map<string, number>;
}

export interface PivotOpts {
  rowsHierarchy?: AxisHierarchy;
}

export interface PivotResult {
  matrix: (string | number)[][];
  driverFillCoords: FillCoord[];
  headerRowCount: number;
  /**
   * Depth of each data row (parallel to `sortedRows` length). All zeros
   * when no hierarchy is in effect. Used by refresh.ts to call
   * `range.group("ByRows")` for nested outline groups.
   */
  rowDepths: number[];
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
 * Build the matrix to write to the active sheet.
 *
 *   axes.rows = [], axes.cols = [] → long-format fallback (7 cols).
 *   axes.rows = [], axes.cols = [...] → cols-only normalizes to rows-only.
 *   otherwise → title row + (cols.length || 1) header rows + data rows.
 *
 * Stacked axes use lexicographic tuple ordering for both rows and cols.
 * The (rowTuple, colTuple) pair must uniquely identify a fact —
 * App.tsx's refresh-gate (exactly one selection per non-axis dim)
 * keeps the backend response collision-free.
 *
 * Drill: when `opts.rowsHierarchy` is supplied AND the rows axis has a
 * single dim, row tuples are emitted in the hierarchy's depth-first
 * traversal order and each data row carries its depth in `rowDepths`.
 */
export function buildPivot(
  rows: FactRow[],
  axes: AxisSpec,
  pageFilters: PageFilters,
  driverAccounts: ReadonlySet<string>,
  opts?: PivotOpts,
): PivotResult {
  if (axes.rows.length === 0 && axes.cols.length === 0) {
    return buildLongFormat(rows, driverAccounts);
  }
  const normalized: AxisSpec =
    axes.rows.length === 0
      ? { rows: axes.cols, cols: [] }
      : axes;
  return buildPivotMatrix(rows, normalized, pageFilters, driverAccounts, opts);
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
  return { matrix, driverFillCoords, headerRowCount: 1, rowDepths: rows.map(() => 0) };
}

function buildPivotMatrix(
  factRows: FactRow[],
  axes: AxisSpec,
  pageFilters: PageFilters,
  driverAccounts: ReadonlySet<string>,
  opts: PivotOpts | undefined,
): PivotResult {
  const rowsLen = axes.rows.length;
  const colsLen = axes.cols.length;

  const uniqRowTuples = new Map<string, string[]>();
  const uniqColTuples = new Map<string, string[]>();
  const cellMap = new Map<string, FactRow>();

  for (const f of factRows) {
    const rt = axes.rows.map((d) => f[d]);
    const ct = axes.cols.map((d) => f[d]);
    const rk = tupleKey(rt);
    const ck = tupleKey(ct);
    if (!uniqRowTuples.has(rk)) uniqRowTuples.set(rk, rt);
    if (colsLen > 0 && !uniqColTuples.has(ck)) uniqColTuples.set(ck, ct);
    cellMap.set(`${rk}||${ck}`, f);
  }

  // Drill applies only to single-dim row axes — multi-axis stacked drill
  // is out of scope for v1.
  const useRowHierarchy =
    opts?.rowsHierarchy !== undefined && rowsLen === 1;
  const sortedRows = useRowHierarchy
    ? sortByHierarchy(
        Array.from(uniqRowTuples.values()),
        opts!.rowsHierarchy!,
      )
    : Array.from(uniqRowTuples.values()).sort(compareTuples);
  const rowDepths: number[] = useRowHierarchy
    ? sortedRows.map((rt) => opts!.rowsHierarchy!.depth.get(rt[0]) ?? 0)
    : sortedRows.map(() => 0);

  const sortedCols =
    colsLen > 0
      ? Array.from(uniqColTuples.values()).sort(compareTuples)
      : [[VALUE_LABEL]];

  const colHeaderCount = Math.max(1, colsLen);
  const headerRowCount = 1 + colHeaderCount;
  const totalCols = rowsLen + sortedCols.length;

  const titleStr = Object.entries(pageFilters)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(" | ");
  const titleRow: (string | number)[] = [
    titleStr,
    ...new Array(Math.max(0, totalCols - 1)).fill(""),
  ];

  const colHeaderRows: (string | number)[][] = [];
  const lastColHeaderIdx = colHeaderCount - 1;
  for (let depth = 0; depth < colHeaderCount; depth++) {
    const headerRow: (string | number)[] = [];
    for (let r = 0; r < rowsLen; r++) {
      headerRow.push(depth === lastColHeaderIdx ? axes.rows[r] : "");
    }
    for (const ct of sortedCols) {
      headerRow.push(ct[depth] ?? "");
    }
    colHeaderRows.push(headerRow);
  }

  const dataRows: (string | number)[][] = sortedRows.map((rt, i) => {
    // Indent the row label by depth for visual hierarchy. Excel outline
    // groups will collapse children under parents; the indent makes the
    // tree readable even when expanded.
    const labelIndent = useRowHierarchy ? "  ".repeat(rowDepths[i]) : "";
    const labels: (string | number)[] = rt.map((m, j) =>
      j === 0 ? `${labelIndent}${m}` : m,
    );
    const cells: (string | number)[] = [...labels];
    const rk = tupleKey(rt);
    for (const ct of sortedCols) {
      const ck = colsLen > 0 ? tupleKey(ct) : "";
      const fact = cellMap.get(`${rk}||${ck}`);
      cells.push(fact ? fact.value : "");
    }
    return cells;
  });

  const matrix: (string | number)[][] = [titleRow, ...colHeaderRows, ...dataRows];

  const driverFillCoords = computeDriverFills({
    axes,
    sortedRows,
    sortedCols,
    pageFilters,
    driverAccounts,
    dataStartRow: headerRowCount,
    rowsLen,
    dataColCount: sortedCols.length,
    dataRowCount: sortedRows.length,
  });

  return { matrix, driverFillCoords, headerRowCount, rowDepths };
}

/**
 * Sort row tuples using the hierarchy's depth-first order. Tuples whose
 * first member isn't in `order` (shouldn't happen if the filter expansion
 * matches what the slice returned, but defensive) fall back to alphabetical
 * placement at the end.
 */
function sortByHierarchy(
  tuples: string[][],
  hierarchy: AxisHierarchy,
): string[][] {
  const orderIndex = new Map<string, number>();
  hierarchy.order.forEach((id, i) => orderIndex.set(id, i));
  return [...tuples].sort((a, b) => {
    const ai = orderIndex.get(a[0]);
    const bi = orderIndex.get(b[0]);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return compareTuples(a, b);
  });
}

function compareTuples(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? "";
    const bv = b[i] ?? "";
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

interface DriverFillArgs {
  axes: AxisSpec;
  sortedRows: string[][];
  sortedCols: string[][];
  pageFilters: PageFilters;
  driverAccounts: ReadonlySet<string>;
  dataStartRow: number;
  rowsLen: number;
  dataColCount: number;
  dataRowCount: number;
}

function computeDriverFills(args: DriverFillArgs): FillCoord[] {
  const {
    axes,
    sortedRows,
    sortedCols,
    pageFilters,
    driverAccounts,
    dataStartRow,
    rowsLen,
    dataColCount,
    dataRowCount,
  } = args;
  const fills: FillCoord[] = [];
  const accountInRows = axes.rows.indexOf("account");
  const accountInCols = axes.cols.indexOf("account");

  if (accountInRows >= 0) {
    sortedRows.forEach((rt, i) => {
      if (driverAccounts.has(rt[accountInRows])) {
        fills.push({
          row: dataStartRow + i,
          col: rowsLen,
          rows: 1,
          cols: dataColCount,
        });
      }
    });
    return fills;
  }
  if (accountInCols >= 0) {
    sortedCols.forEach((ct, i) => {
      if (driverAccounts.has(ct[accountInCols])) {
        fills.push({
          row: dataStartRow,
          col: rowsLen + i,
          rows: dataRowCount,
          cols: 1,
        });
      }
    });
    return fills;
  }
  const accountFilter = pageFilters.account;
  if (
    accountFilter !== undefined &&
    driverAccounts.has(accountFilter) &&
    dataRowCount > 0 &&
    dataColCount > 0
  ) {
    fills.push({
      row: dataStartRow,
      col: rowsLen,
      rows: dataRowCount,
      cols: dataColCount,
    });
  }
  return fills;
}
