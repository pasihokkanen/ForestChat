import type {
  Compartment,
  CompartmentFeature,
  CompartmentFeatureCollection,
} from "@/types/database";
import { LngLatBounds, type Map } from "maplibre-gl";
import proj4 from "proj4";

// EPSG:3067 (ETRS-TM35FIN) → EPSG:4326 (WGS84)
const EPSG3067 =
  "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs";
const EPSG4326 = "+proj=longlat +datum=WGS84 +no_defs +type=crs";

/**
 * Check if a GeoJSON geometry uses EPSG:3067 (which MapLibre can't render).
 * The Supabase import pipeline now stores everything in EPSG:4326,
 * but the PostGIS column SRID may add a misleading CRS tag. Always
 * check actual coordinate values to avoid double-reprojection.
 */
function isEPSG3067(geometry: Record<string, unknown>): boolean {
  const crs = geometry.crs as
    | { type?: string; properties?: { name?: string } }
    | undefined;
  if (!crs?.properties?.name?.includes("3067")) return false;

  // CRS claims 3067 — but verify coordinates are actually in meters,
  // not already reprojected to WGS84 degrees. EPSG:3067 coords for
  // Finland are roughly x=[70k,750k] y=[6.6M,7.8M]. If coords are
  // in degree range (-90..90 lat, -180..180 lon), they're already 4326.
  const coords = (geometry as { coordinates?: number[][][][] }).coordinates;
  if (!coords?.[0]?.[0]?.[0]) return true; // can't verify, trust CRS

  const [x, y] = coords[0][0][0];
  // EPSG:3067 X values for Finland are > 70,000; EPSG:4326 lon are < 180
  if (Math.abs(x) < 180 && Math.abs(y) < 90) return false; // already 4326

  return true; // large coordinate values — truly 3067
}

/**
 * Recursively reproject all coordinates in a MultiPolygon from
 * EPSG:3067 (meters) to EPSG:4326 (lat/lng degrees).
 */
function reprojectMultiPolygon3067to4326(
  coords: number[][][][],
): number[][][][] {
  return coords.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]) => {
        const [lng, lat] = proj4(EPSG3067, EPSG4326, [x, y]);
        return [lng, lat];
      }),
    ),
  );
}

/**
 * Strip the CRS property from a GeoJSON geometry (MapLibre
 * ignores it, and it adds noise to the data).
 */
function stripCRS(geometry: Record<string, unknown>): void {
  delete geometry.crs;
}

/**
 * Convert Supabase compartments to a MapLibre-compatible GeoJSON
 * FeatureCollection. Handles EPSG:3067→4326 reprojection when the
 * geometry was stored in the Finnish projected coordinate system.
 */
export function compartmentsToGeoJSON(
  compartments: Compartment[],
): CompartmentFeatureCollection {
  const features: CompartmentFeature[] = compartments
    .filter((c) => c.geometry !== null)
    .map((c) => {
      const geom = { ...(c.geometry as unknown as Record<string, unknown>) } as Record<
        string,
        unknown
      >;

      // Reproject if geometry is in EPSG:3067
      if (isEPSG3067(geom)) {
        const coords = geom.coordinates as number[][][][];
        if (coords && Array.isArray(coords)) {
          geom.coordinates = reprojectMultiPolygon3067to4326(coords);
        }
      }
      stripCRS(geom);

      return {
        type: "Feature" as const,
        geometry: geom as unknown as CompartmentFeature["geometry"],
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
      };
    });

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
      feature.geometry.type === "MultiPolygon"
        ? coords.flat()
        : coords.length > 0 && Array.isArray(coords[0]?.[0]?.[0])
          ? coords
          : [coords];

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
