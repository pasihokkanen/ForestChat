-- Phase 7b follow-up: Rename stem_count → stem_count_per_ha
-- Migration 014
--
-- The stem_count columns in compartments and compartment_species already
-- store per-hectare values (CSV import provides runkoluku/ha). The old
-- name caused confusion in the schedule engine which incorrectly divided
-- per-ha values by area. Renaming makes the unit explicit.

-- ====================
-- compartment_species
-- ====================
ALTER TABLE compartment_species RENAME COLUMN stem_count TO stem_count_per_ha;

-- ====================
-- compartments
-- ====================
ALTER TABLE compartments RENAME COLUMN stem_count TO stem_count_per_ha;

-- ====================
-- Column comments
-- ====================
COMMENT ON COLUMN compartment_species.stem_count_per_ha IS 'Stem count per hectare (runkoluku/ha) for this species';
COMMENT ON COLUMN compartments.stem_count_per_ha IS 'Total stem count per hectare (runkoluku/ha) for the compartment';
