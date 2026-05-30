-- 008_english_column_names.sql
-- Rename Finnish column names to English for consistency.
-- No data migration needed (development phase).

ALTER TABLE compartment_species RENAME COLUMN puulaji TO species;
ALTER TABLE compartment_species RENAME COLUMN tukkiprosentti TO log_pct;
ALTER INDEX IF EXISTS idx_comp_species_puulaji RENAME TO idx_comp_species_species;

COMMENT ON COLUMN compartment_species.species IS 'Tree species name in English snake_case: pine, spruce, aspen, birch, etc.';
COMMENT ON COLUMN compartment_species.log_pct IS 'Sawlog percentage for this species (0-100)';
COMMENT ON TABLE compartment_species IS 'Per-species data. English column names throughout.';
