-- 006_add_chart_query_config.sql
-- ForestChat Phase 4b: Chart auto-update via declarative query configs

-- 1. Add query_config and computed_at columns; make data nullable
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS query_config JSONB;
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ;
ALTER TABLE chart_tabs ALTER COLUMN data DROP NOT NULL;

-- 2. (Optional) Add an index for fast lookup of charts needing recompute
CREATE INDEX IF NOT EXISTS idx_chart_tabs_query_config
  ON chart_tabs(forest_id) WHERE query_config IS NOT NULL;
