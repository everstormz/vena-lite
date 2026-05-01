-- Vena-lite cube schema (Slice 1). Append-only; never UPDATE or DELETE.

CREATE TABLE IF NOT EXISTS facts (
  account_id      VARCHAR        NOT NULL,
  entity_id       VARCHAR        NOT NULL,
  costcenter_id   VARCHAR        NOT NULL,
  period_id       VARCHAR        NOT NULL,
  scenario_id     VARCHAR        NOT NULL,
  version_id      VARCHAR        NOT NULL,
  value           DECIMAL(20, 6) NOT NULL,
  loaded_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source          VARCHAR        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facts_svp
  ON facts (scenario_id, version_id, period_id);

CREATE INDEX IF NOT EXISTS idx_facts_ae
  ON facts (account_id, entity_id);

-- Current value of every cell = the row with the latest loaded_at.
-- All slice reads hit this view, never the raw `facts` table.
CREATE OR REPLACE VIEW facts_current AS
SELECT account_id, entity_id, costcenter_id, period_id, scenario_id,
       version_id, value, loaded_at, source
FROM (
  SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY account_id, entity_id, costcenter_id,
                        period_id, scenario_id, version_id
           ORDER BY loaded_at DESC
         ) AS _rn
  FROM facts
) WHERE _rn = 1;
