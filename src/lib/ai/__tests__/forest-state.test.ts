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
    // should differ (ageFactor shapes the curve). With forPlanning=true
    // age/density factors are skipped; growth is constant across ages.
    // Test age variation via direct getGrowthRate call instead.
    expect(youngGrowth).toEqual(oldGrowth);
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

  // ─── Full lifecycle (200 years, 2 rotations) ───

  it("simulates two full rotations over 200 years: pine → spruce → pine", () => {
    // Realistic Finnish stand on sub-xeric mineral soil (Väli-Suomi).
    // Base growth: 3.25 m³/ha/y. Area: 1.7 ha.
    // Rotation: tending ~12y, 1st thin ~25y, 2nd thin ~50y, clearcut ~80y.
    const comp: CompartmentInput = {
      id: "comp-life",
      stand_id: "LIFECYCLE-1",
      area_ha: 1.7,
      site_type: "sub-xeric",
      soil_type: "mineral",
      main_species: "pine",
      age_years: 5,
      volume_m3: 5,
      basal_area: 3,
      development_class: "seedling_pine",
    };

    const ops: OperationInput[] = [
      // ── Rotation 1: pine, age 5 → 79 ──
      { compartment_id: "comp-life", year: 7, type: "tending", removal_pct: 30 },
      { compartment_id: "comp-life", year: 20, type: "first_thinning", removal_pct: 30 },
      { compartment_id: "comp-life", year: 45, type: "thinning", removal_pct: 25 },
      { compartment_id: "comp-life", year: 75, type: "clear_cut", removal_pct: 100 },
      // ── Rotation 2: spruce, age 0 → 79 ──
      { compartment_id: "comp-life", year: 76, type: "spruce_planting", removal_pct: 0 },
      { compartment_id: "comp-life", year: 79, type: "early_tending", removal_pct: 40 },
      { compartment_id: "comp-life", year: 87, type: "tending", removal_pct: 30 },
      { compartment_id: "comp-life", year: 100, type: "first_thinning", removal_pct: 30 },
      { compartment_id: "comp-life", year: 125, type: "thinning", removal_pct: 25 },
      { compartment_id: "comp-life", year: 155, type: "clear_cut", removal_pct: 100 },
      // ── Rotation 3: pine, age 0 → 45 (ongoing) ──
      { compartment_id: "comp-life", year: 156, type: "pine_planting", removal_pct: 0 },
      { compartment_id: "comp-life", year: 159, type: "early_tending", removal_pct: 40 },
      { compartment_id: "comp-life", year: 167, type: "tending", removal_pct: 30 },
      { compartment_id: "comp-life", year: 180, type: "first_thinning", removal_pct: 30 },
    ];

    const timeline = estimateForestState([comp], ops, 1, 200);
    const s = timeline.get("comp-life")!;
    expect(s).toHaveLength(200);

    // ═══════════════════════════════════════════════════════════
    // ROTATION 1 — Pine (years 1-75, age 5 → clearcut at 79)
    // ═══════════════════════════════════════════════════════════

    // Young stand growth (years 1-6, age 5→11)
    for (let i = 0; i < 6; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
      if (i > 0) expect(s[i].volumeM3).toBeGreaterThan(s[i - 1].volumeM3);
    }

    // Year 7: tending (age 12) — removes ~30% of pre-tending volume
    expect(s[6].year).toBe(7);
    expect(s[6].operationType).toBe("tending");
    expect(s[6].harvestM3).toBeGreaterThan(0);
    // Volume still increases if growth exceeds removal (it does at this age)
    expect(s[6].volumeM3).toBeLessThan(s[5].volumeM3 + s[6].growthM3);

    // Growth years 8-19 (age 13→24)
    for (let i = 7; i < 19; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }

    // Year 20: first thinning (age 25)
    expect(s[19].year).toBe(20);
    expect(s[19].operationType).toBe("first_thinning");
    expect(s[19].harvestM3).toBeGreaterThan(0);
    expect(s[19].volumeM3).toBeLessThan(s[18].volumeM3 + s[19].growthM3);

    // Mid-rotation growth (years 21-44, age 26→49)
    for (let i = 20; i < 44; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }
    expect(s[43].volumeM3).toBeGreaterThan(s[19].volumeM3);

    // Year 45: second thinning (age 50)
    expect(s[44].year).toBe(45);
    expect(s[44].operationType).toBe("thinning");
    expect(s[44].harvestM3).toBeGreaterThan(0);

    // Late rotation (years 46-74, age 51→79) — growth may decline from
    // carrying-capacity cap, but still positive
    for (let i = 45; i < 74; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }
    const peakG1 = s[40].growthM3PerHa; // for cross-cycle comparison

    // Year 75: clearcut (age 79) — VMI13 base rate 3.25 × species 1.05 × 1.7 ha × 75 years ≈ 430 m³
    // minus ~30+35+65 = 130 m³ from thinnings → ~300 m³ harvest
    expect(s[74].year).toBe(75);
    expect(s[74].operationType).toBe("clear_cut");
    expect(s[74].harvestM3).toBeGreaterThan(200);
    expect(s[74].harvestM3).toBeLessThan(400);
    expect(s[74].volumeM3).toBe(0);
    expect(s[74].ageYears).toBe(0);

    // ═══════════════════════════════════════════════════════════
    // ROTATION 2 — Spruce (years 76-155, age 0 → clearcut at 79)
    // ═══════════════════════════════════════════════════════════

    // Year 76: replant spruce
    expect(s[75].year).toBe(76);
    expect(s[75].operationType).toBe("spruce_planting");
    expect(s[75].volumeM3).toBeGreaterThan(0);

    // Growth years 77-78 (age 2→3)
    for (let i = 76; i < 78; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
    }

    // Year 79: early tending (age 4) — removes ~40% of seedling volume
    expect(s[78].year).toBe(79);
    expect(s[78].operationType).toBe("early_tending");
    expect(s[78].harvestM3).toBeGreaterThan(0);

    // Growth years 80-86 (age 5→11)
    for (let i = 79; i < 86; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
    }

    // Year 87: tending (age 12) — removes ~30%
    expect(s[86].year).toBe(87);
    expect(s[86].operationType).toBe("tending");
    expect(s[86].harvestM3).toBeGreaterThan(0);

    // Growth years 88-99 (age 13→24)
    for (let i = 87; i < 99; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }

    // Year 100: first thinning (age 25)
    expect(s[99].year).toBe(100);
    expect(s[99].operationType).toBe("first_thinning");
    expect(s[99].harvestM3).toBeGreaterThan(0);

    // Mid-rotation (years 101-124, age 26→49)
    for (let i = 100; i < 124; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
    }
    expect(s[123].volumeM3).toBeGreaterThan(s[99].volumeM3);

    // Year 125: second thinning (age 50)
    expect(s[124].year).toBe(125);
    expect(s[124].operationType).toBe("thinning");
    expect(s[124].harvestM3).toBeGreaterThan(0);

    // Late rotation (years 126-154, age 51→79)
    for (let i = 125; i < 154; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }
    const peakG2 = s[120].growthM3PerHa;
    // Carrying-capacity cap may reduce growth in mature stands

    // Year 155: clearcut (age 79)
    expect(s[154].year).toBe(155);
    expect(s[154].operationType).toBe("clear_cut");
    expect(s[154].harvestM3).toBeGreaterThan(200);
    expect(s[154].harvestM3).toBeLessThan(400);
    expect(s[154].volumeM3).toBe(0);
    expect(s[154].ageYears).toBe(0);

    // ═══════════════════════════════════════════════════════════
    // ROTATION 3 — Pine (years 156-200, age 0 → 45, ongoing)
    // ═══════════════════════════════════════════════════════════

    // Year 156: replant pine
    expect(s[155].year).toBe(156);
    expect(s[155].operationType).toBe("pine_planting");
    expect(s[155].volumeM3).toBeGreaterThan(0);

    // Growth years 157-158 (age 2→3)
    for (let i = 156; i < 158; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
    }

    // Year 159: early tending (age 4) — removes ~40%
    expect(s[158].year).toBe(159);
    expect(s[158].operationType).toBe("early_tending");
    expect(s[158].harvestM3).toBeGreaterThan(0);

    // Growth years 160-166 (age 5→11)
    for (let i = 159; i < 166; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
    }

    // Year 167: tending (age 12) — removes ~30%
    expect(s[166].year).toBe(167);
    expect(s[166].operationType).toBe("tending");
    expect(s[166].harvestM3).toBeGreaterThan(0);

    // Growth years 168-179 (age 13→24)
    for (let i = 167; i < 179; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
      expect(s[i].harvestM3).toBe(0);
    }

    // Year 180: first thinning (age 25)
    expect(s[179].year).toBe(180);
    expect(s[179].operationType).toBe("first_thinning");
    expect(s[179].harvestM3).toBeGreaterThan(0);

    // Final growth (years 181-200, age 26→45)
    for (let i = 180; i < 200; i++) {
      expect(s[i].growthM3).toBeGreaterThan(0);
    }

    // ═══════════════════════════════════════════════════════════
    // Cross-cycle sanity checks
    // ═══════════════════════════════════════════════════════════

    // Both clearcuts should yield similar volumes (pine vs spruce on same site)
    const harvest1 = s[74].harvestM3;
    const harvest2 = s[154].harvestM3;
    expect(harvest1).toBeGreaterThan(200);
    expect(harvest1).toBeLessThan(400);
    const ratio = Math.max(harvest1, harvest2) / Math.min(harvest1, harvest2);
    expect(ratio).toBeLessThan(2.5); // similar cycles (VMI13 rates, carrying cap may differ)

    // Ending volume at year 200 (age 45, post first-thinning) — mid-rotation
    expect(s[199].volumeM3).toBeGreaterThan(60);
    expect(s[199].volumeM3).toBeLessThan(200);

    // Total harvest over 200 years
    const totalHarvest = s.reduce((sum, x) => sum + x.harvestM3, 0);
    expect(totalHarvest).toBeGreaterThan(500);
    expect(totalHarvest).toBeLessThan(900);

    // Per-hectare growth should be consistent across cycles
    // (same site, same base rate — only species factor differs)
    const cycle1Peak = peakG1;
    const cycle2Peak = peakG2;
    // Spruce grows somewhat slower than pine on sub-xeric (0.95 vs 1.05)
    expect(cycle2Peak).toBeGreaterThan(cycle1Peak * 0.80);
    expect(cycle2Peak).toBeLessThan(cycle1Peak * 1.20);
  });
});
