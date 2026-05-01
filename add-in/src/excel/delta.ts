import type { SubmittedCell } from "../types/generated";
import { type Baseline, keyOf } from "./baseline";

/**
 * Compute the set of cells the user has changed since the last Refresh.
 *
 * Rules (v1):
 *  - Only intersections present in `baseline` can produce deltas. New rows the
 *    user typed in by hand are ignored (they have no baseline value to diff).
 *  - Blank / null cell values are treated as "no change" (deletion is out of
 *    scope for v1).
 *  - String comparison after trimming. The wire format is decimal-as-string;
 *    Excel may surface numeric coercions, so the caller is expected to feed in
 *    `String(rangeValue)`.
 */
export function detectDeltas(baseline: Baseline, current: SubmittedCell[]): SubmittedCell[] {
  const out: SubmittedCell[] = [];
  for (const cell of current) {
    const k = keyOf(cell);
    const before = baseline[k];
    if (before === undefined) continue; // new intersection — out of scope v1
    const after = (cell.value ?? "").trim();
    if (after === "") continue; // blank = no change
    if (after === before.trim()) continue; // unchanged
    out.push({ ...cell, value: after });
  }
  return out;
}
