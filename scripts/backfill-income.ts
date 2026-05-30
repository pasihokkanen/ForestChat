// scripts/backfill-income.ts
// One-time script: compute income_eur for all existing operations
// Usage: npx tsx scripts/backfill-income.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Parse .env.local manually (no dotenv dep needed)
function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
  } catch { /* file not found */ }
  return env;
}

const env = loadEnv(resolve(__dirname, "../.env.local"));

const supabaseUrl = env["NEXT_PUBLIC_SUPABASE_URL"];
const supabaseKey = env["SUPABASE_SECRET_KEY"];

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE env vars in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Price config ───

const PRICES: Record<string, Record<string, Record<string, number>>> = {
  uudistushakkuu: {
    Mänty: { tukki: 68, kuitu: 25 },
    Kuusi: { tukki: 72, kuitu: 28 },
    Rauduskoivu: { tukki: 55, kuitu: 22 },
    Hieskoivu: { tukki: 48, kuitu: 20 },
    Lehtikuusi: { tukki: 65, kuitu: 24 },
    Harmaaleppä: { tukki: 40, kuitu: 18 },
  },
  harvennus: {
    Mänty: { tukki: 55, kuitu: 25 },
    Kuusi: { tukki: 58, kuitu: 28 },
    Rauduskoivu: { tukki: 45, kuitu: 22 },
    Hieskoivu: { tukki: 40, kuitu: 20 },
    Lehtikuusi: { tukki: 52, kuitu: 24 },
    Harmaaleppä: { tukki: 35, kuitu: 18 },
  },
  ensiharvennus: {
    Mänty: { tukki: 42, kuitu: 25 },
    Kuusi: { tukki: 45, kuitu: 28 },
    Rauduskoivu: { tukki: 35, kuitu: 22 },
    Hieskoivu: { tukki: 32, kuitu: 20 },
    Lehtikuusi: { tukki: 40, kuitu: 24 },
    Harmaaleppä: { tukki: 30, kuitu: 18 },
  },
};

function getPrices(tier: string, species: string) {
  const tierPrices = PRICES[tier] ?? PRICES["harvennus"];
  return tierPrices[species] ?? tierPrices["Mänty"] ?? { tukki: 50, kuitu: 22 };
}

function tierForType(type: string): "uudistushakkuu" | "harvennus" | "ensiharvennus" {
  const t = type.toLowerCase();
  if (t === "clear_cut" || t === "päätehakkuu") return "uudistushakkuu";
  if (t === "first_thinning" || t === "ensiharvennus") return "ensiharvennus";
  if (t === "selection_cutting" || t === "poimintahakkuu") return "harvennus";
  return "harvennus";
}

function computeIncome(
  comp: {
    volume_m3: number | null;
    main_species: string | null;
    attributes: Record<string, unknown> | null;
  },
  type: string,
  removalPct: number
): number {
  const totalM3 = comp.volume_m3 ?? 0;
  const species = comp.main_species ?? "Mänty";
  const tier = tierForType(type);

  if (totalM3 <= 0) return 0;

  const attrs = comp.attributes;
  let speciesData: { species?: string; m3?: number; log_pct?: number }[] = [];

  if (attrs && Array.isArray(attrs["species"])) {
    speciesData = attrs["species"] as typeof speciesData;
  }

  let totalValue = 0;

  if (speciesData.length > 0) {
    for (const sp of speciesData) {
      const spName = sp.species ?? species;
      const spM3 = sp.m3 ?? 0;
      const tukkiPct = sp.log_pct ?? 0;
      const prices = getPrices(tier, spName);
      const tukkiM3 = spM3 * (tukkiPct / 100);
      const kuituM3 = spM3 - tukkiM3;
      totalValue += Math.round(tukkiM3 * prices.tukki + kuituM3 * prices.kuitu);
    }
  } else {
    const prices = getPrices(tier, species);
    const avgPrice = (prices.tukki + prices.kuitu) / 2;
    totalValue = Math.round(totalM3 * avgPrice);
  }

  const removalFactor = removalPct / 100;
  const adjustedRemoval = type.toLowerCase().includes("selection") ? 0.5 : removalFactor;

  return Math.round(totalValue * adjustedRemoval);
}

async function main() {
  console.log("🔍 Counting operations with NULL income_eur...");

  const { count, error: countErr } = await supabase
    .from("operations")
    .select("*", { count: "exact", head: true })
    .is("income_eur", null);

  if (countErr) { console.error("Count failed:", countErr.message); process.exit(1); }

  console.log(`📊 ${count ?? 0} operations to backfill`);

  if (!count) { console.log("✅ Nothing to backfill"); process.exit(0); }

  const BATCH_SIZE = 500;
  let totalUpdated = 0;
  let offset = 0;

  while (offset < count) {
    const { data: ops, error } = await supabase
      .from("operations")
      .select(`id, year, type, removal_pct, forest_id, compartments!inner(volume_m3, main_species, area_ha, attributes)`)
      .is("income_eur", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) { console.error(`Fetch failed at ${offset}:`, error.message); break; }
    if (!ops?.length) break;

    const updates: { id: string; income_eur: number; forest_id: string; year: number; type: string; removal_pct: number }[] = [];

    for (const op of ops) {
      const row = op as { id: string; year: number; type: string; removal_pct: number; forest_id: string; compartments: unknown };
      const comp = row.compartments as { volume_m3: number | null; main_species: string | null; area_ha: number | null; attributes: Record<string, unknown> | null } | null;
      if (!comp) { console.warn(`  ⚠️  No compartment for op ${row.id}`); continue; }
      updates.push({
        id: row.id,
        income_eur: computeIncome(comp, row.type, row.removal_pct),
        forest_id: row.forest_id,
        year: row.year,
        type: row.type,
        removal_pct: row.removal_pct,
      });
    }

    if (updates.length > 0) {
      const { error: updateErr } = await supabase
        .from("operations")
        .upsert(updates, { onConflict: "id" });

      if (updateErr) {
        console.error(`Update failed at ${offset}:`, updateErr.message);
      } else {
        totalUpdated += updates.length;
        console.log(`  ✅ Updated ${updates.length} ops (total: ${totalUpdated}/${count})`);
      }
    }
    offset += BATCH_SIZE;
  }

  console.log(`\n🎉 Done! Backfilled ${totalUpdated} operations.`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
