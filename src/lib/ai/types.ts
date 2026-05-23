// src/lib/ai/types.ts
import type { Compartment } from "@/types/database";

/** Enriched compartment data used by the forestry engine */
export interface KuviotData {
  numero: string;
  ala: number;
  kehitysluokka: string;
  kasvupaikka: string;
  maalaji: string;
  ojitustilanne: string;
  paapuulaji: string;
  site_class: string;
  is_peatland: boolean;
  annual_growth: number;
  arvo: number;
  tukki_m3: number;
  kuitu_m3: number;
  ikä: number;
  ba: number;
  m3: number;
  _manual_year?: number;
  _manual_income?: number;
  _manual_removal?: number;
  _manual_arvo?: number;
}

export interface PlannedOperation {
  kuvio: KuviotData;
  type: string;
  year: number;
  income_eur: number;
  cost_eur: number;
  removal_m3: number;
  notes: string;
}

export interface YearPlan {
  year: number;
  paate: PlannedOperation[];
  harvennus: PlannedOperation[];
  taimik: PlannedOperation[];
  uudist: PlannedOperation[];
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