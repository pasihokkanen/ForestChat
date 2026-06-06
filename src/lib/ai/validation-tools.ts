// src/lib/ai/validation-tools.ts — T8.3 Validation Tools
//
// Validation tools: check_harvest_sustainability, validate_plan
// All accept an authenticated supabase client to avoid creating their own.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";
import { serverMsg } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import {
  getGrowthRate,
} from "./chart-engine";

// ── check_harvest_sustainability ──

export async function checkSustainability(
  supabase: SupabaseClient,
  forestId: string,
  year?: number,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    // Get compartment attributes needed for growth computation.
    // Uses getGrowthRate() (VMI13 base × species × age × density multipliers),
    // the same function the chart engine uses for growth_m3_per_ha.
    const { data: compData } = await supabase
      .from("compartments")
      .select("volume_m3, area_ha, site_type, soil_type, drainage_status, main_species, age_years, basal_area, development_class")
      .eq("forest_id", forestId);
    const compartments = (compData as Array<{
      volume_m3: number | null;
      area_ha: number | null;
      site_type: string | null;
      soil_type: string | null;
      drainage_status: string | null;
      main_species: string | null;
      age_years: number | null;
      basal_area: number | null;
      development_class: string | null;
    }>) ?? [];

    // Compute annual growth (m³/y) using chart-engine's growth function
    const growthRate = compartments.reduce((s, c) => {
      const area = c.area_ha ?? 0;
      if (area <= 0) return s;
      const grPerHa = getGrowthRate(
        c.site_type ?? "",
        c.soil_type ?? "",
        c.main_species ?? "",
        c.age_years,
        c.basal_area,
        c.development_class,
      );
      return s + grPerHa * area;
    }, 0);

    let opsQuery = supabase.from("operations").select("*").eq("forest_id", forestId);
    if (year) opsQuery = opsQuery.eq("year", year);

    const { data: ops } = await opsQuery;
    const operations = (ops as Operation[]) ?? [];

    if (operations.length === 0) {
      return {
        success: true,
        result: year
          ? serverMsg("sustNoOpsYear", language, String(year), String(Math.round(growthRate)))
          : serverMsg("sustNoOps", language),
      };
    }

    const standIds = [...new Set(operations.map((o) => o.compartment_id))];
    const { data: comps } = await supabase
      .from("compartments")
      .select("id, volume_m3, stand_id")
      .in("id", standIds);

    const compMap = new Map<string, { volume_m3: number | null; stand_id: string }>();
    for (const c of (comps ?? []) as Array<{ id: string; volume_m3: number | null; stand_id: string }>) {
      compMap.set(c.id, c);
    }

    let totalHarvestM3 = 0;
    let totalIncome = 0;
    const harvestOps = operations.filter((o) =>
      ["clear_cut", "thinning", "first_thinning", "selection_cutting"].includes(o.type)
    );

    for (const op of harvestOps) {
      const comp = compMap.get(op.compartment_id);
      const volume = comp?.volume_m3 ?? 0;
      totalHarvestM3 += volume * ((op.removal_pct ?? 0) / 100);
      totalIncome += op.income_eur ?? 0;
    }

    // When checking over the entire period (no specific year), compare
    // average annual harvest against annual growth, not total vs annual.
    let avgAnnualHarvest = totalHarvestM3;
    if (!year) {
      const years = [...new Set(operations.map((o) => o.year))];
      const planYears = years.length || 1;
      avgAnnualHarvest = totalHarvestM3 / planYears;
    }

    const harvestVsGrowth = growthRate > 0
      ? ((avgAnnualHarvest / growthRate) * 100).toFixed(1)
      : "N/A";

    const growthRounded = Math.round(growthRate).toLocaleString();
    const harvestRounded = Math.round(totalHarvestM3).toLocaleString();
    const avgHarvestRounded = Math.round(avgAnnualHarvest).toLocaleString();
    const incomeRounded = Math.round(totalIncome).toLocaleString();
    const isSustainable = growthRate > 0 && avgAnnualHarvest <= growthRate;

    const lines = [
      serverMsg("sustTitle", language),
      ``,
      year ? serverMsg("sustYear", language, String(year)) : serverMsg("sustPeriod", language),
      serverMsg("sustGrowth", language, growthRounded),
      year
        ? serverMsg("sustHarvest", language, harvestRounded, serverMsg("sustHarvestTotal", language))
        : serverMsg("sustHarvestAvg", language, avgHarvestRounded),
      serverMsg("sustVsGrowth", language, String(harvestVsGrowth)),
      serverMsg("sustOpCount", language, String(harvestOps.length)),
      serverMsg("sustIncome", language, incomeRounded),
      ``,
      isSustainable
        ? serverMsg("sustSustainable", language)
        : serverMsg("sustExceeds", language),
    ];

    return { success: true, result: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to check sustainability",
    };
  }
}

// ── validate_plan ──

interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  standId?: string;
  year?: number;
}

export async function validatePlan(
  supabase: SupabaseClient,
  forestId: string,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const issues: ValidationIssue[] = [];

    const { data: compData } = await supabase
      .from("compartments")
      .select("*")
      .eq("forest_id", forestId);
    const compartments = (compData as Compartment[]) ?? [];

    const { data: opsData } = await supabase
      .from("operations")
      .select("*")
      .eq("forest_id", forestId)
      .order("year", { ascending: true });
    const operations = (opsData as Operation[]) ?? [];

    if (operations.length === 0) {
      return { success: true, result: serverMsg("valNoOps", language) };
    }

    const compMap = new Map<string, Compartment>();
    for (const c of compartments) compMap.set(c.id, c);

    const currentYear = new Date().getFullYear();

    // Check 1: No clearcuts on non-regeneration-ready stands (Period 1 only — P2 is forward-looking)
    const clearcuts = operations.filter((o) => o.type === "clear_cut");
    for (const op of clearcuts) {
      const comp = compMap.get(op.compartment_id);
      // Only flag P1 clearcuts — P2 clearcuts are projected based on future maturity
      if (comp && comp.development_class !== "regeneration_ready" && op.year <= new Date().getFullYear() + 5) {
        issues.push({
          severity: "error",
          message: serverMsg("valClearcutBadStand", language, comp.stand_id, comp.development_class ?? "?"),
          standId: comp.stand_id, year: op.year,
        });
      }
    }

    // Check 2: No thinnings within 10 years
    const thinnings = operations
      .filter((o) => o.type === "thinning" || o.type === "first_thinning")
      .sort((a, b) => a.year - b.year);
    for (let i = 1; i < thinnings.length; i++) {
      if (thinnings[i - 1].compartment_id === thinnings[i].compartment_id &&
          (thinnings[i].year - thinnings[i - 1].year) < 10) {
        issues.push({
          severity: "error",
          message: serverMsg("valThinInterval", language,
            compMap.get(thinnings[i].compartment_id)?.stand_id ?? "",
            String(thinnings[i - 1].year), String(thinnings[i].year)),
          year: thinnings[i].year,
        });
      }
    }

    // Check 3: Regeneration chain follows clearcuts
    const regenTypes = ["site_prep", "ditch_mounding", "scalping", "spruce_planting", "pine_planting"];
    for (const op of clearcuts) {
      const hasFollowUp = operations.some(
        (o) => o.compartment_id === op.compartment_id &&
              regenTypes.includes(o.type) &&
              (o.year === op.year || o.year === op.year + 1)
      );
      if (!hasFollowUp) {
        issues.push({
          severity: "warning",
          message: serverMsg("valNoRegen", language,
            compMap.get(op.compartment_id)?.stand_id ?? "", String(op.year)),
          year: op.year,
        });
      }
    }

    // Check 4: Annual harvest vs growth (using chart-engine's VMI13 growth function)
    const annualGrowth = compartments.reduce((s, c) => {
      const area = c.area_ha ?? 0;
      if (area <= 0) return s;
      const grPerHa = getGrowthRate(
        c.site_type ?? "",
        c.soil_type ?? "",
        c.main_species ?? "",
        c.age_years,
        c.basal_area,
        c.development_class ?? null,
      );
      return s + grPerHa * area;
    }, 0);
    const harvestByYear = new Map<number, number>();
    for (const op of operations) {
      if (["clear_cut", "thinning", "first_thinning"].includes(op.type)) {
        const vol = (compMap.get(op.compartment_id)?.volume_m3 ?? 0) * ((op.removal_pct ?? 0) / 100);
        harvestByYear.set(op.year, (harvestByYear.get(op.year) ?? 0) + vol);
      }
    }
    if (annualGrowth > 0) {
      for (const [yr, harvest] of harvestByYear) {
        if (harvest > annualGrowth) {
          issues.push({ severity: "warning", message: serverMsg("valHarvestExceeds", language, String(yr), String(Math.round(harvest)), String(Math.round(annualGrowth))), year: yr });
        }
      }
    }

    // Check 5: No duplicates
    const seen = new Set<string>();
    for (const op of operations) {
      const key = `${op.compartment_id}:${op.year}:${op.type}`;
      if (seen.has(key)) {
        issues.push({ severity: "error", message: serverMsg("valDuplicate", language, op.type, compMap.get(op.compartment_id)?.stand_id ?? "", String(op.year)), year: op.year });
      }
      seen.add(key);
    }

    // Check 6: Valid years
    for (const op of operations) {
      if (op.year < currentYear) {
        issues.push({ severity: "error", message: serverMsg("valPastYear", language, op.type, compMap.get(op.compartment_id)?.stand_id ?? "", String(op.year)), year: op.year });
      }
    }

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    const planPassed = errors.length === 0;

    if (issues.length === 0) {
      return { success: true, result: serverMsg("valPassed", language) };
    }

    return {
      success: true,
      result: [
        serverMsg("valTitle", language),
        serverMsg("valStats", language, String(operations.length), String(compartments.length)),
        ``,
        serverMsg("valIssues", language, String(errors.length), String(warnings.length)),
        ...(errors.length ? [`\n${serverMsg("valErrors", language)}`, ...errors.map((e) => `  • ${e.message}`)] : []),
        ...(warnings.length ? [`\n${serverMsg("valWarnings", language)}`, ...warnings.map((w) => `  • ${w.message}`)] : []),
        ``,
        planPassed ? serverMsg("valValid", language) : serverMsg("valInvalid", language),
      ].join("\n"),
    };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to validate plan",
    };
  }
}