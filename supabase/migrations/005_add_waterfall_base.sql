-- 005_add_waterfall_base_to_chart_tabs.sql
-- Adds waterfall_base column for waterfall chart starting values.
-- This column was referenced in code but missing from the schema,
-- causing all chart upserts to fail with HTTP 400.

ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS waterfall_base NUMERIC;
