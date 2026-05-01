-- Vena-lite metadata (SQLite). Slice 3+: audit log; Slice 4+: dim hierarchies.
-- Slice 6 will add a `driver` table here.

CREATE TABLE IF NOT EXISTS audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  submit_request_id   TEXT      NOT NULL,
  submitted_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  who                 TEXT      NOT NULL DEFAULT 'local',
  account_id          TEXT      NOT NULL,
  entity_id           TEXT      NOT NULL,
  costcenter_id       TEXT      NOT NULL,
  period_id           TEXT      NOT NULL,
  scenario_id         TEXT      NOT NULL,
  version_id          TEXT      NOT NULL,
  before_value        TEXT,                  -- nullable: NULL when the cell did not exist before
  after_value         TEXT      NOT NULL,
  source              TEXT      NOT NULL DEFAULT 'submit'
);

-- Decimal-as-TEXT preserves DECIMAL(20,6) precision exactly. SQLite REAL would
-- silently coerce to IEEE-754 double and round trailing fractional digits.

CREATE INDEX IF NOT EXISTS idx_audit_request
  ON audit_log (submit_request_id);

CREATE INDEX IF NOT EXISTS idx_audit_intersection
  ON audit_log (account_id, entity_id, costcenter_id, period_id, scenario_id, version_id);


-- Dimension members + parent-child hierarchy (Slice 4).
-- One row per member. `parent_member_id` is NULL for roots and for members of
-- flat dimensions. `rollup_op` is per-member but v1 only honors 'sum'.
CREATE TABLE IF NOT EXISTS dim_member (
  dim_name          TEXT NOT NULL,
  member_id         TEXT NOT NULL,
  parent_member_id  TEXT,
  rollup_op         TEXT NOT NULL DEFAULT 'sum',
  ordinal           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dim_name, member_id)
);

CREATE INDEX IF NOT EXISTS idx_dim_member_parent
  ON dim_member (dim_name, parent_member_id);


-- Driver definitions (Slice 6). One driver per output account_id; defining a
-- driver makes that account read-only via /submit. Formula language is
-- restricted to + - * /, parens, identifiers, decimal literals — no eval.
CREATE TABLE IF NOT EXISTS driver (
  account_id   TEXT PRIMARY KEY,
  formula      TEXT NOT NULL,
  defined_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
