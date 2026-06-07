// src/lib/ai/schedule.ts

import type { StandData, PlannedOperation, YearPlan, PlanSummary, PlanGoal } from "./types";
import { getOptimalAge, COSTS } from "./config";
import { runScheduleEngine } from "./strategies";

// ── Stand splitting constants ──
export const MIN_SPLIT_AREA_HA = 0.5;
export const VALID_SPLIT_FRACTIONS = [1 / 2, 1 / 3, 1 / 4] as const;
export const MAX_SPLIT_PARTS = 4;

/**
 * Try to split a stand's harvest operation into multiple parts to stay under
 * a per-year volume cap. This is a scheduling tactic — splitting is NOT automatic.
 */
export function trySplitStand(
  stand: StandData,
  op: PlannedOperation,
  volumeCapM3: number,
  maxParts: number,
): PlannedOperation[] | null {
  if (maxParts < 2 || maxParts > MAX_SPLIT_PARTS) return null;

  const totalArea = stand.areaHa;
  const totalVolume = op.removal_m3;
  const totalIncome = op.income_eur;

  // Try all valid split counts (2 → maxParts) and use the one with
  // smallest part volume (most parts). This gives clearcuts minimal
  // cap footprint, leaving room for thinnings in the same year.
  let bestSplit: PlannedOperation[] | null = null;
  let bestPartVol = Infinity;

  for (let n = 2; n <= maxParts; n++) {
    const partArea = totalArea / n;
    const partVolume = totalVolume / n;

    if (partArea < MIN_SPLIT_AREA_HA) continue;
    if (partVolume > volumeCapM3) continue;

    if (partVolume < bestPartVol) {
      bestPartVol = partVolume;
      const subOps: PlannedOperation[] = [];
      const partIncome = Math.round(totalIncome / n);
      const sa = Math.round(partArea * 10) / 10;

      for (let i = 0; i < n; i++) {
        const subStand = { ...stand, areaHa: sa };
        subOps.push({
          ...op,
          stand: subStand,
          income_eur: partIncome,
          removal_m3: Math.round(partVolume),
          notes: `${op.notes} (part ${i + 1}/${n})`,
        });
      }

      bestSplit = subOps;
    }
  }

  return bestSplit;
}

/**
 * Schedule operations across the plan period using the goal-aware,
 * year-by-year growth simulation engine (Phase 7b).
 */
export function schedulePlan(
  forestStands: StandData[],
  operations: PlannedOperation[],
  currentYear: number,
  goal: PlanGoal = "balanced",
  annualGrowthM3?: number,
  growthMultiplier = 1.0,
): {
  p1: YearPlan[];
  p2: YearPlan[];
  summary: PlanSummary;
} {
  const startYear = currentYear;
  const endYear = startYear + 19;
  const totalGrowth = annualGrowthM3 ??
    forestStands.reduce((s, k) => s + (k.annual_growth ?? 0), 0);

  const result = runScheduleEngine({
    forestStands,
    operations,
    startYear,
    endYear,
    goal,
    annualGrowthM3: totalGrowth,
    growthMultiplier,
  });

  const yearsP1 = Array.from({ length: 10 }, (_, i) => startYear + i);
  const yearsP2 = Array.from({ length: 10 }, (_, i) => startYear + 10 + i);

  const p1: YearPlan[] = yearsP1.map((y) => ({
    year: y,
    finalHarvests: [],
    thinnings: [],
    tendingOps: [],
    regenerationOps: [],
  }));
  const p2: YearPlan[] = yearsP2.map((y) => ({
    year: y,
    finalHarvests: [],
    thinnings: [],
    tendingOps: [],
    regenerationOps: [],
  }));

  let p1TotalIncome = 0;
  let p1TotalCosts = 0;
  let p2TotalIncome = 0;
  let p2TotalCosts = 0;
  let p1HarvestTotal = 0;
  let p2HarvestTotal = 0;

  for (const [yr, ops] of result.yearPlans) {
    const isP1 = yr <= startYear + 9;
    const plans = isP1 ? p1 : p2;
    const yp = plans.find((p) => p.year === yr);
    if (!yp) continue;

    for (const op of ops) {
      switch (op.type) {
        case "clear_cut":
          yp.finalHarvests.push(op);
          if (isP1) { p1TotalIncome += op.income_eur; p1HarvestTotal += op.removal_m3; }
          else { p2TotalIncome += op.income_eur; p2HarvestTotal += op.removal_m3; }
          break;
        case "thinning":
        case "first_thinning":
        case "selection_cutting":
          yp.thinnings.push(op);
          if (isP1) { p1TotalIncome += op.income_eur; p1HarvestTotal += op.removal_m3; }
          else { p2TotalIncome += op.income_eur; p2HarvestTotal += op.removal_m3; }
          break;
        case "tending":
        case "early_tending":
          yp.tendingOps.push(op);
          if (isP1) p1TotalCosts += op.cost_eur;
          else p2TotalCosts += op.cost_eur;
          break;
        default:
          yp.regenerationOps.push(op);
          if (isP1) p1TotalCosts += op.cost_eur;
          else p2TotalCosts += op.cost_eur;
          break;
      }
    }
  }

  const totalVolume = forestStands.reduce((s, k) => s + k.volumeM3, 0);
  const totalValue = forestStands.reduce((s, k) => s + k.valueEur, 0);

  const summary: PlanSummary = {
    totalVolume,
    annualGrowth: totalGrowth,
    stumpageValue: totalValue,
    p1AverageHarvest: yearsP1.length > 0 ? p1HarvestTotal / yearsP1.length : 0,
    p2AverageHarvest: yearsP2.length > 0 ? p2HarvestTotal / yearsP2.length : 0,
    harvestVsGrowth:
      totalGrowth > 0
        ? Math.round(((p1HarvestTotal + p2HarvestTotal) / totalGrowth / 20) * 100)
        : 0,
    p1TotalIncome,
    p1TotalCosts,
    p2TotalIncome,
    p2TotalCosts,
  };

  return { p1, p2, summary };
}
