import { describe, it, expect } from "vitest";
import type { Compartment } from "@/types/database";
import { classifyAndValueStands } from "@/lib/ai/classify";

// Mock compartments matching the Hokkala forest data patterns
function makeCompartment(overrides: Partial<Compartment> & { stand_id: string }): Compartment {
  return {
    id: `test-${overrides.stand_id}`,
    forest_id: "test-forest",
    stand_id: overrides.stand_id,
    area_ha: overrides.area_ha ?? 2.0,
    main_species: overrides.main_species ?? "Mänty",
    development_class: overrides.development_class ?? "Varttunut kasvatusmetsikkö",
    site_type: overrides.site_type ?? "tuore",
    soil_type: overrides.soil_type ?? "kivennäismaa",
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
      makeCompartment({ stand_id: "2", development_class: "Varttunut kasvatusmetsikkö" }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.forestKuviot.length).toBe(1);
    expect(result.forestKuviot[0].numero).toBe("2");
  });

  it("classifies regeneration_ready as päätehakkuu", () => {
    const compartments = [
      makeCompartment({ stand_id: "3", development_class: "regeneration_ready", age_years: 85 }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.operations.some((o) => o.type === "clear_cut")).toBe(true);
  });

  it("handles K128 special case: uudistuskypsä at 57y → harvennus", () => {
    const compartments = [
      makeCompartment({ stand_id: "128", development_class: "Uudistuskypsä metsikkö", age_years: 57 }),
    ];
    const result = classifyAndValueStands(compartments);
    // Should NOT be clear_cut despite development_class
    expect(result.operations.some((o) => o.type === "clear_cut")).toBe(false);
    // Should be thinning instead
    expect(result.operations.some((o) => o.type === "thinning")).toBe(true);
  });

  it("calculates volume and value correctly", () => {
    const compartments = [
      makeCompartment({ stand_id: "4", volume_m3: 300, area_ha: 3.0, main_species: "Kuusi" }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.totalVolume).toBe(300);
    expect(result.totalArea).toBe(3.0);
    expect(result.totalValue).toBeGreaterThan(0);
    expect(result.totalGrowth).toBeGreaterThan(0);
  });

  it("assigns site_class correctly", () => {
    const compartments = [
      makeCompartment({ stand_id: "5", site_type: "lehtomainen" }),
    ];
    const result = classifyAndValueStands(compartments);
    expect(result.forestKuviot[0].site_class).toBe("lehtomainen");
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
    // A compartment with 50% Mänty, 50% Kuusi by volume
    const compartments = [
      makeCompartment({ stand_id: "7", volume_m3: 200, main_species: "Mänty" }),
    ];
    const result = classifyAndValueStands(compartments);
    // Value should be positive — based on timber prices
    expect(result.forestKuviot[0].arvo).toBeGreaterThan(0);
  });
});
