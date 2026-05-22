-- supabase/migrations/002_spatial_functions.sql
-- Spatial helper functions for the import pipeline

-- Filter compartments within a property boundary
CREATE OR REPLACE FUNCTION compartments_within_boundary(
  p_forest_id UUID,
  p_boundary_geojson JSONB
)
RETURNS TABLE(stand_id TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT c.stand_id
  FROM compartments c
  WHERE c.forest_id = p_forest_id
    AND ST_Within(
      c.geometry,
      ST_GeomFromGeoJSON(p_boundary_geojson::text)
    );
$$;
