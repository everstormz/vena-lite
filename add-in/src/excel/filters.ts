import type { DimMemberInfo } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";

const SETTING_KEY = "vena_lite.filters.v1";

export interface FilterState {
  filters: Record<DimName, string[]>;
  rowAxis: DimName | null;
  colAxis: DimName | null;
}

export function defaultFilterState(): FilterState {
  return {
    filters: emptyFilters(),
    rowAxis: "account",
    colAxis: "period",
  };
}

function emptyFilters(): Record<DimName, string[]> {
  const out = {} as Record<DimName, string[]>;
  for (const d of DIM_NAMES) out[d] = [];
  return out;
}

function isDimName(s: unknown): s is DimName {
  return typeof s === "string" && (DIM_NAMES as readonly string[]).includes(s);
}

/**
 * Parse a raw stored value into a valid FilterState. Unknown / missing
 * fields fall back to defaults; non-string entries in filter arrays are
 * dropped. Member ids are NOT validated against the live dim model here —
 * that requires DimMemberInfo data, see dropUnknownMembers.
 */
export function parseFilterState(raw: unknown): FilterState {
  const base = defaultFilterState();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;

  if (obj.filters && typeof obj.filters === "object") {
    const f = obj.filters as Record<string, unknown>;
    for (const d of DIM_NAMES) {
      const v = f[d];
      if (Array.isArray(v)) {
        base.filters[d] = v.filter((x): x is string => typeof x === "string");
      }
    }
  }
  if (isDimName(obj.rowAxis)) base.rowAxis = obj.rowAxis;
  else if (obj.rowAxis === null) base.rowAxis = null;
  if (isDimName(obj.colAxis)) base.colAxis = obj.colAxis;
  else if (obj.colAxis === null) base.colAxis = null;

  return base;
}

export function loadFilterState(): FilterState {
  const raw = Office.context.document.settings.get(SETTING_KEY);
  return parseFilterState(raw);
}

export async function storeFilterState(state: FilterState): Promise<void> {
  Office.context.document.settings.set(SETTING_KEY, state);
  await new Promise<void>((resolve, reject) => {
    Office.context.document.settings.saveAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
      else reject(new Error(result.error?.message ?? "settings.saveAsync failed"));
    });
  });
}

/**
 * Drop member ids no longer present in the live dim model (e.g. after a
 * scenario was renamed). Returns the cleaned state plus a count for surfacing
 * a status to the user.
 */
export function dropUnknownMembers(
  state: FilterState,
  dimensionsByName: Partial<Record<DimName, DimMemberInfo[]>>,
): { state: FilterState; droppedCount: number } {
  const cleaned: Record<DimName, string[]> = emptyFilters();
  let dropped = 0;
  for (const d of DIM_NAMES) {
    const known = new Set((dimensionsByName[d] ?? []).map((m) => m.id));
    const original = state.filters[d] ?? [];
    const kept = original.filter((id) => known.has(id));
    cleaned[d] = kept;
    dropped += original.length - kept.length;
  }
  return {
    state: { ...state, filters: cleaned },
    droppedCount: dropped,
  };
}
