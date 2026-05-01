import type { SubmittedCell } from "../types/generated";

/**
 * Read the current contents of the active worksheet's used range and project
 * each data row into a `SubmittedCell` shape.
 *
 * Assumes the layout written by `refresh.ts`: row 0 is the header
 * (account, entity, costcenter, period, scenario, version, value); rows 1..N
 * are facts.
 *
 * Returns an empty array when the sheet is too small to contain a single fact.
 * Does NOT diff against baseline — that's `detectDeltas` in delta.ts.
 */
export async function readCurrentValuesFromActiveSheet(): Promise<SubmittedCell[]> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRange();
    used.load(["rowCount", "columnCount", "values"]);
    await context.sync();

    const rowCount = used.rowCount ?? 0;
    const colCount = used.columnCount ?? 0;
    if (rowCount < 2 || colCount < 7) return [];

    const matrix = used.values as (string | number | boolean | null)[][];
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
  });
}
