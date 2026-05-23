// src/lib/ai/schedule.ts

import type { KuviotData, PlannedOperation, YearPlan, PlanSummary } from "./types";
import { getOptimalAge, COSTS } from "./config";

/**
 * Schedule operations across two 10-year periods.
 *
 * Ported from build_plan_v3_fixed.py lines 391-621.
 */
export function schedulePlan(
  forestKuviot: KuviotData[],
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
  const paatehakkuut: PlannedOperation[] = [];
  const harvennukset: PlannedOperation[] = [];
  const poiminta: PlannedOperation[] = [];
  const taimikot: PlannedOperation[] = [];
  const uudist: PlannedOperation[] = [];

  for (const op of operations) {
    switch (op.type) {
      case "Päätehakkuu":
        paatehakkuut.push(op);
        break;
      case "Harvennus":
      case "Ensiharvennus":
        harvennukset.push(op);
        break;
      case "Poimintahakkuu":
        poiminta.push(op);
        break;
      case "Taimikon varhaishoito":
      case "Taimikonhoito":
        taimikot.push(op);
        break;
      case "Laikkumätästys":
      case "Kuusen istutus":
      case "Männyn istutus":
      case "Laikutus":
        uudist.push(op);
        break;
    }
  }

  // ── Initialize year slots ──
  const p1: YearPlan[] = yearsP1.map((y) => ({ year: y, paate: [], harvennus: [], taimik: [], uudist: [] }));
  const p2: YearPlan[] = yearsP2.map((y) => ({ year: y, paate: [], harvennus: [], taimik: [], uudist: [] }));

  const getP1 = (y: number): YearPlan => p1[yearsP1.indexOf(y)];
  const getP2 = (y: number): YearPlan => p2[yearsP2.indexOf(y)];

  // ── Urgency sort for päätehakkuut ──
  function urgency(op: PlannedOperation): number {
    const k = op.kuvio;
    const age = k.ikä;
    const pp = k.paapuulaji;
    const site = k.site_class;
    const [, optMax] = getOptimalAge(pp, site);
    return -(age - optMax);
  }
  paatehakkuut.sort((a, b) => urgency(a) - urgency(b));

  // ── Place K7 split (3 parts) ──
  const k7Idx = paatehakkuut.findIndex((op) => Math.abs(parseFloat(op.kuvio.numero.replace(",", ".")) - 7.0) < 0.01);
  if (k7Idx !== -1) {
    const k7 = paatehakkuut.splice(k7Idx, 1)[0];
    const k = k7.kuvio;
    const val = k7.income_eur;
    const m3Tot = k7.removal_m3;
    const ala = k.ala;

    const parts: [number, number][] = [[2026, 0.35], [2028, 0.33], [2031, 0.32]];
    for (let partI = 0; partI < parts.length; partI++) {
      const [yr, frac] = parts[partI];
      const sv = Math.round(val * frac);
      const sm = Math.round(m3Tot * frac);
      const sa = Math.round(ala * frac * 10) / 10;
      const subK = { ...k, ala: sa };

      getP1(yr).paate.push({
        kuvio: subK,
        type: "Päätehakkuu",
        year: yr,
        income_eur: sv,
        cost_eur: 0,
        removal_m3: sm,
        notes: `Kuvio 7 osa ${partI + 1}/3`,
      });
      getP1(yr).uudist.push({
        kuvio: subK,
        type: "Laikkumätästys",
        year: yr,
        income_eur: 0,
        cost_eur: Math.round(COSTS["Laikkumätästys"] * sa),
        removal_m3: 0,
        notes: "",
      });
      const plantYr = yr + 1;
      if (plantYr <= 2035) {
        getP1(plantYr).uudist.push({
          kuvio: subK,
          type: "Kuusen istutus",
          year: plantYr,
          income_eur: 0,
          cost_eur: Math.round(COSTS["Kuusen istutus"] * sa),
          removal_m3: 0,
          notes: `Istutus osa ${partI + 1}`,
        });
      }
    }
  }

  // ── Place K184 split (2 parts) ──
  const k184Idx = paatehakkuut.findIndex((op) => Math.abs(parseFloat(op.kuvio.numero.replace(",", ".")) - 184.0) < 0.01);
  if (k184Idx !== -1) {
    const k184 = paatehakkuut.splice(k184Idx, 1)[0];
    const k = k184.kuvio;
    const val = k184.income_eur;
    const m3Tot = k184.removal_m3;
    const ala = k.ala;

    const parts: [number, number][] = [[2029, 0.5], [2034, 0.5]];
    for (let partI = 0; partI < parts.length; partI++) {
      const [yr, frac] = parts[partI];
      const sv = Math.round(val * frac);
      const sm = Math.round(m3Tot * frac);
      const sa = Math.round(ala * frac * 10) / 10;
      const subK = { ...k, ala: sa };

      getP1(yr).paate.push({
        kuvio: subK,
        type: "Päätehakkuu",
        year: yr,
        income_eur: sv,
        cost_eur: 0,
        removal_m3: sm,
        notes: `Kuvio 184 osa ${partI + 1}/2`,
      });
      getP1(yr).uudist.push({
        kuvio: subK,
        type: "Laikkumätästys",
        year: yr,
        income_eur: 0,
        cost_eur: Math.round(COSTS["Laikkumätästys"] * sa),
        removal_m3: 0,
        notes: "",
      });
      const plantYr = yr + 1;
      if (plantYr <= 2035) {
        getP1(plantYr).uudist.push({
          kuvio: subK,
          type: "Männyn istutus",
          year: plantYr,
          income_eur: 0,
          cost_eur: Math.round(COSTS["Männyn istutus"] * sa),
          removal_m3: 0,
          notes: `Istutus osa ${partI + 1}`,
        });
      }
    }
  }

  // ── Place K180 poimintahakkuu 2028 ──
  if (poiminta.length > 0) {
    const k180 = poiminta[0];
    getP1(2028).paate.push({
      ...k180,
      year: 2028,
    });
  }

  // ── Hand-place kuvio 5 harvennus to 2033 ──
  const k5 = forestKuviot.find((k) => Math.abs(parseFloat(k.numero.replace(",", ".")) - 5.0) < 0.01);
  if (k5 && k5._manual_year) {
    const my = k5._manual_year;
    const op5Idx = harvennukset.findIndex((op) => Math.abs(parseFloat(op.kuvio.numero.replace(",", ".")) - 5.0) < 0.01);
    if (op5Idx !== -1) {
      const op5 = harvennukset.splice(op5Idx, 1)[0];
      getP1(my).harvennus.push({
        ...op5,
        year: my,
        notes: `BA arviolta ~28 (2020→2033, 13v väli). SIIRRETTY 2026→2033`,
      });
    }
  }

  // ── Calculate already_placed count ──
  const alreadyInP1 = 3 + 2 + 1; // K7 parts, K184 parts, K180
  const slotsForP1 = 12;

  const p1AvailableYears = yearsP1.filter((y) => ![2026, 2028, 2029, 2031, 2034].includes(y));

  const p1Remaining = paatehakkuut.slice(0, slotsForP1);
  const p2Remaining = paatehakkuut.slice(slotsForP1);

  // ── Distribute remaining päätehakkuut to P1 ──
  let p1YearIdx = 0;
  for (const op of p1Remaining) {
    const yr = p1AvailableYears[p1YearIdx % p1AvailableYears.length];
    const k = op.kuvio;
    getP1(yr).paate.push({
      kuvio: k,
      type: "Päätehakkuu",
      year: yr,
      income_eur: op.income_eur,
      cost_eur: 0,
      removal_m3: op.removal_m3,
      notes: op.notes,
    });
    const costMounding = Math.round(COSTS["Laikkumätästys"] * k.ala);
    getP1(yr).uudist.push({
      kuvio: k,
      type: "Laikkumätästys",
      year: yr,
      income_eur: 0,
      cost_eur: costMounding,
      removal_m3: 0,
      notes: "",
    });
    const plantYr = yr + 1;
    if (plantYr <= 2035) {
      const isMoist = k.site_class.includes("tuore") || k.site_class.includes("lehto");
      const plantType = isMoist ? "Kuusen istutus" : "Männyn istutus";
      const plantCost = Math.round(COSTS[plantType] * k.ala);
      getP1(plantYr).uudist.push({
        kuvio: k,
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
    const k = op.kuvio;
    const yearsFromNow = yr - startYear;
    const ageAtYr = k.ikä + yearsFromNow;
    const m3Grown = k.m3 + k.annual_growth * yearsFromNow;
    const arvoGrown = k.m3 > 0 ? Math.round(op.income_eur * (m3Grown / k.m3)) : 0;

    getP2(yr).paate.push({
      kuvio: k,
      type: "Päätehakkuu",
      year: yr,
      income_eur: arvoGrown,
      cost_eur: 0,
      removal_m3: Math.round(m3Grown),
      notes: `Jatkokausi, projisoitu ikä ${ageAtYr.toFixed(0)}v`,
    });
    const costMounding = Math.round(COSTS["Laikkumätästys"] * k.ala);
    getP2(yr).uudist.push({
      kuvio: k,
      type: "Laikkumätästys",
      year: yr,
      income_eur: 0,
      cost_eur: costMounding,
      removal_m3: 0,
      notes: "",
    });
    const plantYr = yr + 1;
    if (plantYr <= yearsP2[yearsP2.length - 1]) {
      const isMoist = k.site_class.includes("tuore") || k.site_class.includes("lehto");
      const plantType = isMoist ? "Kuusen istutus" : "Männyn istutus";
      const plantCost = Math.round(COSTS[plantType] * k.ala);
      getP2(plantYr).uudist.push({
        kuvio: k,
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

  // ── Distribute harvennukset evenly (excluding kuvio 5, already removed) ──
  const harvYearsPool: number[] = [];
  for (const y of yearsP1) {
    for (let i = 0; i < 5; i++) {
      harvYearsPool.push(y);
    }
  }
  const trimmedPool = harvYearsPool.slice(0, harvennukset.length);

  for (let i = 0; i < harvennukset.length; i++) {
    const op = harvennukset[i];
    const yr = trimmedPool[i];
    getP1(yr).harvennus.push({
      ...op,
      year: yr,
    });
  }

  // ── Schedule taimikonhoidot ──
  for (const op of taimikot) {
    const k = op.kuvio;
    const age = k.ikä;
    let target: number | null = null;

    if (op.type === "Taimikon varhaishoito") {
      if (age < 3) target = startYear + Math.floor(3 - age);
      else if (age <= 12) target = startYear;
      else continue;
    } else {
      // Taimikonhoito
      if (age < 10) target = startYear + Math.floor(10 - age);
      else if (age <= 25) target = startYear + Math.min(3, Math.floor(25 - age));
      else continue;
    }

    if (target !== null && target <= yearsP1[yearsP1.length - 1]) {
      getP1(target).taimik.push({
        ...op,
        year: target,
      });
    }
  }

  // ── Future taimikonhoito for young saplings in P2 ──
  for (const k of forestKuviot) {
    const kl = k.kehitysluokka;
    const age = k.ikä;
    if (kl.includes("seedling") && age < 3) {
      const target = startYear + Math.floor(10 - age);
      if (target >= yearsP2[0] && target <= yearsP2[yearsP2.length - 1]) {
        getP2(target).taimik.push({
          kuvio: k,
          type: "Taimikonhoito",
          year: target,
          income_eur: 0,
          cost_eur: Math.round(COSTS["Taimikonhoito"] * k.ala),
          removal_m3: 0,
          notes: "Projisoitu",
        });
      }
    }
  }

  // ── K2 candidates (stands maturing in period 2) ──
  interface K2Candidate {
    urgencyScore: number;
    targetYr: number;
    k: KuviotData;
  }
  const k2Candidates: K2Candidate[] = [];

  for (const k of forestKuviot) {
    const kl = k.kehitysluokka;
    const pp = k.paapuulaji;
    const site = k.site_class;
    const age = k.ikä;
    const knum = parseFloat(k.numero.replace(",", "."));

    // Skip already scheduled or special
    const alreadyScheduled = p1.some((yp) =>
      [...yp.paate, ...yp.harvennus, ...yp.taimik, ...yp.uudist].some((op) => op.kuvio === k && op.type === "Päätehakkuu")
    );
    if (alreadyScheduled) continue;
    if (Math.abs(knum - 180.0) < 0.01 || Math.abs(knum - 128.0) < 0.01) continue;
    if (Math.abs(knum - 71.0) < 0.01 || Math.abs(knum - 72.0) < 0.01) continue;

    const [optMin] = getOptimalAge(pp, site);

    if (kl.includes("mature_thinning") || kl.includes("young_thinning") || kl.includes("regeneration_ready")) {
      const yearsToOpt = Math.max(0, optMin - age);
      const targetYr = startYear + Math.floor(yearsToOpt);
      if (targetYr <= yearsP2[yearsP2.length - 1] && targetYr >= yearsP2[0]) {
        const [, optMax] = getOptimalAge(pp, site);
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
    const ala = k.ala;
    const m3 = k.m3;
    const arvo = k.arvo;
    const age = k.ikä;
    const site = k.site_class;

    const spreadYr = k2AllYears[k2Idx % k2AllYears.length];
    k2Idx++;

    const yearsFromNow = spreadYr - startYear;
    const ageAtTarget = age + yearsFromNow;
    const m3Grown = m3 + k.annual_growth * yearsFromNow;
    const arvoGrown = m3 > 0 ? Math.round(arvo * (m3Grown / m3)) : 0;

    getP2(spreadYr).paate.push({
      kuvio: k,
      type: "Päätehakkuu",
      year: spreadYr,
      income_eur: arvoGrown,
      cost_eur: 0,
      removal_m3: Math.round(m3Grown),
      notes: `Kypsyy kaudella 2, ikä ${ageAtTarget.toFixed(0)}v`,
    });
    const costMounding = Math.round(COSTS["Laikkumätästys"] * ala);
    getP2(spreadYr).uudist.push({
      kuvio: k,
      type: "Laikkumätästys",
      year: spreadYr,
      income_eur: 0,
      cost_eur: costMounding,
      removal_m3: 0,
      notes: "",
    });
    const plantYr = spreadYr + 1;
    if (plantYr <= yearsP2[yearsP2.length - 1]) {
      const isMoist = site.includes("tuore") || site.includes("lehto");
      const plantType = isMoist ? "Kuusen istutus" : "Männyn istutus";
      const plantCost = Math.round(COSTS[plantType] * ala);
      getP2(plantYr).uudist.push({
        kuvio: k,
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
      for (const op of yp.paate) { income += op.income_eur; harvest += op.removal_m3; }
      for (const op of yp.harvennus) { income += op.income_eur; harvest += op.removal_m3; }
      for (const op of yp.uudist) { cost += op.cost_eur; }
      for (const op of yp.taimik) { cost += op.cost_eur; }
    }
    return { income, cost, harvest };
  }

  const p1Stats = calcPeriodStats(p1);
  const p2Stats = calcPeriodStats(p2);

  const totalGrowth = forestKuviot.reduce((s, k) => s + k.annual_growth, 0);
  const totalVolume = forestKuviot.reduce((s, k) => s + k.m3, 0);
  const totalValue = forestKuviot.reduce((s, k) => s + k.arvo, 0);

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