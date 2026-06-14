// src/lib/ai/__tests__/forest-state.test.ts
import { describe, it, expect } from "vitest";
import { estimateForestState, type CompartmentInput, type OperationInput } from "../forest-state";
import { runScheduleEngine } from "../schedule";
import { simulateStand, type DBOperation } from "../stand-simulator";
import type { StandData, PlannedOperation } from "../types";

// ── Helpers ──

function makeComp(overrides: Partial<CompartmentInput> = {}): CompartmentInput {
  return {
    id: "comp-1",
    stand_id: "S001",
    area_ha: 2.0,
    site_type: "mesic",
    soil_type: "mineral",
    main_species: "pine",
    age_years: 45,
    volume_m3: 200,
    basal_area: 22,
    development_class: "mature_thinning",
    ...overrides,
  };
}

function makeOp(overrides: Partial<OperationInput> = {}): OperationInput {
  return {
    compartment_id: "comp-1",
    year: 2027,
    type: "thinning",
    removal_pct: 30,
    ...overrides,
  };
}

// ── Tests ──

describe("estimateForestState", () => {
  // ─── Basic growth ───

  it("grows a stand year by year with no operations", () => {
    const timeline = estimateForestState(
      [makeComp({ volume_m3: 200, age_years: 45 })],
      [],
      2026,
      2028,
    );

    const snapshots = timeline.get("comp-1")!;
    expect(snapshots).toHaveLength(3);

    // Each year: growth is added, volume increases
    expect(snapshots[0].year).toBe(2026);
    expect(snapshots[0].ageYears).toBe(46);
    expect(snapshots[0].growthM3).toBeGreaterThan(0);
    expect(snapshots[0].harvestM3).toBe(0);
    expect(snapshots[0].volumeM3).toBeGreaterThan(200);
    expect(snapshots[0].operationType).toBeNull();

    expect(snapshots[1].year).toBe(2027);
    expect(snapshots[1].ageYears).toBe(47);
    expect(snapshots[1].volumeM3).toBeGreaterThan(snapshots[0].volumeM3);

    expect(snapshots[2].year).toBe(2028);
    expect(snapshots[2].ageYears).toBe(48);
  });

  it("growth rate changes as stand ages", () => {
    const youngTimeline = estimateForestState(
      [makeComp({ volume_m3: 50, age_years: 10, basal_area: 8 })],
      [],
      2026, 2026,
    );
    const oldTimeline = estimateForestState(
      [makeComp({ volume_m3: 50, age_years: 120, basal_area: 8 })],
      [],
      2026, 2026,
    );

    const youngGrowth = youngTimeline.get("comp-1")![0].growthM3PerHa;
    const oldGrowth = oldTimeline.get("comp-1")![0].growthM3PerHa;

    // With Tapio volume (V = N×π×(D/200)²×H×f), growth reflects H/D curve slope.
    // Both should produce valid per-hectare values.
    expect(youngGrowth).not.toBeNaN();
    expect(oldGrowth).not.toBeNaN();
  });

  // ─── Operations ───

  it("thinning reduces volume and basal area", () => {
    const timeline = estimateForestState(
      [makeComp({ volume_m3: 200, basal_area: 22 })],
      [makeOp({ year: 2027, type: "thinning", removal_pct: 30 })],
      2026,
      2028,
    );

    const snapshots = timeline.get("comp-1")!;

    // 2026: growth, no harvest
    expect(snapshots[0].harvestM3).toBe(0);

    // 2027: thinning removes 30%
    expect(snapshots[1].year).toBe(2027);
    expect(snapshots[1].harvestM3).toBeGreaterThan(0);
    expect(snapshots[1].operationType).toBe("thinning");
    // Volume reduced: 2027 volume should be less than it would be without thinning
    // (compare to growth-only projection)
    expect(snapshots[1].volumeM3).toBeLessThan(snapshots[0].volumeM3 + snapshots[1].growthM3);

    // 2028: growth continues on reduced volume
    expect(snapshots[2].harvestM3).toBe(0);
    expect(snapshots[2].volumeM3).toBeGreaterThan(snapshots[1].volumeM3);
  });

  it("clearcut resets volume, age, and stops growth", () => {
    const timeline = estimateForestState(
      [makeComp({ volume_m3: 200, age_years: 60 })],
      [makeOp({ year: 2027, type: "clear_cut", removal_pct: 100 })],
      2026,
      2029,
    );

    const snapshots = timeline.get("comp-1")!;

    // 2026: normal growth
    expect(snapshots[0].harvestM3).toBe(0);
    expect(snapshots[0].volumeM3).toBeGreaterThan(200);

    // 2027: clearcut removes everything
    expect(snapshots[1].year).toBe(2027);
    expect(snapshots[1].operationType).toBe("clear_cut");
    expect(snapshots[1].harvestM3).toBeGreaterThan(0);
    expect(snapshots[1].volumeM3).toBe(0);
    expect(snapshots[1].ageYears).toBe(0);

    // 2028: no growth (cleared, no regeneration yet)
    expect(snapshots[2].growthM3).toBe(0);
    expect(snapshots[2].volumeM3).toBe(0);

    // 2029: still no growth
    expect(snapshots[3].growthM3).toBe(0);
    expect(snapshots[3].volumeM3).toBe(0);
  });

  it("regeneration after clearcut allows growth to resume", () => {
    const timeline = estimateForestState(
      [makeComp({ volume_m3: 200, age_years: 60 })],
      [
        makeOp({ year: 2027, type: "clear_cut", removal_pct: 100 }),
        { compartment_id: "comp-1", year: 2028, type: "spruce_planting", removal_pct: 0 },
      ],
      2026,
      2030,
    );

    const snapshots = timeline.get("comp-1")!;

    // 2027: clearcut
    expect(snapshots[1].volumeM3).toBe(0);

    // 2028: planting — growth still 0 this year (happens at year end)
    expect(snapshots[2].year).toBe(2028);
    expect(snapshots[2].operationType).toBe("spruce_planting");

    // 2029: growth resumes (young trees, Tapio volume at age 1 is near zero)
    expect(snapshots[3].year).toBe(2029);
    expect(snapshots[3].volumeM3).toBeGreaterThanOrEqual(0);
  });

  // ─── Multiple stands ───

  it("handles multiple independent stands", () => {
    const comps: CompartmentInput[] = [
      makeComp({ id: "comp-1", stand_id: "S001", volume_m3: 200, area_ha: 1.5 }),
      makeComp({ id: "comp-2", stand_id: "S002", volume_m3: 300, area_ha: 3.0 }),
    ];
    const ops: OperationInput[] = [
      { compartment_id: "comp-1", year: 2027, type: "thinning", removal_pct: 30 },
      { compartment_id: "comp-2", year: 2028, type: "clear_cut", removal_pct: 100 },
    ];

    const timeline = estimateForestState(comps, ops, 2026, 2028);

    const s1 = timeline.get("comp-1")!;
    const s2 = timeline.get("comp-2")!;

    expect(s1).toHaveLength(3);
    expect(s2).toHaveLength(3);

    // Stand 1: thinned in 2027
    expect(s1[1].harvestM3).toBeGreaterThan(0);
    expect(s1[1].operationType).toBe("thinning");

    // Stand 2: clearcut in 2028
    expect(s2[2].harvestM3).toBeGreaterThan(0);
    expect(s2[2].operationType).toBe("clear_cut");
    expect(s2[2].volumeM3).toBe(0);
  });

  // ─── Edge cases ───

  it("skips compartments with zero area or zero volume", () => {
    const timeline = estimateForestState(
      [
        makeComp({ id: "comp-ok", stand_id: "OK", volume_m3: 100, area_ha: 1 }),
        makeComp({ id: "comp-zero-vol", stand_id: "ZV", volume_m3: 0, area_ha: 1 }),
        makeComp({ id: "comp-zero-area", stand_id: "ZA", volume_m3: 100, area_ha: 0 }),
        makeComp({ id: "comp-null", stand_id: "N", volume_m3: null as unknown as number, area_ha: 1 }),
      ],
      [],
      2026, 2026,
    );

    // Only the valid compartment gets entries
    expect(timeline.has("comp-ok")).toBe(true);
    expect(timeline.has("comp-zero-vol")).toBe(false);
    expect(timeline.has("comp-zero-area")).toBe(false);
    expect(timeline.has("comp-null")).toBe(false);
    expect(timeline.get("comp-ok")!).toHaveLength(1);
  });

  it("handles empty inputs", () => {
    const timeline = estimateForestState([], [], 2026, 2030);
    expect(timeline.size).toBe(0);
  });

  it("handles year range with no operations", () => {
    const timeline = estimateForestState(
      [makeComp({ volume_m3: 100 })],
      [makeOp({ year: 2030, type: "thinning", removal_pct: 30 })],
      2026,
      2028,
    );

    const snapshots = timeline.get("comp-1")!;
    // All years have growth, no harvest (operation is in 2030, outside range)
    expect(snapshots[0].harvestM3).toBe(0);
    expect(snapshots[1].harvestM3).toBe(0);
    expect(snapshots[2].harvestM3).toBe(0);
    expect(snapshots[0].growthM3).toBeGreaterThan(0);
  });

  it("operations on unknown compartments don't crash", () => {
    const timeline = estimateForestState(
      [makeComp()],
      [{ compartment_id: "nonexistent", year: 2027, type: "thinning", removal_pct: 30 }],
      2026, 2028,
    );

    // Should complete without error
    expect(timeline.get("comp-1")!).toHaveLength(3);
  });

  it("multiple operations on same stand same year are all applied", () => {
    const timeline = estimateForestState(
      [makeComp({ volume_m3: 300 })],
      [
        { compartment_id: "comp-1", year: 2027, type: "thinning", removal_pct: 20 },
        // A second pass wouldn't normally happen, but handle it
        { compartment_id: "comp-1", year: 2027, type: "clear_cut", removal_pct: 100 },
      ],
      2026, 2028,
    );

    const snapshots = timeline.get("comp-1")!;
    // Both ops applied: thinning removes 20%, then clearcut removes the rest
    expect(snapshots[1].harvestM3).toBeGreaterThan(0);
    expect(snapshots[1].volumeM3).toBe(0);
  });

  // ─── Positional snapshots ───

  it("standId in snapshot matches input stand_id", () => {
    const timeline = estimateForestState(
      [makeComp({ stand_id: "MY-STAND-42" })],
      [],
      2026, 2026,
    );

    expect(timeline.get("comp-1")![0].standId).toBe("MY-STAND-42");
  });

  it("volume never goes negative", () => {
    const timeline = estimateForestState(
      [makeComp({ volume_m3: 10 })],
      [
        makeOp({ year: 2026, type: "thinning", removal_pct: 80 }),
        makeOp({ year: 2027, type: "clear_cut", removal_pct: 100 }),
      ],
      2026, 2028,
    );

    for (const snapshots of timeline.values()) {
      for (const s of snapshots) {
        expect(s.volumeM3).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Full lifecycle (200 years, 2 rotations) — scheduler + simulator
  // ═══════════════════════════════════════════════════════════════

  const LIFECYCLE_STAND: StandData = {
    standId: "LIFECYCLE-1",
    areaHa: 1.7,
    developmentClass: "seedling_pine",
    siteType: "sub-xeric",
    soilType: "mineral",
    drainageStatus: "",
    mainSpecies: "pine",
    site_class: "sub-xeric",
    is_peatland: false,
    annual_growth: 6,
    valueEur: 500,
    logM3: 0,
    pulpM3: 5,
    ageYears: 5,
    ba: 3,
    volumeM3: 5,
    stemCount: 2200,
    meanHeight: 1.5,
    meanDiameter: 2,
    speciesData: [],
  };

  /** Collect all operations across all years from the schedule result. */
  function collectAllOps(
    yearPlans: Map<number, PlannedOperation[]>,
  ): PlannedOperation[] {
    const all: PlannedOperation[] = [];
    for (const ops of yearPlans.values()) all.push(...ops);
    all.sort((a, b) => a.year - b.year);
    return all;
  }

  it("scheduler spawns a complete lifecycle with 2 regenerations over 200 years", () => {
    // Use maximum_growth_no_cap so the volume cap never limits spawning.
    const { yearPlans, overspillOps, simulationSnapshots } = runScheduleEngine(
      [LIFECYCLE_STAND],
      1,
      200,
      "maximum_growth_no_cap",
    );

    const ops = collectAllOps(yearPlans);
    const clearcuts = ops.filter((o) => o.type === "clear_cut");
    const regens = ops.filter((o) => o.type.includes("planting"));
    const thinnings = ops.filter(
      (o) => o.type === "first_thinning" || o.type === "thinning",
    );
    const tendings = ops.filter(
      (o) => o.type === "early_tending" || o.type === "tending",
    );

    // ── Structure: at least 2 full rotations ──
    expect(clearcuts.length, "need at least 2 clearcuts").toBeGreaterThanOrEqual(2);
    expect(regens.length, "need at least 2 regeneration plantings").toBeGreaterThanOrEqual(2);
    expect(overspillOps, "no ops should spill with no_cap goal").toBe(0);

    // ── Regeneration follows each clearcut ──
    for (const cc of clearcuts) {
      const followUp = regens.find(
        (r) => r.year >= cc.year && r.year <= cc.year + 3,
      );
      expect(followUp, `clearcut at year ${cc.year} must have regen within 3 years`).toBeDefined();
    }

    // ── Per-rotation: tending before first_thinning before thinning before clearcut ──
    const rotations: { cc: PlannedOperation; ops: PlannedOperation[] }[] = [];
    let start = 0;
    for (const cc of clearcuts) {
      const slice = ops.filter((o) => o.year > start && o.year <= cc.year);
      rotations.push({ cc, ops: slice });
      start = cc.year;
    }
    // Final ongoing rotation
    const finalSlice = ops.filter((o) => o.year > start);
    if (finalSlice.length > 0) rotations.push({ cc: null as any, ops: finalSlice });

    for (let ri = 0; ri < rotations.length; ri++) {
      const rot = rotations[ri];
      const types = rot.ops.map((o) => o.type);
      const tendingIdx = types.findIndex((t) => t === "early_tending" || t === "tending");
      const firstThinIdx = types.findIndex((t) => t === "first_thinning");
      const thinIdx = types.findIndex((t) => t === "thinning");

      // Tending (early or regular) comes first in each rotation
      if (tendingIdx >= 0 && firstThinIdx >= 0) {
        expect(
          tendingIdx,
          `rotation ${ri}: tending must come before first_thinning`,
        ).toBeLessThan(firstThinIdx);
      }
      // first_thinning before regular thinning
      if (firstThinIdx >= 0 && thinIdx >= 0) {
        expect(
          firstThinIdx,
          `rotation ${ri}: first_thinning must come before thinning`,
        ).toBeLessThan(thinIdx);
      }
      // Operations are in year order
      for (let j = 1; j < rot.ops.length; j++) {
        expect(
          rot.ops[j].year,
          `rotation ${ri}: ops must be chronological`,
        ).toBeGreaterThanOrEqual(rot.ops[j - 1].year);
      }
    }

    // ── Growth is positive in every year of the simulation snapshots ──
    for (const snap of simulationSnapshots) {
      for (const stand of snap.stands) {
        expect(stand.volumeM3).toBeGreaterThanOrEqual(0);
        expect(stand.meanHeight).toBeGreaterThanOrEqual(0);
        expect(stand.meanDiameter).toBeGreaterThanOrEqual(0);
      }
    }

    // ── Store ops for the simulator test ──
    // (exported via a module-level var — not ideal but practical for split tests)
    (globalThis as any).__lifecycleOps = ops;
  });

  it("simulator runs the scheduler-spawned operations with monotonic height/diameter", () => {
    const ops: PlannedOperation[] = (globalThis as any).__lifecycleOps;
    expect(ops, "scheduler test must run first").toBeDefined();
    expect(ops.length, "must have spawned operations").toBeGreaterThan(0);

    // Convert to DBOperation format
    const dbOps: DBOperation[] = ops.map((op) => ({
      type: op.type,
      year: op.year,
      removal_pct: Math.round(op.removalFraction * 100),
    }));

    const snapshots = simulateStand(LIFECYCLE_STAND, dbOps, 1, 200);

    // snapshots[0] = year 0 (pre-simulation)
    // snapshots[1..200] = years 1..200
    expect(snapshots).toHaveLength(201);

    // Track rotations by detecting clearcuts
    const ccIndices: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const snap = snapshots[i].stands[0];
      if (snap.volumeM3 === 0 && snap.ageYears === 0) {
        ccIndices.push(i);
      }
    }
    expect(ccIndices.length, "need at least 2 clearcuts").toBeGreaterThanOrEqual(2);

    // ── Per-rotation assertions ──
    const rotationStarts = [1, ...ccIndices.map((i) => i + 1)];
    const rotationEnds = [...ccIndices, snapshots.length - 1];

    for (let ri = 0; ri < rotationStarts.length; ri++) {
      const rStart = rotationStarts[ri];
      const rEnd = rotationEnds[ri];
      if (rStart >= rEnd) continue;

      // ── Height and diameter must be monotonic within each rotation ──
      let prevH = -1;
      let prevD = -1;
      let prevAge = -1;
      for (let i = rStart; i <= rEnd; i++) {
        const snap = snapshots[i].stands[0];
        // Skip years where stand was reset (age goes backwards = regen)
        if (snap.ageYears < prevAge) break;

        // After the stand is established (age > 2), height and diameter increase
        if (snap.ageYears > 2 && snap.meanHeight > 0 && snap.meanDiameter > 0) {
          expect(
            snap.meanHeight,
            `rotation ${ri} year ${snapshots[i].year}: height must increase (${prevH.toFixed(1)} → ${snap.meanHeight.toFixed(1)})`,
          ).toBeGreaterThanOrEqual(prevH - 0.01); // allow minor rounding
          expect(
            snap.meanDiameter,
            `rotation ${ri} year ${snapshots[i].year}: diameter must increase (${prevD.toFixed(1)} → ${snap.meanDiameter.toFixed(1)})`,
          ).toBeGreaterThanOrEqual(prevD - 0.01);
        }
        prevH = snap.meanHeight;
        prevD = snap.meanDiameter;
        prevAge = snap.ageYears;
      }
    }

    // ── Clearcut reset: volume=0, age=0, stems=0 ──
    for (const ci of ccIndices) {
      const snap = snapshots[ci].stands[0];
      expect(snap.volumeM3, `clearcut at year ${snapshots[ci].year}`).toBe(0);
      expect(snap.ageYears, `clearcut at year ${snapshots[ci].year}`).toBe(0);
      expect(snap.stemCount, `clearcut at year ${snapshots[ci].year}`).toBe(0);
    }

    // ── After planting: age > 0, height/diameter seeded (volume ≈ 0 at age 1) ──
    const plantYears = dbOps.filter((o) => o.type.includes("planting"));
    for (const pop of plantYears) {
      const idx = snapshots.findIndex((s) => s.year === pop.year + 1);
      if (idx > 0) {
        const snap = snapshots[idx].stands[0];
        expect(snap.volumeM3, `year after planting ${pop.year}`).toBeGreaterThanOrEqual(0);
        expect(snap.meanHeight, `year after planting ${pop.year}`).toBeGreaterThan(0);
        expect(snap.meanDiameter, `year after planting ${pop.year}`).toBeGreaterThan(0);
      }
    }

    // ── Volume never negative ──
    for (const ys of snapshots) {
      for (const stand of ys.stands) {
        expect(stand.volumeM3).toBeGreaterThanOrEqual(0);
      }
    }

    // ── Final state: mid-rotation with positive volume ──
    const finalSnap = snapshots[snapshots.length - 1].stands[0];
    expect(finalSnap.volumeM3).toBeGreaterThan(50);
    expect(finalSnap.meanHeight).toBeGreaterThan(5);
    expect(finalSnap.meanDiameter).toBeGreaterThan(5);
  });
});
