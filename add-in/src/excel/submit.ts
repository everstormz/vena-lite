import type { SubmittedCell } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";
import { type AxisSpec } from "./axes";
import type { PageFilters } from "./pivot";

export interface LayoutDescriptor {
  rows: DimName[];
  cols: DimName[];
  pageFilters: PageFilters;
}

/**
 * Read the active worksheet's used range and project each data cell into a
 * `SubmittedCell` using the active layout.
 *
 * Long-format (rows=[] && cols=[]): cols 0..6 are the dim intersection +
 * value, header at row 0. (Same as Slice 7 behavior.)
 *
 * Pivot (any axis non-empty): row 0 is the title strip, rows 1..N (N =
 * cols.length || 1) are column headers (the LAST col header row also
 * carries the row dim names in the row-label cols), rows N+1.. are data.
 * Each non-empty data cell yields one SubmittedCell with:
 *   - row dim members from the leading rows.length columns
 *   - col dim members from the (cols.length || 1) header rows above
 *   - other dims from layout.pageFilters
 *
 * Empty value cells are skipped (matches the v1 "blank = no change" rule).
 */
export async function readCurrentValuesFromActiveSheet(
  layout: LayoutDescriptor,
): Promise<SubmittedCell[]> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRange();
    used.load(["rowCount", "columnCount", "values"]);
    await context.sync();

    const rowCount = used.rowCount ?? 0;
    const colCount = used.columnCount ?? 0;
    if (rowCount === 0 || colCount === 0) return [];

    const matrix = used.values as (string | number | boolean | null)[][];

    if (layout.rows.length === 0 && layout.cols.length === 0) {
      return readLongFormat(matrix, rowCount, colCount);
    }
    return readPivot(matrix, rowCount, colCount, layout);
  });
}

function readLongFormat(
  matrix: (string | number | boolean | null)[][],
  rowCount: number,
  colCount: number,
): SubmittedCell[] {
  if (rowCount < 2 || colCount < 7) return [];
  const out: SubmittedCell[] = [];
  for (let r = 1; r < rowCount; r++) {
    const row = matrix[r];
    out.push({
      account: String(row[0] ?? ""),
      entity: String(row[1] ?? ""),
      costcenter: String(row[2] ?? ""),
      period: String(row[3] ?? ""),
      scenario: String(row[4] ?? ""),
      version: String(row[5] ?? ""),
      value: String(row[6] ?? ""),
    });
  }
  return out;
}

function readPivot(
  matrix: (string | number | boolean | null)[][],
  rowCount: number,
  colCount: number,
  layout: LayoutDescriptor,
): SubmittedCell[] {
  // Mirror pivot.ts normalization: rows-empty + cols-non-empty becomes rows-only.
  let rowAxes: AxisSpec["rows"] = layout.rows;
  let colAxes: AxisSpec["cols"] = layout.cols;
  if (rowAxes.length === 0 && colAxes.length > 0) {
    rowAxes = colAxes;
    colAxes = [];
  }
  if (rowAxes.length === 0) return [];

  const rowsLen = rowAxes.length;
  const colsLen = colAxes.length;
  const colHeaderCount = Math.max(1, colsLen);
  const dataStartRow = 1 + colHeaderCount;
  const dataStartCol = rowsLen;

  if (rowCount < dataStartRow + 1) return [];
  if (colCount < dataStartCol + 1) return [];

  // Parse col tuples from the col header rows. Each value column carries
  // a tuple of colsLen members. In rows-only mode (colsLen === 0) we use a
  // single placeholder tuple.
  const colTuples: string[][] = [];
  for (let c = dataStartCol; c < colCount; c++) {
    if (colsLen === 0) {
      colTuples.push([]);
    } else {
      const tuple: string[] = [];
      for (let depth = 0; depth < colsLen; depth++) {
        tuple.push(String(matrix[1 + depth]?.[c] ?? ""));
      }
      colTuples.push(tuple);
    }
  }

  const out: SubmittedCell[] = [];
  for (let r = dataStartRow; r < rowCount; r++) {
    const dataRow = matrix[r];
    if (!dataRow) continue;

    const rowTuple: string[] = [];
    let allBlank = true;
    for (let i = 0; i < rowsLen; i++) {
      const v = String(dataRow[i] ?? "");
      rowTuple.push(v);
      if (v) allBlank = false;
    }
    if (allBlank) continue;

    for (let c = dataStartCol; c < colCount; c++) {
      const colIdx = c - dataStartCol;
      const colTuple = colTuples[colIdx];
      // In pivot-with-cols mode, skip cols whose header tuple is entirely blank
      // (would indicate a stray sheet column past the data).
      if (colsLen > 0 && colTuple.every((m) => !m)) continue;

      const value = String(dataRow[c] ?? "").trim();
      if (!value) continue;

      out.push(
        buildCell(rowAxes, rowTuple, colAxes, colTuple, layout.pageFilters, value),
      );
    }
  }
  return out;
}

function buildCell(
  rowAxes: DimName[],
  rowTuple: string[],
  colAxes: DimName[],
  colTuple: string[],
  pageFilters: PageFilters,
  value: string,
): SubmittedCell {
  const cell: SubmittedCell = {
    account: "",
    entity: "",
    costcenter: "",
    period: "",
    scenario: "",
    version: "",
    value,
  };
  for (let i = 0; i < rowAxes.length; i++) {
    cell[rowAxes[i]] = rowTuple[i] ?? "";
  }
  for (let i = 0; i < colAxes.length; i++) {
    cell[colAxes[i]] = colTuple[i] ?? "";
  }
  for (const d of DIM_NAMES) {
    if (rowAxes.includes(d) || colAxes.includes(d)) continue;
    cell[d] = pageFilters[d] ?? "";
  }
  return cell;
}
