// src/lib/ai/generate-plan.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Compartment } from "@/types/database";
import { classifyAndValueStands } from "./classify";
import { schedulePlan } from "./schedule";
import type { YearPlan, PlanGoal } from "./types";
import { serverMsg } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { getPricesForRegion } from "./price-fetcher";

interface GeneratePlanArgs {
  periodYears?: number;
  startYear?: number;
  goal?: PlanGoal;
}

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
    const { data: comps } = await supabase
      .from("compartments")
      .select("*")
      .eq("forest_id", forestId);
    const compartments = (comps as Compartment[]) ?? [];

    if (compartments.length === 0) {
      return { success: true, result: serverMsg("planEmpty", language) };
    }

    // 1b. Load region-specific timber prices (T12)
    const region = compartments[0]?.forest_id
      ? (await supabase.from("forests").select("price_region").eq("id", forestId).single()).data?.price_region ?? "9"
      : "9";
    let prices: Record<string, Record<string, { tukki: number; kuitu: number }>> | undefined;
    try {
      const result = await getPricesForRegion(supabase, region);
      prices = result.prices;
    } catch {
      prices = undefined; // fallback to hardcoded PRICES in config.ts
    }

    // 2. Classify and value
    const { forestStands, operations, totalArea, totalVolume, totalValue, totalGrowth } =
      classifyAndValueStands(compartments, goal, undefined, prices);

    // 3. Schedule
    const { p1, p2, summary } = schedulePlan(
      forestStands,
      operations,
      args.startYear ?? new Date().getFullYear(),
      goal,
      totalGrowth,
    );

    // 4. Build plan operations array
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

    const addPlanOps = (yearPlan: YearPlan[]) => {
      for (const yp of yearPlan) {
        for (const op of [...yp.finalHarvests, ...yp.thinnings, ...yp.tendingOps, ...yp.regenerationOps]) {
          const standId = op.stand.standId;
          let comp = standToCompartment.get(standId);
          if (!comp) {
            const numVal = parseFloat(standId.replace(",", "."));
            for (const [key, val] of standToCompartment.entries()) {
              const keyNum = parseFloat(key.replace(",", "."));
              if (Math.abs(keyNum - numVal) < 0.01) {
                comp = val;
                break;
              }
            }
          }
          if (comp) {
            allPlanOps.push({
              compartment_id: comp.id,
              forest_id: forestId,
              type: op.type,
              year: op.year,
              removal_pct: op.type === "clear_cut" || op.type === "selection_cutting" ? 100 : 28,
              income_eur: op.income_eur,
              cost_eur: op.cost_eur,
              notes: op.notes,
              created_by: "ai",
            });
          }
        }
      }
    };

    addPlanOps(p1);
    addPlanOps(p2);

    // 5. Save plan_metadata (upsert via manual check — avoids DB constraint dependency)
    const startYear = args.startYear ?? new Date().getFullYear();
    const metaPayload = {
      forest_id: forestId,
      name: `Forest Plan ${startYear}-${startYear + periodYears - 1}`,
      period_start: startYear,
      period_end: startYear + periodYears - 1,
      total_volume_m3: totalVolume,
      stumpage_value_eur: totalValue,
      annual_growth_m3: totalGrowth,
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

    // 6. Delete old AI-generated operations FIRST, then insert new ones
    await supabase.from("operations").delete().eq("forest_id", forestId).eq("created_by", "ai");
    if (allPlanOps.length > 0) {
      const { error: insertError } = await supabase.from("operations").insert(allPlanOps);
      if (insertError) throw new Error(`Failed to insert operations: ${insertError.message}`);
    }

    // 7. Return summary
    const areaStr = totalArea.toFixed(1);
    const volStr = Math.round(totalVolume).toLocaleString();
    const growthStr = Math.round(totalGrowth).toLocaleString();
    const valueStr = Math.round(totalValue).toLocaleString();
    const startStr = String(startYear);
    const endStr = String(startYear + 9);
    const ccCount = p1.reduce((s, y) => s + y.finalHarvests.length, 0);
    const thinCount = p1.reduce((s, y) => s + y.thinnings.length, 0);
    const avgStr = Math.round(summary.p1AverageHarvest);
    const pctStr = Math.round(summary.harvestVsGrowth);

    const result = [
      serverMsg("planGenerated", language, areaStr),
      ``,
      serverMsg("planTotalVolume", language, volStr),
      serverMsg("planAnnualGrowth", language, growthStr),
      serverMsg("planStumpageValue", language, valueStr),
      ``,
      serverMsg("planPeriod1", language, startStr, endStr),
      serverMsg("planClearcuts", language, String(ccCount)),
      serverMsg("planThinnings", language, String(thinCount)),
      serverMsg("planAvgHarvest", language, String(avgStr), String(pctStr)),
      ``,
      serverMsg("planPeriod2Footer", language),
    ].join("\n");

    return { success: true, result };
  } catch (err) {
    return { success: false, result: "", error: err instanceof Error ? err.message : "Plan generation failed" };
  }
}