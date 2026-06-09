import { createAdminClient } from "@/lib/supabase/admin";
import type { WfsStand } from "./wfs-client";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import buffer from "@turf/buffer";

const CENTROID_TOLERANCE = 0.00001; // ≈1 m at 62.6°N

/**
 * Intersect fetched WFS stands with the property boundary.
 *
 * Uses centroid-within-parcel check: a stand is included only if its
 * centroid falls inside at least one property parcel (with 1 m buffer
 * for edge tolerance). Much more precise than booleanIntersects.
 *
 * Hokkala has 4 non-contiguous parcels up to 5 km apart — each is
 * checked individually to avoid merging them into one blob.
 *
 * When two stands share the same stand_id (different properties),
 * the one closest to the parcel centroid wins the dedup tiebreaker.
 *
 * Falls back to inserting all stands if spatial filtering fails.
 */
export async function filterStandsWithinProperty(
  boundaryGeometry: GeoJSON.MultiPolygon,
  stands: WfsStand[],
  forestId: string
): Promise<WfsStand[]> {
  // 1. Split boundary into individual parcels, buffer each by 1 m
  const { coordinates } = boundaryGeometry;
  const bufferedParcels: GeoJSON.MultiPolygon[] = [];
  const parcelCentroids: GeoJSON.Position[] = [];

  for (const coords of coordinates) {
    const parcel: GeoJSON.MultiPolygon = {
      type: "MultiPolygon" as const,
      coordinates: [coords],
    };
    const pc = centroid(parcel);
    if (pc?.geometry?.coordinates) {
      parcelCentroids.push(pc.geometry.coordinates);
    }

    try {
      const buf = buffer(
        { type: "Feature" as const, geometry: parcel, properties: {} },
        CENTROID_TOLERANCE,
        { units: "degrees" }
      );
      if (buf?.geometry) {
        bufferedParcels.push(buf.geometry as GeoJSON.MultiPolygon);
      } else {
        bufferedParcels.push(parcel);
      }
    } catch {
      bufferedParcels.push(parcel);
    }
  }

  // 2. Filter stands: centroid must be inside at least one buffered parcel
  let filteredStands: WfsStand[];
  const centroidCache = new Map<string, GeoJSON.Position>();

  try {
    filteredStands = stands.filter((stand) => {
      try {
        const c = centroid(stand.geometry);
        if (!c?.geometry?.coordinates) return false;

        for (const bp of bufferedParcels) {
          if (booleanPointInPolygon(c, bp)) {
            centroidCache.set(stand.standId, c.geometry.coordinates);
            return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    });

    // 3. Sort: first by distance to nearest parcel centroid (tiebreaker
    //    for cross-property duplicates), then by area desc (keeps largest
    //    fragment when WFS splits a stand by road/water)
    if (parcelCentroids.length > 0) {
      filteredStands.sort((a, b) => {
        const ca = centroidCache.get(a.standId);
        const cb = centroidCache.get(b.standId);
        if (!ca || !cb) return 0;

        const dist = (p: GeoJSON.Position) =>
          Math.min(
            ...parcelCentroids.map((pc) =>
              Math.sqrt(
                ((p[0] - pc[0]) * 51000) ** 2 +
                ((p[1] - pc[1]) * 111000) ** 2
              )
            )
          );

        const d = dist(ca) - dist(cb);
        if (d !== 0) return d;
        // Same distance (same-stand fragments) — prefer larger area
        return (b.areaHa ?? 0) - (a.areaHa ?? 0);
      });
    }
  } catch (err) {
    console.warn(
      "Spatial filter failed — inserting all stands unfiltered:",
      err instanceof Error ? err.message : err
    );
    filteredStands = stands;
  }

  try {
    const supabase = createAdminClient();

    // 4. Build compartment rows
    const compartmentRows = filteredStands.map((stand) => {
      const attrs = { ...(stand.attributes as Record<string, unknown>) };
      return {
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
        stem_count: stand.stemCount,
        avg_diameter: stand.avgDiameter,
        avg_height: stand.avgHeight,
        growth_m3_per_ha: stand.growthM3PerHa,
        geometry: stand.geometry,
        attributes: attrs,
      };
    });

    // 5. Deduplicate: keep first occurrence (closest to parcel after sort)
    const seen = new Set<string>();
    const deduped = compartmentRows.filter((row) => {
      const key = `${row.forest_id}:${row.stand_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

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
