// src/lib/ai/generate-plan.ts
// Phase 7b rewrite: Plan generation orchestrator.
//
// Fetches compartments, enriches them to StandData, delegates to the
// year-by-year scheduling engine, and saves results to the database.
// No static operation pool — all operations are spawned dynamically.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment, CompartmentSpecies } from "@/types/database";
import type { StandData, SpeciesDatum, PlanGoal } from "./types";
import { schedulePlan } from "./schedule";
import { serverMsg } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { getPricesForRegion } from "./price-fetcher";
import { classifySite, detectPeatland, PRICES, getRemovalPct } from "./config";
import { computeTapioAnnualGrowth } from "./tapio-growth";

interface GeneratePlanArgs {
  periodYears?: number;
  startYear?: number;
  goal?: PlanGoal;
}

// ═══════════════════════════════════════════════════════════════════════
// Compartment → StandData enrichment
// ═══════════════════════════════════════════════════════════════════════

interface RawSpecies {
  species: string;
  m3: number;
  log_pct: number;
}

function getSpeciesData(c: Compartment): RawSpecies[] {
  const attrs = c.attributes;
  if (attrs && Array.isArray((attrs as Record<string, unknown>)["species"])) {
    return (attrs as Record<string, unknown>)["species"] as RawSpecies[];
  }
  return [];
}

/**
 * Compute stumpage value for a stand using species breakdown if available,
 * otherwise using the main species aggregate.
 */
function computeStandValue(
  stand: StandData,
  species: RawSpecies[],
  prices?: Record<string, Record<string, { tukki: number; kuitu: number }>>,
): { valueEur: number; logM3: number; pulpM3: number } {
  const tier = "clear_cut";
  let totalValue = 0;
  let totalLog = 0;
  let totalPulp = 0;

  if (species.length > 0) {
    for (const sp of species) {
      const spKey = sp.species === "birch" ? "silver_birch" : sp.species;
      const spPrices = prices?.[tier]?.[spKey]
        ?? PRICES[tier]?.[spKey]
        ?? PRICES[tier]?.pine
        ?? { tukki: 70, kuitu: 20 };
      const logM3 = sp.m3 * sp.log_pct / 100;
      const pulpM3 = sp.m3 - logM3;
      totalLog += logM3;
      totalPulp += pulpM3;
      totalValue += logM3 * spPrices.tukki + pulpM3 * spPrices.kuitu;
    }
  } else {
    const sp = stand.mainSpecies;
    const priceKey = sp === "birch" ? "silver_birch" : sp;
    const p = prices?.[tier]?.[priceKey]
      ?? PRICES[tier]?.[priceKey]
      ?? PRICES[tier]?.pine
      ?? { tukki: 70, kuitu: 20 };
    const logM3 = stand.volumeM3 * 0.6;
    const pulpM3 = stand.volumeM3 - logM3;
    totalLog = logM3;
    totalPulp = pulpM3;
    totalValue = logM3 * p.tukki + pulpM3 * p.kuitu;
  }

  return {
    valueEur: Math.round(totalValue),
    logM3: Math.round(totalLog * 10) / 10,
    pulpM3: Math.round(totalPulp * 10) / 10,
  };
}

/** Convert a DB Compartment into an enriched StandData. */
export function enrichCompartment(
  c: Compartment,
  speciesRows: CompartmentSpecies[],
  prices?: Record<string, Record<string, { tukki: number; kuitu: number }>>,
  growthMultiplier = 1.0,
): StandData {
  const siteType = c.site_type ?? "";
  const soilType = c.soil_type ?? "";
  const drainageStatus = c.drainage_status ?? "";
  const siteClass = classifySite(siteType);
  const isPeatland = detectPeatland(soilType, siteType, "", drainageStatus);

  // Build species data from compartment_species rows
  const speciesData: SpeciesDatum[] = speciesRows.map((sp) => ({
    species: sp.species,
    volumeM3: sp.volume_m3 ?? 0,
    logPct: sp.log_pct ?? 0,
    stemCount: sp.stem_count_per_ha ?? 0,
    meanHeight: sp.mean_height ?? 0,
    meanDiameter: sp.mean_diameter ?? 0,
    age: sp.age ?? c.age_years ?? 0,
    basalArea: sp.basal_area ?? 0,
    areaHa: sp.area_ha ?? 0,
  }));

  // Stems per hectare: sum of per-species per-ha values, fallback to compartment.stem_count_per_ha
  const stemsPerHa = speciesData.reduce((s, sp) => s + sp.stemCount, 0)
    || (c.stem_count_per_ha ?? 0);

  // Mean height: use compartment-level avg_height, fallback to dominant species
  const meanHeight = c.avg_height
    ?? (speciesData.length > 0
      ? speciesData.reduce((s, sp) => s + sp.meanHeight * sp.stemCount, 0)
        / Math.max(1, stemsPerHa)
      : 0);

  // Mean diameter: use compartment-level avg_diameter, fallback to dominant species
  const meanDiameter = c.avg_diameter
    ?? (speciesData.length > 0
      ? speciesData.reduce((s, sp) => s + sp.meanDiameter * sp.stemCount, 0)
        / Math.max(1, stemsPerHa)
      : 0);

  const stand: StandData = {
    standId: c.stand_id,
    areaHa: c.area_ha ?? 0,
    developmentClass: c.development_class ?? "",
    siteType,
    soilType,
    drainageStatus,
    mainSpecies: c.main_species ?? "pine",
    site_class: siteClass,
    is_peatland: isPeatland,
    annual_growth: 0,
    valueEur: 0,
    logM3: 0,
    pulpM3: 0,
    ageYears: c.age_years ?? 0,
    ba: c.basal_area ?? 0,
    volumeM3: c.volume_m3 ?? 0,
    stemCount: stemsPerHa,
    meanHeight,
    meanDiameter,
    speciesData,
  };

  // Compute per-hectare growth rate using Tapio model
  const growthPerHa = computeTapioAnnualGrowth(
    stand.mainSpecies, siteType, stand.ageYears,
    stemsPerHa, growthMultiplier,
  );
  stand.annual_growth = growthPerHa * stand.areaHa;

  // Compute stumpage value
  const species = getSpeciesData(c);
  const { valueEur, logM3, pulpM3 } = computeStandValue(stand, species, prices);
  stand.valueEur = valueEur;
  stand.logM3 = logM3;
  stand.pulpM3 = pulpM3;

  return stand;
}

// ═══════════════════════════════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════════════════════════════

export async function generatePlan(
  supabase: SupabaseClient,
  forestId: string,
  userId: string,
  args: GeneratePlanArgs,
  language: Language = "en",
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    const periodYears = args.periodYears ?? 20;
    const goal: PlanGoal = args.goal ?? "balanced";

    // ── 1. Fetch compartments ──
    const { data: comps } = await supabase
      .from("compartments")
      .select("*")
      .eq("forest_id", forestId);
    const compartments = (comps as Compartment[]) ?? [];

    if (compartments.length === 0) {
      return { success: true, result: serverMsg("planEmpty", language) };
    }

    // ── 1b. Fetch compartment_species for stem/height/diameter data ──
    const compartmentIds = compartments.map((c) => c.id);
    const { data: speciesRows } = await supabase
      .from("compartment_species")
      .select("*")
      .in("compartment_id", compartmentIds);
    const allSpecies = (speciesRows as CompartmentSpecies[]) ?? [];

    // Build species map: compartment_id → species rows
    const speciesMap = new Map<string, CompartmentSpecies[]>();
    for (const sp of allSpecies) {
      const list = speciesMap.get(sp.compartment_id) || [];
      list.push(sp);
      speciesMap.set(sp.compartment_id, list);
    }

    // ── 2. Load region-specific timber prices ──
    const { data: forestData } = await supabase
      .from("forests")
      .select("price_region, growth_multiplier")
      .eq("id", forestId)
      .single();

    const region = forestData?.price_region ?? "9";
    const growthMultiplier = forestData?.growth_multiplier ?? 1.0;

    let prices: Record<string, Record<string, { tukki: number; kuitu: number }>> | undefined;
    try {
      const result = await getPricesForRegion(supabase, region);
      prices = result.prices;
    } catch {
      prices = undefined; // fallback to hardcoded PRICES in config.ts
    }

    // ── 3. Enrich compartments to StandData ──
    const skipClasses = ["other_land", "agricultural_land", "plot"];
    const forestStands: StandData[] = [];
    let totalArea = 0;
    let totalVolume = 0;
    let totalValue = 0;

    for (const c of compartments) {
      const devClass = c.development_class ?? "";
      if (
        skipClasses.includes(devClass) ||
        devClass === "" || devClass === "null" ||
        !c.area_ha || c.area_ha <= 0 ||
        !c.volume_m3
      ) {
        continue;
      }

      const speciesForCompartment = speciesMap.get(c.id) ?? [];
      const stand = enrichCompartment(c, speciesForCompartment, prices, growthMultiplier);
      forestStands.push(stand);
      totalArea += stand.areaHa;
      totalVolume += stand.volumeM3;
      totalValue += stand.valueEur;
    }

    if (forestStands.length === 0) {
      return { success: true, result: serverMsg("planEmpty", language) };
    }

    // ── 4. Schedule ──
    const startYear = args.startYear ?? new Date().getFullYear();
    const { years, summary } = schedulePlan(
      forestStands,
      startYear,
      periodYears,
      goal,
      growthMultiplier,
    );

    // ── 5. Build DB operations array ──
    const standToCompartment = new Map<string, { id: string; stand_id: string }>();
    for (const c of compartments) {
      standToCompartment.set(c.stand_id, { id: c.id, stand_id: c.stand_id });
    }

    const allPlanOps: Array<{
      compartment_id: string;
      forest_id: string;
      type: string;
      year: number;
      removal_pct: number;
      income_eur: number;
      cost_eur: number;
      notes: string;
      created_by: string;
    }> = [];

    for (const yp of years) {
      for (const op of [...yp.finalHarvests, ...yp.thinnings, ...yp.tendingOps, ...yp.regenerationOps]) {
        let comp = standToCompartment.get(op.stand.standId);
        // Fuzzy match for decimal stand IDs (e.g. "89.1" vs "89,1")
        if (!comp) {
          const numVal = parseFloat(op.stand.standId.replace(",", "."));
          for (const [key, val] of standToCompartment.entries()) {
            const keyNum = parseFloat(key.replace(",", "."));
            if (Math.abs(keyNum - numVal) < 0.01) {
              comp = val;
              break;
            }
          }
        }
        if (comp) {
          // Encode pre-operation simulated state into notes as JSON after "|||" delimiter
          const preState = {
            age_years: op.stand.ageYears,
            volume_m3: Math.round(op.stand.volumeM3),
            area_ha: op.stand.areaHa,
            ba: Math.round(op.stand.ba * 10) / 10,
            stem_count_per_ha: op.stand.stemCount,
            mean_height: Math.round(op.stand.meanHeight * 10) / 10,
            mean_diameter: Math.round(op.stand.meanDiameter * 10) / 10,
            value_eur: Math.round(op.stand.valueEur),
            main_species: op.stand.mainSpecies,
            development_class: op.stand.developmentClass,
            site_type: op.stand.siteType,
          };
          const notesWithState = `${op.notes}|||${JSON.stringify(preState)}`;

          allPlanOps.push({
            compartment_id: comp.id,
            forest_id: forestId,
            type: op.type,
            year: yp.year,
            removal_pct: getRemovalPct(op.type),
            income_eur: op.income_eur,
            cost_eur: op.cost_eur,
            notes: notesWithState,
            created_by: "ai",
          });
        }
      }
    }

    // ── 6. Upsert plan_metadata ──
    const metaPayload = {
      forest_id: forestId,
      name: `Forest Plan ${startYear}-${startYear + periodYears - 1}`,
      period_start: startYear,
      period_end: startYear + periodYears - 1,
      total_volume_m3: totalVolume,
      stumpage_value_eur: totalValue,
      annual_growth_m3: summary.annualGrowth,
      owner_stated_value_eur: null,
      goal,
    };

    const { data: existingMeta } = await supabase
      .from("plan_metadata")
      .select("id")
      .eq("forest_id", forestId)
      .limit(1)
      .single();

    if (existingMeta) {
      await supabase.from("plan_metadata").update(metaPayload).eq("id", existingMeta.id);
    } else {
      await supabase.from("plan_metadata").insert(metaPayload);
    }

    // ── 7. Replace operations from startYear onward ──
    // Scoped to year >= startYear: earlier operations are preserved (e.g. from a prior plan period),
    // but everything from this start point forward is regenerated to prevent back-to-back clearcuts
    // or other nonsensical transitions across plan boundaries.
    await supabase.from("operations").delete()
      .eq("forest_id", forestId)
      .eq("created_by", "ai")
      .gte("year", startYear);
    if (allPlanOps.length > 0) {
      const { error: insertError } = await supabase.from("operations").insert(allPlanOps);
      if (insertError) throw new Error(`Failed to insert operations: ${insertError.message}`);
    }

    // ── 8. Build summary message ──
    const areaStr = totalArea.toFixed(1);
    const volStr = Math.round(totalVolume).toLocaleString();
    const growthStr = Math.round(summary.annualGrowth).toLocaleString();
    const valueStr = Math.round(totalValue).toLocaleString();
    const startStr = String(startYear);
    const endStr = String(startYear + periodYears - 1);
    const ccCount = years.reduce((s, y) => s + y.finalHarvests.length, 0);
    const thinCount = years.reduce((s, y) => s + y.thinnings.length, 0);
    const tendCount = years.reduce((s, y) => s + y.tendingOps.length, 0);
    const regenCount = years.reduce((s, y) => s + y.regenerationOps.length, 0);
    const avgStr = Math.round(summary.averageHarvestPerYear);
    const pctStr = Math.round(summary.harvestVsGrowth);
    const incomeStr = Math.round(summary.totalIncome).toLocaleString();
    const costStr = Math.round(summary.totalCosts).toLocaleString();
    const netStr = Math.round(summary.totalIncome - summary.totalCosts).toLocaleString();

    const lines = [
      serverMsg("planGenerated", language, areaStr),
      ``,
      serverMsg("planTotalVolume", language, volStr),
      serverMsg("planAnnualGrowth", language, growthStr),
      serverMsg("planStumpageValue", language, valueStr),
      ``,
      `**${periodYears}-year plan ${startStr}–${endStr}:**`,
      `Clearcuts: ${ccCount} | Thinnings: ${thinCount} | Tending: ${tendCount} | Regeneration: ${regenCount}`,
      `Average harvest: ${avgStr} m³/y (${pctStr}% of growth)`,
      `Income: ${incomeStr} € | Costs: ${costStr} € | Net: ${netStr} €`,
    ];

    if (summary.overspillOps > 0) {
      const spillM3 = Math.round(summary.overspillM3).toLocaleString();
      lines.push(
        ``,
        `⚠️ **${summary.overspillOps} operations (${spillM3} m³) could not be scheduled** within the ${periodYears}-year period. Extend the plan duration or relax the volume cap to accommodate them.`,
      );
    }

    const result = lines.join("\n");

    return { success: true, result };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Plan generation failed",
    };
  }
}
