# Phase 5: CSV Stand Data Import

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> **P5.10 (chart engine alias fix) is committed separately — not part of this plan.**

**Version:** 6.0
**Date:** 2026-05-29

**Changelog v6.0 (from v5.0):**
- Renamed all CsvSpeciesRow fields to English snake_case: `ika`→`age`, `ppa`→`basal_area`, `runkoluku`→`stem_count`, `kpituus`→`mean_height`, `klapimitta`→`mean_diameter`
- Renamed all CsvStandRow total_* fields to English snake_case: `total_ika`→`total_age`, `total_ppa`→`total_basal_area`, `total_runkoluku`→`total_stem_count`, `total_kpituus`→`total_mean_height`, `total_klapimitta`→`total_mean_diameter`, `total_tukki_pct`→`total_log_pct`
- Added English CSV header equivalents for all total_* and species_* fields
- `SPECIES_NAME_MAP` values now use snake_case: `"pine"`, `"spruce"`, `"aspen"`, etc.
- `MAINGROUP_MAP` in code-tables.ts updated to snake_case for consistency (in P5.13 task)
- `classify.ts` species comparisons updated to snake_case values

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
- Species names use English internally with a Finnish→English mapping table
- CSV parser accepts both Finnish and English column headers
- Resolved P5.4/P5.9 contradiction
- Added all-or-nothing error handling; WFS path fix as P5.14
- Removed P5.10, P5.11; added WKT tests; upsert for duplicates; generic stand counts

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

### English↔Finnish Column Mapping

The parser auto-detects header language. Finnish headers are mapped to internal English field names:

```typescript
const FI_TO_EN_COLUMN: Record<string, string> = {
  // Stand attributes
  pinta_ala_ha: "area_ha",
  maaluokka: "land_class",
  kehitysluokka: "development_class",
  kasvupaikka: "site_type",
  maalaji: "soil_type",
  ojitustilanne: "drainage_status",
  paapuulaji: "main_species",
  // Stand totals
  total_ika: "total_age",
  total_ppa: "total_basal_area",
  total_runkoluku: "total_stem_count",
  total_kpituus: "total_mean_height",
  total_klapimitta: "total_mean_diameter",
  total_tukki_pct: "total_log_pct",
  // Species field suffixes (used when detecting species columns)
  ika: "age",
  ppa: "basal_area",
  runkoluku: "stem_count",
  kpituus: "mean_height",
  klapimitta: "mean_diameter",
  tukki_pct: "log_pct",
};
```

### Species Name Mapping

Species column prefixes are detected from the CSV header. Finnish prefixes are mapped to English snake_case species names:

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

Species names are stored as snake_case in `compartment_species.species` and `compartments.main_species`. The existing `MAINGROUP_MAP` in `code-tables.ts` is updated to use snake_case for consistency (see P5.13).

### Key design decisions

- **Property ID is NOT in the CSV** — the MML fetch needs a separate property ID input from the user.
- **Polygon geometry is already in the CSV** as WKT — no WFS stand fetch needed for CSV import.
- **Species data is already in the CSV** as columns — no gridcell population needed.
- **No admin client** — all writes go through the authenticated user's `createServerSupabase()` client, enforced by RLS policies.
- **English snake_case everywhere** — all DB column names, TypeScript field names, data values, and species names use English snake_case. Finnish only exists at the CSV header layer (translated on parse).
- **CSV headers bilingual** — parser accepts Finnish or English headers. Internal representation is always English.

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
  → Store species breakdown (Finnish/English CSV columns → English species names → compartment_species)
  → On any failure: delete forest (cascade removes compartments, species, boundary)
```

---

## 2. UI Design

Same as v5.0 (two-tab layout: Metsäkeskus API | CSV File). See v5.0 changelog for details.

---

## 3. Task Breakdown

### Track A: CSV Parser (3 tasks, ~1.5h)

---

#### P5.1: Install Papa Parse and create CSV parser

**Objective:** Parse the semicolon-delimited CSV format into typed TypeScript structures. Accepts both Finnish and English column headers, outputs English snake_case field names.

**Files:**
- `package.json` — add `papaparse`, `@types/papaparse`, `tsx` (devDep)
- Create: `src/lib/import/csv-parser.ts`

```typescript
// src/lib/import/csv-parser.ts

// Finnish CSV header → internal English snake_case field name
const FI_TO_EN_COLUMN: Record<string, string> = {
  // Stand attributes
  pinta_ala_ha: "area_ha",
  maaluokka: "land_class",
  kehitysluokka: "development_class",
  kasvupaikka: "site_type",
  maalaji: "soil_type",
  ojitustilanne: "drainage_status",
  paapuulaji: "main_species",
  // Stand totals
  total_ika: "total_age",
  total_ppa: "total_basal_area",
  total_runkoluku: "total_stem_count",
  total_kpituus: "total_mean_height",
  total_klapimitta: "total_mean_diameter",
  total_tukki_pct: "total_log_pct",
  // Species field suffixes
  ika: "age",
  ppa: "basal_area",
  runkoluku: "stem_count",
  kpituus: "mean_height",
  klapimitta: "mean_diameter",
  tukki_pct: "log_pct",
};

// Finnish CSV species prefix → English snake_case species name
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
  main_species: string;       // English snake_case from SPECIES_NAME_MAP: "pine", "spruce", etc.
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
  species: CsvSpeciesRow[];   // parsed from species columns
}

export interface ParsedCsvData {
  stands: CsvStandRow[];
  totalStands: number;
  totalVolumeM3: number;
  speciesList: string[];      // English snake_case species names found
}

/**
 * Resolve a CSV header to its internal English field name.
 * Accepts Finnish or English headers.
 */
function resolveField(csvHeader: string): string {
  if (csvHeader in FI_TO_EN_COLUMN) return FI_TO_EN_COLUMN[csvHeader];
  return csvHeader; // English headers pass through unchanged
}

/**
 * Parse forest compartment CSV format.
 * Auto-detects language from headers. Outputs English snake_case field names.
 */
export function parseForestDataCsv(csvContent: string): ParsedCsvData;
```

**Parser logic:**
1. Papa Parse with `delimiter: ";"`, `header: true`, `skipEmptyLines: true`
2. Read header row → for stand attribute/total columns, map through `resolveField()`
3. Detect species columns: any header matching `{prefix}_{suffix}` where prefix is in `SPECIES_NAME_MAP` (Finnish) or is an English species name
4. For each data row:
   a. Parse stand attribute and total columns (Finnish or English → internal field)
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
3. Species name mapping: `mänty_m3` column → `CsvSpeciesRow.species = "pine"`
4. Finnish total fields: `total_ika` → `total_age`, `total_ppa` → `total_basal_area`, etc.
5. English total fields: `total_age`, `total_basal_area` pass through
6. Finnish species fields: `mänty_ika` → `age`, `mänty_ppa` → `basal_area`, `mänty_tukki_pct` → `log_pct`
7. English species fields: `pine_age`, `pine_basal_area` pass through
8. Empty species columns → `null` values, not zero
9. Stand with missing `polygon_wkt` → `polygon_wkt = ""` (handled gracefully)
10. Stand with `total_m3 = 0` → still imported
11. Valid WKT string → contains `MULTIPOLYGON(((...)))`
12. Malformed WKT → string still stored (PostGIS will reject on insert)
13. CSV with different species columns → auto-detected from header
14. Total volume aggregation matches sum of `total_m3`
15. Both Finnish (`mänty`) and English (`pine`) species prefixes detected

---

#### P5.3: Handle edge cases

- Empty/blank cells → `null` (not 0)
- Missing `polygon_wkt` → stand stored without geometry (`geometry: null`)
- Stands with `total_m3 = 0` → still imported
- Duplicate `stand_id` → handled by UPSERT
- CSV with Finnish headers → all fields mapped to English via `FI_TO_EN_COLUMN`
- CSV with English headers → pass through unchanged
- CSV with mixed Finnish/English headers → handled per-column
- Species with volume 0 → not inserted into `compartment_species`
- Main species values → mapped through `SPECIES_NAME_MAP` (snake_case English)
- `total_m3_ha` (standing volume/ha) → stored in `attributes` JSONB, NOT in `growth_m3_per_ha`

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
  supabase: SupabaseClient  // authenticated user client (NOT admin)
): Promise<CsvImportResult>;
```

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
| `land_class` | `attributes` JSONB | |
| `total_m3_ha` | `attributes` JSONB | standing volume/ha; NOT growth |
| `total_stem_count` | `attributes` JSONB | |
| `total_log_pct` | `attributes` JSONB | |
| `total_pct` | `attributes` JSONB | |
| `center_lat` | `attributes` JSONB | |
| `center_lon` | `attributes` JSONB | |

**Column mapping — CsvSpeciesRow → compartment_species columns:**

| CsvSpeciesRow field | compartment_species column | Notes |
|---|---|---|
| `species` | `species` | snake_case English: "pine", "spruce", etc. |
| `m3` | `volume_m3` | |
| `log_pct` | `log_pct` | |
| (computed) | `area_ha` | proportional: species.m3 / total_m3 × area_ha |
| `age`, `basal_area`, `stem_count`, `mean_height`, `mean_diameter`, `m3_ha`, `pct` | `attributes` JSONB on compartment | stored for reference |

---

#### P5.5: WKT → GeoJSON geometry conversion

Same as v5.0. No field name changes.

---

#### P5.6: Species data storage

**Objective:** Store per-species breakdown from CSV columns into `compartment_species`. All column names, field names, and values use English snake_case.

Species values stored in `compartment_species.species`:
```
CSV mänty_* columns  →  CsvSpeciesRow { species: "pine", ... }
CSV pine_* columns   →  CsvSpeciesRow { species: "pine", ... }  (English headers)
CSV kuusi_* columns  →  CsvSpeciesRow { species: "spruce", ... }
...etc for all 8 species
```

Only insert rows where `m3 > 0`. The importer iterates `CsvStandRow.species[]` directly — no DB re-query.

**Area calculation:** `area_ha = (species.m3 / stand.total_m3) × stand.area_ha` (proportional to volume share).

**Batch insert:** 500 rows per batch.

---

#### P5.7: Create CSV upload API route (all-or-nothing)

Same structure as v5.0. No field name changes in the route itself.

---

#### P5.8: Update frontend import page

Same as v5.0. No field name changes in the UI layer.

---

### Track C: Code Cleanup (1 task, ~30 min)

---

#### P5.9: Remove all gridcell code

Same as v5.0. No changes.

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

#### P5.13: Update all source file references (English snake_case)

**Objective:** Update every reference to renamed DB columns AND switch all species values to English snake_case for consistency.

**Files to update (11 files):**

| File | Changes |
|---|---|
| `src/types/database.ts` | `CompartmentSpecies.puulaji` → `species`, `tukkiprosentti` → `log_pct` |
| `src/lib/import/code-tables.ts` | `MAINGROUP_MAP`: `"Pine"`→`"pine"`, `"Spruce"`→`"spruce"`, `"Broadleaf"`→`"broadleaf"` |
| `src/lib/ai/chart-engine.ts:91-92` | FIELD_ALIASES: remove `puulaji` entries (now identity: `species`→`"species"`) |
| `src/lib/chat/system-prompt.ts:60,82` | `puulaji` → `species` in chart templates; species examples updated to snake_case |
| `src/lib/import/spatial-service.ts` | `RawSpecies`: `puulaji`→`species`, `tukkiprosentti`→`log_pct`; gridcell species values: `"Mänty"`→`"pine"`, `"Kuusi"`→`"spruce"`, `"Lehtipuu"`→`"broadleaf"` |
| `src/lib/ai/income-calculator.ts:11,13,80,82` | `puulaji`→`species`, `tukkiprosentti`→`log_pct`; species comparisons to snake_case |
| `src/lib/ai/classify.ts:53,56,58,73,90,92` | `puulaji`→`species`, `tukkiprosentti`→`log_pct`; `"Koivu"`→`"birch"`, `"Rauduskoivu"`→`"silver_birch"` |
| `src/lib/ai/schedule.ts:67,370` | `paapuulaji` stays (KuviotData — out of scope) |
| `src/__tests__/unit/forestry-schedule.test.ts:13` | `paapuulaji` stays (match KuviotData) |
| `src/lib/import/wfs-client.ts` | Gridcell code removal (P5.9) |
| `src/app/api/import/property/route.ts` | Gridcell removal + all-or-nothing (P5.9 + P5.14) |

**code-tables.ts MAINGROUP_MAP update:**

```typescript
// Before:
export const MAINGROUP_MAP: Record<number, string> = {
  1: "Pine",
  2: "Spruce",
  3: "Broadleaf",
};

// After (snake_case for consistency):
export const MAINGROUP_MAP: Record<number, string> = {
  1: "pine",
  2: "spruce",
  3: "broadleaf",
};
```

**classify.ts species comparison update:**

```typescript
// Before:
const spKey = sp.puulaji === "Koivu" ? "Rauduskoivu" : sp.puulaji;

// After (English snake_case):
const spKey = sp.species === "birch" ? "silver_birch" : sp.species;
```

**spatial-service.ts gridcell species values (updated in place before deletion in P5.9):**

```typescript
// Before:
species.push({ puulaji: "Mänty", m3: ..., tukkiprosentti: 0 });
species.push({ puulaji: "Kuusi", m3: ..., tukkiprosentti: 0 });
species.push({ puulaji: "Lehtipuu", m3: ..., tukkiprosentti: 0 });

// After (English snake_case):
species.push({ species: "pine", m3: ..., log_pct: 0 });
species.push({ species: "spruce", m3: ..., log_pct: 0 });
species.push({ species: "broadleaf", m3: ..., log_pct: 0 });
```

**Verification:**
```bash
# No Finnish DB column names remain
grep -rn "puulaji\|tukkiprosentti" src/ --include="*.ts" --include="*.tsx"
# Expected: zero matches

# Species values are English snake_case
grep -rn '"Pine"\|"Spruce"\|"Broadleaf"\|"Mänty"\|"Kuusi"\|"Lehtipuu"\|"Koivu"' src/ --include="*.ts" --include="*.tsx"
# Expected: zero matches (may appear in comments or Finnish data constants)
```

---

#### P5.14: Add all-or-nothing error handling to WFS import path

Same as v5.0. No changes.

---

## 4. Complete File Manifest

| File | Action | Purpose |
|---|---|---|
| `src/lib/import/csv-parser.ts` | **Create** | Parse CSV (Finnish/English headers → English snake_case fields) |
| `src/lib/import/csv-importer.ts` | **Create** | CSV → MML → Supabase storage (user auth, no admin) |
| `src/app/api/import/csv/route.ts` | **Create** | POST multipart CSV upload, all-or-nothing |
| `src/__tests__/unit/csv-parser.test.ts` | **Create** | CSV parser tests (both languages, species mapping, WKT) |
| `src/app/(app)/forest/new/page.tsx` | **Modify** | Two-tab UI |
| `src/components/import/ImportProgress.tsx` | **Modify** | CSV progress stages |
| `supabase/migrations/008_english_column_names.sql` | **Create** | Rename `puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/types/database.ts` | **Modify** | `CompartmentSpecies.puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/lib/import/code-tables.ts` | **Modify** | MAINGROUP_MAP: Title Case → snake_case |
| `src/lib/ai/chart-engine.ts` | **Modify** | FIELD_ALIASES: remove `puulaji` references |
| `src/lib/chat/system-prompt.ts` | **Modify** | `puulaji` → `species`; snake_case species examples |
| `src/lib/import/spatial-service.ts` | **Modify** | Remove gridcell code; `puulaji`→`species`, Fi→En species values |
| `src/lib/ai/income-calculator.ts` | **Modify** | `puulaji`→`species`, `tukkiprosentti`→`log_pct` |
| `src/lib/ai/classify.ts` | **Modify** | `puulaji`→`species`, `tukkiprosentti`→`log_pct`; En species comparisons |
| `src/app/api/import/property/route.ts` | **Modify** | Remove gridcell fetch; all-or-nothing |
| `src/lib/import/wfs-client.ts` | **Modify** | Remove gridcell code |
| `src/__tests__/unit/wfs-client.test.ts` | **Modify** | Remove gridcell tests |
| `package.json` | **Modify** | Add `papaparse`, `@types/papaparse`, `tsx` (devDep) |

## 5. Verification Checklist

- [ ] Migration 008 runs: `puulaji`→`species`, `tukkiprosentti`→`log_pct`
- [ ] `grep -rn "puulaji\|tukkiprosentti" src/` → zero matches
- [ ] `grep -rn '"Pine"\|"Spruce"\|"Broadleaf"\|"Mänty"\|"Kuusi"\|"Lehtipuu"' src/` → zero matches in code
- [ ] `parseForestDataCsv()` with Finnish headers → all fields English snake_case
- [ ] `parseForestDataCsv()` with English headers → passes through
- [ ] Species: `mänty_m3` → `species = "pine"`; `mänty_tukki_pct` → `log_pct`
- [ ] Totals: `total_ika` → `total_age`; `total_ppa` → `total_basal_area`
- [ ] `CsvSpeciesRow` fields: `age`, `basal_area`, `stem_count`, `mean_height`, `mean_diameter`, `log_pct`, `m3_ha`, `m3`, `pct`
- [ ] `CsvStandRow` fields: `total_age`, `total_basal_area`, `total_stem_count`, `total_mean_height`, `total_mean_diameter`, `total_log_pct`
- [ ] `MAINGROUP_MAP`: `{ 1: "pine", 2: "spruce", 3: "broadleaf" }`
- [ ] `POST /api/import/csv` imports with geometry (no admin client)
- [ ] Forest owner = authenticated user (RLS verified)
- [ ] Species stored with English column names + English snake_case values
- [ ] Failed import cleans up forest (no orphans)
- [ ] API import path still works
- [ ] API import path all-or-nothing on failure
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

**Critical:** P5.12 + P5.13 = one atomic commit.
