// scripts/backfill-compartment-species.ts
// One-time: extract species breakdown from compartments.attributes.species
// into the compartment_species table. Falls back to main_species if no
// breakdown exists.
//
// Usage: npx tsx scripts/backfill-compartment-species.ts

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Read .env.local manually (no dotenv dependency)
function loadEnv(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  }
  return env;
}

const env = loadEnv(path.resolve(__dirname, "../.env.local"));

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL!;
// Use service_role key to bypass RLS during backfill
const serviceRoleKey = env.SUPABASE_SECRET_KEY!;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface RawSpecies {
  puulaji: string;
  m3: number;
  tukkiprosentti: number;
}

interface CompRow {
  id: string;
  forest_id: string;
  stand_id: string;
  area_ha: number | null;
  main_species: string | null;
  volume_m3: number | null;
  attributes: Record<string, unknown> | null;
}

async function main() {
  // 1. Fetch all compartments
  console.log("Fetching compartments...");
  const { data: compartments, error } = await supabase
    .from("compartments")
    .select("id, forest_id, stand_id, area_ha, main_species, volume_m3, attributes")
    .order("forest_id");

  if (error) {
    console.error("Failed to fetch compartments:", error);
    process.exit(1);
  }

  if (!compartments || compartments.length === 0) {
    console.log("No compartments found.");
    return;
  }

  console.log(`Found ${compartments.length} compartments.`);

  // 2. Build species rows
  const speciesRows: {
    forest_id: string;
    compartment_id: string;
    stand_id: string;
    puulaji: string;
    volume_m3: number;
    tukkiprosentti: number | null;
    area_ha: number;
  }[] = [];

  let withBreakdown = 0;
  let fallbackToMain = 0;

  for (const comp of compartments as CompRow[]) {
    const attrs = comp.attributes as Record<string, unknown> | null;
    const speciesData: RawSpecies[] =
      attrs && Array.isArray(attrs["species"]) ? (attrs["species"] as RawSpecies[]) : [];

    if (speciesData.length > 0) {
      // Has species breakdown — create one row per species
      const totalSpeciesM3 = speciesData.reduce((s, sp) => s + (sp.m3 ?? 0), 0);
      withBreakdown++;

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
          area_ha: Math.round(areaProportion * 1000) / 1000, // 3 decimals
        });
      }
    } else {
      // No breakdown — assign 100% to main_species
      fallbackToMain++;
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

  console.log(
    `Built ${speciesRows.length} species rows (${withBreakdown} with breakdown, ${fallbackToMain} fallback to main_species).`
  );

  // 3. Delete existing rows and insert new ones
  console.log("Clearing existing compartment_species...");
  const { error: deleteError } = await supabase
    .from("compartment_species")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all

  if (deleteError) {
    console.error("Failed to clear existing rows:", deleteError);
    process.exit(1);
  }

  // 4. Insert in batches of 500
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < speciesRows.length; i += BATCH_SIZE) {
    const batch = speciesRows.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase
      .from("compartment_species")
      .insert(batch);

    if (insertError) {
      console.error(`Batch insert failed at offset ${i}:`, insertError);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${speciesRows.length}`);
  }

  console.log(`✅ Done! Inserted ${inserted} rows into compartment_species.`);

  // 5. Summary
  const { data: summary, error: summaryError } = await supabase
    .from("compartment_species")
    .select("puulaji, volume_m3.sum(), area_ha.sum()")
    .order("puulaji");

  if (summaryError) {
    console.error("Summary query failed:", summaryError);
  } else {
    console.log("\nSpecies distribution:");
    for (const row of summary as any[]) {
      console.log(`  ${row.puulaji}: ${Math.round(row.sum ?? 0).toLocaleString()} m³, ${(row.sum_area_ha ?? 0).toFixed(1)} ha`);
    }
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
