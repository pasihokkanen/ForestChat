import { createAdminClient } from "@/lib/supabase/admin";
import type { WfsStand, WfsGridcell } from "./wfs-client";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import buffer from "@turf/buffer";

const CENTROID_TOLERANCE = 0.00001; // ≈1 m at 62.6°N

/** Species breakdown row from compartment attributes */
interface RawSpecies {
  puulaji: string;
  m3: number;
  tukkiprosentti: number;
}

/**
 * Match grid cells to stands by centroid-in-polygon and aggregate
 * per-species volumes. Returns a Map of stand_id → species array.
 * Iterates gridcells once (O(n)) — for each cell, finds the first
 * containing stand via Turf booleanPointInPolygon.
 */
function matchGridcellsToStands(
  gridcells: WfsGridcell[],
  stands: WfsStand[]
): Map<string, RawSpecies[]> {
  const result = new Map<string, { pine: number; spruce: number; decid: number }>();
  if (gridcells.length === 0) return new Map();

  let matched = 0;
  let unmatched = 0;

  for (const cell of gridcells) {
    try {
      const c = centroid(cell.geometry);
      if (!c?.geometry?.coordinates) { unmatched++; continue; }

      const point: GeoJSON.Feature<GeoJSON.Point> = {
        type: "Feature",
        geometry: { type: "Point", coordinates: c.geometry.coordinates },
        properties: {},
      };

      // Find which stand contains this gridcell
      let found = false;
      for (const stand of stands) {
        try {
          if (booleanPointInPolygon(point, stand.geometry)) {
            let acc = result.get(stand.standId);
            if (!acc) {
              acc = { pine: 0, spruce: 0, decid: 0 };
              result.set(stand.standId, acc);
            }
            if (cell.volumePine > 0) acc.pine += cell.volumePine * cell.cellAreaHa;
            if (cell.volumeSpruce > 0) acc.spruce += cell.volumeSpruce * cell.cellAreaHa;
            if (cell.volumeDeciduous > 0) acc.decid += cell.volumeDeciduous * cell.cellAreaHa;
            matched++;
            found = true;
            break; // gridcell belongs to one stand
          }
        } catch { /* skip */ }
      }
      if (!found) unmatched++;
    } catch { unmatched++; }
  }

  console.log(`  Gridcell matching: ${matched} matched, ${unmatched} unmatched`);

  // Convert to RawSpecies[] format
  const speciesMap = new Map<string, RawSpecies[]>();
  result.forEach((acc, standId) => {
    const species: RawSpecies[] = [];
    if (acc.pine > 0) species.push({ puulaji: "Mänty", m3: Math.round(acc.pine * 10) / 10, tukkiprosentti: 0 });
    if (acc.spruce > 0) species.push({ puulaji: "Kuusi", m3: Math.round(acc.spruce * 10) / 10, tukkiprosentti: 0 });
    if (acc.decid > 0) species.push({ puulaji: "Lehtipuu", m3: Math.round(acc.decid * 10) / 10, tukkiprosentti: 0 });
    speciesMap.set(standId, species);
  });

  return speciesMap;
}

/**
 * Extract species rows from compartment attributes and insert into
 * compartment_species. Falls back to main_species if no breakdown exists.
 */
async function populateCompartmentSpecies(
  supabase: ReturnType<typeof createAdminClient>,
  forestId: string,
  compartments: Array<{
    stand_id: string;
    main_species: string | null;
    area_ha: number | null;
    volume_m3: number | null;
    attributes: Record<string, unknown>;
  }>
): Promise<void> {
  // Fetch the just-inserted compartments to get their real IDs
  const standIds = compartments.map(c => c.stand_id);
  const { data: dbCompartments, error: fetchError } = await supabase
    .from("compartments")
    .select("id, forest_id, stand_id, area_ha, main_species, volume_m3, attributes")
    .eq("forest_id", forestId)
    .in("stand_id", standIds);

  if (fetchError || !dbCompartments) {
    console.error("Failed to fetch compartments for species extraction:", fetchError);
    return;
  }

  // Build species rows
  const speciesRows: Array<{
    forest_id: string;
    compartment_id: string;
    stand_id: string;
    puulaji: string;
    volume_m3: number;
    tukkiprosentti: number | null;
    area_ha: number;
  }> = [];

  for (const comp of dbCompartments as any[]) {
    const attrs = comp.attributes as Record<string, unknown> | null;
    const speciesData: RawSpecies[] =
      attrs && Array.isArray(attrs["species"]) ? (attrs["species"] as RawSpecies[]) : [];

    if (speciesData.length > 0) {
      const totalSpeciesM3 = speciesData.reduce((s, sp) => s + (sp.m3 ?? 0), 0);
      for (const sp of speciesData) {
        const m3 = sp.m3 ?? 0;
        const areaProportion = totalSpeciesM3 > 0
          ? ((comp.area_ha ?? 0) * m3) / totalSpeciesM3
          : (comp.area_ha ?? 0) / speciesData.length;

        speciesRows.push({
          forest_id: comp.forest_id,
          compartment_id: comp.id,
          stand_id: comp.stand_id,
          puulaji: sp.puulaji ?? comp.main_species ?? "Unknown",
          volume_m3: m3,
          tukkiprosentti: sp.tukkiprosentti ?? null,
          area_ha: Math.round(areaProportion * 1000) / 1000,
        });
      }
    } else {
      // Fallback: 100% to main_species
      speciesRows.push({
        forest_id: comp.forest_id,
        compartment_id: comp.id,
        stand_id: comp.stand_id,
        puulaji: comp.main_species ?? "Unknown",
        volume_m3: comp.volume_m3 ?? 0,
        tukkiprosentti: null,
        area_ha: comp.area_ha ?? 0,
      });
    }
  }

  if (speciesRows.length === 0) return;

  // Delete old species rows for these compartments, then insert new ones
  const { error: deleteError } = await supabase
    .from("compartment_species")
    .delete()
    .eq("forest_id", forestId);

  if (deleteError) {
    console.error("Failed to clear old species rows:", deleteError);
    return;
  }

  // Insert in batches
  const BATCH_SIZE = 500;
  for (let i = 0; i < speciesRows.length; i += BATCH_SIZE) {
    const batch = speciesRows.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase
      .from("compartment_species")
      .insert(batch);
    if (insertError) {
      console.error(`Species insert batch failed at offset ${i}:`, insertError);
    }
  }
}

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
  forestId: string,
  gridcells?: WfsGridcell[]
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

    // 4. Match grid cells to stands for per-species data (if available)
    let speciesByStand: Map<string, RawSpecies[]> = new Map();
    if (gridcells && gridcells.length > 0) {
      console.log(`Filtering ${gridcells.length} gridcells to property boundary...`);

      // First filter gridcells to those within the property (not just BBOX)
      const propertyGridcells = gridcells.filter((cell) => {
        try {
          const c = centroid(cell.geometry);
          if (!c?.geometry?.coordinates) return false;
          for (const bp of bufferedParcels) {
            if (booleanPointInPolygon(c, bp)) return true;
          }
          return false;
        } catch {
          return false;
        }
      });

      console.log(`  ${propertyGridcells.length} gridcells within property (filtered out ${gridcells.length - propertyGridcells.length})`);
      console.log(`Matching ${propertyGridcells.length} gridcells to ${filteredStands.length} stands...`);
      speciesByStand = matchGridcellsToStands(propertyGridcells, filteredStands);
      const matchedStands = speciesByStand.size;
      console.log(`  Species data matched for ${matchedStands}/${filteredStands.length} stands`);
    }

    // 5. Build compartment rows
    const compartmentRows = filteredStands.map((stand) => {
      const attrs = { ...(stand.attributes as Record<string, unknown>) };
      // Merge gridcell species data into attributes
      const species = speciesByStand.get(stand.standId);
      if (species && species.length > 0) {
        attrs["species"] = species;
      }
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

    // 6. Populate compartment_species from attributes.species (or fall back to main_species)
    await populateCompartmentSpecies(supabase, forestId, deduped);

    return filteredStands;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Failed to insert")) {
      throw err;
    }
    console.error("Compartment insert error:", err);
    return filteredStands;
  }
}
