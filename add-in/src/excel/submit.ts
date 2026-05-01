import type { SubmittedCell } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";
import type { PageFilters } from "./pivot";

export interface LayoutDescriptor {
  rowAxis: DimName | null;
  colAxis: DimName | null;
  pageFilters: PageFilters;
}

/**
 * Read the active worksheet's used range and project each data cell into a
 * `SubmittedCell` using the active layout.
 *
 * Long-format (rowAxis=null && colAxis=null): cols 0..6 are the dim
 * intersection + value, header at row 0. (Same as Slice 7 behavior.)
 *
 * Pivot (any axis set): row 0 is the title strip, row 1 is the column header
 * (col A = row-axis dim name, cols B..N = col-axis member ids), rows 2..M+1
 * are data. Each non-empty data cell yields one SubmittedCell with:
 *   - rowAxis dim member from col A
 *   - colAxis dim member from the header at that column (single-axis: omitted)
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

    if (!layout.rowAxis && !layout.colAxis) {
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
  if (rowCount < 3 || colCount < 2) return [];

  // Mirror pivot.ts normalization: col-only axis is treated as row-only.
  let rowAxis = layout.rowAxis;
  let colAxis = layout.colAxis;
  if (!rowAxis && colAxis) {
    rowAxis = colAxis;
    colAxis = null;
  }
  if (!rowAxis) return [];

  const headerRow = matrix[1];
  const colMembers: string[] = [];
  for (let c = 1; c < colCount; c++) {
    colMembers.push(String(headerRow[c] ?? ""));
  }

  const out: SubmittedCell[] = [];
  for (let r = 2; r < rowCount; r++) {
    const dataRow = matrix[r];
    const rowMember = String(dataRow[0] ?? "");
    if (!rowMember) continue;

    if (!colAxis) {
      const value = String(dataRow[1] ?? "").trim();
      if (!value) continue;
      out.push(buildCell(rowAxis, rowMember, null, "", layout.pageFilters, value));
      continue;
    }

    for (let c = 1; c < colCount; c++) {
      const colMember = colMembers[c - 1];
      if (!colMember) continue;
      const value = String(dataRow[c] ?? "").trim();
      if (!value) continue;
      out.push(buildCell(rowAxis, rowMember, colAxis, colMember, layout.pageFilters, value));
    }
  }
  return out;
}

function buildCell(
  rowAxis: DimName,
  rowMember: string,
  colAxis: DimName | null,
  colMember: string,
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
  cell[rowAxis] = rowMember;
  if (colAxis) cell[colAxis] = colMember;
  for (const d of DIM_NAMES) {
    if (d === rowAxis || d === colAxis) continue;
    cell[d] = pageFilters[d] ?? "";
  }
  return cell;
}
