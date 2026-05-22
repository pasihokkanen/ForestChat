import proj4 from "proj4";

// EPSG:3067 (ETRS-TM35FIN) definition for proj4 — used only for WFS reprojection
const EPSG3067 =
  "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs";

const MML_BASE =
  "https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3";
const MML_COLLECTION = "PalstanSijaintitiedot"; // Plot boundary polygons

export interface MmlPropertyBoundary {
  propertyId: string;
  geometry: GeoJSON.MultiPolygon; // Combined from all plots, in EPSG:4326 (WGS84)
  areaM2: number | null;
  plotCount: number;
}

/**
 * Remove dashes from Finnish property ID: "989-405-0001-0405" → "98940500010405"
 */
function normalizePropertyId(id: string): string {
  return id.replace(/-/g, "");
}

/**
 * Fetch property boundary from MML v3 API by Finnish property ID.
 * Combines all plots into a single MultiPolygon in EPSG:4326.
 * Returns null if the property is not found.
 */
export async function fetchPropertyBoundary(
  propertyId: string,
  apiKey: string
): Promise<MmlPropertyBoundary | null> {
  const normalized = normalizePropertyId(propertyId);
  const url = new URL(`${MML_BASE}/collections/${MML_COLLECTION}/items`);

  url.searchParams.set("kiinteistotunnus", normalized);
  url.searchParams.set("limit", "100");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:${apiKey}`)}`,
      Accept: "application/geo+json",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "MML API key not authorized for kiinteisto-avoin. Activate the service in OmaTili."
      );
    }
    throw new Error(
      `MML API returned ${response.status}: ${await response.text()}`
    );
  }

  const geojson = await response.json();

  if (!geojson.features || geojson.features.length === 0) {
    return null; // Property not found
  }

  const features = geojson.features;

  // Combine all plots into a MultiPolygon — keep in EPSG:4326
  const coordinates: GeoJSON.Position[][][] = features.map(
    (f: GeoJSON.Feature) => (f.geometry as GeoJSON.Polygon).coordinates
  );

  const multiPolygon: GeoJSON.MultiPolygon = {
    type: "MultiPolygon",
    coordinates,
  };

  return {
    propertyId,
    geometry: multiPolygon,
    areaM2: null,
    plotCount: features.length,
  };
}

/**
 * Reproject WFS stand geometry from EPSG:3067 to EPSG:4326.
 * PostGIS geometry columns use SRID 4326, so all data must be
 * stored in WGS84 lat/lng for correct spatial queries.
 */
export function reproject3067to4326(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const reprojectRing = (ring: GeoJSON.Position[]): GeoJSON.Position[] =>
    ring.map(([x, y]) => proj4(EPSG3067, "EPSG:4326", [x, y]));

  if (geom.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geom.coordinates.map(reprojectRing),
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geom.coordinates.map((polygon) =>
      polygon.map(reprojectRing)
    ),
  };
}
