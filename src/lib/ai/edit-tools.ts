// src/lib/ai/edit-tools.ts — T8.2b Mutation Tools
//
// Editing tools: add_operation, remove_operation, batch_update_operations
// add_operation validates against silvicultural rules from architecture plan 5.2.
// remove_operation deletes a planned operation by stand + year.
// batch_update_operations bulk-updates operations matching a filter.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";
import { calculateOperationIncome } from "./income-calculator";
import { COSTS, normalizeOperationType } from "./config";
import { serverMsg } from "../i18n";
import type { Language } from "../i18n";

const VALID_TYPES = [
  "clear_cut",
  "thinning",
  "first_thinning",
  "selection_cutting",
  "tending",
  "early_tending",
  "site_prep",
  "spruce_planting",
  "pine_planting",
  "planting",
  "pre_clearance",
];

function normalizeType(type: string): string {
  return normalizeOperationType(type);
}

// ── Species & site maps (reused from query-tools for batch_update filtering) ──

const SPECIES_MAP: Record<string, string> = {
  mänty: "pine", pine: "pine",
  kuusi: "spruce", spruce: "spruce",
  rauduskoivu: "silver_birch", birch: "silver_birch", koivu: "silver_birch",
  hieskoivu: "downy_birch",
  lehtikuusi: "larch", larch: "larch",
  harmaaleppä: "grey_alder", alder: "grey_alder",
};

const SITE_MAP: Record<string, string> = {
  mesic: "mesic", tuore: "mesic",
  "herb-rich heath": "herb-rich heath", "herb-rich": "herb-rich heath", lehtomainen: "herb-rich heath",
  "sub-xeric": "sub-xeric", kuivahko: "sub-xeric",
  xeric: "xeric", kuiva: "xeric",
};

export async function addOperation(
  supabase: SupabaseClient,
  forestId: string,
  userId: string,
  args: Record<string, unknown>,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  const standId = args.stand_id as string;
  const year = args.year as number;
  const type = normalizeType(args.type as string);
  // Type-aware removal percentage defaults (silvicultural ops get 0)
  const removalPct = (args.removal_pct as number) ?? ({
    clear_cut: 100,
    thinning: 28,
    first_thinning: 25,
    selection_cutting: 50,
  } as Record<string, number>)[type] ?? 0;

  if (!standId || !year || !type) {
    return { success: false, result: "", error: "Required: stand_id, year, type" };
  }

  // Get compartment (Phase 4b: fetch full data for income calculation)
  const { data: compartment } = await supabase
    .from("compartments")
    .select("id, development_class, main_species, volume_m3, area_ha, attributes")
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
    .eq("compartment_id", (compartment as Record<string, unknown>).id as string)
    .eq("year", year)
    .eq("type", type)
    .single();

  if (existing) {
    return { success: false, result: "", error: `Operation ${type} already exists for stand ${standId} in ${year}.` };
  }

  // Phase 4b: Compute income_eur for the operation
  const compartmentData = compartment as Record<string, unknown>;
  const incomeEur = await calculateOperationIncome(
    supabase,
    {
      volume_m3: compartmentData.volume_m3 as number | null,
      main_species: compartmentData.main_species as string | null,
      area_ha: compartmentData.area_ha as number | null,
      attributes: compartmentData.attributes as Record<string, unknown> | null,
    },
    type,
    removalPct
  );

  // Compute cost_eur for silvicultural operations (regeneration, tending, etc.)
  // Harvest operations (Päätehakkuu, Harvennus, etc.) have zero cost — the income
  // already accounts for net stumpage value.
  const areaHa = (compartmentData.area_ha as number) ?? 0;
  const costEur = COSTS[type] ? Math.round(COSTS[type] * areaHa) : 0;

  // Insert with computed income and cost
  const { error } = await supabase.from("operations").insert({
    compartment_id: compartmentData.id as string,
    forest_id: forestId,
    type,
    year,
    removal_pct: removalPct,
    income_eur: incomeEur,
    cost_eur: costEur,
    created_by: "ai",
  });

  if (error) return { success: false, result: "", error: error.message };

  const costLabel = language === "fi" ? "kulu" : "cost";
  const costInfo = costEur > 0 ? `, ${costLabel}: ${costEur.toLocaleString()} €` : "";
  return {
    success: true,
    result: serverMsg("operationAdded", language, String(type), String(standId), String(year), String(removalPct), incomeEur.toLocaleString(), costInfo),
  };
}

export async function removeOperations(
  supabase: SupabaseClient,
  forestId: string,
  standIds: string[],
  year?: number,
  typeFilter?: string,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  // Resolve stand IDs to compartment IDs
  const { data: compartments } = await supabase
    .from("compartments")
    .select("id, stand_id")
    .eq("forest_id", forestId)
    .in("stand_id", standIds);

  if (!compartments || compartments.length === 0) {
    return { success: false, result: "", error: `No stands found: ${standIds.join(", ")}` };
  }

  const compIds = compartments.map((c) => (c as { id: string }).id);

  let query = supabase
    .from("operations")
    .delete()
    .eq("forest_id", forestId)
    .in("compartment_id", compIds);

  if (year != null) query = query.eq("year", year);
  if (typeFilter) query = query.eq("type", typeFilter);

  const { data: deleted, error } = await query.select("id");

  if (error) return { success: false, result: "", error: error.message };

  const count = (deleted as unknown[] | null)?.length ?? 0;
  const yearLabel = language === "fi" ? "vuonna" : "in";
  const yearClause = year != null ? ` ${yearLabel} ${year}` : "";
  const typeLabel = language === "fi" ? "tyyppi" : "type";
  const typeClause = typeFilter ? ` (${typeLabel}: ${typeFilter})` : "";
  const standLabel = standIds.length <= 3 ? standIds.join(", ") : `${standIds.length} stands`;  // numeric, no i18n needed

  if (count === 0) {
    return { success: true, result: serverMsg("noOperationsForStand", language, standLabel, yearClause, typeClause) };
  }
  return { success: true, result: serverMsg("operationsRemoved", language, String(count), standLabel, yearClause, typeClause) };
}

// ── batch_update_operations ──

export interface BatchUpdateFilter {
  years?: number[];
  types?: string[];
  stand_ids?: string[];
  species?: string[];
  development_classes?: string[];
  site_types?: string[];
  income_min?: number;
  income_max?: number;
  removal_m3_min?: number;
  removal_m3_max?: number;
  removal_pct_min?: number;
  removal_pct_max?: number;
  cost_min?: number;
  cost_max?: number;
  stand_age_min?: number;
  stand_age_max?: number;
  stand_area_min?: number;
  stand_area_max?: number;
}

export interface BatchUpdatePayload {
  year?: number;
  removal_pct?: number;
  notes?: string;
}

const ALLOWED_UPDATE_FIELDS = new Set(["year", "removal_pct", "notes"]);
const MAX_BATCH_SIZE = 500;

/**
 * Batch-update operations matching a filter.
 * Only whitelisted fields can be updated (year, removal_pct, notes).
 * The `.update()` call is atomic at the DB level (single SQL UPDATE).
 * Maximum 500 operations per call (safety limit).
 */
export async function batchUpdateOperations(
  supabase: SupabaseClient,
  forestId: string,
  filter: BatchUpdateFilter,
  update: BatchUpdatePayload,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    // Validate update payload — reject any field not in whitelist
    for (const key of Object.keys(update)) {
      if (!ALLOWED_UPDATE_FIELDS.has(key)) {
        return {
          success: false,
          result: "",
          error: `Cannot update field "${key}". Allowed fields: year, removal_pct, notes`,
        };
      }
    }

    // Year validation — prevent setting year to the past
    if (update.year !== undefined && update.year < 2025) {
      return {
        success: false,
        result: "",
        error: `Cannot set year to ${update.year}. Year must be >= 2025.`,
      };
    }

    // Step 1: Find matching operation IDs
    // We query operations with a JOIN to compartments so we can filter on stand-level fields
    let query = supabase
      .from("operations")
      .select("id, year, type, removal_pct, income_eur, cost_eur, compartments!inner(stand_id, main_species, development_class, site_type, area_ha, age_years, volume_m3)")
      .eq("forest_id", forestId);

    // Operation-level filters
    if (filter.years?.length) query = query.in("year", filter.years);
    if (filter.types?.length) query = query.in("type", filter.types);
    if (filter.income_min !== undefined) query = query.gte("income_eur", filter.income_min);
    if (filter.income_max !== undefined) query = query.lte("income_eur", filter.income_max);
    if (filter.removal_pct_min !== undefined) query = query.gte("removal_pct", filter.removal_pct_min);
    if (filter.removal_pct_max !== undefined) query = query.lte("removal_pct", filter.removal_pct_max);
    if (filter.cost_min !== undefined) query = query.gte("cost_eur", filter.cost_min);
    if (filter.cost_max !== undefined) query = query.lte("cost_eur", filter.cost_max);

    const { data, error } = await query.limit(MAX_BATCH_SIZE + 1); // Fetch one extra to detect overflow
    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      return { success: true, result: serverMsg("noMatchingOperations", language) };
    }

    // Post-filter on stand-level fields
    // Supabase returns the joined compartment as a single embedded object (not array)
    // for many-to-one foreign key relationships
    let results = (data as unknown) as Array<{
      id: string;
      year: number;
      type: string;
      removal_pct: number;
      income_eur: number | null;
      cost_eur: number | null;
      compartments: {
        stand_id: string;
        main_species: string | null;
        development_class: string | null;
        site_type: string | null;
        area_ha: number | null;
        age_years: number | null;
        volume_m3: number | null;
      };
    }>;

    if (filter.stand_ids?.length) {
      results = results.filter(r => filter.stand_ids!.includes(r.compartments.stand_id));
    }
    if (filter.species?.length) {
      const translated = filter.species.map(s => SPECIES_MAP[s.toLowerCase()] ?? s);
      results = results.filter(r => translated.includes(r.compartments.main_species ?? ""));
    }
    if (filter.development_classes?.length) {
      results = results.filter(r => filter.development_classes!.includes(r.compartments.development_class ?? ""));
    }
    if (filter.site_types?.length) {
      const translated = filter.site_types.map(s => SITE_MAP[s.toLowerCase()] ?? s);
      results = results.filter(r => translated.includes(r.compartments.site_type ?? ""));
    }
    if (filter.stand_age_min !== undefined) {
      results = results.filter(r => (r.compartments.age_years ?? 0) >= filter.stand_age_min!);
    }
    if (filter.stand_age_max !== undefined) {
      results = results.filter(r => (r.compartments.age_years ?? 0) <= filter.stand_age_max!);
    }
    if (filter.stand_area_min !== undefined) {
      results = results.filter(r => (r.compartments.area_ha ?? 0) >= filter.stand_area_min!);
    }
    if (filter.stand_area_max !== undefined) {
      results = results.filter(r => (r.compartments.area_ha ?? 0) <= filter.stand_area_max!);
    }

    // removal_m3 post-filter (computed)
    if (filter.removal_m3_min !== undefined || filter.removal_m3_max !== undefined) {
      results = results.filter(r => {
        const vol = r.compartments.volume_m3 ?? 0;
        const pct = r.removal_pct ?? 0;
        const m3 = Math.round(vol * pct / 100);
        if (filter.removal_m3_min !== undefined && m3 < filter.removal_m3_min) return false;
        if (filter.removal_m3_max !== undefined && m3 > filter.removal_m3_max) return false;
        return true;
      });
    }

    // Enforce limit
    if (results.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        result: "",
        error: `Too many operations (${results.length}). Maximum is ${MAX_BATCH_SIZE}. Narrow your filter (e.g., specify a single year or type).`,
      };
    }

    if (results.length === 0) {
      return { success: true, result: serverMsg("noMatchingOperationsFiltered", language) };
    }

    // Step 2: Build a summary of what's being changed (for the response message)
    const yearsAffected = new Set(results.map(r => r.year));
    const typesAffected = new Set(results.map(r => r.type));
    const summaryParts: string[] = [];
    if (update.year !== undefined) {
      summaryParts.push(language === "fi" ? `siirretty vuoteen ${update.year}` : `moved to ${update.year}`);
    }
    if (update.removal_pct !== undefined) {
      summaryParts.push(`removal_pct → ${update.removal_pct}%`);
    }
    if (update.notes !== undefined) {
      summaryParts.push(language === "fi" ? "muistiinpanot päivitetty" : "notes updated");
    }

    // Step 3: Execute the atomic update with forest_id defense-in-depth
    const ids = results.map(r => r.id);
    const updatePayload: Record<string, unknown> = {};
    if (update.year !== undefined) updatePayload.year = update.year;
    if (update.removal_pct !== undefined) updatePayload.removal_pct = update.removal_pct;
    if (update.notes !== undefined) updatePayload.notes = update.notes;

    const { error: updateError } = await supabase
      .from("operations")
      .update(updatePayload)
      .in("id", ids)
      .eq("forest_id", forestId);

    if (updateError) throw new Error(updateError.message);

    const summary = summaryParts.length > 0 ? ` (${summaryParts.join(", ")})` : "";
    return {
      success: true,
      result: serverMsg("operationsUpdated", language, String(results.length), String(yearsAffected.size), String(typesAffected.size), summary),
    };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to batch update operations",
    };
  }
}

/** Delete ALL AI-created operations for a forest. Uses the same pattern as generate_plan. */
export async function clearPlan(
  supabase: SupabaseClient,
  forestId: string,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  // Count operations first so we can report what was deleted
  const { count, error: countErr } = await supabase
    .from("operations")
    .select("*", { count: "exact", head: true })
    .eq("forest_id", forestId)
    .eq("created_by", "ai");

  if (countErr) {
    return { success: false, result: "", error: countErr.message };
  }

  if (!count || count === 0) {
    return {
      success: true,
      result: serverMsg("planClearNone", language),
    };
  }

  // Same delete pattern as generate_plan.ts line 118
  const { error } = await supabase
    .from("operations")
    .delete()
    .eq("forest_id", forestId)
    .eq("created_by", "ai");

  if (error) return { success: false, result: "", error: error.message };

  return {
    success: true,
    result: serverMsg("planCleared", language, String(count)),
  };
}
