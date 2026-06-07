// src/lib/ai/types.ts
import type { Compartment } from "@/types/database";

/** Enriched compartment data used by the forestry engine */
export interface StandData {
  standId: string;
  areaHa: number;
  developmentClass: string;
  siteType: string;
  soilType: string;
  drainageStatus: string;
  mainSpecies: string;
  site_class: string;
  is_peatland: boolean;
  annual_growth: number;
  valueEur: number;
  logM3: number;
  pulpM3: number;
  ageYears: number;
  ba: number;
  volumeM3: number;
}

/** Owner's objective for plan generation */
export type PlanGoal = "maximum_growth_aggressive" | "maximum_growth_balanced" | "carbon_storage" | "balanced";

export interface PlannedOperation {
  stand: StandData;
  type: string;
  year: number;
  income_eur: number;
  cost_eur: number;
  removal_m3: number;
  notes: string;
  /** First year this operation became due (used for priority ordering) */
  dueYear?: number;
  /** Priority boost from stand wishes (accelerate_harvest) */
  _priority_boost?: number;
}

export interface YearPlan {
  year: number;
  finalHarvests: PlannedOperation[];
  thinnings: PlannedOperation[];
  tendingOps: PlannedOperation[];
  regenerationOps: PlannedOperation[];
}

export interface PlanSummary {
  totalVolume: number;
  annualGrowth: number;
  stumpageValue: number;
  p1AverageHarvest: number;
  p2AverageHarvest: number;
  harvestVsGrowth: number; // percentage
  p1TotalIncome: number;
  p1TotalCosts: number;
  p2TotalIncome: number;
  p2TotalCosts: number;
}
