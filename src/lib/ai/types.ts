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
  /** Initial total standing volume (m³) across all stands */
  totalVolume: number;
  /** Average annual growth (m³/y) across the plan period, computed year-by-year */
  annualGrowth: number;
  /** Initial total stumpage value (€) across all stands */
  stumpageValue: number;
  /** Average harvest volume per year (m³/y) */
  averageHarvestPerYear: number;
  /** Harvest as percentage of growth (100 = sustainable, >100 = drawing down stock) */
  harvestVsGrowth: number;
  /** Total income (€) across all years */
  totalIncome: number;
  /** Total costs (€) across all years */
  totalCosts: number;
  /** Number of operations that could not be scheduled within the period */
  overspillOps: number;
  /** Total removal m³ of overspill operations */
  overspillM3: number;
}
