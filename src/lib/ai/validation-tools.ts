// src/lib/ai/validation-tools.ts — T8.3 Validation Tools
//
// Validation tools: check_harvest_sustainability, validate_plan
// All accept an authenticated supabase client to avoid creating their own.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";
import { serverMsg } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import {
  computeTapioAnnualGrowth,
} from "./tapio-growth";
import { estimateForestState, type CompartmentInput, type OperationInput } from "./forest-state";

// ── check_harvest_sustainability ──

export async function checkSustainability(
  supabase: SupabaseClient,
  forestId: string,
  year?: number,
  language: Language = "en",
  goal?: import("./types").PlanGoal,
): Promise<{ success: boolean; result: string; error?: string }> {
  // Goal-specific sustainability threshold multiplier
  const thresholdMultiplier = goal === "maximum_growth_aggressive" ? 3.0
    : goal === "maximum_growth_balanced" ? 1.25
    : goal === "carbon_storage" ? 0.5
    : 1.0; // balanced or undefined
  try {
    // Query compartments with all fields needed for state estimation
    const { data: compData } = await supabase
      .from("compartments")
      .select("id, stand_id, area_ha, volume_m3, site_type, soil_type, main_species, age_years, basal_area, development_class, stem_count_per_ha")
      .eq("forest_id", forestId);
    const compartments = (compData as CompartmentInput[]) ?? [];

    // Query operations
    let opsQuery = supabase.from("operations").select("*").eq("forest_id", forestId);
    if (year) opsQuery = opsQuery.eq("year", year);

    const { data: ops } = await opsQuery;
    const operations = (ops as Operation[]) ?? [];

    if (operations.length === 0) {
      // Compute current growth for the "no ops" message
      const currentGrowth = compartments.reduce((s, c) => {
        const area = c.area_ha ?? 0;
        if (area <= 0) return s;
        const stems = (c as unknown as { stem_count_per_ha: number | null }).stem_count_per_ha ?? 0;
        const gPerHa = stems > 0
          ? computeTapioAnnualGrowth(
              c.main_species ?? "pine", c.site_type ?? "mesic",
              c.age_years ?? 0, stems, 1.0,
            )
          : 0;
        return s + gPerHa * area;
      }, 0);
      return {
        success: true,
        result: year
          ? serverMsg("sustNoOpsYear", language, String(year), String(Math.round(currentGrowth)))
          : serverMsg("sustNoOps", language),
      };
    }

    // Determine year range for state projection
    const years = [...new Set(operations.map((o) => o.year))].sort((a, b) => a - b);
    const minYear = year ?? Math.min(...years);
    const maxYear = year ?? Math.max(...years);

    // Build operation inputs for state estimator (map DB Operation → OperationInput)
    const opInputs: OperationInput[] = operations.map((o) => ({
      compartment_id: o.compartment_id,
      year: o.year,
      type: o.type,
      removal_pct: o.removal_pct ?? 0,
    }));

    // Project forest state year by year
    const timeline = estimateForestState(compartments, opInputs, minYear, maxYear);

    // Aggregate per-year growth and harvest
    const yearData = new Map<number, { growthM3: number; harvestM3: number; incomeEur: number }>();
    for (const snapshots of timeline.values()) {
      for (const s of snapshots) {
        const yd = yearData.get(s.year) ?? { growthM3: 0, harvestM3: 0, incomeEur: 0 };
        yd.growthM3 += s.growthM3;
        yd.harvestM3 += s.harvestM3;
        yearData.set(s.year, yd);
      }
    }

    // Add income from operations (not covered by state estimator)
    for (const op of operations) {
      if (["clear_cut", "thinning", "first_thinning", "selection_cutting"].includes(op.type)) {
        const yd = yearData.get(op.year);
        if (yd) yd.incomeEur += op.income_eur ?? 0;
      }
    }

    // ── Build output ──

    const totalGrowth = [...yearData.values()].reduce((s, d) => s + d.growthM3, 0);
    const totalHarvestM3 = [...yearData.values()].reduce((s, d) => s + d.harvestM3, 0);
    const totalIncome = [...yearData.values()].reduce((s, d) => s + d.incomeEur, 0);
    const planYears = years.length || 1;

    // Use annual averages for full-period comparison
    const avgAnnualGrowth = year
      ? yearData.get(year)?.growthM3 ?? 0
      : planYears > 0 ? totalGrowth / planYears : 0;
    const avgAnnualHarvest = year
      ? yearData.get(year)?.harvestM3 ?? 0
      : planYears > 0 ? totalHarvestM3 / planYears : 0;

    const harvestVsGrowth = avgAnnualGrowth > 0
      ? ((avgAnnualHarvest / avgAnnualGrowth) * 100).toFixed(1)
      : "N/A";
    const isSustainable = avgAnnualGrowth > 0 && avgAnnualHarvest <= avgAnnualGrowth * thresholdMultiplier;

    // Find problematic years
    const badYears: string[] = [];
    for (const [yr, d] of yearData) {
      if (d.growthM3 > 0 && d.harvestM3 > d.growthM3 * thresholdMultiplier) {
        badYears.push(String(yr));
      }
    }

    const harvestOps = operations.filter((o) =>
      ["clear_cut", "thinning", "first_thinning", "selection_cutting"].includes(o.type)
    );

    const lines = [
      serverMsg("sustTitle", language),
      ``,
      year ? serverMsg("sustYear", language, String(year)) : serverMsg("sustPeriod", language),
      year
        ? serverMsg("sustGrowth", language, Math.round(avgAnnualGrowth).toLocaleString())
        : serverMsg("sustGrowthAvg", language, Math.round(avgAnnualGrowth).toLocaleString()),
      year
        ? serverMsg("sustHarvest", language, Math.round(avgAnnualHarvest).toLocaleString(), serverMsg("sustHarvestTotal", language))
        : serverMsg("sustHarvestAvg", language, Math.round(avgAnnualHarvest).toLocaleString()),
      serverMsg("sustVsGrowth", language, String(harvestVsGrowth)),
      serverMsg("sustOpCount", language, String(harvestOps.length)),
      serverMsg("sustIncome", language, Math.round(totalIncome).toLocaleString()),
    ];

    if (badYears.length > 0 && !year) {
      lines.push(``, serverMsg("sustBadYears", language, badYears.join(", ")));
    }

    lines.push(``, isSustainable
      ? serverMsg("sustSustainable", language)
      : serverMsg("sustExceeds", language));

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

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
  year?: number;
}

export async function validatePlan(
  supabase: SupabaseClient,
  forestId: string,
  language: Language = "en",
  goal?: import("./types").PlanGoal,
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const issues: ValidationIssue[] = [];
    const thresholdMultiplier = goal === "maximum_growth_aggressive" ? 3.0
      : goal === "maximum_growth_balanced" ? 1.25
      : goal === "carbon_storage" ? 0.5
      : 1.0;

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

    // ── Build lookup maps ──
    const compMap = new Map<string, Compartment>();
    for (const c of compartments) compMap.set(c.id, c);

    // Check 1: Operations reference valid compartments
    for (const op of operations) {
      if (!compMap.has(op.compartment_id)) {
        issues.push({
          severity: "error",
          message: serverMsg("valMissingComp", language, op.compartment_id, String(op.year)),
          year: op.year,
        });
      }
    }

    // Check 2: Thinning interval ≥ 10 years per stand
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
    const clearcuts = operations.filter((o) => o.type === "clear_cut");
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

    // Check 4: Annual harvest vs growth using state estimator
    const years = [...new Set(operations.map((o) => o.year))].sort((a, b) => a - b);
    if (years.length > 0) {
      const opInputs: OperationInput[] = operations.map((o) => ({
        compartment_id: o.compartment_id,
        year: o.year,
        type: o.type,
        removal_pct: o.removal_pct ?? 0,
      }));

      const compInputs: CompartmentInput[] = compartments.map((c) => ({
        id: c.id,
        stand_id: c.stand_id,
        area_ha: c.area_ha,
        site_type: c.site_type,
        soil_type: c.soil_type,
        main_species: c.main_species,
        age_years: c.age_years,
        volume_m3: c.volume_m3,
        basal_area: c.basal_area,
        development_class: c.development_class,
      }));

      const timeline = estimateForestState(compInputs, opInputs, years[0], years[years.length - 1]);

      const yearGrowth = new Map<number, number>();
      const yearHarvest = new Map<number, number>();
      for (const snapshots of timeline.values()) {
        for (const s of snapshots) {
          yearGrowth.set(s.year, (yearGrowth.get(s.year) ?? 0) + s.growthM3);
          yearHarvest.set(s.year, (yearHarvest.get(s.year) ?? 0) + s.harvestM3);
        }
      }

      for (const yr of years) {
        const growth = yearGrowth.get(yr) ?? 0;
        const harvest = yearHarvest.get(yr) ?? 0;
        if (growth > 0 && harvest > growth * thresholdMultiplier) {
          issues.push({
            severity: "warning",
            message: serverMsg("valHarvestExceeds", language, String(yr),
              String(Math.round(harvest)), String(Math.round(growth))),
            year: yr,
          });
        }
      }
    }

    // Check 5: No duplicates
    const seen = new Set<string>();
    for (const op of operations) {
      const key = `${op.compartment_id}:${op.year}:${op.type}`;
      if (seen.has(key)) {
        issues.push({
          severity: "error",
          message: serverMsg("valDuplicate", language, op.type, compMap.get(op.compartment_id)?.stand_id ?? "", String(op.year)),
          year: op.year,
        });
      }
      seen.add(key);
    }

    // ── Build result ──
    if (issues.length === 0) {
      return { success: true, result: serverMsg("valPassed", language) };
    }

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    const lines = [serverMsg("valTitle", language), ``];
    if (errors.length > 0) {
      lines.push(serverMsg("valErrors", language, String(errors.length)));
      for (const e of errors) lines.push(`  ❌ ${e.message}`);
      lines.push(``);
    }
    if (warnings.length > 0) {
      lines.push(serverMsg("valWarnings", language, String(warnings.length)));
      for (const w of warnings) lines.push(`  ⚠️ ${w.message}`);
    }

    return { success: true, result: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to validate plan",
    };
  }
}
