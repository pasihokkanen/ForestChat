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
});
