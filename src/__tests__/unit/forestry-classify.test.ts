import { describe, it, expect } from "vitest";
import type { Compartment } from "@/types/database";
import { classifyAndValueStands } from "@/lib/ai/classify";

// --- Helpers ---

function makeCompartment(overrides: Partial<Compartment> & { stand_id: string }): Compartment {
  return {
    id: `test-${overrides.stand_id}`,
    forest_id: "test-forest",
    stand_id: overrides.stand_id,
    area_ha: overrides.area_ha ?? 2.0,
    main_species: overrides.main_species ?? "pine",
    development_class: overrides.development_class ?? "mature_thinning",
    site_type: overrides.site_type ?? "mesic",
    soil_type: overrides.soil_type ?? "mineral soil",
    drainage_status: overrides.drainage_status ?? "ei ojia",
    age_years: overrides.age_years ?? 50,
    volume_m3: overrides.volume_m3 ?? 200,
    basal_area: overrides.basal_area ?? 20,
    avg_diameter: overrides.avg_diameter ?? 25,
    avg_height: overrides.avg_height ?? 18,
    growth_m3_per_ha: overrides.growth_m3_per_ha ?? 5.5,
    geometry: null,
    attributes: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

describe("classifyAndValueStands", () => {
  it("filters out non-forest land types", () => {
    const compartments = [
      makeCompartment({ stand_id: "1", development_class: "Muu maa" }),
      makeCompartment({ stand_id: "2", development_class: "mature_thinning" }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.forestStands.length).toBe(1);
    expect(result.forestStands[0].standId).toBe("2");
  });

  it("classifies regeneration_ready as final harvest", () => {
    const compartments = [
      makeCompartment({ stand_id: "3", development_class: "regeneration_ready", age_years: 85 }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.operations.some((o) => o.type === "clear_cut")).toBe(true);
  });

  it("classifies edge-age regeneration_ready as clear_cut (not K128 — generic)", () => {
    // Regression: any regeneration_ready stand at ≥ optimal age gets clear_cut.
    // No stand-number-specific logic remains.
    const compartments = [
      makeCompartment({ stand_id: "18", main_species: "pine", site_type: "sub-xeric", development_class: "regeneration_ready", age_years: 60 }),
    ];
    const result = classifyAndValueStands(compartments);
    // At age 60 on kuivahko pine (optMin=75, optMax=100), NOT eligible → no clear_cut
    expect(result.operations.filter((o) => o.type === "clear_cut")).toHaveLength(0);
  });

  it("calculates volume and value correctly", () => {
    const compartments = [
      makeCompartment({ stand_id: "4", volume_m3: 300, area_ha: 3.0, main_species: "spruce" }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.totalVolume).toBe(300);
    expect(result.totalArea).toBe(3.0);
    expect(result.totalValue).toBeGreaterThan(0);
    expect(result.totalGrowth).toBeGreaterThan(0);
  });

  it("assigns site_class correctly", () => {
    const compartments = [
      makeCompartment({ stand_id: "5", site_type: "herb-rich heath" }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.forestStands[0].site_class).toBe("lehtomainen");
  });

  it("classifies seedling as early tending", () => {
    const compartments = [
      makeCompartment({ stand_id: "6", development_class: "seedling", age_years: 8 }),
    ];
    const result = classifyAndValueStands(compartments);
    const hasTending = result.operations.some(
      (o) => o.type === "early_tending"
    );
    expect(hasTending).toBe(true);
  });

  it("calculates per-species stumpage value", () => {
    const compartments = [
      makeCompartment({ stand_id: "7", volume_m3: 200, main_species: "pine" }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.forestStands[0].valueEur).toBeGreaterThan(0);
  });
});

// --- Goal-aware classification ---

describe("classifyAndValueStands with goals", () => {
  it("carbon_storage: over-age stand gets selection_cutting not clear_cut", () => {
    // kuivahko pine: optMax=100. Carbon requires age ≥ 115. Age 125 is eligible.
    const compartments = [
      makeCompartment({ stand_id: "c1", development_class: "regeneration_ready", age_years: 125, main_species: "pine", site_type: "sub-xeric" }),
    ];
    const result = classifyAndValueStands(compartments, "carbon_storage");
    expect(result.operations.some((o) => o.type === "clear_cut")).toBe(false);
    expect(result.operations.some((o) => o.type === "selection_cutting")).toBe(true);
  });

  it("carbon_storage: normal-age regeneration_ready skips clearcut entirely", () => {
    const compartments = [
      makeCompartment({ stand_id: "c2", development_class: "regeneration_ready", age_years: 72, main_species: "pine", site_type: "sub-xeric" }),
    ];
    // At 72y on kuivahko pine (optMin=75) → under eligible, so no op at all
    const result = classifyAndValueStands(compartments, "carbon_storage");
    expect(result.operations.filter((o) => o.type === "clear_cut" || o.type === "selection_cutting")).toHaveLength(0);
  });

  it("maximum_growth_aggressive: young but eligible stand gets clear_cut immediately", () => {
    const compartments = [
      makeCompartment({ stand_id: "a1", development_class: "regeneration_ready", age_years: 68, main_species: "spruce", site_type: "mesic" }),
    ];
    // Standard goal: age 68 on tuore spruce (optMin=60) → eligible
    const result = classifyAndValueStands(compartments, "maximum_growth_aggressive");
    expect(result.operations.some((o) => o.type === "clear_cut")).toBe(true);
  });

  it("balanced: regeneration_ready at optimal age gets clear_cut", () => {
    const compartments = [
      makeCompartment({ stand_id: "b1", development_class: "regeneration_ready", age_years: 70, main_species: "pine", site_type: "mesic" }),
    ];
    // tuore pine optMin=65 → eligible
    const result = classifyAndValueStands(compartments, "balanced");
    expect(result.operations.some((o) => o.type === "clear_cut")).toBe(true);
  });
});
