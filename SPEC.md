# Vena-lite — Domain SPEC

This file is the domain contract. Every PR is reviewed against the definitions
here. Update it BEFORE the code change, not after.

Status legend: **[v1]** = implemented or actively being implemented;
**[stub]** = section reserved, content fills in for the relevant slice.

---

## 1. Glossary [v1]

- **Dimension** — A coordinate axis the cube is sliced on. v1 has six:
  Account, Entity, CostCenter, Period, Scenario, Version.
- **Member** — A specific point on a dimension (e.g. `4000_Revenue`,
  `2026-03`).
- **Leaf member** — A member with no children. v1 stores values only at leaf
  members; parents are computed.
- **Parent member** — A member with at least one child. Holds aggregated
  (computed) values, never stored values.
- **Intersection** — A unique tuple of one member per dimension. Identifies a
  single fact.
- **Fact** — A numeric value at an intersection.
- **Slice** — A read of facts matching a filter across dimensions.
- **Submit** — A write of changed facts (Slice 3+).
- **Scenario** — A top-level branching axis (e.g. `Actual`, `Forecast`,
  `Budget`).
- **Version** — A sub-branch of a scenario (e.g. `Forecast/v1`,
  `Forecast/v2`). Independent timelines.
- **Driver** — A formula that computes a fact from other facts (Slice 6).

## 2. Dimensions (v1) [v1]

| Dim | Member key format | Has parents in v1? | Stored at parents? |
|-----|-------------------|--------------------|--------------------|
| Account | `4000_Revenue` style | yes (`Total_PnL`) | no |
| Entity | `E001_US` style | yes (`Worldwide`) | no |
| CostCenter | `CC100_Sales` style | flat | no |
| Period | ISO month `YYYY-MM` | yes (`2026-Q{1..4}` → `2026-FY`) | no |
| Scenario | `Actual`, `Forecast`, `Budget` | flat | no |
| Version | `v1`, `v2` | flat | no |

The hardcoded leaf model in `seed.py` (`ACCOUNTS`, `ENTITIES`, …) is the
ground truth for cube data. The hierarchy in `hierarchy_seed.py` adds parents
on top and is loaded into SQLite's `dim_member` table by the seed CLI.
Slice 4's `metadata/dim_model.py` is the in-memory query surface.

## 3. Hierarchies [v1]

Parent-child relations live in SQLite (`dim_member` table). One member can
have at most one parent (strict tree). Members with no parent are roots.

- **Rollup is read-time only.** The `facts` table never contains rows for
  parent members. Parent values are computed by the slice endpoint.
- **Rollup operator (v1):** **SUM only.** `dim_member.rollup_op` accepts other
  values (`weighted_avg`, `first`, `last`) for forward-compat but they are
  ignored — using anything other than `sum` raises no error in v1; results
  are always summed.
- **Submit at non-leaf members is rejected** (400 INTERSECTION_INVALID with
  `reason: "non_leaf"`). Parents are computed; you can only write at leaves.

## 4. Fact model [v1]

A fact = (Account, Entity, CostCenter, Period, Scenario, Version, value).

- **Type:** `DECIMAL(20, 6)` in DuckDB → `Decimal` in Pydantic → JSON string
  on the wire → `decimal.js` in TypeScript (Slice 2).
- **NULL:** `NULL` = "no fact exists at this intersection"; ≠ zero. v1 simply
  has no row for empty intersections.
- **Negatives:** allowed for any account in v1. (Slice 4 may add per-account
  sign constraints.)

## 5. Append-only semantics & two kinds of versioning [v1]

There are two orthogonal versioning concepts:

- **Time-versioning (implicit).** Every write appends a row to `facts` with a
  `loaded_at` timestamp. The "current value" of any cell = the row with the
  latest `loaded_at`. The `facts_current` view exposes this; all reads use
  the view, never raw `facts`. Edit history is queryable; no cell is ever
  overwritten in place.
- **Scenario/Version dims (explicit).** `Forecast/v1` and `Forecast/v2` are
  independent timelines. Slice 5 introduces "copy" semantics.

These do not interact: `Forecast/v1` has its own time-versioned history;
`Forecast/v2` has its own.

## 6. Slice contract [v1]

**Request** (`POST /slice`):

```json
{ "filters": { "<dim>": { "members": ["<id>", ...] } } }
```

- Missing dim → no filter on that dim.
- `members: null` → no filter on that dim (same as missing).
- `members: []` → matches nothing (returns empty result).
- Unknown dim name → 422 (Pydantic validation).
- Unknown member id → **400 MEMBER_UNKNOWN** with the offending `(dim, member)`
  list (Slice 4 behavior change; was silent empty result in Slice 1).
- Members may be leaves OR parents. Parent members are expanded to their leaf
  descendants and the response is aggregated (SUM) back to the requested
  level. Mixed leaf+parent members in the same dim are allowed.

**Response:**

```json
{ "rows": [ { "account": "...", ..., "value": "1234.123456" } ], "total": 96 }
```

- Always long-format. No implicit aggregation in v1.
- `value` is always a JSON string (never a number).
- `total === rows.length` in v1 (no pagination).
- Cap: 100k rows. Slice 4 may add `SLICE_TOO_LARGE` error.

## 7. Submit contract [v1]

**Request** (`POST /submit`):

```json
{
  "request_id": "<client-generated UUID>",
  "cells": [
    { "account": "...", "entity": "...", "costcenter": "...",
      "period": "...", "scenario": "...", "version": "...",
      "value": "1234.567890" }
  ]
}
```

- `request_id`: any string 1..128 chars; client-generated. v1 does **not**
  enforce idempotency by `request_id` (re-submitting the same body twice
  produces two audit batches and two cube appends — known limitation).
- `cells`: must contain at least one cell. Each cell needs all six dim
  members and a Decimal-as-string value.

**Validation order:**
1. Pydantic shape validation → 422 on malformed payload.
2. Every cell's six dim members must be **known leaves** in the dim model.
   Any unknown member or any non-leaf member → **400 INTERSECTION_INVALID**
   with the per-cell offending `(dim, member, reason)` list. `reason` is
   `"unknown"` or `"non_leaf"`. **All-or-nothing**: zero cube/audit writes
   if any cell fails validation.
3. Cube write + audit write inside coordinated transactions (see §8).

**Response:** `{ "request_id": "...", "accepted_count": N }` where N == cells.length.

## 8. Audit log [v1]

Per-cell row in SQLite (`audit_log` table), one row per `cells[i]` of every
submit batch. Schema:

| column | type | notes |
|--------|------|-------|
| id | INTEGER PK | autoincrement |
| submit_request_id | TEXT | links rows from same batch |
| submitted_at | TIMESTAMP | server-set, UTC |
| who | TEXT | hardcoded `local` in v1 |
| account_id … version_id | TEXT | full intersection |
| before_value | TEXT | nullable; null when no prior fact existed |
| after_value | TEXT | non-null; submitted value |
| source | TEXT | hardcoded `submit` |

Decimals are stored as **TEXT** (SQLite REAL is lossy IEEE-754).

**Atomicity model.** Cube write + audit write are in nested transactions.
Audit commits FIRST (inner), cube commits SECOND (outer). Failure modes:
- Validation fails → no writes anywhere (validated before any storage call).
- Cube write fails → both transactions roll back; no audit row, no cube row.
- Audit append fails → cube transaction rolls back; no cube row, no audit row.
- Audit COMMIT fails (rare; disk full mid-COMMIT) → cube hasn't committed → both rolled back.
- Cube COMMIT fails after audit committed (rare) → "ghost audit row" pointing
  to a cube change that didn't land. Detectable; preferred over a silent cube
  change with no audit trail.

Retention: forever in v1.

## 9. Scenario semantics [v1]

A "scenario" and a "version" are two of the six dims. Together they form an
independent timeline: `(scenario, version)` is the branch identity.

**Copy** (`POST /scenarios/copy`):
- Reads the latest value of every fact at `source.(scenario, version)` (via
  `facts_current` — does **not** copy edit history).
- Appends those facts at `target.(scenario, version)` with a fresh `loaded_at`
  and `source = "copy:<request_id>:from=<src_scenario>/<src_version>"`.
- Auto-registers `target.scenario` and `target.version` in `dim_member` (flat,
  no parent) if they don't already exist.
- Audit log: one row per copied fact, `before_value` is NULL when target was
  empty, populated when re-copying over an existing target. `source = "copy"`.

**Re-copy** is allowed: append-only semantics mean the latest copy wins via
`facts_current`. There is no "lock" preventing the user from re-copying over
edited target data — they will lose those edits (the audit trail preserves
the old before-values). Future slices may add a `--force` requirement when
target has been edited since last copy.

**Subsequent submit** to the new target works once the dim_model picks up the
new members, which happens automatically because `get_dim_model` reloads on
every request (cheap at v1 scale).

**Out of scope v1:** partial copies (only Q1, only one entity), copy with
transformation (e.g. multiply by 1.10), copy across cubes.

## 10. Driver calc semantics [v1]

A **driver** is a formula that computes the value of one Account dim member
at every leaf intersection. One driver per output account.

**Storage:** SQLite `driver(account_id PK, formula, defined_at)`.

**Formula language:** `+ - * /`, unary `+ -`, parens, decimal literals, and
identifiers (account ids — including digit-prefixed forms like
`4000_Revenue`). No `eval`. No functions. No string literals. Division by
zero raises and rolls back the surrounding write.

**Definition (`POST /drivers/define`):**
1. Output account must be a known leaf.
2. Formula must parse.
3. Every referenced identifier must be a known leaf account.
4. Adding the driver must not create a cycle (transitive check against the
   existing driver graph).
5. On success: persist + materialize. The driver is computed for every
   `(entity, costcenter, period, scenario, version)` tuple currently in the
   cube. New rows land in `facts` with `source = "driver:initial:<request_id>"`
   and audit rows with `who = "driver"`.

**Recalculation:** Triggered automatically inside the same transaction as
`/submit`. After the user's writes commit (within the open transaction), any
driver whose formula transitively references a submitted account is
recomputed at the same `(entity, costcenter, period, scenario, version)`
tuples. Drivers are evaluated in topological order so a chain
(`X = A + B; A = C` then submit to `C`) computes `A` before `X`.

**Submit at a driver-controlled account is rejected** with `400
INTERSECTION_INVALID` and `reason: "driver"`. The formula is the source of
truth for that account.

**Missing input:** if a referenced account has no fact at the target
intersection, the value defaults to `Decimal(0)`. (Future slice may make
this configurable per driver.)

**Out of scope v1:** functions (`SUM`, `IF`, etc.), cross-intersection
references (formulas that reach into other entities/periods), driver
deletion, driver listing endpoint, driver definitions in the add-in UI.

## 11. Error model [v1]

Error envelope (FastAPI's `HTTPException.detail`):
`{ "code": "<CODE>", ... }` where the rest is code-specific.

v1 codes:
- `MEMBER_UNKNOWN` (slice, 400) — `unknown: [{dim, member}, ...]`.
- `INTERSECTION_INVALID` (submit, 400) — `errors: [{cell_index, invalid_members: [{dim, member, reason}, ...]}, ...]` where `reason` is `"unknown"` or `"non_leaf"`.
- (future slices: `SLICE_TOO_LARGE`, `CYCLE_DETECTED`, `WRITE_CONFLICT`)

## 12. Out of scope for v1

No auth. No multi-user. No remote deployment. No real-time recalc. No
formula language beyond `+ - * /` and parens. No cell-level comments. No
workflow/approval. No FX translation.
