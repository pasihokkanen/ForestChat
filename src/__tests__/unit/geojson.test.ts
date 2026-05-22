/**
 * Unit test: GeoJSON conversion (P1.13 — src/lib/map/geojson.ts)
 *
 * Tests compartmentsToGeoJSON transformation.
 * Pure function — no Supabase, no React.
 */
import { describe, it, expect } from "vitest";
import { compartmentsToGeoJSON } from "@/lib/map/geojson";
import type { Compartment } from "@/types/database";

function makeCompartment(overrides: Partial<Compartment> = {}): Compartment {
  return {
    id: "comp-1",
    forest_id: "forest-1",
    stand_id: "1",
    area_ha: 2.5,
    main_species: "Pine",
    development_class: "mature_thinning",
    site_type: "mesic",
    soil_type: null,
    drainage_status: null,
    age_years: 55,
    volume_m3: 450,
    basal_area: null,
    avg_diameter: null,
    avg_height: null,
    growth_m3_per_ha: null,
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[24.0, 62.5], [24.01, 62.5], [24.01, 62.51], [24.0, 62.51], [24.0, 62.5]]]],
    },
    attributes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("compartmentsToGeoJSON", () => {
  it("converts single compartment to FeatureCollection", () => {
    const result = compartmentsToGeoJSON([makeCompartment()]);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].type).toBe("Feature");
    expect(result.features[0].geometry.type).toBe("MultiPolygon");
  });

  it("preserves stand_id in properties", () => {
    const result = compartmentsToGeoJSON([
      makeCompartment({ stand_id: "42" }),
    ]);
    expect(result.features[0].properties.stand_id).toBe("42");
  });

  it("preserves development_class for MapLibre expression", () => {
    const result = compartmentsToGeoJSON([
      makeCompartment({ development_class: "Uudistuskypsä" }),
    ]);
    expect(result.features[0].properties.development_class).toBe(
      "Uudistuskypsä",
    );
  });

  it("filters out compartments with null geometry", () => {
    const compartments = [
      makeCompartment({ id: "with-geom" }),
      makeCompartment({ id: "null-geom", geometry: null }),
      makeCompartment({ id: "with-geom-2" }),
    ];
    const result = compartmentsToGeoJSON(compartments);
    expect(result.features).toHaveLength(2);
  });

  it("returns empty FeatureCollection for empty input", () => {
    const result = compartmentsToGeoJSON([]);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(0);
  });

  it("returns empty FeatureCollection when all geometries are null", () => {
    const compartments = [
      makeCompartment({ geometry: null }),
      makeCompartment({ geometry: null }),
    ];
    const result = compartmentsToGeoJSON(compartments);
    expect(result.features).toHaveLength(0);
  });
});
