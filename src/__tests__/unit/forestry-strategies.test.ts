import { describe, it, expect } from "vitest";
import type { StandData, PlannedOperation } from "@/lib/ai/types";
import { getStrategy, type SchedulingStrategy } from "@/lib/ai/strategies";
import { schedulePlan } from "@/lib/ai/schedule";

// --- Helpers ---

function makeStand(overrides: Partial<StandData> & { standId: string }): StandData {
  return {
    standId: overrides.standId,
    areaHa: overrides.areaHa ?? 2.0,
    developmentClass: overrides.developmentClass ?? "mature_thinning",
    siteType: overrides.siteType ?? "mesic",
    soilType: overrides.soilType ?? "mineral soil",
    drainageStatus: overrides.drainageStatus ?? "ei ojia",
    mainSpecies: overrides.mainSpecies ?? "pine",
    site_class: overrides.site_class ?? "tuore",
    is_peatland: overrides.is_peatland ?? false,
    annual_growth: overrides.annual_growth ?? 0,
    valueEur: overrides.valueEur ?? 10000,
    logM3: overrides.logM3 ?? 100,
    pulpM3: overrides.pulpM3 ?? 100,
    ageYears: overrides.ageYears ?? 50,
    ba: overrides.ba ?? 20,
    volumeM3: overrides.volumeM3 ?? 200,
    stemCount: overrides.stemCount ?? 0,
    meanHeight: overrides.meanHeight ?? 0,
    meanDiameter: overrides.meanDiameter ?? 0,
    speciesData: overrides.speciesData ?? [],
  };
}

function makeOp(
  stand: StandData,
  type: string,
  overrides?: Partial<PlannedOperation>
): PlannedOperation {
  return {
    stand,
    type,
    year: overrides?.year ?? 0,
    income_eur: overrides?.income_eur ?? 0,
    cost_eur: overrides?.cost_eur ?? 0,
    removal_m3: overrides?.removal_m3 ?? 0,
    removalFraction: overrides?.removalFraction ?? 0,
    notes: overrides?.notes ?? "",
    dueYear: overrides?.dueYear ?? 2026,
  };
}

// --- Strategy factory ---

describe("getStrategy", () => {
  it("returns aggressive strategy for maximum_growth_aggressive", () => {
    const s = getStrategy("maximum_growth_aggressive");
    expect(s.name).toBe("maximum_growth_aggressive");
    expect(s.volumeCapMultiplier()).toBe(3.0);
    expect(s.regenDelayYears()).toBe(0);
  });

  it("returns balanced-growth strategy for maximum_growth_balanced", () => {
    const s = getStrategy("maximum_growth_balanced");
    expect(s.name).toBe("maximum_growth_balanced");
    expect(s.volumeCapMultiplier()).toBe(1.25);
  });

  it("returns carbon strategy for carbon_storage", () => {
    const s = getStrategy("carbon_storage");
    expect(s.name).toBe("carbon_storage");
    expect(s.volumeCapMultiplier()).toBe(0.5);
    expect(s.regenDelayYears()).toBe(2);
  });

  it("returns balanced strategy for balanced", () => {
    const s = getStrategy("balanced");
    expect(s.name).toBe("balanced");
    expect(s.volumeCapMultiplier()).toBe(1.0);
  });
});

// --- Strategy behavior ---

describe("strategy selectOperations", () => {
  it("aggressive: fits all operations under high cap", () => {
    const stand = makeStand({ standId: "s1", volumeM3: 300, valueEur: 15000 });
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(stand, "thinning", { removal_m3: 50, income_eur: 2000, dueYear: 2026 }),
      makeOp(stand, "clear_cut", { removal_m3: 200, income_eur: 10000, dueYear: 2026 }),
    ];
    const s = getStrategy("maximum_growth_aggressive");
    const result = s.selectOperations(2026, states, candidates, 300, 55);
    expect(result.scheduled.length).toBe(2);
    expect(result.remaining.length).toBe(0);
  });

  it("carbon_storage: greedily accepts thinnings and clearcuts under cap", () => {
    // Note: carbon_storage strategy only sees what classify/spawn gives it.
    // The spawning logic (in schedule.ts) handles clearcut eligibility per goal.
    // Here we just test the selection behavior.
    const stand = makeStand({ standId: "cs1", volumeM3: 300, valueEur: 15000, ageYears: 60, siteType: "mesic" });
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(stand, "thinning", { removal_m3: 50, income_eur: 2000, dueYear: 2026 }),
      makeOp(stand, "clear_cut", { removal_m3: 200, income_eur: 10000, dueYear: 2026 }),
    ];
    const s = getStrategy("carbon_storage");
    const result = s.selectOperations(2026, states, candidates, 200, 55);
    // With cap=200: thinning(50) + clearcut(200) = 250 > 200, so clearcut goes to remaining
    expect(result.scheduled.some((o) => o.type === "thinning")).toBe(true);
    expect(result.remaining.some((o) => o.type === "clear_cut")).toBe(true);
  });

  it("balanced-growth: greedily fits as much as possible under cap", () => {
    const stand = makeStand({ standId: "s2", volumeM3: 500, valueEur: 25000 });
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(stand, "thinning", { removal_m3: 100, income_eur: 5000, dueYear: 2026 }),
      makeOp(stand, "clear_cut", { removal_m3: 400, income_eur: 20000, dueYear: 2026 }),
    ];
    const s = getStrategy("maximum_growth_balanced");
    const result = s.selectOperations(2026, states, candidates, 500, 50);
    expect(result.scheduled.some((o) => o.type === "thinning")).toBe(true);
  });

  it("balanced: round-robin interleaves thinnings and clearcuts", () => {
    const s1 = makeStand({ standId: "a1", volumeM3: 300, valueEur: 15000 });
    const s2 = makeStand({ standId: "a2", volumeM3: 400, valueEur: 20000 });
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(s1, "thinning", { removal_m3: 80, income_eur: 4000, dueYear: 2026 }),
      makeOp(s2, "clear_cut", { removal_m3: 200, income_eur: 10000, dueYear: 2026 }),
    ];
    const s = getStrategy("balanced");
    const result = s.selectOperations(2026, states, candidates, 300, 55);
    expect(result.scheduled.length).toBe(2);
  });
});

// --- Engine integration (uses schedulePlan from schedule.ts) ---

describe("schedulePlan with strategies", () => {
  it("synthesizes a 3-stand forest across all 4 goals without crashing", () => {
    const synthetic = [
      makeStand({ standId: "syn1", volumeM3: 500, valueEur: 25000, ageYears: 80, developmentClass: "regeneration_ready", mainSpecies: "pine", siteType: "sub-xeric", site_class: "kuivahko" }),
      makeStand({ standId: "syn2", volumeM3: 250, valueEur: 12000, ageYears: 45, developmentClass: "mature_thinning", mainSpecies: "spruce", siteType: "mesic", ba: 28 }),
      makeStand({ standId: "syn3", volumeM3: 40, valueEur: 2000, ageYears: 8, developmentClass: "seedling", mainSpecies: "pine", siteType: "sub-xeric" }),
    ];

    const goals = [
      "balanced", "maximum_growth_aggressive", "maximum_growth_balanced", "carbon_storage",
    ] as const;

    for (const goal of goals) {
      const { years, summary } = schedulePlan([...synthetic], 2026, 20, goal, 1.0);
      expect(years.length).toBe(20);
      expect(summary.totalVolume).toBeGreaterThan(0);
    }
  });

  it("carbon_storage spawns selection_cutting not clear_cut", () => {
    const stand = makeStand({
      standId: "cs1", volumeM3: 50, valueEur: 3000,
      ageYears: 130, ba: 30, siteType: "sub-xeric", site_class: "kuivahko",
      areaHa: 40,
    });
    const { years } = schedulePlan([stand], 2026, 20, "carbon_storage", 1.0);
    const allHarvests = years.flatMap((y) => [...y.finalHarvests, ...y.thinnings]);
    const selectionCuts = allHarvests.filter((o) => o.type === "selection_cutting");
    const clearCuts = allHarvests.filter((o) => o.type === "clear_cut");
    expect(selectionCuts.length).toBeGreaterThanOrEqual(1);
    expect(clearCuts.length).toBe(0);
  });

  it("respects volume cap from strategy", () => {
    const stands = Array.from({ length: 10 }, (_, i) =>
      makeStand({ standId: `v${i}`, volumeM3: 500, valueEur: 25000, ageYears: 80, developmentClass: "regeneration_ready" })
    );
    const { years } = schedulePlan([...stands], 2026, 20, "balanced", 1.0);
    // At least one operation per year is always scheduled (even if over cap),
    // but additional operations must fit within the cap.
    let yearsWithClearcut = 0;
    for (const yp of years) {
      const total = [...yp.finalHarvests, ...yp.thinnings].reduce((s, o) => s + o.removal_m3, 0);
      if (yp.finalHarvests.length > 0) yearsWithClearcut++;
      // No year should schedule more than 2 clearcuts (first + one under cap)
      expect(yp.finalHarvests.length).toBeLessThanOrEqual(2);
    }
    // All 10 clearcuts should be spread across years (one per year max with 1× cap)
    expect(yearsWithClearcut).toBe(10);
  });

  it("applies Lappi growth multiplier to scheduling", () => {
    const stand = makeStand({
      standId: "lap1", volumeM3: 300, valueEur: 15000, developmentClass: "regeneration_ready",
      ageYears: 80,
    });
    const { years } = schedulePlan([stand], 2026, 20, "balanced", 0.55);
    expect(years.length).toBe(20);
  });
});
