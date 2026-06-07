// src/lib/ai/classify.ts

import type { Compartment } from "@/types/database";
import type { StandData, PlannedOperation, PlanGoal } from "./types";
import {
  classifySite,
  detectPeatland,
  getPrices,
  getOptimalAge,
  THINNING_BA,
  MIN_AGE_FIRST_THINNING,
  MIN_AGE_THINNING,
  COSTS,
  PRICES,
} from "./config";
import { getGrowthRate } from "./chart-engine";

/**
 * Convert a Compartment from the database into the enriched StandData format
 * used by the forestry engine.
 */
function compartmentToStandData(c: Compartment): StandData {
  const siteType = c.site_type ?? "";
  const soilType = c.soil_type ?? "";
  const drainageStatus = c.drainage_status ?? "";
  const siteClass = classifySite(siteType);
  const isPeatland = detectPeatland(soilType, siteType, "", drainageStatus);

  return {
    standId: c.stand_id,
    areaHa: c.area_ha ?? 0,
    developmentClass: c.development_class ?? "",
    siteType,
    soilType,
    drainageStatus,
    mainSpecies: c.main_species ?? "",
    site_class: siteClass,
    is_peatland: isPeatland,
    annual_growth: 0, // computed below
    valueEur: 0, // computed below
    logM3: 0, // computed below
    pulpM3: 0, // computed below
    ageYears: c.age_years ?? 0,
    ba: c.basal_area ?? 0,
    volumeM3: c.volume_m3 ?? 0,
  };
}

/**
 * Get species breakdown from compartment attributes.
 * The raw data has an array under attributes.species with objects
 * { species: string, m3: number, log_pct: number }.
 */
interface RawSpecies {
  species: string;
  m3: number;
  log_pct: number;
}

function getSpeciesData(c: Compartment): RawSpecies[] {
  const attrs = c.attributes;
  if (attrs && Array.isArray(attrs["species"])) {
    return attrs["species"] as RawSpecies[];
  }
  return [];
}

/**
 * Calculate stumpage value for a stand.
 *
 * For each species:
 *   logM3 = m3 * log_pct / 100
 *   pulpM3 = m3 - logM3
 *   value = logM3 * log_price + pulpM3 * pulp_price
 *
 * If no species breakdown, use the aggregate volume and the main species prices.
 */
function calculateValue(
  k: StandData,
  species: RawSpecies[],
  prices?: Record<string, Record<string, { tukki: number; kuitu: number }>>,
): {
  valueEur: number;
  logM3: number;
  pulpM3: number;
} {
  let totalValue = 0;
  let totalLog = 0;
  let totalPulp = 0;

  const tier = "uudistushakkuu";

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
    const sp = k.mainSpecies;
    const priceKey = sp === "birch" ? "silver_birch" : sp;
    const p = prices?.[tier]?.[priceKey]
      ?? PRICES[tier]?.[priceKey]
      ?? PRICES[tier]?.pine
      ?? { tukki: 70, kuitu: 20 };
    const logM3 = k.volumeM3 * 0.6;
    const pulpM3 = k.volumeM3 - logM3;
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

export interface ClassifyResult {
  forestStands: StandData[];
  operations: PlannedOperation[];
  totalArea: number;
  totalVolume: number;
  totalValue: number;
  totalGrowth: number;
}

/**
 * Classify and value all stands in the forest.
 *
 * Ported from build_plan_v3_fixed.py lines 191-389.
 */
export function classifyAndValueStands(
  compartments: Compartment[],
  goal: PlanGoal = "balanced",
  currentYear?: number,
  prices?: Record<string, Record<string, { tukki: number; kuitu: number }>>,
): ClassifyResult {
  const cy = currentYear ?? new Date().getFullYear();
  const skipKl = ["Muu maa", "Maatalousmaa", "Tontti"];

  // ── Goal-adjusted clearcut eligibility ──
  function isClearcutEligible(
    sp: string,
    site: string,
    age: number,
  ): boolean {
    const [optMin, optMax] = getOptimalAge(sp, site);
    switch (goal) {
      case "carbon_storage":
        return age >= optMax + 15; // significantly over-mature
      default:
        return age >= optMin; // standard eligibility
    }
  }

  // ── Carbon storage: prefer selection cutting over clearcut ──
  function preferSelectionCutting(): boolean {
    return goal === "carbon_storage";
  }

  // ── Carbon storage: avoid ditch mounding on peatland ──
  function avoidDitchMounding(): boolean {
    return goal === "carbon_storage";
  }

  const forestStands: StandData[] = [];
  const operations: PlannedOperation[] = [];
  let totalArea = 0;
  let totalVolume = 0;
  let totalValue = 0;
  let totalGrowth = 0;

  for (const c of compartments) {
    const devClass = c.development_class ?? "";
    // Skip non-forest, null/empty, zero area, no volume
    if (skipKl.includes(devClass) || devClass === "" || devClass === "null" || !c.area_ha || c.area_ha <= 0 || !c.volume_m3) {
      continue;
    }

    const k = compartmentToStandData(c);
    const species = getSpeciesData(c);

    // Compute annual growth using chart-engine's VMI13 growth function
    // (base rate × species × age × density multipliers)
    const grPerHa = getGrowthRate(
      c.site_type ?? "",
      c.soil_type ?? "",
      c.main_species ?? "",
      c.age_years,
      c.basal_area,
      c.development_class ?? null,
    );
    k.annual_growth = grPerHa * k.areaHa;

    // Calculate stumpage value
    const { valueEur, logM3, pulpM3 } = calculateValue(k, species, prices);
    k.valueEur = valueEur;
    k.logM3 = logM3;
    k.pulpM3 = pulpM3;

    // Aggregate totals
    totalArea += k.areaHa;
    totalVolume += k.volumeM3;
    totalValue += k.valueEur;
    totalGrowth += k.annual_growth;

    forestStands.push(k);
  }

  // ── Classify each stand (determine operations) ──
  for (const k of forestStands) {
    const sp = k.mainSpecies;
    const devClass = k.developmentClass;
    const site = k.site_class;
    const ba = k.ba;
    const age = k.ageYears;
    const areaHa = k.areaHa;
    const volumeM3 = k.volumeM3;
    const valueEur = k.valueEur;

    // === REGENERATION_READY → FINAL HARVEST ===
    if (devClass.includes("regeneration_ready")) {
      const [optMin, optMax] = getOptimalAge(sp, site);
      if (isClearcutEligible(sp, site, age)) {
        // For carbon_storage: prefer selection_cutting over clearcut
        if (preferSelectionCutting()) {
          operations.push({
            stand: k,
            type: "selection_cutting",
            year: cy,
            income_eur: Math.round(valueEur * 0.5),
            cost_eur: 0,
            removal_m3: Math.round(volumeM3 * 0.5),
            notes: `Selection cutting (carbon storage). Age ${age.toFixed(0)}y [${optMin}-${optMax}y]`,
            dueYear: cy,
          });
        } else {
          operations.push({
            stand: k,
            type: "clear_cut",
            year: cy,
            income_eur: valueEur,
            cost_eur: 0,
            removal_m3: Math.round(volumeM3),
            notes: `Age ${age.toFixed(0)}y [${optMin}-${optMax}y]`,
            dueYear: cy,
          });
        }
      }
      continue;
    }

    // === SHELTERWOOD → REGENERATION ===
    if (devClass.includes("shelterwood")) {
      operations.push({
        stand: k,
        type: "site_prep",
        year: cy,
        income_eur: 0,
        cost_eur: Math.round(COSTS.site_prep * areaHa),
        removal_m3: 0,
        notes: "Regeneration",
      });
      operations.push({
        stand: k,
        type: "pine_planting",
        year: cy,
        income_eur: 0,
        cost_eur: Math.round(COSTS.pine_planting * areaHa),
        removal_m3: 0,
        notes: "",
      });
      continue;
    }

    // === OPEN_AREA → REGENERATION (if no trees) ===
    if (devClass.includes("open_area") && volumeM3 < 5) {
      operations.push({
        stand: k,
        type: "site_prep",
        year: cy,
        income_eur: 0,
        cost_eur: Math.round(COSTS.site_prep * areaHa),
        removal_m3: 0,
        notes: "Regeneration",
      });
      const opsSpecies = site.includes("tuore") || site.includes("lehto") ? "spruce" : "pine";
      const plantType = `${opsSpecies}_planting`;
      const plantCost = Math.round(COSTS[plantType] * areaHa);
      operations.push({
        stand: k,
        type: plantType,
        year: cy,
        income_eur: 0,
        cost_eur: plantCost,
        removal_m3: 0,
        notes: "",
      });
      continue;
    }

    // === SEEDLING_SMALL (under 1.3m) ===
    if (devClass.includes("seedling") && age >= 3 && age <= 12) {
        operations.push({
          stand: k,
          type: "early_tending",
          year: cy,
          income_eur: 0,
          cost_eur: Math.round(COSTS.early_tending * areaHa),
          removal_m3: 0,
          notes: `Age ${age.toFixed(0)}y`,
        });
      continue;
    }

    // === SEEDLING_LARGE (over 1.3m) ===
    if (devClass.includes("seedling") && age >= 10 && age <= 25) {
        operations.push({
          stand: k,
          type: "tending",
          year: cy,
          income_eur: 0,
        cost_eur: Math.round(COSTS.tending * areaHa),
          removal_m3: 0,
          notes: `Age ${age.toFixed(0)}y`,
        });
      continue;
    }

    // === YOUNG_THINNING → FIRST THINNING ===
    if (devClass.includes("young_thinning")) {
      const thresh = THINNING_BA["ensiharvennus"]?.[sp] ?? 18;
      const minAge = MIN_AGE_FIRST_THINNING?.[sp] ?? 30;
      if (ba >= thresh && age >= minAge) {
        const priceKey = sp === "birch" ? "silver_birch" : sp;
        const ep = getPrices("ensiharvennus", priceKey);
        const up = getPrices("uudistushakkuu", priceKey);
        const ratio = (ep.tukki + ep.kuitu) / (up.tukki + up.kuitu);
        const removal = volumeM3 * 0.25;
        const income = Math.round(valueEur * 0.25 * ratio);
        operations.push({
          stand: k,
          type: "first_thinning",
          year: cy,
          income_eur: income,
          cost_eur: 0,
          removal_m3: Math.round(removal),
          notes: `BA=${ba.toFixed(0)}, age ${age.toFixed(0)}y`,
        });
      }
      continue;
    }

    // === MATURE_THINNING → THINNING ===
    if (devClass.includes("mature_thinning")) {
      const thresh = THINNING_BA["harvennus"]?.[sp] ?? 22;
      const minAge = MIN_AGE_THINNING?.[sp] ?? 40;
      if (ba >= thresh && age >= minAge) {
        const priceKey = sp === "birch" ? "silver_birch" : sp;
        const hp = getPrices("harvennus", priceKey);
        const up = getPrices("uudistushakkuu", priceKey);
        const ratio = (hp.tukki + hp.kuitu) / (up.tukki + up.kuitu);
        const removal = volumeM3 * 0.28;
        const income = Math.round(valueEur * 0.28 * ratio);
        operations.push({
          stand: k,
          type: "thinning",
          year: cy,
          income_eur: income,
          cost_eur: 0,
          removal_m3: Math.round(removal),
          notes: `BA=${ba.toFixed(0)}, age ${age.toFixed(0)}y`,
        });
      }
      continue;
    }
  }

  return {
    forestStands,
    operations,
    totalArea,
    totalVolume,
    totalValue,
    totalGrowth,
  };
}
