// src/lib/ai/schedule.ts

import type { StandData, PlannedOperation, YearPlan, PlanSummary } from "./types";
import { getOptimalAge, COSTS } from "./config";

/**
 * Schedule operations across two 10-year periods.
 *
 * Ported from build_plan_v3_fixed.py lines 391-621.
 */
export function schedulePlan(
  forestStands: StandData[],
  operations: PlannedOperation[],
  currentYear: number
): {
  p1: YearPlan[];
  p2: YearPlan[];
  summary: PlanSummary;
} {
  const startYear = currentYear;
  const yearsP1 = Array.from({ length: 10 }, (_, i) => startYear + i);
  const yearsP2 = Array.from({ length: 10 }, (_, i) => startYear + 10 + i);

  // ── Categorize operations ──
  const finalHarvests: PlannedOperation[] = [];
  const thinnings: PlannedOperation[] = [];
  const selectionCuts: PlannedOperation[] = [];
  const tendingOps: PlannedOperation[] = [];
  const regenerationOps: PlannedOperation[] = [];

  for (const op of operations) {
    switch (op.type) {
      case "clear_cut":
        finalHarvests.push(op);
        break;
      case "thinning":
      case "first_thinning":
        thinnings.push(op);
        break;
      case "selection_cutting":
        selectionCuts.push(op);
        break;
      case "early_tending":
      case "tending":
        tendingOps.push(op);
        break;
      case "site_prep":
      case "spruce_planting":
      case "pine_planting":
      case "scalping":
        regenerationOps.push(op);
        break;
    }
  }

  // ── Initialize year slots ──
  const p1: YearPlan[] = yearsP1.map((y) => ({ year: y, finalHarvests: [], thinnings: [], tendingOps: [], regenerationOps: [] }));
  const p2: YearPlan[] = yearsP2.map((y) => ({ year: y, finalHarvests: [], thinnings: [], tendingOps: [], regenerationOps: [] }));

  const getP1 = (y: number): YearPlan => p1[yearsP1.indexOf(y)];
  const getP2 = (y: number): YearPlan => p2[yearsP2.indexOf(y)];

  // ── Urgency sort for final harvests ──
  function urgency(op: PlannedOperation): number {
    const k = op.stand;
    const age = k.ageYears;
    const sp = k.mainSpecies;
    const site = k.site_class;
    const [, optMax] = getOptimalAge(sp, site);
    return -(age - optMax);
  }
  finalHarvests.sort((a, b) => urgency(a) - urgency(b));

  // ── Place K7 split (3 parts) ──
  const k7Idx = finalHarvests.findIndex((op) => Math.abs(parseFloat(op.stand.standId.replace(",", ".")) - 7.0) < 0.01);
  if (k7Idx !== -1) {
    const k7 = finalHarvests.splice(k7Idx, 1)[0];
    const k = k7.stand;
    const income = k7.income_eur;
    const volumeTotal = k7.removal_m3;
    const areaHa = k.areaHa;

    const parts: [number, number][] = [[2026, 0.35], [2028, 0.33], [2031, 0.32]];
    for (let partI = 0; partI < parts.length; partI++) {
      const [yr, frac] = parts[partI];
      const sv = Math.round(income * frac);
      const sm = Math.round(volumeTotal * frac);
      const sa = Math.round(areaHa * frac * 10) / 10;
      const subK = { ...k, areaHa: sa };

      getP1(yr).finalHarvests.push({
        stand: subK,
        type: "clear_cut",
        year: yr,
        income_eur: sv,
        cost_eur: 0,
        removal_m3: sm,
        notes: `Stand 7 part ${partI + 1}/3`,
      });
      getP1(yr).regenerationOps.push({
        stand: subK,
        type: "site_prep",
        year: yr,
        income_eur: 0,
        cost_eur: Math.round(COSTS.site_prep * sa),
        removal_m3: 0,
        notes: "",
      });
      const plantYr = yr + 1;
      if (plantYr <= 2035) {
        getP1(plantYr).regenerationOps.push({
          stand: subK,
          type: "spruce_planting",
          year: plantYr,
          income_eur: 0,
          cost_eur: Math.round(COSTS.spruce_planting * sa),
          removal_m3: 0,
          notes: `Planting part ${partI + 1}`,
        });
      }
    }
  }

  // ── Place K184 split (2 parts) ──
  const k184Idx = finalHarvests.findIndex((op) => Math.abs(parseFloat(op.stand.standId.replace(",", ".")) - 184.0) < 0.01);
  if (k184Idx !== -1) {
    const k184 = finalHarvests.splice(k184Idx, 1)[0];
    const k = k184.stand;
    const income = k184.income_eur;
    const volumeTotal = k184.removal_m3;
    const areaHa = k.areaHa;

    const parts: [number, number][] = [[2029, 0.5], [2034, 0.5]];
    for (let partI = 0; partI < parts.length; partI++) {
      const [yr, frac] = parts[partI];
      const sv = Math.round(income * frac);
      const sm = Math.round(volumeTotal * frac);
      const sa = Math.round(areaHa * frac * 10) / 10;
      const subK = { ...k, areaHa: sa };

      getP1(yr).finalHarvests.push({
        stand: subK,
        type: "clear_cut",
        year: yr,
        income_eur: sv,
        cost_eur: 0,
        removal_m3: sm,
        notes: `Stand 184 part ${partI + 1}/2`,
      });
      getP1(yr).regenerationOps.push({
        stand: subK,
        type: "site_prep",
        year: yr,
        income_eur: 0,
        cost_eur: Math.round(COSTS.site_prep * sa),
        removal_m3: 0,
        notes: "",
      });
      const plantYr = yr + 1;
      if (plantYr <= 2035) {
        getP1(plantYr).regenerationOps.push({
          stand: subK,
          type: "pine_planting",
          year: plantYr,
          income_eur: 0,
          cost_eur: Math.round(COSTS.pine_planting * sa),
          removal_m3: 0,
          notes: `Planting part ${partI + 1}`,
        });
      }
    }
  }

  // ── Place K180 selection cutting 2028 ──
  if (selectionCuts.length > 0) {
    const k180 = selectionCuts[0];
    getP1(2028).finalHarvests.push({
      ...k180,
      year: 2028,
    });
  }

  // ── Hand-place stand 5 thinning to 2033 ──
  const k5 = forestStands.find((k) => Math.abs(parseFloat(k.standId.replace(",", ".")) - 5.0) < 0.01);
  if (k5 && k5._manual_year) {
    const my = k5._manual_year;
    const op5Idx = thinnings.findIndex((op) => Math.abs(parseFloat(op.stand.standId.replace(",", ".")) - 5.0) < 0.01);
    if (op5Idx !== -1) {
      const op5 = thinnings.splice(op5Idx, 1)[0];
      getP1(my).thinnings.push({
        ...op5,
        year: my,
        notes: `BA estimated ~28 (2020→2033, 13y gap). MOVED 2026→2033`,
      });
    }
  }

  // ── Calculate already_placed count ──
  const alreadyInP1 = 3 + 2 + 1; // K7 parts, K184 parts, K180
  const slotsForP1 = 12;

  const p1AvailableYears = yearsP1.filter((y) => ![2026, 2028, 2029, 2031, 2034].includes(y));

  const p1Remaining = finalHarvests.slice(0, slotsForP1);
  const p2Remaining = finalHarvests.slice(slotsForP1);

  // ── Distribute remaining final harvests to P1 ──
  let p1YearIdx = 0;
  for (const op of p1Remaining) {
    const yr = p1AvailableYears[p1YearIdx % p1AvailableYears.length];
    const k = op.stand;
    getP1(yr).finalHarvests.push({
      stand: k,
      type: "clear_cut",
      year: yr,
      income_eur: op.income_eur,
      cost_eur: 0,
      removal_m3: op.removal_m3,
      notes: op.notes,
    });
    const costMounding = Math.round(COSTS.site_prep * k.areaHa);
    getP1(yr).regenerationOps.push({
      stand: k,
      type: "site_prep",
      year: yr,
      income_eur: 0,
      cost_eur: costMounding,
      removal_m3: 0,
      notes: "",
    });
    const plantYr = yr + 1;
    if (plantYr <= 2035) {
      const isMoist = k.site_class.includes("tuore") || k.site_class.includes("lehto");
      const plantType = isMoist ? "spruce_planting" : "pine_planting";
      const plantCost = Math.round(COSTS[plantType] * k.areaHa);
      getP1(plantYr).regenerationOps.push({
        stand: k,
        type: plantType,
        year: plantYr,
        income_eur: 0,
        cost_eur: plantCost,
        removal_m3: 0,
        notes: "",
      });
    }
    p1YearIdx++;
  }

  // ── Distribute to P2 (interleaved: even first, then odd) ──
  const p2Interleaved = [...yearsP2.filter((y) => y % 2 === 0), ...yearsP2.filter((y) => y % 2 !== 0)];
  let p2YearIdx = 0;
  for (const op of p2Remaining) {
    const yr = p2Interleaved[p2YearIdx % p2Interleaved.length];
    const k = op.stand;
    const yearsFromNow = yr - startYear;
    const ageAtYr = k.ageYears + yearsFromNow;
    const m3Grown = k.volumeM3 + k.annual_growth * yearsFromNow;
    const valueGrown = k.volumeM3 > 0 ? Math.round(op.income_eur * (m3Grown / k.volumeM3)) : 0;

    getP2(yr).finalHarvests.push({
      stand: k,
      type: "clear_cut",
      year: yr,
      income_eur: valueGrown,
      cost_eur: 0,
      removal_m3: Math.round(m3Grown),
      notes: `Extended period, projected age ${ageAtYr.toFixed(0)}y`,
    });
    const costMounding = Math.round(COSTS.site_prep * k.areaHa);
    getP2(yr).regenerationOps.push({
      stand: k,
      type: "site_prep",
      year: yr,
      income_eur: 0,
      cost_eur: costMounding,
      removal_m3: 0,
      notes: "",
    });
    const plantYr = yr + 1;
    if (plantYr <= yearsP2[yearsP2.length - 1]) {
      const isMoist = k.site_class.includes("tuore") || k.site_class.includes("lehto");
      const plantType = isMoist ? "spruce_planting" : "pine_planting";
      const plantCost = Math.round(COSTS[plantType] * k.areaHa);
      getP2(plantYr).regenerationOps.push({
        stand: k,
        type: plantType,
        year: plantYr,
        income_eur: 0,
        cost_eur: plantCost,
        removal_m3: 0,
        notes: "",
      });
    }
    p2YearIdx++;
  }

  // ── Distribute thinnings evenly (excluding stand 5, already removed) ──
  const harvYearsPool: number[] = [];
  for (const y of yearsP1) {
    for (let i = 0; i < 5; i++) {
      harvYearsPool.push(y);
    }
  }
  const trimmedPool = harvYearsPool.slice(0, thinnings.length);

  for (let i = 0; i < thinnings.length; i++) {
    const op = thinnings[i];
    const yr = trimmedPool[i];
    getP1(yr).thinnings.push({
      ...op,
      year: yr,
    });
  }

  // ── Schedule tending operations ──
  for (const op of tendingOps) {
    const k = op.stand;
    const age = k.ageYears;
    let target: number | null = null;

    if (op.type === "early_tending") {
      if (age < 3) target = startYear + Math.floor(3 - age);
      else if (age <= 12) target = startYear;
      else continue;
    } else {
      // Tending
      if (age < 10) target = startYear + Math.floor(10 - age);
      else if (age <= 25) target = startYear + Math.min(3, Math.floor(25 - age));
      else continue;
    }

    if (target !== null && target <= yearsP1[yearsP1.length - 1]) {
      getP1(target).tendingOps.push({
        ...op,
        year: target,
      });
    }
  }

  // ── Future tending for young saplings in P2 ──
  for (const k of forestStands) {
    const devClass = k.developmentClass;
    const age = k.ageYears;
    if (devClass.includes("seedling") && age < 3) {
      const target = startYear + Math.floor(10 - age);
      if (target >= yearsP2[0] && target <= yearsP2[yearsP2.length - 1]) {
        getP2(target).tendingOps.push({
          stand: k,
          type: "tending",
          year: target,
          income_eur: 0,
          cost_eur: Math.round(COSTS.tending * k.areaHa),
          removal_m3: 0,
          notes: "Projected",
        });
      }
    }
  }

  // ── K2 candidates (stands maturing in period 2) ──
  interface K2Candidate {
    urgencyScore: number;
    targetYr: number;
    k: StandData;
  }
  const k2Candidates: K2Candidate[] = [];

  for (const k of forestStands) {
    const devClass = k.developmentClass;
    const sp = k.mainSpecies;
    const site = k.site_class;
    const age = k.ageYears;
    const standNum = parseFloat(k.standId.replace(",", "."));

    // Skip already scheduled or special
    const alreadyScheduled = p1.some((yp) =>
      [...yp.finalHarvests, ...yp.thinnings, ...yp.tendingOps, ...yp.regenerationOps].some((op) => op.stand === k && op.type === "clear_cut")
    );
    if (alreadyScheduled) continue;
    if (Math.abs(standNum - 180.0) < 0.01 || Math.abs(standNum - 128.0) < 0.01) continue;
    if (Math.abs(standNum - 71.0) < 0.01 || Math.abs(standNum - 72.0) < 0.01) continue;

    const [optMin] = getOptimalAge(sp, site);

    if (devClass.includes("regeneration_ready") || (devClass.includes("mature_thinning") && age + (yearsP2[0] - startYear) >= optMin)) {
      const yearsToOpt = Math.max(0, optMin - age);
      const targetYr = startYear + Math.floor(yearsToOpt);
      if (targetYr <= yearsP2[yearsP2.length - 1] && targetYr >= yearsP2[0]) {
        const [, optMax] = getOptimalAge(sp, site);
        const urgencyScore = age - optMax;
        k2Candidates.push({ urgencyScore, targetYr, k });
      }
    }
  }

  // Sort: most urgent first (highest urgency score = most overdue)
  k2Candidates.sort((a, b) => b.urgencyScore - a.urgencyScore);

  const k2AllYears = [...yearsP2.filter((y) => y % 2 === 0), ...yearsP2.filter((y) => y % 2 !== 0)];
  let k2Idx = 0;

  for (const { k } of k2Candidates) {
    const areaHa = k.areaHa;
    const volumeM3 = k.volumeM3;
    const valueEur = k.valueEur;
    const age = k.ageYears;
    const site = k.site_class;

    const spreadYr = k2AllYears[k2Idx % k2AllYears.length];
    k2Idx++;

    const yearsFromNow = spreadYr - startYear;
    const ageAtTarget = age + yearsFromNow;
    const m3Grown = volumeM3 + k.annual_growth * yearsFromNow;
    const valueGrown = volumeM3 > 0 ? Math.round(valueEur * (m3Grown / volumeM3)) : 0;

    getP2(spreadYr).finalHarvests.push({
      stand: k,
      type: "clear_cut",
      year: spreadYr,
      income_eur: valueGrown,
      cost_eur: 0,
      removal_m3: Math.round(m3Grown),
      notes: `Matures in period 2, age ${ageAtTarget.toFixed(0)}y`,
    });
    const costMounding = Math.round(COSTS.site_prep * areaHa);
    getP2(spreadYr).regenerationOps.push({
      stand: k,
      type: "site_prep",
      year: spreadYr,
      income_eur: 0,
      cost_eur: costMounding,
      removal_m3: 0,
      notes: "",
    });
    const plantYr = spreadYr + 1;
    if (plantYr <= yearsP2[yearsP2.length - 1]) {
      const isMoist = site.includes("tuore") || site.includes("lehto");
      const plantType = isMoist ? "spruce_planting" : "pine_planting";
      const plantCost = Math.round(COSTS[plantType] * areaHa);
      getP2(plantYr).regenerationOps.push({
        stand: k,
        type: plantType,
        year: plantYr,
        income_eur: 0,
        cost_eur: plantCost,
        removal_m3: 0,
        notes: "",
      });
    }
  }

  // ── Calculate summary ──
  function calcPeriodStats(period: YearPlan[]) {
    let income = 0;
    let cost = 0;
    let harvest = 0;
    for (const yp of period) {
      for (const op of yp.finalHarvests) { income += op.income_eur; harvest += op.removal_m3; }
      for (const op of yp.thinnings) { income += op.income_eur; harvest += op.removal_m3; }
      for (const op of yp.regenerationOps) { cost += op.cost_eur; }
      for (const op of yp.tendingOps) { cost += op.cost_eur; }
    }
    return { income, cost, harvest };
  }

  const p1Stats = calcPeriodStats(p1);
  const p2Stats = calcPeriodStats(p2);

  const totalGrowth = forestStands.reduce((s, k) => s + k.annual_growth, 0);
  const totalVolume = forestStands.reduce((s, k) => s + k.volumeM3, 0);
  const totalValue = forestStands.reduce((s, k) => s + k.valueEur, 0);

  const p1AvgHarvest = p1Stats.harvest / yearsP1.length;
  const p2AvgHarvest = p2Stats.harvest / yearsP2.length;
  const harvestVsGrowth = totalGrowth > 0 ? (p1AvgHarvest / totalGrowth) * 100 : 0;

  const summary: PlanSummary = {
    totalVolume: Math.round(totalVolume),
    annualGrowth: Math.round(totalGrowth),
    stumpageValue: Math.round(totalValue),
    p1AverageHarvest: Math.round(p1AvgHarvest),
    p2AverageHarvest: Math.round(p2AvgHarvest),
    harvestVsGrowth: Math.round(harvestVsGrowth),
    p1TotalIncome: Math.round(p1Stats.income),
    p1TotalCosts: Math.round(p1Stats.cost),
    p2TotalIncome: Math.round(p2Stats.income),
    p2TotalCosts: Math.round(p2Stats.cost),
  };

  return { p1, p2, summary };
}
