import { createAdminClient } from "@/lib/supabase/admin";
import type { WfsStand } from "./wfs-client";
import booleanIntersects from "@turf/boolean-intersects";
import buffer from "@turf/buffer";

const BUFFER_DEGREES = 0.0002; // ≈20 m at 62.6°N — small tolerance for edge precision

/**
 * Intersect fetched WFS stands with the property boundary using turf.js.
 *
 * Checks EACH parcel individually — Hokkala has 4 non-contiguous parcels
 * up to 5 km apart. If we buffered the whole MultiPolygon at once, turf
 * would merge them into a single blob covering non-property land.
 *
 * Falls back to inserting all stands if spatial filtering fails.
 */
export async function filterStandsWithinProperty(
  boundaryGeometry: GeoJSON.MultiPolygon,
  stands: WfsStand[],
  forestId: string
): Promise<WfsStand[]> {
  // 1. Split boundary into individual parcels and buffer each
  const bufferedParcels: GeoJSON.MultiPolygon[] = [];
  try {
    const clean = { ...boundaryGeometry };
    delete (clean as Record<string, unknown>).crs;

    for (const polygonCoords of clean.coordinates) {
      const parcel: GeoJSON.MultiPolygon = {
        type: "MultiPolygon",
        coordinates: [polygonCoords],
      };
      try {
        const buf = buffer(
          {
            type: "Feature" as const,
            geometry: parcel,
            properties: {},
          },
          BUFFER_DEGREES,
          { units: "degrees" }
        );
        if (buf?.geometry) {
          bufferedParcels.push(buf.geometry as GeoJSON.MultiPolygon);
        }
      } catch {
        // If buffer fails for one parcel, use it unbuffered
        bufferedParcels.push(parcel);
      }
    }
  } catch (err) {
    console.warn(
      "Turf buffer failed — using exact boundary:",
      err instanceof Error ? err.message : err
    );
    bufferedParcels.push(boundaryGeometry);
  }

  // 2. Filter stands: must intersect at least ONE buffered parcel
  let filteredStands: WfsStand[];
  try {
    filteredStands = stands.filter((stand) => {
      try {
        const standFeature = {
          type: "Feature" as const,
          geometry: stand.geometry,
          properties: {},
        };
        return bufferedParcels.some((parcel) =>
          booleanIntersects(
            {
              type: "Feature" as const,
              geometry: parcel,
              properties: {},
            },
            standFeature
          )
        );
      } catch {
        return true; // conservative: keep on individual errors
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

    // 3. Build compartment rows (only filtered stands)
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

    // 4. Deduplicate by (forest_id, stand_id)
    const seen = new Set<string>();
    const deduped = compartmentRows
      .reverse()
      .filter((row) => {
        const key = `${row.forest_id}:${row.stand_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .reverse();

    // 5. Insert into compartments table
    const { error } = await supabase.from("compartments").upsert(deduped, {
      onConflict: "forest_id, stand_id",
    });

    if (error) {
      throw new Error(`Failed to insert compartments: ${error.message}`);
    }

    return filteredStands;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Failed to insert")) {
      throw err;
    }
    console.error("Compartment insert error:", err);
    return filteredStands;
  }
}
