/**
 * Unit test: GeoJSON conversion (P1.13 — src/lib/map/geojson.ts)
 *
 * Tests compartmentsToGeoJSON transformation.
 * Pure function — no Supabase, no React.
 */
import { describe, it, expect, vi } from "vitest";
import { compartmentsToGeoJSON, fitBoundsToFeatures } from "@/lib/map/geojson";
import type { Compartment, CompartmentFeatureCollection } from "@/types/database";

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
      makeCompartment({ development_class: "regeneration_ready" }),
    ]);
    expect(result.features[0].properties.development_class).toBe(
      "regeneration_ready",
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

  it("reprojects EPSG:3067 coordinates to EPSG:4326", () => {
    // EPSG:3067 coordinates near Ähtäri (~358600, 6943800)
    const compartment = makeCompartment({
      geometry: {
        type: "MultiPolygon",
        crs: {
          type: "name",
          properties: { name: "EPSG:3067" },
        },
        coordinates: [
          [[
            [358600, 6943800],
            [358700, 6943800],
            [358700, 6943900],
            [358600, 6943900],
            [358600, 6943800],
          ]],
        ],
      } as Compartment["geometry"],
    });

    const result = compartmentsToGeoJSON([compartment]);
    const geom = result.features[0].geometry as unknown as Record<string, unknown>;

    // CRS should be stripped
    expect(geom.crs).toBeUndefined();

    // Coordinates should now be in lat/lng degrees (roughly ~24°E, ~62.6°N)
    const coords = geom.coordinates as number[][][][];
    const [lng, lat] = coords[0][0][0];
    expect(lng).toBeGreaterThan(20);
    expect(lng).toBeLessThan(30);
    expect(lat).toBeGreaterThan(60);
    expect(lat).toBeLessThan(65);
  });

  it("leaves non-EPSG:3067 geometry untouched", () => {
    const compartment = makeCompartment({
      geometry: {
        type: "MultiPolygon",
        coordinates: [[[[24.0, 62.5], [24.5, 62.5], [24.5, 63.0], [24.0, 63.0], [24.0, 62.5]]]],
      },
    });

    const result = compartmentsToGeoJSON([compartment]);
    const geom = result.features[0].geometry as unknown as Record<string, unknown>;
    const coords = geom.coordinates as number[][][][];
    expect(coords[0][0][0]).toEqual([24.0, 62.5]);
  });
});

// ── fitBoundsToFeatures ─────────────────────────

function makeCollection(
  features: Partial<CompartmentFeatureCollection["features"][number]>[] = []
): CompartmentFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f, i) => ({
      type: "Feature" as const,
      geometry: f.geometry ?? { type: "MultiPolygon", coordinates: [] },
      properties: f.properties ?? {},
      ...f,
    })),
  } as CompartmentFeatureCollection;
}

describe("fitBoundsToFeatures", () => {
  it("expands bounds for all features", () => {
    const mockMap = {
      fitBounds: vi.fn(),
    };

    const collection = makeCollection([
      {
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [24.0, 62.0],
                [24.5, 62.0],
                [24.5, 62.5],
                [24.0, 62.5],
                [24.0, 62.0],
              ],
            ],
          ],
        },
      },
      {
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [24.2, 62.2],
                [24.8, 62.2],
                [24.8, 62.8],
                [24.2, 62.8],
                [24.2, 62.2],
              ],
            ],
          ],
        },
      },
    ]);

    fitBoundsToFeatures(
      mockMap as unknown as import("maplibre-gl").Map,
      collection
    );

    expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
    const [bounds, options] = mockMap.fitBounds.mock.calls[0];
    expect(options.maxZoom).toBe(15);
    expect(options.padding.top).toBeGreaterThan(0);
    // The bounds should cover both features: SW(24.0,62.0), NE(24.8,62.8)
    expect(bounds.getSouth()).toBeCloseTo(62.0, 1);
    expect(bounds.getWest()).toBeCloseTo(24.0, 1);
    expect(bounds.getNorth()).toBeCloseTo(62.8, 1);
    expect(bounds.getEast()).toBeCloseTo(24.8, 1);
  });

  it("skips empty collections", () => {
    const mockMap = {
      fitBounds: vi.fn(),
    };

    fitBoundsToFeatures(
      mockMap as unknown as import("maplibre-gl").Map,
      { type: "FeatureCollection", features: [] } as CompartmentFeatureCollection
    );

    expect(mockMap.fitBounds).not.toHaveBeenCalled();
  });

  it("handles single-point geometry", () => {
    const mockMap = {
      fitBounds: vi.fn(),
    };

    const collection = makeCollection([
      {
        geometry: {
          type: "MultiPolygon",
          coordinates: [[[[24.5, 62.5], [24.51, 62.5], [24.51, 62.51], [24.5, 62.51], [24.5, 62.5]]]],
        },
      },
    ]);

    fitBoundsToFeatures(
      mockMap as unknown as import("maplibre-gl").Map,
      collection
    );

    expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
  });
});
