import type { FactRow } from "../types/generated";
import { type AxisSpec } from "./axes";
import { buildPivot, type PageFilters, type PivotOpts } from "./pivot";
import { groupingRanges } from "./hierarchy";

const DRIVER_FILL = "#F3F2F1"; // Fluent neutral background

// Pre-clear a generous rectangle that covers any plausibly-sized refresh.
// Avoids stale cells from a previous wider/taller pivot. Cheap on the Excel side
// because the clear is queued in the same Excel.run batch as the write.
const CLEAR_ROWS = 500;
const CLEAR_COLS = 50;

// Excel supports up to 8 outline levels per row/column.
const MAX_OUTLINE_LEVELS = 8;

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
 *  - axes.rows == [] && axes.cols == [] → 7-column long-format fallback.
 *  - axes.rows == [] && axes.cols != [] → normalized to rows-only.
 *  - otherwise → title row + (cols.length || 1) header rows + data rows.
 *
 * Drill: when `opts.rowsHierarchy` is provided, the pivot emits row tuples
 * in post-order (descendants above parent) and we apply Excel's native
 * row outline grouping. The user gets a +/− in Excel's row gutter at each
 * parent row to expand/collapse its descendants — entirely Excel-native UI.
 */
export async function writeFactsToActiveSheet(
  rows: FactRow[],
  axes: AxisSpec,
  pageFilters: PageFilters,
  driverAccounts: ReadonlySet<string> = new Set(),
  opts: PivotOpts = {},
): Promise<void> {
  const pivot = buildPivot(rows, axes, pageFilters, driverAccounts, opts);
  const totalRows = pivot.matrix.length;
  const totalCols = pivot.matrix[0]?.length ?? 0;
  if (totalRows === 0 || totalCols === 0) return;

  // Compute outline groups up-front (pure JS) so the Excel.run block stays
  // tight — one sync at the end.
  const grouping = groupingRanges(pivot.rowDepths);

  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();

    // Wipe any previous outline groups in the clear range. Each ungroup
    // call decrements outline level by 1; loop covers the worst case
    // (8 levels). Errors on already-flat rows are swallowed — Office.js
    // queues the call regardless and Excel ignores no-ops.
    const clearRange = sheet.getRangeByIndexes(0, 0, CLEAR_ROWS, CLEAR_COLS);
    for (let i = 0; i < MAX_OUTLINE_LEVELS; i++) {
      clearRange.ungroup("ByRows");
    }

    // Clear the previous refresh's footprint. Queued, not synced separately.
    clearRange.clear();

    const range = sheet.getRangeByIndexes(0, 0, totalRows, totalCols);
    range.values = pivot.matrix;

    sheet
      .getRangeByIndexes(0, 0, pivot.headerRowCount, totalCols)
      .format.font.bold = true;

    for (const fill of pivot.driverFillCoords) {
      sheet.getRangeByIndexes(fill.row, fill.col, fill.rows, fill.cols).format.fill.color = DRIVER_FILL;
    }

    // Apply outline grouping. Process levels outer-to-inner (1, 2, 3...).
    // Each `range.group("ByRows")` call increments the outline level for
    // its rows by 1 — so processing in ascending order produces nested
    // groups. Row indices are relative to the data block; we add
    // `headerRowCount` to land in the correct sheet row.
    const sortedLevels = Array.from(grouping.keys()).sort((a, b) => a - b);
    for (const level of sortedLevels) {
      for (const r of grouping.get(level) ?? []) {
        const rowStart = pivot.headerRowCount + r.start;
        sheet
          .getRangeByIndexes(rowStart, 0, r.length, totalCols)
          .group("ByRows");
      }
    }

    await context.sync();
  });
}
