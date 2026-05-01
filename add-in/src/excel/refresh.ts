import type { FactRow } from "../types/generated";

const HEADERS = [
  "account",
  "entity",
  "costcenter",
  "period",
  "scenario",
  "version",
  "value",
] as const;

const VALUE_COL = HEADERS.indexOf("value");
const DRIVER_FILL = "#F3F2F1"; // Fluent neutral background

/**
 * Write fact rows starting at A1 of the active worksheet.
 *
 * Office.js perf rule (R3 in the build plan): one batched range write, one
 * `context.sync()`. The whole 96-row default seed should land in well under
 * 300 ms, even with per-row driver styling, because property writes don't
 * trigger their own syncs — they're queued and flushed by the single sync
 * at the end of `Excel.run`.
 *
 * Driver-controlled accounts (passed via `driverAccounts`) get a gray fill on
 * their value cell so the user sees they're computed, not user-editable.
 * Submitting at one will be rejected by the backend with `reason: "driver"`.
 *
 * Values are sent as strings (matches the wire format) so Excel doesn't coerce
 * to floats and lose six-decimal precision.
 */
export async function writeFactsToActiveSheet(
  rows: FactRow[],
  driverAccounts: ReadonlySet<string> = new Set(),
): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();

    const matrix: (string | number)[][] = [
      [...HEADERS],
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

    const totalRows = matrix.length;
    const totalCols = HEADERS.length;
    const range = sheet.getRangeByIndexes(0, 0, totalRows, totalCols);
    range.values = matrix;

    sheet.getRangeByIndexes(0, 0, 1, totalCols).format.font.bold = true;

    if (driverAccounts.size > 0) {
      rows.forEach((r, i) => {
        if (driverAccounts.has(r.account)) {
          // Row index in sheet = i + 1 (header is row 0).
          const valueCell = sheet.getRangeByIndexes(i + 1, VALUE_COL, 1, 1);
          valueCell.format.fill.color = DRIVER_FILL;
        }
      });
    }

    await context.sync();
  });
}
