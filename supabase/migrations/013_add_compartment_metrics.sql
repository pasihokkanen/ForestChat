-- Phase 7b: Add compartment metrics for precise tending decisions
-- Migration 013
--
-- Adds stem_count, mean_height, mean_diameter, age, basal_area
-- to compartment_species, and stem_count to compartments.
-- These fields support Tapio-compliant tending decisions based on
-- stem count, mean height, and mean diameter thresholds instead of
-- crude age-based windows.

-- ====================
-- compartment_species: per-species metrics
-- ====================
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS stem_count NUMERIC;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS mean_height NUMERIC;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS mean_diameter NUMERIC;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS basal_area NUMERIC;

-- ====================
-- compartments: total stem count
-- ====================
ALTER TABLE compartments ADD COLUMN IF NOT EXISTS stem_count NUMERIC;

-- ====================
-- Column comments
-- ====================
COMMENT ON COLUMN compartment_species.stem_count IS 'Stem count (runkoluku) for this species in the compartment';
COMMENT ON COLUMN compartment_species.mean_height IS 'Mean height in meters (keskipituus)';
COMMENT ON COLUMN compartment_species.mean_diameter IS 'Mean diameter in cm (keskiläpimitta)';
COMMENT ON COLUMN compartment_species.age IS 'Age of this species group (ikä)';
COMMENT ON COLUMN compartment_species.basal_area IS 'Basal area m²/ha (pohjapinta-ala)';
COMMENT ON COLUMN compartments.stem_count IS 'Total stem count (runkoluku) for the compartment';
