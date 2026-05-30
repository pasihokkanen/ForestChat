# Phase 5: CSV Stand Data Import

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> **P5.10 (chart engine alias fix) is committed separately — not part of this plan.**

**Version:** 8.0
**Date:** 2026-05-29

**Changelog v8.0 (from v7.0):**
- Added Finnish text value → English translation maps: `FI_DEVCLASS_TEXT_MAP`, `FI_SITETYPE_TEXT_MAP`, `FI_DRAINAGE_TEXT_MAP` — CSV data values are now English, matching WFS output
- Made CSV importer self-cleaning: deletes forest on internal failure (no `forestId` error attachment needed)
- Noted WFS species data loss after gridcell removal — fallback to `main_species` exists
- Aligned species detection algorithm description between §0 and P5.1
- Restored all "Same as v5.0" stubs — plan is fully self-contained (P5.5, P5.7, P5.8, P5.9, P5.14, §2)
- Fixed FI_TO_EN_COLUMN: removed dead bare-suffix entries; added separate SPECIES_FIELD_SUFFIX_MAP for species column detection
- Added proper species column detection logic: handles Finnish prefix, English prefix, and mixed Finnish-prefix+English-suffix combos
- P5.13 table cleaned up: removed gridcell-removal items (belong in P5.9); kept only English rename changes
- Deduplicated constants: §0 shows them once; P5.1 references them (no duplicate definitions)

**Changelog v6.0 (from v5.0):**
- Renamed all CsvSpeciesRow fields to English snake_case: `ika`→`age`, `ppa`→`basal_area`, `runkoluku`→`stem_count`, `kpituus`→`mean_height`, `klapimitta`→`mean_diameter`
- Renamed all CsvStandRow total_* fields to English snake_case: `total_ika`→`total_age`, etc.
- Added English CSV header equivalents; SPECIES_NAME_MAP values now snake_case; MAINGROUP_MAP updated

**Changelog v5.0 (from v4.0):**
- Renamed `compartment_species` columns: `puulaji`→`species`, `tukkiprosentti`→`log_pct`; P5.13 updates 10+ source files

**Changelog v4.0 (from v3.0):**
- Removed `createAdminClient`, English species names, bilingual CSV headers, all-or-nothing, upsert duplicates

**Goal:** Add CSV stand data import alongside the existing Metsäkeskus API import. All data names, field names, column names, and species values use English snake_case throughout — Finnish only appears at the CSV header layer and is translated on parse.

**Architecture:** Two import paths on the same page, sharing the MML boundary fetch. CSV path: parse flat CSV (Finnish or English headers) → typed stand rows with English field names → MML boundary → store compartments + species. API path: unchanged (remove gridcell code only). Both paths use `createServerSupabase()` — no admin client, all RLS-enforced.

**CSV Source:** Semicolon-delimited CSV with polygon WKT in EPSG:4326. Headers may be in Finnish or English.

**Tech Stack:** TypeScript, Next.js 16, Supabase + PostGIS (RLS-enforced), Papa Parse, Turf.js, proj4

---

## 0. CSV Format

CSV files may use **Finnish or English headers**. The parser auto-detects and maps both to internal English snake_case field names.

### Finnish header example

```
stand_id;pinta_ala_ha;maaluokka;kehitysluokka;kasvupaikka;maalaji;ojitustilanne;paapuulaji;center_lat;center_lon;polygon_wkt;total_ika;total_ppa;total_runkoluku;total_kpituus;total_klapimitta;total_tukki_pct;total_m3_ha;total_m3;total_pct;mänty_ika;mänty_ppa;...;rauduskoivu_pct
```

### English header example

```
stand_id;area_ha;land_class;development_class;site_type;soil_type;drainage_status;main_species;center_lat;center_lon;polygon_wkt;total_age;total_basal_area;total_stem_count;total_mean_height;total_mean_diameter;total_log_pct;total_m3_ha;total_m3;total_pct;pine_age;pine_basal_area;...;rowan_pct
```

### Column groups

| Group | Finnish headers | English headers | Count |
|---|---|---|---|
| Stand attributes | `pinta_ala_ha`, `maaluokka`, `kehitysluokka`, `kasvupaikka`, `maalaji`, `ojitustilanne`, `paapuulaji` | `area_ha`, `land_class`, `development_class`, `site_type`, `soil_type`, `drainage_status`, `main_species` | 8 |
| Geometry | `center_lat`, `center_lon`, `polygon_wkt` | same | 3 |
| Stand totals | `total_ika`, `total_ppa`, `total_runkoluku`, `total_kpituus`, `total_klapimitta`, `total_tukki_pct`, `total_m3_ha`, `total_m3`, `total_pct` | `total_age`, `total_basal_area`, `total_stem_count`, `total_mean_height`, `total_mean_diameter`, `total_log_pct`, `total_m3_ha`, `total_m3`, `total_pct` | 9 |
| 8 species × 9 fields | `{species}_ika`, `_ppa`, `_runkoluku`, `_kpituus`, `_klapimitta`, `_tukki_pct`, `_m3_ha`, `_m3`, `_pct` | `{species}_age`, `_basal_area`, `_stem_count`, `_mean_height`, `_mean_diameter`, `_log_pct`, `_m3_ha`, `_m3`, `_pct` | 72 |
| **Total** | | | **92** |

Finnish species prefixes: `mänty`, `kuusi`, `haapa`, `harmaaleppä`, `hieskoivu`, `lehtikuusi`, `rauduskoivu`, `pihlaja`
English species prefixes: `pine`, `spruce`, `aspen`, `grey_alder`, `downy_birch`, `larch`, `silver_birch`, `rowan`

Empty species cells = stand doesn't have that species. Polygon WKT is in EPSG:4326 (`lon lat` order).

### Mapping Tables

These constants are defined once in `src/lib/import/csv-parser.ts` (see P5.1). Documented here for reference:

**FI_TO_EN_COLUMN** — maps full Finnish CSV headers to internal English field names:

```typescript
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
```
Note: Only **full-header matches** go here. Species field suffixes (`ika`, `ppa`, etc.) are handled separately by `SPECIES_FIELD_SUFFIX_MAP` — see P5.1.

**SPECIES_FIELD_SUFFIX_MAP** — maps Finnish species field suffixes to English suffixes (used during species column detection):

```typescript
const SPECIES_FIELD_SUFFIX_MAP: Record<string, string> = {
  ika: "age",
  ppa: "basal_area",
  runkoluku: "stem_count",
  kpituus: "mean_height",
  klapimitta: "mean_diameter",
  tukki_pct: "log_pct",
  m3_ha: "m3_ha",   // already English
  m3: "m3",          // already English
  pct: "pct",        // already English
};
```

**SPECIES_NAME_MAP** — Finnish species prefix → English snake_case species name:

```typescript
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
```

**ENGLISH_SPECIES_SET** — English species names (for detecting English-header CSVs):

```typescript
const ENGLISH_SPECIES_SET = new Set([
  "pine", "spruce", "aspen", "grey_alder", "downy_birch",
  "larch", "silver_birch", "rowan",
]);
```

### Value Translation Maps

CSV data values are in Finnish text. These maps translate Finnish text values to English (matching the English values produced by the WFS import path via `code-tables.ts`). Unknown values pass through unchanged (stored in Finnish — acceptable for rare/edge-case terms).

**FI_DEVCLASS_TEXT_MAP** — Finnish development class text → English:

```typescript
const FI_DEVCLASS_TEXT_MAP: Record<string, string> = {
  "Aukea": "open_area",
  "Taimikko": "seedling",
  "Nuori kasvatusmetsikkö": "young_thinning",
  "Varttunut kasvatusmetsikkö": "mature_thinning",
  "Uudistuskypsä metsikkö": "regeneration_ready",
  "Eri-ikäisrakenteinen": "uneven_aged",
  "Suojuspuusto": "shelterwood",
};
```

**FI_SITETYPE_TEXT_MAP** — Finnish site type text → English:

```typescript
const FI_SITETYPE_TEXT_MAP: Record<string, string> = {
  "lehto": "herb-rich",
  "lehtomainen kangas": "herb-rich heath",
  "tuore kangas": "mesic",
  "kuivahko kangas": "sub-xeric",
  "kuiva kangas": "xeric",
  "karukkokangas": "barren",
};
```

**FI_DRAINAGE_TEXT_MAP** — Finnish drainage status text → English:

```typescript
const FI_DRAINAGE_TEXT_MAP: Record<string, string> = {
  "Ojitettu": "drained",
  "Ojittamaton": "undrained",
  "Turvekangas": "peatland_forest",
  "Luonnontilainen": "natural_state",
};
```

**Soil type** (`maalaji`) values are descriptive Finnish terms with no standardized English equivalents (e.g., "Hieno hieta", "Karkea moreeni"). These are stored as-is in the `soil_type` column. This is consistent with the WFS path which also stores raw `SOILTYPE` values.

The parser applies these maps when building `CsvStandRow`:
- `FI_DEVCLASS_TEXT_MAP[value] ?? value` → `development_class`
- `FI_SITETYPE_TEXT_MAP[value] ?? value` → `site_type`
- `FI_DRAINAGE_TEXT_MAP[value] ?? value` → `drainage_status`

### Species Column Detection Logic

The parser detects species columns by scanning headers for `{prefix}_{suffix}` patterns:

1. Split each header on the **last** underscore: `mänty_basal_area` → prefix=`mänty`, suffix=`basal_area`
2. Check if suffix is a known species field: in `SPECIES_FIELD_SUFFIX_MAP` (Finnish) or already an English field name (check values of `SPECIES_FIELD_SUFFIX_MAP`)
3. If yes, check if prefix is a known species:
   - Finnish: `mänty` is in `SPECIES_NAME_MAP` → species is `"pine"`
   - English: `pine` is in `ENGLISH_SPECIES_SET` → species is `"pine"`
   - Mixed: `mänty` prefix + `basal_area` suffix → species is `"pine"`, field is `"basal_area"` (the suffix map handles the Finnish→English suffix translation)
4. If recognized: map the suffix to English (via `SPECIES_FIELD_SUFFIX_MAP`), collect all 9 fields for this species

This handles all combinations:
- `mänty_ika` → species=`pine`, field=`age` (Finnish+Finnish)
- `pine_age` → species=`pine`, field=`age` (English+English)
- `mänty_age` → species=`pine`, field=`age` (Finnish+English)

### Key design decisions

- **Property ID is NOT in the CSV** — the MML fetch needs a separate property ID input from the user.
- **Polygon geometry is already in the CSV** as WKT — no WFS stand fetch needed for CSV import.
- **Species data is already in the CSV** as columns — no gridcell population needed.
- **No admin client** — all writes go through the authenticated user's `createServerSupabase()` client, enforced by RLS policies.
- **English snake_case everywhere** — all DB column names, TypeScript field names, data values, and species names use English snake_case.
- **CSV headers bilingual** — parser accepts Finnish, English, or mixed headers.

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
  → Store species breakdown (CSV columns → English species names → compartment_species)
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

**Objective:** Parse the semicolon-delimited CSV format into typed TypeScript structures. Accepts Finnish, English, or mixed column headers, outputs English snake_case field names.

**Files:**
- `package.json` — add `papaparse`, `@types/papaparse`, `tsx` (devDep)
- Create: `src/lib/import/csv-parser.ts`

```typescript
// src/lib/import/csv-parser.ts

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

// ─── Parser ─────────────────────────────────────────────────────────

/**
 * Resolve a full CSV header to its internal English field name.
 * Only matches full-header entries in FI_TO_EN_COLUMN.
 * English headers pass through unchanged.
 */
function resolveField(csvHeader: string): string {
  return FI_TO_EN_COLUMN[csvHeader] ?? csvHeader;
}

/**
 * Parse forest compartment CSV format.
 * Handles Finnish, English, or mixed headers.
 * Outputs English snake_case field names and species names.
 */
export function parseForestDataCsv(csvContent: string): ParsedCsvData {
  // 1. Parse with Papa Parse
  // 2. Scan headers: detect species columns via {prefix}_{suffix} pattern
  // 3. For each data row: map stand fields, collect species rows
  // 4. Aggregate totals
}
```

**Species column detection algorithm:**

```
For each CSV header:
  1. Try FI_TO_EN_COLUMN lookup → stand attribute or total field, done.
  2. Split on last underscore: "mänty_basal_area" → prefix="mänty", suffix="basal_area"
  3. Check if suffix is in SPECIES_FIELD_SUFFIX_MAP (Finnish) or is already an English field name
  4. If suffix is recognized:
     a. Resolve species prefix: SPECIES_NAME_MAP[prefix] OR prefix if in ENGLISH_SPECIES_SET
     b. Resolve field suffix: SPECIES_FIELD_SUFFIX_MAP[suffix] ?? suffix
     c. Register {species, field} pair for this column
  5. Unknown headers are ignored
```

This handles all combinations:
- `mänty_ika` → species=`pine`, field=`age` (Finnish+Finnish)
- `pine_age` → species=`pine`, field=`age` (English+English)
- `mänty_age` → species=`pine`, field=`age` (Finnish+English mixed)
- `pine_ika` → species=`pine`, field=`age` (English+Finnish mixed)

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
const s = result.stands[0];
console.log('First stand:', s.stand_id, s.area_ha, 'ha');
console.log('  total_age:', s.total_age, 'total_basal_area:', s.total_basal_area);
console.log('  species[0].species:', s.species[0]?.species);
console.log('  species[0].age:', s.species[0]?.age, 'log_pct:', s.species[0]?.log_pct);
" ~/Metsa/upm_forest_data.csv
# Expected: species[0].species = "pine", total_age = number, all field names English
```

---

#### P5.2: Write unit tests

**Files:**
- Create: `src/__tests__/unit/csv-parser.test.ts`

**Test cases:**
1. Parse CSV with Finnish headers → all fields mapped to English snake_case names
2. Parse CSV with English headers → passes through unchanged
3. Species name mapping: `mänty_m3` → `CsvSpeciesRow.species = "pine"`
4. Finnish total fields: `total_ika` → `total_age`, `total_ppa` → `total_basal_area`, etc.
5. English total fields: `total_age`, `total_basal_area` pass through
6. Finnish species fields: `mänty_ika` → `age`, `mänty_ppa` → `basal_area`, `mänty_tukki_pct` → `log_pct`
7. English species fields: `pine_age`, `pine_basal_area` pass through
8. **Mixed headers**: `mänty_age` (Finnish prefix + English suffix) → species=`pine`, field=`age`
9. **Mixed headers**: `pine_ika` (English prefix + Finnish suffix) → species=`pine`, field=`age`
10. Empty species columns → `null` values, not zero
11. Stand with missing `polygon_wkt` → `polygon_wkt = ""` (handled gracefully)
12. Stand with `total_m3 = 0` → still imported
13. Valid WKT string → contains `MULTIPOLYGON(((...)))`
14. Malformed WKT → string still stored (PostGIS will reject on insert)
15. CSV with different species columns → auto-detected from header
16. Total volume aggregation matches sum of `total_m3`
17. Both Finnish (`mänty`) and English (`pine`) species prefixes detected
18. Unknown headers silently ignored

---

#### P5.3: Handle edge cases

- Empty/blank cells → `null` (not 0)
- Missing `polygon_wkt` → stand stored without geometry (`geometry: null`)
- Stands with `total_m3 = 0` → still imported
- Duplicate `stand_id` → handled by UPSERT
- CSV with Finnish headers → all fields mapped to English via `FI_TO_EN_COLUMN`
- CSV with English headers → pass through unchanged
- CSV with mixed Finnish/English headers → handled per-column (species detection logic)
- Species with volume 0 → not inserted into `compartment_species`
- Main species values → mapped through `SPECIES_NAME_MAP` (snake_case English)
- `total_m3_ha` (standing volume/ha) → stored in `attributes` JSONB, NOT in `growth_m3_per_ha`
- Unrecognized headers → silently ignored (allows CSVs with extra metadata columns)

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

export async function importStandsFromCsv(
  csvData: ParsedCsvData,
  propertyId: string,
  forestName: string,
  userId: string,
  mmlApiKey: string,
  supabase: SupabaseClient
): Promise<CsvImportResult>;
```

**Flow:**
1. Fetch MML boundary → `fetchPropertyBoundary(propertyId, mmlApiKey)`
2. Create forest via `supabase.from("forests").insert(...)` → get `forest.id`
3. **If any subsequent step fails, delete the forest (cascade removes all dependent rows) and re-throw.** This makes the importer self-cleaning — the caller doesn't need to track `forestId`.
4. Store boundary via `supabase.from("property_boundaries").insert(...)`
5. Map each `CsvStandRow` to compartment columns (see table below), insert via `upsert({ onConflict: "forest_id, stand_id" })`
6. Map each `CsvSpeciesRow` to `compartment_species` columns (see table below), batch insert
7. Update forest totals

**Column mapping — CsvStandRow → compartments columns:**

| CsvStandRow field | compartments column | Notes |
|---|---|---|
| `area_ha` | `area_ha` | |
| `development_class` | `development_class` | |
| `site_type` | `site_type` | |
| `soil_type` | `soil_type` | |
| `drainage_status` | `drainage_status` | |
| `main_species` | `main_species` | snake_case English: "pine", "spruce", etc. |
| `total_age` | `age_years` | |
| `total_basal_area` | `basal_area` | |
| `total_mean_diameter` | `avg_diameter` | |
| `total_mean_height` | `avg_height` | |
| `total_m3` | `volume_m3` | |
| `polygon_wkt` | `geometry` | WKT→GeoJSON via wktToGeoJSON() |
| `land_class`, `total_m3_ha`, `total_stem_count`, `total_log_pct`, `total_pct`, `center_lat`, `center_lon` | `attributes` JSONB | |

**Column mapping — CsvSpeciesRow → compartment_species columns:**

| CsvSpeciesRow field | compartment_species column | Notes |
|---|---|---|
| `species` | `species` | snake_case English: "pine", "spruce", etc. |
| `m3` | `volume_m3` | |
| `log_pct` | `log_pct` | |
| (computed) | `area_ha` | proportional: species.m3 / total_m3 × area_ha |
| `age`, `basal_area`, `stem_count`, `mean_height`, `mean_diameter`, `m3_ha`, `pct` | stored in compartment `attributes` JSONB | for reference |

---

#### P5.5: WKT → GeoJSON geometry conversion

**Objective:** Convert `MULTIPOLYGON(((lon lat,...)))` WKT from the CSV to GeoJSON for Supabase/PostGIS storage.

**Approach:** Parse WKT in TypeScript, convert to GeoJSON. This matches the existing WFS import pattern where GeoJSON objects are passed directly to Supabase — PostGIS handles SRID conversion via `ST_GeomFromGeoJSON`.

```typescript
/**
 * Parse MULTIPOLYGON WKT string to GeoJSON MultiPolygon.
 * WKT format: MULTIPOLYGON(((lon lat, lon lat,...)),((...)))
 * GeoJSON:    { type: "MultiPolygon", coordinates: [[[[lon, lat],...]]] }
 *
 * WKT uses "lon lat" order. GeoJSON uses [lon, lat] order. They match — no swap needed.
 * Returns null if the WKT is empty or unparseable.
 */
function wktToGeoJSON(wkt: string): GeoJSON.MultiPolygon | null {
  if (!wkt || !wkt.trim()) return null;

  try {
    const match = wkt.match(/^MULTIPOLYGON\s*\(\(\((.+)\)\)\)$/i);
    if (!match) return null;

    const polygonStrings = match[1].split(/\s*\)\s*\)\s*,\s*\(\s*\(\s*/);
    const coordinates: GeoJSON.Position[][][] = polygonStrings.map(polyStr => {
      const ringStrs = polyStr.split(/\s*\)\s*,\s*\(\s*/);
      return ringStrs.map(ringStr =>
        ringStr.trim().split(/\s*,\s*/).map(pair => {
          const [lon, lat] = pair.trim().split(/\s+/).map(Number);
          return [lon, lat] as GeoJSON.Position;
        })
      );
    });

    return { type: "MultiPolygon", coordinates };
  } catch {
    return null; // malformed WKT → stand stored without geometry
  }
}
```

**⚠️ Pitfalls:**
- WKT uses `lon lat` order, GeoJSON uses `[lon, lat]` — they match, no coordinate swap needed.
- Malformed WKT returns `null` — the stand is stored without geometry (graceful degradation).
- Empty `polygon_wkt` → `null` → geometry column set to `null` in DB.

**In the importer (P5.4):**
```typescript
const geom = wktToGeoJSON(stand.polygon_wkt);
if (!geom) warnings.push(`Stand ${stand.stand_id}: no valid geometry`);
// Insert with geometry: geom (may be null)
```

---

#### P5.6: Species data storage

**Objective:** Store per-species breakdown from CSV columns into `compartment_species`. All column names, field names, and values use English snake_case.

Species values (already English from parser):
```
CSV mänty_*  →  CsvSpeciesRow { species: "pine", ... }
CSV pine_*   →  CsvSpeciesRow { species: "pine", ... }
CSV kuusi_*  →  CsvSpeciesRow { species: "spruce", ... }
...etc for all 8 species
```

Only insert rows where `m3 > 0`. Iterate `CsvStandRow.species[]` directly — no DB re-query needed.

**Area calculation:** `area_ha = (species.m3 / stand.total_m3) × stand.area_ha` (proportional to volume share).

**Batch insert:** 500 rows per batch (matching existing pattern).

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

    // 2. Parse multipart form
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const propertyId = formData.get("property_id") as string | null;
    const name = (formData.get("name") as string) || undefined;

    if (!file) return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
    if (!propertyId) return NextResponse.json({ error: "property_id is required" }, { status: 400 });

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

    // 4. Import (importer is self-cleaning: deletes forest on failure)
    const result = await importStandsFromCsv(
      csvData, propertyId,
      name || `Forest ${propertyId}`,
      user.id, env.mmlApiKey, supabase
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

---

#### P5.8: Update frontend import page

**Files:**
- Modify: `src/app/(app)/forest/new/page.tsx`
- Modify: `src/components/import/ImportProgress.tsx`

**Changes to `page.tsx`:**
1. Add tab state: `"api" | "csv"` with two `<button>` tab toggles
2. **API tab**: existing form (property ID + name, POST to `/api/import/property`)
3. **CSV tab**: property ID + `<input type="file" accept=".csv">` + name
4. Both tabs share the "Import Stand Data" submit button
5. CSV submit: builds `FormData`, POSTs to `/api/import/csv`
6. Tab descriptions explain each data source

**Changes to `ImportProgress.tsx`:**
1. Add CSV stage strings to the `stage` union: `"parsing_csv"`, `"fetching_boundary"`, `"storing_stands"`, `"storing_species"`
2. Add CSV stage labels to the `stages` array:
   - `"parsing_csv"` → "Parsing CSV file..."
   - `"fetching_boundary"` → "Fetching property boundary from National Land Survey…"
   - `"storing_stands"` → "Storing stand data…"
   - `"storing_species"` → "Importing species breakdown…"
3. Route starts at `"parsing_csv"` → `"fetching_boundary"` → `"storing_stands"` → `"storing_species"` → `"done"`

**Client-side preview:** On file select, run Papa Parse in the browser to extract stand count and total volume. Show these below the file input as immediate feedback before the user clicks Import.

---

### Track C: Code Cleanup (1 task, ~30 min)

---

#### P5.9: Remove all gridcell code

**Objective:** Delete all gridcell-related code. Gridcells were a WFS-specific hack for species data; the CSV path provides species data directly from columns. After this removal, WFS-imported forests will have no `compartment_species` rows — the income calculator and species charts fall back to `main_species` (existing fallback behavior).

**Files:**
- `src/lib/import/wfs-client.ts` — Delete: `WfsGridcell` interface, `fetchGridcellsByBbox()` function. Keep: `WfsStand`, `fetchStandsByBbox()`, helpers (`bboxFromGeometry`, `toMultiPolygon`, `bbox4326to3067`).
- `src/lib/import/spatial-service.ts` — Delete: `matchGridcellsToStands()`, `populateCompartmentSpecies()`. Keep: `filterStandsWithinProperty()`. Remove `gridcells` parameter from `filterStandsWithinProperty` signature.
- `src/app/api/import/property/route.ts` — Remove: `fetchGridcellsByBbox` import and `Promise.all` call; remove `gridcells` argument from `filterStandsWithinProperty()` call.
- `src/__tests__/unit/wfs-client.test.ts` — Remove gridcell-related tests.

**Verification:**
```bash
grep -ri "gridcell\|Gridcell" src/
# Expected: zero matches
```

---

### Track D: English Names + WFS Path Fix (3 tasks, ~1h)

---

#### P5.12: Migration 008 — Rename Finnish DB columns to English

**Files:**
- Create: `supabase/migrations/008_english_column_names.sql`

```sql
-- 008_english_column_names.sql
-- Rename Finnish column names to English for consistency.
-- No data migration needed (development phase).

ALTER TABLE compartment_species RENAME COLUMN puulaji TO species;
ALTER TABLE compartment_species RENAME COLUMN tukkiprosentti TO log_pct;
ALTER INDEX IF EXISTS idx_comp_species_puulaji RENAME TO idx_comp_species_species;

COMMENT ON COLUMN compartment_species.species IS 'Tree species name in English snake_case: pine, spruce, aspen, birch, etc.';
COMMENT ON COLUMN compartment_species.log_pct IS 'Sawlog percentage for this species (0-100)';
COMMENT ON TABLE compartment_species IS 'Per-species data. English column names throughout.';
```

---

#### P5.13: Update source file references (English rename only)

**Objective:** Update every reference to renamed DB columns. Also switch MAINGROUP_MAP values and classify.ts species comparisons to English snake_case for consistency.

**⚠️ Scope:** This task ONLY handles the English rename. Gridcell removal is P5.9. WFS all-or-nothing is P5.14.

**Files to update:**

| File | Changes |
|---|---|
| `src/types/database.ts` | `CompartmentSpecies.puulaji` → `species`, `tukkiprosentti` → `log_pct` |
| `src/lib/import/code-tables.ts` | `MAINGROUP_MAP`: `"Pine"`→`"pine"`, `"Spruce"`→`"spruce"`, `"Broadleaf"`→`"broadleaf"` |
| `src/lib/ai/chart-engine.ts` | FIELD_ALIASES: remove `puulaji` entries (now identity: `species`→`"species"`) |
| `src/lib/chat/system-prompt.ts` | `puulaji` → `species` in chart templates (lines 60, 82) |
| `src/lib/ai/income-calculator.ts` | `puulaji`→`species`, `tukkiprosentti`→`log_pct` in SpeciesPrice interface + all usage |
| `src/lib/ai/classify.ts` | `puulaji`→`species`, `tukkiprosentti`→`log_pct`; `"Koivu"`→`"birch"`, `"Rauduskoivu"`→`"silver_birch"` |

**Not updated (out of scope or handled by other tasks):**
- `spatial-service.ts` — P5.9 deletes gridcell functions entirely; no rename needed
- `schedule.ts` / `forestry-schedule.test.ts` — `paapuulaji` is part of KuviotData (separate cleanup)
- `wfs-client.ts`, `property/route.ts` — gridcell removal is P5.9

**code-tables.ts MAINGROUP_MAP update:**

```typescript
// Before:
export const MAINGROUP_MAP: Record<number, string> = {
  1: "Pine", 2: "Spruce", 3: "Broadleaf",
};

// After:
export const MAINGROUP_MAP: Record<number, string> = {
  1: "pine", 2: "spruce", 3: "broadleaf",
};
```

**classify.ts species comparison update:**

```typescript
// Before:
const spKey = sp.puulaji === "Koivu" ? "Rauduskoivu" : sp.puulaji;

// After:
const spKey = sp.species === "birch" ? "silver_birch" : sp.species;
```

**Verification:**
```bash
# No Finnish DB column names
grep -rn "puulaji\|tukkiprosentti" src/ --include="*.ts" --include="*.tsx"
# Expected: zero matches

# No Title Case species values
grep -rn '"Pine"\|"Spruce"\|"Broadleaf"' src/ --include="*.ts" --include="*.tsx"
# Expected: zero matches
```

---

#### P5.14: Add all-or-nothing error handling to WFS import path

**Objective:** Apply the same all-or-nothing pattern to the existing WFS import route.

**Files:**
- Modify: `src/app/api/import/property/route.ts`

**Change:** Wrap the `filterStandsWithinProperty` call in a try/catch. If it fails after forest creation, delete the forest (cascade handles compartments, species, boundary):

```typescript
// After forest creation and boundary storage:
let forestId = forest.id;

try {
  const filteredStands = await filterStandsWithinProperty(
    boundary.geometry, stands, forestId
  );
  // ... update forest totals, return success response ...
} catch (err) {
  // Clean up on failure
  await admin.from("forests").delete().eq("id", forestId);
  throw err;
}
```

**Note:** The WFS path uses `createAdminClient()` for writes (existing pattern). Switching to `createServerSupabase()` is out of scope.

---

## 4. Complete File Manifest

| File | Action | Purpose |
|---|---|---|
| `src/lib/import/csv-parser.ts` | **Create** | Parse CSV (Finnish/English/mixed headers → English snake_case) |
| `src/lib/import/csv-importer.ts` | **Create** | CSV → MML → Supabase storage (user auth, no admin) |
| `src/app/api/import/csv/route.ts` | **Create** | POST multipart CSV upload, all-or-nothing |
| `src/__tests__/unit/csv-parser.test.ts` | **Create** | CSV parser tests (all header combos, species mapping, WKT) |
| `src/app/(app)/forest/new/page.tsx` | **Modify** | Two-tab UI: API + CSV import |
| `src/components/import/ImportProgress.tsx` | **Modify** | Add CSV progress stages |
| `supabase/migrations/008_english_column_names.sql` | **Create** | Rename `puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/types/database.ts` | **Modify** | `CompartmentSpecies`: English column names |
| `src/lib/import/code-tables.ts` | **Modify** | MAINGROUP_MAP: Title Case → snake_case |
| `src/lib/ai/chart-engine.ts` | **Modify** | FIELD_ALIASES: remove `puulaji` references |
| `src/lib/chat/system-prompt.ts` | **Modify** | `puulaji` → `species` in chart templates |
| `src/lib/ai/income-calculator.ts` | **Modify** | `puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/lib/ai/classify.ts` | **Modify** | English field names + species comparisons |
| `src/lib/import/spatial-service.ts` | **Modify** | Remove gridcell functions (P5.9) |
| `src/app/api/import/property/route.ts` | **Modify** | Remove gridcell fetch (P5.9); all-or-nothing (P5.14) |
| `src/lib/import/wfs-client.ts` | **Modify** | Remove gridcell code (P5.9) |
| `src/__tests__/unit/wfs-client.test.ts` | **Modify** | Remove gridcell tests (P5.9) |
| `package.json` | **Modify** | Add `papaparse`, `@types/papaparse`, `tsx` (devDep) |

## 5. Verification Checklist

- [ ] Migration 008 runs: `puulaji`→`species`, `tukkiprosentti`→`log_pct`
- [ ] `grep -rn "puulaji\|tukkiprosentti" src/` → zero matches
- [ ] `grep -rn '"Pine"\|"Spruce"\|"Broadleaf"' src/` → zero matches
- [ ] `parseForestDataCsv()` Finnish headers → all fields English snake_case
- [ ] `parseForestDataCsv()` English headers → passes through
- [ ] `parseForestDataCsv()` mixed headers (e.g. `mänty_age`) → correct
- [ ] Species: `mänty_m3` → `species = "pine"`; `mänty_tukki_pct` → `log_pct`
- [ ] Totals: `total_ika` → `total_age`; `total_ppa` → `total_basal_area`
- [ ] `CsvSpeciesRow` fields: all English snake_case
- [ ] `CsvStandRow` fields: all English snake_case
- [ ] `development_class` translated: "Nuori kasvatusmetsikkö" → "young_thinning"
- [ ] `site_type` translated: "tuore kangas" → "mesic"
- [ ] `drainage_status` translated: "Ojitettu" → "drained"
- [ ] `MAINGROUP_MAP`: snake_case values
- [ ] `POST /api/import/csv` imports with geometry (no admin client)
- [ ] Forest owner = authenticated user (RLS verified)
- [ ] Species stored with English column names + English snake_case values
- [ ] Failed CSV import cleans up forest (no orphans)
- [ ] API import path still works (WFS stands on map)
- [ ] API import path all-or-nothing on failure (P5.14)
- [ ] `grep -ri gridcell src/` → zero matches
- [ ] `npm run build` passes
- [ ] `npx vitest run` passes

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WKT parsing edge cases | Some stands lack geometry | `wktToGeoJSON()` returns `null`; stand stored without geometry |
| PostGIS SRID mismatch | Geometry insert fails | Use existing GeoJSON pattern — PostGIS handles conversion |
| Column rename breaks existing code | Build fails | P5.12 + P5.13 committed atomically |
| classify.ts species comparison uses old values | Species matching breaks | Updated to snake_case English comparisons |
| MAINGROUP_MAP consumers expect Title Case | WFS import species names change | Updated in P5.13; data reimported after migration |
| Mixed-language CSV headers (Finnish+English) | Parser misses some columns | Species detection logic handles all combos; P5.2 tests mixed headers |
| WFS forests lose per-species data after gridcell removal | Species charts show only main_species for WFS forests | Income calculator + charts fall back to `main_species`; CSV becomes primary import path |

## 7. Out of Scope

- Planned operations from CSV
- Multi-property CSV support
- CSV export
- Bulk stand editing
- WFS path `createAdminClient` → `createServerSupabase`
- P5.10 chart engine alias fix (separate commit)
- `KuviotData` interface rename (AI planning engine — separate cleanup)

---

## 8. Task Ordering

```
P5.12 Migration 008 ────────────────────────────────────────┐
  (rename columns: MUST run first)                           │
                                                             │
P5.1 CSV Parser ──┬──► P5.2 Tests ──► P5.3 Edge Cases       │
                  │                                          │
                  └──► P5.4 Importer ──► P5.5 WKT ──► P5.6 Species
                                                             │
P5.13 Source Updates ◄── (after P5.12)                       │
                                                             │
                  P5.9 Gridcell ◄── P5.7 Route ──► P5.8 UI   │
                                                             │
                                                             ▼
                                                      P5.14 WFS Fix
```

**Critical:** P5.12 + P5.13 = one atomic commit. P5.9 must NOT touch files that P5.13 updates for English rename — scopes are separate.
