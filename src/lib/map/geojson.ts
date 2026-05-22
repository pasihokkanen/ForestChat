import type {
  Compartment,
  CompartmentFeature,
  CompartmentFeatureCollection,
} from "@/types/database";
import { LngLatBounds, type Map } from "maplibre-gl";

export function compartmentsToGeoJSON(
  compartments: Compartment[],
): CompartmentFeatureCollection {
  const features: CompartmentFeature[] = compartments
    .filter((c) => c.geometry !== null)
    .map((c) => ({
      type: "Feature" as const,
      geometry: c.geometry!,
      properties: {
        id: c.id,
        stand_id: c.stand_id,
        main_species: c.main_species,
        development_class: c.development_class,
        site_type: c.site_type,
        area_ha: c.area_ha,
        age_years: c.age_years,
        volume_m3: c.volume_m3,
      },
    }));

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Fit the map viewport to the bounding box of all features with
 * 5% padding on each side. Safe to call at any zoom level — uses
 * `fitBounds` with a maxZoom cap to avoid over-zooming on tiny stands.
 */
export function fitBoundsToFeatures(
  map: Map,
  collection: CompartmentFeatureCollection,
): void {
  if (!collection.features || collection.features.length === 0) return;

  const bounds = new LngLatBounds();

  for (const feature of collection.features) {
    if (!feature.geometry) continue;

    // Handle both coordinates formats (MultiPolygon and Polygon)
    const coords = feature.geometry.coordinates;
    if (!coords) continue;

    // MultiPolygon: coordinates[0] = polygon, coordinates[0][0] = linear ring
    // Polygon: coordinates[0] = linear ring
    const rings =
      feature.geometry.type === "MultiPolygon" ? coords.flat() : coords.length > 0 && Array.isArray(coords[0]?.[0]?.[0]) ? coords : [coords];

    for (const ring of rings) {
      if (!Array.isArray(ring)) continue;
      for (const point of ring) {
        if (Array.isArray(point) && point.length >= 2) {
          bounds.extend([point[0], point[1]] as [number, number]);
        }
      }
    }
  }

  if (bounds.isEmpty()) return;

  map.fitBounds(bounds, {
    padding: {
      top: Math.round(window.innerHeight * 0.05),
      bottom: Math.round(window.innerHeight * 0.05),
      left: Math.round(window.innerWidth * 0.05),
      right: Math.round(window.innerWidth * 0.05),
    },
    maxZoom: 15,
    duration: 800,
  });
}
