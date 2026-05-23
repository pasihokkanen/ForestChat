// src/lib/ai/validation-tools.ts — T8.3 Validation Tools
//
// Validation tools: check_harvest_sustainability, validate_plan
// check_harvest_sustainability: compares harvest volume against annual growth
// validate_plan: full validation with 6 checks

import type { Compartment, Operation, PlanMetadata } from "@/types/database";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompartmentsByForest } from "@/lib/repos/compartments";
import { getOperationsByForest } from "@/lib/repos/operations";
import { getPlanMetadataByForest } from "@/lib/repos/plan-metadata";

// ── check_harvest_sustainability ──

export async function checkSustainability(
  forestId: string,
  year?: number
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const supabase = await createServerSupabase();

    // Get plan metadata for annual growth
    const metadata = await getPlanMetadataByForest(forestId);
    const annualGrowth = metadata?.annual_growth_m3 ?? 0;

    // Fall back to compartment-level growth if no plan metadata
    let growthRate = annualGrowth;
    if (growthRate === 0) {
      const compartments = await getCompartmentsByForest(forestId);
      growthRate = compartments.reduce(
        (s, c) => s + ((c.growth_m3_per_ha ?? 0) * (c.area_ha ?? 0)),
        0
      );
    }

    // Get operations
    let opsQuery = supabase.from("operations").select("*").eq("forest_id", forestId);
    if (year) opsQuery = opsQuery.eq("year", year);

    const { data: ops } = await opsQuery;
    const operations = (ops as Operation[]) ?? [];

    if (operations.length === 0) {
      return {
        success: true,
        result: year
          ? `No operations planned for ${year}. Harvest volume: 0 m³. Annual growth: ${Math.round(growthRate)} m³/v. No sustainability concerns.`
          : "No operations in plan. Nothing to check.",
      };
    }

    // Calculate harvest volume (use removal_pct * volume from compartments)
    const standIds = [...new Set(operations.map((o) => o.compartment_id))];
    const { data: compartments } = await supabase
      .from("compartments")
      .select("id, volume_m3, stand_id")
      .in("id", standIds);

    const compMap = new Map<string, { volume_m3: number | null; stand_id: string }>();
    for (const c of (compartments ?? []) as Array<{ id: string; volume_m3: number | null; stand_id: string }>) {
      compMap.set(c.id, c);
    }

    let totalHarvestM3 = 0;
    let totalIncome = 0;
    const harvestOps = operations.filter((o) =>
      ["Päätehakkuu", "Harvennus", "Ensiharvennus", "Poimintahakkuu"].includes(o.type)
    );

    for (const op of harvestOps) {
      const comp = compMap.get(op.compartment_id);
      const volume = comp?.volume_m3 ?? 0;
      const removalFraction = (op.removal_pct ?? 0) / 100;
      totalHarvestM3 += volume * removalFraction;
      totalIncome += op.income_eur ?? 0;
    }

    const harvestVsGrowth = growthRate > 0
      ? ((totalHarvestM3 / growthRate) * 100).toFixed(1)
      : "N/A";

    const isSustainable = growthRate > 0 && totalHarvestM3 <= growthRate;

    const lines = [
      `📊 Harvest Sustainability Check`,
      ``,
      year
        ? `Year: ${year}`
        : `Period: all planned years`,
      `Annual growth: ${Math.round(growthRate).toLocaleString()} m³/v`,
      `Total harvest: ${Math.round(totalHarvestM3).toLocaleString()} m³${year ? "" : " (total)"}`,
      `Harvest vs growth: ${harvestVsGrowth}%`,
      `Harvest operations: ${harvestOps.length}`,
      ...(year ? [] : [`Average annual harvest: ${Math.round(totalHarvestM3 / 20)} m³/v (over 20-year plan)`]),
      `Total income from harvest: ${Math.round(totalIncome).toLocaleString()} €`,
      ``,
      isSustainable
        ? `✅ Harvest is within sustainable limits (harvest ≤ annual growth).`
        : `⚠️ Harvest exceeds annual growth! Consider reducing harvest volume.`,
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
  forestId: string
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const issues: ValidationIssue[] = [];
    const compartments = await getCompartmentsByForest(forestId);
    const operations = await getOperationsByForest(forestId);
    const metadata = await getPlanMetadataByForest(forestId);

    if (operations.length === 0) {
      return { success: true, result: "No operations in plan. Generate a plan first." };
    }

    // Build compartment lookup
    const compMap = new Map<string, Compartment>();
    for (const c of compartments) {
      compMap.set(c.id, c);
    }

    const currentYear = new Date().getFullYear();

    // ── Check 1: No clearcuts on non-regeneration-ready stands ──
    const regenReadyClasses = ["Uudistuskypsä metsikkö", "Siemenpuumetsikkö"];
    const clearcuts = operations.filter((o) => o.type === "Päätehakkuu");
    for (const op of clearcuts) {
      const comp = compMap.get(op.compartment_id);
      if (comp && !regenReadyClasses.some((c) => comp.development_class?.includes(c))) {
        issues.push({
          severity: "error",
          message: `Clearcut on stand ${comp.stand_id} (${comp.development_class}) which is not regeneration-ready.`,
          standId: comp.stand_id,
          year: op.year,
        });
      }
    }

    // ── Check 2: No thinnings within 10 years of previous thinning ──
    const thinnings = operations
      .filter((o) => o.type === "Harvennus" || o.type === "Ensiharvennus")
      .sort((a, b) => a.year - b.year);

    for (let i = 1; i < thinnings.length; i++) {
      const prev = thinnings[i - 1];
      const curr = thinnings[i];
      if (prev.compartment_id === curr.compartment_id && (curr.year - prev.year) < 10) {
        const comp = compMap.get(curr.compartment_id);
        issues.push({
          severity: "error",
          message: `Stand ${comp?.stand_id ?? curr.compartment_id} thinned in ${prev.year} and again in ${curr.year} (< 10 year interval).`,
          standId: comp?.stand_id,
          year: curr.year,
        });
      }
    }

    // ── Check 3: Regeneration chain follows each clearcut ──
    const regenTypes = [
      "Laikkumätästys", "Ojitusmätästys", "Laikutus",
      "Istutus", "Kuusen istutus", "Männyn istutus",
      "Site_prep", "Planting",
    ];

    for (const op of clearcuts) {
      const hasFollowUp = operations.some(
        (o) =>
          o.compartment_id === op.compartment_id &&
          regenTypes.includes(o.type) &&
          (o.year === op.year || o.year === op.year + 1)
      );
      if (!hasFollowUp) {
        const comp = compMap.get(op.compartment_id);
        issues.push({
          severity: "warning",
          message: `Stand ${comp?.stand_id ?? op.compartment_id} has a clearcut in ${op.year} but no regeneration chain (site prep + planting) following it.`,
          standId: comp?.stand_id,
          year: op.year,
        });
      }
    }

    // ── Check 4: Annual harvest doesn't exceed annual growth ──
    const annualGrowth = metadata?.annual_growth_m3 ??
      compartments.reduce((s, c) => s + ((c.growth_m3_per_ha ?? 0) * (c.area_ha ?? 0)), 0);

    // Group harvest by year
    const harvestByYear = new Map<number, number>();
    for (const op of operations) {
      if (["Päätehakkuu", "Harvennus", "Ensiharvennus", "Poimintahakkuu"].includes(op.type)) {
        const comp = compMap.get(op.compartment_id);
        const volume = (comp?.volume_m3 ?? 0) * ((op.removal_pct ?? 0) / 100);
        harvestByYear.set(op.year, (harvestByYear.get(op.year) ?? 0) + volume);
      }
    }

    if (annualGrowth > 0) {
      for (const [yr, harvest] of harvestByYear) {
        if (harvest > annualGrowth) {
          issues.push({
            severity: "warning",
            message: `Year ${yr}: harvest ${Math.round(harvest).toLocaleString()} m³ exceeds annual growth ${Math.round(annualGrowth).toLocaleString()} m³.`,
            year: yr,
          });
        }
      }
    }

    // ── Check 5: No duplicate operations on same stand+year ──
    const seen = new Set<string>();
    for (const op of operations) {
      const key = `${op.compartment_id}:${op.year}:${op.type}`;
      if (seen.has(key)) {
        const comp = compMap.get(op.compartment_id);
        issues.push({
          severity: "error",
          message: `Duplicate operation: ${op.type} on stand ${comp?.stand_id ?? op.compartment_id} in ${op.year}.`,
          standId: comp?.stand_id,
          year: op.year,
        });
      }
      seen.add(key);
    }

    // ── Check 6: Operations have valid years (within plan period) ──
    const planStart = metadata?.period_start ?? currentYear;
    const planEnd = metadata?.period_end ?? currentYear + 20;
    for (const op of operations) {
      if (op.year < currentYear) {
        const comp = compMap.get(op.compartment_id);
        issues.push({
          severity: "error",
          message: `${op.type} on stand ${comp?.stand_id ?? op.compartment_id} in ${op.year} is in the past.`,
          standId: comp?.stand_id,
          year: op.year,
        });
      }
      if (op.year < planStart || op.year > planEnd) {
        const comp = compMap.get(op.compartment_id);
        issues.push({
          severity: "warning",
          message: `${op.type} on stand ${comp?.stand_id ?? op.compartment_id} in ${op.year} is outside the plan period (${planStart}-${planEnd}).`,
          standId: comp?.stand_id,
          year: op.year,
        });
      }
    }

    // ── Build report ──
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    if (issues.length === 0) {
      return {
        success: true,
        result: "✅ Plan validation passed! All checks OK. The plan looks good.",
      };
    }

    const lines = [
      `📋 Plan Validation Report`,
      `Total operations: ${operations.length}`,
      `Total compartments: ${compartments.length}`,
      ``,
      `Issues found: ${errors.length} error(s), ${warnings.length} warning(s)`,
    ];

    if (errors.length > 0) {
      lines.push(`\n❌ Errors (${errors.length}):`);
      for (const issue of errors) {
        lines.push(`  • ${issue.message}`);
      }
    }

    if (warnings.length > 0) {
      lines.push(`\n⚠️ Warnings (${warnings.length}):`);
      for (const issue of warnings) {
        lines.push(`  • ${issue.message}`);
      }
    }

    if (errors.length > 0) {
      lines.push(`\n❌ Plan has errors that need fixing before it can be used.`);
    } else if (warnings.length > 0) {
      lines.push(`\n⚠️ Plan has warnings (recommendations for improvement) but no critical errors.`);
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