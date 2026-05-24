// src/lib/ai/validation-tools.ts — T8.3 Validation Tools
//
// Validation tools: check_harvest_sustainability, validate_plan
// All accept an authenticated supabase client to avoid creating their own.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, Operation } from "@/types/database";

// ── check_harvest_sustainability ──

export async function checkSustainability(
  supabase: SupabaseClient,
  forestId: string,
  year?: number
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    // Get growth rate from compartments
    const { data: compData } = await supabase
      .from("compartments")
      .select("volume_m3, area_ha, growth_m3_per_ha")
      .eq("forest_id", forestId);
    const compartments = (compData as Array<{ volume_m3: number | null; area_ha: number | null; growth_m3_per_ha: number | null }>) ?? [];

    const growthRate = compartments.reduce(
      (s, c) => s + ((c.growth_m3_per_ha ?? 0) * (c.area_ha ?? 0)), 0
    );

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
      ["Päätehakkuu", "Harvennus", "Ensiharvennus", "Poimintahakkuu"].includes(o.type)
    );

    for (const op of harvestOps) {
      const comp = compMap.get(op.compartment_id);
      const volume = comp?.volume_m3 ?? 0;
      totalHarvestM3 += volume * ((op.removal_pct ?? 0) / 100);
      totalIncome += op.income_eur ?? 0;
    }

    const harvestVsGrowth = growthRate > 0
      ? ((totalHarvestM3 / growthRate) * 100).toFixed(1)
      : "N/A";

    const lines = [
      `📊 Harvest Sustainability Check`,
      ``,
      year ? `Year: ${year}` : `Period: all planned years`,
      `Annual growth: ${Math.round(growthRate).toLocaleString()} m³/v`,
      `Total harvest: ${Math.round(totalHarvestM3).toLocaleString()} m³${year ? "" : " (total)"}`,
      `Harvest vs growth: ${harvestVsGrowth}%`,
      `Harvest operations: ${harvestOps.length}`,
      `Total income from harvest: ${Math.round(totalIncome).toLocaleString()} €`,
      ``,
      growthRate > 0 && totalHarvestM3 <= growthRate
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
  supabase: SupabaseClient,
  forestId: string
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
      return { success: true, result: "No operations in plan. Generate a plan first." };
    }

    const compMap = new Map<string, Compartment>();
    for (const c of compartments) compMap.set(c.id, c);

    const currentYear = new Date().getFullYear();

    // Check 1: No clearcuts on non-regeneration-ready stands (Period 1 only — P2 is forward-looking)
    const clearcuts = operations.filter((o) => o.type === "Päätehakkuu");
    for (const op of clearcuts) {
      const comp = compMap.get(op.compartment_id);
      // Only flag P1 clearcuts — P2 clearcuts are projected based on future maturity
      if (comp && comp.development_class !== "regeneration_ready" && op.year <= new Date().getFullYear() + 5) {
        issues.push({
          severity: "error",
          message: `Clearcut on stand ${comp.stand_id} (${comp.development_class}) which is not regeneration-ready.`,
          standId: comp.stand_id, year: op.year,
        });
      }
    }

    // Check 2: No thinnings within 10 years
    const thinnings = operations
      .filter((o) => o.type === "Harvennus" || o.type === "Ensiharvennus")
      .sort((a, b) => a.year - b.year);
    for (let i = 1; i < thinnings.length; i++) {
      if (thinnings[i - 1].compartment_id === thinnings[i].compartment_id &&
          (thinnings[i].year - thinnings[i - 1].year) < 10) {
        issues.push({
          severity: "error",
          message: `Stand ${compMap.get(thinnings[i].compartment_id)?.stand_id ?? ""} thinned in ${thinnings[i - 1].year} and again in ${thinnings[i].year} (< 10 year interval).`,
          year: thinnings[i].year,
        });
      }
    }

    // Check 3: Regeneration chain follows clearcuts
    const regenTypes = ["Laikkumätästys", "Ojitusmätästys", "Laikutus", "Kuusen istutus", "Männyn istutus"];
    for (const op of clearcuts) {
      const hasFollowUp = operations.some(
        (o) => o.compartment_id === op.compartment_id &&
              regenTypes.includes(o.type) &&
              (o.year === op.year || o.year === op.year + 1)
      );
      if (!hasFollowUp) {
        issues.push({
          severity: "warning",
          message: `Stand ${compMap.get(op.compartment_id)?.stand_id ?? ""} clearcut in ${op.year} but no regeneration chain follows.`,
          year: op.year,
        });
      }
    }

    // Check 4: Annual harvest vs growth
    const annualGrowth = compartments.reduce((s, c) => s + ((c.growth_m3_per_ha ?? 0) * (c.area_ha ?? 0)), 0);
    const harvestByYear = new Map<number, number>();
    for (const op of operations) {
      if (["Päätehakkuu", "Harvennus", "Ensiharvennus"].includes(op.type)) {
        const vol = (compMap.get(op.compartment_id)?.volume_m3 ?? 0) * ((op.removal_pct ?? 0) / 100);
        harvestByYear.set(op.year, (harvestByYear.get(op.year) ?? 0) + vol);
      }
    }
    if (annualGrowth > 0) {
      for (const [yr, harvest] of harvestByYear) {
        if (harvest > annualGrowth) {
          issues.push({ severity: "warning", message: `Year ${yr}: harvest ${Math.round(harvest)} m³ exceeds growth ${Math.round(annualGrowth)} m³.`, year: yr });
        }
      }
    }

    // Check 5: No duplicates
    const seen = new Set<string>();
    for (const op of operations) {
      const key = `${op.compartment_id}:${op.year}:${op.type}`;
      if (seen.has(key)) {
        issues.push({ severity: "error", message: `Duplicate: ${op.type} on stand ${compMap.get(op.compartment_id)?.stand_id ?? ""} in ${op.year}.`, year: op.year });
      }
      seen.add(key);
    }

    // Check 6: Valid years
    for (const op of operations) {
      if (op.year < currentYear) {
        issues.push({ severity: "error", message: `${op.type} on stand ${compMap.get(op.compartment_id)?.stand_id ?? ""} in ${op.year} is in the past.`, year: op.year });
      }
    }

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    const planPassed = errors.length === 0;

    if (issues.length === 0) {
      return { success: true, result: "✅ Plan validation passed! All checks OK." };
    }

    return {
      success: true,
      result: [
        `📋 Plan Validation Report`,
        `Operations: ${operations.length} | Compartments: ${compartments.length}`,
        ``,
        `Issues: ${errors.length} error(s), ${warnings.length} warning(s)`,
        ...(errors.length ? [`\n❌ Errors:`, ...errors.map((e) => `  • ${e.message}`)] : []),
        ...(warnings.length ? [`\n⚠️ Warnings:`, ...warnings.map((w) => `  • ${w.message}`)] : []),
        ``,
        planPassed ? "✅ Plan is valid (no critical errors)." : "❌ Plan has critical errors. Fix before using.",
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