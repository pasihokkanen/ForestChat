// src/lib/ai/income-calculator.ts
// Phase 4b: Compute income_eur for operations created by add_operation.
// Mirrors the logic in classify.ts but as a standalone utility
// that takes a Supabase Compartment + operation params.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPrices, PRICES } from "./config";

/** Species breakdown from compartment.attributes.species */
interface RawSpecies {
  puulaji: string;
  m3: number;
  tukkiprosentti: number;
}

/** Map operation type to price tier */
function tierForType(type: string): "uudistushakkuu" | "harvennus" | "ensiharvennus" {
  const t = type.toLowerCase();
  if (t === "clear_cut" || t === "päätehakkuu" || t === "avohakkuu") return "uudistushakkuu";
  if (t === "first_thinning" || t === "ensiharvennus") return "ensiharvennus";
  if (t === "selection_cutting" || t === "poimintahakkuu") return "harvennus";
  return "harvennus"; // Thinning, Harvennus, etc.
}

/**
 * Compute the stumpage value (arvo) for one species in a compartment.
 * Uses species-specific tukki/kuitu breakdown.
 */
function speciesValue(
  speciesM3: number,
  tukkiPct: number,
  tier: "uudistushakkuu" | "harvennus" | "ensiharvennus",
  species: string
): number {
  const prices = getPrices(tier, species);
  const tukkiM3 = speciesM3 * (tukkiPct / 100);
  const kuituM3 = speciesM3 - tukkiM3;
  return Math.round(tukkiM3 * prices.tukki + kuituM3 * prices.kuitu);
}

/**
 * Compute income_eur for an operation on a compartment.
 *
 * @param supabase - Suapbase client (unused currently, reserved for future timber_prices DB lookup)
 * @param compartment - Compartment row with volume_m3, main_species, attributes
 * @param type - Operation type (Clear_cut, Thinning, etc.)
 * @param removalPct - Removal percentage (0-100)
 * @returns income_eur (integer, rounded)
 */
export async function calculateOperationIncome(
  _supabase: SupabaseClient,
  compartment: {
    volume_m3: number | null;
    main_species: string | null;
    area_ha: number | null;
    attributes: Record<string, unknown> | null;
  },
  type: string,
  removalPct: number
): Promise<number> {
  const totalM3 = compartment.volume_m3 ?? 0;
  const species = compartment.main_species ?? "Mänty";
  const tier = tierForType(type);

  if (totalM3 <= 0) return 0;

  // Try species breakdown from attributes
  const attrs = compartment.attributes;
  let speciesData: RawSpecies[] = [];

  if (attrs && Array.isArray((attrs as Record<string, unknown>)["species"])) {
    speciesData = (attrs as Record<string, unknown>)["species"] as RawSpecies[];
  }

  let totalValue = 0;

  if (speciesData.length > 0) {
    // Compute per-species value
    for (const sp of speciesData) {
      const spName = sp.puulaji ?? species;
      const spM3 = sp.m3 ?? 0;
      const tukkiPct = sp.tukkiprosentti ?? 0;
      totalValue += speciesValue(spM3, tukkiPct, tier, spName);
    }
  } else {
    // Fallback: whole compartment as single species
    // For thinning, we need to adjust: thinning price / clear-cut price ratio
    if (tier !== "uudistushakkuu") {
      // Compute what the full clear-cut value would be
      const ccPrices = getPrices("uudistushakkuu", species);
      const tierPrices = getPrices(tier, species);
      const ccValue = totalM3 * (ccPrices.tukki + ccPrices.kuitu) / 2; // rough avg
      const ratio = (tierPrices.tukki + tierPrices.kuitu) / (ccPrices.tukki + ccPrices.kuitu);
      totalValue = Math.round(ccValue * ratio);
    } else {
      // Clear-cut: use full value
      const prices = getPrices(tier, species);
      // Assume 50/50 tukki/kuitu split for rough estimate
      const avgPrice = (prices.tukki + prices.kuitu) / 2;
      totalValue = Math.round(totalM3 * avgPrice);
    }
  }

  // Apply removal percentage (for thinning, Selection_cutting, etc.)
  const removalFactor = removalPct / 100;

  // Special: Selection_cutting is typically 50% removal
  const adjustedRemoval = type.toLowerCase().includes("selection") ? 0.5 : removalFactor;

  return Math.round(totalValue * adjustedRemoval);
}
