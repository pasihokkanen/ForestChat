-- Phase 7b: Generic plan generation schema changes
-- Migration 012

-- ====================
-- Stand wishes (owner-defined constraints)
-- Uses stand_id TEXT (not compartment_id UUID) so wishes survive forest reimport
-- ====================
CREATE TABLE IF NOT EXISTS stand_wishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  stand_id TEXT NOT NULL,  -- denormalized stand ID (e.g. "1", "7", "184")
                            -- NOT compartment_id UUID — compartments get new UUIDs
                            -- on reimport, but stand_id is stable
  wish_type TEXT NOT NULL,  -- 'delay_harvest', 'accelerate_harvest', 'no_clearcut',
                            -- 'species_preference', 'retention_pct', 'custom'
  wish_value TEXT,          -- JSON or string value (e.g., '{"species": "pine"}', '5', '2035')
  notes TEXT,
  created_by TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stand_wishes_forest ON stand_wishes(forest_id);
CREATE INDEX IF NOT EXISTS idx_stand_wishes_stand ON stand_wishes(forest_id, stand_id);

ALTER TABLE stand_wishes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access via forest" ON stand_wishes;
CREATE POLICY "Owner access via forest" ON stand_wishes
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
DROP POLICY IF EXISTS "Shared read access" ON stand_wishes;
CREATE POLICY "Shared read access" ON stand_wishes
  FOR SELECT USING (forest_id IN (SELECT get_shared_forest_ids_for_user(auth.uid())));

-- ====================
-- plan_metadata: add goal column
-- ====================
ALTER TABLE plan_metadata ADD COLUMN IF NOT EXISTS goal TEXT;

-- ====================
-- forests: add price_region and growth_multiplier
-- ====================
ALTER TABLE forests ADD COLUMN IF NOT EXISTS price_region TEXT;
ALTER TABLE forests ADD COLUMN IF NOT EXISTS growth_multiplier FLOAT DEFAULT 1.0;

-- ====================
-- timber_prices: add region, valid_from, valid_to
-- ====================
ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS valid_from DATE;
ALTER TABLE timber_prices ADD COLUMN IF NOT EXISTS valid_to DATE;

-- Add index for efficient region-based cache lookup
CREATE INDEX IF NOT EXISTS idx_timber_prices_region_fetched ON timber_prices(region, fetched_at DESC);
