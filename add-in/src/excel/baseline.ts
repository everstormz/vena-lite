import type { FactRow, SubmittedCell } from "../types/generated";

/**
 * Baseline = the values most recently pulled from the cube via Refresh.
 *
 * Stored in Office.js workbook settings (custom XML part inside the .xlsx).
 * Persists across saves; scoped to the workbook. Reset whenever the user
 * Refreshes — the new pull becomes the new baseline.
 */
const SETTING_KEY = "vena_lite.baseline.v1";

export type BaselineKey = string;
export type Baseline = Record<BaselineKey, string>;

type Intersection = Pick<
  SubmittedCell,
  "account" | "entity" | "costcenter" | "period" | "scenario" | "version"
>;

export function keyOf(c: Intersection): BaselineKey {
  // '|' is fine because dim member ids in the v1 model don't contain it.
  return `${c.account}|${c.entity}|${c.costcenter}|${c.period}|${c.scenario}|${c.version}`;
}

export function buildBaseline(rows: FactRow[]): Baseline {
  const out: Baseline = {};
  for (const r of rows) out[keyOf(r)] = r.value;
  return out;
}

export async function storeBaseline(baseline: Baseline): Promise<void> {
  Office.context.document.settings.set(SETTING_KEY, baseline);
  await new Promise<void>((resolve, reject) => {
    Office.context.document.settings.saveAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
      else reject(new Error(result.error?.message ?? "settings.saveAsync failed"));
    });
  });
}

export function loadBaseline(): Baseline {
  const v = Office.context.document.settings.get(SETTING_KEY);
  return (v as Baseline | null) ?? {};
}
