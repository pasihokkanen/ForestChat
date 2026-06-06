// src/lib/ai/query-tools.ts — T8.1b Generalized Query Tools
//
// Read-only tools: getStand, searchStands, planSummary, queryOperations
// All tools return { success, result, error? } for the tool executor.
// All accept an authenticated supabase client to avoid creating their own.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";
import { serverMsg } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";

// ── Module-level constants (reused by searchStands and queryOperations) ──

const SPECIES_MAP: Record<string, string> = {
  mänty: "pine", pine: "pine",
  kuusi: "spruce", spruce: "spruce",
  rauduskoivu: "silver_birch", birch: "silver_birch", koivu: "silver_birch",
  hieskoivu: "downy_birch",
  lehtikuusi: "larch", larch: "larch",
  harmaaleppä: "grey_alder", alder: "grey_alder",
};

const SITE_MAP: Record<string, string> = {
  tuore: "tuore", mesic: "tuore",
  lehtomainen: "lehtomainen", "herb-rich": "lehtomainen", "herb-rich heath": "lehtomainen",
  kuivahko: "kuivahko", "sub-xeric": "kuivahko",
  kuiva: "kuiva", xeric: "kuiva",
};

// ── Helpers ──

/** Coerce a single value or array into an array (defensive: AI may send scalar) */
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Map user-facing stand field names to DB columns for SELECT */
const COMP_FIELD_TO_COL: Record<string, string> = {
  stand_id: "stand_id",
  species: "main_species",
  development_class: "development_class",
  site_type: "site_type",
  area_ha: "area_ha",
  age_years: "age_years",
  volume_m3: "volume_m3",
  basal_area: "basal_area",
  avg_height: "avg_height",
  avg_diameter: "avg_diameter",
  growth_m3_per_ha: "growth_m3_per_ha",
  soil_type: "soil_type",
  drainage_status: "drainage_status",
};

/** Build a .select() string from user-facing field names (stand-level) */
function buildCompSelect(fields?: string[]): string {
  if (!fields || fields.length === 0) return "*";
  const cols = fields.map(f => COMP_FIELD_TO_COL[f] ?? f);
  return cols.join(", ");
}

/** Format a stand result with optional field-level control */
const STAND_FIELD_FORMATTERS: Record<string, (s: Compartment) => string> = {
  stand_id: s => `Stand ${s.stand_id}`,
  species: s => `${s.main_species ?? "?"}`,
  development_class: s => `${s.development_class ?? "?"}`,
  site_type: s => `${s.site_type ?? "?"}`,
  area_ha: s => `${s.area_ha?.toFixed(1)} ha`,
  age_years: s => `${s.age_years ?? "?"} y`,
  volume_m3: s => `${s.volume_m3?.toFixed(0)} m³`,
  basal_area: s => `${s.basal_area?.toFixed(1)} m²/ha`,
  avg_height: s => `${s.avg_height?.toFixed(1)} m`,
  avg_diameter: s => `${s.avg_diameter?.toFixed(1)} cm`,
  growth_m3_per_ha: s => `${s.growth_m3_per_ha?.toFixed(1)} m³/ha/y`,
  soil_type: s => `${s.soil_type ?? "?"}`,
  drainage_status: s => `${s.drainage_status ?? "?"}`,
};

function formatStandResult(stands: Compartment[], fields?: string[]): string {
  if (stands.length === 0) return "No matching stands found.";
  const lines = stands.map(s => {
    const parts: string[] = [];
    if (!fields || fields.length === 0) {
      // Default: show key fields
      parts.push(`Stand ${s.stand_id}`);
      parts.push(`${s.main_species ?? "?"}, ${s.development_class ?? "?"}`);
      parts.push(`${s.area_ha?.toFixed(1)} ha, ${s.age_years ?? "?"} y, ${s.volume_m3?.toFixed(0)} m³`);
    } else {
      // Show only requested fields, in order
      for (const f of fields) {
        const formatter = STAND_FIELD_FORMATTERS[f];
        if (formatter) parts.push(formatter(s));
      }
    }
    return `  ${parts.join(", ")}`;
  });
  return `Found ${stands.length} stand(s):\n${lines.join("\n")}`;
}

// ── searchStands filter interface ──

export interface SearchStandsFilter {
  stand_ids?: string[];
  species?: string[];
  development_classes?: string[];
  site_types?: string[];
  age_min?: number;
  age_max?: number;
  area_min?: number;
  area_max?: number;
  volume_min?: number;
  volume_max?: number;
  basal_area_min?: number;
  basal_area_max?: number;
  height_min?: number;
  height_max?: number;
  diameter_min?: number;
  diameter_max?: number;
  growth_min?: number;
  growth_max?: number;
  fields?: string[];  // Also controls DB-level .select() — reduces payload
  limit?: number;     // Max results (default: 500, use 0 for no limit)
}

// ── get_stand ──

export async function getStand(
  supabase: SupabaseClient,
  forestId: string,
  standId: string,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  const { data, error } = await supabase
    .from("compartments")
    .select("*")
    .eq("forest_id", forestId)
    .eq("stand_id", standId)
    .single();

  if (error || !data) {
    return { success: false, result: "", error: `Stand ${standId} not found` };
  }

  const c = data as Compartment;
  const lines = [
    serverMsg("standDetail", language, c.stand_id),
    serverMsg("standArea", language, c.area_ha?.toFixed(1) ?? "?"),
    serverMsg("standDevClass", language, c.development_class ?? "N/A"),
    serverMsg("standMainSpecies", language, c.main_species ?? "N/A"),
    serverMsg("standSiteType", language, c.site_type ?? "N/A"),
    serverMsg("standAge", language, String(c.age_years ?? "?")),
    serverMsg("standVolume", language, c.volume_m3?.toFixed(0) ?? "?"),
    serverMsg("standBasalArea", language, c.basal_area?.toFixed(1) ?? "?"),
    serverMsg("standAvgHeight", language, c.avg_height?.toFixed(1) ?? "?"),
    serverMsg("standAvgDiameter", language, c.avg_diameter?.toFixed(1) ?? "?"),
    serverMsg("standGrowth", language, c.growth_m3_per_ha?.toFixed(1) ?? "?"),
  ];

  return { success: true, result: lines.join("\n") };
}

// ── search_stands (upgraded) ──

export async function searchStands(
  supabase: SupabaseClient,
  forestId: string,
  filters: SearchStandsFilter
): Promise<{ success: boolean; result: string; error?: string; data?: Record<string, unknown>[] }> {
  try {
    let query = supabase
      .from("compartments")
      .select(buildCompSelect(filters.fields))
      .eq("forest_id", forestId);

    // Apply array filters (DB-level with .in())
    const standIds = toArray(filters.stand_ids);
    if (standIds.length) {
      query = query.in("stand_id", standIds);
    }

    const species = toArray(filters.species);
    if (species.length) {
      const translated = species.map(s => {
        const key = s.toLowerCase();
        return SPECIES_MAP[key] ?? s; // passthrough if already Finnish
      });
      query = query.in("main_species", translated);
    }

    const devClasses = toArray(filters.development_classes);
    if (devClasses.length) {
      query = query.in("development_class", devClasses);
    }

    const siteTypes = toArray(filters.site_types);
    if (siteTypes.length) {
      const translated = siteTypes.map(s => {
        const key = s.toLowerCase();
        return SITE_MAP[key] ?? s;
      });
      query = query.in("site_type", translated);
    }

    // Apply numeric range filters
    if (filters.age_min !== undefined) query = query.gte("age_years", filters.age_min);
    if (filters.age_max !== undefined) query = query.lte("age_years", filters.age_max);
    if (filters.area_min !== undefined) query = query.gte("area_ha", filters.area_min);
    if (filters.area_max !== undefined) query = query.lte("area_ha", filters.area_max);
    if (filters.volume_min !== undefined) query = query.gte("volume_m3", filters.volume_min);
    if (filters.volume_max !== undefined) query = query.lte("volume_m3", filters.volume_max);
    if (filters.basal_area_min !== undefined) query = query.gte("basal_area", filters.basal_area_min);
    if (filters.basal_area_max !== undefined) query = query.lte("basal_area", filters.basal_area_max);
    if (filters.height_min !== undefined) query = query.gte("avg_height", filters.height_min);
    if (filters.height_max !== undefined) query = query.lte("avg_height", filters.height_max);
    if (filters.diameter_min !== undefined) query = query.gte("avg_diameter", filters.diameter_min);
    if (filters.diameter_max !== undefined) query = query.lte("avg_diameter", filters.diameter_max);
    if (filters.growth_min !== undefined) query = query.gte("growth_m3_per_ha", filters.growth_min);
    if (filters.growth_max !== undefined) query = query.lte("growth_m3_per_ha", filters.growth_max);

    // Apply limit (default 500, set 0 for unlimited, max 500 cap when explicit)
    const rawLimit = filters.limit;
    const effectiveLimit = rawLimit === 0 ? 100000 : Math.min(rawLimit ?? 500, 500);
    const { data, error } = await query.order("stand_id").limit(effectiveLimit);
    if (error) return { success: false, result: "", error: error.message };

    const stands = ((data as unknown) as Compartment[]) ?? [];
    // Summary mode: when >20 results, return a compact summary
    // (full results go to UI via show_in_ui SSE from the tool executor)
    if (stands.length > 20) {
      const totalArea = stands.reduce((s, c) => s + (c.area_ha ?? 0), 0);
      const totalVolume = stands.reduce((s, c) => s + (c.volume_m3 ?? 0), 0);
      const idList = stands.map(s => s.stand_id).join(", ");
      return {
        success: true,
        result: `Found ${stands.length} stands (total area: ${totalArea.toFixed(1)} ha, total volume: ${Math.round(totalVolume).toLocaleString()} m³). Stand IDs: ${idList}. Use show_stands to display these in the Stands tab.`,
        data: stands as unknown as Record<string, unknown>[],
      };
    }
    return { success: true, result: formatStandResult(stands, filters.fields), data: stands as unknown as Record<string, unknown>[] };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to search stands",
    };
  }
}

// ── plan_summary (unchanged) ──

export async function planSummary(
  supabase: SupabaseClient,
  forestId: string,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const { data: opsData } = await supabase
      .from("operations")
      .select("*")
      .eq("forest_id", forestId);
    const operations = (opsData as Operation[]) ?? [];

    const { data: compData } = await supabase
      .from("compartments")
      .select("area_ha, volume_m3, growth_m3_per_ha")
      .eq("forest_id", forestId);
    const compartments = (compData as Array<{ area_ha: number | null; volume_m3: number | null; growth_m3_per_ha: number | null }>) ?? [];

    const totalArea = compartments.reduce((s, c) => s + (c.area_ha ?? 0), 0);
    const totalVolume = compartments.reduce((s, c) => s + (c.volume_m3 ?? 0), 0);
    const annualGrowth = compartments.reduce((s, c) => s + ((c.growth_m3_per_ha ?? 0) * (c.area_ha ?? 0)), 0);

    const p1Ops = operations.filter((o) => o.year >= 2026 && o.year <= 2035);
    const p2Ops = operations.filter((o) => o.year >= 2036 && o.year <= 2045);
    const p1Income = p1Ops.reduce((s, o) => s + (o.income_eur ?? 0), 0);
    const p1Cost = p1Ops.reduce((s, o) => s + (o.cost_eur ?? 0), 0);
    const p2Income = p2Ops.reduce((s, o) => s + (o.income_eur ?? 0), 0);
    const p2Cost = p2Ops.reduce((s, o) => s + (o.cost_eur ?? 0), 0);

    const lines = [
      serverMsg("summaryTitle", language, totalArea.toFixed(1)),
      ``,
      serverMsg("planTotalVolume", language, Math.round(totalVolume).toLocaleString()),
      serverMsg("planAnnualGrowth", language, Math.round(annualGrowth).toLocaleString()),
      ``,
      serverMsg("planPeriod1", language, "2026", "2035"),
      serverMsg("summaryClearcuts", language, String(p1Ops.filter((o) => o.type === "clear_cut").length)),
      serverMsg("summaryThinnings", language, String(p1Ops.filter((o) => o.type === "thinning" || o.type === "first_thinning").length)),
      serverMsg("summaryRegen", language, String(p1Ops.filter((o) => o.type === "site_prep" || o.type === "planting").length)),
      serverMsg("summaryIncome", language, Math.round(p1Income).toLocaleString()),
      serverMsg("summaryCosts", language, Math.round(p1Cost).toLocaleString()),
      serverMsg("summaryNet", language, Math.round(p1Income - p1Cost).toLocaleString()),
      ``,
      serverMsg("planPeriod1", language, "2036", "2045"),
      serverMsg("summaryClearcuts", language, String(p2Ops.filter((o) => o.type === "clear_cut").length)),
      serverMsg("summaryThinnings", language, String(p2Ops.filter((o) => o.type === "thinning" || o.type === "first_thinning").length)),
      serverMsg("summaryIncome", language, Math.round(p2Income).toLocaleString()),
      serverMsg("summaryCosts", language, Math.round(p2Cost).toLocaleString()),
      serverMsg("summaryNet", language, Math.round(p2Income - p2Cost).toLocaleString()),
      ``,
      serverMsg("summaryTotalOps", language, String(operations.length)),
    ];

    return { success: true, result: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to get plan summary",
    };
  }
}

// ── query_operations ──

export interface QueryOperationsFilter {
  // Operation-level filters
  years?: number[];
  types?: string[];

  // Stand-level filters (JOINed with compartments)
  stand_ids?: string[];
  species?: string[];
  development_classes?: string[];
  site_types?: string[];

  // Numeric ranges (operation-level)
  income_min?: number;
  income_max?: number;
  removal_m3_min?: number;
  removal_m3_max?: number;
  removal_pct_min?: number;
  removal_pct_max?: number;
  cost_min?: number;
  cost_max?: number;

  // Numeric ranges (stand-level)
  stand_age_min?: number;
  stand_age_max?: number;
  stand_area_min?: number;
  stand_area_max?: number;

  // Field selection (controls both DB payload and text output)
  fields?: string[];
  limit?: number;     // Max results (default: 500, use 0 for no limit)
}

const OP_QUERY_FIELDS: Record<string, string> = {
  stand_id: "compartments.stand_id",
  species: "compartments.main_species",
  development_class: "compartments.development_class",
  site_type: "compartments.site_type",
  stand_area_ha: "compartments.area_ha",
  stand_age_years: "compartments.age_years",
  year: "year",
  type: "type",
  removal_pct: "removal_pct",
  income_eur: "income_eur",
  cost_eur: "cost_eur",
};

function buildOpSelect(fields?: string[]): string {
  if (!fields || fields.length === 0) return "*, compartments!inner(*)";

  const opCols = new Set<string>(["id"]);
  const compCols = new Set<string>([
    "stand_id", "main_species", "development_class", "site_type", "area_ha", "age_years",
  ]);

  for (const f of fields) {
    if (f === "removal_m3") {
      opCols.add("removal_pct");
      compCols.add("volume_m3");
      continue;
    }
    const qualified = OP_QUERY_FIELDS[f];
    if (!qualified) continue;
    if (qualified.startsWith("compartments.")) {
      compCols.add(qualified.replace("compartments.", ""));
    } else {
      opCols.add(qualified);
    }
  }

  return `${Array.from(opCols).join(", ")}, compartments!inner(${Array.from(compCols).join(", ")})`;
}

export async function queryOperations(
  supabase: SupabaseClient,
  forestId: string,
  filters: QueryOperationsFilter
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    // Step 1: Query operations with JOIN to compartments
    let query = supabase
      .from("operations")
      .select(buildOpSelect(filters.fields))
      .eq("forest_id", forestId);

    // Apply operation-level filters (applied at DB level via PostgREST)
    if (filters.years?.length) {
      query = query.in("year", filters.years);
    }
    if (filters.types?.length) {
      query = query.in("type", filters.types);
    }
    if (filters.income_min !== undefined) query = query.gte("income_eur", filters.income_min);
    if (filters.income_max !== undefined) query = query.lte("income_eur", filters.income_max);
    if (filters.removal_pct_min !== undefined) query = query.gte("removal_pct", filters.removal_pct_min);
    if (filters.removal_pct_max !== undefined) query = query.lte("removal_pct", filters.removal_pct_max);
    if (filters.cost_min !== undefined) query = query.gte("cost_eur", filters.cost_min);
    if (filters.cost_max !== undefined) query = query.lte("cost_eur", filters.cost_max);

    // Apply limit (default 500, set 0 for unlimited, max 500 cap when explicit)
    const rawLimit = filters.limit;
    const effectiveLimit = rawLimit === 0 ? 100000 : Math.min(rawLimit ?? 500, 500);
    const { data, error } = await query.order("year").order("type").limit(effectiveLimit);

    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      return { success: true, result: "No matching operations found." };
    }

    // Step 2: Post-filter on stand-level fields
    // (Supabase .in()/.gte()/.lte() on joined columns is unreliable with some PostgREST versions)
    let results = (data as unknown) as Array<Operation & { compartments: Compartment }>;

    if (filters.stand_ids?.length) {
      results = results.filter(r => filters.stand_ids!.includes(r.compartments.stand_id));
    }
    if (filters.species?.length) {
      const translated = filters.species.map(s => SPECIES_MAP[s.toLowerCase()] ?? s);
      results = results.filter(r => translated.includes(r.compartments.main_species ?? ""));
    }
    if (filters.development_classes?.length) {
      results = results.filter(r => filters.development_classes!.includes(r.compartments.development_class ?? ""));
    }
    if (filters.site_types?.length) {
      const translated = filters.site_types.map(s => SITE_MAP[s.toLowerCase()] ?? s);
      results = results.filter(r => translated.includes(r.compartments.site_type ?? ""));
    }
    if (filters.stand_age_min !== undefined) {
      results = results.filter(r => (r.compartments.age_years ?? 0) >= filters.stand_age_min!);
    }
    if (filters.stand_age_max !== undefined) {
      results = results.filter(r => (r.compartments.age_years ?? 0) <= filters.stand_age_max!);
    }
    if (filters.stand_area_min !== undefined) {
      results = results.filter(r => (r.compartments.area_ha ?? 0) >= filters.stand_area_min!);
    }
    if (filters.stand_area_max !== undefined) {
      results = results.filter(r => (r.compartments.area_ha ?? 0) <= filters.stand_area_max!);
    }

    // removal_m3 is computed, not stored — post-filter in JS
    if (filters.removal_m3_min !== undefined || filters.removal_m3_max !== undefined) {
      results = results.filter(r => {
        const vol = r.compartments.volume_m3 ?? 0;
        const pct = r.removal_pct ?? 0;
        const m3 = Math.round(vol * pct / 100);
        if (filters.removal_m3_min !== undefined && m3 < filters.removal_m3_min) return false;
        if (filters.removal_m3_max !== undefined && m3 > filters.removal_m3_max) return false;
        return true;
      });
    }

    if (results.length === 0) {
      return { success: true, result: "No matching operations found (filtered by stand criteria)." };
    }

    // Summary mode: when >20 results, return a compact summary
    if (results.length > 20) {
      const years = new Set(results.map(r => r.year));
      const types = new Set(results.map(r => r.type));
      const totalIncome = results.reduce((s, r) => s + (r.income_eur ?? 0), 0);
      const yearRange = years.size > 0
        ? `${Math.min(...years)}–${Math.max(...years)}`
        : "N/A";
      return {
        success: true,
        result: `Found ${results.length} operations across ${yearRange} (${types.size} types, total income: ${Math.round(totalIncome).toLocaleString()} €). Use show_operations to display these in the Operations tab.`,
      };
    }

    // Step 3: Format output with selected fields
    const lines = [`Found ${results.length} operation(s):`];
    for (const op of results) {
      const comp = op.compartments;
      const parts: string[] = [];

      if (!filters.fields || filters.fields.includes("stand_id")) {
        parts.push(`Stand ${comp.stand_id}`);
      }
      if (!filters.fields || filters.fields.includes("species")) {
        parts.push(`${comp.main_species ?? "?"}`);
      }
      if (!filters.fields || filters.fields.includes("development_class")) {
        parts.push(`${comp.development_class ?? "?"}`);
      }
      if (!filters.fields || filters.fields.includes("stand_area_ha")) {
        parts.push(`${(comp.area_ha ?? 0).toFixed(1)} ha`);
      }
      if (!filters.fields || filters.fields.includes("stand_age_years")) {
        parts.push(`${comp.age_years ?? "?"} y`);
      }

      // Build the operation part
      const opParts: string[] = [];
      if (!filters.fields || filters.fields.includes("year")) {
        opParts.push(`${op.year}`);
      }
      if (!filters.fields || filters.fields.includes("type")) {
        opParts.push(op.type);
      }
      if (!filters.fields || filters.fields.includes("removal_m3")) {
        const removalM3 = Math.round((comp.volume_m3 ?? 0) * (op.removal_pct ?? 0) / 100);
        const pctStr = op.removal_pct != null ? ` (${op.removal_pct}%)` : "";
        opParts.push(`removal ${removalM3} m³${pctStr}`);
      }
      if (!filters.fields || filters.fields.includes("income_eur")) {
        opParts.push(`income ${(op.income_eur ?? 0).toLocaleString()} €`);
      }
      if (!filters.fields || filters.fields.includes("cost_eur")) {
        opParts.push(`cost ${(op.cost_eur ?? 0).toLocaleString()} €`);
      }

      // Combine stand info and operation details
      const allParts = [...parts, ...opParts];
      lines.push(`  ${allParts.join(", ")}`);
    }

    return { success: true, result: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to query operations",
    };
  }
}