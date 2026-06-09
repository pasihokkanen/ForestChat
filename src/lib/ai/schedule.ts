// src/lib/ai/schedule.ts
// Phase 7b rewrite: Year-by-year forest plan scheduling engine.
//
// Instead of classifying all operations at year 0 (static), this engine
// walks year by year through the plan period, simulating stand growth and
// spawning operations DYNAMICALLY when stands cross biological thresholds.
//
// No stand splitting. No initial operation pool. All operations are spawned
// on-demand from the current simulated state.

import type { StandData, PlannedOperation, PlanGoal, YearPlan, PlanSummary } from "./types";
import { getOptimalAge, THINNING_BA, MIN_AGE_FIRST_THINNING, MIN_AGE_THINNING, getPrices, COSTS, OPERATION_DEFAULTS } from "./config";
import { getGrowthRate } from "./chart-engine";
import { getStrategy, type SchedulingStrategy } from "./strategies";
import * as fs from "fs";

const DEBUG_LOG = "/tmp/schedule-debug.log";
function dlog(msg: string) {
  try { fs.appendFileSync(DEBUG_LOG, msg + "\n"); } catch {}
}

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
  cleared: boolean;
  /** Original development class from DB (seed_tree, shelterwood, etc.) */
  developmentClass: string;
  /** Year when clearcut happened (0 = not cleared). Used for regen delay timing. */
  regenDelayStarted: number;
  /** Year when stand was last tended. 0 = never. Prevents re-tending. */
  tendedYear: number;
  /** Year when seed_tree/shelterwood stand was first seen (0 = not applicable). */
  overstoryStarted: number;
  /** Set of operation types already spawned for this stand (prevents duplicates). */
  spawnedTypes: Set<string>;
  growthMultiplier: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function makeMinimalStand(s: SimStand): StandData {
  return {
    standId: s.standId,
    areaHa: s.areaHa,
    developmentClass: "",
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
  };
}

/** Get the price ratio of a thinning tier vs clearcut tier for a species. */
function thinningPriceRatio(species: string, tier: "first_thinning" | "thinning"): number {
  const sp = species === "birch" ? "silver_birch" : species;
  const tp = getPrices(tier, sp);
  const cp = getPrices("clear_cut", sp);
  const tSum = tp.tukki + tp.kuitu;
  const cSum = cp.tukki + cp.kuitu;
  return cSum > 0 ? tSum / cSum : 0.7;
}

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
        `spawnedTypes=[${[...s.spawnedTypes].join(",")}] ` +
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

    // ── Regeneration chain (cleared stands) ──
    if (s.cleared) {
      const delay = strategy.regenDelayYears();
      const waitYears = year - s.regenDelayStarted;
      if (waitYears < delay) continue;
      if (waitYears > delay + 2) continue; // don't keep spawning years later

      const rs = makeMinimalStand(s);
      const regenSp = strategy.regenerationSpecies(rs);
      const isPeat = s.soilType === "peatland";
      const sitePrepKey = "spawned_site_prep";
      const plantKey = "spawned_planting";

      if (!s.spawnedTypes.has(sitePrepKey)) {
        const prepType = isPeat ? "ditch_mounding"
          : goal === "carbon_storage" ? "scalping"
          : "site_prep";
        s.spawnedTypes.add(sitePrepKey);
        spawned.push({
          stand: rs,
          type: prepType,
          year,
          income_eur: 0,
          cost_eur: Math.round((COSTS[prepType] ?? 0) * s.areaHa),
          removal_m3: 0,
          notes: `Regeneration site prep after clearcut`,
          dueYear: year,
        });
      }

      if (!s.spawnedTypes.has(plantKey)) {
        const plantType = `${regenSp}_planting`;
        s.spawnedTypes.add(plantKey);
        spawned.push({
          stand: rs,
          type: plantType,
          year,
          income_eur: 0,
          cost_eur: Math.round((COSTS[plantType] ?? 0) * s.areaHa),
          removal_m3: 0,
          notes: `${regenSp} planting after clearcut`,
          dueYear: year,
        });
      }
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
        // Transition to regeneration: mark as cleared so the regen chain
        // at the top of spawnOperations picks it up next year.
        if (!s.cleared) {
          s.cleared = true;
          s.regenDelayStarted = year;
        }
        continue; // skip clearcut, overstory_removal, thinning, tending
      }
      if (!s.spawnedTypes.has("overstory_removal")) {
        // First time seeing this stand — record the year
        if (s.overstoryStarted === 0) {
          s.overstoryStarted = year;
        }
        // Check if enough time has passed for seedlings to establish
        const delay = strategy.overstoryDelayYears();
        const yearsElapsed = year - s.overstoryStarted;
        if (yearsElapsed >= delay && s.volumeM3 > 0) {
          s.spawnedTypes.add("overstory_removal");
          spawned.push({
            stand: makeMinimalStand(s),
            type: "overstory_removal",
            year,
            income_eur: Math.round(s.valueEur),
            cost_eur: 0,
            removal_m3: Math.round(s.volumeM3),
            notes: `Overstory removal (seed trees, ~${yearsElapsed}y since seed cut), age ${s.ageYears}y`,
            dueYear: year,
          });
          continue;
        }
      }
      continue; // skip clearcut and thinning for overstory stands
    }

    // ── Clearcut eligibility ──
    const [optMin, optMax] = getOptimalAge(s.species, s.siteClass);
    const ccEligible = goal === "carbon_storage"
      ? s.ageYears >= optMax + 15  // only significantly over-mature
      : s.developmentClass === "mature_thinning"
        ? s.ageYears >= optMin + 10  // buffer: don't clearcut borderline mature_thinning
        : s.ageYears >= optMin;

    if (ccEligible && s.volumeM3 > 10 && !s.spawnedTypes.has("clear_cut")) {
      s.spawnedTypes.add("clear_cut");
      const opType = goal === "carbon_storage" ? "selection_cutting" : "clear_cut";
      const def = OPERATION_DEFAULTS[opType];
      spawned.push({
        stand: makeMinimalStand(s),
        type: opType,
        year,
        income_eur: Math.round(s.valueEur * def.removalFraction),
        cost_eur: 0,
        removal_m3: Math.round(s.volumeM3 * def.removalFraction),
        notes: `${opType === "selection_cutting" ? "Selection cutting (carbon storage)" : "Clearcut"} at age ${s.ageYears}y [${optMin}–${optMax}y]`,
        dueYear: year,
      });
      continue;
    }

    // ── Thinning eligibility ──
    const firstThinThresh = THINNING_BA["first_thinning"]?.[s.species] ?? 18;
    const thinThresh = THINNING_BA["thinning"]?.[s.species] ?? 22;
    const minFirstAge = MIN_AGE_FIRST_THINNING?.[s.species] ?? 30;
    const minThinAge = MIN_AGE_THINNING?.[s.species] ?? 40;

    if (s.basalArea >= firstThinThresh && s.ageYears >= minFirstAge && !s.spawnedTypes.has("first_thinning")) {
      s.spawnedTypes.add("first_thinning");
      const def = OPERATION_DEFAULTS["first_thinning"];
      const ratio = thinningPriceRatio(s.species, "first_thinning");
      const removal = s.volumeM3 * def.removalFraction;
      spawned.push({
        stand: makeMinimalStand(s),
        type: "first_thinning",
        year,
        income_eur: Math.round(s.valueEur * def.removalFraction * ratio),
        cost_eur: 0,
        removal_m3: Math.round(removal),
        notes: `First thinning BA=${s.basalArea.toFixed(0)} age=${s.ageYears}y`,
        dueYear: year,
      });
    } else if (s.basalArea >= thinThresh && s.ageYears >= minThinAge && !s.spawnedTypes.has("thinning")) {
      s.spawnedTypes.add("thinning");
      const def = OPERATION_DEFAULTS["thinning"];
      const ratio = thinningPriceRatio(s.species, "thinning");
      const removal = s.volumeM3 * def.removalFraction;
      spawned.push({
        stand: makeMinimalStand(s),
        type: "thinning",
        year,
        income_eur: Math.round(s.valueEur * def.removalFraction * ratio),
        cost_eur: 0,
        removal_m3: Math.round(removal),
        notes: `Thinning BA=${s.basalArea.toFixed(0)} age=${s.ageYears}y`,
        dueYear: year,
      });
    }

    // ── Tending eligibility (seedling stands, once only) ──
    if (s.tendedYear === 0 && !s.spawnedTypes.has("tending") && !s.spawnedTypes.has("early_tending")) {
      if (s.ageYears >= 3 && s.ageYears <= 12) {
        const def = OPERATION_DEFAULTS["early_tending"];
        s.spawnedTypes.add("early_tending");
        spawned.push({
          stand: makeMinimalStand(s),
          type: "early_tending",
          year,
          income_eur: 0,
          cost_eur: Math.round(COSTS.early_tending * s.areaHa),
          removal_m3: Math.round(s.volumeM3 * def.removalFraction),
          notes: `Early tending at age ${s.ageYears}y`,
          dueYear: year,
        });
      } else if (s.ageYears >= 10 && s.ageYears <= 25) {
        const def = OPERATION_DEFAULTS["tending"];
        s.spawnedTypes.add("tending");
        spawned.push({
          stand: makeMinimalStand(s),
          type: "tending",
          year,
          income_eur: 0,
          cost_eur: Math.round(COSTS.tending * s.areaHa),
          removal_m3: Math.round(s.volumeM3 * def.removalFraction),
          notes: `Tending at age ${s.ageYears}y`,
          dueYear: year,
        });
      }
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
}

/**
 * Compute current total annual growth from live stand states.
 * Uses VMI13 base rates × species × growth multiplier (forPlanning=true).
 */
function computeAnnualGrowth(stands: Map<string, SimStand>): number {
  let total = 0;
  for (const st of stands.values()) {
    if (!st.cleared && st.areaHa > 0) {
      const gPerHa = getGrowthRate(
        st.siteType, st.soilType, st.species,
        st.ageYears, st.basalArea, null,
        st.growthMultiplier,
        st.areaHa > 0 ? st.volumeM3 / st.areaHa : undefined,
        true,
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
      cleared: false,
      developmentClass: k.developmentClass,
      regenDelayStarted: 0,
      tendedYear: 0,
      overstoryStarted: 0,
      spawnedTypes: new Set(),
      growthMultiplier,
    });
  }

  let carryover: PlannedOperation[] = [];
  const yearPlans = new Map<number, PlannedOperation[]>();
  const annualGrowthHistory: number[] = [];

  // ── DEBUG: one-time diagnostic — carrying-capacity cap impact ──
  {
    let cappedCount = 0;
    let zeroGrowthCount = 0;
    let totalGrowth = 0;
    for (const st of stands.values()) {
      if (st.cleared || st.areaHa <= 0) continue;
      const gPerHa = getGrowthRate(
        st.siteType, st.soilType, st.species,
        st.ageYears, st.basalArea, null,
        st.growthMultiplier,
        st.areaHa > 0 ? st.volumeM3 / st.areaHa : undefined,
        true,
      );
      totalGrowth += gPerHa * st.areaHa;
      if (gPerHa < 0.01) zeroGrowthCount++;
      else if (st.volumeM3 > 0) {
        const gUncapped = getGrowthRate(
          st.siteType, st.soilType, st.species,
          st.ageYears, st.basalArea, null,
          st.growthMultiplier,
          undefined,
          true,
        );
        if (gUncapped > gPerHa * 1.01) cappedCount++;
      }
    }
    dlog(`[INIT] ${stands.size} stands  totalGrowth=${totalGrowth.toFixed(0)} m³/y  capped=${cappedCount}  zeroGrowth=${zeroGrowthCount}`);
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

    // ── 6. APPLY operations to stand states ──
    for (const op of scheduled) {
      const st = stands.get(op.stand.standId);
      if (!st) continue;

      if (op.type === "clear_cut") {
        st.volumeM3 = 0;
        st.basalArea = 0;
        st.ageYears = 0;
        st.valueEur = 0;
        st.cleared = true;
        st.regenDelayStarted = yr;
        st.spawnedTypes.clear();
        st.tendedYear = 0;
      } else if (op.type === "selection_cutting") {
        const removal = op.removal_m3;
        const pct = st.volumeM3 > 0 ? removal / st.volumeM3 : 0;
        st.volumeM3 = Math.max(0, st.volumeM3 - removal);
        st.basalArea = Math.max(0, st.basalArea * (1 - Math.min(pct, 1)));
        st.valueEur = Math.max(0, Math.round(st.valueEur * (1 - Math.min(pct, 1))));
      } else if (op.type === "overstory_removal") {
        // Remove overstory trees — seedlings remain underneath.
        // Unlike clearcut, the stand is NOT marked cleared — growth continues.
        st.volumeM3 = st.areaHa * 1; // nominal seedling volume
        st.basalArea = 2;             // seedling BA
        st.valueEur = Math.round(st.areaHa * 50);
        st.developmentClass = "seedling";
        st.spawnedTypes.clear();
      } else if (op.type === "thinning" || op.type === "first_thinning") {
        const removal = op.removal_m3;
        const pct = st.volumeM3 > 0 ? removal / st.volumeM3 : 0;
        st.volumeM3 = Math.max(0, st.volumeM3 - removal);
        st.basalArea = Math.max(0, st.basalArea * (1 - Math.min(pct, 1)));
        st.valueEur = Math.max(0, Math.round(st.valueEur * (1 - Math.min(pct, 1))));
        st.spawnedTypes.delete(op.type);
      } else if (op.type === "early_tending" || op.type === "tending") {
        const removal = op.removal_m3;
        st.volumeM3 = Math.max(0, st.volumeM3 - removal);
        st.tendedYear = yr;
        st.spawnedTypes.delete("early_tending");
        st.spawnedTypes.delete("tending");
      } else if (op.type.includes("planting")) {
        st.cleared = false;
        st.regenDelayStarted = 0;
        if (st.basalArea === 0) st.basalArea = 2;
        if (st.volumeM3 === 0) st.volumeM3 = st.areaHa * 1;
        if (st.valueEur === 0) st.valueEur = Math.round(st.areaHa * 50);
        st.spawnedTypes.clear();
      }
    }

    // ── 7. GROW: simulate one year of growth on ALL stands ──
    for (const st of stands.values()) {
      if (!st.cleared && st.areaHa > 0) {
        const growthPerHa = getGrowthRate(
          st.siteType, st.soilType, st.species,
          st.ageYears, st.basalArea, null,
          st.growthMultiplier,
          st.areaHa > 0 ? st.volumeM3 / st.areaHa : undefined,
          true,
        );
        const growthM3 = growthPerHa * st.areaHa;
        if (st.volumeM3 > 0) {
          const ratio = growthM3 / st.volumeM3;
          st.valueEur = Math.round(st.valueEur * (1 + ratio));
        }
        st.volumeM3 += growthM3;
      }
      st.ageYears += 1;
    }

    // ── 8. CARRYOVER: unselected ops pushed to next year ──
    carryover = remaining;
  }

  // ── 9. Track overspill (carryover ops that never fit) ──
  const overspillOps = carryover.length;
  const overspillM3 = carryover.reduce((s, o) => s + o.removal_m3, 0);
  if (overspillOps > 0) {
    dlog(`[OVERSPILL] ${overspillOps} ops (${overspillM3.toFixed(0)} m³) could not be scheduled within ${periodYears} years`);
  }

  return { yearPlans, finalStates: stands, annualGrowthHistory, overspillOps, overspillM3 };
}

// ═══════════════════════════════════════════════════════════════════════
// Public API (called by generate-plan.ts)
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
} {
  const startYear = currentYear;

  const { yearPlans, annualGrowthHistory, overspillOps, overspillM3 } = runScheduleEngine(
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
  const totalValue = forestStands.reduce((s, k) => s + k.valueEur, 0);
  const avgAnnualGrowth = annualGrowthHistory.length > 0
    ? annualGrowthHistory.reduce((a, b) => a + b, 0) / annualGrowthHistory.length
    : 0;

  const summary: PlanSummary = {
    totalVolume,
    annualGrowth: Math.round(avgAnnualGrowth),
    stumpageValue: totalValue,
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

  return { years, summary };
}
