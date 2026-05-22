import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPropertyBoundary } from "./mml-client";
import { env } from "@/lib/env";

/**
 * Fetch property boundary from MML and store it in the database.
 * Returns the stored boundary geometry as GeoJSON MultiPolygon in EPSG:3067.
 */
export async function importPropertyBoundary(
  forestId: string,
  propertyId: string
): Promise<GeoJSON.MultiPolygon> {
  const boundary = await fetchPropertyBoundary(propertyId, env.mmlApiKey);

  if (!boundary) {
    throw new Error(
      `Property ${propertyId} not found in MML. Check the property ID.`
    );
  }

  const supabase = createAdminClient();

  const { error } = await supabase.from("property_boundaries").upsert({
    forest_id: forestId,
    property_id: propertyId,
    geometry: boundary.geometry,
    fetched_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to store property boundary: ${error.message}`);
  }

  return boundary.geometry;
}
