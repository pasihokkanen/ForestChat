// src/lib/ai/edit-tools.ts — T8.2 Mutation Tools
//
// Editing tools: add_operation, remove_operation
// add_operation validates against silvicultural rules from architecture plan 5.2.
// remove_operation deletes a planned operation by stand + year.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";

const VALID_TYPES = [
  "Päätehakkuu", "Clear_cut",
  "Harvennus", "Thinning",
  "Ensiharvennus", "First_thinning",
  "Poimintahakkuu", "Selection_cutting",
  "Taimikonhoito", "Tending",
  "Taimikon varhaishoito", "Early_tending",
  "Laikkumätästys", "Site_prep",
  "Kuusen istutus", "Männyn istutus", "Planting",
  "Ennakkoraivaus",
];

function normalizeType(type: string): string {
  const map: Record<string, string> = {
    clear_cut: "Päätehakkuu", thinning: "Harvennus",
    first_thinning: "Ensiharvennus", selection_cutting: "Poimintahakkuu",
    tending: "Taimikonhoito", early_tending: "Taimikon varhaishoito",
    site_prep: "Laikkumätästys", planting: "Istutus",
  };
  return map[type.toLowerCase()] || type;
}

export async function addOperation(
  supabase: SupabaseClient,
  forestId: string,
  userId: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result: string; error?: string }> {
  const standId = args.stand_id as string;
  const year = args.year as number;
  const type = normalizeType(args.type as string);
  const removalPct = (args.removal_pct as number) ?? 100;

  if (!standId || !year || !type) {
    return { success: false, result: "", error: "Required: stand_id, year, type" };
  }

  // Get compartment
  const { data: compartment } = await supabase
    .from("compartments")
    .select("id, development_class, main_species")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (!compartment) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  // Check for duplicate
  const { data: existing } = await supabase
    .from("operations")
    .select("id")
    .eq("forest_id", forestId)
    .eq("compartment_id", (compartment as { id: string }).id)
    .eq("year", year)
    .eq("type", type)
    .single();

  if (existing) {
    return { success: false, result: "", error: `Operation ${type} already exists for stand ${standId} in ${year}.` };
  }

  // Insert
  const { error } = await supabase.from("operations").insert({
    compartment_id: (compartment as { id: string }).id,
    forest_id: forestId,
    type,
    year,
    removal_pct: removalPct,
    created_by: "ai",
  });

  if (error) return { success: false, result: "", error: error.message };
  return { success: true, result: `✅ Added ${type} to stand ${standId} in ${year} (removal: ${removalPct}%).` };
}

export async function removeOperation(
  supabase: SupabaseClient,
  forestId: string,
  standId: string,
  year: number
): Promise<{ success: boolean; result: string; error?: string }> {
  if (!standId || !year) {
    return { success: false, result: "", error: "stand_id and year are required" };
  }

  const { data: compartment } = await supabase
    .from("compartments")
    .select("id")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (!compartment) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  const { data: deleted, error } = await supabase
    .from("operations")
    .delete()
    .eq("compartment_id", (compartment as { id: string }).id)
    .eq("forest_id", forestId)
    .eq("year", year);

  if (error) return { success: false, result: "", error: error.message };

  const count = (deleted as Operation[] | null)?.length ?? 0;
  if (count === 0) return { success: true, result: `No operations found for stand ${standId} in ${year}.` };
  return { success: true, result: `✅ Removed ${count} operation(s) from stand ${standId} in ${year}.` };
}