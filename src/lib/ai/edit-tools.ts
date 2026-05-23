// src/lib/ai/edit-tools.ts — T8.2 Mutation Tools
//
// Editing tools: add_operation, remove_operation
// add_operation validates against silvicultural rules from architecture plan 5.2.
// remove_operation deletes a planned operation by stand + year.

import type { Compartment } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOperationsByYear } from "@/lib/repos/operations";

// ── Validation helpers (rules from architecture 5.2) ──

const MIN_AGE_FIRST_THINNING: Record<string, number> = {
  Mänty: 30,
  Kuusi: 25,
  Hieskoivu: 20,
  Rauduskoivu: 20,
  Lehtikuusi: 25,
  Harmaaleppä: 20,
};

const MIN_AGE_THINNING: Record<string, number> = {
  Mänty: 45,
  Kuusi: 40,
  Hieskoivu: 35,
  Rauduskoivu: 35,
  Lehtikuusi: 40,
  Harmaaleppä: 35,
};

const REGENERATION_READY_CLASSES = ["Uudistuskypsä metsikkö", "Siemenpuumetsikkö"];
const REGENERATION_TYPES = [
  "Laikkumätästys", "Ojitusmätästys", "Laikutus",
  "Istutus", "Kuusen istutus", "Männyn istutus",
  "Taimikonhoito", "Taimikon varhaishoito",
];
const YOUNG_STAND_CLASSES = ["Taimikko", "Aukea"];

function normalizeSpecies(species: string | null): string {
  if (!species) return "Mänty";
  if (species === "Koivu") return "Rauduskoivu";
  return species;
}

/**
 * Validate that a proposed operation is silviculturally sound.
 * Returns null if valid, or an error message string if invalid.
 */
async function validateOperation(
  compartment: Compartment,
  type: string,
  year: number,
  removalPct: number,
  forestId: string
): Promise<string | null> {
  const species = normalizeSpecies(compartment.main_species);
  const devClass = compartment.development_class ?? "";
  const age = compartment.age_years ?? 0;

  switch (type) {
    case "Päätehakkuu":
    case "Clear_cut": {
      // Only for regeneration-ready stands
      if (!REGENERATION_READY_CLASSES.some((c) => devClass.includes(c))) {
        return `Stand ${compartment.stand_id} (${devClass}) is not classified as regeneration-ready. Clear cutting is only allowed on regeneration-ready stands.`;
      }
      if (removalPct !== 100) {
        return `Clear cut must have 100% removal.`;
      }
      break;
    }

    case "Poimintahakkuu":
    case "Selection_cutting": {
      // Special case: removal 50%, only on specific stands
      if (removalPct !== 50) {
        return `Selection cutting must have 50% removal.`;
      }
      break;
    }

    case "Harvennus":
    case "Thinning": {
      // Mature thinning stand, age ≥ threshold
      const minAge = MIN_AGE_THINNING[species] ?? 40;
      if (age < minAge) {
        return `Stand ${compartment.stand_id} is ${age} years old. Thinning requires minimum age ${minAge} for ${species}.`;
      }
      if (removalPct > 35) {
        return `Thinning removal too high (${removalPct}%). Thinning should be ~28% removal.`;
      }
      break;
    }

    case "Ensiharvennus":
    case "First_thinning": {
      // Young thinning stand
      const minAge = MIN_AGE_FIRST_THINNING[species] ?? 25;
      if (age < minAge) {
        return `Stand ${compartment.stand_id} is ${age} years old. First thinning requires minimum age ${minAge} for ${species}.`;
      }
      if (removalPct > 30) {
        return `First thinning removal too high (${removalPct}%). First thinning should be ~25% removal.`;
      }
      break;
    }

    case "Taimikonhoito":
    case "Taimikon varhaishoito":
    case "Ennakkoraivaus":
    case "Tending":
    case "Early_tending": {
      // Seedling stands or young stands
      if (!YOUNG_STAND_CLASSES.some((c) => devClass.includes(c)) && age > 20) {
        return `Tending operations are only for seedling/young stands. Stand ${compartment.stand_id} is ${devClass} (${age} years).`;
      }
      break;
    }

    case "Laikkumätästys":
    case "Ojitusmätästys":
    case "Laikutus":
    case "Istutus":
    case "Kuusen istutus":
    case "Männyn istutus":
    case "Site_prep":
    case "Planting": {
      // Regeneration: should follow clearcut (allow it — validate_plan checks chains)
      break;
    }

    default:
      return `Unknown operation type: ${type}`;
  }

  // Check thinning interval: Do NOT thin a stand that was thinned less than 10 years ago
  if (["Harvennus", "Ensiharvennus", "Thinning", "First_thinning"].includes(type)) {
    const existingOps = await getOperationsByYear(forestId, year);
    const recentThin = existingOps.find(
      (o) =>
        o.compartment_id === compartment.id &&
        (o.type === "Harvennus" || o.type === "Ensiharvennus") &&
        Math.abs(o.year - year) < 10
    );
    if (recentThin) {
      return `Stand ${compartment.stand_id} was thinned in ${recentThin.year} (< 10 years ago). Minimum thinning interval is 10 years.`;
    }
  }

  return null; // valid
}

// ── add_operation ──

export async function addOperation(
  forestId: string,
  userId: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result: string; error?: string }> {
  const standId = args.stand_id as string;
  const year = args.year as number;
  const type = args.type as string;
  const removalPct = (args.removal_pct as number) ?? 100;

  // Validate required fields
  if (!standId) return { success: false, result: "", error: "stand_id is required" };
  if (!year) return { success: false, result: "", error: "year is required" };
  if (!type) return { success: false, result: "", error: "type is required" };

  // Validate year is in the future
  const currentYear = new Date().getFullYear();
  if (year < currentYear) {
    return { success: false, result: "", error: `Year ${year} is in the past. Plan operations must be in the current year or later.` };
  }

  // Get compartment
  const supabase = await createServerSupabase();
  const { data: compartment } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (!compartment) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  const comp = compartment as Compartment;

  // Run validation
  const validationError = await validateOperation(comp, type, year, removalPct, forestId);
  if (validationError) {
    return { success: false, result: "", error: validationError };
  }

  // Check for duplicate: same stand + same year + same type
  const { data: existing } = await supabase
    .from("operations")
    .select("id")
    .eq("forest_id", forestId)
    .eq("compartment_id", comp.id)
    .eq("year", year)
    .eq("type", type)
    .single();

  if (existing) {
    return { success: false, result: "", error: `Operation ${type} already exists for stand ${standId} in ${year}.` };
  }

  // Insert operation
  const supabase2 = await createServerSupabase();
  const { error } = await supabase2.from("operations").insert({
    compartment_id: comp.id,
    forest_id: forestId,
    type,
    year,
    removal_pct: removalPct,
    created_by: "ai",
  });

  if (error) {
    return { success: false, result: "", error: error.message };
  }

  return { success: true, result: `✅ Added ${type} to stand ${standId} in ${year} (removal: ${removalPct}%).` };
}

// ── remove_operation ──

export async function removeOperation(
  forestId: string,
  standId: string,
  year: number
): Promise<{ success: boolean; result: string; error?: string }> {
  if (!standId) return { success: false, result: "", error: "stand_id is required" };
  if (!year) return { success: false, result: "", error: "year is required" };

  // Find the compartment first
  const supabase = await createServerSupabase();
  const { data: compartment } = await supabase
    .from("compartments")
    .select("id")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (!compartment) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  // Find and delete operations for this stand+year
  const supabase3 = await createServerSupabase();
  const { data: deleted, error } = await supabase3
    .from("operations")
    .delete()
    .eq("compartment_id", compartment.id)
    .eq("forest_id", forestId)
    .eq("year", year)
    .select();

  if (error) {
    return { success: false, result: "", error: error.message };
  }

  const count = deleted?.length ?? 0;
  if (count === 0) {
    return { success: true, result: `No operations found for stand ${standId} in ${year}. Nothing to remove.` };
  }

  const types = deleted.map((o: { type: string }) => o.type).join(", ");
  return { success: true, result: `✅ Removed ${count} operation(s) from stand ${standId} in ${year}: ${types}.` };
}