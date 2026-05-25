-- 004_add_chart_tabs.sql
-- ForestChat Phase 4: Interactive Visualization Dashboard
-- Adds chart_tabs table for persisting AI-generated charts across devices/sessions

CREATE TABLE IF NOT EXISTS chart_tabs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id       UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  chart_id        TEXT NOT NULL,               -- AI-generated chart ID, e.g. "chart-yearly-income"
  title           TEXT NOT NULL,
  type            TEXT NOT NULL,               -- bar, pie, line, area, stacked_bar, scatter, radar, donut, horizontal_bar, composed, waterfall
  data            JSONB NOT NULL,              -- array of data objects
  x_key           TEXT,
  y_key           TEXT NOT NULL,
  y_key2          TEXT,                        -- secondary Y axis (composed charts)
  name_key        TEXT,                        -- pie/donut slice labels
  color_key       TEXT,                        -- color grouping key
  stand_dimension TEXT,                        -- stand_id mapping key for cross-panel interaction
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(forest_id, chart_id)
);

CREATE INDEX idx_chart_tabs_forest ON chart_tabs(forest_id);

ALTER TABLE chart_tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access on chart_tabs" ON chart_tabs
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

CREATE POLICY "Shared read on chart_tabs" ON chart_tabs
  FOR SELECT USING (forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid()));
