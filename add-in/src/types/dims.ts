// Source of truth for the v1 dim names. Hand-maintained because Pydantic's
// Literal collapses to `string` in JSON Schema (handoff doc gotcha #8), so
// the auto-generated TS would lose the union type. If you add a dim here,
// also update `vena_lite.schemas.dimensions.DimName` and re-seed the cube.

export const DIM_NAMES = [
  "account",
  "entity",
  "costcenter",
  "period",
  "scenario",
  "version",
] as const;

export type DimName = (typeof DIM_NAMES)[number];
