-- Migration 003: GeoJSON fetch support + cascading deletes
-- Adds RPC function to return compartments with GeoJSON geometry

-- Function: get_compartments_geojson
-- Returns compartments with geometry converted to GeoJSON,
-- suitable for direct consumption by MapLibre GL JS.
CREATE OR REPLACE FUNCTION get_compartments_geojson(p_forest_id UUID)
RETURNS TABLE(
  id UUID,
  forest_id UUID,
  stand_id TEXT,
  area_ha DOUBLE PRECISION,
  main_species TEXT,
  development_class TEXT,
  site_type TEXT,
  soil_type TEXT,
  drainage_status TEXT,
  age_years INTEGER,
  volume_m3 DOUBLE PRECISION,
  basal_area DOUBLE PRECISION,
  avg_diameter DOUBLE PRECISION,
  avg_height DOUBLE PRECISION,
  growth_m3_per_ha DOUBLE PRECISION,
  geometry JSONB,
  attributes JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.forest_id,
    c.stand_id,
    c.area_ha,
    c.main_species,
    c.development_class,
    c.site_type,
    c.soil_type,
    c.drainage_status,
    c.age_years,
    c.volume_m3,
    c.basal_area,
    c.avg_diameter,
    c.avg_height,
    c.growth_m3_per_ha,
    ST_AsGeoJSON(c.geometry)::jsonb AS geometry,
    c.attributes,
    c.created_at,
    c.updated_at
  FROM compartments c
  WHERE c.forest_id = p_forest_id;
$$;
