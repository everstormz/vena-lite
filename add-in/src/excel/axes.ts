import { DIM_NAMES, type DimName } from "../types/dims";

export interface AxisSpec {
  rows: DimName[];
  cols: DimName[];
}

export type Lane = "rows" | "cols" | "page";

export const TUPLE_DELIM = "|";

/**
 * Compose a stable key for a tuple of dim values. Delimiter MUST NOT
 * appear in any member id — pickers reject `|` to keep this true.
 */
export function tupleKey(values: readonly string[]): string {
  return values.join(TUPLE_DELIM);
}

export function parseTuple(key: string): string[] {
  return key === "" ? [] : key.split(TUPLE_DELIM);
}

export function pageFilterDims(spec: AxisSpec): DimName[] {
  const onAxis = new Set<DimName>([...spec.rows, ...spec.cols]);
  return DIM_NAMES.filter((d) => !onAxis.has(d));
}

export function laneOf(spec: AxisSpec, dim: DimName): Lane {
  if (spec.rows.includes(dim)) return "rows";
  if (spec.cols.includes(dim)) return "cols";
  return "page";
}

/**
 * Move `dim` to `to` lane at `position` (defaults to end). Removes from
 * the other lanes first so a dim is never on two axes.
 */
export function moveDim(
  spec: AxisSpec,
  dim: DimName,
  to: Lane,
  position?: number,
): AxisSpec {
  const rows = spec.rows.filter((d) => d !== dim);
  const cols = spec.cols.filter((d) => d !== dim);
  if (to === "page") return { rows, cols };
  if (to === "rows") {
    const idx = clampIndex(position ?? rows.length, rows.length);
    rows.splice(idx, 0, dim);
    return { rows, cols };
  }
  const idx = clampIndex(position ?? cols.length, cols.length);
  cols.splice(idx, 0, dim);
  return { rows, cols };
}

/**
 * Reorder `dim` within its current axis lane. No-op if `dim` isn't on
 * that lane.
 */
export function reorderInLane(
  spec: AxisSpec,
  lane: "rows" | "cols",
  dim: DimName,
  toIndex: number,
): AxisSpec {
  const list = spec[lane];
  const fromIdx = list.indexOf(dim);
  if (fromIdx < 0) return spec;
  const next = list.slice();
  next.splice(fromIdx, 1);
  next.splice(clampIndex(toIndex, next.length), 0, dim);
  return { ...spec, [lane]: next };
}

function clampIndex(i: number, len: number): number {
  if (i < 0) return 0;
  if (i > len) return len;
  return i;
}
