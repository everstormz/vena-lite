import type { FactRow } from "../types/generated";
import type { DimName } from "../types/dims";
import { buildPivot, type PageFilters } from "./pivot";

const DRIVER_FILL = "#F3F2F1"; // Fluent neutral background

// Pre-clear a generous rectangle that covers any plausibly-sized refresh.
// Avoids stale cells from a previous wider/taller pivot. Cheap on the Excel side
// because the clear is queued in the same Excel.run batch as the write.
const CLEAR_ROWS = 500;
const CLEAR_COLS = 50;

/**
 * Write the pivoted (or long-format) result of a /slice call to A1 of the
 * active worksheet.
 *
 * Office.js perf invariant: ONE batched `range.values =` write + per-cell
 * styling all queued + ONE `await context.sync()`. The pure pivot transform
 * lives in pivot.ts so this file owns only Office.js calls.
 *
 * Driver-controlled accounts get a gray fill — coordinates depend on which
 * axis (if any) holds the account dim; see buildPivot.
 *
 * Layout cases:
 *  - rowAxis=null && colAxis=null → today's 7-column long-format fallback.
 *  - rowAxis only → 2-column [rowDim | value] table with a title row above.
 *  - both axes → title row + header row + data rows.
 */
export async function writeFactsToActiveSheet(
  rows: FactRow[],
  rowAxis: DimName | null,
  colAxis: DimName | null,
  pageFilters: PageFilters,
  driverAccounts: ReadonlySet<string> = new Set(),
): Promise<void> {
  const pivot = buildPivot(rows, rowAxis, colAxis, pageFilters, driverAccounts);
  const totalRows = pivot.matrix.length;
  const totalCols = pivot.matrix[0]?.length ?? 0;
  if (totalRows === 0 || totalCols === 0) return;

  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();

    // Clear the previous refresh's footprint. Queued, not synced separately.
    sheet.getRangeByIndexes(0, 0, CLEAR_ROWS, CLEAR_COLS).clear();

    const range = sheet.getRangeByIndexes(0, 0, totalRows, totalCols);
    range.values = pivot.matrix;

    sheet.getRangeByIndexes(pivot.headerRowIndex, 0, 1, totalCols).format.font.bold = true;

    for (const fill of pivot.driverFillCoords) {
      sheet.getRangeByIndexes(fill.row, fill.col, fill.rows, fill.cols).format.fill.color = DRIVER_FILL;
    }

    await context.sync();
  });
}
