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

type Captured = { stored: { key: string; value: unknown }[]; saved: number };

function setupOfficeMock(initial: Record<string, unknown> = {}): Captured {
  const captured: Captured = { stored: [], saved: 0 };
  const store: Record<string, unknown> = { ...initial };

  const settings = {
    set(key: string, v: unknown) {
      store[key] = v;
      captured.stored.push({ key, value: v });
    },
    get(key: string) {
      return store[key];
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

test("defaultFilterState: all dims empty, account on rows / period on cols", () => {
  const s = defaultFilterState();
  expect(s.axes).toEqual({ rows: ["account"], cols: ["period"] });
  expect(s.filters.account).toEqual([]);
  expect(s.filters.version).toEqual([]);
});

test("parseFilterState falls back to defaults on null/garbage input", () => {
  expect(parseFilterState(null)).toEqual(defaultFilterState());
  expect(parseFilterState(undefined)).toEqual(defaultFilterState());
  expect(parseFilterState("garbage")).toEqual(defaultFilterState());
  expect(parseFilterState(42)).toEqual(defaultFilterState());
});

test("parseFilterState round-trips a fully-valid v2 state", () => {
  const valid: FilterState = {
    filters: {
      account: ["4000_Revenue"],
      entity: ["E001_US", "E002_UK"],
      costcenter: [],
      period: ["2026-Q1"],
      scenario: ["Actual"],
      version: ["v1"],
    },
    axes: { rows: ["account", "costcenter"], cols: ["period", "scenario"] },
  };
  expect(parseFilterState(valid)).toEqual(valid);
});

test("parseFilterState dedupes axes and prevents same dim on both axes", () => {
  const s = parseFilterState({
    filters: {},
    axes: { rows: ["account", "account"], cols: ["account", "period"] },
  });
  // First-wins: account stays on rows, removed from cols.
  expect(s.axes).toEqual({ rows: ["account"], cols: ["period"] });
});

test("parseFilterState drops invalid axis names silently", () => {
  const s = parseFilterState({
    filters: {},
    axes: { rows: ["account", "foo"], cols: ["bar", "period"] },
  });
  expect(s.axes).toEqual({ rows: ["account"], cols: ["period"] });
});

test("parseFilterState drops non-string entries from filter arrays", () => {
  const s = parseFilterState({
    axes: { rows: [], cols: [] },
    filters: { account: ["valid_id", 42, null, "also_valid"] },
  });
  expect(s.filters.account).toEqual(["valid_id", "also_valid"]);
});

// === Slice 10: v1 → v2 migration ===

test("v1 migration: string rowAxis + string colAxis becomes single-element arrays", () => {
  const v1 = {
    filters: { account: ["X"], entity: [] },
    rowAxis: "account",
    colAxis: "period",
  };
  const s = parseFilterState(v1);
  expect(s.axes).toEqual({ rows: ["account"], cols: ["period"] });
  expect(s.filters.account).toEqual(["X"]);
});

test("v1 migration: null axes become empty arrays (long-format)", () => {
  const v1 = {
    filters: { account: [] },
    rowAxis: null,
    colAxis: null,
  };
  const s = parseFilterState(v1);
  expect(s.axes).toEqual({ rows: [], cols: [] });
});

test("v1 migration: null + string yields one-axis state", () => {
  const v1 = {
    filters: {},
    rowAxis: null,
    colAxis: "period",
  };
  const s = parseFilterState(v1);
  expect(s.axes).toEqual({ rows: [], cols: ["period"] });
});

test("v1 migration: invalid axis strings → empty arrays (no defaults bleed-through)", () => {
  const s = parseFilterState({
    filters: {},
    rowAxis: "garbage",
    colAxis: "more-garbage",
  });
  expect(s.axes).toEqual({ rows: [], cols: [] });
});

test("storeFilterState writes v2 shape to the v2 key", async () => {
  const captured = setupOfficeMock();
  const s: FilterState = {
    filters: {
      account: ["X"], entity: [], costcenter: [], period: [], scenario: [], version: [],
    },
    axes: { rows: ["account"], cols: ["period"] },
  };
  await storeFilterState(s);
  expect(captured.saved).toBe(1);
  const last = captured.stored[captured.stored.length - 1];
  expect(last.key).toBe("vena_lite.filters.v2");
  expect((last.value as { version: number }).version).toBe(2);
});

test("loadFilterState round-trips through Office Settings v2 key", async () => {
  setupOfficeMock();
  const s: FilterState = {
    filters: {
      account: ["X"], entity: [], costcenter: [], period: [], scenario: [], version: [],
    },
    axes: { rows: ["account", "costcenter"], cols: ["period"] },
  };
  await storeFilterState(s);
  expect(loadFilterState()).toEqual(s);
});

test("loadFilterState falls back to v1 key when v2 key is empty", () => {
  setupOfficeMock({
    "vena_lite.filters.v1": {
      filters: { account: ["legacy"] },
      rowAxis: "account",
      colAxis: null,
    },
  });
  const s = loadFilterState();
  expect(s.axes).toEqual({ rows: ["account"], cols: [] });
  expect(s.filters.account).toEqual(["legacy"]);
});

test("dropUnknownMembers strips ids no longer in the dim model (preserves axes)", () => {
  const s: FilterState = {
    filters: {
      account: ["4000_Revenue", "GHOST_ACCOUNT"],
      entity: ["E001_US"],
      costcenter: [],
      period: [],
      scenario: [],
      version: [],
    },
    axes: { rows: ["account", "costcenter"], cols: ["period"] },
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
  expect(state.axes).toEqual(s.axes);
  expect(droppedCount).toBe(1);
});
