# Phase 5: CSV Stand Data Import

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Version:** 3.0
**Date:** 2026-05-28
**Goal:** Add CSV stand data import alongside the existing Metsäkeskus API import. The import page offers two clearly labeled options for importing stand data. CSV import uses the flat format from `upm_forest_data.csv` (92 columns, semicolon-delimited, 161 stands, 8 species × 9 fields). Property boundary is always fetched from MML API regardless of import method.

**Architecture:** Two import paths on the same page, sharing the MML boundary fetch. CSV path: parse flat CSV → extract property ID → MML fetch boundary → store compartments with WKT geometry + species data. API path: unchanged (remove gridcell code only).

**CSV Source:** `upm_forest_data.csv` — flat 92-column file (semicolon-delimited, dot-decimal), already containing polygon WKT in EPSG:4326.

**Tech Stack:** TypeScript, Next.js 16, Supabase + PostGIS, Papa Parse, Turf.js, proj4

---

## 0. CSV Format

```
Header: stand_id;pinta_ala_ha;maaluokka;kehitysluokka;kasvupaikka;maalaji;ojitustilanne;paapuulaji;center_lat;center_lon;polygon_wkt;total_ika;...;rauduskoivu_pct
Data:   1.0;3.2;Metsämaa Kangas;Nuori kasvatusmetsikkö;...;MULTIPOLYGON(((24.231...;...;91
```

### Column groups

| Group | Columns | Count |
|---|---|---|
| Stand attributes | `stand_id`, `pinta_ala_ha`, `maaluokka`, `kehitysluokka`, `kasvupaikka`, `maalaji`, `ojitustilanne`, `paapuulaji` | 8 |
| Geometry | `center_lat`, `center_lon`, `polygon_wkt` (EPSG:4326 MULTIPOLYGON WKT) | 3 |
| Stand totals | `total_ika`, `total_ppa`, `total_runkoluku`, `total_kpituus`, `total_klapimitta`, `total_tukki_pct`, `total_m3_ha`, `total_m3`, `total_pct` | 9 |
| 8 species × 9 fields | `{species}_ika`, `_ppa`, `_runkoluku`, `_kpituus`, `_klapimitta`, `_tukki_pct`, `_m3_ha`, `_m3`, `_pct` | 72 |
| **Total** | | **92** |

Species columns: `haapa_*`, `harmaaleppä_*`, `hieskoivu_*`, `kuusi_*`, `lehtikuusi_*`, `mänty_*`, `pihlaja_*`, `rauduskoivu_*`

Empty species cells = stand doesn't have that species. Polygon WKT is in EPSG:4326 (`lon lat` order).

### Key design decisions

- **Property ID is NOT in the CSV** — the MML fetch needs a separate property ID input, OR we derive it from the user's existing forests, OR we add a property ID field to the import form.
- **Polygon geometry is already in the CSV** as WKT — no WFS stand fetch needed for CSV import.
- **Species data is already in the CSV** as columns — no `compartment_species` population from gridcells.

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
  → Parse CSV (Papa Parse) → 161 stand rows
  → MML API → property boundary
  → Create forest record
  → Store compartments (CSV attributes + WKT geometry)
  → Store species breakdown (CSV species columns → compartment_species)
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
│  │ 📁 upm_forest_data.csv    (161 stands)       │  │  ← file input
│  └──────────────────────────────────────────────┘  │
│  161 stands · 8 species · 32,536 m³ total volume   │  ← parsed preview
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
  ✓ 161 stands, 32,536 m³ found
○ Fetching property boundary...    → MML API
○ Storing compartments...          → Supabase insert
○ Importing species data...        → Supabase insert
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

**Objective:** Parse the 92-column flat CSV format into typed TypeScript structures.

**Files:**
- `package.json` — add `papaparse`, `@types/papaparse`
- Create: `src/lib/import/csv-parser.ts`

```typescript
// src/lib/import/csv-parser.ts

export interface CsvSpeciesRow {
  puulaji: string;          // "mänty", "kuusi", etc.
  ika: number | null;
  ppa: number | null;       // pohjapinta-ala
  runkoluku: number | null;
  kpituus: number | null;   // keskipituus
  klapimitta: number | null;
  tukki_pct: number | null;
  m3_ha: number | null;
  m3: number | null;
  pct: number | null;
}

export interface CsvStandRow {
  stand_id: string;          // "1.0", "4.0"
  pinta_ala_ha: number;
  maaluokka: string;
  kehitysluokka: string;
  kasvupaikka: string;
  maalaji: string;
  ojitustilanne: string;
  paapuulaji: string;
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
  speciesList: string[];
}

/** Parse upm_forest_data.csv format */
export function parseForestDataCsv(csvContent: string): ParsedCsvData;
```

**Parser logic:**
1. Papa Parse with `delimiter: ";"`
2. Read header row → determine which species columns exist
3. For each data row, parse stand attributes + all species columns
4. Return typed data with summary stats

**Verification:**
```bash
npx tsx -e "
import { parseForestDataCsv } from './src/lib/import/csv-parser';
import fs from 'fs';
const csv = fs.readFileSync('/home/pasi-hokkanen/Metsa/upm_forest_data.csv', 'utf-8');
const result = parseForestDataCsv(csv);
console.log('Stands:', result.totalStands);
console.log('Volume:', result.totalVolumeM3, 'm³');
console.log('Species:', result.speciesList);
console.log('First stand:', result.stands[0].stand_id, result.stands[0].pinta_ala_ha, 'ha');
"
# Expected: 161 stands, 32,536 m³, 8 species, stand 1.0, 3.2 ha
```

---

#### P5.2: Write unit tests

**Files:**
- Create: `src/__tests__/unit/csv-parser.test.ts`

**Test cases:**
1. Parse real `upm_forest_data.csv` → 161 stands
2. Stand 1.0: area=3.2, species mänty m3=177, kuusi m3=13
3. Empty species columns → null values, not zero
4. WKT polygon parsing (verify it contains valid coordinates)
5. Stand with missing geometry (empty polygon_wkt) — handled gracefully
6. Total volume aggregation → 32,536 m³

---

#### P5.3: Handle edge cases

- Empty/blank cells → `null` (not 0)
- Missing `polygon_wkt` → stand stored without geometry
- Stands with `total_m3 = 0` (Joutomaa) → still imported
- Duplicate `stand_id` → skip with warning
- CSV with different species columns → auto-detect from header

---

### Track B: Import Pipeline (4 tasks, ~2.5h)

---

#### P5.4: Create CSV stand importer

**Files:**
- Create: `src/lib/import/csv-importer.ts`

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
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
  mmlApiKey: string
): Promise<CsvImportResult>;
```

**Flow:**
1. Fetch MML boundary → `fetchPropertyBoundary(propertyId, mmlApiKey)`
2. Create forest record (data_source: `'csv'`)
3. Store property boundary
4. For each CSV stand row:
   a. Parse WKT → PostGIS geometry (or store as-is if PostGIS handles WKT)
   b. Insert into `compartments` table
5. For each CSV stand row:
   a. Extract species data from columns
   b. Insert into `compartment_species` table
6. Update forest totals

**⚠️ Key decision:** The polygon WKT is in EPSG:4326. For PostGIS storage, use `ST_GeomFromText(wkt, 4326)` to convert to geometry. The `compartments.geometry` column is `GEOMETRY(MultiPolygon, 3067)` — so we need to transform EPSG:4326 → EPSG:3067. Use `ST_Transform(ST_GeomFromText($1, 4326), 3067)` in the insert.

**Simpler alternative:** Convert WKT to GeoJSON, then use Supabase's GeoJSON support. Or change the geometry column to SRID 4326.

---

#### P5.5: WKT → PostGIS geometry conversion

**Objective:** Convert `MULTIPOLYGON(((lon lat,...)))` WKT to PostGIS geometry.

**Approach A — Use PostGIS function (recommended):**
```sql
INSERT INTO compartments (forest_id, stand_id, geometry, ...)
VALUES ($1, $2, ST_Transform(ST_GeomFromText($3, 4326), 3067), ...)
```

**Approach B — Parse WKT in TypeScript, convert to GeoJSON:**
```typescript
function wktToGeoJSON(wkt: string): GeoJSON.MultiPolygon {
  // Parse MULTIPOLYGON(((lon lat, lon lat,...)))
  // Convert to GeoJSON coordinates
}
```

**Approach B is simpler** — we already have GeoJSON handling in the existing code. Parse the WKT string, extract coordinate pairs, build GeoJSON `MultiPolygon`, use existing Supabase insert pattern.

**⚠️ Pitfall:** WKT uses `lon lat` order. GeoJSON uses `[lon, lat]` order. They match — no swap needed.

---

#### P5.6: Species data storage

**Objective:** Store per-species breakdown from CSV columns into `compartment_species`.

**Mapping:**
```
CSV column: mänty_m3  →  compartment_species.puulaji = 'Mänty', volume_m3 = value
CSV column: kuusi_m3  →  compartment_species.puulaji = 'Kuusi', volume_m3 = value
...etc for all 8 species
```

Only insert rows where the species has volume > 0 (or any non-null value). Use the same `populateCompartmentSpecies` pattern but sourced from CSV columns instead of gridcells.

---

#### P5.7: Create CSV upload API route

**Files:**
- Create: `src/app/api/import/csv/route.ts`

```typescript
export async function POST(request: NextRequest) {
  // 1. Auth check
  // 2. Parse multipart form → extract CSV file + property_id + name
  // 3. Read file as text
  // 4. parseForestDataCsv(text) → ParsedCsvData
  // 5. importStandsFromCsv(csvData, propertyId, name, userId, mmlApiKey) → result
  // 6. Return JSON
}
```

**Request:** `multipart/form-data` with fields `file` (CSV), `property_id` (string), `name` (optional string)

**Response:** `{ forest_id, stands_imported, species_rows, total_volume_m3, warnings }`

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

**Changes to `ImportProgress.tsx`:**
1. Add CSV stages: `'parsing_csv'`, `'fetching_boundary'`, `'storing_stands'`, `'storing_species'`
2. CSV path shows stand count and volume from client-side preview parse

**Client-side preview:** On file select, run Papa Parse in the browser to extract stand count and total volume. Show these in the UI as immediate feedback before submitting.

---

### Track C: Code Cleanup (3 tasks, ~1h)

---

#### P5.9: Remove all gridcell code

**Files:**
- `src/lib/import/wfs-client.ts` — Delete `WfsGridcell`, `fetchGridcellsByBbox()`. Keep `WfsStand`, `fetchStandsByBbox()`, helpers.
- `src/lib/import/spatial-service.ts` — Delete `matchGridcellsToStands()`, `populateCompartmentSpecies()`. Keep `filterStandsWithinProperty()` for API import path.
- `src/app/api/import/property/route.ts` — Remove gridcell fetch and parameter.
- `src/__tests__/unit/wfs-client.test.ts` — Remove gridcell tests.

**Verification:** `grep -ri "gridcell\|Gridcell" src/` → zero matches

---

#### P5.10: Fix chart engine alias resolution

(Same as before — fix `aggregateFn` to resolve field aliases)

**Files:**
- Modify: `src/lib/ai/chart-engine.ts`

---

#### P5.11: Update system prompt

**Files:**
- Modify: `src/lib/chat/system-prompt.ts`

Remove references to `compartment_species` as a gridcell-derived source. Note it's populated from CSV import. Keep existing chart templates.

---

### Track D: Database (1 task)

---

#### P5.12: Migration 008

**Files:**
- Create: `supabase/migrations/008_csv_import_support.sql`

```sql
-- No schema changes. Existing tables support CSV import.
-- compartment_species is CSV-derived (was gridcell-derived).

COMMENT ON TABLE compartments IS 'Stand data from Metsäkeskus WFS API or CSV file import';
COMMENT ON TABLE compartment_species IS 'Per-species data from CSV import or WFS gridcell (legacy)';
```

---

## 4. Complete File Manifest

| File | Action | Purpose |
|---|---|---|
| `src/lib/import/csv-parser.ts` | **Create** | Parse upm_forest_data.csv format |
| `src/lib/import/csv-importer.ts` | **Create** | CSV → MML boundary → Supabase storage |
| `src/app/api/import/csv/route.ts` | **Create** | POST multipart CSV upload endpoint |
| `src/__tests__/unit/csv-parser.test.ts` | **Create** | CSV parser tests |
| `src/app/(app)/forest/new/page.tsx` | **Modify** | Two-tab UI: API + CSV import |
| `src/components/import/ImportProgress.tsx` | **Modify** | Add CSV progress stages |
| `src/lib/import/wfs-client.ts` | **Modify** | Remove gridcell code |
| `src/lib/import/spatial-service.ts` | **Modify** | Remove gridcell functions |
| `src/app/api/import/property/route.ts` | **Modify** | Remove gridcell fetch |
| `src/lib/ai/chart-engine.ts` | **Modify** | Fix alias resolution |
| `src/lib/chat/system-prompt.ts` | **Modify** | Update data source notes |
| `supabase/migrations/008_csv_import_support.sql` | **Create** | Documentation migration |
| `src/__tests__/unit/wfs-client.test.ts` | **Modify** | Remove gridcell tests |

## 5. Verification Checklist

- [ ] `parseForestDataCsv()` parses `upm_forest_data.csv` → 161 stands, 8 species
- [ ] Client-side preview shows stand count and total volume on file select
- [ ] `POST /api/import/csv` imports all 161 stands with geometry
- [ ] Stands appear on map with correct polygon boundaries
- [ ] Species data visible in per-species charts
- [ ] API import path still works (property ID → WFS → stands on map)
- [ ] Both tabs clearly labeled as stand data import methods
- [ ] `grep -ri gridcell src/` → zero matches
- [ ] `npm run build` passes
- [ ] `npx vitest run` passes

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WKT parsing edge cases | Some stands lack geometry | Graceful fallback: store without geometry |
| PostGIS SRID mismatch (4326 WKT vs 3067 column) | Geometry insert fails | Convert: `ST_Transform(ST_GeomFromText(wkt,4326),3067)` |
| Large CSV (~200KB for 161 stands) | Multipart upload size limits | Next.js default is fine for this size |
| CSV has different property than MML ID | Property boundary mismatch | Validate center_lat/center_lon falls within MML boundary |

## 7. Out of Scope

- Importing planned operations from CSV (not present in upm_forest_data.csv)
- Multi-property CSV support
- CSV export functionality
- Editing imported stands in bulk

---

**Changelog v3.0:**
- Complete rewrite: CSV is now a second import option alongside API, not a replacement
- CSV format changed to flat 92-column upm_forest_data.csv (was hierarchical kuviotiedot)
- Polygon geometry comes from CSV WKT, not WFS
- Species data comes from CSV columns, not gridcells
- UI redesigned as two-tab layout with clear labeling
- Property ID input added to CSV import path (not embedded in CSV)
