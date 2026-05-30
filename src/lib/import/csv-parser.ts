// src/lib/import/csv-parser.ts
// Parse Finnish/English semicolon-delimited forest compartment CSV files.
// Accepts Finnish, English, or mixed column headers; outputs English snake_case.

import * as Papa from "papaparse";

// ─── Mapping Tables ─────────────────────────────────────────────────

// Finnish CSV header → internal English field name (full-header matches only)
const FI_TO_EN_COLUMN: Record<string, string> = {
  pinta_ala_ha: "area_ha",
  maaluokka: "land_class",
  kehitysluokka: "development_class",
  kasvupaikka: "site_type",
  maalaji: "soil_type",
  ojitustilanne: "drainage_status",
  paapuulaji: "main_species",
  total_ika: "total_age",
  total_ppa: "total_basal_area",
  total_runkoluku: "total_stem_count",
  total_kpituus: "total_mean_height",
  total_klapimitta: "total_mean_diameter",
  total_tukki_pct: "total_log_pct",
};

// Finnish species field suffix → English suffix
const SPECIES_FIELD_SUFFIX_MAP: Record<string, string> = {
  ika: "age",
  ppa: "basal_area",
  runkoluku: "stem_count",
  kpituus: "mean_height",
  klapimitta: "mean_diameter",
  tukki_pct: "log_pct",
  m3_ha: "m3_ha",
  m3: "m3",
  pct: "pct",
};

// Finnish species prefix → English species name
const SPECIES_NAME_MAP: Record<string, string> = {
  mänty: "pine",
  kuusi: "spruce",
  haapa: "aspen",
  harmaaleppä: "grey_alder",
  hieskoivu: "downy_birch",
  lehtikuusi: "larch",
  rauduskoivu: "silver_birch",
  pihlaja: "rowan",
};

// English species names (for detecting English headers)
const ENGLISH_SPECIES_SET = new Set([
  "pine", "spruce", "aspen", "grey_alder", "downy_birch",
  "larch", "silver_birch", "rowan",
]);

// Finnish text values → English (matching code-tables.ts WFS output)
const FI_DEVCLASS_TEXT_MAP: Record<string, string> = {
  "Aukea": "open_area",
  "Taimikko": "seedling",
  "Nuori kasvatusmetsikkö": "young_thinning",
  "Varttunut kasvatusmetsikkö": "mature_thinning",
  "Uudistuskypsä metsikkö": "regeneration_ready",
  "Eri-ikäisrakenteinen": "uneven_aged",
  "Suojuspuusto": "shelterwood",
};

const FI_SITETYPE_TEXT_MAP: Record<string, string> = {
  "lehto": "herb-rich",
  "lehtomainen kangas": "herb-rich heath",
  "tuore kangas": "mesic",
  "kuivahko kangas": "sub-xeric",
  "kuiva kangas": "xeric",
  "karukkokangas": "barren",
};

const FI_DRAINAGE_TEXT_MAP: Record<string, string> = {
  "Ojitettu": "drained",
  "Ojittamaton": "undrained",
  "Turvekangas": "peatland_forest",
  "Luonnontilainen": "natural_state",
};

// English species field names (for detecting suffix is already English)
const ENGLISH_FIELD_NAMES = new Set(Object.values(SPECIES_FIELD_SUFFIX_MAP));

// ─── Types ─────────────────────────────────────────────────────────

export interface CsvSpeciesRow {
  species: string;          // English snake_case: "pine", "spruce", "aspen", etc.
  age: number | null;
  basal_area: number | null;
  stem_count: number | null;
  mean_height: number | null;
  mean_diameter: number | null;
  log_pct: number | null;
  m3_ha: number | null;
  m3: number | null;
  pct: number | null;
}

export interface CsvStandRow {
  stand_id: string;
  area_ha: number;
  land_class: string;
  development_class: string;
  site_type: string;
  soil_type: string;
  drainage_status: string;
  main_species: string;       // English: "pine", "spruce", etc.
  center_lat: number;
  center_lon: number;
  polygon_wkt: string;        // MULTIPOLYGON WKT in EPSG:4326
  total_age: number | null;
  total_basal_area: number | null;
  total_stem_count: number | null;
  total_mean_height: number | null;
  total_mean_diameter: number | null;
  total_log_pct: number | null;
  total_m3_ha: number | null;
  total_m3: number | null;
  total_pct: number | null;
  species: CsvSpeciesRow[];
}

export interface ParsedCsvData {
  stands: CsvStandRow[];
  totalStands: number;
  totalVolumeM3: number;
  speciesList: string[];      // English snake_case species names found
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Resolve a full CSV header to its internal English field name. */
function resolveField(csvHeader: string): string {
  return FI_TO_EN_COLUMN[csvHeader] ?? csvHeader;
}

/** Try to parse a value as a number; return null for empty/NaN. */
function parseNum(raw: string | undefined | null): number | null {
  if (raw === "" || raw === undefined || raw === null) return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

/**
 * Resolve species field suffix to English.
 * Tries progressively longer suffixes (right-to-left) to handle
 * compound Finnish suffixes like "tukki_pct" and "m3_ha".
 * E.g., mänty_tukki_pct → tries "pct", then "tukki_pct" → matches.
 */
function resolveFieldSuffix(suffix: string): string {
  if (suffix in SPECIES_FIELD_SUFFIX_MAP) return SPECIES_FIELD_SUFFIX_MAP[suffix];
  // Also check if it's already an English field
  if (ENGLISH_FIELD_NAMES.has(suffix)) return suffix;
  return suffix;
}

/**
 * Split a header into species prefix and field suffix, trying multiple
 * underscore positions to handle compound field suffixes.
 *
 * E.g., "mänty_tukki_pct" → tries suffix="pct" (no prefix match),
 * then suffix="tukki_pct" → prefix="mänty" ✓
 */
function splitSpeciesHeader(header: string): { prefix: string; suffix: string } | null {
  const parts = header.split("_");
  // Try splits from right to left — compound suffixes take priority
  for (let i = parts.length - 1; i >= 1; i--) {
    const suffix = parts.slice(i).join("_");
    if (isSpeciesFieldSuffix(suffix)) {
      const prefix = parts.slice(0, i).join("_");
      const species = resolveSpeciesPrefix(prefix);
      if (species) return { prefix, suffix };
    }
  }
  return null;
}

/** Detect if a string value is a species field suffix (Finnish or English). */
function isSpeciesFieldSuffix(suffix: string): boolean {
  return suffix in SPECIES_FIELD_SUFFIX_MAP || ENGLISH_FIELD_NAMES.has(suffix);
}

/** Resolve a species prefix to English. Returns null if not a recognized species. */
function resolveSpeciesPrefix(prefix: string): string | null {
  // Check Finnish → English map
  if (prefix in SPECIES_NAME_MAP) return SPECIES_NAME_MAP[prefix];
  // Check English set
  if (ENGLISH_SPECIES_SET.has(prefix)) return prefix;
  return null;
}

/** Translate Finnish text values to English. Passes through unchanged if unknown. */
function translateValue(fieldName: string, value: string): string {
  if (!value) return value;
  switch (fieldName) {
    case "development_class":
      return FI_DEVCLASS_TEXT_MAP[value] ?? value;
    case "site_type":
      return FI_SITETYPE_TEXT_MAP[value] ?? value;
    case "drainage_status":
      return FI_DRAINAGE_TEXT_MAP[value] ?? value;
    default:
      return value;
  }
}

// ─── Species Column Detection ──────────────────────────────────────

interface DetectedSpeciesCol {
  species: string;      // English snake_case
  field: string;        // English suffix
  csvHeader: string;    // Original CSV header
}

/**
 * Scan CSV headers to detect species columns.
 *
 * Algorithm:
 * For each header that isn't in FI_TO_EN_COLUMN and isn't a known stand field:
 *   1. Split on the LAST underscore
 *   2. Check if suffix is a known species field
 *   3. If yes, check if prefix is a known species
 *   4. If recognized: map both to English, register the column
 */
function detectSpeciesColumns(headers: string[]): DetectedSpeciesCol[] {
  const result: DetectedSpeciesCol[] = [];
  const knownFields = new Set([
    "stand_id", "pinta_ala_ha", "area_ha", "maaluokka", "land_class",
    "kehitysluokka", "development_class", "kasvupaikka", "site_type",
    "maalaji", "soil_type", "ojitustilanne", "drainage_status",
    "paapuulaji", "main_species", "center_lat", "center_lon", "polygon_wkt",
  ]);

  const isTotalField = (h: string): boolean =>
    h.startsWith("total_") || (FI_TO_EN_COLUMN[h] ?? "").startsWith("total_");

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];

    // Skip known stand-level headers
    if (knownFields.has(header)) continue;
    if (isTotalField(header)) continue;
    if (header in FI_TO_EN_COLUMN) continue;

    // Try splitting using the compound-suffix-aware helper
    const split = splitSpeciesHeader(header);
    if (!split) continue;

    const species = resolveSpeciesPrefix(split.prefix);
    if (!species) continue;

    const field = resolveFieldSuffix(split.suffix);

    result.push({ species, field, csvHeader: header });
  }

  return result;
}

// ─── Parser ────────────────────────────────────────────────────────

/**
 * Parse forest compartment CSV format.
 * Handles Finnish, English, or mixed headers.
 * Outputs English snake_case field names and species names.
 */
export function parseForestDataCsv(csvContent: string): ParsedCsvData {
  // 1. Parse with Papa Parse
  const parseResult = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    delimiter: ";",
    skipEmptyLines: true,
    dynamicTyping: false, // Keep as strings — we parse numbers manually
    transformHeader: (h: string) => h.trim(),
  });

  if (parseResult.errors.length > 0) {
    const firstErr = parseResult.errors[0];
    throw new Error(
      `CSV parse error at row ${firstErr.row}: ${firstErr.message}`
    );
  }

  const headers = parseResult.meta.fields ?? [];
  const rows = parseResult.data;

  if (rows.length === 0) {
    return { stands: [], totalStands: 0, totalVolumeM3: 0, speciesList: [] };
  }

  // 2. Detect species columns
  const speciesCols = detectSpeciesColumns(headers);

  // Build map: header -> { species, field } for quick lookup
  const speciesColMap = new Map<string, { species: string; field: string }>();
  for (const col of speciesCols) {
    speciesColMap.set(col.csvHeader, { species: col.species, field: col.field });
  }

  // 3. Process each data row
  const stands: CsvStandRow[] = [];
  let totalVolumeM3 = 0;
  const speciesSet = new Set<string>();

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const standId = row["stand_id"] ?? "";
    if (!standId) continue; // skip rows without stand_id

    // Map stand fields
    const areaHa = parseNum(row["area_ha"] ?? row["pinta_ala_ha"]) ?? 0;
    const landClass = row["land_class"] ?? row["maaluokka"] ?? "";
    const devClass = translateValue(
      "development_class",
      row["development_class"] ?? row["kehitysluokka"] ?? ""
    );
    const siteType = translateValue(
      "site_type",
      row["site_type"] ?? row["kasvupaikka"] ?? ""
    );
    const soilType = row["soil_type"] ?? row["maalaji"] ?? "";
    const drainageStatus = translateValue(
      "drainage_status",
      row["drainage_status"] ?? row["ojitustilanne"] ?? ""
    );
    const rawMainSpecies = row["main_species"] ?? row["paapuulaji"] ?? "";
    const mainSpecies =
      SPECIES_NAME_MAP[rawMainSpecies] ?? rawMainSpecies;

    const polygonWkt = row["polygon_wkt"] ?? "";
    const centerLat = parseNum(row["center_lat"]) ?? 0;
    const centerLon = parseNum(row["center_lon"]) ?? 0;

    // Parse totals — try English first, fall back to Finnish
    const totalAge = parseNum(row["total_age"]) ?? parseNum(row["total_ika"]);
    const totalBasalArea = parseNum(row["total_basal_area"]) ?? parseNum(row["total_ppa"]);
    const totalStemCount = parseNum(row["total_stem_count"]) ?? parseNum(row["total_runkoluku"]);
    const totalMeanHeight = parseNum(row["total_mean_height"]) ?? parseNum(row["total_kpituus"]);
    const totalMeanDiameter = parseNum(row["total_mean_diameter"]) ?? parseNum(row["total_klapimitta"]);
    const totalLogPct = parseNum(row["total_log_pct"]) ?? parseNum(row["total_tukki_pct"]);
    const totalM3Ha = parseNum(row["total_m3_ha"]);
    const totalM3 = parseNum(row["total_m3"]);
    const totalPct = parseNum(row["total_pct"]);

    // Collect species rows
    const species: CsvSpeciesRow[] = [];
    const speciesGrouped = new Map<string, Record<string, string>>();

    // Group raw CSV values by species
    speciesColMap.forEach((colInfo, csvHeader) => {
      const rawVal = row[csvHeader];
      if (rawVal === undefined) return;

      let group = speciesGrouped.get(colInfo.species);
      if (!group) {
        group = {};
        speciesGrouped.set(colInfo.species, group);
      }
      group[colInfo.field] = rawVal;
    });

    // Build CsvSpeciesRow for each detected species
    const spEntries = Array.from(speciesGrouped.entries());
    for (let s = 0; s < spEntries.length; s++) {
      const [spName, fields] = spEntries[s];
      const m3 = parseNum(fields["m3"] ?? "");

      // Only include species that have volume > 0 or the row explicitly has data
      if (m3 === null || m3 <= 0) {
        // Check if any other field has a value
        const keys = Object.keys(fields);
        let hasAnyData = false;
        for (let k = 0; k < keys.length; k++) {
          const v = fields[keys[k]];
          if (v !== "" && v !== null && v !== undefined) {
            hasAnyData = true;
            break;
          }
        }
        if (!hasAnyData) continue;
      }

      speciesSet.add(spName);

      species.push({
        species: spName,
        age: parseNum(fields["age"] ?? fields["ika"] ?? ""),
        basal_area: parseNum(fields["basal_area"] ?? fields["ppa"] ?? ""),
        stem_count: parseNum(fields["stem_count"] ?? fields["runkoluku"] ?? ""),
        mean_height: parseNum(fields["mean_height"] ?? fields["kpituus"] ?? ""),
        mean_diameter: parseNum(fields["mean_diameter"] ?? fields["klapimitta"] ?? ""),
        log_pct: parseNum(fields["log_pct"] ?? fields["tukki_pct"] ?? ""),
        m3_ha: parseNum(fields["m3_ha"] ?? ""),
        m3: m3,
        pct: parseNum(fields["pct"] ?? ""),
      });
    }

    const stand: CsvStandRow = {
      stand_id: standId,
      area_ha: areaHa,
      land_class: landClass,
      development_class: devClass,
      site_type: siteType,
      soil_type: soilType,
      drainage_status: drainageStatus,
      main_species: mainSpecies,
      center_lat: centerLat,
      center_lon: centerLon,
      polygon_wkt: polygonWkt,
      total_age: totalAge,
      total_basal_area: totalBasalArea,
      total_stem_count: totalStemCount,
      total_mean_height: totalMeanHeight,
      total_mean_diameter: totalMeanDiameter,
      total_log_pct: totalLogPct,
      total_m3_ha: totalM3Ha,
      total_m3: totalM3,
      total_pct: totalPct,
      species,
    };

    stands.push(stand);
    totalVolumeM3 += totalM3 ?? 0;
  }

  return {
    stands,
    totalStands: stands.length,
    totalVolumeM3: Math.round(totalVolumeM3),
    speciesList: Array.from(speciesSet).sort(),
  };
}
