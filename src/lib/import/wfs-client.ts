import proj4 from "proj4";
import {
  MAINGROUP_MAP,
  FERTILITYCLASS_MAP,
  DEVELOPMENTCLASS_MAP,
  mapWfsCode,
  mapWfsNumericCode,
  mapSoilType,
} from "./code-tables";
import { reproject3067to4326 } from "./mml-client";

const EPSG3067 =
  "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs";

/**
 * Reproject bounding box from EPSG:4326 (WGS84 degrees) to EPSG:3067 (ETRS-TM35FIN meters).
 * MML boundary API returns EPSG:4326, but Metsäkeskus WFS requires EPSG:3067 bbox.
 */
export function bbox4326to3067(
  bbox: [number, number, number, number]
): [number, number, number, number] {
  const [minX, minY] = proj4("EPSG:4326", EPSG3067, [bbox[0], bbox[1]]);
  const [maxX, maxY] = proj4("EPSG:4326", EPSG3067, [bbox[2], bbox[3]]);
  return [minX, minY, maxX, maxY];
}

export interface WfsStand {
  standId: string;
  areaHa: number | null;
  mainSpecies: string | null;
  developmentClass: string | null;
  siteType: string | null;
  soilType: string | null;
  drainageStatus: string | null;
  ageYears: number | null;
  volumeM3: number | null;
  basalArea: number | null;
  avgDiameter: number | null;
  avgHeight: number | null;
  stemCount: number | null;
  growthM3PerHa: number | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  attributes: Record<string, unknown>;
}

const WFS_URL = "https://avoin.metsakeskus.fi/geoserver/v1/ows";

/** Bounding box from a GeoJSON Polygon or MultiPolygon. */
export function bboxFromGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const rings: GeoJSON.Position[][] =
    geometry.type === "Polygon"
      ? geometry.coordinates
      : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Convert Polygon to MultiPolygon for PostGIS compatibility. */
function toMultiPolygon(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.MultiPolygon {
  if (geom.type === "MultiPolygon") return geom;
  return {
    type: "MultiPolygon",
    coordinates: [geom.coordinates],
  };
}

export async function fetchStandsByBbox(
  bbox: [number, number, number, number],
  srsName: string = "EPSG:3067"
): Promise<WfsStand[]> {
  const [minX, minY, maxX, maxY] = bbox;

  const url = new URL(WFS_URL);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", "v1:stand");
  url.searchParams.set("srsName", `urn:x-ogc:def:crs:${srsName}`);
  url.searchParams.set(
    "bbox",
    `${minX},${minY},${maxX},${maxY},urn:x-ogc:def:crs:${srsName}`
  );
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("count", "2000");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `WFS returned ${response.status}: ${await response
        .text()
        .then((t) => t.slice(0, 200))}`
    );
  }

  const geojson = await response.json();
  if (!geojson.features?.length) return [];

  return geojson.features.map((f: GeoJSON.Feature) => {
    const p = f.properties ?? {};
    const rawGeom = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    return {
      standId: p.STANDNUMBEREXTENSION != null
        ? `${String(p.STANDNUMBER ?? "?")}.${String(p.STANDNUMBEREXTENSION)}`
        : String(p.STANDNUMBER ?? "?"),
      areaHa: p.AREA ?? null,
      mainSpecies: mapWfsNumericCode(MAINGROUP_MAP, p.MAINGROUP),
      developmentClass: mapWfsCode(DEVELOPMENTCLASS_MAP, p.DEVELOPMENTCLASS),
      siteType: mapWfsNumericCode(FERTILITYCLASS_MAP, p.FERTILITYCLASS),
      soilType: mapSoilType(p.SOILTYPE),
      drainageStatus:
        p.DRAINAGESTATE != null ? String(p.DRAINAGESTATE) : null,
      ageYears: p.MEANAGE ?? null,
      volumeM3: p.VOLUME ?? null,
      basalArea: p.BASALAREA ?? null,
      avgDiameter: p.MEANDIAMETER ?? null,
      avgHeight: p.MEANHEIGHT ?? null,
      growthM3PerHa: p.VOLUMEGROWTH ?? null,
      geometry: toMultiPolygon(
        reproject3067to4326(rawGeom) as GeoJSON.Polygon | GeoJSON.MultiPolygon
      ),
      attributes: p,
    };
  });
}
