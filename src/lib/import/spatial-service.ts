import { createAdminClient } from "@/lib/supabase/admin";
import type { WfsStand } from "./wfs-client";
import booleanIntersects from "@turf/boolean-intersects";

/**
 * Intersect fetched WFS stands with the property boundary using turf.js.
 *
 * Strategy: filter stands client-side with booleanIntersects (turf.js),
 * then batch-insert only the matching stands. Falls back to inserting all
 * stands if the boundary is invalid.
 *
 * Avoids the Supabase RPC `compartments_within_boundary` which fails
 * with "mixed SRID geometries" when the compartments table has a different
 * SRID than the property boundary.
 */
export async function filterStandsWithinProperty(
  boundaryGeometry: GeoJSON.MultiPolygon,
  stands: WfsStand[],
  forestId: string
): Promise<WfsStand[]> {
  // 1. Filter stands by intersection with property boundary (turf.js)
  let filteredStands: WfsStand[];
  try {
    // Strip CRS from boundary — turf doesn't use it and PostGIS CRS
    // tags can confuse the geometry comparison
    const cleanBoundary = { ...boundaryGeometry };
    delete (cleanBoundary as Record<string, unknown>).crs;

    filteredStands = stands.filter((stand) => {
      try {
        return booleanIntersects(cleanBoundary, stand.geometry);
      } catch {
        // If a single geometry fails, keep it (conservative)
        return true;
      }
    });
  } catch (err) {
    console.warn(
      "Turf spatial filter failed — inserting all stands unfiltered:",
      err instanceof Error ? err.message : err
    );
    filteredStands = stands;
  }

  try {
    const supabase = createAdminClient();

    // 2. Build compartment rows (only filtered stands)
    const compartmentRows = filteredStands.map((stand) => ({
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

    // 3. Deduplicate by (forest_id, stand_id)
    const seen = new Set<string>();
    const deduped = compartmentRows.reverse().filter((row) => {
      const key = `${row.forest_id}:${row.stand_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).reverse();

    // 4. Insert into compartments table
    const { error } = await supabase.from("compartments").upsert(
      deduped,
      { onConflict: "forest_id, stand_id" }
    );

    if (error) {
      throw new Error(`Failed to insert compartments: ${error.message}`);
    }

    return filteredStands;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Failed to insert")) {
      throw err;
    }
    // If insert fails for other reasons, still return filtered list
    // (the caller can retry)
    console.error("Compartment insert error:", err);
    return filteredStands;
  }
}
