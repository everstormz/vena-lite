import {
  laneOf,
  moveDim,
  pageFilterDims,
  parseTuple,
  reorderInLane,
  tupleKey,
  type AxisSpec,
} from "../excel/axes";
import { DIM_NAMES } from "../types/dims";

describe("tupleKey + parseTuple", () => {
  test("empty tuple round-trips to empty array", () => {
    expect(tupleKey([])).toBe("");
    expect(parseTuple("")).toEqual([]);
  });

  test("single value round-trips", () => {
    expect(tupleKey(["account"])).toBe("account");
    expect(parseTuple("account")).toEqual(["account"]);
  });

  test("multiple values join with pipe and round-trip", () => {
    const t = ["4000_Revenue", "E001_US", "2026-01"];
    expect(tupleKey(t)).toBe("4000_Revenue|E001_US|2026-01");
    expect(parseTuple(tupleKey(t))).toEqual(t);
  });
});

describe("pageFilterDims", () => {
  test("empty axes — every dim is a page filter", () => {
    expect(pageFilterDims({ rows: [], cols: [] })).toEqual([...DIM_NAMES]);
  });

  test("axes consume their dims", () => {
    const spec: AxisSpec = { rows: ["account"], cols: ["period", "scenario"] };
    expect(pageFilterDims(spec)).toEqual(["entity", "costcenter", "version"]);
  });

  test("preserves DIM_NAMES order in the output", () => {
    const spec: AxisSpec = { rows: ["scenario"], cols: ["account"] };
    expect(pageFilterDims(spec)).toEqual([
      "entity",
      "costcenter",
      "period",
      "version",
    ]);
  });
});

describe("laneOf", () => {
  test("dim in rows", () => {
    expect(laneOf({ rows: ["account"], cols: [] }, "account")).toBe("rows");
  });
  test("dim in cols", () => {
    expect(laneOf({ rows: [], cols: ["period"] }, "period")).toBe("cols");
  });
  test("dim not on any axis is a page filter", () => {
    expect(laneOf({ rows: [], cols: [] }, "scenario")).toBe("page");
  });
});

describe("moveDim", () => {
  const base: AxisSpec = { rows: ["account"], cols: ["period"] };

  test("move from page lane to rows (appended)", () => {
    expect(moveDim(base, "costcenter", "rows")).toEqual({
      rows: ["account", "costcenter"],
      cols: ["period"],
    });
  });

  test("move from page lane to cols at position 0", () => {
    expect(moveDim(base, "scenario", "cols", 0)).toEqual({
      rows: ["account"],
      cols: ["scenario", "period"],
    });
  });

  test("move from rows to cols (removed from rows)", () => {
    expect(moveDim(base, "account", "cols")).toEqual({
      rows: [],
      cols: ["period", "account"],
    });
  });

  test("move to page (removed from any axis)", () => {
    expect(moveDim(base, "account", "page")).toEqual({
      rows: [],
      cols: ["period"],
    });
  });

  test("move within same lane reduces to a reorder via remove+insert", () => {
    const spec: AxisSpec = { rows: ["account", "entity", "costcenter"], cols: [] };
    expect(moveDim(spec, "entity", "rows", 0)).toEqual({
      rows: ["entity", "account", "costcenter"],
      cols: [],
    });
  });

  test("position out of range is clamped", () => {
    expect(moveDim(base, "scenario", "rows", 99)).toEqual({
      rows: ["account", "scenario"],
      cols: ["period"],
    });
    expect(moveDim(base, "scenario", "rows", -5)).toEqual({
      rows: ["scenario", "account"],
      cols: ["period"],
    });
  });
});

describe("reorderInLane", () => {
  test("moves dim to a new index within rows", () => {
    const spec: AxisSpec = { rows: ["account", "entity", "costcenter"], cols: [] };
    expect(reorderInLane(spec, "rows", "costcenter", 0)).toEqual({
      rows: ["costcenter", "account", "entity"],
      cols: [],
    });
  });

  test("identity when target index == current", () => {
    const spec: AxisSpec = { rows: ["account", "entity"], cols: [] };
    expect(reorderInLane(spec, "rows", "account", 0)).toEqual(spec);
  });

  test("no-op when dim isn't on the requested lane", () => {
    const spec: AxisSpec = { rows: ["account"], cols: [] };
    expect(reorderInLane(spec, "rows", "period", 0)).toBe(spec);
  });
});
