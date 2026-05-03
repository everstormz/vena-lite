import type { DimMemberInfo } from "../types/generated";
import { DIM_NAMES, type DimName } from "../types/dims";
import type { AxisSpec } from "./axes";

const SETTING_KEY = "vena_lite.filters.v2";

export interface FilterState {
  filters: Record<DimName, string[]>;
  axes: AxisSpec;
}

export function defaultFilterState(): FilterState {
  return {
    filters: emptyFilters(),
    axes: { rows: ["account"], cols: ["period"] },
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

function dedupeDimList(arr: unknown): DimName[] {
  if (!Array.isArray(arr)) return [];
  const out: DimName[] = [];
  const seen = new Set<DimName>();
  for (const v of arr) {
    if (isDimName(v) && !seen.has(v)) {
      out.push(v);
      seen.add(v);
    }
  }
  return out;
}

/**
 * Detect a Slice-8/9 v1 shape: top-level `rowAxis` / `colAxis` (string
 * or null) with no `axes` field. Migration: rowAxis string → [rowAxis];
 * null → []. Same for colAxis. Filters dict is preserved verbatim. The
 * `version` field is intentionally NOT set on v1 payloads.
 */
function migrateV1ToV2(raw: Record<string, unknown>): {
  axes: AxisSpec;
  filters?: Record<string, unknown>;
} {
  const rows: DimName[] = [];
  const cols: DimName[] = [];
  if (isDimName(raw.rowAxis)) rows.push(raw.rowAxis);
  if (isDimName(raw.colAxis)) cols.push(raw.colAxis);
  return {
    axes: { rows, cols },
    filters: (raw.filters as Record<string, unknown>) ?? undefined,
  };
}

/**
 * Parse a raw stored value into a valid FilterState. Unknown / missing
 * fields fall back to defaults; non-string entries in filter arrays are
 * dropped. Recognizes both the v1 and v2 schemas; v1 payloads are
 * migrated in-place and re-saved on the next storeFilterState.
 *
 * Member ids are NOT validated against the live dim model here — that
 * requires DimMemberInfo data, see dropUnknownMembers.
 */
export function parseFilterState(raw: unknown): FilterState {
  const base = defaultFilterState();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;

  // v2 detection: presence of `axes` (with rows or cols arrays).
  let axesRaw: Record<string, unknown> | undefined;
  let filtersRaw: Record<string, unknown> | undefined;
  if (obj.axes && typeof obj.axes === "object") {
    axesRaw = obj.axes as Record<string, unknown>;
    filtersRaw = obj.filters as Record<string, unknown> | undefined;
  } else if ("rowAxis" in obj || "colAxis" in obj) {
    // v1 payload — migrate
    const migrated = migrateV1ToV2(obj);
    base.axes = migrated.axes;
    filtersRaw = migrated.filters;
  } else if (obj.filters && typeof obj.filters === "object") {
    filtersRaw = obj.filters as Record<string, unknown>;
  }

  if (axesRaw) {
    const rows = dedupeDimList(axesRaw.rows);
    const cols = dedupeDimList(axesRaw.cols);
    // A dim can't be on both axes — first-wins.
    const onRows = new Set(rows);
    base.axes = {
      rows,
      cols: cols.filter((d) => !onRows.has(d)),
    };
  }

  if (filtersRaw) {
    for (const d of DIM_NAMES) {
      const v = filtersRaw[d];
      if (Array.isArray(v)) {
        base.filters[d] = v.filter((x): x is string => typeof x === "string");
      }
    }
  }

  return base;
}

export function loadFilterState(): FilterState {
  const raw = Office.context.document.settings.get(SETTING_KEY);
  if (raw) return parseFilterState(raw);
  // Fall back to v1 key for one-shot migration on first v2-aware load.
  const v1 = Office.context.document.settings.get("vena_lite.filters.v1");
  return parseFilterState(v1);
}

export async function storeFilterState(state: FilterState): Promise<void> {
  Office.context.document.settings.set(SETTING_KEY, {
    version: 2,
    filters: state.filters,
    axes: state.axes,
  });
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
