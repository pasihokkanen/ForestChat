import proj4 from "proj4";

// EPSG:3067 (ETRS-TM35FIN) definition for proj4
const EPSG3067 =
  "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs";

const MML_BASE =
  "https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3";
const MML_COLLECTION = "PalstanSijaintitiedot"; // Plot boundary polygons

export interface MmlPropertyBoundary {
  propertyId: string;
  geometry: GeoJSON.MultiPolygon; // Combined from all plots, in EPSG:3067
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
 * Combines all plots into a single MultiPolygon in EPSG:3067.
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

  // Combine all plots into a MultiPolygon, converting EPSG:4326→EPSG:3067
  const polygons: GeoJSON.Polygon[] = features.map(
    (f: GeoJSON.Feature) => {
      const geom = f.geometry as GeoJSON.Polygon;
      const convertedCoords = geom.coordinates.map((ring) =>
        ring.map(([lon, lat]: number[]) =>
          proj4("EPSG:4326", EPSG3067, [lon, lat])
        )
      );
      return { type: "Polygon" as const, coordinates: convertedCoords };
    }
  );

  const multiPolygon: GeoJSON.MultiPolygon = {
    type: "MultiPolygon",
    coordinates: polygons.map((p) => p.coordinates),
  };

  return {
    propertyId,
    geometry: multiPolygon,
    areaM2: null,
    plotCount: features.length,
  };
}
