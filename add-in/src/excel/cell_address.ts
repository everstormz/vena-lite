import { DIM_NAMES } from "../types/dims";
import type { LayoutDescriptor } from "./submit";
import type { ValueIntersection } from "../api/client";

/**
 * Map a (rowIndex, colIndex) cell position in the active sheet to its dim
 * intersection, given the layout that produced the matrix. Returns null
 * when the cell is in a header / row-label / non-data zone.
 *
 * Used by OverridePanel — `submit.ts` does the same logic over the whole
 * range, but the Override flow only needs the single selected cell.
 */
export function intersectionAtCell(
  matrix: (string | number | boolean | null)[][],
  rowIndex: number,
  colIndex: number,
  layout: LayoutDescriptor,
): ValueIntersection | null {
  // Long-format: row 0 is the header, cells 0..6 are dims+value.
  if (layout.rows.length === 0 && layout.cols.length === 0) {
    if (rowIndex < 1 || rowIndex >= matrix.length) return null;
    if (colIndex !== 6) return null; // user must select the value cell
    const row = matrix[rowIndex];
    return {
      account: String(row?.[0] ?? ""),
      entity: String(row?.[1] ?? ""),
      costcenter: String(row?.[2] ?? ""),
      period: String(row?.[3] ?? ""),
      scenario: String(row?.[4] ?? ""),
      version: String(row?.[5] ?? ""),
    };
  }
  // Pivot: mirror submit.ts normalization (rows-empty + cols-non-empty → rows-only).
  let rows = layout.rows;
  let cols = layout.cols;
  if (rows.length === 0 && cols.length > 0) {
    rows = cols;
    cols = [];
  }
  const rowsLen = rows.length;
  const colsLen = cols.length;
  const colHeaderCount = Math.max(1, colsLen);
  const dataStartRow = 1 + colHeaderCount;
  const dataStartCol = rowsLen;

  if (rowIndex < dataStartRow) return null;
  if (colIndex < dataStartCol) return null;
  if (rowIndex >= matrix.length) return null;

  const rowTuple: string[] = [];
  for (let i = 0; i < rowsLen; i++) {
    rowTuple.push(String(matrix[rowIndex]?.[i] ?? ""));
  }
  const colTuple: string[] = [];
  if (colsLen > 0) {
    for (let depth = 0; depth < colsLen; depth++) {
      colTuple.push(String(matrix[1 + depth]?.[colIndex] ?? ""));
    }
  }

  const inter: ValueIntersection = {
    account: "",
    entity: "",
    costcenter: "",
    period: "",
    scenario: "",
    version: "",
  };
  for (let i = 0; i < rowsLen; i++) inter[rows[i]] = rowTuple[i];
  for (let i = 0; i < colsLen; i++) inter[cols[i]] = colTuple[i];
  for (const d of DIM_NAMES) {
    if (rows.includes(d) || cols.includes(d)) continue;
    inter[d] = layout.pageFilters[d] ?? "";
  }
  return inter;
}
