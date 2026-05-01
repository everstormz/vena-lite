import { detectDeltas } from "../excel/delta";
import { buildBaseline, keyOf } from "../excel/baseline";
import type { FactRow, SubmittedCell } from "../types/generated";

function fact(overrides: Partial<FactRow> = {}): FactRow {
  return {
    account: "4000_Revenue",
    entity: "E001_US",
    costcenter: "CC100_Sales",
    period: "2026-01",
    scenario: "Actual",
    version: "v1",
    value: "100.000000",
    ...overrides,
  };
}

function cell(overrides: Partial<SubmittedCell> = {}): SubmittedCell {
  return fact(overrides);
}

test("identical baseline + current produces no deltas", () => {
  const rows = [fact(), fact({ period: "2026-02", value: "200.000000" })];
  const baseline = buildBaseline(rows);
  const current: SubmittedCell[] = rows;
  expect(detectDeltas(baseline, current)).toEqual([]);
});

test("one changed value yields one delta", () => {
  const baseline = buildBaseline([fact({ value: "100.000000" })]);
  const current = [cell({ value: "150.000000" })];
  const deltas = detectDeltas(baseline, current);
  expect(deltas).toHaveLength(1);
  expect(deltas[0].value).toBe("150.000000");
});

test("multiple changed values yield multiple deltas", () => {
  const baseline = buildBaseline([
    fact({ period: "2026-01", value: "1.000000" }),
    fact({ period: "2026-02", value: "2.000000" }),
    fact({ period: "2026-03", value: "3.000000" }),
  ]);
  const current = [
    cell({ period: "2026-01", value: "1.000000" }), // unchanged
    cell({ period: "2026-02", value: "20.000000" }), // changed
    cell({ period: "2026-03", value: "30.000000" }), // changed
  ];
  expect(detectDeltas(baseline, current)).toHaveLength(2);
});

test("blank value is treated as no change (not a deletion)", () => {
  const baseline = buildBaseline([fact({ value: "100.000000" })]);
  const current = [cell({ value: "" })];
  expect(detectDeltas(baseline, current)).toEqual([]);
});

test("intersection not in baseline is ignored (new rows out of scope v1)", () => {
  const baseline = buildBaseline([fact({ period: "2026-01" })]);
  const current = [cell({ period: "2026-99", value: "999.999999" })];
  expect(detectDeltas(baseline, current)).toEqual([]);
});

test("trimmed comparison ignores stray whitespace", () => {
  const baseline = buildBaseline([fact({ value: "100.000000" })]);
  const current = [cell({ value: "  100.000000  " })];
  expect(detectDeltas(baseline, current)).toEqual([]);
});

test("trailing-whitespace difference still counts as no change", () => {
  const baseline = buildBaseline([fact({ value: "100.000000" })]);
  const current = [cell({ value: "100.000001" })];
  expect(detectDeltas(baseline, current)).toHaveLength(1);
});

test("keyOf matches across FactRow and SubmittedCell shapes", () => {
  const f = fact();
  const c: SubmittedCell = { ...f };
  expect(keyOf(f)).toBe(keyOf(c));
});

test("buildBaseline indexes by intersection key", () => {
  const rows = [
    fact({ period: "2026-01", value: "1.000000" }),
    fact({ period: "2026-02", value: "2.000000" }),
  ];
  const baseline = buildBaseline(rows);
  expect(baseline[keyOf(rows[0])]).toBe("1.000000");
  expect(baseline[keyOf(rows[1])]).toBe("2.000000");
  expect(Object.keys(baseline)).toHaveLength(2);
});

test("baseline pulled for one scenario doesn't false-match cells from another", () => {
  // Slice 7 contract: keyOf includes scenario+version, so switching the
  // active scenario in the picker means the diff treats a Forecast-keyed
  // baseline as completely separate from current-sheet Actual values.
  const baseline = buildBaseline([
    fact({ scenario: "Forecast", value: "100.000000" }),
  ]);
  const current = [cell({ scenario: "Actual", value: "999.000000" })];
  // Actual cell isn't in baseline → ignored (not a delta).
  expect(detectDeltas(baseline, current)).toEqual([]);
});
