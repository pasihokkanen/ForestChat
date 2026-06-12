// src/lib/import/csv-importer.ts
// Import parsed CSV stand data into Supabase using the authenticated user's session.
// All writes go through RLS policies — no admin client.
// Self-cleaning: deletes the forest on any internal failure (cascade handles rest).

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPropertyBoundary } from "./mml-client";
import type { ParsedCsvData, CsvStandRow, CsvSpeciesRow } from "./csv-parser";

export interface CsvImportResult {
  forestId: string;
  propertyId: string;
  name: string;
  standsImported: number;
  standsWithGeometry: number;
  speciesRowsImported: number;
  totalVolumeM3: number;
  warnings: string[];
}

// ─── WKT → GeoJSON ─────────────────────────────────────────────────

/**
 * Parse MULTIPOLYGON WKT string to GeoJSON MultiPolygon.
 * WKT format: MULTIPOLYGON(((lon lat, lon lat,...)),((...)))
 * GeoJSON:    { type: "MultiPolygon", coordinates: [[[[lon, lat],...]]] }
 *
 * WKT uses "lon lat" order. GeoJSON uses [lon, lat] order. They match — no swap needed.
 * Returns null if the WKT is empty or unparseable.
 */
function wktToGeoJSON(wkt: string): GeoJSON.MultiPolygon | null {
  if (!wkt || !wkt.trim()) return null;

  try {
    const match = wkt.match(/^MULTIPOLYGON\s*\(\(\((.+)\)\)\)$/i);
    if (!match) return null;

    const polygonStrings = match[1].split(/\s*\)\s*\)\s*,\s*\(\s*\(\s*/);
    const coordinates: GeoJSON.Position[][][] = polygonStrings.map((polyStr) => {
      const ringStrs = polyStr.split(/\s*\)\s*,\s*\(\s*/);
      return ringStrs.map((ringStr) =>
        ringStr
          .trim()
          .split(/\s*,\s*/)
          .map((pair) => {
            const [lon, lat] = pair.trim().split(/\s+/).map(Number);
            return [lon, lat] as GeoJSON.Position;
          })
      );
    });

    return { type: "MultiPolygon", coordinates };
  } catch {
    return null; // malformed WKT → stand stored without geometry
  }
}

// ─── Importer ──────────────────────────────────────────────────────

export async function importStandsFromCsv(
  csvData: ParsedCsvData,
  propertyId: string,
  forestName: string,
  userId: string,
  mmlApiKey: string,
  supabase: SupabaseClient
): Promise<CsvImportResult> {
  const warnings: string[] = [];
  let forestId = "";

  try {
    // 1. Fetch MML boundary
    const boundary = await fetchPropertyBoundary(propertyId, mmlApiKey);
    if (!boundary) {
      throw new Error(`Property ${propertyId} not found`);
    }

    // 2. Create forest record (via user's auth session)
    const { data: forest, error: forestError } = await supabase
      .from("forests")
      .insert({
        owner_id: userId,
        name: forestName,
        property_id: propertyId,
        data_source: "csv",
      })
      .select()
      .single();

    if (forestError || !forest) {
      throw new Error(`Failed to create forest: ${forestError?.message}`);
    }
    forestId = forest.id;

    // 3. Store property boundary
    const { error: boundaryError } = await supabase
      .from("property_boundaries")
      .upsert({
        forest_id: forestId,
        property_id: propertyId,
        geometry: boundary.geometry,
        fetched_at: new Date().toISOString(),
      });

    if (boundaryError) {
      throw new Error(`Failed to store boundary: ${boundaryError.message}`);
    }

    // 4. Map compartments and insert
    const compartmentRows = csvData.stands.map((stand) => {
      const geom = wktToGeoJSON(stand.polygon_wkt);
      if (!geom && stand.polygon_wkt?.trim()) {
        warnings.push(`Stand ${stand.stand_id}: invalid WKT geometry`);
      }
      return {
        forest_id: forestId,
        stand_id: stand.stand_id,
        area_ha: stand.area_ha,
        main_species: stand.main_species,
        development_class: stand.development_class,
        site_type: stand.site_type,
        soil_type: stand.soil_type,
        drainage_status: stand.drainage_status,
        age_years: stand.total_age,
        volume_m3: stand.total_m3,
        basal_area: stand.total_basal_area,
        stem_count_per_ha: stand.total_stem_count_per_ha,
        avg_diameter: stand.total_mean_diameter,
        avg_height: stand.total_mean_height,
        geometry: geom,
        attributes: {
          land_class: stand.land_class,
          total_m3_ha: stand.total_m3_ha,
          total_stem_count_per_ha: stand.total_stem_count_per_ha,
          total_log_pct: stand.total_log_pct,
          total_pct: stand.total_pct,
          center_lat: stand.center_lat,
          center_lon: stand.center_lon,
        },
      };
    });

    const { error: compError } = await supabase
      .from("compartments")
      .upsert(compartmentRows, { onConflict: "forest_id, stand_id" });

    if (compError) {
      throw new Error(`Failed to insert compartments: ${compError.message}`);
    }

    const standsWithGeom = compartmentRows.filter((r) => r.geometry !== null).length;

    // 5. Fetch just-inserted compartments for species storage
    const standIds = csvData.stands.map((s) => s.stand_id);
    const { data: dbCompartments, error: fetchError } = await supabase
      .from("compartments")
      .select("id, forest_id, stand_id, area_ha, volume_m3")
      .eq("forest_id", forestId)
      .in("stand_id", standIds);

    if (fetchError) {
      throw new Error(`Failed to fetch compartments: ${fetchError.message}`);
    }

    // Build lookup: stand_id → compartment DB row
    const compLookup = new Map<string, (typeof dbCompartments)[number]>();
    for (const comp of dbCompartments ?? []) {
      compLookup.set(comp.stand_id, comp);
    }

    // 6. Build species rows
    const speciesRows: Array<{
      forest_id: string;
      compartment_id: string;
      stand_id: string;
      species: string;
      volume_m3: number;
      log_pct: number | null;
      area_ha: number;
      stem_count_per_ha: number | null;
      mean_height: number | null;
      mean_diameter: number | null;
      age: number | null;
      basal_area: number | null;
    }> = [];

    for (const stand of csvData.stands) {
      const comp = compLookup.get(stand.stand_id);
      if (!comp) continue;

      const totalM3 = stand.total_m3 ?? 0;

      for (const sp of stand.species) {
        const m3 = sp.m3 ?? 0;
        // Only insert species with volume > 0
        if (m3 <= 0) continue;

        // Proportional area
        const areaProportion =
          totalM3 > 0 ? ((comp.area_ha ?? stand.area_ha) * m3) / totalM3 : 0;

        speciesRows.push({
          forest_id: forestId,
          compartment_id: comp.id,
          stand_id: stand.stand_id,
          species: sp.species,
          volume_m3: m3,
          log_pct: sp.log_pct,
          area_ha: Math.round(areaProportion * 1000) / 1000,
          stem_count_per_ha: sp.stem_count_per_ha,
          mean_height: sp.mean_height,
          mean_diameter: sp.mean_diameter,
          age: sp.age,
          basal_area: sp.basal_area,
        });
      }
    }

    // Batch insert species rows (500 per batch)
    const BATCH_SIZE = 500;
    let speciesImported = 0;
    for (let i = 0; i < speciesRows.length; i += BATCH_SIZE) {
      const batch = speciesRows.slice(i, i + BATCH_SIZE);
      const { error: spError } = await supabase
        .from("compartment_species")
        .insert(batch);

      if (spError) {
        throw new Error(`Species insert failed at batch ${i}: ${spError.message}`);
      }
      speciesImported += batch.length;
    }

    // 7. Update forest totals
    const totalAreaHa = boundary.areaM2
      ? Math.round((boundary.areaM2 / 10000) * 100) / 100
      : null;

    await supabase
      .from("forests")
      .update({
        total_area_ha: totalAreaHa,
        updated_at: new Date().toISOString(),
      })
      .eq("id", forestId);

    return {
      forestId,
      propertyId,
      name: forestName,
      standsImported: csvData.totalStands,
      standsWithGeometry: standsWithGeom,
      speciesRowsImported: speciesImported,
      totalVolumeM3: csvData.totalVolumeM3,
      warnings,
    };
  } catch (err) {
    // Self-cleaning: delete the forest on any failure (cascade removes compartments,
    // species, boundary). Don't throw for cleanup errors.
    if (forestId) {
      try {
        await supabase.from("forests").delete().eq("id", forestId);
      } catch {
        // cleanup failure is non-fatal
      }
    }
    throw err;
  }
}
