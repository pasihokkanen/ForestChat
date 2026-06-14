// src/lib/ai/schedule.ts
// Phase 7b rewrite: Year-by-year forest plan scheduling engine.
//
// Instead of classifying all operations at year 0 (static), this engine
// walks year by year through the plan period, simulating stand growth and
// spawning operations DYNAMICALLY when stands cross biological thresholds.
//
// No stand splitting. No initial operation pool. All operations are spawned
// on-demand from the current simulated state.

import type { StandData, PlannedOperation, PlanGoal, YearPlan, PlanSummary, SpeciesDatum, YearSnapshot, StandSnapshot, SpeciesSnapshot } from "./types";
import { getOptimalAge, THINNING_BA, MIN_AGE_FIRST_THINNING, MIN_AGE_THINNING, COSTS, OPERATION_DEFAULTS, computeOperationValue, CLEARCUT_MIN_DIAMETER, CLEARCUT_MIN_VOLUME_PER_HA } from "./config";
import { computeTapioAnnualGrowth } from "./tapio-growth";
import { getStrategy, type SchedulingStrategy } from "./strategies";
import { type GrowableStand, growStand, snapshotState } from "./stand-simulator";
import { formFactor } from "./tapio-growth";
import * as fs from "fs";

const DEBUG_LOG = "/tmp/schedule-debug.log";
function dlog(msg: string) {
  try { fs.appendFileSync(DEBUG_LOG, msg + "\n"); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
// Tapio constants for planting and tending
// ═══════════════════════════════════════════════════════════════════════

/** Planting density (stems/ha) by species. Source: Tapio Metsänhoidon suositukset. */
export const PLANTING_DENSITY: Record<string, number> = {
  pine: 2200,
  spruce: 1650,
  silver_birch: 1600,
  downy_birch: 1600,
  birch: 1600,
  larch: 1800,
};

/** Initial seedling height (m) after planting. */
export const PLANTING_INITIAL_HEIGHT_M = 0.3;

/** Initial seedling diameter (cm) after planting. */
export const PLANTING_INITIAL_DIAMETER_CM = 0.5;

/** Natural ingress base rate: max stems/ha/year at zero density. */
export const NATURAL_INGRESS_BASE_RATE = 520;

/** Natural ingress exponent: controls how steeply ingress drops with density. */
export const NATURAL_INGRESS_EXPONENT = 3.0;

/** Natural ingress ceiling: carrying capacity (stems/ha). */
export const MAX_STEMS_HA = 6000;

/** Early tending trigger: stems/ha must exceed this.
 *  Tapio: varhaisperkaus when stems > 4000/ha. */
const EARLY_TENDING_STEM_THRESHOLD = 4000;

/** Tending (taimikonharvennus) trigger: stems/ha must exceed this.
 *  Tapio: taimikonharvennus when stems > 2000-2500/ha. Midpoint 2250 → rounded to 2500. */
const TENDING_STEM_THRESHOLD = 2500;

/** Early tending height thresholds (m). Source: Tapio (varhaisperkaus < 1m pine, < 1.5m spruce). */
// Tapio upper bounds: below = varhaisperkaus (early_tending)
// Pine: varhaisperkaus at 0.5-1.0m → upper bound 1.0m
// Spruce: varhaisperkaus at 1.0-1.5m → upper bound 1.5m
const EARLY_TENDING_MAX_HEIGHT: Record<string, number> = {
  pine: 1.0,
  spruce: 1.5,
  silver_birch: 1.5,
  downy_birch: 1.5,
  birch: 1.5,
  larch: 1.2,
};

/** Tending (taimikonharvennus) minimum height (m). Source: Tapio.
 *  Taimikonharvennus is done at 2-4m (pine/spruce) or 3-5m (birch).
 *  Below this height but above EARLY_TENDING_MAX_HEIGHT, no operation
 *  fires — the stand is in a natural rest period between varhaisperkaus
 *  and taimikonharvennus.
 *  Values are midpoints of Tapio windows to produce ~7-9y gaps. */
const TENDING_MIN_HEIGHT: Record<string, number> = {
  pine: 3.0,
  spruce: 3.5,
  silver_birch: 4.0,
  downy_birch: 4.0,
  birch: 4.0,
  larch: 3.5,
};

/** Target stems/ha after early tending. Drop to 3250 so height outpaces ingress re-trigger. */
const EARLY_TENDING_TARGET_STEMS_HA = 3250;

/** Target stems/ha after tending (taimikonharvennus). Tapio: 1800-2000. Lower bound 1800. */
const TENDING_TARGET_STEMS_HA = 1800;

// ═══════════════════════════════════════════════════════════════════════
// Tapio first thinning targets (ensiharvennus harvennusmallit)
// Post-operation stems/ha by species × site class.
// Source: Metsanhoidon suositukset — harvennusmallit
// ═══════════════════════════════════════════════════════════════════════

/** Tapio post-first-thinning stem count target (stems/ha) by species and site class. */
const FIRST_THINNING_TARGET_STEMS_HA: Record<string, Record<string, number>> = {
  pine:       { mesic: 1100, "sub-xeric": 1100, xeric: 1000 },
  spruce:     { "herb-rich heath": 1100, mesic: 1100 },
  silver_birch: { "herb-rich heath": 750, mesic: 750 },
  downy_birch:  { mesic: 1150, "sub-xeric": 1150 },
  larch:      { mesic: 900, "sub-xeric": 900 },
  grey_alder: { mesic: 700, "sub-xeric": 700 },
};

/** Default first thinning target when species/site not in table. */
const FIRST_THINNING_DEFAULT_TARGET = 1100;

/** Minimum removal fraction for first thinning (Tapio lower bound: 35%). */
const FIRST_THINNING_MIN_REMOVAL = 0.35;

/** Maximum removal fraction for first thinning (Tapio upper bound: 50%). */
const FIRST_THINNING_MAX_REMOVAL = 0.50;

// ═══════════════════════════════════════════════════════════════════════
// Tapio regular thinning targets (harvennus)
// Post-operation basal area (m²/ha) by species × site class.
// Source: Metsanhoidon suositukset — harvennusmallit
// ═══════════════════════════════════════════════════════════════════════

/** Tapio post-thinning basal area target (m²/ha) by species and site class. */
const THINNING_TARGET_BA: Record<string, Record<string, number>> = {
  pine:       { mesic: 18, "sub-xeric": 16, xeric: 14 },
  spruce:     { "herb-rich heath": 20, mesic: 19 },
  silver_birch: { "herb-rich heath": 15, mesic: 15 },
  downy_birch:  { mesic: 15 },
  larch:      { mesic: 16, "sub-xeric": 16 },
  grey_alder: { mesic: 14, "sub-xeric": 14 },
};

/** Default thinning target BA when species/site not in table. */
const THINNING_DEFAULT_TARGET_BA = 16;

/** Minimum removal fraction for regular thinning (Tapio lower bound). */
const THINNING_MIN_REMOVAL = 0.25;

/** Maximum removal fraction for regular thinning (Tapio upper bound). */
const THINNING_MAX_REMOVAL = 0.45;

// ═══════════════════════════════════════════════════════════════════════
// Stand splitting stub (not implemented — split removed per user request)
// Exported for backward compat with strategies.ts. Always returns null.
// ═══════════════════════════════════════════════════════════════════════

export const MIN_SPLIT_AREA_HA = 0.5;
export const VALID_SPLIT_FRACTIONS = [1 / 2, 1 / 3, 1 / 4] as const;
export const MAX_SPLIT_PARTS = 4;

export function trySplitStand(
  _stand: StandData,
  _op: PlannedOperation,
  _volumeCapM3: number,
  _maxParts: number,
): PlannedOperation[] | null {
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

/** Mutable stand state tracked year-by-year during simulation. */
interface SimStand {
  standId: string;
  areaHa: number;
  siteType: string;
  soilType: string;
  species: string;
  siteClass: string;
  volumeM3: number;
  ageYears: number;
  basalArea: number;
  valueEur: number;
  /** Original development class from DB (seed_tree, shelterwood, etc.) */
  developmentClass: string;
  /** Year when seed_tree/shelterwood stand was first seen (0 = not applicable). */
  overstoryStarted: number;
  growthMultiplier: number;
  /** Year when stand was planted (0 = not planted). Used for post-planting tending chain. */
  plantingYear: number;
  /** Number of thinning operations applied (for peatland thinning cap). */
  thinningCount: number;
  /** Stem count per hectare (stems/ha). Decreased by tending operations. */
  stemCount: number;
  /** Mean height (m) of dominant species. Used for tending threshold logic. */
  meanHeight: number;
  /** Mean diameter (cm) of dominant species. */
  meanDiameter: number;
  /** Year when stand was clearcut (0 = not clearcut). Used for regen delay timing. */
  clearYear: number;
  /** Per-species breakdown (kept for potential future use, not mutated by simulation). */
  speciesData: SpeciesDatum[];
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function makeMinimalStand(s: SimStand): StandData {
  return {
    standId: s.standId,
    areaHa: s.areaHa,
    developmentClass: s.developmentClass,
    siteType: s.siteType,
    soilType: s.soilType,
    drainageStatus: "",
    mainSpecies: s.species,
    site_class: s.siteClass,
    is_peatland: s.soilType === "peatland",
    annual_growth: 0,
    valueEur: s.valueEur,
    logM3: 0,
    pulpM3: 0,
    ageYears: s.ageYears,
    ba: s.basalArea,
    volumeM3: s.volumeM3,
    stemCount: s.stemCount,
    meanHeight: s.meanHeight,
    meanDiameter: s.meanDiameter,
    speciesData: s.speciesData,
  };
}

/** Get the price ratio of a thinning tier vs clearcut tier for a species. */
// ═══════════════════════════════════════════════════════════════════════
// Operation Spawning
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check every stand's current simulated state and spawn operations
 * for any threshold crossings. Called once per year.
 */
function spawnOperations(
  stands: Map<string, SimStand>,
  year: number,
  startYear: number,
  strategy: SchedulingStrategy,
  goal: PlanGoal,
): PlannedOperation[] {
  const spawned: PlannedOperation[] = [];

  for (const s of stands.values()) {
    // ── DEBUG: per-stand state snapshot (year 1 only to avoid spam) ──
    if (year <= startYear + 1) {
      const [optMin, optMax] = getOptimalAge(s.species, s.siteClass);
      const isProblem = ["83", "138", "181", "183"].some((id) => s.standId.includes(id));
      dlog(
        `[SPAWN yr=${year}] stand=${s.standId} age=${s.ageYears}y vol=${s.volumeM3.toFixed(0)}m³ ` +
        `ba=${s.basalArea.toFixed(1)} devClass=${s.developmentClass} species=${s.species} ` +
        `siteClass=${s.siteClass} soilType=${s.soilType} optMin=${optMin} ccEligible=${s.ageYears >= optMin} ` +
        `${isProblem ? "⚠ PROBLEM_STAND" : ""}`,
      );

      if (isProblem) {
        const regenSp = strategy.regenerationSpecies(makeMinimalStand(s));
        dlog(
          `  [INVESTIGATE stand=${s.standId}] ` +
          `developmentClass=${s.developmentClass} is_seed_tree=${s.developmentClass?.includes("seed_tree")} ` +
          `is_shelterwood=${s.developmentClass?.includes("shelterwood")} ` +
          `regenerationSpecies=${regenSp} site_class=${s.siteClass} ` +
          `includes_mesic=${s.siteClass.includes("mesic")} includes_herbrich=${s.siteClass.includes("herb-rich")}`,
        );
      }
    }

    // ── Regeneration chain (no stems, no volume → freshly cleared) ──
    if (s.stemCount === 0 && s.volumeM3 === 0) {
      const delay = strategy.regenDelayYears();
      // Use clearYear (set at clearcut time) instead of ageYears —
      // growStand never increments age on dead stands (stemCount=0, volumeM3=0).
      if (s.clearYear > 0 && year - s.clearYear < delay) continue;
      // stemCount=0 && volumeM3=0 means site was clearcut — site prep + planting needed.
      // After planting APPLY sets stemCount > 0, so these stop spawning naturally.

      const rs = makeMinimalStand(s);
      const regenSp = strategy.regenerationSpecies(rs);
      const isPeat = s.soilType === "peatland";
      const prepType = isPeat ? "ditch_mounding"
        : goal === "carbon_storage" ? "scalping"
        : "site_prep";

      spawned.push({
        stand: rs,
        type: prepType,
        year,
        income_eur: 0,
        cost_eur: Math.round((COSTS[prepType] ?? 0) * s.areaHa),
        removal_m3: 0,
        removalFraction: 0,
        notes: `Regeneration site prep after clearcut`,
        dueYear: year,
      });

      const plantType = `${regenSp}_planting`;
      spawned.push({
        stand: rs,
        type: plantType,
        year,
        income_eur: 0,
        cost_eur: Math.round((COSTS[plantType] ?? 0) * s.areaHa),
        removal_m3: 0,
        removalFraction: 0,
        notes: `${regenSp} planting after clearcut`,
        dueYear: year,
      });
      continue;
    }

    // ── Overstory guard (seed tree / shelterwood stands) ──
    // "Ylispuidenpoisto" — remove remaining overstory trees once
    // the new seedling generation is established underneath.
    // Tapio guidelines: "kun taimikko on vakiintunut" (seedlings established).
    // MUST run BEFORE clearcut eligibility — seed_tree stands should never be clearcut.
    const hasOverstory = s.developmentClass?.includes("seed_tree") ||
                         s.developmentClass?.includes("shelterwood");
    if (hasOverstory) {
      if (s.volumeM3 < 30) {
        // Volume too low — seed trees have done their job.
        // Transition to regeneration: set stemCount=0 so the regen chain
        // at the top of spawnOperations picks it up next year.
        if (s.stemCount > 0) {
          s.stemCount = 0;
          s.ageYears = 0;
        }
        continue; // skip clearcut, overstory_removal, thinning, tending
      }
      // Overstory removal — spawn once. After APPLY, developmentClass→"seedling" prevents re-trigger.
      // First time seeing this stand — record the year
      if (s.overstoryStarted === 0) {
        s.overstoryStarted = year;
      }
      // Check if enough time has passed for seedlings to establish
      const delay = strategy.overstoryDelayYears();
      const yearsElapsed = year - s.overstoryStarted;
      if (yearsElapsed >= delay && s.volumeM3 > 0) {
        spawned.push({
          stand: makeMinimalStand(s),
          type: "overstory_removal",
          year,
          income_eur: computeOperationValue(s.volumeM3, s.species, "clear_cut", 1),
          cost_eur: 0,
          removal_m3: Math.round(s.volumeM3),
          removalFraction: 1,
          notes: `Overstory removal (seed trees, ~${yearsElapsed}y since seed cut), age ${s.ageYears}y`,
          dueYear: year,
        });
        continue;
      }
      continue; // skip clearcut and thinning for overstory stands
    }

    // ── Clearcut eligibility ──
    const [optMin, optMax] = getOptimalAge(s.species, s.siteClass);
    const ccAgeEligible = goal === "carbon_storage"
      ? s.ageYears >= optMax + 15  // only significantly over-mature
      : s.developmentClass === "mature_thinning"
        ? s.ageYears >= optMin + 10  // buffer: don't clearcut borderline mature_thinning
        : s.ageYears >= optMin;
    // Multi-metric gate: age alone is not enough — stand must be merchantable.
    // Tapio uudistuskypsyys requires sufficient diameter and volume/hectare.
    const minDiam = CLEARCUT_MIN_DIAMETER[s.species]?.[s.siteClass]
      ?? CLEARCUT_MIN_DIAMETER[s.species]?.mesic
      ?? 26;  // conservative fallback
    const ccReady = ccAgeEligible
      && s.meanDiameter >= minDiam                           // DBH threshold
      && s.volumeM3 / s.areaHa >= CLEARCUT_MIN_VOLUME_PER_HA; // economic volume

    if (ccReady && s.volumeM3 > 10) {
      // Step 1: Clearcut-eligible → always skip thinning, even if clearcut not spawned
      // Clearcut: after APPLY, age=0 → can't re-fire until regrown to optMin
      const opType = goal === "carbon_storage" ? "selection_cutting" : "clear_cut";
      const def = OPERATION_DEFAULTS[opType];
      const removal = s.volumeM3 * def.removalFraction;
      // Step 8: Peatland minimum harvest volume — Tapio recommends ≥40 m³/ha
      if (s.soilType !== "peatland" || removal / s.areaHa >= 40) {
        spawned.push({
          stand: makeMinimalStand(s),
          type: opType,
          year,
          income_eur: computeOperationValue(s.volumeM3, s.species, opType === "selection_cutting" ? "thinning" : "clear_cut", def.removalFraction),
          cost_eur: 0,
          removal_m3: Math.round(removal),
          removalFraction: def.removalFraction,
          notes: `${opType === "selection_cutting" ? "Selection cutting (carbon storage)" : "Clearcut"} at age ${s.ageYears}y [${optMin}–${optMax}y]`,
          dueYear: year,
        });
      }
      continue; // Step 1: skip thinning — this stand is clearcut-ready
    }

    // ── Thinning eligibility ──
    const firstThinThresh = THINNING_BA["first_thinning"]?.[s.species] ?? 18;
    const thinThresh = THINNING_BA["thinning"]?.[s.species] ?? 22;
    const minFirstAge = MIN_AGE_FIRST_THINNING?.[s.species] ?? 30;
    const minThinAge = MIN_AGE_THINNING?.[s.species] ?? 40;

    // Use Tapio-anchored basal area (N×π×(D/200)²), kept in sync by GROW/APPLY
    const currentBA = s.basalArea;

    // Step 7: Peatland thinning cap — Tapio recommends max 1-2 thinning passes
    if (s.soilType === "peatland" && s.thinningCount >= 2) {
      // Skip thinning — peatland stand at thinning limit
      // Fall through to tending checks
    } else {
      // First thinning check
      if (currentBA >= firstThinThresh && s.ageYears >= minFirstAge) {
        // Step 9: First thinning volume threshold — Tapio: ≥50 m³/ha standing volume
        const m3PerHa = s.volumeM3 / s.areaHa;
        if (m3PerHa >= 50) {
          // Tapio-driven removal: calculate fraction from stem count target
          const target = FIRST_THINNING_TARGET_STEMS_HA[s.species]?.[s.siteClass]
            ?? FIRST_THINNING_DEFAULT_TARGET;
          const stemsPerHa = s.stemCount; // already per-hectare

          // Only spawn first_thinning if current stems exceed Tapio target.
          if (stemsPerHa > target) {
            let removalFraction: number;
            if (stemsPerHa > target + 50) {
              removalFraction = (stemsPerHa - target) / Math.max(1, stemsPerHa);
              removalFraction = Math.min(FIRST_THINNING_MAX_REMOVAL, Math.max(FIRST_THINNING_MIN_REMOVAL, removalFraction));
            } else {
              removalFraction = FIRST_THINNING_MIN_REMOVAL;
            }
            const removal = s.volumeM3 * removalFraction;
            // Step 8: Peatland min harvest volume
            if (s.soilType !== "peatland" || removal / s.areaHa >= 40) {

                spawned.push({
                  stand: makeMinimalStand(s),
                  type: "first_thinning",
                  year,
                  income_eur: computeOperationValue(s.volumeM3, s.species, "first_thinning", removalFraction),
                  cost_eur: 0,
                  removal_m3: Math.round(removal),
                  removalFraction,
                  notes: `First thinning BA=${currentBA.toFixed(0)} ${Math.round(stemsPerHa)}→${target} stems/ha (${Math.round(removalFraction * 100)}%) age=${s.ageYears}y`,
                  dueYear: year,
                });
              }
          }
        }
      }
      // Regular thinning check (also runs if first_thinning was ineligible or skipped)
      if (currentBA >= thinThresh && s.ageYears >= minThinAge) {
        const m3PerHa = s.volumeM3 / s.areaHa;
        if (m3PerHa >= 50) {
          // Tapio-driven removal: calculate fraction from BA target
          const targetBA = THINNING_TARGET_BA[s.species]?.[s.siteClass]
            ?? THINNING_DEFAULT_TARGET_BA;
          let removalFraction: number;
          if (currentBA > targetBA) {
            removalFraction = (currentBA - targetBA) / Math.max(1, currentBA);
            removalFraction = Math.min(THINNING_MAX_REMOVAL, Math.max(THINNING_MIN_REMOVAL, removalFraction));
          } else {
            removalFraction = THINNING_MIN_REMOVAL; // stand at or below target — use minimum
          }
          const removal = s.volumeM3 * removalFraction;
          // Step 8: Peatland min harvest volume
          if (s.soilType !== "peatland" || removal / s.areaHa >= 40) {

              spawned.push({
                stand: makeMinimalStand(s),
                type: "thinning",
                year,
                income_eur: computeOperationValue(s.volumeM3, s.species, "thinning", removalFraction),
                cost_eur: 0,
                removal_m3: Math.round(removal),
                removalFraction,
                notes: `Thinning BA=${currentBA.toFixed(0)}→${targetBA} m²/ha (${Math.round(removalFraction * 100)}%) age=${s.ageYears}y`,
                dueYear: year,
              });
            }
        }
      }
    }

    // ── Tending eligibility (stem-count- and height-driven, Tapio thresholds) ──
    // Two independent checks: early_tending (high N, low H) and tending (moderate N, tall H).
    // No history flags needed — purely state-driven.
    const stemsPerHa = s.stemCount; // already per-hectare
    const etMaxHeight = EARLY_TENDING_MAX_HEIGHT[s.species] ?? 1.5;
    const tendMinHeight = TENDING_MIN_HEIGHT[s.species] ?? 3.5;

    // Early tending: very dense + still short
    if (stemsPerHa > EARLY_TENDING_STEM_THRESHOLD && s.meanHeight < etMaxHeight) {
      const removalFraction = stemsPerHa > 0
        ? Math.min(1, Math.max(0, (stemsPerHa - EARLY_TENDING_TARGET_STEMS_HA) / stemsPerHa))
        : 0;
      const removalM3 = Math.round(s.volumeM3 * removalFraction);
      spawned.push({
        stand: makeMinimalStand(s),
        type: "early_tending",
        year,
        income_eur: 0,
        cost_eur: Math.round(COSTS.early_tending * s.areaHa),
        removal_m3: removalM3,
        removalFraction,
        notes: `Early tending: ${Math.round(stemsPerHa)}→${EARLY_TENDING_TARGET_STEMS_HA} stems/ha, h=${s.meanHeight.toFixed(1)}m${s.plantingYear > 0 ? ` (${year - s.plantingYear}y post-plant)` : ""}`,
        dueYear: year,
      });
    }

    // Tending (taimikonharvennus): moderately dense + tall enough
    if (stemsPerHa > TENDING_STEM_THRESHOLD && s.meanHeight >= tendMinHeight) {
      const removalFraction = stemsPerHa > 0
        ? Math.min(1, Math.max(0, (stemsPerHa - TENDING_TARGET_STEMS_HA) / stemsPerHa))
        : 0;
      const removalM3 = Math.round(s.volumeM3 * removalFraction);
      spawned.push({
        stand: makeMinimalStand(s),
        type: "tending",
        year,
        income_eur: 0,
        cost_eur: Math.round(COSTS.tending * s.areaHa),
        removal_m3: removalM3,
        removalFraction,
        notes: `Tending: ${Math.round(stemsPerHa)}→${TENDING_TARGET_STEMS_HA} stems/ha (h=${s.meanHeight.toFixed(1)}m)`,
        dueYear: year,
      });
    }
  }

  return spawned;
}

// ═══════════════════════════════════════════════════════════════════════
// Candidate Priority Ordering
// ═══════════════════════════════════════════════════════════════════════

const OP_TYPE_GROUP: Record<string, number> = {
  first_thinning: 0,
  thinning: 0,
  selection_cutting: 0,
  overstory_removal: 0,
  clear_cut: 1,
  // Non-harvest ops get lowest priority — they don't consume volume cap
  early_tending: 2,
  tending: 2,
  site_prep: 2,
  ditch_mounding: 2,
  scalping: 2,
  spruce_planting: 2,
  pine_planting: 2,
};

function sortCandidates(candidates: PlannedOperation[], goal: PlanGoal): PlannedOperation[] {
  return [...candidates].sort((a, b) => {
    // 1. Primary: operation type group (thinnings before clearcuts before non-harvest)
    const ga = OP_TYPE_GROUP[a.type] ?? 0;
    const gb = OP_TYPE_GROUP[b.type] ?? 0;
    if (ga !== gb) return ga - gb;

    // 2. Secondary: waiting time (dueYear — earlier first)
    const dueA = a.dueYear ?? 0;
    const dueB = b.dueYear ?? 0;
    if (dueA !== dueB) return dueA - dueB;

    // 3. Tertiary: goal-specific metric
    switch (goal) {
      case "maximum_growth_aggressive":
      case "maximum_growth_balanced":
        return b.removal_m3 - a.removal_m3; // biggest volume first
      case "carbon_storage":
      case "balanced":
        return b.stand.ageYears - a.stand.ageYears; // oldest first
      default:
        return 0;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Main Scheduling Engine
// ═══════════════════════════════════════════════════════════════════════

export interface ScheduleResult {
  /** Map of year → operations scheduled that year */
  yearPlans: Map<number, PlannedOperation[]>;
  /** Final simulated state of each stand */
  finalStates: Map<string, SimStand>;
  /** Annual growth (m³/y) computed for each year during simulation */
  annualGrowthHistory: number[];
  /** Number of operations that could not be scheduled */
  overspillOps: number;
  /** Total removal m³ of overspill operations */
  overspillM3: number;
  /** Year-by-year snapshots of all stand states after GROW step */
  simulationSnapshots: YearSnapshot[];
}

/**
 * Compute current total annual growth from live stand states.
 * Uses Tapio-anchored growth model (H100/D_REF curves).
 */
function computeAnnualGrowth(stands: Map<string, SimStand>): number {
  let total = 0;
  for (const st of stands.values()) {
    if (st.stemCount > 0 && st.areaHa > 0) {
      const gPerHa = computeTapioAnnualGrowth(
        st.species, st.siteType, st.ageYears,
        st.stemCount, st.growthMultiplier,
      );
      total += gPerHa * st.areaHa;
    }
  }
  return total;
}

/**
 * Run the year-by-year scheduling engine.
 *
 * Starts from current stand data (year 0), then for each year:
 *   1. COMPUTE live annual growth → recalculate volume cap
 *   2. SPAWN — create operations for stands crossing thresholds
 *   3. MERGE — combine carryover + spawned
 *   4. SORT  — priority-order candidates
 *   5. SELECT — strategy picks ops under volume cap
 *   6. APPLY — mutate stand states
 *   7. GROW  — simulate one year of growth
 *   8. CARRYOVER — unselected ops to next year
 */
export function runScheduleEngine(
  forestStands: StandData[],
  startYear: number,
  periodYears: number,
  goal: PlanGoal,
  growthMultiplier = 1.0,
): ScheduleResult {
  const strategy = getStrategy(goal);
  const endYear = startYear + periodYears - 1;

  // Initialize mutable stand states
  const stands = new Map<string, SimStand>();
  for (const k of forestStands) {
    stands.set(k.standId, {
      standId: k.standId,
      areaHa: k.areaHa,
      siteType: k.siteType,
      soilType: k.soilType,
      species: k.mainSpecies,
      siteClass: k.site_class,
      volumeM3: k.volumeM3,
      ageYears: k.ageYears,
      basalArea: k.ba,
      valueEur: k.valueEur,
      developmentClass: k.developmentClass,
      overstoryStarted: 0,
      growthMultiplier,
      plantingYear: 0,
      clearYear: 0,
      thinningCount: 0,
      stemCount: k.stemCount,
      meanHeight: k.meanHeight,
      meanDiameter: k.meanDiameter,
      speciesData: k.speciesData,
    });
  }

  let carryover: PlannedOperation[] = [];
  const yearPlans = new Map<number, PlannedOperation[]>();
  const annualGrowthHistory: number[] = [];
  const simulationSnapshots: YearSnapshot[] = [];

  // ── SNAPSHOT year 0: initial state before any simulation ──
  {
    const year0Snapshot: YearSnapshot = {
      year: startYear - 1,
      stands: [],
    };
    for (const st of stands.values()) {
      year0Snapshot.stands.push(snapshotState(st, startYear - 1, true));
    }
    simulationSnapshots.push(year0Snapshot);
  }

  // ── DEBUG: one-time Tapio growth diagnostic ──
  {
    let totalGrowth = 0;
    let noGrowthCount = 0;
    for (const st of stands.values()) {
      if (st.stemCount <= 0 || st.areaHa <= 0) continue;
      const gPerHa = computeTapioAnnualGrowth(
        st.species, st.siteType, st.ageYears,
        st.stemCount, st.growthMultiplier,
      );
      totalGrowth += gPerHa * st.areaHa;
      if (gPerHa < 0.01) noGrowthCount++;
    }
    dlog(`[INIT] ${stands.size} stands  totalGrowth=${totalGrowth.toFixed(0)} m³/y  noGrowth=${noGrowthCount}`);
  }

  for (let yr = startYear; yr <= endYear; yr++) {
    // ── 1. Compute live annual growth → volume cap for THIS year ──
    const currentAnnualGrowth = computeAnnualGrowth(stands);
    annualGrowthHistory.push(currentAnnualGrowth);
    const volumeCapM3 = strategy.volumeCapMultiplier() * currentAnnualGrowth;

    // ── 2. SPAWN operations from current stand states ──
    const spawned = spawnOperations(stands, yr, startYear, strategy, goal);

    // ── 3. MERGE carryover + spawned → candidate pool ──
    const pool = [...carryover, ...spawned];

    // ── 4. SORT by priority ──
    const candidates = sortCandidates(pool, goal);

    // ── 5. SELECT operations for this year ──
    const { scheduled, remaining } = strategy.selectOperations(
      yr, stands, candidates, volumeCapM3, currentAnnualGrowth,
    );

    yearPlans.set(yr, scheduled);

    // ── DEBUG: log year-by-year scheduling details ──
    const harvestOps = scheduled.filter(
      (o) => ["clear_cut", "thinning", "first_thinning", "selection_cutting", "overstory_removal"].includes(o.type),
    );
    const schedHarvestM3 = harvestOps.reduce((s, o) => s + o.removal_m3, 0);
    const remainHarvestM3 = remaining
      .filter((o) => ["clear_cut", "thinning", "first_thinning", "selection_cutting", "overstory_removal"].includes(o.type))
      .reduce((s, o) => s + o.removal_m3, 0);

    if (scheduled.length > 0 || remaining.length > 0) {
      const byType: Record<string, { count: number; m3: number }> = {};
      for (const op of scheduled) {
        if (!byType[op.type]) byType[op.type] = { count: 0, m3: 0 };
        byType[op.type].count++;
        byType[op.type].m3 += op.removal_m3;
      }
      const typeDetail = Object.entries(byType)
        .map(([t, a]) => `${t}:${a.count}(${a.m3.toFixed(0)}m³)`)
        .join(" ");

      dlog(
        `[SCHED yr=${yr}] growth=${currentAnnualGrowth.toFixed(0)} cap=${volumeCapM3.toFixed(0)} ` +
        `pool=${carryover.length}c+${spawned.length}s→${candidates.length} ` +
        `sched=${scheduled.length}(${schedHarvestM3.toFixed(0)}m³) ` +
        `remain=${remaining.length}(${remainHarvestM3.toFixed(0)}m³) ` +
        `[${typeDetail}]`,
      );

      // Per-op removal_m3 for first 2 years
      if (yr <= startYear + 1) {
        for (const op of scheduled.slice(0, 5)) {
          dlog(`  [OP] stand=${op.stand.standId} type=${op.type} removal_m3=${op.removal_m3} income=${op.income_eur} vol=${op.stand.volumeM3} ba=${op.stand.ba} age=${op.stand.ageYears}`);
        }
        if (scheduled.length > 5) dlog(`  ... +${scheduled.length - 5} more ops`);
      }
    }

    // ── 6. GROW: simulate one year of growth on ALL stands ──
    for (const st of stands.values()) {
      // growStand handles cleared/invalid stands (ages but returns 0 growth)
      growStand(st, st.growthMultiplier);
      // Keep basalArea in sync with Tapio diameter + current stem count
      if (st.stemCount > 0) {
        st.basalArea = st.stemCount * Math.PI * Math.pow(st.meanDiameter / 200, 2);
      } else if (st.volumeM3 > 0 && st.meanHeight > 0) {
        // Estimate BA from volume for stands without stem count data
        const f = formFactor(st.species);
        st.basalArea = st.volumeM3 / (st.meanHeight * f * st.areaHa);
      }
    }

    // ── 7. APPLY operations to stand states (end of year, after growth) ──
    for (const op of scheduled) {
      const st = stands.get(op.stand.standId);
      if (!st) continue;

      if (op.type === "clear_cut") {
        st.volumeM3 = 0;
        st.ageYears = 0;
        st.stemCount = 0;
        st.meanHeight = 0;
        st.meanDiameter = 0;
        st.basalArea = 0;
        st.clearYear = yr;

        st.speciesData = [];
      } else if (op.type === "selection_cutting") {
        const pct = op.removalFraction;
        const oldVol = st.volumeM3;
        st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
        // Sync speciesData volumes
        const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
        for (const sp of st.speciesData) {
          sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
        }
      } else if (op.type === "overstory_removal") {
        // Remove overstory trees — seedlings remain underneath.
        st.volumeM3 = st.areaHa * 1;
        st.developmentClass = "seedling";
        // Scale speciesData to nominal seedling volume
        const oldTotalVol = st.speciesData.reduce((s, sp) => s + sp.volumeM3, 0);
        const volScale = oldTotalVol > 0 ? st.volumeM3 / oldTotalVol : 1;
        for (const sp of st.speciesData) {
          sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
        }
      } else if (op.type === "thinning" || op.type === "first_thinning") {
        const pct = op.removalFraction;
        const oldVol = st.volumeM3;
        const oldStems = st.stemCount;
        st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
        st.stemCount = Math.round(st.stemCount * (1 - pct));
        st.basalArea = st.stemCount * Math.PI * Math.pow(st.meanDiameter / 200, 2);

        st.thinningCount++;
        // Sync speciesData volumes and stems
        const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
        const stemScale = oldStems > 0 ? st.stemCount / oldStems : 1;
        for (const sp of st.speciesData) {
          sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
          sp.stemCount = Math.round(sp.stemCount * stemScale);
        }
      } else if (op.type === "early_tending") {
        const pct = op.removalFraction;
        const oldVol = st.volumeM3;
        const oldStems = st.stemCount;
        st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
        st.stemCount = EARLY_TENDING_TARGET_STEMS_HA;
        st.basalArea = st.stemCount * Math.PI * Math.pow(st.meanDiameter / 200, 2);
        // Sync speciesData volumes and stems
        const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
        const stemScale = oldStems > 0 ? st.stemCount / oldStems : 1;
        for (const sp of st.speciesData) {
          sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
          sp.stemCount = Math.round(sp.stemCount * stemScale);
        }
      } else if (op.type === "tending") {
        const pct = op.removalFraction;
        const oldVol = st.volumeM3;
        const oldStems = st.stemCount;
        st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
        st.stemCount = TENDING_TARGET_STEMS_HA;
        st.basalArea = st.stemCount * Math.PI * Math.pow(st.meanDiameter / 200, 2);
        // Sync speciesData volumes and stems
        const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
        const stemScale = oldStems > 0 ? st.stemCount / oldStems : 1;
        for (const sp of st.speciesData) {
          sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
          sp.stemCount = Math.round(sp.stemCount * stemScale);
        }
      } else if (op.type.includes("planting")) {

        st.plantingYear = yr;
        // Tapio initial seedling state
        const plantSpecies = op.type.replace("_planting", "");
        st.species = plantSpecies; // stand species changes to planted species
        const density = PLANTING_DENSITY[plantSpecies] ?? 1800;
        st.stemCount = density; // stems/ha (already per-hectare)
        st.meanHeight = PLANTING_INITIAL_HEIGHT_M;
        st.meanDiameter = PLANTING_INITIAL_DIAMETER_CM;
        st.ageYears = 0;
        st.basalArea = density * Math.PI * Math.pow(PLANTING_INITIAL_DIAMETER_CM / 200, 2);
        // Reset speciesData to only the planted species with seedling values
        st.speciesData = [{
          species: plantSpecies,
          volumeM3: st.volumeM3,
          logPct: 0,
          stemCount: density,
          meanHeight: PLANTING_INITIAL_HEIGHT_M,
          meanDiameter: PLANTING_INITIAL_DIAMETER_CM,
          age: 0,
          basalArea: 0,
          areaHa: st.areaHa,
        }];
      }
    }

    // ── 8. CARRYOVER: unselected ops pushed to next year ──
    carryover = remaining;

    // ── SNAPSHOT: capture all stand states for this year ──
    const yearSnapshot: YearSnapshot = {
      year: yr,
      stands: [],
    };
    for (const st of stands.values()) {
      yearSnapshot.stands.push(snapshotState(st, yr, false));
    }
    simulationSnapshots.push(yearSnapshot);
  }

  // ── 9. Track overspill (carryover ops that never fit) ──
  const overspillOps = carryover.length;
  const overspillM3 = carryover.reduce((s, o) => s + o.removal_m3, 0);
  if (overspillOps > 0) {
    dlog(`[OVERSPILL] ${overspillOps} ops (${overspillM3.toFixed(0)} m³) could not be scheduled within ${periodYears} years`);
  }

  return { yearPlans, finalStates: stands, annualGrowthHistory, overspillOps, overspillM3, simulationSnapshots };
}
// ═══════════════════════════════════════════════════════════════════════

/**
 * Schedule operations across the plan period.
 * Returns a single flat YearPlan[] array and a PlanSummary with
 * live-computed annual growth averages.
 */
export function schedulePlan(
  forestStands: StandData[],
  currentYear: number,
  periodYears: number,
  goal: PlanGoal = "balanced",
  growthMultiplier = 1.0,
): {
  years: YearPlan[];
  summary: PlanSummary;
  simulationSnapshots: YearSnapshot[];
} {
  const startYear = currentYear;

  const { yearPlans, annualGrowthHistory, overspillOps, overspillM3, simulationSnapshots } = runScheduleEngine(
    forestStands,
    startYear,
    periodYears,
    goal,
    growthMultiplier,
  );

  // Build flat YearPlan array
  const years: YearPlan[] = [];
  let totalIncome = 0;
  let totalCosts = 0;
  let harvestTotal = 0;

  for (let yr = startYear; yr < startYear + periodYears; yr++) {
    const yp: YearPlan = {
      year: yr,
      finalHarvests: [],
      thinnings: [],
      tendingOps: [],
      regenerationOps: [],
    };

    const ops = yearPlans.get(yr) ?? [];
    for (const op of ops) {
      switch (op.type) {
        case "clear_cut":
          yp.finalHarvests.push(op);
          totalIncome += op.income_eur;
          harvestTotal += op.removal_m3;
          break;
        case "thinning":
        case "first_thinning":
        case "selection_cutting":
        case "overstory_removal":
          yp.thinnings.push(op);
          totalIncome += op.income_eur;
          harvestTotal += op.removal_m3;
          break;
        case "tending":
        case "early_tending":
          yp.tendingOps.push(op);
          totalCosts += op.cost_eur;
          break;
        default:
          yp.regenerationOps.push(op);
          totalCosts += op.cost_eur;
          break;
      }
    }

    years.push(yp);
  }

  // Compute summary with live annual growth average
  const totalVolume = forestStands.reduce((s, k) => s + k.volumeM3, 0);
  const avgAnnualGrowth = annualGrowthHistory.length > 0
    ? annualGrowthHistory.reduce((a, b) => a + b, 0) / annualGrowthHistory.length
    : 0;

  const summary: PlanSummary = {
    totalVolume,
    annualGrowth: Math.round(avgAnnualGrowth),
    stumpageValue: totalIncome,  // computed from volumes × prices at operation time
    averageHarvestPerYear: periodYears > 0 ? harvestTotal / periodYears : 0,
    harvestVsGrowth:
      avgAnnualGrowth > 0
        ? Math.round((harvestTotal / avgAnnualGrowth / periodYears) * 100)
        : 0,
    totalIncome,
    totalCosts,
    overspillOps,
    overspillM3: Math.round(overspillM3),
  };

  return { years, summary, simulationSnapshots };
}
