// src/lib/ai/generate-plan.ts

import { getCompartmentsByForest } from "@/lib/repos/compartments";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyAndValueStands } from "./classify";
import { schedulePlan } from "./schedule";
import type { YearPlan } from "./types";

interface GeneratePlanArgs {
  periodYears?: number;
  startYear?: number;
}

export async function generatePlan(
  forestId: string,
  userId: string,
  args: GeneratePlanArgs
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    // 1. Fetch compartments
    const compartments = await getCompartmentsByForest(forestId);
    if (compartments.length === 0) {
      return { success: true, result: "No compartments found for this forest." };
    }

    // 2. Classify and value
    const { forestKuviot, operations, totalArea, totalVolume, totalValue, totalGrowth } =
      classifyAndValueStands(compartments);

    // 3. Schedule
    const { p1, p2, summary } = schedulePlan(forestKuviot, operations, args.startYear ?? new Date().getFullYear());

    // 4. Store operations in Supabase (admin client bypasses RLS)
    const admin = createAdminClient();
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

    // Map kuvio numbers to compartment IDs
    const kuvioToCompartment = new Map<string, { id: string; stand_id: string }>();
    for (const c of compartments) {
      kuvioToCompartment.set(c.stand_id, { id: c.id, stand_id: c.stand_id });
    }

    const addPlanOps = (yearPlan: YearPlan[]) => {
      for (const yp of yearPlan) {
        for (const op of [...yp.paate, ...yp.harvennus, ...yp.taimik, ...yp.uudist]) {
          // Find by stand_id string
          const standId = op.kuvio.numero;
          // Try exact match first, then try numeric comparison
          let comp = kuvioToCompartment.get(standId);
          if (!comp) {
            // Try parsing as number
            const numVal = parseFloat(standId.replace(",", "."));
            for (const [key, val] of kuvioToCompartment.entries()) {
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
              removal_pct: op.type === "Päätehakkuu" || op.type === "Poimintahakkuu" ? 100 : 28,
              income_eur: op.income_eur,
              cost_eur: op.cost_eur,
              notes: op.notes,
              created_by: "ai",
            });
          }
        }
      }
    };

    // Store BOTH periods in the ops array
    addPlanOps(p1);
    addPlanOps(p2);

    // 5. Upsert plan_metadata
    const periodYears = args.periodYears ?? 20;
    const startYear = args.startYear ?? new Date().getFullYear();
    await admin.from("plan_metadata").upsert({
      forest_id: forestId,
      name: `Forest Plan ${startYear}-${startYear + periodYears - 1}`,
      period_start: startYear,
      period_end: startYear + periodYears - 1,
      total_volume_m3: totalVolume,
      stumpage_value_eur: totalValue,
      annual_growth_m3: totalGrowth,
      owner_stated_value_eur: null, // user sets manually
    }, { onConflict: "forest_id" });

    // 6. Insert new operations FIRST, then delete old ones only on success
    //    This prevents data loss if the insert fails partway through.
    if (allPlanOps.length > 0) {
      const { error: insertError } = await admin.from("operations").insert(allPlanOps);
      if (insertError) throw new Error(`Failed to insert operations: ${insertError.message}`);
    }
    // Only delete old AI operations AFTER successful insert
    await admin.from("operations").delete().eq("forest_id", forestId).eq("created_by", "ai");

    // 7. Return summary
    const result = [
      `✅ Plan generated for ${totalArea.toFixed(1)} ha forest!`,
      ``,
      `🌲 Total volume: ${Math.round(totalVolume).toLocaleString()} m³`,
      `📈 Annual growth: ${Math.round(totalGrowth).toLocaleString()} m³/v`,
      `💰 Stumpage value: ${Math.round(totalValue).toLocaleString()} €`,
      ``,
      `Period 1 (${startYear}-${startYear + 9}):`,
      `  ${p1.reduce((s, y) => s + y.paate.length, 0)} clearcuts`,
      `  ${p1.reduce((s, y) => s + y.harvennus.length, 0)} thinnings`,
      `  Avg harvest: ${Math.round(summary.p1AverageHarvest)} m³/v (${Math.round(summary.harvestVsGrowth)}% of growth)`,
      ``,
      `Period 2 extension also generated. Would you like any changes?`,
    ].join("\n");

    return { success: true, result };

  } catch (err) {
    return { success: false, result: "", error: err instanceof Error ? err.message : "Plan generation failed" };
  }
}