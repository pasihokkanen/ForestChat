-- 007_add_compartment_species.sql
-- ForestChat: Species breakdown table for multi-species charts
-- Extracts per-species data from compartments.attributes.species
-- Falls back to main_species if no breakdown exists

CREATE TABLE IF NOT EXISTS compartment_species (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id       UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  compartment_id  UUID NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
  stand_id        TEXT NOT NULL,
  puulaji         TEXT NOT NULL,       -- Tree species: Mänty, Kuusi, Koivu, Lehtipuu, etc.
  volume_m3       NUMERIC NOT NULL,    -- Volume of this species in the compartment
  tukkiprosentti  NUMERIC,             -- Log percentage for this species (0-100)
  area_ha         NUMERIC NOT NULL,    -- Area contribution (proportional to volume share)
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comp_species_forest ON compartment_species(forest_id);
CREATE INDEX IF NOT EXISTS idx_comp_species_compartment ON compartment_species(compartment_id);
CREATE INDEX IF NOT EXISTS idx_comp_species_puulaji ON compartment_species(forest_id, puulaji);

ALTER TABLE compartment_species ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner full access on compartment_species" ON compartment_species;
CREATE POLICY "Owner full access on compartment_species" ON compartment_species
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Shared read on compartment_species" ON compartment_species;
CREATE POLICY "Shared read on compartment_species" ON compartment_species
  FOR SELECT USING (forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid()));
