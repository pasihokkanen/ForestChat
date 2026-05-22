import { createAdminClient } from "@/lib/supabase/admin";
import type { WfsStand } from "./wfs-client";

/**
 * Intersect fetched WFS stands with the property boundary stored in PostGIS.
 *
 * Strategy: batch-insert all stands into compartments, then use Supabase RPC
 * `compartments_within_boundary` for spatial filtering. Falls back to returning
 * all stands if the RPC function hasn't been deployed yet.
 */
export async function filterStandsWithinProperty(
  boundaryGeometry: GeoJSON.MultiPolygon,
  stands: WfsStand[],
  forestId: string
): Promise<WfsStand[]> {
  const supabase = createAdminClient();

  // Batch-insert all stands into compartments table
  const compartmentRows = stands.map((stand) => ({
    forest_id: forestId,
    stand_id: stand.standId,
    area_ha: stand.areaHa,
    main_species: stand.mainSpecies,
    development_class: stand.developmentClass,
    site_type: stand.siteType,
    soil_type: stand.soilType,
    drainage_status: stand.drainageStatus,
    age_years: stand.ageYears,
    volume_m3: stand.volumeM3,
    basal_area: stand.basalArea,
    avg_diameter: stand.avgDiameter,
    avg_height: stand.avgHeight,
    growth_m3_per_ha: stand.growthM3PerHa,
    geometry: stand.geometry,
    attributes: stand.attributes,
  }));

  // Deduplicate by (forest_id, stand_id) — WFS may return split polygons
  // with the same stand_id. Keep the last occurrence (largest piece).
  const seen = new Set<string>();
  const deduped = compartmentRows.reverse().filter((row) => {
    const key = `${row.forest_id}:${row.stand_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();

  const { error } = await supabase.from("compartments").upsert(
    deduped,
    { onConflict: "forest_id, stand_id" }
  );

  if (error) {
    throw new Error(`Failed to insert compartments: ${error.message}`);
  }

  // Use RPC function for spatial filtering
  const { data: filtered, error: rpcError } = await supabase.rpc(
    "compartments_within_boundary",
    {
      p_forest_id: forestId,
      p_boundary_geojson: boundaryGeometry,
    }
  );

  if (rpcError) {
    console.warn(
      "Spatial RPC not available — returning all stands unfiltered:",
      rpcError.message
    );
    return stands;
  }

  const withinStandIds = new Set(
    (filtered as { stand_id: string }[])?.map((c) => c.stand_id) ?? []
  );

  // Remove stands outside the boundary
  const outsideStandIds = stands
    .filter((s) => !withinStandIds.has(s.standId))
    .map((s) => s.standId);

  if (outsideStandIds.length > 0) {
    await supabase
      .from("compartments")
      .delete()
      .eq("forest_id", forestId)
      .in("stand_id", outsideStandIds);
  }

  return stands.filter((s) => withinStandIds.has(s.standId));
}
