# Phase 5: CSV Stand Data Import

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> **P5.10 (chart engine alias fix) is committed separately — not part of this plan.**

**Version:** 5.0
**Date:** 2026-05-29

**Changelog v5.0 (from v4.0):**
- Renamed `compartment_species.puulaji` → `species` (English), `tukkiprosentti` → `log_pct` (English) — migration 008
- Updated all plan interfaces: `CsvSpeciesRow.puulaji` → `species`, added `log_pct` field
- Added P5.13 task to update all existing source file references (10 files)
- Updated all plan references to use English column names throughout
- `FIELD_ALIASES` in chart-engine.ts simplified: `species`/`tree_species` → `"species"` (no-op alias removed)
- `system-prompt.ts` chart templates updated: `puulaji` → `species`
- `classify.ts` species comparison updated: Finnish values → English values
- No existing data migration needed (development phase, data will be reimported)

**Changelog v4.0 (from v3.0):**
- Removed all `createAdminClient` usage from CSV importer — uses `createServerSupabase` (user auth via RLS) instead
- Species names use English internally (`"Pine"`, `"Spruce"`, etc.) with a Finnish→English mapping table, consistent with existing `code-tables.ts` pattern
- CSV parser accepts both Finnish and English column headers — internal representation is always English
- Resolved P5.4/P5.9 contradiction: CSV importer has self-contained species population; old `populateCompartmentSpecies` still removed from spatial-service
- Added all-or-nothing error handling with cleanup-on-failure for CSV path; WFS path fix as separate task (P5.14)
- Removed P5.10 from plan (committed separately)
- Removed P5.11 (system prompt already neutral about data source)
- Added WKT-specific unit test cases
- Changed duplicate stand_id handling from "skip" to "upsert" (consistent with existing WFS pattern)
- Removed hardcoded stand counts — plan is generic for any forest property
- Added Finnish↔English header mapping table and species name mapping table

**Goal:** Add CSV stand data import alongside the existing Metsäkeskus API import. The import page offers two clearly labeled options for importing stand data. CSV import uses the flat format from forest-compartments CSV files (92 columns, semicolon-delimited, 8 species × 9 fields). Property boundary is always fetched from MML API regardless of import method. **All data names, field names, and column names are English throughout the system** — Finnish only appears at the CSV header layer.

**Architecture:** Two import paths on the same page, sharing the MML boundary fetch. CSV path: parse flat CSV → extract property ID → MML fetch boundary → store compartments with WKT geometry + species data. API path: unchanged (remove gridcell code only). Both paths use `createServerSupabase()` for database writes — no admin client, all RLS-enforced. **Migration 008 renames the two remaining Finnish DB columns (`puulaji`→`species`, `tukkiprosentti`→`log_pct`) for full English consistency.**

**CSV Source:** Semicolon-delimited CSV with polygon WKT in EPSG:4326. Headers may be in Finnish or English.

**Tech Stack:** TypeScript, Next.js 16, Supabase + PostGIS (RLS-enforced), Papa Parse, Turf.js, proj4

---

## 0. CSV Format

```
Header: stand_id;pinta_ala_ha;maaluokka;kehitysluokka;kasvupaikka;maalaji;ojitustilanne;paapuulaji;center_lat;center_lon;polygon_wkt;total_ika;...;rauduskoivu_pct
Data:   1.0;3.2;Metsämaa Kangas;Nuori kasvatusmetsikkö;...;MULTIPOLYGON(((24.231...;...;91
```

### Column groups

| Group | Columns | Count |
|---|---|---|
| Stand attributes | `stand_id`, `pinta_ala_ha`/`area_ha`, `maaluokka`/`land_class`, `kehitysluokka`/`development_class`, `kasvupaikka`/`site_type`, `maalaji`/`soil_type`, `ojitustilanne`/`drainage_status`, `paapuulaji`/`main_species` | 8 |
| Geometry | `center_lat`, `center_lon`, `polygon_wkt` (EPSG:4326 MULTIPOLYGON WKT) | 3 |
| Stand totals | `total_ika`, `total_ppa`, `total_runkoluku`, `total_kpituus`, `total_klapimitta`, `total_tukki_pct`, `total_m3_ha`, `total_m3`, `total_pct` | 9 |
| 8 species × 9 fields | `{species}_ika`, `_ppa`, `_runkoluku`, `_kpituus`, `_klapimitta`, `_tukki_pct`, `_m3_ha`, `_m3`, `_pct` | 72 |
| **Total** | | **92** |

Species column prefixes: `haapa_*`, `harmaaleppä_*`, `hieskoivu_*`, `kuusi_*`, `lehtikuusi_*`, `mänty_*`, `pihlaja_*`, `rauduskoivu_*`

Empty species cells = stand doesn't have that species. Polygon WKT is in EPSG:4326 (`lon lat` order).

### Column Header Language

The CSV parser accepts headers in **either Finnish or English**. The internal representation is always English.

| Finnish header | English header | Internal field |
|---|---|---|
| `stand_id` | `stand_id` | `stand_id` |
| `pinta_ala_ha` | `area_ha` | `area_ha` |
| `maaluokka` | `land_class` | `land_class` |
| `kehitysluokka` | `development_class` | `development_class` |
| `kasvupaikka` | `site_type` | `site_type` |
| `maalaji` | `soil_type` | `soil_type` |
| `ojitustilanne` | `drainage_status` | `drainage_status` |
| `paapuulaji` | `main_species` | `main_species` |
| `center_lat` | `center_lat` | `center_lat` |
| `center_lon` | `center_lon` | `center_lon` |
| `polygon_wkt` | `polygon_wkt` | `polygon_wkt` |
| `total_*` | `total_*` | (used for mapping — see below) |
| `{species}_*` | (species columns — see species mapping below) | |

The parser auto-detects language by checking the first few headers. If `pinta_ala_ha` is present → Finnish mode. If `area_ha` is present → English mode. Unknown headers are ignored.

### English↔Finnish Column Mapping

```typescript
// Maps Finnish CSV headers → internal English field names
const FI_TO_EN_COLUMN: Record<string, string> = {
  pinta_ala_ha: "area_ha",
  maaluokka: "land_class",
  kehitysluokka: "development_class",
  kasvupaikka: "site_type",
  maalaji: "soil_type",
  ojitustilanne: "drainage_status",
  paapuulaji: "main_species",
};
```

### Species Name Mapping

Species are stored in English in the database. CSV species column prefixes are in Finnish — the parser maps them to English using a lookup table:

```typescript
// Finnish CSV species prefix → English species name (stored in compartment_species.species)
const SPECIES_NAME_MAP: Record<string, string> = {
  mänty: "Pine",
  kuusi: "Spruce",
  haapa: "Aspen",
  harmaaleppä: "Grey alder",
  hieskoivu: "Downy birch",
  lehtikuusi: "Larch",
  rauduskoivu: "Silver birch",
  pihlaja: "Rowan",
};
```

This follows the same pattern as the existing `MAINGROUP_MAP` in `code-tables.ts` which maps numeric codes → English names (`1: "Pine"`, `2: "Spruce"`, `3: "Broadleaf"`).

### Key design decisions

- **Property ID is NOT in the CSV** — the MML fetch needs a separate property ID input from the user.
- **Polygon geometry is already in the CSV** as WKT — no WFS stand fetch needed for CSV import.
- **Species data is already in the CSV** as columns — no gridcell population needed.
- **No admin client** — all writes go through the authenticated user's `createServerSupabase()` client, enforced by RLS policies.
- **English everywhere** — all DB column names, TypeScript field names, and data values use English. Finnish only exists at the CSV header layer (and is translated on parse). Migration 008 renames the last two Finnish DB columns (`puulaji`→`species`, `tukkiprosentti`→`log_pct`).

---

## 1. Data Flow

### Path A: Metsäkeskus API (existing, minus gridcells)

```
User enters property ID
  → MML API → property boundary
  → WFS v1:stand → stand attributes + geometries
  → Store in Supabase (compartments)
```

### Path B: CSV file upload (new)

```
User uploads CSV file + enters property ID
  → Parse CSV (Papa Parse) → typed stand rows with English field names
  → MML API → property boundary
  → Create forest record (data_source: 'csv', via user's auth session)
  → Store compartments (English field names + WKT→GeoJSON geometry)
  → Store species breakdown (Finnish CSV columns → English species names → compartment_species)
  → On any failure: delete forest (cascade removes compartments, species, boundary)
```

---

## 2. UI Design

The existing `/forest/new` page gets a **two-tab layout**:

```
┌──────────────────────────────────────────────────┐
│  Import Stand Data                                │
│                                                    │
│  [ Metsäkeskus API ]  |  [ CSV File ]              │  ← tabs
│  ──────────────────────────────────────────────    │
│                                                    │
│  Import stand data from the Finnish Forest         │  ← description per tab
│  Centre (Metsäkeskus) open WFS API. Enter          │
│  your property ID to fetch stands automatically.   │
│                                                    │
│  Property ID                                       │
│  ┌──────────────────────────────────────────────┐  │
│  │ 989-405-0001-0405                            │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  Forest name (optional)                            │
│  ┌──────────────────────────────────────────────┐  │
│  │ Hokkala                                      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  [ Import Stand Data ]                             │
└──────────────────────────────────────────────────┘
```

**CSV tab:**

```
┌──────────────────────────────────────────────────┐
│  Import Stand Data                                │
│                                                    │
│  [ Metsäkeskus API ]  |  [ CSV File ]              │
│  ──────────────────────────────────────────────    │
│                                                    │
│  Import stand data from a CSV file. The file       │
│  must contain stand attributes, species breakdown, │
│  and polygon geometry in WKT format.               │
│                                                    │
│  Property ID                                       │
│  ┌──────────────────────────────────────────────┐  │
│  │ 989-405-0001-0405                            │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  Stand data CSV file                               │
│  ┌──────────────────────────────────────────────┐  │
│  │ 📁 forest_data.csv                           │  │  ← file input
│  └──────────────────────────────────────────────┘  │
│  N stands · 8 species · X m³ total volume          │  ← parsed preview
│                                                    │
│  Forest name (optional)                            │
│  ┌──────────────────────────────────────────────┐  │
│  │ Hokkala                                      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  [ Import Stand Data ]                             │
└──────────────────────────────────────────────────┘
```

### Progress stages (CSV path)

```
○ Parsing CSV file...              → client-side parse
  ✓ N stands, X m³ found
○ Fetching property boundary...    → MML API
○ Storing compartments...          → Supabase insert (user auth)
○ Importing species data...        → Supabase insert (user auth)
```

### Progress stages (API path — unchanged)

```
○ Fetching property boundary...    → MML API
○ Fetching stand data...           → WFS API
○ Storing data...                  → Supabase insert
```

---

## 3. Task Breakdown

### Track A: CSV Parser (3 tasks, ~1.5h)

---

#### P5.1: Install Papa Parse and create CSV parser

**Objective:** Parse the semicolon-delimited CSV format into typed TypeScript structures. Accepts both Finnish and English column headers, outputs English field names.

**Files:**
- `package.json` — add `papaparse`, `@types/papaparse`, `tsx` (devDep)
- Create: `src/lib/import/csv-parser.ts`

```typescript
// src/lib/import/csv-parser.ts

// Finnish CSV header → internal English field name
const FI_TO_EN_COLUMN: Record<string, string> = {
  pinta_ala_ha: "area_ha",
  maaluokka: "land_class",
  kehitysluokka: "development_class",
  kasvupaikka: "site_type",
  maalaji: "soil_type",
  ojitustilanne: "drainage_status",
  paapuulaji: "main_species",
};

// Finnish CSV species prefix → English species name (stored in compartment_species.species)
const SPECIES_NAME_MAP: Record<string, string> = {
  mänty: "Pine",
  kuusi: "Spruce",
  haapa: "Aspen",
  harmaaleppä: "Grey alder",
  hieskoivu: "Downy birch",
  lehtikuusi: "Larch",
  rauduskoivu: "Silver birch",
  pihlaja: "Rowan",
};

export interface CsvSpeciesRow {
  species: string;          // English: "Pine", "Spruce", "Aspen", etc.
  ika: number | null;
  ppa: number | null;       // basal area (m²/ha)
  runkoluku: number | null; // stems/ha
  kpituus: number | null;   // mean height (m)
  klapimitta: number | null; // mean diameter (cm)
  log_pct: number | null;   // sawlog percentage (0-100)
  m3_ha: number | null;
  m3: number | null;
  pct: number | null;
}

export interface CsvStandRow {
  stand_id: string;          // e.g., "1.0", "4.0"
  area_ha: number;
  land_class: string;        // from maaluokka
  development_class: string; // from kehitysluokka
  site_type: string;         // from kasvupaikka
  soil_type: string;         // from maalaji
  drainage_status: string;   // from ojitustilanne
  main_species: string;      // from paapuulaji (English via SPECIES_NAME_MAP)
  center_lat: number;
  center_lon: number;
  polygon_wkt: string;       // MULTIPOLYGON WKT in EPSG:4326
  total_ika: number | null;
  total_ppa: number | null;
  total_runkoluku: number | null;
  total_kpituus: number | null;
  total_klapimitta: number | null;
  total_tukki_pct: number | null;
  total_m3_ha: number | null;
  total_m3: number | null;
  total_pct: number | null;
  species: CsvSpeciesRow[];  // parsed from species columns
}

export interface ParsedCsvData {
  stands: CsvStandRow[];
  totalStands: number;
  totalVolumeM3: number;
  speciesList: string[];     // English species names found
}

/**
 * Resolve a CSV header to its internal field name.
 * Accepts Finnish or English headers.
 */
function resolveField(csvHeader: string): string {
  if (csvHeader in FI_TO_EN_COLUMN) return FI_TO_EN_COLUMN[csvHeader];
  return csvHeader; // English headers pass through unchanged
}

/**
 * Parse forest compartment CSV format.
 * Auto-detects language from headers. Outputs English field names.
 */
export function parseForestDataCsv(csvContent: string): ParsedCsvData;
```

**Parser logic:**
1. Papa Parse with `delimiter: ";"`, `header: true`, `skipEmptyLines: true`
2. Read header row → map each header through `resolveField()`
3. Detect species columns: any header matching `{prefix}_m3` where prefix is a key in `SPECIES_NAME_MAP`
4. For each data row:
   a. Parse stand attribute columns (Finnish or English → internal field)
   b. For each detected species prefix, collect all 9 fields into a `CsvSpeciesRow`
   c. Skip species rows where `m3` is null or 0
5. Return `ParsedCsvData` with typed stand rows and summary stats

**Verification:**
```bash
npx tsx -e "
import { parseForestDataCsv } from './src/lib/import/csv-parser';
import fs from 'fs';
const csv = fs.readFileSync(process.argv[1], 'utf-8');
const result = parseForestDataCsv(csv);
console.log('Stands:', result.totalStands);
console.log('Volume:', result.totalVolumeM3, 'm³');
console.log('Species:', result.speciesList.join(', '));
console.log('First stand:', result.stands[0]?.stand_id, result.stands[0]?.area_ha, 'ha');
console.log('First stand species[0].species:', result.stands[0]?.species[0]?.species);
" ~/Metsa/upm_forest_data.csv
# Expected: species[0].species = "Pine" (English, not mänty)
```

---

#### P5.2: Write unit tests

**Files:**
- Create: `src/__tests__/unit/csv-parser.test.ts`

**Test cases:**
1. Parse CSV with Finnish headers → all fields mapped to English internal names
2. Parse CSV with English headers → passes through unchanged
3. Verify species name mapping: `mänty_m3` column → `CsvSpeciesRow.species = "Pine"`
4. Verify log_pct field: `mänty_tukki_pct` → `CsvSpeciesRow.log_pct`
5. Empty species columns → `null` values, not zero
6. Stand with missing `polygon_wkt` → `polygon_wkt = ""` (handled gracefully)
7. Stand with `total_m3 = 0` (Joutomaa) → still imported
8. Valid WKT string → `polygon_wkt` contains `MULTIPOLYGON(((...)))`
9. Malformed WKT (unbalanced parens) → string still stored (PostGIS will reject on insert)
10. CSV with different species columns → parser auto-detects from header
11. Total volume aggregation matches sum of `total_m3`
12. All 8 species detected with correct English names

---

#### P5.3: Handle edge cases

- Empty/blank cells → `null` (not 0)
- Missing `polygon_wkt` → stand stored without geometry (set `geometry: null`)
- Stands with `total_m3 = 0` (Joutomaa) → still imported
- Duplicate `stand_id` → handled by UPSERT in importer (not skipped)
- CSV with different species columns → auto-detect from header
- CSV with Finnish headers → mapped to English via `FI_TO_EN_COLUMN`
- CSV with English headers → pass through unchanged
- Species with volume 0 → not inserted into `compartment_species`
- Main species (`paapuulaji`) values → mapped through `SPECIES_NAME_MAP` for consistency
- `total_m3_ha` (standing volume/ha) → stored in `attributes` JSONB, NOT in `growth_m3_per_ha` (which stores annual growth from WFS)

---

### Track B: Import Pipeline (4 tasks, ~2.5h)

---

#### P5.4: Create CSV stand importer (no admin client)

**Objective:** Import parsed CSV data into Supabase using the authenticated user's session. All writes go through RLS policies — no `createAdminClient`.

**Files:**
- Create: `src/lib/import/csv-importer.ts`

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPropertyBoundary } from "./mml-client";
import type { ParsedCsvData } from "./csv-parser";

export interface CsvImportResult {
  forestId: string;
  propertyId: string;
  name: string;
  standsImported: number;
  standsWithGeometry: number;
  speciesRowsImported: number;
  totalVolumeM3: number;
  warnings: string[];
}

/**
 * Import stands from parsed CSV data into Supabase.
 * Uses the authenticated user's Supabase client — all RLS enforced.
 * All-or-nothing: if any step fails, throws (caller cleans up forest).
 */
export async function importStandsFromCsv(
  csvData: ParsedCsvData,
  propertyId: string,
  forestName: string,
  userId: string,
  mmlApiKey: string,
  supabase: SupabaseClient  // authenticated user client (NOT admin)
): Promise<CsvImportResult>;
```

**Flow:**
1. Fetch MML boundary → `fetchPropertyBoundary(propertyId, mmlApiKey)`
2. Create forest record via `supabase.from("forests").insert({ owner_id: userId, name: forestName, property_id: propertyId, data_source: "csv" })` — RLS verifies `owner_id = auth.uid()`
3. Store property boundary via `supabase.from("property_boundaries").insert(...)` — RLS verifies via forest ownership
4. For each CSV stand row:
   a. Parse WKT → GeoJSON (see P5.5)
   b. Map stand fields to compartment columns:
      - `area_ha` → `area_ha`
      - `development_class` → `development_class`
      - `site_type` → `site_type`
      - `soil_type` → `soil_type`
      - `drainage_status` → `drainage_status`
      - `main_species` → `main_species` (already English from parser)
      - `total_ika` → `age_years`
      - `total_ppa` → `basal_area`
      - `total_klapimitta` → `avg_diameter`
      - `total_kpituus` → `avg_height`
      - `total_m3` → `volume_m3`
      - `polygon_wkt` → `geometry` (GeoJSON from WKT)
      - `land_class` → `attributes` JSONB
      - `total_m3_ha`, `total_runkoluku`, `total_tukki_pct`, `total_pct`, `center_lat`, `center_lon` → `attributes` JSONB
   c. Insert via `supabase.from("compartments").upsert()` with `onConflict: "forest_id, stand_id"`
5. For each CSV stand row:
   a. Extract species data from `CsvStandRow.species[]`
   b. Map to `compartment_species` rows — **all column names are English**:
      - `species` (English value: "Pine", "Spruce", etc.)
      - `volume_m3`
      - `log_pct` (English column, was `tukkiprosentti`)
      - `area_ha` (proportional to volume share)
   c. Insert via `supabase.from("compartment_species").insert()`
6. Update forest totals (`total_area_ha`, `updated_at`)

**⚠️ Column mapping detail — CSV total fields → compartments columns:**

| CsvStandRow field | compartments column |
|---|---|
| `area_ha` | `area_ha` |
| `development_class` | `development_class` |
| `site_type` | `site_type` |
| `soil_type` | `soil_type` |
| `drainage_status` | `drainage_status` |
| `main_species` | `main_species` |
| `total_ika` | `age_years` |
| `total_ppa` | `basal_area` |
| `total_klapimitta` | `avg_diameter` |
| `total_kpituus` | `avg_height` |
| `total_m3` | `volume_m3` |
| `total_m3_ha` | `attributes` JSONB (standing volume/ha — NOT growth; `growth_m3_per_ha` is annual growth from WFS) |
| `land_class`, `center_lat`, `center_lon`, `total_runkoluku`, `total_tukki_pct`, `total_pct` | `attributes` JSONB |

All other CSV fields go into the `attributes` JSONB column for future reference.

**⚠️ Species column mapping — CSV species → compartment_species columns:**

| CsvSpeciesRow field | compartment_species column |
|---|---|
| `species` | `species` (English name: "Pine", "Spruce", etc.) |
| `m3` | `volume_m3` |
| `log_pct` | `log_pct` |
| (computed) | `area_ha` (proportional: species.m3 / total_m3 × area_ha) |

---

#### P5.5: WKT → GeoJSON geometry conversion

**Objective:** Convert `MULTIPOLYGON(((lon lat,...)))` WKT to GeoJSON for Supabase/PostGIS storage.

**Approach: Parse WKT in TypeScript, convert to GeoJSON** — consistent with existing import pattern. The existing WFS import path passes GeoJSON objects directly to Supabase; PostGIS handles the SRID conversion via `ST_GeomFromGeoJSON`.

```typescript
/**
 * Parse MULTIPOLYGON WKT string to GeoJSON MultiPolygon.
 * WKT format: MULTIPOLYGON(((lon lat, lon lat,...)),((...)))
 * GeoJSON format: { type: "MultiPolygon", coordinates: [[[[lon, lat],...]],[[[...]]]] }
 *
 * WKT uses "lon lat" order. GeoJSON uses [lon, lat] order. They match — no swap needed.
 */
function wktToGeoJSON(wkt: string): GeoJSON.MultiPolygon | null {
  if (!wkt || !wkt.trim()) return null;

  try {
    // Extract coordinate groups from MULTIPOLYGON(((coords)),((coords)))
    const match = wkt.match(/^MULTIPOLYGON\s*\(\(\((.+)\)\)\)$/i);
    if (!match) return null;

    // Split into polygons: "coords1)),((coords2"
    const polygonStrings = match[1].split(/\s*\)\s*\)\s*,\s*\(\s*\(\s*/);

    const coordinates: GeoJSON.Position[][][] = polygonStrings.map(polyStr => {
      // Split into rings if needed (single ring per polygon in forest data)
      const ringStrs = polyStr.split(/\s*\)\s*,\s*\(\s*/);
      return ringStrs.map(ringStr => {
        return ringStr.trim().split(/\s*,\s*/).map(pair => {
          const [lon, lat] = pair.trim().split(/\s+/).map(Number);
          return [lon, lat] as GeoJSON.Position;
        });
      });
    });

    return {
      type: "MultiPolygon",
      coordinates,
    };
  } catch {
    return null;
  }
}
```

**⚠️ Pitfall:** WKT uses `lon lat` order. GeoJSON uses `[lon, lat]` order. They match — no coordinate swap needed.

**Verification:** The resulting GeoJSON object is passed directly in the Supabase insert's `geometry` field. Supabase/PostgREST calls `ST_GeomFromGeoJSON()` which handles SRID conversion to the column's declared SRID (3067). This is the same pattern used by the existing WFS import path.

---

#### P5.6: Species data storage

**Objective:** Store per-species breakdown from CSV columns into `compartment_species`. All column names and values are English. Migration 008 has already renamed `puulaji`→`species` and `tukkiprosentti`→`log_pct`.

**Column names used (post-migration 008):**
- `species` (English, was `puulaji`)
- `volume_m3`
- `log_pct` (English, was `tukkiprosentti`)
- `area_ha`

**Values are English:**
```
CSV column group: mänty_*  →  CsvSpeciesRow { species: "Pine", m3: value, log_pct: value, ... }
CSV column group: kuusi_*  →  CsvSpeciesRow { species: "Spruce", m3: value, log_pct: value, ... }
...etc for all 8 species
```

Only insert rows where the species has `m3 > 0` (or any non-null, non-zero value).

The importer iterates `CsvStandRow.species[]` directly — no DB re-query needed (unlike the old gridcell-based `populateCompartmentSpecies` which had to fetch compartments back from DB to get IDs). Since we just inserted the compartments, we have the stand IDs.

**Area calculation:** For each species in a compartment:
```
area_ha = (species.m3 / stand.total_m3) × stand.area_ha
```
(proportional to volume share, consistent with existing WFS pattern)

**Batch insert:** Use batches of 500 rows (matching existing pattern in spatial-service.ts).

---

#### P5.7: Create CSV upload API route (all-or-nothing)

**Files:**
- Create: `src/app/api/import/csv/route.ts`

```typescript
import { createServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { NextResponse, type NextRequest } from "next/server";
import { parseForestDataCsv } from "@/lib/import/csv-parser";
import { importStandsFromCsv } from "@/lib/import/csv-importer";

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse multipart form → extract CSV file + property_id + name
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const propertyId = formData.get("property_id") as string | null;
    const name = (formData.get("name") as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
    }
    if (!propertyId) {
      return NextResponse.json({ error: "property_id is required" }, { status: 400 });
    }

    // 3. Parse CSV
    const csvText = await file.text();
    let csvData;
    try {
      csvData = parseForestDataCsv(csvText);
    } catch (parseErr) {
      return NextResponse.json(
        { error: `CSV parse error: ${parseErr instanceof Error ? parseErr.message : "Invalid format"}` },
        { status: 400 }
      );
    }

    if (csvData.totalStands === 0) {
      return NextResponse.json({ error: "CSV contains no stand data" }, { status: 400 });
    }

    // 4. Import with all-or-nothing error handling
    //    Forest is created inside importStandsFromCsv. On failure, delete the forest.
    try {
      const result = await importStandsFromCsv(
        csvData,
        propertyId,
        name || `Forest ${propertyId}`,
        user.id,
        env.mmlApiKey,
        supabase  // authenticated user client, not admin
      );

      return NextResponse.json({
        forest_id: result.forestId,
        property_id: result.propertyId,
        stands_imported: result.standsImported,
        stands_with_geometry: result.standsWithGeometry,
        species_rows: result.speciesRowsImported,
        total_volume_m3: result.totalVolumeM3,
        warnings: result.warnings,
      });
    } catch (importErr) {
      // All-or-nothing: if the import failed after forest creation,
      // try to clean up the forest (cascade deletes compartments, species, boundary)
      if ((importErr as any).forestId) {
        await supabase.from("forests").delete().eq("id", (importErr as any).forestId);
      }
      throw importErr;
    }
  } catch (error) {
    console.error("CSV import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed unexpectedly" },
      { status: 500 }
    );
  }
}
```

**Request:** `multipart/form-data` with fields `file` (CSV), `property_id` (string), `name` (optional string)

**Response:** `{ forest_id, property_id, stands_imported, stands_with_geometry, species_rows, total_volume_m3, warnings }`

**Error handling strategy (all-or-nothing):**
- Forest creation happens inside `importStandsFromCsv`
- If any step fails after forest creation, the route catches the error and deletes the forest
- Cascade deletes (`ON DELETE CASCADE` in schema) remove compartments, species, and boundary
- User sees a clean error message; no orphan data

---

#### P5.8: Update frontend import page

**Files:**
- Modify: `src/app/(app)/forest/new/page.tsx`
- Modify: `src/components/import/ImportProgress.tsx`

**Changes to `page.tsx`:**
1. Add tab state: `'api' | 'csv'`
2. API tab: existing form (property ID + name)
3. CSV tab: property ID + file input + name
4. Both submit buttons say "Import Stand Data"
5. Tab descriptions explain the data source
6. CSV submit: use `FormData` with `multipart/form-data` POST to `/api/import/csv`

**Changes to `ImportProgress.tsx`:**
1. Add CSV stages: `'parsing_csv'`, `'fetching_boundary'`, `'storing_stands'`, `'storing_species'`
2. CSV path shows stand count and volume from client-side preview parse

**Client-side preview:** On file select, run Papa Parse in the browser to extract stand count and total volume. Show these in the UI as immediate feedback before submitting. (Papa Parse works in the browser natively — no extra dependency.)

---

### Track C: Code Cleanup (1 task, ~30 min)

---

#### P5.9: Remove all gridcell code

**Files:**
- `src/lib/import/wfs-client.ts` — Delete `WfsGridcell` interface, `fetchGridcellsByBbox()` function. Keep `WfsStand`, `fetchStandsByBbox()`, helpers.
- `src/lib/import/spatial-service.ts` — Delete `matchGridcellsToStands()` and `populateCompartmentSpecies()` functions. These were gridcell-only. The CSV import has its own self-contained species population.
- `src/app/api/import/property/route.ts` — Remove `fetchGridcellsByBbox` import and call. Remove `gridcells` parameter from `filterStandsWithinProperty()` call.
- `src/__tests__/unit/wfs-client.test.ts` — Remove gridcell tests.

**Verification:** `grep -ri "gridcell\|Gridcell" src/` → zero matches

---

### Track D: English Names + WFS Path Fix (3 tasks, ~1h)

---

#### P5.12: Migration 008 — Rename Finnish DB columns to English

**Objective:** Rename the two remaining Finnish column names in the database for full English consistency.

**Files:**
- Create: `supabase/migrations/008_english_column_names.sql`

```sql
-- 008_english_column_names.sql
-- Rename Finnish column names to English for consistency.
-- All other tables/compartments already use English column names.
-- No data migration needed (development phase, data will be reimported).

-- Rename columns
ALTER TABLE compartment_species RENAME COLUMN puulaji TO species;
ALTER TABLE compartment_species RENAME COLUMN tukkiprosentti TO log_pct;

-- Rename index to match new column name
ALTER INDEX IF EXISTS idx_comp_species_puulaji RENAME TO idx_comp_species_species;

-- Update comments
COMMENT ON COLUMN compartment_species.species IS 'Tree species name in English: Pine, Spruce, Aspen, Birch, etc.';
COMMENT ON COLUMN compartment_species.log_pct IS 'Sawlog percentage for this species (0-100)';
COMMENT ON TABLE compartment_species IS 'Per-species data from CSV import or WFS gridcell. English column names throughout.';
```

**⚠️ This migration must run BEFORE P5.13 (source file updates) and BEFORE the CSV importer is used.**

---

#### P5.13: Update all source file references to puulaji / tukkiprosentti

**Objective:** Update every TypeScript reference to the renamed columns. After migration 008, the columns are `species` and `log_pct` — all code must match.

**Files to update (10 files, ~30 references):**

| File | What changes |
|---|---|
| `src/types/database.ts` | `CompartmentSpecies.puulaji` → `species`, `tukkiprosentti` → `log_pct` |
| `src/lib/ai/chart-engine.ts:91-92` | `FIELD_ALIASES` entries: `species: "puulaji"` → `species: "species"` (no-op, can remove); `tree_species: "puulaji"` → `tree_species: "species"` |
| `src/lib/chat/system-prompt.ts:60,82` | `puulaji` → `species` in text descriptions and chart query templates |
| `src/lib/import/spatial-service.ts` | `RawSpecies` interface: `puulaji` → `species`, `tukkiprosentti` → `log_pct`. Update all usage in `matchGridcellsToStands()` and `populateCompartmentSpecies()` (note: these functions are deleted in P5.9, but update for correctness during the transition) |
| `src/lib/ai/income-calculator.ts:11,13,80,82` | `SpeciesPrice.puulaji` → `species`, `tukkiprosentti` → `log_pct`. Update `sp.puulaji` → `sp.species`, `sp.tukkiprosentti` → `sp.log_pct` |
| `src/lib/ai/classify.ts:53,56,58,73,90,92` | `RawSpecies` interface: `puulaji` → `species`, `tukkiprosentti` → `log_pct`. Line 90: `sp.puulaji === "Koivu"` → `sp.species === "Birch"` (English comparison) |
| `src/lib/ai/schedule.ts:67,370` | `k.paapuulaji` stays (part of `KuviotData` Finnish data model — see out of scope note) |
| `src/__tests__/unit/forestry-schedule.test.ts:13` | `paapuulaji` stays (match `KuviotData` interface) |

**classify.ts species comparison fix:**

Line 90 currently: `const spKey = sp.puulaji === "Koivu" ? "Rauduskoivu" : sp.puulaji;`

After rename, species values in `compartment_species` will be English:
```typescript
const spKey = sp.species === "Birch" ? "Silver birch" : sp.species;
```

**chart-engine.ts FIELD_ALIASES cleanup:**

The existing aliases exist because the DB column was Finnish. After migration 008:
```typescript
// Before (v4):
species: "puulaji",      // English alias → Finnish column
tree_species: "puulaji",  // English alias → Finnish column

// After (v5): aliases become no-ops — remove them
// (delete the species/tree_species entries; resolveFieldAlias returns field as-is)
```

If kept for backward compatibility, they become identity mappings:
```typescript
species: "species",
tree_species: "species",
```

**Verification:**
```bash
# After all updates, no Finnish DB column names remain in source
grep -rn "puulaji\|tukkiprosentti" src/ --include="*.ts" --include="*.tsx"
# Expected: zero matches (except possibly in comments explaining legacy)
```

---

#### P5.14: Add all-or-nothing error handling to WFS import path

**Objective:** Apply the same all-or-nothing pattern to the existing WFS import route.

**Files:**
- Modify: `src/app/api/import/property/route.ts`

**Change:** Wrap the compartment/species import in a try/catch. If `filterStandsWithinProperty` fails after forest creation, delete the forest.

```typescript
try {
  const filteredStands = await filterStandsWithinProperty(
    boundary.geometry, stands, forest.id, gridcells
  );
  // ... update forest totals, return response ...
} catch (err) {
  // Clean up forest on failure (cascade deletes compartments, species, boundary)
  await admin.from("forests").delete().eq("id", forest.id);
  throw err;
}
```

**Note:** The WFS path currently uses `createAdminClient()` for writes. A future refactor could switch it to `createServerSupabase()` like the CSV path, but that's out of scope for this plan.

---

## 4. Complete File Manifest

| File | Action | Purpose |
|---|---|---|
| `src/lib/import/csv-parser.ts` | **Create** | Parse CSV format, Finnish/English headers → English fields |
| `src/lib/import/csv-importer.ts` | **Create** | CSV → MML boundary → Supabase storage (user auth, no admin) |
| `src/app/api/import/csv/route.ts` | **Create** | POST multipart CSV upload endpoint with all-or-nothing cleanup |
| `src/__tests__/unit/csv-parser.test.ts` | **Create** | CSV parser tests (Finnish headers, English headers, species mapping, WKT) |
| `src/app/(app)/forest/new/page.tsx` | **Modify** | Two-tab UI: API + CSV import |
| `src/components/import/ImportProgress.tsx` | **Modify** | Add CSV progress stages |
| `supabase/migrations/008_english_column_names.sql` | **Create** | Rename `puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/types/database.ts` | **Modify** | `CompartmentSpecies`: `puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/lib/ai/chart-engine.ts` | **Modify** | FIELD_ALIASES: remove `puulaji` references (now `species`→`species` no-op) |
| `src/lib/chat/system-prompt.ts` | **Modify** | `puulaji` → `species` in chart templates |
| `src/lib/import/spatial-service.ts` | **Modify** | Remove gridcell functions; update `puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/lib/ai/income-calculator.ts` | **Modify** | `SpeciesPrice.puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/lib/ai/classify.ts` | **Modify** | `puulaji`→`species`, `tukkiprosentti`→`log_pct`; species comparison to English |
| `src/app/api/import/property/route.ts` | **Modify** | Remove gridcell fetch; add all-or-nothing cleanup |
| `src/lib/import/wfs-client.ts` | **Modify** | Remove gridcell code |
| `src/__tests__/unit/wfs-client.test.ts` | **Modify** | Remove gridcell tests |
| `package.json` | **Modify** | Add `papaparse`, `@types/papaparse`, `tsx` (devDep) |

## 5. Verification Checklist

- [ ] Migration 008 runs successfully (`puulaji`→`species`, `tukkiprosentti`→`log_pct`)
- [ ] `grep -rn "puulaji\|tukkiprosentti" src/` → zero matches (no Finnish column names in source)
- [ ] `parseForestDataCsv()` parses CSV with Finnish headers → English field names
- [ ] `parseForestDataCsv()` parses CSV with English headers → passes through unchanged
- [ ] Species names mapped correctly: `mänty → "Pine"`, `kuusi → "Spruce"`, etc.
- [ ] `CsvSpeciesRow.species` is English, `CsvSpeciesRow.log_pct` is English
- [ ] Client-side preview shows stand count and total volume on file select
- [ ] `POST /api/import/csv` imports stands with geometry (no admin client)
- [ ] Forest owner is correctly the authenticated user (verified via RLS)
- [ ] Stands appear on map with correct polygon boundaries
- [ ] Species data stored with English column names (`species`, `log_pct`) and English values
- [ ] Per-species charts work with English column names (chart-engine FIELD_ALIASES updated)
- [ ] Failed CSV import cleans up forest (no orphan data)
- [ ] API import path still works (property ID → WFS → stands on map)
- [ ] API import path has all-or-nothing cleanup on failure
- [ ] Both tabs clearly labeled as stand data import methods
- [ ] `grep -ri gridcell src/` → zero matches
- [ ] `npm run build` passes
- [ ] `npx vitest run` passes

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WKT parsing edge cases (malformed geometry) | Some stands lack geometry | `wktToGeoJSON()` returns `null` on parse failure; stand stored without geometry |
| PostGIS SRID mismatch (4326 WKT vs 3067 column) | Geometry insert fails | Use same GeoJSON pattern as existing WFS import — PostGIS handles via `ST_GeomFromGeoJSON` |
| Large CSV (200KB+) | Multipart upload size limits | Next.js default is fine for typical forest data (≪1 MB) |
| CSV has different property than MML ID | Property boundary mismatch | Validate center_lat/center_lon falls within MML boundary (future enhancement) |
| RLS policy rejects forest insert | Non-admin insert fails | Forest insert explicitly sets `owner_id = user.id`; RLS `USING (owner_id = auth.uid())` passes |
| Column rename breaks existing code before P5.13 updates | Build fails between migration and code update | Run migration + code updates atomically in one commit |
| classify.ts species comparison uses Finnish values | Species matching breaks after rename | Updated to English comparison (`"Birch"` not `"Koivu"`) |

## 7. Out of Scope

- Importing planned operations from CSV (not present in standard forest data CSV)
- Multi-property CSV support
- CSV export functionality
- Editing imported stands in bulk
- Switching WFS import path from `createAdminClient` to `createServerSupabase`
- P5.10 chart engine alias fix (committed separately)
- `KuviotData` interface Finnish→English rename (AI planning engine internal data model, separate concern)
- `paapuulaji` field in AI planning types (part of `KuviotData` — separate cleanup)

---

## 8. Task Ordering & Dependencies

```
P5.12 Migration 008 ─────────────────────────────────────────────────────┐
  (rename columns: MUST run first)                                        │
                                                                          │
P5.1 CSV Parser ──┬──► P5.2 Unit Tests ──► P5.3 Edge Cases               │
                  │                                                       │
                  └──► P5.4 CSV Importer ──► P5.5 WKT→GeoJSON ──► P5.6 Species Storage
                                                                          │
P5.13 Source Updates ◄── (after P5.12 — updates all code references)      │
                                                                          │
                  P5.9 Gridcell Removal ◄── P5.7 API Route ──► P5.8 Frontend UI
                                                                          │
                                                                          ▼
                                                                   P5.14 WFS Path Fix
```

**Critical path:** P5.12 (migration) → P5.13 (code updates) must complete before any other code that references `compartment_species` columns.

**Parallelizable:** Track A (P5.1→P5.2→P5.3) and Track B (P5.4→P5.5→P5.6) can run in parallel. P5.13 updates source files that P5.9 also touches (spatial-service.ts) — run P5.13 first, then P5.9.

**Commit strategy:** P5.12 + P5.13 should be one atomic commit (migration + code updates together) to avoid broken intermediate states.
