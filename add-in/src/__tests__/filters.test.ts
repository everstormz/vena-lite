import {
  defaultFilterState,
  parseFilterState,
  loadFilterState,
  storeFilterState,
  dropUnknownMembers,
  type FilterState,
} from "../excel/filters";
import type { DimMemberInfo } from "../types/generated";
import type { DimName } from "../types/dims";

type Captured = { stored: unknown[]; saved: number };

function setupOfficeMock(): Captured {
  const captured: Captured = { stored: [], saved: 0 };
  let value: unknown = undefined;

  const settings = {
    set(_key: string, v: unknown) {
      value = v;
      captured.stored.push(v);
    },
    get(_key: string) {
      return value;
    },
    saveAsync(cb: (r: { status: number; error?: { message: string } }) => void) {
      captured.saved += 1;
      cb({ status: 0 });
    },
  };

  (globalThis as unknown as { Office: unknown }).Office = {
    AsyncResultStatus: { Succeeded: 0 },
    context: { document: { settings } },
  };
  return captured;
}

afterEach(() => {
  delete (globalThis as unknown as { Office?: unknown }).Office;
});

test("defaultFilterState: all dims empty, account/period axes", () => {
  const s = defaultFilterState();
  expect(s.rowAxis).toBe("account");
  expect(s.colAxis).toBe("period");
  expect(s.filters.account).toEqual([]);
  expect(s.filters.version).toEqual([]);
});

test("parseFilterState falls back to defaults on null/garbage input", () => {
  expect(parseFilterState(null)).toEqual(defaultFilterState());
  expect(parseFilterState(undefined)).toEqual(defaultFilterState());
  expect(parseFilterState("garbage")).toEqual(defaultFilterState());
  expect(parseFilterState(42)).toEqual(defaultFilterState());
});

test("parseFilterState round-trips a fully-valid state", () => {
  const valid: FilterState = {
    filters: {
      account: ["4000_Revenue"],
      entity: ["E001_US", "E002_UK"],
      costcenter: [],
      period: ["2026-Q1"],
      scenario: ["Actual"],
      version: ["v1"],
    },
    rowAxis: "account",
    colAxis: "period",
  };
  expect(parseFilterState(valid)).toEqual(valid);
});

test("parseFilterState preserves explicit null axes", () => {
  const s = parseFilterState({ rowAxis: null, colAxis: null, filters: {} });
  expect(s.rowAxis).toBeNull();
  expect(s.colAxis).toBeNull();
});

test("parseFilterState defaults invalid axis names", () => {
  const s = parseFilterState({ rowAxis: "foo", colAxis: "bar", filters: {} });
  expect(s.rowAxis).toBe("account");
  expect(s.colAxis).toBe("period");
});

test("parseFilterState drops non-string entries from filter arrays", () => {
  const s = parseFilterState({
    filters: { account: ["valid_id", 42, null, "also_valid"] },
  });
  expect(s.filters.account).toEqual(["valid_id", "also_valid"]);
});

test("storeFilterState + loadFilterState round-trips via Office Settings", async () => {
  const captured = setupOfficeMock();
  const s: FilterState = {
    filters: {
      account: ["X"],
      entity: [],
      costcenter: [],
      period: [],
      scenario: [],
      version: [],
    },
    rowAxis: "account",
    colAxis: "period",
  };
  await storeFilterState(s);
  expect(captured.saved).toBe(1);
  expect(loadFilterState()).toEqual(s);
});

test("dropUnknownMembers strips ids no longer in the dim model", () => {
  const s: FilterState = {
    filters: {
      account: ["4000_Revenue", "GHOST_ACCOUNT"],
      entity: ["E001_US"],
      costcenter: [],
      period: [],
      scenario: [],
      version: [],
    },
    rowAxis: "account",
    colAxis: "period",
  };
  const dimensions: Partial<Record<DimName, DimMemberInfo[]>> = {
    account: [
      { id: "4000_Revenue", is_leaf: true },
      { id: "5000_OpEx", is_leaf: true },
    ],
    entity: [{ id: "E001_US", is_leaf: true }],
  };
  const { state, droppedCount } = dropUnknownMembers(s, dimensions);
  expect(state.filters.account).toEqual(["4000_Revenue"]);
  expect(state.filters.entity).toEqual(["E001_US"]);
  expect(droppedCount).toBe(1);
});
