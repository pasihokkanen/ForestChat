// src/lib/ai/__tests__/forest-state.test.ts
import { describe, it, expect } from "vitest";
import { estimateForestState, type CompartmentInput, type OperationInput } from "../forest-state";

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

    // Peak growth at middle age, lower at extremes — young and old
    // should differ (ageFactor shapes the curve)
    expect(youngGrowth).not.toBe(oldGrowth);
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

    // 2029: growth resumes (young trees, low rate)
    expect(snapshots[3].year).toBe(2029);
    expect(snapshots[3].growthM3).toBeGreaterThan(0);
    expect(snapshots[3].volumeM3).toBeGreaterThan(0);
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

  // ─── Full lifecycle ───

  it("simulates a full rotation cycle: planting → thinning → clearcut → replanting", () => {
    // Realistic Finnish pine stand on sub-xeric mineral soil (Väli-Suomi).
    // Base growth rate for sub-xeric mineral: 3.25 m³/ha/y (from config.ts).
    // Rotation: first thinning ~25y, second thinning ~50y, clearcut ~80y.
    const comp: CompartmentInput = {
      id: "comp-life",
      stand_id: "LIFECYCLE-1",
      area_ha: 1.7,          // like stand 4.0 from DB
      site_type: "sub-xeric",
      soil_type: "mineral",
      main_species: "pine",
      age_years: 5,          // seedling just entering young stand
      volume_m3: 5,          // ~3 m³/ha
      basal_area: 3,
      development_class: "seedling_pine",
    };

    const ops: OperationInput[] = [
      // Year 7 (age 12): tending — pre-commercial thinning, cost-only (VMI13 rates already bake in the removal)
      { compartment_id: "comp-life", year: 7, type: "tending", removal_pct: 0 },
      // Year 20 (age 25): first thinning at 30%
      { compartment_id: "comp-life", year: 20, type: "first_thinning", removal_pct: 30 },
      // Year 45 (age 50): second thinning at 25%
      { compartment_id: "comp-life", year: 45, type: "thinning", removal_pct: 25 },
      // Year 75 (age 80): clearcut
      { compartment_id: "comp-life", year: 75, type: "clear_cut", removal_pct: 100 },
      // Year 76 (age 0): replant with spruce
      { compartment_id: "comp-life", year: 76, type: "spruce_planting", removal_pct: 0 },
      // Year 79 (age 4): early tending (seedlings 1-2m)
      { compartment_id: "comp-life", year: 79, type: "early_tending", removal_pct: 0 },
      // Year 87 (age 12): tending (saplings 3-7m)
      { compartment_id: "comp-life", year: 87, type: "tending", removal_pct: 0 },
    ];

    const timeline = estimateForestState([comp], ops, 1, 90);
    const s = timeline.get("comp-life")!;
    expect(s).toHaveLength(90);

    // ── Young stand growth (years 1-6, age 5→11) ──
    for (let i = 0; i < 6; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
      expect(s[i].operationType).toBeNull();
      if (i > 0) expect(s[i].volumeM3).toBeGreaterThan(s[i - 1].volumeM3);
    }

    // ── Year 7: tending (age 12, saplings 3-7m) ──
    // Cost-only operation. VMI13 growth rates are empirical and already reflect
    // the effect of timely tending — volume continues growing normally.
    expect(s[6].year).toBe(7);
    expect(s[6].operationType).toBe("tending");
    expect(s[6].harvestM3).toBe(0);
    expect(s[6].volumeM3).toBeGreaterThan(s[5].volumeM3);

    // ── Continued growth (years 8-19, age 13→24) ──
    for (let i = 7; i < 19; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
      expect(s[i].operationType).toBeNull();
      if (i > 7) expect(s[i].volumeM3).toBeGreaterThan(s[i - 1].volumeM3);
    }

    // ── Year 20: first thinning (age 25) ──
    expect(s[19].year).toBe(20);
    expect(s[19].operationType).toBe("first_thinning");
    expect(s[19].harvestM3).toBeGreaterThan(0);
    const preThinVol = s[18].volumeM3;
    expect(s[19].volumeM3).toBeLessThan(preThinVol + s[19].growthM3);

    // ── Mid-rotation growth (years 21-44, age 26→49) ──
    for (let i = 20; i < 44; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }
    expect(s[43].volumeM3).toBeGreaterThan(s[19].volumeM3); // recovered from thinning

    // ── Year 45: second thinning (age 50) ──
    expect(s[44].year).toBe(45);
    expect(s[44].operationType).toBe("thinning");
    expect(s[44].harvestM3).toBeGreaterThan(0);

    // ── Late rotation growth (years 46-74, age 51→79) ──
    for (let i = 45; i < 74; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }
    // Growth per ha should decline toward end of rotation (ageFactor after 70)
    const peakGrowth = s[40].growthM3PerHa;   // age ~65, plateau
    const lateGrowth = s[72].growthM3PerHa;   // age ~77, decline
    expect(lateGrowth).toBeLessThanOrEqual(peakGrowth * 0.90);

    // ── Year 75: clearcut (age 80) ──
    expect(s[74].year).toBe(75);
    expect(s[74].operationType).toBe("clear_cut");
    expect(s[74].harvestM3).toBeGreaterThan(0);
    expect(s[74].volumeM3).toBe(0);
    expect(s[74].ageYears).toBe(0);

    // ── Year 76: replant with spruce (age → 1) ──
    expect(s[75].year).toBe(76);
    expect(s[75].operationType).toBe("spruce_planting");
    expect(s[75].volumeM3).toBeGreaterThan(0); // base volume seeded

    // ── New stand growth (years 77-78, age 2→3) ──
    for (let i = 76; i < 78; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }

    // ── Year 79: early tending (age 4, seedlings 1-2m) ──
    expect(s[78].year).toBe(79);
    expect(s[78].operationType).toBe("early_tending");

    // ── Continued growth (years 80-86, age 5→11) ──
    for (let i = 79; i < 86; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }

    // ── Year 87: tending (age 12, saplings 3-7m) ──
    expect(s[86].year).toBe(87);
    expect(s[86].operationType).toBe("tending");

    // ── Final years (88-90, age 13→15) ──
    for (let i = 87; i < 90; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
    }

    // ── Cross-cycle sanity checks ──
    // Clearcut harvest at age 80: VMI13 sub-xeric pine ~150-190 m³/ha → 255-323 on 1.7ha
    expect(s[74].harvestM3).toBeGreaterThan(250);
    expect(s[74].harvestM3).toBeLessThan(350);

    // New stand volume at end (age 15): realistic spruce sapling pole stage
    expect(s[89].volumeM3).toBeGreaterThan(25);
    expect(s[89].volumeM3).toBeLessThan(65);

    // Young spruce growth: base 3.25 × factors → 1.7-2.5 m³/ha/y typical
    expect(s[80].growthM3PerHa).toBeGreaterThan(1.5);
    expect(s[80].growthM3PerHa).toBeLessThan(3.0);
  });
});
